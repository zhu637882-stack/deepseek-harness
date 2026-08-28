import { createHash } from 'node:crypto'
import type {
  YimengTakeVersionRequest,
  YimengTakeVersionStackResponse,
  YimengTakeVersionStackSubject,
} from '../src/types.ts'

export const TAKE_VERSION_REQUEST: YimengTakeVersionRequest = {
  projectId: 'project-take',
  episodeId: 'episode-take',
  frameId: 'frame-take',
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('fixture must be JSON')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}

export function takeVersionSha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

export function takeVersionStackSubject(
  request: YimengTakeVersionRequest = TAKE_VERSION_REQUEST,
): YimengTakeVersionStackSubject {
  return {
    schema: 'jason.qingmu-take-version-stack-subject.v1',
    ...request,
    frameNo: 7,
    storyboardRevision: 3,
    frameContentSha256: '1'.repeat(64),
    selectionRevision: 0,
    selectedTakeId: 'asset-take-1',
    versions: [
      {
        takeId: 'asset-take-1', versionOrdinal: 1, source: 'initial', role: 'b6_video',
        createdAt: '2026-08-28T10:00:00+00:00', updatedAt: '2026-08-28T10:00:01+00:00',
        durationSec: 5.25, estimatedCny: 0.000001, selectionStatus: 'Selected', isSelected: true,
        qualityStatus: 'passed', qualityPassed: true, qualityCheckCount: 1, blockers: [],
        recordedOutputSha256: '2'.repeat(64), outputSha256: '2'.repeat(64),
        outputBindingStatus: 'verified', taskId: 'generation-task-1', provider: 'dashscope',
        model: 'wan2.1-i2v-plus', providerTaskId: 'provider-task-1', routeKey: 'b6.video_generation',
        inputHash: '3'.repeat(64), lineageComplete: true, canAttemptSelection: false,
      },
      {
        takeId: 'asset-take-2', versionOrdinal: 2, source: 'regenerate', role: 'b6_video_regenerate',
        createdAt: '2026-08-28T10:01:00+00:00', updatedAt: '2026-08-28T10:01:01+00:00',
        durationSec: 5.5, estimatedCny: null, selectionStatus: 'Unselected', isSelected: false,
        qualityStatus: 'failed', qualityPassed: false, qualityCheckCount: 2,
        blockers: ['identity_continuity'], recordedOutputSha256: '4'.repeat(64),
        outputSha256: '4'.repeat(64), outputBindingStatus: 'verified',
        taskId: 'generation-task-2', provider: 'dashscope', model: 'wan2.1-i2v-plus',
        providerTaskId: 'provider-task-2', routeKey: 'b6.video_generation.regenerate',
        inputHash: '5'.repeat(64), lineageComplete: true, canAttemptSelection: true,
      },
    ],
  }
}

export function takeVersionStackFixture(
  request: YimengTakeVersionRequest = TAKE_VERSION_REQUEST,
): YimengTakeVersionStackResponse {
  const subject = takeVersionStackSubject(request)
  return {
    schema: 'jason.qingmu-take-version-stack.v1',
    subject,
    stackSnapshotSha256: takeVersionSha(subject),
    capabilities: { canCompare: true, canSelect: true },
    boundaries: {
      takeIdAuthority: 'yimeng.assets.id',
      versionOrdinalPersistence: false,
      versionOrdinalRule: 'created_at_then_asset_id_ascending',
      selectedIsApproval: false,
      formalApprovalChanged: false,
      providerAuthority: 'not_granted',
    },
  }
}
