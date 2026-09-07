import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerShootingFirstFrame } from '../src/shooting-first-frame.ts'
let server: Server | undefined
afterEach(async () => { if (server) { server.close(); await once(server,'close'); server=undefined } })
async function host(upstream: typeof fetch) {
  const routes = new Map<string, WebRoute>()
  registerShootingFirstFrame({ register(route:WebRoute) {routes.set(route.path,route);return () => routes.delete(route.path)} } as unknown as WebServer,'http://127.0.0.1:8115',upstream)
  server=createServer((req,res) => {const route=routes.get(new URL(req.url ?? '/', 'http://local').pathname);if(route) void route.handler(req,res);else res.end()})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const address=server.address();if(!address || typeof address==='string') throw Error('missing address')
  return `http://127.0.0.1:${address.port}`
}
const body={ project_id:'p',episode_id:'e',frame_ids:['f'],candidate_request_id:'r',shooting_preflight_id:'a'.repeat(64),shooting_payload_hash:'b'.repeat(64) }
it('forwards one same-origin cookie submit, with no retry after ambiguous failure',async () => {
  const upstream=vi.fn<typeof fetch>(async () => {throw Error('lost response')})
  const base=await host(upstream)
  const result=await fetch(`${base}/api/qingmu/shooting-first-frame/submit`,{ method:'POST',headers:{ origin:base,cookie:'jason_token=test','content-type':'application/json' },body:JSON.stringify(body) })
  expect(result.status).toBe(502);expect(upstream).toHaveBeenCalledTimes(1)
  expect(new Headers(upstream.mock.calls[0]![1]?.headers).get('authorization')).toBeNull()
  expect(new Headers(upstream.mock.calls[0]![1]?.headers).get('cookie')).toBe('jason_token=test')
})
it('rejects cross-origin and ambiguous credentials before upstream',async () => {
  const upstream=vi.fn<typeof fetch>();const base=await host(upstream)
  for(const headers of [{ origin:'https://foreign.test',cookie:'jason_token=test' },{ origin:base,cookie:'jason_token=test',authorization:'Bearer other' }]) {
    expect((await fetch(`${base}/api/qingmu/shooting-first-frame/submit`,{ method:'POST',headers,body:JSON.stringify(body) })).status).toBe(401)
  }
  expect(upstream).not.toHaveBeenCalled()
})
it('recovers only through GET and resolves media against the configured Writer',async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ candidate:{ browserUrl:'/api/media/media-one' } }))
  const base=await host(upstream)
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/state?project_id=p&episode_id=e&frame_id=f&request_id=r`,{ headers:{ cookie:'jason_token=test' } })
  expect(await response.json()).toEqual({ candidate:{ browserUrl:'http://127.0.0.1:8115/api/media/media-one' } })
  expect(upstream.mock.calls[0]![1]?.method).toBe('GET')
})
