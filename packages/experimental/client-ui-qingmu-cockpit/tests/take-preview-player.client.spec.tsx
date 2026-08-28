// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TakePreviewPlayer } from '../src/client/TakePreviewPlayer.tsx'
import type { YimengTakePreviewResponse } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'

const data = Buffer.from('fixture media bytes')
const sha = createHash('sha256').update(data).digest('hex')
const request = { projectId: 'p', episodeId: 'e', frameId: 'f', takeId: 't', expectedOutputSha256: sha }
const response: YimengTakePreviewResponse = {
  schema: 'jason.qingmu-take-preview.v1', projectId: 'p', episodeId: 'e', frameId: 'f', takeId: 't',
  outputSha256: sha, mimeType: 'video/mp4', bytes: data.length, base64: data.toString('base64'),
  readOnly: true, providerCalls: 0, databaseWrites: 0,
}
const createUrl = vi.fn(() => 'blob:fixture')
const revokeUrl = vi.fn()
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('loads only explicitly, prevents duplicate clicks and revokes bytes on source unmount', async () => {
  let resolve!: (value: YimengTakePreviewResponse) => void
  const load = vi.fn(() => new Promise<YimengTakePreviewResponse>((done) => { resolve = done }))
  const view = render(<TakePreviewPlayer request={request} load={load} t={key => zh[key]} />)
  expect(load).not.toHaveBeenCalled()
  const button = screen.getByRole('button', { name: zh.takePreviewLoad })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(load).toHaveBeenCalledTimes(1)
  resolve(response)
  await waitFor(() => { expect(view.container.querySelector('video')?.src).toBe('blob:fixture') })
  expect(createUrl).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:fixture')
})

it('aborts an unmounted source and never creates a blob from a late response', async () => {
  let resolve!: (value: YimengTakePreviewResponse) => void
  const load = vi.fn((_request: typeof request, _signal?: AbortSignal) =>
    new Promise<YimengTakePreviewResponse>((done) => { resolve = done }))
  const view = render(<TakePreviewPlayer request={request} load={load} t={key => zh[key]} />)
  fireEvent.click(screen.getByRole('button', { name: zh.takePreviewLoad }))
  view.unmount()
  expect(load.mock.calls[0]?.[1]?.aborted).toBe(true)
  resolve(response)
  await Promise.resolve()
  expect(createUrl).not.toHaveBeenCalled()
})

it('keeps failures explicit and permits a new explicit retry without generating anything', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValue(response)
  const view = render(<TakePreviewPlayer request={request} load={load} t={key => zh[key]} />)
  fireEvent.click(screen.getByRole('button', { name: zh.takePreviewLoad }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.takePreviewError)
  expect(createUrl).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.takePreviewLoad }))
  await waitFor(() => { expect(view.container.querySelector('video')).not.toBeNull() })
  expect(load).toHaveBeenCalledTimes(2)
})
