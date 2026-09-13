/** Single-scene composition of canonical shot context, PromptIR editing and Take comparison. */
import { useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort, YimengWorkflowProjection } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { HeroFrameStoryboardCanvas } from './HeroFrameStoryboardCanvas.tsx'
import { PromptIrWorkspace } from './PromptIrWorkspace.tsx'
import { TakeVersionCompareView } from './TakeVersionCompareView.tsx'
import css from './DirectorWorkspace.module.css'
import { ScenePlanningWorkspace } from './ScenePlanningWorkspace.tsx'
import { SceneReferenceWorkspace } from './SceneReferenceWorkspace.tsx'
import type { DirectorContextClientPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { QingmuHostSync } from './host-sync.ts'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { NativeDirectorSessionPort } from './native-director-session.ts'
import { useNativeDialogueExecution } from './NativeDialogueProgress.tsx'

/** Props retain Yimeng's scene/frame identities; no director state is persisted here. */
export interface DirectorWorkspaceProps {
  readonly presentation?: 'planning' | 'assistant' | undefined
  readonly nativePromptMode?: 'shot' | 'cut-sound' | undefined
  readonly nativePromptReady?: boolean | undefined
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly shotItems: readonly unknown[]
  readonly selectedShotId: string
  readonly onSelectShotId: (id: string) => void
  readonly onOpenShooting?: ((shotId: string) => void) | undefined
  readonly onUnsavedChange: (dirty: boolean) => void
  readonly onCommitted: () => Promise<YimengWorkflowProjection | undefined>
  readonly port: QingmuYimengPort
  readonly directorBridge: DirectorContextClientPort
  readonly directorSessionId: string | undefined
  readonly directorConnection?: HostDescriptionSource | undefined
  readonly directorRefresh?: number | undefined
  readonly nativeDirectorSession?: NativeDirectorSessionPort | undefined
  readonly hostSync?: QingmuHostSync | undefined
  readonly t: (key: QingmuCockpitKey) => string
}

/** Render the current scene without selecting assets, promoting Ready or starting generation.
 * @param props Canonical projection and existing command/read ports.
 * @returns Scoped director workspace.
 */
export function DirectorWorkspace(props: DirectorWorkspaceProps) {
  const currentProjection = props.projection?.projectId === props.projectId
    && props.projection.episodeId === props.episodeId ? props.projection : undefined
  const selectedShot = currentProjection?.director.shotRelations.shots.find(shot => shot.shotId === props.selectedShotId)
  const canonicalDirectorScope = selectedShot ? {
    projectId: props.projectId, episodeId: props.episodeId,
    sceneId: selectedShot.sceneId, shotId: selectedShot.shotId,
  } : null
  const [productionMounted, setProductionMounted] = useState(false)
  const [productionOpen, setProductionOpen] = useState(false)
  const execution = useNativeDialogueExecution(props.nativeDirectorSession, props.directorSessionId)
  const reviewReady = execution?.status === 'input_prepared' && canonicalDirectorScope
    && Object.entries(canonicalDirectorScope).every(([key, value]) => execution.scope[key as keyof typeof execution.scope] === value)
    ? `${props.directorSessionId}:${execution.commandReceiptId}` : null
  useEffect(() => {
    if (reviewReady) { setProductionMounted(true); setProductionOpen(true) }
  }, [reviewReady])
  const [planningOpen, setPlanningOpen] = useState(false)
  const planningPanel = useRef<HTMLDetailsElement>(null)
  const [planningDirty, setPlanningDirty] = useState(false)
  const [promptDirty, setPromptDirty] = useState(false)
  const [referenceDirty, setReferenceDirty] = useState(false)
  const [selectionNotice, setSelectionNotice] = useState('')
  const selectShot = (nextShotId: string) => {
    if (nextShotId !== props.selectedShotId && referenceDirty
      && !window.confirm('当前镜头的引用草稿尚未保存。切换镜头会保留服务器草稿，但会丢失这次试排，继续吗？')) return false
    setSelectionNotice('')
    props.onSelectShotId(nextShotId)
    return true
  }
  useEffect(() => {
    props.onUnsavedChange(planningDirty || promptDirty || referenceDirty)
    return () => { props.onUnsavedChange(false) }
  }, [planningDirty, promptDirty, referenceDirty, props.onUnsavedChange])
  const planning = <ScenePlanningWorkspace key={`${props.projectId}:${props.episodeId}`} {...props} onSelectShotId={selectShot}
    canonicalDirectorScope={canonicalDirectorScope}
    canonicalDirectorRevision={JSON.stringify(currentProjection?.director.shotRelations.storyboardRevision)}
    onUnsavedChange={setPlanningDirty} />
  const hasPlannedShots = (currentProjection?.director.shotRelations.shots.length ?? 0) > 0
  return <>
    {props.presentation !== 'assistant' && currentProjection?.director.shotRelations && <SceneReferenceWorkspace
      projectId={props.projectId} relations={currentProjection.director.shotRelations}
      selectedShotId={props.selectedShotId} onSelectShotId={(id) => {
        if (id !== props.selectedShotId && planningDirty) {
          setSelectionNotice('请先保存或恢复下方正在编辑的分镜，再切换镜头。')
          setPlanningOpen(true)
          return
        }
        selectShot(id)
      }} guardUnsavedNavigation={false}
      onUnsavedChange={setReferenceDirty} onOpenShooting={props.onOpenShooting} port={props.port}
      onRequestDirector={() => { setPlanningOpen(true); requestAnimationFrame(() => { planningPanel.current?.scrollIntoView({ block: 'start' }) }) }} />}
    {selectionNotice && <p role="status">{selectionNotice}</p>}
    {props.presentation === 'assistant' ? planning : <details ref={planningPanel} open={!hasPlannedShots || planningOpen || planningDirty}
      onToggle={(event) => { if (hasPlannedShots && !planningDirty) setPlanningOpen(event.currentTarget.open) }}>
      <summary>场景规划与导演助手</summary>
      {planning}
    </details>}
    {props.presentation !== 'assistant' && <details open={productionOpen} onToggle={(event) => {
      setProductionOpen(event.currentTarget.open)
      if (event.currentTarget.open) setProductionMounted(true)
    }}>
      <summary>已有提示词、Take 与高级分镜</summary>
      {productionMounted && <ExistingDirectorWorkspace {...props} onSelectShotId={selectShot} onUnsavedChange={setPromptDirty} />}
    </details>}
  </>
}

function ExistingDirectorWorkspace(props: DirectorWorkspaceProps) {
  const { projection, selectedShotId, onSelectShotId, t } = props
  const [showTakes, setShowTakes] = useState(true)
  const [showCanvas, setShowCanvas] = useState(false)
  const relations = projection?.director.shotRelations
  const shot = relations?.shots.find(item => item.shotId === selectedShotId)
  const scene = relations?.scenes.find(item => item.sceneId === shot?.sceneId)
  if (relations === undefined) return <p role="status">{t('directorChooseEpisode')}</p>
  const revisionId = relations.storyboardRevision.revisionId
  if (revisionId === null) return <p role="status">尚未生成分镜，请先在场景规划与导演助手中设计镜头。</p>
  return <section className={css.workspace} aria-label={t('directorTitle')}>
    <nav className={css.shots} aria-label={t('directorSceneShots')}>
      <h3>{t('directorSceneShots')}</h3>
      {relations.scenes.map(item => <section key={item.sceneId}>
        <h4>{item.name}</h4>
        {relations.shots.filter(candidate => candidate.sceneId === item.sceneId).map(candidate => (
          <button type="button" key={candidate.shotId} aria-pressed={candidate.shotId === selectedShotId}
            onClick={() => { onSelectShotId(candidate.shotId) }}>
            <span>{String(candidate.frameNo).padStart(2, '0')} · {candidate.title ?? t('promptIrFrame')}</span>
            <small>{candidate.durationSec}s · {candidate.beats.length} {t('directorBeats')}</small>
          </button>
        ))}
      </section>)}
    </nav>
    <div className={css.content}>
      <header><p>{scene?.name ?? t('unknown')}</p><h2>{shot?.title ?? t('directorTitle')}</h2>
        <p>{t('directorBoundary')}</p></header>
      <details open={showTakes} onToggle={(event) => { setShowTakes(event.currentTarget.open) }}>
        <summary>{t('directorCompareTakes')}</summary>
        {showTakes && <TakeVersionCompareView {...props} enabled readOnly />}
      </details>
      <PromptIrWorkspace {...props} storyboardRevisionId={revisionId}
        {...(shot ? { nativeDirector: { bridge: props.directorBridge, sessionId: props.directorSessionId,
          connection: props.directorConnection,
          scope: { projectId: props.projectId, episodeId: props.episodeId, sceneId: shot.sceneId, shotId: shot.shotId } } } : {})}
        presentation="director" onCommitted={async () => { await props.onCommitted() }} />
      <details onToggle={(event) => { setShowCanvas(event.currentTarget.open) }}>
        <summary>{t('directorStoryboard')}</summary>
        {showCanvas && <HeroFrameStoryboardCanvas {...props} relations={relations}
          heroFrameStoryboards={projection?.director.heroFrameStoryboards} />}
      </details>
    </div>
    <aside className={css.properties} aria-label={t('directorContext')}>
      <details open><summary>{t('directorContext')}</summary>
        <p>{t('directorContextBoundary')}</p>
        <dl><dt>{t('directorDuration')}</dt><dd>{shot?.durationSec ?? '—'}s</dd></dl>
        <h4>{t('directorBeats')}</h4>
        {shot?.beats.map(beat => <p key={beat.beatId}><small>{beat.startSec}–{beat.endSec}s</small><br />{beat.visualResponsibility}</p>)}
        <h4>{t('directorDialogue')}</h4>
        {shot?.dialogueRhythm.cues.map((cue, index) => <p key={cue.lineId ?? index}>{cue.verbatimText}</p>)}
        <h4>{t('directorElements')}</h4>
        <ul>{shot?.elements.map(item => <li key={`${item.elementKind}:${item.elementId}`}>{item.name}</li>)}</ul>
      </details>
    </aside>
  </section>
}
