import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Exact Yimeng coordinates and revision identities retained by one DSh session. */
export interface QingmuProjectContextBinding {
  readonly schema: 'qingmu.project-context-binding.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
  readonly revision: {
    readonly episodeRevision: number
    readonly storyboardRevisionId: string
    readonly storyboardRevisionVersion: number
    readonly sceneProfileRevision: number
  }
  readonly sha256: {
    readonly storyboardSource: string
    readonly sceneSnapshot: string
    readonly shotSnapshot: string
    readonly contextSnapshot: string
  }
}

/** Latest reconstructable context state for one DSh session. */
export type QingmuProjectContextState =
  | { readonly status: 'current'; readonly binding: QingmuProjectContextBinding; readonly staleReasons: readonly [] }
  | { readonly status: 'stale'; readonly binding: QingmuProjectContextBinding; readonly staleReasons: readonly string[] }

/** Compact receipt proving which bounded replay result was returned without retaining project prose. */
export interface QingmuDirectorProposalReceipt {
  readonly schema: 'qingmu.director-proposal-receipt.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
  readonly suggestionType: QingmuDirectorSuggestionType
  readonly bindingSha256: string
  readonly methodPackageSha256: string
  readonly proposalSha256: string
  readonly authority: QingmuZeroAuthority
}

/** Director replay modes admitted by the current IMAGO method package. */
export type QingmuDirectorSuggestionType = 'text_director_proposal' | 'visual_finding'

/** Negative authority carried by every result from this package. */
export interface QingmuZeroAuthority {
  readonly advisoryOnly: true
  readonly proposedChangeSetOnly: true
  readonly providerCalls: 0
  readonly maximumCostCny: '0'
  readonly businessWrites: 0
  readonly budgetWrites: 0
  readonly approvalWrites: 0
  readonly humanSignoff: false
  readonly autoSave: false
  readonly autoApprove: false
  readonly submitGeneration: false
}

/** One deterministic difference between the current Shot facts and replay guidance. */
export interface QingmuDirectorDifference {
  readonly field: string
  readonly before: JsonValue
  readonly proposed: JsonValue
  readonly rationale: string
}

interface QingmuDirectorProposalBase {
  readonly currentObject: {
    readonly projectId: string
    readonly episodeId: string
    readonly sceneId: string
    readonly shotId: string
  }
  readonly basis: {
    readonly contextSnapshotSha256: string
    readonly methodPackageSha256: string
    readonly methodSourceSha256: string
  }
  readonly differences: readonly QingmuDirectorDifference[]
  readonly impactScope: readonly ['bound_shot_draft_only']
  readonly authority: QingmuZeroAuthority
  readonly proposalSha256: string
}

/** Replayable, advisory-only proposal for exactly the currently bound Shot. */
export type QingmuDirectorProposal = QingmuDirectorProposalBase & (
  | { readonly schema: 'qingmu.director-proposal.v1'; readonly suggestionType: 'text_director_proposal' }
  | { readonly schema: 'qingmu.visual-review-proposal.v1'; readonly suggestionType: 'visual_finding' }
)

/** Stored context event; later events replace the fold result without mutating history. */
export interface QingmuProjectContextEvent {
  readonly version: 1
  readonly state: QingmuProjectContextState
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-value context state reconstructed by folding the latest event. */
    'qingmu/project-context': QingmuProjectContextEvent
    /** Informational proposal receipt; proposal content remains outside the session log. */
    'qingmu/director-proposal-receipt': QingmuDirectorProposalReceipt
  }
}
