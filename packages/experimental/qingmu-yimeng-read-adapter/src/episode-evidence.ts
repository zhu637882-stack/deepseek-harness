/** Validate the read-only episode ledger and source-pinned canonical verification result. */
import { isDeepStrictEqual } from 'node:util'
import { normalizeTakeCommentFeed } from './take-comments.ts'
import { normalizeTakeReviewAuthorityFeed } from './take-review-authority.ts'
import { normalizeTakeVersionStack } from './take-versions.ts'
import type {
  YimengEpisodeEvidenceAcceptanceSource,
  YimengEpisodeEvidenceFrame,
  YimengEpisodeEvidenceLifecycleRecords,
  YimengEpisodeEvidenceLedgerResponse,
  YimengEpisodeEvidenceQcRecords,
  YimengEpisodeEvidenceRequest,
  YimengEpisodeEvidenceSource,
  YimengEpisodeVerificationReport,
  YimengEpisodeVerificationRequest,
  YimengEpisodeVerificationResponse,
  YimengTakeVersionRequest,
} from './types.ts'

type Digest = (value: unknown, field: string) => string
type JsonObject = Record<string, unknown>

const SHA256 = /^[0-9a-f]{64}$/u
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const LEDGER_FIELDS = ['schema', 'projectId', 'episodeId', 'source', 'sourceSnapshotSha256'] as const
const SOURCE_FIELDS = ['schema', 'projectId', 'episodeId', 'frames', 'verificationInputsSha256'] as const
const FRAME_FIELDS = ['frameId', 'frameNo', 'stack', 'comments', 'review', 'acceptance', 'qc', 'lifecycle', 'verificationInput'] as const
const VERIFICATION_FIELDS = [
  'project_id', 'episode_id', 'ok', 'errors', 'warnings', 'technical_errors', 'creative_errors',
  'technical_ok', 'creative_ok', 'frame_count', 'video_asset_count', 'raw_video_asset_count',
  'unverified_video_asset_count', 'duplicate_video_asset_count', 'video_frame_coverage_count',
  'missing_video_frame_nos', 'dialogue_asr_required_count', 'dialogue_asr_verified_count',
  'final_delivery_profile', 'final_count',
] as const
const VERIFICATION_RESPONSE_FIELDS = [
  'schema', 'projectId', 'episodeId', 'sourceSnapshotSha256', 'verification',
  'verificationSha256', 'verifiedAt',
] as const

function exact(value: unknown, fields: readonly string[], field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())) {
    throw new Error(`episode evidence: ${field} fields mismatch`)
  }
  return value as JsonObject
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 256
    || /[\r\n\0]/u.test(value)) {
    throw new Error(`episode evidence: ${field} is invalid`)
  }
  return value
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`episode evidence: ${field} is invalid`)
  return value
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`episode evidence: ${field} is invalid`)
  return value as number
}

function strings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.isWellFormed())) {
    throw new Error(`episode evidence: ${field} is invalid`)
  }
  return value.map(item => item as string)
}

function frameNumbers(value: unknown, field: string): readonly number[] {
  if (!Array.isArray(value)) throw new Error(`episode evidence: ${field} is invalid`)
  const result: number[] = value.map((item, index) => {
    if (!Number.isSafeInteger(item) || item < 1) throw new Error(`episode evidence: ${field}[${String(index)}] is invalid`)
    return item as number
  })
  if (new Set(result).size !== result.length || !isDeepStrictEqual(result, [...result].sort((left, right) => left - right))) {
    throw new Error(`episode evidence: ${field} must be sorted and unique`)
  }
  return result
}

function jsonObject(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`episode evidence: ${field} is invalid`)
  }
  return value as JsonObject
}

function acceptance(value: unknown, digest: Digest): YimengEpisodeEvidenceAcceptanceSource {
  const item = exact(value, ['schema', 'canonical', 'canonicalSha256'], 'acceptance')
  if (item.schema !== 'jason.qingmu-take-acceptance-source.v1') {
    throw new Error('episode evidence: acceptance schema is invalid')
  }
  const canonical = jsonObject(item.canonical, 'acceptance.canonical')
  const canonicalSha256 = sha(item.canonicalSha256, 'acceptance.canonicalSha256')
  if (canonicalSha256 !== digest(canonical, 'episodeEvidence.acceptance.canonical')) {
    throw new Error('episode evidence: acceptance canonical hash mismatch')
  }
  return { schema: 'jason.qingmu-take-acceptance-source.v1', canonical, canonicalSha256 }
}

function immutableRecords(
  value: unknown,
  schema: YimengEpisodeEvidenceQcRecords['schema'] | YimengEpisodeEvidenceLifecycleRecords['schema'],
  field: string,
): YimengEpisodeEvidenceQcRecords | YimengEpisodeEvidenceLifecycleRecords {
  const item = exact(value, ['schema', 'records', 'currentBinding'], field)
  if (item.schema !== schema || item.currentBinding !== 'unknown_without_probe' || !Array.isArray(item.records)
    || !item.records.every(record => typeof record === 'object' && record !== null && !Array.isArray(record))) {
    throw new Error(`episode evidence: ${field} is invalid`)
  }
  if (schema === 'jason.qingmu-take-qc-records.v1') {
    return { schema, records: item.records as readonly JsonObject[], currentBinding: 'unknown_without_probe' }
  }
  return { schema, records: item.records as readonly JsonObject[], currentBinding: 'unknown_without_probe' }
}

/**
 * Parse one browser request without caller-supplied authority or routing controls.
 * @param payload - Untrusted browser RPC input.
 * @returns The exact validated project and episode scope.
 */
export function parseEpisodeEvidenceRequest(payload: unknown): YimengEpisodeEvidenceRequest {
  const input = exact(payload, ['projectId', 'episodeId'], 'request')
  return { projectId: id(input.projectId, 'projectId'), episodeId: id(input.episodeId, 'episodeId') }
}

/**
 * Parse an explicit verification request pinned to the current ledger source.
 * @param payload - Untrusted browser RPC input.
 * @returns The validated scope and required source snapshot hash.
 */
export function parseEpisodeVerificationRequest(payload: unknown): YimengEpisodeVerificationRequest {
  const input = exact(payload, ['projectId', 'episodeId', 'sourceSnapshotSha256'], 'verification request')
  return {
    projectId: id(input.projectId, 'projectId'),
    episodeId: id(input.episodeId, 'episodeId'),
    sourceSnapshotSha256: sha(input.sourceSnapshotSha256, 'sourceSnapshotSha256'),
  }
}

function frame(
  value: unknown,
  request: YimengEpisodeEvidenceRequest,
  digest: Digest,
  previousFrameNo: number,
): YimengEpisodeEvidenceFrame {
  const item = exact(value, FRAME_FIELDS, 'source.frames[]')
  const frameId = id(item.frameId, 'source.frames[].frameId')
  const frameNo = count(item.frameNo, 'source.frames[].frameNo')
  if (frameNo < 1 || frameNo <= previousFrameNo) throw new Error('episode evidence: source frame order is invalid')
  const coordinate: YimengTakeVersionRequest = { ...request, frameId }
  const stack = normalizeTakeVersionStack(item.stack, coordinate, digest)
  const comments = normalizeTakeCommentFeed(item.comments, coordinate, digest)
  const review = normalizeTakeReviewAuthorityFeed(item.review, coordinate, digest)
  if (frameNo !== stack.subject.frameNo || !isDeepStrictEqual(comments.versions, review.versions)) {
    throw new Error('episode evidence: current frame subjects disagree')
  }
  for (const { takeSubject } of comments.versions) {
    const version = stack.subject.versions.find(entry => entry.takeId === takeSubject.takeId)
    if (version === undefined || takeSubject.frameNo !== stack.subject.frameNo
      || takeSubject.storyboardRevision !== stack.subject.storyboardRevision
      || takeSubject.frameContentSha256 !== stack.subject.frameContentSha256
      || takeSubject.versionOrdinal !== version.versionOrdinal
      || takeSubject.outputSha256 !== version.outputSha256
      || version.durationSec !== takeSubject.durationMillis / 1000) {
      throw new Error('episode evidence: current Take subjects disagree')
    }
  }
  const selected = stack.subject.selectedTakeId !== null
  if (!selected && item.acceptance !== null) {
    throw new Error('episode evidence: unselected frame must not carry selected-Take evidence')
  }
  if (selected && item.acceptance === null) {
    throw new Error('episode evidence: selected frame is missing stored acceptance evidence')
  }
  const normalizedAcceptance = item.acceptance === null ? null : acceptance(item.acceptance, digest)
  if (normalizedAcceptance !== null && (
    !isDeepStrictEqual(normalizedAcceptance.canonical.stack, stack.subject)
    || normalizedAcceptance.canonical.stackSnapshotSha256 !== stack.stackSnapshotSha256
    || jsonObject(normalizedAcceptance.canonical.selectedAsset, 'acceptance.selectedAsset').id !== stack.subject.selectedTakeId
  )) throw new Error('episode evidence: acceptance stack binding mismatch')
  const qc = item.qc === null
    ? null
    : immutableRecords(item.qc, 'jason.qingmu-take-qc-records.v1', 'qc') as YimengEpisodeEvidenceQcRecords
  const lifecycle = item.lifecycle === null
    ? null
    : immutableRecords(item.lifecycle, 'jason.qingmu-take-approval-lifecycle-records.v1', 'lifecycle') as YimengEpisodeEvidenceLifecycleRecords
  const verificationInput = exact(item.verificationInput, ['dialogue', 'visualAtoms', 'directorPlan'], 'verificationInput')
  return {
    frameId, frameNo, stack, comments, review, acceptance: normalizedAcceptance, qc, lifecycle,
    verificationInput,
  }
}

function source(value: unknown, request: YimengEpisodeEvidenceRequest, digest: Digest): YimengEpisodeEvidenceSource {
  const item = exact(value, SOURCE_FIELDS, 'source')
  if (item.schema !== 'jason.qingmu-episode-evidence-source.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId || !Array.isArray(item.frames)) {
    throw new Error('episode evidence: source identity is invalid')
  }
  if (item.frames.length > 500) throw new Error('episode evidence: source frames are invalid')
  let previousFrameNo = 0
  const frames = item.frames.map((entry) => {
    const result = frame(entry, request, digest, previousFrameNo)
    previousFrameNo = result.frameNo
    return result
  })
  const ids = new Set(frames.map(entry => entry.frameId))
  if (ids.size !== frames.length) throw new Error('episode evidence: source frames are duplicated')
  return {
    schema: 'jason.qingmu-episode-evidence-source.v1', ...request, frames,
    verificationInputsSha256: sha(item.verificationInputsSha256, 'source.verificationInputsSha256'),
  }
}

/**
 * Validate a source-pinned evidence ledger without running an episode probe.
 * @param value - Untrusted upstream ledger response.
 * @param request - The requested project and episode.
 * @param digest - The Host RFC 8785 SHA-256 implementation.
 * @returns A scope-bound ledger with verified canonical hashes.
 */
export function normalizeEpisodeEvidenceLedger(
  value: unknown,
  request: YimengEpisodeEvidenceRequest,
  digest: Digest,
): YimengEpisodeEvidenceLedgerResponse {
  const item = exact(value, LEDGER_FIELDS, 'ledger')
  if (item.schema !== 'jason.qingmu-episode-evidence-ledger.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId) {
    throw new Error('episode evidence: ledger identity is invalid')
  }
  const normalizedSource = source(item.source, request, digest)
  const sourceSnapshotSha256 = sha(item.sourceSnapshotSha256, 'sourceSnapshotSha256')
  if (sourceSnapshotSha256 !== digest(normalizedSource, 'episodeEvidence.source')) {
    throw new Error('episode evidence: source snapshot hash mismatch')
  }
  return {
    schema: 'jason.qingmu-episode-evidence-ledger.v1', ...request,
    source: normalizedSource, sourceSnapshotSha256,
  }
}

function report(value: unknown, request: YimengEpisodeEvidenceRequest): YimengEpisodeVerificationReport {
  const item = exact(value, VERIFICATION_FIELDS, 'verification')
  if (item.project_id !== request.projectId || item.episode_id !== request.episodeId
    || typeof item.ok !== 'boolean' || typeof item.technical_ok !== 'boolean' || typeof item.creative_ok !== 'boolean') {
    throw new Error('episode evidence: verification identity or flags are invalid')
  }
  return {
    project_id: request.projectId,
    episode_id: request.episodeId,
    ok: item.ok,
    errors: strings(item.errors, 'verification.errors'),
    warnings: strings(item.warnings, 'verification.warnings'),
    technical_errors: strings(item.technical_errors, 'verification.technical_errors'),
    creative_errors: strings(item.creative_errors, 'verification.creative_errors'),
    technical_ok: item.technical_ok,
    creative_ok: item.creative_ok,
    frame_count: count(item.frame_count, 'verification.frame_count'),
    video_asset_count: count(item.video_asset_count, 'verification.video_asset_count'),
    raw_video_asset_count: count(item.raw_video_asset_count, 'verification.raw_video_asset_count'),
    unverified_video_asset_count: count(item.unverified_video_asset_count, 'verification.unverified_video_asset_count'),
    duplicate_video_asset_count: count(item.duplicate_video_asset_count, 'verification.duplicate_video_asset_count'),
    video_frame_coverage_count: count(item.video_frame_coverage_count, 'verification.video_frame_coverage_count'),
    missing_video_frame_nos: frameNumbers(item.missing_video_frame_nos, 'verification.missing_video_frame_nos'),
    dialogue_asr_required_count: count(item.dialogue_asr_required_count, 'verification.dialogue_asr_required_count'),
    dialogue_asr_verified_count: count(item.dialogue_asr_verified_count, 'verification.dialogue_asr_verified_count'),
    final_delivery_profile: item.final_delivery_profile === null ? null : id(item.final_delivery_profile, 'verification.final_delivery_profile'),
    final_count: count(item.final_count, 'verification.final_count'),
  }
}

/**
 * Validate unmodified canonical verification facts against the requested source.
 * @param value - Untrusted upstream verification response.
 * @param request - The exact requested scope and source snapshot hash.
 * @param digest - The Host RFC 8785 SHA-256 implementation.
 * @returns The original verification facts with verified identity and hashes.
 */
export function normalizeEpisodeVerification(
  value: unknown,
  request: YimengEpisodeVerificationRequest,
  digest: Digest,
): YimengEpisodeVerificationResponse {
  const item = exact(value, VERIFICATION_RESPONSE_FIELDS, 'verification response')
  if (item.schema !== 'jason.qingmu-episode-verification.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.sourceSnapshotSha256 !== request.sourceSnapshotSha256) {
    throw new Error('episode evidence: verification source binding is invalid')
  }
  const verification = report(item.verification, request)
  const verificationSha256 = sha(item.verificationSha256, 'verificationSha256')
  if (verificationSha256 !== digest(verification, 'episodeEvidence.verification')) {
    throw new Error('episode evidence: verification hash mismatch')
  }
  const verifiedAt = id(item.verifiedAt, 'verifiedAt')
  if (!RFC3339.test(verifiedAt) || !Number.isFinite(Date.parse(verifiedAt))) {
    throw new Error('episode evidence: verifiedAt is invalid')
  }
  return { schema: 'jason.qingmu-episode-verification.v1', ...request, verification, verificationSha256, verifiedAt }
}
