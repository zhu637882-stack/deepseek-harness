/** Prepare current dialogue video inputs through the existing IMAGO/Writer contract. */
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { ImagoPromptIrBootstrapMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengPromptIrBootstrapResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { digest, nativeDraftFields } from './native-draft.ts'
import type { readNativeDialogueInput } from './native-dialogue.ts'

/** Materialize a Draft only; choosing its inputs and approving an image remain human actions.
 * @param input Fresh current script, frame links and complete directing methods.
 * @param readers Existing authenticated adapters; credentials never enter the native tool.
 * @param signal Cancellation; an uncertain write keeps the same content-derived command key.
 * @param beforeWrite Revalidate the owning browser selection immediately before persistence.
 * @returns Actual Writer Draft/Ready facts, not a generated video or content approval.
 */
export async function prepareDialogueVideo(input: Pick<Awaited<ReturnType<typeof readNativeDialogueInput>>, 'scope' | 'context' | 'editableLines'>,
  readers: { read: ConnectionRpcHandler; method: ConnectionRpcHandler; command: ConnectionRpcHandler },
  signal: AbortSignal, beforeWrite: () => Promise<void>) {
  const { scope, context } = input
  const target = { projectId: scope.projectId, episodeId: scope.episodeId,
    storyboardRevisionId: context.storyboard.id, frameId: scope.shotId }
  const loaded = await readers.read('promptIrBootstrap', target, signal)
  signal.throwIfAborted()
  if (!loaded.ok) throw new Error(`当前视频输入读取失败：${loaded.error.message}`)
  const state = loaded.value as YimengPromptIrBootstrapResponse
  if (state.schema !== 'jason.qingmu-prompt-ir-bootstrap-state.v1'
    || state.context.projectId !== scope.projectId || state.context.episodeId !== scope.episodeId
    || (state.context.frame as { id?: string })?.id !== scope.shotId
    || (state.context.storyboard as { id?: string })?.id !== context.storyboard.id) {
    throw new Error('视频输入与当前镜头不一致，没有保存。')
  }
  const cues = input.editableLines
  if (!cues.length || cues.some(cue => !cue.lineId || !cue.speakerId || !cue.verbatimText?.trim())) {
    throw new Error('台词或说话人关联不完整，不能准备对白视频。')
  }
  const cueMarkers = cues.map(cue => `${cue.speakerId}：${JSON.stringify(cue.verbatimText)}`)
  if (state.ready || state.draft) {
    // Existing inputs may have been authored by another actor after the edit.
    // Never mistake a generic camera prompt for a compiled dialogue input.
    if ([state.draft, state.ready].some(existing => existing !== null
      && !cueMarkers.every(marker => existing.editableProjection.videoGenPrompt.includes(marker)))) {
      throw new Error('已有视频输入未包含本镜新台词与说话人，需要更新输入；没有覆盖、认可或提交生成。')
    }
    return { schema: 'qingmu.native-dialogue-video-input.v1', scope,
      status: state.ready ? 'ready_input_exists' : 'awaiting_input_review',
      draft: state.draft, ready: state.ready, created: false, mediaGenerated: false, humanApprovalInferred: false }
  }
  // The existing compiler supplies camera/action/reference rules. Add actual
  // linked utterances explicitly: its generic bootstrap defaults omit dialogue.
  const base = await readers.method('promptIrBootstrapMethod', { context: state.context,
    contextSnapshotSha256: state.contextSnapshotSha256 }, signal)
  signal.throwIfAborted()
  if (!base.ok) throw new Error(`导演方法尚未编译：${base.error.message}`)
  const fields = (base.value as ImagoPromptIrBootstrapMethodResponse).projection.candidate.editableProjection as Record<string, string>
  if (!fields || !nativeDraftFields.every(key => typeof fields[key] === 'string')) throw new Error('导演方法缺少视频输入。')
  const dialogue = cues.map(cue => `${cue.speakerId}：${JSON.stringify(cue.verbatimText)}${
    typeof cue.plannedStartSec === 'number' && typeof cue.plannedEndSec === 'number'
      ? `（计划 ${cue.plannedStartSec}—${cue.plannedEndSec} 秒）` : ''}`).join('；')
  const compiled = await readers.method('promptIrBootstrapMethod', { context: state.context,
    contextSnapshotSha256: state.contextSnapshotSha256, editableProjection: { ...fields,
      videoGenPrompt: `${fields.videoGenPrompt}\n本镜锁定对白（保留原文、说话人及表演，不得改词或转交他人）：${dialogue}` } }, signal)
  signal.throwIfAborted()
  if (!compiled.ok) throw new Error(`对白视频输入未通过导演方法：${compiled.error.message}`)
  const method = compiled.value as ImagoPromptIrBootstrapMethodResponse
  const key = `qingmu-dialogue-video-${digest({ ...target, context: state.contextSnapshotSha256,
    projection: method.projectionSha256 })}`
  await beforeWrite()
  signal.throwIfAborted()
  const saved = await readers.command('bootstrapPromptIr', { ...target, idempotencyKey: key,
    expectedContextSnapshotSha256: state.contextSnapshotSha256, methodProjectionSha256: method.projectionSha256,
    methodProjection: method.projection, methodAttestation: method.methodAttestation }, signal)
  if (!saved.ok) throw new Error(`视频输入保存未取得回执；仅恢复当前镜头的原输入，不生成视频：${saved.error.message}`)
  return { schema: 'qingmu.native-dialogue-video-input.v1', scope, status: 'awaiting_input_review',
    result: saved.value, created: true, mediaGenerated: false, humanApprovalInferred: false }
}
