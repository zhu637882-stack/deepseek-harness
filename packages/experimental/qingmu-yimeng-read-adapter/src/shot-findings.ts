/** Validate Yimeng's current selected-video subject and immutable Finding history. */
import type {
  YimengSelectedVideoReviewRequest, YimengShotFinding, YimengShotFindingFeedResponse, YimengShotVideoSubject,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('shot findings: unexpected fields')
  }
  return value as Record<string, unknown>
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, maximum = 8_000): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\u0000')
    || pythonStrip(value) === '' || Array.from(value).length > maximum) throw new Error('shot findings: invalid text')
  return value
}

function identifier(value: unknown): string {
  const result = text(value, 256)
  if (result !== pythonStrip(result) || /[\r\n]/.test(result)) throw new Error('shot findings: invalid ID')
  return result
}

/**
 * Keep canonical identifiers byte-for-byte instead of normalizing an input into another Shot.
 * @param payload - untrusted browser input containing exactly three coordinates.
 * @returns the original identifiers after Python-compatible ledger validation.
 */
export function parseShotFindingReadRequest(payload: unknown): YimengSelectedVideoReviewRequest {
  const input = exact(payload, ['projectId', 'episodeId', 'frameId'])
  return { projectId: identifier(input.projectId), episodeId: identifier(input.episodeId), frameId: identifier(input.frameId) }
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('shot findings: invalid SHA')
  return value
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('shot findings: invalid integer')
  return value
}

function subject(value: unknown, request: YimengSelectedVideoReviewRequest): YimengShotVideoSubject {
  const item = exact(value, ['schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
    'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256'])
  if (item.schema !== 'jason.qingmu-shot-video-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId || item.frameId !== request.frameId) {
    throw new Error('shot findings: subject mismatch')
  }
  return { schema: 'jason.qingmu-shot-video-subject.v1', projectId: identifier(item.projectId),
    episodeId: identifier(item.episodeId), frameId: identifier(item.frameId), frameNo: integer(item.frameNo, 1),
    storyboardRevision: integer(item.storyboardRevision), frameContentSha256: sha(item.frameContentSha256),
    assetId: identifier(item.assetId), assetVersion: integer(item.assetVersion), assetSha256: sha(item.assetSha256) }
}

function finding(value: Record<string, unknown>, request: YimengSelectedVideoReviewRequest, digest: Digest): YimengShotFinding {
  const boundSubject = subject(value.subject, request)
  if (sha(value.subjectSnapshotSha256) !== digest(boundSubject, 'finding.subject') || value.status !== 'OPEN'
    || value.actorRole !== 'reviewer' || typeof value.severity !== 'string' || !['BLOCKER', 'MAJOR', 'MINOR'].includes(value.severity)) {
    throw new Error('shot findings: invalid record binding or authority')
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 32) {
    throw new Error('shot findings: evidence is required')
  }
  return {
    id: identifier(value.id), eventId: identifier(value.eventId), subject: boundSubject,
    subjectSnapshotSha256: sha(value.subjectSnapshotSha256), timecode: text(value.timecode, 128),
    observation: text(value.observation), evidenceRefs: value.evidenceRefs.map(item => text(item, 1_024)),
    earliestOwner: identifier(value.earliestOwner), ownerReason: text(value.ownerReason),
    severity: value.severity as YimengShotFinding['severity'], suggestion: text(value.suggestion),
    reworkScope: text(value.reworkScope), status: 'OPEN', actorId: identifier(value.actorId), actorRole: 'reviewer',
    authSessionId: sha(value.authSessionId), createdAt: text(value.createdAt),
    methodProjectionSha256: sha(value.methodProjectionSha256), rulesSha256: sha(value.rulesSha256),
  }
}

/**
 * Read the existing ledger without promoting a historical Finding into current authority.
 * @param value - bounded, token-scrubbed Yimeng response.
 * @param request - exact project, episode, and canonical Shot identifiers.
 * @param digest - the Host's Python-compatible canonical JSON SHA function.
 * @returns the validated feed; no write, approval, or repair operation is performed.
 */
export function normalizeShotFindingFeed(
  value: unknown, request: YimengSelectedVideoReviewRequest, digest: Digest,
): YimengShotFindingFeedResponse {
  const root = exact(value, ['schema', 'projectId', 'episodeId', 'frameId', 'subject', 'snapshotSha256',
    'availability', 'capabilities', 'items'])
  if (root.schema !== 'jason.qingmu-shot-finding-feed.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.frameId !== request.frameId || !Array.isArray(root.items)) {
    throw new Error('shot findings: feed subject mismatch')
  }
  const current = root.subject === null ? null : subject(root.subject, request)
  const snapshotSha256 = root.snapshotSha256 === null ? null : sha(root.snapshotSha256)
  const availability = exact(root.availability, ['status', 'reason'])
  if ((current === null && (snapshotSha256 !== null || availability.status !== 'unavailable'))
    || (current !== null && (snapshotSha256 !== digest(current, 'feed.subject')
      || availability.status !== 'available' || availability.reason !== null))) {
    throw new Error('shot findings: current binding or availability mismatch')
  }
  const reason = current === null ? text(availability.reason) : null
  const capabilities = exact(root.capabilities, ['canRecordFinding'])
  if (typeof capabilities.canRecordFinding !== 'boolean') throw new Error('shot findings: invalid capabilities')
  const ids = new Set<string>()
  const events = new Set<string>()
  const items = root.items.map((raw) => {
    const item = exact(raw, ['id', 'eventId', 'subject', 'subjectSnapshotSha256', 'timecode', 'observation',
      'evidenceRefs', 'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope', 'status',
      'actorId', 'actorRole', 'authSessionId', 'createdAt', 'methodProjectionSha256', 'rulesSha256', 'currentBinding'])
    const record = finding(item, request, digest)
    const currentBinding = snapshotSha256 !== null && record.subjectSnapshotSha256 === snapshotSha256
    if (typeof item.currentBinding !== 'boolean' || item.currentBinding !== currentBinding
      || ids.has(record.id) || events.has(record.eventId)) throw new Error('shot findings: inconsistent history')
    ids.add(record.id)
    events.add(record.eventId)
    return { ...record, currentBinding }
  })
  return { schema: 'jason.qingmu-shot-finding-feed.v1', ...request, subject: current, snapshotSha256,
    availability: { status: current === null ? 'unavailable' : 'available', reason },
    capabilities: { canRecordFinding: capabilities.canRecordFinding }, items }
}
