import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { QingmuYimengPort, YimengTakeVersion, YimengTakeVersionStackResponse, YimengWorkflowProjection } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import type { AutomaticPlanningShot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { TakePreviewPlayer } from './TakePreviewPlayer.tsx'
import { TakeThumbnail } from './TakeThumbnail.tsx'
import { ShootingFirstFrame } from './ShootingFirstFrame.tsx'
import { ShootingFirstFrameHistory } from './ShootingFirstFrameHistory.tsx'
import { createFirstFrameSelectionClient, type FirstFrameHistoryCandidate } from './first-frame-selection.ts'
import { FirstFrameCandidatePreview } from './FirstFrameCandidatePreview.tsx'
import { AutomaticFrameRequirementsEditor } from './AutomaticFrameRequirementsEditor.tsx'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker, readTakeVersionSelectionMarker,
  takeSelectionReceiptMatches, takeVersionSelectionRequestFromMarker, writeTakeVersionSelectionMarker,
} from './take-version-recovery.ts'
import css from './ShootingReviewWorkspace.module.css'

export type ShootingReviewState = 'normal' | 'generating' | 'failed' | 'pending-review'
/** Screenshot fixtures only. They never submit a task and are not production task evidence. */
export const shootingReviewScreenshotFixtures = [
  { state: 'normal', label: '隔离演练·正常' },
  { state: 'generating', label: '隔离演练·生成中（未提交生成）' },
  { state: 'failed', label: '隔离演练·失败' },
  { state: 'pending-review', label: '隔离演练·待审' },
] as const
type Destination = 'director' | 'assets' | 'shots' | 'delivery'
type MediaPane = 'takes' | 'first-frame' | 'history'
function readMediaPane(key: string): MediaPane {
  try {
    const value = sessionStorage.getItem(key)
    if (value === 'first-frame' || value === 'history') return value
  } catch { /* Viewing is available without browser storage. */ }
  return 'takes'
}
interface Props {
  readonly projectName: string
  readonly episodeName: string
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly onNavigate: (destination: Destination) => void
  readonly onCommitted?: () => Promise<unknown>
  readonly directorAssistant: ReactNode
  readonly onProductionAction?: (action: 'first-frame' | 'select-frame' | 'video', shotId: string) => void
  readonly port: Pick<QingmuYimengPort, 'takeVersions' | 'takePreview' | 'selectTakeVersion' | 'recoverTakeVersionSelection'>
    & Partial<Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'>>
  readonly t: (key: QingmuCockpitKey) => string
  /** Isolated visual fixture for UI tests only; production does not infer task state from loading. */
  readonly testState?: ShootingReviewState
}
function usable(version: YimengTakeVersion | undefined): version is YimengTakeVersion & { readonly outputSha256: string } {
  return version !== undefined && version.outputSha256 !== null && version.outputBindingStatus === 'verified'
}
export function localHeroUrl(source: string | undefined, assetId: string | undefined): string | undefined {
  try {
    const url = new URL(source ?? '')
    const mediaId = (assetId ?? '').replace(/^asset_/, 'media_')
    return ['http:', 'https:'].includes(url.protocol)
      && (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d+\.){2}\d+$/.test(url.hostname))
      && !url.username && !url.password && !url.hash
      && /^media_[A-Za-z0-9_-]+$/.test(mediaId) && url.pathname === `/api/media/${mediaId}`
      && /^\d+$/.test(url.searchParams.get('expires') ?? '')
      && /^[a-f0-9]{64}$/.test(url.searchParams.get('signature') ?? '')
      && [...url.searchParams.keys()].sort().join(',') === 'expires,signature' ? url.href : undefined
  } catch { return undefined }
}
function statusOf(stack: YimengTakeVersionStackResponse | undefined, current: YimengTakeVersion | undefined, load: 'loading' | 'ready' | 'failed'): ShootingReviewState {
  if (load === 'failed') return 'failed'
  if (current?.qualityStatus === 'failed' || (current !== undefined && current.outputBindingStatus !== 'verified')) return 'failed'
  return stack?.subject.selectedTakeId === null ? 'pending-review' : 'normal'
}
function message(state: ShootingReviewState, load: 'loading' | 'ready' | 'failed'): string {
  if (load === 'loading') return '正在读取已有候选媒体；读取不代表正在生成。'
  if (load === 'failed') return '候选暂时无法读取，请刷新页面再试。'
  if (state === 'generating') return '测试状态：正在生成。正式任务状态必须由任务接口提供。'
  if (state === 'failed') return '当前浏览的是未通过检查的旧视频，不代表本次生成被阻断。可查看视频、修改要求或重新生成。'
  if (state === 'pending-review') return '候选已就绪。浏览不改变选用，采用需要明确操作。'
  return '当前为已选版本。可浏览其它候选或修改当前要求。'
}
/** Display only storyboard prose, never manufacture a creative title. */
export function shootingTitle(title: string | null, frame: AutomaticPlanningShot | undefined): string {
  if (title && !/^(自动)?镜头\s*\d+$/.test(title.trim())) return title
  const text = frame?.blocking || frame?.narrative || ''
  return text.split(/[；;。]/)[0]?.slice(0,30) || '分镜内容待补充'
}
export function shootingPrimary(hasFrame: boolean, selectedFrame: boolean, selectedVideo: boolean): 'first-frame' | 'select-frame' | 'video' | undefined {
  return selectedVideo ? undefined : !hasFrame ? 'first-frame' : !selectedFrame ? 'select-frame' : 'video'
}
export function shootingPosterVersion(stack: YimengTakeVersionStackResponse | undefined) {
  const candidate = stack?.subject.selectedTakeId
    ? stack.subject.versions.find(version => version.takeId === stack.subject.selectedTakeId)
    : stack?.subject.versions.find(usable)
  return usable(candidate) ? candidate : undefined
}
/** Content-first view of existing Takes; it neither dispatches generation nor records human approval. */
export function ShootingReviewWorkspace({ projectName, episodeName, projectId, episodeId, projection, selectedShotId,
  onSelectShotId, onNavigate, onCommitted = async () => undefined, directorAssistant, onProductionAction, port, t, testState }: Props) {
  const shots = projection?.director.shotRelations.shots ?? []
  const current = shots.find(shot => shot.shotId === selectedShotId) ?? shots[0]
  const [stack, setStack] = useState<YimengTakeVersionStackResponse>(); const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [browseId, setBrowseId] = useState('')
  const [panel, setPanel] = useState<'requirements' | 'assistant'>('requirements'); const [mediaUrl, setMediaUrl] = useState<string>(); const [heroMediaUrl, setHeroMediaUrl] = useState<string>()
  const [zoom, setZoom] = useState(false); const [scale, setScale] = useState(1); const [selectionError, setSelectionError] = useState('')
  const [offset, setOffset] = useState({ x: 0, y: 0 }); const [selecting, setSelecting] = useState(false)
  const [heroError, setHeroError] = useState(false)
  const mediaPaneKey = `qingmu:shooting-pane:${projectId}:${episodeId}:${current?.shotId ?? ''}`
  const [mediaPane, setMediaPane] = useState(() => ({ key: mediaPaneKey, pane: readMediaPane(mediaPaneKey) }))
  // A different shot must never mount the previous shot's generation panel, even for one render.
  const pane = mediaPane.key === mediaPaneKey ? mediaPane.pane : readMediaPane(mediaPaneKey)
  const firstFrameOpen = pane === 'first-frame'
  const historyOpen = pane === 'history'
  function showMediaPane(pane: MediaPane): void {
    setMediaPane({ key: mediaPaneKey, pane })
    try { sessionStorage.setItem(mediaPaneKey, pane) } catch { /* Viewing still works when browser storage is unavailable. */ }
  }
  const [inspectedFrame, setInspectedFrame] = useState<{
    key: string
    candidate: FirstFrameHistoryCandidate | undefined
    url: string | undefined
    ownsImagePreview: boolean
  }>()
  const onCandidatePreview = useCallback((candidate: FirstFrameHistoryCandidate | undefined,
    url: string | undefined, ownsImagePreview = true) => {
    setInspectedFrame({ key: mediaPaneKey, candidate, url, ownsImagePreview })
  }, [mediaPaneKey])
  const loadedScope = useRef('')
  const [planningShots, setPlanningShots] = useState<readonly AutomaticPlanningShot[]>([])
  const [shotStacks, setShotStacks] = useState<Readonly<Record<string, YimengTakeVersionStackResponse>>>({})
  const frameClient = useMemo(() => createFirstFrameSelectionClient(), [])
  const storyboardRevisionId = projection?.director.shotRelations.storyboardRevision?.revisionId ?? ''
  const historyScopeKey = `${projectId}:${episodeId}:${storyboardRevisionId}`
  const historyFrameIds = shots.map(shot => shot.shotId).join('\u0000')
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const refreshExistingMedia = useCallback(async () => {
    await onCommitted()
    setHistoryRefresh(value => value + 1)
  }, [onCommitted])
  const [frameHistory, setFrameHistory] = useState<{
    key: string
    candidates: Readonly<Record<string, FirstFrameHistoryCandidate | undefined>>
  }>()
  const historyCandidates = frameHistory?.key === historyScopeKey ? frameHistory.candidates : {}
  useEffect(() => {
    const controller = new AbortController()
    setFrameHistory({ key: historyScopeKey, candidates: {} })
    if (!storyboardRevisionId) return () => controller.abort()
    // A selected hero may have newer, unselected candidates. Inspect every shot;
    // browsing the latest materialization must not change official selection.
    const ids = historyFrameIds ? historyFrameIds.split('\u0000') : []
    let index = 0
    const read = async (): Promise<void> => {
      while (index < ids.length && !controller.signal.aborted) {
        const frameId = ids[index++]
        if (!frameId) return
        try {
          const items = await frameClient.history({ projectId, episodeId, storyboardRevisionId, frameId }, controller.signal)
          if (controller.signal.aborted) return
          const candidate = items.at(-1)
          setFrameHistory(old => ({ key: historyScopeKey,
            candidates: { ...(old?.key === historyScopeKey ? old.candidates : {}), [frameId]: candidate } }))
        } catch { /* A failed history read is not evidence that no image exists. */ }
      }
    }
    void read(); void read()
    return () => controller.abort()
  }, [projectId, episodeId, storyboardRevisionId, historyScopeKey, historyFrameIds, historyRefresh, frameClient])
  useEffect(() => {
    const controller = new AbortController(); setShotStacks({})
    const ids = (projection?.director.shotRelations.shots ?? []).map(shot => shot.shotId)
    let index = 0
    const read = async (): Promise<void> => {
      while (index < ids.length && !controller.signal.aborted) {
        const id = ids[index++]
        if (!id) return
        try {
          const value = await port.takeVersions({ projectId, episodeId, frameId: id }, controller.signal)
          if (!controller.signal.aborted && value.subject.projectId === projectId
            && value.subject.episodeId === episodeId && value.subject.frameId === id) {
            setShotStacks(old => ({ ...old, [id]: value }))
          }
        } catch { /* Unknown is not completion; retain the known first-frame state only. */ }
      }
    }
    void read(); void read()
    return () => controller.abort()
  }, [projectId, episodeId, port, projection])
  useEffect(() => {
    const controller = new AbortController(); setPlanningShots([])
    void port.readScenePlanning?.({ projectId, episodeId }, controller.signal).then((value) => {
      if (!controller.signal.aborted && value.projectId === projectId && value.episodeId === episodeId) {
        setPlanningShots(value.canonicalStoryboard?.shots ?? [])
      }
    }).catch(() => { /* The editor exposes read failures; never fabricate storyboard content. */ })
    return () => controller.abort()
  }, [projectId, episodeId, port, projection])
  useEffect(() => { setHeroMediaUrl(undefined); setHeroError(false) }, [current?.shotId, projection])
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number }>()
  const zoomTrigger = useRef<HTMLElement>()
  useEffect(() => {
    if (current === undefined) { setStack(undefined); setLoad('failed'); return }
    const controller = new AbortController()
    const scopeKey = [projectId, episodeId, current.shotId].join(':')
    const changedShot = loadedScope.current !== scopeKey
    if (changedShot) { setLoad('loading'); setStack(undefined); setBrowseId(''); loadedScope.current = scopeKey }
    void port.takeVersions({ projectId, episodeId, frameId: current.shotId }, controller.signal).then((value) => {
      if (controller.signal.aborted || value.subject.projectId !== projectId
        || value.subject.episodeId !== episodeId || value.subject.frameId !== current.shotId) return
      setStack(value)
      setBrowseId(old => !changedShot && value.subject.versions.some(v => v.takeId === old)
        ? old : value.subject.selectedTakeId ?? value.subject.versions[0]?.takeId ?? '')
      setLoad('ready')
    }).catch(() => { if (!controller.signal.aborted) setLoad('failed') })
    return () => controller.abort()
  }, [current, episodeId, port, projectId])
  useEffect(() => {
    if (current === undefined) return
    const scope = { projectId, episodeId, frameId: current.shotId }
    const marker = readTakeVersionSelectionMarker(scope)
    if (marker.status !== 'ready') return
    void port.recoverTakeVersionSelection(takeVersionSelectionRequestFromMarker(marker.marker)).then((result) => {
      if (result.status !== 'committed' || result.result === null) return
      if (!takeSelectionReceiptMatches(result.result, marker.marker)) return
      if (!clearTakeVersionSelectionMarker(scope, marker)) return
      return port.takeVersions(scope).then((value) => {
        if (value.subject.projectId === projectId && value.subject.episodeId === episodeId
          && value.subject.frameId === current.shotId) setStack(value)
      })
    }).catch(() => { /* retain exact marker; a later visit can only recover it */ })
  }, [current, episodeId, port, projectId])
  useEffect(() => {
    if (!zoom) return
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); setZoom(false)
    }
    // The enclosing cockpit is also a modal; Escape closes only this topmost viewer.
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [zoom])
  useEffect(() => { if (!zoom) zoomTrigger.current?.focus() }, [zoom])
  const onPreviewReady = useCallback((url: string | undefined): void => setMediaUrl(url), [])
  const resetZoom = useCallback((): void => { setScale(1); setOffset({ x: 0, y: 0 }) }, [])
  const closeZoom = useCallback((): void => { setZoom(false); resetZoom() }, [resetZoom])
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current
    if (start !== undefined) setOffset({ x: start.offsetX + event.clientX - start.x, y: start.offsetY + event.clientY - start.y })
  }
  if (current === undefined) return <section className={css.empty} aria-live="polite">请选择一个镜头后开始拍摄与审看。</section>
  const activeShot = current
  const heroFrame = projection?.director.heroFrameStoryboards?.shots.find(shot => shot.shotId === current.shotId)?.heroFrame
  const visibleStack = stack?.subject.projectId === projectId && stack.subject.episodeId === episodeId
    && stack.subject.frameId === current.shotId ? stack : undefined
  const versions = visibleStack?.subject.versions ?? []; const browsed = versions.find(version => version.takeId === browseId)
  const state = testState ?? statusOf(visibleStack, browsed, load); const primary = usable(browsed) && !visibleStack?.subject.selectedTakeId && visibleStack?.capabilities.canSelect === true && !browsed.isSelected && load === 'ready'
  const sourceUrl = mediaUrl ?? heroMediaUrl
  const heroUrl = localHeroUrl(heroFrame?.browserUrl, heroFrame?.assetId)
  const dialogue = (current.dialogueRhythm?.cues ?? []).map(cue => cue.verbatimText).filter(Boolean)
  const inspected = inspectedFrame?.key === mediaPaneKey ? inspectedFrame : undefined
  const currentPaneLoadsFrame = historyOpen || (firstFrameOpen && inspected?.ownsImagePreview !== false)
    || (!firstFrameOpen && !usable(browsed) && !heroUrl && load === 'ready')
  const hasFrameCandidate = inspected?.candidate !== undefined
    || historyCandidates[current.shotId] !== undefined
    || (planningShots.find(item => item.id === current.shotId)?.firstFrameCandidateCount ?? 0) > 0
  const productionAction = shootingPrimary(
    Boolean(heroFrame) || hasFrameCandidate, Boolean(heroFrame), Boolean(visibleStack?.subject.selectedTakeId))
  async function selectCurrent(): Promise<void> {
    if (!primary || visibleStack === undefined || browsed === undefined || !usable(browsed) || selecting) return
    setSelecting(true)
    try {
      const marker = await createTakeVersionSelectionMarker({
        projectId, episodeId, frameId: activeShot.shotId, expectedStackSha256: visibleStack.stackSnapshotSha256,
        expectedSelectedTakeId: visibleStack.subject.selectedTakeId, candidateTakeId: browsed.takeId,
        candidateVersionOrdinal: browsed.versionOrdinal, candidateOutputSha256: browsed.outputSha256,
      })
      if (!writeTakeVersionSelectionMarker(marker)) throw new Error('selection recovery storage unavailable')
      const request = takeVersionSelectionRequestFromMarker(marker)
      let result; try { result = await port.selectTakeVersion(request) } catch { const recovery = await port.recoverTakeVersionSelection(request); if (recovery.status !== 'committed' || recovery.result === null) throw new Error('selection recovery pending'); result = recovery.result }
      if (!takeSelectionReceiptMatches(result, marker)) throw new Error('unsafe selection receipt')
      if (!clearTakeVersionSelectionMarker(marker, { status: 'ready', marker })) throw new Error('selection recovery marker changed')
      const refreshed = await port.takeVersions({ projectId, episodeId, frameId: activeShot.shotId })
      if (refreshed.subject.projectId !== projectId || refreshed.subject.episodeId !== episodeId || refreshed.subject.frameId !== activeShot.shotId) throw new Error('selection refresh scope mismatch')
      setStack(refreshed)
    } catch {
      setSelectionError('采用结果尚未确认。请刷新页面查看结果，不要重复采用。')
    } finally { setSelecting(false) }
  }
  return <section className={css.workspace} aria-label="拍摄与审看">
    <header className={css.header}><div><strong>{projectName}</strong><span> / {episodeName}</span></div><nav aria-label="项目步骤"><button type="button" onClick={() => onNavigate('assets')}>故事</button><button type="button" onClick={() => onNavigate('director')}>角色与场景</button><button type="button" onClick={() => onNavigate('shots')}>分镜</button><strong>拍摄与审看</strong><button type="button" onClick={() => onNavigate('delivery')}>导出</button></nav></header>
    <div className={css.grid}>
      <aside className={css.shots} aria-label="镜头列表"><h2>镜头</h2>{shots.map((shot) => {
        const hero = projection?.director.heroFrameStoryboards?.shots.find(item => item.shotId === shot.shotId)?.heroFrame
        const viewed = shot.shotId === current.shotId && inspected?.url ? inspected : undefined
        const candidate = viewed?.candidate ?? historyCandidates[shot.shotId]
        const thumb = viewed?.url ?? (!candidate || candidate.assetId === hero?.assetId
          ? localHeroUrl(hero?.browserUrl, hero?.assetId) : undefined)
        const summary = shot.shotId === current.shotId ? visibleStack ?? shotStacks[shot.shotId] : shotStacks[shot.shotId]
        const previewTake = shootingPosterVersion(summary)
        const planning = planningShots.find(item => item.id === shot.shotId)
        const label = summary?.subject.selectedTakeId ? '有视频' : (summary?.subject.versions.length ?? 0) > 0 ? summary?.subject.versions.every(v => v.qualityStatus === 'failed' || v.outputBindingStatus !== 'verified') ? '旧视频未通过' : '待审' : candidate ? candidate.selectionStatus === 'Stale' || candidate.selectionStatus === 'Rejected' || candidate.qualityStatus === 'failed' ? '旧首帧，仅供对照' : candidate.isSelected ? '有首帧' : '首帧待审' : hero || (planning?.firstFrameCandidateCount ?? 0) > 0 ? '有首帧' : Object.hasOwn(historyCandidates, shot.shotId) ? '无有效首帧' : '正在读取'
        const title = shootingTitle(shot.title, planning)
        return <button key={shot.shotId} type="button" aria-label={`镜 ${shot.frameNo} ${title}`} aria-current={shot.shotId === current.shotId} onClick={() => onSelectShotId(shot.shotId)}>{thumb ? <img className={css.shotThumb} src={thumb} loading="lazy" alt={`镜 ${shot.frameNo} 首帧缩略图`} /> : candidate && (shot.shotId !== current.shotId || !currentPaneLoadsFrame) ? <FirstFrameCandidatePreview key={`${historyScopeKey}:${shot.shotId}:${candidate.assetId}`} autoLoad thumbnailClassName={css.shotThumb ?? ''} request={{ projectId, episodeId, storyboardRevisionId, frameId: shot.shotId, assetId: candidate.assetId, expectedMaterializedSha256: candidate.materializedSha256 }} load={frameClient.historyPreview} labels={{ load: '查看首帧', loading: '正在读取首帧', error: '缩略图未载入', ariaLabel: `镜 ${shot.frameNo} 首帧缩略图` }} /> : !candidate && previewTake ? <TakeThumbnail request={{ projectId, episodeId, frameId: shot.shotId, takeId: previewTake.takeId, expectedOutputSha256: previewTake.outputSha256 }} load={port.takePreview} className={css.shotThumb} alt={`镜 ${shot.frameNo} 视频第一帧`} /> : <span className={css.shotThumb}>{candidate ? '首帧候选' : Object.hasOwn(historyCandidates, shot.shotId) ? '暂无首帧' : '正在读取'}</span>}<span className={css.shotText}><small>镜 {shot.frameNo}</small><strong title={title}>{title}</strong><small className={css.shotStatus} data-status={label}><i aria-hidden="true" />{label}</small></span></button>
      })}</aside>
      <main className={css.stage}>
        <div className={css.reworkActions} aria-label="本镜重做操作">
          {(firstFrameOpen || historyOpen) && <button type="button" onClick={() => showMediaPane('takes')}>返回候选审看</button>}
          {!firstFrameOpen && <button type="button" onClick={() => showMediaPane('first-frame')}>{heroFrame || hasFrameCandidate ? '重新生成首帧' : '生成首帧'}</button>}
          {onProductionAction && <button type="button" onClick={() => onProductionAction('video', current.shotId)}>{versions.length ? '重新生成视频' : '生成视频'}</button>}
          <button type="button" onClick={() => showMediaPane('history')}>查看与采用首帧</button>
        </div>
        <div className={css.media} data-state={testState ?? (load === 'loading' ? 'loading' : state)}>
          {historyOpen ? <ShootingFirstFrameHistory key={`${mediaPaneKey}:${projection?.director.shotRelations.storyboardRevision?.revisionId}`} scope={{ projectId, episodeId, frameId: current.shotId, storyboardRevisionId: projection?.director.shotRelations.storyboardRevision?.revisionId ?? '' }} onCommitted={refreshExistingMedia} onCandidatePreview={onCandidatePreview} /> : firstFrameOpen ? <ShootingFirstFrame key={mediaPaneKey}
            scope={{ projectId, episodeId, frameId: current.shotId }} onCommitted={refreshExistingMedia}
            onCandidatePreview={onCandidatePreview} />
            : usable(browsed) ? <div className={css.player}><TakePreviewPlayer request={{
              projectId, episodeId, frameId: current.shotId, takeId: browsed.takeId,
              expectedOutputSha256: browsed.outputSha256,
            }} load={port.takePreview} t={t} onPreviewReady={onPreviewReady} autoLoad /></div>
              : heroUrl !== undefined ? <div className={css.frame}><span>已选首帧</span><img src={heroUrl} alt={`镜 ${current.frameNo} 已选首帧`} onLoad={() => { setHeroMediaUrl(heroUrl); setHeroError(false) }} onError={() => setHeroError(true)} />{heroError && <p role="alert">首帧暂时无法显示，请刷新后再试。</p>}</div>
                : load === 'ready' && projection?.director.shotRelations.storyboardRevision?.revisionId ? <ShootingFirstFrameHistory key={`${mediaPaneKey}:${projection.director.shotRelations.storyboardRevision.revisionId}`} scope={{ projectId, episodeId, frameId: current.shotId, storyboardRevisionId: projection.director.shotRelations.storyboardRevision.revisionId }} onCommitted={refreshExistingMedia} onCandidatePreview={onCandidatePreview} />
                  : <div className={css.canvas}><span>镜 {current.frameNo}</span><strong>{current.title}</strong>
                    <small>{message(state, load)}</small></div>}
          {!firstFrameOpen && !historyOpen && <>{testState !== undefined && <p className={css.mediaNotice} role="status">隔离演练状态，不代表真实任务，未提交生成。</p>}{load === 'loading' && <p className={css.mediaNotice} role="status">{message(state, load)}</p>}{load === 'failed' && <p className={css.mediaNotice} role="alert">{message(state, load)}</p>}{state === 'failed' && load === 'ready' && <p className={css.mediaNotice} role="alert">{message(state, load)}</p>}</>}
        </div>
        <div className={css.candidates} aria-label="候选画面">{versions.map(version => <button key={version.takeId} type="button" aria-pressed={!firstFrameOpen && !historyOpen && version.takeId === browseId} onClick={() => { showMediaPane('takes'); setBrowseId(version.takeId); if (version.takeId !== browseId) setMediaUrl(undefined) }}>{usable(version) ? <TakeThumbnail request={{ projectId, episodeId, frameId: current.shotId, takeId: version.takeId, expectedOutputSha256: version.outputSha256 }} load={port.takePreview} className={css.candidateThumb} alt={`视频候选 v${version.versionOrdinal} · 视频第一帧`} /> : <span className={css.videoIcon}>素材尚不可用</span>}<span>视频候选 v{version.versionOrdinal}</span><strong>{version.isSelected ? '当前选用' : version.qualityStatus === 'failed' ? '检查未通过' : version.qualityStatus === 'passed' ? '待你审看' : '等待检查'}</strong></button>)}
          {versions.length === 0 && heroUrl && <button type="button" aria-pressed={!firstFrameOpen && !historyOpen} onClick={() => showMediaPane('takes')}><img className={css.candidateThumb} src={heroUrl} alt="当前首帧候选" /><span>原选用首帧</span><strong>已选用</strong></button>}
          {inspected?.url && inspected.candidate && !inspected.candidate.isSelected && <button type="button" aria-pressed="true" onClick={() => { if (!firstFrameOpen) showMediaPane('history') }}><img className={css.candidateThumb} src={inspected.url} alt="未采用首帧候选" /><span>正在查看的首帧</span><strong>尚未采用</strong></button>}
        </div>
        {!firstFrameOpen && !historyOpen && <><p className={css.browseNote}>{versions.length === 0 && load === 'ready' && testState === undefined ? '本镜尚无视频候选，已有首帧和要求仍保留。' : message(state, load)} 单击候选只切换中区媒体，不会改变选用。</p>{selectionError && <p role="alert">{selectionError}</p>}{primary ? <button className={css.primary} type="button" disabled={selecting} onClick={() => { void selectCurrent() }}>{selecting ? '正在采用候选' : '采用这条视频'}</button> : productionAction === 'select-frame' && load === 'ready' && <button className={css.primary} type="button" onClick={() => showMediaPane('history')}>查看首帧候选并采用</button>}</>}
        {!firstFrameOpen && !historyOpen && sourceUrl !== undefined && <button className={css.zoomButton} type="button" onClick={(event) => { zoomTrigger.current = event.currentTarget; resetZoom(); setZoom(true) }}>放大画面</button>}
        {zoom && <div className={css.zoom} role="dialog" aria-modal="true" aria-label="放大画面"><div className={css.zoomToolbar}><button type="button" onClick={closeZoom}>关闭放大查看</button><button type="button" onClick={() => setScale(value => Math.min(3, value + 0.25))}>放大</button><button type="button" onClick={() => setScale(value => Math.max(1, value - 0.25))}>缩小</button></div><div className={css.zoomCanvas} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}>{mediaUrl !== undefined ? <video src={mediaUrl} controls autoPlay playsInline style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} /> : heroMediaUrl !== undefined && <img src={heroMediaUrl} alt={`镜 ${current.frameNo} 已选首帧`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />}</div></div>}
      </main>
      <aside className={css.inspector}><div className={css.switcher}><button type="button" aria-pressed={panel === 'requirements'} onClick={() => setPanel('requirements')}>当前要求</button><button type="button" aria-pressed={panel === 'assistant'} onClick={() => setPanel('assistant')}>原生导演助手</button></div>{panel === 'requirements' ? <div className={css.requirements}><h2>当前镜头要求</h2><h3>对白</h3><p>{dialogue.join(' / ') || '本镜暂无对白。'}</p><AutomaticFrameRequirementsEditor projectId={projectId} episodeId={episodeId} shotId={current.shotId} port={port} onCommitted={onCommitted} /></div> : directorAssistant}</aside>
    </div>
  </section>
}
