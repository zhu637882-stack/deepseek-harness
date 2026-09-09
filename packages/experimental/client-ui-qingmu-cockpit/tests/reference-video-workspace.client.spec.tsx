// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReferenceVideoAsset, ReferenceVideoPreviewResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
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
  const port = {
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: assets })),
    referenceVideoPreview: vi.fn(async () => result),
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
