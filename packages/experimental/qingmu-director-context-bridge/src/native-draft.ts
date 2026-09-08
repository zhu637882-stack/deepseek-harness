/** Native directing suggestions use logged read receipts, never replay work orders or business writes. */
import { createHash } from 'node:crypto'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { ImagoDirectorInstructionsResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengPromptIrResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { DirectorObjectScope, NativeDraftInput, NativeDraftProposal, NativeDraftSource } from './types.ts'

/** Only existing editable PromptIR fields can receive an advisory replacement. */
export const nativeDraftFields = ['imageGenPrompt', 'lastFrameImagePrompt', 'videoGenPrompt', 'motionPrompt', 'negativePrompt'] as const

/** Host readers are configured services; model input cannot select credentials, URLs or files. */
export interface NativeDraftReaders {
  readonly prompt: ConnectionRpcHandler
  readonly method: ConnectionRpcHandler
}

/** Suggestions carry only source identity; method and context text are logged once by the read tool. */
export function nativeDraftSource(input: NativeDraftInput): NativeDraftSource {
  return { receiptId: input.receiptId, scope: input.scope, bindingSeq: input.bindingSeq,
    storyboardRevisionId: input.prompt.subject.storyboardRevisionId, frameId: input.prompt.subject.frameId,
    baseRevision: input.prompt.baseRevision, baseSnapshotSha256: input.prompt.baseSnapshotSha256,
    draftSnapshotSha256: input.prompt.draft?.subjectSnapshotSha256 ?? null }
}

/** Stable content identity; object property ordering does not invalidate an unchanged input.
 * @param value JSON input to identify.
 * @returns Canonical SHA-256.
 */
export function digest(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : typeof input === 'object' && input !== null
      ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** Read actual draft text and full C5 instructions, including required supplementary resources. */
export async function readNativeDraftInput(
  context: DirectorContextSnapshot, scope: DirectorObjectScope, bindingSeq: number,
  readers: NativeDraftReaders, signal: AbortSignal,
): Promise<NativeDraftInput> {
  signal.throwIfAborted()
  const storyboardRevisionId = context.storyboard?.id
  if (!storyboardRevisionId) throw new Error('Current storyboard revision is unavailable; no draft was guessed.')
  const response = await readers.prompt('promptIr', {
    projectId: scope.projectId, episodeId: scope.episodeId, storyboardRevisionId, frameId: scope.shotId,
  }, signal)
  signal.throwIfAborted()
  if (!response.ok) throw new Error('Current PromptIR is unavailable. Prepare it in the workspace first.')
  const prompt = response.value as YimengPromptIrResponse
  if (prompt.schema !== 'jason.qingmu-prompt-ir-subject-read.v1'
    || prompt.subject.status !== 'Ready' || prompt.subject.projectId !== scope.projectId
    || prompt.subject.episodeId !== scope.episodeId || prompt.subject.frameId !== scope.shotId
    || prompt.subject.storyboardRevisionId !== storyboardRevisionId || prompt.draft?.status === 'stale') {
    throw new Error('PromptIR does not match the current shot, or its draft needs rebasing.')
  }
  const editable = prompt.draft?.subject.editableProjection ?? prompt.subject.editableProjection
  if (!nativeDraftFields.every(field => typeof editable[field] === 'string')) throw new Error('PromptIR editable fields are incomplete.')
  const methods = await readNativeShotMethods(readers, signal)
  const source = { scope, bindingSeq, context, prompt, methods }
  return { schema: 'qingmu.native-draft-input.v1', receiptId: digest(source), ...source }
}

/** Read full C5 and its required references for both existing and first prompt drafts.
 * @param readers Host-owned method reader.
 * @param signal Cancellation for all required resource reads.
 * @returns Complete primary and required supplementary method responses.
 */
export async function readNativeShotMethods(
  readers: NativeDraftReaders, signal: AbortSignal,
): Promise<ImagoDirectorInstructionsResponse[]> {
  const methods: ImagoDirectorInstructionsResponse[] = []
  async function method(resourceId?: 'rough_final_feedback'): Promise<void> {
    const result = await readers.method('directorInstructions', {
      capability: 'shot_design', ...(resourceId === undefined ? {} : { resourceId }),
    }, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error('IMAGO shot-design instructions are unavailable.')
    const value = result.value as ImagoDirectorInstructionsResponse
    if (value.schema !== 'qingmu.imago-director-instructions.v1' || value.capability !== 'shot_design'
      || value.requestedResourceId !== (resourceId ?? null) || !value.sources.length
      || value.sources.some(source => !source.content)) throw new Error('IMAGO method content is incomplete.')
    methods.push(value)
  }
  await method()
  const primary = methods[0]
  if (!primary) throw new Error('IMAGO primary instructions are unavailable.')
  for (const reference of primary.additionalReferences) {
    if (reference.resourceId !== 'rough_final_feedback') throw new Error('Unsupported required IMAGO reference.')
    await method(reference.resourceId)
  }
  return methods
}

/** Read successful native tool results paired to actual calls; chat text and failed calls are not receipts.
 * @param session Native log to inspect.
 * @param name Exact tool name to match.
 * @returns Parsed values from successful paired results, in log order.
 */
export function toolValues(session: Pick<Session, 'events'>, name: string): unknown[] {
  const calls = new Map<string, { turn: number; step: number }>()
  const receipts = new Map<string, { value: JsonValue; visibleSha256: string }>()
  const results: unknown[] = []
  for (const event of session.events) {
    if (event.type === 'tool/call' && event.data.name === name) calls.set(event.data.callId, event.data)
    if (event.type === 'qingmu-director-dialogue/receipt' && event.data.toolName === name
      && calls.has(event.data.callId)) receipts.set(event.data.callId, event.data)
    if (event.type !== 'tool/result' || event.data.error !== undefined) continue
    for (const part of event.data.message.content) {
      const call = calls.get(part.toolCallId)
      if (!call || call.turn !== event.data.turn || call.step !== event.data.step || part.isError) continue
      calls.delete(part.toolCallId)
      if (part.content.length !== 1 || part.content[0]?.type !== 'text') continue
      let value: unknown
      try { value = JSON.parse(part.content[0].text) } catch { continue /* A spilled or non-JSON result is not a receipt. */ }
      const receipt = receipts.get(part.toolCallId)
      if (receipt) {
        if (digest(value) === receipt.visibleSha256
          && (value as { nativeReceiptSha256?: string })?.nativeReceiptSha256 === digest(receipt.value)) results.push(receipt.value)
      } else if (!(value as { nativeReceiptSha256?: string })?.nativeReceiptSha256) results.push(value)
    }
  }
  return results
}

/** Retain complete host data in the existing session; the model receives a bounded task-specific view.
 * A pending, failed, spilled or mismatched result cannot unlock this stored input.
 * @param session Owning native session.
 * @param callId Actual executing tool call.
 * @param toolName Exact registered tool.
 * @param value Complete already-bounded host value.
 * @param view Task-relevant content, not a second editable source.
 * @returns Model-facing JSON with its full-input identity.
 */
export function retainNativeDialogueReceipt(session: Session, callId: string, toolName: string,
  value: JsonValue, view: Record<string, unknown>) {
  const visible = { ...view, nativeReceiptSha256: digest(value) }
  if (Buffer.byteLength(JSON.stringify(visible), 'utf8') > 48000) {
    throw new Error('本次台词的导演上下文过大，未截断输入或提交修改。请缩小到单个镜头。')
  }
  session.append('qingmu-director-dialogue/receipt', { callId, toolName, value, visibleSha256: digest(visible) })
  return visible
}

/** Obtain a source the native model actually received; client/model-authored snapshots are rejected. */
export function findNativeDraftInput(session: Session, receiptId: string): NativeDraftInput {
  const input = toolValues(session, 'qingmu_read_prompt_draft').findLast(value =>
    (value as NativeDraftInput)?.schema === 'qingmu.native-draft-input.v1'
      && (value as NativeDraftInput).receiptId === receiptId) as NativeDraftInput | undefined
  if (!input) throw new Error('Read the current prompt draft with qingmu_read_prompt_draft before proposing an edit.')
  const { schema: _schema, receiptId: _receiptId, ...source } = input
  if (digest(source) !== receiptId) throw new Error('Native draft receipt is inconsistent.')
  return input
}

/** Return only the latest logged proposal; a stale latest proposal never falls back to an older one. */
export function latestNativeDraftProposal(session: Session): NativeDraftProposal | null {
  const proposal = toolValues(session, 'qingmu_propose_prompt_edit').at(-1) as NativeDraftProposal | undefined
  if (proposal?.schema !== 'qingmu.native-draft-proposal.v1') return null
  const input = findNativeDraftInput(session, proposal.input.receiptId)
  const before = (input.prompt.draft?.subject ?? input.prompt.subject).editableProjection[proposal.field]
  if (digest(nativeDraftSource(input)) !== digest(proposal.input) || before !== proposal.before) throw new Error('Native proposal source is inconsistent.')
  return proposal
}
