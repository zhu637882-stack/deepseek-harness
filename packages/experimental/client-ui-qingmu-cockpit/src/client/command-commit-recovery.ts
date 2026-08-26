const MARKER_SCHEMA = 'qingmu.command-commit-recovery-marker.v3'
const STORAGE_PREFIX = 'qingmu:command-commit-recovery:v3'
const LEGACY_STORAGE_PREFIX = 'qingmu:command-commit-recovery:v2'
const SHA256 = /^[0-9a-f]{64}$/
const ELEMENT_KINDS = ['actor', 'scene', 'prop'] as const
const VISUAL_OPERATIONS = ['replaceVisualIdentity', 'replaceVisualPrompt'] as const
const REFERENCE_OPERATIONS = ['selectReferenceAsset', 'requestReferenceRegeneration'] as const
const MARKER_KEYS = [
  'schema',
  'projectId',
  'targetType',
  'elementKind',
  'targetId',
  'changeSetId',
  'baseRevision',
  'baseSnapshotSha256',
  'payloadSha256',
  'idempotencyKey',
  'operation',
] as const
const REFERENCE_MARKER_KEYS = [
  ...MARKER_KEYS,
  'candidateAssetId',
  'candidateAssetSha256',
] as const

/** Element kinds supported by the subject-scoped commit-recovery marker. */
export type CommandElementKind = typeof ELEMENT_KINDS[number]

/** Visual-profile operations that can be recovered without resubmitting their commit. */
export type CommandVisualOperation = typeof VISUAL_OPERATIONS[number]

/** Reference-asset operations that can be recovered without resubmitting their commit. */
export type CommandReferenceOperation = typeof REFERENCE_OPERATIONS[number]

/** Every element-profile operation bound into a commit-recovery marker. */
export type CommandElementOperation = CommandVisualOperation | CommandReferenceOperation

interface CommandCommitRecoveryMarkerBase {
  readonly schema: typeof MARKER_SCHEMA
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly elementKind: CommandElementKind
  readonly targetId: string
  readonly changeSetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
}

/** Visual-profile commit lineage bound to its exact operation. */
export interface CommandVisualCommitRecoveryMarker extends CommandCommitRecoveryMarkerBase {
  readonly operation: CommandVisualOperation
}

/** Reference-asset commit lineage bound to its exact operation and candidate. */
export interface CommandReferenceCommitRecoveryMarker extends CommandCommitRecoveryMarkerBase {
  readonly operation: CommandReferenceOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
}

/** Non-secret lineage needed to recover an element-profile commit without resubmitting it. */
export type CommandCommitRecoveryMarker =
  | CommandVisualCommitRecoveryMarker
  | CommandReferenceCommitRecoveryMarker

type WithoutSchema<T> = T extends unknown ? Omit<T, 'schema'> : never

/** Caller-supplied lineage before the recovery-marker schema is attached. */
export type CommandCommitRecoveryMarkerInput = WithoutSchema<CommandCommitRecoveryMarker>

/** Result of reading and validating one subject-scoped recovery marker. */
export type CommandCommitRecoveryMarkerRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: CommandCommitRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

function storageKey(
  prefix: typeof STORAGE_PREFIX | typeof LEGACY_STORAGE_PREFIX,
  projectId: string,
  elementKind: CommandElementKind,
  targetId: string,
): string {
  return [
    prefix,
    encodeURIComponent(projectId),
    'element_profile',
    encodeURIComponent(elementKind),
    encodeURIComponent(targetId),
  ].join(':')
}

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000\r\n]/.test(value)
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
  ) {
    throw new Error('当前浏览器不支持安全幂等键生成')
  }
  return cryptoValue.subtle as SubtleCrypto
}

/**
 * Build a bounded, deterministic key even when the upstream ChangeSet ID uses its full legal length.
 * @param changeSetId - Yimeng-owned ChangeSet identifier.
 * @param payloadSha256 - Canonical proposed-payload digest.
 * @returns a deterministic element-profile commit idempotency key.
 */
export async function deriveCommandIdempotencyKey(
  changeSetId: string,
  payloadSha256: string,
): Promise<string> {
  if (!isIdentifier(changeSetId)) throw new Error('ChangeSet ID 无效，无法生成幂等键')
  if (!SHA256.test(payloadSha256)) throw new Error('Payload SHA-256 无效，无法生成幂等键')
  const digest = await getSubtleCrypto().digest('SHA-256', new TextEncoder().encode(changeSetId))
  const changeSetSha256 = [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
  return `qingmu:element:v3:${changeSetSha256}:${payloadSha256}`
}

function isElementKind(value: unknown): value is CommandElementKind {
  return ELEMENT_KINDS.includes(value as CommandElementKind)
}

function isVisualOperation(value: unknown): value is CommandVisualOperation {
  return VISUAL_OPERATIONS.includes(value as CommandVisualOperation)
}

function isReferenceOperation(value: unknown): value is CommandReferenceOperation {
  return REFERENCE_OPERATIONS.includes(value as CommandReferenceOperation)
}

function isElementOperation(value: unknown): value is CommandElementOperation {
  return isVisualOperation(value) || isReferenceOperation(value)
}

function assertOperationMatchesElementKind(
  operation: CommandElementOperation,
  elementKind: CommandElementKind,
): void {
  const matches = operation === 'replaceVisualIdentity'
    ? elementKind === 'actor'
    : operation === 'replaceVisualPrompt'
      ? elementKind !== 'actor'
      : true
  if (!matches) throw new Error('恢复标记操作与 Element Kind 不匹配')
}

function parseMarker(
  value: unknown,
  projectId: string,
  elementKind: CommandElementKind,
  targetId: string,
): CommandCommitRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('恢复标记不是对象')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [...(isReferenceOperation(record.operation) ? REFERENCE_MARKER_KEYS : MARKER_KEYS)].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('恢复标记字段不符合合同')
  }
  if (record.schema !== MARKER_SCHEMA) throw new Error('恢复标记合同不匹配')
  if (!isIdentifier(record.projectId) || record.projectId !== projectId) throw new Error('恢复标记 Project ID 不匹配')
  if (record.targetType !== 'element_profile') throw new Error('恢复标记 Target Type 不匹配')
  if (!isElementKind(record.elementKind) || record.elementKind !== elementKind) throw new Error('恢复标记 Element Kind 不匹配')
  if (!isIdentifier(record.targetId) || record.targetId !== targetId) throw new Error('恢复标记 Target ID 不匹配')
  if (!isElementOperation(record.operation)) throw new Error('恢复标记操作无效')
  assertOperationMatchesElementKind(record.operation, record.elementKind)
  if (!isIdentifier(record.changeSetId)) throw new Error('恢复标记 ChangeSet ID 无效')
  if (!Number.isSafeInteger(record.baseRevision) || (record.baseRevision as number) < 0) {
    throw new Error('恢复标记基线修订号无效')
  }
  if (typeof record.baseSnapshotSha256 !== 'string' || !SHA256.test(record.baseSnapshotSha256)) {
    throw new Error('恢复标记基础快照 SHA-256 无效')
  }
  if (typeof record.payloadSha256 !== 'string' || !SHA256.test(record.payloadSha256)) {
    throw new Error('恢复标记 Payload SHA-256 无效')
  }
  if (!isIdentifier(record.idempotencyKey, 200) || record.idempotencyKey.length < 8) {
    throw new Error('恢复标记幂等键无效')
  }
  const base: CommandCommitRecoveryMarkerBase = {
    schema: MARKER_SCHEMA,
    projectId: record.projectId,
    targetType: 'element_profile',
    elementKind: record.elementKind,
    targetId: record.targetId,
    changeSetId: record.changeSetId,
    baseRevision: record.baseRevision as number,
    baseSnapshotSha256: record.baseSnapshotSha256,
    payloadSha256: record.payloadSha256,
    idempotencyKey: record.idempotencyKey,
  }
  if (!isReferenceOperation(record.operation)) return { ...base, operation: record.operation }
  if (!isIdentifier(record.candidateAssetId)) throw new Error('恢复标记候选资产 ID 无效')
  if (typeof record.candidateAssetSha256 !== 'string' || !SHA256.test(record.candidateAssetSha256)) {
    throw new Error('恢复标记候选资产 SHA-256 无效')
  }
  return {
    ...base,
    operation: record.operation,
    candidateAssetId: record.candidateAssetId,
    candidateAssetSha256: record.candidateAssetSha256,
  }
}

function sameMarker(left: CommandCommitRecoveryMarker, right: CommandCommitRecoveryMarker): boolean {
  const keys = isReferenceOperation(left.operation) ? REFERENCE_MARKER_KEYS : MARKER_KEYS
  const leftRecord = left as unknown as Record<string, unknown>
  const rightRecord = right as unknown as Record<string, unknown>
  return keys.every(key => leftRecord[key] === rightRecord[key])
}

/**
 * Validate caller lineage and attach the fixed recovery-marker schema.
 * @param input - non-secret element commit lineage.
 * @returns an exact marker ready for synchronous storage.
 */
export function createCommandCommitRecoveryMarker(
  input: CommandCommitRecoveryMarkerInput,
): CommandCommitRecoveryMarker {
  return parseMarker(
    { schema: MARKER_SCHEMA, ...input },
    input.projectId,
    input.elementKind,
    input.targetId,
  )
}

/**
 * Read and validate the marker for one authoritative element subject.
 * @param projectId - authoritative project identifier.
 * @param elementKind - actor, scene, or prop subject kind.
 * @param targetId - authoritative element identifier.
 * @returns the absent, valid, or invalid marker state.
 */
export function readCommandCommitRecoveryMarker(
  projectId: string,
  elementKind: CommandElementKind,
  targetId: string,
): CommandCommitRecoveryMarkerRead {
  try {
    const legacy = sessionStorage.getItem(storageKey(LEGACY_STORAGE_PREFIX, projectId, elementKind, targetId))
    if (legacy !== null) {
      return { status: 'invalid', error: '检测到旧版恢复标记，必须先丢弃后才能继续' }
    }
    const serialized = sessionStorage.getItem(storageKey(STORAGE_PREFIX, projectId, elementKind, targetId))
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
 * Persist and synchronously read back the exact marker before issuing the commit POST.
 * @param marker - fully validated non-secret commit lineage.
 * @returns whether storage contains the exact marker.
 */
export function writeCommandCommitRecoveryMarker(marker: CommandCommitRecoveryMarker): boolean {
  try {
    const legacyKey = storageKey(LEGACY_STORAGE_PREFIX, marker.projectId, marker.elementKind, marker.targetId)
    if (sessionStorage.getItem(legacyKey) !== null) return false
    const validated = parseMarker(marker, marker.projectId, marker.elementKind, marker.targetId)
    const serialized = JSON.stringify(validated)
    const key = storageKey(STORAGE_PREFIX, marker.projectId, marker.elementKind, marker.targetId)
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
 * Clear only the still-identical marker after receipt lineage and authoritative reread succeed.
 * @param marker - exact lineage that was proven by recovery.
 * @returns whether the identical marker is now absent.
 */
export function clearCommandCommitRecoveryMarker(marker: CommandCommitRecoveryMarker): boolean {
  try {
    const legacyKey = storageKey(LEGACY_STORAGE_PREFIX, marker.projectId, marker.elementKind, marker.targetId)
    if (sessionStorage.getItem(legacyKey) !== null) return false
    const key = storageKey(STORAGE_PREFIX, marker.projectId, marker.elementKind, marker.targetId)
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
 * Discard only this element's local marker; it never undoes a server-side commit.
 * @param projectId - authoritative project identifier.
 * @param elementKind - actor, scene, or prop subject kind.
 * @param targetId - authoritative element identifier.
 * @returns whether the subject marker is now absent.
 */
export function discardCommandCommitRecoveryMarker(
  projectId: string,
  elementKind: CommandElementKind,
  targetId: string,
): boolean {
  try {
    const currentKey = storageKey(STORAGE_PREFIX, projectId, elementKind, targetId)
    const legacyKey = storageKey(LEGACY_STORAGE_PREFIX, projectId, elementKind, targetId)
    sessionStorage.removeItem(currentKey)
    sessionStorage.removeItem(legacyKey)
    return sessionStorage.getItem(currentKey) === null && sessionStorage.getItem(legacyKey) === null
  } catch {
    return false
  }
}
