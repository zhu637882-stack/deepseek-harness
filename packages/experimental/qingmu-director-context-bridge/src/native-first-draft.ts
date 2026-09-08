/** First-prompt suggestions use current Writer inputs and native session receipts without creating business rows. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { YimengPromptIrBootstrapResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { DirectorObjectScope, NativeFirstDraftInput, NativeFirstDraftProposal } from './types.ts'
import { digest, readNativeShotMethods, toolValues, type NativeDraftReaders } from './native-draft.ts'

/** Read the selected frame before any PromptIR exists; missing prerequisites remain explicit failures.
 * @param context Current normalized Writer context.
 * @param scope Canonical session-bound frame.
 * @param bindingSeq Current durable binding event sequence.
 * @param readers Host-owned business and method readers.
 * @param signal Cancellation for this read.
 * @returns Complete upstream and method input with its content receipt.
 */
export async function readNativeFirstDraftInput(context: DirectorContextSnapshot, scope: DirectorObjectScope,
  bindingSeq: number, readers: NativeDraftReaders, signal: AbortSignal): Promise<NativeFirstDraftInput> {
  signal.throwIfAborted()
  if (!context.storyboard?.id) throw new Error('Current storyboard revision is unavailable.')
  const result = await readers.prompt('promptIrBootstrap', { projectId: scope.projectId, episodeId: scope.episodeId,
    storyboardRevisionId: context.storyboard.id, frameId: scope.shotId }, signal)
  signal.throwIfAborted()
  if (!result.ok) throw new Error('First-draft upstream or selected references are unavailable; prepare them in the workspace.')
  const bootstrap = result.value as YimengPromptIrBootstrapResponse
  if (bootstrap.schema !== 'jason.qingmu-prompt-ir-bootstrap-state.v1'
    || bootstrap.context.projectId !== scope.projectId || bootstrap.context.episodeId !== scope.episodeId
    || (bootstrap.context.storyboard as { id?: string })?.id !== context.storyboard.id
    || (bootstrap.context.frame as { id?: string })?.id !== scope.shotId
    || bootstrap.draft !== null || bootstrap.ready !== null) {
    throw new Error('The frame changed or a PromptIR already exists. Refresh the workspace; do not replace it with a first draft.')
  }
  const methods = await readNativeShotMethods(readers, signal)
  const source = { scope, bindingSeq, context, bootstrap, methods }
  return { schema: 'qingmu.native-first-draft-input.v1', receiptId: digest(source), ...source }
}

/** Recover only content actually delivered by a successful logged native read.
 * @param session Native event log containing successful tool call/result pairs.
 * @param receiptId Content identity returned by the read tool.
 * @returns Matching verified input, or throws when missing or inconsistent.
 */
export function findNativeFirstDraftInput(session: Session, receiptId: string): NativeFirstDraftInput {
  const input = toolValues(session, 'qingmu_read_first_draft').findLast(value =>
    (value as NativeFirstDraftInput)?.schema === 'qingmu.native-first-draft-input.v1'
    && (value as NativeFirstDraftInput).receiptId === receiptId) as NativeFirstDraftInput | undefined
  if (!input) throw new Error('Read qingmu_read_first_draft before proposing the first draft.')
  const { schema: _schema, receiptId: _receipt, ...source } = input
  if (digest(source) !== receiptId) throw new Error('First-draft receipt is inconsistent.')
  return input
}

/** Compact proposal provenance; full methods and source text stay in the read receipt.
 * @param input Verified first-draft input.
 * @returns Source coordinates without duplicated method text.
 */
export function firstDraftSource(input: NativeFirstDraftInput): NativeFirstDraftProposal['input'] {
  if (!input.context.storyboard) throw new Error('First-draft storyboard is unavailable.')
  return { receiptId: input.receiptId, scope: input.scope, contextSnapshotSha256: input.bootstrap.contextSnapshotSha256,
    storyboardRevisionId: input.context.storyboard.id }
}

/** No older proposal fallback when the newest one no longer matches its source.
 * @param session Native event log to inspect.
 * @returns Latest successful proposal or null; inconsistent sources throw.
 */
export function latestNativeFirstDraftProposal(session: Session): NativeFirstDraftProposal | null {
  const proposal = toolValues(session, 'qingmu_propose_first_draft').at(-1) as NativeFirstDraftProposal | undefined
  if (proposal?.schema !== 'qingmu.native-first-draft-proposal.v1') return null
  const input = findNativeFirstDraftInput(session, proposal.input.receiptId)
  if (digest(proposal.input) !== digest(firstDraftSource(input))) throw new Error('First-draft proposal source is inconsistent.')
  return proposal
}
