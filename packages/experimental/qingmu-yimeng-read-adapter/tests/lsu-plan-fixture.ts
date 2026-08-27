/** Synthetic complete-scope LSU plan facts; no Provider call, Stage approval, or signoff is involved. */
import { createHash } from 'node:crypto'
import type {
  YimengLsuPlanDefinition,
  YimengLsuPlanSealResult,
  YimengLsuPlanSourceResponse,
  YimengLsuPlanSubject,
} from '../src/types.ts'
import { continuityJson } from './continuity-fixture.ts'
import { productionUnitDefinition } from './production-unit-fixture.ts'

export const LSU_PLAN_IDS = { projectId: 'plan-project', episodeId: 'plan-episode' }
export const LSU_PLAN_LOCK_RULES_SHA256 = '9'.repeat(64)

export function lsuPlanSha(value: unknown): string {
  return createHash('sha256').update(continuityJson(value), 'utf8').digest('hex')
}

export function lsuPlanSubject(): YimengLsuPlanSubject {
  return {
    schema: 'jason.qingmu-lsu-plan-subject.v1',
    ...LSU_PLAN_IDS,
    productionUnits: [
      {
        unitId: 'LSU17', groupId: 'group-three', bindingRevision: 2,
        bindingSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64),
      },
      {
        unitId: 'LSU18', groupId: 'group-four', bindingRevision: 1,
        bindingSha256: 'd'.repeat(64), sourceSnapshotSha256: 'e'.repeat(64),
      },
    ],
    productionBlueprintLock: {
      lockId: 'PRODUCTION_BLUEPRINT_LOCK', stageId: 'C5F', scopeInstance: 'GLOBAL',
      artifactRecordRevision: 3, artifactRecordSha256: 'f'.repeat(64),
      decisionId: 'decision-c5f', eventSha256: '7'.repeat(64),
    },
  }
}

export function lsuPlanDefinition(): YimengLsuPlanDefinition {
  return {
    id: 'IMAGO-V6-LSU-PLAN', version: productionUnitDefinition().version, scope: 'per_episode',
    unitIdPattern: 'LSU[0-9]{2,}', stages: productionUnitDefinition().stages,
    requiredLockId: 'PRODUCTION_BLUEPRINT_LOCK', requiredLockStageId: 'C5F',
    requiredLockScopeInstance: 'GLOBAL', declarationPolicy: 'exact_current_instantiated_units',
    operation: 'seal_current_lsu_plan', planSealingAllowed: true, stageApprovalAllowed: false,
    lockActivationAllowed: false, reworkExecutionAllowed: false, providerCalls: 0,
  }
}

export interface LsuPlanSealFixtureOptions {
  readonly subject?: YimengLsuPlanSubject
  readonly definition?: YimengLsuPlanDefinition
  readonly revision?: number
  readonly methodProjectionSha256?: string
  readonly rulesSha256?: string
  readonly lockRulesSha256?: string
  readonly authSessionId?: string
}

export function lsuPlanSealResult(options: LsuPlanSealFixtureOptions = {}): YimengLsuPlanSealResult {
  const subject = options.subject ?? lsuPlanSubject()
  const seal = {
    ...LSU_PLAN_IDS,
    revision: options.revision ?? 1,
    subject,
    subjectSnapshotSha256: lsuPlanSha(subject),
    definition: options.definition ?? lsuPlanDefinition(),
    methodProjectionSha256: options.methodProjectionSha256 ?? '1'.repeat(64),
    rulesSha256: options.rulesSha256 ?? '2'.repeat(64),
    lockRulesSha256: options.lockRulesSha256 ?? LSU_PLAN_LOCK_RULES_SHA256,
    actorId: 'plan-owner', actorNaturalPersonId: 'natural-plan-owner',
    authSessionId: options.authSessionId ?? '3'.repeat(64),
    eventId: 'event-plan-1', changeSetId: 'changeset-plan-1', sealedAt: '2026-08-28T00:00:00Z',
  }
  return {
    schema: 'jason.qingmu-lsu-plan-seal-result.v1', seal, sealSha256: lsuPlanSha(seal),
    receiptId: 'receipt-plan-1', outboxEventId: 'outbox-plan-1', planSealed: true,
    stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
    humanSignoffInferred: false, reworkExecuted: false,
  }
}

export function lsuPlanFeed(
  lockRulesSha256 = LSU_PLAN_LOCK_RULES_SHA256,
): YimengLsuPlanSourceResponse {
  const subject = lsuPlanSubject()
  return {
    schema: 'jason.qingmu-lsu-plan-feed.v1', ...LSU_PLAN_IDS,
    capabilities: { canSealPlan: true }, subject, subjectSnapshotSha256: lsuPlanSha(subject),
    availability: { status: 'available', reason: null }, latestSeal: null,
    latestSealSourceCurrent: false, currentLockRulesSha256: lockRulesSha256,
    providerCalls: 0, stageApprovalGranted: false, lockActivated: false, reworkExecuted: false,
  }
}
