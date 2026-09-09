import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const payload = { projectId: 'p', frameId: 'f', runId: 'refvideo_run', assetId: 'asset_original', expectedAssetSha256: 'a'.repeat(64) }
const ack = {
  schema: 'jason.reference-video-review-registration.v1', projectId: 'p', episodeId: 'e', frameId: 'f',
  runId: payload.runId, assetId: payload.assetId, assetSha256: payload.expectedAssetSha256,
  takeId: `asset_reftake_${'b'.repeat(32)}`, providerCalls: 0, selectionChanged: false, formalApprovalChanged: false,
}
const signal = () => new AbortController().signal
function setup(result: unknown = ack, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result, { status }))
  return { fetch, command: createYimengCommandHandler({}, { fetch, readToken: () => 'owner-token' }) }
}
it('registers only the exact source and reads registration without resending', async () => {
  const { fetch, command } = setup()
  expect(await command('registerReferenceVideoCandidateForReview', payload, signal())).toEqual({ ok: true, value: ack })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[0]).toContain('/p/reference-video/drafts/f/runs/refvideo_run/candidates/asset_original/review-registration')
  expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ expectedAssetSha256: payload.expectedAssetSha256 }))
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
  expect(await command('readReferenceVideoCandidateRegistration', payload, signal())).toEqual({ ok: true, value: ack })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
  expect(fetch.mock.calls[1]?.[0]).toContain(`?expectedAssetSha256=${payload.expectedAssetSha256}`)
})
it('accepts missing registration only for reads', async () => {
  const { command } = setup({ ...ack, takeId: null })
  expect((await command('readReferenceVideoCandidateRegistration', payload, signal())).ok).toBe(true)
  expect((await command('registerReferenceVideoCandidateForReview', payload, signal())).ok).toBe(false)
})
it.each([{ frameId: '../f' }, { frameId: '..' }, { runId: 'other' }, { expectedAssetSha256: 'bad' }, { isSelected: true }])('rejects malformed intent %j', async (change) => {
  const { fetch, command } = setup()
  expect((await command('registerReferenceVideoCandidateForReview', { ...payload, ...change }, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it.each([{ frameId: 'other' }, { assetSha256: 'b'.repeat(64) }, { takeId: 'asset_other' }, { providerCalls: 1 }, { selectionChanged: true }, { formalApprovalChanged: true }, { approved: true }])('rejects altered receipt %j', async (change) => {
  const { fetch, command } = setup({ ...ack, ...change })
  expect((await command('registerReferenceVideoCandidateForReview', payload, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not retry an unknown server outcome', async () => {
  const { fetch, command } = setup({}, 500)
  expect((await command('registerReferenceVideoCandidateForReview', payload, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
