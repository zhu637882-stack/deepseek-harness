// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShootingFirstFrameHistory } from '../src/client/ShootingFirstFrameHistory.tsx'
const api = vi.hoisted(() => ({ history: vi.fn(), state: vi.fn(), historyPreview: vi.fn(), select: vi.fn(), receipt: vi.fn() }))
vi.mock('../src/client/first-frame-selection.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/first-frame-selection.ts')>(), createFirstFrameSelectionClient: () => api }))
import { FirstFrameSelectionUnknownError } from '../src/client/first-frame-selection.ts'
import type { FirstFrameSelectionIntent } from '../src/client/first-frame-selection.ts'
vi.mock('../src/client/FirstFrameCandidatePreview.tsx', () => ({ FirstFrameCandidatePreview: ({ onPreviewReady, thumbnailClassName }: { onPreviewReady: (url: string) => void; thumbnailClassName?: string }) => thumbnailClassName !== undefined ? <img alt="历史首帧缩略图" /> : <button onClick={() => { onPreviewReady('blob:viewed') }}>读取真实候选</button> }))
const scope = { projectId: 'p', episodeId: 'e', storyboardRevisionId: 'r', frameId: 'f' }
const image = { assetId: 'a', materializedSha256: 'a'.repeat(64), qualityStatus: 'passed', selectionStatus: 'Unselected', isSelected: false }
const props = { scope, onCommitted: vi.fn(async () => undefined) }
beforeEach(() => { localStorage.clear(); api.history.mockResolvedValue([image]); api.state.mockResolvedValue({ candidates: [image], selectedAssetId: null, selectionReceipt: null }); api.select.mockRejectedValue(new Error('lost response')) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('browses historical rejected media even when eligibility is blocked, with no mutation', async () => {
  api.history.mockResolvedValue([{ ...image, selectionStatus: 'Rejected' }]); api.state.mockRejectedValue(new Error('not ready'))
  render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  expect(api.select).not.toHaveBeenCalled()
})

it('requires actually viewing the identical bytes before adoption', async () => {
  render(<ShootingFirstFrameHistory {...props} />)
  await screen.findByRole('button', { name: '读取真实候选' })
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '读取真实候选' }))
  expect(await screen.findByRole('button', { name: '认可并采用这张首帧' })).toBeTruthy()
  expect(api.select).not.toHaveBeenCalled()
})

it('offers a read-only retry for unavailable eligibility, never asks for another generation', async () => {
  api.state.mockRejectedValueOnce(new Error('offline'))
  render(<ShootingFirstFrameHistory {...props} />)
  expect((await screen.findByRole('alert')).textContent).toContain('不必因此重新生成')
  fireEvent.click(screen.getByRole('button', { name: '重新检查采用条件' }))
  await waitFor(() => { expect(api.state).toHaveBeenCalledTimes(2) })
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  expect(api.select).not.toHaveBeenCalled()
})

it('does not approve different bytes returned by a later state read', async () => {
  api.state.mockResolvedValue({ candidates: [{ ...image, materializedSha256: 'b'.repeat(64) }] })
  render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
})

it('persists before adoption and a remount or recovery cannot submit again', async () => {
  api.select.mockImplementation(async (intent: FirstFrameSelectionIntent) => { throw new FirstFrameSelectionUnknownError({ idempotencyKey:intent.idempotencyKey,requestSha256:'c'.repeat(64) }) })
  api.receipt.mockRejectedValue(new Error('pending'))
  const view = render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  fireEvent.click(await screen.findByRole('button', { name: '认可并采用这张首帧' }))
  await screen.findByRole('alert')
  expect(api.select).toHaveBeenCalledTimes(1)
  const marker = JSON.parse(localStorage.getItem('qingmu:first-frame-adopt:p:e:r:f')!) as { idempotencyKey: string }
  expect(marker).toBeTruthy()
  view.unmount(); render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  fireEvent.click(screen.getByRole('button', { name: '读取原采用结果' }))
  await waitFor(() => { expect(api.receipt).toHaveBeenCalledTimes(1) })
  expect(api.select).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  api.receipt.mockResolvedValue({ idempotencyKey:marker.idempotencyKey, selectedAssetId:'a', selectedMaterializedSha256:image.materializedSha256 })
  await waitFor(() => { expect(screen.getByRole('button', { name:'读取原采用结果' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '读取原采用结果' }))
  await waitFor(() => { expect(localStorage.getItem('qingmu:first-frame-adopt:p:e:r:f')).toBeNull() })
  expect(api.select).toHaveBeenCalledTimes(1)
})

it('an explicit no-receipt network recovery retains the original intent and idempotency key', async () => {
  const view = render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  fireEvent.click(await screen.findByRole('button', { name: '认可并采用这张首帧' }))
  await screen.findByRole('alert')
  view.unmount(); render(<ShootingFirstFrameHistory {...props} />)
  await screen.findByRole('button', { name: '继续原采用操作' })
  expect(api.select).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '继续原采用操作' }))
  await waitFor(() => { expect(api.select).toHaveBeenCalledTimes(2) })
  expect(api.select.mock.calls[1]).toEqual(api.select.mock.calls[0])
})

it('does not downgrade a confirmed adoption when the following page refresh fails', async () => {
  api.select.mockImplementation(async (intent: FirstFrameSelectionIntent) => {
    api.state.mockRejectedValue(new Error('refresh failed'))
    return { idempotencyKey:intent.idempotencyKey, selectedAssetId:'a', selectedMaterializedSha256:image.materializedSha256 }
  })
  const view = render(<ShootingFirstFrameHistory {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '读取真实候选' }))
  fireEvent.click(await screen.findByRole('button', { name: '认可并采用这张首帧' }))
  expect((await screen.findByRole('alert')).textContent).toContain('采用已保存')
  expect(localStorage.getItem('qingmu:first-frame-adopt:p:e:r:f')).toBeNull()
  view.unmount(); render(<ShootingFirstFrameHistory {...props} />)
  await screen.findByRole('button', { name: '读取真实候选' })
  expect(api.select).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '继续原采用操作' })).toBeNull()
})
