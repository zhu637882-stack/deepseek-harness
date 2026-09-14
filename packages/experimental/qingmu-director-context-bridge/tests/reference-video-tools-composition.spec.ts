/** Shipped YAML preset + agent loop + real adapters; only Writer HTTP and model responses are scripted. */
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime, { createUserMessage, ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as Persona from '@deepseek-ai/dsh-persona'
import Skills from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as SkillResources from '../src/skill-resources.ts'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import SpillLocal from '@deepseek-ai/dsh-spill-local'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { createYimengCommandHandler } from '../../qingmu-yimeng-command-adapter/src/index.ts'
import { canonical, request, response, runResponse, savedDraft, videoReferenceFixture } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { takeCommentFeed } from '../../qingmu-yimeng-read-adapter/tests/take-comment-fixture.ts'
import { MockAdapter as BaseMockAdapter, textResponse, toolCallResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ModelTools from '../src/model-tools.ts'
import { readNativeDirectorReadiness } from '../src/native-readiness.ts'
import { createDirectorContextBridge } from '../src/bridge.ts'
import type { DirectorContextSnapshot } from '../../qingmu-yimeng-command-adapter/src/types.ts'

/** Model capacity comes from the adapter, as in the shipped compaction composition. */
class MockAdapter extends BaseMockAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { ...await super.resolveModel(provider, model), context: { contextWindow: 1048576 } }
  }
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const scope = { projectId: 'p', episodeId: 'episode-a', sceneId: 'scene-a', shotId: 'f' }
const sha = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const contextBody = {
  schema: 'jason.qingmu-director-context-snapshot.v1', ...scope,
  script: { revision: 1, sha256: '0'.repeat(64) }, sceneSource: {}, sourceScene: {},
  storyboard: { id: 'revision-1', version: 1, status: 'Ready', sourceHash: 'b'.repeat(64) },
  shot: { id: 'f', title: '咖啡馆', narrative: '相遇', visual: '雨夜', action: '交谈', durationSec: 8, dialogueLineIds: [] },
  creativeContract: null, selectedReferences: [], sourceTime: '2026-09-09T12:00:00Z',
  providerCalls: 0, costAmountCny: '0', businessStateChanged: false, humanDecisionInferred: false,
  formalQcInferred: false, selectionGranted: false, readyGranted: false,
}
const context = { ...contextBody, contextSnapshotSha256: sha(contextBody) }
const planningShots = [{ id: scope.shotId, frameNo: 1, title: '咖啡馆', imagePromptCn: '', directorPlan: {} as Record<string, unknown> }]
const planning = {
  schema: 'jason.qingmu-scene-planning-state.v1', projectId: scope.projectId, episodeId: scope.episodeId,
  scriptRevision: 1, scriptSha256: context.script.sha256,
  scenes: [{ sceneIndex: 0, title: '咖啡馆', actionDescription: '交谈', dialogues: [] }], storyboard: context.storyboard,
  canonicalStoryboard: { revision: 1, sourceHash: context.storyboard.sourceHash, shotCount: 1, origin: 'automatic', shots: planningShots },
  frameRequirements: planningShots,
  planning: null, providerCalls: 0, stageStarted: false, approvalGranted: false,
}
const design = { narrative: 'The listener understands the concealed loss only after the pause.', lighting: 'Window key stays on the same world side after the reverse angle.', continuity: { blocking: 'Walk around the table via the free aisle; keep one fan.', acoustics: 'Room reflections and street bed continue beneath both speakers.' }, performance: '先迟疑，再试探，不默认点头', cameraMovement: '镜头不要停。\n先推近，再横移。',
  actionBeats: [{ startSec: 0, endSec: 1.9, action: '停顿后抬眼' }, { startSec: 1.9, endSec: 2.5, action: '试探回应' }],
  dialoguePlan: [{ character: '甲', line: '嗯。' }, { character: '乙', line: '我在听。' }],
  soundColumns: { ambient: '窗外轻雨', dialogue: '低声，保留吸气' }, newMethod: { beats: ['试探', '回应'] } }
const designReceipt = sha({ scope, context, planning })
const edit = { bindings: request.bindings, parameters: request.parameters,
  promptParts: [...request.promptParts, { text: ' 她放低声音，保持原衣服与座位。' }] }
const saveArgs = { draft: edit, expectedRevision: 1, expectedFrameSha256: savedDraft.frameSha256 }

const initialCut = { schema:'qingmu-working-cut-v1',projectId:'p',episodeId:'episode-a',revision:0,shots:[],cuts:[],
  audioLibrary:[{ assetId:'room',sha256:'b'.repeat(64),duration:30,name:'Room.wav',url:'' }, { assetId:'room-ir',sha256:'c'.repeat(64),duration:1,name:'Room-IR.wav',url:'' }],providerCalls:0,humanApprovalChanged:false }
function writer(extraShots = 0, image?: {
  sha256: string
  url: string
  config?: Record<string, unknown>
  source?: Record<string, unknown>
  assetDesign?: Record<string, unknown>
},
fixture = { request, response, savedDraft }, startingImagePrompt = planningShots[0]!.imagePromptCn) {
  const { request, response, savedDraft } = fixture
  let workingCut: Record<string, unknown> = structuredClone(initialCut)

  let saved = structuredClone(savedDraft)
  let directorSource: { sha256: string; prompt: string; generationPrompt?: string } | null = null
  let currentContext = structuredClone(context)
  let currentPlanning = structuredClone(planning)
  currentPlanning.frameRequirements[0]!.imagePromptCn = startingImagePrompt
  if (extraShots > 0) {
    const shots = [...currentPlanning.frameRequirements, ...Array.from({ length: extraShots }, (_, index) => ({
      ...planningShots[0]!, id: `other-${index}`, frameNo: index + 2,
      directorPlan: { choreography: '其他镜头的完整表演与空间调度。'.repeat(400), continuity: { start: `开始${index}`, end: `结束${index}` } },
    }))]
    currentPlanning = { ...currentPlanning, frameRequirements: shots,
      canonicalStoryboard: { ...currentPlanning.canonicalStoryboard, shots, shotCount: shots.length } }
  }
  const inputReceipt = sha({ scope, context: currentContext, planning: currentPlanning })
  const planReceipts = new Map<string, Record<string, unknown>>()
  let afterDraftRead: (() => void) | undefined
  let afterSave: (() => void) | undefined
  let loseSaveResponse = false
  let unpreparedMaterials = false
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/asset-design/layout-preview')) return Response.json({
      projectId: 'p', episodeId: 'episode-a', recipe: 'qingmu-blockout-v1',
      imageUrl: `data:image/png;base64,${imageBytes.toString('base64')}`, sha256: imageSha,
      width: 1, height: 1, objects: [], guidance: 'Authored volumes only; compare with source images.',
    })
    if (url.pathname.endsWith('/asset-design')) return Response.json({
      schema: 'qingmu.asset-design-state.v1', projectId: 'p', episodeId: 'episode-a',
      stateSha256: 'a'.repeat(64), script: {}, design: image?.assetDesign ?? { assets: [{ kind: 'scene', name: 'Library',
        space: { layout: 'Return desk beside the entrance; repair table beneath the west window.' } }] },
    })
    if (url.pathname.endsWith('/working-cut')) return Response.json(workingCut)
    if (url.pathname.endsWith('/working-cut/save')) {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
      const command = JSON.parse(init.body) as Record<string, unknown>
      workingCut = { ...initialCut, revision:1,cuts:[{ ...command,version:1,revisionId:'cut-1',status:'NotQueued' }] }
      return Response.json(workingCut)
    }
    if (url.pathname.endsWith('/director-inference/context')) return Response.json(currentContext)
    if (url.pathname.endsWith('/scene-planning')) return Response.json(currentPlanning)
    if (url.pathname.endsWith('/scene-planning/receipt')) {
      const receipt = planReceipts.get(url.searchParams.get('idempotencyKey') ?? '')
      return receipt ? Response.json(receipt) : Response.json({ detail: { code: 'planning_receipt_not_found' } }, { status: 404 })
    }
    if (url.pathname.endsWith('/scene-planning/commands')) {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      const body = JSON.parse(init.body) as {
        idempotencyKey: string
        request: { directorPlan: Record<string, unknown>; expectedStoryboardRevision: number; imagePromptCn: string }
      }
      if (body.request.expectedStoryboardRevision !== currentPlanning.storyboard.version) return Response.json({ detail: { code: 'planning_storyboard_conflict' } }, { status: 409 })
      const version = currentPlanning.storyboard.version + 1
      const storyboard = { ...currentPlanning.storyboard, id: `revision-${version}`, version,
        sourceHash: version === 2 ? 'd'.repeat(64) : sha(body.request) }
      const shots = currentPlanning.frameRequirements.map(shot => shot.id === scope.shotId
        ? { ...shot, imagePromptCn: body.request.imagePromptCn, directorPlan: body.request.directorPlan } : shot)
      currentPlanning = { ...currentPlanning, storyboard,
        frameRequirements: shots,
        canonicalStoryboard: { ...currentPlanning.canonicalStoryboard, revision: version, sourceHash: storyboard.sourceHash,
          shots } }
      const prompt = canonical(body.request.directorPlan)
      directorSource = { sha256: sha(prompt), prompt }
      const { contextSnapshotSha256: _hash, ...source } = currentContext
      // Writer projects the saved creative fields into the bound shot as well as its revision.
      const next = { ...source, storyboard,
        shot: { ...source.shot, ...body.request.directorPlan, directorPlan: body.request.directorPlan } }
      currentContext = { ...next, contextSnapshotSha256: sha(next) }
      const receipt = { schema: 'jason.qingmu-scene-planning-result.v1', projectId: scope.projectId, episodeId: scope.episodeId,
        action: 'edit_automatic', shotId: scope.shotId, idempotencyKey: body.idempotencyKey, requestSha256: sha(body.request),
        commandReceiptId: 'receipt_plan', eventId: 'event_plan', storyboard, providerCalls: 0, stageStarted: false, approvalGranted: false }
      planReceipts.set(body.idempotencyKey, receipt)
      if (loseSaveResponse) throw new Error('connection lost after director save')
      return Response.json(receipt)
    }
    if (url.pathname.endsWith('/assets')) return Response.json({ page: 1, page_size: 200, pages: 1,
      items: request.bindings.map(item => ({ id: item.assetId, project_id: 'p',
        asset_type: response.referenceMapping.find(ref => ref.assetId === item.assetId)!.mediaType.replace('reference_', ''), role: item.label, sha256: item.assetSha256,
        ...(image && item.assetId === 'asset_cafe' ? { ...image.source, sha256: image.sha256, public_url: image.url, preview_media_id: 'media_cafe', generation_config: image.config } : {}) })) })
    if (url.pathname.endsWith('/preview')) {
      if (unpreparedMaterials) return Response.json({ detail: { code: 'reference_video_material_not_prepared' } }, { status: 422 })
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON preview body')
      const input = JSON.parse(init.body) as typeof savedDraft.draft.request
      const prompt = input.promptParts.map(part => 'text' in part ? part.text
        : response.referenceMapping.find(item => item.bindingToken === part.bindingToken)!.alias).join('')
      const body = { ...response.body, input: { ...response.body.input, prompt }, parameters: { ...input.parameters, watermark: false } }
      return Response.json({ ...response, body, requestBodySha256: sha(body), directorSource,
        directorSourceAligned: input.directorSourceSha256 === directorSource?.sha256 })
    }
    if (url.pathname === '/api/qingmu/projects/p/reference-video/drafts/f') {
      if (init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new Error('Expected a JSON save body')
        const input = JSON.parse(init.body) as {
          expectedRevision: number
          expectedFrameSha256: string
          request: typeof savedDraft.draft.request
        }
        if (input.expectedRevision !== saved.draft.revision || input.expectedFrameSha256 !== saved.frameSha256) {
          return Response.json({ detail: { code: 'reference_video_draft_revision_conflict' } }, { status: 409 })
        }
        saved = { ...saved,
          mediaTypes: Object.fromEntries(input.request.bindings.map(binding =>
            [binding.bindingToken, saved.mediaTypes[binding.bindingToken as keyof typeof saved.mediaTypes]])) as typeof saved.mediaTypes,
          draft: { ...saved.draft, revision: saved.draft.revision + 1,
            request: input.request, requestSha256: sha(input.request) } }
        afterSave?.()
        if (loseSaveResponse) throw new Error('connection lost after commit')
      } else afterDraftRead?.()
      return Response.json({ ...saved, directorSource })
    }
    throw new Error(`Unexpected Writer request: ${url}`)
  })
  const read = createYimengReadHandler({}, { fetch, readToken: () => 'test-only' })
  const command = createYimengCommandHandler({}, { fetch, readToken: () => 'test-only', readYimeng: read })
  return { fetch, read, command, inputReceipt, saved: () => saved, director: () => currentPlanning.frameRequirements[0]!.directorPlan,
    planReceipt: () => sha({ scope, context: currentContext, planning: currentPlanning }),
    setDirectorSource: (value: typeof directorSource) => { directorSource = value },
    afterDraftRead: (callback: () => void) => { afterDraftRead = callback },
    afterSave: (callback: () => void) => { afterSave = callback },
    unpreparedMaterials: () => { unpreparedMaterials = true },
    loseSaveResponse: () => { loseSaveResponse = true } }
}

async function harness(adapter: MockAdapter, upstream = writer(), images = false, observer?: MockAdapter,
  route = { provider: 'mock', model: 'mock' }) {
  const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
    if (specifier === '@deepseek-ai/dsh-persona') return Persona
    if (specifier === '@deepseek-ai/dsh-compaction-basic') return BasicCompactionEngine
    if (specifier === '@deepseek-ai/dsh-skill-filesystem') return SkillFilesystem
    if (specifier === '@deepseek-ai/dsh-tool-skill') return ToolSkill
    if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/skill-resources') return SkillResources
    throw new Error(`Unexpected Loader import: ${specifier}`)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(LlmRuntime)
  if (images) {
    const imageRoot = await mkdtemp(join(tmpdir(), 'qingmu-reference-images-')); roots.push(imageRoot)
    await ctx.plugin(LocalAttachmentStore, { dshHome: imageRoot, maxImageBytes: 4096 })
  }
  await ctx.plugin(SessionStore)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Skills)
  const spillRoot = await mkdtemp(join(tmpdir(), 'qingmu-reference-spill-')); roots.push(spillRoot)
  await ctx.plugin(SpillLocal, { root: spillRoot })
  await ctx.plugin(SpillPolicy, { maxInlineBytes: 50000 })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const presets = await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
  ctx.llm.registerAdapter([route.provider], adapter)
  if (observer) ctx.llm.registerAdapter(['qingmu-vision'], observer)
  ctx.provide('qingmuYimengRead', upstream.read)
  ctx.provide('qingmuYimengCommand', upstream.command)
  ctx.provide('qingmuImagoMethod', async () => { throw new Error('No method requested by this fixture') })
  const handle = await ctx.agents.create({ sessionId: SessionId('native-reference'), agentOptions: route,
    meta: { agentPreset: 'qingmu-director' }, setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director') })
  const agent = handle.agent
  agent.session.append('qingmu-director-context/state', { version: 1,
    binding: { scope, contextSnapshotSha256: context.contextSnapshotSha256 }, proposal: null, transition: 'enter' })
  async function run(scoped = false, creative?: Record<string, unknown>) {
    if (creative) agent.session.append('qingmu-director-context/state', null)
    if (scoped) await createDirectorContextBridge({
      readDirectorContext: async () => ({ ok: true, context: context as DirectorContextSnapshot }),
    }).enter(agent.session, scope, new AbortController().signal, 'test-owner')
    const idle = new Promise<void>((resolve) => {
      const stop = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { stop(); resolve() } })
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [
      ...(creative ? [{ type: 'text' as const, text: JSON.stringify({ schema: 'qingmu.native-creative-request.v1', sessionId: agent.session.id,
        projectId: 'p', episodeId: 'episode-a', purpose: 'asset-design', ...creative }) }] : []),
      ...(scoped ? [{ type: 'text' as const, text: JSON.stringify({ schema: 'qingmu.native-director-request.v1', sessionId: agent.session.id, ownerId: 'test-owner', scope, contextSnapshotSha256: context.contextSnapshotSha256 }) }] : []),
      { type: 'text', text: '按导演设计修改当前镜头并保存，保留多说话人与完整运镜。' }] }))
    await idle
  }
  return { ctx, agent, handle, presets, upstream, run }
}

function result(agent: Agent, callId: string) {
  const item = agent.session.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === callId)
  if (!item || item.type !== 'tool/result') throw new Error(`No result for ${callId}`)
  return { error: item.data.message.content.some(part => part.isError), text: item.data.message.content.flatMap(part => part.content)
    .filter(part => part.type === 'text').map(part => part.text).join('') }
}
function saves(upstream: ReturnType<typeof writer>) {
  return upstream.fetch.mock.calls.filter(([url, init]) =>
    new URL(url instanceof Request ? url.url : url).pathname.endsWith('/drafts/f') && init?.method === 'POST')
}

it('reads the actual image preparation through the shipped director and command adapter', async () => {
  const upstream = writer()
  upstream.setDirectorSource({ sha256: '4'.repeat(64), prompt: '旧推导桌高0.6米；当前共用场景明确桌高0.75米，门在南墙。', generationPrompt: '镜头来源。' })
  const fetch = upstream.fetch.getMockImplementation()!
  const references = [{ assetId: 'room', assetSha256: 'a'.repeat(64), purpose: '当前房间固定门窗；不复用参考图开门状态。' }]
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/api/pipeline/first-frames/shooting-preview') {
      expect(JSON.parse(String(init?.body))).toEqual({ project_id: 'p', episode_id: 'episode-a', frame_ids: ['f'], reference_images: references })
      return Response.json({ schema: 'qingmu.shooting-first-frame-preview.v1', projectId: 'p', episodeId: 'episode-a', frameId: 'f',
        preflightId: '6'.repeat(64), payloadHash: '7'.repeat(64), blockers: [],
        prompt: `${String(upstream.director().generationContext)}\n起始画面：门关闭，演员站在桌西侧。`, referenceBindings: references })
    }
    return fetch(input, init)
  })
  const plan = { ...design, generationContext: '当前共用场景桌高0.75米（导演设计，非实测），门在南墙。' }
  const adapter = new MockAdapter([
    toolCallResponse('plan', 'qingmu_read_director_plan', {}),
    toolCallResponse('film', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: plan, imagePromptCn: '门关闭，演员站在桌西侧。' }),
    toolCallResponse('image-preview', 'qingmu_preview_first_frame', { referenceImages: references }),
    textResponse('首帧输入已核对；未提交媒体。'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  const read = result(h.agent, 'image-preview')
  expect(read.error, read.text).toBe(false)
  const requests = upstream.fetch.mock.calls.filter(([url]) => String(url).endsWith('/shooting-preview'))
  expect(requests).toHaveLength(1)
  expect(result(h.agent, 'save').error, result(h.agent, 'save').text).toBe(false)
  expect(upstream.director()).toEqual(plan)
  const actual = JSON.parse(read.text)
  expect(actual).toMatchSnapshot('actual first-frame input')
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(actual.preview.prompt.split('\n')[0])
  expect(upstream.fetch.mock.calls.some(([url]) => /\/(generate|submit)$/.test(String(url)))).toBe(false)
})

it.each([false, true])('continues two director saves in one turn and rejects a stale refresh (%s)', async (staleRefresh) => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  const references = [{ assetId: 'room', assetSha256: 'a'.repeat(64), purpose: '固定房间格局。' }]
  let writes = 0, finalContextRead = false
  let earlierContext: unknown
  upstream.fetch.mockImplementation(async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path.endsWith('/shooting-preview')) {
      if (writes === 1) return Response.json({ detail: '完整提示词超过模型上限，请整理重复描述。' }, { status: 409 })
      return Response.json({ schema: 'qingmu.shooting-first-frame-preview.v1', ...scope, frameId: scope.shotId,
        preflightId: '6'.repeat(64), payloadHash: '7'.repeat(64), blockers: [],
        prompt: '已整理的首帧描述，保留完整导演设计。', referenceBindings: references })
    }
    const response = await original(input, init)
    if (path.endsWith('/scene-planning/commands') && response.ok) writes++
    if (path.endsWith('/director-inference/context')) {
      if (writes === 1) earlierContext = await response.clone().json()
      // The save observes its current committed revision. A later refresh that
      // returns an earlier revision must not authorize preview or another write.
      if (writes === 2) {
        if (staleRefresh && finalContextRead) return Response.json(earlierContext)
        finalContextRead = true
      }
    }
    return response
  })
  const refined = { ...design, imageStage: '演员在门外，尚未推门。' }
  const h = await harness(new MockAdapter([
    toolCallResponse('first-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('first-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: design }),
    toolCallResponse('first-preview', 'qingmu_preview_first_frame', { referenceImages: references }),
    toolCallResponse('second-read', 'qingmu_read_director_plan', {}),
    () => toolCallResponse('second-save', 'qingmu_save_director_plan', { receiptId: upstream.planReceipt(), directorPlan: refined }),
    toolCallResponse('second-preview', 'qingmu_preview_first_frame', { referenceImages: references }),
    textResponse('已核对当前保存与预览结果。'),
  ]), upstream)
  await h.run(true)
  for (const call of ['first-save', 'second-read', 'second-save']) expect(result(h.agent, call).error, result(h.agent, call).text).toBe(false)
  expect(result(h.agent, 'first-preview').text).toContain('完整提示词超过模型上限')
  expect(writes).toBe(2)
  const last = result(h.agent, 'second-preview')
  expect(last.error, last.text).toBe(staleRefresh)
  if (staleRefresh) expect(last.text).toContain('context has changed')
  else expect(JSON.parse(last.text)).toMatchObject({ schema: 'qingmu.native-first-frame-preview.v1', providerCalls: 0 })
  expect(upstream.director()).toEqual(refined)
  expect(upstream.fetch.mock.calls.filter(([url]) => String(url).endsWith('/shooting-preview'))).toHaveLength(staleRefresh ? 1 : 2)
})

it.each([
  { title: 'compacts a long shipped director session and rereads the complete saved draft without rewriting it',
    provider: 'mock', model: 'mock', turns: 7 },
  { title: 'compacts Flash history earlier and rereads the complete saved draft without rewriting it',
    provider: 'deepseek-official', model: 'deepseek-flash', turns: 2 },
])('$title', async ({ provider, model, turns }) => {
  const oldText = 'Earlier creative discussion. '.repeat(14400)
  const checkpoint = 'Continue the selected shot by rereading its current director design and saved reference draft.'
  const historyResponse = textResponse('Recorded historical discussion.')
  historyResponse.splice(1, historyResponse.length - 1,
    { type: 'block-end', index: 0, block: { type: 'text', text: oldText } },
    { type: 'finish', reason: { kind: 'stop' } })
  const adapter = new MockAdapter([
    ...Array.from({ length: turns }, () => historyResponse),
    (options) => {
      expect(JSON.stringify(options.messages.at(-1))).toContain('acting as a compaction engine')
      return textResponse(checkpoint)
    },
    toolCallResponse('after-compact-plan', 'qingmu_read_director_plan', {}),
    toolCallResponse('after-compact-draft', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('已恢复完整设计和已存生成稿，未重复保存或生成。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider, id: model, name: model,
    context: { contextWindow: 1048576 } })
  const h = await harness(adapter, writer(), false, undefined, { provider, model })
  for (let turn = 0; turn < turns; turn += 1) await h.run(true)
  expect(h.agent.session.events.some(event => event.type === 'compaction/summary')).toBe(false)
  await h.run(true)

  const summaries = h.agent.session.events.filter(event => event.type === 'compaction/summary')
  expect(summaries).toHaveLength(1)
  expect(JSON.stringify(summaries[0])).toContain(checkpoint)
  expect(h.agent.session.events.some(event => event.type === 'assistant/message'
    && event.data.message.content.some(part => part.type === 'text' && part.text === oldText))).toBe(true)
  expect(adapter.requests).toHaveLength(turns + 4)
  expect(JSON.stringify(adapter.requests[turns + 1]?.messages)).toContain(checkpoint)
  const historyBefore = adapter.requests[turns]!.messages.filter(message => message.content.some(part => part.type === 'text' && part.text === oldText)).length
  const historyAfter = adapter.requests[turns + 1]!.messages.filter(message => message.content.some(part => part.type === 'text' && part.text === oldText)).length
  expect(historyBefore + historyAfter).toBe(turns)
  expect(historyAfter).toBeLessThan(turns)
  const restored = result(h.agent, 'after-compact-draft')
  expect(restored).toMatchObject({ error: false })
  const restoredBody: unknown = JSON.parse(restored.text)
  expect(restoredBody).toMatchObject({ saved: { draft: { request: savedDraft.draft.request } } })
  expect(result(h.agent, 'after-compact-plan').error).toBe(false)
  expect(saves(h.upstream)).toHaveLength(0)
  if (provider === 'mock') expect({ checkpoint, restored: restoredBody,
    writes: saves(h.upstream).length }).toMatchSnapshot()
})

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
const imageSha = createHash('sha256').update(imageBytes).digest('hex')
const imageUrl = `http://127.0.0.1:8115/api/media/media_cafe?signature=${'e'.repeat(64)}&expires=9999999999`
const imageArgs = { page: 1, assetId: 'asset_cafe', assetSha256: imageSha }
it.each([
  { name: 'current', current: 'c'.repeat(64), saved: 'c'.repeat(64), matches: true },
  { name: 'changed', current: 'c'.repeat(64), saved: 'd'.repeat(64), matches: false },
  { name: 'untracked', current: 'c'.repeat(64), saved: null, matches: null },
  { name: 'unavailable', current: null, saved: 'd'.repeat(64), matches: null },
  { name: 'without source', current: null, saved: null, matches: null },
])('reports $name source alignment without confusing the planning receipt or rewriting the draft', async ({ name, current, saved, matches }) => {
  const fixture = structuredClone({ request, response, savedDraft })
  fixture.savedDraft.draft.request = { ...fixture.savedDraft.draft.request,
    ...(saved ? { directorSourceSha256: saved } : {}) }
  fixture.savedDraft.draft.requestSha256 = sha(fixture.savedDraft.draft.request)
  const upstream = writer(0, undefined, fixture)
  upstream.setDirectorSource(current ? { sha256: current, prompt: 'Complete research', generationPrompt: 'Complete production' } : null)
  const adapter = new MockAdapter([
    toolCallResponse('alignment-plan', 'qingmu_read_director_plan', {}),
    toolCallResponse('alignment-draft', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('Read the saved source comparison without modifying the draft.'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  expect(result(h.agent, 'alignment-plan').error, result(h.agent, 'alignment-plan').text).toBe(false)
  expect(result(h.agent, 'alignment-draft').error, result(h.agent, 'alignment-draft').text).toBe(false)
  const plan = JSON.parse(result(h.agent, 'alignment-plan').text)
  const draft = JSON.parse(result(h.agent, 'alignment-draft').text)
  expect(plan.receiptId).not.toBe(current)
  expect(draft.sourceAlignment).toMatchObject({ currentSourceSha256: current, savedSourceSha256: saved, matches })
  expect(upstream.saved().draft).toEqual(fixture.savedDraft.draft)
  expect(saves(upstream)).toHaveLength(0)
  if (name === 'current') expect({ planningGuidance: plan.guidance, sourceAlignment: draft.sourceAlignment }).toMatchSnapshot()
})

it('delivers saved bound image pixels with the draft through the shipped director loop', async () => {
  const fixture = structuredClone({ request, response, savedDraft })
  fixture.savedDraft.draft.request = { ...fixture.savedDraft.draft.request,
    bindings: fixture.savedDraft.draft.request.bindings.map(binding => binding.assetId === 'asset_cafe'
      ? { ...binding, assetSha256: imageSha } : binding) }
  fixture.savedDraft.draft.requestSha256 = sha(fixture.savedDraft.draft.request)
  const adapter = new MockAdapter([toolCallResponse('draft-images', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('The attached scene is available for visual comparison; the unavailable portrait remains unobserved.')])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const media = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const original = { name: 'Library', imagePrompt: 'Closed door behind the return desk', view: 'Return desk looking south' }
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl,
    config: { anchor: { schema: 'qingmu.asset-image-authorization.v1', assetDesign: original } } }, fixture), true)
  await h.run(true)
  const read = result(h.agent, 'draft-images')
  expect(read.error, read.text).toBe(false)
  const value = JSON.parse(read.text) as { saved: unknown; visualInputs: import('../src/reference-draft-images.ts').DraftImageInput[] }
  const image = value.visualInputs.find(input => input.bindingToken === 'cafe')!
  expect(image).toMatchObject({ assetId: 'asset_cafe', assetSha256: imageSha, status: 'attached', originalImageDesign: original })
  expect(value.visualInputs.find(input => input.bindingToken === 'lin')).toMatchObject({ status: 'unavailable' })
  expect(value.visualInputs.some(input => input.bindingToken === 'voice')).toBe(false)
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(image.attachment!.attachmentId)
  expect(media).toHaveBeenCalledOnce()
  expect(saves(h.upstream)).toHaveLength(0)
  expect(value.saved).toMatchObject({ draft: { request: fixture.savedDraft.draft.request } })
  expect(value.visualInputs).toMatchSnapshot()
})

it('keeps a mismatched bound image unavailable without replacing the saved version', async () => {
  const adapter = new MockAdapter([toolCallResponse('stale-image', 'qingmu_read_reference_draft', { page: 1 }), textResponse('Resolve the scene version before visual editing.')])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const media = vi.spyOn(globalThis, 'fetch')
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl }), true)
  await h.run(true)
  const read = result(h.agent, 'stale-image')
  expect(read.error, read.text).toBe(false)
  expect(JSON.parse(read.text)).toMatchObject({ saved: { draft: { request: savedDraft.draft.request } },
    visualInputs: expect.arrayContaining([{ bindingToken: 'cafe', assetId: 'asset_cafe', assetSha256: 'c'.repeat(64), status: 'stale' }]) })
  expect(media).not.toHaveBeenCalled()
  expect(saves(h.upstream)).toHaveLength(0)
})

it.each([false, true])('previews camera pixels through the shipped director loop with staged objects=%s', async (staged) => {
  const input = { layout: { basis: 'Director proposal', coordinateFrame: 'Metres, x east, y north, z up', objects: [
    { id: 'desk', label: 'Desk', center: [0,0,0.4], size: [2,1,0.8], rotation: 0, color: '#887766' },
  ] }, camera: { position: [0,-4,1.6], target: [0,0,1], verticalFov: 50 }, ratio: '16:9',
  ...(staged ? { imageObjectStates: [{ id: 'desk', basis: 'This scene begins after the table was moved.', center: [2,0,0.4] }] } : {}) }
  const adapter = new MockAdapter([toolCallResponse('layout', 'qingmu_preview_scene_layout', input), textResponse('Inspect before adopting.')])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const h = await harness(adapter, writer(), true)
  await h.run(false, {})
  expect(result(h.agent, 'layout').error, result(h.agent, 'layout').text).toBe(false)
  const value = JSON.parse(result(h.agent, 'layout').text) as { attachment: { attachmentId: string; mediaType: string } }
  expect(value).toMatchObject({ projectId: 'p', episodeId: 'episode-a', recipe: 'qingmu-blockout-v1', sha256: imageSha, saved: false, generationQueued: false, mode: 'direct_image' })
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(value.attachment.attachmentId)
  const calls = h.upstream.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(calls).toHaveLength(1)
  expect(calls[0]?.[0]).toContain('/asset-design/layout-preview')
  expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual(input)
  if (!staged) expect({ ...value, attachment: { mediaType: value.attachment.mediaType } }).toMatchSnapshot()
})

it('reads saved episode geography and actual image pixels before any shot exists', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('assets', 'qingmu_read_asset_design', { page: 1 }),
    toolCallResponse('view', 'qingmu_view_reference_image', imageArgs), textResponse('场景图可供换机位；不可见布局仍待核对。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const media = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const original = { name: 'Library', view: 'From the return desk', imagePrompt: 'Closed door behind the return desk',
    imageStage: { sceneName: 'Library', camera: 'Return desk looking south', blocking: 'Empty room', state: 'Door closed' },
    space: { layout: 'Return desk beside the south entrance.' } }
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl,
    source: { owner_type: 'scene', owner_id: 'scene-a', is_selected: 0, selection_status: 'Stale', quality_status: 'pending', humanReviewStatus: 'none' },
    config: { anchor: { schema: 'qingmu.asset-image-authorization.v1', assetDesign: original } } }), true)
  await h.run(false, {})
  expect(result(h.agent, 'assets').error, result(h.agent, 'assets').text).toBe(false)
  expect(JSON.parse(result(h.agent, 'assets').text)).toMatchObject({ scope: { projectId: 'p', episodeId: 'episode-a' },
    saved: { design: { assets: [{ space: { layout: expect.stringContaining('west window') } }] } } })
  expect(result(h.agent, 'view').error, result(h.agent, 'view').text).toBe(false)
  const visible = adapter.requests.at(-1)?.messages
  expect(JSON.stringify(visible)).toContain('attachmentId')
  expect(JSON.parse(result(h.agent, 'view').text).scope).toEqual({ projectId: 'p', episodeId: 'episode-a' })
  expect(JSON.parse(result(h.agent, 'view').text).originalImageDesign).toMatchObject(original)
  const source = { ownerType: 'scene', ownerId: 'scene-a', selected: false, selectionStatus: 'Stale', qualityStatus: 'pending', humanReviewStatus: 'none' }
  expect(JSON.parse(result(h.agent, 'assets').text).assets.items).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: 'asset_cafe', source: expect.objectContaining(source) })]))
  expect(JSON.parse(result(h.agent, 'view').text).source).toMatchObject(source)
  expect(JSON.stringify(visible)).toContain('Return desk looking south')
  expect(result(h.agent, 'assets').text).not.toContain(original.imagePrompt)
  expect(media).toHaveBeenCalledOnce()
  expect(h.upstream.fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  expect(JSON.parse(result(h.agent, 'assets').text)).toMatchSnapshot()
})
it.each([
  ['other session', { sessionId: 'another' }, imageArgs],
  ['scope injected by model', {}, { ...imageArgs, projectId: 'other-project' }],
  ['foreign image', {}, { ...imageArgs, assetId: 'foreign-image' }],
  ['stale image version', {}, { ...imageArgs, assetSha256: 'a'.repeat(64) }],
] as const)('rejects a pre-production image with %s before fetching bytes', async (_label, target, args) => {
  const media = vi.spyOn(globalThis, 'fetch')
  const h = await harness(visionAdapter(args), writer(0, { sha256: imageSha, url: imageUrl }), true)
  await h.run(false, target)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(media).not.toHaveBeenCalled()
})
function visionAdapter(args: object = imageArgs) {
  const adapter = new MockAdapter([
    toolCallResponse('view', 'qingmu_view_reference_image', args),
    textResponse('已读取图像；可见事实与导演判断分开记录，未选用或生成。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  return adapter
}

function observerAdapter(script = [textResponse('可见事实：两盏灯。空间与结构：电源线从背板右下方引出。不能确认精确尺寸。')]) {
  const adapter = new MockAdapter(script)
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'qingmu-vision', id: 'qwen3.7-plus-2026-05-26', name: 'vision', inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }] } })
  return adapter
}

it('gives a text-only director an attributed visual report with reconstructible inputs and reuses unchanged observations', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('view', 'qingmu_view_reference_image', imageArgs),
    toolCallResponse('again', 'qingmu_view_reference_image', imageArgs),
    textResponse('依据视觉观察员的报告安排两盏灯，保持主导演设计。'),
  ])
  const observer = observerAdapter()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl }), true, observer)
  await h.run(true)
  expect(result(h.agent, 'view').error, result(h.agent, 'view').text).toBe(false)
  const output = JSON.parse(result(h.agent, 'view').text)
  expect(output).toMatchObject({ mode: 'vision_report', reused: false, status: 'completed', usage: { inputTokens: 10 } })
  expect(JSON.parse(result(h.agent, 'again').text)).toMatchObject({ reused: true, inspectionId: output.inspectionId })
  expect(observer.requests).toHaveLength(1)
  expect(observer.requests[0]?.messages[0]?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]))
  const recorded = h.agent.session.events.filter(e => e.type === 'qingmu-director-vision/request' || e.type === 'qingmu-director-vision/result')
  expect(recorded).toHaveLength(2)
  // Cold session loads reject required events absent from the runtime vocabulary.
  for (const event of recorded) expect(KNOWN_SESSION_EVENT_TYPES.has(event.type)).toBe(true)
  expect(recorded[0]?.data).toMatchObject({ request: { messages: observer.requests[0]?.messages } })
  expect(JSON.stringify(recorded)).not.toContain('signature=')
  expect(JSON.stringify(recorded)).not.toContain(imageBytes.toString('base64'))
  expect(JSON.stringify(adapter.requests.at(-1))).toContain(output.report)
  const tool = h.agent.session.events.find(e => e.type === 'tool/result' && e.data.message.source.callId === 'view')
  if (tool?.type !== 'tool/result') throw new Error('Missing visual report')
  expect(tool.data.message.content.flatMap(p => p.content).some(p => p.type === 'image')).toBe(false)
  expect({ content: tool.data.message.content.flatMap(p => p.content),
    observerInput: observer.requests[0]?.messages.map(({ role, source, content }) => ({ role, source, content })) }).toMatchSnapshot()
})

it('lets an image-capable director explicitly obtain and reuse a separate visual reading', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('direct', 'qingmu_view_reference_image', imageArgs),
    toolCallResponse('second-reading', 'qingmu_view_reference_image', { ...imageArgs, inspection: 'observer' }),
    toolCallResponse('reuse-reading', 'qingmu_view_reference_image', { ...imageArgs, inspection: 'observer' }),
    textResponse('Compare the attributed observations with the image; the director retains the design decision.'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const observer = observerAdapter()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl }), true, observer)
  await h.run(true)
  expect(JSON.parse(result(h.agent, 'direct').text)).toMatchObject({ mode: 'direct_image' })
  const report = JSON.parse(result(h.agent, 'second-reading').text)
  expect(report).toMatchObject({ mode: 'vision_report', reused: false, alsoAttachImage: true, status: 'completed' })
  expect(JSON.parse(result(h.agent, 'reuse-reading').text)).toMatchObject({ reused: true, inspectionId: report.inspectionId })
  expect(observer.requests).toHaveLength(1)
  expect(observer.requests[0]?.messages[0]?.content.some(c => c.type === 'image')).toBe(true)
  const tool = h.agent.session.events.find(e => e.type === 'tool/result' && e.data.message.source.callId === 'second-reading')
  if (tool?.type !== 'tool/result') throw new Error('Missing second visual reading')
  expect(tool.data.message.content.flatMap(p => p.content)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]))
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(report.report)
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(report.attachment.attachmentId)
  expect(tool.data.message.content.flatMap(p => p.content)).toMatchSnapshot()
  expect(saves(h.upstream)).toHaveLength(0)
})

it.each(['truncated', 'missing usage', 'switched shot'])('retains observer receipts without misrepresenting %s as a delivered report', async (condition) => {
  const adapter = new MockAdapter([toolCallResponse('view', 'qingmu_view_reference_image', imageArgs), textResponse('未完成当前镜头核验。')])
  const observer = observerAdapter()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl }), true, observer)
  vi.spyOn(observer, 'stream').mockImplementation(async function* () {
    if (condition === 'switched shot') h.agent.session.append('qingmu-director-context/state', null)
    yield* (condition === 'truncated' ? maxTokensResponse('部分内容') : textResponse('观察内容').filter(c => condition !== 'missing usage' || c.type !== 'usage'))
  })
  await h.run(true)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(observer.stream).toHaveBeenCalledOnce()
  const receipt = h.agent.session.events.findLast(e => e.type === 'qingmu-director-vision/result')
  expect(receipt?.data).toMatchObject({ status: condition === 'switched shot' ? 'completed' : 'failed' })
})

it('delivers catalog image pixels through the shipped director preset and persists reconstructible attachments', async () => {
  const adapter = visionAdapter()
  const media = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl }), true)
  await h.run(true)
  expect(result(h.agent, 'view').error, result(h.agent, 'view').text).toBe(false)
  const entry = h.agent.session.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === 'view')
  if (entry?.type !== 'tool/result') throw new Error('Missing image result')
  const content = entry.data.message.content.flatMap(part => part.content)
  const image = content.find(part => part.type === 'image')
  if (image?.type !== 'image') throw new Error('Missing model-visible image')
  const stored = await h.ctx.attachments.readImage(image.attachment)
  expect(stored.data.byteLength).toBeGreaterThan(0)
  const visible = JSON.stringify(adapter.requests.at(-1))
  expect(visible).toContain(image.attachment.attachmentId)
  expect(visible).not.toContain('signature=')
  expect(visible).not.toContain(imageBytes.toString('base64'))
  expect(JSON.stringify(entry)).not.toContain('signature=')
  expect(media).toHaveBeenCalledOnce()
  expect(media.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
  expect(content).toMatchSnapshot()
})

it.each([
  ['wrong project asset', { ...imageArgs, assetId: 'asset_from_other_project' }, 'not on this current project'],
  ['stale version', { ...imageArgs, assetSha256: 'a'.repeat(64) }, 'not on this current project'],
  ['voice instead of image', { page: 1, assetId: 'asset_voice', assetSha256: 'b'.repeat(64) }, 'not on this current project'],
  ['arbitrary URL argument', { ...imageArgs, url: imageUrl }, 'Only the declared'],
])('refuses %s before fetching image bytes', async (_name, args, error) => {
  const media = vi.spyOn(globalThis, 'fetch')
  const h = await harness(visionAdapter(args), writer(0, { sha256: imageSha, url: imageUrl }), true)
  await h.run(true)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(result(h.agent, 'view').text).toContain(error)
  expect(media).not.toHaveBeenCalled()
})

it.each(['non-vision model', 'no attachment store', 'unverified URL'])('refuses image inspection with %s', async (reason) => {
  const adapter = visionAdapter()
  if (reason === 'non-vision model') vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text'] })
  const media = vi.spyOn(globalThis, 'fetch')
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: reason === 'unverified URL' ? 'https://example.com/image.png' : imageUrl }), reason !== 'no attachment store')
  await h.run(true)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(media).not.toHaveBeenCalled()
})

it.each([
  ['different source bytes', () => new Response('changed', { headers: { 'content-type': 'image/png' } }), 'do not match'],
  ['unsupported media', () => new Response('audio', { headers: { 'content-type': 'audio/wav' } }), 'not a supported raster'],
  ['large content length', () => new Response(imageBytes, { headers: { 'content-type': 'image/png', 'content-length': '9000' } }), 'byte limit'],
  ['large chunked body', () => new Response(new Uint8Array(5000), { headers: { 'content-type': 'image/png' } }), 'byte limit'],
  ['expired link', () => new Response('', { status: 403 }), 'HTTP 403'],
])('does not project an image from %s', async (_name, response, error) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
  const h = await harness(visionAdapter(), writer(0, { sha256: imageSha, url: imageUrl }), true)
  await h.run(true)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(result(h.agent, 'view').text).toContain(error)
  expect(JSON.stringify(h.agent.session.events.filter(event => event.type === 'tool/result'))).not.toContain('"attachmentId"')
})

it('discards a downloaded image when the bound shot changes during the read', async () => {
  const h = await harness(visionAdapter(), writer(0, { sha256: imageSha, url: imageUrl }), true)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    h.agent.session.append('qingmu-director-context/state', null)
    return new Response(imageBytes, { headers: { 'content-type': 'image/png' } })
  })
  await h.run(true)
  expect(result(h.agent, 'view').error).toBe(true)
  expect(JSON.stringify(h.agent.session.events.filter(event => event.type === 'tool/result'))).not.toContain('"attachmentId"')
})

it('gives the director recorded audio durations and total limits without assuming one speaker', async () => {
  const adapter = new MockAdapter([toolCallResponse('duration-read', 'qingmu_read_reference_draft', { page: 1 }), textResponse('Read only')])
  const upstream = writer()
  const original = upstream.fetch.getMockImplementation()!
  upstream.fetch.mockImplementation(async (...args) => {
    const response = await original(...args)
    if (new URL(args[0] instanceof Request ? args[0].url : args[0]).pathname.endsWith('/assets')) {
      const value = await response.json()
      value.items.find((item: { id: string }) => item.id === 'asset_voice').duration_sec = 8.4985
      return Response.json(value)
    }
    return response
  })
  const h = await harness(adapter, upstream); await h.run(true)
  const value = JSON.parse(result(h.agent, 'duration-read').text)
  expect(value.assets.items.find((item: { assetId: string }) => item.assetId === 'asset_voice')).toMatchObject({ durationSec: 8.4985 })
  expect(value.referenceLimits).toMatchObject({ maxAudioClips: 5, maxTotalAudioSec: 15, maxTotalVideoSec: 15 })
  expect(value.referenceLimits.guidance).toContain('Several speakers are supported')
  expect(value.generationQueued).toBe(false)
})

it('saves a full director plan through the native preset and Writer adapter, then continues the scoped turn', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('design-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('design-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: design }),
    toolCallResponse('design-reread', 'qingmu_read_director_plan', {}),
    textResponse('导演设计已保存；尚未生成。'),
  ])
  const h = await harness(adapter); await h.run(true)
  for (const id of ['design-read', 'design-save', 'design-reread']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  expect(h.upstream.director()).toEqual(design)
  expect(JSON.parse(result(h.agent, 'design-reread').text)).toMatchObject({ planning: { frameRequirements: [{ directorPlan: design }] } })
  expect(JSON.parse(result(h.agent, 'design-save').text)).toMatchObject({ result: { recovered: false, providerCalls: 0 }, continuation: { before: context.contextSnapshotSha256 } })
  expect(JSON.stringify(adapter.requests.at(-1))).toContain('newMethod')
  expect(h.upstream.fetch.mock.calls.filter(([url]) =>
    new URL(url instanceof Request ? url.url : url).pathname.endsWith('/scene-planning/commands'))).toHaveLength(1)
})

it.each(['current', 'missing', 'changed', 'unavailable'])(
  'requires the actual current film source before saving segment context (%s)', async (state) => {
    const upstream = writer()
    const source = { sha256: '4'.repeat(64), prompt: '当前共享场景：门在端墙、窗与门垂直，柜台位于中央。两位人物；年代例外按剧本保留。', generationPrompt: '本镜执行设计。' }
    upstream.setDirectorSource(source)
    const fetch = upstream.fetch.getMockImplementation()!
    let sourceReads = 0
    upstream.fetch.mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.endsWith('/reference-video/drafts/f') && init?.method !== 'POST') {
        sourceReads++
        if (sourceReads === 2 && state === 'changed') upstream.setDirectorSource({ ...source, sha256: '5'.repeat(64), prompt: '当前场景已修订，不能保存旧理解。' })
        if (sourceReads === 2 && state === 'unavailable') return Response.json({ detail: 'Source unavailable' }, { status: 503 })
      }
      return fetch(input, init)
    })
    const plan = { ...design, generationContext: source.prompt }
    const adapter = new MockAdapter([
      toolCallResponse('plan', 'qingmu_read_director_plan', {}),
      ...(state === 'missing' ? [] : [toolCallResponse('film', 'qingmu_read_reference_draft', { page: 1 })]),
      toolCallResponse('save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: plan }),
      textResponse('核对完成，未生成。'),
    ])
    const h = await harness(adapter, upstream); await h.run(true)
    const read = JSON.parse(result(h.agent, 'plan').text)
    expect(read.filmSource).toMatchSnapshot()
    if (state !== 'missing') {
      expect(result(h.agent, 'film').error, result(h.agent, 'film').text).toBe(false)
      expect(JSON.parse(result(h.agent, 'film').text).saved.directorSource).toEqual(source)
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(source.prompt)
    }
    const saved = result(h.agent, 'save')
    expect(saved.error, saved.text).toBe(state !== 'current')
    expect(upstream.director()).toEqual(state === 'current' ? plan : {})
    const writes = upstream.fetch.mock.calls.filter(([input]) => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/scene-planning/commands'))
    expect(writes).toHaveLength(state === 'current' ? 1 : 0)
    if (state === 'missing' || state === 'changed') expect(saved.text).toContain('qingmu_read_reference_draft')
    if (state === 'unavailable') expect(saved.text).toContain('全片导演来源无法核实')
  },
)

it('delivers saved shot timing and complete dialogue through the shipped director tools', async () => {
  const upstream = writer()
  const originalFetch = upstream.fetch.getMockImplementation()!
  const timing = { durationSec: 12.75, dialogue: { lines: [
    { actorId: 'actor_a', sourceLineId: 'line_a', line: '嗯，我在听。', delivery: '吸气后低声回应', startSec: 4.25, endSec: 6.5, overlap: true },
  ], roomTone: '保留室内底声' } }
  upstream.fetch.mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    const url = new URL(input instanceof Request ? input.url : input)
    if (!url.pathname.endsWith('/scene-planning')) return response
    const body = await response.json() as typeof planning
    const shots = body.frameRequirements.map(shot => ({ ...shot, ...timing }))
    return Response.json({ ...body, frameRequirements: shots, canonicalStoryboard: { ...body.canonicalStoryboard, shots } })
  })
  const adapter = new MockAdapter([
    toolCallResponse('timing-read', 'qingmu_read_director_plan', {}), textResponse('按实际时长和原对白设计。'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  const read = result(h.agent, 'timing-read')
  expect(read.error, read.text).toBe(false)
  const shot = JSON.parse(read.text).planning.frameRequirements[0]
  expect({ durationSec: shot.durationSec, dialogue: shot.dialogue }).toEqual(timing)
  const messages = JSON.stringify(adapter.requests.at(-1)?.messages)
  expect(messages).toContain('12.75')
  expect(messages).toContain('吸气后低声回应')
  expect(messages).toContain('line_a')
  expect({ durationSec: shot.durationSec, dialogue: shot.dialogue }).toMatchSnapshot('saved timing and original dialogue')
})

it('carries the shared source read into the actual director save command', async () => {
  const upstream = writer()
  const source = { sha256: '4'.repeat(64), prompt: '当前世界改为西侧入口，保留剧本改造例外。', generationPrompt: '沿西侧门进入。' }
  upstream.setDirectorSource(source)
  const originalFetch = upstream.fetch.getMockImplementation()!
  const currentSource = { state: 'changed', sha256: '6'.repeat(64), changes: ['剧本世界与例外'] }
  let readReceipt = ''
  upstream.fetch.mockImplementation(async (input, init) => {
    const response = await originalFetch(input, init)
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/scene-planning')) {
      const body = await response.json() as typeof planning
      const shots = body.frameRequirements.map(shot => ({ ...shot, generationContextSource: currentSource }))
      const value = { ...body, frameRequirements: shots, canonicalStoryboard: { ...body.canonicalStoryboard, shots } }
      readReceipt = sha({ scope, context, planning: value })
      return Response.json(value)
    }
    return response
  })
  // The fixture's initial read receipt is deterministic, including current source status.
  const shots = planning.frameRequirements.map(shot => ({ ...shot, generationContextSource: currentSource }))
  const expectedReceipt = sha({ scope, context, planning: { ...planning, frameRequirements: shots,
    canonicalStoryboard: { ...planning.canonicalStoryboard, shots } } })
  const adapter = new MockAdapter([
    toolCallResponse('shared-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('shared-film', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('shared-save', 'qingmu_save_director_plan', { receiptId: expectedReceipt,
      directorPlan: { generationContext: source.prompt, cameraMovement: '沿西侧入口跟拍' } }),
    textResponse('已保存当前镜头的设定同步稿。'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  expect(readReceipt).toBe(expectedReceipt)
  expect(result(h.agent, 'shared-save').error, result(h.agent, 'shared-save').text).toBe(false)
  const read = JSON.parse(result(h.agent, 'shared-read').text)
  expect(read.planning.frameRequirements[0].generationContextSource).toEqual(currentSource)
  expect(read.planning.frameRequirements[0].generationContextSource).toMatchSnapshot('shared creative source status delivered to director')
  const calls = upstream.fetch.mock.calls.filter(([input]) => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/scene-planning/commands'))
  expect(calls).toHaveLength(1)
  expect(JSON.parse(String(calls[0]?.[1]?.body)).request.expectedGenerationContextSourceSha256).toBe(currentSource.sha256)
})

it.each([false, true])('uses the film source delivered together with bound image pixels (changed=%s)', async (changed) => {
  const fixture = structuredClone({ request, response, savedDraft })
  fixture.savedDraft.draft.request.bindings = fixture.savedDraft.draft.request.bindings.map(binding =>
    binding.assetId === 'asset_cafe' ? { ...binding, assetSha256: imageSha } : binding)
  fixture.savedDraft.draft.requestSha256 = sha(fixture.savedDraft.draft.request)
  const upstream = writer(0, { sha256: imageSha, url: imageUrl }, fixture)
  const source = { sha256: '4'.repeat(64), prompt: '窗与门垂直，借还台在房间中央；两位人物。', generationPrompt: '本段交还图书。' }
  upstream.setDirectorSource(source)
  const fetch = upstream.fetch.getMockImplementation()!
  let reads = 0
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/reference-video/drafts/f') && init?.method !== 'POST' && ++reads === 2 && changed)
      upstream.setDirectorSource({ ...source, sha256: '5'.repeat(64), prompt: '共享空间已修订。' })
    return fetch(input, init)
  })
  const plan = { generationContext: source.prompt }
  const adapter = new MockAdapter([
    toolCallResponse('plan', 'qingmu_read_director_plan', {}),
    toolCallResponse('film-images', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: plan }),
    textResponse('未生成或选用媒体。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, upstream, true); await h.run(true)
  const read = result(h.agent, 'film-images'), save = result(h.agent, 'save')
  expect(read.error, read.text).toBe(false)
  const film = JSON.parse(read.text) as { saved: { directorSource: typeof source }; visualInputs: import('../src/reference-draft-images.ts').DraftImageInput[] }
  const attached = film.visualInputs.find(input => input.status === 'attached')!
  expect(attached.attachment).toBeDefined()
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain(attached.attachment!.attachmentId)
  expect(save.error, save.text).toBe(changed)
  expect(upstream.director()).toEqual(changed ? {} : plan)
  const writes = upstream.fetch.mock.calls.filter(([input]) => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/scene-planning/commands'))
  expect(writes).toHaveLength(changed ? 0 : 1)
  expect({ source: film.saved.directorSource, imageDelivered: attached.status,
    saved: !save.error, sourceChangedRejected: changed ? save.text.includes('全片、世界或资产设计已变化') : null }).toMatchSnapshot()
})

it.each([undefined, '门内平视，来客停在门边。', ''])(
  'saves an explicit starting still (%s) with direction, or preserves it when omitted', async (imagePromptCn) => {
    const plan = { ...design, ...(imagePromptCn ? { selfContainedImagePrompt: true } : {}),
      editorialContext: { transitionOut: '下段转到窗外，雨声跨越切点' }, visual: '来客在门边站定，与屋内听者对视；其余调度沿用。' }
    const upstream = writer(0, undefined, undefined, '原画面描述须显式修改。')
    const args = { receiptId: upstream.inputReceipt, directorPlan: plan,
      ...(imagePromptCn === undefined ? {} : { imagePromptCn }) }
    const adapter = new MockAdapter([
      toolCallResponse('read', 'qingmu_read_director_plan', {}),
      toolCallResponse('save', 'qingmu_save_director_plan', args),
      toolCallResponse('reread', 'qingmu_read_director_plan', {}),
      textResponse('画面设计与起始图要求已保存，未生成媒体。'),
    ])
    const h = await harness(adapter, upstream); await h.run(true)
    expect(result(h.agent, 'save').error, result(h.agent, 'save').text).toBe(false)
    const shot = JSON.parse(result(h.agent, 'reread').text).planning.frameRequirements[0]
    expect(shot).toMatchObject({ imagePromptCn: imagePromptCn ?? '原画面描述须显式修改。', directorPlan: plan })
    const commands = h.upstream.fetch.mock.calls.filter(([url]) =>
      new URL(url instanceof Request ? url.url : url).pathname.endsWith('/scene-planning/commands'))
    expect(commands).toHaveLength(1)
    const body = JSON.parse(commands[0]![1]!.body as string)
    expect(body.request).toMatchObject({ imagePromptCn: shot.imagePromptCn, directorPlan: plan })
    const saved = JSON.parse(result(h.agent, 'save').text)
    expect({ imagePromptCn: shot.imagePromptCn, visual: shot.directorPlan.visual,
      selfContainedImagePrompt: shot.directorPlan.selfContainedImagePrompt ?? false,
      cameraMovement: shot.directorPlan.cameraMovement, providerCalls: saved.providerCalls,
      mediaGenerated: saved.mediaGenerated }).toMatchSnapshot()
  },
)

it('saves a selected design from an episode larger than the real inline result limit without losing its receipt', async () => {
  const upstream = writer(8)
  const adapter = new MockAdapter([
    toolCallResponse('large-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('large-save', 'qingmu_save_director_plan', { receiptId: upstream.inputReceipt, directorPlan: design }),
    toolCallResponse('large-reread', 'qingmu_read_director_plan', {}),
    textResponse('完整导演设计已保存，未生成媒体。'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  for (const id of ['large-read', 'large-save', 'large-reread']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const visible = JSON.parse(result(h.agent, 'large-read').text) as {
    coverage: string
    scope: typeof scope
    planning: { frameRequirements: typeof planningShots }
    episodeContinuity: { shotId: string; continuity: unknown }[]
  }
  expect(Buffer.byteLength(result(h.agent, 'large-read').text)).toBeLessThan(48000)
  expect(visible.planning.frameRequirements.map((shot: { id: string }) => shot.id)).toEqual(['f'])
  expect(visible.episodeContinuity).toHaveLength(9)
  expect(visible.episodeContinuity.at(-1)).toMatchObject({ shotId: 'other-7', continuity: { start: '开始7', end: '结束7' } })
  const retained = h.agent.session.events.find(event => event.type === 'qingmu-director-dialogue/receipt'
    && event.data.callId === 'large-read')
  expect(Buffer.byteLength(JSON.stringify(retained))).toBeGreaterThan(50000)
  expect(h.upstream.director()).toEqual(design)
  const saved = JSON.parse(result(h.agent, 'large-save').text) as { schema: string; providerCalls: number; mediaGenerated: boolean }
  const reread = JSON.parse(result(h.agent, 'large-reread').text) as typeof visible
  expect({ coverage: visible.coverage, readScope: visible.scope,
    saved: { schema: saved.schema, providerCalls: saved.providerCalls, mediaGenerated: saved.mediaGenerated },
    directorPlan: reread.planning.frameRequirements[0]!.directorPlan,
  }).toMatchSnapshot()
})

it('recovers an uncertain director save with the identical command and never posts twice', async () => {
  const upstream = writer(); upstream.loseSaveResponse()
  upstream.setDirectorSource({ sha256: '4'.repeat(64), prompt: '当前完整全片来源。' })
  const recoveredPlan = { ...design, generationContext: '本镜按当前全片来源设计。' }
  const args = { receiptId: designReceipt, directorPlan: recoveredPlan, imagePromptCn: '断线后恢复同一画面描述。' }
  const adapter = new MockAdapter([toolCallResponse('design-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('film-read', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('design-save', 'qingmu_save_director_plan', args),
    toolCallResponse('design-recover', 'qingmu_save_director_plan', args), textResponse('已恢复保存回执。')])
  const h = await harness(adapter, upstream); await h.run(true)
  expect(result(h.agent, 'design-save').error).toBe(true)
  expect(result(h.agent, 'design-recover').error, result(h.agent, 'design-recover').text).toBe(false)
  expect(JSON.parse(result(h.agent, 'design-recover').text)).toMatchObject({ result: { recovered: true } })
  expect(h.upstream.director()).toEqual(recoveredPlan)
  expect(h.upstream.fetch.mock.calls.filter(([url]) =>
    new URL(url instanceof Request ? url.url : url).pathname.endsWith('/scene-planning/commands'))).toHaveLength(1)
})

it('reopens a rich saved director design without repeating its context copy or losing creative fields', async () => {
  const fullPlan = { ...design, departmentDetail: '保留空间表演声音。'.repeat(1200) }
  const adapter = new MockAdapter([
    toolCallResponse('rich-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('rich-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: fullPlan }),
    toolCallResponse('rich-reopen', 'qingmu_read_director_plan', {}),
    textResponse('完整设计可继续编辑。'),
  ])
  const h = await harness(adapter); await h.run(true)
  for (const id of ['rich-read', 'rich-save', 'rich-reopen']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const visible = JSON.parse(result(h.agent, 'rich-reopen').text)
  expect(visible.planning.frameRequirements[0].directorPlan).toEqual(fullPlan)
  expect(visible.context.shot.directorPlan).toBeUndefined()
  expect(visible.context.shot.id).toBe('f')
  expect(Buffer.byteLength(result(h.agent, 'rich-reopen').text)).toBeLessThan(48000)
  const retained = h.agent.session.events.find(event => event.type === 'qingmu-director-dialogue/receipt' && event.data.callId === 'rich-reopen')
  expect(retained?.type === 'qingmu-director-dialogue/receipt' && (retained.data.value as unknown as { context: { shot: { directorPlan: unknown } } }).context.shot.directorPlan).toEqual(fullPlan)
})

it('keeps a rich starting image readable and editable through exact aliases without hiding conflicting decisions', async () => {
  const visual = '门在北墙，窗在西墙；人物仍站在门内，手上没有后续才拿到的物件。'.repeat(90)
  const fullPlan = { ...design, visual, blocking: '下一拍才从门边沿通道走到窗下。',
    departmentDetail: '保留时代例外、物理因果、场景陈设和表演节奏。'.repeat(490) }
  const nextPlan = { ...fullPlan, performance: '听完话后才转头，保留呼吸与街声。' }
  const upstream = writer()
  const adapter = new MockAdapter([
    toolCallResponse('alias-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('alias-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: fullPlan, imagePromptCn: visual }),
    toolCallResponse('alias-reopen', 'qingmu_read_director_plan', {}),
    () => toolCallResponse('alias-edit', 'qingmu_save_director_plan', {
      receiptId: upstream.planReceipt(), directorPlan: nextPlan,
    }),
    textResponse('完整画面及部门设计已保留，可继续编辑。'),
  ])
  const h = await harness(adapter, upstream); await h.run(true)
  for (const id of ['alias-read', 'alias-save', 'alias-reopen', 'alias-edit']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const visible = JSON.parse(result(h.agent, 'alias-reopen').text)
  expect(visible.planning.frameRequirements[0].directorPlan).toEqual(fullPlan)
  expect(visible.duplicateFieldSources['/planning/frameRequirements/0/imagePromptCn']).toBe('/planning/frameRequirements/0/directorPlan/visual')
  expect(visible.context.shot.action).toBe('交谈')
  expect(visible.planning.frameRequirements[0].directorPlan.blocking).toBe(fullPlan.blocking)
  expect(Buffer.byteLength(result(h.agent, 'alias-reopen').text)).toBeLessThan(48000)
  expect(Buffer.byteLength(JSON.stringify({ ...visible,
    planning: { ...visible.planning, frameRequirements: [{ ...visible.planning.frameRequirements[0], imagePromptCn: visual }] },
  }))).toBeGreaterThan(48000)
  const retained = h.agent.session.events.find(event => event.type === 'qingmu-director-dialogue/receipt'
    && event.data.callId === 'alias-reopen')
  type RetainedPlan = { planning: { frameRequirements: { imagePromptCn: string }[] } }
  expect(retained?.type === 'qingmu-director-dialogue/receipt'
    && (retained.data.value as unknown as RetainedPlan).planning.frameRequirements[0]!.imagePromptCn).toBe(visual)
  expect(h.upstream.director()).toEqual(nextPlan)
  const commands = h.upstream.fetch.mock.calls.filter(([url]) =>
    new URL(url instanceof Request ? url.url : url).pathname.endsWith('/scene-planning/commands'))
  expect(JSON.parse(commands.at(-1)![1]!.body as string).request.imagePromptCn).toBe(visual)
})

it('carries a video reference through the native director read, preview, save and workspace restoration', async () => {
  const fixture = videoReferenceFixture()
  const draft = { bindings: fixture.request.bindings, promptParts: fixture.request.promptParts, parameters: fixture.request.parameters }
  const adapter = new MockAdapter([
    toolCallResponse('read', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('preview', 'qingmu_preview_reference_draft', { draft }),
    toolCallResponse('save', 'qingmu_save_reference_draft', { draft, expectedRevision: 1, expectedFrameSha256: fixture.savedDraft.frameSha256 }),
    textResponse('已保存源片引用，尚未生成或采用。'),
  ])
  const h = await harness(adapter, writer(0, undefined, fixture)); await h.run()
  for (const call of ['read', 'preview', 'save']) expect(result(h.agent, call).error, result(h.agent, call).text).toBe(false)
  const restored = await h.upstream.read('referenceVideoDraft', { projectId: 'p', frameId: 'f' }, new AbortController().signal)
  expect(restored).toMatchObject({ ok: true, value: { draft: { revision: 2, request: draft }, mediaTypes: { previous: 'reference_video' } } })
  expect(saves(h.upstream)).toHaveLength(1)
  const preview: unknown = JSON.parse(result(h.agent, 'preview').text)
  const saved: unknown = JSON.parse(result(h.agent, 'save').text)
  expect({ preview, saved }).toMatchSnapshot()
})

it('reads, previews and saves through the shipped YAML preset and real adapters, then exposes the same version to the workspace', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('read', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('preview', 'qingmu_preview_reference_draft', { draft: edit }),
    toolCallResponse('save', 'qingmu_save_reference_draft', saveArgs), textResponse('已保存导演稿；可在工作台恢复。'),
  ])
  const h = await harness(adapter); await h.run()
  const modelRequest = adapter.requests[0]!
  expect(modelRequest.system).toContain('已有草稿就沿用这份草稿')
  expect(modelRequest.system).toContain('优先走剧本修改流程')
  expect(modelRequest.system).toContain('本地素材尚未上传或临时链接已过期，不阻止保存')
  for (const name of ['qingmu_read_reference_draft', 'qingmu_preview_reference_draft', 'qingmu_save_reference_draft']) {
    expect(modelRequest.tools?.map(tool => tool.name)).toContain(name)
    expect(modelRequest.system).toContain(name)
  }
  for (const call of ['read', 'preview', 'save']) expect(result(h.agent, call).error).toBe(false)
  const preview: unknown = JSON.parse(result(h.agent, 'preview').text)
  expect(preview).toMatchObject({ prompt: '图1在图2说：“图1也是原对白，不能改。” 她放低声音，保持原衣服与座位。' })
  expect(result(h.agent, 'read').text).not.toContain('browserUrl')
  expect(result(h.agent, 'preview').text).not.toContain('owned.test')
  expect(saves(h.upstream)).toHaveLength(1)
  const restored = await h.upstream.read('referenceVideoDraft', { projectId: 'p', frameId: 'f' }, new AbortController().signal)
  expect(restored).toMatchObject({ ok: true, value: { draft: { revision: 2, request: edit }, providerCalls: 0, generationQueued: false } })
  // Snapshot actual logged/model-visible output, not a hand-built expected tool object.
  expect(JSON.parse(result(h.agent, 'save').text)).toMatchSnapshot()
  expect(JSON.stringify(adapter.requests.at(-1))).toContain('qingmu.native-reference-saved.v1')
  const agentScope = scopeOf(h.agent.ctx)
  expect(h.ctx.tools.get('qingmu_save_reference_draft', agentScope)).toBeDefined()
  await h.handle.dispose()
  // Tools belong to the standing preset, which outlives one joined agent.
  await h.presets.dispose()
  expect(h.ctx.tools.get('qingmu_save_reference_draft', agentScope)).toBeUndefined()
})

it.each(['qingmu_read_reference_draft', 'qingmu_preview_reference_draft', 'qingmu_save_reference_draft', 'qingmu_read_director_plan', 'qingmu_save_director_plan', 'qingmu_read_working_cut', 'qingmu_save_working_cut'])(
  'reports a missing reference capability even when all older tools are mounted (%s)', async (missing) => {
    const h = await harness(new MockAdapter([]))
    expect(readNativeDirectorReadiness(h.ctx, h.agent.session).status).toBe('mounted')
    const registry = h.ctx.agentPresets.serviceFor(h.agent, 'tools') ?? h.ctx.tools
    const get = registry.get.bind(registry)
    const mounted = vi.spyOn(registry, 'get').mockImplementation((name, scope) => name === missing ? undefined : get(name, scope))
    try {
      const readiness = readNativeDirectorReadiness(h.ctx, h.agent.session)
      expect(readiness).toMatchObject({ status: 'missing-tools', presetId: 'qingmu-director', missingTools: [missing] })
      expect(readiness.tools).toHaveLength(12)
      expect(h.upstream.fetch).not.toHaveBeenCalled()
      expect(h.agent.session.events.filter(event => event.type === 'tool/call')).toHaveLength(0)
    } finally { mounted.mockRestore() }
  },
)

it('rejects a stale editor revision rather than overwriting the browser draft', async () => {
  const h = await harness(new MockAdapter([
    toolCallResponse('stale', 'qingmu_save_reference_draft', { ...saveArgs, expectedRevision: 0 }), textResponse('需要重新核对草稿。'),
  ])); await h.run()
  expect(result(h.agent, 'stale').error).toBe(true)
  expect(h.upstream.saved().draft.revision).toBe(1)
  expect(saves(h.upstream)).toHaveLength(1)
})

it.each([
  { ...saveArgs, projectId: 'other-project' },
  { ...saveArgs, draft: { ...edit, frameId: 'other-shot' } },
  { ...saveArgs, draft: { ...edit, parameters: { ...edit.parameters, paidConfirmed: true } } },
])('rejects model-selected targets and added authority before any write (%j)', async (args) => {
  const h = await harness(new MockAdapter([toolCallResponse('bad', 'qingmu_save_reference_draft', args), textResponse('未保存。')]))
  await h.run(); expect(result(h.agent, 'bad').error).toBe(true)
  expect(saves(h.upstream)).toHaveLength(0)
})

it('rejects a shot switch during source reading before dispatching a save', async () => {
  const h = await harness(new MockAdapter([toolCallResponse('switch', 'qingmu_save_reference_draft', saveArgs), textResponse('镜头已变化。')]))
  h.upstream.afterDraftRead(() => h.agent.session.append('qingmu-director-context/state', {
    version: 1, binding: { scope: { ...scope, shotId: 'other' }, contextSnapshotSha256: context.contextSnapshotSha256 },
    proposal: null, transition: 'enter',
  }))
  await h.run(); expect(result(h.agent, 'switch').error).toBe(true)
  expect(saves(h.upstream)).toHaveLength(0)
})

it('saves local references before upload preparation even when provider preview is unavailable', async () => {
  const h = await harness(new MockAdapter([
    toolCallResponse('unprepared-preview', 'qingmu_preview_reference_draft', { draft: edit }),
    toolCallResponse('local-save', 'qingmu_save_reference_draft', saveArgs),
    toolCallResponse('local-reread', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('草稿已保存；现在可恢复草稿并准备引用素材。'),
  ]))
  h.upstream.unpreparedMaterials(); await h.run()
  expect(result(h.agent, 'unprepared-preview').error).toBe(true)
  expect(result(h.agent, 'local-save').error, result(h.agent, 'local-save').text).toBe(false)
  expect(h.upstream.saved().draft.request).toEqual({ ...edit, frameId: 'f', model: 'wan3.0-video' })
  expect(saves(h.upstream)).toHaveLength(1)
  expect(h.upstream.fetch.mock.calls.filter(([url]) => new URL(url instanceof Request ? url.url : url).pathname.endsWith('/preview'))).toHaveLength(1)
  expect(JSON.parse(result(h.agent, 'local-save').text)).toMatchSnapshot()
})

it('does not retry a lost save response, and a read recovers the committed version', async () => {
  const h = await harness(new MockAdapter([
    toolCallResponse('uncertain', 'qingmu_save_reference_draft', saveArgs),
    toolCallResponse('recover', 'qingmu_read_reference_draft', { page: 1 }), textResponse('回读确认已保存。'),
  ])); h.upstream.loseSaveResponse(); await h.run()
  expect(result(h.agent, 'uncertain').error).toBe(true)
  expect(JSON.parse(result(h.agent, 'recover').text)).toMatchObject({ saved: { draft: { revision: 2, request: edit } } })
  expect(saves(h.upstream)).toHaveLength(1)
})

it('reports the captured save target when selection changes after dispatch, without hiding the successful write', async () => {
  const h = await harness(new MockAdapter([toolCallResponse('saved-old', 'qingmu_save_reference_draft', saveArgs), textResponse('原镜头已保存。')]))
  h.upstream.afterSave(() => h.agent.session.append('qingmu-director-context/state', {
    version: 1, binding: { scope: { ...scope, shotId: 'other' }, contextSnapshotSha256: context.contextSnapshotSha256 },
    proposal: null, transition: 'enter',
  }))
  await h.run()
  expect(result(h.agent, 'saved-old').error).toBe(false)
  expect(JSON.parse(result(h.agent, 'saved-old').text)).toMatchObject({
    scope, revision: 2, activeShotChanged: true, mediaSelectionChanged: false,
  })
  expect(saves(h.upstream)).toHaveLength(1)
  expect(h.upstream.saved().frameId).toBe('f')
})


it('reconciles a changed complete design into one final native reference draft and rejects an old source', async () => {
  const finalDraft = { ...edit, directorSourceSha256: sha(canonical(design)),
    promptParts: [{ bindingToken: 'lin' }, { text: '先迟疑，再试探。先推近，再横移。低声，保留吸气。嗯。我在听。' }] }
  const adapter = new MockAdapter([
    toolCallResponse('plan-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('plan-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: design }),
    toolCallResponse('source-read', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('old-save', 'qingmu_save_reference_draft', saveArgs),
    toolCallResponse('final-save', 'qingmu_save_reference_draft', { ...saveArgs, draft: finalDraft }),
    textResponse('已整理并保存生成稿，尚未生成视频。'),
  ])
  const h = await harness(adapter); await h.run(true)
  expect(result(h.agent, 'source-read').text).toContain('newMethod')
  expect(result(h.agent, 'old-save').error).toBe(true)
  expect(result(h.agent, 'final-save').error, result(h.agent, 'final-save').text).toBe(false)
  expect(saves(h.upstream)).toHaveLength(1)
  expect(h.upstream.saved().draft.request).toMatchObject(finalDraft)
  expect(JSON.stringify(adapter.requests.at(-1))).toContain('先推近，再横移')
  expect({
    continued: (JSON.parse(result(h.agent, 'plan-save').text) as { continuation: unknown }).continuation !== null,
    sourceReadSucceeded: !result(h.agent, 'source-read').error,
    oldDraftRejected: result(h.agent, 'old-save').error,
    saved: h.upstream.saved().draft.request.promptParts,
  }).toMatchSnapshot()
})

it.each(['storyboard', 'script', 'scene'] as const)('does not continue across an unrelated %s change after its own director save', async (changed) => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  let committed = false
  upstream.fetch.mockImplementation(async (input, init) => {
    const response = await original(input, init)
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path.endsWith('/scene-planning/commands') && response.ok) committed = true
    if (!committed || !path.endsWith('/director-inference/context')) return response
    const { contextSnapshotSha256: _hash, ...body } = await response.json() as typeof context
    if (changed === 'storyboard') body.storyboard = { ...body.storyboard, id: 'external-revision', version: 3, sourceHash: 'e'.repeat(64) }
    if (changed === 'script') body.script = { revision: 2, sha256: 'f'.repeat(64) }
    if (changed === 'scene') body.sourceScene = { actionDescription: 'Changed outside this director request.' }
    return Response.json({ ...body, contextSnapshotSha256: sha(body) })
  })
  const h = await harness(new MockAdapter([
    toolCallResponse('plan-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('plan-save', 'qingmu_save_director_plan', { receiptId: designReceipt, directorPlan: design }),
    toolCallResponse('source-read', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('设计已保存；外部来源变化，需要重新核对。'),
  ]), upstream)
  await h.run(true)
  expect(result(h.agent, 'plan-save').error, result(h.agent, 'plan-save').text).toBe(false)
  expect((JSON.parse(result(h.agent, 'plan-save').text) as { continuation: unknown }).continuation).toBeNull()
  expect(result(h.agent, 'source-read').error).toBe(true)
  expect(result(h.agent, 'source-read').text).toContain('context has changed')
  expect(saves(upstream)).toHaveLength(0)
})


it('rejects acoustic imports without a current browser director target', async () => {
  const h = await harness(new MockAdapter([
    textResponse('Director workspace entered.'),
    toolCallResponse('room-import', 'qingmu_import_acoustic_response', { presetId: 'bedroom' }), textResponse('Target required.'),
  ]))
  await h.run(true)
  await h.run(false)
  expect(result(h.agent, 'room-import').error).toBe(true)
  expect(JSON.stringify(h.upstream.fetch.mock.calls)).not.toContain('/working-cut/audio')
})

it('imports a room response through the native loop in the bound episode without changing the cut', async () => {
  const upstream = writer()
  const original = upstream.fetch.getMockImplementation()!
  const source = { assetId: 'room-ir', sha256: 'c'.repeat(64), name: 'Bedroom IR', duration: 1.6,
    presetId: 'bedroom', usage: 'impulse_response', url: '' }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/working-cut/audio')) return Response.json({ ...initialCut, audioLibrary: [source] })
    return original(input, init)
  })
  const h = await harness(new MockAdapter([
    toolCallResponse('room-import', 'qingmu_import_acoustic_response', { presetId: 'bedroom' }),
    textResponse('Room response retained; the film remains unchanged.'),
  ]), upstream)
  await h.run(true)
  expect(result(h.agent, 'room-import').error, result(h.agent, 'room-import').text).toBe(false)
  expect(JSON.parse(result(h.agent, 'room-import').text)).toMatchObject({ scope: { projectId: 'p', episodeId: 'episode-a' }, source, providerCalls: 0 })
  const writes = upstream.fetch.mock.calls.filter(([url, init]) => new URL(url instanceof Request ? url.url : url).pathname.endsWith('/working-cut/audio') && init?.method === 'POST')
  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({ presetId: 'bedroom' })
  expect(JSON.stringify(upstream.fetch.mock.calls)).not.toContain('/working-cut/render')
  expect(JSON.parse(result(h.agent, 'room-import').text)).toMatchSnapshot()
})

it('saves scene-spanning sound through the shipped director preset, real loop and command adapter', async () => {
  const cut = { clips:[{ frameId:'f',assetId:'video',sha256:'a'.repeat(64),inSec:0,outSec:15,sourceAudioMode:'silent' }],
    audioCues:[{ assetId:'room',sha256:'b'.repeat(64),kind:'ambience',startSec:0,inSec:0,outSec:4,gainDb:-18,fadeInSec:1,fadeOutSec:2,
      loop:{ durationSec:14,crossfadeSec:.5 },
      sourceAudioMode:'effects', space:{ assetId:'room-ir',sha256:'c'.repeat(64),wetDb:-12,tailSec:1 },
      gainPoints:[{ timeSec:2,gainDb:0 },{ timeSec:3,gainDb:-6 },{ timeSec:8,gainDb:-6 },{ timeSec:10,gainDb:0 }] }],
    soundPlan:'Room reflections and street ambience continue under dialogue; music follows scene emotion.' }
  const receiptId = sha({ scope:{ projectId:'p',episodeId:'episode-a' },cut:initialCut })
  const adapter = new MockAdapter([toolCallResponse('cut-read','qingmu_read_working_cut',{}),
    toolCallResponse('cut-save','qingmu_save_working_cut',{ receiptId,cut }),
    toolCallResponse('cut-reread','qingmu_read_working_cut',{}),textResponse('Sound plan saved.')])
  const h = await harness(adapter); await h.run(true)
  for (const id of ['cut-read','cut-save','cut-reread']) expect(result(h.agent,id).error,result(h.agent,id).text).toBe(false)
  expect(JSON.parse(result(h.agent,'cut-reread').text)).toMatchObject({ cut:{ cuts:[{ audioCues:cut.audioCues,soundPlan:cut.soundPlan,status:'NotQueued' }] } })
  const writes = h.upstream.fetch.mock.calls.filter(([url,init]) => new URL(url instanceof Request ? url.url : url).pathname.endsWith('/working-cut/save') && init?.method==='POST')
  expect(writes).toHaveLength(1)
  const body = writes[0]?.[1]?.body
  if (typeof body !== 'string') throw new Error('Expected JSON request body')
  expect(JSON.parse(body)).toMatchObject({ ...cut,expectedRevision:0 })
  expect({ savedCues: JSON.parse(body).audioCues, restored: JSON.parse(result(h.agent,'cut-reread').text) }).toMatchSnapshot()
  expect(JSON.stringify(adapter.requests.at(-1))).toContain('Room reflections and street ambience')
  expect(JSON.stringify(h.upstream.fetch.mock.calls)).not.toContain('/working-cut/render')
})

function capturedVideoRun(runId = 'refvideo_previous', assetSha256 = 'a'.repeat(64)) {
  return { ...runResponse, frameId: 'previous', runId, kernelStatus: 'Succeeded', publicStatus: 'succeeded',
    candidates: [{ assetId: 'asset_video', assetSha256, mediaId: null, browserUrl: '', reviewStatus: 'pending' }] }
}
function capturedVideoRuns(items = [capturedVideoRun()]) {
  return { schema: 'jason.reference-video-runs.v1', projectId: 'p', frameId: 'previous', items, providerCalls: 0 }
}

it('delivers complete paged review comments with exact video bindings to the director without author credentials or writes', async () => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  const feed = takeCommentFeed({ projectId: 'p', episodeId: 'episode-a', frameId: 'previous' })
  const comments = Array.from({ length: 6 }, (_, i) => ({ ...feed.comments[0]!, id: `note-${i}`, eventId: `note-event-${i}`,
    body: `Visible state at the recorded time ${i}: ` + 'retain the full observation. '.repeat(60),
    createdAt: `2026-09-13T05:00:0${i}Z` }))
  const fullFeed = { ...feed, comments: [...comments, feed.comments[1]!] }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) return Response.json(capturedVideoRuns([capturedVideoRun('refvideo_previous', '2'.repeat(64))]))
    if (url.pathname.endsWith('/take-comments')) return Response.json(fullFeed)
    return original(input, init)
  })
  const adapter = new MockAdapter([
    toolCallResponse('notes-1', 'qingmu_read_reference_video_candidates', { sourceFrameId: 'previous' }),
    toolCallResponse('notes-2', 'qingmu_read_reference_video_candidates', { sourceFrameId: 'previous', commentPage: 2 }),
    textResponse('Review notes are evidence about the recorded video, not approval.'),
  ])
  const h = await harness(adapter, upstream); await h.run()
  for (const id of ['notes-1', 'notes-2']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const first = JSON.parse(result(h.agent, 'notes-1').text), second = JSON.parse(result(h.agent, 'notes-2').text)
  expect(first).toMatchObject({ advisoryOnly: true, providerCalls: 0, selectionChanged: false,
    reviewComments: { available: true, page: 1, total: 7, nextPage: 2 } })
  expect(first.reviewComments.items).toHaveLength(5)
  expect(first.reviewComments.items[0]).toMatchObject({ body: comments[5]!.body, candidateAssetIds: ['asset_video'],
    currentBinding: true, anchor: comments[5]!.anchor, outputSha256: '2'.repeat(64) })
  expect(second.reviewComments).toMatchObject({ available: true, page: 2, total: 7, nextPage: null })
  expect(second.reviewComments.items).toHaveLength(2)
  expect(second.reviewComments.items[1]).toMatchObject({ body: feed.comments[1]!.body,
    currentBinding: false, candidateAssetIds: [], outputSha256: '3'.repeat(64) })
  expect(JSON.stringify(adapter.requests.at(-1))).toContain(comments[5]!.body)
  for (const key of ['actorId', 'authSessionId', 'actorNaturalPersonId']) expect(result(h.agent, 'notes-1').text).not.toContain(key)
  const reads = upstream.fetch.mock.calls.filter(([url]) => String(url).includes('/take-comments'))
  expect(reads).toHaveLength(2)
  expect(reads.every(([url, init]) => String(url).includes('/projects/p/episodes/episode-a/frames/previous/take-comments') && init?.method === 'GET')).toBe(true)
  expect(upstream.fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})

it.each(['empty', 'unavailable', 'foreign feed'] as const)('distinguishes %s comments without losing accessible source candidates', async (mode) => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) return Response.json(capturedVideoRuns())
    if (url.pathname.endsWith('/take-comments')) {
      if (mode === 'unavailable') return Response.json({ detail: 'unavailable' }, { status: 503 })
      const feed = takeCommentFeed({ projectId: mode === 'foreign feed' ? 'other' : 'p', episodeId: 'episode-a', frameId: 'previous' })
      return Response.json({ ...feed, comments: [] })
    }
    return original(input, init)
  })
  const adapter = new MockAdapter([toolCallResponse('notes', 'qingmu_read_reference_video_candidates', { sourceFrameId: 'previous' }), textResponse('Read complete.')])
  const h = await harness(adapter, upstream); await h.run()
  const reply = result(h.agent, 'notes'); expect(reply.error, reply.text).toBe(false)
  const value = JSON.parse(reply.text)
  expect(value.items[0].candidates[0].assetId).toBe('asset_video')
  expect(value.reviewComments.available).toBe(mode === 'empty')
  if (mode === 'empty') expect(value.reviewComments).toMatchObject({ total: 0, items: [], nextPage: null })
  else expect(value.reviewComments).not.toHaveProperty('items')
})

it('captures and recovers actual frame pixels through the shipped director preset with current-project scope', async () => {
  const upstream = writer()
  const original = upstream.fetch.getMockImplementation()!
  const receipt = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'episode-a', frameId: 'previous',
    runId: 'refvideo_previous', assetId: 'asset_video', assetSha256: 'a'.repeat(64), requestedTimestampMs: 1001,
    image: { assetId: `asset_vframe_${'b'.repeat(32)}`, assetSha256: imageSha, width: 1, height: 1, actualTimestampMs: 1033.333 },
    providerCalls: 0, selectionChanged: false }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) return Response.json(capturedVideoRuns())
    if (url.pathname.endsWith('/reference-frame')) return Response.json(receipt)
    if (url.pathname.endsWith('/assets')) return Response.json({ page: 1, page_size: 200, pages: 1,
      items: [{ id: receipt.image.assetId, project_id: 'p', asset_type: 'image', sha256: imageSha,
        public_url: imageUrl, preview_media_id: 'media_cafe', role: 'continuity_reference_frame' }] })
    return original(input, init)
  })
  const args = { sourceFrameId: 'previous', runId: 'refvideo_previous', assetId: 'asset_video', expectedAssetSha256: 'a'.repeat(64), timestampMs: 1001 }
  const adapter = new MockAdapter([
    toolCallResponse('capture-frame', 'qingmu_capture_reference_video_frame', { sourceFrameId: args.sourceFrameId, assetId: args.assetId, expectedAssetSha256: args.expectedAssetSha256, timestampMs: args.timestampMs, operation: 'capture' }),
    toolCallResponse('read-frame', 'qingmu_capture_reference_video_frame', { ...args, operation: 'read' }),
    textResponse('收到取帧图片，只能核对这一时刻，不能声称已审完整视频或声音。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, upstream, true); await h.run()
  const capture = result(h.agent, 'capture-frame'), recover = result(h.agent, 'read-frame')
  expect(capture.error, capture.text).toBe(false)
  expect(recover.error, recover.text).toBe(false)
  expect(JSON.parse(capture.text)).toMatchObject({ ...receipt, visualInputs: [{ bindingToken: 'captured_frame',
    assetId: receipt.image.assetId, assetSha256: imageSha, status: 'attached' }] })
  const attached = JSON.parse(capture.text).visualInputs[0].attachment
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain(attached.attachmentId)
  expect(JSON.parse(recover.text).visualInputs[0].attachment).toEqual(attached)
  expect(JSON.parse(recover.text)).toMatchSnapshot()
  const calls = upstream.fetch.mock.calls.filter(([url]) => new URL(url instanceof Request ? url.url : url).pathname.endsWith('/reference-frame'))
  expect(calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
  expect(String(calls[0]?.[0])).toContain('/projects/p/reference-video/drafts/previous/')
  await h.presets.dispose()
  expect(h.ctx.tools.get('qingmu_capture_reference_video_frame', scopeOf(h.agent.ctx))).toBeUndefined()
})

it.each([
  { name: 'mismatched run', runId: 'refvideo_other', expectedSha: 'a'.repeat(64), mode: 'normal' },
  { name: 'changed video hash', runId: undefined, expectedSha: 'f'.repeat(64), mode: 'normal' },
  { name: 'ambiguous reuse', runId: undefined, expectedSha: 'a'.repeat(64), mode: 'ambiguous' },
  { name: 'foreign project', runId: undefined, expectedSha: 'a'.repeat(64), mode: 'foreign' },
])('does not attempt a frame write for $name', async ({ runId, expectedSha, mode }) => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) {
      const runs = capturedVideoRuns(mode === 'ambiguous'
        ? [capturedVideoRun(), capturedVideoRun('refvideo_duplicate')] : [capturedVideoRun()])
      return Response.json(mode === 'foreign' ? { ...runs, projectId: 'foreign' } : runs)
    }
    return original(input, init)
  })
  const adapter = new MockAdapter([toolCallResponse('bad-frame', 'qingmu_capture_reference_video_frame', {
    sourceFrameId: 'previous', ...(runId ? { runId } : {}), assetId: 'asset_video', expectedAssetSha256: expectedSha,
    timestampMs: 1001, operation: 'capture' }), textResponse('Read the correct source before any capture.')])
  const h = await harness(adapter, upstream); await h.run()
  expect(result(h.agent, 'bad-frame')).toMatchObject({ error: true, text: expect.stringContaining('未执行抽帧') })
  expect(upstream.fetch.mock.calls.filter(([url]) => String(url).includes('/reference-frame'))).toHaveLength(0)
})

it('recovers an explicitly identified older video outside the recent run list without writing', async () => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  const receipt = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'episode-a', frameId: 'previous',
    runId: 'refvideo_previous00000001', assetId: 'asset_video', assetSha256: 'a'.repeat(64), requestedTimestampMs: 1001,
    image: null, providerCalls: 0, selectionChanged: false }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) return Response.json(capturedVideoRuns([]))
    if (url.pathname.endsWith('/runs/refvideo_previous00000001')) return Response.json(capturedVideoRun(receipt.runId))
    if (url.pathname.endsWith('/reference-frame')) return Response.json(receipt)
    return original(input, init)
  })
  const adapter = new MockAdapter([toolCallResponse('older-frame', 'qingmu_capture_reference_video_frame', {
    sourceFrameId: 'previous', runId: receipt.runId, assetId: receipt.assetId, expectedAssetSha256: receipt.assetSha256,
    timestampMs: 1001, operation: 'read' }), textResponse('No prior capture exists; no new frame was saved.')])
  const h = await harness(adapter, upstream); await h.run()
  expect(result(h.agent, 'older-frame').error, result(h.agent, 'older-frame').text).toBe(false)
  expect(JSON.parse(result(h.agent, 'older-frame').text)).toMatchObject(receipt)
  expect(upstream.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})

it('retains a captured-frame receipt when its source pixels fail verification', async () => {
  const upstream = writer(), original = upstream.fetch.getMockImplementation()!
  const receipt = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'episode-a', frameId: 'previous',
    runId: 'refvideo_previous', assetId: 'asset_video', assetSha256: 'a'.repeat(64), requestedTimestampMs: 1001,
    image: { assetId: `asset_vframe_${'b'.repeat(32)}`, assetSha256: 'c'.repeat(64), width: 1, height: 1, actualTimestampMs: 1033.333 },
    providerCalls: 0, selectionChanged: false }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/runs')) return Response.json(capturedVideoRuns())
    if (url.pathname.endsWith('/reference-frame')) return Response.json(receipt)
    if (url.pathname.endsWith('/assets')) return Response.json({ page: 1, page_size: 200, pages: 1,
      items: [{ id: receipt.image.assetId, project_id: 'p', asset_type: 'image', sha256: 'c'.repeat(64),
        public_url: imageUrl, preview_media_id: 'media_cafe' }] })
    return original(input, init)
  })
  const adapter = new MockAdapter([toolCallResponse('recover-frame', 'qingmu_capture_reference_video_frame', {
    sourceFrameId: 'previous', runId: receipt.runId, assetId: receipt.assetId, expectedAssetSha256: receipt.assetSha256,
    timestampMs: 1001, operation: 'read' }), textResponse('Capture exists; pixels are unconfirmed. Do not recapture or infer continuity.')])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, upstream, true); await h.run()
  const read = result(h.agent, 'recover-frame')
  expect(read.error, read.text).toBe(false)
  expect(JSON.parse(read.text)).toMatchObject({ ...receipt, visualInputs: [{ status: 'unavailable', reason: expect.stringMatching(/hash|SHA/iu) }] })
  expect(JSON.stringify(adapter.requests.at(-1)?.messages)).not.toContain('"type":"image"')
  expect(upstream.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})


it('native director saves frame endpoints through the same project-bound draft tool', async () => {
  const frameDraft = { ...edit, bindings: [edit.bindings[0]!].map(binding => ({ ...binding, frameRole: 'first_frame' as const })),
    promptParts: [{ text: '从画面的既有站位起步，环境声持续。' }], parameters: { ...edit.parameters, ratio: 'adaptive' as const } }
  const h = await harness(new MockAdapter([
    toolCallResponse('frame-save', 'qingmu_save_reference_draft', { ...saveArgs, draft: frameDraft }),
    textResponse('已保存首帧生成草稿。'),
  ]))
  await h.run()
  expect(result(h.agent, 'frame-save'), JSON.stringify(result(h.agent, 'frame-save'))).not.toHaveProperty('error', true)
  expect(saves(h.upstream)).toHaveLength(1)
  expect(JSON.stringify(saves(h.upstream))).toContain('first_frame')
})

it('copies the complete current production design into ordinary saved text and the actual preview', async () => {
  const production = canonical(design)
  const source = { sha256: sha(production), prompt: production + '\nAdjacent shot research', generationPrompt: production }
  const draft = { ...edit, directorSourceSha256: source.sha256,
    promptParts: [{ bindingToken: 'lin' }, { text: ': identity reference only.\n' }, { directorText: 'current' }] }
  const h = await harness(new MockAdapter([
    toolCallResponse('copy-save', 'qingmu_save_reference_draft', { ...saveArgs, draft }),
    toolCallResponse('copy-preview', 'qingmu_preview_reference_draft', { draft }),
    toolCallResponse('copy-read', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('The director design is copied into the editable draft; no video was generated.'),
  ]))
  h.upstream.setDirectorSource(source); await h.run()
  for (const id of ['copy-save', 'copy-preview', 'copy-read']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const expanded = [{ bindingToken: 'lin' }, { text: ': identity reference only.\n' }, { text: production }]
  expect(h.upstream.saved().draft.request.promptParts).toEqual(expanded)
  const preview = JSON.parse(result(h.agent, 'copy-preview').text)
  expect(preview.prompt).toBe('图1: identity reference only.\n' + production)
  expect(preview.prompt).not.toContain('Adjacent shot research')
  expect(preview.parameters).toMatchObject(edit.parameters)
  expect(saves(h.upstream)).toHaveLength(1)
  expect({ prompt: preview.prompt, savedParts: h.upstream.saved().draft.request.promptParts,
    generated: preview.generationQueued }).toMatchSnapshot()
})

it.each([
  '她先走出柜台，再蹲下接过孩子手中一本书；背景书架和还书堆保持原位。',
  '他保持坐姿，杯子从唇边放低到膝上；近景之外的门口仍有脚步声。',
])('assembles reference purposes with the complete current design as the final text: %s', async (action) => {
  const production = canonical({ ...design, action })
  const source = { sha256: sha(production), prompt: production + '\nAdjacent shot research', generationPrompt: production }
  const referenceUses = edit.bindings.map(binding => ({ bindingToken: binding.bindingToken, purpose: `Source for ${binding.label}.` })).reverse()
  const draft = { bindings: edit.bindings, parameters: edit.parameters, referenceUses, directorSourceSha256: source.sha256 }
  const h = await harness(new MockAdapter([
    toolCallResponse('assembled-save', 'qingmu_save_reference_draft', { ...saveArgs, draft }),
    toolCallResponse('assembled-preview', 'qingmu_preview_reference_draft', { draft }),
    toolCallResponse('assembled-read', 'qingmu_read_reference_draft', { page: 1 }), textResponse('Saved the current design with its reference purposes.'),
  ]))
  h.upstream.setDirectorSource(source); await h.run()
  for (const id of ['assembled-save', 'assembled-preview', 'assembled-read']) expect(result(h.agent, id).error, result(h.agent, id).text).toBe(false)
  const parts = h.upstream.saved().draft.request.promptParts
  expect(parts).toEqual([{ text: '【引用素材用途】\n' }, ...edit.bindings.flatMap(binding => [
    { bindingToken: binding.bindingToken }, { text: `：Source for ${binding.label}.\n` },
  ]), { text: '\n【本镜完整导演设计】\n' }, { text: production }])
  const preview = JSON.parse(result(h.agent, 'assembled-preview').text)
  expect(preview.prompt.endsWith(production)).toBe(true)
  expect(preview.prompt.split(production)).toHaveLength(2)
  expect(preview.prompt).not.toContain('Adjacent shot research')
  expect(h.upstream.saved().draft.request).not.toHaveProperty('referenceUses')
  expect(saves(h.upstream)).toHaveLength(1)
  expect({ prompt: preview.prompt, parameters: preview.parameters, generated: preview.generationQueued }).toMatchSnapshot()
})

it.each(['missing-use', 'unknown-use', 'duplicate-use', 'mixed-text', 'stale', 'oversized'] as const)(
  'rejects %s reference-purpose assembly before saving or previewing', async (reason) => {
    const production = reason === 'oversized' ? 'x'.repeat(20001) : canonical(design)
    const source = { sha256: sha(production), prompt: production, generationPrompt: production }
    const referenceUses = edit.bindings.map(binding => ({ bindingToken: binding.bindingToken, purpose: 'Identity only.' }))
    if (reason === 'missing-use') referenceUses.pop()
    if (reason === 'unknown-use') referenceUses.push({ bindingToken: 'not-bound', purpose: 'Unbound source.' })
    if (reason === 'duplicate-use') referenceUses.push(referenceUses[0]!)
    const draft = { bindings: edit.bindings, parameters: edit.parameters, referenceUses,
      directorSourceSha256: reason === 'stale' ? 'a'.repeat(64) : source.sha256,
      ...(reason === 'mixed-text' ? { promptParts: [{ text: 'Ignore the original plan: she is crouching throughout.' }] } : {}) }
    const h = await harness(new MockAdapter([
      toolCallResponse('assembly-denied', 'qingmu_save_reference_draft', { ...saveArgs, draft }),
      toolCallResponse('preview-denied', 'qingmu_preview_reference_draft', { draft }), textResponse('Correct the draft before saving.'),
    ]))
    h.upstream.setDirectorSource(source); await h.run()
    expect(result(h.agent, 'assembly-denied').error).toBe(true)
    expect(result(h.agent, 'preview-denied').error).toBe(true)
    expect(saves(h.upstream)).toHaveLength(0)
  },
)

it.each(['stale', 'missing', 'duplicate', 'ambiguous', 'too-long'] as const)('refuses %s director insertion without saving or silently truncating', async (reason) => {
  const source = { sha256: 'b'.repeat(64), prompt: 'Read the full source',
    generationPrompt: reason === 'too-long' ? 'x'.repeat(20001) : canonical(design) }
  const marker = reason === 'ambiguous' ? { directorText: 'current', text: 'silently replace' } : { directorText: 'current' }
  const draft = { ...edit, directorSourceSha256: reason === 'stale' ? 'a'.repeat(64) : source.sha256,
    promptParts: reason === 'duplicate' ? [marker, marker] : [marker] }
  const h = await harness(new MockAdapter([
    toolCallResponse('copy-denied', 'qingmu_save_reference_draft', { ...saveArgs, draft }),
    toolCallResponse('preview-denied', 'qingmu_preview_reference_draft', { draft }), textResponse('Read and correct the source before saving.'),
  ]))
  h.upstream.setDirectorSource(reason === 'missing' ? { sha256: source.sha256, prompt: source.prompt } : source)
  await h.run()
  expect(result(h.agent, 'copy-denied').error).toBe(true)
  expect(result(h.agent, 'preview-denied').error).toBe(true)
  expect(saves(h.upstream)).toHaveLength(0)
})

it.each(['current', 'stale', 'missing'] as const)('delivers only exact common-design references with their current purposes (%s)', async (version) => {
  const reference = { assetId: version === 'missing' ? 'missing-image' : 'asset_cafe',
    assetSha256: version === 'stale' ? 'a'.repeat(64) : imageSha, purpose: 'Appearance only; use the current authored layout for camera geometry.' }
  const assetDesign = { assets: [
    { id: 'scene-a', kind: 'scene', name: 'Room', imagePrompt: 'Current room design', references: [reference] },
    { id: 'prop-a', kind: 'prop', name: 'Lamp', imagePrompt: 'Current lamp design', references: [{ ...reference, purpose: 'Lamp material only.' }] },
  ] }
  const adapter = new MockAdapter([toolCallResponse('assets', 'qingmu_read_asset_design', { page: 1 }), textResponse('Inspect the current references for their stated purpose.')])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock', inputModalities: ['text', 'image'] })
  const media = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(imageBytes, { headers: { 'content-type': 'image/png' } }))
  const h = await harness(adapter, writer(0, { sha256: imageSha, url: imageUrl, assetDesign,
    source: { selected: false, selection_status: 'Stale' }, config: { image_prompt: 'Obsolete room layout' } }), true)
  await h.run(false, {})
  expect(result(h.agent, 'assets').error, result(h.agent, 'assets').text).toBe(false)
  const value = JSON.parse(result(h.agent, 'assets').text)
  expect(value.saved.design).toEqual(assetDesign)
  expect(value.visualInputs).toHaveLength(1)
  expect(value.visualInputs[0]).toMatchObject({ assetId: reference.assetId, assetSha256: reference.assetSha256,
    status: version === 'current' ? 'attached' : version === 'stale' ? 'stale' : 'not_on_page',
    currentUses: [{ entityId: 'scene-a', kind: 'scene', name: 'Room', purpose: reference.purpose },
      { entityId: 'prop-a', kind: 'prop', name: 'Lamp', purpose: 'Lamp material only.' }] })
  expect(value.visualInputs[0]).not.toHaveProperty('originalImageDesign')
  const event = h.agent.session.events.find(e => e.type === 'tool/result' && e.data.message.source.callId === 'assets')
  if (event?.type !== 'tool/result') throw new Error('Missing asset result')
  const images = event.data.message.content.flatMap(part => part.content).filter(part => part.type === 'image')
  expect(images).toHaveLength(version === 'current' ? 1 : 0)
  expect(media).toHaveBeenCalledTimes(version === 'current' ? 1 : 0)
  expect(h.upstream.fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})
