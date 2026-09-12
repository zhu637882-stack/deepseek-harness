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
import { canonical, request, response, savedDraft } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
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
  audioLibrary:[{ assetId:'room',sha256:'b'.repeat(64),duration:30,name:'Room.wav',url:'' }],providerCalls:0,humanApprovalChanged:false }
function writer(extraShots = 0, image?: { sha256: string; url: string }) {
  let workingCut: Record<string, unknown> = structuredClone(initialCut)

  let saved = structuredClone(savedDraft)
  let directorSource: { sha256: string; prompt: string } | null = null
  let currentContext = structuredClone(context)
  let currentPlanning = structuredClone(planning)
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
        request: { directorPlan: Record<string, unknown>; expectedStoryboardRevision: number }
      }
      if (body.request.expectedStoryboardRevision !== currentPlanning.storyboard.version) return Response.json({ detail: { code: 'planning_storyboard_conflict' } }, { status: 409 })
      const storyboard = { ...currentPlanning.storyboard, id: 'revision-2', version: 2, sourceHash: 'd'.repeat(64) }
      const shots = currentPlanning.frameRequirements.map(shot => shot.id === scope.shotId
        ? { ...shot, directorPlan: body.request.directorPlan } : shot)
      currentPlanning = { ...currentPlanning, storyboard,
        frameRequirements: shots,
        canonicalStoryboard: { ...currentPlanning.canonicalStoryboard, revision: 2, sourceHash: storyboard.sourceHash,
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
        asset_type: item.bindingToken === 'voice' ? 'audio' : 'image', role: item.label, sha256: item.assetSha256,
        ...(image && item.assetId === 'asset_cafe' ? { sha256: image.sha256, public_url: image.url, preview_media_id: 'media_cafe' } : {}) })) })
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
        saved = { ...saved, draft: { ...saved.draft, revision: saved.draft.revision + 1,
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
    afterDraftRead: (callback: () => void) => { afterDraftRead = callback },
    afterSave: (callback: () => void) => { afterSave = callback },
    unpreparedMaterials: () => { unpreparedMaterials = true },
    loseSaveResponse: () => { loseSaveResponse = true } }
}

async function harness(adapter: MockAdapter, upstream = writer(), images = false, observer?: MockAdapter) {
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
  ctx.llm.registerAdapter(['mock'], adapter)
  if (observer) ctx.llm.registerAdapter(['qingmu-vision'], observer)
  ctx.provide('qingmuYimengRead', upstream.read)
  ctx.provide('qingmuYimengCommand', upstream.command)
  ctx.provide('qingmuImagoMethod', async () => { throw new Error('No method requested by this fixture') })
  const handle = await ctx.agents.create({ sessionId: SessionId('native-reference'), agentOptions: { provider: 'mock', model: 'mock' },
    meta: { agentPreset: 'qingmu-director' }, setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director') })
  const agent = handle.agent
  agent.session.append('qingmu-director-context/state', { version: 1,
    binding: { scope, contextSnapshotSha256: context.contextSnapshotSha256 }, proposal: null, transition: 'enter' })
  async function run(scoped = false) {
    if (scoped) await createDirectorContextBridge({
      readDirectorContext: async () => ({ ok: true, context: context as DirectorContextSnapshot }),
    }).enter(agent.session, scope, new AbortController().signal, 'test-owner')
    const idle = new Promise<void>((resolve) => {
      const stop = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { stop(); resolve() } })
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [
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

it('compacts a long shipped director session and rereads the complete saved draft without rewriting it', async () => {
  const oldText = 'Earlier creative discussion. '.repeat(14400)
  const checkpoint = 'Continue the selected shot by rereading its current director design and saved reference draft.'
  const historyResponse = textResponse('Recorded historical discussion.')
  historyResponse.splice(1, historyResponse.length - 1,
    { type: 'block-end', index: 0, block: { type: 'text', text: oldText } },
    { type: 'finish', reason: { kind: 'stop' } })
  const adapter = new MockAdapter([
    ...Array.from({ length: 7 }, () => historyResponse),
    (options) => {
      expect(JSON.stringify(options.messages.at(-1))).toContain('acting as a compaction engine')
      return textResponse(checkpoint)
    },
    toolCallResponse('after-compact-plan', 'qingmu_read_director_plan', {}),
    toolCallResponse('after-compact-draft', 'qingmu_read_reference_draft', { page: 1 }),
    textResponse('已恢复完整设计和已存生成稿，未重复保存或生成。'),
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'mock',
    context: { contextWindow: 1048576 } })
  const h = await harness(adapter)
  for (let turn = 0; turn < 7; turn += 1) await h.run(true)
  expect(h.agent.session.events.some(event => event.type === 'compaction/summary')).toBe(false)
  await h.run(true)

  const summaries = h.agent.session.events.filter(event => event.type === 'compaction/summary')
  expect(summaries).toHaveLength(1)
  expect(JSON.stringify(summaries[0])).toContain(checkpoint)
  expect(h.agent.session.events.some(event => event.type === 'assistant/message'
    && event.data.message.content.some(part => part.type === 'text' && part.text === oldText))).toBe(true)
  expect(adapter.requests).toHaveLength(11)
  expect(JSON.stringify(adapter.requests[8]?.messages)).toContain(checkpoint)
  const historyBefore = adapter.requests[7]!.messages.filter(message => message.content.some(part => part.type === 'text' && part.text === oldText)).length
  const historyAfter = adapter.requests[8]!.messages.filter(message => message.content.some(part => part.type === 'text' && part.text === oldText)).length
  expect(historyAfter).toBeLessThan(historyBefore)
  const restored = result(h.agent, 'after-compact-draft')
  expect(restored).toMatchObject({ error: false })
  const restoredBody: unknown = JSON.parse(restored.text)
  expect(restoredBody).toMatchObject({ saved: { draft: { request: savedDraft.draft.request } } })
  expect(result(h.agent, 'after-compact-plan').error).toBe(false)
  expect(saves(h.upstream)).toHaveLength(0)
  expect({ checkpoint, restored: restoredBody,
    writes: saves(h.upstream).length }).toMatchSnapshot()
})

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
const imageSha = createHash('sha256').update(imageBytes).digest('hex')
const imageUrl = `http://127.0.0.1:8115/api/media/media_cafe?signature=${'e'.repeat(64)}&expires=9999999999`
const imageArgs = { page: 1, assetId: 'asset_cafe', assetSha256: imageSha }
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
  const args = { receiptId: designReceipt, directorPlan: design }
  const adapter = new MockAdapter([toolCallResponse('design-read', 'qingmu_read_director_plan', {}),
    toolCallResponse('design-save', 'qingmu_save_director_plan', args),
    toolCallResponse('design-recover', 'qingmu_save_director_plan', args), textResponse('已恢复保存回执。')])
  const h = await harness(adapter, upstream); await h.run(true)
  expect(result(h.agent, 'design-save').error).toBe(true)
  expect(result(h.agent, 'design-recover').error, result(h.agent, 'design-recover').text).toBe(false)
  expect(JSON.parse(result(h.agent, 'design-recover').text)).toMatchObject({ result: { recovered: true } })
  expect(h.upstream.director()).toEqual(design)
  expect(h.upstream.fetch.mock.calls.filter(([url]) =>
    new URL(url instanceof Request ? url.url : url).pathname.endsWith('/scene-planning/commands'))).toHaveLength(1)
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


it('saves scene-spanning sound through the shipped director preset, real loop and command adapter', async () => {
  const cut = { clips:[{ frameId:'f',assetId:'video',sha256:'a'.repeat(64),inSec:0,outSec:15 }],
    audioCues:[{ assetId:'room',sha256:'b'.repeat(64),kind:'ambience',startSec:0,inSec:0,outSec:15,gainDb:-18,fadeInSec:1,fadeOutSec:2,
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

it('captures and recovers a video frame through the shipped director preset with current-project scope', async () => {
  const upstream = writer()
  const original = upstream.fetch.getMockImplementation()!
  const receipt = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'episode-a', frameId: 'previous',
    runId: 'refvideo_previous', assetId: 'asset_video', assetSha256: 'a'.repeat(64), requestedTimestampMs: 1001,
    image: { assetId: `asset_vframe_${'b'.repeat(32)}`, assetSha256: 'c'.repeat(64), width: 1920, height: 1080, actualTimestampMs: 1033.333 },
    providerCalls: 0, selectionChanged: false }
  upstream.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith('/reference-frame')) return Response.json(receipt)
    return original(input, init)
  })
  const args = { sourceFrameId: 'previous', runId: 'refvideo_previous', assetId: 'asset_video', expectedAssetSha256: 'a'.repeat(64), timestampMs: 1001 }
  const adapter = new MockAdapter([
    toolCallResponse('capture-frame', 'qingmu_capture_reference_video_frame', { ...args, operation: 'capture' }),
    toolCallResponse('read-frame', 'qingmu_capture_reference_video_frame', { ...args, operation: 'read' }),
    textResponse('画面已保存在项目素材，后续引用前先核对画面。'),
  ])
  const h = await harness(adapter, upstream); await h.run()
  const capture = result(h.agent, 'capture-frame'), recover = result(h.agent, 'read-frame')
  expect(capture.error, capture.text).toBe(false)
  expect(recover.error, recover.text).toBe(false)
  expect(JSON.parse(capture.text)).toEqual(receipt)
  expect(JSON.parse(recover.text)).toMatchSnapshot()
  const calls = upstream.fetch.mock.calls.filter(([url]) => new URL(url instanceof Request ? url.url : url).pathname.endsWith('/reference-frame'))
  expect(calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
  expect(String(calls[0]?.[0])).toContain('/projects/p/reference-video/drafts/previous/')
  await h.presets.dispose()
  expect(h.ctx.tools.get('qingmu_capture_reference_video_frame', scopeOf(h.agent.ctx))).toBeUndefined()
})
