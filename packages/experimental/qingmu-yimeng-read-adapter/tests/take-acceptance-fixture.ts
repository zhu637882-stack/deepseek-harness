import type {
  YimengTakeAcceptanceRequest,
  YimengTakeAcceptanceResponse,
} from '../src/types.ts'
import { TAKE_VERSION_REQUEST, takeVersionSha } from './take-version-fixture.ts'

export const TAKE_ACCEPTANCE_REQUEST: YimengTakeAcceptanceRequest = TAKE_VERSION_REQUEST

/** Create one strict-decode, current-QC, bounded-local acceptance fixture. */
export function takeAcceptanceFixture(
  request: YimengTakeAcceptanceRequest = TAKE_ACCEPTANCE_REQUEST,
): YimengTakeAcceptanceResponse {
  const outputSha256 = '2'.repeat(64)
  const inputHash = '3'.repeat(64)
  const evidence: YimengTakeAcceptanceResponse['evidence'] = {
    subject: {
      schema: 'jason.qingmu-take-acceptance-subject.v1',
      ...request,
      frameNo: 7,
      storyboardRevision: 3,
      frameContentSha256: '1'.repeat(64),
      selectionRevision: 1,
      takeId: 'asset-take-1',
      versionOrdinal: 1,
      selectionStatus: 'Selected',
      outputSha256,
      taskId: 'generation-task-1',
      capability: 'video.generate',
      routeKey: 'b6.video_generation',
      provider: 'bounded-local',
      model: 'deterministic',
      inputHash,
      submitId: 'dryrun-task-1',
    },
    providerReceipt: {
      schema: 'jason.qingmu-provider-submission-receipt-evidence.v1',
      status: 'bounded_local',
      evidenceMode: 'bounded_local',
      actualProviderReceiptVerified: false,
      requestDryRun: true,
      taskRequestHashVerified: true,
      outboxState: null,
      dispatchEpoch: 0,
      dispatchDigest: null,
      payloadSha256: inputHash,
      responseSha256: null,
      providerTaskId: 'dryrun-task-1',
      providerStatus: 'completed',
      localStatus: 'completed',
      providerMediaBindingStatus: 'PASS',
      providerMediaRecordId: 'provider-media-1',
      blockers: ['PROVIDER_RECEIPT_DRY_RUN_ONLY'],
    },
    technicalReceipt: {
      schema: 'jason.qingmu-technical-video-receipt.v1',
      imagoReceiptSchema: 'IMAGO-V6-TechnicalVideoReceipt-v1',
      status: 'PASS',
      media: { bytes: 4096, sha256: outputSha256 },
      fullVideoDecode: {
        required: true,
        commandProfile: 'ffmpeg -v error -xerror -map 0:v:0 -f null -',
        status: 'PASS',
        returncode: 0,
      },
      blockers: [],
      warnings: [],
      video: {
        durationSeconds: 10,
        width: 1280,
        height: 720,
        codecName: 'h264',
        nbFrames: 240,
        avgFrameRate: '24/1',
        rFrameRate: '24/1',
        videoStreamDurationSeconds: 10,
        avgFrameRateDecimal: 24,
        rFrameRateDecimal: 24,
        actualAverageFrameRate: 24,
        actualFrameRateBasis: 'NB_FRAMES_OVER_MEASURED_DURATION_CROSSCHECK_AVG_FRAME_RATE',
        nominalRFrameRateIsActual: false,
      },
      audio: { codecName: 'aac', channels: 2, sampleRate: 48_000 },
    },
    candidateQuality: {
      schema: 'jason.qingmu-take-candidate-quality-evidence.v1',
      status: 'PASS',
      requiredCheckTypes: ['creative_director_execution', 'real_vl_native_video_output'],
      checks: [
        {
          checkId: 'qc-macro', checkType: 'creative_director_execution', passed: true,
          createdAt: '2026-08-28T10:00:00+00:00', current: true,
        },
        {
          checkId: 'qc-micro', checkType: 'real_vl_native_video_output', passed: true,
          createdAt: '2026-08-28T10:00:01+00:00', current: true,
        },
      ],
      missingCheckTypes: [],
      failedOrStaleCheckTypes: [],
    },
  }
  return {
    schema: 'jason.qingmu-take-acceptance-evidence.v1',
    evidence,
    evidenceSnapshotSha256: takeVersionSha(evidence),
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
