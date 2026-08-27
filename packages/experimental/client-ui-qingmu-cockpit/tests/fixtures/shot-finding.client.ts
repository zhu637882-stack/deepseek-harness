/** Controlled browser fixtures only: these hashes and proof do not represent a Core run or human signoff. */
import type {
  ImagoShotFindingMethodResponse, YimengShotFindingFeedResponse, YimengShotFindingPayload,
  YimengShotFindingResult, YimengWorkflowProjection,
} from '../../src/client/contracts.ts'
import { SHOT_FINDING_FIELDS } from '../../src/client/shot-finding-contract.ts'
import { findingPayload, findingRecord, findingSha, findingSubject } from '../../../qingmu-yimeng-read-adapter/tests/shot-finding-fixture.ts'
import { continuitySource } from './continuity-method.client.ts'

export const shotFindingSource = continuitySource
export const shotFindingAuthorInput = findingPayload

export function shotFindingFeed(source: YimengWorkflowProjection = shotFindingSource(), frameId = 'frame-a'): YimengShotFindingFeedResponse {
  const shot = source.director.shotRelations.shots.find(item => item.shotId === frameId)
  if (shot === undefined) throw new Error('Fixture Shot is missing')
  const subject = { ...findingSubject(), projectId: source.projectId, episodeId: source.episodeId, frameId,
    frameNo: shot.frameNo, storyboardRevision: source.director.shotRelations.storyboardRevision.episodeRevision,
    assetId: `video-${frameId}`, assetVersion: 0 }
  return { schema: 'jason.qingmu-shot-finding-feed.v1', projectId: source.projectId, episodeId: source.episodeId, frameId,
    subject, snapshotSha256: findingSha(subject), availability: { status: 'available', reason: null },
    capabilities: { canRecordFinding: true }, items: [] }
}

export function shotFindingMethod(feed: YimengShotFindingFeedResponse = shotFindingFeed()): ImagoShotFindingMethodResponse {
  if (feed.subject === null || feed.snapshotSha256 === null) throw new Error('Fixture current subject is missing')
  const ruleBindings = { 'pipeline/imago-os-current.json': '1'.repeat(64) }
  const projection: ImagoShotFindingMethodResponse['projection'] = {
    schema: 'qingmu.imago-shot-finding-method.v1', subject: feed.subject, subjectSnapshotSha256: feed.snapshotSha256,
    definition: { requiredFields: SHOT_FINDING_FIELDS, severities: ['BLOCKER', 'MAJOR', 'MINOR'],
      ownerOptions: [{ stageId: 'F', roleId: 'F', scope: 'per_lsu' }, { stageId: 'C5F', roleId: 'C5', scope: 'global' }],
      statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false },
    ruleBindings, rulesSha256: findingSha(ruleBindings),
  }
  const projectionSha256 = findingSha(projection)
  return { schema: 'qingmu.imago-shot-finding-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: { schema: 'qingmu.imago-shot-finding-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: feed.snapshotSha256, methodProjectionSha256: projectionSha256, signature: 'a'.repeat(64) } }
}

export function shotFindingResult(
  method = shotFindingMethod(), payload: YimengShotFindingPayload = shotFindingAuthorInput(),
): YimengShotFindingResult {
  return { schema: 'jason.qingmu-shot-finding-result.v1', finding: {
    ...findingRecord(method.projection.subject), ...payload, methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
  }, changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false }
}

export { findingSha as shotFindingSha }
