/** Current stateless E7-4 approval lifecycle compiled from fresh Yimeng truth. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  ImagoTakeApprovalLifecycleMethodDefinition,
  ImagoTakeApprovalLifecycleMethodProjection,
  ImagoTakeApprovalLifecycleMethodRequest,
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleMethodSnapshot,
  ImagoTakeApprovalLifecycleTransition,
} from './types.ts'
import {
  takeAcceptanceJcsJson,
  TakeAcceptanceContractError,
  TakeAcceptanceInputError,
} from './take-acceptance.ts'

type CanonicalSerialize = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>

/** Exact sources hashed by the Core compiler, including imported compiler dependencies. */
export const TAKE_APPROVAL_LIFECYCLE_RULE_PATHS = [
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_approval_lifecycle_method.py',
] as const

const ACTIONS = ['APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT'] as const
const FEED_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'source', 'sourceSnapshotSha256',
  'capabilities', 'boundaries',
] as const
const SOURCE_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'currentTake', 'currentDecision',
  'currentAssessment', 'lifecycleHistory',
] as const

/** Browser supplied more than the three immutable coordinates. */
export class TakeApprovalLifecycleInputError extends TakeAcceptanceInputError {}
/** Source, rules, compiler output, or lifecycle derivation failed closed. */
export class TakeApprovalLifecycleContractError extends TakeAcceptanceContractError {}

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TakeApprovalLifecycleContractError(`${field} must be an object`)
  }
  return value as JsonObject
}

function exact(value: unknown, fields: readonly string[], field: string): JsonObject {
  const result = object(value, field)
  if (!isDeepStrictEqual(Object.keys(result).sort(), [...fields].sort())) {
    throw new TakeApprovalLifecycleContractError(`${field} contains unexpected fields`)
  }
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TakeApprovalLifecycleContractError(`${field} must be a lowercase SHA-256`)
  }
  return value
}

function digest(value: unknown, serialize: CanonicalSerialize, field: string): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

/**
 * Accept only coordinates; source truth and legal actions are always reread by the Host.
 * @param payload - untrusted browser request.
 * @returns the validated identity-only method request.
 */
export function parseTakeApprovalLifecycleMethodRequest(
  payload: unknown,
): ImagoTakeApprovalLifecycleMethodRequest {
  try {
    const request = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
    const valid = (value: unknown) => typeof value === 'string' && value.isWellFormed()
      && value === value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
      && value !== '' && Array.from(value).length <= 256 && !/[\u0000\r\n]/u.test(value)
    if (!valid(request.projectId) || !valid(request.episodeId) || !valid(request.frameId)) {
      throw new TakeApprovalLifecycleInputError()
    }
    return {
      projectId: request.projectId as string,
      episodeId: request.episodeId as string,
      frameId: request.frameId as string,
    }
  } catch {
    throw new TakeApprovalLifecycleInputError(
      'takeApprovalLifecycleMethod accepts only projectId, episodeId, and frameId',
    )
  }
}

/**
 * Bind the exact current source and reject adjacent authority smuggled through the feed.
 * @param request - validated lifecycle coordinates.
 * @param value - fresh normalized Yimeng lifecycle feed.
 * @returns the exact current source snapshot for Core.
 */
export function buildTakeApprovalLifecycleSnapshot(
  request: ImagoTakeApprovalLifecycleMethodRequest,
  value: unknown,
): ImagoTakeApprovalLifecycleMethodSnapshot {
  const feed = exact(value, FEED_FIELDS, 'feed')
  const source = exact(feed.source, SOURCE_FIELDS, 'feed.source')
  const current = exact(source.currentTake, ['takeSubject', 'takeSubjectSha256'], 'feed.source.currentTake')
  const subject = object(current.takeSubject, 'feed.source.currentTake.takeSubject')
  const sourceSnapshotSha256 = sha(feed.sourceSnapshotSha256, 'feed.sourceSnapshotSha256')
  const subjectSnapshotSha256 = sha(current.takeSubjectSha256, 'feed.source.currentTake.takeSubjectSha256')
  const capabilities = exact(feed.capabilities, [
    'canApprove', 'canRecordInvalidation', 'canRequestRework', 'canResubmit',
  ], 'feed.capabilities')
  const boundaries = exact(feed.boundaries, [
    'stateRequiresCurrentImagoMethod', 'technicalPassIsContentApproval', 'commentIsApproval',
    'editIsApproval', 'selectionChanged', 'technicalPassChanged', 'reviewDecisionChanged',
    'reworkExecuted', 'providerCalls', 'budgetMutation', 'episodeVerificationChanged',
    'humanSignoffInferred', 'evidenceLedgerMutation',
  ], 'feed.boundaries')
  if (feed.schema !== 'jason.qingmu-take-approval-lifecycle-feed.v1'
    || source.schema !== 'jason.qingmu-take-approval-lifecycle-source.v1'
    || feed.projectId !== request.projectId || feed.episodeId !== request.episodeId
    || feed.frameId !== request.frameId || source.projectId !== request.projectId
    || source.episodeId !== request.episodeId || source.frameId !== request.frameId
    || subject.projectId !== request.projectId || subject.episodeId !== request.episodeId
    || subject.frameId !== request.frameId || subject.selectionStatus !== 'Selected'
    || digest(subject, takeAcceptanceJcsJson, 'feed.subject') !== subjectSnapshotSha256
    || digest(source, takeAcceptanceJcsJson, 'feed.source') !== sourceSnapshotSha256
    || Object.values(capabilities).some(flag => typeof flag !== 'boolean')
    || !isDeepStrictEqual(boundaries, {
      stateRequiresCurrentImagoMethod: true, technicalPassIsContentApproval: false,
      commentIsApproval: false, editIsApproval: false, selectionChanged: false,
      technicalPassChanged: false, reviewDecisionChanged: false, reworkExecuted: false,
      providerCalls: 0, budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    })) {
    throw new TakeApprovalLifecycleContractError('fresh lifecycle source binding failed')
  }
  return {
    schema: 'qingmu.take-approval-lifecycle-method-snapshot.v1',
    source: source as unknown as ImagoTakeApprovalLifecycleMethodSnapshot['source'],
    sourceSnapshotSha256,
  }
}

function definition(): ImagoTakeApprovalLifecycleMethodDefinition {
  return {
    mode: 'STATELESS_TAKE_APPROVAL_LIFECYCLE_METHOD', actions: ACTIONS,
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
      executionAllowed: false, paidGenerationAuthorized: false, automaticRetry: false,
      thirdSameClassRequiresMethodReview: true,
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
}

/** Independently reconstructed current Core sources and exact byte hashes. */
export interface TakeApprovalLifecycleRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoTakeApprovalLifecycleMethodDefinition
  readonly rulesSha256: string
}

/**
 * Read every fixed source and fail closed if current policies no longer carry E7-4.
 * @param coreRoot - configured IMAGO Core root.
 * @param serialize - canonical JSON serializer used for rule identities.
 * @returns current rule bytes, definition, and aggregate identity.
 */
export async function readTakeApprovalLifecycleRules(
  coreRoot: string,
  serialize: CanonicalSerialize,
): Promise<TakeApprovalLifecycleRules> {
  const sources = new Map(await Promise.all(TAKE_APPROVAL_LIFECYCLE_RULE_PATHS.map(async path =>
    [path, await readFile(join(coreRoot, path))] as const)))
  const json = (path: typeof TAKE_APPROVAL_LIFECYCLE_RULE_PATHS[number]) => {
    const raw = sources.get(path)
    if (raw === undefined) throw new TakeApprovalLifecycleContractError(`missing rule source ${path}`)
    try { return object(JSON.parse(raw.toString('utf8')) as unknown, path) } catch {
      throw new TakeApprovalLifecycleContractError(`invalid rule JSON ${path}`)
    }
  }
  const review = json('pipeline/v6-lsuqc-provider-neutral-review-policy.json')
  const activation = object(review.activation, 'review.activation')
  const decision = object(review.decision_contract, 'review.decision_contract')
  const completion = json('pipeline/v6-lsuqc-completion-routing-policy.json')
  const approval = object(completion.approval_branch, 'completion.approval_branch')
  const rework = object(completion.rework_branch, 'completion.rework_branch')
  const plan = sources.get('docs/qingmu-os/report-source.md')?.toString('utf8') ?? ''
  if (review.schema !== 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1'
    || activation.technical_pass_auto_promotes_content !== false
    || decision.technical_success_is_not_content_pass !== true
    || decision.bounded_rework_and_earliest_owner_required !== true
    || completion.schema !== 'IMAGO-V6-LSUQCCompletionRoutingPolicy-v1'
    || approval.selected_take_only !== true || rework.one_earliest_owner_per_defect !== true
    || rework.paid_generation_authorized !== false || rework.automatic_retry !== false
    || rework.unbounded_redo_forbidden !== true
    || !plan.includes('上游对象或 SHA 改变时，所有依赖的批准和锁按规则失效')
    || !plan.includes('失效事件') || !plan.includes('第三轮同类返修不再直接生成')
    || !plan.includes('人工编辑先产生新 revision，再重新送审')) {
    throw new TakeApprovalLifecycleContractError('current approval lifecycle policies are incompatible')
  }
  const hashes = Object.fromEntries([...sources].map(([path, raw]) =>
    [path, createHash('sha256').update(raw).digest('hex')]))
  return {
    hashes, definition: definition(),
    rulesSha256: digest(hashes, serialize, 'takeApprovalLifecycle.rules'),
  }
}

function reworkCodes(source: ImagoTakeApprovalLifecycleMethodSnapshot['source']): string[] {
  const codes: string[] = []
  const decision = source.currentDecision
  const assessment = source.currentAssessment
  if (decision !== null && decision.decision !== 'approve') {
    codes.push(decision.decision === 'request_changes'
      ? 'DECISION_REQUEST_CHANGES' : 'DECISION_REJECT')
  }
  if (assessment !== null && !assessment.technicalPass) {
    codes.push(...assessment.issueCodes.map(code => `QC_${code}`))
  }
  return [...new Set(codes)].sort()
}

/**
 * Mirror Core transition derivation so injected compiler output cannot grant authority.
 * @param source - exact current Yimeng lifecycle source.
 * @param currentRulesSha256 - aggregate identity of the current lifecycle rules.
 * @returns the legal state and action projection derived from current truth.
 */
export function deriveTakeApprovalLifecycleTransition(
  source: ImagoTakeApprovalLifecycleMethodSnapshot['source'],
  currentRulesSha256: string,
): ImagoTakeApprovalLifecycleTransition {
  const take = source.currentTake.takeSubject
  const takeSha = source.currentTake.takeSubjectSha256
  const decision = source.currentDecision
  const assessment = source.currentAssessment
  const history = source.lifecycleHistory
  const latestApproval = history.findLast(item => item.action === 'APPROVE')
  const approvalInvalidated = latestApproval !== undefined && history.some(item =>
    item.action === 'INVALIDATE' && item.sourceApprovalId === latestApproval.transitionId)
  const invalidationReasons: string[] = []
  if (latestApproval !== undefined && !approvalInvalidated) {
    if (latestApproval.takeId !== take.takeId) invalidationReasons.push('TAKE_CHANGED')
    if (latestApproval.takeVersionOrdinal !== take.versionOrdinal) invalidationReasons.push('TAKE_REVISION_CHANGED')
    if (latestApproval.takeSubjectSha256 !== takeSha) invalidationReasons.push('TAKE_SHA_CHANGED')
    if (decision === null) invalidationReasons.push('APPROVER_DECISION_MISSING')
    else {
      if (latestApproval.decisionId !== decision.decisionId
        || latestApproval.decisionEventId !== decision.eventId) {
        invalidationReasons.push('APPROVER_DECISION_CHANGED')
      }
      if (decision.decision !== 'approve') invalidationReasons.push('APPROVER_DECISION_NOT_APPROVE')
    }
    if (assessment === null) invalidationReasons.push('TECHNICAL_QC_MISSING')
    else {
      if (latestApproval.assessmentId !== assessment.assessmentId
        || latestApproval.assessmentEventId !== assessment.eventId) {
        invalidationReasons.push('TECHNICAL_QC_CHANGED')
      }
      if (!assessment.technicalPass) invalidationReasons.push('TECHNICAL_QC_NOT_PASS')
    }
    if (latestApproval.rulesSha256 !== currentRulesSha256) invalidationReasons.push('LIFECYCLE_RULES_CHANGED')
    if (history.some(item => item.revision > latestApproval.revision
      && (item.action === 'REQUEST_REWORK' || item.action === 'RESUBMIT'))) {
      invalidationReasons.push('SUPERSEDED_BY_LIFECYCLE_TRANSITION')
    }
  }
  const invalidation = [...new Set(invalidationReasons)].sort()
  const currentApproval = latestApproval !== undefined && !approvalInvalidated && invalidation.length === 0
  const reworkClassCodes = reworkCodes(source)
  const matchingReworks = reworkClassCodes.length === 0 ? [] : history.filter(item =>
    item.action === 'REQUEST_REWORK'
      && isDeepStrictEqual(item.defectClassCodes, reworkClassCodes))
  const latestRework = history.findLast(item => item.action === 'REQUEST_REWORK')
  const latestReworkIsCurrent = latestRework !== undefined
    && latestRework.takeSubjectSha256 === takeSha
    && isDeepStrictEqual(latestRework.defectClassCodes, reworkClassCodes)
  const methodReviewRequired = latestRework !== undefined && history.filter(item =>
    item.action === 'REQUEST_REWORK'
      && isDeepStrictEqual(item.defectClassCodes, latestRework.defectClassCodes)).length >= 3
  const latestResubmission = history.findLast(item => item.action === 'RESUBMIT')
  const resubmittedCurrent = latestRework !== undefined && latestResubmission !== undefined
    && latestResubmission.sourceReworkId === latestRework.transitionId
    && latestResubmission.takeSubjectSha256 === takeSha
    && latestResubmission.revision > latestRework.revision
  const resubmitSource = latestRework !== undefined
    && latestRework.takeSubjectSha256 !== takeSha && !resubmittedCurrent
  const approvalEligible = !currentApproval && invalidation.length === 0
    && decision?.decision === 'approve' && assessment?.technicalPass === true
    && !methodReviewRequired && !(latestRework !== undefined
      && latestRework.takeSubjectSha256 !== takeSha && !resubmittedCurrent)
  const reworkEligible = reworkClassCodes.length > 0 && !latestReworkIsCurrent
    && invalidation.length === 0
  const legalActions: ImagoTakeApprovalLifecycleTransition['legalActions'][number][] = []
  if (approvalEligible) legalActions.push('APPROVE')
  if (invalidation.length > 0 && latestApproval !== undefined && !approvalInvalidated) legalActions.push('INVALIDATE')
  if (reworkEligible) legalActions.push('REQUEST_REWORK')
  if (resubmitSource && !methodReviewRequired && invalidation.length === 0) legalActions.push('RESUBMIT')
  const state = currentApproval ? 'APPROVED'
    : invalidation.length > 0 && !approvalInvalidated ? 'APPROVAL_INVALIDATED_PENDING_EVENT'
      : methodReviewRequired ? 'METHOD_REVIEW_REQUIRED'
        : resubmitSource ? 'READY_TO_RESUBMIT'
          : latestReworkIsCurrent ? 'REWORK_RECORDED'
            : reworkClassCodes.length > 0 ? 'REWORK_REQUIRED'
              : approvalEligible ? 'READY_FOR_APPROVAL'
                : resubmittedCurrent ? 'IN_REVIEW' : 'AWAITING_REVIEW'
  return {
    state, legalActions,
    currentApprovalId: currentApproval ? latestApproval.transitionId : null,
    staleApprovalId: latestApproval !== undefined && invalidation.length > 0 && !approvalInvalidated
      ? latestApproval.transitionId : null,
    invalidationReasons: invalidation, reworkClassCodes,
    sameClassReworkCount: matchingReworks.length,
    sameClassCountAfterRequest: matchingReworks.length + (reworkEligible ? 1 : 0),
    methodReviewRequired,
    methodReviewRequiredAfterRequest: reworkEligible && matchingReworks.length + 1 >= 3,
    resubmitSourceReworkId: resubmitSource ? latestRework.transitionId : null,
    approvalInherited: false, boundedFindingRouteRequired: reworkClassCodes.length > 0,
  }
}

/**
 * Verify the whole compiler projection before signing it with the Host-only key.
 * @param raw - untrusted compiler output.
 * @param snapshot - exact current lifecycle source snapshot.
 * @param rules - independently reread current rule set.
 * @param key - Host-only HMAC key.
 * @returns the verified projection and its Host attestation.
 */
export function attestTakeApprovalLifecycleMethod(
  raw: unknown,
  snapshot: ImagoTakeApprovalLifecycleMethodSnapshot,
  rules: TakeApprovalLifecycleRules,
  key: string,
): ImagoTakeApprovalLifecycleMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'subjectSnapshotSha256', 'sourceSnapshotSha256',
    'definition', 'transition', 'ruleBindings', 'rulesSha256',
  ], 'compiler projection')
  if (projection.schema !== 'qingmu.imago-take-approval-lifecycle-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.source.currentTake.takeSubject)
    || projection.subjectSnapshotSha256 !== snapshot.source.currentTake.takeSubjectSha256
    || projection.sourceSnapshotSha256 !== snapshot.sourceSnapshotSha256
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.transition,
      deriveTakeApprovalLifecycleTransition(snapshot.source, rules.rulesSha256))
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes)
    || projection.rulesSha256 !== rules.rulesSha256) {
    throw new TakeApprovalLifecycleContractError('compiler source, transition, or rule binding mismatched')
  }
  const projectionSha256 = digest(projection, takeAcceptanceJcsJson, 'takeApprovalLifecycle.projection')
  const unsigned = {
    schema: 'qingmu.imago-take-approval-lifecycle-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-take-approval-lifecycle-method-adapter-result.v1',
    projection: projection as unknown as ImagoTakeApprovalLifecycleMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key)
        .update(takeAcceptanceJcsJson(unsigned, 'takeApprovalLifecycle.attestation'), 'utf8')
        .digest('hex'),
    },
  }
}
