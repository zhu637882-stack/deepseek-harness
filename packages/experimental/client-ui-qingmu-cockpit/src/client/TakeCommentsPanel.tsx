/* oxlint-disable typescript/no-unnecessary-condition -- Comment RPC DTOs are untrusted at this runtime boundary. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Preserve exact zero-impact receipt checks. */
import { useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengPort,
  YimengCreateTakeCommentRequest,
  YimengTakeCommentAnchor,
  YimengTakeCommentFeedResponse,
  YimengTakeCommentRecovery,
  YimengTakeCommentResult,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearTakeCommentRecoveryMarker,
  createTakeCommentIdempotencyKey,
  hasTakeCommentRecoveryMarker,
  readTakeCommentRecoveryMarker,
  writeTakeCommentRecoveryMarker,
  type TakeCommentRecoveryMarker,
} from './take-comment-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

export type TakeCommentPort = Pick<QingmuYimengPort,
  'takeComments' | 'createTakeComment' | 'recoverTakeComment'>

interface TakeCommentsPanelProps {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly preferredTakeId: string
  readonly refresh: number
  readonly port: TakeCommentPort
  readonly t: (key: QingmuCockpitKey) => string
}

interface Notice {
  readonly key: QingmuCockpitKey
  readonly error: boolean
}

function sameAnchor(left: YimengTakeCommentAnchor, right: YimengTakeCommentAnchor): boolean {
  return left.kind === right.kind && (left.kind === 'timecode'
    ? right.kind === 'timecode' && left.timecodeMillis === right.timecodeMillis
    : right.kind === 'frame' && left.frameNumber === right.frameNumber)
}

function resultMatches(result: YimengTakeCommentResult, input: YimengCreateTakeCommentRequest): boolean {
  return result.schema === 'jason.qingmu-take-comment-result.v1'
    && result.comment.takeId === input.takeId
    && result.comment.takeSubjectSha256 === input.expectedTakeSubjectSha256
    && result.comment.frameBinding.frameId === input.frameId
    && result.comment.body === input.body
    && sameAnchor(result.comment.anchor, input.anchor)
    && result.comment.actorRole === 'commenter'
    && result.changed === false && result.selectionChanged === false
    && result.technicalPassChanged === false && result.formalApprovalChanged === false
    && result.episodeVerificationChanged === false && result.humanSignoffInferred === false
    && result.providerCalls === 0 && result.budgetMutation === false
}

function recoveryMatches(
  recovery: YimengTakeCommentRecovery,
  input: YimengCreateTakeCommentRequest,
): boolean {
  return recovery.schema === 'jason.qingmu-take-comment-recovery.v1'
    && recovery.projectId === input.projectId && recovery.episodeId === input.episodeId
    && recovery.frameId === input.frameId && recovery.takeId === input.takeId
    && recovery.expectedTakeSubjectSha256 === input.expectedTakeSubjectSha256
    && recovery.idempotencyKey === input.idempotencyKey
    && ((recovery.status === 'not_found' && recovery.result === null)
      || (recovery.status === 'committed' && recovery.result !== null
        && resultMatches(recovery.result, input)))
}

function requestFromMarker(marker: TakeCommentRecoveryMarker): YimengCreateTakeCommentRequest {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    frameId: marker.frameId,
    expectedTakeSubjectSha256: marker.expectedTakeSubjectSha256,
    takeId: marker.takeId,
    anchor: marker.anchor,
    body: marker.body,
    idempotencyKey: marker.idempotencyKey,
  }
}

/** Ordinary comments only: no playback, Take selection, Finding, technical status, or approval action. */
export function TakeCommentsPanel({
  projectId, episodeId, frameId, preferredTakeId, refresh, port, t,
}: TakeCommentsPanelProps) {
  const scope = { projectId, episodeId, frameId }
  const [feed, setFeed] = useState<YimengTakeCommentFeedResponse>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [selectedTakeId, setSelectedTakeId] = useState(preferredTakeId)
  const [anchorKind, setAnchorKind] = useState<YimengTakeCommentAnchor['kind']>('timecode')
  const [timecode, setTimecode] = useState('0')
  const [frameNumber, setFrameNumber] = useState('1')
  const [body, setBody] = useState('')
  const [timecodeTouched, setTimecodeTouched] = useState(false)
  const [frameTouched, setFrameTouched] = useState(false)
  const [bodyTouched, setBodyTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const busyRef = useRef(false)
  const autoRecoveryRef = useRef<string>()
  const lifeControllerRef = useRef(new AbortController())
  const anchorRadioName = `take-comment-anchor-${encodeURIComponent(projectId)}-${encodeURIComponent(frameId)}`

  useEffect(() => () => { lifeControllerRef.current.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    void port.takeComments(scope, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setFeed(value)
      setLoadFailed(false)
      setSelectedTakeId((current) => {
        if (value.versions.some(version => version.takeSubject.takeId === current)) return current
        if (value.versions.some(version => version.takeSubject.takeId === preferredTakeId)) return preferredTakeId
        return value.versions[0]?.takeSubject.takeId ?? ''
      })
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true)
    })
    return () => { controller.abort() }
  }, [episodeId, frameId, port, preferredTakeId, projectId, refresh, reload])

  function committed(intent: TakeCommentRecoveryMarker) {
    if (!clearTakeCommentRecoveryMarker(intent)) {
      setNotice({ key: 'takeCommentRecoveryMismatch', error: true })
      return
    }
    setNotice({ key: 'takeCommentSubmitted', error: false })
    setBody('')
    setBodyTouched(false)
    setReload(value => value + 1)
  }

  async function recover(
    intent: TakeCommentRecoveryMarker,
    signal: AbortSignal,
  ): Promise<void> {
    const input = requestFromMarker(intent)
    try {
      const recovery = await port.recoverTakeComment(input, signal)
      if (signal.aborted) return
      if (!recoveryMatches(recovery, input)) {
        setNotice({ key: 'takeCommentRecoveryMismatch', error: true })
      } else if (recovery.status === 'committed' && recovery.result !== null) {
        committed(intent)
      } else {
        setNotice({ key: 'takeCommentUnknown', error: true })
      }
    } catch {
      if (!signal.aborted) setNotice({ key: 'takeCommentUnknown', error: true })
    }
  }

  useEffect(() => {
    const intent = readTakeCommentRecoveryMarker(scope)
    if (intent === undefined || autoRecoveryRef.current === intent.idempotencyKey) return
    autoRecoveryRef.current = intent.idempotencyKey
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
    if (!loadFailed) return null
    return <section className={css.comments} aria-label={t('takeCommentTitle')}>
      <p role="alert" className={card.warning}>{t('takeCommentLoadError')}</p>
    </section>
  }

  const canComment = feed.capabilities.canComment
  const selectedVersion = feed.versions.find(version => version.takeSubject.takeId === selectedTakeId)
    ?? feed.versions[0]
  const durationMillis = selectedVersion?.takeSubject.durationMillis ?? 0
  const parsedTimecode = /^\d+$/u.test(timecode) ? Number(timecode) : Number.NaN
  const parsedFrame = /^\d+$/u.test(frameNumber) ? Number(frameNumber) : Number.NaN
  const invalidTimecode = !Number.isSafeInteger(parsedTimecode)
    || parsedTimecode < 0 || parsedTimecode > durationMillis
  const invalidFrame = !Number.isSafeInteger(parsedFrame) || parsedFrame < 1
  const invalidBody = body.trim().length === 0
  const formInvalid = selectedVersion === undefined || invalidBody
    || (anchorKind === 'timecode' ? invalidTimecode : invalidFrame)
  const recoveryLocked = hasTakeCommentRecoveryMarker(scope)

  async function submit(): Promise<void> {
    if (busyRef.current || !canComment || formInvalid || selectedVersion === undefined) return
    if (hasTakeCommentRecoveryMarker(scope)) {
      setNotice({ key: 'takeCommentUnknown', error: true })
      return
    }
    busyRef.current = true
    setBusy(true)
    setNotice(undefined)
    const input: YimengCreateTakeCommentRequest = {
      ...scope,
      expectedTakeSubjectSha256: selectedVersion.takeSubjectSha256,
      takeId: selectedVersion.takeSubject.takeId,
      anchor: anchorKind === 'timecode'
        ? { kind: 'timecode', timecodeMillis: parsedTimecode }
        : { kind: 'frame', frameNumber: parsedFrame },
      body: body.trim(),
      idempotencyKey: createTakeCommentIdempotencyKey(),
    }
    const intent: TakeCommentRecoveryMarker = {
      schema: 'qingmu.take-comment-recovery-marker.v1',
      ...input,
    }
    try {
      if (!writeTakeCommentRecoveryMarker(intent)) {
        setNotice({ key: 'takeCommentStorageFailed', error: true })
        return
      }
      try {
        const result = await port.createTakeComment(input, lifeControllerRef.current.signal)
        if (lifeControllerRef.current.signal.aborted) return
        if (!resultMatches(result, input)) {
          setNotice({ key: 'takeCommentRecoveryMismatch', error: true })
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

  return <section className={css.comments} aria-label={t('takeCommentTitle')}>
    <header><div><h4>{t('takeCommentTitle')}</h4><p>{t('takeCommentBoundary')}</p></div></header>
    <div className={css.commentForm}>
      <label>{t('takeCommentTakeVersion')}
        <select value={selectedVersion?.takeSubject.takeId ?? ''}
          onChange={(event) => { setSelectedTakeId(event.currentTarget.value) }}>
          {feed.versions.map(version => <option key={version.takeSubject.takeId} value={version.takeSubject.takeId}>
            v{version.takeSubject.versionOrdinal} · {version.takeSubject.takeId}
          </option>)}
        </select>
      </label>
      <fieldset><legend>{t('takeCommentAnchor')}</legend>
        <label><input type="radio" name={anchorRadioName} value="timecode"
          checked={anchorKind === 'timecode'} onChange={() => { setAnchorKind('timecode') }} />
        {t('takeCommentTimecode')}</label>
        <input type="radio" name={anchorRadioName} value="frame" title={t('takeCommentFrame')}
          checked={anchorKind === 'frame'} onChange={() => { setAnchorKind('frame') }} />
        <span aria-hidden="true">{t('takeCommentFrame')}</span>
      </fieldset>
      {anchorKind === 'timecode' ? <div className={css.commentCoordinate}>
        <label>{t('takeCommentTimecodeMillis')}<input type="number" min="0" max={durationMillis} step="1"
          value={timecode} onChange={(event) => { setTimecode(event.currentTarget.value); setTimecodeTouched(true) }} /></label>
        <span>{t('takeCommentRangePrefix')}0–{durationMillis}{t('takeCommentMillisSuffix')}</span>
        {timecodeTouched && invalidTimecode && <p role="alert" className={card.warning}>
          {t('takeCommentTimecodeErrorPrefix')}0–{durationMillis}{t('takeCommentTimecodeErrorSuffix')}
        </p>}
      </div> : <div className={css.commentCoordinate}>
        <label>{t('takeCommentFrame')}<input type="number" min="1" step="1" value={frameNumber}
          onChange={(event) => { setFrameNumber(event.currentTarget.value); setFrameTouched(true) }} /></label>
        {frameTouched && invalidFrame && <p role="alert" className={card.warning}>{t('takeCommentFrameError')}</p>}
      </div>}
      <label>{t('takeCommentBody')}<textarea value={body} maxLength={8_000}
        onChange={(event) => { setBody(event.currentTarget.value); setBodyTouched(true) }} /></label>
      {bodyTouched && invalidBody && <p role="alert" className={card.warning}>{t('takeCommentBodyRequired')}</p>}
      {!feed.capabilities.canComment && <p>{t('takeCommentReadOnly')}</p>}
      <button type="button" disabled={busy || recoveryLocked || !feed.capabilities.canComment || formInvalid}
        onClick={() => { void submit() }}>{t('takeCommentSubmit')}</button>
      {busy && <p role="status">{t('takeCommentSubmitting')}</p>}
      {!busy && notice !== undefined && <p role={notice.error ? 'alert' : 'status'}
        className={notice.error ? card.warning : css.notice}>{t(notice.key)}</p>}
    </div>
    {feed.comments.length === 0 ? <p>{t('takeCommentEmpty')}</p> : <ul className={css.commentList}>
      {feed.comments.map(comment => <li key={comment.id}>
        <header><strong>{comment.currentBinding ? t('takeCommentCurrentBinding') : t('takeCommentHistorical')}</strong>
          <span>v{comment.versionOrdinalAtComment}</span></header>
        <p>{comment.body}</p>
        <small>{comment.anchor.kind === 'timecode'
          ? `${t('takeCommentTimecode')} · ${String(comment.anchor.timecodeMillis)} ms`
          : `${t('takeCommentFrame')} · ${String(comment.anchor.frameNumber)}`}</small>
      </li>)}
    </ul>}
  </section>
}
