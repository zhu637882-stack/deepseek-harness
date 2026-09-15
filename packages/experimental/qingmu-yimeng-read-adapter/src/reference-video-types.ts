/** Stable references for an explicitly authored video request. */
export interface ReferenceVideoBinding {
  readonly bindingToken: string
  readonly assetId: string
  readonly assetSha256: string
  readonly label: string
  /** Explicit image endpoint; omission keeps the existing multimodal reference route. */
  readonly frameRole?: 'first_frame' | 'last_frame'
}

/** Text stays verbatim; reference parts resolve through stable binding tokens. */
export type ReferenceVideoPromptPart = { readonly text: string } | { readonly bindingToken: string }

/** Explicit model controls shared by the editor and read-only compiler. */
export interface ReferenceVideoParameters {
  readonly duration: number
  readonly resolution: '480P' | '720P' | '1080P'
  readonly ratio: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  readonly audio: boolean
  readonly prompt_extend: boolean
  readonly seed?: number
}

/** Latest authored design and style sources; this is not a quality verdict. */
export interface ReferenceDirectorSource {
  readonly sha256: string
  readonly prompt: string
  /** Editable production text; excludes adjacent-shot research and media metadata. */
  readonly generationPrompt?: string
}

/** Project-owned source versions; callers cannot supply transport URLs. */
export interface ReferenceVideoPreviewRequest {
  readonly projectId: string
  readonly frameId: string
  readonly model: 'wan3.0-video'
  readonly bindings: readonly ReferenceVideoBinding[]
  readonly promptParts: readonly ReferenceVideoPromptPart[]
  /** Director preparation notes; retained in the draft hash, excluded from the provider prompt. */
  readonly preparationFeedback?: string
  readonly directorSourceSha256?: string
  readonly parameters: ReferenceVideoParameters
}

/** Provider request and source mapping for inspection, never a submission receipt. */
export interface ReferenceVideoPreviewResponse {
  readonly schema: 'jason.reference-video-request-preview.v1'
  readonly projectId: string
  readonly frameId: string
  readonly body: {
    readonly model: 'wan3.0-video'
    readonly input: {
      readonly prompt: string
      readonly media: readonly {
        readonly type: 'reference_image' | 'reference_audio' | 'reference_video' | 'first_frame' | 'last_frame'
        readonly url: string
      }[]
    }
    readonly parameters: ReferenceVideoParameters & { readonly watermark: false }
  }
  readonly referenceMapping: readonly (ReferenceVideoBinding & {
    readonly alias: string
    readonly mediaIndex: number
    readonly mediaType: 'reference_image' | 'reference_audio' | 'reference_video' | 'first_frame' | 'last_frame'
  })[]
  readonly requestBodySha256: string
  readonly sourceSha256: string
  readonly readOnly: true
  readonly databaseWrites: 0
  readonly providerCalls: 0
  readonly submissionReady: false
  readonly remainingChecks: readonly string[]
  readonly referenceAudioDurationSec: number
  /** Inspected input-video seconds; absent for existing image/voice-only requests. */
  readonly referenceVideoDurationSec?: number
  readonly directorSource: ReferenceDirectorSource | null
  readonly directorSourceAligned: boolean
}

/** Paginated project assets available for explicit draft references. */
export interface ReferenceVideoAssetsRequest { readonly projectId: string; readonly page: number }

/** Asset metadata is a selectable draft source, without implying creative approval. */
export interface ReferenceVideoAsset {
  readonly assetId: string
  readonly assetSha256: string
  readonly label: string
  readonly mediaType: 'reference_image' | 'reference_audio' | 'reference_video'
  readonly browserUrl: string
  /** Catalog duration for planning; absence is unknown, and submission re-probes the source bytes. */
  readonly durationSec?: number
  /** Frozen generation intent, not a claim about the actual pixels or current scene design. */
  readonly imageDesign?: import('./reference-image-design.ts').ReferenceImageDesign
  /** Reported catalog provenance; selection and QC do not establish current creative acceptance. */
  readonly source?: {
    readonly ownerType?: string
    readonly ownerId?: string
    readonly role?: string
    readonly selected?: boolean
    readonly selectionStatus?: string
    readonly qualityStatus?: string
    readonly humanReviewStatus?: string
  }
  /** Local candidate bytes remain private and can only be read through this owner scope. */
  readonly localReferenceScope?: {
    readonly elementKind: 'actor' | 'scene' | 'prop'
    readonly targetId: string
  }
  /** A local WAV reference belongs to this actor; it is not an enrolled Provider voice. */
  readonly localVoiceScope?: { readonly targetId: string }
}

/** A filtered page retains upstream pagination across other media types. */
export interface ReferenceVideoAssetsResponse {
  readonly projectId: string
  readonly page: number
  readonly pages: number
  readonly items: readonly ReferenceVideoAsset[]
}

/** One shot's persisted working draft, without a production selection. */
export interface ReferenceVideoDraftResponse {
  readonly schema: 'jason.reference-video-draft.v1'
  readonly projectId: string
  readonly frameId: string
  readonly frameSha256: string
  readonly directorSource: ReferenceDirectorSource | null
  readonly draft: null | {
    readonly revision: number
    readonly frameSha256: string
    readonly requestSha256: string
    readonly request: Omit<ReferenceVideoPreviewRequest, 'projectId'>
    readonly savedAt: string
  }
  readonly mediaTypes: Readonly<Record<string, 'reference_image' | 'reference_audio' | 'reference_video' | null>>
  readonly providerCalls: 0
  readonly generationQueued: false
}

/** Optimistic save also binds the shot source read by the editor. */
export interface SaveReferenceVideoDraftRequest {
  readonly projectId: string
  readonly frameId: string
  readonly expectedRevision: number
  readonly expectedFrameSha256: string
  readonly request: Omit<ReferenceVideoPreviewRequest, 'projectId'>
}

/** The displayed editor must still match this persisted version before pricing. */
export interface ReferenceVideoQuoteRequest extends ReferenceVideoPreviewRequest {
  readonly draftRevision: number
  readonly draftRequestSha256: string
}

/** Read-only list-price estimate bound to the actual saved request. */
export interface ReferenceVideoQuoteResponse {
  readonly schema: 'jason.reference-video-quote.v1'
  readonly projectId: string
  readonly frameId: string
  readonly draftRevision: number
  readonly draftRequestSha256: string
  readonly sourceSha256: string
  readonly quoteSha256: string
  /** Runtime availability only; a separate current-price confirmation is still required. */
  readonly generationSubmissionEnabled: boolean
  readonly preview: ReferenceVideoPreviewResponse
  readonly cost: {
    readonly provider: 'dashscope'
    readonly region: 'cn-beijing'
    readonly currency: 'CNY'
    readonly basis: 'catalog_list_price'
    readonly unit: 'second'
    readonly unitPriceCny: string
    readonly billableSeconds: number
    readonly estimatedCny: string
    readonly candidateCount: 1
    readonly maxAttempts: 1
    readonly accountDiscountApplied: false
    readonly pricingSha256: string
    readonly pricingCheckedAt: string
    readonly sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing'
  }
  readonly readOnly: true
  readonly providerCalls: 0
  readonly databaseWrites: 0
  readonly budgetReservedCny: 0
  readonly generationQueued: false
}

/** One explicitly confirmed candidate request; replay uses this same identifier. */
export interface QueueReferenceVideoRequest {
  readonly projectId: string
  readonly frameId: string
  readonly requestId: string
  readonly expectedRevision: number
  readonly expectedRequestSha256: string
  readonly quoteSha256: string
  readonly authorizationCapCny: string
  readonly paidConfirmed: true
}

/** Queue state and technically decoded candidates, without creative adoption. */
export interface ReferenceVideoRun {
  readonly schema: 'jason.reference-video-run.v1'
  readonly projectId: string
  readonly frameId: string
  readonly runId: string
  readonly taskId: string
  readonly kernelStatus: string
  readonly publicStatus: 'queued' | 'running' | 'succeeded' | 'failed' | 'quarantined'
  readonly providerTaskId: string | null
  readonly errorCode: string | null
  readonly draftRevision: number
  readonly quoteSha256: string
  readonly authorizationCapCny: string
  readonly candidates: readonly {
    readonly assetId: string
    readonly assetSha256: string
    readonly mediaId: string | null
    readonly browserUrl: string
    readonly reviewStatus: 'pending'
  }[]
  /** HTTP calls made by this read/queue endpoint, excluding the asynchronous Worker. */
  readonly providerCalls: 0
  readonly selectionChanged: false
}

/** The latest twenty runs remain discoverable after a reload or lost response. */
export interface ReferenceVideoRunsResponse {
  readonly schema: 'jason.reference-video-runs.v1'
  readonly projectId: string
  readonly frameId: string
  readonly items: readonly ReferenceVideoRun[]
  readonly providerCalls: 0
}

/** Saved revision whose local references are being prepared for Alibaba. */
export interface ReferenceVideoMaterialsRequest {
  readonly projectId: string
  readonly frameId: string
  readonly expectedRevision: number
  readonly expectedRequestSha256: string
}

/** Explicit one-file upload intent; no video generation or asset adoption. */
export interface PrepareReferenceVideoMaterialRequest extends ReferenceVideoMaterialsRequest {
  readonly assetId: string
  readonly requestId: string
}

/** Durable preparation state of the exact image/audio versions in a saved shot. */
export interface ReferenceVideoMaterialsState {
  readonly schema: 'jason.reference-video-materials.v1'
  readonly projectId: string
  readonly frameId: string
  readonly draftRevision: number
  readonly draftRequestSha256: string
  readonly model: 'wan3.0-video'
  readonly materials: readonly {
    readonly bindingToken: string
    readonly assetId: string
    readonly assetSha256: string
    readonly mediaType: 'reference_image' | 'reference_audio' | 'reference_video'
    readonly status: 'not_prepared' | 'uploading' | 'unknown' | 'failed' | 'expired' | 'ready'
    readonly expiresAt: number | null
    readonly failureCode: string | null
  }[]
  readonly configured: boolean
  readonly configurationError: string | null
  readonly allReady: boolean
  readonly providerCalls: 0
  readonly databaseWrites: 0
  readonly generationQueued: false
}

/** Acknowledgement of an explicit material upload request. */
export interface ReferenceVideoMaterialPreparationResult extends Omit<ReferenceVideoMaterialsState, 'providerCalls' | 'databaseWrites'> {
  readonly uploadAttempts: number
  readonly modelCalls: 0
  readonly localStateChanged: boolean
  readonly requestId: string
  readonly assetId: string
}

/** Exact generated output to register in the existing shot review stack. */
export interface ReferenceVideoCandidateRegistrationRequest {
  readonly projectId: string
  readonly frameId: string
  readonly runId: string
  readonly assetId: string
  readonly expectedAssetSha256: string
}

/** Playback position and exact video bytes to capture locally. */
export interface ReferenceVideoFrameRequest extends ReferenceVideoCandidateRegistrationRequest {
  readonly timestampMs: number
}

/** Recoverable image reference; capture does not select or approve the source. */
export interface ReferenceVideoFrameReceipt {
  readonly schema: 'qingmu.reference-video-frame.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly runId: string
  readonly assetId: string
  readonly assetSha256: string
  readonly requestedTimestampMs: number
  readonly image: null | {
    readonly assetId: string
    readonly assetSha256: string
    readonly width: number
    readonly height: number
    readonly actualTimestampMs: number
  }
  readonly providerCalls: 0
  readonly selectionChanged: false
}
/** Registration retains source lineage; it grants no selection or approval. */
export interface ReferenceVideoCandidateRegistration {
  readonly schema: 'jason.reference-video-review-registration.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly runId: string
  readonly assetId: string
  readonly assetSha256: string
  readonly takeId: string | null
  readonly providerCalls: 0
  readonly selectionChanged: false
  readonly formalApprovalChanged: false
}
