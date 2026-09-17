import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerStoryboardHumanReviewRead } from '../src/storyboard-human-review.ts'

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
  dispose = registerStoryboardHumanReviewRead(registrar, {
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

/** The upstream URL as the bridge actually requested it. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const READ_PATH = '/api/qingmu/storyboard-human-review/state'
const EPISODE = 'episode-review'

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frameId: 'frame-1', frameNo: 1, title: '雨夜旧车站', durationSec: 4.5,
    imagePromptCn: '夜雨中的旧车站，一盏坏掉的路灯', frameDigest: 'a'.repeat(64),
    accepted: false, status: 'pending', blockerCode: 'storyboard_human_review_required',
    review: null, preflight: null, selectedFirstFrame: null,
    selectedFirstFrameBlocker: null, sourceSummary: null, sourceSummaryBlocker: null,
    repairSuggestion: null, ...overrides,
  }
}

function state(
  items: Record<string, unknown>[] = [frame()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const acceptedCount = items.filter(item => item.accepted === true).length
  const accepted = items.length > 0 && acceptedCount === items.length
  return {
    version: 'storyboard-preproduction-human-review-v1',
    projectId: 'project-review', episodeId: EPISODE, storyboardRevision: 7,
    frameSetDigest: 'c'.repeat(64), totalCount: items.length, acceptedCount, accepted,
    blockerCode: accepted ? null : 'storyboard_human_review_required',
    items, providerCalls: 0, budgetMutation: false, ...overrides,
  }
}

/** One host whose Writer reply the test rewrites between requests. */
async function scriptedHost(): Promise<{ base: string; reply: (body: unknown, status?: number) => void }> {
  let body: unknown = state()
  let status = 200
  const base = await host(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
  return { base, reply: (next: unknown, nextStatus = 200) => { body = next; status = nextStatus } }
}

async function read(base: string, init?: RequestInit, query = `episodeId=${EPISODE}`): Promise<Response> {
  return fetch(`${base}${READ_PATH}?${query}`, init)
}

const cookie = { headers: { cookie: 'jason_token=human-cookie; unrelated=value' } }

describe('storyboard pre-production human review read bridge', () => {
  it('forwards only the human cookie and returns the validated state verbatim', async () => {
    const payload = state([frame(), frame({
      frameId: 'frame-2', frameNo: 2, title: '站台尽头', durationSec: 3,
      frameDigest: 'b'.repeat(64),
    })])
    const upstream = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(requestUrl(input))
      expect(url.pathname).toBe(`/api/episodes/${EPISODE}/storyboard-human-review`)
      const headers = new Headers(init?.headers)
      expect(headers.get('cookie')).toBe('jason_token=human-cookie')
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('accept')).toBe('application/json')
      return Response.json(payload)
    })
    const base = await host(upstream)
    const response = await read(base, cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(payload)
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('refuses a bearer caller and a non-GET method without touching the Writer', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json(state()))
    const base = await host(upstream)
    const bearer = await read(base, {
      headers: { cookie: 'jason_token=human-cookie', authorization: 'Bearer launcher' },
    })
    expect(bearer.status).toBe(403)
    expect(await bearer.json()).toEqual({ code: 'storyboard_human_review_read_forbidden' })
    const posted = await read(base, { method: 'POST', ...cookie })
    expect(posted.status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects every coordinate that is not exactly one well-formed episodeId', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json(state()))
    const base = await host(upstream)
    for (const query of [
      '', 'episodeId=', `episodeId=${EPISODE}&projectId=project-review`,
      'projectId=project-review', 'episodeId=%2Fetc%2Fpasswd', 'episodeId=..',
    ]) {
      const response = await read(base, cookie, query)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toEqual({ code: 'storyboard_human_review_read_invalid' })
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('sends the browser to explicit login instead of guessing an identity', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json(state()))
    const base = await host(upstream)
    const anonymous = await read(base)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ code: 'storyboard_human_review_relogin_required' })
    const unrelated = await read(base, { headers: { cookie: 'other=value' } })
    expect(unrelated.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()

    for (const status of [401, 403]) {
      const { base: expired, reply } = await scriptedHost()
      reply({ detail: { code: 'storyboard_review_origin_forbidden' } }, status)
      const response = await read(expired, cookie)
      expect(response.status, String(status)).toBe(401)
      expect(await response.json()).toEqual({ code: 'storyboard_human_review_relogin_required' })
    }
  })

  it('passes an empty frame set through as a gate that is still blocked', async () => {
    const { base, reply } = await scriptedHost()
    reply(state([]))
    const response = await read(base, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      totalCount: 0, acceptedCount: 0, accepted: false,
      blockerCode: 'storyboard_human_review_required', items: [],
    })
  })

  it('accepts a fully reviewed episode whose frames all report accepted', async () => {
    const { base, reply } = await scriptedHost()
    reply(state([
      frame({ accepted: true, status: 'accepted', blockerCode: null, review: { note: '确认整集' } }),
      frame({ frameId: 'frame-2', frameNo: 2, frameDigest: 'b'.repeat(64),
        accepted: true, status: 'accepted', blockerCode: null }),
    ]))
    const response = await read(base, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      accepted: true, acceptedCount: 2, totalCount: 2, blockerCode: null,
    })
  })

  it('refuses a state that claims the gate passed without its frames agreeing', async () => {
    const contradictions: [string, Record<string, unknown>][] = [
      ['accepted flag with no accepted frame',
        state([frame()], { accepted: true, blockerCode: null, acceptedCount: 1 })],
      ['frame accepted while its status is pending',
        state([frame({ accepted: true, status: 'pending' })],
          { acceptedCount: 1, accepted: true, blockerCode: null })],
      ['accepted frame still carrying a blocker',
        state([frame({ accepted: true, status: 'accepted', blockerCode: 'storyboard_human_review_stale' })],
          { acceptedCount: 1, accepted: true, blockerCode: null })],
      ['duplicated frameId', state([frame(), frame({ frameId: 'frame-1' })])],
      ['provider call', state([frame()], { providerCalls: 1 })],
      ['budget mutation', state([frame()], { budgetMutation: true })],
      ['unknown version', state([frame()], { version: 'storyboard-preproduction-human-review-v2' })],
      ['another episode', state([frame()], { episodeId: 'episode-other' })],
      ['uppercase frame set digest', state([frame()], { frameSetDigest: 'C'.repeat(64) })],
      ['totalCount off by one', state([frame()], { totalCount: 2 })],
      ['acceptedCount not recomputable', state([frame()], { acceptedCount: 1, accepted: false })],
      ['blocker cleared without acceptance', state([frame()], { blockerCode: null })],
      ['blocker from another gate', state([frame()], { blockerCode: 'missing_final_output' })],
      ['uppercase frame digest', state([frame({ frameDigest: 'A'.repeat(64) })])],
      ['status outside the closed set', state([frame({ status: 'shipped' })])],
      ['non-finite duration', state([frame({ durationSec: Number.NaN })])],
      ['non-string title', state([frame({ title: 42 })])],
      ['review neither null nor record', state([frame({ review: 'accepted' })])],
      ['items not a list', { ...state(), items: 'frame-1' }],
    ]
    const { base, reply } = await scriptedHost()
    for (const [label, payload] of contradictions) {
      reply(payload)
      const response = await read(base, cookie)
      expect(response.status, label).toBe(409)
      expect(await response.json(), label).toEqual({ code: 'storyboard_human_review_state_invalid' })
    }
  })

  it('fails closed on an oversized state, an unparsable body, and a transport failure', async () => {
    const { base, reply } = await scriptedHost()
    reply(state([frame({ imagePromptCn: 'x'.repeat(5 * 1024 * 1024) })]))
    const oversized = await read(base, cookie)
    expect(oversized.status).toBe(409)
    expect(await oversized.json()).toEqual({ code: 'storyboard_human_review_state_invalid' })

    const truncated = await host(async () => new Response('not json', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    expect((await read(truncated, cookie)).status).toBe(502)

    const broken = await host(async () => { throw new Error('writer unreachable') })
    const unavailable = await read(broken, cookie)
    expect(unavailable.status).toBe(502)
    expect(await unavailable.json()).toEqual({ code: 'storyboard_human_review_state_unavailable' })
  })

  it('unregisters the exact route when the effect is disposed', async () => {
    const { base, reply } = await scriptedHost()
    reply(state())
    expect((await read(base, cookie)).status).toBe(200)
    dispose?.(); dispose = undefined
    expect((await read(base, cookie)).status).toBe(404)
  })
})
