import { useCallback, useEffect, useRef, useState } from 'react'
import css from './NativeVideoReview.module.css'

interface Props {
  readonly episodeId: string
  readonly frameId: string
  readonly assetId: string
  readonly sha256: string
  readonly onSeek?: (timeSec: number) => void
}
interface Check {
  readonly status: string
  readonly evidence: string
  readonly time_ranges?: readonly (readonly [number, number])[]
  readonly evidenceIncomplete?: boolean
}
interface Observation { readonly start_sec: number; readonly end_sec: number; readonly description: string }
interface Review {
  readonly state: 'none' | 'pending' | 'complete' | 'failed'
  readonly designChanged?: boolean
  readonly methodChanged?: boolean
  readonly reasons?: readonly string[]
  readonly audit?: { readonly audio_review?: { readonly checks?: Readonly<Record<string, Check>> } }
  readonly visualEvidence?: { readonly checks: Readonly<Record<string, Check>>; readonly observations: readonly Observation[] }
}
const categories = { dialogue: '对白内容', delivery: '语气与表演', ambience: '环境底声', acoustics: '空间声学', foley: '动作拟音', music: '配乐衔接' }
const visualCategories = { temporal_action_match: '动作与因果', camera_execution_match: '摄影与运镜', performance_match: '人物表演', continuity_match: '位置与状态连续', visual_artifact_free: '画面瑕疵', catastrophic_ai_artifact_free: '严重变形与穿模', identity_match: '人物身份', dialogue_match: '说话人与口型', narrative_intelligible: '叙事可理解性' }
const statuses: Readonly<Record<string, string>> = { pass: '未发现问题', fail: '需调整', unverified: '无法确认', not_applicable: '本镜不涉及' }

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function validRange(range: unknown): range is [number, number] {
  return Array.isArray(range) && range.length === 2 && range.every(n => typeof n === 'number' && Number.isFinite(n)) && range[0] >= 0 && range[1] > range[0]
}
function readChecks(value: unknown, keys: readonly string[]): Record<string, Check> {
  const raw = object(value)
  const checks: Record<string, Check> = {}
  for (const key of keys) {
    const check = object(raw[key])
    if (typeof check.status !== 'string' || typeof check.evidence !== 'string') continue
    checks[key] = { status: check.status, evidence: check.evidence, evidenceIncomplete: check.evidenceIncomplete === true,
      time_ranges: Array.isArray(check.time_ranges) ? check.time_ranges.filter(validRange) : [] }
  }
  return checks
}
function report(value: Record<string, unknown>): Review {
  const checks = readChecks(object(object(value.audit).audio_review).checks, Object.keys(categories))
  const visual = object(value.visualEvidence)
  const observations: Observation[] = []
  for (const raw of Array.isArray(visual.observations) ? visual.observations : []) {
    const item = object(raw)
    const range = [item.start_sec, item.end_sec]
    if (validRange(range) && typeof item.description === 'string') {
      observations.push({ start_sec: range[0], end_sec: range[1], description: item.description })
    }
  }
  return { state: value.state as Review['state'], designChanged: value.designChanged === true,
    methodChanged: value.methodChanged === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : [],
    audit: { audio_review: { checks } },
    ...(value.visualEvidence
      ? { visualEvidence: { checks: readChecks(visual.checks, Object.keys(visualCategories)), observations } } : {}) }
}

/** Review the browsed candidate; all automatic refreshes are read-only and never select a take. */
export function NativeVideoReview({ episodeId, frameId, assetId, sha256, onSeek }: Props) {
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
  const canRecheck = review?.designChanged || review?.methodChanged
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
    {review?.state === 'complete' && <>
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
    </>}
  </section>
}
