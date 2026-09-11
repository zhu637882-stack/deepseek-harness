// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CreationOptions, CreativeContractState, TextImportState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { CreateProjectWorkspace, TextImportWorkspace } from '../src/client/CreationWorkspace.tsx'

const port = () => ({ initializeProject: vi.fn(async () => { throw new Error('unknown submission result') }),
  readCreationOptions: vi.fn(async (): Promise<CreationOptions> => ({ schema: 'jason.qingmu-creation-options.v1',
    textVersions: [{ id: 'creation-text-v1', label: '当前输入文本', available: true }],
    visualStyles: [{ id: 'realistic', label: '现代写实', group: 'real_person', groupLabel: '真人', previewUrl: '/api/qingmu/creation-style-preview?styleId=realistic' },
      { id: 'donghua', label: '国漫', group: '2d', groupLabel: '2D', previewUrl: null }],
    stylePacks: [{ id: 'sp_cafe', version: '1', name: '暖光电影', group: 'real_person', groupLabel: '真人写实', intent: '暖光室内', tone: '温暖克制' },
      { id: 'sp_2d', version: '1', name: '霓虹国漫', group: '2d', groupLabel: '2D', intent: '霓虹城市', tone: '明快' }],
    directorSkills: [
      { id: 'episode_dramaturgy_architect', version: '1', sha256: 'b'.repeat(64), stage: 'story_episode', available: false, disabledReason: '由剧集阶段处理' },
      { id: 'scene_dialogue_writer', version: '1', sha256: 'c'.repeat(64), stage: 'script', available: false, disabledReason: '由剧本阶段处理' },
      { id: 'shot_blocking_director', version: '1', sha256: 'a'.repeat(64), stage: 'shot_plan', available: true, disabledReason: null },
      { id: 'audio_ownership_planner', version: '1', sha256: 'd'.repeat(64), stage: 'audio_plan', available: false, disabledReason: '由声音阶段处理' },
      { id: 'sequence_creative_qa', version: '1', sha256: 'e'.repeat(64), stage: 'creative_qa', available: false, disabledReason: '由质检阶段处理' },
    ],
  })),
  recoverProjectInitialization: vi.fn(async () => { throw new Error('404 bootstrap_receipt_not_found') }),
  readCreativeContract: vi.fn(async (): Promise<CreativeContractState> => ({ schema: 'jason.qingmu-creative-contract-state.v1' as const,
    projectId: 'project_1', configured: false, locked: false, revision: null, sha256: null, contract: null,
    sourceText: null, message: '创作合同未配置' })),
  readTextImport: vi.fn(async (): Promise<TextImportState> => ({ schema: 'jason.qingmu-text-import-state.v1' as const, projectId: 'project_1', episodeId: 'episode_1', scriptRevision: 0, script: null, draft: null, draftActive: false })),
  createTextImport: vi.fn(async () => { throw new Error('unknown submission result') }),
  correctTextImport: vi.fn(async () => { throw new Error('unused') }),
  confirmTextImport: vi.fn(async () => { throw new Error('unused') }),
})
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function selectCreationMethods() {
  await screen.findByRole('option', { name: '镜头导演' })
  fireEvent.change(screen.getByRole('combobox', { name: '基础画风' }), { target: { value: 'realistic' } })
  fireEvent.change(screen.getByRole('combobox', { name: '全片风格包' }), { target: { value: 'sp_cafe' } })
  fireEvent.change(screen.getByRole('combobox', { name: '导演方法' }), { target: { value: 'shot_blocking_director' } })
}
describe('creation input and unknown-result recovery', () => {
  it('shows the selected Host thumbnail, stage map, and only compatible style packs', async () => {
    const api = port()
    render(<CreateProjectWorkspace port={api} onCreated={async () => {}} />)
    await screen.findByRole('option', { name: '镜头导演' })
    fireEvent.change(screen.getByRole('combobox', { name: '基础画风' }), { target: { value: 'realistic' } })
    expect(screen.getByRole('img', { name: '现代写实 画风缩略图' }).getAttribute('src')).toBe('/api/qingmu/creation-style-preview?styleId=realistic')
    expect(screen.getByRole('option', { name: '真人写实 · 暖光电影' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '2D · 霓虹国漫' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '全片风格包' }), { target: { value: 'sp_cafe' } })
    fireEvent.change(screen.getByRole('combobox', { name: '基础画风' }), { target: { value: 'donghua' } })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '全片风格包' }).value).toBe('')
    expect(screen.getByText('声音归属规划')).toBeTruthy()
    expect(screen.getByText('序列创意质检')).toBeTruthy()
  })
  it('shows an image wall before selection and restores the exact card choice', async () => {
    const api = port()
    const props = { port: api, onCreated: async () => {} }
    const view = render(<CreateProjectWorkspace {...props} />)
    const card = await screen.findByRole('button', { name: '选择画风：现代写实' })
    expect(screen.getByRole('img', { name: '现代写实 画风缩略图' })).toBeTruthy()
    fireEvent.click(card)
    expect(card.getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByRole('combobox', { name: '全片风格包' }), { target: { value: 'sp_cafe' } })
    fireEvent.click(screen.getByRole('button', { name: '2D', exact: true }))
    expect(screen.queryByRole('button', { name: '选择画风：现代写实' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择画风：国漫' }))
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '全片风格包' }).value).toBe('')
    view.unmount()
    render(<CreateProjectWorkspace {...props} />)
    expect((await screen.findByRole('button', { name: '选择画风：国漫' })).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索画风' }), { target: { value: '没有这样的画风' } })
    expect(screen.getByText('没有匹配的画风，请调整关键词或分类。')).toBeTruthy()
    expect(api.initializeProject).not.toHaveBeenCalled()
  })
  it('does not invent creation methods when the real catalog is unavailable', async () => {
    const api = port()
    api.readCreationOptions.mockRejectedValue(new Error('catalog unavailable'))
    render(<CreateProjectWorkspace port={api} onCreated={async () => {}} />)
    await screen.findByRole('button', { name: '重新读取创作选项' })
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '咖啡馆' } })
    fireEvent.change(screen.getByLabelText('故事 / 创作原点'), { target: { value: '两人重听旧声。' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '新建项目与第 1 集' }).disabled).toBe(true)
    expect(api.initializeProject).not.toHaveBeenCalled()
  })
  it('recovers a legacy intent by its original hash before allowing explicit method reconfiguration', async () => {
    const settings = { aspectRatio: '16:9', creationType: 'original_script', duration: '24秒', episodeCount: 1,
      mode: 'whole_series', name: '咖啡馆', style: 'realistic', stylePackId: null, textInput: '两人重听旧声。' }
    localStorage.setItem('qingmu.creation.project.v1', JSON.stringify({ ...settings, intent: { ...settings, idempotencyKey: 'legacy-intent-1' } }))
    const api = port()
    render(<CreateProjectWorkspace port={api} onCreated={async () => {}} />)
    expect(screen.queryByRole('button', { name: '保留输入，更新创作设定' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '读取创建恢复' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留输入，更新创作设定' }))
    expect(api.recoverProjectInitialization).toHaveBeenCalledWith({ idempotencyKey: 'legacy-intent-1',
      requestSha256: createHash('sha256').update(JSON.stringify(settings)).digest('hex') })
    expect(screen.getByLabelText<HTMLTextAreaElement>('故事 / 创作原点').value).toBe(settings.textInput)
    expect(api.initializeProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '读取创建恢复' })).toBeNull()
  })
  it('offers storyboard planning only from the saved script, without submitting another import', async () => {
    const api = port()
    const onPlanStoryboard = vi.fn()
    render(<TextImportWorkspace port={api} projectId="project_1" episodeId="episode_1"
      onSaved={async () => {}} onPlanStoryboard={onPlanStoryboard} />)
    await waitFor(() => { expect(api.readTextImport).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('button', { name: '开始规划分镜 →' })).toBeNull()
    api.readTextImport.mockResolvedValue({ schema: 'jason.qingmu-text-import-state.v1', projectId: 'project_1',
      episodeId: 'episode_1', scriptRevision: 1, script: { scenes: [{ title: '夜晚咖啡馆' }] }, draft: null, draftActive: false })
    fireEvent.click(screen.getByRole('button', { name: '读取恢复 / 刷新预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始规划分镜 →' }))
    expect(onPlanStoryboard).toHaveBeenCalledOnce()
    expect(api.createTextImport).not.toHaveBeenCalled()
    expect(api.confirmTextImport).not.toHaveBeenCalled()
  })
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
    await selectCreationMethods()
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '恢复样本' } })
    fireEvent.change(screen.getByLabelText('故事 / 创作原点'), { target: { value: '雨夜里，林夏收到一封旧信。' } })
    fireEvent.click(screen.getByText('新建项目与第 1 集'))
    fireEvent.click(screen.getByText('正在确认…'))
    await screen.findByRole('alert')
    expect(api.initializeProject).toHaveBeenCalledOnce()
    expect(api.initializeProject).toHaveBeenCalledWith(expect.objectContaining({ textVersion: 'creation-text-v1',
      style: 'realistic', stylePackId: 'sp_cafe', directorSkillIds: ['shot_blocking_director'] }))
    first.unmount()
    render(<CreateProjectWorkspace {...props} />)
    expect(screen.getByLabelText<HTMLInputElement>('项目名称').value).toBe('恢复样本')
    expect(screen.getByLabelText<HTMLTextAreaElement>('故事 / 创作原点').value).toContain('林夏')
    fireEvent.click(screen.getByText('读取创建恢复'))
    await waitFor(() =>{  expect(api.recoverProjectInitialization).toHaveBeenCalledOnce() })
    expect(api.initializeProject).toHaveBeenCalledOnce()
  })
  it('migrates an old partial browser draft without inventing a sendable intent', async () => {
    localStorage.setItem('qingmu.creation.project.v1', JSON.stringify({ name: '旧草稿', aspectRatio: '16:9' }))
    const api = port()
    render(<CreateProjectWorkspace port={api} onCreated={async () => {}} />)
    await waitFor(() => { expect(api.readCreationOptions).toHaveBeenCalledOnce() })
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
