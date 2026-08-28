/** Strict read validation for immutable Reviewer technical-QC assessments. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengTakeAcceptanceSubject,
  YimengTakeTechnicalQcAssessment,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRequest,
  YimengTakeTechnicalQcResult,
} from './types.ts'
import { parseTakeVersionReadRequest } from './take-versions.ts'

type Digest = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>

export const TAKE_TECHNICAL_QC_MACRO_CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
] as const
export const TAKE_TECHNICAL_QC_MICRO_CODES = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const
export const TAKE_TECHNICAL_QC_CODES = [
  ...TAKE_TECHNICAL_QC_MACRO_CODES, ...TAKE_TECHNICAL_QC_MICRO_CODES,
] as const

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'takeId', 'versionOrdinal',
  'selectionStatus', 'outputSha256', 'taskId', 'capability', 'routeKey', 'provider',
  'model', 'inputHash', 'submitId',
] as const
const ASSESSMENT_FIELDS = [
  'assessmentId', 'takeSubject', 'takeSubjectSha256', 'evidenceSnapshotSha256',
  'technicalReceiptStatus', 'checks', 'issueCodes', 'technicalPass',
  'methodProjectionSha256', 'rulesSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'recordedAt', 'eventId', 'currentBinding',
] as const
const RESULT_FIELDS = [
  'schema', 'assessment', 'technicalQcRecorded', 'technicalPass', 'changed',
  'selectionChanged', 'recommendationChanged', 'decisionRecorded',
  'formalApprovalChanged', 'technicalPassChanged', 'episodeVerificationChanged',
  'humanSignoffInferred', 'providerCalls', 'budgetMutation',
] as const
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

function exact(value: unknown, fields: readonly string[], field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())) {
    throw new Error(`take technical QC: ${field} fields mismatch`)
  }
  return value as JsonObject
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum: number, nonempty = true): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || (nonempty && pythonStrip(value) === '')) {
    throw new Error(`take technical QC: ${field} is invalid`)
  }
  return value
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) {
    throw new Error(`take technical QC: ${field} is invalid`)
  }
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take technical QC: ${field} is invalid`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take technical QC: ${field} is invalid`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error(`take technical QC: ${field} is invalid`)
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

function sortedUniqueText(
  value: unknown,
  field: string,
  maximum = 1024,
  maximumEntries?: number,
): readonly string[] {
  if (!Array.isArray(value)
    || (maximumEntries !== undefined && value.length > maximumEntries)) {
    throw new Error(`take technical QC: ${field} is invalid`)
  }
  const result = value.map((entry, index) => text(entry, `${field}[${String(index)}]`, maximum))
  const expected = [...new Set(result)].sort(compareUnicodeCodePoints)
  if (!isDeepStrictEqual(result, expected)) {
    throw new Error(`take technical QC: ${field} must be sorted and unique`)
  }
  return result
}

/** Accept only canonical Shot coordinates from the browser. */
export function parseTakeTechnicalQcRequest(payload: unknown): YimengTakeTechnicalQcRequest {
  return parseTakeVersionReadRequest(payload)
}

function subject(
  value: unknown,
  request: YimengTakeTechnicalQcRequest,
  field: string,
): YimengTakeAcceptanceSubject {
  const item = exact(value, SUBJECT_FIELDS, field)
  if (item.schema !== 'jason.qingmu-take-acceptance-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || item.selectionStatus !== 'Selected') {
    throw new Error(`take technical QC: ${field} binding mismatch`)
  }
  const nullableId = (value: unknown, name: string) => value === null ? null : id(value, name)
  const nullableSha = (value: unknown, name: string) => value === null ? null : sha(value, name)
  const nullableText = (value: unknown, name: string) => value === null ? null : text(value, name, 1024)
  return {
    schema: 'jason.qingmu-take-acceptance-subject.v1', ...request,
    frameNo: integer(item.frameNo, `${field}.frameNo`, 1),
    storyboardRevision: integer(item.storyboardRevision, `${field}.storyboardRevision`),
    frameContentSha256: sha(item.frameContentSha256, `${field}.frameContentSha256`),
    selectionRevision: integer(item.selectionRevision, `${field}.selectionRevision`),
    takeId: id(item.takeId, `${field}.takeId`),
    versionOrdinal: integer(item.versionOrdinal, `${field}.versionOrdinal`, 1),
    selectionStatus: 'Selected',
    outputSha256: nullableSha(item.outputSha256, `${field}.outputSha256`),
    taskId: nullableId(item.taskId, `${field}.taskId`),
    capability: nullableText(item.capability, `${field}.capability`),
    routeKey: nullableText(item.routeKey, `${field}.routeKey`),
    provider: nullableText(item.provider, `${field}.provider`),
    model: nullableText(item.model, `${field}.model`),
    inputHash: nullableSha(item.inputHash, `${field}.inputHash`),
    submitId: nullableId(item.submitId, `${field}.submitId`),
  }
}

function check(value: unknown, field: string, expectedCode: string): YimengTakeTechnicalQcCheck {
  const item = exact(value, ['code', 'result', 'note', 'evidenceRefs'], field)
  if (item.code !== expectedCode || !['PASS', 'FAIL', 'UNVERIFIED'].includes(item.result as string)) {
    throw new Error(`take technical QC: ${field} catalog mismatch`)
  }
  const result = item.result as YimengTakeTechnicalQcCheck['result']
  const note = item.note === null ? null : text(item.note, `${field}.note`, 8_000)
  const evidenceRefs = sortedUniqueText(item.evidenceRefs, `${field}.evidenceRefs`, 1024, 64)
  if (result !== 'PASS' && (note === null || evidenceRefs.length === 0)) {
    throw new Error(`take technical QC: ${field} evidence mismatch`)
  }
  return { code: expectedCode as YimengTakeTechnicalQcCheck['code'], result, note, evidenceRefs }
}

function assessment(
  value: unknown,
  request: YimengTakeTechnicalQcRequest,
  digest: Digest,
  field: string,
  currentAcceptance: YimengTakeTechnicalQcFeedResponse['currentAcceptance'],
): YimengTakeTechnicalQcAssessment {
  const item = exact(value, ASSESSMENT_FIELDS, field)
  const takeSubject = subject(item.takeSubject, request, `${field}.takeSubject`)
  const takeSubjectSha256 = sha(item.takeSubjectSha256, `${field}.takeSubjectSha256`)
  const rawChecks = item.checks
  if (digest(takeSubject, `${field}.takeSubject`) !== takeSubjectSha256
    || !Array.isArray(rawChecks) || rawChecks.length !== TAKE_TECHNICAL_QC_CODES.length) {
    throw new Error(`take technical QC: ${field} subject mismatch`)
  }
  const checks = TAKE_TECHNICAL_QC_CODES.map((code, index) =>
    check(rawChecks[index], `${field}.checks[${String(index)}]`, code))
  const issueCodes = sortedUniqueText(item.issueCodes, `${field}.issueCodes`, 64)
  const expectedIssues = checks.filter(entry => entry.result !== 'PASS').map(entry => entry.code)
    .sort(compareUnicodeCodePoints)
  const technicalReceiptStatus = item.technicalReceiptStatus
  const technicalPass = technicalReceiptStatus === 'PASS' && expectedIssues.length === 0
  const currentBinding = takeSubjectSha256 === currentAcceptance.takeSubjectSha256
    && item.evidenceSnapshotSha256 === currentAcceptance.evidenceSnapshotSha256
    && technicalReceiptStatus === currentAcceptance.technicalReceiptStatus
  if (!isDeepStrictEqual(issueCodes, expectedIssues)
    || (technicalReceiptStatus !== 'PASS' && technicalReceiptStatus !== 'BLOCKED')
    || item.technicalPass !== technicalPass || item.currentBinding !== currentBinding
    || item.actorRole !== 'reviewer'
    || (technicalReceiptStatus !== 'PASS'
      && checks.find(entry => entry.code === 'TECHNICAL_RECEIPT')?.result === 'PASS')) {
    throw new Error(`take technical QC: ${field} derived state mismatch`)
  }
  return {
    assessmentId: id(item.assessmentId, `${field}.assessmentId`), takeSubject, takeSubjectSha256,
    evidenceSnapshotSha256: sha(item.evidenceSnapshotSha256, `${field}.evidenceSnapshotSha256`),
    technicalReceiptStatus, checks, issueCodes, technicalPass,
    methodProjectionSha256: sha(item.methodProjectionSha256, `${field}.methodProjectionSha256`),
    rulesSha256: sha(item.rulesSha256, `${field}.rulesSha256`),
    actorId: id(item.actorId, `${field}.actorId`), actorRole: 'reviewer',
    actorNaturalPersonId: id(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`),
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    recordedAt: timestamp(item.recordedAt, `${field}.recordedAt`),
    eventId: id(item.eventId, `${field}.eventId`), currentBinding,
  }
}

/** Validate the exact E7-3 feed and derive its current assessment independently. */
export function normalizeTakeTechnicalQcFeed(
  value: unknown,
  request: YimengTakeTechnicalQcRequest,
  digest: Digest,
): YimengTakeTechnicalQcFeedResponse {
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'capabilities', 'currentAcceptance',
    'assessments', 'currentAssessment', 'boundaries',
  ], 'feed')
  if (root.schema !== 'jason.qingmu-take-technical-qc-feed.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId || !Array.isArray(root.assessments)) {
    throw new Error('take technical QC: feed mismatch')
  }
  const capabilities = exact(root.capabilities, ['canRecordTechnicalQc'], 'capabilities')
  if (typeof capabilities.canRecordTechnicalQc !== 'boolean') {
    throw new Error('take technical QC: capabilities mismatch')
  }
  const acceptanceValue = exact(root.currentAcceptance, [
    'takeSubject', 'takeSubjectSha256', 'evidenceSnapshotSha256', 'technicalReceiptStatus',
  ], 'currentAcceptance')
  const takeSubject = subject(acceptanceValue.takeSubject, request, 'currentAcceptance.takeSubject')
  const takeSubjectSha256 = sha(acceptanceValue.takeSubjectSha256, 'currentAcceptance.takeSubjectSha256')
  if (digest(takeSubject, 'currentAcceptance.takeSubject') !== takeSubjectSha256
    || !['PASS', 'BLOCKED'].includes(acceptanceValue.technicalReceiptStatus as string)) {
    throw new Error('take technical QC: current acceptance mismatch')
  }
  const currentAcceptance = {
    takeSubject, takeSubjectSha256,
    evidenceSnapshotSha256: sha(acceptanceValue.evidenceSnapshotSha256, 'currentAcceptance.evidenceSnapshotSha256'),
    technicalReceiptStatus: acceptanceValue.technicalReceiptStatus as 'PASS' | 'BLOCKED',
  }
  const assessments = root.assessments.map((entry, index) =>
    assessment(entry, request, digest, `assessments[${String(index)}]`, currentAcceptance))
  const expectedCurrent = [...assessments].reverse().find(entry => entry.currentBinding) ?? null
  const currentAssessment = root.currentAssessment === null ? null
    : assessment(root.currentAssessment, request, digest, 'currentAssessment', currentAcceptance)
  if (!isDeepStrictEqual(currentAssessment, expectedCurrent)) {
    throw new Error('take technical QC: currentAssessment mismatch')
  }
  const boundaries = exact(root.boundaries, [
    'technicalQcOnly', 'technicalPassIsContentApproval', 'selectionChanged',
    'formalApprovalChanged', 'episodeVerificationChanged', 'humanSignoffInferred',
    'providerCalls', 'budgetMutation', 'reworkExecutionAllowed',
    'approvalInvalidationAllowed', 'evidenceLedgerMutation',
  ], 'boundaries')
  const expectedBoundaries = {
    technicalQcOnly: true as const, technicalPassIsContentApproval: false as const,
    selectionChanged: false as const, formalApprovalChanged: false as const,
    episodeVerificationChanged: false as const, humanSignoffInferred: false as const,
    providerCalls: 0 as const, budgetMutation: false as const,
    reworkExecutionAllowed: false as const, approvalInvalidationAllowed: false as const,
    evidenceLedgerMutation: false as const,
  }
  if (!isDeepStrictEqual(boundaries, expectedBoundaries)) {
    throw new Error('take technical QC: boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-take-technical-qc-feed.v1', ...request,
    capabilities: { canRecordTechnicalQc: capabilities.canRecordTechnicalQc },
    currentAcceptance, assessments, currentAssessment, boundaries: expectedBoundaries,
  }
}

/** Validate the immutable POST result without trusting server-derived flags. */
export function normalizeTakeTechnicalQcResult(
  value: unknown,
  request: YimengTakeTechnicalQcRequest,
  digest: Digest,
  currentAcceptance: YimengTakeTechnicalQcFeedResponse['currentAcceptance'],
): YimengTakeTechnicalQcResult {
  const root = exact(value, RESULT_FIELDS, 'result')
  const rawAssessment = exact(root.assessment, ASSESSMENT_FIELDS.filter(field => field !== 'currentBinding'), 'result.assessment')
  const normalized = assessment({ ...rawAssessment, currentBinding: true }, request, digest, 'result.assessment', currentAcceptance)
  if (root.schema !== 'jason.qingmu-take-technical-qc-result.v1'
    || root.technicalQcRecorded !== true || root.technicalPass !== normalized.technicalPass
    || root.changed !== false || root.selectionChanged !== false
    || root.recommendationChanged !== false || root.decisionRecorded !== false
    || root.formalApprovalChanged !== false || root.technicalPassChanged !== false
    || root.episodeVerificationChanged !== false || root.humanSignoffInferred !== false
    || root.providerCalls !== 0 || root.budgetMutation !== false) {
    throw new Error('take technical QC: result boundary mismatch')
  }
  const { currentBinding: _currentBinding, ...assessmentResult } = normalized
  return {
    schema: 'jason.qingmu-take-technical-qc-result.v1', assessment: assessmentResult,
    technicalQcRecorded: true, technicalPass: normalized.technicalPass,
    changed: false, selectionChanged: false, recommendationChanged: false,
    decisionRecorded: false, formalApprovalChanged: false, technicalPassChanged: false,
    episodeVerificationChanged: false, humanSignoffInferred: false,
    providerCalls: 0, budgetMutation: false,
  }
}
