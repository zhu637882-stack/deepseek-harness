import { useCallback, useEffect, useRef, useState } from 'react'
import css from './NativeVideoReview.module.css'
import { categories, visualCategories, statuses, reviewSummary, requestNativeVideoReview, type Review } from './native-video-review.ts'

interface Props {
  readonly episodeId: string
  readonly frameId: string
  readonly assetId: string
  readonly sha256: string
  readonly onSeek?: (timeSec: number) => void
}
/** Review the browsed candidate; all automatic refreshes are read-only and never select a take. */
export function NativeVideoReview({ episodeId, frameId, assetId, sha256, onSeek }: Props) {
  const [review, setReview] = useState<Review>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(true)
  const scopeKey = `${episodeId}:${frameId}:${assetId}:${sha256}`
  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey
  const request = useCallback(async (method: 'GET' | 'POST', signal?: AbortSignal) => {
    const result = await requestNativeVideoReview({ episodeId, frameId, assetId, sha256 }, method, signal)
    if (live.current && currentScope.current === scopeKey && !signal?.aborted) { setReview(result); setError('') }
  }, [episodeId, frameId, assetId, sha256, scopeKey])
  useEffect(() => {
    live.current = true
    const controller = new AbortController()
    void request('GET', controller.signal).catch(() => { if (!controller.signal.aborted) setError('审片记录暂未载入。') })
    return () => { live.current = false; controller.abort() }
  }, [request])
  useEffect(() => {
    if (review?.state !== 'pending') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void request('GET', controller.signal).catch(() => { if (!controller.signal.aborted) setError('检查仍可在后台继续，请稍后刷新记录。') })
    }, 5000)
    return () => { clearTimeout(timer); controller.abort() }
  }, [review, request])
  async function submit(): Promise<void> {
    if (submitting || review?.state === 'pending') return
    setSubmitting(true); setError('')
    try { await request('POST') } catch { if (live.current) setError('提交结果尚未确认。请先刷新记录，避免重复操作。') }
    finally { if (live.current) setSubmitting(false) }
  }
  const checks = review?.audit?.audio_review?.checks
  const canRecheck = review?.designChanged || review?.methodChanged
  const reportedChecks = [...Object.values(checks ?? {}), ...Object.values(review?.visualEvidence?.checks ?? {})]
  function times(ranges: readonly (readonly [number, number])[] | undefined) {
    return <div className={css.times}>{ranges?.map((range, index) => onSeek
      ? <button type="button" key={index} onClick={() => onSeek(range[0])} aria-label={`查看 ${range[0]} 至 ${range[1]} 秒`}>{range[0]}–{range[1]} 秒</button>
      : <small key={index}>{range[0]}–{range[1]} 秒</small>)}</div>
  }
  return <section className={css.review} aria-label="候选音画检查">
    <div className={css.header}><div><h3>音画检查</h3><p>对照导演设计检查当前视频，结果用于审看与返修。</p></div>
      <button type="button" disabled={submitting || review === undefined || review.state === 'pending'
        || (review.state === 'complete' && !canRecheck)}
      onClick={() => { void submit() }}>{submitting ? '正在提交…' : review?.state === 'pending' ? '正在检查音画…' : review?.state === 'complete' && !canRecheck ? '本版已检查' : review?.methodChanged ? '按时间重新检查' : '检查当前视频'}</button>
      <button type="button" disabled={submitting} onClick={() => { void request('GET').catch(() => setError('记录暂未取得，请稍后刷新。')) }}>刷新记录</button></div>
    {error && <p role="alert">{error}</p>}
    <div role="status">{review?.state === 'pending' && '正在检查实际画面与原始音轨，可以切换镜头，返回后查看结果。'}
      {review?.state === 'failed' && '本次检查未完成，原视频保留。'}
      {review?.designChanged && '导演设计已有修改，下方保留的是此前设计的检查结果。'}</div>
    {review?.methodChanged && <p>
      这份旧检查没有完整的时间观察记录，可按更新后的方法重新检查；浏览和刷新不会发起检查。
    </p>}
    {review?.state === 'complete' && <details>
      <summary>检查详情 · {reviewSummary(review)}</summary>
      {reportedChecks.length === 0 && <p>本次没有可用的逐项检查证据。</p>}
      {review.visualEvidence && <details open><summary>画面变化与定位</summary>
        <p>以下为 AI 观察，点击时间核对原视频；证据不足的判断保留为无法确认。</p>
        {review.visualEvidence.observations.length === 0 ? <p>本次没有可定位的画面观察。</p>
          : <ol>{review.visualEvidence.observations.map((item, index) => <li key={index}>
            {times([[item.start_sec, item.end_sec]])}<p>{item.description}</p>
          </li>)}</ol>}
        <details><summary>逐项画面检查</summary><div className={css.checks}>{Object.entries(visualCategories).map(([key, label]) => {
          const check = review.visualEvidence?.checks[key]
          return <article key={key}><h4>{label}<span>{statuses[check?.status ?? ''] ?? '尚未确认'}</span></h4>
            <p>{check?.evidence || '没有可用的画面证据。'}</p>
            {check?.evidenceIncomplete && <p>该判断缺少有效时间或对应观察，暂不能确认。</p>}{times(check?.time_ranges)}</article>
        })}</div></details>
      </details>}
      <div className={css.checks}>{Object.entries(categories).map(([key, label]) => {
        const check = checks?.[key]
        return <article key={key}><h4>{label}<span>{statuses[check?.status ?? ''] ?? '尚未确认'}</span></h4>
          <p>{check?.evidence ?? '本项没有可用的听觉证据。'}</p>
          {times(check?.time_ranges)}</article>
      })}</div>
      {review.reasons && review.reasons.length > 0 && <details><summary>画面与综合检查意见</summary>
        <ul>{review.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
      <p>AI 检查供参考，最终是否采用由你决定。</p>
    </details>}
  </section>
}
