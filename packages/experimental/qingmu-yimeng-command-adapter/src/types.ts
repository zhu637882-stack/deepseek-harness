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

/** The only rights fields that an exact exception release may cover. */
export type YimengReferenceRightsExceptionField =
  | 'sourceType'
  | 'rightsHolder'
  | 'authorizationScope'
  | 'territory'
  | 'term'
  | 'restrictions'
  | 'contains'
  | 'providerTerms'
  | 'modelLicenses'
  | 'humanDeclaration'
  | 'contentCredentials'

/** Immutable, non-wildcard rights scope submitted by the browser. */
export interface YimengReferenceRightsExceptionScope {
  readonly kind: 'reference_rights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rightsRecordSha256: string
  readonly rightsFields: readonly YimengReferenceRightsExceptionField[]
}

/** Browser-safe command input. Authentication and all identities remain Host/server-only. */
export interface YimengCreateReferenceRightsExceptionReleaseRequest {
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
  readonly expectedSubjectRevision: number
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
  readonly reason: string
  readonly scope: YimengReferenceRightsExceptionScope
}

/** Immutable exception fact returned by POST and persisted in the original receipt. */
export interface YimengReferenceRightsExceptionReleaseFact {
  readonly id: string
  readonly decision: 'exception_release'
  readonly subjectType: 'element_profile'
  readonly subjectId: string
  readonly subjectRevision: number
  readonly subjectSha256: string
  readonly scope: YimengReferenceRightsExceptionScope
  readonly actorId: string
  readonly actorRole: 'approver'
  readonly actorNaturalPersonId: string
  readonly producerActorId: string
  readonly producerNaturalPersonId: string
  readonly assetProducerActorId: string
  readonly assetProducerNaturalPersonId: string
  readonly assetProducerTaskId: string
  readonly assetProducerTaskRequestSha256: string
  readonly authSessionId: string
  readonly reason: string
  readonly releasedAt: string
}

/** Dedicated release receipt. It is not a ChangeSet v4 or ordinary HumanDecision. */
export interface YimengCreateReferenceRightsExceptionReleaseResponse {
  readonly schema: 'jason.qingmu-reference-rights-exception-release-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly payloadSha256: string
  readonly release: YimengReferenceRightsExceptionReleaseFact
  readonly changed: false
  readonly providerCalls: 0
  readonly selectionAuthority: 'not_granted'
  readonly humanApprovalInferred: false
}

/**
 * Read-only receipt lookup uses only the marker's non-sensitive bindings.
 * The reason and scope bodies are recovered from the immutable receipt and
 * checked against their canonical SHA-256 values; they are never persisted locally.
 */
export interface YimengRecoverReferenceRightsExceptionReleaseRequest {
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
  readonly expectedSubjectRevision: number
  readonly expectedSubjectSha256: string
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rightsRecordSha256: string
  readonly reasonSha256: string
  readonly scopeSha256: string
  readonly idempotencyKey: string
}

/** Exact original POST receipt returned without replaying its command. */
export interface YimengRecoverReferenceRightsExceptionReleaseResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengCreateReferenceRightsExceptionReleaseResponse
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

/** Storyboard-frame ChangeSet coordinates; the canonical Shot ID is always the frame ID. */
export interface YimengStoryboardFrameChangeSet extends YimengChangeSetBase {
  readonly episodeId: string
  readonly targetType: 'storyboard_frame'
}

/** Host-attested IMAGO method projection accepted by the Storyboard Canvas proposal lane. */
export interface YimengImagoHeroFrameStoryboardMethodProjection extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: {
    readonly projectId: string
    readonly episodeId: string
    readonly episodeRevision: number
    readonly storyboardRevisionId: string
    readonly storyboardRevisionVersion: number
    readonly storyboardSourceSha256: string
    readonly relationSnapshotSha256: string
    readonly selectedShotId: string
    readonly selectedShotSnapshotSha256: string
  }
  readonly canvas_projection: {
    readonly canonicalShotIdSource: 'yimeng_storyboard_frame_id'
    readonly shotId: string
    readonly selectedShot: YimengCommandJsonObject
    readonly heroFrame: {
      readonly assetId: string
      readonly mediaSha256: string
      readonly bindingSha256: string
    }
    readonly baseCanvasSha256: string | null
    readonly rawAnnotations: readonly YimengCommandJsonObject[]
    readonly rawAnnotationsSha256: string
    readonly compiledResult: YimengCommandJsonObject
    readonly compiledResultSha256: string
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
  readonly selection_executed: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
}

/** HMAC proof created by the Host method adapter; the browser never receives the signing key. */
export interface YimengImagoHeroFrameStoryboardMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-hero-frame-storyboard-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly targetSha256: string
  readonly relationSnapshotSha256: string
  readonly selectedShotSha256: string
  readonly heroFrameBindingSha256: string
  readonly rawAnnotationsSha256: string
  readonly compiledResultSha256: string
  readonly signature: string
}

/** Browser-safe proposal for replacing only one current Storyboard Canvas. */
export interface YimengProposeStoryboardCanvasRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly operation: 'replaceStoryboardCanvas'
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly heroFrameAssetId: string
  readonly heroFrameMediaSha256: string
  readonly heroFrameBindingSha256: string
  readonly methodProjection: YimengImagoHeroFrameStoryboardMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoHeroFrameStoryboardMethodAttestation
  readonly harnessSessionId?: string
}

/** One immutable Storyboard revision coordinate returned by Yimeng. */
export interface YimengStoryboardRevisionCoordinate extends YimengCommandJsonObject {
  readonly revisionId: string
  readonly revisionVersion: number
  readonly sourceSha256: string
}

/** The selected Hero Frame binding owned by Yimeng. */
export interface YimengHeroFrameBinding extends YimengCommandJsonObject {
  readonly assetId: string
  readonly mediaSha256: string
  readonly bindingSha256: string
}

/** Raw human canvas plus the deterministic IMAGO compilation persisted by Yimeng. */
export interface YimengStoryboardCanvas extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-storyboard-canvas.v1'
  readonly heroFrameBindingSha256: string
  readonly annotations: readonly YimengCommandJsonObject[]
  readonly rawAnnotationsSha256: string
  readonly compiled: {
    readonly subjectLayout: readonly YimengCommandJsonObject[]
    readonly objectAnchors: readonly YimengCommandJsonObject[]
    readonly actionTrajectory: readonly YimengCommandJsonObject[]
  }
  readonly compiledSha256: string
}

/** Durable Yimeng proposal; it is only a draft and never creative approval. */
export interface YimengProposeStoryboardCanvasResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-storyboard-canvas-change-set-proposal.v1'
  readonly changeSet: YimengStoryboardFrameChangeSet
  readonly nextAction: 'preview'
}

/** Shared subject and CAS lineage for Storyboard Canvas preview and commit. */
export interface YimengStoryboardCanvasCommandSubject {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly targetType: 'storyboard_frame'
  readonly targetId: string
  readonly changeSetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}

/** Read-only technical preview. Passing preflight is not human approval. */
export type YimengPreviewStoryboardCanvasRequest = YimengStoryboardCanvasCommandSubject

export interface YimengPreviewStoryboardCanvasResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-storyboard-canvas-preview.v1'
  readonly changeSetId: string
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'storyboard_frame'
  readonly targetId: string
  readonly operation: 'replaceStoryboardCanvas'
  readonly storyboardRevision: YimengStoryboardRevisionCoordinate
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly heroFrame: YimengHeroFrameBinding
  readonly methodHeroFrameBindingSha256: string
  readonly before: YimengStoryboardCanvas | null
  readonly after: YimengStoryboardCanvas
  readonly changedPaths: readonly string[]
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly selectionExecuted: false
  readonly humanApprovalInferred: false
  readonly humanSignoff: false
}

/** Exact retry coordinates for the single transactional Canvas replacement. */
export interface YimengCommitStoryboardCanvasRequest extends YimengStoryboardCanvasCommandSubject {
  readonly idempotencyKey: string
  readonly expectedPayloadSha256: string
}

/** Durable commit receipt. It records a technical write, never content signoff. */
export interface YimengCommitStoryboardCanvasResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-storyboard-canvas-commit-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'StoryboardCanvasReplaced'
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'storyboard_frame'
  readonly targetId: string
  readonly operation: 'replaceStoryboardCanvas'
  readonly storyboardRevision: {
    readonly base: YimengStoryboardRevisionCoordinate
    readonly authoritative: YimengStoryboardRevisionCoordinate
  }
  readonly baseRevision: number
  readonly authoritativeRevision: number
  readonly authoritativeSnapshotSha256: string
  readonly heroFrame: YimengHeroFrameBinding
  readonly methodHeroFrameBindingSha256: string
  readonly rawAnnotationsSha256: string
  readonly methodRawAnnotationsSha256: string
  readonly compiledSha256: string
  readonly payloadSha256: string
  readonly idempotencyKey: string
  readonly changed: true
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly selectionExecuted: false
  readonly humanApprovalInferred: false
  readonly humanSignoff: false
  readonly deduplicated: boolean
  readonly committedAt: string
}

/** Read-only lookup for a previously accepted Canvas replacement receipt. */
export type YimengRecoverStoryboardCanvasCommitRequest = YimengCommitStoryboardCanvasRequest

export interface YimengRecoverStoryboardCanvasCommitResponse extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-command-receipt-recovery.v1'
  readonly recovered: true
  readonly receiptSha256: string
  readonly receipt: YimengCommitStoryboardCanvasResponse
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

/** Exact Yimeng-selected video bytes and canonical Shot revision. */
export interface YimengShotVideoSubject {
  readonly schema: 'jason.qingmu-shot-video-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly assetId: string
  readonly assetVersion: number
  readonly assetSha256: string
}

/** Reviewer-authored problem details, retained without defaults or text rewriting. */
export interface YimengShotFindingPayload {
  readonly timecode: string
  readonly observation: string
  readonly evidenceRefs: readonly string[]
  readonly earliestOwner: string
  readonly ownerReason: string
  readonly severity: 'BLOCKER' | 'MAJOR' | 'MINOR'
  readonly suggestion: string
  readonly reworkScope: string
}

/** Stateless IMAGO method output; owner options grant no approval or rework execution. */
export interface YimengImagoShotFindingMethodProjection {
  readonly schema: 'qingmu.imago-shot-finding-method.v1'
  readonly subject: YimengShotVideoSubject
  readonly subjectSnapshotSha256: string
  readonly definition: {
    readonly requiredFields: readonly string[]
    readonly severities: readonly ['BLOCKER', 'MAJOR', 'MINOR']
    readonly ownerOptions: readonly {
      readonly stageId: string
      readonly roleId: string
      readonly scope: 'global' | 'per_lsu'
    }[]
    readonly statusOnRecord: 'OPEN'
    readonly approvalAuthority: 'not_granted'
    readonly reworkExecutionAllowed: false
  }
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host HMAC proof binds one exact method projection and selected-video subject. */
export interface YimengImagoShotFindingMethodAttestation {
  readonly schema: 'qingmu.imago-shot-finding-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Read-only lookup coordinates retained before a record request is sent. */
export interface YimengRecoverShotFindingRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
}

/** Explicit problem recording; actor and authenticated session are server-owned. */
export interface YimengRecordShotFindingRequest extends YimengRecoverShotFindingRequest {
  readonly finding: YimengShotFindingPayload
  readonly methodProjection: YimengImagoShotFindingMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoShotFindingMethodAttestation
}

/** Immutable Finding fact; OPEN is not approval or an executable rework instruction. */
export interface YimengShotFinding extends YimengShotFindingPayload {
  readonly id: string
  readonly eventId: string
  readonly subject: YimengShotVideoSubject
  readonly subjectSnapshotSha256: string
  readonly status: 'OPEN'
  readonly actorId: string
  readonly actorRole: 'reviewer'
  readonly authSessionId: string
  readonly createdAt: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
}

/** Finding ledger receipt; selected assets and media state remain unchanged. */
export interface YimengShotFindingResult {
  readonly schema: 'jason.qingmu-shot-finding-result.v1'
  readonly finding: YimengShotFinding
  readonly changed: false
  readonly providerCalls: 0
  readonly selectionChanged: false
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Historical lookup does not require today's subject, session, or HMAC key to match. */
export interface YimengShotFindingRecovery extends YimengRecoverShotFindingRequest {
  readonly schema: 'jason.qingmu-shot-finding-recovery.v1'
  readonly status: 'committed' | 'not_found'
  readonly result: YimengShotFindingResult | null
}

/** Native shot-group contents; group order never allocates an IMAGO unit ID. */
export interface YimengProductionUnitSource {
  readonly schema: 'jason.qingmu-production-unit-source.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly groupId: string
  readonly groupNo: number
  readonly title: string
  readonly groupExecutionPromptSha256: string
  readonly storyboardRevision: number
  readonly shots: readonly {
    readonly frameId: string
    readonly frameNo: number
    readonly frameContentSha256: string
  }[]
}

/** Signed method definition, not a sealed plan, stage instance, or approval. */
export interface YimengProductionUnitDefinition {
  readonly id: 'IMAGO-V6-LSU'
  readonly version: string
  readonly unitIdPattern: 'LSU[0-9]{2,}'
  readonly scope: 'per_lsu'
  readonly stages: readonly { readonly stageId: string; readonly roleId: string; readonly contractSha256: string }[]
  readonly operation: 'bind_existing_shot_group'
  readonly planSealingAllowed: false
  readonly stageApprovalAllowed: false
  readonly providerCalls: 0
}

/** Stateless method and exact source submitted to the Yimeng transaction. */
export interface YimengImagoProductionUnitMethodProjection {
  readonly schema: 'qingmu.imago-production-unit-method.v1'
  readonly subject: YimengProductionUnitSource
  readonly subjectSnapshotSha256: string
  readonly definition: YimengProductionUnitDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host provenance proof; it grants neither content approval nor Provider authority. */
export interface YimengImagoProductionUnitMethodAttestation {
  readonly schema: 'qingmu.imago-production-unit-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Original command coordinates retained for a GET-only historical receipt lookup. */
export interface YimengRecoverProductionUnitBindingRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly groupId: string
  readonly unitId: string
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
}

/** Explicit scope registration with separate source and previous-binding preconditions. */
export interface YimengBindProductionUnitRequest extends YimengRecoverProductionUnitBindingRequest {
  readonly expectedBindingRevision: number
  readonly expectedBindingSha256: string | null
  readonly methodProjection: YimengImagoProductionUnitMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoProductionUnitMethodAttestation
}

/** Immutable Yimeng scope record; currency is obtained separately from its read feed. */
export interface YimengProductionUnitBinding {
  readonly unitId: string
  readonly groupId: string
  readonly projectId: string
  readonly episodeId: string
  readonly revision: number
  readonly source: YimengProductionUnitSource
  readonly sourceSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly definition: YimengProductionUnitDefinition
  readonly actorId: string
  readonly authSessionId: string
  readonly eventId: string
  readonly changeSetId: string
  readonly createdAt: string
}

/** Scope-binding receipt without any production, approval, or rework side effects. */
export interface YimengProductionUnitResult {
  readonly schema: 'jason.qingmu-production-unit-result.v1'
  readonly binding: YimengProductionUnitBinding
  readonly bindingSha256: string
  readonly planSealed: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Historical receipt; a missing receipt never authorizes automatic resubmission. */
export interface YimengProductionUnitRecovery extends YimengRecoverProductionUnitBindingRequest {
  readonly schema: 'jason.qingmu-production-unit-recovery.v1'
  readonly found: boolean
  readonly result: YimengProductionUnitResult | null
}

/** Exact full-script source descriptor; it is not a completed screenplay package. */
export interface YimengStageSource {
  readonly schema: 'jason.qingmu-stage-source.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly sourceType: 'episode_script'
  readonly sourceId: string
  readonly revision: number
  readonly contentSha256: string
}

/** A1S source-reference method sealed in the historical binding. */
export interface YimengStageSourceDefinition {
  readonly id: 'IMAGO-V6-A1S-SOURCE'
  readonly version: string
  readonly stageId: 'A1S'
  readonly roleId: 'A1S'
  readonly scope: 'global'
  readonly contractSha256: string
  readonly artifactKind: 'SCREENPLAY_PACKAGE'
  readonly canonicalOutput: 'inputs/screenplay-package.json'
  readonly sourceType: 'episode_script'
  readonly sourceUsage: 'source_reference_only'
  readonly operation: 'bind_existing_episode_script_source'
  readonly stageArtifactCreationAllowed: false
  readonly stageApprovalAllowed: false
  readonly providerCalls: 0
}

/** Exact Host-signed method returned unchanged by the browser command. */
export interface YimengImagoStageSourceMethodProjection {
  readonly schema: 'qingmu.imago-stage-source-method.v1'
  readonly subject: YimengStageSource
  readonly subjectSnapshotSha256: string
  readonly definition: YimengStageSourceDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Method signature binds source and method digests, never approval. */
export interface YimengImagoStageSourceMethodAttestation {
  readonly schema: 'qingmu.imago-stage-source-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Original coordinates for GET-only receipt recovery, independent of current source or key. */
export interface YimengRecoverStageSourceBindingRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: 'A1S'
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
}

/** Explicit source registration with separate source and binding CAS. */
export interface YimengBindStageSourceRequest extends YimengRecoverStageSourceBindingRequest {
  readonly expectedBindingRevision: number
  readonly expectedBindingSha256: string | null
  readonly methodProjection: YimengImagoStageSourceMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoStageSourceMethodAttestation
}

/** Immutable source-reference record; all approval and execution flags remain false. */
export interface YimengStageSourceBinding {
  readonly schema: 'jason.qingmu-stage-source-binding.v1'
  readonly changeSetId: string
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: 'A1S'
  readonly source: YimengStageSource
  readonly subjectSnapshotSha256: string
  readonly definition: YimengStageSourceDefinition
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly bindingRevision: number
  readonly actorId: string
  readonly authSessionId: string
  readonly createdAt: string
  readonly stageArtifactCreated: false
  readonly stageApprovalGranted: false
  readonly lockActivated: false
  readonly planSealed: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Exact original receipt; creation versus replay is expressed by HTTP status upstream. */
export interface YimengStageSourceResult {
  readonly schema: 'jason.qingmu-stage-source-result.v1'
  readonly binding: YimengStageSourceBinding
  readonly bindingSha256: string
  readonly receiptId: string
  readonly outboxEventId: string
}

/** Successful original GET receipt; unknown coordinates remain an upstream 404. */
export interface YimengStageSourceRecovery {
  readonly schema: 'jason.qingmu-stage-source-recovery.v1'
  readonly receipt: YimengStageSourceResult
}

/** Exact V6 Stage artifact retained in the Yimeng immutable record. */
export interface YimengStageArtifact extends YimengCommandJsonObject {
  readonly schema_version: '6.0.0-draft.1'
  readonly workflow_version: '6.0.0-draft.2'
  readonly stage_id: string
  readonly scope_instance: string
  readonly artifact_revision: string
  readonly created_at: string
  readonly producer: YimengCommandJsonObject
  readonly source_bindings: readonly unknown[]
  readonly lock_bindings: readonly unknown[]
  readonly content: unknown
  readonly open_issues: readonly unknown[]
}

/** Canonical artifact identity signed by the Host and stored by Yimeng. */
export interface YimengStageArtifactSubject extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-imago-stage-artifact.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifactRevision: string
  readonly artifactSha256: string
}

/** Current Core Stage registration contract with no approval or execution grant. */
export interface YimengStageArtifactDefinition extends YimengCommandJsonObject {
  readonly id: 'IMAGO-V6-STAGE-ARTIFACT'
  readonly version: string
  readonly stageId: string
  readonly roleId: string
  readonly scope: 'global' | 'per_lsu'
  readonly contractSha256: string
  readonly artifactKind: string
  readonly canonicalOutput: string
  readonly requiredSourceStageIds: readonly string[]
  readonly requiredLockIds: readonly string[]
  readonly producesLockId: string | null
  readonly operation: 'register_machine_validated_stage_artifact'
  readonly stageArtifactRegistrationAllowed: true
  readonly dependencyAuthorityRequiredForApproval: true
  readonly dependencyAuthorityVerified: false
  readonly stageApprovalAllowed: false
  readonly lockActivationAllowed: false
  readonly lsuPlanSealingAllowed: false
  readonly reworkExecutionAllowed: false
  readonly providerCalls: 0
}

/** Deterministic Core validation facts for the exact artifact and Stage contract. */
export interface YimengStageArtifactMachineValidation extends YimengCommandJsonObject {
  readonly status: 'PASS'
  readonly validator: 'scripts/validate_v6_stage_contracts.py'
  readonly validatedArtifactSha256: string
  readonly contractSha256: string
}

/** Host-validated current Core projection forwarded unchanged to Yimeng. */
export interface YimengImagoStageArtifactMethodProjection extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-stage-artifact-method.v1'
  readonly subject: YimengStageArtifactSubject
  readonly subjectSnapshotSha256: string
  readonly machineValidation: YimengStageArtifactMachineValidation
  readonly definition: YimengStageArtifactDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host method-origin proof; it does not authenticate dependencies or approve the Stage. */
export interface YimengImagoStageArtifactMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-stage-artifact-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Original immutable coordinates used by GET-only command-receipt recovery. */
export interface YimengRecoverStageArtifactRegistrationRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
}

/** One explicit artifact registration with separate record CAS preconditions. */
export interface YimengRegisterStageArtifactRequest extends YimengRecoverStageArtifactRegistrationRequest {
  readonly artifact: YimengStageArtifact
  readonly expectedArtifactRecordRevision: number
  readonly expectedArtifactRecordSha256: string | null
  readonly methodProjection: YimengImagoStageArtifactMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoStageArtifactMethodAttestation
}

/** Immutable business record; registration never makes the artifact available or approved. */
export interface YimengStageArtifactRecord extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-stage-artifact-record.v1'
  readonly changeSetId: string
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifact: YimengStageArtifact
  readonly artifactRevision: string
  readonly artifactSha256: string
  readonly subjectSnapshotSha256: string
  readonly definition: YimengStageArtifactDefinition
  readonly machineValidation: YimengStageArtifactMachineValidation
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly artifactRecordRevision: number
  readonly producerActorId: string
  readonly producerNaturalPersonId: string
  readonly authSessionId: string
  readonly createdAt: string
  readonly stageArtifactRegistered: true
  readonly stageArtifactAvailable: false
  readonly dependencyAuthorityVerified: false
  readonly stageApprovalGranted: false
  readonly lockActivated: false
  readonly planSealed: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Exact durable registration receipt. */
export interface YimengStageArtifactResult {
  readonly schema: 'jason.qingmu-stage-artifact-result.v1'
  readonly artifactRecord: YimengStageArtifactRecord
  readonly artifactRecordSha256: string
  readonly receiptId: string
  readonly outboxEventId: string
}

/** Original receipt recovered without requiring today's artifact, key, or session. */
export interface YimengStageArtifactRecovery {
  readonly schema: 'jason.qingmu-stage-artifact-recovery.v1'
  readonly receipt: YimengStageArtifactResult
}

/** Human decision values accepted by the Yimeng Stage authority. */
export type YimengStageArtifactDecisionValue = 'approve' | 'reject' | 'request_changes'

/** Original exact record coordinates used by decision receipt recovery. */
export interface YimengRecoverStageArtifactDecisionRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly expectedArtifactRecordRevision: number
  readonly expectedArtifactRecordSha256: string
  readonly idempotencyKey: string
}

/** Explicit natural-person decision intent; Host derives the current Method while actor and session remain server-derived. */
export interface YimengCommitStageArtifactDecisionRequest extends YimengRecoverStageArtifactDecisionRequest {
  readonly artifact: YimengStageArtifact
  readonly expectedArtifactRevision: string
  readonly expectedArtifactSha256: string
  readonly expectedSubjectSha256: string
  readonly decision: YimengStageArtifactDecisionValue
  readonly reason: string
}

/** Host-to-Yimeng decision command after the current Core Method is recomputed inside the trusted Host. */
export interface YimengForwardedStageArtifactDecisionRequest extends Omit<
  YimengCommitStageArtifactDecisionRequest,
  'artifact'
> {
  readonly methodProjection: YimengImagoStageArtifactMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoStageArtifactMethodAttestation
}

/** Exact Stage record and artifact intent used for a fresh read-only authority projection. */
export interface YimengProbeStageArtifactAuthorityRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifact: YimengStageArtifact
  readonly expectedArtifactRecordRevision: number
  readonly expectedArtifactRecordSha256: string
  readonly expectedArtifactRevision: string
  readonly expectedArtifactSha256: string
  readonly expectedSubjectSha256: string
}

/** Host-to-Yimeng probe after the current Core Method is recomputed inside the trusted Host. */
export interface YimengForwardedStageArtifactAuthorityProbeRequest extends Omit<
  YimengProbeStageArtifactAuthorityRequest,
  'artifact'
> {
  readonly methodProjection: YimengImagoStageArtifactMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoStageArtifactMethodAttestation
}

/** One current approved upstream artifact in Yimeng's dependency authority snapshot. */
export interface YimengStageDependencyAuthoritySource extends YimengCommandJsonObject {
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifactRevision: string
  readonly artifactSha256: string
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly decisionId: string
  readonly approvalEventSha256: string
}

/** One current lock-producing approval event in Yimeng's dependency authority snapshot. */
export interface YimengStageDependencyAuthorityLock extends YimengCommandJsonObject {
  readonly lockId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly decisionId: string
  readonly eventSha256: string
}

/** Recomputed dependency and lock authority for one exact Stage artifact record. */
export interface YimengStageDependencyAuthority extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-stage-dependency-authority.v1'
  readonly targetId: string
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly sources: readonly YimengStageDependencyAuthoritySource[]
  readonly locks: readonly YimengStageDependencyAuthorityLock[]
  readonly blockers: readonly string[]
  readonly verified: boolean
}

/** Exact independent decision retained in the existing Yimeng three-ledger journal. */
export interface YimengStageArtifactDecision extends YimengCommandJsonObject {
  readonly id: string
  readonly decisionOrdinal: number
  readonly subjectType: 'stage_artifact_record'
  readonly subjectId: string
  readonly subjectArtifactRecordRevision: number
  readonly subjectArtifactRecordSha256: string
  readonly artifactRevision: string
  readonly artifactSha256: string
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly decision: YimengStageArtifactDecisionValue
  readonly reason: string
  readonly actorId: string
  readonly actorRole: 'approver'
  readonly actorNaturalPersonId: string
  readonly producerActorId: string
  readonly producerNaturalPersonId: string
  readonly authSessionId: string
  readonly dependencyAuthority: YimengStageDependencyAuthority
  readonly stageArtifactAvailable: boolean
  readonly dependencyAuthorityVerified: boolean
  readonly stageApprovalGranted: boolean
  readonly lockActivated: boolean
  readonly planSealed: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
  readonly decidedAt: string
}

/** Lock lineage emitted only by a current approved exact record that declares the lock. */
export interface YimengStageArtifactProducedLock extends YimengCommandJsonObject {
  readonly lockId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly eventSha256: string
}

/** Durable result of one explicit Stage artifact decision. */
export interface YimengStageArtifactDecisionResult {
  readonly schema: 'jason.qingmu-stage-artifact-decision-result.v1'
  readonly decision: YimengStageArtifactDecision
  readonly decisionEventSha256: string
  readonly producedLock: YimengStageArtifactProducedLock | null
  readonly receiptId: string
  readonly outboxEventId: string
}

/** Original decision receipt recovered without replaying the write. */
export interface YimengStageArtifactDecisionRecovery {
  readonly schema: 'jason.qingmu-stage-artifact-decision-recovery.v1'
  readonly receipt: YimengStageArtifactDecisionResult
}

/** Fail-closed read projection under one fresh signed Core rules generation. */
export interface YimengStageArtifactAuthorityProbe {
  readonly schema: 'jason.qingmu-stage-artifact-authority-probe.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly stageId: string
  readonly scopeInstance: string
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly rulesSha256: string
  readonly dependencyAuthority: YimengStageDependencyAuthority
  readonly currentDecisionResult: YimengStageArtifactDecisionResult | null
  readonly dependencyAuthorityVerified: boolean
  readonly stageArtifactAvailable: boolean
  readonly stageApprovalGranted: boolean
  readonly lockActivated: boolean
  readonly planSealed: false
  readonly providerCalls: 0
  readonly reworkExecuted: false
}

/** Result values exposed by the private command channel. */
export interface YimengCommandEndpointMap {
  readonly proposeScript: YimengProposeScriptResponse
  readonly previewScript: YimengPreviewScriptResponse
  readonly commitScript: YimengCommitScriptResponse
  readonly recoverScriptCommit: YimengRecoverScriptCommitResponse
  readonly proposeStoryboardCanvas: YimengProposeStoryboardCanvasResponse
  readonly previewStoryboardCanvas: YimengPreviewStoryboardCanvasResponse
  readonly commitStoryboardCanvas: YimengCommitStoryboardCanvasResponse
  readonly recoverStoryboardCanvasCommit: YimengRecoverStoryboardCanvasCommitResponse
  readonly proposeElementProfile: YimengProposeElementProfileResponse
  readonly proposeReferenceAsset: YimengProposeReferenceAssetResponse
  readonly previewElementProfile: YimengPreviewElementProfileResponse
  readonly commitElementProfile: YimengCommitElementProfileResponse
  readonly recoverElementProfileCommit: YimengRecoverElementProfileCommitResponse
  readonly createComment: YimengCreateCommentResponse
  readonly createHumanDecision: YimengCreateHumanDecisionResponse
  readonly createReferenceRightsExceptionRelease: YimengCreateReferenceRightsExceptionReleaseResponse
  readonly recoverReferenceRightsExceptionRelease: YimengRecoverReferenceRightsExceptionReleaseResponse
  readonly recordShotFinding: YimengShotFindingResult
  readonly recoverShotFinding: YimengShotFindingRecovery
  readonly bindProductionUnit: YimengProductionUnitResult
  readonly recoverProductionUnitBinding: YimengProductionUnitRecovery
  readonly bindStageSource: YimengStageSourceResult
  readonly recoverStageSourceBinding: YimengStageSourceRecovery
  readonly registerStageArtifact: YimengStageArtifactResult
  readonly recoverStageArtifactRegistration: YimengStageArtifactRecovery
  readonly commitStageArtifactDecision: YimengStageArtifactDecisionResult
  readonly recoverStageArtifactDecision: YimengStageArtifactDecisionRecovery
  readonly probeStageArtifactAuthority: YimengStageArtifactAuthorityProbe
  readonly proposePromptIr: YimengProposePromptIrResponse
  readonly previewPromptIr: YimengPreviewPromptIrResponse
  readonly commitPromptIrEdit: YimengCommitPromptIrEditResponse
  readonly recoverPromptIrEditCommit: YimengRecoverPromptIrEditCommitResponse
  readonly selectPromptIr: YimengSelectPromptIrResponse
  readonly recoverPromptIrSelection: YimengRecoverPromptIrSelectionResponse
}

/** Endpoint names accepted by `/qingmu-yimeng-command`. */
export type YimengCommandEndpoint = keyof YimengCommandEndpointMap
