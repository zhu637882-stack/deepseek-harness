import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import * as ModelTools from '../src/model-tools.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const objectScope = { projectId: 'p', episodeId: 'e', sceneId: 's', shotId: 'h' }
const sha = 'a'.repeat(64)
function snapshot(hash = sha) {
  return {
    schema: 'jason.qingmu-director-context-snapshot.v1', ...objectScope,
    contextSnapshotSha256: hash,
    shot: { id: 'h', narrative: '通知先振动，她再停住；不提前下结论。' },
    sourceScene: { dialogue: '你刚才说的是谁？' },
    selectedReferences: [], providerCalls: 0, costAmountCny: '0',
    businessStateChanged: false, humanDecisionInferred: false, formalQcInferred: false,
    selectionGranted: false, readyGranted: false,
  }
}

function bind(session: Session, hash = sha, shotId = 'h') {
  session.append('qingmu-director-context/state', {
    version: 1, binding: { scope: { ...objectScope, shotId }, contextSnapshotSha256: hash },
    proposal: null, transition: 'enter',
  })
}

async function harness(command: ConnectionRpcHandler, method: ConnectionRpcHandler = async () => ({
  ok: true, value: { capability: 'director_development', sources: [{ content: '先建立全剧和场景意图，再决定机位。' }] },
}), config?: ModelTools.Config) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('qingmuYimengCommand', command)
  ctx.provide('qingmuImagoMethod', method)
  const session = Session.create(SessionId('director-tools'))
  const agent = { id: session.id, session } as Agent
  let scoped!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent) }, {
    inject: ['tools', 'qingmuYimengCommand', 'qingmuImagoMethod'],
  }))
  await scoped.ctx.plugin(ModelTools, config)
  const run = (name: string, args: object = {}, signal = new AbortController().signal) => ctx.tools.execute({
    callId: CallId('unit-call'), name, arguments: args, agent, signal,
  })
  return { ctx, session, agent, scoped, run }
}

describe('native director read tools', () => {
  it('reads only the durable session object and keeps the actual creative input', async () => {
    const calls: unknown[] = []
    const app = await harness(async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: snapshot() }
    })
    bind(app.session)
    const result = await app.run('qingmu_read_bound_context')
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ contextSnapshot: snapshot(), contextSnapshotSha256: sha })
    expect(calls).toEqual([{ endpoint: 'readDirectorContext', payload: objectScope }])
    expect(app.ctx.tools.schemas()).toEqual([])
  })

  it('does not guess an unbound session or forward model-supplied scope', async () => {
    let calls = 0
    const app = await harness(async () => { calls += 1; return { ok: true, value: snapshot() } })
    expect((await app.run('qingmu_read_bound_context')).isError).toBe(true)
    bind(app.session)
    expect((await app.run('qingmu_read_bound_context', { projectId: 'other' })).isError).toBe(true)
    expect((await app.run('qingmu_get_imago_method', { capability: 'director_development', coreRoot: '/tmp' })).isError).toBe(true)
    expect(calls).toBe(0)
  })

  it('refreshes changed context instead of returning an old body under a new hash', async () => {
    const current = 'b'.repeat(64)
    const app = await harness(async () => ({ ok: true, value: snapshot(current) }))
    bind(app.session)
    const result = await app.run('qingmu_read_bound_context')
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ contextSnapshot: snapshot(current), contextSnapshotSha256: current })
    expect(app.session.events.at(-1)?.data).toMatchObject({
      transition: 'recovery_drift', binding: { contextSnapshotSha256: current }, proposal: null,
    })
  })

  it('leaves manual editing and the last binding intact when a read fails', async () => {
    const app = await harness(async () => ({ ok: false, error: {
      code: 'internal', message: 'upstream unavailable', details: {},
    } }))
    bind(app.session)
    const before = [...app.session.events]
    expect((await app.run('qingmu_read_bound_context')).isError).toBe(true)
    expect(app.session.events).toEqual(before)
  })

  it('rejects a late read after the user switches shots', async () => {
    let complete!: () => void
    const ready = new Promise<void>((resolve) => { complete = resolve })
    let requested!: () => void
    const started = new Promise<void>((resolve) => { requested = resolve })
    const app = await harness(async () => { requested(); await ready; return { ok: true, value: snapshot() } })
    bind(app.session)
    const result = app.run('qingmu_read_bound_context')
    await started
    bind(app.session, 'b'.repeat(64), 'other-shot')
    complete()
    expect((await result).isError).toBe(true)
    expect(app.session.events.at(-1)?.data).toMatchObject({ binding: { scope: { shotId: 'other-shot' } } })
  })

  it('loads full method content through the configured host, without creating a work order', async () => {
    const calls: string[] = []
    const app = await harness(async (endpoint) => {
      calls.push(endpoint); return { ok: true, value: snapshot() }
    }, async (endpoint, payload) => {
      calls.push(endpoint)
      expect(payload).toEqual({ capability: 'director_development' })
      return { ok: true, value: { sources: [{ content: '全剧理解；刺激、意图、策略、后果；聆听者反应与声画关系。' }] } }
    })
    bind(app.session)
    const result = await app.run('qingmu_get_imago_method', { capability: 'director_development' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain('聆听者反应与声画关系')
    expect(calls).toEqual(['readDirectorContext', 'directorInstructions'])
  })

  it('rejects oversized context without silently truncating it', async () => {
    const app = await harness(async () => ({ ok: true, value: snapshot() }), undefined, { maxOutputBytes: 64 })
    bind(app.session)
    expect((await app.run('qingmu_read_bound_context')).isError).toBe(true)
  })

  it('reads the allowlisted follow-up reference without exposing filesystem arguments', async () => {
    const calls: unknown[] = []
    const app = await harness(async () => ({ ok: true, value: snapshot() }), async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { sources: [{ content: '粗分镜到生产反馈的完整闭合方法。' }] } }
    })
    bind(app.session)
    const result = await app.run('qingmu_get_imago_method', { capability: 'shot_design', resourceId: 'rough_final_feedback' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain('完整闭合方法')
    expect(calls).toEqual([{ endpoint: 'directorInstructions', payload: { capability: 'shot_design', resourceId: 'rough_final_feedback' } }])
    expect((await app.run('qingmu_get_imago_method', { capability: 'director_development', resourceId: 'rough_final_feedback' })).isError).toBe(true)
    expect((await app.run('qingmu_get_imago_method', { capability: 'shot_design', resourceId: '../../private' })).isError).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it.each(['switch', 'cancel'] as const)('rejects method results after a %s during the read', async (change) => {
    let complete!: () => void
    const ready = new Promise<void>((resolve) => { complete = resolve })
    let requested!: () => void
    const started = new Promise<void>((resolve) => { requested = resolve })
    const app = await harness(async () => ({ ok: true, value: snapshot() }), async () => {
      requested()
      await ready
      return { ok: true, value: { sources: [{ content: 'must not reach the model' }] } }
    })
    bind(app.session)
    const controller = new AbortController()
    const result = app.run('qingmu_get_imago_method', { capability: 'shot_design' }, controller.signal)
    await started
    if (change === 'switch') bind(app.session, 'b'.repeat(64), 'other-shot')
    else controller.abort()
    complete()
    const settled = await result
    expect(settled.isError).toBe(true)
    expect(JSON.stringify(settled)).not.toContain('must not reach the model')
  })

  it('rejects a method package below the source limit but over the model response limit', async () => {
    // 300,000 UTF-8 bytes: larger than this consumer's 256 KiB, below the adapter's 512 KiB.
    const app = await harness(async () => ({ ok: true, value: snapshot() }), async () => ({
      ok: true, value: { sources: [{ content: '光'.repeat(100000) }] },
    }))
    bind(app.session)
    const result = await app.run('qingmu_get_imago_method', { capability: 'shot_design' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('no content was truncated')
    expect(JSON.stringify(result)).not.toContain('光光光')
  })

  it('does not perform an adapter read after cancellation', async () => {
    let calls = 0
    const app = await harness(async () => { calls += 1; return { ok: true, value: snapshot() } })
    bind(app.session)
    const controller = new AbortController()
    controller.abort()
    expect((await app.run('qingmu_read_bound_context', {}, controller.signal)).isError).toBe(true)
    expect(calls).toBe(0)
  })
})
