import type { YimengSelectTakeVersionRequest, YimengTakeVersionRequest } from './contracts.ts'

const KEYS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedStackSha256', 'expectedSelectedTakeId',
  'candidateTakeId', 'candidateVersionOrdinal', 'candidateOutputSha256', 'idempotencyKey',
] as const

/**
 * Browser recovery marker for an unconfirmed Take-version selection.
 */
export interface TakeVersionSelectionRecoveryMarker extends YimengSelectTakeVersionRequest {
  readonly schema: 'qingmu.take-version-selection-recovery-marker.v1'
}

/**
 * Result of reading a Take-version selection recovery marker.
 */
export type TakeVersionSelectionRecoveryRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: TakeVersionSelectionRecoveryMarker }
  | { readonly status: 'invalid'; readonly serialized: string | null }

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value !== '' && value === pythonStrip(value)
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/u.test(value)
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function storageKey(scope: YimengTakeVersionRequest): string {
  return ['qingmu:take-version-selection-recovery:v1', scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}

function parse(value: unknown, scope: YimengTakeVersionRequest): TakeVersionSelectionRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Take marker')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(item, key))
    || item.schema !== 'qingmu.take-version-selection-recovery-marker.v1'
    || item.projectId !== scope.projectId || item.episodeId !== scope.episodeId || item.frameId !== scope.frameId
    || !validId(item.projectId) || !validId(item.episodeId) || !validId(item.frameId)
    || !validSha(item.expectedStackSha256) || !validSha(item.candidateOutputSha256)
    || (item.expectedSelectedTakeId !== null && !validId(item.expectedSelectedTakeId))
    || !validId(item.candidateTakeId)
    || typeof item.candidateVersionOrdinal !== 'number' || !Number.isSafeInteger(item.candidateVersionOrdinal)
    || item.candidateVersionOrdinal < 1 || !validId(item.idempotencyKey)
    || Array.from(item.idempotencyKey).length < 8 || Array.from(item.idempotencyKey).length > 200) {
    throw new Error('Invalid Take marker')
  }
  return item as unknown as TakeVersionSelectionRecoveryMarker
}

function same(left: TakeVersionSelectionRecoveryMarker, right: TakeVersionSelectionRecoveryMarker): boolean {
  return KEYS.every(key => left[key] === right[key])
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Deterministic for one exact selection intent; it contains no token, actor claim, or media URL.
 * @param input - Inputs used to create the recovery marker.
 * @returns Recovery marker bound to the requested operation.
 */
export async function createTakeVersionSelectionMarker(
  input: Omit<YimengSelectTakeVersionRequest, 'idempotencyKey'>,
): Promise<TakeVersionSelectionRecoveryMarker> {
  const coordinates = {
    schema: 'qingmu.take-version-selection-recovery-marker.v1' as const,
    projectId: input.projectId,
    episodeId: input.episodeId,
    frameId: input.frameId,
    expectedStackSha256: input.expectedStackSha256,
    expectedSelectedTakeId: input.expectedSelectedTakeId,
    candidateTakeId: input.candidateTakeId,
    candidateVersionOrdinal: input.candidateVersionOrdinal,
    candidateOutputSha256: input.candidateOutputSha256,
  }
  const idempotencyKey = `qingmu:take-select:v1:${await sha256(JSON.stringify(coordinates))}`
  return parse({ ...coordinates, idempotencyKey }, input)
}

/**
 * Read only the unresolved marker for this exact Project / Episode / Shot.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readTakeVersionSelectionMarker(scope: YimengTakeVersionRequest): TakeVersionSelectionRecoveryRead {
  let serialized: string | null = null
  try {
    serialized = sessionStorage.getItem(storageKey(scope))
    return serialized === null
      ? { status: 'none' }
      : { status: 'ready', marker: parse(JSON.parse(serialized) as unknown, scope) }
  } catch {
    return { status: 'invalid', serialized }
  }
}

/**
 * Persist and read back before POST; never overwrite a different unresolved selection.
 * @param marker - Recovery marker to persist or clear.
 * @returns Whether the marker was stored successfully.
 */
export function writeTakeVersionSelectionMarker(marker: TakeVersionSelectionRecoveryMarker): boolean {
  try {
    parse(marker, marker)
    const previous = readTakeVersionSelectionMarker(marker)
    if (previous.status === 'invalid' || (previous.status === 'ready' && !same(previous.marker, marker))) return false
    sessionStorage.setItem(storageKey(marker), JSON.stringify(marker))
    const stored = readTakeVersionSelectionMarker(marker)
    return stored.status === 'ready' && same(stored.marker, marker)
  } catch {
    return false
  }
}

/**
 * Compare-and-clear so stale receipts and stale discard actions cannot erase a newer intent.
 * @param scope - Recovery or approval scope.
 * @param expected - Expected marker used for compare-and-clear behavior.
 * @returns Whether a matching marker was removed.
 */
export function clearTakeVersionSelectionMarker(
  scope: YimengTakeVersionRequest,
  expected: TakeVersionSelectionRecoveryRead,
): boolean {
  try {
    const current = readTakeVersionSelectionMarker(scope)
    if (current.status === 'none') return true
    const matches = current.status === 'ready' && expected.status === 'ready'
      ? same(current.marker, expected.marker)
      : current.status === 'invalid' && expected.status === 'invalid' && current.serialized !== null
        && current.serialized === expected.serialized
    if (!matches) return false
    sessionStorage.removeItem(storageKey(scope))
    return sessionStorage.getItem(storageKey(scope)) === null
  } catch {
    return false
  }
}
