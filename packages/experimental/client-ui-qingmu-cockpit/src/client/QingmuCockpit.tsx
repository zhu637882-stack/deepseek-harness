import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconCloseOutline16, IconDataOutline16, IconRefreshOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  JsonRecord, YimengHealth, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitFace } from './slots.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { AssetWorkbench } from './AssetWorkbench.tsx'
import { PromptIrWorkspace } from './PromptIrWorkspace.tsx'
import { ScriptWorkspace } from './ScriptWorkspace.tsx'
import { ShotRelationsView } from './ShotRelationsView.tsx'
import { ShotRelationMethodView } from './ShotRelationMethodView.tsx'
import { HeroFrameStoryboardCanvas } from './HeroFrameStoryboardCanvas.tsx'
import { WorksetRecommendation } from './WorksetRecommendation.tsx'
import css from './QingmuCockpit.module.css'

export type QingmuCockpitProps = PropsRuntime<'sidebar.footer.action'>
  & InjectFace<QingmuCockpitFace>
  & PropsLocale<'qingmuCockpit'>

type Tab = 'overview' | 'assets' | 'shots' | 'generation' | 'delivery'

const TABS: readonly { readonly id: Tab; readonly label: QingmuCockpitKey }[] = [
  { id: 'overview', label: 'tabOverview' },
  { id: 'assets', label: 'tabAssets' },
  { id: 'shots', label: 'tabShots' },
  { id: 'generation', label: 'tabGeneration' },
  { id: 'delivery', label: 'tabDelivery' },
]

function recordOf(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boolOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function short(value: unknown): string {
  const direct = stringOf(value)
  if (direct !== undefined) return direct
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return '[unavailable]'
  }
}

function projectLabel(project: JsonRecord, fallback: string): string {
  return stringOf(project.name) ?? stringOf(project.title) ?? stringOf(project.id) ?? fallback
}

function episodeLabel(episode: JsonRecord, fallback: string): string {
  const number = numberOf(episode.episodeNumber) ?? numberOf(episode.episode_no)
  const name = stringOf(episode.name) ?? stringOf(episode.title)
  if (number !== undefined && name !== undefined) return `EP${String(number)} · ${name}`
  if (number !== undefined) return `EP${String(number)}`
  return name ?? stringOf(episode.id) ?? fallback
}

function namedItem(item: unknown, fallback: string): string {
  const row = recordOf(item)
  return stringOf(row.name)
    ?? stringOf(row.label)
    ?? stringOf(row.title)
    ?? stringOf(row.reason)
    ?? stringOf(row.message)
    ?? stringOf(row.shotId)
    ?? stringOf(row.id)
    ?? fallback
}

function cny(value: unknown, unknown: string): string {
  const amount = numberOf(value)
  return amount === undefined ? unknown : `¥${amount.toFixed(2)}`
}

function Meta({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={css.metaRow}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

function Metric({ label, value, note }: {
  readonly label: string
  readonly value: string | number
  readonly note?: string
}) {
  return (
    <div className={css.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note !== undefined && <small>{note}</small>}
    </div>
  )
}

function Card({ title, children, className = '' }: {
  readonly title: string
  readonly children: ReactNode
  readonly className?: string | undefined
}) {
  return (
    <section className={`${css.card} ${className}`.trim()}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Qingmu production cockpit mounted in the generic sidebar footer. */
export function QingmuCockpit({ wide, port, t }: QingmuCockpitProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [health, setHealth] = useState<YimengHealth>()
  const [projects, setProjects] = useState<readonly JsonRecord[]>([])
  const [episodes, setEpisodes] = useState<readonly JsonRecord[]>([])
  const [projectId, setProjectId] = useState('')
  const [episodeId, setEpisodeId] = useState('')
  const [projection, setProjection] = useState<YimengWorkflowProjection>()
  const [selectedShotId, setSelectedShotId] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController>()

  const begin = (): { readonly id: number; readonly controller: AbortController } => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    requestRef.current += 1
    return { id: requestRef.current, controller }
  }

  const current = (id: number): boolean => id === requestRef.current

  const refresh = async (): Promise<void> => {
    const request = begin()
    setLoading(true)
    setError(undefined)
    try {
      const [healthResult, projectsResult] = await Promise.allSettled([
        port.health(request.controller.signal),
        port.projects({ page: 1, pageSize: 100 }, request.controller.signal),
      ])
      if (!current(request.id)) return
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
      if (projectsResult.status === 'rejected') throw projectsResult.reason

      const nextProjects = projectsResult.value.items
      setProjects(nextProjects)
      const nextProjectId = nextProjects.some(item => stringOf(item.id) === projectId)
        ? projectId
        : stringOf(nextProjects[0]?.id) ?? ''
      setProjectId(nextProjectId)
      if (nextProjectId === '') {
        setEpisodes([])
        setEpisodeId('')
        setProjection(undefined)
        setSelectedShotId('')
        return
      }

      const episodeResult = await port.episodes({ projectId: nextProjectId }, request.controller.signal)
      if (!current(request.id)) return
      setEpisodes(episodeResult.items)
      const nextEpisodeId = episodeResult.items.some(item => stringOf(item.id) === episodeId)
        ? episodeId
        : stringOf(episodeResult.items[0]?.id) ?? ''
      setEpisodeId(nextEpisodeId)
      if (nextEpisodeId === '') {
        setProjection(undefined)
        setSelectedShotId('')
        return
      }
      const nextProjection = await port.workflow({ projectId: nextProjectId, episodeId: nextEpisodeId }, request.controller.signal)
      if (current(request.id)) setProjection(nextProjection)
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const chooseProject = async (nextProjectId: string): Promise<void> => {
    setProjectId(nextProjectId)
    setEpisodeId('')
    setProjection(undefined)
    setSelectedShotId('')
    if (nextProjectId === '') return
    const request = begin()
    setLoading(true)
    setError(undefined)
    try {
      const result = await port.episodes({ projectId: nextProjectId }, request.controller.signal)
      if (!current(request.id)) return
      setEpisodes(result.items)
      const nextEpisodeId = stringOf(result.items[0]?.id) ?? ''
      setEpisodeId(nextEpisodeId)
      if (nextEpisodeId === '') return
      const nextProjection = await port.workflow({ projectId: nextProjectId, episodeId: nextEpisodeId }, request.controller.signal)
      if (current(request.id)) setProjection(nextProjection)
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const chooseEpisode = async (nextEpisodeId: string): Promise<void> => {
    setEpisodeId(nextEpisodeId)
    setProjection(undefined)
    setSelectedShotId('')
    if (nextEpisodeId === '') return
    const request = begin()
    setLoading(true)
    setError(undefined)
    try {
      const nextProjection = await port.workflow({ projectId, episodeId: nextEpisodeId }, request.controller.signal)
      if (current(request.id)) setProjection(nextProjection)
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const refreshWorkflowProjectionAfterCommit = async (): Promise<YimengWorkflowProjection | undefined> => {
    if (projectId === '' || episodeId === '') return undefined
    const request = begin()
    setLoading(true)
    setError(undefined)
    try {
      const nextProjection = await port.workflow({ projectId, episodeId }, request.controller.signal)
      if (current(request.id)) {
        setProjection(nextProjection)
        return nextProjection
      }
      return undefined
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
      throw cause
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const refreshWorkflowAfterCommit = async (): Promise<void> => {
    await refreshWorkflowProjectionAfterCommit()
  }

  const close = (): void => {
    abortRef.current?.abort()
    requestRef.current += 1
    setLoading(false)
    setOpen(false)
  }

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const shotRelations = projection?.director.shotRelations
  useEffect(() => {
    const relationShots = shotRelations?.shots ?? []
    setSelectedShotId(currentShotId => (
      relationShots.some(shot => shot.shotId === currentShotId)
        ? currentShotId
        : relationShots[0]?.shotId ?? ''
    ))
  }, [projectId, episodeId, shotRelations])

  useEffect(() => {
    if (!open) return
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert
    if (appRoot !== null) appRoot.inert = true
    headingRef.current?.focus()

    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter(node => !node.hidden)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      if (appRoot !== null) appRoot.inert = previousInert ?? false
      queueMicrotask(() => { triggerRef.current?.focus() })
    }
  }, [open])

  const projectionRecord = recordOf(projection)
  const stages = Object.entries(recordOf(projectionRecord.stages))
  const blockers = arrayOf(projectionRecord.blockers)
  const assets = recordOf(projectionRecord.assets)
  const semanticAssets = arrayOf(assets.semanticItems)
  const shots = recordOf(projectionRecord.shots)
  const shotItems = arrayOf(shots.items)
  const video = recordOf(projectionRecord.video)
  const audio = recordOf(projectionRecord.audio)
  const timeline = recordOf(projectionRecord.timeline)
  const budget = recordOf(projectionRecord.budget)
  const release = recordOf(projectionRecord.release)
  const selectedProject = projects.find(item => stringOf(item.id) === projectId)
  const selectedEpisode = episodes.find(item => stringOf(item.id) === episodeId)
  const manifestMatch = health?.runtime.matchesReleaseManifest

  const overview = (
    <div className={css.stack}>
      <WorksetRecommendation
        projectId={projectId}
        episodeId={episodeId}
        projection={projection}
        enabled={open && !loading && error === undefined}
        port={port}
        t={t}
      />
      <Card title={t('stages')}>
        <p>{t('stagesBoundary')}</p>
        {stages.length === 0
          ? <p className={css.empty}>{t('noProjection')}</p>
          : (
            <div className={css.stageGrid}>
              {stages.map(([key, value]) => {
                const stage = recordOf(value)
                const canProceed = boolOf(stage.canProceed) === true
                return (
                  <article className={css.stage} key={key}>
                    <div className={css.cardHead}>
                      <strong>{stringOf(stage.label) ?? key}</strong>
                      <span>{canProceed ? t('ready') : t('notReady')}</span>
                    </div>
                    <dl>
                      <Meta label={t('status')} value={stringOf(stage.status) ?? t('unknown')} />
                      <Meta label={t('data')} value={boolOf(stage.hasData) === true ? t('current') : t('empty')} />
                    </dl>
                    {boolOf(stage.isStale) === true && <p className={css.warning}>{t('stale')}</p>}
                  </article>
                )
              })}
            </div>
          )}
      </Card>
      <Card title={t('blockers')}>
        {blockers.length === 0
          ? <p className={css.empty}>{t('noBlockers')}</p>
          : <ol className={css.list}>{blockers.map((item, index) => (
            <li key={`${String(index)}-${namedItem(item, 'blocker')}`}>{namedItem(item, short(item))}</li>
          ))}</ol>}
      </Card>
    </div>
  )

  const assetView = (
    <div className={css.stack}>
      <ScriptWorkspace
        key={`${projectId}:${episodeId}`}
        projectId={projectId}
        episodeId={episodeId}
        port={port}
        t={t}
        onCommitted={refreshWorkflowAfterCommit}
      />
      <PromptIrWorkspace
        key={`${projectId}:${episodeId}:prompt-ir`}
        projectId={projectId}
        episodeId={episodeId}
        shotItems={shotItems}
        storyboardRevisionId={shotRelations?.storyboardRevision.revisionId ?? ''}
        selectedShotId={selectedShotId}
        onSelectShotId={setSelectedShotId}
        port={port}
        t={t}
        onCommitted={refreshWorkflowAfterCommit}
      />
      <Card title={t('scriptStage')}>
        {(() => {
          const script = recordOf(recordOf(projectionRecord.stages).script)
          return <dl><Meta label={t('status')} value={stringOf(script.status) ?? t('unknown')} /></dl>
        })()}
      </Card>
      <AssetWorkbench
        key={`${projectId}:element-assets`}
        projectId={projectId}
        semanticAssets={semanticAssets}
        port={port}
        t={t}
        onCommitted={refreshWorkflowAfterCommit}
      />
      <Card title={t('assetsTitle')}>
        {semanticAssets.length === 0
          ? <p className={css.empty}>{t('assetsEmpty')}</p>
          : <ul className={css.assetGrid}>{semanticAssets.map((item, index) => {
            const asset = recordOf(item)
            const provenance = recordOf(asset.provenance)
            const accepted = boolOf(provenance.reviewAccepted) === true
            return (
              <li key={stringOf(asset.assetId) ?? String(index)}>
                <span className={css.assetType}>{stringOf(asset.type) ?? t('unknown')}</span>
                <strong>{stringOf(asset.name) ?? t('unknown')}</strong>
                <span>{accepted ? t('humanAccepted') : t('humanPending')}</span>
                <small>{stringOf(provenance.reviewStatus) ?? t('unknown')}</small>
              </li>
            )
          })}</ul>}
      </Card>
    </div>
  )

  const shotView = (
    <div className={css.stack}>
      <Card title={t('shotsTitle')}>
        <div className={css.metrics}>
          <Metric label={t('shotCount')} value={numberOf(shots.count) ?? 0} />
          <Metric label={t('groupCount')} value={numberOf(shots.shotGroupCount) ?? 0} />
          <Metric label={t('segmentCount')} value={numberOf(shots.segmentCount) ?? 0} />
          <Metric label={t('unresolvedAssets')} value={numberOf(shots.unresolvedAssetRefCount) ?? 0} />
        </div>
        {shotRelations === undefined
          ? <p className={css.empty}>{t('noProjection')}</p>
          : (
            <ShotRelationsView
              relations={shotRelations}
              selectedShotId={selectedShotId}
              onSelectShotId={setSelectedShotId}
              t={t}
            />
          )}
        {shotRelations !== undefined && (
          <ShotRelationMethodView
            relations={shotRelations}
            selectedShotId={selectedShotId}
            port={port}
            t={t}
          />
        )}
        {shotRelations !== undefined && (
          <HeroFrameStoryboardCanvas
            relations={shotRelations}
            heroFrameStoryboards={projection?.director.heroFrameStoryboards}
            selectedShotId={selectedShotId}
            port={port}
            t={t}
            onCommitted={refreshWorkflowProjectionAfterCommit}
          />
        )}
      </Card>
    </div>
  )

  const generationView = (
    <div className={css.stack}>
      <Card title={t('generationTitle')}>
        <div className={css.generationGrid}>
          <article>
            <h4>{t('video')}</h4>
            <Metric label={t('candidates')} value={arrayOf(video.candidates).length} />
            <Metric label={t('selected')} value={arrayOf(video.selected).length} />
            <Metric label={t('completed')} value={numberOf(video.completedCount) ?? 0} />
            <p>{boolOf(video.qualityPassed) === true ? t('qualityPassed') : t('qualityUnknown')}</p>
          </article>
          <article>
            <h4>{t('audio')}</h4>
            <Metric label={t('candidates')} value={arrayOf(audio.candidates).length} />
            <Metric label={t('selected')} value={arrayOf(audio.selected).length} />
            <Metric label={t('dialogueLines')} value={numberOf(audio.dialogueLineCount) ?? 0} />
            <p>{boolOf(audio.qualityPassed) === true ? t('qualityPassed') : t('qualityUnknown')}</p>
          </article>
          <article>
            <h4>{t('timeline')}</h4>
            <Metric label={t('data')} value={boolOf(timeline.hasData) === true ? t('current') : t('empty')} />
            <Metric label={t('selected')} value={boolOf(timeline.selected) === true ? t('ready') : t('notReady')} />
            <Metric label={t('outputs')} value={arrayOf(timeline.finalOutputs).length} />
            <p>{boolOf(timeline.qualityPassed) === true ? t('qualityPassed') : t('qualityUnknown')}</p>
          </article>
        </div>
      </Card>
    </div>
  )

  const deliveryView = (
    <div className={css.stack}>
      <Card title={t('budgetTitle')}>
        <p className={css.boundary}>{t('budgetDisclaimer')}</p>
        <div className={css.metrics}>
          <Metric label={boolOf(budget.valid) === true ? t('budgetValid') : t('budgetInvalid')} value={stringOf(budget.window_id) ?? t('unknown')} />
          <Metric label={t('cap')} value={cny(budget.effective_cap_cny, t('unknown'))} />
          <Metric label={t('spent')} value={cny(budget.window_spent_cny, t('unknown'))} />
          <Metric label={t('remaining')} value={cny(budget.window_remaining_cny, t('unknown'))} />
        </div>
        {arrayOf(budget.errors).length > 0 && (
          <ul className={css.list}>{arrayOf(budget.errors).map((item, index) => <li key={String(index)}>{short(item)}</li>)}</ul>
        )}
      </Card>
      <Card title={t('deliveryTitle')}>
        <strong>{boolOf(release.releaseReady) === true ? t('releaseReady') : t('releaseNotReady')}</strong>
        <p className={css.boundary}>{t('releaseDisclaimer')}</p>
      </Card>
    </div>
  )

  const panels: Record<Tab, ReactNode> = {
    overview,
    assets: assetView,
    shots: shotView,
    generation: generationView,
    delivery: deliveryView,
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${css.trigger} ${wide ? css.triggerWide : css.triggerRail}`}
        aria-label={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true)
          void refresh()
        }}
      >
        <IconDataOutline16 size={18} />
        {wide && <span>{t('trigger')}</span>}
      </button>
      <Modal open={open} onClose={close} title={t('title')} headless className={css.dialog as string}>
        <div ref={dialogRef} className={css.shell}>
          <header className={css.header}>
            <div>
              <h2 ref={headingRef} tabIndex={-1}>{t('title')}</h2>
              <p>{t('subtitle')}</p>
            </div>
            <div className={css.headerActions}>
              <button type="button" onClick={() => { void refresh() }} disabled={loading}>
                <IconRefreshOutline16 size={16} />
                <span>{loading ? t('refreshing') : t('refresh')}</span>
              </button>
              <button type="button" className={css.iconButton} aria-label={t('close')} onClick={close}>
                <IconCloseOutline16 size={18} />
              </button>
            </div>
          </header>

          <section className={css.truthStrip} aria-label={t('truthBoundary')}>
            <article>
              <span>{t('truthRuntime')}</span>
              <strong>{health?.liveness === true ? t('truthRuntimeHealthy') : t('truthRuntimeUnknown')}</strong>
              {health !== undefined && (
                <small>{manifestMatch === true
                  ? t('truthManifestMatch')
                  : manifestMatch === false ? t('truthManifestMismatch') : t('truthManifestUnknown')}</small>
              )}
            </article>
            <article>
              <span>{t('truthScope')}</span>
              <strong>{selectedProject === undefined
                ? t('truthScopeEmpty')
                : projectLabel(selectedProject, t('untitledProject'))}</strong>
              {selectedEpisode !== undefined && <small>{episodeLabel(selectedEpisode, t('untitledEpisode'))}</small>}
            </article>
            <article>
              <span>{t('truthBoundary')}</span>
              <strong>{t('truthBoundaryBody')}</strong>
            </article>
          </section>

          <div className={css.toolbar}>
            <label>
              <span>{t('project')}</span>
              <select
                value={projectId}
                onChange={(event) => { void chooseProject(event.target.value) }}
                disabled={loading || projects.length === 0}
              >
                <option value="">{projects.length === 0 ? t('noProjects') : t('chooseProject')}</option>
                {projects.map(project => (
                  <option key={stringOf(project.id)} value={stringOf(project.id)}>
                    {projectLabel(project, t('untitledProject'))}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('episode')}</span>
              <select
                value={episodeId}
                onChange={(event) => { void chooseEpisode(event.target.value) }}
                disabled={loading || episodes.length === 0}
              >
                <option value="">{episodes.length === 0 ? t('noEpisodes') : t('chooseEpisode')}</option>
                {episodes.map(episode => (
                  <option key={stringOf(episode.id)} value={stringOf(episode.id)}>
                    {episodeLabel(episode, t('untitledEpisode'))}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error !== undefined && (
            <section className={css.error} role="alert">
              <div>
                <strong>{t('errorTitle')}</strong>
                <p>{error}</p>
                <small>{t('errorRecovery')}</small>
              </div>
              <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button>
            </section>
          )}
          {loading && <p className={css.loading} role="status">{t('refreshing')}</p>}

          <nav className={css.tabs} aria-label={t('title')} role="tablist">
            {TABS.map(item => (
              <button
                key={item.id}
                id={`qingmu-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`qingmu-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => { setTab(item.id) }}
                onKeyDown={(event) => {
                  const index = TABS.findIndex(candidate => candidate.id === item.id)
                  let nextIndex: number | undefined
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % TABS.length
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + TABS.length) % TABS.length
                  if (event.key === 'Home') nextIndex = 0
                  if (event.key === 'End') nextIndex = TABS.length - 1
                  if (nextIndex === undefined) return
                  event.preventDefault()
                  const next = TABS[nextIndex]
                  if (next === undefined) return
                  setTab(next.id)
                  document.getElementById(`qingmu-tab-${next.id}`)?.focus()
                }}
              >{t(item.label)}</button>
            ))}
          </nav>

          <div className={css.body}>
            <main
              id={`qingmu-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`qingmu-tab-${tab}`}
              tabIndex={0}
            >
              {panels[tab]}
            </main>
            <aside className={css.evidence} aria-label={t('evidence')}>
              <h3>{t('evidence')}</h3>
              <dl>
                <Meta label={t('schema')} value={stringOf(projectionRecord.schema) ?? t('unknown')} />
                <Meta label={t('projectId')} value={(stringOf(projectionRecord.projectId) ?? projectId) || t('unknown')} />
                <Meta label={t('episodeId')} value={(stringOf(projectionRecord.episodeId) ?? episodeId) || t('unknown')} />
                <Meta label={t('fingerprint')} value={stringOf(projectionRecord.inputFingerprint) ?? t('unknown')} />
                <Meta label={t('sourceRevision')} value={short(projectionRecord.sourceRevision) || t('unknown')} />
                <Meta label={t('activeTask')} value={stringOf(projectionRecord.activeTaskId) ?? t('empty')} />
                <Meta label={t('runtimeCommit')} value={health?.runtime.commit ?? t('unknown')} />
                <Meta label={t('buildCommit')} value={stringOf(health?.build?.commit) ?? t('unknown')} />
              </dl>
            </aside>
          </div>
        </div>
      </Modal>
    </>
  )
}
