// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorialHandoff } from '../src/client/EditorialHandoff.tsx'
import type { QingmuYimengReadPort, YimengEditorialHandoffResponse } from '../src/client/contracts.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

const SCOPE = { projectId: 'project-e8', episodeId: 'episode-e8' }
const t = (key: QingmuCockpitKey) => zh[key]

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('editorial handoff panel', () => {
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

  it('turns a Host source drift into a localized refresh action', async () => {
    const editorialHandoff = vi.fn().mockRejectedValue(new Error('internal: SOURCE_DRIFT'))
    const port = { editorialHandoff } as unknown as QingmuYimengReadPort
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.handoffSourceDrift) })
    expect(screen.getByRole('button', { name: zh.handoffRefresh })).toBeTruthy()
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
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.handoffSourceDrift) })
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
    const fetchStatus = vi.fn().mockResolvedValue(new Response(JSON.stringify({
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
    expect(fetchStatus).toHaveBeenCalledTimes(1)
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
    expect(fetchImport).toHaveBeenCalledTimes(3)
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
    const masterResult = {
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
    const fetchMaster = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (url.includes('master-preflight') && method === 'POST') {
        return new Response(JSON.stringify(masterResult), { status: 200, headers: { 'content-type': 'application/json' } })
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
    expect(screen.getByText(/returned-master\.mp4/u)).toBeTruthy()
    expect(input.disabled).toBe(true)
    expect(screen.getByText(zh.handoffMasterLocked)).toBeTruthy()
    const otherFile = new File([new Uint8Array(8)], 'other-master.mp4', { type: 'video/mp4' })
    fireEvent.change(input, { target: { files: [otherFile] } })
    expect(screen.queryByText(/other-master\.mp4/u)).toBeNull()
    expect(screen.getByText(/Master SHA: 9999/u)).toBeTruthy()
    expect(fetchMaster.mock.calls.filter(([request, options]) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      const method = options?.method ?? (request instanceof Request ? request.method : 'GET')
      return url.includes('master-preflight') && method === 'POST'
    })).toHaveLength(1)
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
    const fetchStatus = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'succeeded', result, errorCode: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchStatus)
    render(<EditorialHandoff {...SCOPE} port={port} t={t} />)
    await waitFor(() => { expect(screen.getByText(zh.handoffImportCurrentMatched)).toBeTruthy() })
    expect(screen.getByText(zh.handoffImportPreviewOnly)).toBeTruthy()
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect((fetchStatus.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('GET')
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
})
