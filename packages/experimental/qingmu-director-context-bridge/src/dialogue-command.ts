/** Native dialogue edits reuse Writer proposals, CAS commits and durable receipts. */
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DirectorContextSnapshot, YimengProposeScriptResponse, YimengPreviewScriptResponse, YimengCommitScriptResponse, YimengRecoverScriptCommitResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { digest, toolValues } from './native-draft.ts'
import { previewNativeDialogueEdit, type readNativeDialogueInput } from './native-dialogue.ts'

type Input = Awaited<ReturnType<typeof readNativeDialogueInput>>

/** Admit only the context transition caused by this exact successful line edit.
 * Unrelated shot/reference changes require a new assessment, not a silent retarget.
 * @param input Logged pre-edit context.
 * @param stage Exact proposed change.
 * @param result Authoritative existing Writer commit receipt.
 * @param current Fresh Writer context, never model-authored.
 * @returns The narrow old/new binding pair, or null if anything else changed.
 */
export function dialogueContinuation(input: Input, stage: ReturnType<typeof findStagedDialogue>,
  result: YimengCommitScriptResponse, current: DirectorContextSnapshot) {
  if (current.schema !== input.context.schema || current.script.revision !== result.authoritativeRevision
    || current.script.sha256 !== result.authoritativeSnapshotSha256
    || current.storyboard?.version !== input.context.storyboard.version + 1
    || current.storyboard.status !== 'Ready' || !/^[0-9a-f]{64}$/u.test(current.contextSnapshotSha256)) return null
  function edited(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(edited)
    if (value === null || typeof value !== 'object') return value
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key,
      object.lineId === stage.preview.lineId && ['line', 'verbatimText', 'text'].includes(key)
        && item === stage.preview.before ? stage.preview.after : edited(item)]))
  }
  function stable(context: DirectorContextSnapshot) {
    const { script: _script, storyboard: _storyboard, sourceTime: _time, contextSnapshotSha256: _hash,
      sourceScene: _scene, selectedReferences, ...rest } = context
    return { ...rest, selectedReferences: selectedReferences.map(({ mediaUrl: _url, ...reference }) => reference) }
  }
  if (digest(stable(input.context)) !== digest(stable(current))
    || digest(edited(input.context.sourceScene)) !== digest(current.sourceScene)) return null
  return { before: input.context.contextSnapshotSha256, after: current.contextSnapshotSha256 }
}

/** Create a proposal without modifying the project or submitting to a provider.
 * @param input Fresh session-bound script, shot links and methods.
 * @param edit Exact requested replacement.
 * @param command Authenticated Host command adapter.
 * @param sessionId Owner of the durable native transcript.
 * @param signal Cancellation before the next operation.
 * @returns Existing Change Set coordinates retained for exact commit recovery.
 */
export async function stageDialogueEdit(input: Input, edit: { lineId: string; before: string; after: string },
  command: ConnectionRpcHandler, sessionId: string, signal: AbortSignal) {
  const preview = previewNativeDialogueEdit(input, edit)
  signal.throwIfAborted()
  const capability = await command('readDialogueEditCapability', {}, signal)
  if (!capability.ok) throw new Error('当前服务尚未接通剧本与分镜的同步保存；没有修改项目。')
  signal.throwIfAborted()
  const proposed = await command('proposeScript', { projectId: preview.projectId, episodeId: preview.episodeId,
    baseRevision: preview.baseRevision, script: preview.proposedScript, harnessSessionId: sessionId,
    references: [{ schema: 'qingmu.dialogue-edit-reference.v1', ...edit,
      storyboardRevisionId: input.relations.storyboardRevision.revisionId,
      affectedShotIds: preview.affectedShots.map(shot => shot.shotId) }] }, signal)
  if (!proposed.ok) throw new Error('台词修改草稿未取得回执；项目台词尚未提交。')
  const proposal = (proposed.value as YimengProposeScriptResponse).changeSet
  const coordinates = { projectId: preview.projectId, episodeId: preview.episodeId,
    changeSetId: proposal.id, baseRevision: preview.baseRevision }
  signal.throwIfAborted()
  const inspected = await command('previewScript', coordinates, signal)
  if (!inspected.ok) throw new Error('修改草稿尚未完成核对；没有提交台词修改。')
  const checked = inspected.value as YimengPreviewScriptResponse
  if (!checked.canCommit || checked.revisionConflict || checked.payloadSha256 !== proposal.payloadSha256) {
    throw new Error('修改草稿已过期或存在冲突；没有提交。')
  }
  const staged = { inputReceiptId: input.receiptId, scope: input.scope, preview, ...coordinates,
    expectedPayloadSha256: proposal.payloadSha256,
    idempotencyKey: `qingmu-dialogue-${digest({ sessionId, ...coordinates, payloadSha256: proposal.payloadSha256 })}` }
  return { schema: 'qingmu.native-dialogue-staged.v1' as const, receiptId: digest(staged), ...staged,
    businessStateChanged: false as const, proposalStored: true as const, providerCalls: 0 as const }
}

/** Load only a successful prepared proposal recorded by this native session.
 * @param session Owning durable session.
 * @param receiptId Native staging receipt, not a model-authored Change Set.
 * @returns Exact stored commit coordinates.
 */
export function findStagedDialogue(session: Session, receiptId: string) {
  type Stage = Awaited<ReturnType<typeof stageDialogueEdit>>
  const stage = toolValues(session, 'qingmu_stage_dialogue_edit').findLast(value =>
    (value as Stage)?.schema === 'qingmu.native-dialogue-staged.v1' && (value as Stage).receiptId === receiptId) as Stage | undefined
  if (!stage) throw new Error('请先准备并核对这次台词修改。')
  const { schema: _schema, receiptId: _receipt, businessStateChanged: _changed,
    proposalStored: _stored, providerCalls: _calls, ...payload } = stage
  if (digest(payload) !== receiptId) throw new Error('台词草稿记录不一致，未提交。')
  return stage
}

/** Recover before submitting; uncertainty never mints a new idempotency key.
 * @param stage Successful session-owned staging result.
 * @param command Authenticated existing Writer command adapter.
 * @param signal Cancellation before dispatch, not evidence of server rollback.
 * @param beforeCommit Recheck session target and source immediately before a new write.
 * @returns Existing authoritative commit receipt. This does not approve or generate media.
 */
export async function commitStagedDialogue(stage: ReturnType<typeof findStagedDialogue>, command: ConnectionRpcHandler,
  signal: AbortSignal, beforeCommit: () => Promise<void>) {
  const coordinates = { projectId: stage.projectId, episodeId: stage.episodeId, changeSetId: stage.changeSetId,
    baseRevision: stage.baseRevision, idempotencyKey: stage.idempotencyKey, expectedPayloadSha256: stage.expectedPayloadSha256 }
  signal.throwIfAborted()
  const recovery = await command('recoverScriptCommit', coordinates, signal)
  if (recovery.ok) return { ...(recovery.value as YimengRecoverScriptCommitResponse).receipt, recovered: true as const }
  if (recovery.error.message !== 'Yimeng rejected command (HTTP 404: command_receipt_not_found)') {
    throw new Error('保存结果暂时无法核实；保留原提交编号，不重复提交。')
  }
  await beforeCommit()
  signal.throwIfAborted()
  const result = await command('commitScript', coordinates, signal)
  if (!result.ok) throw new Error('未取得保存回执。下次仅查询或重试原提交，不创建新提交。')
  return { ...result.value as YimengCommitScriptResponse, recovered: false as const }
}
