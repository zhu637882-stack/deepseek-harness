import type {
  YimengStageSource,
  YimengStageSourceDefinition,
  YimengStageSourcesRequest,
  YimengProductionUnitDefinition,
  YimengProductionUnitSource,
  YimengProductionUnitsRequest,
  YimengContinuityDeltaProjection,
  YimengContinuityPair,
  YimengShotRelationsStoryboardRevision,
  YimengSelectedVideoReviewRequest,
  YimengShotVideoSubject,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

/** JSON object retained from the stateless IMAGO method projection. */
export interface ImagoMethodJsonObject {
  readonly [key: string]: unknown
}

/** Element kinds with an explicit current IMAGO profile-editing method. */
export type ImagoElementKind = 'actor' | 'scene' | 'prop'

/** Browser-safe subject for compiling the current element editing method. */
export interface ImagoElementMethodRequest {
  readonly projectId: string
  readonly targetType: 'element_profile'
  readonly targetId: string
  readonly elementKind: ImagoElementKind
  readonly scopeType: 'project'
  readonly scopeId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}

/** Exact authority snapshot constructed in the Host, never accepted from the browser. */
export interface ImagoElementMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.element-method-snapshot.v1'
  readonly subject: {
    readonly project_id: string
    readonly target_type: 'element_profile'
    readonly target_id: string
    readonly element_kind: ImagoElementKind
    readonly scope_type: 'project'
    readonly scope_id: string
    readonly base_revision: number
    readonly base_snapshot_sha256: string
  }
  readonly authority: {
    readonly business_truth: 'yimeng'
    readonly method_source: 'imago_os_current'
    readonly human_approval: 'not_granted'
    readonly paid_provider_authority: 'not_granted'
  }
}

/** Validated compiler projection used by forms and ChangeSet proposals. */
export interface ImagoElementMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-element-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly subject: ImagoElementMethodSnapshot['subject']
  readonly method_definition: ImagoMethodJsonObject
  readonly source_bindings: readonly ImagoMethodJsonObject[]
  readonly field_hints: readonly ImagoMethodJsonObject[]
  readonly checklist: readonly ImagoMethodJsonObject[]
  readonly work_order_projection: ImagoMethodJsonObject
  readonly review_card: ImagoMethodJsonObject
  readonly legal_work_set: ImagoMethodJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly paid_provider_authority: 'not_granted'
  readonly human_approval_inferred: false
  readonly selection_authority: 'not_granted'
}

/** Server-only proof binding the validated projection to its exact IMAGO input. */
export interface ImagoElementMethodAttestation extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-element-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly subjectSha256: string
  readonly signature: string
}

/** Host-attested wrapper; its SHA is over canonical projection JSON. */
export interface ImagoElementMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-element-method-adapter-result.v1'
  readonly projectionSha256: string
  readonly projection: ImagoElementMethodProjection
  readonly methodAttestation: ImagoElementMethodAttestation
}

/** Existing reference-asset action operations compiled without executing them. */
export type ImagoReferenceAssetActionOperation = 'selectReferenceAsset' | 'requestReferenceRegeneration'

/** Rights operations compiled from target lineage only; no rights body or release decision enters IMAGO. */
export type ImagoReferenceRightsOperation =
  | 'replaceReferenceRights'
  | 'recordReferenceRightsExceptionRelease'

/** All operations transported through the existing reference-asset method endpoint. */
export type ImagoReferenceAssetOperation = ImagoReferenceAssetActionOperation | ImagoReferenceRightsOperation

/** Exact browser input for compiling a reference-asset operation method. */
interface ImagoReferenceAssetMethodRequestBase {
  readonly projectId: string
  readonly elementKind: ImagoElementKind
  readonly elementId: string
  readonly profileRevision: number
  readonly snapshotSha256: string
}

/** Selection/regeneration request compiled with the reference-asset method contract. */
export interface ImagoReferenceAssetActionMethodRequest extends ImagoReferenceAssetMethodRequestBase {
  readonly assetId: string
  readonly assetSha256: string
  readonly operation: ImagoReferenceAssetActionOperation
}

/** Rights request carries only target lineage; the rights draft never enters IMAGO. */
export interface ImagoReferenceRightsMethodRequest extends ImagoReferenceAssetMethodRequestBase {
  readonly operation: ImagoReferenceRightsOperation
}

/** Exact browser input accepted by the existing reference-asset method endpoint. */
export type ImagoReferenceAssetMethodRequest =
  | ImagoReferenceAssetActionMethodRequest
  | ImagoReferenceRightsMethodRequest

/** Host-constructed reference-asset target plus fixed non-escalating authority. */
export interface ImagoReferenceAssetMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.reference-asset-method-snapshot.v1'
  readonly target: ImagoReferenceAssetActionMethodRequest
  readonly authority: {
    readonly business_truth: 'yimeng'
    readonly method_source: 'imago_os_current'
    readonly human_approval: 'not_granted'
    readonly paid_provider_authority: 'not_granted'
  }
}

/** Validated guidance for one exact reference-asset target and operation. */
export interface ImagoReferenceAssetMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-reference-asset-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: ImagoReferenceAssetMethodSnapshot['target']
  readonly method_definition: ImagoMethodJsonObject
  readonly source_bindings: readonly ImagoMethodJsonObject[]
  readonly field_hints: readonly ImagoMethodJsonObject[]
  readonly checklist: readonly ImagoMethodJsonObject[]
  readonly work_order_projection: ImagoMethodJsonObject
  readonly review_card: ImagoMethodJsonObject
  readonly legal_work_set: ImagoMethodJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
  readonly selection_executed: false
}

/** Server-only proof binding reference-asset guidance to its exact target. */
export interface ImagoReferenceAssetMethodAttestation extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-reference-asset-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly targetSha256: string
  readonly signature: string
}

/** Host-attested reference-asset guidance; its SHA covers canonical projection JSON. */
export interface ImagoReferenceAssetActionMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-reference-asset-method-adapter-result.v1'
  readonly projectionSha256: string
  readonly projection: ImagoReferenceAssetMethodProjection
  readonly methodAttestation: ImagoReferenceAssetMethodAttestation
}

/** Endpoint result: action guidance uses the legacy proof, rights guidance uses the element proof. */
export type ImagoReferenceAssetMethodResponse =
  | ImagoReferenceAssetActionMethodResponse
  | ImagoElementMethodResponse

/** The only Yimeng v2 PromptIR fields exposed by the bounded E4-4 method. */
export type ImagoPromptIrEditableField =
  | 'imageGenPrompt'
  | 'lastFrameImagePrompt'
  | 'videoGenPrompt'
  | 'motionPrompt'
  | 'negativePrompt'

/** Complete canonical Yimeng editable PromptIR projection. */
export interface ImagoPromptIrEditableProjection extends ImagoMethodJsonObject {
  readonly imageGenPrompt: string
  readonly lastFrameImagePrompt: string
  readonly videoGenPrompt: string
  readonly motionPrompt: string
  readonly negativePrompt: string
}

/** Browser-proposed partial replacements; runtime validation requires at least one key. */
export interface ImagoPromptIrEditableReplacements extends ImagoMethodJsonObject {
  readonly imageGenPrompt?: string
  readonly lastFrameImagePrompt?: string
  readonly videoGenPrompt?: string
  readonly motionPrompt?: string
  readonly negativePrompt?: string
}

/** Exact Yimeng authority and candidate input for one stateless PromptIR method compile. */
export interface ImagoPromptIrMethodRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly basePromptIrId: string
  readonly baseVersion: number
  readonly baseSnapshotSha256: string
  readonly baseContentSha256: string
  readonly baseEditableProjection: ImagoPromptIrEditableProjection
  readonly candidateEditableProjection: ImagoPromptIrEditableReplacements
}

/** Host-constructed exact compiler input; it carries no execution authority. */
export interface ImagoPromptIrMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.prompt-ir-method-snapshot.v1'
  readonly target: Omit<ImagoPromptIrMethodRequest, 'baseEditableProjection' | 'candidateEditableProjection'>
  readonly baseEditableProjection: ImagoPromptIrEditableProjection
  readonly candidateEditableProjection: ImagoPromptIrEditableReplacements
  readonly authority: {
    readonly business_truth: 'yimeng'
    readonly method_source: 'imago_os_current'
    readonly human_approval: 'not_granted'
    readonly paid_provider_authority: 'not_granted'
  }
}

/** Provider-neutral normalized candidate and exact method/source evidence. */
export interface ImagoPromptIrMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-prompt-ir-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: ImagoPromptIrMethodSnapshot['target']
  readonly normalized_candidate: ImagoPromptIrEditableProjection
  readonly candidate_sha256: string
  readonly changed_paths: readonly string[]
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
  readonly method_definition: ImagoMethodJsonObject
  readonly source_bindings: readonly ImagoMethodJsonObject[]
  readonly field_hints: readonly ImagoMethodJsonObject[]
  readonly checklist: readonly ImagoMethodJsonObject[]
  readonly work_order_projection: ImagoMethodJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly selection_executed: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
}

/** HMAC proof over the exact PromptIR method input and normalized output. */
export interface ImagoPromptIrMethodAttestation extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-prompt-ir-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly targetSha256: string
  readonly baseEditableProjectionSha256: string
  readonly candidateEditableProjectionSha256: string
  readonly candidateSha256: string
  readonly signature: string
}

/** Host-attested wrapper for one non-executing PromptIR method result. */
export interface ImagoPromptIrMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1'
  readonly projectionSha256: string
  readonly projection: ImagoPromptIrMethodProjection
  readonly methodAttestation: ImagoPromptIrMethodAttestation
}

/** Canonical Scene relation submitted to the read-only Shot relation compiler. */
export interface ImagoShotRelationScene extends ImagoMethodJsonObject {
  readonly sceneId: string
  readonly profileRevision: number
  readonly snapshotSha256: string
  readonly elementIds: readonly string[]
}

/** Shot-local Beat relation; its ID has no meaning outside the parent Shot. */
export interface ImagoShotRelationBeat extends ImagoMethodJsonObject {
  readonly beatId: string
  readonly elementIds: readonly string[]
}

/** Canonical Yimeng Shot relation submitted without display-only fields. */
export interface ImagoShotRelationShot extends ImagoMethodJsonObject {
  readonly shotId: string
  readonly sceneId: string
  readonly elementIds: readonly string[]
  readonly beats: readonly ImagoShotRelationBeat[]
}

/** One exact E5-3 dialogue cue; legacy cues deliberately retain null timing. */
export interface ImagoShotDialogueCue extends ImagoMethodJsonObject {
  readonly schemaVersion: 'dialogue-cue-v2' | 'dialogue-cue-legacy-v1'
  readonly lineId: string | null
  readonly speakerId: string | null
  /** Exact text: Python-strip-clean, NUL-free, and 1–256 Unicode code points. */
  readonly verbatimText: string
  /** Finite timing seconds, not safe-integer-limited; legacy cues retain null. */
  readonly plannedStartSec: number | null
  readonly plannedEndSec: number | null
  readonly timingVerified: boolean
  readonly legacy: boolean
}

/** Read-only timing projection derived from the authoritative Yimeng dialogue plan. */
export interface ImagoShotDialogueRhythm extends ImagoMethodJsonObject {
  readonly cueCount: number
  readonly timedCueCount: number
  readonly cues: readonly ImagoShotDialogueCue[]
}

/** E5-3 Shot authority; frameNo is the sole ordering projection. */
export interface ImagoE53ShotRelationShot extends ImagoShotRelationShot {
  readonly frameNo: number
  /** Positive finite seconds, with no safe-integer limit or quantization. */
  readonly durationSec: number
  readonly dialogueRhythm: ImagoShotDialogueRhythm
}

/** Canonical Element identity retained in the relation authority snapshot. */
export interface ImagoShotRelationElement extends ImagoMethodJsonObject {
  readonly elementId: string
  readonly elementKind: ImagoElementKind
  readonly profileRevision: number
  readonly snapshotSha256: string
}

/** Exact immutable coordinates of the one E4-3 current reference selection. */
export interface ImagoShotCurrentReferenceLineage extends ImagoMethodJsonObject {
  readonly projectId: string
  readonly sourceEpisodeId: string
  readonly ownerType: ImagoElementKind
  readonly ownerId: string
  readonly role: string
  readonly generationJobId: string
  readonly sourceRevisionId: string
  readonly formalConsistencyCheckId: string
}

/** Read-only E4-3 reference binding exposed to the E5-3 method. */
export interface ImagoShotCurrentReference extends ImagoMethodJsonObject {
  readonly assetId: string
  readonly sha256: string
  readonly lineage: ImagoShotCurrentReferenceLineage
}

/** E5-3 Element authority with an explicit current-reference availability state. */
export interface ImagoE53ShotRelationElement extends ImagoShotRelationElement {
  readonly currentReferenceAvailability: 'missing' | 'available'
  readonly currentReference: ImagoShotCurrentReference | null
}

/** Shared E5-1/E5-2 relation authority retained for the Hero Frame compiler. */
export interface ImagoShotRelationAuthorityRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly episodeRevision: number
  readonly storyboardRevisionId: string
  readonly storyboardRevisionVersion: number
  readonly storyboardSourceSha256: string
  readonly selectedShotId: string
  readonly scenes: readonly ImagoShotRelationScene[]
  readonly shots: readonly ImagoShotRelationShot[]
  readonly elements: readonly ImagoShotRelationElement[]
}

/** Browser input containing only Yimeng lineage and the compiler-ready relation ID graph. */
export interface ImagoShotRelationMethodRequest extends ImagoShotRelationAuthorityRequest {
  readonly shots: readonly ImagoE53ShotRelationShot[]
  readonly elements: readonly ImagoE53ShotRelationElement[]
}

/** Numeric wire input; relation SHA uses the domain-tagged E5-3 binary64-seconds hash projection. */
export interface ImagoShotRelationMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.shot-relation-method-snapshot.v1'
  readonly target: {
    readonly projectId: string
    readonly episodeId: string
    readonly episodeRevision: number
    readonly storyboardRevisionId: string
    readonly storyboardRevisionVersion: number
    readonly storyboardSourceSha256: string
    readonly relationSnapshotSha256: string
    readonly selectedShotId: string
  }
  readonly scenes: readonly ImagoShotRelationScene[]
  readonly shots: readonly ImagoE53ShotRelationShot[]
  readonly elements: readonly ImagoE53ShotRelationElement[]
  readonly authority: {
    readonly business_truth: 'yimeng'
    readonly shot_id_source: 'yimeng_storyboard_frame_id'
    readonly beat_id_scope: 'shot_local'
    readonly method_source: 'imago_os_current'
    readonly human_approval: 'not_granted'
    readonly paid_provider_authority: 'not_granted'
  }
}

/** Strictly read-only current IMAGO guidance for one canonical Yimeng Shot relation. */
export interface ImagoShotRelationMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-shot-relation-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: ImagoShotRelationMethodSnapshot['target']
  readonly relationship_projection: {
    readonly canonicalShotIdSource: 'yimeng_storyboard_frame_id'
    readonly beatIdScope: 'shot_local'
    readonly scenes: readonly ImagoShotRelationScene[]
    readonly shots: readonly ImagoE53ShotRelationShot[]
    readonly elements: readonly ImagoE53ShotRelationElement[]
    readonly selectedShot: ImagoE53ShotRelationShot
  }
  readonly method_definition: ImagoMethodJsonObject
  readonly source_bindings: readonly ImagoMethodJsonObject[]
  readonly field_hints: readonly ImagoMethodJsonObject[]
  readonly checklist: readonly ImagoMethodJsonObject[]
  readonly work_order_projection: ImagoMethodJsonObject
  readonly review_card: ImagoMethodJsonObject
  readonly legal_work_set: ImagoMethodJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly selection_executed: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
}

/**
 * HMAC proof binding the exact numeric input wire bytes and target.
 * Relation, selected Shot, and output hashes use the domain-tagged E5-3 binary64-seconds projection.
 */
export interface ImagoShotRelationMethodAttestation extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-shot-relation-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly projectionSha256: string
  readonly inputSnapshotSha256: string
  readonly targetSha256: string
  readonly relationSnapshotSha256: string
  readonly selectedShotSha256: string
  readonly signature: string
}

/** Host-attested wrapper for one non-executing Shot relation method result. */
export interface ImagoShotRelationMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-shot-relation-method-adapter-result.v1'
  readonly projectionSha256: string
  readonly projection: ImagoShotRelationMethodProjection
  readonly methodAttestation: ImagoShotRelationMethodAttestation
}

/** Integer point in the browser-independent 0..10000 storyboard coordinate space. */
export interface ImagoHeroFrameStoryboardPoint extends ImagoMethodJsonObject {
  readonly x: number
  readonly y: number
}

/** Canonical Shot-local actor or prop reference used by one canvas annotation. */
export interface ImagoHeroFrameStoryboardElementRef extends ImagoMethodJsonObject {
  readonly elementKind: 'actor' | 'prop'
  readonly elementId: string
}

/** Raw Shot-local annotation compiled into deterministic director fields. */
export interface ImagoHeroFrameStoryboardAnnotation extends ImagoMethodJsonObject {
  readonly annotationId: string
  readonly kind: 'subject_region' | 'object_anchor' | 'motion_vector'
  readonly elementRef: ImagoHeroFrameStoryboardElementRef
  readonly points: readonly ImagoHeroFrameStoryboardPoint[]
}

/** Browser input containing canonical Yimeng lineage, one selected Hero Frame, and transient canvas annotations. */
export interface ImagoHeroFrameStoryboardMethodRequest extends ImagoShotRelationAuthorityRequest {
  readonly heroFrame: {
    readonly assetId: string
    readonly mediaSha256: string
  }
  readonly canvas: {
    readonly baseCanvasSha256: string | null
    readonly annotations: readonly ImagoHeroFrameStoryboardAnnotation[]
  }
}

/** Exact compiler input constructed by the Host with every relation, Hero Frame, and annotation SHA derived. */
export interface ImagoHeroFrameStoryboardMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.hero-frame-storyboard-method-snapshot.v1'
  readonly target: ImagoShotRelationMethodSnapshot['target'] & {
    readonly selectedShotSnapshotSha256: string
  }
  readonly scenes: readonly ImagoShotRelationScene[]
  readonly shots: readonly ImagoShotRelationShot[]
  readonly elements: readonly ImagoShotRelationElement[]
  readonly heroFrame: {
    readonly assetId: string
    readonly mediaSha256: string
    readonly bindingSha256: string
  }
  readonly canvas: {
    readonly baseCanvasSha256: string | null
    readonly rawAnnotationsSha256: string
    readonly annotations: readonly ImagoHeroFrameStoryboardAnnotation[]
  }
  readonly authority: {
    readonly business_truth: 'yimeng'
    readonly shot_id_source: 'yimeng_storyboard_frame_id'
    readonly hero_frame_source: 'yimeng_selected_first_frame'
    readonly method_source: 'imago_os_current'
    readonly human_approval: 'not_granted'
    readonly paid_provider_authority: 'not_granted'
  }
}

/** Deterministic fields compiled from raw canvas annotations. */
export interface ImagoHeroFrameStoryboardCompiledResult extends ImagoMethodJsonObject {
  readonly subjectLayout: readonly ImagoMethodJsonObject[]
  readonly objectAnchors: readonly ImagoMethodJsonObject[]
  readonly actionTrajectory: readonly ImagoMethodJsonObject[]
}

/** Stateless IMAGO Hero Frame and Storyboard Canvas method projection for one canonical Yimeng Shot. */
export interface ImagoHeroFrameStoryboardMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1'
  readonly input_snapshot_sha256: string
  readonly target: ImagoHeroFrameStoryboardMethodSnapshot['target']
  readonly canvas_projection: {
    readonly canonicalShotIdSource: 'yimeng_storyboard_frame_id'
    readonly shotId: string
    readonly selectedShot: ImagoShotRelationShot
    readonly heroFrame: ImagoHeroFrameStoryboardMethodSnapshot['heroFrame']
    readonly baseCanvasSha256: string | null
    readonly rawAnnotations: readonly ImagoHeroFrameStoryboardAnnotation[]
    readonly rawAnnotationsSha256: string
    readonly compiledResult: ImagoHeroFrameStoryboardCompiledResult
    readonly compiledResultSha256: string
  }
  readonly method_definition: ImagoMethodJsonObject
  readonly source_bindings: readonly ImagoMethodJsonObject[]
  readonly field_hints: readonly ImagoMethodJsonObject[]
  readonly checklist: readonly ImagoMethodJsonObject[]
  readonly work_order_projection: ImagoMethodJsonObject
  readonly review_card: ImagoMethodJsonObject
  readonly legal_work_set: ImagoMethodJsonObject
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly project_state_persisted: false
  readonly providerCalls: 0
  readonly workerStarted: false
  readonly selection_executed: false
  readonly human_approval_inferred: false
  readonly human_signoff_inferred: false
}

/** HMAC proof over every immutable lineage and compiled Storyboard Canvas result. */
export interface ImagoHeroFrameStoryboardMethodAttestation extends ImagoMethodJsonObject {
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

/** Host-attested wrapper for one non-executing Hero Frame and Storyboard Canvas compile. */
export interface ImagoHeroFrameStoryboardMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-hero-frame-storyboard-method-adapter-result.v1'
  readonly projectionSha256: string
  readonly projection: ImagoHeroFrameStoryboardMethodProjection
  readonly methodAttestation: ImagoHeroFrameStoryboardMethodAttestation
}

/** Only episode identity crosses the browser-to-Host workset request. */
export interface ImagoWorksetMethodRequest {
  readonly projectId: string
  readonly episodeId: string
}

/** Source identity bound to the complete Yimeng revision object, not a display stage. */
export interface ImagoWorksetSubject extends ImagoMethodJsonObject {
  readonly project_id: string
  readonly episode_id: string
  readonly source_revision_sha256: string
  readonly input_fingerprint: string
  readonly projection_schema: 'jason.episode-workflow-projection.v1'
}

/** Host-derived input; legacy readiness never supplies IMAGO Stage or LSU approval. */
export interface ImagoWorksetMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-workset-snapshot.v2'
  readonly subject: ImagoWorksetSubject
  readonly source_projection_sha256: string
  readonly authority_snapshot: {
    readonly status: 'unavailable'
    readonly reason: 'authoritative_stage_evidence_unavailable'
  }
}

/** One current IMAGO definition, not an instantiated or approved business stage. */
export interface ImagoWorksetStageDefinition {
  readonly stage_id: string
  readonly stage_name: string
  readonly scope: 'global' | 'per_lsu'
  readonly owner_role: string
  readonly source_stage_ids: readonly string[]
  readonly required_lock_ids: readonly string[]
  readonly produces_lock_id: string | null
  readonly contract_order: number
  readonly contract_sha256: string
}

/** Explicit reason a stage, lock, or authoritative snapshot is unavailable. */
export interface ImagoWorksetBlocker {
  readonly code: string
  readonly stage_id: string | null
  readonly scope_instance: string | null
  readonly lock_id: string | null
}

/** Compiler-owned availability of one authoritative stage instance. */
export type ImagoWorksetStatus = 'blocked' | 'ready' | 'waiting_human' | 'preflight_ready' | 'complete'

/** A non-executing next action; no value grants approval or paid dispatch. */
export type ImagoWorksetAction = 'review_artifact' | 'compile_preflight' | 'prepare_work_order'

/** Stable identity for one compiler work item. */
export interface ImagoWorksetItemIdentity {
  readonly stage_id: string
  readonly scope_instance: string
}

/** Work item derived by Core from named stage evidence, never persisted by Harness. */
export interface ImagoWorksetItem extends ImagoWorksetItemIdentity {
  readonly owner_role: string
  readonly status: ImagoWorksetStatus
  readonly blockers: readonly ImagoWorksetBlocker[]
  readonly prerequisites: {
    readonly stages: readonly (ImagoWorksetItemIdentity & { readonly status: ImagoWorksetStatus })[]
    readonly locks: readonly { readonly lock_id: string; readonly status: 'absent' | 'active' }[]
  }
  readonly parallel_group: string | null
  readonly stable_sort_key: readonly [number, number, number, string]
  readonly priority_class: 'human_pending' | 'unlocked_critical_path' | 'low_cost_preflight' | 'other_legal_work' | null
  readonly allowed_action: ImagoWorksetAction | null
  readonly contract_sha256: string
}

/** Browser-safe compiler result with explicit authority and shadow-comparison limits. */
export interface ImagoWorksetProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-workset.v2'
  readonly subject: ImagoWorksetSubject
  readonly source_projection_sha256: string
  readonly input_snapshot_sha256: string
  readonly rule_bindings: Readonly<Record<string, string>>
  readonly rules_sha256: string
  readonly stage_definitions: readonly ImagoWorksetStageDefinition[]
  readonly work_items: readonly ImagoWorksetItem[]
  readonly legal_work_items: readonly ImagoWorksetItem[]
  readonly recommended_order: readonly ImagoWorksetItemIdentity[]
  readonly recommended_item: (ImagoWorksetItemIdentity & { readonly allowed_action: ImagoWorksetAction }) | null
  readonly availability: {
    readonly status: 'available' | 'partial' | 'unavailable'
    readonly authority_snapshot: 'available' | 'unavailable'
    readonly global_scope: 'available' | 'unavailable'
    readonly per_lsu_scope: 'available' | 'unavailable'
    readonly reason: string | null
  }
  readonly blockers: readonly ImagoWorksetBlocker[]
  readonly shadow_comparison: {
    readonly status: 'compared' | 'unavailable'
    readonly reason: string | null
    readonly comparison_scope: 'dependency_and_lock_readiness_only'
    readonly activation_allowed: false
    readonly execution_equivalence_claimed: false
    readonly comparisons: readonly (ImagoWorksetItemIdentity & {
      readonly compiler_dependencies_ready: boolean
      readonly controller_dependencies_ready: boolean
      readonly compiler_locks_ready: boolean
      readonly controller_locks_ready: boolean
      readonly equivalent: boolean
    })[]
  }
  readonly project_state_persisted: false
  readonly paid_provider_authority: 'not_granted'
  readonly human_approval_inferred: false
  readonly authority_snapshot_attestation: 'not_verified_by_compiler'
  readonly formal_activation_allowed: false
}

/** Read-only wrapper with no HMAC approval or command-execution proof. */
export interface ImagoWorksetMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-workset-method-adapter-result.v1'
  readonly projection: ImagoWorksetProjection
}

/** Only the selected canonical Shot identity crosses the browser-to-Host boundary. */
export interface ImagoContinuityMethodRequest extends ImagoWorksetMethodRequest {
  readonly selectedShotId: string
}

/** Fresh business subject; a revision binding does not grant approval. */
export interface ImagoContinuityMethodSubject extends ImagoContinuityMethodRequest {
  readonly storyboardRevision: YimengShotRelationsStoryboardRevision
}

/** Host-built input containing all adjacent evidence and no command authority. */
export interface ImagoContinuityMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.continuity-method-snapshot.v1'
  readonly subject: ImagoContinuityMethodSubject
  readonly shots: readonly { readonly shotId: string; readonly frameNo: number }[]
  readonly source_projection_sha256: string
  readonly source_revision_sha256: string
  readonly continuity: YimengContinuityDeltaProjection | null
}

/** An observed failed dimension awaiting human attribution, not a formal Finding. */
export interface ImagoContinuityCandidateFinding {
  readonly from_shot_id: string
  readonly to_shot_id: string
  readonly dimension: 'character' | 'scene' | 'prop' | 'action'
  readonly reason: string | null
  readonly check_id: string | null
  readonly evidence_ref: string | null
  readonly evidence_scope: 'current' | 'historical' | 'unavailable'
  readonly severity: null
  readonly earliest_owner: null
  readonly timecode: null
  readonly attribution: 'pending'
  readonly formal_finding: false
}

/** Static current-rule definition; this is never a project lock instance. */
export interface ImagoContinuityLockDefinition {
  readonly id: string
  readonly producer_stage: string
}

/** Current rule for an explicitly changed lock, without executing invalidation. */
export interface ImagoContinuityReworkPropagation {
  readonly changed_lock: string
  readonly invalidates_from: string
  readonly scope: string
}

/** Stateless explanation bound to the local current-rule source set. */
export interface ImagoContinuityFieldHelp {
  readonly field: string
  readonly label: string
  readonly help: string
  readonly source_paths: readonly string[]
}

/** Read-only inspection prompt, not a completed media review. */
export interface ImagoContinuityChecklistItem {
  readonly id: string
  readonly label: string
  readonly source_paths: readonly string[]
}

/** Selected Shot evidence, candidate findings, and non-executing current methods. */
export interface ImagoContinuityMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-continuity-method-projection.v1'
  readonly subject: ImagoContinuityMethodSubject
  readonly selected_shot: { readonly shotId: string; readonly frameNo: number }
  readonly source_projection_sha256: string
  readonly source_revision_sha256: string
  readonly input_snapshot_sha256: string
  readonly continuity_snapshot_sha256: string | null
  readonly rule_bindings: Readonly<Record<string, string>>
  readonly rules_sha256: string
  readonly availability: { readonly status: 'available' | 'unavailable'; readonly reason: string | null }
  readonly adjacent_pairs: { readonly incoming: YimengContinuityPair | null; readonly outgoing: YimengContinuityPair | null }
  readonly candidate_findings: readonly ImagoContinuityCandidateFinding[]
  readonly lock_definitions: readonly ImagoContinuityLockDefinition[]
  readonly rework_propagation: readonly ImagoContinuityReworkPropagation[]
  readonly lock_authority: { readonly status: 'unavailable'; readonly reason: 'authoritative_lock_instances_unavailable'; readonly instances: readonly never[] }
  readonly field_help: readonly ImagoContinuityFieldHelp[]
  readonly checklist: readonly ImagoContinuityChecklistItem[]
  readonly work_order: {
    readonly mode: 'read_only'
    readonly allowed_actions: readonly ['inspect_current_binding', 'inspect_historical_audit', 'review_candidate_findings', 'inspect_lock_definitions']
    readonly allowed_mutations: readonly never[]
    readonly requires_human_attribution: true
    readonly provider_calls: 0
    readonly task_mutation: false
    readonly budget_mutation: false
    readonly human_signoff_inferred: false
  }
  readonly read_only: true
  readonly provider_calls: 0
  readonly task_mutation: false
  readonly budget_mutation: false
  readonly human_signoff_inferred: false
  readonly project_state_persisted: false
  readonly formal_activation_allowed: false
}

/** Read-only response with no command or human-signoff attestation. */
export interface ImagoContinuityMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-continuity-method-adapter-result.v1'
  readonly projection: ImagoContinuityMethodProjection
}

/** Identity-only request: the Host resolves current video bytes through Yimeng. */
export type ImagoShotFindingMethodRequest = YimengSelectedVideoReviewRequest

/** Fresh selected-video snapshot; no browser-authored subject or business state. */
export interface ImagoShotFindingMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.shot-finding-method-snapshot.v1'
  readonly subject: YimengShotVideoSubject
  readonly snapshotSha256: string
}

/** Current IMAGO form contract, not a chosen Owner or an approved Finding. */
export interface ImagoShotFindingMethodDefinition {
  readonly requiredFields: readonly string[]
  readonly severities: readonly ['BLOCKER', 'MAJOR', 'MINOR']
  readonly ownerOptions: readonly { readonly stageId: string; readonly roleId: string; readonly scope: 'global' | 'per_lsu' }[]
  readonly statusOnRecord: 'OPEN'
  readonly approvalAuthority: 'not_granted'
  readonly reworkExecutionAllowed: false
}

/** Stateless current-rule projection frozen to one selected video and Shot revision. */
export interface ImagoShotFindingMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-shot-finding-method.v1'
  readonly subject: YimengShotVideoSubject
  readonly subjectSnapshotSha256: string
  readonly definition: ImagoShotFindingMethodDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Method-origin proof only; it does not grant reviewer permission or media approval. */
export interface ImagoShotFindingMethodAttestation {
  readonly schema: 'qingmu.imago-shot-finding-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Bound form plus Host HMAC, without exposing the key to the browser. */
export interface ImagoShotFindingMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-shot-finding-method-adapter-result.v1'
  readonly projection: ImagoShotFindingMethodProjection
  readonly projectionSha256: string
  readonly methodAttestation: ImagoShotFindingMethodAttestation
}

/** Identity-only request; the Host resolves current native group membership. */
export interface ImagoProductionUnitMethodRequest extends YimengProductionUnitsRequest {
  readonly groupId: string
}

/** Exact Core input, built from the configured business reader rather than browser data. */
export interface ImagoProductionUnitMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.production-unit-method-snapshot.v1'
  readonly subject: YimengProductionUnitSource
  readonly snapshotSha256: string
}

/** Current per-unit methods; this definition allocates no ID and grants no approval. */
export type ImagoProductionUnitMethodDefinition = YimengProductionUnitDefinition

/** Non-executing current-rule method bound to one exact native group source. */
export interface ImagoProductionUnitMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-production-unit-method.v1'
  readonly subject: YimengProductionUnitSource
  readonly subjectSnapshotSha256: string
  readonly definition: ImagoProductionUnitMethodDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host method-origin proof, not an owner permission or a sealed LSU plan. */
export interface ImagoProductionUnitMethodAttestation {
  readonly schema: 'qingmu.imago-production-unit-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Fresh source and current method evidence, without a binding write or allocated unit ID. */
export interface ImagoProductionUnitMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-production-unit-method-adapter-result.v1'
  readonly projection: ImagoProductionUnitMethodProjection
  readonly projectionSha256: string
  readonly methodAttestation: ImagoProductionUnitMethodAttestation
}

/** Browser supplies coordinates only; the Host obtains the full-script source digest. */
export interface ImagoStageSourceMethodRequest extends YimengStageSourcesRequest {
  readonly stageId: 'A1S'
}

/** Source-reference-only input constructed from the current business read. */
export interface ImagoStageSourceMethodSnapshot extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.stage-source-method-snapshot.v1'
  readonly stageId: 'A1S'
  readonly subject: YimengStageSource
  readonly snapshotSha256: string
}

/** Current A1S method metadata; not a global screenplay-package delivery. */
export type ImagoStageSourceMethodDefinition = YimengStageSourceDefinition

/** Stateless Core projection bound to the exact source descriptor and rule bytes. */
export interface ImagoStageSourceMethodProjection extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-stage-source-method.v1'
  readonly subject: YimengStageSource
  readonly subjectSnapshotSha256: string
  readonly definition: ImagoStageSourceMethodDefinition
  readonly ruleBindings: Readonly<Record<string, string>>
  readonly rulesSha256: string
}

/** Host-only signature authenticates method provenance, not human approval. */
export interface ImagoStageSourceMethodAttestation extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-stage-source-method-attestation.v1'
  readonly algorithm: 'hmac-sha256'
  readonly subjectSnapshotSha256: string
  readonly methodProjectionSha256: string
  readonly signature: string
}

/** Validated current source-reference method and its Host attestation. */
export interface ImagoStageSourceMethodResponse extends ImagoMethodJsonObject {
  readonly schema: 'qingmu.imago-stage-source-method-adapter-result.v1'
  readonly projection: ImagoStageSourceMethodProjection
  readonly projectionSha256: string
  readonly methodAttestation: ImagoStageSourceMethodAttestation
}

/** Result values exposed by `/qingmu-imago-method`. */
export interface ImagoMethodEndpointMap {
  readonly elementMethod: ImagoElementMethodResponse
  readonly referenceAssetMethod: ImagoReferenceAssetMethodResponse
  readonly promptIrMethod: ImagoPromptIrMethodResponse
  readonly shotRelationMethod: ImagoShotRelationMethodResponse
  readonly heroFrameStoryboardMethod: ImagoHeroFrameStoryboardMethodResponse
  readonly worksetMethod: ImagoWorksetMethodResponse
  readonly continuityMethod: ImagoContinuityMethodResponse
  readonly shotFindingMethod: ImagoShotFindingMethodResponse
  readonly productionUnitMethod: ImagoProductionUnitMethodResponse
  readonly stageSourceMethod: ImagoStageSourceMethodResponse
}

/** Endpoint names accepted by the private method channel. */
export type ImagoMethodEndpoint = keyof ImagoMethodEndpointMap
