import { useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort, YimengTakePreviewRequest } from './contracts.ts'

// Only small JPEG posters survive decoding; never retain full historical videos in this cache.
interface PosterJob { promise: Promise<string>; controller: AbortController; users: number; settled: boolean }
const cache = new Map<string, PosterJob>()
let queue: Promise<unknown> = Promise.resolve()

function trimCache(): void {
  for (const [key, job] of cache) {
    if (cache.size <= 32) break
    if (job.settled && job.users === 0) cache.delete(key)
  }
}

/** Decode a poster from an authenticated, hash-verified existing video. No generation or writes. */
async function poster(request: YimengTakePreviewRequest, load: QingmuYimengPort['takePreview'], controller: AbortController): Promise<string> {
  controller.signal.throwIfAborted()
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
    controller.signal.throwIfAborted()
    if (digest !== request.expectedOutputSha256) throw new Error('thumbnail hash mismatch')
    url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
    const sourceUrl = url
    video = document.createElement('video')
    const element = video
    element.muted = true
    element.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { finish(new Error('thumbnail decode timed out')) }, 10000)
      const abort = (): void => { finish(new Error('thumbnail cancelled')) }
      const finish = (error?: Error): void => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        if (error) reject(error); else resolve()
      }
      element.onloadeddata = () => { finish() }
      element.onerror = () => { finish(new Error('thumbnail decode failed')) }
      controller.signal.addEventListener('abort', abort, { once: true })
      if (controller.signal.aborted) { abort(); return }
      element.src = sourceUrl
      element.load()
    })
    controller.signal.throwIfAborted()
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

/** Visible thumbnails share one decode; leaving the viewport releases queued and active reads. */
export function TakeThumbnail({ request, load, className, alt }: {
  readonly request: YimengTakePreviewRequest
  readonly load: QingmuYimengPort['takePreview']
  readonly className: string | undefined
  readonly alt: string
}) {
  const key = [request.projectId, request.episodeId, request.frameId, request.takeId, request.expectedOutputSha256].join('\0')
  const node = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>()
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !node.current) return
    const observer = new IntersectionObserver(([entry]) => { setVisible(entry?.isIntersecting === true) })
    observer.observe(node.current)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    if (!visible) return
    let mounted = true
    setState(value => value?.key === key && value.failed ? { key } : value)
    let job = cache.get(key)
    if (!job) {
      const controller = new AbortController()
      const promise = queue.then(() => poster(request, load, controller))
      job = { promise, controller, users: 0, settled: false }
      const created = job
      queue = promise.catch(() => undefined)
      cache.set(key, created)
      void promise.then(() => {
        created.settled = true
        trimCache()
      }, () => { if (cache.get(key) === created) cache.delete(key) })
    }
    job.users += 1
    const currentJob = job
    void job.promise.then((url) => { if (mounted) setState({ key, url }) }, () => { if (mounted) setState({ key, failed: true }) })
    return () => {
      mounted = false
      currentJob.users -= 1
      if (currentJob.users === 0 && !currentJob.settled) {
        if (cache.get(key) === currentJob) cache.delete(key)
        currentJob.controller.abort()
      }
      trimCache()
    }
  }, [key, load, visible])
  return <span ref={node} className={className}>{state?.key === key && state.url
    ? <img style={{ width: '100%', height: '100%', objectFit: 'cover' }} src={state.url} alt={alt} />
    : state?.key === key && state.failed ? '缩略图读取失败' : visible ? '读取缩略图…' : '视频第一帧'}</span>
}
