// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocalReferenceCandidateUpload } from '../src/client/LocalReferenceCandidateUpload.tsx'
import { zh } from '../src/client/locales.ts'
import type {
  LocalReferenceCandidateResult,
  LocalReferenceUploadRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const BYTES = Uint8Array.from(atob(PNG_BASE64), value => value.charCodeAt(0))
const scope = { projectId: 'project_1', elementKind: 'actor' as const, targetId: 'actor_1' }
const t = (key: keyof typeof zh) => zh[key]
const result: LocalReferenceCandidateResult = {
  schema: 'jason.qingmu-local-reference-candidate-result.v1', ...scope,
  assetId: 'asset_localref_1', storageKey: 'qingmu/reference_candidates/abc/asset_localref_1.png',
  profileRevision: 2, baseSnapshotSha256: 'a'.repeat(64), elementSnapshotSha256: 'b'.repeat(64),
  originalFileName: 'face.png', byteSize: BYTES.byteLength, mimeType: 'image/png', width: 1, height: 1,
  inputSha256: 'c'.repeat(64), materializedSha256: 'c'.repeat(64),
  sourceDeclaration: 'local_file_unverified', rightsStatus: 'not_recorded',
  selectionStatus: 'Unselected', isSelected: false, idempotencyKey: 'local-ref-test-0001',
  requestSha256: 'd'.repeat(64), commandReceiptId: 'receipt_1', changeSetId: 'changeset_1', eventId: 'event_1',
  providerCalls: 0, stageStarted: false, approvalGranted: false, selectionGranted: false, rightsRecorded: false,
}
const emptyList = { schema: 'jason.qingmu-local-reference-candidates.v1' as const, ...scope, candidates: [],
  providerCalls: 0 as const, stageStarted: false as const, approvalGranted: false as const,
  selectionGranted: false as const, rightsRecorded: false as const }
const storedList = { ...emptyList, candidates: [result] }

function file(bytes = BYTES, name = 'face.png'): File {
  const value = new File([bytes], name, { type: 'image/png' })
  Object.defineProperty(value, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
  return value
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    listLocalReferenceCandidates: vi.fn().mockResolvedValueOnce(emptyList).mockResolvedValue(storedList),
    uploadLocalReferenceCandidate: vi.fn(async (_request: LocalReferenceUploadRequest) => result),
    recoverLocalReferenceCandidate: vi.fn(async (_request: LocalReferenceUploadRequest) => result),
    readLocalReferenceCandidateContent: vi.fn(async () => ({
      schema: 'jason.qingmu-local-reference-candidate-content.v1', assetId: result.assetId,
      sha256: result.materializedSha256, mimeType: 'image/png', contentBase64: PNG_BASE64,
    } as const)),
    ...overrides,
  }
}

function mount(value: ReturnType<typeof port>, onStored = vi.fn(async () => {})) {
  return { onStored, ...render(<LocalReferenceCandidateUpload {...scope} targetName="林夏" port={value} t={t} onStored={onStored} />) }
}

beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uploads once, shows exact candidate boundary and clears retained input only after readback', async () => {
  const value = port()
  const { container, onStored } = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  const submit = await screen.findByRole('button', { name: zh.assetUploadSubmit })
  fireEvent.click(submit); fireEvent.click(submit)
  await screen.findByText(zh.assetUploadStored)
  expect(value.uploadLocalReferenceCandidate).toHaveBeenCalledOnce()
  const request = value.uploadLocalReferenceCandidate.mock.calls[0]![0]
  expect(request).toMatchObject({ ...scope, originalFileName: 'face.png', contentBase64: PNG_BASE64,
    sourceDeclaration: 'local_file_unverified' })
  expect(request.idempotencyKey).toMatch(/^local-ref-/)
  expect(screen.getAllByText(zh.assetUploadCandidateStateValue).length).toBeGreaterThan(0)
  expect(screen.getByText(zh.assetUploadSourceValue)).toBeTruthy()
  expect(screen.getByText(zh.assetUploadRightsValue)).toBeTruthy()
  expect(localStorage.length).toBe(0)
  expect(onStored).toHaveBeenCalledOnce()
})

it('retains an unknown submission across remount and only performs GET-style recovery', async () => {
  const value = port({ uploadLocalReferenceCandidate: vi.fn(async () => { throw new Error('connection lost') }) })
  const first = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(first.container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadSubmit }))
  await screen.findByText('connection lost')
  expect(localStorage.getItem('qingmu.local-reference.v1:project_1:actor:actor_1')).toContain('"pending":true')
  first.unmount()
  mount(value)
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadRecover }))
  await screen.findByText(zh.assetUploadStored)
  expect(value.uploadLocalReferenceCandidate).toHaveBeenCalledOnce()
  expect(value.recoverLocalReferenceCandidate).toHaveBeenCalledOnce()
})

it('requires an explicit same-key retry after recovery proves the receipt is absent', async () => {
  const upload = vi.fn()
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(result)
  const value = port({
    uploadLocalReferenceCandidate: upload,
    recoverLocalReferenceCandidate: vi.fn(async () => { throw new Error('404 local_reference_receipt_not_found') }),
  })
  const view = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadSubmit }))
  await screen.findByText('connection lost')
  const firstKey = (upload.mock.calls[0]![0] as LocalReferenceUploadRequest).idempotencyKey
  fireEvent.click(screen.getByRole('button', { name: zh.assetUploadRecover }))
  await screen.findByText(zh.assetUploadReceiptMissing)
  expect(upload).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.assetUploadRetry }))
  await screen.findByText(zh.assetUploadStored)
  expect(upload).toHaveBeenCalledTimes(2)
  expect((upload.mock.calls[0]![0] as LocalReferenceUploadRequest).idempotencyKey).toBe(firstKey)
  expect((upload.mock.calls[1]![0] as LocalReferenceUploadRequest).idempotencyKey).toBe(firstKey)
})

it('does not release the upload lock before the candidate list readback finishes', async () => {
  let finishReadback!: (value: typeof storedList) => void
  const readback = new Promise<typeof storedList>((resolve) => { finishReadback = resolve })
  const value = port({
    listLocalReferenceCandidates: vi.fn().mockResolvedValueOnce(emptyList).mockReturnValueOnce(readback),
  })
  const view = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file()] } })
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadSubmit }))
  await waitFor(() => { expect(value.uploadLocalReferenceCandidate).toHaveBeenCalledOnce() })
  expect(input.disabled).toBe(true)
  expect(localStorage.length).toBe(1)
  await act(async () => { finishReadback(storedList) })
  await screen.findByText(zh.assetUploadStored)
  expect(input.disabled).toBe(false)
  expect(localStorage.length).toBe(0)
})

it('clears a confirmed intent before a parent refresh unmounts the uploader', async () => {
  const value = port()
  const viewRef: { current?: ReturnType<typeof mount> } = {}
  const onStored = vi.fn(async () => { viewRef.current?.unmount() })
  const view = mount(value, onStored)
  viewRef.current = view
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadSubmit }))
  await waitFor(() => { expect(onStored).toHaveBeenCalledOnce() })
  expect(localStorage.length).toBe(0)
})

it('keeps dirty input in process memory when localStorage rejects the write', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const value = port()
  const first = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(first.container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  await screen.findByText(zh.assetUploadPersistWarning)
  first.unmount()
  mount(value)
  expect(await screen.findByText('face.png')).toBeTruthy()
  setItem.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: zh.assetUploadSubmit }))
  await screen.findByText(zh.assetUploadStored)
})

it('ignores a late response after scope exit and keeps the durable pending intent', async () => {
  let resolve!: (value: LocalReferenceCandidateResult) => void
  const value = port({
    uploadLocalReferenceCandidate: vi.fn(() => new Promise<LocalReferenceCandidateResult>((done) => { resolve = done })),
  })
  const view = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file()] } })
  fireEvent.click(await screen.findByRole('button', { name: zh.assetUploadSubmit }))
  view.unmount()
  await act(async () => { resolve(result) })
  expect(view.onStored).not.toHaveBeenCalled()
  expect(localStorage.getItem('qingmu.local-reference.v1:project_1:actor:actor_1')).toContain('"pending":true')
})

it('rejects an oversized browser input without calling Host', async () => {
  const value = port()
  const { container } = mount(value)
  await screen.findByText(zh.assetUploadNoCandidates)
  const oversized = file(new Uint8Array(3 * 1024 * 1024 + 1))
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [oversized] } })
  await waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy() })
  expect(value.uploadLocalReferenceCandidate).not.toHaveBeenCalled()
})
