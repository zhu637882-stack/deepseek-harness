/** Session-bound edits of the same reference draft used by the director workspace. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  ReferenceVideoAssetsResponse, ReferenceVideoDraftResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'
import { assertNativeTurnTarget } from './native-prompt-target.ts'
import type { DirectorContextBindingState } from './types.ts'

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
  exactKeys(draft, ['bindings', 'promptParts', 'parameters'])
  // The Host adapter validates every nested wire field. Scope and model are not model-editable.
  return { ...draft, projectId: current.state.binding.scope.projectId,
    frameId: current.state.binding.scope.shotId, model: 'wan3.0-video' } as unknown as ReferenceVideoPreviewRequest
}

const editableDraft = {
  type: 'json', required: true,
  description: 'Complete editable draft with exactly bindings, promptParts, parameters. bindings contains {bindingToken,assetId,assetSha256,label}. promptParts contains {text} or {bindingToken}; preserve unchanged text verbatim. parameters contains duration, resolution (480P/720P/1080P), ratio (adaptive/16:9/4:3/1:1/3:4/9:16), audio, prompt_extend, optional seed. Use assets and hashes from the current read; keep binding tokens stable. No project, frame, URL or model fields.',
} as const

/** Optional reader composition; all registrations unwind with the owning preset. */
export function registerReferenceVideoTools(ctx: Context, ports: Ports): void {
  const output = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
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
        guidance: 'Keep unchanged text and bindings. Use saved.frameSha256 and saved.draft.revision (0 when absent) for saving. The page restores the saved version explicitly so an unsaved local edit is not overwritten.',
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
        sourceSha256: compiled.sourceSha256, remainingChecks: compiled.remainingChecks,
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
      // Compile before the write; the existing save handler enforces source and draft CAS again.
      const preview = await ctx.qingmuYimengRead('referenceVideoPreview', request, exec.signal)
      assertCurrent(current, exec)
      if (!preview.ok) throw new Error(`Reference draft cannot be saved: ${preview.error.message}`)
      const { projectId, ...body } = request
      const saved = await ctx.qingmuYimengCommand('saveReferenceVideoDraft', {
        projectId, frameId: request.frameId, expectedRevision: args.expectedRevision,
        expectedFrameSha256: args.expectedFrameSha256, request: body,
      }, exec.signal)
      if (!saved.ok) throw new Error(`Draft save was not confirmed. Read it before writing again: ${saved.error.message}`)
      const value = saved.value as unknown as ReferenceVideoDraftResponse
      // A selection switch after dispatch cannot undo a confirmed write; report its captured target.
      return ports.boundedJson({ schema: 'qingmu.native-reference-saved.v1', scope: current.state.binding.scope,
        revision: value.draft?.revision, requestSha256: value.draft?.requestSha256,
        providerCalls: 0, generationQueued: false, mediaSelectionChanged: false,
        activeShotChanged: current.session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq !== current.seq,
        guidance: 'Saved to the shot identified by scope in this result. Its draft is available from the workspace’s restore action. Existing unsaved text remains local. No candidate was generated or adopted.',
      })
    },
  }))
}
