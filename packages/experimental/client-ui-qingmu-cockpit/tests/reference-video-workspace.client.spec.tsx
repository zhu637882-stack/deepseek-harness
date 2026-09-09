// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReferenceVideoQuoteRequest, ReferenceVideoQuoteResponse, ReferenceVideoAsset, ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse, ReferenceVideoDraftResponse, SaveReferenceVideoDraftRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { ReferenceVideoWorkspace } from '../src/client/ReferenceVideoWorkspace.tsx'

const assets: ReferenceVideoAsset[] = [
  { assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予', mediaType: 'reference_image', browserUrl: '' },
  { assetId: 'asset_cafe', assetSha256: 'b'.repeat(64), label: '咖啡馆', mediaType: 'reference_image', browserUrl: '' },
  { assetId: 'asset_voice', assetSha256: 'c'.repeat(64), label: '音色', mediaType: 'reference_audio', browserUrl: '' },
]
const result = {
  body: { input: { prompt: '已编译的原文' }, parameters: { duration: 8, resolution: '720P', ratio: '16:9' } },
  referenceAudioDurationSec: 2,
} as ReferenceVideoPreviewResponse
function mount() {
  let server: ReferenceVideoDraftResponse = { schema: 'jason.reference-video-draft.v1', projectId: 'p', frameId: 'f', frameSha256: 'f'.repeat(64), draft: null, mediaTypes: {}, providerCalls: 0, generationQueued: false }
  const port = {
    referenceVideoQuote: vi.fn(async (_request: ReferenceVideoQuoteRequest, _signal?: AbortSignal) => (
      { ...quoteResponse, preview: result } as ReferenceVideoQuoteResponse
    )),
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: assets })),
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
  const view = render(<ReferenceVideoWorkspace projectId="p" frameId="f" initialPrompt="陈远说：‘图1不应被替换。’" port={port} />)
  fireEvent.click(screen.getByText('精确引用 · 阿里视频预览'))
  return { port, view }
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
  fireEvent.click(screen.getByText('精确引用 · 阿里视频预览'))
  await screen.findByText('此镜头有已存草稿，可恢复后继续编辑。')
  expect(screen.getByRole('button', { name: '保存引用草稿' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '恢复已存草稿（替换当前试排）' }))
  await screen.findByText('已恢复草稿版本 1。')
  fireEvent.click(screen.getByRole('button', { name: '预览实际请求' }))
  await screen.findByRole('region', { name: '阿里请求预览' })
  expect(port.referenceVideoPreview.mock.calls[0]?.[0]).toEqual({ projectId: 'p', ...saved?.request })
  expect(screen.getByRole('status').textContent).toBe('已恢复草稿版本 1。')
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
  expect((screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement).value).toBe('保存期间新改的文字')
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
  expect((screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement).value).toBe('后来的编辑')
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
  finish({ ...quoteResponse, preview: result } as ReferenceVideoQuoteResponse)
  await waitFor(() => { expect(screen.getByRole('button', { name: '预览实际请求' }).hasAttribute('disabled')).toBe(false) })
  expect(screen.queryByText(/目录价估算/u)).toBeNull()
})
