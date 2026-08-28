/** Validate one current bounded rework-route source without granting write or execution authority. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengLsuPlanSubject,
  YimengProductionUnitSource,
  YimengReworkRouteFinding,
  YimengReworkRouteResult,
  YimengReworkRouteSourceRequest,
  YimengReworkRouteSourceResponse,
  YimengReworkRouteSubject,
  YimengShotVideoSubject,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

/** The route source or its historical record is not the exact bounded contract. */
export class ReworkRouteSourceContractError extends Error {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReworkRouteSourceContractError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  const item = object(value, field)
  if (!isDeepStrictEqual(Object.keys(item).sort(), [...fields].sort())) {
    throw new ReworkRouteSourceContractError(`${field} fields mismatch`)
  }
  return item
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum = 8_000): string {
  if (typeof value !== 'string' || !value.isWellFormed() || pythonStrip(value) === ''
    || value.includes('\u0000') || Array.from(value).length > maximum) {
    throw new ReworkRouteSourceContractError(`${field} must be bounded text`)
  }
  return value
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) {
    throw new ReworkRouteSourceContractError(`${field} must be a canonical identifier`)
  }
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new ReworkRouteSourceContractError(`${field} must be sha256`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new ReworkRouteSourceContractError(`${field} must be a safe integer`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = id(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result)) {
    throw new ReworkRouteSourceContractError(`${field} must be RFC3339`)
  }
  return result
}

function selectedVideo(
  value: unknown, request: Pick<YimengReworkRouteSourceRequest, 'projectId' | 'episodeId' | 'frameId'>,
): YimengShotVideoSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
    'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256',
  ], 'reworkRouteSource.subject.selectedVideo')
  if (item.schema !== 'jason.qingmu-shot-video-subject.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || item.frameId !== request.frameId) {
    throw new ReworkRouteSourceContractError('selected video coordinates mismatch')
  }
  return {
    schema: 'jason.qingmu-shot-video-subject.v1', projectId: request.projectId,
    episodeId: request.episodeId, frameId: request.frameId,
    frameNo: integer(item.frameNo, 'selectedVideo.frameNo', 1),
    storyboardRevision: integer(item.storyboardRevision, 'selectedVideo.storyboardRevision'),
    frameContentSha256: sha(item.frameContentSha256, 'selectedVideo.frameContentSha256'),
    assetId: id(item.assetId, 'selectedVideo.assetId'),
    assetVersion: integer(item.assetVersion, 'selectedVideo.assetVersion'),
    assetSha256: sha(item.assetSha256, 'selectedVideo.assetSha256'),
  }
}

function finding(value: unknown, selected: YimengShotVideoSubject, digest: Digest): YimengReworkRouteFinding {
  const item = exact(value, [
    'id', 'eventId', 'subjectSnapshotSha256', 'timecode', 'observation', 'evidenceRefs',
    'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope', 'status',
    'methodProjectionSha256', 'rulesSha256',
  ], 'reworkRouteSource.subject.finding')
  if (item.status !== 'OPEN' || !['BLOCKER', 'MAJOR', 'MINOR'].includes(String(item.severity))
    || sha(item.subjectSnapshotSha256, 'finding.subjectSnapshotSha256')
      !== digest(selected, 'reworkRouteSource.subject.selectedVideo')
    || !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 32) {
    throw new ReworkRouteSourceContractError('Finding binding or status mismatch')
  }
  return {
    id: id(item.id, 'finding.id'), eventId: id(item.eventId, 'finding.eventId'),
    subjectSnapshotSha256: sha(item.subjectSnapshotSha256, 'finding.subjectSnapshotSha256'),
    timecode: text(item.timecode, 'finding.timecode', 128),
    observation: text(item.observation, 'finding.observation'),
    evidenceRefs: item.evidenceRefs.map((entry, index) => text(entry, `finding.evidenceRefs[${String(index)}]`, 1_024)),
    earliestOwner: id(item.earliestOwner, 'finding.earliestOwner'),
    ownerReason: text(item.ownerReason, 'finding.ownerReason'),
    severity: item.severity as YimengReworkRouteFinding['severity'],
    suggestion: text(item.suggestion, 'finding.suggestion'),
    reworkScope: text(item.reworkScope, 'finding.reworkScope'), status: 'OPEN',
    methodProjectionSha256: sha(item.methodProjectionSha256, 'finding.methodProjectionSha256'),
    rulesSha256: sha(item.rulesSha256, 'finding.rulesSha256'),
  }
}

function productionSource(
  value: unknown, request: Pick<YimengReworkRouteSourceRequest, 'projectId' | 'episodeId'>,
): YimengProductionUnitSource {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title', 'groupExecutionPromptSha256',
    'storyboardRevision', 'shots',
  ], 'reworkRouteSource.subject.productionUnit.source')
  if (item.schema !== 'jason.qingmu-production-unit-source.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || !Array.isArray(item.shots) || item.shots.length === 0) {
    throw new ReworkRouteSourceContractError('production unit source mismatch')
  }
  const seen = new Set<string>()
  let previous = 0
  const shots = item.shots.map((raw, index) => {
    const shot = exact(raw, ['frameId', 'frameNo', 'frameContentSha256'], `productionUnit.source.shots[${String(index)}]`)
    const frameId = id(shot.frameId, 'productionUnit.source.shot.frameId')
    const frameNo = integer(shot.frameNo, 'productionUnit.source.shot.frameNo', 1)
    if (seen.has(frameId) || frameNo <= previous) throw new ReworkRouteSourceContractError('production unit Shot order mismatch')
    seen.add(frameId)
    previous = frameNo
    return { frameId, frameNo, frameContentSha256: sha(shot.frameContentSha256, 'productionUnit.source.shot.frameContentSha256') }
  })
  return {
    schema: 'jason.qingmu-production-unit-source.v1', projectId: request.projectId, episodeId: request.episodeId,
    groupId: id(item.groupId, 'productionUnit.source.groupId'),
    groupNo: integer(item.groupNo, 'productionUnit.source.groupNo', 1),
    title: text(item.title, 'productionUnit.source.title'),
    groupExecutionPromptSha256: sha(item.groupExecutionPromptSha256, 'productionUnit.source.groupExecutionPromptSha256'),
    storyboardRevision: integer(item.storyboardRevision, 'productionUnit.source.storyboardRevision'), shots,
  }
}

function planSubject(
  value: unknown, request: Pick<YimengReworkRouteSourceRequest, 'projectId' | 'episodeId'>,
): YimengLsuPlanSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'productionUnits', 'productionBlueprintLock',
  ], 'reworkRouteSource.subject.sealedPlan.subject')
  if (item.schema !== 'jason.qingmu-lsu-plan-subject.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || !Array.isArray(item.productionUnits) || item.productionUnits.length === 0) {
    throw new ReworkRouteSourceContractError('sealed plan subject mismatch')
  }
  const units = item.productionUnits.map((raw, index) => {
    const unit = exact(raw, [
      'unitId', 'groupId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256',
    ], `sealedPlan.subject.productionUnits[${String(index)}]`)
    const unitId = id(unit.unitId, 'sealedPlan.unitId')
    if (!/^LSU[0-9]{2,}$/u.test(unitId)) throw new ReworkRouteSourceContractError('sealed plan unit ID mismatch')
    return {
      unitId, groupId: id(unit.groupId, 'sealedPlan.groupId'),
      bindingRevision: integer(unit.bindingRevision, 'sealedPlan.bindingRevision', 1),
      bindingSha256: sha(unit.bindingSha256, 'sealedPlan.bindingSha256'),
      sourceSnapshotSha256: sha(unit.sourceSnapshotSha256, 'sealedPlan.sourceSnapshotSha256'),
    }
  })
  if (new Set(units.map(unit => unit.unitId)).size !== units.length
    || new Set(units.map(unit => unit.groupId)).size !== units.length
    || units.some((unit, index) => index > 0 && unit.unitId <= (units[index - 1]?.unitId ?? ''))) {
    throw new ReworkRouteSourceContractError('sealed plan units must be unique and sorted')
  }
  const lock = exact(item.productionBlueprintLock, [
    'lockId', 'stageId', 'scopeInstance', 'artifactRecordRevision', 'artifactRecordSha256', 'decisionId', 'eventSha256',
  ], 'sealedPlan.subject.productionBlueprintLock')
  if (lock.lockId !== 'PRODUCTION_BLUEPRINT_LOCK' || lock.stageId !== 'C5F' || lock.scopeInstance !== 'GLOBAL') {
    throw new ReworkRouteSourceContractError('sealed plan lock mismatch')
  }
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1', projectId: request.projectId, episodeId: request.episodeId,
    productionUnits: units,
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK', stageId: 'C5F', scopeInstance: 'GLOBAL',
      artifactRecordRevision: integer(lock.artifactRecordRevision, 'sealedPlan.lock.artifactRecordRevision', 1),
      artifactRecordSha256: sha(lock.artifactRecordSha256, 'sealedPlan.lock.artifactRecordSha256'),
      decisionId: id(lock.decisionId, 'sealedPlan.lock.decisionId'),
      eventSha256: sha(lock.eventSha256, 'sealedPlan.lock.eventSha256'),
    },
  }
}

/** Validate the exact current Finding, Shot, LSU, sealed-plan and lock chain. */
export function normalizeReworkRouteSubject(
  value: unknown, request: YimengReworkRouteSourceRequest, digest: Digest,
): YimengReworkRouteSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'selectedVideo', 'finding', 'productionUnit', 'sealedPlan',
  ], 'reworkRouteSource.subject')
  if (item.schema !== 'jason.qingmu-bounded-rework-route-subject.v1' || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId) throw new ReworkRouteSourceContractError('route subject coordinates mismatch')
  const selected = selectedVideo(item.selectedVideo, request)
  const boundFinding = finding(item.finding, selected, digest)
  if (boundFinding.id !== request.findingId) throw new ReworkRouteSourceContractError('Finding ID mismatch')
  const production = exact(item.productionUnit, [
    'unitId', 'bindingRevision', 'bindingSha256', 'sourceSnapshotSha256', 'source',
  ], 'reworkRouteSource.subject.productionUnit')
  const source = productionSource(production.source, request)
  const sourceSnapshotSha256 = sha(production.sourceSnapshotSha256, 'productionUnit.sourceSnapshotSha256')
  if (digest(source, 'productionUnit.source') !== sourceSnapshotSha256
    || source.shots.filter(shot => shot.frameId === selected.frameId && shot.frameNo === selected.frameNo
      && shot.frameContentSha256 === selected.frameContentSha256).length !== 1) {
    throw new ReworkRouteSourceContractError('Finding Shot does not map to one current production unit')
  }
  const unitId = id(production.unitId, 'productionUnit.unitId')
  const bindingRevision = integer(production.bindingRevision, 'productionUnit.bindingRevision', 1)
  const bindingSha256 = sha(production.bindingSha256, 'productionUnit.bindingSha256')
  if (!/^LSU[0-9]{2,}$/u.test(unitId)) throw new ReworkRouteSourceContractError('production unit ID mismatch')
  const sealed = exact(item.sealedPlan, [
    'revision', 'sealSha256', 'subjectSnapshotSha256', 'methodProjectionSha256', 'rulesSha256',
    'lockRulesSha256', 'subject',
  ], 'reworkRouteSource.subject.sealedPlan')
  const plan = planSubject(sealed.subject, request)
  const planSubjectSha = sha(sealed.subjectSnapshotSha256, 'sealedPlan.subjectSnapshotSha256')
  if (digest(plan, 'sealedPlan.subject') !== planSubjectSha
    || plan.productionUnits.filter(unit => unit.unitId === unitId && unit.groupId === source.groupId
      && unit.bindingRevision === bindingRevision && unit.bindingSha256 === bindingSha256
      && unit.sourceSnapshotSha256 === sourceSnapshotSha256).length !== 1) {
    throw new ReworkRouteSourceContractError('production unit is not in the sealed plan')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-subject.v1', projectId: request.projectId, episodeId: request.episodeId,
    selectedVideo: selected, finding: boundFinding,
    productionUnit: { unitId, bindingRevision, bindingSha256, sourceSnapshotSha256, source },
    sealedPlan: {
      revision: integer(sealed.revision, 'sealedPlan.revision', 1),
      sealSha256: sha(sealed.sealSha256, 'sealedPlan.sealSha256'), subjectSnapshotSha256: planSubjectSha,
      methodProjectionSha256: sha(sealed.methodProjectionSha256, 'sealedPlan.methodProjectionSha256'),
      rulesSha256: sha(sealed.rulesSha256, 'sealedPlan.rulesSha256'),
      lockRulesSha256: sha(sealed.lockRulesSha256, 'sealedPlan.lockRulesSha256'), subject: plan,
    },
  }
}

function routeDefinition(value: unknown, subject: YimengReworkRouteSubject): Record<string, unknown> {
  const item = exact(value, [
    'id', 'version', 'scope', 'operation', 'requiredFindingStatus', 'oneEarliestOwnerPerFinding',
    'groupByEarliestOwner', 'timecodeEvidenceAndScopeRequired', 'findingRuleComparison',
    'findingClosureAllowed', 'taskCreationAllowed', 'selectionChangeAllowed', 'stageDecisionChangeAllowed',
    'lockInvalidationAllowed', 'reworkExecutionAllowed', 'paidGenerationAuthorized', 'automaticRetry',
    'providerChangeAuthorized', 'unboundedRedoAuthorized', 'completionReleaseAllowed', 'providerCalls',
  ], 'reworkRouteResult.route.definition')
  const comparison = exact(item.findingRuleComparison, [
    'recordedRulesSha256', 'currentRulesSha256', 'changed', 'effect',
  ], 'reworkRouteResult.route.definition.findingRuleComparison')
  const falseFields = [
    'findingClosureAllowed', 'taskCreationAllowed', 'selectionChangeAllowed', 'stageDecisionChangeAllowed',
    'lockInvalidationAllowed', 'reworkExecutionAllowed', 'paidGenerationAuthorized', 'automaticRetry',
    'providerChangeAuthorized', 'unboundedRedoAuthorized', 'completionReleaseAllowed',
  ]
  if (item.id !== 'IMAGO-V6-BOUNDED-REWORK-ROUTE' || item.scope !== 'per_finding'
    || item.operation !== 'record_bounded_rework_route' || item.requiredFindingStatus !== 'OPEN'
    || item.oneEarliestOwnerPerFinding !== true || item.groupByEarliestOwner !== true
    || item.timecodeEvidenceAndScopeRequired !== true || falseFields.some(field => item[field] !== false)
    || item.providerCalls !== 0 || comparison.recordedRulesSha256 !== subject.finding.rulesSha256
    || sha(comparison.currentRulesSha256, 'findingRuleComparison.currentRulesSha256') !== comparison.currentRulesSha256
    || typeof comparison.changed !== 'boolean'
    || comparison.changed !== (comparison.recordedRulesSha256 !== comparison.currentRulesSha256)
    || comparison.effect !== 'evidence_only_no_scope_expansion') {
    throw new ReworkRouteSourceContractError('route definition authority mismatch')
  }
  id(item.version, 'route definition version')
  return item
}

function routeInstruction(value: unknown, subject: YimengReworkRouteSubject): Record<string, unknown> {
  const item = exact(value, [
    'state', 'outputSchema', 'findingId', 'findingEventId', 'unitId', 'earliestOwner', 'ownerRoleId',
    'ownerScope', 'ownerScopeInstance', 'boundedItem', 'scopeExpansionForbidden',
  ], 'reworkRouteResult.route.routeInstruction')
  const bounded = exact(item.boundedItem, [
    'timecode', 'severity', 'observation', 'evidenceRefs', 'ownerReason', 'suggestion', 'reworkScope',
  ], 'reworkRouteResult.route.routeInstruction.boundedItem')
  const finding = subject.finding
  if (item.state !== 'BOUNDED_REWORK_ROUTED' || item.outputSchema !== 'IMAGO-V6-BoundedReworkRoute-v1'
    || item.findingId !== finding.id || item.findingEventId !== finding.eventId
    || item.unitId !== subject.productionUnit.unitId || item.earliestOwner !== finding.earliestOwner
    || !['global', 'per_lsu'].includes(String(item.ownerScope))
    || item.ownerScopeInstance !== (item.ownerScope === 'global' ? 'GLOBAL' : subject.productionUnit.unitId)
    || item.scopeExpansionForbidden !== true || !isDeepStrictEqual(bounded, {
    timecode: finding.timecode, severity: finding.severity, observation: finding.observation,
    evidenceRefs: finding.evidenceRefs, ownerReason: finding.ownerReason,
    suggestion: finding.suggestion, reworkScope: finding.reworkScope,
  })) throw new ReworkRouteSourceContractError('route instruction mismatch')
  id(item.ownerRoleId, 'route owner role')
  return item
}

function normalizeRouteResult(
  value: unknown, request: YimengReworkRouteSourceRequest, digest: Digest,
): YimengReworkRouteResult {
  const root = exact(value, [
    'schema', 'route', 'routeSha256', 'receiptId', 'outboxEventId', 'routeRecorded', 'findingClosed',
    'selectionChanged', 'stageDecisionChanged', 'lockInvalidated', 'taskCreated', 'providerCalls',
    'reworkExecuted', 'humanSignoffInferred',
  ], 'reworkRouteSource.latestRoute')
  if (root.schema !== 'jason.qingmu-bounded-rework-route-result.v1' || root.routeRecorded !== true
    || root.findingClosed !== false || root.selectionChanged !== false || root.stageDecisionChanged !== false
    || root.lockInvalidated !== false || root.taskCreated !== false || root.providerCalls !== 0
    || root.reworkExecuted !== false || root.humanSignoffInferred !== false) {
    throw new ReworkRouteSourceContractError('historical route authority mismatch')
  }
  const item = exact(root.route, [
    'projectId', 'episodeId', 'findingId', 'revision', 'subject', 'subjectSnapshotSha256', 'definition',
    'routeInstruction', 'methodProjectionSha256', 'rulesSha256', 'lockRulesSha256', 'actorId',
    'actorNaturalPersonId', 'authSessionId', 'eventId', 'changeSetId', 'routedAt',
  ], 'reworkRouteSource.latestRoute.route')
  const subject = normalizeReworkRouteSubject(item.subject, request, digest)
  const subjectSnapshotSha256 = sha(item.subjectSnapshotSha256, 'route.subjectSnapshotSha256')
  if (item.projectId !== request.projectId || item.episodeId !== request.episodeId || item.findingId !== request.findingId
    || digest(subject, 'route.subject') !== subjectSnapshotSha256) {
    throw new ReworkRouteSourceContractError('historical route coordinates mismatch')
  }
  const route = {
    projectId: request.projectId, episodeId: request.episodeId, findingId: request.findingId,
    revision: integer(item.revision, 'route.revision', 1), subject, subjectSnapshotSha256,
    definition: routeDefinition(item.definition, subject), routeInstruction: routeInstruction(item.routeInstruction, subject),
    methodProjectionSha256: sha(item.methodProjectionSha256, 'route.methodProjectionSha256'),
    rulesSha256: sha(item.rulesSha256, 'route.rulesSha256'),
    lockRulesSha256: sha(item.lockRulesSha256, 'route.lockRulesSha256'),
    actorId: id(item.actorId, 'route.actorId'), actorNaturalPersonId: id(item.actorNaturalPersonId, 'route.actorNaturalPersonId'),
    authSessionId: sha(item.authSessionId, 'route.authSessionId'), eventId: id(item.eventId, 'route.eventId'),
    changeSetId: id(item.changeSetId, 'route.changeSetId'), routedAt: timestamp(item.routedAt, 'route.routedAt'),
  }
  const routeSha256 = sha(root.routeSha256, 'routeSha256')
  if (digest(route, 'reworkRouteSource.latestRoute.route') !== routeSha256) {
    throw new ReworkRouteSourceContractError('historical route SHA mismatch')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1', route, routeSha256,
    receiptId: id(root.receiptId, 'route.receiptId'), outboxEventId: id(root.outboxEventId, 'route.outboxEventId'),
    routeRecorded: true, findingClosed: false, selectionChanged: false, stageDecisionChanged: false,
    lockInvalidated: false, taskCreated: false, providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
  }
}

/** Accept only exact source coordinates and Host-derived current rule SHAs. */
export function parseReworkRouteSourceRequest(value: unknown): YimengReworkRouteSourceRequest {
  try {
    const item = exact(value, [
      'projectId', 'episodeId', 'frameId', 'findingId', 'routeRulesSha256', 'planRulesSha256', 'lockRulesSha256',
    ], 'reworkRouteSource')
    return {
      projectId: id(item.projectId, 'reworkRouteSource.projectId'),
      episodeId: id(item.episodeId, 'reworkRouteSource.episodeId'),
      frameId: id(item.frameId, 'reworkRouteSource.frameId'),
      findingId: id(item.findingId, 'reworkRouteSource.findingId'),
      routeRulesSha256: sha(item.routeRulesSha256, 'reworkRouteSource.routeRulesSha256'),
      planRulesSha256: sha(item.planRulesSha256, 'reworkRouteSource.planRulesSha256'),
      lockRulesSha256: sha(item.lockRulesSha256, 'reworkRouteSource.lockRulesSha256'),
    }
  } catch {
    throw new ReworkRouteSourceContractError('reworkRouteSource accepts only exact coordinates and current rule SHAs')
  }
}

/** Normalize one fresh source feed while retaining a historical route as non-authoritative evidence. */
export function normalizeReworkRouteSource(
  value: unknown, request: YimengReworkRouteSourceRequest, digest: Digest,
): YimengReworkRouteSourceResponse {
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'findingId', 'capabilities', 'subject',
    'subjectSnapshotSha256', 'availability', 'latestRoute', 'latestRouteSourceCurrent',
    'currentRouteRulesSha256', 'currentPlanRulesSha256', 'currentLockRulesSha256', 'findingClosed',
    'selectionChanged', 'stageDecisionChanged', 'lockInvalidated', 'taskCreated', 'providerCalls',
    'reworkExecuted', 'humanSignoffInferred',
  ], 'reworkRouteSource')
  const capabilities = exact(root.capabilities, ['canRecordRoute'], 'reworkRouteSource.capabilities')
  const availability = exact(root.availability, ['status', 'reason'], 'reworkRouteSource.availability')
  if (root.schema !== 'jason.qingmu-bounded-rework-route-feed.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.frameId !== request.frameId || root.findingId !== request.findingId
    || root.currentRouteRulesSha256 !== request.routeRulesSha256
    || root.currentPlanRulesSha256 !== request.planRulesSha256
    || root.currentLockRulesSha256 !== request.lockRulesSha256 || typeof capabilities.canRecordRoute !== 'boolean'
    || typeof root.latestRouteSourceCurrent !== 'boolean' || root.findingClosed !== false
    || root.selectionChanged !== false || root.stageDecisionChanged !== false || root.lockInvalidated !== false
    || root.taskCreated !== false || root.providerCalls !== 0 || root.reworkExecuted !== false
    || root.humanSignoffInferred !== false) throw new ReworkRouteSourceContractError('route feed identity or authority mismatch')
  let subject: YimengReworkRouteSubject | null = null
  let subjectSnapshotSha256: string | null = null
  let reason: string | null
  if (root.subject === null) {
    if (root.subjectSnapshotSha256 !== null || availability.status !== 'unavailable') {
      throw new ReworkRouteSourceContractError('unavailable route subject mismatch')
    }
    reason = text(availability.reason, 'reworkRouteSource.availability.reason', 1_024)
  } else {
    subject = normalizeReworkRouteSubject(root.subject, request, digest)
    subjectSnapshotSha256 = sha(root.subjectSnapshotSha256, 'reworkRouteSource.subjectSnapshotSha256')
    if (digest(subject, 'reworkRouteSource.subject') !== subjectSnapshotSha256
      || availability.status !== 'available' || availability.reason !== null) {
      throw new ReworkRouteSourceContractError('current route subject mismatch')
    }
    reason = null
  }
  const latestRoute = root.latestRoute === null ? null : normalizeRouteResult(root.latestRoute, request, digest)
  if (root.latestRouteSourceCurrent && (subject === null || latestRoute === null
    || latestRoute.route.subjectSnapshotSha256 !== subjectSnapshotSha256
    || latestRoute.route.rulesSha256 !== request.routeRulesSha256
    || latestRoute.route.lockRulesSha256 !== request.lockRulesSha256
    || !isDeepStrictEqual(latestRoute.route.subject, subject))) {
    throw new ReworkRouteSourceContractError('current historical-route claim mismatch')
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-feed.v1', projectId: request.projectId, episodeId: request.episodeId,
    frameId: request.frameId, findingId: request.findingId,
    capabilities: { canRecordRoute: capabilities.canRecordRoute }, subject, subjectSnapshotSha256,
    availability: { status: subject === null ? 'unavailable' : 'available', reason },
    latestRoute, latestRouteSourceCurrent: root.latestRouteSourceCurrent,
    currentRouteRulesSha256: request.routeRulesSha256, currentPlanRulesSha256: request.planRulesSha256,
    currentLockRulesSha256: request.lockRulesSha256, findingClosed: false, selectionChanged: false,
    stageDecisionChanged: false, lockInvalidated: false, taskCreated: false, providerCalls: 0,
    reworkExecuted: false, humanSignoffInferred: false,
  }
}
