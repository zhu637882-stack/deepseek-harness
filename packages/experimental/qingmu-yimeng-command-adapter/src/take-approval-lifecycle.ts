/** Record one immutable E7-4 approval lifecycle transition. */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengCommandJsonObject,
  YimengImagoTakeApprovalLifecycleMethodAttestation,
  YimengImagoTakeApprovalLifecycleMethodProjection,
  YimengTakeApprovalLifecycleAction,
  YimengTakeApprovalLifecycleDefinition,
  YimengTakeApprovalLifecycleMethodTransition,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTakeApprovalLifecycleState,
  YimengTakeApprovalLifecycleTransition,
  YimengTakeTechnicalQcSubject,
  YimengTransitionTakeApprovalLifecycleRequest,
} from './types.ts'

const ACTIONS = ['APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT'] as const
const STATES = [
  'READY_FOR_APPROVAL', 'APPROVED', 'APPROVAL_INVALIDATED_PENDING_EVENT',
  'REWORK_REQUIRED', 'REWORK_RECORDED', 'READY_TO_RESUBMIT',
  'IN_REVIEW', 'METHOD_REVIEW_REQUIRED', 'AWAITING_REVIEW',
] as const
const REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedSourceSnapshotSha256',
  'takeId', 'action', 'reason', 'idempotencyKey',
] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'takeId', 'versionOrdinal',
  'selectionStatus', 'outputSha256', 'taskId', 'capability', 'routeKey', 'provider',
  'model', 'inputHash', 'submitId',
] as const
const METHOD_FIELDS = [
  'schema', 'subject', 'subjectSnapshotSha256', 'sourceSnapshotSha256',
  'definition', 'transition', 'ruleBindings', 'rulesSha256',
] as const
const METHOD_RESPONSE_FIELDS = [
  'schema', 'projection', 'projectionSha256', 'methodAttestation',
] as const
const METHOD_TRANSITION_FIELDS = [
  'state', 'legalActions', 'currentApprovalId', 'staleApprovalId',
  'invalidationReasons', 'reworkClassCodes', 'sameClassReworkCount',
  'sameClassCountAfterRequest', 'methodReviewRequired',
  'methodReviewRequiredAfterRequest', 'resubmitSourceReworkId',
  'approvalInherited', 'boundedFindingRouteRequired',
] as const
const TRANSITION_FIELDS = [
  'transitionId', 'revision', 'action', 'takeId', 'takeVersionOrdinal',
  'takeSubjectSha256', 'decisionId', 'decisionEventId', 'assessmentId',
  'assessmentEventId', 'sourceApprovalId', 'sourceReworkId', 'defectClassCodes',
  'reason', 'actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId',
  'recordedAt', 'eventId', 'methodProjectionSha256', 'rulesSha256',
] as const
const RESULT_FIELDS = [
  'schema', 'transition', 'sourceSnapshotSha256', 'authoritativeSourceSnapshotSha256',
  'methodReviewRequiredAfterRequest', 'boundedFindingRouteRequired', 'changed',
  'formalApprovalChanged', 'approvalInvalidated', 'reworkRequested', 'resubmitted',
  'selectionChanged', 'technicalPassChanged', 'reviewDecisionChanged',
  'reworkExecuted', 'providerCalls', 'budgetMutation', 'episodeVerificationChanged',
  'humanSignoffInferred', 'evidenceLedgerMutation',
] as const
const RULE_PATHS = [
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_approval_lifecycle_method.py',
] as const
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/u
const SHA256 = /^[0-9a-f]{64}$/u

type ErrorFactory = (message: string) => Error
interface Helpers {
  readonly canonicalJson: (value: unknown, field: string) => string
  readonly canonicalJsonSha256: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly readAttestationKey: () => string
  readonly requireTimestamp: (value: unknown, field: string) => string
}

interface VerifiedMethod {
  readonly projection: YimengImagoTakeApprovalLifecycleMethodProjection
  readonly projectionSha256: string
  readonly attestation: YimengImagoTakeApprovalLifecycleMethodAttestation
  readonly subject: YimengTakeTechnicalQcSubject
  readonly transition: YimengTakeApprovalLifecycleMethodTransition
  readonly rulesSha256: string
}

interface PreparedCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey: string
  }
  readonly normalize: (value: unknown, token: string) =>
  YimengTakeApprovalLifecycleResult | YimengTakeApprovalLifecycleRecovery
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw error(`${field} must be an object`)
  }
  return value as YimengCommandJsonObject
}

function exact(
  value: unknown,
  fields: readonly string[],
  field: string,
  error: ErrorFactory,
): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (Object.keys(item).length !== fields.length
    || Object.keys(item).some(key => !fields.includes(key))) {
    throw error(`${field} has invalid fields`)
  }
  return item
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
    || Array.from(value).length > maximum || pythonStrip(value) === '') {
    throw error(`${field} must be bounded Unicode text`)
  }
  if (identifier && (value !== pythonStrip(value) || /[\r\n]/u.test(value))) {
    throw error(`${field} must be canonical identifier text`)
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

function integer(value: unknown, minimum: number, field: string, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  }
  return value
}

function bool(value: unknown, field: string, error: ErrorFactory): boolean {
  if (typeof value !== 'boolean') throw error(`${field} must be boolean`)
  return value
}

function nullableId(value: unknown, field: string, error: ErrorFactory): string | null {
  return value === null ? null : id(value, field, error)
}

function nullableText(value: unknown, field: string, error: ErrorFactory): string | null {
  return value === null ? null : text(value, 1024, field, error)
}

function nullableSha(value: unknown, field: string, error: ErrorFactory): string | null {
  return value === null ? null : sha(value, field, error)
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

function canonicalCodes(value: unknown, field: string, error: ErrorFactory): readonly string[] {
  if (!Array.isArray(value) || value.length > 128) throw error(`${field} must be a bounded array`)
  const codes = value.map((entry, index) => id(entry, `${field}[${String(index)}]`, error))
  const normalized = [...new Set(codes)].sort(compareUnicodeCodePoints)
  if (!isDeepStrictEqual(codes, normalized)) throw error(`${field} must be unique and canonical`)
  return codes
}

function actionList(value: unknown, field: string, error: ErrorFactory): readonly YimengTakeApprovalLifecycleAction[] {
  if (!Array.isArray(value)
    || value.some(action => !ACTIONS.includes(action as typeof ACTIONS[number]))) {
    throw error(`${field} contains an invalid action`)
  }
  const actions = value as YimengTakeApprovalLifecycleAction[]
  const canonical = ACTIONS.filter(action => actions.includes(action))
  if (!isDeepStrictEqual(actions, canonical)) throw error(`${field} must be unique and canonical`)
  return actions
}

function request(
  value: unknown,
  error: ErrorFactory,
): YimengTransitionTakeApprovalLifecycleRequest {
  const item = exact(value, REQUEST_FIELDS, 'payload', error)
  const idempotencyKey = id(item.idempotencyKey, 'idempotencyKey', error)
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw error('idempotencyKey must use visible ASCII')
  if (!ACTIONS.includes(item.action as typeof ACTIONS[number])) throw error('action is invalid')
  return {
    projectId: id(item.projectId, 'projectId', error),
    episodeId: id(item.episodeId, 'episodeId', error),
    frameId: id(item.frameId, 'frameId', error),
    expectedSourceSnapshotSha256: sha(
      item.expectedSourceSnapshotSha256,
      'expectedSourceSnapshotSha256',
      error,
    ),
    takeId: id(item.takeId, 'takeId', error),
    action: item.action as YimengTakeApprovalLifecycleAction,
    reason: text(item.reason, 8_000, 'reason', error),
    idempotencyKey,
  }
}

function subject(
  value: unknown,
  intent: YimengTransitionTakeApprovalLifecycleRequest,
  field: string,
  error: ErrorFactory,
): YimengTakeTechnicalQcSubject {
  const item = exact(value, SUBJECT_FIELDS, field, error)
  if (item.schema !== 'jason.qingmu-take-acceptance-subject.v1'
    || item.projectId !== intent.projectId || item.episodeId !== intent.episodeId
    || item.frameId !== intent.frameId || item.takeId !== intent.takeId
    || item.selectionStatus !== 'Selected') {
    throw error(`${field} binding mismatch`)
  }
  return {
    schema: 'jason.qingmu-take-acceptance-subject.v1',
    projectId: intent.projectId,
    episodeId: intent.episodeId,
    frameId: intent.frameId,
    frameNo: integer(item.frameNo, 1, `${field}.frameNo`, error),
    storyboardRevision: integer(item.storyboardRevision, 0, `${field}.storyboardRevision`, error),
    frameContentSha256: sha(item.frameContentSha256, `${field}.frameContentSha256`, error),
    selectionRevision: integer(item.selectionRevision, 0, `${field}.selectionRevision`, error),
    takeId: intent.takeId,
    versionOrdinal: integer(item.versionOrdinal, 1, `${field}.versionOrdinal`, error),
    selectionStatus: 'Selected',
    outputSha256: nullableSha(item.outputSha256, `${field}.outputSha256`, error),
    taskId: nullableId(item.taskId, `${field}.taskId`, error),
    capability: nullableText(item.capability, `${field}.capability`, error),
    routeKey: nullableText(item.routeKey, `${field}.routeKey`, error),
    provider: nullableText(item.provider, `${field}.provider`, error),
    model: nullableText(item.model, `${field}.model`, error),
    inputHash: nullableSha(item.inputHash, `${field}.inputHash`, error),
    submitId: nullableId(item.submitId, `${field}.submitId`, error),
  }
}

function methodDefinition(value: unknown, error: ErrorFactory): YimengTakeApprovalLifecycleDefinition {
  const definition = exact(value, [
    'mode', 'actions', 'approvalRequires', 'invalidation', 'rework',
    'resubmission', 'boundaries',
  ], 'methodProjection.definition', error)
  const invalidation = exact(definition.invalidation, [
    'sourceDriftIsImmediate', 'auditableEventRequired', 'oldApprovalMayNotBeInherited',
  ], 'methodProjection.definition.invalidation', error)
  const rework = exact(definition.rework, [
    'boundedFindingRouteRequired', 'oneEarliestOwnerPerDefect', 'executionAllowed',
    'paidGenerationAuthorized', 'automaticRetry', 'thirdSameClassRequiresMethodReview',
  ], 'methodProjection.definition.rework', error)
  const resubmission = exact(definition.resubmission, [
    'newTakeRevisionRequired', 'editIsApproval', 'approvalInherited',
  ], 'methodProjection.definition.resubmission', error)
  const boundaries = exact(definition.boundaries, [
    'businessTruth', 'selectionChanged', 'technicalPassChanged', 'reviewDecisionChanged',
    'reworkExecuted', 'providerCalls', 'budgetMutation', 'episodeVerificationChanged',
    'humanSignoffInferred', 'evidenceLedgerMutation',
  ], 'methodProjection.definition.boundaries', error)
  const expected = {
    mode: 'STATELESS_TAKE_APPROVAL_LIFECYCLE_METHOD',
    actions: ACTIONS,
    approvalRequires: [
      'CURRENT_SELECTED_TAKE', 'CURRENT_APPROVER_APPROVE_DECISION',
      'CURRENT_TECHNICAL_QC_PASS', 'CURRENT_RULE_BINDING',
    ],
    invalidation: {
      sourceDriftIsImmediate: true, auditableEventRequired: true,
      oldApprovalMayNotBeInherited: true,
    },
    rework: {
      boundedFindingRouteRequired: true, oneEarliestOwnerPerDefect: true,
      executionAllowed: false, paidGenerationAuthorized: false,
      automaticRetry: false, thirdSameClassRequiresMethodReview: true,
    },
    resubmission: {
      newTakeRevisionRequired: true, editIsApproval: false, approvalInherited: false,
    },
    boundaries: {
      businessTruth: 'yimeng', selectionChanged: false, technicalPassChanged: false,
      reviewDecisionChanged: false, reworkExecuted: false, providerCalls: 0,
      budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    },
  }
  const normalized = {
    mode: definition.mode,
    actions: definition.actions,
    approvalRequires: definition.approvalRequires,
    invalidation,
    rework,
    resubmission,
    boundaries,
  }
  if (!isDeepStrictEqual(normalized, expected)) throw error('methodProjection definition mismatch')
  return normalized as YimengTakeApprovalLifecycleDefinition
}

function methodTransition(
  value: unknown,
  error: ErrorFactory,
): YimengTakeApprovalLifecycleMethodTransition {
  const item = exact(value, METHOD_TRANSITION_FIELDS, 'methodProjection.transition', error)
  if (!STATES.includes(item.state as typeof STATES[number])) {
    throw error('methodProjection.transition state mismatch')
  }
  const state = item.state as YimengTakeApprovalLifecycleState
  const legalActions = actionList(item.legalActions, 'methodProjection.transition.legalActions', error)
  const currentApprovalId = nullableId(
    item.currentApprovalId,
    'methodProjection.transition.currentApprovalId',
    error,
  )
  const staleApprovalId = nullableId(
    item.staleApprovalId,
    'methodProjection.transition.staleApprovalId',
    error,
  )
  const invalidationReasons = canonicalCodes(
    item.invalidationReasons,
    'methodProjection.transition.invalidationReasons',
    error,
  )
  const reworkClassCodes = canonicalCodes(
    item.reworkClassCodes,
    'methodProjection.transition.reworkClassCodes',
    error,
  )
  const sameClassReworkCount = integer(
    item.sameClassReworkCount,
    0,
    'methodProjection.transition.sameClassReworkCount',
    error,
  )
  const sameClassCountAfterRequest = integer(
    item.sameClassCountAfterRequest,
    0,
    'methodProjection.transition.sameClassCountAfterRequest',
    error,
  )
  const methodReviewRequired = bool(
    item.methodReviewRequired,
    'methodProjection.transition.methodReviewRequired',
    error,
  )
  const methodReviewRequiredAfterRequest = bool(
    item.methodReviewRequiredAfterRequest,
    'methodProjection.transition.methodReviewRequiredAfterRequest',
    error,
  )
  const resubmitSourceReworkId = nullableId(
    item.resubmitSourceReworkId,
    'methodProjection.transition.resubmitSourceReworkId',
    error,
  )
  const boundedFindingRouteRequired = bool(
    item.boundedFindingRouteRequired,
    'methodProjection.transition.boundedFindingRouteRequired',
    error,
  )
  const canRequestRework = legalActions.includes('REQUEST_REWORK')
  if (item.approvalInherited !== false
    || sameClassCountAfterRequest !== sameClassReworkCount + (canRequestRework ? 1 : 0)
    || methodReviewRequiredAfterRequest !== (canRequestRework && sameClassCountAfterRequest >= 3)
    || boundedFindingRouteRequired !== (reworkClassCodes.length > 0)
    || (state === 'APPROVED') !== (currentApprovalId !== null)
    || (state === 'APPROVAL_INVALIDATED_PENDING_EVENT') !== (staleApprovalId !== null)
    || (legalActions.includes('APPROVE') && state !== 'READY_FOR_APPROVAL')
    || (legalActions.includes('INVALIDATE') && state !== 'APPROVAL_INVALIDATED_PENDING_EVENT')
    || (legalActions.includes('RESUBMIT') && resubmitSourceReworkId === null)
    || (invalidationReasons.length > 0 && staleApprovalId === null)) {
    throw error('methodProjection transition derivation mismatch')
  }
  return {
    state, legalActions, currentApprovalId, staleApprovalId, invalidationReasons,
    reworkClassCodes, sameClassReworkCount, sameClassCountAfterRequest,
    methodReviewRequired, methodReviewRequiredAfterRequest, resubmitSourceReworkId,
    approvalInherited: false, boundedFindingRouteRequired,
  }
}

function ruleBindings(
  value: unknown,
  helpers: Helpers,
): Readonly<Record<string, string>> {
  const error = helpers.responseError
  const item = exact(value, RULE_PATHS, 'methodProjection.ruleBindings', error)
  const bindings = Object.fromEntries(RULE_PATHS.map(path => [
    path, sha(item[path], `methodProjection.ruleBindings.${path}`, error),
  ]))
  helpers.canonicalJson(bindings, 'methodProjection.ruleBindings')
  return bindings
}

function currentMethod(
  value: unknown,
  intent: YimengTransitionTakeApprovalLifecycleRequest,
  helpers: Helpers,
): VerifiedMethod {
  const error = helpers.responseError
  const response = exact(value, METHOD_RESPONSE_FIELDS, 'takeApprovalLifecycleMethod', error)
  if (response.schema !== 'qingmu.imago-take-approval-lifecycle-method-adapter-result.v1') {
    throw error('takeApprovalLifecycleMethod schema mismatch')
  }
  const item = exact(response.projection, METHOD_FIELDS, 'methodProjection', error)
  const boundSubject = subject(item.subject, intent, 'methodProjection.subject', error)
  const subjectSnapshotSha256 = sha(
    item.subjectSnapshotSha256,
    'methodProjection.subjectSnapshotSha256',
    error,
  )
  const sourceSnapshotSha256 = sha(
    item.sourceSnapshotSha256,
    'methodProjection.sourceSnapshotSha256',
    error,
  )
  if (item.schema !== 'qingmu.imago-take-approval-lifecycle-method.v1'
    || subjectSnapshotSha256
      !== helpers.canonicalJsonSha256(boundSubject, 'methodProjection.subject')
    || sourceSnapshotSha256 !== intent.expectedSourceSnapshotSha256) {
    throw error('methodProjection source binding mismatch')
  }
  const definition = methodDefinition(item.definition, error)
  const transition = methodTransition(item.transition, error)
  if (!transition.legalActions.includes(intent.action)) {
    throw helpers.inputError(`action ${intent.action} is not legal for the current source`)
  }
  const bindings = ruleBindings(item.ruleBindings, helpers)
  const rulesSha256 = sha(item.rulesSha256, 'methodProjection.rulesSha256', error)
  if (helpers.canonicalJsonSha256(bindings, 'methodProjection.ruleBindings') !== rulesSha256) {
    throw error('methodProjection rules SHA mismatch')
  }
  const projection: YimengImagoTakeApprovalLifecycleMethodProjection = {
    schema: 'qingmu.imago-take-approval-lifecycle-method.v1',
    subject: boundSubject,
    subjectSnapshotSha256,
    sourceSnapshotSha256,
    definition,
    transition,
    ruleBindings: bindings,
    rulesSha256,
  }
  const projectionSha256 = sha(response.projectionSha256, 'methodProjectionSha256', error)
  if (helpers.canonicalJsonSha256(projection, 'methodProjection') !== projectionSha256) {
    throw error('methodProjection SHA mismatch')
  }
  const unsigned = {
    schema: 'qingmu.imago-take-approval-lifecycle-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    sourceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  const proof = exact(
    response.methodAttestation,
    [...Object.keys(unsigned), 'signature'],
    'methodAttestation',
    error,
  )
  if (Object.entries(unsigned).some(([key, expected]) => proof[key] !== expected)) {
    throw error('methodAttestation binding mismatch')
  }
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey())
    .update(helpers.canonicalJson(unsigned, 'methodAttestation'), 'utf8').digest()
  const receivedSignature = Buffer.from(signature, 'hex')
  if (receivedSignature.length !== expectedSignature.length
    || !timingSafeEqual(expectedSignature, receivedSignature)) {
    throw error('methodAttestation signature mismatch')
  }
  return {
    projection,
    projectionSha256,
    attestation: { ...unsigned, signature },
    subject: boundSubject,
    transition,
    rulesSha256,
  }
}

function normalizeTransition(
  value: unknown,
  intent: YimengTransitionTakeApprovalLifecycleRequest,
  helpers: Helpers,
  verified?: VerifiedMethod,
): YimengTakeApprovalLifecycleTransition {
  const error = helpers.responseError
  const item = exact(value, TRANSITION_FIELDS, 'takeApprovalLifecycleResult.transition', error)
  if (!ACTIONS.includes(item.action as typeof ACTIONS[number])
    || item.action !== intent.action || item.takeId !== intent.takeId
    || (item.actorRole !== 'approver' && item.actorRole !== 'director')) {
    throw error('takeApprovalLifecycleResult transition identity mismatch')
  }
  const action = item.action as YimengTakeApprovalLifecycleAction
  const decisionId = nullableId(item.decisionId, 'transition.decisionId', error)
  const decisionEventId = nullableId(item.decisionEventId, 'transition.decisionEventId', error)
  const assessmentId = nullableId(item.assessmentId, 'transition.assessmentId', error)
  const assessmentEventId = nullableId(item.assessmentEventId, 'transition.assessmentEventId', error)
  const sourceApprovalId = nullableId(item.sourceApprovalId, 'transition.sourceApprovalId', error)
  const sourceReworkId = nullableId(item.sourceReworkId, 'transition.sourceReworkId', error)
  const defectClassCodes = canonicalCodes(item.defectClassCodes, 'transition.defectClassCodes', error)
  const paired = (left: string | null, right: string | null) => (left === null) === (right === null)
  if (!paired(decisionId, decisionEventId) || !paired(assessmentId, assessmentEventId)
    || (action === 'APPROVE' && (decisionId === null || assessmentId === null
      || sourceApprovalId !== null || sourceReworkId !== null || defectClassCodes.length > 0
      || item.actorRole !== 'approver'))
    || (action === 'INVALIDATE' && (sourceApprovalId === null || decisionId !== null
      || assessmentId !== null || sourceReworkId !== null || defectClassCodes.length > 0))
    || (action === 'REQUEST_REWORK' && (defectClassCodes.length === 0
      || (decisionId === null && assessmentId === null) || sourceApprovalId !== null
      || sourceReworkId !== null))
    || (action === 'RESUBMIT' && (sourceReworkId === null || decisionId !== null
      || assessmentId !== null || sourceApprovalId !== null || defectClassCodes.length > 0
      || item.actorRole !== 'director'))) {
    throw error('takeApprovalLifecycleResult transition action binding mismatch')
  }
  const takeSubjectSha256 = sha(item.takeSubjectSha256, 'transition.takeSubjectSha256', error)
  const methodProjectionSha256 = sha(
    item.methodProjectionSha256,
    'transition.methodProjectionSha256',
    error,
  )
  const rulesSha256 = sha(item.rulesSha256, 'transition.rulesSha256', error)
  const takeVersionOrdinal = integer(item.takeVersionOrdinal, 1, 'transition.takeVersionOrdinal', error)
  if (verified !== undefined && (
    takeSubjectSha256 !== verified.projection.subjectSnapshotSha256
    || takeVersionOrdinal !== verified.subject.versionOrdinal
    || methodProjectionSha256 !== verified.projectionSha256
    || rulesSha256 !== verified.rulesSha256
    || (action === 'INVALIDATE' && sourceApprovalId !== verified.transition.staleApprovalId)
    || (action === 'REQUEST_REWORK'
      && !isDeepStrictEqual(defectClassCodes, verified.transition.reworkClassCodes))
    || (action === 'RESUBMIT' && sourceReworkId !== verified.transition.resubmitSourceReworkId)
  )) throw error('takeApprovalLifecycleResult current Method binding mismatch')
  return {
    transitionId: id(item.transitionId, 'transition.transitionId', error),
    revision: integer(item.revision, 1, 'transition.revision', error),
    action,
    takeId: intent.takeId,
    takeVersionOrdinal,
    takeSubjectSha256,
    decisionId,
    decisionEventId,
    assessmentId,
    assessmentEventId,
    sourceApprovalId,
    sourceReworkId,
    defectClassCodes,
    reason: text(item.reason, 8_000, 'transition.reason', error),
    actorId: id(item.actorId, 'transition.actorId', error),
    actorRole: item.actorRole,
    actorNaturalPersonId: id(item.actorNaturalPersonId, 'transition.actorNaturalPersonId', error),
    authSessionId: sha(item.authSessionId, 'transition.authSessionId', error),
    recordedAt: helpers.requireTimestamp(item.recordedAt, 'transition.recordedAt'),
    eventId: id(item.eventId, 'transition.eventId', error),
    methodProjectionSha256,
    rulesSha256,
  }
}

function normalizeResult(
  value: unknown,
  intent: YimengTransitionTakeApprovalLifecycleRequest,
  helpers: Helpers,
  verified?: VerifiedMethod,
): YimengTakeApprovalLifecycleResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'takeApprovalLifecycleResult', error)
  const transition = normalizeTransition(root.transition, intent, helpers, verified)
  const sourceSnapshotSha256 = sha(
    root.sourceSnapshotSha256,
    'takeApprovalLifecycleResult.sourceSnapshotSha256',
    error,
  )
  const authoritativeSourceSnapshotSha256 = sha(
    root.authoritativeSourceSnapshotSha256,
    'takeApprovalLifecycleResult.authoritativeSourceSnapshotSha256',
    error,
  )
  const methodReviewRequiredAfterRequest = bool(
    root.methodReviewRequiredAfterRequest,
    'takeApprovalLifecycleResult.methodReviewRequiredAfterRequest',
    error,
  )
  const boundedFindingRouteRequired = bool(
    root.boundedFindingRouteRequired,
    'takeApprovalLifecycleResult.boundedFindingRouteRequired',
    error,
  )
  if (root.schema !== 'jason.qingmu-take-approval-lifecycle-result.v1'
    || sourceSnapshotSha256 !== intent.expectedSourceSnapshotSha256
    || authoritativeSourceSnapshotSha256 === sourceSnapshotSha256
    || transition.reason !== intent.reason
    || root.changed !== true
    || root.formalApprovalChanged !== (intent.action === 'APPROVE')
    || root.approvalInvalidated !== (intent.action === 'INVALIDATE')
    || root.reworkRequested !== (intent.action === 'REQUEST_REWORK')
    || root.resubmitted !== (intent.action === 'RESUBMIT')
    || root.selectionChanged !== false || root.technicalPassChanged !== false
    || root.reviewDecisionChanged !== false || root.reworkExecuted !== false
    || root.providerCalls !== 0 || root.budgetMutation !== false
    || root.episodeVerificationChanged !== false || root.humanSignoffInferred !== false
    || root.evidenceLedgerMutation !== false
    || (verified !== undefined && (
      methodReviewRequiredAfterRequest !== verified.transition.methodReviewRequiredAfterRequest
      || boundedFindingRouteRequired !== verified.transition.boundedFindingRouteRequired
    ))) {
    throw error('takeApprovalLifecycleResult authority or Method binding mismatch')
  }
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-result.v1',
    transition,
    sourceSnapshotSha256,
    authoritativeSourceSnapshotSha256,
    methodReviewRequiredAfterRequest,
    boundedFindingRouteRequired,
    changed: true,
    formalApprovalChanged: intent.action === 'APPROVE',
    approvalInvalidated: intent.action === 'INVALIDATE',
    reworkRequested: intent.action === 'REQUEST_REWORK',
    resubmitted: intent.action === 'RESUBMIT',
    selectionChanged: false,
    technicalPassChanged: false,
    reviewDecisionChanged: false,
    reworkExecuted: false,
    providerCalls: 0,
    budgetMutation: false,
    episodeVerificationChanged: false,
    humanSignoffInferred: false,
    evidenceLedgerMutation: false,
  }
}

/**
 * Build the only identity payload sent to the trusted current Core method.
 * @param payload - untrusted browser lifecycle intent.
 * @param helpers - shared validation and error helpers.
 * @returns the three canonical coordinates accepted by the method adapter.
 */
export function prepareCurrentTakeApprovalLifecycleMethodRequest(
  payload: unknown,
  helpers: Helpers,
): YimengCommandJsonObject {
  const intent = request(payload, helpers.inputError)
  return {
    projectId: intent.projectId,
    episodeId: intent.episodeId,
    frameId: intent.frameId,
  }
}

/**
 * Prepare one Host-derived lifecycle POST or the original GET-only receipt recovery.
 * @param endpoint - transition or receipt-recovery operation.
 * @param payload - untrusted browser lifecycle intent.
 * @param helpers - shared validation and error helpers.
 * @param currentMethodValue - fresh Host-derived method required only for transitions.
 * @returns the exact upstream request and response normalizer.
 */
export function prepareTakeApprovalLifecycleCommand(
  endpoint: 'transitionTakeApprovalLifecycle' | 'recoverTakeApprovalLifecycleTransition',
  payload: unknown,
  helpers: Helpers,
  currentMethodValue?: unknown,
): PreparedCommand {
  const intent = request(payload, helpers.inputError)
  const rootPath = `/api/qingmu/projects/${encodeURIComponent(intent.projectId)}`
    + `/episodes/${encodeURIComponent(intent.episodeId)}`
    + `/frames/${encodeURIComponent(intent.frameId)}/take-approval-lifecycle/transitions`
  if (endpoint === 'transitionTakeApprovalLifecycle') {
    if (currentMethodValue === undefined) {
      throw helpers.responseError('current Take approval lifecycle Method is unavailable')
    }
    const verified = currentMethod(currentMethodValue, intent, helpers)
    return {
      path: rootPath,
      request: {
        method: 'POST',
        idempotencyKey: intent.idempotencyKey,
        body: {
          expectedSourceSnapshotSha256: intent.expectedSourceSnapshotSha256,
          takeId: intent.takeId,
          methodProjection: verified.projection,
          methodProjectionSha256: verified.projectionSha256,
          methodAttestation: verified.attestation,
          action: intent.action,
          reason: intent.reason,
          idempotencyKey: intent.idempotencyKey,
        },
      },
      normalize: value => normalizeResult(value, intent, helpers, verified),
    }
  }
  const query = new URLSearchParams({
    expectedSourceSnapshotSha256: intent.expectedSourceSnapshotSha256,
    takeId: intent.takeId,
  })
  return {
    path: `${rootPath}/command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: intent.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(value, [
        'schema', 'projectId', 'episodeId', 'frameId', 'takeId',
        'expectedSourceSnapshotSha256', 'idempotencyKey', 'status', 'result',
      ], 'takeApprovalLifecycleRecovery', error)
      if (root.schema !== 'jason.qingmu-take-approval-lifecycle-recovery.v1'
        || root.projectId !== intent.projectId || root.episodeId !== intent.episodeId
        || root.frameId !== intent.frameId || root.takeId !== intent.takeId
        || root.expectedSourceSnapshotSha256 !== intent.expectedSourceSnapshotSha256
        || root.idempotencyKey !== intent.idempotencyKey
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)
        || (root.status === 'committed' && root.result === null)) {
        throw error('takeApprovalLifecycleRecovery binding mismatch')
      }
      return {
        schema: 'jason.qingmu-take-approval-lifecycle-recovery.v1',
        projectId: intent.projectId,
        episodeId: intent.episodeId,
        frameId: intent.frameId,
        takeId: intent.takeId,
        expectedSourceSnapshotSha256: intent.expectedSourceSnapshotSha256,
        idempotencyKey: intent.idempotencyKey,
        status: root.status,
        result: root.status === 'committed'
          ? normalizeResult(root.result, intent, helpers)
          : null,
      }
    },
  }
}
