/** Seal one exact current episode LSU scope, recover its receipt, or probe current authority. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengCommandJsonObject,
  YimengForwardedLsuPlanAuthorityProbeRequest,
  YimengForwardedSealLsuPlanRequest,
  YimengImagoLsuPlanMethodAttestation,
  YimengImagoLsuPlanMethodProjection,
  YimengLsuPlanAuthorityProbe,
  YimengLsuPlanBlueprintLock,
  YimengLsuPlanDefinition,
  YimengLsuPlanProductionUnit,
  YimengLsuPlanSeal,
  YimengLsuPlanSealRecovery,
  YimengLsuPlanSealResult,
  YimengLsuPlanSubject,
  YimengProbeLsuPlanAuthorityRequest,
  YimengSealLsuPlanRequest,
} from './types.ts'

const SEAL_FIELDS = [
  'projectId', 'episodeId', 'expectedSubjectSha256', 'expectedPlanRevision', 'expectedPlanSha256', 'idempotencyKey',
] as const
const PROBE_FIELDS = ['projectId', 'episodeId'] as const
const METHOD_RESPONSE_FIELDS = ['schema', 'projection', 'projectionSha256', 'methodAttestation'] as const
const PROJECTION_FIELDS = [
  'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256',
  'lockRuleBindings', 'lockRulesSha256',
] as const
const SUBJECT_FIELDS = ['schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock'] as const
const UNIT_FIELDS = ['unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256'] as const
const LOCK_FIELDS = [
  'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
] as const
const DEFINITION_FIELDS = [
  'id', 'version', 'scope', 'unitIdPattern', 'stages', 'requiredLockId', 'requiredLockStageId',
  'requiredLockScopeInstance', 'declarationPolicy', 'operation', 'planSealingAllowed', 'stageApprovalAllowed',
  'lockActivationAllowed', 'reworkExecutionAllowed', 'providerCalls',
] as const
const STAGE_FIELDS = ['stageId', 'roleId', 'contractSha256'] as const
const RESULT_FIELDS = [
  'schema', 'seal', 'sealSha256', 'receiptId', 'outboxEventId', 'planSealed', 'stageApprovalGranted',
  'lockActivated', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted',
] as const
const RECORD_FIELDS = [
  'projectId', 'episodeId', 'revision', 'subject', 'subjectSnapshotSha256', 'definition',
  'methodProjectionSha256', 'rulesSha256', 'lockRulesSha256', 'actorId', 'actorNaturalPersonId',
  'authSessionId', 'eventId', 'changeSetId', 'sealedAt',
] as const
const RECOVERY_FIELDS = [
  'schema', 'projectId', 'episodeId', 'expectedSubjectSha256', 'expectedPlanRevision', 'expectedPlanSha256',
  'idempotencyKey', 'found', 'result',
] as const
const AUTHORITY_FIELDS = [
  'schema', 'projectId', 'episodeId', 'subjectSnapshotSha256', 'methodProjectionSha256', 'rulesSha256',
  'lockRulesSha256', 'latestSeal', 'currentPlanSealed', 'planSealed', 'stageApprovalGranted',
  'lockActivated', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted',
] as const

type ErrorFactory = (message: string) => Error
interface Helpers {
  readonly canonicalJson: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly readAttestationKey: () => string
  readonly requireTimestamp: (value: unknown, field: string) => string
}
interface PreparedCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey?: string
  }
  readonly normalize: (value: unknown, token: string) =>
  YimengLsuPlanSealResult | YimengLsuPlanSealRecovery | YimengLsuPlanAuthorityProbe
}
interface VerifiedMethod {
  readonly projection: YimengImagoLsuPlanMethodProjection
  readonly projectionSha256: string
  readonly attestation: YimengImagoLsuPlanMethodAttestation
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw error(`${field} must be an object`)
  return value as YimengCommandJsonObject
}

function exact(value: unknown, fields: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...fields].sort())) throw error(`${field} has invalid fields`)
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value === '' || value !== pythonStrip(value)
    || Array.from(value).length > 256 || /[\u0000\r\n]/u.test(value)) throw error(`${field} must be canonical text`)
  return value
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw error(`${field} must be sha256`)
  return value
}

function integer(value: unknown, field: string, error: ErrorFactory, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer`)
  }
  return value
}

function idempotencyKey(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200 || !/^[\x21-\x7e]+$/u.test(value)) {
    throw error('idempotencyKey must be 8..200 visible ASCII characters')
  }
  return value
}

function digest(value: unknown, helpers: Helpers, field: string, error: ErrorFactory): string {
  try {
    return createHash('sha256').update(helpers.canonicalJson(value, field), 'utf8').digest('hex')
  } catch {
    throw error(`${field} must be canonical JSON`)
  }
}

function subject(value: unknown, coordinates: YimengProbeLsuPlanAuthorityRequest, error: ErrorFactory): YimengLsuPlanSubject {
  const item = exact(value, SUBJECT_FIELDS, 'methodProjection.subject', error)
  if (item.schema !== 'jason.qingmu-lsu-plan-subject.v1' || item.projectId !== coordinates.projectId
    || item.episodeId !== coordinates.episodeId || !Array.isArray(item.productionUnits) || item.productionUnits.length === 0) {
    throw error('methodProjection subject coordinates mismatch')
  }
  const seenUnits = new Set<string>()
  const seenGroups = new Set<string>()
  let previous = ''
  const productionUnits: YimengLsuPlanProductionUnit[] = item.productionUnits.map((raw, index) => {
    const field = `methodProjection.subject.productionUnits[${String(index)}]`
    const unit = exact(raw, UNIT_FIELDS, field, error)
    const unitId = id(unit.unitId, `${field}.unitId`, error)
    const groupId = id(unit.groupId, `${field}.groupId`, error)
    if (!/^LSU[0-9]{2,}$/u.test(unitId) || seenUnits.has(unitId) || seenGroups.has(groupId)
      || (previous !== '' && unitId <= previous)) throw error('methodProjection subject units mismatch')
    seenUnits.add(unitId)
    seenGroups.add(groupId)
    previous = unitId
    return {
      unitId, groupId,
      bindingRevision: integer(unit.bindingRevision, `${field}.bindingRevision`, error, 1),
      bindingSha256: sha(unit.bindingSha256, `${field}.bindingSha256`, error),
      sourceSnapshotSha256: sha(unit.sourceSnapshotSha256, `${field}.sourceSnapshotSha256`, error),
    }
  })
  const rawLock = exact(item.productionBlueprintLock, LOCK_FIELDS, 'productionBlueprintLock', error)
  if (rawLock.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || rawLock.stageId !== 'C5F' || rawLock.scopeInstance !== 'GLOBAL') {
    throw error('methodProjection current C5F blueprint lock mismatch')
  }
  const productionBlueprintLock: YimengLsuPlanBlueprintLock = {
    lockId: 'PRODUCTION_BLUEPRINT_LOCK', stageId: 'C5F', scopeInstance: 'GLOBAL',
    artifactRecordRevision: integer(rawLock.artifactRecordRevision, 'artifactRecordRevision', error, 1),
    artifactRecordSha256: sha(rawLock.artifactRecordSha256, 'artifactRecordSha256', error),
    decisionId: id(rawLock.decisionId, 'decisionId', error),
    eventSha256: sha(rawLock.eventSha256, 'eventSha256', error),
  }
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1', projectId: coordinates.projectId, episodeId: coordinates.episodeId,
    productionUnits, productionBlueprintLock,
  }
}

function definition(value: unknown, error: ErrorFactory): YimengLsuPlanDefinition {
  const item = exact(value, DEFINITION_FIELDS, 'methodProjection.definition', error)
  if (item.id !== 'IMAGO-V6-LSU-PLAN' || item.scope !== 'per_episode' || item.unitIdPattern !== 'LSU[0-9]{2,}'
    || item.requiredLockId !== 'PRODUCTION_BLUEPRINT_LOCK' || item.requiredLockStageId !== 'C5F'
    || item.requiredLockScopeInstance !== 'GLOBAL' || item.declarationPolicy !== 'exact_current_instantiated_units'
    || item.operation !== 'seal_current_lsu_plan' || item.planSealingAllowed !== true
    || item.stageApprovalAllowed !== false || item.lockActivationAllowed !== false
    || item.reworkExecutionAllowed !== false || item.providerCalls !== 0
    || !Array.isArray(item.stages) || item.stages.length === 0) throw error('LSU plan definition authority mismatch')
  const seen = new Set<string>()
  const stages = item.stages.map((raw, index) => {
    const field = `methodProjection.definition.stages[${String(index)}]`
    const stage = exact(raw, STAGE_FIELDS, field, error)
    const stageId = id(stage.stageId, `${field}.stageId`, error)
    if (seen.has(stageId)) throw error('LSU plan definition stage IDs must be unique')
    seen.add(stageId)
    return {
      stageId,
      roleId: id(stage.roleId, `${field}.roleId`, error),
      contractSha256: sha(stage.contractSha256, `${field}.contractSha256`, error),
    }
  })
  return {
    id: 'IMAGO-V6-LSU-PLAN', version: id(item.version, 'definition.version', error), scope: 'per_episode',
    unitIdPattern: 'LSU[0-9]{2,}', stages, requiredLockId: 'PRODUCTION_BLUEPRINT_LOCK',
    requiredLockStageId: 'C5F', requiredLockScopeInstance: 'GLOBAL',
    declarationPolicy: 'exact_current_instantiated_units', operation: 'seal_current_lsu_plan',
    planSealingAllowed: true, stageApprovalAllowed: false, lockActivationAllowed: false,
    reworkExecutionAllowed: false, providerCalls: 0,
  }
}

function ruleBindings(value: unknown, field: string, helpers: Helpers, error: ErrorFactory): Readonly<Record<string, string>> {
  const item = object(value, field, error)
  if (Object.keys(item).length === 0) throw error(`${field} must be non-empty`)
  const result = Object.fromEntries(Object.entries(item).map(([path, value]) => {
    id(path, `${field} path`, error)
    if (path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw error(`${field} path must be safe and relative`)
    }
    return [path, sha(value, `${field} digest`, error)]
  }))
  digest(result, helpers, field, error)
  return result
}

function verifyMethod(
  projectionValue: unknown,
  projectionShaValue: unknown,
  attestationValue: unknown,
  coordinates: YimengProbeLsuPlanAuthorityRequest,
  helpers: Helpers,
  error: ErrorFactory,
  expectedSubjectSha256?: string,
): VerifiedMethod {
  const item = exact(projectionValue, PROJECTION_FIELDS, 'methodProjection', error)
  if (item.schema !== 'qingmu.imago-lsu-plan-method.v1') throw error('methodProjection schema mismatch')
  const boundSubject = subject(item.subject, coordinates, error)
  const subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'subjectSnapshotSha256', error)
  if (digest(boundSubject, helpers, 'lsuPlanSubject', error) !== subjectSnapshotSha256
    || (expectedSubjectSha256 !== undefined && subjectSnapshotSha256 !== expectedSubjectSha256)) {
    throw error('methodProjection subject SHA mismatch')
  }
  const boundDefinition = definition(item.definition, error)
  const rules = ruleBindings(item.ruleBindings, 'ruleBindings', helpers, error)
  const rulesSha256 = sha(item.rulesSha256, 'rulesSha256', error)
  const lockRules = ruleBindings(item.lockRuleBindings, 'lockRuleBindings', helpers, error)
  const lockRulesSha256 = sha(item.lockRulesSha256, 'lockRulesSha256', error)
  if (digest(rules, helpers, 'ruleBindings', error) !== rulesSha256
    || digest(lockRules, helpers, 'lockRuleBindings', error) !== lockRulesSha256
    || Object.entries(lockRules).some(([path, value]) => rules[path] !== value)) {
    throw error('methodProjection rule binding mismatch')
  }
  const projection: YimengImagoLsuPlanMethodProjection = {
    schema: 'qingmu.imago-lsu-plan-method.v1', subject: boundSubject, subjectSnapshotSha256,
    definition: boundDefinition, ruleBindings: rules, rulesSha256, lockRuleBindings: lockRules, lockRulesSha256,
  }
  const projectionSha256 = sha(projectionShaValue, 'methodProjectionSha256', error)
  if (digest(projection, helpers, 'methodProjection', error) !== projectionSha256) {
    throw error('methodProjection SHA mismatch')
  }
  const unsigned = {
    schema: 'qingmu.imago-lsu-plan-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  const proof = exact(attestationValue, [...Object.keys(unsigned), 'signature'], 'methodAttestation', error)
  if (Object.entries(unsigned).some(([key, expected]) => proof[key] !== expected)) {
    throw error('methodAttestation binding mismatch')
  }
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expected = createHmac('sha256', helpers.readAttestationKey())
    .update(helpers.canonicalJson(unsigned, 'lsuPlanAttestation'), 'utf8').digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw error('methodAttestation signature mismatch')
  return { projection, projectionSha256, attestation: { ...unsigned, signature } }
}

function currentMethod(
  value: unknown,
  coordinates: YimengProbeLsuPlanAuthorityRequest,
  helpers: Helpers,
  expectedSubjectSha256?: string,
): VerifiedMethod {
  const root = exact(value, METHOD_RESPONSE_FIELDS, 'currentLsuPlanMethod', helpers.responseError)
  if (root.schema !== 'qingmu.imago-lsu-plan-method-adapter-result.v1') {
    throw helpers.responseError('current LSU plan Method schema mismatch')
  }
  return verifyMethod(
    root.projection, root.projectionSha256, root.methodAttestation, coordinates,
    helpers, helpers.responseError, expectedSubjectSha256,
  )
}

function sealIntent(value: unknown, helpers: Helpers): YimengSealLsuPlanRequest {
  const item = exact(value, SEAL_FIELDS, 'payload', helpers.inputError)
  const expectedPlanRevision = integer(item.expectedPlanRevision, 'expectedPlanRevision', helpers.inputError)
  if (expectedPlanRevision === Number.MAX_SAFE_INTEGER) {
    throw helpers.inputError('expectedPlanRevision must permit a safe next revision')
  }
  let expectedPlanSha256: string | null
  if (expectedPlanRevision === 0) {
    if (item.expectedPlanSha256 !== null) throw helpers.inputError('initial plan requires null previous SHA')
    expectedPlanSha256 = null
  } else {
    expectedPlanSha256 = sha(item.expectedPlanSha256, 'expectedPlanSha256', helpers.inputError)
  }
  return {
    projectId: id(item.projectId, 'projectId', helpers.inputError),
    episodeId: id(item.episodeId, 'episodeId', helpers.inputError),
    expectedSubjectSha256: sha(item.expectedSubjectSha256, 'expectedSubjectSha256', helpers.inputError),
    expectedPlanRevision,
    expectedPlanSha256,
    idempotencyKey: idempotencyKey(item.idempotencyKey, helpers.inputError),
  }
}

function probeIntent(value: unknown, helpers: Helpers): YimengProbeLsuPlanAuthorityRequest {
  const item = exact(value, PROBE_FIELDS, 'payload', helpers.inputError)
  return {
    projectId: id(item.projectId, 'projectId', helpers.inputError),
    episodeId: id(item.episodeId, 'episodeId', helpers.inputError),
  }
}

function forwardedSeal(value: unknown, methodValue: unknown, helpers: Helpers): YimengForwardedSealLsuPlanRequest {
  const request = sealIntent(value, helpers)
  const method = currentMethod(methodValue, request, helpers, request.expectedSubjectSha256)
  return {
    ...request, methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
    methodAttestation: method.attestation,
  }
}

function forwardedProbe(value: unknown, methodValue: unknown, helpers: Helpers): YimengForwardedLsuPlanAuthorityProbeRequest {
  const request = probeIntent(value, helpers)
  const method = currentMethod(methodValue, request, helpers)
  return {
    ...request, methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
    methodAttestation: method.attestation,
  }
}

interface SealConstraints {
  readonly coordinates: YimengProbeLsuPlanAuthorityRequest
  readonly expectedSubjectSha256?: string
  readonly expectedRevision?: number
  readonly method?: VerifiedMethod
  readonly token?: string
}

function sealResult(value: unknown, constraints: SealConstraints, helpers: Helpers): YimengLsuPlanSealResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'lsuPlanResult', error)
  if (root.schema !== 'jason.qingmu-lsu-plan-seal-result.v1' || root.planSealed !== true
    || root.stageApprovalGranted !== false || root.lockActivated !== false || root.providerCalls !== 0
    || root.humanSignoffInferred !== false || root.reworkExecuted !== false) {
    throw error('LSU plan result authority mismatch')
  }
  const item = exact(root.seal, RECORD_FIELDS, 'lsuPlanResult.seal', error)
  const boundSubject = subject(item.subject, constraints.coordinates, error)
  const subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'seal.subjectSnapshotSha256', error)
  if (digest(boundSubject, helpers, 'lsuPlanSubject', error) !== subjectSnapshotSha256
    || (constraints.expectedSubjectSha256 !== undefined
      && subjectSnapshotSha256 !== constraints.expectedSubjectSha256)) throw error('LSU plan seal subject mismatch')
  const revision = integer(item.revision, 'seal.revision', error, 1)
  if (constraints.expectedRevision !== undefined && revision !== constraints.expectedRevision) {
    throw error('LSU plan seal revision mismatch')
  }
  const boundDefinition = definition(item.definition, error)
  const methodProjectionSha256 = sha(item.methodProjectionSha256, 'seal.methodProjectionSha256', error)
  const rulesSha256 = sha(item.rulesSha256, 'seal.rulesSha256', error)
  const lockRulesSha256 = sha(item.lockRulesSha256, 'seal.lockRulesSha256', error)
  if (constraints.method !== undefined && (
    methodProjectionSha256 !== constraints.method.projectionSha256
    || rulesSha256 !== constraints.method.projection.rulesSha256
    || lockRulesSha256 !== constraints.method.projection.lockRulesSha256
    || !isDeepStrictEqual(boundSubject, constraints.method.projection.subject)
    || !isDeepStrictEqual(boundDefinition, constraints.method.projection.definition)
  )) throw error('LSU plan seal differs from submitted current Method')
  const authSessionId = sha(item.authSessionId, 'seal.authSessionId', error)
  if (constraints.token !== undefined
    && authSessionId !== createHash('sha256').update(constraints.token, 'utf8').digest('hex')) {
    throw error('LSU plan seal authenticated session mismatch')
  }
  const seal: YimengLsuPlanSeal = {
    projectId: constraints.coordinates.projectId,
    episodeId: constraints.coordinates.episodeId,
    revision,
    subject: boundSubject,
    subjectSnapshotSha256,
    definition: boundDefinition,
    methodProjectionSha256,
    rulesSha256,
    lockRulesSha256,
    actorId: id(item.actorId, 'seal.actorId', error),
    actorNaturalPersonId: id(item.actorNaturalPersonId, 'seal.actorNaturalPersonId', error),
    authSessionId,
    eventId: id(item.eventId, 'seal.eventId', error),
    changeSetId: id(item.changeSetId, 'seal.changeSetId', error),
    sealedAt: helpers.requireTimestamp(id(item.sealedAt, 'seal.sealedAt', error), 'seal.sealedAt'),
  }
  const sealSha256 = sha(root.sealSha256, 'sealSha256', error)
  if (digest(seal, helpers, 'lsuPlanSeal', error) !== sealSha256) throw error('LSU plan seal SHA mismatch')
  return {
    schema: 'jason.qingmu-lsu-plan-seal-result.v1', seal, sealSha256,
    receiptId: id(root.receiptId, 'receiptId', error),
    outboxEventId: id(root.outboxEventId, 'outboxEventId', error),
    planSealed: true, stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
    humanSignoffInferred: false, reworkExecuted: false,
  }
}

function recoveryResult(value: unknown, request: YimengSealLsuPlanRequest, helpers: Helpers): YimengLsuPlanSealRecovery {
  const error = helpers.responseError
  const root = exact(value, RECOVERY_FIELDS, 'lsuPlanRecovery', error)
  if (root.schema !== 'jason.qingmu-lsu-plan-seal-recovery.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.expectedSubjectSha256 !== request.expectedSubjectSha256
    || root.expectedPlanRevision !== request.expectedPlanRevision || root.expectedPlanSha256 !== request.expectedPlanSha256
    || root.idempotencyKey !== request.idempotencyKey || typeof root.found !== 'boolean'
    || (root.found ? root.result === null : root.result !== null)) throw error('LSU plan recovery coordinates mismatch')
  return {
    schema: 'jason.qingmu-lsu-plan-seal-recovery.v1', projectId: request.projectId, episodeId: request.episodeId,
    expectedSubjectSha256: request.expectedSubjectSha256, expectedPlanRevision: request.expectedPlanRevision,
    expectedPlanSha256: request.expectedPlanSha256, idempotencyKey: request.idempotencyKey, found: root.found,
    result: root.result === null ? null : sealResult(root.result, {
      coordinates: request, expectedSubjectSha256: request.expectedSubjectSha256,
      expectedRevision: request.expectedPlanRevision + 1,
    }, helpers),
  }
}

function authorityResult(
  value: unknown, request: YimengForwardedLsuPlanAuthorityProbeRequest, helpers: Helpers,
): YimengLsuPlanAuthorityProbe {
  const error = helpers.responseError
  const root = exact(value, AUTHORITY_FIELDS, 'lsuPlanAuthorityProbe', error)
  if (root.schema !== 'jason.qingmu-lsu-plan-authority-probe.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.subjectSnapshotSha256 !== request.methodProjection.subjectSnapshotSha256
    || root.methodProjectionSha256 !== request.methodProjectionSha256
    || root.rulesSha256 !== request.methodProjection.rulesSha256
    || root.lockRulesSha256 !== request.methodProjection.lockRulesSha256
    || typeof root.currentPlanSealed !== 'boolean' || root.planSealed !== root.currentPlanSealed
    || root.stageApprovalGranted !== false || root.lockActivated !== false || root.providerCalls !== 0
    || root.humanSignoffInferred !== false || root.reworkExecuted !== false) {
    throw error('LSU plan authority probe binding mismatch')
  }
  const latestSeal = root.latestSeal === null ? null : sealResult(root.latestSeal, { coordinates: request }, helpers)
  if (root.currentPlanSealed && (latestSeal === null
    || latestSeal.seal.subjectSnapshotSha256 !== request.methodProjection.subjectSnapshotSha256
    || latestSeal.seal.methodProjectionSha256 !== request.methodProjectionSha256
    || latestSeal.seal.rulesSha256 !== request.methodProjection.rulesSha256
    || latestSeal.seal.lockRulesSha256 !== request.methodProjection.lockRulesSha256
    || !isDeepStrictEqual(latestSeal.seal.subject, request.methodProjection.subject)
    || !isDeepStrictEqual(latestSeal.seal.definition, request.methodProjection.definition))) {
    throw error('LSU plan current seal claim mismatch')
  }
  return {
    schema: 'jason.qingmu-lsu-plan-authority-probe.v1', projectId: request.projectId, episodeId: request.episodeId,
    subjectSnapshotSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256,
    lockRulesSha256: request.methodProjection.lockRulesSha256,
    latestSeal, currentPlanSealed: root.currentPlanSealed, planSealed: root.currentPlanSealed,
    stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
    humanSignoffInferred: false, reworkExecuted: false,
  }
}

/**
 * Derive the only exact Host Method request accepted for a seal or authority probe.
 * @param endpoint - Command endpoint selected by the caller.
 * @param payload - Untrusted command payload to validate.
 * @param helpers - Canonicalization and digest helpers for command preparation.
 * @returns Canonical method request for the current backend state.
 */
export function prepareCurrentLsuPlanMethodRequest(
  endpoint: 'sealLsuPlan' | 'probeLsuPlanAuthority', payload: unknown, helpers: Helpers,
): YimengCommandJsonObject {
  const request = endpoint === 'sealLsuPlan' ? sealIntent(payload, helpers) : probeIntent(payload, helpers)
  return { projectId: request.projectId, episodeId: request.episodeId }
}

/**
 * Prepare one non-retried POST or one original-coordinate GET receipt lookup.
 * @param endpoint - Command endpoint selected by the caller.
 * @param payload - Untrusted command payload to validate.
 * @param helpers - Canonicalization and digest helpers for command preparation.
 * @param currentMethodValue - Fresh method result used for command preparation.
 * @returns Prepared command and recovery metadata.
 */
export function prepareLsuPlanCommand(
  endpoint: 'sealLsuPlan' | 'recoverLsuPlanSeal' | 'probeLsuPlanAuthority',
  payload: unknown,
  helpers: Helpers,
  currentMethodValue?: unknown,
): PreparedCommand {
  if (endpoint === 'sealLsuPlan') {
    if (currentMethodValue === undefined) throw helpers.responseError('current LSU plan Method is unavailable')
    const request = forwardedSeal(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/lsu-plan/seals`,
      request: {
        method: 'POST',
        body: {
          expectedSubjectSha256: request.expectedSubjectSha256,
          expectedPlanRevision: request.expectedPlanRevision,
          expectedPlanSha256: request.expectedPlanSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          idempotencyKey: request.idempotencyKey,
        },
      },
      normalize: (value, token) => sealResult(value, {
        coordinates: request,
        expectedSubjectSha256: request.expectedSubjectSha256,
        expectedRevision: request.expectedPlanRevision + 1,
        method: {
          projection: request.methodProjection,
          projectionSha256: request.methodProjectionSha256,
          attestation: request.methodAttestation,
        },
        token,
      }, helpers),
    }
  }
  if (endpoint === 'probeLsuPlanAuthority') {
    if (currentMethodValue === undefined) throw helpers.responseError('current LSU plan Method is unavailable')
    const request = forwardedProbe(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/lsu-plan/authority-probe`,
      request: {
        method: 'POST',
        body: {
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
        },
      },
      normalize: value => authorityResult(value, request, helpers),
    }
  }
  const request = sealIntent(payload, helpers)
  const query = new URLSearchParams({
    expectedSubjectSha256: request.expectedSubjectSha256,
    expectedPlanRevision: String(request.expectedPlanRevision),
    ...(request.expectedPlanSha256 === null ? {} : { expectedPlanSha256: request.expectedPlanSha256 }),
  })
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/lsu-plan/seal-command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: value => recoveryResult(value, request, helpers),
  }
}
