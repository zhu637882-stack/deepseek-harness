// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  QingmuYimengReadPort, YimengSelectedVideoReviewResponse, YimengSelectedVideoReviewStatus,
} from '../src/client/contracts.ts'
import { normalizeSelectedVideoReview } from '../../qingmu-yimeng-read-adapter/src/selected-video-review.ts'
import { videoCandidatesFixture } from '../../qingmu-yimeng-read-adapter/tests/selected-video-review-fixture.ts'
import { SelectedVideoReviewView } from '../src/client/SelectedVideoReviewView.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { continuitySource } from './fixtures/continuity-method.client.ts'

const t = (key: QingmuCockpitKey) => zh[key]
type ReadPort = Pick<QingmuYimengReadPort, 'selectedVideoReview'>
function props(port: ReadPort, projection = continuitySource(), selectedShotId = 'frame-a') {
  return { port, projectId: projection.projectId, episodeId: projection.episodeId, selectedShotId, projection, enabled: true, t }
}
function request(source = continuitySource(), frameId = 'frame-a') {
  return { projectId: source.projectId, episodeId: source.episodeId, frameId }
}
function response(source = continuitySource(), frameId = 'frame-a', status: YimengSelectedVideoReviewStatus = 'rejected', reviewPatch?: Record<string, unknown>) {
  const ids = request(source, frameId)
  const upstream = videoCandidatesFixture(ids, status)
  if (reviewPatch === undefined) return normalizeSelectedVideoReview(upstream, ids)
  const selected = upstream.items[0]
  if (selected === undefined || selected.formalReview === null) throw new Error('fixture review missing')
  return normalizeSelectedVideoReview({
    ...upstream, items: [{ ...selected, formalReview: { ...selected.formalReview, ...reviewPatch } }],
  }, ids)
}
function replaceSelected(result: YimengSelectedVideoReviewResponse, patch: Record<string, unknown>) {
  if (result.selected === null) throw new Error('fixture selected asset missing')
  return { ...result, selected: { ...result.selected, ...patch } }
}
function replaceReview(result: YimengSelectedVideoReviewResponse, patch: Record<string, unknown>) {
  if (result.selected === null || result.selected.formalReview === null) throw new Error('fixture review missing')
  return replaceSelected(result, { formalReview: { ...result.selected.formalReview, ...patch } })
}
function pending<T>() {
  let accept: (value: T) => void = () => { throw new Error('promise not initialized') }
  let fail: (reason: Error) => void = () => { throw new Error('promise not initialized') }
  const promise = new Promise<T>((resolve, reject) => { accept = resolve; fail = reject })
  return { promise, resolve: (value: T) => { accept(value) }, reject: (reason: Error) => { fail(reason) } }
}

const mismatches: readonly (readonly [string, (result: YimengSelectedVideoReviewResponse) => unknown])[] = [
  ['schema', result => ({ ...result, schema: 'unknown-review.v1' })],
  ['project ID', result => ({ ...result, projectId: 'other-project' })],
  ['episode ID', result => ({ ...result, episodeId: 'other-episode' })],
  ['frame ID', result => ({ ...result, frameId: 'frame-z' })],
  ['selected asset ID', result => ({ ...result, selectedAssetId: 'other-video' })],
  ['missing selected asset with nonempty ID', result => ({ ...result, selected: null })],
  ['unselected asset', result => replaceSelected(result, { isSelected: false })],
  ['selection status', result => replaceSelected(result, { selectionStatus: 'Candidate' })],
  ['unknown review status', result => replaceSelected(result, { formalReviewStatus: 'approved' })],
  ['contradictory acceptance', result => replaceSelected(result, { formalReviewAccepted: true })],
  ['malformed asset SHA', result => replaceSelected(result, { sha256: 'not-a-sha' })],
  ['different asset SHA', result => replaceSelected(result, { sha256: 'c'.repeat(64) })],
  ['review project ID', result => replaceReview(result, { projectId: 'other-project' })],
  ['review episode ID', result => replaceReview(result, { episodeId: 'other-episode' })],
  ['review frame ID', result => replaceReview(result, { frameId: 'frame-z' })],
  ['review asset ID', result => replaceReview(result, { formalVideoAssetId: 'other-video' })],
  ['review SHA', result => replaceReview(result, { assetSha256: 'c'.repeat(64) })],
  ['review version', result => replaceReview(result, { version: 'unknown-review.v1' })],
  ['review scope', result => replaceReview(result, { reviewScope: 'first_frame' })],
  ['review decision', result => replaceReview(result, { decision: 'accepted' })],
  ['wrong revision domain', result => replaceReview(result, { storyboardRevision: 4 })],
  ['missing revision', result => replaceReview(result, { storyboardRevision: undefined })],
  ['missing review', result => replaceSelected(result, { formalReview: null })],
  ['stale with a retained review', result => replaceSelected(result, { formalReviewStatus: 'stale' })],
  ['read-only boundary', result => ({ ...result, readOnly: false })],
  ['provider boundary', result => ({ ...result, providerCalls: 1 })],
  ['task boundary', result => ({ ...result, taskMutation: true })],
  ['budget boundary', result => ({ ...result, budgetMutation: true })],
  ['human-signoff boundary', result => ({ ...result, humanSignoffInferred: true })],
]

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('selected video review view', () => {
  it.each(['no-source', 'no-shot', 'unknown-shot', 'disabled', 'project-mismatch', 'episode-mismatch'] as const)(
    'does not request or claim loading for %s', (kind) => {
      const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>() }
      const source = continuitySource()
      render(<SelectedVideoReviewView {...props(port, source)} projection={kind === 'no-source' ? undefined : source}
        selectedShotId={kind === 'no-shot' ? '' : kind === 'unknown-shot' ? 'unknown-shot' : 'frame-a'} enabled={kind !== 'disabled'}
        projectId={kind === 'project-mismatch' ? 'other-project' : source.projectId}
        episodeId={kind === 'episode-mismatch' ? 'other-episode' : source.episodeId} />)
      expect(port.selectedVideoReview).not.toHaveBeenCalled()
      expect(screen.queryByText(zh.videoReviewLoading)).toBeNull()
      expect(screen.getByRole('button', { name: zh.videoReviewRefresh }).hasAttribute('disabled')).toBe(true)
    },
  )

  it.each([
    ['accepted', 'videoReviewAccepted'], ['rejected', 'videoReviewRejected'], ['pending', 'videoReviewPending'],
    ['stale', 'videoReviewStale'], ['invalid', 'videoReviewUnavailable'],
  ] as const)('shows the existing %s record without granting new authority', async (status, label) => {
    const source = continuitySource()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(response(source, 'frame-a', status)) }
    render(<SelectedVideoReviewView {...props(port, source)} />)
    const statusLabel = await screen.findByText(zh[label])
    expect(statusLabel.closest('[data-review-status]')?.getAttribute('data-review-status')).toBe(status)
    expect(port.selectedVideoReview).toHaveBeenCalledExactlyOnceWith(request(source), expect.any(AbortSignal))
    expect(screen.getByText('video-frame-a')).toBeTruthy()
    expect(screen.getByText(zh.videoReviewAuthorityBoundary)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    if (status === 'pending' || status === 'stale' || status === 'invalid') {
      expect(screen.queryByRole('list', { name: zh.videoReviewDefects })).toBeNull()
      expect(screen.queryByText('reviewer-fixture')).toBeNull()
      expect(screen.queryByText(zh.videoReviewNoDefects)).toBeNull()
    }
    if (status === 'stale') expect(screen.getByText(zh.videoReviewStaleHelp)).toBeTruthy()
    if (status === 'invalid') expect(screen.getByText(zh.videoReviewInvalidHelp)).toBeTruthy()
  })

  it('does not substitute an accepted unselected candidate when no video is selected', async () => {
    const source = continuitySource()
    const ids = request(source)
    const upstream = videoCandidatesFixture(ids, 'accepted')
    const result = normalizeSelectedVideoReview({
      ...upstream, selectedAssetId: null, items: upstream.items.map(item => ({ ...item, isSelected: false })),
    }, ids)
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(result) }
    render(<SelectedVideoReviewView {...props(port, source)} />)
    expect(await screen.findByText(zh.videoReviewNoSelected)).toBeTruthy()
    expect(screen.queryByText(zh.videoReviewAccepted)).toBeNull()
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('preserves zero, fractional and absent timecodes, original notes and bindings without media or write controls', async () => {
    const source = continuitySource()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected media request'))
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(response(source)) }
    const { container } = render(<SelectedVideoReviewView {...props(port, source)} />)
    const defects = await screen.findByRole('list', { name: zh.videoReviewDefects })
    expect(within(defects).getAllByRole('listitem')).toHaveLength(3)
    for (const [timecode, note] of [
      ['0 s', '开场怀表位置与上一镜不符。'], ['1.25 s', '怀表在动作中消失。'],
      [zh.videoReviewNoTimecode, '动作需要人工复查，未提供具体时间点。'],
    ] as const) {
      const item = within(defects).getByText(note).closest('li')
      if (item === null) throw new Error('defect list item missing')
      expect(within(item).getByText(timecode)).toBeTruthy()
    }
    expect(screen.getByText('保留人物动作，复查怀表位置。')).toBeTruthy()
    expect(screen.getByText(zh.videoReviewDefectsBoundary)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.videoReviewEvidence))
    expect(screen.getByText('a'.repeat(64))).toBeTruthy()
    expect(screen.getByText('b'.repeat(64))).toBeTruthy()
    expect(screen.getByText('task-frame-a')).toBeTruthy()
    expect(screen.getByText('provider-task-fixture')).toBeTruthy()
    expect(screen.getByText('reviewer-fixture')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText(zh.videoReviewBindingBoundary)).toBeTruthy()
    expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: zh.videoReviewRefresh })])
    expect(container.querySelector('video, audio, img, iframe, source, form, input, textarea, a[href]')).toBeNull()
    expect(container.textContent).not.toContain('media.invalid')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([null, []] as const)('distinguishes absent defects from an explicitly empty list (%j)', async (defects) => {
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(response(continuitySource(), 'frame-a', 'rejected', { defects })) }
    render(<SelectedVideoReviewView {...props(port)} />)
    expect(await screen.findByText(defects === null ? zh.videoReviewMissingDefects : zh.videoReviewNoDefects)).toBeTruthy()
    expect(screen.queryByText(defects === null ? zh.videoReviewNoDefects : zh.videoReviewMissingDefects)).toBeNull()
    expect(screen.queryByRole('list', { name: zh.videoReviewDefects })).toBeNull()
    expect(screen.getByText(zh.videoReviewRejected)).toBeTruthy()
  })

  it('labels a recorded machine exception and legacy time binding without inferring an approval session', async () => {
    const result = response(continuitySource(), 'frame-a', 'accepted', {
      machineFailureExceptionAccepted: true, reasonCode: 'formal_video_machine_failure_exception', frameContentSha256: null,
    })
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(result) }
    render(<SelectedVideoReviewView {...props(port)} />)
    expect(await screen.findByText(zh.videoReviewMachineException)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.videoReviewEvidence))
    expect(screen.getByText(zh.videoReviewLegacyBinding)).toBeTruthy()
    expect(screen.getByText(zh.videoReviewAuthorityBoundary)).toBeTruthy()
  })

  it.each(mismatches)('rejects %s instead of displaying the foreign or unsafe review', async (_label, corrupt) => {
    // Deliberately bypass the typed Host normalizer to exercise the browser's RPC boundary.
    const result = corrupt(response()) as YimengSelectedVideoReviewResponse
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(result) }
    render(<SelectedVideoReviewView {...props(port)} />)
    expect((await screen.findByRole('alert')).textContent).toContain(zh.videoReviewInvalid)
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.queryByText(zh.videoReviewRejected)).toBeNull()
    expect(screen.queryByRole('list', { name: zh.videoReviewDefects })).toBeNull()
  })

  it('aborts a superseded Shot request and ignores a late response from a transport that ignores abort', async () => {
    const source = continuitySource()
    const first = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>()
      .mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(source, 'frame-z', 'accepted')) }
    const view = render(<SelectedVideoReviewView {...props(port, source)} />)
    view.rerender(<SelectedVideoReviewView {...props(port, source, 'frame-z')} />)
    expect(await screen.findByText('video-frame-z')).toBeTruthy()
    expect(port.selectedVideoReview.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(port.selectedVideoReview).toHaveBeenLastCalledWith(request(source, 'frame-z'), expect.any(AbortSignal))
    await act(async () => { first.resolve(response(source)) })
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.getByText(zh.videoReviewAccepted)).toBeTruthy()
    expect(screen.queryByText(zh.videoReviewRejected)).toBeNull()
  })

  it('clears old facts and reloads for a new projection object with the same fingerprint', async () => {
    const source = continuitySource()
    const nextSource = { ...source }
    const next = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>()
      .mockResolvedValueOnce(response(source)).mockReturnValueOnce(next.promise) }
    const view = render(<SelectedVideoReviewView {...props(port, source)} />)
    expect(await screen.findByText(zh.videoReviewRejected)).toBeTruthy()
    expect(nextSource.inputFingerprint).toBe(source.inputFingerprint)
    view.rerender(<SelectedVideoReviewView {...props(port, nextSource)} />)
    expect(port.selectedVideoReview).toHaveBeenCalledTimes(2)
    expect(port.selectedVideoReview.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.getByText(zh.videoReviewLoading)).toBeTruthy()
    await act(async () => { next.resolve(response(nextSource, 'frame-a', 'accepted')) })
    expect(screen.getByText(zh.videoReviewAccepted)).toBeTruthy()
  })

  it.each(['projection', 'port'] as const)('cancels an in-flight %s identity and ignores its late rejection', async (kind) => {
    const source = continuitySource()
    const first = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>()
      .mockReturnValueOnce(first.promise).mockResolvedValue(response(source, 'frame-a', 'accepted')) }
    const replacement = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockResolvedValue(response(source, 'frame-a', 'accepted')) }
    const view = render(<SelectedVideoReviewView {...props(port, source)} />)
    view.rerender(<SelectedVideoReviewView {...props(kind === 'port' ? replacement : port, kind === 'projection' ? { ...source } : source)} />)
    expect(await screen.findByText(zh.videoReviewAccepted)).toBeTruthy()
    expect(port.selectedVideoReview.mock.calls[0]?.[1]?.aborted).toBe(true)
    await act(async () => { first.reject(new Error('obsolete transport error')) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(zh.videoReviewAccepted)).toBeTruthy()
  })

  it('offers one read-only refresh, clears old facts, and prevents duplicate in-flight refreshes', async () => {
    const source = continuitySource()
    const next = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>()
      .mockResolvedValueOnce(response(source)).mockReturnValueOnce(next.promise) }
    render(<SelectedVideoReviewView {...props(port, source)} />)
    expect(await screen.findByText(zh.videoReviewRejected)).toBeTruthy()
    const refresh = screen.getByRole('button', { name: zh.videoReviewRefresh })
    expect(screen.getAllByRole('button')).toEqual([refresh])
    fireEvent.click(refresh)
    expect(port.selectedVideoReview).toHaveBeenCalledTimes(2)
    expect(port.selectedVideoReview.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(refresh.hasAttribute('disabled')).toBe(true)
    fireEvent.click(refresh)
    expect(port.selectedVideoReview).toHaveBeenCalledTimes(2)
    await act(async () => { next.resolve(response(source, 'frame-a', 'accepted')) })
    expect(screen.getByText(zh.videoReviewAccepted)).toBeTruthy()
    expect(refresh.hasAttribute('disabled')).toBe(false)
  })

  it('disabling clears facts, aborts a refresh, and does not show a late response or false loading', async () => {
    const source = continuitySource()
    const next = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>()
      .mockResolvedValueOnce(response(source)).mockReturnValueOnce(next.promise) }
    const view = render(<SelectedVideoReviewView {...props(port, source)} />)
    expect(await screen.findByText(zh.videoReviewRejected)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.videoReviewRefresh }))
    view.rerender(<SelectedVideoReviewView {...props(port, source)} enabled={false} />)
    expect(port.selectedVideoReview.mock.calls[1]?.[1]?.aborted).toBe(true)
    await act(async () => { next.resolve(response(source, 'frame-a', 'accepted')) })
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.queryByText(zh.videoReviewLoading)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: zh.videoReviewRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it.each(['resolve', 'reject'] as const)('aborts on unmount and ignores late %s', async (outcome) => {
    const first = pending<YimengSelectedVideoReviewResponse>()
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockReturnValue(first.promise) }
    const view = render(<SelectedVideoReviewView {...props(port)} />)
    view.unmount()
    expect(port.selectedVideoReview.mock.calls[0]?.[1]?.aborted).toBe(true)
    await act(async () => {
      if (outcome === 'resolve') first.resolve(response())
      else first.reject(new Error('unmounted transport error'))
    })
    expect(view.container.innerHTML).toBe('')
  })

  it('shows a current read failure without keeping review facts or claiming completion', async () => {
    const port = { selectedVideoReview: vi.fn<ReadPort['selectedVideoReview']>().mockRejectedValue(new Error('read service unavailable')) }
    render(<SelectedVideoReviewView {...props(port)} />)
    expect((await screen.findByRole('alert')).textContent).toContain('read service unavailable')
    expect(screen.queryByText(zh.videoReviewLoading)).toBeNull()
    expect(screen.queryByText('video-frame-a')).toBeNull()
    expect(screen.getByRole('button', { name: zh.videoReviewRefresh }).hasAttribute('disabled')).toBe(false)
  })
})
