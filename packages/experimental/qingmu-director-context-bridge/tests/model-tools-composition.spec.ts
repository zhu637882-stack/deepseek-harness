/** Real preset + loop composition for the session-bound Qingmu native tools. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as Persona from '@deepseek-ai/dsh-persona'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ModelTools from '../src/model-tools.ts'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const scope = { projectId: 'project-a', episodeId: 'episode-a', sceneId: 'scene-a', shotId: 'shot-a' }
const sha = 'a'.repeat(64)
const roughFinalFeedback = [
  '第四参考：粗剪到终版反馈闭环。',
  '逐镜比对锁定的意图、表演、空间关系、声画线索和连续性；每条反馈必须定位到可编辑的镜头状态。',
  '若证据不足，保留未知并回到人工创作决定；不得把技术检查写成内容签收或生成授权。',
].join('\n')

function snapshot(contextSnapshotSha256 = sha) {
  return {
    schema: 'jason.qingmu-director-context-snapshot.v1', ...scope, contextSnapshotSha256,
    script: { revision: 1, sha256: '0'.repeat(64) }, sceneSource: {}, sourceTime: '2026-09-07T00:00:00Z',
    storyboard: { id: 'revision-1', version: 1, status: 'Ready' as const, sourceHash: 'b'.repeat(64) },
    shot: { id: scope.shotId, title: '门口', narrative: '铃声先响，她停在门口。', visual: '门口中景。',
      action: '她停顿。', durationSec: 4, dialogueLineIds: [] },
    sourceScene: { dialogue: '谁在那里？' }, creativeContract: null, selectedReferences: [],
    providerCalls: 0, costAmountCny: '0', businessStateChanged: false,
    humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false,
  } satisfies DirectorContextSnapshot
}

function bind(agent: Agent, contextSnapshotSha256 = sha): void {
  agent.session.append('qingmu-director-context/state', {
    version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter',
  })
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function resultText(events: readonly SessionEvent[], name: string): string {
  const call = events.find(item => item.type === 'tool/call' && item.data.name === name)
  if (call === undefined || call.type !== 'tool/call') throw new Error(`tool call missing: ${name}`)
  const event = events.find(item => item.type === 'tool/result' && item.data.message.source.callId === call.data.callId)
  if (event === undefined || event.type !== 'tool/result') throw new Error(`tool result missing: ${name}`)
  return event.data.message.content.flatMap(part => part.content)
    .filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Find an exact body even when the model request nests it inside tool-result JSON text. */
function includesExactString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    if (value === expected) return true
    try { return includesExactString(JSON.parse(value), expected) } catch { return false }
  }
  if (Array.isArray(value)) return value.some(item => includesExactString(item, expected))
  return value !== null && typeof value === 'object'
    && Object.values(value).some(item => includesExactString(item, expected))
}

/** A real Loader preset: host capabilities stay root-owned; native tools mount only below the agent. */
async function harness(adapter: MockAdapter, sessionRoot?: string): Promise<Context> {
  const presetRoot = fileURLToPath(new URL('../../qingmu-web/agent-presets/', import.meta.url))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(presetRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/model-tools') return ModelTools
      if (specifier === '@deepseek-ai/dsh-persona') return Persona
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (sessionRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
  await ctx.plugin(AgentPresets, { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.provide('qingmuYimengCommand', async (endpoint, payload) => {
    if (endpoint !== 'readDirectorContext') throw new Error(`unexpected command ${endpoint}`)
    if (JSON.stringify(payload) !== JSON.stringify(scope)) throw new Error('model supplied an out-of-session scope')
    return { ok: true, value: snapshot() }
  })
  ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
    if (endpoint !== 'directorInstructions') throw new Error(`unexpected method ${endpoint}`)
    if (JSON.stringify(payload) === JSON.stringify({ capability: 'shot_design', resourceId: 'rough_final_feedback' })) {
      return { ok: true, value: {
        capability: 'shot_design', requestedResourceId: 'rough_final_feedback', sourceSha256: 'c'.repeat(64),
        sources: [{ resourceId: 'rough_final_feedback', content: roughFinalFeedback }],
      } }
    }
    if (JSON.stringify(payload) !== JSON.stringify({ capability: 'director_development' })) throw new Error('unexpected method input')
    return { ok: true, value: {
      capability: 'director_development', sourceSha256: 'b'.repeat(64),
      sources: [{ content: '先确认人物意图与场景阻力，再安排机位和声画。' }],
    } }
  })
  return ctx
}

async function createQingmuAgent(ctx: Context, id: string): Promise<{ agent: Agent; dispose(): Promise<void> }> {
  return await ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' },
    meta: { agentPreset: 'qingmu-director' },
    setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'qingmu-director'),
  })
}

describe('Qingmu model tools through a real preset and agent loop', () => {
  it('logs model tool calls/results and presents both real bounded bodies to the next model request', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('read-context', 'qingmu_read_bound_context', {}),
      toolCallResponse('read-method', 'qingmu_get_imago_method', { capability: 'director_development' }),
      toolCallResponse('read-c5-feedback', 'qingmu_get_imago_method', { capability: 'shot_design', resourceId: 'rough_final_feedback' }),
      textResponse('已基于当前分镜上下文和导演方法给出建议。'),
    ])
    const ctx = await harness(adapter)
    const handle = await createQingmuAgent(ctx, 'qingmu-loop')
    bind(handle.agent)

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '读取当前上下文和导演方法。' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)

    const events = handle.agent.session.events
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['qingmu_read_bound_context', 'qingmu_get_imago_method', 'qingmu_get_imago_method'])
    expect(resultText(events, 'qingmu_read_bound_context')).toContain('铃声先响，她停在门口。')
    expect(resultText(events, 'qingmu_get_imago_method')).toContain('先确认人物意图与场景阻力')
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('铃声先响，她停在门口。')
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('先确认人物意图与场景阻力')
    const c5Call = events.filter(event => event.type === 'tool/call').at(-1)
    expect(c5Call?.type === 'tool/call' && JSON.parse(c5Call.data.arguments)).toEqual({ capability: 'shot_design', resourceId: 'rough_final_feedback' })
    const c5Result = events.filter(event => event.type === 'tool/result').at(-1)
    const c5Text = c5Result?.type === 'tool/result'
      ? c5Result.data.message.content.flatMap(part => part.content)
        .filter(block => block.type === 'text').map(block => block.text).join('')
      : ''
    expect(JSON.parse(c5Text)).toMatchObject({ method: { sources: [{ resourceId: 'rough_final_feedback', content: roughFinalFeedback }] } })
    // The exact complete fourth reference, not a summary or title, reaches the following model request.
    expect(includesExactString(adapter.requests[3]?.messages, roughFinalFeedback)).toBe(true)
    expect(ctx.tools.schemas()).toEqual([])
    expect(adapter.requests[0]?.system).toContain('你是青木的导演助手')
    expect(adapter.requests[0]?.system).toMatchSnapshot('shipped director persona')
    await handle.dispose()
  })

  it('keeps root and ordinary agents blind, while two Qingmu sessions stay independent and disposal unwinds one scope', async () => {
    const ctx = await harness(new MockAdapter([]))
    const first = await createQingmuAgent(ctx, 'qingmu-one')
    const second = await createQingmuAgent(ctx, 'qingmu-two')
    const ordinary = await ctx.agents.create({ sessionId: SessionId('ordinary'), agentOptions: { provider: 'mock', model: 'mock' } })
    bind(first.agent, '1'.repeat(64))
    bind(second.agent, '2'.repeat(64))

    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.schemas(ordinary.agent)).toEqual([])
    expect(ctx.tools.schemas(first.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_get_imago_method', 'qingmu_read_bound_context'])
    expect(ctx.tools.schemas(second.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_get_imago_method', 'qingmu_read_bound_context'])
    expect(first.agent.session.events.at(-1)?.data).toMatchObject({ binding: { contextSnapshotSha256: '1'.repeat(64) } })
    expect(second.agent.session.events.at(-1)?.data).toMatchObject({ binding: { contextSnapshotSha256: '2'.repeat(64) } })

    await first.dispose()
    expect(ctx.tools.schemas(second.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_get_imago_method', 'qingmu_read_bound_context'])
    expect(ctx.tools.schemas()).toEqual([])
    await second.dispose()
    await ordinary.dispose()
  })

  it('replays the persisted binding and preset, then executes the native read tool after a cold resume', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'qingmu-director-model-tools-session-'))
    roots.push(sessionRoot)
    const first = await harness(new MockAdapter([textResponse('seed')]), sessionRoot)
    const initial = await createQingmuAgent(first, 'qingmu-cold')
    bind(initial.agent)
    initial.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'seed log' }], source: { kind: 'user' } }))
    await waitForIdle(first, initial.agent)
    await first.sessions.flush(initial.agent.session)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const adapter = new MockAdapter([
      toolCallResponse('recovered-read', 'qingmu_read_bound_context', {}),
      textResponse('恢复后已读到当前分镜。'),
    ])
    const resumed = await harness(adapter, sessionRoot)
    const handle = await resumed.agents.resume({
      resumeSessionId: SessionId('qingmu-cold'), agentOptions: { provider: 'mock', model: 'mock' },
      setup: async agentCtx => void await resumed.agentPresets.mount(agentCtx, 'qingmu-director'),
    })
    expect(resumed.tools.schemas(handle.agent).map(tool => tool.name).sort())
      .toEqual(['qingmu_get_imago_method', 'qingmu_read_bound_context'])

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '恢复后读取。' }], source: { kind: 'user' } }))
    await waitForIdle(resumed, handle.agent)
    expect(resultText(handle.agent.session.events, 'qingmu_read_bound_context')).toContain('铃声先响，她停在门口。')
    await handle.dispose()
  })
})
