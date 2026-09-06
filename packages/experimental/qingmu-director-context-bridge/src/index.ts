/** Session-persistent Qingmu director context projection and UI-mountable bridge. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { directorContextBindingProjectionDefinition } from './projection.ts'
import { createDirectorContextRpcHandler } from './rpc.ts'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'

export { createDirectorContextBridge } from './bridge.ts'
export { createDirectorContextRpcHandler } from './rpc.ts'
export { directorContextBindingProjectionDefinition, directorContextBindingStateSchema } from './projection.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'experimental-qingmu-director-context-bridge'
/** The projection registry is the only runtime dependency. */
export const inject = ['sessionProjections']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only Yimeng command handler; never exposed through the director browser facade. */
    qingmuYimengCommand: ConnectionRpcHandler
  }
}

/** Register the latest whole-value director binding projection. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(directorContextBindingProjectionDefinition)
  ctx.inject(['connection', 'sessions', 'qingmuYimengCommand'], (host) => {
    const port = {
      readDirectorContext: async (scope: import('./types.ts').DirectorObjectScope, signal?: AbortSignal) => {
        const result = await host.qingmuYimengCommand('readDirectorContext', scope, signal ?? new AbortController().signal)
        return result.ok
          ? { ok: true as const, context: result.value as import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorContextSnapshot }
          : { ok: false as const, reason: 'context_unavailable' as const }
      },
    }
    const handler: ConnectionRpcHandler = (endpoint, payload, signal) => {
      const prompt = host.get('qingmuYimengRead')
      const method = host.get('qingmuImagoMethod')
      return createDirectorContextRpcHandler(host.sessions, port,
        prompt && method ? { prompt, method } : undefined)(endpoint, payload, signal)
    }
    host.connection.rpc.handle('/qingmu-director-context', handler, {
      authority: 'loopback',
    })
  })
}
