/** Host-only bounded route command fixtures; they never close a Finding or execute rework. */
import { createHash, createHmac } from 'node:crypto'
import type { ImagoReworkRouteMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  REWORK_ROUTE_IDS,
  REWORK_ROUTE_PLAN_RULES_SHA256,
  reworkRouteDefinition,
  reworkRouteInstruction,
  reworkRouteSha,
  reworkRouteSubject,
} from '../../qingmu-yimeng-read-adapter/tests/rework-route-fixture.ts'
import type {
  YimengForwardedReworkRouteAuthorityProbeRequest,
  YimengProbeReworkRouteAuthorityRequest,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteAuthorityProbe,
  YimengReworkRouteRecovery,
  YimengReworkRouteResult,
} from '../src/types.ts'

export function reworkRouteMethodResponse(key: string): ImagoReworkRouteMethodResponse {
  const ruleBindings = {
    'docs/qingmu-os/report-source.md': '1'.repeat(64),
    'pipeline/v6-stage-contracts.json': '2'.repeat(64),
    'scripts/compile_qingmu_rework_route_method.py': '3'.repeat(64),
  }
  const lockRuleBindings = { 'pipeline/v6-stage-contracts.json': '2'.repeat(64) }
  const lockRulesSha256 = reworkRouteSha(lockRuleBindings)
  const subject = reworkRouteSubject(REWORK_ROUTE_PLAN_RULES_SHA256, lockRulesSha256)
  const projection = {
    schema: 'qingmu.imago-bounded-rework-route-method.v1' as const,
    subject,
    subjectSnapshotSha256: reworkRouteSha(subject),
    definition: reworkRouteDefinition(subject),
    routeInstruction: reworkRouteInstruction(subject),
    ruleBindings,
    rulesSha256: reworkRouteSha(ruleBindings),
    lockRuleBindings,
    lockRulesSha256,
  }
  const projectionSha256 = reworkRouteSha(projection)
  const unsigned = {
    schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: projection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-bounded-rework-route-method-adapter-result.v1',
    projection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(continuityJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

export function reworkRouteRecordRequest(
  method = reworkRouteMethodResponse('unused-key'),
): YimengRecordReworkRouteRequest {
  return {
    ...REWORK_ROUTE_IDS,
    expectedSubjectSha256: method.projection.subjectSnapshotSha256,
    expectedRouteRevision: 0,
    expectedRouteSha256: null,
    idempotencyKey: 'rework-route-command-001',
  }
}

export function reworkRouteProbeRequest(): YimengProbeReworkRouteAuthorityRequest {
  return { ...REWORK_ROUTE_IDS }
}

export function reworkRouteCommandResult(
  request: YimengRecordReworkRouteRequest,
  method: ImagoReworkRouteMethodResponse,
  token: string,
): YimengReworkRouteResult {
  const route = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    revision: request.expectedRouteRevision + 1,
    subject: method.projection.subject,
    subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
    definition: method.projection.definition,
    routeInstruction: method.projection.routeInstruction,
    methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
    actorId: 'route-owner',
    actorNaturalPersonId: 'natural-route-owner',
    authSessionId: createHash('sha256').update(token, 'utf8').digest('hex'),
    eventId: 'event-route-record-1',
    changeSetId: 'changeset-route-record-1',
    routedAt: '2026-08-28T01:00:00Z',
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1',
    route,
    routeSha256: reworkRouteSha(route),
    receiptId: 'receipt-route-record-1',
    outboxEventId: 'outbox-route-record-1',
    routeRecorded: true,
    findingClosed: false,
    selectionChanged: false,
    stageDecisionChanged: false,
    lockInvalidated: false,
    taskCreated: false,
    providerCalls: 0,
    reworkExecuted: false,
    humanSignoffInferred: false,
  }
}

export function reworkRouteRecovery(
  request: YimengRecordReworkRouteRequest,
  result: YimengReworkRouteResult | null,
): YimengReworkRouteRecovery {
  return {
    schema: 'jason.qingmu-bounded-rework-route-recovery.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    expectedSubjectSha256: request.expectedSubjectSha256,
    expectedRouteRevision: request.expectedRouteRevision,
    expectedRouteSha256: request.expectedRouteSha256,
    idempotencyKey: request.idempotencyKey,
    found: result !== null,
    result,
  }
}

export function reworkRouteAuthorityProbe(
  request: YimengForwardedReworkRouteAuthorityProbeRequest,
  latestRoute: YimengReworkRouteResult | null,
): YimengReworkRouteAuthorityProbe {
  const currentRouteRecorded = latestRoute !== null
  return {
    schema: 'jason.qingmu-bounded-rework-route-authority-probe.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    subjectSnapshotSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256,
    lockRulesSha256: request.methodProjection.lockRulesSha256,
    latestRoute,
    currentRouteRecorded,
    routeRecorded: currentRouteRecorded,
    findingClosed: false,
    selectionChanged: false,
    stageDecisionChanged: false,
    lockInvalidated: false,
    taskCreated: false,
    providerCalls: 0,
    reworkExecuted: false,
    humanSignoffInferred: false,
  }
}
