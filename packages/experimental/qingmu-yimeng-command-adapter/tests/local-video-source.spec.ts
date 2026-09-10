import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import { sourceFixture } from './local-video-source.fixture.ts'
const signal = () => new AbortController().signal
function setup(value: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(value, { status })))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'token' }) }
}
it('reads status, registers once, and recovers without sending saved bytes again', async () => {
  const f = sourceFixture(); const s = setup(f.state)
  expect(await s.handler('readLocalVideoSource', f.scope, signal())).toEqual({ ok: true, value: f.state })
  expect(s.fetch.mock.calls[0]?.[1]?.method).toBe('GET')
  s.fetch.mockImplementation(async () => Response.json(f.result))
  expect(await s.handler('registerLocalVideoSource', f.request, signal())).toEqual({ ok: true, value: f.result })
  expect(s.fetch.mock.calls[1]?.[1]?.method).toBe('POST')
  const body = s.fetch.mock.calls[1]?.[1]?.body
  if (typeof body !== 'string') throw new Error('expected serialized body')
  expect(JSON.parse(body)).toEqual({ idempotencyKey: f.request.idempotencyKey, binding: f.binding, packet: f.packet })
  expect(await s.handler('recoverLocalVideoSource', f.recovery, signal())).toEqual({ ok: true, value: f.result })
  expect(s.fetch.mock.calls[2]?.[1]?.method).toBe('GET'); expect(s.fetch.mock.calls[2]?.[1]?.body).toBeUndefined()
})
it('reads historical source bindings and recovers stale success without rewriting history', async () => {
  const f = sourceFixture(); const state = { ...f.state, bindingStatus: 'stale', binding: { ...f.binding, storyboardRevision: 3 } }
  expect(await setup(state).handler('readLocalVideoSource', f.scope, signal())).toEqual({ ok: true, value: state })
  const result = { ...f.result, bindingStatus: 'stale' }
  expect(await setup(result).handler('recoverLocalVideoSource', f.recovery, signal())).toEqual({ ok: true, value: result })
})
it.each([{ providerExecutionVerified: true }, { recordConsistencyVerified: true }, { selectionChanged: true }, { providerCalls: 1 }, { privatePath: '/secret' }])('rejects an escalated or leaking result %j', async (change) => {
  const f = sourceFixture()
  expect((await setup({ ...f.result, ...change }).handler('registerLocalVideoSource', f.request, signal())).ok).toBe(false)
})
it.each(['assetId','takeId','assetSha256','uploadReceiptSha256','frameContentSha256'])('rejects a changed receipt binding %s', async (field) => {
  const f = sourceFixture(); const receipt = { ...f.receipt, binding: { ...f.binding, [field]: 'a'.repeat(64) } }
  expect((await setup({ ...f.result, receipt }).handler('registerLocalVideoSource', f.request, signal())).ok).toBe(false)
})
it('rejects stale data falsely marked current and impossible empty states', async () => {
  const f = sourceFixture()
  for (const state of [{ ...f.state, binding: { ...f.binding, storyboardRevision: 3 } },
    { ...f.state, latestRegistration: null }, { ...f.state, registrationCount: 0 }]) {
    expect((await setup(state).handler('readLocalVideoSource', f.scope, signal())).ok).toBe(false)
  }
})
it('rejects packet tampering and unexpected uploads on a read before contacting Writer', async () => {
  const f = sourceFixture(); const s = setup(f.result)
  const bad = { ...f.request, packet: { ...f.packet, inputRecord: { ...f.packet.inputRecord, sha256: 'a'.repeat(64) } } }
  expect((await s.handler('registerLocalVideoSource', bad, signal())).ok).toBe(false)
  expect((await s.handler('readLocalVideoSource', { ...f.scope, packet: f.packet }, signal())).ok).toBe(false)
  expect((await s.handler('recoverLocalVideoSource', { ...f.recovery, packet: f.packet }, signal())).ok).toBe(false)
  expect(s.fetch).not.toHaveBeenCalled()
})
