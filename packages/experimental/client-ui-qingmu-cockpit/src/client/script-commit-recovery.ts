import type { YimengRecoverScriptCommitRequest } from './contracts.ts'

const MARKER_SCHEMA = 'qingmu.script-commit-recovery-marker.v1'
const STORAGE_PREFIX = 'qingmu:script-commit-recovery:v1'
const SHA256 = /^[0-9a-f]{64}$/
const MARKER_KEYS = [
  'schema',
  'projectId',
  'episodeId',
  'changeSetId',
  'baseRevision',
  'idempotencyKey',
  'expectedPayloadSha256',
] as const

/** Minimal, non-secret lineage needed to query one accepted commit without resubmitting it. */
export interface ScriptCommitRecoveryMarker extends YimengRecoverScriptCommitRequest {
  readonly schema: typeof MARKER_SCHEMA
}

/** Strict result of reading the current subject's same-tab recovery marker. */
export type ScriptCommitRecoveryMarkerRead =
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: ScriptCommitRecoveryMarker }
  | { readonly status: 'invalid'; readonly error: string }

function storageKey(projectId: string, episodeId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(episodeId)}`
}

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
}

function parseMarker(value: unknown, projectId: string, episodeId: string): ScriptCommitRecoveryMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('恢复标记不是对象')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [...MARKER_KEYS].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('恢复标记字段不符合合同')
  }
  if (record.schema !== MARKER_SCHEMA) throw new Error('恢复标记合同不匹配')
  if (!isIdentifier(record.projectId) || record.projectId !== projectId) throw new Error('恢复标记 Project ID 不匹配')
  if (!isIdentifier(record.episodeId) || record.episodeId !== episodeId) throw new Error('恢复标记 Episode ID 不匹配')
  if (!isIdentifier(record.changeSetId)) throw new Error('恢复标记 ChangeSet ID 无效')
  if (!Number.isSafeInteger(record.baseRevision) || (record.baseRevision as number) < 0) {
    throw new Error('恢复标记基线修订号无效')
  }
  if (!isIdentifier(record.idempotencyKey, 200) || record.idempotencyKey.length < 8 || /[\r\n]/.test(record.idempotencyKey)) {
    throw new Error('恢复标记幂等键无效')
  }
  if (typeof record.expectedPayloadSha256 !== 'string' || !SHA256.test(record.expectedPayloadSha256)) {
    throw new Error('恢复标记 payload SHA-256 无效')
  }
  return {
    schema: MARKER_SCHEMA,
    projectId: record.projectId,
    episodeId: record.episodeId,
    changeSetId: record.changeSetId,
    baseRevision: record.baseRevision as number,
    idempotencyKey: record.idempotencyKey,
    expectedPayloadSha256: record.expectedPayloadSha256,
  }
}

function sameMarker(left: ScriptCommitRecoveryMarker, right: ScriptCommitRecoveryMarker): boolean {
  return MARKER_KEYS.every(key => left[key] === right[key])
}

/**
 * Build the exact marker that must be durably written before the commit POST begins.
 * @param request - Non-secret subject and idempotency lineage for one commit.
 * @returns A strictly validated, versioned recovery marker.
 */
export function createScriptCommitRecoveryMarker(
  request: YimengRecoverScriptCommitRequest,
): ScriptCommitRecoveryMarker {
  return parseMarker({ schema: MARKER_SCHEMA, ...request }, request.projectId, request.episodeId)
}

/**
 * Read and strictly validate only the marker belonging to the current project and episode.
 * @param projectId - Current Yimeng project identifier.
 * @param episodeId - Current Yimeng episode identifier.
 * @returns The absent, ready, or invalid marker state for this exact subject.
 */
export function readScriptCommitRecoveryMarker(
  projectId: string,
  episodeId: string,
): ScriptCommitRecoveryMarkerRead {
  try {
    const serialized = sessionStorage.getItem(storageKey(projectId, episodeId))
    if (serialized === null) return { status: 'none' }
    return { status: 'ready', marker: parseMarker(JSON.parse(serialized) as unknown, projectId, episodeId) }
  } catch (error) {
    return { status: 'invalid', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Persist a marker and synchronously read it back; false means the commit must not be submitted.
 * @param marker - Exact marker to store before sending the commit.
 * @returns Whether the identical marker was synchronously persisted and verified.
 */
export function writeScriptCommitRecoveryMarker(marker: ScriptCommitRecoveryMarker): boolean {
  try {
    const validated = parseMarker(marker, marker.projectId, marker.episodeId)
    const serialized = JSON.stringify(validated)
    const key = storageKey(marker.projectId, marker.episodeId)
    sessionStorage.setItem(key, serialized)
    const stored = sessionStorage.getItem(key)
    if (stored !== serialized) return false
    return sameMarker(parseMarker(JSON.parse(stored) as unknown, marker.projectId, marker.episodeId), marker)
  } catch {
    return false
  }
}

/**
 * Remove only the still-identical marker after its receipt lineage and authoritative reread succeed.
 * @param marker - Previously persisted marker whose identity must still match storage.
 * @returns Whether the marker is now absent without deleting a different marker.
 */
export function clearScriptCommitRecoveryMarker(marker: ScriptCommitRecoveryMarker): boolean {
  try {
    const key = storageKey(marker.projectId, marker.episodeId)
    const serialized = sessionStorage.getItem(key)
    if (serialized === null) return true
    const stored = parseMarker(JSON.parse(serialized) as unknown, marker.projectId, marker.episodeId)
    if (!sameMarker(stored, marker)) return false
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Explicitly discard only the current subject's local marker; this never calls Yimeng or undoes a commit.
 * @param projectId - Current Yimeng project identifier.
 * @param episodeId - Current Yimeng episode identifier.
 * @returns Whether the current subject's local marker is now absent.
 */
export function discardScriptCommitRecoveryMarker(projectId: string, episodeId: string): boolean {
  try {
    const key = storageKey(projectId, episodeId)
    sessionStorage.removeItem(key)
    return sessionStorage.getItem(key) === null
  } catch {
    return false
  }
}
