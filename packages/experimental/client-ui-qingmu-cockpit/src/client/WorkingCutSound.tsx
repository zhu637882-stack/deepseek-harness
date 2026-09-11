/** Whole-film cues remain independent of shot boundaries and source dialogue. */
import { useState } from 'react'
import type { WorkingAudioCue, WorkingCutState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './WorkingCut.module.css'

/** Edit sound sources and cue ranges in assembled-film seconds. */
export function WorkingCutSound({ library, cues, total, disabled, plan, onPlan, onChange, onUpload }: {
  readonly library: NonNullable<WorkingCutState['audioLibrary']>
  readonly cues: readonly WorkingAudioCue[]
  readonly total: number
  readonly disabled: boolean
  readonly plan: string
  readonly onPlan: (value: string) => void
  readonly onChange: (value: readonly WorkingAudioCue[]) => void
  readonly onUpload: (file: File) => Promise<void>
}) {
  const [error, setError] = useState('')
  const update = (index: number, patch: Partial<WorkingAudioCue>) => {
    onChange(cues.map((cue, i) => i === index ? { ...cue, ...patch } : cue))
  }
  return <section className={css.sound} aria-label="整场声音">
    <h3>整场声音</h3>
    <p>先确定剪辑，再安排声音。配乐和环境声可以跨越多个镜头；人物说话时，环境底声仍连续播放。</p>
    <label>声音设计<textarea disabled={disabled} value={plan} maxLength={20000} onChange={(e) => { onPlan(e.target.value) }} placeholder="记录场景声学、对白距离、环境底声、拟音，以及配乐何时进入和退出。" /></label>
    <label className={css.upload}>导入声音素材<input type="file" accept=".wav,.mp3,.m4a,.flac" disabled={disabled} onChange={(e) => {
      const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''
      if (!file) return
      setError('')
      if (file.size > 32 * 1024 * 1024) { setError('请选择 32 MB 以内的音频文件。'); return }
      void onUpload(file).catch((cause: unknown) => { setError(String(cause)) })
    }} /></label>
    <p>支持 WAV、MP3、M4A、FLAC，单个文件最长 10 分钟、最大 32 MB。先试听，再加入音轨。</p>
    {error && <p role="alert">{error}</p>}
    {library.map(source => <div className={css.source} key={source.assetId}>
      <span>{source.name} · {source.duration.toFixed(1)} 秒</span>
      <audio aria-label={`试听 ${source.name}`} controls preload="none" src={source.url} />
      <button type="button" disabled={disabled || total <= 0} onClick={() => {
        const duration = Math.min(total, Math.floor(source.duration * 1000) / 1000)
        onChange([...cues, { assetId: source.assetId, sha256: source.sha256, kind: 'music', startSec: 0,
          inSec: 0, outSec: duration, gainDb: -18, fadeInSec: Math.min(1, duration / 4), fadeOutSec: Math.min(2, duration / 4) }])
      }}>加入音轨</button>
    </div>)}
    {cues.map((cue, index) => {
      const source = library.find(a => a.assetId === cue.assetId)
      const duration = cue.outSec - cue.inSec
      const invalid = !source || cue.startSec < 0 || cue.inSec < 0 || duration <= 0 || cue.outSec > source.duration
        || cue.startSec + duration > total + .001 || cue.fadeInSec + cue.fadeOutSec > duration
      const number = (field: 'startSec' | 'inSec' | 'outSec' | 'gainDb' | 'fadeInSec' | 'fadeOutSec', label: string, min: number, max: number) =>
        <label>{label}<input aria-label={`音轨 ${index + 1} ${label}`} type="number" step="0.1" min={min} max={max} value={cue[field]} disabled={disabled} onChange={(e) => { update(index, { [field]: Number(e.target.value) }) }} /></label>
      return <fieldset key={index} className={css.cue} disabled={disabled}>
        <legend>音轨 {index + 1} · {source?.name ?? '素材不可用'}</legend>
        <label>用途<select aria-label={`音轨 ${index + 1} 用途`} value={cue.kind} onChange={(e) => { update(index, { kind: e.target.value as WorkingAudioCue['kind'] }) }}>
          <option value="music">配乐</option><option value="ambience">环境底声</option><option value="effect">拟音 / 音效</option><option value="dialogue">独立对白</option>
        </select></label>
        {number('startSec', '成片起点秒', 0, total)}{number('gainDb', '音量 dB', -60, 6)}
        {number('fadeInSec', '淡入秒', 0, duration)}{number('fadeOutSec', '淡出秒', 0, duration)}
        <details><summary>裁剪声音素材</summary>{number('inSec', '素材起点秒', 0, source?.duration ?? 0)}{number('outSec', '素材终点秒', 0, source?.duration ?? 0)}</details>
        <span>成片 {cue.startSec.toFixed(1)}–{(cue.startSec + duration).toFixed(1)} 秒</span>
        <button type="button" onClick={() => { onChange(cues.filter((_, i) => i !== index)) }}>移除音轨 {index + 1}</button>
        {invalid && <p role="alert">请调整音轨范围：声音不能超出素材或成片，淡入和淡出总长不能超过音轨。</p>}
      </fieldset>
    })}
    <p>独立音轨不会自动去掉原片已有的音乐，也不会自动改变混响。需要先试听原音；对白已与音乐混在一起时，先分离或修复源声音，避免叠加两套音乐。</p>
  </section>
}
