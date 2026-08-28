// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ImagoTakeAcceptanceMethodResponse, QingmuYimengPort, YimengTakeAcceptanceResponse,
  YimengTakeVersion, YimengTakeVersionSelectionRecovery, YimengTakeVersionSelectionResult,
  YimengTakeVersionStackResponse,
} from '../src/client/contracts.ts'
import { TakeVersionCompareView } from '../src/client/TakeVersionCompareView.tsx'
import {
  createTakeVersionSelectionMarker, readTakeVersionSelectionMarker, writeTakeVersionSelectionMarker,
  type TakeVersionSelectionRecoveryMarker,
} from '../src/client/take-version-recovery.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  takeVersionSha, takeVersionStackFixture,
} from '../../qingmu-yimeng-read-adapter/tests/take-version-fixture.ts'
import { takeAcceptanceFixture } from '../../qingmu-yimeng-read-adapter/tests/take-acceptance-fixture.ts'
import { continuitySource } from './fixtures/continuity-method.client.ts'

const t = (key: QingmuCockpitKey) => zh[key]
type Port = Pick<QingmuYimengPort,
  'takeVersions' | 'takeAcceptance' | 'takeAcceptanceMethod'
  | 'selectTakeVersion' | 'recoverTakeVersionSelection'>

function scope() {
  const source = continuitySource()
  return { projectId: source.projectId, episodeId: source.episodeId, frameId: 'frame-a' }
}

function stack(selectedTakeId: string | null = 'asset-take-1', third = false): YimengTakeVersionStackResponse {
  const source = continuitySource()
  const base = takeVersionStackFixture(scope())
  const original = base.subject.versions.map(version => ({ ...version }))
  if (selectedTakeId === 'asset-take-2') {
    original[0] = { ...original[0]!, selectionStatus: 'Stale', isSelected: false, canAttemptSelection: false }
    original[1] = { ...original[1]!, selectionStatus: 'Selected', isSelected: true, canAttemptSelection: false }
  }
  const versions = third ? [...original, {
    ...original[1]!, takeId: 'asset-take-3', versionOrdinal: 3, source: 'repair' as const,
    selectionStatus: 'Unselected', isSelected: false, canAttemptSelection: true,
    recordedOutputSha256: '6'.repeat(64), outputSha256: '6'.repeat(64), inputHash: '7'.repeat(64),
  }] : original
  const subject = {
    ...base.subject,
    frameNo: source.director.shotRelations.shots.find(shot => shot.shotId === 'frame-a')?.frameNo ?? 0,
    storyboardRevision: source.director.shotRelations.storyboardRevision.episodeRevision,
    selectionRevision: selectedTakeId === 'asset-take-2' ? 1 : 0,
    selectedTakeId,
    versions,
  }
  return { ...base, subject, stackSnapshotSha256: takeVersionSha(subject) }
}

function result(marker: TakeVersionSelectionRecoveryMarker): YimengTakeVersionSelectionResult {
  const authoritative = stack(marker.candidateTakeId).subject
  return {
    schema: 'jason.qingmu-take-selection-result.v1', changeSetId: 'changeset-take',
    commandReceiptId: 'receipt-take', eventId: 'event-take', eventType: 'TakeVersionSelected',
    projectId: marker.projectId, episodeId: marker.episodeId, frameId: marker.frameId,
    selectedTake: {
      takeId: marker.candidateTakeId, versionOrdinal: marker.candidateVersionOrdinal,
      outputSha256: marker.candidateOutputSha256,
    },
    selectionIdentity: {
      actorUserId: 'owner-user', actorNaturalPersonId: 'verified-owner',
      actorRole: 'project_owner_selector', authSessionId: '8'.repeat(64),
    },
    baseStackSnapshotSha256: marker.expectedStackSha256,
    authoritativeStack: authoritative,
    authoritativeStackSnapshotSha256: takeVersionSha(authoritative),
    provenanceTaskId: 'selection-provenance-task',
    taskMutation: { created: true, kind: 'local_selection_provenance', taskId: 'selection-provenance-task' },
    idempotencyKey: marker.idempotencyKey, deduplicated: false,
    committedAt: '2026-08-28T10:02:00.123456+00:00', selectionChanged: true,
    providerCalls: 0, paidProviderAuthority: 'not_granted', budgetMutation: false,
    humanApprovalInferred: false, formalApprovalChanged: false,
  }
}

function recovery(marker: TakeVersionSelectionRecoveryMarker, committed: boolean): YimengTakeVersionSelectionRecovery {
  return {
    schema: 'jason.qingmu-take-selection-recovery.v1',
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    frameId: marker.frameId,
    expectedStackSha256: marker.expectedStackSha256,
    expectedSelectedTakeId: marker.expectedSelectedTakeId,
    candidateTakeId: marker.candidateTakeId,
    candidateVersionOrdinal: marker.candidateVersionOrdinal,
    candidateOutputSha256: marker.candidateOutputSha256,
    idempotencyKey: marker.idempotencyKey,
    status: committed ? 'committed' : 'not_found', result: committed ? result(marker) : null,
  }
}

const ruleBindings = {
  'pipeline/imago-os-current.json': 'a'.repeat(64),
  'pipeline/workflow-channel-registry.json': 'b'.repeat(64),
  'pipeline/v6-video-generation-routing-policy.json': 'c'.repeat(64),
  'pipeline/v6-video-reference-integrity-overlay-policy.json': 'd'.repeat(64),
  'scripts/probe_v6_video_receipt.py': 'e'.repeat(64),
  'docs/qingmu-os/report-source.md': 'f'.repeat(64),
  'scripts/compile_qingmu_take_acceptance_method.py': '1'.repeat(64),
}

function acceptance(feed: YimengTakeVersionStackResponse = stack()): YimengTakeAcceptanceResponse {
  const selected = feed.subject.versions.find(version => version.takeId === feed.subject.selectedTakeId)
  if (selected === undefined) throw new Error('acceptance fixture requires a selected Take')
  const base = takeAcceptanceFixture(scope())
  const evidence: YimengTakeAcceptanceResponse['evidence'] = {
    ...base.evidence,
    subject: {
      ...base.evidence.subject,
      frameNo: feed.subject.frameNo,
      storyboardRevision: feed.subject.storyboardRevision,
      frameContentSha256: feed.subject.frameContentSha256,
      selectionRevision: feed.subject.selectionRevision,
      takeId: selected.takeId,
      versionOrdinal: selected.versionOrdinal,
      outputSha256: selected.outputSha256,
      taskId: selected.taskId,
      provider: selected.provider,
      model: selected.model,
      routeKey: selected.routeKey,
      inputHash: selected.inputHash,
      submitId: selected.providerTaskId,
    },
    providerReceipt: {
      ...base.evidence.providerReceipt,
      status: 'verified',
      evidenceMode: 'provider_receipt',
      actualProviderReceiptVerified: true,
      requestDryRun: false,
      outboxState: 'acknowledged',
      dispatchEpoch: 1,
      dispatchDigest: '8'.repeat(64),
      payloadSha256: selected.inputHash,
      responseSha256: '9'.repeat(64),
      providerTaskId: selected.providerTaskId,
      providerMediaBindingStatus: 'PASS',
      providerMediaRecordId: 'provider-media-current',
      blockers: [],
    },
    technicalReceipt: {
      ...base.evidence.technicalReceipt,
      media: { ...base.evidence.technicalReceipt.media, sha256: selected.outputSha256 },
    },
  }
  return { ...base, evidence, evidenceSnapshotSha256: takeVersionSha(evidence) }
}

function acceptanceMethod(feed: YimengTakeAcceptanceResponse): ImagoTakeAcceptanceMethodResponse {
  const projection: ImagoTakeAcceptanceMethodResponse['projection'] = {
    schema: 'qingmu.imago-take-acceptance-method.v1',
    subject: feed.evidence.subject,
    evidenceSnapshotSha256: feed.evidenceSnapshotSha256,
    definition: {
      mode: 'READ_ONLY_STATELESS_PROJECTION',
      technicalReceipt: {
        requiredVideoFields: [
          'duration_seconds', 'width', 'height', 'codec_name', 'nb_frames', 'avg_frame_rate', 'r_frame_rate',
          'actual_average_frame_rate',
        ],
        fullVideoDecodeRequired: true,
        fullVideoDecodeCommandProfile: 'ffmpeg -v error -xerror -map 0:v:0 -f null -',
        actualFrameRateBasis: 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE',
        nominalRFrameRateIsActual: false,
      },
      qualityLayers: {
        macro: {
          required: true,
          dimensions: ['STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE'],
          yimengCheckTypes: ['creative_director_execution'],
        },
        micro: {
          required: true,
          dimensions: [
            'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER', 'LOCKED_DIALOGUE',
            'TECHNICAL_RECEIPT',
          ],
          yimengBaseCheckTypes: ['real_vl_native_video_output'],
          conditionalDialogueCheckType: 'creative_dialogue_audio',
          technicalReceiptRequired: true,
        },
      },
      boundaries: {
        businessTruth: 'yimeng', selectedIsApproval: false, formalAcceptanceAllowed: false,
        providerCalls: 0, projectMutation: false, humanSignoffInferred: false,
        paidProviderAuthority: 'not_granted', gateBCompleted: false, inactiveReferenceOverlayActivated: false,
      },
    },
    evaluation: {
      technicalReceiptStatus: 'PASS', fullVideoDecodeStatus: 'PASS',
      macroQc: { status: 'PASS', checkTypes: ['creative_director_execution'], blockers: [] },
      microQc: { status: 'PASS', checkTypes: ['real_vl_native_video_output'], blockers: [] },
      providerReceipt: {
        status: 'verified', evidenceMode: 'provider_receipt', actualProviderReceiptVerified: true, blockers: [],
      },
      localControlStatus: 'PASS', localBlockers: [],
      productionVerificationStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', formalAcceptanceAllowed: false,
      selectedIsApproval: false, gateBCompleted: false,
    },
    ruleBindings,
    rulesSha256: takeVersionSha(ruleBindings),
  }
  const projectionSha256 = takeVersionSha(projection)
  return {
    schema: 'qingmu.imago-take-acceptance-method-adapter-result.v1',
    projection,
    projectionSha256,
    methodAttestation: {
      schema: 'qingmu.imago-take-acceptance-method-attestation.v1', algorithm: 'hmac-sha256',
      evidenceSnapshotSha256: feed.evidenceSnapshotSha256, methodProjectionSha256: projectionSha256,
      signature: '7'.repeat(64),
    },
  }
}

function makePort(
  feed: YimengTakeVersionStackResponse = stack(),
  evidence: YimengTakeAcceptanceResponse = acceptance(feed),
  method: ImagoTakeAcceptanceMethodResponse = acceptanceMethod(evidence),
): {
  readonly takeVersions: ReturnType<typeof vi.fn<Port['takeVersions']>>
  readonly takeAcceptance: ReturnType<typeof vi.fn<Port['takeAcceptance']>>
  readonly takeAcceptanceMethod: ReturnType<typeof vi.fn<Port['takeAcceptanceMethod']>>
  readonly selectTakeVersion: ReturnType<typeof vi.fn<Port['selectTakeVersion']>>
  readonly recoverTakeVersionSelection: ReturnType<typeof vi.fn<Port['recoverTakeVersionSelection']>>
} {
  return {
    takeVersions: vi.fn<Port['takeVersions']>().mockResolvedValue(feed),
    takeAcceptance: vi.fn<Port['takeAcceptance']>().mockResolvedValue(evidence),
    takeAcceptanceMethod: vi.fn<Port['takeAcceptanceMethod']>().mockResolvedValue(method),
    selectTakeVersion: vi.fn<Port['selectTakeVersion']>(),
    recoverTakeVersionSelection: vi.fn<Port['recoverTakeVersionSelection']>(),
  }
}

function props(port: Port) {
  const projection = continuitySource()
  return {
    ...scope(), selectedShotId: 'frame-a', projection, enabled: true, port, t,
  }
}

function pending<T>() {
  let accept: (value: T) => void = () => { throw new Error('promise not initialized') }
  const promise = new Promise<T>((resolve) => { accept = resolve })
  return { promise, resolve: (value: T) => { accept(value) } }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Take version comparison and selection', () => {
  it('renders two existing Takes side by side without media, approval, or Provider actions', async () => {
    const port = makePort()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<TakeVersionCompareView {...props(port)} />)
    expect(await screen.findByText(zh.takeVersionSelectedNotApproval)).toBeTruthy()
    expect(port.takeVersions).toHaveBeenCalledExactlyOnceWith(scope(), expect.any(AbortSignal))
    expect(within(screen.getByRole('region', { name: zh.takeVersionCompare })).getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('5.25s')).toBeTruthy()
    expect(screen.getByText('¥0.000001')).toBeTruthy()
    expect(screen.getByText('identity_continuity')).toBeTruthy()
    const acceptanceRegion = await screen.findByRole('region', { name: zh.takeAcceptanceTitle })
    expect(await within(acceptanceRegion).findByText('UNVERIFIED_FOR_PAID_PRODUCTION')).toBeTruthy()
    expect(within(acceptanceRegion).getByText(zh.takeAcceptanceUnverified)).toBeTruthy()
    expect(within(acceptanceRegion).getByText('24')).toBeTruthy()
    expect(within(acceptanceRegion).getByText(`24/1 · ${zh.takeAcceptanceNominalNotActual}`)).toBeTruthy()
    expect(within(acceptanceRegion).getAllByText('PASS')).toHaveLength(4)
    expect(within(acceptanceRegion).getByText('verified')).toBeTruthy()
    expect(within(acceptanceRegion).getByText(zh.yes)).toBeTruthy()
    expect(port.takeAcceptance).toHaveBeenCalledExactlyOnceWith(scope(), expect.any(AbortSignal))
    expect(port.takeAcceptanceMethod).toHaveBeenCalledExactlyOnceWith(scope(), expect.any(AbortSignal))
    expect(container.querySelector('video, audio, img, iframe, source, a[href]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(批准|approve)$/i })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('caps comparison at two versions', async () => {
    const port = makePort(stack('asset-take-1', true))
    render(<TakeVersionCompareView {...props(port)} />)
    await screen.findByText(zh.takeVersionSelectedNotApproval)
    fireEvent.click(screen.getByRole('button', { name: 'v3' }))
    expect(await screen.findByText(zh.takeVersionCompareLimit)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: zh.takeVersionCompare })).getAllByRole('article')).toHaveLength(2)
  })

  it('stores recovery coordinates before one POST, clears on receipt, and rereads Yimeng', async () => {
    const first = stack()
    const second = stack('asset-take-2')
    const port = makePort(first)
    port.takeVersions.mockResolvedValueOnce(first).mockResolvedValue(second)
    const firstEvidence = acceptance(first)
    const secondEvidence = acceptance(second)
    port.takeAcceptance.mockResolvedValueOnce(firstEvidence).mockResolvedValue(secondEvidence)
    port.takeAcceptanceMethod.mockResolvedValueOnce(acceptanceMethod(firstEvidence))
      .mockResolvedValue(acceptanceMethod(secondEvidence))
    const deferred = pending<YimengTakeVersionSelectionResult>()
    port.selectTakeVersion.mockImplementation(async (request) => {
      const stored = readTakeVersionSelectionMarker(request)
      expect(stored.status).toBe('ready')
      if (stored.status !== 'ready') throw new Error('marker missing')
      expect(request).toEqual(expect.objectContaining({
        expectedStackSha256: first.stackSnapshotSha256,
        expectedSelectedTakeId: 'asset-take-1', candidateTakeId: 'asset-take-2', candidateVersionOrdinal: 2,
      }))
      return await deferred.promise
    })
    render(<TakeVersionCompareView {...props(port)} />)
    const button = await screen.findByRole('button', { name: zh.takeVersionSelectButton })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => { expect(port.selectTakeVersion).toHaveBeenCalledOnce() })
    const request = port.selectTakeVersion.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('selection request missing')
    const stored = readTakeVersionSelectionMarker(request)
    if (stored.status !== 'ready') throw new Error('selection marker missing')
    await act(async () => { deferred.resolve(result(stored.marker)) })
    expect(await screen.findByText(zh.takeVersionSelectionCommitted)).toBeTruthy()
    await waitFor(() => { expect(port.takeVersions).toHaveBeenCalledTimes(2) })
    await waitFor(() => {
      expect(port.takeAcceptance).toHaveBeenCalledTimes(2)
      expect(port.takeAcceptanceMethod).toHaveBeenCalledTimes(2)
    })
    const acceptanceRegion = screen.getByRole('region', { name: zh.takeAcceptanceTitle })
    expect(within(acceptanceRegion).getByText('asset-take-2')).toBeTruthy()
    expect(readTakeVersionSelectionMarker(request)).toEqual({ status: 'none' })
    expect(port.recoverTakeVersionSelection).not.toHaveBeenCalled()
  })

  it('uses one GET recovery after an uncertain POST and never reposts the selection', async () => {
    const port = makePort()
    port.selectTakeVersion.mockRejectedValue(new Error('connection dropped'))
    port.recoverTakeVersionSelection.mockImplementation(async (request) => {
      const stored = readTakeVersionSelectionMarker(request)
      if (stored.status !== 'ready') throw new Error('marker missing')
      return recovery(stored.marker, false)
    })
    render(<TakeVersionCompareView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.takeVersionSelectButton }))
    expect(await screen.findByText(zh.takeVersionSelectionUnknown)).toBeTruthy()
    expect(port.selectTakeVersion).toHaveBeenCalledOnce()
    expect(port.recoverTakeVersionSelection).toHaveBeenCalledOnce()
    const request = port.selectTakeVersion.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('selection request missing')
    expect(readTakeVersionSelectionMarker(request).status).toBe('ready')
  })

  it('recovers a stored marker by GET on mount, clears it, and rereads without POST', async () => {
    const initial = stack()
    const committed = stack('asset-take-2')
    const marker = await createTakeVersionSelectionMarker({
      ...scope(), expectedStackSha256: initial.stackSnapshotSha256, expectedSelectedTakeId: 'asset-take-1',
      candidateTakeId: 'asset-take-2', candidateVersionOrdinal: 2, candidateOutputSha256: '4'.repeat(64),
    })
    expect(writeTakeVersionSelectionMarker(marker)).toBe(true)
    const port = makePort(initial)
    port.takeVersions.mockResolvedValueOnce(initial).mockResolvedValue(committed)
    port.recoverTakeVersionSelection.mockResolvedValue(recovery(marker, true))
    render(<TakeVersionCompareView {...props(port)} />)
    expect(await screen.findByText(zh.takeVersionSelectionCommitted)).toBeTruthy()
    await waitFor(() => { expect(port.takeVersions).toHaveBeenCalledTimes(2) })
    const recoveryCall = port.recoverTakeVersionSelection.mock.calls[0]
    expect(recoveryCall?.[0]).not.toHaveProperty('schema')
    expect(recoveryCall?.[1]).toBeInstanceOf(AbortSignal)
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
    expect(readTakeVersionSelectionMarker(scope())).toEqual({ status: 'none' })
  })

  it('keeps comparison visible but selection disabled for a read-only identity', async () => {
    const feed = { ...stack(), capabilities: { canCompare: true as const, canSelect: false } }
    const port = makePort(feed)
    render(<TakeVersionCompareView {...props(port)} />)
    expect(await screen.findByText(zh.takeVersionCannotSelect)).toBeTruthy()
    const button = screen.getByRole('button', { name: zh.takeVersionSelectButton })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
  })

  it('fails closed in the UI when an upstream candidate claims selectable with incomplete lineage', async () => {
    const base = stack()
    const versions = base.subject.versions.map(version => version.takeId === 'asset-take-2'
      ? { ...version, providerTaskId: null, lineageComplete: false, canAttemptSelection: true }
      : version)
    const subject = { ...base.subject, versions }
    const port = makePort({ ...base, subject, stackSnapshotSha256: takeVersionSha(subject) })
    render(<TakeVersionCompareView {...props(port)} />)

    const button = await screen.findByRole('button', { name: zh.takeVersionSelectButton })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
  })

  it('blocks selection for an invalid marker until an explicit local-only discard', async () => {
    const ids = scope()
    const key = ['qingmu:take-version-selection-recovery:v1', ids.projectId, ids.episodeId, ids.frameId]
      .map(encodeURIComponent).join(':')
    sessionStorage.setItem(key, '{broken')
    const port = makePort()
    render(<TakeVersionCompareView {...props(port)} />)
    expect(await screen.findByText(zh.takeVersionRecoveryInvalid)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.takeVersionSelectButton }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getAllByText(zh.takeVersionDiscardRecovery)[0]!)
    fireEvent.click(screen.getByRole('button', { name: zh.takeVersionDiscardRecovery }))
    expect(await screen.findByText(zh.takeVersionRecoveryDiscarded)).toBeTruthy()
    expect(readTakeVersionSelectionMarker(ids)).toEqual({ status: 'none' })
    expect(screen.getByRole('button', { name: zh.takeVersionSelectButton }).hasAttribute('disabled')).toBe(false)
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
  })

  it('does nothing when the selected Shot is unavailable or outside the current projection', () => {
    const port = makePort()
    const value = props(port)
    render(<TakeVersionCompareView {...value} selectedShotId="missing-shot" />)
    expect(port.takeVersions).not.toHaveBeenCalled()
    expect(port.takeAcceptance).not.toHaveBeenCalled()
    expect(port.takeAcceptanceMethod).not.toHaveBeenCalled()
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: zh.takeVersionRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the version stack visible while both selected-Take acceptance reads are loading', async () => {
    const port = makePort()
    const evidence = pending<YimengTakeAcceptanceResponse>()
    const method = pending<ImagoTakeAcceptanceMethodResponse>()
    port.takeAcceptance.mockImplementation(async () => await evidence.promise)
    port.takeAcceptanceMethod.mockImplementation(async () => await method.promise)
    render(<TakeVersionCompareView {...props(port)} />)

    expect(await screen.findByText(zh.takeAcceptanceLoading)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: zh.takeVersionCompare })).getAllByRole('article')).toHaveLength(2)
    expect(port.takeAcceptance).toHaveBeenCalledOnce()
    expect(port.takeAcceptanceMethod).toHaveBeenCalledOnce()
  })

  it('fails only the acceptance region when one parallel read fails', async () => {
    const port = makePort()
    port.takeAcceptanceMethod.mockRejectedValue(new Error('method unavailable'))
    render(<TakeVersionCompareView {...props(port)} />)

    expect(await screen.findByText(zh.takeAcceptanceUnavailable)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: zh.takeVersionCompare })).getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText(zh.takeVersionSelectedNotApproval)).toBeTruthy()
  })

  it('does not request acceptance evidence when the current stack has no selected Take', async () => {
    const base = stack()
    const subject = {
      ...base.subject,
      selectedTakeId: null,
      versions: base.subject.versions.map(version => ({
        ...version, isSelected: false, selectionStatus: version.takeId === 'asset-take-1' ? 'Stale' : 'Unselected',
      })),
    }
    const port = makePort()
    port.takeVersions.mockResolvedValue({ ...base, subject, stackSnapshotSha256: takeVersionSha(subject) })
    render(<TakeVersionCompareView {...props(port)} />)

    expect(await screen.findByText(zh.takeAcceptanceNoSelection)).toBeTruthy()
    expect(port.takeAcceptance).not.toHaveBeenCalled()
    expect(port.takeAcceptanceMethod).not.toHaveBeenCalled()
  })

  it('fails closed on an evidence digest or method-coordinate drift without exposing payload locations', async () => {
    const feed = acceptance()
    const port = makePort(stack(), { ...feed, evidenceSnapshotSha256: '0'.repeat(64) }, acceptanceMethod(feed))
    render(<TakeVersionCompareView {...props(port)} />)

    expect(await screen.findByText(zh.takeAcceptanceUnavailable)).toBeTruthy()
    expect(screen.queryByText(/https?:\/\//i)).toBeNull()
    expect(screen.queryByText(/\/Users\//)).toBeNull()
    expect(screen.queryByText(/raw.?response/i)).toBeNull()
  })

  it.each([
    { name: 'incomplete lineage', patch: { lineageComplete: false } },
    { name: 'unverified output binding', patch: { outputBindingStatus: 'recorded_sha_mismatch' as const } },
    { name: 'recorded output SHA drift', patch: { recordedOutputSha256: '0'.repeat(64) } },
  ] satisfies ReadonlyArray<{ name: string; patch: Partial<YimengTakeVersion> }>)(
    'fails closed on selected-Take $name even when the receipt coordinates otherwise match',
    async ({ patch }) => {
      const base = stack()
      const versions = base.subject.versions.map(version => version.isSelected ? { ...version, ...patch } : version)
      const subject = { ...base.subject, versions }
      const feed = { ...base, subject, stackSnapshotSha256: takeVersionSha(subject) }
      const evidence = acceptance(feed)
      const port = makePort(feed, evidence, acceptanceMethod(evidence))
      render(<TakeVersionCompareView {...props(port)} />)

      expect(await screen.findByText(zh.takeAcceptanceUnavailable)).toBeTruthy()
      expect(screen.queryByText(zh.takeAcceptanceUnverified)).toBeNull()
    },
  )

  it('reloads the stack and both acceptance sources with the shared refresh action', async () => {
    const port = makePort()
    render(<TakeVersionCompareView {...props(port)} />)
    await screen.findByText(zh.takeAcceptanceUnverified)

    fireEvent.click(screen.getByRole('button', { name: zh.takeVersionRefresh }))
    await waitFor(() => {
      expect(port.takeVersions).toHaveBeenCalledTimes(2)
      expect(port.takeAcceptance).toHaveBeenCalledTimes(2)
      expect(port.takeAcceptanceMethod).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(zh.takeAcceptanceUnverified)).toBeTruthy()
  })
})
