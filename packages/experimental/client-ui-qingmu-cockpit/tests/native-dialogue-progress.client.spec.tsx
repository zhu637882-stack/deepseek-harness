// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeDialogueExecution, NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { NativeDialogueProgress } from '../src/client/NativeDialogueProgress.tsx'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'

afterEach(cleanup)
function fixture() {
  const scope = { projectId: 'p', episodeId: 'e', sceneId: 'scene', shotId: 'f6' }
  const target: NativeDirectorPromptTarget = { schema: 'qingmu.native-director-request.v1', sessionId: 's', scope,
    contextSnapshotSha256: 'a'.repeat(64), ownerId: 'browser' }
  let state: NativeDialogueExecution = { scope, before: '有人吗？', after: '有人在吗？',
    affectedShots: [{ shotId: 'f6', frameNo: 6, title: null }],
    unchangedShots: [{ shotId: 'f5', frameNo: 5, title: null }], status: 'prepared', commandReceiptId: null }
  const listeners = new Set<() => void>()
  const face = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state }
  const transport = directorConnectionFixture()
  const port = { connection: transport.source, activate: vi.fn(), prompt: vi.fn(), dialogueExecution: () => face }
  const onCommitted = vi.fn(async () => {})
  return { props: { port, sessionId: 's', target, onCommitted }, state, publish(patch: Partial<NativeDialogueExecution>) {
    state = { ...state, ...patch }; listeners.forEach(listener => listener())
  } }
}
it('shows the save immediately but preserves its live selection until input preparation completes, never submits', async () => {
  const f = fixture()
  const view = render(<NativeDialogueProgress {...f.props} />)
  expect(screen.getByText('更新：镜6')).toBeTruthy()
  expect(screen.getByText(/保持原样：镜5/)).toBeTruthy()
  expect(f.props.onCommitted).not.toHaveBeenCalled()
  act(() => f.publish({ status: 'saving' }))
  expect(screen.getByRole('status').textContent).toContain('正在保存')
  act(() => f.publish({ status: 'saved', commandReceiptId: 'receipt1' }))
  expect(f.props.onCommitted).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain('视频尚未重新生成')
  act(() => f.publish({ status: 'input_prepared', commandReceiptId: 'receipt1' }))
  await waitFor(() => expect(f.props.onCommitted).toHaveBeenCalledTimes(1))
  view.rerender(<NativeDialogueProgress {...f.props} />)
  expect(f.props.onCommitted).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toContain('视频输入已准备')
  view.unmount()
  render(<NativeDialogueProgress {...f.props} />)
  await waitFor(() => expect(f.props.onCommitted).toHaveBeenCalledTimes(2))
  expect(f.props.port.prompt).not.toHaveBeenCalled()
})
it('never displays or refreshes another shot or session', () => {
  const f = fixture()
  act(() => f.publish({ status: 'input_prepared', commandReceiptId: 'receipt1' }))
  const view = render(<NativeDialogueProgress {...f.props} target={{ ...f.props.target,
    scope: { ...f.props.target.scope, shotId: 'f7' } }} />)
  expect(screen.queryByRole('status')).toBeNull()
  view.rerender(<NativeDialogueProgress {...f.props} sessionId="other" />)
  expect(screen.queryByRole('status')).toBeNull()
  expect(f.props.onCommitted).not.toHaveBeenCalled()
})
it('keeps a durable save distinct from a failed display refresh', async () => {
  const f = fixture()
  f.props.onCommitted.mockRejectedValue(new Error('offline'))
  act(() => f.publish({ status: 'input_prepared', commandReceiptId: 'receipt1' }))
  render(<NativeDialogueProgress {...f.props} />)
  expect((await screen.findByRole('alert')).textContent).toContain('修改已保存')
  expect(f.props.port.prompt).not.toHaveBeenCalled()
})
it('does not turn an uncertain save into an automatic resubmission', () => {
  const f = fixture()
  act(() => f.publish({ status: 'uncertain' }))
  render(<NativeDialogueProgress {...f.props} />)
  expect(screen.getByRole('status').textContent).toContain('查询原操作结果')
  expect(f.props.onCommitted).not.toHaveBeenCalled()
  expect(f.props.port.prompt).not.toHaveBeenCalled()
})
