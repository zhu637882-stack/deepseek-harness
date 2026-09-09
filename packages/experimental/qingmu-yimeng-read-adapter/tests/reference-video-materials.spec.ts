import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'

export const request = { projectId: 'p', frameId: 'f', expectedRevision: 1, expectedRequestSha256: 'a'.repeat(64) }
export const state = {
  schema: 'jason.reference-video-materials.v1', projectId: 'p', frameId: 'f', draftRevision: 1,
  draftRequestSha256: request.expectedRequestSha256, model: 'wan3.0-video',
  materials: [{ bindingToken: 'lin', assetId: 'a', assetSha256: 'b'.repeat(64), mediaType: 'reference_image', status: 'not_prepared', expiresAt: null, failureCode: null }],
  configured: true, configurationError: null, allReady: false, providerCalls: 0, databaseWrites: 0, generationQueued: false,
}
function setup(value: unknown = state) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return { fetch, read: createYimengReadHandler({}, { fetch, readToken: () => 'owner-token' }) }
}
const signal = () => new AbortController().signal
it('reads exact saved scope with one authenticated GET and no writes', async () => {
  const { fetch, read } = setup()
  expect(await read('referenceVideoMaterials', request, signal())).toEqual({ ok: true, value: state })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[0]).toContain(`/reference-video/drafts/f/materials?expectedRevision=1&expectedRequestSha256=${request.expectedRequestSha256}`)
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer owner-token')
})
it.each([{ projectId: '../escape' }, { approved: true }, { expectedRevision: 0 }, { expectedRequestSha256: 'wrong' }])('rejects invalid request %j without fetching', async (change) => {
  const { fetch, read } = setup()
  expect((await read('referenceVideoMaterials', { ...request, ...change }, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it.each([
  { projectId: 'other' }, { draftRevision: 2 }, { allReady: true }, { databaseWrites: 1 }, { providerCalls: 1 },
  { url: 'https://secret' }, { materials: [] }, { configurationError: 'secret-key' },
  { materials: [{ ...state.materials[0], status: 'ready' }] },
  { materials: [state.materials[0], state.materials[0]] },
  { materials: [{ ...state.materials[0], expiresAt: 123 }] },
])('rejects altered or secret-bearing readiness %j', async (change) => {
  const { read } = setup({ ...state, ...change })
  expect((await read('referenceVideoMaterials', request, signal())).ok).toBe(false)
})
