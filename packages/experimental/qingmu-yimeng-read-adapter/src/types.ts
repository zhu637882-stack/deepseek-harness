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

/** Read-only coordinates for the selected video on one canonical storyboard frame. */
export interface YimengSelectedVideoReviewRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
}

/** Status returned by Yimeng's existing, byte/revision-aware human-review reader. */
export type YimengSelectedVideoReviewStatus = 'accepted' | 'rejected' | 'pending' | 'stale' | 'invalid'

/** Original defect fields, not an IMAGO Finding or an assigned rework instruction. */
export interface YimengVideoReviewDefect {
  readonly defectType: string
  readonly timecodeSec: number | null
  readonly note: string
}

/** Whitelisted existing review evidence; no authenticated approver or review time is inferred. */
export interface YimengVideoReviewRecord {
  readonly version: 'formal-video-human-review-v1'
  readonly decision: 'accepted' | 'rejected'
  readonly reviewScope: 'full_video'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly formalVideoAssetId: string
  readonly assetSha256: string
  readonly frameUpdatedAt: string
  readonly frameContentSha256: string | null
  readonly storyboardRevision: number
  readonly reviewer: string
  readonly reviewNote: string | null
  readonly reasonCode: string | null
  readonly playbackProgress: number
  readonly checks: Readonly<Record<string, boolean>>
  readonly defects: readonly YimengVideoReviewDefect[] | null
  readonly machineFailureExceptionAccepted: boolean
}

/** Selected asset metadata and its upstream review, without media URLs or write capabilities. */
export interface YimengSelectedVideoReviewAsset {
  readonly assetId: string
  readonly version: number
  /** May be an asset-table fallback when status is invalid; not a Host byte verification. */
  readonly sha256: string | null
  readonly taskId: string | null
  readonly providerTaskId: string | null
  readonly durationSec: number | null
  readonly isSelected: true
  readonly selectionStatus: 'Selected'
  readonly formalReviewAccepted: boolean
  readonly formalReviewStatus: YimengSelectedVideoReviewStatus
  readonly formalReviewBlockerCode: string | null
  readonly formalReview: YimengVideoReviewRecord | null
}

/** Host projection of an existing GET only; it never creates a new approval or selection. */
export interface YimengSelectedVideoReviewResponse extends YimengSelectedVideoReviewRequest {
  readonly schema: 'qingmu.yimeng-selected-video-review.v1'
  readonly selectedAssetId: string | null
  readonly selected: YimengSelectedVideoReviewAsset | null
  readonly readOnly: true
  readonly providerCalls: 0
  readonly taskMutation: false
  readonly budgetMutation: false
  readonly humanSignoffInferred: false
}

/** Exact selected-video bytes and canonical Shot revision owned by Yimeng. */
export interface YimengShotVideoSubject extends YimengSelectedVideoReviewRequest {
  readonly schema: 'jason.qingmu-shot-video-subject.v1'
  readonly frameNo: number
  readonly storyboardRevision: number
  readonly frameContentSha256: string
  readonly assetId: string
  readonly assetVersion: number
  readonly assetSha256: string
}

/** Explicit reviewer attribution; no severity, Owner, or evidence is inferred. */
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

/** Immutable problem record, not a media approval or executable rework command. */
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

/** Read-only history with binding freshness independent of reviewer permissions. */
export interface YimengShotFindingFeedResponse extends YimengSelectedVideoReviewRequest {
  readonly schema: 'jason.qingmu-shot-finding-feed.v1'
  readonly subject: YimengShotVideoSubject | null
  readonly snapshotSha256: string | null
  readonly availability: { readonly status: 'available' | 'unavailable'; readonly reason: string | null }
  readonly capabilities: { readonly canRecordFinding: boolean }
  readonly items: readonly (YimengShotFinding & { readonly currentBinding: boolean })[]
}

/** Existing Yimeng ledger receipt; business state, selection, and signoff are unchanged. */
export interface YimengShotFindingResult {
  readonly schema: 'jason.qingmu-shot-finding-result.v1'
  readonly finding: YimengShotFinding
  readonly changed: false
  readonly providerCalls: 0
  readonly selectionChanged: false
  readonly humanSignoffInferred: false
  readonly reworkExecuted: false
}

/** Receipt lookup is read-only and can recover the original binding after it changes. */
export interface YimengShotFindingRecovery extends YimengSelectedVideoReviewRequest {
  readonly schema: 'jason.qingmu-shot-finding-recovery.v1'
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
  readonly status: 'committed' | 'not_found'
  readonly result: YimengShotFindingResult | null
}

/** Element kinds reserved by the generic element-profile route. */
export type YimengElementKind = 'actor' | 'scene' | 'prop'

/** Explicit knowledge state used by one strictly normalized rights field. */
export type YimengReferenceRightsKnowledgeState = 'known' | 'unknown' | 'not_applicable'

/** One scalar rights fact. Non-known values are always null. */
export interface YimengReferenceRightsScalar {
  readonly state: YimengReferenceRightsKnowledgeState
  readonly value: string | null
}

/** One list-valued rights fact. Non-known values are always empty. */
export interface YimengReferenceRightsList {
  readonly state: YimengReferenceRightsKnowledgeState
  readonly values: readonly string[]
}

/** Exact normalized record attached to one immutable reference asset binding. */
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

/** A reference attached to an authoritative element profile subject. */
export interface YimengElementProfileReference extends YimengJsonObject {
  readonly assetId: string
  readonly sha256: string
  readonly selectionStatus: string
  readonly isSelected: boolean
  readonly rightsRecorded: boolean
  readonly rights: YimengReferenceRightsRecord
  readonly role?: string
}

interface YimengElementProfileSubjectBase extends YimengJsonObject {
  readonly schema: 'jason.qingmu-element-profile-subject.v2'
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
  readonly schema: 'jason.qingmu-element-profile-subject-read.v2'
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

/** Immutable asset and rights-record bindings covered by one finite exception. */
export interface YimengReferenceRightsExceptionScope {
  readonly kind: 'reference_rights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rightsRecordSha256: string
  readonly rightsFields: readonly YimengReferenceRightsExceptionField[]
}

/** Server-derived authority for the independent exception-release lane. */
export interface YimengReferenceRightsExceptionCapabilities {
  readonly canRelease: boolean
  readonly blockedReasonCode: string | null
  readonly blockedReason: string | null
  readonly requiresRecentAuthentication: true
}

/** Server-authenticated exception fact, projected against current authority at read time. */
export interface YimengReferenceRightsExceptionRelease {
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
  readonly stale: boolean
  readonly staleReasonCodes: readonly string[]
}

/** Validated request for the separate reference-rights exception feed. */
export type YimengReferenceRightsExceptionReleaseFeedRequest = YimengElementProfileRequest

/** Historical and current exception facts for one exact element subject. */
export interface YimengReferenceRightsExceptionReleaseFeedResponse {
  readonly schema: 'jason.qingmu-reference-rights-exception-release-feed.v1'
  readonly projectId: string
  readonly elementKind: YimengElementKind
  readonly targetId: string
  readonly subject: YimengElementReviewSubject
  readonly capabilities: YimengReferenceRightsExceptionCapabilities
  readonly releases: readonly YimengReferenceRightsExceptionRelease[]
  readonly currentReleases: readonly YimengReferenceRightsExceptionRelease[]
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

/** Storyboard authority shared by every E5-1 relation view. */
export interface YimengShotRelationsStoryboardRevision {
  readonly episodeRevision: number
  readonly revisionId: string
  readonly revisionVersion: number
  readonly sourceSha256: string
}

/** Canonical Scene authority referenced by one or more Shots. */
export interface YimengShotRelationScene {
  readonly sceneId: string
  readonly name: string
  readonly profileRevision: number
  readonly snapshotSha256: string
}

export type YimengShotRelationElementKind = 'actor' | 'scene' | 'prop'

/** Minimal immutable lineage for the one E4-3 current reference selection. */
export interface YimengShotCurrentReferenceLineage {
  readonly projectId: string
  readonly sourceEpisodeId: string
  readonly ownerType: YimengShotRelationElementKind
  readonly ownerId: string
  readonly role: string
  readonly generationJobId: string
  readonly sourceRevisionId: string
  readonly formalConsistencyCheckId: string
}

export interface YimengShotCurrentReference {
  readonly assetId: string
  readonly sha256: string
  readonly lineage: YimengShotCurrentReferenceLineage
}

/** Canonical Actor, Scene, or Prop authority referenced by a Shot. */
export interface YimengShotRelationElement {
  readonly elementKind: YimengShotRelationElementKind
  readonly elementId: string
  readonly name: string
  readonly profileRevision: number
  readonly snapshotSha256: string
  readonly currentReferenceAvailability: 'missing' | 'available'
  readonly currentReference: YimengShotCurrentReference | null
}

export interface YimengShotDialogueCue {
  readonly schemaVersion: 'dialogue-cue-v2' | 'dialogue-cue-legacy-v1'
  readonly lineId: string | null
  readonly speakerId: string | null
  readonly verbatimText: string
  readonly plannedStartSec: number | null
  readonly plannedEndSec: number | null
  readonly timingVerified: boolean
  readonly legacy: boolean
}

export interface YimengShotDialogueRhythm {
  readonly cueCount: number
  readonly timedCueCount: number
  readonly cues: readonly YimengShotDialogueCue[]
}

/** Beat identity is local to its parent Shot and never promoted to a business entity. */
export interface YimengShotRelationBeat {
  readonly beatId: string
  readonly order: number
  readonly type: string
  readonly startSec: number
  readonly endSec: number
  readonly actorIds: readonly string[]
  readonly propIds: readonly string[]
  readonly visualResponsibility: string
}

/** One canonical Yimeng Shot and its read-only E5-1 relationships. */
export interface YimengShotRelationShot {
  readonly shotId: string
  readonly frameNo: number
  readonly sceneId: string
  readonly title: string | null
  readonly durationSec: number
  readonly dialogueRhythm: YimengShotDialogueRhythm
  readonly beats: readonly YimengShotRelationBeat[]
  readonly elements: readonly YimengShotRelationElement[]
}

/** Diagnostic facts emitted only by Yimeng; valid projections must have none. */
export interface YimengShotRelationBlocker extends YimengJsonObject {
  readonly scope: string
  readonly reason: string
  readonly sceneId?: string
  readonly shotId?: string
  readonly beatId?: string
  readonly elementId?: string
  readonly elementKind?: YimengShotRelationElementKind
}

/** Strict, rebuildable Scene/Shot/Beat/Element projection; never a second store. */
export interface YimengShotRelationsProjection {
  readonly schema: 'jason.scene-shot-beat-element-relations.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevision: YimengShotRelationsStoryboardRevision
  readonly scenes: readonly YimengShotRelationScene[]
  readonly shots: readonly YimengShotRelationShot[]
  readonly valid: true
  readonly blockers: readonly YimengShotRelationBlocker[]
}

/** Integer point in the browser/compiler-neutral 0..10000 storyboard grid. */
export interface YimengStoryboardCanvasPoint {
  readonly x: number
  readonly y: number
}

export type YimengStoryboardCanvasAnnotationKind = 'subject_region' | 'object_anchor' | 'motion_vector'

/** One raw human-authored canvas annotation. It never becomes a Shot identity. */
export interface YimengStoryboardCanvasAnnotation {
  readonly annotationId: string
  readonly kind: YimengStoryboardCanvasAnnotationKind
  readonly elementRef: {
    readonly elementKind: 'actor' | 'prop'
    readonly elementId: string
  }
  readonly points: readonly YimengStoryboardCanvasPoint[]
}

/** Deterministic IMAGO compilation mirrored by Yimeng inside the current storyboard revision. */
export interface YimengStoryboardCanvasCompiled extends YimengJsonObject {
  readonly subjectLayout: readonly {
    readonly annotationId: string
    readonly elementRef: { readonly elementKind: 'actor'; readonly elementId: string }
    readonly bounds: { readonly xMin: number; readonly yMin: number; readonly xMax: number; readonly yMax: number }
  }[]
  readonly objectAnchors: readonly {
    readonly annotationId: string
    readonly elementRef: { readonly elementKind: 'prop'; readonly elementId: string }
    readonly point: YimengStoryboardCanvasPoint
  }[]
  readonly actionTrajectory: readonly {
    readonly annotationId: string
    readonly elementRef: { readonly elementKind: 'actor' | 'prop'; readonly elementId: string }
    readonly from: YimengStoryboardCanvasPoint
    readonly to: YimengStoryboardCanvasPoint
  }[]
}

/** Selected first-frame asset for the same canonical storyboard frame. */
export interface YimengHeroFrameBinding {
  readonly assetId: string
  readonly mediaSha256: string
  readonly browserUrl: string
  readonly bindingSha256: string
}

/** Saved canvas authority; the enclosing storyboard revision is its only revision identity. */
export interface YimengStoryboardCanvas {
  readonly schema: 'jason.qingmu-storyboard-canvas.v1'
  readonly heroFrameBindingSha256: string
  readonly annotations: readonly YimengStoryboardCanvasAnnotation[]
  readonly rawAnnotationsSha256: string
  readonly compiled: YimengStoryboardCanvasCompiled
  readonly compiledSha256: string
}

/** Diagnostic fact emitted by Yimeng for one Hero Frame/canvas binding. */
export interface YimengHeroFrameStoryboardBlocker extends YimengJsonObject {
  readonly scope: string
  readonly reason: string
  readonly shotId?: string
  readonly annotationId?: string
  readonly elementId?: string
}

/** One canonical Shot joined to its selected Hero Frame and optional saved canvas. */
export interface YimengHeroFrameStoryboardShot {
  readonly shotId: string
  readonly shotSnapshotSha256: string
  readonly heroFrame: YimengHeroFrameBinding | null
  readonly canvas: YimengStoryboardCanvas | null
  readonly blockers: readonly YimengHeroFrameStoryboardBlocker[]
}

/** Rebuildable E5-2 sibling projection; it is not a canvas repository or state machine. */
export interface YimengHeroFrameStoryboardsProjection {
  readonly schema: 'jason.qingmu-hero-frame-storyboards.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly episodeRevision: number
  readonly storyboardRevision: Omit<YimengShotRelationsStoryboardRevision, 'episodeRevision'>
  readonly shotRelationsSha256: string
  readonly shots: readonly YimengHeroFrameStoryboardShot[]
  readonly shotsSha256: string
  readonly valid: true
  readonly blockers: readonly YimengHeroFrameStoryboardBlocker[]
}

/** Four dimensions recorded by an existing continuity check, not a new review. */
export interface YimengContinuityDimension {
  readonly dimension: 'character' | 'scene' | 'prop' | 'action'
  readonly result: boolean | null
  readonly reason: string | null
}

/** Current materialized pair and selected-video lineage supplied by Yimeng. */
export interface YimengContinuityCurrentBinding {
  readonly tailAssetId: string | null
  readonly tailSha256: string | null
  readonly nextFirstFrameAssetId: string | null
  readonly nextFirstFrameSha256: string | null
  readonly selectedVideoAssetId: string | null
  readonly selectedVideoTaskId: string | null
  readonly tailSourceTaskId: string | null
  readonly tailFromSelectedVideo: boolean
  readonly nextFirstFrameSelected: boolean
  readonly nextFirstFrameStale: boolean
  readonly staleHandoff: boolean
}

/** Exact stored audit binding; its SHA values are claims in that audit record. */
export interface YimengContinuityAudit {
  readonly checkId: string | null
  readonly passed: boolean | null
  readonly createdAt: string | null
  readonly tailAssetId: string | null
  readonly tailSha256: string | null
  readonly nextFirstFrameAssetId: string | null
  readonly nextFirstFrameSha256: string | null
  readonly providerTaskId: string | null
  readonly evidenceRef: string | null
  readonly dimensions: readonly YimengContinuityDimension[]
}

/** Adjacent canonical Shots with historical and current evidence kept separate. */
export interface YimengContinuityPair {
  readonly fromShotId: string
  readonly toShotId: string
  readonly fromFrameNo: number
  readonly toFrameNo: number
  readonly required: boolean
  readonly enforced: boolean
  readonly exemption: 'scene_change' | 'hard_cut' | null
  readonly legacyStatus: 'passed' | 'blocked' | 'advisory' | 'exempt'
  readonly legacyEvidenceReady: boolean
  readonly contractDigest: string
  readonly currentBinding: YimengContinuityCurrentBinding
  readonly audit: YimengContinuityAudit
  readonly bindingStatus: 'current' | 'different' | 'unavailable'
  readonly currentEvidenceReady: boolean
  readonly warnings: readonly string[]
}

/** Rebuildable E5-5 evidence; availability is readability, never approval. */
export interface YimengContinuityDeltaProjection {
  readonly schema: 'jason.qingmu-continuity-delta.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevision: YimengShotRelationsStoryboardRevision
  readonly availability: 'available' | 'unavailable'
  readonly reason: string | null
  readonly pairs: readonly YimengContinuityPair[]
  readonly snapshotSha256: string
  readonly readOnly: true
  readonly providerCalls: 0
  readonly taskMutation: false
  readonly budgetMutation: false
  readonly humanSignoffInferred: false
}

/** Workflow director facts; older upstreams may not yet export continuity evidence. */
export interface YimengWorkflowDirector extends YimengJsonObject {
  readonly shotRelations: YimengShotRelationsProjection
  readonly heroFrameStoryboards: YimengHeroFrameStoryboardsProjection
  readonly continuityDelta?: YimengContinuityDeltaProjection
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
  readonly director: YimengWorkflowDirector
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
  readonly selectedVideoReview: YimengSelectedVideoReviewResponse
  readonly shotFindings: YimengShotFindingFeedResponse
  readonly elementProfile: YimengElementProfileResponse
  readonly referenceCandidates: YimengReferenceCandidatesResponse
  readonly reviewEvents: YimengElementReviewFeedResponse
  readonly referenceRightsExceptionReleases: YimengReferenceRightsExceptionReleaseFeedResponse
  readonly workflow: YimengWorkflowProjection
}

/** Endpoint names accepted by the `/qingmu-yimeng` channel. */
export type YimengReadEndpoint = keyof YimengReadEndpointMap
