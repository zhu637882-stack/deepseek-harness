import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  normalizeTakeTechnicalQcFeed,
  TAKE_TECHNICAL_QC_CODES,
} from '../src/take-technical-qc.ts'
import type {
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRequest,
} from '../src/types.ts'
import { takeAcceptanceFixture } from './take-acceptance-fixture.ts'
import { takeVersionSha } from './take-version-fixture.ts'

const request: YimengTakeTechnicalQcRequest = {
  projectId: 'project-take', episodeId: 'episode-take', frameId: 'frame-take',
}
const signal = () => new AbortController().signal

function fixture(): YimengTakeTechnicalQcFeedResponse {
  const acceptance = takeAcceptanceFixture(request)
  const subject = acceptance.evidence.subject
  const takeSubjectSha256 = takeVersionSha(subject)
  const assessment: YimengTakeTechnicalQcFeedResponse['assessments'][number] = {
    assessmentId: 'take-qc-1', takeSubject: subject, takeSubjectSha256,
    evidenceSnapshotSha256: acceptance.evidenceSnapshotSha256,
    technicalReceiptStatus: 'PASS',
    checks: TAKE_TECHNICAL_QC_CODES.map(code => ({ code, result: 'PASS', note: null, evidenceRefs: [] })),
    issueCodes: [], technicalPass: true, methodProjectionSha256: 'a'.repeat(64),
    rulesSha256: 'b'.repeat(64), actorId: 'reviewer-1', actorRole: 'reviewer',
    actorNaturalPersonId: 'person-reviewer-1', authSessionId: 'c'.repeat(64),
    recordedAt: '2026-08-29T08:00:00+00:00', eventId: 'event-take-qc-1', currentBinding: true,
  }
  return {
    schema: 'jason.qingmu-take-technical-qc-feed.v1', ...request,
    capabilities: { canRecordTechnicalQc: true },
    currentAcceptance: {
      takeSubject: subject, takeSubjectSha256,
      evidenceSnapshotSha256: acceptance.evidenceSnapshotSha256,
      technicalReceiptStatus: 'PASS',
    },
    assessments: [assessment], currentAssessment: assessment,
    boundaries: {
      technicalQcOnly: true, technicalPassIsContentApproval: false,
      selectionChanged: false, formalApprovalChanged: false,
      episodeVerificationChanged: false, humanSignoffInferred: false,
      providerCalls: 0, budgetMutation: false, reworkExecutionAllowed: false,
      approvalInvalidationAllowed: false, evidenceLedgerMutation: false,
    },
  }
}

describe('takeTechnicalQc read adapter', () => {
  it('accepts one exact current 12-code assessment without content authority', () => {
    const feed = fixture()
    expect(normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toEqual(feed)
    expect(feed.currentAssessment).toMatchObject({ technicalPass: true, actorRole: 'reviewer' })
    expect(feed.boundaries).toMatchObject({
      technicalPassIsContentApproval: false, selectionChanged: false,
      episodeVerificationChanged: false, humanSignoffInferred: false,
    })
  })

  it('accepts optional supporting evidence on a PASS check', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const assessments = feed.assessments as Record<string, unknown>[]
    const assessment = assessments[0]!
    const checks = assessment.checks as Record<string, unknown>[]
    checks[0] = {
      ...checks[0]!, note: '镜头因果复核通过。', evidenceRefs: ['frame:001'],
    }
    feed.currentAssessment = assessment
    expect(normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toEqual(feed)
  })

  it('fails closed on a thirteenth check instead of ignoring it', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const assessment = (feed.assessments as Record<string, unknown>[])[0]!
    ;(assessment.checks as Record<string, unknown>[]).push({
      code: 'EXTRA_CODE', result: 'FAIL', note: '额外检查。', evidenceRefs: ['frame:extra'],
    })
    expect(() => normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toThrow()
  })

  it('fails closed when one check exceeds the 64-reference wire limit', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const assessment = (feed.assessments as Record<string, unknown>[])[0]!
    const check = (assessment.checks as Record<string, unknown>[])[0]!
    check.evidenceRefs = Array.from(
      { length: 65 },
      (_, index) => `frame:${String(index).padStart(2, '0')}`,
    )
    expect(() => normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toThrow()
  })

  it('fails closed when a current-bound assessment contradicts the current receipt status', () => {
    const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
    const assessment = (feed.assessments as Record<string, unknown>[])[0]!
    const checks = assessment.checks as Record<string, unknown>[]
    checks[checks.length - 1] = {
      ...checks[checks.length - 1]!,
      result: 'FAIL',
      note: '技术回执被阻断。',
      evidenceRefs: ['receipt:blocked'],
    }
    assessment.technicalReceiptStatus = 'BLOCKED'
    assessment.issueCodes = ['TECHNICAL_RECEIPT']
    assessment.technicalPass = false
    assessment.currentBinding = true
    feed.currentAssessment = assessment
    expect(() => normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toThrow()
  })

  it.each(['code', 'issue derivation', 'subject SHA', 'current assessment', 'boundary'] as const)(
    'fails closed on forged %s', (kind) => {
      const feed = structuredClone(fixture()) as unknown as Record<string, unknown>
      const assessments = feed.assessments as Record<string, unknown>[]
      const assessment = assessments[0]!
      if (kind === 'code') (assessment.checks as Record<string, unknown>[])[0]!.code = 'FREE_TEXT'
      if (kind === 'issue derivation') (assessment.issueCodes as string[]).push('PACING')
      if (kind === 'subject SHA') assessment.takeSubjectSha256 = 'f'.repeat(64)
      if (kind === 'current assessment') (feed.currentAssessment as Record<string, unknown>).technicalPass = false
      if (kind === 'boundary') (feed.boundaries as Record<string, unknown>).technicalPassIsContentApproval = true
      expect(() => normalizeTakeTechnicalQcFeed(feed, request, takeVersionSha)).toThrow()
    },
  )

  it('uses one authenticated encoded GET and rejects browser authority fields', async () => {
    const encoded = { ...request, frameId: 'frame/one?two#three' }
    const response = fixture() as unknown as Record<string, unknown>
    response.frameId = encoded.frameId
    const acceptance = response.currentAcceptance as Record<string, unknown>
    ;(acceptance.takeSubject as Record<string, unknown>).frameId = encoded.frameId
    acceptance.takeSubjectSha256 = takeVersionSha(acceptance.takeSubject)
    response.assessments = []
    response.currentAssessment = null
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response))
    const handler = createYimengReadHandler(
      { baseUrl: 'http://127.0.0.1:18815' },
      { fetch, readToken: () => 'host-token' },
    )
    expect(await handler('takeTechnicalQc', encoded, signal())).toMatchObject({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/project-take/episodes/episode-take/frames/frame%2Fone%3Ftwo%23three/take-technical-qc',
    )
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })

    fetch.mockClear()
    expect(await handler('takeTechnicalQc', { ...request, actorRole: 'reviewer' }, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
