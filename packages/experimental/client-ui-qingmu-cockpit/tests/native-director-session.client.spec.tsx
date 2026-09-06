// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { DirectorContextClientPort, NativeDirectorReadiness } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { NativeDirectorSession } from '../src/client/NativeDirectorSession.tsx'
import { createNativeDirectorSessionPort } from '../src/client/native-director-session.ts'
import { directorConnectionFixture } from './director-connection-fixture.ts'

afterEach(cleanup)
const ok = <T,>(value: T) => ({ result: { ok: true as const, value } })
const mounted: NativeDirectorReadiness = { status: 'mounted', presetId: 'qingmu-director',
  tools: ['qingmu_read_bound_context', 'qingmu_get_imago_method', 'qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit'], missingTools: [] }
function fixture(blank = true, preset = 'ordinary') {
  const transport = directorConnectionFixture()
  const row = { id: 's1', cwd: '/project', blank, agentPreset: preset }
  const sessionState = { current: 's1', ids: ['s1'], byId: { s1: row } }
  const sessions = { list: { getSnapshot: () => sessionState }, noteAgentPreset: vi.fn(), open: vi.fn() }
  const workspaceState = { items: [{ workspaceId: 'w1', path: '/project', sessionIds: ['s1'] }], recentWorkspaceId: 'w1' }
  const workspaces = { list: { getSnapshot: () => workspaceState }, connectWorkspace: vi.fn(async () => 'new-empty') }
  const api = { agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'qingmu-director', broken: false }] })),
    select: vi.fn(async () => ok({ agentPreset: 'qingmu-director' })) }, sessions: { create: vi.fn(async () => ok({})) } }
  const ctx = { get: (key: string) => key === 'sessions' ? sessions : key === 'workspaces' ? workspaces : undefined } as unknown as ClientContext
  const port = createNativeDirectorSessionPort(ctx, { api, hostDescription: transport.source } as unknown as ConnectionHandle)
  return { transport, row, sessionState, sessions, workspaceState, workspaces, api, port }
}

it('selects the native preset for an empty session without creating a session or sending a model turn', async () => {
  const f = fixture()
  await f.port.activate('s1', new AbortController().signal)
  expect(f.api.agentPresets.select).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', agentPreset: 'qingmu-director' })
  expect(f.sessions.noteAgentPreset).toHaveBeenCalledExactlyOnceWith('s1', 'qingmu-director')
  expect(f.sessions.open).toHaveBeenCalledExactlyOnceWith('s1')
  expect(f.api.sessions.create).not.toHaveBeenCalled(); expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled()
})
it('preserves a started ordinary conversation and selects only the native workspace empty-session result', async () => {
  const f = fixture(false)
  await f.port.activate('s1', new AbortController().signal)
  expect(f.workspaces.connectWorkspace).toHaveBeenCalledExactlyOnceWith('w1')
  expect(f.api.agentPresets.select).toHaveBeenCalledExactlyOnceWith({ sessionId: 'new-empty', agentPreset: 'qingmu-director' })
  expect(f.row.agentPreset).toBe('ordinary'); expect(f.sessions.open).toHaveBeenCalledExactlyOnceWith('new-empty')
})
it('restores an existing director by its own id and cwd without recomposing its started history', async () => {
  const f = fixture(false, 'qingmu-director')
  await f.port.activate('s1', new AbortController().signal)
  expect(f.api.sessions.create).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', cwd: '/project', agentPreset: 'qingmu-director' })
  expect(f.api.agentPresets.select).not.toHaveBeenCalled(); expect(f.sessions.open).toHaveBeenCalledWith('s1')
})
it.each(['missing-preset', 'wrong-workspace', 'offline'] as const)('does not allocate or switch when %s', async (reason) => {
  const f = fixture(false)
  if (reason === 'missing-preset') f.api.agentPresets.list.mockResolvedValue(ok({ presets: [] }))
  if (reason === 'wrong-workspace') f.workspaceState.items[0]!.path = '/another'
  if (reason === 'offline') f.transport.publish(false)
  await expect(f.port.activate('s1', new AbortController().signal)).rejects.toThrow()
  expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled(); expect(f.api.agentPresets.select).not.toHaveBeenCalled()
  expect(f.api.sessions.create).not.toHaveBeenCalled(); expect(f.sessions.open).not.toHaveBeenCalled()
})
it.each(['navigate', 'cancel', 'disconnect', 'reconnect'] as const)('never switches a newly allocated session after %s', async (reason) => {
  const f = fixture(false)
  let finish!: (id: string) => void
  f.workspaces.connectWorkspace.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const controller = new AbortController()
  const result = f.port.activate('s1', controller.signal)
  const rejected = expect(result).rejects.toThrow()
  await waitFor(() => { expect(f.workspaces.connectWorkspace).toHaveBeenCalled() })
  if (reason === 'navigate') f.sessionState.current = 's2'
  if (reason === 'cancel') controller.abort()
  if (reason === 'disconnect') f.transport.publish(false)
  if (reason === 'reconnect') { f.transport.publish(false); f.transport.publish(true) }
  finish('new-empty'); await rejected
  expect(f.api.agentPresets.select).not.toHaveBeenCalled(); expect(f.sessions.open).not.toHaveBeenCalled()
})
it('does not record a selection or navigate after a native preset rejection', async () => {
  const f = fixture()
  f.api.agentPresets.select.mockRejectedValue(new Error('agent-preset-locked'))
  await expect(f.port.activate('s1', new AbortController().signal)).rejects.toThrow('agent-preset-locked')
  expect(f.sessions.noteAgentPreset).not.toHaveBeenCalled(); expect(f.sessions.open).not.toHaveBeenCalled()
})
it.each(['reconnect', 'navigate', 'cancel'] as const)('does not mirror a late preset selection after %s', async (reason) => {
  const f = fixture()
  let finish!: (value: ReturnType<typeof ok<{ agentPreset: string }>>) => void
  f.api.agentPresets.select.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const controller = new AbortController()
  const rejected = expect(f.port.activate('s1', controller.signal)).rejects.toThrow()
  await waitFor(() => { expect(f.api.agentPresets.select).toHaveBeenCalled() })
  if (reason === 'reconnect') { f.transport.publish(false); f.transport.publish(true) }
  if (reason === 'navigate') f.sessionState.current = 's2'
  if (reason === 'cancel') controller.abort()
  finish(ok({ agentPreset: 'qingmu-director' })); await rejected
  expect(f.sessions.noteAgentPreset).not.toHaveBeenCalled(); expect(f.sessions.open).not.toHaveBeenCalled()
})

it('retracts mount status offline, ignores old responses, and rechecks on each handshake and session change', async () => {
  const f = fixture()
  const read = vi.fn(async (): Promise<NativeDirectorReadiness> => mounted)
  const props = { port: f.port, bridge: { readNativeDirectorReadiness: read } as unknown as DirectorContextClientPort,
    sessionId: 's1', onRefresh: vi.fn() }
  const view = render(<NativeDirectorSession {...props} />)
  await screen.findByText(/4 项青木导演工具已挂载/)
  let finish!: (value: NativeDirectorReadiness) => void
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '重新检查连接' }))
  await act(async () => { f.transport.publish(false); finish(mounted) })
  expect(screen.queryByText(/4 项青木导演工具已挂载/)).toBeNull()
  expect((screen.getByRole('button', { name: '进入 / 恢复青木导演' }) as HTMLButtonElement).disabled).toBe(true)
  read.mockResolvedValue({ status: 'inactive', presetId: null, tools: [], missingTools: mounted.tools })
  act(() => { f.transport.publish(true) })
  await screen.findByText(/当前会话尚未运行/)
  expect(read).toHaveBeenCalledTimes(3)
  view.rerender(<NativeDirectorSession {...props} sessionId="s2" />)
  await waitFor(() => { expect(read).toHaveBeenLastCalledWith('s2', expect.any(AbortSignal)) })
  expect(f.api.sessions.create).not.toHaveBeenCalled()
})
it('prevents duplicate entry and reports unavailable inspection instead of a fake green state', async () => {
  const f = fixture()
  let finish!: () => void
  const activate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const onRefresh = vi.fn()
  render(<NativeDirectorSession port={{ ...f.port, activate }} bridge={{} as DirectorContextClientPort} sessionId="s1" onRefresh={onRefresh} />)
  await screen.findByText('当前安装未提供工具状态检查。')
  const enter = screen.getByRole('button', { name: '进入 / 恢复青木导演' })
  fireEvent.click(enter); fireEvent.click(enter)
  expect(activate).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
