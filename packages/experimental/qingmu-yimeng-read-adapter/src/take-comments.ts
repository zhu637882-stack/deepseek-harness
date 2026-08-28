/** Validate the strict, selection-free ordinary-comment feed for one Yimeng Take stack. */
import type {
  YimengTakeComment,
  YimengTakeCommentAnchor,
  YimengTakeCommentFeedResponse,
  YimengTakeCommentRequest,
  YimengTakeCommentSubject,
  YimengTakeCommentVersion,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'takeId', 'versionOrdinal', 'outputSha256', 'durationMillis',
] as const
const COMMENT_FIELDS = [
  'id', 'takeId', 'versionOrdinalAtComment', 'outputSha256', 'frameBinding',
  'takeSubjectSha256', 'anchor', 'body', 'actorId', 'actorRole', 'authSessionId',
  'createdAt', 'eventId', 'currentBinding',
] as const
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`take comments: ${field} fields mismatch`)
  }
  return value as Record<string, unknown>
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum: number, nonempty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || (nonempty && pythonStrip(value) === '')) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  return value
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256, true)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  return value
}

function integer(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 128, true)
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  return result
}

function anchor(value: unknown, field: string): YimengTakeCommentAnchor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`take comments: ${field} is invalid`)
  }
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'timecode') {
    const item = exact(value, ['kind', 'timecodeMillis'], field)
    return { kind, timecodeMillis: integer(item.timecodeMillis, `${field}.timecodeMillis`, 0) }
  }
  if (kind === 'frame') {
    const item = exact(value, ['kind', 'frameNumber'], field)
    return { kind, frameNumber: integer(item.frameNumber, `${field}.frameNumber`, 1) }
  }
  throw new Error(`take comments: ${field} is invalid`)
}

/**
 * Accept only the three canonical coordinates from the browser.
 * @param payload - Untrusted command payload to validate.
 * @returns Validated YimengTakeCommentRequest value.
 */
export function parseTakeCommentReadRequest(payload: unknown): YimengTakeCommentRequest {
  const input = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
  return {
    projectId: id(input.projectId, 'projectId'),
    episodeId: id(input.episodeId, 'episodeId'),
    frameId: id(input.frameId, 'frameId'),
  }
}

function subject(value: unknown, request: YimengTakeCommentRequest, field: string): YimengTakeCommentSubject {
  const item = exact(value, SUBJECT_FIELDS, field)
  if (item.schema !== 'jason.qingmu-take-comment-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId) {
    throw new Error(`take comments: ${field} subject mismatch`)
  }
  return {
    schema: 'jason.qingmu-take-comment-subject.v1',
    ...request,
    frameNo: integer(item.frameNo, `${field}.frameNo`, 1),
    storyboardRevision: integer(item.storyboardRevision, `${field}.storyboardRevision`, 0),
    frameContentSha256: sha(item.frameContentSha256, `${field}.frameContentSha256`),
    takeId: id(item.takeId, `${field}.takeId`),
    versionOrdinal: integer(item.versionOrdinal, `${field}.versionOrdinal`, 1),
    outputSha256: sha(item.outputSha256, `${field}.outputSha256`),
    durationMillis: integer(item.durationMillis, `${field}.durationMillis`, 0),
  }
}

function version(
  value: unknown,
  request: YimengTakeCommentRequest,
  digest: Digest,
  index: number,
): YimengTakeCommentVersion {
  const field = `versions[${String(index)}]`
  const item = exact(value, ['takeSubject', 'takeSubjectSha256'], field)
  const takeSubject = subject(item.takeSubject, request, `${field}.takeSubject`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  if (takeSubjectSha256 !== digest(takeSubject, `${field}.takeSubject`)) {
    throw new Error(`take comments: ${field} digest mismatch`)
  }
  return { takeSubject, takeSubjectSha256 }
}

function comment(
  value: unknown,
  versions: readonly YimengTakeCommentVersion[],
  request: YimengTakeCommentRequest,
  index: number,
): YimengTakeComment {
  const field = `comments[${String(index)}]`
  const item = exact(value, COMMENT_FIELDS, field)
  const frame = exact(
    item.frameBinding,
    ['frameId', 'frameNo', 'storyboardRevision', 'frameContentSha256'],
    `${field}.frameBinding`,
  )
  const normalizedAnchor = anchor(item.anchor, `${field}.anchor`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  const takeId = id(item.takeId, `${field}.takeId`)
  const versionOrdinalAtComment = integer(item.versionOrdinalAtComment, `${field}.versionOrdinalAtComment`, 1)
  const outputSha256 = sha(item.outputSha256, `${field}.outputSha256`)
  const frameBinding = {
    frameId: id(frame.frameId, `${field}.frameBinding.frameId`),
    frameNo: integer(frame.frameNo, `${field}.frameBinding.frameNo`, 1),
    storyboardRevision: integer(frame.storyboardRevision, `${field}.frameBinding.storyboardRevision`, 0),
    frameContentSha256: sha(frame.frameContentSha256, `${field}.frameBinding.frameContentSha256`),
  }
  const currentDigest = versions.find(entry => entry.takeSubjectSha256 === takeSubjectSha256)
  const currentBinding = currentDigest !== undefined
    && currentDigest.takeSubject.takeId === takeId
    && currentDigest.takeSubject.versionOrdinal === versionOrdinalAtComment
    && currentDigest.takeSubject.outputSha256 === outputSha256
    && currentDigest.takeSubject.frameId === frameBinding.frameId
    && currentDigest.takeSubject.frameNo === frameBinding.frameNo
    && currentDigest.takeSubject.storyboardRevision === frameBinding.storyboardRevision
    && currentDigest.takeSubject.frameContentSha256 === frameBinding.frameContentSha256
  if (frameBinding.frameId !== request.frameId || typeof item.currentBinding !== 'boolean'
    || item.currentBinding !== currentBinding || (currentDigest !== undefined && !currentBinding)
    || (currentBinding && normalizedAnchor.kind === 'timecode'
      && normalizedAnchor.timecodeMillis > currentDigest.takeSubject.durationMillis)) {
    throw new Error(`take comments: ${field} binding mismatch`)
  }
  if (item.actorRole !== 'commenter') throw new Error(`take comments: ${field}.actorRole is invalid`)
  return {
    id: id(item.id, `${field}.id`),
    takeId,
    versionOrdinalAtComment,
    outputSha256,
    frameBinding,
    takeSubjectSha256,
    anchor: normalizedAnchor,
    body: text(item.body, `${field}.body`, 8_000, true),
    actorId: id(item.actorId, `${field}.actorId`),
    actorRole: 'commenter',
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    createdAt: timestamp(item.createdAt, `${field}.createdAt`),
    eventId: id(item.eventId, `${field}.eventId`),
    currentBinding,
  }
}

/**
 * Validate exact subjects, RFC 8785 digests, immutable comments, and derived current binding.
 * @param value - Untrusted value to validate and normalize.
 * @param request - Request coordinates and payload to process.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengTakeCommentFeedResponse value.
 */
export function normalizeTakeCommentFeed(
  value: unknown,
  request: YimengTakeCommentRequest,
  digest: Digest,
): YimengTakeCommentFeedResponse {
  const root = exact(
    value,
    ['schema', 'projectId', 'episodeId', 'frameId', 'versions', 'capabilities', 'comments'],
    'feed',
  )
  if (root.schema !== 'jason.qingmu-take-comment-feed.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId || !Array.isArray(root.versions) || !Array.isArray(root.comments)) {
    throw new Error('take comments: feed mismatch')
  }
  const capabilities = exact(root.capabilities, ['canComment'], 'capabilities')
  if (typeof capabilities.canComment !== 'boolean') {
    throw new Error('take comments: capabilities mismatch')
  }
  const versions = root.versions.map((entry, index) => version(entry, request, digest, index))
  if (new Set(versions.map(entry => entry.takeSubject.takeId)).size !== versions.length
    || new Set(versions.map(entry => entry.takeSubjectSha256)).size !== versions.length) {
    throw new Error('take comments: current versions are ambiguous')
  }
  const comments = root.comments.map((entry, index) => comment(entry, versions, request, index))
  if (new Set(comments.map(entry => entry.id)).size !== comments.length
    || new Set(comments.map(entry => entry.eventId)).size !== comments.length) {
    throw new Error('take comments: comment identities are ambiguous')
  }
  return {
    schema: 'jason.qingmu-take-comment-feed.v1',
    ...request,
    versions,
    capabilities: { canComment: capabilities.canComment },
    comments,
  }
}
