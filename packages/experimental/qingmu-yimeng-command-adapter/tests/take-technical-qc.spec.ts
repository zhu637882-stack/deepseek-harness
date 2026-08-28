import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { takeAcceptanceFixture } from '../../qingmu-yimeng-read-adapter/tests/take-acceptance-fixture.ts'
import {
  createYimengCommandHandler,
  type YimengRecordTakeTechnicalQcRequest,
  type YimengTakeTechnicalQcCheck,
} from '../src/index.ts'

const TOKEN = 'take-qc-host-session-token'
const KEY = 'fixture-only-take-qc-key-32-bytes'
const signal = () => new AbortController().signal
const MACRO_CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
] as const
const MICRO_CODES = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const
const ALL_CODES = [...MACRO_CODES, ...MICRO_CODES] as const
const RULE_PATHS = [
  'pipeline/v6-video-generation-routing-policy.json',
  'pipeline/v6-video-reference-integrity-overlay-policy.json',
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_qc_method.py',
] as const

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    return `{${Object.keys(item).sort(codePointCompare)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
  }
  throw new Error('not canonical JSON')
}

const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')

function passChecks(): YimengTakeTechnicalQcCheck[] {
  return ALL_CODES.map((code, index) => ({
    code,
    result: 'PASS',
    note: index === 0 ? '已复核因果连续。' : null,
    evidenceRefs: index === 0 ? ['frame://7/end', 'frame://7/start'] : [],
  }))
}

function input(checks = passChecks()): YimengRecordTakeTechnicalQcRequest {
  const feed = takeAcceptanceFixture()
  return {
    projectId: feed.evidence.subject.projectId,
    episodeId: feed.evidence.subject.episodeId,
    frameId: feed.evidence.subject.frameId,
    expectedEvidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    takeId: feed.evidence.subject.takeId,
    checks,
    idempotencyKey: 'take-qc-command-0001',
  }
}

function methodResponse(status: 'PASS' | 'BLOCKED' = 'PASS') {
  const feed = takeAcceptanceFixture()
  const ruleBindings = Object.fromEntries(RULE_PATHS.map((path, index) => [
    path, String(index + 1).repeat(64),
  ]))
  const definition = {
    mode: 'STATELESS_TECHNICAL_QC_METHOD',
    catalog: {
      macro: { layer: 'MACRO_QC', codes: MACRO_CODES },
      micro: { layer: 'MICRO_QC', codes: MICRO_CODES },
    },
    resultOptions: ['PASS', 'FAIL', 'UNVERIFIED'],
    allCodesExactlyOnce: true,
    nonPassRequires: { note: true, evidenceRefs: true },
    unverifiedIsNotPass: true,
    technicalReceipt: {
      code: 'TECHNICAL_RECEIPT',
      machineEvidencePassRequiredForCheckPass: true,
      machineEvidencePassRequiredForOverallPass: true,
    },
    boundaries: {
      businessTruth: 'yimeng', technicalQcOnly: true,
      technicalPassIsContentApproval: false, selectionChanged: false,
      recommendationChanged: false, decisionRecorded: false,
      formalApprovalChanged: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, providerCalls: 0, budgetMutation: false,
      approvalInvalidationAllowed: false, reworkExecutionAllowed: false,
      evidenceLedgerMutation: false,
    },
  }
  const projection = {
    schema: 'qingmu.imago-take-technical-qc-method.v1',
    subject: feed.evidence.subject,
    evidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    technicalReceiptStatus: status,
    definition,
    ruleBindings,
    rulesSha256: sha(ruleBindings),
  }
  const projectionSha256 = sha(projection)
  const unsigned = {
    schema: 'qingmu.imago-take-technical-qc-method-attestation.v1',
    algorithm: 'hmac-sha256',
    evidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-take-technical-qc-method-adapter-result.v1',
    projection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', KEY).update(canonicalJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

function result(request = input(), method = methodResponse()) {
  const subject = method.projection.subject
  const issueCodes = request.checks.filter(check => check.result !== 'PASS').map(check => check.code)
    .sort(codePointCompare)
  const technicalPass = method.projection.technicalReceiptStatus === 'PASS' && issueCodes.length === 0
  return {
    schema: 'jason.qingmu-take-technical-qc-result.v1' as const,
    assessment: {
      assessmentId: 'take-qc-assessment-1',
      takeSubject: subject,
      takeSubjectSha256: sha(subject),
      evidenceSnapshotSha256: request.expectedEvidenceSnapshotSha256,
      technicalReceiptStatus: method.projection.technicalReceiptStatus,
      checks: request.checks,
      issueCodes,
      technicalPass,
      methodProjectionSha256: method.projectionSha256,
      rulesSha256: method.projection.rulesSha256,
      actorId: 'reviewer-user',
      actorRole: 'reviewer' as const,
      actorNaturalPersonId: 'reviewer-person',
      authSessionId: '8'.repeat(64),
      recordedAt: '2026-08-29T10:03:00.123456+00:00',
      eventId: 'take-qc-event-1',
    },
    technicalQcRecorded: true as const,
    technicalPass,
    changed: false as const,
    selectionChanged: false as const,
    recommendationChanged: false as const,
    decisionRecorded: false as const,
    formalApprovalChanged: false as const,
    technicalPassChanged: false as const,
    episodeVerificationChanged: false as const,
    humanSignoffInferred: false as const,
    providerCalls: 0 as const,
    budgetMutation: false as const,
  }
}

function handler(
  fetch: typeof globalThis.fetch,
  method = methodResponse(),
  runMethod = vi.fn(async (_payload: unknown, _signal: AbortSignal) => ({
    ok: true as const, value: method,
  })),
) {
  return {
    call: createYimengCommandHandler({}, {
      fetch, readToken: () => TOKEN, runTakeTechnicalQcMethod: runMethod,
    }),
    runMethod,
  }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Take technical-QC command transport', () => {
  it('POSTs the seven Host-derived fields after a fresh identity-only Method call', async () => {
    const request = input()
    const method = methodResponse()
    const expected = result(request, method)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected, { status: 201 }))
    const { call, runMethod } = handler(fetch, method)

    expect(await call('recordTakeTechnicalQc', request, signal())).toEqual({ ok: true, value: expected })
    expect(runMethod).toHaveBeenCalledOnce()
    expect(runMethod.mock.calls[0]?.[0]).toEqual({
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
    })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      `http://127.0.0.1:8115/api/qingmu/projects/${request.projectId}`
      + `/episodes/${request.episodeId}/frames/${request.frameId}/take-technical-qc/assessments`,
    )
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
    if (typeof init?.body !== 'string') throw new Error('body must be JSON')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'expectedEvidenceSnapshotSha256', 'takeId', 'methodProjection',
      'methodProjectionSha256', 'methodAttestation', 'checks', 'idempotencyKey',
    ].sort())
    expect(JSON.stringify(request)).not.toMatch(/actor|role|person|session|recordedAt/iu)
    expect(JSON.stringify(method)).not.toContain(KEY)
  })

  it.each(['actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId', 'recordedAt'])(
    'rejects browser identity field %s before Method or HTTP transport',
    async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>()
      const { call, runMethod } = handler(fetch)
      expect(await call('recordTakeTechnicalQc', { ...input(), [field]: 'forged' }, signal()))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(runMethod).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['subject', 'evidence', 'projectionSha', 'signature'] as const)(
    'fails closed before POST when the current Method %s binding drifts',
    async (kind) => {
      const method = methodResponse()
      if (kind === 'subject') method.projection.subject = {
        ...method.projection.subject, storyboardRevision: 4,
      }
      if (kind === 'evidence') method.projection.evidenceSnapshotSha256 = '0'.repeat(64)
      if (kind === 'projectionSha') method.projectionSha256 = '0'.repeat(64)
      if (kind === 'signature') method.methodAttestation.signature = '0'.repeat(64)
      const fetch = vi.fn<typeof globalThis.fetch>()
      const { call } = handler(fetch, method)
      expect(await call('recordTakeTechnicalQc', input(), signal()))
        .toMatchObject({ ok: false, error: { code: 'internal' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects a technical receipt PASS when fresh machine evidence is blocked', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { call } = handler(fetch, methodResponse('BLOCKED'))
    expect(await call('recordTakeTechnicalQc', input(), signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires note and evidence refs for every non-PASS check', async () => {
    const checks = passChecks()
    checks[0] = { code: 'STORY_CAUSALITY', result: 'FAIL', note: null, evidenceRefs: [] }
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { call, runMethod } = handler(fetch)
    expect(await call('recordTakeTechnicalQc', input(checks), signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(runMethod).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the original GET-only coordinates for not-found receipt recovery', async () => {
    const request = input()
    const expected = {
      schema: 'jason.qingmu-take-technical-qc-recovery.v1',
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
      takeId: request.takeId,
      expectedEvidenceSnapshotSha256: request.expectedEvidenceSnapshotSha256,
      idempotencyKey: request.idempotencyKey, status: 'not_found', result: null,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const { call, runMethod } = handler(fetch)
    expect(await call('recoverTakeTechnicalQc', request, signal())).toEqual({ ok: true, value: expected })
    expect(runMethod).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0] ?? []
    if (url === undefined) throw new Error('recovery URL missing')
    const urlText = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    expect(urlText).toContain('/take-technical-qc/assessments/command-receipt?')
    expect(urlText).toContain(`expectedEvidenceSnapshotSha256=${request.expectedEvidenceSnapshotSha256}`)
    expect(urlText).toContain(`takeId=${request.takeId}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
  })

  it('strictly recovers a committed receipt without invoking the Method', async () => {
    const request = input()
    const committed = result(request)
    const recovery = {
      schema: 'jason.qingmu-take-technical-qc-recovery.v1',
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
      takeId: request.takeId,
      expectedEvidenceSnapshotSha256: request.expectedEvidenceSnapshotSha256,
      idempotencyKey: request.idempotencyKey, status: 'committed', result: committed,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(recovery))
    const { call, runMethod } = handler(fetch)
    expect(await call('recoverTakeTechnicalQc', request, signal()))
      .toEqual({ ok: true, value: recovery })
    expect(runMethod).not.toHaveBeenCalled()
  })

  it('never repeats an uncertain POST', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const { call } = handler(fetch)
    expect(await call('recordTakeTechnicalQc', input(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a response subject that drifts while reusing its old SHA', async () => {
    const expected = result()
    expected.assessment.takeSubject = {
      ...expected.assessment.takeSubject, storyboardRevision: 4,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const { call } = handler(fetch)
    expect(await call('recordTakeTechnicalQc', input(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })
})
