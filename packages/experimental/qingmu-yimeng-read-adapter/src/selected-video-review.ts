/** Read existing Yimeng video-review facts without creating an approval authority. */
import type {
  YimengSelectedVideoReviewAsset,
  YimengSelectedVideoReviewRequest,
  YimengSelectedVideoReviewResponse,
  YimengSelectedVideoReviewStatus,
  YimengVideoReviewRecord,
} from './types.ts'

const STATUSES = new Set(['accepted', 'rejected', 'pending', 'stale', 'invalid'])
const REQUIRED_CHECKS = [
  'identityContinuityAccepted', 'actionNarrativeAccepted', 'audioSubtitleAccepted', 'technicalArtifactsAccepted',
]

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('video review: expected object')
  return value as Record<string, unknown>
}

function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\u0000') || (nonempty && value.trim() === '')) {
    throw new Error('video review: invalid string')
  }
  return value
}

function identifier(value: unknown): string {
  const result = text(value, true)
  if (result.length > 256 || result.trim() !== result || /[\r\n]/.test(result)) throw new Error('video review: invalid ID')
  return result
}

function sha(value: unknown): string {
  const result = text(value)
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error('video review: invalid SHA')
  return result
}

function number(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error('video review: invalid number')
  }
  return value
}

function integer(value: unknown): number {
  const result = number(value)
  if (!Number.isSafeInteger(result)) throw new Error('video review: invalid integer')
  return result
}

function optionalText(value: unknown): string | null {
  return value === undefined || value === null ? null : text(value)
}

function reviewRecord(
  value: unknown,
  request: YimengSelectedVideoReviewRequest,
  assetId: string,
  assetSha: string | null,
  status: 'accepted' | 'rejected',
): YimengVideoReviewRecord {
  const review = object(value)
  if (review.version !== 'formal-video-human-review-v1' || review.reviewScope !== 'full_video'
    || review.decision !== status || review.projectId !== request.projectId || review.episodeId !== request.episodeId
    || review.frameId !== request.frameId || review.formalVideoAssetId !== assetId || sha(review.assetSha256) !== assetSha) {
    throw new Error('video review: review subject or decision mismatch')
  }
  const checks = object(review.checks)
  if (Object.values(checks).some(item => typeof item !== 'boolean')) throw new Error('video review: invalid checks')
  const playbackProgress = number(review.playbackProgress, 1)
  if (status === 'accepted' && (playbackProgress < 0.9 || REQUIRED_CHECKS.some(key => checks[key] !== true))) {
    throw new Error('video review: contradictory acceptance')
  }
  const exception = review.machineFailureExceptionAccepted === undefined ? false : review.machineFailureExceptionAccepted
  if (typeof exception !== 'boolean' || (exception && (status !== 'accepted'
    || review.reasonCode !== 'formal_video_machine_failure_exception'))) throw new Error('video review: invalid exception fact')
  const defects = review.defects === undefined || review.defects === null ? null : review.defects
  if (defects !== null && !Array.isArray(defects)) throw new Error('video review: invalid defects')
  return {
    version: 'formal-video-human-review-v1', decision: status, reviewScope: 'full_video', ...request,
    formalVideoAssetId: assetId, assetSha256: sha(review.assetSha256),
    frameUpdatedAt: text(review.frameUpdatedAt, true),
    // Legacy records use Yimeng's existing frame-time binding instead. The Host cannot recompute it from this GET.
    frameContentSha256: review.frameContentSha256 === undefined || review.frameContentSha256 === null
      || review.frameContentSha256 === '' ? null : sha(review.frameContentSha256),
    storyboardRevision: integer(review.storyboardRevision), reviewer: text(review.reviewer, true),
    reviewNote: optionalText(review.reviewNote), reasonCode: optionalText(review.reasonCode), playbackProgress,
    checks: Object.fromEntries(Object.entries(checks)) as Readonly<Record<string, boolean>>,
    defects: defects?.map((value) => {
      const item = object(value)
      return { defectType: text(item.defectType, true), timecodeSec: item.timecodeSec === null ? null : number(item.timecodeSec),
        note: text(item.note) }
    }) ?? null,
    machineFailureExceptionAccepted: exception,
  }
}

function selectedAsset(value: Record<string, unknown>, request: YimengSelectedVideoReviewRequest): YimengSelectedVideoReviewAsset {
  const assetId = identifier(value.assetId)
  const status = text(value.formalReviewStatus)
  if (!STATUSES.has(status) || value.formalReviewAccepted !== (status === 'accepted')) {
    throw new Error('video review: contradictory status')
  }
  const blocker = value.formalReviewBlockerCode === null ? null : text(value.formalReviewBlockerCode, true)
  const expectedBlocker = status === 'accepted' ? null
    : status === 'pending' ? 'formal_video_human_review_required'
      : status === 'stale' ? 'formal_video_human_review_stale'
        : status === 'rejected' ? 'formal_video_human_review_rejected' : blocker
  if (blocker !== expectedBlocker || (status === 'invalid' && (blocker === null
    || ['formal_video_human_review_required', 'formal_video_human_review_stale', 'formal_video_human_review_rejected'].includes(blocker)))) {
    throw new Error('video review: contradictory blocker')
  }
  const assetSha = value.sha256 === null ? null : sha(value.sha256)
  if (status !== 'invalid' && assetSha === null) throw new Error('video review: missing asset SHA')
  const review = status === 'accepted' || status === 'rejected'
    ? reviewRecord(value.formalReview, request, assetId, assetSha, status) : null
  if (review === null && value.formalReview !== null) throw new Error('video review: stale or unavailable record must be absent')
  return {
    assetId, version: integer(value.version), sha256: assetSha,
    taskId: value.taskId === null || value.taskId === '' ? null : identifier(value.taskId),
    providerTaskId: value.providerTaskId === null || value.providerTaskId === '' ? null : identifier(value.providerTaskId),
    durationSec: value.durationSec === null ? null : number(value.durationSec),
    isSelected: true, selectionStatus: 'Selected', formalReviewAccepted: status === 'accepted',
    formalReviewStatus: status as YimengSelectedVideoReviewStatus, formalReviewBlockerCode: blocker, formalReview: review,
  }
}

/**
 * Project only the current selected video's existing review from the video-candidates GET.
 * @param value - upstream response, after the read adapter's token scrubbing and size limit.
 * @param request - exact requested project, episode, and canonical storyboard frame.
 * @returns bounded metadata; no media URLs, authenticated approval claims, or mutation controls.
 */
export function normalizeSelectedVideoReview(
  value: unknown,
  request: YimengSelectedVideoReviewRequest,
): YimengSelectedVideoReviewResponse {
  const root = object(value)
  if (root.projectId !== request.projectId || root.episodeId !== request.episodeId || root.frameId !== request.frameId
    || !Array.isArray(root.items)) throw new Error('video review: root subject mismatch')
  const selectedId = root.selectedAssetId === null ? null : identifier(root.selectedAssetId)
  const ids = new Set<string>()
  const selected: Record<string, unknown>[] = []
  for (const raw of root.items) {
    const item = object(raw)
    const assetId = identifier(item.assetId)
    if (ids.has(assetId) || typeof item.isSelected !== 'boolean'
      || (item.selectionStatus !== null && typeof item.selectionStatus !== 'string')
      || (item.isSelected && item.selectionStatus !== 'Selected')) throw new Error('video review: ambiguous selection')
    ids.add(assetId)
    if (item.isSelected) selected.push(item)
  }
  if ((selectedId === null && selected.length !== 0)
    || (selectedId !== null && (selected.length !== 1 || selected[0]?.assetId !== selectedId))) {
    throw new Error('video review: selected asset mismatch')
  }
  const current = selected[0]
  return {
    schema: 'qingmu.yimeng-selected-video-review.v1', ...request, selectedAssetId: selectedId,
    selected: current === undefined ? null : selectedAsset(current, request),
    readOnly: true, providerCalls: 0, taskMutation: false, budgetMutation: false, humanSignoffInferred: false,
  }
}
