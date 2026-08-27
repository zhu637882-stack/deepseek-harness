/** Register one Core-validated Stage artifact or recover its original durable receipt. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  YimengCommandJsonObject,
  YimengCommitStageArtifactDecisionRequest,
  YimengForwardedStageArtifactAuthorityProbeRequest,
  YimengForwardedStageArtifactDecisionRequest,
  YimengImagoStageArtifactMethodAttestation,
  YimengImagoStageArtifactMethodProjection,
  YimengProbeStageArtifactAuthorityRequest,
  YimengRecoverStageArtifactDecisionRequest,
  YimengRecoverStageArtifactRegistrationRequest,
  YimengRegisterStageArtifactRequest,
  YimengStageArtifact,
  YimengStageArtifactAuthorityProbe,
  YimengStageArtifactDecision,
  YimengStageArtifactDecisionRecovery,
  YimengStageArtifactDecisionResult,
  YimengStageArtifactDefinition,
  YimengStageArtifactMachineValidation,
  YimengStageArtifactProducedLock,
  YimengStageArtifactRecord,
  YimengStageArtifactRecovery,
  YimengStageArtifactResult,
  YimengStageArtifactSubject,
  YimengStageDependencyAuthority,
  YimengStageDependencyAuthorityLock,
  YimengStageDependencyAuthoritySource,
} from './types.ts'

const COORDINATE_FIELDS = [
  'projectId', 'episodeId', 'stageId', 'scopeInstance', 'expectedSubjectSha256', 'idempotencyKey',
] as const
const DECISION_RECOVERY_FIELDS = [
  'projectId', 'episodeId', 'stageId', 'scopeInstance', 'expectedArtifactRecordRevision',
  'expectedArtifactRecordSha256', 'idempotencyKey',
] as const
const DECISION_REQUEST_FIELDS = [
  ...DECISION_RECOVERY_FIELDS, 'expectedArtifactRevision', 'expectedArtifactSha256', 'expectedSubjectSha256',
  'artifact', 'decision', 'reason',
] as const
const AUTHORITY_PROBE_REQUEST_FIELDS = [
  'projectId', 'episodeId', 'stageId', 'scopeInstance', 'expectedArtifactRecordRevision',
  'expectedArtifactRecordSha256', 'expectedArtifactRevision', 'expectedArtifactSha256',
  'expectedSubjectSha256', 'artifact',
] as const
const METHOD_RESPONSE_FIELDS = ['schema', 'projection', 'projectionSha256', 'methodAttestation'] as const
const ARTIFACT_FIELDS = [
  'schema_version', 'workflow_version', 'stage_id', 'scope_instance', 'artifact_revision', 'created_at',
  'producer', 'source_bindings', 'lock_bindings', 'content', 'open_issues',
] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'stageId', 'scopeInstance', 'artifactRevision', 'artifactSha256',
] as const
const METHOD_FIELDS = [
  'schema', 'subject', 'subjectSnapshotSha256', 'machineValidation', 'definition', 'ruleBindings', 'rulesSha256',
] as const
const VALIDATION_FIELDS = ['status', 'validator', 'validatedArtifactSha256', 'contractSha256'] as const
const DEFINITION_FIELDS = [
  'id', 'version', 'stageId', 'roleId', 'scope', 'contractSha256', 'artifactKind', 'canonicalOutput',
  'requiredSourceStageIds', 'requiredLockIds', 'producesLockId', 'operation', 'stageArtifactRegistrationAllowed',
  'dependencyAuthorityRequiredForApproval', 'dependencyAuthorityVerified', 'stageApprovalAllowed',
  'lockActivationAllowed', 'lsuPlanSealingAllowed', 'reworkExecutionAllowed', 'providerCalls',
] as const
const RECORD_FIELDS = [
  'schema', 'changeSetId', 'projectId', 'episodeId', 'stageId', 'scopeInstance', 'artifact', 'artifactRevision',
  'artifactSha256', 'subjectSnapshotSha256', 'definition', 'machineValidation', 'methodProjectionSha256',
  'rulesSha256', 'artifactRecordRevision', 'producerActorId', 'producerNaturalPersonId', 'authSessionId', 'createdAt',
  'stageArtifactRegistered', 'stageArtifactAvailable', 'dependencyAuthorityVerified', 'stageApprovalGranted',
  'lockActivated', 'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted',
] as const
const DECISION_RESULT_FIELDS = [
  'schema', 'decision', 'decisionEventSha256', 'producedLock', 'receiptId', 'outboxEventId',
] as const
const DECISION_FIELDS = [
  'id', 'decisionOrdinal', 'subjectType', 'subjectId', 'subjectArtifactRecordRevision', 'subjectArtifactRecordSha256',
  'artifactRevision', 'artifactSha256', 'subjectSnapshotSha256', 'methodProjectionSha256', 'rulesSha256',
  'decision', 'reason', 'actorId', 'actorRole', 'actorNaturalPersonId', 'producerActorId',
  'producerNaturalPersonId', 'authSessionId', 'dependencyAuthority', 'stageArtifactAvailable',
  'dependencyAuthorityVerified', 'stageApprovalGranted', 'lockActivated', 'planSealed', 'providerCalls',
  'humanSignoffInferred', 'reworkExecuted', 'decidedAt',
] as const
const AUTHORITY_PROBE_FIELDS = [
  'schema', 'projectId', 'episodeId', 'stageId', 'scopeInstance', 'artifactRecordRevision',
  'artifactRecordSha256', 'rulesSha256', 'dependencyAuthority', 'currentDecisionResult',
  'dependencyAuthorityVerified', 'stageArtifactAvailable', 'stageApprovalGranted', 'lockActivated',
  'planSealed', 'providerCalls', 'reworkExecuted',
] as const
const AUTHORITY_FIELDS = [
  'schema', 'targetId', 'artifactRecordRevision', 'artifactRecordSha256', 'sources', 'locks', 'blockers', 'verified',
] as const
const AUTHORITY_SOURCE_FIELDS = [
  'stageId', 'scopeInstance', 'artifactRevision', 'artifactSha256', 'artifactRecordRevision',
  'artifactRecordSha256', 'decisionId', 'approvalEventSha256',
] as const
const AUTHORITY_LOCK_FIELDS = [
  'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256',
  'decisionId', 'eventSha256',
] as const
const PRODUCED_LOCK_FIELDS = [
  'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'eventSha256',
] as const
const FLAGS = {
  stageArtifactRegistered: true,
  stageArtifactAvailable: false,
  dependencyAuthorityVerified: false,
  stageApprovalGranted: false,
  lockActivated: false,
  planSealed: false,
  providerCalls: 0,
  humanSignoffInferred: false,
  reworkExecuted: false,
} as const
const ATTESTATION_SCHEMA = 'qingmu.imago-stage-artifact-method-attestation.v1'

function canonicalNumber(value: number, field: string): string {
  if (!Number.isFinite(value)) throw new Error(`${field} must contain only finite numbers`)
  if (Object.is(value, -0)) return '-0.0'
  if (value === 0) return '0'
  const negative = value < 0
  const source = Math.abs(value).toString()
  const [coefficient = '', exponentText] = source.split('e')
  let exponent: number
  let digits: string
  if (exponentText !== undefined) {
    exponent = Number(exponentText)
    digits = coefficient.replace('.', '')
  } else {
    const point = coefficient.indexOf('.')
    if (point === -1) {
      exponent = coefficient.length - 1
      digits = coefficient
    } else if (coefficient[0] !== '0') {
      exponent = point - 1
      digits = coefficient.replace('.', '')
    } else {
      const fraction = coefficient.slice(2)
      const first = fraction.search(/[1-9]/u)
      exponent = -(first + 1)
      digits = fraction.slice(first)
    }
  }
  digits = digits.replace(/^0+/u, '').replace(/0+$/u, '')
  const sign = negative ? '-' : ''
  if (Number.isInteger(value) && exponentText === undefined) {
    return `${sign}${digits}${'0'.repeat(exponent + 1 - digits.length)}`
  }
  if (exponent < -4 || exponent >= 16) {
    const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`
    return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
  return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`
}

/**
 * Serialize Stage JSON to a Python json.dumps fixed point for Core/Yimeng SHA verification.
 *
 * @param value Stage artifact command or receipt value.
 * @param field Diagnostic field name.
 * @param depth Current recursion depth.
 * @returns Canonical JSON bytes shared by Host, Core, and Yimeng.
 */
export function stageArtifactCanonicalJson(value: unknown, field: string, depth = 0): string {
  if (depth > 100) throw new Error(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error(`${field} must contain valid Unicode`)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return canonicalNumber(value, field)
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => stageArtifactCanonicalJson(item, `${field}[${String(index)}]`, depth + 1)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort((left, right) => {
      const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
      const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
      const length = Math.min(leftPoints.length, rightPoints.length)
      for (let index = 0; index < length; index += 1) {
        const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
        if (difference !== 0) return difference
      }
      return leftPoints.length - rightPoints.length
    })
    return `{${keys.map(key => `${JSON.stringify(key)}:${stageArtifactCanonicalJson(record[key], `${field}.${key}`, depth + 1)}`).join(',')}}`
  }
  throw new Error(`${field} must be canonical JSON`)
}

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
  YimengStageArtifactResult | YimengStageArtifactRecovery |
  YimengStageArtifactDecisionResult | YimengStageArtifactDecisionRecovery |
  YimengStageArtifactAuthorityProbe
}

interface StageArtifactSubjectBinding {
  readonly artifactRevision: string
  readonly artifactSha256: string
  readonly producerRole?: string
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw error(`${field} must be an object`)
  return value as YimengCommandJsonObject
}

function exact(value: unknown, keys: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key))) {
    throw error(`${field} has invalid fields`)
  }
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, maximum: number, field: string, error: ErrorFactory, identifier = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || Array.from(value).length > maximum || value.includes('\u0000')) {
    throw error(`${field} must be bounded Unicode text`)
  }
  const stripped = pythonStrip(value)
  if (stripped === '' || (identifier && (stripped !== value || /[\r\n]/u.test(value)))) {
    throw error(`${field} must be non-empty trimmed text`)
  }
  return value
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  return text(value, 256, field, error, true)
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw error(`${field} must be sha256`)
  return value
}

function integer(value: unknown, minimum: number, field: string, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  }
  return value
}

function idempotencyKey(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200 || !/^[\x21-\x7e]+$/u.test(value)) {
    throw error('idempotencyKey must be 8..200 visible ASCII characters')
  }
  return value
}

function canonical(value: unknown, _helpers: Helpers, error: ErrorFactory, field = 'stageArtifact'): string {
  try { return stageArtifactCanonicalJson(value, field) }
  catch { throw error(`${field} must be canonical JSON`) }
}

function digest(value: unknown, helpers: Helpers, error: ErrorFactory, field = 'stageArtifact'): string {
  return createHash('sha256').update(canonical(value, helpers, error, field), 'utf8').digest('hex')
}

function stringList(value: unknown, field: string, error: ErrorFactory): string[] {
  if (!Array.isArray(value)) throw error(`${field} must be an array`)
  const items = value.map(item => id(item, field, error))
  if (new Set(items).size !== items.length) throw error(`${field} must contain unique IDs`)
  return items
}

function coordinates(
  value: YimengCommandJsonObject, error: ErrorFactory,
): YimengRecoverStageArtifactRegistrationRequest {
  return {
    projectId: id(value.projectId, 'projectId', error),
    episodeId: id(value.episodeId, 'episodeId', error),
    stageId: id(value.stageId, 'stageId', error),
    scopeInstance: id(value.scopeInstance, 'scopeInstance', error),
    expectedSubjectSha256: sha(value.expectedSubjectSha256, 'expectedSubjectSha256', error),
    idempotencyKey: idempotencyKey(value.idempotencyKey, error),
  }
}

function artifact(value: unknown, request: Pick<YimengRecoverStageArtifactRegistrationRequest,
  'stageId' | 'scopeInstance'>, helpers: Helpers, error: ErrorFactory): YimengStageArtifact {
  const item = object(value, 'artifact', error)
  if (ARTIFACT_FIELDS.some(field => !Object.hasOwn(item, field))
    || item.schema_version !== '6.0.0-draft.1' || item.workflow_version !== '6.0.0-draft.2'
    || item.stage_id !== request.stageId || item.scope_instance !== request.scopeInstance
    || id(item.artifact_revision, 'artifact.artifact_revision', error) === ''
    || text(item.created_at, 128, 'artifact.created_at', error) === ''
    || !Array.isArray(item.source_bindings) || !Array.isArray(item.lock_bindings) || !Array.isArray(item.open_issues)) {
    throw error('artifact envelope mismatch')
  }
  object(item.producer, 'artifact.producer', error)
  object(item.content, 'artifact.content', error)
  return JSON.parse(canonical(item, helpers, error, 'artifact')) as YimengStageArtifact
}

function subject(
  value: unknown, request: YimengRecoverStageArtifactRegistrationRequest,
  binding: StageArtifactSubjectBinding, helpers: Helpers, error: ErrorFactory,
): YimengStageArtifactSubject {
  const item = exact(value, SUBJECT_FIELDS, 'methodProjection.subject', error)
  const result: YimengStageArtifactSubject = {
    schema: 'jason.qingmu-imago-stage-artifact.v1',
    projectId: id(item.projectId, 'subject.projectId', error),
    episodeId: id(item.episodeId, 'subject.episodeId', error),
    stageId: id(item.stageId, 'subject.stageId', error),
    scopeInstance: id(item.scopeInstance, 'subject.scopeInstance', error),
    artifactRevision: id(item.artifactRevision, 'subject.artifactRevision', error),
    artifactSha256: sha(item.artifactSha256, 'subject.artifactSha256', error),
  }
  if (item.schema !== result.schema || result.projectId !== request.projectId || result.episodeId !== request.episodeId
    || result.stageId !== request.stageId || result.scopeInstance !== request.scopeInstance
    || result.artifactRevision !== binding.artifactRevision
    || result.artifactSha256 !== binding.artifactSha256
    || digest(result, helpers, error, 'stageArtifactSubject') !== request.expectedSubjectSha256) {
    throw error('methodProjection subject binding mismatch')
  }
  return result
}

function definition(value: unknown, request: Pick<YimengRecoverStageArtifactRegistrationRequest,
  'stageId' | 'scopeInstance'>, error: ErrorFactory): YimengStageArtifactDefinition {
  const item = exact(value, DEFINITION_FIELDS, 'methodProjection.definition', error)
  if (item.id !== 'IMAGO-V6-STAGE-ARTIFACT' || item.operation !== 'register_machine_validated_stage_artifact'
    || item.stageArtifactRegistrationAllowed !== true || item.dependencyAuthorityRequiredForApproval !== true
    || item.dependencyAuthorityVerified !== false || item.stageApprovalAllowed !== false
    || item.lockActivationAllowed !== false || item.lsuPlanSealingAllowed !== false
    || item.reworkExecutionAllowed !== false || item.providerCalls !== 0) throw error('Stage artifact definition authority mismatch')
  const scope = item.scope
  if ((scope !== 'global' && scope !== 'per_lsu') || item.stageId !== request.stageId
    || (scope === 'global' && request.scopeInstance !== 'GLOBAL')
    || (scope === 'per_lsu' && !/^LSU[0-9]{2,}$/u.test(request.scopeInstance))) {
    throw error('Stage artifact definition scope mismatch')
  }
  const producesLockId = item.producesLockId === null ? null : id(item.producesLockId, 'producesLockId', error)
  return {
    id: 'IMAGO-V6-STAGE-ARTIFACT',
    version: id(item.version, 'definition.version', error),
    stageId: request.stageId,
    roleId: id(item.roleId, 'definition.roleId', error),
    scope,
    contractSha256: sha(item.contractSha256, 'definition.contractSha256', error),
    artifactKind: text(item.artifactKind, 1024, 'definition.artifactKind', error),
    canonicalOutput: text(item.canonicalOutput, 1024, 'definition.canonicalOutput', error),
    requiredSourceStageIds: stringList(item.requiredSourceStageIds, 'requiredSourceStageIds', error),
    requiredLockIds: stringList(item.requiredLockIds, 'requiredLockIds', error),
    producesLockId,
    operation: 'register_machine_validated_stage_artifact',
    stageArtifactRegistrationAllowed: true,
    dependencyAuthorityRequiredForApproval: true,
    dependencyAuthorityVerified: false,
    stageApprovalAllowed: false,
    lockActivationAllowed: false,
    lsuPlanSealingAllowed: false,
    reworkExecutionAllowed: false,
    providerCalls: 0,
  }
}

function validation(
  value: unknown, artifactSha256: string, contractSha256: string, error: ErrorFactory,
): YimengStageArtifactMachineValidation {
  const item = exact(value, VALIDATION_FIELDS, 'methodProjection.machineValidation', error)
  if (item.status !== 'PASS' || item.validator !== 'scripts/validate_v6_stage_contracts.py'
    || item.validatedArtifactSha256 !== artifactSha256 || item.contractSha256 !== contractSha256) {
    throw error('Stage artifact machine validation mismatch')
  }
  return {
    status: 'PASS', validator: 'scripts/validate_v6_stage_contracts.py',
    validatedArtifactSha256: artifactSha256, contractSha256,
  }
}

function safeRuleBindings(value: unknown, helpers: Helpers, error: ErrorFactory): Readonly<Record<string, string>> {
  const item = object(value, 'methodProjection.ruleBindings', error)
  if (Object.keys(item).length === 0) throw error('ruleBindings must be a non-empty object')
  const result = Object.fromEntries(Object.entries(item).map(([path, value]) => {
    text(path, 1024, 'ruleBindings path', error, true)
    if (path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw error('ruleBindings path must be safe and relative')
    }
    return [path, sha(value, 'ruleBindings SHA', error)]
  }))
  canonical(result, helpers, error, 'ruleBindings')
  return result
}

function method(
  value: unknown,
  methodShaValue: unknown,
  attestationValue: unknown,
  request: YimengRecoverStageArtifactRegistrationRequest,
  binding: StageArtifactSubjectBinding,
  helpers: Helpers,
  workflowVersion?: string,
  error: ErrorFactory = helpers.inputError,
): {
  projection: YimengImagoStageArtifactMethodProjection
  projectionSha256: string
  attestation: YimengImagoStageArtifactMethodAttestation
} {
  const item = exact(value, METHOD_FIELDS, 'methodProjection', error)
  if (item.schema !== 'qingmu.imago-stage-artifact-method.v1') throw error('methodProjection schema mismatch')
  const boundSubject = subject(item.subject, request, binding, helpers, error)
  if (item.subjectSnapshotSha256 !== request.expectedSubjectSha256) throw error('methodProjection subject SHA mismatch')
  const boundDefinition = definition(item.definition, request, error)
  if (workflowVersion !== undefined && boundDefinition.version !== workflowVersion) {
    throw error('Stage artifact definition version differs from the artifact workflow version')
  }
  if (binding.producerRole !== undefined && binding.producerRole !== boundDefinition.roleId) {
    throw error('artifact producer role differs from current Stage owner')
  }
  const machineValidation = validation(
    item.machineValidation, boundSubject.artifactSha256, boundDefinition.contractSha256, error,
  )
  const ruleBindings = safeRuleBindings(item.ruleBindings, helpers, error)
  const rulesSha256 = sha(item.rulesSha256, 'methodProjection.rulesSha256', error)
  if (digest(ruleBindings, helpers, error, 'ruleBindings') !== rulesSha256) throw error('rulesSha256 mismatch')
  const projection: YimengImagoStageArtifactMethodProjection = {
    schema: 'qingmu.imago-stage-artifact-method.v1',
    subject: boundSubject,
    subjectSnapshotSha256: request.expectedSubjectSha256,
    machineValidation,
    definition: boundDefinition,
    ruleBindings,
    rulesSha256,
  }
  const projectionSha256 = sha(methodShaValue, 'methodProjectionSha256', error)
  if (digest(projection, helpers, error, 'methodProjection') !== projectionSha256) throw error('methodProjection SHA mismatch')
  const unsigned = {
    schema: ATTESTATION_SCHEMA,
    algorithm: 'hmac-sha256',
    subjectSnapshotSha256: request.expectedSubjectSha256,
    methodProjectionSha256: projectionSha256,
  } as const
  const proof = exact(attestationValue, [...Object.keys(unsigned), 'signature'], 'methodAttestation', error)
  if (Object.entries(unsigned).some(([key, expected]) => proof[key] !== expected)) {
    throw error('methodAttestation binding mismatch')
  }
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey())
    .update(canonical(unsigned, helpers, error, 'stageArtifactAttestation'), 'utf8').digest()
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) throw error('methodAttestation signature mismatch')
  return { projection, projectionSha256, attestation: { ...unsigned, signature } }
}

function registerRequest(value: unknown, helpers: Helpers): YimengRegisterStageArtifactRequest {
  const error = helpers.inputError
  const raw = exact(value, [
    ...COORDINATE_FIELDS, 'artifact', 'expectedArtifactRecordRevision', 'expectedArtifactRecordSha256',
    'methodProjection', 'methodProjectionSha256', 'methodAttestation',
  ], 'payload', error)
  const request = coordinates(raw, error)
  const boundArtifact = artifact(raw.artifact, request, helpers, error)
  const producer = object(boundArtifact.producer, 'artifact.producer', error)
  const revision = integer(raw.expectedArtifactRecordRevision, 0, 'expectedArtifactRecordRevision', error)
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw error('artifact record revision cannot advance safely')
  }
  if (revision === 0 && raw.expectedArtifactRecordSha256 !== null) {
    throw error('initial artifact record requires a null previous SHA')
  }
  const previousSha = revision === 0 ? null : sha(
    raw.expectedArtifactRecordSha256, 'expectedArtifactRecordSha256', error,
  )
  const verified = method(
    raw.methodProjection,
    raw.methodProjectionSha256,
    raw.methodAttestation,
    request,
    {
      artifactRevision: boundArtifact.artifact_revision,
      artifactSha256: digest(boundArtifact, helpers, error, 'artifact'),
      producerRole: id(producer.producer_role, 'artifact.producer.producer_role', error),
    },
    helpers,
    boundArtifact.workflow_version,
  )
  return {
    ...request,
    artifact: boundArtifact,
    expectedArtifactRecordRevision: revision,
    expectedArtifactRecordSha256: previousSha,
    methodProjection: verified.projection,
    methodProjectionSha256: verified.projectionSha256,
    methodAttestation: verified.attestation,
  }
}

function decisionRecoveryCoordinates(
  value: YimengCommandJsonObject,
  error: ErrorFactory,
): YimengRecoverStageArtifactDecisionRequest {
  const revision = integer(
    value.expectedArtifactRecordRevision,
    1,
    'expectedArtifactRecordRevision',
    error,
  )
  return {
    projectId: id(value.projectId, 'projectId', error),
    episodeId: id(value.episodeId, 'episodeId', error),
    stageId: id(value.stageId, 'stageId', error),
    scopeInstance: id(value.scopeInstance, 'scopeInstance', error),
    expectedArtifactRecordRevision: revision,
    expectedArtifactRecordSha256: sha(
      value.expectedArtifactRecordSha256,
      'expectedArtifactRecordSha256',
      error,
    ),
    idempotencyKey: idempotencyKey(value.idempotencyKey, error),
  }
}

function boundIntentArtifact(
  value: unknown,
  request: Pick<YimengRecoverStageArtifactRegistrationRequest, 'stageId' | 'scopeInstance'>,
  expectedArtifactRevision: string,
  expectedArtifactSha256: string,
  helpers: Helpers,
): { artifact: YimengStageArtifact; binding: StageArtifactSubjectBinding } {
  const error = helpers.inputError
  const boundArtifact = artifact(value, request, helpers, error)
  const producer = object(boundArtifact.producer, 'artifact.producer', error)
  const binding = {
    artifactRevision: boundArtifact.artifact_revision,
    artifactSha256: digest(boundArtifact, helpers, error, 'artifact'),
    producerRole: id(producer.producer_role, 'artifact.producer.producer_role', error),
  }
  if (binding.artifactRevision !== expectedArtifactRevision
    || binding.artifactSha256 !== expectedArtifactSha256) {
    throw error('artifact differs from exact Stage record coordinates')
  }
  return { artifact: boundArtifact, binding }
}

function decisionIntent(value: unknown, helpers: Helpers): YimengCommitStageArtifactDecisionRequest {
  const error = helpers.inputError
  const raw = exact(value, DECISION_REQUEST_FIELDS, 'payload', error)
  const request = decisionRecoveryCoordinates(raw, error)
  const artifactRevision = id(raw.expectedArtifactRevision, 'expectedArtifactRevision', error)
  const artifactSha256 = sha(raw.expectedArtifactSha256, 'expectedArtifactSha256', error)
  const expectedSubjectSha256 = sha(raw.expectedSubjectSha256, 'expectedSubjectSha256', error)
  const decision = raw.decision
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_changes') {
    throw error('decision must be approve, reject, or request_changes')
  }
  const reason = text(raw.reason, 8000, 'reason', error)
  const bound = boundIntentArtifact(
    raw.artifact, request, artifactRevision, artifactSha256, helpers,
  )
  return {
    ...request,
    artifact: bound.artifact,
    expectedArtifactRevision: artifactRevision,
    expectedArtifactSha256: artifactSha256,
    expectedSubjectSha256,
    decision,
    reason,
  }
}

function authorityProbeIntent(
  value: unknown,
  helpers: Helpers,
): YimengProbeStageArtifactAuthorityRequest {
  const error = helpers.inputError
  const raw = exact(value, AUTHORITY_PROBE_REQUEST_FIELDS, 'payload', error)
  const projectId = id(raw.projectId, 'projectId', error)
  const episodeId = id(raw.episodeId, 'episodeId', error)
  const stageId = id(raw.stageId, 'stageId', error)
  const scopeInstance = id(raw.scopeInstance, 'scopeInstance', error)
  const expectedArtifactRecordRevision = integer(
    raw.expectedArtifactRecordRevision,
    1,
    'expectedArtifactRecordRevision',
    error,
  )
  const expectedArtifactRecordSha256 = sha(
    raw.expectedArtifactRecordSha256,
    'expectedArtifactRecordSha256',
    error,
  )
  const expectedArtifactRevision = id(
    raw.expectedArtifactRevision,
    'expectedArtifactRevision',
    error,
  )
  const expectedArtifactSha256 = sha(
    raw.expectedArtifactSha256,
    'expectedArtifactSha256',
    error,
  )
  const expectedSubjectSha256 = sha(
    raw.expectedSubjectSha256,
    'expectedSubjectSha256',
    error,
  )
  const bound = boundIntentArtifact(
    raw.artifact,
    { stageId, scopeInstance },
    expectedArtifactRevision,
    expectedArtifactSha256,
    helpers,
  )
  return {
    projectId,
    episodeId,
    stageId,
    scopeInstance,
    artifact: bound.artifact,
    expectedArtifactRecordRevision,
    expectedArtifactRecordSha256,
    expectedArtifactRevision,
    expectedArtifactSha256,
    expectedSubjectSha256,
  }
}

function currentMethod(
  value: unknown,
  request: YimengCommitStageArtifactDecisionRequest | YimengProbeStageArtifactAuthorityRequest,
  helpers: Helpers,
): {
  projection: YimengImagoStageArtifactMethodProjection
  projectionSha256: string
  attestation: YimengImagoStageArtifactMethodAttestation
} {
  const error = helpers.responseError
  const root = exact(value, METHOD_RESPONSE_FIELDS, 'currentStageArtifactMethod', error)
  if (root.schema !== 'qingmu.imago-stage-artifact-method-adapter-result.v1') {
    throw error('current Stage artifact Method schema mismatch')
  }
  const producer = object(request.artifact.producer, 'artifact.producer', helpers.inputError)
  return method(
    root.projection,
    root.projectionSha256,
    root.methodAttestation,
    {
      ...request,
      idempotencyKey: 'idempotencyKey' in request ? request.idempotencyKey : 'authority-probe',
    },
    {
      artifactRevision: request.expectedArtifactRevision,
      artifactSha256: request.expectedArtifactSha256,
      producerRole: id(producer.producer_role, 'artifact.producer.producer_role', helpers.inputError),
    },
    helpers,
    request.artifact.workflow_version,
    error,
  )
}

/**
 * Build the only Stage artifact payload that the trusted Host may send to the current Core Method.
 * @param endpoint Decision or authority endpoint that requires fresh Method execution.
 * @param payload Untrusted command intent without any Method projection or attestation.
 * @param helpers Command adapter validation and canonicalization helpers.
 * @returns Exact business coordinates and artifact for `stageArtifactMethod`.
 */
export function prepareCurrentStageArtifactMethodRequest(
  endpoint: 'commitStageArtifactDecision' | 'probeStageArtifactAuthority',
  payload: unknown,
  helpers: Helpers,
): YimengCommandJsonObject {
  const request = endpoint === 'commitStageArtifactDecision'
    ? decisionIntent(payload, helpers)
    : authorityProbeIntent(payload, helpers)
  return {
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifact: request.artifact,
  }
}

function decisionRequest(
  value: unknown,
  currentMethodValue: unknown,
  helpers: Helpers,
): YimengForwardedStageArtifactDecisionRequest {
  const request = decisionIntent(value, helpers)
  const verified = currentMethod(currentMethodValue, request, helpers)
  const { artifact: _artifact, ...intent } = request
  return {
    ...intent,
    methodProjection: verified.projection,
    methodProjectionSha256: verified.projectionSha256,
    methodAttestation: verified.attestation,
  }
}

function authorityProbeRequest(
  value: unknown,
  currentMethodValue: unknown,
  helpers: Helpers,
): YimengForwardedStageArtifactAuthorityProbeRequest {
  const request = authorityProbeIntent(value, helpers)
  const verified = currentMethod(currentMethodValue, request, helpers)
  const { artifact: _artifact, ...intent } = request
  return {
    ...intent,
    methodProjection: verified.projection,
    methodProjectionSha256: verified.projectionSha256,
    methodAttestation: verified.attestation,
  }
}

function result(
  value: unknown, request: YimengRecoverStageArtifactRegistrationRequest, helpers: Helpers,
): YimengStageArtifactResult {
  const error = helpers.responseError
  const root = exact(value, ['schema', 'artifactRecord', 'artifactRecordSha256', 'receiptId', 'outboxEventId'], 'result', error)
  if (root.schema !== 'jason.qingmu-stage-artifact-result.v1') throw error('result schema mismatch')
  const item = exact(root.artifactRecord, RECORD_FIELDS, 'artifactRecord', error)
  if (Object.entries(FLAGS).some(([key, expected]) => item[key] !== expected)
    || item.schema !== 'jason.qingmu-stage-artifact-record.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || item.stageId !== request.stageId
    || item.scopeInstance !== request.scopeInstance || item.subjectSnapshotSha256 !== request.expectedSubjectSha256) {
    throw error('artifact record coordinates or authority flags mismatch')
  }
  const boundArtifact = artifact(item.artifact, request, helpers, error)
  const artifactSha256 = sha(item.artifactSha256, 'artifactRecord.artifactSha256', error)
  const artifactRevision = id(item.artifactRevision, 'artifactRecord.artifactRevision', error)
  if (artifactSha256 !== digest(boundArtifact, helpers, error, 'artifact')
    || artifactRevision !== boundArtifact.artifact_revision) throw error('artifact record payload mismatch')
  const derivedSubject: YimengStageArtifactSubject = {
    schema: 'jason.qingmu-imago-stage-artifact.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifactRevision,
    artifactSha256,
  }
  if (digest(derivedSubject, helpers, error, 'stageArtifactSubject') !== request.expectedSubjectSha256) {
    throw error('artifact record subject mismatch')
  }
  const boundDefinition = definition(item.definition, request, error)
  if (boundDefinition.version !== boundArtifact.workflow_version) {
    throw error('artifact record definition version differs from the artifact workflow version')
  }
  const machineValidation = validation(item.machineValidation, artifactSha256, boundDefinition.contractSha256, error)
  const producer = object(boundArtifact.producer, 'artifact.producer', error)
  const producerNaturalPersonId = id(
    item.producerNaturalPersonId, 'artifactRecord.producerNaturalPersonId', error,
  )
  if (producer.producer_role !== boundDefinition.roleId || producer.producer_id !== producerNaturalPersonId) {
    throw error('artifact record producer role or identity differs from the signed artifact')
  }
  const record: YimengStageArtifactRecord = {
    schema: 'jason.qingmu-stage-artifact-record.v1',
    changeSetId: id(item.changeSetId, 'artifactRecord.changeSetId', error),
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifact: boundArtifact,
    artifactRevision,
    artifactSha256,
    subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: boundDefinition,
    machineValidation,
    methodProjectionSha256: sha(item.methodProjectionSha256, 'artifactRecord.methodProjectionSha256', error),
    rulesSha256: sha(item.rulesSha256, 'artifactRecord.rulesSha256', error),
    artifactRecordRevision: integer(item.artifactRecordRevision, 1, 'artifactRecord.artifactRecordRevision', error),
    producerActorId: id(item.producerActorId, 'artifactRecord.producerActorId', error),
    producerNaturalPersonId,
    authSessionId: sha(item.authSessionId, 'artifactRecord.authSessionId', error),
    createdAt: helpers.requireTimestamp(text(item.createdAt, 128, 'artifactRecord.createdAt', error), 'artifactRecord.createdAt'),
    ...FLAGS,
  }
  const artifactRecordSha256 = sha(root.artifactRecordSha256, 'artifactRecordSha256', error)
  if (digest(record, helpers, error, 'artifactRecord') !== artifactRecordSha256) throw error('artifactRecordSha256 mismatch')
  return {
    schema: 'jason.qingmu-stage-artifact-result.v1',
    artifactRecord: record,
    artifactRecordSha256,
    receiptId: id(root.receiptId, 'receiptId', error),
    outboxEventId: id(root.outboxEventId, 'outboxEventId', error),
  }
}

function dependencyAuthority(
  value: unknown,
  request: YimengRecoverStageArtifactDecisionRequest,
  helpers: Helpers,
): YimengStageDependencyAuthority {
  const error = helpers.responseError
  const item = exact(value, AUTHORITY_FIELDS, 'dependencyAuthority', error)
  if (item.schema !== 'jason.qingmu-stage-dependency-authority.v1') {
    throw error('dependency authority schema mismatch')
  }
  if (!Array.isArray(item.sources) || !Array.isArray(item.locks) || !Array.isArray(item.blockers)) {
    throw error('dependency authority lists mismatch')
  }
  const expectedTargetId = digest({
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
  }, helpers, error, 'stageArtifactTarget')
  const targetId = sha(item.targetId, 'dependencyAuthority.targetId', error)
  const revision = integer(
    item.artifactRecordRevision,
    1,
    'dependencyAuthority.artifactRecordRevision',
    error,
  )
  const recordSha256 = sha(
    item.artifactRecordSha256,
    'dependencyAuthority.artifactRecordSha256',
    error,
  )
  if (targetId !== expectedTargetId
    || revision !== request.expectedArtifactRecordRevision
    || recordSha256 !== request.expectedArtifactRecordSha256) {
    throw error('dependency authority target mismatch')
  }
  const sources = item.sources.map((value, index): YimengStageDependencyAuthoritySource => {
    const source = exact(value, AUTHORITY_SOURCE_FIELDS, `dependencyAuthority.sources[${String(index)}]`, error)
    return {
      stageId: id(source.stageId, 'dependency source stageId', error),
      scopeInstance: id(source.scopeInstance, 'dependency source scopeInstance', error),
      artifactRevision: id(source.artifactRevision, 'dependency source artifactRevision', error),
      artifactSha256: sha(source.artifactSha256, 'dependency source artifactSha256', error),
      artifactRecordRevision: integer(
        source.artifactRecordRevision,
        1,
        'dependency source artifactRecordRevision',
        error,
      ),
      artifactRecordSha256: sha(
        source.artifactRecordSha256,
        'dependency source artifactRecordSha256',
        error,
      ),
      decisionId: id(source.decisionId, 'dependency source decisionId', error),
      approvalEventSha256: sha(
        source.approvalEventSha256,
        'dependency source approvalEventSha256',
        error,
      ),
    }
  })
  const locks = item.locks.map((value, index): YimengStageDependencyAuthorityLock => {
    const lock = exact(value, AUTHORITY_LOCK_FIELDS, `dependencyAuthority.locks[${String(index)}]`, error)
    return {
      lockId: id(lock.lockId, 'dependency lock lockId', error),
      stageId: id(lock.stageId, 'dependency lock stageId', error),
      scopeInstance: id(lock.scopeInstance, 'dependency lock scopeInstance', error),
      artifactRecordRevision: integer(
        lock.artifactRecordRevision,
        1,
        'dependency lock artifactRecordRevision',
        error,
      ),
      artifactRecordSha256: sha(
        lock.artifactRecordSha256,
        'dependency lock artifactRecordSha256',
        error,
      ),
      decisionId: id(lock.decisionId, 'dependency lock decisionId', error),
      eventSha256: sha(lock.eventSha256, 'dependency lock eventSha256', error),
    }
  })
  if (new Set(sources.map(source => source.stageId)).size !== sources.length
    || new Set(locks.map(lock => lock.lockId)).size !== locks.length) {
    throw error('dependency authority contains duplicate bindings')
  }
  const blockers = stringList(item.blockers, 'dependencyAuthority.blockers', error)
  if (typeof item.verified !== 'boolean' || item.verified !== (blockers.length === 0)) {
    throw error('dependency authority verification mismatch')
  }
  return {
    schema: 'jason.qingmu-stage-dependency-authority.v1',
    targetId,
    artifactRecordRevision: revision,
    artifactRecordSha256: recordSha256,
    sources,
    locks,
    blockers,
    verified: item.verified,
  }
}

function decisionResult(
  value: unknown,
  request: YimengRecoverStageArtifactDecisionRequest | YimengForwardedStageArtifactDecisionRequest,
  helpers: Helpers,
  token?: string,
): YimengStageArtifactDecisionResult {
  const error = helpers.responseError
  const root = exact(value, DECISION_RESULT_FIELDS, 'decisionResult', error)
  if (root.schema !== 'jason.qingmu-stage-artifact-decision-result.v1') {
    throw error('decision result schema mismatch')
  }
  const item = exact(root.decision, DECISION_FIELDS, 'decisionResult.decision', error)
  const authority = dependencyAuthority(item.dependencyAuthority, request, helpers)
  const decisionValue = item.decision
  if (decisionValue !== 'approve' && decisionValue !== 'reject' && decisionValue !== 'request_changes') {
    throw error('decision result value mismatch')
  }
  const subjectId = sha(item.subjectId, 'decision.subjectId', error)
  const recordRevision = integer(
    item.subjectArtifactRecordRevision,
    1,
    'decision.subjectArtifactRecordRevision',
    error,
  )
  const recordSha256 = sha(
    item.subjectArtifactRecordSha256,
    'decision.subjectArtifactRecordSha256',
    error,
  )
  if (item.subjectType !== 'stage_artifact_record'
    || subjectId !== authority.targetId
    || recordRevision !== request.expectedArtifactRecordRevision
    || recordSha256 !== request.expectedArtifactRecordSha256) {
    throw error('decision record binding mismatch')
  }
  const artifactRevision = id(item.artifactRevision, 'decision.artifactRevision', error)
  const artifactSha256 = sha(item.artifactSha256, 'decision.artifactSha256', error)
  const subjectSnapshotSha256 = sha(
    item.subjectSnapshotSha256,
    'decision.subjectSnapshotSha256',
    error,
  )
  const methodProjectionSha256 = sha(
    item.methodProjectionSha256,
    'decision.methodProjectionSha256',
    error,
  )
  const rulesSha256 = sha(item.rulesSha256, 'decision.rulesSha256', error)
  const reason = text(item.reason, 8000, 'decision.reason', error)
  if ('decision' in request && (
    decisionValue !== request.decision
    || reason !== request.reason
    || artifactRevision !== request.expectedArtifactRevision
    || artifactSha256 !== request.expectedArtifactSha256
    || subjectSnapshotSha256 !== request.expectedSubjectSha256
    || methodProjectionSha256 !== request.methodProjectionSha256
    || rulesSha256 !== request.methodProjection.rulesSha256
  )) {
    throw error('decision receipt differs from submitted command')
  }
  const actorNaturalPersonId = id(
    item.actorNaturalPersonId,
    'decision.actorNaturalPersonId',
    error,
  )
  const producerNaturalPersonId = id(
    item.producerNaturalPersonId,
    'decision.producerNaturalPersonId',
    error,
  )
  if (item.actorRole !== 'approver' || actorNaturalPersonId === producerNaturalPersonId) {
    throw error('decision independent approver mismatch')
  }
  const authSessionId = sha(item.authSessionId, 'decision.authSessionId', error)
  if (token !== undefined
    && authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex')) {
    throw error('decision authenticated session mismatch')
  }
  const approved = decisionValue === 'approve'
  if (approved && !authority.verified) throw error('unverified dependency authority cannot approve')
  if (typeof item.stageArtifactAvailable !== 'boolean'
    || typeof item.dependencyAuthorityVerified !== 'boolean'
    || typeof item.stageApprovalGranted !== 'boolean'
    || typeof item.lockActivated !== 'boolean'
    || item.stageArtifactAvailable !== approved
    || item.dependencyAuthorityVerified !== authority.verified
    || item.stageApprovalGranted !== approved
    || item.planSealed !== false
    || item.providerCalls !== 0
    || item.humanSignoffInferred !== false
    || item.reworkExecuted !== false) {
    throw error('decision authority flags mismatch')
  }
  const decisionEventSha256 = sha(root.decisionEventSha256, 'decisionEventSha256', error)
  let producedLock: YimengStageArtifactProducedLock | null = null
  if (root.producedLock !== null) {
    const lock = exact(root.producedLock, PRODUCED_LOCK_FIELDS, 'producedLock', error)
    producedLock = {
      lockId: id(lock.lockId, 'producedLock.lockId', error),
      stageId: id(lock.stageId, 'producedLock.stageId', error),
      scopeInstance: id(lock.scopeInstance, 'producedLock.scopeInstance', error),
      artifactRecordRevision: integer(
        lock.artifactRecordRevision,
        1,
        'producedLock.artifactRecordRevision',
        error,
      ),
      artifactRecordSha256: sha(
        lock.artifactRecordSha256,
        'producedLock.artifactRecordSha256',
        error,
      ),
      eventSha256: sha(lock.eventSha256, 'producedLock.eventSha256', error),
    }
    if (producedLock.stageId !== request.stageId
      || producedLock.scopeInstance !== request.scopeInstance
      || producedLock.artifactRecordRevision !== request.expectedArtifactRecordRevision
      || producedLock.artifactRecordSha256 !== request.expectedArtifactRecordSha256
      || producedLock.eventSha256 !== decisionEventSha256) {
      throw error('produced lock binding mismatch')
    }
  }
  if (item.lockActivated !== (approved && producedLock !== null)) {
    throw error('decision lock activation mismatch')
  }
  if (!approved && producedLock !== null) throw error('non-approval cannot produce a lock')
  if ('decision' in request) {
    const declaredLock = request.methodProjection.definition.producesLockId
    if (approved && ((declaredLock === null) !== (producedLock === null)
      || (producedLock !== null && producedLock.lockId !== declaredLock))) {
      throw error('produced lock differs from current Stage definition')
    }
  }
  const decision: YimengStageArtifactDecision = {
    id: id(item.id, 'decision.id', error),
    decisionOrdinal: integer(item.decisionOrdinal, 1, 'decision.decisionOrdinal', error),
    subjectType: 'stage_artifact_record',
    subjectId,
    subjectArtifactRecordRevision: recordRevision,
    subjectArtifactRecordSha256: recordSha256,
    artifactRevision,
    artifactSha256,
    subjectSnapshotSha256,
    methodProjectionSha256,
    rulesSha256,
    decision: decisionValue,
    reason,
    actorId: id(item.actorId, 'decision.actorId', error),
    actorRole: 'approver',
    actorNaturalPersonId,
    producerActorId: id(item.producerActorId, 'decision.producerActorId', error),
    producerNaturalPersonId,
    authSessionId,
    dependencyAuthority: authority,
    stageArtifactAvailable: item.stageArtifactAvailable,
    dependencyAuthorityVerified: item.dependencyAuthorityVerified,
    stageApprovalGranted: item.stageApprovalGranted,
    lockActivated: item.lockActivated,
    planSealed: false,
    providerCalls: 0,
    humanSignoffInferred: false,
    reworkExecuted: false,
    decidedAt: helpers.requireTimestamp(text(item.decidedAt, 128, 'decision.decidedAt', error), 'decision.decidedAt'),
  }
  return {
    schema: 'jason.qingmu-stage-artifact-decision-result.v1',
    decision,
    decisionEventSha256,
    producedLock,
    receiptId: id(root.receiptId, 'receiptId', error),
    outboxEventId: id(root.outboxEventId, 'outboxEventId', error),
  }
}

function authorityProbeResult(
  value: unknown,
  request: YimengForwardedStageArtifactAuthorityProbeRequest,
  helpers: Helpers,
): YimengStageArtifactAuthorityProbe {
  const error = helpers.responseError
  const root = exact(value, AUTHORITY_PROBE_FIELDS, 'authorityProbe', error)
  if (root.schema !== 'jason.qingmu-stage-artifact-authority-probe.v1'
    || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId
    || root.stageId !== request.stageId
    || root.scopeInstance !== request.scopeInstance) {
    throw error('authority probe coordinates mismatch')
  }
  const artifactRecordRevision = integer(
    root.artifactRecordRevision,
    1,
    'authorityProbe.artifactRecordRevision',
    error,
  )
  const artifactRecordSha256 = sha(
    root.artifactRecordSha256,
    'authorityProbe.artifactRecordSha256',
    error,
  )
  const rulesSha256 = sha(root.rulesSha256, 'authorityProbe.rulesSha256', error)
  if (artifactRecordRevision !== request.expectedArtifactRecordRevision
    || artifactRecordSha256 !== request.expectedArtifactRecordSha256
    || rulesSha256 !== request.methodProjection.rulesSha256) {
    throw error('authority probe exact record or rules binding mismatch')
  }
  const recoveryRequest: YimengRecoverStageArtifactDecisionRequest = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
    expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
    idempotencyKey: 'authority-probe',
  }
  const authority = dependencyAuthority(root.dependencyAuthority, recoveryRequest, helpers)
  const currentDecisionResult = root.currentDecisionResult === null
    ? null
    : decisionResult(root.currentDecisionResult, recoveryRequest, helpers)
  if (currentDecisionResult !== null) {
    const decision = currentDecisionResult.decision
    if (decision.artifactRevision !== request.expectedArtifactRevision
      || decision.artifactSha256 !== request.expectedArtifactSha256
      || decision.subjectSnapshotSha256 !== request.expectedSubjectSha256
      || decision.methodProjectionSha256 !== request.methodProjectionSha256
      || decision.rulesSha256 !== rulesSha256
      || canonical(decision.dependencyAuthority, helpers, error, 'decisionAuthority')
        !== canonical(authority, helpers, error, 'probeAuthority')) {
      throw error('authority probe current decision binding mismatch')
    }
    const approvedDecision = decision.decision === 'approve'
    const declaredLock = request.methodProjection.definition.producesLockId
    const producedLock = currentDecisionResult.producedLock
    if (approvedDecision && ((declaredLock === null) !== (producedLock === null)
      || (producedLock !== null && producedLock.lockId !== declaredLock))) {
      throw error('authority probe lock differs from current Stage definition')
    }
  }
  const approved = currentDecisionResult?.decision.decision === 'approve'
  if (typeof root.dependencyAuthorityVerified !== 'boolean'
    || typeof root.stageArtifactAvailable !== 'boolean'
    || typeof root.stageApprovalGranted !== 'boolean'
    || typeof root.lockActivated !== 'boolean'
    || root.dependencyAuthorityVerified !== authority.verified
    || root.stageArtifactAvailable !== approved
    || root.stageApprovalGranted !== approved
    || root.lockActivated !== (approved && currentDecisionResult.producedLock !== null)
    || root.planSealed !== false
    || root.providerCalls !== 0
    || root.reworkExecuted !== false) {
    throw error('authority probe flags mismatch')
  }
  return {
    schema: 'jason.qingmu-stage-artifact-authority-probe.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifactRecordRevision,
    artifactRecordSha256,
    rulesSha256,
    dependencyAuthority: authority,
    currentDecisionResult,
    dependencyAuthorityVerified: root.dependencyAuthorityVerified,
    stageArtifactAvailable: root.stageArtifactAvailable,
    stageApprovalGranted: root.stageApprovalGranted,
    lockActivated: root.lockActivated,
    planSealed: false,
    providerCalls: 0,
    reworkExecuted: false,
  }
}

/**
 * Prepare exactly one Stage artifact POST or original-coordinate GET; writes are never retried.
 *
 * @param endpoint Stage artifact registration or recovery endpoint.
 * @param payload Untrusted Host command payload.
 * @param helpers Command adapter validation and canonicalization helpers.
 * @param currentMethodValue Fresh trusted-Host Method result required by decision and authority endpoints.
 * @returns The validated HTTP command and response normalizer.
 */
export function prepareStageArtifactCommand(
  endpoint: 'registerStageArtifact' | 'recoverStageArtifactRegistration' |
  'commitStageArtifactDecision' | 'recoverStageArtifactDecision' | 'probeStageArtifactAuthority',
  payload: unknown,
  helpers: Helpers,
  currentMethodValue?: unknown,
): PreparedCommand {
  if (endpoint === 'registerStageArtifact') {
    const request = registerRequest(payload, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-artifacts/${encodeURIComponent(request.stageId)}/${encodeURIComponent(request.scopeInstance)}`,
      request: {
        method: 'POST',
        body: {
          artifact: request.artifact,
          expectedSubjectSha256: request.expectedSubjectSha256,
          expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
          expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          idempotencyKey: request.idempotencyKey,
        },
      },
      normalize: (value, token) => {
        const receipt = result(value, request, helpers)
        const record = receipt.artifactRecord
        if (record.artifactRecordRevision !== request.expectedArtifactRecordRevision + 1
          || record.methodProjectionSha256 !== request.methodProjectionSha256
          || record.rulesSha256 !== request.methodProjection.rulesSha256
          || canonical(record.definition, helpers, helpers.responseError, 'definition')
            !== canonical(request.methodProjection.definition, helpers, helpers.responseError, 'definition')
          || canonical(record.machineValidation, helpers, helpers.responseError, 'machineValidation')
            !== canonical(request.methodProjection.machineValidation, helpers, helpers.responseError, 'machineValidation')
          || record.authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex')) {
          throw helpers.responseError('artifact receipt differs from submitted command')
        }
        return receipt
      },
    }
  }
  if (endpoint === 'commitStageArtifactDecision') {
    if (currentMethodValue === undefined) throw helpers.responseError('current Stage artifact Method is unavailable')
    const request = decisionRequest(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-artifacts/${encodeURIComponent(request.stageId)}/${encodeURIComponent(request.scopeInstance)}/decisions`,
      request: {
        method: 'POST',
        body: {
          expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
          expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
          expectedArtifactRevision: request.expectedArtifactRevision,
          expectedArtifactSha256: request.expectedArtifactSha256,
          expectedSubjectSha256: request.expectedSubjectSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          decision: request.decision,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
        },
      },
      normalize: (value, token) => decisionResult(value, request, helpers, token),
    }
  }
  if (endpoint === 'probeStageArtifactAuthority') {
    if (currentMethodValue === undefined) throw helpers.responseError('current Stage artifact Method is unavailable')
    const request = authorityProbeRequest(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-artifacts/${encodeURIComponent(request.stageId)}/${encodeURIComponent(request.scopeInstance)}/authority-probe`,
      request: {
        method: 'POST',
        body: {
          expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
          expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
          expectedArtifactRevision: request.expectedArtifactRevision,
          expectedArtifactSha256: request.expectedArtifactSha256,
          expectedSubjectSha256: request.expectedSubjectSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
        },
      },
      normalize: value => authorityProbeResult(value, request, helpers),
    }
  }
  if (endpoint === 'recoverStageArtifactDecision') {
    const request = decisionRecoveryCoordinates(
      exact(payload, DECISION_RECOVERY_FIELDS, 'payload', helpers.inputError),
      helpers.inputError,
    )
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-artifacts/${encodeURIComponent(request.stageId)}/${encodeURIComponent(request.scopeInstance)}/decision-command-receipt?expectedArtifactRecordRevision=${String(request.expectedArtifactRecordRevision)}&expectedArtifactRecordSha256=${request.expectedArtifactRecordSha256}`,
      request: { method: 'GET', idempotencyKey: request.idempotencyKey },
      normalize: (value) => {
        const root = exact(value, ['schema', 'receipt'], 'decisionRecovery', helpers.responseError)
        if (root.schema !== 'jason.qingmu-stage-artifact-decision-recovery.v1') {
          throw helpers.responseError('decision recovery schema mismatch')
        }
        return {
          schema: 'jason.qingmu-stage-artifact-decision-recovery.v1',
          receipt: decisionResult(root.receipt, request, helpers),
        }
      },
    }
  }
  const request = coordinates(exact(payload, COORDINATE_FIELDS, 'payload', helpers.inputError), helpers.inputError)
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-artifacts/${encodeURIComponent(request.stageId)}/${encodeURIComponent(request.scopeInstance)}/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const root = exact(value, ['schema', 'receipt'], 'recovery', helpers.responseError)
      if (root.schema !== 'jason.qingmu-stage-artifact-recovery.v1') throw helpers.responseError('recovery schema mismatch')
      // Historical recovery intentionally needs neither the current artifact nor today's HMAC key or session.
      return {
        schema: 'jason.qingmu-stage-artifact-recovery.v1',
        receipt: result(root.receipt, request, helpers),
      }
    },
  }
}
