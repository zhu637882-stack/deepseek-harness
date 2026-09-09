/** Queue one quoted draft, then explicitly hand a returned candidate to shooting review. */
import { useEffect, useRef, useState } from 'react'
import type {
  QueueReferenceVideoRequest,
  ReferenceVideoCandidateRegistration,
  ReferenceVideoCandidateRegistrationRequest,
  ReferenceVideoQuoteResponse,
  ReferenceVideoRun,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ReferenceVideoWorkspace.module.css'

const statuses: Record<string, string> = {
  Reserved: '等待排队', DispatchPending: '等待生成', Submitted: '请求已发出', Running: '正在生成',
  Ingesting: '正在接收视频', QualityPending: '正在检查视频', Succeeded: '候选视频待审',
  Failed: '任务失败', Cancelled: '任务已取消', Quarantined: '提交结果待核实',
}

interface Props {
  readonly projectId: string
  readonly frameId: string
  readonly quote?: ReferenceVideoQuoteResponse | undefined
  readonly onOpenShooting?: ((frameId: string) => void) | undefined
  readonly port: Pick<QingmuYimengPort,
    'referenceVideoRuns' | 'queueReferenceVideo'> & Partial<Pick<QingmuYimengPort,
    'readReferenceVideoCandidateRegistration' | 'registerReferenceVideoCandidateForReview'>>
}

interface CandidateRegistrationProps {
  readonly projectId: string
  readonly frameId: string
  readonly run: ReferenceVideoRun
  readonly candidate: ReferenceVideoRun['candidates'][number]
  readonly onOpenShooting?: ((frameId: string) => void) | undefined
  readonly port: Pick<QingmuYimengPort,
    'readReferenceVideoCandidateRegistration' | 'registerReferenceVideoCandidateForReview'>
}

type CandidateRegistrationPort = CandidateRegistrationProps['port']

type RegistrationStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'registering' }
  | { readonly kind: 'registered'; readonly takeId: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'failed' }

function isMatchingRegistration(
  result: unknown,
  request: ReferenceVideoCandidateRegistrationRequest,
): result is ReferenceVideoCandidateRegistration {
  if (result === null || typeof result !== 'object') return false
  const receipt = result as Record<string, unknown>
  return receipt.schema === 'jason.reference-video-review-registration.v1'
    && receipt.projectId === request.projectId
    && receipt.frameId === request.frameId
    && receipt.runId === request.runId
    && receipt.assetId === request.assetId
    && receipt.assetSha256 === request.expectedAssetSha256
    && receipt.providerCalls === 0
    && receipt.selectionChanged === false
    && receipt.formalApprovalChanged === false
}

function hasCandidateRegistrationPort(
  port: Props['port'],
): port is Props['port'] & CandidateRegistrationPort {
  return port.readReferenceVideoCandidateRegistration !== undefined
    && port.registerReferenceVideoCandidateForReview !== undefined
}

/** One explicit candidate-to-review registration. It never selects a Take. */
function CandidateReviewRegistration({ projectId, frameId, run, candidate, port,
  onOpenShooting }: CandidateRegistrationProps) {
  const request: ReferenceVideoCandidateRegistrationRequest = {
    projectId,
    frameId,
    runId: run.runId,
    assetId: candidate.assetId,
    expectedAssetSha256: candidate.assetSha256,
  }
  const [status, setStatus] = useState<RegistrationStatus>({ kind: 'checking' })
  const mounted = useRef(true)
  const readAbort = useRef<AbortController>()
  const writeAbort = useRef<AbortController>()
  const readEpoch = useRef(0)
  const registering = useRef(false)

  const readStatus = async (): Promise<ReferenceVideoCandidateRegistration | undefined> => {
    readAbort.current?.abort()
    const controller = new AbortController()
    const readId = readEpoch.current + 1
    readEpoch.current = readId
    readAbort.current = controller
    setStatus({ kind: 'checking' })
    try {
      const result = await port.readReferenceVideoCandidateRegistration(request, controller.signal)
      if (!mounted.current || controller.signal.aborted || readId !== readEpoch.current) return undefined
      if (!isMatchingRegistration(result, request)) {
        setStatus({ kind: 'failed' })
        return undefined
      }
      setStatus(result.takeId === null ? { kind: 'unregistered' } : { kind: 'registered', takeId: result.takeId })
      return result
    } catch {
      if (!mounted.current || controller.signal.aborted || readId !== readEpoch.current) return undefined
      setStatus({ kind: 'failed' })
      return undefined
    }
  }

  useEffect(() => {
    mounted.current = true
    void readStatus()
    return () => {
      mounted.current = false
      readEpoch.current += 1
      readAbort.current?.abort()
      writeAbort.current?.abort()
    }
    // Candidate identity is encoded in this component's React key.
  }, [])

  const register = async () => {
    if (registering.current) return
    registering.current = true
    try {
      const current = await readStatus()
      if (current === undefined || current.takeId !== null) return
      const controller = new AbortController()
      writeAbort.current = controller
      setStatus({ kind: 'registering' })
      const result = await port.registerReferenceVideoCandidateForReview(request, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (!isMatchingRegistration(result, request) || result.takeId === null) {
        setStatus({ kind: 'unknown' })
        return
      }
      setStatus({ kind: 'registered', takeId: result.takeId })
    } catch {
      if (mounted.current && !writeAbort.current?.signal.aborted) setStatus({ kind: 'unknown' })
    } finally {
      registering.current = false
    }
  }

  if (status.kind === 'registered') return <div className={css.candidateRegistration}>
    <p role="status">已加入本镜候选审看。尚未采用，请在拍摄与审看中比较后决定。</p>
    {onOpenShooting && <button type="button" className={css.primaryAction}
      onClick={() => { onOpenShooting(frameId) }}>打开拍摄与审看</button>}
  </div>
  if (status.kind === 'checking') return <p className={css.reviewNote} role="status">正在读取候选审看状态…</p>
  if (status.kind === 'registering') return <p className={css.reviewNote} role="status">正在加入本镜候选审看…</p>
  if (status.kind === 'unknown') return <div className={css.candidateRegistration}>
    <p role="alert">登记结果尚未确认。请先读取登记状态；不会自动再次登记。</p>
    <button type="button" onClick={() => { void readStatus() }}>读取登记状态</button>
  </div>
  if (status.kind === 'failed') return <div className={css.candidateRegistration}>
    <p role="alert">候选审看状态读取失败。请重试读取，不会自动登记。</p>
    <button type="button" onClick={() => { void readStatus() }}>重试读取登记状态</button>
  </div>
  return <div className={css.candidateRegistration}>
    <button type="button" onClick={() => { void register() }}>加入本镜候选审看</button>
    <p className={css.reviewNote}>加入后仍需你在拍摄与审看中比较、选择；这里不会采用视频。</p>
  </div>
}

/** Retain uncertain paid submissions across reloads and require a visible exact-price action.
 * @param props - Shot, current saved quote and authenticated run ports.
 * @returns Generation control and recent candidate players.
 */
export function ReferenceVideoRuns({ projectId, frameId, quote, port, onOpenShooting }: Props) {
  const key = `qingmu.reference-submit:${projectId}:${frameId}`
  const [runs, setRuns] = useState<readonly ReferenceVideoRun[]>([])
  const [pending, setPending] = useState<QueueReferenceVideoRequest>()
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [recoveryError, setRecoveryError] = useState(false)
  const active = useRef<AbortController | undefined>(undefined)
  const submitting = useRef(false)
  const pendingRef = useRef<QueueReferenceVideoRequest | undefined>(undefined)
  const mounted = useRef(true)
  const remember = (command: QueueReferenceVideoRequest | undefined) => {
    // Failure to persist must stop a new paid command before its HTTP request.
    if (command) sessionStorage.setItem(key, JSON.stringify(command))
    else sessionStorage.removeItem(key)
    pendingRef.current = command
    setPending(command)
  }
  const refresh = async () => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    try {
      const result = await port.referenceVideoRuns({ projectId, frameId }, controller.signal)
      if (controller.signal.aborted) return
      setRuns(result.items)
      setLoaded(true)
      const command = pendingRef.current
      if (command && result.items.some(run => run.runId === `refvideo_${command.requestId}`
        && run.quoteSha256 === command.quoteSha256 && run.draftRevision === command.expectedRevision
        && run.authorizationCapCny === command.authorizationCapCny)) remember(undefined)
      setMessage('')
    } catch {
      if (!controller.signal.aborted) setMessage('任务状态读取失败。请刷新状态；生成请求不会自动重发。')
    }
  }
  useEffect(() => {
    mounted.current = true
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const stored = JSON.parse(raw) as Record<string, unknown>
        if (stored.projectId !== projectId || stored.frameId !== frameId || stored.paidConfirmed !== true
          || typeof stored.requestId !== 'string' || typeof stored.authorizationCapCny !== 'string'
          || !/^[A-Za-z0-9_-]{16,64}$/u.test(stored.requestId) || !/^[0-9]{1,3}\.[0-9]{6}$/u.test(stored.authorizationCapCny)) {
          throw new Error('invalid receipt')
        }
        const command = stored as unknown as QueueReferenceVideoRequest
        pendingRef.current = command
        setPending(command)
      }
    } catch {
      setRecoveryError(true)
    }
    void refresh()
    return () => {
      mounted.current = false
      active.current?.abort()
    }
    // The parent mounts this workspace by shot key; the port has stable identity.
  }, [key, port])
  const submit = async () => {
    if (submitting.current || recoveryError || !loaded || (!quote && !pending)) return
    submitting.current = true
    setBusy(true)
    setMessage('')
    try {
      let command = pending
      if (!command) {
        if (!quote) return
        command = {
          projectId,
          frameId,
          requestId: crypto.randomUUID(),
          expectedRevision: quote.draftRevision,
          expectedRequestSha256: quote.draftRequestSha256,
          quoteSha256: quote.quoteSha256,
          authorizationCapCny: quote.cost.estimatedCny,
          paidConfirmed: true,
        }
      }
      remember(command)
      const run = await port.queueReferenceVideo(command)
      if (!mounted.current) return
      setRuns(previous => [run, ...previous.filter(item => item.runId !== run.runId)].slice(0, 20))
      remember(undefined)
      setMessage('已登记这次生成，可刷新查看进度。')
    } catch {
      if (mounted.current) setMessage('提交结果尚未确认。先刷新状态；再次确认会使用同一个请求编号。')
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const inflight = runs.some(run => !['Succeeded', 'Failed', 'Cancelled'].includes(run.kernelStatus)
    || run.publicStatus === 'quarantined')
  const amount = pending?.authorizationCapCny ?? quote?.cost.estimatedCny
  return <section className={css.deliveryDesk} aria-label="生成与候选视频">
    <div className={css.deliveryHeading}>
      <div><p className={css.kicker}>DELIVERY DESK</p><h4>生成与候选视频</h4></div>
      <span className={css.deliveryHint}>{runs.length ? `${runs.length} 个近期任务` : '候选将回到这里'}</span>
    </div>
    <div className={css.deliveryActions}>
      <button className={css.primaryAction} type="button"
        disabled={busy || recoveryError || !loaded || (!pending && (!quote || inflight))}
        onClick={() => { void submit() }}>
        {busy ? '确认提交中…' : pending ? `确认上次提交 · 上限 ¥${Number(amount).toFixed(2)}`
          : `生成 1 个视频${amount ? ` · 上限 ¥${Number(amount).toFixed(2)}` : ''}`}
      </button>
      <button type="button" disabled={busy} onClick={() => { void refresh() }}>刷新任务状态</button>
    </div>
    <p className={css.note}>阿里直连，使用阿里账户额度，每次生成 1 个候选。候选供你审看，当前选用的视频不会被替换。</p>
    {recoveryError && <p role="alert">上次提交记录无法读取。请先在任务中心核对提交结果，核对前暂停新增生成。</p>}
    {pending && <p>上次提交：草稿版本 {pending.expectedRevision}。核对完成前保留这次请求。</p>}
    {message && <p aria-live="polite">{message}</p>}
    {runs.map(run => <article key={run.runId} className={css.candidate}>
      <div className={css.candidateHeading}>
        <div><p className={css.kicker}>CANDIDATE · DRAFT V{run.draftRevision}</p>
          <h4>草稿版本 {run.draftRevision} · {run.publicStatus === 'quarantined'
            ? '提交结果待核实' : statuses[run.kernelStatus] ?? '状态待核实'}</h4></div>
        <span>上限 ¥{Number(run.authorizationCapCny).toFixed(2)}</span>
      </div>
      <p className={css.taskMeta}>任务 {run.taskId}</p>
      {run.errorCode && <p>任务需要处理：{run.errorCode}。不会自动重新生成。</p>}
      {run.candidates.map(candidate => <div key={candidate.assetId}>
        {candidate.browserUrl ? <video src={candidate.browserUrl} controls preload="none"
          aria-label={`草稿版本 ${run.draftRevision} 候选视频`} />
          : <p>视频地址暂不可用，请刷新状态。</p>}
        <p className={css.reviewNote}>请审看人物、服装、场景与声音。确认采用仍由你决定。</p>
        {run.kernelStatus === 'Succeeded' && run.publicStatus !== 'quarantined'
          && hasCandidateRegistrationPort(port) && <CandidateReviewRegistration
          key={JSON.stringify([projectId, frameId, run.runId, candidate.assetId, candidate.assetSha256])}
          projectId={projectId} frameId={frameId} run={run} candidate={candidate}
          port={port} onOpenShooting={onOpenShooting} />}
      </div>)}
    </article>)}
  </section>
}
