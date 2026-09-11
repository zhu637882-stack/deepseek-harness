/** Creator-editable sequence and downloadable local MP4 versions. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkingClip, WorkingCutCommand, WorkingCutState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './WorkingCut.module.css'

/** Choose generated takes, trim their source ranges and render with native sound.
 * @param props - Active project/episode and authenticated command port.
 * @returns Editable film sequence and retained rendered versions.
 */
export function WorkingCut({ projectId, episodeId, port, onOpenShooting }: {
  readonly projectId: string
  readonly episodeId: string
  readonly port: Pick<QingmuYimengPort, 'readWorkingCut' | 'renderWorkingCut'>
  readonly onOpenShooting: (frameId: string) => void
}) {
  const [state, setState] = useState<WorkingCutState>()
  const [clips, setClips] = useState<readonly WorkingClip[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const live = useRef(true), editing = useRef(false)
  const pending = useRef<WorkingCutCommand>()
  const scopeKey = `qingmu:working-cut:${projectId}:${episodeId}`
  const read = useCallback(async () => {
    const next = await port.readWorkingCut({ projectId, episodeId })
    if (!live.current) return
    setState(next)
    if (!editing.current) {
      setClips(next.cuts[0]?.clips ?? next.shots.flatMap((shot) => {
        const candidate = shot.candidates.at(-1)
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
      if (saved) pending.current = JSON.parse(saved) as WorkingCutCommand
    } catch { /* Read-only recovery remains available. */ }
    void read().catch((cause) => { if (live.current) setError(String(cause)) })
    return () => { live.current = false }
  }, [read, scopeKey])
  const running = state?.cuts.some(c => !['Succeeded', 'Failed', 'Cancelled', 'NotQueued'].includes(c.status)) ?? false
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { void read().catch((cause) => { if (live.current) setError(String(cause)) }) }, 5000)
    return () => clearInterval(timer)
  }, [read, running])
  const change = (value: readonly WorkingClip[]) => { editing.current = true; setDirty(true); setClips(value) }
  const update = (index: number, clip: WorkingClip) => change(clips.map((old, i) => i === index ? clip : old))
  const render = async () => {
    if (!state || busy || running) return
    setBusy(true); setError('')
    const command = pending.current ?? { requestId: crypto.randomUUID(), expectedRevision: state.revision, clips }
    pending.current = command
    try {
      localStorage.setItem(scopeKey, JSON.stringify(command))
      const next = await port.renderWorkingCut({ projectId, episodeId, command })
      if (!live.current) return
      setState(next); setDirty(false); editing.current = false; pending.current = undefined
      localStorage.removeItem(scopeKey)
    } catch (cause) { if (live.current) setError(`导出尚未确认，重试将恢复同一次任务。${String(cause)}`) }
    finally { if (live.current) setBusy(false) }
  }
  const total = clips.reduce((sum, clip) => sum + clip.outSec - clip.inSec, 0)
  const valid = clips.length > 0 && clips.every((c) => {
    const source = state?.shots.find(s => s.frameId === c.frameId)?.candidates.find(a => a.assetId === c.assetId)
    return source && Number.isFinite(c.inSec) && Number.isFinite(c.outSec)
      && c.inSec >= 0 && c.outSec > c.inSec && c.outSec <= source.duration
  })
  const latest = state?.cuts.find(c => c.status === 'Succeeded' && c.url)
  return <section className={css.panel} aria-label="成片剪辑">
    <header><div><h2>成片剪辑</h2><p>选择每镜版本，裁掉多余片段，按当前顺序合成 MP4。保留原生声音和所有原片。</p></div>
      <button type="button" disabled={busy} onClick={() => { setError(''); void read().catch(cause => setError(String(cause))) }}>刷新成片状态</button></header>
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => {
      void read().then(() => {
        pending.current = undefined; setError('')
        try { localStorage.removeItem(scopeKey) } catch { /* Next command still uses the refreshed server revision. */ }
      }).catch(cause => setError(String(cause)))
    }}>重新核对剪辑</button></div>}
    {!state ? <p role="status">正在读取镜头…</p> : <>
      {state.shots.filter(s => !clips.some(c => c.frameId === s.frameId)).map(shot => <p key={shot.frameId}>
        镜 {shot.frameNo} · {shot.candidates.length ? '尚未加入剪辑' : '尚无已完成视频'}{' '}
        {shot.candidates.length ? <button type="button" onClick={() => { const c = shot.candidates.at(-1); if (c) change([...clips, { frameId: shot.frameId, assetId: c.assetId, sha256: c.sha256, inSec: 0, outSec: Math.floor(c.duration * 100) / 100 }]) }}>加入此镜</button>
          : <button type="button" onClick={() => onOpenShooting(shot.frameId)}>去生成</button>}
      </p>)}
      <ol className={css.clips}>{clips.map((clip, index) => {
        const shot = state.shots.find(s => s.frameId === clip.frameId)
        const selected = shot?.candidates.find(c => c.assetId === clip.assetId)
        return <li key={`${clip.frameId}:${index}`}>
          <strong>镜 {shot?.frameNo ?? index + 1}</strong>
          <select aria-label={`镜 ${index + 1} 视频版本`} value={clip.assetId} disabled={busy || running} onChange={(e) => {
            const c = shot?.candidates.find(c => c.assetId === e.target.value)
            if (c) update(index, { ...clip, assetId: c.assetId, sha256: c.sha256,
              inSec: 0, outSec: Math.floor(c.duration * 100) / 100 })
          }}>{shot?.candidates.map((c, i) =>
              <option key={c.assetId} value={c.assetId}>版本 {i + 1} · {c.duration.toFixed(1)} 秒</option>,
            )}</select>
          <label>起点 <input aria-label={`镜 ${index + 1} 起点秒`} type="number" min="0" max={clip.outSec} step="0.1" value={clip.inSec} disabled={busy || running} onChange={e => update(index, { ...clip, inSec: Number(e.target.value) })} /></label>
          <label>终点 <input aria-label={`镜 ${index + 1} 终点秒`} type="number" min={clip.inSec} max={selected?.duration} step="0.1" value={clip.outSec} disabled={busy || running} onChange={e => update(index, { ...clip, outSec: Number(e.target.value) })} /></label>
          {selected?.url && <details><summary>播放此版本</summary><video controls preload="none" src={selected.url} /></details>}
          <button type="button" aria-label={`镜 ${index + 1} 前移`} disabled={index === 0 || busy || running} onClick={() => { const before = clips[index - 1]; if (before) { const next = [...clips]; next[index - 1] = clip; next[index] = before; change(next) } }}>↑</button>
          <button type="button" disabled={busy || running} onClick={() => change(clips.filter((_, i) => i !== index))}>移出剪辑</button>
        </li>
      })}</ol>
      <div className={css.actions}><strong>总时长 {Number.isFinite(total) ? total.toFixed(1) : '—'} 秒</strong>
        <button type="button" disabled={busy || running || !valid} onClick={() => { void render() }}>{busy ? '正在提交…' : running ? '正在合成 MP4…' : pending.current ? '恢复上次导出' : '合成并导出 MP4'}</button>
        <span>{dirty ? '剪辑修改将在导出时保存' : '本地合成不调用付费生成模型'}</span></div>
      {state.cuts[0]?.status === 'Failed' && <p role="alert">合成失败：{state.cuts[0].errorCode}。原片仍保留。</p>}
      {latest && <section aria-label="成片播放器"><h3>成片 · 版本 {latest.version}</h3><video controls preload="metadata" src={latest.url} /><a href={latest.url} download={`青木-成片-v${latest.version}.mp4`} target="_blank" rel="noreferrer">下载 MP4</a></section>}
      {state.cuts.length > 1 && <details><summary>历史成片 · {state.cuts.length} 版</summary>{state.cuts.map(c => <p key={c.revisionId}>版本 {c.version} · {c.status} {c.url && <a href={c.url} target="_blank" rel="noreferrer">播放 / 下载</a>}</p>)}</details>}
    </>}
  </section>
}
