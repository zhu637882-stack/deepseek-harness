/* oxlint-disable typescript/no-unnecessary-condition -- Acceptance RPC DTOs are untrusted at this runtime boundary. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Exact false/zero flags deny adjacent authority. */
import { useEffect, useRef, useState } from 'react'
import type {
  ImagoTakeAcceptanceMethodResponse, QingmuYimengPort, YimengTakeAcceptanceResponse,
  YimengTakeVersion, YimengTakeVersionSelectionResult, YimengTakeVersionStackResponse, YimengWorkflowProjection,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { TakeCommentsPanel, type TakeCommentPort } from './TakeCommentsPanel.tsx'
import {
  TakeReviewAuthorityPanel,
  type TakeReviewAuthorityPort,
} from './TakeReviewAuthorityPanel.tsx'
import {
  TakeTechnicalQcPanel,
  type TakeTechnicalQcPort,
} from './TakeTechnicalQcPanel.tsx'
import {
  TakeApprovalLifecyclePanel,
  type TakeApprovalLifecyclePort,
} from './TakeApprovalLifecyclePanel.tsx'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker,
  readTakeVersionSelectionMarker, writeTakeVersionSelectionMarker,
  type TakeVersionSelectionRecoveryMarker, type TakeVersionSelectionRecoveryRead,
} from './take-version-recovery.ts'
import card from './QingmuCockpit.module.css'
import css from './TakeVersionCompareView.module.css'

interface TakeVersionCompareViewProps {
  readonly projectId: string
  readonly episodeId: string
  readonly selectedShotId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly enabled: boolean
  readonly port: Pick<QingmuYimengPort,
    'takeVersions' | 'takeAcceptance' | 'takeAcceptanceMethod'
    | 'selectTakeVersion' | 'recoverTakeVersionSelection'>
    & Partial<TakeCommentPort> & Partial<TakeReviewAuthorityPort> & Partial<TakeTechnicalQcPort>
    & Partial<TakeApprovalLifecyclePort>
  readonly t: (key: QingmuCockpitKey) => string
}

interface Run {
  readonly source: YimengWorkflowProjection
  readonly port: TakeVersionCompareViewProps['port']
  readonly refresh: number
  readonly controller: AbortController
  live: boolean
}

type LoadState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly stack: YimengTakeVersionStackResponse }
)

type AcceptanceState = { readonly run: Run } & (
  | { readonly status: 'loading' | 'error' | 'none' }
  | {
    readonly status: 'ready'
    readonly evidence: YimengTakeAcceptanceResponse
    readonly method: ImagoTakeAcceptanceMethodResponse
  }
)

interface Busy {
  readonly run: Run
  kind: 'select' | 'recover'
}

interface Notice {
  readonly key: QingmuCockpitKey
  readonly error: boolean
}

function hasTakeCommentPort(port: TakeVersionCompareViewProps['port']): port is typeof port & TakeCommentPort {
  return typeof port.takeComments === 'function' && typeof port.createTakeComment === 'function'
    && typeof port.recoverTakeComment === 'function'
}

function hasTakeReviewAuthorityPort(
  port: TakeVersionCompareViewProps['port'],
): port is typeof port & TakeReviewAuthorityPort {
  return typeof port.takeReviewAuthority === 'function'
    && typeof port.createTakeReviewRecommendation === 'function'
    && typeof port.recoverTakeReviewRecommendation === 'function'
    && typeof port.createTakeHumanDecision === 'function'
    && typeof port.recoverTakeHumanDecision === 'function'
}

function hasTakeTechnicalQcPort(
  port: TakeVersionCompareViewProps['port'],
): port is typeof port & TakeTechnicalQcPort {
  return typeof port.takeTechnicalQc === 'function'
    && typeof port.recordTakeTechnicalQc === 'function'
    && typeof port.recoverTakeTechnicalQc === 'function'
}

function hasTakeApprovalLifecyclePort(
  port: TakeVersionCompareViewProps['port'],
): port is typeof port & TakeApprovalLifecyclePort {
  return typeof port.takeApprovalLifecycle === 'function'
    && typeof port.takeApprovalLifecycleMethod === 'function'
    && typeof port.transitionTakeApprovalLifecycle === 'function'
    && typeof port.recoverTakeApprovalLifecycleTransition === 'function'
}

function requestFromMarker(marker: TakeVersionSelectionRecoveryMarker) {
  return {
    projectId: marker.projectId,
    episodeId: marker.episodeId,
    frameId: marker.frameId,
    expectedStackSha256: marker.expectedStackSha256,
    expectedSelectedTakeId: marker.expectedSelectedTakeId,
    candidateTakeId: marker.candidateTakeId,
    candidateVersionOrdinal: marker.candidateVersionOrdinal,
    candidateOutputSha256: marker.candidateOutputSha256,
    idempotencyKey: marker.idempotencyKey,
  }
}

function receiptMatches(result: YimengTakeVersionSelectionResult, marker: TakeVersionSelectionRecoveryMarker): boolean {
  return result.schema === 'jason.qingmu-take-selection-result.v1'
    && result.projectId === marker.projectId && result.episodeId === marker.episodeId
    && result.frameId === marker.frameId && result.baseStackSnapshotSha256 === marker.expectedStackSha256
    && result.idempotencyKey === marker.idempotencyKey && result.selectedTake.takeId === marker.candidateTakeId
    && result.selectedTake.versionOrdinal === marker.candidateVersionOrdinal
    && result.selectedTake.outputSha256 === marker.candidateOutputSha256
    && result.authoritativeStack.selectedTakeId === marker.candidateTakeId
    && result.selectionChanged === true && result.providerCalls === 0
    && result.paidProviderAuthority === 'not_granted' && result.budgetMutation === false
    && result.humanApprovalInferred === false && result.formalApprovalChanged === false
}

const SHA = /^[0-9a-f]{64}$/
const RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-video-generation-routing-policy.json',
  'pipeline/v6-video-reference-integrity-overlay-policy.json',
  'scripts/probe_v6_video_receipt.py',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_take_acceptance_method.py',
] as const

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function jcsJson(value: unknown, depth = 0): string {
  if (depth > 100) throw new Error('Take acceptance JSON is too deeply nested')
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('Take acceptance JSON contains invalid Unicode')
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    const rendered: unknown = JSON.stringify(value)
    if (!Number.isFinite(value) || typeof rendered !== 'string'
      || (Number.isInteger(value) && !Number.isSafeInteger(value) && !/[eE]/.test(rendered))) {
      throw new Error('Take acceptance JSON contains an unsupported number')
    }
    return rendered
  }
  if (Array.isArray(value)) return `[${value.map(item => jcsJson(item, depth + 1)).join(',')}]`
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    const keys = Object.keys(item)
    if (!keys.every(key => key.isWellFormed())) throw new Error('Take acceptance JSON contains an invalid key')
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${jcsJson(item[key], depth + 1)}`).join(',')}}`
  }
  throw new Error('Take acceptance payload is not JSON')
}

async function jcsSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(jcsJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function evidenceStructure(value: YimengTakeAcceptanceResponse): boolean {
  const { evidence } = value
  const { subject, providerReceipt, technicalReceipt, candidateQuality } = evidence
  const video = technicalReceipt.video
  const audio = technicalReceipt.audio
  return exactKeys(value, ['schema', 'evidence', 'evidenceSnapshotSha256', 'productionStatus', 'boundaries'])
    && exactKeys(evidence, ['subject', 'providerReceipt', 'technicalReceipt', 'candidateQuality'])
    && exactKeys(subject, [
      'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision', 'frameContentSha256',
      'selectionRevision', 'takeId', 'versionOrdinal', 'selectionStatus', 'outputSha256', 'taskId', 'capability',
      'routeKey', 'provider', 'model', 'inputHash', 'submitId',
    ])
    && exactKeys(providerReceipt, [
      'schema', 'status', 'evidenceMode', 'actualProviderReceiptVerified', 'requestDryRun',
      'taskRequestHashVerified', 'outboxState', 'dispatchEpoch', 'dispatchDigest', 'payloadSha256',
      'responseSha256', 'providerTaskId', 'providerStatus', 'localStatus', 'providerMediaBindingStatus',
      'providerMediaRecordId', 'blockers',
    ])
    && exactKeys(technicalReceipt, [
      'schema', 'imagoReceiptSchema', 'status', 'media', 'fullVideoDecode', 'blockers', 'warnings', 'video', 'audio',
    ])
    && exactKeys(technicalReceipt.media, ['bytes', 'sha256'])
    && exactKeys(technicalReceipt.fullVideoDecode, ['required', 'commandProfile', 'status', 'returncode'])
    && (video === null || exactKeys(video, [
      'durationSeconds', 'width', 'height', 'codecName', 'nbFrames', 'avgFrameRate', 'rFrameRate',
      'videoStreamDurationSeconds', 'avgFrameRateDecimal', 'rFrameRateDecimal', 'actualAverageFrameRate',
      'actualFrameRateBasis', 'nominalRFrameRateIsActual',
    ]))
    && (audio === null || exactKeys(audio, ['codecName', 'channels', 'sampleRate']))
    && exactKeys(candidateQuality, [
      'schema', 'status', 'requiredCheckTypes', 'checks', 'missingCheckTypes', 'failedOrStaleCheckTypes',
    ])
    && candidateQuality.checks.every(check => exactKeys(
      check, ['checkId', 'checkType', 'passed', 'createdAt', 'current'],
    ))
    && exactKeys(value.boundaries, [
      'readOnly', 'selectedIsApproval', 'formalApprovalChanged', 'providerCalls', 'databaseWrites',
      'budgetMutation', 'humanSignoffInferred', 'paidProviderAuthority', 'gateBCompleted',
    ])
}

function fixedEvidenceValues(value: YimengTakeAcceptanceResponse): boolean {
  const { evidence, boundaries } = value
  const { subject, providerReceipt, technicalReceipt, candidateQuality } = evidence
  const verifiedProvider = providerReceipt.status === 'verified'
    && providerReceipt.evidenceMode === 'provider_receipt' && providerReceipt.actualProviderReceiptVerified
    && providerReceipt.requestDryRun === false && providerReceipt.taskRequestHashVerified
    && (providerReceipt.outboxState === 'acknowledged' || providerReceipt.outboxState === 'settled')
    && providerReceipt.dispatchEpoch > 0 && providerReceipt.dispatchDigest !== null
    && providerReceipt.payloadSha256 !== null && providerReceipt.responseSha256 !== null
    && providerReceipt.providerTaskId !== null && providerReceipt.providerMediaBindingStatus === 'PASS'
    && providerReceipt.providerMediaRecordId !== null && providerReceipt.blockers.length === 0
  const boundedProvider = providerReceipt.status === 'bounded_local'
    && providerReceipt.evidenceMode === 'bounded_local' && !providerReceipt.actualProviderReceiptVerified
    && providerReceipt.requestDryRun === true
    && JSON.stringify(providerReceipt.blockers) === JSON.stringify(['PROVIDER_RECEIPT_DRY_RUN_ONLY'])
  const unavailableProvider = (providerReceipt.status === 'missing' || providerReceipt.status === 'invalid')
    && providerReceipt.evidenceMode === 'unverified' && !providerReceipt.actualProviderReceiptVerified
  return value.schema === 'jason.qingmu-take-acceptance-evidence.v1'
    && value.productionStatus === 'UNVERIFIED_FOR_PAID_PRODUCTION' && SHA.test(value.evidenceSnapshotSha256)
    && boundaries.readOnly && !boundaries.selectedIsApproval && !boundaries.formalApprovalChanged
    && boundaries.providerCalls === 0 && boundaries.databaseWrites === 0 && !boundaries.budgetMutation
    && !boundaries.humanSignoffInferred && boundaries.paidProviderAuthority === 'not_granted'
    && !boundaries.gateBCompleted && subject.schema === 'jason.qingmu-take-acceptance-subject.v1'
    && subject.selectionStatus === 'Selected' && SHA.test(subject.frameContentSha256)
    && (subject.outputSha256 === null || SHA.test(subject.outputSha256))
    && (subject.inputHash === null || SHA.test(subject.inputHash))
    && providerReceipt.schema === 'jason.qingmu-provider-submission-receipt-evidence.v1'
    && stringList(providerReceipt.blockers) && (verifiedProvider || boundedProvider || unavailableProvider)
    && providerReceipt.payloadSha256 === subject.inputHash && providerReceipt.providerTaskId === subject.submitId
    && technicalReceipt.schema === 'jason.qingmu-technical-video-receipt.v1'
    && technicalReceipt.imagoReceiptSchema === 'IMAGO-V6-TechnicalVideoReceipt-v1'
    && technicalReceipt.fullVideoDecode.required
    && technicalReceipt.fullVideoDecode.commandProfile === 'ffmpeg -v error -xerror -map 0:v:0 -f null -'
    && (technicalReceipt.media.sha256 === subject.outputSha256)
    && stringList(technicalReceipt.blockers) && stringList(technicalReceipt.warnings)
    && (technicalReceipt.video === null || (
      technicalReceipt.video.actualFrameRateBasis === 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE'
      && !technicalReceipt.video.nominalRFrameRateIsActual
    ))
    && candidateQuality.schema === 'jason.qingmu-take-candidate-quality-evidence.v1'
    && stringList(candidateQuality.requiredCheckTypes) && stringList(candidateQuality.missingCheckTypes)
    && stringList(candidateQuality.failedOrStaleCheckTypes)
}

function methodStructure(value: ImagoTakeAcceptanceMethodResponse): boolean {
  const { projection, methodAttestation } = value
  const { definition, evaluation } = projection
  return exactKeys(value, ['schema', 'projection', 'projectionSha256', 'methodAttestation'])
    && exactKeys(projection, [
      'schema', 'subject', 'evidenceSnapshotSha256', 'definition', 'evaluation', 'ruleBindings', 'rulesSha256',
    ])
    && exactKeys(definition, ['mode', 'technicalReceipt', 'qualityLayers', 'boundaries'])
    && exactKeys(definition.technicalReceipt, [
      'requiredVideoFields', 'fullVideoDecodeRequired', 'fullVideoDecodeCommandProfile',
      'actualFrameRateBasis', 'nominalRFrameRateIsActual',
    ])
    && exactKeys(definition.qualityLayers, ['macro', 'micro'])
    && exactKeys(definition.qualityLayers.macro, ['required', 'dimensions', 'yimengCheckTypes'])
    && exactKeys(definition.qualityLayers.micro, [
      'required', 'dimensions', 'yimengBaseCheckTypes', 'conditionalDialogueCheckType', 'technicalReceiptRequired',
    ])
    && exactKeys(definition.boundaries, [
      'businessTruth', 'selectedIsApproval', 'formalAcceptanceAllowed', 'providerCalls', 'projectMutation',
      'humanSignoffInferred', 'paidProviderAuthority', 'gateBCompleted', 'inactiveReferenceOverlayActivated',
    ])
    && exactKeys(evaluation, [
      'technicalReceiptStatus', 'fullVideoDecodeStatus', 'macroQc', 'microQc', 'providerReceipt',
      'localControlStatus', 'localBlockers', 'productionVerificationStatus', 'formalAcceptanceAllowed',
      'selectedIsApproval', 'gateBCompleted',
    ])
    && exactKeys(evaluation.macroQc, ['status', 'checkTypes', 'blockers'])
    && exactKeys(evaluation.microQc, ['status', 'checkTypes', 'blockers'])
    && exactKeys(evaluation.providerReceipt, ['status', 'evidenceMode', 'actualProviderReceiptVerified', 'blockers'])
    && exactKeys(methodAttestation, [
      'schema', 'algorithm', 'evidenceSnapshotSha256', 'methodProjectionSha256', 'signature',
    ])
}

function fixedMethodValues(value: ImagoTakeAcceptanceMethodResponse): boolean {
  const { projection, methodAttestation } = value
  const { definition, evaluation } = projection
  const ruleKeys = Object.keys(projection.ruleBindings).sort()
  return value.schema === 'qingmu.imago-take-acceptance-method-adapter-result.v1'
    && projection.schema === 'qingmu.imago-take-acceptance-method.v1'
    && definition.mode === 'READ_ONLY_STATELESS_PROJECTION'
    && definition.technicalReceipt.fullVideoDecodeRequired
    && definition.technicalReceipt.fullVideoDecodeCommandProfile === 'ffmpeg -v error -xerror -map 0:v:0 -f null -'
    && definition.technicalReceipt.actualFrameRateBasis === 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE'
    && !definition.technicalReceipt.nominalRFrameRateIsActual
    && definition.qualityLayers.macro.required && definition.qualityLayers.micro.required
    && definition.qualityLayers.micro.technicalReceiptRequired
    && JSON.stringify(definition.qualityLayers.macro.yimengCheckTypes) === JSON.stringify(['creative_director_execution'])
    && JSON.stringify(definition.qualityLayers.micro.yimengBaseCheckTypes) === JSON.stringify(['real_vl_native_video_output'])
    && definition.qualityLayers.micro.conditionalDialogueCheckType === 'creative_dialogue_audio'
    && definition.boundaries.businessTruth === 'yimeng' && !definition.boundaries.selectedIsApproval
    && !definition.boundaries.formalAcceptanceAllowed && definition.boundaries.providerCalls === 0
    && !definition.boundaries.projectMutation && !definition.boundaries.humanSignoffInferred
    && definition.boundaries.paidProviderAuthority === 'not_granted' && !definition.boundaries.gateBCompleted
    && !definition.boundaries.inactiveReferenceOverlayActivated
    && evaluation.productionVerificationStatus === 'UNVERIFIED_FOR_PAID_PRODUCTION'
    && !evaluation.formalAcceptanceAllowed && !evaluation.selectedIsApproval && !evaluation.gateBCompleted
    && stringList(evaluation.localBlockers) && stringList(evaluation.macroQc.checkTypes)
    && stringList(evaluation.macroQc.blockers) && stringList(evaluation.microQc.checkTypes)
    && stringList(evaluation.microQc.blockers) && stringList(evaluation.providerReceipt.blockers)
    && JSON.stringify(ruleKeys) === JSON.stringify([...RULE_PATHS].sort())
    && Object.values(projection.ruleBindings).every(hash => SHA.test(hash)) && SHA.test(projection.rulesSha256)
    && SHA.test(value.projectionSha256)
    && methodAttestation.schema === 'qingmu.imago-take-acceptance-method-attestation.v1'
    && methodAttestation.algorithm === 'hmac-sha256' && SHA.test(methodAttestation.signature)
}

async function acceptanceMatches(
  stack: YimengTakeVersionStackResponse,
  evidence: YimengTakeAcceptanceResponse,
  method: ImagoTakeAcceptanceMethodResponse,
): Promise<boolean> {
  try {
    if (!evidenceStructure(evidence) || !fixedEvidenceValues(evidence)
      || !methodStructure(method) || !fixedMethodValues(method)) return false
    const selectedTakeId = stack.subject.selectedTakeId
    const selected = stack.subject.versions.find(version => version.takeId === selectedTakeId)
    const subject = evidence.evidence.subject
    if (selectedTakeId === null || selected === undefined || !selected.isSelected || selected.selectionStatus !== 'Selected'
      || selected.lineageComplete !== true || selected.outputBindingStatus !== 'verified'
      || selected.recordedOutputSha256 === null || selected.recordedOutputSha256 !== selected.outputSha256
      || subject.projectId !== stack.subject.projectId || subject.episodeId !== stack.subject.episodeId
      || subject.frameId !== stack.subject.frameId || subject.frameNo !== stack.subject.frameNo
      || subject.storyboardRevision !== stack.subject.storyboardRevision
      || subject.frameContentSha256 !== stack.subject.frameContentSha256
      || subject.selectionRevision !== stack.subject.selectionRevision || subject.takeId !== selectedTakeId
      || subject.versionOrdinal !== selected.versionOrdinal || subject.outputSha256 !== selected.outputSha256
      || subject.taskId !== selected.taskId || subject.provider !== selected.provider || subject.model !== selected.model
      || subject.routeKey !== selected.routeKey || subject.inputHash !== selected.inputHash
      || subject.submitId !== selected.providerTaskId) return false
    if (await jcsSha256(evidence.evidence) !== evidence.evidenceSnapshotSha256
      || jcsJson(method.projection.subject) !== jcsJson(subject)
      || method.projection.evidenceSnapshotSha256 !== evidence.evidenceSnapshotSha256
      || await jcsSha256(method.projection.ruleBindings) !== method.projection.rulesSha256
      || await jcsSha256(method.projection) !== method.projectionSha256
      || method.methodAttestation.evidenceSnapshotSha256 !== evidence.evidenceSnapshotSha256
      || method.methodAttestation.methodProjectionSha256 !== method.projectionSha256) return false
    const evaluation = method.projection.evaluation
    const provider = evidence.evidence.providerReceipt
    const technical = evidence.evidence.technicalReceipt
    const quality = evidence.evidence.candidateQuality
    const macroTypes = method.projection.definition.qualityLayers.macro.yimengCheckTypes
    const microTypes: string[] = [...method.projection.definition.qualityLayers.micro.yimengBaseCheckTypes]
    if (quality.requiredCheckTypes.includes(
      method.projection.definition.qualityLayers.micro.conditionalDialogueCheckType,
    )) microTypes.push(method.projection.definition.qualityLayers.micro.conditionalDialogueCheckType)
    microTypes.sort()
    const passed = (type: string) => quality.checks.some(
      check => check.checkType === type && check.current && check.passed,
    )
    const macroStatus = macroTypes.every(passed) ? 'PASS' : 'BLOCKED'
    const microStatus = technical.status === 'PASS' && microTypes.every(passed) ? 'PASS' : 'BLOCKED'
    const localStatus = technical.status === 'PASS' && macroStatus === 'PASS' && microStatus === 'PASS'
      ? 'PASS' : 'BLOCKED'
    return evaluation.technicalReceiptStatus === technical.status
      && evaluation.fullVideoDecodeStatus === technical.fullVideoDecode.status
      && evaluation.macroQc.status === macroStatus && evaluation.microQc.status === microStatus
      && JSON.stringify(evaluation.macroQc.checkTypes) === JSON.stringify(macroTypes)
      && JSON.stringify(evaluation.microQc.checkTypes) === JSON.stringify(microTypes)
      && evaluation.providerReceipt.status === provider.status
      && evaluation.providerReceipt.evidenceMode === provider.evidenceMode
      && evaluation.providerReceipt.actualProviderReceiptVerified === provider.actualProviderReceiptVerified
      && evaluation.localControlStatus === localStatus
  } catch {
    return false
  }
}

/** Same-Shot Take comparison and owner selection. Selection never means approval or paid generation. */
export function TakeVersionCompareView(props: TakeVersionCompareViewProps) {
  const key = JSON.stringify([props.projectId, props.episodeId, props.selectedShotId])
  return <TakeVersionComparePanel key={key} {...props} />
}

function TakeVersionComparePanel({
  projectId, episodeId, selectedShotId, projection, enabled, port, t,
}: TakeVersionCompareViewProps) {
  const scope = { projectId, episodeId, frameId: selectedShotId }
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<LoadState>()
  const [acceptanceState, setAcceptanceState] = useState<AcceptanceState>()
  const [compareTakeIds, setCompareTakeIds] = useState<readonly string[]>([])
  const [marker, setMarker] = useState<TakeVersionSelectionRecoveryRead>(
    () => readTakeVersionSelectionMarker(scope),
  )
  const [busy, setBusy] = useState<Busy>()
  const [notice, setNotice] = useState<Notice>()
  const [receipt, setReceipt] = useState<YimengTakeVersionSelectionResult>()
  const [commentPreferredTakeId, setCommentPreferredTakeId] = useState<string>()
  const runRef = useRef<Run>()
  const busyRef = useRef<Busy>()
  const autoRecoveryRef = useRef<string>()
  const selectedShot = projection?.director.shotRelations.shots.find(shot => shot.shotId === selectedShotId)
  const eligible = enabled && projection !== undefined && selectedShot !== undefined
    && projection.projectId === projectId && projection.episodeId === episodeId
  const live = (run: Run) => run.live && runRef.current === run && !run.controller.signal.aborted

  function announce(run: Run, key: QingmuCockpitKey, error = false) {
    if (live(run)) setNotice({ key, error })
  }

  function begin(run: Run, kind: Busy['kind']): Busy | undefined {
    if (!live(run) || busyRef.current !== undefined) return undefined
    const active: Busy = { run, kind }
    busyRef.current = active
    setBusy(active)
    setNotice(undefined)
    return active
  }

  function finish(active: Busy) {
    if (busyRef.current !== active) return
    busyRef.current = undefined
    if (live(active.run)) setBusy(undefined)
  }

  function acceptReceipt(
    result: YimengTakeVersionSelectionResult,
    intent: TakeVersionSelectionRecoveryMarker,
    run: Run,
  ) {
    if (!receiptMatches(result, intent)) throw new Error('Take selection receipt mismatch')
    if (!live(run)) return
    const expected = { status: 'ready' as const, marker: intent }
    const cleared = clearTakeVersionSelectionMarker(intent, expected)
    setMarker(readTakeVersionSelectionMarker(intent))
    setReceipt(result)
    announce(run, cleared ? 'takeVersionSelectionCommitted' : 'takeVersionMarkerChanged', !cleared)
    // The receipt is evidence only. The visible stack always comes from a new authoritative GET.
    setRefresh(value => value + 1)
  }

  async function performRecovery(active: Busy, intent: TakeVersionSelectionRecoveryMarker) {
    active.kind = 'recover'
    if (live(active.run)) setBusy({ run: active.run, kind: 'recover' })
    autoRecoveryRef.current = intent.idempotencyKey
    try {
      const recovered = await port.recoverTakeVersionSelection(
        requestFromMarker(intent),
        active.run.controller.signal,
      )
      if (!live(active.run)) return
      if (recovered.status === 'committed' && recovered.result !== null) {
        acceptReceipt(recovered.result, intent, active.run)
      } else if (recovered.status === 'not_found' && recovered.result === null) {
        announce(active.run, 'takeVersionSelectionUnknown', true)
      } else {
        throw new Error('Take selection recovery mismatch')
      }
    } catch {
      announce(active.run, 'takeVersionRecoveryError', true)
    }
  }

  useEffect(() => {
    const stored = readTakeVersionSelectionMarker(scope)
    setMarker(stored)
    if (!eligible || projection === undefined || selectedShot === undefined) {
      setState(undefined)
      setAcceptanceState(undefined)
      return
    }
    const run: Run = { source: projection, port, refresh, controller: new AbortController(), live: true }
    runRef.current = run
    busyRef.current = undefined
    setBusy(undefined)
    setState({ run, status: 'loading' })
    setAcceptanceState(undefined)
    void (async () => {
      try {
        const stack = await port.takeVersions(scope, run.controller.signal)
        if (!live(run)) return
        if (stack.subject.projectId !== projectId || stack.subject.episodeId !== episodeId
          || stack.subject.frameId !== selectedShotId || stack.subject.frameNo !== selectedShot.frameNo
          || stack.subject.storyboardRevision !== projection.director.shotRelations.storyboardRevision.episodeRevision
          || stack.boundaries.selectedIsApproval !== false || stack.boundaries.formalApprovalChanged !== false
          || stack.boundaries.providerAuthority !== 'not_granted') {
          throw new Error('Take version stack does not match the visible Shot')
        }
        setCompareTakeIds((previous) => {
          const available = new Set(stack.subject.versions.map(version => version.takeId))
          const retained = previous.filter(takeId => available.has(takeId)).slice(0, 2)
          if (retained.length > 0) return retained
          const selected = stack.subject.selectedTakeId === null ? [] : [stack.subject.selectedTakeId]
          const second = stack.subject.versions.find(version => !selected.includes(version.takeId))
          return second === undefined ? selected : [...selected, second.takeId].slice(0, 2)
        })
        setCommentPreferredTakeId(
          stack.subject.selectedTakeId ?? stack.subject.versions[0]?.takeId,
        )
        setState({ run, status: 'ready', stack })
        if (stack.subject.selectedTakeId === null) {
          setAcceptanceState({ run, status: 'none' })
          return
        }
        setAcceptanceState({ run, status: 'loading' })
        try {
          const [evidence, method] = await Promise.all([
            port.takeAcceptance(scope, run.controller.signal),
            port.takeAcceptanceMethod(scope, run.controller.signal),
          ])
          if (!live(run)) return
          const matches = await acceptanceMatches(stack, evidence, method)
          if (!live(run)) return
          setAcceptanceState(matches
            ? { run, status: 'ready', evidence, method }
            : { run, status: 'error' })
        } catch {
          if (live(run)) setAcceptanceState({ run, status: 'error' })
        }
      } catch {
        if (live(run)) setState({ run, status: 'error' })
      }
    })()
    if (stored.status === 'ready' && autoRecoveryRef.current !== stored.marker.idempotencyKey) {
      const active = begin(run, 'recover')
      if (active !== undefined) void performRecovery(active, stored.marker).finally(() => { finish(active) })
    }
    return () => {
      run.live = false
      run.controller.abort()
      if (runRef.current === run) runRef.current = undefined
      if (busyRef.current?.run === run) busyRef.current = undefined
    }
  }, [eligible, episodeId, port, projectId, projection, refresh, selectedShot, selectedShotId])

  const current = eligible && state?.run.source === projection && state.run.port === port && state.run.refresh === refresh
    ? state : undefined
  const stack = current?.status === 'ready' ? current.stack : undefined
  const currentAcceptance = current !== undefined && acceptanceState?.run === current.run
    ? acceptanceState : undefined
  const activeBusy = busy !== undefined && live(busy.run) ? busy : undefined
  const compared = stack?.subject.versions.filter(version => compareTakeIds.includes(version.takeId)) ?? []
  const loading = eligible && (current === undefined || current.status === 'loading')

  function toggleCompare(takeId: string) {
    setCompareTakeIds((previous) => {
      if (previous.includes(takeId)) return previous.filter(item => item !== takeId)
      if (previous.length >= 2) {
        const run = runRef.current
        if (run !== undefined) announce(run, 'takeVersionCompareLimit')
        return previous
      }
      return [...previous, takeId]
    })
  }

  async function selectVersion(candidate: YimengTakeVersion) {
    const run = runRef.current
    if (run === undefined || stack === undefined || marker.status !== 'none'
      || !stack.capabilities.canSelect || !candidate.canAttemptSelection
      || !candidate.lineageComplete || candidate.outputSha256 === null) return
    const active = begin(run, 'select')
    if (active === undefined) return
    let stored: TakeVersionSelectionRecoveryMarker | undefined
    try {
      stored = await createTakeVersionSelectionMarker({
        ...scope,
        expectedStackSha256: stack.stackSnapshotSha256,
        expectedSelectedTakeId: stack.subject.selectedTakeId,
        candidateTakeId: candidate.takeId,
        candidateVersionOrdinal: candidate.versionOrdinal,
        candidateOutputSha256: candidate.outputSha256,
      })
      if (!live(run)) return
      if (!writeTakeVersionSelectionMarker(stored)) {
        setMarker(readTakeVersionSelectionMarker(scope))
        announce(run, 'takeVersionStorageFailed', true)
        return
      }
      setMarker({ status: 'ready', marker: stored })
      try {
        const result = await port.selectTakeVersion(requestFromMarker(stored), run.controller.signal)
        if (live(run)) acceptReceipt(result, stored, run)
      } catch {
        if (live(run)) await performRecovery(active, stored)
      }
    } catch {
      if (live(run)) announce(run, stored === undefined ? 'takeVersionStorageFailed' : 'takeVersionSelectionUnknown', true)
    } finally {
      finish(active)
    }
  }

  function recover() {
    const run = runRef.current
    if (run === undefined || marker.status !== 'ready') return
    const active = begin(run, 'recover')
    if (active !== undefined) void performRecovery(active, marker.marker).finally(() => { finish(active) })
  }

  function discard() {
    const run = runRef.current
    if (run === undefined || !live(run) || busyRef.current !== undefined) return
    const cleared = clearTakeVersionSelectionMarker(scope, marker)
    setMarker(readTakeVersionSelectionMarker(scope))
    announce(run, cleared ? 'takeVersionRecoveryDiscarded' : 'takeVersionMarkerChanged', !cleared)
  }

  return <section className={`${card.card} ${css.panel}`} aria-label={t('takeVersionTitle')}>
    <div className={css.header}>
      <div><h3>{t('takeVersionTitle')}</h3><p>{t('takeVersionBoundary')}</p></div>
      <button type="button" disabled={!eligible || loading || activeBusy !== undefined}
        onClick={() => { setRefresh(value => value + 1) }}>{t('takeVersionRefresh')}</button>
    </div>
    {!eligible && enabled && <p>{t('takeVersionChooseShot')}</p>}
    {loading && <p role="status">{t('takeVersionLoading')}</p>}
    {current?.status === 'error' && <p role="alert" className={card.warning}>{t('takeVersionLoadError')}</p>}
    {notice !== undefined && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? card.warning : css.notice}>
      {t(notice.key)}
    </p>}
    {marker.status !== 'none' && eligible && <div className={css.recovery}>
      <strong>{t('takeVersionRecoveryTitle')}</strong>
      <p>{t(marker.status === 'ready' ? 'takeVersionRecoveryHelp' : 'takeVersionRecoveryInvalid')}</p>
      {marker.status === 'ready' && <button type="button" disabled={activeBusy !== undefined} onClick={recover}>
        {t(activeBusy?.kind === 'recover' ? 'takeVersionRecovering' : 'takeVersionRecover')}
      </button>}
      <details><summary>{t('takeVersionDiscardRecovery')}</summary><p>{t('takeVersionDiscardHelp')}</p>
        <button type="button" disabled={activeBusy !== undefined} onClick={discard}>{t('takeVersionDiscardRecovery')}</button>
      </details>
    </div>}
    {receipt !== undefined && <p className={css.receipt} role="status">
      {t('takeVersionReceipt')} · <code>{receipt.commandReceiptId}</code> · v{receipt.selectedTake.versionOrdinal}
    </p>}
    {stack !== undefined && <div className={css.body}>
      <div className={css.stackHeader}>
        <div><strong>Shot #{stack.subject.frameNo}</strong><span><code>{stack.subject.frameId}</code></span></div>
        <div><span>{t('takeVersionSelectionRevision')}</span><strong>{stack.subject.selectionRevision}</strong></div>
        <div><span>{t('takeVersionStackSha')}</span><code>{stack.stackSnapshotSha256}</code></div>
      </div>
      <p className={css.boundary}>{t('takeVersionSelectedNotApproval')}</p>
      <TakeAcceptancePanel state={currentAcceptance} t={t} />
      {stack.subject.versions.length === 0 ? <p role="status">{t('takeVersionNoVersions')}</p> : <>
        <div className={css.versionBar} aria-label={t('takeVersionStack')}>
          {stack.subject.versions.map(version => <button key={version.takeId} type="button"
            aria-pressed={compareTakeIds.includes(version.takeId)} onClick={() => { toggleCompare(version.takeId) }}>
            v{version.versionOrdinal}{version.isSelected ? ` · ${t('takeVersionSelectedBadge')}` : ''}
          </button>)}
        </div>
        <p className={css.compareHelp}>{t('takeVersionCompareHelp')}</p>
        <div className={css.compareGrid} role="region" aria-label={t('takeVersionCompare')}>
          {compared.map(version => <TakeCard key={version.takeId} version={version} canSelect={stack.capabilities.canSelect}
            busy={activeBusy !== undefined || marker.status !== 'none'} onSelect={selectVersion} t={t} />)}
        </div>
      </>}
      {!stack.capabilities.canSelect && <p className={css.boundary}>{t('takeVersionCannotSelect')}</p>}
      <details className={css.details}>
        <summary>{t('takeVersionAuthority')}</summary>
        <p>{t('takeVersionAuthorityBody')}</p>
        <dl><div><dt>{t('takeVersionFrameSha')}</dt><dd><code>{stack.subject.frameContentSha256}</code></dd></div>
          <div><dt>{t('takeVersionStoryboardRevision')}</dt><dd>{stack.subject.storyboardRevision}</dd></div></dl>
      </details>
    </div>}
    {eligible && commentPreferredTakeId !== undefined && hasTakeCommentPort(port)
      && <TakeCommentsPanel projectId={projectId} episodeId={episodeId} frameId={selectedShotId}
        preferredTakeId={commentPreferredTakeId} refresh={refresh} port={port} t={t} />}
    {eligible && commentPreferredTakeId !== undefined && hasTakeReviewAuthorityPort(port)
      && <TakeReviewAuthorityPanel projectId={projectId} episodeId={episodeId} frameId={selectedShotId}
        preferredTakeId={commentPreferredTakeId} refresh={refresh} port={port} t={t} />}
    {eligible && stack !== undefined && stack.subject.selectedTakeId !== null
      && hasTakeTechnicalQcPort(port)
      && <TakeTechnicalQcPanel
        key={`${projectId}:${episodeId}:${selectedShotId}:${stack.subject.selectedTakeId}`}
        projectId={projectId} episodeId={episodeId} frameId={selectedShotId}
        refresh={refresh} port={port} t={t} />}
    {eligible && stack !== undefined && stack.subject.selectedTakeId !== null
      && hasTakeApprovalLifecyclePort(port)
      && <TakeApprovalLifecyclePanel
        key={`${projectId}:${episodeId}:${selectedShotId}:${stack.subject.selectedTakeId}:approval-lifecycle`}
        projectId={projectId} episodeId={episodeId} frameId={selectedShotId}
        refresh={refresh} port={port} t={t} />}
  </section>
}

function TakeAcceptancePanel({
  state, t,
}: {
  readonly state: AcceptanceState | undefined
  readonly t: (key: QingmuCockpitKey) => string
}) {
  const ready = state?.status === 'ready' ? state : undefined
  const evidence = ready?.evidence.evidence
  const evaluation = ready?.method.projection.evaluation
  const video = evidence?.technicalReceipt.video
  return <section className={css.acceptance} aria-label={t('takeAcceptanceTitle')}>
    <header><div><h4>{t('takeAcceptanceTitle')}</h4><p>{t('takeAcceptanceBoundary')}</p></div>
      {ready !== undefined && <strong className={css.productionStatus}>
        {ready.evidence.productionStatus}
      </strong>}
    </header>
    {state?.status === 'loading' && <p role="status">{t('takeAcceptanceLoading')}</p>}
    {state?.status === 'none' && <p role="status">{t('takeAcceptanceNoSelection')}</p>}
    {state?.status === 'error' && <p role="alert" className={card.warning}>{t('takeAcceptanceUnavailable')}</p>}
    {ready !== undefined && evidence !== undefined && evaluation !== undefined && <>
      <p className={css.acceptanceWarning}>{t('takeAcceptanceUnverified')}</p>
      <div className={css.acceptanceGrid}>
        <AcceptanceCard title={t('takeAcceptanceTechnical')} status={evaluation.technicalReceiptStatus}>
          <dl><div><dt>{t('takeAcceptanceDecode')}</dt><dd>{evaluation.fullVideoDecodeStatus}</dd></div>
            <div><dt>{t('takeAcceptanceActualRate')}</dt><dd>{video?.actualAverageFrameRate ?? t('unknown')}</dd></div>
            <div><dt>{t('takeAcceptanceActualRateBasis')}</dt><dd>{t('takeAcceptanceFrameCountBasis')}</dd></div>
            <div><dt>{t('takeAcceptanceNominalRate')}</dt><dd>
              {video?.rFrameRate ?? t('unknown')} · {t('takeAcceptanceNominalNotActual')}
            </dd></div></dl>
        </AcceptanceCard>
        <AcceptanceCard title={t('takeAcceptanceMacro')} status={evaluation.macroQc.status}>
          <p>{evaluation.macroQc.checkTypes.join(' · ')}</p>
        </AcceptanceCard>
        <AcceptanceCard title={t('takeAcceptanceMicro')} status={evaluation.microQc.status}>
          <p>{evaluation.microQc.checkTypes.join(' · ')}</p>
        </AcceptanceCard>
        <AcceptanceCard title={t('takeAcceptanceProvider')} status={evaluation.providerReceipt.status}>
          <dl><div><dt>{t('takeAcceptanceEvidenceMode')}</dt><dd>{evaluation.providerReceipt.evidenceMode}</dd></div>
            <div><dt>{t('takeAcceptanceRealProvider')}</dt><dd>
              {t(evaluation.providerReceipt.actualProviderReceiptVerified ? 'yes' : 'no')}
            </dd></div></dl>
        </AcceptanceCard>
      </div>
      <details className={css.acceptanceProof}><summary>{t('takeAcceptanceProof')}</summary><dl>
        <div><dt>{t('takeAcceptanceSelectedTake')}</dt><dd><code>{evidence.subject.takeId}</code></dd></div>
        <div><dt>{t('takeAcceptanceEvidenceSha')}</dt><dd><code>{ready.evidence.evidenceSnapshotSha256}</code></dd></div>
        <div><dt>{t('takeAcceptanceProjectionSha')}</dt><dd><code>{ready.method.projectionSha256}</code></dd></div>
        <div><dt>{t('takeAcceptanceMethodProof')}</dt><dd>{t('takeAcceptanceMethodProofMatched')}</dd></div>
      </dl></details>
    </>}
  </section>
}

function AcceptanceCard({
  title, status, children,
}: {
  readonly title: string
  readonly status: string
  readonly children: React.ReactNode
}) {
  return <article className={css.acceptanceCard} data-status={status === 'PASS' || status === 'verified' ? 'pass' : 'blocked'}>
    <header><h5>{title}</h5><strong>{status}</strong></header>
    {children}
  </article>
}

function TakeCard({
  version, canSelect, busy, onSelect, t,
}: {
  readonly version: YimengTakeVersion
  readonly canSelect: boolean
  readonly busy: boolean
  readonly onSelect: (version: YimengTakeVersion) => Promise<void>
  readonly t: (key: QingmuCockpitKey) => string
}) {
  const selectionAllowed = canSelect && version.canAttemptSelection && version.lineageComplete && !busy
  return <article className={css.take} data-selected={version.isSelected ? 'true' : 'false'}>
    <header><div><strong>v{version.versionOrdinal}</strong><span>{version.source}</span></div>
      {version.isSelected && <mark>{t('takeVersionSelectedBadge')}</mark>}</header>
    <dl>
      <div><dt>{t('takeVersionTakeId')}</dt><dd><code>{version.takeId}</code></dd></div>
      <div><dt>{t('takeVersionDuration')}</dt><dd>{version.durationSec === null ? t('unknown') : `${version.durationSec}s`}</dd></div>
      <div><dt>{t('takeVersionCost')}</dt><dd>{version.estimatedCny === null ? t('unknown') : `¥${version.estimatedCny}`}</dd></div>
      <div><dt>{t('takeVersionQuality')}</dt><dd>{version.qualityStatus} · {version.qualityCheckCount}</dd></div>
      <div><dt>{t('takeVersionBinding')}</dt><dd>{version.outputBindingStatus}</dd></div>
      <div><dt>{t('takeVersionLineage')}</dt><dd>{t(version.lineageComplete ? 'takeVersionLineageComplete' : 'takeVersionLineageIncomplete')}</dd></div>
    </dl>
    {version.blockers.length > 0 && <div className={css.blockers}><strong>{t('takeVersionBlockers')}</strong>
      <ul>{version.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
    <details><summary>{t('takeVersionEvidence')}</summary><dl>
      <div><dt>{t('takeVersionProvider')}</dt><dd>{version.provider ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionModel')}</dt><dd>{version.model ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionTask')}</dt><dd><code>{version.taskId ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionProviderTask')}</dt><dd><code>{version.providerTaskId ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionRoute')}</dt><dd>{version.routeKey ?? t('unknown')}</dd></div>
      <div><dt>{t('takeVersionInputHash')}</dt><dd><code>{version.inputHash ?? t('unknown')}</code></dd></div>
      <div><dt>{t('takeVersionOutputHash')}</dt><dd><code>{version.outputSha256 ?? t('unknown')}</code></dd></div>
    </dl></details>
    {!version.isSelected && <button className={css.select} type="button" disabled={!selectionAllowed}
      onClick={() => { void onSelect(version) }}>{t('takeVersionSelectButton')}</button>}
  </article>
}
