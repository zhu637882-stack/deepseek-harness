// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QingmuApplicationFrame, creativeStepFromSearch } from '../src/client/QingmuApplicationFrame.tsx'
afterEach(cleanup)
it('accepts only the five product steps from the location', () => {
  for (const step of ['story', 'assets', 'storyboard', 'shooting', 'delivery']) expect(creativeStepFromSearch(`?qingmuView=${step}`)).toBe(step)
  expect(creativeStepFromSearch('?qingmuView=submit')).toBe('shooting')
  expect(creativeStepFromSearch('')).toBe('shooting')
})
const props = () => ({
  projects: [{ id: 'p', label: '落日公路' }], episodes: [{ id: 'e', label: 'EP1' }], projectId: 'p', episodeId: 'e',
  step: 'shooting' as const, loading: false, scopeLocked: false, onProject: vi.fn(), onEpisode: vi.fn(),
  onStep: vi.fn(), onCreate: vi.fn(), onRefresh: vi.fn(), onOpenTools: vi.fn(),
})

it('is the application, not an inner cockpit dialog, with one shared five-step navigation', () => {
  const p = props()
  render(<QingmuApplicationFrame {...p}><main>真实项目镜头</main></QingmuApplicationFrame>)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: /打开.*驾驶舱|返回对话/ })).toBeNull()
  expect(screen.getAllByRole('navigation')).toHaveLength(1)
  for (const [name, step] of [['故事', 'story'], ['角色与场景', 'assets'], ['分镜', 'storyboard'], ['拍摄与审看', 'shooting'], ['导出', 'delivery']]) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name!) }))
    expect(p.onStep).toHaveBeenLastCalledWith(step)
  }
  expect(screen.getByRole('main').textContent).toContain('真实项目镜头')
  expect(p.onRefresh).not.toHaveBeenCalled()
})

it('keeps system tools separate and does not change project or scene when opening them', () => {
  const p = props()
  render(<QingmuApplicationFrame {...p}><main>媒体</main></QingmuApplicationFrame>)
  fireEvent.click(screen.getByRole('button', { name: '系统设置' }))
  expect(p.onOpenTools).toHaveBeenCalledOnce()
  expect(p.onProject).not.toHaveBeenCalled()
  expect(p.onEpisode).not.toHaveBeenCalled()
  expect(p.onStep).not.toHaveBeenCalled()
})

it('keeps project creation and settings in the compact accessible tools menu', () => {
  const p = props()
  render(<QingmuApplicationFrame {...p}><main>媒体</main></QingmuApplicationFrame>)
  const more = screen.getByRole('button', { name: '更多' })
  expect(more.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(more)
  expect(screen.getByRole('group', { name: '项目与系统操作' })).toBeTruthy()
  fireEvent.click(within(screen.getByRole('group', { name: '项目与系统操作' })).getByRole('button', { name: '新建项目' }))
  expect(p.onCreate).toHaveBeenCalledOnce()
  fireEvent.click(more)
  fireEvent.click(within(screen.getByRole('group', { name: '项目与系统操作' })).getByRole('button', { name: '系统设置' }))
  expect(p.onOpenTools).toHaveBeenCalledOnce()
  fireEvent.click(more)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('group', { name: '项目与系统操作' })).toBeNull()
  expect(document.activeElement).toBe(more)
})

it('retains the exact embedded scope rather than offering a project switch', () => {
  render(<QingmuApplicationFrame {...props()} scopeLocked><main>媒体</main></QingmuApplicationFrame>)
  expect(screen.getByRole('combobox', { name: '项目' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('combobox', { name: '剧集' }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: '新建项目' })).toBeNull()
})
