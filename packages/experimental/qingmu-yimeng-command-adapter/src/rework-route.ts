/** Record one bounded rework route, recover its receipt, or probe its current authority. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengCommandJsonObject,
  YimengForwardedRecordReworkRouteRequest,
  YimengForwardedReworkRouteAuthorityProbeRequest,
  YimengImagoReworkRouteMethodAttestation,
  YimengImagoReworkRouteMethodProjection,
  YimengLsuPlanSubject,
  YimengProbeReworkRouteAuthorityRequest,
  YimengProductionUnitSource,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteAuthorityProbe,
  YimengReworkRouteDefinition,
  YimengReworkRouteFinding,
  YimengReworkRouteInstruction,
  YimengReworkRouteRecovery,
  YimengReworkRouteResult,
  YimengReworkRouteSubject,
  YimengShotVideoSubject,
} from './types.ts'

const RECORD_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'findingId', 'expectedSubjectSha256',
  'expectedRouteRevision', 'expectedRouteSha256', 'idempotencyKey',
] as const
const PROBE_FIELDS = ['projectId', 'episodeId', 'frameId', 'findingId'] as const
const METHOD_RESPONSE_FIELDS = ['schema', 'projection', 'projectionSha256', 'methodAttestation'] as const
const PROJECTION_FIELDS = [
  'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'routeInstruction',
  'ruleBindings', 'rulesSha256', 'lockRuleBindings', 'lockRulesSha256',
] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'selectedVideo', 'finding', 'productionUnit', 'sealedPlan',
] as const
const SELECTED_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256',
] as const
const FINDING_FIELDS = [
  'id', 'eventId', 'subjectSnapshotSha256', 'timecode', 'observation', 'evidenceRefs',
  'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope', 'status',
  'methodProjectionSha256', 'rulesSha256',
] as const
const PRODUCTION_FIELDS = ['unitId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256', 'source'] as const
const PRODUCTION_SOURCE_FIELDS = [
  'schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title', 'groupExecutionPromptSha256',
  'storyboardRevision', 'shots',
] as const
const SHOT_FIELDS = ['frameId', 'frameNo', 'frameContentSha256'] as const
const SEALED_PLAN_FIELDS = [
  'revision', 'sealSha256', 'subjectSnapshotSha256', 'methodProjectionSha256',
  'rulesSha256', 'lockRulesSha256', 'subject',
] as const
const PLAN_SUBJECT_FIELDS = ['schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock'] as const
const PLAN_UNIT_FIELDS = ['unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256'] as const
const LOCK_FIELDS = [
  'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
] as const
const DEFINITION_FIELDS = [
  'id', 'version', 'scope', 'operation', 'requiredFindingStatus', 'oneEarliestOwnerPerFinding',
  'groupByEarliestOwner', 'timecodeEvidenceAndScopeRequired', 'findingRuleComparison',
  'findingClosureAllowed', 'taskCreationAllowed', 'selectionChangeAllowed', 'stageDecisionChangeAllowed',
  'lockInvalidationAllowed', 'reworkExecutionAllowed', 'paidGenerationAuthorized', 'automaticRetry',
  'providerChangeAuthorized', 'unboundedRedoAuthorized', 'completionReleaseAllowed', 'providerCalls',
] as const
const COMPARISON_FIELDS = ['recordedRulesSha256', 'currentRulesSha256', 'changed', 'effect'] as const
const ROUTE_FIELDS = [
  'state', 'outputSchema', 'findingId', 'findingEventId', 'unitId', 'earliestOwner', 'ownerRoleId',
  'ownerScope', 'ownerScopeInstance', 'boundedItem', 'scopeExpansionForbidden',
] as const
const BOUNDED_FIELDS = [
  'timecode', 'severity', 'observation', 'evidenceRefs', 'ownerReason', 'suggestion', 'reworkScope',
] as const
const RESULT_FIELDS = [
  'schema', 'route', 'routeSha256', 'receiptId', 'outboxEventId', 'routeRecorded', 'findingClosed',
  'selectionChanged', 'stageDecisionChanged', 'lockInvalidated', 'taskCreated', 'providerCalls',
  'reworkExecuted', 'humanSignoffInferred',
] as const
const RECORD_RESULT_FIELDS = [
  'projectId', 'episodeId', 'findingId', 'revision', 'subject', 'subjectSnapshotSha256', 'definition',
  'routeInstruction', 'methodProjectionSha256', 'rulesSha256', 'lockRulesSha256', 'actorId',
  'actorNaturalPersonId', 'authSessionId', 'eventId', 'changeSetId', 'routedAt',
] as const
const RECOVERY_FIELDS = [
  'schema', 'projectId', 'episodeId', 'findingId', 'expectedSubjectSha256', 'expectedRouteRevision',
  'expectedRouteSha256', 'idempotencyKey', 'found', 'result',
] as const
const AUTHORITY_FIELDS = [
  'schema', 'projectId', 'episodeId', 'findingId', 'subjectSnapshotSha256', 'methodProjectionSha256',
  'rulesSha256', 'lockRulesSha256', 'latestRoute', 'currentRouteRecorded', 'routeRecorded',
  'findingClosed', 'selectionChanged', 'stageDecisionChanged', 'lockInvalidated', 'taskCreated',
  'providerCalls', 'reworkExecuted', 'humanSignoffInferred',
] as const

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
  YimengReworkRouteResult | YimengReworkRouteRecovery | YimengReworkRouteAuthorityProbe
}
interface VerifiedMethod {
  readonly projection: YimengImagoReworkRouteMethodProjection
  readonly projectionSha256: string
  readonly attestation: YimengImagoReworkRouteMethodAttestation
}

function object(value: unknown, field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw error(`${field} must be an object`)
  return value as YimengCommandJsonObject
}

function exact(value: unknown, fields: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  const item = object(value, field, error)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...fields].sort())) throw error(`${field} has invalid fields`)
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, error: ErrorFactory, maximum = 8_000): string {
  if (typeof value !== 'string' || !value.isWellFormed() || pythonStrip(value) === ''
    || value.includes('\u0000') || Array.from(value).length > maximum) throw error(`${field} must be bounded text`)
  return value
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  const result = text(value, field, error, 256)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) throw error(`${field} must be canonical text`)
  return result
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw error(`${field} must be sha256`)
  return value
}

function integer(value: unknown, field: string, error: ErrorFactory, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer`)
  }
  return value
}

function idempotencyKey(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200 || !/^[\x21-\x7e]+$/u.test(value)) {
    throw error('idempotencyKey must be 8..200 visible ASCII characters')
  }
  return value
}

function digest(value: unknown, helpers: Helpers, field: string, error: ErrorFactory): string {
  try {
    return createHash('sha256').update(helpers.canonicalJson(value, field), 'utf8').digest('hex')
  } catch {
    throw error(`${field} must be canonical JSON`)
  }
}

function selectedVideo(
  value: unknown, coordinates: YimengProbeReworkRouteAuthorityRequest, error: ErrorFactory,
): YimengShotVideoSubject {
  const item = exact(value, SELECTED_FIELDS, 'methodProjection.subject.selectedVideo', error)
  if (item.schema !== 'jason.qingmu-shot-video-subject.v1' || item.projectId !== coordinates.projectId
    || item.episodeId !== coordinates.episodeId || item.frameId !== coordinates.frameId) {
    throw error('selected video coordinates mismatch')
  }
  return {
    schema: 'jason.qingmu-shot-video-subject.v1', projectId: coordinates.projectId,
    episodeId: coordinates.episodeId, frameId: coordinates.frameId,
    frameNo: integer(item.frameNo, 'selectedVideo.frameNo', error, 1),
    storyboardRevision: integer(item.storyboardRevision, 'selectedVideo.storyboardRevision', error),
    frameContentSha256: sha(item.frameContentSha256, 'selectedVideo.frameContentSha256', error),
    assetId: id(item.assetId, 'selectedVideo.assetId', error),
    assetVersion: integer(item.assetVersion, 'selectedVideo.assetVersion', error),
    assetSha256: sha(item.assetSha256, 'selectedVideo.assetSha256', error),
  }
}

function finding(
  value: unknown, selected: YimengShotVideoSubject, helpers: Helpers, error: ErrorFactory,
): YimengReworkRouteFinding {
  const item = exact(value, FINDING_FIELDS, 'methodProjection.subject.finding', error)
  if (item.status !== 'OPEN' || !['BLOCKER', 'MAJOR', 'MINOR'].includes(String(item.severity))
    || sha(item.subjectSnapshotSha256, 'finding.subjectSnapshotSha256', error)
      !== digest(selected, helpers, 'selectedVideo', error)
    || !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 32) {
    throw error('OPEN Finding binding mismatch')
  }
  return {
    id: id(item.id, 'finding.id', error), eventId: id(item.eventId, 'finding.eventId', error),
    subjectSnapshotSha256: sha(item.subjectSnapshotSha256, 'finding.subjectSnapshotSha256', error),
    timecode: text(item.timecode, 'finding.timecode', error, 128),
    observation: text(item.observation, 'finding.observation', error),
    evidenceRefs: item.evidenceRefs.map((entry, index) => text(
      entry, `finding.evidenceRefs[${String(index)}]`, error, 1_024,
    )),
    earliestOwner: id(item.earliestOwner, 'finding.earliestOwner', error),
    ownerReason: text(item.ownerReason, 'finding.ownerReason', error),
    severity: item.severity as YimengReworkRouteFinding['severity'],
    suggestion: text(item.suggestion, 'finding.suggestion', error),
    reworkScope: text(item.reworkScope, 'finding.reworkScope', error), status: 'OPEN',
    methodProjectionSha256: sha(item.methodProjectionSha256, 'finding.methodProjectionSha256', error),
    rulesSha256: sha(item.rulesSha256, 'finding.rulesSha256', error),
  }
}

function productionSource(
  value: unknown, coordinates: YimengProbeReworkRouteAuthorityRequest, error: ErrorFactory,
): YimengProductionUnitSource {
  const item = exact(value, PRODUCTION_SOURCE_FIELDS, 'methodProjection.subject.productionUnit.source', error)
  if (item.schema !== 'jason.qingmu-production-unit-source.v1' || item.projectId !== coordinates.projectId
    || item.episodeId !== coordinates.episodeId || !Array.isArray(item.shots) || item.shots.length === 0) {
    throw error('production unit source mismatch')
  }
  const seen = new Set<string>()
  let previous = 0
  const shots = item.shots.map((raw, index) => {
    const shot = exact(raw, SHOT_FIELDS, `productionUnit.source.shots[${String(index)}]`, error)
    const frameId = id(shot.frameId, 'productionUnit.source.shot.frameId', error)
    const frameNo = integer(shot.frameNo, 'productionUnit.source.shot.frameNo', error, 1)
    if (seen.has(frameId) || frameNo <= previous) throw error('production unit Shot order mismatch')
    seen.add(frameId)
    previous = frameNo
    return {
      frameId, frameNo,
      frameContentSha256: sha(shot.frameContentSha256, 'productionUnit.source.shot.frameContentSha256', error),
    }
  })
  return {
    schema: 'jason.qingmu-production-unit-source.v1', projectId: coordinates.projectId,
    episodeId: coordinates.episodeId, groupId: id(item.groupId, 'productionUnit.source.groupId', error),
    groupNo: integer(item.groupNo, 'productionUnit.source.groupNo', error, 1),
    title: text(item.title, 'productionUnit.source.title', error),
    groupExecutionPromptSha256: sha(
      item.groupExecutionPromptSha256, 'productionUnit.source.groupExecutionPromptSha256', error,
    ),
    storyboardRevision: integer(item.storyboardRevision, 'productionUnit.source.storyboardRevision', error), shots,
  }
}

function planSubject(
  value: unknown, coordinates: YimengProbeReworkRouteAuthorityRequest, error: ErrorFactory,
): YimengLsuPlanSubject {
  const item = exact(value, PLAN_SUBJECT_FIELDS, 'methodProjection.subject.sealedPlan.subject', error)
  if (item.schema !== 'jason.qingmu-lsu-plan-subject.v1' || item.projectId !== coordinates.projectId
    || item.episodeId !== coordinates.episodeId || !Array.isArray(item.productionUnits)
    || item.productionUnits.length === 0) throw error('sealed plan subject mismatch')
  const seenUnits = new Set<string>()
  const seenGroups = new Set<string>()
  let previous = ''
  const units = item.productionUnits.map((raw, index) => {
    const unit = exact(raw, PLAN_UNIT_FIELDS, `sealedPlan.subject.productionUnits[${String(index)}]`, error)
    const unitId = id(unit.unitId, 'sealedPlan.unitId', error)
    const groupId = id(unit.groupId, 'sealedPlan.groupId', error)
    if (!/^LSU[0-9]{2,}$/u.test(unitId) || seenUnits.has(unitId) || seenGroups.has(groupId)
      || (previous !== '' && unitId <= previous)) throw error('sealed plan units must be unique and sorted')
    seenUnits.add(unitId)
    seenGroups.add(groupId)
    previous = unitId
    return {
      unitId, groupId,
      bindingRevision: integer(unit.bindingRevision, 'sealedPlan.bindingRevision', error, 1),
      bindingSha256: sha(unit.bindingSha256, 'sealedPlan.bindingSha256', error),
      sourceSnapshotSha256: sha(unit.sourceSnapshotSha256, 'sealedPlan.sourceSnapshotSha256', error),
    }
  })
  const lock = exact(item.productionBlueprintLock, LOCK_FIELDS, 'sealedPlan.productionBlueprintLock', error)
  if (lock.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || lock.stageId !== 'C5F' || lock.scopeInstance !== 'GLOBAL') {
    throw error('sealed plan C5F lock mismatch')
  }
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1', projectId: coordinates.projectId,
    episodeId: coordinates.episodeId, productionUnits: units,
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK', stageId: 'C5F', scopeInstance: 'GLOBAL',
      artifactRecordRevision: integer(lock.artifactRecordRevision, 'lock.artifactRecordRevision', error, 1),
      artifactRecordSha256: sha(lock.artifactRecordSha256, 'lock.artifactRecordSha256', error),
      decisionId: id(lock.decisionId, 'lock.decisionId', error),
      eventSha256: sha(lock.eventSha256, 'lock.eventSha256', error),
    },
  }
}

function subject(
  value: unknown, coordinates: YimengProbeReworkRouteAuthorityRequest, helpers: Helpers, error: ErrorFactory,
): YimengReworkRouteSubject {
  const item = exact(value, SUBJECT_FIELDS, 'methodProjection.subject', error)
  if (item.schema !== 'jason.qingmu-bounded-rework-route-subject.v1'
    || item.projectId !== coordinates.projectId || item.episodeId !== coordinates.episodeId) {
    throw error('bounded route subject coordinates mismatch')
  }
  const selected = selectedVideo(item.selectedVideo, coordinates, error)
  const boundFinding = finding(item.finding, selected, helpers, error)
  if (boundFinding.id !== coordinates.findingId) throw error('bounded route Finding ID mismatch')
  const production = exact(item.productionUnit, PRODUCTION_FIELDS, 'methodProjection.subject.productionUnit', error)
  const source = productionSource(production.source, coordinates, error)
  const sourceSnapshotSha256 = sha(production.sourceSnapshotSha256, 'productionUnit.sourceSnapshotSha256', error)
  if (digest(source, helpers, 'productionUnit.source', error) !== sourceSnapshotSha256
    || source.shots.filter(shot => shot.frameId === selected.frameId && shot.frameNo === selected.frameNo
      && shot.frameContentSha256 === selected.frameContentSha256).length !== 1) {
    throw error('Finding Shot is not in one current Production Unit')
  }
  const unitId = id(production.unitId, 'productionUnit.unitId', error)
  const bindingRevision = integer(production.bindingRevision, 'productionUnit.bindingRevision', error, 1)
  const bindingSha256 = sha(production.bindingSha256, 'productionUnit.bindingSha256', error)
  if (!/^LSU[0-9]{2,}$/u.test(unitId)) throw error('production unit ID mismatch')
  const sealed = exact(item.sealedPlan, SEALED_PLAN_FIELDS, 'methodProjection.subject.sealedPlan', error)
  const plan = planSubject(sealed.subject, coordinates, error)
  const planSubjectSha256 = sha(sealed.subjectSnapshotSha256, 'sealedPlan.subjectSnapshotSha256', error)
  if (digest(plan, helpers, 'sealedPlan.subject', error) !== planSubjectSha256
    || plan.productionUnits.filter(unit => unit.unitId === unitId && unit.groupId === source.groupId
      && unit.bindingRevision === bindingRevision && unit.bindingSha256 === bindingSha256
      && unit.sourceSnapshotSha256 === sourceSnapshotSha256).length !== 1) {
    throw error('Production Unit is not in the sealed plan')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-subject.v1', projectId: coordinates.projectId,
    episodeId: coordinates.episodeId, selectedVideo: selected, finding: boundFinding,
    productionUnit: { unitId, bindingRevision, bindingSha256, sourceSnapshotSha256, source },
    sealedPlan: {
      revision: integer(sealed.revision, 'sealedPlan.revision', error, 1),
      sealSha256: sha(sealed.sealSha256, 'sealedPlan.sealSha256', error),
      subjectSnapshotSha256: planSubjectSha256,
      methodProjectionSha256: sha(sealed.methodProjectionSha256, 'sealedPlan.methodProjectionSha256', error),
      rulesSha256: sha(sealed.rulesSha256, 'sealedPlan.rulesSha256', error),
      lockRulesSha256: sha(sealed.lockRulesSha256, 'sealedPlan.lockRulesSha256', error), subject: plan,
    },
  }
}

function definition(
  value: unknown, boundSubject: YimengReworkRouteSubject, error: ErrorFactory,
): YimengReworkRouteDefinition {
  const item = exact(value, DEFINITION_FIELDS, 'methodProjection.definition', error)
  const comparison = exact(item.findingRuleComparison, COMPARISON_FIELDS, 'findingRuleComparison', error)
  const falseFields = [
    'findingClosureAllowed', 'taskCreationAllowed', 'selectionChangeAllowed', 'stageDecisionChangeAllowed',
    'lockInvalidationAllowed', 'reworkExecutionAllowed', 'paidGenerationAuthorized', 'automaticRetry',
    'providerChangeAuthorized', 'unboundedRedoAuthorized', 'completionReleaseAllowed',
  ]
  const currentRulesSha256 = sha(comparison.currentRulesSha256, 'findingRuleComparison.currentRulesSha256', error)
  if (item.id !== 'IMAGO-V6-BOUNDED-REWORK-ROUTE' || item.scope !== 'per_finding'
    || item.operation !== 'record_bounded_rework_route' || item.requiredFindingStatus !== 'OPEN'
    || item.oneEarliestOwnerPerFinding !== true || item.groupByEarliestOwner !== true
    || item.timecodeEvidenceAndScopeRequired !== true || falseFields.some(field => item[field] !== false)
    || item.providerCalls !== 0 || comparison.recordedRulesSha256 !== boundSubject.finding.rulesSha256
    || typeof comparison.changed !== 'boolean'
    || comparison.changed !== (comparison.recordedRulesSha256 !== currentRulesSha256)
    || comparison.effect !== 'evidence_only_no_scope_expansion') throw error('route definition authority mismatch')
  return {
    id: 'IMAGO-V6-BOUNDED-REWORK-ROUTE', version: id(item.version, 'definition.version', error),
    scope: 'per_finding', operation: 'record_bounded_rework_route', requiredFindingStatus: 'OPEN',
    oneEarliestOwnerPerFinding: true, groupByEarliestOwner: true, timecodeEvidenceAndScopeRequired: true,
    findingRuleComparison: {
      recordedRulesSha256: boundSubject.finding.rulesSha256, currentRulesSha256,
      changed: comparison.changed, effect: 'evidence_only_no_scope_expansion',
    },
    findingClosureAllowed: false, taskCreationAllowed: false, selectionChangeAllowed: false,
    stageDecisionChangeAllowed: false, lockInvalidationAllowed: false, reworkExecutionAllowed: false,
    paidGenerationAuthorized: false, automaticRetry: false, providerChangeAuthorized: false,
    unboundedRedoAuthorized: false, completionReleaseAllowed: false, providerCalls: 0,
  }
}

function routeInstruction(
  value: unknown, boundSubject: YimengReworkRouteSubject, error: ErrorFactory,
): YimengReworkRouteInstruction {
  const item = exact(value, ROUTE_FIELDS, 'methodProjection.routeInstruction', error)
  const bounded = exact(item.boundedItem, BOUNDED_FIELDS, 'routeInstruction.boundedItem', error)
  const finding = boundSubject.finding
  if (item.state !== 'BOUNDED_REWORK_ROUTED' || item.outputSchema !== 'IMAGO-V6-BoundedReworkRoute-v1'
    || item.findingId !== finding.id || item.findingEventId !== finding.eventId
    || item.unitId !== boundSubject.productionUnit.unitId || item.earliestOwner !== finding.earliestOwner
    || !['global', 'per_lsu'].includes(String(item.ownerScope))
    || item.ownerScopeInstance !== (item.ownerScope === 'global' ? 'GLOBAL' : boundSubject.productionUnit.unitId)
    || item.scopeExpansionForbidden !== true || !isDeepStrictEqual(bounded, {
    timecode: finding.timecode, severity: finding.severity, observation: finding.observation,
    evidenceRefs: finding.evidenceRefs, ownerReason: finding.ownerReason,
    suggestion: finding.suggestion, reworkScope: finding.reworkScope,
  })) throw error('route instruction binding mismatch')
  return {
    state: 'BOUNDED_REWORK_ROUTED', outputSchema: 'IMAGO-V6-BoundedReworkRoute-v1',
    findingId: finding.id, findingEventId: finding.eventId, unitId: boundSubject.productionUnit.unitId,
    earliestOwner: finding.earliestOwner, ownerRoleId: id(item.ownerRoleId, 'routeInstruction.ownerRoleId', error),
    ownerScope: item.ownerScope as 'global' | 'per_lsu',
    ownerScopeInstance: item.ownerScopeInstance,
    boundedItem: {
      timecode: finding.timecode, severity: finding.severity, observation: finding.observation,
      evidenceRefs: finding.evidenceRefs, ownerReason: finding.ownerReason,
      suggestion: finding.suggestion, reworkScope: finding.reworkScope,
    },
    scopeExpansionForbidden: true,
  }
}

function ruleBindings(
  value: unknown, field: string, helpers: Helpers, error: ErrorFactory,
): Readonly<Record<string, string>> {
  const item = object(value, field, error)
  if (Object.keys(item).length === 0) throw error(`${field} must be non-empty`)
  const result = Object.fromEntries(Object.entries(item).map(([path, value]) => {
    id(path, `${field} path`, error)
    if (path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw error(`${field} path must be safe and relative`)
    }
    return [path, sha(value, `${field} digest`, error)]
  }))
  digest(result, helpers, field, error)
  return result
}

function verifyMethod(
  projectionValue: unknown,
  projectionShaValue: unknown,
  attestationValue: unknown,
  coordinates: YimengProbeReworkRouteAuthorityRequest,
  helpers: Helpers,
  error: ErrorFactory,
  expectedSubjectSha256?: string,
): VerifiedMethod {
  const item = exact(projectionValue, PROJECTION_FIELDS, 'methodProjection', error)
  if (item.schema !== 'qingmu.imago-bounded-rework-route-method.v1') throw error('methodProjection schema mismatch')
  const boundSubject = subject(item.subject, coordinates, helpers, error)
  const subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'subjectSnapshotSha256', error)
  if (digest(boundSubject, helpers, 'reworkRouteSubject', error) !== subjectSnapshotSha256
    || (expectedSubjectSha256 !== undefined && subjectSnapshotSha256 !== expectedSubjectSha256)) {
    throw error('methodProjection subject SHA mismatch')
  }
  const boundDefinition = definition(item.definition, boundSubject, error)
  const boundRoute = routeInstruction(item.routeInstruction, boundSubject, error)
  const rules = ruleBindings(item.ruleBindings, 'ruleBindings', helpers, error)
  const rulesSha256 = sha(item.rulesSha256, 'rulesSha256', error)
  const lockRules = ruleBindings(item.lockRuleBindings, 'lockRuleBindings', helpers, error)
  const lockRulesSha256 = sha(item.lockRulesSha256, 'lockRulesSha256', error)
  if (digest(rules, helpers, 'ruleBindings', error) !== rulesSha256
    || digest(lockRules, helpers, 'lockRuleBindings', error) !== lockRulesSha256
    || Object.entries(lockRules).some(([path, value]) => rules[path] !== value)
    || boundSubject.sealedPlan.lockRulesSha256 !== lockRulesSha256) {
    throw error('methodProjection rule binding mismatch')
  }
  const projection: YimengImagoReworkRouteMethodProjection = {
    schema: 'qingmu.imago-bounded-rework-route-method.v1', subject: boundSubject, subjectSnapshotSha256,
    definition: boundDefinition, routeInstruction: boundRoute, ruleBindings: rules, rulesSha256,
    lockRuleBindings: lockRules, lockRulesSha256,
  }
  const projectionSha256 = sha(projectionShaValue, 'methodProjectionSha256', error)
  if (digest(projection, helpers, 'methodProjection', error) !== projectionSha256) {
    throw error('methodProjection SHA mismatch')
  }
  const unsigned = {
    schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  const proof = exact(attestationValue, [...Object.keys(unsigned), 'signature'], 'methodAttestation', error)
  if (Object.entries(unsigned).some(([key, expected]) => proof[key] !== expected)) {
    throw error('methodAttestation binding mismatch')
  }
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expected = createHmac('sha256', helpers.readAttestationKey())
    .update(helpers.canonicalJson(unsigned, 'reworkRouteAttestation'), 'utf8').digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw error('methodAttestation signature mismatch')
  return { projection, projectionSha256, attestation: { ...unsigned, signature } }
}

function currentMethod(
  value: unknown,
  coordinates: YimengProbeReworkRouteAuthorityRequest,
  helpers: Helpers,
  expectedSubjectSha256?: string,
): VerifiedMethod {
  const root = exact(value, METHOD_RESPONSE_FIELDS, 'currentReworkRouteMethod', helpers.responseError)
  if (root.schema !== 'qingmu.imago-bounded-rework-route-method-adapter-result.v1') {
    throw helpers.responseError('current bounded route Method schema mismatch')
  }
  return verifyMethod(
    root.projection, root.projectionSha256, root.methodAttestation, coordinates,
    helpers, helpers.responseError, expectedSubjectSha256,
  )
}

function recordIntent(value: unknown, helpers: Helpers): YimengRecordReworkRouteRequest {
  const item = exact(value, RECORD_FIELDS, 'payload', helpers.inputError)
  const expectedRouteRevision = integer(item.expectedRouteRevision, 'expectedRouteRevision', helpers.inputError)
  if (expectedRouteRevision === Number.MAX_SAFE_INTEGER) {
    throw helpers.inputError('expectedRouteRevision must permit a safe next revision')
  }
  let expectedRouteSha256: string | null
  if (expectedRouteRevision === 0) {
    if (item.expectedRouteSha256 !== null) throw helpers.inputError('initial route requires null previous SHA')
    expectedRouteSha256 = null
  } else {
    expectedRouteSha256 = sha(item.expectedRouteSha256, 'expectedRouteSha256', helpers.inputError)
  }
  return {
    projectId: id(item.projectId, 'projectId', helpers.inputError),
    episodeId: id(item.episodeId, 'episodeId', helpers.inputError),
    frameId: id(item.frameId, 'frameId', helpers.inputError),
    findingId: id(item.findingId, 'findingId', helpers.inputError),
    expectedSubjectSha256: sha(item.expectedSubjectSha256, 'expectedSubjectSha256', helpers.inputError),
    expectedRouteRevision, expectedRouteSha256,
    idempotencyKey: idempotencyKey(item.idempotencyKey, helpers.inputError),
  }
}

function probeIntent(value: unknown, helpers: Helpers): YimengProbeReworkRouteAuthorityRequest {
  const item = exact(value, PROBE_FIELDS, 'payload', helpers.inputError)
  return {
    projectId: id(item.projectId, 'projectId', helpers.inputError),
    episodeId: id(item.episodeId, 'episodeId', helpers.inputError),
    frameId: id(item.frameId, 'frameId', helpers.inputError),
    findingId: id(item.findingId, 'findingId', helpers.inputError),
  }
}

function forwardedRecord(
  value: unknown, methodValue: unknown, helpers: Helpers,
): YimengForwardedRecordReworkRouteRequest {
  const request = recordIntent(value, helpers)
  const method = currentMethod(methodValue, request, helpers, request.expectedSubjectSha256)
  return {
    ...request, methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
    methodAttestation: method.attestation,
  }
}

function forwardedProbe(
  value: unknown, methodValue: unknown, helpers: Helpers,
): YimengForwardedReworkRouteAuthorityProbeRequest {
  const request = probeIntent(value, helpers)
  const method = currentMethod(methodValue, request, helpers)
  return {
    ...request, methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
    methodAttestation: method.attestation,
  }
}

interface ResultConstraints {
  readonly coordinates: YimengProbeReworkRouteAuthorityRequest
  readonly expectedSubjectSha256?: string
  readonly expectedRevision?: number
  readonly method?: VerifiedMethod
  readonly token?: string
}

function routeResult(
  value: unknown, constraints: ResultConstraints, helpers: Helpers,
): YimengReworkRouteResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'reworkRouteResult', error)
  if (root.schema !== 'jason.qingmu-bounded-rework-route-result.v1' || root.routeRecorded !== true
    || root.findingClosed !== false || root.selectionChanged !== false || root.stageDecisionChanged !== false
    || root.lockInvalidated !== false || root.taskCreated !== false || root.providerCalls !== 0
    || root.reworkExecuted !== false || root.humanSignoffInferred !== false) {
    throw error('bounded route result authority mismatch')
  }
  const item = exact(root.route, RECORD_RESULT_FIELDS, 'reworkRouteResult.route', error)
  if (item.projectId !== constraints.coordinates.projectId || item.episodeId !== constraints.coordinates.episodeId
    || item.findingId !== constraints.coordinates.findingId) throw error('bounded route result coordinates mismatch')
  const boundSubject = subject(item.subject, constraints.coordinates, helpers, error)
  const subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'route.subjectSnapshotSha256', error)
  if (digest(boundSubject, helpers, 'reworkRouteSubject', error) !== subjectSnapshotSha256
    || (constraints.expectedSubjectSha256 !== undefined
      && subjectSnapshotSha256 !== constraints.expectedSubjectSha256)) throw error('bounded route result subject mismatch')
  const revision = integer(item.revision, 'route.revision', error, 1)
  if (constraints.expectedRevision !== undefined && revision !== constraints.expectedRevision) {
    throw error('bounded route result revision mismatch')
  }
  const boundDefinition = definition(item.definition, boundSubject, error)
  const boundRoute = routeInstruction(item.routeInstruction, boundSubject, error)
  const methodProjectionSha256 = sha(item.methodProjectionSha256, 'route.methodProjectionSha256', error)
  const rulesSha256 = sha(item.rulesSha256, 'route.rulesSha256', error)
  const lockRulesSha256 = sha(item.lockRulesSha256, 'route.lockRulesSha256', error)
  if (constraints.method !== undefined && (
    methodProjectionSha256 !== constraints.method.projectionSha256
    || rulesSha256 !== constraints.method.projection.rulesSha256
    || lockRulesSha256 !== constraints.method.projection.lockRulesSha256
    || !isDeepStrictEqual(boundSubject, constraints.method.projection.subject)
    || !isDeepStrictEqual(boundDefinition, constraints.method.projection.definition)
    || !isDeepStrictEqual(boundRoute, constraints.method.projection.routeInstruction)
  )) throw error('bounded route result differs from submitted current Method')
  const authSessionId = sha(item.authSessionId, 'route.authSessionId', error)
  if (constraints.token !== undefined
    && authSessionId !== createHash('sha256').update(constraints.token, 'utf8').digest('hex')) {
    throw error('bounded route authenticated session mismatch')
  }
  const route = {
    projectId: constraints.coordinates.projectId, episodeId: constraints.coordinates.episodeId,
    findingId: constraints.coordinates.findingId, revision, subject: boundSubject, subjectSnapshotSha256,
    definition: boundDefinition, routeInstruction: boundRoute, methodProjectionSha256, rulesSha256, lockRulesSha256,
    actorId: id(item.actorId, 'route.actorId', error),
    actorNaturalPersonId: id(item.actorNaturalPersonId, 'route.actorNaturalPersonId', error), authSessionId,
    eventId: id(item.eventId, 'route.eventId', error), changeSetId: id(item.changeSetId, 'route.changeSetId', error),
    routedAt: helpers.requireTimestamp(id(item.routedAt, 'route.routedAt', error), 'route.routedAt'),
  }
  const routeSha256 = sha(root.routeSha256, 'routeSha256', error)
  if (digest(route, helpers, 'reworkRouteRecord', error) !== routeSha256) throw error('bounded route SHA mismatch')
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1', route, routeSha256,
    receiptId: id(root.receiptId, 'receiptId', error), outboxEventId: id(root.outboxEventId, 'outboxEventId', error),
    routeRecorded: true, findingClosed: false, selectionChanged: false, stageDecisionChanged: false,
    lockInvalidated: false, taskCreated: false, providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
  }
}

function recoveryResult(
  value: unknown, request: YimengRecordReworkRouteRequest, helpers: Helpers,
): YimengReworkRouteRecovery {
  const error = helpers.responseError
  const root = exact(value, RECOVERY_FIELDS, 'reworkRouteRecovery', error)
  if (root.schema !== 'jason.qingmu-bounded-rework-route-recovery.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.findingId !== request.findingId
    || root.expectedSubjectSha256 !== request.expectedSubjectSha256
    || root.expectedRouteRevision !== request.expectedRouteRevision
    || root.expectedRouteSha256 !== request.expectedRouteSha256 || root.idempotencyKey !== request.idempotencyKey
    || typeof root.found !== 'boolean' || (root.found ? root.result === null : root.result !== null)) {
    throw error('bounded route recovery coordinates mismatch')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-recovery.v1', projectId: request.projectId,
    episodeId: request.episodeId, findingId: request.findingId,
    expectedSubjectSha256: request.expectedSubjectSha256, expectedRouteRevision: request.expectedRouteRevision,
    expectedRouteSha256: request.expectedRouteSha256, idempotencyKey: request.idempotencyKey, found: root.found,
    result: root.result === null ? null : routeResult(root.result, {
      coordinates: request, expectedSubjectSha256: request.expectedSubjectSha256,
      expectedRevision: request.expectedRouteRevision + 1,
    }, helpers),
  }
}

function authorityResult(
  value: unknown, request: YimengForwardedReworkRouteAuthorityProbeRequest, helpers: Helpers,
): YimengReworkRouteAuthorityProbe {
  const error = helpers.responseError
  const root = exact(value, AUTHORITY_FIELDS, 'reworkRouteAuthorityProbe', error)
  if (root.schema !== 'jason.qingmu-bounded-rework-route-authority-probe.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.findingId !== request.findingId
    || root.subjectSnapshotSha256 !== request.methodProjection.subjectSnapshotSha256
    || root.methodProjectionSha256 !== request.methodProjectionSha256
    || root.rulesSha256 !== request.methodProjection.rulesSha256
    || root.lockRulesSha256 !== request.methodProjection.lockRulesSha256
    || typeof root.currentRouteRecorded !== 'boolean' || root.routeRecorded !== root.currentRouteRecorded
    || root.findingClosed !== false || root.selectionChanged !== false || root.stageDecisionChanged !== false
    || root.lockInvalidated !== false || root.taskCreated !== false || root.providerCalls !== 0
    || root.reworkExecuted !== false || root.humanSignoffInferred !== false) {
    throw error('bounded route authority probe binding mismatch')
  }
  const latestRoute = root.latestRoute === null ? null : routeResult(root.latestRoute, { coordinates: request }, helpers)
  if (root.currentRouteRecorded && (latestRoute === null
    || latestRoute.route.subjectSnapshotSha256 !== request.methodProjection.subjectSnapshotSha256
    || latestRoute.route.methodProjectionSha256 !== request.methodProjectionSha256
    || latestRoute.route.rulesSha256 !== request.methodProjection.rulesSha256
    || latestRoute.route.lockRulesSha256 !== request.methodProjection.lockRulesSha256
    || !isDeepStrictEqual(latestRoute.route.subject, request.methodProjection.subject)
    || !isDeepStrictEqual(latestRoute.route.definition, request.methodProjection.definition)
    || !isDeepStrictEqual(latestRoute.route.routeInstruction, request.methodProjection.routeInstruction))) {
    throw error('bounded route current-record claim mismatch')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-authority-probe.v1', projectId: request.projectId,
    episodeId: request.episodeId, findingId: request.findingId,
    subjectSnapshotSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: request.methodProjectionSha256, rulesSha256: request.methodProjection.rulesSha256,
    lockRulesSha256: request.methodProjection.lockRulesSha256, latestRoute,
    currentRouteRecorded: root.currentRouteRecorded, routeRecorded: root.currentRouteRecorded,
    findingClosed: false, selectionChanged: false, stageDecisionChanged: false, lockInvalidated: false,
    taskCreated: false, providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
  }
}

/** Derive the only exact Host Method request accepted for a route record or fresh authority probe. */
export function prepareCurrentReworkRouteMethodRequest(
  endpoint: 'recordReworkRoute' | 'probeReworkRouteAuthority', payload: unknown, helpers: Helpers,
): YimengCommandJsonObject {
  const request = endpoint === 'recordReworkRoute' ? recordIntent(payload, helpers) : probeIntent(payload, helpers)
  return {
    projectId: request.projectId, episodeId: request.episodeId,
    frameId: request.frameId, findingId: request.findingId,
  }
}

/** Prepare one non-retried POST or one original-coordinate GET receipt lookup. */
export function prepareReworkRouteCommand(
  endpoint: 'recordReworkRoute' | 'recoverReworkRoute' | 'probeReworkRouteAuthority',
  payload: unknown,
  helpers: Helpers,
  currentMethodValue?: unknown,
): PreparedCommand {
  if (endpoint === 'recordReworkRoute') {
    if (currentMethodValue === undefined) throw helpers.responseError('current bounded route Method is unavailable')
    const request = forwardedRecord(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/shots/${encodeURIComponent(request.frameId)}/findings/${encodeURIComponent(request.findingId)}/rework-route/routes`,
      request: {
        method: 'POST',
        body: {
          expectedSubjectSha256: request.expectedSubjectSha256,
          expectedRouteRevision: request.expectedRouteRevision,
          expectedRouteSha256: request.expectedRouteSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          idempotencyKey: request.idempotencyKey,
        },
      },
      normalize: (value, token) => routeResult(value, {
        coordinates: request, expectedSubjectSha256: request.expectedSubjectSha256,
        expectedRevision: request.expectedRouteRevision + 1,
        method: {
          projection: request.methodProjection, projectionSha256: request.methodProjectionSha256,
          attestation: request.methodAttestation,
        },
        token,
      }, helpers),
    }
  }
  if (endpoint === 'probeReworkRouteAuthority') {
    if (currentMethodValue === undefined) throw helpers.responseError('current bounded route Method is unavailable')
    const request = forwardedProbe(payload, currentMethodValue, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/shots/${encodeURIComponent(request.frameId)}/findings/${encodeURIComponent(request.findingId)}/rework-route/authority-probe`,
      request: {
        method: 'POST',
        body: {
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
        },
      },
      normalize: value => authorityResult(value, request, helpers),
    }
  }
  const request = recordIntent(payload, helpers)
  const query = new URLSearchParams({
    expectedSubjectSha256: request.expectedSubjectSha256,
    expectedRouteRevision: String(request.expectedRouteRevision),
    ...(request.expectedRouteSha256 === null ? {} : { expectedRouteSha256: request.expectedRouteSha256 }),
  })
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/shots/${encodeURIComponent(request.frameId)}/findings/${encodeURIComponent(request.findingId)}/rework-route/route-command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: value => recoveryResult(value, request, helpers),
  }
}
