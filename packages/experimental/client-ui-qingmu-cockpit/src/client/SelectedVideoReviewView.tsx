import { useEffect, useState } from 'react'
import type {
  QingmuYimengReadPort, YimengSelectedVideoReviewResponse, YimengSelectedVideoReviewStatus, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import card from './QingmuCockpit.module.css'
import css from './SelectedVideoReviewView.module.css'

interface SelectedVideoReviewViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengReadPort, 'selectedVideoReview'>
  readonly t: (key: QingmuCockpitKey) => string
}

interface RequestIdentity {
  readonly source: YimengWorkflowProjection
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly refresh: number
  readonly port: SelectedVideoReviewViewProps['port']
}

type ReviewState = RequestIdentity & (
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: YimengSelectedVideoReviewResponse }
  | { readonly status: 'error'; readonly message: string }
)

const STATUS: Readonly<Record<YimengSelectedVideoReviewStatus, QingmuCockpitKey>> = {
  accepted: 'videoReviewAccepted', rejected: 'videoReviewRejected', pending: 'videoReviewPending',
  stale: 'videoReviewStale', invalid: 'videoReviewUnavailable',
}
const DEFECTS: Readonly<Record<string, QingmuCockpitKey>> = {
  character_identity: 'videoReviewDefectCharacter', scene: 'videoReviewDefectScene', costume_prop: 'videoReviewDefectProp',
  blocking_composition: 'videoReviewDefectBlocking', eye_interaction: 'videoReviewDefectEye',
  action_performance: 'videoReviewDefectAction', narrative_mismatch: 'videoReviewDefectNarrative',
  temporal_drift: 'videoReviewDefectTemporal', audio_subtitle: 'videoReviewDefectAudio', technical_artifact: 'videoReviewDefectTechnical',
}
const CHECKS: Readonly<Record<string, QingmuCockpitKey>> = {
  identityContinuityAccepted: 'videoReviewCheckIdentity', actionNarrativeAccepted: 'videoReviewCheckAction',
  audioSubtitleAccepted: 'videoReviewCheckAudio', technicalArtifactsAccepted: 'videoReviewCheckTechnical',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesSubject(value: unknown, identity: RequestIdentity): value is YimengSelectedVideoReviewResponse {
  if (!record(value) || value.schema !== 'qingmu.yimeng-selected-video-review.v1'
    || value.projectId !== identity.projectId || value.episodeId !== identity.episodeId || value.frameId !== identity.selectedShotId
    || value.readOnly !== true || value.providerCalls !== 0 || value.taskMutation !== false || value.budgetMutation !== false
    || value.humanSignoffInferred !== false) return false
  if (value.selected === null) return value.selectedAssetId === null
  const selected = value.selected
  if (!record(selected) || typeof selected.assetId !== 'string' || selected.assetId === ''
    || selected.assetId !== value.selectedAssetId || selected.isSelected !== true || selected.selectionStatus !== 'Selected'
    || typeof selected.formalReviewStatus !== 'string' || !Object.hasOwn(STATUS, selected.formalReviewStatus)
    || selected.formalReviewAccepted !== (selected.formalReviewStatus === 'accepted')) return false
  const review = selected.formalReview
  if (selected.formalReviewStatus !== 'accepted' && selected.formalReviewStatus !== 'rejected') return review === null
  // The Host verifies full evidence. The browser additionally rejects responses from a different visible revision or Shot.
  return record(review) && review.version === 'formal-video-human-review-v1' && review.reviewScope === 'full_video'
    && review.decision === selected.formalReviewStatus && review.projectId === identity.projectId
    && review.episodeId === identity.episodeId && review.frameId === identity.selectedShotId
    && typeof selected.sha256 === 'string' && /^[0-9a-f]{64}$/.test(selected.sha256) && review.assetSha256 === selected.sha256
    && review.formalVideoAssetId === selected.assetId
    && review.storyboardRevision === identity.source.director.shotRelations.storyboardRevision.episodeRevision
    && record(review.checks) && (review.defects === null || Array.isArray(review.defects))
}

/** Read-only existing review on the same canonical Shot; no media load, selection, or approval actions. */
export function SelectedVideoReviewView({
  projectId, episodeId, selectedShotId, projection, enabled, port, t,
}: SelectedVideoReviewViewProps) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ReviewState>()
  const selectedShot = projection?.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  const eligible = enabled && projection !== undefined && selectedShot !== undefined
    && projection.projectId === projectId && projection.episodeId === episodeId

  useEffect(() => {
    if (!eligible) { setState(undefined); return }
    const controller = new AbortController()
    let live = true
    const identity = { source: projection, projectId, episodeId, selectedShotId, refresh, port }
    setState({ ...identity, status: 'loading' })
    const load = async () => {
      try {
        const response: unknown = await port.selectedVideoReview({ projectId, episodeId, frameId: selectedShotId }, controller.signal)
        if (!live) return
        if (!matchesSubject(response, identity)) throw new Error(t('videoReviewInvalid'))
        setState({ ...identity, status: 'ready', result: response })
      } catch (cause) {
        if (live) setState({ ...identity, status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    void load()
    return () => { live = false; controller.abort() }
  }, [eligible, episodeId, port, projectId, projection, refresh, selectedShotId, t])

  const current = eligible && state?.source === projection && state.projectId === projectId && state.episodeId === episodeId
    && state.selectedShotId === selectedShotId && state.refresh === refresh && state.port === port ? state : undefined
  const result = current?.status === 'ready' ? current.result : undefined
  const asset = result?.selected
  const review = asset?.formalReview
  const loading = eligible && (current === undefined || current.status === 'loading')
  const label = (labels: Readonly<Record<string, QingmuCockpitKey>>, key: string) => {
    const mapped = Object.hasOwn(labels, key) ? labels[key] : undefined
    return mapped === undefined ? key : t(mapped)
  }

  return <section className={`${card.card} ${css.review}`} aria-label={t('videoReviewTitle')}>
    <div className={css.header}>
      <div><h3>{t('videoReviewTitle')}</h3><p>{t('videoReviewBoundary')}</p></div>
      <button type="button" disabled={!eligible || loading} onClick={() => { setRefresh(value => value + 1) }}>{t('videoReviewRefresh')}</button>
    </div>
    {!eligible && enabled && <p>{t('videoReviewChoose')}</p>}
    {loading && <p role="status">{t('videoReviewLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>{t('videoReviewError')}: {current.message}</p>}
    {result?.selected === null && <p role="status">{t('videoReviewNoSelected')}</p>}
    {asset !== undefined && asset !== null && <div className={css.body}>
      <div className={css.status} role="status" data-review-status={asset.formalReviewStatus}>
        <strong>{t(STATUS[asset.formalReviewStatus])}</strong>
        <span>#{selectedShot?.frameNo} · <code>{selectedShotId}</code></span>
        <small>{t('videoReviewAsset')}: <code>{asset.assetId}</code> · {t('videoReviewVersion')} {asset.version}</small>
      </div>
      {asset.formalReviewStatus === 'stale' && <p className={css.notice}>{t('videoReviewStaleHelp')}</p>}
      {asset.formalReviewStatus === 'invalid' && <p className={css.notice}>{t('videoReviewInvalidHelp')}</p>}
      {review?.machineFailureExceptionAccepted === true && <p className={css.notice}>{t('videoReviewMachineException')}</p>}
      <p className={css.boundary}>{t('videoReviewAuthorityBoundary')}</p>
      {review !== undefined && review !== null && <>
        <div className={css.defects}>
          <h4>{t('videoReviewDefects')}{review.defects === null ? '' : ` · ${String(review.defects.length)}`}</h4>
          <p>{t('videoReviewDefectsBoundary')}</p>
          {review.defects === null ? <p>{t('videoReviewMissingDefects')}</p>
            : review.defects.length === 0 ? <p>{t('videoReviewNoDefects')}</p>
              : <ol aria-label={t('videoReviewDefects')}>{review.defects.map((defect, index) => <li key={index}>
                <div><strong>{label(DEFECTS, defect.defectType)}</strong>
                  <span>{defect.timecodeSec === null ? t('videoReviewNoTimecode') : `${String(defect.timecodeSec)} s`}</span></div>
                <p>{defect.note}</p>
              </li>)}</ol>}
        </div>
        {review.reviewNote !== null && review.reviewNote !== '' && <div><h4>{t('videoReviewNote')}</h4><p>{review.reviewNote}</p></div>}
      </>}
      <details className={css.details}>
        <summary>{t('videoReviewEvidence')}</summary>
        <p>{t('videoReviewBindingBoundary')}</p>
        <dl className={css.evidence}>{([
          ['videoReviewSha', asset.sha256], ['videoReviewTask', asset.taskId], ['videoReviewProviderTask', asset.providerTaskId],
          ['videoReviewBlocker', asset.formalReviewBlockerCode],
        ] as const).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd><code>{value ?? t('unknown')}</code></dd></div>)}</dl>
        {review !== undefined && review !== null && <>
          <dl className={css.evidence}>
            <div><dt>{t('videoReviewReviewer')}</dt><dd>{review.reviewer}</dd></div>
            <div><dt>{t('videoReviewRevision')}</dt><dd>{review.storyboardRevision}</dd></div>
            <div><dt>{t('videoReviewFrameSha')}</dt><dd><code>{review.frameContentSha256 ?? t('videoReviewLegacyBinding')}</code></dd></div>
            <div><dt>{t('videoReviewPlayback')}</dt><dd>{Math.round(review.playbackProgress * 100)}%</dd></div>
          </dl>
          <h4>{t('videoReviewChecks')}</h4>
          <dl className={css.evidence}>{Object.entries(review.checks).map(([key, value]) => <div key={key}>
            <dt>{label(CHECKS, key)}</dt><dd>{t(value ? 'videoReviewCheckYes' : 'videoReviewCheckNo')}</dd>
          </div>)}</dl>
        </>}
      </details>
    </div>}
  </section>
}
