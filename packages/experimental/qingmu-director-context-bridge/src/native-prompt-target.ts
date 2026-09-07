/** Native user-message restrictions remain attached to the consumed turn, including queued work. */
import { z } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CallId } from '@deepseek-ai/dsh-llm'
import { assertNativePromptTarget, assertNativePromptSelection, hasBrowserDirectorOwner, currentState } from './bridge.ts'
import { toolValues } from './native-draft.ts'

const schema = 'qingmu.native-director-request.v1'
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/u)
const targetSchema = z.object({ schema: z.literal(schema), sessionId: id, ownerId: id,
  scope: z.object({ projectId: id, episodeId: id, sceneId: id, shotId: id }).strict(),
  contextSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

/** Recheck all scoped human inputs consumed in this turn, not newer still-queued messages. */
export function assertNativeTurnTarget(session: Session, callId: CallId, recoveryOnly = false): void {
  const marked = (content: readonly { type: string; text?: string }[]) => content[0]?.type === 'text'
    && content[0].text?.startsWith(`{"schema":"${schema}"`) === true
  // Queue editing can replace content. The original durable admission still proves
  // this session used scoped requests, including after restart when leases are gone.
  const requiresTarget = hasBrowserDirectorOwner(session) || session.events.some(event =>
    event.type === 'user/message' && event.data.source.kind === 'user' && marked(event.data.content)
    || event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'user' && marked(message.content)))
  const missing = () => { if (requiresTarget) throw new Error('This director request has no fixed shot target. Send it again from the selected shot workspace.') }
  const call = session.events.findLast(event => event.type === 'tool/call' && event.data.callId === callId)
  if (!call || call.type !== 'tool/call') { missing(); return }
  const start = session.events.findLast(event => event.seq < call.seq && event.type === 'turn/start' && event.data.turn === call.data.turn)
  if (!start) { missing(); return }
  const messages = session.events.filter(event => event.seq > start.seq && event.seq < call.seq
    && event.type === 'user/message' && event.data.source.kind === 'user')
  let found = false
  for (const event of messages) {
    if (event.type !== 'user/message') continue
    const first = event.data.content[0]
    if (first?.type !== 'text' || !marked(event.data.content)) continue
    found = true
    // The composer owns this entire first block; the user's original text is the second block.
    if (messages.length !== 1 || first.text.length > 2048 || event.data.content.length !== 2
      || event.data.content[1]?.type !== 'text' || event.data.content[1].text.startsWith(`{"schema":"${schema}"`)) {
      throw new Error('Ambiguous Qingmu request target; send one scoped request in a new turn.')
    }
    const decoded: unknown = JSON.parse(first.text)
    if (JSON.stringify(decoded) !== first.text) throw new Error('Noncanonical Qingmu request target.')
    const target = targetSchema.parse(decoded)
    if (recoveryOnly) { assertNativePromptSelection(session, target); continue }
    // Only a successful Host-recorded save in THIS consumed turn can advance
    // its context. A queued old request or chat-authored receipt cannot retarget.
    let hash = target.contextSnapshotSha256
    if (currentState(session)?.binding.contextSnapshotSha256 === hash) {
      assertNativePromptTarget(session, target)
      continue
    }
    const consumed = { events: session.events.filter(item => item.seq > start.seq && item.seq < call.seq) }
    for (const value of toolValues(consumed, 'qingmu_commit_dialogue_edit')) {
      const saved = value as {
        schema?: string
        scope?: unknown
        result?: { recovered?: boolean }
        continuation?: { before: string; after: string }
      }
      if (saved.schema === 'qingmu.native-dialogue-committed.v1'
        && saved.result?.recovered === false
        && saved.scope !== null && typeof saved.scope === 'object'
        && Object.entries(target.scope).every(([key, value]) => (saved.scope as Record<string, unknown>)[key] === value)
        && saved.continuation?.before === hash && /^[0-9a-f]{64}$/u.test(saved.continuation.after)) hash = saved.continuation.after
    }
    assertNativePromptTarget(session, { ...target, contextSnapshotSha256: hash })
  }
  if (!found) missing()
}
