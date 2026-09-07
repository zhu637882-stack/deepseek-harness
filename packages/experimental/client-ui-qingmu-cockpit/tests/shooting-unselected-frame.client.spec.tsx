// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  api.history.mockResolvedValue([image])
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
  view.unmount(); render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧候选 v1' })
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('does not carry the previous shot image or pending label into a shot with no candidates', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '未采用首帧候选' })
  api.history.mockResolvedValue([])
  view.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await screen.findByText('本镜还没有已落盘的首帧。')
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  expect(screen.queryByText('首帧待审')).toBeNull()
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new-first-frame'))
  expect(api.select).not.toHaveBeenCalled()
})
