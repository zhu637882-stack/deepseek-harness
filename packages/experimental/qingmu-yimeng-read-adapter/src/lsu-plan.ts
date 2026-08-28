/** Validate the exact current Yimeng LSU-plan source without granting seal authority. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengLsuPlanBlueprintLock,
  YimengLsuPlanDefinition,
  YimengLsuPlanSeal,
  YimengLsuPlanSealResult,
  YimengLsuPlanSourceRequest,
  YimengLsuPlanSourceResponse,
  YimengLsuPlanSubject,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

/** The LSU-plan source payload is malformed or carries unsupported authority. */
export class LsuPlanSourceContractError extends Error {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LsuPlanSourceContractError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  const item = object(value, field)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...keys].sort())) {
    throw new LsuPlanSourceContractError(`${field} fields mismatch`)
  }
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value !== pythonStrip(value)
    || value === '' || Array.from(value).length > maximum || /[\u0000\r\n]/u.test(value)) {
    throw new LsuPlanSourceContractError(`${field} must be canonical text`)
  }
  return value
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new LsuPlanSourceContractError(`${field} must be sha256`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new LsuPlanSourceContractError(`${field} must be a safe integer`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result)) {
    throw new LsuPlanSourceContractError(`${field} must be RFC3339`)
  }
  return result
}

function normalizeBlueprintLock(value: unknown, field: string): YimengLsuPlanBlueprintLock {
  const item = exact(value, [
    'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
  ], field)
  if (item.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || item.stageId !== 'C5F' || item.scopeInstance !== 'GLOBAL') {
    throw new LsuPlanSourceContractError(`${field} must bind the current C5F blueprint lock`)
  }
  return {
    lockId: 'PRODUCTION_BLUEPRINT_LOCK',
    stageId: 'C5F',
    scopeInstance: 'GLOBAL',
    artifactRecordRevision: integer(item.artifactRecordRevision, `${field}.artifactRecordRevision`, 1),
    artifactRecordSha256: sha(item.artifactRecordSha256, `${field}.artifactRecordSha256`),
    decisionId: text(item.decisionId, `${field}.decisionId`),
    eventSha256: sha(item.eventSha256, `${field}.eventSha256`),
  }
}

/**
 * Normalize one non-empty, sorted, current business subject and verify its canonical digest separately.
 * @param value - Untrusted value to validate and normalize.
 * @param field - Field path used in validation errors.
 * @returns Validated YimengLsuPlanSubject value.
 */
export function normalizeLsuPlanSubject(value: unknown, field: string): YimengLsuPlanSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock',
  ], field)
  if (item.schema !== 'jason.qingmu-lsu-plan-subject.v1' || !Array.isArray(item.productionUnits)
    || item.productionUnits.length === 0) throw new LsuPlanSourceContractError(`${field} schema or units mismatch`)
  const seenUnits = new Set<string>()
  const seenGroups = new Set<string>()
  let previous = ''
  const productionUnits = item.productionUnits.map((raw, index) => {
    const unitField = `${field}.productionUnits[${String(index)}]`
    const unit = exact(raw, [
      'unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256',
    ], unitField)
    const unitId = text(unit.unitId, `${unitField}.unitId`)
    const groupId = text(unit.groupId, `${unitField}.groupId`)
    if (!/^LSU[0-9]{2,}$/u.test(unitId) || seenUnits.has(unitId) || seenGroups.has(groupId)
      || (previous !== '' && unitId <= previous)) {
      throw new LsuPlanSourceContractError(`${field} units must be unique and sorted`)
    }
    seenUnits.add(unitId)
    seenGroups.add(groupId)
    previous = unitId
    return {
      unitId,
      groupId,
      bindingRevision: integer(unit.bindingRevision, `${unitField}.bindingRevision`, 1),
      bindingSha256: sha(unit.bindingSha256, `${unitField}.bindingSha256`),
      sourceSnapshotSha256: sha(unit.sourceSnapshotSha256, `${unitField}.sourceSnapshotSha256`),
    }
  })
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1',
    projectId: text(item.projectId, `${field}.projectId`),
    episodeId: text(item.episodeId, `${field}.episodeId`),
    productionUnits,
    productionBlueprintLock: normalizeBlueprintLock(item.productionBlueprintLock, `${field}.productionBlueprintLock`),
  }
}

function normalizeDefinition(value: unknown, field: string): YimengLsuPlanDefinition {
  const item = exact(value, [
    'id', 'version', 'scope', 'unitIdPattern', 'stages', 'requiredLockId', 'requiredLockStageId',
    'requiredLockScopeInstance', 'declarationPolicy', 'operation', 'planSealingAllowed', 'stageApprovalAllowed',
    'lockActivationAllowed', 'reworkExecutionAllowed', 'providerCalls',
  ], field)
  if (item.id !== 'IMAGO-V6-LSU-PLAN' || item.scope !== 'per_episode' || item.unitIdPattern !== 'LSU[0-9]{2,}'
    || item.requiredLockId !== 'PRODUCTION_BLUEPRINT_LOCK' || item.requiredLockStageId !== 'C5F'
    || item.requiredLockScopeInstance !== 'GLOBAL' || item.declarationPolicy !== 'exact_current_instantiated_units'
    || item.operation !== 'seal_current_lsu_plan' || item.planSealingAllowed !== true
    || item.stageApprovalAllowed !== false || item.lockActivationAllowed !== false
    || item.reworkExecutionAllowed !== false || item.providerCalls !== 0 || !Array.isArray(item.stages)
    || item.stages.length === 0) throw new LsuPlanSourceContractError(`${field} authority mismatch`)
  const seen = new Set<string>()
  const stages = item.stages.map((raw, index) => {
    const stageField = `${field}.stages[${String(index)}]`
    const stage = exact(raw, ['stageId', 'roleId', 'contractSha256'], stageField)
    const stageId = text(stage.stageId, `${stageField}.stageId`)
    if (seen.has(stageId)) throw new LsuPlanSourceContractError(`${field} stage IDs must be unique`)
    seen.add(stageId)
    return {
      stageId,
      roleId: text(stage.roleId, `${stageField}.roleId`),
      contractSha256: sha(stage.contractSha256, `${stageField}.contractSha256`),
    }
  })
  return {
    id: 'IMAGO-V6-LSU-PLAN', version: text(item.version, `${field}.version`), scope: 'per_episode',
    unitIdPattern: 'LSU[0-9]{2,}', stages, requiredLockId: 'PRODUCTION_BLUEPRINT_LOCK', requiredLockStageId: 'C5F',
    requiredLockScopeInstance: 'GLOBAL', declarationPolicy: 'exact_current_instantiated_units',
    operation: 'seal_current_lsu_plan', planSealingAllowed: true, stageApprovalAllowed: false,
    lockActivationAllowed: false, reworkExecutionAllowed: false, providerCalls: 0,
  }
}

function normalizeSeal(value: unknown, field: string, digest: Digest): YimengLsuPlanSeal {
  const item = exact(value, [
    'projectId', 'episodeId', 'revision', 'subject', 'subjectSnapshotSha256', 'definition',
    'methodProjectionSha256', 'rulesSha256', 'lockRulesSha256', 'actorId', 'actorNaturalPersonId',
    'authSessionId', 'eventId', 'changeSetId', 'sealedAt',
  ], field)
  const subject = normalizeLsuPlanSubject(item.subject, `${field}.subject`)
  const subjectSha256 = sha(item.subjectSnapshotSha256, `${field}.subjectSnapshotSha256`)
  if (digest(subject, `${field}.subject`) !== subjectSha256) {
    throw new LsuPlanSourceContractError(`${field} subject SHA mismatch`)
  }
  const projectId = text(item.projectId, `${field}.projectId`)
  const episodeId = text(item.episodeId, `${field}.episodeId`)
  if (subject.projectId !== projectId || subject.episodeId !== episodeId) {
    throw new LsuPlanSourceContractError(`${field} subject coordinates mismatch`)
  }
  return {
    projectId, episodeId, revision: integer(item.revision, `${field}.revision`, 1), subject,
    subjectSnapshotSha256: subjectSha256, definition: normalizeDefinition(item.definition, `${field}.definition`),
    methodProjectionSha256: sha(item.methodProjectionSha256, `${field}.methodProjectionSha256`),
    rulesSha256: sha(item.rulesSha256, `${field}.rulesSha256`),
    lockRulesSha256: sha(item.lockRulesSha256, `${field}.lockRulesSha256`),
    actorId: text(item.actorId, `${field}.actorId`),
    actorNaturalPersonId: text(item.actorNaturalPersonId, `${field}.actorNaturalPersonId`),
    authSessionId: sha(item.authSessionId, `${field}.authSessionId`),
    eventId: text(item.eventId, `${field}.eventId`), changeSetId: text(item.changeSetId, `${field}.changeSetId`),
    sealedAt: timestamp(item.sealedAt, `${field}.sealedAt`),
  }
}

/**
 * Validate one historical durable seal receipt. Current authority still requires a fresh probe.
 * @param value - Untrusted value to validate and normalize.
 * @param field - Field path used in validation errors.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengLsuPlanSealResult value.
 */
export function normalizeLsuPlanSealResult(
  value: unknown, field: string, digest: Digest,
): YimengLsuPlanSealResult {
  const item = exact(value, [
    'schema', 'seal', 'sealSha256', 'receiptId', 'outboxEventId', 'planSealed', 'stageApprovalGranted',
    'lockActivated', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted',
  ], field)
  if (item.schema !== 'jason.qingmu-lsu-plan-seal-result.v1' || item.planSealed !== true
    || item.stageApprovalGranted !== false || item.lockActivated !== false || item.providerCalls !== 0
    || item.humanSignoffInferred !== false || item.reworkExecuted !== false) {
    throw new LsuPlanSourceContractError(`${field} execution boundary mismatch`)
  }
  const seal = normalizeSeal(item.seal, `${field}.seal`, digest)
  const sealSha256 = sha(item.sealSha256, `${field}.sealSha256`)
  if (digest(seal, `${field}.seal`) !== sealSha256) throw new LsuPlanSourceContractError(`${field} seal SHA mismatch`)
  return {
    schema: 'jason.qingmu-lsu-plan-seal-result.v1', seal, sealSha256,
    receiptId: text(item.receiptId, `${field}.receiptId`),
    outboxEventId: text(item.outboxEventId, `${field}.outboxEventId`),
    planSealed: true, stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
    humanSignoffInferred: false, reworkExecuted: false,
  }
}

/**
 * Accept only the exact three source-read fields.
 * @param value - Untrusted value to validate and normalize.
 * @returns Validated YimengLsuPlanSourceRequest value.
 */
export function parseLsuPlanSourceRequest(value: unknown): YimengLsuPlanSourceRequest {
  try {
    const item = exact(value, ['projectId', 'episodeId', 'lockRulesSha256'], 'lsuPlanSource')
    return {
      projectId: text(item.projectId, 'lsuPlanSource.projectId'),
      episodeId: text(item.episodeId, 'lsuPlanSource.episodeId'),
      lockRulesSha256: sha(item.lockRulesSha256, 'lsuPlanSource.lockRulesSha256'),
    }
  } catch {
    throw new LsuPlanSourceContractError('lsuPlanSource accepts only projectId, episodeId, and lockRulesSha256')
  }
}

/**
 * Normalize the read projection and keep historical seal state separate from current-source qualification.
 * @param value - Untrusted value to validate and normalize.
 * @param request - Request coordinates and payload to process.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengLsuPlanSourceResponse value.
 */
export function normalizeLsuPlanSource(
  value: unknown, request: YimengLsuPlanSourceRequest, digest: Digest,
): YimengLsuPlanSourceResponse {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'capabilities', 'subject', 'subjectSnapshotSha256', 'availability',
    'latestSeal', 'latestSealSourceCurrent', 'currentLockRulesSha256', 'providerCalls', 'stageApprovalGranted',
    'lockActivated', 'reworkExecuted',
  ], 'lsuPlanSource')
  const capabilities = exact(item.capabilities, ['canSealPlan'], 'lsuPlanSource.capabilities')
  const availability = exact(item.availability, ['status', 'reason'], 'lsuPlanSource.availability')
  if (item.schema !== 'jason.qingmu-lsu-plan-feed.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || typeof capabilities.canSealPlan !== 'boolean'
    || item.currentLockRulesSha256 !== request.lockRulesSha256 || item.providerCalls !== 0
    || item.stageApprovalGranted !== false || item.lockActivated !== false || item.reworkExecuted !== false
    || typeof item.latestSealSourceCurrent !== 'boolean') {
    throw new LsuPlanSourceContractError('lsuPlanSource identity or authority mismatch')
  }
  let subject: YimengLsuPlanSubject | null = null
  let subjectSnapshotSha256: string | null = null
  let normalizedAvailability: YimengLsuPlanSourceResponse['availability']
  if (item.subject === null) {
    if (item.subjectSnapshotSha256 !== null || availability.status !== 'unavailable') {
      throw new LsuPlanSourceContractError('lsuPlanSource unavailable subject mismatch')
    }
    normalizedAvailability = {
      status: 'unavailable',
      reason: text(availability.reason, 'lsuPlanSource.availability.reason', 1024),
    }
  } else {
    subject = normalizeLsuPlanSubject(item.subject, 'lsuPlanSource.subject')
    subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'lsuPlanSource.subjectSnapshotSha256')
    if (subject.projectId !== request.projectId || subject.episodeId !== request.episodeId
      || digest(subject, 'lsuPlanSource.subject') !== subjectSnapshotSha256
      || availability.status !== 'available' || availability.reason !== null) {
      throw new LsuPlanSourceContractError('lsuPlanSource current subject mismatch')
    }
    normalizedAvailability = { status: 'available', reason: null }
  }
  const latestSeal = item.latestSeal === null
    ? null
    : normalizeLsuPlanSealResult(item.latestSeal, 'lsuPlanSource.latestSeal', digest)
  if (latestSeal !== null && (latestSeal.seal.projectId !== request.projectId
    || latestSeal.seal.episodeId !== request.episodeId)) {
    throw new LsuPlanSourceContractError('lsuPlanSource latest seal coordinates mismatch')
  }
  if (item.latestSealSourceCurrent && (subject === null || latestSeal === null
    || !isDeepStrictEqual(latestSeal.seal.subject, subject)
    || latestSeal.seal.subjectSnapshotSha256 !== subjectSnapshotSha256
    || latestSeal.seal.lockRulesSha256 !== request.lockRulesSha256)) {
    throw new LsuPlanSourceContractError('lsuPlanSource current-seal claim mismatch')
  }
  return {
    schema: 'jason.qingmu-lsu-plan-feed.v1', projectId: request.projectId, episodeId: request.episodeId,
    capabilities: { canSealPlan: capabilities.canSealPlan }, subject, subjectSnapshotSha256,
    availability: normalizedAvailability, latestSeal, latestSealSourceCurrent: item.latestSealSourceCurrent,
    currentLockRulesSha256: request.lockRulesSha256, providerCalls: 0, stageApprovalGranted: false,
    lockActivated: false, reworkExecuted: false,
  }
}
