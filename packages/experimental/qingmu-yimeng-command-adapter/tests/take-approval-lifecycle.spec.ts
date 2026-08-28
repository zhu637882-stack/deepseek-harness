import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { takeApprovalLifecycleFixture } from '../../qingmu-yimeng-read-adapter/tests/take-approval-lifecycle-fixture.ts'
import { takeVersionSha } from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import {
  createYimengCommandHandler,
  type YimengTakeApprovalLifecycleAction,
  type YimengTransitionTakeApprovalLifecycleRequest,
} from '../src/index.ts'

const TOKEN = 'take-approval-lifecycle-host-token'
const KEY = 'fixture-only-lifecycle-key-32-bytes'
const signal = () => new AbortController().signal
const ACTIONS = ['APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT'] as const
const RULE_PATHS = [
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_approval_lifecycle_method.py',
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

function methodResponse() {
  const feed = takeApprovalLifecycleFixture()
  const subject = feed.source.currentTake.takeSubject
  const ruleBindings = Object.fromEntries(RULE_PATHS.map((path, index) => [
    path, String(index + 1).repeat(64),
  ]))
  const rulesSha256 = sha(ruleBindings)
  const definition = {
    mode: 'STATELESS_TAKE_APPROVAL_LIFECYCLE_METHOD',
    actions: ACTIONS,
    approvalRequires: [
      'CURRENT_SELECTED_TAKE', 'CURRENT_APPROVER_APPROVE_DECISION',
      'CURRENT_TECHNICAL_QC_PASS', 'CURRENT_RULE_BINDING',
    ],
    invalidation: {
      sourceDriftIsImmediate: true, auditableEventRequired: true,
      oldApprovalMayNotBeInherited: true,
    },
    rework: {
      boundedFindingRouteRequired: true, oneEarliestOwnerPerDefect: true,
      executionAllowed: false, paidGenerationAuthorized: false,
      automaticRetry: false, thirdSameClassRequiresMethodReview: true,
    },
    resubmission: {
      newTakeRevisionRequired: true, editIsApproval: false, approvalInherited: false,
    },
    boundaries: {
      businessTruth: 'yimeng', selectionChanged: false, technicalPassChanged: false,
      reviewDecisionChanged: false, reworkExecuted: false, providerCalls: 0,
      budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    },
  }
  const transition = {
    state: 'READY_FOR_APPROVAL', legalActions: ['APPROVE'],
    currentApprovalId: null, staleApprovalId: null, invalidationReasons: [],
    reworkClassCodes: [], sameClassReworkCount: 0, sameClassCountAfterRequest: 0,
    methodReviewRequired: false, methodReviewRequiredAfterRequest: false,
    resubmitSourceReworkId: null, approvalInherited: false,
    boundedFindingRouteRequired: false,
  }
  const projection = {
    schema: 'qingmu.imago-take-approval-lifecycle-method.v1',
    subject,
    subjectSnapshotSha256: takeVersionSha(subject),
    sourceSnapshotSha256: feed.sourceSnapshotSha256,
    definition,
    transition,
    ruleBindings,
    rulesSha256,
  }
  const projectionSha256 = sha(projection)
  const unsigned = {
    schema: 'qingmu.imago-take-approval-lifecycle-method-attestation.v1',
    algorithm: 'hmac-sha256',
    sourceSnapshotSha256: feed.sourceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-take-approval-lifecycle-method-adapter-result.v1',
    projection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', KEY).update(canonicalJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

function input(
  action: YimengTakeApprovalLifecycleAction = 'APPROVE',
): YimengTransitionTakeApprovalLifecycleRequest {
  const method = methodResponse()
  return {
    projectId: method.projection.subject.projectId,
    episodeId: method.projection.subject.episodeId,
    frameId: method.projection.subject.frameId,
    expectedSourceSnapshotSha256: method.projection.sourceSnapshotSha256,
    takeId: method.projection.subject.takeId,
    action,
    reason: '导演与审批人已核对当前 Selected Take、审片决定与技术 QC。',
    idempotencyKey: 'take-approval-lifecycle-0001',
  }
}

function result(
  request = input(),
  method = methodResponse(),
) {
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-result.v1' as const,
    transition: {
      transitionId: 'take-approval-transition-1', revision: 1,
      action: request.action, takeId: request.takeId,
      takeVersionOrdinal: method.projection.subject.versionOrdinal,
      takeSubjectSha256: method.projection.subjectSnapshotSha256,
      decisionId: 'decision-1', decisionEventId: 'decision-event-1',
      assessmentId: 'assessment-1', assessmentEventId: 'assessment-event-1',
      sourceApprovalId: null, sourceReworkId: null, defectClassCodes: [],
      reason: request.reason, actorId: 'approver-user', actorRole: 'approver' as const,
      actorNaturalPersonId: 'approver-person', authSessionId: '8'.repeat(64),
      recordedAt: '2026-08-29T10:03:00.123456+00:00', eventId: 'approval-event-1',
      methodProjectionSha256: method.projectionSha256,
      rulesSha256: method.projection.rulesSha256,
    },
    sourceSnapshotSha256: request.expectedSourceSnapshotSha256,
    authoritativeSourceSnapshotSha256: '9'.repeat(64),
    methodReviewRequiredAfterRequest: false,
    boundedFindingRouteRequired: false,
    changed: true as const,
    formalApprovalChanged: true,
    approvalInvalidated: false,
    reworkRequested: false,
    resubmitted: false,
    selectionChanged: false as const,
    technicalPassChanged: false as const,
    reviewDecisionChanged: false as const,
    reworkExecuted: false as const,
    providerCalls: 0 as const,
    budgetMutation: false as const,
    episodeVerificationChanged: false as const,
    humanSignoffInferred: false as const,
    evidenceLedgerMutation: false as const,
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
      fetch, readToken: () => TOKEN, runTakeApprovalLifecycleMethod: runMethod,
    }),
    runMethod,
  }
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Take approval lifecycle command transport', () => {
  it('POSTs only Host-derived Method evidence plus the eight-field browser intent', async () => {
    const request = input()
    const method = methodResponse()
    const expected = result(request, method)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected, { status: 201 }))
    const { call, runMethod } = handler(fetch, method)

    expect(await call('transitionTakeApprovalLifecycle', request, signal()))
      .toEqual({ ok: true, value: expected })
    expect(runMethod).toHaveBeenCalledOnce()
    expect(runMethod.mock.calls[0]?.[0]).toEqual({
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
    })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(
      `http://127.0.0.1:8115/api/qingmu/projects/${request.projectId}`
      + `/episodes/${request.episodeId}/frames/${request.frameId}`
      + '/take-approval-lifecycle/transitions',
    )
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
    if (typeof init?.body !== 'string') throw new Error('body must be JSON')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'expectedSourceSnapshotSha256', 'takeId', 'methodProjection',
      'methodProjectionSha256', 'methodAttestation', 'action', 'reason', 'idempotencyKey',
    ].sort())
    expect(JSON.stringify(request)).not.toMatch(/actor|role|person|session|recordedAt/iu)
    expect(JSON.stringify(method)).not.toContain(KEY)
  })

  it.each(['actorId', 'actorRole', 'actorNaturalPersonId', 'authSessionId', 'methodProjection'])(
    'rejects browser authority field %s before Method or HTTP transport',
    async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>()
      const { call, runMethod } = handler(fetch)
      expect(await call('transitionTakeApprovalLifecycle', {
        ...input(), [field]: 'forged',
      }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      expect(runMethod).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects an action that is not legal in the current fresh Method', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { call, runMethod } = handler(fetch)
    expect(await call('transitionTakeApprovalLifecycle', input('RESUBMIT'), signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(runMethod).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['source', 'subject', 'projectionSha', 'signature', 'rules'] as const)(
    'fails closed before POST when current Method %s binding drifts',
    async (kind) => {
      const base = methodResponse()
      const method = kind === 'source'
        ? { ...base, projection: { ...base.projection, sourceSnapshotSha256: '0'.repeat(64) } }
        : kind === 'subject'
          ? { ...base, projection: {
            ...base.projection,
            subject: { ...base.projection.subject, storyboardRevision: 99 },
          } }
          : kind === 'projectionSha'
            ? { ...base, projectionSha256: '0'.repeat(64) }
            : kind === 'signature'
              ? { ...base, methodAttestation: {
                ...base.methodAttestation, signature: '0'.repeat(64),
              } }
              : { ...base, projection: { ...base.projection, rulesSha256: '0'.repeat(64) } }
      const fetch = vi.fn<typeof globalThis.fetch>()
      const { call } = handler(fetch, method)
      expect(await call('transitionTakeApprovalLifecycle', input(), signal()))
        .toMatchObject({ ok: false, error: { code: 'internal' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['actionFlag', 'authorityFlag', 'takeSha', 'methodSha', 'role'] as const)(
    'rejects a forged committed result %s',
    async (kind) => {
      const base = result()
      const expected = kind === 'actionFlag'
        ? { ...base, formalApprovalChanged: false }
        : kind === 'authorityFlag'
          ? { ...base, reworkExecuted: true }
          : kind === 'takeSha'
            ? { ...base, transition: {
              ...base.transition, takeSubjectSha256: '0'.repeat(64),
            } }
            : kind === 'methodSha'
              ? { ...base, transition: {
                ...base.transition, methodProjectionSha256: '0'.repeat(64),
              } }
              : { ...base, transition: { ...base.transition, actorRole: 'director' } }
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
      const { call } = handler(fetch)
      expect(await call('transitionTakeApprovalLifecycle', input(), signal()))
        .toMatchObject({ ok: false, error: { code: 'internal' } })
    },
  )

  it('uses original GET-only coordinates for not-found receipt recovery', async () => {
    const request = input()
    const expected = {
      schema: 'jason.qingmu-take-approval-lifecycle-recovery.v1',
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
      takeId: request.takeId,
      expectedSourceSnapshotSha256: request.expectedSourceSnapshotSha256,
      idempotencyKey: request.idempotencyKey, status: 'not_found', result: null,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(expected))
    const { call, runMethod } = handler(fetch)
    expect(await call('recoverTakeApprovalLifecycleTransition', request, signal()))
      .toEqual({ ok: true, value: expected })
    expect(runMethod).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0] ?? []
    if (url === undefined) throw new Error('recovery URL missing')
    const urlText = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    expect(urlText).toContain('/take-approval-lifecycle/transitions/command-receipt?')
    expect(urlText).toContain(`expectedSourceSnapshotSha256=${request.expectedSourceSnapshotSha256}`)
    expect(urlText).toContain(`takeId=${request.takeId}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
  })

  it('strictly recovers a committed receipt without invoking the Method', async () => {
    const request = input()
    const committed = result(request)
    const recovery = {
      schema: 'jason.qingmu-take-approval-lifecycle-recovery.v1',
      projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
      takeId: request.takeId,
      expectedSourceSnapshotSha256: request.expectedSourceSnapshotSha256,
      idempotencyKey: request.idempotencyKey, status: 'committed', result: committed,
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(recovery))
    const { call, runMethod } = handler(fetch)
    expect(await call('recoverTakeApprovalLifecycleTransition', request, signal()))
      .toEqual({ ok: true, value: recovery })
    expect(runMethod).not.toHaveBeenCalled()
  })

  it('never repeats an uncertain transition POST', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const { call } = handler(fetch)
    expect(await call('transitionTakeApprovalLifecycle', input(), signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
