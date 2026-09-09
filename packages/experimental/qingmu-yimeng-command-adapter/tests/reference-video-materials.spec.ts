import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'

const scope = { projectId: 'p', frameId: 'f', expectedRevision: 1, expectedRequestSha256: 'a'.repeat(64) }
const payload = { ...scope, assetId: 'a', requestId: 'prepare-request-0001' }
const state = {
  schema: 'jason.reference-video-materials.v1', projectId: 'p', frameId: 'f', draftRevision: 1,
  draftRequestSha256: scope.expectedRequestSha256, model: 'wan3.0-video',
  materials: [{ bindingToken: 'lin', assetId: 'a', assetSha256: 'b'.repeat(64), mediaType: 'reference_image', status: 'unknown', expiresAt: null, failureCode: 'reference_video_upload_result_unknown' }],
  configured: true, configurationError: null, allReady: false, providerCalls: 0, databaseWrites: 0, generationQueued: false,
}
const { providerCalls: _calls, databaseWrites: _writes, ...withoutCounters } = state
const ack = { ...withoutCounters, assetId: 'a', requestId: payload.requestId, uploadAttempts: 1, modelCalls: 0, localStateChanged: true }
const signal = () => new AbortController().signal
function setup(result: unknown = ack, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => Response.json(options?.method === 'POST' ? result : state, { status }))
  const readYimeng = createYimengReadHandler({}, { fetch, readToken: () => 'owner-token' })
  return { fetch, command: createYimengCommandHandler({}, { fetch, readYimeng, readToken: () => 'owner-token' }) }
}
it('posts one exact file intent and returns readback even when the upstream upload outcome is unknown', async () => {
  const { fetch, command } = setup()
  expect(await command('prepareReferenceVideoMaterial', payload, signal())).toEqual({ ok: true, value: ack })
  expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET'])
  const sent = fetch.mock.calls[0]?.[1]?.body
  expect(typeof sent).toBe('string')
  expect(JSON.parse(sent as string)).toEqual({ requestId: payload.requestId, expectedRevision: 1,
    expectedRequestSha256: scope.expectedRequestSha256 })
})
it.each([{ assetId: '../escape' }, { requestId: 'short' }, { approved: true }, { expectedRevision: -1 }])('rejects ambiguous preparation %j', async (change) => {
  const { fetch, command } = setup()
  expect((await command('prepareReferenceVideoMaterial', { ...payload, ...change }, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it.each([{ assetId: 'other' }, { requestId: 'other-request-0001' }, { modelCalls: 1 }, { generationQueued: true }, { uploadAttempts: '1' }])('never acknowledges a changed upload receipt %j', async (change) => {
  const { fetch, command } = setup({ ...ack, ...change })
  expect((await command('prepareReferenceVideoMaterial', payload, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not resend a failed HTTP response', async () => {
  const { fetch, command } = setup({}, 500)
  expect((await command('prepareReferenceVideoMaterial', payload, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
