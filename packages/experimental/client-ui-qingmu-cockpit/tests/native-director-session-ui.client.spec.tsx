// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DirectorContextClientPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { NativeDirectorSession } from '../src/client/NativeDirectorSession.tsx'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'

afterEach(() => { cleanup() })

function fixture(read: () => Promise<never>) {
  const transport = directorConnectionFixture()
  const activate = vi.fn(async () => {})
  return {
    activate,
    props: {
      port: { connection: transport.source, activate, prompt: vi.fn(async () => {}) },
      bridge: { readNativeDirectorReadiness: read } as unknown as DirectorContextClientPort,
      sessionId: 'cold-director',
      onRefresh: vi.fn(),
    },
  }
}

it.each([
  'director context session unavailable',
  'bad-request: director context session unavailable',
])('shows the explicit recovery action for the bridge cold-session error %s', async (message) => {
  const f = fixture(async () => { throw new Error(message) })
  render(<NativeDirectorSession {...f.props} />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('上次导演会话尚未恢复')
  expect(alert.textContent).toContain('恢复当前项目会话；不会发送导演要求')
  const enter = screen.getByRole('button', { name: '进入 / 恢复青木导演' })
  expect(enter.hasAttribute('disabled')).toBe(false)
  expect(f.activate).not.toHaveBeenCalled()
})

it('keeps the explicit recovery action in the compact card', async () => {
  const f = fixture(async () => { throw new Error('bad-request: director context session unavailable') })
  render(<NativeDirectorSession {...f.props} compact />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('上次导演会话尚未恢复')
  expect(alert.textContent).toContain('恢复当前项目会话；不会发送导演要求')
  const enter = screen.getByRole('button', { name: '进入 / 恢复青木导演' })
  expect(enter.hasAttribute('disabled')).toBe(false)
  expect(f.activate).not.toHaveBeenCalled()
})

it('keeps a transport failure actionable without exposing its internal error', async () => {
  const f = fixture(async () => { throw new Error('socket EOF 127.0.0.1') })
  render(<NativeDirectorSession {...f.props} />)
  await screen.findByText('暂时无法读取导演状态，请重新检查连接；人工编辑仍可用。')
  expect(screen.queryByText(/socket EOF/)).toBeNull()
  expect(screen.getByRole('button', { name: '重新检查连接' }).hasAttribute('disabled')).toBe(false)
})

it('keeps the native workspace-directory instruction after an explicit entry attempt', async () => {
  const f = fixture(async () => { throw new Error('unused readiness failure') })
  f.activate.mockRejectedValueOnce(new Error('请先在 DSH 选择当前项目的工作目录；不会替你选其他项目。'))
  render(<NativeDirectorSession {...f.props} bridge={{} as DirectorContextClientPort} />)
  fireEvent.click(screen.getByRole('button', { name: '进入 / 恢复青木导演' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('请先在 DSH 选择当前项目的工作目录；不会替你选其他项目。')
})
