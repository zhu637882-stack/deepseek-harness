/** Session-scoped original coordinates for E7-3 GET-only receipt recovery. */
import type {
  YimengRecordTakeTechnicalQcRequest,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
} from './contracts.ts'

/**
 * Browser recovery marker for an unconfirmed Take technical-QC command.
 */
export interface TakeTechnicalQcRecoveryMarker extends YimengRecordTakeTechnicalQcRequest {
  readonly schema: 'qingmu.take-technical-qc-recovery-marker.v1'
}

type Scope = {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

const FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'expectedEvidenceSnapshotSha256',
  'takeId', 'checks', 'idempotencyKey',
] as const
const CHECK_FIELDS = ['code', 'result', 'note', 'evidenceRefs'] as const
const CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const
const RESULTS = new Set(['PASS', 'FAIL', 'UNVERIFIED'])
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^qingmu:take-technical-qc:v1:[0-9a-f]{64}$/u

/**
 * Normalize text with Python-compatible trimming.
 * @param value - Untrusted value to validate and normalize.
 * @returns Text normalized with Python-compatible trimming.
 */
export function pythonStripTakeTechnicalQcText(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}

function identifier(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.isWellFormed() && !/[\0\r\n]/u.test(value)
    && value === pythonStripTakeTechnicalQcText(value)
    && value !== '' && Array.from(value).length <= maximum
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function check(value: unknown, expectedCode: YimengTakeTechnicalQcCode): value is YimengTakeTechnicalQcCheck {
  if (!exact(value, CHECK_FIELDS) || value.code !== expectedCode || !RESULTS.has(value.result as string)) return false
  const result = value.result as YimengTakeTechnicalQcCheck['result']
  if (value.note !== null && (typeof value.note !== 'string' || !value.note.isWellFormed()
    || value.note.includes('\0') || Array.from(value.note).length > 8_000
    || pythonStripTakeTechnicalQcText(value.note) === '')) return false
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 64
    || !value.evidenceRefs.every(entry => identifier(entry, 1_024))) return false
  const refs = value.evidenceRefs
  if (JSON.stringify(refs) !== JSON.stringify([...new Set(refs)].sort(codePointCompare))) return false
  return result === 'PASS' || (value.note !== null && refs.length > 0)
}

function marker(value: unknown): value is TakeTechnicalQcRecoveryMarker {
  const rawChecks = typeof value === 'object' && value !== null && 'checks' in value
    ? value.checks
    : undefined
  if (!exact(value, FIELDS) || value.schema !== 'qingmu.take-technical-qc-recovery-marker.v1'
    || !identifier(value.projectId) || !identifier(value.episodeId) || !identifier(value.frameId)
    || !identifier(value.takeId) || typeof value.expectedEvidenceSnapshotSha256 !== 'string'
    || !SHA256.test(value.expectedEvidenceSnapshotSha256)
    || typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)
    || !Array.isArray(rawChecks) || rawChecks.length !== CODES.length) return false
  return CODES.every((code, index) => check(rawChecks[index], code))
}

/**
 * Build the browser storage key for the take technical qc recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Resulting string value.
 */
export function takeTechnicalQcRecoveryKey(scope: Scope): string {
  return ['qingmu:take-technical-qc-recovery:v1', scope.projectId, scope.episodeId, scope.frameId]
    .map(encodeURIComponent).join(':')
}

/**
 * Read the take technical qc recovery marker from browser storage.
 * @param scope - Recovery or approval scope.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export function readTakeTechnicalQcRecoveryMarker(
  scope: Scope,
): TakeTechnicalQcRecoveryMarker | undefined {
  try {
    const serialized = globalThis.sessionStorage.getItem(takeTechnicalQcRecoveryKey(scope))
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
 * Check whether browser storage contains the take technical qc recovery marker.
 * @param scope - Recovery or approval scope.
 * @returns Whether a matching marker exists.
 */
export function hasTakeTechnicalQcRecoveryMarker(scope: Scope): boolean {
  try {
    return globalThis.sessionStorage.getItem(takeTechnicalQcRecoveryKey(scope)) !== null
  } catch {
    return true
  }
}

/**
 * Persist the take technical qc recovery marker in browser storage.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether the marker was stored successfully.
 */
export function writeTakeTechnicalQcRecoveryMarker(value: TakeTechnicalQcRecoveryMarker): boolean {
  try {
    const key = takeTechnicalQcRecoveryKey(value)
    if (!marker(value) || globalThis.sessionStorage.getItem(key) !== null) return false
    globalThis.sessionStorage.setItem(key, JSON.stringify(value))
    return JSON.stringify(readTakeTechnicalQcRecoveryMarker(value)) === JSON.stringify(value)
  } catch {
    return false
  }
}

/**
 * Remove the take technical qc recovery marker from browser storage when it still matches.
 * @param value - Untrusted value to validate and normalize.
 * @returns Whether a matching marker was removed.
 */
export function clearTakeTechnicalQcRecoveryMarker(value: TakeTechnicalQcRecoveryMarker): boolean {
  try {
    const key = takeTechnicalQcRecoveryKey(value)
    const serialized = globalThis.sessionStorage.getItem(key)
    if (serialized === null || JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(value)) return false
    globalThis.sessionStorage.removeItem(key)
    return globalThis.sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Derive the stable idempotency key for take technical qc.
 * @returns Stable idempotency key for the canonical operation.
 */
export function createTakeTechnicalQcIdempotencyKey(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return `qingmu:take-technical-qc:v1:${Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0')).join('')}`
}
