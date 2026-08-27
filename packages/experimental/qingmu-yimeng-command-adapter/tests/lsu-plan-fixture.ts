/** Host-only LSU plan command fixtures; they model no Provider, approval, lock, or rework authority. */
import { createHash, createHmac } from 'node:crypto'
import type { ImagoLsuPlanMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  LSU_PLAN_IDS, lsuPlanDefinition, lsuPlanSha, lsuPlanSubject,
} from '../../qingmu-yimeng-read-adapter/tests/lsu-plan-fixture.ts'
import type {
  YimengForwardedLsuPlanAuthorityProbeRequest,
  YimengLsuPlanAuthorityProbe,
  YimengLsuPlanSealRecovery,
  YimengLsuPlanSealResult,
  YimengProbeLsuPlanAuthorityRequest,
  YimengSealLsuPlanRequest,
} from '../src/types.ts'

export function lsuPlanMethodResponse(key: string): ImagoLsuPlanMethodResponse {
  const subject = lsuPlanSubject()
  const ruleBindings = {
    'pipeline/v6-stage-contracts.json': '1'.repeat(64),
    'scripts/compile_qingmu_lsu_plan_method.py': '2'.repeat(64),
  }
  const lockRuleBindings = { 'pipeline/v6-stage-contracts.json': '1'.repeat(64) }
  const projection = {
    schema: 'qingmu.imago-lsu-plan-method.v1' as const,
    subject,
    subjectSnapshotSha256: lsuPlanSha(subject),
    definition: lsuPlanDefinition(),
    ruleBindings,
    rulesSha256: lsuPlanSha(ruleBindings),
    lockRuleBindings,
    lockRulesSha256: lsuPlanSha(lockRuleBindings),
  }
  const projectionSha256 = lsuPlanSha(projection)
  const unsigned = {
    schema: 'qingmu.imago-lsu-plan-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: projection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-lsu-plan-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(continuityJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

export function lsuPlanSealRequest(
  method = lsuPlanMethodResponse('unused-key'),
): YimengSealLsuPlanRequest {
  return {
    ...LSU_PLAN_IDS,
    expectedSubjectSha256: method.projection.subjectSnapshotSha256,
    expectedPlanRevision: 0,
    expectedPlanSha256: null,
    idempotencyKey: 'lsu-plan-command-001',
  }
}

export function lsuPlanProbeRequest(): YimengProbeLsuPlanAuthorityRequest {
  return { ...LSU_PLAN_IDS }
}

export function lsuPlanCommandResult(
  request: YimengSealLsuPlanRequest,
  method: ImagoLsuPlanMethodResponse,
  token: string,
): YimengLsuPlanSealResult {
  const seal = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    revision: request.expectedPlanRevision + 1,
    subject: method.projection.subject,
    subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
    definition: method.projection.definition,
    methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
    actorId: 'plan-owner',
    actorNaturalPersonId: 'natural-plan-owner',
    authSessionId: createHash('sha256').update(token, 'utf8').digest('hex'),
    eventId: 'event-plan-seal-1',
    changeSetId: 'changeset-plan-seal-1',
    sealedAt: '2026-08-28T00:00:00Z',
  }
  return {
    schema: 'jason.qingmu-lsu-plan-seal-result.v1', seal, sealSha256: lsuPlanSha(seal),
    receiptId: 'receipt-plan-seal-1', outboxEventId: 'outbox-plan-seal-1',
    planSealed: true, stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
    humanSignoffInferred: false, reworkExecuted: false,
  }
}

export function lsuPlanRecovery(
  request: YimengSealLsuPlanRequest,
  result: YimengLsuPlanSealResult | null,
): YimengLsuPlanSealRecovery {
  return {
    schema: 'jason.qingmu-lsu-plan-seal-recovery.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    expectedSubjectSha256: request.expectedSubjectSha256,
    expectedPlanRevision: request.expectedPlanRevision,
    expectedPlanSha256: request.expectedPlanSha256,
    idempotencyKey: request.idempotencyKey,
    found: result !== null,
    result,
  }
}

export function lsuPlanAuthorityProbe(
  request: YimengForwardedLsuPlanAuthorityProbeRequest,
  latestSeal: YimengLsuPlanSealResult | null,
): YimengLsuPlanAuthorityProbe {
  const currentPlanSealed = latestSeal !== null
  return {
    schema: 'jason.qingmu-lsu-plan-authority-probe.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    subjectSnapshotSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256,
    lockRulesSha256: request.methodProjection.lockRulesSha256,
    latestSeal,
    currentPlanSealed,
    planSealed: currentPlanSealed,
    stageApprovalGranted: false,
    lockActivated: false,
    providerCalls: 0,
    humanSignoffInferred: false,
    reworkExecuted: false,
  }
}
