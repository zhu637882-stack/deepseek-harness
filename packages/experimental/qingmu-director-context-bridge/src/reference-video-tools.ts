/** Session-bound edits of the same reference draft used by the director workspace. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  ReferenceVideoAssetsResponse, ReferenceVideoDraftResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { parseReferenceVideoRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'
import { assertNativeTurnTarget } from './native-prompt-target.ts'
import type { DirectorContextBindingState } from './types.ts'
import { readReferenceImage } from './reference-image.ts'

interface BoundRead {
  session: Session
  state: DirectorContextBindingState
  seq: number | undefined
}

interface Ports {
  readBoundContext(exec: ToolRunContext): Promise<BoundRead>
  boundedJson(value: unknown): JsonValue
}

function exactKeys(value: object, keys: readonly string[]): void {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) {
    throw new Error('Only the declared draft fields are editable; the current session chooses the project and shot.')
  }
}

function assertCurrent(current: BoundRead, exec: ToolRunContext): void {
  exec.signal.throwIfAborted()
  assertNativeTurnTarget(current.session, exec.callId)
  if (current.session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq !== current.seq) {
    throw new Error('The selected shot changed. Read its reference draft again before editing.')
  }
}

function requestFor(current: BoundRead, draft: JsonValue): ReferenceVideoPreviewRequest {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('draft must be an object.')
  exactKeys(draft, ['bindings', 'promptParts', 'parameters', ...('directorSourceSha256' in draft ? ['directorSourceSha256'] : [])])
  // The Host adapter validates every nested wire field. Scope and model are not model-editable.
  return parseReferenceVideoRequest({ ...draft, projectId: current.state.binding.scope.projectId,
    frameId: current.state.binding.scope.shotId, model: 'wan3.0-video' })
}

const editableDraft = {
  type: 'json', required: true,
  description: 'Complete editable draft with bindings, promptParts, parameters and optional directorSourceSha256. bindings contains {bindingToken,assetId,assetSha256,label}. promptParts contains {text} or {bindingToken}; Write one reconciled final prompt from the latest director plan, script, style and references. Remove superseded directions; do not append new design to contradictory old prose. Set directorSourceSha256 from saved.directorSource only after this reconciliation; omit it when the source is null. This digest proves source freshness, not creative quality. parameters contains duration, resolution (480P/720P/1080P), ratio (adaptive/16:9/4:3/1:1/3:4/9:16), audio, prompt_extend, optional seed. Use assets and hashes from the current read; keep binding tokens stable. No project, frame, URL or model fields.',
} as const

/** Optional reader composition; all registrations unwind with the owning preset. */
export function registerReferenceVideoTools(ctx: Context, ports: Ports): void {
  const output = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
  ctx.tools.register(defineTool({
    name: 'qingmu_view_reference_image',
    description: 'View the actual pixels of one image from the current project asset catalog. Use its exact page, asset ID and SHA from qingmu_read_reference_draft. Inspect relevant scene, costume, prop structure or composition before visual directing decisions. Separate visible observations from inference; viewing does not approve or adopt an asset. No image generation; the active model processes an image input.',
    parameters: {
      page: { type: 'integer', required: true, description: 'Catalog page containing the image, starting at 1.' },
      assetId: { type: 'string', required: true, description: 'Exact image asset ID from the current project catalog.' },
      assetSha256: { type: 'string', required: true, description: 'Exact SHA256 from that catalog entry.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      const image = value as unknown as { attachment: ImageAttachmentRef }
      return [{ type: 'text', text: JSON.stringify(value) }, { type: 'image', attachment: image.attachment }]
    } },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '查看当前项目参考图' }),
    async execute(args, exec) {
      exactKeys(args, ['page', 'assetId', 'assetSha256'])
      const current = await ports.readBoundContext(exec)
      const scope = current.state.binding.scope
      const read = await ctx.qingmuYimengRead('referenceVideoAssets', { projectId: scope.projectId, page: args.page }, exec.signal)
      assertCurrent(current, exec)
      if (!read.ok) throw new Error(`Reference assets read failed: ${read.error.message}`)
      const catalog = read.value as ReferenceVideoAssetsResponse
      const asset = catalog.items.find(item => item.assetId === args.assetId && item.assetSha256 === args.assetSha256)
      if (!asset || asset.mediaType !== 'reference_image') throw new Error('The selected image and hash are not on this current project catalog page. Read the catalog again.')
      const attachment = await readReferenceImage(ctx, asset, exec, () => { assertCurrent(current, exec) })
      return ports.boundedJson({ schema: 'qingmu.reference-image.v1', scope,
        assetId: asset.assetId, assetSha256: asset.assetSha256, label: asset.label, attachment,
        guidance: 'Describe visible evidence and uncertainty. A reference view does not establish unseen geometry, exact physical dimensions or creative acceptance.',
        generationQueued: false, selectionChanged: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_reference_draft',
    description: 'Read this shot’s saved reference-video draft and one page of available image/voice metadata. Call before editing reference text or bindings. The draft shares the director workspace’s save/restore path. Names and metadata are not pixel inspection or creative approval. No generation or fee.',
    parameters: { page: { type: 'integer', required: true, description: 'Asset page, starting at 1. Read remaining pages when needed; a page may contain no matching media.' } },
    output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取镜头参考素材与导演稿' }),
    async execute(args, exec) {
      exactKeys(args, ['page'])
      const current = await ports.readBoundContext(exec)
      const scope = current.state.binding.scope
      const draft = await ctx.qingmuYimengRead('referenceVideoDraft', { projectId: scope.projectId, frameId: scope.shotId }, exec.signal)
      assertCurrent(current, exec)
      if (!draft.ok) throw new Error(`Reference draft read failed: ${draft.error.message}`)
      const assets = await ctx.qingmuYimengRead('referenceVideoAssets', { projectId: scope.projectId, page: args.page }, exec.signal)
      assertCurrent(current, exec)
      if (!assets.ok) throw new Error(`Reference assets read failed: ${assets.error.message}`)
      const catalog = assets.value as ReferenceVideoAssetsResponse
      return ports.boundedJson({ schema: 'qingmu.native-reference-draft.v1', scope,
        saved: draft.value as ReferenceVideoDraftResponse,
        assets: { page: catalog.page, pages: catalog.pages,
          items: catalog.items.map(({ assetId, assetSha256, label, mediaType }) => ({ assetId, assetSha256, label, mediaType })) },
        providerCalls: 0, generationQueued: false,
        guidance: 'Read saved.directorSource in full and reconcile it into a single final prompt, preserving stable bindings and unaffected decisions. Set draft.directorSourceSha256 only after reconciling. The preview emits your authored text verbatim, with reference aliases; it appends no hidden creative directions. Use saved.frameSha256 and saved.draft.revision (0 when absent) for saving. The page restores the saved version explicitly so an unsaved local edit is not overwritten.',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qingmu_preview_reference_draft',
    description: 'Compile an edited reference draft for this shot without saving or generating. Shows the exact prompt, reference aliases/order and parameters. Never infer face, clothing, scene or voice consistency from metadata alone.',
    parameters: { draft: editableDraft }, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '预览导演稿与素材引用' }),
    async execute(args, exec) {
      exactKeys(args, ['draft'])
      const current = await ports.readBoundContext(exec)
      const preview = await ctx.qingmuYimengRead('referenceVideoPreview', requestFor(current, args.draft), exec.signal)
      assertCurrent(current, exec)
      if (!preview.ok) throw new Error(`Reference draft preview failed: ${preview.error.message}`)
      const compiled = preview.value as ReferenceVideoPreviewResponse
      return ports.boundedJson({ schema: 'qingmu.native-reference-preview.v1', scope: current.state.binding.scope,
        prompt: compiled.body.input.prompt, parameters: compiled.body.parameters,
        references: compiled.referenceMapping, requestBodySha256: compiled.requestBodySha256,
        sourceSha256: compiled.sourceSha256, directorSource: compiled.directorSource,
        directorSourceAligned: compiled.directorSourceAligned, remainingChecks: compiled.remainingChecks,
        providerCalls: 0, generationQueued: false, saved: false })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qingmu_save_reference_draft',
    description: 'Save a user-requested edit to this shot’s reference draft. Supply the revision and current frame hash from the read; a conflicting browser edit must be reread and reconciled, never silently overwritten. This saves a working draft only: no selected media, approval, price confirmation or paid generation. After an uncertain response, read the draft to determine whether it saved before any further write.',
    parameters: { draft: editableDraft,
      expectedRevision: { type: 'integer', required: true, description: 'Observed saved draft revision; 0 if absent.' },
      expectedFrameSha256: { type: 'string', required: true, description: 'saved.frameSha256 from the read.' } },
    output,
    presentCall: () => ({ card: 'generic', kind: 'edit', title: '保存当前镜头导演稿' }),
    async execute(args, exec) {
      exactKeys(args, ['draft', 'expectedRevision', 'expectedFrameSha256'])
      const current = await ports.readBoundContext(exec)
      const request = requestFor(current, args.draft)
      // Draft persistence precedes temporary uploads. Provider preview requires those uploads.
      const source = await ctx.qingmuYimengRead('referenceVideoDraft', {
        projectId: request.projectId, frameId: request.frameId,
      }, exec.signal)
      assertCurrent(current, exec)
      if (!source.ok) throw new Error(`Reference draft cannot be saved: ${source.error.message}`)
      if (request.directorSourceSha256 !== (source.value as ReferenceVideoDraftResponse).directorSource?.sha256) {
        throw new Error('Read the latest directorSource and reconcile the full prompt before saving through the director tool. The existing draft remains editable.')
      }
      const { projectId, ...body } = request
      const saved = await ctx.qingmuYimengCommand('saveReferenceVideoDraft', {
        projectId, frameId: request.frameId, expectedRevision: args.expectedRevision,
        expectedFrameSha256: args.expectedFrameSha256, request: body,
      }, exec.signal)
      if (!saved.ok) throw new Error(`Draft save was not confirmed. Read it before writing again: ${saved.error.message}`)
      const value = saved.value as ReferenceVideoDraftResponse
      // A selection switch after dispatch cannot undo a confirmed write; report its captured target.
      return ports.boundedJson({ schema: 'qingmu.native-reference-saved.v1', scope: current.state.binding.scope,
        revision: value.draft?.revision, requestSha256: value.draft?.requestSha256,
        providerCalls: 0, generationQueued: false, mediaSelectionChanged: false,
        activeShotChanged: current.session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq !== current.seq,
        guidance: 'Saved to the shot identified by scope in this result. Restore it in the workspace, prepare its reference materials, then preview and quote before generating. Existing unsaved text remains local. No candidate was generated or adopted.',
      })
    },
  }))
}
