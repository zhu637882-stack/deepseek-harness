import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  normalizeTakeApprovalLifecycleFeed,
} from '../src/take-approval-lifecycle.ts'
import {
  TAKE_APPROVAL_LIFECYCLE_REQUEST as request,
  takeApprovalLifecycleFixture as fixture,
} from './take-approval-lifecycle-fixture.ts'
import { takeVersionSha } from './take-version-fixture.ts'
const signal = () => new AbortController().signal

describe('takeApprovalLifecycle read adapter', () => {
  it('accepts the exact fresh source while deriving no lifecycle state in Yimeng', () => {
    const feed = fixture()
    expect(normalizeTakeApprovalLifecycleFeed(feed, request, takeVersionSha)).toEqual(feed)
    expect(feed.source.lifecycleHistory).toEqual([])
    expect(feed.boundaries.stateRequiresCurrentImagoMethod).toBe(true)
  })

  it.each(['source SHA', 'revision', 'reference', 'boundary'] as const)(
    'fails closed on forged %s', (kind) => {
      const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
      if (kind === 'source SHA') feed.sourceSnapshotSha256 = 'f'.repeat(64)
      if (kind === 'boundary') {
        (feed.boundaries as Record<string, unknown>).editIsApproval = true
      }
      if (kind === 'revision' || kind === 'reference') {
        const source = feed.source as Record<string, unknown>
        const take = (source.currentTake as Record<string, unknown>).takeSubject as Record<string, unknown>
        source.lifecycleHistory = [{
          transitionId: 'transition-1', revision: kind === 'revision' ? 2 : 1,
          action: 'INVALIDATE', takeId: take.takeId,
          takeVersionOrdinal: take.versionOrdinal,
          takeSubjectSha256: (source.currentTake as Record<string, unknown>).takeSubjectSha256,
          decisionId: null, decisionEventId: null, assessmentId: null,
          assessmentEventId: null, sourceApprovalId: 'missing-approval', sourceReworkId: null,
          defectClassCodes: [], reason: '记录失效。', actorId: 'director-1',
          actorRole: 'director', actorNaturalPersonId: 'person-1', authSessionId: 'a'.repeat(64),
          recordedAt: '2026-08-29T08:00:00+00:00', eventId: 'event-1',
          methodProjectionSha256: 'b'.repeat(64), rulesSha256: 'c'.repeat(64),
        }]
        feed.sourceSnapshotSha256 = takeVersionSha(source)
      }
      expect(() => normalizeTakeApprovalLifecycleFeed(feed, request, takeVersionSha)).toThrow()
    },
  )

  it('fails closed when the current decision names the Take but binds a stale subject SHA', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const source = feed.source as Record<string, unknown>
    const current = source.currentTake as Record<string, unknown>
    const take = current.takeSubject as Record<string, unknown>
    source.currentDecision = {
      decisionId: 'decision-1', eventId: 'decision-event-1', takeId: take.takeId,
      takeVersionOrdinal: take.versionOrdinal, takeSubjectSha256: '0'.repeat(64),
      decision: 'approve', actorId: 'approver-1', actorNaturalPersonId: 'person-approver-1',
    }
    feed.sourceSnapshotSha256 = takeVersionSha(source)
    expect(() => normalizeTakeApprovalLifecycleFeed(feed, request, takeVersionSha)).toThrow(
      'source.currentDecision Take binding mismatch',
    )
  })

  it('fails closed when an approval history event was authored by a director', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const source = feed.source as Record<string, unknown>
    const current = source.currentTake as Record<string, unknown>
    const take = current.takeSubject as Record<string, unknown>
    source.lifecycleHistory = [{
      transitionId: 'approval-1', revision: 1, action: 'APPROVE', takeId: take.takeId,
      takeVersionOrdinal: take.versionOrdinal, takeSubjectSha256: current.takeSubjectSha256,
      decisionId: 'decision-1', decisionEventId: 'decision-event-1',
      assessmentId: 'assessment-1', assessmentEventId: 'assessment-event-1',
      sourceApprovalId: null, sourceReworkId: null, defectClassCodes: [],
      reason: '批准当前精确 Take。', actorId: 'director-1', actorRole: 'director',
      actorNaturalPersonId: 'person-director-1', authSessionId: 'a'.repeat(64),
      recordedAt: '2026-08-29T08:00:00+00:00', eventId: 'event-approval-1',
      methodProjectionSha256: 'b'.repeat(64), rulesSha256: 'c'.repeat(64),
    }]
    feed.sourceSnapshotSha256 = takeVersionSha(source)
    expect(() => normalizeTakeApprovalLifecycleFeed(feed, request, takeVersionSha)).toThrow(
      'action fields mismatch',
    )
  })

  it('fails closed when a resubmission history event was authored by an approver', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const source = feed.source as Record<string, unknown>
    const current = source.currentTake as Record<string, unknown>
    const take = current.takeSubject as Record<string, unknown>
    const common = {
      takeId: take.takeId, takeVersionOrdinal: take.versionOrdinal,
      takeSubjectSha256: current.takeSubjectSha256, sourceApprovalId: null,
      authSessionId: 'a'.repeat(64), methodProjectionSha256: 'b'.repeat(64),
      rulesSha256: 'c'.repeat(64),
    }
    source.lifecycleHistory = [{
      ...common, transitionId: 'rework-1', revision: 1, action: 'REQUEST_REWORK',
      decisionId: 'decision-1', decisionEventId: 'decision-event-1',
      assessmentId: null, assessmentEventId: null, sourceReworkId: null,
      defectClassCodes: ['DEFECT-A'], reason: '按缺陷回到最早责任岗位。',
      actorId: 'approver-1', actorRole: 'approver',
      actorNaturalPersonId: 'person-approver-1',
      recordedAt: '2026-08-29T08:00:00+00:00', eventId: 'event-rework-1',
    }, {
      ...common, transitionId: 'resubmit-1', revision: 2, action: 'RESUBMIT',
      decisionId: null, decisionEventId: null, assessmentId: null, assessmentEventId: null,
      sourceReworkId: 'rework-1', defectClassCodes: [], reason: '提交新的 Take 修订。',
      actorId: 'approver-1', actorRole: 'approver',
      actorNaturalPersonId: 'person-approver-1',
      recordedAt: '2026-08-29T08:01:00+00:00', eventId: 'event-resubmit-1',
    }]
    feed.sourceSnapshotSha256 = takeVersionSha(source)
    expect(() => normalizeTakeApprovalLifecycleFeed(feed, request, takeVersionSha)).toThrow(
      'action fields mismatch',
    )
  })

  it('uses one authenticated encoded GET and rejects browser authority fields', async () => {
    const encoded = { ...request, frameId: 'frame/one?two#three' }
    const response = fixture() as unknown as Record<string, unknown>
    response.frameId = encoded.frameId
    const source = response.source as Record<string, unknown>
    source.frameId = encoded.frameId
    const current = source.currentTake as Record<string, unknown>
    const subject = current.takeSubject as Record<string, unknown>
    subject.frameId = encoded.frameId
    current.takeSubjectSha256 = takeVersionSha(subject)
    response.sourceSnapshotSha256 = takeVersionSha(source)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'host-token' },
    )
    expect(await handler('takeApprovalLifecycle', encoded, signal())).toMatchObject({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame%2Fone%3Ftwo%23three/take-approval-lifecycle',
    )
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })

    fetch.mockClear()
    expect(await handler('takeApprovalLifecycle', { ...request, methodProjection: {} }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
