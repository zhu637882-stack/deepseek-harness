import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  LSU_PLAN_IDS, LSU_PLAN_LOCK_RULES_SHA256, lsuPlanFeed, lsuPlanSealResult, lsuPlanSha, lsuPlanSubject,
} from './lsu-plan-fixture.ts'

const request = { ...LSU_PLAN_IDS, lockRulesSha256: LSU_PLAN_LOCK_RULES_SHA256 }
const signal = () => new AbortController().signal

function reader(value: unknown, token: string | undefined = 'host-plan-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return {
    fetch,
    handler: createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => token },
    ),
  }
}

describe('current LSU plan source', () => {
  it('sends one authenticated GET bound to the current lock-rule generation', async () => {
    const feed = lsuPlanFeed()
    const { fetch, handler } = reader(feed)
    expect(await handler('lsuPlanSource', request, signal())).toEqual({ ok: true, value: feed })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:18815/api/qingmu/projects/plan-project/episodes/plan-episode/'
      + `lsu-plan/source?lockRulesSha256=${LSU_PLAN_LOCK_RULES_SHA256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-plan-token')
    expect(init?.body).toBeUndefined()
  })

  it('retains an exact historical seal while qualifying its source separately', async () => {
    const subject = lsuPlanSubject()
    const latestSeal = lsuPlanSealResult({ subject, lockRulesSha256: LSU_PLAN_LOCK_RULES_SHA256 })
    const feed = { ...lsuPlanFeed(), latestSeal, latestSealSourceCurrent: true }
    const { handler } = reader(feed)
    expect(await handler('lsuPlanSource', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('keeps history readable when the current complete scope is unavailable', async () => {
    const feed = {
      ...lsuPlanFeed(), subject: null, subjectSnapshotSha256: null,
      availability: { status: 'unavailable' as const, reason: 'production_blueprint_lock_not_current' },
      latestSeal: lsuPlanSealResult(), latestSealSourceCurrent: false,
    }
    const { handler } = reader(feed)
    expect(await handler('lsuPlanSource', request, signal())).toEqual({ ok: true, value: feed })
  })

  it.each([
    { name: 'extra approval authority', change: { humanSignoffInferred: true } },
    { name: 'cross-project source', change: { projectId: 'other-project' } },
    { name: 'different lock generation', change: { currentLockRulesSha256: '8'.repeat(64) } },
    { name: 'incorrect subject SHA', change: { subjectSnapshotSha256: '0'.repeat(64) } },
    { name: 'Stage approval', change: { stageApprovalGranted: true } },
    { name: 'lock activation', change: { lockActivated: true } },
    { name: 'Provider use', change: { providerCalls: 1 } },
    { name: 'rework execution', change: { reworkExecuted: true } },
  ])('rejects $name', async ({ change }) => {
    const { handler } = reader({ ...lsuPlanFeed(), ...change })
    expect(await handler('lsuPlanSource', request, signal())).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
  })

  it('rejects a self-rehashed incomplete, duplicate, or unsorted current scope', async () => {
    const original = lsuPlanSubject()
    const invalid = [
      { ...original, productionUnits: [] },
      { ...original, productionUnits: [original.productionUnits[0], original.productionUnits[0]] },
      { ...original, productionUnits: [...original.productionUnits].reverse() },
    ]
    for (const subject of invalid) {
      const feed = { ...lsuPlanFeed(), subject, subjectSnapshotSha256: lsuPlanSha(subject) }
      const { handler } = reader(feed)
      expect(await handler('lsuPlanSource', request, signal())).toMatchObject({ ok: false })
    }
  })

  it('rejects a forged current-seal claim after either source or lock rules change', async () => {
    const changed = lsuPlanSubject()
    const productionUnits = changed.productionUnits.map((unit, index) => index === 0
      ? { ...unit, bindingRevision: unit.bindingRevision + 1, bindingSha256: '6'.repeat(64) }
      : unit)
    const subject = { ...changed, productionUnits }
    const feed = {
      ...lsuPlanFeed(), subject, subjectSnapshotSha256: lsuPlanSha(subject),
      latestSeal: lsuPlanSealResult(), latestSealSourceCurrent: true,
    }
    const { handler } = reader(feed)
    expect(await handler('lsuPlanSource', request, signal())).toMatchObject({ ok: false })
  })

  it('rejects caller-supplied Method or actor fields before network access', async () => {
    const { fetch, handler } = reader(lsuPlanFeed())
    for (const extra of [{ methodProjection: {} }, { actorId: 'owner' }, { approved: true }]) {
      expect(await handler('lsuPlanSource', { ...request, ...extra }, signal())).toMatchObject({
        ok: false, error: { code: 'bad-request' },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails before the upstream without a Host token and forwards cancellation', async () => {
    const missing = reader(lsuPlanFeed(), '')
    expect(await missing.handler('lsuPlanSource', request, signal())).toMatchObject({ ok: false })
    expect(missing.fetch).not.toHaveBeenCalled()
    const cancelled = reader(lsuPlanFeed())
    const controller = new AbortController()
    controller.abort()
    expect(await cancelled.handler('lsuPlanSource', request, controller.signal)).toMatchObject({
      ok: false, error: { code: 'cancelled' },
    })
    expect(cancelled.fetch).not.toHaveBeenCalled()
  })
})
