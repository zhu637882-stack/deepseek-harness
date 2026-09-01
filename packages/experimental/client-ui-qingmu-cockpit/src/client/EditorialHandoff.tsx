import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengReadPort,
  YimengEditorialHandoffResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './EditorialHandoff.module.css'

interface ImportAccess { readonly requestId: string; readonly capability: string }
interface ImportResult {
  readonly projectId: string
  readonly episodeId: string
  readonly packageSha256: string
  readonly packageSize: number
  readonly receiptMatch: true
  readonly internalValidity: true
  readonly currentAuthority: { readonly matches: boolean }
  readonly preview: {
    readonly tracks: readonly { readonly name: string; readonly kind: string; readonly clipCount: number }[]
    readonly orderedShots: readonly {
      readonly order?: number
      readonly frameId?: string
      readonly frameNo?: number
      readonly videoRange?: { readonly durationSec?: number }
      readonly videoPath?: string
      readonly audioPath?: string
    }[]
    readonly media: readonly { readonly kind: string; readonly path: string; readonly size: number; readonly sha256: string }[]
    readonly unresolved: readonly Record<string, unknown>[]
  }
}

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
  const [importAccess, setImportAccess] = useState<ImportAccess>()
  const [selectedPackage, setSelectedPackage] = useState<File>()
  const [importState, setImportState] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')
  const [importResult, setImportResult] = useState<ImportResult>()
  const [importError, setImportError] = useState<string>()
  const generation = useRef(0)
  const downloadGeneration = useRef(0)
  const importGeneration = useRef(0)
  const activeController = useRef<AbortController>()
  const importController = useRef<AbortController>()
  const importErrorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++generation.current
    activeController.current?.abort()
    downloadGeneration.current += 1
    importGeneration.current += 1
    importController.current?.abort()
    importController.current = undefined
    const controller = new AbortController()
    activeController.current = controller
    setProjection(undefined)
    setDownload({ status: 'idle' })
    setLoading(true)
    setError(undefined)
    try {
      const value = await port.editorialHandoff({ projectId, episodeId }, controller.signal)
      if (current === generation.current) {
        setProjection(value)
        setImportAccess(value.download.hostAccess?.importAccess)
        setImportResult(undefined)
        setImportState('idle')
        setImportError(undefined)
      }
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
      importGeneration.current += 1
      activeController.current?.abort()
      importController.current?.abort()
      activeController.current = undefined
      importController.current = undefined
    }
  }, [load])

  useEffect(() => {
    if (importAccess === undefined) return
    const current = ++importGeneration.current
    importController.current?.abort()
    const controller = new AbortController()
    importController.current = controller
    const params = new URLSearchParams({ projectId, episodeId, ...importAccess })
    void fetch(`/api/qingmu/editorial-handoff/import-status?${params.toString()}`, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return
      const body = await response.json() as { status?: string; result?: ImportResult | null }
      if (current === importGeneration.current && body.status === 'succeeded'
        && body.result !== undefined && body.result !== null
        && body.result.projectId === projectId && body.result.episodeId === episodeId) {
        setImportResult(body.result)
        setImportState('succeeded')
      }
    }).catch(() => undefined)
    return () => {
      controller.abort()
      if (current === importGeneration.current) {
        importGeneration.current += 1
        importController.current = undefined
      }
    }
  }, [episodeId, importAccess, projectId])

  useEffect(() => {
    if (importError !== undefined) importErrorRef.current?.focus()
  }, [importError])

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
          importAccess?: ImportAccess
        }
        if (body.status === 'succeeded' && typeof body.sha256 === 'string'
          && typeof body.size === 'number') {
          if (current === downloadGeneration.current) {
            setDownload({ status: 'succeeded', sha256: body.sha256, size: body.size })
            setImportAccess(body.importAccess)
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

  const verifyPackage = useCallback(async () => {
    if (selectedPackage === undefined || importAccess === undefined || importState === 'running') return
    const current = ++importGeneration.current
    importController.current?.abort()
    const controller = new AbortController()
    importController.current = controller
    const params = new URLSearchParams({ projectId, episodeId, ...importAccess })
    const url = `/api/qingmu/editorial-handoff/import?${params.toString()}`
    const statusUrl = `/api/qingmu/editorial-handoff/import-status?${params.toString()}`
    setImportState('running')
    setImportResult(undefined)
    setImportError(undefined)
    try {
      const response = await fetch(url, {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/zip' },
        body: selectedPackage, signal: controller.signal,
      })
      if (!response.ok) throw new Error('upload_failed')
      const result = await response.json() as ImportResult
      if (current !== importGeneration.current) return
      if (result.projectId !== projectId || result.episodeId !== episodeId) throw new Error('scope_mismatch')
      setImportResult(result)
      setImportState('succeeded')
      return
    } catch {
      if (current !== importGeneration.current || controller.signal.aborted) return
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
          const body = await response.json() as { status?: string; result?: ImportResult | null; errorCode?: string | null }
          if (current !== importGeneration.current) return
          if (body.status === 'succeeded' && body.result !== null && body.result !== undefined
            && body.result.projectId === projectId && body.result.episodeId === episodeId) {
            setImportResult(body.result); setImportState('succeeded'); return
          }
          if (body.status === 'failed') {
            setImportError(body.errorCode ?? 'package_verification_failed'); setImportState('failed'); return
          }
        } catch {
          if (current !== importGeneration.current) return
          /* The original one-time import remains the only recovery coordinate. */
        }
        await new Promise(resolve => window.setTimeout(resolve, 250))
      }
      if (current !== importGeneration.current) return
      setImportError('package_verification_unknown')
      setImportState('failed')
    } finally {
      if (current === importGeneration.current) importController.current = undefined
    }
  }, [episodeId, importAccess, importState, projectId, selectedPackage])

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
      <div className={css.importBox}>
        <div>
          <strong>{t('handoffImportTitle')}</strong>
          <p>{t('handoffImportBoundary')}</p>
          <label className={css.fileField}>
            <span>{t('handoffImportChoose')}</span>
            <input type="file" accept=".zip,application/zip" disabled={importAccess === undefined || importState === 'running'}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                setSelectedPackage(file)
                setImportResult(undefined)
                setImportError(undefined)
                setImportState('idle')
              }} />
          </label>
          {selectedPackage !== undefined && <p>{selectedPackage.name} · {selectedPackage.size.toLocaleString()} bytes</p>}
          {importAccess === undefined && <p className={css.warning}>{t('handoffImportNeedsDownload')}</p>}
        </div>
        <button type="button" disabled={selectedPackage === undefined || importAccess === undefined || importState === 'running'}
          onClick={() => { void verifyPackage() }}>
          {importState === 'running' ? t('handoffImportRunning') : t('handoffImportVerify')}
        </button>
      </div>
      {importError !== undefined && <div ref={importErrorRef} role="alert" tabIndex={-1} className={css.errorSummary}>
        <strong>{t('handoffImportFailed')}</strong><p>{t('handoffImportFailedHelp')} ({importError})</p>
      </div>}
      {importResult !== undefined && <section className={css.preview} aria-labelledby="handoff-import-result">
        <header><div><strong id="handoff-import-result">{t('handoffImportResult')}</strong>
          <p>{t('handoffImportPreviewOnly')}</p></div></header>
        <ul className={css.conclusions} aria-label={t('handoffImportConclusions')}>
          <li data-state="pass"><strong>{t('handoffImportReceipt')}</strong><span>{t('handoffImportMatched')}</span></li>
          <li data-state="pass"><strong>{t('handoffImportInternal')}</strong><span>{t('handoffImportValid')}</span></li>
          <li data-state={importResult.currentAuthority.matches ? 'pass' : 'stale'}>
            <strong>{t('handoffImportCurrent')}</strong>
            <span>{importResult.currentAuthority.matches ? t('handoffImportCurrentMatched') : t('handoffImportCurrentDrift')}</span>
          </li>
        </ul>
        <div className={css.previewGrid}>
          <div><strong>{t('handoffImportTracks')}</strong><ul>{importResult.preview.tracks.map(track =>
            <li key={`${track.name}-${track.kind}`}>{track.name} · {track.kind} · {track.clipCount}</li>)}</ul></div>
          <div><strong>{t('handoffImportShots')}</strong><ol>{importResult.preview.orderedShots.map(shot =>
            <li key={shot.frameId ?? String(shot.order)}>#{shot.frameNo ?? shot.order} · {shot.videoRange?.durationSec ?? '—'}s<br />
              <code>{shot.videoPath}</code><br /><code>{shot.audioPath}</code></li>)}</ol></div>
        </div>
        <details><summary>{t('handoffImportMedia')}</summary><ul>{importResult.preview.media.map(media =>
          <li key={`${media.kind}-${media.path}`}><code>{media.path}</code> · {media.size.toLocaleString()} bytes</li>)}</ul></details>
        <p>{t('handoffImportUnresolved')}: {importResult.preview.unresolved.length}</p>
        <details><summary>{t('handoffAdvanced')}</summary>
          <p>Package SHA: {importResult.packageSha256}</p><p>{importResult.packageSize.toLocaleString()} bytes</p>
        </details>
      </section>}
      <details><summary>{t('handoffAdvancedProjection')}</summary>
        <p>Source SHA: {projection.sourceSnapshotSha256}</p>
        <p>Projection SHA: {projection.projectionSha256}</p>
      </details>
    </>}
  </section>
}
