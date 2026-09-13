/** Session-bound edits of the same reference draft used by the director workspace. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  ReferenceVideoAsset, ReferenceVideoAssetsResponse, ReferenceVideoDraftResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse, ReferenceDirectorSource,
  ReferenceVideoRun, ReferenceVideoRunsResponse, ReferenceVideoFrameReceipt,
  YimengTakeCommentFeedResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { parseReferenceVideoRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'
import { assertNativeTurnTarget } from './native-prompt-target.ts'
import type { DirectorContextBindingState } from './types.ts'
import { readReferenceImage } from './reference-image.ts'
import { inspectReferenceImage, type ReferenceVisionConfig } from './reference-vision.ts'
import { creativeRequest } from './creative-request.ts'
import { readDraftImages, readImageInputs, type DraftImageInput } from './reference-draft-images.ts'

// Keep catalog pages small; the exact frozen description accompanies inspection of one image.
function imageCatalogEntry(item: ReferenceVideoAsset) {
  return { assetId: item.assetId, assetSha256: item.assetSha256, label: item.label, mediaType: item.mediaType,
    ...(item.mediaType === 'reference_image' ? {} : { durationSec: item.durationSec ?? null }),
    ...(item.imageDesign ? { originalView: item.imageDesign.view,
      sceneName: item.imageDesign.imageStage?.sceneName || item.imageDesign.sceneContext?.name || '',
      savedImageDesignAvailable: true } : {}) }
}

interface BoundRead {
  session: Session
  state: DirectorContextBindingState
  seq: number | undefined
}

interface Ports {
  referenceVision?: ReferenceVisionConfig
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

function usesDirectorText(draft: JsonValue): boolean {
  return draft !== null && typeof draft === 'object' && !Array.isArray(draft)
    && ('referenceUses' in draft || (Array.isArray(draft.promptParts) && draft.promptParts.some(part => part !== null
      && typeof part === 'object' && !Array.isArray(part) && 'directorText' in part)))
}

function currentProduction(draft: Record<string, JsonValue>, source?: ReferenceDirectorSource | null): string {
  if (!source?.generationPrompt || draft.directorSourceSha256 !== source.sha256) {
    throw new Error('Read the current director source before inserting its production text; a stale or missing source cannot be copied.')
  }
  return source.generationPrompt
}

function referenceUseParts(draft: Record<string, JsonValue>, source?: ReferenceDirectorSource | null) {
  exactKeys(draft, ['bindings', 'referenceUses', 'parameters', 'directorSourceSha256'])
  const production = currentProduction(draft, source)
  if (!Array.isArray(draft.bindings) || !Array.isArray(draft.referenceUses)) {
    throw new Error('bindings and referenceUses must be arrays.')
  }
  const purposes = new Map<string, string>()
  for (const use of draft.referenceUses) {
    if (use === null || typeof use !== 'object' || Array.isArray(use)) throw new Error('Each reference use must be an object.')
    exactKeys(use, ['bindingToken', 'purpose'])
    if (typeof use.bindingToken !== 'string' || typeof use.purpose !== 'string' || !use.purpose.trim()) {
      throw new Error('Each reference use needs its bindingToken and a nonempty purpose.')
    }
    if (purposes.has(use.bindingToken)) throw new Error('Describe each bound reference exactly once.')
    purposes.set(use.bindingToken, use.purpose)
  }
  const parts: ({ text: string } | { bindingToken: string })[] = [{ text: '【引用素材用途】\n' }]
  for (const binding of draft.bindings) {
    if (binding === null || typeof binding !== 'object' || Array.isArray(binding) || typeof binding.bindingToken !== 'string') {
      throw new Error('Each binding needs its bindingToken.')
    }
    const purpose = purposes.get(binding.bindingToken)
    if (purpose === undefined) throw new Error('Describe each bound reference exactly once; do not add unbound references.')
    purposes.delete(binding.bindingToken)
    parts.push({ bindingToken: binding.bindingToken }, { text: `：${purpose}\n` })
  }
  if (purposes.size) throw new Error('Reference uses must match the bound references.')
  parts.push({ text: '\n【本镜完整导演设计】\n' }, { text: production })
  return parts
}

function requestFor(current: BoundRead, draft: JsonValue, source?: ReferenceDirectorSource | null): ReferenceVideoPreviewRequest {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('draft must be an object.')
  if ('referenceUses' in draft) {
    return parseReferenceVideoRequest({ bindings: draft.bindings, parameters: draft.parameters,
      directorSourceSha256: draft.directorSourceSha256, promptParts: referenceUseParts(draft, source),
      projectId: current.state.binding.scope.projectId, frameId: current.state.binding.scope.shotId, model: 'wan3.0-video' })
  }
  exactKeys(draft, ['bindings', 'promptParts', 'parameters', ...('directorSourceSha256' in draft ? ['directorSourceSha256'] : [])])
  let insertions = 0
  const promptParts = Array.isArray(draft.promptParts) ? draft.promptParts.map((part) => {
    if (part === null || typeof part !== 'object' || Array.isArray(part) || !('directorText' in part)) return part
    exactKeys(part, ['directorText'])
    if (part.directorText !== 'current' || ++insertions > 1) throw new Error('Insert the current director text once, without duplicating the design.')
    return { text: currentProduction(draft, source) }
  }) : draft.promptParts
  // The Host adapter validates every nested wire field. Scope and model are not model-editable.
  return parseReferenceVideoRequest({ ...draft, promptParts, projectId: current.state.binding.scope.projectId,
    frameId: current.state.binding.scope.shotId, model: 'wan3.0-video' })
}

const editableDraft = {
  type: 'json', required: true,
  // Assembly expands into the existing editable wire format; it adds no persisted field.
  description: 'Normally supply bindings, referenceUses, parameters and directorSourceSha256. referenceUses is an array of {bindingToken,purpose}, exactly one for each binding: explain only what this source contributes and how it is used (identity, clothing, voice, scene appearance, starting/ending frame, motion or previous-shot continuation). The tool labels each reference in actual input order and appends the complete current generationPrompt exactly once as the final production design. Do not supply promptParts with referenceUses. Do not repeat the shot plan, invent shot-wide constraints, recount inspection history or write literal image/video aliases in purpose. Creative changes belong in the director plan before assembly; this operation assigns sources to that design. bindings contains {bindingToken,assetId,assetSha256,label,frameRole?}. To start from an already composed shot image, set frameRole to first_frame; optionally add one last_frame image for the intended ending. This mode takes only those one or two images and cannot mix ordinary image, audio or video references. Otherwise omit frameRole for all bindings to use multimodal references. Choose from the director design: an identity portrait or empty room is not automatically a complete shot frame. Inspect actual pixels and preserve the script, performance, camera and sound plan in the prompt; audio:true can generate native dialogue and ambience in either mode. Use ratio:adaptive when retaining frame composition matters. Never silently discard required identity or voice references to switch modes. For an intentionally authored manual prompt, promptParts may be supplied instead of referenceUses; it contains {text}, {bindingToken}, or one {directorText:"current"}. Existing manual drafts remain editable. Prefer referenceUses when assembling a saved director plan: it cannot append a second ending summary or global constraint section. Resolve contradictory source design through the director-plan workflow first. Source copying does not verify the semantics of purpose or the source plan. Set directorSourceSha256 from saved.directorSource only after this reconciliation; omit it when the source is null. This digest proves source freshness, not creative quality. parameters contains duration, resolution (480P/720P/1080P), ratio (adaptive/16:9/4:3/1:1/3:4/9:16), audio, prompt_extend, optional seed. Use assets and hashes from the current read; keep binding tokens stable. The catalog includes generated video candidates: use them as reference_video for prior performance, visible layout, motion or editing when appropriate. Video aliases (视频1, 视频2) count separately from images and audio. Up to 5 input videos totaling 15 seconds; input plus output <=30 seconds. Specify whether to continue, edit or use a clip as visual reference, and which observable state to preserve; do not blindly copy a known defect. Input videos are billed along with output. Preserve the complete director design and inspect relevant source frames before choosing. No automatic selection of candidates. No project, frame, URL or model fields.',
} as const

/** Optional reader composition; all registrations unwind with the owning preset. */
export function registerReferenceVideoTools(ctx: Context, ports: Ports): void {
  const output = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
  ctx.tools.register(defineTool({
    name: 'qingmu_preview_scene_layout',
    description: 'Preview an authored shared scene blockout from a proposed camera, with exact visibility of the supplied opaque boxes. No generation, save or adoption. Use this before changing camera when a shared layout is useful. Coordinates are metre-based x/y ground, z up; never claim they are measured from a single image. Preserve fixed volumes when trying another camera. Openings require surrounding wall pieces, not an opaque wall behind a window. Inspect the returned image and compare with actual source images. Save the chosen layout as sceneLayout on the scene asset. Save imageCamera on an asset for its image, or on the current directorPlan for its starting frame; the respective image request then includes this exact composition reference. A shot camera does not change the scene layout or inherit the scene master-image camera. It does not guarantee generated-image fidelity.',
    parameters: {
      layout: { type: 'json', required: true, description: '{basis,coordinateFrame,objects:[{id,label,center:[x,y,z],size:[x,y,z],rotation:degrees_about_z,color:"#rrggbb"}]}. One to 60 boxes, positive sizes, stable object IDs. Distinguish authored estimates from observed geometry. Use current sceneLayout if saved; describe changes instead of silently rearranging.' },
      camera: { type: 'json', required: true, description: '{position:[x,y,z],target:[x,y,z],verticalFov:10..120,roll?:degrees}. Position and target must differ. Straight-down views use plan +Y as image up before roll.' },
      ratio: { type: 'string', required: true, description: '1:1, 3:4, 4:3, 9:16 or 16:9; match the current image aspect ratio.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      const image = value as unknown as { attachment: ImageAttachmentRef; mode: string }
      return image.mode === 'direct_image' ? [{ type: 'text', text: JSON.stringify(value) }, { type: 'image', attachment: image.attachment }] : [{ type: 'text', text: JSON.stringify(value) }]
    } },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '预览共用场景取景' }),
    async execute(args, exec) {
      exactKeys(args, ['layout', 'camera', 'ratio'])
      const target = creativeRequest(exec)
      const current = target ? undefined : await ports.readBoundContext(exec)
      const scope = target ? { projectId: target.projectId, episodeId: target.episodeId } : current?.state.binding.scope
      if (!scope) throw new Error('Start from the current project before previewing its scene layout.')
      const check = () => { exec.signal.throwIfAborted(); if (current) assertCurrent(current, exec) }
      const response = await ctx.qingmuYimengCommand('previewSceneLayout', { projectId: scope.projectId, episodeId: scope.episodeId, ...args }, exec.signal)
      check()
      if (!response.ok) throw new Error(`Scene layout preview unavailable: ${response.error.message}`)
      const value = response.value as import('@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types').SceneLayoutPreview
      const attachment = await readReferenceImage(ctx, { browserUrl: value.imageUrl, assetSha256: value.sha256, label: 'Scene camera blockout' }, exec, check, ports.referenceVision)
      const inspection = await inspectReferenceImage(ctx, attachment, value.sha256, exec, check, ports.referenceVision)
      const { imageUrl: _imageUrl, ...metadata } = value
      return ports.boundedJson({ ...metadata, attachment, ...inspection, saved: false, generationQueued: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_asset_design',
    description: 'Read the current episode asset design and one page of project image metadata during screenplay, asset or scene design, before shots exist. The consumed project request fixes scope. Use qingmu_view_reference_image for relevant scene geometry, costume or prop evidence before changing a view or reconciling design conflicts. Preserve exact IDs and hashes when reusing images. This reads saved data; keep newer unsaved design supplied in the request. No save, generation or adoption.',
    parameters: { page: { type: 'integer', required: true, description: 'Project asset catalog page, starting at 1.' } }, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取当前素材设计与图片来源' }),
    async execute(args, exec) {
      exactKeys(args, ['page'])
      const target = creativeRequest(exec)
      if (!target) throw new Error('Start asset or scene design from the current project before reading its assets.')
      const scope = { projectId: target.projectId, episodeId: target.episodeId }
      const design = await ctx.qingmuYimengCommand('readAssetDesign', scope, exec.signal)
      exec.signal.throwIfAborted()
      if (!design.ok) throw new Error(`Current asset design unavailable: ${design.error.message}`)
      const read = await ctx.qingmuYimengRead('referenceVideoAssets', { projectId: target.projectId, page: args.page }, exec.signal)
      exec.signal.throwIfAborted()
      if (!read.ok) throw new Error(`Project images unavailable: ${read.error.message}`)
      const catalog = read.value as ReferenceVideoAssetsResponse
      return ports.boundedJson({ scope, saved: design.value,
        assets: { page: catalog.page, pages: catalog.pages,
          items: catalog.items.filter(item => item.mediaType === 'reference_image')
            .map(imageCatalogEntry) },
        generationQueued: false, selectionChanged: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_reference_video_candidates',
    description: 'Read generated candidates and existing time-anchored review comments before choosing continuity references. Comments retain their video hash, Take and design binding; they are attributed observations, not fresh visual inspection or approval. A historical design binding does not erase an observation of the same video. Read relevant comment pages, compare actual frames with the current design, and do not silently inherit a recorded defect. Unavailable comments differ from an empty feed. Use a known shot in the current episode. No generation, comment write or selection.',
    parameters: {
      sourceFrameId: { type: 'string', required: true, description: 'Source shot ID in the current episode; may be the previous shot.' },
      commentPage: { type: 'integer', description: 'Review comment page, starting at 1; five complete comments per page, newest first.' },
    }, output,
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取镜头视频来源' }),
    async execute(args, exec) {
      const { commentPage = 1, ...required } = args
      exactKeys(required, ['sourceFrameId'])
      if (!Number.isSafeInteger(commentPage) || commentPage < 1) throw new Error('Use a positive commentPage.')
      const current = await ports.readBoundContext(exec)
      const scope = current.state.binding.scope
      const read = await ctx.qingmuYimengRead('referenceVideoRuns', {
        projectId: scope.projectId, frameId: args.sourceFrameId,
      }, exec.signal)
      assertCurrent(current, exec)
      if (!read.ok) throw new Error(`Video candidates unavailable: ${read.error.message}`)
      const runs = read.value as ReferenceVideoRunsResponse
      const feedback = await ctx.qingmuYimengRead('takeComments', {
        projectId: scope.projectId, episodeId: scope.episodeId, frameId: args.sourceFrameId,
      }, exec.signal)
      assertCurrent(current, exec)
      const feed = feedback.ok ? feedback.value as YimengTakeCommentFeedResponse : undefined
      const comments = feed?.comments.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
      const start = (commentPage - 1) * 5
      if (comments && start >= comments.length && commentPage !== 1) throw new Error('Comment page is beyond the available feed.')
      const candidates = runs.items.flatMap(run => run.candidates)
      const reviewComments = comments ? {
        available: true, page: commentPage, total: comments.length,
        nextPage: start + 5 < comments.length ? commentPage + 1 : null,
        items: comments.slice(start, start + 5).map(comment => ({
          id: comment.id, takeId: comment.takeId, outputSha256: comment.outputSha256,
          candidateAssetIds: [...new Set(candidates
            .filter(candidate => candidate.assetSha256 === comment.outputSha256).map(candidate => candidate.assetId))],
          anchor: comment.anchor, body: comment.body, createdAt: comment.createdAt,
          frameBinding: comment.frameBinding, currentBinding: comment.currentBinding,
        })),
      } : { available: false, reason: 'Review comments could not be read for this episode and source shot.' }
      return ports.boundedJson({ projectId: runs.projectId, frameId: runs.frameId,
        items: runs.items.map(run => ({ runId: run.runId, draftRevision: run.draftRevision,
          kernelStatus: run.kernelStatus, publicStatus: run.publicStatus,
          candidates: run.candidates.map(({ assetId, assetSha256 }) => ({ assetId, assetSha256 })) })),
        reviewComments, advisoryOnly: true, providerCalls: 0, selectionChanged: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_capture_reference_video_frame',
    description: 'Capture one actual frame from an owned generated video as a reusable project image, or read whether that exact capture already exists. Capture uses the first decoded frame at or after timestampMs and reports its actual time. Image-capable directors also receive the captured pixels when available on catalog page 1; visualInputs reports missing images explicitly. Other pages remain accessible through image inspection. Use operation=read after an uncertain response. No separate observer or generation call, selection or approval. Image input uses normal director allowance. Compare the observed state before deriving continuity; one frame does not prove the whole action or audio was reviewed. Reuse its exact ID/SHA only when it fits the director design.',
    parameters: {
      sourceFrameId: { type: 'string', required: true, description: 'Source shot in the current project.' },
      runId: { type: 'string', description: 'Usually omit: resolve the exact owned video ID/SHA from current shot candidates. Supply an exact run only for an older candidate outside the recent list or ambiguous reuse. Never guess or copy a run from another video.' },
      assetId: { type: 'string', required: true, description: 'Exact source candidate video ID.' },
      expectedAssetSha256: { type: 'string', required: true, description: 'Source video SHA256.' },
      timestampMs: { type: 'integer', required: true, description: 'Nonnegative playback position in milliseconds, within the video.' },
      operation: { type: 'string', enum: ['capture', 'read'], required: true, description: 'Save the frame or recover an existing result.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      const result = value as unknown as { visualInputs?: DraftImageInput[] }
      return [{ type: 'text', text: JSON.stringify(value) }, ...(result.visualInputs ?? []).flatMap(input => input.attachment
        ? [{ type: 'image' as const, attachment: input.attachment }] : [])]
    } },
    presentCall: args => ({ card: 'generic', kind: args.operation === 'read' ? 'read' : 'edit', title: '视频画面存为参考' }),
    async execute(args, exec) {
      const { runId: _optionalRunId, ...required } = args
      exactKeys(required, ['sourceFrameId', 'assetId', 'expectedAssetSha256', 'timestampMs', 'operation'])
      const current = await ports.readBoundContext(exec)
      assertCurrent(current, exec)
      const sourceScope = { projectId: current.state.binding.scope.projectId, frameId: args.sourceFrameId }
      const candidates = await ctx.qingmuYimengRead('referenceVideoRuns', sourceScope, exec.signal)
      assertCurrent(current, exec)
      if (!candidates.ok) throw new Error('视频来源尚未核实，未执行抽帧。请读取当前项目的候选状态；不要换时间点重复抽帧。')
      const matches = (candidates.value as ReferenceVideoRunsResponse).items.filter(run =>
        run.candidates.some(candidate => candidate.assetId === args.assetId && candidate.assetSha256 === args.expectedAssetSha256))
      let run = args.runId ? matches.find(candidate => candidate.runId === args.runId) : matches.length === 1 ? matches[0] : undefined
      if (!run && args.runId && matches.length === 0) {
        const older = await ctx.qingmuYimengRead('referenceVideoRun', { ...sourceScope, runId: args.runId }, exec.signal)
        assertCurrent(current, exec)
        if (older.ok) {
          const value = older.value as ReferenceVideoRun
          if (value.candidates.some(candidate => candidate.assetId === args.assetId
            && candidate.assetSha256 === args.expectedAssetSha256)) run = value
        }
      }
      if (!run) throw new Error(matches.length
        ? `生成编号与视频不对应或存在多个来源，未执行抽帧。此视频已核实的 runId：${matches.map(match => match.runId).join(', ')}。重新读取后使用匹配来源。`
        : '当前镜头中未核实该视频 ID、SHA 与生成编号的对应关系，未执行抽帧。请读取候选来源；较早的视频可提供准确 runId，不要猜测或换时间点重试。')
      const result = await ctx.qingmuYimengCommand(args.operation === 'read' ? 'readReferenceVideoFrame' : 'captureReferenceVideoFrame', {
        ...sourceScope, runId: run.runId, assetId: args.assetId,
        expectedAssetSha256: args.expectedAssetSha256, timestampMs: args.timestampMs,
      }, exec.signal)
      assertCurrent(current, exec)
      if (!result.ok) throw new Error(`Frame capture result unconfirmed; recover the same source and timestamp: ${result.error.message}`)
      const receipt = result.value as ReferenceVideoFrameReceipt
      let visualInputs: DraftImageInput[] = []
      if (receipt.image) {
        const binding = { bindingToken: 'captured_frame', assetId: receipt.image.assetId, assetSha256: receipt.image.assetSha256 }
        try {
          const read = await ctx.qingmuYimengRead('referenceVideoAssets', { projectId: receipt.projectId, page: 1 }, exec.signal)
          assertCurrent(current, exec)
          if (!read.ok) throw new Error(read.error.message)
          visualInputs = await readImageInputs(ctx, [binding], (read.value as ReferenceVideoAssetsResponse).items,
            exec, () => assertCurrent(current, exec))
        } catch (error) {
          assertCurrent(current, exec)
          visualInputs = [{ ...binding, status: 'unavailable', reason: error instanceof Error ? error.message : 'Captured pixels are unavailable.' }]
        }
      }
      assertCurrent(current, exec)
      return ports.boundedJson({ ...receipt, visualInputs })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_view_reference_image',
    description: 'Inspect one image from the current project catalog using its exact page, asset ID and SHA from qingmu_read_asset_design (before shots) or qingmu_read_reference_draft (shot design). By default, image-capable directors receive pixels and text-only directors receive an attributed visual-model report. For uncertain contact, structure or spatial evidence, inspection=observer explicitly requests the configured visual observer even when the director can see images; it supplies the image and a separately attributed report, not a binding creative decision. Compare disagreement with visible evidence and keep unknowns explicit. No adoption or media generation. A separate visual-model call consumes normal model allowance; unchanged successful observations are reused. Do not routinely request an observer for every image.',
    parameters: {
      page: { type: 'integer', required: true, description: 'Catalog page containing the image, starting at 1.' },
      assetId: { type: 'string', required: true, description: 'Exact image asset ID from the current project catalog.' },
      assetSha256: { type: 'string', required: true, description: 'Exact SHA256 from that catalog entry.' },
      inspection: { type: 'string', enum: ['auto', 'observer'], description: 'Omit or auto for ordinary image delivery. observer explicitly requests one configured visual-model reading for uncertain visual evidence; successful unchanged reports are reused.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      const image = value as unknown as { attachment: ImageAttachmentRef; mode: string; alsoAttachImage?: boolean }
      return image.mode === 'direct_image' || image.alsoAttachImage
        ? [{ type: 'text', text: JSON.stringify(value) }, { type: 'image', attachment: image.attachment }]
        : [{ type: 'text', text: JSON.stringify(value) }]
    } },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '查看当前项目参考图' }),
    async execute(args, exec) {
      exactKeys(args, ['page', 'assetId', 'assetSha256', ...('inspection' in args ? ['inspection'] : [])])
      const target = creativeRequest(exec)
      const current = target ? undefined : await ports.readBoundContext(exec)
      const scope = target ? { projectId: target.projectId, episodeId: target.episodeId } : current?.state.binding.scope
      if (!scope) throw new Error('No current project is available for image inspection.')
      const check = () => { exec.signal.throwIfAborted(); if (current) assertCurrent(current, exec) }
      const read = await ctx.qingmuYimengRead('referenceVideoAssets', { projectId: scope.projectId, page: args.page }, exec.signal)
      check()
      if (!read.ok) throw new Error(`Reference assets read failed: ${read.error.message}`)
      const catalog = read.value as ReferenceVideoAssetsResponse
      const asset = catalog.items.find(item => item.assetId === args.assetId && item.assetSha256 === args.assetSha256)
      if (!asset || asset.mediaType !== 'reference_image') throw new Error('The selected image and hash are not on this current project catalog page. Read the catalog again.')
      const attachment = await readReferenceImage(ctx, asset, exec, check, ports.referenceVision)
      const inspection = await inspectReferenceImage(ctx, attachment, asset.assetSha256, exec,
        check, ports.referenceVision, args.inspection)
      return ports.boundedJson({ schema: 'qingmu.reference-image.v1', scope,
        assetId: asset.assetId, assetSha256: asset.assetSha256, label: asset.label, attachment,
        ...inspection, originalImageDesign: asset.imageDesign ?? null,
        guidance: 'Compare the actual pixels with originalImageDesign, the generation-time description tied to this image, and the current scene design. It is historical intent, not verified pixel geometry or a command overriding the current script. Report discrepancies instead of moving fixed objects to fit the old description. Derive a new view from the observed master image; keep explicit unknowns for unseen regions. Missing originalImageDesign means no retained source description; do not substitute the latest entity draft. A reference view does not establish unseen geometry, exact physical dimensions or creative acceptance.',
        generationQueued: false, selectionChanged: false })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'qingmu_read_reference_draft',
    description: 'Read this shot’s saved reference-video draft and one project asset page. For an image-capable director, this also delivers this page’s already-bound images with exact identities and original image designs. visualInputs records each delivered or unavailable image; metadata alone is not pixel inspection. Other pages and unbound images remain available through explicit image inspection. Videos are not watched by this read: inspect actual frames before claiming continuity. No media generation, selection or separate observer call; image input uses normal director model allowance.',
    parameters: { page: { type: 'integer', required: true, description: 'Asset page, starting at 1. Read remaining pages when needed; a page may contain no matching media.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      // Persisted results from earlier sessions contain metadata only.
      const result = value as unknown as { visualInputs?: DraftImageInput[] }
      return [{ type: 'text', text: JSON.stringify(value) }, ...(result.visualInputs ?? []).flatMap(input => input.attachment
        ? [{ type: 'image' as const, attachment: input.attachment }] : [])]
    } },
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
      const saved = draft.value as ReferenceVideoDraftResponse
      const visualInputs = await readDraftImages(ctx, saved, catalog.items, exec, () => assertCurrent(current, exec))
      assertCurrent(current, exec)
      const currentSourceSha256 = saved.directorSource?.sha256 ?? null
      const savedSourceSha256 = saved.draft?.request.directorSourceSha256 ?? null
      return ports.boundedJson({ schema: 'qingmu.native-reference-draft.v1', scope,
        saved, visualInputs,
        sourceAlignment: { currentSourceSha256, savedSourceSha256,
          matches: currentSourceSha256 && savedSourceSha256 ? currentSourceSha256 === savedSourceSha256 : null,
          guidance: 'This comparison checks only the saved draft against the current directorSource.sha256. true means its recorded source is current; false means it differs; null means a source digest is missing and alignment is unknown. A director-plan receiptId, contextSnapshotSha256, frameSha256 or requestSha256 identifies different data and must not be compared with this source digest. Matching does not certify creative quality or require any rewrite.',
        },
        assets: { page: catalog.page, pages: catalog.pages,
          items: catalog.items.map(imageCatalogEntry) },
        referenceLimits: { model: 'wan3.0-video', maxImages: 10, maxAudioClips: 5, maxVideoClips: 5,
          minClipDurationSec: 1, maxClipDurationSec: 15, maxTotalAudioSec: 15, maxTotalVideoSec: 15,
          maxInputVideoPlusOutputSec: 30, durationBasis: 'catalog_metadata_reprobed_before_submission',
          guidance: 'Missing duration is unknown. Choose voices required by this shot and its director design. Several speakers are supported; shorten reference samples when needed, never delete required dialogue or silently substitute a voice to fit a limit.' },
        providerCalls: 0, generationQueued: false,
        guidance: 'Read saved.directorSource in full. To assemble that design, supply referenceUses:[{bindingToken,purpose}] for every binding, parameters and the current directorSourceSha256; omit promptParts. State only each reference purpose, not a rewritten shot plan or global constraints. The tool renders source aliases in input order and copies generationPrompt exactly once as the final design. Adjacent-shot research is not inserted. Resolve source-design conflicts in the director plan first. Intentionally authored manual promptParts remain editable as a separate mode. Source freshness and copying are not semantic approval. Use saved.frameSha256 and saved.draft.revision (0 when absent) for saving. The page restores the saved version explicitly so an unsaved local edit is not overwritten.',
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
      let source: ReferenceDirectorSource | null | undefined
      if (usesDirectorText(args.draft)) {
        const read = await ctx.qingmuYimengRead('referenceVideoDraft', {
          projectId: current.state.binding.scope.projectId, frameId: current.state.binding.scope.shotId,
        }, exec.signal)
        assertCurrent(current, exec)
        if (!read.ok) throw new Error(`Director text unavailable: ${read.error.message}`)
        source = (read.value as ReferenceVideoDraftResponse).directorSource
      }
      const preview = await ctx.qingmuYimengRead('referenceVideoPreview', requestFor(current, args.draft, source), exec.signal)
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
      // Draft persistence precedes temporary uploads. Provider preview requires those uploads.
      const source = await ctx.qingmuYimengRead('referenceVideoDraft', {
        projectId: current.state.binding.scope.projectId, frameId: current.state.binding.scope.shotId,
      }, exec.signal)
      assertCurrent(current, exec)
      if (!source.ok) throw new Error(`Reference draft cannot be saved: ${source.error.message}`)
      const request = requestFor(current, args.draft, (source.value as ReferenceVideoDraftResponse).directorSource)
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
