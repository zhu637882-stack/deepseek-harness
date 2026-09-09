import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { quoteRequest, quoteResponse } from './reference-video-fixture.ts'

const signal = () => new AbortController().signal

it('sends only saved revision and hash to the owner-scoped quote endpoint', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(quoteResponse))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  expect(await handler('referenceVideoQuote', quoteRequest, signal())).toEqual({ ok: true, value: quoteResponse })
  expect(fetch.mock.calls[0]?.[0]).toContain('/reference-video/drafts/f/quote')
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    expectedRevision: 1, expectedRequestSha256: quoteRequest.draftRequestSha256,
  })
})

it.each([
  { draftRevision: 2 }, { sourceSha256: 'b'.repeat(64) }, { quoteSha256: 'b'.repeat(64) },
  { budgetReservedCny: 4.8 }, { generationQueued: true }, { providerCalls: 1 },
  { cost: { ...quoteResponse.cost, estimatedCny: 0 } },
  { cost: { ...quoteResponse.cost, billableSeconds: 12 } },
  { cost: { ...quoteResponse.cost, unitPriceCny: -1 } },
  { cost: { ...quoteResponse.cost, accountDiscountApplied: true } },
])('rejects quote identity, price or side-effect drift %j', async (change) => {
  const handler = createYimengReadHandler({}, {
    fetch: async () => Response.json({ ...quoteResponse, ...change }), readToken: () => 'fixture',
  })
  expect((await handler('referenceVideoQuote', quoteRequest, signal())).ok).toBe(false)
})

it('rejects edited unsaved input or missing credentials before HTTP', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  expect((await handler('referenceVideoQuote', {
    ...quoteRequest, parameters: { ...quoteRequest.parameters, duration: 12 },
  }, signal())).ok).toBe(false)
  const anonymous = createYimengReadHandler({}, { fetch, readToken: () => undefined })
  expect((await anonymous('referenceVideoQuote', quoteRequest, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
