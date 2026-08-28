import type { YimengRecordReworkRouteRequest } from './contracts.ts'
import { digestShotFinding } from './shot-finding-contract.ts'

const MARKER_KEYS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'findingId', 'expectedSubjectSha256',
  'expectedRouteRevision', 'expectedRouteSha256', 'idempotencyKey',
] as const

type Scope = Pick<YimengRecordReworkRouteRequest, 'projectId' | 'episodeId' | 'frameId' | 'findingId'>

/** Original exact-CAS route intent retained before the single POST. */
export interface ReworkRouteRecoveryMarker extends YimengRecordReworkRouteRequest {
  readonly schema: 'qingmu.rework-route-recovery-marker.v1'
}

/** Corrupt local state blocks a second POST until the operator explicitly discards only that marker. */
export type ReworkRouteRecoveryRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: ReworkRouteRecoveryMarker }
  | { readonly status: 'invalid'; readonly serialized: string | null }

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value !== '' && value === value.trim()
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/.test(value)
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
function storageKey(scope: Scope) {
  return ['qingmu:rework-route-recovery:v1', scope.projectId, scope.episodeId, scope.frameId, scope.findingId]
    .map(encodeURIComponent).join(':')
}
function parse(value: unknown, scope: Scope): ReworkRouteRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid route marker')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== MARKER_KEYS.length || MARKER_KEYS.some(key => !Object.hasOwn(item, key))
    || item.schema !== 'qingmu.rework-route-recovery-marker.v1'
    || item.projectId !== scope.projectId || item.episodeId !== scope.episodeId
    || item.frameId !== scope.frameId || item.findingId !== scope.findingId
    || ![item.projectId, item.episodeId, item.frameId, item.findingId].every(identifier)
    || !sha(item.expectedSubjectSha256)
    || !Number.isSafeInteger(item.expectedRouteRevision) || (item.expectedRouteRevision as number) < 0
    || (item.expectedRouteRevision as number) >= Number.MAX_SAFE_INTEGER
    || ((item.expectedRouteRevision as number) === 0 ? item.expectedRouteSha256 !== null : !sha(item.expectedRouteSha256))
    || typeof item.idempotencyKey !== 'string'
    || !/^qingmu:rework-route:v1:[0-9a-f]{64}$/.test(item.idempotencyKey)) throw new Error('Invalid route marker')
  return item as unknown as ReworkRouteRecoveryMarker
}
function same(left: ReworkRouteRecoveryMarker, right: ReworkRouteRecoveryMarker) {
  return MARKER_KEYS.every(key => left[key] === right[key])
}

/** Derive one stable idempotency key from the original subject and route-head CAS. */
export async function createReworkRouteMarker(
  input: Omit<ReworkRouteRecoveryMarker, 'schema' | 'idempotencyKey'>,
): Promise<ReworkRouteRecoveryMarker> {
  const coordinates = { schema: 'qingmu.rework-route-recovery-marker.v1' as const, ...input }
  return parse({
    ...coordinates,
    idempotencyKey: `qingmu:rework-route:v1:${await digestShotFinding(coordinates)}`,
  }, input)
}

/** Read only this tab's marker; this performs no network call. */
export function readReworkRouteMarker(scope: Scope): ReworkRouteRecoveryRead {
  let serialized: string | null = null
  try {
    serialized = sessionStorage.getItem(storageKey(scope))
    return serialized === null
      ? { status: 'none' }
      : { status: 'ready', marker: parse(JSON.parse(serialized) as unknown, scope) }
  } catch { return { status: 'invalid', serialized } }
}

/** Persist and synchronously read back before POST, without replacing another unresolved intent. */
export function writeReworkRouteMarker(marker: ReworkRouteRecoveryMarker): boolean {
  try {
    parse(marker, marker)
    const previous = readReworkRouteMarker(marker)
    if (previous.status === 'invalid' || (previous.status === 'ready' && !same(previous.marker, marker))) return false
    sessionStorage.setItem(storageKey(marker), JSON.stringify(marker))
    const stored = readReworkRouteMarker(marker)
    return stored.status === 'ready' && same(stored.marker, marker)
  } catch { return false }
}

/** Compare-and-clear so a late result cannot erase a replacement intent. */
export function clearReworkRouteMarker(scope: Scope, expected: ReworkRouteRecoveryRead): boolean {
  try {
    const current = readReworkRouteMarker(scope)
    if (current.status === 'none') return true
    const matches = current.status === 'ready' && expected.status === 'ready'
      ? same(current.marker, expected.marker)
      : current.status === 'invalid' && expected.status === 'invalid' && current.serialized !== null
        && current.serialized === expected.serialized
    if (!matches) return false
    sessionStorage.removeItem(storageKey(scope))
    return sessionStorage.getItem(storageKey(scope)) === null
  } catch { return false }
}
