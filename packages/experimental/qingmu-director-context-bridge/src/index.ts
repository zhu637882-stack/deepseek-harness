/** Session-persistent Qingmu director context projection and UI-mountable bridge. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { directorContextBindingProjectionDefinition } from './projection.ts'
import { nativeDialogueProjection } from './dialogue-projection.ts'
import { relayStateProjectionDefinition } from './relay-projection.ts'
import { createDirectorContextRpcHandler } from './rpc.ts'
import { readNativeDirectorReadiness } from './native-readiness.ts'
import { readRelayState, relayBatchIsOpen } from './relay-state.ts'
import type { RelayDriveReport } from './relay-runner.ts'
import { DEFAULT_RELAY_DRIVE_INTERVAL_MS, startRelayHostLoop } from './relay-host-loop.ts'
import { registerExperienceCapsuleReviewRoutes } from './experience-capsule-review.ts'
import { resolveCapsuleRuntimeRoot } from './experience-capsule-store.ts'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'

export { createDirectorContextBridge } from './bridge.ts'
export { createDirectorContextRpcHandler } from './rpc.ts'
export { driveRelayBatch } from './relay-runner.ts'
export { directorContextBindingProjectionDefinition, directorContextBindingStateSchema } from './projection.ts'
export { relayStateProjectionDefinition } from './relay-projection.ts'
export {
  readRelayBatch, startRelayBatch, admitRelayDirector, advanceRelayBatch,
  completeRelayBatch, closeRelayBatch, recoverRelayBatch, releaseDeadRelayHostLease,
} from './relay-controller.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'experimental-qingmu-director-context-bridge'
/** The projection registry is the only runtime dependency. */
export const inject = ['sessionProjections']

/** Plugin configuration. */
export interface Config {
  /** Relay drive cadence of the Host-side loop, in milliseconds. */
  relayDriveIntervalMs?: number
}

/** Gateway plugin configuration. */
export const Config: z<Config> = z.object({
  relayDriveIntervalMs: z.natural().default(DEFAULT_RELAY_DRIVE_INTERVAL_MS),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only Yimeng command handler; never exposed through the director browser facade. */
    qingmuYimengCommand: ConnectionRpcHandler
  }
}

/** Register the latest whole-value director binding projection, the capsule review routes, and the relay drive loop. */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(directorContextBindingProjectionDefinition)
  ctx.sessionProjections.register(nativeDialogueProjection)
  ctx.sessionProjections.register(relayStateProjectionDefinition)
  ctx.inject(['connection', 'sessions', 'qingmuYimengCommand'], (host) => {
    const port = {
      readDirectorContext: async (scope: import('./types.ts').DirectorObjectScope, signal?: AbortSignal) => {
        const result = await host.qingmuYimengCommand('readDirectorContext', scope, signal ?? new AbortController().signal)
        return result.ok
          ? { ok: true as const, context: result.value as import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorContextSnapshot }
          : { ok: false as const, reason: 'context_unavailable' as const }
      },
    }
    const loop = startRelayHostLoop(host, {
      intervalMs: config.relayDriveIntervalMs ?? DEFAULT_RELAY_DRIVE_INTERVAL_MS,
      getAgent: sessionId => host.get('agents')?.get(sessionId),
      resolvePorts: () => {
        const prompt = host.get('qingmuYimengRead')
        if (!prompt) return null
        return {
          context: port, read: prompt, command: host.qingmuYimengCommand,
          flush: target => host.sessions.flush(target),
          now: () => new Date().toISOString(), requestId: () => crypto.randomUUID(),
        }
      },
    })
    host.effect(() => {
      const offEvents = host.on('session/event', (session, event) => {
        if (event.type !== 'qingmu-director-relay/state') return
        loop.observe(session.id, event.data.mode)
      })
      const offCreated = host.on('session/created', (session) => {
        const state = readRelayState(session)
        if (state !== null && relayBatchIsOpen(state)) loop.observe(session.id, state.mode)
      })
      const offDisposed = host.on('session/disposed', (session) => { loop.observe(session.id, null) })
      return () => {
        offEvents()
        offCreated()
        offDisposed()
      }
    }, 'qingmu-director-context: relay host loop registration')
    const handler: ConnectionRpcHandler = (endpoint, payload, signal) => {
      const prompt = host.get('qingmuYimengRead')
      const method = host.get('qingmuImagoMethod')
      const relayDriver = async (session: Session, driveSignal: AbortSignal): Promise<RelayDriveReport> => {
        const report = await loop.driveForRpc(session.id, driveSignal)
        return report.state === null ? { ...report, state: readRelayState(session) } : report
      }
      return createDirectorContextRpcHandler(host.sessions, port,
        prompt && method ? { prompt, method } : undefined,
        session => readNativeDirectorReadiness(host, session), prompt, relayDriver)(endpoint, payload, signal)
    }
    host.connection.rpc.handle('/qingmu-director-context', handler, {
      authority: 'loopback',
    })
  })
  ctx.inject(['webServer'], (host) => {
    ctx.effect(() => registerExperienceCapsuleReviewRoutes(host.webServer, {
      runtimeRoot: resolveCapsuleRuntimeRoot(),
    }))
  })
}
