import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  TAKE_COMMENT_SCOPE,
  takeCommentSha,
  takeCommentSubject,
} from './take-comment-fixture.ts'

const signal = () => new AbortController().signal

function feed() {
  const takeSubject = takeCommentSubject()
  const takeSubjectSha256 = takeCommentSha(takeSubject)
  const recommendation = {
    id: 'take-review-recommendation-1',
    takeSubject,
    takeSubjectSha256,
    actorId: 'reviewer-user',
    actorRole: 'reviewer' as const,
    actorNaturalPersonId: 'person-reviewer',
    authSessionId: '8'.repeat(64),
    eventId: 'take-review-recommendation-event-1',
    recommendation: 'request_changes' as const,
    reason: '表演节奏需要更清晰。',
    recommendedAt: '2026-08-28T10:03:00.123456+00:00',
    currentBinding: true,
  }
  const decision = {
    decisionId: 'take-human-decision-1',
    subjectType: 'shot_take' as const,
    subjectId: takeSubject.takeId,
    subjectRevision: takeSubject.versionOrdinal,
    subjectSha256: takeSubjectSha256,
    takeSubject,
    takeSubjectSha256,
    actorId: 'approver-user',
    actorRole: 'approver' as const,
    actorNaturalPersonId: 'person-approver',
    authSessionId: '9'.repeat(64),
    eventId: 'take-human-decision-event-1',
    decision: 'approve' as const,
    reason: '当前精确版本可以进入下一人工环节。',
    producerActorId: 'producer-user',
    producerNaturalPersonId: 'person-producer',
    participantNaturalPersonIds: ['person-editor', 'person-producer'],
    decidedAt: '2026-08-28T10:05:00.123456+00:00',
    currentBinding: true,
  }
  return {
    schema: 'jason.qingmu-take-review-authority-feed.v1' as const,
    ...TAKE_COMMENT_SCOPE,
    capabilities: { canReview: true, canDecide: true },
    versions: [{ takeSubject, takeSubjectSha256 }],
    recommendations: [recommendation],
    decisions: [decision],
    currentDecision: decision,
    boundaries: {
      reviewerRecommendationIsApproval: false as const,
      decisionMutatesTakeState: false as const,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false as const,
    },
  }
}

describe('Take review authority read projection', () => {
  it('keeps Reviewer advice and Approver HumanDecision distinct on one authenticated GET', async () => {
    const expected = feed()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'take-review-host-token' },
    )

    expect(await handler('takeReviewAuthority', TAKE_COMMENT_SCOPE, signal()))
      .toEqual({ ok: true, value: expected })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-review-authority',
    )
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer take-review-host-token')
    expect(expected.recommendations[0]).toMatchObject({ actorRole: 'reviewer', currentBinding: true })
    expect(expected.decisions[0]).toMatchObject({ actorRole: 'approver', currentBinding: true })
  })

  it('accepts participant IDs in Python Unicode code-point order', async () => {
    const expected = feed()
    expected.decisions[0]!.producerNaturalPersonId = 'Ａ-person'
    expected.decisions[0]!.participantNaturalPersonIds = ['Ａ-person', '😀-person']
    expected.currentDecision = expected.decisions[0]!
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const handler = createYimengReadHandler(
      {},
      { fetch, readToken: () => 'take-review-host-token' },
    )

    expect(await handler('takeReviewAuthority', TAKE_COMMENT_SCOPE, signal()))
      .toEqual({ ok: true, value: expected })
  })

  it.each([
    ['recommendation promoted to approver', (value: ReturnType<typeof feed>) => {
      value.recommendations[0] = { ...value.recommendations[0]!, actorRole: 'approver' } as never
    }],
    ['decision demoted to reviewer', (value: ReturnType<typeof feed>) => {
      value.decisions[0] = { ...value.decisions[0]!, actorRole: 'reviewer' } as never
    }],
    ['forged exact Take digest', (value: ReturnType<typeof feed>) => {
      value.versions[0] = { ...value.versions[0]!, takeSubjectSha256: '0'.repeat(64) }
    }],
    ['forged current decision', (value: ReturnType<typeof feed>) => {
      value.currentDecision = null as never
    }],
    ['same decision id with changed reason', (value: ReturnType<typeof feed>) => {
      value.currentDecision = { ...value.currentDecision, reason: '篡改后的理由' }
    }],
    ['approver included among production participants', (value: ReturnType<typeof feed>) => {
      value.decisions[0] = {
        ...value.decisions[0]!,
        participantNaturalPersonIds: ['person-approver', 'person-producer'],
      }
      value.currentDecision = value.decisions[0]!
    }],
    ['state mutation boundary', (value: ReturnType<typeof feed>) => {
      value.boundaries = { ...value.boundaries, decisionMutatesTakeState: true } as never
    }],
  ] as const)('fails closed on %s', async (_name, mutate) => {
    const value = structuredClone(feed())
    mutate(value)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'take-review-host-token' })
    expect(await handler('takeReviewAuthority', TAKE_COMMENT_SCOPE, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('rejects browser identity and authority fields before transport', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(feed()))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'take-review-host-token' })
    expect(await handler(
      'takeReviewAuthority',
      { ...TAKE_COMMENT_SCOPE, actorRole: 'approver' },
      signal(),
    )).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
