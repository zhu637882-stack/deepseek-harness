/** A single image attempt with durable browser recovery and no automatic POST replay. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FirstFrameHistoryCandidate } from './first-frame-selection.ts'
import css from './ShootingFirstFrame.module.css'

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
  readonly canRegenerate?: boolean
  readonly canActivate?: boolean
  readonly execution?: { readonly taskId: string; readonly activated: boolean; readonly state: string }
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
      || typeof candidate.browserUrl !== 'string' || typeof candidate.isSelected !== 'boolean'
      || typeof candidate.qualityStatus !== 'string') throw new Error('候选回执不完整')
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
      if (task.local_status === 'dispatching' || task.provider_status === 'DISPATCHING') {
        return '正在提交原首帧请求，等待供应商回执；请勿重复生成。'
      }
      return '首帧任务已入队，等待派发进度更新；请勿重复生成。'
    case 'ProviderPending':
      return '供应商正在处理原首帧任务；关闭或刷新页面不会重复提交。'
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
export function ShootingFirstFrame({ scope, onCommitted, onCandidatePreview, requirementsReady = true, onReturnToStoryboard }: {
  readonly scope: ShootingFrameScope
  readonly onCommitted?: () => Promise<unknown>
  readonly onCandidatePreview?: (candidate: FirstFrameHistoryCandidate | undefined,
    url: string | undefined, ownsImagePreview?: boolean) => void
  /** The surrounding shooting workbench has read a saved requirement for this exact shot. */
  readonly requirementsReady?: boolean
  readonly onReturnToStoryboard?: () => void
}) {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  const [preview, setPreview] = useState<Preview>(); const [attempt, setAttempt] = useState<Attempt>()
  const [loadedImage, setLoadedImage] = useState<string>()
  const materialized = attempt?.candidate
  const imageKey = materialized ? `${key}:${materialized.assetId}:${materialized.sha256}:${materialized.browserUrl}` : undefined
  const previewCandidate = useMemo<FirstFrameHistoryCandidate | undefined>(() => materialized ? {
    assetId: materialized.assetId, materializedSha256: materialized.sha256,
    qualityStatus: materialized.qualityStatus, isSelected: materialized.isSelected,
    selectionStatus: materialized.isSelected ? 'Selected' : 'Unselected',
  } : undefined, [materialized?.assetId, materialized?.sha256, materialized?.qualityStatus, materialized?.isSelected])
  const [requestId, setRequestId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  // Prepared/failed attempts have no image to publish. Keep the existing history
  // thumbnail available there; a materialized attempt shares its already-loaded URL.
  const ownsImagePreview = Boolean(materialized) || (!attempt && !error && (!preview || Boolean(requestId)))
  useEffect(() => {
    onCandidatePreview?.(previewCandidate, loadedImage === imageKey ? materialized?.browserUrl : undefined, ownsImagePreview)
    return () => onCandidatePreview?.(undefined, undefined)
  }, [previewCandidate, imageKey, loadedImage, materialized?.browserUrl, ownsImagePreview, onCandidatePreview])
  const [review, setReview] = useState<FrameReview>(); const [confirming, setConfirming] = useState(false)
  const confirmingLock = useRef(false)
  const lock = useRef(false); const notified = useRef('')
  const input = { project_id: scope.projectId, episode_id: scope.episodeId, frame_ids: [scope.frameId] }
  const observeSubmission = (value: Attempt) => {
    setAttempt(value)
    if (!value.candidate && value.execution?.activated === false) {
      setError('原任务已保留，但执行器尚未启动；没有新建任务。可稍后继续原任务，具体原因已保留在开发日志。')
    }
  }
  const reviewQuery = new URLSearchParams({ project_id: scope.projectId, episode_id: scope.episodeId, frame_id: scope.frameId })
  useEffect(() => {
    if (!requirementsReady) return
    const controller = new AbortController()
    void request(`review?${reviewQuery}`, undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setReview(assertFrameReview(value, scope.frameId)) })
      .catch((cause) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [key, requirementsReady])
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const saved = localStorage.getItem(key)
        if (saved !== null) {
          const parsed = JSON.parse(saved) as { readonly preview: unknown; readonly requestId: string; readonly stage?: string }
          const prior = assertShootingPreview(parsed.preview, scope)
          if (parsed.requestId !== `shooting-${prior.preflightId}`) throw new Error('原提交记录不完整，禁止创建新任务')
          if (parsed.stage !== undefined && parsed.stage !== 'prepared' && parsed.stage !== 'submitted') throw new Error('原提交阶段不完整')
          setPreview(prior); if (parsed.stage !== 'prepared') setRequestId(parsed.requestId); return
        }
        if (!requirementsReady) return
        setBusy(true)
        const value = assertShootingPreview(await request('preview', input, controller.signal), scope)
        if (!controller.signal.aborted) setPreview(value)
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load()
    return () => controller.abort()
  }, [key, requirementsReady])
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
        // Materialization can precede quality completion. Keep reading the
        // same task until terminal so its recovery/rework actions stay current.
        if (submissionBlocker(value) || ['Failed', 'Cancelled', 'Succeeded'].includes(value.task?.kernel_status ?? '')) return
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 4000)
    }
    void poll()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [key, requestId])
  const submit = async () => {
    if (!requirementsReady || lock.current || requestId || !preview || preview.blockers.length || busy || review?.accepted !== true) return
    lock.current = true; setBusy(true); setError('')
    const id = `shooting-${preview.preflightId}`
    try {
      // Storage failure aborts before POST. Refresh never repeats this POST.
      localStorage.setItem(key, JSON.stringify({ preview, requestId: id }))
      setRequestId(id)
      const value = assertAttempt(await request('submit', { ...input, candidate_request_id: id,
        shooting_preflight_id: preview.preflightId, shooting_payload_hash: preview.payloadHash }), scope, id)
      observeSubmission(value)
    } catch (cause) { setError(String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const resume = async () => {
    if (!requirementsReady || busy || lock.current || !requestId || !preview) return
    lock.current = true; setBusy(true); setError('')
    try {
      const value = assertAttempt(await request('submit', { ...input, candidate_request_id: requestId,
        shooting_preflight_id: preview.preflightId, shooting_payload_hash: preview.payloadHash }), scope, requestId)
      observeSubmission(value)
    } catch (cause) { setError(String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const prepareAgain = async (rework = false) => {
    if (!requirementsReady) return
    if (requestId) {
      const query = new URLSearchParams({ ...Object.fromEntries(reviewQuery), request_id: requestId })
      const latest = assertAttempt(await request(`state?${query}`), scope, requestId)
      setAttempt(latest)
      if (rework ? latest.canRegenerate !== true : latest.task !== null) return
    }
    const fresh = assertShootingPreview(await request('preview', { ...input, ...(rework ? { candidate_request_id: requestId } : {}) }), scope)
    const currentReview = assertFrameReview(await request(`review?${reviewQuery}`), scope.frameId)
    // Same inputs retain the same durable request ID; changed inputs make the
    // old preflight fail source validation. This never sends a generation POST.
    if (rework) localStorage.setItem(key, JSON.stringify({ preview: fresh, requestId: `shooting-${fresh.preflightId}`, stage: 'prepared' }))
    else localStorage.removeItem(key)
    setReview(currentReview); setRequestId(''); setAttempt(undefined); lock.current = false; setPreview(fresh)
  }
  const confirm = async () => {
    if (!requirementsReady || !review || review.accepted || !review.preflight.technicalReady || confirmingLock.current) return
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
  if (!requirementsReady) return <section aria-label="首帧生成" className={css.generation}>
    <div className={css.preview}><div className={css.preparation} role="alert"><h3>先核对本镜分镜要求</h3><p>尚未读取到本镜已保存的首帧要求，因此没有开始预检或生成。</p>{requestId && <p role="status">正在读取已存在首帧任务；不会重新提交。</p>}</div></div>
    <div className={css.actions}>{onReturnToStoryboard && <button className={css.primary} type="button" onClick={onReturnToStoryboard}>返回分镜核对要求</button>}</div>
  </section>
  const blocked = submissionBlocker(attempt) ?? submissionBlocker(preview)
  return <section aria-label="首帧生成" className={css.generation} aria-busy={busy}>
    <div className={css.preview}>
      {attempt?.candidate && (!review || review.accepted) ? <figure>
        <img src={attempt.candidate.browserUrl} alt="镜头新首帧 · 待你定版" onLoad={() => setLoadedImage(imageKey)} onError={() => setLoadedImage(undefined)} />
        <figcaption>{attempt.candidate.isSelected ? '当前选用首帧' : '新首帧候选 · 待你审看，尚未采用'}</figcaption>
      </figure> : <div className={css.preparation}>
        {review && !review.accepted ? <div aria-label="本镜分镜确认">
          <h3>先确认本镜分镜</h3><p>下面是本次生成使用的画面要求。确认只针对本镜，不会启动生成。</p>
          <div className={css.reviewText}>{review.imagePromptCn}</div>
          {!review.preflight.technicalReady && <p role="alert">本镜分镜存在输入矛盾，请先修改后确认。</p>}
        </div> : blocked ? <div role="alert"><h3>还未开始生成</h3><p>本镜的生成条件尚未满足，请核对当前要求与分镜确认状态。未提交本次生成。</p></div>
          : requestId ? <div role="status"><h3>{attemptMessage(attempt?.task)}</h3><p>你可以离开此页，返回后继续查看同一任务。</p></div>
            : busy ? <div role="status"><h3>正在准备首帧</h3><p>正在编译提示词与检查当前要求，尚未提交生成。</p></div>
              : preview && <div><h3>{preview.blockers.length ? '请先调整本镜要求' : '可以生成首帧了'}</h3><p>{preview.blockers.length ? '生成条件未通过，未提交、未收费。' : '使用右侧已保存的要求，生成一张新候选。原素材保持不变。'}</p></div>}
      </div>}
    </div>
    {attempt?.candidate && <div className={css.candidate} aria-label="首帧候选条"><button type="button" aria-pressed="true"><img src={attempt.candidate.browserUrl} alt="新首帧候选缩略图" /><span>本次新首帧<small>{attempt.candidate.isSelected ? '已选用' : '待定版'}</small></span></button></div>}
    <div className={css.actions}>
      {attempt?.canActivate === true && !busy && <button type="button" onClick={() => { void resume() }}>继续原首帧任务</button>}
      {attempt?.canRegenerate === true && !busy && <button type="button" onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(true); setError('')
        void prepareAgain(true).catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
      }}>重新生成首帧</button>}
      {review && !review.accepted && <>
        {confirming ? <p role="status">正在保存你的本镜确认…</p>
          : review.preflight.technicalReady && <button className={css.primary} type="button" onClick={() => { void confirm() }}>确认本镜分镜</button>}
      </>}
      {review?.accepted === true && requestId && attempt?.task === null && !busy && !confirming &&
      <button type="button" onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        void prepareAgain().catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
      }}>重新检查本镜生成条件</button>}
      {!attempt?.candidate && !blocked && !requestId && !busy && preview?.blockers.length === 0 && review?.accepted === true && <button className={css.primary} type="button" onClick={() => { void submit() }}>生成这张首帧（仅一次）</button>}
    </div>
    {error && <p role="alert" className={css.error}>{error.includes('digest_mismatch') ? '分镜在确认前已发生变化，本次没有确认。请刷新，核对新的画面要求。'
      : error.includes('执行器尚未启动') ? '原任务已保存，但执行器尚未启动。请查看原任务结果，不要重复生成。'
        : '本次操作未确认完成。请保留当前候选，查看原任务结果；不要重复提交。详细原因已放入开发日志。'}</p>}
    <details className={css.log}><summary>开发日志</summary>
      <h4>最终编译 prompt（提交前）</h4><pre style={{ whiteSpace: 'pre-wrap' }}>{preview?.prompt ?? '尚未取得完整预检'}</pre>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ storyboardReview: review, preflightId: preview?.preflightId, payloadHash: preview?.payloadHash, estimatedCny: preview?.estimatedCny, blockers: preview?.blockers, submissionBlocker: blocked?.detail, requestId, attempt, error }, null, 2)}</pre>
    </details>
  </section>
}
