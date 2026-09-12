// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceVideoPlayer } from '../src/client/ReferenceVideoPlayer.tsx'
import { runResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import type { ReferenceVideoFrameReceipt } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

const candidate = { assetId: 'asset_video', assetSha256: 'a'.repeat(64), browserUrl: '/video.mp4', mediaId: 'media_video', reviewStatus: 'pending' }
const run = { ...runResponse, publicStatus: 'succeeded', kernelStatus: 'Succeeded', candidates: [candidate] }
const receipt: ReferenceVideoFrameReceipt = { schema: 'qingmu.reference-video-frame.v1', projectId: 'p', episodeId: 'e', frameId: 'f', runId: run.runId,
  assetId: candidate.assetId, assetSha256: candidate.assetSha256, requestedTimestampMs: 1234,
  image: { assetId: `asset_vframe_${'b'.repeat(32)}`, assetSha256: 'c'.repeat(64), width: 1920, height: 1080, actualTimestampMs: 1266.667 },
  providerCalls: 0, selectionChanged: false }
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })
it('captures the visible playback position and recovers after remount without a second write', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const port = { captureReferenceVideoFrame: vi.fn(async () => { throw new Error('lost response') }), readReferenceVideoFrame: vi.fn(async () => receipt) }
  const onReferenceSaved = vi.fn()
  const props = { projectId: 'p', frameId: 'f', candidate, run, port, onReferenceSaved }
  const view = render(<ReferenceVideoPlayer {...props} />)
  const player = screen.getByLabelText('草稿版本 1 候选视频')
  Object.defineProperties(player, { currentTime: { configurable: true, value: 1.234 }, duration: { configurable: true, value: 6 } })
  fireEvent.loadedMetadata(player)
  fireEvent.click(screen.getByRole('button', { name: '将当前位置画面存为参考' }))
  await screen.findByText(/暂未确认保存结果/)
  expect(port.captureReferenceVideoFrame.mock.calls[0]?.[0]).toEqual({ projectId: 'p', frameId: 'f', runId: run.runId,
    assetId: candidate.assetId, expectedAssetSha256: candidate.assetSha256, timestampMs: 1234 })
  view.unmount(); render(<ReferenceVideoPlayer {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取上次画面保存结果' }))
  await screen.findByText(/1.267 秒画面存入项目素材/)
  expect(port.captureReferenceVideoFrame).toHaveBeenCalledOnce()
  expect(onReferenceSaved).toHaveBeenCalledOnce()
})
it('clears a failed position explicitly without deleting or automatically capturing another frame', async () => {
  const key = `qingmu:video-frame:${JSON.stringify(['p', 'f', run.runId, candidate.assetId, candidate.assetSha256])}`
  sessionStorage.setItem(key, '7000')
  const port = { captureReferenceVideoFrame: vi.fn(), readReferenceVideoFrame: vi.fn() }
  render(<ReferenceVideoPlayer projectId="p" frameId="f" run={run} candidate={candidate} port={port} />)
  fireEvent.click(await screen.findByRole('button', { name: '重新定位画面' }))
  await waitFor(() => { expect(sessionStorage.getItem(key)).toBeNull() })
  expect(port.captureReferenceVideoFrame).not.toHaveBeenCalled()
})
