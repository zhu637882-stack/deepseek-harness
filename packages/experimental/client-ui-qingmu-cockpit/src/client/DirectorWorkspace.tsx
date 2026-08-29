/** Single-scene composition of canonical shot context, PromptIR editing and Take comparison. */
import { useEffect, useState } from 'react'
import type { QingmuYimengPort, YimengWorkflowProjection } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { HeroFrameStoryboardCanvas } from './HeroFrameStoryboardCanvas.tsx'
import { PromptIrWorkspace } from './PromptIrWorkspace.tsx'
import { TakeVersionCompareView } from './TakeVersionCompareView.tsx'
import css from './DirectorWorkspace.module.css'
import { ScenePlanningWorkspace } from './ScenePlanningWorkspace.tsx'

/** Props retain Yimeng's scene/frame identities; no director state is persisted here. */
export interface DirectorWorkspaceProps {
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly shotItems: readonly unknown[]
  readonly selectedShotId: string
  readonly onSelectShotId: (id: string) => void
  readonly onUnsavedChange: (dirty: boolean) => void
  readonly onCommitted: () => Promise<YimengWorkflowProjection | undefined>
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
}

/** Render the current scene without selecting assets, promoting Ready or starting generation.
 * @param props Canonical projection and existing command/read ports.
 * @returns Scoped director workspace.
 */
export function DirectorWorkspace(props: DirectorWorkspaceProps) {
  const [productionMounted, setProductionMounted] = useState(false)
  const [planningDirty, setPlanningDirty] = useState(false)
  const [promptDirty, setPromptDirty] = useState(false)
  useEffect(() => {
    props.onUnsavedChange(planningDirty || promptDirty)
    return () => { props.onUnsavedChange(false) }
  }, [planningDirty, promptDirty, props.onUnsavedChange])
  return <>
    <ScenePlanningWorkspace key={`${props.projectId}:${props.episodeId}`} {...props} onUnsavedChange={setPlanningDirty} />
    <details onToggle={(event) => { if (event.currentTarget.open) setProductionMounted(true) }}>
      <summary>已有提示词、Take 与高级分镜</summary>
      {productionMounted && <ExistingDirectorWorkspace {...props} onUnsavedChange={setPromptDirty} />}
    </details>
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
      <PromptIrWorkspace {...props} storyboardRevisionId={relations.storyboardRevision.revisionId}
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
