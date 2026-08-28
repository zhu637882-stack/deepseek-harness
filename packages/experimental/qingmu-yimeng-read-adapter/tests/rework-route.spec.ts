import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  reworkRouteFeed, reworkRouteRequest, reworkRouteResult, reworkRouteSha, reworkRouteSubject,
} from './rework-route-fixture.ts'

const request = reworkRouteRequest()
const signal = () => new AbortController().signal

function reader(value: unknown, token: string | undefined = 'host-route-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return {
    fetch,
    handler: createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => token },
    ),
  }
}

describe('current bounded rework route source', () => {
  it('sends one authenticated GET bound to all three current rule generations', async () => {
    const feed = reworkRouteFeed(request)
    const { fetch, handler } = reader(feed)
    expect(await handler('reworkRouteSource', request, signal())).toEqual({ ok: true, value: feed })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:18815/api/qingmu/projects/route-project/episodes/route-episode/'
      + 'shots/frame-7/findings/finding-7/rework-route/source?'
      + `routeRulesSha256=${request.routeRulesSha256}&planRulesSha256=${request.planRulesSha256}`
      + `&lockRulesSha256=${request.lockRulesSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-route-token')
    expect(init?.body).toBeUndefined()
  })

  it('retains history separately while proving only an exact current route', async () => {
    const latestRoute = reworkRouteResult(request)
    const feed = { ...reworkRouteFeed(request), latestRoute, latestRouteSourceCurrent: true }
    const { handler } = reader(feed)
    expect(await handler('reworkRouteSource', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('rejects historical route lineage when the outbox event differs from the route event', async () => {
    const original = reworkRouteResult(request)
    const latestRoute = { ...original, outboxEventId: 'event-route-other' }
    const feed = { ...reworkRouteFeed(request), latestRoute, latestRouteSourceCurrent: true }
    const { handler } = reader(feed)
    expect(await handler('reworkRouteSource', request, signal())).toMatchObject({ ok: false })
  })

  it.each([
    ['closed Finding claim', { findingClosed: true }],
    ['selection mutation claim', { selectionChanged: true }],
    ['Stage mutation claim', { stageDecisionChanged: true }],
    ['lock invalidation claim', { lockInvalidated: true }],
    ['task creation claim', { taskCreated: true }],
    ['Provider call', { providerCalls: 1 }],
    ['rework execution', { reworkExecuted: true }],
    ['signoff inference', { humanSignoffInferred: true }],
    ['route-rule drift', { currentRouteRulesSha256: '0'.repeat(64) }],
  ])('rejects %s', async (_name, change) => {
    const { handler } = reader({ ...reworkRouteFeed(request), ...change })
    expect(await handler('reworkRouteSource', request, signal())).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
  })

  it('rejects a self-rehashed subject with a closed or different Finding', async () => {
    const original = reworkRouteSubject()
    for (const finding of [
      { ...original.finding, status: 'CLOSED' },
      { ...original.finding, id: 'finding-other' },
    ]) {
      const subject = { ...original, finding }
      const feed = { ...reworkRouteFeed(request), subject, subjectSnapshotSha256: reworkRouteSha(subject) }
      const { handler } = reader(feed)
      expect(await handler('reworkRouteSource', request, signal())).toMatchObject({ ok: false })
    }
  })

  it('rejects a forged current-history claim after rule or subject drift', async () => {
    const latestRoute = reworkRouteResult(request)
    const subject = reworkRouteSubject()
    const changedFinding = { ...subject.finding, observation: '新的缺陷描述' }
    const changed = { ...subject, finding: changedFinding }
    const feed = {
      ...reworkRouteFeed(request), subject: changed, subjectSnapshotSha256: reworkRouteSha(changed),
      latestRoute, latestRouteSourceCurrent: true,
    }
    const { handler } = reader(feed)
    expect(await handler('reworkRouteSource', request, signal())).toMatchObject({ ok: false })
  })

  it('rejects caller authority fields before network and fails closed without a token', async () => {
    const { fetch, handler } = reader(reworkRouteFeed(request))
    for (const extra of [{ methodProjection: {} }, { actorId: 'owner' }, { executeRework: true }]) {
      expect(await handler('reworkRouteSource', { ...request, ...extra }, signal())).toMatchObject({
        ok: false, error: { code: 'bad-request' },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
    const missing = reader(reworkRouteFeed(request), '')
    expect(await missing.handler('reworkRouteSource', request, signal())).toMatchObject({ ok: false })
    expect(missing.fetch).not.toHaveBeenCalled()
  })
})
