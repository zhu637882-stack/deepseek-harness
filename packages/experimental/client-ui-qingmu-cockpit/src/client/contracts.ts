import type { CreationScope, AssetDesign, AssetDesignState, AssetImageQuote, AssetImageCommand, AssetImageSubmission, AssetImageRuns } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { ReferenceVideoCandidateRegistrationRequest, ReferenceVideoCandidateRegistration, ReferenceVideoFrameRequest, ReferenceVideoFrameReceipt } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ReferenceVideoMaterialsRequest, ReferenceVideoMaterialsState, PrepareReferenceVideoMaterialRequest, ReferenceVideoMaterialPreparationResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QueueReferenceVideoRequest, ReferenceVideoRun, ReferenceVideoRunsResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ReferenceVideoQuoteRequest, ReferenceVideoQuoteResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ReferenceVideoAssetsRequest, ReferenceVideoAssetsResponse, ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { ReferenceVideoDraftResponse, SaveReferenceVideoDraftRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
/** Stable Client-side view of the private Yimeng read-adapter RPC contract. */
import type {
  ImagoStageSourceMethodRequest,
  ImagoStageSourceMethodResponse,
  ImagoStageSourceMethodProjection,
  ImagoTakeAcceptanceMethodRequest,
  ImagoTakeAcceptanceMethodResponse,
  ImagoTakeAcceptanceMethodProjection,
  ImagoTakeTechnicalQcMethodRequest,
  ImagoTakeTechnicalQcMethodResponse,
  ImagoTakeTechnicalQcMethodProjection,
  ImagoTakeApprovalLifecycleAction,
  ImagoTakeApprovalLifecycleMethodRequest,
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleMethodProjection,
  ImagoTakeApprovalLifecycleState,
  ImagoTakeApprovalLifecycleTransition,
  ImagoProductionUnitMethodRequest,
  ImagoProductionUnitMethodResponse,
  ImagoProductionUnitMethodProjection,
  ImagoContinuityMethodProjection,
  ImagoContinuityMethodRequest,
  ImagoContinuityMethodResponse,
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoHeroFrameStoryboardAnnotation,
  ImagoHeroFrameStoryboardMethodRequest,
  ImagoHeroFrameStoryboardMethodResponse,
  ImagoHeroFrameStoryboardPoint,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoPromptIrBootstrapMethodRequest,
  ImagoPromptIrBootstrapMethodResponse,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodResponse,
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
  ImagoShotFindingMethodRequest,
  ImagoShotFindingMethodResponse,
  ImagoReworkRouteMethodRequest,
  ImagoReworkRouteMethodResponse,
  ImagoWorksetMethodRequest,
  ImagoWorksetMethodResponse,
  ImagoWorksetProjection,
} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type {
  YimengEpisodeEvidenceRequest,
  YimengEpisodeEvidenceLedgerResponse,
  YimengEpisodeVerificationRequest,
  YimengEpisodeVerificationResponse,
  YimengEditorialHandoffRequest,
  YimengEditorialHandoffResponse,
  YimengCapabilityCatalogItem,
  YimengCapabilityCatalogRequest,
  YimengCapabilityCatalogResponse,
  YimengCapabilityEligibility,
  YimengCapabilityMutualExclusion,
  YimengCapabilitySnapshot,
  YimengCostRehearsalRequest,
  YimengCostRehearsalResponse,
  YimengCostRehearsalSubject,
  YimengGateAControlEvidenceResponse,
  YimengGateAControlScenario,
  YimengGateAControlScenarioId,
  YimengGateAControlSourceBinding,
  YimengFirstFrameQuoteRequest,
  YimengFirstFrameQuoteResponse,
  YimengStageSource,
  YimengStageSourceDefinition,
  YimengStageSourceBinding,
  YimengStageSourceResult,
  YimengStageSourcesRequest,
  YimengStageSourcesResponse,
  YimengProductionUnitSource,
  YimengProductionUnitDefinition,
  YimengProductionUnitBinding,
  YimengProductionUnitsRequest,
  YimengProductionUnitsResponse,
  YimengEpisodesRequest,
  YimengEpisodesResponse,
  YimengElementProfileRequest,
  YimengElementProfileReference,
  YimengElementProfileResponse,
  YimengElementReviewFeedRequest,
  YimengElementReviewFeedResponse,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengHealth,
  YimengHeroFrameBinding,
  YimengHeroFrameStoryboardShot,
  YimengHeroFrameStoryboardsProjection,
  YimengJsonObject,
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrRequest,
  YimengPromptIrResponse,
  YimengPromptIrBootstrapResponse,
  YimengReferenceCandidatesRequest,
  YimengReferenceCandidatesResponse,
  YimengReferenceAssetCandidate,
  YimengReferenceRightsRecord,
  YimengReferenceRightsExceptionReleaseFeedRequest,
  YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengReferenceRightsExceptionRelease,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionScope,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengSelectedVideoReviewRequest,
  YimengSelectedVideoReviewResponse,
  YimengSelectedVideoReviewStatus,
  YimengTakeVersion,
  YimengTakeVersionRequest,
  YimengTakePreviewRequest, YimengTakePreviewResponse,
  YimengTakeVersionStackResponse,
  YimengTakeVersionStackSubject,
  YimengTakeComment,
  YimengTakeCommentAnchor,
  YimengTakeCommentFeedResponse,
  YimengTakeCommentRequest,
  YimengTakeCommentSubject,
  YimengTakeCommentVersion,
  YimengTakeReviewAction,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewAuthorityRequest,
  YimengTakeReviewRecommendation,
  YimengTakeHumanDecision,
  YimengTakeAcceptanceRequest,
  YimengTakeAcceptanceResponse,
  YimengTakeAcceptanceEvidence,
  YimengTakeAcceptanceSubject,
  YimengTakeTechnicalQcAssessment,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRequest,
  YimengTakeApprovalLifecycleAssessment,
  YimengTakeApprovalLifecycleDecision,
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRequest,
  YimengTakeApprovalLifecycleSource,
  YimengTakeApprovalLifecycleTransition,
  YimengShotFinding,
  YimengShotFindingPayload,
  YimengShotFindingFeedResponse,
  YimengShotFindingResult,
  YimengShotFindingRecovery,
  YimengShotVideoSubject,
  YimengReworkRouteSourceRequest,
  YimengReworkRouteSourceResponse,
  YimengShotRelationBeat,
  YimengShotRelationElement,
  YimengShotRelationScene,
  YimengShotRelationShot,
  YimengShotRelationsProjection,
  YimengStoryboardCanvas,
  YimengStoryboardCanvasAnnotation,
  YimengStoryboardCanvasAnnotationKind,
  YimengStoryboardCanvasPoint,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  YimengBindStageSourceRequest,
  YimengRecoverStageSourceBindingRequest,
  YimengStageSourceRecovery,
  YimengBindProductionUnitRequest,
  YimengRecoverProductionUnitBindingRequest,
  YimengProductionUnitResult,
  YimengProductionUnitRecovery,
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengCreateReferenceRightsExceptionReleaseRequest,
  YimengCreateReferenceRightsExceptionReleaseResponse,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengPreviewStoryboardCanvasRequest,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
  YimengProposePromptIrRequest,
  YimengProposePromptIrResponse,
  YimengProposeReferenceAssetRequest,
  YimengProposeReferenceAssetResponse,
  YimengReferenceAssetOperation,
  YimengReferenceActionOperation,
  YimengReferenceCommitElementProfileResponse,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceRightsCommitElementProfileResponse,
  YimengReferenceRightsPreviewElementProfileResponse,
  YimengProposeScriptRequest,
  YimengProposeScriptResponse,
  YimengProposeStoryboardCanvasRequest,
  YimengProposeStoryboardCanvasResponse,
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengBootstrapPromptIrRequest,
  YimengBootstrapPromptIrResponse,
  YimengRecoverPromptIrBootstrapRequest,
  YimengSelectBootstrapPromptIrRequest,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
  YimengRecoverStoryboardCanvasCommitRequest,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengRecoverReferenceRightsExceptionReleaseRequest,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
  YimengRecordShotFindingRequest,
  YimengRecoverShotFindingRequest,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteResult,
  YimengReworkRouteRecovery,
  YimengProbeReworkRouteAuthorityRequest,
  YimengReworkRouteAuthorityProbe,
  YimengSelectTakeVersionRequest,
  YimengRecoverTakeVersionSelectionRequest,
  YimengTakeSelectionIdentity,
  YimengTakeVersionSelectionResult,
  YimengTakeVersionSelectionRecovery,
  YimengCreateTakeCommentRequest,
  YimengRecoverTakeCommentRequest,
  YimengTakeCommentRecord,
  YimengTakeCommentRecovery,
  YimengTakeCommentResult,
  YimengCreateTakeReviewRecommendationRequest,
  YimengRecoverTakeReviewRecommendationRequest,
  YimengTakeReviewRecommendationRecord,
  YimengTakeReviewRecommendationRecovery,
  YimengTakeReviewRecommendationResult,
  YimengCreateTakeHumanDecisionRequest,
  YimengRecoverTakeHumanDecisionRequest,
  YimengTakeHumanDecisionRecord,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengRecordTakeTechnicalQcRequest,
  YimengRecoverTakeTechnicalQcRequest,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
  YimengRecoverTakeApprovalLifecycleTransitionRequest,
  YimengTakeApprovalLifecycleAction,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTransitionTakeApprovalLifecycleRequest,
  YimengProductionTakeResult,
  YimengQueueProductionTakeIntent,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export type {
  ImagoStageSourceMethodRequest,
  ImagoStageSourceMethodResponse,
  ImagoStageSourceMethodProjection,
  ImagoTakeAcceptanceMethodRequest,
  ImagoTakeAcceptanceMethodResponse,
  ImagoTakeAcceptanceMethodProjection,
  ImagoTakeTechnicalQcMethodRequest,
  ImagoTakeTechnicalQcMethodResponse,
  ImagoTakeTechnicalQcMethodProjection,
  ImagoTakeApprovalLifecycleAction,
  ImagoTakeApprovalLifecycleMethodRequest,
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleMethodProjection,
  ImagoTakeApprovalLifecycleState,
  ImagoTakeApprovalLifecycleTransition,
  ImagoProductionUnitMethodRequest,
  ImagoProductionUnitMethodResponse,
  ImagoProductionUnitMethodProjection,
  ImagoContinuityMethodProjection,
  ImagoContinuityMethodRequest,
  ImagoContinuityMethodResponse,
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoHeroFrameStoryboardAnnotation,
  ImagoHeroFrameStoryboardMethodRequest,
  ImagoHeroFrameStoryboardMethodResponse,
  ImagoHeroFrameStoryboardPoint,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoPromptIrBootstrapMethodRequest,
  ImagoPromptIrBootstrapMethodResponse,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodResponse,
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
  ImagoShotFindingMethodRequest,
  ImagoShotFindingMethodResponse,
  ImagoReworkRouteMethodRequest,
  ImagoReworkRouteMethodResponse,
  ImagoWorksetMethodRequest,
  ImagoWorksetMethodResponse,
  ImagoWorksetProjection,
}
export type {
  YimengCapabilityCatalogItem,
  YimengEpisodeEvidenceRequest,
  YimengEpisodeEvidenceLedgerResponse,
  YimengEpisodeVerificationRequest,
  YimengEpisodeVerificationResponse,
  YimengEditorialHandoffRequest,
  YimengEditorialHandoffResponse,
  YimengCapabilityCatalogRequest,
  YimengCapabilityCatalogResponse,
  YimengCapabilityEligibility,
  YimengCapabilityMutualExclusion,
  YimengCapabilitySnapshot,
  YimengCostRehearsalRequest,
  YimengCostRehearsalResponse,
  YimengCostRehearsalSubject,
  YimengGateAControlEvidenceResponse,
  YimengGateAControlScenario,
  YimengGateAControlScenarioId,
  YimengGateAControlSourceBinding,
  YimengFirstFrameQuoteRequest,
  YimengFirstFrameQuoteResponse,
  YimengStageSource,
  YimengStageSourceDefinition,
  YimengStageSourceBinding,
  YimengStageSourceResult,
  YimengStageSourcesRequest,
  YimengStageSourcesResponse,
  YimengProductionUnitSource,
  YimengProductionUnitDefinition,
  YimengProductionUnitBinding,
  YimengProductionUnitsRequest,
  YimengProductionUnitsResponse,
  YimengEpisodesRequest,
  YimengEpisodesResponse,
  YimengElementProfileRequest,
  YimengElementProfileReference,
  YimengElementProfileResponse,
  YimengElementReviewFeedRequest,
  YimengElementReviewFeedResponse,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengHealth,
  YimengHeroFrameBinding,
  YimengHeroFrameStoryboardShot,
  YimengHeroFrameStoryboardsProjection,
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrRequest,
  YimengPromptIrBootstrapResponse,
  YimengPromptIrResponse,
  YimengReferenceCandidatesRequest,
  YimengReferenceCandidatesResponse,
  YimengReferenceAssetCandidate,
  YimengReferenceRightsRecord,
  YimengReferenceRightsExceptionReleaseFeedRequest,
  YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengReferenceRightsExceptionRelease,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionScope,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengSelectedVideoReviewRequest,
  YimengSelectedVideoReviewResponse,
  YimengSelectedVideoReviewStatus,
  YimengTakeVersion,
  YimengTakeVersionRequest,
  YimengTakePreviewRequest, YimengTakePreviewResponse,
  YimengTakeVersionStackResponse,
  YimengTakeVersionStackSubject,
  YimengTakeComment,
  YimengTakeCommentAnchor,
  YimengTakeCommentFeedResponse,
  YimengTakeCommentRequest,
  YimengTakeCommentSubject,
  YimengTakeCommentVersion,
  YimengTakeReviewAction,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewAuthorityRequest,
  YimengTakeReviewRecommendation,
  YimengTakeHumanDecision,
  YimengTakeAcceptanceRequest,
  YimengTakeAcceptanceResponse,
  YimengTakeAcceptanceEvidence,
  YimengTakeAcceptanceSubject,
  YimengTakeTechnicalQcAssessment,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRequest,
  YimengTakeApprovalLifecycleAssessment,
  YimengTakeApprovalLifecycleDecision,
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRequest,
  YimengTakeApprovalLifecycleSource,
  YimengTakeApprovalLifecycleTransition,
  YimengShotFinding,
  YimengShotFindingPayload,
  YimengShotFindingFeedResponse,
  YimengShotFindingResult,
  YimengShotFindingRecovery,
  YimengShotVideoSubject,
  YimengReworkRouteSourceRequest,
  YimengReworkRouteSourceResponse,
  YimengShotRelationBeat,
  YimengShotRelationElement,
  YimengShotRelationScene,
  YimengShotRelationShot,
  YimengShotRelationsProjection,
  YimengStoryboardCanvas,
  YimengStoryboardCanvasAnnotation,
  YimengStoryboardCanvasAnnotationKind,
  YimengStoryboardCanvasPoint,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
}
export type {
  YimengBindStageSourceRequest,
  YimengRecoverStageSourceBindingRequest,
  YimengStageSourceRecovery,
  YimengBindProductionUnitRequest,
  YimengRecoverProductionUnitBindingRequest,
  YimengProductionUnitResult,
  YimengProductionUnitRecovery,
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengCreateReferenceRightsExceptionReleaseRequest,
  YimengCreateReferenceRightsExceptionReleaseResponse,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengPreviewStoryboardCanvasRequest,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
  YimengProposePromptIrRequest,
  YimengProposePromptIrResponse,
  YimengProposeReferenceAssetRequest,
  YimengProposeReferenceAssetResponse,
  YimengReferenceAssetOperation,
  YimengReferenceActionOperation,
  YimengReferenceCommitElementProfileResponse,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceRightsCommitElementProfileResponse,
  YimengReferenceRightsPreviewElementProfileResponse,
  YimengProposeScriptRequest,
  YimengProposeScriptResponse,
  YimengProposeStoryboardCanvasRequest,
  YimengProposeStoryboardCanvasResponse,
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengBootstrapPromptIrRequest,
  YimengBootstrapPromptIrResponse,
  YimengRecoverPromptIrBootstrapRequest,
  YimengSelectBootstrapPromptIrRequest,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
  YimengRecoverStoryboardCanvasCommitRequest,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengRecoverReferenceRightsExceptionReleaseRequest,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
  YimengRecordShotFindingRequest,
  YimengRecoverShotFindingRequest,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteResult,
  YimengReworkRouteRecovery,
  YimengProbeReworkRouteAuthorityRequest,
  YimengReworkRouteAuthorityProbe,
  YimengSelectTakeVersionRequest,
  YimengRecoverTakeVersionSelectionRequest,
  YimengTakeSelectionIdentity,
  YimengTakeVersionSelectionResult,
  YimengTakeVersionSelectionRecovery,
  YimengCreateTakeCommentRequest,
  YimengRecoverTakeCommentRequest,
  YimengTakeCommentRecord,
  YimengTakeCommentRecovery,
  YimengTakeCommentResult,
  YimengCreateTakeReviewRecommendationRequest,
  YimengRecoverTakeReviewRecommendationRequest,
  YimengTakeReviewRecommendationRecord,
  YimengTakeReviewRecommendationRecovery,
  YimengTakeReviewRecommendationResult,
  YimengCreateTakeHumanDecisionRequest,
  YimengRecoverTakeHumanDecisionRequest,
  YimengTakeHumanDecisionRecord,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengRecordTakeTechnicalQcRequest,
  YimengRecoverTakeTechnicalQcRequest,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
  YimengRecoverTakeApprovalLifecycleTransitionRequest,
  YimengTakeApprovalLifecycleAction,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTransitionTakeApprovalLifecycleRequest,
  YimengProductionTakeResult,
  YimengQueueProductionTakeIntent,
}

/** Open JSON object retained without inventing a stricter Yimeng business schema. */
export type JsonRecord = YimengJsonObject

/** Kept local until the workspace read-adapter declaration build is refreshed. */
export interface YimengVideoQuoteRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
}

/** Writer-authored zero-dispatch quote and exact confirmation text for one video Take. */
export interface YimengVideoQuoteResponse {
  readonly schema: 'jason.qingmu-writer-video-quote.v1'
  readonly preflightSha256: string
  readonly projectionSha256: string
  readonly maximumReservationCny: number
  readonly candidateCount: 1
  readonly maxAttempts: 1
  readonly selectAsOfficial: false
  readonly quoteReady: boolean
  readonly dispatchReady: boolean
  readonly quoteBlockers: readonly string[]
  readonly dispatchBlockers: readonly string[]
  readonly requiredPaidConfirmationText: string
  readonly requiredPaidConfirmationTextSha256: string
}

/** Browser intent for queueing one bounded Take against a current selected first frame and quote. */
export interface QingmuProductionTakeIntent extends Omit<YimengQueueProductionTakeIntent,
  'firstFrameSelectionReceiptSha256' | 'selectedFirstFrameAssetId' | 'selectedFirstFrameMaterializedSha256'
  | 'videoPreflightSha256' | 'videoQuoteProjectionSha256' | 'maximumReservationCny' | 'candidateCount'
  | 'maxAttempts' | 'selectAsOfficial' | 'paidConfirmed' | 'paidConfirmationText'> {
  readonly firstFrameSelectionReceiptSha256: string
  readonly selectedFirstFrameAssetId: string
  readonly selectedFirstFrameMaterializedSha256: string
  readonly videoPreflightSha256: string
  readonly videoQuoteProjectionSha256: string
  readonly maximumReservationCny: number
  readonly candidateCount: 1
  readonly maxAttempts: 1
  readonly selectAsOfficial: false
  readonly paidConfirmed: true
  readonly paidConfirmationText: string
}

/** Read-only browser-facing methods exposed by the Qingmu Host adapter. */
export interface QingmuYimengReadPort {
  captureReferenceVideoFrame(request: ReferenceVideoFrameRequest, signal?: AbortSignal): Promise<ReferenceVideoFrameReceipt>
  readReferenceVideoFrame(request: ReferenceVideoFrameRequest, signal?: AbortSignal): Promise<ReferenceVideoFrameReceipt>
  registerReferenceVideoCandidateForReview(
    request: ReferenceVideoCandidateRegistrationRequest, signal?: AbortSignal,
  ): Promise<ReferenceVideoCandidateRegistration>
  readReferenceVideoCandidateRegistration(
    request: ReferenceVideoCandidateRegistrationRequest, signal?: AbortSignal,
  ): Promise<ReferenceVideoCandidateRegistration>
  readReferenceVideoMaterials(request: ReferenceVideoMaterialsRequest, signal?: AbortSignal): Promise<ReferenceVideoMaterialsState>
  prepareReferenceVideoMaterial(
    request: PrepareReferenceVideoMaterialRequest, signal?: AbortSignal,
  ): Promise<ReferenceVideoMaterialPreparationResult>
  referenceVideoRuns(request: { projectId: string; frameId: string }, signal?: AbortSignal): Promise<ReferenceVideoRunsResponse>
  referenceVideoAssets(request: ReferenceVideoAssetsRequest, signal?: AbortSignal): Promise<ReferenceVideoAssetsResponse>
  referenceVideoPreview(request: ReferenceVideoPreviewRequest, signal?: AbortSignal): Promise<ReferenceVideoPreviewResponse>
  referenceVideoQuote(request: ReferenceVideoQuoteRequest, signal?: AbortSignal): Promise<ReferenceVideoQuoteResponse>
  referenceVideoDraft(request: { projectId: string; frameId: string }, signal?: AbortSignal): Promise<ReferenceVideoDraftResponse>
  evidenceLedger(request: YimengEpisodeEvidenceRequest, signal?: AbortSignal): Promise<YimengEpisodeEvidenceLedgerResponse>
  editorialHandoff(request: YimengEditorialHandoffRequest, signal?: AbortSignal): Promise<YimengEditorialHandoffResponse>
  verifyEpisode(request: YimengEpisodeVerificationRequest, signal?: AbortSignal): Promise<YimengEpisodeVerificationResponse>
  capabilityCatalog(
    request: YimengCapabilityCatalogRequest,
    signal?: AbortSignal,
  ): Promise<YimengCapabilityCatalogResponse>
  costRehearsal(
    request: YimengCostRehearsalRequest,
    signal?: AbortSignal,
  ): Promise<YimengCostRehearsalResponse>
  gateAControlEvidence(
    request: Record<string, never>,
    signal?: AbortSignal,
  ): Promise<YimengGateAControlEvidenceResponse>
  stageSources(request: YimengStageSourcesRequest, signal?: AbortSignal): Promise<YimengStageSourcesResponse>
  productionUnits(request: YimengProductionUnitsRequest, signal?: AbortSignal): Promise<YimengProductionUnitsResponse>
  health(signal?: AbortSignal): Promise<YimengHealth>
  projects(request: YimengProjectsRequest, signal?: AbortSignal): Promise<YimengProjectsResponse>
  updateProject(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectUpdateRequest, signal?: AbortSignal): Promise<JsonRecord>
  previewProjectCopy(request: { readonly sourceProjectId: string }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectCopyPreview>
  copyProject(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectCopyRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectCopyResult>
  episodes(request: YimengEpisodesRequest, signal?: AbortSignal): Promise<YimengEpisodesResponse>
  elementProfile(request: YimengElementProfileRequest, signal?: AbortSignal): Promise<YimengElementProfileResponse>
  referenceCandidates(request: YimengReferenceCandidatesRequest, signal?: AbortSignal): Promise<YimengReferenceCandidatesResponse>
  reviewEvents(request: YimengElementReviewFeedRequest, signal?: AbortSignal): Promise<YimengElementReviewFeedResponse>
  referenceRightsExceptionReleases(
    request: YimengReferenceRightsExceptionReleaseFeedRequest,
    signal?: AbortSignal,
  ): Promise<YimengReferenceRightsExceptionReleaseFeedResponse>
  script(request: YimengScriptRequest, signal?: AbortSignal): Promise<YimengScriptResponse>
  promptIr(request: YimengPromptIrRequest, signal?: AbortSignal): Promise<YimengPromptIrResponse>
  promptIrBootstrap(request: YimengPromptIrRequest, signal?: AbortSignal): Promise<YimengPromptIrBootstrapResponse>
  firstFrameQuote(
    request: YimengFirstFrameQuoteRequest,
    signal?: AbortSignal,
  ): Promise<YimengFirstFrameQuoteResponse>
  videoQuote(request: YimengVideoQuoteRequest, signal?: AbortSignal): Promise<YimengVideoQuoteResponse>
  selectedVideoReview(request: YimengSelectedVideoReviewRequest, signal?: AbortSignal): Promise<YimengSelectedVideoReviewResponse>
  takeVersions(request: YimengTakeVersionRequest, signal?: AbortSignal): Promise<YimengTakeVersionStackResponse>
  takePreview(request: YimengTakePreviewRequest, signal?: AbortSignal): Promise<YimengTakePreviewResponse>
  takeComments(request: YimengTakeCommentRequest, signal?: AbortSignal): Promise<YimengTakeCommentFeedResponse>
  takeReviewAuthority(
    request: YimengTakeReviewAuthorityRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeReviewAuthorityFeedResponse>
  takeAcceptance(request: YimengTakeAcceptanceRequest, signal?: AbortSignal): Promise<YimengTakeAcceptanceResponse>
  takeTechnicalQc(
    request: YimengTakeTechnicalQcRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeTechnicalQcFeedResponse>
  takeApprovalLifecycle(
    request: YimengTakeApprovalLifecycleRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeApprovalLifecycleFeedResponse>
  shotFindings(request: YimengSelectedVideoReviewRequest, signal?: AbortSignal): Promise<YimengShotFindingFeedResponse>
  reworkRouteSource(request: YimengReworkRouteSourceRequest, signal?: AbortSignal): Promise<YimengReworkRouteSourceResponse>
  workflow(request: YimengWorkflowRequest, signal?: AbortSignal): Promise<YimengWorkflowProjection>
}

/** Explicit ChangeSet commands exposed through the separate Host-only command channel. */
export interface QingmuYimengCommandPort {
  queueReferenceVideo(request: QueueReferenceVideoRequest, signal?: AbortSignal): Promise<ReferenceVideoRun>
  saveReferenceVideoDraft(request: SaveReferenceVideoDraftRequest, signal?: AbortSignal): Promise<ReferenceVideoDraftResponse>
  queueProductionTake(
    request: QingmuProductionTakeIntent,
    signal?: AbortSignal,
  ): Promise<YimengProductionTakeResult>
  readCreativeContract(request: { readonly projectId: string }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').CreativeContractState>
  readDirectorProviderAvailability(
    request: { readonly projectId: string; readonly episodeId: string },
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorPaidAvailability>
  issueDirectorProviderWorkOrder(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorPaidWorkOrderRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorPaidWorkOrder>
  readDirectorProviderWorkOrderStatus(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorPaidWorkOrderStatusRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorPaidWorkOrderStatus>
  requestDirectorProposal(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorProposalRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorReplayProposal>
  checkDirectorProposalFreshness(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorProposalFreshnessRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').DirectorProposalFreshnessResult>
  listLocalReferenceCandidates(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceScope,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceCandidateList>
  uploadLocalReferenceCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceUploadRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceCandidateResult>
  recoverLocalReferenceCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceUploadRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceCandidateResult>
  readLocalReferenceCandidateContent(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceContentRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceCandidateContent>
  readLocalVideoSource(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceScope,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceState>
  registerLocalVideoSource(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceResult>
  recoverLocalVideoSource(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceRecoveryRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoSourceResult>
  uploadLocalVideoCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoUploadRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoCandidateResult>
  recoverLocalVideoCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoRecoveryRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVideoCandidateResult>
  uploadLocalVoiceCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceUploadRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceCandidateResult>
  recoverLocalVoiceCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceUploadRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceCandidateResult>
  readLocalVoiceCandidateContent(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceContentRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalVoiceCandidateContent>
  qualifyLocalReferenceCandidate(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceQualificationRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceQualificationResult>
  recoverLocalReferenceQualification(
    request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceQualificationRequest,
    signal?: AbortSignal,
  ): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').LocalReferenceQualificationResult>
  bindStageSource(request: YimengBindStageSourceRequest, signal?: AbortSignal): Promise<YimengStageSourceResult>
  recoverStageSourceBinding(request: YimengRecoverStageSourceBindingRequest, signal?: AbortSignal): Promise<YimengStageSourceRecovery>
  bindProductionUnit(request: YimengBindProductionUnitRequest, signal?: AbortSignal): Promise<YimengProductionUnitResult>
  recoverProductionUnitBinding(
    request: YimengRecoverProductionUnitBindingRequest, signal?: AbortSignal,
  ): Promise<YimengProductionUnitRecovery>
  recordShotFinding(request: YimengRecordShotFindingRequest, signal?: AbortSignal): Promise<YimengShotFindingResult>
  recoverShotFinding(request: YimengRecoverShotFindingRequest, signal?: AbortSignal): Promise<YimengShotFindingRecovery>
  selectTakeVersion(
    request: YimengSelectTakeVersionRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeVersionSelectionResult>
  recoverTakeVersionSelection(
    request: YimengRecoverTakeVersionSelectionRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeVersionSelectionRecovery>
  createTakeComment(
    request: YimengCreateTakeCommentRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeCommentResult>
  recoverTakeComment(
    request: YimengRecoverTakeCommentRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeCommentRecovery>
  createTakeReviewRecommendation(
    request: YimengCreateTakeReviewRecommendationRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeReviewRecommendationResult>
  recoverTakeReviewRecommendation(
    request: YimengRecoverTakeReviewRecommendationRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeReviewRecommendationRecovery>
  createTakeHumanDecision(
    request: YimengCreateTakeHumanDecisionRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeHumanDecisionResult>
  recoverTakeHumanDecision(
    request: YimengRecoverTakeHumanDecisionRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeHumanDecisionRecovery>
  recordTakeTechnicalQc(
    request: YimengRecordTakeTechnicalQcRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeTechnicalQcResult>
  recoverTakeTechnicalQc(
    request: YimengRecoverTakeTechnicalQcRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeTechnicalQcRecovery>
  transitionTakeApprovalLifecycle(
    request: YimengTransitionTakeApprovalLifecycleRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeApprovalLifecycleResult>
  recoverTakeApprovalLifecycleTransition(
    request: YimengRecoverTakeApprovalLifecycleTransitionRequest,
    signal?: AbortSignal,
  ): Promise<YimengTakeApprovalLifecycleRecovery>
  recordReworkRoute(request: YimengRecordReworkRouteRequest, signal?: AbortSignal): Promise<YimengReworkRouteResult>
  recoverReworkRoute(request: YimengRecordReworkRouteRequest, signal?: AbortSignal): Promise<YimengReworkRouteRecovery>
  probeReworkRouteAuthority(
    request: YimengProbeReworkRouteAuthorityRequest,
    signal?: AbortSignal,
  ): Promise<YimengReworkRouteAuthorityProbe>
  proposeElementProfile(request: YimengProposeElementProfileRequest, signal?: AbortSignal): Promise<YimengProposeElementProfileResponse>
  proposeReferenceAsset(request: YimengProposeReferenceAssetRequest, signal?: AbortSignal): Promise<YimengProposeReferenceAssetResponse>
  previewElementProfile(request: YimengPreviewElementProfileRequest, signal?: AbortSignal): Promise<YimengPreviewElementProfileResponse>
  commitElementProfile(
    request: YimengCommitElementProfileRequest,
    signal?: AbortSignal,
  ): Promise<YimengCommitElementProfileResponse>
  recoverElementProfileCommit(
    request: YimengRecoverElementProfileCommitRequest,
    signal?: AbortSignal,
  ): Promise<YimengRecoverElementProfileCommitResponse>
  createComment(request: YimengCreateCommentRequest, signal?: AbortSignal): Promise<YimengCreateCommentResponse>
  createHumanDecision(
    request: YimengCreateHumanDecisionRequest,
    signal?: AbortSignal,
  ): Promise<YimengCreateHumanDecisionResponse>
  createReferenceRightsExceptionRelease(
    request: YimengCreateReferenceRightsExceptionReleaseRequest,
    signal?: AbortSignal,
  ): Promise<YimengCreateReferenceRightsExceptionReleaseResponse>
  recoverReferenceRightsExceptionRelease(
    request: YimengRecoverReferenceRightsExceptionReleaseRequest,
    signal?: AbortSignal,
  ): Promise<YimengRecoverReferenceRightsExceptionReleaseResponse>
  proposeScript(request: YimengProposeScriptRequest, signal?: AbortSignal): Promise<YimengProposeScriptResponse>
  /** Load candidate choices and retained local MP4 cuts. */
  readWorkingCut(request: CreationScope, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutState>
  /** Queue or recover advisory sound observations for an exact rendered cut. */
  reviewWorkingCutSound(request: CreationScope & { command: { revisionId: string; assetId: string; sha256: string } }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutState>
  /** Save an ordered cut and queue one recoverable local render. */
  renderWorkingCut(request: CreationScope & { command: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutCommand }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutState>
  /** Save an editable cut without rendering or paid generation. */
  saveWorkingCut(request: CreationScope & { command: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutCommand }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutState>
  /** Import a bounded local music, ambience, effect or dialogue source. */
  uploadWorkingCutAudio(request: CreationScope & { command: { filename: string; contentBase64: string } | { presetId: string } }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').WorkingCutState>
  readAssetDesign(request: CreationScope, signal?: AbortSignal): Promise<AssetDesignState>
  /** Render authored scene volumes locally; this neither saves nor generates media. */
  previewSceneLayout(request: CreationScope & { imageObjectStates?: readonly import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ImageObjectState[] | null; layout: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').SceneLayout; camera: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ImageCamera; ratio: string }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').SceneLayoutPreview>
  saveAssetDesign(request: CreationScope & { expectedStateSha256: string; design: AssetDesign },
    signal?: AbortSignal): Promise<AssetDesignState>
  quoteAssetImage(request: CreationScope & { entityId: string }, signal?: AbortSignal): Promise<AssetImageQuote>
  quoteAssetVoice(request: CreationScope & { entityId: string }, signal?: AbortSignal): Promise<AssetImageQuote>
  generateAssetImage(request: CreationScope & { entityId: string; command: AssetImageCommand },
    signal?: AbortSignal): Promise<AssetImageSubmission>
  generateAssetVoice(request: CreationScope & { entityId: string; command: AssetImageCommand },
    signal?: AbortSignal): Promise<AssetImageSubmission>
  readAssetImageRuns(request: CreationScope, signal?: AbortSignal): Promise<AssetImageRuns>
  readAssetVoiceRuns(request: CreationScope, signal?: AbortSignal): Promise<AssetImageRuns>
  readScenePlanning(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').CreationScope, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ScenePlanningState>
  saveScenePlanning(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ScenePlanningRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ScenePlanningResult>
  recoverScenePlanning(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ScenePlanningRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ScenePlanningResult>
  /** Read the same composed preset used for subsequent authoring. */
  readStyleComposition(request: { readonly style: string; readonly stylePackId: string }, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').CreativeVisualSettings>
  readCreationOptions(request: Record<string, never>, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').CreationOptions>
  initializeProject(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectInitializationRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectInitializationResult>
  recoverProjectInitialization(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectInitializationRecovery, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').ProjectInitializationResult>
  readTextImport(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportReadRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportState>
  createTextImport(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportDraft>
  correctTextImport(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportCorrection, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportDraft>
  confirmTextImport(request: import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportConfirmationRequest, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').TextImportConfirmation>
  previewScript(request: YimengPreviewScriptRequest, signal?: AbortSignal): Promise<YimengPreviewScriptResponse>
  commitScript(request: YimengCommitScriptRequest, signal?: AbortSignal): Promise<YimengCommitScriptResponse>
  recoverScriptCommit(request: YimengRecoverScriptCommitRequest, signal?: AbortSignal): Promise<YimengRecoverScriptCommitResponse>
  proposePromptIr(request: YimengProposePromptIrRequest, signal?: AbortSignal): Promise<YimengProposePromptIrResponse>
  previewPromptIr(request: YimengPreviewPromptIrRequest, signal?: AbortSignal): Promise<YimengPreviewPromptIrResponse>
  commitPromptIrEdit(
    request: YimengCommitPromptIrEditRequest,
    signal?: AbortSignal,
  ): Promise<YimengCommitPromptIrEditResponse>
  recoverPromptIrEditCommit(
    request: YimengRecoverPromptIrEditCommitRequest,
    signal?: AbortSignal,
  ): Promise<YimengRecoverPromptIrEditCommitResponse>
  selectPromptIr(request: YimengSelectPromptIrRequest, signal?: AbortSignal): Promise<YimengSelectPromptIrResponse>
  recoverPromptIrSelection(
    request: YimengRecoverPromptIrSelectionRequest,
    signal?: AbortSignal,
  ): Promise<YimengRecoverPromptIrSelectionResponse>
  bootstrapPromptIr(request: YimengBootstrapPromptIrRequest, signal?: AbortSignal): Promise<YimengBootstrapPromptIrResponse>
  recoverPromptIrBootstrap(
    request: YimengRecoverPromptIrBootstrapRequest,
    signal?: AbortSignal,
  ): Promise<YimengBootstrapPromptIrResponse>
  selectBootstrapPromptIr(
    request: YimengSelectBootstrapPromptIrRequest,
    signal?: AbortSignal,
  ): Promise<YimengSelectPromptIrResponse>
  proposeStoryboardCanvas(
    request: YimengProposeStoryboardCanvasRequest,
    signal?: AbortSignal,
  ): Promise<YimengProposeStoryboardCanvasResponse>
  previewStoryboardCanvas(
    request: YimengPreviewStoryboardCanvasRequest,
    signal?: AbortSignal,
  ): Promise<YimengPreviewStoryboardCanvasResponse>
  commitStoryboardCanvas(
    request: YimengCommitStoryboardCanvasRequest,
    signal?: AbortSignal,
  ): Promise<YimengCommitStoryboardCanvasResponse>
  recoverStoryboardCanvasCommit(
    request: YimengRecoverStoryboardCanvasCommitRequest,
    signal?: AbortSignal,
  ): Promise<YimengRecoverStoryboardCanvasCommitResponse>
}

/** Read-only, stateless professional method compiler channel. */
export interface QingmuImagoMethodPort {
  stageSourceMethod(request: ImagoStageSourceMethodRequest, signal?: AbortSignal): Promise<ImagoStageSourceMethodResponse>
  productionUnitMethod(request: ImagoProductionUnitMethodRequest, signal?: AbortSignal): Promise<ImagoProductionUnitMethodResponse>
  shotFindingMethod(request: ImagoShotFindingMethodRequest, signal?: AbortSignal): Promise<ImagoShotFindingMethodResponse>
  reworkRouteMethod(request: ImagoReworkRouteMethodRequest, signal?: AbortSignal): Promise<ImagoReworkRouteMethodResponse>
  continuityMethod(request: ImagoContinuityMethodRequest, signal?: AbortSignal): Promise<ImagoContinuityMethodResponse>
  worksetMethod(request: ImagoWorksetMethodRequest, signal?: AbortSignal): Promise<ImagoWorksetMethodResponse>
  elementMethod(request: ImagoElementMethodRequest, signal?: AbortSignal): Promise<ImagoElementMethodResponse>
  referenceAssetMethod(request: ImagoReferenceAssetMethodRequest, signal?: AbortSignal): Promise<ImagoReferenceAssetMethodResponse>
  promptIrMethod(request: ImagoPromptIrMethodRequest, signal?: AbortSignal): Promise<ImagoPromptIrMethodResponse>
  promptIrBootstrapMethod(
    request: ImagoPromptIrBootstrapMethodRequest,
    signal?: AbortSignal,
  ): Promise<ImagoPromptIrBootstrapMethodResponse>
  shotRelationMethod(request: ImagoShotRelationMethodRequest, signal?: AbortSignal): Promise<ImagoShotRelationMethodResponse>
  heroFrameStoryboardMethod(
    request: ImagoHeroFrameStoryboardMethodRequest,
    signal?: AbortSignal,
  ): Promise<ImagoHeroFrameStoryboardMethodResponse>
  takeAcceptanceMethod(
    request: ImagoTakeAcceptanceMethodRequest,
    signal?: AbortSignal,
  ): Promise<ImagoTakeAcceptanceMethodResponse>
  takeApprovalLifecycleMethod(
    request: ImagoTakeApprovalLifecycleMethodRequest,
    signal?: AbortSignal,
  ): Promise<ImagoTakeApprovalLifecycleMethodResponse>
}

/** Browser-facing Qingmu port. All three Host plugins remain independently pluggable. */
export interface QingmuYimengPort extends QingmuYimengReadPort, QingmuYimengCommandPort, QingmuImagoMethodPort {}

interface RpcFailure {
  readonly code?: unknown
  readonly message?: unknown
}

/**
 * Convert the Connection carrier's result union into the port's promise contract.
 *
 * @param result Opaque RPC carrier returned by the Client Connection.
 * @returns The successful opaque payload for validation by the typed caller.
 */
export function unwrapRpc(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || !('ok' in result)) {
    throw new Error('青木易梦适配器返回了无法识别的结果')
  }
  const answer = result as { readonly ok: unknown; readonly value?: unknown; readonly error?: RpcFailure }
  if (answer.ok === true) return answer.value
  const code = typeof answer.error?.code === 'string' ? answer.error.code : 'internal'
  const message = typeof answer.error?.message === 'string' ? answer.error.message : '易梦请求失败'
  throw new Error(`${code}: ${message}`)
}
