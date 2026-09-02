import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { FIRST_FRAME_SELECTION_MEDIA_PATH, registerFirstFrameSelectionCommands } from '../src/first-frame-selection.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
let server: Server | undefined
let dispose: (() => void) | undefined

afterEach(async () => {
  dispose?.(); dispose = undefined
  if (server !== undefined) { server.close(); await once(server, 'close'); server = undefined }
})

async function host(fetchUpstream: typeof globalThis.fetch): Promise<string> {
  const routes = new Map<string, WebRoute>()
  const webServer = {
    register(route: WebRoute) { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as unknown as WebServer
  dispose = registerFirstFrameSelectionCommands(webServer, { baseUrl: 'http://127.0.0.1:8115', fetch: fetchUpstream })
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

function state(assetSha256 = materializedSha256) {
  return {
    schema: 'jason.qingmu-first-frame-selection-state.v1', ...coordinates, frameUpdatedAt: '2026-09-02T00:00:00Z', storyboardRevision: 1,
    identity: { actorUserId: 'owner-1', naturalPersonId: 'person-1', state: 'bound' },
    candidates: [{ assetId: 'asset-1', assetSha256, materializedSha256, qualityStatus: 'passed', selectionStatus: 'Unselected', isSelected: false, assetUpdatedAt: '2026-09-02T00:00:00Z' }],
    selectedAssetId: null, selectionReceipt: null, blockers: [], providerCalls: 0, taskMutation: false, outboxEvents: 0,
  }
}

describe('first-frame selection Host media bridge', () => {
  it('returns only byte-verified media for the current scoped candidate', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(input instanceof URL ? input.href : String(input))
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
      const url = new URL(input instanceof URL ? input.href : String(input))
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
})
