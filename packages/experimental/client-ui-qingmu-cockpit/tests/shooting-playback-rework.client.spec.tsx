// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'

// Browser decoding belongs to the player tests; posters must not contend for it here.
vi.mock('../src/client/TakeThumbnail.tsx', () => ({ TakeThumbnail: ({ alt }: { alt: string }) => <span>{alt}</span> }))
const firstFrameMount = vi.hoisted(() => vi.fn())
vi.mock('../src/client/ShootingFirstFrame.tsx', () => ({ ShootingFirstFrame: ({ scope }: { scope: { frameId: string } }) => { firstFrameMount(scope.frameId); return <section aria-label="首帧生成">等待本人确认并生成</section> } }))
vi.mock('../src/client/ShootingFirstFrameHistory.tsx', () => ({ ShootingFirstFrameHistory: () => <section aria-label="本镜首帧候选">真实历史候选</section> }))
const bytes = Buffer.from('existing video')
const sha = createHash('sha256').update(bytes).digest('hex')
const projection = {
  director: { shotRelations: { shots: Array.from({ length: 10 }, (_, i) => ({ shotId: `f${i + 1}`, frameNo: i + 1, title: `剧情${i + 1}` })) },
    heroFrameStoryboards: { shots: [] } },
}
const props = () => ({ projectName: '落日公路', episodeName: 'EP1', projectId: 'p', episodeId: 'e',
  selectedShotId: 'f1', projection: projection as never, onSelectShotId: vi.fn(), onNavigate: vi.fn(),
  directorAssistant: null, t: (key: string) => key, onProductionAction: vi.fn(),
  port: {
    takeVersions: vi.fn(async ({ frameId }: { frameId: string }) => ({
      subject: { projectId: 'p', episodeId: 'e', frameId, selectedTakeId: 'v2', versions: [1, 2].map(n => ({
        takeId: `v${n}`, versionOrdinal: n, outputSha256: sha, outputBindingStatus: 'verified', qualityStatus: n === 1 ? 'failed' : 'passed', isSelected: n === 2,
      })) }, capabilities: { canSelect: true },
    })),
    takePreview: vi.fn(async (r: { projectId: string; episodeId: string; frameId: string; takeId: string }) => ({
      ...r, outputSha256: sha, mimeType: 'video/mp4', base64: bytes.toString('base64'),
    })), selectTakeVersion: vi.fn(), recoverTakeVersionSelection: vi.fn(),
  } as never,
})
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto)
  URL.createObjectURL = vi.fn(() => 'blob:video'); URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('keeps the playing candidate across background workflow refreshes', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /视频候选 v1.*检查未通过/ }))
  await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('aria-label')).toContain('v1'))
  const playing = view.container.querySelector('video')
  view.rerender(<ShootingReviewWorkspace {...p} projection={structuredClone(projection) as never} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /视频候选 v1.*检查未通过/ }).getAttribute('aria-pressed')).toBe('true'))
  expect(view.container.querySelector('video')).toBe(playing)
})

it('opens first-frame history directly, without preparing a video or requiring Ready PromptIR', async () => {
  const p = props(); render(<ShootingReviewWorkspace {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '查看与采用首帧' }))
  expect(screen.getByRole('region', { name: '本镜首帧候选' })).toBeTruthy()
  expect(p.onProductionAction).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: /视频候选 v1.*检查未通过/ }))
  expect(screen.queryByRole('region', { name: '本镜首帧候选' })).toBeNull()
})

it('restores the first-frame viewing panel after refresh without invoking a production action', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '生成首帧' }))
  view.unmount()
  const second = render(<ShootingReviewWorkspace {...p} />)
  expect(await screen.findByRole('region', { name: '首帧生成' })).toBeTruthy()
  expect(p.onProductionAction).not.toHaveBeenCalled()
  firstFrameMount.mockClear()
  second.rerender(<ShootingReviewWorkspace {...p} selectedShotId="f2" />)
  expect(screen.queryByRole('region', { name: '首帧生成' })).toBeNull()
  expect(firstFrameMount).not.toHaveBeenCalled()
  second.rerender(<ShootingReviewWorkspace {...p} />)
  expect(await screen.findByRole('region', { name: '首帧生成' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '返回候选审看' }))
  second.unmount()
  render(<ShootingReviewWorkspace {...p} />)
  expect(screen.queryByRole('region', { name: '首帧生成' })).toBeNull()
})

it('exposes rework for every shot without selecting or generating, and candidate clicks exit first-frame mode', async () => {
  const p = props(); const view = render(<ShootingReviewWorkspace {...p} />)
  for (let n = 1; n <= 10; n++) {
    view.rerender(<ShootingReviewWorkspace {...p} selectedShotId={`f${n}`} />)
    await waitFor(() => expect(view.container.querySelector('video')?.getAttribute('aria-label')).toContain('v2'))
    fireEvent.click(screen.getByRole('button', { name: '重新生成视频' }))
    expect(p.onProductionAction).toHaveBeenLastCalledWith('video', `f${n}`)
    fireEvent.click(screen.getByRole('button', { name: '生成首帧' }))
    expect(screen.getByRole('region', { name: '首帧生成' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /视频候选 v1.*检查未通过/ }))
    expect(screen.queryByRole('region', { name: '首帧生成' })).toBeNull()
  }
  expect(p.port).toHaveProperty('selectTakeVersion')
  expect((p.port as { selectTakeVersion: ReturnType<typeof vi.fn> }).selectTakeVersion).not.toHaveBeenCalled()
})
