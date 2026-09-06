/** Opt-in source-plane integration: real Loader/native loop, Core subprocess and Writer HTTP/SQLite.
 * Only external model output, synthetic input data and one lost HTTP response are controlled.
 * Ready selection uses a synthetic test identity; no deployment, production data,
 * paid model, or real-project human content signoff is exercised.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as Persona from '@deepseek-ai/dsh-persona'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { createYimengCommandHandler } from '../../qingmu-yimeng-command-adapter/src/index.ts'
import { createImagoMethodHandler } from '../../qingmu-imago-method-adapter/src/index.ts'
import { normalizeDirectorContext, parseDirectorContextRequest } from '../../qingmu-yimeng-command-adapter/src/director-proposal.ts'
import * as ModelTools from '../src/model-tools.ts'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import { toolValues } from '../src/native-draft.ts'
import type { NativeFirstDraftInput, NativeFirstDraftProposal, DirectorObjectScope } from '../src/types.ts'
import type { DirectorContextSnapshot } from '../../qingmu-yimeng-command-adapter/src/types.ts'
import { runConnectedBrowser } from './connected-browser.ts'

const writerRoot = process.env.QINGMU_WRITER_TEST_ROOT
const coreRoot = process.env.QINGMU_CORE_TEST_ROOT
const authored = {
  imageGenPrompt: '雨夜旧车站空月台，摄影机在站台内侧；铁轨在右侧，无人物。',
  lastFrameImagePrompt: '同一空月台，摄影机前推后仍保持铁轨在右侧。',
  videoGenPrompt: '四秒缓慢前推；月台、铁轨位置不变，不新增人物；只听雨声。',
  motionPrompt: '摄影机向前缓慢移动四秒，不越过站台边缘。',
  negativePrompt: '不得新增人物、列车或对白；不得翻转铁轨与站台方向。',
}

interface Fixture {
  baseUrl: string
  scope: DirectorObjectScope
  storyboardRevisionId: string
  attestationKey: string
  token: string
}

// Never silently skip a failed configured fixture. Missing opt-in alone skips it.
it.skipIf(!writerRoot || !coreRoot)('persists a native first draft through actual Writer and rereads after response loss', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-connected-'))
  const child = spawn(join(writerRoot!, '.venv/bin/python'), ['-B', fileURLToPath(new URL('./connected-writer.py', import.meta.url))], {
    cwd: root, env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1', QINGMU_WRITER_TEST_ROOT: writerRoot! },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  // Consume rejection now, while retaining it for teardown/startup diagnostics.
  void exited.catch(() => {})
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-8000) })
  const ctx = new Context()
  try {
    const fixture = await new Promise<Fixture>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`Writer fixture startup timed out: ${stderr}`)), 20000)
      const finish = () => { clearTimeout(timer); child.stdout.off('data', onData) }
      const onData = (chunk: Buffer) => {
        output += String(chunk)
        for (const line of output.split('\n').slice(0, -1)) {
          if (!line.startsWith('{"fixtureReady":')) continue
          finish(); resolve(JSON.parse(line) as Fixture); return
        }
      }
      child.stdout.on('data', onData)
      void exited.then(() => { finish(); reject(new Error(`Writer fixture exited: ${stderr}`)) }, reject)
    })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', fixture.attestationKey)
    const signal = AbortSignal.timeout(90000)
    const token = () => fixture.token
    const read = createYimengReadHandler({ baseUrl: fixture.baseUrl }, { fetch, readToken: token })
    let loseSaveResponse = true
    let savePosts = 0
    const command = createYimengCommandHandler({ baseUrl: fixture.baseUrl }, {
      readToken: token,
      fetch: async (input, init) => {
        const response = await fetch(input, init)
        if (String(input).endsWith('/prompt-ir-bootstrap/commands')) {
          savePosts++
          if (loseSaveResponse && response.ok) {
            loseSaveResponse = false
            await response.arrayBuffer() // Writer committed; the caller loses only the response.
            throw new Error('test transport response lost after commit')
          }
        }
        return response
      },
    })
    const method = createImagoMethodHandler({ coreRoot: coreRoot! })
    const unwrap = async <T>(pending: Promise<{ ok: true; value: T } | { ok: false }>): Promise<T> => {
      const result = await pending
      if (!result.ok) throw new Error(JSON.stringify(result))
      return result.value
    }
    const frame = { projectId: fixture.scope.projectId, episodeId: fixture.scope.episodeId,
      storyboardRevisionId: fixture.storyboardRevisionId, frameId: fixture.scope.shotId }
    const state = await unwrap(read('promptIrBootstrap', frame, signal))
    const contextUrl = `${fixture.baseUrl}/api/qingmu/projects/${frame.projectId}/episodes/${frame.episodeId}/director-inference/context?`
      + new URLSearchParams({ sceneId: fixture.scope.sceneId, shotId: fixture.scope.shotId })
    const contextResponse = await fetch(contextUrl, { headers: { authorization: `Bearer ${token()}` } })
    expect(contextResponse.status).toBe(200)
    const helpers = { inputError: (message: string) => new Error(message), responseError: (message: string) => new Error(message) }
    normalizeDirectorContext(await contextResponse.json(), parseDirectorContextRequest(fixture.scope, helpers), helpers)
    await unwrap(command('readDirectorContext', fixture.scope, signal))
    expect(state).toMatchObject({ draft: null, ready: null })
    expect((await fetch(fixture.baseUrl + '/fixture/inspection').then(r => r.json())).counts.prompt_irs).toBe(0)

    const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))
    ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
      if (specifier === '@deepseek-ai/dsh-persona') return Persona
      throw new Error(`unexpected integration plugin: ${specifier}`)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
    ctx.provide('qingmuYimengRead', read)
    ctx.provide('qingmuYimengCommand', command)
    ctx.provide('qingmuImagoMethod', method)

    class ScriptedModel extends LlmAdapter {
      requests: GenerateOptions[] = []
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const step = this.requests.push(options) - 1
        if (step > 2) throw new Error('Unexpected extra model request')
        if (step === 2) { yield { type: 'finish', reason: { kind: 'stop' } }; return }
        const receipt = toolValues(handle.agent.session, 'qingmu_read_first_draft').at(-1) as NativeFirstDraftInput | undefined
        if (step === 1 && !receipt) throw new Error('Real Writer/method read did not succeed')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`connected-${step}`),
          name: step === 0 ? 'qingmu_read_first_draft' : 'qingmu_propose_first_draft',
          arguments: JSON.stringify(step === 0 ? {} : { receiptId: receipt!.receiptId, reason: '保持空月台空间关系。', ...authored }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }
    const model = new ScriptedModel()
    ctx.llm.registerAdapter(['connected-scripted'], model)
    const handle = await ctx.agents.create({ sessionId: SessionId('connected-native-first-draft'),
      agentOptions: { provider: 'connected-scripted', model: 'fixture' }, meta: { agentPreset: 'qingmu-director' },
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director') })
    const bridge = createDirectorContextRpcHandler(ctx.sessions, {
      readDirectorContext: async (scope, requestSignal) => {
        const result = await command('readDirectorContext', scope, requestSignal)
        return result.ok ? { ok: true, context: result.value as DirectorContextSnapshot } : { ok: false, reason: 'unavailable' }
      },
    }, { prompt: read, method })
    const bound = await unwrap(bridge('enter', { sessionId: handle.agent.session.id, scope: fixture.scope }, signal))
    expect(bound.status).toBe('current')
    const idle = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native fixture turn timed out')), 20000)
      const dispose = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === handle.agent && status === 'idle') { clearTimeout(timer); dispose(); resolve() }
      })
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '请读取本镜和 IMAGO 方法，给出空月台首稿。' }], source: { kind: 'user' } }))
    await idle
    expect(handle.agent.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['qingmu_read_first_draft', 'qingmu_propose_first_draft'])
    const receipt = toolValues(handle.agent.session, 'qingmu_read_first_draft').at(-1) as NativeFirstDraftInput
    expect(receipt.bootstrap.contextSnapshotSha256).toBe(state.contextSnapshotSha256)
    expect(receipt.methods).toHaveLength(2)
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('rough_final_feedback')
    const current = await unwrap(bridge('readNativeFirstDraftProposal', { sessionId: handle.agent.session.id, scope: fixture.scope }, signal))
    expect(current.status).toBe('current')
    const suggestion = current.proposal as NativeFirstDraftProposal
    expect(suggestion.editableProjection).toEqual(authored)
    // Browser opt-in performs adoption and editing in the actual component; API mode tests recovery contracts directly.
    const edited = { ...suggestion.editableProjection, imageGenPrompt: authored.imageGenPrompt + '远处站牌处于画面左侧。' }
    if (process.env.QINGMU_CONNECTED_BROWSER === '1') {
      await runConnectedBrowser(root, { frame, scope: fixture.scope, sessionId: handle.agent.session.id },
        edited.imageGenPrompt, { read, command, method, bridge })
    } else {
      const compiled = await unwrap(method('promptIrBootstrapMethod', { context: state.context,
        contextSnapshotSha256: state.contextSnapshotSha256, editableProjection: edited }, signal))
      expect(compiled.projection.candidate.editableProjection).toEqual(edited)
      const marker = { ...frame, idempotencyKey: 'connected-first-draft-save',
        expectedContextSnapshotSha256: state.contextSnapshotSha256, methodProjectionSha256: compiled.projectionSha256 }
      expect(await command('bootstrapPromptIr', { ...marker, methodProjection: compiled.projection,
        methodAttestation: compiled.methodAttestation }, signal)).toMatchObject({ ok: false })
      const recovered = await unwrap(command('recoverPromptIrBootstrap', marker, signal))
      expect(recovered).toMatchObject({ deduplicated: true, promptIr: { status: 'Draft', editableProjection: edited } })
      const persisted = await unwrap(read('promptIrBootstrap', frame, signal))
      expect(persisted.draft.editableProjection).toEqual(edited)
      expect(persisted.ready).toBeNull()
      expect(savePosts).toBe(1)
      expect(await command('recoverPromptIrBootstrap', { ...marker, methodProjectionSha256: '0'.repeat(64) }, signal)).toMatchObject({ ok: false })
      const obsolete = await unwrap(bridge('readNativeFirstDraftProposal', { sessionId: handle.agent.session.id, scope: fixture.scope }, signal))
      expect(obsolete.status).not.toBe('current')
      const fresh = await unwrap(method('promptIrBootstrapMethod', { context: persisted.context,
        contextSnapshotSha256: persisted.contextSnapshotSha256, editableProjection: persisted.draft.editableProjection,
        selectionChallenge: persisted.selectionChallenge }, signal))
      const selection = { ...frame, draftPromptIrId: persisted.draft.promptIrId,
        draftVersion: persisted.draft.promptIrVersion, draftContentSha256: persisted.draft.promptIrContentSha256,
        bootstrapMethodSha256: recovered.methodSha256, methodProjection: fresh.projection,
        methodProjectionSha256: fresh.projectionSha256, methodAttestation: fresh.methodAttestation,
        selectionChallenge: persisted.selectionChallenge, selectionFreshnessAttestation: fresh.selectionFreshnessAttestation,
        idempotencyKey: 'connected-first-draft-select' }
      await unwrap(command('selectBootstrapPromptIr', selection, signal))
    }
    // A new reader represents the outer workspace refresh, not the save response.
    const refreshedReader = createYimengReadHandler({ baseUrl: fixture.baseUrl }, { fetch, readToken: token })
    const refreshed = await unwrap(refreshedReader('promptIrBootstrap', frame, signal))
    expect(refreshed.ready.editableProjection).toEqual(edited)
    expect(refreshed.ready.status).toBe('Ready')
    expect(refreshed.draft).toBeNull()
    const inspection = await fetch(fixture.baseUrl + '/fixture/inspection').then(r => r.json())
    expect(inspection).toEqual({ integrity: 'ok', counts: { prompt_irs: 1, generation_tasks: 0, provider_submission_outbox: 0 } })
    expect(savePosts).toBe(1)
    await handle.dispose()
  } catch (error) {
    throw new Error(`${String(error)}\nWriter stderr: ${stderr}`, { cause: error })
  } finally {
    try { await ctx.fiber.dispose() } finally {
      try { vi.unstubAllEnvs() } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
        try { await exited } finally { clearTimeout(killTimer); await rm(root, { recursive: true, force: true }) }
      }
    }
  }
}, 90000)
