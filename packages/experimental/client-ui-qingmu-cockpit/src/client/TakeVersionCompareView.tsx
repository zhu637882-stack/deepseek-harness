import { useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengPort, YimengTakeVersion, YimengTakeVersionSelectionResult,
  YimengTakeVersionStackResponse, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker,
  readTakeVersionSelectionMarker, writeTakeVersionSelectionMarker,
  type TakeVersionSelectionRecoveryMarker, type TakeVersionSelectionRecoveryRead,
} from './take-version-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

interface TakeVersionCompareViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengPort, 'takeVersions' | 'selectTakeVersion' | 'recoverTakeVersionSelection'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface Run {
  readonly source: YimengWorkflowProjection
  readonly port: TakeVersionCompareViewProps['port']
  readonly refresh: number
  readonly controller: AbortController
  live: boolean
}

type LoadState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly stack: YimengTakeVersionStackResponse }
)

interface Busy {
  readonly run: Run
  kind: 'select' | 'recover'
}

interface Notice {
  readonly key: QingmuCockpitKey
  readonly error: boolean
}

function requestFromMarker(marker: TakeVersionSelectionRecoveryMarker) {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    frameId: marker.frameId,
    expectedStackSha256: marker.expectedStackSha256,
    expectedSelectedTakeId: marker.expectedSelectedTakeId,
    candidateTakeId: marker.candidateTakeId,
    candidateVersionOrdinal: marker.candidateVersionOrdinal,
    candidateOutputSha256: marker.candidateOutputSha256,
    idempotencyKey: marker.idempotencyKey,
  }
}

function receiptMatches(result: YimengTakeVersionSelectionResult, marker: TakeVersionSelectionRecoveryMarker): boolean {
  return result.schema === 'jason.qingmu-take-selection-result.v1'
    && result.projectId === marker.projectId && result.episodeId === marker.episodeId
    && result.frameId === marker.frameId && result.baseStackSnapshotSha256 === marker.expectedStackSha256
    && result.idempotencyKey === marker.idempotencyKey && result.selectedTake.takeId === marker.candidateTakeId
    && result.selectedTake.versionOrdinal === marker.candidateVersionOrdinal
    && result.selectedTake.outputSha256 === marker.candidateOutputSha256
    && result.authoritativeStack.selectedTakeId === marker.candidateTakeId
    && result.selectionChanged === true && result.providerCalls === 0
    && result.paidProviderAuthority === 'not_granted' && result.budgetMutation === false
    && result.humanApprovalInferred === false && result.formalApprovalChanged === false
}

/** Same-Shot Take comparison and owner selection. Selection never means approval or paid generation. */
export function TakeVersionCompareView(props: TakeVersionCompareViewProps) {
  const key = JSON.stringify([props.projectId, props.episodeId, props.selectedShotId])
  return <TakeVersionComparePanel key={key} {...props} />
}

function TakeVersionComparePanel({
  projectId, episodeId, selectedShotId, projection, enabled, port, t,
}: TakeVersionCompareViewProps) {
  const scope = { projectId, episodeId, frameId: selectedShotId }
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<LoadState>()
  const [compareTakeIds, setCompareTakeIds] = useState<readonly string[]>([])
  const [marker, setMarker] = useState<TakeVersionSelectionRecoveryRead>(
    () => readTakeVersionSelectionMarker(scope),
  )
  const [busy, setBusy] = useState<Busy>()
  const [notice, setNotice] = useState<Notice>()
  const [receipt, setReceipt] = useState<YimengTakeVersionSelectionResult>()
  const runRef = useRef<Run>()
  const busyRef = useRef<Busy>()
  const autoRecoveryRef = useRef<string>()
  const selectedShot = projection?.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  const eligible = enabled && projection !== undefined && selectedShot !== undefined
    && projection.projectId === projectId && projection.episodeId === episodeId
  const live = (run: Run) => run.live && runRef.current === run && !run.controller.signal.aborted

  function announce(run: Run, key: QingmuCockpitKey, error = false) {
    if (live(run)) setNotice({ key, error })
  }

  function begin(run: Run, kind: Busy['kind']): Busy | undefined {
    if (!live(run) || busyRef.current !== undefined) return undefined
    const active: Busy = { run, kind }
    busyRef.current = active
    setBusy(active)
    setNotice(undefined)
    return active
  }

  function finish(active: Busy) {
    if (busyRef.current !== active) return
    busyRef.current = undefined
    if (live(active.run)) setBusy(undefined)
  }

  async function acceptReceipt(
    result: YimengTakeVersionSelectionResult,
    intent: TakeVersionSelectionRecoveryMarker,
    run: Run,
  ) {
    if (!receiptMatches(result, intent)) throw new Error('Take selection receipt mismatch')
    if (!live(run)) return
    const expected = { status: 'ready' as const, marker: intent }
    const cleared = clearTakeVersionSelectionMarker(intent, expected)
    setMarker(readTakeVersionSelectionMarker(intent))
    setReceipt(result)
    announce(run, cleared ? 'takeVersionSelectionCommitted' : 'takeVersionMarkerChanged', !cleared)
    // The receipt is evidence only. The visible stack always comes from a new authoritative GET.
    setRefresh(value => value + 1)
  }

  async function performRecovery(active: Busy, intent: TakeVersionSelectionRecoveryMarker) {
    active.kind = 'recover'
    if (live(active.run)) setBusy({ run: active.run, kind: 'recover' })
    autoRecoveryRef.current = intent.idempotencyKey
    try {
      const recovered = await port.recoverTakeVersionSelection(
        requestFromMarker(intent),
        active.run.controller.signal,
      )
      if (!live(active.run)) return
      if (recovered.status === 'committed' && recovered.result !== null) {
        await acceptReceipt(recovered.result, intent, active.run)
      } else if (recovered.status === 'not_found' && recovered.result === null) {
        announce(active.run, 'takeVersionSelectionUnknown', true)
      } else {
        throw new Error('Take selection recovery mismatch')
      }
    } catch {
      announce(active.run, 'takeVersionRecoveryError', true)
    }
  }

  useEffect(() => {
    const stored = readTakeVersionSelectionMarker(scope)
    setMarker(stored)
    if (!eligible || projection === undefined || selectedShot === undefined) {
      setState(undefined)
      return
    }
    const run: Run = { source: projection, port, refresh, controller: new AbortController(), live: true }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    setState({ run, status: 'loading' })
    void (async () => {
      try {
        const stack = await port.takeVersions(scope, run.controller.signal)
        if (!live(run)) return
        if (stack.subject.projectId !== projectId || stack.subject.episodeId !== episodeId
          || stack.subject.frameId !== selectedShotId || stack.subject.frameNo !== selectedShot.frameNo
          || stack.subject.storyboardRevision !== projection.director.shotRelations.storyboardRevision.episodeRevision
          || stack.boundaries.selectedIsApproval !== false || stack.boundaries.formalApprovalChanged !== false
          || stack.boundaries.providerAuthority !== 'not_granted') {
          throw new Error('Take version stack does not match the visible Shot')
        }
        setCompareTakeIds((previous) => {
          const available = new Set(stack.subject.versions.map(version => version.takeId))
          const retained = previous.filter(takeId => available.has(takeId)).slice(0, 2)
          if (retained.length > 0) return retained
          const selected = stack.subject.selectedTakeId === null ? [] : [stack.subject.selectedTakeId]
          const second = stack.subject.versions.find(version => !selected.includes(version.takeId))
          return second === undefined ? selected : [...selected, second.takeId].slice(0, 2)
        })
        setState({ run, status: 'ready', stack })
      } catch {
        if (live(run)) setState({ run, status: 'error' })
      }
    })()
    if (stored.status === 'ready' && autoRecoveryRef.current !== stored.marker.idempotencyKey) {
      const active = begin(run, 'recover')
      if (active !== undefined) void performRecovery(active, stored.marker).finally(() => { finish(active) })
    }
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [eligible, episodeId, port, projectId, projection, refresh, selectedShot, selectedShotId])

  const current = eligible && state?.run.source === projection && state.run.port === port && state.run.refresh === refresh
    ? state : undefined
  const stack = current?.status === 'ready' ? current.stack : undefined
  const activeBusy = busy !== undefined && live(busy.run) ? busy : undefined
  const compared = stack?.subject.versions.filter(version => compareTakeIds.includes(version.takeId)) ?? []
  const loading = eligible && (current === undefined || current.status === 'loading')

  function toggleCompare(takeId: string) {
    setCompareTakeIds((previous) => {
      if (previous.includes(takeId)) return previous.filter(item => item !== takeId)
      if (previous.length >= 2) {
        const run = runRef.current
        if (run !== undefined) announce(run, 'takeVersionCompareLimit')
        return previous
      }
      return [...previous, takeId]
    })
  }

  async function selectVersion(candidate: YimengTakeVersion) {
    const run = runRef.current
    if (run === undefined || stack === undefined || marker.status !== 'none'
      || !stack.capabilities.canSelect || !candidate.canAttemptSelection
      || !candidate.lineageComplete || candidate.outputSha256 === null) return
    const active = begin(run, 'select')
    if (active === undefined) return
    let stored: TakeVersionSelectionRecoveryMarker | undefined
    try {
      stored = await createTakeVersionSelectionMarker({
        ...scope,
        expectedStackSha256: stack.stackSnapshotSha256,
        expectedSelectedTakeId: stack.subject.selectedTakeId,
        candidateTakeId: candidate.takeId,
        candidateVersionOrdinal: candidate.versionOrdinal,
        candidateOutputSha256: candidate.outputSha256,
      })
      if (!live(run)) return
      if (!writeTakeVersionSelectionMarker(stored)) {
        setMarker(readTakeVersionSelectionMarker(scope))
        announce(run, 'takeVersionStorageFailed', true)
        return
      }
      setMarker({ status: 'ready', marker: stored })
      try {
        const result = await port.selectTakeVersion(requestFromMarker(stored), run.controller.signal)
        if (live(run)) await acceptReceipt(result, stored, run)
      } catch {
        if (live(run)) await performRecovery(active, stored)
      }
    } catch {
      if (live(run)) announce(run, stored === undefined ? 'takeVersionStorageFailed' : 'takeVersionSelectionUnknown', true)
    } finally {
      finish(active)
    }
  }

  function recover() {
    const run = runRef.current
    if (run === undefined || marker.status !== 'ready') return
    const active = begin(run, 'recover')
    if (active !== undefined) void performRecovery(active, marker.marker).finally(() => { finish(active) })
  }

  function discard() {
    const run = runRef.current
    if (run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearTakeVersionSelectionMarker(scope, marker)
    setMarker(readTakeVersionSelectionMarker(scope))
    announce(run, cleared ? 'takeVersionRecoveryDiscarded' : 'takeVersionMarkerChanged', !cleared)
  }

  return <section className={`${card.card} ${css.panel}`} aria-label={t('takeVersionTitle')}>
    <div className={css.header}>
      <div><h3>{t('takeVersionTitle')}</h3><p>{t('takeVersionBoundary')}</p></div>
      <button type="button" disabled={!eligible || loading || activeBusy !== undefined}
        onClick={() => { setRefresh(value => value + 1) }}>{t('takeVersionRefresh')}</button>
    </div>
    {!eligible && enabled && <p>{t('takeVersionChooseShot')}</p>}
    {loading && <p role="status">{t('takeVersionLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>{t('takeVersionLoadError')}</p>}
    {notice !== undefined && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? card.warning : css.notice}>
      {t(notice.key)}
    </p>}
    {marker.status !== 'none' && eligible && <div className={css.recovery}>
      <strong>{t('takeVersionRecoveryTitle')}</strong>
      <p>{t(marker.status === 'ready' ? 'takeVersionRecoveryHelp' : 'takeVersionRecoveryInvalid')}</p>
      {marker.status === 'ready' && <button type="button" disabled={activeBusy !== undefined} onClick={recover}>
        {t(activeBusy?.kind === 'recover' ? 'takeVersionRecovering' : 'takeVersionRecover')}
      </button>}
      <details><summary>{t('takeVersionDiscardRecovery')}</summary><p>{t('takeVersionDiscardHelp')}</p>
        <button type="button" disabled={activeBusy !== undefined} onClick={discard}>{t('takeVersionDiscardRecovery')}</button>
      </details>
    </div>}
    {receipt !== undefined && <p className={css.receipt} role="status">
      {t('takeVersionReceipt')} · <code>{receipt.commandReceiptId}</code> · v{receipt.selectedTake.versionOrdinal}
    </p>}
    {stack !== undefined && <div className={css.body}>
      <div className={css.stackHeader}>
        <div><strong>Shot #{stack.subject.frameNo}</strong><span><code>{stack.subject.frameId}</code></span></div>
        <div><span>{t('takeVersionSelectionRevision')}</span><strong>{stack.subject.selectionRevision}</strong></div>
        <div><span>{t('takeVersionStackSha')}</span><code>{stack.stackSnapshotSha256}</code></div>
      </div>
      <p className={css.boundary}>{t('takeVersionSelectedNotApproval')}</p>
      {stack.subject.versions.length === 0 ? <p role="status">{t('takeVersionNoVersions')}</p> : <>
        <div className={css.versionBar} aria-label={t('takeVersionStack')}>
          {stack.subject.versions.map(version => <button key={version.takeId} type="button"
            aria-pressed={compareTakeIds.includes(version.takeId)} onClick={() => { toggleCompare(version.takeId) }}>
            v{version.versionOrdinal}{version.isSelected ? ` · ${t('takeVersionSelectedBadge')}` : ''}
          </button>)}
        </div>
        <p className={css.compareHelp}>{t('takeVersionCompareHelp')}</p>
        <div className={css.compareGrid} role="region" aria-label={t('takeVersionCompare')}>
          {compared.map(version => <TakeCard key={version.takeId} version={version} canSelect={stack.capabilities.canSelect}
            busy={activeBusy !== undefined || marker.status !== 'none'} onSelect={selectVersion} t={t} />)}
        </div>
      </>}
      {!stack.capabilities.canSelect && <p className={css.boundary}>{t('takeVersionCannotSelect')}</p>}
      <details className={css.details}>
        <summary>{t('takeVersionAuthority')}</summary>
        <p>{t('takeVersionAuthorityBody')}</p>
        <dl><div><dt>{t('takeVersionFrameSha')}</dt><dd><code>{stack.subject.frameContentSha256}</code></dd></div>
          <div><dt>{t('takeVersionStoryboardRevision')}</dt><dd>{stack.subject.storyboardRevision}</dd></div></dl>
      </details>
    </div>}
  </section>
}

function TakeCard({
  version, canSelect, busy, onSelect, t,
}: {
  readonly version: YimengTakeVersion
  readonly canSelect: boolean
  readonly busy: boolean
  readonly onSelect: (version: YimengTakeVersion) => Promise<void>
  readonly t: (key: QingmuCockpitKey) => string
}) {
  const selectionAllowed = canSelect && version.canAttemptSelection && version.lineageComplete && !busy
  return <article className={css.take} data-selected={version.isSelected ? 'true' : 'false'}>
    <header><div><strong>v{version.versionOrdinal}</strong><span>{version.source}</span></div>
      {version.isSelected && <mark>{t('takeVersionSelectedBadge')}</mark>}</header>
    <dl>
      <div><dt>{t('takeVersionTakeId')}</dt><dd><code>{version.takeId}</code></dd></div>
      <div><dt>{t('takeVersionDuration')}</dt><dd>{version.durationSec === null ? t('unknown') : `${version.durationSec}s`}</dd></div>
      <div><dt>{t('takeVersionCost')}</dt><dd>{version.estimatedCny === null ? t('unknown') : `¥${version.estimatedCny}`}</dd></div>
      <div><dt>{t('takeVersionQuality')}</dt><dd>{version.qualityStatus} · {version.qualityCheckCount}</dd></div>
      <div><dt>{t('takeVersionBinding')}</dt><dd>{version.outputBindingStatus}</dd></div>
      <div><dt>{t('takeVersionLineage')}</dt><dd>{t(version.lineageComplete ? 'takeVersionLineageComplete' : 'takeVersionLineageIncomplete')}</dd></div>
    </dl>
    {version.blockers.length > 0 && <div className={css.blockers}><strong>{t('takeVersionBlockers')}</strong>
      <ul>{version.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
    <details><summary>{t('takeVersionEvidence')}</summary><dl>
      <div><dt>{t('takeVersionProvider')}</dt><dd>{version.provider ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionModel')}</dt><dd>{version.model ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionTask')}</dt><dd><code>{version.taskId ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionProviderTask')}</dt><dd><code>{version.providerTaskId ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionRoute')}</dt><dd>{version.routeKey ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionInputHash')}</dt><dd><code>{version.inputHash ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionOutputHash')}</dt><dd><code>{version.outputSha256 ?? t('unknown')}</code></dd></div>
    </dl></details>
    {!version.isSelected && <button className={css.select} type="button" disabled={!selectionAllowed}
      onClick={() => { void onSelect(version) }}>{t('takeVersionSelectButton')}</button>}
  </article>
}
