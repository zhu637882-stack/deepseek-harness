/** Strict Host normalization for the read-only editorial handoff draft. */
import { isDeepStrictEqual } from 'node:util'
import { normalizeTakeCommentFeed } from './take-comments.ts'
import { normalizeTakeReviewAuthorityFeed } from './take-review-authority.ts'
import { normalizePersistedTakeTechnicalQcAssessment } from './take-technical-qc.ts'
import { normalizePersistedTakeApprovalLifecycleTransitions } from './take-approval-lifecycle.ts'
import type {
  YimengEpisodeEvidenceLifecycleRecords,
  YimengEpisodeEvidenceQcRecords,
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
    'assetId', 'assetRevision', 'sha256', 'recordedOutputSha256', 'materializationStatus', 'outputBindingStatus',
    'mimeType', 'durationSec', 'fps', 'width', 'height', 'aspectRatio', 'selectionStatus',
    'qualityStatus', 'lineageComplete',
  ], field)
  const width = positiveFinite(item.width, `${field}.width`, true)
  const height = positiveFinite(item.height, `${field}.height`, true)
  const aspectRatio = text(item.aspectRatio, `${field}.aspectRatio`, true)
  const materializationStatus = item.materializationStatus
  const materializedSha = optionalSha(item.sha256, `${field}.sha256`)
  const recordedSha = optionalSha(item.recordedOutputSha256, `${field}.recordedOutputSha256`)
  const outputBindingStatus = item.outputBindingStatus
  const mimeType = text(item.mimeType, `${field}.mimeType`, true)
  if (item.selectionStatus !== 'Selected' || typeof item.lineageComplete !== 'boolean'
    || (materializationStatus !== 'available' && materializationStatus !== 'unavailable')
    || !OUTPUT_BINDING_STATUSES.includes(item.outputBindingStatus as typeof OUTPUT_BINDING_STATUSES[number])
    || (mimeType !== null && !mimeType.startsWith('video/'))
    || (width === null) !== (height === null) || (aspectRatio === null) !== (width === null)
    || (width !== null && aspectRatio !== `${String(width)}:${String(height)}`)
    || (materializationStatus === 'available') !== (materializedSha !== null)
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
    assetRevision: count(item.assetRevision, `${field}.assetRevision`),
    sha256: materializedSha, recordedOutputSha256: recordedSha, materializationStatus,
    outputBindingStatus: outputBindingStatus as YimengEditorialHandoffMedia['outputBindingStatus'],
    mimeType,
    durationSec: positiveFinite(item.durationSec, `${field}.durationSec`, true),
    fps: positiveFinite(item.fps, `${field}.fps`, true),
    width, height, aspectRatio,
    selectionStatus: 'Selected',
    qualityStatus: text(item.qualityStatus, `${field}.qualityStatus`) as string,
    lineageComplete: item.lineageComplete,
  }
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
  if (item.schema !== schema || item.currentBinding !== 'unknown_without_probe'
    || !Array.isArray(item.records)) {
    throw new Error(`editorial handoff: ${field} is invalid`)
  }
  if (schema === 'jason.qingmu-take-qc-records.v1') {
    return { schema, records: item.records.map(record =>
      normalizePersistedTakeTechnicalQcAssessment(record, request, digest)), currentBinding: 'unknown_without_probe' }
  }
  return { schema, records: normalizePersistedTakeApprovalLifecycleTransitions(item.records).map(entry => ({ ...entry })),
    currentBinding: 'unknown_without_probe' }
}

function expectedShotBlockers(
  selectedTake: YimengEditorialHandoffMedia | null,
  qc: YimengEpisodeEvidenceQcRecords | null,
  approval: YimengEpisodeEvidenceLifecycleRecords | null,
): readonly string[] {
  const result: string[] = []
  if (selectedTake === null) {
    result.push('editorial_handoff_selected_take_missing')
  } else {
    if (selectedTake.materializationStatus === 'unavailable') {
      result.push('editorial_handoff_selected_media_missing')
    }
    if (selectedTake.recordedOutputSha256 === null) {
      result.push('editorial_handoff_selected_media_sha_missing')
    }
    if (selectedTake.outputBindingStatus === 'recorded_sha_mismatch') {
      result.push('editorial_handoff_selected_media_drift')
    }
    if (!selectedTake.lineageComplete) result.push('editorial_handoff_selected_take_lineage_incomplete')
    if (selectedTake.mimeType === null || selectedTake.durationSec === null || selectedTake.fps === null
      || selectedTake.width === null || selectedTake.height === null || selectedTake.aspectRatio === null) {
      result.push('editorial_handoff_selected_media_metadata_missing')
    }
    if (selectedTake.qualityStatus !== 'passed') {
      result.push('editorial_handoff_selected_take_qc_not_passed')
    }
  }
  result.push(qc === null ? 'editorial_handoff_qc_record_missing' : 'editorial_handoff_qc_binding_unverified')
  result.push(approval === null
    ? 'editorial_handoff_approval_record_missing'
    : 'editorial_handoff_approval_binding_unverified')
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
  const audio = exact(item.audio, ['status', 'asset'], 'source.shots[].audio')
  if (audio.status !== 'not_authoritatively_bound' || audio.asset !== null) {
    throw new Error('editorial handoff: audio authority is invalid')
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
  const blockers = codes(item.blockers, 'source.shots[].blockers')
  if (!isDeepStrictEqual(blockers, expectedShotBlockers(selectedTake, qc, approval))) {
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
    audio: { status: 'not_authoritatively_bound', asset: null },
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
  const download = exact(root.download, ['available', 'format', 'blockerCode'], 'download')
  if (download.available !== false || download.format !== 'otio-zip'
    || !['editorial_handoff_otio_dependency_unavailable', 'editorial_handoff_otio_adapter_unverified']
      .includes(download.blockerCode as string)) throw new Error('editorial handoff: download boundary is invalid')
  const authoritativeAudioCount = count(summary.authoritativeAudioCount, 'summary.authoritativeAudioCount')
  if (authoritativeAudioCount !== 0) throw new Error('editorial handoff: authoritative audio count is invalid')
  const normalizedSummary = {
    shotCount: count(summary.shotCount, 'summary.shotCount'),
    selectedTakeCount: count(summary.selectedTakeCount, 'summary.selectedTakeCount'),
    authoritativeAudioCount: 0 as const,
    totalDurationSec: Math.round(shots.reduce(
      (total, item) => total + (item.selectedTake?.durationSec ?? 0), 0,
    ) * 1_000_000) / 1_000_000,
    unresolvedCount: count(summary.unresolvedCount, 'summary.unresolvedCount'),
  }
  if (normalizedSummary.shotCount !== shots.length
    || normalizedSummary.selectedTakeCount !== shots.filter(item => item.selectedTake !== null).length
    || normalizedSummary.unresolvedCount !== unresolved.length
    || blockers.length !== unresolved.length
    || finite(summary.totalDurationSec, 'summary.totalDurationSec') !== normalizedSummary.totalDurationSec) {
    throw new Error('editorial handoff: summary mismatch')
  }
  const expectedUnresolved = [
    ...shots.flatMap(item => item.blockers.map(code => ({ frameId: item.frameId, code }))),
    { frameId: null, code: download.blockerCode as string },
  ]
  const expectedBlockers = [
    ...shots.flatMap(item => item.blockers.map(code => ({ scope: 'shot' as const, frameId: item.frameId, code }))),
    { scope: 'export' as const, frameId: null, code: download.blockerCode as string },
  ]
  if (!isDeepStrictEqual(unresolved, expectedUnresolved)
    || !isDeepStrictEqual(blockers, expectedBlockers)) {
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
      available: false as const,
      format: 'otio-zip' as const,
      blockerCode: download.blockerCode as YimengEditorialHandoffResponse['download']['blockerCode'],
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
