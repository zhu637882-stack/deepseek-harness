/** Resolve one dialogue edit against Writer's authoritative script and shot links. */
import type { YimengScriptResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { digest } from './native-draft.ts'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Match persisted dialogue identities without choosing between conflicting aliases.
 * @param line One script or frame dialogue object.
 * @param lineId Exact requested source identifier.
 * @returns Whether this object identifies that line.
 */
export function identifiesDialogueLine(line: Record<string, unknown>, lineId: string): boolean {
  const ids = ['lineId', 'sourceLineId'].filter(key => line[key] !== undefined).map(key => line[key])
  if (!ids.includes(lineId)) return false
  if (ids.some(id => id !== lineId)) throw new Error('台词编号副本冲突，尚未修改。')
  return true
}

/**
 * Prepare an exact line replacement without committing or guessing missing links.
 * The result is an input to the existing Script Change Set, not a second store.
 * @param source Current Writer script and its revision.
 * @param relations Current Writer shot-to-dialogue relationships.
 * @param edit One selected line's original and replacement text.
 * @returns Proposed script, directly affected shots and unchanged dialogue assignments.
 */
export function prepareDialogueEdit(
  source: YimengScriptResponse,
  relations: YimengShotRelationsProjection,
  edit: { readonly lineId: string; readonly before: string; readonly after: string },
) {
  if (!source.found || !source.script || !source.scriptSha256) throw new Error('当前权威剧本不可用。')
  if (source.projectId !== relations.projectId || source.episodeId !== relations.episodeId
    || relations.blockers.length) throw new Error('剧本与镜头关系不完整，尚未修改。')
  if (!edit.lineId.trim() || !edit.before.trim() || !edit.after.trim()
    || edit.after !== edit.after.trim() || edit.after.length > 2000 || edit.after.includes('\0')
    || edit.before === edit.after) throw new Error('请提供一句原台词和不同的新台词。')
  const script = structuredClone(source.script)
  if (!Array.isArray(script.scenes)) throw new Error('剧本缺少场次。')
  const lines = script.scenes.flatMap(scene => object(scene) && Array.isArray(scene.dialogues)
    ? scene.dialogues.filter((line): line is Record<string, unknown> => object(line) && identifiesDialogueLine(line, edit.lineId)) : [])
  const line = lines[0]
  if (lines.length !== 1 || line === undefined) throw new Error('台词标识缺失或重复，不能猜测要改哪一句。')
  const textFields = ['verbatimText', 'line', 'text'].filter(key => typeof line[key] === 'string')
  if (!textFields.length || textFields.some(key => line[key] !== edit.before)) {
    throw new Error('原台词已变化或副本不一致，请重新读取后修改。')
  }
  const ids = relations.shots.map(shot => shot.shotId)
  if (new Set(ids).size !== ids.length) throw new Error('镜头标识重复。')
  const affected = relations.shots.filter(shot => shot.dialogueRhythm.cues.some(cue => cue.lineId === edit.lineId))
  if (!affected.length) throw new Error('这句台词尚未关联镜头，不能直接生成。')
  for (const shot of relations.shots) {
    for (const cue of shot.dialogueRhythm.cues) {
      if (cue.lineId === edit.lineId && cue.verbatimText !== edit.before) {
        throw new Error(`镜${shot.frameNo}的台词与剧本不一致，尚未修改。`)
      }
      if (cue.lineId === null && cue.verbatimText === edit.before) {
        throw new Error(`镜${shot.frameNo}存在未标识的同句台词，影响范围尚不能确定。`)
      }
    }
  }
  for (const key of textFields) line[key] = edit.after
  const affectedIds = new Set(affected.map(shot => shot.shotId))
  return {
    schema: 'qingmu.dialogue-edit-preview.v1' as const,
    projectId: source.projectId, episodeId: source.episodeId,
    baseRevision: source.revision, scriptSha256: source.scriptSha256,
    relationsSha256: digest(relations), lineId: edit.lineId, before: edit.before, after: edit.after,
    proposedScript: script,
    affectedShots: affected.map(shot => ({ shotId: shot.shotId, frameNo: shot.frameNo, title: shot.title })),
    unchangedDialogueShots: relations.shots.filter(shot => !affectedIds.has(shot.shotId))
      .map(shot => ({ shotId: shot.shotId, frameNo: shot.frameNo, title: shot.title })),
    // A line-id comparison cannot prove that a changed meaning preserves a
    // listener's reaction, timing, lipsync, or visual continuity.
    visualImpact: 'requires_director_assessment' as const,
    businessStateChanged: false as const, providerCalls: 0 as const,
  }
}
