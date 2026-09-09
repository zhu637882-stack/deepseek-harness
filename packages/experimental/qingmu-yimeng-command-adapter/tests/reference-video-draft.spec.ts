import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { savedDraft } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'

const payload = { projectId: 'p', frameId: 'f', expectedRevision: 0, expectedFrameSha256: savedDraft.frameSha256, request: savedDraft.draft.request }
const signal = () => new AbortController().signal
function setup(response: unknown = savedDraft, status = 200, token: string | undefined = 'owner-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response, { status }))
  const read = createYimengReadHandler({}, { fetch, readToken: () => token })
  return { fetch, handler: createYimengCommandHandler({}, { fetch, readToken: () => token, readYimeng: read }) }
}

it('saves once and verifies exact scope and authored request through the real read handler', async () => {
  const { fetch, handler } = setup()
  expect(await handler('saveReferenceVideoDraft', payload, signal())).toEqual({ ok: true, value: savedDraft })
  expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET'])
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8115/api/qingmu/projects/p/reference-video/drafts/f')
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer owner-token')
  const { projectId: _p, frameId: _f, ...body } = payload
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(body)
})

it.each([{ projectId: '../other' }, { approved: true }, { expectedRevision: -1 }, { request: { ...payload.request, frameId: 'other' } }])('blocks ambiguous or cross-shot save inputs %j', async (override) => {
  const { fetch, handler } = setup()
  expect((await handler('saveReferenceVideoDraft', { ...payload, ...override }, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  { projectId: 'other' }, { generationQueued: true }, { providerCalls: 1 }, { mediaTypes: {} },
  { draft: { ...savedDraft.draft, requestSha256: '0'.repeat(64) } },
  { draft: { ...savedDraft.draft, revision: 3 } }, { frameSha256: 'a'.repeat(64) },
])('does not acknowledge an altered readback %j', async (override) => {
  const { fetch, handler } = setup({ ...savedDraft, ...override })
  expect((await handler('saveReferenceVideoDraft', payload, signal())).ok).toBe(false)
  expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})

it('does not retry a version conflict or issue a save without credentials', async () => {
  const conflict = setup({ detail: { code: 'reference_video_draft_revision_conflict' } }, 409)
  expect((await conflict.handler('saveReferenceVideoDraft', payload, signal())).ok).toBe(false)
  expect(conflict.fetch).toHaveBeenCalledTimes(1)
  const anonymous = setup(savedDraft, 200, undefined)
  // An omitted optional argument uses the JS default; force the dependency empty explicitly.
  const handler = createYimengCommandHandler({}, {
    fetch: anonymous.fetch, readToken: () => undefined, readYimeng: async () => ({ ok: true, value: savedDraft }),
  })
  expect((await handler('saveReferenceVideoDraft', payload, signal())).ok).toBe(false)
  expect(anonymous.fetch).not.toHaveBeenCalled()
})
