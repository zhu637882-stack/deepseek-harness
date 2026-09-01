/** Strict Host normalization for the read-only editorial handoff draft. */
import { isDeepStrictEqual } from 'node:util'
import { normalizeTakeCommentFeed } from './take-comments.ts'
import { normalizeTakeReviewAuthorityFeed } from './take-review-authority.ts'
import { normalizePersistedTakeTechnicalQcAssessment } from './take-technical-qc.ts'
import { normalizePersistedTakeApprovalLifecycleTransitions } from './take-approval-lifecycle.ts'
import type {
  YimengEpisodeEvidenceLifecycleRecords,
  YimengEpisodeEvidenceQcRecords,
  YimengEditorialHandoffAudio,
  YimengEditorialHandoffMedia,
  YimengEditorialHandoffRequest,
  YimengEditorialHandoffResponse,
  YimengEditorialHandoffShot,
} from './types.ts'

type Digest = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const OUTPUT_BINDING_STATUSES = [
  'verified', 'recorded_sha_missing', 'materialized_file_missing', 'recorded_sha_mismatch',
] as const
const QUALITY_STATUSES = ['pending', 'passed', 'failed'] as const
const MEDIA_EXTENSIONS = new Map<string, string>([
  ['video/mp4', 'mp4'], ['video/quicktime', 'mov'], ['video/webm', 'webm'],
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'], ['audio/x-m4a', 'm4a'], ['audio/aac', 'aac'],
  ['audio/flac', 'flac'], ['audio/ogg', 'ogg'], ['audio/webm', 'webm'],
])

function packagePath(mediaSha: string, mimeType: string): string {
  const extension = MEDIA_EXTENSIONS.get(mimeType)
  if (extension === undefined) throw new Error('editorial handoff: media MIME is invalid')
  return `media/${mediaSha}.${extension}`
}

function exact(value: unknown, fields: readonly string[], field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())) {
    throw new Error(`editorial handoff: ${field} fields mismatch`)
  }
  return value as JsonObject
}

function text(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0
    || value.length > 512 || /[\r\n\0]/u.test(value)) {
    throw new Error(`editorial handoff: ${field} is invalid`)
  }
  return value
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`editorial handoff: ${field} is invalid`)
  return value
}

function optionalSha(value: unknown, field: string): string | null {
  return value === null ? null : sha(value, field)
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`editorial handoff: ${field} is invalid`)
  return value as number
}

function positiveCount(value: unknown, field: string): number {
  const result = count(value, field)
  if (result < 1) throw new Error(`editorial handoff: ${field} is invalid`)
  return result
}

function finite(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`editorial handoff: ${field} is invalid`)
  }
  return value
}

function positiveFinite(value: unknown, field: string, nullable = false): number | null {
  const result = finite(value, field, nullable)
  if (result !== null && result <= 0) throw new Error(`editorial handoff: ${field} is invalid`)
  return result
}

function rejectPrivateData(value: unknown, field = 'response'): void {
  if (typeof value === 'string') {
    if (value.includes('/Users/') || value.startsWith('file://') || value.includes('Bearer ')) {
      throw new Error(`editorial handoff: ${field} contains private runtime data`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectPrivateData(item, `${field}[${String(index)}]`)
    })
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (['localPath', 'local_path', 'absolutePath', 'token', 'jwt', 'secret'].includes(key)) {
        throw new Error(`editorial handoff: ${field}.${key} is forbidden`)
      }
      rejectPrivateData(item, `${field}.${key}`)
    }
  }
}

function media(value: unknown, field: string): YimengEditorialHandoffMedia {
  const item = exact(value, [
    'assetId', 'assetRevision', 'sha256', 'size', 'recordedOutputSha256', 'materializationStatus', 'outputBindingStatus',
    'mimeType', 'containerTypeStatus', 'durationSec', 'fps', 'width', 'height', 'aspectRatio', 'selectionStatus',
    'qualityStatus', 'lineageComplete', 'packagePath',
  ], field)
  const width = positiveFinite(item.width, `${field}.width`, true)
  const height = positiveFinite(item.height, `${field}.height`, true)
  const aspectRatio = text(item.aspectRatio, `${field}.aspectRatio`, true)
  const materializationStatus = item.materializationStatus
  const materializedSha = optionalSha(item.sha256, `${field}.sha256`)
  const recordedSha = optionalSha(item.recordedOutputSha256, `${field}.recordedOutputSha256`)
  const outputBindingStatus = item.outputBindingStatus
  const mimeType = text(item.mimeType, `${field}.mimeType`, true)
  const containerTypeStatus = item.containerTypeStatus
  const qualityStatus = item.qualityStatus
  const size = item.size === null ? null : positiveCount(item.size, `${field}.size`)
  const declaredPackagePath = text(item.packagePath, `${field}.packagePath`, true)
  if (item.selectionStatus !== 'Selected' || typeof item.lineageComplete !== 'boolean'
    || (materializationStatus !== 'available' && materializationStatus !== 'unavailable')
    || !OUTPUT_BINDING_STATUSES.includes(item.outputBindingStatus as typeof OUTPUT_BINDING_STATUSES[number])
    || (mimeType !== null && !mimeType.startsWith('video/'))
    || !['verified', 'mismatch', 'unavailable'].includes(String(containerTypeStatus))
    || (materializationStatus === 'unavailable' && containerTypeStatus !== 'unavailable')
    || !QUALITY_STATUSES.includes(qualityStatus as typeof QUALITY_STATUSES[number])
    || (width === null) !== (height === null) || (aspectRatio === null) !== (width === null)
    || (width !== null && aspectRatio !== `${String(width)}:${String(height)}`)
    || (materializationStatus === 'available') !== (materializedSha !== null)
    || (size !== null && materializedSha === null)
    || (declaredPackagePath !== null && (materializedSha === null || mimeType === null
      || declaredPackagePath !== packagePath(materializedSha, mimeType)))
    || (item.lineageComplete && outputBindingStatus !== 'verified')
    || (outputBindingStatus === 'verified' && (materializedSha === null || recordedSha !== materializedSha))
    || (outputBindingStatus === 'recorded_sha_missing' && recordedSha !== null)
    || (outputBindingStatus === 'materialized_file_missing'
      && (materializedSha !== null || recordedSha === null))
    || (outputBindingStatus === 'recorded_sha_mismatch'
      && (materializedSha === null || recordedSha === null || recordedSha === materializedSha))) {
    throw new Error(`editorial handoff: ${field} binding is invalid`)
  }
  return {
    assetId: text(item.assetId, `${field}.assetId`) as string,
    assetRevision: positiveCount(item.assetRevision, `${field}.assetRevision`),
    sha256: materializedSha, size, recordedOutputSha256: recordedSha, materializationStatus,
    outputBindingStatus: outputBindingStatus as YimengEditorialHandoffMedia['outputBindingStatus'],
    mimeType,
    containerTypeStatus: containerTypeStatus as YimengEditorialHandoffMedia['containerTypeStatus'],
    durationSec: positiveFinite(item.durationSec, `${field}.durationSec`, true),
    fps: positiveFinite(item.fps, `${field}.fps`, true),
    width, height, aspectRatio,
    selectionStatus: 'Selected',
    qualityStatus: qualityStatus as YimengEditorialHandoffMedia['qualityStatus'],
    lineageComplete: item.lineageComplete, packagePath: declaredPackagePath,
  }
}

function audioMedia(value: unknown, field: string): YimengEditorialHandoffAudio {
  const item = exact(value, [
    'assetId', 'sha256', 'recordedSha256', 'size', 'mimeType', 'containerTypeStatus', 'durationSec',
    'packagePath', 'role', 'selectionStatus', 'qualityStatus', 'materializationStatus',
    'qualityEvidenceValid', 'lineageComplete', 'formalizationComplete', 'sourceComplete', 'source',
  ], field)
  const actualSha = optionalSha(item.sha256, `${field}.sha256`)
  const recordedSha = optionalSha(item.recordedSha256, `${field}.recordedSha256`)
  const size = item.size === null ? null : positiveCount(item.size, `${field}.size`)
  const mimeType = text(item.mimeType, `${field}.mimeType`, true)
  const containerTypeStatus = item.containerTypeStatus
  const declaredPackagePath = text(item.packagePath, `${field}.packagePath`, true)
  const source = exact(item.source, [
    'taskId', 'provider', 'model', 'providerTaskId', 'routeKey', 'inputHash',
    'ownershipIntentSha256',
  ], `${field}.source`)
  const result: YimengEditorialHandoffAudio = {
    assetId: text(item.assetId, `${field}.assetId`) as string,
    sha256: actualSha,
    recordedSha256: recordedSha,
    size,
    mimeType,
    containerTypeStatus: containerTypeStatus as YimengEditorialHandoffAudio['containerTypeStatus'],
    durationSec: positiveFinite(item.durationSec, `${field}.durationSec`, true),
    packagePath: declaredPackagePath,
    role: item.role as 'b6_dialogue_audio',
    selectionStatus: item.selectionStatus as 'Selected',
    qualityStatus: item.qualityStatus as YimengEditorialHandoffAudio['qualityStatus'],
    materializationStatus: item.materializationStatus as YimengEditorialHandoffAudio['materializationStatus'],
    qualityEvidenceValid: item.qualityEvidenceValid as boolean,
    lineageComplete: item.lineageComplete as boolean,
    formalizationComplete: item.formalizationComplete as boolean,
    sourceComplete: item.sourceComplete as boolean,
    source: {
      taskId: text(source.taskId, `${field}.source.taskId`, true),
      provider: text(source.provider, `${field}.source.provider`, true),
      model: text(source.model, `${field}.source.model`, true),
      providerTaskId: text(source.providerTaskId, `${field}.source.providerTaskId`, true),
      routeKey: text(source.routeKey, `${field}.source.routeKey`, true),
      inputHash: optionalSha(source.inputHash, `${field}.source.inputHash`),
      ownershipIntentSha256: optionalSha(
        source.ownershipIntentSha256, `${field}.source.ownershipIntentSha256`,
      ),
    },
  }
  if (!QUALITY_STATUSES.includes(result.qualityStatus)
    || !['available', 'unavailable'].includes(result.materializationStatus)
    || !['verified', 'mismatch', 'unavailable'].includes(result.containerTypeStatus)
    || (result.materializationStatus === 'unavailable'
      && result.containerTypeStatus !== 'unavailable')
    || typeof result.qualityEvidenceValid !== 'boolean' || typeof result.lineageComplete !== 'boolean'
    || typeof result.formalizationComplete !== 'boolean' || typeof result.sourceComplete !== 'boolean'
    || (size !== null && actualSha === null)
    || (declaredPackagePath !== null && (recordedSha === null || mimeType === null
      || declaredPackagePath !== packagePath(recordedSha, mimeType)))) {
    throw new Error(`editorial handoff: ${field} binding is invalid`)
  }
  return result
}

function immutableRecords(
  value: unknown,
  schema: 'jason.qingmu-take-qc-records.v1',
  field: string,
  request: YimengEditorialHandoffRequest & { readonly frameId: string },
  digest: Digest,
): YimengEpisodeEvidenceQcRecords
function immutableRecords(
  value: unknown,
  schema: 'jason.qingmu-take-approval-lifecycle-records.v1',
  field: string,
  request: YimengEditorialHandoffRequest & { readonly frameId: string },
  digest: Digest,
): YimengEpisodeEvidenceLifecycleRecords
function immutableRecords(
  value: unknown,
  schema: 'jason.qingmu-take-qc-records.v1' | 'jason.qingmu-take-approval-lifecycle-records.v1',
  field: string,
  request: YimengEditorialHandoffRequest & { readonly frameId: string },
  digest: Digest,
): YimengEpisodeEvidenceQcRecords | YimengEpisodeEvidenceLifecycleRecords {
  const item = exact(value, ['schema', 'records', 'currentBinding'], field)
  if (item.schema !== schema
    || !['current', 'not_current'].includes(item.currentBinding as string)
    || !Array.isArray(item.records)) {
    throw new Error(`editorial handoff: ${field} is invalid`)
  }
  if (schema === 'jason.qingmu-take-qc-records.v1') {
    return { schema, records: item.records.map(record =>
      normalizePersistedTakeTechnicalQcAssessment(record, request, digest)),
    currentBinding: item.currentBinding as YimengEpisodeEvidenceQcRecords['currentBinding'] }
  }
  return { schema, records: normalizePersistedTakeApprovalLifecycleTransitions(item.records).map(entry => ({ ...entry })),
    currentBinding: item.currentBinding as YimengEpisodeEvidenceLifecycleRecords['currentBinding'] }
}

function expectedShotBlockers(
  selectedTake: YimengEditorialHandoffMedia | null,
  audio: YimengEditorialHandoffAudio | null,
  audioCandidateCount: number,
  audioScopeStatus: 'valid' | 'cross_scope',
  qc: YimengEpisodeEvidenceQcRecords | null,
  approval: YimengEpisodeEvidenceLifecycleRecords | null,
): readonly string[] {
  const result: string[] = []
  if (selectedTake === null) {
    result.push('editorial_handoff_selected_take_missing')
  } else {
    if (selectedTake.materializationStatus === 'unavailable'
      || selectedTake.containerTypeStatus === 'unavailable') {
      result.push('editorial_handoff_selected_media_missing')
    }
    if (selectedTake.recordedOutputSha256 === null) {
      result.push('editorial_handoff_selected_media_sha_missing')
    }
    if (selectedTake.outputBindingStatus === 'recorded_sha_mismatch') {
      result.push('editorial_handoff_selected_media_drift')
    }
    if (selectedTake.containerTypeStatus === 'mismatch') {
      result.push('editorial_handoff_selected_media_type_mismatch')
    }
    if (!selectedTake.lineageComplete) result.push('editorial_handoff_selected_take_lineage_incomplete')
    if (selectedTake.mimeType === null || selectedTake.durationSec === null || selectedTake.fps === null
      || selectedTake.width === null || selectedTake.height === null || selectedTake.aspectRatio === null
      || selectedTake.size === null || selectedTake.packagePath === null) {
      result.push('editorial_handoff_selected_media_metadata_missing')
    }
    if (selectedTake.qualityStatus !== 'passed') {
      result.push('editorial_handoff_selected_take_qc_not_passed')
    }
  }
  if (audioScopeStatus === 'cross_scope') {
    result.push('editorial_handoff_selected_audio_scope_invalid')
  } else if (audio === null) {
    result.push(audioCandidateCount === 0
      ? 'editorial_handoff_selected_audio_missing'
      : 'editorial_handoff_selected_audio_multiple')
  } else {
    if (audio.materializationStatus === 'unavailable'
      || audio.containerTypeStatus === 'unavailable') {
      result.push('editorial_handoff_selected_audio_media_missing')
    }
    if (audio.sha256 !== null && audio.recordedSha256 !== null
      && audio.sha256 !== audio.recordedSha256) {
      result.push('editorial_handoff_selected_audio_media_drift')
    }
    if (audio.containerTypeStatus === 'mismatch') {
      result.push('editorial_handoff_selected_audio_media_type_mismatch')
    }
    if (audio.sha256 === null || audio.recordedSha256 === null || audio.size === null
      || audio.mimeType === null || audio.durationSec === null || audio.packagePath === null) {
      result.push('editorial_handoff_selected_audio_metadata_missing')
    }
    if (audio.qualityStatus !== 'passed') {
      result.push('editorial_handoff_selected_audio_quality_not_passed')
    }
    if (!audio.qualityEvidenceValid) {
      result.push('editorial_handoff_selected_audio_quality_evidence_invalid')
    }
    if (!audio.lineageComplete) result.push('editorial_handoff_selected_audio_lineage_incomplete')
    if (!audio.formalizationComplete) result.push('editorial_handoff_selected_audio_formalization_incomplete')
    if (!audio.sourceComplete) result.push('editorial_handoff_selected_audio_source_incomplete')
  }
  if (selectedTake?.durationSec !== null && selectedTake?.durationSec !== undefined
    && selectedTake.fps !== null && audio?.durationSec !== null && audio?.durationSec !== undefined
    && Math.abs(selectedTake.durationSec - audio.durationSec) > 1e-6) {
    result.push('editorial_handoff_audio_video_duration_mismatch')
  }
  if (qc === null) result.push('editorial_handoff_qc_record_missing')
  else if (qc.currentBinding !== 'current') result.push('editorial_handoff_qc_binding_unverified')
  if (approval === null) result.push('editorial_handoff_approval_record_missing')
  else if (approval.currentBinding !== 'current') result.push('editorial_handoff_approval_binding_unverified')
  return result.sort()
}

function codes(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`editorial handoff: ${field} is invalid`)
  const items = value.map((item, index) => text(item, `${field}[${String(index)}]`) as string)
  if (new Set(items).size !== items.length || !isDeepStrictEqual(items, [...items].sort())) {
    throw new Error(`editorial handoff: ${field} must be sorted and unique`)
  }
  return items
}

function shot(
  value: unknown,
  request: YimengEditorialHandoffRequest,
  digest: Digest,
  previousFrameNo: number,
): YimengEditorialHandoffShot {
  const item = exact(value, [
    'frameId', 'frameNo', 'sceneId', 'title', 'frameContentSha256', 'stackSnapshotSha256',
    'selectedTake', 'audio', 'comments', 'review', 'qc', 'approval', 'blockers',
  ], 'source.shots[]')
  const frameNo = count(item.frameNo, 'source.shots[].frameNo')
  if (frameNo < 1 || frameNo <= previousFrameNo) throw new Error('editorial handoff: shot order is invalid')
  const audioBinding = exact(item.audio, ['status', 'scopeStatus', 'candidateCount', 'asset'], 'source.shots[].audio')
  if (!['available', 'unavailable'].includes(audioBinding.status as string)) {
    throw new Error('editorial handoff: audio authority is invalid')
  }
  if (!['valid', 'cross_scope'].includes(audioBinding.scopeStatus as string)) {
    throw new Error('editorial handoff: audio scope is invalid')
  }
  const audioScopeStatus = audioBinding.scopeStatus as 'valid' | 'cross_scope'
  const audioCandidateCount = count(audioBinding.candidateCount, 'source.shots[].audio.candidateCount')
  const audio = audioBinding.asset === null ? null : audioMedia(audioBinding.asset, 'source.shots[].audio.asset')
  if ((audioScopeStatus === 'valid' && audio === null && audioCandidateCount === 1)
    || (audioScopeStatus === 'cross_scope' && (audio !== null || audioCandidateCount < 1))
    || (audio !== null && (audioCandidateCount !== 1 || audioScopeStatus !== 'valid'))) {
    throw new Error('editorial handoff: audio candidate count is invalid')
  }
  if ((audioBinding.status === 'available') !== (audio !== null && expectedShotBlockers(
    null, audio, audioCandidateCount, audioScopeStatus, null, null,
  ).every(code => !code.startsWith('editorial_handoff_selected_audio_')))) {
    throw new Error('editorial handoff: audio status is invalid')
  }
  const frameId = text(item.frameId, 'source.shots[].frameId') as string
  const coordinate = { ...request, frameId }
  const comments = normalizeTakeCommentFeed(item.comments, coordinate, digest)
  const review = normalizeTakeReviewAuthorityFeed(item.review, coordinate, digest)
  if (!isDeepStrictEqual(comments.versions, review.versions)) {
    throw new Error('editorial handoff: comment and review Take subjects disagree')
  }
  const selectedTake = item.selectedTake === null ? null : media(item.selectedTake, 'source.shots[].selectedTake')
  if (selectedTake !== null) {
    const subject = comments.versions.find(entry => entry.takeSubject.takeId === selectedTake.assetId)?.takeSubject
    const durationMillis = selectedTake.durationSec === null ? null : selectedTake.durationSec * 1000
    const canonicalSubjectRequired = selectedTake.sha256 !== null && durationMillis !== null
      && Number.isSafeInteger(durationMillis) && durationMillis / 1000 === selectedTake.durationSec
    const subjectMismatch = subject !== undefined && (
      subject.versionOrdinal !== selectedTake.assetRevision
      || subject.outputSha256 !== selectedTake.sha256
      || (selectedTake.durationSec !== null && subject.durationMillis !== selectedTake.durationSec * 1000)
    )
    if ((subject === undefined && canonicalSubjectRequired) || subjectMismatch) {
      throw new Error('editorial handoff: selected Take does not match the canonical feed')
    }
  }
  const qc = item.qc === null ? null
    : immutableRecords(item.qc, 'jason.qingmu-take-qc-records.v1', 'source.shots[].qc', coordinate, digest)
  const approval = item.approval === null ? null
    : immutableRecords(item.approval, 'jason.qingmu-take-approval-lifecycle-records.v1', 'source.shots[].approval', coordinate, digest)
  const currentQc = selectedTake === null || qc === null ? undefined : [...qc.records].reverse().find((record) => {
    const subject = record.takeSubject as Record<string, unknown> | undefined
    return record.technicalPass === true && subject?.projectId === request.projectId
      && subject.episodeId === request.episodeId && subject.frameId === frameId
      && subject.frameContentSha256 === item.frameContentSha256
      && subject.takeId === selectedTake.assetId && subject.versionOrdinal === selectedTake.assetRevision
      && subject.outputSha256 === selectedTake.sha256 && subject.selectionStatus === 'Selected'
  })
  if (qc !== null && qc.currentBinding !== (currentQc === undefined ? 'not_current' : 'current')) {
    throw new Error('editorial handoff: QC current binding is invalid')
  }
  const latestApproval = approval?.records.at(-1)
  const approvalCurrent = latestApproval?.action === 'APPROVE'
    && latestApproval.takeId === selectedTake?.assetId
    && latestApproval.takeVersionOrdinal === selectedTake?.assetRevision
    && latestApproval.takeSubjectSha256 === currentQc?.takeSubjectSha256
    && latestApproval.assessmentId === currentQc?.assessmentId
    && latestApproval.assessmentEventId === currentQc?.eventId
    && typeof latestApproval.decisionId === 'string'
    && typeof latestApproval.actorNaturalPersonId === 'string'
  if (approval !== null && approval.currentBinding !== (approvalCurrent ? 'current' : 'not_current')) {
    throw new Error('editorial handoff: approval current binding is invalid')
  }
  const blockers = codes(item.blockers, 'source.shots[].blockers')
  if (!isDeepStrictEqual(blockers, expectedShotBlockers(
    selectedTake, audio, audioCandidateCount, audioScopeStatus, qc, approval,
  ))) {
    throw new Error('editorial handoff: shot blockers do not match normalized source facts')
  }
  return {
    frameId,
    frameNo,
    sceneId: text(item.sceneId, 'source.shots[].sceneId', true),
    title: typeof item.title === 'string' && item.title.length <= 512 ? item.title : '',
    frameContentSha256: sha(item.frameContentSha256, 'source.shots[].frameContentSha256'),
    stackSnapshotSha256: sha(item.stackSnapshotSha256, 'source.shots[].stackSnapshotSha256'),
    selectedTake,
    audio: {
      status: audioBinding.status as YimengEditorialHandoffShot['audio']['status'],
      scopeStatus: audioScopeStatus,
      candidateCount: audioCandidateCount,
      asset: audio,
    },
    comments,
    review,
    qc,
    approval,
    blockers,
  }
}

/**
 * Validate the Writer-owned editorial handoff projection without adding browser authority.
 * @param value - Untrusted JSON returned by the Writer read endpoint.
 * @param request - Project and episode scope requested by the browser.
 * @param digest - Canonical SHA-256 implementation supplied by the Host adapter.
 * @returns The strictly normalized read-only editorial handoff projection.
 */
export function normalizeEditorialHandoff(
  value: unknown,
  request: YimengEditorialHandoffRequest,
  digest: Digest,
): YimengEditorialHandoffResponse {
  rejectPrivateData(value)
  const root = exact(value, [
    'schema', 'projectId', 'episodeId', 'source', 'sourceSnapshotSha256', 'summary',
    'unresolved', 'blockers', 'download', 'aokiVideoProductionHandoffReady',
    'yimengEpisodeReleaseReady', 'readOnly', 'providerCalls', 'businessMutations',
    'projectionSha256',
  ], 'response')
  if (root.schema !== 'jason.qingmu-editorial-handoff-draft.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.aokiVideoProductionHandoffReady !== false || root.yimengEpisodeReleaseReady !== false
    || root.readOnly !== true || root.providerCalls !== 0 || root.businessMutations !== 0) {
    throw new Error('editorial handoff: response authority is invalid')
  }
  const source = exact(root.source, [
    'schema', 'projectId', 'episodeId', 'evidenceSourceSnapshotSha256',
    'verificationInputsSha256', 'shots', 'audioPolicy',
  ], 'source')
  if (source.schema !== 'jason.qingmu-editorial-handoff-source.v1'
    || source.projectId !== request.projectId || source.episodeId !== request.episodeId
    || source.audioPolicy !== 'only_authoritatively_bound_assets' || !Array.isArray(source.shots)) {
    throw new Error('editorial handoff: source identity is invalid')
  }
  let previous = 0
  const shots = source.shots.map((item) => {
    const result = shot(item, request, digest, previous)
    previous = result.frameNo
    return result
  })
  if (new Set(shots.map(item => item.frameId)).size !== shots.length) {
    throw new Error('editorial handoff: shots are duplicated')
  }
  const normalizedSource = {
    schema: 'jason.qingmu-editorial-handoff-source.v1' as const,
    projectId: request.projectId,
    episodeId: request.episodeId,
    evidenceSourceSnapshotSha256: sha(source.evidenceSourceSnapshotSha256, 'source.evidenceSourceSnapshotSha256'),
    verificationInputsSha256: sha(source.verificationInputsSha256, 'source.verificationInputsSha256'),
    shots,
    audioPolicy: 'only_authoritatively_bound_assets' as const,
  }
  const sourceSnapshotSha256 = sha(root.sourceSnapshotSha256, 'sourceSnapshotSha256')
  if (sourceSnapshotSha256 !== digest(normalizedSource, 'editorialHandoff.source')) {
    throw new Error('editorial handoff: source hash mismatch')
  }
  const summary = exact(root.summary, [
    'shotCount', 'selectedTakeCount', 'authoritativeAudioCount', 'totalDurationSec', 'unresolvedCount',
  ], 'summary')
  const unresolved = Array.isArray(root.unresolved) ? root.unresolved.map((value, index) => {
    const item = exact(value, ['frameId', 'code'], `unresolved[${String(index)}]`)
    return { frameId: text(item.frameId, `unresolved[${String(index)}].frameId`, true),
      code: text(item.code, `unresolved[${String(index)}].code`) as string }
  }) : (() => { throw new Error('editorial handoff: unresolved is invalid') })()
  const blockers: Array<{ scope: 'shot' | 'export'; frameId: string | null; code: string }> = Array.isArray(root.blockers)
    ? root.blockers.map((value, index) => {
      const item = exact(value, ['scope', 'frameId', 'code'], `blockers[${String(index)}]`)
      if (item.scope !== 'shot' && item.scope !== 'export') throw new Error('editorial handoff: blocker scope is invalid')
      return { scope: item.scope, frameId: text(item.frameId, `blockers[${String(index)}].frameId`, true),
        code: text(item.code, `blockers[${String(index)}].code`) as string }
    }) : (() => { throw new Error('editorial handoff: blockers is invalid') })()
  const download = exact(root.download, [
    'available', 'format', 'blockerCode', 'packageSchema', 'otio', 'rangePolicy',
    'audioEditorialRatePolicy',
  ], 'download')
  const otio = exact(download.otio, [
    'distribution', 'version', 'adapter', 'schemaFamily', 'schemaLabel',
  ], 'download.otio')
  if (typeof download.available !== 'boolean' || download.format !== 'otio-zip'
    || (download.blockerCode !== null && typeof download.blockerCode !== 'string')
    || download.packageSchema !== 'jason.qingmu-editorial-otio-package.v1'
    || otio.distribution !== 'OpenTimelineIO' || otio.version !== '0.18.1'
    || otio.adapter !== 'otio_json' || otio.schemaFamily !== 'OTIO_CORE'
    || otio.schemaLabel !== '0.18.1'
    || download.rangePolicy !== 'full-selected-asset-v1'
    || download.audioEditorialRatePolicy !== 'episode-canonical-video-fps-v1') {
    throw new Error('editorial handoff: download boundary is invalid')
  }
  const authoritativeAudioCount = count(summary.authoritativeAudioCount, 'summary.authoritativeAudioCount')
  const normalizedSummary = {
    shotCount: count(summary.shotCount, 'summary.shotCount'),
    selectedTakeCount: count(summary.selectedTakeCount, 'summary.selectedTakeCount'),
    authoritativeAudioCount,
    totalDurationSec: Math.round(shots.reduce(
      (total, item) => total + (item.selectedTake?.durationSec ?? 0), 0,
    ) * 1_000_000) / 1_000_000,
    unresolvedCount: count(summary.unresolvedCount, 'summary.unresolvedCount'),
  }
  if (normalizedSummary.shotCount !== shots.length
    || normalizedSummary.selectedTakeCount !== shots.filter(item => item.selectedTake !== null).length
    || normalizedSummary.authoritativeAudioCount !== shots.filter(item => item.audio.status === 'available').length
    || normalizedSummary.unresolvedCount !== unresolved.length
    || blockers.length !== unresolved.length
    || finite(summary.totalDurationSec, 'summary.totalDurationSec') !== normalizedSummary.totalDurationSec) {
    throw new Error('editorial handoff: summary mismatch')
  }
  const rates = new Set(shots.flatMap(item => item.selectedTake?.fps === null
    || item.selectedTake?.fps === undefined ? [] : [item.selectedTake.fps]))
  const exportCodes = rates.size > 1 ? ['editorial_handoff_video_fps_mismatch'] : []
  const expectedUnresolved = [
    ...shots.flatMap(item => item.blockers.map(code => ({ frameId: item.frameId, code }))),
    ...exportCodes.map(code => ({ frameId: null, code })),
  ]
  const expectedBlockers = [
    ...shots.flatMap(item => item.blockers.map(code => ({ scope: 'shot' as const, frameId: item.frameId, code }))),
    ...exportCodes.map(code => ({ scope: 'export' as const, frameId: null, code })),
  ]
  const expectedAvailable = shots.length > 0 && expectedBlockers.length === 0
  const expectedBlockerCode = expectedBlockers[0]?.code ?? null
  if (!isDeepStrictEqual(unresolved, expectedUnresolved)
    || !isDeepStrictEqual(blockers, expectedBlockers)
    || download.available !== expectedAvailable
    || download.blockerCode !== expectedBlockerCode) {
    throw new Error('editorial handoff: blockers do not match the authoritative shots')
  }
  const projectionSha256 = sha(root.projectionSha256, 'projectionSha256')
  const normalized = {
    schema: 'jason.qingmu-editorial-handoff-draft.v1' as const,
    ...request,
    source: normalizedSource,
    sourceSnapshotSha256,
    summary: normalizedSummary,
    unresolved,
    blockers,
    download: {
      available: download.available,
      format: 'otio-zip' as const,
      blockerCode: download.blockerCode,
      packageSchema: 'jason.qingmu-editorial-otio-package.v1' as const,
      otio: {
        distribution: 'OpenTimelineIO' as const,
        version: '0.18.1' as const,
        adapter: 'otio_json' as const,
        schemaFamily: 'OTIO_CORE' as const,
        schemaLabel: '0.18.1' as const,
      },
      rangePolicy: 'full-selected-asset-v1' as const,
      audioEditorialRatePolicy: 'episode-canonical-video-fps-v1' as const,
    },
    aokiVideoProductionHandoffReady: false as const,
    yimengEpisodeReleaseReady: false as const,
    readOnly: true as const,
    providerCalls: 0 as const,
    businessMutations: 0 as const,
  }
  if (projectionSha256 !== digest(normalized, 'editorialHandoff')) {
    throw new Error('editorial handoff: projection hash mismatch')
  }
  return { ...normalized, projectionSha256 }
}
