import { useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort, YimengTakePreviewRequest } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './TakeVersionCompareView.module.css'

/** Explicitly load already-existing media; keep its verified bytes only in memory.
 * @param props - Immutable scope, authenticated Host port and translated labels.
 * @returns A read-only video player with bounded loading and recoverable errors.
 */
export function TakePreviewPlayer({ request, load, t }: {
  readonly request: YimengTakePreviewRequest
  readonly load: QingmuYimengPort['takePreview']
  readonly t: (key: QingmuCockpitKey) => string
}) {
  const [url, setUrl] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const controller = useRef<AbortController | undefined>(undefined)
  const blob = useRef<string | undefined>(undefined)
  useEffect(() => () => {
    controller.current?.abort()
    if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
  }, [])
  async function preview() {
    if (controller.current !== undefined || blob.current !== undefined) return
    const run = new AbortController()
    controller.current = run
    setStatus('loading')
    try {
      const result = await load(request, run.signal)
      if (run.signal.aborted) return
      if (result.projectId !== request.projectId || result.episodeId !== request.episodeId
        || result.frameId !== request.frameId || result.takeId !== request.takeId
        || result.outputSha256 !== request.expectedOutputSha256) throw new Error('preview source changed')
      const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
      if (run.signal.aborted) return
      if (digest !== request.expectedOutputSha256) throw new Error('preview hash mismatch')
      blob.current = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      setUrl(blob.current)
      setStatus('ready')
    } catch {
      if (!run.signal.aborted) setStatus('error')
    } finally {
      if (controller.current === run) controller.current = undefined
    }
  }
  return <div className={css.preview}>
    {url === undefined
      ? <button type="button" disabled={status === 'loading'} onClick={() => { void preview() }}>
        {t(status === 'loading' ? 'takePreviewLoading' : 'takePreviewLoad')}
      </button>
      : <video src={url} controls playsInline preload="metadata" aria-label={`${t('takePreviewLabel')} ${request.takeId}`}
        onError={() => { setStatus('error') }} />}
    {status === 'error' && <p role="alert">{t('takePreviewError')}</p>}
  </div>
}
