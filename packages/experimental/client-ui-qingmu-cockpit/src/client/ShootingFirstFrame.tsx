/** A single image attempt with durable browser recovery and no automatic POST replay. */
import { useEffect, useRef, useState } from 'react'

export interface ShootingFrameScope { readonly projectId: string; readonly episodeId: string; readonly frameId: string }
interface Preview extends ShootingFrameScope {
  readonly schema: 'qingmu.shooting-first-frame-preview.v1'
  readonly preflightId: string
  readonly payloadHash: string
  readonly prompt: string
  readonly povObserver: string
  readonly estimatedCny: number
  readonly blockers: readonly string[]
  readonly maxAttempts: 1
  readonly n: 1
  readonly selectAsOfficial: false
}
interface Attempt extends ShootingFrameScope {
  readonly schema: 'qingmu.shooting-first-frame-state.v1'
  readonly requestId: string
  readonly task: null | {
    readonly id: string
    readonly kernel_status: string
    readonly local_status: string
    readonly provider_status: string
    readonly error_code: string | null
  }
  readonly candidate: null | {
    readonly assetId: string
    readonly sha256: string
    readonly browserUrl: string
    readonly isSelected: boolean
    readonly qualityStatus: string
  }
}
interface FrameReview {
  readonly frameId: string
  readonly frameDigest: string
  readonly accepted: boolean
  readonly title: string
  readonly imagePromptCn: string
  readonly preflight: { readonly technicalReady: boolean }
}
function assertFrameReview(value: unknown, frameId: string): FrameReview {
  if (!value || typeof value !== 'object') throw new Error('本镜签收状态不可用')
  const item = value as FrameReview
  if (item.frameId !== frameId || typeof item.frameDigest !== 'string' || !/^[a-f0-9]{64}$/.test(item.frameDigest)
    || typeof item.accepted !== 'boolean' || typeof item.title !== 'string' || typeof item.imagePromptCn !== 'string'
    || typeof item.preflight?.technicalReady !== 'boolean') throw new Error('本镜签收修订不完整')
  return item
}
const sha = /^[a-f0-9]{64}$/
function submissionBlocker(value: unknown): { message: string; detail: unknown } | undefined {
  if (!value || typeof value !== 'object') return
  const detail = (value as Record<string, unknown>).submissionBlocker
  if (!detail) return
  const message = typeof detail === 'object' && typeof (detail as Record<string, unknown>).message === 'string'
    ? String((detail as Record<string, unknown>).message) : '当前分镜尚未满足原有生成条件，请查看开发日志。'
  return { message, detail }
}
function scoped(value: unknown, scope: ShootingFrameScope): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return item.projectId === scope.projectId && item.episodeId === scope.episodeId && item.frameId === scope.frameId
}
/** Validate preview scope and the one-shot/no-selection restrictions before showing submit.
 * @param value Writer preview.
 * @param scope Current frame.
 * @returns Validated preview.
 */
export function assertShootingPreview(value: unknown, scope: ShootingFrameScope): Preview {
  if (!scoped(value, scope) || value.schema !== 'qingmu.shooting-first-frame-preview.v1'
    || typeof value.preflightId !== 'string' || !sha.test(value.preflightId)
    || typeof value.payloadHash !== 'string' || !sha.test(value.payloadHash)
    || typeof value.prompt !== 'string' || !value.prompt || !Array.isArray(value.blockers)
    || !value.blockers.every(x => typeof x === 'string') || typeof value.povObserver !== 'string'
    || typeof value.estimatedCny !== 'number' || !Number.isFinite(value.estimatedCny) || value.estimatedCny < 0
    || value.n !== 1 || value.maxAttempts !== 1 || value.selectAsOfficial !== false) throw new Error('首帧预检回执不完整，未提交')
  return value as unknown as Preview
}
async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/qingmu/shooting-first-frame/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })
  const value = await response.json() as { readonly detail?: unknown }
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : JSON.stringify(value.detail ?? '本镜请求未完成'))
  return value
}
function assertAttempt(value: unknown, scope: ShootingFrameScope, requestId: string): Attempt {
  if (!scoped(value, scope) || value.schema !== 'qingmu.shooting-first-frame-state.v1' || value.requestId !== requestId
    || !('task' in value) || !('candidate' in value)) throw new Error('原任务回读与当前镜头不一致')
  if (value.task !== null) {
    const task = value.task as Record<string, unknown>
    if (!task || typeof task.id !== 'string' || typeof task.kernel_status !== 'string') throw new Error('任务状态不完整')
  }
  if (value.candidate !== null) {
    const candidate = value.candidate as Record<string, unknown>
    if (!candidate || typeof candidate.assetId !== 'string' || typeof candidate.sha256 !== 'string' || !sha.test(candidate.sha256)
      || typeof candidate.browserUrl !== 'string' || typeof candidate.isSelected !== 'boolean') throw new Error('候选回执不完整')
    const url = new URL(candidate.browserUrl, location.origin)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)
      || !/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.username || url.password || url.hash) throw new Error('候选地址不属于青木素材')
  }
  return value as unknown as Attempt
}
/** Describe the observed task stage without treating a queue receipt as Provider execution. */
function attemptMessage(task: Attempt['task'] | undefined): string {
  switch (task?.kernel_status) {
    case 'DispatchPending':
      return '首帧任务已入队，等待派发进度更新；请勿重复生成。'
    case 'Failed': case 'Cancelled':
      return '本次生成未完成，已停止，不自动重试。'
    case 'QualityPending':
      return '正在检查生成结果并准备候选，尚未人工认可。'
    case 'Succeeded':
      return '任务已结束，但候选尚未就绪，需要检查结果落盘；未重新生成。'
    default:
      return task ? '正在读取原任务进度；关闭或刷新页面不会重复提交。'
        : '正在核对原提交结果；不会重复提交。'
  }
}
/** Native image generation. Storyboard confirmation is explicit; media selection remains separate. */
export function ShootingFirstFrame({ scope, onCommitted }: {
  readonly scope: ShootingFrameScope
  readonly onCommitted?: () => Promise<unknown>
}) {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  const [preview, setPreview] = useState<Preview>(); const [attempt, setAttempt] = useState<Attempt>()
  const [requestId, setRequestId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<FrameReview>(); const [confirming, setConfirming] = useState(false)
  const confirmingLock = useRef(false)
  const lock = useRef(false); const notified = useRef('')
  const input = { project_id: scope.projectId, episode_id: scope.episodeId, frame_ids: [scope.frameId] }
  const reviewQuery = new URLSearchParams({ project_id: scope.projectId, episode_id: scope.episodeId, frame_id: scope.frameId })
  useEffect(() => {
    const controller = new AbortController()
    void request(`review?${reviewQuery}`, undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setReview(assertFrameReview(value, scope.frameId)) })
      .catch((cause) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [key])
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const saved = localStorage.getItem(key)
        if (saved !== null) {
          const parsed = JSON.parse(saved) as { readonly preview: unknown; readonly requestId: string }
          const prior = assertShootingPreview(parsed.preview, scope)
          if (parsed.requestId !== `shooting-${prior.preflightId}`) throw new Error('原提交记录不完整，禁止创建新任务')
          setPreview(prior); setRequestId(parsed.requestId); return
        }
        setBusy(true)
        const value = assertShootingPreview(await request('preview', input, controller.signal), scope)
        if (!controller.signal.aborted) setPreview(value)
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load()
    return () => controller.abort()
  }, [key])
  useEffect(() => {
    if (!requestId) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const query = new URLSearchParams({
          project_id: scope.projectId, episode_id: scope.episodeId, frame_id: scope.frameId, request_id: requestId,
        })
        const value = assertAttempt(await request(`state?${query}`, undefined, controller.signal), scope, requestId)
        if (controller.signal.aborted) return
        setAttempt(value)
        if (value.candidate && notified.current !== value.candidate.assetId) {
          notified.current = value.candidate.assetId; await onCommitted?.()
        }
        if (value.candidate || submissionBlocker(value) || ['Failed', 'Cancelled', 'Succeeded'].includes(value.task?.kernel_status ?? '')) return
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 4000)
    }
    void poll()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [key, requestId])
  const submit = async () => {
    if (lock.current || requestId || !preview || preview.blockers.length || busy || review?.accepted !== true) return
    lock.current = true; setBusy(true); setError('')
    const id = `shooting-${preview.preflightId}`
    try {
      // Storage failure aborts before POST. Refresh never repeats this POST.
      localStorage.setItem(key, JSON.stringify({ preview, requestId: id }))
      setRequestId(id)
      const value = assertAttempt(await request('submit', { ...input, candidate_request_id: id,
        shooting_preflight_id: preview.preflightId, shooting_payload_hash: preview.payloadHash }), scope, id)
      setAttempt(value)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const prepareAgain = async () => {
    const fresh = assertShootingPreview(await request('preview', input), scope)
    if (requestId) {
      const query = new URLSearchParams({ ...Object.fromEntries(reviewQuery), request_id: requestId })
      const latest = assertAttempt(await request(`state?${query}`), scope, requestId)
      setAttempt(latest)
      if (latest.task !== null) return // lost response: keep recovering the existing task
    }
    // Same inputs retain the same durable request ID; changed inputs make the
    // old preflight fail source validation. This never sends a generation POST.
    localStorage.removeItem(key); setRequestId(''); setAttempt(undefined); lock.current = false; setPreview(fresh)
  }
  const confirm = async () => {
    if (!review || review.accepted || !review.preflight.technicalReady || confirmingLock.current) return
    confirmingLock.current = true; setConfirming(true); setError('')
    try {
      // Bind the revision already shown to the human. Never fetch-and-sign a newer revision.
      const value = await request('confirm', { ...input, expected_frame_digest: review.frameDigest,
        idempotency_key: `shot-review-${scope.frameId}-${review.frameDigest.slice(0, 32)}` }) as { readonly status: unknown }
      const accepted = assertFrameReview(value.status, scope.frameId)
      if (accepted.frameDigest !== review.frameDigest || !accepted.accepted) throw new Error('分镜已变化，请重新查看后确认')
      setReview(accepted)
      // A known pre-queue rejection can be prepared again after this explicit
      // human action. An indeterminate/in-flight paid request is never replayed.
      if (!requestId || (attempt?.task === null && submissionBlocker(attempt))) {
        await prepareAgain()
      }
    } catch (cause) { setError(String(cause)) }
    finally { confirmingLock.current = false; setConfirming(false) }
  }
  const blocked = submissionBlocker(attempt) ?? submissionBlocker(preview)
  return <section aria-label="首帧生成" style={{ width: '100%', height: '100%', overflow: 'auto', padding: '16px', boxSizing: 'border-box' }}>
    {review && !review.accepted && <div aria-label="本镜分镜确认">
      <h3>{review.title}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{review.imagePromptCn}</p>
      {confirming ? <p role="status">正在保存你的本镜确认…</p>
        : review.preflight.technicalReady ? <button type="button" onClick={() => { void confirm() }}>确认本镜分镜</button>
          : <p role="alert">本镜分镜存在输入矛盾，请先修改后确认。</p>}
      <p>只确认当前分镜，不采用首帧，不启动付费生成。</p>
    </div>}
    {review?.accepted === true && requestId && attempt?.task === null && !busy && !confirming &&
      <button type="button" onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        void prepareAgain().catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
      }}>重新检查本镜生成条件</button>}
    {attempt?.candidate ? <>
      <figure><img style={{ maxWidth: '100%', maxHeight: '54vh', objectFit: 'contain' }} src={attempt.candidate.browserUrl} alt="镜头新首帧 · 待你定版" /><figcaption>新首帧候选 · 待你审看，尚未采用</figcaption></figure>
      <div aria-label="首帧候选条"><button type="button" aria-pressed="true"><img width="72" src={attempt.candidate.browserUrl} alt="新首帧候选缩略图" />本次新首帧 · 待定版</button></div>
    </> : blocked ? <p role="alert">尚未进入生成，未创建本次任务。{blocked.message}</p>
      : requestId ? <p role="status">{attemptMessage(attempt?.task)}</p>
        : busy ? <p role="status">正在编译最终提示词与检查生成条件…</p> : preview && <>
          {preview.blockers.length ? <p role="alert">生成条件未通过，未提交、未收费。</p> : review?.accepted === true && <button type="button" onClick={() => { void submit() }}>生成这张首帧（仅一次）</button>}
        </>}
    {error && <p role="alert">{error}</p>}
    <details><summary>开发日志</summary>
      <h4>最终编译 prompt（提交前）</h4><pre style={{ whiteSpace: 'pre-wrap' }}>{preview?.prompt ?? '尚未取得完整预检'}</pre>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ storyboardReview: review, preflightId: preview?.preflightId, payloadHash: preview?.payloadHash, estimatedCny: preview?.estimatedCny, blockers: preview?.blockers, submissionBlocker: blocked?.detail, requestId, attempt, error }, null, 2)}</pre>
    </details>
  </section>
}
