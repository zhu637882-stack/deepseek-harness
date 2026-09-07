// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  FirstFrameCandidatePreview,
  decodeCandidate,
  type FirstFrameCandidatePreviewRequest,
  type FirstFrameCandidatePreviewResponse,
} from '../src/client/FirstFrameCandidatePreview.tsx'

const bytes = Buffer.from('first-frame-candidate')
const sha = createHash('sha256').update(bytes).digest('hex')
const request: FirstFrameCandidatePreviewRequest = {
  projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'storyboard-1', frameId: 'frame-1', assetId: 'asset-1', expectedMaterializedSha256: sha,
}
const response: FirstFrameCandidatePreviewResponse = {
  projectId: request.projectId, episodeId: request.episodeId,
  storyboardRevisionId: request.storyboardRevisionId, frameId: request.frameId, assetId: request.assetId,
  materializedSha256: sha, mimeType: 'image/png', base64: bytes.toString('base64'),
}
const labels = { load: '查看首帧候选', loading: '正在验证候选', error: '首帧候选已变化，未显示', ariaLabel: '首帧候选 asset-1' }
const createUrl = vi.fn(() => 'blob:first-frame')
const revokeUrl = vi.fn()

it('decodes a real-sized 4 MiB image without overflowing the regexp stack', () => {
  const large = Buffer.alloc(4 * 1024 * 1024, 37)
  expect(decodeCandidate({ ...response, base64: large.toString('base64') }).length).toBe(large.length)
})

it.each(['', 'AA=A', 'AAAA=', 'A===', 'AAAA\n', '!!!!'])('rejects malformed base64 %j', (base64) => {
  expect(() => decodeCandidate({ ...response, base64 })).toThrow()
})

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('loads only on an explicit click, verifies exact scope and bytes, and releases the blob', async () => {
  const load = vi.fn(async () => response)
  const view = render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} />)
  expect(load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: labels.load }))
  await waitFor(() => { expect(screen.getByRole('img', { name: labels.ariaLabel }).getAttribute('src')).toBe('blob:first-frame') })
  expect(load).toHaveBeenCalledWith(request, expect.any(AbortSignal))
  view.unmount()
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:first-frame')
})

it('can display an existing image automatically with the same byte checks and no repeat read on rerender', async () => {
  const load = vi.fn(async () => response)
  const view = render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} autoLoad />)
  await screen.findByRole('img', { name: labels.ariaLabel })
  view.rerender(<FirstFrameCandidatePreview request={{ ...request }} load={load} labels={labels} autoLoad />)
  expect(load).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:first-frame')
})

it('does not auto-retry or display an image whose bytes fail validation', async () => {
  const load = vi.fn(async () => ({ ...response, base64: Buffer.from('wrong').toString('base64') }))
  const view = render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} autoLoad />)
  await screen.findByRole('alert')
  view.rerender(<FirstFrameCandidatePreview request={{ ...request }} load={load} labels={labels} autoLoad />)
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('img')).toBeNull()
})

it('renders a verified thumbnail without a nested button and releases its bytes on unmount', async () => {
  const load = vi.fn(async () => response)
  const view = render(<button type="button">镜头<FirstFrameCandidatePreview request={request} load={load} labels={labels} autoLoad thumbnailClassName="shot-thumb" /></button>)
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect((await screen.findByRole('img')).className).toBe('shot-thumb')
  view.unmount()
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:first-frame')
})

it('does not display or retry a thumbnail whose bytes drifted', async () => {
  const load = vi.fn(async () => ({ ...response, base64: Buffer.from('drift').toString('base64') }))
  const view = render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} autoLoad thumbnailClassName="shot-thumb" />)
  await screen.findByText('缩略图未载入')
  view.rerender(<FirstFrameCandidatePreview request={{ ...request }} load={load} labels={labels} autoLoad thumbnailClassName="shot-thumb" />)
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('img')).toBeNull()
  expect(createUrl).not.toHaveBeenCalled()
})

it.each([
  ['wrong scope', { ...response, assetId: 'asset-other' }],
  ['stale sha', { ...response, materializedSha256: '0'.repeat(64) }],
  ['wrong bytes', { ...response, base64: Buffer.from('drift').toString('base64') }],
  ['wrong mime', { ...response, mimeType: 'video/mp4' as 'image/png' }],
])('does not display a %s response', async (_name, invalid) => {
  const load = vi.fn(async () => invalid)
  render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} />)
  fireEvent.click(screen.getByRole('button', { name: labels.load }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('img')).toBeNull()
  expect(createUrl).not.toHaveBeenCalled()
})

it('does not issue a second media request while an earlier response is unresolved', () => {
  let resolve!: (value: FirstFrameCandidatePreviewResponse) => void
  const load = vi.fn(() => new Promise<FirstFrameCandidatePreviewResponse>((done) => { resolve = done }))
  render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} />)
  fireEvent.click(screen.getByRole('button', { name: labels.load }))
  fireEvent.click(screen.getByRole('button', { name: labels.loading }))
  expect(load).toHaveBeenCalledTimes(1)
  resolve(response)
})

it('aborts, clears, and revokes a prior candidate when its content-addressed request changes', async () => {
  const load = vi.fn(async (current: FirstFrameCandidatePreviewRequest) => ({
    ...response,
    assetId: current.assetId,
    materializedSha256: current.expectedMaterializedSha256,
    base64: current.expectedMaterializedSha256 === sha ? bytes.toString('base64') : Buffer.from('drift').toString('base64'),
  }))
  const view = render(<FirstFrameCandidatePreview request={request} load={load} labels={labels} />)
  fireEvent.click(screen.getByRole('button', { name: labels.load }))
  await screen.findByRole('img')

  const nextRequest = { ...request, assetId: 'asset-2', expectedMaterializedSha256: '1'.repeat(64) }
  view.rerender(<FirstFrameCandidatePreview request={nextRequest} load={load} labels={{ ...labels, ariaLabel: '首帧候选 asset-2' }} />)

  await waitFor(() => { expect(screen.queryByRole('img')).toBeNull() })
  expect(revokeUrl).toHaveBeenCalledWith('blob:first-frame')
  expect(screen.getByRole('button', { name: labels.load })).toBeTruthy()
})
