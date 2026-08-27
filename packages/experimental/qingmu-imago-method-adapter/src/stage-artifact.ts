/** Machine-validate one immutable V6 Stage artifact without creating approval authority. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  ImagoStageArtifact,
  ImagoStageArtifactMethodDefinition,
  ImagoStageArtifactMethodProjection,
  ImagoStageArtifactMethodRequest,
  ImagoStageArtifactMethodResponse,
  ImagoStageArtifactMethodSnapshot,
  ImagoStageArtifactSubject,
} from './types.ts'
import { WORKSET_RULE_PATHS } from './workset.ts'

/** Fixed Core sources independently re-read around every compiler invocation. */
export const STAGE_ARTIFACT_RULE_PATHS = [
  ...WORKSET_RULE_PATHS,
  'scripts/build_v6_stage_contracts.py',
  'scripts/validate_v6_stage_contracts.py',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_stage_artifact_method.py',
] as const

const REQUEST_FIELDS = ['projectId', 'episodeId', 'stageId', 'scopeInstance', 'artifact'] as const
const ARTIFACT_FIELDS = [
  'schema_version', 'workflow_version', 'stage_id', 'scope_instance', 'artifact_revision', 'created_at',
  'producer', 'source_bindings', 'lock_bindings', 'content', 'open_issues',
] as const
type Serialize = (value: unknown, field: string) => string

/** Browser input contains unsupported coordinates, claims, or artifact envelope fields. */
export class StageArtifactInputError extends Error {}
/** Current Core sources or compiler output cannot be independently verified. */
export class StageArtifactContractError extends Error {}

function object(value: unknown, ErrorType: typeof StageArtifactInputError | typeof StageArtifactContractError): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ErrorType('expected object')
  return value as Record<string, unknown>
}

function exact(
  value: unknown, keys: readonly string[], ErrorType: typeof StageArtifactInputError | typeof StageArtifactContractError,
): Record<string, unknown> {
  const record = object(value, ErrorType)
  if (!isDeepStrictEqual(Object.keys(record).sort(), [...keys].sort())) throw new ErrorType('unexpected fields')
  return record
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && pythonStrip(value) !== '' && pythonStrip(value) === value
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/u.test(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && pythonStrip(value) !== '' && !value.includes('\u0000')
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function canonicalNumber(value: number, field: string): string {
  if (!Number.isFinite(value)) throw new StageArtifactInputError(`${field} must contain only finite numbers`)
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
 * Serialize Stage JSON to a Python json.dumps fixed point for cross-runtime SHA binding.
 *
 * @param value Stage request, artifact, projection, or receipt value.
 * @param field Diagnostic field name.
 * @param depth Current recursion depth.
 * @returns Canonical JSON bytes shared by Host, Core, and Yimeng.
 */
export function stageArtifactCanonicalJson(value: unknown, field: string, depth = 0): string {
  if (depth > 100) throw new StageArtifactInputError(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new StageArtifactInputError(`${field} must contain valid Unicode`)
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
  throw new StageArtifactInputError(`${field} must be canonical JSON`)
}

function digest(value: unknown, serialize: Serialize, field = 'stageArtifactMethod'): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length
}

/**
 * Accept one explicit artifact envelope; dependency, approval, lock, and execution claims are not request fields.
 *
 * @param payload Untrusted Host method payload.
 * @returns The validated Stage artifact request.
 */
export function parseStageArtifactMethodRequest(payload: unknown): ImagoStageArtifactMethodRequest {
  try {
    const request = exact(payload, REQUEST_FIELDS, StageArtifactInputError)
    if (!identifier(request.projectId) || !identifier(request.episodeId) || !identifier(request.stageId)
      || !identifier(request.scopeInstance)) throw new StageArtifactInputError('invalid artifact coordinates')
    const artifact = object(request.artifact, StageArtifactInputError)
    if (ARTIFACT_FIELDS.some(field => !Object.hasOwn(artifact, field))) {
      throw new StageArtifactInputError('missing Stage artifact envelope field')
    }
    if (artifact.schema_version !== '6.0.0-draft.1' || artifact.workflow_version !== '6.0.0-draft.2'
      || artifact.stage_id !== request.stageId || artifact.scope_instance !== request.scopeInstance
      || !identifier(artifact.artifact_revision) || !text(artifact.created_at)
      || typeof artifact.producer !== 'object' || artifact.producer === null || Array.isArray(artifact.producer)
      || !Array.isArray(artifact.source_bindings) || !Array.isArray(artifact.lock_bindings)
      || !Array.isArray(artifact.open_issues)) throw new StageArtifactInputError('invalid Stage artifact envelope')
    return {
      projectId: request.projectId,
      episodeId: request.episodeId,
      stageId: request.stageId,
      scopeInstance: request.scopeInstance,
      artifact: artifact as unknown as ImagoStageArtifact,
    }
  } catch (error) {
    if (error instanceof StageArtifactInputError) throw error
    throw new StageArtifactInputError('stageArtifactMethod accepts only explicit coordinates and one V6 Stage artifact')
  }
}

/**
 * Canonicalize the artifact once and bind its exact bytes to a separate subject digest.
 *
 * @param request Validated Stage artifact request.
 * @param serialize Canonical JSON serializer supplied by the adapter.
 * @returns The immutable compiler input snapshot.
 */
export function buildStageArtifactSnapshot(
  request: ImagoStageArtifactMethodRequest, serialize: Serialize,
): ImagoStageArtifactMethodSnapshot {
  try {
    const artifactWire = serialize(request.artifact, 'stageArtifact')
    const artifact = JSON.parse(artifactWire) as ImagoStageArtifact
    const artifactSha256 = createHash('sha256').update(artifactWire, 'utf8').digest('hex')
    const subject: ImagoStageArtifactSubject = {
      schema: 'jason.qingmu-imago-stage-artifact.v1',
      projectId: request.projectId,
      episodeId: request.episodeId,
      stageId: request.stageId,
      scopeInstance: request.scopeInstance,
      artifactRevision: request.artifact.artifact_revision,
      artifactSha256,
    }
    const snapshot: ImagoStageArtifactMethodSnapshot = {
      schema: 'qingmu.stage-artifact-method-snapshot.v1',
      subject,
      subjectSnapshotSha256: digest(subject, serialize, 'stageArtifactSubject'),
      artifact,
    }
    if (Buffer.byteLength(serialize(snapshot, 'stageArtifactSnapshot'), 'utf8') > 1024 * 1024) {
      throw new StageArtifactInputError('Stage artifact exceeds Core input limit')
    }
    return snapshot
  } catch (error) {
    if (error instanceof StageArtifactInputError) throw error
    throw new StageArtifactInputError('Stage artifact must be canonical JSON')
  }
}

/** Fixed source hashes and independently reconstructed contract metadata for one Stage. */
export interface StageArtifactRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoStageArtifactMethodDefinition
}

/**
 * Reconstruct the selected Stage definition from current V6 pointer, registry, workflow, and contract bytes.
 *
 * @param coreRoot Absolute IMAGO OS Core root.
 * @param stageId Requested current V6 Stage identifier.
 * @param scopeInstance Requested global or LSU scope instance.
 * @param serialize Canonical JSON serializer supplied by the adapter.
 * @returns Current Stage definition and fixed rule-source hashes.
 */
export async function readStageArtifactRules(
  coreRoot: string, stageId: string, scopeInstance: string, serialize: Serialize,
): Promise<StageArtifactRules> {
  const sources = new Map(await Promise.all(
    STAGE_ARTIFACT_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const),
  ))
  const json = (path: typeof STAGE_ARTIFACT_RULE_PATHS[number]): Record<string, unknown> => {
    const bytes = sources.get(path)
    if (bytes === undefined) throw new StageArtifactContractError('missing current rule source')
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, StageArtifactContractError)
  }
  const pointer = json('pipeline/imago-os-current.json')
  const resolution = object(pointer.resolution, StageArtifactContractError)
  const registry = json('pipeline/workflow-channel-registry.json')
  const spec = json('pipeline/workflow-spec.v6.production-beta.json')
  const contractsDoc = json('pipeline/v6-stage-contracts.json')
  if (pointer.schema !== 'IMAGO-CurrentRuntimePointer-v1' || pointer.status !== 'ACTIVE' || pointer.public_system_name !== 'IMAGO OS'
    || resolution.internal_runtime_channel !== 'V6_PRODUCTION_BETA' || !identifier(resolution.internal_contract_id)
    || !identifier(resolution.controller) || resolution.workflow_spec !== 'pipeline/workflow-spec.v6.production-beta.json'
    || registry.schema !== 'IMAGO-WorkflowChannelRegistry-v2' || registry.public_runtime_pointer !== 'pipeline/imago-os-current.json'
    || registry.system_scope !== 'V6_ONLY' || registry.default_new_project_channel !== 'V6_PRODUCTION_BETA'
    || registry.pre_v6_import_allowed !== false || registry.pre_v6_fallback_allowed !== false
    || registry.cross_version_lock_or_status_inheritance_allowed !== false || !Array.isArray(registry.channels)
    || registry.channels.length !== 1) throw new StageArtifactContractError('current V6 pointer or registry mismatch')
  const channel = object(registry.channels[0], StageArtifactContractError)
  if (channel.channel_id !== 'V6_PRODUCTION_BETA' || channel.workflow_family !== 'V6'
    || channel.workflow_version !== resolution.internal_contract_id || channel.fallback !== false
    || channel.pre_v6_project_import_allowed !== false || channel.controller !== resolution.controller
    || channel.workflow_spec !== resolution.workflow_spec || spec.active !== true || spec.status !== 'PRODUCTION_BETA'
    || spec.workflow_version !== resolution.internal_contract_id || contractsDoc.schema_version !== '1.0.0-draft'
    || contractsDoc.workflow_version !== spec.workflow_version || !Array.isArray(contractsDoc.contracts)
    || contractsDoc.contracts.length !== 23 || !Array.isArray(spec.stages)
    || spec.stages.length !== contractsDoc.contracts.length) throw new StageArtifactContractError('current workflow binding mismatch')

  const matches: Array<{ contract: Record<string, unknown>; stage: Record<string, unknown> }> = []
  const seen = new Set<string>()
  for (const [index, raw] of contractsDoc.contracts.entries()) {
    const contract = object(raw, StageArtifactContractError)
    const stage = object(spec.stages[index], StageArtifactContractError)
    if (!identifier(contract.stage_id) || seen.has(contract.stage_id) || !identifier(contract.owner_role)
      || (contract.scope !== 'global' && contract.scope !== 'per_lsu') || !sha(contract.contract_sha256)
      || !text(contract.artifact_kind) || !text(contract.canonical_output)
      || !stringList(contract.required_source_stage_bindings) || !stringList(contract.required_lock_bindings)
      || (contract.produces_lock !== null && !identifier(contract.produces_lock))) {
      throw new StageArtifactContractError('invalid current Stage contract')
    }
    const { contract_sha256: claimedSha, ...content } = contract
    if (digest(content, serialize, 'stageContract') !== claimedSha) throw new StageArtifactContractError('Stage contract SHA mismatch')
    for (const [contractKey, specKey] of [['stage_id', 'id'], ['owner_role', 'owner_role'], ['scope', 'scope'],
      ['required_source_stage_bindings', 'depends_on'], ['required_lock_bindings', 'requires_locks'], ['produces_lock', 'produces_lock']] as const) {
      if (!Object.hasOwn(contract, contractKey) || !Object.hasOwn(stage, specKey)
        || !isDeepStrictEqual(contract[contractKey], stage[specKey])) throw new StageArtifactContractError('Stage contract and workflow disagree')
    }
    seen.add(contract.stage_id)
    if (contract.stage_id === stageId) matches.push({ contract, stage })
  }
  if (matches.length !== 1) throw new StageArtifactContractError('stageId is not an exact current V6 Stage')
  const contract = matches[0]?.contract
  if (contract === undefined || (contract.scope === 'global' && scopeInstance !== 'GLOBAL')
    || (contract.scope === 'per_lsu' && !/^LSU[0-9]{2,}$/u.test(scopeInstance))) {
    throw new StageArtifactContractError('scope instance does not match the current Stage contract')
  }
  const definition: ImagoStageArtifactMethodDefinition = {
    id: 'IMAGO-V6-STAGE-ARTIFACT',
    version: resolution.internal_contract_id,
    stageId: contract.stage_id as string,
    roleId: contract.owner_role as string,
    scope: contract.scope as 'global' | 'per_lsu',
    contractSha256: contract.contract_sha256 as string,
    artifactKind: contract.artifact_kind as string,
    canonicalOutput: contract.canonical_output as string,
    requiredSourceStageIds: [...contract.required_source_stage_bindings as string[]],
    requiredLockIds: [...contract.required_lock_bindings as string[]],
    producesLockId: contract.produces_lock as string | null,
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
  return {
    hashes: Object.fromEntries([...sources].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])),
    definition,
  }
}

/**
 * Verify Core output against the exact artifact and fixed source bytes before signing it.
 *
 * @param raw Untrusted compiler output.
 * @param snapshot Exact compiler input snapshot.
 * @param rules Independently reconstructed current Stage rules.
 * @param serialize Canonical JSON serializer supplied by the adapter.
 * @param key Current Host method attestation key.
 * @returns A signed, machine-validated Stage artifact method response.
 */
export function attestStageArtifactMethod(
  raw: unknown,
  snapshot: ImagoStageArtifactMethodSnapshot,
  rules: StageArtifactRules,
  serialize: Serialize,
  key: string,
): ImagoStageArtifactMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'subjectSnapshotSha256', 'machineValidation', 'definition', 'ruleBindings', 'rulesSha256',
  ], StageArtifactContractError)
  const validation = exact(projection.machineValidation, [
    'status', 'validator', 'validatedArtifactSha256', 'contractSha256',
  ], StageArtifactContractError)
  if (projection.schema !== 'qingmu.imago-stage-artifact-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.subjectSnapshotSha256
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes)
    || projection.rulesSha256 !== digest(rules.hashes, serialize, 'stageArtifactRules')
    || validation.status !== 'PASS' || validation.validator !== 'scripts/validate_v6_stage_contracts.py'
    || validation.validatedArtifactSha256 !== snapshot.subject.artifactSha256
    || validation.contractSha256 !== rules.definition.contractSha256) {
    throw new StageArtifactContractError('compiler artifact, definition, validation, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize, 'stageArtifactProjection')
  const unsigned = {
    schema: 'qingmu.imago-stage-artifact-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-stage-artifact-method-adapter-result.v1',
    projection: projection as unknown as ImagoStageArtifactMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(serialize(unsigned, 'stageArtifactAttestation'), 'utf8').digest('hex'),
    },
  }
}
