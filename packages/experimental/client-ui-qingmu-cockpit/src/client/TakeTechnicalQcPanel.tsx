import { useEffect, useId, useRef, useState } from 'react'
import type {
  QingmuYimengPort,
  YimengRecordTakeTechnicalQcRequest,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
  YimengTakeTechnicalQcFeedResponse,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearTakeTechnicalQcRecoveryMarker,
  createTakeTechnicalQcIdempotencyKey,
  hasTakeTechnicalQcRecoveryMarker,
  pythonStripTakeTechnicalQcText,
  readTakeTechnicalQcRecoveryMarker,
  writeTakeTechnicalQcRecoveryMarker,
  type TakeTechnicalQcRecoveryMarker,
} from './take-technical-qc-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

export type TakeTechnicalQcPort = Pick<QingmuYimengPort,
  'takeTechnicalQc' | 'recordTakeTechnicalQc' | 'recoverTakeTechnicalQc'>

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly refresh: number
  readonly port: TakeTechnicalQcPort
  readonly t: (key: QingmuCockpitKey) => string
}

type ResultValue = YimengTakeTechnicalQcCheck['result']
interface Draft {
  readonly result: ResultValue
  readonly note: string
  readonly evidenceRefs: string
}
type Drafts = Record<YimengTakeTechnicalQcCode, Draft>
type Notice = { readonly key: QingmuCockpitKey; readonly error: boolean }

const MACRO_CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
] as const satisfies readonly YimengTakeTechnicalQcCode[]
const MICRO_CODES = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const satisfies readonly YimengTakeTechnicalQcCode[]
const ALL_CODES = [...MACRO_CODES, ...MICRO_CODES] as const
const RESULT_KEYS: Readonly<Record<ResultValue, QingmuCockpitKey>> = {
  PASS: 'takeTechnicalQcPass',
  FAIL: 'takeTechnicalQcFail',
  UNVERIFIED: 'takeTechnicalQcUnverified',
}

function initialDrafts(): Drafts {
  return Object.fromEntries(ALL_CODES.map(code => [code, {
    result: 'UNVERIFIED', note: '', evidenceRefs: '',
  }])) as Drafts
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function evidenceRefs(value: string): readonly string[] {
  return [...new Set(value.split(/\r?\n/u).map(pythonStripTakeTechnicalQcText).filter(Boolean))]
    .sort(codePointCompare)
}

function normalizedChecks(drafts: Drafts): readonly YimengTakeTechnicalQcCheck[] {
  return ALL_CODES.map((code) => {
    const draft = drafts[code]
    const note = pythonStripTakeTechnicalQcText(draft.note)
    return {
      code,
      result: draft.result,
      note: note === '' ? null : note,
      evidenceRefs: evidenceRefs(draft.evidenceRefs),
    }
  })
}

function invalidCodes(drafts: Drafts): ReadonlySet<YimengTakeTechnicalQcCode> {
  return new Set(ALL_CODES.filter((code) => {
    const draft = drafts[code]
    return draft.result !== 'PASS'
      && (pythonStripTakeTechnicalQcText(draft.note) === '' || evidenceRefs(draft.evidenceRefs).length === 0)
  }))
}

function checksEqual(
  left: readonly YimengTakeTechnicalQcCheck[],
  right: readonly YimengTakeTechnicalQcCheck[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function resultMatches(
  result: YimengTakeTechnicalQcResult,
  intent: TakeTechnicalQcRecoveryMarker,
): boolean {
  const expectedIssues = intent.checks.filter(check => check.result !== 'PASS').map(check => check.code)
    .sort(codePointCompare)
  const expectedPass = result.assessment.technicalReceiptStatus === 'PASS' && expectedIssues.length === 0
  return Object.is(result.schema, 'jason.qingmu-take-technical-qc-result.v1')
    && result.assessment.takeSubject.projectId === intent.projectId
    && result.assessment.takeSubject.episodeId === intent.episodeId
    && result.assessment.takeSubject.frameId === intent.frameId
    && result.assessment.takeSubject.takeId === intent.takeId
    && result.assessment.evidenceSnapshotSha256 === intent.expectedEvidenceSnapshotSha256
    && checksEqual(result.assessment.checks, intent.checks)
    && JSON.stringify(result.assessment.issueCodes) === JSON.stringify(expectedIssues)
    && result.assessment.technicalPass === expectedPass && result.technicalPass === expectedPass
    && Object.is(result.technicalQcRecorded, true) && Object.is(result.changed, false)
    && Object.is(result.selectionChanged, false) && Object.is(result.recommendationChanged, false)
    && Object.is(result.decisionRecorded, false) && Object.is(result.formalApprovalChanged, false)
    && Object.is(result.technicalPassChanged, false) && Object.is(result.episodeVerificationChanged, false)
    && Object.is(result.humanSignoffInferred, false) && Object.is(result.providerCalls, 0)
    && Object.is(result.budgetMutation, false)
}

function recoveryMatches(
  recovery: YimengTakeTechnicalQcRecovery,
  intent: TakeTechnicalQcRecoveryMarker,
): boolean {
  return Object.is(recovery.schema, 'jason.qingmu-take-technical-qc-recovery.v1')
    && recovery.projectId === intent.projectId && recovery.episodeId === intent.episodeId
    && recovery.frameId === intent.frameId && recovery.takeId === intent.takeId
    && recovery.expectedEvidenceSnapshotSha256 === intent.expectedEvidenceSnapshotSha256
    && recovery.idempotencyKey === intent.idempotencyKey
    && ((recovery.status === 'not_found' && recovery.result === null)
      || (recovery.status === 'committed' && recovery.result !== null
        && resultMatches(recovery.result, intent)))
}

/** E7-3 Reviewer technical QC. It records evidence, never approval or rework authority. */
export function TakeTechnicalQcPanel({ projectId, episodeId, frameId, refresh, port, t }: Props) {
  const scope = { projectId, episodeId, frameId }
  const id = useId()
  const [feed, setFeed] = useState<YimengTakeTechnicalQcFeedResponse>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [drafts, setDrafts] = useState<Drafts>(initialDrafts)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const busyRef = useRef(false)
  const recoveryRef = useRef<string>()
  const lifeControllerRef = useRef(new AbortController())

  useEffect(() => () => { lifeControllerRef.current.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    void port.takeTechnicalQc(scope, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setFeed(value)
        setLoadFailed(false)
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true)
    })
    return () => { controller.abort() }
  }, [episodeId, frameId, port, projectId, refresh, reload])

  function committed(intent: TakeTechnicalQcRecoveryMarker) {
    if (!clearTakeTechnicalQcRecoveryMarker(intent)) {
      setNotice({ key: 'takeTechnicalQcRecoveryMismatch', error: true })
      return
    }
    setNotice({ key: 'takeTechnicalQcSubmitted', error: false })
    setDrafts(initialDrafts())
    setTouched(false)
    setReload(value => value + 1)
  }

  async function recover(intent: TakeTechnicalQcRecoveryMarker, signal: AbortSignal): Promise<void> {
    const request: YimengRecordTakeTechnicalQcRequest = {
      projectId: intent.projectId, episodeId: intent.episodeId, frameId: intent.frameId,
      expectedEvidenceSnapshotSha256: intent.expectedEvidenceSnapshotSha256,
      takeId: intent.takeId, checks: intent.checks, idempotencyKey: intent.idempotencyKey,
    }
    try {
      const recovery = await port.recoverTakeTechnicalQc(request, signal)
      if (signal.aborted) return
      if (!recoveryMatches(recovery, intent)) {
        setNotice({ key: 'takeTechnicalQcRecoveryMismatch', error: true })
      } else if (recovery.status === 'committed' && recovery.result !== null) {
        committed(intent)
      } else {
        setNotice({ key: 'takeTechnicalQcUnknown', error: true })
      }
    } catch {
      if (!signal.aborted) setNotice({ key: 'takeTechnicalQcUnknown', error: true })
    }
  }

  useEffect(() => {
    const intent = readTakeTechnicalQcRecoveryMarker(scope)
    if (intent === undefined) {
      if (hasTakeTechnicalQcRecoveryMarker(scope)) {
        setNotice({ key: 'takeTechnicalQcRecoveryMismatch', error: true })
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

  if (feed === undefined) {
    return <section className={css.technicalQc} aria-label={t('takeTechnicalQcTitle')}>
      <p role={loadFailed ? 'alert' : 'status'} className={loadFailed ? card.warning : undefined}>
        {t(loadFailed ? 'takeTechnicalQcLoadError' : 'takeTechnicalQcLoading')}
      </p>
    </section>
  }

  const invalid = invalidCodes(drafts)
  const locked = hasTakeTechnicalQcRecoveryMarker(scope)

  function update(code: YimengTakeTechnicalQcCode, patch: Partial<Draft>) {
    setDrafts(current => ({ ...current, [code]: { ...current[code], ...patch } }))
  }

  async function submit(): Promise<void> {
    setTouched(true)
    if (busyRef.current || locked || !feed?.capabilities.canRecordTechnicalQc || invalid.size > 0) return
    busyRef.current = true
    setBusy(true)
    setNotice(undefined)
    const intent: TakeTechnicalQcRecoveryMarker = {
      schema: 'qingmu.take-technical-qc-recovery-marker.v1',
      ...scope,
      expectedEvidenceSnapshotSha256: feed.currentAcceptance.evidenceSnapshotSha256,
      takeId: feed.currentAcceptance.takeSubject.takeId,
      checks: normalizedChecks(drafts),
      idempotencyKey: createTakeTechnicalQcIdempotencyKey(),
    }
    try {
      if (!writeTakeTechnicalQcRecoveryMarker(intent)) {
        setNotice({ key: 'takeTechnicalQcStorageFailed', error: true })
        return
      }
      try {
        const request: YimengRecordTakeTechnicalQcRequest = {
          projectId: intent.projectId,
          episodeId: intent.episodeId,
          frameId: intent.frameId,
          expectedEvidenceSnapshotSha256: intent.expectedEvidenceSnapshotSha256,
          takeId: intent.takeId,
          checks: intent.checks,
          idempotencyKey: intent.idempotencyKey,
        }
        const result = await port.recordTakeTechnicalQc(request, lifeControllerRef.current.signal)
        if (lifeControllerRef.current.signal.aborted) return
        if (!resultMatches(result, intent)) {
          setNotice({ key: 'takeTechnicalQcRecoveryMismatch', error: true })
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

  const renderGroup = (title: QingmuCockpitKey, codes: readonly YimengTakeTechnicalQcCode[]) =>
    <fieldset className={css.qcGroup} disabled={!feed.capabilities.canRecordTechnicalQc || busy || locked}>
      <legend>{t(title)}</legend>
      {codes.map((code) => {
        const draft = drafts[code]
        const errorId = `${id}-${code}-error`
        const invalidEntry = touched && invalid.has(code)
        return <div key={code} className={css.qcCheck} data-qc-code={code}>
          <code>{code}</code>
          <label htmlFor={`${id}-${code}-result`}>{t('takeTechnicalQcResult')}</label>
          <select id={`${id}-${code}-result`} value={draft.result}
            onChange={(event) => {
              const result = event.currentTarget.value as ResultValue
              update(code, { result })
            }}>
            {(Object.keys(RESULT_KEYS) as ResultValue[]).map(result =>
              <option key={result} value={result}>{t(RESULT_KEYS[result])}</option>)}
          </select>
          <label htmlFor={`${id}-${code}-note`}>{t('takeTechnicalQcNote')}</label>
          <textarea id={`${id}-${code}-note`} value={draft.note} maxLength={8_000}
            aria-invalid={invalidEntry}
            aria-describedby={invalidEntry ? errorId : undefined}
            onChange={(event) => { update(code, { note: event.currentTarget.value }) }} />
          <label htmlFor={`${id}-${code}-evidence`}>{t('takeTechnicalQcEvidenceRefs')}</label>
          <textarea id={`${id}-${code}-evidence`} value={draft.evidenceRefs} maxLength={65_536}
            aria-invalid={invalidEntry}
            aria-describedby={invalidEntry ? errorId : undefined}
            placeholder={t('takeTechnicalQcEvidenceRefsHelp')}
            onChange={(event) => { update(code, { evidenceRefs: event.currentTarget.value }) }} />
          {invalidEntry && <p id={errorId} role="alert" aria-live="polite" className={card.warning}>
            {t('takeTechnicalQcNonPassRequired')}
          </p>}
        </div>
      })}
    </fieldset>

  return <section className={css.technicalQc} aria-label={t('takeTechnicalQcTitle')}>
    <header><div><h4>{t('takeTechnicalQcTitle')}</h4>
      <p>{t('takeTechnicalQcBoundary')}</p></div>
    <strong>{feed.currentAcceptance.technicalReceiptStatus}</strong>
    </header>
    <p className={css.acceptanceWarning}>{t('takeTechnicalQcNotApproval')}</p>
    {!feed.capabilities.canRecordTechnicalQc && <p>{t('takeTechnicalQcReadOnly')}</p>}
    <form className={css.technicalQcForm} aria-label={t('takeTechnicalQcForm')}
      onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {renderGroup('takeTechnicalQcMacro', MACRO_CODES)}
      {renderGroup('takeTechnicalQcMicro', MICRO_CODES)}
      <button type="submit" disabled={busy || locked || !feed.capabilities.canRecordTechnicalQc}>
        {t(busy ? 'takeTechnicalQcSubmitting' : 'takeTechnicalQcSubmit')}
      </button>
      {busy && <p role="status" aria-live="polite">{t('takeTechnicalQcSubmitting')}</p>}
      {notice !== undefined && <p role={notice.error ? 'alert' : 'status'} aria-live="polite"
        className={notice.error ? card.warning : css.notice}>{t(notice.key)}</p>}
    </form>
    <div className={css.qcHistory}><strong>{t('takeTechnicalQcHistory')}</strong>
      {feed.assessments.length === 0 ? <p>{t('takeTechnicalQcEmpty')}</p>
        : <ul>{feed.assessments.map(assessment => <li key={assessment.assessmentId}>
          <span>{assessment.technicalPass ? t('takeTechnicalQcPass') : t('takeTechnicalQcNotPass')}
            {' · '}{assessment.issueCodes.length === 0 ? '—' : assessment.issueCodes.join(', ')}</span>
          <small>{assessment.actorId} · {assessment.recordedAt}</small>
          <small>{t('takeTechnicalQcActorNaturalPerson')}: {assessment.actorNaturalPersonId}</small>
          <small>{t(assessment.currentBinding
            ? 'takeReviewCurrentBinding' : 'takeReviewHistorical')}</small>
        </li>)}</ul>}
    </div>
  </section>
}
