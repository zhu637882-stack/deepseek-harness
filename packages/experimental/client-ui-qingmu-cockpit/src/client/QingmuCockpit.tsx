import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconCloseOutline16, IconDataOutline16, IconRefreshOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  JsonRecord, YimengCapabilityCatalogResponse, YimengHealth, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitFace } from './slots.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { AssetWorkbench } from './AssetWorkbench.tsx'
import { PromptIrWorkspace } from './PromptIrWorkspace.tsx'
import { SceneReferenceWorkspace } from './SceneReferenceWorkspace.tsx'
import { ScriptWorkspace } from './ScriptWorkspace.tsx'
import { CreateProjectWorkspace, TextImportWorkspace } from './CreationWorkspace.tsx'
import { ProjectLibrary } from './ProjectLibrary.tsx'
import { ShotRelationsView } from './ShotRelationsView.tsx'
import { ShotRelationMethodView } from './ShotRelationMethodView.tsx'
import { HeroFrameStoryboardCanvas } from './HeroFrameStoryboardCanvas.tsx'
import { WorksetRecommendation } from './WorksetRecommendation.tsx'
import { ContinuityDeltaView } from './ContinuityDeltaView.tsx'
import { SelectedVideoReviewView } from './SelectedVideoReviewView.tsx'
import { ProductionUnitView } from './ProductionUnitView.tsx'
import { GenerationCapabilityCatalog } from './GenerationCapabilityCatalog.tsx'
import { GenerationCostRehearsal } from './GenerationCostRehearsal.tsx'
import { GenerationGateAControlEvidence } from './GenerationGateAControlEvidence.tsx'
import { TakeVersionCompareView } from './TakeVersionCompareView.tsx'
import { EpisodeEvidenceLedger } from './EpisodeEvidenceLedger.tsx'
import { EditorialHandoff } from './EditorialHandoff.tsx'
import { WorkingCut } from './WorkingCut.tsx'
import css from './QingmuCockpit.module.css'
import { NativeAssetDesign } from './NativeAssetDesign.tsx'
import { ProjectAssetLibrary } from './ProjectAssetLibrary.tsx'
import { DirectorWorkspace } from './DirectorWorkspace.tsx'
import { NativeDirectorSession } from './NativeDirectorSession.tsx'
import { projectDirectorSessionId } from './native-director-session.ts'
import { ShootingReviewWorkspace } from './ShootingReviewWorkspace.tsx'
import { QingmuApplicationFrame, creativeStepFromSearch, creativeStepLabel, type CreativeStep } from './QingmuApplicationFrame.tsx'

export type QingmuCockpitProps = PropsRuntime<'root'>
  & { readonly wide?: boolean; readonly onOpenTools?: () => void }
  & InjectFace<QingmuCockpitFace>
  & PropsLocale<'qingmuCockpit'>

type Tab = 'overview' | 'director' | 'assets' | 'shots' | 'generation' | 'delivery'
const STEP_TABS: Record<CreativeStep, Tab> = { story: 'overview', assets: 'assets', storyboard: 'director', shooting: 'shots', delivery: 'delivery' }
function creativeStepForTab(tab: Tab): CreativeStep {
  return (Object.entries(STEP_TABS).find(([, value]) => value === tab)?.[0] ?? 'shooting') as CreativeStep
}

const TABS: readonly { readonly id: Tab; readonly label: QingmuCockpitKey }[] = [
  { id: 'overview', label: 'tabOverview' },
  { id: 'director', label: 'tabDirector' },
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

function shootingWorkspaceKey(projectId: string, episodeId: string, field: 'shot' | 'tab'): string {
  return `qingmu:cockpit:shooting-workspace:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(episodeId)}:${field}`
}

function storedShootingWorkspaceValue(projectId: string, episodeId: string, field: 'shot' | 'tab'): string | null {
  try { return localStorage.getItem(shootingWorkspaceKey(projectId, episodeId, field)) } catch { return null }
}

function saveShootingWorkspaceValue(projectId: string, episodeId: string, field: 'shot' | 'tab', value: string): void {
  try { localStorage.setItem(shootingWorkspaceKey(projectId, episodeId, field), value) } catch { /* optional browser restoration only */ }
}

function clearShootingWorkspaceValue(projectId: string, episodeId: string, field: 'shot' | 'tab'): void {
  try { localStorage.removeItem(shootingWorkspaceKey(projectId, episodeId, field)) } catch { /* optional browser restoration only */ }
}

const LAST_PROJECT_KEY = 'qingmu.workspace.last-project.v1'
function rememberedProjectScope(): { projectId: string; episodeId: string } | undefined {
  const query = new URLSearchParams(location.search)
  const projectId = query.get('qingmuProject')
  const episodeId = query.get('qingmuEpisode')
  if (projectId && episodeId) return { projectId, episodeId }
  try {
    const stored = recordOf(JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? 'null'))
    if (typeof stored.projectId === 'string' && typeof stored.episodeId === 'string') return {
      projectId: stored.projectId, episodeId: stored.episodeId,
    }
  } catch { /* A browser hint never grants project access or blocks the saved project list. */ }
  return undefined
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

function isStoryboardRevisionMissing(error: unknown): boolean {
  return errorMessage(error).includes('storyboard_revision_missing')
}

/** Qingmu product workspace; the unregistered modal branch supports older embedded callers. */
export function QingmuCockpit({
  wide, port, directorBridge, nativeDirectorSession, hostSync, entryScope, t, useSessions, applicationShell, onOpenTools,
}: QingmuCockpitProps) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<Tab>(() => applicationShell
    ? STEP_TABS[creativeStepFromSearch(typeof location === 'undefined' ? '' : location.search)]
    : new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('qingmuView') === 'shooting' ? 'shots' : 'director')
  const [shootingAction, setShootingAction] = useState<string>()
  const [referenceDirectorOpen, setReferenceDirectorOpen] = useState(false)
  const referenceDirectorPanel = useRef<HTMLDetailsElement>(null)
  const [shootingActionKind, setShootingActionKind] = useState<'first-frame' | 'select-frame' | 'video'>('video')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [health, setHealth] = useState<YimengHealth>()
  const [projects, setProjects] = useState<readonly JsonRecord[]>([])
  const [episodes, setEpisodes] = useState<readonly JsonRecord[]>([])
  const [projectId, setProjectId] = useState('')
  const [episodeId, setEpisodeId] = useState('')
  const [creating, setCreating] = useState(false)
  const [creationFromLibrary, setCreationFromLibrary] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(() => applicationShell === true && entryScope === undefined && new URLSearchParams(location.search).get('qingmuView') === 'projects')
  const [projection, setProjection] = useState<YimengWorkflowProjection>()
  const [storyboardMissing, setStoryboardMissing] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState('')
  const [generationCatalog, setGenerationCatalog] = useState<YimengCapabilityCatalogResponse>()
  const currentSessionId = useSessions(state => state.current)
  const directorSessionId = currentSessionId === projectDirectorSessionId(projectId) ? currentSessionId : undefined
  const [directorRefresh, setDirectorRefresh] = useState(0)
  const [assetWorkbenchOpen, setAssetWorkbenchOpen] = useState(false)
  const [assetLibraryRefresh, setAssetLibraryRefresh] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const assetWorkbenchRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController>()
  const directorDirty = useRef(false)
  const onDirectorDirty = useCallback((dirty: boolean) => { directorDirty.current = dirty }, [])
  const mayLeaveDirector = (): boolean => !directorDirty.current || window.confirm(t('directorLeaveConfirm'))
  const openCandidateReview = (frameId: string) => {
    if (!mayLeaveDirector()) return
    setSelectedShotId(frameId)
    setCreating(false)
    setTab('shots')
  }
  useEffect(() => {
    if (!applicationShell) return
    const changed = () => {
      if (mayLeaveDirector()) {
        setCreating(false); setProjectsOpen(entryScope === undefined && new URLSearchParams(location.search).get('qingmuView') === 'projects')
        setTab(STEP_TABS[creativeStepFromSearch(location.search)])
        const restored = rememberedProjectScope()
        if (restored && (restored.projectId !== projectId || restored.episodeId !== episodeId)) void refresh(restored)
      }
      else {
        const url = new URL(location.href)
        url.searchParams.set('qingmuView', projectsOpen ? 'projects' : creativeStepForTab(tab))
        if (projectId) url.searchParams.set('qingmuProject', projectId); else url.searchParams.delete('qingmuProject')
        if (episodeId) url.searchParams.set('qingmuEpisode', episodeId); else url.searchParams.delete('qingmuEpisode')
        history.replaceState(history.state, '', url)
      }
    }
    window.addEventListener('popstate', changed)
    return () => { window.removeEventListener('popstate', changed) }
  }, [applicationShell, tab, t, entryScope, projectId, episodeId, projectsOpen])
  useEffect(() => {
    if (!applicationShell) return
    const url = new URL(location.href)
    url.searchParams.set('qingmuView', projectsOpen ? 'projects' : creativeStepForTab(tab))
    history.replaceState(history.state, '', url)
  }, [applicationShell, tab, projectsOpen])
  const handleGenerationCatalog = useCallback((result: YimengCapabilityCatalogResponse | undefined) => {
    setGenerationCatalog(result)
  }, [])

  const begin = (): { readonly id: number; readonly controller: AbortController } => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    requestRef.current += 1
    return { id: requestRef.current, controller }
  }

  const current = (id: number): boolean => id === requestRef.current

  const readWorkflow = async (
    scope: { readonly projectId: string; readonly episodeId: string },
    request: { readonly id: number; readonly controller: AbortController },
  ): Promise<YimengWorkflowProjection | undefined> => {
    try {
      const nextProjection = await port.workflow(scope, request.controller.signal)
      if (current(request.id)) {
        setProjection(nextProjection)
        setStoryboardMissing(false)
        return nextProjection
      }
      return undefined
    } catch (cause) {
      if (current(request.id) && isStoryboardRevisionMissing(cause)) {
        // This is an expected new-project state. Clear only this request's stale
        // projection so a previous revision cannot make the current one look ready.
        setProjection(undefined)
        setSelectedShotId('')
        setStoryboardMissing(true)
        return undefined
      }
      throw cause
    }
  }

  const refresh = async (preferred?: { projectId: string; episodeId: string }): Promise<void> => {
    const request = begin()
    setLoading(true)
    setError(undefined)
    setStoryboardMissing(false)
    const scopeLocked = entryScope !== undefined
    const requestedScope = scopeLocked ? entryScope : preferred ?? (applicationShell && projectId === '' ? rememberedProjectScope() : undefined)
    if (scopeLocked) {
      setProjectId('')
      setEpisodeId('')
      setProjection(undefined)
      setSelectedShotId('')
    }
    try {
      if (requestedScope === null) throw new Error('外层项目与集绑定无效；导演工作区已拒绝载入。')
      const [healthResult, projectsResult] = await Promise.allSettled([
        port.health(request.controller.signal),
        port.projects({ page: 1, pageSize: 100 }, request.controller.signal),
      ])
      if (!current(request.id)) return
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
      if (projectsResult.status === 'rejected') throw projectsResult.reason

      const nextProjects = [...projectsResult.value.items]
      for (let page = 2; page <= projectsResult.value.pagination.pages; page += 1) {
        const result = await port.projects({ page, pageSize: 100 }, request.controller.signal)
        if (!current(request.id)) return
        nextProjects.push(...result.items)
      }
      setProjects(nextProjects)
      const desiredProjectId = requestedScope?.projectId ?? projectId
      const projectExists = nextProjects.some(item => stringOf(item.id) === desiredProjectId)
      if (scopeLocked && !projectExists) throw new Error('外层项目不属于当前登录用户；导演工作区已拒绝回退到其他项目。')
      const nextProjectId = projectExists ? desiredProjectId : stringOf(nextProjects[0]?.id) ?? ''
      if (nextProjectId !== projectId) {
        setProjection(undefined); setSelectedShotId(''); setShootingAction(undefined)
        setEpisodes([]); setEpisodeId(''); setAssetWorkbenchOpen(false)
      }
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
      const desiredEpisodeId = requestedScope?.episodeId ?? episodeId
      const episodeExists = episodeResult.items.some(item => stringOf(item.id) === desiredEpisodeId)
      if (scopeLocked && !episodeExists) throw new Error('外层集不属于当前项目；导演工作区已拒绝回退到其他集。')
      const nextEpisodeId = episodeExists ? desiredEpisodeId : stringOf(episodeResult.items[0]?.id) ?? ''
      if (nextEpisodeId !== episodeId) {
        setProjection(undefined); setSelectedShotId(''); setShootingAction(undefined)
      }
      setEpisodeId(nextEpisodeId)
      if (nextEpisodeId === '') {
        setProjection(undefined)
        setSelectedShotId('')
        return
      }
      await readWorkflow({ projectId: nextProjectId, episodeId: nextEpisodeId }, request)
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const chooseProject = async (nextProjectId: string): Promise<void> => {
    if (entryScope !== undefined) return
    if (!mayLeaveDirector()) return
    const preferredEpisodeId = nextProjectId === projectId ? episodeId : ''
    setCreating(false)
    setProjectsOpen(false)
    setShootingAction(undefined)
    setAssetWorkbenchOpen(false)
    setProjectId(nextProjectId)
    setEpisodes([])
    setEpisodeId('')
    setProjection(undefined)
    setSelectedShotId('')
    if (nextProjectId === '') return
    const request = begin()
    setLoading(true)
    setError(undefined)
    setStoryboardMissing(false)
    try {
      const result = await port.episodes({ projectId: nextProjectId }, request.controller.signal)
      if (!current(request.id)) return
      setEpisodes(result.items)
      const nextEpisodeId = result.items.some(item => stringOf(item.id) === preferredEpisodeId)
        ? preferredEpisodeId : stringOf(result.items[0]?.id) ?? ''
      setEpisodeId(nextEpisodeId)
      if (nextEpisodeId === '') return
      await readWorkflow({ projectId: nextProjectId, episodeId: nextEpisodeId }, request)
    } catch (cause) {
      if (!request.controller.signal.aborted && current(request.id)) setError(errorMessage(cause))
    } finally {
      if (current(request.id)) setLoading(false)
    }
  }

  const chooseEpisode = async (nextEpisodeId: string): Promise<void> => {
    if (entryScope !== undefined) return
    if (!mayLeaveDirector()) return
    setShootingAction(undefined)
    setEpisodeId(nextEpisodeId)
    setProjection(undefined)
    setSelectedShotId('')
    if (nextEpisodeId === '') return
    const request = begin()
    setLoading(true)
    setError(undefined)
    setStoryboardMissing(false)
    try {
      await readWorkflow({ projectId, episodeId: nextEpisodeId }, request)
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
    setStoryboardMissing(false)
    try {
      return await readWorkflow({ projectId, episodeId }, request)
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

  const refreshAssetsAfterCommit = async (): Promise<void> => {
    await refreshWorkflowAfterCommit()
    setAssetLibraryRefresh(previous => previous + 1)
  }

  const openReferenceUpload = useCallback(() => {
    setAssetWorkbenchOpen(true)
  }, [])

  useEffect(() => {
    if (!assetWorkbenchOpen) return
    const frame = requestAnimationFrame(() => {
      const target = assetWorkbenchRef.current
      if (target === null) return
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      target.focus({ preventScroll: true })
    })
    return () => { cancelAnimationFrame(frame) }
  }, [assetWorkbenchOpen])

  const close = (): void => {
    if (!mayLeaveDirector()) return
    abortRef.current?.abort()
    requestRef.current += 1
    setLoading(false)
    setOpen(false)
  }

  useEffect(() => {
    void refresh()
    return () => { abortRef.current?.abort() }
    // The Qingmu build owns this entry and opens its exact cockpit scope once on mount.
  }, [])

  useEffect(() => {
    if (!applicationShell || entryScope !== undefined || loading || !projectId || !episodeId) return
    if (!projects.some(item => stringOf(item.id) === projectId) || !episodes.some(item => stringOf(item.id) === episodeId)) return
    const url = new URL(location.href)
    url.searchParams.set('qingmuProject', projectId)
    url.searchParams.set('qingmuEpisode', episodeId)
    history.replaceState(history.state, '', url)
    try { localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ projectId, episodeId })) }
    catch { /* URL restoration remains available without browser storage. */ }
  }, [applicationShell, entryScope, loading, projectId, episodeId, projects, episodes])

  const shotRelations = projection?.director.shotRelations
  useEffect(() => {
    const relationShots = shotRelations?.shots ?? []
    setSelectedShotId(currentShotId => (
      relationShots.some(shot => shot.shotId === currentShotId)
        ? currentShotId
        : relationShots.some(shot => shot.shotId === storedShootingWorkspaceValue(projectId, episodeId, 'shot'))
          ? storedShootingWorkspaceValue(projectId, episodeId, 'shot') ?? relationShots[0]?.shotId ?? ''
          : relationShots[0]?.shotId ?? ''
    ))
  }, [projectId, episodeId, shotRelations])

  useEffect(() => {
    if (projectId === '' || episodeId === '' || selectedShotId === '') return
    if (!shotRelations?.shots.some(shot => shot.shotId === selectedShotId)) return
    saveShootingWorkspaceValue(projectId, episodeId, 'shot', selectedShotId)
  }, [episodeId, projectId, selectedShotId, shotRelations])

  useEffect(() => {
    if (applicationShell || projectId === '' || episodeId === '') return
    if (storedShootingWorkspaceValue(projectId, episodeId, 'tab') === 'shots') setTab('shots')
  }, [applicationShell, episodeId, projectId])

  useEffect(() => {
    if (projectId === '' || episodeId === '') return
    if (tab === 'shots') saveShootingWorkspaceValue(projectId, episodeId, 'tab', 'shots')
    else clearShootingWorkspaceValue(projectId, episodeId, 'tab')
  }, [episodeId, projectId, tab])

  useEffect(() => {
    if (applicationShell || !open) return
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert
    if (appRoot !== null) appRoot.inert = true
    headingRef.current?.focus()

    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter(node => !node.hidden && node.closest('[hidden]') === null
        && [...(node.parentElement?.closest('details:not([open])') ? [node.parentElement.closest('details:not([open])')] : [])]
          .every(detail => node.tagName === 'SUMMARY' && node.parentElement === detail))
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
  }, [open, applicationShell])

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
      {episodeId !== '' && <TextImportWorkspace key={`${projectId}:${episodeId}:text-import`} projectId={projectId} episodeId={episodeId}
        port={port} onSaved={async () => { await refresh() }} />}
      <details><summary>高级剧本 JSON 编辑与 ChangeSet</summary>
        <ScriptWorkspace
          key={`${projectId}:${episodeId}`}
          projectId={projectId}
          episodeId={episodeId}
          port={port}
          t={t}
          onCommitted={refreshWorkflowAfterCommit}
        />
      </details>
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

  const shootingDirector = nativeDirectorSession === undefined
    ? <p role="status">原生导演助手当前不可用；不会回退到 iframe。</p>
    : <div className={css.inlineDirector}>
      <NativeDirectorSession compact port={nativeDirectorSession} bridge={directorBridge} sessionId={directorSessionId}
        currentSessionId={currentSessionId} projectId={projectId}
        onRefresh={() => { setDirectorRefresh(value => value + 1) }} />
      <DirectorWorkspace presentation="assistant" projectId={projectId} episodeId={episodeId} projection={projection}
        shotItems={shotItems} selectedShotId={selectedShotId} onSelectShotId={setSelectedShotId}
        onUnsavedChange={onDirectorDirty} port={port} directorBridge={directorBridge}
        directorSessionId={directorSessionId} directorConnection={nativeDirectorSession.connection} directorRefresh={directorRefresh}
        nativeDirectorSession={nativeDirectorSession} hostSync={hostSync} t={t} onCommitted={refreshWorkflowProjectionAfterCommit} />
    </div>

  const shotView = (
    <div className={css.stack}>
      <ShootingReviewWorkspace
        hideHeader={applicationShell === true}
        headerActions={<>
          <button type="button" onClick={() => { if (mayLeaveDirector()) void refresh() }} disabled={loading} aria-label="刷新页面">
            <IconRefreshOutline16 size={16} /><span>{loading ? '正在刷新…' : '刷新'}</span>
          </button>
          <button type="button" onClick={close} aria-label="返回对话">返回对话</button>
        </>}
        projectName={projectLabel(selectedProject ?? {}, '未命名项目')}
        episodeName={episodeLabel(selectedEpisode ?? {}, '未命名剧集')}
        projectId={projectId}
        episodeId={episodeId}
        projection={projection}
        selectedShotId={selectedShotId}
        onSelectShotId={setSelectedShotId}
        onNavigate={setTab}
        onReturnToStoryboard={applicationShell ? () => { if (mayLeaveDirector()) setTab('director') } : undefined}
        onCommitted={refreshWorkflowProjectionAfterCommit}
        onProductionAction={(action, shotId) => { setSelectedShotId(shotId); setShootingActionKind(action); setShootingAction(shotId) }}
        directorAssistant={shootingAction ? null : shootingDirector}
        port={port}
        t={t}
      />
      {shootingAction && <div className={css.shootingAction} role="dialog" aria-modal="true" aria-label="本镜操作">
        <button type="button" onClick={() => { if (mayLeaveDirector()) setShootingAction(undefined) }}>返回拍摄与审看</button>
        {shootingActionKind === 'video' && shotRelations ? <SceneReferenceWorkspace projectId={projectId} relations={shotRelations}
          selectedShotId={shootingAction} onSelectShotId={(id) => { setSelectedShotId(id); setShootingAction(id) }}
          onUnsavedChange={onDirectorDirty} port={port} onRequestDirector={() => {
            setReferenceDirectorOpen(true)
            requestAnimationFrame(() => { referenceDirectorPanel.current?.scrollIntoView({ block: 'start' }) })
          }} /> :
          <PromptIrWorkspace key={`${episodeId}:${shootingAction}:shooting-action`} presentation="shooting" projectId={projectId} episodeId={episodeId} shotItems={shotItems}
            storyboardRevisionId={shotRelations?.storyboardRevision.revisionId ?? ''} selectedShotId={shootingAction} onSelectShotId={setShootingAction}
            port={port} t={t} onCommitted={refreshWorkflowAfterCommit} />}
        {shootingActionKind === 'video' && <details ref={referenceDirectorPanel} open={referenceDirectorOpen}
          onToggle={(event) => { setReferenceDirectorOpen(event.currentTarget.open) }}>
          <summary>本镜导演助手</summary>
          {referenceDirectorOpen && shootingDirector}
        </details>}
      </div>}
      <details className={css.developerLog}>
        <summary>开发日志</summary>
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
        <ContinuityDeltaView
          projectId={projectId}
          episodeId={episodeId}
          selectedShotId={selectedShotId}
          projection={projection}
          enabled={open && !loading && error === undefined}
          port={port}
          t={t}
        />
        <SelectedVideoReviewView
          projectId={projectId}
          episodeId={episodeId}
          selectedShotId={selectedShotId}
          projection={projection}
          enabled={open && !loading && error === undefined}
          port={port}
          t={t}
        />
        <ProductionUnitView
          projectId={projectId}
          episodeId={episodeId}
          selectedShotId={selectedShotId}
          projection={projection}
          enabled={open && !loading && error === undefined}
          port={port}
          t={t}
        />
      </details>
    </div>
  )

  const generationEnabled = open && tab === 'generation' && !loading && error === undefined
  const generationView = (
    <div className={css.stack}>
      <EpisodeEvidenceLedger
        projectId={projectId}
        episodeId={episodeId}
        projection={projection}
        enabled={open && tab === 'generation' && !loading}
        port={port}
        t={t}
      />
      <TakeVersionCompareView
        projectId={projectId}
        episodeId={episodeId}
        selectedShotId={selectedShotId}
        projection={projection}
        enabled={generationEnabled}
        port={port}
        t={t}
      />
      <GenerationCapabilityCatalog
        enabled={generationEnabled}
        onCatalog={handleGenerationCatalog}
        port={port}
        t={t}
      />
      <GenerationCostRehearsal
        projectId={projectId}
        episodeId={episodeId}
        selectedShotId={selectedShotId}
        catalog={generationCatalog}
        enabled={generationEnabled}
        port={port}
        t={t}
      />
      <GenerationGateAControlEvidence enabled={generationEnabled} port={port} t={t} />
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
      <Card title={t('handoffCardTitle')}>
        <EditorialHandoff projectId={projectId} episodeId={episodeId} port={port} t={t} />
      </Card>
    </div>
  )

  const panels: Record<Tab, ReactNode> = {
    director: <>
      {nativeDirectorSession && <NativeDirectorSession compact={applicationShell} port={nativeDirectorSession} bridge={directorBridge}
        sessionId={directorSessionId} currentSessionId={currentSessionId} projectId={projectId}
        onRefresh={() => { setDirectorRefresh(value => value + 1) }} />}
      {projectId !== '' && episodeId !== ''
        ? <DirectorWorkspace projectId={projectId} episodeId={episodeId} projection={projection}
          shotItems={shotItems} selectedShotId={selectedShotId} onSelectShotId={(id) => { if (mayLeaveDirector()) setSelectedShotId(id) }}
          onOpenShooting={openCandidateReview}
          onUnsavedChange={onDirectorDirty} port={port} directorBridge={directorBridge}
          directorSessionId={directorSessionId} directorConnection={nativeDirectorSession?.connection} directorRefresh={directorRefresh}
          nativeDirectorSession={nativeDirectorSession}
          hostSync={hostSync} t={t} onCommitted={refreshWorkflowProjectionAfterCommit} />
        : <p role="status">导演工作区等待准确项目与剧集绑定；不会自动读取空作用域。</p>}
    </>,
    overview,
    assets: assetView,
    shots: shotView,
    generation: generationView,
    delivery: deliveryView,
  }

  if (applicationShell) {
    const step = creativeStepForTab(tab)
    const changeStep = (next: CreativeStep) => {
      if (!mayLeaveDirector()) return
      if (next !== step || projectsOpen) {
        const url = new URL(location.href); url.searchParams.set('qingmuView', next); history.pushState(history.state, '', url)
      }
      setCreating(false); setProjectsOpen(false); setTab(STEP_TABS[next])
    }
    const pageHeader = (number: string, title: string, purpose: string, next: CreativeStep | null) => <header className={css.stageHeader}>
      <div><p className={css.stageEyebrow}>青木创作 · {number}</p><h1>{title}</h1><p>{purpose}</p></div>
      <div className={css.stageActions}>{next && <button type="button" disabled={loading || !episodeId}
        onClick={() => { changeStep(next) }}>前往{creativeStepLabel(next)} →</button>}</div>
    </header>
    const projectFacts = <div className={css.stageFacts} aria-label="当前项目概览">
      <span>{projectLabel(selectedProject ?? {}, '当前项目')}</span>
      <span>{episodeLabel(selectedEpisode ?? {}, '当前剧集')}</span>
      <span>{projection ? `${shotItems.length} 个镜头` : storyboardMissing ? '分镜尚待规划' : '镜头信息待读取'}</span>
      <span>{projection ? `${semanticAssets.length} 份素材档案` : '素材信息待读取'}</span>
    </div>
    const applicationPanels: Record<CreativeStep, ReactNode> = {
      story: <div className={css.creativePage}>
        {pageHeader('01', '故事与剧本', '写下故事、整理对白，形成这一集的创作依据。', 'assets')}{projectFacts}
        <div className={css.stageContent}>{episodeId && <TextImportWorkspace key={`${projectId}:${episodeId}:story`}
          projectId={projectId} episodeId={episodeId} port={port} storyPort={nativeDirectorSession?.story}
          onSaved={refreshWorkflowAfterCommit}
          onPlanStoryboard={() => { changeStep('storyboard') }} />}</div>
        <details className={css.stageSupporting}><summary>已存剧本与精细编辑</summary>
          <ScriptWorkspace projectId={projectId} episodeId={episodeId} port={port} t={t} onCommitted={refreshWorkflowAfterCommit} />
        </details>
      </div>,
      assets: <div className={css.creativePage}>
        {pageHeader('02', '角色、场景与音色', '建立这一部作品的素材库，让同一人物和环境贯穿各个镜头。', 'storyboard')}{projectFacts}
        {episodeId && <div className={css.stageContent}><NativeAssetDesign key={`${projectId}:${episodeId}`} projectId={projectId} episodeId={episodeId} port={port} storyPort={nativeDirectorSession?.story} onGenerated={() => { setAssetLibraryRefresh(value => value + 1) }} /></div>}
        <div className={css.stageContent}><ProjectAssetLibrary key={projectId} projectId={projectId} port={port}
          refreshToken={assetLibraryRefresh} onOpenReferenceUpload={openReferenceUpload} /></div>
        <div ref={assetWorkbenchRef} tabIndex={-1} role="group" aria-label="人物与场景参考上传">
          <details className={css.stageSupporting} open={assetWorkbenchOpen}
            onToggle={(event) => { setAssetWorkbenchOpen(event.currentTarget.open) }}>
            <summary>人物与场景档案 · 上传参考</summary>
            <AssetWorkbench key={`${projectId}:application-assets`} projectId={projectId} semanticAssets={semanticAssets} port={port} t={t} onCommitted={refreshAssetsAfterCommit} />
          </details>
        </div>
      </div>,
      storyboard: <div className={css.creativePage}>
        {pageHeader('03', '分镜与导演', '安排画面、表演和声音，明确每镜使用的素材与生成描述。', 'shooting')}{projectFacts}
        <div className={css.stageContent}>{panels.director}</div>
      </div>,
      shooting: shotView,
      delivery: <div className={css.creativePage}>
        {pageHeader('05', '成片与导出', '选择视频版本，调整剪辑，导出可播放的完整作品。', null)}{projectFacts}
        <div className={css.stageActions}><button type="button" onClick={() => { changeStep('shooting') }}>← 返回拍摄与审看</button></div>
        <div className={css.stageContent}><WorkingCut key={`${projectId}:${episodeId}`} projectId={projectId} episodeId={episodeId} port={port} onOpenShooting={openCandidateReview} />
          <details className={css.stageSupporting}><summary>专业剪辑交接与审核记录</summary>
            <EditorialHandoff compact projectId={projectId} episodeId={episodeId}
              port={port} t={t} onOpenShooting={openCandidateReview} /></details></div>
      </div>,
    }
    return <QingmuApplicationFrame projects={projects.map(p => ({ id: stringOf(p.id) ?? '', label: projectLabel(p, '未命名项目') }))}
      episodes={episodes.map(e => ({ id: stringOf(e.id) ?? '', label: episodeLabel(e, '未命名剧集') }))}
      projectId={projectId} episodeId={episodeId} step={step} loading={loading} scopeLocked={entryScope !== undefined}
      onProject={(id) => { void chooseProject(id) }} onEpisode={(id) => { void chooseEpisode(id) }}
      onStep={changeStep}
      projectsOpen={projectsOpen}
      onOpenProjects={() => { if (mayLeaveDirector()) {
        const url = new URL(location.href); url.searchParams.set('qingmuView', 'projects'); history.pushState(history.state, '', url)
        setCreating(false); setProjectsOpen(true)
      } }}
      onCreate={() => { if (mayLeaveDirector()) {
        setCreationFromLibrary(projectsOpen); setProjectsOpen(false); setCreating(true)
      } }}
      onRefresh={() => { if (mayLeaveDirector()) void refresh() }} onOpenTools={onOpenTools}>
      <div className={`${css.shell} ${step === 'shooting' && !creating && !projectsOpen ? css.shootingShell : ''}`}>
        {error && <div role="alert" className={css.error}><p>当前项目暂时无法更新。已有素材保留，请刷新重试。</p><details><summary>开发日志</summary>{error}</details></div>}
        <div className={css.body}><main aria-label={creating ? '新建项目' : projectsOpen ? '我的项目' : `青木 · ${creativeStepLabel(step)}`}>
          {projectsOpen ? <ProjectLibrary projects={projects} currentProjectId={projectId} loading={loading} mediaPort={port}
            copyPort={port} onCopied={async (result) => {
              await refresh({ projectId: result.projectId, episodeId: result.episodeIds[0] ?? '' })
              setProjectsOpen(false); changeStep('story')
            }}
            onOpen={(id) => { void chooseProject(id) }}
            onUpdate={async (request) => {
              const result = await port.updateProject(request)
              setProjects(previous => previous.map(project => project.id === request.projectId ? { ...project, ...result } : project))
            }}
            onCreate={() => { setCreationFromLibrary(true); setProjectsOpen(false); setCreating(true) }} />
            : creating || (!loading && projects.length === 0 && !error)
              ? <CreateProjectWorkspace port={port} onCreated={async (result) => { await refresh(result); setCreating(false); setTab('overview') }} onCancel={projects.length ? () => { setCreating(false); setProjectsOpen(creationFromLibrary) } : undefined} />
              : <>{storyboardMissing && <section className={css.empty} role="status" aria-label="分镜待规划">
                <h2>分镜尚待规划</h2>
                <p>这是新项目的正常状态。先在故事与剧本保存内容，再进入分镜与导演安排镜头。</p>
                <div className={css.stageActions}>
                  <button type="button" onClick={() => { changeStep('story') }}>前往故事与剧本</button>
                  <button type="button" onClick={() => { changeStep('storyboard') }}>打开分镜与导演</button>
                </div>
              </section>}{applicationPanels[step]}</>}
        </main></div>
      </div>
    </QingmuApplicationFrame>
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
      <Modal open={open} onClose={close} title={t('title')} headless className={css.dialog ?? ''}>
        <div ref={dialogRef} className={`${css.shell} ${tab === 'director' || creating || projectId === '' || tab === 'assets' ? css.directorShell : ''} ${tab === 'shots' ? css.shootingShell : ''}`}>
          <header className={css.header}>
            <div>
              <h2 ref={headingRef} tabIndex={-1}>{t('title')}</h2>
              <p>{t('subtitle')}</p>
            </div>
            <div className={css.headerActions}>
              <button type="button" onClick={() => { if (mayLeaveDirector()) void refresh() }} disabled={loading}>
                <IconRefreshOutline16 size={16} />
                <span>{tab === 'shots' ? (loading ? '正在刷新…' : '刷新页面') : loading ? t('refreshing') : t('refresh')}</span>
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
            <button type="button" onClick={() => { if (mayLeaveDirector()) setCreating(true) }}
              disabled={loading || entryScope !== undefined}>新建项目</button>
            <label>
              <span>{t('project')}</span>
              <select
                value={projectId}
                onChange={(event) => { void chooseProject(event.target.value) }}
                disabled={loading || projects.length === 0 || entryScope !== undefined}
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
                disabled={loading || episodes.length === 0 || entryScope !== undefined}
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

          {(error !== undefined || storyboardMissing) && (
            <section className={css.error} role={storyboardMissing ? 'status' : 'alert'}>
              <div>
                <strong>{storyboardMissing || error?.includes('storyboard_revision_missing') ? '分镜尚未建立' : t('errorTitle')}</strong>
                <p>{storyboardMissing || error?.includes('storyboard_revision_missing')
                  ? '分镜暂不可用；请先在故事步骤保存剧本。' : tab === 'shots' ? '当前项目暂时无法更新。请刷新重试，已有素材和未提交草稿会保留。' : error}</p>
                {tab === 'shots' && error && <details><summary>开发日志</summary><p>{error}</p></details>}
                {storyboardMissing || error?.includes('storyboard_revision_missing')
                  ? error && <details><summary>投影诊断</summary><p>{error}</p></details>
                  : <small>{t('errorRecovery')}</small>}
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
                onClick={() => { if (item.id === tab || mayLeaveDirector()) setTab(item.id) }}
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
                  if (next.id !== tab && !mayLeaveDirector()) return
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
              {creating || (!loading && projects.length === 0 && error === undefined)
                ? <CreateProjectWorkspace port={port} onCreated={async (result) => { await refresh(result); setCreating(false); setTab('assets') }}
                  onCancel={projects.length === 0 ? undefined : () => { setCreating(false) }} />
                : panels[tab]}
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
