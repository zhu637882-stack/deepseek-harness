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
