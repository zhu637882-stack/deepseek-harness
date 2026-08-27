import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createYimengCommandHandler, type YimengCommandAdapterDependencies,
} from '../src/index.ts'
import type { YimengForwardedLsuPlanAuthorityProbeRequest } from '../src/types.ts'
import {
  lsuPlanAuthorityProbe, lsuPlanCommandResult, lsuPlanMethodResponse, lsuPlanProbeRequest,
  lsuPlanRecovery, lsuPlanSealRequest,
} from './lsu-plan-fixture.ts'

const KEY = 'lsu-plan-command-test-key-'.repeat(3)
const TOKEN = 'lsu-plan-command-token'
const signal = () => new AbortController().signal
type MethodRunner = NonNullable<YimengCommandAdapterDependencies['runLsuPlanMethod']>

function network(value: unknown, status = 200): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
}

function handler(
  fetch: typeof globalThis.fetch,
  readToken = () => TOKEN,
  runLsuPlanMethod: MethodRunner = async () => ({ ok: true, value: lsuPlanMethodResponse(KEY) }),
) {
  return createYimengCommandHandler({}, { fetch, readToken, runLsuPlanMethod })
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('LSU plan seal, receipt recovery, and authority probe', () => {
  it('sends one exact seal POST after a fresh Host Method and no browser identity authority', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const expected = lsuPlanCommandResult(request, method, TOKEN)
    const run = vi.fn<MethodRunner>(async () => ({ ok: true, value: method }))
    const fetch = network(expected, 201)
    expect(await handler(fetch, () => TOKEN, run)('sealLsuPlan', request, signal())).toEqual({
      ok: true, value: expected,
    })
    expect(run).toHaveBeenCalledExactlyOnceWith(
      { projectId: request.projectId, episodeId: request.episodeId }, expect.any(AbortSignal),
    )
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/plan-project/episodes/plan-episode/lsu-plan/seals')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    if (typeof init?.body !== 'string') throw new Error('serialized seal body required')
    expect(JSON.parse(init.body)).toEqual({
      expectedSubjectSha256: request.expectedSubjectSha256,
      expectedPlanRevision: 0,
      expectedPlanSha256: null,
      methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256,
      methodAttestation: method.methodAttestation,
      idempotencyKey: request.idempotencyKey,
    })
    expect(init.body).not.toContain('actorNaturalPersonId')
    expect(init.body).not.toContain('authSessionId')
    expect(expected).toMatchObject({
      planSealed: true, stageApprovalGranted: false, lockActivated: false, providerCalls: 0,
      humanSignoffInferred: false, reworkExecuted: false,
    })
  })

  it('recovers the original receipt with GET only after the key and token rotate', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const receipt = lsuPlanCommandResult(request, method, TOKEN)
    const expected = lsuPlanRecovery(request, receipt)
    const run = vi.fn<MethodRunner>()
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const fetch = network(expected)
    expect(await handler(fetch, () => 'rotated-token', run)(
      'recoverLsuPlanSeal', request, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(run).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/plan-project/episodes/plan-episode/'
      + `lsu-plan/seal-command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}&expectedPlanRevision=0`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('probes authority only through a newly compiled current Method', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanProbeRequest()
    const sealRequest = lsuPlanSealRequest(method)
    const receipt = lsuPlanCommandResult(sealRequest, method, TOKEN)
    const forwarded: YimengForwardedLsuPlanAuthorityProbeRequest = {
      ...request, methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256, methodAttestation: method.methodAttestation,
    }
    const expected = lsuPlanAuthorityProbe(forwarded, receipt)
    const run = vi.fn<MethodRunner>(async () => ({ ok: true, value: method }))
    const fetch = network(expected)
    expect(await handler(fetch, () => TOKEN, run)(
      'probeLsuPlanAuthority', request, signal(),
    )).toEqual({ ok: true, value: expected })
    expect(run).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal))
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/plan-project/episodes/plan-episode/'
      + 'lsu-plan/authority-probe')
    if (typeof init?.body !== 'string') throw new Error('serialized probe body required')
    expect(JSON.parse(init.body)).toEqual({
      methodProjection: method.projection,
      methodProjectionSha256: method.projectionSha256,
      methodAttestation: method.methodAttestation,
    })
    expect(init.body).not.toContain('idempotencyKey')
    expect(expected).toMatchObject({
      currentPlanSealed: true, planSealed: true, stageApprovalGranted: false,
      lockActivated: false, providerCalls: 0, reworkExecuted: false,
    })
  })

  it('includes the previous plan SHA in non-initial recovery coordinates', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = {
      ...lsuPlanSealRequest(method), expectedPlanRevision: 3,
      expectedPlanSha256: 'a'.repeat(64), idempotencyKey: 'lsu-plan-command-004',
    }
    const expected = lsuPlanRecovery(request, null)
    const fetch = network(expected)
    expect(await handler(fetch)('recoverLsuPlanSeal', request, signal())).toEqual({ ok: true, value: expected })
    const url = fetch.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('serialized recovery URL required')
    expect(url).toContain(`&expectedPlanSha256=${'a'.repeat(64)}`)
  })

  it('rejects caller-supplied Method, actor, approval, or mismatched initial CAS before side effects', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const base = lsuPlanSealRequest(method)
    for (const change of [
      { methodProjection: method.projection }, { actorId: 'owner' }, { approved: true },
      { expectedPlanSha256: 'a'.repeat(64) },
    ]) {
      const fetch = network({})
      const run = vi.fn<MethodRunner>()
      expect(await handler(fetch, () => TOKEN, run)('sealLsuPlan', { ...base, ...change }, signal())).toMatchObject({
        ok: false, error: { code: 'bad-request' },
      })
      expect(run).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it.each(['sealLsuPlan', 'recoverLsuPlanSeal'] as const)(
    'rejects a plan CAS revision with no safe successor before Method or network for %s',
    async (endpoint) => {
      const method = lsuPlanMethodResponse(KEY)
      const request = {
        ...lsuPlanSealRequest(method),
        expectedPlanRevision: Number.MAX_SAFE_INTEGER,
        expectedPlanSha256: 'a'.repeat(64),
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

  it('rejects a stale or forged Host Method before the seal POST', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const forged = {
      ...method,
      projection: { ...method.projection, subjectSnapshotSha256: '0'.repeat(64) },
    }
    const fetch = network({})
    const run: MethodRunner = async () => ({ ok: true, value: forged })
    expect(await handler(fetch, () => TOKEN, run)('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'wrong sealed revision', change: { seal: { revision: 2 } } },
    { name: 'Stage approval', change: { stageApprovalGranted: true } },
    { name: 'lock activation', change: { lockActivated: true } },
    { name: 'Provider call', change: { providerCalls: 1 } },
    { name: 'human signoff', change: { humanSignoffInferred: true } },
    { name: 'rework execution', change: { reworkExecuted: true } },
  ])('rejects a response claiming $name', async ({ change }) => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const original = lsuPlanCommandResult(request, method, TOKEN)
    const value = 'seal' in change
      ? { ...original, seal: { ...original.seal, ...change.seal } }
      : { ...original, ...change }
    expect(await handler(network(value, 201))('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
  })

  it('rejects any current credential reflected in an otherwise valid response', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const original = lsuPlanCommandResult(request, method, TOKEN)
    const reflected = { ...original, receiptId: TOKEN }
    expect(await handler(network(reflected, 201))('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
  })

  it('fails closed without token, Method, or attestation key and discards late Method cancellation', async () => {
    const method = lsuPlanMethodResponse(KEY)
    const request = lsuPlanSealRequest(method)
    const fetch = network({})
    expect(await handler(fetch, () => '')('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
    const withoutMethod = createYimengCommandHandler({}, { fetch, readToken: () => TOKEN })
    expect(await withoutMethod('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    expect(await handler(fetch)('sealLsuPlan', request, signal())).toMatchObject({ ok: false })
    const controller = new AbortController()
    const cancelled: MethodRunner = async () => {
      controller.abort()
      return { ok: true, value: method }
    }
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    expect(await handler(fetch, () => TOKEN, cancelled)(
      'sealLsuPlan', request, controller.signal,
    )).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
