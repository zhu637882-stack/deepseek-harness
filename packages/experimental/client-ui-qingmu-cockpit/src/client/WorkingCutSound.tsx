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
      const duration = cue.outSec - cue.inSec + (cue.space?.tailSec ?? 0)
      const response = library.find(a => a.assetId === cue.space?.assetId)
      const spaceInvalid = cue.space && (!response || response.sha256 !== cue.space.sha256 || response.duration > 10
        || !Number.isFinite(cue.space.wetDb) || cue.space.wetDb < -60 || cue.space.wetDb > 6
        || !Number.isFinite(cue.space.tailSec) || cue.space.tailSec < 0 || cue.space.tailSec > response.duration)
      const points = cue.gainPoints ?? []
      const pointsInvalid = points.length === 1 || points.length > 64 || points.some((point, i) =>
        !Number.isFinite(point.timeSec) || !Number.isFinite(point.gainDb)
        || point.timeSec < cue.startSec || point.timeSec > cue.startSec + duration
        || point.gainDb < -60 || point.gainDb > 6 || (i > 0 && point.timeSec <= (points[i - 1]?.timeSec ?? -1)))
      const invalid = spaceInvalid || !source || cue.startSec < 0 || cue.inSec < 0
        || cue.outSec <= cue.inSec || cue.outSec > source.duration
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
        <details open={!!cue.space}><summary>空间混响</summary>
          <p>给本轨添加房间、走廊等空间的声学响应，原声保留。导入空间响应文件（IR，单声道或双声道，最长 10 秒），再选择；普通对白、音乐和环境录音不能代替 IR。</p>
          <label>空间响应<select aria-label={`音轨 ${index + 1} 空间响应`} value={cue.space?.assetId ?? ''} onChange={(e) => {
            const selected = library.find(a => a.assetId === e.target.value)
            if (selected) update(index, { space: { assetId: selected.assetId, sha256: selected.sha256, wetDb: -12, tailSec: 0 } })
            else onChange(cues.map((current, i) => {
              if (i !== index) return current
              const { space: _removed, ...unchanged } = current
              return unchanged
            }))
          }}>
            <option value="">不加混响</option>
            {cue.space && !response && <option value={cue.space.assetId}>原空间响应不可用</option>}
            {library.filter(a => a.duration <= 10).map(a => <option key={a.assetId} value={a.assetId}>{a.name}</option>)}
          </select></label>
          {cue.space && <>
            <label>混响音量 dB<input aria-label={`音轨 ${index + 1} 混响音量 dB`} type="number" min="-60" max="6" step="1" value={cue.space.wetDb} onChange={(e) => {
              if (cue.space) update(index, { space: { ...cue.space, wetDb: Number(e.target.value) } })
            }} /></label>
            <label>保留尾音秒<input aria-label={`音轨 ${index + 1} 保留尾音秒`} type="number" min="0" max={Math.min(response?.duration ?? 10, 10)} step="0.1" value={cue.space.tailSec} onChange={(e) => {
              if (cue.space) update(index, { space: { ...cue.space, tailSec: Number(e.target.value) } })
            }} /></label>
            <p>尾音从素材终点继续，可跨越切镜；淡出和音量变化覆盖尾音，总时长需留在成片内。已带混响的原声需试听后再决定是否叠加。</p>
          </>}
          {spaceInvalid && <p role="alert">空间响应或参数已失效，请重新选择并检查混响音量与尾音长度。</p>}
        </details>
        <details open={points.length > 0}><summary>音量变化与对白避让</summary>
          <p>按成片时间设置音量增减，在相邻点之间平滑变化。0 dB 保持本轨音量，负数压低；首末点之外保持对应音量。只调整这条独立音轨。</p>
          {!points.length ? <button type="button" disabled={disabled || invalid} onClick={() => {
            update(index, { gainPoints: [{ timeSec: cue.startSec, gainDb: 0 }, { timeSec: cue.startSec + duration, gainDb: 0 }] })
          }}>设置音量变化</button> : <>
            {points.map((point, pointIndex) => <div key={pointIndex} className={css.gainPoint}>
              <label>成片秒<input aria-label={`音轨 ${index + 1} 变化点 ${pointIndex + 1} 成片秒`} type="number" min={cue.startSec} max={cue.startSec + duration} step="0.1" value={point.timeSec} onChange={(e) => {
                update(index, { gainPoints: points.map((p, i) => i === pointIndex ? { ...p, timeSec: Number(e.target.value) } : p) })
              }} /></label>
              <label>增减 dB<input aria-label={`音轨 ${index + 1} 变化点 ${pointIndex + 1} 增减 dB`} type="number" min="-60" max="6" step="1" value={point.gainDb} onChange={(e) => {
                update(index, { gainPoints: points.map((p, i) => i === pointIndex ? { ...p, gainDb: Number(e.target.value) } : p) })
              }} /></label>
              <button type="button" disabled={points.length <= 2} aria-label={`音轨 ${index + 1} 移除变化点 ${pointIndex + 1}`} onClick={() => {
                update(index, { gainPoints: points.filter((_, i) => i !== pointIndex) })
              }}>移除</button>
              {pointIndex < points.length - 1 && <button type="button" disabled={points.length >= 64 || pointsInvalid} aria-label={`音轨 ${index + 1} 在变化点 ${pointIndex + 1} 后插入`} onClick={() => {
                const next = points[pointIndex + 1]
                if (!next) return
                update(index, { gainPoints: [...points.slice(0, pointIndex + 1),
                  { timeSec: (point.timeSec + next.timeSec) / 2, gainDb: (point.gainDb + next.gainDb) / 2 },
                  ...points.slice(pointIndex + 1)] })
              }}>中间加点</button>}
            </div>)}
            <button type="button" onClick={() => { update(index, { gainPoints: [] }) }}>清除音量变化</button>
          </>}
          {pointsInvalid && <p role="alert">音量变化点需按时间递增且位于本音轨内，增减范围为 −60 至 6 dB。</p>}
        </details>
        <span>成片 {cue.startSec.toFixed(1)}–{(cue.startSec + duration).toFixed(1)} 秒</span>
        <button type="button" onClick={() => { onChange(cues.filter((_, i) => i !== index)) }}>移除音轨 {index + 1}</button>
        {invalid && <p role="alert">请调整音轨范围：声音不能超出素材或成片，淡入和淡出总长不能超过音轨。</p>}
      </fieldset>
    })}
    <p>空间混响只作用于选择的独立音轨。独立音轨不会自动去掉原片已有的音乐；对白已与音乐混在一起时，先分离或修复源声音，避免叠加两套音乐。</p>
  </section>
}
