// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'

const api = vi.hoisted(() => ({ history: vi.fn(), state: vi.fn(), historyPreview: vi.fn(), select: vi.fn(), receipt: vi.fn() }))
vi.mock('../src/client/first-frame-selection.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/first-frame-selection.ts')>(), createFirstFrameSelectionClient: () => api }))
const bytes = Buffer.from('real scoped image bytes')
const sha = createHash('sha256').update(bytes).digest('hex')
const image = { assetId: 'asset-new', materializedSha256: sha, qualityStatus: 'pending', selectionStatus: 'Unselected', isSelected: false }
const projection = { director: { shotRelations: { storyboardRevision: { revisionId: 'r' }, shots: [
  { shotId: 'f5', frameNo: 5, title: '查看手机', dialogueRhythm: { cues: [] } },
  { shotId: 'f6', frameNo: 6, title: '向公路呼喊', dialogueRhythm: { cues: [] } },
] }, heroFrameStoryboards: { shots: [] } } }
const props = () => ({ projectName: '落日公路', episodeName: 'EP1', projectId: 'p', episodeId: 'e', selectedShotId: 'f5', projection: projection as never,
  onSelectShotId: vi.fn(), onNavigate: vi.fn(), onProductionAction: vi.fn(), directorAssistant: null, t: (key: string) => key,
  port: { takeVersions: vi.fn(async ({ frameId }: { frameId: string }) => ({ subject: { projectId: 'p', episodeId: 'e', frameId, selectedTakeId: null, versions: [] }, capabilities: { canSelect: false } })), takePreview: vi.fn(), selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn() } as never,
})
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto)
  URL.createObjectURL = vi.fn(() => 'blob:new-first-frame'); URL.revokeObjectURL = vi.fn()
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [image] : [])
  api.state.mockRejectedValue(new Error('not eligible for adoption'))
  api.historyPreview.mockImplementation(async r => ({ ...r, materializedSha256: sha, mimeType: 'image/png', base64: bytes.toString('base64') }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks() })

it('shows the existing unselected frame instead of an empty shot, without selecting or generating', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧候选 v1' })
  expect(await screen.findByRole('img', { name: '未采用首帧候选' })).toBeTruthy()
  expect(screen.getByText('首帧待审')).toBeTruthy()
  expect(screen.getByRole('button', { name: '重新生成首帧' })).toBeTruthy()
  expect(screen.queryByText('已选用')).toBeNull()
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  expect(p.onProductionAction).not.toHaveBeenCalled()
  expect(api.select).not.toHaveBeenCalled()
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  expect(api.historyPreview.mock.calls.every(([r]) => r.frameId === 'f5' && r.assetId === image.assetId)).toBe(true)
  view.unmount(); render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧候选 v1' })
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('keeps an inactive shot candidate visible without carrying it into the empty current shot', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '未采用首帧候选' })
  view.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await screen.findByText('本镜还没有已落盘的首帧。')
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  const shot5 = within(screen.getByRole('button', { name: '镜 5 查看手机' }))
  expect(await shot5.findByRole('img', { name: '镜 5 首帧缩略图' })).toBeTruthy()
  expect(shot5.getByText('首帧待审')).toBeTruthy()
  const shot6 = within(screen.getByRole('button', { name: '镜 6 向公路呼喊' }))
  expect(shot6.queryByRole('img')).toBeNull()
  expect(shot6.getByText('无有效首帧')).toBeTruthy()
  expect(api.historyPreview.mock.calls.every(([r]) => r.frameId === 'f5' && r.assetId === image.assetId)).toBe(true)
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new-first-frame'))
  expect(api.select).not.toHaveBeenCalled()
})

it('loads inactive shot thumbnails after a fresh visit, without adoption or generation', async () => {
  const p = props()
  render(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  const shot5 = within(screen.getByRole('button', { name: '镜 5 查看手机' }))
  expect(await shot5.findByRole('img', { name: '镜 5 首帧缩略图' })).toBeTruthy()
  expect(shot5.getByText('首帧待审')).toBeTruthy()
  expect(shot5.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  expect(api.state.mock.calls.every(([r]) => r.frameId === 'f6')).toBe(true)
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('does not turn failed history reads into a false no-frame status', async () => {
  api.history.mockRejectedValue(new Error('offline'))
  const p = props()
  render(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await screen.findByText('首帧历史暂时无法读取，请重新打开。')
  const shot5 = within(screen.getByRole('button', { name: '镜 5 查看手机' }))
  expect(shot5.queryByText('暂无首帧')).toBeNull()
  expect(shot5.queryByText('无有效首帧')).toBeNull()
  expect(api.historyPreview).not.toHaveBeenCalled()
  expect(api.select).not.toHaveBeenCalled()
})

it('does not reread thumbnails or clear them for a semantically unchanged projection refresh', async () => {
  const p = props()
  const view = render(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await screen.findByRole('img', { name: '镜 5 首帧缩略图' })
  const reads = api.history.mock.calls.length
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  view.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f6" projection={structuredClone(projection) as never} />)
  await screen.findByText('本镜还没有已落盘的首帧。')
  expect(api.history).toHaveBeenCalledTimes(reads)
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(api.select).not.toHaveBeenCalled()
})
