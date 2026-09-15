// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { ReferenceVideoBatch } from '../src/client/ReferenceVideoBatch.tsx'
import type { BatchPort } from '../src/client/reference-video-batch.ts'
import { request, quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
beforeEach(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, _options: unknown, action: (lock: object) => Promise<void>) => action({}) } }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear() })

it('keeps an opened batch panel open when refreshed ports load completed shots again', async () => {
  const readScenePlanning = vi.fn(async () => ({ projectId: 'p', episodeId: 'e', storyboard: null }))
  const port = {
    readScenePlanning, referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async () => ({ items: [{ publicStatus: 'succeeded', candidates: [] }] }),
  } as unknown as BatchPort
  const props = { projectId: 'p', episodeId: 'e', aspectRatio: '16:9', onOpenShot: vi.fn(),
    relations: { projectId: 'p', shots: [{ shotId: 'f', frameNo: 1, durationSec: 4 }] } as never }
  const view = render(<ReferenceVideoBatch {...props} port={port} />)
  await waitFor(() => { expect(readScenePlanning).toHaveBeenCalledTimes(1) })
  const panel = screen.getByLabelText('整集批量生成') as HTMLDetailsElement
  panel.open = true
  fireEvent(panel, new Event('toggle'))
  view.rerender(<ReferenceVideoBatch {...props} port={{ ...port }} />)
  await waitFor(() => { expect(readScenePlanning).toHaveBeenCalledTimes(2) })
  expect(panel.open).toBe(true)
})

it('adopts source repairs through the existing batch button before saving the refreshed execution draft', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const events: string[] = []
  let version = 1, saved: unknown = null
  const directorSource = () => ({ sha256: `${version}`.repeat(64), generationPrompt: `Saved camera ${version}`, executionSuffix: '本镜逐字对白：请。' })
  const frame = () => ({ projectId: 'p', frameId: 'f', frameSha256: `${version}`.repeat(64), draft: saved, directorSource: directorSource() })
  const storyboard = () => ({ id: `v${version}`, version, sourceHash: `${version}`.repeat(64), status: 'Ready' })
  const repair = { frameId: 'f', directorPlan: { blocking: '同一院内，演员位置与机位协调。' }, imagePromptCn: '院内起始画面。' }
  const proposal = JSON.stringify({ directorRepairs: [repair], shots: [{ frameId: 'f', executionPrompt: '0–8秒先放杯，再转身说第一句。',
    references: [{ assetId: 'asset_lin', assetLabel: '林予', purpose: '人物外观' }], parameters: request.parameters }] })
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's'.repeat(64), storyboard: storyboard(),
      canonicalStoryboard: { origin: 'automatic' }, frameRequirements: [{ id: 'f' }] }),
    recoverScenePlanning: async () => { throw new Error('HTTP 404: planning_receipt_not_found') },
    saveScenePlanning: vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
      events.push('repair'); version++
      return { action: 'edit_automatic', projectId: 'p', episodeId: 'e', shotId: 'f', idempotencyKey, storyboard: storyboard() }
    }),
    referenceVideoAssets: async () => ({ pages: 1, items: [{ assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予', mediaType: 'reference_image' }] }),
    referenceVideoDraft: async () => frame(), referenceVideoRuns: async () => ({ items: [] }),
    saveReferenceVideoDraft: vi.fn(async ({ request: draft }: { request: Record<string, unknown> }) => {
      events.push('draft'); expect(draft.directorSourceSha256).toBe('2'.repeat(64))
      saved = { revision: 1, frameSha256: '2'.repeat(64), requestSha256: 'd'.repeat(64), request: draft }
      return frame()
    }),
    readReferenceVideoMaterials: async () => ({ configured: true, allReady: true, materials: [] }),
    referenceVideoQuote: async () => { events.push('quote'); return { ...quoteResponse, generationSubmissionEnabled: true } },
    queueReferenceVideo: vi.fn(),
  }
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 1, running: false, finished: true, text: proposal, script: proposal, error: '' })) }
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port as unknown as BatchPort} storyPort={storyPort}
    onOpenShot={vi.fn()} relations={{ projectId: 'p', shots: [{ shotId: 'f', frameNo: 1, durationSec: 8 }] } as never} />)
  const start = await screen.findByRole('button', { name: '自动准备整集镜头' })
  await waitFor(() => { expect(start.hasAttribute('disabled')).toBe(false) })
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '使用方案并准备整集' }))
  await waitFor(() => { expect(events).toEqual(['repair', 'draft', 'quote']) })
  expect(port.queueReferenceVideo).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '批量生成 1 个已准备镜头' }).hasAttribute('disabled')).toBe(false)
})

it('retries a failed review refresh without registering the same candidate again', async () => {
  vi.useFakeTimers()
  const register = vi.fn(async () => ({ takeId: 'take-f' }))
  const onCollected = vi.fn(async () => {}).mockRejectedValueOnce(new Error('projection unavailable'))
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async () => ({ items: [{ runId: 'run-f', publicStatus: 'succeeded',
      candidates: [{ assetId: 'asset-f', assetSha256: 'a'.repeat(64) }] }] }),
    readReferenceVideoCandidateRegistration: async () => ({ takeId: null }),
    registerReferenceVideoCandidateForReview: register,
  } as unknown as BatchPort
  await act(async () => {
    render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port}
      onOpenShot={vi.fn()} onCollected={onCollected}
      relations={{ projectId: 'p', shots: [{ shotId: 'f', frameNo: 1, durationSec: 8 }] } as never} />)
  })
  expect(onCollected).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/projection unavailable/)).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(onCollected).toHaveBeenCalledTimes(2)
  expect(register).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/projection unavailable/)).toBeNull()
})

it('sends the episode index and exact references while loading full designs by page', async () => {
  const save = vi.fn()
  const queue = vi.fn()
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null,
      frameRequirements: [{ id: 'f2' }, { id: 'f' }] }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => ({ draft: frameId === 'f' ? {
      revision: 2, requestSha256: 'd'.repeat(64), request: { ...request, frameId,
        bindings: [{ bindingToken: 'scene', assetId: 'scene-corrected', assetSha256: 'c'.repeat(64), label: 'Courtyard' }],
        promptParts: [{ text: 'old execution text must not become current instructions' }] },
    } : null,
    directorSource: { sha256: 'a'.repeat(64), generationPrompt: frameId === 'f'
      ? 'The host stays in the courtyard; the visitor is outside the south gate.'.repeat(10000)
      : 'The visitor enters from the street; the courtyard is behind the camera.' } }),
    referenceVideoRuns: async ({ frameId }: { frameId: string }) => ({ items: frameId === 'f'
      ? [{ publicStatus: 'succeeded', candidates: [] }] : [] }),
    saveReferenceVideoDraft: save, queueReferenceVideo: queue,
  } as unknown as BatchPort
  const send = vi.fn(async (_id: string, _prompt: string) => {})
  const storyPort = { prepare: vi.fn(async () => {}), send,
    read: vi.fn(async () => ({ lastSeq: 0, running: false, finished: false, text: '', script: '', error: '' })) }
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port} storyPort={storyPort}
    onOpenShot={vi.fn()} relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({
      shotId, frameNo: i + 1, durationSec: 8,
    })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  fireEvent.click(await screen.findByRole('button', { name: '自动准备整集镜头' }))
  await waitFor(() => { expect(send).toHaveBeenCalledTimes(1) })
  const prompt = send.mock.calls[0]![1]
  const source = JSON.parse(prompt.split('当前来源：')[1]!.split('\n操作者补充：')[0]!) as { shots: { frameId: string; designPage: number; needsPreparation: boolean; existingReferences: unknown[]; source: { sha256: string } }[] }
  expect(source.shots.map(shot => [shot.frameId, shot.needsPreparation])).toEqual([['f', false], ['f2', true]])
  expect(source.shots.map(shot => shot.designPage)).toEqual([2, 1])
  expect(source.shots[0]!.source).toEqual({ sha256: 'a'.repeat(64) })
  expect(prompt).not.toContain('outside the south gate')
  expect(prompt.length).toBeLessThan(16000)
  expect(prompt).toContain('includeVideoSource=true')
  expect(source.shots[0]!.existingReferences).toEqual([{ bindingToken: 'scene', assetId: 'scene-corrected',
    assetSha256: 'c'.repeat(64), label: 'Courtyard' }])
  expect(source.shots[1]!.existingReferences).toEqual([])
  expect(prompt).not.toContain('old execution text must not become current instructions')
  expect(save).not.toHaveBeenCalled()
  expect(queue).not.toHaveBeenCalled()
  expect(prompt).toMatchSnapshot('batch request with completed-shot context')
})

it('refreshes review after collecting candidates while retaining per-shot failures', async () => {
  const registered: string[] = []
  const onCollected = vi.fn(async () => { expect(registered).toEqual(['f']) })
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async ({ frameId }: { frameId: string }) => ({ items: [{
      runId: frameId, publicStatus: 'succeeded', candidates: [{ assetId: frameId, assetSha256: 'a'.repeat(64) }],
    }] }),
    readReferenceVideoCandidateRegistration: async () => ({ takeId: null }),
    registerReferenceVideoCandidateForReview: async ({ frameId }: { frameId: string }) => {
      if (frameId === 'f2') throw new Error('candidate unavailable')
      registered.push(frameId)
      return { takeId: 'take-f' }
    },
  } as unknown as BatchPort
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port}
    onOpenShot={vi.fn()} onCollected={onCollected}
    relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({ shotId, frameNo: i + 1, durationSec: 8 })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  await waitFor(() => { expect(onCollected).toHaveBeenCalledTimes(1) })
  expect(screen.getByText('1 条视频已进入本镜候选审看')).toBeTruthy()
  expect(screen.getByText('结果同步未完成：Error: candidate unavailable')).toBeTruthy()
})

it('offers one action for two prepared shots and shows each queued result', async () => {
  const queue = vi.fn(async ({ frameId }: { frameId: string }) => ({ frameId, publicStatus: 'queued' }))
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => ({ projectId: 'p', frameId, frameSha256: 'f'.repeat(64),
      directorSource: null, draft: { revision: 1, requestSha256: 'd'.repeat(64), request: { ...request, frameId } } }),
    referenceVideoRuns: async () => ({ items: [] }),
    readReferenceVideoMaterials: async () => ({ configured: true, allReady: true, materials: [] }),
    referenceVideoQuote: async ({ frameId }: { frameId: string }) => ({ ...quoteResponse, frameId, generationSubmissionEnabled: true }),
    queueReferenceVideo: queue,
  } as unknown as BatchPort
  render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port} onOpenShot={vi.fn()}
    relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({ shotId, frameNo: i + 1, title: '门口', durationSec: 8 })) } as never} />)
  fireEvent.click(screen.getByText('整集批量生成视频'))
  await screen.findByRole('button', { name: '准备已有镜头草稿' })
  fireEvent.click(screen.getByRole('button', { name: '准备已有镜头草稿' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' }).hasAttribute('disabled')).toBe(false) })
  expect(queue).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' }))
  await waitFor(() => { expect(queue).toHaveBeenCalledTimes(2) })
  await waitFor(() => { expect(screen.getAllByText(/已进入生成队列/)).toHaveLength(2) })
  expect(queue.mock.calls.map(call => call[0].frameId)).toEqual(['f', 'f2'])
  expect(screen.getByLabelText('整集批量生成').textContent).toMatchSnapshot()
})

it('recovers returned videos after leaving the page without another generation command', async () => {
  let returned = false
  const queue = vi.fn()
  const register = vi.fn(async () => ({ takeId: 'take-f' }))
  const onCollected = vi.fn(async () => {})
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async () => ({ items: [{ runId: 'original-run', publicStatus: returned ? 'succeeded' : 'running',
      candidates: returned ? [{ assetId: 'asset-f', assetSha256: 'a'.repeat(64) }] : [] }] }),
    readReferenceVideoCandidateRegistration: async () => ({ takeId: null }),
    registerReferenceVideoCandidateForReview: register,
    queueReferenceVideo: queue,
  } as unknown as BatchPort
  const mount = () => render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port}
    onOpenShot={vi.fn()} onCollected={onCollected}
    relations={{ projectId: 'p', shots: [{ shotId: 'f', frameNo: 1, durationSec: 8 }] } as never} />)
  const view = mount()
  await screen.findByText('正在生成')
  view.unmount()
  returned = true
  mount()
  await waitFor(() => { expect(onCollected).toHaveBeenCalledOnce() })
  expect(register).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', frameId: 'f', runId: 'original-run',
    assetId: 'asset-f', expectedAssetSha256: 'a'.repeat(64) })
  expect(queue).not.toHaveBeenCalled()
})

it('restores an unfinished batch after closing the tab without regenerating the confirmed first shot', async () => {
  let release: (value: unknown) => void = () => {}
  const generated = new Set<string>()
  const queue = vi.fn(async ({ frameId }: { frameId: string }) => {
    if (frameId === 'f') await new Promise((resolve) => { release = resolve })
    generated.add(frameId)
    return { runId: frameId, frameId, publicStatus: 'queued' }
  })
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => ({ projectId: 'p', frameId, frameSha256: 'f'.repeat(64), directorSource: null,
      draft: { revision: 1, requestSha256: 'd'.repeat(64), request: { ...request, frameId } } }),
    referenceVideoRuns: async ({ frameId }: { frameId: string }) => ({ items: generated.has(frameId) ? [{ runId: frameId, publicStatus: 'queued', candidates: [] }] : [] }),
    readReferenceVideoMaterials: async () => ({ configured: true, allReady: true, materials: [] }),
    referenceVideoQuote: async ({ frameId }: { frameId: string }) => ({ ...quoteResponse, projectId: 'p', frameId, generationSubmissionEnabled: true }),
    queueReferenceVideo: queue,
  } as unknown as BatchPort
  const mount = () => render(<ReferenceVideoBatch projectId="p" episodeId="e" aspectRatio="16:9" port={port}
    onOpenShot={vi.fn()} relations={{ projectId: 'p', shots: ['f', 'f2'].map((shotId, i) => ({ shotId, frameNo: i + 1, durationSec: 8 })) } as never} />)
  const view = mount()
  fireEvent.click(screen.getByText('整集批量生成视频'))
  fireEvent.click(await screen.findByRole('button', { name: '准备已有镜头草稿' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: '批量生成 2 个已准备镜头' }))
  await waitFor(() => { expect(queue).toHaveBeenCalledOnce() })
  view.unmount()
  await act(async () => { release({}); await Promise.resolve() })
  sessionStorage.clear() // A reopened browser tab no longer has the old session storage.
  mount()
  fireEvent.click(screen.getByText('整集批量生成视频'))
  await waitFor(() => { expect(screen.getByRole('button', { name: '继续上次批量提交' })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: '继续上次批量提交' }))
  await waitFor(() => { expect(queue).toHaveBeenCalledTimes(2) })
  expect(queue.mock.calls.map(call => call[0].frameId)).toEqual(['f', 'f2'])
})


it('restores batch instructions and retake scope after remount without sending and isolates episodes', async () => {
  const port = {
    readScenePlanning: async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: 's', storyboard: null }),
    referenceVideoAssets: async () => ({ pages: 1, items: [] }),
    referenceVideoDraft: async () => ({ draft: null }),
    referenceVideoRuns: async () => ({ items: [{ publicStatus: 'succeeded', candidates: [] }] }),
  } as unknown as BatchPort
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 0, running: false, finished: false, text: '', script: '', error: '' })) }
  const props = { projectId: 'p', episodeId: 'e', aspectRatio: '16:9', port, onOpenShot: vi.fn(),
    storyPort,
    relations: { projectId: 'p', shots: [{ shotId: 'f', frameNo: 1, durationSec: 8 }] } as never }
  const view = render(<ReferenceVideoBatch {...props} />)
  await waitFor(() => { expect(screen.getByText('本集 1 镜 · 可生成 0 镜')).toBeTruthy() })
  fireEvent.click(screen.getByText('补充要求（可选）'))
  fireEvent.change(screen.getByLabelText('本次补充'), { target: { value: '保留各角色声音，不添加旁观者' } })
  fireEvent.click(screen.getByLabelText('重做镜1 ·'))
  expect(screen.getByText('整集视频准备')).toBeTruthy()
  view.unmount()
  const restored = render(<ReferenceVideoBatch {...props} />)
  await waitFor(() => { expect(screen.getByText('本集 1 镜 · 可生成 0 镜')).toBeTruthy() })
  fireEvent.click(screen.getByText('补充要求（可选）'))
  expect((screen.getByLabelText('本次补充') as HTMLTextAreaElement).value).toBe('保留各角色声音，不添加旁观者')
  expect(screen.getByLabelText('重做镜1 ·')).toHaveProperty('checked', true)
  expect(screen.getByText('整集视频准备')).toBeTruthy()
  restored.rerender(<ReferenceVideoBatch {...props} episodeId="another" />)
  expect((screen.getByLabelText('本次补充') as HTMLTextAreaElement).value).toBe('')
  expect(screen.getByLabelText('重做镜1 ·')).toHaveProperty('checked', false)
  restored.rerender(<ReferenceVideoBatch {...props} />)
  expect((screen.getByLabelText('本次补充') as HTMLTextAreaElement).value).toBe('保留各角色声音，不添加旁观者')
  expect(screen.getByLabelText('重做镜1 ·')).toHaveProperty('checked', true)
  expect(storyPort.send).not.toHaveBeenCalled()
})
