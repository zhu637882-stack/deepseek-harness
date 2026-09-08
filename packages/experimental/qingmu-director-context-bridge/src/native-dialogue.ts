/** Dialogue reads retain the actual script, shot links and directing methods. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { YimengScriptResponse, YimengWorkflowProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { DirectorObjectScope } from './types.ts'
import { digest, readNativeShotMethods, toolValues, type NativeDraftReaders } from './native-draft.ts'
import { prepareDialogueEdit } from './dialogue-edit.ts'

// Signed delivery URLs rotate on each read. Asset identity/content/selection
// and every creative field still participate in freshness and CAS checks.
function inputIdentity(input: { context: DirectorContextSnapshot } & Record<string, unknown>): string {
  return digest({ ...input, context: { ...input.context,
    selectedReferences: input.context.selectedReferences.map(({ mediaUrl: _url, ...reference }) => reference) } })
}

/** Acquire linked lines from the selected shot without guessing IDs from prose.
 * @param context Fresh current-shot context.
 * @param scope Session-owned target.
 * @param readers Host-owned Writer and IMAGO readers.
 * @param signal Cancellation for the complete acquisition.
 * @returns Versioned input delivered to the native director.
 */
export async function readNativeDialogueInput(context: DirectorContextSnapshot, scope: DirectorObjectScope,
  readers: NativeDraftReaders, signal: AbortSignal) {
  signal.throwIfAborted()
  const coordinates = { projectId: scope.projectId, episodeId: scope.episodeId }
  const scriptResult = await readers.prompt('script', coordinates, signal)
  signal.throwIfAborted()
  if (!scriptResult.ok) throw new Error('当前剧本读取失败，未修改台词。')
  const source = scriptResult.value as YimengScriptResponse
  const workflowResult = await readers.prompt('workflow', coordinates, signal)
  signal.throwIfAborted()
  if (!workflowResult.ok) throw new Error('镜头关联读取失败，不能确定影响范围。')
  const workflow = workflowResult.value as YimengWorkflowProjection
  const relations = workflow.director?.shotRelations
  if (source.projectId !== scope.projectId || source.episodeId !== scope.episodeId
    || source.revision !== context.script.revision || source.scriptSha256 !== context.script.sha256
    || !source.found || !source.script
    || workflow.projectId !== scope.projectId || workflow.episodeId !== scope.episodeId
    || !relations || !relations.valid || relations.blockers.length
    || relations.storyboardRevision.revisionId !== context.storyboard?.id) {
    throw new Error('剧本、分镜或当前镜头发生变化，请重新读取。')
  }
  const shot = relations.shots.find(item => item.shotId === scope.shotId)
  if (!shot || shot.sceneId !== scope.sceneId) throw new Error('当前镜头缺少可核验的场次关联。')
  const methods = await readNativeShotMethods(readers, signal)
  const input = { scope, context, source, relations, methods, editableLines: shot.dialogueRhythm.cues }
  return { schema: 'qingmu.native-dialogue-input.v1' as const, receiptId: inputIdentity(input), ...input }
}

type DialogueInput = Awaited<ReturnType<typeof readNativeDialogueInput>>

/** Present the selected scene, linked lines and full methods without resending the entire episode JSON.
 * @param input Full verified input retained by the host.
 * @returns Explicitly scoped model view; absent scene fields are not invented.
 */
export function dialogueInputView(input: DialogueInput): Record<string, unknown> {
  const { sourceScene, shot, adjacentShots, episodeScenes, creativeContract } = input.context
  const sceneKeys = ['title', 'sceneGoal', 'conflict', 'emotionalBeat', 'emotionalTurn', 'informationDelta',
    'actionDescription', 'visualDescription', 'soundIntent', 'dialogues']
  return { schema: input.schema, receiptId: input.receiptId, scope: input.scope,
    source: { revision: input.source.revision, scriptSha256: input.source.scriptSha256, fullScriptRetainedByHost: true },
    context: { shot, script: input.context.script, creativeContract,
      ...(adjacentShots === undefined ? {} : { adjacentShots }), ...(episodeScenes === undefined ? {} : { episodeScenes }),
      sourceScene: Object.fromEntries(sceneKeys.filter(key => key in sourceScene).map(key => [key, sourceScene[key]])) },
    linkedShots: input.relations.shots.map(({ shotId, sceneId, frameNo, title, durationSec, dialogueRhythm }) =>
      ({ shotId, sceneId, frameNo, title, ...(durationSec === undefined ? {} : { durationSec }), dialogueRhythm })),
    methods: input.methods, editableLines: input.editableLines }
}

/** Show the exact line change and effects; the full proposed script remains host-owned.
 * @param preview Pure validated replacement.
 * @returns Compact impact result, without an editable script supplied by the model.
 */
export function dialoguePreviewView(preview: ReturnType<typeof prepareDialogueEdit>) {
  const { proposedScript, ...impact } = preview
  return { ...impact, proposedScriptSha256: digest(proposedScript) }
}

/** Recover only an actual successful tool result, not a model-authored script.
 * @param session Native durable event log.
 * @param receiptId Previously delivered input identity.
 * @returns Validated logged input.
 */
export function findNativeDialogueInput(session: Session, receiptId: string): DialogueInput {
  const input = toolValues(session, 'qingmu_read_dialogue').findLast(value =>
    (value as DialogueInput)?.schema === 'qingmu.native-dialogue-input.v1'
      && (value as DialogueInput).receiptId === receiptId) as DialogueInput | undefined
  if (!input) throw new Error('请先读取当前台词与镜头关联。')
  const { schema: _schema, receiptId: _receipt, ...source } = input
  if (inputIdentity(source) !== receiptId) throw new Error('台词来源记录不一致。')
  return input
}

/** Check exact line identity and direct effects before creating a Change Set.
 * @param input Logged, freshly revalidated source.
 * @param edit One selected line replacement.
 * @returns Pure proposed script and impact preview, not approval or generation.
 */
export function previewNativeDialogueEdit(input: DialogueInput, edit: { lineId: string; before: string; after: string }) {
  if (!input.editableLines.some(line => line.lineId === edit.lineId)) {
    throw new Error('这句台词不属于当前选中的镜头，未修改。')
  }
  return prepareDialogueEdit(input.source, input.relations, edit)
}
