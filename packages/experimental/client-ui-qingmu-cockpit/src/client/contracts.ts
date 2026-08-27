/** Stable Client-side view of the private Yimeng read-adapter RPC contract. */
import type {
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodResponse,
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
  YimengJsonObject,
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrRequest,
  YimengPromptIrResponse,
  YimengReferenceCandidatesRequest,
  YimengReferenceCandidatesResponse,
  YimengReferenceAssetCandidate,
  YimengReferenceRightsRecord,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
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
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

export type {
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodResponse,
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
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrRequest,
  YimengPromptIrResponse,
  YimengReferenceCandidatesRequest,
  YimengReferenceCandidatesResponse,
  YimengReferenceAssetCandidate,
  YimengReferenceRightsRecord,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
}
export type {
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
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
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
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
  script(request: YimengScriptRequest, signal?: AbortSignal): Promise<YimengScriptResponse>
  promptIr(request: YimengPromptIrRequest, signal?: AbortSignal): Promise<YimengPromptIrResponse>
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
}

/** Read-only, stateless professional method compiler channel. */
export interface QingmuImagoMethodPort {
  elementMethod(request: ImagoElementMethodRequest, signal?: AbortSignal): Promise<ImagoElementMethodResponse>
  referenceAssetMethod(request: ImagoReferenceAssetMethodRequest, signal?: AbortSignal): Promise<ImagoReferenceAssetMethodResponse>
  promptIrMethod(request: ImagoPromptIrMethodRequest, signal?: AbortSignal): Promise<ImagoPromptIrMethodResponse>
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
