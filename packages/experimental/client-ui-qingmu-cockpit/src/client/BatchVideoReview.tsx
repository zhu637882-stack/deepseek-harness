import { useEffect, useRef, useState } from 'react'
import { requestNativeVideoReview, reviewSummary, type Review } from './native-video-review.ts'
import type { BatchBasis } from './reference-video-batch.ts'

/** The latest returned candidate per shot is checked with the ordinary advisory review service. */
export function BatchVideoReview({ episodeId, basis, onOpenShot }: {
  readonly episodeId: string
  readonly basis: BatchBasis
  readonly onOpenShot: (frameId: string) => void
}) {
  const targets = basis.shots.flatMap((shot) => {
    const candidate = shot.runs.find(run => run.publicStatus === 'succeeded')?.candidates[0]
    return candidate ? [{ episodeId, frameId: shot.frameId, label: shot.label,
      assetId: candidate.assetId, sha256: candidate.assetSha256 }] : []
  })
  const scope = JSON.stringify(targets)
  const [reports, setReports] = useState<ReadonlyMap<string, Review>>(new Map())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = JSON.parse(scope) as typeof targets
    async function read() {
      let pending = false
      await Promise.allSettled(current.map(async ({ label: _label, ...target }) => {
        try {
          const result = await requestNativeVideoReview(target, 'GET', controller.signal)
          pending ||= result.state === 'pending'
          if (!controller.signal.aborted) {
            setReports(previous => new Map(previous).set(target.assetId, result))
            setErrors((previous) => { const next = new Map(previous); next.delete(target.assetId); return next })
          }
        } catch (cause) {
          if (!controller.signal.aborted) setErrors(previous => new Map(previous).set(target.assetId, String(cause)))
        }
      }))
      if (pending && !controller.signal.aborted) timer = setTimeout(() => { void read() }, 5000)
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [scope, refresh])
  async function check() {
    if (busy) return
    setBusy(true)
    // Re-read before each POST: an interrupted batch resumes only the missing/outdated reports.
    for (const { label: _label, ...target } of targets) {
      try {
        let result = await requestNativeVideoReview(target, 'GET')
        if (result.state !== 'pending' && (result.state !== 'complete' || result.designChanged || result.methodChanged)) {
          result = await requestNativeVideoReview(target, 'POST')
        }
        if (live.current) {
          setReports(previous => new Map(previous).set(target.assetId, result))
          setErrors((previous) => { const next = new Map(previous); next.delete(target.assetId); return next })
        }
      } catch (cause) { if (live.current) setErrors(previous => new Map(previous).set(target.assetId, String(cause))) }
    }
    if (live.current) { setBusy(false); setRefresh(value => value + 1) }
  }
  return <section aria-label="整集音画检查">
    <p>检查每镜最近返回的一条候选，对照导演设计查看动作、人物、场景及声音。已有本版报告会复用，检查不会自动选用视频。</p>
    <button type="button" disabled={busy || !targets.length} onClick={() => { void check() }}>{busy ? '正在安排检查…' : '集中检查已返回视频'}</button>
    <button type="button" disabled={busy} onClick={() => { setRefresh(value => value + 1) }}>刷新检查结果</button>
    {!targets.length && <p>视频返回后即可集中检查。</p>}
    <ul>{targets.map((target) => {
      const report = reports.get(target.assetId)
      return <li key={target.assetId}>
        <button type="button" onClick={() => { onOpenShot(target.frameId) }}>{target.label}</button>{' '}
        <span>{errors.get(target.assetId) ?? (report ? reviewSummary(report) : '正在读取检查记录…')}</span>
      </li>})}</ul>
  </section>
}
