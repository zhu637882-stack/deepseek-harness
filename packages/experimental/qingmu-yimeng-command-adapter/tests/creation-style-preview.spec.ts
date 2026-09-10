import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { CREATION_STYLE_PREVIEW_PATH, registerCreationStylePreview } from '../src/creation-style-preview.ts'

let server: Server | undefined
afterEach(async () => { if (server !== undefined) { server.close(); await once(server, 'close'); server = undefined } })

async function host(upstream: typeof fetch): Promise<string> {
  const routes = new Map<string, WebRoute>()
  const webserver = {
    register(route: WebRoute) { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as unknown as WebServer
  registerCreationStylePreview(webserver, {
    baseUrl: 'http://127.0.0.1:8115', fetch: upstream,
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

it('serves a catalog thumbnail from Writer through the Host origin only', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70])
  const upstream = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: { 'content-type': 'image/webp' } }))
  const base = await host(upstream)
  const response = await fetch(`${base}${CREATION_STYLE_PREVIEW_PATH}?styleId=realistic`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect(String(upstream.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8115/images/tago-styles/realistic.webp')
})

it('rejects traversal and non-WebP upstream responses without exposing a Writer path', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response('no', { headers: { 'content-type': 'text/plain' } }))
  const base = await host(upstream)
  expect((await fetch(`${base}${CREATION_STYLE_PREVIEW_PATH}?styleId=../secret`)).status).toBe(400)
  expect((await fetch(`${base}${CREATION_STYLE_PREVIEW_PATH}?styleId=realistic`)).status).toBe(404)
  expect(upstream).toHaveBeenCalledOnce()
})
