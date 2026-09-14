import { useEffect, useRef, useState } from 'react'
import { requestNativeVideoReview, reviewSummary, type Review } from './native-video-review.ts'
import type { BatchBasis, BatchPort } from './reference-video-batch.ts'

/** The latest returned candidate per shot is checked with the ordinary advisory review service. */
export function BatchVideoReview({ episodeId, basis, port, onOpenShot }: {
  readonly port: Pick<BatchPort, 'readReferenceVideoCandidateRegistration'>
  readonly episodeId: string
  readonly basis: BatchBasis
  readonly onOpenShot: (frameId: string) => void
}) {
  const targets = basis.shots.flatMap((shot) => {
    const run = shot.runs.find(item => item.publicStatus === 'succeeded')
    const candidate = run?.candidates[0]
    return candidate && run ? [{ episodeId, frameId: shot.frameId, label: shot.label,
      runId: run.runId, assetId: candidate.assetId, sha256: candidate.assetSha256 }] : []
  })
  const scope = JSON.stringify(targets)
  async function request(target: typeof targets[number], method: 'GET' | 'POST', signal?: AbortSignal) {
    const registered = await port.readReferenceVideoCandidateRegistration({ projectId: basis.projectId,
      frameId: target.frameId, runId: target.runId, assetId: target.assetId, expectedAssetSha256: target.sha256 })
    if (!registered.takeId) throw new Error('视频尚未进入候选审看，请先同步视频结果。')
    return requestNativeVideoReview({ episodeId, frameId: target.frameId, assetId: registered.takeId,
      sha256: target.sha256 }, method, signal)
  }
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
      await Promise.allSettled(current.map(async (target) => {
        try {
          const result = await request(target, 'GET', controller.signal)
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
    for (const target of targets) {
      try {
        let result = await request(target, 'GET')
        if (result.state !== 'pending' && (result.state !== 'complete' || result.designChanged || result.methodChanged)) {
          result = await request(target, 'POST')
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
