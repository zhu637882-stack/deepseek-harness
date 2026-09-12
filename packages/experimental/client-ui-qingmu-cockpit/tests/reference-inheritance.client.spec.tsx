// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReferenceVideoDraftResponse, ReferenceVideoPreviewRequest, SaveReferenceVideoDraftRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { savedDraft, videoReferenceFixture } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { inheritReferenceBindings } from '../src/client/reference-draft-inheritance.ts'
import { ReferenceVideoWorkspace } from '../src/client/ReferenceVideoWorkspace.tsx'

afterEach(cleanup)
const source = savedDraft as unknown as ReferenceVideoDraftResponse
const current: ReferenceVideoDraftResponse = { ...source, frameId: 'second', draft: null, mediaTypes: {} }
function mount() {
  const onDirty = vi.fn()
  const port = {
    referenceVideoDraft: vi.fn(async (input: { frameId: string }, _signal?: AbortSignal) => input.frameId === 'f' ? source : current),
    referenceVideoPreview: vi.fn(async (_input: ReferenceVideoPreviewRequest) => { throw new Error('No preview in this test') }),
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: [] })),
    readLocalReferenceCandidateContent: vi.fn(async () => { throw new Error('No private read in inheritance test') }),
    referenceVideoRuns: vi.fn(async () => ({ schema: 'jason.reference-video-runs.v1' as const,
      projectId: 'p', frameId: 'second', items: [], providerCalls: 0 as const })),
    referenceVideoQuote: vi.fn(async () => { throw new Error('No quote in this test') }),
    queueReferenceVideo: vi.fn(async () => { throw new Error('No generation in this test') }),
    saveReferenceVideoDraft: vi.fn(async (input: SaveReferenceVideoDraftRequest) => ({ ...current,
      draft: { revision: 1, request: input.request, frameSha256: current.frameSha256,
        requestSha256: 'd'.repeat(64), savedAt: '2026-09-09T12:00:00Z' }, mediaTypes: source.mediaTypes })),
  }
  const view = render(<ReferenceVideoWorkspace projectId="p" frameId="second" initialPrompt="陈远：听完，再决定走不走。"
    initialOpen shotLabel="镜 02" referenceSources={[{ frameId: 'f', label: '镜 01' }]} onUnsavedChange={onDirty} port={port} />)
  return { port, view, onDirty }
}

it('inherits references into a second shot without copying its dialogue or model parameters, then saves only the target', async () => {
  const h = mount()
  fireEvent.change(screen.getByRole('spinbutton', { name: '时长（秒）' }), { target: { value: '6' } })
  fireEvent.click(screen.getByRole('button', { name: '沿用引用' }))
  await screen.findByText('已沿用镜 01 的 3 项引用；本镜文字和参数保留，尚未保存。')
  expect((screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement).value).toBe('陈远：听完，再决定走不走。')
  expect(h.port.saveReferenceVideoDraft).not.toHaveBeenCalled()
  expect(h.port.referenceVideoQuote).not.toHaveBeenCalled()
  expect(h.port.queueReferenceVideo).not.toHaveBeenCalled()
  expect(h.onDirty).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '保存引用草稿' }))
  await screen.findByText('已保存草稿版本 1。')
  expect(h.port.saveReferenceVideoDraft).toHaveBeenCalledWith(expect.objectContaining({
    projectId: 'p', frameId: 'second', expectedRevision: 0,
    request: expect.objectContaining({ frameId: 'second', bindings: savedDraft.draft.request.bindings,
      promptParts: [{ text: '陈远：听完，再决定走不走。' }], parameters: expect.objectContaining({ duration: 6 }) }),
  }), expect.any(AbortSignal))
  await waitFor(() => expect(h.onDirty).toHaveBeenLastCalledWith(false))
})

it('preserves a manual edit made while source references are loading', async () => {
  const h = mount()
  await screen.findByText('尚无已存草稿。')
  let finish!: (value: ReferenceVideoDraftResponse) => void
  h.port.referenceVideoDraft.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '沿用引用' }))
  fireEvent.change(screen.getByRole('textbox', { name: '视频描述片段1' }), { target: { value: '她接稳后，他才松手。' } })
  finish(source)
  expect((await screen.findByRole('alert')).textContent).toContain('读取期间已有新的编辑')
  expect(screen.queryByRole('list', { name: '引用顺序' })).toBeNull()
  expect((screen.getByRole('textbox', { name: '视频描述片段1' }) as HTMLTextAreaElement).value).toBe('她接稳后，他才松手。')
})

it('aborts inheritance on unmount so a late response cannot dirty another shot', async () => {
  const h = mount()
  await screen.findByText('尚无已存草稿。')
  let finish!: (value: ReferenceVideoDraftResponse) => void
  h.port.referenceVideoDraft.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '沿用引用' }))
  const signal = h.port.referenceVideoDraft.mock.calls.at(-1)?.[1]
  h.view.unmount(); finish(source)
  expect(signal?.aborted).toBe(true)
  expect(h.onDirty).toHaveBeenLastCalledWith(false)
})

it('keeps existing order, labels and tokens when the same asset is already referenced', () => {
  const binding = savedDraft.draft.request.bindings[0]!
  const existing = { ...binding, bindingToken: 'own-lin', label: '本镜保留名称', mediaType: 'reference_image' as const }
  const merged = inheritReferenceBindings([existing], source)
  expect(merged[0]).toBe(existing)
  expect(merged).toHaveLength(3)
  expect(merged.filter(item => item.assetId === existing.assetId)).toHaveLength(1)
})

it('rejects conflicting tokens, asset versions and unavailable source media without changing existing references', () => {
  const binding = savedDraft.draft.request.bindings[0]!
  const existing = { ...binding, mediaType: 'reference_image' as const }
  for (const conflict of [{ ...existing, assetId: 'different' }, { ...existing, assetSha256: '0'.repeat(64) }]) {
    const before = structuredClone(conflict)
    expect(() => inheritReferenceBindings([conflict], source)).toThrow()
    expect(conflict).toEqual(before)
  }
  expect(() => inheritReferenceBindings([], { ...source, mediaTypes: { ...source.mediaTypes, lin: null } })).toThrow('来源已失效')
  expect(() => inheritReferenceBindings([], { ...source, draft: null })).toThrow('没有已保存的引用')
})

it('inherits video identity and enforces the combined video count', () => {
  const videoSource = videoReferenceFixture().savedDraft as unknown as ReferenceVideoDraftResponse
  const merged = inheritReferenceBindings([], videoSource)
  expect(merged.find(item => item.bindingToken === 'previous')).toMatchObject({ mediaType: 'reference_video' })
  const existing = Array.from({ length: 5 }, (_, i) => ({
    bindingToken: `video_${String(i)}`, assetId: `clip_${String(i)}`, assetSha256: 'a'.repeat(64),
    label: `Clip ${String(i)}`, mediaType: 'reference_video' as const,
  }))
  expect(() => inheritReferenceBindings(existing, videoSource)).toThrow('5 段视频')
})
