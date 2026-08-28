// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewRecommendationResult,
} from '../src/client/contracts.ts'
import {
  TakeReviewAuthorityPanel,
  type TakeReviewAuthorityPort,
} from '../src/client/TakeReviewAuthorityPanel.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  readTakeHumanDecisionRecoveryMarker,
  takeHumanDecisionRecoveryKey,
  takeReviewRecommendationRecoveryKey,
  writeTakeHumanDecisionRecoveryMarker,
  type TakeHumanDecisionRecoveryMarker,
} from '../src/client/take-review-recovery.ts'
import {
  TAKE_COMMENT_SCOPE,
  takeCommentSha,
  takeCommentSubject,
} from '../../qingmu-yimeng-read-adapter/tests/take-comment-fixture.ts'

type MockPort = {
  readonly [K in keyof TakeReviewAuthorityPort]: ReturnType<typeof vi.fn<TakeReviewAuthorityPort[K]>>
}

const t = (key: QingmuCockpitKey) => zh[key]
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

function feed(
  capabilities: { readonly canReview: boolean; readonly canDecide: boolean } = {
    canReview: true,
    canDecide: true,
  },
): YimengTakeReviewAuthorityFeedResponse {
  const first = takeCommentSubject(TAKE_COMMENT_SCOPE, 'asset-take-1')
  const second = takeCommentSubject(TAKE_COMMENT_SCOPE, 'asset-take-2')
  const firstSha = takeCommentSha(first)
  const recommendation = {
    id: 'take-recommendation-1',
    takeSubject: first,
    takeSubjectSha256: firstSha,
    actorId: 'reviewer-user',
    actorRole: 'reviewer' as const,
    actorNaturalPersonId: 'person-reviewer',
    authSessionId: '8'.repeat(64),
    eventId: 'take-recommendation-event-1',
    recommendation: 'request_changes' as const,
    reason: '表演节奏需要更清晰。',
    recommendedAt: '2026-08-28T10:03:00.123456+00:00',
    currentBinding: true,
  }
  const decision = {
    decisionId: 'take-decision-1',
    subjectType: 'shot_take' as const,
    subjectId: first.takeId,
    subjectRevision: first.versionOrdinal,
    subjectSha256: firstSha,
    takeSubject: first,
    takeSubjectSha256: firstSha,
    actorId: 'approver-user',
    actorRole: 'approver' as const,
    actorNaturalPersonId: 'person-approver',
    authSessionId: '9'.repeat(64),
    eventId: 'take-decision-event-1',
    decision: 'approve' as const,
    reason: '当前精确版本可以进入下一人工环节。',
    producerActorId: 'producer-user',
    producerNaturalPersonId: 'person-producer',
    participantNaturalPersonIds: ['person-editor', 'person-producer'],
    decidedAt: '2026-08-28T10:05:00.123456+00:00',
    currentBinding: true,
  }
  return {
    schema: 'jason.qingmu-take-review-authority-feed.v1',
    ...TAKE_COMMENT_SCOPE,
    capabilities,
    versions: [
      { takeSubject: first, takeSubjectSha256: firstSha },
      { takeSubject: second, takeSubjectSha256: takeCommentSha(second) },
    ],
    recommendations: [recommendation],
    decisions: [decision],
    currentDecision: decision,
    boundaries: {
      reviewerRecommendationIsApproval: false,
      decisionMutatesTakeState: false,
      roleOrSessionSwitchCanBypassNaturalPersonSeparation: false,
    },
  }
}

function recommendationResult(
  input: YimengCreateTakeReviewRecommendationRequest,
): YimengTakeReviewRecommendationResult {
  const takeSubject = takeCommentSubject(input, input.takeId)
  return {
    schema: 'jason.qingmu-take-review-recommendation-result.v1',
    recommendation: {
      id: 'take-recommendation-created',
      takeSubject,
      takeSubjectSha256: input.expectedTakeSubjectSha256,
      actorId: 'reviewer-user',
      actorRole: 'reviewer',
      actorNaturalPersonId: 'person-reviewer',
      authSessionId: '8'.repeat(64),
      eventId: 'take-recommendation-created-event',
      recommendation: input.recommendation,
      reason: input.reason,
      recommendedAt: '2026-08-28T10:08:00.123456+00:00',
    },
    decisionRecorded: false,
    recommendationOnly: true,
    ...impact,
  }
}

function decisionResult(input: YimengCreateTakeHumanDecisionRequest): YimengTakeHumanDecisionResult {
  const takeSubject = takeCommentSubject(input, input.takeId)
  return {
    schema: 'jason.qingmu-take-human-decision-result.v1',
    decision: {
      decisionId: 'take-decision-created',
      subjectType: 'shot_take',
      subjectId: input.takeId,
      subjectRevision: takeSubject.versionOrdinal,
      subjectSha256: input.expectedTakeSubjectSha256,
      takeSubject,
      takeSubjectSha256: input.expectedTakeSubjectSha256,
      actorId: 'approver-user',
      actorRole: 'approver',
      actorNaturalPersonId: 'person-approver',
      authSessionId: '9'.repeat(64),
      eventId: 'take-decision-created-event',
      decision: input.decision,
      reason: input.reason,
      producerActorId: 'producer-user',
      producerNaturalPersonId: 'person-producer',
      participantNaturalPersonIds: ['person-editor', 'person-producer'],
      decidedAt: '2026-08-28T10:09:00.123456+00:00',
    },
    decisionRecorded: true,
    recommendationOnly: false,
    ...impact,
  }
}

function missingDecision(
  input: YimengCreateTakeHumanDecisionRequest,
): YimengTakeHumanDecisionRecovery {
  return {
    schema: 'jason.qingmu-take-review-command-recovery.v1',
    commandType: 'qingmu.take_human_decision.record.v1',
    projectId: input.projectId,
    episodeId: input.episodeId,
    frameId: input.frameId,
    takeId: input.takeId,
    expectedTakeSubjectSha256: input.expectedTakeSubjectSha256,
    idempotencyKey: input.idempotencyKey,
    status: 'not_found',
    result: null,
  }
}

function makePort(value = feed()): MockPort {
  return {
    takeReviewAuthority: vi.fn<TakeReviewAuthorityPort['takeReviewAuthority']>()
      .mockResolvedValue(value),
    createTakeReviewRecommendation: vi.fn<TakeReviewAuthorityPort['createTakeReviewRecommendation']>()
      .mockImplementation(async input => recommendationResult(input)),
    recoverTakeReviewRecommendation: vi.fn<TakeReviewAuthorityPort['recoverTakeReviewRecommendation']>(),
    createTakeHumanDecision: vi.fn<TakeReviewAuthorityPort['createTakeHumanDecision']>()
      .mockImplementation(async input => decisionResult(input)),
    recoverTakeHumanDecision: vi.fn<TakeReviewAuthorityPort['recoverTakeHumanDecision']>(),
  }
}

function renderPanel(port: TakeReviewAuthorityPort) {
  return render(<TakeReviewAuthorityPanel {...TAKE_COMMENT_SCOPE} preferredTakeId="asset-take-1"
    refresh={0} port={port} t={t} />)
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Take review authority UI', () => {
  it('renders visually distinct authority panels with auditable natural-person separation', async () => {
    renderPanel(makePort())

    const authority = await screen.findByRole('region', { name: '审片建议与正式决定' })
    const reviewer = within(authority).getByRole('region', { name: 'Reviewer 建议（非批准）' })
    const approver = within(authority).getByRole('region', { name: 'Approver 决定' })
    expect(reviewer.getAttribute('data-authority')).toBe('reviewer')
    expect(approver.getAttribute('data-authority')).toBe('approver')
    expect(within(reviewer).getByText(/建议永远不会自动变成正式批准/u)).toBeTruthy()
    expect(within(reviewer).getByText(/person-reviewer/u)).toBeTruthy()
    expect(within(approver).getByText(/person-approver/u)).toBeTruthy()
    expect(within(approver).getByText(/person-producer/u)).toBeTruthy()
    expect(within(approver).getByText(/自然人独立校验通过/u)).toBeTruthy()
    expect(authority.querySelector('[name*="actor"], [name*="role"], [name*="person"], [name*="session"]'))
      .toBeNull()
  })

  it('keeps panel targets independent and sends identity-free exact payloads after marker persistence', async () => {
    const port = makePort()
    port.createTakeReviewRecommendation.mockImplementation(async (input) => {
      expect(sessionStorage.getItem(takeReviewRecommendationRecoveryKey(input))).not.toBeNull()
      return recommendationResult(input)
    })
    port.createTakeHumanDecision.mockImplementation(async (input) => {
      expect(sessionStorage.getItem(takeHumanDecisionRecoveryKey(input))).not.toBeNull()
      return decisionResult(input)
    })
    renderPanel(port)

    const reviewer = await screen.findByRole('region', { name: 'Reviewer 建议（非批准）' })
    const approver = screen.getByRole('region', { name: 'Approver 决定' })
    const reviewerTake = within(reviewer).getByRole<HTMLSelectElement>('combobox', { name: '精确 Take 版本' })
    const approverTake = within(approver).getByRole<HTMLSelectElement>('combobox', { name: '精确 Take 版本' })
    fireEvent.change(reviewerTake, { target: { value: 'asset-take-2' } })
    expect(reviewerTake.value).toBe('asset-take-2')
    expect(approverTake.value).toBe('asset-take-1')

    fireEvent.change(within(reviewer).getByLabelText('理由'), { target: { value: '第二版节奏更完整。' } })
    fireEvent.submit(within(reviewer).getByRole('form', { name: 'Reviewer 建议表单（非批准）' }))
    await waitFor(() => { expect(port.createTakeReviewRecommendation).toHaveBeenCalledOnce() })
    const recommendation = port.createTakeReviewRecommendation.mock.calls[0]?.[0]
    if (recommendation === undefined) throw new Error('recommendation request missing')
    expect(recommendation.takeId).toBe('asset-take-2')
    expect(Object.keys(recommendation).sort()).toEqual([
      'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
      'takeId', 'recommendation', 'reason', 'idempotencyKey',
    ].sort())
    expect(JSON.stringify(recommendation)).not.toMatch(/actor|role|person|session|recommendedAt/iu)

    fireEvent.change(within(approver).getByLabelText('理由'), { target: { value: '第一版精确 Take 通过。' } })
    fireEvent.submit(within(approver).getByRole('form', { name: 'Approver 正式决定表单' }))
    await waitFor(() => { expect(port.createTakeHumanDecision).toHaveBeenCalledOnce() })
    const decision = port.createTakeHumanDecision.mock.calls[0]?.[0]
    if (decision === undefined) throw new Error('decision request missing')
    expect(decision.takeId).toBe('asset-take-1')
    expect(Object.keys(decision).sort()).toEqual([
      'projectId', 'episodeId', 'frameId', 'expectedTakeSubjectSha256',
      'takeId', 'decision', 'reason', 'idempotencyKey',
    ].sort())
    expect(JSON.stringify(decision)).not.toMatch(/actor|role|person|session|decidedAt/iu)
  })

  it('turns both forms read-only from independent capabilities', async () => {
    renderPanel(makePort(feed({ canReview: false, canDecide: false })))
    const authority = await screen.findByRole('region', { name: '审片建议与正式决定' })
    expect(within(authority).getByText(/没有 Reviewer 权限/u)).toBeTruthy()
    expect(within(authority).getByText(/没有 Approver 权限/u)).toBeTruthy()
    for (const control of within(authority).getAllByRole('combobox')) {
      expect(control.hasAttribute('disabled')).toBe(true)
    }
    for (const control of within(authority).getAllByRole('textbox')) {
      expect(control.hasAttribute('disabled')).toBe(true)
    }
    expect(within(authority).getAllByRole('button').every(button => button.hasAttribute('disabled')))
      .toBe(true)
  })

  it('announces required reasons and connects each error to its labelled field', async () => {
    renderPanel(makePort())
    const reviewer = await screen.findByRole('region', { name: 'Reviewer 建议（非批准）' })
    const form = within(reviewer).getByRole('form', { name: 'Reviewer 建议表单（非批准）' })
    fireEvent.submit(form)
    const alert = within(reviewer).getByRole('alert')
    const reason = within(reviewer).getByLabelText('理由')
    expect(alert.textContent).toBe('必须填写理由')
    expect(alert.getAttribute('aria-live')).toBe('polite')
    expect(reason.getAttribute('aria-describedby')).toBe(alert.id)
    expect(reason.getAttribute('aria-invalid')).toBe('true')
  })

  it('rejects Python-only boundary whitespace before writing a marker or sending a POST', async () => {
    const port = makePort()
    renderPanel(port)
    const reviewer = await screen.findByRole('region', { name: 'Reviewer 建议（非批准）' })
    fireEvent.change(within(reviewer).getByLabelText('理由'), { target: { value: '\u001c\u001f' } })
    fireEvent.submit(within(reviewer).getByRole('form', { name: 'Reviewer 建议表单（非批准）' }))

    expect(within(reviewer).getByRole('alert').textContent).toBe('必须填写理由')
    expect(port.createTakeReviewRecommendation).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('counts recovery marker identifiers by Unicode code points', () => {
    const first = feed().versions[0]
    if (first === undefined) throw new Error('fixture Take missing')
    const marker: TakeHumanDecisionRecoveryMarker = {
      schema: 'qingmu.take-human-decision-recovery-marker.v1',
      ...TAKE_COMMENT_SCOPE,
      projectId: '😀'.repeat(129),
      expectedTakeSubjectSha256: first.takeSubjectSha256,
      takeId: first.takeSubject.takeId,
      decision: 'approve',
      reason: '按 Unicode 码点验证恢复坐标。',
      idempotencyKey: `qingmu:take-human-decision:v1:${'b'.repeat(64)}`,
    }
    expect(writeTakeHumanDecisionRecoveryMarker(marker)).toBe(true)
    expect(readTakeHumanDecisionRecoveryMarker(marker)).toEqual(marker)

    const overlong = {
      ...marker,
      projectId: '😀'.repeat(257),
      idempotencyKey: `qingmu:take-human-decision:v1:${'c'.repeat(64)}`,
    }
    expect(writeTakeHumanDecisionRecoveryMarker(overlong)).toBe(false)
    expect(readTakeHumanDecisionRecoveryMarker(overlong)).toBeUndefined()
  })

  it('keeps a missing decision receipt locked on its original GET-only coordinate without a POST', async () => {
    const first = feed().versions[0]
    if (first === undefined) throw new Error('fixture Take missing')
    const marker: TakeHumanDecisionRecoveryMarker = {
      schema: 'qingmu.take-human-decision-recovery-marker.v1',
      ...TAKE_COMMENT_SCOPE,
      expectedTakeSubjectSha256: first.takeSubjectSha256,
      takeId: first.takeSubject.takeId,
      decision: 'approve',
      reason: '原始正式决定。',
      idempotencyKey: `qingmu:take-human-decision:v1:${'a'.repeat(64)}`,
    }
    expect(writeTakeHumanDecisionRecoveryMarker(marker)).toBe(true)
    const port = makePort()
    port.recoverTakeHumanDecision.mockImplementation(async input => missingDecision(input))
    renderPanel(port)

    const approver = await screen.findByRole('region', { name: 'Approver 决定' })
    await waitFor(() => { expect(port.recoverTakeHumanDecision).toHaveBeenCalledOnce() })
    expect(port.recoverTakeHumanDecision.mock.calls[0]?.[0]).toEqual(decisionRequestForTest(marker))
    expect(within(approver).getByText(/只允许回执恢复/u).getAttribute('role')).toBe('alert')
    expect(within(approver).getByRole('button', { name: '记录 Approver 正式决定' })
      .hasAttribute('disabled')).toBe(true)
    fireEvent.submit(within(approver).getByRole('form', { name: 'Approver 正式决定表单' }))
    expect(port.createTakeHumanDecision).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(takeHumanDecisionRecoveryKey(marker))).not.toBeNull()
    expect(sessionStorage.getItem(takeReviewRecommendationRecoveryKey(marker))).toBeNull()
  })
})

function decisionRequestForTest(
  marker: TakeHumanDecisionRecoveryMarker,
): YimengCreateTakeHumanDecisionRequest {
  const { schema: _schema, ...request } = marker
  return request
}
