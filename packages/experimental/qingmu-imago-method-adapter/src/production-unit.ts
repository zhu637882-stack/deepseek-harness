/** Current LSU method for an explicitly requested native shot group; no binding or approval is performed. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengProductionUnitSource } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  ImagoProductionUnitMethodDefinition, ImagoProductionUnitMethodProjection, ImagoProductionUnitMethodRequest,
  ImagoProductionUnitMethodResponse, ImagoProductionUnitMethodSnapshot,
} from './types.ts'
import { WORKSET_RULE_PATHS } from './workset.ts'

/** Fixed Core imports: neither browser nor subprocess output can nominate source paths. */
export const PRODUCTION_UNIT_RULE_PATHS = [...WORKSET_RULE_PATHS,
  'scripts/compile_qingmu_element_method.py', 'scripts/compile_qingmu_production_unit_method.py',
] as const
type Serialize = (value: unknown, field: string) => string

/** Browser input is not the exact three-identifier request. */
export class ProductionUnitInputError extends Error {}
/** Missing or changed source/rule evidence; no fallback group or method is chosen. */
export class ProductionUnitContractError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProductionUnitContractError('expected object')
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = object(value)
  if (!isDeepStrictEqual(Object.keys(record).sort(), [...keys].sort())) throw new ProductionUnitContractError('unexpected fields')
  return record
}
function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && pythonStrip(value) !== '' && value === pythonStrip(value)
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/.test(value)
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
function digest(value: unknown, serialize: Serialize): string {
  return createHash('sha256').update(serialize(value, 'productionUnitMethod'), 'utf8').digest('hex')
}

/**
 * Validate browser coordinates without trimming or inventing a unit identifier.
 * @param payload - untrusted RPC input.
 * @returns only the exact project, episode, and group identifiers.
 */
export function parseProductionUnitMethodRequest(payload: unknown): ImagoProductionUnitMethodRequest {
  try {
    const value = exact(payload, ['projectId', 'episodeId', 'groupId'])
    if (!identifier(value.projectId) || !identifier(value.episodeId) || !identifier(value.groupId)) throw new ProductionUnitInputError()
    return { projectId: value.projectId, episodeId: value.episodeId, groupId: value.groupId }
  } catch {
    throw new ProductionUnitInputError('productionUnitMethod accepts only projectId, episodeId, and groupId')
  }
}

/**
 * Bind the compiler input to the exact available group in a fresh business read.
 * @param request - validated coordinates; group order is not a selection fallback.
 * @param source - untrusted result of the configured productionUnits reader.
 * @param serialize - existing Python-compatible canonical JSON serializer.
 * @returns a detached, SHA-verified snapshot; no historical binding is used as source.
 */
export function buildProductionUnitSnapshot(
  request: ImagoProductionUnitMethodRequest, source: unknown, serialize: Serialize,
): ImagoProductionUnitMethodSnapshot {
  const feed = exact(source, ['schema', 'projectId', 'episodeId', 'capabilities', 'groups', 'bindings',
    'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])
  if (feed.schema !== 'jason.qingmu-production-unit-feed.v1' || feed.projectId !== request.projectId
    || feed.episodeId !== request.episodeId || !Array.isArray(feed.groups) || !Array.isArray(feed.bindings)
    || typeof exact(feed.capabilities, ['canBindUnit']).canBindUnit !== 'boolean'
    || feed.planSealed !== false || feed.providerCalls !== 0 || feed.humanSignoffInferred !== false || feed.reworkExecuted !== false) {
    throw new ProductionUnitContractError('production unit feed mismatch')
  }
  const groups = feed.groups.map(value => exact(value, ['groupId', 'subject', 'snapshotSha256', 'availability']))
  if (groups.some(group => !identifier(group.groupId)) || new Set(groups.map(group => group.groupId)).size !== groups.length) {
    throw new ProductionUnitContractError('group identifiers must be unique')
  }
  const group = groups.find(item => item.groupId === request.groupId)
  if (group === undefined) throw new ProductionUnitContractError('requested group is unavailable')
  const availability = exact(group.availability, ['status', 'reason'])
  if (availability.status !== 'available' || availability.reason !== null) throw new ProductionUnitContractError('requested group is unavailable')
  const value = exact(group.subject, ['schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title',
    'groupExecutionPromptSha256', 'storyboardRevision', 'shots'])
  if (value.schema !== 'jason.qingmu-production-unit-source.v1' || !identifier(value.projectId)
    || !identifier(value.episodeId) || !identifier(value.groupId) || value.projectId !== request.projectId
    || value.episodeId !== request.episodeId || value.groupId !== request.groupId || !integer(value.groupNo, 1)
    || !integer(value.storyboardRevision, 0) || !sha(value.groupExecutionPromptSha256)
    || typeof value.title !== 'string' || !value.title.isWellFormed() || pythonStrip(value.title) === ''
    || value.title.includes('\u0000') || Array.from(value.title).length > 8000 || !Array.isArray(value.shots) || value.shots.length === 0) {
    throw new ProductionUnitContractError('invalid native group source')
  }
  const ids = new Set<string>()
  let previousNo = 0
  const shots: YimengProductionUnitSource['shots'][number][] = []
  for (const raw of value.shots) {
    const shot = exact(raw, ['frameId', 'frameNo', 'frameContentSha256'])
    if (!identifier(shot.frameId) || !integer(shot.frameNo, 1) || !sha(shot.frameContentSha256)
      || ids.has(shot.frameId) || shot.frameNo <= previousNo) throw new ProductionUnitContractError('invalid or unordered group member')
    ids.add(shot.frameId)
    previousNo = shot.frameNo
    shots.push({ frameId: shot.frameId, frameNo: shot.frameNo, frameContentSha256: shot.frameContentSha256 })
  }
  const subject: YimengProductionUnitSource = { schema: value.schema, projectId: value.projectId, episodeId: value.episodeId,
    groupId: value.groupId, groupNo: value.groupNo, title: value.title, groupExecutionPromptSha256: value.groupExecutionPromptSha256,
    storyboardRevision: value.storyboardRevision, shots }
  if (!sha(group.snapshotSha256) || group.snapshotSha256 !== digest(subject, serialize)) throw new ProductionUnitContractError('group source SHA mismatch')
  const snapshot: ImagoProductionUnitMethodSnapshot = { schema: 'qingmu.production-unit-method-snapshot.v1', subject, snapshotSha256: group.snapshotSha256 }
  if (Buffer.byteLength(serialize(snapshot, 'snapshot'), 'utf8') > 1024 * 1024) throw new ProductionUnitContractError('group source exceeds Core input limit')
  // Full-episode contiguity and DB ownership remain Yimeng authority; sparse frameNo values are legal.
  return snapshot
}

/** Current fixed rule bytes and the independently reconstructed binding-only definition. */
export interface ProductionUnitRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoProductionUnitMethodDefinition
}

/**
 * Cross-check the active pointer, registry, contracts, and loop from the same nine byte buffers.
 * @param coreRoot - configured local Core root, never a browser-supplied path.
 * @param serialize - canonical JSON used to recompute each contract SHA.
 * @returns current source hashes and six per-unit methods, not a second execution DAG.
 */
export async function readProductionUnitRules(coreRoot: string, serialize: Serialize): Promise<ProductionUnitRules> {
  const sources = new Map(await Promise.all(
    PRODUCTION_UNIT_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const),
  ))
  const json = (path: typeof PRODUCTION_UNIT_RULE_PATHS[number]): Record<string, unknown> => {
    const bytes = sources.get(path)
    if (bytes === undefined) throw new ProductionUnitContractError('missing current rule source')
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
  }
  const pointer = json('pipeline/imago-os-current.json')
  const resolution = object(pointer.resolution)
  const registry = json('pipeline/workflow-channel-registry.json')
  const spec = json('pipeline/workflow-spec.v6.production-beta.json')
  const contractsDoc = json('pipeline/v6-stage-contracts.json')
  if (pointer.schema !== 'IMAGO-CurrentRuntimePointer-v1' || pointer.status !== 'ACTIVE' || pointer.public_system_name !== 'IMAGO OS'
    || resolution.internal_runtime_channel !== 'V6_PRODUCTION_BETA' || !identifier(resolution.internal_contract_id) || !identifier(resolution.controller)
    || resolution.workflow_spec !== 'pipeline/workflow-spec.v6.production-beta.json'
    || registry.schema !== 'IMAGO-WorkflowChannelRegistry-v2' || registry.public_runtime_pointer !== 'pipeline/imago-os-current.json'
    || registry.system_scope !== 'V6_ONLY' || registry.default_new_project_channel !== 'V6_PRODUCTION_BETA'
    || registry.pre_v6_import_allowed !== false || registry.pre_v6_fallback_allowed !== false
    || registry.cross_version_lock_or_status_inheritance_allowed !== false
    || !Array.isArray(registry.channels) || registry.channels.length !== 1) {
    throw new ProductionUnitContractError('current V6 pointer or registry mismatch')
  }
  const channel = object(registry.channels[0])
  if (channel.channel_id !== 'V6_PRODUCTION_BETA' || channel.workflow_family !== 'V6'
    || channel.workflow_version !== resolution.internal_contract_id
    || channel.fallback !== false || channel.pre_v6_project_import_allowed !== false
    || channel.controller !== resolution.controller || channel.workflow_spec !== resolution.workflow_spec
    || spec.active !== true || spec.status !== 'PRODUCTION_BETA' || spec.workflow_version !== resolution.internal_contract_id
    || contractsDoc.schema_version !== '1.0.0-draft' || contractsDoc.workflow_version !== spec.workflow_version
    || !Array.isArray(contractsDoc.contracts) || contractsDoc.contracts.length !== 23
    || !Array.isArray(spec.stages) || spec.stages.length !== contractsDoc.contracts.length) {
    throw new ProductionUnitContractError('current workflow binding mismatch')
  }
  const stageIds = new Set<string>()
  const stages: ImagoProductionUnitMethodDefinition['stages'][number][] = []
  for (const [index, raw] of contractsDoc.contracts.entries()) {
    const contract = object(raw)
    const stage = object(spec.stages[index])
    if (!identifier(contract.stage_id) || !identifier(contract.owner_role) || stageIds.has(contract.stage_id)
      || !sha(contract.contract_sha256) || (contract.scope !== 'global' && contract.scope !== 'per_lsu')) {
      throw new ProductionUnitContractError('invalid current stage contract')
    }
    if (!Array.isArray(contract.required_source_stage_bindings) || !contract.required_source_stage_bindings.every(identifier)
      || !Array.isArray(contract.required_lock_bindings) || !contract.required_lock_bindings.every(identifier)
      || (contract.produces_lock !== null && !identifier(contract.produces_lock))) throw new ProductionUnitContractError('invalid stage bindings')
    const { contract_sha256: claimedSha, ...content } = contract
    if (digest(content, serialize) !== claimedSha) throw new ProductionUnitContractError('stage contract SHA mismatch')
    for (const [contractKey, specKey] of [['stage_id', 'id'], ['owner_role', 'owner_role'], ['scope', 'scope'],
      ['required_source_stage_bindings', 'depends_on'], ['required_lock_bindings', 'requires_locks'], ['produces_lock', 'produces_lock']] as const) {
      if (!Object.hasOwn(contract, contractKey) || !Object.hasOwn(stage, specKey)
        || !isDeepStrictEqual(contract[contractKey], stage[specKey])) {
        throw new ProductionUnitContractError('stage contract and workflow disagree')
      }
    }
    stageIds.add(contract.stage_id)
    if (contract.scope === 'per_lsu') stages.push({ stageId: contract.stage_id, roleId: contract.owner_role, contractSha256: contract.contract_sha256 })
  }
  const loop = object(spec.lsu_loop)
  if (stages.length !== 6 || loop.unit_id_pattern !== 'LSU[0-9]{2,}' || loop.entry_stage !== stages[0]?.stageId
    || loop.terminal_stage !== 'LSUQC' || stages.at(-1)?.stageId !== 'LSUQC'
    || !isDeepStrictEqual(loop.stage_order, stages.map(stage => stage.stageId)) || loop.parallel_units_allowed !== true
    || loop.cross_lsu_continuity_required !== true || loop.rework_must_route_to_earliest_defect_owner !== true
    || loop.postproduction_owner !== 'EXTERNAL_HUMAN_EDITOR' || loop.editing_compositing_mixing_mastering_are_out_of_scope !== true) {
    throw new ProductionUnitContractError('current LSU loop requires a reviewed binding contract')
  }
  return { hashes: Object.fromEntries([...sources].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])),
    definition: { id: 'IMAGO-V6-LSU', version: resolution.internal_contract_id, unitIdPattern: 'LSU[0-9]{2,}', scope: 'per_lsu', stages,
      operation: 'bind_existing_shot_group', planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0 } }
}

/**
 * Verify all compiler fields before signing the exact source and current method.
 * @param raw - untrusted subprocess output.
 * @param snapshot - fresh, rechecked group source sent to Core.
 * @param rules - current independently verified byte hashes and loop definition.
 * @param serialize - Python-compatible canonical JSON.
 * @param key - Host-only HMAC key validated by the existing method handler.
 * @returns method evidence; it does not allocate, bind, seal, approve, or execute a unit.
 */
export function attestProductionUnitMethod(
  raw: unknown, snapshot: ImagoProductionUnitMethodSnapshot, rules: ProductionUnitRules, serialize: Serialize, key: string,
): ImagoProductionUnitMethodResponse {
  const projection = exact(raw, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
  if (projection.schema !== 'qingmu.imago-production-unit-method.v1' || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.snapshotSha256 || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes) || projection.rulesSha256 !== digest(rules.hashes, serialize)) {
    throw new ProductionUnitContractError('compiler source, definition, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize)
  const unsigned = { schema: 'qingmu.imago-production-unit-method-attestation.v1' as const, algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.snapshotSha256, methodProjectionSha256: projectionSha256 }
  return { schema: 'qingmu.imago-production-unit-method-adapter-result.v1',
    projection: projection as unknown as ImagoProductionUnitMethodProjection, projectionSha256,
    methodAttestation: { ...unsigned, signature: createHmac('sha256', key).update(serialize(unsigned, 'unitMethodAttestation'), 'utf8').digest('hex') } }
}
