/** Exact ordinary-comment POST and GET-only receipt recovery. */
import type {
  YimengCommandJsonObject,
  YimengCreateTakeCommentRequest,
  YimengTakeCommentAnchor,
  YimengTakeCommentRecord,
  YimengTakeCommentRecovery,
  YimengTakeCommentResult,
} from './types.ts'

const REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
  'takeId', 'anchor', 'body', 'idempotencyKey',
] as const
const COMMENT_FIELDS = [
  'id', 'takeId', 'versionOrdinalAtComment', 'outputSha256', 'frameBinding',
  'takeSubjectSha256', 'anchor', 'body', 'actorId', 'actorRole', 'authSessionId',
  'createdAt', 'eventId',
] as const
const RESULT_FIELDS = [
  'schema', 'comment', 'changed', 'selectionChanged', 'technicalPassChanged',
  'formalApprovalChanged', 'episodeVerificationChanged', 'humanSignoffInferred',
  'providerCalls', 'budgetMutation',
] as const
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/u

type ErrorFactory = (message: string) => Error

interface TakeCommentHelpers {
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly requireTimestamp: (value: unknown, field: string) => string
}

interface PreparedTakeCommentCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey: string
  }
  readonly normalize: (value: unknown, token: string) => YimengTakeCommentResult | YimengTakeCommentRecovery
}

function exact(
  value: unknown,
  keys: readonly string[],
  field: string,
  error: ErrorFactory,
): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw error(`${field} has invalid fields`)
  }
  return value as YimengCommandJsonObject
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(
  value: unknown,
  maximum: number,
  field: string,
  error: ErrorFactory,
  identifier = false,
): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || (identifier && /[\r\n]/u.test(value))) {
    throw error(`${field} must be bounded Unicode text`)
  }
  if ((identifier && (value === '' || value !== pythonStrip(value)))
    || (!identifier && pythonStrip(value) === '')) {
    throw error(`${field} must be non-empty text`)
  }
  return value
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  return text(value, 256, field, error, true)
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw error(`${field} must be sha256`)
  return value
}

function integer(value: unknown, field: string, minimum: number, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  }
  return value
}

function anchor(value: unknown, field: string, error: ErrorFactory): YimengTakeCommentAnchor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw error(`${field} must be an exact Take anchor`)
  }
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'timecode') {
    const item = exact(value, ['kind', 'timecodeMillis'], field, error)
    return { kind, timecodeMillis: integer(item.timecodeMillis, `${field}.timecodeMillis`, 0, error) }
  }
  if (kind === 'frame') {
    const item = exact(value, ['kind', 'frameNumber'], field, error)
    return { kind, frameNumber: integer(item.frameNumber, `${field}.frameNumber`, 1, error) }
  }
  throw error(`${field} must be an exact Take anchor`)
}

function sameAnchor(left: YimengTakeCommentAnchor, right: YimengTakeCommentAnchor): boolean {
  return left.kind === right.kind && (left.kind === 'timecode'
    ? right.kind === 'timecode' && left.timecodeMillis === right.timecodeMillis
    : right.kind === 'frame' && left.frameNumber === right.frameNumber)
}

function requestCoordinates(value: unknown, error: ErrorFactory): YimengCreateTakeCommentRequest {
  const item = exact(value, REQUEST_FIELDS, 'payload', error)
  const idempotencyKey = text(item.idempotencyKey, 200, 'idempotencyKey', error, true)
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw error('idempotencyKey must use visible ASCII')
  return {
    projectId: id(item.projectId, 'projectId', error),
    episodeId: id(item.episodeId, 'episodeId', error),
    frameId: id(item.frameId, 'frameId', error),
    expectedTakeSubjectSha256: sha(item.expectedTakeSubjectSha256, 'expectedTakeSubjectSha256', error),
    takeId: id(item.takeId, 'takeId', error),
    anchor: anchor(item.anchor, 'anchor', error),
    body: text(item.body, 8_000, 'body', error),
    idempotencyKey,
  }
}

function normalizeComment(
  value: unknown,
  request: YimengCreateTakeCommentRequest,
  helpers: TakeCommentHelpers,
): YimengTakeCommentRecord {
  const error = helpers.responseError
  const item = exact(value, COMMENT_FIELDS, 'takeCommentResult.comment', error)
  const normalizedAnchor = anchor(item.anchor, 'takeCommentResult.comment.anchor', error)
  const frame = exact(
    item.frameBinding,
    ['frameId', 'frameNo', 'storyboardRevision', 'frameContentSha256'],
    'takeCommentResult.comment.frameBinding',
    error,
  )
  if (item.takeId !== request.takeId || item.takeSubjectSha256 !== request.expectedTakeSubjectSha256
    || item.body !== request.body || !sameAnchor(normalizedAnchor, request.anchor)
    || frame.frameId !== request.frameId || item.actorRole !== 'commenter') {
    throw error('takeCommentResult.comment differs from the submitted intent')
  }
  return {
    id: id(item.id, 'takeCommentResult.comment.id', error),
    takeId: request.takeId,
    versionOrdinalAtComment: integer(
      item.versionOrdinalAtComment,
      'takeCommentResult.comment.versionOrdinalAtComment',
      1,
      error,
    ),
    outputSha256: sha(item.outputSha256, 'takeCommentResult.comment.outputSha256', error),
    frameBinding: {
      frameId: request.frameId,
      frameNo: integer(frame.frameNo, 'takeCommentResult.comment.frameBinding.frameNo', 1, error),
      storyboardRevision: integer(
        frame.storyboardRevision,
        'takeCommentResult.comment.frameBinding.storyboardRevision',
        0,
        error,
      ),
      frameContentSha256: sha(
        frame.frameContentSha256,
        'takeCommentResult.comment.frameBinding.frameContentSha256',
        error,
      ),
    },
    takeSubjectSha256: request.expectedTakeSubjectSha256,
    anchor: normalizedAnchor,
    body: request.body,
    actorId: id(item.actorId, 'takeCommentResult.comment.actorId', error),
    actorRole: 'commenter',
    authSessionId: sha(item.authSessionId, 'takeCommentResult.comment.authSessionId', error),
    createdAt: helpers.requireTimestamp(item.createdAt, 'takeCommentResult.comment.createdAt'),
    eventId: id(item.eventId, 'takeCommentResult.comment.eventId', error),
  }
}

function normalizeResult(
  value: unknown,
  request: YimengCreateTakeCommentRequest,
  helpers: TakeCommentHelpers,
): YimengTakeCommentResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'takeCommentResult', error)
  if (root.schema !== 'jason.qingmu-take-comment-result.v1' || root.changed !== false
    || root.selectionChanged !== false || root.technicalPassChanged !== false
    || root.formalApprovalChanged !== false || root.episodeVerificationChanged !== false
    || root.humanSignoffInferred !== false || root.providerCalls !== 0
    || root.budgetMutation !== false) {
    throw error('takeCommentResult authority or impact flags mismatch')
  }
  return {
    schema: 'jason.qingmu-take-comment-result.v1',
    comment: normalizeComment(root.comment, request, helpers),
    changed: false,
    selectionChanged: false,
    technicalPassChanged: false,
    formalApprovalChanged: false,
    episodeVerificationChanged: false,
    humanSignoffInferred: false,
    providerCalls: 0,
    budgetMutation: false,
  }
}

/**
 * Prepare one exact five-field POST or one GET-only receipt lookup.
 * @param endpoint - Command endpoint selected by the caller.
 * @param payload - Untrusted command payload to validate.
 * @param helpers - Canonicalization and digest helpers for command preparation.
 * @returns Prepared command and recovery metadata.
 */
export function prepareTakeCommentCommand(
  endpoint: 'createTakeComment' | 'recoverTakeComment',
  payload: unknown,
  helpers: TakeCommentHelpers,
): PreparedTakeCommentCommand {
  const request = requestCoordinates(payload, helpers.inputError)
  const rootPath = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
    + `/episodes/${encodeURIComponent(request.episodeId)}`
    + `/frames/${encodeURIComponent(request.frameId)}/take-comments`
  if (endpoint === 'createTakeComment') {
    return {
      path: rootPath,
      request: {
        method: 'POST',
        body: {
          expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
          takeId: request.takeId,
          anchor: request.anchor,
          body: request.body,
          idempotencyKey: request.idempotencyKey,
        },
        idempotencyKey: request.idempotencyKey,
      },
      normalize: value => normalizeResult(value, request, helpers),
    }
  }
  const query = new URLSearchParams({
    expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
    takeId: request.takeId,
  })
  return {
    path: `${rootPath}/command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(
        value,
        [
          'schema', 'projectId', 'episodeId', 'frameId', 'takeId',
          'expectedTakeSubjectSha256', 'idempotencyKey', 'status', 'result',
        ],
        'takeCommentRecovery',
        error,
      )
      if (root.schema !== 'jason.qingmu-take-comment-recovery.v1'
        || root.projectId !== request.projectId || root.episodeId !== request.episodeId
        || root.frameId !== request.frameId || root.takeId !== request.takeId
        || root.expectedTakeSubjectSha256 !== request.expectedTakeSubjectSha256
        || root.idempotencyKey !== request.idempotencyKey
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)
        || (root.status === 'committed' && root.result === null)) {
        throw error('takeCommentRecovery binding mismatch')
      }
      return {
        schema: 'jason.qingmu-take-comment-recovery.v1',
        projectId: request.projectId,
        episodeId: request.episodeId,
        frameId: request.frameId,
        takeId: request.takeId,
        expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
        idempotencyKey: request.idempotencyKey,
        status: root.status,
        result: root.status === 'committed' ? normalizeResult(root.result, request, helpers) : null,
      }
    },
  }
}
