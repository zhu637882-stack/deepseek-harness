/** Register one Core-validated Stage artifact or recover its original durable receipt. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  YimengCommandJsonObject,
  YimengImagoStageArtifactMethodAttestation,
  YimengImagoStageArtifactMethodProjection,
  YimengRecoverStageArtifactRegistrationRequest,
  YimengRegisterStageArtifactRequest,
  YimengStageArtifact,
  YimengStageArtifactDefinition,
  YimengStageArtifactMachineValidation,
  YimengStageArtifactRecord,
  YimengStageArtifactRecovery,
  YimengStageArtifactResult,
  YimengStageArtifactSubject,
} from './types.ts'

const COORDINATE_FIELDS = [
  'projectId', 'episodeId', 'stageId', 'scopeInstance', 'expectedSubjectSha256', 'idempotencyKey',
] as const
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
  if (Number.isInteger(value)) return `${sign}${digits}${'0'.repeat(exponent + 1 - digits.length)}`
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
  readonly normalize: (value: unknown, token: string) => YimengStageArtifactResult | YimengStageArtifactRecovery
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
  boundArtifact: YimengStageArtifact, helpers: Helpers, error: ErrorFactory,
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
    || result.artifactRevision !== boundArtifact.artifact_revision
    || result.artifactSha256 !== digest(boundArtifact, helpers, error, 'artifact')
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
  boundArtifact: YimengStageArtifact,
  helpers: Helpers,
): {
  projection: YimengImagoStageArtifactMethodProjection
  projectionSha256: string
  attestation: YimengImagoStageArtifactMethodAttestation
} {
  const error = helpers.inputError
  const item = exact(value, METHOD_FIELDS, 'methodProjection', error)
  if (item.schema !== 'qingmu.imago-stage-artifact-method.v1') throw error('methodProjection schema mismatch')
  const boundSubject = subject(item.subject, request, boundArtifact, helpers, error)
  if (item.subjectSnapshotSha256 !== request.expectedSubjectSha256) throw error('methodProjection subject SHA mismatch')
  const boundDefinition = definition(item.definition, request, error)
  if (boundDefinition.version !== boundArtifact.workflow_version) {
    throw error('Stage artifact definition version differs from the artifact workflow version')
  }
  const producer = object(boundArtifact.producer, 'artifact.producer', error)
  if (producer.producer_role !== boundDefinition.roleId) throw error('artifact producer role differs from current Stage owner')
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
    raw.methodProjection, raw.methodProjectionSha256, raw.methodAttestation, request, boundArtifact, helpers,
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

/**
 * Prepare exactly one POST or the original-coordinate GET; writes are never retried.
 *
 * @param endpoint Stage artifact registration or recovery endpoint.
 * @param payload Untrusted Host command payload.
 * @param helpers Command adapter validation and canonicalization helpers.
 * @returns The validated HTTP command and response normalizer.
 */
export function prepareStageArtifactCommand(
  endpoint: 'registerStageArtifact' | 'recoverStageArtifactRegistration', payload: unknown, helpers: Helpers,
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
