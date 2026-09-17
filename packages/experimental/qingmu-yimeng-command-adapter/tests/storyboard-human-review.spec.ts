import { createServer, request as httpRequest, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerStoryboardHumanReviewCommands } from '../src/storyboard-human-review.ts'

let server: Server | undefined
let dispose: (() => void) | undefined

async function teardown(): Promise<void> {
  dispose?.(); dispose = undefined
  if (server !== undefined) {
    const closing = server
    server = undefined
    closing.close(); await once(closing, 'close')
  }
}

afterEach(async () => { await teardown() })

async function host(fetchUpstream: typeof globalThis.fetch): Promise<string> {
  await teardown()
  const routes = new Map<string, WebRoute>()
  const registrar = { register(route: WebRoute) {
    routes.set(route.path, route); return () => { routes.delete(route.path) }
  } } as unknown as WebServer
  dispose = registerStoryboardHumanReviewCommands(registrar, {
    baseUrl: 'http://127.0.0.1:8115', fetch: fetchUpstream,
  })
  server = createServer((req, res) => {
    const route = routes.get(new URL(req.url ?? '/', 'http://host.invalid').pathname)
    if (route === undefined) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('host did not bind')
  return `http://127.0.0.1:${String(address.port)}`
}

const ACCEPT_PATH = '/api/qingmu/storyboard-human-review/accept'
const EPISODE = 'episode-review'
const SET_DIGEST = 'c'.repeat(64)
const FRAME_DIGEST = 'a'.repeat(64)
const KEY = 'storyboard-review-key-1'

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectedFrameSetDigest: SET_DIGEST,
    items: [{ frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST }],
    note: '确认整集当前分镜与提示词', idempotencyKey: KEY, confirmed: true, ...overrides,
  }
}

function receipt(
  items: Record<string, unknown>[] = [{ frameId: 'frame-1', checkId: 'check-1' }],
): Record<string, unknown> {
  return {
    acceptedCount: items.length, totalCount: items.length, frameSetDigest: SET_DIGEST,
    items, providerCalls: 0, budgetMutation: false,
  }
}

async function post(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${ACCEPT_PATH}?episodeId=${EPISODE}`, {
    method: 'POST',
    headers: {
      origin: base, cookie: 'jason_token=human-cookie; unrelated=value',
      'content-type': 'application/json', ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/**
 * Raw POST whose body is longer than the `content-length` it declares.
 *
 * Undici refuses to send a request whose length does not match its header, so a
 * lying client can only be driven over a plain socket. The surplus bytes may make
 * the server drop the connection after answering, so a late reset is ignored.
 */
async function mismatchedLength(base: string, body: string): Promise<number> {
  const url = new URL(`${base}${ACCEPT_PATH}?episodeId=${EPISODE}`)
  return new Promise((resolve, reject) => {
    let settled = false
    const request = httpRequest({
      host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: 'POST',
      headers: {
        origin: base, cookie: 'jason_token=human-cookie',
        'content-type': 'application/json', 'content-length': '8',
      },
    }, (response) => {
      const status = response.statusCode ?? 0
      response.resume()
      response.on('end', () => { settled = true; resolve(status) })
      response.on('error', () => { settled = true; resolve(status) })
    })
    request.on('error', (cause: unknown) => {
      if (!settled) reject(cause instanceof Error ? cause : new Error(String(cause)))
    })
    request.write(body)
    request.end()
  })
}

/** The upstream URL as the bridge actually requested it. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** The upstream body, which the bridge always sends as a JSON string. */
function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/** One host whose Writer reply the test rewrites between requests. */
async function scriptedHost(): Promise<{
  base: string
  reply: (body: unknown, status?: number) => void
  sent: { url: string; headers: Headers; body: string }[]
}> {
  let payload: unknown = receipt()
  let status = 200
  const sent: { url: string; headers: Headers; body: string }[] = []
  const base = await host(async (input, init) => {
    sent.push({
      url: requestUrl(input),
      headers: new Headers(init?.headers), body: requestBody(init),
    })
    return new Response(JSON.stringify(payload), {
      status, headers: { 'content-type': 'application/json' },
    })
  })
  return { base, reply: (next: unknown, nextStatus = 200) => { payload = next; status = nextStatus }, sent }
}

describe('storyboard pre-production human review command bridge', () => {
  it('translates one confirmed decision into the Writer frame set and relays the receipt', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(requestUrl(input))
      expect(url.href).toBe(`http://127.0.0.1:8115/api/episodes/${EPISODE}/storyboard-human-review`)
      const headers = new Headers(init?.headers)
      expect(headers.get('cookie')).toBe('jason_token=human-cookie')
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('origin')).toBe('http://127.0.0.1:8115')
      expect(headers.get('host')).toBe('127.0.0.1:8115')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      return Response.json(receipt([
        { frameId: 'frame-1', checkId: 'check-1' }, { frameId: 'frame-2', checkId: 'check-2' },
      ]))
    })
    const base = await host(upstream)
    const response = await post(base, decision({
      items: [
        { frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST },
        { frameId: 'frame-2', expectedFrameDigest: 'b'.repeat(64) },
      ],
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      acceptedCount: 2, totalCount: 2, frameSetDigest: SET_DIGEST, providerCalls: 0, budgetMutation: false,
    })
    expect(JSON.parse(requestBody(upstream.mock.calls[0]?.[1]))).toEqual({
      expected_frame_set_digest: SET_DIGEST,
      items: [
        { frame_id: 'frame-1', expected_frame_digest: FRAME_DIGEST },
        { frame_id: 'frame-2', expected_frame_digest: 'b'.repeat(64) },
      ],
      note: '确认整集当前分镜与提示词', idempotency_key: KEY,
    })
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('refuses a write that is not a same-origin cookie-only browser request', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json(receipt()))
    const base = await host(upstream)
    const forbidden: [string, Record<string, string>][] = [
      ['bearer token', { authorization: 'Bearer launcher' }],
      ['no origin', { origin: '' }],
      ['foreign origin', { origin: 'http://evil.example' }],
      ['upgraded origin', { origin: `https://${new URL(base).host}` }],
      ['no cookie', { cookie: '' }],
      ['unrelated cookie', { cookie: 'other=value' }],
      ['cookie over the bound', { cookie: `jason_token=${'x'.repeat(9000)}` }],
    ]
    for (const [label, headers] of forbidden) {
      const response = await post(base, decision(), headers)
      expect(response.status, label).toBe(403)
      expect(await response.json(), label).toEqual({ code: 'storyboard_human_review_command_forbidden' })
    }
    expect(upstream).not.toHaveBeenCalled()

    const queried = await fetch(`${base}${ACCEPT_PATH}`, { method: 'POST', headers: { origin: base, cookie: 'jason_token=human-cookie', 'content-type': 'application/json' }, body: JSON.stringify(decision()) })
    expect(queried.status).toBe(400)
    const fetched = await fetch(`${base}${ACCEPT_PATH}?episodeId=${EPISODE}`, { headers: { origin: base, cookie: 'jason_token=human-cookie' } })
    expect(fetched.status).toBe(403)
  })

  it('rejects every decision that is not one exact confirmed frame set', async () => {
    const { base, sent } = await scriptedHost()
    const invalid: [string, unknown][] = [
      ['no explicit confirmation', decision({ confirmed: false })],
      ['missing confirmation', { ...decision(), confirmed: undefined }],
      ['extra top-level field', decision({ reviewer: 'someone' })],
      ['missing note', { ...decision(), note: undefined }],
      ['blank note', decision({ note: '   ' })],
      ['note over the Writer maximum', decision({ note: 'x'.repeat(1001) })],
      ['non-string note', decision({ note: 42 })],
      ['uppercase frame set digest', decision({ expectedFrameSetDigest: 'C'.repeat(64) })],
      ['short frame set digest', decision({ expectedFrameSetDigest: 'c'.repeat(63) })],
      ['short idempotency key', decision({ idempotencyKey: 'key-1' })],
      ['idempotency key with a space', decision({ idempotencyKey: 'storyboard review key' })],
      ['empty frame set', decision({ items: [] })],
      ['non-list frame set', decision({ items: 'frame-1' })],
      ['frame set over the bound', decision({
        items: Array.from({ length: 257 }, (_, index) => ({
          frameId: `frame-${String(index)}`, expectedFrameDigest: FRAME_DIGEST,
        })),
      })],
      ['duplicated frameId', decision({
        items: [{ frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST },
          { frameId: 'frame-1', expectedFrameDigest: 'b'.repeat(64) }],
      })],
      ['paid prompt override', decision({
        items: [{ frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST, promptOverride: '更亮的雨夜' }],
      })],
      ['paid preflight binding', decision({
        items: [{ frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST, preflightId: 'preflight-1' }],
      })],
      ['model selection', decision({
        items: [{ frameId: 'frame-1', expectedFrameDigest: FRAME_DIGEST, model: 'wan-3.0' }],
      })],
      ['missing frame digest', decision({ items: [{ frameId: 'frame-1' }] })],
      ['non-string frameId', decision({ items: [{ frameId: 1, expectedFrameDigest: FRAME_DIGEST }] })],
      ['body over the cap', decision({ note: 'x'.repeat(120 * 1024) })],
      ['non-JSON content type', 'not-json'],
    ]
    for (const [label, body] of invalid) {
      const headers = label === 'non-JSON content type'
        ? { 'content-type': 'text/plain' } : {}
      const response = await post(base, body, headers)
      expect(response.status, label).toBe(400)
      expect(await response.json(), label).toEqual({ code: 'storyboard_human_review_request_invalid' })
    }
    const unparsable = await post(base, '{', { 'content-type': 'application/json' })
    expect(unparsable.status).toBe(400)
    const list = await post(base, JSON.stringify([decision()]), { 'content-type': 'application/json' })
    expect(list.status).toBe(400)
    const truncated = await mismatchedLength(base, JSON.stringify(decision()))
    expect(truncated).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('returns an expired session to explicit login without recording anything', async () => {
    const { base, reply, sent } = await scriptedHost()
    for (const status of [401, 403]) {
      reply({ detail: { code: 'storyboard_review_origin_forbidden' } }, status)
      const response = await post(base, decision())
      expect(response.status, String(status)).toBe(401)
      expect(await response.json()).toEqual({ code: 'storyboard_human_review_relogin_required' })
    }
    expect(sent).toHaveLength(2)
  })

  it('relays a definitive Writer rejection with its readable reason code', async () => {
    const { base, reply } = await scriptedHost()
    const rejections = [
      'storyboard_human_review_frame_set_changed',
      'storyboard_human_review_frame_set_incomplete',
      'storyboard_prompt_contract_invalid',
      'storyboard_human_review_idempotency_conflict',
      'storyboard_human_review_atomic_acceptance_failed',
    ]
    for (const reason of rejections) {
      reply({ detail: { code: reason, details: {} } }, 409)
      const response = await post(base, decision())
      expect(response.status, reason).toBe(409)
      expect(await response.json(), reason).toEqual({
        code: 'storyboard_human_review_accept_rejected', reason,
      })
    }
    reply({ detail: 'Episode not found' }, 404)
    const unexplained = await post(base, decision())
    expect(unexplained.status).toBe(409)
    expect(await unexplained.json()).toEqual({ code: 'storyboard_human_review_accept_rejected' })
    reply({ detail: { code: 'NOT-A-WRITER-CODE' } }, 409)
    const unparsableCode = await post(base, decision())
    expect(await unparsableCode.json()).toEqual({ code: 'storyboard_human_review_accept_rejected' })
  })

  it('reports an unread outcome as unknown rather than as a rejection', async () => {
    const { base, reply } = await scriptedHost()
    reply({ detail: 'writer exploded' }, 500)
    const failed = await post(base, decision())
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ code: 'storyboard_human_review_accept_unknown' })

    const broken = await host(async () => { throw new Error('writer unreachable') })
    const unavailable = await post(broken, decision())
    expect(unavailable.status).toBe(502)
    expect(await unavailable.json()).toEqual({ code: 'storyboard_human_review_accept_unknown' })

    const oversized = await host(async () => new Response(`{"padding":"${'x'.repeat(300 * 1024)}"}`, {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    expect((await post(oversized, decision())).status).toBe(502)
  })

  it('treats a receipt that does not confirm the frame set as an unknown outcome', async () => {
    const { base, reply } = await scriptedHost()
    const contradictions: [string, Record<string, unknown>][] = [
      ['a frame without a recorded check', receipt([{ frameId: 'frame-1' }])],
      ['a check for another frame', receipt([{ frameId: 'frame-2', checkId: 'check-1' }])],
      ['fewer records than frames', { ...receipt(), items: [] }],
      ['counts that disagree', { ...receipt(), acceptedCount: 0 }],
      ['another frame set digest', { ...receipt(), frameSetDigest: 'd'.repeat(64) }],
      ['a provider call', { ...receipt(), providerCalls: 1 }],
      ['a budget mutation', { ...receipt(), budgetMutation: true }],
      ['no item list', { ...receipt(), items: 'frame-1' }],
    ]
    for (const [label, payload] of contradictions) {
      reply(payload)
      const response = await post(base, decision())
      expect(response.status, label).toBe(502)
      expect(await response.json(), label).toEqual({
        code: 'storyboard_human_review_acceptance_invalid',
      })
    }
  })

  it('forwards one idempotency key unchanged so a replay stays a no-op', async () => {
    const { base, reply, sent } = await scriptedHost()
    reply(receipt())
    expect((await post(base, decision())).status).toBe(200)
    expect((await post(base, decision())).status).toBe(200)
    expect(sent.map(entry => (JSON.parse(entry.body) as Record<string, unknown>).idempotency_key))
      .toEqual([KEY, KEY])
  })

  it('unregisters the exact route when the effect is disposed', async () => {
    const { base, reply } = await scriptedHost()
    reply(receipt())
    expect((await post(base, decision())).status).toBe(200)
    dispose?.(); dispose = undefined
    expect((await post(base, decision())).status).toBe(404)
  })
})
