/** Session-scoped original intent for E7-4 GET-only lifecycle receipt recovery. */
import type {
  YimengTakeApprovalLifecycleAction,
  YimengTransitionTakeApprovalLifecycleRequest,
} from './contracts.ts'

/** Exact non-secret original lifecycle intent stored until its receipt is confirmed. */
export interface TakeApprovalLifecycleRecoveryMarker
  extends YimengTransitionTakeApprovalLifecycleRequest {
  readonly schema: 'qingmu.take-approval-lifecycle-recovery-marker.v1'
}

type Scope = {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

const FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedSourceSnapshotSha256',
  'takeId', 'action', 'reason', 'idempotencyKey',
] as const
const ACTIONS = new Set<YimengTakeApprovalLifecycleAction>([
  'APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT',
])
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^qingmu:take-approval-lifecycle:v1:[0-9a-f]{64}$/u

/**
 * Apply Python-compatible edge-whitespace stripping to lifecycle text.
 * @param value - raw browser text.
 * @returns text with Python whitespace and information separators removed at both edges.
 */
export function pythonStripTakeApprovalLifecycleText(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && !/[\0\r\n]/u.test(value)
    && value === pythonStripTakeApprovalLifecycleText(value)
    && value !== '' && Array.from(value).length <= 256
}

function marker(value: unknown): value is TakeApprovalLifecycleRecoveryMarker {
  return exact(value, FIELDS)
    && value.schema === 'qingmu.take-approval-lifecycle-recovery-marker.v1'
    && identifier(value.projectId) && identifier(value.episodeId) && identifier(value.frameId)
    && identifier(value.takeId)
    && typeof value.expectedSourceSnapshotSha256 === 'string'
    && SHA256.test(value.expectedSourceSnapshotSha256)
    && typeof value.action === 'string'
    && ACTIONS.has(value.action as YimengTakeApprovalLifecycleAction)
    && typeof value.reason === 'string' && value.reason.isWellFormed() && !value.reason.includes('\0')
    && pythonStripTakeApprovalLifecycleText(value.reason) !== ''
    && Array.from(value.reason).length <= 8_000
    && typeof value.idempotencyKey === 'string' && IDEMPOTENCY_KEY.test(value.idempotencyKey)
}

/**
 * Derive the Shot-scoped session-storage key for one lifecycle marker.
 * @param scope - canonical project, episode, and frame coordinates.
 * @returns the encoded session-storage key.
 */
export function takeApprovalLifecycleRecoveryKey(scope: Scope): string {
  return ['qingmu:take-approval-lifecycle-recovery:v1', scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}

/**
 * Read and validate the exact lifecycle marker for one Shot.
 * @param scope - canonical project, episode, and frame coordinates.
 * @returns the valid marker, or `undefined` when absent or malformed.
 */
export function readTakeApprovalLifecycleRecoveryMarker(
  scope: Scope,
): TakeApprovalLifecycleRecoveryMarker | undefined {
  try {
    const serialized = globalThis.sessionStorage.getItem(takeApprovalLifecycleRecoveryKey(scope))
    if (serialized === null) return undefined
    const value: unknown = JSON.parse(serialized)
    if (!marker(value) || value.projectId !== scope.projectId || value.episodeId !== scope.episodeId
      || value.frameId !== scope.frameId) return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Report whether storage contains any marker at the lifecycle key.
 * @param scope - canonical project, episode, and frame coordinates.
 * @returns true for a present marker or an unreadable storage boundary.
 */
export function hasTakeApprovalLifecycleRecoveryMarker(scope: Scope): boolean {
  try {
    return globalThis.sessionStorage.getItem(takeApprovalLifecycleRecoveryKey(scope)) !== null
  } catch {
    return true
  }
}

/**
 * Persist a validated lifecycle marker without replacing an existing intent.
 * @param value - exact marker to persist and read back.
 * @returns true only when the stored value round-trips exactly.
 */
export function writeTakeApprovalLifecycleRecoveryMarker(
  value: TakeApprovalLifecycleRecoveryMarker,
): boolean {
  try {
    const key = takeApprovalLifecycleRecoveryKey(value)
    if (!marker(value) || globalThis.sessionStorage.getItem(key) !== null) return false
    globalThis.sessionStorage.setItem(key, JSON.stringify(value))
    return JSON.stringify(readTakeApprovalLifecycleRecoveryMarker(value)) === JSON.stringify(value)
  } catch {
    return false
  }
}

/**
 * Remove a lifecycle marker only when storage still equals the expected intent.
 * @param value - exact marker expected in storage.
 * @returns true only when the matching marker was removed.
 */
export function clearTakeApprovalLifecycleRecoveryMarker(
  value: TakeApprovalLifecycleRecoveryMarker,
): boolean {
  try {
    const key = takeApprovalLifecycleRecoveryKey(value)
    const serialized = globalThis.sessionStorage.getItem(key)
    if (serialized === null || JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(value)) return false
    globalThis.sessionStorage.removeItem(key)
    return globalThis.sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Create a cryptographically random lifecycle idempotency key.
 * @returns a namespaced key containing 32 random bytes.
 */
export function createTakeApprovalLifecycleIdempotencyKey(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return `qingmu:take-approval-lifecycle:v1:${Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0')).join('')}`
}
