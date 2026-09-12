import { useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort, YimengTakePreviewRequest } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './TakeVersionCompareView.module.css'

/** Explicitly load already-existing media; keep its verified bytes only in memory.
 * @param props - Immutable scope, authenticated Host port and translated labels.
 * @returns A read-only video player with bounded loading and recoverable errors.
 */
export function TakePreviewPlayer({ request, load, t, onPreviewReady, autoLoad = false, seek }: {
  readonly request: YimengTakePreviewRequest
  readonly load: QingmuYimengPort['takePreview']
  readonly t: (key: QingmuCockpitKey) => string
  /** Receives only the verified in-memory object URL for an existing Take. */
  readonly onPreviewReady?: (url: string | undefined) => void
  /** Read existing bytes on shot selection, without autoplay or generation. */
  readonly autoLoad?: boolean
  /** A user-selected evidence time in this exact candidate; seeking pauses playback. */
  readonly seek?: { readonly takeId: string; readonly sha256: string; readonly timeSec: number } | undefined
}) {
  const player = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const controller = useRef<AbortController | undefined>(undefined)
  const blob = useRef<string | undefined>(undefined)
  const requestKey = [request.projectId, request.episodeId, request.frameId, request.takeId, request.expectedOutputSha256].join('\u0000')
  useEffect(() => {
    controller.current?.abort()
    controller.current = undefined
    if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
    blob.current = undefined
    setUrl(undefined)
    setStatus('idle')
    onPreviewReady?.(undefined)
    return () => {
      controller.current?.abort()
      if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
      blob.current = undefined
      onPreviewReady?.(undefined)
    }
  }, [onPreviewReady, requestKey])
  async function preview() {
    if (controller.current !== undefined || blob.current !== undefined) return
    const run = new AbortController()
    controller.current = run
    setStatus('loading')
    try {
      const signal = run.signal
      const result = await load(request, signal)
      if (signal.aborted) return
      if (result.projectId !== request.projectId || result.episodeId !== request.episodeId
        || result.frameId !== request.frameId || result.takeId !== request.takeId
        || result.outputSha256 !== request.expectedOutputSha256) throw new Error('preview source changed')
      const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
      if (run.signal.aborted) return
      if (digest !== request.expectedOutputSha256) throw new Error('preview hash mismatch')
      blob.current = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      setUrl(blob.current)
      onPreviewReady?.(blob.current)
      setStatus('ready')
    } catch {
      if (!run.signal.aborted) setStatus('error')
    } finally {
      if (controller.current === run) controller.current = undefined
    }
  }
  useEffect(() => {
    if (autoLoad) void preview()
  }, [requestKey, load, autoLoad, onPreviewReady])
  useEffect(() => {
    const video = player.current
    if (!video || !seek || seek.takeId !== request.takeId || seek.sha256 !== request.expectedOutputSha256) return
    const move = () => {
      if (!Number.isFinite(seek.timeSec) || seek.timeSec < 0 || !Number.isFinite(video.duration) || seek.timeSec >= video.duration) return
      video.pause()
      video.currentTime = seek.timeSec
      video.focus()
      video.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    }
    move()
    video.addEventListener('loadedmetadata', move)
    return () => video.removeEventListener('loadedmetadata', move)
  }, [seek, url, requestKey])
  function retryPlayback() {
    if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
    blob.current = undefined; setUrl(undefined); onPreviewReady?.(undefined)
    void preview()
  }
  return <div className={css.preview}>
    {url === undefined
      ? <button type="button" disabled={status === 'loading'} onClick={() => { void preview() }}>
        {t(status === 'loading' ? 'takePreviewLoading' : 'takePreviewLoad')}
      </button>
      : <video ref={player} src={url} controls playsInline preload="metadata" aria-label={`${t('takePreviewLabel')} ${request.takeId}`}
        onError={() => { setStatus('error') }} />}
    {status === 'error' && <><p role="alert">{t('takePreviewError')}</p>{url !== undefined && <button type="button" onClick={retryPlayback}>重新载入视频</button>}</>}
  </div>
}
