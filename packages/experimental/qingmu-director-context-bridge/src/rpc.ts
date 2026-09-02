/** Loopback browser facade over the Host-owned director context bridge. */
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextBridge } from './bridge.ts'
import type {
  DirectorContextBridgeRpcResult, DirectorContextReadPort, DirectorObjectScope,
} from './types.ts'

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
 * @returns A loopback RPC handler limited to context binding and advisory proposal lineage.
 */
export function createDirectorContextRpcHandler(
  sessions: Pick<SessionStore, 'get'>,
  port: DirectorContextReadPort,
): ConnectionRpcHandler {
  const bridge = createDirectorContextBridge(port)
  return async (endpoint, payload, signal): Promise<RpcResult<DirectorContextBridgeRpcResult>> => {
    try {
      const raw = object(payload)
      if (raw === null || typeof raw.sessionId !== 'string' || id(raw.sessionId) === null) {
        return bad('director context session invalid')
      }
      const session = sessions.get(SessionId(raw.sessionId))
      if (session === undefined) return bad('director context session unavailable')
      if (endpoint === 'enter') {
        if (!exact(raw, ['sessionId', 'scope'])) return bad('director context enter fields invalid')
        const requested = scope(raw.scope)
        if (requested === null) return bad('director context scope invalid')
        return { ok: true, value: await bridge.enter(session, requested, signal) }
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
      return bad('unknown director context operation')
    } catch {
      return internal()
    }
  }
}
