/** Shipped YAML preset + agent loop + real adapters; only Writer HTTP and model responses are scripted. */
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import * as Persona from '@deepseek-ai/dsh-persona'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { createYimengCommandHandler } from '../../qingmu-yimeng-command-adapter/src/index.ts'
import { canonical, request, response, savedDraft } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ModelTools from '../src/model-tools.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
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
const edit = { bindings: request.bindings, parameters: request.parameters,
  promptParts: [...request.promptParts, { text: ' 她放低声音，保持原衣服与座位。' }] }
const saveArgs = { draft: edit, expectedRevision: 1, expectedFrameSha256: savedDraft.frameSha256 }

function writer() {
  let saved = structuredClone(savedDraft)
  let afterPreview: (() => void) | undefined
  let afterSave: (() => void) | undefined
  let loseSaveResponse = false
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/director-inference/context')) return Response.json(context)
    if (url.pathname.endsWith('/assets')) return Response.json({ page: 1, page_size: 200, pages: 1,
      items: request.bindings.map(item => ({ id: item.assetId, project_id: 'p',
        asset_type: item.bindingToken === 'voice' ? 'audio' : 'image', role: item.label, sha256: item.assetSha256 })) })
    if (url.pathname.endsWith('/preview')) {
      const input = JSON.parse(String(init?.body)) as typeof savedDraft.draft.request
      const prompt = input.promptParts.map(part => 'text' in part ? part.text
        : response.referenceMapping.find(item => item.bindingToken === part.bindingToken)!.alias).join('')
      const body = { ...response.body, input: { ...response.body.input, prompt }, parameters: { ...input.parameters, watermark: false } }
      afterPreview?.()
      return Response.json({ ...response, body, requestBodySha256: sha(body) })
    }
    if (url.pathname === '/api/qingmu/projects/p/reference-video/drafts/f') {
      if (init?.method === 'POST') {
        const input = JSON.parse(String(init.body)) as {
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
      }
      return Response.json(saved)
    }
    throw new Error(`Unexpected Writer request: ${url}`)
  })
  const read = createYimengReadHandler({}, { fetch, readToken: () => 'test-only' })
  const command = createYimengCommandHandler({}, { fetch, readToken: () => 'test-only', readYimeng: read })
  return { fetch, read, command, saved: () => saved,
    afterPreview: (callback: () => void) => { afterPreview = callback },
    afterSave: (callback: () => void) => { afterSave = callback },
    loseSaveResponse: () => { loseSaveResponse = true } }
}

async function harness(adapter: MockAdapter, upstream = writer()) {
  const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
    if (specifier === '@deepseek-ai/dsh-persona') return Persona
    throw new Error(`Unexpected Loader import: ${specifier}`)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const presets = await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.provide('qingmuYimengRead', upstream.read)
  ctx.provide('qingmuYimengCommand', upstream.command)
  ctx.provide('qingmuImagoMethod', async () => { throw new Error('No method requested by this fixture') })
  const handle = await ctx.agents.create({ sessionId: SessionId('native-reference'), agentOptions: { provider: 'mock', model: 'mock' },
    meta: { agentPreset: 'qingmu-director' }, setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director') })
  const agent = handle.agent
  agent.session.append('qingmu-director-context/state', { version: 1,
    binding: { scope, contextSnapshotSha256: context.contextSnapshotSha256 }, proposal: null, transition: 'enter' })
  async function run() {
    const idle = new Promise<void>((resolve) => {
      const stop = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { stop(); resolve() } })
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '读取参考稿，只补充她放低声音、保持衣服座位，再保存。' }] }))
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
  return upstream.fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/drafts/f') && init?.method === 'POST')
}

it('reads, previews and saves through the shipped YAML preset and real adapters, then exposes the same version to the workspace', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('read', 'qingmu_read_reference_draft', { page: 1 }),
    toolCallResponse('preview', 'qingmu_preview_reference_draft', { draft: edit }),
    toolCallResponse('save', 'qingmu_save_reference_draft', saveArgs), textResponse('已保存导演稿；可在工作台恢复。'),
  ])
  const h = await harness(adapter); await h.run()
  for (const call of ['read', 'preview', 'save']) expect(result(h.agent, call).error).toBe(false)
  const preview = JSON.parse(result(h.agent, 'preview').text)
  expect(preview.prompt).toBe('图1在图2说：“图1也是原对白，不能改。” 她放低声音，保持原衣服与座位。')
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

it('rejects a shot switch during compilation before dispatching a save', async () => {
  const h = await harness(new MockAdapter([toolCallResponse('switch', 'qingmu_save_reference_draft', saveArgs), textResponse('镜头已变化。')]))
  h.upstream.afterPreview(() => h.agent.session.append('qingmu-director-context/state', {
    version: 1, binding: { scope: { ...scope, shotId: 'other' }, contextSnapshotSha256: context.contextSnapshotSha256 },
    proposal: null, transition: 'enter',
  }))
  await h.run(); expect(result(h.agent, 'switch').error).toBe(true)
  expect(saves(h.upstream)).toHaveLength(0)
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
