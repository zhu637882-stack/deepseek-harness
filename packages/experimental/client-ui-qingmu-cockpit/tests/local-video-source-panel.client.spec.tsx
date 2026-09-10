// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocalVideoSourcePanel } from '../src/client/LocalVideoSourcePanel.tsx'
import type { LocalVideoSourcePacket, LocalVideoSourceScope, LocalVideoSourceState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const scope: LocalVideoSourceScope = { projectId: 'project_video', episodeId: 'episode_video', frameId: 'frame_video', assetId: 'asset_localvideo_01' }
const binding = { ...scope, takeId: scope.assetId, assetSha256: 'a'.repeat(64), uploadReceiptSha256: 'b'.repeat(64),
  uploadRequestSha256: 'c'.repeat(64), frameContentSha256: 'd'.repeat(64), storyboardRevision: 3 }
const record = (contents: string) => ({ sha256: createHash('sha256').update(contents).digest('hex'), contentBase64: Buffer.from(contents).toString('base64') })
const packet: LocalVideoSourcePacket = { schema: 'jason.qingmu-external-video-records.v1', recordFormat: 'libtv_saved',
  inputRecord: record('{"input":1}'), resultRecord: record('{"result":2}'), mediaRecord: record('{"media":3}') }

function sourceState(overrides: Partial<LocalVideoSourceState> = {}): LocalVideoSourceState {
  return { schema: 'jason.qingmu-local-video-source-state.v1', binding, registrationCount: 0, latestRegistration: null,
    bindingStatus: 'unregistered', canRegister: true, providerCalls: 0, selectionChanged: false, formalApprovalChanged: false, ...overrides }
}

function result(request: { readonly idempotencyKey: string; readonly requestSha256: string }, bindingStatus: 'current' | 'stale' = 'current') {
  const receipt = { schema: 'jason.qingmu-local-video-source-registration.v1' as const, idempotencyKey: request.idempotencyKey,
    registeredBy: 'studio-user', registrationId: 'source_123', binding, requestSha256: request.requestSha256, packetSha256: 'e'.repeat(64),
    recordFormat: 'libtv_saved' as const, provider: 'libtv' as const, model: 'seedance-3.0', providerTaskId: 'libtv-task-42',
    savedProviderStatus: 'SUCCEEDED', inputEvidenceSha256: packet.inputRecord.sha256, resultEvidenceSha256: packet.resultRecord.sha256,
    mediaEvidenceSha256: packet.mediaRecord.sha256, evidenceMode: 'imported_saved_records' as const,
    recordConsistencyVerified: false as const, providerExecutionVerified: false as const,
    providerCalls: 0 as const, selectionChanged: false as const, formalApprovalChanged: false as const }
  return { schema: 'jason.qingmu-local-video-source-result.v1' as const, receipt, bindingStatus,
    evidenceMode: 'imported_saved_records' as const, recordConsistencyVerified: false as const, providerExecutionVerified: false as const,
    providerCalls: 0 as const, selectionChanged: false as const, formalApprovalChanged: false as const }
}

function port(overrides: Record<string, unknown> = {}) {
  return { readLocalVideoSource: vi.fn(async () => sourceState()),
    registerLocalVideoSource: vi.fn(async (request: {
      idempotencyKey: string
      binding: typeof binding
      packet: LocalVideoSourcePacket
    }) => {
      const raw = JSON.stringify({ binding: request.binding, packet: request.packet }, Object.keys({ binding: 1, packet: 1 }).sort())
      return result({ idempotencyKey: request.idempotencyKey, requestSha256: createHash('sha256').update(raw).digest('hex') })
    }),
    recoverLocalVideoSource: vi.fn(async (request: { idempotencyKey: string; requestSha256: string }) => result(request)), ...overrides }
}

function fileInput(view: ReturnType<typeof render>): HTMLInputElement {
  const input = view.container.querySelector('input[type=file]')
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing record package input')
  return input
}

function choose(view: ReturnType<typeof render>) {
  const file = new File([JSON.stringify(packet)], 'saved-lib-tv.json', { type: 'application/json' })
  fireEvent.change(fileInput(view), { target: { files: [file] } })
}

beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('reads the current local candidate without posting a record package', async () => {
  const value = port()
  render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  expect(value.readLocalVideoSource).toHaveBeenCalledWith(scope, expect.any(AbortSignal))
  expect(value.registerLocalVideoSource).not.toHaveBeenCalled()
  expect(value.recoverLocalVideoSource).not.toHaveBeenCalled()
})

it('posts one explicit packet and keeps the source record separate from adoption', async () => {
  const value = port()
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  choose(view)
  await screen.findByText('三份记录已载入，尚未提交。')
  expect(value.registerLocalVideoSource).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '登记来源记录' }))
  await screen.findByText('来源记录已保存 · 未向平台核验。登记绑定当前镜头版本；采用还需完成检查。')
  expect(value.registerLocalVideoSource).toHaveBeenCalledOnce()
  const request = value.registerLocalVideoSource.mock.calls[0]?.[0]
  if (request === undefined) throw new Error('Missing source registration request')
  expect(request).toMatchObject({ ...scope, binding, packet })
  expect(screen.queryByText(/已采用|检查通过/)).toBeNull()
  expect(sessionStorage.getItem(`qingmu.local-video-source-recovery.v1:${scope.projectId}:${scope.episodeId}:${scope.frameId}:${scope.assetId}`)).toBeNull()
})

it('recovers a lost acknowledgement through GET after refresh without another POST', async () => {
  const registerLocalVideoSource = vi.fn(async () => { throw new Error('network disconnected') })
  const value = port({ registerLocalVideoSource })
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包'); choose(view)
  await screen.findByText('三份记录已载入，尚未提交。')
  fireEvent.click(screen.getByRole('button', { name: '登记来源记录' }))
  await screen.findByText(/登记结果待恢复；不会自动再次提交/)
  expect(registerLocalVideoSource).toHaveBeenCalledOnce()
  const recoveryStorageKey = `qingmu.local-video-source-recovery.v1:${scope.projectId}:${scope.episodeId}:${scope.frameId}:${scope.assetId}`
  const marker = sessionStorage.getItem(recoveryStorageKey)
  expect(marker).toContain('requestSha256')
  expect(marker).not.toContain('contentBase64')
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByText('已读取先前登记回执；未再次提交记录包。')
  expect(registerLocalVideoSource).toHaveBeenCalledOnce()
  expect(value.recoverLocalVideoSource).toHaveBeenCalledOnce()
  view.unmount()
})

it('drops a slow older packet after a newer file selection', async () => {
  let resolveSlow!: (value: string) => void
  const slow = new File(['placeholder'], 'slow.json', { type: 'application/json' })
  Object.defineProperty(slow, 'text', { value: () => new Promise<string>((resolve) => { resolveSlow = resolve }) })
  const value = port()
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  fireEvent.change(fileInput(view), { target: { files: [slow] } })
  choose(view)
  await screen.findByText('三份记录已载入，尚未提交。')
  resolveSlow('{bad json')
  await waitFor(() => {
    expect(screen.getByText('三份记录已载入，尚未提交。')).toBeTruthy()
    expect(screen.queryByText('无法读取该 JSON 记录包。')).toBeNull()
  })
})

it('drops a pending packet read after changing the candidate scope', async () => {
  let resolveSlow!: (value: string) => void
  const slow = new File(['placeholder'], 'slow.json', { type: 'application/json' })
  Object.defineProperty(slow, 'text', { value: () => new Promise<string>((resolve) => { resolveSlow = resolve }) })
  const value = port()
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  fireEvent.change(fileInput(view), { target: { files: [slow] } })
  view.rerender(<LocalVideoSourcePanel scope={{ ...scope, assetId: 'asset_localvideo_02' }} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  resolveSlow(JSON.stringify(packet))
  await waitFor(() => { expect(screen.queryByText('三份记录已载入，尚未提交。')).toBeNull() })
})

it('clears a known 422 rejection so a corrected package can be explicitly registered', async () => {
  const registerLocalVideoSource = vi.fn(async () => { throw new Error('422 packet digest mismatch') })
  const value = port({ registerLocalVideoSource })
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包'); choose(view)
  await screen.findByText('三份记录已载入，尚未提交。')
  fireEvent.click(screen.getByRole('button', { name: '登记来源记录' }))
  await screen.findByText('记录包未通过登记校验。请更正后明确重新登记；系统不会自动重传。')
  expect(sessionStorage.getItem(`qingmu.local-video-source-recovery.v1:${scope.projectId}:${scope.episodeId}:${scope.frameId}:${scope.assetId}`)).toBeNull()
  expect(view.container.querySelector('input[type=file]')).toBeTruthy()
  expect(registerLocalVideoSource).toHaveBeenCalledOnce()
})

it('keeps a confirmed receipt recoverable when browser marker cleanup fails', async () => {
  const value = port()
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  await screen.findByText('选择 JSON 记录包'); choose(view)
  await screen.findByText('三份记录已载入，尚未提交。')
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage locked') })
  fireEvent.click(screen.getByRole('button', { name: '登记来源记录' }))
  await screen.findByText('来源记录已保存；本地恢复标记尚未清理，可稍后重试。')
  expect(screen.getByRole('button', { name: '清理本地恢复标记' })).toBeTruthy()
  expect(view.container.querySelector('input[type=file]')).toBeNull()
})

it('cancels an old candidate read and never renders its receipt for the next candidate', async () => {
  let resolveOld!: (value: LocalVideoSourceState) => void
  const readLocalVideoSource = vi.fn(({ assetId }: LocalVideoSourceScope) => assetId === scope.assetId
    ? new Promise<LocalVideoSourceState>((resolve) => { resolveOld = resolve })
    : Promise.resolve(sourceState({ binding: { ...binding, assetId: 'asset_localvideo_02', takeId: 'asset_localvideo_02' } })))
  const value = port({ readLocalVideoSource })
  const view = render(<LocalVideoSourcePanel scope={scope} port={value} />)
  const next = { ...scope, assetId: 'asset_localvideo_02' }
  view.rerender(<LocalVideoSourcePanel scope={next} port={value} />)
  await screen.findByText('选择 JSON 记录包')
  resolveOld(sourceState({ latestRegistration: result({ idempotencyKey: 'local-video-source-old-key-123456', requestSha256: 'f'.repeat(64) }).receipt, registrationCount: 1, bindingStatus: 'current' }))
  await waitFor(() => { expect(screen.queryByText('来源记录已保存')).toBeNull() })
  expect(readLocalVideoSource).toHaveBeenCalledTimes(2)
})
