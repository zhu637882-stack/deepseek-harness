/** Host relay driver: admits shots in order, drives the guarded director turn, and dispatches only durably reserved intents. */
import { assertNever, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {
  QueueReferenceVideoRequest, ReferenceVideoDraftResponse, ReferenceVideoQuoteResponse, ReferenceVideoRun,
  ReferenceVideoRunsResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { borrowHostDirectorBinding } from './bridge.ts'
import { readReferenceHandoff, verifyReferenceHandoff } from './reference-handoff.ts'
import { admitRelayDirector } from './relay-controller.ts'
import {
  appendRelayState, readRelayState, relayBatchIsOpen, reserveRelaySubmission,
  type RelayItem, type RelayState,
} from './relay-state.ts'
import type { DirectorContextEntryResult, DirectorContextReadPort, DirectorObjectScope } from './types.ts'

/** External surfaces the driver needs; every paid effect passes through the persisted ledger first. */
export interface RelayRunnerPorts {
  readonly context: DirectorContextReadPort
  readonly read: ConnectionRpcHandler
  readonly command: ConnectionRpcHandler
  readonly flush: (session: Session) => Promise<boolean>
  readonly now: () => string
  readonly requestId: () => string
}

/** One drive call's outcome; `steps` records each ledger-advancing action taken. */
export interface RelayDriveReport {
  readonly action: 'idle' | 'expired' | 'waiting' | 'blocked' | 'settled'
  readonly state: RelayState | null
  readonly reason?: string
  readonly index?: number
  readonly steps: readonly string[]
}

type RelayAgent = Pick<Agent, 'session' | 'status' | 'followup' | 'whenIdle'>

/** One drive's Host lease and the shot it has selected; relay execution resolves its owner from this lease. */
interface RelayLease {
  /** Read the authoritative context for one shot and make it the lease's selection. */
  enter(scope: DirectorObjectScope, signal: AbortSignal): Promise<DirectorContextEntryResult>
  /** Make one shot the lease's selection, reusing the earlier read while the scope is unchanged. */
  select(scope: DirectorObjectScope, signal: AbortSignal): Promise<void>
  release(): void
}

/** Borrow the batch's Host lease for one drive call, reusing the lease that start or recovery already holds.
 * @param session Session owning the open batch.
 * @param batchId Identity of the batch whose lease is borrowed.
 * @param port Authoritative context reader used by every selection.
 * @returns A lease that keeps its selection across the drive's internal steps; releasing it never drops a
 * lease the drive only borrowed, so the batch keeps its single writer until completion or close.
 */
function openRelayLease(session: Session, batchId: string, port: DirectorContextReadPort): RelayLease {
  const handle = borrowHostDirectorBinding(session, batchId, port)
  const key = (scope: DirectorObjectScope): string =>
    [scope.projectId, scope.episodeId, scope.sceneId, scope.shotId].join('\u0000')
  let selected: string | null = null
  return {
    async enter(scope, signal) {
      const result = await handle.enter(scope, signal)
      selected = key(scope)
      return result
    },
    async select(scope, signal) {
      if (selected === key(scope)) return
      await handle.enter(scope, signal)
      selected = key(scope)
    },
    release() { handle.release() },
  }
}

/** Phases that never advance: a collected shot is finished, the other three stop the batch for operator review. */
type ClosedPhase = 'collected' | 'failed' | 'blocked' | 'abandoned'

const closedPhases: readonly RelayItem['phase'][] = ['collected', 'failed', 'blocked', 'abandoned']

/** Whether one phase can no longer advance.
 * @param phase Durable phase of an unresolved relay item.
 * @returns True for finished and stopping phases; false for the phases the driver advances.
 */
function isClosed(phase: RelayItem['phase']): phase is ClosedPhase {
  return closedPhases.includes(phase)
}

function report(action: RelayDriveReport['action'], state: RelayState | null, steps: readonly string[],
  extra: { readonly reason?: string; readonly index?: number } = {}): RelayDriveReport {
  return { action, state, steps, ...extra }
}

/** Append one successor snapshot and require durable persistence before any later effect. */
async function persist(session: Session, ports: RelayRunnerPorts, next: RelayState, expectedRevision: number): Promise<RelayState> {
  const saved = appendRelayState(session, next, expectedRevision)
  if (!await ports.flush(session)) throw new Error('Relay ledger must persist before its effects.')
  return saved
}

/** Mark the first unresolved item blocked; the batch stops for operator review, never auto-retries. */
async function block(session: Session, ports: RelayRunnerPorts, state: RelayState, index: number,
  reason: string, steps: readonly string[]): Promise<RelayDriveReport> {
  const now = ports.now()
  const saved = await persist(session, ports, {
    ...state, revision: state.revision + 1, updatedAt: now,
    items: state.items.map((item, offset) => offset === index ? { ...item, phase: 'blocked' as const, reason } : item),
  }, state.revision)
  return report('blocked', saved, steps, { reason, index })
}

/** Record authoritative run evidence and the matching phase. */
function runUpdate(state: RelayState, index: number, run: ReferenceVideoRun, now: string): RelayState {
  const evidence = { runId: run.runId, taskId: run.taskId, publicStatus: run.publicStatus }
  const update = (phase: RelayItem['phase'], extra: Partial<RelayItem> = {}): RelayState => ({
    ...state, revision: state.revision + 1, updatedAt: now,
    items: state.items.map((candidate, offset) => offset === index
      ? { ...candidate, phase, run: evidence, ...extra }
      : candidate),
  })
  switch (run.publicStatus) {
    case 'queued': case 'running': case 'succeeded': return update(run.publicStatus)
    case 'failed': return update('failed', { settledAt: now, reason: run.errorCode ?? 'run_failed' })
    case 'quarantined': return update('blocked', { reason: `run_quarantined:${run.errorCode ?? 'unknown'}` })
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default: return assertNever(run.publicStatus, 'relay run status')
  }
}

/** Dispatch one persisted intent; on uncertainty the item moves to `unknown` and the next drive recovers by readback. */
async function dispatch(agent: RelayAgent, ports: RelayRunnerPorts, lease: RelayLease, state: RelayState, index: number,
  intent: QueueReferenceVideoRequest, steps: string[], signal: AbortSignal): Promise<RelayDriveReport> {
  const session = agent.session
  // Dispatch is the batch's only paid effect, so it requires a running batch. The prepared path reserved under
  // running already; this also gates the submitting/unknown redispatch, which has no prior mode check, so a paused
  // ledger waits for resume instead of replaying a reserved intent.
  if (state.mode !== 'running') {
    return report('waiting', state, steps, { reason: 'batch-paused', index })
  }
  const queued = await ports.command('queueReferenceVideo', intent, signal)
  if (!queued.ok) {
    const now = ports.now()
    const saved = await persist(session, ports, {
      ...state, revision: state.revision + 1, updatedAt: now,
      items: state.items.map((item, offset) => offset === index
        ? { ...item, phase: 'unknown' as const, reason: `dispatch_unconfirmed:${queued.error.code}` }
        : item),
    }, state.revision)
    return report('waiting', saved, steps, { reason: 'dispatch-unconfirmed', index })
  }
  const run = queued.value as ReferenceVideoRun
  const now = ports.now()
  const saved = await persist(session, ports, runUpdate(state, index, run, now), state.revision)
  steps.push(`dispatched:${index}:${run.publicStatus}`)
  if (run.publicStatus === 'queued' || run.publicStatus === 'running') {
    return report('waiting', saved, steps, { reason: 'run-in-flight', index })
  }
  if (run.publicStatus === 'quarantined') {
    return report('blocked', saved, steps, { reason: `run_quarantined:${run.errorCode ?? 'unknown'}`, index })
  }
  return advance(agent, ports, lease, steps, signal)
}

/** Advance one open batch as far as possible without waiting on external work.
 * Sequential per shot: admit, guarded turn, handoff, quote, reserve, dispatch, track, collect.
 * A blocked item or a failed run stops the batch and leaves its evidence intact; later shots are never admitted,
 * submitted or retried. While a run is only in flight, the next shot is admitted and prepared up to its handoff but
 * never reserved or dispatched, so it reaches the paid queue only after the current run settles and keeps payments
 * to one live submission at a time. Recovery replays only the exact persisted intent after readback proves absence.
 * Authorization expiry is decided once per drive; the ledger and the relay execution guard reject any later
 * admission or submission that outlives the batch authorization.
 * @param agent Live director agent that owns the relay session.
 * @param ports Host-only read, command, context and persistence surfaces.
 * @param steps Accumulator shared across the internal recursion; callers pass an empty array.
 * @param signal Cancellation for port reads and the dispatch command; the Yimeng adapters require one, so an
 * absent signal defaults to an uncancelled controller rather than reaching them as undefined.
 * @returns The outcome and every ledger-advancing step taken by this call; `settled` only when every shot is collected.
 */
export async function driveRelayBatch(agent: RelayAgent, ports: RelayRunnerPorts,
  steps: string[] = [], signal: AbortSignal = new AbortController().signal): Promise<RelayDriveReport> {
  const session = agent.session
  const initial = readRelayState(session)
  if (!initial || !relayBatchIsOpen(initial)) return report('idle', initial, steps)
  if (Date.parse(initial.start.authorization.expiresAt) <= Date.parse(ports.now())) {
    return report('expired', initial, steps, { reason: 'authorization-expired' })
  }
  // Relay execution resolves its owner from the live lease, so one drive borrows exactly one lease and every
  // internal step reuses it; a per-step borrow would leave the admitted shot unselected and reject the turn.
  const lease = openRelayLease(session, initial.start.batchId, ports.context)
  try {
    return await advance(agent, ports, lease, steps, signal)
  } finally {
    lease.release()
  }
}

/** Re-read the ledger inside one drive; the drive claimed its lease from an open batch and never reopens it. */
function openLedger(session: Session): RelayState {
  const state = readRelayState(session)
  /* v8 ignore next -- a concurrent close is the only way an open drive loses its batch */
  if (!state || !relayBatchIsOpen(state)) throw new Error('Relay batch closed during its drive.')
  return state
}

/** Drive one indexed shot from pending to its durable prepared handoff, then stop before any reserve or dispatch.
 * Preparing stops at `prepared`, so it never mints a request ID, reserves budget or reaches the paid queue; the
 * single-active-submission ledger invariant independently forbids a second live submission. The same routine serves
 * the batch's first unresolved shot and the prepare-ahead of the next shot while the current run is in flight.
 * @param agent Live director agent that owns the relay session.
 * @param ports Host-only read, command, context and persistence surfaces.
 * @param lease The drive's single Host lease, whose selection this routine moves to the prepared shot.
 * @param index Ordered shot index to prepare; an index past the last shot has nothing to prepare.
 * @param steps Accumulator shared across the drive.
 * @param signal Cancellation for port reads and the director turn.
 * @returns Null once the shot is prepared, already past preparing, or out of range; otherwise the waiting or blocked
 * report that stops this shot's preparation.
 */
async function prepareShot(agent: RelayAgent, ports: RelayRunnerPorts, lease: RelayLease, index: number,
  steps: string[], signal: AbortSignal): Promise<RelayDriveReport | null> {
  const session = agent.session
  for (;;) {
    const state = openLedger(session)
    if (index >= state.items.length) return null
    const item = state.items[index] as RelayItem
    if (item.phase !== 'pending' && item.phase !== 'preparing') return null
    if (item.phase !== 'pending') await lease.select(item.scope, signal)
    if (item.phase === 'pending') {
      const entry = await lease.enter(item.scope, signal)
      if (entry.status !== 'current') {
        return report('waiting', state, steps, { reason: `context-${entry.status}`, index })
      }
      const contextSnapshotSha256 = entry.state.binding.contextSnapshotSha256
      const message = createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'text', text: JSON.stringify({
          schema: 'qingmu.native-director-request.v1', sessionId: session.id,
          ownerId: state.start.batchId, scope: item.scope, contextSnapshotSha256,
        }) },
        { type: 'text', text: state.start.instruction },
      ] })
      admitRelayDirector(session, index, { message, contextSnapshotSha256 }, ports.now())
      if (!await ports.flush(session)) throw new Error('Relay admission must persist before its turn.')
      steps.push(`admitted:${index}`)
      continue
    }
    const admission = item.admissions.at(-1)
    /* v8 ignore next -- relayStateSchema requires an admission for preparing items */
    if (!admission) throw new Error('Preparing relay item lost its durable admission.')
    let handoff = readReferenceHandoff(session, admission.message.id, item.scope)
    if (handoff.status === 'waiting') {
      const logged = session.events.some(event => event.type === 'user/message' && event.data.id === admission.message.id)
      if (logged) return block(session, ports, state, index, 'director_turn_interrupted', steps)
      if (agent.status !== 'idle') return report('waiting', state, steps, { reason: 'agent-busy', index })
      agent.followup(admission.message)
      await agent.whenIdle()
      steps.push(`turned:${index}`)
      handoff = readReferenceHandoff(session, admission.message.id, item.scope)
      if (handoff.status === 'waiting') {
        return block(session, ports, state, index, 'director_turn_unconsumed', steps)
      }
    }
    if (handoff.status === 'blocked') {
      return block(session, ports, state, index, `handoff:${handoff.reason}`, steps)
    }
    const verified = await verifyReferenceHandoff(session, admission.message.id, item.scope, ports.context, ports.read,
      signal)
    if (verified.status === 'blocked') {
      return block(session, ports, state, index, `handoff:${verified.reason}`, steps)
    }
    if (verified.status !== 'ready') {
      return report('waiting', state, steps, { reason: 'handoff-unavailable', index })
    }
    const now = ports.now()
    await persist(session, ports, {
      ...state, revision: state.revision + 1, updatedAt: now,
      items: state.items.map((candidate, offset) => offset === index ? {
        ...candidate, phase: 'prepared' as const, preparedAt: now,
        handoff: {
          messageId: verified.messageId, turn: verified.turn, endSeq: verified.endSeq,
          revision: verified.revision, requestSha256: verified.requestSha256, frameSha256: verified.frameSha256,
          directorSourceSha256: verified.directorSourceSha256, contextSnapshotSha256: verified.contextSnapshotSha256,
        },
      } : candidate),
    }, state.revision)
    steps.push(`prepared:${index}`)
    return null
  }
}

/** Prepare the shot after an in-flight one, but only while the batch is running.
 * Admitting the next director request flips a paused batch back to running, so a paused ledger must keep waiting on
 * its in-flight shot instead of silently resuming; the guard confines prepare-ahead to a batch the operator left running.
 * @param agent Live director agent that owns the relay session.
 * @param ports Host-only read, command, context and persistence surfaces.
 * @param lease The drive's single Host lease.
 * @param state Ledger snapshot whose mode gates the prepare-ahead.
 * @param index Ordered shot index of the in-flight shot; the next shot is the one prepared.
 * @param steps Accumulator shared across the drive.
 * @param signal Cancellation for port reads and the director turn.
 * @returns Null when the next shot was prepared, was already past preparing, does not exist, or the batch is paused;
 * otherwise the waiting or blocked report that stops the preparation.
 */
async function prepareAhead(agent: RelayAgent, ports: RelayRunnerPorts, lease: RelayLease, state: RelayState,
  index: number, steps: string[], signal: AbortSignal): Promise<RelayDriveReport | null> {
  if (state.mode !== 'running') return null
  return prepareShot(agent, ports, lease, index + 1, steps, signal)
}

/** Advance the first unresolved shot under one claimed lease, recursing with the same lease after each step. */
async function advance(agent: RelayAgent, ports: RelayRunnerPorts, lease: RelayLease,
  steps: string[], signal: AbortSignal): Promise<RelayDriveReport> {
  const session = agent.session
  const initial = openLedger(session)
  // Only a collected shot is passed over; a failed, blocked or abandoned shot halts the drive before any further
  // effect, so on that halted drive later shots are never admitted or submitted and the durable evidence is left
  // untouched for operator review. An in-flight shot does not halt: it prepares the next shot without paying for it.
  const firstUnresolved = initial.items.findIndex(item => item.phase !== 'collected')
  if (firstUnresolved === -1) return report('settled', initial, steps)
  const item = initial.items[firstUnresolved] as RelayItem
  if (isClosed(item.phase)) {
    return report('blocked', initial, steps, { reason: item.reason ?? item.phase, index: firstUnresolved })
  }
  if (item.phase !== 'pending') await lease.select(item.scope, signal)
  switch (item.phase) {
    case 'pending': case 'preparing': {
      const prepared = await prepareShot(agent, ports, lease, firstUnresolved, steps, signal)
      if (prepared) return prepared
      return advance(agent, ports, lease, steps, signal)
    }
    case 'prepared': {
      const handoff = item.handoff
      /* v8 ignore next -- relayStateSchema requires handoff evidence for prepared items */
      if (!handoff) throw new Error('Prepared relay item lost its durable handoff.')
      const scope = { projectId: item.scope.projectId, frameId: item.scope.shotId }
      const draftRead = await ports.read('referenceVideoDraft', scope, signal)
      if (!draftRead.ok) return report('waiting', initial, steps, { reason: 'draft-unavailable', index: firstUnresolved })
      const draft = draftRead.value as ReferenceVideoDraftResponse
      if (draft.draft === null || draft.draft.revision !== handoff.revision
        || draft.draft.requestSha256 !== handoff.requestSha256 || draft.frameSha256 !== handoff.frameSha256
        || draft.directorSource?.sha256 !== handoff.directorSourceSha256) {
        return block(session, ports, initial, firstUnresolved, 'reference_source_changed', steps)
      }
      const quoteRead = await ports.read('referenceVideoQuote', {
        ...draft.draft.request, projectId: scope.projectId,
        draftRevision: handoff.revision, draftRequestSha256: handoff.requestSha256,
      }, signal)
      if (!quoteRead.ok) return report('waiting', initial, steps, { reason: 'quote-unavailable', index: firstUnresolved })
      const quote = quoteRead.value as ReferenceVideoQuoteResponse
      if (!quote.generationSubmissionEnabled) {
        return block(session, ports, initial, firstUnresolved, 'generation_submission_disabled', steps)
      }
      const intent: QueueReferenceVideoRequest = {
        ...scope, requestId: ports.requestId(), expectedRevision: handoff.revision,
        expectedRequestSha256: handoff.requestSha256, quoteSha256: quote.quoteSha256,
        authorizationCapCny: quote.cost.estimatedCny, paidConfirmed: true,
      }
      let reserved: RelayState
      try {
        reserved = reserveRelaySubmission(initial, firstUnresolved, intent, ports.now())
      } catch (error) {
        return block(session, ports, initial, firstUnresolved, (error as Error).message, steps)
      }
      const persisted = await persist(session, ports, reserved, initial.revision)
      steps.push(`reserved:${firstUnresolved}`)
      return dispatch(agent, ports, lease, persisted, firstUnresolved, intent, steps, signal)
    }
    case 'submitting': case 'unknown': {
      const submission = item.submission
      /* v8 ignore next -- relayStateSchema requires submission evidence for submitted items */
      if (!submission) throw new Error('Submitted relay item lost its durable intent.')
      const scope = { projectId: item.scope.projectId, frameId: item.scope.shotId }
      const list = await ports.read('referenceVideoRuns', scope, signal)
      if (!list.ok) return report('waiting', initial, steps, { reason: 'run-list-unavailable', index: firstUnresolved })
      const runs = list.value as ReferenceVideoRunsResponse
      const found = runs.items.find(candidate => candidate.runId === `refvideo_${submission.requestId}`)
      if (found) {
        const saved = await persist(session, ports, runUpdate(initial, firstUnresolved, found, ports.now()), initial.revision)
        steps.push(`recovered:${firstUnresolved}:${found.publicStatus}`)
        if (found.publicStatus === 'queued' || found.publicStatus === 'running') {
          return report('waiting', saved, steps, { reason: 'run-in-flight', index: firstUnresolved })
        }
        if (found.publicStatus === 'quarantined') {
          return report('blocked', saved, steps, { reason: `run_quarantined:${found.errorCode ?? 'unknown'}`, index: firstUnresolved })
        }
        return advance(agent, ports, lease, steps, signal)
      }
      // Readback proves the run was never created; replay the exact persisted intent, never a new request ID.
      steps.push(`redispatch:${firstUnresolved}`)
      return dispatch(agent, ports, lease, initial, firstUnresolved, submission, steps, signal)
    }
    case 'queued': case 'running': {
      const active = item.run
      /* v8 ignore next -- relayStateSchema requires run evidence for active items */
      if (!active) throw new Error('Active relay item lost its durable run evidence.')
      const runRead = await ports.read('referenceVideoRun', {
        projectId: item.scope.projectId, frameId: item.scope.shotId, runId: active.runId,
      }, signal)
      if (!runRead.ok) return report('waiting', initial, steps, { reason: 'run-read-unavailable', index: firstUnresolved })
      const run = runRead.value as ReferenceVideoRun
      if (run.taskId !== active.taskId) return block(session, ports, initial, firstUnresolved, 'run_identity_changed', steps)
      if (run.publicStatus === active.publicStatus) {
        const ahead = await prepareAhead(agent, ports, lease, initial, firstUnresolved, steps, signal)
        if (ahead) return ahead
        return report('waiting', openLedger(session), steps, { reason: 'run-in-flight', index: firstUnresolved })
      }
      const saved = await persist(session, ports, runUpdate(initial, firstUnresolved, run, ports.now()), initial.revision)
      steps.push(`run:${firstUnresolved}:${run.publicStatus}`)
      if (run.publicStatus === 'queued' || run.publicStatus === 'running') {
        const ahead = await prepareAhead(agent, ports, lease, saved, firstUnresolved, steps, signal)
        if (ahead) return ahead
        return report('waiting', openLedger(session), steps, { reason: 'run-in-flight', index: firstUnresolved })
      }
      if (run.publicStatus === 'quarantined') {
        return report('blocked', saved, steps, { reason: `run_quarantined:${run.errorCode ?? 'unknown'}`, index: firstUnresolved })
      }
      return advance(agent, ports, lease, steps, signal)
    }
    case 'succeeded': {
      const now = ports.now()
      await persist(session, ports, {
        ...initial, revision: initial.revision + 1, updatedAt: now,
        items: initial.items.map((candidate, offset) => offset === firstUnresolved
          ? { ...candidate, phase: 'collected' as const, collectedAt: now, settledAt: now }
          : candidate),
      }, initial.revision)
      steps.push(`collected:${firstUnresolved}`)
      return advance(agent, ports, lease, steps, signal)
    }
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default: return assertNever(item.phase, 'relay item phase')
  }
}
