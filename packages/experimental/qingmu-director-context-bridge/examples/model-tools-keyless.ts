/**
 * Keyless native director session using the shipped Qingmu preset and real agent loop.
 *
 * Run from the Harness root (no Provider, network, or Writer DB):
 *   node --import tsx packages/experimental/qingmu-director-context-bridge/examples/model-tools-keyless.ts
 */

import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import * as ModelTools from '../src/model-tools.ts'
import { draftContext, draftPrompt, draftMethod } from './native-draft-fixture.ts'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import { readNativeDirectorReadiness } from '../src/native-readiness.ts'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const scope = { projectId: 'example-project', episodeId: 'example-episode', sceneId: 'example-scene', shotId: 'example-shot' }
const contextSnapshotSha256 = 'a'.repeat(64)
const fourthReference = [
  '第四参考：粗剪到终版反馈闭环。',
  '逐镜比对锁定意图、表演、空间关系、声画线索和连续性。',
  '证据不足时保留未知，回到人工创作决定。',
].join('\n')

/** Deterministic external model stand-in; every request still comes from the native loop. */
class ExampleModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(readonly draftMode = false) { super() }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.requests.length
    this.requests.push(options)
    if (step < 2) {
      const name = this.draftMode ? (step === 0 ? 'qingmu_read_prompt_draft' : 'qingmu_propose_prompt_edit')
        : step === 0 ? 'qingmu_read_bound_context' : 'qingmu_get_imago_method'
      const receiptId = JSON.stringify(options.messages).match(/receiptId\\?":\\?"([a-f0-9]{64})/u)?.[1]
      const args = this.draftMode ? (step === 0 ? {} : { receiptId, field: 'imageGenPrompt',
        replacement: '她停在门口，门在画面左侧；背面中景，不要求正脸。', reason: '先明确门与人物位置，保留铃响后的停顿。' })
        : step === 0 ? {} : { capability: 'shot_design', resourceId: 'rough_final_feedback' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`read-${step}`), name, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '建议保留门口的停顿，先听见铃声，再看她的反应。尚未保存或生成。' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '建议保留门口的停顿，先听见铃声，再看她的反应。尚未保存或生成。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

/**
 * Run an isolated, memory-only native session and return its model-visible evidence.
 * @returns the actual composed persona, tools, logged calls/results and next-request method check.
 * @throws if the shipped preset fails to load or the session cannot complete.
 */
export async function runNativeDirectorExample(draftMode = false) {
  const ctx = new Context()
  try {
    const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))
    ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
        if (specifier === '@deepseek-ai/dsh-persona') return Persona
        throw new Error(`unexpected example plugin: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
    const model = new ExampleModel(draftMode)
    ctx.llm.registerAdapter(['keyless'], model)
    ctx.provide('qingmuYimengCommand', async (endpoint, payload) => {
      if (endpoint !== 'readDirectorContext' || JSON.stringify(payload) !== JSON.stringify(scope)) {
        throw new Error('example accepts only its session-bound context read')
      }
      if (draftMode) return { ok: true, value: draftContext }
      return { ok: true, value: {
        schema: 'jason.qingmu-director-context-snapshot.v1', ...scope, contextSnapshotSha256,
        shot: { id: scope.shotId, narrative: '门铃响起，她停在门口。' }, sourceScene: {}, selectedReferences: [],
        providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
        humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
      } }
    })
    ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
      if (draftMode) {
        if (endpoint !== 'directorInstructions') throw new Error('No method write allowed')
        return { ok: true, value: draftMethod((payload as { resourceId?: 'rough_final_feedback' }).resourceId ?? null) }
      }
      if (endpoint !== 'directorInstructions' || JSON.stringify(payload) !== JSON.stringify({ capability: 'shot_design', resourceId: 'rough_final_feedback' })) {
        throw new Error('example accepts only the fixed C5 fourth-reference page')
      }
      return { ok: true, value: {
        schema: 'qingmu.imago-director-instructions.v1', capability: 'shot_design',
        requestedResourceId: 'rough_final_feedback', sourceBindings: [{ resourceId: 'rough_final_feedback', sha256: 'b'.repeat(64) }],
        sources: [{ resourceId: 'rough_final_feedback', content: fourthReference }],
      } }
    })
    if (draftMode) ctx.provide('qingmuYimengRead', async (endpoint) => {
      if (endpoint !== 'promptIr') throw new Error('No business write allowed')
      return { ok: true, value: draftPrompt }
    })
    const handle = await ctx.agents.create({
      sessionId: SessionId('keyless-model-tools-example'), agentOptions: { provider: 'keyless', model: 'fixture' },
      meta: { agentPreset: 'qingmu-director' },
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director'),
    })
    handle.agent.session.append('qingmu-director-context/state', {
      version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter',
    })
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === handle.agent && status === 'idle') { dispose(); resolve() }
      })
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '看看当前镜头，参考导演方法给我建议。' }], source: { kind: 'user' } }))
    await idle
    const ordinary = await ctx.agents.create({ sessionId: SessionId('ordinary-example'),
      agentOptions: { provider: 'keyless', model: 'fixture' } })
    const ordinaryReadiness = readNativeDirectorReadiness(ctx, ordinary.agent.session)
    await ordinary.dispose()
    const result = {
      readiness: readNativeDirectorReadiness(ctx, handle.agent.session), ordinaryReadiness,
      ...(draftMode ? { draftProposal: await createDirectorContextRpcHandler(ctx.sessions, {
        readDirectorContext: async () => ({ ok: true, context: draftContext as DirectorContextSnapshot }),
      }, { prompt: ctx.qingmuYimengRead, method: ctx.qingmuImagoMethod })('readNativeDraftProposal', {
        sessionId: handle.agent.session.id, scope,
      }, new AbortController().signal) } : {}),
      preset: ctx.agentPresets.composedPreset(handle.agent.ctx),
      system: model.requests[0]?.system,
      tools: model.requests[0]?.tools?.map(tool => tool.name).sort(),
      calls: handle.agent.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name),
      results: handle.agent.session.events.filter(event => event.type === 'tool/result').map(event =>
        event.data.message.content.flatMap(part => part.content).filter(block => block.type === 'text').map(block => block.text).join('')),
      methodInNextRequest: JSON.stringify(model.requests[2]?.messages).includes('逐镜比对锁定意图'),
      rootTools: ctx.tools.schemas().map(tool => tool.name),
    }
    await handle.dispose()
    return { ...result, inactiveReadiness: readNativeDirectorReadiness(ctx, handle.agent.session) }
  } finally {
    await ctx.fiber.dispose()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runNativeDirectorExample(), null, 2))
}
