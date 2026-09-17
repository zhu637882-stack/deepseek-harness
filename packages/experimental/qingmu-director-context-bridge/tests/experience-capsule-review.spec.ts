import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerExperienceCapsuleReviewRoutes } from '../src/experience-capsule-review.ts'
import { capsuleActiveStorePathFor, capsuleQueuePathFor } from '../src/experience-capsule-store.ts'

const REVIEW_PATH = '/api/qingmu/experience-capsule-review'
const PROMOTE_PATH = '/api/qingmu/experience-capsule-review/promote'

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

/** One Host serving the two capsule routes over a real socket. */
async function host(runtimeRoot: string): Promise<string> {
  await teardown()
  const routes = new Map<string, WebRoute>()
  const registrar = { register(route: WebRoute) {
    routes.set(route.path, route); return () => { routes.delete(route.path) }
  } } as unknown as WebServer
  dispose = registerExperienceCapsuleReviewRoutes(registrar, { runtimeRoot })
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

/** A runtime root holding one queue and one active store the operator can review. */
async function seededRoot(
  queue: Record<string, unknown>[],
  active: Record<string, unknown>[] = [],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'capsule-review-'))
  await writeFile(capsuleQueuePathFor(root), JSON.stringify(queue), 'utf8')
  await writeFile(capsuleActiveStorePathFor(root), JSON.stringify({ capsules: active }), 'utf8')
  return root
}

function queued(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, symptom: `${id} 踩到的坑`, rule: `${id} 下次要做的动作`,
    submittedAt: '2026-09-16T00:00:00.000Z', sessionId: 'session-1', ...overrides,
  }
}

function get(base: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${REVIEW_PATH}`, { headers: { origin: base, ...headers } })
}

function post(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${PROMOTE_PATH}`, {
    method: 'POST',
    headers: {
      origin: base, cookie: 'jason_token=human-cookie; unrelated=value',
      'content-type': 'application/json', ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** The two capsule files as they are on disk after a reply. */
async function files(root: string): Promise<{ queue: unknown; active: unknown }> {
  return {
    queue: JSON.parse(await readFile(capsuleQueuePathFor(root), 'utf8')) as unknown,
    active: JSON.parse(await readFile(capsuleActiveStorePathFor(root), 'utf8')) as unknown,
  }
}

describe('experience capsule review routes', () => {
  it('reads the queue and the injected store as one review state', async () => {
    const root = await seededRoot(
      [queued('SELF-01'), queued('EXP-09'), queued('SELF-02', { submittedAt: undefined, sessionId: undefined })],
      [{ id: 'EXP-09', symptom: '旧症状', rule: '旧规则', stages: ['shooting'] }],
    )
    const base = await host(root)
    const response = await get(base)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const state = await response.json() as Record<string, unknown>
    expect(state).toMatchObject({
      schema: 'qingmu-experience-capsule-review-v1', renderLimit: 12, injectedCount: 1,
    })
    expect(state.queue).toEqual([
      { ...queued('SELF-01'), alreadyApproved: false },
      { ...queued('EXP-09'), alreadyApproved: true },
      { id: 'SELF-02', symptom: 'SELF-02 踩到的坑', rule: 'SELF-02 下次要做的动作', alreadyApproved: false },
    ])
    expect(state.active).toEqual([
      { id: 'EXP-09', symptom: '旧症状', rule: '旧规则', stages: ['shooting'], injected: true },
    ])
    expect(state.promoted).toBeUndefined()
  })

  it('marks the capsules past the injection cap as stored only', async () => {
    const active = Array.from({ length: 13 }, (_, index) => ({
      id: `EXP-${String(index).padStart(2, '0')}`, symptom: 's', rule: 'r',
    }))
    const base = await host(await seededRoot([], active))
    const state = await (await get(base)).json() as {
      injectedCount: number
      active: { id: string; stages: unknown[]; injected: boolean }[]
    }
    expect(state.injectedCount).toBe(12)
    expect(state.active[11]).toMatchObject({ injected: true })
    expect(state.active[12]).toMatchObject({ stages: [], injected: false })
  })

  it('reads an empty channel as an empty review, not as a failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capsule-review-'))
    const state = await (await get(await host(root))).json() as Record<string, unknown>
    expect(state).toMatchObject({ injectedCount: 0, queue: [], active: [] })
  })

  it('refuses a caller that is not the operator browser', async () => {
    const root = await seededRoot([queued('SELF-01')])
    const base = await host(root)
    const forbidden: [string, Record<string, string>][] = [
      ['bearer token', { authorization: 'Bearer launcher' }],
      ['no origin', { origin: '' }],
      ['foreign origin', { origin: 'http://evil.example' }],
      ['cross-site marker', { 'sec-fetch-site': 'cross-site' }],
    ]
    for (const [label, headers] of forbidden) {
      const response = await get(base, headers)
      expect(response.status, label).toBe(403)
      expect(await response.json(), label).toEqual({ code: 'experience_capsule_review_forbidden' })
    }
    const queried = await fetch(`${base}${PROMOTE_PATH}`, {
      headers: { origin: base, cookie: 'jason_token=human-cookie' },
    })
    expect(queried.status).toBe(403)
    expect((await files(root)).queue).toEqual([queued('SELF-01')])
  })

  it('refuses a promotion that is not the signed-in operator browser', async () => {
    const root = await seededRoot([queued('SELF-01')])
    const base = await host(root)
    const forbidden: [string, Record<string, string>][] = [
      ['bearer token', { authorization: 'Bearer launcher' }],
      ['no origin', { origin: '' }],
      ['foreign origin', { origin: 'http://evil.example' }],
      ['no cookie', { cookie: '' }],
      ['unrelated cookie', { cookie: 'other=value' }],
      ['cookie over the bound', { cookie: `jason_token=${'x'.repeat(9000)}` }],
    ]
    for (const [label, headers] of forbidden) {
      const response = await post(base, { confirmed: true, ids: ['SELF-01'] }, headers)
      expect(response.status, label).toBe(403)
      expect(await response.json(), label).toEqual({ code: 'experience_capsule_review_forbidden' })
    }
    expect((await files(root)).queue).toEqual([queued('SELF-01')])
  })

  it('reports an unconfigured runtime root instead of reading a bare file name', async () => {
    const base = await host('')
    for (const response of [await get(base), await post(base, { confirmed: true, ids: ['SELF-01'] })]) {
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ code: 'experience_capsule_review_runtime_root_unconfigured' })
    }
  })

  it('reports an unusable capsule file instead of an empty review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capsule-review-'))
    await writeFile(capsuleQueuePathFor(root), '{', 'utf8')
    const base = await host(root)
    const read = await get(base)
    expect(read.status).toBe(503)
    expect(await read.json()).toEqual({ code: 'experience_capsule_review_store_unavailable' })

    const brokenActive = await seededRoot([queued('SELF-01')])
    await writeFile(capsuleActiveStorePathFor(brokenActive), '{', 'utf8')
    const promoted = await post(await host(brokenActive), { confirmed: true, ids: ['SELF-01'] })
    expect(promoted.status).toBe(503)
    expect(await promoted.json()).toEqual({ code: 'experience_capsule_review_store_unavailable' })
    expect(JSON.parse(await readFile(capsuleQueuePathFor(brokenActive), 'utf8')) as unknown)
      .toEqual([queued('SELF-01')])
  })

  it('promotes the ticked capsules and leaves the rest queued', async () => {
    const root = await seededRoot(
      [queued('SELF-01'), queued('SELF-02'), queued('EXP-09')],
      [{ id: 'EXP-09', symptom: '旧症状', rule: '旧规则' }, { id: 'EXP-01', symptom: 'a', rule: 'A' }],
    )
    const base = await host(root)
    const response = await post(base, { confirmed: true, ids: ['SELF-01', 'EXP-09'] })
    expect(response.status).toBe(200)
    const state = await response.json() as Record<string, unknown>
    expect(state.promoted).toEqual(['SELF-01', 'EXP-09'])
    expect(state.queue).toEqual([{ ...queued('SELF-02'), alreadyApproved: false }])
    expect(state.active).toEqual([
      { id: 'SELF-01', symptom: 'SELF-01 踩到的坑', rule: 'SELF-01 下次要做的动作', stages: [], injected: true },
      { id: 'EXP-09', symptom: 'EXP-09 踩到的坑', rule: 'EXP-09 下次要做的动作', stages: [], injected: true },
      { id: 'EXP-01', symptom: 'a', rule: 'A', stages: [], injected: true },
    ])
    expect(state.injectedCount).toBe(3)
    const stored = await files(root)
    expect(stored.queue).toEqual([queued('SELF-02')])
    expect(stored.active).toEqual({ capsules: (state.active as Record<string, unknown>[])
      .map(({ id, symptom, rule }) => ({ id, symptom, rule })) })
    expect(await (await get(base)).json()).toMatchObject({ injectedCount: 3 })
  })

  it('refuses ids that are not in the queue the operator read', async () => {
    const root = await seededRoot([queued('SELF-01')])
    const base = await host(root)
    const response = await post(base, { confirmed: true, ids: ['SELF-01', 'SELF-404'] })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'experience_capsule_review_ids_not_queued', ids: ['SELF-404'],
    })
    expect((await files(root)).queue).toEqual([queued('SELF-01')])
  })

  it('rejects every promotion that is not one explicit set of ids', async () => {
    const root = await seededRoot([queued('SELF-01')])
    const base = await host(root)
    const ids = ['SELF-01']
    const invalid: [string, unknown][] = [
      ['no explicit confirmation', { confirmed: false, ids }],
      ['missing confirmation', { ids }],
      ['extra field', { confirmed: true, ids, note: '批准' }],
      ['no ids', { confirmed: true }],
      ['empty ids', { confirmed: true, ids: [] }],
      ['ids over the bound', { confirmed: true, ids: Array.from({ length: 65 }, (_, index) => `SELF-${String(index)}`) }],
      ['duplicated id', { confirmed: true, ids: ['SELF-01', 'SELF-01'] }],
      ['unknown id shape', { confirmed: true, ids: ['审批全部'] }],
      ['short id', { confirmed: true, ids: ['ab'] }],
      ['non-string id', { confirmed: true, ids: [1] }],
      ['ids not a list', { confirmed: true, ids: 'SELF-01' }],
      ['body not an object', [ids]],
      ['body over the cap', { confirmed: true, ids, padding: 'x'.repeat(9 * 1024) }],
      ['body not JSON', 'not-json'],
    ]
    for (const [label, body] of invalid) {
      const headers = label === 'body not JSON' ? { 'content-type': 'text/plain' } : {}
      const response = await post(base, body, headers)
      expect(response.status, label).toBe(400)
      expect(await response.json(), label).toEqual({ code: 'experience_capsule_review_request_invalid' })
    }
    const unparsable = await post(base, '{')
    expect(unparsable.status).toBe(400)
    expect((await files(root)).queue).toEqual([queued('SELF-01')])
  })

  it('unregisters both routes when the effect is disposed', async () => {
    const base = await host(await seededRoot([queued('SELF-01')]))
    expect((await get(base)).status).toBe(200)
    dispose?.(); dispose = undefined
    expect((await get(base)).status).toBe(404)
    expect((await post(base, { confirmed: true, ids: ['SELF-01'] })).status).toBe(404)
  })
})
