/** Compile the current complete LSU-plan declaration without writing Yimeng state. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { YimengLsuPlanSubject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  ImagoLsuPlanMethodDefinition,
  ImagoLsuPlanMethodProjection,
  ImagoLsuPlanMethodRequest,
  ImagoLsuPlanMethodResponse,
  ImagoLsuPlanMethodSnapshot,
} from './types.ts'
import { PRODUCTION_UNIT_RULE_PATHS, readProductionUnitRules } from './production-unit.ts'
import { readStageArtifactRules, STAGE_ARTIFACT_RULE_PATHS } from './stage-artifact.ts'

/** Fixed current Core files used by the Python LSU-plan compiler. */
export const LSU_PLAN_RULE_PATHS = [
  ...new Set([
    ...PRODUCTION_UNIT_RULE_PATHS,
    ...STAGE_ARTIFACT_RULE_PATHS,
    'scripts/compile_qingmu_lsu_plan_method.py',
  ]),
] as const

type Serialize = (value: unknown, field: string) => string

/** Browser input is not the exact episode coordinate pair. */
export class LsuPlanInputError extends Error {}
/** Current Yimeng source, Core rules, or compiler output cannot be proven current. */
export class LsuPlanContractError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LsuPlanContractError('expected object')
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const item = object(value)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...keys].sort())) {
    throw new LsuPlanContractError('unexpected fields')
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

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function digest(value: unknown, serialize: Serialize, field = 'lsuPlanMethod'): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

/** Accept only project and episode coordinates; the Host derives all source and rule facts. */
export function parseLsuPlanMethodRequest(payload: unknown): ImagoLsuPlanMethodRequest {
  try {
    const item = exact(payload, ['projectId', 'episodeId'])
    if (!identifier(item.projectId) || !identifier(item.episodeId)) throw new LsuPlanInputError()
    return { projectId: item.projectId, episodeId: item.episodeId }
  } catch {
    throw new LsuPlanInputError('lsuPlanMethod accepts only projectId and episodeId')
  }
}

function normalizeSubject(value: unknown, request: ImagoLsuPlanMethodRequest): YimengLsuPlanSubject {
  const item = exact(value, ['schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock'])
  if (item.schema !== 'jason.qingmu-lsu-plan-subject.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || !Array.isArray(item.productionUnits)
    || item.productionUnits.length === 0) throw new LsuPlanContractError('current plan subject mismatch')
  const units: YimengLsuPlanSubject['productionUnits'][number][] = []
  const seenUnits = new Set<string>()
  const seenGroups = new Set<string>()
  let previous = ''
  for (const raw of item.productionUnits) {
    const unit = exact(raw, ['unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256'])
    if (!identifier(unit.unitId) || !/^LSU[0-9]{2,}$/u.test(unit.unitId) || !identifier(unit.groupId)
      || !integer(unit.bindingRevision, 1) || !sha(unit.bindingSha256) || !sha(unit.sourceSnapshotSha256)
      || seenUnits.has(unit.unitId) || seenGroups.has(unit.groupId) || (previous !== '' && unit.unitId <= previous)) {
      throw new LsuPlanContractError('current plan units mismatch')
    }
    seenUnits.add(unit.unitId)
    seenGroups.add(unit.groupId)
    previous = unit.unitId
    units.push({
      unitId: unit.unitId, groupId: unit.groupId, bindingRevision: unit.bindingRevision,
      bindingSha256: unit.bindingSha256, sourceSnapshotSha256: unit.sourceSnapshotSha256,
    })
  }
  const lock = exact(item.productionBlueprintLock, [
    'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
  ])
  if (lock.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || lock.stageId !== 'C5F' || lock.scopeInstance !== 'GLOBAL'
    || !integer(lock.artifactRecordRevision, 1) || !sha(lock.artifactRecordSha256)
    || !identifier(lock.decisionId) || !sha(lock.eventSha256)) {
    throw new LsuPlanContractError('current C5F blueprint lock mismatch')
  }
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1', projectId: request.projectId, episodeId: request.episodeId,
    productionUnits: units,
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK', stageId: 'C5F', scopeInstance: 'GLOBAL',
      artifactRecordRevision: lock.artifactRecordRevision, artifactRecordSha256: lock.artifactRecordSha256,
      decisionId: lock.decisionId, eventSha256: lock.eventSha256,
    },
  }
}

/** Build the compiler snapshot only from an available fresh read bound to the current lock-rule digest. */
export function buildLsuPlanSnapshot(
  request: ImagoLsuPlanMethodRequest,
  value: unknown,
  expectedLockRulesSha256: string,
  serialize: Serialize,
): ImagoLsuPlanMethodSnapshot {
  const feed = exact(value, [
    'schema', 'projectId', 'episodeId', 'capabilities', 'subject', 'subjectSnapshotSha256', 'availability',
    'latestSeal', 'latestSealSourceCurrent', 'currentLockRulesSha256', 'providerCalls', 'stageApprovalGranted',
    'lockActivated', 'reworkExecuted',
  ])
  const availability = exact(feed.availability, ['status', 'reason'])
  const capabilities = exact(feed.capabilities, ['canSealPlan'])
  if (feed.schema !== 'jason.qingmu-lsu-plan-feed.v1' || feed.projectId !== request.projectId
    || feed.episodeId !== request.episodeId || feed.currentLockRulesSha256 !== expectedLockRulesSha256
    || availability.status !== 'available' || availability.reason !== null || typeof capabilities.canSealPlan !== 'boolean'
    || feed.subject === null || !sha(feed.subjectSnapshotSha256) || typeof feed.latestSealSourceCurrent !== 'boolean'
    || feed.providerCalls !== 0 || feed.stageApprovalGranted !== false || feed.lockActivated !== false
    || feed.reworkExecuted !== false) throw new LsuPlanContractError('current plan source is unavailable')
  const subject = normalizeSubject(feed.subject, request)
  if (digest(subject, serialize, 'lsuPlanSubject') !== feed.subjectSnapshotSha256) {
    throw new LsuPlanContractError('current plan subject SHA mismatch')
  }
  const detached = JSON.parse(serialize(subject, 'lsuPlanSubject')) as YimengLsuPlanSubject
  const snapshot: ImagoLsuPlanMethodSnapshot = {
    schema: 'qingmu.lsu-plan-method-snapshot.v1', subject: detached,
    subjectSnapshotSha256: feed.subjectSnapshotSha256,
  }
  if (Buffer.byteLength(serialize(snapshot, 'lsuPlanSnapshot'), 'utf8') > 1024 * 1024) {
    throw new LsuPlanContractError('current plan source exceeds Core input limit')
  }
  return snapshot
}

/** Independently reconstructed current rule facts used to validate untrusted compiler output. */
export interface LsuPlanRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly lockHashes: Readonly<Record<string, string>>
  readonly definition: ImagoLsuPlanMethodDefinition
}

function subset(hashes: Readonly<Record<string, string>>, paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => {
    const value = hashes[path]
    if (value === undefined) throw new LsuPlanContractError('missing current rule hash')
    return [path, value]
  }))
}

/** Re-read the exact union of Core sources and cross-check both existing reviewed rule reconstructions. */
export async function readLsuPlanRules(coreRoot: string, serialize: Serialize): Promise<LsuPlanRules> {
  try {
    const [production, lock, sources] = await Promise.all([
      readProductionUnitRules(coreRoot, serialize),
      readStageArtifactRules(coreRoot, 'C5F', 'GLOBAL', serialize),
      Promise.all(LSU_PLAN_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const)),
    ])
    const hashes = Object.fromEntries(sources.map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
    const productionHashes = subset(hashes, PRODUCTION_UNIT_RULE_PATHS)
    const lockHashes = subset(hashes, STAGE_ARTIFACT_RULE_PATHS)
    const productionDefinition = object(production.definition)
    const lockDefinition = object(lock.definition)
    if (!isDeepStrictEqual(productionHashes, production.hashes) || !isDeepStrictEqual(lockHashes, lock.hashes)
      || productionDefinition.unitIdPattern !== 'LSU[0-9]{2,}' || productionDefinition.scope !== 'per_lsu'
      || !Array.isArray(productionDefinition.stages) || productionDefinition.stages.length === 0
      || lockDefinition.stageId !== 'C5F' || lockDefinition.scope !== 'global'
      || lockDefinition.producesLockId !== 'PRODUCTION_BLUEPRINT_LOCK'
      || lockDefinition.version !== productionDefinition.version) {
      throw new LsuPlanContractError('current LSU plan rules require a reviewed contract')
    }
    return {
      hashes,
      lockHashes,
      definition: {
        id: 'IMAGO-V6-LSU-PLAN', version: production.definition.version, scope: 'per_episode',
        unitIdPattern: 'LSU[0-9]{2,}', stages: production.definition.stages,
        requiredLockId: 'PRODUCTION_BLUEPRINT_LOCK', requiredLockStageId: 'C5F',
        requiredLockScopeInstance: 'GLOBAL', declarationPolicy: 'exact_current_instantiated_units',
        operation: 'seal_current_lsu_plan', planSealingAllowed: true, stageApprovalAllowed: false,
        lockActivationAllowed: false, reworkExecutionAllowed: false, providerCalls: 0,
      },
    }
  } catch (error) {
    if (error instanceof LsuPlanContractError) throw error
    throw new LsuPlanContractError('current LSU plan rules are unavailable')
  }
}

/** Verify every compiler field and sign the exact current subject and two rule generations. */
export function attestLsuPlanMethod(
  raw: unknown,
  snapshot: ImagoLsuPlanMethodSnapshot,
  rules: LsuPlanRules,
  serialize: Serialize,
  key: string,
): ImagoLsuPlanMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256',
    'lockRuleBindings', 'lockRulesSha256',
  ])
  if (projection.schema !== 'qingmu.imago-lsu-plan-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.subject)
    || projection.subjectSnapshotSha256 !== snapshot.subjectSnapshotSha256
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes)
    || projection.rulesSha256 !== digest(rules.hashes, serialize, 'lsuPlanRules')
    || !isDeepStrictEqual(projection.lockRuleBindings, rules.lockHashes)
    || projection.lockRulesSha256 !== digest(rules.lockHashes, serialize, 'lsuPlanLockRules')) {
    throw new LsuPlanContractError('compiler source, definition, or rule SHA mismatch')
  }
  const projectionSha256 = digest(projection, serialize, 'lsuPlanProjection')
  const unsigned = {
    schema: 'qingmu.imago-lsu-plan-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: snapshot.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-lsu-plan-method-adapter-result.v1',
    projection: projection as unknown as ImagoLsuPlanMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(serialize(unsigned, 'lsuPlanAttestation'), 'utf8').digest('hex'),
    },
  }
}
