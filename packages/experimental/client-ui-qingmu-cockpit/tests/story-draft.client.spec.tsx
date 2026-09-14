// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeStoryComposer } from '../src/client/NativeStoryComposer.tsx'
import { readStoryDraft } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'

afterEach(() => { cleanup(); localStorage.clear() })
it('authors a fresh asset revision from current sources and rejects adoption after those sources change', async () => {
  const key = 'qingmu.asset-design-session.v1:p:e'
  localStorage.setItem(key, JSON.stringify({ sessionId: 'session-old', baseline: 1, submitted: true, sourceKey: 'old basis' }))
  const finished = { text: '完成稿', script: '{"assets":[]}', lastSeq: 4, running: false, finished: true, error: '' }
  let newSubmitted = false
  const port = { prepare: vi.fn(async (_sessionId: string) => {}),
    send: vi.fn(async (_id: string, _prompt: string) => { newSubmitted = true }), read: vi.fn(async (id: string) => id === 'session-old' || newSubmitted
      ? finished : { ...finished, text: '', script: '', lastSeq: -1, finished: false }) }
  const purpose = { key: 'asset-design', title: '素材设计', description: '设计当前素材', prompt: '当前完整剧本与共用房间',
    action: '重新设计', adopt: '采用设计', adopted: '已采用', freshRevision: true, sourceKey: 'current basis' }
  const onAdopt = vi.fn()
  const view = render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="当前来源" settings=""
    disabled={false} onAdopt={onAdopt} purpose={purpose} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用设计' }))
  await screen.findByText(/没有采用：创作依据或本页设计已改变/)
  expect(onAdopt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新设计' }))
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(1) })
  expect(port.prepare.mock.calls[0]?.[0]).not.toBe('session-old')
  const request = JSON.parse(localStorage.getItem(key)!)
  expect(request).toMatchObject({ baseline: -1, sourceKey: 'current basis', submitted: true })
  view.unmount()
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="已改来源" settings=""
    disabled={false} onAdopt={onAdopt} purpose={{ ...purpose, sourceKey: 'changed during generation' }} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用设计' }))
  await screen.findByText(/没有采用：创作依据或本页设计已改变/)
  expect(onAdopt).not.toHaveBeenCalled()
  expect(port.send).toHaveBeenCalledTimes(1)
  expect(screen.getByText('完成稿')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '按当前要求改进上稿' }))
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(2) })
  expect(port.send.mock.calls[1]).toEqual([expect.any(String), expect.stringContaining('<previous_candidate>\n完成稿\n</previous_candidate>'),
    { projectId: 'p', episodeId: 'e', purpose: 'asset-design' }])
  expect(port.send.mock.calls[1]?.[1]).toMatchSnapshot()
  expect(port.prepare.mock.calls[1]?.[0]).not.toBe(request.sessionId)
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ sourceKey: 'changed during generation', submitted: true })
})
it('adopts a retained JSON design block and reports validation failure without another model request', async () => {
  localStorage.setItem('qingmu.asset-design-session.v1:p:e',
    JSON.stringify({ sessionId: 'session-design', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({
    text: '完整设计\n```json\n{"assets":[]}\n```', script: '', lastSeq: 4, running: false, finished: true, error: '',
  })) }
  const onAdopt = vi.fn(() => { throw new Error('缺少素材设计') })
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="当前剧本" settings="{}"
    disabled={false} onAdopt={onAdopt} purpose={{ key: 'asset-design', jsonOutput: true, title: '素材设计',
      description: '完整设计', prompt: '设计', action: '重新设计', adopt: '采用设计', adopted: '已采用设计' }} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用设计' }))
  await screen.findByText('没有采用：缺少素材设计')
  expect(onAdopt).toHaveBeenCalledWith('{"assets":[]}')
  expect(screen.queryByText('已采用设计')).toBeNull()
  expect(port.send).not.toHaveBeenCalled()
  expect(port.prepare).not.toHaveBeenCalled()
})
const event = (seq: number, type: string, data: unknown) => ({ event: { seq, type, data } })
const completed = [event(2, 'turn/start', {}), event(3, 'assistant/message', { message: { content: [
  { type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: '完整稿\n```txt\n场景一：店内\n阿宁：下班了。\n```' },
] } }), event(4, 'turn/end', { reason: { kind: 'completed' } })]
it('exposes only completed text and does not recover a previous screenplay after a later failed turn', () => {
  const result = readStoryDraft(completed, 1)
  expect(result.script).toBe('场景一：店内\n阿宁：下班了。')
  expect(result.text).not.toContain('private reasoning')
  expect(readStoryDraft(completed.slice(0, 2), 1).script).toBe('')
  const failed = readStoryDraft([...completed, event(5, 'turn/start', {}), event(6, 'turn/end', {
    reason: { kind: 'error', error: { message: 'model unavailable' } },
  })], 4)
  expect(failed).toMatchObject({ finished: true, script: '', error: 'model unavailable' })
})
it('recovers a completed native request without another model call, then adopts only into text', async () => {
  localStorage.setItem('qingmu.story-session.v1:p:e', JSON.stringify({ sessionId: 'session-original', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => readStoryDraft(completed, 1)) }
  const onAdopt = vi.fn()
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="写故事" settings="{}" disabled={false} onAdopt={onAdopt} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用到剧本文字' }))
  expect(onAdopt).toHaveBeenCalledWith('场景一：店内\n阿宁：下班了。')
  expect(port.send).not.toHaveBeenCalled(); expect(port.prepare).not.toHaveBeenCalled()
  expect(screen.queryByText('private reasoning')).toBeNull()
})
it('does not send twice after an uncertain response or expose another project candidate', async () => {
  localStorage.setItem('qingmu.story-session.v1:other:e', JSON.stringify({ sessionId: 'another', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(async (_sessionId: string) => {}), send: vi.fn(async () => { throw new Error('connection lost') }),
    read: vi.fn(async () => readStoryDraft([], -1)) }
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="写故事" settings="{}" disabled={false} onAdopt={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '用当前文字创作剧本' }))
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(1) })
  expect(port.prepare.mock.calls[0]?.[0]).not.toBe('another')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '创作处理中…' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '读取原创作结果' }))
  expect(port.send).toHaveBeenCalledTimes(1)
})

it('keeps a screenplay review separate from the original writer request and result', async () => {
  localStorage.setItem('qingmu.story-session.v1:p:e', JSON.stringify({ sessionId: 'session-writer', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => readStoryDraft([], -1)) }
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="当前正文" settings="{}" disabled={false} onAdopt={vi.fn()}
    purpose={{ key: 'story-review', title: '剧本复核', description: '复核正文', prompt: '原点和当前正文', action: '复核', adopt: '采用修订', adopted: '已放入文字' }} />)
  expect(port.read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '复核' }))
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(1) })
  expect(port.send.mock.calls[0]).toEqual([expect.not.stringMatching(/^session-writer$/), expect.stringContaining('原点和当前正文'), { projectId: 'p', episodeId: 'e', purpose: 'story-review' }])
  expect(localStorage.getItem('qingmu.story-session.v1:p:e')).toContain('session-writer')
  expect(localStorage.getItem('qingmu.story-review-session.v1:p:e')).not.toContain('session-writer')
})

it('edits and reloads a completed candidate without another model call while retaining source checks and the original', async () => {
  const key = 'qingmu.asset-design-session.v1:p:e'
  localStorage.setItem(key, JSON.stringify({ sessionId: 'original', baseline: 1, submitted: true, sourceKey: 'basis' }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({
    text: 'Original complete result', script: '{"assets":[]}', lastSeq: 4, running: false, finished: true, error: '',
  })) }
  const onAdopt = vi.fn()
  const purpose = { key: 'asset-design', jsonOutput: true, title: '素材设计', description: '完整设计', prompt: '设计',
    action: '重新设计', adopt: '采用设计', adopted: '已采用设计', sourceKey: 'basis' }
  const mount = (sourceKey = 'basis') => render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="当前剧本" settings=""
    disabled={false} onAdopt={onAdopt} purpose={{ ...purpose, sourceKey }} />)
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '编辑这份候选' }))
  fireEvent.change(screen.getByRole('textbox', { name: '候选正文' }), { target: { value: '{"assets":[{"name":"Reviewed design"}]}' } })
  cleanup(); mount()
  expect((await screen.findByRole('textbox', { name: '候选正文' }) as HTMLTextAreaElement).value).toContain('Reviewed design')
  fireEvent.click(screen.getByRole('button', { name: '采用设计' }))
  await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith('{"assets":[{"name":"Reviewed design"}]}') })
  expect(screen.getByText('Original complete result')).toBeTruthy()
  cleanup(); mount('changed basis')
  fireEvent.click(await screen.findByRole('button', { name: '采用设计' }))
  await screen.findByText(/没有采用：创作依据或本页设计已改变/)
  expect(onAdopt).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '恢复原生候选' }))
  expect(screen.queryByRole('textbox', { name: '候选正文' })).toBeNull()
  expect(localStorage.getItem(`${key}:edited`)).toBeNull()
  expect(port.send).not.toHaveBeenCalled()
})

it('restores an interrupted response with a recovery instruction without retry or adoption', async () => {
  localStorage.setItem('qingmu.story-session.v1:p:e', JSON.stringify({ sessionId: 'session-failed', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => readStoryDraft([
    event(2, 'turn/start', {}), event(3, 'turn/end', { reason: { kind: 'error', error: { message: 'SSE stream ended without [DONE]' } } }),
  ], 1)) }
  const onAdopt = vi.fn()
  render(<NativeStoryComposer port={port} projectId="p" episodeId="e" source="剧本" settings="" disabled={false} onAdopt={onAdopt} />)
  expect((await screen.findByRole('alert')).textContent).toContain('模型连接中断，未收到完整结果')
  expect(screen.queryByRole('button', { name: '采用到剧本文字' })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '根据当前文字重新写作' }).disabled).toBe(false)
  expect(port.send).not.toHaveBeenCalled()
  expect(onAdopt).not.toHaveBeenCalled()
})
