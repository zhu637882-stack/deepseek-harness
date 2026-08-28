/* oxlint-disable typescript/no-unnecessary-condition -- RPC DTOs remain untrusted at the browser boundary. */
import { useEffect, useId, useRef, useState } from 'react'
import type {
  ImagoTakeApprovalLifecycleAction,
  ImagoTakeApprovalLifecycleMethodResponse,
  ImagoTakeApprovalLifecycleState,
  QingmuYimengPort,
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTransitionTakeApprovalLifecycleRequest,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearTakeApprovalLifecycleRecoveryMarker,
  createTakeApprovalLifecycleIdempotencyKey,
  hasTakeApprovalLifecycleRecoveryMarker,
  pythonStripTakeApprovalLifecycleText,
  readTakeApprovalLifecycleRecoveryMarker,
  writeTakeApprovalLifecycleRecoveryMarker,
  type TakeApprovalLifecycleRecoveryMarker,
} from './take-approval-lifecycle-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

export type TakeApprovalLifecyclePort = Pick<QingmuYimengPort,
  'takeApprovalLifecycle' | 'takeApprovalLifecycleMethod'
  | 'transitionTakeApprovalLifecycle' | 'recoverTakeApprovalLifecycleTransition'>

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly refresh: number
  readonly port: TakeApprovalLifecyclePort
  readonly t: (key: QingmuCockpitKey) => string
}

interface Loaded {
  readonly feed: YimengTakeApprovalLifecycleFeedResponse
  readonly method: ImagoTakeApprovalLifecycleMethodResponse
}

type Notice = { readonly key: QingmuCockpitKey; readonly error: boolean }
const SHA256 = /^[0-9a-f]{64}$/u

const ACTION_KEYS: Readonly<Record<ImagoTakeApprovalLifecycleAction, QingmuCockpitKey>> = {
  APPROVE: 'takeApprovalLifecycleApprove',
  INVALIDATE: 'takeApprovalLifecycleInvalidate',
  REQUEST_REWORK: 'takeApprovalLifecycleRequestRework',
  RESUBMIT: 'takeApprovalLifecycleResubmit',
}

const STATE_KEYS: Readonly<Record<ImagoTakeApprovalLifecycleState, QingmuCockpitKey>> = {
  READY_FOR_APPROVAL: 'takeApprovalLifecycleStateReadyForApproval',
  APPROVED: 'takeApprovalLifecycleStateApproved',
  APPROVAL_INVALIDATED_PENDING_EVENT: 'takeApprovalLifecycleStateInvalidationPending',
  REWORK_REQUIRED: 'takeApprovalLifecycleStateReworkRequired',
  REWORK_RECORDED: 'takeApprovalLifecycleStateReworkRecorded',
  READY_TO_RESUBMIT: 'takeApprovalLifecycleStateReadyToResubmit',
  IN_REVIEW: 'takeApprovalLifecycleStateInReview',
  METHOD_REVIEW_REQUIRED: 'takeApprovalLifecycleStateMethodReviewRequired',
  AWAITING_REVIEW: 'takeApprovalLifecycleStateAwaitingReview',
}

function loadedBindingsMatch(
  value: Loaded,
  scope: Pick<Props, 'projectId' | 'episodeId' | 'frameId'>,
): boolean {
  const { feed, method } = value
  const subject = feed.source.currentTake.takeSubject
  const projection = method.projection
  return feed.schema === 'jason.qingmu-take-approval-lifecycle-feed.v1'
    && method.schema === 'qingmu.imago-take-approval-lifecycle-method-adapter-result.v1'
    && feed.projectId === scope.projectId && feed.episodeId === scope.episodeId
    && feed.frameId === scope.frameId && feed.source.projectId === scope.projectId
    && feed.source.episodeId === scope.episodeId && feed.source.frameId === scope.frameId
    && subject.projectId === scope.projectId && subject.episodeId === scope.episodeId
    && subject.frameId === scope.frameId && subject.selectionStatus === 'Selected'
    && projection.subject.projectId === scope.projectId
    && projection.subject.episodeId === scope.episodeId
    && projection.subject.frameId === scope.frameId
    && projection.subject.takeId === subject.takeId
    && projection.subjectSnapshotSha256 === feed.source.currentTake.takeSubjectSha256
    && projection.sourceSnapshotSha256 === feed.sourceSnapshotSha256
    && method.methodAttestation.sourceSnapshotSha256 === feed.sourceSnapshotSha256
    && method.methodAttestation.methodProjectionSha256 === method.projectionSha256
    && SHA256.test(method.projectionSha256)
}

function resultMatches(
  result: YimengTakeApprovalLifecycleResult,
  intent: TakeApprovalLifecycleRecoveryMarker,
): boolean {
  return result.schema === 'jason.qingmu-take-approval-lifecycle-result.v1'
    && result.transition.action === intent.action && result.transition.takeId === intent.takeId
    && result.transition.reason === intent.reason
    && result.sourceSnapshotSha256 === intent.expectedSourceSnapshotSha256
    && result.authoritativeSourceSnapshotSha256 !== result.sourceSnapshotSha256
    && SHA256.test(result.authoritativeSourceSnapshotSha256)
    && SHA256.test(result.transition.methodProjectionSha256)
    && result.changed
    && result.formalApprovalChanged === (intent.action === 'APPROVE')
    && result.approvalInvalidated === (intent.action === 'INVALIDATE')
    && result.reworkRequested === (intent.action === 'REQUEST_REWORK')
    && result.resubmitted === (intent.action === 'RESUBMIT')
    && !result.selectionChanged && !result.technicalPassChanged
    && !result.reviewDecisionChanged && !result.reworkExecuted
    && result.providerCalls === 0 && !result.budgetMutation
    && !result.episodeVerificationChanged && !result.humanSignoffInferred
    && !result.evidenceLedgerMutation
}

function recoveryMatches(
  recovery: YimengTakeApprovalLifecycleRecovery,
  intent: TakeApprovalLifecycleRecoveryMarker,
): boolean {
  return recovery.schema === 'jason.qingmu-take-approval-lifecycle-recovery.v1'
    && recovery.projectId === intent.projectId && recovery.episodeId === intent.episodeId
    && recovery.frameId === intent.frameId && recovery.takeId === intent.takeId
    && recovery.expectedSourceSnapshotSha256 === intent.expectedSourceSnapshotSha256
    && recovery.idempotencyKey === intent.idempotencyKey
    && ((recovery.status === 'not_found' && recovery.result === null)
      || (recovery.status === 'committed' && recovery.result !== null
        && resultMatches(recovery.result, intent)))
}

function browserIntent(
  marker: TakeApprovalLifecycleRecoveryMarker,
): YimengTransitionTakeApprovalLifecycleRequest {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    frameId: marker.frameId,
    expectedSourceSnapshotSha256: marker.expectedSourceSnapshotSha256,
    takeId: marker.takeId,
    action: marker.action,
    reason: marker.reason,
    idempotencyKey: marker.idempotencyKey,
  }
}

function capability(
  action: ImagoTakeApprovalLifecycleAction,
  feed: YimengTakeApprovalLifecycleFeedResponse,
): boolean {
  if (action === 'APPROVE') return feed.capabilities.canApprove
  if (action === 'INVALIDATE') return feed.capabilities.canRecordInvalidation
  if (action === 'REQUEST_REWORK') return feed.capabilities.canRequestRework
  return feed.capabilities.canResubmit
}

/** E7-4 current-rule lifecycle control; it records transitions and never executes rework. */
export function TakeApprovalLifecyclePanel({ projectId, episodeId, frameId, refresh, port, t }: Props) {
  const scope = { projectId, episodeId, frameId }
  const reasonId = useId()
  const [loaded, setLoaded] = useState<Loaded>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const busyRef = useRef(false)
  const recoveryRef = useRef<string>()
  const lifeControllerRef = useRef(new AbortController())

  useEffect(() => () => { lifeControllerRef.current.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      port.takeApprovalLifecycle(scope, controller.signal),
      port.takeApprovalLifecycleMethod(scope, controller.signal),
    ]).then(([feed, method]) => {
      if (controller.signal.aborted) return
      const value = { feed, method }
      if (!loadedBindingsMatch(value, scope)) throw new Error('approval lifecycle binding mismatch')
      setLoaded(value)
      setLoadFailed(false)
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoaded(undefined)
        setLoadFailed(true)
      }
    })
    return () => { controller.abort() }
  }, [episodeId, frameId, port, projectId, refresh, reload])

  function committed(intent: TakeApprovalLifecycleRecoveryMarker) {
    if (!clearTakeApprovalLifecycleRecoveryMarker(intent)) {
      setNotice({ key: 'takeApprovalLifecycleRecoveryMismatch', error: true })
      return
    }
    setNotice({ key: 'takeApprovalLifecycleSubmitted', error: false })
    setReason('')
    setTouched(false)
    setReload(value => value + 1)
  }

  async function recover(intent: TakeApprovalLifecycleRecoveryMarker, signal: AbortSignal): Promise<void> {
    try {
      const recovery = await port.recoverTakeApprovalLifecycleTransition(browserIntent(intent), signal)
      if (signal.aborted) return
      if (!recoveryMatches(recovery, intent)) {
        setNotice({ key: 'takeApprovalLifecycleRecoveryMismatch', error: true })
      } else if (recovery.status === 'committed' && recovery.result !== null) {
        committed(intent)
      } else {
        setNotice({ key: 'takeApprovalLifecycleUnknown', error: true })
      }
    } catch {
      if (!signal.aborted) setNotice({ key: 'takeApprovalLifecycleUnknown', error: true })
    }
  }

  useEffect(() => {
    const intent = readTakeApprovalLifecycleRecoveryMarker(scope)
    if (intent === undefined) {
      if (hasTakeApprovalLifecycleRecoveryMarker(scope)) {
        setNotice({ key: 'takeApprovalLifecycleRecoveryMismatch', error: true })
      }
      return
    }
    if (recoveryRef.current === intent.idempotencyKey) return
    recoveryRef.current = intent.idempotencyKey
    busyRef.current = true
    setBusy(true)
    const controller = lifeControllerRef.current
    void recover(intent, controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        busyRef.current = false
        setBusy(false)
      }
    })
  }, [episodeId, frameId, port, projectId])

  if (loaded === undefined) {
    return <section className={css.approvalLifecycle} aria-label={t('takeApprovalLifecycleTitle')}>
      <p role={loadFailed ? 'alert' : 'status'} className={loadFailed ? card.warning : undefined}>
        {t(loadFailed ? 'takeApprovalLifecycleLoadError' : 'takeApprovalLifecycleLoading')}
      </p>
    </section>
  }

  const { feed, method } = loaded
  const transition = method.projection.transition
  const legalActions = transition.legalActions.filter(action => capability(action, feed))
  const normalizedReason = pythonStripTakeApprovalLifecycleText(reason)
  const reasonInvalid = touched && normalizedReason === ''
  const locked = hasTakeApprovalLifecycleRecoveryMarker(scope)
  const decision = feed.source.currentDecision
  const assessment = feed.source.currentAssessment

  async function submit(action: ImagoTakeApprovalLifecycleAction): Promise<void> {
    setTouched(true)
    if (busyRef.current || locked || normalizedReason === ''
      || !transition.legalActions.includes(action) || !capability(action, feed)) return
    busyRef.current = true
    setBusy(true)
    setNotice(undefined)
    const intent: TakeApprovalLifecycleRecoveryMarker = {
      schema: 'qingmu.take-approval-lifecycle-recovery-marker.v1',
      ...scope,
      expectedSourceSnapshotSha256: feed.sourceSnapshotSha256,
      takeId: feed.source.currentTake.takeSubject.takeId,
      action,
      reason: normalizedReason,
      idempotencyKey: createTakeApprovalLifecycleIdempotencyKey(),
    }
    try {
      if (!writeTakeApprovalLifecycleRecoveryMarker(intent)) {
        setNotice({ key: 'takeApprovalLifecycleStorageFailed', error: true })
        return
      }
      try {
        const result = await port.transitionTakeApprovalLifecycle(
          browserIntent(intent),
          lifeControllerRef.current.signal,
        )
        if (lifeControllerRef.current.signal.aborted) return
        if (!resultMatches(result, intent)
          || result.transition.methodProjectionSha256 !== method.projectionSha256
          || result.methodReviewRequiredAfterRequest !== transition.methodReviewRequiredAfterRequest
          || result.boundedFindingRouteRequired !== transition.boundedFindingRouteRequired) {
          setNotice({ key: 'takeApprovalLifecycleRecoveryMismatch', error: true })
          return
        }
        committed(intent)
      } catch {
        if (!lifeControllerRef.current.signal.aborted) {
          await recover(intent, lifeControllerRef.current.signal)
        }
      }
    } finally {
      busyRef.current = false
      if (!lifeControllerRef.current.signal.aborted) setBusy(false)
    }
  }

  return <section className={css.approvalLifecycle} aria-label={t('takeApprovalLifecycleTitle')}>
    <header><div><h4>{t('takeApprovalLifecycleTitle')}</h4>
      <p>{t('takeApprovalLifecycleBoundary')}</p></div>
    <strong>{t(STATE_KEYS[transition.state])}</strong>
    </header>
    <p className={css.acceptanceWarning}>{t('takeApprovalLifecycleNotSignoff')}</p>
    <div className={css.lifecycleSnapshot}>
      <div><span>{t('takeApprovalLifecycleSelectedTake')}</span>
        <strong>{feed.source.currentTake.takeSubject.takeId}</strong>
        <small>v{feed.source.currentTake.takeSubject.versionOrdinal}</small></div>
      <div><span>{t('takeApprovalLifecycleDecision')}</span>
        <strong>{decision?.decision ?? t('takeApprovalLifecycleNone')}</strong>
        {decision !== null && <small>{decision.actorId}</small>}</div>
      <div><span>{t('takeApprovalLifecycleTechnicalQc')}</span>
        <strong>{assessment === null
          ? t('takeApprovalLifecycleNone')
          : t(assessment.technicalPass ? 'takeTechnicalQcPass' : 'takeTechnicalQcNotPass')}</strong>
        {assessment !== null && <small>{assessment.assessmentId}</small>}</div>
      <div><span>{t('takeApprovalLifecycleSameClassCount')}</span>
        <strong>{transition.sameClassReworkCount}</strong>
        <small>{t('takeApprovalLifecycleAfterRequest')}: {transition.sameClassCountAfterRequest}</small></div>
    </div>
    {(transition.currentApprovalId !== null || transition.staleApprovalId !== null) &&
      <dl className={css.lifecycleBindings}>
        {transition.currentApprovalId !== null && <div><dt>{t('takeApprovalLifecycleCurrentApproval')}</dt>
          <dd><code>{transition.currentApprovalId}</code></dd></div>}
        {transition.staleApprovalId !== null && <div><dt>{t('takeApprovalLifecycleStaleApproval')}</dt>
          <dd><code>{transition.staleApprovalId}</code></dd></div>}
      </dl>}
    {transition.invalidationReasons.length > 0 && <p className={card.warning}>
      {t('takeApprovalLifecycleInvalidationReasons')}: {transition.invalidationReasons.join(', ')}
    </p>}
    {transition.reworkClassCodes.length > 0 && <p>
      {t('takeApprovalLifecycleDefectClasses')}: {transition.reworkClassCodes.join(', ')}
    </p>}
    {transition.boundedFindingRouteRequired && <p className={css.lifecycleRouteNotice}>
      {t('takeApprovalLifecycleBoundedRoute')}
    </p>}
    {transition.methodReviewRequired && <p role="alert" className={card.warning}>
      {t('takeApprovalLifecycleMethodReviewRequired')}
    </p>}
    {!transition.methodReviewRequired && transition.methodReviewRequiredAfterRequest
      && transition.legalActions.includes('REQUEST_REWORK') && <p className={card.warning}>
      {t('takeApprovalLifecycleMethodReviewAfterRequest')}
    </p>}
    {legalActions.length === 0 && <p>{t('takeApprovalLifecycleNoLegalActions')}</p>}
    <form className={css.lifecycleForm} aria-label={t('takeApprovalLifecycleForm')}
      onSubmit={(event) => { event.preventDefault() }}>
      <label htmlFor={reasonId}>{t('takeApprovalLifecycleReason')}</label>
      <textarea id={reasonId} value={reason} maxLength={8_000} aria-invalid={reasonInvalid}
        onChange={(event) => { setReason(event.currentTarget.value) }} />
      {reasonInvalid && <p role="alert" className={card.warning}>
        {t('takeApprovalLifecycleReasonRequired')}
      </p>}
      <div className={css.lifecycleActions}>
        {legalActions.map(action => <button key={action} type="button"
          disabled={busy || locked}
          data-lifecycle-action={action}
          onClick={() => { void submit(action) }}>{t(ACTION_KEYS[action])}</button>)}
      </div>
      {busy && <p role="status" aria-live="polite">{t('takeApprovalLifecycleSubmitting')}</p>}
      {notice !== undefined && <p role={notice.error ? 'alert' : 'status'} aria-live="polite"
        className={notice.error ? card.warning : css.notice}>{t(notice.key)}</p>}
    </form>
    <div className={css.lifecycleHistory}><strong>{t('takeApprovalLifecycleHistory')}</strong>
      {feed.source.lifecycleHistory.length === 0 ? <p>{t('takeApprovalLifecycleEmpty')}</p>
        : <ol>{feed.source.lifecycleHistory.map(item => <li key={item.transitionId}>
          <span><strong>#{item.revision}</strong> · {t(ACTION_KEYS[item.action])}</span>
          <span>{item.reason}</span>
          <small>{item.actorRole} · {item.actorId} · {item.recordedAt}</small>
          <small>{item.transitionId}</small>
        </li>)}</ol>}
    </div>
  </section>
}
