// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  YimengRecordTakeTechnicalQcRequest,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
} from '../src/client/contracts.ts'
import {
  TakeTechnicalQcPanel,
  type TakeTechnicalQcPort,
} from '../src/client/TakeTechnicalQcPanel.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  readTakeTechnicalQcRecoveryMarker,
  takeTechnicalQcRecoveryKey,
  writeTakeTechnicalQcRecoveryMarker,
  type TakeTechnicalQcRecoveryMarker,
} from '../src/client/take-technical-qc-recovery.ts'
import { takeAcceptanceFixture } from '../../qingmu-yimeng-read-adapter/tests/take-acceptance-fixture.ts'
import { takeVersionSha } from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'

type MockPort = {
  readonly [K in keyof TakeTechnicalQcPort]: ReturnType<typeof vi.fn<TakeTechnicalQcPort[K]>>
}

const t = (key: QingmuCockpitKey) => zh[key]
const SCOPE = { projectId: 'project-qc', episodeId: 'episode-qc', frameId: 'frame-qc' }
const CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const

function passChecks(): readonly YimengTakeTechnicalQcCheck[] {
  return CODES.map(code => ({ code, result: 'PASS', note: null, evidenceRefs: [] }))
}

function feed(
  takeId = 'asset-take-1',
  actorNaturalPersonId = 'reviewer-person',
  canRecordTechnicalQc = true,
): YimengTakeTechnicalQcFeedResponse {
  const acceptance = takeAcceptanceFixture(SCOPE)
  const takeSubject = {
    ...acceptance.evidence.subject,
    takeId,
    versionOrdinal: takeId === 'asset-take-1' ? 1 : 2,
    selectionRevision: takeId === 'asset-take-1' ? 1 : 2,
    outputSha256: takeId === 'asset-take-1' ? '2'.repeat(64) : '4'.repeat(64),
  }
  const takeSubjectSha256 = takeVersionSha(takeSubject)
  const evidenceSnapshotSha256 = takeId === 'asset-take-1'
    ? acceptance.evidenceSnapshotSha256 : '5'.repeat(64)
  const assessment: YimengTakeTechnicalQcFeedResponse['assessments'][number] = {
    assessmentId: `assessment-${takeId}`,
    takeSubject,
    takeSubjectSha256,
    evidenceSnapshotSha256,
    technicalReceiptStatus: 'PASS',
    checks: passChecks(),
    issueCodes: [],
    technicalPass: true,
    methodProjectionSha256: '6'.repeat(64),
    rulesSha256: '7'.repeat(64),
    actorId: `reviewer-${takeId}`,
    actorRole: 'reviewer',
    actorNaturalPersonId,
    authSessionId: '8'.repeat(64),
    recordedAt: '2026-08-29T10:03:00.123456+00:00',
    eventId: `event-${takeId}`,
    currentBinding: true,
  }
  return {
    schema: 'jason.qingmu-take-technical-qc-feed.v1',
    ...SCOPE,
    capabilities: { canRecordTechnicalQc },
    currentAcceptance: {
      takeSubject, takeSubjectSha256, evidenceSnapshotSha256,
      technicalReceiptStatus: 'PASS',
    },
    assessments: [assessment],
    currentAssessment: assessment,
    boundaries: {
      technicalQcOnly: true,
      technicalPassIsContentApproval: false,
      selectionChanged: false,
      formalApprovalChanged: false,
      episodeVerificationChanged: false,
      humanSignoffInferred: false,
      providerCalls: 0,
      budgetMutation: false,
      reworkExecutionAllowed: false,
      approvalInvalidationAllowed: false,
      evidenceLedgerMutation: false,
    },
  }
}

function result(
  request: YimengRecordTakeTechnicalQcRequest,
  source = feed(request.takeId),
): YimengTakeTechnicalQcResult {
  const issueCodes = request.checks.filter(check => check.result !== 'PASS').map(check => check.code)
  const technicalPass = source.currentAcceptance.technicalReceiptStatus === 'PASS'
    && issueCodes.length === 0
  return {
    schema: 'jason.qingmu-take-technical-qc-result.v1',
    assessment: {
      assessmentId: 'assessment-created',
      takeSubject: source.currentAcceptance.takeSubject,
      takeSubjectSha256: source.currentAcceptance.takeSubjectSha256,
      evidenceSnapshotSha256: request.expectedEvidenceSnapshotSha256,
      technicalReceiptStatus: source.currentAcceptance.technicalReceiptStatus,
      checks: request.checks,
      issueCodes,
      technicalPass,
      methodProjectionSha256: '6'.repeat(64),
      rulesSha256: '7'.repeat(64),
      actorId: 'reviewer-created',
      actorRole: 'reviewer',
      actorNaturalPersonId: 'reviewer-person-created',
      authSessionId: '9'.repeat(64),
      recordedAt: '2026-08-29T10:04:00.123456+00:00',
      eventId: 'event-created',
    },
    technicalQcRecorded: true,
    technicalPass,
    changed: false,
    selectionChanged: false,
    recommendationChanged: false,
    decisionRecorded: false,
    formalApprovalChanged: false,
    technicalPassChanged: false,
    episodeVerificationChanged: false,
    humanSignoffInferred: false,
    providerCalls: 0,
    budgetMutation: false,
  }
}

function recovery(
  request: YimengRecordTakeTechnicalQcRequest,
  committed = false,
): YimengTakeTechnicalQcRecovery {
  return {
    schema: 'jason.qingmu-take-technical-qc-recovery.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    frameId: request.frameId,
    takeId: request.takeId,
    expectedEvidenceSnapshotSha256: request.expectedEvidenceSnapshotSha256,
    idempotencyKey: request.idempotencyKey,
    status: committed ? 'committed' : 'not_found',
    result: committed ? result(request) : null,
  }
}

function makePort(source = feed()): MockPort {
  return {
    takeTechnicalQc: vi.fn<TakeTechnicalQcPort['takeTechnicalQc']>().mockResolvedValue(source),
    recordTakeTechnicalQc: vi.fn<TakeTechnicalQcPort['recordTakeTechnicalQc']>(),
    recoverTakeTechnicalQc: vi.fn<TakeTechnicalQcPort['recoverTakeTechnicalQc']>(),
  }
}

function pending<T>() {
  let accept: (value: T) => void = () => { throw new Error('promise not initialized') }
  const promise = new Promise<T>((resolve) => { accept = resolve })
  return { promise, resolve: (value: T) => { accept(value) } }
}

function panel(port: TakeTechnicalQcPort, selectedTakeId = 'asset-take-1') {
  return <TakeTechnicalQcPanel
    key={`${SCOPE.projectId}:${SCOPE.episodeId}:${SCOPE.frameId}:${selectedTakeId}`}
    {...SCOPE} refresh={0} port={port} t={t} />
}

function setEveryCheckToPass(region: HTMLElement): void {
  for (const select of within(region).getAllByRole('combobox', { name: zh.takeTechnicalQcResult })) {
    fireEvent.change(select, { target: { value: 'PASS' } })
  }
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

describe('Take technical-QC recovery marker', () => {
  it('uses Unicode code-point limits and never overwrites an unresolved marker', () => {
    const source = feed()
    const marker: TakeTechnicalQcRecoveryMarker = {
      schema: 'qingmu.take-technical-qc-recovery-marker.v1',
      projectId: '😀'.repeat(129),
      episodeId: SCOPE.episodeId,
      frameId: SCOPE.frameId,
      expectedEvidenceSnapshotSha256: source.currentAcceptance.evidenceSnapshotSha256,
      takeId: source.currentAcceptance.takeSubject.takeId,
      checks: passChecks(),
      idempotencyKey: `qingmu:take-technical-qc:v1:${'a'.repeat(64)}`,
    }
    expect(writeTakeTechnicalQcRecoveryMarker(marker)).toBe(true)
    expect(readTakeTechnicalQcRecoveryMarker(marker)).toEqual(marker)
    expect(writeTakeTechnicalQcRecoveryMarker({ ...marker, takeId: 'other-take' })).toBe(false)

    const oversized = { ...marker, projectId: '😀'.repeat(257) }
    expect(writeTakeTechnicalQcRecoveryMarker(oversized)).toBe(false)
  })
})

describe('Take technical-QC panel', () => {
  it('renders distinct 5-code macro and 7-code micro groups, authority boundaries, and natural-person history', async () => {
    const port = makePort()
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    const groups = within(region).getAllByRole('group')
    expect(groups).toHaveLength(2)
    expect(within(groups[0]!).getAllByText(/^[A-Z_]+$/u)).toHaveLength(5)
    expect(within(groups[1]!).getAllByText(/^[A-Z_]+$/u)).toHaveLength(7)
    expect(within(region).getByText(zh.takeTechnicalQcNotApproval)).toBeTruthy()
    expect(within(region).getByText(/reviewer-person/u)).toBeTruthy()
    expect(within(region).queryByText(/Stage|skill|Provider/i)).toBeNull()
  })

  it('is capability-driven and rejects non-PASS checks without both note and evidence before marker or POST', async () => {
    const readOnly = makePort(feed('asset-take-1', 'reviewer-person', false))
    const first = render(panel(readOnly))
    let region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    expect(within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit })
      .hasAttribute('disabled')).toBe(true)
    expect(within(region).getByText(zh.takeTechnicalQcReadOnly)).toBeTruthy()
    first.unmount()

    const port = makePort()
    render(panel(port))
    region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    fireEvent.change(within(region).getAllByLabelText(zh.takeTechnicalQcNote)[0]!, {
      target: { value: '\u001c\u001f' },
    })
    fireEvent.change(within(region).getAllByLabelText(zh.takeTechnicalQcEvidenceRefs)[0]!, {
      target: { value: 'frame://evidence/1' },
    })
    fireEvent.click(within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit }))
    expect(within(region).getAllByText(zh.takeTechnicalQcNonPassRequired).length).toBeGreaterThan(0)
    expect(port.recordTakeTechnicalQc).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('preserves and submits optional supporting note and evidence for a PASS check', async () => {
    const source = feed()
    const port = makePort(source)
    port.recordTakeTechnicalQc.mockImplementation(async request => result(request, source))
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    const note = within(region).getAllByLabelText(zh.takeTechnicalQcNote)[0] as HTMLTextAreaElement
    const evidence = within(region)
      .getAllByLabelText(zh.takeTechnicalQcEvidenceRefs)[0] as HTMLTextAreaElement
    fireEvent.change(note, { target: { value: '  镜头因果复核通过。  ' } })
    fireEvent.change(evidence, {
      target: { value: 'frame:002\nframe:001\nframe:002' },
    })
    fireEvent.change(
      within(region).getAllByRole('combobox', { name: zh.takeTechnicalQcResult })[0]!,
      { target: { value: 'PASS' } },
    )
    expect(note.value).toBe('  镜头因果复核通过。  ')
    expect(evidence.value).toBe('frame:002\nframe:001\nframe:002')
    setEveryCheckToPass(region)
    fireEvent.click(within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit }))
    expect(await within(region).findByText(zh.takeTechnicalQcSubmitted)).toBeTruthy()
    expect(port.recordTakeTechnicalQc.mock.calls[0]?.[0].checks[0]).toEqual({
      code: 'STORY_CAUSALITY',
      result: 'PASS',
      note: '镜头因果复核通过。',
      evidenceRefs: ['frame:001', 'frame:002'],
    })
  })

  it('writes the full seven-field intent before exactly one POST, sends no identity, clears it, and rereads authority', async () => {
    const source = feed()
    const port = makePort(source)
    port.recordTakeTechnicalQc.mockImplementation(async (request) => {
      expect(Object.keys(request).sort()).toEqual([
        'projectId', 'episodeId', 'frameId', 'expectedEvidenceSnapshotSha256',
        'takeId', 'checks', 'idempotencyKey',
      ].sort())
      expect(JSON.stringify(request)).not.toMatch(/actor|role|person|session|recordedAt|time/iu)
      expect(readTakeTechnicalQcRecoveryMarker(SCOPE)).toEqual({
        schema: 'qingmu.take-technical-qc-recovery-marker.v1', ...request,
      })
      return result(request, source)
    })
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    setEveryCheckToPass(region)
    const submit = within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(await within(region).findByText(zh.takeTechnicalQcSubmitted)).toBeTruthy()
    expect(port.recordTakeTechnicalQc).toHaveBeenCalledOnce()
    expect(port.recoverTakeTechnicalQc).not.toHaveBeenCalled()
    await waitFor(() => { expect(port.takeTechnicalQc).toHaveBeenCalledTimes(2) })
    expect(sessionStorage.getItem(takeTechnicalQcRecoveryKey(SCOPE))).toBeNull()
  })

  it('uses one GET recovery after an uncertain POST, keeps not-found coordinates locked, and never reposts', async () => {
    const port = makePort()
    port.recordTakeTechnicalQc.mockRejectedValue(new Error('connection dropped'))
    port.recoverTakeTechnicalQc.mockImplementation(async request => recovery(request, false))
    render(panel(port))
    const region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    setEveryCheckToPass(region)
    const submit = within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit })
    fireEvent.click(submit)
    expect(await within(region).findByText(zh.takeTechnicalQcUnknown)).toBeTruthy()
    expect(port.recordTakeTechnicalQc).toHaveBeenCalledOnce()
    expect(port.recoverTakeTechnicalQc).toHaveBeenCalledOnce()
    const request = port.recordTakeTechnicalQc.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('QC request missing')
    expect(readTakeTechnicalQcRecoveryMarker(SCOPE)).toEqual({
      schema: 'qingmu.take-technical-qc-recovery-marker.v1', ...request,
    })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(submit)
    expect(port.recordTakeTechnicalQc).toHaveBeenCalledOnce()
    expect(port.recoverTakeTechnicalQc).toHaveBeenCalledOnce()
  })

  it('recovers an existing marker by GET on mount without POST', async () => {
    const source = feed()
    const marker: TakeTechnicalQcRecoveryMarker = {
      schema: 'qingmu.take-technical-qc-recovery-marker.v1',
      ...SCOPE,
      expectedEvidenceSnapshotSha256: source.currentAcceptance.evidenceSnapshotSha256,
      takeId: source.currentAcceptance.takeSubject.takeId,
      checks: passChecks(),
      idempotencyKey: `qingmu:take-technical-qc:v1:${'b'.repeat(64)}`,
    }
    expect(writeTakeTechnicalQcRecoveryMarker(marker)).toBe(true)
    const port = makePort(source)
    port.recoverTakeTechnicalQc.mockResolvedValue(recovery(marker, true))
    render(panel(port))
    expect(await screen.findByText(zh.takeTechnicalQcSubmitted)).toBeTruthy()
    const { schema: _schema, ...request } = marker
    expect(port.recoverTakeTechnicalQc).toHaveBeenCalledExactlyOnceWith(
      request, expect.any(AbortSignal),
    )
    expect(port.recordTakeTechnicalQc).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(takeTechnicalQcRecoveryKey(SCOPE))).toBeNull()
  })

  it('aborts an old same-frame Selected-Take submit and ignores its deferred response after keyed remount', async () => {
    const firstFeed = feed('asset-take-1', 'person-old')
    const secondFeed = feed('asset-take-2', 'person-current')
    const deferred = pending<YimengTakeTechnicalQcResult>()
    const port = makePort(firstFeed)
    port.takeTechnicalQc.mockResolvedValueOnce(firstFeed).mockResolvedValue(secondFeed)
    let oldSignal: AbortSignal | undefined
    port.recordTakeTechnicalQc.mockImplementation(async (_request, signal) => {
      oldSignal = signal
      return await deferred.promise
    })
    const rendered = render(panel(port, 'asset-take-1'))
    let region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    setEveryCheckToPass(region)
    fireEvent.click(within(region).getByRole('button', { name: zh.takeTechnicalQcSubmit }))
    await waitFor(() => { expect(port.recordTakeTechnicalQc).toHaveBeenCalledOnce() })
    const request = port.recordTakeTechnicalQc.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('old QC request missing')

    rendered.rerender(panel(port, 'asset-take-2'))
    await waitFor(() => { expect(oldSignal?.aborted).toBe(true) })
    region = await screen.findByRole('region', { name: zh.takeTechnicalQcTitle })
    expect(await within(region).findByText(/person-current/u)).toBeTruthy()
    await act(async () => { deferred.resolve(result(request, firstFeed)) })
    expect(within(region).queryByText(zh.takeTechnicalQcSubmitted)).toBeNull()
    expect(within(region).getByText(/person-current/u)).toBeTruthy()
    expect(port.recordTakeTechnicalQc).toHaveBeenCalledOnce()
  })
})
