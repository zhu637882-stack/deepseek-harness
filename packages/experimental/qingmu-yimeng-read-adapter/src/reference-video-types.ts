/** Stable references for an explicitly authored video request. */
export interface ReferenceVideoBinding {
  readonly bindingToken: string
  readonly assetId: string
  readonly assetSha256: string
  readonly label: string
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

/** Project-owned source versions; callers cannot supply transport URLs. */
export interface ReferenceVideoPreviewRequest {
  readonly projectId: string
  readonly frameId: string
  readonly model: 'wan3.0-video'
  readonly bindings: readonly ReferenceVideoBinding[]
  readonly promptParts: readonly ReferenceVideoPromptPart[]
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
        readonly type: 'reference_image' | 'reference_audio'
        readonly url: string
      }[]
    }
    readonly parameters: ReferenceVideoParameters & { readonly watermark: false }
  }
  readonly referenceMapping: readonly (ReferenceVideoBinding & {
    readonly alias: string
    readonly mediaIndex: number
    readonly mediaType: 'reference_image' | 'reference_audio'
  })[]
  readonly requestBodySha256: string
  readonly sourceSha256: string
  readonly readOnly: true
  readonly databaseWrites: 0
  readonly providerCalls: 0
  readonly submissionReady: false
  readonly remainingChecks: readonly string[]
  readonly referenceAudioDurationSec: number
}

/** Paginated project assets available for explicit draft references. */
export interface ReferenceVideoAssetsRequest { readonly projectId: string; readonly page: number }

/** Asset metadata is a selectable draft source, without implying creative approval. */
export interface ReferenceVideoAsset {
  readonly assetId: string
  readonly assetSha256: string
  readonly label: string
  readonly mediaType: 'reference_image' | 'reference_audio'
  readonly browserUrl: string
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
  readonly draft: null | {
    readonly revision: number
    readonly frameSha256: string
    readonly requestSha256: string
    readonly request: Omit<ReferenceVideoPreviewRequest, 'projectId'>
    readonly savedAt: string
  }
  readonly mediaTypes: Readonly<Record<string, 'reference_image' | 'reference_audio' | null>>
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
