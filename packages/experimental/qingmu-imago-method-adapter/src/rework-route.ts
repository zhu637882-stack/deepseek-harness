/** Compile one current bounded rework route without writing or executing it. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengReworkRouteSubject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { readLsuPlanRules, LSU_PLAN_RULE_PATHS } from './lsu-plan.ts'
import { readShotFindingRules, SHOT_FINDING_RULE_PATHS } from './shot-finding.ts'
import type {
  ImagoReworkRouteInstruction,
  ImagoReworkRouteMethodDefinition,
  ImagoReworkRouteMethodProjection,
  ImagoReworkRouteMethodRequest,
  ImagoReworkRouteMethodResponse,
  ImagoReworkRouteMethodSnapshot,
} from './types.ts'

const ROUTING_POLICY_PATH = 'pipeline/v6-lsuqc-completion-routing-policy.json'
const PLAN_PATH = 'docs/qingmu-os/report-source.md'
const COMPILER_PATH = 'scripts/compile_qingmu_rework_route_method.py'

/** Exact fixed current sources consumed by the Core rework-route compiler. */
export const REWORK_ROUTE_RULE_PATHS = [
  ...new Set([...SHOT_FINDING_RULE_PATHS, ...LSU_PLAN_RULE_PATHS, ROUTING_POLICY_PATH, PLAN_PATH, COMPILER_PATH]),
] as const

type Serialize = (value: unknown, field: string) => string

/** Browser input exceeds the four route coordinates. */
export class ReworkRouteInputError extends Error {}
/** Current source, Core rules, or compiler output cannot be proven exact. */
export class ReworkRouteContractError extends Error {}

function object(value: unknown, field = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReworkRouteContractError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, fields: readonly string[], field = 'value'): Record<string, unknown> {
  const item = object(value, field)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...fields].sort())) {
    throw new ReworkRouteContractError(`${field} fields mismatch`)
  }
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value !== '' && value === pythonStrip(value)
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/u.test(value)
}

function boundedText(value: unknown, maximum = 8_000): value is string {
  return typeof value === 'string' && value.isWellFormed() && pythonStrip(value) !== ''
    && !value.includes('\u0000') && Array.from(value).length <= maximum
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function digest(value: unknown, serialize: Serialize, field: string): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

/** Accept only the four business coordinates; all source and rule facts are Host-derived. */
export function parseReworkRouteMethodRequest(payload: unknown): ImagoReworkRouteMethodRequest {
  try {
    const item = exact(payload, ['projectId', 'episodeId', 'frameId', 'findingId'], 'reworkRouteMethod')
    if (!identifier(item.projectId) || !identifier(item.episodeId)
      || !identifier(item.frameId) || !identifier(item.findingId)) throw new ReworkRouteInputError()
    return { projectId: item.projectId, episodeId: item.episodeId, frameId: item.frameId, findingId: item.findingId }
  } catch {
    throw new ReworkRouteInputError('reworkRouteMethod accepts only projectId, episodeId, frameId, and findingId')
  }
}

function normalizeSubject(
  value: unknown, request: ImagoReworkRouteMethodRequest, serialize: Serialize,
): YimengReworkRouteSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'selectedVideo', 'finding', 'productionUnit', 'sealedPlan',
  ], 'reworkRouteSubject')
  if (item.schema !== 'jason.qingmu-bounded-rework-route-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId) {
    throw new ReworkRouteContractError('route subject coordinates mismatch')
  }
  const selected = exact(item.selectedVideo, [
    'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
    'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256',
  ], 'reworkRouteSubject.selectedVideo')
  if (selected.schema !== 'jason.qingmu-shot-video-subject.v1' || selected.projectId !== request.projectId
    || selected.episodeId !== request.episodeId || selected.frameId !== request.frameId
    || !integer(selected.frameNo, 1) || !integer(selected.storyboardRevision) || !integer(selected.assetVersion)
    || !sha(selected.frameContentSha256) || !identifier(selected.assetId) || !sha(selected.assetSha256)) {
    throw new ReworkRouteContractError('selected video mismatch')
  }
  const finding = exact(item.finding, [
    'id', 'eventId', 'subjectSnapshotSha256', 'timecode', 'observation', 'evidenceRefs', 'earliestOwner',
    'ownerReason', 'severity', 'suggestion', 'reworkScope', 'status', 'methodProjectionSha256', 'rulesSha256',
  ], 'reworkRouteSubject.finding')
  if (finding.id !== request.findingId || !identifier(finding.eventId) || finding.status !== 'OPEN'
    || finding.subjectSnapshotSha256 !== digest(selected, serialize, 'selectedVideo')
    || !sha(finding.methodProjectionSha256) || !sha(finding.rulesSha256) || !identifier(finding.earliestOwner)
    || !boundedText(finding.timecode, 128) || !boundedText(finding.observation)
    || !boundedText(finding.ownerReason) || !boundedText(finding.suggestion) || !boundedText(finding.reworkScope)
    || !['BLOCKER', 'MAJOR', 'MINOR'].includes(String(finding.severity))
    || !Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.length < 1 || finding.evidenceRefs.length > 32
    || !finding.evidenceRefs.every(entry => boundedText(entry, 1_024))) {
    throw new ReworkRouteContractError('OPEN Finding mismatch')
  }
  const production = exact(item.productionUnit, [
    'unitId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256', 'source',
  ], 'reworkRouteSubject.productionUnit')
  const source = exact(production.source, [
    'schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title', 'groupExecutionPromptSha256',
    'storyboardRevision', 'shots',
  ], 'reworkRouteSubject.productionUnit.source')
  if (!identifier(production.unitId) || !/^LSU[0-9]{2,}$/u.test(production.unitId)
    || !integer(production.bindingRevision, 1) || !sha(production.bindingSha256) || !sha(production.sourceSnapshotSha256)
    || source.schema !== 'jason.qingmu-production-unit-source.v1' || source.projectId !== request.projectId
    || source.episodeId !== request.episodeId || !identifier(source.groupId) || !integer(source.groupNo, 1)
    || !boundedText(source.title) || !sha(source.groupExecutionPromptSha256) || !integer(source.storyboardRevision)
    || !Array.isArray(source.shots) || source.shots.length === 0
    || production.sourceSnapshotSha256 !== digest(source, serialize, 'productionUnitSource')) {
    throw new ReworkRouteContractError('production unit mismatch')
  }
  let matches = 0
  let previousFrameNo = 0
  const seenFrames = new Set<string>()
  for (const raw of source.shots) {
    const shot = exact(raw, ['frameId', 'frameNo', 'frameContentSha256'], 'productionUnitSource.shot')
    if (!identifier(shot.frameId) || !integer(shot.frameNo, 1) || !sha(shot.frameContentSha256)
      || seenFrames.has(shot.frameId) || shot.frameNo <= previousFrameNo) {
      throw new ReworkRouteContractError('production unit Shot order mismatch')
    }
    seenFrames.add(shot.frameId)
    previousFrameNo = shot.frameNo
    if (shot.frameId === selected.frameId && shot.frameNo === selected.frameNo
      && shot.frameContentSha256 === selected.frameContentSha256) matches += 1
  }
  if (matches !== 1) throw new ReworkRouteContractError('Finding Shot membership mismatch')
  const sealed = exact(item.sealedPlan, [
    'revision', 'sealSha256', 'subjectSnapshotSha256', 'methodProjectionSha256', 'rulesSha256',
    'lockRulesSha256', 'subject',
  ], 'reworkRouteSubject.sealedPlan')
  const plan = exact(sealed.subject, [
    'schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock',
  ], 'reworkRouteSubject.sealedPlan.subject')
  if (!integer(sealed.revision, 1) || !sha(sealed.sealSha256) || !sha(sealed.subjectSnapshotSha256)
    || !sha(sealed.methodProjectionSha256) || !sha(sealed.rulesSha256) || !sha(sealed.lockRulesSha256)
    || plan.schema !== 'jason.qingmu-lsu-plan-subject.v1' || plan.projectId !== request.projectId
    || plan.episodeId !== request.episodeId || !Array.isArray(plan.productionUnits) || plan.productionUnits.length === 0
    || sealed.subjectSnapshotSha256 !== digest(plan, serialize, 'sealedPlanSubject')) {
    throw new ReworkRouteContractError('sealed LSU plan mismatch')
  }
  const identities = plan.productionUnits.map(raw => exact(raw, [
    'unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256',
  ], 'sealedPlanSubject.productionUnit'))
  for (const unit of identities) {
    if (!identifier(unit.unitId) || !/^LSU[0-9]{2,}$/u.test(unit.unitId) || !identifier(unit.groupId)
      || !integer(unit.bindingRevision, 1) || !sha(unit.bindingSha256) || !sha(unit.sourceSnapshotSha256)) {
      throw new ReworkRouteContractError('sealed LSU plan unit mismatch')
    }
  }
  if (identities.filter(unit => unit.unitId === production.unitId && unit.groupId === source.groupId
    && unit.bindingRevision === production.bindingRevision && unit.bindingSha256 === production.bindingSha256
    && unit.sourceSnapshotSha256 === production.sourceSnapshotSha256).length !== 1) {
    throw new ReworkRouteContractError('production unit is not in sealed LSU plan')
  }
  const lock = exact(plan.productionBlueprintLock, [
    'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
  ], 'sealedPlanSubject.productionBlueprintLock')
  if (lock.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || lock.stageId !== 'C5F' || lock.scopeInstance !== 'GLOBAL'
    || !integer(lock.artifactRecordRevision, 1) || !sha(lock.artifactRecordSha256)
    || !identifier(lock.decisionId) || !sha(lock.eventSha256)) {
    throw new ReworkRouteContractError('sealed LSU plan lock mismatch')
  }
  return JSON.parse(serialize(item, 'reworkRouteSubject')) as YimengReworkRouteSubject
}

/** Build the Core snapshot only from a fresh feed bound to all three current rule generations. */
export function buildReworkRouteSnapshot(
  request: ImagoReworkRouteMethodRequest,
  value: unknown,
  expected: { readonly routeRulesSha256: string; readonly planRulesSha256: string; readonly lockRulesSha256: string },
  serialize: Serialize,
): ImagoReworkRouteMethodSnapshot {
  const feed = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'findingId', 'capabilities', 'subject',
    'subjectSnapshotSha256', 'availability', 'latestRoute', 'latestRouteSourceCurrent',
    'currentRouteRulesSha256', 'currentPlanRulesSha256', 'currentLockRulesSha256', 'findingClosed',
    'selectionChanged', 'stageDecisionChanged', 'lockInvalidated', 'taskCreated', 'providerCalls',
    'reworkExecuted', 'humanSignoffInferred',
  ], 'reworkRouteSource')
  const availability = exact(feed.availability, ['status', 'reason'], 'reworkRouteSource.availability')
  const capabilities = exact(feed.capabilities, ['canRecordRoute'], 'reworkRouteSource.capabilities')
  if (feed.schema !== 'jason.qingmu-bounded-rework-route-feed.v1' || feed.projectId !== request.projectId
    || feed.episodeId !== request.episodeId || feed.frameId !== request.frameId || feed.findingId !== request.findingId
    || feed.currentRouteRulesSha256 !== expected.routeRulesSha256
    || feed.currentPlanRulesSha256 !== expected.planRulesSha256 || feed.currentLockRulesSha256 !== expected.lockRulesSha256
    || availability.status !== 'available' || availability.reason !== null || typeof capabilities.canRecordRoute !== 'boolean'
    || feed.subject === null || !sha(feed.subjectSnapshotSha256) || typeof feed.latestRouteSourceCurrent !== 'boolean'
    || feed.findingClosed !== false || feed.selectionChanged !== false || feed.stageDecisionChanged !== false
    || feed.lockInvalidated !== false || feed.taskCreated !== false || feed.providerCalls !== 0
    || feed.reworkExecuted !== false || feed.humanSignoffInferred !== false) {
    throw new ReworkRouteContractError('current bounded rework route source is unavailable')
  }
  const subject = normalizeSubject(feed.subject, request, serialize)
  if (digest(subject, serialize, 'reworkRouteSubject') !== feed.subjectSnapshotSha256) {
    throw new ReworkRouteContractError('current route subject SHA mismatch')
  }
  const snapshot: ImagoReworkRouteMethodSnapshot = {
    schema: 'qingmu.rework-route-method-snapshot.v1', subject,
    subjectSnapshotSha256: feed.subjectSnapshotSha256,
  }
  if (Buffer.byteLength(serialize(snapshot, 'reworkRouteSnapshot'), 'utf8') > 1024 * 1024) {
    throw new ReworkRouteContractError('current route source exceeds Core input limit')
  }
  return snapshot
}

/** Independently reconstructed exact route Method and fixed source hashes. */
export interface ReworkRouteRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly lockHashes: Readonly<Record<string, string>>
  readonly definition: ImagoReworkRouteMethodDefinition
  readonly routeInstruction: ImagoReworkRouteInstruction
}

/** Current fixed Core sources before any project Finding is bound to them. */
export interface ReworkRouteRuleSources {
  readonly hashes: Readonly<Record<string, string>>
  readonly lockHashes: Readonly<Record<string, string>>
  readonly routeRulesSha256: string
  readonly planRulesSha256: string
  readonly lockRulesSha256: string
  readonly findingRulesSha256: string
  readonly policyVersion: string
  readonly ownerOptions: readonly {
    readonly stageId: string
    readonly roleId: string
    readonly scope: 'global' | 'per_lsu'
  }[]
}

function subset(hashes: Readonly<Record<string, string>>, paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => {
    const value = hashes[path]
    if (value === undefined) throw new ReworkRouteContractError('missing current route rule hash')
    return [path, value]
  }))
}

/** Read the fixed Core source union before asking Yimeng for the SHA-bound project source. */
export async function readReworkRouteRuleSources(
  coreRoot: string, serialize: Serialize,
): Promise<ReworkRouteRuleSources> {
  try {
    const [findingRules, planRules, sources] = await Promise.all([
      readShotFindingRules(coreRoot),
      readLsuPlanRules(coreRoot, serialize),
      Promise.all(REWORK_ROUTE_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const)),
    ])
    const hashes = Object.fromEntries(sources.map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
    if (!isDeepStrictEqual(subset(hashes, SHOT_FINDING_RULE_PATHS), findingRules.hashes)
      || !isDeepStrictEqual(subset(hashes, LSU_PLAN_RULE_PATHS), planRules.hashes)
      || !isDeepStrictEqual(subset(hashes, Object.keys(planRules.lockHashes)), planRules.lockHashes)) {
      throw new ReworkRouteContractError('reviewed route rule reconstruction mismatch')
    }
    const policyBytes = sources.find(([path]) => path === ROUTING_POLICY_PATH)?.[1]
    const planBytes = sources.find(([path]) => path === PLAN_PATH)?.[1]
    if (policyBytes === undefined || planBytes === undefined) throw new ReworkRouteContractError('route policy is unavailable')
    const policy = object(JSON.parse(policyBytes.toString('utf8')) as unknown, 'routePolicy')
    const rework = object(policy.rework_branch, 'routePolicy.rework_branch')
    const planText = planBytes.toString('utf8')
    if (policy.schema !== 'IMAGO-V6-LSUQCCompletionRoutingPolicy-v1'
      || rework.output_schema !== 'IMAGO-V6-BoundedReworkRoute-v1' || rework.output_state !== 'BOUNDED_REWORK_ROUTED'
      || rework.open_defect_required !== true || rework.one_earliest_owner_per_defect !== true
      || rework.timecode_evidence_and_scope_required !== true || rework.group_by_earliest_owner !== true
      || rework.paid_generation_authorized !== false || rework.automatic_retry !== false
      || rework.provider_change_authorized !== false || rework.unbounded_redo_forbidden !== true
      || rework.completion_release_forbidden !== true || !identifier(policy.policy_version)
      || !planText.includes('IMAGO 将缺陷路由到最早责任岗位')
      || !planText.includes('自行持久化 StageInstance、WorkOrderExecution')) {
      throw new ReworkRouteContractError('current bounded route policy is unavailable')
    }
    const currentFindingRulesSha256 = digest(findingRules.hashes, serialize, 'findingRules')
    return {
      hashes,
      lockHashes: planRules.lockHashes,
      routeRulesSha256: digest(hashes, serialize, 'reworkRouteRules'),
      planRulesSha256: digest(planRules.hashes, serialize, 'lsuPlanRules'),
      lockRulesSha256: digest(planRules.lockHashes, serialize, 'lsuPlanLockRules'),
      findingRulesSha256: currentFindingRulesSha256,
      policyVersion: policy.policy_version,
      ownerOptions: findingRules.definition.ownerOptions,
    }
  } catch (error) {
    if (error instanceof ReworkRouteContractError) throw error
    throw new ReworkRouteContractError('current bounded route rules are unavailable')
  }
}

/** Bind one fresh OPEN Finding to the already-read current Core source generation. */
export function bindReworkRouteRules(
  sources: ReworkRouteRuleSources, subject: YimengReworkRouteSubject,
): ReworkRouteRules {
  if (subject.sealedPlan.rulesSha256 !== sources.planRulesSha256
    || subject.sealedPlan.lockRulesSha256 !== sources.lockRulesSha256) {
    throw new ReworkRouteContractError('sealed LSU plan is not current')
  }
  const owner = sources.ownerOptions.find(option => option.stageId === subject.finding.earliestOwner)
  if (owner === undefined) throw new ReworkRouteContractError('Finding earliest Owner is not current')
  const definition: ImagoReworkRouteMethodDefinition = {
    id: 'IMAGO-V6-BOUNDED-REWORK-ROUTE', version: sources.policyVersion, scope: 'per_finding',
    operation: 'record_bounded_rework_route', requiredFindingStatus: 'OPEN',
    oneEarliestOwnerPerFinding: true, groupByEarliestOwner: true, timecodeEvidenceAndScopeRequired: true,
    findingRuleComparison: {
      recordedRulesSha256: subject.finding.rulesSha256, currentRulesSha256: sources.findingRulesSha256,
      changed: subject.finding.rulesSha256 !== sources.findingRulesSha256, effect: 'evidence_only_no_scope_expansion',
    },
    findingClosureAllowed: false, taskCreationAllowed: false, selectionChangeAllowed: false,
    stageDecisionChangeAllowed: false, lockInvalidationAllowed: false, reworkExecutionAllowed: false,
    paidGenerationAuthorized: false, automaticRetry: false, providerChangeAuthorized: false,
    unboundedRedoAuthorized: false, completionReleaseAllowed: false, providerCalls: 0,
  }
  const routeInstruction: ImagoReworkRouteInstruction = {
    state: 'BOUNDED_REWORK_ROUTED', outputSchema: 'IMAGO-V6-BoundedReworkRoute-v1',
    findingId: subject.finding.id, findingEventId: subject.finding.eventId,
    unitId: subject.productionUnit.unitId, earliestOwner: owner.stageId, ownerRoleId: owner.roleId,
    ownerScope: owner.scope,
    ownerScopeInstance: owner.scope === 'global' ? 'GLOBAL' : subject.productionUnit.unitId,
    boundedItem: {
      timecode: subject.finding.timecode, severity: subject.finding.severity,
      observation: subject.finding.observation, evidenceRefs: subject.finding.evidenceRefs,
      ownerReason: subject.finding.ownerReason, suggestion: subject.finding.suggestion,
      reworkScope: subject.finding.reworkScope,
    },
    scopeExpansionForbidden: true,
  }
  return { hashes: sources.hashes, lockHashes: sources.lockHashes, definition, routeInstruction }
}

/** Re-read the full Core source union and reconstruct the only bounded instruction for this Finding. */
export async function readReworkRouteRules(
  coreRoot: string, subject: YimengReworkRouteSubject, serialize: Serialize,
): Promise<ReworkRouteRules> {
  return bindReworkRouteRules(await readReworkRouteRuleSources(coreRoot, serialize), subject)
}

/** Verify all compiler fields and sign the exact subject and two current rule generations. */
export function attestReworkRouteMethod(
  raw: unknown,
  snapshot: ImagoReworkRouteMethodSnapshot,
  rules: ReworkRouteRules,
  serialize: Serialize,
  key: string,
): ImagoReworkRouteMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'routeInstruction', 'ruleBindings',
    'rulesSha256', 'lockRuleBindings', 'lockRulesSha256',
  ], 'reworkRouteProjection')
  if (projection.schema !== 'qingmu.imago-bounded-rework-route-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.subjectSnapshotSha256
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.routeInstruction, rules.routeInstruction)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes)
    || projection.rulesSha256 !== digest(rules.hashes, serialize, 'reworkRouteRules')
    || !isDeepStrictEqual(projection.lockRuleBindings, rules.lockHashes)
    || projection.lockRulesSha256 !== digest(rules.lockHashes, serialize, 'reworkRouteLockRules')) {
    throw new ReworkRouteContractError('compiler subject, route, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize, 'reworkRouteProjection')
  const unsigned = {
    schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-bounded-rework-route-method-adapter-result.v1',
    projection: projection as unknown as ImagoReworkRouteMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(serialize(unsigned, 'reworkRouteAttestation'), 'utf8').digest('hex'),
    },
  }
}
