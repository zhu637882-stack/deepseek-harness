import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengReadPort,
  YimengEditorialHandoffResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './EditorialHandoff.module.css'

interface Props {
  readonly projectId: string
  readonly episodeId: string
  readonly port: QingmuYimengReadPort
  readonly t: (key: QingmuCockpitKey) => string
}

const BLOCKER_KEYS: Readonly<Record<string, QingmuCockpitKey>> = {
  editorial_handoff_selected_take_missing: 'handoffBlockerSelectedTake',
  editorial_handoff_selected_media_missing: 'handoffBlockerMediaMissing',
  editorial_handoff_selected_media_sha_missing: 'handoffBlockerMediaShaMissing',
  editorial_handoff_selected_media_drift: 'handoffBlockerMediaDrift',
  editorial_handoff_selected_media_type_mismatch: 'handoffBlockerMediaType',
  editorial_handoff_selected_media_metadata_missing: 'handoffBlockerMediaMetadata',
  editorial_handoff_selected_take_lineage_incomplete: 'handoffBlockerLineageIncomplete',
  editorial_handoff_selected_take_qc_not_passed: 'handoffBlockerQcNotPassed',
  editorial_handoff_selected_audio_missing: 'handoffBlockerAudioMissing',
  editorial_handoff_selected_audio_multiple: 'handoffBlockerAudioMultiple',
  editorial_handoff_selected_audio_scope_invalid: 'handoffBlockerAudioScope',
  editorial_handoff_selected_audio_quality_not_passed: 'handoffBlockerAudioQuality',
  editorial_handoff_selected_audio_metadata_missing: 'handoffBlockerAudioMetadata',
  editorial_handoff_selected_audio_media_missing: 'handoffBlockerAudioMediaMissing',
  editorial_handoff_selected_audio_media_drift: 'handoffBlockerAudioDrift',
  editorial_handoff_selected_audio_media_type_mismatch: 'handoffBlockerAudioMediaType',
  editorial_handoff_selected_audio_quality_evidence_invalid: 'handoffBlockerAudioEvidence',
  editorial_handoff_selected_audio_lineage_incomplete: 'handoffBlockerAudioLineage',
  editorial_handoff_selected_audio_formalization_incomplete: 'handoffBlockerAudioFormalization',
  editorial_handoff_selected_audio_source_incomplete: 'handoffBlockerAudioSource',
  editorial_handoff_audio_video_duration_mismatch: 'handoffBlockerDurationMismatch',
  editorial_handoff_video_fps_mismatch: 'handoffBlockerFpsMismatch',
  editorial_handoff_qc_record_missing: 'handoffBlockerQcMissing',
  editorial_handoff_qc_binding_unverified: 'handoffBlockerQcStale',
  editorial_handoff_approval_record_missing: 'handoffBlockerApprovalMissing',
  editorial_handoff_approval_binding_unverified: 'handoffBlockerApprovalStale',
  editorial_handoff_otio_dependency_unavailable: 'handoffBlockerOtioUnavailable',
  editorial_handoff_otio_adapter_unverified: 'handoffBlockerOtioUnverified',
}

/** Read-only E8 editorial handoff draft. No button on this panel writes business state. */
export function EditorialHandoff({ projectId, episodeId, port, t }: Props) {
  const [projection, setProjection] = useState<YimengEditorialHandoffResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [download, setDownload] = useState<{
    readonly status: 'idle' | 'running' | 'succeeded' | 'failed'
    readonly sha256?: string
    readonly size?: number
    readonly errorCode?: string
  }>({ status: 'idle' })
  const generation = useRef(0)
  const downloadGeneration = useRef(0)
  const activeController = useRef<AbortController>()

  const load = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++generation.current
    activeController.current?.abort()
    downloadGeneration.current += 1
    const controller = new AbortController()
    activeController.current = controller
    setProjection(undefined)
    setDownload({ status: 'idle' })
    setLoading(true)
    setError(undefined)
    try {
      const value = await port.editorialHandoff({ projectId, episodeId }, controller.signal)
      if (current === generation.current) setProjection(value)
    } catch (cause) {
      if (current === generation.current) {
        setProjection(undefined)
        const message = cause instanceof Error ? cause.message : ''
        setError(message === 'internal: SOURCE_DRIFT' ? t('handoffSourceDrift')
          : message === '' ? t('handoffLoadFailed') : message)
      }
    } finally {
      if (current === generation.current) {
        activeController.current = undefined
        setLoading(false)
      }
    }
  }, [episodeId, port, projectId, t])

  useEffect(() => {
    setProjection(undefined)
    void load()
    return () => {
      generation.current += 1
      downloadGeneration.current += 1
      activeController.current?.abort()
      activeController.current = undefined
    }
  }, [load])

  const startDownload = useCallback(async () => {
    const hostAccess = projection?.download.hostAccess
    if (projection?.download.available !== true || hostAccess === undefined
      || download.status === 'running') return
    const current = ++downloadGeneration.current
    const params = new URLSearchParams({
      projectId, episodeId,
      sourceSnapshotSha256: projection.sourceSnapshotSha256,
      projectionSha256: projection.projectionSha256,
      requestId: hostAccess.requestId,
      capability: hostAccess.capability,
    })
    setDownload({ status: 'running' })
    const anchor = document.createElement('a')
    anchor.href = `/api/qingmu/editorial-handoff/download?${params.toString()}`
    anchor.download = 'qingmu-editorial-handoff.otio.zip'
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    const statusUrl = `/api/qingmu/editorial-handoff/download-status?${params.toString()}`
    for (let attempt = 0; attempt < 2400; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 500))
      try {
        const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store' })
        const body = await response.json() as {
          status?: string
          sha256?: string | null
          size?: number | null
          errorCode?: string | null
        }
        if (body.status === 'succeeded' && typeof body.sha256 === 'string'
          && typeof body.size === 'number') {
          if (current === downloadGeneration.current) {
            setDownload({ status: 'succeeded', sha256: body.sha256, size: body.size })
          }
          return
        }
        if (body.status === 'failed') {
          if (current === downloadGeneration.current) {
            setDownload({ status: 'failed', errorCode: body.errorCode ?? 'download_failed' })
          }
          return
        }
      } catch {
        // The same request id remains recoverable from Host status; polling does not start another download.
      }
    }
    if (current === downloadGeneration.current) {
      setDownload({ status: 'failed', errorCode: 'download_status_timeout' })
    }
  }, [download.status, episodeId, projectId, projection])

  if (projectId === '' || episodeId === '') return <p className={css.empty}>{t('handoffChooseEpisode')}</p>
  const blockerLabel = (code: string) => t(BLOCKER_KEYS[code] ?? 'handoffBlockerUnknown')
  return <section className={css.panel} aria-labelledby="qingmu-editorial-handoff-title">
    <header className={css.header}>
      <div>
        <h3 id="qingmu-editorial-handoff-title">{t('handoffTitle')}</h3>
        <p>{t('handoffBoundary')}</p>
      </div>
      <button type="button" disabled={loading} onClick={() => { void load() }}>
        {loading ? t('handoffLoading') : t('handoffRefresh')}
      </button>
    </header>
    {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
    {projection !== undefined && <>
      <div className={css.readiness} role="status" aria-atomic="true">
        <span>{t('handoffProductionReady')}: <strong>{t('handoffFalse')}</strong></span>
        <span>{t('handoffReleaseReady')}: <strong>{t('handoffFalse')}</strong></span>
      </div>
      <div className={css.metrics}>
        <span><strong>{projection.summary.shotCount}</strong>{t('handoffShots')}</span>
        <span><strong>{projection.summary.selectedTakeCount}</strong>{t('handoffSelectedTakes')}</span>
        <span><strong>{projection.summary.totalDurationSec.toFixed(2)}s</strong>{t('handoffDuration')}</span>
        <span><strong>{projection.summary.authoritativeAudioCount}</strong>{t('handoffAudio')}</span>
        <span><strong>{projection.summary.unresolvedCount}</strong>{t('handoffUnresolved')}</span>
      </div>
      <ol className={css.shots} aria-label={t('handoffShotList')}>
        {projection.source.shots.map(shot => <li key={shot.frameId}>
          <header><strong>#{shot.frameNo} · {shot.title}</strong><span>{shot.sceneId ?? t('unknown')}</span></header>
          {shot.selectedTake === null
            ? <p className={css.warning}>{t('handoffNoSelectedTake')}</p>
            : <dl>
              <div><dt>{t('handoffTake')}</dt><dd>{shot.selectedTake.assetId}</dd></div>
              <div><dt>{t('handoffMedia')}</dt><dd>{shot.selectedTake.mimeType ?? '—'} · {shot.selectedTake.durationSec ?? '—'}s</dd></div>
              <div><dt>{t('handoffGeometry')}</dt><dd>{shot.selectedTake.aspectRatio ?? '—'} · {shot.selectedTake.fps ?? '—'} fps</dd></div>
              <div><dt>{t('handoffQc')}</dt><dd>{shot.selectedTake.qualityStatus}</dd></div>
              <div><dt>{t('handoffAudio')}</dt><dd>{shot.audio.asset === null
                ? t('handoffAudioUnbound')
                : `${shot.audio.asset.mimeType ?? '—'} · ${shot.audio.asset.durationSec ?? '—'}s`}</dd></div>
            </dl>}
          {shot.blockers.length > 0 && <ul className={css.blockers}>
            {shot.blockers.map(code => <li key={code}>{blockerLabel(code)}</li>)}
          </ul>}
          <details><summary>{t('handoffAdvanced')}</summary>
            <p>Frame SHA: {shot.frameContentSha256}</p>
            <p>Stack SHA: {shot.stackSnapshotSha256}</p>
            {shot.selectedTake !== null && <p>Media SHA: {shot.selectedTake.sha256 ?? '—'}</p>}
          </details>
        </li>)}
      </ol>
      <div className={css.exportBox}>
        <div><strong>{t('handoffDownloadTitle')}</strong>
          <p>{projection.download.blockerCode === null
            ? `${projection.download.otio.distribution} ${projection.download.otio.version} · otio_json`
            : blockerLabel(projection.download.blockerCode)}</p>
          {download.status === 'succeeded' && <p className={css.success} role="status">
            {t('handoffDownloadSucceeded')} · {download.size?.toLocaleString()} bytes<br />SHA-256: {download.sha256}
          </p>}
          {download.status === 'failed' && <p role="alert" className={css.error}>
            {download.errorCode === 'source_stale' ? t('handoffSourceDrift') : t('handoffDownloadFailed')}
          </p>}
        </div>
        <button type="button" disabled={!projection.download.available
        || projection.download.hostAccess === undefined || download.status !== 'idle'}
        title={projection.download.blockerCode === null ? undefined : blockerLabel(projection.download.blockerCode)}
        onClick={() => { void startDownload() }}>
          {download.status === 'running' ? t('handoffDownloading')
            : projection.download.available ? t('handoffDownload') : t('handoffDownloadDisabled')}
        </button>
      </div>
      <details><summary>{t('handoffAdvancedProjection')}</summary>
        <p>Source SHA: {projection.sourceSnapshotSha256}</p>
        <p>Projection SHA: {projection.projectionSha256}</p>
      </details>
    </>}
  </section>
}
