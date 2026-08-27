/** Current IMAGO Finding form compiled for a freshly read Yimeng-selected video. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengShotVideoSubject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { CONTINUITY_RULE_PATHS } from './continuity.ts'
import type {
  ImagoShotFindingMethodDefinition, ImagoShotFindingMethodProjection, ImagoShotFindingMethodRequest,
  ImagoShotFindingMethodResponse, ImagoShotFindingMethodSnapshot,
} from './types.ts'

/** Fixed current sources; compiler output cannot nominate an arbitrary path. */
export const SHOT_FINDING_RULE_PATHS = [...CONTINUITY_RULE_PATHS,
  'skill-package/imago-lsu-dailies-qc/scripts/validate_lsu_qc.py',
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json', 'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_shot_finding_method.py',
] as const
const FIELDS = ['timecode', 'observation', 'evidenceRefs', 'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope']
type Serialize = (value: unknown, field: string) => string

/** Browser payload exceeds the identity-only request. */
export class ShotFindingInputError extends Error {}
/** Source or method mismatch; no fallback Owner, approval, or execution is invented. */
export class ShotFindingContractError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ShotFindingContractError('expected object')
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const item = object(value)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...keys].sort())) throw new ShotFindingContractError('unexpected fields')
  return item
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
function digest(value: unknown, serialize: Serialize): string {
  return createHash('sha256').update(serialize(value, 'shotFinding'), 'utf8').digest('hex')
}

/**
 * Accept only canonical coordinates, never an uploaded workflow or method source.
 * @param payload - untrusted browser input.
 * @returns three validated identifiers.
 */
export function parseShotFindingMethodRequest(payload: unknown): ImagoShotFindingMethodRequest {
  try {
    const value = exact(payload, ['projectId', 'episodeId', 'frameId'])
    if (!identifier(value.projectId) || !identifier(value.episodeId) || !identifier(value.frameId)) throw new ShotFindingInputError()
    return { projectId: value.projectId, episodeId: value.episodeId, frameId: value.frameId }
  } catch {
    throw new ShotFindingInputError('shotFindingMethod accepts only projectId, episodeId, and frameId')
  }
}

/**
 * Bind the form to fresh business facts from the configured read capability.
 * @param request - identity-only request.
 * @param source - freshly normalized Finding feed from Yimeng, not from the browser.
 * @param serialize - Python-compatible canonical JSON.
 * @returns one subject snapshot suitable for the stateless compiler.
 */
export function buildShotFindingSnapshot(
  request: ImagoShotFindingMethodRequest, source: unknown, serialize: Serialize,
): ImagoShotFindingMethodSnapshot {
  const feed = object(source)
  if (feed.schema !== 'jason.qingmu-shot-finding-feed.v1' || feed.projectId !== request.projectId
    || feed.episodeId !== request.episodeId || feed.frameId !== request.frameId
    || object(feed.availability).status !== 'available' || object(feed.availability).reason !== null) {
    throw new ShotFindingContractError('current selected video is unavailable')
  }
  const subject = exact(feed.subject, ['schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
    'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256'])
  if (subject.schema !== 'jason.qingmu-shot-video-subject.v1' || subject.projectId !== request.projectId
    || subject.episodeId !== request.episodeId || subject.frameId !== request.frameId || !identifier(subject.assetId)
    || !sha(subject.frameContentSha256) || !sha(subject.assetSha256)) throw new ShotFindingContractError('subject mismatch')
  for (const key of ['frameNo', 'storyboardRevision', 'assetVersion']) {
    if (typeof subject[key] !== 'number' || !Number.isSafeInteger(subject[key]) || subject[key] < (key === 'frameNo' ? 1 : 0)) {
      throw new ShotFindingContractError('invalid subject integer')
    }
  }
  if (!sha(feed.snapshotSha256) || feed.snapshotSha256 !== digest(subject, serialize)) throw new ShotFindingContractError('subject SHA mismatch')
  return { schema: 'qingmu.shot-finding-method-snapshot.v1', subject: subject as unknown as YimengShotVideoSubject,
    snapshotSha256: feed.snapshotSha256 }
}

/** Independently read current form definition and source hashes. */
export interface ShotFindingRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoShotFindingMethodDefinition
}

/**
 * Read fixed files and intersect declared defect Owners with the active workflow.
 * @param coreRoot - configured local Core root, never a browser path.
 * @returns independently reconstructed Owner options and exact source byte hashes.
 */
export async function readShotFindingRules(coreRoot: string): Promise<ShotFindingRules> {
  const sources = new Map(await Promise.all(
    SHOT_FINDING_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const),
  ))
  const bytes = (path: typeof SHOT_FINDING_RULE_PATHS[number]): Buffer => {
    const result = sources.get(path)
    if (result === undefined) throw new ShotFindingContractError('current rule source missing')
    return result
  }
  const json = (path: typeof SHOT_FINDING_RULE_PATHS[number]) => object(JSON.parse(bytes(path).toString('utf8')) as unknown)
  const validator = bytes('skill-package/imago-lsu-dailies-qc/scripts/validate_lsu_qc.py').toString('utf8')
  const literals = [...validator.matchAll(/^VALID_OWNERS\s*=\s*\{([\s\S]*?)^\}/gm)]
  if (literals.length !== 1 || literals[0]?.[1] === undefined) throw new ShotFindingContractError('current Owner contract is unavailable')
  // Parse only the current JSON-compatible literal, never import/evaluate Python code.
  const owners: unknown = JSON.parse(`[${literals[0][1].replace(/,\s*$/, '')}]`)
  if (!Array.isArray(owners) || owners.length === 0 || !owners.every(identifier) || new Set(owners).size !== owners.length) {
    throw new ShotFindingContractError('invalid current Owner contract')
  }
  const spec = json('pipeline/workflow-spec.v6.production-beta.json')
  const contracts = json('pipeline/v6-stage-contracts.json')
  const roles = json('pipeline/role-capability-spec.v6.json')
  if (!Array.isArray(spec.stages) || !Array.isArray(contracts.contracts) || !Array.isArray(roles.roles)) {
    throw new ShotFindingContractError('current workflow contracts are unavailable')
  }
  const stageContracts = new Map(contracts.contracts.map((value) => { const item = object(value); return [item.stage_id, item] }))
  const roleIds = new Set(roles.roles.map(value => object(value).id))
  const ownerOptions: ImagoShotFindingMethodDefinition['ownerOptions'][number][] = []
  for (const raw of spec.stages) {
    const stage = object(raw)
    if (!identifier(stage.id)) throw new ShotFindingContractError('invalid current stage identifier')
    if (!owners.includes(stage.id)) continue
    const contract = stageContracts.get(stage.id)
    if (!identifier(stage.id) || !identifier(stage.owner_role) || !roleIds.has(stage.owner_role)
      || (stage.scope !== 'global' && stage.scope !== 'per_lsu')
      || contract?.owner_role !== stage.owner_role || contract.scope !== stage.scope) {
      throw new ShotFindingContractError('Owner stage and role contract mismatch')
    }
    ownerOptions.push({ stageId: stage.id, roleId: stage.owner_role, scope: stage.scope })
  }
  const policy = json('pipeline/v6-lsuqc-provider-neutral-review-policy.json')
  if (ownerOptions.length === 0 || new Set(ownerOptions.map(item => item.stageId)).size !== ownerOptions.length
    || policy.schema !== 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1'
    || object(policy.accepted_inputs).current_decision_schema_version !== '2.1.0'
    || object(policy.review_state_machine).automatic_content_decision !== false
    || object(policy.decision_contract).bounded_rework_and_earliest_owner_required !== true
    || !bytes('docs/qingmu-os/report-source.md').toString('utf8').includes('Finding Contract：对象、问题、证据、Owner、严重度、建议')) {
    throw new ShotFindingContractError('current Finding boundary is unavailable')
  }
  return { hashes: Object.fromEntries([...sources].map(([path, raw]) => [path, createHash('sha256').update(raw).digest('hex')])),
    definition: { requiredFields: FIELDS, severities: ['BLOCKER', 'MAJOR', 'MINOR'], ownerOptions,
      statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false } }
}

/**
 * Verify every compiler field before creating a method-origin attestation.
 * @param raw - untrusted subprocess output.
 * @param snapshot - fresh Yimeng subject used as compiler input.
 * @param rules - independently read current source hashes and form definition.
 * @param serialize - canonical JSON serializer shared with the existing adapter.
 * @param key - server-only HMAC key, never serialized to the client.
 * @returns a method response; no finding, approval, or rework is performed.
 */
export function attestShotFindingMethod(
  raw: unknown, snapshot: ImagoShotFindingMethodSnapshot, rules: ShotFindingRules, serialize: Serialize, key: string,
): ImagoShotFindingMethodResponse {
  const projection = exact(raw, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
  if (projection.schema !== 'qingmu.imago-shot-finding-method.v1' || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.snapshotSha256 || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes) || projection.rulesSha256 !== digest(rules.hashes, serialize)) {
    throw new ShotFindingContractError('compiler subject, definition, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize)
  const unsigned = { schema: 'qingmu.imago-shot-finding-method-attestation.v1' as const, algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.snapshotSha256, methodProjectionSha256: projectionSha256 }
  return { schema: 'qingmu.imago-shot-finding-method-adapter-result.v1',
    projection: projection as unknown as ImagoShotFindingMethodProjection, projectionSha256,
    methodAttestation: { ...unsigned, signature: createHmac('sha256', key).update(serialize(unsigned, 'findingAttestation'), 'utf8').digest('hex') } }
}
