/** Adopt director-authored source corrections before compiling the ordinary video drafts. */
import type { ScenePlanningRequest, ScenePlanningResult, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { parseBatchChoices, readBatchBasis, type BatchBasis, type BatchPort } from './reference-video-batch.ts'

interface DirectorRepair {
  readonly frameId: string
  readonly directorPlan: YimengCommandJsonObject
  readonly imagePromptCn: string
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}

/**
 * Validate the whole proposal, save only its requested source repairs, then reassemble from fresh sources.
 * @param port Existing planning and single-shot generation ports.
 * @param episodeId Episode whose source snapshot accompanied authoring.
 * @param basis Original preparation snapshot; retained across a partial failure.
 * @param text Complete native proposal, with optional directorRepairs.
 * @param retakes Explicitly included existing shots.
 * @param feedback Current preparation notes, never filmed verbatim.
 * @returns Fresh source and requests; no upload, quote, video generation or candidate selection.
 */
export async function reconcileBatchChoices(port: BatchPort, episodeId: string, basis: BatchBasis,
  text: string, retakes: ReadonlySet<string>, feedback: string) {
  const requests = parseBatchChoices(text, basis, retakes, feedback)
  const value = JSON.parse(text) as { directorRepairs?: unknown }
  if (value.directorRepairs === undefined) return { basis, requests }
  if (!Array.isArray(value.directorRepairs)) throw new Error('导演修订需要列表。')
  if (!value.directorRepairs.length) return { basis, requests }
  const { planning } = basis
  if (!planning?.storyboard || !planning.scriptSha256 || planning.projectId !== basis.projectId || planning.episodeId !== episodeId) {
    throw new Error('请刷新本集准备情况后重新整理导演方案。')
  }
  const remaining = new Set(requests.map(item => item.frameId))
  const repairs = value.directorRepairs.map((raw: unknown): DirectorRepair => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key => !['frameId', 'directorPlan', 'imagePromptCn'].includes(key))
      || !('frameId' in raw) || typeof raw.frameId !== 'string' || !remaining.delete(raw.frameId)
      || !('directorPlan' in raw) || !raw.directorPlan || typeof raw.directorPlan !== 'object' || Array.isArray(raw.directorPlan)
      || !Object.keys(raw.directorPlan).length || !('imagePromptCn' in raw) || typeof raw.imagePromptCn !== 'string' || !raw.imagePromptCn.trim()) {
      throw new Error('修订必须属于本次准备镜头且不重复，并包含导演设计与完整首帧描述。')
    }
    if (!planning.frameRequirements?.some(shot => shot.id === raw.frameId)) throw new Error('修订镜头不在当前分集。')
    // Writer owns creative-field and script validation, including nested values and dialogue identity.
    return raw as DirectorRepair
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({
    projectId: basis.projectId, episodeId, storyboard: planning.storyboard,
    scriptSha256: planning.scriptSha256, repairs,
  })))
  const intent = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  let revision = planning.storyboard
  for (const [index, repair] of repairs.entries()) {
    const shot = planning.frameRequirements?.find(item => item.id === repair.frameId)
    const original = basis.shots.find(item => item.frameId === repair.frameId)?.saved
    if (!shot || !original) throw new Error('修订镜头不在当前准备来源。')
    const command: ScenePlanningRequest = { projectId: basis.projectId, episodeId,
      idempotencyKey: `qingmu-batch-repair-${intent}-${index}`,
      request: { action: planning.canonicalStoryboard ? 'edit_automatic' : 'edit_requirements',
        shotId: repair.frameId, directorPlan: repair.directorPlan, imagePromptCn: repair.imagePromptCn,
        expectedScriptRevision: planning.scriptRevision, expectedScriptSha256: planning.scriptSha256,
        expectedStoryboardRevision: revision.version, expectedStoryboardSha256: revision.sourceHash,
        ...(typeof repair.directorPlan.generationContext === 'string' && shot.generationContextSource
          ? { expectedGenerationContextSourceSha256: shot.generationContextSource.sha256 } : {}) } }
    let result: ScenePlanningResult
    try { result = await port.recoverScenePlanning(command) }
    catch (cause) {
      if (!(cause instanceof Error) || !cause.message.includes('HTTP 404: planning_receipt_not_found')) throw cause
      const current = await port.referenceVideoDraft({ projectId: basis.projectId, frameId: repair.frameId })
      // Adjacent-shot continuity can change after an earlier repair; this shot and its production sources cannot.
      if (current.frameSha256 !== original.frameSha256
        || current.directorSource?.generationPrompt !== original.directorSource?.generationPrompt
        || current.directorSource?.executionSuffix !== original.directorSource?.executionSuffix) {
        throw new Error('本镜或共用来源已变化，已保存修订保留；请刷新后合并当前设计。')
      }
      result = await port.saveScenePlanning(command)
    }
    if (result.action !== command.request.action || !('shotId' in result) || result.shotId !== repair.frameId
      || result.projectId !== basis.projectId || result.episodeId !== episodeId || result.idempotencyKey !== command.idempotencyKey) {
      throw new Error('导演修订保存回执不对应，请保留原方案并读取原结果。')
    }
    revision = result.storyboard
  }
  const fresh = await readBatchBasis(port, basis.projectId, basis.shots, episodeId)
  if (fresh.planning?.storyboard?.sourceHash !== revision.sourceHash
    || fresh.planning.scriptSha256 !== planning.scriptSha256) throw new Error('修订后来源又有变化，请刷新并合并当前设计。')
  return { basis: fresh, requests: parseBatchChoices(text, fresh, retakes, feedback, requests.map(item => item.frameId)) }
}
