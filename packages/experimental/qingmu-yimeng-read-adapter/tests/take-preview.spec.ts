import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'

const data = Buffer.from('existing fixture video bytes')
const sha = createHash('sha256').update(data).digest('hex')
const request = { projectId: 'p', episodeId: 'e', frameId: 'f', takeId: 't', expectedOutputSha256: sha }
const response = {
  schema: 'jason.qingmu-take-preview.v1', projectId: 'p', episodeId: 'e', frameId: 'f', takeId: 't',
  outputSha256: sha, mimeType: 'video/mp4', bytes: data.length, base64: data.toString('base64'),
  readOnly: true, providerCalls: 0, databaseWrites: 0,
}
const signal = () => new AbortController().signal

it('forwards only an authenticated GET and validates actual bytes', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture-token' })
  expect(await handler('takePreview', request, signal())).toEqual({ ok: true, value: response })
  expect(String(fetch.mock.calls[0]?.[0])).toContain(`/frames/f/takes/t/preview?expectedOutputSha256=${sha}`)
  expect(fetch.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer fixture-token')
})

it.each([
  { frameId: 'other' }, { outputSha256: 'a'.repeat(64) }, { base64: 'dGFtcGVy' },
  { bytes: data.length + 1 }, { base64: `${response.base64}\n` }, { mimeType: 'text/html' },
  { providerCalls: 1 }, { databaseWrites: 1 }, { readOnly: false }, { localPath: '/private' },
  { bytes: 16 * 1024 * 1024 + 1 },
])('rejects mismatched/unsafe response %j', async (override) => {
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json({ ...response, ...override }), readToken: () => 'fixture' })
  expect((await handler('takePreview', request, signal())).ok).toBe(false)
})

it('rejects missing credentials and malformed browser payload before transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const handler = createYimengReadHandler({}, { fetch, readToken: () => undefined })
  expect((await handler('takePreview', request, signal())).ok).toBe(false)
  const authenticated = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  for (const payload of [{ ...request, expectedOutputSha256: null }, { ...request, url: 'https://remote' }, { ...request, takeId: '' }]) {
    expect((await authenticated('takePreview', payload, signal())).ok).toBe(false)
  }
  expect(fetch).not.toHaveBeenCalled()
})

it('bounds concurrent explicit previews and releases slots after errors', async () => {
  const resolvers: ((value: Response) => void)[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => resolvers.push(resolve)))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const one = handler('takePreview', request, signal())
  const two = handler('takePreview', request, signal())
  expect((await handler('takePreview', request, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(2)
  for (const resolve of resolvers) resolve(Response.json({ detail: 'unavailable' }, { status: 409 }))
  await Promise.all([one, two])
  fetch.mockResolvedValue(Response.json(response))
  expect((await handler('takePreview', request, signal())).ok).toBe(true)
})
