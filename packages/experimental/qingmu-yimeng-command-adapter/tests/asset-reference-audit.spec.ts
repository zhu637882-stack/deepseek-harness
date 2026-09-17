import { createServer, request as httpRequest, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerAssetReferenceAuditCommands } from '../src/asset-reference-audit.ts'

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
  dispose = registerAssetReferenceAuditCommands(registrar, {
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

const QUOTE_PATH = '/api/qingmu/asset-reference-audit/quote'
const START_PATH = '/api/qingmu/asset-reference-audit/start'
const PROJECT = 'project-audit'
const EPISODE = 'episode-audit'
const QUERY = `projectId=${PROJECT}&episodeId=${EPISODE}`
const SOURCE_LOCK = 'a'.repeat(64)
const CALL_PLAN = 'b'.repeat(64)
const CONFIRMATION = '确认对当前1张候选图执行正式画面质检；预计¥0.2500，本批封顶¥0.2750。'

function manifestItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: 'asset-scene-1', assetSha256: 'c'.repeat(64), ownerType: 'scene', ownerId: 'scene-1',
    role: 'scene_reference', label: '御书房', auditMode: 'new_candidates', originalCheckId: null,
    rubricSha256: 'd'.repeat(64), imageRegeneration: false, capability: 'vision.audit',
    routeKey: 'b4_5.consistency', provider: 'dashscope', model: 'qwen3.7-plus-2026-05-26',
    estimatedCny: 0.25, pricingVerified: true, quoteAllowed: true,
    requestHash: 'e'.repeat(64), idempotencyKey: `asset-audit:${'e'.repeat(64)}`, ...overrides,
  }
}

function quote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const manifest = [manifestItem()]
  return {
    schema: 'asset-reference-audit-preflight-v1', quoteReady: true, projectId: PROJECT,
    episodeId: EPISODE, targetStage: 'asset_reference_audit',
    phaseLabel: '候选参考图正式质检', auditMode: 'new_candidates', imageRegeneration: false,
    manifest, callCount: manifest.length, estimatedCny: 0.25, authorizationCapCny: 0.275,
    sourceLockHash: SOURCE_LOCK, callPlanHash: CALL_PLAN,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    confirmationText: CONFIRMATION, validationErrors: [],
    readOnly: true, providerCalls: 0, taskMutation: false, budgetMutation: false,
    preflightId: 'preflight-1', ...overrides,
  }
}

function startBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    confirmed: true, preflightId: 'preflight-1', sourceLockHash: SOURCE_LOCK,
    callPlanHash: CALL_PLAN, confirmationText: CONFIRMATION,
    auditMode: 'new_candidates', assetIds: [], ...overrides,
  }
}

async function post(
  base: string, path: string, body: unknown, headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${path}?${QUERY}`, {
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
async function mismatchedLength(base: string, path: string, body: string): Promise<number> {
  const url = new URL(`${base}${path}?${QUERY}`)
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

function upstream(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
}

/** The upstream request body, which the bridge always sends as a JSON string. */
function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

describe('asset reference audit quote', () => {
  it('relays one free quote to the audit preflight route and returns it', async () => {
    const fetchUpstream = upstream(200, quote())
    const base = await host(fetchUpstream)
    const response = await post(base, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })
    expect(response.status).toBe(200)
    const value = await response.json() as Record<string, unknown>
    expect(value.preflightId).toBe('preflight-1')
    expect(value.providerCalls).toBe(0)
    expect(fetchUpstream).toHaveBeenCalledTimes(1)
    const call = vi.mocked(fetchUpstream).mock.calls[0]
    expect(requestUrl(call?.[0] as RequestInfo | URL))
      .toBe(`http://127.0.0.1:8115/api/projects/${PROJECT}/episodes/${EPISODE}/asset-references/audit/preflight`)
    expect(JSON.parse(requestBody(call?.[1] as RequestInit))).toEqual({
      asset_ids: [], audit_mode: 'new_candidates',
    })
    const headers = (call?.[1] as RequestInit).headers as Headers
    expect(headers.get('cookie')).toBe('jason_token=human-cookie')
    expect(headers.get('authorization')).toBeNull()
  })

  it('refuses a quote that claims a provider call or a budget mutation', async () => {
    const base = await host(upstream(200, quote({ providerCalls: 1 })))
    const response = await post(base, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ code: 'asset_reference_audit_quote_invalid' })
  })

  it('refuses a manifest entry that is not a vision audit of an existing image', async () => {
    for (const override of [
      { routeKey: 'b4.first_frame_generation' },
      { capability: 'image.generate' },
      { imageRegeneration: true },
    ]) {
      const base = await host(upstream(200, quote({ manifest: [manifestItem(override)] })))
      const response = await post(base, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })
      expect(response.status, JSON.stringify(override)).toBe(502)
      expect(await response.json()).toEqual({ code: 'asset_reference_audit_quote_invalid' })
    }
  })

  it('refuses a cap below the estimate and a call count that disagrees with the manifest', async () => {
    const lowCap = await host(upstream(200, quote({ authorizationCapCny: 0.1 })))
    expect((await post(lowCap, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })).status).toBe(502)
    const miscounted = await host(upstream(200, quote({ callCount: 2 })))
    expect((await post(miscounted, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })).status).toBe(502)
  })

  it('relays a blocked quote unchanged so the operator sees the per-image reasons', async () => {
    const base = await host(upstream(200, quote({
      quoteReady: false, manifest: [], callCount: 0, estimatedCny: 0, authorizationCapCny: 0,
      validationErrors: ['asset-scene-1:public_provider_media_url_missing'],
    })))
    const response = await post(base, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })
    expect(response.status).toBe(200)
    const value = await response.json() as Record<string, unknown>
    expect(value.quoteReady).toBe(false)
    expect(value.validationErrors).toEqual(['asset-scene-1:public_provider_media_url_missing'])
  })

  it('refuses a duplicate asset id and a mode outside the Writer pattern', async () => {
    const base = await host(upstream(200, quote()))
    const duplicated = await post(base, QUOTE_PATH, {
      auditMode: 'new_candidates', assetIds: ['asset-1', 'asset-1'],
    })
    expect(duplicated.status).toBe(400)
    expect(await duplicated.json()).toEqual({ code: 'asset_reference_audit_request_invalid' })
    const mode = await post(base, QUOTE_PATH, { auditMode: 'regenerate', assetIds: [] })
    expect(mode.status).toBe(400)
  })

  it('reports a session expiry as 401 and a Writer rejection as 409 with its reason', async () => {
    const expired = await host(upstream(401, { detail: 'not_authenticated' }))
    expect((await post(expired, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })).status).toBe(401)
    const rejected = await host(upstream(409, { detail: 'asset_reference_audit_preflight_expired' }))
    const response = await post(rejected, QUOTE_PATH, { auditMode: 'new_candidates', assetIds: [] })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'asset_reference_audit_quote_rejected', reason: 'asset_reference_audit_preflight_expired',
    })
  })
})

describe('asset reference audit start', () => {
  it('relays the four bound fields and returns the queued batch receipt', async () => {
    const fetchUpstream = upstream(200, {
      accepted: true,
      task: {
        id: 'task-1', local_status: 'queued', provider_status: '',
        capability: 'workflow.asset_reference_batch',
      },
      message: '正式质检已按确认报价入队',
    })
    const base = await host(fetchUpstream)
    const response = await post(base, START_PATH, startBody())
    expect(response.status).toBe(200)
    const value = await response.json() as Record<string, unknown>
    expect((value.task as Record<string, unknown>).id).toBe('task-1')
    const call = vi.mocked(fetchUpstream).mock.calls[0]
    expect(requestUrl(call?.[0] as RequestInfo | URL))
      .toBe(`http://127.0.0.1:8115/api/projects/${PROJECT}/episodes/${EPISODE}/asset-references/audit/start`)
    expect(JSON.parse(requestBody(call?.[1] as RequestInit))).toEqual({
      preflight_id: 'preflight-1', source_lock_hash: SOURCE_LOCK, call_plan_hash: CALL_PLAN,
      confirmation_text: CONFIRMATION, asset_ids: [], audit_mode: 'new_candidates',
    })
  })

  it('refuses to start without an explicit confirmed true', async () => {
    const fetchUpstream = upstream(200, { accepted: true, task: { id: 'task-1', capability: 'workflow.asset_reference_batch' } })
    const base = await host(fetchUpstream)
    for (const override of [{ confirmed: false }, { confirmed: 'true' }]) {
      const response = await post(base, START_PATH, startBody(override))
      expect(response.status, JSON.stringify(override)).toBe(400)
      expect(await response.json()).toEqual({ code: 'asset_reference_audit_request_invalid' })
    }
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('refuses a truncated confirmation text the Writer could not bind', async () => {
    const base = await host(upstream(200, { accepted: true, task: { id: 't', capability: 'workflow.asset_reference_batch' } }))
    const response = await post(base, START_PATH, startBody({ confirmationText: '   ' }))
    expect(response.status).toBe(400)
  })

  it('refuses a service token and a cross-origin browser', async () => {
    const fetchUpstream = upstream(200, { accepted: true, task: { id: 't', capability: 'workflow.asset_reference_batch' } })
    const base = await host(fetchUpstream)
    const tokened = await post(base, START_PATH, startBody(), { authorization: 'Bearer service-token' })
    expect(tokened.status).toBe(403)
    expect(await tokened.json()).toEqual({ code: 'asset_reference_audit_command_forbidden' })
    const crossOrigin = await post(base, START_PATH, startBody(), { origin: 'http://evil.invalid' })
    expect(crossOrigin.status).toBe(403)
    const cookieless = await fetch(`${base}${START_PATH}?${QUERY}`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify(startBody()),
    })
    expect(cookieless.status).toBe(403)
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it('reports a 5xx and an unread receipt as unknown, never as a rejection', async () => {
    const failed = await host(upstream(503, { detail: 'upstream_unavailable' }))
    const failedResponse = await post(failed, START_PATH, startBody())
    expect(failedResponse.status).toBe(502)
    expect(await failedResponse.json()).toEqual({ code: 'asset_reference_audit_start_unknown' })
    const wrongTask = await host(upstream(200, {
      accepted: true, task: { id: 'task-1', capability: 'image.generate' },
    }))
    const wrongResponse = await post(wrongTask, START_PATH, startBody())
    expect(wrongResponse.status).toBe(502)
    expect(await wrongResponse.json()).toEqual({ code: 'asset_reference_audit_dispatch_invalid' })
  })

  it('reports a transport failure as unknown because the batch may already be queued', async () => {
    const base = await host(vi.fn<typeof globalThis.fetch>(async () => { throw new Error('socket hang up') }))
    const response = await post(base, START_PATH, startBody())
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ code: 'asset_reference_audit_start_unknown' })
  })

  it('refuses a body longer than the content-length it declares', async () => {
    const base = await host(upstream(200, quote()))
    const status = await mismatchedLength(base, START_PATH, JSON.stringify(startBody()))
    expect(status).toBe(400)
  })

  it('refuses a query that is not exactly one project and one episode', async () => {
    const base = await host(upstream(200, quote()))
    const response = await fetch(`${base}${START_PATH}?projectId=${PROJECT}`, {
      method: 'POST',
      headers: { origin: base, cookie: 'jason_token=human-cookie', 'content-type': 'application/json' },
      body: JSON.stringify(startBody()),
    })
    expect(response.status).toBe(400)
  })
})
