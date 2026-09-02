import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerEntityDraftReviewCommands } from '../src/entity-draft-review.ts'

const SHA = 'a'.repeat(64)
const REVIEW_SHA = 'b'.repeat(64)
let server: Server | undefined
let dispose: (() => void) | undefined

afterEach(async () => {
  dispose?.(); dispose = undefined
  if (server !== undefined) { server.close(); await once(server, 'close'); server = undefined }
})

async function host(fetchUpstream: typeof globalThis.fetch): Promise<string> {
  const routes = new Map<string, WebRoute>()
  const registrar = { register(route: WebRoute) {
    routes.set(route.path, route); return () => { routes.delete(route.path) }
  } } as unknown as WebServer
  dispose = registerEntityDraftReviewCommands(registrar, {
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

const coordinates = {
  projectId: 'project-review', episodeId: 'episode-review',
  storyboardRevisionId: 'storyboard-review', frameId: 'frame-review',
  promptIrId: 'prompt-review', draftId: 'draft-review',
}

function receipt() {
  return {
    schema: 'jason.qingmu-entity-draft-human-review-receipt.v1', ...coordinates,
    decision: 'accepted', status: 'Accepted', reviewIdentity: REVIEW_SHA, requestSha256: SHA,
    idempotencyKey: 'entity-review-command-1',
    reviewerUserId: 'owner', naturalPersonId: 'person-owner', reviewedAt: '2026-09-02T00:00:00Z',
    intentSessionSha256: SHA, intentBindingSha256: SHA, bindingSha256: SHA,
    binding: {
      schema: 'jason.qingmu-entity-draft-human-review-binding.v1', ...coordinates,
      frameContentSha256: SHA, promptIrVersion: 2, promptIrContentSha256: SHA,
      contextSnapshotSha256: SHA, entityDraftId: coordinates.draftId, entityDraftVersion: 1,
      entityDraftContentSha256: SHA, entityType: 'scene', entityId: 'scene-review',
      profileRevision: 3, profileSnapshotSha256: SHA, referencePackId: 'pack-review',
      referencePackVersion: 1, referencePackSha256: SHA,
      canonicalAssetId: 'asset-review', referenceAssetIds: ['asset-review'],
      referenceBindingSha256: SHA,
    },
    providerCalls: 0, taskMutation: false, outboxEvents: 0,
  }
}

describe('PromptIR entity-draft review command bridge', () => {
  it('uses cookie-only intent then commit and recovers an ambiguous commit by GET', async () => {
    let commitCalls = 0
    const upstream = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof URL ? input.href : String(input))
      const headers = new Headers(init?.headers)
      expect(headers.get('cookie')).toBe('jason_token=human-cookie')
      expect(headers.get('authorization')).toBeNull()
      if (url.pathname.endsWith('/intent')) return Response.json({
        schema: 'jason.qingmu-human-authority-intent.v1',
        action: 'entity_draft_human_review.record', proof: 'sealed-proof', requestSha256: SHA,
      })
      if (url.pathname.endsWith('/receipt')) return Response.json(receipt())
      commitCalls += 1
      expect(headers.get('x-qingmu-human-intent')).toBe('sealed-proof')
      return Response.json({ code: 'connection_result_unknown' }, { status: 503 })
    })
    const base = await host(upstream)
    const query = new URLSearchParams(coordinates)
    const response = await fetch(
      `${base}/api/qingmu/entity-draft-human-review/decision?${query}`,
      { method: 'POST', headers: {
        origin: base, cookie: 'jason_token=human-cookie', 'content-type': 'application/json',
      }, body: JSON.stringify({
        decision: 'accepted', note: null, confirmed: true,
        idempotencyKey: 'entity-review-command-1',
      }) },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'Accepted', requestSha256: SHA })
    expect(commitCalls).toBe(1)
    expect(upstream).toHaveBeenCalledTimes(3)

    const bearer = await fetch(
      `${base}/api/qingmu/entity-draft-human-review/decision?${query}`,
      { method: 'POST', headers: {
        origin: base, cookie: 'jason_token=human-cookie', authorization: 'Bearer launcher',
        'content-type': 'application/json',
      }, body: JSON.stringify({
        decision: 'accepted', note: null, confirmed: true,
        idempotencyKey: 'entity-review-command-2',
      }) },
    )
    expect(bearer.status).toBe(403)
  })

  it('rejects a recovered receipt whose source binding does not match the route', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(input instanceof URL ? input.href : String(input))
      if (url.pathname.endsWith('/intent')) return Response.json({
        schema: 'jason.qingmu-human-authority-intent.v1', action: 'entity_draft_human_review.record',
        proof: 'sealed-proof', requestSha256: SHA,
      })
      if (url.pathname.endsWith('/receipt')) return Response.json({
        ...receipt(), binding: { ...receipt().binding, frameId: 'frame-other' },
      })
      return Response.json({ code: 'connection_result_unknown' }, { status: 503 })
    })
    const base = await host(upstream)
    const response = await fetch(
      `${base}/api/qingmu/entity-draft-human-review/decision?${new URLSearchParams(coordinates)}`,
      { method: 'POST', headers: {
        origin: base, cookie: 'jason_token=human-cookie', 'content-type': 'application/json',
      }, body: JSON.stringify({
        decision: 'accepted', note: null, confirmed: true,
        idempotencyKey: 'entity-review-command-1',
      }) },
    )
    expect(response.status).toBe(409)
  })
})
