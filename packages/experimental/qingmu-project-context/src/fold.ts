import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { QingmuProjectContextState } from './types.ts'
import { assertProposalReceipt, projectContextStateFromEvent } from './validation.ts'

/**
 * Reconstruct the latest project context solely from the append-only DSh session log.
 * @param events - immutable session-event snapshot to fold.
 * @returns the latest package state, or `null` when the session has never been bound.
 */
export function foldProjectContext(events: readonly SessionEvent[]): QingmuProjectContextState | null {
  let state: QingmuProjectContextState | null = null
  for (const event of events) {
    if (event.type === 'qingmu/project-context') state = projectContextStateFromEvent(event.data)
    if (event.type === 'qingmu/director-proposal-receipt') assertProposalReceipt(event.data, state)
  }
  return state
}
