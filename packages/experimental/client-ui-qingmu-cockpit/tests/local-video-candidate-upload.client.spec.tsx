// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocalVideoCandidateUpload } from '../src/client/LocalVideoCandidateUpload.tsx'
import type { LocalVideoUploadRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import {
  clearLocalVideoRecovery, localVideoRecoveryKey, readLocalVideoRecovery, readLocalVideoRecoveryState,
  writeLocalVideoRecovery,
} from '../src/client/LocalVideoRecoveryStore.ts'

const scope = { projectId: 'project_video', episodeId: 'episode_video', frameId: 'frame_video' }
const bytes = Uint8Array.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])

function file(name = 'libtv-shot-01.mp4'): File {
  const value = new File([bytes], name, { type: 'video/mp4' })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) })
  return value
}

function receipt(request: { idempotencyKey: string; originalFileName: string; contentBase64: string }) {
  const inputSha256 = createHash('sha256').update(Buffer.from(request.contentBase64, 'base64')).digest('hex')
  const requestSha256 = createHash('sha256').update(JSON.stringify({
    contentSha256: inputSha256, episodeId: scope.episodeId, frameId: scope.frameId,
    originalFileName: request.originalFileName, sourceDeclaration: 'local_file_unverified',
  })).digest('hex')
  return {
    schema: 'jason.qingmu-local-video-candidate.v1' as const, ...scope,
    assetId: 'asset_localvideo_0123456789abcdef0123456789abcdef',
    takeId: 'asset_localvideo_0123456789abcdef0123456789abcdef',
    idempotencyKey: request.idempotencyKey, requestSha256, originalFileName: request.originalFileName,
    byteSize: bytes.byteLength, mimeType: 'video/mp4' as const, inputSha256, materializedSha256: inputSha256,
    durationSec: 3, width: 1280, height: 720, hasAudio: true,
    sourceDeclaration: 'local_file_unverified' as const, rightsStatus: 'not_recorded' as const,
    selectionStatus: 'Unselected' as const, isSelected: false as const, providerCalls: 0 as const,
    generationQueued: false as const,
  }
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    uploadLocalVideoCandidate: vi.fn(async (request: LocalVideoUploadRequest) => receipt(request)),
    recoverLocalVideoCandidate: vi.fn(async () => { throw new Error('404 receipt not found') }),
    ...overrides,
  }
}

async function choose(view: ReturnType<typeof render>, selected = file()) {
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [selected] } })
  await screen.findByRole('button', { name: '导入本镜候选' })
}

beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps only an exact small recovery marker, never video bytes', () => {
  const marker = { ...scope, idempotencyKey: 'local-video-12345678', requestSha256: 'a'.repeat(64), originalFileName: 'shot.mp4', byteSize: 16 }
  expect(writeLocalVideoRecovery(scope, marker)).toBe('written')
  expect(localStorage.getItem(localVideoRecoveryKey(scope))).not.toContain('contentBase64')
  expect(readLocalVideoRecovery(scope)).toEqual(marker)
  expect(clearLocalVideoRecovery(scope, { ...marker, requestSha256: 'b'.repeat(64) })).toBe(false)
  expect(clearLocalVideoRecovery(scope, marker)).toBe(true)
})

it('does not overwrite a different pending import and blocks corrupt recovery storage', () => {
  const first = { ...scope, idempotencyKey: 'local-video-first', requestSha256: 'a'.repeat(64), originalFileName: 'first.mp4', byteSize: 16 }
  const second = { ...first, idempotencyKey: 'local-video-second', requestSha256: 'b'.repeat(64) }
  expect(writeLocalVideoRecovery(scope, first)).toBe('written')
  expect(writeLocalVideoRecovery(scope, second)).toBe('conflict')
  expect(readLocalVideoRecovery(scope)).toEqual(first)
  localStorage.setItem(localVideoRecoveryKey(scope), '{bad json')
  expect(readLocalVideoRecoveryState(scope).status).toBe('corrupt')
  const view = render(<LocalVideoCandidateUpload {...scope} port={port()} onStored={vi.fn(async () => {})} />)
  expect(screen.getByText('本镜本地恢复记录损坏。为避免覆盖未知导入，暂不能提交新视频。')).toBeTruthy()
  expect((view.container.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true)
})

it('does not submit while browser recovery storage is unavailable', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => { throw new Error('quota unavailable') },
    removeItem: () => undefined,
  })
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('浏览器无法安全保存本次导入恢复记录，因此不会提交视频。')
  expect(value.uploadLocalVideoCandidate).not.toHaveBeenCalled()
})

it('does not upload when a storage write silently fails to persist the recovery marker', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('浏览器无法安全保存本次导入恢复记录，因此不会提交视频。')
  expect(value.uploadLocalVideoCandidate).not.toHaveBeenCalled()
})

it('persists before one explicit upload, refreshes the existing candidate rail, and marks it unadopted', async () => {
  const value = port()
  const onStored = vi.fn(async () => {})
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={onStored} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('视频已加入本镜候选条：本地导入，来源待核实，尚未采用。')
  expect(value.uploadLocalVideoCandidate).toHaveBeenCalledOnce()
  expect(onStored).toHaveBeenCalledOnce()
  expect(screen.getByText('本地导入，来源待核实，暂不可采用')).toBeTruthy()
})

it('allows a second explicit file import after a confirmed receipt clears its exact marker', async () => {
  const upload = vi.fn(async (request: LocalVideoUploadRequest) => receipt(request))
  const value = port({ uploadLocalVideoCandidate: upload })
  const onStored = vi.fn(async () => {})
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={onStored} />)

  await choose(view, file('ali-shot-01.mp4'))
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByRole('button', { name: '导入另一条视频' })
  expect(readLocalVideoRecovery(scope)).toBeUndefined()

  fireEvent.click(screen.getByRole('button', { name: '导入另一条视频' }))
  await choose(view, file('libtv-shot-01.mp4'))
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByRole('button', { name: '导入另一条视频' })

  expect(upload).toHaveBeenCalledTimes(2)
  expect(upload.mock.calls.map(([request]) => request.originalFileName)).toEqual(['ali-shot-01.mp4', 'libtv-shot-01.mp4'])
  expect(upload.mock.calls[1]?.[0].idempotencyKey).not.toBe(upload.mock.calls[0]?.[0].idempotencyKey)
  expect(onStored).toHaveBeenCalledTimes(2)
})

it('recovers an unknown response by GET only and leaves a 404 marker for a later check', async () => {
  const value = port({ uploadLocalVideoCandidate: vi.fn(async () => { throw new Error('connection lost') }) })
  const first = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  await choose(first)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('导入结果待恢复；系统不会自动再次提交。')
  expect(screen.queryByRole('button', { name: '导入本镜候选' })).toBeNull()
  expect(screen.queryByRole('button', { name: '导入另一条视频' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重新检查导入回执' }))
  await screen.findByText('暂未找到本次导入回执，请稍后重新检查；系统不会自动再次提交。')
  expect(value.uploadLocalVideoCandidate).toHaveBeenCalledOnce()
  expect(value.recoverLocalVideoCandidate).toHaveBeenCalledOnce()
  first.unmount()
  render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  fireEvent.click(await screen.findByRole('button', { name: '重新检查导入回执' }))
  await screen.findByText('暂未找到本次导入回执，请稍后重新检查；系统不会自动再次提交。')
  expect(value.uploadLocalVideoCandidate).toHaveBeenCalledOnce()
  expect(value.recoverLocalVideoCandidate).toHaveBeenCalledTimes(2)
  expect(readLocalVideoRecovery(scope)).toBeDefined()
  expect(screen.queryByRole('button', { name: '导入本镜候选' })).toBeNull()
  expect(screen.getByRole('button', { name: '重新检查导入回执' })).toBeTruthy()
})

it('keeps a known rejected file in memory for one explicit retry without treating it as unknown', async () => {
  const upload = vi.fn()
    .mockRejectedValueOnce(new Error('422 invalid duration'))
    .mockImplementation(async (request: LocalVideoUploadRequest) => receipt(request))
  const value = port({ uploadLocalVideoCandidate: upload })
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('该文件未通过导入校验。可更正后明确重新提交；系统不会自动重传。')
  expect(readLocalVideoRecovery(scope)).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: '明确重新提交此文件' }))
  await screen.findByText('视频已加入本镜候选条：本地导入，来源待核实，尚未采用。')
  expect(upload).toHaveBeenCalledTimes(2)
})

it('does not call upload again when an already confirmed receipt refresh fails', async () => {
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => { throw new Error('rail offline') })} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('视频已导入，但候选列表刷新失败：rail offline')
  expect(value.uploadLocalVideoCandidate).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '导入本镜候选' })).toBeNull()
})

it('rejects a receipt whose content materialization or Take binding differs from the exact file', async () => {
  const upload = vi.fn(async (request: LocalVideoUploadRequest) => ({
    ...receipt(request),
    materializedSha256: 'a'.repeat(64),
    takeId: 'take_other',
  }))
  const value = port({ uploadLocalVideoCandidate: upload })
  const onStored = vi.fn(async () => {})
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={onStored} />)
  await choose(view)
  fireEvent.click(screen.getByRole('button', { name: '导入本镜候选' }))
  await screen.findByText('导入回执与本镜文件不一致，未显示为候选。')
  expect(onStored).not.toHaveBeenCalled()
})

it('drops a late file read after changing the local-video scope', async () => {
  let resolveBytes!: (value: ArrayBuffer) => void
  const delayed = new File([bytes], 'late.mp4', { type: 'video/mp4' })
  Object.defineProperty(delayed, 'arrayBuffer', {
    configurable: true,
    value: () => new Promise<ArrayBuffer>((resolve) => { resolveBytes = resolve }),
  })
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [delayed] } })
  view.rerender(<LocalVideoCandidateUpload {...scope} frameId="frame_other" port={value} onStored={vi.fn(async () => {})} />)
  await act(async () => { resolveBytes(bytes.buffer.slice(0)) })
  await waitFor(() => { expect(screen.queryByRole('button', { name: '导入本镜候选' })).toBeNull() })
  expect(value.uploadLocalVideoCandidate).not.toHaveBeenCalled()
})

it('does not leave a recovery marker when the selected file cannot be reread before upload', async () => {
  let calls = 0
  const rereadFails = new File([bytes], 'read-fails.mp4', { type: 'video/mp4' })
  Object.defineProperty(rereadFails, 'arrayBuffer', {
    configurable: true,
    value: async () => {
      calls += 1
      if (calls === 1) return bytes.buffer.slice(0)
      throw new Error('file no longer readable')
    },
  })
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [rereadFails] } })
  fireEvent.click(await screen.findByRole('button', { name: '导入本镜候选' }))
  await screen.findByText(/无法读取该视频：file no longer readable/)
  expect(readLocalVideoRecovery(scope)).toBeUndefined()
  expect(value.uploadLocalVideoCandidate).not.toHaveBeenCalled()
})

it('does not leave a recovery marker when changing shots before the pre-upload reread completes', async () => {
  let calls = 0
  let resolveBytes!: (value: ArrayBuffer) => void
  const delayed = new File([bytes], 'switch-before-upload.mp4', { type: 'video/mp4' })
  Object.defineProperty(delayed, 'arrayBuffer', {
    configurable: true,
    value: () => {
      calls += 1
      return calls === 1 ? Promise.resolve(bytes.buffer.slice(0))
        : new Promise<ArrayBuffer>((resolve) => { resolveBytes = resolve })
    },
  })
  const value = port()
  const view = render(<LocalVideoCandidateUpload {...scope} port={value} onStored={vi.fn(async () => {})} />)
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [delayed] } })
  fireEvent.click(await screen.findByRole('button', { name: '导入本镜候选' }))
  await waitFor(() => { expect(calls).toBe(2) })
  view.rerender(<LocalVideoCandidateUpload {...scope} frameId="frame_other" port={value} onStored={vi.fn(async () => {})} />)
  await act(async () => { resolveBytes(bytes.buffer.slice(0)) })
  expect(readLocalVideoRecovery(scope)).toBeUndefined()
  expect(value.uploadLocalVideoCandidate).not.toHaveBeenCalled()
})
