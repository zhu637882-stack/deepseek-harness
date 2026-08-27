/** Synthetic continuity facts; no production media, Provider call, or signoff is involved. */
import { createHash } from 'node:crypto'
import type { YimengContinuityDeltaProjection, YimengShotRelationsProjection } from '../src/types.ts'

/** Deterministic JSON for these safe-integer fixture contracts. */
export function continuityJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(continuityJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${continuityJson(record[key])}`).join(',')}}`
}

/** Rebind a synthetic fixture after intentional test mutations. */
export function rebindContinuity(value: YimengContinuityDeltaProjection): YimengContinuityDeltaProjection {
  const { snapshotSha256: _old, ...body } = value
  return { ...body, snapshotSha256: createHash('sha256').update(continuityJson(body), 'utf8').digest('hex') }
}

/** The frame order is intentionally different from lexical Shot-ID order. */
export function continuityRelations(): YimengShotRelationsProjection {
  return {
    schema: 'jason.scene-shot-beat-element-relations.v1', projectId: 'project-e55', episodeId: 'episode-e55',
    storyboardRevision: { episodeRevision: 3, revisionId: 'revision-e55', revisionVersion: 4, sourceSha256: 'd'.repeat(64) },
    scenes: [{ sceneId: 'scene-e55', name: '测试场景', profileRevision: 1, snapshotSha256: 'b'.repeat(64) }],
    shots: [{ shotId: 'frame-z', frameNo: 7 }, { shotId: 'frame-a', frameNo: 12 }].map(shot => ({
      ...shot, sceneId: 'scene-e55', title: null, durationSec: 3.5,
      dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] }, beats: [], elements: [],
    })),
    valid: true, blockers: [],
  }
}

/** Current and audited bytes use the known SHA values of the strings abc and hello. */
export function continuityFixture(): YimengContinuityDeltaProjection {
  const tailSha256 = createHash('sha256').update('abc').digest('hex')
  const nextFirstFrameSha256 = createHash('sha256').update('hello').digest('hex')
  return rebindContinuity({
    schema: 'jason.qingmu-continuity-delta.v1', projectId: 'project-e55', episodeId: 'episode-e55',
    storyboardRevision: continuityRelations().storyboardRevision, availability: 'available', reason: null,
    pairs: [{
      fromShotId: 'frame-z', toShotId: 'frame-a', fromFrameNo: 7, toFrameNo: 12,
      required: true, enforced: true, exemption: null, legacyStatus: 'passed', legacyEvidenceReady: true,
      contractDigest: 'c'.repeat(64),
      currentBinding: {
        tailAssetId: 'tail-e55', tailSha256, nextFirstFrameAssetId: 'first-e55', nextFirstFrameSha256,
        selectedVideoAssetId: 'video-e55', selectedVideoTaskId: 'video-task-e55', tailSourceTaskId: 'video-task-e55',
        tailFromSelectedVideo: true, nextFirstFrameSelected: true, nextFirstFrameStale: false, staleHandoff: false,
      },
      audit: {
        checkId: 'check-e55', passed: true, createdAt: '2026-08-27T00:00:00+00:00',
        tailAssetId: 'tail-e55', tailSha256, nextFirstFrameAssetId: 'first-e55', nextFirstFrameSha256,
        providerTaskId: 'audit-task-e55', evidenceRef: 'test-evidence:e55',
        dimensions: [
          { dimension: 'character', result: true, reason: '角色延续' },
          { dimension: 'scene', result: true, reason: '场景延续' },
          { dimension: 'prop', result: true, reason: '道具状态延续' },
          { dimension: 'action', result: true, reason: '动作延续' },
        ],
      },
      bindingStatus: 'current', currentEvidenceReady: true, warnings: [],
    }],
    readOnly: true, providerCalls: 0, taskMutation: false, budgetMutation: false, humanSignoffInferred: false,
    snapshotSha256: '',
  })
}
