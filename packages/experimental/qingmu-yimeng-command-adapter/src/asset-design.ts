/** Native asset authoring and image requests over the existing project queue. */
import type { CreationScope } from './creation.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** A single image design, with stable voice identity separate from acting direction. */
export interface AssetImageReference {
  readonly assetId: string
  readonly assetSha256: string
  readonly purpose: string
  readonly boxes?: readonly (readonly [number, number, number, number])[]
}
/** The script's world and explicit exceptions remain distinct from director proposals. */
export interface AssetWorldDesign {
  readonly setting: string
  readonly scriptFacts: string
  readonly directorInferences: string
  readonly exceptions: string
  readonly openQuestions: string
}
/** Authored room geography shared across views; distances may be proposals or unknown. */
export interface AssetSceneSpace {
  readonly orientation?: string
  readonly layout?: string
  readonly scale?: string
  readonly lighting?: string
}
/** One image's composition and temporal state, separate from persistent identity. */
export interface AssetImageStage {
  readonly sceneName?: string | null
  readonly camera?: string
  readonly blocking?: string
  readonly state?: string
}
/** Authored metre-based volumes: x/y on the ground, z up, rotation about z. */
export interface SceneLayout {
  readonly basis: string
  readonly coordinateFrame: string
  readonly objects: readonly {
    readonly id: string
    readonly label: string
    readonly center: readonly [number, number, number]
    readonly size: readonly [number, number, number]
    readonly rotation: number
    readonly color: string
  }[]
}
/** Per-image camera, separate from the shared fixed volumes. */
export interface ImageCamera {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly verticalFov: number
  readonly roll?: number
}
/** Per-image placement or absence of an existing layout object; shared geometry is unchanged. */
export interface ImageObjectState {
  readonly id: string
  readonly basis: string
  readonly visible?: boolean
  readonly center?: readonly [number, number, number] | null
  readonly size?: readonly [number, number, number] | null
  readonly rotation?: number | null
}
/** Temporary actor or prop volume for one image, excluded from shared scene geometry. */
export type ImageSubject = Omit<SceneLayout['objects'][number], 'rotation' | 'color'> & {
  readonly basis: string
  readonly rotation?: number
  readonly color?: string
}
/** Exact deterministic input preview, without model calls or media adoption. */
export interface SceneLayoutPreview extends CreationScope {
  readonly recipe: 'qingmu-blockout-v1'
  readonly imageUrl: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly objects: readonly {
    readonly id: string
    readonly label: string
    readonly color: string
    readonly pixelCount: number
    readonly bounds: readonly number[] | null
  }[]
  readonly guidance: string
}
/** One editable image design and its ordered sources. */
export interface AssetDesignItem {
  readonly kind: 'actor' | 'scene' | 'prop'
  readonly id?: string | null
  readonly name: string
  readonly description?: string
  readonly imagePrompt: string
  /** Explicitly authored complete frame; identity and story basis stay in provenance, not image instructions.
   * Omitted/false retains legacy context composition. */
  readonly selfContainedImagePrompt?: boolean
  /** Per-image model; absent/null retains the configured default. */
  readonly imageModel?: string | null
  readonly imagePromptExtend?: boolean
  /** Entity appearance/structure, independent of the current image view or edit. */
  readonly visualIdentity?: string
  readonly space?: AssetSceneSpace | null
  readonly imageStage?: AssetImageStage | null
  readonly sceneLayout?: SceneLayout | null
  readonly imageCamera?: ImageCamera | null
  readonly imageObjectStates?: readonly ImageObjectState[] | null
  readonly imageSubjects?: readonly ImageSubject[] | null
  readonly voiceIdentity?: string
  readonly designBasis?: string
  readonly view?: string
  /** Auto follows project framing for text-to-image and the last source image for edits. */
  readonly imageAspectRatio?: 'auto' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
  readonly references?: readonly AssetImageReference[]
}
/** Shared film choices authored by the director, without inferred media acceptance. */
export interface AssetDirectorDesign {
  readonly visualStyle: string
  readonly tone: string
  readonly lightingRules: string
  readonly colorPalette: readonly string[]
  readonly cameraGrammar: string
  readonly performanceRules: string
  readonly characterContinuityRules: string
}
/** Editable design saved atomically to native characters, scenes, props and director bible. */
export interface AssetDesign {
  readonly assets: readonly AssetDesignItem[]
  readonly director: AssetDirectorDesign
  readonly world?: AssetWorldDesign
}
/** Current script and asset design compared before saving or generating. */
export interface AssetDesignState extends CreationScope {
  readonly schema: 'qingmu.asset-design-state.v1'
  readonly stateSha256: string
  readonly scriptSha256: string | null
  readonly scriptRevision: number
  readonly creativeSettings?: YimengCommandJsonObject
  /** Imported product views available before the first director design. */
  readonly productAssets?: readonly AssetDesignItem[]
  /** Absent while the screenwriter inspects uploaded products for a new project. */
  readonly script: YimengCommandJsonObject | null
  readonly model: string
  readonly imageModels?: readonly {
    readonly id: string
    readonly name: string
    readonly maxReferences: number
    readonly supportsBoxes: boolean
  }[]
  readonly retainedSelections?: Readonly<Record<string, readonly string[]>>
  readonly design: (AssetDesign & { readonly sourceScriptSha256: string }) | null
}
/** Quotation is tied to exact source, prompt, model and price. */
export interface AssetImageQuote extends CreationScope {
  readonly compositionReference?: Omit<SceneLayoutPreview, keyof CreationScope> | null
  readonly mediaType?: 'audio'
  readonly entity: AssetDesignItem & { readonly id: string }
  readonly quoteSha256: string
  readonly estimatedCny: string
  readonly generationAvailable: boolean
  readonly model: string
  readonly prompt: string
  readonly capability?: 'image.generate' | 'image.edit'
  readonly references?: readonly AssetImageReference[]
}
/** Image submission reserves one task; materialization and media selection are separate. */
export interface AssetImageSubmission {
  readonly requestId: string
  readonly taskId: string
  readonly status: string
  readonly estimatedCny: string
  readonly selectionChanged: false
}
/** Reload recovers original tasks, including failures, without submitting again. */
export interface AssetImageRuns extends CreationScope {
  readonly items: readonly {
    readonly taskId: string
    readonly entityId: string
    readonly requestId: string
    readonly status: string
    readonly errorCode: string | null
    readonly assetId: string | null
  }[]
}
/** Exact per-image confirmed command. */
export interface AssetImageCommand {
  readonly requestId: string
  readonly kind: AssetDesignItem['kind']
  readonly quoteSha256: string
  readonly authorizationCapCny: string
  readonly paidConfirmed: true
}
interface Helpers { readonly inputError: (message: string) => Error; readonly responseError: (message: string) => Error }
function object(value: unknown, fail: Helpers['inputError']): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('asset design object required')
  return value as Record<string, unknown>
}
function identifier(value: unknown, fail: Helpers['inputError']): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw fail('asset design identity invalid')
  return value
}
/** Build only the native authoring, quote, queue and recovery routes.
 * @param endpoint - One allowlisted asset operation.
 * @param value - Untrusted browser payload; the backend validates authored fields.
 * @param helpers - Adapter error factories.
 * @returns A fixed-scope request and response parser; performs no I/O.
 */
export function prepareAssetDesign(endpoint: string, value: unknown, helpers: Helpers): {
  path: string
  method: 'GET' | 'POST'
  body: YimengCommandJsonObject | undefined
  normalize: (value: unknown) => unknown
} {
  const f = helpers.inputError, b = helpers.responseError, raw = object(value, f)
  const projectId = identifier(raw.projectId, f), episodeId = identifier(raw.episodeId, f)
  let path = `/api/qingmu/projects/${projectId}/episodes/${episodeId}/asset-design`
  let method: 'GET' | 'POST' = 'GET', body: YimengCommandJsonObject | undefined
  let fields = ['projectId', 'episodeId']
  switch (endpoint) {
    case 'readAssetDesign': break
    case 'setAssetLibraryState':
      fields.push('assetId', 'expectedSha256', 'deleted'); path += '/library-state'; method = 'POST'
      identifier(raw.assetId, f)
      if (typeof raw.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedSha256)
        || typeof raw.deleted !== 'boolean') throw f('asset library state invalid')
      body = { assetId: raw.assetId as string, expectedSha256: raw.expectedSha256, deleted: raw.deleted }; break

    case 'previewSceneLayout':
      fields.push('layout', 'camera', 'ratio', ...['imageObjectStates', 'imageSubjects'].filter(key => key in raw)); path += '/layout-preview'; method = 'POST'
      if (typeof raw.ratio !== 'string' || !['1:1', '3:4', '4:3', '9:16', '16:9'].includes(raw.ratio)) throw f('layout preview ratio invalid')
      if (raw.imageObjectStates != null && !Array.isArray(raw.imageObjectStates)) throw f('image object states must be an array')
      if (raw.imageSubjects != null && !Array.isArray(raw.imageSubjects)) throw f('image subjects must be an array')
      body = { layout: object(raw.layout, f), camera: object(raw.camera, f), ratio: raw.ratio,
        ...('imageObjectStates' in raw ? { imageObjectStates: raw.imageObjectStates as YimengCommandJsonObject['imageObjectStates'] } : {}),
        ...('imageSubjects' in raw ? { imageSubjects: raw.imageSubjects as YimengCommandJsonObject['imageSubjects'] } : {}) }; break
    case 'readAssetImageRuns': path += '/runs'; break
    case 'readAssetVoiceRuns': path += '/voice/runs'; break
    case 'saveAssetDesign':
      fields = [...fields, 'expectedStateSha256', 'design']; method = 'POST'
      if (typeof raw.expectedStateSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedStateSha256)) throw f('asset state SHA invalid')
      body = { expectedStateSha256: raw.expectedStateSha256, design: object(raw.design, f) }; break
    case 'quoteAssetVoice':
    case 'quoteAssetImage':
      fields.push('entityId'); path += `/${identifier(raw.entityId, f)}/${endpoint === 'quoteAssetVoice' ? 'voice/' : ''}quote`; break
    case 'generateAssetVoice':
    case 'generateAssetImage':
      fields.push('entityId', 'command'); path += `/${identifier(raw.entityId, f)}/${endpoint === 'generateAssetVoice' ? 'voice/' : ''}generate`; method = 'POST'
      body = object(raw.command, f)
      if (body.paidConfirmed !== true) throw f('image cost confirmation required')
      break
    default: throw f('unknown asset design operation')
  }
  if (Object.keys(raw).sort().join() !== fields.sort().join()) throw f('asset design fields invalid')
  return { path, method, body, normalize: (value) => {
    const result = object(value, b)
    if ((endpoint === 'generateAssetImage' || endpoint === 'generateAssetVoice')) {
      const command = object(raw.command, f)
      if (result.requestId !== command.requestId || result.estimatedCny !== command.authorizationCapCny || result.selectionChanged !== false) throw b('asset image receipt mismatch')
      identifier(result.taskId, b)
    } else {
      if (result.projectId !== projectId || result.episodeId !== episodeId) throw b('asset design scope mismatch')
      if (endpoint === 'setAssetLibraryState') {
        if (result.assetId !== raw.assetId || result.assetSha256 !== raw.expectedSha256
          || result.deleted !== raw.deleted) throw b('asset library receipt mismatch')
      } else if (endpoint === 'previewSceneLayout') {
        if (result.recipe !== 'qingmu-blockout-v1' || typeof result.imageUrl !== 'string'
          || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(result.imageUrl)
          || result.imageUrl.length > 2 * 1024 * 1024 || typeof result.sha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(result.sha256) || !Array.isArray(result.objects)) throw b('layout preview invalid')
      } else if ((endpoint === 'readAssetImageRuns' || endpoint === 'readAssetVoiceRuns')) {
        if (!Array.isArray(result.items)) throw b('asset runs missing')
      } else if ((endpoint === 'quoteAssetImage' || endpoint === 'quoteAssetVoice')) {
        if (object(result.entity, b).id !== raw.entityId || typeof result.generationAvailable !== 'boolean'
          || typeof result.estimatedCny !== 'string' || !/^\d+\.\d{6}$/.test(result.estimatedCny)
          || typeof result.quoteSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.quoteSha256)) throw b('asset quote invalid')
      } else if (result.schema !== 'qingmu.asset-design-state.v1' || typeof result.stateSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(result.stateSha256)) throw b('asset design state invalid')
    }
    return result
  } }
}
