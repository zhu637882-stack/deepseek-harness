/** Strict read validation for separate Take recommendations and HumanDecisions. */
import type {
  YimengTakeCommentSubject,
  YimengTakeCommentVersion,
  YimengTakeHumanDecision,
  YimengTakeReviewAction,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewAuthorityRequest,
  YimengTakeReviewRecommendation,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'takeId', 'versionOrdinal', 'outputSha256', 'durationMillis',
] as const
const RECOMMENDATION_FIELDS = [
  'id', 'takeSubject', 'takeSubjectSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'eventId', 'recommendation', 'reason',
  'recommendedAt', 'currentBinding',
] as const
const DECISION_FIELDS = [
  'decisionId', 'subjectType', 'subjectId', 'subjectRevision', 'subjectSha256',
  'takeSubject', 'takeSubjectSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'eventId', 'decision', 'reason',
  'producerActorId', 'producerNaturalPersonId', 'participantNaturalPersonIds',
  'decidedAt', 'currentBinding',
] as const
const ACTIONS = new Set<YimengTakeReviewAction>(['approve', 'reject', 'request_changes'])
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`take review authority: ${field} fields mismatch`)
  }
  return value as Record<string, unknown>
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum: number, nonempty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || (nonempty && pythonStrip(value) === '')) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return value
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256, true)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return value
}

function integer(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 128, true)
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return result
}

function action(value: unknown, field: string): YimengTakeReviewAction {
  if (typeof value !== 'string' || !ACTIONS.has(value as YimengTakeReviewAction)) {
    throw new Error(`take review authority: ${field} is invalid`)
  }
  return value as YimengTakeReviewAction
}

/**
 * Accept only the canonical Shot coordinates from the browser.
 * @param payload - Untrusted command payload to validate.
 * @returns Validated YimengTakeReviewAuthorityRequest value.
 */
export function parseTakeReviewAuthorityRequest(payload: unknown): YimengTakeReviewAuthorityRequest {
  const input = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
  return {
    projectId: id(input.projectId, 'projectId'),
    episodeId: id(input.episodeId, 'episodeId'),
    frameId: id(input.frameId, 'frameId'),
  }
}

function subject(
  value: unknown,
  request: YimengTakeReviewAuthorityRequest,
  field: string,
): YimengTakeCommentSubject {
  const item = exact(value, SUBJECT_FIELDS, field)
  if (item.schema !== 'jason.qingmu-take-comment-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId) {
    throw new Error(`take review authority: ${field} subject mismatch`)
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
  request: YimengTakeReviewAuthorityRequest,
  digest: Digest,
  index: number,
): YimengTakeCommentVersion {
  const field = `versions[${String(index)}]`
  const item = exact(value, ['takeSubject', 'takeSubjectSha256'], field)
  const takeSubject = subject(item.takeSubject, request, `${field}.takeSubject`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  if (digest(takeSubject, `${field}.takeSubject`) !== takeSubjectSha256) {
    throw new Error(`take review authority: ${field} digest mismatch`)
  }
  return { takeSubject, takeSubjectSha256 }
}

function isCurrent(
  takeSubject: YimengTakeCommentSubject,
  takeSubjectSha256: string,
  versions: readonly YimengTakeCommentVersion[],
): boolean {
  const current = versions.find(item => item.takeSubject.takeId === takeSubject.takeId)
  return current !== undefined
    && current.takeSubjectSha256 === takeSubjectSha256
    && current.takeSubject.versionOrdinal === takeSubject.versionOrdinal
    && current.takeSubject.outputSha256 === takeSubject.outputSha256
    && current.takeSubject.storyboardRevision === takeSubject.storyboardRevision
    && current.takeSubject.frameContentSha256 === takeSubject.frameContentSha256
}

function recommendation(
  value: unknown,
  request: YimengTakeReviewAuthorityRequest,
  versions: readonly YimengTakeCommentVersion[],
  digest: Digest,
  index: number,
): YimengTakeReviewRecommendation {
  const field = `recommendations[${String(index)}]`
  const item = exact(value, RECOMMENDATION_FIELDS, field)
  const takeSubject = subject(item.takeSubject, request, `${field}.takeSubject`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  const currentBinding = isCurrent(takeSubject, takeSubjectSha256, versions)
  if (digest(takeSubject, `${field}.takeSubject`) !== takeSubjectSha256
    || item.actorRole !== 'reviewer' || item.currentBinding !== currentBinding) {
    throw new Error(`take review authority: ${field} binding mismatch`)
  }
  return {
    id: id(item.id, `${field}.id`),
    takeSubject,
    takeSubjectSha256,
    actorId: id(item.actorId, `${field}.actorId`),
    actorRole: 'reviewer',
    actorNaturalPersonId: id(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`),
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    eventId: id(item.eventId, `${field}.eventId`),
    recommendation: action(item.recommendation, `${field}.recommendation`),
    reason: text(item.reason, `${field}.reason`, 8_000, true),
    recommendedAt: timestamp(item.recommendedAt, `${field}.recommendedAt`),
    currentBinding,
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

function decision(
  value: unknown,
  request: YimengTakeReviewAuthorityRequest,
  versions: readonly YimengTakeCommentVersion[],
  digest: Digest,
  field: string,
): YimengTakeHumanDecision {
  const item = exact(value, DECISION_FIELDS, field)
  const takeSubject = subject(item.takeSubject, request, `${field}.takeSubject`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  const currentBinding = isCurrent(takeSubject, takeSubjectSha256, versions)
  if (digest(takeSubject, `${field}.takeSubject`) !== takeSubjectSha256
    || item.subjectType !== 'shot_take' || item.subjectId !== takeSubject.takeId
    || item.subjectRevision !== takeSubject.versionOrdinal || item.subjectSha256 !== takeSubjectSha256
    || item.actorRole !== 'approver' || item.currentBinding !== currentBinding
    || !Array.isArray(item.participantNaturalPersonIds)) {
    throw new Error(`take review authority: ${field} binding mismatch`)
  }
  const participants = item.participantNaturalPersonIds.map((entry, index) =>
    id(entry, `${field}.participantNaturalPersonIds[${String(index)}]`))
  const sortedParticipants = [...participants].sort(compareUnicodeCodePoints)
  if (new Set(participants).size !== participants.length
    || participants.some((entry, index) => sortedParticipants[index] !== entry)) {
    throw new Error(`take review authority: ${field} participants mismatch`)
  }
  const producerNaturalPersonId = id(
    item.producerNaturalPersonId,
    `${field}.producerNaturalPersonId`,
  )
  const actorNaturalPersonId = id(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`)
  if (!participants.includes(producerNaturalPersonId)
    || participants.includes(actorNaturalPersonId)) {
    throw new Error(`take review authority: ${field} producer participant missing`)
  }
  return {
    decisionId: id(item.decisionId, `${field}.decisionId`),
    subjectType: 'shot_take',
    subjectId: takeSubject.takeId,
    subjectRevision: takeSubject.versionOrdinal,
    subjectSha256: takeSubjectSha256,
    takeSubject,
    takeSubjectSha256,
    actorId: id(item.actorId, `${field}.actorId`),
    actorRole: 'approver',
    actorNaturalPersonId,
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    eventId: id(item.eventId, `${field}.eventId`),
    decision: action(item.decision, `${field}.decision`),
    reason: text(item.reason, `${field}.reason`, 8_000, true),
    producerActorId: id(item.producerActorId, `${field}.producerActorId`),
    producerNaturalPersonId,
    participantNaturalPersonIds: participants,
    decidedAt: timestamp(item.decidedAt, `${field}.decidedAt`),
    currentBinding,
  }
}

/**
 * Validate exact subjects, role-separated history, and the derived current decision.
 * @param value - Untrusted value to validate and normalize.
 * @param request - Request coordinates and payload to process.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengTakeReviewAuthorityFeedResponse value.
 */
export function normalizeTakeReviewAuthorityFeed(
  value: unknown,
  request: YimengTakeReviewAuthorityRequest,
  digest: Digest,
): YimengTakeReviewAuthorityFeedResponse {
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'capabilities', 'versions',
    'recommendations', 'decisions', 'currentDecision', 'boundaries',
  ], 'feed')
  if (root.schema !== 'jason.qingmu-take-review-authority-feed.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId || !Array.isArray(root.versions)
    || !Array.isArray(root.recommendations) || !Array.isArray(root.decisions)) {
    throw new Error('take review authority: feed mismatch')
  }
  const capabilities = exact(root.capabilities, ['canReview', 'canDecide'], 'capabilities')
  if (typeof capabilities.canReview !== 'boolean' || typeof capabilities.canDecide !== 'boolean') {
    throw new Error('take review authority: capabilities mismatch')
  }
  const versions = root.versions.map((entry, index) => version(entry, request, digest, index))
  if (new Set(versions.map(entry => entry.takeSubject.takeId)).size !== versions.length
    || new Set(versions.map(entry => entry.takeSubjectSha256)).size !== versions.length) {
    throw new Error('take review authority: current versions are ambiguous')
  }
  const recommendations = root.recommendations.map((entry, index) =>
    recommendation(entry, request, versions, digest, index))
  const decisions = root.decisions.map((entry, index) =>
    decision(entry, request, versions, digest, `decisions[${String(index)}]`))
  const expectedCurrent = [...decisions].reverse().find(entry => entry.currentBinding) ?? null
  const currentDecision = root.currentDecision === null
    ? null
    : decision(root.currentDecision, request, versions, digest, 'currentDecision')
  if ((currentDecision === null) !== (expectedCurrent === null)
    || (currentDecision !== null && expectedCurrent !== null
      && digest(currentDecision, 'currentDecision') !== digest(expectedCurrent, 'expectedCurrent'))) {
    throw new Error('take review authority: currentDecision mismatch')
  }
  const boundaries = exact(root.boundaries, [
    'reviewerRecommendationIsApproval', 'decisionMutatesTakeState',
    'roleOrSessionSwitchCanBypassNaturalPersonSeparation',
  ], 'boundaries')
  if (boundaries.reviewerRecommendationIsApproval !== false
    || boundaries.decisionMutatesTakeState !== false
    || boundaries.roleOrSessionSwitchCanBypassNaturalPersonSeparation !== false) {
    throw new Error('take review authority: boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-take-review-authority-feed.v1',
    ...request,
    capabilities: {
      canReview: capabilities.canReview,
      canDecide: capabilities.canDecide,
    },
    versions,
    recommendations,
    decisions,
    currentDecision,
    boundaries: {
      reviewerRecommendationIsApproval: false,
      decisionMutatesTakeState: false,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false,
    },
  }
}
