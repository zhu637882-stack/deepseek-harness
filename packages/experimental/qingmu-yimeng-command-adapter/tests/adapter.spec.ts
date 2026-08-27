import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  createYimengCommandHandler,
  type YimengCommandAdapterDependencies,
} from '../src/index.ts'

const PAYLOAD_SHA = 'a'.repeat(64)
const SNAPSHOT_SHA = 'b'.repeat(64)
const PREVIEW_SHA = 'c'.repeat(64)
const RECEIPT_SHA = '2e0f22a35ce29e39f6e6e414d9eccc993689b3199760cbd010b4aa2a3cf9c83f'
const ELEMENT_IMPACT_ANALYSIS = {
  affectedReferenceAssetIds: ['asset-1'],
  invalidatedApprovalAssetIds: ['asset-1'],
  affectedDerivedAssetIds: ['derived-1'],
  affectedReferencePackIds: ['reference-pack-1'],
  affectedPromptIrIds: ['prompt-ir-1'],
  affectedStoryboardFrameIds: ['storyboard-frame-1'],
  unknowns: ['provider-side cached derivatives cannot be proven locally'],
} as const
const ELEMENT_IMPACT_SHA = createHash('sha256')
  .update(canonicalJson(ELEMENT_IMPACT_ANALYSIS), 'utf8')
  .digest('hex')
const PREVIEW_REQUEST = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  changeSetId: 'changeset-1',
  baseRevision: 2,
} as const
const COMMIT_REQUEST = {
  ...PREVIEW_REQUEST,
  idempotencyKey: 'qingmu-changeset-1',
  expectedPayloadSha256: PAYLOAD_SHA,
} as const
const ELEMENT_METHOD_PROJECTION = {
  schema: 'qingmu.imago-element-method-projection.v1',
  input_snapshot_sha256: '6'.repeat(64),
  subject: {
    project_id: 'project-1',
    target_type: 'element_profile',
    target_id: 'prop-1',
    element_kind: 'prop',
    scope_type: 'project',
    scope_id: 'project-1',
    base_revision: 4,
    base_snapshot_sha256: createHash('sha256')
      .update(canonicalJson(elementSubjectFixture()), 'utf8')
      .digest('hex'),
  },
  retained: true,
} as const
const ELEMENT_METHOD_SHA = createHash('sha256').update(canonicalJson(ELEMENT_METHOD_PROJECTION), 'utf8').digest('hex')
const ELEMENT_METHOD_ATTESTATION = {
  schema: 'qingmu.imago-element-method-attestation.v1',
  algorithm: 'hmac-sha256',
  projectionSha256: ELEMENT_METHOD_SHA,
  inputSnapshotSha256: ELEMENT_METHOD_PROJECTION.input_snapshot_sha256,
  subjectSha256: createHash('sha256').update(canonicalJson(ELEMENT_METHOD_PROJECTION.subject), 'utf8').digest('hex'),
  signature: 'f'.repeat(64),
} as const
const ELEMENT_SNAPSHOT_SHA = createHash('sha256').update(canonicalJson(elementSubjectFixture()), 'utf8').digest('hex')
const ELEMENT_PREVIEW_REQUEST = {
  projectId: 'project-1',
  targetType: 'element_profile',
  targetId: 'prop-1',
  elementKind: 'prop',
  episodeId: null,
  changeSetId: 'changeset-element-1',
  baseRevision: 4,
  baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
} as const
const ELEMENT_COMMIT_REQUEST = {
  ...ELEMENT_PREVIEW_REQUEST,
  idempotencyKey: 'qingmu-element-1',
  expectedPayloadSha256: PAYLOAD_SHA,
} as const
const ATTESTATION_KEY = 'qingmu-reference-attestation-test-key-32-bytes'
const REFERENCE_ASSET_ID = 'asset-reference-2'
const REFERENCE_ASSET_SHA = '9'.repeat(64)
const REFERENCE_TARGET = {
  projectId: 'project-1',
  elementKind: 'prop',
  elementId: 'prop-1',
  profileRevision: 4,
  snapshotSha256: ELEMENT_SNAPSHOT_SHA,
  assetId: REFERENCE_ASSET_ID,
  assetSha256: REFERENCE_ASSET_SHA,
  operation: 'selectReferenceAsset',
} as const
const REFERENCE_METHOD_SNAPSHOT = {
  schema: 'qingmu.reference-asset-method-snapshot.v1',
  target: REFERENCE_TARGET,
  authority: {
    business_truth: 'yimeng',
    method_source: 'imago_os_current',
    human_approval: 'not_granted',
    paid_provider_authority: 'not_granted',
  },
} as const
const REFERENCE_METHOD_PROJECTION = {
  schema: 'qingmu.imago-reference-asset-method-projection.v1',
  input_snapshot_sha256: createHash('sha256').update(canonicalJson(REFERENCE_METHOD_SNAPSHOT), 'utf8').digest('hex'),
  target: REFERENCE_TARGET,
  method_definition: { method_id: 'reference-selection' },
  source_bindings: [],
  field_hints: [],
  checklist: [],
  work_order_projection: {},
  review_card: {},
  legal_work_set: {},
  authority_snapshot_attestation: 'not_verified_by_compiler',
  project_state_persisted: false,
  providerCalls: 0,
  workerStarted: false,
  human_approval_inferred: false,
  human_signoff_inferred: false,
  selection_executed: false,
} as const
const REFERENCE_METHOD_SHA = createHash('sha256')
  .update(canonicalJson(REFERENCE_METHOD_PROJECTION), 'utf8')
  .digest('hex')
const REFERENCE_METHOD_UNSIGNED_ATTESTATION = {
  schema: 'qingmu.imago-reference-asset-method-attestation.v1',
  algorithm: 'hmac-sha256',
  projectionSha256: REFERENCE_METHOD_SHA,
  inputSnapshotSha256: REFERENCE_METHOD_PROJECTION.input_snapshot_sha256,
  targetSha256: createHash('sha256').update(canonicalJson(REFERENCE_TARGET), 'utf8').digest('hex'),
} as const
const REFERENCE_METHOD_ATTESTATION = {
  ...REFERENCE_METHOD_UNSIGNED_ATTESTATION,
  signature: createHmac('sha256', ATTESTATION_KEY)
    .update(canonicalJson(REFERENCE_METHOD_UNSIGNED_ATTESTATION), 'utf8')
    .digest('hex'),
} as const
const REFERENCE_PREVIEW_REQUEST = {
  ...ELEMENT_PREVIEW_REQUEST,
  changeSetId: 'changeset-reference-1',
  operation: 'selectReferenceAsset',
  candidateAssetId: REFERENCE_ASSET_ID,
  candidateAssetSha256: REFERENCE_ASSET_SHA,
} as const
const REFERENCE_COMMIT_REQUEST = {
  ...REFERENCE_PREVIEW_REQUEST,
  idempotencyKey: 'qingmu-reference-1',
  expectedPayloadSha256: PAYLOAD_SHA,
} as const
const REVIEW_SUBJECT_SHA = 'd'.repeat(64)
const COMMENT_REQUEST = {
  projectId: 'project-1',
  elementKind: 'prop',
  targetId: 'prop-1',
  expectedSubjectRevision: 4,
  expectedSubjectSha256: REVIEW_SUBJECT_SHA,
  body: '保留表盘刻度，材质反光需要降低。',
  idempotencyKey: 'qingmu-comment-1',
} as const
const DECISION_REQUEST = {
  projectId: 'project-1',
  elementKind: 'prop',
  targetId: 'prop-1',
  expectedSubjectRevision: 4,
  expectedSubjectSha256: REVIEW_SUBJECT_SHA,
  decision: 'approve',
  reason: '造型、刻度与剧情设定一致。',
  idempotencyKey: 'qingmu-decision-1',
} as const
const COMMENT_RESULT = {
  schema: 'jason.qingmu-element-comment-result.v1',
  comment: {
    id: 'comment-1',
    subjectType: 'element_profile',
    subjectId: 'prop-1',
    subjectRevision: 4,
    subjectSha256: REVIEW_SUBJECT_SHA,
    body: COMMENT_REQUEST.body,
    actorId: 'reviewer-1',
    actorRole: 'commenter',
    authSessionId: 'auth-session-comment-1',
    createdAt: '2026-08-27T08:00:00Z',
  },
} as const
const DECISION_RESULT = {
  schema: 'jason.qingmu-element-human-decision-result.v1',
  decision: {
    id: 'decision-1',
    subjectType: 'element_profile',
    subjectId: 'prop-1',
    subjectRevision: 4,
    subjectSha256: REVIEW_SUBJECT_SHA,
    decision: 'approve',
    reason: DECISION_REQUEST.reason,
    actorId: 'approver-1',
    actorRole: 'approver',
    authSessionId: 'auth-session-decision-1',
    decidedAt: '2026-08-27T08:01:00Z',
  },
} as const
const RIGHTS_EXCEPTION_SCOPE = {
  kind: 'reference_rights',
  referenceAssetId: REFERENCE_ASSET_ID,
  referenceAssetSha256: REFERENCE_ASSET_SHA,
  rightsRecordSha256: '7'.repeat(64),
  rightsFields: ['sourceType', 'rightsHolder', 'authorizationScope'],
} as const
const RIGHTS_EXCEPTION_REQUEST = {
  projectId: 'project-1',
  elementKind: 'prop',
  targetId: 'prop-1',
  expectedSubjectRevision: 4,
  expectedSubjectSha256: REVIEW_SUBJECT_SHA,
  idempotencyKey: 'qingmu-rights-exception-1',
  reason: '仅对已核验的来源、权利人和授权范围做本次例外放行。',
  scope: RIGHTS_EXCEPTION_SCOPE,
} as const
const RIGHTS_EXCEPTION_RECOVERY_REQUEST = {
  projectId: RIGHTS_EXCEPTION_REQUEST.projectId,
  elementKind: RIGHTS_EXCEPTION_REQUEST.elementKind,
  targetId: RIGHTS_EXCEPTION_REQUEST.targetId,
  expectedSubjectRevision: RIGHTS_EXCEPTION_REQUEST.expectedSubjectRevision,
  expectedSubjectSha256: RIGHTS_EXCEPTION_REQUEST.expectedSubjectSha256,
  referenceAssetId: RIGHTS_EXCEPTION_SCOPE.referenceAssetId,
  referenceAssetSha256: RIGHTS_EXCEPTION_SCOPE.referenceAssetSha256,
  rightsRecordSha256: RIGHTS_EXCEPTION_SCOPE.rightsRecordSha256,
  reasonSha256: createHash('sha256')
    .update(canonicalJson(RIGHTS_EXCEPTION_REQUEST.reason), 'utf8')
    .digest('hex'),
  scopeSha256: createHash('sha256')
    .update(canonicalJson(RIGHTS_EXCEPTION_SCOPE), 'utf8')
    .digest('hex'),
  idempotencyKey: RIGHTS_EXCEPTION_REQUEST.idempotencyKey,
} as const
const RIGHTS_EXCEPTION_RELEASE = {
  id: 'rights-exception-release-1',
  decision: 'exception_release',
  subjectType: 'element_profile',
  subjectId: 'prop-1',
  subjectRevision: 4,
  subjectSha256: REVIEW_SUBJECT_SHA,
  scope: RIGHTS_EXCEPTION_SCOPE,
  actorId: 'approver-1',
  actorRole: 'approver',
  actorNaturalPersonId: 'natural-approver-1',
  producerActorId: 'producer-1',
  producerNaturalPersonId: 'natural-producer-1',
  assetProducerActorId: 'asset-producer-1',
  assetProducerNaturalPersonId: 'natural-asset-producer-1',
  assetProducerTaskId: 'asset-task-1',
  assetProducerTaskRequestSha256: '8'.repeat(64),
  authSessionId: 'auth-session-rights-exception-1',
  reason: RIGHTS_EXCEPTION_REQUEST.reason,
  releasedAt: '2026-08-27T08:02:00Z',
} as const
const RIGHTS_EXCEPTION_RESULT = {
  schema: 'jason.qingmu-reference-rights-exception-release-result.v1',
  changeSetId: 'changeset-rights-exception-1',
  commandReceiptId: 'command-receipt-rights-exception-1',
  eventId: 'event-rights-exception-1',
  payloadSha256: 'e'.repeat(64),
  release: RIGHTS_EXCEPTION_RELEASE,
  changed: false,
  providerCalls: 0,
  selectionAuthority: 'not_granted',
  humanApprovalInferred: false,
} as const
const RIGHTS_EXCEPTION_RECOVERY = {
  schema: 'jason.qingmu-command-receipt-recovery.v1',
  recovered: true,
  receiptSha256: createHash('sha256').update(canonicalJson(RIGHTS_EXCEPTION_RESULT), 'utf8').digest('hex'),
  receipt: RIGHTS_EXCEPTION_RESULT,
} as const
const PROMPT_IR_BASE = {
  imageGenPrompt: '雨夜车站首帧。',
  lastFrameImagePrompt: '',
  videoGenPrompt: '人物听完对白后转身。',
  motionPrompt: '镜头缓慢横移。',
  negativePrompt: '不得增加台词。',
} as const
const PROMPT_IR_AFTER = {
  ...PROMPT_IR_BASE,
  motionPrompt: '镜头缓慢横移，人物随后转身。',
} as const
const PROMPT_IR_TARGET_ID = 'storyboard-revision-1:frame-1'
const PROMPT_IR_BASE_CONTENT_SHA = '3'.repeat(64)
const PROMPT_IR_DRAFT_CONTENT_SHA = '4'.repeat(64)
const PROMPT_IR_CHANGESET_SHA = '5'.repeat(64)
const PROMPT_IR_PROPOSAL_REQUEST = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevisionId: 'storyboard-revision-1',
  frameId: 'frame-1',
  basePromptIrId: 'prompt-ir-ready-4',
  baseVersion: 4,
  baseContentSha256: PROMPT_IR_BASE_CONTENT_SHA,
  replacements: { motionPrompt: PROMPT_IR_AFTER.motionPrompt },
  harnessSessionId: 'harness-session-1',
  references: [{ kind: 'shot', id: 'shot-1' }],
} as const
const PROMPT_IR_PREVIEW_REQUEST = {
  changeSetId: 'changeset-prompt-ir-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  targetType: 'prompt_ir',
  targetId: PROMPT_IR_TARGET_ID,
  storyboardRevisionId: 'storyboard-revision-1',
  frameId: 'frame-1',
  basePromptIrId: 'prompt-ir-ready-4',
  baseRevision: 4,
  baseSnapshotSha256: SNAPSHOT_SHA,
} as const
const PROMPT_IR_EDIT_COMMIT_REQUEST = {
  ...PROMPT_IR_PREVIEW_REQUEST,
  idempotencyKey: 'qingmu-prompt-ir-edit-1',
  expectedPayloadSha256: PROMPT_IR_CHANGESET_SHA,
} as const
const PROMPT_IR_SELECT_REQUEST = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  storyboardRevisionId: 'storyboard-revision-1',
  frameId: 'frame-1',
  draftPromptIrId: 'prompt-ir-draft-5',
  draftVersion: 5,
  draftContentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
  idempotencyKey: 'qingmu-prompt-ir-select-1',
} as const

function promptIrChangeSetFixture() {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: PROMPT_IR_PREVIEW_REQUEST.changeSetId,
    workspaceId: null,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    baseRevision: 4,
    baseSnapshotSha256: SNAPSHOT_SHA,
    payloadSha256: PROMPT_IR_CHANGESET_SHA,
    originKind: 'human',
    actorUserId: 'user-1',
    harnessSessionId: 'harness-session-1',
    status: 'Proposed',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-27T09:00:00Z',
    updatedAt: '2026-08-27T09:00:00Z',
  }
}

function promptIrProposalFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
    changeSet: promptIrChangeSetFixture(),
    nextAction: 'preview',
  }
}

function promptIrPreviewFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-preview.v1',
    changeSetId: PROMPT_IR_PREVIEW_REQUEST.changeSetId,
    target: {
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboardRevisionId: 'storyboard-revision-1',
      frameId: 'frame-1',
      targetId: PROMPT_IR_TARGET_ID,
    },
    basePromptIr: {
      id: 'prompt-ir-ready-4',
      version: 4,
      contentSha256: PROMPT_IR_BASE_CONTENT_SHA,
      status: 'Ready',
      editableProjection: PROMPT_IR_BASE,
    },
    candidatePromptIr: {
      id: 'prompt-ir-draft-5',
      version: 5,
      contentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: PROMPT_IR_AFTER,
    },
    promptDiff: {
      changed: true,
      changedPaths: ['$.motionPrompt'],
      before: PROMPT_IR_BASE,
      after: PROMPT_IR_AFTER,
    },
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  }
}

function promptIrEditCommitFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1',
    changeSetId: PROMPT_IR_PREVIEW_REQUEST.changeSetId,
    commandReceiptId: 'receipt-prompt-ir-edit-1',
    eventId: 'event-prompt-ir-edit-1',
    eventType: 'PromptIrDraftCommitted',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    storyboardRevisionId: 'storyboard-revision-1',
    frameId: 'frame-1',
    promptIr: {
      id: 'prompt-ir-draft-5',
      version: 5,
      contentSha256: PROMPT_IR_DRAFT_CONTENT_SHA,
      status: 'Draft',
      editableProjection: PROMPT_IR_AFTER,
    },
    previousReadyPromptIr: {
      id: 'prompt-ir-ready-4',
      version: 4,
      contentSha256: PROMPT_IR_BASE_CONTENT_SHA,
      status: 'Ready',
    },
    payloadSha256: PROMPT_IR_CHANGESET_SHA,
    idempotencyKey: PROMPT_IR_EDIT_COMMIT_REQUEST.idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T09:01:00Z',
  }
}

function promptIrSelectionFixture() {
  return {
    schema: 'jason.qingmu-prompt-ir-selection-result.v1',
    changeSetId: 'changeset-prompt-ir-selection-1',
    commandReceiptId: 'receipt-prompt-ir-selection-1',
    eventId: 'event-prompt-ir-selection-1',
    eventType: 'PromptIrSelected',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'prompt_ir',
    targetId: PROMPT_IR_TARGET_ID,
    storyboardRevisionId: 'storyboard-revision-1',
    frameId: 'frame-1',
    selectedPromptIr: {
      id: PROMPT_IR_SELECT_REQUEST.draftPromptIrId,
      version: PROMPT_IR_SELECT_REQUEST.draftVersion,
      contentSha256: PROMPT_IR_SELECT_REQUEST.draftContentSha256,
      status: 'Ready',
      editableProjection: PROMPT_IR_AFTER,
    },
    stalePromptIrIds: ['prompt-ir-ready-4'],
    idempotencyKey: PROMPT_IR_SELECT_REQUEST.idempotencyKey,
    changed: true,
    providerCall: false,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: false,
    committedAt: '2026-08-27T09:02:00Z',
  }
}

function recoveryEnvelope(receipt: unknown) {
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: createHash('sha256').update(canonicalJson(receipt), 'utf8').digest('hex'),
    receipt,
  }
}
const signal = () => new AbortController().signal
const jsonResponse = (value: unknown, init?: ResponseInit): Response => Response.json(value, init)
const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

function requestJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string request body')
  return JSON.parse(init.body) as unknown
}

function deps(fetch: typeof globalThis.fetch, token?: string): YimengCommandAdapterDependencies {
  return { fetch, readToken: () => token }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

function changeSetFixture() {
  return {
    schema: 'jason.qingmu-change-set.v1',
    id: 'changeset-1',
    workspaceId: null,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'episode_script',
    targetId: 'episode-1',
    baseRevision: 2,
    baseSnapshotSha256: SNAPSHOT_SHA,
    payloadSha256: PAYLOAD_SHA,
    originKind: 'human',
    actorUserId: 'owner-1',
    harnessSessionId: 'session-1',
    status: 'draft',
    authoritativeRevision: null,
    authoritativeSnapshotSha256: null,
    committedByUserId: null,
    committedEventId: null,
    committedAt: null,
    createdAt: '2026-08-26T00:00:00+00:00',
    updatedAt: '2026-08-26T00:00:00+00:00',
    retained: { source: 'test' },
  }
}

function proposalFixture() {
  return {
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: changeSetFixture(),
    nextAction: 'preview',
  }
}

function previewFixture() {
  return {
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet: changeSetFixture(),
    baseScript: { scenes: [{ title: '旧场景' }] },
    proposedScript: { scenes: [{ title: '新场景' }] },
    authoritativeCurrentScript: { scenes: [{ title: '旧场景' }] },
    changeSetId: 'changeset-1',
    payloadSha256: PAYLOAD_SHA,
    baseRevision: 2,
    authoritativeRevision: 2,
    changed: true,
    changedPaths: ['$.scenes[0].title'],
    authoritativeChangedPaths: ['$.scenes[0].title'],
    revisionConflict: false,
    baseSnapshotConflict: false,
    canCommit: true,
    invalidatedStages: ['character_scene_prop', 'storyboard', 'production'],
    preflight: { status: 'pass', costGate: 'not_applicable' },
    references: [{ kind: 'human_note', id: 'note-1' }],
    previewSha256: PREVIEW_SHA,
  }
}

function commitFixture() {
  return {
    schema: 'jason.qingmu-episode-script-commit-result.v1',
    changeSetId: 'changeset-1',
    commandReceiptId: 'receipt-1',
    eventId: 'event-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    baseRevision: 2,
    authoritativeRevision: 3,
    authoritativeSnapshotSha256: SNAPSHOT_SHA,
    payloadSha256: PAYLOAD_SHA,
    idempotencyKey: 'qingmu-changeset-1',
    changed: true,
    invalidatedStages: ['character_scene_prop', 'storyboard', 'production'],
    deduplicated: false,
    committedAt: '2026-08-26T00:01:00+00:00',
  }
}

function recoveryFixture() {
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: RECEIPT_SHA,
    receipt: commitFixture(),
  }
}

function unknownReferenceRightsFixture() {
  const unknownScalar = { state: 'unknown', value: null } as const
  const unknownList = { state: 'unknown', values: [] } as const
  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: unknownScalar,
    rightsHolder: unknownScalar,
    authorizationScope: unknownList,
    territory: unknownList,
    term: { state: 'unknown', startsAt: null, endsAt: null, perpetual: null },
    restrictions: unknownList,
    contains: {
      realPersonLikeness: 'unknown',
      trademark: 'unknown',
      music: 'unknown',
      font: 'unknown',
      thirdPartyCharacter: 'unknown',
    },
    providerTerms: { state: 'unknown', terms: null, reviewedAt: null },
    modelLicenses: {
      code: unknownScalar,
      weights: unknownScalar,
      outputUse: unknownScalar,
    },
    humanDeclaration: { state: 'unknown', text: null },
    contentCredentials: unknownScalar,
  } as const
}

function elementSubjectFixture(visualPrompt = '旧铜表面') {
  return {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind: 'prop',
    propId: 'prop-1',
    profileRevision: 4,
    name: '青铜罗盘',
    visualPrompt,
    officialReferenceImageUrl: '/api/media/asset-1',
    references: [{
      assetId: 'asset-1',
      sha256: 'd'.repeat(64),
      selectionStatus: 'Selected',
      isSelected: true,
      rightsRecorded: false,
      rights: unknownReferenceRightsFixture(),
    }],
  }
}

function elementChangeSetFixture() {
  return {
    ...changeSetFixture(),
    id: 'changeset-element-1',
    episodeId: null,
    targetType: 'element_profile',
    targetId: 'prop-1',
    baseRevision: 4,
    baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
  }
}

function elementProposalFixture() {
  return {
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: elementChangeSetFixture(),
    nextAction: 'preview',
  }
}

function elementPreviewFixture() {
  return {
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet: elementChangeSetFixture(),
    baseSubject: elementSubjectFixture(),
    proposedVisualPrompt: '新铜表面，保留清晰刻度',
    authoritativeCurrentSubject: elementSubjectFixture(),
    changeSetId: 'changeset-element-1',
    payloadSha256: PAYLOAD_SHA,
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation: 'replaceVisualPrompt',
    baseRevision: 4,
    authoritativeRevision: 4,
    baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    authoritativeSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    changed: true,
    authoritativeChanged: true,
    revisionConflict: false,
    baseSnapshotConflict: false,
    canCommit: true,
    referenceInvalidationExpected: true,
    impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
    impactSha256: ELEMENT_IMPACT_SHA,
    preflight: {
      status: 'pass',
      costGate: 'not_granted',
      selectionAuthority: 'not_granted',
      humanApprovalInferred: false,
    },
    references: [{ kind: 'human_note', id: 'note-1' }],
    methodProjectionSha256: ELEMENT_METHOD_SHA,
    previewSha256: PREVIEW_SHA,
  }
}

function elementCommitFixture() {
  return {
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: 'changeset-element-1',
    commandReceiptId: 'receipt-element-1',
    eventId: 'event-element-1',
    eventType: 'ReferenceInvalidated',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation: 'replaceVisualPrompt',
    baseRevision: 4,
    authoritativeRevision: 5,
    authoritativeSnapshotSha256: 'f'.repeat(64),
    payloadSha256: PAYLOAD_SHA,
    idempotencyKey: 'qingmu-element-1',
    changed: true,
    referenceInvalidated: true,
    impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
    impactSha256: ELEMENT_IMPACT_SHA,
    deduplicated: false,
    committedAt: '2026-08-26T00:01:00+00:00',
  }
}

function elementRecoveryFixture() {
  const receipt = elementCommitFixture()
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: createHash('sha256').update(canonicalJson(receipt), 'utf8').digest('hex'),
    receipt,
  }
}

function referenceChangeSetFixture() {
  return {
    ...elementChangeSetFixture(),
    id: 'changeset-reference-1',
  }
}

function referenceProposalFixture() {
  return {
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: referenceChangeSetFixture(),
    nextAction: 'preview',
  }
}

function referencePreviewFixture(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration' = 'selectReferenceAsset') {
  return {
    schema: 'jason.qingmu-reference-asset-preview.v1',
    changeSetId: 'changeset-reference-1',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation,
    candidateAssetId: REFERENCE_ASSET_ID,
    candidateAssetSha256: REFERENCE_ASSET_SHA,
    candidateDrift: false,
    canCommit: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
  } as const
}

function referenceCommitFixture(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration' = 'selectReferenceAsset') {
  return {
    schema: 'jason.qingmu-reference-asset-commit-result.v1',
    changeSetId: 'changeset-reference-1',
    commandReceiptId: 'receipt-reference-1',
    eventId: 'event-reference-1',
    eventType: operation === 'selectReferenceAsset' ? 'ReferenceAssetSelected' : 'ReferenceRegenerationRequested',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation,
    candidateAssetId: REFERENCE_ASSET_ID,
    candidateAssetSha256: REFERENCE_ASSET_SHA,
    baseRevision: 4,
    authoritativeRevision: 5,
    authoritativeSnapshotSha256: '8'.repeat(64),
    payloadSha256: PAYLOAD_SHA,
    idempotencyKey: 'qingmu-reference-1',
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    deduplicated: false,
    committedAt: '2026-08-27T00:01:00+00:00',
  } as const
}

function referenceRecoveryFixture(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration' = 'selectReferenceAsset') {
  const receipt = referenceCommitFixture(operation)
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: createHash('sha256').update(canonicalJson(receipt), 'utf8').digest('hex'),
    receipt,
  }
}

function referenceProposalRequest() {
  return {
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation: 'selectReferenceAsset',
    candidateAssetId: REFERENCE_ASSET_ID,
    candidateAssetSha256: REFERENCE_ASSET_SHA,
    baseRevision: 4,
    baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    methodProjection: REFERENCE_METHOD_PROJECTION,
    methodProjectionSha256: REFERENCE_METHOD_SHA,
    methodAttestation: REFERENCE_METHOD_ATTESTATION,
  } as const
}

function referenceMethodFor(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration') {
  const target = { ...REFERENCE_TARGET, operation }
  const snapshot = { ...REFERENCE_METHOD_SNAPSHOT, target }
  const methodProjection = {
    ...REFERENCE_METHOD_PROJECTION,
    target,
    input_snapshot_sha256: createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex'),
  }
  const methodProjectionSha256 = createHash('sha256')
    .update(canonicalJson(methodProjection), 'utf8')
    .digest('hex')
  const unsigned = {
    schema: 'qingmu.imago-reference-asset-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: methodProjectionSha256,
    inputSnapshotSha256: methodProjection.input_snapshot_sha256,
    targetSha256: createHash('sha256').update(canonicalJson(target), 'utf8').digest('hex'),
  } as const
  return {
    methodProjection,
    methodProjectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', ATTESTATION_KEY).update(canonicalJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

function recordedReferenceRightsFixture() {
  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: { state: 'known', value: 'commissioned' },
    rightsHolder: { state: 'known', value: '青木工作室' },
    authorizationScope: { state: 'known', values: ['AI短剧制作', '宣传物料'] },
    territory: { state: 'known', values: ['中国大陆'] },
    term: {
      state: 'known',
      startsAt: '2026-08-27T00:00:00Z',
      endsAt: '2027-08-27T00:00:00Z',
      perpetual: false,
    },
    restrictions: { state: 'known', values: [] },
    contains: {
      realPersonLikeness: 'no',
      trademark: 'no',
      music: 'no',
      font: 'no',
      thirdPartyCharacter: 'no',
    },
    providerTerms: {
      state: 'known',
      terms: '允许商业短剧及宣传物料使用。',
      reviewedAt: '2026-08-27T00:30:00Z',
    },
    modelLicenses: {
      code: { state: 'not_applicable', value: null },
      weights: { state: 'known', value: 'licensed' },
      outputUse: { state: 'known', value: 'commercial-short-drama' },
    },
    humanDeclaration: { state: 'provided', text: '已核对委托协议与素材授权范围。' },
    contentCredentials: { state: 'known', value: 'c2pa:asset-1' },
  } as const
}

function elementSubjectRightsFixture(
  rightsRecorded: boolean,
  rights: ReturnType<typeof recordedReferenceRightsFixture> | ReturnType<typeof unknownReferenceRightsFixture>,
) {
  const subject = elementSubjectFixture()
  const reference = subject.references[0]
  if (reference === undefined) throw new Error('reference fixture is missing')
  return {
    ...subject,
    references: [{ ...reference, rightsRecorded, rights }],
  }
}

function referenceRightsMethodFor(baseSnapshotSha256: string) {
  const subject = {
    project_id: 'project-1',
    target_type: 'element_profile',
    target_id: 'prop-1',
    element_kind: 'prop',
    scope_type: 'project',
    scope_id: 'project-1',
    base_revision: 4,
    base_snapshot_sha256: baseSnapshotSha256,
  } as const
  const snapshot = {
    schema: 'qingmu.element-method-snapshot.v1',
    subject,
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  } as const
  const sourceKinds = [
    'runtime_pointer',
    'runtime_channel_registry',
    'stage_contracts',
    'role_capability_spec',
    'role_agent',
    'role_method',
    'method_reference',
  ] as const
  const target = {
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    scopeType: 'project',
    scopeId: 'project-1',
  } as const
  const methodProjection = {
    schema: 'qingmu.imago-element-method-projection.v1',
    input_snapshot_sha256: createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex'),
    subject,
    method_definition: {
      id: 'imago-v6-reference-rights-record',
      version: 1,
      sha256: '3'.repeat(64),
      stage_contract_sha256: '4'.repeat(64),
      role_capability_sha256: '5'.repeat(64),
      agent_path: 'agents/b2a-art-director/scene-designer/AGENTS.md',
      skill_path: 'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
    },
    source_bindings: sourceKinds.map((kind, index) => ({
      kind,
      path: `source-${String(index + 1)}`,
      sha256: '6'.repeat(64),
    })),
    field_hints: [{ hint_id: 'rights-source-holder', field: 'rights' }],
    checklist: [{ check_id: 'rights-record-complete', required: true }],
    work_order_projection: {
      target,
      operation: 'replaceReferenceRights',
      allowed_mutations: ['replaceReferenceRights'],
      required_read_set: [{
        source: 'yimeng',
        resource: 'element_reference_rights_snapshot',
        revision: 4,
        sha256: baseSnapshotSha256,
      }],
      before_write: ['重新读取易梦权威资料'],
      after_write: ['仅通过易梦 Change Set 写路径替换权利记录'],
    },
    review_card: {
      title: '参考资产权利字段审核',
      summary: '核对完整记录和显式未知项。',
      review_dimensions: ['来源与授权依据'],
      hard_vetoes: ['不得把 unknown 写成已清权'],
      decision_boundary: '机器不产生权利批准、签收或异常放行结论。',
    },
    legal_work_set: {
      reads: ['yimeng_element_reference_rights_snapshot'],
      writes: ['replace_reference_rights_via_changeset'],
      invalidates: ['reference_rights_dependent_projection'],
      forbidden: [
        'provider_dispatch',
        'asset_generation',
        'asset_selection',
        'human_decision',
        'project_state_write',
      ],
    },
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    paid_provider_authority: 'not_granted',
    human_approval_inferred: false,
    selection_authority: 'not_granted',
  } as const
  const methodProjectionSha256 = createHash('sha256')
    .update(canonicalJson(methodProjection), 'utf8')
    .digest('hex')
  const unsigned = {
    schema: 'qingmu.imago-element-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: methodProjectionSha256,
    inputSnapshotSha256: methodProjection.input_snapshot_sha256,
    subjectSha256: createHash('sha256').update(canonicalJson(subject), 'utf8').digest('hex'),
  } as const
  return {
    methodProjection,
    methodProjectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', ATTESTATION_KEY).update(canonicalJson(unsigned), 'utf8').digest('hex'),
    },
  }
}

function emptyElementImpactFixture() {
  return {
    affectedReferenceAssetIds: [],
    invalidatedApprovalAssetIds: [],
    affectedDerivedAssetIds: [],
    affectedReferencePackIds: [],
    affectedPromptIrIds: [],
    affectedStoryboardFrameIds: [],
    unknowns: [],
  }
}

function referenceRightsContractFixture(options: {
  rights: ReturnType<typeof recordedReferenceRightsFixture> | ReturnType<typeof unknownReferenceRightsFixture>
  baseSubject: ReturnType<typeof elementSubjectRightsFixture>
  changed: boolean
  referenceInvalidated: boolean
}) {
  const baseSnapshotSha256 = createHash('sha256')
    .update(canonicalJson(options.baseSubject), 'utf8')
    .digest('hex')
  const method = referenceRightsMethodFor(baseSnapshotSha256)
  const changeSetId = 'changeset-rights-1'
  const changeSet = {
    ...elementChangeSetFixture(),
    id: changeSetId,
    baseSnapshotSha256,
  }
  const previewRequest = {
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    episodeId: null,
    changeSetId,
    baseRevision: 4,
    baseSnapshotSha256,
    operation: 'replaceReferenceRights',
    referenceAssetId: 'asset-1',
    referenceAssetSha256: 'd'.repeat(64),
  } as const
  const commitRequest = {
    ...previewRequest,
    idempotencyKey: 'qingmu-rights-1',
    expectedPayloadSha256: PAYLOAD_SHA,
  } as const
  const impactAnalysis = options.referenceInvalidated ? ELEMENT_IMPACT_ANALYSIS : emptyElementImpactFixture()
  const impactSha256 = createHash('sha256').update(canonicalJson(impactAnalysis), 'utf8').digest('hex')
  const commit = {
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId,
    commandReceiptId: 'receipt-rights-1',
    eventId: 'event-rights-1',
    eventType: options.referenceInvalidated ? 'ReferenceInvalidated' : 'ElementProfileChanged',
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId: 'prop-1',
    elementKind: 'prop',
    operation: 'replaceReferenceRights',
    referenceAssetId: 'asset-1',
    referenceAssetSha256: 'd'.repeat(64),
    baseRevision: 4,
    authoritativeRevision: 4 + Number(options.changed),
    authoritativeSnapshotSha256: options.changed ? '7'.repeat(64) : baseSnapshotSha256,
    payloadSha256: PAYLOAD_SHA,
    idempotencyKey: 'qingmu-rights-1',
    changed: options.changed,
    referenceInvalidated: options.referenceInvalidated,
    impactAnalysis,
    impactSha256,
    deduplicated: false,
    committedAt: '2026-08-27T01:00:00Z',
  } as const
  return {
    proposalRequest: {
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      operation: 'replaceReferenceRights',
      referenceAssetId: 'asset-1',
      referenceAssetSha256: 'd'.repeat(64),
      rights: options.rights,
      baseRevision: 4,
      baseSnapshotSha256,
      ...method,
    } as const,
    previewRequest,
    commitRequest,
    proposal: {
      schema: 'jason.qingmu-change-set-proposal.v1',
      changeSet,
      nextAction: 'preview',
    } as const,
    preview: {
      schema: 'jason.qingmu-change-set-preview.v1',
      changeSet,
      baseSubject: options.baseSubject,
      authoritativeCurrentSubject: options.baseSubject,
      changeSetId,
      payloadSha256: PAYLOAD_SHA,
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      operation: 'replaceReferenceRights',
      referenceAssetId: 'asset-1',
      referenceAssetSha256: 'd'.repeat(64),
      proposedReferenceRights: options.rights,
      baseRevision: 4,
      authoritativeRevision: 4,
      baseSnapshotSha256,
      authoritativeSnapshotSha256: baseSnapshotSha256,
      changed: options.changed,
      authoritativeChanged: false,
      revisionConflict: false,
      baseSnapshotConflict: false,
      impactConflict: false,
      canCommit: true,
      referenceInvalidationExpected: options.referenceInvalidated,
      impactAnalysis,
      impactSha256,
      preflight: {
        status: 'pass',
        costGate: 'not_granted',
        selectionAuthority: 'not_granted',
        humanApprovalInferred: false,
      },
      references: [{ kind: 'human_note', id: 'rights-review-1' }],
      methodProjectionSha256: method.methodProjectionSha256,
      previewSha256: PREVIEW_SHA,
    } as const,
    commit,
    recovery: recoveryEnvelope(commit),
  }
}

type ElementKind = 'actor' | 'scene' | 'prop'

function elementContractFixture(elementKind: ElementKind) {
  const targetId = `${elementKind}-1`
  const operation = elementKind === 'actor' ? 'replaceVisualIdentity' : 'replaceVisualPrompt'
  const visualValue = elementKind === 'actor'
    ? '清瘦青年，左眉尾有浅疤，深灰长风衣'
    : elementKind === 'scene'
      ? '雨夜码头，冷色逆光，湿润石板反光'
      : '新铜表面，保留清晰刻度'
  const subjectCommon = {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: 'project-1',
    targetType: 'element_profile',
    elementKind,
    profileRevision: 4,
    name: elementKind === 'actor' ? '林默' : elementKind === 'scene' ? '雨夜码头' : '青铜罗盘',
    officialReferenceImageUrl: '/api/media/asset-1',
    references: [{
      assetId: 'asset-1',
      sha256: 'd'.repeat(64),
      selectionStatus: 'Selected',
      isSelected: true,
      rightsRecorded: false,
      rights: unknownReferenceRightsFixture(),
      ...(elementKind === 'prop' ? {} : { role: elementKind === 'actor' ? 'primary' : 'establishing' }),
    }],
  }
  const subject = elementKind === 'actor'
    ? { ...subjectCommon, actorId: targetId, visualIdentity: '旧人物视觉身份' }
    : elementKind === 'scene'
      ? { ...subjectCommon, sceneId: targetId, sceneType: 'exterior', visualPrompt: '旧场景视觉提示' }
      : { ...subjectCommon, propId: targetId, visualPrompt: '旧铜表面' }
  const baseSnapshotSha256 = createHash('sha256').update(canonicalJson(subject), 'utf8').digest('hex')
  const methodProjection = {
    ...ELEMENT_METHOD_PROJECTION,
    subject: {
      ...ELEMENT_METHOD_PROJECTION.subject,
      target_id: targetId,
      element_kind: elementKind,
      base_snapshot_sha256: baseSnapshotSha256,
    },
  }
  const methodProjectionSha256 = createHash('sha256')
    .update(canonicalJson(methodProjection), 'utf8')
    .digest('hex')
  const methodAttestation = {
    ...ELEMENT_METHOD_ATTESTATION,
    projectionSha256: methodProjectionSha256,
    inputSnapshotSha256: methodProjection.input_snapshot_sha256,
    subjectSha256: createHash('sha256')
      .update(canonicalJson(methodProjection.subject), 'utf8')
      .digest('hex'),
  }
  const changeSetId = `changeset-${elementKind}-1`
  const changeSet = {
    ...elementChangeSetFixture(),
    id: changeSetId,
    targetId,
    baseSnapshotSha256,
  }
  const proposal = {
    ...elementProposalFixture(),
    changeSet,
  }
  const fixedPreview = elementPreviewFixture()
  const { proposedVisualPrompt: _proposedVisualPrompt, ...previewWithoutVisual } = fixedPreview
  const preview = {
    ...previewWithoutVisual,
    changeSet,
    baseSubject: subject,
    authoritativeCurrentSubject: subject,
    changeSetId,
    targetId,
    elementKind,
    operation,
    baseSnapshotSha256,
    authoritativeSnapshotSha256: baseSnapshotSha256,
    methodProjectionSha256,
    ...(elementKind === 'actor'
      ? { proposedVisualIdentity: visualValue }
      : { proposedVisualPrompt: visualValue }),
  }
  const commit = {
    ...elementCommitFixture(),
    changeSetId,
    targetId,
    elementKind,
    operation,
    idempotencyKey: `qingmu-${elementKind}-1`,
  }
  const previewRequest = {
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId,
    elementKind,
    episodeId: null,
    changeSetId,
    baseRevision: 4,
    baseSnapshotSha256,
  } as const
  const commitRequest = {
    ...previewRequest,
    idempotencyKey: `qingmu-${elementKind}-1`,
    expectedPayloadSha256: PAYLOAD_SHA,
  }
  const proposeRequest = {
    projectId: 'project-1',
    targetType: 'element_profile',
    targetId,
    elementKind,
    operation,
    ...(elementKind === 'actor' ? { visualIdentity: visualValue } : { visualPrompt: visualValue }),
    baseRevision: 4,
    baseSnapshotSha256,
    methodProjection,
    methodProjectionSha256,
    methodAttestation,
  }
  return {
    targetId,
    operation,
    visualValue,
    baseSnapshotSha256,
    methodProjection,
    methodProjectionSha256,
    methodAttestation,
    proposal,
    preview,
    commit,
    recovery: {
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: createHash('sha256').update(canonicalJson(commit), 'utf8').digest('hex'),
      receipt: commit,
    },
    proposeRequest,
    previewRequest,
    commitRequest,
  }
}

describe('qingmu Yimeng command adapter', () => {
  it('registers a distinct loopback-only command channel', () => {
    const handle = vi.fn((
      _channel: string,
      _handler: ConnectionRpcHandler,
      _options: ConnectionRpcHandlerOptions,
    ) => async () => {})
    apply({ connection: { rpc: { handle } } } as unknown as Context)
    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]?.[0]).toBe('/qingmu-yimeng-command')
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })
  })

  it('rejects every command without a Host token before fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengCommandHandler({}, deps(fetch))
    for (const [endpoint, payload] of [
      ['proposeScript', { projectId: 'project-1', episodeId: 'episode-1', script: { scenes: [{ title: '场景' }] }, baseRevision: 2 }],
      ['previewScript', PREVIEW_REQUEST],
      ['commitScript', COMMIT_REQUEST],
      ['recoverScriptCommit', COMMIT_REQUEST],
      ['proposeElementProfile', {
        projectId: 'project-1',
        targetType: 'element_profile',
        targetId: 'prop-1',
        elementKind: 'prop',
        operation: 'replaceVisualPrompt',
        visualPrompt: '新铜表面，保留清晰刻度',
        baseRevision: 4,
        baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
        methodProjection: ELEMENT_METHOD_PROJECTION,
        methodProjectionSha256: ELEMENT_METHOD_SHA,
        methodAttestation: ELEMENT_METHOD_ATTESTATION,
      }],
      ['previewElementProfile', ELEMENT_PREVIEW_REQUEST],
      ['commitElementProfile', ELEMENT_COMMIT_REQUEST],
      ['recoverElementProfileCommit', ELEMENT_COMMIT_REQUEST],
      ['createComment', COMMENT_REQUEST],
      ['createHumanDecision', DECISION_REQUEST],
      ['createReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_REQUEST],
      ['recoverReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_RECOVERY_REQUEST],
    ] as const) {
      expect(await handler(endpoint, payload, signal())).toEqual({
        ok: false,
        error: { code: 'internal', message: 'YIMENG_API_TOKEN is not configured', details: {} },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps comments and human decisions as separate Host-only commands without browser identity claims', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/comments')) return jsonResponse(COMMENT_RESULT, { status: 201 })
      if (url.endsWith('/human-decisions')) return jsonResponse(DECISION_RESULT, { status: 201 })
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))

    expect(await handler('createComment', COMMENT_REQUEST, signal())).toEqual({ ok: true, value: COMMENT_RESULT })
    expect(await handler('createHumanDecision', DECISION_REQUEST, signal())).toEqual({ ok: true, value: DECISION_RESULT })
    expect(requests.map(item => item.url)).toEqual([
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/comments',
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/human-decisions',
    ])
    expect(requests[0]?.body).toEqual({
      expectedSubjectRevision: 4,
      expectedSubjectSha256: REVIEW_SUBJECT_SHA,
      body: COMMENT_REQUEST.body,
      idempotencyKey: COMMENT_REQUEST.idempotencyKey,
    })
    expect(requests[1]?.body).toEqual({
      expectedSubjectRevision: 4,
      expectedSubjectSha256: REVIEW_SUBJECT_SHA,
      decision: 'approve',
      reason: DECISION_REQUEST.reason,
      idempotencyKey: DECISION_REQUEST.idempotencyKey,
    })
    for (const request of requests) {
      expect(request.init.method).toBe('POST')
      expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer test-token')
      expect(request.body).not.toHaveProperty('actorId')
      expect(request.body).not.toHaveProperty('actorRole')
      expect(request.body).not.toHaveProperty('authSessionId')
    }
  })

  it('rejects review identity injection and response subject drift before exposing a result', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    expect(await handler('createComment', { ...COMMENT_REQUEST, actorId: 'browser-claim' }, signal())).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(fetch).not.toHaveBeenCalled()

    const drifted = createYimengCommandHandler({}, deps(async () => jsonResponse({
      ...DECISION_RESULT,
      decision: { ...DECISION_RESULT.decision, subjectSha256: 'e'.repeat(64) },
    }), 'test-token'))
    expect(await drifted('createHumanDecision', DECISION_REQUEST, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })

    const wrongRole = createYimengCommandHandler({}, deps(async () => jsonResponse({
      ...DECISION_RESULT,
      decision: { ...DECISION_RESULT.decision, actorRole: 'commenter' },
    }), 'test-token'))
    expect(await wrongRole('createHumanDecision', DECISION_REQUEST, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })

    const wrongCommentRole = createYimengCommandHandler({}, deps(async () => jsonResponse({
      ...COMMENT_RESULT,
      comment: { ...COMMENT_RESULT.comment, actorRole: 'approver' },
    }), 'test-token'))
    expect(await wrongCommentRole('createComment', COMMENT_REQUEST, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
  })

  it('uses an exact Host-only POST and a GET-only receipt recovery for rights exception releases', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/command-receipt')) return jsonResponse(RIGHTS_EXCEPTION_RECOVERY)
      if (url.endsWith('/reference-rights/exception-releases')) {
        return jsonResponse(RIGHTS_EXCEPTION_RESULT, { status: 201 })
      }
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))

    expect(await handler('createReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_REQUEST, signal()))
      .toEqual({ ok: true, value: RIGHTS_EXCEPTION_RESULT })
    expect(await handler('recoverReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_RECOVERY_REQUEST, signal()))
      .toEqual({ ok: true, value: RIGHTS_EXCEPTION_RECOVERY })

    expect(requests.map(item => item.url)).toEqual([
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases',
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/reference-rights/exception-releases/command-receipt',
    ])
    expect(requests[0]?.body).toEqual({
      expectedSubjectRevision: 4,
      expectedSubjectSha256: REVIEW_SUBJECT_SHA,
      scope: RIGHTS_EXCEPTION_SCOPE,
      reason: RIGHTS_EXCEPTION_REQUEST.reason,
    })
    expect(requests[0]?.body).not.toHaveProperty('idempotencyKey')
    expect(requests[1]?.body).toBeUndefined()
    expect(requests.map(item => item.init.method)).toEqual(['POST', 'GET'])
    for (const request of requests) {
      const headers = new Headers(request.init.headers)
      expect(headers.get('authorization')).toBe('Bearer test-token')
      expect(headers.get('idempotency-key')).toBe(RIGHTS_EXCEPTION_REQUEST.idempotencyKey)
      expect(headers.has('cookie')).toBe(false)
      expect(request.init.cache).toBe('no-store')
    }
    expect(requests.filter(item => item.init.method === 'POST')).toHaveLength(1)
  })

  it('fails closed on rights exception browser authority, finite-scope, lineage, identity, or receipt drift', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    for (const payload of [
      { ...RIGHTS_EXCEPTION_REQUEST, actorId: 'browser-claim' },
      { ...RIGHTS_EXCEPTION_REQUEST, actorNaturalPersonId: 'browser-person' },
      { ...RIGHTS_EXCEPTION_REQUEST, releasedAt: '2026-08-27T08:02:00Z' },
      { ...RIGHTS_EXCEPTION_REQUEST, decision: 'exception_release' },
      { ...RIGHTS_EXCEPTION_REQUEST, providerCalls: 0 },
      { ...RIGHTS_EXCEPTION_REQUEST, scope: { ...RIGHTS_EXCEPTION_SCOPE, rightsFields: [] } },
      { ...RIGHTS_EXCEPTION_REQUEST, scope: { ...RIGHTS_EXCEPTION_SCOPE, rightsFields: ['*'] } },
      { ...RIGHTS_EXCEPTION_REQUEST, scope: { ...RIGHTS_EXCEPTION_SCOPE, rightsFields: ['rightsHolder', 'rightsHolder'] } },
      { ...RIGHTS_EXCEPTION_REQUEST, scope: { ...RIGHTS_EXCEPTION_SCOPE, rightsFields: ['rightsHolder', 'sourceType'] } },
      { ...RIGHTS_EXCEPTION_REQUEST, scope: { ...RIGHTS_EXCEPTION_SCOPE, projectWide: true } },
    ]) {
      expect(await handler('createReferenceRightsExceptionRelease', payload, signal())).toMatchObject({
        ok: false,
        error: { code: 'bad-request' },
      })
    }
    expect(fetch).not.toHaveBeenCalled()

    expect(await handler('recoverReferenceRightsExceptionRelease', {
      ...RIGHTS_EXCEPTION_RECOVERY_REQUEST,
      reason: RIGHTS_EXCEPTION_REQUEST.reason,
    }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()

    for (const result of [
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, subjectSha256: 'f'.repeat(64) } },
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, reason: 'different reason' } },
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, actorNaturalPersonId: 'natural-producer-1' } },
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, releasedAt: '2026-02-30T08:02:00Z' } },
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, releasedAt: '2026-08-27T08:02:00' } },
      { ...RIGHTS_EXCEPTION_RESULT, release: { ...RIGHTS_EXCEPTION_RELEASE, stale: false } },
      { ...RIGHTS_EXCEPTION_RESULT, changed: true },
      { ...RIGHTS_EXCEPTION_RESULT, providerCalls: 1 },
      { ...RIGHTS_EXCEPTION_RESULT, selectionAuthority: 'granted' },
      { ...RIGHTS_EXCEPTION_RESULT, humanApprovalInferred: true },
    ]) {
      const drifted = createYimengCommandHandler({}, deps(async () => jsonResponse(result), 'test-token'))
      expect(await drifted('createReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_REQUEST, signal()))
        .toMatchObject({ ok: false, error: { code: 'internal' } })
    }

    const tamperedRecovery = createYimengCommandHandler({}, deps(async () => jsonResponse({
      ...RIGHTS_EXCEPTION_RECOVERY,
      receiptSha256: 'f'.repeat(64),
    }), 'test-token'))
    expect(await tamperedRecovery('recoverReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_RECOVERY_REQUEST, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })

    const driftedReceipt = {
      ...RIGHTS_EXCEPTION_RESULT,
      release: { ...RIGHTS_EXCEPTION_RELEASE, reason: 'receipt reason drift' },
    }
    const digestDrift = createYimengCommandHandler({}, deps(async () => jsonResponse({
      ...RIGHTS_EXCEPTION_RECOVERY,
      receiptSha256: createHash('sha256').update(canonicalJson(driftedReceipt), 'utf8').digest('hex'),
      receipt: driftedReceipt,
    }), 'test-token'))
    expect(await digestDrift('recoverReferenceRightsExceptionRelease', RIGHTS_EXCEPTION_RECOVERY_REQUEST, signal()))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('performs the prop element-profile ChangeSet flow on canonical generic routes', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/elements/prop/prop-1/change-sets')) return jsonResponse(elementProposalFixture(), { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(elementPreviewFixture())
      if (url.endsWith(':commit')) return jsonResponse(elementCommitFixture())
      if (url.endsWith('/command-receipt')) return jsonResponse(elementRecoveryFixture())
      throw new Error(`unexpected URL: ${url}`)
    }
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    const methodProjection = ELEMENT_METHOD_PROJECTION

    const proposal = await handler('proposeElementProfile', {
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      operation: 'replaceVisualPrompt',
      visualPrompt: '新铜表面，保留清晰刻度',
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
      methodProjection,
      methodProjectionSha256: ELEMENT_METHOD_SHA,
      methodAttestation: ELEMENT_METHOD_ATTESTATION,
      harnessSessionId: 'session-1',
      references: [{ kind: 'human_note', id: 'note-1' }],
    }, signal())
    const preview = await handler('previewElementProfile', ELEMENT_PREVIEW_REQUEST, signal())
    const commit = await handler('commitElementProfile', ELEMENT_COMMIT_REQUEST, signal())
    const recovery = await handler('recoverElementProfileCommit', ELEMENT_COMMIT_REQUEST, signal())

    expect(proposal).toMatchObject({ ok: true, value: { changeSet: { targetType: 'element_profile', episodeId: null } } })
    expect(preview).toMatchObject({
      ok: true,
      value: {
        targetType: 'element_profile',
        operation: 'replaceVisualPrompt',
        referenceInvalidationExpected: true,
        impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
        impactSha256: ELEMENT_IMPACT_SHA,
      },
    })
    expect(commit).toMatchObject({
      ok: true,
      value: {
        eventType: 'ReferenceInvalidated',
        referenceInvalidated: true,
        impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
        impactSha256: ELEMENT_IMPACT_SHA,
        deduplicated: false,
      },
    })
    expect(recovery).toMatchObject({
      ok: true,
      value: { recovered: true, receipt: { targetId: 'prop-1', referenceInvalidated: true } },
    })
    expect(requests.map(item => item.url)).toEqual([
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-element-1:preview',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-element-1:commit',
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/changeset-element-1/command-receipt',
    ])
    expect(requests[0]?.body).toEqual({
      elementKind: 'prop',
      operation: 'replaceVisualPrompt',
      visualPrompt: '新铜表面，保留清晰刻度',
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
      methodProjection,
      methodProjectionSha256: ELEMENT_METHOD_SHA,
      methodAttestation: ELEMENT_METHOD_ATTESTATION,
      harnessSessionId: 'session-1',
      references: [{ kind: 'human_note', id: 'note-1' }],
    })
    const subjectBody = {
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      episodeId: null,
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    }
    expect(requests[1]?.body).toEqual(subjectBody)
    expect(requests[2]?.body).toEqual({
      ...subjectBody,
      idempotencyKey: 'qingmu-element-1',
      expectedPayloadSha256: PAYLOAD_SHA,
    })
    expect(requests[3]?.body).toBeUndefined()
    expect(requests[3]?.init.method).toBe('GET')
    expect(new Headers(requests[3]?.init.headers).get('idempotency-key')).toBe('qingmu-element-1')
  })

  it('performs a Host-attested reference selection through generic preview, commit, and GET-only recovery', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/reference-change-sets')) return jsonResponse(referenceProposalFixture(), { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(referencePreviewFixture())
      if (url.endsWith(':commit')) return jsonResponse(referenceCommitFixture())
      if (url.endsWith('/command-receipt')) return jsonResponse(referenceRecoveryFixture())
      throw new Error(`unexpected URL: ${url}`)
    }
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))

    const proposal = await handler('proposeReferenceAsset', referenceProposalRequest(), signal())
    const preview = await handler('previewElementProfile', REFERENCE_PREVIEW_REQUEST, signal())
    const commit = await handler('commitElementProfile', REFERENCE_COMMIT_REQUEST, signal())
    const recovery = await handler('recoverElementProfileCommit', REFERENCE_COMMIT_REQUEST, signal())

    expect(proposal).toMatchObject({
      ok: true,
      value: { changeSet: { id: 'changeset-reference-1', targetId: 'prop-1' }, nextAction: 'preview' },
    })
    expect(preview).toEqual({ ok: true, value: referencePreviewFixture() })
    expect(commit).toEqual({ ok: true, value: referenceCommitFixture() })
    expect(recovery).toEqual({ ok: true, value: referenceRecoveryFixture() })
    expect(requests.map(item => item.url)).toEqual([
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/reference-change-sets',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-reference-1:preview',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-reference-1:commit',
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/changeset-reference-1/command-receipt',
    ])
    expect(requests[0]?.body).toEqual({
      elementKind: 'prop',
      operation: 'selectReferenceAsset',
      candidateAssetId: REFERENCE_ASSET_ID,
      candidateAssetSha256: REFERENCE_ASSET_SHA,
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    })
    expect(JSON.stringify(requests[0]?.body)).not.toContain('methodProjection')
    expect(JSON.stringify(requests[0]?.body)).not.toContain('methodAttestation')
    const genericPreviewBody = {
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      episodeId: null,
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
    }
    expect(requests[1]?.body).toEqual(genericPreviewBody)
    expect(requests[2]?.body).toEqual({
      ...genericPreviewBody,
      idempotencyKey: 'qingmu-reference-1',
      expectedPayloadSha256: PAYLOAD_SHA,
    })
    expect(requests[3]?.init.method).toBe('GET')
    expect(requests[3]?.body).toBeUndefined()
    expect(new URL(requests[3]?.url ?? '').search).toBe('')
    expect(new Headers(requests[3]?.init.headers).get('idempotency-key')).toBe('qingmu-reference-1')
  })

  it('keeps reference regeneration intent-only with a required repair prompt and zero execution receipts', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const requests: Array<{ url: string; body: unknown }> = []
    const method = referenceMethodFor('requestReferenceRegeneration')
    const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, body })
      if (url.endsWith('/reference-change-sets')) return jsonResponse(referenceProposalFixture(), { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(referencePreviewFixture('requestReferenceRegeneration'))
      if (url.endsWith(':commit')) return jsonResponse(referenceCommitFixture('requestReferenceRegeneration'))
      if (url.endsWith('/command-receipt')) return jsonResponse(referenceRecoveryFixture('requestReferenceRegeneration'))
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))
    const request = {
      ...referenceProposalRequest(),
      operation: 'requestReferenceRegeneration',
      repairPrompt: '保留罗盘刻度，修复表面反光造成的细节丢失',
      ...method,
    } as const
    const previewRequest = { ...REFERENCE_PREVIEW_REQUEST, operation: 'requestReferenceRegeneration' } as const
    const commitRequest = { ...REFERENCE_COMMIT_REQUEST, operation: 'requestReferenceRegeneration' } as const

    expect(await handler('proposeReferenceAsset', request, signal())).toMatchObject({ ok: true })
    expect(await handler('previewElementProfile', previewRequest, signal())).toEqual({
      ok: true,
      value: referencePreviewFixture('requestReferenceRegeneration'),
    })
    expect(await handler('commitElementProfile', commitRequest, signal())).toEqual({
      ok: true,
      value: referenceCommitFixture('requestReferenceRegeneration'),
    })
    expect(await handler('recoverElementProfileCommit', commitRequest, signal())).toEqual({
      ok: true,
      value: referenceRecoveryFixture('requestReferenceRegeneration'),
    })
    expect(requests[0]?.body).toEqual({
      elementKind: 'prop',
      operation: 'requestReferenceRegeneration',
      candidateAssetId: REFERENCE_ASSET_ID,
      candidateAssetSha256: REFERENCE_ASSET_SHA,
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
      repairPrompt: '保留罗盘刻度，修复表面反光造成的细节丢失',
    })
    expect(requests[1]?.body).not.toHaveProperty('operation')
    expect(requests[2]?.body).not.toHaveProperty('operation')
    expect(requests[3]?.body).toBeUndefined()
  })

  it('verifies the reference attestation HMAC and exact target binding before token or fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const readToken = vi.fn(() => 'test-token')
    const handler = createYimengCommandHandler({}, { fetch, readToken })

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const forgedSignature = await handler('proposeReferenceAsset', {
      ...referenceProposalRequest(),
      methodAttestation: { ...REFERENCE_METHOD_ATTESTATION, signature: '0'.repeat(64) },
    }, signal())
    expect(forgedSignature).toMatchObject({ ok: false, error: { code: 'bad-request' } })

    const forgedTarget = await handler('proposeReferenceAsset', {
      ...referenceProposalRequest(),
      candidateAssetId: 'asset-reference-other',
    }, signal())
    expect(forgedTarget).toMatchObject({ ok: false, error: { code: 'bad-request' } })

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', 'short')
    const unavailable = await handler('proposeReferenceAsset', referenceProposalRequest(), signal())
    expect(unavailable).toEqual({
      ok: false,
      error: { code: 'internal', message: 'IMAGO method attestation is unavailable', details: {} },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()
  })

  it('fails reference preview, commit, and recovery closed on operation, asset, zero-execution, or receipt drift', async () => {
    const forgedCases = [
      {
        endpoint: 'previewElementProfile',
        request: REFERENCE_PREVIEW_REQUEST,
        value: { ...referencePreviewFixture(), operation: 'requestReferenceRegeneration' },
      },
      {
        endpoint: 'previewElementProfile',
        request: REFERENCE_PREVIEW_REQUEST,
        value: { ...referencePreviewFixture(), candidateAssetId: 'asset-reference-other' },
      },
      {
        endpoint: 'previewElementProfile',
        request: REFERENCE_PREVIEW_REQUEST,
        value: { ...referencePreviewFixture(), providerCalls: 1 },
      },
      {
        endpoint: 'commitElementProfile',
        request: REFERENCE_COMMIT_REQUEST,
        value: { ...referenceCommitFixture(), eventType: 'ReferenceRegenerationRequested' },
      },
      {
        endpoint: 'commitElementProfile',
        request: REFERENCE_COMMIT_REQUEST,
        value: { ...referenceCommitFixture(), workerStarted: true },
      },
      {
        endpoint: 'recoverElementProfileCommit',
        request: REFERENCE_COMMIT_REQUEST,
        value: { ...referenceRecoveryFixture(), receiptSha256: '0'.repeat(64) },
      },
    ] as const

    for (const forged of forgedCases) {
      const handler = createYimengCommandHandler({}, deps(async () => jsonResponse(forged.value), 'test-token'))
      const result = await handler(forged.endpoint, forged.request, signal())
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('runs a rights-only ChangeSet with its verified IMAGO proof and strips the Host token', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const fixture = referenceRightsContractFixture({
      rights: recordedReferenceRightsFixture(),
      baseSubject: elementSubjectRightsFixture(false, unknownReferenceRightsFixture()),
      changed: true,
      referenceInvalidated: true,
    })
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
      const url = requestUrl(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/elements/prop/prop-1/change-sets')) return jsonResponse(fixture.proposal, { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(fixture.preview)
      if (url.endsWith(':commit')) return jsonResponse(fixture.commit)
      if (url.endsWith('/command-receipt')) return jsonResponse(fixture.recovery)
      throw new Error(`unexpected URL: ${url}`)
    }, 'rights-test-token'))

    const proposal = await handler('proposeReferenceAsset', {
      ...fixture.proposalRequest,
      harnessSessionId: 'rights-session-1',
    }, signal())
    const preview = await handler('previewElementProfile', fixture.previewRequest, signal())
    const commit = await handler('commitElementProfile', fixture.commitRequest, signal())
    const recovery = await handler('recoverElementProfileCommit', fixture.commitRequest, signal())

    expect(proposal).toMatchObject({ ok: true, value: { nextAction: 'preview' } })
    expect(preview).toEqual({ ok: true, value: fixture.preview })
    expect(commit).toEqual({ ok: true, value: fixture.commit })
    expect(recovery).toEqual({ ok: true, value: fixture.recovery })
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets',
    )
    expect(requests[0]?.body).toEqual({
      elementKind: 'prop',
      operation: 'replaceReferenceRights',
      referenceAssetId: 'asset-1',
      referenceAssetSha256: 'd'.repeat(64),
      rights: recordedReferenceRightsFixture(),
      baseRevision: 4,
      baseSnapshotSha256: fixture.proposalRequest.baseSnapshotSha256,
      methodProjection: fixture.proposalRequest.methodProjection,
      methodProjectionSha256: fixture.proposalRequest.methodProjectionSha256,
      methodAttestation: fixture.proposalRequest.methodAttestation,
      harnessSessionId: 'rights-session-1',
    })
    expect(JSON.stringify(requests.map(request => request.body))).not.toContain('rights-test-token')
    expect(JSON.stringify([proposal, preview, commit, recovery])).not.toContain('rights-test-token')
    expect(fixture.commit).not.toHaveProperty('rights')
    expect(fixture.commit).not.toHaveProperty('providerCalls')
    expect(fixture.commit).not.toHaveProperty('workerStarted')
    const beforeReference = fixture.preview.baseSubject.references[0]
    const currentReference = fixture.preview.authoritativeCurrentSubject.references[0]
    expect(currentReference).toEqual(beforeReference)
    expect(currentReference).toMatchObject({
      assetId: 'asset-1',
      sha256: 'd'.repeat(64),
      selectionStatus: 'Selected',
      isSelected: true,
      rightsRecorded: false,
    })
    expect(fixture.preview.authoritativeCurrentSubject).toMatchObject({
      visualPrompt: '旧铜表面',
      officialReferenceImageUrl: '/api/media/asset-1',
    })
  })

  it('treats the first explicit unknown rights record as a real change', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const unknownRights = unknownReferenceRightsFixture()
    const fixture = referenceRightsContractFixture({
      rights: unknownRights,
      baseSubject: elementSubjectRightsFixture(false, unknownRights),
      changed: true,
      referenceInvalidated: true,
    })
    const handler = createYimengCommandHandler({}, deps(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/elements/prop/prop-1/change-sets')) return jsonResponse(fixture.proposal, { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(fixture.preview)
      if (url.endsWith(':commit')) return jsonResponse(fixture.commit)
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))

    expect(await handler('proposeReferenceAsset', fixture.proposalRequest, signal())).toMatchObject({ ok: true })
    expect(await handler('previewElementProfile', fixture.previewRequest, signal())).toMatchObject({
      ok: true,
      value: {
        changed: true,
        canCommit: true,
        proposedReferenceRights: unknownRights,
        baseSubject: { references: [{ rightsRecorded: false, rights: unknownRights }] },
      },
    })
    expect(await handler('commitElementProfile', fixture.commitRequest, signal())).toMatchObject({
      ok: true,
      value: { changed: true, authoritativeRevision: 5, referenceInvalidated: true },
    })
  })

  it('accepts an exact recorded-rights no-op without inventing a revision', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const rights = recordedReferenceRightsFixture()
    const fixture = referenceRightsContractFixture({
      rights,
      baseSubject: elementSubjectRightsFixture(true, rights),
      changed: false,
      referenceInvalidated: false,
    })
    const handler = createYimengCommandHandler({}, deps(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/elements/prop/prop-1/change-sets')) return jsonResponse(fixture.proposal, { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(fixture.preview)
      if (url.endsWith(':commit')) return jsonResponse(fixture.commit)
      if (url.endsWith('/command-receipt')) return jsonResponse(fixture.recovery)
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))

    expect(await handler('proposeReferenceAsset', fixture.proposalRequest, signal())).toMatchObject({ ok: true })
    expect(await handler('previewElementProfile', fixture.previewRequest, signal())).toMatchObject({
      ok: true,
      value: { changed: false, canCommit: true, referenceInvalidationExpected: false },
    })
    expect(await handler('commitElementProfile', fixture.commitRequest, signal())).toMatchObject({
      ok: true,
      value: {
        changed: false,
        authoritativeRevision: 4,
        eventType: 'ElementProfileChanged',
        referenceInvalidated: false,
      },
    })
    expect(await handler('recoverElementProfileCommit', fixture.commitRequest, signal())).toMatchObject({
      ok: true,
      value: { recovered: true, receipt: { changed: false, authoritativeRevision: 4 } },
    })
  })

  it('recovers a lost rights commit response by one receipt GET and never posts the commit twice', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const fixture = referenceRightsContractFixture({
      rights: recordedReferenceRightsFixture(),
      baseSubject: elementSubjectRightsFixture(false, unknownReferenceRightsFixture()),
      changed: true,
      referenceInvalidated: true,
    })
    const requests: Array<{ url: string; method: string | undefined; body: BodyInit | null | undefined }> = []
    const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
      const url = requestUrl(input)
      requests.push({ url, method: init.method, body: init.body })
      if (url.endsWith(':commit')) throw new TypeError('connection closed after upstream accepted the commit')
      if (url.endsWith('/command-receipt')) return jsonResponse(fixture.recovery)
      throw new Error(`unexpected URL: ${url}`)
    }, 'test-token'))

    expect(await handler('commitElementProfile', fixture.commitRequest, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(await handler('recoverElementProfileCommit', fixture.commitRequest, signal())).toEqual({
      ok: true,
      value: fixture.recovery,
    })
    expect(requests.map(request => [new URL(request.url).pathname, request.method])).toEqual([
      ['/api/qingmu/change-sets/changeset-rights-1:commit', 'POST'],
      ['/api/qingmu/projects/project-1/elements/prop/prop-1/change-sets/changeset-rights-1/command-receipt', 'GET'],
    ])
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(1)
    expect(requests[1]?.body).toBeUndefined()
  })

  it('fails rights input, proof, preview, commit, and recovery contracts closed', async () => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', ATTESTATION_KEY)
    const fixture = referenceRightsContractFixture({
      rights: recordedReferenceRightsFixture(),
      baseSubject: elementSubjectRightsFixture(false, unknownReferenceRightsFixture()),
      changed: true,
      referenceInvalidated: true,
    })
    const fetch = vi.fn<typeof globalThis.fetch>()
    const inputHandler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    const inputCases = [
      { ...fixture.proposalRequest, proof: 'browser-proof' },
      { ...fixture.proposalRequest, token: 'browser-token' },
      {
        ...fixture.proposalRequest,
        rights: { ...recordedReferenceRightsFixture(), exceptionApproved: true },
      },
      {
        ...fixture.proposalRequest,
        methodAttestation: { ...fixture.proposalRequest.methodAttestation, signature: '0'.repeat(64) },
      },
      {
        ...fixture.proposalRequest,
        methodProjection: { ...fixture.proposalRequest.methodProjection, referenceAssetId: 'asset-1' },
      },
    ]
    for (const input of inputCases) {
      expect(await inputHandler('proposeReferenceAsset', input, signal())).toMatchObject({
        ok: false,
        error: { code: 'bad-request' },
      })
    }
    expect(fetch).not.toHaveBeenCalled()

    const oldSubject = { ...fixture.preview.baseSubject, schema: 'jason.qingmu-element-profile-subject.v1' }
    const malformedResponses = [
      {
        endpoint: 'previewElementProfile',
        request: fixture.previewRequest,
        response: { ...fixture.preview, baseSubject: oldSubject },
      },
      {
        endpoint: 'previewElementProfile',
        request: fixture.previewRequest,
        response: {
          ...fixture.preview,
          proposedReferenceRights: { ...recordedReferenceRightsFixture(), unknownField: true },
        },
      },
      {
        endpoint: 'previewElementProfile',
        request: fixture.previewRequest,
        response: { ...fixture.preview, providerCalls: 0 },
      },
      {
        endpoint: 'commitElementProfile',
        request: fixture.commitRequest,
        response: { ...fixture.commit, authoritativeRevision: 4 },
      },
      {
        endpoint: 'commitElementProfile',
        request: fixture.commitRequest,
        response: { ...fixture.commit, eventType: 'ElementProfileChanged' },
      },
      {
        endpoint: 'commitElementProfile',
        request: fixture.commitRequest,
        response: { ...fixture.commit, rights: recordedReferenceRightsFixture() },
      },
      {
        endpoint: 'recoverElementProfileCommit',
        request: fixture.commitRequest,
        response: { ...fixture.recovery, receiptSha256: '0'.repeat(64) },
      },
    ] as const
    for (const malformed of malformedResponses) {
      const handler = createYimengCommandHandler({}, deps(async () => jsonResponse(malformed.response), 'test-token'))
      expect(await handler(malformed.endpoint, malformed.request, signal())).toMatchObject({
        ok: false,
        error: { code: 'internal' },
      })
    }
  })

  it('uses one ChangeSet contract for actor visualIdentity and scene or prop visualPrompt', async () => {
    for (const elementKind of ['actor', 'scene', 'prop'] as const) {
      const fixture = elementContractFixture(elementKind)
      const requests: Array<{ url: string; body: unknown }> = []
      const handler = createYimengCommandHandler({}, deps(async (input, init = {}) => {
        const url = requestUrl(input)
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        requests.push({ url, body })
        if (url.endsWith('/change-sets') && !url.endsWith('/command-receipt')) {
          return jsonResponse(fixture.proposal, { status: 201 })
        }
        if (url.endsWith(':preview')) return jsonResponse(fixture.preview)
        if (url.endsWith(':commit')) return jsonResponse(fixture.commit)
        if (url.endsWith('/command-receipt')) return jsonResponse(fixture.recovery)
        throw new Error(`unexpected URL: ${url}`)
      }, 'test-token'))

      const proposal = await handler('proposeElementProfile', fixture.proposeRequest, signal())
      const preview = await handler('previewElementProfile', fixture.previewRequest, signal())
      const commit = await handler('commitElementProfile', fixture.commitRequest, signal())
      const recovery = await handler('recoverElementProfileCommit', fixture.commitRequest, signal())

      expect(proposal).toMatchObject({ ok: true, value: { changeSet: { targetId: fixture.targetId } } })
      expect(preview).toMatchObject({
        ok: true,
        value: {
          elementKind,
          operation: fixture.operation,
          impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
          impactSha256: ELEMENT_IMPACT_SHA,
        },
      })
      expect(commit).toMatchObject({
        ok: true,
        value: {
          elementKind,
          operation: fixture.operation,
          impactAnalysis: ELEMENT_IMPACT_ANALYSIS,
          impactSha256: ELEMENT_IMPACT_SHA,
        },
      })
      expect(recovery).toMatchObject({
        ok: true,
        value: { recovered: true, receipt: { elementKind, operation: fixture.operation } },
      })
      expect(requests.map(item => item.url)).toEqual([
        `http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/${elementKind}/${fixture.targetId}/change-sets`,
        `http://127.0.0.1:8115/api/qingmu/change-sets/changeset-${elementKind}-1:preview`,
        `http://127.0.0.1:8115/api/qingmu/change-sets/changeset-${elementKind}-1:commit`,
        `http://127.0.0.1:8115/api/qingmu/projects/project-1/elements/${elementKind}/${fixture.targetId}/change-sets/changeset-${elementKind}-1/command-receipt`,
      ])
      expect(requests[0]?.body).toEqual({
        elementKind,
        operation: fixture.operation,
        ...(elementKind === 'actor'
          ? { visualIdentity: fixture.visualValue }
          : { visualPrompt: fixture.visualValue }),
        baseRevision: 4,
        baseSnapshotSha256: fixture.baseSnapshotSha256,
        methodProjection: fixture.methodProjection,
        methodProjectionSha256: fixture.methodProjectionSha256,
        methodAttestation: fixture.methodAttestation,
      })
      expect(JSON.stringify(requests[0]?.body)).not.toContain(
        elementKind === 'actor' ? 'visualPrompt' : 'visualIdentity',
      )
    }
  })

  it('rejects malformed or unbound method attestations before forwarding', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    const request = {
      projectId: 'project-1',
      targetType: 'element_profile',
      targetId: 'prop-1',
      elementKind: 'prop',
      operation: 'replaceVisualPrompt',
      visualPrompt: '新铜表面，保留清晰刻度',
      baseRevision: 4,
      baseSnapshotSha256: ELEMENT_SNAPSHOT_SHA,
      methodProjection: ELEMENT_METHOD_PROJECTION,
      methodProjectionSha256: ELEMENT_METHOD_SHA,
      methodAttestation: ELEMENT_METHOD_ATTESTATION,
    } as const
    const malformed = [
      { ...ELEMENT_METHOD_ATTESTATION, extra: true },
      { ...ELEMENT_METHOD_ATTESTATION, signature: 'ABC' },
      { ...ELEMENT_METHOD_ATTESTATION, algorithm: 'sha256' },
      { ...ELEMENT_METHOD_ATTESTATION, projectionSha256: '0'.repeat(64) },
      { ...ELEMENT_METHOD_ATTESTATION, inputSnapshotSha256: '0'.repeat(64) },
      { ...ELEMENT_METHOD_ATTESTATION, subjectSha256: '0'.repeat(64) },
    ]

    for (const methodAttestation of malformed) {
      const result = await handler('proposeElementProfile', { ...request, methodAttestation }, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('malformed attestation should fail')
      expect(result.error.code).toBe('bad-request')
    }
    const { signature: _signature, ...missingSignature } = ELEMENT_METHOD_ATTESTATION
    const missing = await handler('proposeElementProfile', {
      ...request,
      methodAttestation: missingSignature,
    }, signal())
    expect(missing.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails element-profile commands closed on cross-kind fields, operations, method subjects, and response lineage', async () => {
    const actor = elementContractFixture('actor')
    const scene = elementContractFixture('scene')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(actor.proposal, { status: 201 }))
    const readToken = vi.fn(() => 'test-token')
    const handler = createYimengCommandHandler({}, { fetch, readToken })
    const actorWithoutVisualIdentity: Record<string, unknown> = { ...actor.proposeRequest }
    const sceneWithoutVisualPrompt: Record<string, unknown> = { ...scene.proposeRequest }
    Reflect.deleteProperty(actorWithoutVisualIdentity, 'visualIdentity')
    Reflect.deleteProperty(sceneWithoutVisualPrompt, 'visualPrompt')
    const invalidInputs = [
      { ...actor.proposeRequest, operation: 'replaceVisualPrompt' },
      { ...actorWithoutVisualIdentity, visualPrompt: '用道具字段冒充人物身份' },
      { ...sceneWithoutVisualPrompt, visualIdentity: '用人物字段冒充环境提示' },
    ]
    for (const request of invalidInputs) {
      const result = await handler('proposeElementProfile', request, signal())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('cross-kind element proposal should fail')
      expect(result.error.code).toBe('bad-request')
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()

    const forgedMethodSubject = await handler('proposeElementProfile', {
      ...actor.proposeRequest,
      methodProjection: ELEMENT_METHOD_PROJECTION,
      methodProjectionSha256: ELEMENT_METHOD_SHA,
      methodAttestation: ELEMENT_METHOD_ATTESTATION,
    }, signal())
    expect(forgedMethodSubject.ok).toBe(false)
    if (forgedMethodSubject.ok) throw new Error('cross-kind method projection subject should fail')
    expect(forgedMethodSubject.error.code).toBe('bad-request')
    expect(fetch).not.toHaveBeenCalled()

    const actorPreview = actor.preview
    const actorPreviewWithoutIdentity: Record<string, unknown> = { ...actorPreview }
    Reflect.deleteProperty(actorPreviewWithoutIdentity, 'proposedVisualIdentity')
    const forgedResponses = [
      { value: { ...actorPreview, targetId: 'actor-2' }, message: 'preview element subject mismatch' },
      { value: { ...actorPreview, elementKind: 'prop' }, message: 'preview.elementKind mismatch' },
      { value: { ...actorPreview, operation: 'replaceVisualPrompt' }, message: 'preview.operation must be replaceVisualIdentity for actor' },
      {
        value: { ...actorPreviewWithoutIdentity, proposedVisualPrompt: '冒充人物身份' },
        message: 'preview.proposedVisualIdentity must be a non-empty string',
      },
      {
        value: {
          ...actorPreview,
          impactAnalysis: { ...actorPreview.impactAnalysis, impreciseSummary: [] },
        },
        message: 'preview.impactAnalysis must contain exactly the seven impact arrays',
      },
      { value: { ...actorPreview, impactSha256: '0'.repeat(64) }, message: 'preview impact sha256 mismatch' },
    ]
    for (const forged of forgedResponses) {
      const forgedHandler = createYimengCommandHandler({}, deps(
        async () => jsonResponse(forged.value),
        'test-token',
      ))
      const result = await forgedHandler('previewElementProfile', actor.previewRequest, signal())
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'internal',
          message: `Yimeng command contract failed: ${forged.message}`,
          details: {},
        },
      })
    }

    const forgedCommitHandler = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...actor.commit, impactSha256: '0'.repeat(64) }),
      'test-token',
    ))
    expect(await forgedCommitHandler('commitElementProfile', actor.commitRequest, signal())).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng command contract failed: commit impact sha256 mismatch',
        details: {},
      },
    })
  })

  it('performs commands and read-only receipt recovery with Host-only Bearer and strict transport', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = []
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      const url = requestUrl(input)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      requests.push({ url, init, body })
      if (url.endsWith('/script/change-sets')) return jsonResponse(proposalFixture(), { status: 201 })
      if (url.endsWith(':preview')) return jsonResponse(previewFixture())
      if (url.endsWith(':commit')) return jsonResponse(commitFixture())
      if (url.endsWith('/command-receipt')) return jsonResponse(recoveryFixture())
      throw new Error(`unexpected URL: ${url}`)
    }
    const handler = createYimengCommandHandler({}, deps(fetch, 'test-token'))
    const script = { scenes: [{ sceneIndex: 1, title: '新场景', dialogues: [] }] }

    const proposal = await handler('proposeScript', {
      projectId: 'project-1',
      episodeId: 'episode-1',
      script,
      baseRevision: 2,
      harnessSessionId: 'session-1',
      references: [{ kind: 'human_note', id: 'note-1' }],
    }, signal())
    const preview = await handler('previewScript', PREVIEW_REQUEST, signal())
    const commit = await handler('commitScript', COMMIT_REQUEST, signal())
    const recovery = await handler('recoverScriptCommit', COMMIT_REQUEST, signal())

    expect(proposal.ok).toBe(true)
    if (!proposal.ok) throw new Error('proposal should succeed')
    expect(proposal.value).toMatchObject({
      schema: 'jason.qingmu-change-set-proposal.v1',
      changeSet: { id: 'changeset-1', retained: { source: 'test' } },
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) throw new Error('preview should succeed')
    expect(preview.value).toMatchObject({ canCommit: true, previewSha256: PREVIEW_SHA })
    expect(commit.ok).toBe(true)
    if (!commit.ok) throw new Error('commit should succeed')
    expect(commit.value).toMatchObject({
      commandReceiptId: 'receipt-1',
      eventId: 'event-1',
      deduplicated: false,
    })
    expect(recovery.ok).toBe(true)
    if (!recovery.ok) throw new Error('receipt recovery should succeed')
    expect(recovery.value).toMatchObject({
      schema: 'jason.qingmu-command-receipt-recovery.v1',
      recovered: true,
      receiptSha256: RECEIPT_SHA,
      receipt: { commandReceiptId: 'receipt-1', deduplicated: false },
    })
    expect(requests.map(item => item.url)).toEqual([
      'http://127.0.0.1:8115/api/qingmu/episodes/episode-1/script/change-sets',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-1:preview',
      'http://127.0.0.1:8115/api/qingmu/change-sets/changeset-1:commit',
      'http://127.0.0.1:8115/api/qingmu/projects/project-1/episodes/episode-1/change-sets/changeset-1/command-receipt',
    ])
    expect(requests[0]?.body).toEqual({
      projectId: 'project-1',
      script,
      baseRevision: 2,
      harnessSessionId: 'session-1',
      references: [{ kind: 'human_note', id: 'note-1' }],
    })
    expect(requests[1]?.body).toEqual({
      projectId: 'project-1',
      episodeId: 'episode-1',
      baseRevision: 2,
    })
    expect(requests[2]?.body).toEqual({
      projectId: 'project-1',
      episodeId: 'episode-1',
      baseRevision: 2,
      idempotencyKey: 'qingmu-changeset-1',
      expectedPayloadSha256: PAYLOAD_SHA,
    })
    expect(requests[3]?.body).toBeUndefined()
    for (const request of requests.slice(0, 3)) {
      const headers = new Headers(request.init.headers)
      expect(request.init.method).toBe('POST')
      expect(request.init.redirect).toBe('error')
      expect(headers.get('authorization')).toBe('Bearer test-token')
      expect(headers.has('cookie')).toBe(false)
    }
    const recoveryRequest = requests[3]
    expect(recoveryRequest?.init.method).toBe('GET')
    expect(new URL(recoveryRequest?.url ?? '').search).toBe('')
    const recoveryHeaders = new Headers(recoveryRequest?.init.headers)
    expect(recoveryHeaders.get('authorization')).toBe(['Bearer', 'test-token'].join(' '))
    expect(recoveryHeaders.get('idempotency-key')).toBe(COMMIT_REQUEST.idempotencyKey)
    expect(recoveryHeaders.has('content-type')).toBe(false)
    expect(recoveryHeaders.has('cookie')).toBe(false)
  })

  it('fails input and response contracts closed without reflecting upstream bodies', async () => {
    const readToken = vi.fn(() => 'test-token')
    const fetch = vi.fn<typeof globalThis.fetch>()
    const handler = createYimengCommandHandler({}, { fetch, readToken })
    const invalid = await handler('commitScript', {
      ...COMMIT_REQUEST,
      idempotencyKey: 'short',
      expectedPayloadSha256: 'not-a-sha',
      unexpected: true,
    }, signal())
    expect(invalid.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()

    const headerInjection = await handler('recoverScriptCommit', {
      ...COMMIT_REQUEST,
      idempotencyKey: 'qingmu-valid\r\ninjected: true',
    }, signal())
    expect(headerInjection).toEqual({
      ok: false,
      error: { code: 'bad-request', message: 'idempotencyKey must not contain line breaks', details: { issues: [] } },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()

    const conflict = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ detail: { code: 'script_revision_conflict', secret: 'hidden' } }, { status: 409 }),
      'test-token',
    ))
    const result = await conflict('previewScript', PREVIEW_REQUEST, signal())
    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng rejected command (HTTP 409: script_revision_conflict)', details: {} },
    })
    expect(JSON.stringify(result)).not.toContain('hidden')

    const malformed = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...previewFixture(), schema: 'jason.qingmu-change-set-preview.v0' }),
      'test-token',
    ))
    const malformedResult = await malformed('previewScript', PREVIEW_REQUEST, signal())
    expect(malformedResult).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: preview.schema mismatch', details: {} },
    })
  })

  it('rejects response subjects and lineage that do not match the command request', async () => {
    const wrongEpisode = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...proposalFixture(),
        changeSet: { ...changeSetFixture(), episodeId: 'episode-2', targetId: 'episode-2' },
      }),
      'test-token',
    ))
    expect(await wrongEpisode('proposeScript', {
      projectId: 'project-1',
      episodeId: 'episode-1',
      script: { scenes: [] },
      baseRevision: 2,
    }, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: proposal project or episode subject mismatch', details: {} },
    })

    const wrongPreview = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...previewFixture(), changeSetId: 'changeset-2' }),
      'test-token',
    ))
    expect(await wrongPreview('previewScript', PREVIEW_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: preview changeSet subject mismatch', details: {} },
    })

    const wrongEpisodePreview = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...previewFixture(),
        changeSet: { ...changeSetFixture(), episodeId: 'episode-2', targetId: 'episode-2' },
      }),
      'test-token',
    ))
    expect(await wrongEpisodePreview('previewScript', PREVIEW_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: preview episode subject mismatch', details: {} },
    })

    const conflictingPreview = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...previewFixture(), revisionConflict: true, canCommit: true }),
      'test-token',
    ))
    expect(await conflictingPreview('previewScript', PREVIEW_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: preview conflict cannot be committable', details: {} },
    })

    const wrongCommit = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...commitFixture(), payloadSha256: 'd'.repeat(64) }),
      'test-token',
    ))
    expect(await wrongCommit('commitScript', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: commit payload lineage mismatch', details: {} },
    })

    const wrongBaseCommit = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...commitFixture(), baseRevision: 3 }),
      'test-token',
    ))
    expect(await wrongBaseCommit('commitScript', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: commit baseRevision lineage mismatch', details: {} },
    })

    const wrongProjectPreview = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...previewFixture(),
        changeSet: { ...changeSetFixture(), projectId: 'project-2' },
      }),
      'test-token',
    ))
    expect(await wrongProjectPreview('previewScript', PREVIEW_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: preview project subject mismatch', details: {} },
    })

    const wrongProjectCommit = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...commitFixture(), projectId: 'project-2' }),
      'test-token',
    ))
    expect(await wrongProjectCommit('commitScript', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: commit project subject mismatch', details: {} },
    })

    const wrongRecoveryReceipt = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...recoveryFixture(),
        receipt: { ...commitFixture(), baseRevision: 1 },
      }),
      'test-token',
    ))
    expect(await wrongRecoveryReceipt('recoverScriptCommit', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: recovery receipt sha256 mismatch', details: {} },
    })

    const wrongRecoveryHash = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...recoveryFixture(), receiptSha256: 'f'.repeat(64) }),
      'test-token',
    ))
    expect(await wrongRecoveryHash('recoverScriptCommit', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: recovery receipt sha256 mismatch', details: {} },
    })

    const incompleteRecovery = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...recoveryFixture(), recovered: false }),
      'test-token',
    ))
    expect(await incompleteRecovery('recoverScriptCommit', COMMIT_REQUEST, signal())).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: recovery.recovered mismatch', details: {} },
    })
  })

  it('bounds command response bytes and removes reflected credentials', async () => {
    const oversized = createYimengCommandHandler({}, deps(
      async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }),
      'test-token',
    ))
    const reflected = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...proposalFixture(),
        authorization: 'Bearer test-token',
        debug: { refresh_token: 'test-token', note: 'prefix-test-token-suffix', 'test-token': 'reflected-key' },
      }),
      'test-token',
    ))

    const request = {
      projectId: 'project-1',
      episodeId: 'episode-1',
      script: { scenes: [] },
      baseRevision: 2,
    }
    const oversizedResult = await oversized('proposeScript', request, signal())
    const reflectedResult = await reflected('proposeScript', request, signal())

    expect(oversizedResult).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng response exceeded size limit', details: {} },
    })
    expect(reflectedResult.ok).toBe(true)
    expect(JSON.stringify(reflectedResult)).not.toContain('test-token')
    expect(reflectedResult).toMatchObject({
      ok: true,
      value: { debug: { note: 'prefix-[REDACTED]-suffix' } },
    })
  })

  it('keeps PromptIR edit and authenticated selection as separate receipt-backed commands', async () => {
    const responses = [
      promptIrProposalFixture(),
      promptIrPreviewFixture(),
      promptIrEditCommitFixture(),
      recoveryEnvelope(promptIrEditCommitFixture()),
      promptIrSelectionFixture(),
      recoveryEnvelope(promptIrSelectionFixture()),
    ]
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const handler = createYimengCommandHandler({}, deps(async (input, init) => {
      requests.push({ url: requestUrl(input), init })
      return jsonResponse(responses[requests.length - 1])
    }, 'test-token'))

    await expect(handler('proposePromptIr', PROMPT_IR_PROPOSAL_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
        nextAction: 'preview',
      },
    })
    await expect(handler('previewPromptIr', PROMPT_IR_PREVIEW_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        providerCalls: 0,
        workerStarted: false,
        humanApprovalInferred: false,
        humanSignoff: false,
        candidatePromptIr: { status: 'Draft' },
      },
    })
    await expect(handler('commitPromptIrEdit', PROMPT_IR_EDIT_COMMIT_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        eventType: 'PromptIrDraftCommitted',
        promptIr: { id: 'prompt-ir-draft-5', status: 'Draft' },
        previousReadyPromptIr: { id: 'prompt-ir-ready-4', status: 'Ready' },
        providerCalls: 0,
        humanSignoff: false,
      },
    })
    await expect(handler('recoverPromptIrEditCommit', PROMPT_IR_EDIT_COMMIT_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: { recovered: true, receipt: { eventType: 'PromptIrDraftCommitted' } },
    })
    await expect(handler('selectPromptIr', PROMPT_IR_SELECT_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        eventType: 'PromptIrSelected',
        selectedPromptIr: { id: 'prompt-ir-draft-5', status: 'Ready' },
        providerCall: false,
        humanApprovalInferred: false,
        humanSignoff: false,
      },
    })
    await expect(handler('recoverPromptIrSelection', PROMPT_IR_SELECT_REQUEST, signal())).resolves.toMatchObject({
      ok: true,
      value: { recovered: true, receipt: { eventType: 'PromptIrSelected' } },
    })

    expect(requests.map(request => [new URL(request.url).pathname, request.init?.method])).toEqual([
      ['/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/storyboard-revision-1/frames/frame-1/prompt-ir/change-sets', 'POST'],
      ['/api/qingmu/change-sets/changeset-prompt-ir-1:preview', 'POST'],
      ['/api/qingmu/change-sets/changeset-prompt-ir-1:commit', 'POST'],
      ['/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/storyboard-revision-1/frames/frame-1/prompt-ir/change-sets/changeset-prompt-ir-1/command-receipt', 'GET'],
      ['/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/storyboard-revision-1/frames/frame-1/prompt-ir:select', 'POST'],
      ['/api/qingmu/projects/project-1/episodes/episode-1/storyboard-revisions/storyboard-revision-1/frames/frame-1/prompt-ir/selection-command-receipt', 'GET'],
    ])
    expect(requestJsonBody(requests[0]?.init)).toEqual({
      basePromptIrId: 'prompt-ir-ready-4',
      baseVersion: 4,
      baseContentSha256: PROMPT_IR_BASE_CONTENT_SHA,
      replacements: { motionPrompt: PROMPT_IR_AFTER.motionPrompt },
      harnessSessionId: 'harness-session-1',
      references: [{ kind: 'shot', id: 'shot-1' }],
    })
    expect(requestJsonBody(requests[1]?.init)).toEqual({
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'prompt_ir',
      targetId: PROMPT_IR_TARGET_ID,
      storyboardRevisionId: 'storyboard-revision-1',
      frameId: 'frame-1',
      basePromptIrId: 'prompt-ir-ready-4',
      baseRevision: 4,
      baseSnapshotSha256: SNAPSHOT_SHA,
    })
    expect(requestJsonBody(requests[2]?.init)).toEqual({
      ...(requestJsonBody(requests[1]?.init) as Record<string, unknown>),
      idempotencyKey: PROMPT_IR_EDIT_COMMIT_REQUEST.idempotencyKey,
      expectedPayloadSha256: PROMPT_IR_CHANGESET_SHA,
    })
    expect(new Headers(requests[3]?.init?.headers).get('Idempotency-Key')).toBe(
      PROMPT_IR_EDIT_COMMIT_REQUEST.idempotencyKey,
    )
    expect(requests[3]?.init?.body).toBeUndefined()
    expect(requestJsonBody(requests[4]?.init)).toEqual({
      draftPromptIrId: PROMPT_IR_SELECT_REQUEST.draftPromptIrId,
      draftVersion: PROMPT_IR_SELECT_REQUEST.draftVersion,
      draftContentSha256: PROMPT_IR_SELECT_REQUEST.draftContentSha256,
      idempotencyKey: PROMPT_IR_SELECT_REQUEST.idempotencyKey,
    })
    expect(new Headers(requests[5]?.init?.headers).get('Idempotency-Key')).toBe(
      PROMPT_IR_SELECT_REQUEST.idempotencyKey,
    )
  })

  it('fails PromptIR commands closed on invalid edits, lineage drift, or execution claims', async () => {
    const unreachable = vi.fn<typeof globalThis.fetch>()
    const inputHandler = createYimengCommandHandler({}, deps(unreachable, 'test-token'))
    await expect(inputHandler('proposePromptIr', {
      ...PROMPT_IR_PROPOSAL_REQUEST,
      replacements: {},
    }, signal())).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(inputHandler('proposePromptIr', {
      ...PROMPT_IR_PROPOSAL_REQUEST,
      replacements: { compiled: 'forged' },
    }, signal())).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(inputHandler('previewPromptIr', {
      ...PROMPT_IR_PREVIEW_REQUEST,
      targetId: 'another-revision:frame-1',
    }, signal())).resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(unreachable).not.toHaveBeenCalled()

    const executionClaim = createYimengCommandHandler({}, deps(
      async () => jsonResponse({ ...promptIrPreviewFixture(), providerCalls: 1 }),
      'test-token',
    ))
    await expect(executionClaim('previewPromptIr', PROMPT_IR_PREVIEW_REQUEST, signal())).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'Yimeng command contract failed: promptIrPreview.providerCalls must be zero',
        details: {},
      },
    })

    const wrongDraft = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...promptIrSelectionFixture(),
        selectedPromptIr: {
          ...promptIrSelectionFixture().selectedPromptIr,
          contentSha256: 'f'.repeat(64),
        },
      }),
      'test-token',
    ))
    await expect(wrongDraft('selectPromptIr', PROMPT_IR_SELECT_REQUEST, signal())).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: promptIrSelection lineage mismatch' },
    })

    const wrongRecoveryHash = createYimengCommandHandler({}, deps(
      async () => jsonResponse({
        ...recoveryEnvelope(promptIrEditCommitFixture()),
        receiptSha256: 'f'.repeat(64),
      }),
      'test-token',
    ))
    await expect(wrongRecoveryHash(
      'recoverPromptIrEditCommit',
      PROMPT_IR_EDIT_COMMIT_REQUEST,
      signal(),
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed: promptIrEditRecovery receipt sha256 mismatch' },
    })
  })

  it('accepts only pathless loopback upstreams', () => {
    for (const baseUrl of [
      'https://example.com',
      'file:///tmp/yimeng',
      'http://127.0.0.1:8115/api',
      'http://user:password@127.0.0.1:8115',
      'http://127.0.0.1.evil.example:8115',
    ]) {
      expect(() => createYimengCommandHandler({ baseUrl })).toThrow(/baseUrl/)
    }
    expect(() => createYimengCommandHandler({ baseUrl: 'https://[::1]:8115' })).not.toThrow()
    expect(() => createYimengCommandHandler({ baseUrl: 'http://127.42.0.1:8115' })).not.toThrow()
  })
})
