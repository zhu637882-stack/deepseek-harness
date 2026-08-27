/** Controlled browser fixtures, not real method signatures or approved screenplay artifacts. */
import type {
  ImagoStageSourceMethodResponse, YimengBindStageSourceRequest, YimengScriptResponse,
  YimengStageSourceDefinition, YimengStageSourceResult, YimengStageSourcesResponse,
} from '../../src/client/contracts.ts'
import { shotFindingSha } from './shot-finding.client.ts'

export function stageSourceDefinition(): YimengStageSourceDefinition {
  return { id: 'IMAGO-V6-A1S-SOURCE', version: 'fixture-v1', stageId: 'A1S', roleId: 'A1S', scope: 'global',
    contractSha256: 'c'.repeat(64), artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
    sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
    stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 }
}

export function stageSourceFeed(): YimengStageSourcesResponse {
  const source = { schema: 'jason.qingmu-stage-source.v1' as const, projectId: 'project-source', episodeId: 'episode-source',
    sourceType: 'episode_script' as const, sourceId: 'episode-source', revision: 4, contentSha256: 'd'.repeat(64) }
  return { schema: 'jason.qingmu-stage-source-feed.v1', projectId: source.projectId, episodeId: source.episodeId,
    stageId: 'A1S', source, subjectSnapshotSha256: shotFindingSha(source), unavailableReason: null, canBind: true,
    bindingRevision: 0, bindingSha256: null, latestBinding: null, currentBinding: null }
}

export function stageSourceScript(feed = stageSourceFeed()): YimengScriptResponse {
  return { found: feed.source !== null, projectId: feed.projectId, episodeId: feed.episodeId,
    script: feed.source === null ? null : { title: '已保存的剧本', duration: 1.5, editMetadata: { source: 'human' } },
    scriptSha256: feed.source?.contentSha256 ?? null, revision: feed.source?.revision ?? 0,
    editedByUser: true, updatedAt: '2026-08-28T00:00:00+08:00' }
}

export function stageSourceMethod(feed = stageSourceFeed()): ImagoStageSourceMethodResponse {
  if (feed.source === null || feed.subjectSnapshotSha256 === null) throw new Error('No fixture source')
  const paths = ['pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json', 'pipeline/v6-stage-contracts.json',
    'pipeline/workflow-spec.v6.production-beta.json', 'scripts/compile_qingmu_imago_workset.py',
    'scripts/compile_qingmu_imago_workset_v2.py', 'scripts/imago_v6_draft_ctl.py', 'scripts/compile_qingmu_element_method.py',
    'scripts/compile_qingmu_stage_source_method.py']
  const ruleBindings = Object.fromEntries(paths.map(path => [path, 'a'.repeat(64)]))
  const projection: ImagoStageSourceMethodResponse['projection'] = {
    schema: 'qingmu.imago-stage-source-method.v1', subject: feed.source, subjectSnapshotSha256: feed.subjectSnapshotSha256,
    definition: stageSourceDefinition(), ruleBindings, rulesSha256: shotFindingSha(ruleBindings),
  }
  const projectionSha256 = shotFindingSha(projection)
  return { schema: 'qingmu.imago-stage-source-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: { schema: 'qingmu.imago-stage-source-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: feed.subjectSnapshotSha256, methodProjectionSha256: projectionSha256, signature: 'b'.repeat(64) } }
}

export function stageSourceRequest(feed = stageSourceFeed()): YimengBindStageSourceRequest {
  const method = stageSourceMethod(feed)
  return { projectId: feed.projectId, episodeId: feed.episodeId, stageId: 'A1S',
    expectedSubjectSha256: method.projection.subjectSnapshotSha256, expectedBindingRevision: feed.bindingRevision,
    expectedBindingSha256: feed.bindingSha256, methodProjection: method.projection,
    methodProjectionSha256: method.projectionSha256, methodAttestation: method.methodAttestation, idempotencyKey: 'fixture-key' }
}

export function stageSourceResult(request = stageSourceRequest()): YimengStageSourceResult {
  const binding: YimengStageSourceResult['binding'] = { schema: 'jason.qingmu-stage-source-binding.v1',
    changeSetId: `cs-${request.expectedBindingRevision + 1}`, projectId: request.projectId, episodeId: request.episodeId,
    stageId: 'A1S', source: request.methodProjection.subject, subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: request.methodProjection.definition, methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256, bindingRevision: request.expectedBindingRevision + 1,
    actorId: 'project-owner', authSessionId: 'e'.repeat(64), createdAt: '2026-08-28T00:00:00+08:00',
    stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false, planSealed: false,
    providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false }
  return { schema: 'jason.qingmu-stage-source-result.v1', binding, bindingSha256: shotFindingSha(binding),
    receiptId: `receipt-${binding.bindingRevision}`, outboxEventId: `event-${binding.bindingRevision}` }
}

export function stageSourceBoundFeed(feed = stageSourceFeed(), result = stageSourceResult()): YimengStageSourcesResponse {
  return { ...feed, bindingRevision: result.binding.bindingRevision, bindingSha256: result.bindingSha256,
    latestBinding: result, currentBinding: feed.subjectSnapshotSha256 === result.binding.subjectSnapshotSha256 ? result : null }
}
