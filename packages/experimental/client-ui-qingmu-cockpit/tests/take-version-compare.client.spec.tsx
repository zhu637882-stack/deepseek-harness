// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  QingmuYimengPort, YimengTakeVersionSelectionRecovery,
  YimengTakeVersionSelectionResult, YimengTakeVersionStackResponse,
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
import { continuitySource } from './fixtures/continuity-method.client.ts'

const t = (key: QingmuCockpitKey) => zh[key]
type Port = Pick<QingmuYimengPort, 'takeVersions' | 'selectTakeVersion' | 'recoverTakeVersionSelection'>

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

function makePort(feed: YimengTakeVersionStackResponse = stack()): {
  readonly takeVersions: ReturnType<typeof vi.fn<Port['takeVersions']>>
  readonly selectTakeVersion: ReturnType<typeof vi.fn<Port['selectTakeVersion']>>
  readonly recoverTakeVersionSelection: ReturnType<typeof vi.fn<Port['recoverTakeVersionSelection']>>
} {
  return {
    takeVersions: vi.fn<Port['takeVersions']>().mockResolvedValue(feed),
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
    expect(port.recoverTakeVersionSelection).toHaveBeenCalledExactlyOnceWith(
      expect.not.objectContaining({ schema: expect.anything() }), expect.any(AbortSignal),
    )
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
    expect(port.selectTakeVersion).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: zh.takeVersionRefresh }).hasAttribute('disabled')).toBe(true)
  })
})
