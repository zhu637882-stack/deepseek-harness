import { useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengReadPort, YimengCapabilityCatalogItem, YimengCapabilityCatalogResponse,
  YimengCostRehearsalResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './GenerationCostRehearsal.module.css'

const CAPABILITY = 'video.visual'
const CANDIDATE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const

interface GenerationCostRehearsalProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly catalog: YimengCapabilityCatalogResponse | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengReadPort, 'capabilityCatalog' | 'costRehearsal'>
  readonly t: (key: QingmuCockpitKey) => string
}

type RehearsalState = {
  readonly key: string
  readonly status: 'loading'
} | {
  readonly key: string
  readonly status: 'ready'
  readonly result: YimengCostRehearsalResponse
} | {
  readonly key: string
  readonly status: 'error'
  readonly message: string
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

function supportedItems(catalog: YimengCapabilityCatalogResponse | undefined): readonly YimengCapabilityCatalogItem[] {
  return catalog?.items.filter(item => item.snapshot.enabled
    && item.snapshot.consistency.capabilities.includes(CAPABILITY)
    && item.snapshot.controls.length > 0
    && stringArray(item.snapshot.geometry.resolutions).length > 0) ?? []
}

function defaultControl(controls: readonly string[]): string {
  return controls.includes(CAPABILITY) ? CAPABILITY : controls[0] ?? ''
}

function candidateLimit(item: YimengCapabilityCatalogItem | undefined): number {
  const declared = item?.snapshot.geometry.max_outputs
  return typeof declared === 'number' && Number.isInteger(declared)
    ? Math.min(CANDIDATE_COUNTS.length, Math.max(1, declared))
    : CANDIDATE_COUNTS.length
}

function microsToCny(micros: number): string {
  const whole = Math.floor(micros / 1_000_000)
  const fraction = String(micros % 1_000_000).padStart(6, '0')
  return `${String(whole)}.${fraction}`
}

/**
 * Explicit zero-fee rehearsal for one Yimeng-owned storyboard frame.
 * It can only read capability hashes and a dry-run receipt; it cannot reserve, submit, or call a Provider.
 */
export function GenerationCostRehearsal({
  projectId, episodeId, selectedShotId, catalog, enabled, port, t,
}: GenerationCostRehearsalProps) {
  const [modelId, setModelId] = useState('')
  const [control, setControl] = useState('')
  const [resolution, setResolution] = useState('')
  const [candidateCount, setCandidateCount] = useState(1)
  const [state, setState] = useState<RehearsalState>()
  const controllerRef = useRef<AbortController>()

  const items = supportedItems(catalog)
  const selectedItem = items.find(item => item.snapshot.modelId === modelId) ?? items[0]
  const controls = selectedItem?.snapshot.controls ?? []
  const selectedControl = controls.includes(control) ? control : defaultControl(controls)
  const resolutions = stringArray(selectedItem?.snapshot.geometry.resolutions)
  const selectedResolution = resolutions.includes(resolution) ? resolution : resolutions[0] ?? ''
  const maximumCandidateCount = candidateLimit(selectedItem)
  const selectedCandidateCount = Math.min(candidateCount, maximumCandidateCount)
  const requestKey = JSON.stringify([
    projectId, episodeId, selectedShotId, selectedItem?.snapshot.modelId ?? '', selectedControl,
    selectedResolution, selectedCandidateCount, catalog?.catalogSnapshotSha256 ?? '', enabled,
  ])
  const current = state?.key === requestKey ? state : undefined
  const loading = current?.status === 'loading'
  const canRun = enabled && projectId !== '' && episodeId !== '' && selectedShotId !== ''
    && selectedItem !== undefined && selectedControl !== '' && selectedResolution !== '' && !loading

  useEffect(() => () => { controllerRef.current?.abort() }, [])

  function reset() {
    controllerRef.current?.abort()
    controllerRef.current = undefined
    setState(undefined)
  }

  async function rehearse() {
    if (!canRun) return
    reset()
    const controller = new AbortController()
    controllerRef.current = controller
    const key = requestKey
    setState({ key, status: 'loading' })
    try {
      const requestedControls = [selectedControl]
      const exactCatalog = await port.capabilityCatalog({
        modelId: selectedItem.snapshot.modelId,
        capability: CAPABILITY,
        requestedControls,
      }, controller.signal)
      if (controller.signal.aborted) return
      if (exactCatalog.items.length !== 1) throw new Error(t('costRehearsalCatalogMismatch'))
      const exactItem = exactCatalog.items[0]
      if (exactItem === undefined || exactItem.snapshot.modelId !== selectedItem.snapshot.modelId) {
        throw new Error(t('costRehearsalCatalogMismatch'))
      }
      const result = await port.costRehearsal({
        projectId,
        episodeId,
        frameId: selectedShotId,
        modelId: exactItem.snapshot.modelId,
        capability: CAPABILITY,
        requestedControls,
        resolution: selectedResolution,
        candidateCount: selectedCandidateCount,
        capabilityCatalog: exactCatalog,
        catalogSnapshotSha256: exactCatalog.catalogSnapshotSha256,
        requestSnapshotSha256: exactCatalog.requestSnapshotSha256,
        preflightSnapshotSha256: exactCatalog.preflightSnapshotSha256,
        capabilitySnapshotSha256: exactItem.capabilitySnapshotSha256,
      }, controller.signal)
      if (controllerRef.current !== controller) return
      setState({ key, status: 'ready', result })
    } catch (cause) {
      if (!controller.signal.aborted) {
        setState({ key, status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined
    }
  }

  const result = current?.status === 'ready' ? current.result : undefined
  const reservation = result?.reservationRehearsal

  return <section
    className={`${card.card} ${css.rehearsal}`}
    aria-label={t('costRehearsalTitle')}
    aria-busy={loading}
  >
    <header className={css.header}>
      <div>
        <h3>{t('costRehearsalTitle')}</h3>
        <p>{t('costRehearsalBoundary')}</p>
      </div>
      <span>{t('costRehearsalDryRun')}</span>
    </header>

    {selectedShotId === '' && <p role="status" className={css.notice}>{t('costRehearsalSelectShot')}</p>}
    {catalog !== undefined && items.length === 0 && <p role="status" className={css.notice}>
      {t('costRehearsalNoModels')}
    </p>}

    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void rehearse() }}>
      <label className={css.field}>
        <span>{t('costRehearsalModel')}</span>
        <select disabled={!enabled || items.length === 0 || loading} value={selectedItem?.snapshot.modelId ?? ''}
          onChange={(event) => {
            const item = items.find(candidate => candidate.snapshot.modelId === event.target.value)
            setModelId(event.target.value)
            setControl(defaultControl(item?.snapshot.controls ?? []))
            setResolution(stringArray(item?.snapshot.geometry.resolutions)[0] ?? '')
            setCandidateCount(value => Math.min(value, candidateLimit(item)))
            reset()
          }}>
          {items.length === 0 && <option value="">—</option>}
          {items.map(item => <option key={item.capabilitySnapshotId} value={item.snapshot.modelId}>
            {item.snapshot.displayName}
          </option>)}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('costRehearsalControl')}</span>
        <select disabled={!enabled || controls.length === 0 || loading} value={selectedControl}
          onChange={(event) => { setControl(event.target.value); reset() }}>
          {controls.length === 0 && <option value="">—</option>}
          {controls.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('costRehearsalResolution')}</span>
        <select disabled={!enabled || resolutions.length === 0 || loading} value={selectedResolution}
          onChange={(event) => { setResolution(event.target.value); reset() }}>
          {resolutions.length === 0 && <option value="">—</option>}
          {resolutions.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className={css.field}>
        <span>{t('costRehearsalCandidateCount')}</span>
        <select disabled={!enabled || loading} value={selectedCandidateCount}
          onChange={(event) => { setCandidateCount(Number(event.target.value)); reset() }}>
          {CANDIDATE_COUNTS.slice(0, maximumCandidateCount).map(value =>
            <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button className={css.action} type="submit" disabled={!canRun}>
        {loading ? t('costRehearsalLoading') : t('costRehearsalAction')}
      </button>
    </form>

    {current?.status === 'error' && <p role="alert" className={card.warning}>
      {t('costRehearsalError')}: {current.message}
    </p>}

    {result !== undefined && reservation !== undefined && <div className={css.result}>
      <div className={reservation.status === 'READY_NOT_RESERVED_DRY_RUN' ? css.ready : css.blocked} role="status">
        <strong>{reservation.status === 'READY_NOT_RESERVED_DRY_RUN'
          ? t('costRehearsalReady') : t('costRehearsalBlocked')}</strong>
        <span>{t('costRehearsalNotReserved')}</span>
      </div>
      <div className={css.summary}>
        <article><span>{t('costRehearsalEstimate')}</span><strong>¥{result.costEstimate.maximumCostCny}</strong></article>
        <article><span>{t('costRehearsalProposed')}</span><strong>¥{microsToCny(reservation.proposedReservationMicros)}</strong></article>
        <article><span>{t('costRehearsalFormal')}</span><strong>¥{microsToCny(reservation.formallyReservedMicros)}</strong></article>
        <article><span>{t('costRehearsalActual')}</span><strong>{t('costRehearsalActualUnavailable')}</strong></article>
      </div>
      <dl className={css.facts}>
        <div><dt>{t('costRehearsalDuration')}</dt><dd>{(result.subject.durationMillis / 1000).toFixed(3)} s</dd></div>
        <div><dt>{t('costRehearsalBudgetRemaining')}</dt><dd>¥{microsToCny(result.budgetWindow.windowRemainingMicros)}</dd></div>
        <div><dt>{t('costRehearsalProjectQuota')}</dt><dd>{t('costRehearsalNotConfigured')}</dd></div>
        <div><dt>{t('costRehearsalEpisodeQuota')}</dt><dd>{t('costRehearsalNotConfigured')}</dd></div>
      </dl>
      <div className={css.blockers}>
        <h4>{t('costRehearsalBlockers')}</h4>
        {reservation.blockers.length === 0
          ? <p>{t('costRehearsalNoBlockers')}</p>
          : <ul>{reservation.blockers.map(blocker => <li key={blocker}><code>{blocker}</code></li>)}</ul>}
      </div>
      <details className={css.evidence}>
        <summary>{t('costRehearsalEvidence')}</summary>
        <dl>
          <div><dt>{t('costRehearsalFrameSha')}</dt><dd><code>{result.subject.subjectSnapshotSha256}</code></dd></div>
          <div><dt>{t('costRehearsalCatalogSha')}</dt><dd><code>{result.capabilityBinding.catalogSnapshotSha256}</code></dd></div>
          <div><dt>{t('costRehearsalCapabilitySha')}</dt><dd><code>{result.capabilityBinding.capabilitySnapshotSha256}</code></dd></div>
          <div><dt>{t('costRehearsalReceiptSha')}</dt><dd><code>{result.rehearsalSnapshotSha256}</code></dd></div>
        </dl>
      </details>
      <p className={css.zero}>{t('costRehearsalZeroAuthority')}</p>
    </div>}
  </section>
}
