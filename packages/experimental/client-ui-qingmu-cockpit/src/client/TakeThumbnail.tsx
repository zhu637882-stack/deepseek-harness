import { useEffect, useState } from 'react'
import type { QingmuYimengPort, YimengTakePreviewRequest } from './contracts.ts'

// Only small JPEG posters survive decoding; never retain full historical videos in this cache.
const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

/** Decode a poster from an authenticated, hash-verified existing video. No generation or writes. */
async function poster(request: YimengTakePreviewRequest, load: QingmuYimengPort['takePreview']): Promise<string> {
  const controller = new AbortController()
  const deadline = setTimeout(() => { controller.abort() }, 45000)
  let url: string | undefined
  let video: HTMLVideoElement | undefined
  try {
    const result = await load(request, controller.signal)
    if (controller.signal.aborted || result.projectId !== request.projectId || result.episodeId !== request.episodeId
      || result.frameId !== request.frameId || result.takeId !== request.takeId
      || result.outputSha256 !== request.expectedOutputSha256) throw new Error('thumbnail scope mismatch')
    const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      b => b.toString(16).padStart(2, '0')).join('')
    if (digest !== request.expectedOutputSha256) throw new Error('thumbnail hash mismatch')
    url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
    const sourceUrl = url
    video = document.createElement('video')
    const element = video
    element.muted = true
    element.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('thumbnail decode timed out')) }, 10000)
      const finish = (error?: Error): void => { clearTimeout(timer); if (error) reject(error); else resolve() }
      element.onloadeddata = () => { finish() }
      element.onerror = () => { finish(new Error('thumbnail decode failed')) }
      element.src = sourceUrl
      element.load()
    })
    if (!element.videoWidth || !element.videoHeight) throw new Error('thumbnail dimensions missing')
    const canvas = document.createElement('canvas')
    const scale = Math.min(240 / element.videoWidth, 240 / element.videoHeight, 1)
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('thumbnail canvas unavailable')
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    clearTimeout(deadline)
    if (video) { video.onloadeddata = null; video.onerror = null; video.removeAttribute('src'); video.load() }
    if (url) URL.revokeObjectURL(url)
  }
}

/** Serial decoding limits memory and shares a poster between its shot row and candidate card. */
export function TakeThumbnail({ request, load, className, alt }: {
  readonly request: YimengTakePreviewRequest
  readonly load: QingmuYimengPort['takePreview']
  readonly className: string | undefined
  readonly alt: string
}) {
  const key = [request.projectId, request.episodeId, request.frameId, request.takeId, request.expectedOutputSha256].join('\0')
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>()
  useEffect(() => {
    let mounted = true
    let pending = cache.get(key)
    if (!pending) {
      pending = queue.then(() => poster(request, load))
      queue = pending.catch(() => undefined)
      cache.set(key, pending)
      const oldest = cache.keys().next().value
      if (cache.size > 32 && oldest !== undefined) cache.delete(oldest)
      void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key) })
    }
    void pending.then((url) => { if (mounted) setState({ key, url }) }, () => { if (mounted) setState({ key, failed: true }) })
    return () => { mounted = false }
  }, [key, load])
  return state?.key === key && state.url
    ? <img className={className} src={state.url} alt={alt} />
    : <span className={className}>{state?.key === key && state.failed ? '缩略图读取失败' : '读取缩略图…'}</span>
}
