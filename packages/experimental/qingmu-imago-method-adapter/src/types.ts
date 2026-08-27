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

/** All operations transported through the existing reference-asset method endpoint. */
export type ImagoReferenceAssetOperation = ImagoReferenceAssetActionOperation | 'replaceReferenceRights'

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
  readonly operation: 'replaceReferenceRights'
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

/** Result values exposed by `/qingmu-imago-method`. */
export interface ImagoMethodEndpointMap {
  readonly elementMethod: ImagoElementMethodResponse
  readonly referenceAssetMethod: ImagoReferenceAssetMethodResponse
  readonly promptIrMethod: ImagoPromptIrMethodResponse
}

/** Endpoint names accepted by the private method channel. */
export type ImagoMethodEndpoint = keyof ImagoMethodEndpointMap
