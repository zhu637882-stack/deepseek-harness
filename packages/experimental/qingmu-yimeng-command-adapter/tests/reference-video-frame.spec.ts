import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const payload = { projectId: 'p', frameId: 'f', runId: 'refvideo_run', assetId: 'asset_video', expectedAssetSha256: 'a'.repeat(64), timestampMs: 1001 }
const ack = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'e', frameId: 'f', runId: payload.runId,
  assetId: payload.assetId, assetSha256: payload.expectedAssetSha256, requestedTimestampMs: 1001, providerCalls: 0, selectionChanged: false,
  image: { assetId: `asset_vframe_${'b'.repeat(32)}`, assetSha256: 'c'.repeat(64), width: 1920, height: 1080, actualTimestampMs: 1033.333 } }
function setup(receipt: unknown = ack) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(receipt))
  return { fetch, command: createYimengCommandHandler({}, { fetch, readToken: () => 'owner-token' }) }
}
it('preserves exact source and millisecond position across capture and read-only recovery', async () => {
  const { fetch, command } = setup()
  const signal = new AbortController().signal
  expect(await command('captureReferenceVideoFrame', payload, signal)).toEqual({ ok: true, value: ack })
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    expectedAssetSha256: payload.expectedAssetSha256, timestampMs: 1001,
  })
  expect(await command('readReferenceVideoFrame', payload, signal)).toEqual({ ok: true, value: ack })
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
  expect(String(fetch.mock.calls[1]?.[0])).toContain('/candidates/asset_video/reference-frame?expectedAssetSha256=')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it.each([{ timestampMs: -1 }, { timestampMs: 1.5 }, { frameId: '..' }, { projectId: '' }, { expectedAssetSha256: 'bad' }])('rejects invalid source %j before HTTP', async (change) => {
  const { fetch, command } = setup()
  expect((await command('captureReferenceVideoFrame', { ...payload, ...change }, new AbortController().signal)).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it.each([{ frameId: 'other' }, { requestedTimestampMs: 2000 }, { image: null }, { selectionChanged: true }, { image: { ...ack.image, actualTimestampMs: 1000 } }])('rejects mismatched capture response %j', async (change) => {
  const { fetch, command } = setup({ ...ack, ...change })
  expect((await command('captureReferenceVideoFrame', payload, new AbortController().signal)).ok).toBe(false)
  expect(fetch).toHaveBeenCalledOnce()
})
it('allows an absent frame on recovery without making a write', async () => {
  const { fetch, command } = setup({ ...ack, image: null })
  expect((await command('readReferenceVideoFrame', payload, new AbortController().signal)).ok).toBe(true)
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
})
