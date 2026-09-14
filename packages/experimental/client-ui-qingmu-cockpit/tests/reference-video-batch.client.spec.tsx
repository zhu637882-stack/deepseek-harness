// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceVideoBatch } from '../src/client/ReferenceVideoBatch.tsx'
import type { BatchPort } from '../src/client/reference-video-batch.ts'
import { request, quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
afterEach(() => { cleanup(); sessionStorage.clear() })

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
