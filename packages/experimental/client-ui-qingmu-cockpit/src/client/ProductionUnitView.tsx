/** Same-Shot scope registration and the existing Finding workflow share one visible context. */
import { useEffect, useId, useRef, useState } from 'react'
import type {
  ImagoProductionUnitMethodResponse, QingmuYimengPort, YimengProductionUnitResult,
  YimengProductionUnitsResponse, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { ShotFindingView } from './ShotFindingView.tsx'
import {
  clearProductionUnitMarker, createProductionUnitMarker, productionUnitGroupsForShot, readProductionUnitMarker,
  validProductionUnitId, verifyProductionUnitFeed, verifyProductionUnitMethod, verifyProductionUnitReceipt,
  verifyProductionUnitRecovery, writeProductionUnitMarker,
  type ProductionUnitRecoveryMarker, type ProductionUnitRecoveryRead,
} from './production-unit-contract.ts'
import card from './QingmuCockpit.module.css'
import css from './ShotFindingView.module.css'

interface ProductionUnitViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengPort, 'shotFindings' | 'shotFindingMethod' | 'recordShotFinding' | 'recoverShotFinding'
    | 'productionUnits' | 'productionUnitMethod' | 'bindProductionUnit' | 'recoverProductionUnitBinding'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface ViewIdentity {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly source: YimengWorkflowProjection | undefined
  readonly port: ProductionUnitViewProps['port']
  readonly refresh: number
  readonly enabled: boolean
}
interface Run extends ViewIdentity {
  readonly controller: AbortController
  live: boolean
}
type ReadState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly feed: YimengProductionUnitsResponse }
)
interface Choice {
  readonly run: Run
  readonly groupId: string
  readonly unitId: string
  readonly confirmed: boolean
}
type MethodState = { readonly run: Run; readonly groupId: string; readonly sourceSha: string } & (
  | { readonly status: 'loading' | 'unavailable' }
  | { readonly status: 'ready'; readonly value: ImagoProductionUnitMethodResponse }
)
interface Operation {
  readonly run: Run
  readonly kind: 'bind' | 'recover'
  readonly selection: number
}
interface Notice {
  readonly source: YimengWorkflowProjection | undefined
  readonly port: ProductionUnitViewProps['port']
  readonly key: QingmuCockpitKey
  readonly error: boolean
}

function sameView(run: ViewIdentity, view: ViewIdentity) {
  return run.projectId === view.projectId && run.episodeId === view.episodeId && run.selectedShotId === view.selectedShotId
    && run.source === view.source && run.port === view.port && run.refresh === view.refresh && run.enabled === view.enabled
}

/**
 * Keep Finding authoring on the selected canonical Shot.
 * @param props - The current selection and existing private Host methods.
 * @returns The same-Shot workspace.
 */
export function ProductionUnitView(props: ProductionUnitViewProps) {
  return <ProductionUnitPanel key={JSON.stringify([props.projectId, props.episodeId, props.selectedShotId])} {...props} />
}

function ProductionUnitPanel(props: ProductionUnitViewProps) {
  const { projectId, episodeId, selectedShotId, projection, enabled, port, t } = props
  const scope = { projectId, episodeId }
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ReadState>()
  const [choice, setChoice] = useState<Choice>()
  const [methodState, setMethodState] = useState<MethodState>()
  const [marker, setMarker] = useState<ProductionUnitRecoveryRead>(() => readProductionUnitMarker(scope))
  const [busy, setBusy] = useState<Operation>()
  const [notice, setNotice] = useState<Notice>()
  const runRef = useRef<Run | undefined>(undefined)
  const busyRef = useRef<Operation | undefined>(undefined)
  const selectionRef = useRef(0)
  const unitInput = useRef<HTMLInputElement>(null)
  const confirmation = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const identity: ViewIdentity = { projectId, episodeId, selectedShotId, source: projection, port, refresh, enabled }
  const visibleRef = useRef(identity)
  visibleRef.current = identity
  const contextEnabled = enabled && projectId !== '' && episodeId !== ''
  const eligible = contextEnabled && projection !== undefined && projection.projectId === projectId
    && projection.episodeId === episodeId
    && projection.director.shotRelations.shots.some(shot => shot.shotId === selectedShotId)
  const live = (run: Run) => run.live && runRef.current === run && !run.controller.signal.aborted
    && sameView(run, visibleRef.current)
  const operationLive = (operation: Operation) => live(operation.run) && selectionRef.current === operation.selection

  useEffect(() => {
    setMarker(readProductionUnitMarker({ projectId, episodeId }))
    setChoice(undefined)
    setMethodState(undefined)
    selectionRef.current += 1
    if (!contextEnabled) {
      setState(undefined)
      return
    }
    const run: Run = { projectId, episodeId, selectedShotId, source: projection, port, refresh, enabled,
      controller: new AbortController(), live: true }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    setState({ run, status: 'loading' })
    setNotice(previous => previous !== undefined && previous.source === projection && previous.port === port ? previous : undefined)
    const current = () => run.live && runRef.current === run && !run.controller.signal.aborted
      && sameView(run, visibleRef.current)
    void (async () => {
      try {
        const feed = await port.productionUnits({ projectId, episodeId }, run.controller.signal)
        if (!current()) return
        await verifyProductionUnitFeed(feed, { projectId, episodeId })
        if (current()) setState({ run, status: 'ready', feed })
      } catch {
        if (current()) setState({ run, status: 'error' })
      }
    })()
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [contextEnabled, projectId, episodeId, selectedShotId, projection, enabled, port, refresh])

  const current = state !== undefined && live(state.run) ? state : undefined
  const feed = eligible && current?.status === 'ready' ? current.feed : undefined
  const groups = feed !== undefined && projection !== undefined ? productionUnitGroupsForShot(feed, projection, selectedShotId) : []
  const selected = choice?.run === current?.run ? groups.find(group => group.groupId === choice?.groupId) : undefined
  const existing = selected === undefined ? undefined : feed?.bindings.find(item => item.binding.groupId === selected.groupId)
  const method = selected !== undefined && methodState !== undefined && current !== undefined
    && methodState.run === current.run && methodState.groupId === selected.groupId
    && methodState.sourceSha === selected.snapshotSha256 && methodState.status === 'ready' ? methodState.value : undefined
  const activeBusy = busy !== undefined && operationLive(busy) ? busy : undefined
  const visibleNotice = contextEnabled && notice !== undefined && notice.source === projection && notice.port === port ? notice : undefined
  const loading = contextEnabled && (current === undefined || current.status === 'loading')
  const duplicateUnit = choice !== undefined && feed?.bindings.some(item => item.binding.unitId === choice.unitId
    && item.binding.groupId !== choice.groupId) === true
  const canBind = eligible && feed?.capabilities.canBindUnit === true && selected !== undefined && method !== undefined
    && choice?.run === current?.run && choice !== undefined && validProductionUnitId(choice.unitId) && !duplicateUnit
    && (existing === undefined || (existing.binding.unitId === choice.unitId && existing.binding.revision < Number.MAX_SAFE_INTEGER))
    && choice.confirmed && marker.status === 'none' && activeBusy === undefined

  useEffect(() => {
    if (selected === undefined || current?.status !== 'ready') return
    const run = current.run
    const group = selected
    const selection = selectionRef.current
    const controller = new AbortController()
    const abort = () => { controller.abort() }
    run.controller.signal.addEventListener('abort', abort, { once: true })
    const currentMethod = () => run.live && runRef.current === run && !run.controller.signal.aborted
      && !controller.signal.aborted && sameView(run, visibleRef.current) && selectionRef.current === selection
    setMethodState({ run, groupId: group.groupId, sourceSha: group.snapshotSha256, status: 'loading' })
    void (async () => {
      try {
        const value = await port.productionUnitMethod({ projectId, episodeId, groupId: group.groupId }, controller.signal)
        if (!currentMethod()) return
        await verifyProductionUnitMethod(value, group)
        if (currentMethod()) setMethodState({ run, groupId: group.groupId, sourceSha: group.snapshotSha256, status: 'ready', value })
      } catch {
        if (currentMethod()) setMethodState({ run, groupId: group.groupId, sourceSha: group.snapshotSha256, status: 'unavailable' })
      }
    })()
    return () => {
      controller.abort()
      run.controller.signal.removeEventListener('abort', abort)
    }
  }, [selected, current, projectId, episodeId, port])

  useEffect(() => {
    if (method === undefined) return
    if (existing === undefined) unitInput.current?.focus()
    else confirmation.current?.focus()
  }, [method, existing])

  function announce(run: Run, key: QingmuCockpitKey, error = false) {
    if (live(run)) setNotice({ source: run.source, port: run.port, key, error })
  }
  function begin(kind: Operation['kind']): Operation | undefined {
    const run = runRef.current
    if (!contextEnabled || run === undefined || !live(run) || busyRef.current !== undefined) return undefined
    const active = { run, kind, selection: selectionRef.current }
    busyRef.current = active
    setBusy(active)
    setNotice(undefined)
    return active
  }
  function finish(active: Operation) {
    if (busyRef.current === active) {
      busyRef.current = undefined
      if (operationLive(active)) setBusy(undefined)
    }
  }
  async function accept(result: YimengProductionUnitResult, intent: ProductionUnitRecoveryMarker, active: Operation) {
    await verifyProductionUnitReceipt(result, intent)
    if (!operationLive(active)) return
    if (!clearProductionUnitMarker(scope, { status: 'ready', marker: intent })) {
      setMarker(readProductionUnitMarker(scope))
      announce(active.run, 'unitMarkerChanged', true)
      return
    }
    setMarker({ status: 'none' })
    announce(active.run, 'unitStored')
    // Receipts never fabricate feed rows or turn a source binding into an approval.
    setRefresh(value => value + 1)
  }
  async function bind() {
    if (!canBind) return
    const active = begin('bind')
    if (active === undefined) return
    let sent = false
    try {
      const intent = await createProductionUnitMarker({ ...scope, groupId: selected.groupId, unitId: choice.unitId,
        expectedSubjectSha256: selected.snapshotSha256, expectedBindingRevision: existing?.binding.revision ?? 0,
        expectedBindingSha256: existing?.bindingSha256 ?? null, methodProjectionSha256: method.projectionSha256,
        rulesSha256: method.projection.rulesSha256 })
      if (!operationLive(active)) return
      if (!writeProductionUnitMarker(intent)) {
        setMarker(readProductionUnitMarker(scope))
        announce(active.run, 'unitStorageFailed', true)
        return
      }
      setMarker({ status: 'ready', marker: intent })
      sent = true
      const result = await port.bindProductionUnit({ ...scope, groupId: intent.groupId, unitId: intent.unitId,
        expectedSubjectSha256: intent.expectedSubjectSha256, expectedBindingRevision: intent.expectedBindingRevision,
        expectedBindingSha256: intent.expectedBindingSha256, idempotencyKey: intent.idempotencyKey,
        methodProjection: method.projection, methodProjectionSha256: method.projectionSha256,
        methodAttestation: method.methodAttestation }, active.run.controller.signal)
      if (operationLive(active)) await accept(result, intent, active)
    } catch {
      if (operationLive(active)) announce(active.run, sent ? 'unitUncertain' : 'unitStorageFailed', true)
    } finally { finish(active) }
  }
  async function recover() {
    if (marker.status !== 'ready') return
    const intent = marker.marker
    const active = begin('recover')
    if (active === undefined) return
    try {
      const response = await port.recoverProductionUnitBinding({
        projectId: intent.projectId, episodeId: intent.episodeId, groupId: intent.groupId, unitId: intent.unitId,
        expectedSubjectSha256: intent.expectedSubjectSha256, idempotencyKey: intent.idempotencyKey,
      }, active.run.controller.signal)
      if (!operationLive(active)) return
      const result = await verifyProductionUnitRecovery(response, intent)
      if (!operationLive(active)) return
      if (result === null) announce(active.run, 'unitNotFound')
      else await accept(result, intent, active)
    } catch {
      if (operationLive(active)) announce(active.run, 'unitRecoveryError', true)
    } finally { finish(active) }
  }
  function discard() {
    const run = runRef.current
    if (!contextEnabled || run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearProductionUnitMarker(scope, marker)
    setMarker(readProductionUnitMarker(scope))
    announce(run, cleared ? 'unitDiscarded' : 'unitMarkerChanged', !cleared)
  }
  function choose(groupId: string) {
    if (current?.status !== 'ready' || !live(current.run) || busyRef.current !== undefined || marker.status !== 'none') return
    selectionRef.current += 1
    setMethodState(undefined)
    setNotice(undefined)
    const group = groups.find(item => item.groupId === groupId)
    setChoice(group === undefined ? undefined : { run: current.run, groupId: group.groupId,
      unitId: current.feed.bindings.find(item => item.binding.groupId === group.groupId)?.binding.unitId ?? '', confirmed: false })
  }

  return <>
    <section className={`${card.card} ${css.panel}`} aria-label={t('unitTitle')}>
      <div className={css.header}>
        <div><h3>{t('unitTitle')}</h3><p className={css.hint}>{t('unitBoundary')}</p></div>
        <button type="button" onClick={() => { setRefresh(value => value + 1) }}
          disabled={!eligible || loading || activeBusy !== undefined}>{t('unitRefresh')}</button>
      </div>
      {!eligible && <p className={css.hint}>{t('unitChoose')}</p>}
      {loading && <p role="status">{t('unitLoading')}</p>}
      {current?.status === 'error' && <p role="alert">{t('unitLoadError')}</p>}
      {visibleNotice !== undefined && <p className={css.notice} role={visibleNotice.error ? 'alert' : 'status'}>{t(visibleNotice.key)}</p>}
      {contextEnabled && marker.status !== 'none' && <div className={css.recovery}>
        <h4>{t('unitRecoveryTitle')}</h4>
        <p>{t(marker.status === 'ready' ? 'unitRecoveryHelp' : 'unitRecoveryInvalid')}</p>
        {marker.status === 'ready' && <>
          <p>{marker.marker.unitId} · {marker.marker.groupId}</p>
          <button type="button" onClick={() => { void recover() }} disabled={activeBusy !== undefined}>
            {t(activeBusy?.kind === 'recover' ? 'unitRecovering' : 'unitRecover')}
          </button>
        </>}
        <details><summary>{t('unitDiscard')}</summary><p>{t('unitDiscardHelp')}</p>
          <button type="button" onClick={discard} disabled={activeBusy !== undefined}>{t('unitDiscard')}</button>
        </details>
      </div>}
      {feed !== undefined && <div className={css.body}>
        {!feed.capabilities.canBindUnit && <p className={css.hint}>{t('unitPermission')}</p>}
        {groups.length === 0 ? <p role="status">{t('unitNoGroup')}</p> : <label className={css.field}>
          <span>{t('unitGroup')}</span>
          <select value={selected?.groupId ?? ''} onChange={(event) => { choose(event.target.value) }}
            disabled={activeBusy !== undefined || marker.status !== 'none'}>
            <option value="">{t('unitGroupChoose')}</option>
            {groups.map(group => <option key={group.groupId} value={group.groupId}>
              #{group.subject.groupNo} · {group.subject.title}
            </option>)}
          </select>
        </label>}
        {selected !== undefined && <details className={css.source}>
          <summary>{t('unitSource')} · {selected.groupId}</summary>
          <dl className={css.evidence}>
            <div><dt>{t('unitGroupNo')}</dt><dd>{selected.subject.groupNo}</dd></div>
            <div><dt>{t('unitRevision')}</dt><dd>{selected.subject.storyboardRevision}</dd></div>
            <div><dt>{t('unitSourceSha')}</dt><dd>{selected.snapshotSha256}</dd></div>
            <div><dt>{t('unitShots')}</dt><dd><ul>{selected.subject.shots.map(shot => <li key={shot.frameId}>
              #{shot.frameNo} · {shot.frameId} · {shot.frameContentSha256}
            </li>)}</ul></dd></div>
            {method !== undefined && <>
              <div><dt>{t('unitMethodSha')}</dt><dd>{method.projectionSha256}</dd></div>
              <div><dt>{t('unitRulesSha')}</dt><dd>{method.projection.rulesSha256}</dd></div>
            </>}
          </dl>
        </details>}
        {selected !== undefined && method === undefined && <p role="status">
          {t(methodState?.status === 'unavailable' ? 'unitMethodUnavailable' : 'unitMethodLoading')}
        </p>}
        {selected !== undefined && method !== undefined && choice !== undefined && <form onSubmit={(event) => {
          event.preventDefault()
          void bind()
        }}>
          <fieldset disabled={!feed.capabilities.canBindUnit || marker.status !== 'none' || activeBusy !== undefined}>
            <legend>{t(existing === undefined ? 'unitBind' : 'unitRebind')}</legend>
            <label className={css.field}><span id={`${helpId}-label`}>{t('unitId')}</span>
              <input ref={unitInput} required value={choice.unitId} readOnly={existing !== undefined}
                aria-labelledby={`${helpId}-label`} aria-describedby={helpId} onChange={(event) => {
                  if (existing === undefined) setChoice({ ...choice, unitId: event.target.value, confirmed: false })
                }} />
              <small id={helpId}>{t(existing === undefined ? 'unitIdHelp' : 'unitExistingId')}</small>
            </label>
            {duplicateUnit && <p role="alert">{t('unitIdConflict')}</p>}
            {existing !== undefined && <p>{t('unitBindingRevision')}: {existing.binding.revision}</p>}
            <label className={css.actions}>
              <input ref={confirmation} type="checkbox" required checked={choice.confirmed} style={{ width: 'auto' }}
                onChange={(event) => { setChoice({ ...choice, confirmed: event.target.checked }) }} />
              <span>{t('unitConfirm')}</span>
            </label>
            <div className={css.actions}><button className={card.primaryAction} type="submit" disabled={!canBind}>
              {t(activeBusy?.kind === 'bind' ? 'unitPosting' : existing === undefined ? 'unitBind' : 'unitRebind')}
            </button></div>
          </fieldset>
        </form>}
        <ul className={css.records} aria-label={t('unitSource')}>
          {feed.bindings.filter(item => item.binding.source.shots.some(shot => shot.frameId === selectedShotId)).map(item => <li
            key={item.binding.unitId} className={css.record}>
            <div className={css.recordHeader}><strong>{item.binding.unitId} · {item.binding.groupId}</strong>
              <span>{t(item.currentBinding && groups.some(group => group.groupId === item.binding.groupId) ? 'unitCurrent' : 'unitHistorical')}</span>
            </div>
            <details><summary>{t('unitBindingRevision')} · {item.binding.revision}</summary>
              <dl className={css.evidence}>
                <div><dt>{t('unitSourceSha')}</dt><dd>{item.binding.sourceSnapshotSha256}</dd></div>
                <div><dt>{t('unitBindingSha')}</dt><dd>{item.bindingSha256}</dd></div>
                <div><dt>{t('unitMethodSha')}</dt><dd>{item.binding.methodProjectionSha256}</dd></div>
                <div><dt>{t('unitRulesSha')}</dt><dd>{item.binding.rulesSha256}</dd></div>
              </dl>
            </details>
          </li>)}
        </ul>
      </div>}
    </section>
    <ShotFindingView {...props} productionUnits={feed} />
  </>
}
