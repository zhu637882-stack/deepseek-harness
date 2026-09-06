import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import * as ModelTools from '../src/model-tools.ts'
import { draftContext, draftPrompt, draftMethod, draftScope, firstDraftBootstrap } from '../examples/native-draft-fixture.ts'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import type { NativeDraftInput, NativeFirstDraftInput } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function harness() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const current = { context: structuredClone(draftContext), prompt: structuredClone(draftPrompt),
    bootstrap: structuredClone(firstDraftBootstrap) as import('@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types').YimengPromptIrBootstrapResponse,
    methodSuffix: '', fail: false, wait: async () => {} }
  const calls: string[] = []
  ctx.provide('qingmuYimengCommand', async (endpoint) => {
    calls.push(endpoint)
    if (endpoint !== 'readDirectorContext') throw new Error('Business command forbidden')
    return { ok: true, value: current.context }
  })
  ctx.provide('qingmuYimengRead', async (endpoint) => {
    calls.push(endpoint); await current.wait()
    if (current.fail) throw new Error('offline')
    if (endpoint === 'promptIrBootstrap') return { ok: true, value: current.bootstrap }
    if (endpoint !== 'promptIr') throw new Error('Unexpected read')
    return { ok: true, value: current.prompt }
  })
  ctx.provide('qingmuImagoMethod', async (endpoint, payload) => {
    calls.push(endpoint)
    if (endpoint !== 'directorInstructions') throw new Error('Method mutation forbidden')
    const result = draftMethod((payload as { resourceId?: 'rough_final_feedback' }).resourceId ?? null)
    result.sources[0]!.content += current.methodSuffix
    return { ok: true, value: result }
  })
  const session = Session.create(SessionId('native-draft-test'))
  const bind = (shotId = draftScope.shotId) => session.append('qingmu-director-context/state', {
    version: 1, binding: { scope: { ...draftScope, shotId }, contextSnapshotSha256: current.context.contextSnapshotSha256 },
    proposal: null, transition: 'enter',
  })
  bind()
  const agent = { id: session.id, session } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  await scope.ctx.plugin(ModelTools)
  let step = 0
  async function run(name: string, args: object = {}, signal = new AbortController().signal, log = true) {
    const index = step++; const callId = CallId(`call-${index}`)
    if (log) session.append('tool/call', { turn: 0, step: index, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal })
    if (log) session.append('tool/result', { turn: 0, step: index, message: {
      role: 'tool', content: [{ type: 'tool-result', toolCallId: callId, content: result.content, isError: result.isError }],
    } }, { surfaceOp: 'append' })
    return result
  }
  const proposal = async (receiptId?: string) => {
    const input = receiptId ?? ((await run('qingmu_read_prompt_draft')).value as unknown as NativeDraftInput).receiptId
    return run('qingmu_propose_prompt_edit', { receiptId: input, field: 'imageGenPrompt', replacement: '门在人物左侧，背面中景。', reason: '明确空间与可见性。' })
  }
  const rpc = createDirectorContextRpcHandler({ get: id => id === session.id ? session : undefined }, {
    readDirectorContext: async () => ({ ok: true, context: current.context as DirectorContextSnapshot }),
  }, { prompt: ctx.qingmuYimengRead, method: ctx.qingmuImagoMethod })
  const read = (scope = draftScope, signal = new AbortController().signal) => rpc('readNativeDraftProposal', { sessionId: session.id, scope }, signal)
  const readFirst = () => rpc('readNativeFirstDraftProposal', { sessionId: session.id, scope: draftScope }, new AbortController().signal)
  return { ctx, session, current, run, proposal, bind, read, calls, readFirst }
}

describe('native first prompt suggestions', () => {
  it('reads complete method content and records a five-field proposal without business writes', async () => {
    const app = await harness()
    const input = (await app.run('qingmu_read_first_draft')).value as unknown as NativeFirstDraftInput
    expect(input.methods).toHaveLength(2)
    expect(input.bootstrap.draft).toBe(null)
    const result = await app.run('qingmu_propose_first_draft', { receiptId: input.receiptId, reason: '交代空间与声画',
      ...draftPrompt.subject.editableProjection })
    expect(result.isError).toBe(false)
    expect(await app.readFirst()).toMatchObject({ ok: true, value: { status: 'current', proposal: {
      editableProjection: draftPrompt.subject.editableProjection,
    } } })
    expect(new Set(app.calls)).toEqual(new Set(['readDirectorContext', 'promptIrBootstrap', 'directorInstructions']))
  })

  it.each(['method', 'context', 'binding', 'existing'] as const)('rejects first-draft adoption after %s changes', async (change) => {
    const app = await harness()
    const input = (await app.run('qingmu_read_first_draft')).value as unknown as NativeFirstDraftInput
    await app.run('qingmu_propose_first_draft', { receiptId: input.receiptId, reason: '空间', ...draftPrompt.subject.editableProjection })
    if (change === 'method') app.current.methodSuffix = 'changed'
    if (change === 'context') app.current.context.shot.narrative = '剧情修改'
    if (change === 'binding') app.bind('other')
    if (change === 'existing') app.current.bootstrap = { ...app.current.bootstrap, ready: draftPrompt.subject as NativeDraftInput['prompt']['subject'] }
    expect(await app.readFirst()).not.toMatchObject({ value: { status: 'current' } })
    expect((await app.run('qingmu_propose_first_draft', { receiptId: input.receiptId, reason: '空间', ...draftPrompt.subject.editableProjection })).isError).toBe(true)
  })

  it('rejects invented receipts, missing fields and extra authority', async () => {
    const app = await harness()
    const args = { receiptId: 'a'.repeat(64), reason: '空间', ...draftPrompt.subject.editableProjection }
    expect((await app.run('qingmu_propose_first_draft', args)).isError).toBe(true)
    args.receiptId = ((await app.run('qingmu_read_first_draft')).value as unknown as NativeFirstDraftInput).receiptId
    expect((await app.run('qingmu_propose_first_draft', { ...args, status: 'Ready' })).isError).toBe(true)
    const { imageGenPrompt: _image, ...missing } = args
    expect((await app.run('qingmu_propose_first_draft', missing)).isError).toBe(true)
    for (const reason of [' padded ', 'nul\u0000text']) {
      expect((await app.run('qingmu_propose_first_draft', { ...args, reason })).isError).toBe(true)
    }
  })
})

describe('native prompt suggestions', () => {
  it('requires a successfully logged actual read, not an invented or unlogged receipt', async () => {
    const app = await harness()
    expect((await app.proposal('a'.repeat(64))).isError).toBe(true)
    const unlogged = await app.run('qingmu_read_prompt_draft', {}, undefined, false)
    expect((await app.proposal((unlogged.value as unknown as NativeDraftInput).receiptId)).isError).toBe(true)
    expect((await app.proposal()).isError).toBe(false)
    expect(await app.read()).toMatchObject({ ok: true, value: { status: 'current', proposal: { before: draftPrompt.subject.editableProjection.imageGenPrompt } } })
    expect(new Set(app.calls)).toEqual(new Set(['readDirectorContext', 'promptIr', 'directorInstructions']))
    expect(app.ctx.tools.schemas()).toEqual([])
  })

  it.each(['prompt', 'context', 'method', 'binding'] as const)('rejects a proposal after %s changes', async (change) => {
    const app = await harness()
    const input = (await app.run('qingmu_read_prompt_draft')).value as unknown as NativeDraftInput
    if (change === 'prompt') app.current.prompt.subject.editableProjection.imageGenPrompt = '用户的新原文'
    if (change === 'context') app.current.context.contextSnapshotSha256 = 'b'.repeat(64)
    if (change === 'method') app.current.methodSuffix = '新增方法'
    if (change === 'binding') app.bind()
    expect((await app.proposal(input.receiptId)).isError).toBe(true)
  })

  it('returns stale or unavailable instead of leaking another shot or trusting an old suggestion', async () => {
    const app = await harness(); await app.proposal()
    expect(await app.read({ ...draftScope, shotId: 'other' })).toMatchObject({ ok: true, value: { status: 'stale' } })
    app.current.fail = true
    expect(await app.read()).toMatchObject({ ok: true, value: { status: 'unavailable' } })
    app.current.fail = false; app.current.methodSuffix = 'changed'
    expect(await app.read()).toMatchObject({ ok: true, value: { status: 'stale' } })
  })

  it.each(['clear', 'cancel', 'switch'] as const)('discards an in-flight input after %s', async (change) => {
    const app = await harness()
    let finish!: () => void; let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    app.current.wait = () => { started(); return new Promise<void>((resolve) => { finish = resolve }) }
    const controller = new AbortController()
    const pending = app.run('qingmu_read_prompt_draft', {}, controller.signal)
    await waiting
    if (change === 'clear') app.session.append('qingmu-director-context/state', null)
    if (change === 'cancel') controller.abort()
    if (change === 'switch') app.bind('other')
    finish()
    expect((await pending).isError).toBe(true)
  })

  it('rechecks binding after facade I/O and rejects caller-supplied scope fields in tools', async () => {
    const app = await harness(); await app.proposal()
    app.current.wait = async () => { app.bind('other') }
    expect(await app.read()).toMatchObject({ ok: true, value: { status: 'stale' } })
    expect((await app.run('qingmu_read_prompt_draft', { projectId: 'injected' })).isError).toBe(true)
  })

  it('keeps no-result distinct from current and rejects wrong prompt identities', async () => {
    const app = await harness()
    expect(await app.read()).toMatchObject({ ok: true, value: { status: 'none' } })
    app.current.prompt.subject.frameId = 'other'
    expect((await app.run('qingmu_read_prompt_draft')).isError).toBe(true)
  })
})
