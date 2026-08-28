/** Durable browser marker for one ordinary Take-comment intent. */
import type { YimengCreateTakeCommentRequest, YimengTakeCommentAnchor } from './contracts.ts'

/**
 * Browser recovery marker for an unconfirmed Take comment.
 */
export interface TakeCommentRecoveryMarker extends YimengCreateTakeCommentRequest {
  readonly schema: 'qingmu.take-comment-recovery-marker.v1'
}

const FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
  'takeId', 'anchor', 'body', 'idempotencyKey',
] as const
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^qingmu:take-comment:v1:[0-9a-f]{64}$/u

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\r\n\0]/u.test(value) && value.isWellFormed()
}

function anchor(value: unknown): value is YimengTakeCommentAnchor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'timecode') {
    return exact(item, ['kind', 'timecodeMillis'])
      && Number.isSafeInteger(item.timecodeMillis) && (item.timecodeMillis as number) >= 0
  }
  return item.kind === 'frame' && exact(item, ['kind', 'frameNumber'])
    && Number.isSafeInteger(item.frameNumber) && (item.frameNumber as number) >= 1
}

function marker(value: unknown): value is TakeCommentRecoveryMarker {
  if (!exact(value, FIELDS)) return false
  return value.schema === 'qingmu.take-comment-recovery-marker.v1'
    && identifier(value.projectId) && identifier(value.episodeId) && identifier(value.frameId)
    && identifier(value.takeId) && typeof value.expectedTakeSubjectSha256 === 'string'
    && SHA256.test(value.expectedTakeSubjectSha256) && anchor(value.anchor)
    && typeof value.body === 'string' && value.body.isWellFormed() && !value.body.includes('\0')
    && value.body.trim().length > 0 && Array.from(value.body).length <= 8_000
    && typeof value.idempotencyKey === 'string' && IDEMPOTENCY_KEY.test(value.idempotencyKey)
}

/**
 * Scope-specific marker key. Encoding prevents delimiter collisions between coordinates.
 * @param scope - Recovery or approval scope.
 * @returns Resulting string value.
 */
export function takeCommentRecoveryKey(scope: {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}): string {
  return ['qingmu:take-comment-recovery:v1', scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}

/**
 * Read and strictly validate the one pending intent for this Shot.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readTakeCommentRecoveryMarker(scope: {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}): TakeCommentRecoveryMarker | undefined {
  try {
    const serialized = globalThis.sessionStorage.getItem(takeCommentRecoveryKey(scope))
    if (serialized === null) return undefined
    const value: unknown = JSON.parse(serialized)
    if (!marker(value) || value.projectId !== scope.projectId
      || value.episodeId !== scope.episodeId || value.frameId !== scope.frameId) return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Fail closed whenever this Shot already owns any unresolved browser coordinate.
 * @param scope - Recovery or approval scope.
 * @returns Whether a matching marker exists.
 */
export function hasTakeCommentRecoveryMarker(scope: {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}): boolean {
  try {
    return globalThis.sessionStorage.getItem(takeCommentRecoveryKey(scope)) !== null
  } catch {
    return true
  }
}

/**
 * Persist the full intent and verify the browser returned it unchanged before any POST.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether the marker was stored successfully.
 */
export function writeTakeCommentRecoveryMarker(value: TakeCommentRecoveryMarker): boolean {
  try {
    const key = takeCommentRecoveryKey(value)
    if (globalThis.sessionStorage.getItem(key) !== null) return false
    globalThis.sessionStorage.setItem(key, JSON.stringify(value))
    const recovered = readTakeCommentRecoveryMarker(value)
    return recovered !== undefined && JSON.stringify(recovered) === JSON.stringify(value)
  } catch {
    return false
  }
}

/**
 * Compare-and-clear so another tab's newer intent is never removed.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether a matching marker was removed.
 */
export function clearTakeCommentRecoveryMarker(value: TakeCommentRecoveryMarker): boolean {
  try {
    const key = takeCommentRecoveryKey(value)
    const serialized = globalThis.sessionStorage.getItem(key)
    if (serialized === null || JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(value)) return false
    globalThis.sessionStorage.removeItem(key)
    return globalThis.sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Generate a collision-resistant idempotency coordinate without sending browser identity.
 * @returns Stable idempotency key for the canonical operation.
 */
export function createTakeCommentIdempotencyKey(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `qingmu:take-comment:v1:${digest}`
}
