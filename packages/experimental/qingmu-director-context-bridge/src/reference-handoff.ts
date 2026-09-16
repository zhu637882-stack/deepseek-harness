import { z } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { ReferenceVideoDraftResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { DirectorContextReadPort, DirectorObjectScope } from './types.ts'
import { toolValues } from './native-draft.ts'

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)
const savedSchema = z.object({
  schema: z.literal('qingmu.native-reference-saved.v1'),
  scope: z.object({ projectId: z.string(), episodeId: z.string(), sceneId: z.string(), shotId: z.string() }),
  revision: z.number().int().positive(), requestSha256: sha256, frameSha256: sha256,
  directorSourceSha256: sha256, contextSnapshotSha256: sha256,
  activeShotChanged: z.literal(false), generationQueued: z.literal(false),
})

/** A completed save is preparation evidence, never payment authority or footage approval. */
export type ReferenceHandoff = { status: 'waiting' | 'unavailable' } | { status: 'blocked'; reason: string }
  | ({ status: 'ready'; messageId: string; turn: number; endSeq: number } & z.infer<typeof savedSchema>)

/** Resolve one consumed director request and its last write; unrelated turns cannot finish it.
 * @param session Durable native events, not assistant-authored receipts.
 * @param messageId Exact admitted user message identity.
 * @param scope Shot captured when the request was admitted.
 * @returns Completed save identity requiring authoritative source revalidation before submission.
 */
export function readReferenceHandoff(session: Pick<Session, 'id' | 'events'>, messageId: string,
  scope: DirectorObjectScope): ReferenceHandoff {
  const requests = session.events.filter(event => event.type === 'user/message' && event.data.id === messageId)
  if (requests.length > 1) return { status: 'blocked', reason: 'director_request_ambiguous' }
  const request = requests[0]
  if (request?.type !== 'user/message') return { status: 'waiting' }
  if (request.data.source.kind !== 'user') return { status: 'blocked', reason: 'director_target_mismatch' }
  const start = session.events.findLast(event => event.seq < request.seq && event.type === 'turn/start')
  if (start?.type !== 'turn/start') return { status: 'blocked', reason: 'director_turn_missing' }
  const end = session.events.find(event => event.seq > request.seq && event.type === 'turn/end' && event.data.turn === start.data.turn)
  if (!end) return { status: 'waiting' }
  if (end.type !== 'turn/end' || end.data.reason.kind !== 'completed') return { status: 'blocked', reason: 'director_turn_incomplete' }
  const events = session.events.filter(event => event.seq > start.seq && event.seq < end.seq)
  const users = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const content = request.data.content
  let target: unknown
  try { target = content[0]?.type === 'text' ? JSON.parse(content[0].text) : null }
  catch { return { status: 'blocked', reason: 'director_target_invalid' } }
  const parsed = z.object({ schema: z.literal('qingmu.native-director-request.v1'), sessionId: z.literal(session.id),
    ownerId: z.string().min(1), scope: savedSchema.shape.scope, contextSnapshotSha256: sha256 }).strict().safeParse(target)
  if (!parsed.success || users.length !== 1 || content.length !== 2 || content[1]?.type !== 'text'
    || Object.entries(scope).some(([key, value]) => parsed.data.scope[key as keyof DirectorObjectScope] !== value)) {
    return { status: 'blocked', reason: 'director_target_mismatch' }
  }
  const writes = ['qingmu_save_reference_draft', 'qingmu_save_director_plan', 'qingmu_commit_dialogue_edit']
  const lastWrite = events.findLast(event => event.type === 'tool/call' && writes.includes(event.data.name))
  if (lastWrite?.type !== 'tool/call' || lastWrite.data.name !== 'qingmu_save_reference_draft' || lastWrite.seq <= request.seq) {
    return { status: 'blocked', reason: 'reference_save_missing' }
  }
  const saved = savedSchema.safeParse(toolValues({ events: events.filter(event => event.seq >= lastWrite.seq) }, 'qingmu_save_reference_draft').at(-1))
  if (!saved.success || Object.entries(scope).some(([key, value]) => saved.data.scope[key as keyof DirectorObjectScope] !== value)) {
    return { status: 'blocked', reason: 'reference_save_unconfirmed' }
  }
  return { status: 'ready', messageId, turn: start.data.turn, endSeq: end.seq, ...saved.data }
}

/** Recheck saved coordinates; dispatch must still enforce its own atomic source validation.
 * @param session Durable native events, not assistant-authored receipts.
 * @param messageId Exact admitted user message identity.
 * @param scope Shot captured when the request was admitted.
 * @param port Authoritative Writer context reader.
 * @param reader Loopback reference-draft reader, absent when no facade is mounted.
 * @param signal Cancellation for both reads.
 * @returns Ready handoff only while both rereads agree, otherwise waiting, unavailable or blocked.
 */
export async function verifyReferenceHandoff(session: Pick<Session, 'id' | 'events'>, messageId: string,
  scope: DirectorObjectScope, port: DirectorContextReadPort, reader: ConnectionRpcHandler | undefined,
  signal: AbortSignal): Promise<ReferenceHandoff> {
  signal.throwIfAborted()
  const handoff = readReferenceHandoff(session, messageId, scope)
  if (handoff.status !== 'ready') return handoff
  if (!reader) return { status: 'unavailable' }
  const seq = session.events.at(-1)?.seq
  try {
    // A second observation catches source or draft movement between the independent reads.
    for (let pass = 0; pass < 2; pass++) {
      const context = await port.readDirectorContext(scope, signal)
      signal.throwIfAborted()
      if (!context.ok) return { status: 'unavailable' }
      const response = await reader('referenceVideoDraft', { projectId: scope.projectId, frameId: scope.shotId }, signal)
      signal.throwIfAborted()
      if (!response.ok) return { status: 'unavailable' }
      const value = response.value as ReferenceVideoDraftResponse
      if (Object.entries(scope).some(([key, expected]) => context.context[key as keyof DirectorObjectScope] !== expected)
        || context.context.contextSnapshotSha256 !== handoff.contextSnapshotSha256
        || value.projectId !== scope.projectId || value.frameId !== scope.shotId
        || value.frameSha256 !== handoff.frameSha256 || value.directorSource?.sha256 !== handoff.directorSourceSha256
        || value.draft?.revision !== handoff.revision || value.draft.requestSha256 !== handoff.requestSha256
        || value.draft.frameSha256 !== handoff.frameSha256 || value.draft.request.frameId !== scope.shotId
        || value.draft.request.directorSourceSha256 !== handoff.directorSourceSha256) {
        return { status: 'blocked', reason: 'reference_source_changed' }
      }
      if (session.events.at(-1)?.seq !== seq) return { status: 'blocked', reason: 'director_session_changed' }
    }
    return handoff
  } catch {
    signal.throwIfAborted()
    return { status: 'unavailable' }
  }
}
