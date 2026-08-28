/* oxlint-disable typescript/no-unnecessary-condition -- Keep runtime OPEN/current/authority guards at the private RPC UI boundary. */
import { useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort, YimengShotFinding } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  type ReworkRouteAuthority, type ReworkRouteCoordinates, verifyReworkRouteAuthority,
  verifyReworkRouteReceipt, verifyReworkRouteRecovery,
} from './rework-route-contract.ts'
import {
  clearReworkRouteMarker, createReworkRouteMarker, readReworkRouteMarker, writeReworkRouteMarker,
  type ReworkRouteRecoveryMarker, type ReworkRouteRecoveryRead,
} from './rework-route-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './ShotFindingView.module.css'

type RoutePort = Pick<QingmuYimengPort,
  'reworkRouteSource' | 'reworkRouteMethod' | 'recordReworkRoute' | 'recoverReworkRoute' | 'probeReworkRouteAuthority'>

interface ReworkRouteControlProps extends ReworkRouteCoordinates {
  readonly finding: YimengShotFinding
  readonly currentBinding: boolean
  readonly port: RoutePort
  readonly t: (key: QingmuCockpitKey) => string
}

interface Run {
  readonly coordinates: ReworkRouteCoordinates
  readonly finding: YimengShotFinding
  readonly currentBinding: boolean
  readonly port: RoutePort
  readonly controller: AbortController
  readonly sequence: number
  live: boolean
}
type State =
  | { readonly status: 'historical' | 'recovery' | 'loading' | 'unavailable' }
  | { readonly status: 'ready'; readonly authority: ReworkRouteAuthority }
interface Busy { readonly run: Run; readonly kind: 'record' | 'recover' }
interface Notice { readonly key: QingmuCockpitKey; readonly error: boolean }

function sameCoordinates(left: ReworkRouteCoordinates, right: ReworkRouteCoordinates) {
  return left.projectId === right.projectId && left.episodeId === right.episodeId
    && left.frameId === right.frameId && left.findingId === right.findingId
}

/** One Finding-scoped route recorder. It never executes rework or derives authority from a command receipt. */
export function ReworkRouteControl(props: ReworkRouteControlProps) {
  const { projectId, episodeId, frameId, findingId, finding, currentBinding, port, t } = props
  const coordinates = { projectId, episodeId, frameId, findingId }
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<State>({ status: currentBinding ? 'loading' : 'historical' })
  const [marker, setMarker] = useState<ReworkRouteRecoveryRead>(() => readReworkRouteMarker(coordinates))
  const [busy, setBusy] = useState<Busy>()
  const [notice, setNotice] = useState<Notice>()
  const runRef = useRef<Run | undefined>(undefined)
  const busyRef = useRef<Busy | undefined>(undefined)
  const visibleRef = useRef({ coordinates, finding, port, currentBinding, reload })
  visibleRef.current = { coordinates, finding, port, currentBinding, reload }

  const live = (run: Run) => {
    const visible = visibleRef.current
    return run.live && runRef.current === run && !run.controller.signal.aborted
      && sameCoordinates(run.coordinates, visible.coordinates) && run.finding === visible.finding
      && run.currentBinding === visible.currentBinding && run.port === visible.port && run.sequence === visible.reload
  }

  async function readAuthority(run: Run): Promise<ReworkRouteAuthority> {
    const method = await run.port.reworkRouteMethod(run.coordinates, run.controller.signal)
    if (!live(run)) throw new Error('Route view changed')
    const sourceRequest = {
      ...run.coordinates,
      routeRulesSha256: method.projection.rulesSha256,
      planRulesSha256: method.projection.subject.sealedPlan.rulesSha256,
      lockRulesSha256: method.projection.lockRulesSha256,
    }
    const [probe, source] = await Promise.all([
      run.port.probeReworkRouteAuthority(run.coordinates, run.controller.signal),
      run.port.reworkRouteSource(sourceRequest, run.controller.signal),
    ])
    if (!live(run)) throw new Error('Route view changed')
    const authority = { method, source, probe }
    await verifyReworkRouteAuthority(authority, run.coordinates, run.finding)
    if (!live(run)) throw new Error('Route view changed')
    return authority
  }

  useEffect(() => {
    const stored = readReworkRouteMarker(coordinates)
    setMarker(stored)
    setNotice(undefined)
    const run: Run = {
      coordinates, finding, currentBinding, port, controller: new AbortController(), sequence: reload, live: true,
    }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    if (!currentBinding || finding.status !== 'OPEN') {
      setState(stored.status === 'none' ? { status: 'historical' } : { status: 'recovery' })
    } else if (stored.status !== 'none') {
      // An unresolved original intent gets a GET-only recovery path. Do not fetch a fresh Method first.
      setState({ status: 'recovery' })
    } else {
      setState({ status: 'loading' })
      void (async () => {
        try {
          const authority = await readAuthority(run)
          if (live(run)) setState({ status: 'ready', authority })
        } catch {
          if (live(run)) setState({ status: 'unavailable' })
        }
      })()
    }
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [projectId, episodeId, frameId, findingId, finding, currentBinding, port, reload])

  const authority = state.status === 'ready' ? state.authority : undefined
  const activeBusy = busy !== undefined && live(busy.run) ? busy : undefined
  const currentRoute = authority?.source.latestRouteSourceCurrent === true
    && authority.probe.currentRouteRecorded ? authority.source.latestRoute : null
  const latestRoute = authority?.source.latestRoute ?? null
  const headSafe = latestRoute === null || latestRoute.route.revision < Number.MAX_SAFE_INTEGER
  const canRecord = currentBinding && finding.status === 'OPEN' && authority !== undefined
    && authority.source.capabilities.canRecordRoute && currentRoute === null && headSafe
    && marker.status === 'none' && activeBusy === undefined

  function begin(kind: Busy['kind']): Busy | undefined {
    const run = runRef.current
    if (run === undefined || !live(run) || busyRef.current !== undefined) return undefined
    const operation = { run, kind }
    busyRef.current = operation
    setBusy(operation)
    setNotice(undefined)
    return operation
  }
  function finish(operation: Busy) {
    if (busyRef.current === operation) {
      busyRef.current = undefined
      if (live(operation.run)) setBusy(undefined)
    }
  }
  async function acceptReceipt(
    result: Awaited<ReturnType<RoutePort['recordReworkRoute']>>,
    intent: ReworkRouteRecoveryMarker,
    operation: Busy,
  ) {
    await verifyReworkRouteReceipt(result, intent)
    if (!live(operation.run)) return
    // The original receipt settles the original POST independently of today's Method availability.
    const expected: ReworkRouteRecoveryRead = { status: 'ready', marker: intent }
    const cleared = clearReworkRouteMarker(intent, expected)
    if (!cleared) {
      setMarker(readReworkRouteMarker(intent))
      setNotice({ key: 'findingRouteMarkerChanged', error: true })
    } else {
      setMarker({ status: 'none' })
    }
    if (!operation.run.currentBinding || operation.run.finding.status !== 'OPEN') {
      setState({ status: 'historical' })
      if (cleared) setNotice({ key: 'findingRouteHistoricalReceiptConfirmed', error: false })
      return
    }
    // Never turn the receipt into display authority. Probe and read the current chain independently.
    try {
      const fresh = await readAuthority(operation.run)
      if (!live(operation.run)) return
      setState({ status: 'ready', authority: fresh })
      if (cleared) setNotice({ key: fresh.probe.currentRouteRecorded ? 'findingRouteStored' : 'findingRouteStoredHistorical', error: false })
    } catch {
      if (!live(operation.run)) return
      setState({ status: 'unavailable' })
      if (cleared) setNotice({ key: 'findingRouteReceiptConfirmedAuthorityUnavailable', error: true })
    }
  }
  async function record() {
    if (!canRecord || authority === undefined) return
    const operation = begin('record')
    if (operation === undefined) return
    let sent = false
    try {
      const head = authority.source.latestRoute
      const intent = await createReworkRouteMarker({
        ...coordinates,
        expectedSubjectSha256: authority.method.projection.subjectSnapshotSha256,
        expectedRouteRevision: head?.route.revision ?? 0,
        expectedRouteSha256: head?.routeSha256 ?? null,
      })
      if (!live(operation.run)) return
      if (!writeReworkRouteMarker(intent)) {
        setMarker(readReworkRouteMarker(coordinates))
        setNotice({ key: 'findingRouteStorageFailed', error: true })
        return
      }
      setMarker({ status: 'ready', marker: intent })
      sent = true
      const { schema: _schema, ...request } = intent
      const result = await operation.run.port.recordReworkRoute(request, operation.run.controller.signal)
      if (live(operation.run)) await acceptReceipt(result, intent, operation)
    } catch {
      if (live(operation.run)) setNotice({ key: sent ? 'findingRouteUncertain' : 'findingRouteStorageFailed', error: true })
    } finally { finish(operation) }
  }
  async function recover() {
    if (marker.status !== 'ready') return
    const intent = marker.marker
    const operation = begin('recover')
    if (operation === undefined) return
    try {
      // Original CAS and key only. This endpoint is GET-only and never receives a freshly fetched Method.
      const { schema: _schema, ...request } = intent
      const recovery = await operation.run.port.recoverReworkRoute(request, operation.run.controller.signal)
      if (!live(operation.run)) return
      const result = await verifyReworkRouteRecovery(recovery, intent)
      if (!live(operation.run)) return
      if (result === null) setNotice({ key: 'findingRouteNotFound', error: false })
      else await acceptReceipt(result, intent, operation)
    } catch {
      if (live(operation.run)) setNotice({ key: 'findingRouteRecoveryError', error: true })
    } finally { finish(operation) }
  }
  function discard() {
    const run = runRef.current
    if (run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearReworkRouteMarker(coordinates, marker)
    setMarker(readReworkRouteMarker(coordinates))
    setNotice({ key: cleared ? 'findingRouteDiscarded' : 'findingRouteMarkerChanged', error: !cleared })
    if (cleared) setReload(value => value + 1)
  }

  return <div>
    <p className={css.hint}>{t('findingRouteBoundary')}</p>
    {notice !== undefined && <p className={css.notice} role={notice.error ? 'alert' : 'status'}>{t(notice.key)}</p>}
    {state.status === 'historical' && <p>{t('findingRouteHistoricalFinding')}</p>}
    {state.status === 'loading' && <p role="status">{t('findingRouteLoading')}</p>}
    {state.status === 'unavailable' && <><p role="status">{t('findingRouteUnavailable')}</p>
      {currentBinding && marker.status === 'none' && <button type="button" onClick={() => { setReload(value => value + 1) }}
        disabled={activeBusy !== undefined}>{t('findingRouteRefresh')}</button>}
    </>}
    {marker.status !== 'none' && <div className={css.recovery}>
      <strong>{t('findingRouteRecoveryTitle')}</strong>
      <p>{t(marker.status === 'ready' ? 'findingRouteRecoveryHelp' : 'findingRouteRecoveryInvalid')}</p>
      {marker.status === 'ready' && <button type="button" onClick={() => { void recover() }} disabled={activeBusy !== undefined}>
        {t(activeBusy?.kind === 'recover' ? 'findingRouteRecovering' : 'findingRouteRecover')}
      </button>}
      <details><summary>{t('findingRouteDiscard')}</summary><p>{t('findingRouteDiscardHelp')}</p>
        <button type="button" onClick={discard} disabled={activeBusy !== undefined}>{t('findingRouteDiscard')}</button>
      </details>
    </div>}
    {authority !== undefined && <>
      <dl className={css.evidence}>
        <div><dt>{t('findingRouteUnit')}</dt><dd>{authority.method.projection.subject.productionUnit.unitId}</dd></div>
        <div><dt>{t('findingRoutePlanSeal')}</dt><dd>{authority.method.projection.subject.sealedPlan.sealSha256}</dd></div>
        <div><dt>{t('findingRouteLock')}</dt><dd>{authority.method.projection.subject.sealedPlan.subject.productionBlueprintLock.lockId} · C5F</dd></div>
        <div><dt>{t('findingRouteMethodSha')}</dt><dd>{authority.method.projectionSha256}</dd></div>
        <div><dt>{t('findingRouteLockRulesSha')}</dt><dd>{authority.method.projection.lockRulesSha256}</dd></div>
        {latestRoute !== null && <>
          <div><dt>{t('findingRouteRevision')}</dt><dd>{latestRoute.route.revision}</dd></div>
          <div><dt>{t('findingRouteSha')}</dt><dd>{latestRoute.routeSha256}</dd></div>
        </>}
      </dl>
      <p role="status">{t(currentRoute !== null ? 'findingRouteCurrent' : latestRoute === null
        ? 'findingRouteNotRecorded' : 'findingRouteHistorical')}</p>
      {!authority.source.capabilities.canRecordRoute && <p className={css.hint}>{t('findingRoutePermission')}</p>}
      {!headSafe && <p role="alert">{t('findingRouteRevisionExhausted')}</p>}
      <button className={card.primaryAction} type="button" onClick={() => { void record() }} disabled={!canRecord}>
        {t(activeBusy?.kind === 'record' ? 'findingRoutePosting' : currentRoute === null
          ? 'findingRouteRecord' : 'findingRouteAlreadyRecorded')}
      </button>
    </>}
  </div>
}
