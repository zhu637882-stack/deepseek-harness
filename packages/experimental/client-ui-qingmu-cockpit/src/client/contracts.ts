/** Stable Client-side view of the private Yimeng read-adapter RPC contract. */
import type {
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
  ImagoWorksetMethodRequest,
  ImagoWorksetMethodResponse,
  ImagoWorksetProjection,
} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type {
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
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export type {
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
  ImagoWorksetMethodRequest,
  ImagoWorksetMethodResponse,
  ImagoWorksetProjection,
}
export type {
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
}

/** Open JSON object retained without inventing a stricter Yimeng business schema. */
export type JsonRecord = YimengJsonObject

/** Read-only browser-facing methods exposed by the Qingmu Host adapter. */
export interface QingmuYimengReadPort {
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
  workflow(request: YimengWorkflowRequest, signal?: AbortSignal): Promise<YimengWorkflowProjection>
}

/** Explicit ChangeSet commands exposed through the separate Host-only command channel. */
export interface QingmuYimengCommandPort {
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
