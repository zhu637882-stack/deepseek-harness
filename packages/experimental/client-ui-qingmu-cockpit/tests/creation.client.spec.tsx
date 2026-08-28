// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateProjectWorkspace, TextImportWorkspace } from '../src/client/CreationWorkspace.tsx'

const port = () => ({ initializeProject: vi.fn(async () => { throw new Error('unknown submission result') }),
  recoverProjectInitialization: vi.fn(async () => { throw new Error('404 bootstrap_receipt_not_found') }),
  readTextImport: vi.fn(async () => ({ schema: 'jason.qingmu-text-import-state.v1' as const, projectId: 'project_1', episodeId: 'episode_1', scriptRevision: 0, script: null, draft: null, draftActive: false })),
  createTextImport: vi.fn(async () => { throw new Error('unknown submission result') }),
  correctTextImport: vi.fn(async () => { throw new Error('unused') }),
  confirmTextImport: vi.fn(async () => { throw new Error('unused') }),
})
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('creation input and unknown-result recovery', () => {
  it('lets a rejected stale intent be explicitly rebased only after a read, preserving all input', async () => {
    const api = port()
    render(<TextImportWorkspace port={api} projectId="project_1" episodeId="episode_1" onSaved={async () => {}} />)
    await waitFor(() =>{  expect(api.readTextImport).toHaveBeenCalledOnce() })
    fireEvent.change(screen.getByLabelText('剧本文字'), { target: { value: '场景一：旧街\n林夏：请进。' } })
    fireEvent.click(screen.getByText('解析并保存预览草稿'))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重试同一导入' }).disabled).toBe(true)
    api.readTextImport.mockResolvedValue({ schema: 'jason.qingmu-text-import-state.v1', projectId: 'project_1', episodeId: 'episode_1', scriptRevision: 1, script: null, draft: null, draftActive: false })
    fireEvent.click(screen.getByText('读取恢复 / 刷新预览'))
    fireEvent.click(await screen.findByText('保留文字，按当前版本重新准备'))
    expect(screen.getByLabelText<HTMLTextAreaElement>('剧本文字').value).toContain('林夏：请进。')
    expect(api.createTextImport).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('解析并保存预览草稿'))
    await waitFor(() =>{  expect(api.createTextImport).toHaveBeenCalledTimes(2) })
    const calls = api.createTextImport.mock.calls as unknown as [{ expectedScriptRevision: number; idempotencyKey: string }][]
    expect(calls[1]![0].expectedScriptRevision).toBe(1)
    expect(calls[1]![0].idempotencyKey).not.toBe(calls[0]![0].idempotencyKey)
  })
  it('keeps one project intent across double clicks and remount; recovery never resubmits', async () => {
    const api = port()
    const props = { port: api, onCreated: vi.fn(async () => {}) }
    const first = render(<CreateProjectWorkspace {...props} />)
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '恢复样本' } })
    fireEvent.click(screen.getByText('新建项目与第 1 集'))
    fireEvent.click(screen.getByText('正在确认…'))
    await screen.findByRole('alert')
    expect(api.initializeProject).toHaveBeenCalledOnce()
    first.unmount()
    render(<CreateProjectWorkspace {...props} />)
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('恢复样本')
    fireEvent.click(screen.getByText('读取创建恢复'))
    await waitFor(() =>{  expect(api.recoverProjectInitialization).toHaveBeenCalledOnce() })
    expect(api.initializeProject).toHaveBeenCalledOnce()
  })
  it('retains pasted text across failure and remount without automatically parsing again', async () => {
    const api = port()
    const props = { port: api, projectId: 'project_1', episodeId: 'episode_1', onSaved: vi.fn(async () => {}) }
    const first = render(<TextImportWorkspace {...props} />)
    await waitFor(() =>{  expect(api.readTextImport).toHaveBeenCalledOnce() })
    fireEvent.change(screen.getByLabelText('剧本文字'), { target: { value: '场景一：雨夜\n林夏：请进。' } })
    fireEvent.click(screen.getByText('解析并保存预览草稿'))
    await screen.findByRole('alert')
    expect(api.createTextImport).toHaveBeenCalledOnce()
    first.unmount()
    render(<TextImportWorkspace {...props} />)
    await waitFor(() =>{  expect(api.readTextImport).toHaveBeenCalledTimes(2) })
    expect(screen.getByLabelText<HTMLTextAreaElement>('剧本文字').value).toContain('场景一：雨夜')
    expect(api.createTextImport).toHaveBeenCalledOnce()
    expect(api.confirmTextImport).not.toHaveBeenCalled()
  })
})
