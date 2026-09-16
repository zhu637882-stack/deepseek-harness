/** Pure batch lifecycle helpers composing the existing relay-state ledger and bridge primitives.
 * These are NOT a new state machine — they call existing relay-state and bridge functions.
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { claimHostDirectorBinding, releaseHostDirectorBinding } from './bridge.ts'
import {
  appendRelayState, createRelayState, readRelayState, relayBatchIsOpen,
  type RelayState,
} from './relay-state.ts'
import type { DirectorContextEntryResult, DirectorContextReadPort, DirectorObjectScope } from './types.ts'

type HostLease = {
  enter(scope: DirectorObjectScope, signal?: AbortSignal): Promise<DirectorContextEntryResult>
  release(): void
}

/** Read the current relay state projection for browser consumption.
 * Pure read; no side effects.
 * @param session Session with a durable event stream.
 * @returns The latest validated relay ledger, or null when no relay event exists.
 */
export function readRelayBatch(session: Pick<Session, 'events'>): RelayState | null {
  return readRelayState(session)
}

/** Start a new relay batch: validate input, create state, append to session, claim Host lease.
 * @param session Session that will own the batch ledger.
 * @param input Untrusted batch input validated by the relay start schema.
 * @param now ISO timestamp for creation and expiry validation.
 * @param port Authoritative context reader for the Host lease.
 * @returns The initial state and the Host lease handle.
 * @throws When an open batch already exists or input is invalid.
 */
export function startRelayBatch(
  session: Session,
  input: unknown,
  now: string,
  port: DirectorContextReadPort,
): { state: RelayState; lease: HostLease } {
  const current = readRelayState(session)
  if (current && relayBatchIsOpen(current)) {
    throw new Error('An open relay batch already exists.')
  }
  const state = createRelayState(input, now)
  const expectedRevision = current ? current.revision : 0
  const adjusted = current ? { ...state, revision: current.revision + 1 } : state
  const saved = appendRelayState(session, adjusted, expectedRevision)
  const lease = claimHostDirectorBinding(session, saved.start.batchId, port)
  return { state: saved, lease }
}

/** Admit one director request and atomically transition the item to 'preparing' under a running batch.
 * appendRelayState requires that adding an admission also sets phase to 'preparing' and mode to 'running'.
 * First admission requires the batch to be running or paused; retry admission requires it to be paused.
 * @param session Session that owns the batch ledger.
 * @param index Ordered shot index of the item to admit.
 * @param admission The director message and context snapshot SHA.
 * @param now ISO timestamp for the admission record and ledger update.
 * @returns The updated validated state.
 */
export function admitRelayDirector(
  session: Session,
  index: number,
  admission: { message: UserMessage; contextSnapshotSha256: string },
  now: string,
): RelayState {
  const current = readRelayState(session)
  if (!current || !relayBatchIsOpen(current)) throw new Error('No open relay batch.')
  if (!Number.isSafeInteger(index) || index < 0 || index >= current.items.length) throw new Error('Invalid relay item index.')
  const item = current.items[index]
  if (!item) throw new Error('Invalid relay item index.')
  if (item.phase !== 'pending') throw new Error('Relay item is not pending.')
  if (item.admissions.length > 0 && current.mode !== 'paused') {
    throw new Error('Retry admission requires a paused batch.')
  }
  if (item.admissions.length === 0 && current.mode !== 'running' && current.mode !== 'paused') {
    throw new Error('First admission requires a running or paused batch.')
  }
  const next: RelayState = {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    mode: 'running',
    items: current.items.map((item, offset) => offset === index
      ? {
        ...item,
        phase: 'preparing' as const,
        admissions: [...item.admissions, {
          message: admission.message,
          contextSnapshotSha256: admission.contextSnapshotSha256,
          admittedAt: now,
        }],
      }
      : item),
  }
  return appendRelayState(session, next, current.revision)
}

/** Pause a running batch that has no admissions yet.
 * Called when the host has nothing to work on; resume happens via admitRelayDirector on a paused batch.
 * @param session Session that owns the batch ledger.
 * @param now ISO timestamp for the ledger update.
 * @returns The updated validated state with mode set to 'paused'.
 */
export function advanceRelayBatch(
  session: Session,
  now: string,
): RelayState {
  const current = readRelayState(session)
  if (!current || !relayBatchIsOpen(current)) throw new Error('No open relay batch.')
  const hasAdmissions = current.items.some(item => item.admissions.length > 0)
  if (hasAdmissions) throw new Error('Batch has admissions; pause is not applicable.')
  if (current.mode !== 'running') throw new Error('Cannot pause a non-running batch.')
  const next: RelayState = {
    ...current, revision: current.revision + 1, updatedAt: now, mode: 'paused', reason: 'awaiting_director_admission',
  }
  return appendRelayState(session, next, current.revision)
}

/** Complete a batch where all items have terminal evidence.
 * Sets mode to 'completed'. Terminal — cannot be reopened. Releases the Host lease.
 * @param session Session that owns the batch ledger.
 * @param now ISO timestamp for the ledger update.
 * @returns The updated validated state.
 * @throws When any item lacks settled or abandoned status.
 */
export function completeRelayBatch(
  session: Session,
  now: string,
): RelayState {
  const current = readRelayState(session)
  if (!current || !relayBatchIsOpen(current)) throw new Error('No open relay batch.')
  assertAllSettled(current)
  const next: RelayState = { ...current, revision: current.revision + 1, updatedAt: now, mode: 'completed', reason: null }
  const saved = appendRelayState(session, next, current.revision)
  releaseHostDirectorBinding(session, current.start.batchId)
  return saved
}

/** Close a batch that cannot continue (expired, all items abandoned, etc).
 * Sets mode to 'closed'. Terminal — cannot be reopened. Releases the Host lease.
 * Non-settled items are abandoned; settled items retain their evidence.
 * @param session Session that owns the batch ledger.
 * @param reason Human-readable close reason stored in the ledger.
 * @param now ISO timestamp for the ledger update.
 * @returns The updated validated state.
 */
export function closeRelayBatch(
  session: Session,
  reason: string,
  now: string,
): RelayState {
  const current = readRelayState(session)
  if (!current || !relayBatchIsOpen(current)) throw new Error('No open relay batch.')
  if (typeof reason !== 'string' || reason.length === 0) throw new Error('Close reason must be a non-empty string.')
  const next: RelayState = {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    mode: 'closed',
    reason,
    items: current.items.map(item => isSettled(item) ? item : { ...item, phase: 'abandoned' as const, reason }),
  }
  const saved = appendRelayState(session, next, current.revision)
  releaseHostDirectorBinding(session, current.start.batchId)
  return saved
}

/** Cold recovery: re-establish Host lease from durable session state.
 * If an open relay batch exists but no live Host lease, re-claim it.
 * @param session Session containing the relay's durable state event.
 * @param port Authoritative context reader.
 * @returns The recovered state and lease handle, or null if no recovery is needed.
 */
export function recoverRelayBatch(
  session: Session,
  port: DirectorContextReadPort,
): { state: RelayState; lease: HostLease } | null {
  const state = readRelayState(session)
  if (!state || !relayBatchIsOpen(state)) return null
  const lease = claimHostDirectorBinding(session, state.start.batchId, port)
  return { state, lease }
}

function assertAllSettled(state: RelayState): void {
  for (const [index, item] of state.items.entries()) {
    if (!isSettled(item) && item.phase !== 'abandoned') {
      throw new Error(`Relay item ${index} is not settled; cannot complete the batch.`)
    }
  }
}

function isSettled(item: { phase: string; run: { publicStatus: string } | null }): boolean {
  return (item.phase === 'collected' && item.run?.publicStatus === 'succeeded')
    || (item.phase === 'failed' && item.run?.publicStatus === 'failed')
}
