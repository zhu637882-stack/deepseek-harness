// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShootingReviewWorkspace } from '../src/client/ShootingReviewWorkspace.tsx'

const projection = {
  director: { shotRelations: { shots: [
    { shotId: 'frame_34b3741b1f0a', frameNo: 6, title: '落日公路', sceneId: 'scene-1' },
    { shotId: 'frame-7', frameNo: 7, title: '车内回望', sceneId: 'scene-1' },
  ] } },
} as never

const port = {
  takeVersions: vi.fn(() => new Promise(() => {})),
  takePreview: vi.fn(),
  selectTakeVersion: vi.fn(),
} as never

describe('ShootingReviewWorkspace', () => {
  afterEach(cleanup)
  it('browses candidates without changing the selected Shot and keeps adoption explicit', () => {
    const onSelectShotId = vi.fn()
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} directorAssistant={<p>导演助手</p>} port={port} testState="pending-review" />)
    expect(onSelectShotId).not.toHaveBeenCalled()
    expect(screen.getByText(/单击候选只切换中区媒体，不会改变选用/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '当前已选用' })).toBeTruthy()
  })

  it('changes the active Shot only through the Shot list and switches to the native assistant', () => {
    const onSelectShotId = vi.fn()
    const view = render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} directorAssistant={<p>导演助手已连接</p>} port={port} testState="failed" />)
    fireEvent.click(within(view.container.querySelector('[aria-label="镜头列表"]') as HTMLElement).getByRole('button', { name: /镜 7.*车内回望/i }))
    expect(onSelectShotId).toHaveBeenCalledWith('frame-7')
    fireEvent.click(screen.getByRole('button', { name: '原生导演助手' }))
    expect(screen.getByText('导演助手已连接')).toBeTruthy()
  })

  it.each(['normal', 'generating', 'failed', 'pending-review'] as const)('renders the isolated %s state', (testState) => {
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projectId="project_cd5eabc7582b" episodeId="episode_cd4ffe357df9" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={vi.fn()} directorAssistant={null} port={port} testState={testState} />)
    expect(document.querySelector(`[data-state="${testState}"]`)).toBeTruthy()
  })
})
