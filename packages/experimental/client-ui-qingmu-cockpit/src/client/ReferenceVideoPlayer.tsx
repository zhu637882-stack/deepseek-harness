/** Preserve a chosen generated frame as a reusable project image. */
import { useEffect, useRef, useState } from 'react'
import type { ReferenceVideoFrameReceipt, ReferenceVideoFrameRequest, ReferenceVideoRun } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ReferenceVideoWorkspace.module.css'

/** Capture is optional for a read-only host; playback remains available. */
export interface ReferenceVideoPlayerProps {
  readonly projectId: string
  readonly frameId: string
  readonly run: ReferenceVideoRun
  readonly candidate: ReferenceVideoRun['candidates'][number]
  readonly port: Partial<Pick<QingmuYimengPort, 'captureReferenceVideoFrame' | 'readReferenceVideoFrame'>>
  readonly onReferenceSaved?: (() => void) | undefined
}

/** Video seek, explicit frame save and lost-response recovery share one source identity.
 * @param props - Current source and authenticated transport.
 * @returns Player with a local frame-capture control.
 */
export function ReferenceVideoPlayer({ projectId, frameId, run, candidate, port, onReferenceSaved }: ReferenceVideoPlayerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<ReferenceVideoFrameRequest>()
  const operation = useRef<AbortController>()
  const key = `qingmu:video-frame:${JSON.stringify([projectId, frameId, run.runId, candidate.assetId, candidate.assetSha256])}`
  useEffect(() => {
    try {
      const timestamp = sessionStorage.getItem(key)
      if (timestamp !== null && Number.isSafeInteger(Number(timestamp)) && Number(timestamp) >= 0) {
        setPending({ projectId, frameId, runId: run.runId, assetId: candidate.assetId,
          expectedAssetSha256: candidate.assetSha256, timestampMs: Number(timestamp) })
        setMessage('有一帧保存结果待读取，可先恢复查看。')
      }
    } catch { /* Capture remains available when browser storage is disabled. */ }
    return () => { operation.current?.abort() }
  }, [key, projectId, frameId, run.runId, candidate.assetId, candidate.assetSha256])
  const available = port.captureReferenceVideoFrame !== undefined && port.readReferenceVideoFrame !== undefined
    && run.kernelStatus === 'Succeeded' && run.publicStatus === 'succeeded'
  const finish = (receipt: ReferenceVideoFrameReceipt) => {
    if (receipt.image === null) {
      setPending(undefined)
      setMessage('此位置尚未保存，可重新定位后保存。')
      try { sessionStorage.removeItem(key) } catch { /* No browser persistence available. */ }
      return
    }
    setPending(undefined)
    setMessage(`已将 ${(receipt.image.actualTimestampMs / 1000).toFixed(3)} 秒画面存入项目素材。后续镜头可加入引用。`)
    onReferenceSaved?.()
  }
  const execute = async (write: boolean) => {
    if (operation.current !== undefined) return
    const player = video.current
    if (write && (!player || !Number.isFinite(player.currentTime) || player.currentTime >= player.duration)) return
    if (write) player?.pause()
    const request = write ? { projectId, frameId, runId: run.runId, assetId: candidate.assetId,
      expectedAssetSha256: candidate.assetSha256, timestampMs: Math.floor((player?.currentTime ?? 0) * 1000) } : pending
    if (request === undefined) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setMessage(write ? '正在保存画面…' : '正在读取保存结果…')
    setPending(request)
    try { sessionStorage.setItem(key, String(request.timestampMs)) } catch { /* In-memory recovery remains possible. */ }
    try {
      const result = write ? await port.captureReferenceVideoFrame?.(request, controller.signal)
        : await port.readReferenceVideoFrame?.(request, controller.signal)
      if (controller.signal.aborted) return
      if (result === undefined) throw new Error('frame_capture_unavailable')
      finish(result)
    } catch {
      if (!controller.signal.aborted) setMessage('暂未确认保存结果，请读取上次结果；原视频保留。')
    } finally {
      if (!controller.signal.aborted) { operation.current = undefined; setBusy(false) }
    }
  }
  return <div>
    <video ref={video} src={candidate.browserUrl} controls preload="metadata"
      onLoadedMetadata={() => { setLoaded(true) }} aria-label={`草稿版本 ${run.draftRevision} 候选视频`} />
    {available && <div className={css.assetActions}>
      <button type="button" disabled={!loaded || busy || pending !== undefined} onClick={() => { void execute(true) }}>将当前位置画面存为参考</button>
      {pending !== undefined && <button type="button" disabled={busy} onClick={() => { void execute(false) }}>读取上次画面保存结果</button>}
      {pending !== undefined && <button type="button" disabled={busy} onClick={() => {
        setPending(undefined); setMessage('可重新定位画面；已保存的素材仍在项目中。')
        try { sessionStorage.removeItem(key) } catch { /* Only this browser's recovery hint is cleared. */ }
      }}>重新定位画面</button>}
    </div>}
    {available && <small>播放或拖动到需要的位置再保存。本地抽帧，无模型费用。</small>}
    {message && <p role="status">{message}</p>}
  </div>
}
