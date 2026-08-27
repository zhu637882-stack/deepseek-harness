/** Current A1S source-reference method; an episode script is not the global screenplay package. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengStageSource } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ImagoStageSourceMethodDefinition, ImagoStageSourceMethodProjection, ImagoStageSourceMethodRequest,
  ImagoStageSourceMethodResponse, ImagoStageSourceMethodSnapshot } from './types.ts'
import { WORKSET_RULE_PATHS } from './workset.ts'

/** Only these fixed local files may supply current rule evidence. */
export const STAGE_SOURCE_RULE_PATHS = [...WORKSET_RULE_PATHS,
  'scripts/compile_qingmu_element_method.py', 'scripts/compile_qingmu_stage_source_method.py',
] as const
type Serialize = (value: unknown, field: string) => string
/** Browser supplied anything other than the exact source-method coordinates. */
export class StageSourceInputError extends Error {}
/** Current source or machine-rule evidence cannot be verified. */
export class StageSourceContractError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StageSourceContractError('expected object')
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const raw = object(value)
  if (!isDeepStrictEqual(Object.keys(raw).sort(), [...keys].sort())) throw new StageSourceContractError('unexpected fields')
  return raw
}
function identifier(value: unknown): value is string {
  if (typeof value !== 'string' || !value.isWellFormed() || Array.from(value).length > 256 || /[\0\r\n]/u.test(value)) return false
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  return stripped !== '' && stripped === value
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/u.test(value)
}
function digest(value: unknown, serialize: Serialize): string {
  return createHash('sha256').update(serialize(value, 'stageSourceMethod'), 'utf8').digest('hex')
}

/** Accept only explicit A1S coordinates, never a browser-provided source or method.
 * @param payload - Untrusted RPC input.
 * @returns Canonical identifiers without normalization.
 */
export function parseStageSourceMethodRequest(payload: unknown): ImagoStageSourceMethodRequest {
  try {
    const raw = exact(payload, ['projectId', 'episodeId', 'stageId'])
    if (!identifier(raw.projectId) || !identifier(raw.episodeId) || raw.stageId !== 'A1S') throw new StageSourceInputError()
    return { projectId: raw.projectId, episodeId: raw.episodeId, stageId: 'A1S' }
  } catch {
    throw new StageSourceInputError('stageSourceMethod accepts only projectId, episodeId, and explicit stageId A1S')
  }
}

/** Construct source-only input from a fresh authoritative read, never from its historical binding.
 * @param request - Explicit method coordinates.
 * @param value - Current stageSources reader response.
 * @param serialize - Existing Python-compatible canonical serializer.
 * @returns A detached four-field compiler snapshot without script text or inferred approval.
 */
export function buildStageSourceSnapshot(
  request: ImagoStageSourceMethodRequest, value: unknown, serialize: Serialize,
): ImagoStageSourceMethodSnapshot {
  const feed = exact(value, ['schema', 'projectId', 'episodeId', 'stageId', 'canBind', 'source', 'subjectSnapshotSha256',
    'unavailableReason', 'bindingRevision', 'bindingSha256', 'latestBinding', 'currentBinding'])
  if (feed.schema !== 'jason.qingmu-stage-source-feed.v1' || feed.projectId !== request.projectId
    || feed.episodeId !== request.episodeId || feed.stageId !== request.stageId || typeof feed.canBind !== 'boolean'
    || feed.unavailableReason !== null || !sha(feed.subjectSnapshotSha256)) throw new StageSourceContractError('current script source is unavailable')
  const raw = exact(feed.source, ['schema', 'projectId', 'episodeId', 'sourceType', 'sourceId', 'revision', 'contentSha256'])
  if (raw.schema !== 'jason.qingmu-stage-source.v1' || raw.sourceType !== 'episode_script'
    || !identifier(raw.projectId) || !identifier(raw.episodeId) || !identifier(raw.sourceId)
    || raw.projectId !== request.projectId || raw.episodeId !== request.episodeId || raw.sourceId !== request.episodeId
    || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !sha(raw.contentSha256)) {
    throw new StageSourceContractError('invalid current script source')
  }
  const subject: YimengStageSource = { schema: raw.schema, projectId: raw.projectId, episodeId: raw.episodeId,
    sourceType: raw.sourceType, sourceId: raw.sourceId, revision: raw.revision, contentSha256: raw.contentSha256 }
  if (digest(subject, serialize) !== feed.subjectSnapshotSha256) throw new StageSourceContractError('source SHA mismatch')
  return { schema: 'qingmu.stage-source-method-snapshot.v1', stageId: 'A1S', subject, snapshotSha256: feed.subjectSnapshotSha256 }
}

/** Independently reconstructed method and exact current raw file digests. */
export interface StageSourceRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoStageSourceMethodDefinition
}

/** Check the active pointer and full A1S semantics against the same nine file buffers.
 * @param coreRoot - Configured local root; the browser cannot choose rule files.
 * @param serialize - Existing canonical serializer for contract digests.
 * @returns Current source-reference metadata, not a new execution DAG or stage instance.
 */
export async function readStageSourceRules(coreRoot: string, serialize: Serialize): Promise<StageSourceRules> {
  const sources = new Map(await Promise.all(STAGE_SOURCE_RULE_PATHS.map(
    async path => [path, await readFile(join(coreRoot, path))] as const,
  )))
  const json = (path: typeof STAGE_SOURCE_RULE_PATHS[number]): Record<string, unknown> => {
    const bytes = sources.get(path)
    if (bytes === undefined) throw new StageSourceContractError('missing rule source')
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
    || !Array.isArray(registry.channels) || registry.channels.length !== 1) throw new StageSourceContractError('current V6 pointer or registry mismatch')
  const channel = object(registry.channels[0])
  if (channel.channel_id !== 'V6_PRODUCTION_BETA' || channel.workflow_family !== 'V6'
    || channel.workflow_version !== resolution.internal_contract_id || channel.fallback !== false
    || channel.pre_v6_project_import_allowed !== false || channel.controller !== resolution.controller
    || channel.workflow_spec !== resolution.workflow_spec || spec.active !== true || spec.status !== 'PRODUCTION_BETA'
    || spec.workflow_version !== resolution.internal_contract_id || contractsDoc.schema_version !== '1.0.0-draft'
    || contractsDoc.workflow_version !== spec.workflow_version || !Array.isArray(contractsDoc.contracts)
    || contractsDoc.contracts.length !== 23
    || !Array.isArray(spec.stages) || spec.stages.length !== contractsDoc.contracts.length) throw new StageSourceContractError('current workflow binding mismatch')
  const ids = new Set<string>()
  let a1s: Record<string, unknown> | undefined
  for (const [index, value] of contractsDoc.contracts.entries()) {
    const contract = object(value)
    const stage = object(spec.stages[index])
    if (!identifier(contract.stage_id) || !identifier(contract.owner_role) || ids.has(contract.stage_id)
      || !sha(contract.contract_sha256) || (contract.scope !== 'global' && contract.scope !== 'per_lsu')
      || !Array.isArray(contract.required_source_stage_bindings) || !contract.required_source_stage_bindings.every(identifier)
      || !Array.isArray(contract.required_lock_bindings) || !contract.required_lock_bindings.every(identifier)
      || (contract.produces_lock !== null && !identifier(contract.produces_lock))) throw new StageSourceContractError('invalid current contract')
    const { contract_sha256: claimedSha, ...content } = contract
    if (digest(content, serialize) !== claimedSha) throw new StageSourceContractError('contract SHA mismatch')
    for (const [contractKey, specKey] of [['stage_id', 'id'], ['owner_role', 'owner_role'], ['scope', 'scope'],
      ['required_source_stage_bindings', 'depends_on'], ['required_lock_bindings', 'requires_locks'], ['produces_lock', 'produces_lock']] as const) {
      if (!Object.hasOwn(contract, contractKey) || !Object.hasOwn(stage, specKey)
        || !isDeepStrictEqual(contract[contractKey], stage[specKey])) {
        throw new StageSourceContractError('contract and workflow disagree')
      }
    }
    ids.add(contract.stage_id)
    if (contract.stage_id === 'A1S') a1s = contract
  }
  const expected = { scope: 'global', owner_role: 'A1S', artifact_kind: 'SCREENPLAY_PACKAGE', canonical_output: 'inputs/screenplay-package.json',
    evidence_mode: 'HUMAN_TEXT_PLUS_MACHINE_PACKAGE', required_source_stage_bindings: ['A1'], required_lock_bindings: ['ACCEPTANCE_LOCK'],
    produces_lock: 'SCRIPT_LOCK', permissions: ['write_screenplay', 'revise_dialogue'],
    required_content_sections: ['canon_snapshot', 'complete_screenplay', 'scene_causality', 'character_arcs', 'dialogue_and_subtext',
      'duration_evidence', 'rewrite_ledger', 'h1_h2_h3_decisions', 'source_fact_graph'] }
  if (a1s === undefined || !sha(a1s.contract_sha256)
    || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(a1s[key], value))) {
    throw new StageSourceContractError('current A1S method requires a reviewed source binding contract')
  }
  return { hashes: Object.fromEntries([...sources].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])),
    definition: { id: 'IMAGO-V6-A1S-SOURCE', version: resolution.internal_contract_id, stageId: 'A1S', roleId: 'A1S', scope: 'global',
      contractSha256: a1s.contract_sha256, artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
      sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
      stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 } }
}

/** Verify the subprocess projection before authenticating its provenance.
 * @param raw - Untrusted compiler output.
 * @param snapshot - Current source sent to Core and re-read after compilation.
 * @param rules - Independently checked current files and definition.
 * @param serialize - Existing canonical serializer.
 * @param key - Host-only method key, validated by the handler.
 * @returns Exact method evidence without artifact, lock, approval, or execution authority.
 */
export function attestStageSourceMethod(raw: unknown, snapshot: ImagoStageSourceMethodSnapshot, rules: StageSourceRules,
  serialize: Serialize, key: string): ImagoStageSourceMethodResponse {
  const projection = exact(raw, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
  if (projection.schema !== 'qingmu.imago-stage-source-method.v1' || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.snapshotSha256 || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes) || projection.rulesSha256 !== digest(rules.hashes, serialize)) {
    throw new StageSourceContractError('compiler source, definition, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize)
  const unsigned = { schema: 'qingmu.imago-stage-source-method-attestation.v1' as const, algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.snapshotSha256, methodProjectionSha256: projectionSha256 }
  return { schema: 'qingmu.imago-stage-source-method-adapter-result.v1', projection: projection as unknown as ImagoStageSourceMethodProjection,
    projectionSha256, methodAttestation: { ...unsigned,
      signature: createHmac('sha256', key).update(serialize(unsigned, 'stageSourceAttestation'), 'utf8').digest('hex') } }
}
