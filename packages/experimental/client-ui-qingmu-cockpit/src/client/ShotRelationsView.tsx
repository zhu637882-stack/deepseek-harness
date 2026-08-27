import type {
  YimengShotRelationElementKind,
  YimengShotRelationsProjection,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuCockpitKey } from './locales.ts'
import css from './QingmuCockpit.module.css'

export interface ShotRelationsViewProps {
  readonly relations: YimengShotRelationsProjection
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly t: (key: QingmuCockpitKey) => string
}

const ELEMENT_LABELS = {
  actor: 'shotRelationActor',
  scene: 'shotRelationSceneElement',
  prop: 'shotRelationProp',
} as const satisfies Record<YimengShotRelationElementKind, QingmuCockpitKey>

/** One transient selector over Yimeng's rebuildable relation projection. */
export function ShotRelationsView({ relations, selectedShotId, onSelectShotId, t }: ShotRelationsViewProps) {
  const selectedShot = relations.shots.find(shot => shot.shotId === selectedShotId)
  const orderedShots = [...relations.shots].sort((left, right) => left.frameNo - right.frameNo)
  const scene = selectedShot === undefined
    ? undefined
    : relations.scenes.find(item => item.sceneId === selectedShot.sceneId)
  const dialogueSummary = selectedShot === undefined
    ? ''
    : `${selectedShot.dialogueRhythm.cueCount} ${t('shotRiverCueUnit')} · ${selectedShot.dialogueRhythm.timedCueCount} ${t('shotRiverTimed')}`
  const referenceSummary = selectedShot === undefined
    ? ''
    : `${selectedShot.elements.filter(element => element.currentReferenceAvailability === 'available').length}/${selectedShot.elements.length} ${t('shotRiverReferencesBound')}`

  return (
    <section className={css.shotRelations} aria-label={t('shotRelationsTitle')}>
      <dl className={css.relationAuthority}>
        <div><dt>{t('shotRelationRevision')}</dt><dd>{relations.storyboardRevision.revisionId}</dd></div>
        <div><dt>{t('shotRelationRevisionVersion')}</dt><dd>{relations.storyboardRevision.revisionVersion}</dd></div>
        <div><dt>{t('shotRelationSourceHash')}</dt><dd>{relations.storyboardRevision.sourceSha256}</dd></div>
      </dl>

      {relations.shots.length === 0
        ? <p className={css.empty}>{t('shotsEmpty')}</p>
        : (
          <ol className={css.shotRiver} aria-label={t('shotRiver')}>
            {orderedShots.slice(0, 80).map((shot) => {
              const availableReferences = shot.elements.filter(
                element => element.currentReferenceAvailability === 'available',
              ).length
              return (
                <li key={shot.shotId}>
                  <button
                    type="button"
                    className={shot.shotId === selectedShotId ? css.shotRiverSelected : undefined}
                    aria-pressed={shot.shotId === selectedShotId}
                    onClick={() => { onSelectShotId(shot.shotId) }}
                  >
                    <span className={css.shotRiverNumber}>{String(shot.frameNo).padStart(2, '0')}</span>
                    <strong>{shot.title ?? shot.shotId}</strong>
                    <small>{shot.shotId}</small>
                    <span className={css.shotRiverMeta}>
                      <small>{shot.durationSec} {t('shotRiverSeconds')}</small>
                      <small>{shot.dialogueRhythm.cueCount} {t('shotRiverCueUnit')} · {shot.dialogueRhythm.timedCueCount} {t('shotRiverTimed')}</small>
                      <small>{availableReferences}/{shot.elements.length} {t('shotRiverReferencesBound')}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}

      {selectedShot === undefined
        ? <p className={css.empty}>{t('shotRelationChoose')}</p>
        : (
          <div className={css.relationGrid} data-shot-id={selectedShot.shotId}>
            <article>
              <h4>{t('shotRelationScene')}</h4>
              <dl>
                <div><dt>{t('shotRelationShotId')}</dt><dd>{selectedShot.shotId}</dd></div>
                <div><dt>{t('shotRiverFrameNo')}</dt><dd>{selectedShot.frameNo}</dd></div>
                <div><dt>{t('shotRiverDuration')}</dt><dd>{selectedShot.durationSec} {t('shotRiverSeconds')}</dd></div>
                <div><dt>{t('shotRiverDialogue')}</dt><dd>{dialogueSummary}</dd></div>
                <div><dt>{t('shotRiverReferences')}</dt><dd>{referenceSummary}</dd></div>
                <div><dt>{t('shotRelationSceneId')}</dt><dd>{selectedShot.sceneId}</dd></div>
                <div><dt>{t('shotRelationSceneName')}</dt><dd>{scene?.name ?? t('unknown')}</dd></div>
                <div><dt>{t('shotRelationProfileRevision')}</dt><dd>{scene?.profileRevision ?? t('unknown')}</dd></div>
                <div><dt>{t('shotRelationSnapshotHash')}</dt><dd>{scene?.snapshotSha256 ?? t('unknown')}</dd></div>
              </dl>
            </article>

            <article>
              <h4>{t('shotRelationBeats')}</h4>
              {selectedShot.beats.length === 0
                ? <p className={css.empty}>{t('shotRelationNoBeats')}</p>
                : <ol className={css.relationList}>{selectedShot.beats.map(beat => (
                  <li key={beat.beatId}>
                    <strong>{beat.beatId}</strong>
                    <span>{beat.type} · {beat.startSec}–{beat.endSec}s</span>
                    <p>{beat.visualResponsibility}</p>
                    <small>{t('shotRelationActors')}: {beat.actorIds.join(', ') || t('empty')}</small>
                    <small>{t('shotRelationProps')}: {beat.propIds.join(', ') || t('empty')}</small>
                  </li>
                ))}</ol>}
            </article>

            <article>
              <h4>{t('shotRelationElements')}</h4>
              <ul className={css.relationList}>{selectedShot.elements.map(element => (
                <li key={`${element.elementKind}:${element.elementId}`}>
                  <span>{t(ELEMENT_LABELS[element.elementKind])}</span>
                  <strong>{element.name || element.elementId}</strong>
                  <small>{element.elementId}</small>
                  <small>{t('shotRelationProfileRevision')}: {element.profileRevision}</small>
                  <small>{t('shotRelationSnapshotHash')}: {element.snapshotSha256}</small>
                  <small>{t('shotRelationCurrentReference')}: {element.currentReferenceAvailability === 'available'
                    ? t('shotRelationReferenceAvailable')
                    : t('shotRelationReferenceMissing')}</small>
                  {element.currentReference === null ? null : <>
                    <small>{t('shotRelationReferenceAssetId')}: {element.currentReference.assetId}</small>
                    <small>{t('shotRelationReferenceSha')}: {element.currentReference.sha256}</small>
                    <small>{t('shotRelationReferenceSubject')}: <code>{element.currentReference.lineage.projectId} · {element.currentReference.lineage.sourceEpisodeId ?? t('empty')} · {element.currentReference.lineage.ownerType}:{element.currentReference.lineage.ownerId}</code></small>
                    <small>{t('shotRelationReferenceRole')}: {element.currentReference.lineage.role}</small>
                    <small>{t('shotRelationReferenceGenerationJob')}: <code>{element.currentReference.lineage.generationJobId ?? t('empty')}</code></small>
                    <small>{t('shotRelationReferenceSourceRevision')}: <code>{element.currentReference.lineage.sourceRevisionId ?? t('empty')}</code></small>
                    <small>{t('shotRelationReferenceConsistencyCheck')}: <code>{element.currentReference.lineage.formalConsistencyCheckId ?? t('empty')}</code></small>
                  </>}
                </li>
              ))}</ul>
            </article>
          </div>
        )}
    </section>
  )
}
