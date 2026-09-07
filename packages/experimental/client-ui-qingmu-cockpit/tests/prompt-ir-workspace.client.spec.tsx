// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PromptIrWorkspace } from '../src/client/PromptIrWorkspace.tsx'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'
import type { DirectorContextClientPort, NativeDraftProposal } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import {
  readPromptIrEditRecoveryMarker,
  readPromptIrSelectionRecoveryMarker,
} from '../src/client/prompt-ir-recovery.ts'

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'
const STORYBOARD_REVISION_ID = 'storyboard-7'
const FRAME_ID = 'frame-3'
const TARGET_ID = `${STORYBOARD_REVISION_ID}:${FRAME_ID}`
const BASE_ID = 'prompt-ready-4'
const DRAFT_ID = 'prompt-draft-5'
const BASE_VERSION = 4
const DRAFT_VERSION = 5
const BASE_CONTENT_SHA = '1'.repeat(64)
const BASE_SNAPSHOT_SHA = '2'.repeat(64)
const PAYLOAD_SHA = '3'.repeat(64)
const DRAFT_CONTENT_SHA = '4'.repeat(64)
const SELECTED_SNAPSHOT_SHA = '5'.repeat(64)
const PROJECTION_SHA = '6'.repeat(64)
const CANDIDATE_SHA = '7'.repeat(64)
const RECEIPT_SHA = '8'.repeat(64)
const QUOTE_PROJECTION_SHA = 'a'.repeat(64)

const COORDINATES = {
  projectId: PROJECT_ID,
  episodeId: EPISODE_ID,
  storyboardRevisionId: STORYBOARD_REVISION_ID,
  frameId: FRAME_ID,
} as const

const BASE_EDITABLE = {
  imageGenPrompt: '雨夜巷口，中景',
  lastFrameImagePrompt: '人物停在檐下',
  videoGenPrompt: '镜头缓慢前推',
  motionPrompt: '衣摆随风轻动',
  negativePrompt: '畸形手指，水印',
} as const

const CANDIDATE_EDITABLE = {
  ...BASE_EDITABLE,
  videoGenPrompt: '镜头缓慢前推，人物抬眼',
}

const BASE_READ = {
  draft: null,
  schema: 'jason.qingmu-prompt-ir-subject-read.v1',
  subject: {
    schema: 'jason.qingmu-prompt-ir-subject.v1',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    promptIrId: BASE_ID,
    promptIrVersion: BASE_VERSION,
    promptIrContentSha256: BASE_CONTENT_SHA,
    status: 'Ready',
    editableProjection: BASE_EDITABLE,
  },
  baseRevision: BASE_VERSION,
  baseSnapshotSha256: BASE_SNAPSHOT_SHA,
} as const

function frame(status: 'Ready' | 'Draft') {
  return [{
    shotId: 'shot-3',
    name: '雨夜相遇',
    frameId: FRAME_ID,
    promptLineage: status === 'Ready'
      ? {
        storyboardRevisionId: STORYBOARD_REVISION_ID,
        id: BASE_ID,
        version: BASE_VERSION,
        contentSha256: BASE_CONTENT_SHA,
        status,
      }
      : {
        storyboardRevisionId: STORYBOARD_REVISION_ID,
        id: DRAFT_ID,
        version: DRAFT_VERSION,
        contentSha256: DRAFT_CONTENT_SHA,
        status,
      },
  }]
}

function createPort(options: {
  readonly editPostSucceeds?: boolean
  readonly productionFails?: boolean
  readonly noFirstFrameCandidates?: boolean
  readonly videoDispatchBlockers?: readonly string[]
  readonly completedVideo?: boolean
} = {}) {
  let selected = false
  let selectedReadyReads = 0
  const editReceipt = (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1',
    changeSetId: request.changeSetId,
    commandReceiptId: 'edit-receipt-1',
    eventId: 'edit-event-1',
    eventType: 'PromptIrDraftCommitted',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    promptIr: {
      id: DRAFT_ID,
      version: DRAFT_VERSION,
      contentSha256: DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: CANDIDATE_EDITABLE,
    },
    previousReadyPromptIr: {
      id: BASE_ID,
      version: BASE_VERSION,
      contentSha256: BASE_CONTENT_SHA,
      status: 'Ready',
    },
    payloadSha256: request.expectedPayloadSha256,
    idempotencyKey: request.idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T00:00:00.000Z',
  } as const)
  const selectionReceipt = (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-prompt-ir-selection-result.v1',
    changeSetId: 'selection-change-set-1',
    commandReceiptId: 'selection-receipt-1',
    eventId: 'selection-event-1',
    eventType: 'PromptIrSelected',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    targetType: 'prompt_ir',
    targetId: TARGET_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    selectedPromptIr: {
      id: request.draftPromptIrId,
      version: request.draftVersion,
      contentSha256: request.draftContentSha256,
      status: 'Ready',
      editableProjection: CANDIDATE_EDITABLE,
    },
    stalePromptIrIds: [BASE_ID],
    idempotencyKey: request.idempotencyKey,
    changed: true,
    providerCall: false,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T00:01:00.000Z',
  } as const)

  const promptIr = vi.fn(async () => {
    if (!selected) return BASE_READ
    selectedReadyReads += 1
    return {
      ...BASE_READ,
      subject: {
        ...BASE_READ.subject,
        promptIrId: DRAFT_ID,
        promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: selectedReadyReads === 1 ? 'e'.repeat(64) : DRAFT_CONTENT_SHA,
        editableProjection: CANDIDATE_EDITABLE,
      },
      baseRevision: DRAFT_VERSION,
      baseSnapshotSha256: SELECTED_SNAPSHOT_SHA,
    }
  })
  const promptIrMethod = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1',
    projectionSha256: PROJECTION_SHA,
    projection: {
      schema: 'qingmu.imago-prompt-ir-method-projection.v1',
      input_snapshot_sha256: '9'.repeat(64),
      target: {
        projectId: request.projectId,
        episodeId: request.episodeId,
        storyboardRevisionId: request.storyboardRevisionId,
        frameId: request.frameId,
        basePromptIrId: request.basePromptIrId,
        baseVersion: request.baseVersion,
        baseSnapshotSha256: request.baseSnapshotSha256,
        baseContentSha256: request.baseContentSha256,
      },
      normalized_candidate: CANDIDATE_EDITABLE,
      candidate_sha256: CANDIDATE_SHA,
      changed_paths: ['$.videoGenPrompt'],
      blockers: [],
      warnings: ['保持人物动作连续'],
      method_definition: {},
      source_bindings: [],
      field_hints: [{ field: 'videoGenPrompt', guidance: '描述镜头与表演' }],
      checklist: [{ label: '检查动作连续性' }],
      work_order_projection: {},
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      providerCalls: 0,
      workerStarted: false,
      selection_executed: false,
      human_approval_inferred: false,
      human_signoff_inferred: false,
    },
    methodAttestation: {
      schema: 'qingmu.imago-prompt-ir-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256: PROJECTION_SHA,
      inputSnapshotSha256: '9'.repeat(64),
      targetSha256: 'a'.repeat(64),
      baseEditableProjectionSha256: 'b'.repeat(64),
      candidateEditableProjectionSha256: 'c'.repeat(64),
      candidateSha256: CANDIDATE_SHA,
      signature: 'd'.repeat(64),
    },
  } as const))
  const proposePromptIr = vi.fn(async () => ({
    schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
    changeSet: {
      id: 'change-set-1',
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      targetType: 'prompt_ir',
      targetId: TARGET_ID,
      baseRevision: BASE_VERSION,
      baseSnapshotSha256: BASE_SNAPSHOT_SHA,
      payloadSha256: PAYLOAD_SHA,
    },
    nextAction: 'preview',
  } as const))
  const previewPromptIr = vi.fn(async () => ({
    schema: 'jason.qingmu-prompt-ir-preview.v1',
    changeSetId: 'change-set-1',
    target: {
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      storyboardRevisionId: STORYBOARD_REVISION_ID,
      frameId: FRAME_ID,
      targetId: TARGET_ID,
    },
    basePromptIr: {
      id: BASE_ID,
      version: BASE_VERSION,
      contentSha256: BASE_CONTENT_SHA,
      status: 'Ready',
      editableProjection: BASE_EDITABLE,
    },
    candidatePromptIr: {
      id: DRAFT_ID,
      version: DRAFT_VERSION,
      contentSha256: DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: CANDIDATE_EDITABLE,
    },
    promptDiff: {
      changed: true,
      changedPaths: ['$.videoGenPrompt'],
      before: BASE_EDITABLE,
      after: CANDIDATE_EDITABLE,
    },
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  } as const))
  const commitPromptIrEdit = vi.fn(async (request: Record<string, unknown>) => {
    if (options.editPostSucceeds === true) return editReceipt(request)
    throw new Error('edit connection lost')
  })
  const recoverPromptIrEditCommit = vi.fn(async (request: Record<string, unknown>) => ({
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: RECEIPT_SHA,
    receipt: editReceipt(request),
  } as const))
  const workflow = vi.fn(async () => ({
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    shots: { items: frame('Ready') },
  }))
  const selectPromptIr = vi.fn(async () => { throw new Error('selection connection lost') })
  const recoverPromptIrSelection = vi.fn(async (request: Record<string, unknown>) => {
    selected = true
    return {
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: RECEIPT_SHA,
      receipt: selectionReceipt(request),
    } as const
  })
  const firstFrameQuote = vi.fn(async () => ({
    schema: 'jason.qingmu-ready-prompt-ir-first-frame-quote.v1',
    projectId: PROJECT_ID,
    episodeId: EPISODE_ID,
    storyboardRevisionId: STORYBOARD_REVISION_ID,
    frameId: FRAME_ID,
    authoritySnapshot: {
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      contextSchema: 'jason.qingmu-prompt-ir-bootstrap-context.v1',
      storyboard: { id: STORYBOARD_REVISION_ID, version: 7, sourceHash: 'b'.repeat(64) },
      frame: { id: FRAME_ID, title: '镜头一', narrative: '人物等待', visual: '雨夜月台',
        action: '人物抬头', durationSec: 4, dialogueLineIds: [], sceneId: 'scene-1',
        contentSha256: '9'.repeat(64) },
      contextSnapshotSha256: 'c'.repeat(64),
      promptIr: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA, status: 'Ready',
        imagePrompt: BASE_EDITABLE.imageGenPrompt, imagePromptSha256: 'd'.repeat(64) },
      method: { rootPromptIrId: BASE_ID, methodProjectionSha256: 'e'.repeat(64), methodSha256: 'f'.repeat(64),
        methodSourceBindings: [{ kind: 'method', path: 'imago/method.json', sha256: '0'.repeat(64) }],
        bootstrapContextSnapshotSha256: '1'.repeat(64) },
      references: [{ referencePackId: 'pack-1', referencePackSha256: '2'.repeat(64),
        entityDraftId: 'draft-1', entityDraftStatus: 'Accepted',
        humanReview: { status: 'Accepted', source: 'independent_human_review', reviewIdentity: 'review-1',
          reviewedAt: '2026-09-01T00:00:00Z', reviewerUserId: 'reviewer-1' }, role: 'scene',
        elementKind: 'scene', elementId: 'scene-1', assetId: 'asset-1', assetSha256: '3'.repeat(64),
        materializedSha256: '4'.repeat(64), selectionIdentity: 'selection-1', sourceRevisionId: 'source-1',
        qualificationCheckId: 'qualification-1', qualificationKind: 'local_file_integrity',
        rightsRecordSha256: '5'.repeat(64), profileRevision: 1, profileSnapshotSha256: '6'.repeat(64) }],
      referenceExecutionBlockers: [],
      firstFramePreparation: { frameId: FRAME_ID, frameNo: 1, currentAssetId: null,
        generationRequired: true, auditRequired: true,
        auditReason: 'generated_candidate_requires_formal_audit', humanSelectionRequired: true },
    },
    authoritySnapshotSha256: '7'.repeat(64),
    costSourceLock: null,
    costSourceLockSha256: null,
    promptBinding: { readyPromptIrImagePromptSha256: 'd'.repeat(64),
      legacyExecutorPrompt: '当前执行器编译提示词', legacyExecutorPromptSha256: '8'.repeat(64),
      legacyExecutorMatchesReadyPromptIr: false, executorUsesReadyPromptIr: true,
      dispatchCompatible: true, executionBlockers: [], executionBinding: {} },
    authorizationDraft: {
      schema: 'jason.qingmu-ready-prompt-ir-first-frame-authorization-draft.v1',
      target: { projectId: PROJECT_ID, episodeId: EPISODE_ID,
        storyboardRevisionId: STORYBOARD_REVISION_ID, frameId: FRAME_ID, frameTitle: '镜头一' },
      sourceBindings: { authoritySnapshotSha256: '7'.repeat(64), contextSnapshotSha256: 'c'.repeat(64),
        promptIrId: BASE_ID, promptIrVersion: BASE_VERSION, promptIrContentSha256: BASE_CONTENT_SHA,
        promptSha256: 'd'.repeat(64), methodSha256: 'f'.repeat(64), costSourceLockSha256: null,
        referenceMaterializedSha256s: ['4'.repeat(64)], executionBindingSha256: 'a'.repeat(64) },
      route: { provider: 'dashscope', model: 'wan2.2-t2i-flash', capability: 'image.generate',
        routeKey: 'b4.first_frame_generation', calls: 1 },
      cost: { currency: 'CNY', estimatedCny: 0.2, maximumReservationCny: 0.3,
        instanceBudgetWindow: { valid: true, windowId: 'fixture', effectiveCapCny: 1,
          lifetimeSpentCny: 0, windowRemainingCny: 1, errors: [] },
        crossInstanceCumulativeKnown: false, crossInstanceCumulativeCny: null },
      providerMedia: { referenceCount: 1, status: 'public_https_static_pass',
        staticConditionPassed: true, downloadVerified: false, blockerCode: null },
      blockers: [{ code: 'budget_cross_instance_cumulative_unknown', category: 'budget_unknown_fee',
        userAction: '请先核对易梦费用账本与本次预算窗口，再单独授权。',
        technicalDetail: 'budget_cross_instance_cumulative_unknown' }],
      authorizationRecorded: false, taskCreated: false, submitted: false, charged: false,
      providerCalls: 0, draftSha256: 'b'.repeat(64),
    },
    scope: { frameCount: 1, imagesPerFrame: 1, resolution: '720P' },
    quote: { frameId: FRAME_ID, frameNo: 1, calls: 1, estimatedCny: 0.2, capability: 'image.generate',
      routeKey: 'b4.first_frame_generation', provider: 'dashscope', model: 'wan2.2-t2i-flash', pricingVerified: true },
    quoteReady: true,
    blockers: [],
    readOnly: true,
    providerCalls: 0,
    budgetMutation: false,
    taskMutation: false,
    mediaMutation: false,
    submitted: false,
    charged: false,
    authorizationRecorded: false,
    taskCreated: false,
    projectionSha256: QUOTE_PROJECTION_SHA,
  } as const))
  const queueProductionTake = vi.fn(async (request: {
    readonly takeOrdinal: 1 | 2
    readonly takeKind: 'initial' | 'targeted_rework'
  }) => {
    if (options.productionFails === true) throw new Error('current PromptIR Method is unavailable')
    return {
      schema: 'qingmu.production-take-host-result.v1',
      method: {
        projectionSha256: '1'.repeat(64), fieldMappingSha256: '2'.repeat(64),
        fields: [
          ['imageGenPrompt', ['D']], ['lastFrameImagePrompt', ['D']], ['videoGenPrompt', ['E']],
          ['motionPrompt', ['E']], ['negativePrompt', ['D', 'E']],
        ].map(([field, stageIds]) => ({ field, stageIds, contractSha256s: ['3'.repeat(64)],
          cardSha256s: ['4'.repeat(64)], sourceSha256s: ['5'.repeat(64)], hintSha256: '6'.repeat(64) })),
      },
      receipt: {
        schema: 'jason.qingmu-writer-production-take.v1', projectId: PROJECT_ID, episodeId: EPISODE_ID,
        sceneId: 'scene-1', shotId: FRAME_ID, storyboardRevisionId: STORYBOARD_REVISION_ID,
        promptIr: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA, videoPromptSha256: '7'.repeat(64) },
        authoritySnapshotSha256: '8'.repeat(64), firstFrameQuoteProjectionSha256: '9'.repeat(64),
        firstFrameSelectionReceiptSha256: 'f'.repeat(64), selectedFirstFrameAssetId: 'asset-first-frame-1',
        selectedFirstFrameMaterializedSha256: 'e'.repeat(64), videoPreflightSha256: 'd'.repeat(64),
        videoQuoteProjectionSha256: 'c'.repeat(64), maximumReservationCny: 0.3, candidateCount: 1,
        maxAttempts: 1, selectAsOfficial: false, paidConfirmed: true, paidConfirmationTextSha256: 'b'.repeat(64),
        referenceBindings: [{
          elementKind: 'scene', elementId: 'scene-1', assetId: 'asset-1', assetSha256: 'a'.repeat(64),
          materializedSha256: 'b'.repeat(64), selectionIdentity: 'selection-1', sourceRevisionId: 'source-1',
          referencePackSha256: 'c'.repeat(64),
        }], takeKind: request.takeKind,
        takeOrdinal: request.takeOrdinal, takeLimit: 2, taskId: `task-${request.takeOrdinal}`, taskStatus: 'queued',
        requestIdempotencyKey: `request-${request.takeOrdinal}`, idempotencyKey: `writer-${request.takeOrdinal}`,
        deduplicated: false, recovered: false, queued: true,
      },
      providerCalls: 0, workerStarted: false, maximumCostCny: '0',
    } as const
  })
  const videoQuote = vi.fn(async () => ({
    schema: 'jason.qingmu-writer-video-quote.v1', preflightSha256: 'd'.repeat(64), projectionSha256: 'c'.repeat(64),
    maximumReservationCny: 0.3, candidateCount: 1, maxAttempts: 1, selectAsOfficial: false,
    quoteReady: true, dispatchReady: false, quoteBlockers: [], dispatchBlockers: options.videoDispatchBlockers ?? ['operator_paid_confirmation_required'],
    requiredPaidConfirmationText: '我确认本次镜头视频生成最高费用为 0.3000 CNY。', requiredPaidConfirmationTextSha256: 'b'.repeat(64),
  } as const))
  let firstFrameSelected = options.firstFrameSelected === true
  let firstFrameIdempotencyKey = 'first-frame-select-1'
  const firstFrameReceipt = () => ({ schema: 'jason.qingmu-first-frame-selection-receipt.v1', selectionIdentity: 'selection-first-1', actorUserId: 'actor-1', naturalPersonId: 'person-1', projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID, frameId: FRAME_ID, selectedAssetId: 'asset-first-frame-1', selectedAssetSha256: 'e'.repeat(64), selectedMaterializedSha256: 'e'.repeat(64), selectionStatus: 'Selected', idempotencyKey: firstFrameIdempotencyKey, requestSha256: 'a'.repeat(64), intentSessionSha256: 'b'.repeat(64), intentBindingSha256: 'c'.repeat(64), binding: {}, bindingSha256: 'd'.repeat(64), selectedAt: '2026-09-02T00:00:00Z', receiptSha256: 'f'.repeat(64) } as const)
  const firstFrameState = () => ({ schema: 'jason.qingmu-first-frame-selection-state.v1', projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID, frameId: FRAME_ID, frameUpdatedAt: '2026-09-02T00:00:00Z', storyboardRevision: 7, identity: { state: 'bound' }, candidates: options.noFirstFrameCandidates ? [] : [{ assetId: 'asset-first-frame-1', assetSha256: 'e'.repeat(64), materializedSha256: 'e'.repeat(64), qualityStatus: 'passed', selectionStatus: firstFrameSelected ? 'Selected' : 'Unselected', isSelected: firstFrameSelected, assetUpdatedAt: '2026-09-02T00:00:00Z' }], selectedAssetId: firstFrameSelected ? 'asset-first-frame-1' : null, selectionReceipt: firstFrameSelected ? firstFrameReceipt() : null, blockers: [], providerCalls: 0, taskMutation: false, outboxEvents: 0 })
  const browserFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    if (url.includes('/video-state?')) return Response.json({ projectId: PROJECT_ID, episodeId: EPISODE_ID, frameId: FRAME_ID,
      taskId: options.completedVideo ? 'historical-task' : null, kernelStatus: options.completedVideo ? 'Succeeded' : null,
      takeCount: options.completedVideo ? 1 : 0, nextTakeOrdinal: options.completedVideo ? 2 : 1 })
    if (url.includes('/decision?')) { firstFrameIdempotencyKey = new URL(url, 'http://localhost').searchParams.get('idempotencyKey') ?? ''; firstFrameSelected = true; return new Response(JSON.stringify(firstFrameReceipt()), { status: 200 }) }
    if (url.includes('/receipt?')) return new Response(JSON.stringify(firstFrameReceipt()), { status: 200 })
    if (url.includes('/media?')) return new Response(JSON.stringify({ projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID, frameId: FRAME_ID, assetId: 'asset-first-frame-1', materializedSha256: 'e'.repeat(64), mimeType: 'image/png', base64: 'aGVsbG8=' }), { status: 200 })
    return new Response(JSON.stringify(firstFrameState()), { status: 200 })
  })
  vi.stubGlobal('fetch', browserFetch)

  return {
    port: {
      promptIr,
      promptIrMethod,
      proposePromptIr,
      previewPromptIr,
      commitPromptIrEdit,
      recoverPromptIrEditCommit,
      workflow,
      selectPromptIr,
      recoverPromptIrSelection,
      firstFrameQuote,
      videoQuote,
      queueProductionTake,
    } as unknown as QingmuYimengPort,
    spies: {
      promptIr,
      promptIrMethod,
      proposePromptIr,
      previewPromptIr,
      commitPromptIrEdit,
      recoverPromptIrEditCommit,
      workflow,
      selectPromptIr,
      recoverPromptIrSelection,
      firstFrameQuote,
      videoQuote,
      browserFetch,
      queueProductionTake,
    },
  }
}

const t = ((key: keyof typeof zh) => zh[key])

async function prepareProductionTake(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: zh.firstFrameQuoteAction }))
  await screen.findByText(zh.firstFrameCandidatesTitle)
  fireEvent.click(screen.getByRole('checkbox', { name: zh.firstFrameCandidateConfirm }))
  fireEvent.click(screen.getByRole('button', { name: zh.firstFrameSelect }))
  await screen.findByText(new RegExp(zh.firstFrameSelectionReceipt))
  fireEvent.click(screen.getByRole('button', { name: zh.videoQuoteRead }))
  await screen.findByText(`${zh.videoPaidConfirmation}：我确认本次镜头视频生成最高费用为 0.3000 CNY。`)
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认本次镜头视频生成最高费用为 0.3000 CNY。' }))
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('PromptIrWorkspace vertical slice', () => {
  it('adopts a native suggestion locally, then uses existing method/preview/commit and authoritative draft reread', async () => {
    const { port, spies } = createPort({ editPostSucceeds: true })
    const scope = { projectId: PROJECT_ID, episodeId: EPISODE_ID, sceneId: 'scene-1', shotId: FRAME_ID }
    const suggestion = { schema: 'qingmu.native-draft-proposal.v1', field: 'videoGenPrompt',
      before: BASE_EDITABLE.videoGenPrompt, after: CANDIDATE_EDITABLE.videoGenPrompt, reason: '按人物反应推进镜头。',
      input: { receiptId: 'f'.repeat(64), scope, bindingSeq: 0, baseRevision: BASE_VERSION, baseSnapshotSha256: BASE_SNAPSHOT_SHA,
        storyboardRevisionId: STORYBOARD_REVISION_ID, frameId: FRAME_ID, draftSnapshotSha256: null } } as NativeDraftProposal
    const readNativeDraftProposal = vi.fn(async () => ({ status: 'current', proposal: suggestion }))
    const bridge = { readNativeDraftProposal } as unknown as DirectorContextClientPort
    let saved = false
    const canonicalDraft = { status: 'current', reason: null,
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: DRAFT_ID, promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: DRAFT_CONTENT_SHA, editableProjection: CANDIDATE_EDITABLE },
      subjectSnapshotSha256: CANDIDATE_SHA, baseBinding: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA } }
    const promptRead = vi.fn(async () => saved ? { ...BASE_READ, draft: canonicalDraft } : BASE_READ)
    const livePort = { ...port, promptIr: promptRead, commitPromptIrEdit: async (...args: Parameters<QingmuYimengPort['commitPromptIrEdit']>) => {
      const result = await port.commitPromptIrEdit(...args); saved = true; return result
    } } as unknown as QingmuYimengPort
    const onCommitted = vi.fn(async () => {})
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={livePort} t={t}
      onCommitted={onCommitted} presentation="director" nativeDirector={{ bridge, sessionId: 'native-session', scope }} />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.click(screen.getByRole('button', { name: zh.nativeDraftRead }))
    fireEvent.click(await screen.findByRole('button', { name: zh.nativeDraftAdopt }))
    await screen.findByText(zh.nativeDraftAdopted)
    expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
    expect(readNativeDraftProposal).toHaveBeenCalledTimes(2)
    expect(spies.commitPromptIrEdit).not.toHaveBeenCalled()
    expect(spies.proposePromptIr).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    await screen.findByText(/描述镜头与表演/)
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrPreparePreview }))
    await waitFor(() => { expect(spies.previewPromptIr).toHaveBeenCalledTimes(1) })
    fireEvent.click(await screen.findByRole('checkbox', { name: zh.promptIrEditConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCommitEdit }))
    await waitFor(() => { expect(onCommitted).toHaveBeenCalledTimes(1) })
    expect(promptRead).toHaveBeenCalledTimes(2)
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
    expect(spies.queueProductionTake).not.toHaveBeenCalled()
    expect(spies.selectPromptIr).not.toHaveBeenCalled()
    expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
  })
  it('shows one Ready-bound first-frame quote without offering submission', async () => {
    const { port, spies } = createPort()
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={port} t={t}
      onCommitted={vi.fn(async () => {})} />)
    await screen.findByLabelText(zh.promptIrDraftLabel)
    fireEvent.click(screen.getByRole('button', { name: zh.firstFrameQuoteAction }))
    await screen.findByText('dashscope / wan2.2-t2i-flash')
    expect(screen.getByText('¥0.2000')).toBeTruthy()
    expect(screen.getByText('¥0.3000')).toBeTruthy()
    expect(screen.getByText(zh.firstFrameAuthorizationFlags)).toBeTruthy()
    expect(screen.getByText(zh.firstFrameProviderMediaStaticPass)).toBeTruthy()
    expect(screen.getByText('请先核对易梦费用账本与本次预算窗口，再单独授权。')).toBeTruthy()
    expect(screen.queryByText(zh.firstFrameQuoteExecutorBlocked)).toBeNull()
    expect(screen.getByText('当前执行器编译提示词')).toBeTruthy()
    expect(screen.getByText(zh.firstFrameQuoteNotSubmitted)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /确认生成|提交首帧|付费生成/ })).toBeNull()
    expect(spies.firstFrameQuote).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      storyboardRevisionId: STORYBOARD_REVISION_ID,
      frameId: FRAME_ID,
      promptIrId: BASE_ID,
      promptIrVersion: BASE_VERSION,
      promptIrContentSha256: BASE_CONTENT_SHA,
    }, expect.any(AbortSignal))
    expect(spies.firstFrameQuote).toHaveBeenCalledTimes(1)
  })

  it('shows the real no-candidate blocker without offering an implicit selection', async () => {
    const { port } = createPort({ noFirstFrameCandidates: true })
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID}
      shotItems={frame('Ready')} storyboardRevisionId={STORYBOARD_REVISION_ID} selectedShotId={FRAME_ID}
      onSelectShotId={vi.fn()} port={port} t={t} onCommitted={async () => {}} presentation="director" />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.click(screen.getByRole('button', { name: zh.firstFrameQuoteAction }))
    await screen.findByText(zh.firstFrameNoCandidates)
    expect(screen.queryByRole('button', { name: zh.firstFrameSelect })).toBeNull()
  })

  it('unlocks a proven historical commit when a newer Draft is current, retaining text for explicit rebase', async () => {
    const { port, spies } = createPort()
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={port} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.change(input, { target: { value: CANDIDATE_EDITABLE.videoGenPrompt } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    fireEvent.click(await screen.findByRole('button', { name: zh.promptIrPreparePreview }))
    fireEvent.click(await screen.findByRole('checkbox', { name: zh.promptIrEditConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCommitEdit }))
    const recover = await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    await waitFor(() => { expect((recover as HTMLButtonElement).disabled).toBe(false) })
    const latest = { ...BASE_READ, draft: { status: 'current', reason: null,
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: 'newer-draft', promptIrVersion: DRAFT_VERSION + 1,
        promptIrContentSha256: 'b'.repeat(64), editableProjection: { ...BASE_EDITABLE, videoGenPrompt: '其他会话新稿' } },
      subjectSnapshotSha256: 'c'.repeat(64), baseBinding: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA } } }
    spies.promptIr.mockResolvedValueOnce(latest as unknown as typeof BASE_READ)
    fireEvent.click(recover)
    await screen.findByText(zh.directorHistoricalCommitted)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('none')
    expect(screen.queryByRole('button', { name: zh.promptIrRecoverEdit })).toBeNull()
    expect((input as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
    expect(screen.getByRole('button', { name: zh.directorRebase })).toBeTruthy()
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved text in memory when recovery storage fails and blocks destructive reread', async () => {
    const { port, spies } = createPort()
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={port} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      fireEvent.change(input, { target: { value: '必须保留的文字' } })
      await screen.findByText(zh.directorStorageError)
      fireEvent.click(screen.getByRole('button', { name: zh.promptIrReload }))
      expect((input as HTMLTextAreaElement).value).toBe('必须保留的文字')
      expect(spies.promptIr).toHaveBeenCalledTimes(1)
    } finally { storage.mockRestore() }
  })

  it('explicitly rebases a stale saved Draft and binds its exact source in the proposal', async () => {
    const { port, spies } = createPort()
    const saved = { status: 'stale', reason: 'prompt_ir_base_snapshot_conflict',
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: DRAFT_ID, promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: DRAFT_CONTENT_SHA, editableProjection: CANDIDATE_EDITABLE },
      subjectSnapshotSha256: CANDIDATE_SHA, baseBinding: { id: 'previous-ready', version: 1, contentSha256: BASE_CONTENT_SHA } }
    const readPort = { ...port, promptIr: vi.fn(async () => ({ ...BASE_READ, draft: saved })) } as unknown as QingmuYimengPort
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={readPort} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    await screen.findByText(zh.directorStaleDraft)
    expect((screen.getByRole('button', { name: zh.promptIrCheckMethod }) as HTMLButtonElement).disabled).toBe(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try { fireEvent.click(screen.getByRole('button', { name: zh.directorRebase })) }
    finally { confirm.mockRestore() }
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    fireEvent.click(await screen.findByRole('button', { name: zh.promptIrPreparePreview }))
    await waitFor(() => { expect(spies.proposePromptIr).toHaveBeenCalledTimes(1) })
    expect(spies.proposePromptIr).toHaveBeenCalledWith(
      expect.objectContaining({ baseDraftSnapshotSha256: CANDIDATE_SHA }), expect.any(AbortSignal),
    )
    expect(spies.selectPromptIr).not.toHaveBeenCalled()
    expect(spies.commitPromptIrEdit).not.toHaveBeenCalled()
  })

  it('edits normal fields and restores only scoped unsaved text; source drift prevents saves', async () => {
    const { port, spies } = createPort()
    const props = { projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID,
      shotItems: frame('Ready'), selectedShotId: FRAME_ID, onSelectShotId: vi.fn(), port, t, onCommitted: vi.fn(async () => {}),
      presentation: 'director' as const, onUnsavedChange: vi.fn() }
    const view = render(<PromptIrWorkspace {...props} />)
    const input = await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.change(input, { target: { value: '未保存的完整提示词' } })
    await screen.findByText(zh.directorUnsaved)
    view.unmount()
    const restored = render(<PromptIrWorkspace {...props} />)
    await waitFor(() => { expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe('未保存的完整提示词') })
    expect(spies.commitPromptIrEdit).not.toHaveBeenCalled()
    restored.unmount()
    spies.promptIr.mockResolvedValueOnce({ ...BASE_READ, baseSnapshotSha256: 'f'.repeat(64) })
    render(<PromptIrWorkspace {...props} />)
    await screen.findByText(zh.directorStaleDraft)
    expect((screen.getByRole('button', { name: zh.promptIrCheckMethod }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe('未保存的完整提示词')
  })

  it('reads canonical saved Draft text separately from Ready and never offers promotion in director mode', async () => {
    const { port } = createPort()
    const saved = { status: 'current', reason: null,
      subject: { ...BASE_READ.subject, status: 'Draft', promptIrId: DRAFT_ID, promptIrVersion: DRAFT_VERSION,
        promptIrContentSha256: DRAFT_CONTENT_SHA, editableProjection: CANDIDATE_EDITABLE },
      subjectSnapshotSha256: CANDIDATE_SHA, baseBinding: { id: BASE_ID, version: BASE_VERSION, contentSha256: BASE_CONTENT_SHA } }
    const readPort = { ...port, promptIr: vi.fn(async () => ({ ...BASE_READ, draft: saved })) } as unknown as QingmuYimengPort
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID} storyboardRevisionId={STORYBOARD_REVISION_ID}
      shotItems={frame('Ready')} selectedShotId={FRAME_ID} onSelectShotId={vi.fn()} port={readPort} t={t}
      onCommitted={vi.fn(async () => {})} presentation="director" />)
    await waitFor(() => {
      expect((screen.getByLabelText(zh.directorVideoPrompt) as HTMLTextAreaElement).value).toBe(CANDIDATE_EDITABLE.videoGenPrompt)
    })
    expect(screen.queryByRole('button', { name: zh.promptIrSelect })).toBeNull()
    expect(screen.getByText(BASE_EDITABLE.videoGenPrompt)).toBeTruthy()
    expect(sessionStorage.length).toBe(0)
  })

  it('recovers unknown POSTs without resubmission and keeps Draft selectable after refresh', async () => {
    const { port, spies } = createPort()
    const onCommitted = vi.fn(async () => {})
    const first = render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={onCommitted}
      />,
    )

    const editor = await screen.findByLabelText(zh.promptIrDraftLabel)
    await waitFor(() => { expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(BASE_EDITABLE, null, 2)) })
    fireEvent.change(editor, { target: { value: JSON.stringify(CANDIDATE_EDITABLE, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))

    await screen.findByText(/描述镜头与表演/)
    screen.getByText('检查动作连续性')
    screen.getByText('$.videoGenPrompt')
    screen.getByText('保持人物动作连续')
    expect(spies.proposePromptIr).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrPreparePreview }))
    await screen.findByText(DRAFT_ID)
    expect(spies.proposePromptIr).toHaveBeenCalledTimes(1)
    expect(spies.previewPromptIr).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox', { name: zh.promptIrEditConfirm }))
    const editButton = screen.getByRole('button', { name: zh.promptIrCommitEdit })
    fireEvent.click(editButton)
    await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(spies.commitPromptIrEdit.mock.calls[0]![0] as object, 'schema')).toBe(false)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect((editButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(editButton)
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrRecoverEdit }))
    await screen.findByText(zh.promptIrDraftCommitted)
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(1)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(spies.workflow).not.toHaveBeenCalled()
    expect(onCommitted).toHaveBeenCalledTimes(1)
    expect(spies.selectPromptIr).not.toHaveBeenCalled()

    first.unmount()
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={onCommitted}
      />,
    )

    const editRecoveryButton = await screen.findByRole('button', { name: zh.promptIrRecoverEdit })
    expect(spies.promptIr).toHaveBeenCalledTimes(2)
    fireEvent.click(editRecoveryButton)
    const selectionConfirm = await screen.findByRole('checkbox', { name: zh.promptIrSelectionConfirm })
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(2)
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(onCommitted).toHaveBeenCalledTimes(2)
    fireEvent.click(selectionConfirm)
    const selectionButton = screen.getByRole('button', { name: zh.promptIrSelect })
    expect(selectionButton.textContent).not.toBe(zh.promptIrCommitEdit)
    fireEvent.click(selectionButton)
    await screen.findByRole('button', { name: zh.promptIrRecoverSelection })
    expect(spies.selectPromptIr).toHaveBeenCalledTimes(1)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('ready')
    fireEvent.click(selectionButton)
    expect(spies.selectPromptIr).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: zh.promptIrRecoverSelection }))
    await waitFor(() => { expect(spies.promptIr).toHaveBeenCalledTimes(3) })
    expect(spies.recoverPromptIrSelection).toHaveBeenCalledTimes(1)
    const recoveredSelectionRequest = spies.recoverPromptIrSelection.mock.calls[0]![0] as object
    expect(Object.hasOwn(recoveredSelectionRequest, 'schema')).toBe(false)
    expect(Object.hasOwn(recoveredSelectionRequest, 'changeSetId')).toBe(false)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('ready')
    expect(screen.queryByText(zh.promptIrSelectedReady)).toBeNull()
    expect(onCommitted).toHaveBeenCalledTimes(2)

    const selectionRecoveryButton = screen.getByRole('button', { name: zh.promptIrRecoverSelection })
    await waitFor(() => { expect((selectionRecoveryButton as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(selectionRecoveryButton)
    await screen.findByText(zh.promptIrSelectedReady)
    expect(spies.recoverPromptIrSelection).toHaveBeenCalledTimes(2)
    expect(spies.promptIr).toHaveBeenCalledTimes(4)
    expect(readPromptIrSelectionRecoveryMarker(COORDINATES).status).toBe('none')
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('none')
    expect(onCommitted).toHaveBeenCalledTimes(3)
  })

  it('authoritatively rereads a successful edit POST before exposing the Draft', async () => {
    const { port, spies } = createPort({ editPostSucceeds: true })
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    const editor = await screen.findByLabelText(zh.promptIrDraftLabel)
    await waitFor(() => { expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(BASE_EDITABLE, null, 2)) })
    fireEvent.change(editor, { target: { value: JSON.stringify(CANDIDATE_EDITABLE, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCheckMethod }))
    await screen.findByText(/描述镜头与表演/)
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrPreparePreview }))
    await screen.findByText(DRAFT_ID)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.promptIrEditConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.promptIrCommitEdit }))

    await screen.findByText(zh.promptIrDraftCommitted)
    expect(spies.commitPromptIrEdit).toHaveBeenCalledTimes(1)
    expect(spies.recoverPromptIrEditCommit).toHaveBeenCalledTimes(1)
    expect(spies.workflow).not.toHaveBeenCalled()
    expect(readPromptIrEditRecoveryMarker(COORDINATES).status).toBe('ready')
    screen.getByRole('checkbox', { name: zh.promptIrSelectionConfirm })
  })

  it('emits the canonical frame-backed Shot ID from its controlled selector', async () => {
    const { port } = createPort()
    const onSelectShotId = vi.fn()
    const secondFrameId = 'frame-4'
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={[
          ...frame('Ready'),
          {
            ...frame('Ready')[0],
            frameId: secondFrameId,
            name: '走廊回望',
          },
        ]}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId={FRAME_ID}
        onSelectShotId={onSelectShotId}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    const selector = await screen.findByRole('combobox', { name: zh.promptIrFrame })
    fireEvent.change(selector, { target: { value: secondFrameId } })
    expect(onSelectShotId).toHaveBeenCalledWith(secondFrameId)
  })

  it('does not fall back to another PromptIR when the selected Shot is unavailable', async () => {
    const { port, spies } = createPort()
    render(
      <PromptIrWorkspace
        projectId={PROJECT_ID}
        episodeId={EPISODE_ID}
        shotItems={frame('Ready')}
        storyboardRevisionId={STORYBOARD_REVISION_ID}
        selectedShotId="missing-shot"
        onSelectShotId={vi.fn()}
        port={port}
        t={t}
        onCommitted={async () => {}}
      />,
    )

    expect(await screen.findByText(zh.promptIrSelectedShotUnavailable)).toBeTruthy()
    expect(spies.promptIr).not.toHaveBeenCalled()
  })

  it('requires explicit Ready confirmation, suppresses double-click, and stops at Take 2', async () => {
    const { port, spies } = createPort()
    const onCommitted = vi.fn(async () => {})
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID}
      shotItems={frame('Ready')} storyboardRevisionId={STORYBOARD_REVISION_ID} selectedShotId={FRAME_ID}
      onSelectShotId={vi.fn()} port={port} t={t} onCommitted={onCommitted} presentation="director" />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    const takeOne = screen.getByRole('button', { name: zh.productionTakeOne }) as HTMLButtonElement
    expect(takeOne.disabled).toBe(true)
    await prepareProductionTake()
    fireEvent.click(takeOne)
    fireEvent.click(takeOne)
    await screen.findByText(zh.productionTakeQueued)
    expect(spies.queueProductionTake).toHaveBeenCalledTimes(1)
    expect(onCommitted).toHaveBeenCalledExactlyOnceWith()
    expect(spies.queueProductionTake).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID,
      frameId: FRAME_ID, takeKind: 'initial', takeOrdinal: 1, confirmReady: true,
      firstFrameSelectionReceiptSha256: 'f'.repeat(64), selectedFirstFrameAssetId: 'asset-first-frame-1',
      selectedFirstFrameMaterializedSha256: 'e'.repeat(64), videoPreflightSha256: 'd'.repeat(64),
      videoQuoteProjectionSha256: 'c'.repeat(64), maximumReservationCny: 0.3, candidateCount: 1,
      maxAttempts: 1, selectAsOfficial: false, paidConfirmed: true,
      paidConfirmationText: '我确认本次镜头视频生成最高费用为 0.3000 CNY。',
    }), expect.any(AbortSignal))
    const browserIntent = spies.queueProductionTake.mock.calls[0]![0] as Record<string, unknown>
    for (const forbidden of ['ownerId', 'ready', 'selected', 'approved', 'force', 'provider', 'model', 'route']) {
      expect(browserIntent).not.toHaveProperty(forbidden)
    }
    expect((screen.getByRole('button', { name: zh.productionTakeThree }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认本次镜头视频生成最高费用为 0.3000 CNY。' }))
    fireEvent.click(screen.getByRole('button', { name: zh.productionTakeTwo }))
    await screen.findByText('2 / 2')
    expect(spies.queueProductionTake).toHaveBeenCalledTimes(2)
    expect(screen.getByText(zh.productionTakeNotGenerated)).toBeTruthy()
  })

  it('keeps Production Take disabled when video dispatch has any blocker beyond the exact paid confirmation', async () => {
    const { port, spies } = createPort({ videoDispatchBlockers: ['operator_paid_confirmation_required', 'reference_not_ready'] })
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID}
      shotItems={frame('Ready')} storyboardRevisionId={STORYBOARD_REVISION_ID} selectedShotId={FRAME_ID}
      onSelectShotId={vi.fn()} port={port} t={t} onCommitted={async () => {}} presentation="director" />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    fireEvent.click(screen.getByRole('button', { name: zh.firstFrameQuoteAction }))
    await screen.findByText(zh.firstFrameCandidatesTitle)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.firstFrameCandidateConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.firstFrameSelect }))
    await screen.findByText(new RegExp(zh.firstFrameSelectionReceipt))
    fireEvent.click(screen.getByRole('button', { name: zh.videoQuoteRead }))
    await screen.findByText(`${zh.videoDispatchBlockers}：operator_paid_confirmation_required, reference_not_ready`)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '我确认本次镜头视频生成最高费用为 0.3000 CNY。' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.productionTakeOne }).disabled).toBe(true)
    expect(spies.queueProductionTake).not.toHaveBeenCalled()
  })

  it('shooting recovery replays the original intent despite an unsaved local draft', async () => {
    const failed = createPort({ productionFails: true })
    const props = { projectId: PROJECT_ID, episodeId: EPISODE_ID, shotItems: frame('Ready'),
      storyboardRevisionId: STORYBOARD_REVISION_ID, selectedShotId: FRAME_ID, onSelectShotId: vi.fn(),
      t, onCommitted: async () => {} }
    const view = render(<PromptIrWorkspace {...props} presentation="director" port={failed.port} />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    await prepareProductionTake()
    fireEvent.click(screen.getByRole('button', { name: zh.productionTakeOne }))
    await screen.findByText('current PromptIR Method is unavailable')
    const original = failed.spies.queueProductionTake.mock.calls[0]![0]
    fireEvent.change(screen.getByLabelText(zh.directorVideoPrompt), { target: { value: '未提交的新要求，不能覆盖原任务' } })
    const recovered = createPort()
    view.rerender(<PromptIrWorkspace {...props} presentation="shooting" port={recovered.port} />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复同一任务' }))
    await waitFor(() => expect(recovered.spies.queueProductionTake).toHaveBeenCalledTimes(1))
    expect(recovered.spies.queueProductionTake.mock.calls[0]![0]).toEqual(original)
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复同一任务' })).toBeNull())
  })

  it('native shooting rework uses Writer next ordinal, not initial or a cached receipt', async () => {
    const { port, spies } = createPort({ completedVideo: true, firstFrameSelected: true })
    render(<PromptIrWorkspace projectId={PROJECT_ID} episodeId={EPISODE_ID}
      shotItems={frame('Ready')} storyboardRevisionId={STORYBOARD_REVISION_ID} selectedShotId={FRAME_ID}
      onSelectShotId={vi.fn()} port={port} t={t} onCommitted={async () => {}} presentation="shooting" />)
    await waitFor(() => expect(spies.promptIr).toHaveBeenCalled())
    const button = await screen.findByRole('button', { name: '重新生成视频' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(spies.queueProductionTake).toHaveBeenCalledTimes(1))
    expect(spies.queueProductionTake.mock.calls[0]![0]).toMatchObject({ takeOrdinal: 2, takeKind: 'targeted_rework' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新生成视频' })).toBeNull())
  })

  it('keeps an unknown-result marker across refresh and recovers with the original intent', async () => {
    const failed = createPort({ productionFails: true })
    const props = { projectId: PROJECT_ID, episodeId: EPISODE_ID, shotItems: frame('Ready'),
      storyboardRevisionId: STORYBOARD_REVISION_ID, selectedShotId: FRAME_ID, onSelectShotId: vi.fn(),
      t, onCommitted: async () => {}, presentation: 'director' as const }
    const first = render(<PromptIrWorkspace {...props} port={failed.port} />)
    await screen.findByLabelText(zh.directorVideoPrompt)
    await prepareProductionTake()
    fireEvent.click(screen.getByRole('button', { name: zh.productionTakeOne }))
    await screen.findByText('current PromptIR Method is unavailable')
    first.unmount()

    const recovered = createPort()
    const second = render(<PromptIrWorkspace {...props} port={recovered.port} />)
    await screen.findByRole('button', { name: zh.productionTakeRecover })
    fireEvent.click(screen.getByRole('button', { name: zh.productionTakeRecover }))
    await screen.findByText(zh.productionTakeQueued)
    expect(recovered.spies.queueProductionTake).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID, episodeId: EPISODE_ID, storyboardRevisionId: STORYBOARD_REVISION_ID,
      frameId: FRAME_ID, takeKind: 'initial', takeOrdinal: 1, confirmReady: true,
      firstFrameSelectionReceiptSha256: 'f'.repeat(64), videoPreflightSha256: 'd'.repeat(64), paidConfirmed: true,
    }), expect.any(AbortSignal))
    second.unmount()

    render(<PromptIrWorkspace {...props} port={createPort().port} />)
    await screen.findByText(zh.productionTakeQueued)
    expect(screen.queryByRole('button', { name: zh.productionTakeRecover })).toBeNull()
    expect(screen.getByLabelText(zh.directorVideoPrompt)).toBeTruthy()
  })
})
