/** Current IMAGO Take-acceptance method compiled from fresh Yimeng evidence. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengTakeAcceptanceEvidence,
  YimengTakeAcceptanceSubject,
  YimengTakeCandidateQuality,
  YimengTakeProviderReceipt,
  YimengTakeTechnicalReceipt,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type {
  ImagoTakeAcceptanceMethodDefinition,
  ImagoTakeAcceptanceMethodEvaluation,
  ImagoTakeAcceptanceMethodProjection,
  ImagoTakeAcceptanceMethodRequest,
  ImagoTakeAcceptanceMethodResponse,
  ImagoTakeAcceptanceMethodSnapshot,
} from './types.ts'

/** Fixed current sources; neither the browser nor compiler may nominate a path. */
export const TAKE_ACCEPTANCE_RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-video-generation-routing-policy.json',
  'pipeline/v6-video-reference-integrity-overlay-policy.json',
  'scripts/probe_v6_video_receipt.py',
  'docs/qingmu-os/report-source.md',
  'scripts/compile_qingmu_take_acceptance_method.py',
] as const

const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision', 'frameContentSha256',
  'selectionRevision', 'takeId', 'versionOrdinal', 'selectionStatus', 'outputSha256', 'taskId', 'capability',
  'routeKey', 'provider', 'model', 'inputHash', 'submitId',
] as const
const PROVIDER_FIELDS = [
  'schema', 'status', 'evidenceMode', 'actualProviderReceiptVerified', 'requestDryRun', 'taskRequestHashVerified',
  'outboxState', 'dispatchEpoch', 'dispatchDigest', 'payloadSha256', 'responseSha256', 'providerTaskId',
  'providerStatus', 'localStatus', 'providerMediaBindingStatus', 'providerMediaRecordId', 'blockers',
] as const
const TECHNICAL_FIELDS = [
  'schema', 'imagoReceiptSchema', 'status', 'media', 'fullVideoDecode', 'blockers', 'warnings', 'video', 'audio',
] as const
const VIDEO_FIELDS = [
  'durationSeconds', 'width', 'height', 'codecName', 'nbFrames', 'avgFrameRate', 'rFrameRate',
  'videoStreamDurationSeconds', 'avgFrameRateDecimal', 'rFrameRateDecimal', 'actualAverageFrameRate',
  'actualFrameRateBasis', 'nominalRFrameRateIsActual',
] as const
const QUALITY_FIELDS = [
  'schema', 'status', 'requiredCheckTypes', 'checks', 'missingCheckTypes', 'failedOrStaleCheckTypes',
] as const
const RATE_BASIS = 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE'
const DECODE_COMMAND = 'ffmpeg -v error -xerror -map 0:v:0 -f null -'
const TECHNICAL_VIDEO_FIELDS = [
  'duration_seconds', 'width', 'height', 'codec_name', 'nb_frames', 'avg_frame_rate', 'r_frame_rate',
  'actual_average_frame_rate',
] as const
const MACRO_DIMENSIONS = ['STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE'] as const
const MICRO_DIMENSIONS = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER', 'LOCKED_DIALOGUE',
  'TECHNICAL_RECEIPT',
] as const
type CanonicalSerialize = (value: unknown, field: string) => string

/** Browser payload exceeds the identity-only request. */
export class TakeAcceptanceInputError extends Error {}
/** Evidence, current rules, or compiler output failed closed. */
export class TakeAcceptanceContractError extends Error {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TakeAcceptanceContractError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  const result = object(value, field)
  if (!isDeepStrictEqual(Object.keys(result).sort(), [...fields].sort())) {
    throw new TakeAcceptanceContractError(`${field} contains unexpected fields`)
  }
  return result
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value === pythonStrip(value) && value !== ''
    && Array.from(value).length <= 256 && !/[\u0000\r\n]/.test(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && pythonStrip(value) !== ''
    && value.length <= 1024 && !/[\u0000\r\n]/.test(value)
}

function optionalText(value: unknown): value is string | null {
  return value === null || text(value)
}

function optionalIdentifier(value: unknown): value is string | null {
  return value === null || identifier(value)
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function optionalSha(value: unknown): value is string | null {
  return value === null || sha(value)
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function optionalFinite(value: unknown, positive = false): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0))
}

function sortedTextList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every(text)) throw new TakeAcceptanceContractError(`${field} must be a text array`)
  const expected = [...new Set(value)].sort()
  if (!isDeepStrictEqual(value, expected)) throw new TakeAcceptanceContractError(`${field} must be sorted and unique`)
  return value
}

function sha256(value: unknown, serialize: CanonicalSerialize, field: string): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

/**
 * Render RFC 8785 JSON used by Yimeng evidence and the method attestation.
 * @param value - untrusted JSON-compatible input.
 * @param field - diagnostic coordinate for fail-closed errors.
 * @param depth - internal recursion depth, starting at zero.
 * @returns whitespace-free RFC 8785 JSON text.
 */
export function takeAcceptanceJcsJson(value: unknown, field: string, depth = 0): string {
  if (depth > 100) throw new TakeAcceptanceContractError(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new TakeAcceptanceContractError(`${field} contains invalid Unicode`)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    const rendered = JSON.stringify(value)
    if (!Number.isFinite(value)
      || (Number.isInteger(value) && !Number.isSafeInteger(value) && !/[eE]/.test(rendered))) {
      throw new TakeAcceptanceContractError(`${field} contains an unsupported JCS number`)
    }
    return rendered
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => takeAcceptanceJcsJson(item, `${field}[${String(index)}]`, depth + 1)).join(',')}]`
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    const keys = Object.keys(item)
    if (!keys.every(key => key.isWellFormed())) throw new TakeAcceptanceContractError(`${field} contains an invalid key`)
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${takeAcceptanceJcsJson(item[key], `${field}.${key}`, depth + 1)}`).join(',')}}`
  }
  throw new TakeAcceptanceContractError(`${field} must be JCS JSON`)
}

/**
 * Accept only canonical coordinates, never evidence or method data from the browser.
 * @param payload - untrusted browser RPC payload.
 * @returns three validated Yimeng identifiers.
 */
export function parseTakeAcceptanceMethodRequest(payload: unknown): ImagoTakeAcceptanceMethodRequest {
  try {
    const value = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
    if (!identifier(value.projectId) || !identifier(value.episodeId) || !identifier(value.frameId)) {
      throw new TakeAcceptanceInputError()
    }
    return { projectId: value.projectId, episodeId: value.episodeId, frameId: value.frameId }
  } catch {
    throw new TakeAcceptanceInputError('takeAcceptanceMethod accepts only projectId, episodeId, and frameId')
  }
}

function validateSubject(value: unknown, request: ImagoTakeAcceptanceMethodRequest): YimengTakeAcceptanceSubject {
  const subject = exact(value, SUBJECT_FIELDS, 'evidence.subject')
  if (subject.schema !== 'jason.qingmu-take-acceptance-subject.v1' || subject.selectionStatus !== 'Selected'
    || subject.projectId !== request.projectId || subject.episodeId !== request.episodeId || subject.frameId !== request.frameId
    || !identifier(subject.projectId) || !identifier(subject.episodeId) || !identifier(subject.frameId)
    || !identifier(subject.takeId) || !integer(subject.frameNo, 1) || !integer(subject.storyboardRevision)
    || !integer(subject.selectionRevision) || !integer(subject.versionOrdinal, 1) || !sha(subject.frameContentSha256)
    || !optionalSha(subject.outputSha256) || !optionalSha(subject.inputHash) || !optionalIdentifier(subject.taskId)
    || !optionalIdentifier(subject.submitId) || !optionalText(subject.capability) || !optionalText(subject.routeKey)
    || !optionalText(subject.provider) || !optionalText(subject.model)) {
    throw new TakeAcceptanceContractError('selected Take subject is invalid')
  }
  return subject as unknown as YimengTakeAcceptanceSubject
}

function validateProvider(value: unknown, subject: YimengTakeAcceptanceSubject): YimengTakeProviderReceipt {
  const receipt = exact(value, PROVIDER_FIELDS, 'evidence.providerReceipt')
  if (receipt.schema !== 'jason.qingmu-provider-submission-receipt-evidence.v1'
    || !['verified', 'bounded_local', 'missing', 'invalid'].includes(receipt.status as string)
    || !['provider_receipt', 'bounded_local', 'unverified'].includes(receipt.evidenceMode as string)
    || typeof receipt.actualProviderReceiptVerified !== 'boolean'
    || (receipt.requestDryRun !== null && typeof receipt.requestDryRun !== 'boolean')
    || typeof receipt.taskRequestHashVerified !== 'boolean' || !integer(receipt.dispatchEpoch)
    || !optionalSha(receipt.dispatchDigest) || !optionalSha(receipt.payloadSha256) || !optionalSha(receipt.responseSha256)
    || !optionalIdentifier(receipt.providerTaskId) || !optionalIdentifier(receipt.providerMediaRecordId)
    || !optionalText(receipt.outboxState) || !optionalText(receipt.providerStatus) || !optionalText(receipt.localStatus)
    || !['PASS', 'BLOCKED'].includes(receipt.providerMediaBindingStatus as string)
    || receipt.payloadSha256 !== subject.inputHash || receipt.providerTaskId !== subject.submitId) {
    throw new TakeAcceptanceContractError('Provider receipt evidence is invalid')
  }
  const blockers = sortedTextList(receipt.blockers, 'providerReceipt.blockers')
  const verified = receipt.status === 'verified'
  const verifiedContract = receipt.evidenceMode === 'provider_receipt'
    && receipt.actualProviderReceiptVerified && !receipt.requestDryRun
    && receipt.taskRequestHashVerified && ['acknowledged', 'settled'].includes(receipt.outboxState as string)
    && receipt.dispatchEpoch > 0 && receipt.dispatchDigest !== null && receipt.payloadSha256 !== null
    && receipt.responseSha256 !== null && receipt.providerTaskId !== null && receipt.providerMediaBindingStatus === 'PASS'
    && receipt.providerMediaRecordId !== null && blockers.length === 0
  const bounded = receipt.status === 'bounded_local'
  const boundedContract = receipt.evidenceMode === 'bounded_local' && !receipt.actualProviderReceiptVerified
    && receipt.requestDryRun && isDeepStrictEqual(blockers, ['PROVIDER_RECEIPT_DRY_RUN_ONLY'])
  if (verified !== verifiedContract || bounded !== boundedContract
    || (['missing', 'invalid'].includes(receipt.status as string)
      && (receipt.evidenceMode !== 'unverified' || receipt.actualProviderReceiptVerified || blockers.length === 0))) {
    throw new TakeAcceptanceContractError('Provider receipt state is inconsistent')
  }
  return receipt as unknown as YimengTakeProviderReceipt
}

function validateTechnical(value: unknown, subject: YimengTakeAcceptanceSubject): YimengTakeTechnicalReceipt {
  const receipt = exact(value, TECHNICAL_FIELDS, 'evidence.technicalReceipt')
  const media = exact(receipt.media, ['bytes', 'sha256'], 'technicalReceipt.media')
  const decode = exact(receipt.fullVideoDecode, ['required', 'commandProfile', 'status', 'returncode'], 'technicalReceipt.fullVideoDecode')
  if (receipt.schema !== 'jason.qingmu-technical-video-receipt.v1'
    || receipt.imagoReceiptSchema !== 'IMAGO-V6-TechnicalVideoReceipt-v1' || !['PASS', 'BLOCKED'].includes(receipt.status as string)
    || (media.bytes !== null && !integer(media.bytes, 1)) || !optionalSha(media.sha256)
    || (media.sha256 !== null && media.sha256 !== subject.outputSha256) || decode.required !== true
    || decode.commandProfile !== DECODE_COMMAND || !['PASS', 'BLOCKED', 'TIMEOUT'].includes(decode.status as string)
    || (decode.returncode !== null && (!integer(decode.returncode, 0) && !(typeof decode.returncode === 'number' && Number.isSafeInteger(decode.returncode))))) {
    throw new TakeAcceptanceContractError('technical receipt is invalid')
  }
  const blockers = sortedTextList(receipt.blockers, 'technicalReceipt.blockers')
  sortedTextList(receipt.warnings, 'technicalReceipt.warnings')
  if (receipt.video !== null) {
    const video = exact(receipt.video, VIDEO_FIELDS, 'technicalReceipt.video')
    if (!optionalFinite(video.durationSeconds, true) || !optionalFinite(video.videoStreamDurationSeconds, true)
      || !optionalFinite(video.avgFrameRateDecimal, true) || !optionalFinite(video.rFrameRateDecimal, true)
      || !optionalFinite(video.actualAverageFrameRate, true)
      || (video.width !== null && !integer(video.width, 1)) || (video.height !== null && !integer(video.height, 1))
      || (video.nbFrames !== null && !integer(video.nbFrames, 1)) || !optionalText(video.codecName)
      || !optionalText(video.avgFrameRate) || !optionalText(video.rFrameRate)
      || video.actualFrameRateBasis !== RATE_BASIS || video.nominalRFrameRateIsActual !== false) {
      throw new TakeAcceptanceContractError('technical video receipt is invalid')
    }
    if (video.nbFrames !== null && video.videoStreamDurationSeconds !== null) {
      const derived = video.nbFrames / video.videoStreamDurationSeconds
      if (video.actualAverageFrameRate === null
        || Math.abs(video.actualAverageFrameRate - derived) > Math.max(1e-9, Math.abs(derived) * 1e-9)) {
        throw new TakeAcceptanceContractError('actual average frame rate is not frame-count based')
      }
    }
  }
  if (receipt.audio !== null) {
    const audio = exact(receipt.audio, ['codecName', 'channels', 'sampleRate'], 'technicalReceipt.audio')
    if (!text(audio.codecName) || !integer(audio.channels, 1) || !integer(audio.sampleRate, 1)) {
      throw new TakeAcceptanceContractError('technical audio receipt is invalid')
    }
  }
  const video = receipt.video === null ? null : object(receipt.video, 'technicalReceipt.video')
  if (receipt.status === 'PASS' && (video === null || [
    'durationSeconds', 'width', 'height', 'codecName', 'nbFrames', 'avgFrameRate', 'rFrameRate',
    'videoStreamDurationSeconds', 'actualAverageFrameRate',
  ].some(field => video[field] === null))) {
    throw new TakeAcceptanceContractError('passing technical receipt is missing a required video field')
  }
  const passing = blockers.length === 0 && media.bytes !== null && media.sha256 !== null
    && decode.status === 'PASS' && decode.returncode === 0 && receipt.video !== null
  if ((receipt.status === 'PASS') !== passing) throw new TakeAcceptanceContractError('technical receipt state is inconsistent')
  return receipt as unknown as YimengTakeTechnicalReceipt
}

function validateQuality(value: unknown): YimengTakeCandidateQuality {
  const quality = exact(value, QUALITY_FIELDS, 'evidence.candidateQuality')
  if (quality.schema !== 'jason.qingmu-take-candidate-quality-evidence.v1'
    || !['PASS', 'BLOCKED'].includes(quality.status as string) || !Array.isArray(quality.checks)) {
    throw new TakeAcceptanceContractError('candidate quality evidence is invalid')
  }
  const required = sortedTextList(quality.requiredCheckTypes, 'candidateQuality.requiredCheckTypes')
  sortedTextList(quality.missingCheckTypes, 'candidateQuality.missingCheckTypes')
  sortedTextList(quality.failedOrStaleCheckTypes, 'candidateQuality.failedOrStaleCheckTypes')
  const allowed = [
    ['creative_director_execution', 'real_vl_native_video_output'],
    ['creative_dialogue_audio', 'creative_director_execution', 'real_vl_native_video_output'],
  ]
  if (!allowed.some(item => isDeepStrictEqual(item, required))) {
    throw new TakeAcceptanceContractError('candidate quality check set is invalid')
  }
  const seen = new Set<string>()
  const checks = new Map<string, { passed: boolean; current: boolean }>()
  for (const [index, value] of quality.checks.entries()) {
    const check = exact(value, ['checkId', 'checkType', 'passed', 'createdAt', 'current'], `candidateQuality.checks[${String(index)}]`)
    if (!identifier(check.checkId) || !text(check.checkType) || !required.includes(check.checkType)
      || seen.has(check.checkType) || typeof check.passed !== 'boolean' || !text(check.createdAt)
      || typeof check.current !== 'boolean') {
      throw new TakeAcceptanceContractError('candidate quality check is invalid')
    }
    seen.add(check.checkType)
    checks.set(check.checkType, { passed: check.passed, current: check.current })
  }
  const missing = required.filter(checkType => !checks.has(checkType)).sort()
  const failed = required.filter((checkType) => {
    const check = checks.get(checkType)
    return check !== undefined && (!check.passed || !check.current)
  }).sort()
  if (!isDeepStrictEqual(quality.missingCheckTypes, missing)
    || !isDeepStrictEqual(quality.failedOrStaleCheckTypes, failed)
    || (quality.status === 'PASS') !== (missing.length === 0 && failed.length === 0)) {
    throw new TakeAcceptanceContractError('candidate quality derived state is inconsistent')
  }
  return quality as unknown as YimengTakeCandidateQuality
}

/**
 * Build the exact compiler snapshot from one fresh normalized Yimeng read.
 * @param request - identity-only canonical coordinates.
 * @param source - freshly normalized Yimeng acceptance response.
 * @param serialize - RFC 8785 serializer used to verify the evidence digest.
 * @returns an exact evidence-only compiler snapshot.
 */
export function buildTakeAcceptanceSnapshot(
  request: ImagoTakeAcceptanceMethodRequest,
  source: unknown,
  serialize: CanonicalSerialize = takeAcceptanceJcsJson,
): ImagoTakeAcceptanceMethodSnapshot {
  const root = exact(source, ['schema', 'evidence', 'evidenceSnapshotSha256', 'productionStatus', 'boundaries'], 'feed')
  const evidenceValue = exact(root.evidence, ['subject', 'providerReceipt', 'technicalReceipt', 'candidateQuality'], 'evidence')
  const subject = validateSubject(evidenceValue.subject, request)
  const evidence: YimengTakeAcceptanceEvidence = {
    subject,
    providerReceipt: validateProvider(evidenceValue.providerReceipt, subject),
    technicalReceipt: validateTechnical(evidenceValue.technicalReceipt, subject),
    candidateQuality: validateQuality(evidenceValue.candidateQuality),
  }
  const boundaries = exact(root.boundaries, [
    'readOnly', 'selectedIsApproval', 'formalApprovalChanged', 'providerCalls', 'databaseWrites', 'budgetMutation',
    'humanSignoffInferred', 'paidProviderAuthority', 'gateBCompleted',
  ], 'feed.boundaries')
  if (root.schema !== 'jason.qingmu-take-acceptance-evidence.v1'
    || root.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION' || !sha(root.evidenceSnapshotSha256)
    || root.evidenceSnapshotSha256 !== sha256(evidence, serialize, 'takeAcceptance.evidence')
    || boundaries.readOnly !== true || boundaries.selectedIsApproval !== false || boundaries.formalApprovalChanged !== false
    || boundaries.providerCalls !== 0 || boundaries.databaseWrites !== 0 || boundaries.budgetMutation !== false
    || boundaries.humanSignoffInferred !== false || boundaries.paidProviderAuthority !== 'not_granted'
    || boundaries.gateBCompleted !== false) {
    throw new TakeAcceptanceContractError('Take acceptance evidence hash or authority boundary is invalid')
  }
  return {
    schema: 'qingmu.take-acceptance-method-snapshot.v1', evidence,
    evidenceSnapshotSha256: root.evidenceSnapshotSha256,
  }
}

/** Independently reconstructed current source hashes and method definition. */
export interface TakeAcceptanceRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoTakeAcceptanceMethodDefinition
  readonly rulesSha256: string
}

function definition(): ImagoTakeAcceptanceMethodDefinition {
  return {
    mode: 'READ_ONLY_STATELESS_PROJECTION',
    technicalReceipt: {
      requiredVideoFields: TECHNICAL_VIDEO_FIELDS,
      fullVideoDecodeRequired: true,
      fullVideoDecodeCommandProfile: DECODE_COMMAND,
      actualFrameRateBasis: RATE_BASIS,
      nominalRFrameRateIsActual: false,
    },
    qualityLayers: {
      macro: { required: true, dimensions: MACRO_DIMENSIONS, yimengCheckTypes: ['creative_director_execution'] },
      micro: {
        required: true, dimensions: MICRO_DIMENSIONS, yimengBaseCheckTypes: ['real_vl_native_video_output'],
        conditionalDialogueCheckType: 'creative_dialogue_audio', technicalReceiptRequired: true,
      },
    },
    boundaries: {
      businessTruth: 'yimeng', selectedIsApproval: false, formalAcceptanceAllowed: false, providerCalls: 0,
      projectMutation: false, humanSignoffInferred: false, paidProviderAuthority: 'not_granted', gateBCompleted: false,
      inactiveReferenceOverlayActivated: false,
    },
  }
}

/**
 * Read fixed current rules and reproduce the Python compiler's method contract.
 * @param coreRoot - configured local IMAGO OS Core root.
 * @param canonicalSerialize - Python-compatible serializer for the rule-binding digest.
 * @returns current raw source hashes, definition, and rule digest.
 */
export async function readTakeAcceptanceRules(
  coreRoot: string,
  canonicalSerialize: CanonicalSerialize,
): Promise<TakeAcceptanceRules> {
  const sources = new Map(await Promise.all(
    TAKE_ACCEPTANCE_RULE_PATHS.map(async path => [path, await readFile(join(coreRoot, path))] as const),
  ))
  const bytes = (path: typeof TAKE_ACCEPTANCE_RULE_PATHS[number]): Buffer => {
    const result = sources.get(path)
    if (result === undefined) throw new TakeAcceptanceContractError('current rule source is missing')
    return result
  }
  const json = (path: typeof TAKE_ACCEPTANCE_RULE_PATHS[number]): Record<string, unknown> => {
    try { return object(JSON.parse(bytes(path).toString('utf8')) as unknown, path) } catch { throw new TakeAcceptanceContractError('current rule JSON is invalid') }
  }
  const pointer = json('pipeline/imago-os-current.json')
  const resolution = object(pointer.resolution, 'current pointer resolution')
  const registry = json('pipeline/workflow-channel-registry.json')
  const channels = registry.channels
  const channel = Array.isArray(channels) && channels.length === 1 ? object(channels[0], 'active channel') : undefined
  if (pointer.schema !== 'IMAGO-CurrentRuntimePointer-v1' || pointer.status !== 'ACTIVE' || pointer.public_system_name !== 'IMAGO OS'
    || resolution.internal_runtime_channel !== 'V6_PRODUCTION_BETA' || resolution.internal_contract_id !== '6.0.0-draft.2'
    || !text(resolution.controller) || !text(resolution.workflow_spec)
    || registry.schema !== 'IMAGO-WorkflowChannelRegistry-v2'
    || registry.public_runtime_pointer !== 'pipeline/imago-os-current.json' || registry.system_scope !== 'V6_ONLY'
    || registry.default_new_project_channel !== 'V6_PRODUCTION_BETA' || registry.pre_v6_import_allowed !== false
    || registry.pre_v6_fallback_allowed !== false || registry.cross_version_lock_or_status_inheritance_allowed !== false
    || channel?.channel_id !== 'V6_PRODUCTION_BETA' || channel.workflow_family !== 'V6'
    || channel.workflow_version !== '6.0.0-draft.2' || channel.stable !== false || channel.fallback !== false
    || channel.pre_v6_project_import_allowed !== false || channel.internal_runtime_only !== true || channel.user_selectable !== false) {
    throw new TakeAcceptanceContractError('current V6-only runtime binding is invalid')
  }
  const routing = json('pipeline/v6-video-generation-routing-policy.json')
  const activation = object(routing.activation, 'routing activation')
  const principles = object(routing.principles, 'routing principles')
  const acceptance = object(routing.post_generation_acceptance, 'post-generation acceptance')
  const overlay = json('pipeline/v6-video-reference-integrity-overlay-policy.json')
  const qc = object(overlay.qc_layer_contract, 'QC layer contract')
  if (routing.schema !== 'IMAGO-V6-VideoGenerationRoutingPolicy-v1' || activation.compiler_active !== true
    || principles.macro_and_micro_qc_must_both_pass !== true || acceptance.macro_qc_required !== true
    || acceptance.micro_qc_required !== true || acceptance.unverified_is_not_pass !== true
    || !isDeepStrictEqual(acceptance.technical_video_receipt_fields, TECHNICAL_VIDEO_FIELDS)
    || acceptance.actual_rate_basis !== RATE_BASIS
    || overlay.schema !== 'IMAGO-V6-VideoReferenceOrchestrationPolicy-v1' || overlay.active !== false
    || !isDeepStrictEqual(qc.MACRO_QC, MACRO_DIMENSIONS) || !isDeepStrictEqual(qc.MICRO_QC, MICRO_DIMENSIONS)
    || qc.both_layers_required_for_final_pass !== true || qc.unverified_is_not_pass !== true) {
    throw new TakeAcceptanceContractError('current receipt or macro/micro QC policy is incompatible')
  }
  const probe = bytes('scripts/probe_v6_video_receipt.py').toString('utf8')
  const plan = bytes('docs/qingmu-os/report-source.md').toString('utf8')
  if (!['IMAGO-V6-TechnicalVideoReceipt-v1', '-count_frames', '-xerror', 'nb_frames', 'avg_frame_rate', 'r_frame_rate']
    .every(token => probe.includes(token))
    || !['E6-5：真实 receipt、严格解码和 QC。', 'Gate B（Provider 特定）', 'UNVERIFIED_FOR_PAID_PRODUCTION']
      .every(token => plan.includes(token))) {
    throw new TakeAcceptanceContractError('current E6-5 method sources are unavailable')
  }
  const hashes = Object.fromEntries([...sources].map(([path, raw]) => [path, createHash('sha256').update(raw).digest('hex')]))
  return { hashes, definition: definition(), rulesSha256: sha256(hashes, canonicalSerialize, 'takeAcceptance.rules') }
}

function layer(checkTypes: readonly string[], quality: YimengTakeCandidateQuality, technical?: YimengTakeTechnicalReceipt) {
  const checks = new Map(quality.checks.map(check => [check.checkType, check]))
  const blockers: string[] = []
  for (const checkType of checkTypes) {
    const check = checks.get(checkType)
    if (check === undefined) blockers.push(`MISSING_QC:${checkType}`)
    else if (!check.passed || !check.current) blockers.push(`FAILED_OR_STALE_QC:${checkType}`)
  }
  if (technical !== undefined && technical.status !== 'PASS') {
    blockers.push(...technical.blockers.map(item => `TECHNICAL:${item}`))
    if (technical.blockers.length === 0) blockers.push('TECHNICAL:UNVERIFIED')
  }
  const unique = [...new Set(blockers)].sort()
  return { status: unique.length === 0 ? 'PASS' as const : 'BLOCKED' as const, checkTypes, blockers: unique }
}

/**
 * Reproduce the compiler evaluation without trusting its result.
 * @param evidence - already validated current Yimeng evidence.
 * @returns the independent local, QC, and Provider evaluation.
 */
export function evaluateTakeAcceptance(evidence: YimengTakeAcceptanceEvidence): ImagoTakeAcceptanceMethodEvaluation {
  const macroQc = layer(['creative_director_execution'], evidence.candidateQuality)
  const microTypes = ['real_vl_native_video_output']
  if (evidence.candidateQuality.requiredCheckTypes.includes('creative_dialogue_audio')) microTypes.push('creative_dialogue_audio')
  microTypes.sort()
  const microQc = layer(microTypes, evidence.candidateQuality, evidence.technicalReceipt)
  const localBlockers = [...new Set([...macroQc.blockers, ...microQc.blockers])].sort()
  return {
    technicalReceiptStatus: evidence.technicalReceipt.status,
    fullVideoDecodeStatus: evidence.technicalReceipt.fullVideoDecode.status,
    macroQc,
    microQc,
    providerReceipt: {
      status: evidence.providerReceipt.status, evidenceMode: evidence.providerReceipt.evidenceMode,
      actualProviderReceiptVerified: evidence.providerReceipt.actualProviderReceiptVerified,
      blockers: evidence.providerReceipt.blockers,
    },
    localControlStatus: localBlockers.length === 0 ? 'PASS' : 'BLOCKED',
    localBlockers,
    productionVerificationStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    formalAcceptanceAllowed: false,
    selectedIsApproval: false,
    gateBCompleted: false,
  }
}

/**
 * Verify every compiler field before creating a Host-only method attestation.
 * @param raw - untrusted compiler subprocess output.
 * @param snapshot - exact Yimeng evidence snapshot sent to Core.
 * @param rules - independently reread current rule contract.
 * @param key - Host-only HMAC key, never included in the response.
 * @returns the exact projection and method-origin attestation.
 */
export function attestTakeAcceptanceMethod(
  raw: unknown,
  snapshot: ImagoTakeAcceptanceMethodSnapshot,
  rules: TakeAcceptanceRules,
  key: string,
): ImagoTakeAcceptanceMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'evidenceSnapshotSha256', 'definition', 'evaluation', 'ruleBindings', 'rulesSha256',
  ], 'compiler projection')
  if (projection.schema !== 'qingmu.imago-take-acceptance-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.evidence.subject)
    || projection.evidenceSnapshotSha256 !== snapshot.evidenceSnapshotSha256
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.evaluation, evaluateTakeAcceptance(snapshot.evidence))
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes) || projection.rulesSha256 !== rules.rulesSha256) {
    throw new TakeAcceptanceContractError('compiler evidence, method, evaluation, or rule binding mismatched')
  }
  const projectionSha256 = sha256(projection, takeAcceptanceJcsJson, 'takeAcceptance.projection')
  const unsigned = {
    schema: 'qingmu.imago-take-acceptance-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    evidenceSnapshotSha256: snapshot.evidenceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-take-acceptance-method-adapter-result.v1',
    projection: projection as unknown as ImagoTakeAcceptanceMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key).update(takeAcceptanceJcsJson(unsigned, 'takeAcceptance.attestation'), 'utf8').digest('hex'),
    },
  }
}
