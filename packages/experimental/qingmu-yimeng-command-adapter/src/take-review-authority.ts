/** Separate Reviewer recommendation and Approver HumanDecision commands. */
import type {
  YimengCommandJsonObject,
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeHumanDecisionRecord,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengTakeReviewAction,
  YimengTakeReviewRecommendationRecord,
  YimengTakeReviewRecommendationRecovery,
  YimengTakeReviewRecommendationResult,
  YimengTakeReviewSubject,
} from './types.ts'

const COMMON_REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
  'takeId', 'reason', 'idempotencyKey',
] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'takeId', 'versionOrdinal', 'outputSha256', 'durationMillis',
] as const
const RECOMMENDATION_FIELDS = [
  'id', 'takeSubject', 'takeSubjectSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'eventId', 'recommendation', 'reason',
  'recommendedAt',
] as const
const DECISION_FIELDS = [
  'decisionId', 'subjectType', 'subjectId', 'subjectRevision', 'subjectSha256',
  'takeSubject', 'takeSubjectSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'eventId', 'decision', 'reason',
  'producerActorId', 'producerNaturalPersonId', 'participantNaturalPersonIds',
  'decidedAt',
] as const
const RESULT_FLAGS = [
  'decisionRecorded', 'recommendationOnly', 'changed', 'selectionChanged',
  'technicalPassChanged', 'formalApprovalChanged', 'episodeVerificationChanged',
  'humanSignoffInferred', 'providerCalls', 'budgetMutation',
] as const
const ACTIONS = new Set<YimengTakeReviewAction>(['approve', 'reject', 'request_changes'])
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/u

type ErrorFactory = (message: string) => Error
type RecommendationRequest = YimengCreateTakeReviewRecommendationRequest
type DecisionRequest = YimengCreateTakeHumanDecisionRequest
type ReviewRequest = RecommendationRequest | DecisionRequest
type ReviewResult = YimengTakeReviewRecommendationResult | YimengTakeHumanDecisionResult
type ReviewRecovery = YimengTakeReviewRecommendationRecovery | YimengTakeHumanDecisionRecovery

interface TakeReviewHelpers {
  readonly canonicalJsonSha256: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly requireTimestamp: (value: unknown, field: string) => string
}

interface PreparedTakeReviewCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey: string
  }
  readonly normalize: (value: unknown, token: string) => ReviewResult | ReviewRecovery
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

function action(value: unknown, field: string, error: ErrorFactory): YimengTakeReviewAction {
  if (typeof value !== 'string' || !ACTIONS.has(value as YimengTakeReviewAction)) {
    throw error(`${field} must be approve, reject, or request_changes`)
  }
  return value as YimengTakeReviewAction
}

function requestCoordinates(
  endpoint: string,
  value: unknown,
  error: ErrorFactory,
): ReviewRequest {
  const recommendation = endpoint.endsWith('ReviewRecommendation')
  const actionField = recommendation ? 'recommendation' : 'decision'
  const item = exact(value, [...COMMON_REQUEST_FIELDS, actionField], 'payload', error)
  const idempotencyKey = text(item.idempotencyKey, 200, 'idempotencyKey', error, true)
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw error('idempotencyKey must use visible ASCII')
  const common = {
    projectId: id(item.projectId, 'projectId', error),
    episodeId: id(item.episodeId, 'episodeId', error),
    frameId: id(item.frameId, 'frameId', error),
    expectedTakeSubjectSha256: sha(
      item.expectedTakeSubjectSha256,
      'expectedTakeSubjectSha256',
      error,
    ),
    takeId: id(item.takeId, 'takeId', error),
    reason: text(item.reason, 8_000, 'reason', error),
    idempotencyKey,
  }
  return recommendation
    ? { ...common, recommendation: action(item.recommendation, 'recommendation', error) }
    : { ...common, decision: action(item.decision, 'decision', error) }
}

function subject(
  value: unknown,
  request: ReviewRequest,
  field: string,
  error: ErrorFactory,
): YimengTakeReviewSubject {
  const item = exact(value, SUBJECT_FIELDS, field, error)
  if (item.schema !== 'jason.qingmu-take-comment-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || item.takeId !== request.takeId) {
    throw error(`${field} differs from the submitted exact Take`)
  }
  return {
    schema: 'jason.qingmu-take-comment-subject.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    frameId: request.frameId,
    frameNo: integer(item.frameNo, `${field}.frameNo`, 1, error),
    storyboardRevision: integer(item.storyboardRevision, `${field}.storyboardRevision`, 0, error),
    frameContentSha256: sha(item.frameContentSha256, `${field}.frameContentSha256`, error),
    takeId: request.takeId,
    versionOrdinal: integer(item.versionOrdinal, `${field}.versionOrdinal`, 1, error),
    outputSha256: sha(item.outputSha256, `${field}.outputSha256`, error),
    durationMillis: integer(item.durationMillis, `${field}.durationMillis`, 0, error),
  }
}

function normalizeRecommendation(
  value: unknown,
  request: RecommendationRequest,
  helpers: TakeReviewHelpers,
): YimengTakeReviewRecommendationRecord {
  const error = helpers.responseError
  const item = exact(value, RECOMMENDATION_FIELDS, 'takeReviewResult.recommendation', error)
  const takeSubject = subject(
    item.takeSubject,
    request,
    'takeReviewResult.recommendation.takeSubject',
    error,
  )
  if (item.takeSubjectSha256 !== request.expectedTakeSubjectSha256
    || helpers.canonicalJsonSha256(
      takeSubject,
      'takeReviewResult.recommendation.takeSubject',
    ) !== request.expectedTakeSubjectSha256
    || item.actorRole !== 'reviewer' || item.recommendation !== request.recommendation
    || item.reason !== request.reason) {
    throw error('takeReviewResult.recommendation differs from submitted intent')
  }
  return {
    id: id(item.id, 'takeReviewResult.recommendation.id', error),
    takeSubject,
    takeSubjectSha256: request.expectedTakeSubjectSha256,
    actorId: id(item.actorId, 'takeReviewResult.recommendation.actorId', error),
    actorRole: 'reviewer',
    actorNaturalPersonId: id(
      item.actorNaturalPersonId,
      'takeReviewResult.recommendation.actorNaturalPersonId',
      error,
    ),
    authSessionId: sha(item.authSessionId, 'takeReviewResult.recommendation.authSessionId', error),
    eventId: id(item.eventId, 'takeReviewResult.recommendation.eventId', error),
    recommendation: request.recommendation,
    reason: request.reason,
    recommendedAt: helpers.requireTimestamp(
      item.recommendedAt,
      'takeReviewResult.recommendation.recommendedAt',
    ),
  }
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function normalizeDecision(
  value: unknown,
  request: DecisionRequest,
  helpers: TakeReviewHelpers,
): YimengTakeHumanDecisionRecord {
  const error = helpers.responseError
  const item = exact(value, DECISION_FIELDS, 'takeReviewResult.decision', error)
  const takeSubject = subject(item.takeSubject, request, 'takeReviewResult.decision.takeSubject', error)
  if (item.subjectType !== 'shot_take' || item.subjectId !== request.takeId
    || item.subjectRevision !== takeSubject.versionOrdinal
    || item.subjectSha256 !== request.expectedTakeSubjectSha256
    || item.takeSubjectSha256 !== request.expectedTakeSubjectSha256
    || helpers.canonicalJsonSha256(
      takeSubject,
      'takeReviewResult.decision.takeSubject',
    ) !== request.expectedTakeSubjectSha256
    || item.actorRole !== 'approver' || item.decision !== request.decision
    || item.reason !== request.reason || !Array.isArray(item.participantNaturalPersonIds)) {
    throw error('takeReviewResult.decision differs from submitted intent')
  }
  const participants = item.participantNaturalPersonIds.map((entry, index) =>
    id(entry, `takeReviewResult.decision.participantNaturalPersonIds[${String(index)}]`, error))
  const producerNaturalPersonId = id(
    item.producerNaturalPersonId,
    'takeReviewResult.decision.producerNaturalPersonId',
    error,
  )
  const actorNaturalPersonId = id(
    item.actorNaturalPersonId,
    'takeReviewResult.decision.actorNaturalPersonId',
    error,
  )
  const sortedParticipants = [...participants].sort(compareUnicodeCodePoints)
  if (new Set(participants).size !== participants.length
    || participants.some((entry, index) => sortedParticipants[index] !== entry)
    || !participants.includes(producerNaturalPersonId)
    || participants.includes(actorNaturalPersonId)) {
    throw error('takeReviewResult.decision participant separation mismatch')
  }
  return {
    decisionId: id(item.decisionId, 'takeReviewResult.decision.decisionId', error),
    subjectType: 'shot_take',
    subjectId: request.takeId,
    subjectRevision: takeSubject.versionOrdinal,
    subjectSha256: request.expectedTakeSubjectSha256,
    takeSubject,
    takeSubjectSha256: request.expectedTakeSubjectSha256,
    actorId: id(item.actorId, 'takeReviewResult.decision.actorId', error),
    actorRole: 'approver',
    actorNaturalPersonId,
    authSessionId: sha(item.authSessionId, 'takeReviewResult.decision.authSessionId', error),
    eventId: id(item.eventId, 'takeReviewResult.decision.eventId', error),
    decision: request.decision,
    reason: request.reason,
    producerActorId: id(item.producerActorId, 'takeReviewResult.decision.producerActorId', error),
    producerNaturalPersonId,
    participantNaturalPersonIds: participants,
    decidedAt: helpers.requireTimestamp(item.decidedAt, 'takeReviewResult.decision.decidedAt'),
  }
}

function normalizeResult(
  value: unknown,
  request: ReviewRequest,
  helpers: TakeReviewHelpers,
): ReviewResult {
  const error = helpers.responseError
  const isRecommendation = 'recommendation' in request
  const recordKey = isRecommendation ? 'recommendation' : 'decision'
  const root = exact(value, ['schema', recordKey, ...RESULT_FLAGS], 'takeReviewResult', error)
  if (root.changed !== false || root.selectionChanged !== false
    || root.technicalPassChanged !== false || root.formalApprovalChanged !== false
    || root.episodeVerificationChanged !== false || root.humanSignoffInferred !== false
    || root.providerCalls !== 0 || root.budgetMutation !== false) {
    throw error('takeReviewResult impact flags mismatch')
  }
  if (isRecommendation) {
    if (root.schema !== 'jason.qingmu-take-review-recommendation-result.v1'
      || root.decisionRecorded !== false || root.recommendationOnly !== true) {
      throw error('takeReviewResult recommendation authority mismatch')
    }
    return {
      schema: 'jason.qingmu-take-review-recommendation-result.v1',
      recommendation: normalizeRecommendation(root.recommendation, request, helpers),
      decisionRecorded: false,
      recommendationOnly: true,
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
  if (root.schema !== 'jason.qingmu-take-human-decision-result.v1'
    || root.decisionRecorded !== true || root.recommendationOnly !== false) {
    throw error('takeReviewResult decision authority mismatch')
  }
  return {
    schema: 'jason.qingmu-take-human-decision-result.v1',
    decision: normalizeDecision(root.decision, request, helpers),
    decisionRecorded: true,
    recommendationOnly: false,
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
 * Prepare one exact POST or the only allowed GET receipt recovery coordinate.
 * @param endpoint - Command endpoint selected by the caller.
 * @param payload - Untrusted command payload to validate.
 * @param helpers - Canonicalization and digest helpers for command preparation.
 * @returns Prepared command and recovery metadata.
 */
export function prepareTakeReviewCommand(
  endpoint:
    | 'createTakeReviewRecommendation'
    | 'recoverTakeReviewRecommendation'
    | 'createTakeHumanDecision'
    | 'recoverTakeHumanDecision',
  payload: unknown,
  helpers: TakeReviewHelpers,
): PreparedTakeReviewCommand {
  const request = requestCoordinates(endpoint, payload, helpers.inputError)
  const recommendation = 'recommendation' in request
  const rootPath = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
    + `/episodes/${encodeURIComponent(request.episodeId)}`
    + `/frames/${encodeURIComponent(request.frameId)}/take-review-authority`
  const kindPath = recommendation ? 'recommendations' : 'decisions'
  if (endpoint.startsWith('create')) {
    const actionBody = recommendation
      ? { recommendation: request.recommendation }
      : { decision: request.decision }
    return {
      path: `${rootPath}/${kindPath}`,
      request: {
        method: 'POST',
        body: {
          expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
          takeId: request.takeId,
          ...actionBody,
          reason: request.reason,
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
    path: `${rootPath}/${kindPath}/command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(value, [
        'schema', 'commandType', 'projectId', 'episodeId', 'frameId', 'takeId',
        'expectedTakeSubjectSha256', 'idempotencyKey', 'status', 'result',
      ], 'takeReviewRecovery', error)
      const commandType = recommendation
        ? 'qingmu.take_review.recommendation.record.v1'
        : 'qingmu.take_human_decision.record.v1'
      if (root.schema !== 'jason.qingmu-take-review-command-recovery.v1'
        || root.commandType !== commandType || root.projectId !== request.projectId
        || root.episodeId !== request.episodeId || root.frameId !== request.frameId
        || root.takeId !== request.takeId
        || root.expectedTakeSubjectSha256 !== request.expectedTakeSubjectSha256
        || root.idempotencyKey !== request.idempotencyKey
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)
        || (root.status === 'committed' && root.result === null)) {
        throw error('takeReviewRecovery binding mismatch')
      }
      const result = root.status === 'committed'
        ? normalizeResult(root.result, request, helpers)
        : null
      return {
        schema: 'jason.qingmu-take-review-command-recovery.v1',
        commandType,
        projectId: request.projectId,
        episodeId: request.episodeId,
        frameId: request.frameId,
        takeId: request.takeId,
        expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
        idempotencyKey: request.idempotencyKey,
        status: root.status,
        result,
      } as ReviewRecovery
    },
  }
}
