// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
