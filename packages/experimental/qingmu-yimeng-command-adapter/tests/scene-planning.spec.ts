import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const scope = { projectId: 'project_1', episodeId: 'episode_1' }
const state = { ...scope, schema: 'jason.qingmu-scene-planning-state.v1', scriptRevision: 0, scriptSha256: null, scenes: [],
  storyboard: null, planning: null, providerCalls: 0, stageStarted: false, approvalGranted: false }
const request = { ...scope, idempotencyKey: 'planning-1', request: { action: 'initialize', sceneIndex: 1,
  expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 0, expectedStoryboardSha256: null,
  shots: [{ title: '门口', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }] } }
const setup = (result: unknown = state) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}
describe('bounded scene planning Host channel', () => {
  it('only reads the exact scope and never falls back to the old instance', async () => {
    const { handler, fetch } = setup()
    expect(await handler('readScenePlanning', scope, new AbortController().signal)).toEqual({ ok: true, value: state })
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/qingmu/projects/project_1/episodes/episode_1/scene-planning')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' })
  })
  it.each([{ projectId: '../escape' }, { path: '/api/pipeline/final' }, { approved: true }])('rejects forbidden requests %j', async (change) => {
    const { handler, fetch } = setup()
    expect(await handler('readScenePlanning', { ...scope, ...change }, new AbortController().signal)).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ projectId: 'other' }, { providerCalls: 1 }, { approvalGranted: true }, { stageStarted: true }, { scriptSha256: 'bad' }])('rejects false response authority %j', async (change) => {
    expect(await setup({ ...state, ...change }).handler('readScenePlanning', scope, new AbortController().signal)).toMatchObject({ ok: false })
  })
  const automaticStoryboard = { id: 'revision_2', version: 2, sourceHash: 'c'.repeat(64), status: 'Ready' }
  const automaticCanonical = { revision: 2, sourceHash: 'c'.repeat(64), shotCount: 10, origin: 'automatic' }
  const automaticState = { ...state, scriptRevision: 1, scriptSha256: 'a'.repeat(64), storyboard: automaticStoryboard,
    scenes: [{ sceneIndex: 0, title: '自动场景', actionDescription: '角色进入雨夜街道', dialogues: [
      { lineId: 'automatic_line_0', character: '角色', line: '继续前进。' },
    ] }],
    canonicalStoryboard: automaticCanonical }
  it('accepts one bounded automatic canonical storyboard tied to the current Ready revision', async () => {
    expect(await setup(automaticState).handler('readScenePlanning', scope, new AbortController().signal)).toMatchObject({ ok: true })
  })
  it.each([
    { canonicalStoryboard: { ...automaticCanonical, shotCount: 0 } },
    { canonicalStoryboard: { ...automaticCanonical, sourceHash: 'broken' } },
    { canonicalStoryboard: { ...automaticCanonical, origin: 'imported' } },
    { canonicalStoryboard: { ...automaticCanonical, revision: 3 } },
    { storyboard: { ...automaticStoryboard, sourceHash: 'd'.repeat(64) } },
    { storyboard: null },
    { planning: {} },
    { scenes: [] },
  ])('rejects a canonical storyboard that is not the current read-only automatic source: %j', async (change) => {
    expect(await setup({ ...automaticState, ...change }).handler('readScenePlanning', scope, new AbortController().signal)).toMatchObject({ ok: false })
  })
  it('requires shooting requirement identities to match the saved storyboard', async () => {
    const shots = [{ id: 'shot_1', frameNo: 1, title: '相遇', imagePromptCn: '' }]
    const value = { ...automaticState, canonicalStoryboard: { ...automaticCanonical, shotCount: 1, shots }, frameRequirements: shots }
    expect(await setup(value).handler('readScenePlanning', scope, new AbortController().signal)).toMatchObject({ ok: true })
    for (const changed of [[], [{ ...shots[0], id: 'wrong_shot' }], [{ ...shots[0], imagePromptCn: null }]]) {
      expect(await setup({ ...value, frameRequirements: changed }).handler('readScenePlanning', scope, new AbortController().signal))
        .toMatchObject({ ok: false })
    }
  })
  it('keeps the legacy planning read strict about one-based imported scene indexes', async () => {
    const importedZeroBased = { ...state, scriptRevision: 1, scriptSha256: 'a'.repeat(64), scenes: [{
      sceneIndex: 0, title: '旧导入场景', actionDescription: '', importSourceLineIds: [], dialogues: [],
    }] }
    expect(await setup(importedZeroBased).handler('readScenePlanning', scope, new AbortController().signal)).toMatchObject({ ok: false })
  })
  it.each([{}, { blocking:'缓慢抬头',cameraAngle:'驾驶员主观视角' }, { action: 'edit_requirements', cameraMovement: '0-2秒向前缓推', coveragePlan: '2秒切手部特写，5秒切女主近景' }])('sends one automatic frame requirement with optional independent shooting fields %j', async (fields) => {
    const automaticRequest = { ...scope, idempotencyKey: 'automatic-1', request: { action: 'edit_automatic',
      expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 2,
      expectedStoryboardSha256: 'c'.repeat(64), shotId: 'automatic_shot_1', imagePromptCn: '雨夜街道的近景首帧。', ...fields } }
    const encoded = JSON.stringify(automaticRequest.request, Object.keys(automaticRequest.request).sort())
    const requestSha256 = (await import('node:crypto')).createHash('sha256').update(encoded).digest('hex')
    const result = { ...scope, schema: 'jason.qingmu-scene-planning-result.v1', action: automaticRequest.request.action,
      idempotencyKey: 'automatic-1', requestSha256, commandReceiptId: 'receipt_1', eventId: 'event_1',
      shotId: 'automatic_shot_1', storyboard: { ...automaticStoryboard, version: 3, sourceHash: 'd'.repeat(64) }, providerCalls: 0, stageStarted: false, approvalGranted: false }
    const { handler, fetch } = setup(result)
    expect(await handler('saveScenePlanning', automaticRequest, new AbortController().signal)).toMatchObject({ ok: true, value: result })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ idempotencyKey: 'automatic-1', request: automaticRequest.request })
  })
  it('unknown save outcome is not retried; recovery is a source-digested GET', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('lost reply') })
    const handler = createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' })
    expect(await handler('saveScenePlanning', request, new AbortController().signal)).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
    await handler('recoverScenePlanning', request, new AbortController().signal)
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
    expect(fetch.mock.calls[1]?.[0]).toMatch(/receipt\?idempotencyKey=planning-1&requestSha256=[a-f0-9]{64}$/)
  })
})
