/** Bind current Yimeng continuity evidence to stateless, non-executing IMAGO methods. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengContinuityDeltaProjection, YimengShotRelationsStoryboardRevision } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  ImagoContinuityCandidateFinding,
  ImagoContinuityLockDefinition,
  ImagoContinuityMethodProjection,
  ImagoContinuityMethodRequest,
  ImagoContinuityMethodSnapshot,
  ImagoContinuityReworkPropagation,
  ImagoMethodJsonObject,
} from './types.ts'

/** Fixed source paths: compiler output cannot nominate another file or rule set. */
export const CONTINUITY_RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
  'pipeline/workflow-spec.v6.production-beta.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'agents/c5-execution-director/AGENTS.md',
  'skill-package/imago-c5-execution-storyboard/SKILL.md',
  'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
  'agents/lsu-dailies-qc/AGENTS.md',
  'skill-package/imago-lsu-dailies-qc/SKILL.md',
  'skill-package/imago-lsu-dailies-qc/references/lsu-dailies-standard.md',
  'scripts/compile_qingmu_continuity_method.py',
  'scripts/compile_qingmu_element_method.py',
] as const

/** Invalid identity-only browser request. */
export class ContinuityInputError extends Error {}

/** Invalid source or compiler projection; never recover by inventing authority. */
export class ContinuityContractError extends Error {}

/** Independently read definitions and the exact bytes that bind them. */
export interface ContinuityRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly locks: readonly ImagoContinuityLockDefinition[]
  readonly rework: readonly ImagoContinuityReworkPropagation[]
}

function object(value: unknown): value is ImagoMethodJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\u0000')
    && value.isWellFormed()
}

function identifier(value: unknown): value is string {
  return text(value) && value.length <= 256 && value.trim() === value && !/[\r\n]/.test(value)
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function exact(value: unknown, keys: readonly string[], field: string): asserts value is ImagoMethodJsonObject {
  if (!object(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new ContinuityContractError(`${field}: unexpected fields`)
  }
}

/**
 * Accept only identity; no workflow payload, approval, or executable action is accepted.
 * @param payload - untrusted browser request.
 * @returns the canonical selected Shot identifiers to resolve in the Host.
 */
export function parseContinuityMethodRequest(payload: unknown): ImagoContinuityMethodRequest {
  if (!object(payload) || !isDeepStrictEqual(Object.keys(payload).sort(), ['episodeId', 'projectId', 'selectedShotId'])
    || !identifier(payload.projectId) || !identifier(payload.episodeId) || !identifier(payload.selectedShotId)) {
    throw new ContinuityInputError('continuityMethod accepts only projectId, episodeId, and selectedShotId')
  }
  return { projectId: payload.projectId, episodeId: payload.episodeId, selectedShotId: payload.selectedShotId }
}

/**
 * Resolve a selected Shot against the freshly normalized, sole business authority.
 * @param request - identity-only browser input.
 * @param workflow - fresh configured Yimeng read result, never supplied by the browser.
 * @param serialize - the Host's deterministic finite-number JSON serializer.
 * @returns a read-only input bound to the full workflow and its exact adjacent evidence.
 */
export function buildContinuitySnapshot(
  request: ImagoContinuityMethodRequest,
  workflow: unknown,
  serialize: (value: unknown, field: string) => string,
): ImagoContinuityMethodSnapshot {
  if (!object(workflow) || workflow.schema !== 'jason.episode-workflow-projection.v1'
    || workflow.projectId !== request.projectId || workflow.episodeId !== request.episodeId
    || !object(workflow.sourceRevision) || !text(workflow.inputFingerprint) || !object(workflow.director)) {
    throw new ContinuityContractError('workflow subject or revision is unavailable')
  }
  const relations = workflow.director.shotRelations
  if (!object(relations) || relations.schema !== 'jason.scene-shot-beat-element-relations.v1'
    || relations.projectId !== request.projectId || relations.episodeId !== request.episodeId
    || relations.valid !== true || !Array.isArray(relations.shots)) {
    throw new ContinuityContractError('canonical Shot relations are unavailable')
  }
  exact(relations.storyboardRevision, ['episodeRevision', 'revisionId', 'revisionVersion', 'sourceSha256'], 'storyboardRevision')
  const revision = relations.storyboardRevision
  if (!Number.isSafeInteger(revision.episodeRevision) || Number(revision.episodeRevision) < 0
    || !Number.isSafeInteger(revision.revisionVersion) || Number(revision.revisionVersion) < 1
    || !identifier(revision.revisionId) || !sha(revision.sourceSha256)) {
    throw new ContinuityContractError('storyboard revision is invalid')
  }
  const shots = relations.shots.map((item) => {
    if (!object(item) || !identifier(item.shotId) || typeof item.frameNo !== 'number'
      || !Number.isSafeInteger(item.frameNo) || item.frameNo < 1) {
      throw new ContinuityContractError('canonical Shot identity or frameNo is invalid')
    }
    return { shotId: item.shotId, frameNo: item.frameNo }
  }).sort((left, right) => left.frameNo - right.frameNo)
  if (new Set(shots.map(item => item.shotId)).size !== shots.length
    || new Set(shots.map(item => item.frameNo)).size !== shots.length
    || !shots.some(item => item.shotId === request.selectedShotId)) {
    throw new ContinuityContractError('selected Shot is absent or the index is ambiguous')
  }
  const digest = (value: unknown, field: string): string => createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
  const source = workflow.director.continuityDelta
  let continuity: YimengContinuityDeltaProjection | null = null
  if (source !== undefined) {
    if (!object(source) || source.schema !== 'jason.qingmu-continuity-delta.v1'
      || source.projectId !== request.projectId || source.episodeId !== request.episodeId
      || !isDeepStrictEqual(source.storyboardRevision, revision) || !Array.isArray(source.pairs)
      || source.readOnly !== true || source.providerCalls !== 0 || source.taskMutation !== false
      || source.budgetMutation !== false || source.humanSignoffInferred !== false || !sha(source.snapshotSha256)) {
      throw new ContinuityContractError('continuity source or read-only boundary is invalid')
    }
    const { snapshotSha256, ...body } = source
    if (snapshotSha256 !== digest(body, 'continuityDelta')
      || (source.availability === 'unavailable' && (!text(source.reason) || source.pairs.length !== 0))
      || (source.availability === 'available' && (source.reason !== null || source.pairs.length !== Math.max(0, shots.length - 1)))
      || !['available', 'unavailable'].includes(String(source.availability))) {
      throw new ContinuityContractError('continuity source digest or availability is invalid')
    }
    for (const [index, pair] of source.pairs.entries()) {
      const from = shots[index]
      const to = shots[index + 1]
      if (!object(pair) || from === undefined || to === undefined
        || pair.fromShotId !== from.shotId || pair.toShotId !== to.shotId
        || pair.fromFrameNo !== from.frameNo || pair.toFrameNo !== to.frameNo) {
        throw new ContinuityContractError('continuity pair is not adjacent in current frameNo order')
      }
    }
    // The configured read adapter validates nested business facts; Core validates them again.
    continuity = source as unknown as YimengContinuityDeltaProjection
  }
  return {
    schema: 'qingmu.continuity-method-snapshot.v1',
    subject: { ...request, storyboardRevision: revision as unknown as YimengShotRelationsStoryboardRevision },
    shots,
    source_projection_sha256: digest(workflow, 'workflow'),
    source_revision_sha256: digest(workflow.sourceRevision, 'workflow.sourceRevision'),
    continuity,
  }
}

/**
 * Read fixed rule bytes and lock definitions without following compiler-supplied paths.
 * @param coreRoot - configured absolute current IMAGO Core root.
 * @returns locally verified hashes, lock definitions, and rework rules.
 */
export async function readContinuityRules(coreRoot: string): Promise<ContinuityRules> {
  const sources = await Promise.all(CONTINUITY_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const))
  const hashes = Object.fromEntries(sources.map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
  const specBytes = sources.find(([path]) => path === 'pipeline/workflow-spec.v6.production-beta.json')?.[1]
  if (specBytes === undefined) throw new ContinuityContractError('lock definition source is missing')
  const spec: unknown = JSON.parse(specBytes.toString('utf8'))
  if (!object(spec) || !Array.isArray(spec.locks) || !Array.isArray(spec.rework_propagation)) {
    throw new ContinuityContractError('lock definitions or propagation rules are missing')
  }
  const locks = spec.locks.map((item) => {
    exact(item, ['id', 'producer_stage'], 'lock definition')
    if (!identifier(item.id) || !identifier(item.producer_stage)) throw new ContinuityContractError('invalid lock definition')
    return { id: item.id, producer_stage: item.producer_stage }
  })
  const rework = spec.rework_propagation.map((item) => {
    exact(item, ['changed_lock', 'invalidates_from', 'scope'], 'rework propagation')
    if (!identifier(item.changed_lock) || !identifier(item.invalidates_from) || !identifier(item.scope)
      || !locks.some(lock => lock.id === item.changed_lock)) throw new ContinuityContractError('invalid rework propagation')
    return { changed_lock: item.changed_lock, invalidates_from: item.invalidates_from, scope: item.scope }
  })
  if (locks.length === 0 || new Set(locks.map(item => item.id)).size !== locks.length
    || new Set(rework.map(item => item.changed_lock)).size !== rework.length) {
    throw new ContinuityContractError('ambiguous lock definitions')
  }
  return { hashes, locks, rework }
}

/**
 * Independently reject changed pairs, fabricated findings, lock instances, or authority.
 * @param value - decoded compiler stdout.
 * @param snapshot - exact Host-owned input to that compiler.
 * @param rules - independently read fixed local sources.
 * @param serialize - deterministic serializer used on compiler stdin.
 * @returns a bounded selected-Shot projection with no approval or execution capability.
 */
export function normalizeContinuityProjection(
  value: unknown,
  snapshot: ImagoContinuityMethodSnapshot,
  rules: ContinuityRules,
  serialize: (value: unknown, field: string) => string,
): ImagoContinuityMethodProjection {
  exact(value, [
    'schema', 'subject', 'selected_shot', 'source_projection_sha256', 'source_revision_sha256',
    'input_snapshot_sha256', 'continuity_snapshot_sha256', 'rule_bindings', 'rules_sha256',
    'availability', 'adjacent_pairs', 'candidate_findings', 'lock_definitions', 'rework_propagation',
    'lock_authority', 'field_help', 'checklist', 'work_order', 'read_only', 'provider_calls',
    'task_mutation', 'budget_mutation', 'human_signoff_inferred', 'project_state_persisted', 'formal_activation_allowed',
  ], 'continuity projection')
  const digest = (input: unknown, field: string): string => createHash('sha256').update(serialize(input, field), 'utf8').digest('hex')
  const selected = snapshot.shots.find(shot => shot.shotId === snapshot.subject.selectedShotId)
  if (selected === undefined || value.schema !== 'qingmu.imago-continuity-method-projection.v1'
    || !isDeepStrictEqual(value.subject, snapshot.subject) || !isDeepStrictEqual(value.selected_shot, selected)
    || value.source_projection_sha256 !== snapshot.source_projection_sha256
    || value.source_revision_sha256 !== snapshot.source_revision_sha256
    || value.input_snapshot_sha256 !== digest(snapshot, 'snapshot')
    || value.continuity_snapshot_sha256 !== (snapshot.continuity?.snapshotSha256 ?? null)
    || !isDeepStrictEqual(value.rule_bindings, rules.hashes) || value.rules_sha256 !== digest(rules.hashes, 'rule_bindings')) {
    throw new ContinuityContractError('continuity input or current-rule binding mismatch')
  }
  const pairs = snapshot.continuity?.pairs ?? []
  const incoming = pairs.find(pair => pair.toShotId === selected.shotId) ?? null
  const outgoing = pairs.find(pair => pair.fromShotId === selected.shotId) ?? null
  const findings: ImagoContinuityCandidateFinding[] = []
  for (const pair of [incoming, outgoing]) {
    if (pair === null) continue
    const binding = pair.currentBinding
    const current = pair.bindingStatus === 'current' && binding.tailFromSelectedVideo && binding.nextFirstFrameSelected
      && !binding.nextFirstFrameStale && !binding.staleHandoff
    for (const dimension of pair.audit.dimensions) {
      if (dimension.result !== false) continue
      findings.push({
        from_shot_id: pair.fromShotId, to_shot_id: pair.toShotId, dimension: dimension.dimension,
        reason: dimension.reason, check_id: pair.audit.checkId, evidence_ref: pair.audit.evidenceRef,
        evidence_scope: current ? 'current' : pair.bindingStatus === 'different' ? 'historical' : 'unavailable',
        severity: null, earliest_owner: null, timecode: null, attribution: 'pending', formal_finding: false,
      })
    }
  }
  const availability = snapshot.continuity === null
    ? { status: 'unavailable', reason: 'continuity_evidence_unavailable' }
    : { status: snapshot.continuity.availability, reason: snapshot.continuity.reason }
  if (!isDeepStrictEqual(value.adjacent_pairs, { incoming, outgoing })
    || !isDeepStrictEqual(value.candidate_findings, findings) || !isDeepStrictEqual(value.availability, availability)
    || !isDeepStrictEqual(value.lock_definitions, rules.locks) || !isDeepStrictEqual(value.rework_propagation, rules.rework)
    || !isDeepStrictEqual(value.lock_authority, {
      status: 'unavailable', reason: 'authoritative_lock_instances_unavailable', instances: [],
    })) {
    throw new ContinuityContractError('continuity evidence, candidate finding, or lock authority mismatch')
  }
  for (const [field, keys, id] of [
    ['field_help', ['field', 'label', 'help', 'source_paths'], 'field'],
    ['checklist', ['id', 'label', 'source_paths'], 'id'],
  ] as const) {
    const items = value[field]
    if (!Array.isArray(items) || items.length === 0) throw new ContinuityContractError(`${field}: current guidance is missing`)
    const ids = new Set<string>()
    for (const item of items) {
      exact(item, keys, field)
      if (!identifier(item[id]) || ids.has(item[id]) || !text(item.label)
        || (field === 'field_help' && !text(item.help)) || !Array.isArray(item.source_paths)
        || item.source_paths.length === 0 || new Set(item.source_paths).size !== item.source_paths.length
        || !item.source_paths.every(path => typeof path === 'string' && Object.hasOwn(rules.hashes, path))) {
        throw new ContinuityContractError(`${field}: invalid or unbound guidance`)
      }
      ids.add(item[id])
    }
  }
  if (!isDeepStrictEqual(value.work_order, {
    mode: 'read_only',
    allowed_actions: ['inspect_current_binding', 'inspect_historical_audit', 'review_candidate_findings', 'inspect_lock_definitions'],
    allowed_mutations: [], requires_human_attribution: true, provider_calls: 0, task_mutation: false,
    budget_mutation: false, human_signoff_inferred: false,
  }) || value.read_only !== true || value.provider_calls !== 0 || value.task_mutation !== false
    || value.budget_mutation !== false || value.human_signoff_inferred !== false
    || value.project_state_persisted !== false || value.formal_activation_allowed !== false) {
    throw new ContinuityContractError('continuity projection cannot grant execution or human signoff')
  }
  return value as ImagoContinuityMethodProjection
}
