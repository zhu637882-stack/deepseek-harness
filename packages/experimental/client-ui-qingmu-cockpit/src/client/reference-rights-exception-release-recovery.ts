const STORAGE_PREFIX = 'qingmu:reference-rights-exception-release-recovery:v1'
const SHA256 = /^[0-9a-f]{64}$/
const ELEMENT_KINDS = ['actor', 'scene', 'prop'] as const

/** Rights fields that may be released by one exact reference-rights exception. */
export const REFERENCE_RIGHTS_EXCEPTION_FIELDS = [
  'sourceType',
  'rightsHolder',
  'authorizationScope',
  'territory',
  'term',
  'restrictions',
  'contains',
  'providerTerms',
  'modelLicenses',
  'humanDeclaration',
  'contentCredentials',
] as const

const MARKER_KEYS = [
  'projectId',
  'elementKind',
  'targetId',
  'expectedSubjectRevision',
  'expectedSubjectSha256',
  'referenceAssetId',
  'referenceAssetSha256',
  'rightsRecordSha256',
  'reasonSha256',
  'scopeSha256',
  'idempotencyKey',
] as const

/**
 * Element kinds supported by reference-rights exception recovery.
 */
export type ReferenceRightsExceptionElementKind = typeof ELEMENT_KINDS[number]
/**
 * Reference-rights fields that an exception may release.
 */
export type ReferenceRightsExceptionField = typeof REFERENCE_RIGHTS_EXCEPTION_FIELDS[number]

/** Exact, finite scope sent to the exception-release command. */
export interface ReferenceRightsExceptionScope {
  readonly kind: 'reference_rights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rightsRecordSha256: string
  readonly rightsFields: readonly ReferenceRightsExceptionField[]
}

/**
 * Non-secret recovery coordinates. It deliberately excludes the reason, scope body,
 * identities, authorization facts, timestamps, and command result.
 */
export interface ReferenceRightsExceptionReleaseRecoveryMarker {
  readonly projectId: string
  readonly elementKind: ReferenceRightsExceptionElementKind
  readonly targetId: string
  readonly expectedSubjectRevision: number
  readonly expectedSubjectSha256: string
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rightsRecordSha256: string
  readonly reasonSha256: string
  readonly scopeSha256: string
  readonly idempotencyKey: string
}

/**
 * Result of reading a reference-rights exception release marker.
 */
export type ReferenceRightsExceptionReleaseRecoveryRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: ReferenceRightsExceptionReleaseRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000\r\n]/.test(value)
}

function isElementKind(value: unknown): value is ReferenceRightsExceptionElementKind {
  return ELEMENT_KINDS.includes(value as ReferenceRightsExceptionElementKind)
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto')
  if (
    typeof cryptoValue !== 'object'
    || cryptoValue === null
    || !('subtle' in cryptoValue)
    || typeof cryptoValue.subtle !== 'object'
    || cryptoValue.subtle === null
    || !('digest' in cryptoValue.subtle)
    || typeof cryptoValue.subtle.digest !== 'function'
  ) throw new Error('当前浏览器不支持异常放行恢复摘要')
  return cryptoValue.subtle as SubtleCrypto
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

/** Canonical JSON shared semantically with the Host receipt verifier. */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('异常放行摘要只接受安全整数')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(compareUnicodeCodePoints)
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error('异常放行摘要输入不是规范 JSON')
}

async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await getSubtleCrypto().digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function storageKey(
  projectId: string,
  elementKind: ReferenceRightsExceptionElementKind,
  targetId: string,
): string {
  return [
    STORAGE_PREFIX,
    encodeURIComponent(projectId),
    encodeURIComponent(elementKind),
    encodeURIComponent(targetId),
  ].join(':')
}

function parseMarker(
  value: unknown,
  projectId: string,
  elementKind: ReferenceRightsExceptionElementKind,
  targetId: string,
): ReferenceRightsExceptionReleaseRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('异常放行恢复标记不是对象')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [...MARKER_KEYS].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('异常放行恢复标记字段不符合合同')
  }
  if (!isIdentifier(record.projectId) || record.projectId !== projectId) {
    throw new Error('异常放行恢复标记 Project ID 不匹配')
  }
  if (!isElementKind(record.elementKind) || record.elementKind !== elementKind) {
    throw new Error('异常放行恢复标记 Element Kind 不匹配')
  }
  if (!isIdentifier(record.targetId) || record.targetId !== targetId) {
    throw new Error('异常放行恢复标记 Target ID 不匹配')
  }
  if (!Number.isSafeInteger(record.expectedSubjectRevision) || (record.expectedSubjectRevision as number) < 0) {
    throw new Error('异常放行恢复标记 Subject Revision 无效')
  }
  for (const field of [
    'expectedSubjectSha256',
    'referenceAssetSha256',
    'rightsRecordSha256',
    'reasonSha256',
    'scopeSha256',
  ] as const) {
    if (typeof record[field] !== 'string' || !SHA256.test(record[field])) {
      throw new Error(`异常放行恢复标记 ${field} 无效`)
    }
  }
  if (!isIdentifier(record.referenceAssetId)) throw new Error('异常放行恢复标记参考资产 ID 无效')
  if (!isIdentifier(record.idempotencyKey, 200) || record.idempotencyKey.length < 8) {
    throw new Error('异常放行恢复标记幂等键无效')
  }
  return {
    projectId: record.projectId,
    elementKind: record.elementKind,
    targetId: record.targetId,
    expectedSubjectRevision: record.expectedSubjectRevision as number,
    expectedSubjectSha256: record.expectedSubjectSha256 as string,
    referenceAssetId: record.referenceAssetId,
    referenceAssetSha256: record.referenceAssetSha256 as string,
    rightsRecordSha256: record.rightsRecordSha256 as string,
    reasonSha256: record.reasonSha256 as string,
    scopeSha256: record.scopeSha256 as string,
    idempotencyKey: record.idempotencyKey,
  }
}

function sameMarker(
  left: ReferenceRightsExceptionReleaseRecoveryMarker,
  right: ReferenceRightsExceptionReleaseRecoveryMarker,
): boolean {
  const leftRecord = left as unknown as Record<string, unknown>
  const rightRecord = right as unknown as Record<string, unknown>
  return MARKER_KEYS.every(key => leftRecord[key] === rightRecord[key])
}

/**
 * Normalize a finite scope and put its set-like rights fields into authoritative order.
 * @param value - Untrusted value to validate and normalize.
 * @returns Validated ReferenceRightsExceptionScope value.
 */
export function normalizeReferenceRightsExceptionScope(value: unknown): ReferenceRightsExceptionScope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('异常放行范围不是对象')
  }
  const record = value as Record<string, unknown>
  const expectedKeys = [
    'kind', 'referenceAssetId', 'referenceAssetSha256', 'rightsRecordSha256', 'rightsFields',
  ].sort()
  const keys = Object.keys(record).sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('异常放行范围字段不符合合同')
  }
  if (record.kind !== 'reference_rights') throw new Error('异常放行范围类型无效')
  if (!isIdentifier(record.referenceAssetId)) throw new Error('异常放行范围参考资产 ID 无效')
  if (typeof record.referenceAssetSha256 !== 'string' || !SHA256.test(record.referenceAssetSha256)) {
    throw new Error('异常放行范围参考资产 SHA-256 无效')
  }
  if (typeof record.rightsRecordSha256 !== 'string' || !SHA256.test(record.rightsRecordSha256)) {
    throw new Error('异常放行范围权利记录 SHA-256 无效')
  }
  if (!Array.isArray(record.rightsFields) || record.rightsFields.length === 0) {
    throw new Error('异常放行必须至少选择一个权利字段')
  }
  const provided = record.rightsFields as unknown[]
  if (!provided.every(field => REFERENCE_RIGHTS_EXCEPTION_FIELDS.includes(field as ReferenceRightsExceptionField))) {
    throw new Error('异常放行包含未授权的权利字段')
  }
  if (new Set(provided).size !== provided.length) throw new Error('异常放行权利字段不得重复')
  const fieldSet = new Set(provided as ReferenceRightsExceptionField[])
  return {
    kind: 'reference_rights',
    referenceAssetId: record.referenceAssetId,
    referenceAssetSha256: record.referenceAssetSha256,
    rightsRecordSha256: record.rightsRecordSha256,
    rightsFields: REFERENCE_RIGHTS_EXCEPTION_FIELDS.filter(field => fieldSet.has(field)),
  }
}

/**
 * Hash the exact trimmed reason without retaining it in recovery storage.
 * @param reason - Human-provided exception reason.
 * @returns SHA-256 digest of the canonical value.
 */
export async function digestReferenceRightsExceptionReason(reason: string): Promise<string> {
  if (typeof reason !== 'string' || reason.length === 0 || reason !== reason.trim() || /\u0000/.test(reason)) {
    throw new Error('异常放行理由无效')
  }
  return digestCanonical(reason)
}

/**
 * Hash the normalized finite scope without retaining its body in recovery storage.
 * @param scope - Recovery or approval scope.
 * @returns SHA-256 digest of the canonical value.
 */
export async function digestReferenceRightsExceptionScope(scope: unknown): Promise<string> {
  return digestCanonical(normalizeReferenceRightsExceptionScope(scope))
}

/**
 * Derive one deterministic Host idempotency key from non-secret recovery coordinates.
 * @param input - Inputs used to create the recovery marker.
 * @returns Stable idempotency key for the canonical operation.
 */
export async function deriveReferenceRightsExceptionIdempotencyKey(
  input: Omit<ReferenceRightsExceptionReleaseRecoveryMarker, 'idempotencyKey'>,
): Promise<string> {
  const validated = parseMarker(
    { ...input, idempotencyKey: 'qingmu:pending' },
    input.projectId,
    input.elementKind,
    input.targetId,
  )
  const digest = await digestCanonical(MARKER_KEYS
    .filter(key => key !== 'idempotencyKey')
    .map(key => [key, validated[key]]))
  return `qingmu:rights-exception:v1:${digest}`
}

/**
 * Validate the exact marker before it is synchronously persisted.
 * @param input - Inputs used to create the recovery marker.
 * @returns Recovery marker bound to the requested operation.
 */
export function createReferenceRightsExceptionReleaseRecoveryMarker(
  input: ReferenceRightsExceptionReleaseRecoveryMarker,
): ReferenceRightsExceptionReleaseRecoveryMarker {
  return parseMarker(input, input.projectId, input.elementKind, input.targetId)
}

/**
 * Read one subject-scoped marker without causing a command or server request.
 * @param projectId - Project identifier in the recovery scope.
 * @param elementKind - Reference element kind in the recovery scope.
 * @param targetId - Target identifier in the recovery scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readReferenceRightsExceptionReleaseRecoveryMarker(
  projectId: string,
  elementKind: ReferenceRightsExceptionElementKind,
  targetId: string,
): ReferenceRightsExceptionReleaseRecoveryRead {
  try {
    const serialized = sessionStorage.getItem(storageKey(projectId, elementKind, targetId))
    if (serialized === null) return { status: 'none' }
    return {
      status: 'ready',
      marker: parseMarker(JSON.parse(serialized) as unknown, projectId, elementKind, targetId),
    }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Synchronously write and read back the exact marker before any exception-release POST.
 * @param marker - Recovery marker to persist or clear.
 * @returns Whether the marker was stored successfully.
 */
export function writeReferenceRightsExceptionReleaseRecoveryMarker(
  marker: ReferenceRightsExceptionReleaseRecoveryMarker,
): boolean {
  try {
    const validated = parseMarker(marker, marker.projectId, marker.elementKind, marker.targetId)
    const serialized = JSON.stringify(validated)
    const key = storageKey(marker.projectId, marker.elementKind, marker.targetId)
    sessionStorage.setItem(key, serialized)
    const stored = sessionStorage.getItem(key)
    if (stored !== serialized) return false
    return sameMarker(
      parseMarker(JSON.parse(stored) as unknown, marker.projectId, marker.elementKind, marker.targetId),
      marker,
    )
  } catch {
    return false
  }
}

/**
 * Clear only the still-identical marker after receipt and authoritative feed reconciliation.
 * @param marker - Recovery marker to persist or clear.
 * @returns Whether a matching marker was removed.
 */
export function clearReferenceRightsExceptionReleaseRecoveryMarker(
  marker: ReferenceRightsExceptionReleaseRecoveryMarker,
): boolean {
  try {
    const key = storageKey(marker.projectId, marker.elementKind, marker.targetId)
    const serialized = sessionStorage.getItem(key)
    if (serialized === null) return true
    const stored = parseMarker(
      JSON.parse(serialized) as unknown,
      marker.projectId,
      marker.elementKind,
      marker.targetId,
    )
    if (!sameMarker(stored, marker)) return false
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Discard only local recovery coordinates; it cannot undo a server-side release.
 * @param projectId - Project identifier in the recovery scope.
 * @param elementKind - Reference element kind in the recovery scope.
 * @param targetId - Target identifier in the recovery scope.
 * @returns Whether a matching marker was removed.
 */
export function discardReferenceRightsExceptionReleaseRecoveryMarker(
  projectId: string,
  elementKind: ReferenceRightsExceptionElementKind,
  targetId: string,
): boolean {
  try {
    const key = storageKey(projectId, elementKind, targetId)
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}
