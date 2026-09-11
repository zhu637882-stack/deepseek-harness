import { useCallback, useEffect, useRef, useState } from 'react'
import css from './NativeVideoReview.module.css'

interface Props { readonly episodeId: string; readonly frameId: string; readonly assetId: string; readonly sha256: string }
interface Check { readonly status: string; readonly evidence: string; readonly time_ranges?: readonly (readonly number[])[] }
interface Review {
  readonly state: 'none' | 'pending' | 'complete' | 'failed'
  readonly designChanged?: boolean
  readonly reasons?: readonly string[]
  readonly audit?: { readonly audio_review?: { readonly checks?: Readonly<Record<string, Check>> } }
}
const categories = { dialogue: '对白内容', delivery: '语气与表演', ambience: '环境底声', acoustics: '空间声学', foley: '动作拟音', music: '配乐衔接' }
const statuses: Readonly<Record<string, string>> = { pass: '未发现问题', fail: '需调整', unverified: '无法确认', not_applicable: '本镜不涉及' }

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function report(value: Record<string, unknown>): Review {
  const raw = object(object(object(value.audit).audio_review).checks)
  const checks: Record<string, Check> = {}
  for (const key of Object.keys(categories)) {
    const check = object(raw[key])
    if (typeof check.status !== 'string' || typeof check.evidence !== 'string') continue
    checks[key] = { status: check.status, evidence: check.evidence, time_ranges: Array.isArray(check.time_ranges)
      ? check.time_ranges.filter((range): range is number[] => Array.isArray(range) && range.length === 2 && range.every(n => typeof n === 'number' && Number.isFinite(n))) : [] }
  }
  return { state: value.state as Review['state'], designChanged: value.designChanged === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : [],
    audit: { audio_review: { checks } } }
}

/** Review the browsed candidate; all automatic refreshes are read-only and never select a take. */
export function NativeVideoReview({ episodeId, frameId, assetId, sha256 }: Props) {
  const [review, setReview] = useState<Review>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(true)
  const url = `/api/qingmu/native-video-review?${new URLSearchParams({ episodeId, frameId, assetId, sha256 }).toString()}`
  const request = useCallback(async (method: 'GET' | 'POST', signal?: AbortSignal) => {
    const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      ...(signal === undefined ? {} : { signal }) })
    if (!response.ok) throw new Error('审片记录暂未取得，请刷新查看原任务。')
    const result: unknown = await response.json()
    if (typeof result !== 'object' || result === null || !('state' in result)
      || !['none', 'pending', 'complete', 'failed'].includes(String(result.state))
      || !('assetId' in result) || result.assetId !== assetId
      || !('assetSha256' in result) || result.assetSha256 !== sha256) throw new Error('审片结果与当前候选不一致。')
    if (live.current) { setReview(report(result as Record<string, unknown>)); setError('') }
  }, [url, assetId, sha256])
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
  return <section className={css.review} aria-label="候选音画检查">
    <div className={css.header}><div><h3>音画检查</h3><p>对照导演设计检查当前视频，结果用于审看与返修。</p></div>
      <button type="button" disabled={submitting || review === undefined || review.state === 'pending'
        || (review.state === 'complete' && !review.designChanged)}
      onClick={() => { void submit() }}>{submitting ? '正在提交…' : review?.state === 'pending' ? '正在检查音画…' : review?.state === 'complete' && !review.designChanged ? '本版已检查' : '检查当前视频'}</button>
      <button type="button" disabled={submitting} onClick={() => { void request('GET').catch(() => setError('记录暂未取得，请稍后刷新。')) }}>刷新记录</button></div>
    {error && <p role="alert">{error}</p>}
    <div role="status">{review?.state === 'pending' && '正在检查实际画面与原始音轨，可以切换镜头，返回后查看结果。'}
      {review?.state === 'failed' && '本次检查未完成，原视频保留。'}
      {review?.designChanged && '导演设计已有修改，下方保留的是此前设计的检查结果。'}</div>
    {review?.state === 'complete' && <>
      <div className={css.checks}>{Object.entries(categories).map(([key, label]) => {
        const check = checks?.[key]
        return <article key={key}><h4>{label}<span>{statuses[check?.status ?? ''] ?? '尚未确认'}</span></h4>
          <p>{check?.evidence ?? '本项没有可用的听觉证据。'}</p>
          {Array.isArray(check?.time_ranges) && check.time_ranges.length > 0 && <small>{check.time_ranges.map(range => `${range[0]}–${range[1]} 秒`).join('；')}</small>}</article>
      })}</div>
      {review.reasons && review.reasons.length > 0 && <details><summary>画面与综合检查意见</summary>
        <ul>{review.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
      <p>AI 检查供参考，最终是否采用由你决定。</p>
    </>}
  </section>
}
