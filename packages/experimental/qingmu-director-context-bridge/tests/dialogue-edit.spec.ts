import { describe, expect, it } from 'vitest'
import type { YimengScriptResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { prepareDialogueEdit } from '../src/dialogue-edit.ts'

const source: YimengScriptResponse = {
  projectId: 'project', episodeId: 'episode', found: true, revision: 4,
  scriptSha256: 'a'.repeat(64), editedByUser: false, updatedAt: '2026-09-07T00:00:00Z',
  script: { scenes: [{ dialogues: [{ lineId: 'line1', speakerId: 'actor1', verbatimText: '有人吗？', line: '有人吗？' }] }] },
}
const relations: YimengShotRelationsProjection = {
  schema: 'jason.scene-shot-beat-element-relations.v1', projectId: 'project', episodeId: 'episode',
  storyboardRevision: { revisionId: 'storyboard', revisionVersion: 1, episodeRevision: 1, sourceSha256: 'b'.repeat(64) },
  scenes: [], valid: true, blockers: [],
  shots: [1, 2].map(n => ({ shotId: `shot${n}`, frameNo: n, title: null, sceneId: 'scene1', durationSec: 5,
    dialogueRhythm: { cueCount: n === 1 ? 1 : 0, timedCueCount: 0, cues: n === 1 ? [{
      schemaVersion: 'dialogue-cue-v2', lineId: 'line1', speakerId: 'actor1', verbatimText: '有人吗？',
      plannedStartSec: null, plannedEndSec: null, timingVerified: false, legacy: false,
    }] : [] }, beats: [], elements: [] })),
}
const edit = { lineId: 'line1', before: '有人吗？', after: '有人在吗？' }

describe('one dialogue edit', () => {
  it('resolves actual line links and leaves source and unrelated shots untouched', () => {
    const before = structuredClone({ source, relations })
    const result = prepareDialogueEdit(source, relations, edit)
    expect(result.affectedShots.map(s => s.shotId)).toEqual(['shot1'])
    expect(result.unchangedDialogueShots.map(s => s.shotId)).toEqual(['shot2'])
    expect(result.proposedScript).toEqual({ scenes: [{ dialogues: [{ lineId: 'line1', speakerId: 'actor1', verbatimText: edit.after, line: edit.after }] }] })
    expect({ source, relations }).toEqual(before)
    expect(result.visualImpact).toBe('requires_director_assessment')
    expect(result.businessStateChanged).toBe(false)
  })
  it('refuses stale original text', () => {
    expect(() => prepareDialogueEdit(source, relations, { ...edit, before: '旧台词' })).toThrow('原台词已变化')
  })
  it('edits an imported sourceLineId without rewriting its identity or import metadata', () => {
    const imported = { ...source, script: { schemaVersion: 'confirmed-script-import-v1', scenes: [{
      dialogues: [{ sourceLineId: 'line1', character: '林予', line: edit.before, source: 'confirmed_text_import' }],
    }] } }
    const before = structuredClone(imported)
    expect(prepareDialogueEdit(imported, relations, edit).proposedScript).toEqual({ ...imported.script,
      scenes: [{ dialogues: [{ ...imported.script.scenes[0]!.dialogues[0], line: edit.after }] }],
    })
    expect(imported).toEqual(before)
    imported.script.scenes[0]!.dialogues.push({ ...imported.script.scenes[0]!.dialogues[0]! })
    expect(() => prepareDialogueEdit(imported, relations, edit)).toThrow('缺失或重复')
  })
  it('refuses conflicting line identity aliases', () => {
    const conflicting = { ...source, script: { scenes: [{ dialogues: [{ lineId: 'line1', sourceLineId: 'other', line: edit.before }] }] } }
    expect(() => prepareDialogueEdit(conflicting, relations, edit)).toThrow('编号副本冲突')
  })
  it('refuses missing line links rather than promising unchanged media', () => {
    const changed = { ...relations, shots: relations.shots.map(shot => ({ ...shot,
      dialogueRhythm: { ...shot.dialogueRhythm, cues: shot.dialogueRhythm.cues.map(cue => ({ ...cue, lineId: null })) },
    })) }
    expect(() => prepareDialogueEdit(source, changed, edit)).toThrow('尚未关联镜头')
  })
  it('refuses a different project', () => {
    expect(() => prepareDialogueEdit(source, { ...relations, projectId: 'other' }, edit)).toThrow('关系不完整')
  })
})
