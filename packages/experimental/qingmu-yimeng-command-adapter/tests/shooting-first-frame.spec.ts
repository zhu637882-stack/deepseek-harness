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
const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

function requestJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string request body')
  return JSON.parse(init.body) as unknown
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
it('confirms only one explicit SHA-bound human cookie action and does not submit images',async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ status:{ accepted:true } }))
  const base=await host(upstream)
  const payload={ project_id:'p',episode_id:'e',frame_ids:['f'],expected_frame_digest:'a'.repeat(64),idempotency_key:'review-one' }
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/confirm`,{ method:'POST',headers:{ origin:base,cookie:'jason_token=test' },body:JSON.stringify(payload) })
  expect(response.status).toBe(200);expect(upstream).toHaveBeenCalledTimes(1)
  expect(requestUrl(upstream.mock.calls[0]![0])).toBe('http://127.0.0.1:8115/api/episodes/e/storyboard-frames/f/human-review?single_frame=true')
  expect(requestJsonBody(upstream.mock.calls[0]![1])).toEqual({ expected_frame_digest:'a'.repeat(64),idempotency_key:'review-one',decision:'accepted' })
  for(const changed of [{ ...payload,frame_ids:['f','other'] },{ ...payload,authenticated_reviewer_user_id:'forged' },{ ...payload,expected_frame_digest:'bad' }]) {
    await fetch(`${base}/api/qingmu/shooting-first-frame/confirm`,{ method:'POST',headers:{ origin:base,cookie:'jason_token=test' },body:JSON.stringify(changed) })
  }
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('never forwards Bearer or cross-origin review confirmation',async () => {
  const upstream=vi.fn<typeof fetch>();const base=await host(upstream)
  for(const headers of [{ authorization:'Bearer test' },{ origin:'https://foreign.test',cookie:'jason_token=test' },{ origin:base,cookie:'jason_token=test',authorization:'Bearer test' }]) {
    const response=await fetch(`${base}/api/qingmu/shooting-first-frame/confirm`,{ method:'POST',headers,body:'{}' })
    expect(response.status).toBe(401)
  }
  expect(upstream).not.toHaveBeenCalled()
})

it('transports video recovery as GET and explicit resume as one exact-task POST', async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ taskId:'original' }))
  const base=await host(upstream)
  const prefix=`${base}/api/qingmu/shooting-first-frame`
  await fetch(`${prefix}/video-state?project_id=p&episode_id=e&scene_id=s&frame_id=f`,{ headers:{ cookie:'jason_token=test' } })
  expect(upstream.mock.calls[0]![1]?.method).toBe('GET')
  expect(requestUrl(upstream.mock.calls[0]![0])).toBe('http://127.0.0.1:8115/api/qingmu/projects/p/episodes/e/scenes/s/shots/f/production-takes/execution')
  const payload={ project_id:'p',episode_id:'e',scene_id:'s',frame_ids:['f'],task_id:'original' }
  const headers={ origin:base,cookie:'jason_token=test' }
  await fetch(`${prefix}/video-resume`,{ method:'POST',headers,body:JSON.stringify(payload) })
  expect(upstream).toHaveBeenCalledTimes(2)
  expect(requestJsonBody(upstream.mock.calls[1]![1])).toEqual({ taskId:'original' })
  for (const changed of [{ ...payload,force:true },{ ...payload,frame_ids:['f','other'] },{ ...payload,scene_id:'../foreign' }]) {
    await fetch(`${prefix}/video-resume`,{ method:'POST',headers,body:JSON.stringify(changed) })
  }
  await fetch(`${prefix}/video-resume`,{ method:'POST',headers:{ ...headers,origin:'https://foreign.test' },body:JSON.stringify(payload) })
  expect(upstream).toHaveBeenCalledTimes(2)
})

it('passes a rework predecessor only to preview, without submitting a new paid task', async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ preflightId:'new' }))
  const base=await host(upstream)
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/preview`,{ method:'POST',headers:{ origin:base,cookie:'jason_token=test' },body:JSON.stringify({ project_id:'p',episode_id:'e',frame_ids:['f'],candidate_request_id:'shooting-old' }) })
  expect(response.status).toBe(200)
  expect(requestUrl(upstream.mock.calls[0]![0])).toContain('/shooting-preview')
  expect((requestJsonBody(upstream.mock.calls[0]![1]) as Record<string, unknown>).candidate_request_id).toBe('shooting-old')
  expect(upstream).toHaveBeenCalledTimes(1)
})
