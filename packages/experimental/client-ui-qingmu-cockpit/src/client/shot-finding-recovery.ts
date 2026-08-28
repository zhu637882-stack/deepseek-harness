import { digestShotFinding, type ShotFindingRecoveryMarker } from './shot-finding-contract.ts'
import type { YimengSelectedVideoReviewRequest } from './contracts.ts'

const KEYS = ['schema', 'projectId', 'episodeId', 'frameId', 'expectedSubjectSha256', 'idempotencyKey',
  'findingSha256', 'methodProjectionSha256'] as const
type Scope = YimengSelectedVideoReviewRequest

/** A broken local marker blocks another POST until an explicit local discard. */
export type ShotFindingRecoveryRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: ShotFindingRecoveryMarker }
  | { readonly status: 'invalid'; readonly serialized: string | null }

function storageKey(scope: Scope) {
  return ['qingmu:shot-finding-recovery:v1', scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}
function parse(value: unknown, scope: Scope): ShotFindingRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Finding marker')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(item, key))
    || item.schema !== 'qingmu.shot-finding-recovery-marker.v1'
    || item.projectId !== scope.projectId || item.episodeId !== scope.episodeId || item.frameId !== scope.frameId
    || [item.projectId, item.episodeId, item.frameId, item.idempotencyKey].some(id => typeof id !== 'string'
      || !id.isWellFormed() || id.trim() === '' || id !== id.trim() || Array.from(id).length > 256 || /[\u0000\r\n]/.test(id))
    || [item.expectedSubjectSha256, item.findingSha256, item.methodProjectionSha256]
      .some(sha => typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha))) throw new Error('Invalid Finding marker')
  if (typeof item.idempotencyKey !== 'string' || Array.from(item.idempotencyKey).length < 8
    || Array.from(item.idempotencyKey).length > 200) throw new Error('Invalid Finding idempotency key')
  return item as unknown as ShotFindingRecoveryMarker
}
function same(left: ShotFindingRecoveryMarker, right: ShotFindingRecoveryMarker) {
  return KEYS.every(key => left[key] === right[key])
}

/**
 * Deterministic for the exact intent; reloading cannot silently mint a new duplicate command.
 * @param input - Inputs used to create the recovery marker.
 * @returns Recovery marker bound to the requested operation.
 */
export async function createShotFindingMarker(
  input: Omit<ShotFindingRecoveryMarker, 'schema' | 'idempotencyKey'>,
): Promise<ShotFindingRecoveryMarker> {
  const coordinates = { schema: 'qingmu.shot-finding-recovery-marker.v1' as const, ...input }
  const marker = { ...coordinates, idempotencyKey: `qingmu:shot-finding:v1:${await digestShotFinding(coordinates)}` }
  return parse(marker, input)
}

/**
 * Read only this tab's exact Shot marker. No network calls or automatic commands.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readShotFindingMarker(scope: Scope): ShotFindingRecoveryRead {
  let serialized: string | null = null
  try {
    serialized = sessionStorage.getItem(storageKey(scope))
    return serialized === null ? { status: 'none' } : { status: 'ready', marker: parse(JSON.parse(serialized) as unknown, scope) }
  } catch { return { status: 'invalid', serialized } }
}

/**
 * Persist and read back before POST, without overwriting a different unresolved intent.
 * @param marker - Recovery marker to persist or clear.
 * @returns Whether the marker was stored successfully.
 */
export function writeShotFindingMarker(marker: ShotFindingRecoveryMarker): boolean {
  try {
    parse(marker, marker)
    const previous = readShotFindingMarker(marker)
    if (previous.status === 'invalid' || (previous.status === 'ready' && !same(previous.marker, marker))) return false
    sessionStorage.setItem(storageKey(marker), JSON.stringify(marker))
    const stored = readShotFindingMarker(marker)
    return stored.status === 'ready' && same(stored.marker, marker)
  } catch { return false }
}

/**
 * Compare-and-clear: neither a late receipt nor a stale discard can erase another intent.
 * @param scope - Recovery or approval scope.
 * @param expected - Expected marker used for compare-and-clear behavior.
 * @returns Whether a matching marker was removed.
 */
export function clearShotFindingMarker(scope: Scope, expected: ShotFindingRecoveryRead): boolean {
  try {
    const current = readShotFindingMarker(scope)
    if (current.status === 'none') return true
    const matches = current.status === 'ready' && expected.status === 'ready' ? same(current.marker, expected.marker)
      : current.status === 'invalid' && expected.status === 'invalid' && current.serialized !== null
        && current.serialized === expected.serialized
    if (!matches) return false
    sessionStorage.removeItem(storageKey(scope))
    return sessionStorage.getItem(storageKey(scope)) === null
  } catch { return false }
}
