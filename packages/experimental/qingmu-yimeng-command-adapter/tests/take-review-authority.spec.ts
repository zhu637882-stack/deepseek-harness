import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createYimengCommandHandler,
  type YimengCreateTakeHumanDecisionRequest,
  type YimengCreateTakeReviewRecommendationRequest,
} from '../src/index.ts'

const TOKEN = 'take-review-host-session-token'
const signal = () => new AbortController().signal

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

function commonInput(kind: 'recommendation' | 'decision') {
  const common = {
    projectId: 'project-take',
    episodeId: 'episode-take',
    frameId: 'frame-take',
    expectedTakeSubjectSha256: SHA,
    takeId: 'asset-take-1',
    reason: kind === 'recommendation' ? '建议调整表演节奏。' : '批准当前精确 Take。',
    idempotencyKey: `take-${kind}-command-0001`,
  }
  return common
}

function recommendationInput(): YimengCreateTakeReviewRecommendationRequest {
  return { ...commonInput('recommendation'), recommendation: 'request_changes' }
}

function decisionInput(): YimengCreateTakeHumanDecisionRequest {
  return { ...commonInput('decision'), decision: 'approve' }
}

function subject() {
  return {
    schema: 'jason.qingmu-take-comment-subject.v1' as const,
    projectId: 'project-take',
    episodeId: 'episode-take',
    frameId: 'frame-take',
    frameNo: 7,
    storyboardRevision: 3,
    frameContentSha256: '1'.repeat(64),
    takeId: 'asset-take-1',
    versionOrdinal: 1,
    outputSha256: '2'.repeat(64),
    durationMillis: 5_250,
  }
}

const SHA = createHash('sha256').update(canonicalJson(subject()), 'utf8').digest('hex')

const impact = {
  changed: false as const,
  selectionChanged: false as const,
  technicalPassChanged: false as const,
  formalApprovalChanged: false as const,
  episodeVerificationChanged: false as const,
  humanSignoffInferred: false as const,
  providerCalls: 0 as const,
  budgetMutation: false as const,
}

function recommendationResult() {
  const request = recommendationInput()
  return {
    schema: 'jason.qingmu-take-review-recommendation-result.v1' as const,
    recommendation: {
      id: 'take-recommendation-1',
      takeSubject: subject(),
      takeSubjectSha256: SHA,
      actorId: 'reviewer-user',
      actorRole: 'reviewer' as const,
      actorNaturalPersonId: 'person-reviewer',
      authSessionId: '8'.repeat(64),
      eventId: 'take-recommendation-event-1',
      recommendation: request.recommendation,
      reason: request.reason,
      recommendedAt: '2026-08-28T10:03:00.123456+00:00',
    },
    decisionRecorded: false as const,
    recommendationOnly: true as const,
    ...impact,
  }
}

function decisionResult() {
  const request = decisionInput()
  return {
    schema: 'jason.qingmu-take-human-decision-result.v1' as const,
    decision: {
      decisionId: 'take-decision-1',
      subjectType: 'shot_take' as const,
      subjectId: request.takeId,
      subjectRevision: 1,
      subjectSha256: SHA,
      takeSubject: subject(),
      takeSubjectSha256: SHA,
      actorId: 'approver-user',
      actorRole: 'approver' as const,
      actorNaturalPersonId: 'person-approver',
      authSessionId: '9'.repeat(64),
      eventId: 'take-decision-event-1',
      decision: request.decision,
      reason: request.reason,
      producerActorId: 'producer-user',
      producerNaturalPersonId: 'person-producer',
      participantNaturalPersonIds: ['person-editor', 'person-producer'],
      decidedAt: '2026-08-28T10:05:00.123456+00:00',
    },
    decisionRecorded: true as const,
    recommendationOnly: false as const,
    ...impact,
  }
}

function handler(fetch: typeof globalThis.fetch) {
  return createYimengCommandHandler({}, { fetch, readToken: () => TOKEN })
}

describe('Take review authority command transport', () => {
  it.each([
    {
      endpoint: 'createTakeReviewRecommendation' as const,
      kind: 'recommendation' as const,
      result: recommendationResult(),
      suffix: 'recommendations',
    },
    {
      endpoint: 'createTakeHumanDecision' as const,
      kind: 'decision' as const,
      result: decisionResult(),
      suffix: 'decisions',
    },
  ])('POSTs exact identity-free fields for $kind', async ({ endpoint, kind, result, suffix }) => {
    const request = kind === 'recommendation' ? recommendationInput() : decisionInput()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result, { status: 201 }))
    expect(await handler(fetch)(endpoint, request, signal())).toEqual({ ok: true, value: result })

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      `http://127.0.0.1:8115/api/qingmu/projects/project-take/episodes/episode-take/frames/frame-take/take-review-authority/${suffix}`,
    )
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
    if (typeof init?.body !== 'string') throw new Error('body must be JSON')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      kind, 'expectedTakeSubjectSha256', 'idempotencyKey', 'reason', 'takeId',
    ].sort())
    expect(JSON.stringify(body)).not.toMatch(/actor|role|person|session|recommendedAt|decidedAt/iu)
  })

  it.each(['actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId', 'decidedAt']) (
    'rejects browser identity field %s before transport',
    async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(decisionResult()))
      expect(await handler(fetch)(
        'createTakeHumanDecision',
        { ...decisionInput(), [field]: 'forged' },
        signal(),
      )).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects a recommendation receipt masquerading as a HumanDecision', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(recommendationResult()))
    expect(await handler(fetch)('createTakeHumanDecision', decisionInput(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('rejects an Approver natural person inside the production participant set', async () => {
    const value = structuredClone(decisionResult())
    value.decision.participantNaturalPersonIds = ['person-approver', 'person-producer']
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
    expect(await handler(fetch)('createTakeHumanDecision', decisionInput(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('accepts Python Unicode code-point participant order in POST and recovery results', async () => {
    const request = decisionInput()
    const result = decisionResult()
    result.decision.producerNaturalPersonId = 'Ａ-person'
    result.decision.participantNaturalPersonIds = ['Ａ-person', '😀-person']
    const postFetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result, { status: 201 }))

    expect(await handler(postFetch)('createTakeHumanDecision', request, signal()))
      .toEqual({ ok: true, value: result })

    const recovery = {
      schema: 'jason.qingmu-take-review-command-recovery.v1' as const,
      commandType: 'qingmu.take_human_decision.record.v1' as const,
      projectId: request.projectId,
      episodeId: request.episodeId,
      frameId: request.frameId,
      takeId: request.takeId,
      expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
      idempotencyKey: request.idempotencyKey,
      status: 'committed' as const,
      result,
    }
    const recoveryFetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(recovery))
    expect(await handler(recoveryFetch)('recoverTakeHumanDecision', request, signal()))
      .toEqual({ ok: true, value: recovery })
  })

  it('rejects a recommendation response whose Take subject drifts while reusing the old SHA', async () => {
    const result = recommendationResult()
    result.recommendation.takeSubject = { ...result.recommendation.takeSubject, storyboardRevision: 4 }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
    expect(await handler(fetch)('createTakeReviewRecommendation', recommendationInput(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('rejects a decision response whose Take subject drifts while reusing the old SHA', async () => {
    const result = decisionResult()
    result.decision.takeSubject = { ...result.decision.takeSubject, storyboardRevision: 4 }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
    expect(await handler(fetch)('createTakeHumanDecision', decisionInput(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it.each([
    {
      endpoint: 'recoverTakeReviewRecommendation' as const,
      kind: 'recommendation' as const,
      commandType: 'qingmu.take_review.recommendation.record.v1' as const,
      suffix: 'recommendations',
    },
    {
      endpoint: 'recoverTakeHumanDecision' as const,
      kind: 'decision' as const,
      commandType: 'qingmu.take_human_decision.record.v1' as const,
      suffix: 'decisions',
    },
  ])('uses GET-only receipt recovery for $kind', async ({ endpoint, kind, commandType, suffix }) => {
    const request = kind === 'recommendation' ? recommendationInput() : decisionInput()
    const expected = {
      schema: 'jason.qingmu-take-review-command-recovery.v1',
      commandType,
      projectId: request.projectId,
      episodeId: request.episodeId,
      frameId: request.frameId,
      takeId: request.takeId,
      expectedTakeSubjectSha256: request.expectedTakeSubjectSha256,
      idempotencyKey: request.idempotencyKey,
      status: 'not_found',
      result: null,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    expect(await handler(fetch)(endpoint, request, signal())).toEqual({ ok: true, value: expected })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toContain(`/take-review-authority/${suffix}/command-receipt?`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
  })

  it('never repeats an uncertain POST', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    expect(await handler(fetch)('createTakeHumanDecision', decisionInput(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
