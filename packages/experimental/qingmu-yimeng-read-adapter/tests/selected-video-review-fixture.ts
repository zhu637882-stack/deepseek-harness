import type { YimengSelectedVideoReviewRequest, YimengSelectedVideoReviewStatus } from '../src/types.ts'

export const VIDEO_REVIEW_REQUEST = { projectId: 'project-1', episodeId: 'episode-1', frameId: 'frame-a' } as const

/** Existing API shape, including fields intentionally excluded from the Host projection. */
export function videoCandidatesFixture(
  request: YimengSelectedVideoReviewRequest = VIDEO_REVIEW_REQUEST,
  status: YimengSelectedVideoReviewStatus = 'rejected',
) {
  const review = {
    version: 'formal-video-human-review-v1', decision: status, reviewScope: 'full_video', ...request,
    formalVideoAssetId: `video-${request.frameId}`, assetSha256: 'a'.repeat(64), frameUpdatedAt: '2026-08-27T12:00:00Z',
    frameContentSha256: 'b'.repeat(64), storyboardRevision: 3, reviewer: 'reviewer-fixture',
    reviewNote: '保留人物动作，复查怀表位置。',
    reasonCode: status === 'accepted' ? 'formal_video_acceptance' : 'formal_video_rejection',
    idempotencyKey: 'existing-review-fixture', playbackProgress: 1,
    checks: {
      identityContinuityAccepted: true, actionNarrativeAccepted: true,
      audioSubtitleAccepted: true, technicalArtifactsAccepted: true,
    },
    defects: status === 'accepted' ? [] : [
      { defectType: 'costume_prop', timecodeSec: 0, note: '开场怀表位置与上一镜不符。' },
      { defectType: 'temporal_drift', timecodeSec: 1.25, note: '怀表在动作中消失。' },
      { defectType: 'action_performance', timecodeSec: null, note: '动作需要人工复查，未提供具体时间点。' },
    ],
    machineFailureExceptionAccepted: false,
  }
  const blocker = status === 'accepted' ? null : status === 'pending' ? 'formal_video_human_review_required'
    : status === 'stale' ? 'formal_video_human_review_stale'
      : status === 'rejected' ? 'formal_video_human_review_rejected' : 'formal_video_candidate_file_missing'
  return {
    ...request, selectedAssetId: review.formalVideoAssetId,
    items: [{
      assetId: review.formalVideoAssetId, version: 2, isSelected: true, selectionStatus: 'Selected',
      sha256: review.assetSha256, taskId: `task-${request.frameId}`, providerTaskId: 'provider-task-fixture', durationSec: 4,
      createdAt: '2026-08-27T11:00:00Z', updatedAt: '2026-08-27T12:00:00Z', qualityPassed: false,
      videoUrl: 'https://media.invalid/private-video.mp4', thumbnailUrl: 'https://media.invalid/private-thumbnail.png',
      estimatedCny: 9, formalReviewAccepted: status === 'accepted', formalReviewStatus: status,
      formalReviewBlockerCode: blocker, formalReview: status === 'accepted' || status === 'rejected' ? review : null,
    }],
  }
}
