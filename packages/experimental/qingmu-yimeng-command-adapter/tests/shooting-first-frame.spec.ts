import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerShootingFirstFrame } from '../src/shooting-first-frame.ts'
let server: Server | undefined
afterEach(async () => { if (server) { server.close(); await once(server,'close'); server=undefined } })
async function host(upstream: typeof fetch, readToken: () => string | undefined = () => undefined) {
  const routes = new Map<string, WebRoute>()
  registerShootingFirstFrame({ register(route:WebRoute) {routes.set(route.path,route);return () => routes.delete(route.path)} } as unknown as WebServer,'http://127.0.0.1:8115',upstream,readToken)
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
it.each([
  ['preview', 'POST', { project_id:'p', episode_id:'e', frame_ids:['f'] }],
  ['submit', 'POST', body],
  ['review?project_id=p&episode_id=e&frame_id=f', 'GET', undefined],
  ['state?project_id=p&episode_id=e&frame_id=f&request_id=r', 'GET', undefined],
  ['video-state?project_id=p&episode_id=e&scene_id=s&frame_id=f', 'GET', undefined],
  ['video-resume', 'POST', { project_id:'p', episode_id:'e', frame_ids:['f'], scene_id:'s', task_id:'original' }],
])('uses native identity for %s without creating a human cookie', async (path, method, payload) => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ ok:true }))
  const readToken=vi.fn(() => 'native-test')
  const base=await host(upstream,readToken)
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/${path}`,{
    method, headers:{ origin:base }, ...(payload === undefined ? {} : { body:JSON.stringify(payload) }),
  })
  expect(response.status).toBe(200);expect(upstream).toHaveBeenCalledTimes(1)
  const headers=new Headers(upstream.mock.calls[0]![1]?.headers)
  expect(headers.get('authorization')).toBe('Bearer native-test')
  expect(headers.get('cookie')).toBeNull()
  expect(await response.json()).toEqual({ ok:true })
  expect(response.headers.get('set-cookie')).toBeNull()
})
it('never elevates native identity into human confirmation or trusts browser bearer headers', async () => {
  const upstream=vi.fn<typeof fetch>()
  const readToken=vi.fn(() => 'native-test')
  const base=await host(upstream,readToken)
  for (const [path,headers] of [
    ['confirm',{ origin:base }],
    ['preview',{ origin:'https://foreign.test' }],
    ['preview',{ origin:base,authorization:'Bearer injected' }],
    ['preview',{ origin:base,authorization:'' }],
    ['preview',{ origin:base,cookie:'jason_token=' }],
  ] as const) {
    expect((await fetch(`${base}/api/qingmu/shooting-first-frame/${path}`,{ method:'POST',headers,body:JSON.stringify(body) })).status).toBe(401)
  }
  expect(upstream).not.toHaveBeenCalled();expect(readToken).not.toHaveBeenCalled()
})
it('preserves cookie identity and does not replace its upstream rejection with service authority', async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ detail:'expired' },{ status:401 }))
  const readToken=vi.fn(() => 'native-test')
  const base=await host(upstream,readToken)
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/preview`,{
    method:'POST',headers:{ origin:base,cookie:'jason_token=expired' },
    body:JSON.stringify({ project_id:'p',episode_id:'e',frame_ids:['f'] }),
  })
  expect(response.status).toBe(401);expect(readToken).not.toHaveBeenCalled()
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('does not reflect a service credential in upstream error data', async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ detail:'Bearer native-private' },{ status:500 }))
  const base=await host(upstream,() => 'native-private')
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/review?project_id=p&episode_id=e&frame_id=f`)
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('native-private')
})
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
it('recovers only through GET and preserves the scoped expiring browser media link',async () => {
  const path=`/api/media/media-one?expires=9999999999&signature=${'f'.repeat(64)}`
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ candidate:{ browserUrl:path } }))
  const base=await host(upstream)
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/state?project_id=p&episode_id=e&frame_id=f&request_id=r`,{ headers:{ cookie:'jason_token=test' } })
  expect(await response.json()).toEqual({ candidate:{ browserUrl:`http://127.0.0.1:8115${path}` } })
  expect(upstream.mock.calls[0]![1]?.method).toBe('GET')
})
it.each([
  '/api/media/media-one',
  'https://foreign.test/api/media/media-one',
  `/api/media/media-one?expires=9999999999&signature=${'f'.repeat(64)}&token=other`,
  `/api/media/media-one?expires=9999999999&expires=1&signature=${'f'.repeat(64)}`,
  `/api/media/../admin?expires=9999999999&signature=${'f'.repeat(64)}`,
])('rejects unsigned or unrelated candidate locator %s',async (path) => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ candidate:{ browserUrl:path } }))
  const base=await host(upstream,()=>'native-test')
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/state?project_id=p&episode_id=e&frame_id=f&request_id=r`)
  expect(response.status).toBe(502);expect(upstream).toHaveBeenCalledTimes(1)
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

it('carries explicit image bindings only on preparation, never as submit authority', async () => {
  const upstream=vi.fn<typeof fetch>(async () => Response.json({ referenceMode:'working' }))
  const base=await host(upstream,() => 'native-test')
  const reference_images=[{ assetId:'img',assetSha256:'f'.repeat(64),purpose:'完整保留场景门窗布局。',boxes:[] }]
  const previewBody={ project_id:'p',episode_id:'e',frame_ids:['f'],reference_images,candidate_request_id:'shooting-prior' }
  const response=await fetch(`${base}/api/qingmu/shooting-first-frame/preview`,{ method:'POST',headers:{ origin:base },body:JSON.stringify(previewBody) })
  expect(response.status).toBe(200)
  expect(JSON.parse(String(upstream.mock.calls[0]![1]?.body))).toEqual(previewBody)
  await fetch(`${base}/api/qingmu/shooting-first-frame/submit`,{ method:'POST',headers:{ origin:base },body:JSON.stringify({ ...body,reference_images,referenceMode:'working' }) })
  expect(upstream).toHaveBeenCalledTimes(1)
})
