// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceVideoRuns } from '../src/client/ReferenceVideoRuns.tsx'
import { quoteResponse, runResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import type { QueueReferenceVideoRequest, ReferenceVideoQuoteResponse, ReferenceVideoRun } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
const scope = { projectId: 'p', frameId: 'f' }
const key = 'qingmu.reference-submit:p:f'
const quote = quoteResponse as unknown as ReferenceVideoQuoteResponse
function ports(items: ReferenceVideoRun[] = []) {
  return {
    referenceVideoRuns: vi.fn(async () => ({ schema: 'jason.reference-video-runs.v1' as const, ...scope, items, providerCalls: 0 as const })),
    queueReferenceVideo: vi.fn(async (command: QueueReferenceVideoRequest) => ({ ...runResponse, runId: `refvideo_${command.requestId}` })),
  }
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks() })
it('keeps generation paused after an unreadable local receipt even when status refresh succeeds', async () => {
  sessionStorage.setItem(key, '{invalid')
  const port = ports()
  render(<ReferenceVideoRuns {...scope} port={port} quote={quote} />)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '刷新任务状态' }))
  await waitFor(() => expect(port.referenceVideoRuns).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' }).hasAttribute('disabled')).toBe(true)
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})
it('requires a quote, then confirms exactly its cost and version once despite repeated clicks', async () => {
  const port = ports()
  const view = render(<ReferenceVideoRuns {...scope} port={port} />)
  await waitFor(() => expect(port.referenceVideoRuns).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: '生成 1 个视频' }).hasAttribute('disabled')).toBe(true)
  view.rerender(<ReferenceVideoRuns {...scope} port={port} quote={quote} />)
  const button = screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' })
  fireEvent.click(button); fireEvent.click(button)
  await screen.findByText('已登记这次生成，可刷新查看进度。')
  expect(port.queueReferenceVideo).toHaveBeenCalledOnce()
  expect(port.queueReferenceVideo.mock.calls[0]?.[0]).toMatchObject({ ...scope, paidConfirmed: true,
    quoteSha256: quote.quoteSha256, expectedRevision: quote.draftRevision,
    authorizationCapCny: quote.cost.estimatedCny })
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' }).hasAttribute('disabled')).toBe(true)
})
it('retains an uncertain command across remount and explicitly replays the same id and quote', async () => {
  const port = ports(); port.queueReferenceVideo.mockRejectedValueOnce(new Error('lost response'))
  const view = render(<ReferenceVideoRuns {...scope} port={port} quote={quote} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' }))
  await screen.findByText('提交结果尚未确认。先刷新状态；再次确认会使用同一个请求编号。')
  const original = port.queueReferenceVideo.mock.calls[0]?.[0]
  view.unmount(); render(<ReferenceVideoRuns {...scope} port={port} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '确认上次提交 · 上限 ¥4.80' }).hasAttribute('disabled')).toBe(false))
  expect(port.queueReferenceVideo).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '确认上次提交 · 上限 ¥4.80' }))
  await screen.findByText('已登记这次生成，可刷新查看进度。')
  expect(port.queueReferenceVideo.mock.calls[1]?.[0]).toEqual(original)
})
it('finds a previously acknowledged run on reload and never repeats its POST', async () => {
  const command = { ...scope, requestId: 'fixture-run-00000001', expectedRevision: 1, paidConfirmed: true,
    expectedRequestSha256: 'a'.repeat(64), quoteSha256: runResponse.quoteSha256, authorizationCapCny: runResponse.authorizationCapCny }
  sessionStorage.setItem(key, JSON.stringify(command))
  const port = ports([runResponse])
  render(<ReferenceVideoRuns {...scope} port={port} quote={quote} />)
  await screen.findByText('草稿版本 1 · 等待生成')
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})
it('plays returned candidates without adoption and blocks new requests while a result is unknown', async () => {
  const completed: ReferenceVideoRun = { ...runResponse, kernelStatus: 'Succeeded', publicStatus: 'succeeded',
    candidates: [{ assetId: 'asset_video', assetSha256: 'c'.repeat(64), mediaId: 'media_video', browserUrl: '/fixture.mp4', reviewStatus: 'pending' }] }
  const port = ports([completed])
  render(<ReferenceVideoRuns {...scope} port={port} quote={quote} />)
  expect(await screen.findByLabelText('草稿版本 1 候选视频')).toHaveProperty('tagName', 'VIDEO')
  expect(screen.queryByRole('button', { name: /采用/ })).toBeNull()
  port.referenceVideoRuns.mockResolvedValue({ schema: 'jason.reference-video-runs.v1', ...scope,
    items: [{ ...runResponse, kernelStatus: 'Failed', publicStatus: 'quarantined', errorCode: 'submission_state_unknown' }], providerCalls: 0 })
  fireEvent.click(screen.getByRole('button', { name: '刷新任务状态' }))
  await screen.findByText('草稿版本 1 · 提交结果待核实')
  expect(screen.getByRole('button', { name: '生成 1 个视频 · 上限 ¥4.80' }).hasAttribute('disabled')).toBe(true)
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})
