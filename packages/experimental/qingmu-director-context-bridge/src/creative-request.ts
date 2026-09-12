/** Project scope of a consumed pre-production turn; no shot binding is invented. */
import { z } from 'zod'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

const schema = 'qingmu.native-creative-request.v1'
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/u)
const target = z.object({ schema: z.literal(schema), sessionId: id,
  projectId: id, episodeId: id, purpose: id }).strict()

/** Read only human input consumed by this call's turn, never later queued input. */
export function creativeRequest(exec: ToolRunContext) {
  exec.signal.throwIfAborted()
  const session = exec.agent?.session
  if (!session) throw new Error('The creative request needs an owning session.')
  const call = session.events.findLast(event => event.type === 'tool/call' && event.data.callId === exec.callId)
  if (!call || call.type !== 'tool/call') return undefined
  const start = session.events.findLast(event => event.seq < call.seq && event.type === 'turn/start' && event.data.turn === call.data.turn)
  if (!start) return undefined
  const messages = session.events.filter(event => event.seq > start.seq && event.seq < call.seq
    && event.type === 'user/message' && event.data.source.kind === 'user')
  for (const event of messages) {
    if (event.type !== 'user/message') continue
    const first = event.data.content[0]
    if (first?.type !== 'text' || !first.text.startsWith(`{"schema":"${schema}"`)) continue
    if (messages.length !== 1 || event.data.content.length !== 2 || event.data.content[1]?.type !== 'text'
      || first.text.length > 2048) throw new Error('Ambiguous creative request. Start one request from the current project.')
    const decoded: unknown = JSON.parse(first.text)
    if (JSON.stringify(decoded) !== first.text) throw new Error('Noncanonical creative request.')
    const value = target.parse(decoded)
    if (value.sessionId !== session.id) throw new Error('The creative request belongs to a different session.')
    return value
  }
  return undefined
}
