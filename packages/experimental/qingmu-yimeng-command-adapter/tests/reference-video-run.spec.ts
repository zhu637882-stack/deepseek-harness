import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { runRequest, runResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
const signal = () => new AbortController().signal
function setup(response: unknown = runResponse) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
  const read = createYimengReadHandler({}, { fetch, readToken: () => 'owner-token' })
  return { fetch, handler: createYimengCommandHandler({}, { fetch, readToken: () => 'owner-token', readYimeng: read }) }
}
it('queues exactly one confirmed request then reads the same run without credentials in its body', async () => {
  const { handler, fetch } = setup()
  expect(await handler('queueReferenceVideo', runRequest, signal())).toEqual({ ok: true, value: runResponse })
  expect(fetch.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET'])
  const { projectId: _p, frameId: _f, ...body } = runRequest
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(body)
  expect(fetch.mock.calls[1]?.[0]).toContain(`/runs/${runResponse.runId}`)
})
it.each([{ paidConfirmed: false }, { authorizationCapCny: '0.000000' }, { requestId: 'short' }, { snapshot: {} }])('rejects incomplete or expanded authorization %j', async (override) => {
  const { handler, fetch } = setup()
  expect((await handler('queueReferenceVideo', { ...runRequest, ...override }, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it.each([{ draftRevision: 2 }, { quoteSha256: 'a'.repeat(64) }, { authorizationCapCny: '9.000000' }, { projectId: 'other' }, { selectionChanged: true }])('does not acknowledge changed run identity %j', async (override) => {
  const { handler, fetch } = setup({ ...runResponse, ...override })
  expect((await handler('queueReferenceVideo', runRequest, signal())).ok).toBe(false)
  expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})
it('never retries an uncertain command', async () => {
  const { handler, fetch } = setup()
  fetch.mockRejectedValue(new Error('network disconnected'))
  expect((await handler('queueReferenceVideo', runRequest, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
