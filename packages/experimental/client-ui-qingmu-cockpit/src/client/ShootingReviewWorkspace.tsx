import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { QingmuYimengPort, YimengTakeVersion, YimengTakeVersionStackResponse, YimengWorkflowProjection } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { TakePreviewPlayer } from './TakePreviewPlayer.tsx'
import { AutomaticFrameRequirementsEditor } from './AutomaticFrameRequirementsEditor.tsx'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker, readTakeVersionSelectionMarker,
  writeTakeVersionSelectionMarker,
} from './take-version-recovery.ts'
import css from './ShootingReviewWorkspace.module.css'

export type ShootingReviewState = 'normal' | 'generating' | 'failed' | 'pending-review'
type Destination = 'director' | 'assets' | 'shots' | 'delivery'
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
  readonly port: Pick<QingmuYimengPort, 'takeVersions' | 'takePreview' | 'selectTakeVersion' | 'recoverTakeVersionSelection'>
    & Partial<Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'>>
  readonly t: (key: QingmuCockpitKey) => string
  /** Isolated visual fixture for UI tests only; production does not infer task state from loading. */
  readonly testState?: ShootingReviewState
}
function usable(version: YimengTakeVersion | undefined): version is YimengTakeVersion & { readonly outputSha256: string } {
  return version !== undefined && version.outputSha256 !== null && version.outputBindingStatus === 'verified'
}
function statusOf(stack: YimengTakeVersionStackResponse | undefined, current: YimengTakeVersion | undefined): ShootingReviewState {
  if (current?.qualityStatus === 'failed' || (current !== undefined && current.outputBindingStatus !== 'verified')) return 'failed'
  return stack?.subject.selectedTakeId === null ? 'pending-review' : 'normal'
}
function message(state: ShootingReviewState, load: 'loading' | 'ready' | 'failed'): string {
  if (load === 'loading') return '正在读取已有候选媒体；读取不代表正在生成。'
  if (load === 'failed') return '候选列表暂不可读取。请刷新只读投影后重试。'
  if (state === 'generating') return '测试状态：正在生成。正式任务状态必须由任务接口提供。'
  if (state === 'failed') return '该候选的真实质量或媒体绑定状态不可用。请检查已有任务与媒体后重试。'
  if (state === 'pending-review') return '候选已就绪。浏览不改变选用，采用需要明确操作。'
  return '当前为已选版本。可浏览其它候选或修改当前要求。'
}
/** Content-first view of existing Takes; it neither dispatches generation nor records human approval. */
export function ShootingReviewWorkspace({ projectName, episodeName, projectId, episodeId, projection, selectedShotId,
  onSelectShotId, onNavigate, onCommitted = async () => undefined, directorAssistant, port, t, testState }: Props) {
  const shots = projection?.director.shotRelations.shots ?? []
  const current = shots.find(shot => shot.shotId === selectedShotId) ?? shots[0]
  const [stack, setStack] = useState<YimengTakeVersionStackResponse>(); const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [browseId, setBrowseId] = useState('')
  const [panel, setPanel] = useState<'requirements' | 'assistant'>('requirements'); const [mediaUrl, setMediaUrl] = useState<string>()
  const [zoom, setZoom] = useState(false); const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 }); const [selecting, setSelecting] = useState(false)
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number }>()
  useEffect(() => {
    if (current === undefined) { setStack(undefined); setLoad('failed'); return }
    const controller = new AbortController(); setLoad('loading'); setStack(undefined)
    void port.takeVersions({ projectId, episodeId, frameId: current.shotId }, controller.signal).then((value) => {
      if (controller.signal.aborted || value.subject.frameId !== current.shotId) return
      setStack(value); setBrowseId(value.subject.selectedTakeId ?? value.subject.versions[0]?.takeId ?? ''); setLoad('ready')
    }).catch(() => { if (!controller.signal.aborted) setLoad('failed') })
    return () => controller.abort()
  }, [current, episodeId, port, projectId])
  useEffect(() => {
    if (current === undefined) return
    const scope = { projectId, episodeId, frameId: current.shotId }
    const marker = readTakeVersionSelectionMarker(scope)
    if (marker.status !== 'ready') return
    void port.recoverTakeVersionSelection(marker.marker).then((result) => {
      if (result.status !== 'committed' || result.result === null) return
      if (result.result.providerCalls !== 0 || result.result.budgetMutation || result.result.humanApprovalInferred) return
      clearTakeVersionSelectionMarker(scope, marker)
      return port.takeVersions(scope).then(setStack)
    }).catch(() => { /* retain exact marker; a later visit can only recover it */ })
  }, [current, episodeId, port, projectId])
  useEffect(() => { const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setZoom(false) }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
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
  const state = testState ?? statusOf(visibleStack, browsed); const primary = usable(browsed) && visibleStack?.capabilities.canSelect === true && !browsed.isSelected && load === 'ready'
  const sourceUrl = mediaUrl ?? heroFrame?.browserUrl
  const dialogue = (current.dialogueRhythm?.cues ?? []).map(cue => cue.verbatimText).filter(Boolean)
  const action = (current.beats ?? []).map(beat => beat.visualResponsibility).filter(Boolean)
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
      let result; try { result = await port.selectTakeVersion(marker) } catch { const recovery = await port.recoverTakeVersionSelection(marker); if (recovery.status !== 'committed' || recovery.result === null) throw new Error('selection recovery pending'); result = recovery.result }
      if (result.providerCalls !== 0 || result.budgetMutation || result.humanApprovalInferred) throw new Error('unsafe selection receipt')
      clearTakeVersionSelectionMarker(marker, { status: 'ready', marker }); setStack(await port.takeVersions({ projectId, episodeId, frameId: activeShot.shotId }))
    } finally { setSelecting(false) }
  }
  return <section className={css.workspace} aria-label="拍摄与审看">
    <header className={css.header}><div><strong>{projectName}</strong><span> / {episodeName}</span></div><nav aria-label="项目步骤"><button type="button" onClick={() => onNavigate('assets')}>故事</button><button type="button" onClick={() => onNavigate('director')}>角色与场景</button><button type="button" onClick={() => onNavigate('shots')}>分镜</button><strong>拍摄与审看</strong><button type="button" onClick={() => onNavigate('delivery')}>导出</button></nav></header>
    <div className={css.grid}>
      <aside className={css.shots} aria-label="镜头列表"><h2>镜头</h2>{shots.map(shot => <button key={shot.shotId} type="button" aria-current={shot.shotId === current.shotId} onClick={() => onSelectShotId(shot.shotId)}><span>镜 {shot.frameNo}</span><small>{shot.title}</small></button>)}</aside>
      <main className={css.stage}>
        <div className={css.media} data-state={testState ?? (load === 'loading' ? 'loading' : state)}>
          {usable(browsed) ? <div className={css.player}><TakePreviewPlayer request={{
            projectId, episodeId, frameId: current.shotId, takeId: browsed.takeId,
            expectedOutputSha256: browsed.outputSha256,
          }} load={port.takePreview} t={t} onPreviewReady={onPreviewReady} /></div>
            : heroFrame !== undefined && heroFrame !== null ? <button type="button" className={css.frame} onClick={() => { resetZoom(); setZoom(true) }} aria-label={`放大查看镜 ${current.frameNo} 首帧`}><img src={heroFrame.browserUrl} alt={`镜 ${current.frameNo} 已选首帧`} /><span>已选首帧</span></button>
              : <div className={css.canvas}><span>镜 {current.frameNo}</span><strong>{current.title}</strong>
                <small>{message(state, load)}</small></div>}
          {load !== 'ready' && <p className={css.mediaNotice} role="status">{message(state, load)}</p>}{state === 'failed' && load === 'ready' && <p className={css.mediaNotice} role="alert">{message(state, load)}</p>}
        </div>
        <div className={css.candidates} aria-label="候选画面">{versions.map(version => <button key={version.takeId} type="button" aria-pressed={version.takeId === browseId} onClick={() => { setBrowseId(version.takeId); setMediaUrl(undefined) }}><span className={css.videoIcon}>视频候选</span><span>候选 v{version.versionOrdinal}</span><strong>{version.isSelected ? '当前选用' : version.qualityStatus}</strong><small>{version.durationSec === null ? '时长未知' : `${version.durationSec} 秒`}</small></button>)}</div>
        <p className={css.browseNote}>{message(state, load)} 单击候选只切换中区媒体，不会改变选用。</p><button className={css.primary} type="button" disabled={!primary || selecting} onClick={() => { void selectCurrent() }}>{primary ? (selecting ? '正在采用候选' : '采用这张') : browsed?.isSelected ? '当前已选用' : '候选不可采用'}</button>
        {sourceUrl !== undefined && <button className={css.zoomButton} type="button" onClick={() => { resetZoom(); setZoom(true) }}>放大画面</button>}
        {zoom && <div className={css.zoom} role="dialog" aria-modal="true" aria-label="放大画面"><div className={css.zoomToolbar}><button type="button" onClick={closeZoom}>关闭放大查看</button><button type="button" onClick={() => setScale(value => Math.min(3, value + 0.25))}>放大</button><button type="button" onClick={() => setScale(value => Math.max(1, value - 0.25))}>缩小</button></div><div className={css.zoomCanvas} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}>{mediaUrl !== undefined ? <video src={mediaUrl} controls autoPlay playsInline style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} /> : heroFrame !== undefined && heroFrame !== null && <img src={heroFrame.browserUrl} alt={`镜 ${current.frameNo} 已选首帧`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />}</div></div>}
      </main>
      <aside className={css.inspector}><div className={css.switcher}><button type="button" aria-pressed={panel === 'requirements'} onClick={() => setPanel('requirements')}>当前要求</button><button type="button" aria-pressed={panel === 'assistant'} onClick={() => setPanel('assistant')}>原生导演助手</button></div>{panel === 'requirements' ? <div className={css.requirements}><h2>当前镜头要求</h2><h3>对白</h3><p>{dialogue.join(' / ') || '当前分镜未提供对白。'}</p><h3>动作</h3><p>{action.join(' / ') || '当前分镜未提供动作节拍。'}</p><h3>机位</h3><p>当前镜头关系投影未提供独立机位字段。</p><AutomaticFrameRequirementsEditor projectId={projectId} episodeId={episodeId} shotId={current.shotId} port={port} onCommitted={onCommitted} /></div> : directorAssistant}</aside>
    </div>
  </section>
}
