// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceVideoBatch } from '../src/client/ReferenceVideoBatch.tsx'
import type { BatchPort } from '../src/client/reference-video-batch.ts'
import { request, quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear() })

it('sends completed shots as continuity context without preparing or generating them', async () => {
  const save = vi.fn()
  const queue = vi.fn()
  const port = {
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => ({ draft: null,
      directorSource: { sha256: 'a'.repeat(64), generationPrompt: frameId === 'f'
        ? 'The host stays in the courtyard; the visitor is outside the south gate.'
        : 'The visitor enters from the street; the courtyard is behind the camera.' } }),
    referenceVideoRuns: async ({ frameId }: { frameId: string }) => ({ items: frameId === 'f'
      ? [{ publicStatus: 'succeeded', candidates: [] }] : [] }),
    saveReferenceVideoDraft: save, queueReferenceVideo: queue,
  } as unknown as BatchPort
  const send = vi.fn(async (_id: string, _prompt: string) => {})
  const storyPort = { prepare: vi.fn(async () => {}), send,
    read: vi.fn(async () => ({ lastSeq: 0, running: false, finished: false, text: '', script: '', error: '' })) }
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port} storyPort={storyPort}
    onOpenShot={vi.fn()} relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({
      shotId, frameNo: i + 1, durationSec: 8,
    })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  fireEvent.click(screen.getByRole('button', { name: '读取整集准备情况' }))
  fireEvent.click(await screen.findByRole('button', { name: '自动准备整集镜头' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const prompt = send.mock.calls[0]![1]
  const source = JSON.parse(prompt.split('当前来源：')[1]!.split('\n操作者补充：')[0]!)
  expect(source.shots).toEqual([
    expect.objectContaining({ frameId: 'f', needsPreparation: false,
      source: expect.objectContaining({ generationPrompt: expect.stringContaining('outside the south gate') }) }),
    expect.objectContaining({ frameId: 'f2', needsPreparation: true }),
  ])
  expect(save).not.toHaveBeenCalled()
  expect(queue).not.toHaveBeenCalled()
  expect(prompt).toMatchSnapshot('batch request with completed-shot context')
})

it('refreshes review after collecting candidates while retaining per-shot failures', async () => {
  const registered: string[] = []
  const onCollected = vi.fn(async () => { expect(registered).toEqual(['f']) })
  const port = {
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async ({ frameId }: { frameId: string }) => ({ items: [{
      runId: frameId, publicStatus: 'succeeded', candidates: [{ assetId: frameId, assetSha256: 'a'.repeat(64) }],
    }] }),
    readReferenceVideoCandidateRegistration: async () => ({ takeId: null }),
    registerReferenceVideoCandidateForReview: async ({ frameId }: { frameId: string }) => {
      if (frameId === 'f2') throw new Error('candidate unavailable')
      registered.push(frameId)
      return { takeId: 'take-f' }
    },
  } as unknown as BatchPort
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port}
    onOpenShot={vi.fn()} onCollected={onCollected}
    relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({ shotId, frameNo: i + 1, durationSec: 8 })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  fireEvent.click(screen.getByRole('button', { name: '读取整集准备情况' }))
  fireEvent.click(await screen.findByRole('button', { name: '收取已完成视频到审看' }))
  await waitFor(() => expect(onCollected).toHaveBeenCalledTimes(1))
  expect(screen.getByText('1 条视频已进入本镜候选审看')).toBeTruthy()
  expect(screen.getByText('Error: candidate unavailable')).toBeTruthy()
})

it('offers one action for two prepared shots and shows each queued result', async () => {
  const queue = vi.fn(async ({ frameId }: { frameId: string }) => ({ frameId, publicStatus: 'queued' }))
  const port = {
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => ({ projectId: 'p', frameId, frameSha256: 'f'.repeat(64),
      directorSource: null, draft: { revision: 1, requestSha256: 'd'.repeat(64), request: { ...request, frameId } } }),
    referenceVideoRuns: async () => ({ items: [] }),
    readReferenceVideoMaterials: async () => ({ configured: true, allReady: true, materials: [] }),
    referenceVideoQuote: async ({ frameId }: { frameId: string }) => ({ ...quoteResponse, frameId, generationSubmissionEnabled: true }),
    queueReferenceVideo: queue,
  } as unknown as BatchPort
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port} onOpenShot={vi.fn()}
    relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({ shotId, frameNo: i + 1, title: '门口', durationSec: 8 })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  fireEvent.click(screen.getByRole('button', { name: '读取整集准备情况' }))
  await screen.findByRole('button', { name: '准备已有镜头草稿' })
  fireEvent.click(screen.getByRole('button', { name: '准备已有镜头草稿' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' }).hasAttribute('disabled')).toBe(false))
  expect(queue).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' }))
  await waitFor(() => expect(queue).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getAllByText(/已进入生成队列/)).toHaveLength(2))
  expect(queue.mock.calls.map(call => call[0].frameId)).toEqual(['f', 'f2'])
  expect(screen.getByLabelText('整集批量生成').textContent).toMatchSnapshot()
})
