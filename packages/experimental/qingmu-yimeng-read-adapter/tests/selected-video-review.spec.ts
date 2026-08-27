import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { normalizeSelectedVideoReview } from '../src/selected-video-review.ts'
import type { YimengSelectedVideoReviewRequest } from '../src/types.ts'
import { videoCandidatesFixture, VIDEO_REVIEW_REQUEST as request } from './selected-video-review-fixture.ts'

type MutableObject = Record<string, unknown>
const normalize = (value: unknown) => normalizeSelectedVideoReview(value, request)
function editable(status: 'accepted' | 'rejected' = 'accepted') {
  const root = videoCandidatesFixture(request, status)
  const asset = root.items[0]
  if (asset?.formalReview === null || asset?.formalReview === undefined) throw new Error('fixture review missing')
  return { root, asset: asset as MutableObject, review: asset.formalReview as MutableObject }
}
function handler(value: unknown, token: string | undefined = 'fixture-host-only-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return { fetch, call: createYimengReadHandler({ baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => token }) }
}

describe('selected video review read projection', () => {
  it('retains an original rejection and zero/fractional/absent timecodes even when every checklist item is true', () => {
    const result = normalize(videoCandidatesFixture())
    expect(result).toMatchObject({ ...request, selectedAssetId: 'video-frame-a', readOnly: true, providerCalls: 0,
      taskMutation: false, budgetMutation: false, humanSignoffInferred: false,
      selected: { formalReviewStatus: 'rejected', formalReviewAccepted: false, version: 2,
        formalReview: { decision: 'rejected', storyboardRevision: 3 } } })
    expect(result.selected?.formalReview?.defects?.map(item => item.timecodeSec)).toEqual([0, 1.25, null])
    expect(result.selected?.formalReview?.defects?.[0]?.note).toBe('开场怀表位置与上一镜不符。')
    const serialized = JSON.stringify(result)
    for (const excluded of ['videoUrl', 'thumbnailUrl', 'createdAt', 'updatedAt', 'estimatedCny', 'idempotencyKey',
      'authSessionId', 'severity', 'earliestOwner', 'decidedAt']) expect(serialized).not.toContain(`"${excluded}"`)
  })

  it.each(['accepted', 'pending', 'stale', 'invalid'] as const)('retains the existing %s state without turning it into a new signoff', (status) => {
    const result = normalize(videoCandidatesFixture(request, status))
    expect(result.selected?.formalReviewStatus).toBe(status)
    expect(result.selected?.formalReviewAccepted).toBe(status === 'accepted')
    expect(result.humanSignoffInferred).toBe(false)
    if (status !== 'accepted') expect(result.selected?.formalReview).toBeNull()
    // The API's invalid file branch can return a stored asset hash; retaining it does not verify bytes.
    expect(result.selected?.sha256).toBe('a'.repeat(64))
  })

  it('distinguishes no selected asset from a pending selected asset, ignoring unselected historic approvals', () => {
    const source = videoCandidatesFixture(request, 'accepted')
    expect(normalize({ ...source, selectedAssetId: null, items: source.items.map(item => ({
      ...item, isSelected: false, selectionStatus: 'Selected',
    })) }).selected).toBeNull()
    expect(normalize({ ...request, selectedAssetId: null, items: [] }).selected).toBeNull()
  })

  it('retains legacy frame-time binding and absent optional evidence without fabricating missing facts', () => {
    const { root, review } = editable()
    delete review.frameContentSha256
    delete review.defects
    delete review.reviewNote
    delete review.reasonCode
    delete review.machineFailureExceptionAccepted
    expect(normalize(root).selected?.formalReview).toMatchObject({
      frameContentSha256: null, defects: null, reviewNote: null, reasonCode: null, machineFailureExceptionAccepted: false,
    })
  })

  it.each([true, false])('does not infer machine quality from an existing machine-failure exception with qualityPassed=%s', (quality) => {
    const { root, asset, review } = editable()
    asset.qualityPassed = quality
    review.machineFailureExceptionAccepted = true
    review.reasonCode = 'formal_video_machine_failure_exception'
    expect(normalize(root).selected?.formalReview?.machineFailureExceptionAccepted).toBe(true)
    expect(normalize(root).selected?.formalReviewStatus).toBe('accepted')
  })

  it.each(['projectId', 'episodeId', 'frameId'] as const)('rejects a different root %s', (field) => {
    expect(() => normalize({ ...videoCandidatesFixture(), [field]: 'another-subject' })).toThrow('subject')
  })

  it.each(['projectId', 'episodeId', 'frameId', 'formalVideoAssetId', 'assetSha256', 'decision', 'version', 'reviewScope'] as const)(
    'rejects a different review %s', (field) => {
      const { root, review } = editable()
      review[field] = field === 'assetSha256' ? 'c'.repeat(64) : 'another-subject'
      expect(() => normalize(root)).toThrow('mismatch')
    },
  )

  it.each(['selected-id', 'none-with-selected', 'multiple', 'duplicate-id', 'selection-status', 'selected-flag'] as const)(
    'rejects %s selection ambiguity', (kind) => {
      const source = videoCandidatesFixture()
      const first = source.items[0]
      if (first === undefined) throw new Error('fixture missing')
      const changed = { ...source,
        ...(kind === 'selected-id' ? { selectedAssetId: 'not-in-items' } : {}),
        ...(kind === 'none-with-selected' ? { selectedAssetId: null } : {}),
        items: kind === 'multiple' || kind === 'duplicate-id' ? [first, { ...first,
          assetId: kind === 'multiple' ? 'other-video' : first.assetId }]
          : [{ ...first, ...(kind === 'selection-status' ? { selectionStatus: 'Unselected' } : {}),
            ...(kind === 'selected-flag' ? { isSelected: false } : {}) }],
      }
      expect(() => normalize(changed)).toThrow()
    },
  )

  it.each([
    ['accepted boolean', 'formalReviewAccepted', false], ['unknown status', 'formalReviewStatus', 'passed'],
    ['accepted blocker', 'formalReviewBlockerCode', 'formal_video_human_review_required'],
    ['asset SHA', 'sha256', null], ['asset version', 'version', true], ['duration', 'durationSec', -1],
  ])('rejects contradictory or malformed %s', (_name, field, value) => {
    const { root, asset } = editable()
    asset[field] = value
    expect(() => normalize(root)).toThrow()
  })

  it.each([
    ['playbackProgress', true], ['playbackProgress', 0.89], ['playbackProgress', Number.NaN], ['playbackProgress', 1.1],
    ['storyboardRevision', 0.5], ['storyboardRevision', Number.MAX_SAFE_INTEGER + 1], ['storyboardRevision', true],
    ['frameContentSha256', 'invalid'], ['reviewer', ''], ['frameUpdatedAt', ''],
    ['machineFailureExceptionAccepted', 'true'], ['machineFailureExceptionAccepted', null],
  ])('rejects invalid review %s=%s', (field, value) => {
    const { root, review } = editable()
    review[field] = value
    expect(() => normalize(root)).toThrow()
  })

  it('rejects incomplete accepted checks, malformed defect timecodes, and contradictory exception flags', () => {
    const accepted = editable()
    accepted.review.checks = { identityContinuityAccepted: true }
    expect(() => normalize(accepted.root)).toThrow('acceptance')
    const rejected = editable('rejected')
    rejected.review.defects = [{ defectType: 'scene', timecodeSec: true, note: 'source note' }]
    expect(() => normalize(rejected.root)).toThrow('number')
    rejected.review.defects = []
    rejected.review.machineFailureExceptionAccepted = true
    expect(() => normalize(rejected.root)).toThrow('exception')
  })

  it('never retains an accepted record under stale or pending status', () => {
    const current = videoCandidatesFixture(request, 'accepted').items[0]?.formalReview
    for (const status of ['pending', 'stale', 'invalid'] as const) {
      const root = videoCandidatesFixture(request, status)
      expect(() => normalize({ ...root, items: root.items.map(item => ({ ...item, formalReview: current })) })).toThrow('absent')
    }
  })
})

describe('selected video review Host route', () => {
  it('uses only the existing encoded GET and Host token, stripping media and unrelated fields', async () => {
    const encoded: YimengSelectedVideoReviewRequest = { ...request, frameId: 'frame/one?two#three' }
    const h = handler(videoCandidatesFixture(encoded))
    const result = await h.call('selectedVideoReview', encoded, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { ...encoded, readOnly: true } })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:18815/api/frames/frame%2Fone%3Ftwo%23three/video-candidates')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-host-only-token')
    expect(new Headers(init?.headers).has('cookie')).toBe(false)
    expect(init?.body).toBeUndefined()
  })

  it.each(['extra-url', 'decision', 'missing-frame', 'missing-token'] as const)('rejects %s before any upstream call', async (kind) => {
    const h = handler(videoCandidatesFixture(), kind === 'missing-token' ? '' : 'fixture-host-only-token')
    const payload = kind === 'extra-url' ? { ...request, url: 'https://not-allowed.invalid' }
      : kind === 'decision' ? { ...request, decision: 'accepted' }
        : kind === 'missing-frame' ? { projectId: request.projectId, episodeId: request.episodeId } : request
    expect(await h.call('selectedVideoReview', payload, new AbortController().signal)).toMatchObject({ ok: false })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('scrubs token echoes in notes and returns no unsafe raw contract body on failures', async () => {
    const { root, review } = editable('rejected')
    review.reviewNote = 'note fixture-host-only-token'
    const h = handler(root)
    expect(JSON.stringify(await h.call('selectedVideoReview', request, new AbortController().signal)))
      .not.toContain('fixture-host-only-token')
    const invalid = handler({ ...root, projectId: 'fixture-host-only-token' })
    const result = await invalid.call('selectedVideoReview', request, new AbortController().signal)
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).not.toContain('fixture-host-only-token')
  })

  it('propagates request cancellation to the existing read transport', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('cancelled', 'AbortError')) })
    }))
    const call = createYimengReadHandler({}, { fetch, readToken: () => 'fixture-host-only-token' })
    const controller = new AbortController()
    const result = call('selectedVideoReview', request, controller.signal)
    controller.abort()
    expect(await result).toMatchObject({ ok: false })
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})
