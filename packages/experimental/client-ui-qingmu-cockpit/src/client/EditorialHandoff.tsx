import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  QingmuYimengReadPort,
  YimengEditorialHandoffResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './EditorialHandoff.module.css'

interface ImportAccess { readonly requestId: string; readonly capability: string }
interface MasterAccess { readonly requestId: string; readonly capability: string }
interface CandidateAccess { readonly requestId: string; readonly capability: string }
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

interface MasterResult {
  readonly preflightSha256: string
  readonly projectId: string
  readonly episodeId: string
  readonly binding: {
    readonly sourceSnapshotSha256: string
    readonly projectionSha256: string
    readonly downloadRequestId: string
    readonly importRequestId: string
    readonly packageSha256: string
    readonly packageSize: number
  }
  readonly master: {
    readonly sha256: string
    readonly size: number
    readonly mimeType: string | null
    readonly container: string | null
    readonly formatName: string | null
    readonly durationSec: number | null
    readonly width: number | null
    readonly height: number | null
    readonly fps: number | null
    readonly videoStreams: readonly Record<string, unknown>[]
    readonly audioStreams: readonly Record<string, unknown>[]
  }
  readonly blockers: readonly string[]
}

interface CandidateResult {
  readonly schema: 'jason.qingmu-returned-master-candidate-result.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly assetId: string
  readonly masterSha256: string
  readonly materializedSha256: string
  readonly byteSize: number
  readonly mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm'
  readonly packageSha256: string
  readonly sourceSnapshotSha256: string
  readonly projectionSha256: string
  readonly preflightSha256: string
  readonly qualityStatus: 'pending'
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly approved: false
  readonly published: false
  readonly idempotencyKey: string
  readonly commandReceiptId: string
  readonly savedAt: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
  readonly selectionGranted: false
  readonly releaseGranted: false
  readonly humanSignoffInferred: false
}

interface SelectionCandidate {
  readonly assetId: string
  readonly masterSha256: string
  readonly mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm'
  readonly byteSize: number
  readonly qualityStatus: 'pending'
  readonly selectionStatus: 'Unselected' | 'Selected' | 'Stale'
  readonly isSelected: boolean
  readonly finalOutputId: string | null
  readonly selectionReceiptId: string | null
  readonly selectedAt: string | null
  readonly current: boolean
}

interface SelectionStatus {
  readonly schema: 'jason.qingmu-returned-master-selection-status.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly selectionRevision: number
  readonly currentFormalMaster: SelectionCandidate | null
  readonly candidates: readonly SelectionCandidate[]
  readonly releaseConditions: { readonly ready: false; readonly blockers: readonly string[] }
}

interface SelectionPreview {
  readonly schema: 'jason.qingmu-returned-master-selection-preview.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly candidate: SelectionCandidate
  readonly currentFormalMaster: { readonly assetId: string; readonly finalOutputId: string } | null
  readonly previewSha256: string
  readonly idempotencyKey: string
  readonly canConfirm: boolean
  readonly hardBlockers: readonly string[]
  readonly releaseConditions: { readonly ready: false; readonly blockers: readonly string[] }
  readonly impact: {
    readonly mediaCopies: 0
    readonly revokePreviousFormalSelection: boolean
  }
}

interface SelectionResult {
  readonly schema: 'jason.qingmu-returned-master-selection-result.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly assetId: string
  readonly finalOutputId: string
  readonly selectionStatus: 'Selected'
  readonly qualityStatus: 'pending'
  readonly commandReceiptId: string
  readonly selectedBy: string
  readonly selectedAt: string
  readonly releaseConditions: { readonly ready: false; readonly blockers: readonly string[] }
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

const MASTER_BLOCKER_KEYS: Readonly<Record<string, QingmuCockpitKey>> = {
  editorial_master_container_invalid: 'handoffMasterBlockerContainer',
  editorial_master_container_probe_mismatch: 'handoffMasterBlockerContainer',
  editorial_master_probe_unavailable: 'handoffMasterBlockerProbe',
  editorial_master_video_stream_missing: 'handoffMasterBlockerVideo',
  editorial_master_audio_stream_missing: 'handoffMasterBlockerAudio',
  editorial_master_duration_invalid: 'handoffMasterBlockerDuration',
  editorial_master_resolution_invalid: 'handoffMasterBlockerResolution',
  editorial_master_fps_invalid: 'handoffMasterBlockerFps',
}

/** E8 editorial handoff plus one explicit, unselected returned-master candidate commit. */
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
  const [masterAccess, setMasterAccess] = useState<MasterAccess>()
  const [selectedMaster, setSelectedMaster] = useState<File>()
  const [masterState, setMasterState] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')
  const [masterResult, setMasterResult] = useState<MasterResult>()
  const [masterError, setMasterError] = useState<string>()
  const [candidateAccess, setCandidateAccess] = useState<CandidateAccess>()
  const [candidateState, setCandidateState] = useState<'idle' | 'running' | 'unknown' | 'succeeded' | 'failed'>('idle')
  const [candidates, setCandidates] = useState<readonly CandidateResult[]>([])
  const [candidateError, setCandidateError] = useState<string>()
  const [selectionStatus, setSelectionStatus] = useState<SelectionStatus>()
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreview>()
  const [selectionResult, setSelectionResult] = useState<SelectionResult>()
  const [selectionConfirmed, setSelectionConfirmed] = useState(false)
  const [selectionState, setSelectionState] = useState<'idle' | 'previewing' | 'previewed' | 'saving' | 'succeeded' | 'failed'>('idle')
  const [selectionError, setSelectionError] = useState<string>()
  const generation = useRef(0)
  const downloadGeneration = useRef(0)
  const importGeneration = useRef(0)
  const masterGeneration = useRef(0)
  const candidateGeneration = useRef(0)
  const selectionGeneration = useRef(0)
  const activeController = useRef<AbortController>()
  const importController = useRef<AbortController>()
  const masterController = useRef<AbortController>()
  const candidateController = useRef<AbortController>()
  const selectionController = useRef<AbortController>()
  const importErrorRef = useRef<HTMLDivElement>(null)

  const loadCandidates = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++candidateGeneration.current
    candidateController.current?.abort()
    const controller = new AbortController()
    candidateController.current = controller
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(`/api/qingmu/editorial-handoff/returned-master-candidates?${params.toString()}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('candidate_list_failed')
      const body = await response.json() as { schema?: string; candidates?: readonly CandidateResult[] }
      if (body.schema !== 'jason.qingmu-returned-master-candidates.v1' || !Array.isArray(body.candidates)) {
        throw new Error('candidate_list_contract_invalid')
      }
      if (current === candidateGeneration.current) {
        setCandidates(body.candidates)
        setCandidateError(undefined)
      }
    } catch (cause) {
      if (current === candidateGeneration.current && !controller.signal.aborted) {
        setCandidates([])
        setCandidateError(cause instanceof Error ? cause.message : 'candidate_list_failed')
      }
    } finally {
      if (current === candidateGeneration.current) candidateController.current = undefined
    }
  }, [episodeId, projectId])

  const loadSelectionStatus = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++selectionGeneration.current
    selectionController.current?.abort()
    const controller = new AbortController()
    selectionController.current = controller
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-selection-status?${params.toString()}`,
        { method: 'GET', cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('selection_status_failed')
      const body = await response.json() as SelectionStatus
      if (body.projectId !== projectId || body.episodeId !== episodeId
        || !Array.isArray(body.candidates)) throw new Error('selection_status_contract_invalid')
      if (current === selectionGeneration.current) {
        setSelectionStatus(body)
        setSelectionError(undefined)
      }
    } catch (cause) {
      if (current === selectionGeneration.current && !controller.signal.aborted) {
        setSelectionStatus(undefined)
        setSelectionError(cause instanceof Error ? cause.message : 'selection_status_failed')
      }
    } finally {
      if (current === selectionGeneration.current) selectionController.current = undefined
    }
  }, [episodeId, projectId])

  const load = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++generation.current
    activeController.current?.abort()
    downloadGeneration.current += 1
    importGeneration.current += 1
    masterGeneration.current += 1
    candidateGeneration.current += 1
    selectionGeneration.current += 1
    importController.current?.abort()
    masterController.current?.abort()
    candidateController.current?.abort()
    selectionController.current?.abort()
    importController.current = undefined
    const controller = new AbortController()
    activeController.current = controller
    setProjection(undefined)
    setDownload({ status: 'idle' })
    setLoading(true)
    setError(undefined)
    setCandidates([])
    setSelectionStatus(undefined)
    setSelectionPreview(undefined)
    setSelectionResult(undefined)
    setSelectionConfirmed(false)
    setSelectionState('idle')
    setSelectionError(undefined)
    try {
      const value = await port.editorialHandoff({ projectId, episodeId }, controller.signal)
      if (current === generation.current) {
        setProjection(value)
        setImportAccess(value.download.hostAccess?.importAccess)
        setImportResult(undefined)
        setImportState('idle')
        setImportError(undefined)
        setMasterAccess(undefined)
        setMasterResult(undefined)
        setMasterState('idle')
        setMasterError(undefined)
        setCandidateAccess(undefined)
        setCandidateState('idle')
        setCandidateError(undefined)
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
      masterGeneration.current += 1
      candidateGeneration.current += 1
      selectionGeneration.current += 1
      activeController.current?.abort()
      importController.current?.abort()
      masterController.current?.abort()
      candidateController.current?.abort()
      selectionController.current?.abort()
      activeController.current = undefined
      importController.current = undefined
      masterController.current = undefined
      candidateController.current = undefined
      selectionController.current = undefined
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
      const body = await response.json() as {
        status?: string
        result?: ImportResult | null
        masterAccess?: MasterAccess
      }
      if (current === importGeneration.current && body.status === 'succeeded'
        && body.result !== undefined && body.result !== null
        && body.result.projectId === projectId && body.result.episodeId === episodeId) {
        setImportResult(body.result)
        setImportState('succeeded')
        setMasterAccess(body.masterAccess)
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
    if (masterAccess === undefined) return
    const current = ++masterGeneration.current
    masterController.current?.abort()
    const controller = new AbortController()
    masterController.current = controller
    const params = new URLSearchParams({ projectId, episodeId, ...masterAccess })
    void fetch(`/api/qingmu/editorial-handoff/master-preflight-status?${params.toString()}`, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return
      const body = await response.json() as {
        status?: string
        result?: MasterResult | null
        candidateAccess?: CandidateAccess
      }
      if (current === masterGeneration.current && body.status === 'succeeded'
        && body.result !== undefined && body.result !== null
        && body.result.projectId === projectId && body.result.episodeId === episodeId) {
        setMasterResult(body.result)
        setMasterState('succeeded')
        setCandidateAccess(body.candidateAccess)
      }
    }).catch(() => undefined)
    return () => {
      controller.abort()
      if (current === masterGeneration.current) {
        masterGeneration.current += 1
        masterController.current = undefined
      }
    }
  }, [episodeId, masterAccess, projectId])

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
      const status = await fetch(statusUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (status.ok) {
        const body = await status.json() as { masterAccess?: MasterAccess }
        if (current === importGeneration.current) setMasterAccess(body.masterAccess)
      }
      return
    } catch {
      if (current !== importGeneration.current || controller.signal.aborted) return
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
          const body = await response.json() as {
            status?: string
            result?: ImportResult | null
            errorCode?: string | null
            masterAccess?: MasterAccess
          }
          if (current !== importGeneration.current) return
          if (body.status === 'succeeded' && body.result !== null && body.result !== undefined
            && body.result.projectId === projectId && body.result.episodeId === episodeId) {
            setImportResult(body.result); setImportState('succeeded'); setMasterAccess(body.masterAccess); return
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

  const verifyMaster = useCallback(async () => {
    if (selectedMaster === undefined || masterAccess === undefined || masterState !== 'idle') return
    const current = ++masterGeneration.current
    masterController.current?.abort()
    const controller = new AbortController()
    masterController.current = controller
    const params = new URLSearchParams({ projectId, episodeId, ...masterAccess })
    const url = `/api/qingmu/editorial-handoff/master-preflight?${params.toString()}`
    const statusUrl = `/api/qingmu/editorial-handoff/master-preflight-status?${params.toString()}`
    setMasterState('running')
    setMasterResult(undefined)
    setMasterError(undefined)
    try {
      const response = await fetch(url, {
        method: 'POST', cache: 'no-store',
        headers: { 'content-type': selectedMaster.type || 'application/octet-stream' },
        body: selectedMaster, signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { code?: string } | undefined
        if (current !== masterGeneration.current) return
        setMasterError(body?.code ?? 'master_preflight_failed')
        setMasterState('failed')
        return
      }
      const result = await response.json() as MasterResult & { readonly candidateAccess?: CandidateAccess }
      if (current !== masterGeneration.current) return
      if (result.projectId !== projectId || result.episodeId !== episodeId) throw new Error('scope_mismatch')
      setMasterResult(result)
      setMasterState('succeeded')
      setCandidateAccess(result.candidateAccess)
      return
    } catch {
      if (current !== masterGeneration.current || controller.signal.aborted) return
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
          const body = await response.json() as {
            status?: string
            result?: MasterResult | null
            errorCode?: string | null
            candidateAccess?: CandidateAccess
          }
          if (current !== masterGeneration.current) return
          if (body.status === 'succeeded' && body.result !== null && body.result !== undefined
            && body.result.projectId === projectId && body.result.episodeId === episodeId) {
            setMasterResult(body.result); setMasterState('succeeded'); setCandidateAccess(body.candidateAccess); return
          }
          if (body.status === 'failed') {
            setMasterError(body.errorCode ?? 'master_preflight_failed'); setMasterState('failed'); return
          }
        } catch {
          if (current !== masterGeneration.current) return
          /* The original preflight request remains the only recovery coordinate. */
        }
        await new Promise(resolve => window.setTimeout(resolve, 250))
      }
      if (current !== masterGeneration.current) return
      setMasterError('master_preflight_unknown')
      setMasterState('failed')
    } finally {
      if (current === masterGeneration.current) masterController.current = undefined
    }
  }, [episodeId, masterAccess, masterState, projectId, selectedMaster])

  const saveCandidate = useCallback(async () => {
    if (selectedMaster === undefined || masterResult === undefined || candidateAccess === undefined
      || masterResult.blockers.length > 0 || candidateState === 'running') return
    const current = ++candidateGeneration.current
    candidateController.current?.abort()
    const controller = new AbortController()
    candidateController.current = controller
    const params = new URLSearchParams({ projectId, episodeId, ...candidateAccess })
    const url = `/api/qingmu/editorial-handoff/returned-master-candidate?${params.toString()}`
    const statusUrl = `/api/qingmu/editorial-handoff/returned-master-candidate-status?${params.toString()}`
    setCandidateState('running')
    setCandidateError(undefined)
    const accept = (value: unknown): value is CandidateResult => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const result = value as Record<string, unknown>
      return result.schema === 'jason.qingmu-returned-master-candidate-result.v1'
        && result.projectId === projectId && result.episodeId === episodeId
        && result.masterSha256 === masterResult.master.sha256
        && result.materializedSha256 === result.masterSha256
        && result.packageSha256 === masterResult.binding.packageSha256
        && result.preflightSha256 === masterResult.preflightSha256
        && result.selectionStatus === 'Unselected' && result.qualityStatus === 'pending'
        && result.isSelected === false && result.approved === false && result.published === false
        && result.providerCalls === 0 && result.stageStarted === false
        && result.approvalGranted === false && result.selectionGranted === false
        && result.releaseGranted === false && result.humanSignoffInferred === false
    }
    const complete = (result: unknown) => {
      if (current !== candidateGeneration.current || !accept(result)) return false
      setCandidateState('succeeded')
      setCandidates(existing => [result, ...existing.filter(item => item.assetId !== result.assetId)])
      void loadSelectionStatus()
      return true
    }
    try {
      const response = await fetch(url, {
        method: 'POST', cache: 'no-store',
        headers: { 'content-type': selectedMaster.type || 'application/octet-stream' },
        body: selectedMaster, signal: controller.signal,
      })
      if (!response.ok) throw new Error('candidate_save_unconfirmed')
      const result = await response.json() as CandidateResult
      if (!complete(result)) throw new Error('candidate_receipt_mismatch')
      return
    } catch {
      if (current !== candidateGeneration.current || controller.signal.aborted) return
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
          const body = await response.json() as {
            status?: string
            result?: CandidateResult | null
            errorCode?: string | null
          }
          if (current !== candidateGeneration.current) return
          if (body.status === 'succeeded' && body.result !== null && body.result !== undefined) {
            if (complete(body.result)) return
            setCandidateError('candidate_receipt_mismatch'); setCandidateState('failed'); return
          }
          if (body.status === 'failed') {
            setCandidateError(body.errorCode ?? 'candidate_save_failed'); setCandidateState('failed'); return
          }
        } catch {
          if (current !== candidateGeneration.current) return
          /* Recover only by the original Host receipt; never resubmit the media. */
        }
        await new Promise(resolve => window.setTimeout(resolve, 250))
      }
      if (current !== candidateGeneration.current) return
      setCandidateError('candidate_submission_unknown')
      setCandidateState('unknown')
    } finally {
      if (current === candidateGeneration.current) candidateController.current = undefined
    }
  }, [candidateAccess, candidateState, episodeId, loadSelectionStatus, masterResult, projectId, selectedMaster])

  const previewSelection = useCallback(async (assetId: string) => {
    if (selectionState === 'previewing' || selectionState === 'saving') return
    const current = ++selectionGeneration.current
    selectionController.current?.abort()
    const controller = new AbortController()
    selectionController.current = controller
    setSelectionState('previewing')
    setSelectionPreview(undefined)
    setSelectionResult(undefined)
    setSelectionConfirmed(false)
    setSelectionError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-selection-preview?${params.toString()}`,
        {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId }),
        },
      )
      if (!response.ok) throw new Error('selection_preview_failed')
      const body = await response.json() as SelectionPreview
      if (body.projectId !== projectId || body.episodeId !== episodeId
        || body.candidate.assetId !== assetId) throw new Error('selection_preview_contract_invalid')
      if (current === selectionGeneration.current) {
        setSelectionPreview(body)
        setSelectionState('previewed')
      }
    } catch (cause) {
      if (current === selectionGeneration.current && !controller.signal.aborted) {
        setSelectionError(cause instanceof Error ? cause.message : 'selection_preview_failed')
        setSelectionState('failed')
      }
    } finally {
      if (current === selectionGeneration.current) selectionController.current = undefined
    }
  }, [episodeId, projectId, selectionState])

  const confirmSelection = useCallback(async () => {
    if (selectionPreview === undefined || !selectionPreview.canConfirm || !selectionConfirmed
      || selectionState === 'saving') return
    const current = ++selectionGeneration.current
    selectionController.current?.abort()
    const controller = new AbortController()
    selectionController.current = controller
    setSelectionState('saving')
    setSelectionError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-selection?${params.toString()}`,
        {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            assetId: selectionPreview.candidate.assetId,
            previewSha256: selectionPreview.previewSha256,
            idempotencyKey: selectionPreview.idempotencyKey,
          }),
        },
      )
      if (!response.ok) throw new Error('selection_commit_failed_or_unknown')
      const body = await response.json() as SelectionResult
      if (body.projectId !== projectId || body.episodeId !== episodeId
        || body.assetId !== selectionPreview.candidate.assetId) {
        throw new Error('selection_receipt_mismatch')
      }
      if (current === selectionGeneration.current) {
        setSelectionResult(body)
        setSelectionState('succeeded')
        setSelectionConfirmed(false)
        await loadSelectionStatus()
      }
    } catch (cause) {
      if (current === selectionGeneration.current && !controller.signal.aborted) {
        setSelectionError(cause instanceof Error ? cause.message : 'selection_commit_failed_or_unknown')
        setSelectionState('failed')
      }
    } finally {
      if (current === selectionGeneration.current) selectionController.current = undefined
    }
  }, [episodeId, loadSelectionStatus, projectId, selectionConfirmed, selectionPreview, selectionState])

  if (projectId === '' || episodeId === '') return <p className={css.empty}>{t('handoffChooseEpisode')}</p>
  const blockerLabel = (code: string) => t(BLOCKER_KEYS[code] ?? 'handoffBlockerUnknown')
  const masterBlockerLabel = (code: string) => t(MASTER_BLOCKER_KEYS[code] ?? 'handoffMasterBlockerUnknown')
  return <section className={css.panel} aria-labelledby="qingmu-editorial-handoff-title">
    <header className={css.header}>
      <div>
        <h3 id="qingmu-editorial-handoff-title">{t('handoffTitle')}</h3>
        <p>{t('handoffBoundary')}</p>
      </div>
      <button type="button" disabled={loading} onClick={() => {
        void load(); void loadCandidates(); void loadSelectionStatus()
      }}>
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
            <input type="file" accept=".zip,application/zip"
              disabled={importAccess === undefined || importState === 'running' || masterState === 'running'}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                importGeneration.current += 1
                masterGeneration.current += 1
                candidateGeneration.current += 1
                importController.current?.abort()
                masterController.current?.abort()
                candidateController.current?.abort()
                importController.current = undefined
                masterController.current = undefined
                const consumedPackageAccess = importState !== 'idle' || importResult !== undefined
                  || masterAccess !== undefined || masterState !== 'idle'
                setSelectedPackage(file)
                if (consumedPackageAccess) setImportAccess(undefined)
                setImportResult(undefined)
                setImportError(undefined)
                setImportState('idle')
                setMasterAccess(undefined)
                setSelectedMaster(undefined)
                setMasterResult(undefined)
                setMasterError(undefined)
                setMasterState('idle')
                setCandidateAccess(undefined)
                setCandidateError(undefined)
                setCandidateState('idle')
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
      <div className={css.importBox}>
        <div>
          <strong>{t('handoffMasterTitle')}</strong>
          <p>{t('handoffMasterBoundary')}</p>
          <label className={css.fileField}>
            <span>{t('handoffMasterChoose')}</span>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              aria-describedby={masterError === undefined ? undefined : 'handoff-master-error'}
              disabled={masterAccess === undefined || masterState !== 'idle'}
              onChange={(event) => {
                if (masterState !== 'idle') return
                const file = event.currentTarget.files?.[0]
                setSelectedMaster(file)
                setMasterResult(undefined)
                setMasterError(undefined)
                setMasterState('idle')
                setCandidateAccess(undefined)
                setCandidateError(undefined)
                setCandidateState('idle')
              }} />
          </label>
          {selectedMaster !== undefined && <p>{selectedMaster.name} · {selectedMaster.type || '—'} · {selectedMaster.size.toLocaleString()} bytes</p>}
          {masterAccess === undefined && <p className={css.warning}>{t('handoffMasterNeedsImport')}</p>}
          {masterState === 'succeeded' && <p className={css.warning}>{t('handoffMasterLocked')}</p>}
        </div>
        <button type="button" disabled={selectedMaster === undefined || masterAccess === undefined || masterState !== 'idle'}
          onClick={() => { void verifyMaster() }}>
          {masterState === 'running' ? t('handoffMasterRunning') : t('handoffMasterVerify')}
        </button>
      </div>
      {masterError !== undefined && <div id="handoff-master-error" role="alert" className={css.errorSummary}>
        <strong>{t('handoffMasterFailed')}</strong><p>{t('handoffMasterFailedHelp')} ({masterError})</p>
      </div>}
      {masterResult !== undefined && <section className={css.preview} aria-labelledby="handoff-master-result">
        <header><div><strong id="handoff-master-result">{t('handoffMasterResult')}</strong>
          <p>{t('handoffMasterPreviewOnly')}</p></div></header>
        <div className={css.masterFacts}>
          <span><strong>{masterResult.master.container ?? '—'}</strong>{t('handoffMasterContainer')}</span>
          <span><strong>{masterResult.master.durationSec ?? '—'}s</strong>{t('handoffMasterDuration')}</span>
          <span><strong>{masterResult.master.width ?? '—'} × {masterResult.master.height ?? '—'}</strong>{t('handoffMasterResolution')}</span>
          <span><strong>{masterResult.master.fps ?? '—'}</strong>{t('handoffMasterFps')}</span>
          <span><strong>{masterResult.master.audioStreams.length}</strong>{t('handoffMasterAudioStreams')}</span>
        </div>
        {masterResult.blockers.length === 0
          ? <p className={css.success}>{t('handoffMasterTechnicalPass')}</p>
          : <div role="status"><strong>{t('handoffMasterBlockers')}</strong><ul className={css.blockers}>
            {masterResult.blockers.map(code => <li key={code}>{masterBlockerLabel(code)} <code>{code}</code></li>)}
          </ul></div>}
        <p className={css.warning}>{t('handoffMasterExactBoundary')}</p>
        {masterResult.blockers.length === 0 && <div className={css.candidateCommit}>
          <div><strong>{t('handoffCandidateCommitTitle')}</strong><p>{t('handoffCandidateCommitBoundary')}</p>
            {candidateAccess === undefined && candidateState !== 'succeeded'
              && <p className={css.warning}>{t('handoffCandidateCommitUnavailable')}</p>}
            {candidateState === 'succeeded' && <p className={css.success}>{t('handoffCandidateSaved')}</p>}
            {candidateState === 'unknown' && <p role="alert" className={css.warning}>{t('handoffCandidateUnknown')} ({candidateError})</p>}
            {candidateState === 'failed' && <p role="alert" className={css.error}>{t('handoffCandidateFailed')} ({candidateError})</p>}
          </div>
          <button type="button"
            disabled={candidateAccess === undefined || selectedMaster === undefined
              || candidateState === 'running' || candidateState === 'unknown' || candidateState === 'succeeded'}
            onClick={() => { void saveCandidate() }}>
            {candidateState === 'running' ? t('handoffCandidateSaving') : t('handoffCandidateSave')}
          </button>
        </div>}
        <details><summary>{t('handoffAdvanced')}</summary>
          <p>Master SHA: {masterResult.master.sha256}</p>
          <p>{masterResult.master.size.toLocaleString()} bytes · {masterResult.master.mimeType ?? '—'} · {masterResult.master.formatName ?? '—'}</p>
          <p>Package SHA: {masterResult.binding.packageSha256}</p>
          <p>Source SHA: {masterResult.binding.sourceSnapshotSha256}</p>
          <p>Projection SHA: {masterResult.binding.projectionSha256}</p>
        </details>
      </section>}
      <details><summary>{t('handoffAdvancedProjection')}</summary>
        <p>Source SHA: {projection.sourceSnapshotSha256}</p>
        <p>Projection SHA: {projection.projectionSha256}</p>
      </details>
    </>}
    <section className={css.candidateShelf} aria-labelledby="handoff-candidate-shelf">
      <header><div><strong id="handoff-candidate-shelf">{t('handoffCandidateShelfTitle')}</strong>
        <p>{t('handoffCandidateShelfBoundary')}</p></div>
      <button type="button" onClick={() => { void loadCandidates(); void loadSelectionStatus() }}>
        {t('handoffCandidateRead')}
      </button>
      </header>
      {candidateError !== undefined && candidateState !== 'unknown' && candidateState !== 'failed'
        && <p role="alert" className={css.error}>{t('handoffCandidateListFailed')} ({candidateError})</p>}
      {selectionError !== undefined && <p role="alert" className={css.error}>
        {t('handoffSelectionFailed')} ({selectionError})
      </p>}
      {candidates.length === 0
        ? <p className={css.warning}>{t('handoffCandidateEmpty')}</p>
        : <ul>{candidates.map((candidate) => {
          const authority = selectionStatus?.candidates.find(item => item.assetId === candidate.assetId)
          const statusLabel = authority?.current === true ? t('handoffSelectionCurrent')
            : authority?.selectionStatus === 'Stale' ? t('handoffSelectionStale')
              : t('handoffCandidateUnselected')
          const selectable = authority !== undefined && authority.mimeType === 'video/mp4'
            && (authority.selectionStatus === 'Unselected' || authority.selectionStatus === 'Stale')
          return <li key={candidate.assetId}>
            <div><strong>{t('handoffCandidateStatus')}</strong><span>{statusLabel}</span></div>
            <p>{candidate.mimeType} · {candidate.byteSize.toLocaleString()} bytes · {candidate.savedAt}</p>
            <p className={authority?.current === true ? css.success : css.warning}>
              {authority?.current === true ? t('handoffSelectionCurrentBoundary') : t('handoffSelectionPendingBoundary')}
            </p>
            <button type="button" disabled={!selectable || selectionState === 'previewing'
              || selectionState === 'saving'} onClick={() => { void previewSelection(candidate.assetId) }}>
              {selectionState === 'previewing' && selectionPreview?.candidate.assetId === candidate.assetId
                ? t('handoffSelectionPreviewing') : t('handoffSelectionPreview')}
            </button>
            <details><summary>{t('handoffAdvanced')}</summary>
              <p>Asset ID: {candidate.assetId}</p>
              <p>Master SHA: {candidate.masterSha256}</p>
              <p>Package SHA: {candidate.packageSha256}</p>
              <p>Source SHA: {candidate.sourceSnapshotSha256}</p>
              <p>Preflight SHA: {candidate.preflightSha256}</p>
              <p>Receipt: {candidate.commandReceiptId}</p>
              <p>Selection receipt: {authority?.selectionReceiptId ?? '—'}</p>
              <p>Final output: {authority?.finalOutputId ?? '—'}</p>
            </details>
          </li>})}</ul>}
      {selectionPreview !== undefined && <section className={css.preview} aria-labelledby="handoff-selection-preview">
        <header><div><strong id="handoff-selection-preview">{t('handoffSelectionPreviewTitle')}</strong>
          <p>{t('handoffSelectionPreviewBoundary')}</p></div></header>
        <div className={css.previewGrid}>
          <div><strong>{t('handoffSelectionOriginal')}</strong>
            <p>{selectionPreview.candidate.selectionStatus} · {selectionPreview.candidate.qualityStatus}</p>
            <p>{selectionPreview.candidate.mimeType} · {selectionPreview.candidate.byteSize.toLocaleString()} bytes</p>
          </div>
          <div><strong>{t('handoffSelectionImpact')}</strong>
            <p>{t('handoffSelectionImpactInPlace')}</p>
            <p>{selectionPreview.impact.revokePreviousFormalSelection
              ? t('handoffSelectionReplacesCurrent') : t('handoffSelectionFirstFormal')}</p>
          </div>
        </div>
        {selectionPreview.hardBlockers.length > 0 && <ul className={css.blockers}>
          {selectionPreview.hardBlockers.map(code => <li key={code}>{code}</li>)}
        </ul>}
        <p className={css.warning}>{t('handoffSelectionReleaseBlocked')}</p>
        <label className={css.confirmation}>
          <input type="checkbox" checked={selectionConfirmed}
            disabled={!selectionPreview.canConfirm || selectionState === 'saving'}
            onChange={(event) => { setSelectionConfirmed(event.currentTarget.checked) }} />
          <span>{t('handoffSelectionConfirm')}</span>
        </label>
        <button type="button" disabled={!selectionPreview.canConfirm || !selectionConfirmed
          || selectionState === 'saving'} onClick={() => { void confirmSelection() }}>
          {selectionState === 'saving' ? t('handoffSelectionSaving') : t('handoffSelectionSave')}
        </button>
        <details><summary>{t('handoffAdvanced')}</summary>
          <p>Preview SHA: {selectionPreview.previewSha256}</p>
          <p>Asset ID: {selectionPreview.candidate.assetId}</p>
          <p>Current formal: {selectionPreview.currentFormalMaster?.assetId ?? '—'}</p>
          <p>Release blockers: {selectionPreview.releaseConditions.blockers.join(', ')}</p>
        </details>
      </section>}
      {selectionResult !== undefined && <div className={css.success} role="status">
        <strong>{t('handoffSelectionSaved')}</strong>
        <p>{t('handoffSelectionSavedBoundary')}</p>
        <p>{selectionResult.selectedBy} · {selectionResult.selectedAt}</p>
        <details><summary>{t('handoffAdvanced')}</summary>
          <p>Receipt: {selectionResult.commandReceiptId}</p>
          <p>Final output: {selectionResult.finalOutputId}</p>
          <p>Release blockers: {selectionResult.releaseConditions.blockers.join(', ')}</p>
        </details>
      </div>}
    </section>
  </section>
}
