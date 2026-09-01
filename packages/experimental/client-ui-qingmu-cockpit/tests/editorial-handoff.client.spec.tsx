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
      shots: [{
        frameId: 'frame-1', frameNo: 1, sceneId: 'scene-1', title: '雨夜街口',
        frameContentSha256: '3'.repeat(64), stackSnapshotSha256: '4'.repeat(64),
        selectedTake: {
          assetId: 'take-1', assetRevision: 2, sha256: '5'.repeat(64),
          materializationStatus: 'available', mimeType: 'video/mp4',
          durationSec: 4.25, fps: 24, width: 720, height: 1280, aspectRatio: '720:1280',
          recordedOutputSha256: '5'.repeat(64), outputBindingStatus: 'verified',
          selectionStatus: 'Selected', qualityStatus: 'passed', lineageComplete: true,
        },
        audio: { status: 'not_authoritatively_bound', asset: null },
        comments: {} as unknown as YimengEditorialHandoffResponse['source']['shots'][number]['comments'],
        review: {} as unknown as YimengEditorialHandoffResponse['source']['shots'][number]['review'],
        qc: null, approval: null,
        blockers: ['editorial_handoff_approval_record_missing', 'editorial_handoff_qc_record_missing'],
      }],
    },
    sourceSnapshotSha256: '6'.repeat(64),
    summary: { shotCount: 1, selectedTakeCount: 1, authoritativeAudioCount: 0,
      totalDurationSec: 4.25, unresolvedCount: 3 },
    unresolved: [
      { frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
      { frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
      { frameId: null, code: 'editorial_handoff_otio_dependency_unavailable' },
    ],
    blockers: [
      { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_approval_record_missing' },
      { scope: 'shot', frameId: 'frame-1', code: 'editorial_handoff_qc_record_missing' },
      { scope: 'export', frameId: null, code: 'editorial_handoff_otio_dependency_unavailable' },
    ],
    download: { available: false, format: 'otio-zip', blockerCode: 'editorial_handoff_otio_dependency_unavailable' },
    aokiVideoProductionHandoffReady: false, yimengEpisodeReleaseReady: false,
    readOnly: true, providerCalls: 0, businessMutations: 0, projectionSha256: '7'.repeat(64),
  }
}

function mount() {
  const editorialHandoff = vi.fn().mockResolvedValue(handoff())
  const port = { editorialHandoff } as unknown as QingmuYimengReadPort
  return { editorialHandoff, ...render(<EditorialHandoff {...SCOPE} port={port} t={t} />) }
}

afterEach(cleanup)

describe('editorial handoff panel', () => {
  it('shows separate false readiness, authoritative media facts, and no write action', async () => {
    const { editorialHandoff } = mount()
    await waitFor(() => { expect(screen.getByText(/雨夜街口/u)).toBeTruthy() })
    expect(editorialHandoff).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain(`${zh.handoffProductionReady}: ${zh.handoffFalse}`)
    expect(screen.getByRole('status').textContent).toContain(`${zh.handoffReleaseReady}: ${zh.handoffFalse}`)
    expect(screen.getByText('take-1')).toBeTruthy()
    expect(screen.getByText(zh.handoffAudioUnbound)).toBeTruthy()
    expect(screen.getByText(zh.handoffBlockerOtioUnavailable)).toBeTruthy()
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
})
