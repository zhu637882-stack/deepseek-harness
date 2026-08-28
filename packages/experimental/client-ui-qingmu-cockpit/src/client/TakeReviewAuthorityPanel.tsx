/* oxlint-disable typescript/no-unnecessary-condition -- Review RPCs and sessionStorage are trust boundaries. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Keep zero-impact authority checks explicit. */
import { useEffect, useId, useRef, useState } from 'react'
import type {
  QingmuYimengPort,
  YimengCreateTakeHumanDecisionRequest,
  YimengCreateTakeReviewRecommendationRequest,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengTakeReviewAction,
  YimengTakeReviewAuthorityFeedResponse,
  YimengTakeReviewRecommendationRecovery,
  YimengTakeReviewRecommendationResult,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearTakeHumanDecisionRecoveryMarker,
  clearTakeReviewRecommendationRecoveryMarker,
  createTakeHumanDecisionIdempotencyKey,
  createTakeReviewRecommendationIdempotencyKey,
  hasTakeHumanDecisionRecoveryMarker,
  hasTakeReviewRecommendationRecoveryMarker,
  pythonStripTakeReviewText,
  readTakeHumanDecisionRecoveryMarker,
  readTakeReviewRecommendationRecoveryMarker,
  writeTakeHumanDecisionRecoveryMarker,
  writeTakeReviewRecommendationRecoveryMarker,
  type TakeHumanDecisionRecoveryMarker,
  type TakeReviewRecommendationRecoveryMarker,
} from './take-review-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

export type TakeReviewAuthorityPort = Pick<QingmuYimengPort,
  'takeReviewAuthority'
  | 'createTakeReviewRecommendation' | 'recoverTakeReviewRecommendation'
  | 'createTakeHumanDecision' | 'recoverTakeHumanDecision'>

interface TakeReviewAuthorityPanelProps {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly preferredTakeId: string
  readonly refresh: number
  readonly port: TakeReviewAuthorityPort
  readonly t: (key: QingmuCockpitKey) => string
}

interface Notice {
  readonly key: QingmuCockpitKey
  readonly error: boolean
}

const ACTION_KEYS: Readonly<Record<YimengTakeReviewAction, QingmuCockpitKey>> = {
  approve: 'takeReviewActionApprove',
  reject: 'takeReviewActionReject',
  request_changes: 'takeReviewActionRequestChanges',
}

function zeroImpact(result: YimengTakeReviewRecommendationResult | YimengTakeHumanDecisionResult): boolean {
  return result.changed === false && result.selectionChanged === false
    && result.technicalPassChanged === false && result.formalApprovalChanged === false
    && result.episodeVerificationChanged === false && result.humanSignoffInferred === false
    && result.providerCalls === 0 && result.budgetMutation === false
}

function recommendationMatches(
  result: YimengTakeReviewRecommendationResult,
  input: YimengCreateTakeReviewRecommendationRequest,
): boolean {
  return result.schema === 'jason.qingmu-take-review-recommendation-result.v1'
    && result.decisionRecorded === false && result.recommendationOnly === true && zeroImpact(result)
    && result.recommendation.takeSubject.projectId === input.projectId
    && result.recommendation.takeSubject.episodeId === input.episodeId
    && result.recommendation.takeSubject.frameId === input.frameId
    && result.recommendation.takeSubject.takeId === input.takeId
    && result.recommendation.takeSubjectSha256 === input.expectedTakeSubjectSha256
    && result.recommendation.actorRole === 'reviewer'
    && result.recommendation.recommendation === input.recommendation
    && result.recommendation.reason === input.reason
}

function decisionMatches(
  result: YimengTakeHumanDecisionResult,
  input: YimengCreateTakeHumanDecisionRequest,
): boolean {
  return result.schema === 'jason.qingmu-take-human-decision-result.v1'
    && result.decisionRecorded === true && result.recommendationOnly === false && zeroImpact(result)
    && result.decision.subjectType === 'shot_take' && result.decision.subjectId === input.takeId
    && result.decision.takeSubject.projectId === input.projectId
    && result.decision.takeSubject.episodeId === input.episodeId
    && result.decision.takeSubject.frameId === input.frameId
    && result.decision.takeSubject.takeId === input.takeId
    && result.decision.takeSubjectSha256 === input.expectedTakeSubjectSha256
    && result.decision.subjectSha256 === input.expectedTakeSubjectSha256
    && result.decision.actorRole === 'approver' && result.decision.decision === input.decision
    && result.decision.reason === input.reason
    && !result.decision.participantNaturalPersonIds.includes(result.decision.actorNaturalPersonId)
}

function recommendationRequest(
  marker: TakeReviewRecommendationRecoveryMarker,
): YimengCreateTakeReviewRecommendationRequest {
  const { schema: _schema, ...request } = marker
  return request
}

function decisionRequest(marker: TakeHumanDecisionRecoveryMarker): YimengCreateTakeHumanDecisionRequest {
  const { schema: _schema, ...request } = marker
  return request
}

function recommendationRecoveryMatches(
  recovery: YimengTakeReviewRecommendationRecovery,
  input: YimengCreateTakeReviewRecommendationRequest,
): boolean {
  return recovery.schema === 'jason.qingmu-take-review-command-recovery.v1'
    && recovery.commandType === 'qingmu.take_review.recommendation.record.v1'
    && recovery.projectId === input.projectId && recovery.episodeId === input.episodeId
    && recovery.frameId === input.frameId && recovery.takeId === input.takeId
    && recovery.expectedTakeSubjectSha256 === input.expectedTakeSubjectSha256
    && recovery.idempotencyKey === input.idempotencyKey
    && ((recovery.status === 'not_found' && recovery.result === null)
      || (recovery.status === 'committed' && recovery.result !== null
        && recommendationMatches(recovery.result, input)))
}

function decisionRecoveryMatches(
  recovery: YimengTakeHumanDecisionRecovery,
  input: YimengCreateTakeHumanDecisionRequest,
): boolean {
  return recovery.schema === 'jason.qingmu-take-review-command-recovery.v1'
    && recovery.commandType === 'qingmu.take_human_decision.record.v1'
    && recovery.projectId === input.projectId && recovery.episodeId === input.episodeId
    && recovery.frameId === input.frameId && recovery.takeId === input.takeId
    && recovery.expectedTakeSubjectSha256 === input.expectedTakeSubjectSha256
    && recovery.idempotencyKey === input.idempotencyKey
    && ((recovery.status === 'not_found' && recovery.result === null)
      || (recovery.status === 'committed' && recovery.result !== null
        && decisionMatches(recovery.result, input)))
}

/** Adjacent, capability-driven panels that keep Reviewer advice and Approver decisions separate. */
export function TakeReviewAuthorityPanel({
  projectId, episodeId, frameId, preferredTakeId, refresh, port, t,
}: TakeReviewAuthorityPanelProps) {
  const scope = { projectId, episodeId, frameId }
  const id = useId()
  const [feed, setFeed] = useState<YimengTakeReviewAuthorityFeedResponse>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [recommendationTakeId, setRecommendationTakeId] = useState(preferredTakeId)
  const [decisionTakeId, setDecisionTakeId] = useState(preferredTakeId)
  const [recommendation, setRecommendation] = useState<YimengTakeReviewAction>('request_changes')
  const [decision, setDecision] = useState<YimengTakeReviewAction>('approve')
  const [recommendationReason, setRecommendationReason] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [recommendationTouched, setRecommendationTouched] = useState(false)
  const [decisionTouched, setDecisionTouched] = useState(false)
  const [recommendationBusy, setRecommendationBusy] = useState(false)
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [recommendationNotice, setRecommendationNotice] = useState<Notice>()
  const [decisionNotice, setDecisionNotice] = useState<Notice>()
  const recommendationBusyRef = useRef(false)
  const decisionBusyRef = useRef(false)
  const recommendationRecoveryRef = useRef<string>()
  const decisionRecoveryRef = useRef<string>()
  const lifeControllerRef = useRef(new AbortController())
  const recommendationReasonId = `${id}-recommendation-reason`
  const recommendationErrorId = `${id}-recommendation-error`
  const decisionReasonId = `${id}-decision-reason`
  const decisionErrorId = `${id}-decision-error`

  useEffect(() => () => { lifeControllerRef.current.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    void port.takeReviewAuthority(scope, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setFeed(value)
      setLoadFailed(false)
      const validTakeId = (current: string) => {
        if (value.versions.some(version => version.takeSubject.takeId === current)) return current
        if (value.versions.some(version => version.takeSubject.takeId === preferredTakeId)) return preferredTakeId
        return value.versions[0]?.takeSubject.takeId ?? ''
      }
      setRecommendationTakeId(validTakeId)
      setDecisionTakeId(validTakeId)
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true)
    })
    return () => { controller.abort() }
  }, [episodeId, frameId, port, preferredTakeId, projectId, refresh, reload])

  function committedRecommendation(intent: TakeReviewRecommendationRecoveryMarker) {
    if (!clearTakeReviewRecommendationRecoveryMarker(intent)) {
      setRecommendationNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      return
    }
    setRecommendationNotice({ key: 'takeReviewRecommendationSubmitted', error: false })
    setRecommendationReason('')
    setRecommendationTouched(false)
    setReload(value => value + 1)
  }

  async function recoverRecommendation(
    intent: TakeReviewRecommendationRecoveryMarker,
    signal: AbortSignal,
  ): Promise<void> {
    const input = recommendationRequest(intent)
    try {
      const recovery = await port.recoverTakeReviewRecommendation(input, signal)
      if (signal.aborted) return
      if (!recommendationRecoveryMatches(recovery, input)) {
        setRecommendationNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      } else if (recovery.status === 'committed' && recovery.result !== null) {
        committedRecommendation(intent)
      } else {
        setRecommendationNotice({ key: 'takeReviewRecommendationUnknown', error: true })
      }
    } catch {
      if (!signal.aborted) {
        setRecommendationNotice({ key: 'takeReviewRecommendationUnknown', error: true })
      }
    }
  }

  function committedDecision(intent: TakeHumanDecisionRecoveryMarker) {
    if (!clearTakeHumanDecisionRecoveryMarker(intent)) {
      setDecisionNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      return
    }
    setDecisionNotice({ key: 'takeReviewDecisionSubmitted', error: false })
    setDecisionReason('')
    setDecisionTouched(false)
    setReload(value => value + 1)
  }

  async function recoverDecision(
    intent: TakeHumanDecisionRecoveryMarker,
    signal: AbortSignal,
  ): Promise<void> {
    const input = decisionRequest(intent)
    try {
      const recovery = await port.recoverTakeHumanDecision(input, signal)
      if (signal.aborted) return
      if (!decisionRecoveryMatches(recovery, input)) {
        setDecisionNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      } else if (recovery.status === 'committed' && recovery.result !== null) {
        committedDecision(intent)
      } else {
        setDecisionNotice({ key: 'takeReviewDecisionUnknown', error: true })
      }
    } catch {
      if (!signal.aborted) setDecisionNotice({ key: 'takeReviewDecisionUnknown', error: true })
    }
  }

  useEffect(() => {
    const intent = readTakeReviewRecommendationRecoveryMarker(scope)
    if (intent === undefined) {
      if (hasTakeReviewRecommendationRecoveryMarker(scope)) {
        setRecommendationNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      }
      return
    }
    if (recommendationRecoveryRef.current === intent.idempotencyKey) return
    recommendationRecoveryRef.current = intent.idempotencyKey
    recommendationBusyRef.current = true
    setRecommendationBusy(true)
    const controller = lifeControllerRef.current
    void recoverRecommendation(intent, controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        recommendationBusyRef.current = false
        setRecommendationBusy(false)
      }
    })
  }, [episodeId, frameId, port, projectId])

  useEffect(() => {
    const intent = readTakeHumanDecisionRecoveryMarker(scope)
    if (intent === undefined) {
      if (hasTakeHumanDecisionRecoveryMarker(scope)) {
        setDecisionNotice({ key: 'takeReviewRecoveryMismatch', error: true })
      }
      return
    }
    if (decisionRecoveryRef.current === intent.idempotencyKey) return
    decisionRecoveryRef.current = intent.idempotencyKey
    decisionBusyRef.current = true
    setDecisionBusy(true)
    const controller = lifeControllerRef.current
    void recoverDecision(intent, controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        decisionBusyRef.current = false
        setDecisionBusy(false)
      }
    })
  }, [episodeId, frameId, port, projectId])

  if (feed === undefined) {
    if (!loadFailed) return null
    return <section className={css.reviewAuthority} aria-label={t('takeReviewAuthorityTitle')}>
      <p role="alert" className={card.warning}>{t('takeReviewLoadError')}</p>
    </section>
  }

  const selectedRecommendationVersion = feed.versions.find(
    version => version.takeSubject.takeId === recommendationTakeId,
  ) ?? feed.versions[0]
  const selectedDecisionVersion = feed.versions.find(
    version => version.takeSubject.takeId === decisionTakeId,
  ) ?? feed.versions[0]
  const canonicalRecommendationReason = pythonStripTakeReviewText(recommendationReason)
  const canonicalDecisionReason = pythonStripTakeReviewText(decisionReason)
  const recommendationInvalid = canonicalRecommendationReason.length === 0
  const decisionInvalid = canonicalDecisionReason.length === 0
  const recommendationLocked = hasTakeReviewRecommendationRecoveryMarker(scope)
  const decisionLocked = hasTakeHumanDecisionRecoveryMarker(scope)

  async function submitRecommendation(): Promise<void> {
    setRecommendationTouched(true)
    if (recommendationBusyRef.current || !feed?.capabilities.canReview
      || recommendationInvalid || selectedRecommendationVersion === undefined) return
    if (hasTakeReviewRecommendationRecoveryMarker(scope)) {
      setRecommendationNotice({ key: 'takeReviewRecommendationUnknown', error: true })
      return
    }
    recommendationBusyRef.current = true
    setRecommendationBusy(true)
    setRecommendationNotice(undefined)
    const input: YimengCreateTakeReviewRecommendationRequest = {
      ...scope,
      expectedTakeSubjectSha256: selectedRecommendationVersion.takeSubjectSha256,
      takeId: selectedRecommendationVersion.takeSubject.takeId,
      recommendation,
      reason: canonicalRecommendationReason,
      idempotencyKey: createTakeReviewRecommendationIdempotencyKey(),
    }
    const intent: TakeReviewRecommendationRecoveryMarker = {
      schema: 'qingmu.take-review-recommendation-recovery-marker.v1',
      ...input,
    }
    try {
      if (!writeTakeReviewRecommendationRecoveryMarker(intent)) {
        setRecommendationNotice({ key: 'takeReviewStorageFailed', error: true })
        return
      }
      try {
        const result = await port.createTakeReviewRecommendation(input, lifeControllerRef.current.signal)
        if (lifeControllerRef.current.signal.aborted) return
        if (!recommendationMatches(result, input)) {
          setRecommendationNotice({ key: 'takeReviewRecoveryMismatch', error: true })
          return
        }
        committedRecommendation(intent)
      } catch {
        if (!lifeControllerRef.current.signal.aborted) {
          await recoverRecommendation(intent, lifeControllerRef.current.signal)
        }
      }
    } finally {
      recommendationBusyRef.current = false
      if (!lifeControllerRef.current.signal.aborted) setRecommendationBusy(false)
    }
  }

  async function submitDecision(): Promise<void> {
    setDecisionTouched(true)
    if (decisionBusyRef.current || !feed?.capabilities.canDecide
      || decisionInvalid || selectedDecisionVersion === undefined) return
    if (hasTakeHumanDecisionRecoveryMarker(scope)) {
      setDecisionNotice({ key: 'takeReviewDecisionUnknown', error: true })
      return
    }
    decisionBusyRef.current = true
    setDecisionBusy(true)
    setDecisionNotice(undefined)
    const input: YimengCreateTakeHumanDecisionRequest = {
      ...scope,
      expectedTakeSubjectSha256: selectedDecisionVersion.takeSubjectSha256,
      takeId: selectedDecisionVersion.takeSubject.takeId,
      decision,
      reason: canonicalDecisionReason,
      idempotencyKey: createTakeHumanDecisionIdempotencyKey(),
    }
    const intent: TakeHumanDecisionRecoveryMarker = {
      schema: 'qingmu.take-human-decision-recovery-marker.v1',
      ...input,
    }
    try {
      if (!writeTakeHumanDecisionRecoveryMarker(intent)) {
        setDecisionNotice({ key: 'takeReviewStorageFailed', error: true })
        return
      }
      try {
        const result = await port.createTakeHumanDecision(input, lifeControllerRef.current.signal)
        if (lifeControllerRef.current.signal.aborted) return
        if (!decisionMatches(result, input)) {
          setDecisionNotice({ key: 'takeReviewRecoveryMismatch', error: true })
          return
        }
        committedDecision(intent)
      } catch {
        if (!lifeControllerRef.current.signal.aborted) {
          await recoverDecision(intent, lifeControllerRef.current.signal)
        }
      }
    } finally {
      decisionBusyRef.current = false
      if (!lifeControllerRef.current.signal.aborted) setDecisionBusy(false)
    }
  }

  return <section className={css.reviewAuthority} aria-label={t('takeReviewAuthorityTitle')}>
    <header><h4>{t('takeReviewAuthorityTitle')}</h4><p>{t('takeReviewAuthorityBoundary')}</p></header>
    <div className={css.reviewGrid}>
      <section className={css.reviewPanel} data-authority="reviewer"
        aria-label={t('takeReviewRecommendationTitle')}>
        <header><h5>{t('takeReviewRecommendationTitle')}</h5>
          <p>{t('takeReviewRecommendationBoundary')}</p></header>
        <form className={css.reviewForm} aria-label={t('takeReviewRecommendationForm')}
          onSubmit={(event) => {
            event.preventDefault()
            void submitRecommendation()
          }}>
          <label htmlFor={`${id}-recommendation-take`}>{t('takeReviewTakeVersion')}</label>
          <select id={`${id}-recommendation-take`}
            value={selectedRecommendationVersion?.takeSubject.takeId ?? ''}
            disabled={!feed.capabilities.canReview}
            onChange={(event) => { setRecommendationTakeId(event.currentTarget.value) }}>
            {feed.versions.map(version => <option key={version.takeSubject.takeId}
              value={version.takeSubject.takeId}>v{version.takeSubject.versionOrdinal} · {version.takeSubject.takeId}</option>)}
          </select>
          <label htmlFor={`${id}-recommendation-action`}>{t('takeReviewRecommendationAction')}</label>
          <select id={`${id}-recommendation-action`} value={recommendation}
            disabled={!feed.capabilities.canReview}
            onChange={(event) => { setRecommendation(event.currentTarget.value as YimengTakeReviewAction) }}>
            {(Object.keys(ACTION_KEYS) as YimengTakeReviewAction[]).map(value =>
              <option key={value} value={value}>{t(ACTION_KEYS[value])}</option>)}
          </select>
          <label htmlFor={recommendationReasonId}>{t('takeReviewReason')}</label>
          <textarea id={recommendationReasonId} value={recommendationReason} maxLength={8_000}
            disabled={!feed.capabilities.canReview}
            aria-describedby={recommendationTouched && recommendationInvalid ? recommendationErrorId : undefined}
            aria-invalid={recommendationTouched && recommendationInvalid}
            onChange={(event) => { setRecommendationReason(event.currentTarget.value); setRecommendationTouched(true) }} />
          {recommendationTouched && recommendationInvalid && <p id={recommendationErrorId}
            role="alert" aria-live="polite" className={card.warning}>{t('takeReviewReasonRequired')}</p>}
          {!feed.capabilities.canReview && <p>{t('takeReviewRecommendationReadOnly')}</p>}
          <button type="submit" disabled={recommendationBusy || recommendationLocked
            || !feed.capabilities.canReview || selectedRecommendationVersion === undefined}>
            {t(recommendationBusy ? 'takeReviewRecommendationSubmitting' : 'takeReviewRecommendationSubmit')}
          </button>
          {recommendationBusy && <p role="status" aria-live="polite">{t('takeReviewRecommendationSubmitting')}</p>}
          {recommendationNotice !== undefined && <p role={recommendationNotice.error ? 'alert' : 'status'}
            aria-live="polite" className={recommendationNotice.error ? card.warning : css.notice}>
            {t(recommendationNotice.key)}
          </p>}
        </form>
        <div className={css.reviewHistory}><strong>{t('takeReviewRecommendationHistory')}</strong>
          {feed.recommendations.length === 0 ? <p>{t('takeReviewRecommendationEmpty')}</p>
            : <ul>{feed.recommendations.map(item => <li key={item.id}>
              <span>{t(ACTION_KEYS[item.recommendation])} · {item.reason}</span>
              <small>{item.actorId} · {item.recommendedAt} · {t(item.currentBinding
                ? 'takeReviewCurrentBinding' : 'takeReviewHistorical')}</small>
              <small>{t('takeReviewActorNaturalPerson')}: {item.actorNaturalPersonId}</small>
            </li>)}</ul>}
        </div>
      </section>

      <section className={css.reviewPanel} data-authority="approver"
        aria-label={t('takeReviewDecisionTitle')}>
        <header><h5>{t('takeReviewDecisionTitle')}</h5><p>{t('takeReviewDecisionBoundary')}</p></header>
        <form className={css.reviewForm} aria-label={t('takeReviewDecisionForm')}
          onSubmit={(event) => {
            event.preventDefault()
            void submitDecision()
          }}>
          <label htmlFor={`${id}-decision-take`}>{t('takeReviewTakeVersion')}</label>
          <select id={`${id}-decision-take`} value={selectedDecisionVersion?.takeSubject.takeId ?? ''}
            disabled={!feed.capabilities.canDecide}
            onChange={(event) => { setDecisionTakeId(event.currentTarget.value) }}>
            {feed.versions.map(version => <option key={version.takeSubject.takeId}
              value={version.takeSubject.takeId}>v{version.takeSubject.versionOrdinal} · {version.takeSubject.takeId}</option>)}
          </select>
          <label htmlFor={`${id}-decision-action`}>{t('takeReviewDecisionAction')}</label>
          <select id={`${id}-decision-action`} value={decision}
            disabled={!feed.capabilities.canDecide}
            onChange={(event) => { setDecision(event.currentTarget.value as YimengTakeReviewAction) }}>
            {(Object.keys(ACTION_KEYS) as YimengTakeReviewAction[]).map(value =>
              <option key={value} value={value}>{t(ACTION_KEYS[value])}</option>)}
          </select>
          <label htmlFor={decisionReasonId}>{t('takeReviewReason')}</label>
          <textarea id={decisionReasonId} value={decisionReason} maxLength={8_000}
            disabled={!feed.capabilities.canDecide}
            aria-describedby={decisionTouched && decisionInvalid ? decisionErrorId : undefined}
            aria-invalid={decisionTouched && decisionInvalid}
            onChange={(event) => { setDecisionReason(event.currentTarget.value); setDecisionTouched(true) }} />
          {decisionTouched && decisionInvalid && <p id={decisionErrorId}
            role="alert" aria-live="polite" className={card.warning}>{t('takeReviewReasonRequired')}</p>}
          {!feed.capabilities.canDecide && <p>{t('takeReviewDecisionReadOnly')}</p>}
          <button type="submit" disabled={decisionBusy || decisionLocked
            || !feed.capabilities.canDecide || selectedDecisionVersion === undefined}>
            {t(decisionBusy ? 'takeReviewDecisionSubmitting' : 'takeReviewDecisionSubmit')}
          </button>
          {decisionBusy && <p role="status" aria-live="polite">{t('takeReviewDecisionSubmitting')}</p>}
          {decisionNotice !== undefined && <p role={decisionNotice.error ? 'alert' : 'status'}
            aria-live="polite" className={decisionNotice.error ? card.warning : css.notice}>
            {t(decisionNotice.key)}
          </p>}
        </form>
        <div className={css.reviewHistory}><strong>{t('takeReviewDecisionHistory')}</strong>
          {feed.decisions.length === 0 ? <p>{t('takeReviewDecisionEmpty')}</p>
            : <ul>{feed.decisions.map(item => <li key={item.decisionId}>
              <span>{t(ACTION_KEYS[item.decision])} · {item.reason}</span>
              <small>{item.actorId} · {item.decidedAt} · {t(item.currentBinding
                ? 'takeReviewCurrentBinding' : 'takeReviewHistorical')}</small>
              <small>{t('takeReviewActorNaturalPerson')}: {item.actorNaturalPersonId}</small>
              <small>{t('takeReviewProducerNaturalPerson')}: {item.producerNaturalPersonId}
                {' · '}{t('takeReviewNaturalPersonSeparated')}</small>
            </li>)}</ul>}
        </div>
      </section>
    </div>
  </section>
}
