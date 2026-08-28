/** Durable, role-separated browser coordinates for E7-2 Take review commands. */
import type {
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeReviewAction,
} from './contracts.ts'

/**
 * Browser recovery marker for an unconfirmed Take review recommendation.
 */
export interface TakeReviewRecommendationRecoveryMarker
  extends YimengCreateTakeReviewRecommendationRequest {
  readonly schema: 'qingmu.take-review-recommendation-recovery-marker.v1'
}

/**
 * Browser recovery marker for an unconfirmed human Take decision.
 */
export interface TakeHumanDecisionRecoveryMarker extends YimengCreateTakeHumanDecisionRequest {
  readonly schema: 'qingmu.take-human-decision-recovery-marker.v1'
}

type Scope = {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

const RECOMMENDATION_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
  'takeId', 'recommendation', 'reason', 'idempotencyKey',
] as const
const DECISION_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
  'takeId', 'decision', 'reason', 'idempotencyKey',
] as const
const SHA256 = /^[0-9a-f]{64}$/u
const RECOMMENDATION_KEY = /^qingmu:take-review-recommendation:v1:[0-9a-f]{64}$/u
const DECISION_KEY = /^qingmu:take-human-decision:v1:[0-9a-f]{64}$/u
const ACTIONS = new Set<YimengTakeReviewAction>(['approve', 'reject', 'request_changes'])

/**
 * Normalize text with Python-compatible trimming.
 * @param value - Untrusted value to validate and normalize.
 * @returns Text normalized with Python-compatible trimming.
 */
export function pythonStripTakeReviewText(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= 256
    && pythonStripTakeReviewText(value) === value
    && !/[\r\n\0]/u.test(value) && value.isWellFormed()
}

function common(value: Record<string, unknown>): boolean {
  return identifier(value.projectId) && identifier(value.episodeId) && identifier(value.frameId)
    && identifier(value.takeId) && typeof value.expectedTakeSubjectSha256 === 'string'
    && SHA256.test(value.expectedTakeSubjectSha256)
    && typeof value.reason === 'string' && value.reason.isWellFormed()
    && !value.reason.includes('\0') && pythonStripTakeReviewText(value.reason).length > 0
    && Array.from(value.reason).length <= 8_000
}

function recommendationMarker(value: unknown): value is TakeReviewRecommendationRecoveryMarker {
  return exact(value, RECOMMENDATION_FIELDS)
    && value.schema === 'qingmu.take-review-recommendation-recovery-marker.v1'
    && common(value) && typeof value.recommendation === 'string'
    && ACTIONS.has(value.recommendation as YimengTakeReviewAction)
    && typeof value.idempotencyKey === 'string' && RECOMMENDATION_KEY.test(value.idempotencyKey)
}

function decisionMarker(value: unknown): value is TakeHumanDecisionRecoveryMarker {
  return exact(value, DECISION_FIELDS)
    && value.schema === 'qingmu.take-human-decision-recovery-marker.v1'
    && common(value) && typeof value.decision === 'string'
    && ACTIONS.has(value.decision as YimengTakeReviewAction)
    && typeof value.idempotencyKey === 'string' && DECISION_KEY.test(value.idempotencyKey)
}

function storageKey(prefix: string, scope: Scope): string {
  return [prefix, scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}

/**
 * Build the browser storage key for the take review recommendation recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Resulting string value.
 */
export function takeReviewRecommendationRecoveryKey(scope: Scope): string {
  return storageKey('qingmu:take-review-recommendation-recovery:v1', scope)
}

/**
 * Build the browser storage key for the take human decision recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Resulting string value.
 */
export function takeHumanDecisionRecoveryKey(scope: Scope): string {
  return storageKey('qingmu:take-human-decision-recovery:v1', scope)
}

function read<T>(key: string, scope: Scope, validate: (value: unknown) => value is T): T | undefined {
  try {
    const serialized = globalThis.sessionStorage.getItem(key)
    if (serialized === null) return undefined
    const value: unknown = JSON.parse(serialized)
    if (!validate(value)) return undefined
    const coordinates = value as T & Scope
    if (coordinates.projectId !== scope.projectId || coordinates.episodeId !== scope.episodeId
      || coordinates.frameId !== scope.frameId) return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Read the take review recommendation recovery marker from browser storage.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readTakeReviewRecommendationRecoveryMarker(
  scope: Scope,
): TakeReviewRecommendationRecoveryMarker | undefined {
  return read(takeReviewRecommendationRecoveryKey(scope), scope, recommendationMarker)
}

/**
 * Read the take human decision recovery marker from browser storage.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readTakeHumanDecisionRecoveryMarker(
  scope: Scope,
): TakeHumanDecisionRecoveryMarker | undefined {
  return read(takeHumanDecisionRecoveryKey(scope), scope, decisionMarker)
}

function has(key: string): boolean {
  try {
    return globalThis.sessionStorage.getItem(key) !== null
  } catch {
    return true
  }
}

/**
 * Check whether browser storage contains the take review recommendation recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Whether a matching marker exists.
 */
export function hasTakeReviewRecommendationRecoveryMarker(scope: Scope): boolean {
  return has(takeReviewRecommendationRecoveryKey(scope))
}

/**
 * Check whether browser storage contains the take human decision recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Whether a matching marker exists.
 */
export function hasTakeHumanDecisionRecoveryMarker(scope: Scope): boolean {
  return has(takeHumanDecisionRecoveryKey(scope))
}

function write<T>(key: string, value: T, readBack: () => T | undefined): boolean {
  try {
    if (globalThis.sessionStorage.getItem(key) !== null) return false
    globalThis.sessionStorage.setItem(key, JSON.stringify(value))
    const recovered = readBack()
    return recovered !== undefined && JSON.stringify(recovered) === JSON.stringify(value)
  } catch {
    return false
  }
}

/**
 * Persist the take review recommendation recovery marker in browser storage.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether the marker was stored successfully.
 */
export function writeTakeReviewRecommendationRecoveryMarker(
  value: TakeReviewRecommendationRecoveryMarker,
): boolean {
  return write(
    takeReviewRecommendationRecoveryKey(value),
    value,
    () => readTakeReviewRecommendationRecoveryMarker(value),
  )
}

/**
 * Persist the take human decision recovery marker in browser storage.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether the marker was stored successfully.
 */
export function writeTakeHumanDecisionRecoveryMarker(
  value: TakeHumanDecisionRecoveryMarker,
): boolean {
  return write(
    takeHumanDecisionRecoveryKey(value),
    value,
    () => readTakeHumanDecisionRecoveryMarker(value),
  )
}

function clear(key: string, value: unknown): boolean {
  try {
    const serialized = globalThis.sessionStorage.getItem(key)
    if (serialized === null || JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(value)) return false
    globalThis.sessionStorage.removeItem(key)
    return globalThis.sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Remove the take review recommendation recovery marker from browser storage when it still matches.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether a matching marker was removed.
 */
export function clearTakeReviewRecommendationRecoveryMarker(
  value: TakeReviewRecommendationRecoveryMarker,
): boolean {
  return clear(takeReviewRecommendationRecoveryKey(value), value)
}

/**
 * Remove the take human decision recovery marker from browser storage when it still matches.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether a matching marker was removed.
 */
export function clearTakeHumanDecisionRecoveryMarker(
  value: TakeHumanDecisionRecoveryMarker,
): boolean {
  return clear(takeHumanDecisionRecoveryKey(value), value)
}

function randomHex(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Derive the stable idempotency key for take review recommendation.
 * @returns Stable idempotency key for the canonical operation.
 */
export function createTakeReviewRecommendationIdempotencyKey(): string {
  return `qingmu:take-review-recommendation:v1:${randomHex()}`
}

/**
 * Derive the stable idempotency key for take human decision.
 * @returns Stable idempotency key for the canonical operation.
 */
export function createTakeHumanDecisionIdempotencyKey(): string {
  return `qingmu:take-human-decision:v1:${randomHex()}`
}
