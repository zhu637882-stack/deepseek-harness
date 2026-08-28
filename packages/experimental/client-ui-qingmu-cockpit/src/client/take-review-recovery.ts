/** Durable, role-separated browser coordinates for E7-2 Take review commands. */
import type {
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeReviewAction,
} from './contracts.ts'

export interface TakeReviewRecommendationRecoveryMarker
  extends YimengCreateTakeReviewRecommendationRequest {
  readonly schema: 'qingmu.take-review-recommendation-recovery-marker.v1'
}

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

export function takeReviewRecommendationRecoveryKey(scope: Scope): string {
  return storageKey('qingmu:take-review-recommendation-recovery:v1', scope)
}

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

export function readTakeReviewRecommendationRecoveryMarker(
  scope: Scope,
): TakeReviewRecommendationRecoveryMarker | undefined {
  return read(takeReviewRecommendationRecoveryKey(scope), scope, recommendationMarker)
}

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

export function hasTakeReviewRecommendationRecoveryMarker(scope: Scope): boolean {
  return has(takeReviewRecommendationRecoveryKey(scope))
}

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

export function writeTakeReviewRecommendationRecoveryMarker(
  value: TakeReviewRecommendationRecoveryMarker,
): boolean {
  return write(
    takeReviewRecommendationRecoveryKey(value),
    value,
    () => readTakeReviewRecommendationRecoveryMarker(value),
  )
}

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

export function clearTakeReviewRecommendationRecoveryMarker(
  value: TakeReviewRecommendationRecoveryMarker,
): boolean {
  return clear(takeReviewRecommendationRecoveryKey(value), value)
}

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

export function createTakeReviewRecommendationIdempotencyKey(): string {
  return `qingmu:take-review-recommendation:v1:${randomHex()}`
}

export function createTakeHumanDecisionIdempotencyKey(): string {
  return `qingmu:take-human-decision:v1:${randomHex()}`
}
