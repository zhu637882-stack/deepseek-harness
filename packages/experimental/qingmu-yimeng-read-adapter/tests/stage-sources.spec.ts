import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { STAGE_SOURCE_IDS as ids, mutateSource, sourceObject, sourceSha, stageSource, stageSourceResult, stageSourcesFeed } from './stage-source-fixture.ts'

const signal = () => new AbortController().signal
function reader(value: unknown, token: string | undefined = 'stage-source-test-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return { fetch, handler: createYimengReadHandler({}, { fetch, readToken: () => token }) }
}

describe('stage source currentness and readonly transport', () => {
  it.each([false, true])('reads full-source coordinates with no write; bound=%s', async (bound) => {
    const feed = stageSourcesFeed(stageSource(), bound ? stageSourceResult() : null)
    const { fetch, handler } = reader(feed)
    expect(await handler('stageSources', ids, signal())).toEqual({ ok: true, value: feed })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/source-project/episodes/source-episode/stage-sources')
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer stage-source-test-token')
  })
  it.each(['missing', 'revision', 'content', 'permission'])('preserves history without promoting %s evidence', async (kind) => {
    const old = stageSourceResult()
    const current = kind === 'missing' ? null : { ...stageSource(), ...(kind === 'revision' ? { revision: 4 } : {}),
      ...(kind === 'content' ? { contentSha256: 'f'.repeat(64) } : {}) }
    const feed = { ...stageSourcesFeed(current, old), canBind: kind !== 'permission' }
    expect(await reader(feed).handler('stageSources', ids, signal())).toEqual({ ok: true, value: feed })
    expect(feed.latestBinding).toEqual(old)
    if (kind !== 'permission') expect(feed.currentBinding).toBeNull()
  })
  it('retains a sealed historical method without requiring the current key or rule version', async () => {
    const old = stageSourceResult()
    mutateSource(old, 'binding.definition.version', 'old-method')
    mutateSource(old, 'binding.definition.contractSha256', 'f'.repeat(64))
    mutateSource(old, 'bindingSha256', sourceSha(old.binding))
    const feed = stageSourcesFeed(null, old)
    expect(await reader(feed).handler('stageSources', ids, signal())).toEqual({ ok: true, value: feed })
  })
  it.each([0, Number.MAX_SAFE_INTEGER])('keeps legal source revision %s independent of binding revision', async (revision) => {
    const source = { ...stageSource(), revision }
    const feed = stageSourcesFeed(source, stageSourceResult(source, 5))
    expect(await reader(feed).handler('stageSources', ids, signal())).toEqual({ ok: true, value: feed })
  })
  it.each(['\ufeff片/段', '🎬'.repeat(256)])('preserves exact Unicode IDs and URL encoding', async (episodeId) => {
    const source = { ...stageSource(), episodeId, sourceId: episodeId }
    const feed = stageSourcesFeed(source, stageSourceResult(source))
    const { fetch, handler } = reader(feed)
    expect(await handler('stageSources', { ...ids, episodeId }, signal())).toEqual({ ok: true, value: feed })
    expect(fetch.mock.calls[0]?.[0]).toContain(encodeURIComponent(episodeId))
  })
  it.each([{}, { ...ids, stageId: 'A1S' }, { ...ids, source: {} }, { ...ids, actorId: 'owner' },
    ...[' id', 'id ', '\u0085id', 'id\u001c', '', '\ud800', 'a\0b', 'a\nb', '🎬'.repeat(257)].map(episodeId => ({ ...ids, episodeId })),
  ])('rejects noncanonical request %# before fetch', async (payload) => {
    const { fetch, handler } = reader(stageSourcesFeed())
    expect(await handler('stageSources', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires the Host token and honors cancellation without a request', async () => {
    const { handler, fetch } = reader(stageSourcesFeed(), '')
    expect(await handler('stageSources', ids, signal())).toMatchObject({ ok: false })
    const abort = new AbortController()
    abort.abort()
    expect(await handler('stageSources', ids, abort.signal)).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('stage source fail-closed response contract', () => {
  const cases: [string, unknown][] = [
    ['schema', 'other'], ['projectId', 'other'], ['episodeId', 'other'], ['stageId', 'A1'], ['canBind', 1], ['approved', true],
    ['source.schema', 'other'], ['source.projectId', 'other'], ['source.episodeId', 'other'], ['source.sourceId', 'other'],
    ['source.sourceType', 'SCREENPLAY_PACKAGE'], ['source.revision', true], ['source.revision', -1], ['source.revision', 0.5],
    ['source.revision', Number.MAX_SAFE_INTEGER + 1], ['source.contentSha256', 'a'.repeat(64) + '\n'], ['source.extra', 'hidden'],
    ['subjectSnapshotSha256', 'f'.repeat(64)], ['unavailableReason', 'missing'], ['bindingRevision', 0], ['bindingSha256', null],
    ['latestBinding.schema', 'other'], ['latestBinding.binding.projectId', 'other'], ['latestBinding.binding.stageId', 'A1'],
    ['latestBinding.binding.bindingRevision', 0], ['latestBinding.binding.subjectSnapshotSha256', 'f'.repeat(64)],
    ['latestBinding.binding.stageArtifactCreated', true], ['latestBinding.binding.stageApprovalGranted', true], ['latestBinding.binding.lockActivated', true],
    ['latestBinding.binding.planSealed', true], ['latestBinding.binding.providerCalls', false], ['latestBinding.binding.humanSignoffInferred', true],
    ['latestBinding.binding.reworkExecuted', true], ['latestBinding.binding.authSessionId', ''], ['latestBinding.binding.actorId', '\u001c'],
    ['latestBinding.binding.definition.operation', 'execute'], ['latestBinding.binding.definition.scope', 'per_lsu'],
    ['latestBinding.binding.definition.stageApprovalAllowed', true], ['latestBinding.binding.definition.stageArtifactCreationAllowed', true],
    ['latestBinding.binding.definition.sourceUsage', 'artifact'], ['latestBinding.binding.definition.extra', true],
    ['latestBinding.receiptId', ''], ['latestBinding.outboxEventId', '\ud800'], ['latestBinding.bindingSha256', 'f'.repeat(64)],
    ['currentBinding', null],
  ]
  it.each(cases)('rejects tampered %s even when unrelated hashes are recomputed', async (path, value) => {
    const feed = stageSourcesFeed(stageSource(), stageSourceResult())
    mutateSource(feed, path, value)
    // Rehash semantic mutations so each validation cannot rely only on a stale checksum.
    if (path.startsWith('source.')) mutateSource(feed, 'subjectSnapshotSha256', sourceSha(feed.source))
    if (path.startsWith('latestBinding.binding.')) {
      const latest = sourceObject(feed.latestBinding)
      latest.bindingSha256 = sourceSha(latest.binding)
      mutateSource(feed, 'bindingSha256', latest.bindingSha256)
      mutateSource(feed, 'currentBinding', latest)
    }
    expect(await reader(feed).handler('stageSources', ids, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
  })
  it('refuses an old receipt as current after a content-only or revision-only source change', async () => {
    for (const source of [{ ...stageSource(), revision: 4 }, { ...stageSource(), contentSha256: 'f'.repeat(64) }]) {
      const old = stageSourceResult()
      const feed = { ...stageSourcesFeed(source, old), currentBinding: old }
      expect(await reader(feed).handler('stageSources', ids, signal())).toMatchObject({ ok: false })
    }
  })
  it.each([
    { source: null, subjectSnapshotSha256: null, unavailableReason: null },
    { source: null, subjectSnapshotSha256: 'a'.repeat(64), unavailableReason: 'missing' },
    { latestBinding: null, currentBinding: null, bindingRevision: 1 },
  ])('rejects inconsistent null/current evidence %#', async (patch) => {
    expect(await reader({ ...stageSourcesFeed(), ...patch }).handler('stageSources', ids, signal())).toMatchObject({ ok: false })
  })
})
