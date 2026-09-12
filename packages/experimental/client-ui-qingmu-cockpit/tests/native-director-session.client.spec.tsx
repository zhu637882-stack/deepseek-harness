// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { DirectorContextClientPort, NativeDirectorReadiness } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { NativeDirectorSession } from '../src/client/NativeDirectorSession.tsx'
import { NativeDirectorComposer } from '../src/client/NativeDirectorComposer.tsx'
import { createNativeDirectorSessionPort } from '../src/client/native-director-session.ts'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'

afterEach(() => { cleanup(); sessionStorage.clear() })
const ok = <T,>(value: T) => ({ result: { ok: true as const, value } })
const mounted: NativeDirectorReadiness = { status: 'mounted', presetId: 'qingmu-director',
  tools: ['qingmu_read_bound_context', 'qingmu_get_imago_method', 'qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit'], missingTools: [] }
function fixture(blank = true, preset = 'ordinary') {
  const transport = directorConnectionFixture()
  const row = { id: 's1', cwd: '/project', blank, agentPreset: preset }
  const sessionState = { current: 's1', ids: ['s1'], byId: { s1: row } }
  const sessions = { list: { getSnapshot: () => sessionState }, binding: vi.fn(() => undefined), noteAgentPreset: vi.fn(), open: vi.fn() }
  const workspaceState = { items: [{ workspaceId: 'w1', path: '/project', sessionIds: ['s1'] }], recentWorkspaceId: 'w1' }
  const workspaces = { list: { getSnapshot: () => workspaceState }, connectWorkspace: vi.fn(async () => 'new-empty') }
  const api = { agentPresets: { list: vi.fn(async () => ok({ presets: [{ id: 'qingmu-director', broken: false }] })),
    select: vi.fn(async () => ok({ agentPreset: 'qingmu-director' })) }, sessions: {
    create: vi.fn(async () => ok({})), prompt: vi.fn(async () => ok({})) } }
  const ctx = { get: (key: string) => key === 'sessions' ? sessions : key === 'workspaces' ? workspaces : undefined } as unknown as ClientContext
  const port = createNativeDirectorSessionPort(ctx, { api, hostDescription: transport.source } as unknown as ConnectionHandle)
  const target = { schema: 'qingmu.native-director-request.v1' as const, sessionId: 's1',
    scope: { projectId: 'project', episodeId: 'episode', sceneId: 'scene', shotId: 'shot1' },
    contextSnapshotSha256: 'a'.repeat(64), ownerId: 'browser-1' }
  return { transport, row, sessionState, sessions, workspaceState, workspaces, api, port, target }
}
it('records project scope beside the pre-production prompt without inventing a shot target', async () => {
  const f = fixture(false, 'qingmu-director')
  await f.port.story!.send('creative-session', 'Keep the west window in the same room.',
    { projectId: 'project-a', episodeId: 'episode-a', purpose: 'asset-design' })
  expect(f.api.sessions.prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    sessionId: 'creative-session', content: [
      { type: 'text', text: JSON.stringify({ schema: 'qingmu.native-creative-request.v1', sessionId: 'creative-session',
        projectId: 'project-a', episodeId: 'episode-a', purpose: 'asset-design' }) },
      { type: 'text', text: 'Keep the west window in the same room.' },
    ],
  }))
})

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

it('sends a user request to the exact selected native director without creating or switching sessions', async () => {
  const f = fixture(false, 'qingmu-director')
  const signal = new AbortController().signal
  await f.port.prompt(f.target, '保持铁轨在右侧。', signal)
  expect(f.api.sessions.prompt).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', mode: 'queue',
    content: [{ type: 'text', text: JSON.stringify(f.target) }, { type: 'text', text: '保持铁轨在右侧。' }],
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, signal)
  expect(f.sessions.open).not.toHaveBeenCalled()
  expect(f.api.sessions.create).not.toHaveBeenCalled()
  expect(f.api.agentPresets.select).not.toHaveBeenCalled()
})
it.each(['ordinary', 'missing', 'navigated', 'offline', 'aborted', 'empty', 'oversized'] as const)(
  'does not dispatch a native director prompt when %s', async (reason) => {
    const f = fixture(false, 'qingmu-director')
    const abort = new AbortController()
    if (reason === 'ordinary') f.row.agentPreset = 'ordinary'
    if (reason === 'missing') f.sessionState.ids = []
    if (reason === 'navigated') f.sessionState.current = 's2'
    if (reason === 'offline') f.transport.publish(false)
    if (reason === 'aborted') abort.abort()
    const text = reason === 'empty' ? '  ' : reason === 'oversized' ? '字'.repeat(16001) : '保持铁轨在右侧。'
    await expect(f.port.prompt(f.target, text, abort.signal)).rejects.toThrow()
    expect(f.api.sessions.prompt).not.toHaveBeenCalled()
  },
)
it('reports transport failure without retrying the possibly accepted native turn', async () => {
  const f = fixture(false, 'qingmu-director')
  f.api.sessions.prompt.mockRejectedValue(new Error('lost response'))
  await expect(f.port.prompt(f.target, '保持铁轨在右侧。', new AbortController().signal)).rejects.toThrow('lost response')
  expect(f.api.sessions.prompt).toHaveBeenCalledTimes(1)
})
it('submits once while pending and reports acceptance rather than creative completion', async () => {
  const f = fixture(false, 'qingmu-director')
  let finish!: () => void
  const prompt = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  render(<NativeDirectorComposer port={{ ...f.port, prompt }} sessionId="s1" scopeKey="shot1" target={f.target} ready />)
  const input = screen.getByRole('textbox', { name: '导演要求' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '保持铁轨在右侧。' } })
  const button = screen.getByRole('button', { name: '发送给当前导演' })
  fireEvent.click(button); fireEvent.click(button)
  expect(prompt).toHaveBeenCalledExactlyOnceWith(f.target, '保持铁轨在右侧。', expect.any(AbortSignal))
  expect(input.disabled).toBe(true)
  await act(async () => { finish() })
  expect(input.value).toBe('')
  expect(screen.getByRole('status').textContent).toContain('要求已交给当前导演处理')
})
it('keeps the request after an unknown send result and does not silently resend it', async () => {
  const f = fixture(false, 'qingmu-director')
  const prompt = vi.fn(async () => { throw new Error('lost response') })
  const props = { port: { ...f.port, prompt }, sessionId: 's1', scopeKey: 'shot1', target: f.target, ready: true }
  const view = render(<NativeDirectorComposer {...props} />)
  const input = screen.getByRole('textbox', { name: '导演要求' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '保持铁轨在右侧。' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
  await screen.findByText(/上次发送结果尚未确认/)
  expect(input.value).toBe('保持铁轨在右侧。')
  expect(screen.getByRole('button', { name: '发送给当前导演' })).toHaveProperty('disabled', true)
  view.unmount()
  render(<NativeDirectorComposer {...props} sessionId="s2" target={{ ...f.target, sessionId: 's2' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: '导演要求' }), { target: { value: '保持铁轨在右侧。' } })
  expect(screen.getByRole('button', { name: '发送给当前导演' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
  expect(prompt).toHaveBeenCalledTimes(1)
})
it.each(['scope', 'session', 'disconnect', 'reconnect', 'unmount'] as const)(
  'ignores late acceptance and does not resend after %s', async (reason) => {
    const f = fixture(false, 'qingmu-director')
    let finish!: () => void
    const prompt = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const props = { port: { ...f.port, prompt }, sessionId: 's1', scopeKey: 'shot1', target: f.target, ready: true }
    const view = render(<NativeDirectorComposer {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '导演要求' }), { target: { value: '保持铁轨在右侧。' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
    const signal = (prompt.mock.calls[0] as unknown as [unknown, string, AbortSignal])[2]
    if (reason === 'scope') view.rerender(<NativeDirectorComposer {...props} scopeKey="shot2" />)
    if (reason === 'session') view.rerender(<NativeDirectorComposer {...props} sessionId="s2" />)
    if (reason === 'disconnect' || reason === 'reconnect') act(() => { f.transport.publish(false) })
    if (reason === 'reconnect') act(() => { f.transport.publish(true) })
    if (reason === 'unmount') view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish() })
    expect(screen.queryByText(/要求已发送到当前导演会话/)).toBeNull()
    if (reason !== 'unmount') {
      expect(screen.getByRole('textbox', { name: '导演要求' })).toHaveProperty('value',
        reason === 'scope' || reason === 'session' ? '' : '保持铁轨在右侧。')
      view.unmount()
    }
    if (reason === 'disconnect') act(() => { f.transport.publish(true) })
    render(<NativeDirectorComposer {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '导演要求' }), { target: { value: '保持铁轨在右侧。' } })
    expect(screen.getByRole('button', { name: '发送给当前导演' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('status').textContent).toContain('上次发送结果尚未确认')
    fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
    expect(prompt).toHaveBeenCalledTimes(1)
  },
)
it('keeps unsent director text per shot across closing and reopening, without dispatching', () => {
  const f = fixture(false, 'qingmu-director')
  const props = { port: f.port, sessionId:'s1', scopeKey:'shot1', target:f.target, ready:true }
  const view = render(<NativeDirectorComposer {...props} />)
  fireEvent.change(screen.getByLabelText('导演要求'), { target:{ value:'保留车外的莉娜' } })
  view.rerender(<NativeDirectorComposer {...props} scopeKey="shot2" />)
  expect(screen.getByLabelText('导演要求')).toHaveProperty('value', '')
  view.unmount()
  render(<NativeDirectorComposer {...props} />)
  expect(screen.getByLabelText('导演要求')).toHaveProperty('value', '保留车外的莉娜')
  expect(f.api.sessions.prompt).not.toHaveBeenCalled()
})

it('prepares a complete reference reconciliation request for the bound director without sending on selection', async () => {
  const f = fixture(false, 'qingmu-director')
  const prompt = vi.fn(async () => undefined)
  render(<NativeDirectorComposer port={{ ...f.port, prompt }} sessionId="s1" scopeKey="shot1" target={f.target} ready />)
  fireEvent.click(screen.getByRole('button', { name: '整理本镜生成稿' }))
  const input = screen.getByRole('textbox', { name: '导演要求' }) as HTMLTextAreaElement
  expect(input.value).toMatchSnapshot('complete draft reconciliation request')
  expect(prompt).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '整理本镜生成稿' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
  await waitFor(() => expect(prompt).toHaveBeenCalledExactlyOnceWith(f.target, expect.stringContaining('不要提交视频'), expect.any(AbortSignal)))
})
