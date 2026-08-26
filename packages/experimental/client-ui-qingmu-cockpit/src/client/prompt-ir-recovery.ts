import type {
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrSelectionRequest,
} from './contracts.ts'

const EDIT_SCHEMA = 'qingmu.prompt-ir-edit-recovery-marker.v1'
const SELECTION_SCHEMA = 'qingmu.prompt-ir-selection-recovery-marker.v1'
const EDIT_STORAGE_PREFIX = 'qingmu:prompt-ir-edit-recovery:v1'
const SELECTION_STORAGE_PREFIX = 'qingmu:prompt-ir-selection-recovery:v1'
const SHA256 = /^[0-9a-f]{64}$/

const EDIT_KEYS = [
  'schema',
  'projectId',
  'episodeId',
  'storyboardRevisionId',
  'frameId',
  'targetType',
  'targetId',
  'changeSetId',
  'basePromptIrId',
  'baseRevision',
  'baseSnapshotSha256',
  'idempotencyKey',
  'expectedPayloadSha256',
] as const

const SELECTION_KEYS = [
  'schema',
  'projectId',
  'episodeId',
  'storyboardRevisionId',
  'frameId',
  'draftPromptIrId',
  'draftVersion',
  'draftContentSha256',
  'idempotencyKey',
] as const

/** Exact frame coordinates used to isolate PromptIR recovery markers in one browser tab. */
export interface PromptIrRecoveryCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}

/** Selection identity known before either the submit or recovery GET starts. */
export interface PromptIrSelectionIdentity extends PromptIrRecoveryCoordinates {
  readonly draftPromptIrId: string
  readonly draftVersion: number
  readonly draftContentSha256: string
}

/** Non-secret edit-commit lineage stored before its POST starts. */
export interface PromptIrEditRecoveryMarker extends YimengRecoverPromptIrEditCommitRequest {
  readonly schema: typeof EDIT_SCHEMA
}

/** Non-secret selection lineage stored before its separate POST starts. */
export interface PromptIrSelectionRecoveryMarker extends YimengRecoverPromptIrSelectionRequest {
  readonly schema: typeof SELECTION_SCHEMA
}

/** Strict same-tab state for one PromptIR edit-commit marker. */
export type PromptIrEditRecoveryMarkerRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: PromptIrEditRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

/** Strict same-tab state for one PromptIR selection marker. */
export type PromptIrSelectionRecoveryMarkerRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: PromptIrSelectionRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !/[\u0000\r\n]/.test(value)
}

function requireCoordinates(record: Record<string, unknown>, expected: PromptIrRecoveryCoordinates): void {
  if (!isIdentifier(record.projectId) || record.projectId !== expected.projectId) {
    throw new Error('恢复标记 Project ID 不匹配')
  }
  if (!isIdentifier(record.episodeId) || record.episodeId !== expected.episodeId) {
    throw new Error('恢复标记 Episode ID 不匹配')
  }
  if (!isIdentifier(record.storyboardRevisionId) || record.storyboardRevisionId !== expected.storyboardRevisionId) {
    throw new Error('恢复标记 Storyboard Revision ID 不匹配')
  }
  if (!isIdentifier(record.frameId) || record.frameId !== expected.frameId) {
    throw new Error('恢复标记 Frame ID 不匹配')
  }
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record).sort()
  const sortedExpected = [...expected].sort()
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    throw new Error('恢复标记字段不符合合同')
  }
}

function requireIdempotencyKey(value: unknown): asserts value is string {
  if (!isIdentifier(value, 200) || value.length < 8) throw new Error('恢复标记幂等键无效')
}

function requireSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`恢复标记 ${field} SHA-256 无效`)
}

function parseEditMarker(value: unknown, expected: PromptIrRecoveryCoordinates): PromptIrEditRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('恢复标记不是对象')
  const record = value as Record<string, unknown>
  requireExactKeys(record, EDIT_KEYS)
  if (record.schema !== EDIT_SCHEMA) throw new Error('恢复标记合同不匹配')
  requireCoordinates(record, expected)
  if (record.targetType !== 'prompt_ir') throw new Error('恢复标记 Target Type 不匹配')
  const expectedTargetId = `${expected.storyboardRevisionId}:${expected.frameId}`
  if (!isIdentifier(record.targetId) || record.targetId !== expectedTargetId) throw new Error('恢复标记 Target ID 不匹配')
  if (!isIdentifier(record.changeSetId)) throw new Error('恢复标记 ChangeSet ID 无效')
  if (!isIdentifier(record.basePromptIrId)) throw new Error('恢复标记基础 PromptIR ID 无效')
  if (!Number.isSafeInteger(record.baseRevision) || (record.baseRevision as number) < 1) {
    throw new Error('恢复标记基础 PromptIR 版本无效')
  }
  requireSha256(record.baseSnapshotSha256, '基础快照')
  requireIdempotencyKey(record.idempotencyKey)
  requireSha256(record.expectedPayloadSha256, 'Payload')
  return {
    schema: EDIT_SCHEMA,
    projectId: record.projectId as string,
    episodeId: record.episodeId as string,
    storyboardRevisionId: record.storyboardRevisionId as string,
    frameId: record.frameId as string,
    targetType: 'prompt_ir',
    targetId: record.targetId,
    changeSetId: record.changeSetId,
    basePromptIrId: record.basePromptIrId,
    baseRevision: record.baseRevision as number,
    baseSnapshotSha256: record.baseSnapshotSha256,
    idempotencyKey: record.idempotencyKey,
    expectedPayloadSha256: record.expectedPayloadSha256,
  }
}

function parseSelectionMarker(value: unknown, expected: PromptIrRecoveryCoordinates): PromptIrSelectionRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('恢复标记不是对象')
  const record = value as Record<string, unknown>
  requireExactKeys(record, SELECTION_KEYS)
  if (record.schema !== SELECTION_SCHEMA) throw new Error('恢复标记合同不匹配')
  requireCoordinates(record, expected)
  if (!isIdentifier(record.draftPromptIrId)) throw new Error('恢复标记 Draft PromptIR ID 无效')
  if (!Number.isSafeInteger(record.draftVersion) || (record.draftVersion as number) < 1) {
    throw new Error('恢复标记 Draft PromptIR 版本无效')
  }
  requireSha256(record.draftContentSha256, 'Draft 内容')
  requireIdempotencyKey(record.idempotencyKey)
  return {
    schema: SELECTION_SCHEMA,
    projectId: record.projectId as string,
    episodeId: record.episodeId as string,
    storyboardRevisionId: record.storyboardRevisionId as string,
    frameId: record.frameId as string,
    draftPromptIrId: record.draftPromptIrId,
    draftVersion: record.draftVersion as number,
    draftContentSha256: record.draftContentSha256,
    idempotencyKey: record.idempotencyKey,
  }
}

function storageKey(prefix: string, coordinates: PromptIrRecoveryCoordinates): string {
  return [
    prefix,
    encodeURIComponent(coordinates.projectId),
    encodeURIComponent(coordinates.episodeId),
    encodeURIComponent(coordinates.storyboardRevisionId),
    encodeURIComponent(coordinates.frameId),
  ].join(':')
}

function sameMarker(left: object, right: object, keys: readonly string[]): boolean {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  return keys.every(key => leftRecord[key] === rightRecord[key])
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

async function sha256(value: string): Promise<string> {
  const digest = await getSubtleCrypto().digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Derive a bounded deterministic key for one exact PromptIR edit ChangeSet. */
export async function derivePromptIrEditIdempotencyKey(changeSetId: string, payloadSha256: string): Promise<string> {
  if (!isIdentifier(changeSetId)) throw new Error('ChangeSet ID 无效，无法生成幂等键')
  if (!SHA256.test(payloadSha256)) throw new Error('Payload SHA-256 无效，无法生成幂等键')
  return `qingmu:prompt-ir:edit:v1:${await sha256(changeSetId)}:${payloadSha256}`
}

/** Derive a bounded deterministic key from pre-submit coordinates for one PromptIR selection. */
export async function derivePromptIrSelectionIdempotencyKey(
  request: PromptIrSelectionIdentity,
): Promise<string> {
  const parsed = parseSelectionMarker(
    { schema: SELECTION_SCHEMA, ...request, idempotencyKey: 'validation-key' },
    request,
  )
  const identity = JSON.stringify([
    parsed.projectId,
    parsed.episodeId,
    parsed.storyboardRevisionId,
    parsed.frameId,
    parsed.draftPromptIrId,
    parsed.draftVersion,
    parsed.draftContentSha256,
  ])
  return `qingmu:prompt-ir:select:v1:${await sha256(identity)}`
}

/** Validate and attach the edit recovery marker schema before storage. */
export function createPromptIrEditRecoveryMarker(
  request: YimengRecoverPromptIrEditCommitRequest,
): PromptIrEditRecoveryMarker {
  return parseEditMarker({ schema: EDIT_SCHEMA, ...request }, request)
}

/** Validate and attach the selection recovery marker schema before storage. */
export function createPromptIrSelectionRecoveryMarker(
  request: YimengRecoverPromptIrSelectionRequest,
): PromptIrSelectionRecoveryMarker {
  return parseSelectionMarker({ schema: SELECTION_SCHEMA, ...request }, request)
}

/** Read only the edit marker for this exact storyboard frame. */
export function readPromptIrEditRecoveryMarker(
  coordinates: PromptIrRecoveryCoordinates,
): PromptIrEditRecoveryMarkerRead {
  try {
    const serialized = sessionStorage.getItem(storageKey(EDIT_STORAGE_PREFIX, coordinates))
    if (serialized === null) return { status: 'none' }
    return { status: 'ready', marker: parseEditMarker(JSON.parse(serialized) as unknown, coordinates) }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Read only the selection marker for this exact storyboard frame. */
export function readPromptIrSelectionRecoveryMarker(
  coordinates: PromptIrRecoveryCoordinates,
): PromptIrSelectionRecoveryMarkerRead {
  try {
    const serialized = sessionStorage.getItem(storageKey(SELECTION_STORAGE_PREFIX, coordinates))
    if (serialized === null) return { status: 'none' }
    return { status: 'ready', marker: parseSelectionMarker(JSON.parse(serialized) as unknown, coordinates) }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Persist and synchronously verify an edit marker before the edit POST. */
export function writePromptIrEditRecoveryMarker(marker: PromptIrEditRecoveryMarker): boolean {
  try {
    const validated = parseEditMarker(marker, marker)
    const key = storageKey(EDIT_STORAGE_PREFIX, marker)
    const serialized = JSON.stringify(validated)
    const existing = sessionStorage.getItem(key)
    if (existing !== null) return sameMarker(parseEditMarker(JSON.parse(existing) as unknown, marker), marker, EDIT_KEYS)
    sessionStorage.setItem(key, serialized)
    const stored = sessionStorage.getItem(key)
    return stored === serialized
      && sameMarker(parseEditMarker(JSON.parse(stored) as unknown, marker), marker, EDIT_KEYS)
  } catch {
    return false
  }
}

/** Persist and synchronously verify a selection marker before the separate selection POST. */
export function writePromptIrSelectionRecoveryMarker(marker: PromptIrSelectionRecoveryMarker): boolean {
  try {
    const validated = parseSelectionMarker(marker, marker)
    const key = storageKey(SELECTION_STORAGE_PREFIX, marker)
    const serialized = JSON.stringify(validated)
    const existing = sessionStorage.getItem(key)
    if (existing !== null) {
      return sameMarker(parseSelectionMarker(JSON.parse(existing) as unknown, marker), marker, SELECTION_KEYS)
    }
    sessionStorage.setItem(key, serialized)
    const stored = sessionStorage.getItem(key)
    return stored === serialized
      && sameMarker(parseSelectionMarker(JSON.parse(stored) as unknown, marker), marker, SELECTION_KEYS)
  } catch {
    return false
  }
}

/** Clear only the identical edit marker after the separately selected Ready reread is verified. */
export function clearPromptIrEditRecoveryMarker(marker: PromptIrEditRecoveryMarker): boolean {
  try {
    const key = storageKey(EDIT_STORAGE_PREFIX, marker)
    const serialized = sessionStorage.getItem(key)
    if (serialized === null) return true
    const stored = parseEditMarker(JSON.parse(serialized) as unknown, marker)
    if (!sameMarker(stored, marker, EDIT_KEYS)) return false
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/** Clear only the identical selection marker after the new Ready read is verified. */
export function clearPromptIrSelectionRecoveryMarker(marker: PromptIrSelectionRecoveryMarker): boolean {
  try {
    const key = storageKey(SELECTION_STORAGE_PREFIX, marker)
    const serialized = sessionStorage.getItem(key)
    if (serialized === null) return true
    const stored = parseSelectionMarker(JSON.parse(serialized) as unknown, marker)
    if (!sameMarker(stored, marker, SELECTION_KEYS)) return false
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}
