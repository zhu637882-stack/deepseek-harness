/** Browser-safe creation contracts; importing this leaf never loads Host Context merges. */
export type {
  CreationScope, ProjectInitializationRequest, ProjectInitializationRecovery, ProjectInitializationResult,
  TextImportReadRequest, TextImportRequest, TextImportLine, TextImportDraft, TextImportState,
  TextImportCorrection, TextImportConfirmationRequest, TextImportConfirmation,
} from './creation.ts'
/** Browser-safe planning values; no runtime Host imports. */
export type { PlanningShot, PlanningBase, PlanningOperation, ScenePlanningRequest, PlanningRevision, PlanningSource, PlanningScene, ScenePlanningState, ScenePlanningResult } from './scene-planning.ts'

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

/**
 * Backend response for a storyboard-canvas preview.
 */
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

/**
 * Backend response for storyboard-canvas commit recovery.
 */
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
  /** Exact latest Draft source; null asserts that no Draft existed when read. */
  readonly baseDraftSnapshotSha256: string | null
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

/**
 * Request payload for a Prompt IR preview.
 */
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

/**
 * Request payload for Prompt IR edit-commit recovery.
 */
export type YimengRecoverPromptIrEditCommitRequest = YimengCommitPromptIrEditRequest

/**
 * Backend response for Prompt IR edit-commit recovery.
 */
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

/**
 * Backend response for Prompt IR selection recovery.
 */
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
export interface YimengShotFindingPayload extends YimengCommandJsonObject {
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

/** Exact existing Yimeng asset selected from one Shot's read-only version stack. */
export interface YimengSelectTakeVersionRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedStackSha256: string
  readonly expectedSelectedTakeId: string | null
  readonly candidateTakeId: string
  readonly candidateVersionOrdinal: number
  readonly candidateOutputSha256: string
  readonly idempotencyKey: string
}

/** GET-only receipt lookup for an uncertain selection command. */
export type YimengRecoverTakeVersionSelectionRequest = YimengSelectTakeVersionRequest

/** Command-side copy of one Yimeng-owned Take projection. */
export interface YimengTakeSelectionVersion {
  readonly takeId: string
  readonly versionOrdinal: number
  readonly source: 'initial' | 'regenerate' | 'repair' | 'segment'
  readonly role: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly durationSec: number | null
  readonly estimatedCny: number | null
  readonly selectionStatus: string
  readonly isSelected: boolean
  readonly qualityStatus: string
  readonly qualityPassed: boolean | null
  readonly qualityCheckCount: number
  readonly blockers: readonly string[]
  readonly recordedOutputSha256: string | null
  readonly outputSha256: string | null
  readonly outputBindingStatus:
    | 'verified'
    | 'recorded_sha_missing'
    | 'materialized_file_missing'
    | 'recorded_sha_mismatch'
  readonly taskId: string | null
  readonly provider: string | null
  readonly model: string | null
  readonly providerTaskId: string | null
  readonly routeKey: string | null
  readonly inputHash: string | null
  readonly lineageComplete: boolean
  readonly canAttemptSelection: boolean
}

/** Authoritative Yimeng readback returned by a committed selection. */
export interface YimengTakeSelectionStackSubject {
  readonly schema: 'jason.qingmu-take-version-stack-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly selectionRevision: number
  readonly selectedTakeId: string | null
  readonly versions: readonly YimengTakeSelectionVersion[]
}

/** Verified human identity used by the Yimeng owner-selection command. */
export interface YimengTakeSelectionIdentity {
  readonly actorUserId: string
  readonly actorNaturalPersonId: string
  readonly actorRole: 'project_owner_selector'
  readonly authSessionId: string
}

/** One durable selection receipt; Selected remains explicitly separate from Approval. */
export interface YimengTakeVersionSelectionResult {
  readonly schema: 'jason.qingmu-take-selection-result.v1'
  readonly changeSetId: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly eventType: 'TakeVersionSelected'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly selectedTake: {
    readonly takeId: string
    readonly versionOrdinal: number
    readonly outputSha256: string
  }
  readonly selectionIdentity: YimengTakeSelectionIdentity
  readonly baseStackSnapshotSha256: string
  readonly authoritativeStack: YimengTakeSelectionStackSubject
  readonly authoritativeStackSnapshotSha256: string
  readonly provenanceTaskId: string
  readonly taskMutation: {
    readonly created: true
    readonly kind: 'local_selection_provenance'
    readonly taskId: string
  }
  readonly idempotencyKey: string
  readonly deduplicated: boolean
  readonly committedAt: string
  readonly selectionChanged: true
  readonly providerCalls: 0
  readonly paidProviderAuthority: 'not_granted'
  readonly budgetMutation: false
  readonly humanApprovalInferred: false
  readonly formalApprovalChanged: false
}

/** Historical receipt lookup; not_found never authorizes a retry by the adapter. */
export interface YimengTakeVersionSelectionRecovery extends YimengRecoverTakeVersionSelectionRequest {
  readonly schema: 'jason.qingmu-take-selection-recovery.v1'
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeVersionSelectionResult | null
}

/** One exact anchor for an ordinary Take comment. */
export type YimengTakeCommentAnchor =
  | { readonly kind: 'timecode'; readonly timecodeMillis: number }
  | { readonly kind: 'frame'; readonly frameNumber: number }

/** Full browser intent. Scope is carried by the URL; only five comment fields enter the POST body. */
export interface YimengCreateTakeCommentRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedTakeSubjectSha256: string
  readonly takeId: string
  readonly anchor: YimengTakeCommentAnchor
  readonly body: string
  readonly idempotencyKey: string
}

/** GET-only lookup uses the original intent so a recovered receipt can be checked exactly. */
export type YimengRecoverTakeCommentRequest = YimengCreateTakeCommentRequest

/** Durable ordinary comment returned by the authenticated Yimeng service. */
export interface YimengTakeCommentRecord {
  readonly id: string
  readonly takeId: string
  readonly versionOrdinalAtComment: number
  readonly outputSha256: string
  readonly frameBinding: {
    readonly frameId: string
    readonly frameNo: number
    readonly storyboardRevision: number
    readonly frameContentSha256: string
  }
  readonly takeSubjectSha256: string
  readonly anchor: YimengTakeCommentAnchor
  readonly body: string
  readonly actorId: string
  readonly actorRole: 'commenter'
  readonly authSessionId: string
  readonly createdAt: string
  readonly eventId: string
}

/** Comment receipt with every adjacent authority and impact flag fixed to zero/false. */
export interface YimengTakeCommentResult {
  readonly schema: 'jason.qingmu-take-comment-result.v1'
  readonly comment: YimengTakeCommentRecord
  readonly changed: false
  readonly selectionChanged: false
  readonly technicalPassChanged: false
  readonly formalApprovalChanged: false
  readonly episodeVerificationChanged: false
  readonly humanSignoffInferred: false
  readonly providerCalls: 0
  readonly budgetMutation: false
}

/** Historical receipt lookup. A missing receipt never authorizes a second POST. */
export interface YimengTakeCommentRecovery {
  readonly schema: 'jason.qingmu-take-comment-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly takeId: string
  readonly expectedTakeSubjectSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeCommentResult | null
}

/** Shared values do not merge Reviewer recommendation and Approver decision authority. */
export type YimengTakeReviewAction = 'approve' | 'reject' | 'request_changes'

/** Browser intent for Reviewer advice; authenticated identity stays server-side. */
export interface YimengCreateTakeReviewRecommendationRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedTakeSubjectSha256: string
  readonly takeId: string
  readonly recommendation: YimengTakeReviewAction
  readonly reason: string
  readonly idempotencyKey: string
}

/** Browser intent for a formal HumanDecision; no actor/session/person/time fields exist. */
export interface YimengCreateTakeHumanDecisionRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedTakeSubjectSha256: string
  readonly takeId: string
  readonly decision: YimengTakeReviewAction
  readonly reason: string
  readonly idempotencyKey: string
}

/**
 * Request payload for Take review-recommendation recovery.
 */
export type YimengRecoverTakeReviewRecommendationRequest =
  YimengCreateTakeReviewRecommendationRequest
/**
 * Request payload for human Take-decision recovery.
 */
export type YimengRecoverTakeHumanDecisionRequest = YimengCreateTakeHumanDecisionRequest

/** The exact subject contract carried by both immutable journal events. */
export interface YimengTakeReviewSubject {
  readonly schema: 'jason.qingmu-take-comment-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly takeId: string
  readonly versionOrdinal: number
  readonly outputSha256: string
  readonly durationMillis: number
}

/**
 * Durable backend record for a Take review recommendation.
 */
export interface YimengTakeReviewRecommendationRecord {
  readonly id: string
  readonly takeSubject: YimengTakeReviewSubject
  readonly takeSubjectSha256: string
  readonly actorId: string
  readonly actorRole: 'reviewer'
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly eventId: string
  readonly recommendation: YimengTakeReviewAction
  readonly reason: string
  readonly recommendedAt: string
}

/**
 * Durable backend record for a human Take decision.
 */
export interface YimengTakeHumanDecisionRecord {
  readonly decisionId: string
  readonly subjectType: 'shot_take'
  readonly subjectId: string
  readonly subjectRevision: number
  readonly subjectSha256: string
  readonly takeSubject: YimengTakeReviewSubject
  readonly takeSubjectSha256: string
  readonly actorId: string
  readonly actorRole: 'approver'
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly eventId: string
  readonly decision: YimengTakeReviewAction
  readonly reason: string
  readonly producerActorId: string
  readonly producerNaturalPersonId: string
  readonly participantNaturalPersonIds: readonly string[]
  readonly decidedAt: string
}

interface YimengTakeReviewImpactFlags {
  readonly changed: false
  readonly selectionChanged: false
  readonly technicalPassChanged: false
  /** False means no Take approval-state field was mutated; the event itself remains formal. */
  readonly formalApprovalChanged: false
  readonly episodeVerificationChanged: false
  readonly humanSignoffInferred: false
  readonly providerCalls: 0
  readonly budgetMutation: false
}

/**
 * Command result for a Take review recommendation.
 */
export interface YimengTakeReviewRecommendationResult extends YimengTakeReviewImpactFlags {
  readonly schema: 'jason.qingmu-take-review-recommendation-result.v1'
  readonly recommendation: YimengTakeReviewRecommendationRecord
  readonly decisionRecorded: false
  readonly recommendationOnly: true
}

/**
 * Command result for a human Take decision.
 */
export interface YimengTakeHumanDecisionResult extends YimengTakeReviewImpactFlags {
  readonly schema: 'jason.qingmu-take-human-decision-result.v1'
  readonly decision: YimengTakeHumanDecisionRecord
  readonly decisionRecorded: true
  readonly recommendationOnly: false
}

/**
 * Recovery result for a Take review recommendation.
 */
export interface YimengTakeReviewRecommendationRecovery {
  readonly schema: 'jason.qingmu-take-review-command-recovery.v1'
  readonly commandType: 'qingmu.take_review.recommendation.record.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly takeId: string
  readonly expectedTakeSubjectSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeReviewRecommendationResult | null
}

/**
 * Recovery result for a human Take decision.
 */
export interface YimengTakeHumanDecisionRecovery {
  readonly schema: 'jason.qingmu-take-review-command-recovery.v1'
  readonly commandType: 'qingmu.take_human_decision.record.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly takeId: string
  readonly expectedTakeSubjectSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeHumanDecisionResult | null
}

/** Fixed E7-3 QC catalogue; the browser cannot invent a new issue code. */
export type YimengTakeTechnicalQcCode =
  | 'STORY_CAUSALITY' | 'SHOT_ORDER' | 'PACING' | 'LOOK' | 'ENDING_CHOICE'
  | 'IDENTITY' | 'PROP_GEOMETRY' | 'TOPOLOGY' | 'EXACT_COUNT'
  | 'CONTACT_TRANSFER' | 'LOCKED_DIALOGUE' | 'TECHNICAL_RECEIPT'

/** One Reviewer result for a fixed macro or micro dimension. */
export interface YimengTakeTechnicalQcCheck {
  readonly code: YimengTakeTechnicalQcCode
  readonly result: 'PASS' | 'FAIL' | 'UNVERIFIED'
  readonly note: string | null
  readonly evidenceRefs: readonly string[]
}

/** Browser intent; method evidence and actor identity are always Host-derived. */
export interface YimengRecordTakeTechnicalQcRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedEvidenceSnapshotSha256: string
  readonly takeId: string
  readonly checks: readonly YimengTakeTechnicalQcCheck[]
  readonly idempotencyKey: string
}

/** Original immutable intent retained for GET-only receipt recovery. */
export type YimengRecoverTakeTechnicalQcRequest = YimengRecordTakeTechnicalQcRequest

/** Exact selected-Take identity retained in the immutable QC journal. */
export interface YimengTakeTechnicalQcSubject {
  readonly schema: 'jason.qingmu-take-acceptance-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly selectionRevision: number
  readonly takeId: string
  readonly versionOrdinal: number
  readonly selectionStatus: 'Selected'
  readonly outputSha256: string | null
  readonly taskId: string | null
  readonly capability: string | null
  readonly routeKey: string | null
  readonly provider: string | null
  readonly model: string | null
  readonly inputHash: string | null
  readonly submitId: string | null
}

/** Immutable technical-QC assessment. It is neither content approval nor selection. */
export interface YimengTakeTechnicalQcAssessment {
  readonly assessmentId: string
  readonly takeSubject: YimengTakeTechnicalQcSubject
  readonly takeSubjectSha256: string
  readonly evidenceSnapshotSha256: string
  readonly technicalReceiptStatus: 'PASS' | 'BLOCKED'
  readonly checks: readonly YimengTakeTechnicalQcCheck[]
  readonly issueCodes: readonly YimengTakeTechnicalQcCode[]
  readonly technicalPass: boolean
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly actorId: string
  readonly actorRole: 'reviewer'
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly recordedAt: string
  readonly eventId: string
}

/** Durable write receipt with all adjacent authority flags fixed closed. */
export interface YimengTakeTechnicalQcResult {
  readonly schema: 'jason.qingmu-take-technical-qc-result.v1'
  readonly assessment: YimengTakeTechnicalQcAssessment
  readonly technicalQcRecorded: true
  readonly technicalPass: boolean
  readonly changed: false
  readonly selectionChanged: false
  readonly recommendationChanged: false
  readonly decisionRecorded: false
  readonly formalApprovalChanged: false
  readonly technicalPassChanged: false
  readonly episodeVerificationChanged: false
  readonly humanSignoffInferred: false
  readonly providerCalls: 0
  readonly budgetMutation: false
}

/** GET-only lookup for the original actor-scoped QC command receipt. */
export interface YimengTakeTechnicalQcRecovery {
  readonly schema: 'jason.qingmu-take-technical-qc-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly takeId: string
  readonly expectedEvidenceSnapshotSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeTechnicalQcResult | null
}

/** The only E7-4 approval lifecycle actions accepted from the browser. */
export type YimengTakeApprovalLifecycleAction =
  | 'APPROVE' | 'INVALIDATE' | 'REQUEST_REWORK' | 'RESUBMIT'

/** Browser intent only; current source, Method evidence, and actor identity are Host-derived. */
export interface YimengTransitionTakeApprovalLifecycleRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly expectedSourceSnapshotSha256: string
  readonly takeId: string
  readonly action: YimengTakeApprovalLifecycleAction
  readonly reason: string
  readonly idempotencyKey: string
}

/** Original immutable intent retained for GET-only lifecycle receipt recovery. */
export type YimengRecoverTakeApprovalLifecycleTransitionRequest =
  YimengTransitionTakeApprovalLifecycleRequest

/** Current lifecycle states derived by the current Core Method. */
export type YimengTakeApprovalLifecycleState =
  | 'READY_FOR_APPROVAL' | 'APPROVED' | 'APPROVAL_INVALIDATED_PENDING_EVENT'
  | 'REWORK_REQUIRED' | 'REWORK_RECORDED' | 'READY_TO_RESUBMIT'
  | 'IN_REVIEW' | 'METHOD_REVIEW_REQUIRED' | 'AWAITING_REVIEW'

/** Fixed E7-4 lifecycle policy compiled from the current Core sources. */
export interface YimengTakeApprovalLifecycleDefinition extends YimengCommandJsonObject {
  readonly mode: 'STATELESS_TAKE_APPROVAL_LIFECYCLE_METHOD'
  readonly actions: readonly YimengTakeApprovalLifecycleAction[]
  readonly approvalRequires: readonly string[]
  readonly invalidation: {
    readonly sourceDriftIsImmediate: true
    readonly auditableEventRequired: true
    readonly oldApprovalMayNotBeInherited: true
  }
  readonly rework: {
    readonly boundedFindingRouteRequired: true
    readonly oneEarliestOwnerPerDefect: true
    readonly executionAllowed: false
    readonly paidGenerationAuthorized: false
    readonly automaticRetry: false
    readonly thirdSameClassRequiresMethodReview: true
  }
  readonly resubmission: {
    readonly newTakeRevisionRequired: true
    readonly editIsApproval: false
    readonly approvalInherited: false
  }
  readonly boundaries: {
    readonly businessTruth: 'yimeng'
    readonly selectionChanged: false
    readonly technicalPassChanged: false
    readonly reviewDecisionChanged: false
    readonly reworkExecuted: false
    readonly providerCalls: 0
    readonly budgetMutation: false
    readonly episodeVerificationChanged: false
    readonly humanSignoffInferred: false
    readonly evidenceLedgerMutation: false
  }
}

/** Legal next actions bound to one fresh Yimeng source and current Core rules. */
export interface YimengTakeApprovalLifecycleMethodTransition extends YimengCommandJsonObject {
  readonly state: YimengTakeApprovalLifecycleState
  readonly legalActions: readonly YimengTakeApprovalLifecycleAction[]
  readonly currentApprovalId: string | null
  readonly staleApprovalId: string | null
  readonly invalidationReasons: readonly string[]
  readonly reworkClassCodes: readonly string[]
  readonly sameClassReworkCount: number
  readonly sameClassCountAfterRequest: number
  readonly methodReviewRequired: boolean
  readonly methodReviewRequiredAfterRequest: boolean
  readonly resubmitSourceReworkId: string | null
  readonly approvalInherited: false
  readonly boundedFindingRouteRequired: boolean
}

/** Host-verified current lifecycle projection; it records no transition by itself. */
export interface YimengImagoTakeApprovalLifecycleMethodProjection
  extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-take-approval-lifecycle-method.v1'
  readonly subject: YimengTakeTechnicalQcSubject
  readonly subjectSnapshotSha256: string
  readonly sourceSnapshotSha256: string
  readonly definition: YimengTakeApprovalLifecycleDefinition
  readonly transition: YimengTakeApprovalLifecycleMethodTransition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host-origin proof; it grants no human approval and no rework execution authority. */
export interface YimengImagoTakeApprovalLifecycleMethodAttestation
  extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-take-approval-lifecycle-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly sourceSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** One immutable approval, invalidation, rework request, or resubmission journal entry. */
export interface YimengTakeApprovalLifecycleTransition {
  readonly transitionId: string
  readonly revision: number
  readonly action: YimengTakeApprovalLifecycleAction
  readonly takeId: string
  readonly takeVersionOrdinal: number
  readonly takeSubjectSha256: string
  readonly decisionId: string | null
  readonly decisionEventId: string | null
  readonly assessmentId: string | null
  readonly assessmentEventId: string | null
  readonly sourceApprovalId: string | null
  readonly sourceReworkId: string | null
  readonly defectClassCodes: readonly string[]
  readonly reason: string
  readonly actorId: string
  readonly actorRole: 'approver' | 'director'
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly recordedAt: string
  readonly eventId: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
}

/** Durable E7-4 write receipt with all adjacent authority flags explicit. */
export interface YimengTakeApprovalLifecycleResult {
  readonly schema: 'jason.qingmu-take-approval-lifecycle-result.v1'
  readonly transition: YimengTakeApprovalLifecycleTransition
  readonly sourceSnapshotSha256: string
  readonly authoritativeSourceSnapshotSha256: string
  readonly methodReviewRequiredAfterRequest: boolean
  readonly boundedFindingRouteRequired: boolean
  readonly changed: true
  readonly formalApprovalChanged: boolean
  readonly approvalInvalidated: boolean
  readonly reworkRequested: boolean
  readonly resubmitted: boolean
  readonly selectionChanged: false
  readonly technicalPassChanged: false
  readonly reviewDecisionChanged: false
  readonly reworkExecuted: false
  readonly providerCalls: 0
  readonly budgetMutation: false
  readonly episodeVerificationChanged: false
  readonly humanSignoffInferred: false
  readonly evidenceLedgerMutation: false
}

/** GET-only lookup for the original actor-scoped lifecycle command receipt. */
export interface YimengTakeApprovalLifecycleRecovery {
  readonly schema: 'jason.qingmu-take-approval-lifecycle-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly takeId: string
  readonly expectedSourceSnapshotSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengTakeApprovalLifecycleResult | null
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

/** One current Production Unit frozen into the episode LSU plan subject. */
export interface YimengLsuPlanProductionUnit {
  readonly unitId: string
  readonly groupId: string
  readonly bindingRevision: number
  readonly bindingSha256: string
  readonly sourceSnapshotSha256: string
}

/** Independently approved current C5F lock lineage required by the plan. */
export interface YimengLsuPlanBlueprintLock {
  readonly lockId: 'PRODUCTION_BLUEPRINT_LOCK'
  readonly stageId: 'C5F'
  readonly scopeInstance: 'GLOBAL'
  readonly artifactRecordRevision: number
  readonly artifactRecordSha256: string
  readonly decisionId: string
  readonly eventSha256: string
}

/** Exact non-empty current episode scope owned by Yimeng. */
export interface YimengLsuPlanSubject extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-lsu-plan-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly productionUnits: readonly YimengLsuPlanProductionUnit[]
  readonly productionBlueprintLock: YimengLsuPlanBlueprintLock
}

/** Current IMAGO declaration method; it grants no Stage or execution authority. */
export interface YimengLsuPlanDefinition extends YimengCommandJsonObject {
  readonly id: 'IMAGO-V6-LSU-PLAN'
  readonly version: string
  readonly scope: 'per_episode'
  readonly unitIdPattern: 'LSU[0-9]{2,}'
  readonly stages: readonly {
    readonly stageId: string
    readonly roleId: string
    readonly contractSha256: string
  }[]
  readonly requiredLockId: 'PRODUCTION_BLUEPRINT_LOCK'
  readonly requiredLockStageId: 'C5F'
  readonly requiredLockScopeInstance: 'GLOBAL'
  readonly declarationPolicy: 'exact_current_instantiated_units'
  readonly operation: 'seal_current_lsu_plan'
  readonly planSealingAllowed: true
  readonly stageApprovalAllowed: false
  readonly lockActivationAllowed: false
  readonly reworkExecutionAllowed: false
  readonly providerCalls: 0
}

/** Host-validated complete-scope Method forwarded to Yimeng. */
export interface YimengImagoLsuPlanMethodProjection extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-lsu-plan-method.v1'
  readonly subject: YimengLsuPlanSubject
  readonly subjectSnapshotSha256: string
  readonly definition: YimengLsuPlanDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
  readonly lockRuleBindings: Readonly<Record<string, string>>
  readonly lockRulesSha256: string
}

/** Host-origin HMAC over the current plan subject and Method projection. */
export interface YimengImagoLsuPlanMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-lsu-plan-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Browser-safe plan-seal intent; Method, actor, and session are Host/server derived. */
export interface YimengSealLsuPlanRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly expectedSubjectSha256: string
  readonly expectedPlanRevision: number
  readonly expectedPlanSha256: string | null
  readonly idempotencyKey: string
}

/** Trusted Host command after a fresh current Method has been recomputed. */
export interface YimengForwardedSealLsuPlanRequest extends YimengSealLsuPlanRequest {
  readonly methodProjection: YimengImagoLsuPlanMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoLsuPlanMethodAttestation
}

/** Probe intent deliberately contains only business coordinates. */
export interface YimengProbeLsuPlanAuthorityRequest {
  readonly projectId: string
  readonly episodeId: string
}

/** Trusted Host probe after a fresh current Method has been recomputed. */
export interface YimengForwardedLsuPlanAuthorityProbeRequest extends YimengProbeLsuPlanAuthorityRequest {
  readonly methodProjection: YimengImagoLsuPlanMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoLsuPlanMethodAttestation
}

/** Immutable Yimeng plan head retained in the existing three-ledger journal. */
export interface YimengLsuPlanSeal extends YimengCommandJsonObject {
  readonly projectId: string
  readonly episodeId: string
  readonly revision: number
  readonly subject: YimengLsuPlanSubject
  readonly subjectSnapshotSha256: string
  readonly definition: YimengLsuPlanDefinition
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly lockRulesSha256: string
  readonly actorId: string
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly eventId: string
  readonly changeSetId: string
  readonly sealedAt: string
}

/** Durable result of one explicit exact-scope plan seal. */
export interface YimengLsuPlanSealResult {
  readonly schema: 'jason.qingmu-lsu-plan-seal-result.v1'
  readonly seal: YimengLsuPlanSeal
  readonly sealSha256: string
  readonly receiptId: string
  readonly outboxEventId: string
  readonly planSealed: true
  readonly stageApprovalGranted: false
  readonly lockActivated: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Query-only lookup under the original exact CAS and idempotency coordinates. */
export interface YimengLsuPlanSealRecovery {
  readonly schema: 'jason.qingmu-lsu-plan-seal-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly expectedSubjectSha256: string
  readonly expectedPlanRevision: number
  readonly expectedPlanSha256: string | null
  readonly idempotencyKey: string
  readonly found: boolean
  readonly result: YimengLsuPlanSealResult | null
}

/** Fresh read-only qualification of a historical seal under today's exact Method. */
export interface YimengLsuPlanAuthorityProbe {
  readonly schema: 'jason.qingmu-lsu-plan-authority-probe.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly lockRulesSha256: string
  readonly latestSeal: YimengLsuPlanSealResult | null
  readonly currentPlanSealed: boolean
  readonly planSealed: boolean
  readonly stageApprovalGranted: false
  readonly lockActivated: false
  readonly providerCalls: 0
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Existing OPEN Finding carried into one bounded route subject. */
export interface YimengReworkRouteFinding extends YimengCommandJsonObject {
  readonly id: string
  readonly eventId: string
  readonly subjectSnapshotSha256: string
  readonly timecode: string
  readonly observation: string
  readonly evidenceRefs: readonly string[]
  readonly earliestOwner: string
  readonly ownerReason: string
  readonly severity: 'BLOCKER' | 'MAJOR' | 'MINOR'
  readonly suggestion: string
  readonly reworkScope: string
  readonly status: 'OPEN'
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
}

/** Current Production Unit containing the Finding's exact selected Shot. */
export interface YimengReworkRouteProductionUnit extends YimengCommandJsonObject {
  readonly unitId: string
  readonly bindingRevision: number
  readonly bindingSha256: string
  readonly sourceSnapshotSha256: string
  readonly source: YimengProductionUnitSource
}

/** Current sealed whole-episode LSU plan and C5F lock lineage. */
export interface YimengReworkRouteSealedPlan extends YimengCommandJsonObject {
  readonly revision: number
  readonly sealSha256: string
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly lockRulesSha256: string
  readonly subject: YimengLsuPlanSubject
}

/** Exact current Yimeng authority chain for one bounded route. */
export interface YimengReworkRouteSubject extends YimengCommandJsonObject {
  readonly schema: 'jason.qingmu-bounded-rework-route-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly selectedVideo: YimengShotVideoSubject
  readonly finding: YimengReworkRouteFinding
  readonly productionUnit: YimengReworkRouteProductionUnit
  readonly sealedPlan: YimengReworkRouteSealedPlan
}

/** Evidence-only comparison; a rule change never expands the route. */
export interface YimengReworkRouteRuleComparison extends YimengCommandJsonObject {
  readonly recordedRulesSha256: string
  readonly currentRulesSha256: string
  readonly changed: boolean
  readonly effect: 'evidence_only_no_scope_expansion'
}

/** Current Core route contract with every adjacent authority denied. */
export interface YimengReworkRouteDefinition extends YimengCommandJsonObject {
  readonly id: 'IMAGO-V6-BOUNDED-REWORK-ROUTE'
  readonly version: string
  readonly scope: 'per_finding'
  readonly operation: 'record_bounded_rework_route'
  readonly requiredFindingStatus: 'OPEN'
  readonly oneEarliestOwnerPerFinding: true
  readonly groupByEarliestOwner: true
  readonly timecodeEvidenceAndScopeRequired: true
  readonly findingRuleComparison: YimengReworkRouteRuleComparison
  readonly findingClosureAllowed: false
  readonly taskCreationAllowed: false
  readonly selectionChangeAllowed: false
  readonly stageDecisionChangeAllowed: false
  readonly lockInvalidationAllowed: false
  readonly reworkExecutionAllowed: false
  readonly paidGenerationAuthorized: false
  readonly automaticRetry: false
  readonly providerChangeAuthorized: false
  readonly unboundedRedoAuthorized: false
  readonly completionReleaseAllowed: false
  readonly providerCalls: 0
}

/** Finding facts frozen into the single bounded instruction. */
export interface YimengReworkRouteBoundedItem extends YimengCommandJsonObject {
  readonly timecode: string
  readonly severity: 'BLOCKER' | 'MAJOR' | 'MINOR'
  readonly observation: string
  readonly evidenceRefs: readonly string[]
  readonly ownerReason: string
  readonly suggestion: string
  readonly reworkScope: string
}

/** Non-executing instruction for the earliest current Owner. */
export interface YimengReworkRouteInstruction extends YimengCommandJsonObject {
  readonly state: 'BOUNDED_REWORK_ROUTED'
  readonly outputSchema: 'IMAGO-V6-BoundedReworkRoute-v1'
  readonly findingId: string
  readonly findingEventId: string
  readonly unitId: string
  readonly earliestOwner: string
  readonly ownerRoleId: string
  readonly ownerScope: 'global' | 'per_lsu'
  readonly ownerScopeInstance: string
  readonly boundedItem: YimengReworkRouteBoundedItem
  readonly scopeExpansionForbidden: true
}

/** Fresh Host-validated bounded route Method forwarded to Yimeng. */
export interface YimengImagoReworkRouteMethodProjection extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-bounded-rework-route-method.v1'
  readonly subject: YimengReworkRouteSubject
  readonly subjectSnapshotSha256: string
  readonly definition: YimengReworkRouteDefinition
  readonly routeInstruction: YimengReworkRouteInstruction
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
  readonly lockRuleBindings: Readonly<Record<string, string>>
  readonly lockRulesSha256: string
}

/** Host-origin HMAC over the current route subject and Method projection. */
export interface YimengImagoReworkRouteMethodAttestation extends YimengCommandJsonObject {
  readonly schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Browser-safe exact-CAS route intent; Method, actor, and session remain derived. */
export interface YimengRecordReworkRouteRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly findingId: string
  readonly expectedSubjectSha256: string
  readonly expectedRouteRevision: number
  readonly expectedRouteSha256: string | null
  readonly idempotencyKey: string
}

/** Trusted Host command after the current Method has been recomputed. */
export interface YimengForwardedRecordReworkRouteRequest extends YimengRecordReworkRouteRequest {
  readonly methodProjection: YimengImagoReworkRouteMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoReworkRouteMethodAttestation
}

/** Fresh authority-probe intent deliberately contains only business coordinates. */
export type YimengProbeReworkRouteAuthorityRequest = Pick<
  YimengRecordReworkRouteRequest,
  'projectId' | 'episodeId' | 'frameId' | 'findingId'
>

/** Trusted Host probe after the current bounded route Method has been recomputed. */
export interface YimengForwardedReworkRouteAuthorityProbeRequest
  extends YimengProbeReworkRouteAuthorityRequest {
  readonly methodProjection: YimengImagoReworkRouteMethodProjection
  readonly methodProjectionSha256: string
  readonly methodAttestation: YimengImagoReworkRouteMethodAttestation
}

/** Immutable route head retained in Yimeng's existing three-ledger journal. */
export interface YimengReworkRouteRecord extends YimengCommandJsonObject {
  readonly projectId: string
  readonly episodeId: string
  readonly findingId: string
  readonly revision: number
  readonly subject: YimengReworkRouteSubject
  readonly subjectSnapshotSha256: string
  readonly definition: YimengReworkRouteDefinition
  readonly routeInstruction: YimengReworkRouteInstruction
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly lockRulesSha256: string
  readonly actorId: string
  readonly actorNaturalPersonId: string
  readonly authSessionId: string
  readonly eventId: string
  readonly changeSetId: string
  readonly routedAt: string
}

/** Durable result of recording one bounded route and nothing adjacent. */
export interface YimengReworkRouteResult {
  readonly schema: 'jason.qingmu-bounded-rework-route-result.v1'
  readonly route: YimengReworkRouteRecord
  readonly routeSha256: string
  readonly receiptId: string
  readonly outboxEventId: string
  readonly routeRecorded: true
  readonly findingClosed: false
  readonly selectionChanged: false
  readonly stageDecisionChanged: false
  readonly lockInvalidated: false
  readonly taskCreated: false
  readonly providerCalls: 0
  readonly reworkExecuted: false
  readonly humanSignoffInferred: false
}

/** Query-only lookup under the original exact CAS and idempotency coordinates. */
export interface YimengReworkRouteRecovery {
  readonly schema: 'jason.qingmu-bounded-rework-route-recovery.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly findingId: string
  readonly expectedSubjectSha256: string
  readonly expectedRouteRevision: number
  readonly expectedRouteSha256: string | null
  readonly idempotencyKey: string
  readonly found: boolean
  readonly result: YimengReworkRouteResult | null
}

/** Fresh qualification of a historical route under today's exact Core Method. */
export interface YimengReworkRouteAuthorityProbe {
  readonly schema: 'jason.qingmu-bounded-rework-route-authority-probe.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly findingId: string
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly lockRulesSha256: string
  readonly latestRoute: YimengReworkRouteResult | null
  readonly currentRouteRecorded: boolean
  readonly routeRecorded: boolean
  readonly findingClosed: false
  readonly selectionChanged: false
  readonly stageDecisionChanged: false
  readonly lockInvalidated: false
  readonly taskCreated: false
  readonly providerCalls: 0
  readonly reworkExecuted: false
  readonly humanSignoffInferred: false
}

/** Result values exposed by the private command channel. */
export interface YimengCommandEndpointMap {
  readonly readScenePlanning: import('./scene-planning.ts').ScenePlanningState
  readonly saveScenePlanning: import('./scene-planning.ts').ScenePlanningResult
  readonly recoverScenePlanning: import('./scene-planning.ts').ScenePlanningResult
  readonly initializeProject: import('./creation.ts').ProjectInitializationResult
  readonly recoverProjectInitialization: import('./creation.ts').ProjectInitializationResult
  readonly readTextImport: import('./creation.ts').TextImportState
  readonly createTextImport: import('./creation.ts').TextImportDraft
  readonly correctTextImport: import('./creation.ts').TextImportDraft
  readonly confirmTextImport: import('./creation.ts').TextImportConfirmation
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
  readonly selectTakeVersion: YimengTakeVersionSelectionResult
  readonly recoverTakeVersionSelection: YimengTakeVersionSelectionRecovery
  readonly createTakeComment: YimengTakeCommentResult
  readonly recoverTakeComment: YimengTakeCommentRecovery
  readonly createTakeReviewRecommendation: YimengTakeReviewRecommendationResult
  readonly recoverTakeReviewRecommendation: YimengTakeReviewRecommendationRecovery
  readonly createTakeHumanDecision: YimengTakeHumanDecisionResult
  readonly recoverTakeHumanDecision: YimengTakeHumanDecisionRecovery
  readonly recordTakeTechnicalQc: YimengTakeTechnicalQcResult
  readonly recoverTakeTechnicalQc: YimengTakeTechnicalQcRecovery
  readonly transitionTakeApprovalLifecycle: YimengTakeApprovalLifecycleResult
  readonly recoverTakeApprovalLifecycleTransition: YimengTakeApprovalLifecycleRecovery
  readonly bindProductionUnit: YimengProductionUnitResult
  readonly recoverProductionUnitBinding: YimengProductionUnitRecovery
  readonly bindStageSource: YimengStageSourceResult
  readonly recoverStageSourceBinding: YimengStageSourceRecovery
  readonly registerStageArtifact: YimengStageArtifactResult
  readonly recoverStageArtifactRegistration: YimengStageArtifactRecovery
  readonly commitStageArtifactDecision: YimengStageArtifactDecisionResult
  readonly recoverStageArtifactDecision: YimengStageArtifactDecisionRecovery
  readonly probeStageArtifactAuthority: YimengStageArtifactAuthorityProbe
  readonly sealLsuPlan: YimengLsuPlanSealResult
  readonly recoverLsuPlanSeal: YimengLsuPlanSealRecovery
  readonly probeLsuPlanAuthority: YimengLsuPlanAuthorityProbe
  readonly recordReworkRoute: YimengReworkRouteResult
  readonly recoverReworkRoute: YimengReworkRouteRecovery
  readonly probeReworkRouteAuthority: YimengReworkRouteAuthorityProbe
  readonly proposePromptIr: YimengProposePromptIrResponse
  readonly previewPromptIr: YimengPreviewPromptIrResponse
  readonly commitPromptIrEdit: YimengCommitPromptIrEditResponse
  readonly recoverPromptIrEditCommit: YimengRecoverPromptIrEditCommitResponse
  readonly selectPromptIr: YimengSelectPromptIrResponse
  readonly recoverPromptIrSelection: YimengRecoverPromptIrSelectionResponse
}

/** Endpoint names accepted by `/qingmu-yimeng-command`. */
export type YimengCommandEndpoint = keyof YimengCommandEndpointMap
