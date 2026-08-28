import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createYimengCommandHandler, type YimengCommandAdapterDependencies,
} from '../src/index.ts'
import type { YimengForwardedReworkRouteAuthorityProbeRequest } from '../src/types.ts'
import {
  reworkRouteAuthorityProbe,
  reworkRouteCommandResult,
  reworkRouteMethodResponse,
  reworkRouteProbeRequest,
  reworkRouteRecordRequest,
  reworkRouteRecovery,
} from './rework-route-fixture.ts'

const KEY = 'rework-route-command-test-key-'.repeat(3)
const TOKEN = 'rework-route-command-token'
const signal = () => new AbortController().signal
type MethodRunner = NonNullable<YimengCommandAdapterDependencies['runReworkRouteMethod']>

function network(value: unknown, status = 200): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
}

function handler(
  fetch: typeof globalThis.fetch,
  readToken = () => TOKEN,
  runReworkRouteMethod: MethodRunner = async () => ({
    ok: true, value: reworkRouteMethodResponse(KEY),
  }),
) {
  return createYimengCommandHandler({}, { fetch, readToken, runReworkRouteMethod })
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('bounded rework route record, receipt recovery, and authority probe', () => {
  it('sends one exact route POST after a fresh Host Method and no browser identity authority', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const expected = reworkRouteCommandResult(request, method, TOKEN)
    const run = vi.fn<MethodRunner>(async () => ({ ok: true, value: method }))
    const fetch = network(expected, 201)

    expect(await handler(fetch, () => TOKEN, run)(
      'recordReworkRoute', request, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(run).toHaveBeenCalledExactlyOnceWith(
      {
        projectId: request.projectId,
        episodeId: request.episodeId,
        frameId: request.frameId,
        findingId: request.findingId,
      },
      expect.any(AbortSignal),
    )
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/route-project/episodes/route-episode/'
      + 'shots/frame-7/findings/finding-7/rework-route/routes')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    if (typeof init?.body !== 'string') throw new Error('serialized route body required')
    expect(JSON.parse(init.body)).toEqual({
      expectedSubjectSha256: request.expectedSubjectSha256,
      expectedRouteRevision: 0,
      expectedRouteSha256: null,
      methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256,
      methodAttestation: method.methodAttestation,
      idempotencyKey: request.idempotencyKey,
    })
    expect(init.body).not.toContain('actorNaturalPersonId')
    expect(init.body).not.toContain('authSessionId')
    expect(expected).toMatchObject({
      routeRecorded: true,
      findingClosed: false,
      selectionChanged: false,
      stageDecisionChanged: false,
      lockInvalidated: false,
      taskCreated: false,
      providerCalls: 0,
      reworkExecuted: false,
      humanSignoffInferred: false,
    })
  })

  it('does not retry a rejected route POST', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const fetch = network({ detail: { code: 'temporary_failure' } }, 503)

    expect(await handler(fetch)('recordReworkRoute', request, signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('recovers the original receipt with GET only after the key and token rotate', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const receipt = reworkRouteCommandResult(request, method, TOKEN)
    const expected = reworkRouteRecovery(request, receipt)
    const run = vi.fn<MethodRunner>()
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const fetch = network(expected)

    expect(await handler(fetch, () => 'rotated-token', run)(
      'recoverReworkRoute', request, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(run).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/route-project/episodes/route-episode/'
      + `shots/frame-7/findings/finding-7/rework-route/route-command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}&expectedRouteRevision=0`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('probes authority only through a newly compiled current Method', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteProbeRequest()
    const routeRequest = reworkRouteRecordRequest(method)
    const receipt = reworkRouteCommandResult(routeRequest, method, TOKEN)
    const forwarded: YimengForwardedReworkRouteAuthorityProbeRequest = {
      ...request,
      methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256,
      methodAttestation: method.methodAttestation,
    }
    const expected = reworkRouteAuthorityProbe(forwarded, receipt)
    const run = vi.fn<MethodRunner>(async () => ({ ok: true, value: method }))
    const fetch = network(expected)

    expect(await handler(fetch, () => TOKEN, run)(
      'probeReworkRouteAuthority', request, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(run).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal))
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/route-project/episodes/route-episode/'
      + 'shots/frame-7/findings/finding-7/rework-route/authority-probe')
    if (typeof init?.body !== 'string') throw new Error('serialized route probe body required')
    expect(JSON.parse(init.body)).toEqual({
      methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256,
      methodAttestation: method.methodAttestation,
    })
    expect(init.body).not.toContain('idempotencyKey')
    expect(expected).toMatchObject({
      currentRouteRecorded: true,
      routeRecorded: true,
      findingClosed: false,
      selectionChanged: false,
      stageDecisionChanged: false,
      lockInvalidated: false,
      taskCreated: false,
      providerCalls: 0,
      reworkExecuted: false,
    })
  })

  it('includes the previous route SHA in non-initial recovery coordinates', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = {
      ...reworkRouteRecordRequest(method),
      expectedRouteRevision: 3,
      expectedRouteSha256: 'a'.repeat(64),
      idempotencyKey: 'rework-route-command-004',
    }
    const expected = reworkRouteRecovery(request, null)
    const fetch = network(expected)

    expect(await handler(fetch)('recoverReworkRoute', request, signal())).toEqual({ ok: true, value: expected })
    const url = fetch.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('serialized route recovery URL required')
    expect(url).toContain(`&expectedRouteSha256=${'a'.repeat(64)}`)
  })

  it('rejects caller Method, actor, execution, approval, or mismatched initial CAS before side effects', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const base = reworkRouteRecordRequest(method)
    for (const change of [
      { methodProjection: method.projection },
      { actorId: 'owner' },
      { executeRework: true },
      { approved: true },
      { expectedRouteSha256: 'a'.repeat(64) },
    ]) {
      const fetch = network({})
      const run = vi.fn<MethodRunner>()
      expect(await handler(fetch, () => TOKEN, run)(
        'recordReworkRoute', { ...base, ...change }, signal(),
      )).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(run).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it.each(['recordReworkRoute', 'recoverReworkRoute'] as const)(
    'rejects a route CAS revision with no safe successor before Method or network for %s',
    async (endpoint) => {
      const method = reworkRouteMethodResponse(KEY)
      const request = {
        ...reworkRouteRecordRequest(method),
        expectedRouteRevision: Number.MAX_SAFE_INTEGER,
        expectedRouteSha256: 'a'.repeat(64),
      }
      const fetch = network({})
      const run = vi.fn<MethodRunner>()
      expect(await handler(fetch, () => TOKEN, run)(endpoint, request, signal())).toMatchObject({
        ok: false, error: { code: 'bad-request' },
      })
      expect(run).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects a stale or forged Host Method before the route POST', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const forged = {
      ...method,
      projection: { ...method.projection, subjectSnapshotSha256: '0'.repeat(64) },
    }
    const fetch = network({})
    const run: MethodRunner = async () => ({ ok: true, value: forged })

    expect(await handler(fetch, () => TOKEN, run)(
      'recordReworkRoute', request, signal(),
    )).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'wrong route revision', change: { route: { revision: 2 } } },
    { name: 'Finding closure', change: { findingClosed: true } },
    { name: 'selection change', change: { selectionChanged: true } },
    { name: 'Stage decision', change: { stageDecisionChanged: true } },
    { name: 'lock invalidation', change: { lockInvalidated: true } },
    { name: 'task creation', change: { taskCreated: true } },
    { name: 'Provider call', change: { providerCalls: 1 } },
    { name: 'rework execution', change: { reworkExecuted: true } },
    { name: 'human signoff', change: { humanSignoffInferred: true } },
  ])('rejects a response claiming $name', async ({ change }) => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const original = reworkRouteCommandResult(request, method, TOKEN)
    const value = 'route' in change
      ? { ...original, route: { ...original.route, ...change.route } }
      : { ...original, ...change }
    expect(await handler(network(value, 201))(
      'recordReworkRoute', request, signal(),
    )).toMatchObject({ ok: false })
  })

  it('rejects any current credential reflected in an otherwise valid response', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const original = reworkRouteCommandResult(request, method, TOKEN)
    const reflected = { ...original, receiptId: TOKEN }
    expect(await handler(network(reflected, 201))(
      'recordReworkRoute', request, signal(),
    )).toMatchObject({ ok: false })
  })

  it('rejects an otherwise valid response whose outbox event differs from the route event', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const original = reworkRouteCommandResult(request, method, TOKEN)
    const mismatched = { ...original, outboxEventId: 'event-route-record-other' }
    expect(await handler(network(mismatched, 201))(
      'recordReworkRoute', request, signal(),
    )).toMatchObject({ ok: false })
  })

  it('fails closed without token, Method, or attestation key and discards late Method cancellation', async () => {
    const method = reworkRouteMethodResponse(KEY)
    const request = reworkRouteRecordRequest(method)
    const fetch = network({})
    expect(await handler(fetch, () => '')(
      'recordReworkRoute', request, signal(),
    )).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()

    const withoutMethod = createYimengCommandHandler({}, { fetch, readToken: () => TOKEN })
    expect(await withoutMethod('recordReworkRoute', request, signal())).toMatchObject({ ok: false })

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    expect(await handler(fetch)('recordReworkRoute', request, signal())).toMatchObject({ ok: false })

    const controller = new AbortController()
    const cancelled: MethodRunner = async () => {
      controller.abort()
      return { ok: true, value: method }
    }
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    expect(await handler(fetch, () => TOKEN, cancelled)(
      'recordReworkRoute', request, controller.signal,
    )).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
