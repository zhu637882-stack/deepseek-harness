// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  QingmuYimengReadPort, YimengCapabilityCatalogResponse, YimengCostRehearsalResponse,
} from '../src/client/contracts.ts'
import { GenerationCostRehearsal } from '../src/client/GenerationCostRehearsal.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

type Port = Pick<QingmuYimengReadPort, 'capabilityCatalog' | 'costRehearsal'>
const t = (key: QingmuCockpitKey) => zh[key]
const sha = (character: string) => character.repeat(64)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function catalog(filtered = false): YimengCapabilityCatalogResponse {
  return {
    schema: 'jason.provider-capability-catalog.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    activeProfile: 'quality',
    catalogSnapshotSha256: sha(filtered ? 'e' : 'a'),
    requestSnapshotSha256: sha(filtered ? 'f' : 'b'),
    preflightSnapshotSha256: sha(filtered ? '1' : 'c'),
    request: filtered
      ? { modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'], dryRun: true }
      : { modelId: null, capability: null, requestedControls: [], dryRun: true },
    items: [{
      capabilitySnapshotId: `capability-snapshot:sha256:${sha('d')}`,
      capabilitySnapshotSha256: sha('d'),
      capabilitySnapshotCanonicalJson: '{}',
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
      snapshot: {
        schema: 'jason.provider-capability-snapshot.v1',
        modelId: 'fake-video-v1', providerId: 'fake', familyId: 'fake-video', displayName: '费用排练模型',
        enabled: true,
        inputs: { prompt: 'string' }, outputs: { video_url: 'url' },
        geometry: { min_duration_sec: 2, max_duration_sec: 8, max_outputs: 2, resolutions: ['720P'] },
        consistency: { capabilities: ['video.continuation', 'video.visual'], referenceAware: false },
        controls: ['video.continuation', 'video.visual'], mutualExclusions: [],
        cost: { currency: 'CNY', unit: 'second', by_resolution: { '720P': 0.6 } },
        runtime: { endpoint: '', endpointsByCapability: {}, deploymentScope: '', region: '' },
        compliance: {
          docs: ['test://cost-rehearsal'], evidenceLevel: 'L2', paidDispatchAllowed: false,
          paidDispatchByCapability: {}, productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        },
        declaration: {
          inputsDeclared: true, outputsDeclared: true, geometryDeclared: true,
          mutualExclusionsDeclared: true, errors: [],
        },
      },
      eligibility: filtered
        ? { evaluated: true, eligible: true, errors: [] }
        : { evaluated: false, eligible: false, errors: ['requirements_not_supplied'] },
    }],
    providerCalls: 0,
    databaseWrites: 0,
    paidGenerationAuthorized: false,
  }
}

function rehearsal(): YimengCostRehearsalResponse {
  const exact = catalog(true)
  return {
    schema: 'jason.provider-cost-rehearsal.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    mode: 'dry_run',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    subject: {
      projectId: 'project-1', episodeId: 'episode-1', frameId: 'frame-1', frameNumber: 12,
      frameUpdatedAt: '2026-08-28T01:02:03+00:00', durationMillis: 3000, subjectSnapshotSha256: sha('2'),
    },
    capabilityBinding: {
      modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'], resolution: '720P',
      catalogSnapshotSha256: exact.catalogSnapshotSha256,
      requestSnapshotSha256: exact.requestSnapshotSha256,
      preflightSnapshotSha256: exact.preflightSnapshotSha256,
      capabilitySnapshotId: exact.items[0]?.capabilitySnapshotId ?? '',
      capabilitySnapshotSha256: exact.items[0]?.capabilitySnapshotSha256 ?? '',
      eligibility: { evaluated: true, eligible: true, errors: [] }, paidDispatchAllowed: false,
    },
    costEstimate: {
      currency: 'CNY', unit: 'second', formula: 'duration_seconds_x_resolution_rate_x_candidates',
      resolution: '720P', rateMicrosPerSecond: 600000, oneCandidateMicros: 1800000,
      candidateCount: 2, maximumAllowedCandidateCount: 2, maximumCostMicros: 3600000,
      oneCandidateCny: '1.800000', maximumCostCny: '3.600000',
    },
    budgetWindow: {
      scope: 'global_provider_window', projectQuotaStatus: 'NOT_CONFIGURED', episodeQuotaStatus: 'NOT_CONFIGURED',
      valid: true, errors: [], windowId: 'window-1', baselineMicros: 0, allowanceMicros: 10000000,
      effectiveCapMicros: 10000000, lifetimeSpentMicros: 0, windowSpentMicros: 0, windowRemainingMicros: 10000000,
    },
    reservationRehearsal: {
      status: 'READY_NOT_RESERVED_DRY_RUN', blockers: [], proposedReservationMicros: 3600000,
      formallyReservedMicros: 0, formalReservationId: null, wouldFitBudget: true,
      remainingIfReservedMicros: 6400000, exactAuthorizationRequired: true, formalReservationAllowed: false,
    },
    difference: {
      estimateToProposedReservationMicros: 0, estimateToFormalReservationMicros: 3600000,
      actualCostMicros: null, actualVsProposedReservationMicros: null, releasedMicros: 0,
      refundMicros: null, actualCostStatus: 'UNAVAILABLE_BEFORE_SUBMIT',
    },
    rehearsalSnapshotSha256: sha('3'),
    providerCalls: 0, databaseWrites: 0, budgetLedgerWrites: 0, taskCreated: false, queueEntered: false,
    submitAttempted: false, pollAttempted: false, downloadAttempted: false, webhookRegistered: false,
    paidGenerationAuthorized: false,
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Gate A cost rehearsal', () => {
  it('runs only after an explicit click and renders estimate, proposed hold, formal zero, and zero authority', async () => {
    const port: Port = {
      capabilityCatalog: vi.fn<Port['capabilityCatalog']>().mockResolvedValue(catalog(true)),
      costRehearsal: vi.fn<Port['costRehearsal']>().mockResolvedValue(rehearsal()),
    }
    render(<GenerationCostRehearsal projectId="project-1" episodeId="episode-1" selectedShotId="frame-1"
      catalog={catalog()} enabled port={port} t={t} />)

    expect(port.capabilityCatalog).not.toHaveBeenCalled()
    expect(port.costRehearsal).not.toHaveBeenCalled()
    expect(screen.getByLabelText(zh.costRehearsalCandidateCount).options).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(zh.costRehearsalCandidateCount), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: zh.costRehearsalAction }))

    await waitFor(() => { expect(port.costRehearsal).toHaveBeenCalledOnce() })
    expect(port.capabilityCatalog).toHaveBeenCalledExactlyOnceWith({
      modelId: 'fake-video-v1', capability: 'video.visual', requestedControls: ['video.visual'],
    }, expect.any(AbortSignal))
    expect(port.costRehearsal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      projectId: 'project-1', episodeId: 'episode-1', frameId: 'frame-1', modelId: 'fake-video-v1',
      capability: 'video.visual', requestedControls: ['video.visual'], resolution: '720P', candidateCount: 2,
      capabilityCatalog: catalog(true),
      catalogSnapshotSha256: sha('e'), requestSnapshotSha256: sha('f'), preflightSnapshotSha256: sha('1'),
      capabilitySnapshotSha256: sha('d'),
    }), expect.any(AbortSignal))
    expect(screen.getAllByText('¥3.600000')).toHaveLength(2)
    expect(screen.getByText('¥0.000000')).toBeTruthy()
    expect(screen.getByText(zh.costRehearsalActualUnavailable)).toBeTruthy()
    expect(screen.getAllByText(zh.costRehearsalNotConfigured)).toHaveLength(2)
    expect(screen.getByText(zh.costRehearsalZeroAuthority)).toBeTruthy()
  })

  it('cannot call either endpoint without a selected authoritative frame', () => {
    const port: Port = {
      capabilityCatalog: vi.fn<Port['capabilityCatalog']>(),
      costRehearsal: vi.fn<Port['costRehearsal']>(),
    }
    render(<GenerationCostRehearsal projectId="project-1" episodeId="episode-1" selectedShotId=""
      catalog={catalog()} enabled port={port} t={t} />)

    expect(screen.getByText(zh.costRehearsalSelectShot)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.costRehearsalAction }).hasAttribute('disabled')).toBe(true)
    expect(port.capabilityCatalog).not.toHaveBeenCalled()
    expect(port.costRehearsal).not.toHaveBeenCalled()
  })

  it('rejects an exact-catalog failure without displaying a stale receipt', async () => {
    const port: Port = {
      capabilityCatalog: vi.fn<Port['capabilityCatalog']>()
        .mockResolvedValueOnce(catalog(true))
        .mockRejectedValueOnce(new Error('exact snapshot changed')),
      costRehearsal: vi.fn<Port['costRehearsal']>().mockResolvedValue(rehearsal()),
    }
    render(<GenerationCostRehearsal projectId="project-1" episodeId="episode-1" selectedShotId="frame-1"
      catalog={catalog()} enabled port={port} t={t} />)
    const action = screen.getByRole('button', { name: zh.costRehearsalAction })

    fireEvent.change(screen.getByLabelText(zh.costRehearsalCandidateCount), { target: { value: '2' } })
    fireEvent.click(action)
    expect(await screen.findAllByText('¥3.600000')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(zh.costRehearsalCandidateCount), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: zh.costRehearsalAction }))

    expect((await screen.findByRole('alert')).textContent).toContain('exact snapshot changed')
    expect(screen.queryByText('¥3.600000')).toBeNull()
    expect(port.costRehearsal).toHaveBeenCalledOnce()
  })

  it('keeps the newer frame receipt when an aborted older request resolves late', async () => {
    const first = deferred<YimengCostRehearsalResponse>()
    const second = deferred<YimengCostRehearsalResponse>()
    const newer = {
      ...rehearsal(),
      subject: { ...rehearsal().subject, frameId: 'frame-2' },
      costEstimate: {
        ...rehearsal().costEstimate,
        rateMicrosPerSecond: 800000,
        oneCandidateMicros: 2400000,
        maximumCostMicros: 4800000,
        oneCandidateCny: '2.400000',
        maximumCostCny: '4.800000',
      },
      reservationRehearsal: {
        ...rehearsal().reservationRehearsal,
        proposedReservationMicros: 4800000,
        remainingIfReservedMicros: 5200000,
      },
      difference: {
        ...rehearsal().difference,
        estimateToFormalReservationMicros: 4800000,
      },
    } satisfies YimengCostRehearsalResponse
    const port: Port = {
      capabilityCatalog: vi.fn<Port['capabilityCatalog']>().mockResolvedValue(catalog(true)),
      costRehearsal: vi.fn<Port['costRehearsal']>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    }
    const view = render(
      <GenerationCostRehearsal projectId="project-1" episodeId="episode-1" selectedShotId="frame-1"
        catalog={catalog()} enabled port={port} t={t} />,
    )
    fireEvent.change(screen.getByLabelText(zh.costRehearsalCandidateCount), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: zh.costRehearsalAction }))
    await waitFor(() => { expect(port.costRehearsal).toHaveBeenCalledOnce() })

    view.rerender(
      <GenerationCostRehearsal projectId="project-1" episodeId="episode-1" selectedShotId="frame-2"
        catalog={catalog()} enabled port={port} t={t} />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh.costRehearsalAction }))
    await waitFor(() => { expect(port.costRehearsal).toHaveBeenCalledTimes(2) })
    second.resolve(newer)
    expect(await screen.findAllByText('¥4.800000')).toHaveLength(2)

    first.resolve(rehearsal())
    await first.promise
    await Promise.resolve()
    expect(screen.queryByText('¥3.600000')).toBeNull()
    expect(screen.getAllByText('¥4.800000')).toHaveLength(2)
  })
})
