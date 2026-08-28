// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleTransition,
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTransitionTakeApprovalLifecycleRequest,
} from '../src/client/contracts.ts'
import {
  TakeApprovalLifecyclePanel,
  type TakeApprovalLifecyclePort,
} from '../src/client/TakeApprovalLifecyclePanel.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  readTakeApprovalLifecycleRecoveryMarker,
  takeApprovalLifecycleRecoveryKey,
  writeTakeApprovalLifecycleRecoveryMarker,
  type TakeApprovalLifecycleRecoveryMarker,
} from '../src/client/take-approval-lifecycle-recovery.ts'
import { takeApprovalLifecycleFixture } from '../../qingmu-yimeng-read-adapter/tests/take-approval-lifecycle-fixture.ts'

type MockPort = {
  readonly [K in keyof TakeApprovalLifecyclePort]: ReturnType<typeof vi.fn<TakeApprovalLifecyclePort[K]>>
}

const t = (key: QingmuCockpitKey) => zh[key]
const SCOPE = { projectId: 'project-take', episodeId: 'episode-take', frameId: 'frame-take' }
const PROJECTION_SHA = 'd'.repeat(64)
const RULES_SHA = 'c'.repeat(64)

function feed(): YimengTakeApprovalLifecycleFeedResponse {
  const base = takeApprovalLifecycleFixture(SCOPE)
  const current = base.source.currentTake
  return {
    ...base,
    sourceSnapshotSha256: 'a'.repeat(64),
    source: {
      ...base.source,
      currentDecision: {
        decisionId: 'decision-1', eventId: 'decision-event-1',
        takeId: current.takeSubject.takeId, takeVersionOrdinal: current.takeSubject.versionOrdinal,
        takeSubjectSha256: current.takeSubjectSha256, decision: 'approve',
        actorId: 'approver-1', actorNaturalPersonId: 'person-approver-1',
      },
      currentAssessment: {
        assessmentId: 'assessment-1', eventId: 'assessment-event-1',
        takeId: current.takeSubject.takeId, takeVersionOrdinal: current.takeSubject.versionOrdinal,
        takeSubjectSha256: current.takeSubjectSha256, evidenceSnapshotSha256: 'b'.repeat(64),
        technicalPass: true, issueCodes: [], methodProjectionSha256: '6'.repeat(64),
        rulesSha256: '7'.repeat(64),
      },
    },
  }
}

function method(
  source = feed(),
  transitionPatch: Partial<ImagoTakeApprovalLifecycleTransition> = {},
): ImagoTakeApprovalLifecycleMethodResponse {
  const transition: ImagoTakeApprovalLifecycleTransition = {
    state: 'READY_FOR_APPROVAL', legalActions: ['APPROVE'],
    currentApprovalId: null, staleApprovalId: null, invalidationReasons: [],
    reworkClassCodes: [], sameClassReworkCount: 0, sameClassCountAfterRequest: 0,
    methodReviewRequired: false, methodReviewRequiredAfterRequest: false,
    resubmitSourceReworkId: null, approvalInherited: false,
    boundedFindingRouteRequired: false,
    ...transitionPatch,
  }
  return {
    schema: 'qingmu.imago-take-approval-lifecycle-method-adapter-result.v1',
    projection: {
      schema: 'qingmu.imago-take-approval-lifecycle-method.v1',
      subject: source.source.currentTake.takeSubject,
      subjectSnapshotSha256: source.source.currentTake.takeSubjectSha256,
      sourceSnapshotSha256: source.sourceSnapshotSha256,
      definition: {
        mode: 'STATELESS_TAKE_APPROVAL_LIFECYCLE_METHOD',
        actions: ['APPROVE', 'INVALIDATE', 'REQUEST_REWORK', 'RESUBMIT'],
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
          executionAllowed: false, paidGenerationAuthorized: false, automaticRetry: false,
          thirdSameClassRequiresMethodReview: true,
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
      },
      transition,
      ruleBindings: { 'docs/qingmu-os/report-source.md': '1'.repeat(64) },
      rulesSha256: RULES_SHA,
    },
    projectionSha256: PROJECTION_SHA,
    methodAttestation: {
      schema: 'qingmu.imago-take-approval-lifecycle-method-attestation.v1',
      algorithm: 'hmac-sha256', sourceSnapshotSha256: source.sourceSnapshotSha256,
      methodProjectionSha256: PROJECTION_SHA, signature: 'e'.repeat(64),
    },
  }
}

function result(
  request: YimengTransitionTakeApprovalLifecycleRequest,
  currentMethod: ImagoTakeApprovalLifecycleMethodResponse,
): YimengTakeApprovalLifecycleResult {
  const action = request.action
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-result.v1',
    transition: {
      transitionId: 'transition-created', revision: 1, action, takeId: request.takeId,
      takeVersionOrdinal: currentMethod.projection.subject.versionOrdinal,
      takeSubjectSha256: currentMethod.projection.subjectSnapshotSha256,
      decisionId: 'decision-1', decisionEventId: 'decision-event-1',
      assessmentId: 'assessment-1', assessmentEventId: 'assessment-event-1',
      sourceApprovalId: null, sourceReworkId: null, defectClassCodes: [],
      reason: request.reason, actorId: 'approver-created', actorRole: 'approver',
      actorNaturalPersonId: 'person-approver-created', authSessionId: '8'.repeat(64),
      recordedAt: '2026-08-29T12:00:00.000000+00:00', eventId: 'event-created',
      methodProjectionSha256: currentMethod.projectionSha256, rulesSha256: RULES_SHA,
    },
    sourceSnapshotSha256: request.expectedSourceSnapshotSha256,
    authoritativeSourceSnapshotSha256: 'f'.repeat(64),
    methodReviewRequiredAfterRequest: currentMethod.projection.transition.methodReviewRequiredAfterRequest,
    boundedFindingRouteRequired: currentMethod.projection.transition.boundedFindingRouteRequired,
    changed: true,
    formalApprovalChanged: action === 'APPROVE',
    approvalInvalidated: action === 'INVALIDATE',
    reworkRequested: action === 'REQUEST_REWORK',
    resubmitted: action === 'RESUBMIT',
    selectionChanged: false, technicalPassChanged: false, reviewDecisionChanged: false,
    reworkExecuted: false, providerCalls: 0, budgetMutation: false,
    episodeVerificationChanged: false, humanSignoffInferred: false,
    evidenceLedgerMutation: false,
  }
}

function recovery(
  request: YimengTransitionTakeApprovalLifecycleRequest,
  currentMethod: ImagoTakeApprovalLifecycleMethodResponse,
  committed = false,
): YimengTakeApprovalLifecycleRecovery {
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-recovery.v1',
    projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
    takeId: request.takeId, expectedSourceSnapshotSha256: request.expectedSourceSnapshotSha256,
    idempotencyKey: request.idempotencyKey,
    status: committed ? 'committed' : 'not_found',
    result: committed ? result(request, currentMethod) : null,
  }
}

function makePort(
  source = feed(),
  currentMethod = method(source),
): MockPort {
  return {
    takeApprovalLifecycle: vi.fn<TakeApprovalLifecyclePort['takeApprovalLifecycle']>()
      .mockResolvedValue(source),
    takeApprovalLifecycleMethod: vi.fn<TakeApprovalLifecyclePort['takeApprovalLifecycleMethod']>()
      .mockResolvedValue(currentMethod),
    transitionTakeApprovalLifecycle:
      vi.fn<TakeApprovalLifecyclePort['transitionTakeApprovalLifecycle']>(),
    recoverTakeApprovalLifecycleTransition:
      vi.fn<TakeApprovalLifecyclePort['recoverTakeApprovalLifecycleTransition']>(),
  }
}

function panel(port: TakeApprovalLifecyclePort) {
  return <TakeApprovalLifecyclePanel {...SCOPE} refresh={0} port={port} t={t} />
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

describe('Take approval lifecycle recovery marker', () => {
  it('round-trips one exact intent and never overwrites an unresolved marker', () => {
    const marker: TakeApprovalLifecycleRecoveryMarker = {
      schema: 'qingmu.take-approval-lifecycle-recovery-marker.v1', ...SCOPE,
      expectedSourceSnapshotSha256: 'a'.repeat(64), takeId: 'take-1', action: 'APPROVE',
      reason: '批准当前精确 Take。',
      idempotencyKey: `qingmu:take-approval-lifecycle:v1:${'1'.repeat(64)}`,
    }
    expect(writeTakeApprovalLifecycleRecoveryMarker(marker)).toBe(true)
    expect(readTakeApprovalLifecycleRecoveryMarker(SCOPE)).toEqual(marker)
    expect(writeTakeApprovalLifecycleRecoveryMarker({ ...marker, takeId: 'take-2' })).toBe(false)
    sessionStorage.setItem(takeApprovalLifecycleRecoveryKey(SCOPE), JSON.stringify({ ...marker, extra: true }))
    expect(readTakeApprovalLifecycleRecoveryMarker(SCOPE)).toBeUndefined()
  })
})

describe('Take approval lifecycle panel', () => {
  it('shows only the current legal action and records an exact approval without adjacent authority', async () => {
    const source = feed()
    const currentMethod = method(source)
    const port = makePort(source, currentMethod)
    port.transitionTakeApprovalLifecycle.mockImplementation(async request => result(request, currentMethod))
    render(panel(port))

    const region = await screen.findByRole('region', { name: zh.takeApprovalLifecycleTitle })
    expect(within(region).getByText(zh.takeApprovalLifecycleStateReadyForApproval)).toBeTruthy()
    expect(within(region).getByText(zh.takeApprovalLifecycleNotSignoff)).toBeTruthy()
    expect(within(region).getAllByRole('button')).toHaveLength(1)
    fireEvent.change(within(region).getByLabelText(zh.takeApprovalLifecycleReason), {
      target: { value: '  已核对当前决定与 QC。  ' },
    })
    fireEvent.click(within(region).getByRole('button', { name: zh.takeApprovalLifecycleApprove }))

    await waitFor(() => { expect(port.transitionTakeApprovalLifecycle).toHaveBeenCalledOnce() })
    const request = port.transitionTakeApprovalLifecycle.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      ...SCOPE, expectedSourceSnapshotSha256: source.sourceSnapshotSha256,
      takeId: source.source.currentTake.takeSubject.takeId,
      action: 'APPROVE', reason: '已核对当前决定与 QC。',
    })
    expect(Object.keys(request ?? {}).sort()).toEqual([
      'projectId', 'episodeId', 'frameId', 'expectedSourceSnapshotSha256',
      'takeId', 'action', 'reason', 'idempotencyKey',
    ].sort())
    expect(await within(region).findByText(zh.takeApprovalLifecycleSubmitted)).toBeTruthy()
    expect(sessionStorage.getItem(takeApprovalLifecycleRecoveryKey(SCOPE))).toBeNull()
  })

  it('recovers an ambiguous POST with GET only and never sends a duplicate transition', async () => {
    const source = feed()
    const currentMethod = method(source)
    const port = makePort(source, currentMethod)
    port.transitionTakeApprovalLifecycle.mockRejectedValue(new Error('ambiguous transport'))
    port.recoverTakeApprovalLifecycleTransition.mockImplementation(async request =>
      recovery(request, currentMethod, true))
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeApprovalLifecycleTitle })
    fireEvent.change(within(region).getByLabelText(zh.takeApprovalLifecycleReason), {
      target: { value: '批准当前精确 Take。' },
    })
    fireEvent.click(within(region).getByRole('button', { name: zh.takeApprovalLifecycleApprove }))

    expect(await within(region).findByText(zh.takeApprovalLifecycleSubmitted)).toBeTruthy()
    expect(port.transitionTakeApprovalLifecycle).toHaveBeenCalledOnce()
    expect(port.recoverTakeApprovalLifecycleTransition).toHaveBeenCalledOnce()
    expect(Object.keys(port.recoverTakeApprovalLifecycleTransition.mock.calls[0]?.[0] ?? {}).sort())
      .toEqual([
        'projectId', 'episodeId', 'frameId', 'expectedSourceSnapshotSha256',
        'takeId', 'action', 'reason', 'idempotencyKey',
      ].sort())
    expect(sessionStorage.getItem(takeApprovalLifecycleRecoveryKey(SCOPE))).toBeNull()
  })

  it('surfaces the third same-class method-review boundary and keeps rework record-only', async () => {
    const source = feed()
    const currentMethod = method(source, {
      state: 'REWORK_REQUIRED', legalActions: ['REQUEST_REWORK'],
      reworkClassCodes: ['IDENTITY'], sameClassReworkCount: 2, sameClassCountAfterRequest: 3,
      methodReviewRequiredAfterRequest: true, boundedFindingRouteRequired: true,
    })
    const port = makePort(source, currentMethod)
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeApprovalLifecycleTitle })
    expect(within(region).getByText(zh.takeApprovalLifecycleBoundedRoute)).toBeTruthy()
    expect(within(region).getByText(zh.takeApprovalLifecycleMethodReviewAfterRequest)).toBeTruthy()
    expect(within(region).getByRole('button', { name: zh.takeApprovalLifecycleRequestRework })).toBeTruthy()
  })

  it('fails closed when the Method is not bound to the fresh Yimeng source', async () => {
    const source = feed()
    const currentMethod = method(source)
    const port = makePort(source, {
      ...currentMethod,
      projection: { ...currentMethod.projection, sourceSnapshotSha256: '0'.repeat(64) },
    })
    render(panel(port))
    expect(await screen.findByText(zh.takeApprovalLifecycleLoadError)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.takeApprovalLifecycleApprove })).toBeNull()
  })
})
