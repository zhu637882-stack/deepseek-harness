/** Read-only context refresh plus session-log binding orchestration. */

import type { Session } from '@deepseek-ai/dsh-session'
import type {
  DirectorContextSnapshot,
  DirectorProposalFreshnessRequest,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { directorContextBindingStateSchema } from './projection.ts'
import type {
  DirectorContextBindingState,
  DirectorContextBridge,
  DirectorContextEntryResult,
  DirectorContextReadPort,
  DirectorContextRecoveryResult,
  DirectorObjectScope,
  DirectorProposalBinding,
} from './types.ts'

const SHA256 = /^[0-9a-f]{64}$/u
const sessionOperationEpochs = new WeakMap<Session, number>()
const browserOwners = new WeakMap<Session, { ownerId: string; scope: DirectorObjectScope }>()

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

function currentState(session: Session): DirectorContextBindingState | null {
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

/**
 * Create the future Qingmu UI mount interface around one read-only context port.
 * The port must reuse the existing normalized `director-inference/context` path;
 * this bridge never invokes a model, work-order command, Provider, or business write.
 * @param port - Read-only current-context adapter.
 * @returns Session binding, proposal attachment, and cold-recovery operations.
 */
export function createDirectorContextBridge(port: DirectorContextReadPort): DirectorContextBridge {
  const readContext = async (
    scope: DirectorObjectScope,
    signal?: AbortSignal,
  ) => {
    try {
      return await port.readDirectorContext(scope, signal)
    } catch {
      return { ok: false, reason: 'context_unavailable' } as const
    }
  }
  return {
    /** Read the current authoritative context and bind this DSh session to its exact object. */
    async enter(
      session: Session,
      scope: DirectorObjectScope,
      signal?: AbortSignal,
      ownerId?: string,
    ): Promise<DirectorContextEntryResult> {
      assertScope(scope)
      const previous = currentState(session)
      if (signal?.aborted) {
        return { status: 'unavailable', state: previous, changed: false,
          reason: 'context_unavailable', manualWorkAllowed: true }
      }
      if (ownerId !== undefined) {
        if (!/^[A-Za-z0-9_.:-]{1,256}$/u.test(ownerId)) throw new Error('invalid director binding owner')
        browserOwners.set(session, { ownerId, scope: { ...scope } })
      } else {
        const owner = browserOwners.get(session)
        if (owner !== undefined && !scopeEquals(owner.scope, scope)) browserOwners.delete(session)
      }
      const sameScope = previous !== null && scopeEquals(previous.binding.scope, scope)
      // Invalidate before I/O so native tools cannot refresh the old shot while
      // the newly selected object is loading. Null survives failed reads/replay.
      const cleared = previous !== null && !sameScope
      if (cleared) session.append('qingmu-director-context/state', null)
      const operation = beginOperation(session)
      const result = await readContext(scope, signal)
      if (!isCurrentOperation(session, operation)) {
        return { status: 'superseded', state: currentState(session), changed: false, manualWorkAllowed: true }
      }
      if (signal?.aborted || !result.ok) {
        return {
          status: 'unavailable', state: currentState(session), changed: cleared,
          reason: result.ok ? 'context_unavailable' : result.reason, manualWorkAllowed: true,
        }
      }
      assertContext(scope, result.context)
      const sameContext = sameScope
        && previous.binding.contextSnapshotSha256 === result.context.contextSnapshotSha256
      if (sameContext) {
        return { status: 'current', state: previous, changed: false, manualWorkAllowed: true }
      }
      const state = appendState(session, {
        version: 1,
        binding: { scope: { ...scope }, contextSnapshotSha256: result.context.contextSnapshotSha256 },
        proposal: null,
        transition: sameScope ? 'recovery_drift' : previous === null ? 'enter' : 'switch',
      })
      const invalidatedProposalId = proposalId(previous)
      return {
        status: 'current', state, changed: true, manualWorkAllowed: true,
        ...(invalidatedProposalId === undefined ? {} : { invalidatedProposalId }),
      }
    },

    /** Release only the matching browser lease; old-view cleanup cannot clear a new selection. */
    clear(session, scope, ownerId) {
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
      const state = currentState(session)
      if (state === null) return { status: 'unbound', manualWorkAllowed: true }
      if (signal?.aborted) {
        return { status: 'unavailable', state, reason: 'context_unavailable', manualWorkAllowed: true }
      }
      const operation = beginOperation(session)
      const result = await readContext(state.binding.scope, signal)
      if (!isCurrentOperation(session, operation)) {
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
