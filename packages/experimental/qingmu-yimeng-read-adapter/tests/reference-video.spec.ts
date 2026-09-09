import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { request, response } from './reference-video-fixture.ts'
const body = response.body

const signal = () => new AbortController().signal

it('posts the explicit draft through the authenticated read handler without provider calls', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture-token' })
  expect(await handler('referenceVideoPreview', request, signal())).toEqual({ ok: true, value: response })
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8115/api/qingmu/projects/p/reference-video/preview')
  const init = fetch.mock.calls[0]?.[1]
  expect(init?.method).toBe('POST')
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token')
  const { projectId: _projectId, ...expectedBody } = request
  expect(JSON.parse(String(init?.body))).toEqual(expectedBody)
})

it.each([
  { projectId: 'other' }, { frameId: 'other' }, { providerCalls: 1 }, { databaseWrites: 1 },
  { submissionReady: true }, { requestBodySha256: '0'.repeat(64) }, { referenceAudioDurationSec: 16 },
  { referenceMapping: response.referenceMapping.toReversed() },
  { body: { ...body, input: { ...body.input, prompt: 'silently changed' } } },
])('rejects stale, reordered or mutated upstream preview %j', async (override) => {
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json({ ...response, ...override }), readToken: () => 'fixture' })
  expect((await handler('referenceVideoPreview', request, signal())).ok).toBe(false)
})

it('rejects missing credentials, URLs, duplicate tokens and dangling references before transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const anonymous = createYimengReadHandler({}, { fetch, readToken: () => undefined })
  expect((await anonymous('referenceVideoPreview', request, signal())).ok).toBe(false)
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  for (const draft of [
    { ...request, url: 'https://external' },
    { ...request, bindings: [request.bindings[0], request.bindings[0]] },
    { ...request, promptParts: [{ bindingToken: 'missing' }] },
    { ...request, parameters: { ...request.parameters, duration: 31 } },
  ]) expect((await handler('referenceVideoPreview', draft, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('projects only versioned image/audio metadata from the current project asset page', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ page: 2, page_size: 200, pages: 3, items: [
    { id: 'asset_lin', project_id: 'p', asset_type: 'image', role: 'identity', sha256: 'a'.repeat(64), local_path: '/private/secret' },
    { id: 'asset_unhashed', project_id: 'p', asset_type: 'audio', sha256: '' },
    { id: 'asset_video', project_id: 'p', asset_type: 'video', sha256: 'b'.repeat(64) },
  ] }))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 2 }, signal())
  expect(result).toEqual({ ok: true, value: { projectId: 'p', page: 2, pages: 3, items: [
    { assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '参考图片 201', mediaType: 'reference_image', browserUrl: '' },
  ] } })
  expect(JSON.stringify(result)).not.toContain('/private')
})

it('uses the returned media identity for signed thumbnails without guessing it from the asset', async () => {
  const signature = 'a'.repeat(64)
  const items = [{ id: 'asset_face', project_id: 'p', asset_type: 'image', sha256: 'b'.repeat(64),
    display_name: '林予', preview_media_id: 'media_independent', public_url: `https://public.example/api/media/media_independent?expires=2000000000&signature=${signature}` }]
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({ page:1,page_size:200,pages:1,items }) })
  const result = await handler('referenceVideoAssets', { projectId:'p',page:1 }, signal())
  expect(result).toMatchObject({ ok:true,value:{ items:[{ assetId:'asset_face',label:'林予',browserUrl:`http://127.0.0.1:8115/api/media/media_independent?expires=2000000000&signature=${signature}` }] } })
  items[0]!.public_url = items[0]!.public_url.replace('https://public.example','http://127.0.0.1:8115')
  items[0]!.preview_media_id = 'media_wrong'
  expect(await handler('referenceVideoAssets', { projectId:'p',page:1 }, signal())).toMatchObject({ ok:true,value:{ items:[{ browserUrl:'' }] } })
})
