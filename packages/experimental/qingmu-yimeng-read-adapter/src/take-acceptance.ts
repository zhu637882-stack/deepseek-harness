/** Validate one selected Take's read-only acceptance evidence. */
import type {
  YimengTakeAcceptanceEvidence,
  YimengTakeAcceptanceRequest,
  YimengTakeAcceptanceResponse,
  YimengTakeAcceptanceSubject,
  YimengTakeCandidateQuality,
  YimengTakeProviderReceipt,
  YimengTakeQualityCheck,
  YimengTakeTechnicalReceipt,
} from './types.ts'
import { parseTakeVersionReadRequest } from './take-versions.ts'

type Digest = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'takeId', 'versionOrdinal',
  'selectionStatus', 'outputSha256', 'taskId', 'capability', 'routeKey', 'provider',
  'model', 'inputHash', 'submitId',
] as const
const PROVIDER_FIELDS = [
  'schema', 'status', 'evidenceMode', 'actualProviderReceiptVerified',
  'requestDryRun', 'taskRequestHashVerified', 'outboxState', 'dispatchEpoch',
  'dispatchDigest', 'payloadSha256', 'responseSha256', 'providerTaskId',
  'providerStatus', 'localStatus', 'providerMediaBindingStatus',
  'providerMediaRecordId', 'blockers',
] as const
const TECHNICAL_FIELDS = [
  'schema', 'imagoReceiptSchema', 'status', 'media', 'fullVideoDecode',
  'blockers', 'warnings', 'video', 'audio',
] as const
const VIDEO_FIELDS = [
  'durationSeconds', 'width', 'height', 'codecName', 'nbFrames', 'avgFrameRate',
  'rFrameRate', 'videoStreamDurationSeconds', 'avgFrameRateDecimal',
  'rFrameRateDecimal', 'actualAverageFrameRate', 'actualFrameRateBasis',
  'nominalRFrameRateIsActual',
] as const
const QUALITY_FIELDS = [
  'schema', 'status', 'requiredCheckTypes', 'checks', 'missingCheckTypes',
  'failedOrStaleCheckTypes',
] as const
const BASE_CHECK_TYPES = ['creative_director_execution', 'real_vl_native_video_output'] as const
const DIALOGUE_CHECK_TYPE = 'creative_dialogue_audio'
const FULL_DECODE_COMMAND = 'ffmpeg -v error -xerror -map 0:v:0 -f null -'
const RATE_BASIS = 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE'

function exact(value: unknown, keys: readonly string[], field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`take acceptance: ${field} fields mismatch`)
  }
  return value as JsonObject
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || /[\r\n]/u.test(value) || pythonStrip(value) === '' || Array.from(value).length > maximum) {
    throw new Error(`take acceptance: ${field} is invalid`)
  }
  return value
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field)
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (result !== pythonStrip(result)) throw new Error(`take acceptance: ${field} is invalid`)
  return result
}

function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : id(value, field)
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take acceptance: ${field} is invalid`)
  }
  return value
}

function nullableSha(value: unknown, field: string): string | null {
  return value === null ? null : sha(value, field)
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take acceptance: ${field} is invalid`)
  }
  return value
}

function nullableInteger(value: unknown, field: string, minimum = 0): number | null {
  return value === null ? null : integer(value, field, minimum)
}

function nullablePositiveNumber(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`take acceptance: ${field} is invalid`)
  }
  return value
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`take acceptance: ${field} is invalid`)
  return value
}

function canonicalTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`take acceptance: ${field} is invalid`)
  const result = value.map((entry, index) => text(entry, `${field}[${String(index)}]`))
  if (result.length !== new Set(result).size || result.some((entry, index) => {
    const previous = result[index - 1]
    return previous !== undefined && entry < previous
  })) {
    throw new Error(`take acceptance: ${field} is not sorted and unique`)
  }
  return result
}

/**
 * Accept only the three canonical selected-Take coordinates from the browser.
 * @param payload - Untrusted command payload to validate.
 * @returns Validated YimengTakeAcceptanceRequest value.
 */
export function parseTakeAcceptanceReadRequest(payload: unknown): YimengTakeAcceptanceRequest {
  return parseTakeVersionReadRequest(payload)
}

function normalizeSubject(value: unknown, request: YimengTakeAcceptanceRequest): YimengTakeAcceptanceSubject {
  const item = exact(value, SUBJECT_FIELDS, 'evidence.subject')
  if (item.schema !== 'jason.qingmu-take-acceptance-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || item.selectionStatus !== 'Selected') {
    throw new Error('take acceptance: subject mismatch')
  }
  return {
    schema: 'jason.qingmu-take-acceptance-subject.v1',
    ...request,
    frameNo: integer(item.frameNo, 'subject.frameNo', 1),
    storyboardRevision: integer(item.storyboardRevision, 'subject.storyboardRevision'),
    frameContentSha256: sha(item.frameContentSha256, 'subject.frameContentSha256'),
    selectionRevision: integer(item.selectionRevision, 'subject.selectionRevision'),
    takeId: id(item.takeId, 'subject.takeId'),
    versionOrdinal: integer(item.versionOrdinal, 'subject.versionOrdinal', 1),
    selectionStatus: 'Selected',
    outputSha256: nullableSha(item.outputSha256, 'subject.outputSha256'),
    taskId: nullableId(item.taskId, 'subject.taskId'),
    capability: nullableText(item.capability, 'subject.capability'),
    routeKey: nullableText(item.routeKey, 'subject.routeKey'),
    provider: nullableText(item.provider, 'subject.provider'),
    model: nullableText(item.model, 'subject.model'),
    inputHash: nullableSha(item.inputHash, 'subject.inputHash'),
    submitId: nullableId(item.submitId, 'subject.submitId'),
  }
}

function normalizeProvider(value: unknown, subject: YimengTakeAcceptanceSubject): YimengTakeProviderReceipt {
  const item = exact(value, PROVIDER_FIELDS, 'evidence.providerReceipt')
  if (item.schema !== 'jason.qingmu-provider-submission-receipt-evidence.v1') {
    throw new Error('take acceptance: provider schema mismatch')
  }
  const status = item.status
  const evidenceMode = item.evidenceMode
  if (status !== 'verified' && status !== 'bounded_local' && status !== 'missing' && status !== 'invalid') {
    throw new Error('take acceptance: provider status is invalid')
  }
  if (evidenceMode !== 'provider_receipt' && evidenceMode !== 'bounded_local' && evidenceMode !== 'unverified') {
    throw new Error('take acceptance: provider evidence mode is invalid')
  }
  const requestDryRun = item.requestDryRun === null ? null : boolean(item.requestDryRun, 'provider.requestDryRun')
  const binding = item.providerMediaBindingStatus
  if (binding !== 'PASS' && binding !== 'BLOCKED') {
    throw new Error('take acceptance: provider media binding is invalid')
  }
  const receipt: YimengTakeProviderReceipt = {
    schema: 'jason.qingmu-provider-submission-receipt-evidence.v1',
    status,
    evidenceMode,
    actualProviderReceiptVerified: boolean(item.actualProviderReceiptVerified, 'provider.actualProviderReceiptVerified'),
    requestDryRun,
    taskRequestHashVerified: boolean(item.taskRequestHashVerified, 'provider.taskRequestHashVerified'),
    outboxState: nullableText(item.outboxState, 'provider.outboxState'),
    dispatchEpoch: integer(item.dispatchEpoch, 'provider.dispatchEpoch'),
    dispatchDigest: nullableSha(item.dispatchDigest, 'provider.dispatchDigest'),
    payloadSha256: nullableSha(item.payloadSha256, 'provider.payloadSha256'),
    responseSha256: nullableSha(item.responseSha256, 'provider.responseSha256'),
    providerTaskId: nullableId(item.providerTaskId, 'provider.providerTaskId'),
    providerStatus: nullableText(item.providerStatus, 'provider.providerStatus'),
    localStatus: nullableText(item.localStatus, 'provider.localStatus'),
    providerMediaBindingStatus: binding,
    providerMediaRecordId: nullableId(item.providerMediaRecordId, 'provider.providerMediaRecordId'),
    blockers: canonicalTextList(item.blockers, 'provider.blockers'),
  }
  if (receipt.payloadSha256 !== subject.inputHash || receipt.providerTaskId !== subject.submitId) {
    throw new Error('take acceptance: provider receipt does not match selected Take')
  }
  const verified = receipt.evidenceMode === 'provider_receipt'
    && receipt.actualProviderReceiptVerified && receipt.requestDryRun === false
    && receipt.taskRequestHashVerified && (receipt.outboxState === 'acknowledged' || receipt.outboxState === 'settled')
    && receipt.dispatchEpoch > 0 && receipt.dispatchDigest !== null && receipt.payloadSha256 !== null
    && receipt.responseSha256 !== null && receipt.providerTaskId !== null
    && receipt.providerMediaBindingStatus === 'PASS' && receipt.providerMediaRecordId !== null
    && receipt.blockers.length === 0
  const bounded = receipt.evidenceMode === 'bounded_local' && !receipt.actualProviderReceiptVerified
    && receipt.requestDryRun === true && receipt.blockers.length === 1
    && receipt.blockers[0] === 'PROVIDER_RECEIPT_DRY_RUN_ONLY'
  if ((receipt.status === 'verified') !== verified || (receipt.status === 'bounded_local') !== bounded
    || ((receipt.status === 'missing' || receipt.status === 'invalid')
      && (receipt.evidenceMode !== 'unverified' || receipt.actualProviderReceiptVerified || receipt.blockers.length === 0))) {
    throw new Error('take acceptance: provider derived state is inconsistent')
  }
  return receipt
}

function normalizeVideo(value: unknown, status: 'PASS' | 'BLOCKED'): NonNullable<YimengTakeTechnicalReceipt['video']> | null {
  if (value === null) {
    if (status === 'PASS') throw new Error('take acceptance: passing receipt has no video')
    return null
  }
  const item = exact(value, VIDEO_FIELDS, 'technical.video')
  if (item.actualFrameRateBasis !== RATE_BASIS || item.nominalRFrameRateIsActual !== false) {
    throw new Error('take acceptance: frame-rate semantics changed')
  }
  const video: NonNullable<YimengTakeTechnicalReceipt['video']> = {
    durationSeconds: nullablePositiveNumber(item.durationSeconds, 'video.durationSeconds'),
    width: nullableInteger(item.width, 'video.width', 1),
    height: nullableInteger(item.height, 'video.height', 1),
    codecName: nullableText(item.codecName, 'video.codecName'),
    nbFrames: nullableInteger(item.nbFrames, 'video.nbFrames', 1),
    avgFrameRate: nullableText(item.avgFrameRate, 'video.avgFrameRate'),
    rFrameRate: nullableText(item.rFrameRate, 'video.rFrameRate'),
    videoStreamDurationSeconds: nullablePositiveNumber(item.videoStreamDurationSeconds, 'video.videoStreamDurationSeconds'),
    avgFrameRateDecimal: nullablePositiveNumber(item.avgFrameRateDecimal, 'video.avgFrameRateDecimal'),
    rFrameRateDecimal: nullablePositiveNumber(item.rFrameRateDecimal, 'video.rFrameRateDecimal'),
    actualAverageFrameRate: nullablePositiveNumber(item.actualAverageFrameRate, 'video.actualAverageFrameRate'),
    actualFrameRateBasis: RATE_BASIS,
    nominalRFrameRateIsActual: false,
  }
  if (status === 'PASS' && [
    video.durationSeconds, video.width, video.height, video.codecName, video.nbFrames,
    video.avgFrameRate, video.rFrameRate, video.videoStreamDurationSeconds,
    video.actualAverageFrameRate,
  ].some(entry => entry === null)) {
    throw new Error('take acceptance: passing receipt is missing a required video field')
  }
  if (video.nbFrames !== null && video.videoStreamDurationSeconds !== null) {
    const derived = video.nbFrames / video.videoStreamDurationSeconds
    if (video.actualAverageFrameRate === null
      || Math.abs(video.actualAverageFrameRate - derived) > Math.max(1e-9, Math.abs(derived) * 1e-9)) {
      throw new Error('take acceptance: actual frame rate is not frame-count based')
    }
  }
  return video
}

function normalizeTechnical(value: unknown, subject: YimengTakeAcceptanceSubject): YimengTakeTechnicalReceipt {
  const item = exact(value, TECHNICAL_FIELDS, 'evidence.technicalReceipt')
  if (item.schema !== 'jason.qingmu-technical-video-receipt.v1'
    || item.imagoReceiptSchema !== 'IMAGO-V6-TechnicalVideoReceipt-v1'
    || (item.status !== 'PASS' && item.status !== 'BLOCKED')) {
    throw new Error('take acceptance: technical receipt schema or status is invalid')
  }
  const mediaValue = exact(item.media, ['bytes', 'sha256'], 'technical.media')
  const decodeValue = exact(item.fullVideoDecode, ['required', 'commandProfile', 'status', 'returncode'], 'technical.fullVideoDecode')
  if (decodeValue.required !== true || decodeValue.commandProfile !== FULL_DECODE_COMMAND
    || (decodeValue.status !== 'PASS' && decodeValue.status !== 'BLOCKED' && decodeValue.status !== 'TIMEOUT')) {
    throw new Error('take acceptance: full-video decode fields are invalid')
  }
  const media = {
    bytes: nullableInteger(mediaValue.bytes, 'technical.media.bytes', 1),
    sha256: nullableSha(mediaValue.sha256, 'technical.media.sha256'),
  }
  const fullVideoDecode: YimengTakeTechnicalReceipt['fullVideoDecode'] = {
    required: true,
    commandProfile: FULL_DECODE_COMMAND,
    status: decodeValue.status,
    returncode: nullableInteger(decodeValue.returncode, 'technical.fullVideoDecode.returncode'),
  }
  const blockers = canonicalTextList(item.blockers, 'technical.blockers')
  const warnings = canonicalTextList(item.warnings, 'technical.warnings')
  const video = normalizeVideo(item.video, item.status)
  let audio: YimengTakeTechnicalReceipt['audio'] = null
  if (item.audio !== null) {
    const audioValue = exact(item.audio, ['codecName', 'channels', 'sampleRate'], 'technical.audio')
    audio = {
      codecName: text(audioValue.codecName, 'technical.audio.codecName'),
      channels: integer(audioValue.channels, 'technical.audio.channels', 1),
      sampleRate: integer(audioValue.sampleRate, 'technical.audio.sampleRate', 1),
    }
  }
  const passing = blockers.length === 0 && media.bytes !== null && media.sha256 !== null
    && fullVideoDecode.status === 'PASS' && fullVideoDecode.returncode === 0 && video !== null
  if ((item.status === 'PASS') !== passing || (media.sha256 !== null && media.sha256 !== subject.outputSha256)) {
    throw new Error('take acceptance: technical receipt derived state is inconsistent')
  }
  return {
    schema: 'jason.qingmu-technical-video-receipt.v1',
    imagoReceiptSchema: 'IMAGO-V6-TechnicalVideoReceipt-v1',
    status: item.status,
    media,
    fullVideoDecode,
    blockers,
    warnings,
    video,
    audio,
  }
}

function normalizeQuality(value: unknown): YimengTakeCandidateQuality {
  const item = exact(value, QUALITY_FIELDS, 'evidence.candidateQuality')
  if (item.schema !== 'jason.qingmu-take-candidate-quality-evidence.v1'
    || (item.status !== 'PASS' && item.status !== 'BLOCKED')) {
    throw new Error('take acceptance: candidate quality schema or status is invalid')
  }
  const requiredCheckTypes = canonicalTextList(item.requiredCheckTypes, 'quality.requiredCheckTypes')
  const base = [...BASE_CHECK_TYPES]
  const dialogue = [...BASE_CHECK_TYPES, DIALOGUE_CHECK_TYPE].sort()
  if (JSON.stringify(requiredCheckTypes) !== JSON.stringify(base)
    && JSON.stringify(requiredCheckTypes) !== JSON.stringify(dialogue)) {
    throw new Error('take acceptance: required QC set is invalid')
  }
  if (!Array.isArray(item.checks)) throw new Error('take acceptance: quality.checks is invalid')
  const seen = new Set<string>()
  const checks: YimengTakeQualityCheck[] = item.checks.map((value, index) => {
    const check = exact(value, ['checkId', 'checkType', 'passed', 'createdAt', 'current'], `quality.checks[${String(index)}]`)
    const checkType = text(check.checkType, `quality.checks[${String(index)}].checkType`)
    if (!requiredCheckTypes.includes(checkType) || seen.has(checkType)) {
      throw new Error('take acceptance: quality checks are duplicated or out of scope')
    }
    seen.add(checkType)
    return {
      checkId: id(check.checkId, `quality.checks[${String(index)}].checkId`),
      checkType,
      passed: boolean(check.passed, `quality.checks[${String(index)}].passed`),
      createdAt: text(check.createdAt, `quality.checks[${String(index)}].createdAt`),
      current: boolean(check.current, `quality.checks[${String(index)}].current`),
    }
  })
  const missing = requiredCheckTypes.filter(checkType => !seen.has(checkType)).sort()
  const failed = checks.filter(check => !check.passed || !check.current).map(check => check.checkType).sort()
  const suppliedMissing = canonicalTextList(item.missingCheckTypes, 'quality.missingCheckTypes')
  const suppliedFailed = canonicalTextList(item.failedOrStaleCheckTypes, 'quality.failedOrStaleCheckTypes')
  if (JSON.stringify(suppliedMissing) !== JSON.stringify(missing)
    || JSON.stringify(suppliedFailed) !== JSON.stringify(failed)
    || (item.status === 'PASS') !== (missing.length === 0 && failed.length === 0)) {
    throw new Error('take acceptance: candidate quality derived state is inconsistent')
  }
  return {
    schema: 'jason.qingmu-take-candidate-quality-evidence.v1',
    status: item.status,
    requiredCheckTypes,
    checks,
    missingCheckTypes: missing,
    failedOrStaleCheckTypes: failed,
  }
}

/**
 * Validate evidence identity, JCS hash, strict decode, QC freshness, and authority separation.
 * @param value - Untrusted value to validate and normalize.
 * @param request - Request coordinates and payload to process.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengTakeAcceptanceResponse value.
 */
export function normalizeTakeAcceptance(
  value: unknown,
  request: YimengTakeAcceptanceRequest,
  digest: Digest,
): YimengTakeAcceptanceResponse {
  const root = exact(value, ['schema', 'evidence', 'evidenceSnapshotSha256', 'productionStatus', 'boundaries'], 'feed')
  if (root.schema !== 'jason.qingmu-take-acceptance-evidence.v1'
    || root.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION') {
    throw new Error('take acceptance: feed schema or production status is invalid')
  }
  const evidenceValue = exact(root.evidence, ['subject', 'providerReceipt', 'technicalReceipt', 'candidateQuality'], 'evidence')
  const subject = normalizeSubject(evidenceValue.subject, request)
  const evidence: YimengTakeAcceptanceEvidence = {
    subject,
    providerReceipt: normalizeProvider(evidenceValue.providerReceipt, subject),
    technicalReceipt: normalizeTechnical(evidenceValue.technicalReceipt, subject),
    candidateQuality: normalizeQuality(evidenceValue.candidateQuality),
  }
  const evidenceSnapshotSha256 = sha(root.evidenceSnapshotSha256, 'evidenceSnapshotSha256')
  const boundaries = exact(root.boundaries, [
    'readOnly', 'selectedIsApproval', 'formalApprovalChanged', 'providerCalls',
    'databaseWrites', 'budgetMutation', 'humanSignoffInferred',
    'paidProviderAuthority', 'gateBCompleted',
  ], 'boundaries')
  if (evidenceSnapshotSha256 !== digest(evidence, 'takeAcceptance.evidence')
    || boundaries.readOnly !== true || boundaries.selectedIsApproval !== false
    || boundaries.formalApprovalChanged !== false || boundaries.providerCalls !== 0
    || boundaries.databaseWrites !== 0 || boundaries.budgetMutation !== false
    || boundaries.humanSignoffInferred !== false || boundaries.paidProviderAuthority !== 'not_granted'
    || boundaries.gateBCompleted !== false) {
    throw new Error('take acceptance: hash or authority boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-take-acceptance-evidence.v1',
    evidence,
    evidenceSnapshotSha256,
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    boundaries: {
      readOnly: true,
      selectedIsApproval: false,
      formalApprovalChanged: false,
      providerCalls: 0,
      databaseWrites: 0,
      budgetMutation: false,
      humanSignoffInferred: false,
      paidProviderAuthority: 'not_granted',
      gateBCompleted: false,
    },
  }
}
