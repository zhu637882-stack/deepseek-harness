/** A single image attempt with durable browser recovery and no automatic POST replay. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FirstFrameHistoryCandidate } from './first-frame-selection.ts'
import type { AssetImageReference } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { AssetImageReferences, type AssetImageReferencePort } from './AssetImageReferences.tsx'
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
  readonly references?: readonly { readonly kind: string; readonly name: string; readonly role: string }[]
  readonly referenceMode?: 'official' | 'working'
  readonly referenceBindings?: readonly AssetImageReference[] | null
  readonly compositionReference?: null | { readonly imageUrl: string; readonly sha256: string; readonly sceneName: string }
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
  if (value.references !== undefined && (!Array.isArray(value.references) || !value.references.every(item =>
    item && typeof item.kind === 'string' && typeof item.name === 'string' && typeof item.role === 'string'))) {
    throw new Error('首帧参考素材说明不完整')
  }
  if (value.referenceMode === 'working' && (!Array.isArray(value.referenceBindings)
    || value.referenceBindings.length < 1 || value.referenceBindings.length > 9
    || !value.referenceBindings.every(item => item && typeof item.assetId === 'string'
      && typeof item.assetSha256 === 'string' && sha.test(item.assetSha256)
      && typeof item.purpose === 'string' && item.purpose.trim() && (!item.boxes || item.boxes.length === 0)))) {
    throw new Error('首帧指定参考图绑定不完整')
  }
  if (value.compositionReference !== undefined && value.compositionReference !== null) {
    const composition = value.compositionReference as Record<string, unknown>
    if (typeof composition.imageUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(composition.imageUrl)
      || typeof composition.sha256 !== 'string' || !sha.test(composition.sha256)
      || typeof composition.sceneName !== 'string') throw new Error('首帧空间取景回执不完整')
  }
  return value as unknown as Preview
}
class FrameRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/qingmu/shooting-first-frame/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })
  const value = await response.json() as { readonly detail?: unknown }
  if (!response.ok) throw new FrameRequestError(typeof value.detail === 'string' ? value.detail : JSON.stringify(value.detail ?? '本镜请求未完成'), response.status)
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
export function ShootingFirstFrame({
  scope, onCommitted, onCandidatePreview, requirementsReady = true, onReturnToStoryboard, referencePort,
}: {
  readonly scope: ShootingFrameScope
  readonly onCommitted?: () => Promise<unknown>
  readonly onCandidatePreview?: (candidate: FirstFrameHistoryCandidate | undefined,
    url: string | undefined, ownsImagePreview?: boolean) => void
  /** The surrounding shooting workbench has read a saved requirement for this exact shot. */
  readonly requirementsReady?: boolean
  readonly onReturnToStoryboard?: () => void
  readonly referencePort?: AssetImageReferencePort | undefined
}) {
  const key = `qingmu:shooting-first-frame:${scope.projectId}:${scope.episodeId}:${scope.frameId}`
  const [preview, setPreview] = useState<Preview>(); const [attempt, setAttempt] = useState<Attempt>()
  const [references, setReferences] = useState<readonly AssetImageReference[]>([])
  const workingReferences = preview?.referenceMode === 'working'
  const referencesCurrent = !workingReferences || JSON.stringify(references) === JSON.stringify(preview.referenceBindings)
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
  const [needsLogin, setNeedsLogin] = useState(false)
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false); const [loginMessage, setLoginMessage] = useState('')
  const loginLock = useRef(false); const activeScope = useRef(key); activeScope.current = key
  useEffect(() => {
    activeScope.current = key
    setNeedsLogin(false); setPassword(''); setLoginMessage(''); setLoginBusy(false)
    return () => { activeScope.current = '' }
  }, [key])
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
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (cause instanceof FrameRequestError && cause.status === 401) setNeedsLogin(true)
          else setError(String(cause))
        }
      })
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
          setPreview(prior); setReferences(prior.referenceBindings ?? [])
          if (parsed.stage !== 'prepared') setRequestId(parsed.requestId); return
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
    if (!requirementsReady || lock.current || requestId || !preview || preview.blockers.length || busy
      || !referencesCurrent || (!workingReferences && review?.accepted !== true)) return
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
    const fresh = assertShootingPreview(await request('preview', { ...input,
      ...(references.length ? { reference_images: references } : {}), ...(rework ? { candidate_request_id: requestId } : {}) }), scope)
    const currentReview = assertFrameReview(await request(`review?${reviewQuery}`), scope.frameId)
    // Same inputs retain the same durable request ID; changed inputs make the
    // old preflight fail source validation. This never sends a generation POST.
    if (rework || fresh.referenceMode === 'working') {
      localStorage.setItem(key, JSON.stringify({ preview: fresh, requestId: `shooting-${fresh.preflightId}`, stage: 'prepared' }))
    }
    else localStorage.removeItem(key)
    setReview(currentReview); setRequestId(''); setAttempt(undefined); lock.current = false; setPreview(fresh)
  }
  const prepareReferences = async () => {
    if (!requirementsReady || !references.length || busy || lock.current || requestId) return
    lock.current = true; setBusy(true); setError('')
    try {
      const fresh = assertShootingPreview(await request('preview', { ...input, reference_images: references }), scope)
      localStorage.setItem(key, JSON.stringify({ preview: fresh, requestId: `shooting-${fresh.preflightId}`, stage: 'prepared' }))
      setPreview(fresh); setAttempt(undefined)
    } catch (cause) { setError(String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const confirm = async () => {
    if (!requirementsReady || !review || review.accepted || !review.preflight.technicalReady
      || confirmingLock.current || needsLogin || loginBusy) return
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
    } catch (cause) {
      if (cause instanceof FrameRequestError && cause.status === 401) { setNeedsLogin(true); setError('') }
      else setError(String(cause))
    }
    finally { confirmingLock.current = false; setConfirming(false) }
  }
  const login = async () => {
    if (loginLock.current || !username.trim() || !password) return
    loginLock.current = true; setLoginBusy(true); setLoginMessage('')
    try {
      const response = await fetch('/api/qingmu/editorial-handoff/human-session', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }),
      })
      if (activeScope.current !== key) return
      setPassword('')
      if (!response.ok) { setLoginMessage('登录未完成，请检查账户和密码后重试。'); return }
      const currentReview = assertFrameReview(await request(`review?${reviewQuery}`), scope.frameId)
      if (activeScope.current !== key) return
      setReview(currentReview); setNeedsLogin(false); setError('')
      if (!requestId) {
        const currentPreview = assertShootingPreview(await request('preview', { ...input,
          ...(references.length ? { reference_images: references } : {}) }), scope)
        if (activeScope.current !== key) return
        setPreview(currentPreview)
      }
      setLoginMessage('已恢复登录，请核对当前画面要求后确认本镜分镜。')
    } catch {
      if (activeScope.current === key) setLoginMessage('登录状态尚未核对完成，请稍后重试。')
    } finally {
      loginLock.current = false
      if (activeScope.current === key) { setLoginBusy(false); setPassword('') }
    }
  }
  if (!requirementsReady) return <section aria-label="首帧生成" className={css.generation}>
    <div className={css.preview}><div className={css.preparation} role="alert"><h3>先核对本镜分镜要求</h3><p>尚未读取到本镜已保存的首帧要求，因此没有开始预检或生成。</p>{requestId && <p role="status">正在读取已存在首帧任务；不会重新提交。</p>}</div></div>
    <div className={css.actions}>{onReturnToStoryboard && <button className={css.primary} type="button" onClick={onReturnToStoryboard}>返回分镜核对要求</button>}</div>
  </section>
  const blocked = submissionBlocker(attempt) ?? submissionBlocker(preview)
  return <section aria-label="首帧生成" className={css.generation} aria-busy={busy}>
    <div className={css.preview}>
      {attempt?.candidate && (workingReferences || !review || review.accepted) ? <figure>
        <img src={attempt.candidate.browserUrl} alt="镜头新首帧 · 待你定版" onLoad={() => setLoadedImage(imageKey)} onError={() => setLoadedImage(undefined)} />
        <figcaption>{attempt.candidate.isSelected ? '当前选用首帧' : '新首帧候选 · 待你审看，尚未采用'}</figcaption>
      </figure> : <div className={css.preparation}>
        {review && !review.accepted && !workingReferences ? <div aria-label="本镜分镜确认">
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
    {preview && <details className={css.log}><summary>首帧画面与参考素材</summary>
      {preview.references?.map((item, index) => <p key={index}>图{index + 1} · {item.kind} · {item.name}</p>)}
      {preview.compositionReference && <figure><img style={{ maxWidth: '100%' }} src={preview.compositionReference.imageUrl}
        alt={`${preview.compositionReference.sceneName}的本镜空间取景参考`} /><figcaption>这张布局图随请求提交，用于位置、透视和遮挡；生成后的实际画面仍需审看。</figcaption></figure>}
      <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.prompt}</pre>
    </details>}
    {referencePort && <details className={css.log}><summary>选择首帧参考图</summary>
      <p>明确选择本镜使用的人物、场景与道具图片，说明各图用途；生成新的工作候选。</p>
      <AssetImageReferences projectId={scope.projectId} references={references} port={referencePort}
        disabled={busy || Boolean(requestId)} allowRegions={false} onChange={setReferences} />
      <button type="button" disabled={busy || Boolean(requestId) || references.length === 0}
        onClick={() => { void prepareReferences() }}>用这些图片准备首帧</button>
      {workingReferences && !referencesCurrent && <p role="status">引用已修改，请重新准备后生成。</p>}
    </details>}
    {needsLogin && <form className={css.login} aria-label="恢复分镜确认登录" onSubmit={(event) => { event.preventDefault(); void login() }}>
      <p>确认分镜需要本人账户登录。登录后可以继续核对当前分镜。</p>
      <label>账户<input autoComplete="username" value={username} disabled={loginBusy}
        onChange={event => setUsername(event.target.value)} /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} disabled={loginBusy}
        onChange={event => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={loginBusy || !username.trim() || !password}>{loginBusy ? '正在登录…' : '登录本人账户'}</button>
    </form>}
    {loginMessage && <p role="status" className={css.error}>{loginMessage}</p>}
    <div className={css.actions}>
      {attempt?.canActivate === true && !busy && <button type="button" onClick={() => { void resume() }}>继续原首帧任务</button>}
      {attempt?.canRegenerate === true && !busy && <button type="button" onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(true); setError('')
        void prepareAgain(true).catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
      }}>重新生成首帧</button>}
      {review && !review.accepted && !workingReferences && <>
        {confirming ? <p role="status">正在保存你的本镜确认…</p>
          : review.preflight.technicalReady && !needsLogin && <button className={css.primary} type="button" onClick={() => { void confirm() }}>确认本镜分镜</button>}
      </>}
      {(workingReferences || review?.accepted === true) && requestId && attempt?.task === null && !busy && !confirming &&
      <button type="button" onClick={() => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        void prepareAgain().catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
      }}>重新检查本镜生成条件</button>}
      {!attempt?.candidate && !blocked && !requestId && !busy && preview?.blockers.length === 0
        && referencesCurrent && (workingReferences || review?.accepted === true)
        && <button className={css.primary} type="button" onClick={() => { void submit() }}>生成这张首帧（仅一次）</button>}
    </div>
    {error && <p role="alert" className={css.error}>{error.includes('digest_mismatch') ? '分镜在确认前已发生变化，本次没有确认。请刷新，核对新的画面要求。'
      : error.includes('执行器尚未启动') ? '原任务已保存，但执行器尚未启动。请查看原任务结果，不要重复生成。'
        : error.includes('first_frame_reference_not_ready') ? '尚未定版所需参考素材。可以展开“选择首帧参考图”，明确选择本项目图片并准备工作候选。'
          : '本次操作未确认完成。请保留当前候选，查看原任务结果；不要重复提交。详细原因已放入开发日志。'}</p>}
    <details className={css.log}><summary>开发日志</summary>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ storyboardReview: review, preflightId: preview?.preflightId, payloadHash: preview?.payloadHash, estimatedCny: preview?.estimatedCny, blockers: preview?.blockers, submissionBlocker: blocked?.detail, requestId, attempt, error }, null, 2)}</pre>
    </details>
  </section>
}
