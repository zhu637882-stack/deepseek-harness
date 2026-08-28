/** Strict read validation for the current Take approval lifecycle source. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengTakeAcceptanceSubject,
  YimengTakeApprovalLifecycleAssessment,
  YimengTakeApprovalLifecycleDecision,
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRequest,
  YimengTakeApprovalLifecycleSource,
  YimengTakeApprovalLifecycleTransition,
} from './types.ts'
import { parseTakeVersionReadRequest } from './take-versions.ts'

type Digest = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'takeId', 'versionOrdinal',
  'selectionStatus', 'outputSha256', 'taskId', 'capability', 'routeKey', 'provider',
  'model', 'inputHash', 'submitId',
] as const
const SOURCE_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'currentTake', 'currentDecision',
  'currentAssessment', 'lifecycleHistory',
] as const
const DECISION_FIELDS = [
  'decisionId', 'eventId', 'takeId', 'takeVersionOrdinal', 'takeSubjectSha256',
  'decision', 'actorId', 'actorNaturalPersonId',
] as const
const ASSESSMENT_FIELDS = [
  'assessmentId', 'eventId', 'takeId', 'takeVersionOrdinal', 'takeSubjectSha256',
  'evidenceSnapshotSha256', 'technicalPass', 'issueCodes',
  'methodProjectionSha256', 'rulesSha256',
] as const
const TRANSITION_FIELDS = [
  'transitionId', 'revision', 'action', 'takeId', 'takeVersionOrdinal',
  'takeSubjectSha256', 'decisionId', 'decisionEventId', 'assessmentId',
  'assessmentEventId', 'sourceApprovalId', 'sourceReworkId', 'defectClassCodes',
  'reason', 'actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId',
  'recordedAt', 'eventId', 'methodProjectionSha256', 'rulesSha256',
] as const
const ACTIONS = ['APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT'] as const
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

function exact(value: unknown, fields: readonly string[], field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())) {
    throw new Error(`take approval lifecycle: ${field} fields mismatch`)
  }
  return value as JsonObject
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum = 256, exactText = true): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || pythonStrip(value) === ''
    || (exactText && (value !== pythonStrip(value) || /[\r\n]/u.test(value)))) {
    throw new Error(`take approval lifecycle: ${field} is invalid`)
  }
  return value
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take approval lifecycle: ${field} is invalid`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take approval lifecycle: ${field} is invalid`)
  }
  return value
}

function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error(`take approval lifecycle: ${field} is invalid`)
  }
  return result
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

function codes(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`take approval lifecycle: ${field} is invalid`)
  }
  const result = value.map((entry, index) => text(entry, `${field}[${String(index)}]`, 128))
  if (!isDeepStrictEqual(result, [...new Set(result)].sort(compareUnicodeCodePoints))) {
    throw new Error(`take approval lifecycle: ${field} must be sorted and unique`)
  }
  return result
}

function subject(
  value: unknown,
  request: YimengTakeApprovalLifecycleRequest,
  field: string,
): YimengTakeAcceptanceSubject {
  const item = exact(value, SUBJECT_FIELDS, field)
  if (item.schema !== 'jason.qingmu-take-acceptance-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || item.selectionStatus !== 'Selected') {
    throw new Error(`take approval lifecycle: ${field} binding mismatch`)
  }
  const nullableText = (raw: unknown, name: string) => raw === null ? null : text(raw, name, 1024, false)
  const nullableSha = (raw: unknown, name: string) => raw === null ? null : sha(raw, name)
  return {
    schema: 'jason.qingmu-take-acceptance-subject.v1', ...request,
    frameNo: integer(item.frameNo, `${field}.frameNo`, 1),
    storyboardRevision: integer(item.storyboardRevision, `${field}.storyboardRevision`),
    frameContentSha256: sha(item.frameContentSha256, `${field}.frameContentSha256`),
    selectionRevision: integer(item.selectionRevision, `${field}.selectionRevision`),
    takeId: text(item.takeId, `${field}.takeId`),
    versionOrdinal: integer(item.versionOrdinal, `${field}.versionOrdinal`, 1),
    selectionStatus: 'Selected',
    outputSha256: nullableSha(item.outputSha256, `${field}.outputSha256`),
    taskId: item.taskId === null ? null : text(item.taskId, `${field}.taskId`),
    capability: nullableText(item.capability, `${field}.capability`),
    routeKey: nullableText(item.routeKey, `${field}.routeKey`),
    provider: nullableText(item.provider, `${field}.provider`),
    model: nullableText(item.model, `${field}.model`),
    inputHash: nullableSha(item.inputHash, `${field}.inputHash`),
    submitId: item.submitId === null ? null : text(item.submitId, `${field}.submitId`),
  }
}

function decision(
  value: unknown,
  take: YimengTakeAcceptanceSubject,
  takeSha: string,
  field: string,
): YimengTakeApprovalLifecycleDecision | null {
  if (value === null) return null
  const item = exact(value, DECISION_FIELDS, field)
  if (!['approve', 'reject', 'request_changes'].includes(item.decision as string)) {
    throw new Error(`take approval lifecycle: ${field}.decision is invalid`)
  }
  const result: YimengTakeApprovalLifecycleDecision = {
    decisionId: text(item.decisionId, `${field}.decisionId`),
    eventId: text(item.eventId, `${field}.eventId`),
    takeId: text(item.takeId, `${field}.takeId`),
    takeVersionOrdinal: integer(item.takeVersionOrdinal, `${field}.takeVersionOrdinal`, 1),
    takeSubjectSha256: sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`),
    decision: item.decision as YimengTakeApprovalLifecycleDecision['decision'],
    actorId: text(item.actorId, `${field}.actorId`),
    actorNaturalPersonId: text(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`),
  }
  if (result.takeId !== take.takeId || result.takeVersionOrdinal !== take.versionOrdinal
    || result.takeSubjectSha256 !== takeSha) {
    throw new Error(`take approval lifecycle: ${field} Take binding mismatch`)
  }
  return result
}

function assessment(
  value: unknown,
  take: YimengTakeAcceptanceSubject,
  takeSha: string,
  field: string,
): YimengTakeApprovalLifecycleAssessment | null {
  if (value === null) return null
  const item = exact(value, ASSESSMENT_FIELDS, field)
  const issueCodes = codes(item.issueCodes, `${field}.issueCodes`)
  if (typeof item.technicalPass !== 'boolean' || item.technicalPass === (issueCodes.length > 0)) {
    throw new Error(`take approval lifecycle: ${field} technical state mismatch`)
  }
  const result: YimengTakeApprovalLifecycleAssessment = {
    assessmentId: text(item.assessmentId, `${field}.assessmentId`),
    eventId: text(item.eventId, `${field}.eventId`),
    takeId: text(item.takeId, `${field}.takeId`),
    takeVersionOrdinal: integer(item.takeVersionOrdinal, `${field}.takeVersionOrdinal`, 1),
    takeSubjectSha256: sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`),
    evidenceSnapshotSha256: sha(item.evidenceSnapshotSha256, `${field}.evidenceSnapshotSha256`),
    technicalPass: item.technicalPass,
    issueCodes,
    methodProjectionSha256: sha(item.methodProjectionSha256, `${field}.methodProjectionSha256`),
    rulesSha256: sha(item.rulesSha256, `${field}.rulesSha256`),
  }
  if (result.takeId !== take.takeId || result.takeVersionOrdinal !== take.versionOrdinal
    || result.takeSubjectSha256 !== takeSha) {
    throw new Error(`take approval lifecycle: ${field} Take binding mismatch`)
  }
  return result
}

function transition(value: unknown, revision: number, field: string): YimengTakeApprovalLifecycleTransition {
  const item = exact(value, TRANSITION_FIELDS, field)
  if (item.revision !== revision || !ACTIONS.includes(item.action as typeof ACTIONS[number])
    || (item.actorRole !== 'approver' && item.actorRole !== 'director')) {
    throw new Error(`take approval lifecycle: ${field} transition identity mismatch`)
  }
  const decisionId = nullableId(item.decisionId, `${field}.decisionId`)
  const decisionEventId = nullableId(item.decisionEventId, `${field}.decisionEventId`)
  const assessmentId = nullableId(item.assessmentId, `${field}.assessmentId`)
  const assessmentEventId = nullableId(item.assessmentEventId, `${field}.assessmentEventId`)
  const sourceApprovalId = nullableId(item.sourceApprovalId, `${field}.sourceApprovalId`)
  const sourceReworkId = nullableId(item.sourceReworkId, `${field}.sourceReworkId`)
  const defectClassCodes = codes(item.defectClassCodes, `${field}.defectClassCodes`)
  const action = item.action as YimengTakeApprovalLifecycleTransition['action']
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
    throw new Error(`take approval lifecycle: ${field} action fields mismatch`)
  }
  return {
    transitionId: text(item.transitionId, `${field}.transitionId`), revision, action,
    takeId: text(item.takeId, `${field}.takeId`),
    takeVersionOrdinal: integer(item.takeVersionOrdinal, `${field}.takeVersionOrdinal`, 1),
    takeSubjectSha256: sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`),
    decisionId, decisionEventId, assessmentId, assessmentEventId, sourceApprovalId, sourceReworkId,
    defectClassCodes,
    reason: text(item.reason, `${field}.reason`, 8_000, false),
    actorId: text(item.actorId, `${field}.actorId`),
    actorRole: item.actorRole,
    actorNaturalPersonId: text(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`),
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    recordedAt: timestamp(item.recordedAt, `${field}.recordedAt`),
    eventId: text(item.eventId, `${field}.eventId`),
    methodProjectionSha256: sha(item.methodProjectionSha256, `${field}.methodProjectionSha256`),
    rulesSha256: sha(item.rulesSha256, `${field}.rulesSha256`),
  }
}

/**
 * Accept only canonical Shot coordinates from the browser.
 * @param payload - untrusted browser request.
 * @returns validated project, episode, and frame coordinates.
 */
export function parseTakeApprovalLifecycleRequest(payload: unknown): YimengTakeApprovalLifecycleRequest {
  return parseTakeVersionReadRequest(payload)
}

/**
 * Validate the whole current Yimeng source and its immutable lifecycle references.
 * @param value - untrusted upstream lifecycle source.
 * @param request - canonical requested coordinates.
 * @param digest - RFC 8785 content digest helper.
 * @returns the normalized, fully bound lifecycle source.
 */
export function normalizeTakeApprovalLifecycleSource(
  value: unknown,
  request: YimengTakeApprovalLifecycleRequest,
  digest: Digest,
): YimengTakeApprovalLifecycleSource {
  const root = exact(value, SOURCE_FIELDS, 'source')
  if (root.schema !== 'jason.qingmu-take-approval-lifecycle-source.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId) {
    throw new Error('take approval lifecycle: source binding mismatch')
  }
  const current = exact(root.currentTake, ['takeSubject', 'takeSubjectSha256'], 'source.currentTake')
  const takeSubject = subject(current.takeSubject, request, 'source.currentTake.takeSubject')
  const takeSubjectSha256 = sha(current.takeSubjectSha256, 'source.currentTake.takeSubjectSha256')
  if (digest(takeSubject, 'source.currentTake.takeSubject') !== takeSubjectSha256) {
    throw new Error('take approval lifecycle: current Take SHA mismatch')
  }
  if (!Array.isArray(root.lifecycleHistory) || root.lifecycleHistory.length > 512) {
    throw new Error('take approval lifecycle: source.lifecycleHistory is invalid')
  }
  const lifecycleHistory = root.lifecycleHistory.map((entry, index) =>
    transition(entry, index + 1, `source.lifecycleHistory[${String(index)}]`))
  const byId = new Map(lifecycleHistory.map(entry => [entry.transitionId, entry]))
  if (byId.size !== lifecycleHistory.length) {
    throw new Error('take approval lifecycle: transition IDs must be unique')
  }
  for (const entry of lifecycleHistory) {
    const approval = entry.sourceApprovalId === null ? undefined : byId.get(entry.sourceApprovalId)
    const rework = entry.sourceReworkId === null ? undefined : byId.get(entry.sourceReworkId)
    if (entry.sourceApprovalId !== null
      && (approval?.action !== 'APPROVE' || approval.revision >= entry.revision)) {
      throw new Error('take approval lifecycle: invalid approval reference')
    }
    if (entry.sourceReworkId !== null
      && (rework?.action !== 'REQUEST_REWORK' || rework.revision >= entry.revision)) {
      throw new Error('take approval lifecycle: invalid rework reference')
    }
  }
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-source.v1', ...request,
    currentTake: { takeSubject, takeSubjectSha256 },
    currentDecision: decision(
      root.currentDecision, takeSubject, takeSubjectSha256, 'source.currentDecision',
    ),
    currentAssessment: assessment(
      root.currentAssessment, takeSubject, takeSubjectSha256, 'source.currentAssessment',
    ),
    lifecycleHistory,
  }
}

/**
 * Fail closed on source SHA, capabilities, or any adjacent-authority flag.
 * @param value - untrusted upstream lifecycle feed.
 * @param request - canonical requested coordinates.
 * @param digest - RFC 8785 content digest helper.
 * @returns the normalized read-only lifecycle feed.
 */
export function normalizeTakeApprovalLifecycleFeed(
  value: unknown,
  request: YimengTakeApprovalLifecycleRequest,
  digest: Digest,
): YimengTakeApprovalLifecycleFeedResponse {
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'source', 'sourceSnapshotSha256',
    'capabilities', 'boundaries',
  ], 'feed')
  const source = normalizeTakeApprovalLifecycleSource(root.source, request, digest)
  const sourceSnapshotSha256 = sha(root.sourceSnapshotSha256, 'feed.sourceSnapshotSha256')
  const capabilities = exact(root.capabilities, [
    'canApprove', 'canRecordInvalidation', 'canRequestRework', 'canResubmit',
  ], 'feed.capabilities')
  const boundaries = exact(root.boundaries, [
    'stateRequiresCurrentImagoMethod', 'technicalPassIsContentApproval', 'commentIsApproval',
    'editIsApproval', 'selectionChanged', 'technicalPassChanged', 'reviewDecisionChanged',
    'reworkExecuted', 'providerCalls', 'budgetMutation', 'episodeVerificationChanged',
    'humanSignoffInferred', 'evidenceLedgerMutation',
  ], 'feed.boundaries')
  if (root.schema !== 'jason.qingmu-take-approval-lifecycle-feed.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId || digest(source, 'feed.source') !== sourceSnapshotSha256
    || Object.values(capabilities).some(flag => typeof flag !== 'boolean')
    || !isDeepStrictEqual(boundaries, {
      stateRequiresCurrentImagoMethod: true, technicalPassIsContentApproval: false,
      commentIsApproval: false, editIsApproval: false, selectionChanged: false,
      technicalPassChanged: false, reviewDecisionChanged: false, reworkExecuted: false,
      providerCalls: 0, budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    })) {
    throw new Error('take approval lifecycle: feed binding or authority flags mismatch')
  }
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-feed.v1', ...request,
    source, sourceSnapshotSha256,
    capabilities: {
      canApprove: capabilities.canApprove as boolean,
      canRecordInvalidation: capabilities.canRecordInvalidation as boolean,
      canRequestRework: capabilities.canRequestRework as boolean,
      canResubmit: capabilities.canResubmit as boolean,
    },
    boundaries: {
      stateRequiresCurrentImagoMethod: true, technicalPassIsContentApproval: false,
      commentIsApproval: false, editIsApproval: false, selectionChanged: false,
      technicalPassChanged: false, reviewDecisionChanged: false, reworkExecuted: false,
      providerCalls: 0, budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    },
  }
}
