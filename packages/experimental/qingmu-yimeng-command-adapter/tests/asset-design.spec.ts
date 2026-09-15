import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
const scope = { projectId: 'project_1', episodeId: 'episode_1' }
const state = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), script: {}, design: null }
const setup = (result: unknown) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' }) }
}
it('reads uploaded products before the first confirmed screenplay', async () => {
  const draft = { ...state, script: null, scriptSha256: null, scriptRevision: 0,
    productAssets: [{ id: 'product_1', kind: 'prop', references: [{ assetId: 'image_1' }] }] }
  const { fetch, handler } = setup(draft)
  expect(await handler('readAssetDesign', scope, new AbortController().signal))
    .toMatchObject({ ok: true, value: draft })
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([409, 422])('shows the bounded asset validation reason on HTTP %s without retrying', async (status) => {
  const detail = '当前模型不支持框选参数，请移除框选或改选支持框选的模型；原图和指令仍保留。'
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ detail }, { status }))
  const handler = createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' })
  expect(await handler('quoteAssetImage', { ...scope, entityId: 'scene_1' }, new AbortController().signal))
    .toMatchObject({ ok: false, error: { message: `Yimeng rejected command (HTTP ${status}: ${detail})` } })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
})
it.each([
  { status: 422, detail: '检查 private-token', expected: '检查 [REDACTED]' },
  { status: 422, detail: '长'.repeat(2049), expected: undefined },
  { status: 422, detail: [{ msg: 'private diagnostic' }], expected: undefined },
  { status: 500, detail: 'private diagnostic', expected: undefined },
])('limits asset error details: $status / $expected', async ({ status, detail, expected }) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ detail }, { status }))
  const handler = createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token' })
  const result = await handler('quoteAssetImage', { ...scope, entityId: 'scene_1' }, new AbortController().signal)
  expect(result).toMatchObject({ ok: false, error: { message: `Yimeng rejected command (HTTP ${status}${expected ? `: ${expected}` : ''})` } })
  expect(JSON.stringify(result)).not.toContain('private-token')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('previews only the scoped layout and rejects an external replacement image', async () => {
  const request = { ...scope, layout: { basis: '导演布置', coordinateFrame: '米制', objects: [] },
    camera: { position: [0, -3, 1.6], target: [0, 0, 1], verticalFov: 50 }, ratio: '16:9' }
  const result = { ...scope, recipe: 'qingmu-blockout-v1', sha256: 'c'.repeat(64), imageUrl: 'data:image/png;base64,aGVsbG8=', objects: [] }
  const preview = setup(result)
  expect(await preview.handler('previewSceneLayout', request, new AbortController().signal)).toMatchObject({ ok: true, value: result })
  expect(preview.fetch.mock.calls[0]?.[0]).toContain('/asset-design/layout-preview')
  expect(await setup({ ...result, imageUrl: 'https://elsewhere.example/image.png' }).handler('previewSceneLayout', request, new AbortController().signal)).toMatchObject({ ok: false })
  expect(await setup({ ...result, episodeId: 'another' }).handler('previewSceneLayout', request, new AbortController().signal)).toMatchObject({ ok: false })
})
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
it('uses scoped voice quotation and original voice-task recovery routes', async () => {
  const quote = { ...scope, entity: { id: 'actor_1' }, mediaType: 'audio', generationAvailable: true,
    estimatedCny: '0.000000', quoteSha256: 'b'.repeat(64) }
  const quoted = setup(quote)
  expect(await quoted.handler('quoteAssetVoice', { ...scope, entityId: 'actor_1' }, new AbortController().signal)).toMatchObject({ ok: true, value: quote })
  expect(quoted.fetch.mock.calls[0]?.[0]).toContain('/asset-design/actor_1/voice/quote')
  const result = { ...scope, items: [] }
  const recovered = setup(result)
  expect(await recovered.handler('readAssetVoiceRuns', scope, new AbortController().signal)).toMatchObject({ ok: true, value: result })
  expect(recovered.fetch.mock.calls[0]?.[0]).toContain('/asset-design/voice/runs')
})
