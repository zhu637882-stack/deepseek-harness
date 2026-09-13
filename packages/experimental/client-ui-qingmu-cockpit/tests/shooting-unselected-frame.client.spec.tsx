// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'

const api = vi.hoisted(() => ({ history: vi.fn(), state: vi.fn(), historyPreview: vi.fn(), select: vi.fn(), receipt: vi.fn() }))
vi.mock('../src/client/first-frame-selection.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/first-frame-selection.ts')>(), createFirstFrameSelectionClient: () => api }))
const bytes = Buffer.from('real scoped image bytes')
const sha = createHash('sha256').update(bytes).digest('hex')
const image = { assetId: 'asset-new', materializedSha256: sha, qualityStatus: 'pending', selectionStatus: 'Unselected', isSelected: false }
const planningState = {
  projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 'a'.repeat(64),
  scenes: [],
  storyboard: { version: 1, sourceHash: 'b'.repeat(64) },
  canonicalStoryboard: { shots: [{ id: 'f5', imagePromptCn: '查看手机的首帧要求' }, { id: 'f6', imagePromptCn: '向公路呼喊的首帧要求' }] },
  frameRequirements: [{ id: 'f5', imagePromptCn: '查看手机的首帧要求' }, { id: 'f6', imagePromptCn: '向公路呼喊的首帧要求' }],
}
const projection = { director: { shotRelations: { storyboardRevision: { revisionId: 'r' }, shots: [
  { shotId: 'f5', frameNo: 5, title: '查看手机', dialogueRhythm: { cues: [] } },
  { shotId: 'f6', frameNo: 6, title: '向公路呼喊', dialogueRhythm: { cues: [] } },
] }, heroFrameStoryboards: { shots: [] } } }
const props = () => ({ projectName: '落日公路', episodeName: 'EP1', projectId: 'p', episodeId: 'e', selectedShotId: 'f5', projection: projection as never,
  onSelectShotId: vi.fn(), onNavigate: vi.fn(), onProductionAction: vi.fn(), directorAssistant: null, t: (key: string) => key,
  port: { takeVersions: vi.fn(async ({ frameId }: { frameId: string }) => ({ subject: { projectId: 'p', episodeId: 'e', frameId, selectedTakeId: null, versions: [] }, capabilities: { canSelect: false } })), takePreview: vi.fn(), selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn(),
    readScenePlanning: vi.fn(async () => planningState), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
  } as never,
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
  expect(await screen.findByRole('img', { name: '首帧 v1 缩略图' })).toBeTruthy()
  expect(screen.getByText('首帧待审')).toBeTruthy()
  expect(screen.getByRole('button', { name: '重新生成首帧' })).toBeTruthy()
  expect(screen.queryByText('已选用')).toBeNull()
  expect(screen.queryByRole('button', { name: '认可并采用这张首帧' })).toBeNull()
  expect(p.onProductionAction).not.toHaveBeenCalled()
  expect(api.select).not.toHaveBeenCalled()
  // The candidate strip and the history pane each load the same settled candidate.
  expect(api.historyPreview.mock.calls.length).toBeGreaterThanOrEqual(1)
  expect(api.historyPreview.mock.calls.every(([r]) => r.frameId === 'f5' && r.assetId === image.assetId)).toBe(true)
  view.unmount(); render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧候选 v1' })
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('lists every first-frame candidate in the strip and previews one on click without adopting', async () => {
  const p = props()
  render(<ShootingReviewWorkspace {...p} />)
  const marker = await screen.findByText('等待检查')
  const card = marker.closest('button')
  expect(card).not.toBeNull()
  fireEvent.click(card!)
  expect(await screen.findByText('候选浏览 · 不会改变选用')).toBeTruthy()
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('adopts a passed first-frame candidate directly from the strip without generation', async () => {
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [{ ...image, qualityStatus: 'passed' }] : [])
  const p = props()
  render(<ShootingReviewWorkspace {...p} />)
  const adopt = await screen.findByRole('button', { name: '就用这张' })
  fireEvent.click(adopt)
  await waitFor(() => expect(api.select).toHaveBeenCalledTimes(1))
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('keeps an inactive shot candidate visible without carrying it into the empty current shot', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧 v1 缩略图' })
  view.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await screen.findByText('可直接用人物、场景和声音参考生成视频；也可先生成首帧。画面要求在右栏可改。')
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
  await screen.findByText('可直接用人物、场景和声音参考生成视频；也可先生成首帧。画面要求在右栏可改。')
  expect(api.history).toHaveBeenCalledTimes(reads)
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(api.select).not.toHaveBeenCalled()
})

const oldHeroUrl = `http://127.0.0.1:65269/api/media/media_old?expires=9999999999&signature=${'a'.repeat(64)}`
const oldImage = { ...image, assetId: 'asset_old', isSelected: true, selectionStatus: 'Selected', qualityStatus: 'passed' }
const selectedProjection = { ...projection, director: { ...projection.director,
  heroFrameStoryboards: { shots: [{ shotId: 'f5', heroFrame: { assetId: oldImage.assetId, browserUrl: oldHeroUrl } }] },
} }

it('uses a newer unselected thumbnail even when an old hero is selected, on switch and fresh visits', async () => {
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [oldImage, image] : [])
  const p = { ...props(), projection: selectedProjection as never }
  const view = render(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  const shot5 = within(screen.getByRole('button', { name: '镜 5 查看手机' }))
  await waitFor(() => expect(shot5.getByRole('img').getAttribute('src')).toBe('blob:new-first-frame'))
  expect(shot5.getByText('首帧待审')).toBeTruthy()
  view.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f5" />)
  await screen.findByRole('img', { name: '镜 5 已选首帧' })
  expect(shot5.getByRole('img').getAttribute('src')).toBe('blob:new-first-frame')
  expect(screen.queryByRole('img', { name: '当前首帧候选' })).toBeNull()
  expect(screen.getByText('已选用')).toBeTruthy()
  expect(screen.getByText('等待检查')).toBeTruthy()
  view.unmount(); render(<ShootingReviewWorkspace {...p} selectedShotId="f6" />)
  await waitFor(() => expect(screen.getByRole('img', { name: '镜 5 首帧缩略图' }).getAttribute('src')).toBe('blob:new-first-frame'))
  expect(api.historyPreview.mock.calls.every(([r]) => r.frameId === 'f5')).toBe(true)
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('opens the latest history candidate and distinguishes its preview from the adopted hero', async () => {
  sessionStorage.setItem('qingmu:shooting-pane:p:e:f5', 'history')
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [oldImage, image] : [])
  const p = { ...props(), projection: selectedProjection as never }
  render(<ShootingReviewWorkspace {...p} />)
  await screen.findByRole('img', { name: '首帧候选 v2' })
  expect(await screen.findByRole('img', { name: '首帧 v2 缩略图' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /首帧 v1.*当前选用/ }).getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByRole('button', { name: /首帧 v2/ }).getAttribute('aria-pressed')).toBe('true')
  expect(api.historyPreview.mock.calls.some(([r]) => r.assetId === image.assetId)).toBe(true)
  // One candidate strip, with real thumbnails; browsing never adopts the new image.
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /首帧 v1\s*当前选用/ }))
  await screen.findByRole('img', { name: '首帧候选 v1' })
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  expect(api.select).not.toHaveBeenCalled()
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('reuses the newly generated image for the active thumbnail without loading another copy or POST replay', async () => {
  sessionStorage.setItem('qingmu:shooting-pane:p:e:f5', 'first-frame')
  const scope = { projectId: 'p', episodeId: 'e', frameId: 'f5' }
  const preview = { ...scope, schema: 'qingmu.shooting-first-frame-preview.v1', preflightId: 'a'.repeat(64),
    payloadHash: 'b'.repeat(64), prompt: '当前镜头画面要求', povObserver: '', estimatedCny: .5,
    blockers: [], maxAttempts: 1, n: 1, selectAsOfficial: false }
  const requestId = `shooting-${preview.preflightId}`
  const newUrl = `http://127.0.0.1:65269/api/media/media_new?expires=9999999999&signature=${'b'.repeat(64)}`
  localStorage.setItem('qingmu:shooting-first-frame:p:e:f5', JSON.stringify({ preview, requestId }))
  const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path.includes('/review?')
    ? { frameId: 'f5', frameDigest: 'c'.repeat(64), accepted: true, title: '查看手机', imagePromptCn: '当前要求', preflight: { technicalReady: true } }
    : { ...scope, schema: 'qingmu.shooting-first-frame-state.v1', requestId,
      task: { id: 'original-task', kernel_status: 'Succeeded' },
      candidate: { assetId: image.assetId, sha256: image.materializedSha256, browserUrl: newUrl, isSelected: false, qualityStatus: 'pending' } },
  }))
  vi.stubGlobal('fetch', fetcher)
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [oldImage, image] : [])
  const p = { ...props(), projection: selectedProjection as never }
  const view = render(<ShootingReviewWorkspace {...p} />)
  fireEvent.load(await screen.findByRole('img', { name: '镜头新首帧 · 待你定版' }))
  await waitFor(() => expect(screen.getByRole('img', { name: '镜 5 首帧缩略图' }).getAttribute('src')).toBe(newUrl))
  expect(screen.getByRole('img', { name: '新首帧候选缩略图' }).getAttribute('src')).toBe(newUrl)
  expect(screen.queryByRole('img', { name: '当前首帧候选' })).toBeNull()
  view.unmount(); render(<ShootingReviewWorkspace {...p} />)
  fireEvent.load(await screen.findByRole('img', { name: '镜头新首帧 · 待你定版' }))
  await waitFor(() => expect(screen.getByRole('img', { name: '镜 5 首帧缩略图' }).getAttribute('src')).toBe(newUrl))
  expect(api.historyPreview).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.every(([path]) => path.includes('/state?') || path.includes('/review?'))).toBe(true)
  expect(api.select).not.toHaveBeenCalled()
})

it.each(['adopt', 'recover'])('removes stale unselected preview metadata after a verified %s receipt', async (operation) => {
  sessionStorage.setItem('qingmu:shooting-pane:p:e:f5', 'history')
  let adopted = false
  const next = { ...image, assetId: 'asset_new', qualityStatus: 'passed' }
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5'
    ? [{ ...oldImage, isSelected: !adopted }, { ...next, isSelected: adopted, selectionStatus: adopted ? 'Selected' : 'Unselected' }] : [])
  api.state.mockImplementation(async () => ({ candidates: [{ ...next, isSelected: adopted }], selectionReceipt: null }))
  const receipt = async (intent: { idempotencyKey: string }) => {
    adopted = true
    return { idempotencyKey: intent.idempotencyKey, selectedAssetId: next.assetId, selectedMaterializedSha256: sha }
  }
  api.select.mockImplementation(receipt); api.receipt.mockImplementation(receipt)
  if (operation === 'recover') localStorage.setItem('qingmu:first-frame-adopt:p:e:r:f5', JSON.stringify({
    projectId: 'p', episodeId: 'e', storyboardRevisionId: 'r', frameId: 'f5',
    assetId: next.assetId, expectedMaterializedSha256: sha, idempotencyKey: 'first-frame-original', requestSha256: 'c'.repeat(64),
  }))
  const p = { ...props(), projection: selectedProjection as never }
  const nextProjection = { ...selectedProjection, director: { ...selectedProjection.director,
    heroFrameStoryboards: { shots: [{ shotId: 'f5', heroFrame: { assetId: next.assetId, browserUrl: oldHeroUrl.replace('media_old', 'media_new') } }] },
  } }
  const onCommitted = vi.fn(async (): Promise<void> => {
    view.rerender(<ShootingReviewWorkspace {...p} projection={nextProjection as never} onCommitted={onCommitted} />)
  })
  const view = render(<ShootingReviewWorkspace {...p} onCommitted={onCommitted} />)
  await screen.findByRole('img', { name: '首帧 v2 缩略图' })
  fireEvent.click(await screen.findByRole('button', { name: operation === 'adopt' ? '认可并采用这张首帧' : '读取原采用结果' }))
  await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('img', { name: '未采用首帧候选' })).toBeNull()
  expect(screen.queryByText('尚未采用')).toBeNull()
  expect(screen.getByRole('button', { name: /首帧 v2.*当前选用/ }).getAttribute('aria-pressed')).toBe('true')
  expect(within(screen.getByRole('button', { name: '镜 5 查看手机' })).getByText('有首帧')).toBeTruthy()
  expect(api.select).toHaveBeenCalledTimes(operation === 'adopt' ? 1 : 0)
  expect(api.receipt).toHaveBeenCalledTimes(operation === 'recover' ? 1 : 0)
  expect(p.onProductionAction).not.toHaveBeenCalled()
})

it('keeps the latest thumbnail when a rework is prepared but has not been submitted', async () => {
  sessionStorage.setItem('qingmu:shooting-pane:p:e:f5', 'first-frame')
  const scope = { projectId: 'p', episodeId: 'e', frameId: 'f5' }
  const preview = { ...scope, schema: 'qingmu.shooting-first-frame-preview.v1', preflightId: 'a'.repeat(64),
    payloadHash: 'b'.repeat(64), prompt: '当前镜头画面要求', povObserver: '', estimatedCny: .5,
    blockers: [], maxAttempts: 1, n: 1, selectAsOfficial: false }
  localStorage.setItem('qingmu:shooting-first-frame:p:e:f5', JSON.stringify({ preview, requestId: `shooting-${preview.preflightId}`, stage: 'prepared' }))
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
    frameId: 'f5', frameDigest: 'c'.repeat(64), accepted: true, title: '查看手机', imagePromptCn: '当前要求', preflight: { technicalReady: true },
  }) }))
  vi.stubGlobal('fetch', fetcher)
  api.history.mockImplementation(async ({ frameId }) => frameId === 'f5' ? [oldImage, image] : [])
  render(<ShootingReviewWorkspace {...props()} projection={selectedProjection as never} />)
  await screen.findByRole('button', { name: '生成这张首帧（仅一次）' })
  await waitFor(() => expect(screen.getByRole('img', { name: '镜 5 首帧缩略图' }).getAttribute('src')).toBe('blob:new-first-frame'))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(api.historyPreview).toHaveBeenCalledTimes(1)
  expect(api.select).not.toHaveBeenCalled()
})
