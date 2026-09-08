/** Native tool execution with logged receipts; fixture media are not production evidence. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { draftContext, draftScope, draftMethod } from '../examples/native-draft-fixture.ts'
import type { YimengScriptResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import * as ModelTools from '../src/model-tools.ts'
import type { readNativeDialogueInput } from '../src/native-dialogue.ts'
import { createDirectorContextBridge } from '../src/bridge.ts'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function harness(bound = false) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const source: YimengScriptResponse = { found: true, projectId: draftScope.projectId, episodeId: draftScope.episodeId,
    revision: 1, scriptSha256: '0'.repeat(64), editedByUser: false, updatedAt: '2026-09-07T00:00:00Z',
    script: { scenes: [{ title: '公路', dialogues: [{ lineId: 'line6', speakerId: 'lina', line: '有人吗？', verbatimText: '有人吗？' }] }] } }
  const cue = { schemaVersion: 'dialogue-cue-v2' as const, lineId: 'line6', speakerId: 'lina', verbatimText: '有人吗？',
    plannedStartSec: 1, plannedEndSec: 3, timingVerified: false, legacy: false }
  const relations: YimengShotRelationsProjection = { schema: 'jason.scene-shot-beat-element-relations.v1',
    projectId: draftScope.projectId, episodeId: draftScope.episodeId, valid: true, blockers: [], scenes: [],
    storyboardRevision: { episodeRevision: 1, revisionId: 'revision-1', revisionVersion: 1, sourceSha256: 'b'.repeat(64) },
    shots: [{ shotId: draftScope.shotId, sceneId: draftScope.sceneId, title: '公路呼喊', frameNo: 6, durationSec: 6,
      dialogueRhythm: { cueCount: 1, timedCueCount: 1, cues: [cue] }, beats: [], elements: [] },
    { shotId: 'next-shot', sceneId: draftScope.sceneId, title: '远景', frameNo: 7, durationSec: 6,
      dialogueRhythm: { cueCount: 0, timedCueCount: 0, cues: [] }, beats: [], elements: [] }],
  }
  const current = { source, relations, context: structuredClone(draftContext) as DirectorContextSnapshot,
    failMethod: false, committed: false, unknownRecovery: false }
  const calls: string[] = []
  ctx.provide('qingmuYimengCommand', async (endpoint, payload) => {
    calls.push(endpoint)
    if (endpoint === 'readDialogueEditCapability') return { ok: true, value: {
      schema: 'qingmu.dialogue-transaction-capability.v1', referenceSchema: 'qingmu.dialogue-edit-reference.v1', atomicScriptAndFrames: true } }
    if (endpoint === 'proposeScript') {
      expect(payload).toMatchObject({ references: [{ lineId: 'line6', affectedShotIds: [draftScope.shotId] }] })
      return { ok: true, value: { changeSet: { id: 'change-6', payloadSha256: 'c'.repeat(64) } } }
    }
    if (endpoint === 'previewScript') return { ok: true, value: { canCommit: true, revisionConflict: false, payloadSha256: 'c'.repeat(64) } }
    const receipt = { changeSetId: 'change-6', changed: true, commandReceiptId: 'committed-6', authoritativeRevision: 2,
      authoritativeSnapshotSha256: 'd'.repeat(64) }
    if (endpoint === 'recoverScriptCommit') return current.committed
      ? { ok: true, value: { recovered: true, receipt } }
      : { ok: false, error: { code: 'internal', message: current.unknownRecovery ? 'timeout'
        : 'Yimeng rejected command (HTTP 404: command_receipt_not_found)', details: {} } }
    if (endpoint === 'commitScript') {
      current.committed = true
      current.source = { ...current.source, revision: 2, scriptSha256: 'd'.repeat(64) }
      current.context = { ...current.context, script: { revision: 2, sha256: 'd'.repeat(64) },
        storyboard: { ...current.context.storyboard, id: 'revision-2', version: 2 }, contextSnapshotSha256: 'e'.repeat(64) }
      current.relations = { ...current.relations, storyboardRevision: { ...current.relations.storyboardRevision, revisionId: 'revision-2' } }
      return { ok: true, value: receipt }
    }
    if (endpoint !== 'readDirectorContext') throw new Error('Unexpected business write')
    return { ok: true, value: current.context }
  })
  ctx.provide('qingmuYimengRead', async (endpoint, args) => {
    calls.push(endpoint)
    expect(args).toEqual({ projectId: draftScope.projectId, episodeId: draftScope.episodeId })
    if (endpoint === 'script') return { ok: true, value: current.source }
    if (endpoint === 'workflow') return { ok: true, value: { projectId: draftScope.projectId, episodeId: draftScope.episodeId,
      director: { shotRelations: current.relations } } }
    throw new Error('Unexpected read')
  })
  ctx.provide('qingmuImagoMethod', async (_endpoint, payload) => {
    if (current.failMethod) throw new Error('method offline')
    const resource = (payload as { resourceId?: 'rough_final_feedback' }).resourceId ?? null
    calls.push(resource ?? 'shot_design')
    return { ok: true, value: draftMethod(resource) }
  })
  const session = Session.create(SessionId('dialogue-test'))
  session.append('qingmu-director-context/state', { version: 1, binding: { scope: draftScope,
    contextSnapshotSha256: draftContext.contextSnapshotSha256 }, proposal: null, transition: 'enter' })
  const agent = { id: session.id, session } as Agent
  let turn = 0
  const bridge = createDirectorContextBridge({ async readDirectorContext() { return { ok: true, context: current.context } } })
  async function humanTurn(hash = current.context.contextSnapshotSha256) {
    await bridge.enter(session, draftScope, undefined, 'browser-test')
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: JSON.stringify({ schema: 'qingmu.native-director-request.v1', sessionId: session.id,
        ownerId: 'browser-test', scope: draftScope, contextSnapshotSha256: hash }) },
      { type: 'text', text: '将有人吗？改为有人在吗？' },
    ] }), { surfaceOp: 'append' })
  }
  if (bound) await humanTurn()
  await ctx.plugin(Object.assign(async (inner: Context) => {
    await createScope(inner, agent).ctx.plugin(ModelTools)
  }, { inject: ['tools'] }))
  let step = 0
  async function run(name: string, args: object = {}) {
    const index = step++; const callId = CallId(`dialogue-${index}`)
    session.append('tool/call', { turn, step: index, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal: new AbortController().signal })
    session.append('tool/result', { turn, step: index,
      message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    }, { surfaceOp: 'append' })
    return result
  }
  async function read() {
    const result = await run('qingmu_read_dialogue')
    expect(result.isError).toBe(false)
    return result.value as unknown as Awaited<ReturnType<typeof readNativeDialogueInput>>
  }
  const edit = { lineId: 'line6', before: '有人吗？', after: '有人在吗？' }
  return { ctx, run, read, current, calls, edit, session,
    async nextHumanTurn(hash?: string) { turn++; await humanTurn(hash) } }
}

describe('native dialogue impact', () => {
  it('uses the real registered tools, loaded methods and logged source receipt', async () => {
    const app = await harness(); const input = await app.read()
    const result = await app.run('qingmu_preview_dialogue_edit', { receiptId: input.receiptId, ...app.edit })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ affectedShots: [{ shotId: draftScope.shotId, frameNo: 6 }],
      unchangedDialogueShots: [{ shotId: 'next-shot', frameNo: 7 }], businessStateChanged: false, providerCalls: 0 })
    expect(app.calls).toContain('shot_design'); expect(app.calls).toContain('rough_final_feedback')
    expect(app.calls.filter(name => name === 'script')).toHaveLength(2)
    expect(app.ctx.tools.schemas()).toEqual([])
  })
  it('does not accept invented receipts or a model-supplied project', async () => {
    const app = await harness()
    expect((await app.run('qingmu_preview_dialogue_edit', { receiptId: 'a'.repeat(64), ...app.edit })).isError).toBe(true)
    expect((await app.run('qingmu_read_dialogue', { projectId: 'other' })).isError).toBe(true)
    expect(app.calls).toEqual([])
  })
  it('rejects script revision drift before a suggestion is reused', async () => {
    const app = await harness(); const input = await app.read()
    app.current.source = { ...app.current.source, revision: 2 }
    expect((await app.run('qingmu_preview_dialogue_edit', { receiptId: input.receiptId, ...app.edit })).isError).toBe(true)
  })
  it('ignores renewed delivery URLs but rejects changed reference identity', async () => {
    const app = await harness()
    app.current.context = { ...app.current.context, selectedReferences: [{ assetId: 'lina-reference',
      sha256: '1'.repeat(64), mediaUrl: 'https://media.example.test/original-signed-url' }] }
    const input = await app.read()
    app.current.context = { ...app.current.context, selectedReferences: app.current.context.selectedReferences.map(reference =>
      ({ ...reference, mediaUrl: 'https://media.example.test/renewed-signed-url' })) }
    expect((await app.run('qingmu_preview_dialogue_edit', { receiptId: input.receiptId, ...app.edit })).isError).toBe(false)
    app.current.context = { ...app.current.context, selectedReferences: app.current.context.selectedReferences.map(reference =>
      ({ ...reference, assetId: 'different-asset' })) }
    expect((await app.run('qingmu_preview_dialogue_edit', { receiptId: input.receiptId, ...app.edit })).isError).toBe(true)
  })
  it('requires current IMAGO content instead of merely registered methods', async () => {
    const app = await harness(); app.current.failMethod = true
    expect((await app.run('qingmu_read_dialogue')).isError).toBe(true)
  })
  it('commits the staged Change Set once and recovers it without another write', async () => {
    const app = await harness(); const input = await app.read()
    const staged = await app.run('qingmu_stage_dialogue_edit', { receiptId: input.receiptId, ...app.edit })
    expect(staged.isError).toBe(false)
    const receiptId = (staged.value as { receiptId: string }).receiptId
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId })).value)
      .toMatchObject({ businessStateChanged: true, mediaGenerated: false, result: { recovered: false } })
    app.current.source = { ...app.current.source, revision: 2 }
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId })).value)
      .toMatchObject({ result: { recovered: true } })
    expect(app.calls.filter(name => name === 'commitScript')).toHaveLength(1)
  })
  it('does not commit when receipt recovery is uncertain', async () => {
    const app = await harness(); const input = await app.read()
    const staged = await app.run('qingmu_stage_dialogue_edit', { receiptId: input.receiptId, ...app.edit })
    app.current.unknownRecovery = true
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId: (staged.value as { receiptId: string }).receiptId })).isError).toBe(true)
    expect(app.calls).not.toContain('commitScript')
  })
  it('continues after its own save, and recovers after browser rebinding without another commit', async () => {
    const app = await harness(true); const input = await app.read()
    const staged = await app.run('qingmu_stage_dialogue_edit', { receiptId: input.receiptId, ...app.edit })
    const receiptId = (staged.value as { receiptId: string }).receiptId
    const saved = await app.run('qingmu_commit_dialogue_edit', { receiptId })
    expect(saved.isError).toBe(false)
    expect(saved.value).toMatchObject({ continuation: { before: 'a'.repeat(64), after: 'e'.repeat(64) } })
    expect((await app.read()).context.script.revision).toBe(2)
    await app.nextHumanTurn()
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId })).value).toMatchObject({ result: { recovered: true } })
    expect(app.calls.filter(name => name === 'commitScript')).toHaveLength(1)
    // A queued request with the old hash is not the turn that performed the save.
    await app.nextHumanTurn('a'.repeat(64))
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId })).value).toMatchObject({
      result: { recovered: true }, continuation: null })
    expect((await app.run('qingmu_read_dialogue')).isError).toBe(true)
  })
  it('does not use a successful save to authorize unrelated context drift', async () => {
    const app = await harness(true); const input = await app.read()
    const staged = await app.run('qingmu_stage_dialogue_edit', { receiptId: input.receiptId, ...app.edit })
    expect((await app.run('qingmu_commit_dialogue_edit', { receiptId: (staged.value as { receiptId: string }).receiptId })).isError).toBe(false)
    app.current.context = { ...app.current.context, shot: { ...app.current.context.shot, visual: '别人改了机位' }, contextSnapshotSha256: 'f'.repeat(64) }
    expect((await app.run('qingmu_read_dialogue')).isError).toBe(true)
  })
})
