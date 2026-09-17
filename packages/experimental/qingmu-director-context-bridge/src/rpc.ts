/** Loopback browser facade over the Host-owned director context bridge. */
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import type { DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextBridge } from './bridge.ts'
import { latestNativeDraftProposal, readNativeDraftInput, type NativeDraftReaders } from './native-draft.ts'
import { latestNativeFirstDraftProposal, readNativeFirstDraftInput } from './native-first-draft.ts'
import { verifyReferenceHandoff, type ReferenceHandoff } from './reference-handoff.ts'
import type { NativeFirstDraftProposalResult } from './types.ts'
import type {
  DirectorContextBridgeRpcResult, DirectorContextReadPort, DirectorObjectScope, NativeDraftProposalResult, NativeDirectorReadiness,
} from './types.ts'
import {
  readRelayBatch, startRelayBatch, admitRelayDirector, advanceRelayBatch,
  completeRelayBatch, closeRelayBatch, recoverRelayBatch, releaseDeadRelayHostLease,
} from './relay-controller.ts'
import type { RelayDriveReport } from './relay-runner.ts'
import type { RelayState } from './relay-state.ts'

const bad = (message: string): RpcResult<never> => ({
  ok: false, error: { code: 'bad-request', message, details: { issues: [] } },
})
const internal = (): RpcResult<never> => ({
  ok: false, error: { code: 'internal', message: 'Director context bridge unavailable', details: {} },
})
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join() === [...keys].sort().join()
const id = (value: unknown): string | null => typeof value === 'string'
  && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value) ? value : null
function scope(value: unknown): DirectorObjectScope | null {
  const raw = object(value)
  if (raw === null || !exact(raw, ['projectId', 'episodeId', 'sceneId', 'shotId'])) return null
  const values = [raw.projectId, raw.episodeId, raw.sceneId, raw.shotId].map(id)
  if (values.some(item => item === null)) return null
  return { projectId: values[0] as string, episodeId: values[1] as string,
    sceneId: values[2] as string, shotId: values[3] as string }
}

/**
 * Build the safe browser facade; it never returns Yimeng tokens or Host permits.
 * @param sessions Host-owned durable session lookup.
 * @param port Host-only Yimeng context reader.
 * @param draftReaders Optional native prompt and first-draft proposal readers.
 * @param readiness Optional scoped native tool registration check.
 * @param referenceReader Optional loopback reader for the saved reference draft.
 * @param relayDriver Optional Host drive for an open batch, cancelled with the calling RPC signal;
 * absent when no live agent registry is mounted.
 * @returns A loopback RPC handler limited to context binding, advisory proposal lineage,
 * native readiness and reference handoff evidence.
 */
export function createDirectorContextRpcHandler(
  sessions: Pick<SessionStore, 'get'>,
  port: DirectorContextReadPort,
  draftReaders?: NativeDraftReaders,
  readiness?: (session: Session) => NativeDirectorReadiness,
  referenceReader?: ConnectionRpcHandler,
  relayDriver?: (session: Session, signal: AbortSignal) => Promise<RelayDriveReport>,
): ConnectionRpcHandler {
  const bridge = createDirectorContextBridge(port)
  type Result = DirectorContextBridgeRpcResult | NativeDraftProposalResult | NativeFirstDraftProposalResult
    | NativeDirectorReadiness | ReferenceHandoff | RelayState | null | RelayDriveReport
    | { readonly state: RelayState }
    | { readonly state: RelayState | null; readonly recovered: boolean }
    | { readonly settling: boolean }
  return async (endpoint, payload, signal): Promise<RpcResult<Result>> => {
    try {
      const raw = object(payload)
      if (raw === null || typeof raw.sessionId !== 'string' || id(raw.sessionId) === null) {
        return bad('director context session invalid')
      }
      const session = sessions.get(SessionId(raw.sessionId))
      if (session === undefined) return bad('director context session unavailable')
      if (endpoint === 'readReferenceHandoff') {
        if (!exact(raw, ['sessionId', 'messageId', 'scope']) || id(raw.messageId) === null) return bad('reference handoff fields invalid')
        const requested = scope(raw.scope)
        if (requested === null) return bad('reference handoff scope invalid')
        signal.throwIfAborted()
        return { ok: true, value: await verifyReferenceHandoff(session, raw.messageId as string, requested, port, referenceReader, signal) }
      }
      if (endpoint === 'readNativeDirectorReadiness') {
        if (!exact(raw, ['sessionId'])) return bad('native readiness fields invalid')
        signal.throwIfAborted()
        return { ok: true, value: readiness?.(session)
          ?? { status: 'unavailable', presetId: null, tools: [], missingTools: [] } }
      }
      if (endpoint === 'readNativeDraftProposal' || endpoint === 'readNativeFirstDraftProposal') {
        if (!exact(raw, ['sessionId', 'scope'])) return bad('native draft fields invalid')
        const requested = scope(raw.scope)
        if (requested === null) return bad('native draft scope invalid')
        const first = endpoint === 'readNativeFirstDraftProposal'
        const proposal = first ? latestNativeFirstDraftProposal(session) : latestNativeDraftProposal(session)
        if (proposal === null) return { ok: true, value: { status: 'none' } }
        const current = bridge.current(session)
        const seq = session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq
        const sameScope = (candidate: DirectorObjectScope) => Object.entries(requested).every(([key, value]) =>
          candidate[key as keyof DirectorObjectScope] === value)
        if (current === null || seq === undefined || !sameScope(current.binding.scope) || !sameScope(proposal.input.scope)) {
          return { ok: true, value: { status: 'stale' } }
        }
        if (!draftReaders) return { ok: true, value: { status: 'unavailable' } }
        try {
          const context = await port.readDirectorContext(requested, signal)
          if (!context.ok) return { ok: true, value: { status: 'unavailable' } }
          const read = first ? readNativeFirstDraftInput : readNativeDraftInput
          const input = await read(context.context, requested, seq, draftReaders, signal)
          signal.throwIfAborted()
          const finalSeq = session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq
          if (finalSeq !== seq || input.receiptId !== proposal.input.receiptId) return { ok: true, value: { status: 'stale' } }
          return { ok: true, value: { status: 'current', proposal } as NativeDraftProposalResult | NativeFirstDraftProposalResult }
        } catch {
          return { ok: true, value: { status: 'unavailable' } }
        }
      }
      if (endpoint === 'enter') {
        if (!exact(raw, raw.ownerId === undefined ? ['sessionId', 'scope'] : ['sessionId', 'scope', 'ownerId'])
          || (raw.ownerId !== undefined && id(raw.ownerId) === null)) return bad('director context enter fields invalid')
        const requested = scope(raw.scope)
        if (requested === null) return bad('director context scope invalid')
        return { ok: true, value: await bridge.enter(session, requested, signal, raw.ownerId as string | undefined) }
      }
      if (endpoint === 'clear') {
        if (!exact(raw, ['sessionId', 'scope', 'ownerId']) || id(raw.ownerId) === null) {
          return bad('director context clear fields invalid')
        }
        const requested = scope(raw.scope)
        if (requested === null) return bad('director context scope invalid')
        signal.throwIfAborted()
        return { ok: true, value: bridge.clear(session, requested, raw.ownerId as string) }
      }
      if (endpoint === 'recover') {
        if (!exact(raw, ['sessionId'])) return bad('director context recover fields invalid')
        return { ok: true, value: await bridge.recover(session, signal) }
      }
      if (endpoint === 'bindProposal') {
        if (!exact(raw, ['sessionId', 'proposal']) || object(raw.proposal) === null) {
          return bad('director proposal binding fields invalid')
        }
        return { ok: true, value: {
          status: 'bound', state: bridge.bindProposal(session, raw.proposal as DirectorReplayProposal),
          manualWorkAllowed: true,
        } }
      }
      if (endpoint === 'readRelayState') {
        if (!exact(raw, ['sessionId'])) return bad('relay read fields invalid')
        return { ok: true, value: readRelayBatch(session) }
      }
      if (endpoint === 'startRelayBatch') {
        if (!exact(raw, ['sessionId', 'input'])) return bad('relay start fields invalid')
        const now = new Date().toISOString()
        const { state } = startRelayBatch(session, raw.input, now, port)
        return { ok: true, value: { state } }
      }
      if (endpoint === 'admitRelayDirector') {
        if (!exact(raw, ['sessionId', 'index', 'admission']) || !Number.isInteger(raw.index)
          || object(raw.admission) === null) return bad('relay admission fields invalid')
        const now = new Date().toISOString()
        const state = admitRelayDirector(session, raw.index as number, raw.admission as {
          message: import('@deepseek-ai/dsh-session').UserMessage
          contextSnapshotSha256: string
        }, now)
        return { ok: true, value: { state } }
      }
      if (endpoint === 'advanceRelayBatch') {
        if (!exact(raw, ['sessionId'])) return bad('relay advance fields invalid')
        const now = new Date().toISOString()
        const state = advanceRelayBatch(session, now)
        return { ok: true, value: { state } }
      }
      if (endpoint === 'completeRelayBatch') {
        if (!exact(raw, ['sessionId'])) return bad('relay complete fields invalid')
        const now = new Date().toISOString()
        const state = completeRelayBatch(session, now)
        return { ok: true, value: { state } }
      }
      if (endpoint === 'closeRelayBatch') {
        if (!exact(raw, ['sessionId', 'reason']) || typeof raw.reason !== 'string') return bad('relay close fields invalid')
        const now = new Date().toISOString()
        const state = closeRelayBatch(session, raw.reason as string, now)
        return { ok: true, value: { state } }
      }
      if (endpoint === 'recoverRelayBatch') {
        if (!exact(raw, ['sessionId'])) return bad('relay recover fields invalid')
        const recovered = recoverRelayBatch(session, port)
        return { ok: true, value: recovered
          ? { state: recovered.state, recovered: true }
          : { state: null, recovered: false } }
      }
      if (endpoint === 'releaseRelayHostLease') {
        if (!exact(raw, ['sessionId', 'batchId']) || id(raw.batchId) === null) return bad('relay lease release fields invalid')
        signal.throwIfAborted()
        return { ok: true, value: releaseDeadRelayHostLease(session, raw.batchId as string) }
      }
      if (endpoint === 'driveRelayBatch') {
        if (!exact(raw, ['sessionId'])) return bad('relay drive fields invalid')
        if (!relayDriver) return bad('relay driver unavailable')
        signal.throwIfAborted()
        return { ok: true, value: await relayDriver(session, signal) }
      }
      return bad('unknown director context operation')
    } catch {
      return internal()
    }
  }
}
