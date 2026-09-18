/** Public type contracts for the Qingmu director context bridge. */

import type {
  DirectorContextSnapshot,
  DirectorProposalFreshnessRequest,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { ImagoDirectorInstructionsResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengPromptIrResponse, YimengPromptIrBootstrapResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { RelayState } from './relay-state.ts'

export type { RelayState, RelayStart, RelayItem } from './relay-state.ts'
export type { RelayDriveReport } from './relay-runner.ts'

/** Full current upstream and C5 read before authoring the first prompt; no invented Ready baseline. */
export interface NativeFirstDraftInput {
  readonly schema: 'qingmu.native-first-draft-input.v1'
  readonly receiptId: string
  readonly scope: DirectorObjectScope
  readonly bindingSeq: number
  readonly context: DirectorContextSnapshot
  readonly bootstrap: YimengPromptIrBootstrapResponse
  readonly methods: readonly ImagoDirectorInstructionsResponse[]
}

/** Editable creative text only; asset selection, persistence and approval are excluded. */
export interface NativeFirstDraftProposal {
  readonly schema: 'qingmu.native-first-draft-proposal.v1'
  readonly input: {
    readonly receiptId: string
    readonly scope: DirectorObjectScope
    readonly contextSnapshotSha256: string
    readonly storyboardRevisionId: string
  }
  readonly editableProjection: YimengPromptIrResponse['subject']['editableProjection']
  readonly reason: string
}

/** Fresh native first draft or a non-actionable read outcome. */
export type NativeFirstDraftProposalResult =
  | { readonly status: 'current'; readonly proposal: NativeFirstDraftProposal }
  | { readonly status: 'none' | 'stale' | 'unavailable' }

/** Complete model-visible source for a single-field prompt suggestion; no business write authority. */
export interface NativeDraftInput {
  readonly schema: 'qingmu.native-draft-input.v1'
  readonly receiptId: string
  readonly scope: DirectorObjectScope
  readonly bindingSeq: number
  readonly context: DirectorContextSnapshot
  readonly prompt: YimengPromptIrResponse
  readonly methods: readonly ImagoDirectorInstructionsResponse[]
}

/** Advisory tool result; adopting it only edits the browser's unsaved draft. */
export interface NativeDraftProposal {
  readonly schema: 'qingmu.native-draft-proposal.v1'
  readonly input: NativeDraftSource
  readonly field: keyof YimengPromptIrResponse['subject']['editableProjection']
  readonly before: string
  readonly after: string
  readonly reason: string
}

/** Browser-safe source coordinates; context and method bodies stay in the original read result. */
export interface NativeDraftSource {
  readonly receiptId: string
  readonly scope: DirectorObjectScope
  readonly bindingSeq: number
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly draftSnapshotSha256: string | null
}

/** Freshness is checked on retrieval and again before adoption; unavailable never means current. */
export type NativeDraftProposalResult =
  | { readonly status: 'current'; readonly proposal: NativeDraftProposal }
  | { readonly status: 'none' | 'stale' | 'unavailable' }

/** Exact Yimeng object coordinates owned by one DSh director session. */
export interface DirectorObjectScope {
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
}

/** Immutable restriction carried by one native user message, never authority to select an object. */
export interface NativeDirectorPromptTarget {
  readonly schema: 'qingmu.native-director-request.v1'
  readonly sessionId: string
  readonly scope: DirectorObjectScope
  readonly contextSnapshotSha256: string
  readonly ownerId: string
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
    /** True when switching objects cleared the previous binding before a failed read. */
    readonly changed: boolean
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

/** Clearing is conditional on the active browser binding lease, not a business mutation. */
export interface DirectorContextClearResult {
  readonly status: 'cleared' | 'superseded'
  readonly state: DirectorContextBindingState | null
  readonly changed: boolean
  readonly manualWorkAllowed: true
}

/** Future UI and Host integration surface; every mutating method writes only the DSh session log. */
export interface DirectorContextBridge {
  enter(
    session: Session,
    scope: DirectorObjectScope,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<DirectorContextEntryResult>
  clear(session: Session, scope: DirectorObjectScope, ownerId: string): DirectorContextClearResult
  bindProposal(session: Session, proposal: DirectorReplayProposal): DirectorContextBindingState
  recover(session: Session, signal?: AbortSignal): Promise<DirectorContextRecoveryResult>
  current(session: Session): DirectorContextBindingState | null
  freshnessRequest(session: Session): DirectorProposalFreshnessRequest | null
}

/** Safe client-visible facade result; only scopes, SHAs and status cross the browser boundary. */
export type DirectorContextBridgeRpcResult = DirectorContextEntryResult | DirectorContextRecoveryResult | DirectorContextClearResult | {
  readonly status: 'bound'
  readonly state: DirectorContextBindingState
  readonly manualWorkAllowed: true
}

/** Native registration evidence; no model request or business operation is performed. */
export interface NativeDirectorReadiness {
  readonly status: 'mounted' | 'missing-tools' | 'inactive' | 'unavailable'
  readonly presetId: string | null
  readonly tools: readonly string[]
  readonly missingTools: readonly string[]
}

/** Browser port for one current DSh session. */
export interface NativeDialogueExecution {
  readonly scope: DirectorObjectScope
  readonly before: string
  readonly after: string
  readonly affectedShots: readonly { readonly shotId: string; readonly frameNo: number; readonly title: string | null }[]
  readonly unchangedShots: readonly { readonly shotId: string; readonly frameNo: number; readonly title: string | null }[]
  readonly status: 'prepared' | 'saving' | 'saved' | 'uncertain' | 'input_prepared'
  readonly commandReceiptId: string | null
}

/** Browser port for one current DSh session. */
export interface DirectorContextClientPort {
  /** Inspect actual session-scoped tool registrations without resuming its agent. */
  readNativeDirectorReadiness?(sessionId: string, signal?: AbortSignal): Promise<NativeDirectorReadiness>
  /** Optional when the Host has not installed native prompt tools; manual editing remains available. */
  readNativeDraftProposal?(sessionId: string, scope: DirectorObjectScope, signal?: AbortSignal): Promise<NativeDraftProposalResult>
  /** Read the latest first-draft suggestion, rechecking upstream and complete method content. */
  readNativeFirstDraftProposal?(
    sessionId: string, scope: DirectorObjectScope, signal?: AbortSignal,
  ): Promise<NativeFirstDraftProposalResult>
  enter(sessionId: string, scope: DirectorObjectScope, signal?: AbortSignal, ownerId?: string): Promise<DirectorContextEntryResult>
  clear(sessionId: string, scope: DirectorObjectScope, ownerId: string, signal?: AbortSignal): Promise<DirectorContextClearResult>
  recover(sessionId: string, signal?: AbortSignal): Promise<DirectorContextRecoveryResult>
  bindProposal(sessionId: string, proposal: DirectorReplayProposal, signal?: AbortSignal): Promise<{
    readonly status: 'bound'
    readonly state: DirectorContextBindingState
    readonly manualWorkAllowed: true
  }>
  /** Read the latest relay ledger without side effects. */
  readRelayState?(sessionId: string, signal?: AbortSignal): Promise<RelayState | null>
  /** Start a new relay batch, claiming the Host lease. */
  startRelayBatch?(sessionId: string, input: unknown, signal?: AbortSignal): Promise<{ readonly state: RelayState }>
  /** Admit one director request to a pending item. */
  admitRelayDirector?(
    sessionId: string, index: number,
    admission: { message: import('@deepseek-ai/dsh-session').UserMessage; contextSnapshotSha256: string },
    signal?: AbortSignal,
  ): Promise<{ readonly state: RelayState }>
  /** Pause a batch when no director admissions exist yet. */
  advanceRelayBatch?(sessionId: string, signal?: AbortSignal): Promise<{ readonly state: RelayState }>
  /** Complete a batch where all items have terminal evidence. */
  completeRelayBatch?(sessionId: string, signal?: AbortSignal): Promise<{ readonly state: RelayState }>
  /** Close a batch that cannot continue, abandoning non-settled items. */
  closeRelayBatch?(sessionId: string, reason: string, signal?: AbortSignal): Promise<{ readonly state: RelayState }>
  /** Cold-recover an open relay batch by re-claiming the Host lease. */
  recoverRelayBatch?(sessionId: string, signal?: AbortSignal): Promise<{
    readonly state: RelayState | null
    readonly recovered: boolean
  }>
  /** Read the current relay ledger; alias for readRelayState for cockpit compatibility. */
  readRelayBatch?(sessionId: string, signal?: AbortSignal): Promise<RelayState | null>
  /** Release a dead Host lease so recovery can re-claim it. */
  releaseRelayHostLease?(sessionId: string, batchId: string, signal?: AbortSignal): Promise<{
    readonly settling: boolean
  }>
  /** Drive the relay batch forward one step; Host-only automation entry. */
  driveRelayBatch?(sessionId: string, signal?: AbortSignal): Promise<import('./relay-runner.ts').RelayDriveReport>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Required whole-state relay ledger; readiness and reservation never imply approval or successful flush. */
    'qingmu-director-relay/state': RelayState
    /** Complete auxiliary model input, including durable image references. */
    'qingmu-director-vision/request': { readonly callId: string; readonly inspectionId: string; readonly assetSha256: string; readonly request: JsonValue }
    /** Visual observations and measured usage, never creative or adoption approval. */
    'qingmu-director-vision/result': { readonly callId: string; readonly inspectionId: string; readonly status: 'completed' | 'failed'; readonly report: string | null; readonly usage: import('@deepseek-ai/dsh-llm').TokenUsage | null; readonly completionId: string | null; readonly error: string | null }
    /** Whole-value, log-only binding; null clears an obsolete object before switch I/O. */
    'qingmu-director-context/state': DirectorContextBindingState | null
    /** A UI view of a native tool operation, never a second business ledger. */
    'qingmu-director-dialogue/state': NativeDialogueExecution
    /** Full host input retained outside model context; usable only with its matching successful tool result. */
    'qingmu-director-dialogue/receipt': {
      readonly callId: string
      readonly toolName: string
      readonly value: JsonValue
      readonly visibleSha256: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'qingmuDirectorRelay': RelayState | null
    'qingmuDirectorContext': DirectorContextBindingState | null
    'qingmuDialogueExecution': NativeDialogueExecution | null
  }

  interface SessionProjectionMap {
    /** Latest validated relay ledger; null means no batch has been recorded. */
    'qingmuDirectorRelay': RelayState | null
    /** Future Qingmu UI mount point; absent package capability is distinct from an unbound null value. */
    'qingmuDirectorContext': DirectorContextBindingProjection
    'qingmuDialogueExecution': NativeDialogueExecution | null
  }
}
