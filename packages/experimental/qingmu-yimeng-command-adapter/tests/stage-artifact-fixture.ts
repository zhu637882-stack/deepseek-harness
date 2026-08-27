import { createHash, createHmac } from 'node:crypto'
import { sourceCanonical, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { stageArtifactCanonicalJson } from '../src/stage-artifact.ts'
import type {
  YimengCommitStageArtifactDecisionRequest,
  YimengForwardedStageArtifactAuthorityProbeRequest,
  YimengForwardedStageArtifactDecisionRequest,
  YimengImagoStageArtifactMethodProjection,
  YimengProbeStageArtifactAuthorityRequest,
  YimengRecoverStageArtifactDecisionRequest,
  YimengRecoverStageArtifactRegistrationRequest,
  YimengRegisterStageArtifactRequest,
  YimengStageArtifact,
  YimengStageArtifactAuthorityProbe,
  YimengStageArtifactDecisionResult,
  YimengStageArtifactDefinition,
  YimengStageArtifactResult,
} from '../src/types.ts'

export const STAGE_ARTIFACT_IDS = {
  projectId: 'artifact-project',
  episodeId: 'artifact-episode',
  stageId: 'A0',
  scopeInstance: 'GLOBAL',
} as const

const A0_CONTENT_SECTIONS = [
  'source_ledger',
  'audience_and_platform',
  'delivery_matrix',
  'scope_budget_tools',
  'rights_and_safety',
  'observable_acceptance',
  'open_decisions',
] as const

export function stageArtifactSha(value: unknown): string {
  return createHash('sha256').update(stageArtifactCanonicalJson(value, 'fixture'), 'utf8').digest('hex')
}

export function stageArtifact(): YimengStageArtifact {
  return {
    schema_version: '6.0.0-draft.1',
    workflow_version: '6.0.0-draft.2',
    stage_id: 'A0',
    scope_instance: 'GLOBAL',
    artifact_revision: 'artifact-revision-001',
    created_at: '2026-08-28T02:00:00+08:00',
    producer: { producer_id: 'natural-person-producer', producer_role: 'A0' },
    source_bindings: [],
    lock_bindings: [],
    content: Object.fromEntries(A0_CONTENT_SECTIONS.map(section => [section, {
      status: 'COMPLETE',
      summary: `已核验 ${section} 的具体业务证据并记录当前工件事实。`,
      evidence_refs: [`evidence/${section}.json`],
      data: {},
    }])),
    open_issues: [],
  }
}

export function stageArtifactDefinition(): YimengStageArtifactDefinition {
  return {
    id: 'IMAGO-V6-STAGE-ARTIFACT',
    version: '6.0.0-draft.2',
    stageId: 'A0',
    roleId: 'A0',
    scope: 'global',
    contractSha256: '6657c8181ad42891d5b2d67f0fb13ae5fa117849a7cee6ec2951f6e2c10cd3b6',
    artifactKind: 'ACCEPTANCE_CONTRACT',
    canonicalOutput: 'a0-acceptance-contract.json',
    requiredSourceStageIds: [],
    requiredLockIds: [],
    producesLockId: 'ACCEPTANCE_LOCK',
    operation: 'register_machine_validated_stage_artifact',
    stageArtifactRegistrationAllowed: true,
    dependencyAuthorityRequiredForApproval: true,
    dependencyAuthorityVerified: false,
    stageApprovalAllowed: false,
    lockActivationAllowed: false,
    lsuPlanSealingAllowed: false,
    reworkExecutionAllowed: false,
    providerCalls: 0,
  }
}

export function stageArtifactProjection(
  artifact = stageArtifact(),
  definition = stageArtifactDefinition(),
  ruleBindings: Readonly<Record<string, string>> = { 'pipeline/imago-os-current.json': 'a'.repeat(64) },
): YimengImagoStageArtifactMethodProjection {
  const subject = {
    schema: 'jason.qingmu-imago-stage-artifact.v1' as const,
    ...STAGE_ARTIFACT_IDS,
    artifactRevision: artifact.artifact_revision,
    artifactSha256: stageArtifactSha(artifact),
  }
  return {
    schema: 'qingmu.imago-stage-artifact-method.v1',
    subject,
    subjectSnapshotSha256: sourceSha(subject),
    machineValidation: {
      status: 'PASS',
      validator: 'scripts/validate_v6_stage_contracts.py',
      validatedArtifactSha256: subject.artifactSha256,
      contractSha256: definition.contractSha256,
    },
    definition,
    ruleBindings,
    rulesSha256: sourceSha(ruleBindings),
  }
}

export function stageArtifactMethodResponse(
  artifact: YimengStageArtifact,
  key: string,
  definition = stageArtifactDefinition(),
  ruleBindings?: Readonly<Record<string, string>>,
) {
  const projection = stageArtifactProjection(artifact, definition, ruleBindings)
  const projectionSha256 = sourceSha(projection)
  const unsigned = {
    schema: 'qingmu.imago-stage-artifact-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: projection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-stage-artifact-method-adapter-result.v1' as const,
    projection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(sourceCanonical(unsigned)).digest('hex'),
    },
  }
}

export function signStageArtifactRequest(request: YimengRegisterStageArtifactRequest, key: string): void {
  const projectionSha256 = sourceSha(request.methodProjection)
  const unsigned = {
    schema: 'qingmu.imago-stage-artifact-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  Object.assign(request, {
    expectedSubjectSha256: request.methodProjection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(sourceCanonical(unsigned)).digest('hex'),
    },
  })
}

export function stageArtifactRequest(key: string): YimengRegisterStageArtifactRequest {
  const artifact = stageArtifact()
  const projection = stageArtifactProjection(artifact)
  const request: YimengRegisterStageArtifactRequest = {
    ...STAGE_ARTIFACT_IDS,
    artifact,
    expectedSubjectSha256: '',
    expectedArtifactRecordRevision: 0,
    expectedArtifactRecordSha256: null,
    idempotencyKey: 'artifact-command-001',
    methodProjection: projection,
    methodProjectionSha256: '',
    methodAttestation: {
      schema: 'qingmu.imago-stage-artifact-method-attestation.v1',
      algorithm: 'hmac-sha256',
      subjectSnapshotSha256: '',
      methodProjectionSha256: '',
      signature: '',
    },
  }
  signStageArtifactRequest(request, key)
  return request
}

export function stageArtifactResult(
  request: YimengRegisterStageArtifactRequest,
  token: string,
): YimengStageArtifactResult {
  const artifactRecord = {
    schema: 'jason.qingmu-stage-artifact-record.v1' as const,
    changeSetId: 'stage-artifact-change-set-001',
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifact: structuredClone(request.artifact),
    artifactRevision: request.artifact.artifact_revision,
    artifactSha256: stageArtifactSha(request.artifact),
    subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: structuredClone(request.methodProjection.definition),
    machineValidation: structuredClone(request.methodProjection.machineValidation),
    methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256,
    artifactRecordRevision: request.expectedArtifactRecordRevision + 1,
    producerActorId: 'natural-person-producer',
    producerNaturalPersonId: 'natural-person-producer',
    authSessionId: createHash('sha256').update(token).digest('hex'),
    createdAt: '2026-08-28T02:01:00+08:00',
    stageArtifactRegistered: true as const,
    stageArtifactAvailable: false as const,
    dependencyAuthorityVerified: false as const,
    stageApprovalGranted: false as const,
    lockActivated: false as const,
    planSealed: false as const,
    providerCalls: 0 as const,
    humanSignoffInferred: false as const,
    reworkExecuted: false as const,
  }
  return {
    schema: 'jason.qingmu-stage-artifact-result.v1',
    artifactRecord,
    artifactRecordSha256: stageArtifactSha(artifactRecord),
    receiptId: 'stage-artifact-receipt-001',
    outboxEventId: 'stage-artifact-outbox-001',
  }
}

export function stageArtifactRecoveryRequest(
  request: YimengRegisterStageArtifactRequest,
): YimengRecoverStageArtifactRegistrationRequest {
  return {
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    expectedSubjectSha256: request.expectedSubjectSha256,
    idempotencyKey: request.idempotencyKey,
  }
}

export function stageArtifactDecisionRequest(
  registration: YimengRegisterStageArtifactRequest,
  receipt: YimengStageArtifactResult,
): YimengCommitStageArtifactDecisionRequest {
  return {
    ...STAGE_ARTIFACT_IDS,
    expectedArtifactRecordRevision: receipt.artifactRecord.artifactRecordRevision,
    expectedArtifactRecordSha256: receipt.artifactRecordSha256,
    expectedArtifactRevision: receipt.artifactRecord.artifactRevision,
    expectedArtifactSha256: receipt.artifactRecord.artifactSha256,
    expectedSubjectSha256: receipt.artifactRecord.subjectSnapshotSha256,
    artifact: structuredClone(registration.artifact),
    decision: 'approve',
    reason: '独立复核精确工件、当前依赖与锁后批准。',
    idempotencyKey: 'artifact-decision-command-001',
  }
}

export function stageArtifactDecisionSubmission(
  registration: YimengRegisterStageArtifactRequest,
  receipt: YimengStageArtifactResult,
): YimengForwardedStageArtifactDecisionRequest {
  const { artifact: _artifact, ...request } = stageArtifactDecisionRequest(registration, receipt)
  return {
    ...request,
    methodProjection: structuredClone(registration.methodProjection),
    methodProjectionSha256: registration.methodProjectionSha256,
    methodAttestation: structuredClone(registration.methodAttestation),
  }
}

export function stageArtifactDecisionResult(
  request: YimengCommitStageArtifactDecisionRequest | YimengForwardedStageArtifactDecisionRequest,
  token: string,
): YimengStageArtifactDecisionResult {
  const methodProjection = 'methodProjection' in request
    ? request.methodProjection
    : stageArtifactProjection(request.artifact)
  const methodProjectionSha256 = 'methodProjectionSha256' in request
    ? request.methodProjectionSha256
    : sourceSha(methodProjection)
  const targetId = stageArtifactSha({
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
  })
  const decisionEventSha256 = 'e'.repeat(64)
  const approved = request.decision === 'approve'
  const declaredLock = methodProjection.definition.producesLockId
  const producedLock = approved && declaredLock !== null
    ? {
      lockId: declaredLock,
      stageId: request.stageId,
      scopeInstance: request.scopeInstance,
      artifactRecordRevision: request.expectedArtifactRecordRevision,
      artifactRecordSha256: request.expectedArtifactRecordSha256,
      eventSha256: decisionEventSha256,
    }
    : null
  return {
    schema: 'jason.qingmu-stage-artifact-decision-result.v1',
    decision: {
      id: 'stage-artifact-decision-001',
      decisionOrdinal: 1,
      subjectType: 'stage_artifact_record',
      subjectId: targetId,
      subjectArtifactRecordRevision: request.expectedArtifactRecordRevision,
      subjectArtifactRecordSha256: request.expectedArtifactRecordSha256,
      artifactRevision: request.expectedArtifactRevision,
      artifactSha256: request.expectedArtifactSha256,
      subjectSnapshotSha256: request.expectedSubjectSha256,
      methodProjectionSha256,
      rulesSha256: methodProjection.rulesSha256,
      decision: request.decision,
      reason: request.reason,
      actorId: 'stage-artifact-approver',
      actorRole: 'approver',
      actorNaturalPersonId: 'natural-person-approver',
      producerActorId: 'natural-person-producer',
      producerNaturalPersonId: 'natural-person-producer',
      authSessionId: createHash('sha256').update(token).digest('hex'),
      dependencyAuthority: {
        schema: 'jason.qingmu-stage-dependency-authority.v1',
        targetId,
        artifactRecordRevision: request.expectedArtifactRecordRevision,
        artifactRecordSha256: request.expectedArtifactRecordSha256,
        sources: [],
        locks: [],
        blockers: [],
        verified: true,
      },
      stageArtifactAvailable: approved,
      dependencyAuthorityVerified: true,
      stageApprovalGranted: approved,
      lockActivated: producedLock !== null,
      planSealed: false,
      providerCalls: 0,
      humanSignoffInferred: false,
      reworkExecuted: false,
      decidedAt: '2026-08-28T02:02:00+08:00',
    },
    decisionEventSha256,
    producedLock,
    receiptId: 'stage-artifact-decision-receipt-001',
    outboxEventId: 'stage-artifact-decision-outbox-001',
  }
}

export function stageArtifactAuthorityRequest(
  registration: YimengRegisterStageArtifactRequest,
  receipt: YimengStageArtifactResult,
): YimengProbeStageArtifactAuthorityRequest {
  const record = receipt.artifactRecord
  return {
    ...STAGE_ARTIFACT_IDS,
    expectedArtifactRecordRevision: record.artifactRecordRevision,
    expectedArtifactRecordSha256: receipt.artifactRecordSha256,
    expectedArtifactRevision: record.artifactRevision,
    expectedArtifactSha256: record.artifactSha256,
    expectedSubjectSha256: record.subjectSnapshotSha256,
    artifact: structuredClone(registration.artifact),
  }
}

export function stageArtifactAuthoritySubmission(
  registration: YimengRegisterStageArtifactRequest,
  receipt: YimengStageArtifactResult,
): YimengForwardedStageArtifactAuthorityProbeRequest {
  const { artifact: _artifact, ...request } = stageArtifactAuthorityRequest(registration, receipt)
  return {
    ...request,
    methodProjection: structuredClone(registration.methodProjection),
    methodProjectionSha256: registration.methodProjectionSha256,
    methodAttestation: structuredClone(registration.methodAttestation),
  }
}

export function stageArtifactAuthorityProbeResult(
  request: YimengProbeStageArtifactAuthorityRequest | YimengForwardedStageArtifactAuthorityProbeRequest,
  currentDecisionResult: YimengStageArtifactDecisionResult | null,
  blockers: readonly string[] = [],
): YimengStageArtifactAuthorityProbe {
  const methodProjection = 'methodProjection' in request
    ? request.methodProjection
    : stageArtifactProjection(request.artifact)
  const targetId = stageArtifactSha({
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
  })
  const dependencyAuthority = currentDecisionResult?.decision.dependencyAuthority ?? {
    schema: 'jason.qingmu-stage-dependency-authority.v1' as const,
    targetId,
    artifactRecordRevision: request.expectedArtifactRecordRevision,
    artifactRecordSha256: request.expectedArtifactRecordSha256,
    sources: [],
    locks: [],
    blockers: [...blockers],
    verified: blockers.length === 0,
  }
  const approved = currentDecisionResult?.decision.decision === 'approve'
  return {
    schema: 'jason.qingmu-stage-artifact-authority-probe.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    artifactRecordRevision: request.expectedArtifactRecordRevision,
    artifactRecordSha256: request.expectedArtifactRecordSha256,
    rulesSha256: methodProjection.rulesSha256,
    dependencyAuthority,
    currentDecisionResult,
    dependencyAuthorityVerified: dependencyAuthority.verified,
    stageArtifactAvailable: approved,
    stageApprovalGranted: approved,
    lockActivated: approved && currentDecisionResult?.producedLock !== null,
    planSealed: false,
    providerCalls: 0,
    reworkExecuted: false,
  }
}

export function stageArtifactDecisionRecoveryRequest(
  request: YimengCommitStageArtifactDecisionRequest,
): YimengRecoverStageArtifactDecisionRequest {
  return {
    projectId: request.projectId,
    episodeId: request.episodeId,
    stageId: request.stageId,
    scopeInstance: request.scopeInstance,
    expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
    expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
    idempotencyKey: request.idempotencyKey,
  }
}
