/** Synthetic OPEN Finding/Shot/LSU/plan/lock chain; no rework or Provider call is involved. */
import { createHash } from 'node:crypto'
import type {
  YimengReworkRouteResult,
  YimengReworkRouteSourceRequest,
  YimengReworkRouteSourceResponse,
  YimengReworkRouteSubject,
} from '../src/types.ts'
import { continuityJson } from './continuity-fixture.ts'

export const REWORK_ROUTE_IDS = {
  projectId: 'route-project', episodeId: 'route-episode', frameId: 'frame-7', findingId: 'finding-7',
}
export const REWORK_ROUTE_RULES_SHA256 = '4'.repeat(64)
export const REWORK_ROUTE_PLAN_RULES_SHA256 = '5'.repeat(64)
export const REWORK_ROUTE_LOCK_RULES_SHA256 = '6'.repeat(64)

export function reworkRouteSha(value: unknown): string {
  return createHash('sha256').update(continuityJson(value), 'utf8').digest('hex')
}

export function reworkRouteRequest(
  routeRulesSha256 = REWORK_ROUTE_RULES_SHA256,
  planRulesSha256 = REWORK_ROUTE_PLAN_RULES_SHA256,
  lockRulesSha256 = REWORK_ROUTE_LOCK_RULES_SHA256,
): YimengReworkRouteSourceRequest {
  return { ...REWORK_ROUTE_IDS, routeRulesSha256, planRulesSha256, lockRulesSha256 }
}

export function reworkRouteSubject(
  planRulesSha256 = REWORK_ROUTE_PLAN_RULES_SHA256,
  lockRulesSha256 = REWORK_ROUTE_LOCK_RULES_SHA256,
): YimengReworkRouteSubject {
  const selectedVideo = {
    schema: 'jason.qingmu-shot-video-subject.v1' as const,
    projectId: REWORK_ROUTE_IDS.projectId, episodeId: REWORK_ROUTE_IDS.episodeId,
    frameId: REWORK_ROUTE_IDS.frameId, frameNo: 7, storyboardRevision: 3,
    frameContentSha256: '7'.repeat(64), assetId: 'video-asset-7', assetVersion: 2, assetSha256: '8'.repeat(64),
  }
  const source = {
    schema: 'jason.qingmu-production-unit-source.v1' as const,
    projectId: REWORK_ROUTE_IDS.projectId, episodeId: REWORK_ROUTE_IDS.episodeId,
    groupId: 'group-7', groupNo: 7, title: '第七执行组', groupExecutionPromptSha256: '9'.repeat(64),
    storyboardRevision: 3,
    shots: [{ frameId: REWORK_ROUTE_IDS.frameId, frameNo: 7, frameContentSha256: '7'.repeat(64) }],
  }
  const productionUnit = {
    unitId: 'LSU07', bindingRevision: 2, bindingSha256: 'a'.repeat(64),
    sourceSnapshotSha256: reworkRouteSha(source), source,
  }
  const planSubject = {
    schema: 'jason.qingmu-lsu-plan-subject.v1' as const,
    projectId: REWORK_ROUTE_IDS.projectId, episodeId: REWORK_ROUTE_IDS.episodeId,
    productionUnits: [{
      unitId: productionUnit.unitId, groupId: source.groupId, bindingRevision: productionUnit.bindingRevision,
      bindingSha256: productionUnit.bindingSha256, sourceSnapshotSha256: productionUnit.sourceSnapshotSha256,
    }],
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK' as const, stageId: 'C5F' as const, scopeInstance: 'GLOBAL' as const,
      artifactRecordRevision: 2, artifactRecordSha256: 'b'.repeat(64),
      decisionId: 'decision-c5f-route', eventSha256: 'c'.repeat(64),
    },
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-subject.v1',
    projectId: REWORK_ROUTE_IDS.projectId, episodeId: REWORK_ROUTE_IDS.episodeId,
    selectedVideo,
    finding: {
      id: REWORK_ROUTE_IDS.findingId, eventId: 'finding-event-7',
      subjectSnapshotSha256: reworkRouteSha(selectedVideo), timecode: '00:00:03.000-00:00:04.000',
      observation: '手中道具在连续帧中消失', evidenceRefs: ['frame:72', 'frame:89'], earliestOwner: 'F',
      ownerReason: '视频生成阶段未保持锁定道具', severity: 'MAJOR', suggestion: '仅返修当前 LSU 的该镜头',
      reworkScope: 'LSU07/frame-7', status: 'OPEN', methodProjectionSha256: 'd'.repeat(64),
      rulesSha256: 'e'.repeat(64),
    },
    productionUnit,
    sealedPlan: {
      revision: 1, sealSha256: 'f'.repeat(64), subjectSnapshotSha256: reworkRouteSha(planSubject),
      methodProjectionSha256: '1'.repeat(64), rulesSha256: planRulesSha256,
      lockRulesSha256, subject: planSubject,
    },
  }
}

export function reworkRouteDefinition(subject = reworkRouteSubject()) {
  const currentRulesSha256 = '2'.repeat(64)
  return {
    id: 'IMAGO-V6-BOUNDED-REWORK-ROUTE', version: '1.0.0', scope: 'per_finding',
    operation: 'record_bounded_rework_route', requiredFindingStatus: 'OPEN', oneEarliestOwnerPerFinding: true,
    groupByEarliestOwner: true, timecodeEvidenceAndScopeRequired: true,
    findingRuleComparison: {
      recordedRulesSha256: subject.finding.rulesSha256, currentRulesSha256,
      changed: subject.finding.rulesSha256 !== currentRulesSha256, effect: 'evidence_only_no_scope_expansion',
    },
    findingClosureAllowed: false, taskCreationAllowed: false, selectionChangeAllowed: false,
    stageDecisionChangeAllowed: false, lockInvalidationAllowed: false, reworkExecutionAllowed: false,
    paidGenerationAuthorized: false, automaticRetry: false, providerChangeAuthorized: false,
    unboundedRedoAuthorized: false, completionReleaseAllowed: false, providerCalls: 0,
  } as const
}

export function reworkRouteInstruction(subject = reworkRouteSubject()) {
  return {
    state: 'BOUNDED_REWORK_ROUTED', outputSchema: 'IMAGO-V6-BoundedReworkRoute-v1',
    findingId: subject.finding.id, findingEventId: subject.finding.eventId,
    unitId: subject.productionUnit.unitId, earliestOwner: subject.finding.earliestOwner,
    ownerRoleId: 'imago-v6-video-generator', ownerScope: 'per_lsu',
    ownerScopeInstance: subject.productionUnit.unitId,
    boundedItem: {
      timecode: subject.finding.timecode, severity: subject.finding.severity,
      observation: subject.finding.observation, evidenceRefs: subject.finding.evidenceRefs,
      ownerReason: subject.finding.ownerReason, suggestion: subject.finding.suggestion,
      reworkScope: subject.finding.reworkScope,
    },
    scopeExpansionForbidden: true,
  } as const
}

export function reworkRouteResult(
  request = reworkRouteRequest(), subject = reworkRouteSubject(request.planRulesSha256, request.lockRulesSha256),
): YimengReworkRouteResult {
  const route = {
    projectId: request.projectId, episodeId: request.episodeId, findingId: request.findingId, revision: 1,
    subject, subjectSnapshotSha256: reworkRouteSha(subject), definition: reworkRouteDefinition(subject),
    routeInstruction: reworkRouteInstruction(subject), methodProjectionSha256: '3'.repeat(64),
    rulesSha256: request.routeRulesSha256, lockRulesSha256: request.lockRulesSha256,
    actorId: 'route-owner', actorNaturalPersonId: 'natural-route-owner', authSessionId: '0'.repeat(64),
    eventId: 'event-route-7', changeSetId: 'changeset-route-7', routedAt: '2026-08-28T01:00:00Z',
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1', route, routeSha256: reworkRouteSha(route),
    receiptId: 'receipt-route-7', outboxEventId: 'outbox-route-7', routeRecorded: true,
    findingClosed: false, selectionChanged: false, stageDecisionChanged: false, lockInvalidated: false,
    taskCreated: false, providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
  }
}

export function reworkRouteFeed(
  request = reworkRouteRequest(),
): YimengReworkRouteSourceResponse {
  const subject = reworkRouteSubject(request.planRulesSha256, request.lockRulesSha256)
  return {
    schema: 'jason.qingmu-bounded-rework-route-feed.v1',
    projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId, findingId: request.findingId,
    capabilities: { canRecordRoute: true }, subject, subjectSnapshotSha256: reworkRouteSha(subject),
    availability: { status: 'available', reason: null }, latestRoute: null, latestRouteSourceCurrent: false,
    currentRouteRulesSha256: request.routeRulesSha256, currentPlanRulesSha256: request.planRulesSha256,
    currentLockRulesSha256: request.lockRulesSha256, findingClosed: false, selectionChanged: false,
    stageDecisionChanged: false, lockInvalidated: false, taskCreated: false, providerCalls: 0,
    reworkExecuted: false, humanSignoffInferred: false,
  }
}
