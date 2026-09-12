// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReferenceVideoQuoteRequest, ReferenceVideoQuoteResponse, ReferenceVideoAsset, ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse, ReferenceVideoDraftResponse, ReferenceVideoMaterialsState, SaveReferenceVideoDraftRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { ReferenceVideoWorkspace } from '../src/client/ReferenceVideoWorkspace.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'

const assets: ReferenceVideoAsset[] = [
  { assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予', mediaType: 'reference_image', browserUrl: '', localReferenceScope: { elementKind: 'actor', targetId: 'actor_lin' } },
  { assetId: 'asset_cafe', assetSha256: 'b'.repeat(64), label: '咖啡馆', mediaType: 'reference_image', browserUrl: '', localReferenceScope: { elementKind: 'scene', targetId: 'scene_cafe' } },
  { assetId: 'asset_voice', assetSha256: 'c'.repeat(64), label: '音色', mediaType: 'reference_audio', browserUrl: '' },
]
const result = {
  body: { input: { prompt: '已编译的原文' }, parameters: { duration: 8, resolution: '720P', ratio: '16:9' } },
  referenceAudioDurationSec: 2, directorSource: null, directorSourceAligned: true,
} as ReferenceVideoPreviewResponse
function mount(options?: { initialDurationSec?: number; onRequestDirector?: () => void; directorSource?: { sha256: string; prompt: string }; configured?: boolean; configurationError?: string | null; initialMaterialStatus?: 'not_prepared' | 'unknown' | 'failed' | 'expired' | 'ready' }) {
  let server: ReferenceVideoDraftResponse = { schema: 'jason.reference-video-draft.v1', directorSource: options?.directorSource ?? null, projectId: 'p', frameId: 'f', frameSha256: 'f'.repeat(64), draft: null, mediaTypes: {}, providerCalls: 0, generationQueued: false }
  let latestMaterialStatus = options?.initialMaterialStatus ?? 'not_prepared'
  const materialState = (status = latestMaterialStatus) => ({
    schema: 'jason.reference-video-materials.v1' as const,
    projectId: 'p', frameId: 'f', draftRevision: server.draft?.revision ?? 0,
    draftRequestSha256: server.draft?.requestSha256 ?? '0'.repeat(64), model: 'wan3.0-video' as const,
    materials: (server.draft?.request.bindings ?? []).map(binding => ({
      bindingToken: binding.bindingToken, assetId: binding.assetId, assetSha256: binding.assetSha256,
      mediaType: assets.find(asset => asset.assetId === binding.assetId)?.mediaType ?? 'reference_image',
      status, expiresAt: status === 'ready' ? 1_789_000_000 : null, failureCode: status === 'failed' ? 'temporary_upload_failed' : null,
    })),
    configured: options?.configured ?? true, configurationError: options?.configured === false ? options.configurationError ?? 'credentials_missing' : null,
    allReady: status === 'ready', providerCalls: 0 as const, databaseWrites: 0 as const, generationQueued: false as const,
  })
  const port = {
    readReferenceVideoMaterials: vi.fn(async () => materialState()),
    prepareReferenceVideoMaterial: vi.fn(async (request: { assetId: string }) => {
      const previous = materialState()
      return {
        ...previous, materials: previous.materials.map(material => material.assetId === request.assetId
          ? { ...material, status: 'ready' as const, expiresAt: 1_789_000_000 } : material),
        allReady: false, uploadAttempts: 1, modelCalls: 0 as const, localStateChanged: true,
        requestId: 'material-request', assetId: request.assetId,
      }
    }),
    referenceVideoRuns: vi.fn(async () => ({ schema: 'jason.reference-video-runs.v1' as const, projectId: 'p', frameId: 'f', items: [], providerCalls: 0 as const })),
    queueReferenceVideo: vi.fn(async () => { throw new Error('not called in preview tests') }),
    referenceVideoQuote: vi.fn(async (_request: ReferenceVideoQuoteRequest, _signal?: AbortSignal) => (
      { ...quoteResponse, preview: result }
    )),
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: assets })),
    readLocalReferenceCandidateContent: vi.fn<QingmuYimengPort['readLocalReferenceCandidateContent']>(async () => ({
      schema: 'jason.qingmu-local-reference-candidate-content.v1' as const, assetId: 'asset_lin',
      sha256: 'a'.repeat(64), mimeType: 'image/png', contentBase64: 'aGVsbG8=',
    })),
    referenceVideoPreview: vi.fn(async (_request: ReferenceVideoPreviewRequest, _signal?: AbortSignal) => result),
    referenceVideoDraft: vi.fn(async (_request: { projectId: string; frameId: string }, _signal?: AbortSignal) => server),
    saveReferenceVideoDraft: vi.fn(async (request: SaveReferenceVideoDraftRequest, _signal?: AbortSignal) => {
      server = { ...server, draft: { revision: request.expectedRevision + 1, frameSha256: request.expectedFrameSha256,
        request: request.request, requestSha256: 'd'.repeat(64), savedAt: '2026-09-09T12:00:00Z' },
      mediaTypes: Object.fromEntries(request.request.bindings.map(b => [
        b.bindingToken, assets.find(a => a.assetId === b.assetId)?.mediaType ?? null,
      ])) }
      return server
    }),
  }
  const view = render(<ReferenceVideoWorkspace projectId="p" frameId="f" initialPrompt="陈远说：‘图1不应被替换。’" initialDurationSec={options?.initialDurationSec} port={port} onRequestDirector={options?.onRequestDirector} />)
  fireEvent.click(screen.getByText('精确引用 · 导演稿与候选'))
  return { port, view, setMaterialStatus: (status: typeof latestMaterialStatus) => { latestMaterialStatus = status } }
}
afterEach(cleanup)
async function chooseAll() {
  fireEvent.click(screen.getByRole('button', { name: '读取项目素材' }))
  const buttons = await screen.findAllByRole('button', { name: '加入引用' })
  buttons.forEach(button => fireEvent.click(button))
}

it('loads assets explicitly, preserves literal text and submits stable tokens after reorder', async () => {
  const { port } = mount()
  expect(port.referenceVideoAssets).not.toHaveBeenCalled()
  await chooseAll()
  const field = screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement
  field.focus(); field.setSelectionRange(0, 0); fireEvent.select(field)
  fireEvent.click(screen.getByRole('button', { name: '插入图1' }))
  fireEvent.click(screen.getByRole('button', { name: '咖啡馆前移' }))
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  const request = port.referenceVideoPreview.mock.calls[0]?.[0] as unknown as { bindings: { assetId: string }[]; promptParts: unknown[] }
  expect(request.bindings.map(b => b.assetId)).toEqual(['asset_cafe', 'asset_lin', 'asset_voice'])
  expect(request.promptParts).toEqual([{ text: '' }, { bindingToken: 'asset_lin' }, { text: '陈远说：‘图1不应被替换。’' }])
  expect(screen.getByRole('button', { name: '移除描述引用图2' })).toBeTruthy()
})

it('restores saved source tokens, literal dialogue and controls after remount', async () => {
  const { port, view } = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '插入音频1' }))
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  const saved = port.saveReferenceVideoDraft.mock.calls[0]?.[0]
  view.unmount()
  render(<ReferenceVideoWorkspace projectId="p" frameId="f" initialPrompt="另一段初始文字" port={port} />)
  fireEvent.click(screen.getByText('精确引用 · 导演稿与候选'))
  await screen.findByText('已载入草稿版本 1。')
  expect(screen.getByRole('button', { name: '保存引用草稿' }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  expect(port.referenceVideoPreview.mock.calls[0]?.[0]).toEqual({ projectId: 'p', ...saved?.request })
  expect(screen.getByRole('status').textContent).toBe('已载入草稿版本 1。')
})

it('uses the director duration for a fresh request and keeps persisted controls after remount', async () => {
  const { port, view } = mount({ initialDurationSec: 7 }); await chooseAll()
  expect(screen.getByLabelText<HTMLInputElement>('时长（秒）').value).toBe('7')
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  expect(port.saveReferenceVideoDraft.mock.calls[0]?.[0].request.parameters.duration).toBe(7)
  view.unmount()
  render(<ReferenceVideoWorkspace projectId="p" frameId="f" initialPrompt="" initialDurationSec={5} port={port} />)
  fireEvent.click(screen.getByText('精确引用 · 导演稿与候选'))
  await screen.findByText('已载入草稿版本 1。')
  expect(screen.getByLabelText<HTMLInputElement>('时长（秒）').value).toBe('7')
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  expect(port.referenceVideoPreview.mock.calls[0]?.[0].parameters.duration).toBe(7)
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})

it('does not round fractional director timing into a different creative duration', async () => {
  const { port } = mount({ initialDurationSec: 7.5 }); await chooseAll()
  expect(screen.getByLabelText<HTMLInputElement>('时长（秒）').value).toBe('7.5')
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  expect(port.referenceVideoPreview.mock.calls[0]?.[0].parameters.duration).toBe(7.5)
})

it('keeps edits made while a save is pending and advances only the saved revision', async () => {
  const { port } = mount(); await chooseAll()
  const actualSave = port.saveReferenceVideoDraft.getMockImplementation()!
  let finish!: () => Promise<void>
  port.saveReferenceVideoDraft.mockImplementationOnce((request, signal) => new Promise((resolve) => {
    finish = async () => { resolve(await actualSave(request, signal)) }
  }))
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: '保存期间新改的文字' } })
  await finish()
  await screen.findByText('上一版已保存，随后修改的内容尚未保存。')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '视频描述片段1' }).value).toBe('保存期间新改的文字')
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 2。')
  expect(port.saveReferenceVideoDraft.mock.calls[1]?.[0].expectedRevision).toBe(1)
})

it('does not overwrite editing with a late restore or silently rebase a changed shot', async () => {
  const { port } = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  const state = await port.referenceVideoDraft({ projectId: 'p', frameId: 'f' })
  let finish!: (state: ReferenceVideoDraftResponse) => void
  port.referenceVideoDraft.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '恢复已存草稿（替换当前试排）' }))
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: '后来的编辑' } })
  finish(state)
  await screen.findByText('读取期间又有编辑，已保留当前内容。需要恢复时请再点击。')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '视频描述片段1' }).value).toBe('后来的编辑')
  port.referenceVideoDraft.mockResolvedValueOnce({ ...state, frameSha256: 'e'.repeat(64) })
  fireEvent.click(screen.getByRole('button', { name: '恢复已存草稿（替换当前试排）' }))
  await screen.findByRole('button', { name: '基于当前镜头继续编辑' })
  expect(screen.getByRole('button', { name: '保存引用草稿' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '基于当前镜头继续编辑' }))
  expect(screen.getByRole('button', { name: '保存引用草稿' }).hasAttribute('disabled')).toBe(false)
})

it('clears a successful preview on edits and prevents a dangling reference', async () => {
  const { port } = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '插入图1' }))
  fireEvent.click(screen.getByRole('button', { name: '移除林予' }))
  expect(screen.getByRole('alert').textContent).toContain('先移除描述')
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: '新描述' } })
  expect(screen.queryByRole('region', { name: '阿里请求预览' })).toBeNull()
  expect(port.referenceVideoPreview).toHaveBeenCalledTimes(1)
})

it('aborts a pending preview on edit and ignores its late result', async () => {
  const { port } = mount(); await chooseAll()
  let resolve!: (value: ReferenceVideoPreviewResponse) => void
  port.referenceVideoPreview.mockImplementation(() => new Promise((done) => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: '后来的描述' } })
  resolve(result)
  await waitFor(() => { expect(screen.getByRole('button', { name: '预览实际请求' }).hasAttribute('disabled')).toBe(false) })
  expect(screen.queryByRole('region', { name: '阿里请求预览' })).toBeNull()
})


it('prices only saved current edits and clears the quote when duration changes', async () => {
  const { port } = mount(); await chooseAll()
  const quote = () => screen.getByRole('button', { name: '估算已存草稿费用' })
  expect(quote().hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  fireEvent.click(quote())
  await screen.findByText(/目录价估算 ¥4.80/u)
  expect(port.referenceVideoQuote.mock.calls[0]?.[0].draftRevision).toBe(1)
  expect(port.referenceVideoQuote.mock.calls[0]?.[0].parameters.duration).toBe(8)
  fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '12' } })
  expect(screen.queryByText(/目录价估算/u)).toBeNull()
  expect(quote().hasAttribute('disabled')).toBe(true)
  expect(port.referenceVideoPreview).not.toHaveBeenCalled()
})

it('ignores a late quote after editing the source', async () => {
  const { port } = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  let finish!: (value: ReferenceVideoQuoteResponse) => void
  port.referenceVideoQuote.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '估算已存草稿费用' }))
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: 'new action' } })
  finish({ ...quoteResponse, preview: result })
  await waitFor(() => { expect(screen.getByRole('button', { name: '预览实际请求' }).hasAttribute('disabled')).toBe(false) })
  expect(screen.queryByText(/目录价估算/u)).toBeNull()
})


it('reads one private original only after an explicit inspection and keeps its owner scope private', async () => {
  const { port } = mount()
  fireEvent.click(screen.getByRole('button', { name: '读取项目素材' }))
  await screen.findByText('林予')
  expect(port.readLocalReferenceCandidateContent).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: '查看原图' })[0]!)
  const preview = await screen.findByRole('img', { name: '林予 私有原图' })
  expect(preview.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
  expect(port.readLocalReferenceCandidateContent).toHaveBeenCalledWith({
    projectId: 'p', elementKind: 'actor', targetId: 'actor_lin', assetId: 'asset_lin', expectedSha256: 'a'.repeat(64),
  }, expect.any(AbortSignal))
})

it('aborts a previous private original read when the user inspects another image', async () => {
  const { port } = mount()
  fireEvent.click(screen.getByRole('button', { name: '读取项目素材' }))
  await screen.findByText('林予')
  let firstSignal: AbortSignal | undefined
  port.readLocalReferenceCandidateContent.mockImplementationOnce((_request, signal) => new Promise<never>(() => {
    firstSignal = signal
  }))
  const inspect = await screen.findAllByRole('button', { name: '查看原图' })
  fireEvent.click(inspect[0]!)
  fireEvent.click(inspect[1]!)
  await waitFor(() => { expect(firstSignal?.aborted).toBe(true) })
  expect(port.readLocalReferenceCandidateContent).toHaveBeenCalledTimes(2)
})

it('does not offer a private preview for a restored binding when the current catalog SHA differs', async () => {
  const { port } = mount()
  const oldBinding = { assetId: 'asset_lin', assetSha256: 'f'.repeat(64), label: '旧版林予', bindingToken: 'old-lin' }
  const server = await port.referenceVideoDraft({ projectId: 'p', frameId: 'f' })
  port.referenceVideoDraft.mockResolvedValue({ ...server, draft: {
    revision: 1, frameSha256: server.frameSha256, requestSha256: 'd'.repeat(64), savedAt: '2026-09-10T00:00:00Z',
    request: { frameId: 'f', model: 'wan3.0-video', bindings: [oldBinding], promptParts: [{ text: '旧版' }],
      parameters: { duration: 8, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false } },
  }, mediaTypes: { 'old-lin': 'reference_image' } })
  fireEvent.click(screen.getByRole('button', { name: '恢复已存草稿（替换当前试排）' }))
  await screen.findByText('已恢复草稿版本 1。')
  fireEvent.click(screen.getByRole('button', { name: '读取项目素材' }))
  await screen.findByText('林予')
  expect(screen.queryByRole('button', { name: '查看图1' })).toBeNull()
  expect(screen.getByText('读取项目素材后可查看原图')).toBeTruthy()
  expect((screen.getAllByRole('button', { name: '加入引用' })[0] as HTMLButtonElement).disabled).toBe(true)
  expect(port.readLocalReferenceCandidateContent).not.toHaveBeenCalled()
})

it('keeps single director text spacious while compacting only short text around bindings', async () => {
  mount()
  const initial = screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement
  expect(initial.rows).toBe(6)
  await chooseAll()
  initial.focus(); initial.setSelectionRange(0, 0); fireEvent.select(initial)
  fireEvent.click(screen.getByRole('button', { name: '插入图1' }))
  const segmented = screen.getAllByRole('textbox').filter((field): field is HTMLTextAreaElement => field instanceof HTMLTextAreaElement)
  expect(segmented.map(field => field.rows)).toEqual([1, 1])
  fireEvent.change(segmented[1]!, { target: { value: '这是一段足够长的导演动作描述，用于验证引用之后的正文仍保留可读编辑高度，而不是被压缩为短连接词。' } })
  const updated = screen.getAllByRole('textbox').filter((field): field is HTMLTextAreaElement => field instanceof HTMLTextAreaElement)
  expect(updated[1]!.rows).toBe(4)
})


it('prepares one saved material explicitly and never turns a local save into provider readiness', async () => {
  const { port } = mount(); await chooseAll()
  expect(screen.getByRole('region', { name: '准备引用素材' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  expect((await screen.findAllByText('尚未准备')).length).toBe(3)
  expect(port.prepareReferenceVideoMaterial).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '准备图1' }))
  expect((await screen.findAllByText(/已准备，至/u)).length).toBe(1)
  expect(port.prepareReferenceVideoMaterial).toHaveBeenCalledWith(expect.objectContaining({
    projectId: 'p', frameId: 'f', assetId: 'asset_lin', expectedRevision: 1,
    expectedRequestSha256: 'd'.repeat(64),
  }), expect.any(AbortSignal))
  expect(port.referenceVideoPreview).not.toHaveBeenCalled()
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})

it('reads an unknown upload receipt instead of silently retrying it', async () => {
  const { port } = mount({ initialMaterialStatus: 'unknown' }); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  expect((await screen.findAllByText('上传结果待确认')).length).toBe(3)
  expect(screen.queryByRole('button', { name: '重试准备图1' })).toBeNull()
  expect(screen.getAllByText('请读取准备状态确认回执；不会自动重传。').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '读取准备状态' }))
  await waitFor(() => { expect(port.readReferenceVideoMaterials).toHaveBeenCalledTimes(2) })
  expect(port.prepareReferenceVideoMaterial).not.toHaveBeenCalled()
})

it('keeps the existing request preview available when temporary material upload is not configured', async () => {
  const { port } = mount({ configured: false }); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('请配置阿里凭据后再准备素材。')
  expect(screen.queryByRole('button', { name: '准备图1' })).toBeNull()
  const preview = screen.getByRole('button', { name: '预览实际请求' })
  expect(preview.hasAttribute('disabled')).toBe(false)
  fireEvent.click(preview)
  await screen.findByRole('region', { name: '阿里请求预览' })
  expect(port.prepareReferenceVideoMaterial).not.toHaveBeenCalled()
})


it('marks an interrupted prepare as unknown and requires an explicit receipt read before any retry', async () => {
  const { port } = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findAllByText('尚未准备')
  port.prepareReferenceVideoMaterial.mockRejectedValueOnce(new Error('连接中断'))
  fireEvent.click(screen.getByRole('button', { name: '准备图1' }))
  await screen.findByText('上传结果待确认')
  expect(screen.queryByRole('button', { name: '准备图1' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('请读取素材状态确认')
  expect(port.prepareReferenceVideoMaterial).toHaveBeenCalledTimes(1)
})


it('after a lost prepare response, refresh reads the same saved scope and never creates a new upload request', async () => {
  const h = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findAllByText('尚未准备')
  h.port.prepareReferenceVideoMaterial.mockRejectedValueOnce(new Error('客户端断线'))
  fireEvent.click(screen.getByRole('button', { name: '准备图1' }))
  await screen.findByText('上传结果待确认')
  h.setMaterialStatus('unknown')
  h.view.unmount()
  render(<ReferenceVideoWorkspace projectId="p" frameId="f" initialPrompt="陈远说：‘图1不应被替换。’" port={h.port} />)
  fireEvent.click(screen.getByText('精确引用 · 导演稿与候选'))
  fireEvent.click(screen.getByRole('button', { name: '恢复已存草稿（替换当前试排）' }))
  expect((await screen.findAllByText('上传结果待确认')).length).toBe(3)
  expect(screen.queryByRole('button', { name: '准备图1' })).toBeNull()
  expect(h.port.prepareReferenceVideoMaterial).toHaveBeenCalledTimes(1)
})


it('maps temporary upload configuration codes to an actionable Chinese message', async () => {
  mount({ configured: false, configurationError: 'reference_video_upload_endpoint_unsupported' })
  await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('当前阿里连接尚未开通临时素材访问。')
  expect(screen.queryByText('reference_video_upload_endpoint_unsupported')).toBeNull()
})

it('does not let a delayed material read overwrite a newer preparation receipt', async () => {
  const h = mount(); await chooseAll()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findAllByText('尚未准备')
  const originalRead = h.port.readReferenceVideoMaterials.getMockImplementation()
  let resolveOldRead: ((value: ReferenceVideoMaterialsState) => void) | undefined
  const oldRead = new Promise<ReferenceVideoMaterialsState>((resolve) => { resolveOldRead = resolve })
  h.port.readReferenceVideoMaterials.mockImplementationOnce((async () => oldRead) as never)
  fireEvent.click(screen.getByRole('button', { name: '读取准备状态' }))
  await waitFor(() => { expect(h.port.readReferenceVideoMaterials).toHaveBeenCalledTimes(2) })
  fireEvent.click(screen.getByRole('button', { name: '准备图1' }))
  await screen.findByText(/已准备，至/u)
  expect(screen.getByRole('button', { name: '读取准备状态' }).hasAttribute('disabled')).toBe(false)
  resolveOldRead!(await originalRead!())
  await waitFor(() => { expect(screen.getAllByText(/已准备，至/u)).toHaveLength(1) })
  expect((await screen.findAllByText('尚未准备')).length).toBe(2)
})

it('keeps a disabled-generation quote readable while the submission control stays unavailable', async () => {
  const { port } = mount(); await chooseAll()
  port.referenceVideoQuote.mockResolvedValue({ ...quoteResponse, preview: result, generationSubmissionEnabled: false })
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  fireEvent.click(screen.getByRole('button', { name: '估算已存草稿费用' }))
  await screen.findByText(/当前实例未启用付费生成，估算仅供核对。/u)
  expect(screen.getByRole('button', { name: '当前实例未启用付费生成' }).hasAttribute('disabled')).toBe(true)
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})


it('shows the current design without silently rewriting or blessing an old prompt', async () => {
  const directorSource = { sha256: 'b'.repeat(64), prompt: '切手部特写，再切女方近景；低声郑重，女方嗯一声。' }
  const { port } = mount({ directorSource }); await chooseAll()
  expect(await screen.findByText(directorSource.prompt)).toBeTruthy()
  const acknowledgement = screen.getByRole('checkbox', { name: /我已对照当前设计整理生成稿/u })
  expect((acknowledgement as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  expect(port.saveReferenceVideoDraft.mock.calls[0]?.[0].request.directorSourceSha256).toBeUndefined()
  const field = screen.getByRole('textbox', { name: '视频描述片段1' })
  fireEvent.change(field, { target: { value: directorSource.prompt } })
  fireEvent.click(acknowledgement)
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 2。')
  expect(port.saveReferenceVideoDraft.mock.calls[1]?.[0].request).toMatchObject({
    directorSourceSha256: directorSource.sha256, promptParts: [{ text: directorSource.prompt }],
  })
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})

it('hands a saved draft to the director without appending or marking conflicting directions as reconciled', async () => {
  const directorSource = { sha256: 'b'.repeat(64), prompt: '从双人全景推至侧面中景；插头仍未接通。' }
  const onRequestDirector = vi.fn()
  const { port } = mount({ directorSource, onRequestDirector }); await chooseAll()
  const field = screen.getByRole('textbox', { name: '视频描述片段1' })
  fireEvent.change(field, { target: { value: '旧稿：固定机位，电器已启动。' } })
  expect(screen.queryByRole('button', { name: '加入完整导演设计' })).toBeNull()
  const handoff = screen.getByRole('button', { name: '展开导演助手' })
  expect(handoff.hasAttribute('disabled')).toBe(true)
  fireEvent.click(handoff)
  expect(onRequestDirector).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  fireEvent.click(handoff)
  expect(onRequestDirector).toHaveBeenCalledOnce()
  expect(port.saveReferenceVideoDraft).toHaveBeenCalledOnce()
  expect(port.saveReferenceVideoDraft.mock.calls[0]?.[0].request.promptParts).toEqual([{ text: '旧稿：固定机位，电器已启动。' }])
  expect(port.saveReferenceVideoDraft.mock.calls[0]?.[0].request.directorSourceSha256).toBeUndefined()
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
})
