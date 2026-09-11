// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { ProjectLibrary } from '../src/client/ProjectLibrary.tsx'
import { PrivateProjectCover } from '../src/client/PrivateProjectCover.tsx'
import type { ProjectUpdateRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { YimengJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
afterEach(cleanup)

const projects = [
  { id: 'p1', name: '夜航', theme: '一个新故事', status: 'active', thumbnail_url: 'http://127.0.0.1:55839/media/cover.png' },
  { id: 'p2', name: '归途', status: 'archived', canEdit: true },
  { id: 'p3', name: '共享作品', status: 'active', canEdit: false },
]

it('renames, archives and restores without deleting projects or changing the open scope', async () => {
  const update = vi.fn<(request: ProjectUpdateRequest) => void>(), open = vi.fn()
  function Fixture() {
    const [items, setItems] = useState<readonly YimengJsonObject[]>(projects)
    return <ProjectLibrary projects={items} currentProjectId="p1" loading={false} onCreate={vi.fn()} onOpen={open} onUpdate={async (request) => {
      update(request)
      setItems(previous => previous.map(project => project.id === request.projectId ? { ...project, ...request } : project))
    }} />
  }
  render(<Fixture />)
  expect(screen.getAllByRole('article')).toHaveLength(2)
  const image = within(screen.getByRole('article', { name: '夜航' })).getByRole('presentation', { hidden: true })
  expect(image.getAttribute('src')).toContain('/media/cover.png')
  fireEvent.click(screen.getByRole('button', { name: '重命名 夜航' }))
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '夜航新篇' } })
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await screen.findByText('项目名称已保存。')
  fireEvent.click(screen.getByRole('button', { name: '归档 夜航新篇' }))
  await waitFor(() => { expect(screen.queryByRole('article', { name: '夜航新篇' })).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: '已归档' }))
  expect(screen.getAllByRole('article')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '恢复 夜航新篇' }))
  await screen.findByText('项目已恢复，可在“创作中”继续。')
  fireEvent.click(screen.getByRole('button', { name: '创作中' }))
  expect(screen.getByRole('article', { name: '夜航新篇' })).toBeTruthy()
  expect(update.mock.calls.map(call => call[0])).toEqual([{ projectId: 'p1', name: '夜航新篇' }, { projectId: 'p1', status: 'archived' }, { projectId: 'p1', status: 'active' }])
  expect(open).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '重命名 共享作品' })).toBeNull()
})

it('retains the draft after a save failure and does not submit a blank name', async () => {
  const update = vi.fn().mockRejectedValue(new Error('连接中断，请重试'))
  render(<ProjectLibrary projects={projects} currentProjectId="p1" loading={false} onOpen={vi.fn()} onCreate={vi.fn()} onUpdate={update} />)
  fireEvent.click(screen.getByRole('button', { name: '重命名 夜航' }))
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: ' ' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存名称' }).disabled).toBe(true)
  expect(update).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '待保存名称' } })
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  expect((await screen.findByRole('alert')).textContent).toContain('连接中断')
  expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('待保存名称')
})

it('uses a project and hash bound private preview without changing asset selection', async () => {
  const reference = { assetId: 'asset_prop', assetSha256: 'a'.repeat(64), mediaType: 'reference_image' as const,
    label: '收音机', browserUrl: '', localReferenceScope: { elementKind: 'prop' as const, targetId: 'prop_radio' } }
  const port = {
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p1', page: 1, pages: 1, items: [reference] })),
    readLocalReferenceCandidateContent: vi.fn(async () => ({ schema: 'jason.qingmu-local-reference-candidate-content.v1' as const,
      assetId: reference.assetId, sha256: reference.assetSha256, mimeType: 'image/png' as const, contentBase64: 'AQID' })),
  }
  const view = render(<PrivateProjectCover projectId="p1" name="时差修理铺" port={port} />)
  await waitFor(() => { expect(view.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AQID') })
  expect(port.readLocalReferenceCandidateContent).toHaveBeenCalledWith({ projectId: 'p1', assetId: 'asset_prop',
    expectedSha256: reference.assetSha256, elementKind: 'prop', targetId: 'prop_radio' }, expect.any(AbortSignal))
  expect(screen.getByText('素材预览')).toBeTruthy()
})
