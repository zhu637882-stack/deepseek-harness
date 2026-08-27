/** JSON object retained from a Yimeng command response. */
export interface YimengCommandJsonObject {
  readonly [key: string]: unknown
}

/** Common durable ChangeSet metadata owned by Yimeng. */
export interface YimengChangeSetBase extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set.v1'
  readonly id: string
  readonly workspaceId: string | null
  readonly projectId: string
  readonly targetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly originKind: 'human'
  readonly actorUserId: string
  readonly harnessSessionId: string | null
  readonly status: string
  readonly authoritativeRevision: number | null
  readonly authoritativeSnapshotSha256: string | null
  readonly committedByUserId: string | null
  readonly committedEventId: string | null
  readonly committedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Script-specific ChangeSet coordinates retained for compatibility. */
export interface YimengScriptChangeSet extends YimengChangeSetBase {
  readonly episodeId: string
  readonly targetType: 'episode_script'
}

/** Historical exported name for a script ChangeSet. */
export type YimengChangeSet = YimengScriptChangeSet

/** Element-profile ChangeSet; elements are not episode-scoped. */
export interface YimengElementProfileChangeSet extends YimengChangeSetBase {
  readonly episodeId: null
  readonly targetType: 'element_profile'
}

/** Element kinds reserved by the generic element-profile route. */
export type YimengElementKind = 'actor' | 'scene' | 'prop'

/** Field replacement operation fixed by the authoritative element kind. */
export type YimengElementProfileOperation = 'replaceVisualIdentity' | 'replaceVisualPrompt'

/** Selection/regeneration intentions supported by the existing reference lane. */
export type YimengReferenceActionOperation = 'selectReferenceAsset' | 'requestReferenceRegeneration'

/** Every reference-bound intention supported by the existing element ChangeSet lane. */
export type YimengReferenceAssetOperation = YimengReferenceActionOperation | 'replaceReferenceRights'

/** Explicit knowledge state used by one normalized reference-rights fact. */
export type YimengReferenceRightsKnowledgeState = 'known' | 'unknown' | 'not_applicable'

/** One scalar reference-rights fact. */
export interface YimengReferenceRightsScalar {
  readonly state: YimengReferenceRightsKnowledgeState
  readonly value: string | null
}

/** One list-valued reference-rights fact. */
export interface YimengReferenceRightsList {
  readonly state: YimengReferenceRightsKnowledgeState
  readonly values: readonly string[]
}

/** Exact normalized human-owned rights record for one immutable reference binding. */
export interface YimengReferenceRightsRecord {
  readonly schema: 'jason.qingmu-reference-rights-record.v1'
  readonly sourceType: YimengReferenceRightsScalar
  readonly rightsHolder: YimengReferenceRightsScalar
  readonly authorizationScope: YimengReferenceRightsList
  readonly territory: YimengReferenceRightsList
  readonly term: {
    readonly state: YimengReferenceRightsKnowledgeState
    readonly startsAt: string | null
    readonly endsAt: string | null
    readonly perpetual: boolean | null
  }
  readonly restrictions: YimengReferenceRightsList
  readonly contains: {
    readonly realPersonLikeness: 'yes' | 'no' | 'unknown'
    readonly trademark: 'yes' | 'no' | 'unknown'
    readonly music: 'yes' | 'no' | 'unknown'
    readonly font: 'yes' | 'no' | 'unknown'
    readonly thirdPartyCharacter: 'yes' | 'no' | 'unknown'
  }
  readonly providerTerms: {
    readonly state: YimengReferenceRightsKnowledgeState
    readonly terms: string | null
    readonly reviewedAt: string | null
  }
  readonly modelLicenses: {
    readonly code: YimengReferenceRightsScalar
    readonly weights: YimengReferenceRightsScalar
    readonly outputUse: YimengReferenceRightsScalar
  }
  readonly humanDeclaration: {
    readonly state: 'provided' | 'unknown' | 'not_applicable'
    readonly text: string | null
  }
  readonly contentCredentials: YimengReferenceRightsScalar
}

/** Opaque Host-issued proof forwarded to Yimeng without browser-side signing. */
export interface YimengImagoElementMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-element-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly subjectSha256: string
  readonly signature: string
}

interface YimengProposeElementProfileRequestBase {
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly methodProjection: YimengCommandJsonObject
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoElementMethodAttestation
  readonly harnessSessionId?: string
  readonly references?: readonly YimengCommandJsonObject[]
}

/** Actor proposal that replaces the authoritative visual-identity field. */
export interface YimengProposeActorElementProfileRequest extends YimengProposeElementProfileRequestBase {
  readonly elementKind: 'actor'
  readonly operation: 'replaceVisualIdentity'
  readonly visualIdentity: string
}

/** Scene or prop proposal that replaces the authoritative visual-prompt field. */
export interface YimengProposeVisualPromptElementProfileRequest extends YimengProposeElementProfileRequestBase {
  readonly elementKind: 'scene' | 'prop'
  readonly operation: 'replaceVisualPrompt'
  readonly visualPrompt: string
}

/** Browser-safe proposal input for one authoritative element definition. */
export type YimengProposeElementProfileRequest =
  | YimengProposeActorElementProfileRequest
  | YimengProposeVisualPromptElementProfileRequest

/** Stateless IMAGO guidance bound to one exact Yimeng reference candidate. */
export interface YimengImagoReferenceAssetMethodProjection extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-reference-asset-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: {
    readonly projectId: string
    readonly elementKind: YimengElementKind
    readonly elementId: string
    readonly profileRevision: number
    readonly snapshotSha256: string
    readonly assetId: string
    readonly assetSha256: string
    readonly operation: YimengReferenceActionOperation
  }
  readonly method_definition: YimengCommandJsonObject
  readonly source_bindings: readonly YimengCommandJsonObject[]
  readonly field_hints: readonly YimengCommandJsonObject[]
  readonly checklist: readonly YimengCommandJsonObject[]
  readonly work_order_projection: YimengCommandJsonObject
  readonly review_card: YimengCommandJsonObject
  readonly legal_work_set: YimengCommandJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
  readonly selection_executed: false
}

/** Host-only HMAC proof over the exact reference guidance and target. */
export interface YimengImagoReferenceAssetMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-reference-asset-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly targetSha256: string
  readonly signature: string
}

interface YimengProposeReferenceRequestBase {
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly harnessSessionId?: string
}

/** Browser-safe selection/regeneration proposal; Host verifies and strips its proof. */
export interface YimengProposeReferenceActionRequest extends YimengProposeReferenceRequestBase {
  readonly operation: YimengReferenceActionOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
  readonly repairPrompt?: string
  readonly methodProjection: YimengImagoReferenceAssetMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoReferenceAssetMethodAttestation
}

/** Browser-safe rights replacement; the element-method proof carries no rights draft. */
export interface YimengProposeReferenceRightsRequest extends YimengProposeReferenceRequestBase {
  readonly operation: 'replaceReferenceRights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rights: YimengReferenceRightsRecord
  readonly methodProjection: YimengCommandJsonObject
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoElementMethodAttestation
}

/** Browser-safe proposal input for the existing reference ChangeSet lane. */
export type YimengProposeReferenceAssetRequest =
  | YimengProposeReferenceActionRequest
  | YimengProposeReferenceRightsRequest

/** Element-profile proposal receipt; it is not a commit. */
export interface YimengProposeElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set-proposal.v1'
  readonly changeSet: YimengElementProfileChangeSet
  readonly nextAction: 'preview'
}

/** Reference proposal uses the same durable Yimeng ChangeSet envelope. */
export type YimengProposeReferenceAssetResponse = YimengProposeElementProfileResponse

/** Exact element subject coordinates submitted to preview. */
export interface YimengElementProfileCommandSubject {
  readonly changeSetId: string
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly episodeId: null
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}

/** Existing visual-profile preview coordinates. */
export type YimengVisualPreviewElementProfileRequest = YimengElementProfileCommandSubject

/** Reference preview coordinates retain exact operation and candidate lineage in the Host. */
export interface YimengReferencePreviewElementProfileRequest extends YimengElementProfileCommandSubject {
  readonly operation: YimengReferenceActionOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
}

/** Rights preview coordinates retain the immutable asset binding. */
export interface YimengReferenceRightsPreviewElementProfileRequest extends YimengElementProfileCommandSubject {
  readonly operation: 'replaceReferenceRights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
}

/** Exact element subject submitted to generic preview. */
export type YimengPreviewElementProfileRequest =
  | YimengVisualPreviewElementProfileRequest
  | YimengReferencePreviewElementProfileRequest
  | YimengReferenceRightsPreviewElementProfileRequest

/** Exact dependency impact calculated from Yimeng authority, never from browser claims. */
export interface YimengElementImpactAnalysis extends YimengCommandJsonObject {
  readonly affectedReferenceAssetIds: readonly string[]
  readonly invalidatedApprovalAssetIds: readonly string[]
  readonly affectedDerivedAssetIds: readonly string[]
  readonly affectedReferencePackIds: readonly string[]
  readonly affectedPromptIrIds: readonly string[]
  readonly affectedStoryboardFrameIds: readonly string[]
  readonly unknowns: readonly string[]
}

/** Explicit element pre-commit comparison produced by Yimeng. */
export interface YimengVisualPreviewElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set-preview.v1'
  readonly changeSet: YimengElementProfileChangeSet
  readonly baseSubject: YimengCommandJsonObject
  readonly proposedVisualPrompt?: string
  readonly proposedVisualIdentity?: string
  readonly authoritativeCurrentSubject: YimengCommandJsonObject
  readonly changeSetId: string
  readonly payloadSha256: string
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: YimengElementProfileOperation
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly baseSnapshotSha256: string
  readonly authoritativeSnapshotSha256: string
  readonly changed: boolean
  readonly authoritativeChanged: boolean
  readonly revisionConflict: boolean
  readonly baseSnapshotConflict: boolean
  readonly canCommit: boolean
  readonly referenceInvalidationExpected: boolean
  readonly impactAnalysis: YimengElementImpactAnalysis
  readonly impactSha256: string
  readonly preflight: YimengCommandJsonObject
  readonly references: readonly YimengCommandJsonObject[]
  readonly methodProjectionSha256: string
  readonly previewSha256: string
}

/** Reference preview proves no Provider, worker, approval, or selection execution occurred. */
export interface YimengReferencePreviewElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-reference-asset-preview.v1'
  readonly changeSetId: string
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: YimengReferenceActionOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
  readonly candidateDrift: boolean
  readonly canCommit: boolean
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly humanApprovalInferred: false
}

/** Generic ChangeSet preview for a strict rights replacement. */
export interface YimengReferenceRightsPreviewElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set-preview.v1'
  readonly changeSet: YimengElementProfileChangeSet
  readonly baseSubject: YimengCommandJsonObject
  readonly authoritativeCurrentSubject: YimengCommandJsonObject
  readonly changeSetId: string
  readonly payloadSha256: string
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: 'replaceReferenceRights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly proposedReferenceRights: YimengReferenceRightsRecord
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly baseSnapshotSha256: string
  readonly authoritativeSnapshotSha256: string
  readonly changed: boolean
  readonly authoritativeChanged: boolean
  readonly revisionConflict: boolean
  readonly baseSnapshotConflict: boolean
  readonly impactConflict: boolean
  readonly canCommit: boolean
  readonly referenceInvalidationExpected: boolean
  readonly impactAnalysis: YimengElementImpactAnalysis
  readonly impactSha256: string
  readonly preflight: YimengCommandJsonObject
  readonly references: readonly YimengCommandJsonObject[]
  readonly methodProjectionSha256: string
  readonly previewSha256: string
}

/** Generic element preview may describe a visual edit or a reference intention. */
export type YimengPreviewElementProfileResponse =
  | YimengVisualPreviewElementProfileResponse
  | YimengReferencePreviewElementProfileResponse
  | YimengReferenceRightsPreviewElementProfileResponse

/** Explicit element commit input. Reusing the key makes an exact retry idempotent. */
export type YimengCommitElementProfileRequest = YimengPreviewElementProfileRequest & {
  readonly idempotencyKey: string
  readonly expectedPayloadSha256: string
}

/** Durable element-profile commit receipt. It is not human creative signoff. */
export interface YimengVisualCommitElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-element-profile-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'ElementProfileChanged' | 'ReferenceInvalidated'
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: YimengElementProfileOperation
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: boolean
  readonly referenceInvalidated: boolean
  readonly impactAnalysis: YimengElementImpactAnalysis
  readonly impactSha256: string
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Durable receipt for a reference selection or regeneration request. */
export interface YimengReferenceCommitElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-reference-asset-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'ReferenceAssetSelected' | 'ReferenceRegenerationRequested'
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: YimengReferenceActionOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: true
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly humanApprovalInferred: false
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Durable receipt for a rights replacement; the sensitive rights body is deliberately absent. */
export interface YimengReferenceRightsCommitElementProfileResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-element-profile-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'ElementProfileChanged' | 'ReferenceInvalidated'
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly operation: 'replaceReferenceRights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: boolean
  readonly referenceInvalidated: boolean
  readonly impactAnalysis: YimengElementImpactAnalysis
  readonly impactSha256: string
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Generic element commit receipt for the existing visual and reference lanes. */
export type YimengCommitElementProfileResponse =
  | YimengVisualCommitElementProfileResponse
  | YimengReferenceCommitElementProfileResponse
  | YimengReferenceRightsCommitElementProfileResponse

/** Read-only lookup input for recovering one accepted element commit receipt. */
export type YimengRecoverElementProfileCommitRequest = YimengCommitElementProfileRequest

/** Browser-safe wrapper around a recovered element commit receipt. */
export interface YimengRecoverElementProfileCommitResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengCommitElementProfileResponse
}

/** Formal HumanDecision values owned by the dedicated review lane. */
export type YimengHumanDecisionValue = 'approve' | 'reject' | 'request_changes'

interface YimengElementReviewCommandBase {
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
  readonly expectedSubjectRevision: number
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
}

/** Browser-safe comment request. Identity, role, and auth session are Host/server-only. */
export interface YimengCreateCommentRequest extends YimengElementReviewCommandBase {
  readonly body: string
}

/** Browser-safe formal decision request, independent from comments. */
export interface YimengCreateHumanDecisionRequest extends YimengElementReviewCommandBase {
  readonly decision: YimengHumanDecisionValue
  readonly reason: string
}

/** Server-authenticated comment event returned after creation. */
export interface YimengElementReviewComment {
  readonly id: string
  readonly subjectType: 'element_profile'
  readonly subjectId: string
  readonly subjectRevision: number
  readonly subjectSha256: string
  readonly body: string
  readonly actorId: string
  readonly actorRole: string
  readonly authSessionId: string
  readonly createdAt: string
}

/** Server-authenticated formal human decision returned after creation. */
export interface YimengHumanDecision {
  readonly id: string
  readonly subjectType: 'element_profile'
  readonly subjectId: string
  readonly subjectRevision: number
  readonly subjectSha256: string
  readonly decision: YimengHumanDecisionValue
  readonly reason: string
  readonly actorId: string
  readonly actorRole: string
  readonly authSessionId: string
  readonly decidedAt: string
}

/** Dedicated comment command receipt. */
export interface YimengCreateCommentResponse {
  readonly schema: 'jason.qingmu-element-comment-result.v1'
  readonly comment: YimengElementReviewComment
}

/** Dedicated HumanDecision command receipt. */
export interface YimengCreateHumanDecisionResponse {
  readonly schema: 'jason.qingmu-element-human-decision-result.v1'
  readonly decision: YimengHumanDecision
}

/** Browser-safe proposal input. Authentication remains in the Host. */
export interface YimengProposeScriptRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly script: YimengCommandJsonObject
  readonly baseRevision: number
  readonly harnessSessionId?: string
  readonly references?: readonly YimengCommandJsonObject[]
}

/** Yimeng proposal receipt; it is not a commit. */
export interface YimengProposeScriptResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set-proposal.v1'
  readonly changeSet: YimengChangeSet
  readonly nextAction: 'preview'
}

/** Request to re-evaluate a durable ChangeSet against current authority. */
export interface YimengPreviewScriptRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly changeSetId: string
  readonly baseRevision: number
}

/** Explicit pre-commit comparison produced by Yimeng. */
export interface YimengPreviewScriptResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-change-set-preview.v1'
  readonly changeSet: YimengChangeSet
  readonly baseScript: YimengCommandJsonObject
  readonly proposedScript: YimengCommandJsonObject
  readonly authoritativeCurrentScript: YimengCommandJsonObject
  readonly changeSetId: string
  readonly payloadSha256: string
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly changed: boolean
  readonly changedPaths: readonly string[]
  readonly authoritativeChangedPaths: readonly string[]
  readonly revisionConflict: boolean
  readonly baseSnapshotConflict: boolean
  readonly canCommit: boolean
  readonly invalidatedStages: readonly string[]
  readonly preflight: YimengCommandJsonObject
  readonly references: readonly YimengCommandJsonObject[]
  readonly previewSha256: string
}

/** Explicit commit input. Reusing the key makes an exact retry idempotent. */
export interface YimengCommitScriptRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly changeSetId: string
  readonly baseRevision: number
  readonly idempotencyKey: string
  readonly expectedPayloadSha256: string
}

/** Durable Yimeng commit receipt. It is not human creative signoff. */
export interface YimengCommitScriptResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-episode-script-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly projectId: string
  readonly episodeId: string
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: boolean
  readonly invalidatedStages: readonly string[]
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Read-only lookup input for recovering one previously accepted commit receipt. */
export type YimengRecoverScriptCommitRequest = YimengCommitScriptRequest

/** Browser-safe wrapper returned when Yimeng recovers the original commit receipt. */
export interface YimengRecoverScriptCommitResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengCommitScriptResponse
}

/** The only five PromptIR fields exposed by Yimeng for human editing. */
export interface YimengPromptIrEditableProjection extends YimengCommandJsonObject {
  readonly imageGenPrompt: string
  readonly lastFrameImagePrompt: string
  readonly videoGenPrompt: string
  readonly motionPrompt: string
  readonly negativePrompt: string
}

/** One to five replacements; the Host rejects empty and unknown-key objects. */
export type YimengPromptIrReplacements = Partial<YimengPromptIrEditableProjection>

/** PromptIR-specific ChangeSet coordinates retained from Yimeng authority. */
export interface YimengPromptIrChangeSet extends YimengChangeSetBase {
  readonly episodeId: string
  readonly targetType: 'prompt_ir'
}

/** Browser-safe proposal for one exact Ready PromptIR. */
export interface YimengProposePromptIrRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly basePromptIrId: string
  readonly baseVersion: number
  readonly baseContentSha256: string
  readonly replacements: YimengPromptIrReplacements
  readonly harnessSessionId?: string
  readonly references?: readonly YimengCommandJsonObject[]
}

/** Durable proposal receipt; no PromptIR has been written yet. */
export interface YimengProposePromptIrResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1'
  readonly changeSet: YimengPromptIrChangeSet
  readonly nextAction: 'preview'
}

/** Exact PromptIR subject submitted to preview and edit commit. */
export interface YimengPromptIrCommandSubject {
  readonly changeSetId: string
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'prompt_ir'
  readonly targetId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly basePromptIrId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}

export type YimengPreviewPromptIrRequest = YimengPromptIrCommandSubject

/** PromptIR identity and editable projection returned by Yimeng. */
export interface YimengPromptIrRecord extends YimengCommandJsonObject {
  readonly id: string
  readonly version: number
  readonly contentSha256: string
  readonly status: 'Draft' | 'Ready'
  readonly editableProjection: YimengPromptIrEditableProjection
}

/** Previous Ready lineage retained after a Draft edit commit. */
export interface YimengPromptIrReadyLineage extends YimengCommandJsonObject {
  readonly id: string
  readonly version: number
  readonly contentSha256: string
  readonly status: 'Ready'
}

/** Structural comparison between the current Ready projection and candidate Draft. */
export interface YimengPromptIrDiff extends YimengCommandJsonObject {
  readonly changed: boolean
  readonly changedPaths: readonly string[]
  readonly before: YimengPromptIrEditableProjection
  readonly after: YimengPromptIrEditableProjection
}

/** Provider-free Yimeng preview for one PromptIR ChangeSet. */
export interface YimengPreviewPromptIrResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-preview.v1'
  readonly changeSetId: string
  readonly target: {
    readonly projectId: string
    readonly episodeId: string
    readonly storyboardRevisionId: string
    readonly frameId: string
    readonly targetId: string
  }
  readonly basePromptIr: YimengPromptIrRecord & { readonly status: 'Ready' }
  readonly candidatePromptIr: YimengPromptIrRecord & { readonly status: 'Draft' }
  readonly promptDiff: YimengPromptIrDiff
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly humanApprovalInferred: false
  readonly humanSignoff: false
}

/** Explicit edit commit. It creates a Draft and never performs selection. */
export type YimengCommitPromptIrEditRequest = YimengPromptIrCommandSubject & {
  readonly idempotencyKey: string
  readonly expectedPayloadSha256: string
}

/** Durable edit receipt; the previous Ready remains selected. */
export interface YimengCommitPromptIrEditResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'PromptIrDraftCommitted'
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'prompt_ir'
  readonly targetId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly promptIr: YimengPromptIrRecord & { readonly status: 'Draft' }
  readonly previousReadyPromptIr: YimengPromptIrReadyLineage
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: true
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly humanApprovalInferred: false
  readonly humanSignoff: false
  readonly deduplicated: boolean
  readonly committedAt: string
}

export type YimengRecoverPromptIrEditCommitRequest = YimengCommitPromptIrEditRequest

export interface YimengRecoverPromptIrEditCommitResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengCommitPromptIrEditResponse
}

/** Separate authenticated human selection of one exact Draft PromptIR. */
export interface YimengSelectPromptIrRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly draftPromptIrId: string
  readonly draftVersion: number
  readonly draftContentSha256: string
  readonly idempotencyKey: string
}

/** Selection receipt; this is not content approval or final signoff. */
export interface YimengSelectPromptIrResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-selection-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'PromptIrSelected'
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'prompt_ir'
  readonly targetId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly selectedPromptIr: YimengPromptIrRecord & { readonly status: 'Ready' }
  readonly stalePromptIrIds: readonly string[]
  readonly idempotencyKey: string
  readonly changed: true
  readonly providerCall: false
  readonly workerStarted: false
  readonly humanApprovalInferred: false
  readonly humanSignoff: false
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Read-only lookup for an accepted selection receipt using pre-submit lineage only. */
export type YimengRecoverPromptIrSelectionRequest = YimengSelectPromptIrRequest

export interface YimengRecoverPromptIrSelectionResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengSelectPromptIrResponse
}

/** Result values exposed by the private command channel. */
export interface YimengCommandEndpointMap {
  readonly proposeScript: YimengProposeScriptResponse
  readonly previewScript: YimengPreviewScriptResponse
  readonly commitScript: YimengCommitScriptResponse
  readonly recoverScriptCommit: YimengRecoverScriptCommitResponse
  readonly proposeElementProfile: YimengProposeElementProfileResponse
  readonly proposeReferenceAsset: YimengProposeReferenceAssetResponse
  readonly previewElementProfile: YimengPreviewElementProfileResponse
  readonly commitElementProfile: YimengCommitElementProfileResponse
  readonly recoverElementProfileCommit: YimengRecoverElementProfileCommitResponse
  readonly createComment: YimengCreateCommentResponse
  readonly createHumanDecision: YimengCreateHumanDecisionResponse
  readonly proposePromptIr: YimengProposePromptIrResponse
  readonly previewPromptIr: YimengPreviewPromptIrResponse
  readonly commitPromptIrEdit: YimengCommitPromptIrEditResponse
  readonly recoverPromptIrEditCommit: YimengRecoverPromptIrEditCommitResponse
  readonly selectPromptIr: YimengSelectPromptIrResponse
  readonly recoverPromptIrSelection: YimengRecoverPromptIrSelectionResponse
}

/** Endpoint names accepted by `/qingmu-yimeng-command`. */
export type YimengCommandEndpoint = keyof YimengCommandEndpointMap
