import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  FIRST_FRAME_SELECTION_DECISION_PATH,
  FIRST_FRAME_SELECTION_MEDIA_PATH,
  FIRST_FRAME_SELECTION_STATE_PATH,
  FIRST_FRAME_HISTORY_PATH,
  FIRST_FRAME_HISTORY_MEDIA_PATH,
  registerFirstFrameSelectionCommands,
} from '../src/first-frame-selection.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
let server: Server | undefined
let dispose: (() => void) | undefined

afterEach(async () => {
  dispose?.(); dispose = undefined
  if (server !== undefined) { server.close(); await once(server, 'close'); server = undefined }
})

async function host(fetchUpstream: typeof globalThis.fetch, readToken: () => string | undefined = () => undefined): Promise<string> {
  const routes = new Map<string, WebRoute>()
  const webServer = {
    register(route: WebRoute) { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as unknown as WebServer
  dispose = registerFirstFrameSelectionCommands(webServer, { baseUrl: 'http://127.0.0.1:8115', fetch: fetchUpstream, readToken })
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

const coordinates = { projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'revision-1', frameId: 'frame-1' }
const bytes = Buffer.from('first-frame')
const materializedSha256 = sha(bytes.toString())

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}

function contractSha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  return input instanceof URL ? input : new URL(input.url)
}

function state(assetSha256 = materializedSha256) {
  return {
    schema: 'jason.qingmu-first-frame-selection-state.v1', ...coordinates, frameUpdatedAt: '2026-09-02T00:00:00Z', storyboardRevision: 1,
    identity: { actorUserId: 'owner-1', naturalPersonId: 'person-1', state: 'bound' },
    candidates: [{ assetId: 'asset-1', assetSha256, materializedSha256, qualityStatus: 'passed', selectionStatus: 'Unselected', isSelected: false, assetUpdatedAt: '2026-09-02T00:00:00Z' }],
    selectedAssetId: null, selectionReceipt: null, blockers: [], providerCalls: 0, taskMutation: false, outboxEvents: 0,
  }
}

function selectedState() {
  const current = state()
  const candidate = { ...current.candidates[0]!, selectionStatus: 'Selected', isSelected: true }
  const binding = {
    schema: 'jason.qingmu-first-frame-selection-binding.v1', ...coordinates,
    assetId: candidate.assetId, assetSha256: candidate.assetSha256,
    materializedSha256: candidate.materializedSha256,
    frameUpdatedAt: current.frameUpdatedAt, storyboardRevision: current.storyboardRevision,
    qualityStatus: 'passed',
  }
  const unsignedReceipt = {
    schema: 'jason.qingmu-first-frame-selection-receipt.v1',
    selectionIdentity: 'qingmu-first-frame-human-selection-v1', actorUserId: 'owner-1', naturalPersonId: 'person-1',
    ...coordinates, selectedAssetId: candidate.assetId, selectedAssetSha256: candidate.assetSha256,
    selectedMaterializedSha256: candidate.materializedSha256, selectionStatus: 'Selected',
    idempotencyKey: 'first-frame-selection-1', requestSha256: sha('request'),
    intentSessionSha256: sha('session'), intentBindingSha256: sha('intent-binding'),
    binding, bindingSha256: contractSha(binding), selectedAt: '2026-09-02T00:00:01Z',
  }
  return {
    ...current,
    candidates: [candidate],
    selectedAssetId: candidate.assetId,
    selectionReceipt: { ...unsignedReceipt, receiptSha256: contractSha(unsignedReceipt) },
    blockers: [],
  }
}

describe('first-frame selection Host media bridge', () => {
  it.each([false, true])('resolves real materialized media IDs (history=%s)', async (history) => {
    const current = state()
    current.candidates[0]!.assetId = 'asset_ingest_1234'
    const historical = { schema: 'jason.qingmu-first-frame-history.v1', ...coordinates,
      candidates: [{ assetId: 'asset_ingest_1234', materializedSha256, qualityStatus: 'passed', selectionStatus: 'Stale', isSelected: false }],
      providerCalls: 0, taskMutation: false, outboxEvents: 0 }
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.pathname.startsWith('/api/media/')) return url.pathname === '/api/media/media_ingest_1234'
        ? new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } })
        : new Response('', { status: 404 })
      return Response.json(history ? historical : current)
    })
    const base = await host(upstream)
    const path = history ? FIRST_FRAME_HISTORY_MEDIA_PATH : FIRST_FRAME_SELECTION_MEDIA_PATH
    const query = new URLSearchParams({ ...coordinates, assetId: 'asset_ingest_1234', expectedMaterializedSha256: materializedSha256 })
    const response = await fetch(`${base}${path}?${query}`, { headers: { cookie: 'jason_token=human-cookie' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ assetId: 'asset_ingest_1234', materializedSha256 })
    expect(upstream.mock.calls.map(([input]) => requestUrl(input).pathname).at(-1)).toBe('/api/media/media_ingest_1234')
  })
  it('browses stale history through read-only routes while keeping selection media strict', async () => {
    const history = { schema: 'jason.qingmu-first-frame-history.v1', ...coordinates,
      candidates: [{ assetId: 'asset-1', materializedSha256, qualityStatus: 'passed', selectionStatus: 'Stale', isSelected: false }],
      providerCalls: 0, taskMutation: false, outboxEvents: 0 }
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.pathname === '/api/media/asset-1') return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } })
      return Response.json(url.pathname.endsWith('/history') ? history : { ...state(), candidates: [] })
    })
    const base = await host(upstream)
    const headers = { cookie: 'jason_token=human-cookie' }
    const query = new URLSearchParams({ ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256 })
    expect((await fetch(`${base}${FIRST_FRAME_HISTORY_PATH}?${new URLSearchParams(coordinates)}`, { headers })).status).toBe(200)
    expect((await fetch(`${base}${FIRST_FRAME_HISTORY_MEDIA_PATH}?${query}`, { headers })).status).toBe(200)
    expect((await fetch(`${base}${FIRST_FRAME_SELECTION_MEDIA_PATH}?${query}`, { headers })).status).toBe(409)
    expect(upstream.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
    history.frameId = 'foreign'
    expect((await fetch(`${base}${FIRST_FRAME_HISTORY_MEDIA_PATH}?${query}`, { headers })).status).toBe(409)
  })
  it('serves the tokenless native shell through the service token when no writer cookie exists', async () => {
    const history = { schema: 'jason.qingmu-first-frame-history.v1', ...coordinates,
      candidates: [{ assetId: 'asset-1', materializedSha256, qualityStatus: 'passed', selectionStatus: 'Stale', isSelected: false }],
      providerCalls: 0, taskMutation: false, outboxEvents: 0 }
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.pathname === '/api/media/asset-1') return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } })
      return Response.json(url.pathname.endsWith('/history') ? history : { ...state(), candidates: [] })
    })
    const base = await host(upstream, () => 'service-token-1')
    const query = new URLSearchParams({ ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256 })
    expect((await fetch(`${base}${FIRST_FRAME_HISTORY_PATH}?${new URLSearchParams(coordinates)}`)).status).toBe(200)
    expect((await fetch(`${base}${FIRST_FRAME_HISTORY_MEDIA_PATH}?${query}`)).status).toBe(200)
    expect(upstream.mock.calls.every(([, init]) => (init?.headers as Headers | undefined)?.get('authorization') === 'Bearer service-token-1')).toBe(true)
  })

  it('returns only byte-verified media for the current scoped candidate', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      return url.pathname === '/api/media/asset-1'
        ? new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } })
        : Response.json(state())
    })
    const base = await host(upstream)
    const response = await fetch(`${base}${FIRST_FRAME_SELECTION_MEDIA_PATH}?${new URLSearchParams({ ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256 })}`, {
      headers: { cookie: 'jason_token=human-cookie' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ...coordinates, assetId: 'asset-1', materializedSha256, mimeType: 'image/png' })
  })

  it('fails closed on a stale candidate state or materialized bytes', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      return url.pathname === '/api/media/asset-1'
        ? new Response(Buffer.from('drift'), { headers: { 'content-type': 'image/png' } })
        : Response.json(state('b'.repeat(64)))
    })
    const base = await host(upstream)
    const response = await fetch(`${base}${FIRST_FRAME_SELECTION_MEDIA_PATH}?${new URLSearchParams({ ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256 })}`, {
      headers: { cookie: 'jason_token=human-cookie' },
    })
    expect(response.status).toBe(409)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('accepts the exact Writer-selected state and receipt contract', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json(selectedState()))
    const base = await host(upstream)
    const response = await fetch(`${base}${FIRST_FRAME_SELECTION_STATE_PATH}?${new URLSearchParams(coordinates)}`, {
      headers: { cookie: 'jason_token=human-cookie' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ selectedAssetId: 'asset-1', blockers: [] })
  })

  it('validates Writer transport metadata outside the signed receipt and returns the signed core', async () => {
    const receipt = selectedState().selectionReceipt
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      return url.pathname.endsWith('/intent')
        ? Response.json({
          schema: 'jason.qingmu-human-authority-intent.v1', action: 'first_frame_selection.record',
          proof: 'fixture-proof', requestSha256: receipt.requestSha256,
        })
        : Response.json({ ...receipt, providerCalls: 0, taskMutation: false, outboxEvents: 0 })
    })
    const base = await host(upstream)
    const query = new URLSearchParams({
      ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256,
      idempotencyKey: 'first-frame-selection-1',
    })
    const body = {
      assetId: 'asset-1', expectedAssetId: 'asset-1', expectedMaterializedSha256: materializedSha256,
      expectedStoryboardRevisionId: coordinates.storyboardRevisionId, confirmed: true,
      idempotencyKey: 'first-frame-selection-1',
    }
    const response = await fetch(`${base}${FIRST_FRAME_SELECTION_DECISION_PATH}?${query.toString()}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'jason_token=human-cookie', origin: base },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('rejects every missing or non-zero Writer transport metadata field', async () => {
    const receipt = selectedState().selectionReceipt
    const valid = { ...receipt, providerCalls: 0, taskMutation: false, outboxEvents: 0 }
    const without = (key: string) => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key))
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ['missing providerCalls', without('providerCalls')],
      ['missing taskMutation', without('taskMutation')],
      ['missing outboxEvents', without('outboxEvents')],
      ['non-zero providerCalls', { ...valid, providerCalls: 1 }],
      ['true taskMutation', { ...valid, taskMutation: true }],
      ['non-zero outboxEvents', { ...valid, outboxEvents: 1 }],
    ]
    let transport: Record<string, unknown> = valid
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = requestUrl(input)
      return url.pathname.endsWith('/intent')
        ? Response.json({
          schema: 'jason.qingmu-human-authority-intent.v1', action: 'first_frame_selection.record',
          proof: 'fixture-proof', requestSha256: receipt.requestSha256,
        })
        : Response.json(transport)
    })
    const base = await host(upstream)
    const query = new URLSearchParams({
      ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: materializedSha256,
      idempotencyKey: 'first-frame-selection-1',
    })
    const body = JSON.stringify({
      assetId: 'asset-1', expectedAssetId: 'asset-1', expectedMaterializedSha256: materializedSha256,
      expectedStoryboardRevisionId: coordinates.storyboardRevisionId, confirmed: true,
      idempotencyKey: 'first-frame-selection-1',
    })
    for (const [label, variant] of cases) {
      transport = variant
      const response = await fetch(`${base}${FIRST_FRAME_SELECTION_DECISION_PATH}?${query.toString()}`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: 'jason_token=human-cookie', origin: base },
        body,
      })
      expect(response.status, label).toBe(409)
    }
    expect(upstream).toHaveBeenCalledTimes(cases.length * 2)
  })
})
