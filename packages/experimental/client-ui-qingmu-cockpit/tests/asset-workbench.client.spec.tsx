// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssetWorkbench } from '../src/client/AssetWorkbench.tsx'
import type {
  ImagoReferenceAssetMethodRequest,
  QingmuYimengPort,
  YimengElementReviewFeedResponse,
  YimengReferenceAssetCandidate,
} from '../src/client/contracts.ts'
import {
  createCommandCommitRecoveryMarker,
  readCommandCommitRecoveryMarker,
  writeCommandCommitRecoveryMarker,
} from '../src/client/command-commit-recovery.ts'
import { zh } from '../src/client/locales.ts'

const PROJECT_ID = 'project-1'
const TARGET_ID = 'prop-1'
const BASE_SHA = 'a'.repeat(64)
const PAYLOAD_SHA = 'b'.repeat(64)
const METHOD_SHA = 'c'.repeat(64)
const UPDATED_SHA = 'd'.repeat(64)
const RECEIPT_SHA = 'e'.repeat(64)
const UPDATED_METHOD_SHA = 'f'.repeat(64)
const IMPACT_SHA = '7'.repeat(64)
const OLD_PROMPT = '一枚磨损的银色怀表，表盖闭合。'
const NEW_PROMPT = '一枚磨损的银色怀表，表盖有细小裂痕，指针停在午夜十二点。'
const CHANGE_SET_ID = 'changeset-prop-1'
const IDEMPOTENCY_KEY = `qingmu:element:v4:faa0d4311297d15a4287746d5c19fd928688d2dde43ff3db8eb2dab86740b2cb:${PAYLOAD_SHA}`

const t = (key: keyof typeof zh) => zh[key]

const UNKNOWN_RIGHTS = {
  schema: 'jason.qingmu-reference-rights-record.v1',
  sourceType: { state: 'unknown', value: null },
  rightsHolder: { state: 'unknown', value: null },
  authorizationScope: { state: 'unknown', values: [] },
  territory: { state: 'unknown', values: [] },
  term: { state: 'unknown', startsAt: null, endsAt: null, perpetual: null },
  restrictions: { state: 'unknown', values: [] },
  contains: {
    realPersonLikeness: 'unknown',
    trademark: 'unknown',
    music: 'unknown',
    font: 'unknown',
    thirdPartyCharacter: 'unknown',
  },
  providerTerms: { state: 'unknown', terms: null, reviewedAt: null },
  modelLicenses: {
    code: { state: 'unknown', value: null },
    weights: { state: 'unknown', value: null },
    outputUse: { state: 'unknown', value: null },
  },
  humanDeclaration: { state: 'unknown', text: null },
  contentCredentials: { state: 'unknown', value: null },
} as const

const SNAPSHOT = {
  schema: 'jason.qingmu-element-profile-subject-read.v2',
  subject: {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    elementKind: 'prop',
    propId: TARGET_ID,
    profileRevision: 3,
    name: '银色怀表',
    visualPrompt: OLD_PROMPT,
    officialReferenceImageUrl: '/media/props/prop-1.png',
    references: [{
      assetId: 'reference-1',
      sha256: '1'.repeat(64),
      selectionStatus: 'Selected',
      isSelected: true,
      rightsRecorded: false,
      rights: UNKNOWN_RIGHTS,
    }],
  },
  canonicalSnapshot: {
    propId: TARGET_ID,
    profileRevision: 3,
    visualPrompt: OLD_PROMPT,
  },
  snapshotSha256: BASE_SHA,
} as const

const UPDATED_SNAPSHOT = {
  ...SNAPSHOT,
  subject: {
    ...SNAPSHOT.subject,
    profileRevision: 4,
    visualPrompt: NEW_PROMPT,
    officialReferenceImageUrl: null,
    references: [{
      ...SNAPSHOT.subject.references[0],
      selectionStatus: 'Stale',
      isSelected: false,
    }],
  },
  canonicalSnapshot: {
    propId: TARGET_ID,
    profileRevision: 4,
    visualPrompt: NEW_PROMPT,
  },
  snapshotSha256: UPDATED_SHA,
} as const

function methodResponse(request: {
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly elementKind?: 'actor' | 'scene' | 'prop'
  readonly targetId?: string
}) {
  const elementKind = request.elementKind ?? 'prop'
  const targetId = request.targetId ?? TARGET_ID
  const operation = elementKind === 'actor' ? 'replaceVisualIdentity' : 'replaceVisualPrompt'
  const projectionSha256 = request.baseRevision === 3 ? METHOD_SHA : UPDATED_METHOD_SHA
  return {
    schema: 'qingmu.imago-element-method-adapter-result.v1',
    projectionSha256,
    projection: {
      schema: 'qingmu.imago-element-method-projection.v1',
      input_snapshot_sha256: '2'.repeat(64),
      subject: {
        project_id: PROJECT_ID,
        target_type: 'element_profile',
        target_id: targetId,
        element_kind: elementKind,
        scope_type: 'project',
        scope_id: PROJECT_ID,
        base_revision: request.baseRevision,
        base_snapshot_sha256: request.baseSnapshotSha256,
      },
      method_definition: { id: `imago-v6-${elementKind}-profile`, sha256: '3'.repeat(64) },
      source_bindings: [],
      field_hints: [{ hint_id: 'story-function', title: '叙事功能', guidance: '写清楚道具为何出现在故事里。' }],
      checklist: [{ check_id: 'story-purpose-explicit', label: '叙事功能明确', required: true }],
      work_order_projection: { operation },
      review_card: { title: '道具资料变更审核', hard_vetoes: ['不得使用占位描述'] },
      legal_work_set: {
        reads: ['yimeng_prop_profile_snapshot'],
        writes: ['replace_visual_prompt_via_changeset'],
        forbidden: ['provider_dispatch', 'asset_generation', 'asset_selection', 'human_decision'],
      },
      authority_snapshot_attestation: 'not_verified_by_compiler',
      project_state_persisted: false,
      paid_provider_authority: 'not_granted',
      human_approval_inferred: false,
      selection_authority: 'not_granted',
    },
    methodAttestation: {
      schema: 'qingmu.imago-element-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256,
      inputSnapshotSha256: '2'.repeat(64),
      subjectSha256: '5'.repeat(64),
      signature: '6'.repeat(64),
    },
  } as const
}

const CHANGE_SET = {
  schema: 'jason.qingmu-change-set.v1',
  id: CHANGE_SET_ID,
  workspaceId: null,
  projectId: PROJECT_ID,
  episodeId: null,
  targetType: 'element_profile',
  targetId: TARGET_ID,
  baseRevision: 3,
  baseSnapshotSha256: BASE_SHA,
  payloadSha256: PAYLOAD_SHA,
  originKind: 'human',
  actorUserId: 'user-1',
  harnessSessionId: null,
  status: 'proposed',
  authoritativeRevision: null,
  authoritativeSnapshotSha256: null,
  committedByUserId: null,
  committedEventId: null,
  committedAt: null,
  createdAt: '2026-08-26T08:01:00+00:00',
  updatedAt: '2026-08-26T08:01:00+00:00',
} as const

const PREVIEW = {
  schema: 'jason.qingmu-change-set-preview.v1',
  changeSet: CHANGE_SET,
  baseSubject: SNAPSHOT.subject,
  proposedVisualPrompt: NEW_PROMPT,
  authoritativeCurrentSubject: SNAPSHOT.subject,
  changeSetId: CHANGE_SET_ID,
  payloadSha256: PAYLOAD_SHA,
  projectId: PROJECT_ID,
  targetType: 'element_profile',
  targetId: TARGET_ID,
  elementKind: 'prop',
  operation: 'replaceVisualPrompt',
  baseRevision: 3,
  authoritativeRevision: 3,
  baseSnapshotSha256: BASE_SHA,
  authoritativeSnapshotSha256: BASE_SHA,
  changed: true,
  authoritativeChanged: false,
  revisionConflict: false,
  baseSnapshotConflict: false,
  canCommit: true,
  referenceInvalidationExpected: true,
  impactAnalysis: {
    affectedReferenceAssetIds: ['reference-1'],
    invalidatedApprovalAssetIds: ['reference-1'],
    affectedDerivedAssetIds: ['derived-1'],
    affectedReferencePackIds: ['pack-1'],
    affectedPromptIrIds: ['prompt-ir-1'],
    affectedStoryboardFrameIds: ['storyboard-frame-1'],
    unknowns: ['人工确认怀表裂痕是否影响后续特写'],
  },
  impactSha256: IMPACT_SHA,
  preflight: { valid: true },
  references: [],
  methodProjectionSha256: METHOD_SHA,
  previewSha256: '4'.repeat(64),
} as const

const COMMIT = {
  schema: 'jason.qingmu-element-profile-commit-result.v1',
  changeSetId: CHANGE_SET_ID,
  commandReceiptId: 'receipt-prop-1',
  eventId: 'event-prop-1',
  eventType: 'ReferenceInvalidated',
  projectId: PROJECT_ID,
  targetType: 'element_profile',
  targetId: TARGET_ID,
  elementKind: 'prop',
  operation: 'replaceVisualPrompt',
  baseRevision: 3,
  authoritativeRevision: 4,
  authoritativeSnapshotSha256: UPDATED_SHA,
  payloadSha256: PAYLOAD_SHA,
  idempotencyKey: IDEMPOTENCY_KEY,
  changed: true,
  referenceInvalidated: true,
  impactAnalysis: PREVIEW.impactAnalysis,
  impactSha256: IMPACT_SHA,
  deduplicated: false,
  committedAt: '2026-08-26T08:02:00+00:00',
} as const

const RECOVERY = {
  schema: 'jason.qingmu-command-receipt-recovery.v1',
  recovered: true,
  receiptSha256: RECEIPT_SHA,
  receipt: COMMIT,
} as const

const REFERENCE_ASSET_ID = 'asset-reference-2'
const REFERENCE_ASSET_SHA = '9'.repeat(64)
const REFERENCE_SNAPSHOT_SHA = '8'.repeat(64)
const REFERENCE_CHANGE_SET_ID = 'changeset-reference-1'
const REFERENCE_PAYLOAD_SHA = '6'.repeat(64)
const REFERENCE_IDEMPOTENCY_KEY = `qingmu:element:v4:reference:${REFERENCE_PAYLOAD_SHA}`
const REPAIR_PROMPT = '保留怀表裂痕与午夜指针，修正表盖反光并重新生成候选。'

const REFERENCE_CANDIDATE = {
  assetId: REFERENCE_ASSET_ID,
  sha256: REFERENCE_ASSET_SHA,
  materializedSha256: REFERENCE_ASSET_SHA,
  bindingValid: true,
  projectId: PROJECT_ID,
  sourceEpisodeId: 'episode-1',
  ownerType: 'prop',
  ownerId: TARGET_ID,
  role: 'prop_reference',
  localPath: 'storage/props/reference-2.png',
  qualityStatus: 'passed',
  selectionStatus: 'Unselected',
  isSelected: false,
  generationJobId: 'job-reference-2',
  sourceRevisionId: 'revision-reference-2',
  formalConsistencyCheckId: 'check-reference-2',
  formalConsistencyPassed: true,
  qualityProjectionSha256: '5'.repeat(64),
  decisionKind: 'none',
  decisionIdentity: '',
} as const

function referenceCandidates(
  candidate: YimengReferenceAssetCandidate = REFERENCE_CANDIDATE,
  profileRevision = 3,
  elementSnapshotSha256 = BASE_SHA,
) {
  return {
    schema: 'jason.qingmu-reference-asset-candidates.v1',
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    targetId: TARGET_ID,
    elementKind: 'prop',
    profileRevision,
    elementSnapshotSha256,
    candidates: [candidate],
    humanApprovalInferred: false,
  } as const
}

const REVIEW_COMMENT = {
  id: 'comment-1',
  subjectType: 'element_profile',
  subjectId: TARGET_ID,
  subjectRevision: 3,
  subjectSha256: BASE_SHA,
  body: '怀表裂痕需要在后续特写中保持一致。',
  actorId: 'reviewer-1',
  actorRole: 'commenter',
  authSessionId: 'session-comment-1',
  createdAt: '2026-08-27T08:03:00+00:00',
} as const

const REVIEW_DECISION = {
  id: 'decision-1',
  subjectType: 'element_profile',
  subjectId: TARGET_ID,
  subjectRevision: 3,
  subjectSha256: BASE_SHA,
  decision: 'approve',
  reason: '当前版本的怀表造型可以进入下一环节。',
  actorId: 'approver-1',
  actorRole: 'approver',
  authSessionId: 'session-decision-1',
  decidedAt: '2026-08-27T08:04:00+00:00',
  stale: false,
} as const

function reviewFeed(options: {
  readonly targetId?: string
  readonly elementKind?: 'actor' | 'scene' | 'prop'
  readonly revision?: number
  readonly sha256?: string
  readonly canComment?: boolean
  readonly canDecide?: boolean
  readonly comments?: YimengElementReviewFeedResponse['comments']
  readonly decisions?: YimengElementReviewFeedResponse['decisions']
  readonly currentDecision?: YimengElementReviewFeedResponse['currentDecision']
} = {}) {
  const targetId = options.targetId ?? TARGET_ID
  const elementKind = options.elementKind ?? 'prop'
  const revision = options.revision ?? 3
  const sha256 = options.sha256 ?? BASE_SHA
  return {
    schema: 'jason.qingmu-element-review-feed.v1',
    projectId: PROJECT_ID,
    elementKind,
    targetId,
    subject: { type: 'element_profile', id: targetId, revision, sha256 },
    capabilities: {
      canComment: options.canComment ?? true,
      canDecide: options.canDecide ?? true,
    },
    comments: options.comments ?? [],
    decisions: options.decisions ?? [],
    currentDecision: options.currentDecision ?? null,
  } as const
}

function referenceMethodResponse(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration') {
  const projectionSha256 = operation === 'selectReferenceAsset' ? '4'.repeat(64) : '3'.repeat(64)
  const inputSnapshotSha256 = operation === 'selectReferenceAsset' ? '2'.repeat(64) : '1'.repeat(64)
  return {
    schema: 'qingmu.imago-reference-asset-method-adapter-result.v1',
    projectionSha256,
    projection: {
      schema: 'qingmu.imago-reference-asset-method-projection.v1',
      input_snapshot_sha256: inputSnapshotSha256,
      target: {
        projectId: PROJECT_ID,
        elementKind: 'prop',
        elementId: TARGET_ID,
        profileRevision: 3,
        snapshotSha256: BASE_SHA,
        assetId: REFERENCE_ASSET_ID,
        assetSha256: REFERENCE_ASSET_SHA,
        operation,
      },
      method_definition: { method_id: 'reference-asset-method' },
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
    },
    methodAttestation: {
      schema: 'qingmu.imago-reference-asset-method-attestation.v1',
      algorithm: 'hmac-sha256',
      projectionSha256,
      inputSnapshotSha256,
      targetSha256: '0'.repeat(64),
      signature: 'f'.repeat(64),
    },
  } as const
}

function referencePreview(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration') {
  return {
    schema: 'jason.qingmu-reference-asset-preview.v1',
    changeSetId: REFERENCE_CHANGE_SET_ID,
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    targetId: TARGET_ID,
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

function referenceCommit(operation: 'selectReferenceAsset' | 'requestReferenceRegeneration') {
  return {
    schema: 'jason.qingmu-reference-asset-commit-result.v1',
    changeSetId: REFERENCE_CHANGE_SET_ID,
    commandReceiptId: 'receipt-reference-1',
    eventId: 'event-reference-1',
    eventType: operation === 'selectReferenceAsset' ? 'ReferenceAssetSelected' : 'ReferenceRegenerationRequested',
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    targetId: TARGET_ID,
    elementKind: 'prop',
    operation,
    candidateAssetId: REFERENCE_ASSET_ID,
    candidateAssetSha256: REFERENCE_ASSET_SHA,
    baseRevision: 3,
    authoritativeRevision: 4,
    authoritativeSnapshotSha256: REFERENCE_SNAPSHOT_SHA,
    payloadSha256: REFERENCE_PAYLOAD_SHA,
    idempotencyKey: REFERENCE_IDEMPOTENCY_KEY,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    deduplicated: false,
    committedAt: '2026-08-27T08:02:00+00:00',
  } as const
}

const REFERENCE_UPDATED_SNAPSHOT = {
  ...SNAPSHOT,
  subject: {
    ...SNAPSHOT.subject,
    profileRevision: 4,
    officialReferenceImageUrl: '/media/props/reference-2.png',
    references: [{
      assetId: REFERENCE_ASSET_ID,
      sha256: REFERENCE_ASSET_SHA,
      selectionStatus: 'Selected',
      isSelected: true,
      rightsRecorded: false,
      rights: UNKNOWN_RIGHTS,
    }],
  },
  canonicalSnapshot: {
    ...SNAPSHOT.canonicalSnapshot,
    profileRevision: 4,
  },
  snapshotSha256: REFERENCE_SNAPSHOT_SHA,
} as const

const RIGHTS_CHANGE_SET_ID = 'changeset-reference-rights-1'
const RIGHTS_PAYLOAD_SHA = '5'.repeat(64)
const RIGHTS_UPDATED_SHA = '2'.repeat(64)
const RIGHTS_IMPACT = {
  affectedReferenceAssetIds: ['reference-1'],
  invalidatedApprovalAssetIds: [],
  affectedDerivedAssetIds: [],
  affectedReferencePackIds: [],
  affectedPromptIrIds: [],
  affectedStoryboardFrameIds: [],
  unknowns: [],
} as const

const RIGHTS_RECORDED_SNAPSHOT = {
  ...SNAPSHOT,
  subject: {
    ...SNAPSHOT.subject,
    references: [{ ...SNAPSHOT.subject.references[0], rightsRecorded: true }],
  },
} as const

const RIGHTS_UPDATED_SNAPSHOT = {
  ...SNAPSHOT,
  subject: {
    ...SNAPSHOT.subject,
    profileRevision: 4,
    references: [{ ...SNAPSHOT.subject.references[0], rightsRecorded: true }],
  },
  canonicalSnapshot: { ...SNAPSHOT.canonicalSnapshot, profileRevision: 4 },
  snapshotSha256: RIGHTS_UPDATED_SHA,
} as const

function rightsMethodResponse(
  snapshot: typeof SNAPSHOT | typeof RIGHTS_RECORDED_SNAPSHOT | typeof RIGHTS_UPDATED_SNAPSHOT = SNAPSHOT,
) {
  const response = methodResponse({
    baseRevision: snapshot.subject.profileRevision,
    baseSnapshotSha256: snapshot.snapshotSha256,
  })
  return {
    ...response,
    projection: {
      ...response.projection,
      method_definition: { id: 'imago-v6-reference-rights-record', version: 1 },
      work_order_projection: {
        operation: 'replaceReferenceRights',
        allowed_mutations: ['replaceReferenceRights'],
      },
    },
  } as const
}

function rightsChangeSet(snapshot: typeof SNAPSHOT | typeof RIGHTS_RECORDED_SNAPSHOT) {
  return {
    ...CHANGE_SET,
    id: RIGHTS_CHANGE_SET_ID,
    baseRevision: snapshot.subject.profileRevision,
    baseSnapshotSha256: snapshot.snapshotSha256,
    payloadSha256: RIGHTS_PAYLOAD_SHA,
  } as const
}

function rightsPreview(
  snapshot: typeof SNAPSHOT | typeof RIGHTS_RECORDED_SNAPSHOT,
  changed: boolean,
) {
  const changeSet = rightsChangeSet(snapshot)
  return {
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet,
    baseSubject: snapshot.subject,
    authoritativeCurrentSubject: snapshot.subject,
    changeSetId: changeSet.id,
    payloadSha256: changeSet.payloadSha256,
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    targetId: TARGET_ID,
    elementKind: 'prop',
    operation: 'replaceReferenceRights',
    referenceAssetId: 'reference-1',
    referenceAssetSha256: '1'.repeat(64),
    proposedReferenceRights: UNKNOWN_RIGHTS,
    baseRevision: snapshot.subject.profileRevision,
    authoritativeRevision: snapshot.subject.profileRevision,
    baseSnapshotSha256: snapshot.snapshotSha256,
    authoritativeSnapshotSha256: snapshot.snapshotSha256,
    changed,
    authoritativeChanged: false,
    revisionConflict: false,
    baseSnapshotConflict: false,
    impactConflict: false,
    canCommit: true,
    referenceInvalidationExpected: false,
    impactAnalysis: RIGHTS_IMPACT,
    impactSha256: IMPACT_SHA,
    preflight: {
      costGate: 'not_granted',
      selectionAuthority: 'not_granted',
      humanApprovalInferred: false,
    },
    references: snapshot.subject.references,
    methodProjectionSha256: METHOD_SHA,
    previewSha256: '4'.repeat(64),
  } as const
}

function createRightsPort(options: {
  readonly noOp?: boolean
  readonly lostResponse?: boolean
  readonly changedOfficialReferenceImageUrl?: boolean
  readonly humanDecisionDrift?: boolean
} = {}) {
  const noOp = options.noOp === true
  const initialSnapshot = noOp ? RIGHTS_RECORDED_SNAPSHOT : SNAPSHOT
  const normalPostSnapshot = noOp ? RIGHTS_RECORDED_SNAPSHOT : RIGHTS_UPDATED_SNAPSHOT
  const postSnapshot = options.changedOfficialReferenceImageUrl
    ? {
      ...RIGHTS_UPDATED_SNAPSHOT,
      subject: {
        ...RIGHTS_UPDATED_SNAPSHOT.subject,
        officialReferenceImageUrl: '/media/props/changed-by-rights.png',
      },
    } as const
    : normalPostSnapshot
  const changed = !noOp
  const elementProfile = vi.fn()
    .mockResolvedValueOnce(initialSnapshot)
    .mockResolvedValue(postSnapshot)
  const elementMethod = vi.fn(async (request: { readonly baseRevision: number; readonly baseSnapshotSha256: string }) => (
    methodResponse(request)
  ))
  const referenceAssetMethod = vi.fn(async (request: ImagoReferenceAssetMethodRequest) => {
    void request
    return rightsMethodResponse(initialSnapshot)
  })
  const changeSet = rightsChangeSet(initialSnapshot)
  const proposeReferenceAsset = vi.fn(async () => ({
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet,
    nextAction: 'preview',
  } as const))
  const previewElementProfile = vi.fn(async () => rightsPreview(initialSnapshot, changed))
  const receiptFor = (request: { readonly idempotencyKey: string }) => ({
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: RIGHTS_CHANGE_SET_ID,
    commandReceiptId: 'receipt-reference-rights-1',
    eventId: 'event-reference-rights-1',
    eventType: 'ElementProfileChanged',
    projectId: PROJECT_ID,
    targetType: 'element_profile',
    targetId: TARGET_ID,
    elementKind: 'prop',
    operation: 'replaceReferenceRights',
    referenceAssetId: 'reference-1',
    referenceAssetSha256: '1'.repeat(64),
    baseRevision: initialSnapshot.subject.profileRevision,
    authoritativeRevision: postSnapshot.subject.profileRevision,
    authoritativeSnapshotSha256: postSnapshot.snapshotSha256,
    payloadSha256: RIGHTS_PAYLOAD_SHA,
    idempotencyKey: request.idempotencyKey,
    changed,
    referenceInvalidated: false,
    impactAnalysis: RIGHTS_IMPACT,
    impactSha256: IMPACT_SHA,
    deduplicated: false,
    committedAt: '2026-08-27T09:00:00+00:00',
  } as const)
  let markerDuringCommit: string | null = null
  const commitElementProfile = vi.fn(async (request: { readonly idempotencyKey: string }) => {
    markerDuringCommit = sessionStorage.getItem(
      'qingmu:command-commit-recovery:v4:project-1:element_profile:prop:prop-1',
    )
    if (options.lostResponse) throw new Error('commit response lost')
    return receiptFor(request)
  })
  const recoverElementProfileCommit = vi.fn(async (request: { readonly idempotencyKey: string }) => ({
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256: RECEIPT_SHA,
    receipt: receiptFor(request),
  } as const))
  const staleDecision = { ...REVIEW_DECISION, stale: true } as const
  const postDecision = options.humanDecisionDrift
    ? { ...staleDecision, reason: '权利事务篡改了正式人工决定事件。' } as const
    : staleDecision
  const initialFeed = reviewFeed({ decisions: [REVIEW_DECISION], currentDecision: REVIEW_DECISION })
  const postFeed = noOp
    ? initialFeed
    : reviewFeed({
      revision: postSnapshot.subject.profileRevision,
      sha256: postSnapshot.snapshotSha256,
      decisions: [postDecision],
      currentDecision: null,
    })
  const createHumanDecision = vi.fn()
  const port = {
    elementProfile,
    referenceCandidates: vi.fn(async () => ({
      schema: 'jason.qingmu-reference-asset-candidates.v1',
      projectId: PROJECT_ID,
      targetType: 'element_profile',
      targetId: TARGET_ID,
      elementKind: 'prop',
      profileRevision: initialSnapshot.subject.profileRevision,
      elementSnapshotSha256: initialSnapshot.snapshotSha256,
      candidates: [],
      humanApprovalInferred: false,
    } as const)),
    reviewEvents: vi.fn()
      .mockResolvedValueOnce(initialFeed)
      .mockResolvedValue(postFeed),
    elementMethod,
    referenceAssetMethod,
    proposeReferenceAsset,
    previewElementProfile,
    commitElementProfile,
    recoverElementProfileCommit,
    createHumanDecision,
  } as unknown as QingmuYimengPort
  return {
    port,
    elementProfile,
    referenceAssetMethod,
    proposeReferenceAsset,
    previewElementProfile,
    commitElementProfile,
    recoverElementProfileCommit,
    createHumanDecision,
    markerDuringCommit: () => markerDuringCommit,
  }
}

function createPort(options: { readonly commit?: () => Promise<typeof COMMIT> } = {}) {
  const elementProfile = vi.fn()
    .mockResolvedValueOnce(SNAPSHOT)
    .mockResolvedValue(UPDATED_SNAPSHOT)
  const elementMethod = vi.fn(async (request: Parameters<typeof methodResponse>[0]) => methodResponse(request))
  const commitElementProfile = vi.fn(options.commit ?? (async () => COMMIT))
  const proposeElementProfile = vi.fn(async () => ({
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: CHANGE_SET,
    nextAction: 'preview',
  } as const))
  const port = {
    elementProfile,
    referenceCandidates: vi.fn(async () => ({
      schema: 'jason.qingmu-reference-asset-candidates.v1',
      projectId: PROJECT_ID,
      targetType: 'element_profile',
      targetId: TARGET_ID,
      elementKind: 'prop',
      profileRevision: 3,
      elementSnapshotSha256: BASE_SHA,
      candidates: [],
      humanApprovalInferred: false,
    } as const)),
    reviewEvents: vi.fn()
      .mockResolvedValueOnce(reviewFeed())
      .mockResolvedValue(reviewFeed({ revision: 4, sha256: UPDATED_SHA })),
    elementMethod,
    proposeElementProfile,
    previewElementProfile: vi.fn(async () => PREVIEW),
    commitElementProfile,
    recoverElementProfileCommit: vi.fn(async () => RECOVERY),
  } as unknown as QingmuYimengPort
  return { port, elementProfile, elementMethod, proposeElementProfile, commitElementProfile }
}

function createReferencePort(
  operation: 'selectReferenceAsset' | 'requestReferenceRegeneration',
  candidate: YimengReferenceAssetCandidate = REFERENCE_CANDIDATE,
  refreshedCandidateOverride?: YimengReferenceAssetCandidate,
) {
  const initialCandidates = referenceCandidates(candidate)
  const refreshedCandidate = refreshedCandidateOverride ?? (operation === 'selectReferenceAsset'
    ? { ...candidate, selectionStatus: 'Selected', isSelected: true, decisionKind: 'referenceSelection', decisionIdentity: 'user-1' } as const
    : { ...candidate, selectionStatus: 'Rejected', isSelected: false, decisionKind: 'none', decisionIdentity: '' } as const)
  const refreshedCandidates = referenceCandidates(refreshedCandidate, 4, REFERENCE_SNAPSHOT_SHA)
  const elementProfile = vi.fn()
    .mockResolvedValueOnce(SNAPSHOT)
    .mockResolvedValue(REFERENCE_UPDATED_SNAPSHOT)
  const candidates = vi.fn()
    .mockResolvedValueOnce(initialCandidates)
    .mockResolvedValue(refreshedCandidates)
  const elementMethod = vi.fn(async (request: Parameters<typeof methodResponse>[0]) => methodResponse(request))
  const referenceAssetMethod = vi.fn(async () => referenceMethodResponse(operation))
  const proposeReferenceAsset = vi.fn(async () => ({
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: {
      ...CHANGE_SET,
      id: REFERENCE_CHANGE_SET_ID,
      payloadSha256: REFERENCE_PAYLOAD_SHA,
    },
    nextAction: 'preview',
  } as const))
  const previewElementProfile = vi.fn(async () => referencePreview(operation))
  const commitElementProfile = vi.fn(async (request: { readonly idempotencyKey: string }) => ({
    ...referenceCommit(operation),
    idempotencyKey: request.idempotencyKey,
  }))
  const port = {
    elementProfile,
    referenceCandidates: candidates,
    reviewEvents: vi.fn()
      .mockResolvedValueOnce(reviewFeed())
      .mockResolvedValue(reviewFeed({ revision: 4, sha256: REFERENCE_SNAPSHOT_SHA })),
    elementMethod,
    referenceAssetMethod,
    proposeReferenceAsset,
    previewElementProfile,
    commitElementProfile,
    recoverElementProfileCommit: vi.fn(),
  } as unknown as QingmuYimengPort
  return {
    port,
    elementProfile,
    candidates,
    referenceAssetMethod,
    proposeReferenceAsset,
    previewElementProfile,
    commitElementProfile,
  }
}

function mount(
  port: QingmuYimengPort,
  onCommitted = vi.fn(async () => {}),
  semanticAssets: readonly unknown[] = [{ assetId: TARGET_ID, projectId: PROJECT_ID, type: 'prop', name: '银色怀表' }],
) {
  return {
    onCommitted,
    ...render(
      <AssetWorkbench
        projectId={PROJECT_ID}
        semanticAssets={semanticAssets}
        port={port}
        t={t}
        onCommitted={onCommitted}
      />,
    ),
  }
}

async function prepareRightsPreview(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: zh.assetRightsOperation }))
  fireEvent.click(await screen.findByRole('radio', { name: /reference-1/ }))
  expect(screen.getByRole('group', { name: zh.assetRightsEditorTitle })).toBeTruthy()
  expect(screen.getByText(zh.assetRightsSourceType)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsHolder)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsAuthorizationScope)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsTerritory)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsTerm)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsRestrictions)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsContains)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsProviderTerms)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsModelLicenses)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsHumanDeclaration)).toBeTruthy()
  expect(screen.getByText(zh.assetRightsContentCredentials)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.assetRightsPrepare }))
  await screen.findByRole('heading', { name: zh.assetRightsPreviewTitle })
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AssetWorkbench', () => {
  it('fails closed on a legacy v1 authoritative element-profile read', async () => {
    const { port } = createPort()
    const elementMethod = vi.fn()
    Object.assign(port, {
      elementProfile: vi.fn(async () => ({
        ...SNAPSHOT,
        schema: 'jason.qingmu-element-profile-subject-read.v1',
      })),
      elementMethod,
    })

    mount(port)

    expect((await screen.findByRole('alert')).textContent)
      .toContain('易梦返回的元素资料与当前业务对象不一致')
    expect(elementMethod).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: zh.assetPromptLabel })).toBeNull()
  })

  it('records all structured rights only through IMAGO preflight, Yimeng preview, and explicit confirmation', async () => {
    const {
      port,
      elementProfile,
      referenceAssetMethod,
      proposeReferenceAsset,
      commitElementProfile,
      createHumanDecision,
      markerDuringCommit,
    } = createRightsPort()
    mount(port)

    await prepareRightsPreview()

    expect(referenceAssetMethod).toHaveBeenCalledTimes(1)
    const methodRequest = referenceAssetMethod.mock.calls[0]?.[0]
    expect(methodRequest).toEqual({
      projectId: PROJECT_ID,
      elementKind: 'prop',
      elementId: TARGET_ID,
      profileRevision: 3,
      snapshotSha256: BASE_SHA,
      operation: 'replaceReferenceRights',
    })
    expect(Object.keys(methodRequest ?? {}).sort()).toEqual([
      'elementId',
      'elementKind',
      'operation',
      'profileRevision',
      'projectId',
      'snapshotSha256',
    ].sort())
    expect(methodRequest).not.toHaveProperty('assetId')
    expect(methodRequest).not.toHaveProperty('assetSha256')
    expect(methodRequest).not.toHaveProperty('rights')
    expect(proposeReferenceAsset).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'replaceReferenceRights',
      referenceAssetId: 'reference-1',
      referenceAssetSha256: '1'.repeat(64),
      rights: UNKNOWN_RIGHTS,
      methodProjection: rightsMethodResponse().projection,
      methodProjectionSha256: METHOD_SHA,
      methodAttestation: rightsMethodResponse().methodAttestation,
    }), expect.any(AbortSignal))
    expect(commitElementProfile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))

    expect(await screen.findByRole('heading', { name: zh.assetRightsCommitSucceeded })).toBeTruthy()
    expect(commitElementProfile).toHaveBeenCalledTimes(1)
    const commitRequest = commitElementProfile.mock.calls[0]?.[0]
    expect(commitRequest).toMatchObject({
      operation: 'replaceReferenceRights',
      referenceAssetId: 'reference-1',
      referenceAssetSha256: '1'.repeat(64),
    })
    expect(commitRequest).not.toHaveProperty('rights')
    expect(markerDuringCommit()).not.toBeNull()
    expect(markerDuringCommit()).not.toContain('rightsHolder')
    expect(markerDuringCommit()).not.toContain('authorizationScope')
    expect(markerDuringCommit()).not.toContain(OLD_PROMPT)
    expect(markerDuringCommit()).not.toContain(REVIEW_DECISION.reason)
    expect(markerDuringCommit()).not.toContain('authSessionId')
    expect(markerDuringCommit()).not.toContain('token')
    expect(markerDuringCommit()).not.toContain('proof')
    expect(JSON.parse(markerDuringCommit() ?? '{}')).toMatchObject({
      preCommitVisualBaselineSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      preCommitHumanDecisionsSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(createHumanDecision).not.toHaveBeenCalled()
    expect(elementProfile).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('none')
    })
  })

  it('commits an exact same-value rights no-op without inventing a new revision', async () => {
    const { port, elementProfile, commitElementProfile } = createRightsPort({ noOp: true })
    mount(port)

    await prepareRightsPreview()
    expect(screen.getByText(zh.assetNoChange)).toBeTruthy()
    expect(commitElementProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))

    expect(await screen.findByRole('heading', { name: zh.assetRightsCommitSucceeded })).toBeTruthy()
    expect(elementProfile).toHaveBeenCalledTimes(2)
    const lastSnapshot = await elementProfile.mock.results[1]?.value
    expect(lastSnapshot.subject.profileRevision).toBe(3)
    expect(lastSnapshot.snapshotSha256).toBe(BASE_SHA)
  })

  it('recovers a lost rights commit response through GET only and never resubmits the commit', async () => {
    const {
      port,
      commitElementProfile,
      recoverElementProfileCommit,
    } = createRightsPort({ lostResponse: true })
    mount(port)

    await prepareRightsPreview()
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))
    expect(await screen.findAllByText('commit response lost')).not.toHaveLength(0)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')

    fireEvent.click(screen.getByRole('button', { name: zh.recoverReceipt }))

    expect(await screen.findByRole('heading', { name: zh.receiptRecovered })).toBeTruthy()
    expect(commitElementProfile).toHaveBeenCalledTimes(1)
    expect(recoverElementProfileCommit).toHaveBeenCalledTimes(1)
    expect(recoverElementProfileCommit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'replaceReferenceRights',
      referenceAssetId: 'reference-1',
      referenceAssetSha256: '1'.repeat(64),
    }), expect.any(AbortSignal))
    await waitFor(() => {
      expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('none')
    })
  })

  it('keeps the marker and hides success when a rights commit changes the official reference image', async () => {
    const { port } = createRightsPort({ changedOfficialReferenceImageUrl: true })
    mount(port)

    await prepareRightsPreview()
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))

    expect(await screen.findAllByText('权利记录提交后的权威视觉资料摘要不一致')).not.toHaveLength(0)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
    expect(screen.queryByRole('heading', { name: zh.assetRightsCommitSucceeded })).toBeNull()
  })

  it('keeps the marker after remount when GET-only rights recovery detects visual drift', async () => {
    const { port, commitElementProfile, recoverElementProfileCommit } = createRightsPort({
      lostResponse: true,
      changedOfficialReferenceImageUrl: true,
    })
    mount(port)
    await prepareRightsPreview()
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))
    expect(await screen.findAllByText('commit response lost')).not.toHaveLength(0)
    cleanup()

    mount(port)
    fireEvent.click(await screen.findByRole('button', { name: zh.recoverReceipt }))

    expect(await screen.findAllByText('权利记录提交后的权威视觉资料摘要不一致')).not.toHaveLength(0)
    expect(commitElementProfile).toHaveBeenCalledTimes(1)
    expect(recoverElementProfileCommit).toHaveBeenCalledTimes(1)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
    expect(screen.queryByRole('heading', { name: zh.receiptRecovered })).toBeNull()
    expect(screen.queryByRole('heading', { name: zh.assetRightsCommitSucceeded })).toBeNull()
  })

  it('keeps the marker after remount when GET-only rights recovery detects HumanDecision event drift', async () => {
    const { port, commitElementProfile, recoverElementProfileCommit } = createRightsPort({
      lostResponse: true,
      humanDecisionDrift: true,
    })
    mount(port)
    await prepareRightsPreview()
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetRightsConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetRightsCommit }))
    expect(await screen.findAllByText('commit response lost')).not.toHaveLength(0)
    cleanup()

    mount(port)
    fireEvent.click(await screen.findByRole('button', { name: zh.recoverReceipt }))

    expect(await screen.findAllByText('权利记录提交后的正式人工决定摘要不一致')).not.toHaveLength(0)
    expect(commitElementProfile).toHaveBeenCalledTimes(1)
    expect(recoverElementProfileCommit).toHaveBeenCalledTimes(1)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
    expect(screen.queryByRole('heading', { name: zh.receiptRecovered })).toBeNull()
    expect(screen.queryByRole('heading', { name: zh.assetRightsCommitSucceeded })).toBeNull()
  })

  it('loads Yimeng truth and IMAGO guidance, then commits only after preview and explicit confirmation', async () => {
    const commit = vi.fn(async () => {
      expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
      return COMMIT
    })
    const { port, elementProfile, elementMethod, proposeElementProfile, commitElementProfile } = createPort({ commit })
    const { onCommitted } = mount(port)

    const editor = await screen.findByRole('textbox', { name: zh.assetPromptLabel })
    expect(editor).toBeInstanceOf(HTMLTextAreaElement)
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error('asset editor should be a textarea')
    expect(editor.value).toBe(OLD_PROMPT)
    expect(screen.getByText('写清楚道具为何出现在故事里。')).toBeTruthy()
    expect(screen.getByText('叙事功能明确')).toBeTruthy()
    expect(screen.getByText(zh.assetPrepareBoundary)).toBeTruthy()
    expect(screen.getByText(zh.assetPhase_draft)).toBeTruthy()
    expect(screen.queryByText('draft')).toBeNull()
    expect(elementProfile).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, elementKind: 'prop', targetId: TARGET_ID },
      expect.any(AbortSignal),
    )
    expect(elementMethod).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      targetId: TARGET_ID,
      baseRevision: 3,
      baseSnapshotSha256: BASE_SHA,
    }), expect.any(AbortSignal))

    fireEvent.change(editor, { target: { value: NEW_PROMPT } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetPrepare }))
    expect(await screen.findByText(zh.assetReferenceWillInvalidate)).toBeTruthy()
    expect(screen.getByText(zh.assetReferenceImpact)).toBeTruthy()
    expect(screen.getByText(zh.assetImpactPromptIr)).toBeTruthy()
    expect(screen.getByText('prompt-ir-1')).toBeTruthy()
    expect(screen.getByText(zh.assetVersionBase)).toBeTruthy()
    expect(screen.getByText(zh.assetVersionCurrent)).toBeTruthy()
    expect(screen.getByText(zh.assetVersionProposed)).toBeTruthy()
    expect(proposeElementProfile).toHaveBeenCalledWith(expect.objectContaining({
      methodProjection: methodResponse({ baseRevision: 3, baseSnapshotSha256: BASE_SHA }).projection,
      methodProjectionSha256: METHOD_SHA,
      methodAttestation: methodResponse({ baseRevision: 3, baseSnapshotSha256: BASE_SHA }).methodAttestation,
    }), expect.any(AbortSignal))
    expect(commitElementProfile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: zh.assetCommit }))

    expect(await screen.findByText(zh.assetCommitSucceeded)).toBeTruthy()
    await waitFor(() => {
      expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('none')
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(onCommitted).toHaveBeenCalledTimes(1)
    expect(elementProfile).toHaveBeenCalledTimes(2)
    expect(elementMethod).toHaveBeenCalledTimes(2)
    const refreshedEditor = screen.getByRole('textbox', { name: zh.assetPromptLabel })
    expect(refreshedEditor).toBeInstanceOf(HTMLTextAreaElement)
    if (!(refreshedEditor instanceof HTMLTextAreaElement)) throw new Error('asset editor should be a textarea')
    expect(refreshedEditor.value).toBe(NEW_PROMPT)
  })

  it('re-reads review events after commit so the old current Decision becomes stale', async () => {
    const staleDecision = { ...REVIEW_DECISION, stale: true } as const
    const { port } = createPort()
    const reviewEvents = vi.fn()
      .mockResolvedValueOnce(reviewFeed({
        decisions: [REVIEW_DECISION],
        currentDecision: REVIEW_DECISION,
      }))
      .mockResolvedValue(reviewFeed({
        revision: 4,
        sha256: UPDATED_SHA,
        decisions: [staleDecision],
        currentDecision: null,
      }))
    Object.assign(port, { reviewEvents })
    mount(port)

    expect(await screen.findAllByText(REVIEW_DECISION.reason)).not.toHaveLength(0)
    const editor = screen.getByRole('textbox', { name: zh.assetPromptLabel })
    fireEvent.change(editor, { target: { value: NEW_PROMPT } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetPrepare }))
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: zh.assetCommit }))

    expect(await screen.findByText(zh.assetCommitSucceeded)).toBeTruthy()
    expect(await screen.findByText(zh.assetReviewNoCurrentDecision)).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'SMALL' &&
          element.textContent?.includes(zh.assetReviewDecisionStale) === true,
      ),
    ).toBeTruthy()
    expect(reviewEvents).toHaveBeenCalledTimes(2)
  })

  it('rejects a method attestation with extra fields before enabling the editor', async () => {
    const { port } = createPort()
    const valid = methodResponse({ baseRevision: 3, baseSnapshotSha256: BASE_SHA })
    Object.assign(port, {
      elementMethod: vi.fn(async () => ({
        ...valid,
        methodAttestation: { ...valid.methodAttestation, leaked: true },
      })),
    })

    mount(port)

    expect((await screen.findByRole('alert')).textContent)
      .toContain('IMAGO 方法投影与当前易梦资料基线不一致')
    expect(screen.queryByRole('textbox', { name: zh.assetPromptLabel })).toBeNull()
  })

  it('switches actor, environment, and prop through the same element contract', async () => {
    const actorId = 'actor-1'
    const sceneId = 'scene-1'
    const actorIdentity = '四十岁女侦探，短发，左眉有浅疤，深灰风衣。'
    const scenePrompt = '雨夜旧车站，冷蓝月台灯，地面湿润反光。'
    const snapshots = {
      actor: {
        schema: SNAPSHOT.schema,
        subject: {
          ...SNAPSHOT.subject,
          elementKind: 'actor',
          actorId,
          name: '林默',
          visualIdentity: actorIdentity,
        },
        snapshotSha256: BASE_SHA,
      },
      scene: {
        schema: SNAPSHOT.schema,
        subject: {
          ...SNAPSHOT.subject,
          elementKind: 'scene',
          sceneId,
          sceneType: 'exterior',
          name: '旧车站',
          visualPrompt: scenePrompt,
        },
        snapshotSha256: BASE_SHA,
      },
      prop: SNAPSHOT,
    } as const
    const elementProfile = vi.fn(async (request: { readonly elementKind: keyof typeof snapshots }) => snapshots[request.elementKind])
    const elementMethod = vi.fn(async (request: {
      readonly baseRevision: number
      readonly baseSnapshotSha256: string
      readonly elementKind: 'actor' | 'scene' | 'prop'
      readonly targetId: string
    }) => methodResponse(request))
    const referenceCandidates = vi.fn(async (request: {
      readonly elementKind: keyof typeof snapshots
      readonly targetId: string
    }) => ({
      schema: 'jason.qingmu-reference-asset-candidates.v1',
      projectId: PROJECT_ID,
      targetType: 'element_profile',
      targetId: request.targetId,
      elementKind: request.elementKind,
      profileRevision: 3,
      elementSnapshotSha256: BASE_SHA,
      candidates: [],
      humanApprovalInferred: false,
    } as const))
    const reviewEvents = vi.fn(async (request: {
      readonly elementKind: 'actor' | 'scene' | 'prop'
      readonly targetId: string
    }) => reviewFeed({ targetId: request.targetId, elementKind: request.elementKind }))
    const port = { elementProfile, elementMethod, referenceCandidates, reviewEvents } as unknown as QingmuYimengPort

    mount(port, vi.fn(async () => {}), [
      { assetId: actorId, projectId: PROJECT_ID, type: 'character', name: '林默' },
      { assetId: sceneId, projectId: PROJECT_ID, type: 'scene', name: '旧车站' },
      { assetId: TARGET_ID, projectId: PROJECT_ID, type: 'prop', name: '银色怀表' },
    ])

    const actorEditor = await screen.findByRole('textbox', { name: zh.assetIdentityLabel })
    expect(actorEditor).toHaveProperty('value', actorIdentity)
    expect(elementProfile).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, elementKind: 'actor', targetId: actorId },
      expect.any(AbortSignal),
    )

    fireEvent.click(screen.getByRole('button', { name: zh.assetKindScene }))
    const sceneEditor = await screen.findByRole('textbox', { name: zh.assetPromptLabel })
    await waitFor(() => { expect(sceneEditor).toHaveProperty('value', scenePrompt) })
    expect(elementProfile).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, elementKind: 'scene', targetId: sceneId },
      expect.any(AbortSignal),
    )

    fireEvent.click(screen.getByRole('button', { name: zh.assetKindProp }))
    const propEditor = await screen.findByRole('textbox', { name: zh.assetPromptLabel })
    await waitFor(() => { expect(propEditor).toHaveProperty('value', OLD_PROMPT) })
    expect(elementProfile).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, elementKind: 'prop', targetId: TARGET_ID },
      expect.any(AbortSignal),
    )
  })

  it('recovers by GET and never resubmits the commit command', async () => {
    const marker = createCommandCommitRecoveryMarker({
      projectId: PROJECT_ID,
      targetType: 'element_profile',
      elementKind: 'prop',
      targetId: TARGET_ID,
      changeSetId: CHANGE_SET_ID,
      baseRevision: 3,
      baseSnapshotSha256: BASE_SHA,
      payloadSha256: PAYLOAD_SHA,
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: 'replaceVisualPrompt',
    })
    expect(writeCommandCommitRecoveryMarker(marker)).toBe(true)
    const { port, commitElementProfile } = createPort()
    const recoverElementProfileCommit = vi.fn(async () => RECOVERY)
    Object.assign(port, { recoverElementProfileCommit })
    mount(port)

    fireEvent.click(await screen.findByRole('button', { name: zh.recoverReceipt }))

    expect(await screen.findByText(zh.receiptRecovered)).toBeTruthy()
    expect(recoverElementProfileCommit).toHaveBeenCalledTimes(1)
    expect(commitElementProfile).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('none')
    })
  })

  it('submits a comment through its own permission and proves candidate selection and current decision stayed unchanged', async () => {
    const selectedCandidate = {
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Selected',
      isSelected: true,
      decisionKind: 'referenceSelection',
      decisionIdentity: 'selector-1',
    } as const
    const stableCandidates = referenceCandidates(selectedCandidate)
    const { port, elementMethod } = createPort()
    const candidates = vi.fn(async () => stableCandidates)
    const initialFeed = reviewFeed({
      canComment: true,
      canDecide: false,
      decisions: [REVIEW_DECISION],
      currentDecision: REVIEW_DECISION,
    })
    const refreshedFeed = reviewFeed({
      canComment: true,
      canDecide: false,
      comments: [REVIEW_COMMENT],
      decisions: [REVIEW_DECISION],
      currentDecision: REVIEW_DECISION,
    })
    const reviewEvents = vi.fn()
      .mockResolvedValueOnce(initialFeed)
      .mockResolvedValue(refreshedFeed)
    const createComment = vi.fn(async (request: { readonly body: string }) => ({
      schema: 'jason.qingmu-element-comment-result.v1',
      comment: { ...REVIEW_COMMENT, body: request.body },
    } as const))
    const createHumanDecision = vi.fn()
    const referenceAssetMethod = vi.fn()
    Object.assign(port, { referenceCandidates: candidates, reviewEvents, createComment, createHumanDecision, referenceAssetMethod })

    mount(port)

    expect(await screen.findByRole('heading', { name: zh.assetReviewEventsTitle })).toBeTruthy()
    expect(screen.getByText(zh.assetReviewDecisionBlockedPermission)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.assetReviewDecisionSubmit }))
      .toHaveProperty('disabled', true)
    const comment = screen.getByRole('textbox', { name: zh.assetReviewCommentLabel })
    fireEvent.change(comment, { target: { value: REVIEW_COMMENT.body } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))

    expect(await screen.findByText(zh.assetReviewCommentSucceeded)).toBeTruthy()
    expect(createComment).toHaveBeenCalledTimes(1)
    const request = createComment.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.keys(request).sort()).toEqual([
      'body',
      'elementKind',
      'expectedSubjectRevision',
      'expectedSubjectSha256',
      'idempotencyKey',
      'projectId',
      'targetId',
    ].sort())
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      elementKind: 'prop',
      targetId: TARGET_ID,
      expectedSubjectRevision: 3,
      expectedSubjectSha256: BASE_SHA,
      body: REVIEW_COMMENT.body,
    })
    expect(request).not.toHaveProperty('actorId')
    expect(request).not.toHaveProperty('actorRole')
    expect(request).not.toHaveProperty('authSessionId')
    expect(reviewEvents).toHaveBeenCalledTimes(2)
    expect(candidates).toHaveBeenCalledTimes(2)
    expect(elementMethod).toHaveBeenCalledTimes(1)
    expect(referenceAssetMethod).not.toHaveBeenCalled()
    expect(createHumanDecision).not.toHaveBeenCalled()
    expect(screen.getAllByText(REVIEW_DECISION.reason)).not.toHaveLength(0)
  })

  it('keeps Comment available when reference candidates fail to load', async () => {
    const { port } = createPort()
    const candidates = vi.fn(async () => { throw new Error('候选读取失败') })
    const reviewEvents = vi.fn()
      .mockResolvedValueOnce(reviewFeed())
      .mockResolvedValue(reviewFeed({ comments: [REVIEW_COMMENT] }))
    const createComment = vi.fn(async () => ({
      schema: 'jason.qingmu-element-comment-result.v1',
      comment: REVIEW_COMMENT,
    } as const))
    Object.assign(port, { referenceCandidates: candidates, reviewEvents, createComment })
    mount(port)

    expect(await screen.findAllByText('候选读取失败')).not.toHaveLength(0)
    const comment = screen.getByRole('textbox', { name: zh.assetReviewCommentLabel })
    expect(comment).toHaveProperty('disabled', false)
    fireEvent.change(comment, { target: { value: REVIEW_COMMENT.body } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))

    expect(await screen.findByText(zh.assetReviewCommentSucceeded)).toBeTruthy()
    expect(createComment).toHaveBeenCalledTimes(1)
    expect(reviewEvents).toHaveBeenCalledTimes(2)
    expect(candidates).toHaveBeenCalledTimes(1)
  })

  it('keeps a recorded Comment successful when the post-POST candidate reread fails', async () => {
    const { port } = createPort()
    const candidates = vi.fn()
      .mockResolvedValueOnce(referenceCandidates())
      .mockRejectedValueOnce(new Error('候选重读失败'))
    const reviewEvents = vi.fn()
      .mockResolvedValueOnce(reviewFeed())
      .mockResolvedValue(reviewFeed({ comments: [REVIEW_COMMENT] }))
    const createComment = vi.fn(async () => ({
      schema: 'jason.qingmu-element-comment-result.v1',
      comment: REVIEW_COMMENT,
    } as const))
    Object.assign(port, { referenceCandidates: candidates, reviewEvents, createComment })
    mount(port)

    const comment = await screen.findByRole('textbox', { name: zh.assetReviewCommentLabel })
    fireEvent.change(comment, { target: { value: REVIEW_COMMENT.body } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))

    expect(await screen.findByText(zh.assetReviewCommentSucceeded)).toBeTruthy()
    expect(await screen.findAllByText('候选重读失败')).not.toHaveLength(0)
    expect(comment).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))
      .toHaveProperty('disabled', true)
    expect(createComment).toHaveBeenCalledTimes(1)
    expect(reviewEvents).toHaveBeenCalledTimes(2)
    expect(candidates).toHaveBeenCalledTimes(2)
  })

  it('fails a comment closed when the authoritative reread changes Selected/isSelected', async () => {
    const selectedCandidate = {
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Selected',
      isSelected: true,
      decisionKind: 'referenceSelection',
      decisionIdentity: 'selector-1',
    } as const
    const changedCandidate = {
      ...selectedCandidate,
      selectionStatus: 'Unselected',
      isSelected: false,
      decisionKind: 'none',
      decisionIdentity: '',
    } as const
    const { port } = createPort()
    Object.assign(port, {
      referenceCandidates: vi.fn()
        .mockResolvedValueOnce(referenceCandidates(selectedCandidate))
        .mockResolvedValue(referenceCandidates(changedCandidate)),
      reviewEvents: vi.fn()
        .mockResolvedValueOnce(reviewFeed())
        .mockResolvedValue(reviewFeed({ comments: [REVIEW_COMMENT] })),
      createComment: vi.fn(async () => ({
        schema: 'jason.qingmu-element-comment-result.v1',
        comment: REVIEW_COMMENT,
      } as const)),
    })
    mount(port)

    const comment = await screen.findByRole('textbox', { name: zh.assetReviewCommentLabel })
    fireEvent.change(comment, { target: { value: REVIEW_COMMENT.body } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))

    expect(await screen.findAllByText('评论后的权威候选选择状态发生变化')).not.toHaveLength(0)
    expect(screen.queryByText(zh.assetReviewCommentSucceeded)).toBeNull()
  })

  it('fails a comment closed when the reread changes the formal current decision', async () => {
    const changedDecision = {
      ...REVIEW_DECISION,
      id: 'decision-2',
      decision: 'reject',
      reason: '评论请求不应改写正式决定。',
    } as const
    const stableCandidates = referenceCandidates({
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Selected',
      isSelected: true,
      decisionKind: 'referenceSelection',
      decisionIdentity: 'selector-1',
    })
    const { port } = createPort()
    Object.assign(port, {
      referenceCandidates: vi.fn(async () => stableCandidates),
      reviewEvents: vi.fn()
        .mockResolvedValueOnce(reviewFeed({ decisions: [REVIEW_DECISION], currentDecision: REVIEW_DECISION }))
        .mockResolvedValue(reviewFeed({
          comments: [REVIEW_COMMENT],
          decisions: [changedDecision],
          currentDecision: changedDecision,
        })),
      createComment: vi.fn(async () => ({
        schema: 'jason.qingmu-element-comment-result.v1',
        comment: REVIEW_COMMENT,
      } as const)),
    })
    mount(port)

    const comment = await screen.findByRole('textbox', { name: zh.assetReviewCommentLabel })
    fireEvent.change(comment, { target: { value: REVIEW_COMMENT.body } })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))

    expect(await screen.findAllByText('评论后的正式人工决定发生变化')).not.toHaveLength(0)
    expect(screen.queryByText(zh.assetReviewCommentSucceeded)).toBeNull()
  })

  it('keeps comment and HumanDecision permissions separate and binds an approver decision to the exact subject', async () => {
    const nextDecision = {
      ...REVIEW_DECISION,
      id: 'decision-request-changes-1',
      decision: 'request_changes',
      reason: '请补充表盖内侧的磨损细节。',
    } as const
    const { stale: _stale, ...commandDecision } = nextDecision
    const { port, elementMethod } = createPort()
    const reviewEvents = vi.fn()
      .mockResolvedValueOnce(reviewFeed({ canComment: false, canDecide: true }))
      .mockResolvedValue(reviewFeed({
        canComment: false,
        canDecide: true,
        decisions: [nextDecision],
        currentDecision: nextDecision,
      }))
    const createComment = vi.fn()
    const createHumanDecision = vi.fn(async (
      _request: Parameters<QingmuYimengPort['createHumanDecision']>[0],
    ) => ({
      schema: 'jason.qingmu-element-human-decision-result.v1',
      decision: commandDecision,
    } as const))
    const referenceAssetMethod = vi.fn()
    Object.assign(port, { reviewEvents, createComment, createHumanDecision, referenceAssetMethod })

    mount(port)

    expect(await screen.findByText(zh.assetReviewCommentBlockedPermission)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))
      .toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('combobox', { name: zh.assetReviewDecisionValue }), {
      target: { value: 'request_changes' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: zh.assetReviewDecisionReason }), {
      target: { value: nextDecision.reason },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReviewDecisionSubmit }))

    expect(await screen.findByText(zh.assetReviewDecisionSucceeded)).toBeTruthy()
    expect(await screen.findAllByText(nextDecision.reason)).not.toHaveLength(0)
    expect(createHumanDecision).toHaveBeenCalledTimes(1)
    const request = createHumanDecision.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('HumanDecision request was not captured')
    expect(Object.keys(request).sort()).toEqual([
      'decision',
      'elementKind',
      'expectedSubjectRevision',
      'expectedSubjectSha256',
      'idempotencyKey',
      'projectId',
      'reason',
      'targetId',
    ].sort())
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      elementKind: 'prop',
      targetId: TARGET_ID,
      expectedSubjectRevision: 3,
      expectedSubjectSha256: BASE_SHA,
      decision: 'request_changes',
      reason: nextDecision.reason,
    })
    expect(request).not.toHaveProperty('actorId')
    expect(request).not.toHaveProperty('actorRole')
    expect(request).not.toHaveProperty('authSessionId')
    expect(reviewEvents).toHaveBeenCalledTimes(2)
    expect(elementMethod).toHaveBeenCalledTimes(1)
    expect(referenceAssetMethod).not.toHaveBeenCalled()
    expect(createComment).not.toHaveBeenCalled()
  })

  it('renders old exact-lineage decisions as stale and disables both lanes when the feed subject drifts', async () => {
    const staleDecision = {
      ...REVIEW_DECISION,
      id: 'decision-old-1',
      subjectRevision: 2,
      subjectSha256: '0'.repeat(64),
      stale: true,
    } as const
    const { port } = createPort()
    Object.assign(port, {
      reviewEvents: vi.fn(async () => reviewFeed({ decisions: [staleDecision] })),
    })
    const mounted = mount(port)

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'SMALL' &&
          element.textContent?.includes(zh.assetReviewDecisionStale) === true,
      ),
    ).toBeTruthy()
    expect(screen.getByText(zh.assetReviewNoCurrentDecision)).toBeTruthy()

    mounted.unmount()
    const drifted = createPort()
    Object.assign(drifted.port, {
      reviewEvents: vi.fn(async () => reviewFeed({ revision: 2, sha256: '0'.repeat(64) })),
    })
    mount(drifted.port)

    expect(await screen.findByText(zh.assetReviewLoadBlocked)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.assetReviewCommentSubmit }))
      .toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: zh.assetReviewDecisionSubmit }))
      .toHaveProperty('disabled', true)
  })

  it('reads authoritative candidates and selects one only through method, proposal, preview, confirmation, commit, and reread', async () => {
    const {
      port,
      elementProfile,
      candidates,
      referenceAssetMethod,
      proposeReferenceAsset,
      previewElementProfile,
      commitElementProfile,
    } = createReferencePort('selectReferenceAsset')
    mount(port)

    const candidate = await screen.findByRole('radio', { name: new RegExp(REFERENCE_ASSET_ID) })
    expect(candidate).toHaveProperty('checked', false)
    expect(screen.getByText(zh.assetReferenceSelectNotice)).toBeTruthy()
    expect(candidates).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, elementKind: 'prop', targetId: TARGET_ID },
      expect.any(AbortSignal),
    )

    fireEvent.click(candidate)
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferencePrepareSelect }))

    expect(await screen.findByText(zh.assetReferenceZeroExecution)).toBeTruthy()
    expect(referenceAssetMethod).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      elementKind: 'prop',
      elementId: TARGET_ID,
      profileRevision: 3,
      snapshotSha256: BASE_SHA,
      assetId: REFERENCE_ASSET_ID,
      assetSha256: REFERENCE_ASSET_SHA,
      operation: 'selectReferenceAsset',
    }, expect.any(AbortSignal))
    expect(proposeReferenceAsset).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      targetId: TARGET_ID,
      operation: 'selectReferenceAsset',
      candidateAssetId: REFERENCE_ASSET_ID,
      candidateAssetSha256: REFERENCE_ASSET_SHA,
      methodProjection: referenceMethodResponse('selectReferenceAsset').projection,
      methodProjectionSha256: referenceMethodResponse('selectReferenceAsset').projectionSha256,
      methodAttestation: referenceMethodResponse('selectReferenceAsset').methodAttestation,
    }), expect.any(AbortSignal))
    expect(previewElementProfile).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'selectReferenceAsset',
      candidateAssetId: REFERENCE_ASSET_ID,
      candidateAssetSha256: REFERENCE_ASSET_SHA,
    }), expect.any(AbortSignal))
    expect(commitElementProfile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetReferenceConfirmSelect }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferenceCommitSelect }))

    expect(await screen.findByText(zh.assetReferenceCommitSucceededSelect)).toBeTruthy()
    expect(commitElementProfile).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'selectReferenceAsset',
      candidateAssetId: REFERENCE_ASSET_ID,
      candidateAssetSha256: REFERENCE_ASSET_SHA,
    }), expect.any(AbortSignal))
    expect(elementProfile).toHaveBeenCalledTimes(2)
    expect(candidates).toHaveBeenCalledTimes(2)
  })

  it('keeps the recovery marker and hides success when selection post-state is malformed', async () => {
    const malformedPostCandidate = {
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Selected',
      isSelected: true,
      decisionKind: 'humanReview',
      decisionIdentity: 'user-1',
    } as const
    const { port, candidates } = createReferencePort(
      'selectReferenceAsset',
      REFERENCE_CANDIDATE,
      malformedPostCandidate,
    )
    mount(port)

    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(REFERENCE_ASSET_ID) }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferencePrepareSelect }))
    await screen.findByText(zh.assetReferenceZeroExecution)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetReferenceConfirmSelect }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferenceCommitSelect }))

    await waitFor(() => { expect(candidates).toHaveBeenCalledTimes(2) })
    expect(await screen.findAllByText('易梦参考素材提交后目标候选状态与操作不一致'))
      .not.toHaveLength(0)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
    expect(screen.queryByRole('heading', { name: zh.assetReferenceCommitSucceededSelect })).toBeNull()
  })

  it('records regeneration as an intent-only ChangeSet and never starts a Provider or worker', async () => {
    const rejectedCandidate = {
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Rejected',
      decisionKind: 'humanReview',
      decisionIdentity: 'user-1',
    } as const
    const { port, referenceAssetMethod, proposeReferenceAsset, commitElementProfile } =
      createReferencePort('requestReferenceRegeneration', rejectedCandidate)
    mount(port)

    fireEvent.click(await screen.findByRole('button', { name: zh.assetReferenceRegenerateOperation }))
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(REFERENCE_ASSET_ID) }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.assetReferenceRepairPrompt }), {
      target: { value: REPAIR_PROMPT },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferencePrepareRegenerate }))

    expect(await screen.findByText(zh.assetReferenceRegenerateNotice)).toBeTruthy()
    expect(screen.getByText(zh.assetReferenceZeroExecution)).toBeTruthy()
    expect(referenceAssetMethod).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'requestReferenceRegeneration',
      assetId: REFERENCE_ASSET_ID,
      assetSha256: REFERENCE_ASSET_SHA,
    }), expect.any(AbortSignal))
    expect(proposeReferenceAsset).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'requestReferenceRegeneration',
      repairPrompt: REPAIR_PROMPT,
    }), expect.any(AbortSignal))
    expect(commitElementProfile).not.toHaveBeenCalled()
  })

  it('keeps the recovery marker and hides success when regeneration post-state is malformed', async () => {
    const rejectedCandidate = {
      ...REFERENCE_CANDIDATE,
      selectionStatus: 'Rejected',
      decisionKind: 'humanReview',
      decisionIdentity: 'user-1',
    } as const
    const { port, candidates } = createReferencePort(
      'requestReferenceRegeneration',
      rejectedCandidate,
      rejectedCandidate,
    )
    mount(port)

    fireEvent.click(await screen.findByRole('button', { name: zh.assetReferenceRegenerateOperation }))
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(REFERENCE_ASSET_ID) }))
    fireEvent.change(screen.getByRole('textbox', { name: zh.assetReferenceRepairPrompt }), {
      target: { value: REPAIR_PROMPT },
    })
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferencePrepareRegenerate }))
    await screen.findByText(zh.assetReferenceRegenerateNotice)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.assetReferenceConfirmRegenerate }))
    fireEvent.click(screen.getByRole('button', { name: zh.assetReferenceCommitRegenerate }))

    await waitFor(() => { expect(candidates).toHaveBeenCalledTimes(2) })
    expect(await screen.findAllByText('易梦参考素材提交后目标候选状态与操作不一致'))
      .not.toHaveLength(0)
    expect(readCommandCommitRecoveryMarker(PROJECT_ID, 'prop', TARGET_ID).status).toBe('ready')
    expect(screen.queryByRole('heading', { name: zh.assetReferenceCommitSucceededRegenerate })).toBeNull()
  })
})
