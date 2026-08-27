import { createHash, createHmac } from 'node:crypto'
import { sourceCanonical, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { stageArtifactCanonicalJson } from '../src/stage-artifact.ts'
import type {
  YimengImagoStageArtifactMethodProjection,
  YimengRecoverStageArtifactRegistrationRequest,
  YimengRegisterStageArtifactRequest,
  YimengStageArtifact,
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
): YimengImagoStageArtifactMethodProjection {
  const subject = {
    schema: 'jason.qingmu-imago-stage-artifact.v1' as const,
    ...STAGE_ARTIFACT_IDS,
    artifactRevision: artifact.artifact_revision,
    artifactSha256: stageArtifactSha(artifact),
  }
  const ruleBindings = { 'pipeline/imago-os-current.json': 'a'.repeat(64) }
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
