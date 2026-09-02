/** Public type contracts for the Qingmu director context bridge. */

import type {
  DirectorContextSnapshot,
  DirectorProposalFreshnessRequest,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { Session } from '@deepseek-ai/dsh-session'

/** Exact Yimeng object coordinates owned by one DSh director session. */
export interface DirectorObjectScope {
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
}

/** Context identity held in the DSh session log; Yimeng remains business truth. */
export interface DirectorContextBinding {
  readonly scope: DirectorObjectScope
  readonly contextSnapshotSha256: string
}

/** The existing command-adapter freshness coordinates for one advisory proposal. */
export type DirectorProposalBinding = DirectorProposalFreshnessRequest

/** Why the latest complete binding snapshot entered the session log. */
export type DirectorContextTransition = 'enter' | 'switch' | 'recovery_drift' | 'proposal_attached'

/** Complete post-transition state; the newest event wins during replay. */
export interface DirectorContextBindingState {
  readonly version: 1
  readonly binding: DirectorContextBinding
  readonly proposal: DirectorProposalBinding | null
  readonly transition: DirectorContextTransition
}

/** UI-safe projection of the latest session-owned director binding. */
export type DirectorContextBindingProjection = DirectorContextBindingState | null

/** Read-only port backed by the existing normalized `director-inference/context` adapter path. */
export interface DirectorContextReadPort {
  readDirectorContext(
    scope: DirectorObjectScope,
    signal?: AbortSignal,
  ): Promise<DirectorContextReadResult>
}

/** A failed read never disables the ordinary manual editing path. */
export type DirectorContextReadResult =
  | { readonly ok: true; readonly context: DirectorContextSnapshot }
  | { readonly ok: false; readonly reason: 'context_unavailable' | 'model_unavailable' }

/** Result of entering or switching to one exact object. */
export type DirectorContextEntryResult =
  | {
    readonly status: 'current'
    readonly state: DirectorContextBindingState
    readonly changed: boolean
    readonly invalidatedProposalId?: string
    readonly manualWorkAllowed: true
  }
  | {
    readonly status: 'unavailable'
    readonly state: DirectorContextBindingState | null
    readonly changed: false
    readonly reason: 'context_unavailable' | 'model_unavailable'
    readonly manualWorkAllowed: true
  }
  | {
    readonly status: 'superseded'
    readonly state: DirectorContextBindingState | null
    readonly changed: false
    readonly manualWorkAllowed: true
  }

/** Recovery outcome after replaying the session log and rereading current context. */
export type DirectorContextRecoveryResult =
  | { readonly status: 'unbound'; readonly manualWorkAllowed: true }
  | {
    readonly status: 'current'
    readonly state: DirectorContextBindingState
    readonly manualWorkAllowed: true
  }

  | {
    readonly status: 'drifted'
    readonly state: DirectorContextBindingState
    readonly previousContextSnapshotSha256: string
    readonly invalidatedProposalId?: string
    readonly manualWorkAllowed: true
  }

  | {
    readonly status: 'unavailable'
    readonly state: DirectorContextBindingState
    readonly reason: 'context_unavailable' | 'model_unavailable'
    readonly manualWorkAllowed: true
  }
  | {
    readonly status: 'superseded'
    readonly state: DirectorContextBindingState | null
    readonly manualWorkAllowed: true
  }

/** Future UI and Host integration surface; every mutating method writes only the DSh session log. */
export interface DirectorContextBridge {
  enter(
    session: Session,
    scope: DirectorObjectScope,
    signal?: AbortSignal,
  ): Promise<DirectorContextEntryResult>
  bindProposal(session: Session, proposal: DirectorReplayProposal): DirectorContextBindingState
  recover(session: Session, signal?: AbortSignal): Promise<DirectorContextRecoveryResult>
  current(session: Session): DirectorContextBindingState | null
  freshnessRequest(session: Session): DirectorProposalFreshnessRequest | null
}

/** Safe client-visible facade result; only scopes, SHAs and status cross the browser boundary. */
export type DirectorContextBridgeRpcResult = DirectorContextEntryResult | DirectorContextRecoveryResult | {
  readonly status: 'bound'
  readonly state: DirectorContextBindingState
  readonly manualWorkAllowed: true
}

/** Browser port for one current DSh session. */
export interface DirectorContextClientPort {
  enter(sessionId: string, scope: DirectorObjectScope, signal?: AbortSignal): Promise<DirectorContextEntryResult>
  recover(sessionId: string, signal?: AbortSignal): Promise<DirectorContextRecoveryResult>
  bindProposal(sessionId: string, proposal: DirectorReplayProposal, signal?: AbortSignal): Promise<{
    readonly status: 'bound'
    readonly state: DirectorContextBindingState
    readonly manualWorkAllowed: true
  }>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-value, log-only snapshot of the session's current Qingmu director binding. */
    'qingmu-director-context/state': DirectorContextBindingState
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'qingmuDirectorContext': DirectorContextBindingState | null
  }

  interface SessionProjectionMap {
    /** Future Qingmu UI mount point; absent package capability is distinct from an unbound null value. */
    'qingmuDirectorContext': DirectorContextBindingProjection
  }
}
