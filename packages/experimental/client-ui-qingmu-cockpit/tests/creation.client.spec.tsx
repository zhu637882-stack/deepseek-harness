// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CreativeContractState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { CreateProjectWorkspace, TextImportWorkspace } from '../src/client/CreationWorkspace.tsx'

const port = () => ({ initializeProject: vi.fn(async () => { throw new Error('unknown submission result') }),
  recoverProjectInitialization: vi.fn(async () => { throw new Error('404 bootstrap_receipt_not_found') }),
  readCreativeContract: vi.fn(async (): Promise<CreativeContractState> => ({ schema: 'jason.qingmu-creative-contract-state.v1' as const,
    projectId: 'project_1', configured: false, locked: false, revision: null, sha256: null, contract: null,
    sourceText: null, message: '创作合同未配置' })),
  readTextImport: vi.fn(async () => ({ schema: 'jason.qingmu-text-import-state.v1' as const, projectId: 'project_1', episodeId: 'episode_1', scriptRevision: 0, script: null, draft: null, draftActive: false })),
  createTextImport: vi.fn(async () => { throw new Error('unknown submission result') }),
  correctTextImport: vi.fn(async () => { throw new Error('unused') }),
  confirmTextImport: vi.fn(async () => { throw new Error('unused') }),
})
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('creation input and unknown-result recovery', () => {
  it('prefills the locked creation source once instead of asking for a second script entry', async () => {
    const api = port()
    api.readCreativeContract.mockResolvedValue({
      schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: true,
      locked: true, revision: 1, sha256: 'a'.repeat(64), sourceText: '场景一：雨夜\n林夏：请进。',
      contract: { schema: 'qingmu.creative-contract.v1', revision: 1, locked: true,
        source: { textSha256: 'b'.repeat(64) }, project: { mode: 'whole_series', creationType: 'original_script',
          aspectRatio: '9:16', episodeCount: 1, duration: '1-2' }, methods: {
          visualStyle: { id: 'realistic', version: 'v1', sha256: 'c'.repeat(64) },
          stylePackId: null, writingSkills: [], directorSkills: [], cameraSkills: [], soundSkills: [],
        } },
      message: '已配置',
    })
    render(<TextImportWorkspace port={api} projectId="project_1" episodeId="episode_1" onSaved={async () => {}} />)
    await waitFor(() => { expect(screen.getByLabelText<HTMLTextAreaElement>('剧本文字').value).toContain('林夏：请进。') })
    expect(screen.getByRole('status').textContent).toContain('无需重复粘贴')
    expect(api.createTextImport).not.toHaveBeenCalled()
  })
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
    fireEvent.change(screen.getByLabelText('故事 / 创作原点'), { target: { value: '雨夜里，林夏收到一封旧信。' } })
    fireEvent.click(screen.getByText('新建项目与第 1 集'))
    fireEvent.click(screen.getByText('正在确认…'))
    await screen.findByRole('alert')
    expect(api.initializeProject).toHaveBeenCalledOnce()
    first.unmount()
    render(<CreateProjectWorkspace {...props} />)
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('恢复样本')
    expect(screen.getByLabelText<HTMLTextAreaElement>('故事 / 创作原点').value).toContain('林夏')
    fireEvent.click(screen.getByText('读取创建恢复'))
    await waitFor(() =>{  expect(api.recoverProjectInitialization).toHaveBeenCalledOnce() })
    expect(api.initializeProject).toHaveBeenCalledOnce()
  })
  it('migrates an old partial browser draft without inventing a sendable intent', () => {
    localStorage.setItem('qingmu.creation.project.v1', JSON.stringify({ name: '旧草稿', aspectRatio: '16:9' }))
    const api = port()
    render(<CreateProjectWorkspace port={api} onCreated={async () => {}} />)
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('旧草稿')
    expect(screen.getByLabelText<HTMLSelectElement>('画幅').value).toBe('16:9')
    expect(screen.getByLabelText<HTMLTextAreaElement>('故事 / 创作原点').value).toBe('')
    expect(screen.queryByText('读取创建恢复')).toBeNull()
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
