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
  readonly eventId: string
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
  readonly qualityStatus: 'pending' | 'passed' | 'failed'
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

interface TechnicalQcResult {
  readonly schema: 'jason.qingmu-returned-master-technical-qc-result.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly assetId: string
  readonly finalOutputId: string
  readonly masterSha256: string
  readonly outcome: 'passed' | 'failed' | 'unknown'
  readonly qualityStatus: 'pending' | 'passed' | 'failed'
  readonly canonicalResultSha256: string
  readonly technicalFacts: {
    readonly container: string
    readonly durationSec: number | null
    readonly width: number | null
    readonly height: number | null
    readonly fps: string
    readonly videoCodec: string
    readonly audioCodec: string
    readonly hasVideo: boolean
    readonly hasAudio: boolean
    readonly byteSize: number | null
    readonly materializedSha256: string | null
  }
  readonly checks: readonly string[]
  readonly uncertainty: readonly string[]
  readonly releaseAuthorityRevisionAtStart: number
  readonly releaseAuthorityRevision: number
  readonly releaseConditions: { readonly ready: false; readonly blockers: readonly string[] }
  readonly commandReceiptId: string
  readonly recordedAt: string
}

interface TechnicalQcPreview {
  readonly schema: 'jason.qingmu-returned-master-technical-qc-preview.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly currentFormalMaster: { readonly assetId?: string; readonly finalOutputId?: string; readonly masterSha256?: string }
  readonly previewSha256: string
  readonly idempotencyKey: string
  readonly canConfirm: boolean
  readonly hardBlockers: readonly string[]
}

interface TechnicalQcStatus {
  readonly schema: 'jason.qingmu-returned-master-technical-qc-status.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly currentTechnicalQc: TechnicalQcResult | null
  readonly staleTechnicalQc: {
    readonly stale: true
    readonly code: 'returned_master_qc_editorial_binding_drift'
    readonly driftFields: readonly string[]
  } | null
  readonly hardBlockers: readonly string[]
  readonly releaseConditions: { readonly ready: false; readonly blockers: readonly string[] }
}

interface EvidenceFreezeResult {
  readonly schema: 'jason.qingmu-canonical-evidence-freeze-result.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly packageId: string
  readonly manifestSha256: string
  readonly zipSha256: string
  readonly zipBytes: number
  readonly requestSha256: string
  readonly subjectSha256: string
  readonly releaseAuthorityRevisionBefore: number
  readonly releaseAuthorityRevision: number
  readonly commandReceiptId: string
  readonly committedAt: string
  readonly releaseSignoffGranted: false
  readonly releaseReady: false
  readonly releaseBlockers: readonly string[]
}

interface EvidenceFreezePreview {
  readonly schema: 'jason.qingmu-canonical-evidence-freeze-preview.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly subject: {
    readonly buildIdentity: { readonly commit: string; readonly sourceClean: boolean; readonly appEnv: string }
    readonly final: { readonly finalOutputId: string; readonly assetId: string; readonly sha256: string; readonly bytes: number }
  }
  readonly previewSha256: string
  readonly idempotencyKey: string
  readonly machineReady: boolean
  readonly machineBlockers: readonly string[]
  readonly releaseBlockers: readonly string[]
  readonly canConfirm: boolean
  readonly hardBlockers: readonly string[]
}

interface EvidenceFreezeStatus {
  readonly schema: 'jason.qingmu-canonical-evidence-freeze-status.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly currentPackage: EvidenceFreezeResult | null
  readonly preview: EvidenceFreezePreview
}

interface FinalContentBinding {
  readonly projectId: string
  readonly episodeId: string
  readonly contentReviewToken: string
  readonly finalOutputId: string
  readonly finalAssetId: string
  readonly finalSha256: string
  readonly finalBytes: number
  readonly materializedSha256: string
  readonly verifyEvidenceSha256: string
  readonly rc1PackageId: string
  readonly rc1ManifestSha256: string
}

interface FinalContentDecisionResult {
  readonly schema: 'jason.episode-final-content-decision.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly decision: 'accepted' | 'rejected'
  readonly reason: string | null
  readonly binding: FinalContentBinding
  readonly idempotencyKey: string
  readonly commandReceiptId: string
  readonly releaseSignoffGranted: false
  readonly publishReady: false
  readonly humanAuthorityStatus: 'platform_verified' | 'legacy_unverified'
  readonly humanAuthorityVerified: boolean
}

function finalContentBindingIdentity(binding: FinalContentBinding): string {
  return JSON.stringify([
    binding.projectId, binding.episodeId,
    binding.contentReviewToken, binding.finalOutputId, binding.finalAssetId,
    binding.finalSha256, binding.finalBytes, binding.materializedSha256,
    binding.verifyEvidenceSha256, binding.rc1PackageId, binding.rc1ManifestSha256,
  ])
}

interface NaturalPersonIdentityStatus {
  readonly schema: 'jason.qingmu-natural-person-identity-status.v1'
  readonly projectId: string
  readonly state: 'unbound' | 'bound' | 'invalid'
  readonly naturalPersonId: string | null
  readonly canEnroll: boolean
  readonly legalIdentityVerified: false
  readonly humanSignoffGranted: false
}

interface HumanPresenceStatus {
  readonly schema: 'jason.qingmu-platform-human-presence-status.v1'
  readonly projectId: string
  readonly actorUserId: string
  readonly state: 'registered' | 'unregistered'
  readonly credentialSha256: string | null
  readonly userVerification: 'required'
  readonly authenticatorAttachment: 'platform'
  readonly businessAuthorityGranted: false
}

interface PlatformPresenceOptions {
  readonly schema: 'jason.qingmu-platform-human-presence-options.v1'
  readonly ceremony: 'registration' | 'authentication'
  readonly challengeId: string
  readonly publicKey: Record<string, unknown>
}

interface PlatformAssertion {
  readonly challengeId: string
  readonly credential: Record<string, unknown>
}

function decodeBase64Url(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) {
    throw new Error('platform_presence_options_invalid')
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = globalThis.atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(decoded, char => char.charCodeAt(0)).buffer
}

function encodeBase64Url(value: ArrayBuffer | null): string | null {
  if (value === null) return null
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function performPlatformPresence(
  options: PlatformPresenceOptions, signal: AbortSignal,
): Promise<PlatformAssertion> {
  if (!Reflect.has(globalThis, 'PublicKeyCredential') || !Reflect.has(navigator, 'credentials')) {
    throw new Error('platform_presence_unavailable')
  }
  const source = options.publicKey
  const challenge = decodeBase64Url(source.challenge)
  let credential: Credential | null
  if (options.ceremony === 'registration') {
    const user = source.user as Record<string, unknown> | undefined
    const selection = source.authenticatorSelection as AuthenticatorSelectionCriteria | undefined
    if (user === undefined || typeof user.name !== 'string' || typeof user.displayName !== 'string'
      || selection?.authenticatorAttachment !== 'platform'
      || selection.userVerification !== 'required') {
      throw new Error('platform_presence_options_invalid')
    }
    credential = await navigator.credentials.create({
      signal,
      publicKey: {
        ...(source as unknown as PublicKeyCredentialCreationOptions),
        challenge,
        user: { ...user, id: decodeBase64Url(user.id) } as PublicKeyCredentialUserEntity,
      },
    })
  } else {
    const allowCredentials = Array.isArray(source.allowCredentials)
      ? source.allowCredentials.map((item) => {
        const value = item as Record<string, unknown>
        return { ...value, id: decodeBase64Url(value.id) } as PublicKeyCredentialDescriptor
      }) : []
    if (source.userVerification !== 'required' || allowCredentials.length !== 1) {
      throw new Error('platform_presence_options_invalid')
    }
    credential = await navigator.credentials.get({
      signal,
      publicKey: {
        ...(source as unknown as PublicKeyCredentialRequestOptions),
        challenge,
        allowCredentials,
      },
    })
  }
  if (!(credential instanceof PublicKeyCredential)
    || credential.authenticatorAttachment !== 'platform') {
    throw new Error('platform_presence_not_verified')
  }
  const response = credential.response
  const serializedResponse: Record<string, unknown> = {
    clientDataJSON: encodeBase64Url(response.clientDataJSON),
  }
  if (response instanceof AuthenticatorAttestationResponse) {
    serializedResponse.attestationObject = encodeBase64Url(response.attestationObject)
    serializedResponse.transports = response.getTransports()
  } else if (response instanceof AuthenticatorAssertionResponse) {
    serializedResponse.authenticatorData = encodeBase64Url(response.authenticatorData)
    serializedResponse.signature = encodeBase64Url(response.signature)
    serializedResponse.userHandle = encodeBase64Url(response.userHandle)
  } else {
    throw new Error('platform_presence_not_verified')
  }
  return {
    challengeId: options.challengeId,
    credential: {
      id: credential.id,
      rawId: encodeBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: serializedResponse,
    },
  }
}

export function continuousPlayedCoverage(
  played: Pick<TimeRanges, 'length' | 'start' | 'end'>,
  duration: number,
  toleranceSec = 0.25,
): number {
  if (!Number.isFinite(duration) || duration <= 0 || played.length === 0) return 0
  let continuousEnd = 0
  let missingDuration = 0
  for (let index = 0; index < played.length; index += 1) {
    const start = played.start(index)
    const end = played.end(index)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    if (start > continuousEnd) missingDuration += start - continuousEnd
    if (missingDuration > toleranceSec) break
    continuousEnd = Math.max(continuousEnd, end)
  }
  missingDuration += Math.max(0, duration - continuousEnd)
  if (missingDuration <= toleranceSec) return 1
  return Math.max(0, Math.min(1, continuousEnd / duration))
}

interface Rc1Status {
  readonly schema: 'jason.qingmu-editorial-handoff-rc1-status.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly rc1Package: EvidenceFreezeStatus & { readonly packageLevel: 'RC1' }
  readonly contentReview: {
    readonly schema: 'jason.episode-final-content-decision-status.v1'
    readonly binding?: FinalContentBinding
    readonly currentDecision: FinalContentDecisionResult | null
    readonly canDecide: boolean
    readonly legacyDecisionRequiresReconfirmation: boolean
    readonly blockers?: readonly string[]
    readonly identity: NaturalPersonIdentityStatus
    readonly releaseSignoffGranted: false
    readonly publishReady: false
  }
  readonly releaseSignoff: {
    readonly granted: false
    readonly readOnly: true
    readonly blockers: readonly string[]
  }
}

type UntrustedEvidenceFreezePayload<T extends { schema: string }> = Omit<T, 'schema'> & {
  schema: string
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
  const [, setSelectionConfirmed] = useState(false)
  const [selectionState, setSelectionState] = useState<'idle' | 'previewing' | 'previewed' | 'saving' | 'succeeded' | 'failed'>('idle')
  const [selectionError, setSelectionError] = useState<string>()
  const [technicalQcStatus, setTechnicalQcStatus] = useState<TechnicalQcStatus>()
  const [technicalQcPreview, setTechnicalQcPreview] = useState<TechnicalQcPreview>()
  const [technicalQcResult, setTechnicalQcResult] = useState<TechnicalQcResult>()
  const [, setTechnicalQcConfirmed] = useState(false)
  const [technicalQcState, setTechnicalQcState] = useState<'idle' | 'previewing' | 'previewed' | 'running' | 'succeeded' | 'failed'>('idle')
  const [technicalQcError, setTechnicalQcError] = useState<string>()
  const [evidenceFreezeStatus, setEvidenceFreezeStatus] = useState<EvidenceFreezeStatus>()
  const [evidenceFreezePreview, setEvidenceFreezePreview] = useState<EvidenceFreezePreview>()
  const [evidenceFreezeResult, setEvidenceFreezeResult] = useState<EvidenceFreezeResult>()
  const [, setEvidenceFreezeConfirmed] = useState(false)
  const [evidenceFreezeState, setEvidenceFreezeState] = useState<'idle' | 'previewing' | 'previewed' | 'saving' | 'succeeded' | 'failed'>('idle')
  const [evidenceFreezeError, setEvidenceFreezeError] = useState<string>()
  const [rc1Status, setRc1Status] = useState<Rc1Status>()
  const [rc1Preview, setRc1Preview] = useState<EvidenceFreezePreview>()
  const [rc1State, setRc1State] = useState<'idle' | 'loading' | 'previewed' | 'saving' | 'deciding'>('idle')
  const [rc1Error, setRc1Error] = useState<string>()
  const [playedCoverage, setPlayedCoverage] = useState(0)
  const [contentChecks, setContentChecks] = useState<Record<string, boolean>>({
    picture_and_timing_reviewed: false,
    dialogue_and_audio_reviewed: false,
    continuity_and_content_reviewed: false,
  })
  const [, setContentSecondConfirmed] = useState(false)
  const [contentRejectReason, setContentRejectReason] = useState('picture_or_timing')
  const [contentNote, setContentNote] = useState('')
  const [identitySaving, setIdentitySaving] = useState(false)
  const [identityError, setIdentityError] = useState<string>()
  const [humanUsername, setHumanUsername] = useState('')
  const [humanPassword, setHumanPassword] = useState('')
  const [humanSessionState, setHumanSessionState] = useState<'idle' | 'saving' | 'ready' | 'failed'>('idle')
  const [humanPresenceStatus, setHumanPresenceStatus] = useState<HumanPresenceStatus>()
  const [humanPresenceState, setHumanPresenceState] = useState<'idle' | 'loading' | 'prompting' | 'ready' | 'failed'>('idle')
  const [humanPresenceError, setHumanPresenceError] = useState<string>()
  const [shotViewMode, setShotViewMode] = useState<'detailed' | 'compact'>('detailed')
  const generation = useRef(0)
  const downloadGeneration = useRef(0)
  const importGeneration = useRef(0)
  const masterGeneration = useRef(0)
  const candidateGeneration = useRef(0)
  const selectionGeneration = useRef(0)
  const technicalQcGeneration = useRef(0)
  const evidenceFreezeGeneration = useRef(0)
  const rc1Generation = useRef(0)
  const activeController = useRef<AbortController>()
  const importController = useRef<AbortController>()
  const masterController = useRef<AbortController>()
  const candidateController = useRef<AbortController>()
  const selectionController = useRef<AbortController>()
  const technicalQcController = useRef<AbortController>()
  const evidenceFreezeController = useRef<AbortController>()
  const rc1Controller = useRef<AbortController>()
  const contentDecisionKey = useRef('')
  const contentDecisionBinding = useRef('')
  const identityEnrollmentKey = useRef('')
  const humanPresenceController = useRef<AbortController>()
  const importErrorRef = useRef<HTMLDivElement>(null)

  const resetContentReviewDraft = useCallback(() => {
    contentDecisionKey.current = ''
    setPlayedCoverage(0)
    setContentChecks({
      picture_and_timing_reviewed: false,
      dialogue_and_audio_reviewed: false,
      continuity_and_content_reviewed: false,
    })
    setContentSecondConfirmed(false)
    setContentRejectReason('picture_or_timing')
    setContentNote('')
  }, [])

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
      const candidates = body.candidates as readonly CandidateResult[]
      if (candidates.some(candidate => candidate.projectId !== projectId
        || candidate.episodeId !== episodeId)) throw new Error('candidate_list_contract_invalid')
      if (current === candidateGeneration.current) {
        setCandidates(candidates)
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

  const loadTechnicalQcStatus = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++technicalQcGeneration.current
    technicalQcController.current?.abort()
    const controller = new AbortController()
    technicalQcController.current = controller
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-technical-qc-status?${params.toString()}`,
        { method: 'GET', cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('technical_qc_status_failed')
      const raw = await response.json() as Record<string, unknown>
      if (raw.schema !== 'jason.qingmu-returned-master-technical-qc-status.v1'
        || raw.projectId !== projectId || raw.episodeId !== episodeId) {
        throw new Error('technical_qc_status_contract_invalid')
      }
      const body = raw as unknown as TechnicalQcStatus
      if (current === technicalQcGeneration.current) {
        setTechnicalQcStatus(body)
        setTechnicalQcResult(body.currentTechnicalQc ?? undefined)
        setTechnicalQcError(undefined)
      }
    } catch (cause) {
      if (current === technicalQcGeneration.current && !controller.signal.aborted) {
        setTechnicalQcStatus(undefined)
        setTechnicalQcResult(undefined)
        setTechnicalQcError(cause instanceof Error ? cause.message : 'technical_qc_status_failed')
      }
    } finally {
      if (current === technicalQcGeneration.current) technicalQcController.current = undefined
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

  const loadEvidenceFreezeStatus = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++evidenceFreezeGeneration.current
    evidenceFreezeController.current?.abort()
    const controller = new AbortController()
    evidenceFreezeController.current = controller
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/canonical-evidence-freeze-status?${params.toString()}`,
        { method: 'GET', cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('canonical_evidence_freeze_status_failed')
      const body = await response.json() as UntrustedEvidenceFreezePayload<EvidenceFreezeStatus>
      if (body.schema !== 'jason.qingmu-canonical-evidence-freeze-status.v1'
        || body.projectId !== projectId || body.episodeId !== episodeId) {
        throw new Error('canonical_evidence_freeze_status_invalid')
      }
      const status = body as EvidenceFreezeStatus
      if (current === evidenceFreezeGeneration.current) {
        setEvidenceFreezeStatus(status)
        setEvidenceFreezeResult(status.currentPackage ?? undefined)
        setEvidenceFreezePreview(status.preview)
        setEvidenceFreezeState('previewed')
        setEvidenceFreezeConfirmed(false)
        setEvidenceFreezeError(undefined)
      }
    } catch (cause) {
      if (current === evidenceFreezeGeneration.current && !controller.signal.aborted) {
        setEvidenceFreezeStatus(undefined)
        setEvidenceFreezeError(cause instanceof Error ? cause.message : 'canonical_evidence_freeze_status_failed')
      }
    } finally {
      if (current === evidenceFreezeGeneration.current) evidenceFreezeController.current = undefined
    }
  }, [episodeId, projectId])

  const loadRc1Status = useCallback(async () => {
    if (projectId === '' || episodeId === '') return
    const current = ++rc1Generation.current
    rc1Controller.current?.abort()
    const controller = new AbortController()
    rc1Controller.current = controller
    setRc1State('loading')
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(`/api/qingmu/editorial-handoff/rc1-status?${params.toString()}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('rc1_status_failed')
      const body = await response.json() as Partial<Rc1Status>
      if (body.schema !== 'jason.qingmu-editorial-handoff-rc1-status.v1'
        || body.projectId !== projectId || body.episodeId !== episodeId
        || body.rc1Package?.packageLevel !== 'RC1') throw new Error('rc1_status_contract_invalid')
      const status = body as Rc1Status
      if (current === rc1Generation.current) {
        const bindingIdentity = status.contentReview.binding === undefined
          ? `${projectId}:${episodeId}:no-current-binding`
          : finalContentBindingIdentity(status.contentReview.binding)
        if (contentDecisionBinding.current !== bindingIdentity) {
          resetContentReviewDraft()
          contentDecisionBinding.current = bindingIdentity
        }
        setRc1Status(status)
        setRc1Preview(status.rc1Package.preview)
        setRc1State(status.rc1Package.currentPackage === null ? 'idle' : 'previewed')
        setRc1Error(undefined)
      }
    } catch (cause) {
      if (current === rc1Generation.current && !controller.signal.aborted) {
        setRc1Status(undefined)
        setRc1Error(cause instanceof Error ? cause.message : 'rc1_status_failed')
        setRc1State('idle')
      }
    } finally {
      if (current === rc1Generation.current) rc1Controller.current = undefined
    }
  }, [episodeId, projectId, resetContentReviewDraft])

  const refreshReturnedMasterState = useCallback(async () => {
    const scopeGeneration = generation.current
    await loadCandidates()
    if (scopeGeneration !== generation.current) return
    await loadSelectionStatus()
    if (scopeGeneration !== generation.current) return
    await loadTechnicalQcStatus()
    if (scopeGeneration !== generation.current) return
    await loadEvidenceFreezeStatus()
    if (scopeGeneration !== generation.current) return
    await loadRc1Status()
  }, [loadCandidates, loadEvidenceFreezeStatus, loadRc1Status, loadSelectionStatus, loadTechnicalQcStatus])

  const load = useCallback(async () => {
    if (projectId === '' || episodeId === '') return false
    const current = ++generation.current
    activeController.current?.abort()
    downloadGeneration.current += 1
    importGeneration.current += 1
    masterGeneration.current += 1
    candidateGeneration.current += 1
    selectionGeneration.current += 1
    technicalQcGeneration.current += 1
    evidenceFreezeGeneration.current += 1
    rc1Generation.current += 1
    importController.current?.abort()
    masterController.current?.abort()
    candidateController.current?.abort()
    selectionController.current?.abort()
    technicalQcController.current?.abort()
    evidenceFreezeController.current?.abort()
    rc1Controller.current?.abort()
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
    setTechnicalQcStatus(undefined)
    setTechnicalQcPreview(undefined)
    setTechnicalQcResult(undefined)
    setTechnicalQcConfirmed(false)
    setTechnicalQcState('idle')
    setTechnicalQcError(undefined)
    setEvidenceFreezeStatus(undefined)
    setEvidenceFreezePreview(undefined)
    setEvidenceFreezeResult(undefined)
    setEvidenceFreezeConfirmed(false)
    setEvidenceFreezeState('idle')
    setEvidenceFreezeError(undefined)
    setRc1Status(undefined)
    resetContentReviewDraft()
    contentDecisionBinding.current = ''
    setRc1Preview(undefined)
    setRc1State('idle')
    setRc1Error(undefined)
    setIdentityError(undefined)
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
    return current === generation.current && !controller.signal.aborted
  }, [episodeId, port, projectId, resetContentReviewDraft, t])

  useEffect(() => {
    setProjection(undefined)
    void (async () => {
      if (await load()) await loadRc1Status()
    })()
    return () => {
      generation.current += 1
      downloadGeneration.current += 1
      importGeneration.current += 1
      masterGeneration.current += 1
      candidateGeneration.current += 1
      selectionGeneration.current += 1
      technicalQcGeneration.current += 1
      evidenceFreezeGeneration.current += 1
      rc1Generation.current += 1
      activeController.current?.abort()
      importController.current?.abort()
      masterController.current?.abort()
      candidateController.current?.abort()
      selectionController.current?.abort()
      technicalQcController.current?.abort()
      evidenceFreezeController.current?.abort()
      rc1Controller.current?.abort()
      activeController.current = undefined
      importController.current = undefined
      masterController.current = undefined
      candidateController.current = undefined
      selectionController.current = undefined
      technicalQcController.current = undefined
      evidenceFreezeController.current = undefined
      rc1Controller.current = undefined
    }
  }, [load, loadRc1Status])

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
    if (selectionPreview === undefined || !selectionPreview.canConfirm
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
        await loadTechnicalQcStatus()
      }
    } catch (cause) {
      if (current === selectionGeneration.current && !controller.signal.aborted) {
        setSelectionError(cause instanceof Error ? cause.message : 'selection_commit_failed_or_unknown')
        setSelectionState('failed')
      }
    } finally {
      if (current === selectionGeneration.current) selectionController.current = undefined
    }
  }, [episodeId, loadSelectionStatus, loadTechnicalQcStatus, projectId, selectionPreview, selectionState])

  const previewTechnicalQc = useCallback(async () => {
    if (technicalQcState === 'previewing' || technicalQcState === 'running') return
    const current = ++technicalQcGeneration.current
    technicalQcController.current?.abort()
    const controller = new AbortController()
    technicalQcController.current = controller
    setTechnicalQcState('previewing')
    setTechnicalQcPreview(undefined)
    setTechnicalQcConfirmed(false)
    setTechnicalQcError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-technical-qc-preview?${params.toString()}`,
        { method: 'POST', cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('technical_qc_preview_failed')
      const raw = await response.json() as Record<string, unknown>
      if (raw.schema !== 'jason.qingmu-returned-master-technical-qc-preview.v1'
        || raw.projectId !== projectId || raw.episodeId !== episodeId) {
        throw new Error('technical_qc_preview_contract_invalid')
      }
      const body = raw as unknown as TechnicalQcPreview
      if (current === technicalQcGeneration.current) {
        setTechnicalQcPreview(body)
        setTechnicalQcState('previewed')
      }
    } catch (cause) {
      if (current === technicalQcGeneration.current && !controller.signal.aborted) {
        setTechnicalQcError(cause instanceof Error ? cause.message : 'technical_qc_preview_failed')
        setTechnicalQcState('failed')
      }
    } finally {
      if (current === technicalQcGeneration.current) technicalQcController.current = undefined
    }
  }, [episodeId, projectId, technicalQcState])

  const confirmTechnicalQc = useCallback(async () => {
    if (technicalQcPreview === undefined || !technicalQcPreview.canConfirm
      || technicalQcState === 'running') return
    const current = ++technicalQcGeneration.current
    technicalQcController.current?.abort()
    const controller = new AbortController()
    technicalQcController.current = controller
    setTechnicalQcState('running')
    setTechnicalQcError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/returned-master-technical-qc?${params.toString()}`,
        {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            previewSha256: technicalQcPreview.previewSha256,
            idempotencyKey: technicalQcPreview.idempotencyKey,
          }),
        },
      )
      if (!response.ok) throw new Error('technical_qc_commit_failed_or_unknown')
      const raw = await response.json() as Record<string, unknown>
      if (raw.schema !== 'jason.qingmu-returned-master-technical-qc-result.v1'
        || raw.projectId !== projectId || raw.episodeId !== episodeId
        || raw.assetId !== technicalQcPreview.currentFormalMaster.assetId) {
        throw new Error('technical_qc_receipt_mismatch')
      }
      const body = raw as unknown as TechnicalQcResult
      if (current === technicalQcGeneration.current) {
        setTechnicalQcResult(body)
        setTechnicalQcState('succeeded')
        setTechnicalQcConfirmed(false)
        await loadSelectionStatus()
        await loadTechnicalQcStatus()
        await loadEvidenceFreezeStatus()
      }
    } catch (cause) {
      if (current === technicalQcGeneration.current && !controller.signal.aborted) {
        setTechnicalQcError(cause instanceof Error ? cause.message : 'technical_qc_commit_failed_or_unknown')
        setTechnicalQcState('failed')
      }
    } finally {
      if (current === technicalQcGeneration.current) technicalQcController.current = undefined
    }
  }, [
    episodeId, loadEvidenceFreezeStatus, loadSelectionStatus, loadTechnicalQcStatus,
    projectId, technicalQcPreview, technicalQcState,
  ])

  const previewEvidenceFreeze = useCallback(async () => {
    if (evidenceFreezeState === 'previewing' || evidenceFreezeState === 'saving') return
    const current = ++evidenceFreezeGeneration.current
    evidenceFreezeController.current?.abort()
    const controller = new AbortController()
    evidenceFreezeController.current = controller
    setEvidenceFreezeState('previewing')
    setEvidenceFreezePreview(undefined)
    setEvidenceFreezeConfirmed(false)
    setEvidenceFreezeError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/canonical-evidence-freeze-preview?${params.toString()}`,
        { method: 'POST', cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('canonical_evidence_freeze_preview_failed')
      const body = await response.json() as UntrustedEvidenceFreezePayload<EvidenceFreezePreview>
      if (body.schema !== 'jason.qingmu-canonical-evidence-freeze-preview.v1'
        || body.projectId !== projectId || body.episodeId !== episodeId) {
        throw new Error('canonical_evidence_freeze_preview_invalid')
      }
      const preview = body as EvidenceFreezePreview
      if (current === evidenceFreezeGeneration.current) {
        setEvidenceFreezePreview(preview)
        setEvidenceFreezeState('previewed')
      }
    } catch (cause) {
      if (current === evidenceFreezeGeneration.current && !controller.signal.aborted) {
        setEvidenceFreezeError(cause instanceof Error ? cause.message : 'canonical_evidence_freeze_preview_failed')
        setEvidenceFreezeState('failed')
      }
    } finally {
      if (current === evidenceFreezeGeneration.current) evidenceFreezeController.current = undefined
    }
  }, [episodeId, evidenceFreezeState, projectId])

  const confirmEvidenceFreeze = useCallback(async () => {
    if (evidenceFreezePreview === undefined || !evidenceFreezePreview.canConfirm
      || evidenceFreezeState === 'saving') return
    const current = ++evidenceFreezeGeneration.current
    evidenceFreezeController.current?.abort()
    const controller = new AbortController()
    evidenceFreezeController.current = controller
    setEvidenceFreezeState('saving')
    setEvidenceFreezeError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(
        `/api/qingmu/editorial-handoff/canonical-evidence-freeze?${params.toString()}`,
        {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            previewSha256: evidenceFreezePreview.previewSha256,
            buildCommit: evidenceFreezePreview.subject.buildIdentity.commit,
            idempotencyKey: evidenceFreezePreview.idempotencyKey,
          }),
        },
      )
      if (!response.ok) throw new Error('canonical_evidence_freeze_commit_failed_or_unknown')
      const body = await response.json() as UntrustedEvidenceFreezePayload<EvidenceFreezeResult>
      if (body.schema !== 'jason.qingmu-canonical-evidence-freeze-result.v1'
        || body.projectId !== projectId || body.episodeId !== episodeId) {
        throw new Error('canonical_evidence_freeze_result_invalid')
      }
      const result = body as EvidenceFreezeResult
      if (current === evidenceFreezeGeneration.current) {
        setEvidenceFreezeResult(result)
        setEvidenceFreezeConfirmed(false)
        setEvidenceFreezeState('succeeded')
        await loadEvidenceFreezeStatus()
      }
    } catch (cause) {
      if (current === evidenceFreezeGeneration.current && !controller.signal.aborted) {
        setEvidenceFreezeError(cause instanceof Error ? cause.message : 'canonical_evidence_freeze_commit_failed_or_unknown')
        setEvidenceFreezeState('failed')
      }
    } finally {
      if (current === evidenceFreezeGeneration.current) evidenceFreezeController.current = undefined
    }
  }, [episodeId, evidenceFreezePreview, evidenceFreezeState, loadEvidenceFreezeStatus, projectId])

  const previewRc1 = useCallback(async () => {
    if (rc1State === 'loading' || rc1State === 'saving' || rc1State === 'deciding') return
    const current = ++rc1Generation.current
    rc1Controller.current?.abort()
    const controller = new AbortController()
    rc1Controller.current = controller
    setRc1State('loading')
    setRc1Error(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(`/api/qingmu/editorial-handoff/rc1-preview?${params.toString()}`, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('rc1_package_preview_failed')
      const body = await response.json() as Partial<EvidenceFreezePreview>
      if (body.schema !== 'jason.qingmu-canonical-evidence-freeze-preview.v1'
        || body.projectId !== projectId || body.episodeId !== episodeId) throw new Error('rc1_package_preview_invalid')
      const preview = body as EvidenceFreezePreview
      if (current === rc1Generation.current) {
        setRc1Preview(preview)
        setRc1State('previewed')
      }
    } catch (cause) {
      if (current === rc1Generation.current && !controller.signal.aborted) {
        setRc1Error(cause instanceof Error ? cause.message : 'rc1_package_preview_failed')
        setRc1State('idle')
      }
    } finally {
      if (current === rc1Generation.current) rc1Controller.current = undefined
    }
  }, [episodeId, projectId, rc1State])

  const confirmRc1 = useCallback(async () => {
    if (rc1Preview === undefined || !rc1Preview.canConfirm || rc1State === 'saving') return
    const current = ++rc1Generation.current
    const controller = new AbortController()
    rc1Controller.current?.abort()
    rc1Controller.current = controller
    setRc1State('saving')
    setRc1Error(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await fetch(`/api/qingmu/editorial-handoff/rc1?${params.toString()}`, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ previewSha256: rc1Preview.previewSha256,
          buildCommit: rc1Preview.subject.buildIdentity.commit,
          idempotencyKey: rc1Preview.idempotencyKey }),
      })
      if (!response.ok) throw new Error('rc1_package_commit_failed')
      if (current === rc1Generation.current) await loadRc1Status()
    } catch (cause) {
      if (current === rc1Generation.current && !controller.signal.aborted) {
        setRc1Error(cause instanceof Error ? cause.message : 'rc1_package_commit_failed')
        setRc1State('previewed')
      }
    } finally {
      if (current === rc1Generation.current) rc1Controller.current = undefined
    }
  }, [episodeId, loadRc1Status, projectId, rc1Preview, rc1State])

  const loadHumanPresenceStatus = useCallback(async (): Promise<HumanPresenceStatus | undefined> => {
    if (projectId === '' || episodeId === '') return undefined
    const params = new URLSearchParams({ projectId, episodeId })
    const response = await fetch(
      `/api/qingmu/editorial-handoff/human-presence-credential?${params.toString()}`,
      { method: 'GET', cache: 'no-store', credentials: 'same-origin' },
    )
    if (!response.ok) return undefined
    const result = await response.json() as HumanPresenceStatus
    setHumanPresenceStatus(result)
    setHumanPresenceState(result.state === 'registered' ? 'ready' : 'idle')
    return result
  }, [episodeId, projectId])

  const requestWithPlatformPresence = useCallback(async (
    url: string, body: Record<string, unknown>, controller: AbortController,
  ): Promise<Response> => {
    const initial = await fetch(url, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!initial.ok) return initial
    const rawOptions = await initial.json() as Record<string, unknown>
    if (rawOptions.schema !== 'jason.qingmu-platform-human-presence-options.v1') {
      throw new Error('platform_presence_options_invalid')
    }
    const options = rawOptions as unknown as PlatformPresenceOptions
    setHumanPresenceState('prompting')
    const assertion = await performPlatformPresence(options, controller.signal)
    return fetch(url, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, platformAssertion: assertion }),
    })
  }, [])

  const registerHumanPresence = useCallback(async () => {
    if (humanSessionState !== 'ready' || humanPresenceState === 'prompting') return
    const controller = new AbortController()
    humanPresenceController.current?.abort()
    humanPresenceController.current = controller
    setHumanPresenceState('loading')
    setHumanPresenceError(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await requestWithPlatformPresence(
        `/api/qingmu/editorial-handoff/human-presence-credential?${params.toString()}`,
        {},
        controller,
      )
      if (!response.ok) throw new Error('platform_presence_registration_failed')
      const status = await response.json() as HumanPresenceStatus
      setHumanPresenceStatus(status)
      setHumanPresenceState(status.state === 'registered' ? 'ready' : 'failed')
    } catch (cause) {
      if (controller.signal.aborted) {
        setHumanPresenceError('platform_presence_cancelled')
        setHumanPresenceState(humanPresenceStatus?.state === 'registered' ? 'ready' : 'failed')
      } else {
        setHumanPresenceError(cause instanceof Error
          ? cause.message : 'platform_presence_registration_failed')
        setHumanPresenceState('failed')
      }
    } finally {
      if (humanPresenceController.current === controller) humanPresenceController.current = undefined
    }
  }, [episodeId, humanPresenceState, humanPresenceStatus, humanSessionState, projectId,
    requestWithPlatformPresence])

  const authenticateHumanSession = useCallback(async () => {
    if (humanSessionState === 'saving' || humanUsername.trim() === '' || humanPassword === '') return
    setHumanSessionState('saving')
    try {
      const response = await fetch('/api/qingmu/editorial-handoff/human-session', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: humanUsername.trim(), password: humanPassword }),
      })
      if (!response.ok) throw new Error('human_session_login_failed')
      setHumanPassword('')
      setHumanSessionState('ready')
      await loadHumanPresenceStatus()
    } catch {
      setHumanSessionState('failed')
    }
  }, [humanPassword, humanSessionState, humanUsername, loadHumanPresenceStatus])

  const enrollNaturalPersonIdentity = useCallback(async () => {
    if (identitySaving || humanSessionState !== 'ready'
      || humanPresenceStatus?.state !== 'registered'
      || rc1Status?.contentReview.identity?.canEnroll !== true) return
    if (identityEnrollmentKey.current === '') {
      identityEnrollmentKey.current = `natural-person-${globalThis.crypto.randomUUID()}`
    }
    setIdentitySaving(true)
    setIdentityError(undefined)
    const controller = new AbortController()
    humanPresenceController.current?.abort()
    humanPresenceController.current = controller
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await requestWithPlatformPresence(
        `/api/qingmu/editorial-handoff/natural-person-identity?${params.toString()}`,
        { confirmed: true, idempotencyKey: identityEnrollmentKey.current },
        controller,
      )
      if (!response.ok) throw new Error(response.status === 401
        ? 'natural_person_identity_relogin_required' : 'natural_person_identity_unknown_or_failed')
      identityEnrollmentKey.current = ''
      setHumanPresenceState('ready')
      await loadRc1Status()
    } catch (cause) {
      const failure = cause instanceof Error
        ? cause.message : 'natural_person_identity_unknown_or_failed'
      if (failure === 'natural_person_identity_relogin_required') setHumanSessionState('idle')
      if (controller.signal.aborted) setHumanPresenceError('platform_presence_cancelled')
      setIdentityError(failure)
      await loadRc1Status()
    } finally {
      setIdentitySaving(false)
      if (humanPresenceController.current === controller) humanPresenceController.current = undefined
      setHumanPresenceState('ready')
    }
  }, [episodeId, humanPresenceStatus, humanSessionState, identitySaving, loadRc1Status,
    projectId, rc1Status, requestWithPlatformPresence])

  const decideFinalContent = useCallback(async (decision: 'accepted' | 'rejected') => {
    const binding = rc1Status?.contentReview.binding
    if (humanSessionState !== 'ready' || humanPresenceStatus?.state !== 'registered'
      || binding === undefined || rc1Status?.contentReview.canDecide !== true
      || rc1State === 'deciding') return
    if (contentDecisionKey.current === '') {
      const nonce = globalThis.crypto.randomUUID()
      contentDecisionKey.current = `final-content-${nonce}`
    }
    const current = ++rc1Generation.current
    const controller = new AbortController()
    rc1Controller.current?.abort()
    rc1Controller.current = controller
    setRc1State('deciding')
    setRc1Error(undefined)
    try {
      const params = new URLSearchParams({ projectId, episodeId })
      const response = await requestWithPlatformPresence(
        `/api/qingmu/editorial-handoff/final-content-decision?${params.toString()}`, {
          decision, binding, playedCoverage,
          checks: contentChecks, secondConfirmed: true,
          reason: decision === 'rejected' ? contentRejectReason : null,
          note: contentNote.trim() === '' ? null : contentNote.trim(),
          idempotencyKey: contentDecisionKey.current,
        }, controller,
      )
      if (!response.ok) {
        const failure = await response.json().catch(() => undefined) as { code?: unknown } | undefined
        throw new Error(typeof failure?.code === 'string'
          ? failure.code : 'final_content_decision_unknown_or_failed')
      }
      if (current === rc1Generation.current) await loadRc1Status()
    } catch (cause) {
      if (current === rc1Generation.current) {
        const failure = cause instanceof Error ? cause.message : 'final_content_decision_unknown_or_failed'
        if (failure === 'final_content_decision_reauthentication_required') setHumanSessionState('idle')
        setRc1State('previewed')
        if (!controller.signal.aborted) {
          await loadRc1Status()
          setRc1Error(failure)
        }
      }
    } finally {
      if (current === rc1Generation.current) rc1Controller.current = undefined
    }
  }, [contentChecks, contentNote, contentRejectReason,
    episodeId, humanPresenceStatus, humanSessionState, loadRc1Status, playedCoverage,
    projectId, rc1State, rc1Status, requestWithPlatformPresence])

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
        void (async () => {
          if (await load()) await refreshReturnedMasterState()
        })()
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <strong>{t('handoffShotList')}</strong>
        <div className={css.batchToggle}>
          <button type="button" aria-pressed={shotViewMode === 'detailed'} onClick={() => { setShotViewMode('detailed') }}>{t('handoffShotDetailed')}</button>
          <button type="button" aria-pressed={shotViewMode === 'compact'} onClick={() => { setShotViewMode('compact') }}>{t('handoffShotCompact')}</button>
        </div>
      </div>
      <ol className={css.shots} aria-label={t('handoffShotList')}>
        {projection.source.shots.map(shot => <li key={shot.frameId}>
          {shotViewMode === 'compact'
            ? <div className={css.shotCompact}>
              <strong>#{shot.frameNo} · {shot.title}</strong>
              <span>{shot.selectedTake === null ? t('handoffNoSelectedTake') : `${shot.selectedTake.durationSec ?? '—'}s · ${shot.selectedTake.qualityStatus}`}</span>
            </div>
            : <>
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
            </>}
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
        {download.status === 'running' && <div className={css.inlineProgress}><span>{t('handoffDownloading')}</span><div className={css.progressBar} /></div>}
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
        {importState === 'running' && <div className={css.inlineProgress}><span>{t('handoffImportRunning')}</span><div className={css.progressBar} /></div>}
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
        {masterState === 'running' && <div className={css.inlineProgress}><span>{t('handoffMasterRunning')}</span><div className={css.progressBar} /></div>}
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
          {candidateState === 'running' && <div className={css.inlineProgress}><span>{t('handoffCandidateSaving')}</span><div className={css.progressBar} /></div>}
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
      <button type="button" onClick={() => {
        void refreshReturnedMasterState()
      }}>
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
        <button type="button" className={css.actionCard}
          disabled={!selectionPreview.canConfirm || selectionState === 'saving'}
          onClick={() => { void confirmSelection() }}>
          <span>{selectionState === 'saving' ? t('handoffSelectionSaving') : t('handoffSelectionSave')}</span>
          {selectionState === 'saving' && <div className={css.progressBar} />}
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
      <section className={css.preview} aria-labelledby="handoff-technical-qc-title">
        <header><div><strong id="handoff-technical-qc-title">{t('handoffTechnicalQcTitle')}</strong>
          <p>{t('handoffTechnicalQcBoundary')}</p></div></header>
        {selectionStatus?.currentFormalMaster === null || selectionStatus === undefined
          ? <p className={css.warning}>{t('handoffTechnicalQcNeedsMaster')}</p>
          : <div className={css.candidateCommit}>
            <div><strong>{t('handoffTechnicalQcCurrent')}</strong>
              <p>{selectionStatus.currentFormalMaster.assetId} · {selectionStatus.currentFormalMaster.qualityStatus}</p>
            </div>
            <button type="button" disabled={technicalQcState === 'previewing'
              || technicalQcState === 'running'} onClick={() => { void previewTechnicalQc() }}>
              {technicalQcState === 'previewing'
                ? t('handoffTechnicalQcPreparing') : t('handoffTechnicalQcPrepare')}
            </button>
          </div>}
        {technicalQcError !== undefined && <p role="alert" className={css.error}>
          {t('handoffTechnicalQcFailed')} ({technicalQcError})
        </p>}
        {technicalQcPreview !== undefined && <div>
          {technicalQcPreview.hardBlockers.length > 0 && <ul className={css.blockers}>
            {technicalQcPreview.hardBlockers.map(code => <li key={code}>{code}</li>)}
          </ul>}
          <button type="button" className={css.actionCard}
            disabled={!technicalQcPreview.canConfirm || technicalQcState === 'running'}
            onClick={() => { void confirmTechnicalQc() }}>
            <span>{technicalQcState === 'running'
              ? t('handoffTechnicalQcRunning') : t('handoffTechnicalQcRun')}</span>
            {technicalQcState === 'running' && <div className={css.progressBar} />}
          </button>
          <details><summary>{t('handoffAdvanced')}</summary>
            <p>Preview SHA: {technicalQcPreview.previewSha256}</p>
            <p>Asset ID: {technicalQcPreview.currentFormalMaster.assetId ?? '—'}</p>
            <p>Final output: {technicalQcPreview.currentFormalMaster.finalOutputId ?? '—'}</p>
          </details>
        </div>}
        {technicalQcResult !== undefined && <div role="status">
          <p className={technicalQcResult.outcome === 'passed' ? css.success : css.warning}>
            <strong>{technicalQcResult.outcome === 'passed'
              ? t('handoffTechnicalQcPassed')
              : technicalQcResult.outcome === 'failed'
                ? t('handoffTechnicalQcRejected') : t('handoffTechnicalQcUnknown')}</strong>
          </p>
          <div className={css.masterFacts}>
            <span><strong>{technicalQcResult.technicalFacts.container || '—'}</strong>{t('handoffMasterContainer')}</span>
            <span><strong>{technicalQcResult.technicalFacts.durationSec ?? '—'}s</strong>{t('handoffMasterDuration')}</span>
            <span><strong>{technicalQcResult.technicalFacts.width ?? '—'} × {technicalQcResult.technicalFacts.height ?? '—'}</strong>{t('handoffMasterResolution')}</span>
            <span><strong>{technicalQcResult.technicalFacts.fps || '—'}</strong>{t('handoffMasterFps')}</span>
            <span><strong>{technicalQcResult.technicalFacts.videoCodec || '—'} / {technicalQcResult.technicalFacts.audioCodec || '—'}</strong>{t('handoffTechnicalQcCodecs')}</span>
          </div>
          {technicalQcResult.checks.length > 0 && <ul className={css.blockers}>
            {technicalQcResult.checks.map(code => <li key={code}>{code}</li>)}
          </ul>}
          {technicalQcResult.uncertainty.length > 0 && <ul className={css.blockers}>
            {technicalQcResult.uncertainty.map(code => <li key={code}>{code}</li>)}
          </ul>}
          <p className={css.warning}>{t('handoffTechnicalQcExactBoundary')}</p>
          <details><summary>{t('handoffAdvanced')}</summary>
            <p>Receipt: {technicalQcResult.commandReceiptId}</p>
            <p>Result SHA: {technicalQcResult.canonicalResultSha256}</p>
            <p>Master SHA: {technicalQcResult.masterSha256}</p>
            <p>Authority: {technicalQcResult.releaseAuthorityRevisionAtStart} → {technicalQcResult.releaseAuthorityRevision}</p>
            <p>Release blockers: {technicalQcResult.releaseConditions.blockers.join(', ')}</p>
          </details>
        </div>}
        {technicalQcStatus !== undefined && technicalQcStatus.currentTechnicalQc === null
          && <p className={css.warning}>{t('handoffTechnicalQcUnverified')}</p>}
        {technicalQcStatus?.staleTechnicalQc !== null
          && technicalQcStatus?.staleTechnicalQc !== undefined
          && <p className={css.warning}>
            {technicalQcStatus.staleTechnicalQc.code}: {technicalQcStatus.staleTechnicalQc.driftFields.join(', ')}
          </p>}
      </section>
      <section className={css.preview} aria-labelledby="handoff-evidence-freeze-title">
        <header><div><strong id="handoff-evidence-freeze-title">{t('handoffEvidenceFreezeTitle')}</strong>
          <p>{t('handoffEvidenceFreezeBoundary')}</p></div></header>
        <div className={css.candidateCommit}>
          <div>
            <strong>{t('handoffEvidenceFreezeCurrent')}</strong>
            <p>{selectionStatus?.currentFormalMaster === null || selectionStatus === undefined
              ? t('handoffEvidenceFreezeNeedsMaster')
              : `${selectionStatus.currentFormalMaster.assetId} · ${selectionStatus.currentFormalMaster.qualityStatus}`}</p>
            <p>{technicalQcStatus?.currentTechnicalQc?.outcome === 'passed'
              ? t('handoffEvidenceFreezeQcPassed') : t('handoffEvidenceFreezeNeedsQc')}</p>
          </div>
          <button type="button" disabled={evidenceFreezeState === 'previewing'
            || evidenceFreezeState === 'saving'} onClick={() => { void previewEvidenceFreeze() }}>
            {evidenceFreezeState === 'previewing'
              ? t('handoffEvidenceFreezePreparing') : t('handoffEvidenceFreezePrepare')}
          </button>
        </div>
        {evidenceFreezeError !== undefined && <p role="alert" className={css.error}>
          {t('handoffEvidenceFreezeFailed')} ({evidenceFreezeError})
        </p>}
        {evidenceFreezePreview !== undefined && <div>
          <div className={css.masterFacts}>
            <span><strong>{evidenceFreezePreview.machineReady
              ? t('handoffTrue') : t('handoffFalse')}</strong>{t('handoffEvidenceFreezeMachineReady')}</span>
            <span><strong>{evidenceFreezePreview.subject.buildIdentity.sourceClean
              ? t('handoffTrue') : t('handoffFalse')}</strong>{t('handoffEvidenceFreezeSourceClean')}</span>
          </div>
          {evidenceFreezePreview.hardBlockers.length > 0 && <div role="status">
            <strong>{t('handoffEvidenceFreezeBlockers')}</strong>
            <ul className={css.blockers}>{evidenceFreezePreview.hardBlockers.map(code =>
              <li key={code}><code>{code}</code></li>)}</ul>
          </div>}
          <button type="button" className={css.actionCard}
            disabled={!evidenceFreezePreview.canConfirm || evidenceFreezeState === 'saving'}
            onClick={() => { void confirmEvidenceFreeze() }}>
            <span>{evidenceFreezeState === 'saving'
              ? t('handoffEvidenceFreezeSaving') : t('handoffEvidenceFreezeSave')}</span>
            {evidenceFreezeState === 'saving' && <div className={css.progressBar} />}
          </button>
          <details><summary>{t('handoffAdvanced')}</summary>
            <p>Build: {evidenceFreezePreview.subject.buildIdentity.commit}</p>
            <p>Preview SHA: {evidenceFreezePreview.previewSha256}</p>
            <p>Master SHA: {evidenceFreezePreview.subject.final.sha256}</p>
            <p>Machine blockers: {evidenceFreezePreview.machineBlockers.join(', ') || '—'}</p>
            <p>Release blockers: {evidenceFreezePreview.releaseBlockers.join(', ') || '—'}</p>
          </details>
        </div>}
        {evidenceFreezeResult !== undefined && <div className={css.success} role="status">
          <strong>{t('handoffEvidenceFreezeSaved')}</strong>
          <p>{t('handoffEvidenceFreezeSavedBoundary')}</p>
          <p>{evidenceFreezeResult.packageId} · {evidenceFreezeResult.zipBytes.toLocaleString()} bytes</p>
          <details><summary>{t('handoffAdvanced')}</summary>
            <p>Manifest SHA: {evidenceFreezeResult.manifestSha256}</p>
            <p>ZIP SHA: {evidenceFreezeResult.zipSha256}</p>
            <p>Receipt: {evidenceFreezeResult.commandReceiptId}</p>
            <p>Authority: {evidenceFreezeResult.releaseAuthorityRevisionBefore} → {evidenceFreezeResult.releaseAuthorityRevision}</p>
          </details>
        </div>}
        {evidenceFreezeStatus?.currentPackage !== null
          && evidenceFreezeStatus?.currentPackage !== undefined
          && evidenceFreezeResult === undefined
          && <p className={css.success}>{t('handoffEvidenceFreezeRecovered')}</p>}
      </section>
      <section className={css.rc1Grid} aria-label={t('handoffRc1Workspace')}>
        <article className={css.rc1Card} aria-labelledby="handoff-content-review-title">
          <header><div><strong id="handoff-content-review-title">{t('handoffContentReviewTitle')}</strong>
            <p>{t('handoffContentReviewBoundary')}</p></div></header>
          {rc1Status?.contentReview.binding === undefined
            ? <p className={css.warning}>{t('handoffContentReviewNeedsRc1')}</p>
            : <>
              <div className={humanSessionState === 'ready' ? css.success : css.warning}>
                <p>{humanSessionState === 'ready'
                  ? t('handoffHumanSessionReady') : t('handoffHumanSessionRequired')}</p>
                {humanSessionState !== 'ready' && <>
                  <label className={css.formField}><span>{t('handoffHumanUsername')}</span>
                    <input autoComplete="username" value={humanUsername} maxLength={120}
                      onChange={(event) => { setHumanUsername(event.currentTarget.value) }} /></label>
                  <label className={css.formField}><span>{t('handoffHumanPassword')}</span>
                    <input type="password" autoComplete="current-password" value={humanPassword}
                      onChange={(event) => { setHumanPassword(event.currentTarget.value) }} /></label>
                  <button type="button" disabled={humanSessionState === 'saving'
                    || humanUsername.trim() === '' || humanPassword === ''}
                  onClick={() => { void authenticateHumanSession() }}>
                    {humanSessionState === 'saving'
                      ? t('handoffHumanSessionSaving') : t('handoffHumanSessionLogin')}
                  </button>
                  {humanSessionState === 'failed'
                    && <p role="alert" className={css.error}>{t('handoffHumanSessionFailed')}</p>}
                </>}
              </div>
              {humanSessionState === 'ready' && <div className={humanPresenceStatus?.state === 'registered'
                ? css.success : css.warning} role="status">
                <p>{humanPresenceStatus?.state === 'registered'
                  ? t('handoffHumanPresenceReady') : t('handoffHumanPresenceRequired')}</p>
                {humanPresenceStatus?.state !== 'registered' && <button type="button"
                  disabled={humanPresenceState === 'prompting'}
                  onClick={() => { void registerHumanPresence() }}>
                  {humanPresenceState === 'prompting'
                    ? t('handoffHumanPresencePrompting') : t('handoffHumanPresenceRegister')}
                </button>}
                {humanPresenceState === 'prompting' && <button type="button" className={css.rejectButton}
                  onClick={() => { humanPresenceController.current?.abort() }}>
                  {t('handoffHumanPresenceCancel')}
                </button>}
                {humanPresenceState === 'failed' && <p role="alert" className={css.error}>
                  {humanPresenceError === 'platform_presence_cancelled'
                    ? t('handoffHumanPresenceCancelled') : t('handoffHumanPresenceFailed')}
                </p>}
              </div>}
              {rc1Status.contentReview.identity.state === 'bound'
                ? <p className={css.success}>{t('handoffIdentityBound')}</p>
                : <div className={css.warning} role="status">
                  <p>{rc1Status.contentReview.identity.state === 'unbound'
                    ? t('handoffIdentityUnbound') : t('handoffIdentityInvalid')}</p>
                  {rc1Status.contentReview.identity.canEnroll && <button type="button"
                    disabled={identitySaving || humanSessionState !== 'ready'
                      || humanPresenceStatus?.state !== 'registered'}
                    onClick={() => { void enrollNaturalPersonIdentity() }}>
                    {identitySaving ? t('handoffIdentitySaving') : t('handoffIdentityEnroll')}
                  </button>}
                </div>}
              {identityError !== undefined && <p role="alert" className={css.error}>
                {identityError === 'natural_person_identity_relogin_required'
                  ? t('handoffIdentityRelogin') : t('handoffIdentityUnknown')}
              </p>}
              <video className={css.finalPlayer} controls preload="none"
                src={`/api/qingmu/editorial-handoff/final-media?${new URLSearchParams({
                  projectId, episodeId, sha256: rc1Status.contentReview.binding.finalSha256,
                }).toString()}`}
                onTimeUpdate={(event) => {
                  const media = event.currentTarget
                  setPlayedCoverage(continuousPlayedCoverage(media.played, media.duration))
                }} />
              <p className={playedCoverage === 1 ? css.success : css.warning}>
                {t('handoffContentPlayback')}: {(playedCoverage * 100).toFixed(0)}%
              </p>
              <fieldset className={css.reviewChecks} disabled={!rc1Status.contentReview.canDecide}>
                <legend>{t('handoffContentChecks')}</legend>
                {([
                  ['picture_and_timing_reviewed', 'handoffContentCheckPicture'],
                  ['dialogue_and_audio_reviewed', 'handoffContentCheckAudio'],
                  ['continuity_and_content_reviewed', 'handoffContentCheckContinuity'],
                ] as const).map(([key, label]) => <label key={key}>
                  <input type="checkbox" checked={contentChecks[key] === true}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setContentChecks(current => ({ ...current, [key]: checked }))
                    }} />
                  <span>{t(label)}</span>
                </label>)}
              </fieldset>
              <label className={css.formField}><span>{t('handoffContentNote')}</span>
                <textarea value={contentNote} maxLength={2000}
                  disabled={!rc1Status.contentReview.canDecide}
                  onChange={(event) => { setContentNote(event.currentTarget.value) }} /></label>
              <label className={css.formField}><span>{t('handoffContentRejectReason')}</span>
                <select value={contentRejectReason} disabled={!rc1Status.contentReview.canDecide}
                  onChange={(event) => { setContentRejectReason(event.currentTarget.value) }}>
                  <option value="picture_or_timing">{t('handoffContentRejectPicture')}</option>
                  <option value="dialogue_or_audio">{t('handoffContentRejectAudio')}</option>
                  <option value="continuity_or_content">{t('handoffContentRejectContinuity')}</option>
                  <option value="other">{t('handoffContentRejectOther')}</option>
                </select></label>
              <div className={css.decisionActions}>
                <button type="button" className={css.actionCard}
                  disabled={playedCoverage !== 1
                    || Object.values(contentChecks).some(value => !value)
                    || humanSessionState !== 'ready'
                    || humanPresenceStatus?.state !== 'registered'
                    || rc1Status.contentReview.identity.state !== 'bound'
                    || !rc1Status.contentReview.canDecide || rc1State === 'deciding'}
                  onClick={() => { void decideFinalContent('accepted') }}>
                  <span>{rc1State === 'deciding' ? t('handoffContentDeciding') : t('handoffContentAccept')}</span>
                  {rc1State === 'deciding' && <div className={css.progressBar} />}
                </button>
                <button type="button" className={css.rejectButton}
                  disabled={playedCoverage !== 1
                    || humanSessionState !== 'ready'
                    || humanPresenceStatus?.state !== 'registered'
                    || rc1Status.contentReview.identity.state !== 'bound'
                    || !rc1Status.contentReview.canDecide
                    || rc1State === 'deciding'}
                  onClick={() => { void decideFinalContent('rejected') }}>
                  {rc1State === 'deciding' ? t('handoffContentDeciding') : t('handoffContentReject')}
                </button>
              </div>
            </>}
          {rc1Status?.contentReview.legacyDecisionRequiresReconfirmation === true
            && <p className={css.warning} role="status">{t('handoffContentLegacyUnverified')}</p>}
          {rc1Status?.contentReview.currentDecision !== null
            && rc1Status?.contentReview.currentDecision !== undefined
            && rc1Status.contentReview.currentDecision.humanAuthorityVerified
            && <p className={rc1Status.contentReview.currentDecision.decision === 'accepted'
              ? css.success : css.warning} role="status">
              {rc1Status.contentReview.currentDecision.decision === 'accepted'
                ? t('handoffContentAccepted') : t('handoffContentRejected')}
            </p>}
        </article>
        <article className={css.rc1Card} aria-labelledby="handoff-machine-evidence-title">
          <header><div><strong id="handoff-machine-evidence-title">{t('handoffMachineEvidenceTitle')}</strong>
            <p>{t('handoffMachineEvidenceBoundary')}</p></div></header>
          {rc1Status?.rc1Package.currentPackage === null || rc1Status === undefined
            ? <>
              <p className={css.warning}>{t('handoffMachineEvidenceMissing')}</p>
              <button type="button" onClick={() => { void previewRc1() }}
                disabled={rc1State === 'loading' || rc1State === 'saving'}>{t('handoffMachineEvidencePrepare')}</button>
              {rc1Preview !== undefined && <>
                {rc1Preview.hardBlockers.length > 0 && <ul className={css.blockers}>
                  {rc1Preview.hardBlockers.map(code => <li key={code}>{code}</li>)}</ul>}
                <button type="button" className={css.actionCard} onClick={() => { void confirmRc1() }}
                  disabled={!rc1Preview.canConfirm || rc1State === 'saving'}>
                  <span>{rc1State === 'saving' ? t('handoffMachineEvidenceFreezing') : t('handoffMachineEvidenceFreeze')}</span>
                  {rc1State === 'saving' && <div className={css.progressBar} />}
                </button>
              </>}
            </>
            : <>
              <p className={css.success}>{t('handoffMachineEvidenceReady')}</p>
              <a className={css.downloadLink} href={`/api/qingmu/editorial-handoff/rc1-evidence.zip?${new URLSearchParams({
                projectId, episodeId,
                packageId: rc1Status.rc1Package.currentPackage.packageId,
                manifestSha256: rc1Status.rc1Package.currentPackage.manifestSha256,
              }).toString()}`} download="qingmu-rc1-evidence.zip">{t('handoffMachineEvidenceDownload')}</a>
              <details><summary>{t('handoffAdvanced')}</summary>
                <p>Package: {rc1Status.rc1Package.currentPackage.packageId}</p>
                <p>Manifest SHA: {rc1Status.rc1Package.currentPackage.manifestSha256}</p>
                <p>ZIP SHA: {rc1Status.rc1Package.currentPackage.zipSha256}</p>
              </details>
            </>}
        </article>
        <article className={css.rc1Card} aria-labelledby="handoff-release-signoff-title">
          <header><div><strong id="handoff-release-signoff-title">{t('handoffReleaseSignoffTitle')}</strong>
            <p>{t('handoffReleaseSignoffBoundary')}</p></div></header>
          <p className={css.warning}>{t('handoffReleaseSignoffMissing')}</p>
          <ul className={css.blockers}>{(rc1Status?.releaseSignoff.blockers
            ?? ['organization_release_signoff_missing']).map(code => <li key={code}>{code}</li>)}</ul>
        </article>
      </section>
      {rc1Error !== undefined && <p className={css.error} role="alert">{rc1Error}</p>}
    </section>
  </section>
}
