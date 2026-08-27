import { createHash } from 'node:crypto'
import type { YimengShotFinding, YimengShotFindingFeedResponse, YimengShotFindingPayload, YimengShotVideoSubject } from '../src/types.ts'
import { continuityJson } from './continuity-fixture.ts'

export const FINDING_REQUEST = { projectId: 'project-finding', episodeId: 'episode-finding', frameId: 'frame-z' }
export const findingSha = (value: unknown) => createHash('sha256').update(continuityJson(value), 'utf8').digest('hex')
export const findingSubject = (): YimengShotVideoSubject => ({
  schema: 'jason.qingmu-shot-video-subject.v1', ...FINDING_REQUEST, frameNo: 7, storyboardRevision: 4,
  frameContentSha256: 'b'.repeat(64), assetId: 'video-z', assetVersion: 2, assetSha256: 'a'.repeat(64),
})
export const findingPayload = (): YimengShotFindingPayload => ({
  timecode: '00:00.000–00:01.250', observation: '  怀表换手；请看原片。\n保留原文。',
  evidenceRefs: ['asset://video-z#t=0,1.25', 'asset://video-z#t=0,1.25'], earliestOwner: 'F',
  ownerReason: '本次表演与逐镜合同不符。', severity: 'MAJOR', suggestion: '保持持物手一致。', reworkScope: '仅本镜当前 Take。',
})
export function findingRecord(subject: YimengShotVideoSubject = findingSubject()): YimengShotFinding {
  return { ...findingPayload(), id: 'finding-one', eventId: 'event-one', subject,
    subjectSnapshotSha256: findingSha(subject), status: 'OPEN', actorId: 'reviewer-one', actorRole: 'reviewer',
    authSessionId: 'c'.repeat(64), createdAt: '2026-08-28T00:00:00+00:00',
    methodProjectionSha256: 'd'.repeat(64), rulesSha256: 'e'.repeat(64) }
}
export function findingFeed(): YimengShotFindingFeedResponse {
  const subject = findingSubject()
  return { schema: 'jason.qingmu-shot-finding-feed.v1', ...FINDING_REQUEST, subject,
    snapshotSha256: findingSha(subject), availability: { status: 'available', reason: null },
    capabilities: { canRecordFinding: true }, items: [{ ...findingRecord(subject), currentBinding: true }] }
}
