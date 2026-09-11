// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectLibrary } from '../src/client/ProjectLibrary.tsx'
import type { ProjectCopyRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
afterEach(() => { cleanup(); localStorage.clear() })
it('uses the project-library copy action and retains the exact request across a lost response and remount', async () => {
  const onCopied = vi.fn(async () => {})
  const port = {
    previewProjectCopy: vi.fn(async () => ({ schema: 'qingmu.project-copy-preview.v1' as const, sourceProjectId: 'p1', sourceName: '夜航', sourceSha256: 'a'.repeat(64), counts: { episodes: 2, storyboard_frames: 18, assets: 6 } })),
    copyProject: vi.fn(async (request: ProjectCopyRequest) => ({ schema: 'qingmu.project-copy-result.v1' as const, ...request, projectId: 'p2', episodeIds: ['e2'], requestSha256: 'b'.repeat(64) })),
  }
  port.copyProject.mockRejectedValueOnce(new Error('连接中断'))
  const props = { projects: [{ id: 'p1', name: '夜航', status: 'active' }], currentProjectId: 'p1', loading: false,
    onOpen: vi.fn(), onCreate: vi.fn(), onUpdate: vi.fn(async () => {}), copyPort: port, onCopied }
  const view = render(<ProjectLibrary {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '复制 夜航' }))
  await screen.findByText('2 集 · 18 个镜头 · 6 份素材')
  expect(screen.getByRole('region', { name: '复制项目 夜航' }).outerHTML).toMatchSnapshot('project-library-copy-preview')
  fireEvent.change(screen.getByLabelText('副本名称'), { target: { value: '夜航第二稿' } })
  fireEvent.click(screen.getByRole('button', { name: '创建独立副本' }))
  await screen.findByRole('alert')
  expect(onCopied).not.toHaveBeenCalled()
  const intent = port.copyProject.mock.calls[0]![0]
  expect(JSON.parse(localStorage.getItem('qingmu.project-copy.v1:p1')!)).toEqual(intent)
  view.unmount()
  render(<ProjectLibrary {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '复制 夜航' }))
  await screen.findByText('已有复制记录待确认，将继续同一次操作。')
  expect(screen.getByLabelText<HTMLInputElement>('副本名称').value).toBe('夜航第二稿')
  expect(port.previewProjectCopy).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '恢复复制结果' }))
  await waitFor(() => { expect(onCopied).toHaveBeenCalledOnce() })
  expect(port.copyProject.mock.calls[1]![0]).toEqual(intent)
  await waitFor(() => { expect(localStorage.getItem('qingmu.project-copy.v1:p1')).toBeNull() })
  expect(screen.getByRole('article', { name: '夜航' })).toBeTruthy()
})
