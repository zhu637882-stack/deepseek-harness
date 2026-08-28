import type {
  YimengTakeApprovalLifecycleFeedResponse,
  YimengTakeApprovalLifecycleRequest,
} from '../src/types.ts'
import { takeAcceptanceFixture } from './take-acceptance-fixture.ts'
import { takeVersionSha } from './take-version-fixture.ts'

export const TAKE_APPROVAL_LIFECYCLE_REQUEST: YimengTakeApprovalLifecycleRequest = {
  projectId: 'project-take', episodeId: 'episode-take', frameId: 'frame-take',
}

export function takeApprovalLifecycleFixture(
  request: YimengTakeApprovalLifecycleRequest = TAKE_APPROVAL_LIFECYCLE_REQUEST,
): YimengTakeApprovalLifecycleFeedResponse {
  const subject = takeAcceptanceFixture(request).evidence.subject
  const source: YimengTakeApprovalLifecycleFeedResponse['source'] = {
    schema: 'jason.qingmu-take-approval-lifecycle-source.v1', ...request,
    currentTake: { takeSubject: subject, takeSubjectSha256: takeVersionSha(subject) },
    currentDecision: null, currentAssessment: null, lifecycleHistory: [],
  }
  return {
    schema: 'jason.qingmu-take-approval-lifecycle-feed.v1', ...request,
    source, sourceSnapshotSha256: takeVersionSha(source),
    capabilities: {
      canApprove: true, canRecordInvalidation: true,
      canRequestRework: true, canResubmit: true,
    },
    boundaries: {
      stateRequiresCurrentImagoMethod: true, technicalPassIsContentApproval: false,
      commentIsApproval: false, editIsApproval: false, selectionChanged: false,
      technicalPassChanged: false, reviewDecisionChanged: false, reworkExecuted: false,
      providerCalls: 0, budgetMutation: false, episodeVerificationChanged: false,
      humanSignoffInferred: false, evidenceLedgerMutation: false,
    },
  }
}
