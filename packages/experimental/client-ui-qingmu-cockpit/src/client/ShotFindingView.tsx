import { useEffect, useId, useRef, useState } from 'react'
import type {
  ImagoShotFindingMethodResponse, QingmuYimengPort, YimengShotFindingFeedResponse,
  YimengShotFindingPayload, YimengShotFindingResult, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  digestShotFinding, SHOT_FINDING_OWNER_LABELS, SHOT_FINDING_SEVERITY_LABELS,
  shotFindingPayload, validShotFindingPayload, verifyShotFindingFeed, verifyShotFindingMethod,
  verifyShotFindingReceipt, type ShotFindingRecoveryMarker,
} from './shot-finding-contract.ts'
import {
  clearShotFindingMarker, createShotFindingMarker, readShotFindingMarker,
  writeShotFindingMarker, type ShotFindingRecoveryRead,
} from './shot-finding-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './ShotFindingView.module.css'

interface ShotFindingViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengPort, 'shotFindings' | 'shotFindingMethod' | 'recordShotFinding' | 'recoverShotFinding'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface Run {
  readonly source: YimengWorkflowProjection
  readonly port: ShotFindingViewProps['port']
  readonly refresh: number
  readonly controller: AbortController
  live: boolean
}
type MethodState = { readonly status: 'loading' | 'unavailable' }
  | { readonly status: 'ready'; readonly value: ImagoShotFindingMethodResponse }
type LoadState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly feed: YimengShotFindingFeedResponse; readonly method: MethodState }
)
interface Fields {
  readonly timecode: string
  readonly observation: string
  readonly evidenceLines: string
  readonly earliestOwner: string
  readonly ownerReason: string
  readonly severity: string
  readonly suggestion: string
  readonly reworkScope: string
}
interface Draft { readonly sha: string; readonly fields: Fields }
interface Busy { readonly run: Run; readonly kind: 'record' | 'recover' }
interface Notice {
  readonly source: YimengWorkflowProjection
  readonly port: ShotFindingViewProps['port']
  readonly key: QingmuCockpitKey
  readonly error: boolean
}
function emptyFields(): Fields {
  return { timecode: '', observation: '', evidenceLines: '', earliestOwner: '', ownerReason: '', severity: '', suggestion: '', reworkScope: '' }
}
function authorPayload(fields: Fields): YimengShotFindingPayload | undefined {
  const { severity } = fields
  if (severity !== 'BLOCKER' && severity !== 'MAJOR' && severity !== 'MINOR') return undefined
  return shotFindingPayload({
    timecode: fields.timecode, observation: fields.observation, evidenceRefs: fields.evidenceLines.split('\n'),
    earliestOwner: fields.earliestOwner, ownerReason: fields.ownerReason, severity,
    suggestion: fields.suggestion, reworkScope: fields.reworkScope,
  })
}

/** Changing the canonical Shot drops only its in-memory draft, never its recovery coordinates. */
export function ShotFindingView(props: ShotFindingViewProps) {
  return <ShotFindingPanel key={JSON.stringify([props.projectId, props.episodeId, props.selectedShotId])} {...props} />
}

function ShotFindingPanel({ projectId, episodeId, selectedShotId, projection, enabled, port, t }: ShotFindingViewProps) {
  const scope = { projectId, episodeId, frameId: selectedShotId }
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<LoadState>()
  const [draft, setDraft] = useState<Draft>()
  const [marker, setMarker] = useState<ShotFindingRecoveryRead>(() => readShotFindingMarker(scope))
  const [busy, setBusy] = useState<Busy>()
  const [notice, setNotice] = useState<Notice>()
  const runRef = useRef<Run | undefined>(undefined)
  const busyRef = useRef<Busy | undefined>(undefined)
  const evidenceHelpId = useId()
  const selected = projection?.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  const eligible = enabled && projection !== undefined && projection.projectId === projectId
    && projection.episodeId === episodeId && selected !== undefined
  const live = (run: Run) => run.live && runRef.current === run && !run.controller.signal.aborted

  useEffect(() => {
    const ids = { projectId, episodeId, frameId: selectedShotId }
    setMarker(readShotFindingMarker(ids))
    if (!eligible) {
      setState(undefined)
      return
    }
    const run: Run = { source: projection, port, refresh, controller: new AbortController(), live: true }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    setState({ run, status: 'loading' })
    setNotice(previous => previous?.source === projection && previous.port === port ? previous : undefined)
    const current = () => run.live && runRef.current === run && !run.controller.signal.aborted
    void (async () => {
      let feed: YimengShotFindingFeedResponse
      try {
        feed = await port.shotFindings(ids, run.controller.signal)
        if (!current()) return
        await verifyShotFindingFeed(feed, ids, {
          frameNo: selected.frameNo,
          storyboardRevision: projection.director.shotRelations.storyboardRevision.episodeRevision,
        })
        if (!current()) return
        setDraft(previous => feed.snapshotSha256 === null ? undefined
          : previous?.sha === feed.snapshotSha256 ? previous : { sha: feed.snapshotSha256, fields: emptyFields() })
        setState({ run, status: 'ready', feed, method: { status: feed.subject === null ? 'unavailable' : 'loading' } })
      } catch {
        if (current()) setState({ run, status: 'error' })
        return
      }
      if (feed.subject === null) return
      try {
        const method = await port.shotFindingMethod(ids, run.controller.signal)
        if (!current()) return
        await verifyShotFindingMethod(method, feed)
        if (current()) setState({ run, status: 'ready', feed, method: { status: 'ready', value: method } })
      } catch {
        if (current()) setState({ run, status: 'ready', feed, method: { status: 'unavailable' } })
      }
    })()
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [eligible, projectId, episodeId, selectedShotId, projection, selected, port, refresh])

  const current = eligible && state?.run.source === projection && state.run.port === port && state.run.refresh === refresh
    ? state : undefined
  const feed = current?.status === 'ready' ? current.feed : undefined
  const method = current?.status === 'ready' && current.method.status === 'ready' ? current.method.value : undefined
  const fields = draft?.sha === feed?.snapshotSha256 ? draft?.fields : undefined
  const author = fields === undefined ? undefined : authorPayload(fields)
  const valid = method !== undefined && author !== undefined
    && validShotFindingPayload(author, method.projection.definition.ownerOptions.map(owner => owner.stageId))
  const activeBusy = busy !== undefined && live(busy.run) ? busy : undefined
  const canRecord = feed?.capabilities.canRecordFinding === true && method !== undefined
    && valid && marker.status === 'none' && activeBusy === undefined
  const visibleNotice = eligible && notice?.source === projection && notice.port === port ? notice : undefined
  const loading = eligible && (current === undefined || current.status === 'loading')

  function announce(run: Run, key: QingmuCockpitKey, error = false) {
    if (live(run)) setNotice({ source: run.source, port: run.port, key, error })
  }
  function begin(kind: Busy['kind']): Busy | undefined {
    const run = runRef.current
    if (!eligible || run === undefined || !live(run) || busyRef.current !== undefined
      || run.source !== projection || run.port !== port || run.refresh !== refresh) return undefined
    const active = { run, kind }
    busyRef.current = active
    setBusy(active)
    setNotice(undefined)
    return active
  }
  function finish(active: Busy) {
    if (busyRef.current === active) {
      busyRef.current = undefined
      if (live(active.run)) setBusy(undefined)
    }
  }
  async function acceptReceipt(result: YimengShotFindingResult, intent: ShotFindingRecoveryMarker, run: Run) {
    await verifyShotFindingReceipt(result, intent)
    if (!live(run)) return
    if (!clearShotFindingMarker(intent, { status: 'ready', marker: intent })) {
      setMarker(readShotFindingMarker(intent))
      announce(run, 'findingMarkerChanged', true)
      return
    }
    setMarker({ status: 'none' })
    setDraft(previous => previous?.sha === intent.expectedSubjectSha256 ? { sha: previous.sha, fields: emptyFields() } : previous)
    announce(run, 'findingStored')
    // Read the authoritative history again; a browser receipt never fabricates a feed item.
    setRefresh(value => value + 1)
  }
  async function record() {
    if (!canRecord || feed.snapshotSha256 === null) return
    const active = begin('record')
    if (active === undefined) return
    let sent = false
    try {
      const intent = await createShotFindingMarker({
        ...scope, expectedSubjectSha256: feed.snapshotSha256,
        findingSha256: await digestShotFinding(author), methodProjectionSha256: method.projectionSha256,
      })
      if (!live(active.run)) return
      if (!writeShotFindingMarker(intent)) {
        setMarker(readShotFindingMarker(scope))
        announce(active.run, 'findingStorageFailed', true)
        return
      }
      setMarker({ status: 'ready', marker: intent })
      sent = true
      const result = await port.recordShotFinding({
        ...scope, expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey,
        finding: author, methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
        methodAttestation: method.methodAttestation,
      }, active.run.controller.signal)
      if (live(active.run)) await acceptReceipt(result, intent, active.run)
    } catch {
      announce(active.run, sent ? 'findingUncertain' : 'findingStorageFailed', true)
    } finally { finish(active) }
  }
  async function recover() {
    if (marker.status !== 'ready') return
    const intent = marker.marker
    const active = begin('recover')
    if (active === undefined) return
    try {
      const result = await port.recoverShotFinding({
        projectId: intent.projectId, episodeId: intent.episodeId, frameId: intent.frameId,
        expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey,
      }, active.run.controller.signal)
      if (!live(active.run)) return
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- The RPC schema is a runtime boundary, not a browser guarantee.
      if (result.schema !== 'jason.qingmu-shot-finding-recovery.v1' || result.projectId !== intent.projectId
        || result.episodeId !== intent.episodeId || result.frameId !== intent.frameId
        || result.expectedSubjectSha256 !== intent.expectedSubjectSha256 || result.idempotencyKey !== intent.idempotencyKey) {
        throw new Error('Finding recovery coordinates mismatch')
      }
      if (result.status === 'not_found' && result.result === null) announce(active.run, 'findingNotFound')
      else if (result.status === 'committed' && result.result !== null) await acceptReceipt(result.result, intent, active.run)
      else throw new Error('Finding recovery result mismatch')
    } catch { announce(active.run, 'findingRecoveryError', true) }
    finally { finish(active) }
  }
  function discard() {
    const run = runRef.current
    if (!eligible || run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearShotFindingMarker(scope, marker)
    setMarker(readShotFindingMarker(scope))
    announce(run, cleared ? 'findingDiscarded' : 'findingMarkerChanged', !cleared)
  }
  function edit(key: keyof Fields, value: string) {
    setDraft(previous => previous !== undefined && previous.sha === feed?.snapshotSha256
      ? { ...previous, fields: { ...previous.fields, [key]: value } } : previous)
  }
  function ownerLabel(stageId: string): string {
    const roleId = method?.projection.definition.ownerOptions.find(owner => owner.stageId === stageId)?.roleId
    const label = SHOT_FINDING_OWNER_LABELS[roleId ?? stageId]
    return t(label ?? 'findingOwnerUnavailable')
  }

  return <section className={`${card.card} ${css.panel}`} aria-label={t('findingTitle')}>
    <div className={css.header}>
      <div><h3>{t('findingTitle')}</h3><p className={css.hint}>{t('findingBoundary')}</p></div>
      <button type="button" onClick={() => { setRefresh(value => value + 1) }} disabled={!eligible || loading || activeBusy !== undefined}>{t('findingRefresh')}</button>
    </div>
    {!eligible && <p className={css.hint}>{t('findingChoose')}</p>}
    {loading && <p role="status">{t('findingLoading')}</p>}
    {current?.status === 'error' && <p role="alert">{t('findingLoadError')}</p>}
    {visibleNotice !== undefined && <p className={css.notice} role={visibleNotice.error ? 'alert' : 'status'}>{t(visibleNotice.key)}</p>}
    {eligible && marker.status !== 'none' && <div className={css.recovery}>
      <h4>{t('findingRecoveryTitle')}</h4>
      <p>{t(marker.status === 'ready' ? 'findingRecoveryHelp' : 'findingRecoveryInvalid')}</p>
      {marker.status === 'ready' && <button type="button" onClick={() => { void recover() }} disabled={activeBusy !== undefined}>
        {t(activeBusy?.kind === 'recover' ? 'findingRecovering' : 'findingRecover')}
      </button>}
      <details><summary>{t('findingDiscard')}</summary><p>{t('findingDiscardHelp')}</p>
        <button type="button" onClick={discard} disabled={activeBusy !== undefined}>{t('findingDiscard')}</button>
      </details>
    </div>}
    {feed !== undefined && <div className={css.body}>
      {feed.subject === null ? <p role="status">{t('findingNoSubject')}</p> : <details className={css.source}>
        <summary>{t('findingSource')} · #{feed.subject.frameNo} · {feed.subject.assetId}</summary>
        <dl className={css.evidence}>
          <div><dt>{t('findingAsset')}</dt><dd>{feed.subject.assetId}</dd></div>
          <div><dt>{t('findingAssetVersion')}</dt><dd>{feed.subject.assetVersion === 0 ? t('findingVersionUnknown') : feed.subject.assetVersion}</dd></div>
          <div><dt>{t('findingRevision')}</dt><dd>{feed.subject.storyboardRevision}</dd></div>
          <div><dt>{t('findingAssetSha')}</dt><dd>{feed.subject.assetSha256}</dd></div>
          <div><dt>{t('findingFrameSha')}</dt><dd>{feed.subject.frameContentSha256}</dd></div>
          <div><dt>{t('findingSnapshotSha')}</dt><dd>{feed.snapshotSha256}</dd></div>
        </dl>
      </details>}
      {!feed.capabilities.canRecordFinding && <p className={css.hint}>{t('findingPermission')}</p>}
      {current?.status === 'ready' && current.method.status !== 'ready'
        && <p role="status">{t(current.method.status === 'loading' ? 'findingMethodLoading' : 'findingMethodUnavailable')}</p>}
      {method !== undefined && fields !== undefined && <form onSubmit={(event) => { event.preventDefault() }}>
        <fieldset disabled={!feed.capabilities.canRecordFinding || marker.status !== 'none' || activeBusy !== undefined}>
          <legend>{t('findingFormTitle')}</legend>
          <p className={css.hint}>{t('findingFormHelp')}</p>
          <div className={css.grid}>
            <label className={css.field}><span>{t('findingTimecode')}</span><input required value={fields.timecode} onChange={(event) => { edit('timecode', event.target.value) }} /></label>
            <label className={css.field}><span>{t('findingSeverity')}</span><select required value={fields.severity} onChange={(event) => { edit('severity', event.target.value) }}>
              <option value="">{t('findingSeverityChoose')}</option>
              {method.projection.definition.severities.map(severity => <option key={severity} value={severity}>
                {t(SHOT_FINDING_SEVERITY_LABELS[severity])}
              </option>)}
            </select></label>
            <label className={`${css.field} ${css.wide}`}><span>{t('findingObservation')}</span><textarea required rows={3} value={fields.observation} onChange={(event) => { edit('observation', event.target.value) }} /></label>
            <label className={`${css.field} ${css.wide}`}><span id={`${evidenceHelpId}-label`}>{t('findingEvidenceRefs')}</span><textarea required rows={3} aria-labelledby={`${evidenceHelpId}-label`} aria-describedby={evidenceHelpId} value={fields.evidenceLines} onChange={(event) => { edit('evidenceLines', event.target.value) }} />
              <small id={evidenceHelpId}>{t('findingEvidenceHelp')}</small>
            </label>
            <label className={css.field}><span>{t('findingEarliestOwner')}</span><select required value={fields.earliestOwner} onChange={(event) => { edit('earliestOwner', event.target.value) }}>
              <option value="">{t('findingOwnerChoose')}</option>
              {method.projection.definition.ownerOptions.map((owner) => {
                const label = SHOT_FINDING_OWNER_LABELS[owner.roleId]
                return label === undefined ? null : <option key={owner.stageId} value={owner.stageId}>{t(label)}</option>
              })}
            </select></label>
            <label className={css.field}><span>{t('findingOwnerReason')}</span><textarea required rows={2} value={fields.ownerReason} onChange={(event) => { edit('ownerReason', event.target.value) }} /></label>
            <label className={css.field}><span>{t('findingSuggestion')}</span><textarea required rows={3} value={fields.suggestion} onChange={(event) => { edit('suggestion', event.target.value) }} /></label>
            <label className={css.field}><span>{t('findingReworkScope')}</span><textarea required rows={3} value={fields.reworkScope} onChange={(event) => { edit('reworkScope', event.target.value) }} /></label>
          </div>
          <div className={css.actions}>
            <button className={card.primaryAction} type="button" onClick={() => { void record() }} disabled={!canRecord}>{t(activeBusy?.kind === 'record' ? 'findingPosting' : 'findingRecord')}</button>
            {!valid && <small className={css.hint}>{t('findingValidation')}</small>}
          </div>
        </fieldset>
      </form>}
      <div className={css.history}>
        <h4>{t('findingHistory')}</h4>
        {feed.items.length === 0 ? <p className={css.hint}>{t('findingEmpty')}</p> : <ul aria-label={t('findingHistory')} className={css.records}>
          {feed.items.map(item => <li key={item.id} className={css.record} data-current-binding={item.currentBinding}>
            <div className={css.recordHeader}><strong>{t(item.currentBinding ? 'findingCurrent' : 'findingHistorical')}</strong><span>{t('findingOpen')}</span></div>
            <p>{item.timecode} · {t(SHOT_FINDING_SEVERITY_LABELS[item.severity])}</p>
            <p className={css.verbatim}>{item.observation}</p>
            <details><summary>{t('findingRecordDetails')}</summary>
              <dl className={css.evidence}>
                <div><dt>{t('findingEarliestOwner')}</dt><dd>{ownerLabel(item.earliestOwner)}</dd></div>
                <div><dt>{t('findingOwnerCode')}</dt><dd>{item.earliestOwner}</dd></div>
                <div><dt>{t('findingOwnerReason')}</dt><dd className={css.verbatim}>{item.ownerReason}</dd></div>
                <div><dt>{t('findingSuggestion')}</dt><dd className={css.verbatim}>{item.suggestion}</dd></div>
                <div><dt>{t('findingReworkScope')}</dt><dd className={css.verbatim}>{item.reworkScope}</dd></div>
                <div><dt>{t('findingEvidenceRefs')}</dt><dd><ul>{item.evidenceRefs.map((reference, index) => <li key={index} className={css.verbatim}>{reference}</li>)}</ul></dd></div>
                <div><dt>{t('findingActor')}</dt><dd>{item.actorId} · {item.actorRole}</dd></div>
                <div><dt>{t('findingRecordedAt')}</dt><dd>{item.createdAt}</dd></div>
                <div><dt>{t('findingRecordId')}</dt><dd>{item.id}</dd></div>
                <div><dt>{t('findingEventId')}</dt><dd>{item.eventId}</dd></div>
                <div><dt>{t('findingSession')}</dt><dd>{item.authSessionId}</dd></div>
                <div><dt>{t('findingAsset')}</dt><dd>{item.subject.assetId}</dd></div>
                <div><dt>{t('findingRevision')}</dt><dd>{item.subject.storyboardRevision}</dd></div>
                <div><dt>{t('findingAssetSha')}</dt><dd>{item.subject.assetSha256}</dd></div>
                <div><dt>{t('findingSnapshotSha')}</dt><dd>{item.subjectSnapshotSha256}</dd></div>
                <div><dt>{t('findingMethodSha')}</dt><dd>{item.methodProjectionSha256}</dd></div>
                <div><dt>{t('findingRulesSha')}</dt><dd>{item.rulesSha256}</dd></div>
              </dl>
            </details>
          </li>)}
        </ul>}
      </div>
    </div>}
  </section>
}
