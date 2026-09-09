import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { request, quoteRequest } from './reference-video-fixture.ts'

it.each([
  ['referenceVideoPreview', request], ['referenceVideoQuote', quoteRequest],
] as const)('explains missing model-readable references for %s without a retry or mutation', async (endpoint, payload) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
    detail: { code: 'reference_video_provider_media_missing', secret: 'must-not-leak' },
  }, { status: 422 }))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const result = await handler(endpoint, payload, new AbortController().signal)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('readiness failure must remain an error')
  expect(result.error.message).toContain('参考素材尚未准备为模型可读取的文件')
  expect(JSON.stringify(result)).not.toContain('must-not-leak')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([
  [401, { detail: { code: 'reference_video_provider_media_missing' } }, 'Yimeng authentication failed'],
  [403, { detail: { code: 'reference_video_provider_media_missing' } }, 'Yimeng authentication failed'],
  [422, { detail: { code: 'unknown_secret_detail' } }, 'Yimeng service returned HTTP 422'],
  [422, { detail: 'private server text' }, 'Yimeng service returned HTTP 422'],
  [500, { detail: { code: 'reference_video_provider_media_missing' } }, 'Yimeng service returned HTTP 500'],
] as const)('retains generic/auth boundaries for HTTP %s and unrecognized details', async (status, body, message) => {
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json(body, { status }), readToken: () => 'fixture' })
  expect(await handler('referenceVideoPreview', request, new AbortController().signal))
    .toMatchObject({ ok: false, error: { message } })
})

it('bounds upstream error bodies and does not map unrelated asset reads', async () => {
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({
    detail: { code: 'reference_video_provider_media_missing', excess: 'x'.repeat(70 * 1024) },
  }, { status: 422 }) })
  expect(await handler('referenceVideoPreview', request, new AbortController().signal))
    .toMatchObject({ ok: false, error: { message: 'Yimeng service returned HTTP 422' } })
  expect(await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, new AbortController().signal))
    .toMatchObject({ ok: false, error: { message: 'Yimeng service returned HTTP 422' } })
})
