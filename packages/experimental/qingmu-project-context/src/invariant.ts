/** Package-owned invariants for Qingmu project-context session events. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldProjectContext } from './fold.ts'
const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-qingmu-project-context'

export const name = 'experimental-qingmu-project-context-invariant'
export const inject = ['invariants']

function isPackageEvent(event: SessionEvent): boolean {
  return event.type === 'qingmu/project-context' || event.type === 'qingmu/director-proposal-receipt'
}

function validate(events: readonly SessionEvent[], fail: InvariantFailure): void {
  try {
    foldProjectContext(events)
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Qingmu project-context event is invalid')
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const staged = new WeakMap<SessionEvent, Session>()
  for (const session of ctx.sessions.list()) validate(session.events, fail)
  ctx.on('session/created', (session) => { validate(session.events, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isPackageEvent(event)) return
    validate([...session.events, event], fail)
    staged.set(event, session)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (!isPackageEvent(event)) return
    if (staged.get(event) !== session) {
      return fail('session/event reached publication without matching Qingmu project-context validation')
    }
    staged.delete(event)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register strict validation for replayed and newly appended package events. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
