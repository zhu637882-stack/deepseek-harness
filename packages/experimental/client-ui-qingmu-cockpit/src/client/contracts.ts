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
}

/** Open JSON object retained without inventing a stricter Yimeng business schema. */
export type JsonRecord = YimengJsonObject

/** Read-only browser-facing methods exposed by the Qingmu Host adapter. */
export interface QingmuYimengReadPort {
  evidenceLedger(request: YimengEpisodeEvidenceRequest, signal?: AbortSignal): Promise<YimengEpisodeEvidenceLedgerResponse>
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
