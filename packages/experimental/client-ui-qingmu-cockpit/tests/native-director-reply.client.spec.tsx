// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeStoryPort, StoryDraftResult } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import { NativeDirectorReply } from '../src/client/NativeDirectorReply.tsx'

afterEach(cleanup)
const result: StoryDraftResult = { lastSeq: 10, running: false, finished: true, text: '表演修订候选：微抬下巴，句尾停顿。', script: '', error: '' }
function fixture(read = vi.fn(async () => result)) {
  const port: NativeStoryPort = { read, prepare: vi.fn(), send: vi.fn() }
  return { port, ...render(<NativeDirectorReply port={port} sessionId="director-p" scopeKey="shot-8" />) }
}
it('shows an ordinary performance reply without sending or replaying a request', async () => {
  const { port } = fixture()
  fireEvent.click(screen.getByRole('button', { name: '查看导演回复' }))
  await screen.findByText(result.text)
  expect(port.read).toHaveBeenCalledWith('director-p', -1)
  expect(port.send).not.toHaveBeenCalled()
  expect(port.prepare).not.toHaveBeenCalled()
})
it('does not present a running turn as finished', async () => {
  fixture(vi.fn(async () => ({ ...result, running: true, finished: false, text: '' })))
  fireEvent.click(screen.getByRole('button', { name: '查看导演回复' }))
  await screen.findByText('导演正在处理，稍后读取即可，不需要重复发送。')
  expect(screen.queryByText(result.text)).toBeNull()
})
it('discards a late reply after changing shot scope', async () => {
  let resolve!: (value: StoryDraftResult) => void
  const app = fixture(vi.fn(() => new Promise<StoryDraftResult>((done) => { resolve = done })))
  fireEvent.click(screen.getByRole('button', { name: '查看导演回复' }))
  app.rerender(<NativeDirectorReply port={app.port} sessionId="director-p" scopeKey="shot-9" />)
  await act(async () => { resolve(result) })
  expect(screen.queryByText(result.text)).toBeNull()
})
