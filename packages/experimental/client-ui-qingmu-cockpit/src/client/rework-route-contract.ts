/* oxlint-disable typescript/no-unnecessary-condition -- Private RPC DTOs are untrusted at this runtime boundary. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Exact false/0 values deny adjacent authority. */
import type {
  ImagoReworkRouteMethodResponse, YimengReworkRouteAuthorityProbe, YimengReworkRouteRecovery,
  YimengReworkRouteResult, YimengReworkRouteSourceResponse, YimengShotFinding,
} from './contracts.ts'
import type { ReworkRouteRecoveryMarker } from './rework-route-recovery.ts'
import { digestShotFinding } from './shot-finding-contract.ts'

/**
 * Project and shot coordinates for a rework-route operation.
 */
export interface ReworkRouteCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly findingId: string
}

/**
 * Fresh method and source authority required to route rework.
 */
export interface ReworkRouteAuthority {
  readonly method: ImagoReworkRouteMethodResponse
  readonly source: YimengReworkRouteSourceResponse
  readonly probe: YimengReworkRouteAuthorityProbe
}

function requireRoute(condition: boolean): asserts condition {
  if (!condition) throw new Error('Bounded rework route does not match the current Finding authority')
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value !== '' && value === value.trim()
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/.test(value)
}
function flags(value: Record<string, unknown>) {
  requireRoute(value.findingClosed === false && value.selectionChanged === false
    && value.stageDecisionChanged === false && value.lockInvalidated === false
    && value.taskCreated === false && value.providerCalls === 0 && value.reworkExecuted === false
    && value.humanSignoffInferred === false)
}
async function sameJson(left: unknown, right: unknown): Promise<boolean> {
  return await digestShotFinding(left) === await digestShotFinding(right)
}
function findingPayloadMatches(route: Record<string, unknown>, finding: YimengShotFinding) {
  requireRoute(route.id === finding.id && route.eventId === finding.eventId
    && route.subjectSnapshotSha256 === finding.subjectSnapshotSha256 && route.status === 'OPEN'
    && route.methodProjectionSha256 === finding.methodProjectionSha256 && route.rulesSha256 === finding.rulesSha256
    && route.timecode === finding.timecode && route.observation === finding.observation
    && Array.isArray(route.evidenceRefs) && JSON.stringify(route.evidenceRefs) === JSON.stringify(finding.evidenceRefs)
    && route.earliestOwner === finding.earliestOwner && route.ownerReason === finding.ownerReason
    && route.severity === finding.severity && route.suggestion === finding.suggestion
    && route.reworkScope === finding.reworkScope)
}

/**
 * Validate the Host-derived Method against this exact current OPEN Finding and authority chain.
 * @param method - Current IMAGO method result to verify.
 * @param coordinates - Project and artifact coordinates for the operation.
 * @param finding - Shot finding bound to the operation.
 */
export async function verifyReworkRouteMethod(
  method: ImagoReworkRouteMethodResponse,
  coordinates: ReworkRouteCoordinates,
  finding: YimengShotFinding,
): Promise<void> {
  const projection = method?.projection
  const subject = projection?.subject
  const definition = projection?.definition
  const instruction = projection?.routeInstruction
  const proof = method?.methodAttestation
  requireRoute(method?.schema === 'qingmu.imago-bounded-rework-route-method-adapter-result.v1'
    && projection?.schema === 'qingmu.imago-bounded-rework-route-method.v1'
    && subject?.schema === 'jason.qingmu-bounded-rework-route-subject.v1'
    && subject.projectId === coordinates.projectId && subject.episodeId === coordinates.episodeId
    && subject.selectedVideo?.frameId === coordinates.frameId && subject.finding?.id === coordinates.findingId
    && finding.status === 'OPEN' && sha(projection.subjectSnapshotSha256)
    && sha(projection.rulesSha256) && sha(projection.lockRulesSha256)
    && typeof projection.ruleBindings === 'object' && projection.ruleBindings !== null
    && Object.keys(projection.ruleBindings).length > 0 && Object.values(projection.ruleBindings).every(sha)
    && typeof projection.lockRuleBindings === 'object' && projection.lockRuleBindings !== null
    && Object.keys(projection.lockRuleBindings).length > 0 && Object.values(projection.lockRuleBindings).every(sha)
    && proof?.schema === 'qingmu.imago-bounded-rework-route-method-attestation.v1'
    && proof.algorithm === 'hmac-sha256' && proof.subjectSnapshotSha256 === projection.subjectSnapshotSha256
    && proof.methodProjectionSha256 === method.projectionSha256 && sha(proof.signature) && sha(method.projectionSha256))
  findingPayloadMatches(subject.finding as unknown as Record<string, unknown>, finding)
  requireRoute(await sameJson(subject.selectedVideo, finding.subject)
    && await digestShotFinding(subject) === projection.subjectSnapshotSha256
    && await digestShotFinding(projection.ruleBindings) === projection.rulesSha256
    && await digestShotFinding(projection.lockRuleBindings) === projection.lockRulesSha256
    && await digestShotFinding(projection) === method.projectionSha256)

  const unit = subject.productionUnit
  const unitShots = unit?.source?.shots?.filter(shot => shot.frameId === coordinates.frameId)
  const planUnit = subject.sealedPlan?.subject?.productionUnits?.find(item => item.unitId === unit?.unitId)
  requireRoute(identifier(unit?.unitId) && Number.isSafeInteger(unit.bindingRevision) && unit.bindingRevision > 0
    && sha(unit.bindingSha256) && sha(unit.sourceSnapshotSha256)
    && unit.source?.projectId === coordinates.projectId && unit.source.episodeId === coordinates.episodeId
    && Array.isArray(unitShots) && unitShots.length === 1
    && unitShots[0]?.frameNo === finding.subject.frameNo
    && unitShots[0]?.frameContentSha256 === finding.subject.frameContentSha256
    && await digestShotFinding(unit.source) === unit.sourceSnapshotSha256
    && subject.sealedPlan?.revision > 0 && sha(subject.sealedPlan.sealSha256)
    && sha(subject.sealedPlan.subjectSnapshotSha256) && sha(subject.sealedPlan.methodProjectionSha256)
    && sha(subject.sealedPlan.rulesSha256) && subject.sealedPlan.lockRulesSha256 === projection.lockRulesSha256
    && subject.sealedPlan.subject?.projectId === coordinates.projectId
    && subject.sealedPlan.subject.episodeId === coordinates.episodeId
    && await digestShotFinding(subject.sealedPlan.subject) === subject.sealedPlan.subjectSnapshotSha256
    && planUnit?.groupId === unit.source.groupId && planUnit.bindingRevision === unit.bindingRevision
    && planUnit.bindingSha256 === unit.bindingSha256 && planUnit.sourceSnapshotSha256 === unit.sourceSnapshotSha256
    && subject.sealedPlan.subject.productionBlueprintLock?.lockId === 'PRODUCTION_BLUEPRINT_LOCK'
    && subject.sealedPlan.subject.productionBlueprintLock.stageId === 'C5F')

  requireRoute(definition?.id === 'IMAGO-V6-BOUNDED-REWORK-ROUTE'
    && definition.scope === 'per_finding' && definition.operation === 'record_bounded_rework_route'
    && definition.requiredFindingStatus === 'OPEN' && definition.oneEarliestOwnerPerFinding === true
    && definition.groupByEarliestOwner === true && definition.timecodeEvidenceAndScopeRequired === true
    && definition.findingRuleComparison?.recordedRulesSha256 === finding.rulesSha256
    && sha(definition.findingRuleComparison.currentRulesSha256)
    && definition.findingRuleComparison.changed
      === (finding.rulesSha256 !== definition.findingRuleComparison.currentRulesSha256)
    && definition.findingRuleComparison.effect === 'evidence_only_no_scope_expansion'
    && definition.findingClosureAllowed === false && definition.taskCreationAllowed === false
    && definition.selectionChangeAllowed === false && definition.stageDecisionChangeAllowed === false
    && definition.lockInvalidationAllowed === false && definition.reworkExecutionAllowed === false
    && definition.paidGenerationAuthorized === false && definition.automaticRetry === false
    && definition.providerChangeAuthorized === false && definition.unboundedRedoAuthorized === false
    && definition.completionReleaseAllowed === false && definition.providerCalls === 0)
  requireRoute(instruction?.state === 'BOUNDED_REWORK_ROUTED'
    && instruction.outputSchema === 'IMAGO-V6-BoundedReworkRoute-v1'
    && instruction.findingId === finding.id && instruction.findingEventId === finding.eventId
    && instruction.unitId === unit.unitId && instruction.earliestOwner === finding.earliestOwner
    && identifier(instruction.ownerRoleId) && (instruction.ownerScope === 'global' || instruction.ownerScope === 'per_lsu')
    && identifier(instruction.ownerScopeInstance) && instruction.scopeExpansionForbidden === true
    && instruction.boundedItem?.timecode === finding.timecode && instruction.boundedItem.severity === finding.severity
    && instruction.boundedItem.observation === finding.observation
    && JSON.stringify(instruction.boundedItem.evidenceRefs) === JSON.stringify(finding.evidenceRefs)
    && instruction.boundedItem.ownerReason === finding.ownerReason
    && instruction.boundedItem.suggestion === finding.suggestion
    && instruction.boundedItem.reworkScope === finding.reworkScope)
}

async function verifyRouteResult(value: unknown, coordinates: ReworkRouteCoordinates): Promise<YimengReworkRouteResult> {
  requireRoute(typeof value === 'object' && value !== null)
  const result = value as unknown as YimengReworkRouteResult
  const route = result.route
  requireRoute(result.schema === 'jason.qingmu-bounded-rework-route-result.v1' && result.routeRecorded === true
    && route?.projectId === coordinates.projectId && route.episodeId === coordinates.episodeId
    && route.findingId === coordinates.findingId && Number.isSafeInteger(route.revision) && route.revision > 0
    && route.subject?.projectId === coordinates.projectId && route.subject.episodeId === coordinates.episodeId
    && route.subject.selectedVideo?.frameId === coordinates.frameId
    && route.subject.finding?.id === coordinates.findingId
    && sha(route.subjectSnapshotSha256) && sha(route.methodProjectionSha256) && sha(route.rulesSha256)
    && sha(route.lockRulesSha256) && sha(result.routeSha256) && identifier(result.receiptId)
    && identifier(result.outboxEventId) && result.outboxEventId === route.eventId)
  flags(result as unknown as Record<string, unknown>)
  requireRoute(await digestShotFinding(route.subject) === route.subjectSnapshotSha256
    && await digestShotFinding(route) === result.routeSha256)
  return result
}

/**
 * Verify a single-POST receipt only as the original result, never as current display authority.
 * @param result - Command result to verify.
 * @param marker - Recovery marker to persist or clear.
 */
export async function verifyReworkRouteReceipt(
  result: YimengReworkRouteResult,
  marker: ReworkRouteRecoveryMarker,
): Promise<void> {
  const route = (await verifyRouteResult(result, marker)).route
  requireRoute(route.subjectSnapshotSha256 === marker.expectedSubjectSha256
    && route.revision === marker.expectedRouteRevision + 1)
}

/**
 * Validate GET-only recovery against every original CAS and idempotency coordinate.
 * @param recovery - Recovered backend result to verify.
 * @param marker - Recovery marker to persist or clear.
 * @returns Recovered result when it matches the marker, otherwise `null`.
 */
export async function verifyReworkRouteRecovery(
  recovery: YimengReworkRouteRecovery,
  marker: ReworkRouteRecoveryMarker,
): Promise<YimengReworkRouteResult | null> {
  requireRoute(recovery?.schema === 'jason.qingmu-bounded-rework-route-recovery.v1'
    && recovery.projectId === marker.projectId && recovery.episodeId === marker.episodeId
    && recovery.findingId === marker.findingId && recovery.expectedSubjectSha256 === marker.expectedSubjectSha256
    && recovery.expectedRouteRevision === marker.expectedRouteRevision
    && recovery.expectedRouteSha256 === marker.expectedRouteSha256
    && recovery.idempotencyKey === marker.idempotencyKey && typeof recovery.found === 'boolean')
  if (recovery.found === false) {
    requireRoute(recovery.result === null)
    return null
  }
  requireRoute(recovery.result !== null)
  await verifyReworkRouteReceipt(recovery.result, marker)
  return recovery.result
}

/**
 * Cross-check the fresh read and Host authority probe against one separately fetched current Method.
 * @param authority - Current authority record to verify.
 * @param coordinates - Project and artifact coordinates for the operation.
 * @param finding - Shot finding bound to the operation.
 */
export async function verifyReworkRouteAuthority(
  authority: ReworkRouteAuthority,
  coordinates: ReworkRouteCoordinates,
  finding: YimengShotFinding,
): Promise<void> {
  const { method, source, probe } = authority
  await verifyReworkRouteMethod(method, coordinates, finding)
  const projection = method.projection
  requireRoute(source?.schema === 'jason.qingmu-bounded-rework-route-feed.v1'
    && source.projectId === coordinates.projectId && source.episodeId === coordinates.episodeId
    && source.frameId === coordinates.frameId && source.findingId === coordinates.findingId
    && typeof source.capabilities?.canRecordRoute === 'boolean'
    && source.currentRouteRulesSha256 === projection.rulesSha256
    && source.currentPlanRulesSha256 === projection.subject.sealedPlan.rulesSha256
    && source.currentLockRulesSha256 === projection.lockRulesSha256
    && source.subject !== null && source.subjectSnapshotSha256 === projection.subjectSnapshotSha256
    && source.availability?.status === 'available' && source.availability.reason === null
    && await sameJson(source.subject, projection.subject))
  flags(source as unknown as Record<string, unknown>)

  requireRoute(probe?.schema === 'jason.qingmu-bounded-rework-route-authority-probe.v1'
    && probe.projectId === coordinates.projectId && probe.episodeId === coordinates.episodeId
    && probe.findingId === coordinates.findingId && probe.subjectSnapshotSha256 === projection.subjectSnapshotSha256
    && probe.methodProjectionSha256 === method.projectionSha256 && probe.rulesSha256 === projection.rulesSha256
    && probe.lockRulesSha256 === projection.lockRulesSha256
    && typeof probe.currentRouteRecorded === 'boolean' && probe.routeRecorded === probe.currentRouteRecorded
    && source.latestRouteSourceCurrent === probe.currentRouteRecorded)
  flags(probe as unknown as Record<string, unknown>)

  const sourceLatest = source.latestRoute === null ? null : await verifyRouteResult(source.latestRoute, coordinates)
  const probeLatest = probe.latestRoute === null ? null : await verifyRouteResult(probe.latestRoute, coordinates)
  requireRoute((sourceLatest === null) === (probeLatest === null)
    && (sourceLatest === null || sourceLatest.routeSha256 === probeLatest?.routeSha256))
  if (probe.currentRouteRecorded) {
    requireRoute(sourceLatest !== null && probeLatest !== null
      && sourceLatest.route.subjectSnapshotSha256 === projection.subjectSnapshotSha256
      && sourceLatest.route.methodProjectionSha256 === method.projectionSha256
      && sourceLatest.route.rulesSha256 === projection.rulesSha256
      && sourceLatest.route.lockRulesSha256 === projection.lockRulesSha256
      && await sameJson(sourceLatest.route.subject, projection.subject)
      && await sameJson(sourceLatest.route.definition, projection.definition)
      && await sameJson(sourceLatest.route.routeInstruction, projection.routeInstruction))
  }
}
