// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { inspectPcmWav, LocalVoiceCandidateUpload } from '../src/client/LocalVoiceCandidateUpload.tsx'
import type {
  LocalVoiceContentRequest,
  LocalVoiceUploadRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const scope = { projectId: 'project_voice', targetId: 'actor_voice' }
const BASE64_WAVE = makeWave()
let revokeObjectUrl: ReturnType<typeof vi.fn>
const result = {
  schema: 'jason.qingmu-local-voice-candidate.v1' as const,
  ...scope,
  elementKind: 'actor' as const,
  assetId: 'asset_localvoice_1',
  idempotencyKey: 'local-voice-test-0001',
  requestSha256: 'a'.repeat(64),
  originalFileName: 'linyu.wav',
  byteSize: 8044,
  mimeType: 'audio/wav' as const,
  inputSha256: 'b'.repeat(64),
  materializedSha256: 'b'.repeat(64),
  durationSec: 1,
  sampleRate: 8000,
  channels: 1,
  sourceDeclaration: 'local_file_unverified' as const,
  rightsStatus: 'not_recorded' as const,
  selectionStatus: 'Unselected' as const,
  isSelected: false as const,
  providerCalls: 0 as const,
  generationQueued: false as const,
}

function makeWave(seconds = 1): string {
  const sampleRate = 8000
  const bytes = new Uint8Array(44 + sampleRate * seconds)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index)
  }
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true); view.setUint16(32, 1, true)
  view.setUint16(34, 8, true); write(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function file(base64 = BASE64_WAVE, name = 'linyu.wav'): File {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  const value = new File([bytes], name, { type: 'audio/wav' })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) })
  return value
}

function waveBytes(base64 = BASE64_WAVE): Uint8Array {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    uploadLocalVoiceCandidate: vi.fn<(request: LocalVoiceUploadRequest) => Promise<typeof result>>(async () => result),
    recoverLocalVoiceCandidate: vi.fn<(request: LocalVoiceUploadRequest) => Promise<typeof result>>(async () => result),
    readLocalVoiceCandidateContent: vi.fn<(request: LocalVoiceContentRequest) => Promise<{
      readonly schema: 'jason.qingmu-local-voice-content.v1'
      readonly assetId: string
      readonly sha256: string
      readonly mimeType: 'audio/wav'
      readonly contentBase64: string
    }>>(async () => ({
      schema: 'jason.qingmu-local-voice-content.v1' as const,
      assetId: result.assetId,
      sha256: result.materializedSha256,
      mimeType: 'audio/wav' as const,
      contentBase64: BASE64_WAVE,
    })),
    ...overrides,
  }
}

function mount(
  value: ReturnType<typeof port>,
  onStored = vi.fn(async () => {}),
  retainedReceipt?: typeof result,
  onReceipt = vi.fn(),
) {
  return {
    onStored,
    onReceipt,
    ...render(<LocalVoiceCandidateUpload {...scope} targetName="林予" port={value} retainedReceipt={retainedReceipt} onReceipt={onReceipt} onStored={onStored} />),
  }
}

function StatefulVoiceUpload({ value, onStored }: {
  readonly value: ReturnType<typeof port>
  readonly onStored: () => Promise<void>
}) {
  const [retainedReceipt, setRetainedReceipt] = useState<typeof result>()
  return <LocalVoiceCandidateUpload
    {...scope}
    targetName="林予"
    port={value}
    retainedReceipt={retainedReceipt}
    onReceipt={setRetainedReceipt}
    onStored={onStored}
  />
}

function mountStateful(value: ReturnType<typeof port>, onStored = vi.fn(async () => {})) {
  return { onStored, ...render(<StatefulVoiceUpload value={value} onStored={onStored} />) }
}

async function chooseWav(container: HTMLElement): Promise<void> {
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  await waitFor(() => { expect(input.disabled).toBe(false) })
  fireEvent.change(input, { target: { files: [file()] } })
  await screen.findByRole('button', { name: '保存音色文件' })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  revokeObjectUrl = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:voice-preview'), revokeObjectURL: revokeObjectUrl })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('accepts one to fifteen second PCM WAV only', () => {
  const bytes = waveBytes()
  expect(inspectPcmWav(bytes)).toMatchObject({ durationSec: 1, sampleRate: 8000, channels: 1 })
  expect(inspectPcmWav(Uint8Array.of(1, 2, 3))).toBeUndefined()
  expect(inspectPcmWav(Uint8Array.from(atob(makeWave(16)), character => character.charCodeAt(0)))).toBeUndefined()
})

it('rejects malformed PCM WAV headers before retaining or submitting the file', async () => {
  const badLength = waveBytes()
  new DataView(badLength.buffer).setUint32(4, badLength.byteLength - 9, true)
  expect(inspectPcmWav(badLength)).toBeUndefined()
  const badRate = waveBytes()
  const rateView = new DataView(badRate.buffer)
  rateView.setUint32(24, 100_000, true)
  rateView.setUint32(28, 100_000, true)
  expect(inspectPcmWav(badRate)).toBeUndefined()

  const value = port()
  const view = mount(value)
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  await waitFor(() => { expect(input.disabled).toBe(false) })
  fireEvent.change(input, { target: { files: [file(BASE64_WAVE, 'linyu.mp3')] } })
  await screen.findByText('请选择不超过 8 MiB 的 WAV 音色文件。')
  expect(value.uploadLocalVoiceCandidate).not.toHaveBeenCalled()
})

it('persists before a single upload, refreshes assets, and leaves the actor unadopted', async () => {
  const value = port()
  const { container, onStored } = mount(value)
  await chooseWav(container)
  fireEvent.click(await screen.findByRole('button', { name: '保存音色文件' }))
  await screen.findByText('音色文件已保存，可在项目素材中试听和引用。')
  expect(value.uploadLocalVoiceCandidate).toHaveBeenCalledOnce()
  expect(value.uploadLocalVoiceCandidate.mock.calls[0]![0]).toMatchObject({
    ...scope, elementKind: 'actor', originalFileName: 'linyu.wav', sourceDeclaration: 'local_file_unverified',
  })
  expect(value.uploadLocalVoiceCandidate.mock.calls[0]![0].idempotencyKey).toMatch(/^local-voice-/)
  expect(onStored).toHaveBeenCalledOnce()
  expect(screen.getByText('上传记录：作为本地参考文件保存。')).toBeTruthy()
})

it('recovers an unknown upload explicitly without silently reposting', async () => {
  const value = port({ uploadLocalVoiceCandidate: vi.fn(async () => { throw new Error('connection lost') }) })
  const first = mount(value)
  await chooseWav(first.container)
  fireEvent.click(await screen.findByRole('button', { name: '保存音色文件' }))
  await screen.findByText('connection lost')
  first.unmount()
  mount(value)
  fireEvent.click(await screen.findByRole('button', { name: '恢复本次回执' }))
  await screen.findByText('音色文件已保存，可在项目素材中试听和引用。')
  expect(value.uploadLocalVoiceCandidate).toHaveBeenCalledOnce()
  expect(value.recoverLocalVoiceCandidate).toHaveBeenCalledOnce()
})

it('only reads private WAV bytes when the user explicitly auditions the receipt', async () => {
  const value = port()
  const view = mount(value)
  await chooseWav(view.container)
  fireEvent.click(await screen.findByRole('button', { name: '保存音色文件' }))
  await screen.findByText('音色文件已保存，可在项目素材中试听和引用。')
  expect(value.readLocalVoiceCandidateContent).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '试听本次音色' }))
  await waitFor(() => { expect(value.readLocalVoiceCandidateContent).toHaveBeenCalledOnce() })
  expect(value.readLocalVoiceCandidateContent.mock.calls[0]![0]).toMatchObject({
    ...scope, elementKind: 'actor', assetId: result.assetId, expectedSha256: result.materializedSha256,
  })
  expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('blob:voice-preview')
})

it('keeps the confirmed receipt visible when the later asset refresh fails', async () => {
  const onStored = vi.fn(async () => { throw new Error('asset refresh offline') })
  const value = port()
  const view = mountStateful(value, onStored)
  await chooseWav(view.container)
  fireEvent.click(screen.getByRole('button', { name: '保存音色文件' }))
  await screen.findByText('音色已保存，但素材库刷新失败：asset refresh offline')
  expect(screen.getByRole('article', { name: '音色上传回执' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '恢复本次回执' })).toBeNull()
  expect(value.uploadLocalVoiceCandidate).toHaveBeenCalledOnce()
})

it('keeps server confirmation when local cleanup fails and retries cleanup without provider I/O', async () => {
  const value = port()
  const view = mountStateful(value)
  await chooseWav(view.container)
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage offline') })
  fireEvent.click(screen.getByRole('button', { name: '保存音色文件' }))
  await screen.findByText('音色已保存，但浏览器未能清理本地恢复记录。可以重试整理，不会再次上传。')
  expect(screen.getByRole('article', { name: '音色上传回执' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '恢复本次回执' })).toBeNull()
  expect(screen.queryByRole('button', { name: '保存音色文件' })).toBeNull()
  expect(view.onStored).not.toHaveBeenCalled()
  remove.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '重试整理本地记录' }))
  await waitFor(() => { expect(view.onStored).toHaveBeenCalledOnce() })
  expect(screen.queryByRole('button', { name: '重试整理本地记录' })).toBeNull()
  expect(value.uploadLocalVoiceCandidate).toHaveBeenCalledOnce()
  expect(value.recoverLocalVoiceCandidate).not.toHaveBeenCalled()
})

it('with a stateful parent, completes once then accepts a new WAV and clears its old audition URL', async () => {
  const value = port()
  const view = mountStateful(value)
  await chooseWav(view.container)
  fireEvent.click(screen.getByRole('button', { name: '保存音色文件' }))
  await screen.findByRole('article', { name: '音色上传回执' })
  fireEvent.click(screen.getByRole('button', { name: '试听本次音色' }))
  await waitFor(() => { expect(view.container.querySelector('audio')).not.toBeNull() })
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file(BASE64_WAVE, 'second.wav')] } })
  await screen.findByText('second.wav')
  expect(screen.queryByRole('article', { name: '音色上传回执' })).toBeNull()
  expect(revokeObjectUrl).toHaveBeenCalledWith('blob:voice-preview')
})

it('unlocks a newly selected actor while an earlier scope upload resolves late', async () => {
  let finishUpload!: (value: typeof result) => void
  const value = port({ uploadLocalVoiceCandidate: vi.fn(() => new Promise<typeof result>((resolve) => { finishUpload = resolve })) })
  const view = mount(value)
  await chooseWav(view.container)
  fireEvent.click(screen.getByRole('button', { name: '保存音色文件' }))
  await waitFor(() => { expect(value.uploadLocalVoiceCandidate).toHaveBeenCalledOnce() })
  expect((view.container.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true)
  view.rerender(<LocalVoiceCandidateUpload projectId={scope.projectId} targetId="actor_other" targetName="周宁" port={value} retainedReceipt={result} onReceipt={vi.fn()} onStored={vi.fn(async () => {})} />)
  const otherInput = view.container.querySelector('input[type=file]') as HTMLInputElement
  await waitFor(() => { expect(otherInput.disabled).toBe(false) })
  await act(async () => { finishUpload(result) })
  expect(screen.queryByText('音色文件已保存，可在项目素材中试听和引用。')).toBeNull()
})
