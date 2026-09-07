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

describe('ShootingReviewWorkspace', () => {
  afterEach(cleanup)
  it('browses candidates without changing the selected Shot and keeps adoption explicit', () => {
    const onSelectShotId = vi.fn()
    render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} directorAssistant={<p>导演助手</p>} />)
    fireEvent.click(screen.getByRole('button', { name: /候选.*镜 7/i }))
    expect(onSelectShotId).not.toHaveBeenCalled()
    expect(screen.getByText('单击候选只用于浏览，不会改变选用。采用候选请使用下方的“版本比较与选用”。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看候选版本' }).getAttribute('href')).toBe('#qingmu-version-selection')
  })

  it('changes the active Shot only through the Shot list and switches to the native assistant', () => {
    const onSelectShotId = vi.fn()
    const view = render(<ShootingReviewWorkspace projectName="落日公路" episodeName="第 1 集" projection={projection}
      selectedShotId="frame_34b3741b1f0a" onSelectShotId={onSelectShotId} directorAssistant={<p>导演助手已连接</p>} />)
    fireEvent.click(within(view.container.querySelector('[aria-label="镜头列表"]') as HTMLElement).getByRole('button', { name: /镜 7.*车内回望/i }))
    expect(onSelectShotId).toHaveBeenCalledWith('frame-7')
    fireEvent.click(screen.getByRole('button', { name: '原生导演助手' }))
    expect(screen.getByText('导演助手已连接')).toBeTruthy()
  })
})
