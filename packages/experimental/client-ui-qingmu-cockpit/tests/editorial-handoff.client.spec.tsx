// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorialHandoff, continuousPlayedCoverage } from '../src/client/EditorialHandoff.tsx'
import type { QingmuYimengReadPort, YimengEditorialHandoffResponse } from '../src/client/contracts.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

const SCOPE = { projectId: 'project-e8', episodeId: 'episode-e8' }
const t = (key: QingmuCockpitKey) => zh[key]
const fetchUrl = (input: string | URL | Request): string => input instanceof Request
  ? input.url : input instanceof URL ? input.href : input

function handoff(): YimengEditorialHandoffResponse {
  return {
    schema: 'jason.qingmu-editorial-handoff-draft.v1', ...SCOPE,
    source: {
      schema: 'jason.qingmu-editorial-handoff-source.v1', ...SCOPE,
      evidenceSourceSnapshotSha256: '1'.repeat(64), verificationInputsSha256: '2'.repeat(64),
      audioPolicy: 'only_authoritatively_bound_assets',
      scenes: [{ sceneId: 'scene-1', projectId: SCOPE.projectId, seriesId: 'series-1', name: '雨夜街口' }],
      shots: [{
        frameId: 'frame-1', frameNo: 1, sceneId: 'scene-1', title: '雨夜街口',
        frameContentSha256: '3'.repeat(64), stackSnapshotSha256: '4'.repeat(64),
        selectedTake: {
          assetId: 'take-1', assetRevision: 2, sha256: '5'.repeat(64),
          materializationStatus: 'available', mimeType: 'video/mp4',
          containerTypeStatus: 'verified',
          durationSec: 4.25, fps: 24, width: 720, height: 1280, aspectRatio: '720:1280',
          recordedOutputSha256: '5'.repeat(64), outputBindingStatus: 'verified',
          size: 1024, packagePath: `media/${'5'.repeat(64)}.mp4`,
          selectionStatus: 'Selected', qualityStatus: 'passed', lineageComplete: true,
        },
        audio: { status: 'unavailable', scopeStatus: 'valid', candidateCount: 0, asset: null },
        comments: {} as unknown as YimengEditorialHandoffResponse['source']['shots'][number]['comments'],
        review: {} as unknown as YimengEditorialHandoffResponse['source']['shots'][number]['review'],
        qc: null, approval: null,
        blockers: [
          'editorial_handoff_approval_record_missing',
          'editorial_handoff_qc_record_missing',
          'editorial_handoff_selected_audio_missing',
        ],
      }],
    },
    sourceSnapshotSha256: '6'.repeat(64),
    summary: { shotCount: 1, selectedTakeCount: 1, authoritativeAudioCount: 0,
      totalDurationSec: 4.25, unresolvedCount: 3 },
    unresolved: [
      { frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
      { frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
      { frameId: 'frame-1', code: 'editorial_handoff_selected_audio_missing' },
    ],
    blockers: [
      { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
      { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
      { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_selected_audio_missing' },
    ],
    download: {
      available: false, format: 'otio-zip', blockerCode: 'editorial_handoff_approval_record_missing',
      packageSchema: 'jason.qingmu-editorial-otio-package.v1',
      otio: { distribution: 'OpenTimelineIO', version: '0.18.1', adapter: 'otio_json', schemaFamily: 'OTIO_CORE', schemaLabel: '0.18.1' },
      rangePolicy: 'full-selected-asset-v1', audioEditorialRatePolicy: 'episode-canonical-video-fps-v1',
    },
    aokiVideoProductionHandoffReady: false, yimengEpisodeReleaseReady: false,
    readOnly: true, providerCalls: 0, businessMutations: 0, projectionSha256: '7'.repeat(64),
  }
}

function downloadableHandoff(withImport = false): YimengEditorialHandoffResponse {
  const value = handoff()
  return {
    ...value,
    source: { ...value.source, shots: value.source.shots.map(shot => ({ ...shot, blockers: [] })) },
    summary: { ...value.summary, unresolvedCount: 0 },
    unresolved: [], blockers: [],
    download: {
      ...value.download,
      available: true,
      blockerCode: null,
      hostAccess: {
        requestId: '12345678-1234-1234-1234-123456789abc', capability: 'a'.repeat(64),
        ...(withImport ? { importAccess: {
          requestId: '87654321-4321-4321-4321-cba987654321', capability: 'b'.repeat(64),
        } } : {}),
      },
    },
  }
}

function mount() {
  const editorialHandoff = vi.fn().mockResolvedValue(handoff())
  const port = { editorialHandoff } as unknown as QingmuYimengReadPort
  return { editorialHandoff, ...render(<EditorialHandoff {...SCOPE} port={port} t={t} />) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function playedRanges(ranges: readonly (readonly [number, number])[]): TimeRanges {
  return {
    length: ranges.length,
    start: index => ranges[index]?.[0] ?? 0,
    end: index => ranges[index]?.[1] ?? 0,
  }
}

function reportPlayback(video: HTMLVideoElement, ranges: readonly (readonly [number, number])[]) {
  Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
  Object.defineProperty(video, 'played', { configurable: true, value: playedRanges(ranges) })
  fireEvent.timeUpdate(video)
}

async function authenticateHumanSession() {
  fireEvent.change(screen.getByLabelText(zh.handoffHumanUsername), { target: { value: 'owner' } })
  fireEvent.change(screen.getByLabelText(zh.handoffHumanPassword), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: zh.handoffHumanSessionLogin }))
  await waitFor(() => { expect(screen.getByText(zh.handoffHumanSessionReady)).toBeTruthy() })
}

function platformAuthenticationOptions() {
  return {
    schema: 'jason.qingmu-platform-human-presence-options.v1', ceremony: 'authentication',
    challengeId: 'challenge-platform-12345678', expiresAt: '2026-09-02T12:00:00Z',
    publicKey: { challenge: 'AAAAAAAAAAAAAAAA', rpId: '127.0.0.1', timeout: 60_000,
      userVerification: 'required', allowCredentials: [{ type: 'public-key', id: 'BAUG' }] },
  }
}

function installPlatformAssertionMock() {
  class FakeAttestationResponse { readonly fixture = true }
  class FakeAssertionResponse {
    clientDataJSON = Uint8Array.of(1).buffer
    authenticatorData = Uint8Array.of(2).buffer
    signature = Uint8Array.of(3).buffer
    userHandle = null
  }
  class FakePublicKeyCredential {
    id = 'platform-credential-test'
    rawId = Uint8Array.of(4, 5, 6).buffer
    type = 'public-key'
    authenticatorAttachment = 'platform'
    response = new FakeAssertionResponse()
    getClientExtensionResults() { return {} }
  }
  vi.stubGlobal('AuthenticatorAttestationResponse', FakeAttestationResponse)
  vi.stubGlobal('AuthenticatorAssertionResponse', FakeAssertionResponse)
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    get: vi.fn(async () => new FakePublicKeyCredential()),
  } })
}

function registeredPlatformPresence() {
  return {
    schema: 'jason.qingmu-platform-human-presence-status.v1', ...SCOPE,
    actorUserId: 'actor-platform-test',
    state: 'registered', credentialSha256: 'a'.repeat(64),
    userVerification: 'required', authenticatorAttachment: 'platform',
    businessAuthorityGranted: false,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('editorial handoff panel', () => {
  it('does not treat a tail seek as playback but accepts continuous coverage', () => {
    expect(continuousPlayedCoverage(playedRanges([[9, 10]]), 10)).toBe(0)
    expect(continuousPlayedCoverage(playedRanges([[0, 4], [4.1, 10]]), 10)).toBe(1)
    expect(continuousPlayedCoverage(
      playedRanges([[0, 2], [2.1, 4], [4.1, 6], [6.1, 10]]), 10,
    )).toBeLessThan(1)
  })
  it('shows separate false readiness, authoritative media facts, and no write action', async () => {
    const { editorialHandoff } = mount()
    await waitFor(() => { expect(screen.getByText(/雨夜街口/u)).toBeTruthy() })
    expect(editorialHandoff).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain(`${zh.handoffProductionReady}: ${zh.handoffFalse}`)
    expect(screen.getByRole('status').textContent).toContain(`${zh.handoffReleaseReady}: ${zh.handoffFalse}`)
    expect(screen.getByText('take-1')).toBeTruthy()
    expect(screen.getByText(zh.handoffAudioUnbound)).toBeTruthy()
    expect(screen.getAllByText(zh.handoffBlockerAudioMissing).length).toBeGreaterThan(0)
    const download = screen.getByRole('button', { name: zh.handoffDownloadDisabled })
    expect(download.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: /submit|commit|提交|确认/u })).toBeNull()
  })

  it('performs exactly one additional read when the user refreshes', async () => {
    const { editorialHandoff } = mount()
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(2) })
    expect(editorialHandoff).toHaveBeenCalledTimes(2)
  })

  it('does not continue an old-scope refresh after project and episode change', async () => {
    const oldRefresh = deferred<YimengEditorialHandoffResponse>()
    const editorialHandoff = vi.fn()
      .mockResolvedValueOnce(handoff())
      .mockImplementationOnce(() => oldRefresh.promise)
      .mockResolvedValue(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 409, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(2) })
    view.rerender(<EditorialHandoff projectId="project-new" episodeId="episode-new" port={port} t={t} />)
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledWith(
      { projectId: 'project-new', episodeId: 'episode-new' }, expect.any(AbortSignal),
    ) })
    oldRefresh.resolve(handoff())
    const callsBeforeLateResolution = fetchMock.mock.calls.length
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(callsBeforeLateResolution).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeLateResolution)
  })

  it('turns a Host source drift into a localized refresh action', async () => {
    const editorialHandoff = vi.fn().mockRejectedValue(new Error('internal: SOURCE_DRIFT'))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText(zh.handoffSourceDrift)).toBeTruthy() })
    expect(screen.getByRole('button', { name: zh.handoffRefresh })).toBeTruthy()
  })

  it('keeps persisted candidates independently readable and clears stale rows on byte-integrity failure', async () => {
    const candidate = {
      schema: 'jason.qingmu-returned-master-candidate-result.v1', ...SCOPE,
      assetId: 'asset-candidate-1', masterSha256: '8'.repeat(64), byteSize: 2048,
      mimeType: 'video/mp4', packageSha256: '9'.repeat(64), sourceSnapshotSha256: 'a'.repeat(64),
      projectionSha256: 'b'.repeat(64), downloadRequestId: 'download-1', importRequestId: 'import-1',
      preflightRequestId: 'preflight-1', preflightSha256: 'c'.repeat(64),
      selectionStatus: 'Unselected', isSelected: false, qualityStatus: 'pending',
      approved: false, published: false, idempotencyKey: 'd'.repeat(64),
      commandReceiptId: 'receipt-candidate-1', savedAt: '2026-09-01T00:00:00Z',
    }
    let candidateReads = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = fetchUrl(input)
      if (url.includes('/rc1-status?')) {
        return new Response('{}', { status: 404 })
      }
      if (url.includes('returned-master-selection-status')) {
        return new Response(JSON.stringify({ code: 'selection_not_available' }), { status: 409 })
      }
      candidateReads += 1
      return candidateReads === 1
        ? new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [candidate],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ code: 'candidate_materialization_tampered' }), { status: 409 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const editorialHandoff = vi.fn().mockRejectedValue(new Error('internal: SOURCE_DRIFT'))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.handoffSourceDrift) })
    const read = screen.getByRole('button', { name: zh.handoffCandidateRead })
    fireEvent.click(read)
    await waitFor(() => { expect(screen.getByText(zh.handoffCandidateUnselected)).toBeTruthy() })
    fireEvent.click(read)
    await waitFor(() => { expect(screen.queryByText(zh.handoffCandidateUnselected)).toBeNull() })
    expect(screen.getByText(/candidate_list_failed/u)).toBeTruthy()
    expect(fetchMock.mock.calls.filter(call => fetchUrl(call[0]).includes('returned-master')).length).toBe(6)
  })

  it('rejects candidate rows from a different project scope', async () => {
    const candidate = {
      schema: 'jason.qingmu-returned-master-candidate-result.v1',
      projectId: 'project-other', episodeId: SCOPE.episodeId,
      assetId: 'asset-cross-scope', masterSha256: '8'.repeat(64), byteSize: 2048,
      mimeType: 'video/mp4', packageSha256: '9'.repeat(64), sourceSnapshotSha256: 'a'.repeat(64),
      projectionSha256: 'b'.repeat(64), downloadRequestId: 'download-1', importRequestId: 'import-1',
      preflightRequestId: 'preflight-1', preflightSha256: 'c'.repeat(64),
      selectionStatus: 'Unselected', isSelected: false, qualityStatus: 'pending',
      approved: false, published: false, idempotencyKey: 'd'.repeat(64),
      commandReceiptId: 'receipt-candidate-cross', savedAt: '2026-09-01T00:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = fetchUrl(input)
      if (url.includes('returned-master-candidates')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [candidate],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ code: 'not_available' }), { status: 409 })
    }))
    const port = { editorialHandoff: vi.fn().mockResolvedValue(handoff()) } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByText(/candidate_list_contract_invalid/u)).toBeTruthy() })
    expect(screen.queryByText('asset-cross-scope')).toBeNull()
  })

  it('previews and explicitly selects the same returned candidate without implying QC or release', async () => {
    const candidate = {
      schema: 'jason.qingmu-returned-master-candidate-result.v1', ...SCOPE,
      assetId: 'asset-candidate-1', masterSha256: '8'.repeat(64), byteSize: 2048,
      mimeType: 'video/mp4', packageSha256: '9'.repeat(64), sourceSnapshotSha256: 'a'.repeat(64),
      projectionSha256: 'b'.repeat(64), preflightSha256: 'c'.repeat(64),
      selectionStatus: 'Unselected', isSelected: false, qualityStatus: 'pending',
      approved: false, published: false, idempotencyKey: 'd'.repeat(64),
      commandReceiptId: 'receipt-candidate-1', savedAt: '2026-09-01T00:00:00Z',
    }
    const selectionCandidate = {
      assetId: candidate.assetId, masterSha256: candidate.masterSha256,
      mimeType: 'video/mp4', byteSize: candidate.byteSize, qualityStatus: 'pending',
      selectionStatus: 'Unselected', isSelected: false, finalOutputId: null,
      selectionReceiptId: null, selectedAt: null, current: false,
    }
    const releaseConditions = { ready: false, blockers: [
      'technical_qc_not_approved', 'content_approval_missing',
      'release_manifest_not_frozen', 'human_signoff_missing',
    ] }
    let selected = false
    let selectionPosts = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('returned-master-candidates')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [candidate],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-selection-status')) {
        const current = selected ? {
          ...selectionCandidate, selectionStatus: 'Selected', isSelected: true,
          finalOutputId: 'final-1', selectionReceiptId: 'receipt-selection-1',
          selectedAt: '2026-09-01T00:00:01Z', current: true,
        } : selectionCandidate
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-status.v1', ...SCOPE,
          selectionRevision: selected ? 1 : 0,
          currentFormalMaster: selected ? current : null, candidates: [current], releaseConditions,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-selection-preview')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-preview.v1', ...SCOPE,
          candidate: selectionCandidate, currentFormalMaster: null,
          previewSha256: 'e'.repeat(64), idempotencyKey: `e8-master-select-${'f'.repeat(32)}`,
          canConfirm: true, hardBlockers: [], releaseConditions,
          impact: { mediaCopies: 0, revokePreviousFormalSelection: false },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-selection') && init?.method === 'POST') {
        selectionPosts += 1
        selected = true
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-result.v1', ...SCOPE,
          assetId: candidate.assetId, finalOutputId: 'final-1', selectionStatus: 'Selected',
          qualityStatus: 'pending', commandReceiptId: 'receipt-selection-1',
          selectedBy: 'authenticated-test-user', selectedAt: '2026-09-01T00:00:01Z',
          releaseConditions,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const editorialHandoff = vi.fn().mockResolvedValue(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText(/雨夜街口/u)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffSelectionPreview })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffSelectionPreview }))
    await waitFor(() => { expect(screen.getByText(zh.handoffSelectionPreviewTitle)).toBeTruthy() })
    expect(screen.getByText(zh.handoffSelectionReleaseBlocked)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.handoffSelectionSave }))
    await waitFor(() => { expect(screen.getByText(zh.handoffSelectionSaved)).toBeTruthy() })
    expect(screen.getByText(zh.handoffSelectionSavedBoundary)).toBeTruthy()
    await waitFor(() => { expect(screen.getByText(zh.handoffSelectionCurrent)).toBeTruthy() })
    expect(selectionPosts).toBe(1)
  })

  it('runs technical QC once and keeps the exact authority boundary visible', async () => {
    const candidate = {
      schema: 'jason.qingmu-returned-master-candidate-result.v1', ...SCOPE,
      assetId: 'asset-candidate-1', masterSha256: '8'.repeat(64), byteSize: 2048,
      mimeType: 'video/mp4', packageSha256: '9'.repeat(64), sourceSnapshotSha256: 'a'.repeat(64),
      projectionSha256: 'b'.repeat(64), preflightSha256: 'c'.repeat(64),
      selectionStatus: 'Selected', isSelected: true, qualityStatus: 'pending',
      approved: false, published: false, idempotencyKey: 'd'.repeat(64),
      commandReceiptId: 'receipt-candidate-1', savedAt: '2026-09-01T00:00:00Z',
    }
    const currentMaster = {
      assetId: candidate.assetId, masterSha256: candidate.masterSha256,
      mimeType: 'video/mp4', byteSize: candidate.byteSize, qualityStatus: 'pending',
      selectionStatus: 'Selected', isSelected: true, finalOutputId: 'final-1',
      selectionReceiptId: 'receipt-selection-1', selectedAt: '2026-09-01T00:00:01Z', current: true,
    }
    const releaseConditions = { ready: false, blockers: [
      'content_approval_missing', 'release_manifest_not_frozen', 'human_signoff_missing',
    ] }
    const preview = {
      schema: 'jason.qingmu-returned-master-technical-qc-preview.v1', ...SCOPE,
      currentFormalMaster: currentMaster, previewSha256: 'e'.repeat(64),
      idempotencyKey: `e8-master-qc-${'f'.repeat(32)}`, canConfirm: true, hardBlockers: [],
    }
    const result = {
      schema: 'jason.qingmu-returned-master-technical-qc-result.v1', ...SCOPE,
      assetId: candidate.assetId, finalOutputId: 'final-1', masterSha256: candidate.masterSha256,
      outcome: 'passed', qualityStatus: 'passed', canonicalResultSha256: '1'.repeat(64),
      technicalFacts: {
        container: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 5, width: 720, height: 1280,
        fps: '24/1', videoCodec: 'h264', audioCodec: 'aac', hasVideo: true, hasAudio: true,
        byteSize: 2048, materializedSha256: candidate.masterSha256,
      },
      checks: [], uncertainty: [], releaseAuthorityRevisionAtStart: 1,
      releaseAuthorityRevision: 2, releaseConditions, commandReceiptId: 'receipt-qc-1',
      recordedAt: '2026-09-01T00:00:02Z',
    }
    let qcDone = false
    let qcPosts = 0
    let qcStatusFails = false
    const commit = deferred<Response>()
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('returned-master-candidates')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [candidate],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-selection-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-status.v1', ...SCOPE,
          selectionRevision: 1,
          currentFormalMaster: { ...currentMaster, qualityStatus: qcDone ? 'passed' : 'pending' },
          candidates: [{ ...currentMaster, qualityStatus: qcDone ? 'passed' : 'pending' }],
          releaseConditions,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-technical-qc-status')) {
        if (qcStatusFails) return new Response('{}', { status: 502 })
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-technical-qc-status.v1', ...SCOPE,
          currentTechnicalQc: qcDone ? result : null, hardBlockers: [], releaseConditions,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-technical-qc-preview')) {
        return new Response(JSON.stringify(preview), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('returned-master-technical-qc') && init?.method === 'POST') {
        qcPosts += 1
        return commit.promise
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const editorialHandoff = vi.fn().mockResolvedValue(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText(/雨夜街口/u)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffTechnicalQcPrepare })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffTechnicalQcPrepare }))
    const run = await screen.findByRole('button', { name: zh.handoffTechnicalQcRun })
    fireEvent.click(run)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffTechnicalQcRunning })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffTechnicalQcRunning }))
    expect(qcPosts).toBe(1)
    qcDone = true
    commit.resolve(new Response(JSON.stringify(result), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await waitFor(() => { expect(screen.getByText(zh.handoffTechnicalQcPassed)).toBeTruthy() })
    expect(screen.getByText(zh.handoffTechnicalQcExactBoundary)).toBeTruthy()
    expect(screen.getByText('720 × 1280')).toBeTruthy()
    expect(screen.getByText('h264 / aac')).toBeTruthy()
    expect(qcPosts).toBe(1)
    qcStatusFails = true
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByText(/technical_qc_status_failed/u)).toBeTruthy() })
    expect(screen.queryByText(zh.handoffTechnicalQcPassed)).toBeNull()
  })

  it('shows canonical machine blockers and keeps freeze separate from signoff', async () => {
    const currentMaster = {
      assetId: 'asset-master-1', masterSha256: '1'.repeat(64), mimeType: 'video/mp4',
      byteSize: 2048, qualityStatus: 'passed', selectionStatus: 'Selected',
      isSelected: true, finalOutputId: 'final-master-1', selectionReceiptId: 'receipt-selection-1',
      selectedAt: '2026-09-01T00:00:01Z', current: true,
    }
    const qc = {
      schema: 'jason.qingmu-returned-master-technical-qc-result.v1', ...SCOPE,
      outcome: 'passed', qualityStatus: 'passed', commandReceiptId: 'receipt-qc-1',
      technicalFacts: {
        container: 'mov,mp4', durationSec: 5, width: 720, height: 1280, fps: '24/1',
        videoCodec: 'h264', audioCodec: 'aac', hasVideo: true, hasAudio: true,
        byteSize: 2048, materializedSha256: '1'.repeat(64),
      },
      checks: [], uncertainty: [], canonicalResultSha256: '7'.repeat(64),
      masterSha256: '1'.repeat(64), releaseAuthorityRevisionAtStart: 1,
      releaseAuthorityRevision: 2, releaseConditions: { ready: false, blockers: [] },
    }
    const subject = {
      buildIdentity: { commit: 'c'.repeat(40), sourceClean: true, appEnv: 'production' },
      final: { finalOutputId: 'final-master-1', assetId: 'asset-master-1',
        sha256: '1'.repeat(64), bytes: 2048 },
    }
    const blockedPreview = {
      schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...SCOPE, subject,
      previewSha256: '2'.repeat(64), idempotencyKey: 'e8-evidence-freeze-12345678',
      machineReady: false, machineBlockers: ['strict_verify_episode_failed'],
      releaseBlockers: ['formal_evidence_package_missing'], canConfirm: false,
      hardBlockers: ['strict_verify_episode_failed', 'canonical_evidence_machine_not_ready'],
    }
    const readyPreview = {
      ...blockedPreview, machineReady: true, machineBlockers: [], canConfirm: true,
      hardBlockers: [],
    }
    const result = {
      schema: 'jason.qingmu-canonical-evidence-freeze-result.v1', ...SCOPE,
      packageId: 'evidence-package-1', manifestSha256: '3'.repeat(64),
      zipSha256: '4'.repeat(64), zipBytes: 4096, requestSha256: '5'.repeat(64),
      subjectSha256: '6'.repeat(64), releaseAuthorityRevisionBefore: 2,
      releaseAuthorityRevision: 3, commandReceiptId: 'receipt-evidence-1',
      eventId: 'event-evidence-1', committedAt: '2026-09-01T00:00:02Z',
      releaseSignoffGranted: false, releaseReady: false,
      releaseBlockers: ['human_signoff_missing', 'release_check_required'],
    }
    let preview = blockedPreview
    let currentPackage: typeof result | null = null
    let confirmPosts = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('returned-master-candidates')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-selection-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-selection-status.v1', ...SCOPE,
          currentFormalMaster: currentMaster, candidates: [currentMaster],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-technical-qc-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-technical-qc-status.v1', ...SCOPE,
          currentTechnicalQc: qc, hardBlockers: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('canonical-evidence-freeze-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-canonical-evidence-freeze-status.v1', ...SCOPE,
          currentPackage, preview,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('canonical-evidence-freeze-preview')) {
        return new Response(JSON.stringify(preview), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('canonical-evidence-freeze') && init?.method === 'POST') {
        confirmPosts += 1
        currentPackage = result
        return new Response(JSON.stringify(result), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const port = { editorialHandoff: vi.fn().mockResolvedValue(handoff()) } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await screen.findByText(/雨夜街口/u)
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByText('strict_verify_episode_failed')).toBeTruthy() })
    // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc resolves getByRole as HTMLElement
    expect((screen.getByRole('button', { name: zh.handoffEvidenceFreezeSave }) as HTMLButtonElement).disabled).toBe(true)
    expect(confirmPosts).toBe(0)

    preview = readyPreview
    fireEvent.click(screen.getByRole('button', { name: zh.handoffEvidenceFreezePrepare }))
    await waitFor(() => {
      // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc resolves getByRole as HTMLElement
      expect((screen.getByRole('button', { name: zh.handoffEvidenceFreezeSave }) as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffEvidenceFreezeSave }))
    await screen.findByText(zh.handoffEvidenceFreezeSaved)
    expect(screen.getByText(zh.handoffEvidenceFreezeSavedBoundary)).toBeTruthy()
    expect(screen.getByText(zh.handoffEvidenceFreezeBoundary)).toBeTruthy()
    expect(confirmPosts).toBe(1)
  })

  it('clears old media and download state before a failed refresh settles', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined
    const pending = new Promise<YimengEditorialHandoffResponse>((_resolve, reject) => { rejectRefresh = reject })
    const editorialHandoff = vi.fn()
      .mockResolvedValueOnce(handoff())
      .mockReturnValueOnce(pending)
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText('take-1')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    expect(screen.queryByText('take-1')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.handoffDownloadDisabled })).toBeNull()
    rejectRefresh?.(new Error('internal: SOURCE_DRIFT'))
    await waitFor(() => { expect(screen.getByText(zh.handoffSourceDrift)).toBeTruthy() })
    expect(screen.queryByText('take-1')).toBeNull()
  })

  it('replaces old media with a readable unavailable projection on refresh', async () => {
    const initial = handoff()
    const shot = initial.source.shots[0]
    if (shot?.selectedTake === null || shot?.selectedTake === undefined) throw new Error('fixture selected Take is required')
    const missing: YimengEditorialHandoffResponse = {
      ...initial,
      source: { ...initial.source, shots: [{
        ...shot,
        selectedTake: {
          ...shot.selectedTake,
          sha256: null,
          materializationStatus: 'unavailable',
          outputBindingStatus: 'materialized_file_missing',
          durationSec: null,
        },
        blockers: [
          'editorial_handoff_approval_record_missing', 'editorial_handoff_qc_record_missing',
          'editorial_handoff_selected_media_metadata_missing', 'editorial_handoff_selected_media_missing',
        ],
      }] },
      summary: { ...initial.summary, totalDurationSec: 0 },
    }
    const editorialHandoff = vi.fn().mockResolvedValueOnce(handoff()).mockResolvedValueOnce(missing)
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText('take-1')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(screen.getByText(zh.handoffBlockerMediaMissing)).toBeTruthy() })
    expect(screen.queryByText('5'.repeat(64))).toBeNull()
    expect(screen.getByText('Media SHA: —')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.handoffDownloadDisabled }).hasAttribute('disabled')).toBe(true)
  })

  it('starts one Host download and displays its verified SHA and size', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const fetchStatus = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => fetchUrl(input).includes('/rc1-status?')
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({
        status: 'succeeded', sha256: '8'.repeat(64), size: 4096, errorCode: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchStatus)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffDownload })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffDownload }))
    expect(click).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.getByText(/SHA-256: 8888/u)).toBeTruthy() }, { timeout: 2000 })
    expect(screen.getByText(/4,096 bytes/u)).toBeTruthy()
    expect(fetchStatus.mock.calls.filter(call => fetchUrl(call[0]).includes('download-status')).length).toBe(1)
  })

  it('discards a late download status after refresh clears the projection', async () => {
    let resolveStatus: ((value: Response) => void) | undefined
    const status = new Promise<Response>((resolve) => { resolveStatus = resolve })
    const editorialHandoff = vi.fn()
      .mockResolvedValueOnce(downloadableHandoff())
      .mockResolvedValueOnce(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(status))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffDownload })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffDownload }))
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(2) })
    resolveStatus?.(new Response(JSON.stringify({
      status: 'succeeded', sha256: '9'.repeat(64), size: 2048, errorCode: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await new Promise(resolve => window.setTimeout(resolve, 600))
    expect(screen.queryByText(/SHA-256:/u)).toBeNull()
    expect(screen.getByRole('button', { name: zh.handoffDownloadDisabled })).toBeTruthy()
  })

  it('keeps the selected ZIP and renders three independent consumption conclusions', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const result = {
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      packageSha256: '8'.repeat(64), packageSize: 4,
      receiptMatch: true, internalValidity: true, currentAuthority: { matches: false },
      preview: {
        tracks: [{ name: 'Picture', kind: 'Video', clipCount: 1 }, { name: 'Dialogue', kind: 'Audio', clipCount: 1 }],
        orderedShots: [{ order: 1, frameId: 'frame-1', frameNo: 1, videoRange: { durationSec: 4.25 },
          videoPath: `media/${'5'.repeat(64)}.mp4`, audioPath: `media/${'6'.repeat(64)}.wav` }],
        media: [{ kind: 'video', path: `media/${'5'.repeat(64)}.mp4`, size: 4, sha256: '5'.repeat(64) }],
        unresolved: [],
      },
    }
    const fetchImport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (fetchUrl(input).includes('/rc1-status?')) return new Response('{}', { status: 404 })
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      return new Response(JSON.stringify(method === 'POST'
        ? result : { status: 'not_started', result: null, errorCode: null }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImport)
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByLabelText(zh.handoffImportChoose)).toBeTruthy() })
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'handoff.otio.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText(zh.handoffImportChoose), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffImportVerify }))
    await waitFor(() => { expect(screen.getByText(zh.handoffImportCurrentDrift)).toBeTruthy() })
    expect(screen.getByText(zh.handoffImportMatched)).toBeTruthy()
    expect(screen.getByText(zh.handoffImportValid)).toBeTruthy()
    expect(screen.getByText(/Picture · Video · 1/u)).toBeTruthy()
    expect(screen.getByText(/handoff\.otio\.zip/u)).toBeTruthy()
    expect(fetchImport.mock.calls.filter(call => !fetchUrl(call[0]).includes('/rc1-status?')).length).toBe(3)
  })

  it('preflights one returned master only after package recovery and shows the exact boundary', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const packageResult = {
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      packageSha256: '8'.repeat(64), packageSize: 4,
      receiptMatch: true, internalValidity: true, currentAuthority: { matches: true },
      preview: { tracks: [{ name: 'Picture', kind: 'Video', clipCount: 0 }, { name: 'Dialogue', kind: 'Audio', clipCount: 0 }],
        orderedShots: [], media: [], unresolved: [] },
    }
    const masterAccess = { requestId: '33333333-3333-4333-8333-333333333333', capability: 'c'.repeat(64) }
    const candidateAccess = { requestId: '4'.repeat(64), capability: 'd'.repeat(64) }
    const masterResult = {
      preflightSha256: 'a'.repeat(64),
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      binding: {
        sourceSnapshotSha256: '6'.repeat(64), projectionSha256: '7'.repeat(64),
        downloadRequestId: '12345678-1234-1234-1234-123456789abc',
        importRequestId: '87654321-4321-4321-4321-cba987654321',
        packageSha256: '8'.repeat(64), packageSize: 4,
      },
      master: {
        sha256: '9'.repeat(64), size: 12, mimeType: 'video/mp4', container: 'mp4',
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2', durationSec: 5, width: 720, height: 1280, fps: 24,
        videoStreams: [{ codec: 'h264' }], audioStreams: [{ codec: 'aac' }],
      }, blockers: [],
    }
    const candidateResult = {
      schema: 'jason.qingmu-returned-master-candidate-result.v1',
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      assetId: 'asset-returned-master-1', masterSha256: '9'.repeat(64), materializedSha256: '9'.repeat(64),
      byteSize: 12, mimeType: 'video/mp4', packageSha256: '8'.repeat(64),
      sourceSnapshotSha256: '6'.repeat(64), projectionSha256: '7'.repeat(64), preflightSha256: 'a'.repeat(64),
      qualityStatus: 'pending', selectionStatus: 'Unselected', isSelected: false,
      approved: false, published: false, idempotencyKey: '4'.repeat(64), commandReceiptId: 'receipt-candidate-1',
      savedAt: '2026-09-01T07:00:00Z', providerCalls: 0, stageStarted: false,
      approvalGranted: false, selectionGranted: false, releaseGranted: false, humanSignoffInferred: false,
    }
    const fetchMaster = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (url.includes('returned-master-candidate') && method === 'POST') {
        return new Response(JSON.stringify(candidateResult), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('returned-master-candidates')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-returned-master-candidates.v1', candidates: [candidateResult],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('master-preflight') && method === 'POST') {
        return new Response(JSON.stringify({ ...masterResult, candidateAccess }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('master-preflight-status')) {
        return new Response(JSON.stringify({ status: 'not_started', result: null }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        status: 'succeeded', result: packageResult, errorCode: null, masterAccess,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMaster)
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    const input = await screen.findByLabelText(zh.handoffMasterChoose) as HTMLInputElement
    await waitFor(() => { expect(input.disabled).toBe(false) })
    const file = new File([new Uint8Array(12)], 'returned-master.mp4', { type: 'video/mp4' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffMasterVerify }))
    await waitFor(() => { expect(screen.getByText(zh.handoffMasterExactBoundary)).toBeTruthy() })
    expect(screen.getByText(zh.handoffMasterTechnicalPass)).toBeTruthy()
    expect(screen.getByText(/Master SHA: 9999/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateSave }))
    await waitFor(() => { expect(screen.getByText(zh.handoffCandidateUnselected)).toBeTruthy() })
    expect(screen.getByText(zh.handoffCandidateSaved)).toBeTruthy()
    expect(screen.getByText(/asset-returned-master-1/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.handoffCandidateRead }))
    await waitFor(() => { expect(screen.getByText(/receipt-candidate-1/u)).toBeTruthy() })
    expect(screen.getByText(/returned-master\.mp4/u)).toBeTruthy()
    expect(input.disabled).toBe(true)
    expect(screen.getByText(zh.handoffMasterLocked)).toBeTruthy()
    const otherFile = new File([new Uint8Array(8)], 'other-master.mp4', { type: 'video/mp4' })
    fireEvent.change(input, { target: { files: [otherFile] } })
    expect(screen.queryByText(/other-master\.mp4/u)).toBeNull()
    expect(screen.getAllByText(/Master SHA: 9999/u)).toHaveLength(2)
    expect(fetchMaster.mock.calls.filter(([request, options]) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      const method = options?.method ?? (request instanceof Request ? request.method : 'GET')
      return url.includes('master-preflight') && method === 'POST'
    })).toHaveLength(1)
    expect(fetchMaster.mock.calls.filter(([request, options]) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      const method = options?.method ?? (request instanceof Request ? request.method : 'GET')
      return url.includes('returned-master-candidate') && method === 'POST'
    })).toHaveLength(1)
  })

  it('discards a deferred master result when the user selects another package', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const lateMaster = deferred<Response>()
    const packageResult = {
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      packageSha256: '8'.repeat(64), packageSize: 4,
      receiptMatch: true, internalValidity: true, currentAuthority: { matches: true },
      preview: { tracks: [], orderedShots: [], media: [], unresolved: [] },
    }
    const masterAccess = { requestId: '33333333-3333-4333-8333-333333333333', capability: 'c'.repeat(64) }
    let importStatusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (url.includes('master-preflight') && method === 'POST') return lateMaster.promise
      if (url.includes('master-preflight-status')) {
        return Promise.resolve(new Response(JSON.stringify({ status: 'not_started', result: null }), {
          status: 200, headers: { 'content-type': 'application/json' },
        }))
      }
      if (url.includes('import-status')) {
        importStatusReads += 1
        return Promise.resolve(new Response(JSON.stringify(importStatusReads === 1
          ? { status: 'not_started', result: null }
          : { status: 'succeeded', result: packageResult, masterAccess }), {
          status: 200, headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(packageResult), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    const packageInput = await screen.findByLabelText(zh.handoffImportChoose)
    fireEvent.change(packageInput, {
      target: { files: [new File([new Uint8Array([1])], 'package-a.otio.zip', { type: 'application/zip' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffImportVerify }))
    const masterInput = await screen.findByLabelText(zh.handoffMasterChoose) as HTMLInputElement
    await waitFor(() => { expect(masterInput.disabled).toBe(false) })
    fireEvent.change(masterInput, {
      target: { files: [new File([new Uint8Array(12)], 'master-a.mp4', { type: 'video/mp4' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffMasterVerify }))
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffMasterRunning })).toBeTruthy() })
    fireEvent.change(packageInput, {
      target: { files: [new File([new Uint8Array([2])], 'package-b.otio.zip', { type: 'application/zip' })] },
    })
    lateMaster.resolve(new Response(JSON.stringify({
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      binding: {
        sourceSnapshotSha256: '6'.repeat(64), projectionSha256: '7'.repeat(64),
        downloadRequestId: '12345678-1234-1234-1234-123456789abc',
        importRequestId: '87654321-4321-4321-4321-cba987654321',
        packageSha256: '8'.repeat(64), packageSize: 4,
      },
      master: {
        sha256: '9'.repeat(64), size: 12, mimeType: 'video/mp4', container: 'mp4',
        formatName: 'mov,mp4', durationSec: 5, width: 720, height: 1280, fps: 24,
        videoStreams: [{ codec: 'h264' }], audioStreams: [{ codec: 'aac' }],
      }, blockers: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await waitFor(() => { expect(screen.getByText(/package-b\.otio\.zip/u)).toBeTruthy() })
    expect(screen.queryByText(/Master SHA: 9999/u)).toBeNull()
    expect(screen.queryByText(zh.handoffMasterExactBoundary)).toBeNull()
  })

  it('does not inject master access from a deferred import status after package selection', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const lateStatus = deferred<Response>()
    let statusSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (fetchUrl(input).includes('/rc1-status?')) {
        return Promise.resolve(new Response('{}', { status: 404 }))
      }
      statusSignal = init?.signal ?? undefined
      return lateStatus.promise
    }))
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    const packageInput = await screen.findByLabelText(zh.handoffImportChoose)
    await waitFor(() => { expect(statusSignal).toBeDefined() })
    fireEvent.change(packageInput, {
      target: { files: [new File([new Uint8Array([2])], 'package-b.otio.zip', { type: 'application/zip' })] },
    })
    lateStatus.resolve(new Response(JSON.stringify({
      status: 'succeeded',
      result: {
        projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
        packageSha256: '8'.repeat(64), packageSize: 4,
        receiptMatch: true, internalValidity: true, currentAuthority: { matches: true },
        preview: { tracks: [], orderedShots: [], media: [], unresolved: [] },
      },
      masterAccess: { requestId: '33333333-3333-4333-8333-333333333333', capability: 'c'.repeat(64) },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(statusSignal?.aborted).toBe(true)
    expect(screen.queryByText(zh.handoffImportMatched)).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>(zh.handoffMasterChoose).disabled).toBe(true)
    expect(screen.getByText(/package-b\.otio\.zip/u)).toBeTruthy()
  })

  it('recovers an already verified preview from Host status without reuploading bytes', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const result = {
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      packageSha256: '8'.repeat(64), packageSize: 4,
      receiptMatch: true, internalValidity: true, currentAuthority: { matches: true },
      preview: { tracks: [{ name: 'Picture', kind: 'Video', clipCount: 0 }, { name: 'Dialogue', kind: 'Audio', clipCount: 0 }],
        orderedShots: [], media: [], unresolved: [] },
    }
    const fetchStatus = vi.fn(async (input: string | URL | Request) => fetchUrl(input).includes('/rc1-status?')
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({ status: 'succeeded', result, errorCode: null }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchStatus)
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText(zh.handoffImportCurrentMatched)).toBeTruthy() })
    expect(screen.getByText(zh.handoffImportPreviewOnly)).toBeTruthy()
    const importCalls = fetchStatus.mock.calls.filter(call => fetchUrl(call[0]).includes('import-status'))
    expect(importCalls).toHaveLength(1)
    const importCall = importCalls[0] as unknown as [string | URL | Request, RequestInit?]
    expect(importCall[1]?.method).toBe('GET')
  })

  it('discards a late import POST response after the project scope changes', async () => {
    const editorialHandoff = vi.fn().mockResolvedValue(downloadableHandoff(true))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const latePost = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method === 'POST') return latePost.promise
      return Promise.resolve(new Response(JSON.stringify({ status: 'not_started', result: null }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    const view = render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByLabelText(zh.handoffImportChoose)).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(zh.handoffImportChoose), {
      target: { files: [new File([new Uint8Array([1])], 'old.otio.zip', { type: 'application/zip' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffImportVerify }))
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffImportRunning })).toBeTruthy() })
    view.rerender(<EditorialHandoff projectId="project-new" episodeId="episode-new" port={port} t={t} />)
    latePost.resolve(new Response(JSON.stringify({
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      packageSha256: '8'.repeat(64), packageSize: 1, receiptMatch: true, internalValidity: true,
      currentAuthority: { matches: true }, preview: { tracks: [], orderedShots: [], media: [], unresolved: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledWith(
      { projectId: 'project-new', episodeId: 'episode-new' }, expect.any(AbortSignal),
    ) })
    expect(screen.queryByText(zh.handoffImportMatched)).toBeNull()
  })

  it('discards a late recovery status after refresh invalidates the import', async () => {
    const editorialHandoff = vi.fn()
      .mockResolvedValueOnce(downloadableHandoff(true))
      .mockResolvedValueOnce(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const lateStatus = deferred<Response>()
    let postSeen = false
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method === 'POST') {
        postSeen = true
        return Promise.resolve(new Response('{}', { status: 503 }))
      }
      return postSeen ? lateStatus.promise : Promise.resolve(new Response(JSON.stringify({
        status: 'not_started', result: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByLabelText(zh.handoffImportChoose)).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(zh.handoffImportChoose), {
      target: { files: [new File([new Uint8Array([1])], 'old.otio.zip', { type: 'application/zip' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffImportVerify }))
    await waitFor(() => { expect(postSeen).toBe(true) })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    lateStatus.resolve(new Response(JSON.stringify({
      status: 'succeeded', result: {
        projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
        packageSha256: '8'.repeat(64), packageSize: 1, receiptMatch: true, internalValidity: true,
        currentAuthority: { matches: true }, preview: { tracks: [], orderedShots: [], media: [], unresolved: [] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await waitFor(() => { expect(editorialHandoff).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText(zh.handoffImportMatched)).toBeNull()
  })

  it('keeps RC1 machine evidence, user content review, and release signoff separate', async () => {
    installPlatformAssertionMock()
    const editorialHandoff = vi.fn().mockResolvedValue(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const binding = {
      projectId: SCOPE.projectId, episodeId: SCOPE.episodeId,
      contentReviewToken: 'a'.repeat(64), finalOutputId: 'final-rc1', finalAssetId: 'asset-rc1',
      finalSha256: 'b'.repeat(64), finalBytes: 2048, materializedSha256: 'b'.repeat(64),
      verifyEvidenceSha256: 'c'.repeat(64), rc1PackageId: 'evidence-rc1',
      rc1ManifestSha256: 'd'.repeat(64),
    }
    const currentPackage = {
      packageLevel: 'RC1', packageId: 'evidence-rc1', manifestSha256: 'd'.repeat(64),
      zipSha256: 'e'.repeat(64), zipBytes: 4096, commandReceiptId: 'receipt-rc1',
    }
    const preview = {
      schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...SCOPE,
      subject: { packageLevel: 'RC1', buildIdentity: { commit: 'f'.repeat(40) } },
      previewSha256: '1'.repeat(64), idempotencyKey: 'rc1-preview-12345678',
      canConfirm: true, hardBlockers: [],
    }
    let decision: Record<string, unknown> | null = null
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('/human-session')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.includes('/human-presence-credential')) {
        return new Response(JSON.stringify(registeredPlatformPresence()), { status: 200 })
      }
      if (url.includes('/rc1-status?')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...SCOPE,
          rc1Package: { packageLevel: 'RC1', currentPackage, preview },
          contentReview: {
            schema: 'jason.episode-final-content-decision-status.v1', binding,
            currentDecision: decision, canDecide: decision === null,
            legacyDecisionRequiresReconfirmation: false,
            identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
              projectId: SCOPE.projectId, actorUserId: 'owner', state: 'bound',
              naturalPersonId: 'local-person-test', canEnroll: false,
              legalIdentityVerified: false, humanSignoffGranted: false },
            releaseSignoffGranted: false, publishReady: false,
          },
          releaseSignoff: { granted: false, readOnly: true, blockers: ['organization_release_signoff_missing'] },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/final-content-decision?') && init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        if (body.platformAssertion === undefined) {
          return new Response(JSON.stringify(platformAuthenticationOptions()), { status: 200 })
        }
        posts.push(body)
        decision = {
          schema: 'jason.episode-final-content-decision.v1', ...SCOPE,
          decision: body.decision, reason: body.reason, binding,
          idempotencyKey: body.idempotencyKey, commandReceiptId: 'receipt-decision',
          changeSetId: 'changeset-decision', requestSha256: '9'.repeat(64),
          playedCoverage: 1, checks: body.checks, secondConfirmed: false,
          humanAuthorityStatus: 'platform_verified', humanAuthorityVerified: true,
          releaseSignoffGranted: false, publishReady: false,
        }
        return new Response(JSON.stringify(decision), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }))

    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: zh.handoffRefresh })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(document.querySelector('video')).toBeTruthy() })
    await authenticateHumanSession()
    expect(screen.getByText(zh.handoffMachineEvidenceTitle)).toBeTruthy()
    expect(screen.getByText(zh.handoffReleaseSignoffTitle)).toBeTruthy()
    expect(screen.getByText(zh.handoffReleaseSignoffMissing)).toBeTruthy()
    const player = document.querySelector('video')
    expect(player).toBeTruthy()
    expect(player?.getAttribute('preload')).toBe('none')
    expect(player?.getAttribute('src')).toContain(`sha256=${'b'.repeat(64)}`)
    const accept = screen.getByRole('button', { name: zh.handoffContentAccept }) as HTMLButtonElement
    const reject = screen.getByRole('button', { name: zh.handoffContentReject }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(reject.disabled).toBe(true)

    reportPlayback(player as HTMLVideoElement, [[0, 10]])
    await waitFor(() => { expect(reject.disabled).toBe(false) })
    fireEvent.change(screen.getByLabelText(zh.handoffContentNote), {
      target: { value: 'isolated rejection note' },
    })
    fireEvent.click(reject)
    await waitFor(() => { expect(posts).toHaveLength(1) })
    expect(posts[0]?.decision).toBe('rejected')
    expect(posts.some(item => item.decision === 'accepted')).toBe(false)
    await waitFor(() => { expect(screen.getByText(zh.handoffContentRejected)).toBeTruthy() })
    expect(localStorage.getItem('isolated rejection note')).toBeNull()
  })

  it('can cancel the native platform registration prompt without writing a human decision', async () => {
    class PendingPublicKeyCredential { readonly fixture = true }
    vi.stubGlobal('PublicKeyCredential', PendingPublicKeyCredential)
    let registrationPosts = 0
    let decisionPosts = 0
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create: vi.fn(async ({ signal }: CredentialCreationOptions) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => { reject(new DOMException('cancelled', 'AbortError')) },
          { once: true })
      })),
    } })
    const binding = {
      ...SCOPE, contentReviewToken: 'a'.repeat(64), finalOutputId: 'final-rc1',
      finalAssetId: 'asset-rc1', finalSha256: 'b'.repeat(64), finalBytes: 2048,
      materializedSha256: 'b'.repeat(64), verifyEvidenceSha256: 'c'.repeat(64),
      rc1PackageId: 'evidence-rc1', rc1ManifestSha256: 'd'.repeat(64),
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('/human-session')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.includes('/human-presence-credential')) {
        if (init?.method === 'GET') return new Response(JSON.stringify({
          ...registeredPlatformPresence(), state: 'unregistered', credentialSha256: null,
        }), { status: 200 })
        registrationPosts += 1
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-platform-human-presence-options.v1', ceremony: 'registration',
          challengeId: 'challenge-platform-12345678', expiresAt: '2026-09-02T12:00:00Z',
          publicKey: { challenge: 'AAAAAAAAAAAAAAAA', rp: { id: '127.0.0.1', name: 'Qingmu OS' },
            user: { id: 'AAAAAAAAAAAAAAAA', name: 'owner', displayName: 'Qingmu local user' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000,
            attestation: 'none', authenticatorSelection: { authenticatorAttachment: 'platform',
              residentKey: 'required', requireResidentKey: true, userVerification: 'required' } },
        }), { status: 200 })
      }
      if (url.includes('/rc1-status?')) return new Response(JSON.stringify({
        schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...SCOPE,
        rc1Package: { packageLevel: 'RC1', currentPackage: null, preview: {
          schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...SCOPE,
          subject: { packageLevel: 'RC1', buildIdentity: { commit: 'e'.repeat(40) } },
          previewSha256: '1'.repeat(64), idempotencyKey: 'rc1-preview-12345678',
          canConfirm: false, hardBlockers: ['fixture_rc1_not_frozen'],
        } },
        contentReview: { schema: 'jason.episode-final-content-decision-status.v1', binding,
          currentDecision: null, canDecide: false, legacyDecisionRequiresReconfirmation: false,
          identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
            projectId: SCOPE.projectId, actorUserId: 'owner', state: 'unbound', naturalPersonId: null,
            canEnroll: false, legalIdentityVerified: false, humanSignoffGranted: false },
          releaseSignoffGranted: false, publishReady: false },
        releaseSignoff: { granted: false, readOnly: true, blockers: [] },
      }), { status: 200 })
      if (url.includes('/final-content-decision') || url.includes('/natural-person-identity')) {
        decisionPosts += 1
      }
      return new Response('{}', { status: 404 })
    }))
    const port = { editorialHandoff: vi.fn().mockResolvedValue(handoff()) } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await screen.findByRole('button', { name: zh.handoffRefresh })
    await authenticateHumanSession()
    fireEvent.click(screen.getByRole('button', { name: zh.handoffHumanPresenceRegister }))
    const cancel = await screen.findByRole('button', { name: zh.handoffHumanPresenceCancel })
    fireEvent.click(cancel)
    await waitFor(() => { expect(screen.getByText(zh.handoffHumanPresenceCancelled)).toBeTruthy() })
    expect(registrationPosts).toBe(1)
    expect(decisionPosts).toBe(0)
  })

  it('projects a legacy decision as unverified and keeps reconfirmation available', async () => {
    const binding = {
      ...SCOPE, contentReviewToken: 'a'.repeat(64), finalOutputId: 'final-legacy',
      finalAssetId: 'asset-legacy', finalSha256: 'b'.repeat(64), finalBytes: 2048,
      rc1PackageId: 'evidence-legacy', rc1ManifestSha256: 'd'.repeat(64),
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (!fetchUrl(input).includes('/rc1-status?')) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({
        schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...SCOPE,
        rc1Package: { packageLevel: 'RC1', currentPackage: { packageLevel: 'RC1',
          packageId: 'evidence-legacy', manifestSha256: 'd'.repeat(64), zipSha256: 'e'.repeat(64),
          zipBytes: 2048, commandReceiptId: 'receipt-legacy' }, preview: {
          schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...SCOPE,
          subject: { packageLevel: 'RC1', buildIdentity: { commit: 'e'.repeat(40) } },
          previewSha256: '1'.repeat(64), idempotencyKey: 'rc1-preview-12345678',
          canConfirm: false, hardBlockers: [],
        } },
        contentReview: { schema: 'jason.episode-final-content-decision-status.v1', binding,
          currentDecision: { schema: 'jason.episode-final-content-decision.v1', ...SCOPE,
            binding, decision: 'accepted', humanAuthorityStatus: 'legacy_unverified',
            humanAuthorityVerified: false },
          canDecide: true, legacyDecisionRequiresReconfirmation: true,
          identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
            projectId: SCOPE.projectId, actorUserId: 'owner', state: 'bound',
            naturalPersonId: 'local-person-test', canEnroll: false,
            legalIdentityVerified: false, humanSignoffGranted: false },
          releaseSignoffGranted: false, publishReady: false },
        releaseSignoff: { granted: false, readOnly: true,
          blockers: ['content_review_human_authority_unverified'] },
      }), { status: 200 })
    }))
    const port = { editorialHandoff: vi.fn().mockResolvedValue(handoff()) } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.handoffRefresh }))
    expect(await screen.findByText(zh.handoffContentLegacyUnverified)).toBeTruthy()
    expect(screen.queryByText(zh.handoffContentAccepted)).toBeNull()
    const note = screen.getByLabelText(zh.handoffContentNote)
    expect((note as HTMLTextAreaElement).disabled).toBe(false)
    const accept = screen.getByRole('button', { name: zh.handoffContentAccept })
    if (!(accept instanceof HTMLButtonElement)) throw new Error('accept_control_not_button')
    expect(accept.disabled).toBe(true)
  })

  it('returns to the human login form when identity enrollment requires recent authentication', async () => {
    installPlatformAssertionMock()
    const editorialHandoff = vi.fn().mockResolvedValue(handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const binding = {
      ...SCOPE, contentReviewToken: 'a'.repeat(64), finalOutputId: 'final-rc1',
      finalAssetId: 'asset-rc1', finalSha256: 'b'.repeat(64), finalBytes: 2048,
      materializedSha256: 'b'.repeat(64), verifyEvidenceSha256: 'c'.repeat(64),
      rc1PackageId: 'evidence-rc1', rc1ManifestSha256: 'd'.repeat(64),
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url.includes('/human-session')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.includes('/human-presence-credential')) {
        return new Response(JSON.stringify(registeredPlatformPresence()), { status: 200 })
      }
      if (url.includes('/rc1-status?')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...SCOPE,
          rc1Package: { packageLevel: 'RC1', currentPackage: null, preview: {
            schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...SCOPE,
            subject: { packageLevel: 'RC1', buildIdentity: { commit: 'e'.repeat(40) } },
            previewSha256: '1'.repeat(64), idempotencyKey: 'rc1-preview-12345678',
            canConfirm: false, hardBlockers: ['fixture_rc1_not_frozen'],
          } },
          contentReview: { schema: 'jason.episode-final-content-decision-status.v1', binding,
            currentDecision: null, canDecide: false, legacyDecisionRequiresReconfirmation: false,
            identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
              projectId: SCOPE.projectId, actorUserId: 'owner', state: 'unbound',
              naturalPersonId: null, canEnroll: true,
              legalIdentityVerified: false, humanSignoffGranted: false },
            releaseSignoffGranted: false, publishReady: false },
          releaseSignoff: { granted: false, readOnly: true, blockers: [] },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/natural-person-identity?') && init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        if (body.platformAssertion === undefined) {
          return new Response(JSON.stringify(platformAuthenticationOptions()), { status: 200 })
        }
        return new Response(JSON.stringify({ code: 'natural_person_identity_relogin_required' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    }))

    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => { expect(screen.getByText(zh.handoffIdentityUnbound)).toBeTruthy() })
    await authenticateHumanSession()
    fireEvent.click(screen.getByRole('button', { name: zh.handoffIdentityEnroll }))

    await waitFor(() => { expect(screen.getByText(zh.handoffIdentityRelogin)).toBeTruthy() })
    expect(screen.getByLabelText(zh.handoffHumanPassword)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.handoffHumanSessionLogin })).toBeTruthy()
  })

  it('rotates the decision idempotency key when the episode binding changes', async () => {
    installPlatformAssertionMock()
    const secondScope = { projectId: 'project-e8-next', episodeId: 'episode-e8-next' }
    const editorialHandoff = vi.fn().mockImplementation(async () => handoff())
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    const keys: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(fetchUrl(input), 'http://localhost')
      if (url.pathname.endsWith('/human-session')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      const scope = {
        projectId: url.searchParams.get('projectId') ?? '',
        episodeId: url.searchParams.get('episodeId') ?? '',
      }
      if (url.pathname.endsWith('/human-presence-credential')) {
        return new Response(JSON.stringify({ ...registeredPlatformPresence(), ...scope }), { status: 200 })
      }
      const binding = {
        ...scope,
        contentReviewToken: (scope.projectId === SCOPE.projectId ? 'a' : 'f').repeat(64),
        finalOutputId: `final-${scope.episodeId}`, finalAssetId: `asset-${scope.episodeId}`,
        finalSha256: 'b'.repeat(64), finalBytes: 2048, materializedSha256: 'b'.repeat(64),
        verifyEvidenceSha256: 'c'.repeat(64), rc1PackageId: `evidence-${scope.episodeId}`,
        rc1ManifestSha256: 'd'.repeat(64),
      }
      if (url.pathname.endsWith('/rc1-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...scope,
          rc1Package: { packageLevel: 'RC1', currentPackage: {
            packageLevel: 'RC1', packageId: binding.rc1PackageId,
          }, preview: { schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1', ...scope,
            subject: { packageLevel: 'RC1', buildIdentity: { commit: 'e'.repeat(40) } },
            previewSha256: '1'.repeat(64), idempotencyKey: 'rc1-preview-12345678',
            canConfirm: false, hardBlockers: [] } },
          contentReview: { schema: 'jason.episode-final-content-decision-status.v1', binding,
            currentDecision: null, canDecide: true, legacyDecisionRequiresReconfirmation: false,
            identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
              projectId: scope.projectId, actorUserId: 'owner', state: 'bound',
              naturalPersonId: 'local-person-test', canEnroll: false,
              legalIdentityVerified: false, humanSignoffGranted: false },
            releaseSignoffGranted: false, publishReady: false },
          releaseSignoff: { granted: false, readOnly: true, blockers: [] },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.endsWith('/final-content-decision') && init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        if (body.platformAssertion === undefined) {
          return new Response(JSON.stringify(platformAuthenticationOptions()), { status: 200 })
        }
        keys.push(String(body.idempotencyKey))
        return new Response(JSON.stringify({ schema: 'jason.episode-final-content-decision.v1',
          ...scope, decision: 'rejected', reason: 'picture_or_timing', binding,
          idempotencyKey: body.idempotencyKey, commandReceiptId: `receipt-${scope.episodeId}`,
          changeSetId: `changeset-${scope.episodeId}`, requestSha256: '9'.repeat(64),
          playedCoverage: 1, checks: { picture_and_timing_reviewed: false,
            dialogue_and_audio_reviewed: false, continuity_and_content_reviewed: false },
          secondConfirmed: false,
          humanAuthorityStatus: 'platform_verified', humanAuthorityVerified: true,
          releaseSignoffGranted: false, publishReady: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }))

    const view = render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    let authenticated = false
    for (const scope of [SCOPE, secondScope]) {
      fireEvent.click(await screen.findByRole('button', { name: zh.handoffRefresh }))
      await waitFor(() => { expect(document.querySelector('video')).toBeTruthy() })
      if (!authenticated) { await authenticateHumanSession(); authenticated = true }
      reportPlayback(document.querySelector('video') as HTMLVideoElement, [[0, 10]])
      fireEvent.click(screen.getByRole('button', { name: zh.handoffContentReject }))
      await waitFor(() => { expect(keys).toHaveLength(scope === SCOPE ? 1 : 2) })
      if (scope === SCOPE) view.rerender(
        <EditorialHandoff {...secondScope} port={port} t={t} />,
      )
    }
    expect(keys[0]).not.toBe(keys[1])
  })

  it('clears the whole decision draft when the same episode binding drifts', async () => {
    installPlatformAssertionMock()
    const port = { editorialHandoff: vi.fn().mockResolvedValue(handoff()) } as unknown as QingmuYimengReadPort
    let bindingVersion = 0
    const keys: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(fetchUrl(input), 'http://localhost')
      if (url.pathname.endsWith('/human-session')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.pathname.endsWith('/human-presence-credential')) {
        return new Response(JSON.stringify(registeredPlatformPresence()), { status: 200 })
      }
      const binding = {
        ...SCOPE, contentReviewToken: (bindingVersion === 0 ? 'a' : 'f').repeat(64),
        finalOutputId: 'final-same-episode', finalAssetId: 'asset-same-episode',
        finalSha256: 'b'.repeat(64), finalBytes: 2048, materializedSha256: 'b'.repeat(64),
        verifyEvidenceSha256: 'c'.repeat(64), rc1PackageId: 'evidence-same-episode',
        rc1ManifestSha256: (bindingVersion === 0 ? 'd' : 'e').repeat(64),
      }
      if (url.pathname.endsWith('/rc1-status')) {
        return new Response(JSON.stringify({
          schema: 'jason.qingmu-editorial-handoff-rc1-status.v1', ...SCOPE,
          rc1Package: { packageLevel: 'RC1', currentPackage: { packageLevel: 'RC1' }, preview: null },
          contentReview: { schema: 'jason.episode-final-content-decision-status.v1', binding,
            currentDecision: null, canDecide: true, legacyDecisionRequiresReconfirmation: false,
            identity: { schema: 'jason.qingmu-natural-person-identity-status.v1',
              projectId: SCOPE.projectId, actorUserId: 'owner', state: 'bound',
              naturalPersonId: 'local-person-test', canEnroll: false,
              legalIdentityVerified: false, humanSignoffGranted: false },
            releaseSignoffGranted: false, publishReady: false },
          releaseSignoff: { granted: false, readOnly: true, blockers: [] },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.endsWith('/final-content-decision') && init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new Error('missing JSON body')
        const body = JSON.parse(init.body) as Record<string, unknown>
        if (body.platformAssertion === undefined) {
          return new Response(JSON.stringify(platformAuthenticationOptions()), { status: 200 })
        }
        keys.push(String(body.idempotencyKey))
        return new Response(JSON.stringify({ schema: 'jason.episode-final-content-decision.v1',
          ...SCOPE, binding, decision: 'rejected', reason: 'picture_or_timing',
          idempotencyKey: body.idempotencyKey, releaseSignoffGranted: false, publishReady: false,
          humanAuthorityStatus: 'platform_verified', humanAuthorityVerified: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }))

    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    const firstPlayer = await waitFor(() => {
      const player = document.querySelector('video')
      expect(player).toBeTruthy()
      return player as HTMLVideoElement
    })
    await authenticateHumanSession()
    reportPlayback(firstPlayer, [[0, 10]])
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckPicture))
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckAudio))
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckContinuity))
    fireEvent.change(screen.getByLabelText(zh.handoffContentNote), { target: { value: 'must reset' } })
    fireEvent.click(screen.getByRole('button', { name: zh.handoffContentReject }))
    await waitFor(() => { expect(keys).toHaveLength(1) })

    bindingVersion = 1
    fireEvent.click(screen.getByRole('button', { name: zh.handoffRefresh }))
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.tagName === 'P'
        && element.textContent.includes(`${zh.handoffContentPlayback}: 0%`))).toBeTruthy()
    })
    const resetNote = screen.getByLabelText(zh.handoffContentNote)
    if (!(resetNote instanceof HTMLTextAreaElement)) throw new Error('content note is not a textarea')
    expect(resetNote.value).toBe('')
    for (const label of [zh.handoffContentCheckPicture, zh.handoffContentCheckAudio,
      zh.handoffContentCheckContinuity]) {
      const resetCheck = screen.getByLabelText(label)
      if (!(resetCheck instanceof HTMLInputElement)) throw new Error('review check is not an input')
      expect(resetCheck.checked).toBe(false)
    }
    reportPlayback(document.querySelector('video') as HTMLVideoElement, [[0, 10]])
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckPicture))
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckAudio))
    fireEvent.click(screen.getByLabelText(zh.handoffContentCheckContinuity))
    fireEvent.click(screen.getByRole('button', { name: zh.handoffContentReject }))
    await waitFor(() => { expect(keys).toHaveLength(2) })
    expect(keys[0]).not.toBe(keys[1])
  })
})
