// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BatchVideoReview } from '../src/client/BatchVideoReview.tsx'
import type { BatchBasis, BatchPort } from '../src/client/reference-video-batch.ts'
const basis = { projectId: 'p', shots: ['f', 'f2', 'f3'].map(frameId => ({ frameId, label: frameId,
  runs: [{ runId: `run-${frameId}`, publicStatus: 'succeeded', candidates: [{ assetId: frameId, assetSha256: 'a'.repeat(64) }] }] })) } as unknown as BatchBasis

const port = { readReferenceVideoCandidateRegistration: vi.fn(async ({ assetId }: { assetId: string }) => ({ takeId: `take-${assetId}` })) } as unknown as BatchPort

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('checks only missing reports, keeps per-shot failures, and resumes using server records', async () => {
  const records = new Map([['f', 'complete'], ['f2', 'pending'], ['f3', 'none']])
  let unavailable = true
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const id = new URL(url, 'http://localhost').searchParams.get('assetId')!.replace(/^take-/u, '')
    if (init.method === 'POST') { records.set(id, 'pending'); if (unavailable) { unavailable = false; throw new Error('lost response') } }
    return Response.json({ assetId: `take-${id}`, assetSha256: 'a'.repeat(64), state: records.get(id) })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<BatchVideoReview episodeId="e" basis={basis} port={port} onOpenShot={vi.fn()} />)
  await screen.findByText('没有可用证据，需人工核对')
  expect(fetcher.mock.calls.every(call => call[1].method === 'GET')).toBe(true)
  expect(fetcher.mock.calls.every(call => new URL(call[0], 'http://localhost').searchParams.get('assetId')?.startsWith('take-'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '集中检查已返回视频' }))
  await waitFor(() => { expect(fetcher.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(1) })
  await waitFor(() => { expect(screen.getByRole('button', { name: '集中检查已返回视频' })).toHaveProperty('disabled', false) })
  view.unmount()
  render(<BatchVideoReview episodeId="e" basis={basis} port={port} onOpenShot={vi.fn()} />)
  await screen.findByText('没有可用证据，需人工核对')
  fireEvent.click(screen.getByRole('button', { name: '集中检查已返回视频' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '集中检查已返回视频' })).toHaveProperty('disabled', false) })
  expect(fetcher.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(1)
})

it('never submits on a mismatched candidate response and distinguishes partial evidence', async () => {
  const fetcher = vi.fn(async (url: string, _init: RequestInit) => {
    const id = new URL(url, 'http://localhost').searchParams.get('assetId')!.replace(/^take-/u, '')
    return Response.json({ assetId: id === 'f' ? 'wrong' : `take-${id}`, assetSha256: 'a'.repeat(64), state: 'complete',
      visualEvidence: { checks: { continuity_match: { status: 'fail', evidence: '人物站位跳变' } }, observations: [] } })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<BatchVideoReview episodeId="e" basis={basis} port={port} onOpenShot={vi.fn()} />)
  await screen.findByText(/审片结果与当前候选不一致/)
  expect(screen.getAllByText('1 项需调整 · 14 项待核实')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '集中检查已返回视频' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '集中检查已返回视频' })).toHaveProperty('disabled', false) })
  expect(fetcher.mock.calls.every(call => call[1].method === 'GET')).toBe(true)
  expect(fetcher.mock.calls.every(call => new URL(call[0], 'http://localhost').searchParams.get('assetId')?.startsWith('take-'))).toBe(true)
})
