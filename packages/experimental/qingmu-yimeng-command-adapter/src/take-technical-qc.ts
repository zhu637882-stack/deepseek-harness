/** Record one immutable E7-3 Reviewer technical-QC assessment. */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengCommandJsonObject,
  YimengRecordTakeTechnicalQcRequest,
  YimengTakeTechnicalQcAssessment,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
  YimengTakeTechnicalQcSubject,
} from './types.ts'

const MACRO_CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
] as const
const MICRO_CODES = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const
const ALL_CODES = [...MACRO_CODES, ...MICRO_CODES] as const
const RESULTS = ['PASS', 'FAIL', 'UNVERIFIED'] as const
const REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedEvidenceSnapshotSha256',
  'takeId', 'checks', 'idempotencyKey',
] as const
const CHECK_FIELDS = ['code', 'result', 'note', 'evidenceRefs'] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'takeId', 'versionOrdinal',
  'selectionStatus', 'outputSha256', 'taskId', 'capability', 'routeKey', 'provider',
  'model', 'inputHash', 'submitId',
] as const
const METHOD_FIELDS = [
  'schema', 'subject', 'evidenceSnapshotSha256', 'technicalReceiptStatus',
  'definition', 'ruleBindings', 'rulesSha256',
] as const
const METHOD_RESPONSE_FIELDS = ['schema', 'projection', 'projectionSha256', 'methodAttestation'] as const
const ASSESSMENT_FIELDS = [
  'assessmentId', 'takeSubject', 'takeSubjectSha256', 'evidenceSnapshotSha256',
  'technicalReceiptStatus', 'checks', 'issueCodes', 'technicalPass',
  'methodProjectionSha256', 'rulesSha256', 'actorId', 'actorRole',
  'actorNaturalPersonId', 'authSessionId', 'recordedAt', 'eventId',
] as const
const RESULT_FIELDS = [
  'schema', 'assessment', 'technicalQcRecorded', 'technicalPass', 'changed',
  'selectionChanged', 'recommendationChanged', 'decisionRecorded',
  'formalApprovalChanged', 'technicalPassChanged', 'episodeVerificationChanged',
  'humanSignoffInferred', 'providerCalls', 'budgetMutation',
] as const
const RULE_PATHS = [
  'pipeline/v6-video-generation-routing-policy.json',
  'pipeline/v6-video-reference-integrity-overlay-policy.json',
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_qc_method.py',
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
  readonly projection: YimengCommandJsonObject
  readonly projectionSha256: string
  readonly attestation: YimengCommandJsonObject
  readonly subject: YimengTakeTechnicalQcSubject
  readonly technicalReceiptStatus: 'PASS' | 'BLOCKED'
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
  YimengTakeTechnicalQcResult | YimengTakeTechnicalQcRecovery
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw error(`${field} must be an object`)
  }
  return value as YimengCommandJsonObject
}

function exact(
  value: unknown,
  keys: readonly string[],
  field: string,
  error: ErrorFactory,
): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key))) {
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

function normalizedRefs(value: unknown, field: string, error: ErrorFactory): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) throw error(`${field} must be a bounded array`)
  const entries = value.map((entry, index) =>
    text(entry, 1024, `${field}[${String(index)}]`, error, true))
  return [...new Set(entries)].sort(compareUnicodeCodePoints)
}

function normalizedChecks(
  value: unknown,
  field: string,
  error: ErrorFactory,
): readonly YimengTakeTechnicalQcCheck[] {
  if (!Array.isArray(value) || value.length !== ALL_CODES.length) {
    throw error(`${field} must contain all 12 QC checks`)
  }
  const byCode = new Map<YimengTakeTechnicalQcCode, YimengTakeTechnicalQcCheck>()
  for (const [index, raw] of value.entries()) {
    const item = exact(raw, CHECK_FIELDS, `${field}[${String(index)}]`, error)
    if (!ALL_CODES.includes(item.code as YimengTakeTechnicalQcCode)
      || !RESULTS.includes(item.result as typeof RESULTS[number])) {
      throw error(`${field}[${String(index)}] has an invalid code or result`)
    }
    const code = item.code as YimengTakeTechnicalQcCode
    if (byCode.has(code)) throw error(`${field} contains a duplicate code`)
    const result = item.result as YimengTakeTechnicalQcCheck['result']
    const note = item.note === null ? null : text(item.note, 8_000, `${field}.${code}.note`, error)
    const evidenceRefs = normalizedRefs(item.evidenceRefs, `${field}.${code}.evidenceRefs`, error)
    if (result !== 'PASS' && (note === null || evidenceRefs.length === 0)) {
      throw error(`${field}.${code} requires note and evidence refs when not PASS`)
    }
    byCode.set(code, { code, result, note, evidenceRefs })
  }
  if (byCode.size !== ALL_CODES.length) throw error(`${field} is incomplete`)
  return ALL_CODES.map((code) => {
    const normalized = byCode.get(code)
    if (normalized === undefined) throw error(`${field} is incomplete`)
    return normalized
  })
}

function request(value: unknown, error: ErrorFactory): YimengRecordTakeTechnicalQcRequest {
  const item = exact(value, REQUEST_FIELDS, 'payload', error)
  const idempotencyKey = id(item.idempotencyKey, 'idempotencyKey', error)
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw error('idempotencyKey must use visible ASCII')
  return {
    projectId: id(item.projectId, 'projectId', error),
    episodeId: id(item.episodeId, 'episodeId', error),
    frameId: id(item.frameId, 'frameId', error),
    expectedEvidenceSnapshotSha256: sha(
      item.expectedEvidenceSnapshotSha256,
      'expectedEvidenceSnapshotSha256',
      error,
    ),
    takeId: id(item.takeId, 'takeId', error),
    checks: normalizedChecks(item.checks, 'checks', error),
    idempotencyKey,
  }
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

function subject(
  value: unknown,
  intent: YimengRecordTakeTechnicalQcRequest,
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
    projectId: intent.projectId, episodeId: intent.episodeId, frameId: intent.frameId,
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

function methodDefinition(value: unknown, error: ErrorFactory): YimengCommandJsonObject {
  const definition = exact(value, [
    'mode', 'catalog', 'resultOptions', 'allCodesExactlyOnce', 'nonPassRequires',
    'unverifiedIsNotPass', 'technicalReceipt', 'boundaries',
  ], 'methodProjection.definition', error)
  const catalog = exact(definition.catalog, ['macro', 'micro'], 'methodProjection.definition.catalog', error)
  const macro = exact(catalog.macro, ['layer', 'codes'], 'methodProjection.definition.catalog.macro', error)
  const micro = exact(catalog.micro, ['layer', 'codes'], 'methodProjection.definition.catalog.micro', error)
  const nonPass = exact(
    definition.nonPassRequires,
    ['note', 'evidenceRefs'],
    'methodProjection.definition.nonPassRequires',
    error,
  )
  const receipt = exact(definition.technicalReceipt, [
    'code', 'machineEvidencePassRequiredForCheckPass', 'machineEvidencePassRequiredForOverallPass',
  ], 'methodProjection.definition.technicalReceipt', error)
  const boundaries = exact(definition.boundaries, [
    'businessTruth', 'technicalQcOnly', 'technicalPassIsContentApproval',
    'selectionChanged', 'recommendationChanged', 'decisionRecorded',
    'formalApprovalChanged', 'episodeVerificationChanged', 'humanSignoffInferred',
    'providerCalls', 'budgetMutation', 'approvalInvalidationAllowed',
    'reworkExecutionAllowed', 'evidenceLedgerMutation',
  ], 'methodProjection.definition.boundaries', error)
  const expectedBoundaries = {
    businessTruth: 'yimeng', technicalQcOnly: true, technicalPassIsContentApproval: false,
    selectionChanged: false, recommendationChanged: false, decisionRecorded: false,
    formalApprovalChanged: false, episodeVerificationChanged: false,
    humanSignoffInferred: false, providerCalls: 0, budgetMutation: false,
    approvalInvalidationAllowed: false, reworkExecutionAllowed: false,
    evidenceLedgerMutation: false,
  }
  if (definition.mode !== 'STATELESS_TECHNICAL_QC_METHOD'
    || !isDeepStrictEqual(macro, { layer: 'MACRO_QC', codes: MACRO_CODES })
    || !isDeepStrictEqual(micro, { layer: 'MICRO_QC', codes: MICRO_CODES })
    || !isDeepStrictEqual(definition.resultOptions, RESULTS)
    || definition.allCodesExactlyOnce !== true || definition.unverifiedIsNotPass !== true
    || !isDeepStrictEqual(nonPass, { note: true, evidenceRefs: true })
    || !isDeepStrictEqual(receipt, {
      code: 'TECHNICAL_RECEIPT', machineEvidencePassRequiredForCheckPass: true,
      machineEvidencePassRequiredForOverallPass: true,
    })
    || !isDeepStrictEqual(boundaries, expectedBoundaries)) {
    throw error('methodProjection definition mismatch')
  }
  return definition
}

function ruleBindings(
  value: unknown,
  helpers: Helpers,
  error: ErrorFactory,
): Readonly<Record<string, string>> {
  const item = exact(value, RULE_PATHS, 'methodProjection.ruleBindings', error)
  const result = Object.fromEntries(RULE_PATHS.map(path => [
    path, sha(item[path], `methodProjection.ruleBindings.${path}`, error),
  ]))
  helpers.canonicalJson(result, 'methodProjection.ruleBindings')
  return result
}

function currentMethod(
  value: unknown,
  intent: YimengRecordTakeTechnicalQcRequest,
  helpers: Helpers,
): VerifiedMethod {
  const error = helpers.responseError
  const response = exact(value, METHOD_RESPONSE_FIELDS, 'takeTechnicalQcMethod', error)
  if (response.schema !== 'qingmu.imago-take-technical-qc-method-adapter-result.v1') {
    throw error('takeTechnicalQcMethod schema mismatch')
  }
  const item = exact(response.projection, METHOD_FIELDS, 'methodProjection', error)
  const boundSubject = subject(item.subject, intent, 'methodProjection.subject', error)
  const evidenceSnapshotSha256 = sha(
    item.evidenceSnapshotSha256,
    'methodProjection.evidenceSnapshotSha256',
    error,
  )
  if (item.schema !== 'qingmu.imago-take-technical-qc-method.v1'
    || evidenceSnapshotSha256 !== intent.expectedEvidenceSnapshotSha256
    || (item.technicalReceiptStatus !== 'PASS' && item.technicalReceiptStatus !== 'BLOCKED')) {
    throw error('methodProjection evidence binding mismatch')
  }
  const definition = methodDefinition(item.definition, error)
  const bindings = ruleBindings(item.ruleBindings, helpers, error)
  const rulesSha256 = sha(item.rulesSha256, 'methodProjection.rulesSha256', error)
  if (helpers.canonicalJsonSha256(bindings, 'methodProjection.ruleBindings') !== rulesSha256) {
    throw error('methodProjection rules SHA mismatch')
  }
  const projection: YimengCommandJsonObject = {
    schema: 'qingmu.imago-take-technical-qc-method.v1', subject: boundSubject,
    evidenceSnapshotSha256, technicalReceiptStatus: item.technicalReceiptStatus,
    definition, ruleBindings: bindings, rulesSha256,
  }
  const projectionSha256 = sha(response.projectionSha256, 'methodProjectionSha256', error)
  if (helpers.canonicalJsonSha256(projection, 'methodProjection') !== projectionSha256) {
    throw error('methodProjection SHA mismatch')
  }
  const unsigned = {
    schema: 'qingmu.imago-take-technical-qc-method-attestation.v1',
    algorithm: 'hmac-sha256', evidenceSnapshotSha256, methodProjectionSha256: projectionSha256,
  } as const
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
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) {
    throw error('methodAttestation signature mismatch')
  }
  return {
    projection, projectionSha256, attestation: { ...unsigned, signature },
    subject: boundSubject, technicalReceiptStatus: item.technicalReceiptStatus,
    rulesSha256,
  }
}

function normalizeAssessment(
  value: unknown,
  intent: YimengRecordTakeTechnicalQcRequest,
  helpers: Helpers,
  verified?: VerifiedMethod,
): YimengTakeTechnicalQcAssessment {
  const error = helpers.responseError
  const item = exact(value, ASSESSMENT_FIELDS, 'takeTechnicalQcResult.assessment', error)
  const takeSubject = subject(item.takeSubject, intent, 'takeTechnicalQcResult.assessment.takeSubject', error)
  const takeSubjectSha256 = sha(
    item.takeSubjectSha256,
    'takeTechnicalQcResult.assessment.takeSubjectSha256',
    error,
  )
  const evidenceSnapshotSha256 = sha(
    item.evidenceSnapshotSha256,
    'takeTechnicalQcResult.assessment.evidenceSnapshotSha256',
    error,
  )
  const checks = normalizedChecks(item.checks, 'takeTechnicalQcResult.assessment.checks', error)
  const issueCodes = checks.filter(check => check.result !== 'PASS').map(check => check.code)
    .sort(compareUnicodeCodePoints)
  if (!Array.isArray(item.issueCodes)
    || !isDeepStrictEqual(item.issueCodes, issueCodes)
    || helpers.canonicalJsonSha256(takeSubject, 'takeTechnicalQcResult.assessment.takeSubject')
      !== takeSubjectSha256
    || evidenceSnapshotSha256 !== intent.expectedEvidenceSnapshotSha256
    || !isDeepStrictEqual(checks, intent.checks)
    || (item.technicalReceiptStatus !== 'PASS' && item.technicalReceiptStatus !== 'BLOCKED')) {
    throw error('takeTechnicalQcResult assessment binding mismatch')
  }
  const technicalReceiptStatus = item.technicalReceiptStatus
  const technicalPass = technicalReceiptStatus === 'PASS' && issueCodes.length === 0
  if (item.technicalPass !== technicalPass
    || (technicalReceiptStatus !== 'PASS'
      && checks.find(check => check.code === 'TECHNICAL_RECEIPT')?.result === 'PASS')) {
    throw error('takeTechnicalQcResult derived state mismatch')
  }
  const methodProjectionSha256 = sha(
    item.methodProjectionSha256,
    'takeTechnicalQcResult.assessment.methodProjectionSha256',
    error,
  )
  const rulesSha256 = sha(item.rulesSha256, 'takeTechnicalQcResult.assessment.rulesSha256', error)
  if (verified !== undefined && (
    !isDeepStrictEqual(takeSubject, verified.subject)
    || technicalReceiptStatus !== verified.technicalReceiptStatus
    || methodProjectionSha256 !== verified.projectionSha256
    || rulesSha256 !== verified.rulesSha256
  )) throw error('takeTechnicalQcResult current Method binding mismatch')
  if (item.actorRole !== 'reviewer') throw error('takeTechnicalQcResult actor role mismatch')
  return {
    assessmentId: id(item.assessmentId, 'takeTechnicalQcResult.assessment.assessmentId', error),
    takeSubject, takeSubjectSha256, evidenceSnapshotSha256, technicalReceiptStatus,
    checks, issueCodes, technicalPass, methodProjectionSha256, rulesSha256,
    actorId: id(item.actorId, 'takeTechnicalQcResult.assessment.actorId', error),
    actorRole: 'reviewer',
    actorNaturalPersonId: id(
      item.actorNaturalPersonId,
      'takeTechnicalQcResult.assessment.actorNaturalPersonId',
      error,
    ),
    authSessionId: sha(item.authSessionId, 'takeTechnicalQcResult.assessment.authSessionId', error),
    recordedAt: helpers.requireTimestamp(item.recordedAt, 'takeTechnicalQcResult.assessment.recordedAt'),
    eventId: id(item.eventId, 'takeTechnicalQcResult.assessment.eventId', error),
  }
}

function normalizeResult(
  value: unknown,
  intent: YimengRecordTakeTechnicalQcRequest,
  helpers: Helpers,
  verified?: VerifiedMethod,
): YimengTakeTechnicalQcResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'takeTechnicalQcResult', error)
  const assessment = normalizeAssessment(root.assessment, intent, helpers, verified)
  if (root.schema !== 'jason.qingmu-take-technical-qc-result.v1'
    || root.technicalQcRecorded !== true || root.technicalPass !== assessment.technicalPass
    || root.changed !== false || root.selectionChanged !== false
    || root.recommendationChanged !== false || root.decisionRecorded !== false
    || root.formalApprovalChanged !== false || root.technicalPassChanged !== false
    || root.episodeVerificationChanged !== false || root.humanSignoffInferred !== false
    || root.providerCalls !== 0 || root.budgetMutation !== false) {
    throw error('takeTechnicalQcResult authority flags mismatch')
  }
  return {
    schema: 'jason.qingmu-take-technical-qc-result.v1', assessment,
    technicalQcRecorded: true, technicalPass: assessment.technicalPass,
    changed: false, selectionChanged: false, recommendationChanged: false,
    decisionRecorded: false, formalApprovalChanged: false, technicalPassChanged: false,
    episodeVerificationChanged: false, humanSignoffInferred: false,
    providerCalls: 0, budgetMutation: false,
  }
}

/** Build the only identity payload sent to the trusted current Core method. */
export function prepareCurrentTakeTechnicalQcMethodRequest(
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

/** Prepare one Host-derived POST or the original GET-only receipt recovery. */
export function prepareTakeTechnicalQcCommand(
  endpoint: 'recordTakeTechnicalQc' | 'recoverTakeTechnicalQc',
  payload: unknown,
  helpers: Helpers,
  currentMethodValue?: unknown,
): PreparedCommand {
  const intent = request(payload, helpers.inputError)
  const rootPath = `/api/qingmu/projects/${encodeURIComponent(intent.projectId)}`
    + `/episodes/${encodeURIComponent(intent.episodeId)}`
    + `/frames/${encodeURIComponent(intent.frameId)}/take-technical-qc/assessments`
  if (endpoint === 'recordTakeTechnicalQc') {
    if (currentMethodValue === undefined) throw helpers.responseError('current technical-QC Method is unavailable')
    const verified = currentMethod(currentMethodValue, intent, helpers)
    if (verified.technicalReceiptStatus !== 'PASS'
      && intent.checks.find(check => check.code === 'TECHNICAL_RECEIPT')?.result === 'PASS') {
      throw helpers.inputError('TECHNICAL_RECEIPT cannot PASS while current machine evidence is blocked')
    }
    return {
      path: rootPath,
      request: {
        method: 'POST', idempotencyKey: intent.idempotencyKey,
        body: {
          expectedEvidenceSnapshotSha256: intent.expectedEvidenceSnapshotSha256,
          takeId: intent.takeId,
          methodProjection: verified.projection,
          methodProjectionSha256: verified.projectionSha256,
          methodAttestation: verified.attestation,
          checks: intent.checks,
          idempotencyKey: intent.idempotencyKey,
        },
      },
      normalize: value => normalizeResult(value, intent, helpers, verified),
    }
  }
  const query = new URLSearchParams({
    expectedEvidenceSnapshotSha256: intent.expectedEvidenceSnapshotSha256,
    takeId: intent.takeId,
  })
  return {
    path: `${rootPath}/command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: intent.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(value, [
        'schema', 'projectId', 'episodeId', 'frameId', 'takeId',
        'expectedEvidenceSnapshotSha256', 'idempotencyKey', 'status', 'result',
      ], 'takeTechnicalQcRecovery', error)
      if (root.schema !== 'jason.qingmu-take-technical-qc-recovery.v1'
        || root.projectId !== intent.projectId || root.episodeId !== intent.episodeId
        || root.frameId !== intent.frameId || root.takeId !== intent.takeId
        || root.expectedEvidenceSnapshotSha256 !== intent.expectedEvidenceSnapshotSha256
        || root.idempotencyKey !== intent.idempotencyKey
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)
        || (root.status === 'committed' && root.result === null)) {
        throw error('takeTechnicalQcRecovery binding mismatch')
      }
      return {
        schema: 'jason.qingmu-take-technical-qc-recovery.v1',
        projectId: intent.projectId, episodeId: intent.episodeId, frameId: intent.frameId,
        takeId: intent.takeId,
        expectedEvidenceSnapshotSha256: intent.expectedEvidenceSnapshotSha256,
        idempotencyKey: intent.idempotencyKey,
        status: root.status,
        result: root.status === 'committed'
          ? normalizeResult(root.result, intent, helpers)
          : null,
      }
    },
  }
}
