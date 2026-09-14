// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QingmuApplicationFrame, creativeStepFromSearch } from '../src/client/QingmuApplicationFrame.tsx'
afterEach(cleanup)
it('accepts only the five product steps from the location', () => {
  for (const step of ['story', 'assets', 'storyboard', 'shooting', 'delivery']) expect(creativeStepFromSearch(`?qingmuView=${step}`)).toBe(step)
  expect(creativeStepFromSearch('?qingmuView=submit')).toBe('story')
  expect(creativeStepFromSearch('')).toBe('story')
})
const props = () => ({
  projects: [{ id: 'p', label: '落日公路' }], episodes: [{ id: 'e', label: 'EP1' }], projectId: 'p', episodeId: 'e',
  step: 'shooting' as const, loading: false, scopeLocked: false, onProject: vi.fn(), onEpisode: vi.fn(),
  onStep: vi.fn(), onCreate: vi.fn(), onRefresh: vi.fn(), onOpenTools: vi.fn(),
})

it('is the application, not an inner cockpit dialog, with four customer steps and compatible preparation routes', () => {
  const p = props()
  render(<QingmuApplicationFrame {...p}><main>真实项目镜头</main></QingmuApplicationFrame>)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: /打开.*驾驶舱|返回对话/ })).toBeNull()
  expect(screen.getAllByRole('navigation')).toHaveLength(1)
  for (const [name, step] of [['故事', 'story'], ['准备素材与分镜', 'assets'], ['生成与审看', 'shooting'], ['成片与导出', 'delivery']]) {
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

it('keeps storyboard deep links reachable inside the preparation step', () => {
  const p = props()
  render(<QingmuApplicationFrame {...p} step="storyboard"><main>分镜</main></QingmuApplicationFrame>)
  expect(within(screen.getByRole('navigation', { name: '创作流程' })).getAllByRole('button')).toHaveLength(4)
  expect(screen.getByRole('button', { name: /02准备素材与分镜/ }).getAttribute('aria-current')).toBe('step')
  const preparation = within(screen.getByRole('navigation', { name: '素材与分镜准备' }))
  fireEvent.click(preparation.getByRole('button', { name: '角色、场景与道具' }))
  expect(p.onStep).toHaveBeenLastCalledWith('assets')
  fireEvent.click(preparation.getByRole('button', { name: '分镜与导演' }))
  expect(p.onStep).toHaveBeenLastCalledWith('storyboard')
})
