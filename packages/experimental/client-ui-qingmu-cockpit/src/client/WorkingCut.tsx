/** Creator-editable sequence and downloadable local MP4 versions. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkingAudioCue, WorkingClip, WorkingCutCommand, WorkingCutState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './WorkingCut.module.css'
import { WorkingCutSound } from './WorkingCutSound.tsx'
import { WorkingCutReframe } from './WorkingCutReframe.tsx'
import { WorkingCutSoundReview } from './WorkingCutSoundReview.tsx'
import { soundCueDuration, validSoundLoop } from './working-sound-loop.ts'

/** Choose generated takes, trim their source ranges and render with native sound.
 * @param props - Active project/episode and authenticated command port.
 * @returns Editable film sequence and retained rendered versions.
 */
export function WorkingCut({ projectId, episodeId, port, onOpenShooting, renderDirector, onUnsavedChange }: {
  readonly projectId: string
  readonly episodeId: string
  readonly port: Pick<QingmuYimengPort, 'readWorkingCut' | 'renderWorkingCut' | 'saveWorkingCut' | 'uploadWorkingCutAudio' | 'reviewWorkingCutSound'>
  readonly onOpenShooting: (frameId: string) => void
  readonly renderDirector?: ((ready: boolean) => ReactNode) | undefined
  readonly onUnsavedChange?: ((dirty: boolean) => void) | undefined
}) {
  const [state, setState] = useState<WorkingCutState>()
  const [clips, setClips] = useState<readonly WorkingClip[]>([])
  const [audioCues, setAudioCues] = useState<readonly WorkingAudioCue[]>([])
  const [soundPlan, setSoundPlan] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [directorOpen, setDirectorOpen] = useState(false)
  useEffect(() => {
    onUnsavedChange?.(dirty)
    return () => { onUnsavedChange?.(false) }
  }, [dirty, onUnsavedChange])
  const [playingVersion, setPlayingVersion] = useState<string>()
  const player = useRef<HTMLVideoElement>(null)
  const live = useRef(true), editing = useRef(false)
  const pending = useRef<WorkingCutCommand>()
  const pendingMode = useRef<'save' | 'render'>('render')
  const scopeKey = `qingmu:working-cut:${projectId}:${episodeId}`
  const read = useCallback(async () => {
    if (!projectId || !episodeId) return
    const next = await port.readWorkingCut({ projectId, episodeId })
    if (!live.current) return
    setState(next)
    if (!editing.current) {
      setAudioCues(next.cuts[0]?.audioCues ?? [])
      setSoundPlan(next.cuts[0]?.soundPlan ?? '')
      setClips(next.cuts[0]?.clips ?? next.shots.flatMap((shot) => {
        const candidate = shot.selectedAssetId === undefined ? shot.candidates.at(-1)
          : shot.candidates.find(c => c.assetId === shot.selectedAssetId)
        return candidate ? [{ frameId: shot.frameId, assetId: candidate.assetId, sha256: candidate.sha256,
          inSec: 0, outSec: Math.floor(candidate.duration * 100) / 100 }] : []
      }))
    }
    if (pending.current && next.cuts.some(c => c.requestId === pending.current?.requestId)) {
      pending.current = undefined
      try { localStorage.removeItem(scopeKey) } catch { /* In-memory recovery still works. */ }
    }
  }, [projectId, episodeId, port, scopeKey])
  useEffect(() => {
    live.current = true
    try {
      const saved = localStorage.getItem(scopeKey)
      if (saved) {
        const record = JSON.parse(saved) as { command?: WorkingCutCommand; mode?: 'save' | 'render' }
        pending.current = record.command ?? JSON.parse(saved) as WorkingCutCommand
        pendingMode.current = record.mode ?? 'render'
      }
    } catch { /* Read-only recovery remains available. */ }
    void read().catch((cause: unknown) => { if (live.current) setError(String(cause)) })
    return () => { live.current = false }
  }, [read, scopeKey])
  const running = state?.cuts.some(c => !['Succeeded', 'Failed', 'Cancelled', 'NotQueued'].includes(c.status)) ?? false
  const reviewRunning = state?.cuts.some(c => c.soundReview?.state === 'pending') ?? false
  useEffect(() => {
    if (!running && !reviewRunning) return
    const timer = setInterval(() => { void read().catch((cause: unknown) => { if (live.current) setError(String(cause)) }) }, 5000)
    return () => { clearInterval(timer) }
  }, [read, running, reviewRunning])
  const change = (value: readonly WorkingClip[]) => { editing.current = true; setDirty(true); setClips(value) }
  const update = (index: number, clip: WorkingClip) => { change(clips.map((old, i) => i === index ? clip : old)) }
  const render = async (mode: 'save' | 'render' = 'render') => {
    if (!state || busy || running) return
    setBusy(true); setError(''); setNotice('')
    if (!pending.current) pendingMode.current = mode
    const command = pending.current ?? { requestId: crypto.randomUUID(), expectedRevision: state.revision, clips, audioCues, soundPlan }
    pending.current = command
    try {
      localStorage.setItem(scopeKey, JSON.stringify({ command, mode: pendingMode.current }))
      const next = await (pendingMode.current === 'save' ? port.saveWorkingCut : port.renderWorkingCut)({ projectId, episodeId, command })
      if (!live.current) return
      setNotice(pendingMode.current === 'save' ? '剪辑与声音设计已保存，重新打开仍可继续编辑。' : '已提交合成，可在这里查看进度。')
      setState(next); setDirty(false); editing.current = false; pending.current = undefined
      localStorage.removeItem(scopeKey)
    } catch (cause) { if (live.current) setError(`操作尚未确认，重试将恢复同一次提交。${String(cause)}`) }
    finally { if (live.current) setBusy(false) }
  }
  const total = clips.reduce((sum, clip) => sum + clip.outSec - clip.inSec, 0)
  const soundSources = [...(state?.audioLibrary ?? []), ...(state?.videoAudioSources ?? [])]
  const audioValid = audioCues.every((c) => {
    const source = soundSources.find(a => a.assetId === c.assetId)
    const response = state?.audioLibrary?.find(a => a.assetId === c.space?.assetId)
    const audibleDuration = soundCueDuration(c)
    const points = c.gainPoints ?? []
    return validSoundLoop(c) && source && source.usage !== 'impulse_response' && [c.startSec, c.inSec, c.outSec, c.gainDb, c.fadeInSec, c.fadeOutSec].every(Number.isFinite)
      && c.startSec >= 0
      && c.inSec >= 0 && c.outSec > c.inSec && c.outSec <= source.duration
      && c.startSec + audibleDuration <= total + .001 && c.gainDb >= -60 && c.gainDb <= 6
      && c.fadeInSec >= 0 && c.fadeOutSec >= 0 && c.fadeInSec + c.fadeOutSec <= audibleDuration
      && (!c.space || response && response.sha256 === c.space.sha256 && response.duration <= 10
        && Number.isFinite(c.space.wetDb) && c.space.wetDb >= -60 && c.space.wetDb <= 6
        && Number.isFinite(c.space.tailSec) && c.space.tailSec >= 0 && c.space.tailSec <= response.duration)
      && points.length !== 1 && points.length <= 64 && points.every((point, i) =>
      Number.isFinite(point.timeSec) && Number.isFinite(point.gainDb)
        && point.timeSec >= c.startSec && point.timeSec <= c.startSec + audibleDuration
        && point.gainDb >= -60 && point.gainDb <= 6 && (i === 0 || point.timeSec > (points[i - 1]?.timeSec ?? -1)))
  })
  const valid = audioValid && total <= 600 && clips.length > 0 && clips.every((c) => {
    const source = state?.shots.find(s => s.frameId === c.frameId)?.candidates.find(a => a.assetId === c.assetId)
    return source && Number.isFinite(c.inSec) && Number.isFinite(c.outSec)
      && (!c.reframe || [c.reframe.zoom, c.reframe.x, c.reframe.y].every(Number.isFinite)
        && c.reframe.zoom >= 1 && c.reframe.zoom <= 4 && c.reframe.x >= 0 && c.reframe.x <= 1 && c.reframe.y >= 0 && c.reframe.y <= 1)
      && Number.isFinite(c.sourceGainDb ?? 0) && (c.sourceGainDb ?? 0) >= -60 && (c.sourceGainDb ?? 0) <= 6
      && c.inSec >= 0 && c.outSec > c.inSec && c.outSec <= source.duration
  })
  const locked = busy || running || !!pending.current
  const rendered = state?.cuts.filter(c => c.status === 'Succeeded' && c.url) ?? []
  const latest = rendered.find(c => c.revisionId === playingVersion) ?? rendered[0]
  const reviewSound = async () => {
    if (busy || !latest?.assetId || !latest.sha256) return
    setBusy(true); setError('')
    try {
      const next = await port.reviewWorkingCutSound({ projectId, episodeId, command: {
        revisionId: latest.revisionId, assetId: latest.assetId, sha256: latest.sha256,
      } })
      if (live.current) setState(next)
    } catch (cause) { if (live.current) setError(`检查请求尚未确认，请刷新状态恢复同一次检查。${String(cause)}`) }
    finally { if (live.current) setBusy(false) }
  }
  if (!projectId || !episodeId) return <p role="status">正在载入项目与分集…</p>
  return <section className={css.panel} aria-label="成片剪辑">
    <header><div><h2>成片剪辑</h2><p>选择镜头、调整剪辑，再为整场安排声音，保存并导出 MP4。</p></div>
      <button type="button" disabled={busy} onClick={() => { setError(''); void read().catch((cause: unknown) => { setError(String(cause)) }) }}>刷新成片状态</button></header>
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => {
      void read().then(() => {
        pending.current = undefined; setError('')
        try { localStorage.removeItem(scopeKey) } catch { /* Next command still uses the refreshed server revision. */ }
      }).catch((cause: unknown) => { setError(String(cause)) })
    }}>重新核对剪辑</button></div>}
    {!state ? <p role="status">正在读取镜头…</p> : <>
      {renderDirector && <details open={directorOpen} onToggle={(event) => { setDirectorOpen(event.currentTarget.open) }}>
        <summary>整片声音导演</summary>
        {dirty || !state.cuts.length
          ? <p role="status">请先保存剪辑草稿，导演才能依据当前画面和音轨安排声音。</p>
          : <p>可先让导演安排声音草稿，再核对音轨并导出。打开此面板不会发送要求。</p>}
        {directorOpen && renderDirector(!dirty && !locked && valid && state.cuts.length > 0)}
        <button type="button" disabled={dirty || locked} onClick={() => {
          setError(''); void read().catch((cause: unknown) => { setError(String(cause)) })
        }}>读取导演保存的剪辑</button>
      </details>}
      {state.shots.some(shot => shot.editorialContext) && <details><summary>导演的接镜与声桥安排</summary>
        <p>以下是当前导演设计。请依据所选素材设置剪辑点与声音轨，再保存；这些说明不会自动改变成片。</p>
        {state.shots.filter(shot => shot.editorialContext).map(shot => <div key={shot.frameId}>
          <strong>镜 {shot.frameNo} · {shot.title}</strong>
          <p>{typeof shot.editorialContext === 'string' ? shot.editorialContext : JSON.stringify(shot.editorialContext)}</p>
        </div>)}
      </details>}
      {state.shots.filter(s => !clips.some(c => c.frameId === s.frameId)).map(shot => <p key={shot.frameId}>
        镜 {shot.frameNo} · {shot.candidates.length ? shot.selectedAssetId === null ? '尚未选用视频，可加入候选比较' : '尚未加入剪辑' : '尚无已完成视频'}{' '}
        {shot.candidates.length ? <button type="button" disabled={locked} onClick={() => { const c = shot.candidates.find(c => c.assetId === shot.selectedAssetId) ?? shot.candidates.at(-1); if (c) change([...clips, { frameId: shot.frameId, assetId: c.assetId, sha256: c.sha256, inSec: 0, outSec: Math.floor(c.duration * 100) / 100 }]) }}>加入此镜</button>
          : <button type="button" onClick={() => { onOpenShooting(shot.frameId) }}>去生成</button>}
      </p>)}
      <ol className={css.clips}>{clips.map((clip, index) => {
        const shot = state.shots.find(s => s.frameId === clip.frameId)
        const selected = shot?.candidates.find(c => c.assetId === clip.assetId)
        return <li key={`${clip.frameId}:${index}`}>
          <strong>镜 {shot?.frameNo ?? index + 1}</strong>
          <select aria-label={`镜 ${index + 1} 视频版本`} value={clip.assetId} disabled={locked} onChange={(e) => {
            const c = shot?.candidates.find(c => c.assetId === e.target.value)
            if (c) {
              const { reframe: _reframe, ...rest } = clip
              update(index, { ...rest, assetId: c.assetId, sha256: c.sha256,
                inSec: 0, outSec: Math.floor(c.duration * 100) / 100 })
            }
          }}>{shot?.candidates.map((c, i) =>
              <option key={c.assetId} value={c.assetId}>版本 {i + 1} · {c.duration.toFixed(1)} 秒{c.assetId === shot.selectedAssetId ? ' · 拍摄页已选' : ''}</option>,
            )}</select>
          <label>起点 <input aria-label={`镜 ${index + 1} 起点秒`} type="number" min="0" max={clip.outSec} step="0.1" value={clip.inSec} disabled={locked} onChange={(e) => { update(index, { ...clip, inSec: Number(e.target.value) }) }} /></label>
          <label>终点 <input aria-label={`镜 ${index + 1} 终点秒`} type="number" min={clip.inSec} max={selected?.duration} step="0.1" value={clip.outSec} disabled={locked} onChange={(e) => { update(index, { ...clip, outSec: Number(e.target.value) }) }} /></label>
          <details><summary>原片声音</summary>
            <label>声音内容 <select aria-label={`镜 ${index + 1} 声音内容`} value={clip.sourceAudioMode ?? 'original'} disabled={locked} onChange={(e) => {
              const mode = e.target.value
              if (mode === 'original' || mode === 'silent' || mode === 'speech_effects' || mode === 'speech') update(index, { ...clip, sourceAudioMode: mode })
            }}>
              <option value="original">保留原声</option>
              <option value="silent">不使用镜头原声（另铺声音）</option>
              <option value="speech_effects" disabled={!state.audioSeparation?.available}>提取对白与环境声，去除原配乐</option>
              <option value="speech" disabled={!state.audioSeparation?.available}>提取对白</option>
            </select></label>
            <label>音量 dB <input aria-label={`镜 ${index + 1} 原音音量 dB`} type="number" min="-60" max="6" step="1" value={clip.sourceGainDb ?? 0} disabled={locked} onChange={(e) => { update(index, { ...clip, sourceGainDb: Number(e.target.value) }) }} /></label>
            {clip.sourceAudioMode === 'silent' ? <p>只保留画面；整片对白、环境和配乐可在下方独立铺设。</p> : (clip.sourceAudioMode ?? 'original') === 'original'
              ? <p>音量会同时影响原片中的对白、环境声和音乐。</p>
              : <p>导出时在本机分离，不产生模型调用费用。首次处理需要数分钟，同一素材会复用结果。分离可能损失声音细节，请试听成片；可切回原声。全片配乐在下方独立铺设。</p>}
            {!state.audioSeparation?.available && <p>本机声音分离组件尚未就绪，保留原声仍可导出。</p>}
          </details>
          {selected?.url && <details><summary>播放此版本</summary><video controls preload="none" src={selected.url} /></details>}
          {selected?.url && <WorkingCutReframe key={clip.assetId} clip={clip} url={selected.url} label={`镜 ${index + 1}`} disabled={locked} onChange={(reframe) => {
            const { reframe: _previous, ...rest } = clip
            update(index, reframe ? { ...rest, reframe } : rest)
          }} />}
          <button type="button" aria-label={`镜 ${index + 1} 前移`} disabled={index === 0 || locked} onClick={() => { const before = clips[index - 1]; if (before) { const next = [...clips]; next[index - 1] = clip; next[index] = before; change(next) } }}>↑</button>
          <button type="button" disabled={locked} onClick={() => { change(clips.filter((_, i) => i !== index)) }}>移出剪辑</button>
        </li>
      })}</ol>
      <WorkingCutSound library={soundSources} cues={audioCues} total={total} disabled={locked} plan={soundPlan}
        separationAvailable={state.audioSeparation?.available ?? false}
        presets={state.acousticPresets ?? []} onImportPreset={async (presetId) => {
          setBusy(true)
          try {
            const next = await port.uploadWorkingCutAudio({ projectId, episodeId, command: { presetId } })
            if (live.current) setState(next)
          } finally { if (live.current) setBusy(false) }
        }}
        onPlan={(value) => { change(clips); setSoundPlan(value) }} onChange={(value) => { change(clips); setAudioCues(value) }}
        onUpload={async (file) => {
          setBusy(true)
          try {
            const contentBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onerror = () => { reject(new Error('无法读取声音文件')) }
              reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result.split(',')[1] ?? '')
              else reject(new Error('Audio read failed')) }
              reader.readAsDataURL(file)
            })
            const next = await port.uploadWorkingCutAudio({ projectId, episodeId, command: { filename: file.name, contentBase64 } })
            if (live.current) setState(next)
          } finally { if (live.current) setBusy(false) }
        }} />
      <div className={css.actions}><strong>总时长 {Number.isFinite(total) ? total.toFixed(1) : '—'} 秒</strong>
        <button type="button" disabled={busy || running || !valid || !!pending.current} onClick={() => { void render('save') }}>保存剪辑草稿</button>
        <button type="button" disabled={busy || running || !valid} onClick={() => { void render() }}>{busy ? '正在提交…' : running ? '正在合成 MP4…' : pending.current ? pendingMode.current === 'save' ? '恢复上次保存' : '恢复上次导出' : '合成并导出 MP4'}</button>
        <span>{dirty ? '剪辑与声音设计尚未保存' : '本地合成不调用付费生成模型'}</span></div>
      {state.cuts[0]?.status === 'Failed' && <p role="alert">合成失败：{state.cuts[0].errorCode}。原片仍保留。</p>}
      {latest && <section aria-label="成片播放器"><h3>成片 · 版本 {latest.version}</h3>
        {rendered.length > 1 && <label>播放版本 <select aria-label="成片播放版本" value={latest.revisionId}
          onChange={(e) => { setPlayingVersion(e.target.value) }}>{rendered.map(c =>
            <option key={c.revisionId} value={c.revisionId}>版本 {c.version}</option>)}</select></label>}
        <video key={latest.revisionId} ref={player} controls preload="metadata" src={latest.url} />
        <a href={`${latest.url}${latest.url.includes('?') ? '&' : '?'}download=true`} download={`青木-成片-v${latest.version}.mp4`} target="_blank" rel="noreferrer">下载 MP4</a>
        <WorkingCutSoundReview review={latest.soundReview} busy={busy} changed={dirty || latest.revisionId !== state.cuts[0]?.revisionId}
          onReview={() => { void reviewSound() }} onSeek={(seconds) => {
            const video = player.current
            if (video) { video.currentTime = seconds; void video.play().catch(() => { video.focus() }) }
          }} />
      </section>}
      {state.cuts.length > 1 && <details><summary>剪辑记录 · {state.cuts.length} 版</summary>{state.cuts.map(c => <p key={c.revisionId}>版本 {c.version} · {c.status === 'NotQueued' ? '剪辑草稿' : c.status === 'Succeeded' ? '已合成' : c.status === 'Failed' ? '合成失败' : '合成中'} {c.url && <a href={c.url} target="_blank" rel="noreferrer">播放 / 下载</a>}</p>)}</details>}
    </>}
  </section>
}
