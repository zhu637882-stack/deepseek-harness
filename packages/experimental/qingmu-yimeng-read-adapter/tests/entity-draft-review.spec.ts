import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { registerEntityDraftReviewRead } from '../src/entity-draft-review.ts'

let server: Server | undefined
let dispose: (() => void) | undefined

const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

afterEach(async () => {
  dispose?.(); dispose = undefined
  if (server !== undefined) {
    server.close(); await once(server, 'close'); server = undefined
  }
})

async function host(fetchUpstream: typeof globalThis.fetch): Promise<string> {
  const routes = new Map<string, WebRoute>()
  const registrar = { register(route: WebRoute) {
    routes.set(route.path, route); return () => { routes.delete(route.path) }
  } } as unknown as WebServer
  dispose = registerEntityDraftReviewRead(registrar, {
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

const query = new URLSearchParams({
  projectId: 'project-review', episodeId: 'episode-review',
  storyboardRevisionId: 'storyboard-review', frameId: 'frame-review',
  promptIrId: 'prompt-review',
})
const SHA = 'a'.repeat(64)

function state() {
  const binding = {
    schema: 'jason.qingmu-entity-draft-human-review-binding.v1',
    projectId: 'project-review', episodeId: 'episode-review',
    storyboardRevisionId: 'storyboard-review', frameId: 'frame-review',
    frameContentSha256: SHA, promptIrId: 'prompt-review', promptIrVersion: 2,
    promptIrContentSha256: SHA, contextSnapshotSha256: SHA,
    entityDraftId: 'draft-review', entityDraftVersion: 1, entityDraftContentSha256: SHA,
    entityType: 'scene', entityId: 'scene-review', profileRevision: 3,
    profileSnapshotSha256: SHA, referencePackId: 'pack-review',
    referencePackVersion: 1, referencePackSha256: SHA,
    canonicalAssetId: 'asset-review', referenceAssetIds: ['asset-review'],
    referenceBindingSha256: SHA,
  }
  return {
    schema: 'jason.qingmu-entity-draft-human-review-state.v1',
    projectId: 'project-review', episodeId: 'episode-review',
    storyboardRevisionId: 'storyboard-review', frameId: 'frame-review',
    contextSnapshotSha256: SHA,
    promptIr: { id: 'prompt-review', version: 2, contentSha256: SHA, status: 'Ready' },
    identity: { actorUserId: 'owner', state: 'bound', naturalPersonId: 'person-reviewer' },
    drafts: [{
      draftId: 'draft-review', entityType: 'scene', entityId: 'scene-review',
      canonicalName: 'Station', status: 'PendingReview', contentSha256: SHA,
      facts: { elementId: 'scene-review', name: 'Station', role: 'scene' },
      reference: { assetId: 'asset-review', profileRevision: 3, profileSnapshotSha256: SHA },
      referencePackId: 'pack-review', referencePackSha256: SHA,
      binding, bindingSha256: SHA, review: null,
    }],
    pendingCount: 1, providerCalls: 0, taskMutation: false, outboxEvents: 0,
  }
}

describe('PromptIR entity-draft review read bridge', () => {
  it('forwards only the browser cookie and validates current authority', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(new URL(requestUrl(input)).pathname).toContain(
        '/prompt-irs/prompt-review/entity-drafts/review',
      )
      const headers = new Headers(init?.headers)
      expect(headers.get('cookie')).toBe('jason_token=human-cookie')
      expect(headers.get('authorization')).toBeNull()
      return Response.json(state())
    })
    const base = await host(upstream)
    const response = await fetch(`${base}/api/qingmu/entity-draft-human-review/state?${query}`, {
      headers: { cookie: 'jason_token=human-cookie; unrelated=value' },
    })
    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledOnce()

    const bearer = await fetch(`${base}/api/qingmu/entity-draft-human-review/state?${query}`, {
      headers: { cookie: 'jason_token=human-cookie', authorization: 'Bearer launcher' },
    })
    expect(bearer.status).toBe(403)
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('fails closed when a draft binding diverges from the Ready PromptIR', async () => {
    const upstream = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      ...state(), drafts: [{ ...state().drafts[0]!, binding: {
        ...state().drafts[0]!.binding, promptIrContentSha256: 'b'.repeat(64),
      } }],
    }))
    const base = await host(upstream)
    const response = await fetch(`${base}/api/qingmu/entity-draft-human-review/state?${query}`, {
      headers: { cookie: 'jason_token=human-cookie' },
    })
    expect(response.status).toBe(409)
  })
})
