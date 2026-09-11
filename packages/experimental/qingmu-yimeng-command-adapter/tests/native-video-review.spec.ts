import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerNativeVideoReview } from '../src/native-video-review.ts'

let server: Server | undefined
let dispose: (() => void) | undefined
afterEach(async () => { dispose?.(); if (server) { server.close(); await once(server, 'close'); server = undefined } })

async function host() {
  const routes = new Map<string, WebRoute>()
  const upstream = vi.fn<typeof fetch>(async () => Response.json({ state: 'pending' }))
  dispose = registerNativeVideoReview({ register(route: WebRoute) {
    routes.set(route.path, route); return () => { routes.delete(route.path) }
  } } as WebServer, { baseUrl: 'http://127.0.0.1:8115', fetch: upstream, readToken: () => 'service-credential' })
  server = createServer((req, res) => {
    const route = routes.get(new URL(req.url ?? '', 'http://local').pathname)
    if (!route) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local address')
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, url: `${origin}/api/qingmu/native-video-review?episodeId=ep-1&frameId=frame-1&assetId=asset-1&sha256=${'a'.repeat(64)}`, upstream }
}

it('preserves read-only recovery and permits a same-origin explicit submission', async () => {
  const h = await host()
  expect((await fetch(h.url)).status).toBe(200)
  expect(h.upstream.mock.calls[0]?.[1]?.method).toBe('GET')
  expect((await fetch(h.url, { method: 'POST', headers: { origin: h.origin } })).status).toBe(200)
  expect(h.upstream.mock.calls[1]?.[1]?.method).toBe('POST')
  expect(JSON.parse(String(h.upstream.mock.calls[1]?.[1]?.body))).toEqual({ materialized_asset_id: 'asset-1', expected_video_sha256: 'a'.repeat(64) })
  dispose?.()
  expect((await fetch(h.url)).status).toBe(404)
})

it('rejects cross-origin submission and duplicate coordinates before calling Writer', async () => {
  const h = await host()
  expect((await fetch(h.url, { method: 'POST', headers: { origin: 'https://untrusted.test' } })).ok).toBe(false)
  expect((await fetch(`${h.url}&assetId=asset-2`)).status).toBe(400)
  expect(h.upstream).not.toHaveBeenCalled()
})
