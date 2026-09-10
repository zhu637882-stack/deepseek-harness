/** Keyless imported dialogue linked to the example's exact shot, without timing evidence. */
import type { YimengScriptResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { draftContext, draftScope } from './native-draft-fixture.ts'

/** Imported source text retains its existing sourceLineId. */
export const importedScript: YimengScriptResponse = {
  ...draftScope, found: true, revision: draftContext.script.revision, scriptSha256: draftContext.script.sha256,
  editedByUser: false, updatedAt: '2026-09-10T00:00:00Z',
  script: { schemaVersion: 'confirmed-script-import-v1', scenes: [{ sceneIndex: 1, title: '门口',
    dialogues: [{ sourceLineId: 'line_000003', character: '林予', line: '有人吗？', source: 'confirmed_text_import' }],
  }] },
}

/** Linked shot cues expose no invented timing windows. */
export const importedRelations: YimengShotRelationsProjection = {
  schema: 'jason.scene-shot-beat-element-relations.v1', ...draftScope, valid: true, blockers: [], scenes: [],
  storyboardRevision: { episodeRevision: 1, revisionId: draftContext.storyboard.id,
    revisionVersion: draftContext.storyboard.version, sourceSha256: 'b'.repeat(64) },
  shots: [{ shotId: draftScope.shotId, sceneId: draftScope.sceneId, title: '门口呼喊', frameNo: 1, durationSec: 8,
    dialogueRhythm: { cueCount: 1, timedCueCount: 0, cues: [{ schemaVersion: 'dialogue-cue-linked-v1',
      lineId: 'line_000003', speakerId: 'actor-lin', verbatimText: '有人吗？', plannedStartSec: null,
      plannedEndSec: null, timingVerified: false, legacy: false }] }, beats: [], elements: [] }],
}
