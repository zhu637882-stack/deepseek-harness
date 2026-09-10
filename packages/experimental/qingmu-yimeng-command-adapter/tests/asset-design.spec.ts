import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
const scope = { projectId: 'project_1', episodeId: 'episode_1' }
const state = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), script: {}, design: null }
const setup = (result: unknown) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}
it('routes native asset saves to the current episode and rejects route injection', async () => {
  const { fetch, handler } = setup(state)
  const request = { ...scope, expectedStateSha256: state.stateSha256, design: { assets: [], director: {} } }
  expect(await handler('saveAssetDesign', request, new AbortController().signal)).toMatchObject({ ok: true, value: state })
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/qingmu/projects/project_1/episodes/episode_1/asset-design')
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
  fetch.mockClear()
  expect(await handler('readAssetDesign', { ...scope, episodeId: '../escape' }, new AbortController().signal)).toMatchObject({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects a different project response and never grants unconfirmed image generation', async () => {
  expect(await setup({ ...state, projectId: 'other' }).handler('readAssetDesign', scope, new AbortController().signal)).toMatchObject({ ok: false })
  const { fetch, handler } = setup({})
  expect(await handler('generateAssetImage', { ...scope, entityId: 'actor_1', command: { paidConfirmed: false } }, new AbortController().signal)).toMatchObject({ ok: false })
  expect(fetch).not.toHaveBeenCalled()
})
it('recovers original image task without a new submission', async () => {
  const result = { ...scope, items: [{ taskId: 'task_original', status: 'Processing', requestId: 'image-request-001' }] }
  const { fetch, handler } = setup(result)
  expect(await handler('readAssetImageRuns', scope, new AbortController().signal)).toMatchObject({ ok: true, value: result })
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
})
