/** Non-destructive source framing with a preview of the retained pixels. */
import { useRef, useState } from 'react'
import type { WorkingClip } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './WorkingCut.module.css'

/** Preview and edit one static crop; playback keeps the clip's original audio.
 * @param props - Exact candidate URL, source range and saved framing.
 * @returns Keyboard-accessible framing and playback controls.
 */
export function WorkingCutReframe({ clip, url, label, disabled, onChange }: {
  readonly clip: WorkingClip
  readonly url: string
  readonly label: string
  readonly disabled: boolean
  readonly onChange: (reframe: WorkingClip['reframe']) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [size, setSize] = useState({ width: 1600, height: 900 })
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [audible, setAudible] = useState(false)
  const [time, setTime] = useState(clip.inSec)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const crop = clip.reframe ?? { zoom: 1, x: .5, y: .5 }
  const width = crop.zoom === 1 ? size.width : Math.max(2, Math.floor(size.width / crop.zoom / 2) * 2)
  const height = crop.zoom === 1 ? size.height : Math.max(2, Math.floor(size.height / crop.zoom / 2) * 2)
  const x = Math.floor((size.width - width) * crop.x / 2) * 2
  const y = Math.floor((size.height - height) * crop.y / 2) * 2
  return <details className={css.reframe} onToggle={(e) => {
    setOpen(e.currentTarget.open)
    if (!e.currentTarget.open) { video.current?.pause(); setPlaying(false); setReady(false) }
  }}>
    <summary>画面取景{clip.reframe && crop.zoom > 1 ? ` · ${crop.zoom.toFixed(2)} 倍` : ''}</summary>
    {open && <>
      <div className={css.reframeViewport} style={{ aspectRatio: `${width} / ${height}` }}>
        <video ref={video} aria-label={`${label} 取景预览`} src={url} preload="metadata" muted={!audible} playsInline
          style={{ width: `${size.width / width * 100}%`, height: `${size.height / height * 100}%`, left: `${-x / width * 100}%`, top: `${-y / height * 100}%` }}
          onLoadedMetadata={(e) => {
            const source = e.currentTarget
            setSize({ width: source.videoWidth, height: source.videoHeight }); setReady(true)
            source.currentTime = clip.inSec; setTime(clip.inSec)
          }} onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }}
          onError={() => { setError('视频暂时无法读取，请刷新成片状态后重试。') }}
          onTimeUpdate={(e) => {
            const source = e.currentTarget
            if (source.currentTime > clip.outSec) { source.pause(); source.currentTime = clip.outSec }
            setTime(source.currentTime)
          }} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className={css.reframePlayback}>
        <button type="button" disabled={!ready} onClick={() => {
          const source = video.current
          if (!source) return
          if (source.paused) {
            if (source.currentTime < clip.inSec || source.currentTime >= clip.outSec) source.currentTime = clip.inSec
            void source.play().catch(() => { setError('暂时无法播放，请再次点击播放。') })
          } else source.pause()
        }}>{playing ? '暂停取景预览' : '播放取景预览'}</button>
        <button type="button" aria-pressed={audible} onClick={() => { setAudible(!audible) }}>{audible ? '关闭预览声音' : '开启预览声音'}</button>
        <label>预览位置 {time.toFixed(1)} 秒<input aria-label={`${label} 取景预览位置秒`} type="range" min={clip.inSec} max={clip.outSec} step="0.05" value={Math.max(clip.inSec, Math.min(time, clip.outSec))} disabled={!ready} onChange={(e) => {
          const next = Number(e.target.value); if (video.current) video.current.currentTime = next; setTime(next)
        }} /></label>
      </div>
      <div className={css.reframeControls}>
        <label>放大 {crop.zoom.toFixed(2)} 倍<input aria-label={`${label} 取景放大倍数`} type="range" min="1" max="4" step="0.05" value={crop.zoom} disabled={disabled} onChange={(e) => { onChange({ ...crop, zoom: Number(e.target.value) }) }} /></label>
        <label>左右位置<input aria-label={`${label} 取景左右位置`} type="range" min="0" max="100" step="1" value={crop.x * 100} disabled={disabled || crop.zoom === 1} onChange={(e) => { onChange({ ...crop, x: Number(e.target.value) / 100 }) }} /></label>
        <label>上下位置<input aria-label={`${label} 取景上下位置`} type="range" min="0" max="100" step="1" value={crop.y * 100} disabled={disabled || crop.zoom === 1} onChange={(e) => { onChange({ ...crop, y: Number(e.target.value) / 100 }) }} /></label>
        <button type="button" disabled={disabled || !clip.reframe} onClick={() => { onChange(undefined) }}>恢复原画面</button>
      </div>
      <p>{ready ? `保留原片 ${width} × ${height} 像素。` : '正在读取视频尺寸…'}取景会随剪辑保存并用于导出；放大会减少保留的原片像素。</p>
    </>}
  </details>
}
