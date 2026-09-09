// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TakeThumbnail } from '../src/client/TakeThumbnail.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function fixture(id: string) {
  const base64 = btoa('existing-video')
  const sha = createHash('sha256').update('existing-video').digest('hex')
  const request = { projectId: 'p', episodeId: 'e', frameId: 'f', takeId: id, expectedOutputSha256: sha }
  const response = { ...request, outputSha256: sha, mimeType: 'video/mp4', bytes: 14, base64 }
  vi.stubGlobal('crypto', webcrypto)
  return { request, response }
}
describe('verified video thumbnails', () => {
  it('does not read an offscreen video and aborts its active read when it leaves the viewport', async () => {
    const { request } = fixture('viewport')
    let update: IntersectionObserverCallback = () => undefined
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { update = callback }
      observe() {}
      disconnect = disconnect
    })
    let signal: AbortSignal | undefined
    const load = vi.fn((_request, incoming: AbortSignal) => new Promise((_, reject) => {
      signal = incoming
      incoming.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }))
    const view = render(<TakeThumbnail request={request} load={load as never} className="thumb" alt="可见候选" />)
    await act(async () => {})
    expect(load).not.toHaveBeenCalled()
    act(() => { update([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver) })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    act(() => { update([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver) })
    expect(signal?.aborted).toBe(true)
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
  it('cancels an abandoned queued read while retaining the shared active read until its last viewer leaves', async () => {
    const active = fixture('shared-cancel')
    const queued = fixture('queued-cancel')
    let signal: AbortSignal | undefined
    const load = vi.fn((_request, incoming: AbortSignal) => new Promise((_, reject) => {
      signal = incoming
      incoming.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }))
    const props = { load: load as never, className: 'thumb', alt: '共享候选' }
    const first = render(<TakeThumbnail {...props} request={active.request} />)
    const second = render(<TakeThumbnail {...props} request={active.request} />)
    const last = render(<TakeThumbnail {...props} request={queued.request} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    first.unmount()
    expect(signal?.aborted).toBe(false)
    last.unmount()
    second.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
  })
  it.each(['scope', 'hash'])('does not decode a %s mismatch', async (mismatch) => {
    const { request, response } = fixture(mismatch)
    const load = vi.fn(async () => mismatch === 'scope' ? { ...response, frameId: 'other' } : { ...response, base64: btoa('tamper') })
    render(<TakeThumbnail request={request} load={load as never} className="thumb" alt="候选第一帧" />)
    expect(await screen.findByText('缩略图读取失败')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('shares one verified decode between row and card and releases the video URL', async () => {
    const { request, response } = fixture('success')
    const create = vi.fn(() => 'blob:existing-video')
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke })
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(720)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
      if (this.getAttribute('src')) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')))
    })
    const draw = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,cG9zdGVy')
    const load = vi.fn(async () => response)
    render(<><TakeThumbnail request={request} load={load as never} className="thumb" alt="镜头缩略图" />
      <TakeThumbnail request={request} load={load as never} className="thumb" alt="候选第一帧" /></>)
    await waitFor(() => { expect(screen.getAllByRole('img')).toHaveLength(2) })
    expect(load).toHaveBeenCalledTimes(1)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:existing-video')
  })
})
