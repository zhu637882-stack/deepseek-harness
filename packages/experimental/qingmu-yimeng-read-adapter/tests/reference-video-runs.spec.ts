import { expect, it } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { runResponse } from './reference-video-fixture.ts'
const candidate = { assetId: 'asset_ingest_123', assetSha256: 'c'.repeat(64), mediaId: 'media_ingest_123',
  browserUrl: `https://qingmu.test/api/media/media_ingest_123?expires=9999999999&signature=${'a'.repeat(64)}`, reviewStatus: 'pending' }
async function read(run: unknown, endpoint = 'referenceVideoRuns') {
  return createYimengReadHandler({}, { readToken: () => 'owner', fetch: async () => Response.json({
    schema: 'jason.reference-video-runs.v1', projectId: 'p', frameId: 'f', items: [run], providerCalls: 0,
  }) })(endpoint, { projectId: 'p', frameId: 'f' }, new AbortController().signal)
}
it('restores a queued run and exposes only local signed playback for completed candidates', async () => {
  expect((await read(runResponse)).ok).toBe(true)
  const result = await read({ ...runResponse, kernelStatus: 'Succeeded', publicStatus: 'succeeded', candidates: [candidate] })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('failed read')
  const value = result.value as { items: { candidates: typeof candidate[] }[] }
  expect(value.items[0]?.candidates[0]?.browserUrl).toMatch(/^http:\/\/127\.0\.0\.1:8115\/api\/media\/media_ingest_123\?/u)
})
it.each([
  { projectId: 'other' }, { kernelStatus: 'invented' }, { candidates: [candidate] },
  { kernelStatus: 'Succeeded', candidates: [{ ...candidate, reviewStatus: 'approved' }] },
  { kernelStatus: 'Succeeded', candidates: [{ ...candidate, browserUrl: 'https://evil.test/video.mp4' }] },
  { kernelStatus: 'Succeeded', candidates: [{ ...candidate, mediaId: 'media_other' }] },
])('rejects cross-scope, unverified or unsafe candidates %j', async (override) => {
  expect((await read({ ...runResponse, ...override })).ok).toBe(false)
})
