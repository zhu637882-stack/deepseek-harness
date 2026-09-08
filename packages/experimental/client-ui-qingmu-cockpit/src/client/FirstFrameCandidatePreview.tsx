import { useCallback, useEffect, useRef, useState } from 'react'

/** Upper bound shared with the Host media bridge; first-frame preview must stay an in-memory image. */
export const MAX_FIRST_FRAME_PREVIEW_BYTES = 16 * 1024 * 1024

/** Exact candidate coordinates accepted by a read-only first-frame media loader. */
export interface FirstFrameCandidatePreviewRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly assetId: string
  readonly expectedMaterializedSha256: string
}

/** Byte-bearing result for one explicitly requested local first-frame candidate. */
export interface FirstFrameCandidatePreviewResponse {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly assetId: string
  readonly materializedSha256: string
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  readonly base64: string
}

/** Localized labels supplied by the owning workspace. */
export interface FirstFrameCandidatePreviewLabels {
  readonly load: string
  readonly loading: string
  readonly error: string
  readonly ariaLabel: string
}

function sameScope(
  result: FirstFrameCandidatePreviewResponse,
  request: FirstFrameCandidatePreviewRequest,
): boolean {
  return result.projectId === request.projectId && result.episodeId === request.episodeId
    && result.storyboardRevisionId === request.storyboardRevisionId
    && result.frameId === request.frameId && result.assetId === request.assetId
    && result.materializedSha256 === request.expectedMaterializedSha256
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function decodeCandidate(result: FirstFrameCandidatePreviewResponse): Uint8Array {
  // Avoid repeated-group regexes: multi-megabyte real images exhaust the JS regexp stack.
  const text = result.base64
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(result.mimeType)
    || text.length === 0 || text.length > Math.ceil(MAX_FIRST_FRAME_PREVIEW_BYTES / 3) * 4
    || text.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(text.slice(0, text.length - padding))) {
    throw new Error('first-frame preview media invalid')
  }
  const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
  if (bytes.length > MAX_FIRST_FRAME_PREVIEW_BYTES) throw new Error('first-frame preview media too large')
  return bytes
}

/**
 * Read an existing candidate and reject any scope or byte drift. Auto-loading is display-only.
 * @param props - Read-only scoped loader plus its content-addressed expected bytes.
 * @returns An in-memory image preview. It does not select, promote, or generate an asset.
 */
export function FirstFrameCandidatePreview({
  request,
  load,
  labels,
  onPreviewReady,
  autoLoad = false,
  thumbnailClassName,
}: {
  readonly request: FirstFrameCandidatePreviewRequest
  readonly load: (request: FirstFrameCandidatePreviewRequest, signal?: AbortSignal) => Promise<FirstFrameCandidatePreviewResponse>
  readonly labels: FirstFrameCandidatePreviewLabels
  readonly onPreviewReady?: (url: string | undefined) => void
  readonly autoLoad?: boolean
  readonly thumbnailClassName?: string
}) {
  const [url, setUrl] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const controller = useRef<AbortController | undefined>(undefined)
  const blob = useRef<string | undefined>(undefined)
  const requestKey = [
    request.projectId,
    request.episodeId,
    request.storyboardRevisionId,
    request.frameId,
    request.assetId,
    request.expectedMaterializedSha256,
  ].join('\u0000')
  useEffect(() => {
    // A candidate coordinate is content-addressed. Never retain a prior candidate while
    // its parent rerenders this component for another asset or expected byte sequence.
    controller.current?.abort()
    controller.current = undefined
    if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
    blob.current = undefined
    setUrl(undefined)
    onPreviewReady?.(undefined)
    setStatus('idle')
    return () => {
      controller.current?.abort()
      controller.current = undefined
      if (blob.current !== undefined) URL.revokeObjectURL(blob.current)
      blob.current = undefined
      onPreviewReady?.(undefined)
    }
  }, [onPreviewReady, requestKey])
  const preview = useCallback(async () => {
    if (controller.current !== undefined || blob.current !== undefined) return
    const run = new AbortController()
    controller.current = run
    setStatus('loading')
    try {
      const result = await load(request, run.signal)
      if (run.signal.aborted) return
      if (!sameScope(result, request)) throw new Error('first-frame preview source changed')
      const bytes = decodeCandidate(result)
      if (await sha256(bytes) !== request.expectedMaterializedSha256) throw new Error('first-frame preview hash mismatch')
      if (run.signal.aborted) return
      blob.current = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: result.mimeType }))
      setUrl(blob.current)
      onPreviewReady?.(blob.current)
      setStatus('ready')
    } catch {
      if (!run.signal.aborted) setStatus('error')
    } finally {
      if (controller.current === run) controller.current = undefined
    }
  }, [load, onPreviewReady, request.projectId, request.episodeId, request.storyboardRevisionId,
    request.frameId, request.assetId, request.expectedMaterializedSha256])
  useEffect(() => { if (autoLoad) void preview() }, [autoLoad, preview])
  // A thumbnail lives inside the shot's navigation button; never nest an action button.
  if (thumbnailClassName !== undefined) return url !== undefined
    ? <img className={thumbnailClassName} src={url} alt={labels.ariaLabel} />
    : <span className={thumbnailClassName}>{status === 'error' ? '缩略图未载入' : '正在读取首帧'}</span>
  return <div>
    {url === undefined
      ? <button type="button" disabled={status === 'loading'} onClick={() => { void preview() }}>
        {status === 'loading' ? labels.loading : labels.load}
      </button>
      : <img src={url} alt={labels.ariaLabel} />}
    {status === 'error' && <p role="alert">{labels.error}</p>}
  </div>
}
