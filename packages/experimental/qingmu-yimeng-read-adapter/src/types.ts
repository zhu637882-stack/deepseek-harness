/** JSON object retained from a Yimeng read response. */
export interface YimengJsonObject {
  readonly [key: string]: unknown
}

/** Normalized anonymous liveness response. It does not assert production readiness. */
export interface YimengHealth {
  readonly status: string
  readonly liveness: boolean
  readonly runtime: {
    readonly commit: string | null
    readonly dirty: boolean | null
    readonly identitySource: string
    readonly matchesReleaseManifest: boolean | null
  }
  readonly build: YimengJsonObject | null
  readonly hints: YimengJsonObject | null
}

/** Validated request for the projects endpoint. */
export interface YimengProjectsRequest {
  readonly page?: number
  readonly pageSize?: number
  readonly search?: string
}

/** Normalized project page. Item fields are retained without inventing project semantics. */
export interface YimengProjectsResponse {
  readonly items: readonly YimengJsonObject[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly pages: number
    readonly total: number
  }
}

/** Validated request for a project's episodes. */
export interface YimengEpisodesRequest {
  readonly projectId: string
  readonly seriesId?: string
}

/** Episode list with each upstream item retained as a JSON object. */
export interface YimengEpisodesResponse {
  readonly items: readonly YimengJsonObject[]
}

/** Validated request for an episode's authoritative script snapshot. */
export interface YimengScriptRequest {
  readonly projectId: string
  readonly episodeId: string
}

/** Script and revision read from Yimeng with a Host-verified canonical snapshot hash. */
export interface YimengScriptResponse extends YimengJsonObject {
  readonly found: boolean
  readonly projectId: string
  readonly episodeId: string
  readonly script: YimengJsonObject | null
  readonly scriptSha256: string | null
  readonly revision: number
  readonly editedByUser: boolean
  readonly updatedAt: string
  readonly error?: string
}

/** Stable coordinates for the current Ready PromptIR attached to one storyboard frame. */
export interface YimengPromptIrRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}

/** The only PromptIR fields exposed by Yimeng for human editing in this slice. */
export interface YimengPromptIrEditableProjection extends YimengJsonObject {
  readonly imageGenPrompt: string
  readonly lastFrameImagePrompt: string
  readonly videoGenPrompt: string
  readonly motionPrompt: string
  readonly negativePrompt: string
}

/** Version-bound Yimeng PromptIR subject; status is fail-closed to the current Ready row. */
export interface YimengPromptIrSubject extends YimengJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-subject.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly targetType: 'prompt_ir'
  readonly targetId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly promptIrId: string
  readonly promptIrVersion: number
  readonly promptIrContentSha256: string
  readonly status: 'Ready'
  readonly editableProjection: YimengPromptIrEditableProjection
}

/** Authoritative current-Ready PromptIR read with an exact subject snapshot hash. */
export interface YimengPromptIrResponse extends YimengJsonObject {
  readonly schema: 'jason.qingmu-prompt-ir-subject-read.v1'
  readonly subject: YimengPromptIrSubject
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}

/** Element kinds reserved by the generic element-profile route. */
export type YimengElementKind = 'actor' | 'scene' | 'prop'

/** A reference attached to an authoritative element profile subject. */
export interface YimengElementProfileReference extends YimengJsonObject {
  readonly assetId: string
  readonly sha256: string
  readonly selectionStatus: string
  readonly isSelected: boolean
}

interface YimengElementProfileSubjectBase extends YimengJsonObject {
  readonly schema: 'jason.qingmu-element-profile-subject.v1'
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly profileRevision: number
  readonly name: string
  readonly officialReferenceImageUrl: string | null
  readonly references: readonly YimengElementProfileReference[]
}

/** Authoritative actor identity subject returned by Yimeng. */
export interface YimengActorElementProfileSubject extends YimengElementProfileSubjectBase {
  readonly elementKind: 'actor'
  readonly actorId: string
  readonly visualIdentity: string
}

/** Authoritative environment subject. Product UI calls this an environment; Yimeng owns it as a scene. */
export interface YimengSceneElementProfileSubject extends YimengElementProfileSubjectBase {
  readonly elementKind: 'scene'
  readonly sceneId: string
  readonly sceneType: string
  readonly visualPrompt: string
}

/** Authoritative prop subject returned by Yimeng. */
export interface YimengPropElementProfileSubject extends YimengElementProfileSubjectBase {
  readonly elementKind: 'prop'
  readonly propId: string
  readonly visualPrompt: string
}

/** Discriminated authoritative actor, scene, or prop profile subject. */
export type YimengElementProfileSubject =
  | YimengActorElementProfileSubject
  | YimengSceneElementProfileSubject
  | YimengPropElementProfileSubject

/** Validated request for an authoritative element-profile snapshot. */
export interface YimengElementProfileRequest {
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
}

/**
 * Element profile verified against the upstream canonical bytes. The canonical
 * snapshot itself is deliberately retained by the Host and never exposed.
 */
export interface YimengElementProfileResponse extends YimengJsonObject {
  readonly schema: 'jason.qingmu-element-profile-subject-read.v1'
  readonly subject: YimengElementProfileSubject
  readonly snapshotSha256: string
}

/** Exact element-profile version to which comments and decisions are bound. */
export interface YimengElementReviewSubject {
  readonly type: 'element_profile'
  readonly id: string
  readonly revision: number
  readonly sha256: string
}

/** Server-derived permissions. Browser callers never submit identity or role claims. */
export interface YimengElementReviewCapabilities {
  readonly canComment: boolean
  readonly canDecide: boolean
}

/** Server-authenticated comment event. A comment is not a human decision. */
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

/** Formal decision values accepted by the dedicated human-decision route. */
export type YimengHumanDecisionValue = 'approve' | 'reject' | 'request_changes'

/** Server-authenticated decision, with staleness derived from exact subject lineage. */
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
  readonly stale: boolean
}

/** Validated request for the independent comment and HumanDecision feed. */
export type YimengElementReviewFeedRequest = YimengElementProfileRequest

/** Review feed bound to one authoritative element-profile subject version. */
export interface YimengElementReviewFeedResponse {
  readonly schema: 'jason.qingmu-element-review-feed.v1'
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
  readonly subject: YimengElementReviewSubject
  readonly capabilities: YimengElementReviewCapabilities
  readonly comments: readonly YimengElementReviewComment[]
  readonly decisions: readonly YimengHumanDecision[]
  readonly currentDecision: YimengHumanDecision | null
}

/** Selection states emitted by the Yimeng reference-candidate facade. */
export type YimengReferenceCandidateSelectionStatus = 'Unselected' | 'Selected' | 'Rejected' | 'Stale'

/** Quality states emitted by the Yimeng reference-candidate facade. */
export type YimengReferenceCandidateQualityStatus = 'pending' | 'passed' | 'failed'

/** The active decision source recorded for a reference candidate. */
export type YimengReferenceCandidateDecisionKind = 'none' | 'referenceSelection' | 'humanReview'

/** A reference candidate bound to one authoritative element profile. */
export interface YimengReferenceAssetCandidate {
  readonly assetId: string
  readonly sha256: string
  readonly materializedSha256: string
  readonly bindingValid: boolean
  readonly projectId: string
  readonly sourceEpisodeId: string
  readonly ownerType: YimengElementKind
  readonly ownerId: string
  readonly role: string
  readonly localPath: string
  readonly qualityStatus: YimengReferenceCandidateQualityStatus
  readonly selectionStatus: YimengReferenceCandidateSelectionStatus
  readonly isSelected: boolean
  readonly generationJobId: string
  readonly sourceRevisionId: string
  readonly formalConsistencyCheckId: string
  readonly formalConsistencyPassed: boolean
  readonly qualityProjectionSha256: string
  readonly decisionKind: YimengReferenceCandidateDecisionKind
  readonly decisionIdentity: string
}

/** Validated request for an element profile's reference candidates. */
export type YimengReferenceCandidatesRequest = YimengElementProfileRequest

/** Exact reference candidates returned for one authoritative element profile snapshot. */
export interface YimengReferenceCandidatesResponse {
  readonly schema: 'jason.qingmu-reference-asset-candidates.v1'
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: YimengElementKind
  readonly profileRevision: number
  readonly elementSnapshotSha256: string
  readonly candidates: readonly YimengReferenceAssetCandidate[]
  readonly humanApprovalInferred: false
}

/** Validated request for an episode workflow projection. */
export interface YimengWorkflowRequest {
  readonly projectId: string
  readonly episodeId: string
}

/** Workflow stage facts supplied by Yimeng. */
export interface YimengWorkflowStage extends YimengJsonObject {
  readonly status: string
  readonly hasData: boolean
  readonly isStale: boolean
  readonly qualityPassed: boolean
  readonly selected: boolean
  readonly canProceed: boolean
}

/** Workflow blocker supplied by Yimeng. */
export interface YimengWorkflowBlocker extends YimengJsonObject {
  readonly reason: string
}

/** Explicit non-authority interpretation attached by this read adapter. */
export interface YimengWorkflowInterpretation {
  readonly providerAuthorization: 'not-exposed'
  readonly humanSignoff: 'not-inferred'
  readonly productionReadiness: 'not-inferred'
  readonly statusFacts: readonly ['budget.valid', 'release.releaseReady', 'qualityPassed']
}

/**
 * Validated Yimeng workflow projection. Unknown top-level and nested fields are
 * retained, while readiness-like facts remain explicitly non-authoritative.
 */
export interface YimengWorkflowProjection extends YimengJsonObject {
  readonly schema: 'jason.episode-workflow-projection.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly sourceRevision: YimengJsonObject
  readonly inputFingerprint: string
  readonly activeTaskId: string | null
  readonly status: string
  readonly hasData: boolean
  readonly isStale: boolean
  readonly qualityPassed: boolean
  readonly selected: boolean
  readonly canProceed: boolean
  readonly stages: Readonly<Record<string, YimengWorkflowStage>>
  readonly stageHandoff: YimengJsonObject
  readonly assets: YimengJsonObject
  readonly director: YimengJsonObject
  readonly shots: YimengJsonObject
  readonly video: YimengJsonObject
  readonly audio: YimengJsonObject
  readonly timeline: YimengJsonObject
  readonly budget: YimengJsonObject
  readonly release: YimengJsonObject
  readonly blockers: readonly YimengWorkflowBlocker[]
  readonly legacy: YimengJsonObject
  readonly interpretation: YimengWorkflowInterpretation
}

/** Result values exposed by each `/qingmu-yimeng` endpoint. */
export interface YimengReadEndpointMap {
  readonly health: YimengHealth
  readonly projects: YimengProjectsResponse
  readonly episodes: YimengEpisodesResponse
  readonly script: YimengScriptResponse
  readonly promptIr: YimengPromptIrResponse
  readonly elementProfile: YimengElementProfileResponse
  readonly referenceCandidates: YimengReferenceCandidatesResponse
  readonly reviewEvents: YimengElementReviewFeedResponse
  readonly workflow: YimengWorkflowProjection
}

/** Endpoint names accepted by the `/qingmu-yimeng` channel. */
export type YimengReadEndpoint = keyof YimengReadEndpointMap
