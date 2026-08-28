// @vitest-environment jsdom
import { createHmac, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ImagoReworkRouteMethodResponse, QingmuYimengPort, YimengRecordReworkRouteRequest,
  YimengReworkRouteAuthorityProbe, YimengReworkRouteRecovery, YimengReworkRouteResult,
  YimengReworkRouteSourceResponse, YimengShotFinding,
} from '../src/client/contracts.ts'
import { ReworkRouteControl } from '../src/client/ReworkRouteControl.tsx'
import {
  verifyReworkRouteAuthority, verifyReworkRouteReceipt, verifyReworkRouteRecovery,
} from '../src/client/rework-route-contract.ts'
import {
  createReworkRouteMarker, readReworkRouteMarker, writeReworkRouteMarker,
  type ReworkRouteRecoveryMarker,
} from '../src/client/rework-route-recovery.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  REWORK_ROUTE_IDS, REWORK_ROUTE_PLAN_RULES_SHA256, reworkRouteDefinition, reworkRouteFeed,
  reworkRouteInstruction, reworkRouteSha, reworkRouteSubject,
} from '../../qingmu-yimeng-read-adapter/tests/rework-route-fixture.ts'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'

type RoutePort = Pick<QingmuYimengPort,
  'reworkRouteSource' | 'reworkRouteMethod' | 'recordReworkRoute' | 'recoverReworkRoute'
  | 'probeReworkRouteAuthority'>
interface TestAuthority {
  readonly method: ImagoReworkRouteMethodResponse
  readonly source: YimengReworkRouteSourceResponse
  readonly probe: YimengReworkRouteAuthorityProbe
}

const t = (key: QingmuCockpitKey) => zh[key]
const key = 'ui-route-key'

function reworkRouteMethodResponse(attestationKey: string): ImagoReworkRouteMethodResponse {
  const ruleBindings = {
    'docs/qingmu-os/report-source.md': '1'.repeat(64),
    'pipeline/v6-stage-contracts.json': '2'.repeat(64),
    'scripts/compile_qingmu_rework_route_method.py': '3'.repeat(64),
  }
  const lockRuleBindings = { 'pipeline/v6-stage-contracts.json': '2'.repeat(64) }
  const lockRulesSha256 = reworkRouteSha(lockRuleBindings)
  const subject = reworkRouteSubject(REWORK_ROUTE_PLAN_RULES_SHA256, lockRulesSha256)
  const projection = {
    schema: 'qingmu.imago-bounded-rework-route-method.v1' as const,
    subject,
    subjectSnapshotSha256: reworkRouteSha(subject),
    definition: reworkRouteDefinition(subject),
    routeInstruction: reworkRouteInstruction(subject),
    ruleBindings,
    rulesSha256: reworkRouteSha(ruleBindings),
    lockRuleBindings,
    lockRulesSha256,
  }
  const projectionSha256 = reworkRouteSha(projection)
  const unsigned = {
    schema: 'qingmu.imago-bounded-rework-route-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    subjectSnapshotSha256: projection.subjectSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-bounded-rework-route-method-adapter-result.v1',
    projection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', attestationKey).update(continuityJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

function reworkRouteCommandResult(
  request: YimengRecordReworkRouteRequest,
  method: ImagoReworkRouteMethodResponse,
  token: string,
): YimengReworkRouteResult {
  const route = {
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    revision: request.expectedRouteRevision + 1,
    subject: method.projection.subject,
    subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
    definition: method.projection.definition,
    routeInstruction: method.projection.routeInstruction,
    methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
    actorId: 'route-owner',
    actorNaturalPersonId: 'natural-route-owner',
    authSessionId: reworkRouteSha(token),
    eventId: 'event-route-record-1',
    changeSetId: 'changeset-route-record-1',
    routedAt: '2026-08-28T01:00:00Z',
  }
  return {
    schema: 'jason.qingmu-bounded-rework-route-result.v1',
    route,
    routeSha256: reworkRouteSha(route),
    receiptId: 'receipt-route-record-1',
    outboxEventId: route.eventId,
    routeRecorded: true,
    findingClosed: false,
    selectionChanged: false,
    stageDecisionChanged: false,
    lockInvalidated: false,
    taskCreated: false,
    providerCalls: 0,
    reworkExecuted: false,
    humanSignoffInferred: false,
  } as unknown as YimengReworkRouteResult
}

function reworkRouteRecovery(
  request: YimengRecordReworkRouteRequest,
  result: YimengReworkRouteResult | null,
): YimengReworkRouteRecovery {
  return {
    schema: 'jason.qingmu-bounded-rework-route-recovery.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    findingId: request.findingId,
    expectedSubjectSha256: request.expectedSubjectSha256,
    expectedRouteRevision: request.expectedRouteRevision,
    expectedRouteSha256: request.expectedRouteSha256,
    idempotencyKey: request.idempotencyKey,
    found: result !== null,
    result,
  }
}

function reworkRouteAuthorityProbe(
  method: ImagoReworkRouteMethodResponse,
  latestRoute: YimengReworkRouteResult | null,
  currentRouteRecorded: boolean,
): YimengReworkRouteAuthorityProbe {
  return {
    schema: 'jason.qingmu-bounded-rework-route-authority-probe.v1',
    projectId: REWORK_ROUTE_IDS.projectId,
    episodeId: REWORK_ROUTE_IDS.episodeId,
    findingId: REWORK_ROUTE_IDS.findingId,
    subjectSnapshotSha256: method.projection.subjectSnapshotSha256,
    methodProjectionSha256: method.projectionSha256,
    rulesSha256: method.projection.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
    latestRoute,
    currentRouteRecorded,
    routeRecorded: currentRouteRecorded,
    findingClosed: false,
    selectionChanged: false,
    stageDecisionChanged: false,
    lockInvalidated: false,
    taskCreated: false,
    providerCalls: 0,
    reworkExecuted: false,
    humanSignoffInferred: false,
  }
}

function finding(method = reworkRouteMethodResponse(key)): YimengShotFinding {
  return {
    ...method.projection.subject.finding,
    subject: method.projection.subject.selectedVideo,
    actorId: 'reviewer-1',
    actorRole: 'reviewer',
    authSessionId: '0'.repeat(64),
    createdAt: '2026-08-28T00:00:00Z',
  }
}

function routeAuthority(
  method: ImagoReworkRouteMethodResponse,
  latestRoute: YimengReworkRouteResult | null = null,
  currentRouteRecorded = false,
  canRecordRoute = true,
): TestAuthority {
  const request = {
    ...REWORK_ROUTE_IDS,
    routeRulesSha256: method.projection.rulesSha256,
    planRulesSha256: method.projection.subject.sealedPlan.rulesSha256,
    lockRulesSha256: method.projection.lockRulesSha256,
  }
  const source = {
    ...reworkRouteFeed(request),
    capabilities: { canRecordRoute },
    latestRoute,
    latestRouteSourceCurrent: currentRouteRecorded,
  } as unknown as YimengReworkRouteSourceResponse
  const probe = reworkRouteAuthorityProbe(method, latestRoute, currentRouteRecorded)
  return { method, source, probe }
}

function makePort(authority = routeAuthority(reworkRouteMethodResponse(key))) {
  return {
    reworkRouteMethod: vi.fn<RoutePort['reworkRouteMethod']>().mockResolvedValue(authority.method),
    reworkRouteSource: vi.fn<RoutePort['reworkRouteSource']>().mockResolvedValue(authority.source),
    probeReworkRouteAuthority: vi.fn<RoutePort['probeReworkRouteAuthority']>().mockResolvedValue(authority.probe),
    recordReworkRoute: vi.fn<RoutePort['recordReworkRoute']>(),
    recoverReworkRoute: vi.fn<RoutePort['recoverReworkRoute']>(),
  }
}

function view(port: RoutePort, item = finding(), currentBinding = true) {
  return <ReworkRouteControl {...REWORK_ROUTE_IDS} finding={item} currentBinding={currentBinding} port={port} t={t} />
}

async function emptyHeadMarker(method = reworkRouteMethodResponse(key)) {
  return await createReworkRouteMarker({
    ...REWORK_ROUTE_IDS,
    expectedSubjectSha256: method.projection.subjectSnapshotSha256,
    expectedRouteRevision: 0,
    expectedRouteSha256: null,
  })
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

describe('bounded rework route control', () => {
  it('persists one exact-CAS intent, sends one POST, then displays only a fresh authority read', async () => {
    const method = reworkRouteMethodResponse(key)
    let latest: YimengReworkRouteResult | null = null
    const port = makePort()
    port.reworkRouteSource.mockImplementation(async () => routeAuthority(method, latest, latest !== null).source)
    port.probeReworkRouteAuthority.mockImplementation(async () => routeAuthority(method, latest, latest !== null).probe)
    port.recordReworkRoute.mockImplementation(async (request) => {
      const stored = readReworkRouteMarker(request)
      expect(stored.status).toBe('ready')
      latest = reworkRouteCommandResult(request, method, 'session-token')
      return latest
    })

    render(view(port, finding(method)))
    const button = await screen.findByRole('button', { name: zh.findingRouteRecord })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(await screen.findByText(zh.findingRouteCurrent)).toBeTruthy()
    expect(port.recordReworkRoute).toHaveBeenCalledOnce()
    const request = port.recordReworkRoute.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('Route request missing')
    expect(Object.keys(request).sort()).toEqual([
      'episodeId', 'expectedRouteRevision', 'expectedRouteSha256', 'expectedSubjectSha256', 'findingId',
      'frameId', 'idempotencyKey', 'projectId',
    ])
    expect(request.expectedRouteRevision).toBe(0)
    expect(request.expectedRouteSha256).toBeNull()
    expect(request.idempotencyKey).toMatch(/^qingmu:rework-route:v1:[0-9a-f]{64}$/)
    expect(readReworkRouteMarker(request).status).toBe('none')
    expect(port.reworkRouteMethod).toHaveBeenCalledTimes(2)
    expect(port.reworkRouteSource).toHaveBeenCalledTimes(2)
    expect(port.probeReworkRouteAuthority).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: zh.findingRouteAlreadyRecorded }).hasAttribute('disabled')).toBe(true)
    expect(latest).toMatchObject({
      findingClosed: false, selectionChanged: false, stageDecisionChanged: false, lockInvalidated: false,
      taskCreated: false, providerCalls: 0, reworkExecuted: false, humanSignoffInferred: false,
    })
  })

  it('labels a latest route as historical when the fresh probe does not qualify it as current', async () => {
    const method = reworkRouteMethodResponse(key)
    const result = reworkRouteCommandResult(await emptyHeadMarker(method), method, 'session-token')
    const port = makePort(routeAuthority(method, result, false))
    render(view(port, finding(method)))
    expect(await screen.findByText(zh.findingRouteHistorical)).toBeTruthy()
    expect(screen.queryByText(zh.findingRouteCurrent)).toBeNull()
    expect(screen.getByRole('button', { name: zh.findingRouteRecord }).hasAttribute('disabled')).toBe(false)
  })

  it('recovers with only the original CAS/key, never POSTs, and then performs a fresh authority read', async () => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    expect(writeReworkRouteMarker(marker)).toBe(true)
    let latest: YimengReworkRouteResult | null = null
    const port = makePort()
    port.recoverReworkRoute.mockImplementation(async (request) => {
      latest = reworkRouteCommandResult(request, method, 'session-token')
      return reworkRouteRecovery(request, latest)
    })
    port.reworkRouteSource.mockImplementation(async () => routeAuthority(method, latest, latest !== null).source)
    port.probeReworkRouteAuthority.mockImplementation(async () => routeAuthority(method, latest, latest !== null).probe)

    render(view(port, finding(method)))
    expect(port.reworkRouteMethod).not.toHaveBeenCalled()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRouteRecover }))

    expect(await screen.findByText(zh.findingRouteCurrent)).toBeTruthy()
    expect(port.recoverReworkRoute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ...REWORK_ROUTE_IDS, expectedSubjectSha256: marker.expectedSubjectSha256,
        expectedRouteRevision: 0, expectedRouteSha256: null, idempotencyKey: marker.idempotencyKey }),
      expect.any(AbortSignal),
    )
    expect(Object.keys(port.recoverReworkRoute.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'episodeId', 'expectedRouteRevision', 'expectedRouteSha256', 'expectedSubjectSha256', 'findingId',
      'frameId', 'idempotencyKey', 'projectId',
    ])
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
    expect(port.reworkRouteMethod).toHaveBeenCalledOnce()
    expect(port.reworkRouteSource).toHaveBeenCalledOnce()
    expect(port.probeReworkRouteAuthority).toHaveBeenCalledOnce()
    expect(readReworkRouteMarker(marker).status).toBe('none')
  })

  it('keeps a not-found recovery marker and makes no Method/source/probe/POST call', async () => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    expect(writeReworkRouteMarker(marker)).toBe(true)
    const port = makePort()
    port.recoverReworkRoute.mockResolvedValue(reworkRouteRecovery(marker, null))
    render(view(port, finding(method)))
    fireEvent.click(screen.getByRole('button', { name: zh.findingRouteRecover }))
    expect(await screen.findByText(zh.findingRouteNotFound)).toBeTruthy()
    expect(readReworkRouteMarker(marker)).toEqual({ status: 'ready', marker })
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
    expect(port.reworkRouteMethod).not.toHaveBeenCalled()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
  })

  it('settles a confirmed recovery receipt before a failed fresh Method read', async () => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    expect(writeReworkRouteMarker(marker)).toBe(true)
    const result = reworkRouteCommandResult(marker, method, 'session-token')
    const port = makePort()
    port.recoverReworkRoute.mockResolvedValue(reworkRouteRecovery(marker, result))
    port.reworkRouteMethod.mockRejectedValue(new Error('fresh Method unavailable'))

    render(view(port, finding(method)))
    fireEvent.click(screen.getByRole('button', { name: zh.findingRouteRecover }))
    expect(await screen.findByText(zh.findingRouteReceiptConfirmedAuthorityUnavailable)).toBeTruthy()
    expect(screen.getByText(zh.findingRouteUnavailable)).toBeTruthy()
    expect(screen.queryByText(zh.findingRouteUncertain)).toBeNull()
    expect(screen.queryByText(zh.findingRouteCurrent)).toBeNull()
    expect(readReworkRouteMarker(marker).status).toBe('none')
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
    expect(port.reworkRouteMethod).toHaveBeenCalledOnce()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
  })

  it('settles a historical Finding receipt without reading current authority', async () => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    expect(writeReworkRouteMarker(marker)).toBe(true)
    const result = reworkRouteCommandResult(marker, method, 'session-token')
    const port = makePort()
    port.recoverReworkRoute.mockResolvedValue(reworkRouteRecovery(marker, result))

    render(view(port, finding(method), false))
    fireEvent.click(screen.getByRole('button', { name: zh.findingRouteRecover }))
    expect(await screen.findByText(zh.findingRouteHistoricalReceiptConfirmed)).toBeTruthy()
    expect(screen.getByText(zh.findingRouteHistoricalFinding)).toBeTruthy()
    expect(readReworkRouteMarker(marker).status).toBe('none')
    expect(port.recoverReworkRoute).toHaveBeenCalledOnce()
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
    expect(port.reworkRouteMethod).not.toHaveBeenCalled()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
  })

  it('settles a confirmed record receipt before a failed fresh authority read', async () => {
    const method = reworkRouteMethodResponse(key)
    const port = makePort()
    port.reworkRouteMethod.mockResolvedValueOnce(method).mockRejectedValueOnce(new Error('fresh Method unavailable'))
    port.recordReworkRoute.mockImplementation(async request => reworkRouteCommandResult(request, method, 'session-token'))

    render(view(port, finding(method)))
    fireEvent.click(await screen.findByRole('button', { name: zh.findingRouteRecord }))
    expect(await screen.findByText(zh.findingRouteReceiptConfirmedAuthorityUnavailable)).toBeTruthy()
    expect(screen.getByText(zh.findingRouteUnavailable)).toBeTruthy()
    expect(screen.queryByText(zh.findingRouteUncertain)).toBeNull()
    expect(screen.queryByText(zh.findingRouteCurrent)).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(port.recordReworkRoute).toHaveBeenCalledOnce()
    expect(port.reworkRouteMethod).toHaveBeenCalledTimes(2)
    expect(port.reworkRouteSource).toHaveBeenCalledOnce()
    expect(port.probeReworkRouteAuthority).toHaveBeenCalledOnce()
  })

  it('disables recording without permission', async () => {
    const method = reworkRouteMethodResponse(key)
    const port = makePort(routeAuthority(method, null, false, false))
    render(view(port, finding(method)))
    expect(await screen.findByText(zh.findingRoutePermission)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.findingRouteRecord }).hasAttribute('disabled')).toBe(true)
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
  })

  it('refuses an incomplete Method with no sealed plan', async () => {
    const method = reworkRouteMethodResponse(key)
    const subject = { ...method.projection.subject, sealedPlan: undefined }
    const projection = { ...method.projection, subject, subjectSnapshotSha256: reworkRouteSha(subject) }
    const invalid = {
      ...method,
      projection: { ...projection, projectionSha256: undefined },
      projectionSha256: reworkRouteSha(projection),
      methodAttestation: { ...method.methodAttestation, subjectSnapshotSha256: projection.subjectSnapshotSha256,
        methodProjectionSha256: reworkRouteSha(projection) },
    } as unknown as ImagoReworkRouteMethodResponse
    const port = makePort()
    port.reworkRouteMethod.mockResolvedValue(invalid)
    render(view(port, finding(method)))
    expect(await screen.findByText(zh.findingRouteUnavailable)).toBeTruthy()
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
  })

  it('never reads or writes a route for a historical Finding binding', async () => {
    const method = reworkRouteMethodResponse(key)
    const port = makePort()
    render(view(port, finding(method), false))
    expect(screen.getByText(zh.findingRouteHistoricalFinding)).toBeTruthy()
    expect(port.reworkRouteMethod).not.toHaveBeenCalled()
    expect(port.reworkRouteSource).not.toHaveBeenCalled()
    expect(port.probeReworkRouteAuthority).not.toHaveBeenCalled()
    expect(port.recordReworkRoute).not.toHaveBeenCalled()
  })

  it('aborts pending reads on coordinate switch and unmount', async () => {
    const signals: AbortSignal[] = []
    const port = makePort()
    port.reworkRouteMethod.mockImplementation((_request, signal) => {
      if (signal !== undefined) signals.push(signal)
      return new Promise(() => undefined)
    })
    const method = reworkRouteMethodResponse(key)
    const mounted = render(view(port, finding(method)))
    await waitFor(() => { expect(signals).toHaveLength(1) })
    const nextFinding = { ...finding(method), id: 'finding-8' }
    mounted.rerender(<ReworkRouteControl {...REWORK_ROUTE_IDS} findingId="finding-8" finding={nextFinding}
      currentBinding port={port} t={t} />)
    await waitFor(() => { expect(signals).toHaveLength(2) })
    expect(signals[0]?.aborted).toBe(true)
    mounted.unmount()
    expect(signals[1]?.aborted).toBe(true)
  })
})

describe('bounded rework route client trust boundary', () => {
  it.each([
    ['findingClosed', true], ['selectionChanged', true], ['stageDecisionChanged', true],
    ['lockInvalidated', true], ['taskCreated', true], ['providerCalls', 1],
    ['reworkExecuted', true], ['humanSignoffInferred', true],
  ] as const)('rejects a source adjacent-authority invariant %s', async (field, value) => {
    const method = reworkRouteMethodResponse(key)
    const authority = routeAuthority(method)
    const altered = { ...authority, source: { ...authority.source, [field]: value } }
    await expect(verifyReworkRouteAuthority(altered, REWORK_ROUTE_IDS, finding(method))).rejects.toThrow()
  })

  it.each([
    ['findingClosed', true], ['selectionChanged', true], ['stageDecisionChanged', true],
    ['lockInvalidated', true], ['taskCreated', true], ['providerCalls', 1],
    ['reworkExecuted', true], ['humanSignoffInferred', true],
  ] as const)('rejects a probe adjacent-authority invariant %s', async (field, value) => {
    const method = reworkRouteMethodResponse(key)
    const authority = routeAuthority(method)
    const altered = { ...authority, probe: { ...authority.probe, [field]: value } }
    await expect(verifyReworkRouteAuthority(altered, REWORK_ROUTE_IDS, finding(method))).rejects.toThrow()
  })

  it('rejects an outbox event that is not the route event', async () => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    const result = { ...reworkRouteCommandResult(marker, method, 'session-token'), outboxEventId: 'another-event' }
    await expect(verifyReworkRouteReceipt(result, marker)).rejects.toThrow()
  })

  it.each(['projectId', 'episodeId', 'frameId', 'findingId'] as const)(
    'rejects a route whose nested subject %s does not match its outer coordinates', async (field) => {
      const method = reworkRouteMethodResponse(key)
      const baseMarker = await emptyHeadMarker(method)
      const base = reworkRouteCommandResult(baseMarker, method, 'session-token')
      const selectedVideo = field === 'frameId'
        ? { ...base.route.subject.selectedVideo, frameId: 'another-frame' }
        : base.route.subject.selectedVideo
      const nestedFinding = field === 'findingId'
        ? { ...base.route.subject.finding, id: 'another-finding' }
        : base.route.subject.finding
      const subject = {
        ...base.route.subject,
        ...(field === 'projectId' ? { projectId: 'another-project' } : {}),
        ...(field === 'episodeId' ? { episodeId: 'another-episode' } : {}),
        selectedVideo,
        finding: nestedFinding,
      }
      const route = { ...base.route, subject, subjectSnapshotSha256: reworkRouteSha(subject) }
      const result = { ...base, route, routeSha256: reworkRouteSha(route) }
      const marker: ReworkRouteRecoveryMarker = { ...baseMarker, expectedSubjectSha256: route.subjectSnapshotSha256 }
      await expect(verifyReworkRouteReceipt(result, marker)).rejects.toThrow()
    },
  )

  it.each([
    ['projectId', 'another-project'], ['expectedRouteRevision', 1], ['expectedRouteSha256', 'a'.repeat(64)],
    ['idempotencyKey', `qingmu:rework-route:v1:${'f'.repeat(64)}`],
  ] as const)('rejects recovery with altered original %s', async (field, value) => {
    const method = reworkRouteMethodResponse(key)
    const marker = await emptyHeadMarker(method)
    const recovery = { ...reworkRouteRecovery(marker, null), [field]: value }
    await expect(verifyReworkRouteRecovery(recovery, marker)).rejects.toThrow()
  })

  it('rejects a route-head revision that cannot be safely incremented', async () => {
    await expect(createReworkRouteMarker({
      ...REWORK_ROUTE_IDS,
      expectedSubjectSha256: 'a'.repeat(64),
      expectedRouteRevision: Number.MAX_SAFE_INTEGER,
      expectedRouteSha256: 'b'.repeat(64),
    })).rejects.toThrow('Invalid route marker')
  })
})
