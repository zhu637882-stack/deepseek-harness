/** Read-only context refresh plus session-log binding orchestration. */

import type { Session } from '@deepseek-ai/dsh-session'
import type {
  DirectorContextSnapshot,
  DirectorProposalFreshnessRequest,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { directorContextBindingStateSchema } from './projection.ts'
import { readRelayState, relayBatchIsOpen } from './relay-state.ts'
import type {
  DirectorContextBindingState,
  DirectorContextBridge,
  DirectorContextEntryResult,
  DirectorContextReadPort,
  DirectorContextRecoveryResult,
  DirectorObjectScope,
  NativeDirectorPromptTarget,
  DirectorProposalBinding,
} from './types.ts'

const SHA256 = /^[0-9a-f]{64}$/u
const sessionOperationEpochs = new WeakMap<Session, number>()
const browserOwners = new WeakMap<Session, { ownerId: string; scope: DirectorObjectScope }>()
interface HostOwner {
  batchId: string
  scope: DirectorObjectScope | null
  operations: number
  released: boolean
  invalidated: boolean
}
const hostOwners = new WeakMap<Session, HostOwner>()

function browserAllowed(session: Session): boolean {
  const relay = readRelayState(session)
  return !hostOwners.has(session) && (relay === null || !relayBatchIsOpen(relay))
}

function assertBrowserAllowed(session: Session): void {
  if (!browserAllowed(session)) throw new Error('The director session is reserved by a relay batch.')
}

function hostAllowed(session: Session, owner: HostOwner): boolean {
  const relay = readRelayState(session)
  return hostOwners.get(session) === owner && !owner.released && !owner.invalidated
    && relay?.start.batchId === owner.batchId && relay.mode === 'running'
    && Date.parse(relay.start.authorization.expiresAt) > Date.now()
}

/** Whether a browser currently owns this session's object selection.
 * @param session Live director session.
 * @returns True while a browser view holds the object selection.
 */
export function hasBrowserDirectorOwner(session: Session): boolean {
  return browserAllowed(session) && browserOwners.has(session)
}

/** Whether a live Host lease exists; durable relay state alone does not establish ownership.
 * @param session Live director session.
 * @returns True while any Host lease is recorded, running or not.
 */
export function hasHostDirectorOwner(session: Session): boolean {
  return hostOwners.has(session)
}

/** Invalidate without releasing in-flight operations.
 * @param session Leased director session. Explicit release is required before reacquisition.
 */
export function invalidateHostDirectorBinding(session: Session): void {
  const owner = hostOwners.get(session)
  if (owner) owner.invalidated = true
}

/** Release the Host lease of a terminal batch when the caller no longer holds the lease handle.
 * In-flight operations settle before removal, matching the lease's own release semantics.
 * @param session Leased director session.
 * @param batchId Identity of the batch whose lease is released; a mismatch leaves the lease untouched.
 */
export function releaseHostDirectorBinding(session: Session, batchId: string): void {
  const owner = hostOwners.get(session)
  if (!owner || owner.batchId !== batchId) return
  owner.released = true
  if (owner.operations === 0) hostOwners.delete(session)
  supersedePendingOperations(session)
}

/** Claim a logged relay's selection without creating a browser lease. Only a `running` or `paused`
 * batch is claimable, so an explicit resume can reacquire the Host; `completed` and `closed` are terminal
 * and return the session to browser ownership.
 * @param session Session containing the relay's required state event.
 * @param batchId Exact unfinished batch identity.
 * @param port Authoritative context reader.
 * @returns Shot selection and token-checked release; neither permits model or payment effects.
 */
export function claimHostDirectorBinding(session: Session, batchId: string, port: DirectorContextReadPort): {
  enter(scope: DirectorObjectScope, signal?: AbortSignal): Promise<DirectorContextEntryResult>
  release(): void
} {
  const relay = readRelayState(session)
  if (!relay || relay.start.batchId !== batchId || !relayBatchIsOpen(relay) || hostOwners.has(session)) {
    throw new Error('Relay batch does not have an available Host lease.')
  }
  const owner: HostOwner = { batchId, scope: null, operations: 0, released: false, invalidated: false }
  hostOwners.set(session, owner)
  browserOwners.delete(session)
  supersedePendingOperations(session)
  return {
    async enter(scope, signal) {
      if (!hostAllowed(session, owner)) throw new Error('Relay Host lease is no longer running.')
      if (owner.operations > 0) throw new Error('Relay director operation is still busy.')
      if (!relay.start.shots.some(shot => scopeEquals(shot.scope, scope))) throw new Error('Shot scope is not in the relay batch.')
      signal?.throwIfAborted()
      owner.scope = { ...scope }
      return enterBinding(session, scope, port, () => hostAllowed(session, owner), signal)
    },
    release() {
      if (hostOwners.get(session) !== owner) return
      owner.released = true
      if (owner.operations === 0) hostOwners.delete(session)
      supersedePendingOperations(session)
    },
  }
}

/** Retain Host ownership until an admitted asynchronous operation has settled.
 * @param session Leased director session.
 * @param operation Effect to run under the lease.
 * @returns The operation result; the lease is released only after it settles.
 */
export async function withHostDirectorOperation<T>(session: Session, operation: () => Promise<T>): Promise<T> {
  const owner = hostOwners.get(session)
  if (!owner || !hostAllowed(session, owner)) throw new Error('Relay Host lease is unavailable.')
  owner.operations++
  try {
    return await operation()
  } finally {
    owner.operations--
    if (owner.released && owner.operations === 0 && hostOwners.get(session) === owner) hostOwners.delete(session)
  }
}

/** Retain Host ownership across stream yields and asynchronous iterator cleanup.
 * @param session Leased director session.
 * @param operation Stream to consume under the lease.
 * @returns A generator over the operation's values, held until it finishes or returns.
 */
export async function* withHostDirectorStream<T>(session: Session, operation: () => AsyncIterable<T>): AsyncGenerator<T> {
  const owner = hostOwners.get(session)
  if (!owner || !hostAllowed(session, owner)) throw new Error('Relay Host lease is unavailable.')
  owner.operations++
  try {
    yield* operation()
  } finally {
    owner.operations--
    if (owner.released && owner.operations === 0 && hostOwners.get(session) === owner) hostOwners.delete(session)
  }
}

/** Refresh only the selected object while retaining its current live owner.
 * @param session Native director session.
 * @param port Authoritative context reader.
 * @param signal Optional cancellation.
 * @returns Current, unavailable or superseded binding result.
 */
export async function refreshNativeDirectorBinding(
  session: Session, port: DirectorContextReadPort, signal?: AbortSignal,
): Promise<DirectorContextEntryResult> {
  const owner = hostOwners.get(session)
  if (!owner) {
    assertBrowserAllowed(session)
    const state = currentState(session)
    if (!state) throw new Error('No Qingmu shot is bound to this session.')
    return createDirectorContextBridge(port).enter(session, state.binding.scope, signal)
  }
  const state = currentState(session)
  if (!hostAllowed(session, owner) || !state || !owner.scope || !scopeEquals(owner.scope, state.binding.scope)) {
    throw new Error('Relay Host lease has no current shot selection.')
  }
  return enterBinding(session, state.binding.scope, port, () => hostAllowed(session, owner), signal)
}

/** Check a message's fixed target against the live binding; never rebind from message content.
 * @param session Bound live director session.
 * @param target Coordinates recorded with the consumed director request.
 */
export function assertNativePromptTarget(session: Session, target: NativeDirectorPromptTarget): void {
  assertNativePromptSelection(session, target)
  if (currentState(session)?.binding.contextSnapshotSha256 !== target.contextSnapshotSha256) {
    throw new Error('This director request context has changed. Read and assess the current shot before another write.')
  }
}

/** Check owner and selected object even when recovering an already committed command.
 * This does not authorize a fresh mutation under a changed context.
 * @param session Owning live session.
 * @param target Consumed, browser-scoped user request.
 */
export function assertNativePromptSelection(session: Session, target: NativeDirectorPromptTarget): void {
  const host = hostOwners.get(session)
  const owner = host
    ? hostAllowed(session, host) && host.scope ? { ownerId: host.batchId, scope: host.scope } : undefined
    : browserAllowed(session) ? browserOwners.get(session) : undefined
  const current = currentState(session)
  if (target.sessionId !== session.id || !owner || owner.ownerId !== target.ownerId || !current
    || !scopeEquals(owner.scope, target.scope) || !scopeEquals(current.binding.scope, target.scope)) {
    throw new Error('This director request belongs to a previous shot selection. Return to the intended shot and send a new request; no other shot was read.')
  }
}

interface SessionOperation {
  readonly epoch: number
  readonly bindingEventSeq: number | null
}

function scopeEquals(left: DirectorObjectScope, right: DirectorObjectScope): boolean {
  return left.projectId === right.projectId
    && left.episodeId === right.episodeId
    && left.sceneId === right.sceneId
    && left.shotId === right.shotId
}

function assertScope(scope: DirectorObjectScope): void {
  for (const [key, value] of Object.entries(scope)) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`)
  }
}

function assertSha256(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256`)
}

function assertContext(scope: DirectorObjectScope, context: DirectorContextSnapshot): void {
  const actual = context as unknown as Record<string, unknown>
  if (actual.schema !== 'jason.qingmu-director-context-snapshot.v1'
    || actual.projectId !== scope.projectId
    || actual.episodeId !== scope.episodeId
    || actual.sceneId !== scope.sceneId
    || actual.shotId !== scope.shotId
    || actual.providerCalls !== 0
    || actual.costAmountCny !== '0'
    || actual.businessStateChanged !== false
    || actual.humanDecisionInferred !== false
    || actual.formalQcInferred !== false
    || actual.selectionGranted !== false
    || actual.readyGranted !== false) {
    throw new Error('director context does not match the requested zero-authority scope')
  }
  assertSha256(context.contextSnapshotSha256, 'contextSnapshotSha256')
}

function currentBindingEventSeq(session: Session): number | null {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'qingmu-director-context/state') {
      return event.seq
    }
  }
  return null
}

/** Read the validated latest object binding without refreshing its revision.
 * @param session Owning native event log.
 * @returns Current binding, or null when the session has never selected an object.
 */
export function currentState(session: Session): DirectorContextBindingState | null {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'qingmu-director-context/state') {
      return event.data === null ? null : directorContextBindingStateSchema.parse(event.data)
    }
  }
  return null
}

function supersedePendingOperations(session: Session): number {
  const epoch = (sessionOperationEpochs.get(session) ?? 0) + 1
  sessionOperationEpochs.set(session, epoch)
  return epoch
}

function beginOperation(session: Session): SessionOperation {
  return {
    epoch: supersedePendingOperations(session),
    bindingEventSeq: currentBindingEventSeq(session),
  }
}

function isCurrentOperation(session: Session, operation: SessionOperation): boolean {
  return sessionOperationEpochs.get(session) === operation.epoch
    && currentBindingEventSeq(session) === operation.bindingEventSeq
}

function appendState(session: Session, state: DirectorContextBindingState): DirectorContextBindingState {
  const validated = directorContextBindingStateSchema.parse(state)
  session.append('qingmu-director-context/state', validated)
  return validated
}

function proposalId(state: DirectorContextBindingState | null): string | undefined {
  return state?.proposal?.proposalId
}

function freshnessBinding(proposal: DirectorReplayProposal): DirectorProposalBinding {
  return {
    projectId: proposal.projectId,
    episodeId: proposal.episodeId,
    sceneId: proposal.sceneId,
    shotId: proposal.shotId,
    contextSnapshotSha256: proposal.inputSha256,
    methodPackageVersion: proposal.methodPackage.version,
    methodPackageSha256: proposal.methodPackage.methodPackageSha256,
    workOrderId: proposal.workOrder.workOrderId,
    workOrderSha256: proposal.workOrder.workOrderSha256,
    promptSha256: proposal.workOrder.promptSha256,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalSha256,
    outputSha256: proposal.outputSha256,
  }
}

function assertProposal(state: DirectorContextBindingState, proposal: DirectorReplayProposal): void {
  const scope = state.binding.scope
  const actual = proposal as unknown as Record<string, unknown>
  const workOrder = actual.workOrder as Record<string, unknown> | undefined
  const execution = actual.execution as Record<string, unknown> | undefined
  if (actual.projectId !== scope.projectId
    || actual.episodeId !== scope.episodeId
    || actual.sceneId !== scope.sceneId
    || actual.shotId !== scope.shotId
    || actual.inputSha256 !== state.binding.contextSnapshotSha256
    || workOrder?.inputSha256 !== state.binding.contextSnapshotSha256
    || actual.stale !== false
    || !Array.isArray(actual.staleReasons)
    || actual.staleReasons.length !== 0
    || actual.advisoryOnly !== true
    || execution?.networkUsed !== false
    || execution.providerCalls !== 0
    || execution.costAmountCny !== '0') {
    throw new Error('director proposal does not match the current zero-cost context binding')
  }
}

async function readContext(port: DirectorContextReadPort, scope: DirectorObjectScope, signal?: AbortSignal) {
  try {
    return await port.readDirectorContext(scope, signal)
  } catch {
    return { ok: false, reason: 'context_unavailable' } as const
  }
}

async function enterBinding(
  session: Session, scope: DirectorObjectScope, port: DirectorContextReadPort, allowed: () => boolean, signal?: AbortSignal,
): Promise<DirectorContextEntryResult> {
  assertScope(scope)
  const previous = currentState(session)
  if (signal?.aborted) {
    return { status: 'unavailable', state: previous, changed: false, reason: 'context_unavailable', manualWorkAllowed: true }
  }
  const sameScope = previous !== null && scopeEquals(previous.binding.scope, scope)
  // Invalidate before I/O so a failed switch never exposes the previous shot.
  const cleared = previous !== null && !sameScope
  if (cleared) session.append('qingmu-director-context/state', null)
  const operation = beginOperation(session)
  const result = await readContext(port, scope, signal)
  if (!isCurrentOperation(session, operation) || !allowed()) {
    return { status: 'superseded', state: currentState(session), changed: false, manualWorkAllowed: true }
  }
  if (signal?.aborted || !result.ok) {
    return { status: 'unavailable', state: currentState(session), changed: cleared,
      reason: result.ok ? 'context_unavailable' : result.reason, manualWorkAllowed: true }
  }
  assertContext(scope, result.context)
  if (sameScope && previous.binding.contextSnapshotSha256 === result.context.contextSnapshotSha256) {
    return { status: 'current', state: previous, changed: false, manualWorkAllowed: true }
  }
  const state = appendState(session, {
    version: 1, binding: { scope: { ...scope }, contextSnapshotSha256: result.context.contextSnapshotSha256 },
    proposal: null, transition: sameScope ? 'recovery_drift' : previous === null ? 'enter' : 'switch',
  })
  const invalidatedProposalId = proposalId(previous)
  return { status: 'current', state, changed: true, manualWorkAllowed: true,
    ...(invalidatedProposalId === undefined ? {} : { invalidatedProposalId }) }
}

/**
 * Create the future Qingmu UI mount interface around one read-only context port.
 * The port must reuse the existing normalized `director-inference/context` path;
 * this bridge never invokes a model, work-order command, Provider, or business write.
 * @param port - Read-only current-context adapter.
 * @returns Session binding, proposal attachment, and cold-recovery operations.
 */
export function createDirectorContextBridge(port: DirectorContextReadPort): DirectorContextBridge {
  return {
    /** Read the current authoritative context and bind this DSh session to its exact object. */
    async enter(
      session: Session,
      scope: DirectorObjectScope,
      signal?: AbortSignal,
      ownerId?: string,
    ): Promise<DirectorContextEntryResult> {
      assertBrowserAllowed(session)
      assertScope(scope)
      if (!signal?.aborted) {
        if (ownerId !== undefined) {
          if (!/^[A-Za-z0-9_.:-]{1,256}$/u.test(ownerId)) throw new Error('invalid director binding owner')
          browserOwners.set(session, { ownerId, scope: { ...scope } })
        } else {
          const owner = browserOwners.get(session)
          if (owner !== undefined && !scopeEquals(owner.scope, scope)) browserOwners.delete(session)
        }
      }
      return enterBinding(session, scope, port, () => browserAllowed(session), signal)
    },

    /** Release only the matching browser lease; old-view cleanup cannot clear a new selection. */
    clear(session, scope, ownerId) {
      assertBrowserAllowed(session)
      const owner = browserOwners.get(session)
      const state = currentState(session)
      if (owner?.ownerId !== ownerId || !scopeEquals(owner.scope, scope)
        || (state !== null && !scopeEquals(state.binding.scope, scope))) {
        return { status: 'superseded', state, changed: false, manualWorkAllowed: true }
      }
      supersedePendingOperations(session)
      browserOwners.delete(session)
      if (state !== null) session.append('qingmu-director-context/state', null)
      return { status: 'cleared', state: null, changed: state !== null, manualWorkAllowed: true }
    },

    /** Attach only an advisory proposal whose existing freshness coordinates match the active binding. */
    bindProposal(session: Session, proposal: DirectorReplayProposal): DirectorContextBindingState {
      assertBrowserAllowed(session)
      const state = currentState(session)
      if (state === null) throw new Error('cannot bind a director proposal to an unbound session')
      assertProposal(state, proposal)
      supersedePendingOperations(session)
      return appendState(session, {
        ...state,
        proposal: freshnessBinding(proposal),
        transition: 'proposal_attached',
      })
    },

    /** Rebuild state from the durable log, reread context, and invalidate a proposal on SHA drift. */
    async recover(session: Session, signal?: AbortSignal): Promise<DirectorContextRecoveryResult> {
      assertBrowserAllowed(session)
      const state = currentState(session)
      if (state === null) return { status: 'unbound', manualWorkAllowed: true }
      if (signal?.aborted) {
        return { status: 'unavailable', state, reason: 'context_unavailable', manualWorkAllowed: true }
      }
      const operation = beginOperation(session)
      const result = await readContext(port, state.binding.scope, signal)
      if (!isCurrentOperation(session, operation) || !browserAllowed(session)) {
        return { status: 'superseded', state: currentState(session), manualWorkAllowed: true }
      }
      if (signal?.aborted || !result.ok) {
        return { status: 'unavailable', state,
          reason: result.ok ? 'context_unavailable' : result.reason, manualWorkAllowed: true }
      }
      assertContext(state.binding.scope, result.context)
      if (result.context.contextSnapshotSha256 === state.binding.contextSnapshotSha256) {
        return { status: 'current', state, manualWorkAllowed: true }
      }
      const next = appendState(session, {
        version: 1,
        binding: {
          scope: state.binding.scope,
          contextSnapshotSha256: result.context.contextSnapshotSha256,
        },
        proposal: null,
        transition: 'recovery_drift',
      })
      const invalidatedProposalId = proposalId(state)
      return {
        status: 'drifted',
        state: next,
        previousContextSnapshotSha256: state.binding.contextSnapshotSha256,
        manualWorkAllowed: true,
        ...(invalidatedProposalId === undefined ? {} : { invalidatedProposalId }),
      }
    },

    /** Fold the current binding without touching Yimeng or any model capability. */
    current(session: Session): DirectorContextBindingState | null {
      return currentState(session)
    },

    /** Reuse the existing command-adapter freshness request when a proposal is still current. */
    freshnessRequest(session: Session): DirectorProposalFreshnessRequest | null {
      return currentState(session)?.proposal ?? null
    },
  }
}
