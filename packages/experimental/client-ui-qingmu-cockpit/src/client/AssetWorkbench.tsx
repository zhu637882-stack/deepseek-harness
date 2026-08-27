import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImagoElementMethodResponse,
  ImagoReferenceAssetMethodResponse,
  JsonRecord,
  QingmuYimengPort,
  YimengCommitElementProfileResponse,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionResponse,
  YimengCreateReferenceRightsExceptionReleaseResponse,
  YimengElementProfileReference,
  YimengElementProfileResponse,
  YimengElementReviewFeedResponse,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengPreviewElementProfileResponse,
  YimengReferenceAssetCandidate,
  YimengReferenceActionOperation,
  YimengReferenceAssetOperation,
  YimengReferenceCandidatesResponse,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceRightsPreviewElementProfileResponse,
  YimengReferenceRightsRecord,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionRelease,
  YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import { ReferenceRightsEditor, ReferenceRightsSummary } from './ReferenceRightsEditor.tsx'
import {
  assertCanonicalReferenceRightsRecord,
  createReferenceRightsDraft,
  digestReferenceRightsRecord,
  normalizeReferenceRightsDraft,
  referenceRightsRecordsEqual,
  type ReferenceRightsDraft,
} from './reference-rights.ts'
import {
  clearCommandCommitRecoveryMarker,
  createCommandCommitRecoveryMarker,
  digestCommandRecoveryHumanDecisions,
  digestCommandRecoveryVisualBaseline,
  deriveCommandIdempotencyKey,
  discardCommandCommitRecoveryMarker,
  readCommandCommitRecoveryMarker,
  writeCommandCommitRecoveryMarker,
  type CommandElementKind,
  type CommandCommitRecoveryMarker,
  type CommandCommitRecoveryMarkerRead,
} from './command-commit-recovery.ts'
import {
  REFERENCE_RIGHTS_EXCEPTION_FIELDS,
  clearReferenceRightsExceptionReleaseRecoveryMarker,
  createReferenceRightsExceptionReleaseRecoveryMarker,
  deriveReferenceRightsExceptionIdempotencyKey,
  digestReferenceRightsExceptionReason,
  digestReferenceRightsExceptionScope,
  discardReferenceRightsExceptionReleaseRecoveryMarker,
  normalizeReferenceRightsExceptionScope,
  readReferenceRightsExceptionReleaseRecoveryMarker,
  writeReferenceRightsExceptionReleaseRecoveryMarker,
  type ReferenceRightsExceptionReleaseRecoveryMarker,
  type ReferenceRightsExceptionReleaseRecoveryRead,
  type ReferenceRightsExceptionScope,
} from './reference-rights-exception-release-recovery.ts'
import css from './QingmuCockpit.module.css'

const SHA256 = /^[0-9a-f]{64}$/

type Phase = 'empty' | 'loading' | 'draft' | 'preparing' | 'preview' | 'committing' | 'recovering' | 'committed'

const PHASE_LOCALE_KEY = {
  empty: 'assetPhase_empty',
  loading: 'assetPhase_loading',
  draft: 'assetPhase_draft',
  preparing: 'assetPhase_preparing',
  preview: 'assetPhase_preview',
  committing: 'assetPhase_committing',
  recovering: 'assetPhase_recovering',
  committed: 'assetPhase_committed',
} as const satisfies Record<Phase, QingmuCockpitKey>

export interface AssetWorkbenchProps {
  readonly projectId: string
  readonly semanticAssets: readonly unknown[]
  readonly port: QingmuYimengPort
  readonly t: (key: QingmuCockpitKey) => string
  readonly onCommitted: () => Promise<void>
}

interface ElementChoice {
  readonly id: string
  readonly kind: CommandElementKind
  readonly name: string
}

interface ReferenceActionProposalLineage {
  readonly changeSetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly operation: YimengReferenceActionOperation
  readonly candidateAssetId: string
  readonly candidateAssetSha256: string
}

interface ReferenceRightsProposalLineage {
  readonly changeSetId: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
  readonly payloadSha256: string
  readonly operation: 'replaceReferenceRights'
  readonly referenceAssetId: string
  readonly referenceAssetSha256: string
  readonly rights: YimengReferenceRightsRecord
  readonly selectionStatus: string
  readonly isSelected: boolean
}

type ReferenceProposalLineage = ReferenceActionProposalLineage | ReferenceRightsProposalLineage

const ELEMENT_KIND_LOCALE_KEY = {
  actor: 'assetKindActor',
  scene: 'assetKindScene',
  prop: 'assetKindProp',
} as const satisfies Record<CommandElementKind, QingmuCockpitKey>

const ELEMENT_ID_FIELD = {
  actor: 'actorId',
  scene: 'sceneId',
  prop: 'propId',
} as const satisfies Record<CommandElementKind, string>

const REFERENCE_STATUS_LOCALE_KEY = {
  Unselected: 'assetReferenceStatus_Unselected',
  Selected: 'assetReferenceStatus_Selected',
  Rejected: 'assetReferenceStatus_Rejected',
  Stale: 'assetReferenceStatus_Stale',
} as const satisfies Record<YimengReferenceAssetCandidate['selectionStatus'], QingmuCockpitKey>

const HUMAN_DECISION_LOCALE_KEY = {
  approve: 'assetReviewDecisionApprove',
  reject: 'assetReviewDecisionReject',
  request_changes: 'assetReviewDecisionRequestChanges',
} as const satisfies Record<YimengHumanDecisionValue, QingmuCockpitKey>

const REFERENCE_RIGHTS_EXCEPTION_FIELD_LOCALE_KEY = {
  sourceType: 'assetRightsSourceType',
  rightsHolder: 'assetRightsHolder',
  authorizationScope: 'assetRightsAuthorizationScope',
  territory: 'assetRightsTerritory',
  term: 'assetRightsTerm',
  restrictions: 'assetRightsRestrictions',
  contains: 'assetRightsContains',
  providerTerms: 'assetRightsProviderTerms',
  modelLicenses: 'assetRightsModelLicenses',
  humanDeclaration: 'assetRightsHumanDeclaration',
  contentCredentials: 'assetRightsContentCredentials',
} as const satisfies Record<YimengReferenceRightsExceptionField, QingmuCockpitKey>

function semanticElementKind(value: unknown): CommandElementKind | undefined {
  if (value === 'character' || value === 'actor') return 'actor'
  if (value === 'scene' || value === 'environment') return 'scene'
  return value === 'prop' ? 'prop' : undefined
}

function elementOperation(kind: CommandElementKind): 'replaceVisualIdentity' | 'replaceVisualPrompt' {
  return kind === 'actor' ? 'replaceVisualIdentity' : 'replaceVisualPrompt'
}

function elementVisualValue(subject: JsonRecord, kind: CommandElementKind): string {
  return stringOf(kind === 'actor' ? subject.visualIdentity : subject.visualPrompt) ?? ''
}

function recordOf(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every(key => expected.includes(key))
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function boolOf(value: unknown): boolean {
  return value === true
}

/** Keep runtime RPC validation exact even when generated TypeScript contracts use literal fields. */
function runtimeEquals(left: unknown, right: unknown): boolean {
  return left === right
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertSnapshot(
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): void {
  const root = snapshot as unknown as JsonRecord
  const subject = recordOf(snapshot.subject)
  if (
    root.schema !== 'jason.qingmu-element-profile-subject-read.v2'
    || subject.schema !== 'jason.qingmu-element-profile-subject.v2'
    || subject.projectId !== projectId
    || subject.targetType !== 'element_profile'
    || subject.elementKind !== elementKind
    || subject[ELEMENT_ID_FIELD[elementKind]] !== targetId
    || !Number.isSafeInteger(subject.profileRevision)
    || (subject.profileRevision as number) < 0
    || !SHA256.test(snapshot.snapshotSha256)
    || !Array.isArray(subject.references)
  ) {
    throw new Error('易梦返回的元素资料与当前业务对象不一致')
  }
  const bindings = new Set<string>()
  for (const [index, value] of snapshot.subject.references.entries()) {
    const reference = recordOf(value)
    const assetId = stringOf(reference.assetId)
    const sha256 = stringOf(reference.sha256)
    const selectionStatus = stringOf(reference.selectionStatus)
    if (
      assetId === undefined
      || sha256 === undefined
      || !SHA256.test(sha256)
      || selectionStatus === undefined
      || typeof reference.isSelected !== 'boolean'
      || typeof reference.rightsRecorded !== 'boolean'
    ) throw new Error(`易梦参考素材[${String(index)}]权威字段不完整`)
    assertCanonicalReferenceRightsRecord(reference.rights, `易梦参考素材[${String(index)}].rights`)
    const binding = `${assetId}:${sha256}`
    if (bindings.has(binding)) throw new Error('易梦返回了重复的参考素材绑定')
    bindings.add(binding)
  }
}

function referenceBinding(reference: Pick<YimengElementProfileReference, 'assetId' | 'sha256'>): string {
  return `${reference.assetId}:${reference.sha256}`
}

function findReference(
  subjectValue: unknown,
  assetId: string,
  sha256: string,
): YimengElementProfileReference | undefined {
  const references = arrayOf(recordOf(subjectValue).references)
  const matches = references.filter((value) => {
    const reference = recordOf(value)
    return reference.assetId === assetId && reference.sha256 === sha256
  })
  return matches.length === 1 ? matches[0] as YimengElementProfileReference : undefined
}

function assertReferenceSelectionPreserved(
  reference: YimengElementProfileReference | undefined,
  selectionStatus: string,
  isSelected: boolean,
  field: string,
): asserts reference is YimengElementProfileReference {
  if (
    reference === undefined
    || reference.selectionStatus !== selectionStatus
    || reference.isSelected !== isSelected
  ) throw new Error(`${field}改变了参考素材 selectionStatus 或 isSelected`)
}

function isHumanDecisionValue(value: unknown): value is YimengHumanDecisionValue {
  return value === 'approve' || value === 'reject' || value === 'request_changes'
}

function sameCommentEvent(left: unknown, right: unknown): boolean {
  const a = recordOf(left)
  const b = recordOf(right)
  return [
    'id',
    'subjectType',
    'subjectId',
    'subjectRevision',
    'subjectSha256',
    'body',
    'actorId',
    'actorRole',
    'authSessionId',
    'createdAt',
  ].every(field => a[field] === b[field])
}

function sameHumanDecision(left: unknown, right: unknown, includeStale = true): boolean {
  const a = recordOf(left)
  const b = recordOf(right)
  const fields = [
    'id',
    'subjectType',
    'subjectId',
    'subjectRevision',
    'subjectSha256',
    'decision',
    'reason',
    'actorId',
    'actorRole',
    'authSessionId',
    'decidedAt',
  ]
  return fields.every(field => a[field] === b[field])
    && (!includeStale || a.stale === b.stale)
}

function assertReviewComment(value: unknown, subjectId: string, field: string): void {
  const comment = recordOf(value)
  const body = stringOf(comment.body)
  if (
    comment.subjectType !== 'element_profile'
    || comment.subjectId !== subjectId
    || !Number.isSafeInteger(comment.subjectRevision)
    || (comment.subjectRevision as number) < 0
    || typeof comment.subjectSha256 !== 'string'
    || !SHA256.test(comment.subjectSha256)
    || body === undefined
    || body.length > 8000
    || stringOf(comment.id) === undefined
    || stringOf(comment.actorId) === undefined
    || comment.actorRole !== 'commenter'
    || stringOf(comment.authSessionId) === undefined
    || stringOf(comment.createdAt) === undefined
  ) {
    throw new Error(`${field} 与当前评论合同不一致`)
  }
}

function assertReviewDecision(
  value: unknown,
  subject: { readonly id: string; readonly revision: number; readonly sha256: string },
  field: string,
): void {
  const decision = recordOf(value)
  const stale = decision.subjectId !== subject.id
    || decision.subjectRevision !== subject.revision
    || decision.subjectSha256 !== subject.sha256
  if (
    decision.subjectType !== 'element_profile'
    || stringOf(decision.subjectId) === undefined
    || !Number.isSafeInteger(decision.subjectRevision)
    || (decision.subjectRevision as number) < 0
    || typeof decision.subjectSha256 !== 'string'
    || !SHA256.test(decision.subjectSha256)
    || !isHumanDecisionValue(decision.decision)
    || stringOf(decision.reason) === undefined
    || stringOf(decision.id) === undefined
    || stringOf(decision.actorId) === undefined
    || decision.actorRole !== 'approver'
    || stringOf(decision.authSessionId) === undefined
    || stringOf(decision.decidedAt) === undefined
    || decision.stale !== stale
  ) {
    throw new Error(`${field} 与正式人工决定合同不一致`)
  }
}

function assertReviewFeed(
  feed: YimengElementReviewFeedResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): void {
  const root = recordOf(feed)
  const subject = recordOf(root.subject)
  const capabilities = recordOf(root.capabilities)
  const snapshotSubject = recordOf(snapshot.subject)
  if (
    root.schema !== 'jason.qingmu-element-review-feed.v1'
    || root.projectId !== projectId
    || root.elementKind !== elementKind
    || root.targetId !== targetId
    || subject.type !== 'element_profile'
    || subject.id !== targetId
    || subject.revision !== snapshotSubject.profileRevision
    || subject.sha256 !== snapshot.snapshotSha256
    || typeof capabilities.canComment !== 'boolean'
    || typeof capabilities.canDecide !== 'boolean'
    || !Array.isArray(root.comments)
    || !Array.isArray(root.decisions)
    || (root.currentDecision !== null && (
      typeof root.currentDecision !== 'object'
      || Array.isArray(root.currentDecision)
    ))
  ) {
    throw new Error('易梦评论与决定未精确绑定当前元素资料版本')
  }
  for (const [index, comment] of feed.comments.entries()) {
    assertReviewComment(comment, targetId, `评论[${String(index)}]`)
  }
  for (const [index, decision] of feed.decisions.entries()) {
    assertReviewDecision(decision, feed.subject, `正式人工决定[${String(index)}]`)
  }
  if (feed.currentDecision !== null) {
    assertReviewDecision(feed.currentDecision, feed.subject, '当前正式人工决定')
    if (
      feed.currentDecision.stale
      || !feed.decisions.some(decision => sameHumanDecision(decision, feed.currentDecision))
    ) {
      throw new Error('易梦当前正式人工决定未精确绑定当前元素资料版本')
    }
  }
}

function assertCandidateSelectionUnchanged(
  before: YimengReferenceCandidatesResponse,
  after: YimengReferenceCandidatesResponse,
): void {
  if (before.candidates.length !== after.candidates.length) {
    throw new Error('评论后的权威候选选择状态发生变化')
  }
  for (const candidate of before.candidates) {
    const matches = after.candidates.filter(value => (
      value.assetId === candidate.assetId && value.sha256 === candidate.sha256
    ))
    if (
      matches.length !== 1
      || matches[0]?.selectionStatus !== candidate.selectionStatus
      || matches[0]?.isSelected !== candidate.isSelected
    ) {
      throw new Error('评论后的权威候选选择状态发生变化')
    }
  }
}

function assertCurrentDecisionUnchanged(
  before: YimengHumanDecision | null,
  after: YimengHumanDecision | null,
): void {
  if (
    (before === null) !== (after === null)
    || (before !== null && after !== null && !sameHumanDecision(before, after))
  ) {
    throw new Error('评论后的正式人工决定发生变化')
  }
}

function assertCreatedComment(
  response: YimengCreateCommentResponse,
  expectedBody: string,
  feed: YimengElementReviewFeedResponse,
): JsonRecord {
  const root = recordOf(response)
  const comment = recordOf(root.comment)
  if (
    root.schema !== 'jason.qingmu-element-comment-result.v1'
    || comment.subjectRevision !== feed.subject.revision
    || comment.subjectSha256 !== feed.subject.sha256
    || comment.body !== expectedBody
  ) {
    throw new Error('易梦评论回执与当前元素资料版本不一致')
  }
  assertReviewComment(comment, feed.subject.id, '评论回执')
  return comment
}

function assertCreatedHumanDecision(
  response: YimengCreateHumanDecisionResponse,
  expectedDecision: YimengHumanDecisionValue,
  expectedReason: string,
  feed: YimengElementReviewFeedResponse,
): JsonRecord {
  const root = recordOf(response)
  const decision = recordOf(root.decision)
  if (
    root.schema !== 'jason.qingmu-element-human-decision-result.v1'
    || decision.subjectType !== 'element_profile'
    || decision.subjectId !== feed.subject.id
    || decision.subjectRevision !== feed.subject.revision
    || decision.subjectSha256 !== feed.subject.sha256
    || decision.decision !== expectedDecision
    || decision.reason !== expectedReason
    || decision.actorRole !== 'approver'
    || stringOf(decision.id) === undefined
    || stringOf(decision.actorId) === undefined
    || stringOf(decision.authSessionId) === undefined
    || stringOf(decision.decidedAt) === undefined
  ) {
    throw new Error('易梦正式人工决定回执与当前元素资料版本不一致')
  }
  return decision
}

function createReviewIdempotencyKey(lane: 'comment' | 'decision'): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `qingmu:element-review:${lane}:${nonce}`
}

function assertReferenceCandidates(
  candidates: YimengReferenceCandidatesResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): void {
  const subject = recordOf(snapshot.subject)
  const root = recordOf(candidates)
  const candidateValues = root.candidates
  if (
    root.schema !== 'jason.qingmu-reference-asset-candidates.v1'
    || root.projectId !== projectId
    || root.targetType !== 'element_profile'
    || root.targetId !== targetId
    || root.elementKind !== elementKind
    || root.profileRevision !== subject.profileRevision
    || root.elementSnapshotSha256 !== snapshot.snapshotSha256
    || root.humanApprovalInferred !== false
    || !Array.isArray(candidateValues)
  ) {
    throw new Error('易梦参考素材候选与当前元素资料快照不一致')
  }
  for (const candidateValue of candidateValues) {
    const candidate = recordOf(candidateValue)
    const assetId = stringOf(candidate.assetId)
    const sha256 = stringOf(candidate.sha256)
    const materializedSha256 = stringOf(candidate.materializedSha256)
    const qualityProjectionSha256 = stringOf(candidate.qualityProjectionSha256)
    const qualityStatus = stringOf(candidate.qualityStatus)
    const selectionStatus = stringOf(candidate.selectionStatus)
    const decisionKind = stringOf(candidate.decisionKind)
    if (
      candidate.projectId !== projectId
      || candidate.ownerType !== elementKind
      || candidate.ownerId !== targetId
      || assetId === undefined
      || sha256 === undefined
      || !SHA256.test(sha256)
      || materializedSha256 === undefined
      || (materializedSha256 !== '' && !SHA256.test(materializedSha256))
      || qualityProjectionSha256 === undefined
      || !SHA256.test(qualityProjectionSha256)
      || qualityStatus === undefined
      || !['pending', 'passed', 'failed'].includes(qualityStatus)
      || selectionStatus === undefined
      || !['Unselected', 'Selected', 'Rejected', 'Stale'].includes(selectionStatus)
      || decisionKind === undefined
      || !['none', 'referenceSelection', 'humanReview'].includes(decisionKind)
      || typeof candidate.bindingValid !== 'boolean'
      || typeof candidate.isSelected !== 'boolean'
      || typeof candidate.formalConsistencyPassed !== 'boolean'
    ) {
      throw new Error('易梦参考素材候选血缘与当前元素不一致')
    }
  }
}

function assertReferenceCandidatePostState(
  candidates: YimengReferenceCandidatesResponse,
  marker: CommandCommitRecoveryMarker,
): void {
  if (
    marker.operation !== 'selectReferenceAsset'
    && marker.operation !== 'requestReferenceRegeneration'
  ) {
    throw new Error('参考素材提交恢复标记操作无效')
  }
  const matches = candidates.candidates.filter(candidate => (
    candidate.assetId === marker.candidateAssetId
    && candidate.sha256 === marker.candidateAssetSha256
  ))
  if (matches.length !== 1) throw new Error('易梦参考素材提交后未返回唯一目标候选')
  const candidate = matches[0]
  if (
    candidate === undefined
    || !candidate.bindingValid
    || candidate.materializedSha256 !== marker.candidateAssetSha256
  ) {
    throw new Error('易梦参考素材提交后目标候选血缘不一致')
  }
  const valid = marker.operation === 'selectReferenceAsset'
    ? candidate.selectionStatus === 'Selected'
      && candidate.isSelected
      && candidate.decisionKind === 'referenceSelection'
      && candidate.decisionIdentity.trim() !== ''
    : candidate.selectionStatus === 'Rejected'
      && !candidate.isSelected
      && candidate.decisionKind === 'none'
      && candidate.decisionIdentity === ''
  if (!valid) throw new Error('易梦参考素材提交后目标候选状态与操作不一致')
}

async function assertReferenceRightsPostState(
  snapshot: YimengElementProfileResponse,
  marker: CommandCommitRecoveryMarker,
): Promise<YimengElementProfileReference> {
  if (marker.operation !== 'replaceReferenceRights') {
    throw new Error('参考素材权利提交恢复标记操作无效')
  }
  const reference = findReference(snapshot.subject, marker.referenceAssetId, marker.referenceAssetSha256)
  assertReferenceSelectionPreserved(
    reference,
    marker.selectionStatus,
    marker.isSelected,
    '权利提交后的权威参考素材',
  )
  if (!reference.rightsRecorded) throw new Error('权利提交后的权威参考素材未登记 rightsRecorded')
  assertCanonicalReferenceRightsRecord(reference.rights, '权利提交后的权威参考素材.rights')
  if (await digestReferenceRightsRecord(reference.rights) !== marker.referenceRightsSha256) {
    throw new Error('权利提交后的权威参考素材 rights hash 不一致')
  }
  return reference
}

function referenceCandidateEligible(
  candidate: YimengReferenceAssetCandidate,
  operation: YimengReferenceActionOperation,
): boolean {
  if (
    !candidate.bindingValid
    || candidate.sha256 !== candidate.materializedSha256
    || candidate.sourceRevisionId === ''
    || candidate.formalConsistencyCheckId === ''
  ) return false
  if (operation === 'selectReferenceAsset') {
    return candidate.selectionStatus === 'Unselected'
      && !candidate.isSelected
      && candidate.qualityStatus === 'passed'
      && candidate.formalConsistencyPassed
  }
  return candidate.selectionStatus === 'Rejected'
    || (
      candidate.selectionStatus === 'Selected'
      && candidate.isSelected
      && (candidate.decisionKind === 'referenceSelection' || candidate.decisionKind === 'humanReview')
      && candidate.decisionIdentity !== ''
    )
}

function assertMethod(
  method: ImagoElementMethodResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): void {
  const subject = recordOf(method.projection.subject)
  const profile = recordOf(snapshot.subject)
  const attestation = recordOf(method.methodAttestation)
  if (
    !runtimeEquals(method.schema, 'qingmu.imago-element-method-adapter-result.v1')
    || !SHA256.test(method.projectionSha256)
    || subject.project_id !== projectId
    || subject.target_type !== 'element_profile'
    || subject.target_id !== targetId
    || subject.element_kind !== elementKind
    || subject.scope_type !== 'project'
    || subject.scope_id !== projectId
    || subject.base_revision !== profile.profileRevision
    || subject.base_snapshot_sha256 !== snapshot.snapshotSha256
    || !runtimeEquals(method.projection.project_state_persisted, false)
    || !runtimeEquals(method.projection.paid_provider_authority, 'not_granted')
    || !runtimeEquals(method.projection.selection_authority, 'not_granted')
    || !runtimeEquals(method.projection.human_approval_inferred, false)
    || !hasExactKeys(attestation, [
      'schema',
      'algorithm',
      'projectionSha256',
      'inputSnapshotSha256',
      'subjectSha256',
      'signature',
    ])
    || attestation.schema !== 'qingmu.imago-element-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || !SHA256.test(String(attestation.projectionSha256))
    || !SHA256.test(String(attestation.inputSnapshotSha256))
    || !SHA256.test(String(attestation.subjectSha256))
    || !SHA256.test(String(attestation.signature))
    || attestation.projectionSha256 !== method.projectionSha256
    || attestation.inputSnapshotSha256 !== method.projection.input_snapshot_sha256
  ) {
    throw new Error('IMAGO 方法投影与当前易梦资料基线不一致')
  }
}

function assertReferenceMethod(
  method: ImagoReferenceAssetMethodResponse,
  snapshot: YimengElementProfileResponse,
  candidate: YimengReferenceAssetCandidate,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
  operation: YimengReferenceActionOperation,
): asserts method is Extract<
  ImagoReferenceAssetMethodResponse,
  { readonly schema: 'qingmu.imago-reference-asset-method-adapter-result.v1' }
> {
  const subject = recordOf(snapshot.subject)
  const root = recordOf(method)
  const projection = recordOf(root.projection)
  const target = recordOf(projection.target)
  const attestation = recordOf(root.methodAttestation)
  const projectionSha256 = stringOf(root.projectionSha256)
  const inputSnapshotSha256 = stringOf(projection.input_snapshot_sha256)
  if (
    root.schema !== 'qingmu.imago-reference-asset-method-adapter-result.v1'
    || projectionSha256 === undefined
    || !SHA256.test(projectionSha256)
    || projection.schema !== 'qingmu.imago-reference-asset-method-projection.v1'
    || inputSnapshotSha256 === undefined
    || !SHA256.test(inputSnapshotSha256)
    || target.projectId !== projectId
    || target.elementKind !== elementKind
    || target.elementId !== targetId
    || target.profileRevision !== subject.profileRevision
    || target.snapshotSha256 !== snapshot.snapshotSha256
    || target.assetId !== candidate.assetId
    || target.assetSha256 !== candidate.sha256
    || target.operation !== operation
    || !Array.isArray(projection.source_bindings)
    || projection.project_state_persisted !== false
    || projection.providerCalls !== 0
    || projection.workerStarted !== false
    || projection.human_approval_inferred !== false
    || projection.human_signoff_inferred !== false
    || projection.selection_executed !== false
    || !hasExactKeys(attestation, [
      'schema',
      'algorithm',
      'projectionSha256',
      'inputSnapshotSha256',
      'targetSha256',
      'signature',
    ])
    || attestation.schema !== 'qingmu.imago-reference-asset-method-attestation.v1'
    || attestation.algorithm !== 'hmac-sha256'
    || attestation.projectionSha256 !== projectionSha256
    || attestation.inputSnapshotSha256 !== inputSnapshotSha256
    || !SHA256.test(String(attestation.targetSha256))
    || !SHA256.test(String(attestation.signature))
  ) {
    throw new Error('IMAGO 参考素材方法与当前易梦候选血缘不一致')
  }
}

function assertReferenceRightsMethod(
  method: ImagoReferenceAssetMethodResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): asserts method is ImagoElementMethodResponse {
  if (method.schema !== 'qingmu.imago-element-method-adapter-result.v1') {
    throw new Error('IMAGO 权利方法返回了错误的投影合同')
  }
  assertMethod(method, snapshot, projectId, targetId, elementKind)
  const definition = recordOf(method.projection.method_definition)
  const workOrder = recordOf(method.projection.work_order_projection)
  if (
    definition.id !== 'imago-v6-reference-rights-record'
    || definition.version !== 1
    || workOrder.operation !== 'replaceReferenceRights'
    || !Array.isArray(workOrder.allowed_mutations)
    || workOrder.allowed_mutations.length !== 1
    || workOrder.allowed_mutations[0] !== 'replaceReferenceRights'
  ) throw new Error('IMAGO 权利方法未绑定当前 replaceReferenceRights 工作单')
}

type ReferenceRightsExceptionReleaseFact =
  YimengCreateReferenceRightsExceptionReleaseResponse['release']

function normalizeReferenceRightsExceptionReasonInput(value: string): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 8000 || normalized.includes('\u0000')) {
    throw new Error('异常放行理由必须是 1 至 8000 个字符且不得包含 NUL')
  }
  return normalized
}

function sameReferenceRightsExceptionScope(
  left: ReferenceRightsExceptionScope,
  right: ReferenceRightsExceptionScope,
): boolean {
  return left.kind === right.kind
    && left.referenceAssetId === right.referenceAssetId
    && left.referenceAssetSha256 === right.referenceAssetSha256
    && left.rightsRecordSha256 === right.rightsRecordSha256
    && left.rightsFields.length === right.rightsFields.length
    && left.rightsFields.every((field, index) => field === right.rightsFields[index])
}

function sameReferenceRightsExceptionMarker(
  left: ReferenceRightsExceptionReleaseRecoveryMarker,
  right: ReferenceRightsExceptionReleaseRecoveryMarker,
): boolean {
  return left.projectId === right.projectId
    && left.elementKind === right.elementKind
    && left.targetId === right.targetId
    && left.expectedSubjectRevision === right.expectedSubjectRevision
    && left.expectedSubjectSha256 === right.expectedSubjectSha256
    && left.referenceAssetId === right.referenceAssetId
    && left.referenceAssetSha256 === right.referenceAssetSha256
    && left.rightsRecordSha256 === right.rightsRecordSha256
    && left.reasonSha256 === right.reasonSha256
    && left.scopeSha256 === right.scopeSha256
    && left.idempotencyKey === right.idempotencyKey
}

async function assertReferenceRightsExceptionFeed(
  feed: YimengReferenceRightsExceptionReleaseFeedResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): Promise<void> {
  if (
    feed.schema !== 'jason.qingmu-reference-rights-exception-release-feed.v1'
    || feed.projectId !== projectId
    || feed.elementKind !== elementKind
    || feed.targetId !== targetId
    || feed.subject.type !== 'element_profile'
    || feed.subject.id !== targetId
    || feed.subject.revision !== snapshot.subject.profileRevision
    || feed.subject.sha256 !== snapshot.snapshotSha256
    || feed.capabilities.requiresRecentAuthentication !== true
    || feed.capabilities.canRelease
      !== (feed.capabilities.blockedReasonCode === null && feed.capabilities.blockedReason === null)
  ) throw new Error('权利异常放行读取未精确绑定当前元素资料与服务器权限')

  const projectedCurrentReleases = feed.releases.filter(release => !release.stale)
  if (
    new Set(feed.releases.map(release => release.id)).size !== feed.releases.length
    || new Set(feed.currentReleases.map(release => release.id)).size !== feed.currentReleases.length
    || feed.currentReleases.length !== projectedCurrentReleases.length
  ) throw new Error('权利异常放行当前投影不是全部非过期历史事实的精确集合')

  for (const [index, release] of projectedCurrentReleases.entries()) {
    const current = feed.currentReleases[index]
    if (
      current === undefined
      || current.stale
      || current.staleReasonCodes.length !== 0
      || !sameReferenceRightsExceptionRelease(current, release)
      || release.subjectType !== 'element_profile'
      || release.subjectId !== targetId
      || release.subjectRevision !== snapshot.subject.profileRevision
      || release.subjectSha256 !== snapshot.snapshotSha256
    ) throw new Error('权利异常放行当前投影与当前元素版本不一致')
    const reference = findReference(
      snapshot.subject,
      release.scope.referenceAssetId,
      release.scope.referenceAssetSha256,
    )
    if (
      reference === undefined
      || !reference.rightsRecorded
      || await digestReferenceRightsRecord(reference.rights) !== release.scope.rightsRecordSha256
    ) throw new Error('权利异常放行当前投影与当前参考素材或权利记录不一致')
  }
}

function assertReferenceRightsExceptionMethod(
  method: ImagoReferenceAssetMethodResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): asserts method is ImagoElementMethodResponse {
  if (method.schema !== 'qingmu.imago-element-method-adapter-result.v1') {
    throw new Error('IMAGO 异常放行方法返回了错误的投影合同')
  }
  assertMethod(method, snapshot, projectId, targetId, elementKind)
  const definition = recordOf(method.projection.method_definition)
  const workOrder = recordOf(method.projection.work_order_projection)
  if (
    definition.id !== 'imago-v6-reference-rights-exception-release'
    || definition.version !== 1
    || workOrder.operation !== 'recordReferenceRightsExceptionRelease'
    || !Array.isArray(workOrder.allowed_mutations)
    || workOrder.allowed_mutations.length !== 1
    || workOrder.allowed_mutations[0] !== 'recordReferenceRightsExceptionRelease'
  ) throw new Error('IMAGO 方法未绑定当前权利异常放行检查单')
}

async function assertReferenceRightsExceptionResult(
  result: YimengCreateReferenceRightsExceptionReleaseResponse,
  marker: ReferenceRightsExceptionReleaseRecoveryMarker,
): Promise<void> {
  const release = result.release
  const scope = normalizeReferenceRightsExceptionScope(release.scope)
  const normalizedReason = normalizeReferenceRightsExceptionReasonInput(release.reason)
  if (
    result.schema !== 'jason.qingmu-reference-rights-exception-release-result.v1'
    || stringOf(result.changeSetId) === undefined
    || stringOf(result.commandReceiptId) === undefined
    || stringOf(result.eventId) === undefined
    || !SHA256.test(result.payloadSha256)
    || result.changed !== false
    || result.providerCalls !== 0
    || result.selectionAuthority !== 'not_granted'
    || result.humanApprovalInferred !== false
    || stringOf(release.id) === undefined
    || release.decision !== 'exception_release'
    || release.subjectType !== 'element_profile'
    || release.subjectId !== marker.targetId
    || release.subjectRevision !== marker.expectedSubjectRevision
    || release.subjectSha256 !== marker.expectedSubjectSha256
    || scope.referenceAssetId !== marker.referenceAssetId
    || scope.referenceAssetSha256 !== marker.referenceAssetSha256
    || scope.rightsRecordSha256 !== marker.rightsRecordSha256
    || release.actorRole !== 'approver'
    || release.actorNaturalPersonId === release.producerNaturalPersonId
    || release.actorNaturalPersonId === release.assetProducerNaturalPersonId
    || release.reason !== normalizedReason
  ) throw new Error('易梦异常放行回执与本次精确对象、权限或零授权边界不一致')
  const [reasonSha256, scopeSha256] = await Promise.all([
    digestReferenceRightsExceptionReason(normalizedReason),
    digestReferenceRightsExceptionScope(scope),
  ])
  if (reasonSha256 !== marker.reasonSha256 || scopeSha256 !== marker.scopeSha256) {
    throw new Error('易梦异常放行回执理由或范围摘要与恢复标记不一致')
  }
}

async function assertReferenceRightsExceptionRecovery(
  recovery: YimengRecoverReferenceRightsExceptionReleaseResponse,
  marker: ReferenceRightsExceptionReleaseRecoveryMarker,
): Promise<YimengCreateReferenceRightsExceptionReleaseResponse> {
  if (
    recovery.schema !== 'jason.qingmu-command-receipt-recovery.v1'
    || recovery.recovered !== true
    || !SHA256.test(recovery.receiptSha256)
  ) throw new Error('易梦异常放行 GET 回执恢复合同不完整')
  await assertReferenceRightsExceptionResult(recovery.receipt, marker)
  return recovery.receipt
}

async function assertReferenceRightsExceptionMarkerCurrent(
  snapshot: YimengElementProfileResponse,
  marker: ReferenceRightsExceptionReleaseRecoveryMarker,
): Promise<void> {
  if (
    snapshot.subject.profileRevision !== marker.expectedSubjectRevision
    || snapshot.snapshotSha256 !== marker.expectedSubjectSha256
  ) throw new Error('当前元素版本已漂移，异常放行恢复不能显示成功')
  const reference = findReference(
    snapshot.subject,
    marker.referenceAssetId,
    marker.referenceAssetSha256,
  )
  if (reference === undefined) {
    throw new Error('当前参考素材绑定已漂移，异常放行恢复不能显示成功')
  }
  assertCanonicalReferenceRightsRecord(reference.rights, '异常放行恢复参考素材.rights')
  if (await digestReferenceRightsRecord(reference.rights) !== marker.rightsRecordSha256) {
    throw new Error('当前参考素材权利记录已漂移，异常放行恢复不能显示成功')
  }
}

function sameReferenceRightsExceptionRelease(
  release: YimengReferenceRightsExceptionRelease,
  fact: ReferenceRightsExceptionReleaseFact,
): boolean {
  return release.id === fact.id
    && release.decision === fact.decision
    && release.subjectType === fact.subjectType
    && release.subjectId === fact.subjectId
    && release.subjectRevision === fact.subjectRevision
    && release.subjectSha256 === fact.subjectSha256
    && sameReferenceRightsExceptionScope(release.scope, fact.scope)
    && release.actorId === fact.actorId
    && release.actorRole === fact.actorRole
    && release.actorNaturalPersonId === fact.actorNaturalPersonId
    && release.producerActorId === fact.producerActorId
    && release.producerNaturalPersonId === fact.producerNaturalPersonId
    && release.assetProducerActorId === fact.assetProducerActorId
    && release.assetProducerNaturalPersonId === fact.assetProducerNaturalPersonId
    && release.assetProducerTaskId === fact.assetProducerTaskId
    && release.assetProducerTaskRequestSha256 === fact.assetProducerTaskRequestSha256
    && release.authSessionId === fact.authSessionId
    && release.reason === fact.reason
    && release.releasedAt === fact.releasedAt
}

async function assertReferenceRightsExceptionFeedReconciled(
  feed: YimengReferenceRightsExceptionReleaseFeedResponse,
  result: YimengCreateReferenceRightsExceptionReleaseResponse,
  snapshot: YimengElementProfileResponse,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): Promise<void> {
  await assertReferenceRightsExceptionFeed(feed, snapshot, projectId, targetId, elementKind)
  const historical = feed.releases.filter(release => (
    release.id === result.release.id && sameReferenceRightsExceptionRelease(release, result.release)
  ))
  const current = feed.currentReleases.filter(release => (
    release.id === result.release.id && sameReferenceRightsExceptionRelease(release, result.release)
  ))
  if (
    historical.length !== 1
    || current.length !== 1
    || current[0]?.stale !== false
    || current[0]?.staleReasonCodes.length !== 0
  ) throw new Error('权威 GET 未返回当前有效且精确对账的异常放行事实')
}

function isReferencePreview(
  preview: YimengPreviewElementProfileResponse,
): preview is YimengReferencePreviewElementProfileResponse {
  return preview.schema === 'jason.qingmu-reference-asset-preview.v1'
}

function isReferenceRightsPreview(
  preview: YimengPreviewElementProfileResponse,
): preview is YimengReferenceRightsPreviewElementProfileResponse {
  return preview.schema === 'jason.qingmu-change-set-preview.v1'
    && preview.operation === 'replaceReferenceRights'
}

function assertReferencePreview(
  preview: YimengPreviewElementProfileResponse,
  snapshot: YimengElementProfileResponse,
  changeSetId: string,
  candidate: YimengReferenceAssetCandidate,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
  operation: YimengReferenceActionOperation,
): asserts preview is YimengReferencePreviewElementProfileResponse {
  const subject = recordOf(snapshot.subject)
  const root = recordOf(preview)
  if (
    root.schema !== 'jason.qingmu-reference-asset-preview.v1'
    || root.changeSetId !== changeSetId
    || root.projectId !== projectId
    || root.targetType !== 'element_profile'
    || root.targetId !== targetId
    || root.elementKind !== elementKind
    || root.operation !== operation
    || root.candidateAssetId !== candidate.assetId
    || root.candidateAssetSha256 !== candidate.sha256
    || root.providerCalls !== 0
    || root.workerStarted !== false
    || root.humanApprovalInferred !== false
    || (root.candidateDrift === true && root.canCommit === true)
    || !Number.isSafeInteger(subject.profileRevision)
  ) {
    throw new Error('易梦参考素材预览与当前候选、操作或零执行边界不一致')
  }
}

function assertReferenceRightsPreview(
  preview: YimengPreviewElementProfileResponse,
  snapshot: YimengElementProfileResponse,
  method: ImagoElementMethodResponse,
  changeSetId: string,
  reference: YimengElementProfileReference,
  rights: YimengReferenceRightsRecord,
  projectId: string,
  targetId: string,
  elementKind: CommandElementKind,
): asserts preview is YimengReferenceRightsPreviewElementProfileResponse {
  if (!isReferenceRightsPreview(preview)) throw new Error('易梦返回的权利预览操作类型不一致')
  const changeSet = preview.changeSet
  const impact = recordOf(preview.impactAnalysis)
  const preflight = recordOf(preview.preflight)
  const baseReference = findReference(preview.baseSubject, reference.assetId, reference.sha256)
  const currentReference = findReference(preview.authoritativeCurrentSubject, reference.assetId, reference.sha256)
  assertReferenceSelectionPreserved(baseReference, reference.selectionStatus, reference.isSelected, '权利预览基线')
  if (preview.canCommit) {
    assertReferenceSelectionPreserved(currentReference, reference.selectionStatus, reference.isSelected, '权利预览当前版本')
  }
  if (
    preview.changeSetId !== changeSetId
    || preview.changeSetId !== changeSet.id
    || preview.projectId !== projectId
    || preview.targetType !== 'element_profile'
    || preview.targetId !== targetId
    || preview.elementKind !== elementKind
    || preview.operation !== 'replaceReferenceRights'
    || preview.referenceAssetId !== reference.assetId
    || preview.referenceAssetSha256 !== reference.sha256
    || preview.baseRevision !== snapshot.subject.profileRevision
    || preview.baseSnapshotSha256 !== snapshot.snapshotSha256
    || preview.payloadSha256 !== changeSet.payloadSha256
    || preview.methodProjectionSha256 !== method.projectionSha256
    || changeSet.projectId !== projectId
    || changeSet.episodeId !== null
    || changeSet.targetType !== 'element_profile'
    || changeSet.targetId !== targetId
    || changeSet.baseRevision !== snapshot.subject.profileRevision
    || changeSet.baseSnapshotSha256 !== snapshot.snapshotSha256
    || !referenceRightsRecordsEqual(preview.proposedReferenceRights, rights)
    || !SHA256.test(preview.previewSha256)
    || !SHA256.test(preview.impactSha256)
    || typeof preview.changed !== 'boolean'
    || typeof preview.authoritativeChanged !== 'boolean'
    || typeof preview.revisionConflict !== 'boolean'
    || typeof preview.baseSnapshotConflict !== 'boolean'
    || typeof preview.impactConflict !== 'boolean'
    || typeof preview.canCommit !== 'boolean'
    || typeof preview.referenceInvalidationExpected !== 'boolean'
    || ((preview.revisionConflict || preview.baseSnapshotConflict || preview.impactConflict) && preview.canCommit)
    || !hasExactKeys(impact, [
      'affectedReferenceAssetIds',
      'invalidatedApprovalAssetIds',
      'affectedDerivedAssetIds',
      'affectedReferencePackIds',
      'affectedPromptIrIds',
      'affectedStoryboardFrameIds',
      'unknowns',
    ])
    || !Object.values(impact).every(isStringArray)
    || preflight.costGate !== 'not_granted'
    || preflight.selectionAuthority !== 'not_granted'
    || preflight.humanApprovalInferred !== false
  ) throw new Error('易梦权利预览与当前素材、权利正文、影响或非授权边界不一致')
}

function assertPreview(
  preview: YimengPreviewElementProfileResponse,
  snapshot: YimengElementProfileResponse,
  method: ImagoElementMethodResponse,
  targetId: string,
  elementKind: CommandElementKind,
  proposedValue: string,
): void {
  if (isReferencePreview(preview) || isReferenceRightsPreview(preview)) {
    throw new Error('易梦返回的元素预览操作类型不一致')
  }
  const subject = recordOf(snapshot.subject)
  const changeSet = preview.changeSet
  const impact = recordOf(preview.impactAnalysis)
  if (
    !runtimeEquals(preview.schema, 'jason.qingmu-change-set-preview.v1')
    || preview.changeSetId !== changeSet.id
    || preview.projectId !== subject.projectId
    || !runtimeEquals(preview.targetType, 'element_profile')
    || preview.targetId !== targetId
    || !runtimeEquals(preview.elementKind, elementKind)
    || !runtimeEquals(preview.operation, elementOperation(elementKind))
    || preview.baseRevision !== subject.profileRevision
    || preview.baseSnapshotSha256 !== snapshot.snapshotSha256
    || preview.payloadSha256 !== changeSet.payloadSha256
    || preview.methodProjectionSha256 !== method.projectionSha256
    || (elementKind === 'actor'
      ? preview.proposedVisualIdentity !== proposedValue || preview.proposedVisualPrompt !== undefined
      : preview.proposedVisualPrompt !== proposedValue || preview.proposedVisualIdentity !== undefined)
    || changeSet.projectId !== subject.projectId
    || !runtimeEquals(changeSet.episodeId, null)
    || !runtimeEquals(changeSet.targetType, 'element_profile')
    || changeSet.targetId !== targetId
    || changeSet.baseRevision !== subject.profileRevision
    || changeSet.baseSnapshotSha256 !== snapshot.snapshotSha256
    || !SHA256.test(preview.previewSha256)
    || !SHA256.test(preview.impactSha256)
    || !hasExactKeys(impact, [
      'affectedReferenceAssetIds',
      'invalidatedApprovalAssetIds',
      'affectedDerivedAssetIds',
      'affectedReferencePackIds',
      'affectedPromptIrIds',
      'affectedStoryboardFrameIds',
      'unknowns',
    ])
    || !Object.values(impact).every(isStringArray)
  ) {
    throw new Error('易梦返回的元素提案、预览或 IMAGO 方法血缘不一致')
  }
}

function assertCommitReceiptLineage(
  receipt: YimengCommitElementProfileResponse,
  marker: CommandCommitRecoveryMarker,
): void {
  if (marker.operation === 'selectReferenceAsset' || marker.operation === 'requestReferenceRegeneration') {
    const root = recordOf(receipt)
    const authoritativeSnapshotSha256 = stringOf(root.authoritativeSnapshotSha256)
    if (
      root.schema !== 'jason.qingmu-reference-asset-commit-result.v1'
      || root.changeSetId !== marker.changeSetId
      || root.projectId !== marker.projectId
      || root.targetType !== marker.targetType
      || root.targetId !== marker.targetId
      || root.elementKind !== marker.elementKind
      || root.operation !== marker.operation
      || root.candidateAssetId !== marker.candidateAssetId
      || root.candidateAssetSha256 !== marker.candidateAssetSha256
      || root.baseRevision !== marker.baseRevision
      || root.payloadSha256 !== marker.payloadSha256
      || root.idempotencyKey !== marker.idempotencyKey
      || root.changed !== true
      || root.providerCalls !== 0
      || root.workerStarted !== false
      || root.humanApprovalInferred !== false
      || root.eventType !== (marker.operation === 'selectReferenceAsset'
        ? 'ReferenceAssetSelected'
        : 'ReferenceRegenerationRequested')
      || authoritativeSnapshotSha256 === undefined
      || !SHA256.test(authoritativeSnapshotSha256)
    ) {
      throw new Error('易梦返回的参考素材提交回执与本次 ChangeSet 血缘不一致')
    }
    return
  }
  if (marker.operation === 'replaceReferenceRights') {
    const root = recordOf(receipt)
    const impact = recordOf(root.impactAnalysis)
    if (
      root.schema !== 'jason.qingmu-element-profile-commit-result.v1'
      || root.changeSetId !== marker.changeSetId
      || root.projectId !== marker.projectId
      || root.targetType !== marker.targetType
      || root.targetId !== marker.targetId
      || root.elementKind !== marker.elementKind
      || root.operation !== marker.operation
      || root.referenceAssetId !== marker.referenceAssetId
      || root.referenceAssetSha256 !== marker.referenceAssetSha256
      || root.baseRevision !== marker.baseRevision
      || root.payloadSha256 !== marker.payloadSha256
      || root.idempotencyKey !== marker.idempotencyKey
      || typeof root.changed !== 'boolean'
      || !Number.isSafeInteger(root.authoritativeRevision)
      || typeof root.referenceInvalidated !== 'boolean'
      || root.eventType !== (root.referenceInvalidated ? 'ReferenceInvalidated' : 'ElementProfileChanged')
      || typeof root.authoritativeSnapshotSha256 !== 'string'
      || !SHA256.test(root.authoritativeSnapshotSha256)
      || (root.changed === false && (
        root.authoritativeRevision !== marker.baseRevision
        || root.authoritativeSnapshotSha256 !== marker.baseSnapshotSha256
        || root.referenceInvalidated !== false
      ))
      || (root.changed === true && root.authoritativeRevision !== marker.baseRevision + 1)
      || typeof root.impactSha256 !== 'string'
      || !SHA256.test(root.impactSha256)
      || !hasExactKeys(impact, [
        'affectedReferenceAssetIds',
        'invalidatedApprovalAssetIds',
        'affectedDerivedAssetIds',
        'affectedReferencePackIds',
        'affectedPromptIrIds',
        'affectedStoryboardFrameIds',
        'unknowns',
      ])
      || !Object.values(impact).every(isStringArray)
    ) throw new Error('易梦返回的参考素材权利提交回执与本次 ChangeSet 血缘不一致')
    return
  }
  if (
    receipt.schema !== 'jason.qingmu-element-profile-commit-result.v1'
    || receipt.changeSetId !== marker.changeSetId
    || receipt.projectId !== marker.projectId
    || !runtimeEquals(receipt.targetType, marker.targetType)
    || receipt.targetId !== marker.targetId
    || receipt.elementKind !== marker.elementKind
    || receipt.operation !== marker.operation
    || receipt.operation !== elementOperation(marker.elementKind)
    || receipt.baseRevision !== marker.baseRevision
    || receipt.payloadSha256 !== marker.payloadSha256
    || receipt.idempotencyKey !== marker.idempotencyKey
    || !SHA256.test(receipt.authoritativeSnapshotSha256)
    || !SHA256.test(receipt.impactSha256)
  ) {
    throw new Error('易梦返回的元素提交回执与本次 ChangeSet 血缘不一致')
  }
}

function assertRecoveryLineage(
  recovery: YimengRecoverElementProfileCommitResponse,
  marker: CommandCommitRecoveryMarker,
): YimengCommitElementProfileResponse {
  if (
    !runtimeEquals(recovery.schema, 'jason.qingmu-command-receipt-recovery.v1')
    || !runtimeEquals(recovery.recovered, true)
    || !SHA256.test(recovery.receiptSha256)
  ) {
    throw new Error('易梦返回的元素回执恢复合同不完整')
  }
  assertCommitReceiptLineage(recovery.receipt, marker)
  return recovery.receipt
}

/** Human-operated Yimeng element profile editor enriched by a stateless IMAGO method projection. */
export function AssetWorkbench({ projectId, semanticAssets, port, t, onCommitted }: AssetWorkbenchProps) {
  const allChoices = useMemo<readonly ElementChoice[]>(() => semanticAssets.flatMap((value) => {
    const item = recordOf(value)
    const kind = semanticElementKind(item.type)
    const id = stringOf(item.assetId)
    const itemProject = stringOf(item.projectId)
    if (kind === undefined || id === undefined || (itemProject !== undefined && itemProject !== projectId)) return []
    return [{ id, kind, name: stringOf(item.name) ?? id }]
  }), [projectId, semanticAssets])
  const availableKinds = useMemo<readonly CommandElementKind[]>(
    () => (['actor', 'scene', 'prop'] as const).filter(kind => allChoices.some(choice => choice.kind === kind)),
    [allChoices],
  )
  const [elementKind, setElementKind] = useState<CommandElementKind>('actor')
  const choices = useMemo(
    () => allChoices.filter(choice => choice.kind === elementKind),
    [allChoices, elementKind],
  )
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const targetId = choices.some(choice => choice.id === selectedTargetId)
    ? selectedTargetId
    : choices[0]?.id ?? ''
  const [snapshot, setSnapshot] = useState<YimengElementProfileResponse>()
  const [method, setMethod] = useState<ImagoElementMethodResponse>()
  const [referenceCandidates, setReferenceCandidates] = useState<YimengReferenceCandidatesResponse>()
  const [referenceOperation, setReferenceOperation] =
    useState<YimengReferenceAssetOperation>('selectReferenceAsset')
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [selectedRightsReference, setSelectedRightsReference] = useState('')
  const [rightsDraft, setRightsDraft] = useState<ReferenceRightsDraft>()
  const [repairPrompt, setRepairPrompt] = useState('')
  const [referenceError, setReferenceError] = useState<string>()
  const [referenceProposalLineage, setReferenceProposalLineage] = useState<ReferenceProposalLineage>()
  const [reviewFeed, setReviewFeed] = useState<YimengElementReviewFeedResponse>()
  const [reviewError, setReviewError] = useState<string>()
  const [reviewBusy, setReviewBusy] = useState<'comment' | 'decision'>()
  const [reviewStatus, setReviewStatus] = useState<'comment' | 'decision'>()
  const [commentBody, setCommentBody] = useState('')
  const [decisionValue, setDecisionValue] = useState<YimengHumanDecisionValue>('approve')
  const [decisionReason, setDecisionReason] = useState('')
  const [exceptionFeed, setExceptionFeed] =
    useState<YimengReferenceRightsExceptionReleaseFeedResponse>()
  const [exceptionFeedError, setExceptionFeedError] = useState<string>()
  const [exceptionReferenceBinding, setExceptionReferenceBinding] = useState('')
  const [exceptionRightsRecordSha256, setExceptionRightsRecordSha256] = useState<string>()
  const [exceptionRightsFields, setExceptionRightsFields] =
    useState<readonly YimengReferenceRightsExceptionField[]>([])
  const [exceptionReason, setExceptionReason] = useState('')
  const [exceptionConfirmed, setExceptionConfirmed] = useState(false)
  const [exceptionBusy, setExceptionBusy] = useState<'submitting' | 'recovering'>()
  const [exceptionError, setExceptionError] = useState<string>()
  const [exceptionReceipt, setExceptionReceipt] =
    useState<YimengCreateReferenceRightsExceptionReleaseResponse>()
  const [exceptionReceiptRecovered, setExceptionReceiptRecovered] = useState(false)
  const [exceptionRecovery, setExceptionRecovery] =
    useState<ReferenceRightsExceptionReleaseRecoveryRead>({ status: 'none' })
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<YimengPreviewElementProfileResponse>()
  const [commitReceipt, setCommitReceipt] = useState<YimengCommitElementProfileResponse>()
  const [commitRecovered, setCommitRecovered] = useState(false)
  const [phase, setPhase] = useState<Phase>('empty')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string>()
  const [warning, setWarning] = useState<string>()
  const [recovery, setRecovery] = useState<CommandCommitRecoveryMarkerRead>({ status: 'none' })
  const abortRef = useRef<AbortController>()
  const referenceFeedbackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (availableKinds.includes(elementKind)) return
    const nextKind = availableKinds[0] ?? 'actor'
    setElementKind(nextKind)
    setSelectedTargetId(allChoices.find(choice => choice.kind === nextKind)?.id ?? '')
  }, [allChoices, availableKinds, elementKind])

  useEffect(() => {
    if (selectedTargetId !== targetId) setSelectedTargetId(targetId)
  }, [selectedTargetId, targetId])

  useEffect(() => {
    setRecovery(targetId === ''
      ? { status: 'none' }
      : readCommandCommitRecoveryMarker(projectId, elementKind, targetId))
    setExceptionRecovery(targetId === ''
      ? { status: 'none' }
      : readReferenceRightsExceptionReleaseRecoveryMarker(projectId, elementKind, targetId))
  }, [elementKind, projectId, targetId])

  useEffect(() => {
    let current = true
    setExceptionRightsRecordSha256(undefined)
    const reference = snapshot?.subject.references.find(value => (
      referenceBinding(value) === exceptionReferenceBinding
    ))
    if (reference !== undefined) {
      void digestReferenceRightsRecord(reference.rights)
        .then((sha256) => { if (current) setExceptionRightsRecordSha256(sha256) })
        .catch((cause: unknown) => {
          if (current) setExceptionError(messageOf(cause))
        })
    }
    return () => { current = false }
  }, [exceptionReferenceBinding, snapshot])

  useEffect(() => {
    if (referenceError !== undefined) referenceFeedbackRef.current?.focus()
  }, [referenceError])

  const loadSnapshot = useCallback(async (): Promise<void> => {
    abortRef.current?.abort()
    setSnapshot(undefined)
    setMethod(undefined)
    setReferenceCandidates(undefined)
    setSelectedCandidateId('')
    setSelectedRightsReference('')
    setRightsDraft(undefined)
    setRepairPrompt('')
    setReferenceError(undefined)
    setReferenceProposalLineage(undefined)
    setReviewFeed(undefined)
    setReviewError(undefined)
    setReviewBusy(undefined)
    setReviewStatus(undefined)
    setCommentBody('')
    setDecisionReason('')
    setExceptionFeed(undefined)
    setExceptionFeedError(undefined)
    setExceptionReferenceBinding('')
    setExceptionRightsRecordSha256(undefined)
    setExceptionRightsFields([])
    setExceptionReason('')
    setExceptionConfirmed(false)
    setExceptionBusy(undefined)
    setExceptionError(undefined)
    setExceptionReceipt(undefined)
    setExceptionReceiptRecovered(false)
    setPreview(undefined)
    setCommitReceipt(undefined)
    setCommitRecovered(false)
    setConfirmed(false)
    setError(undefined)
    setWarning(undefined)
    if (projectId === '' || targetId === '') {
      setPhase('empty')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('loading')
    try {
      const nextSnapshot = await port.elementProfile({ projectId, elementKind, targetId }, controller.signal)
      assertSnapshot(nextSnapshot, projectId, targetId, elementKind)
      const subject = recordOf(nextSnapshot.subject)
      const nextMethod = await port.elementMethod({
        projectId,
        targetType: 'element_profile',
        targetId,
        elementKind,
        scopeType: 'project',
        scopeId: projectId,
        baseRevision: subject.profileRevision as number,
        baseSnapshotSha256: nextSnapshot.snapshotSha256,
      }, controller.signal)
      assertMethod(nextMethod, nextSnapshot, projectId, targetId, elementKind)
      let nextReferenceCandidates: YimengReferenceCandidatesResponse | undefined
      let nextReviewFeed: YimengElementReviewFeedResponse | undefined
      let nextExceptionFeed: YimengReferenceRightsExceptionReleaseFeedResponse | undefined
      const [candidateResult, reviewResult, exceptionResult] = await Promise.allSettled([
        port.referenceCandidates({ projectId, elementKind, targetId }, controller.signal),
        port.reviewEvents({ projectId, elementKind, targetId }, controller.signal),
        port.referenceRightsExceptionReleases({ projectId, elementKind, targetId }, controller.signal),
      ])
      if (candidateResult.status === 'fulfilled') {
        try {
          assertReferenceCandidates(candidateResult.value, nextSnapshot, projectId, targetId, elementKind)
          nextReferenceCandidates = candidateResult.value
        } catch (cause) {
          if (!isSignalAborted(controller.signal)) setReferenceError(messageOf(cause))
        }
      } else if (!isSignalAborted(controller.signal)) {
        setReferenceError(messageOf(candidateResult.reason))
      }
      if (reviewResult.status === 'fulfilled') {
        try {
          assertReviewFeed(reviewResult.value, nextSnapshot, projectId, targetId, elementKind)
          nextReviewFeed = reviewResult.value
        } catch (cause) {
          if (!isSignalAborted(controller.signal)) setReviewError(messageOf(cause))
        }
      } else if (!isSignalAborted(controller.signal)) {
        setReviewError(messageOf(reviewResult.reason))
      }
      if (exceptionResult.status === 'fulfilled') {
        try {
          await assertReferenceRightsExceptionFeed(
            exceptionResult.value,
            nextSnapshot,
            projectId,
            targetId,
            elementKind,
          )
          nextExceptionFeed = exceptionResult.value
        } catch (cause) {
          if (!isSignalAborted(controller.signal)) setExceptionFeedError(messageOf(cause))
        }
      } else if (!isSignalAborted(controller.signal)) {
        setExceptionFeedError(messageOf(exceptionResult.reason))
      }
      if (isSignalAborted(controller.signal)) return
      setSnapshot(nextSnapshot)
      setMethod(nextMethod)
      setReferenceCandidates(nextReferenceCandidates)
      setReviewFeed(nextReviewFeed)
      setExceptionFeed(nextExceptionFeed)
      setDraft(elementVisualValue(subject, elementKind))
      setPhase('draft')
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setError(messageOf(cause))
        setPhase('empty')
      }
    }
  }, [elementKind, port, projectId, targetId])

  useEffect(() => {
    void loadSnapshot()
    return () => { abortRef.current?.abort() }
  }, [loadSnapshot])

  const recoveryPending = recovery.status !== 'none' || exceptionRecovery.status !== 'none'

  const prepare = async (): Promise<void> => {
    if (snapshot === undefined || method === undefined || draft.trim() === '' || recoveryPending) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('preparing')
    setPreview(undefined)
    setReferenceProposalLineage(undefined)
    setCommitReceipt(undefined)
    setConfirmed(false)
    setError(undefined)
    setWarning(undefined)
    const subject = recordOf(snapshot.subject)
    try {
      const proposalBase = {
        projectId,
        targetType: 'element_profile',
        targetId,
        baseRevision: subject.profileRevision as number,
        baseSnapshotSha256: snapshot.snapshotSha256,
        methodProjection: method.projection,
        methodProjectionSha256: method.projectionSha256,
        methodAttestation: method.methodAttestation,
        references: [],
      } as const
      const proposal = elementKind === 'actor'
        ? await port.proposeElementProfile({
          ...proposalBase,
          elementKind: 'actor',
          operation: 'replaceVisualIdentity',
          visualIdentity: draft,
        }, controller.signal)
        : await port.proposeElementProfile({
          ...proposalBase,
          elementKind,
          operation: 'replaceVisualPrompt',
          visualPrompt: draft,
        }, controller.signal)
      const changeSet = proposal.changeSet
      if (
        !runtimeEquals(proposal.schema, 'jason.qingmu-change-set-proposal.v1')
        || !runtimeEquals(proposal.nextAction, 'preview')
        || changeSet.projectId !== projectId
        || !runtimeEquals(changeSet.episodeId, null)
        || !runtimeEquals(changeSet.targetType, 'element_profile')
        || changeSet.targetId !== targetId
        || changeSet.baseRevision !== subject.profileRevision
        || changeSet.baseSnapshotSha256 !== snapshot.snapshotSha256
      ) {
        throw new Error('易梦返回的元素 ChangeSet 与当前基线不一致')
      }
      const nextPreview = await port.previewElementProfile({
        projectId,
        targetType: 'element_profile',
        targetId,
        elementKind,
        episodeId: null,
        changeSetId: changeSet.id,
        baseRevision: changeSet.baseRevision,
        baseSnapshotSha256: snapshot.snapshotSha256,
      }, controller.signal)
      assertPreview(nextPreview, snapshot, method, targetId, elementKind, draft)
      if (isSignalAborted(controller.signal)) return
      setPreview(nextPreview)
      setPhase('preview')
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setError(messageOf(cause))
        setPhase('draft')
      }
    }
  }

  const prepareReference = async (): Promise<void> => {
    if (snapshot === undefined || recoveryPending) return
    const subject = recordOf(snapshot.subject)
    const prompt = repairPrompt.trim()
    const rightsReference = snapshot.subject.references.find(reference => (
      referenceBinding(reference) === selectedRightsReference
    ))
    let normalizedRights: YimengReferenceRightsRecord | undefined
    if (referenceOperation === 'replaceReferenceRights') {
      if (rightsReference === undefined || rightsDraft === undefined) return
      try {
        normalizedRights = normalizeReferenceRightsDraft(rightsDraft)
      } catch (cause) {
        setReferenceError(messageOf(cause))
        return
      }
    } else {
      const candidate = referenceCandidates?.candidates.find(value => value.assetId === selectedCandidateId)
      if (
        candidate === undefined
        || !referenceCandidateEligible(candidate, referenceOperation)
        || (referenceOperation === 'requestReferenceRegeneration' && (prompt === '' || prompt.length > 8000))
      ) return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('preparing')
    setPreview(undefined)
    setReferenceProposalLineage(undefined)
    setCommitReceipt(undefined)
    setConfirmed(false)
    setError(undefined)
    setReferenceError(undefined)
    setWarning(undefined)
    try {
      if (referenceOperation === 'replaceReferenceRights') {
        if (rightsReference === undefined || normalizedRights === undefined) return
        const rightsMethod = await port.referenceAssetMethod({
          projectId,
          elementKind,
          elementId: targetId,
          profileRevision: subject.profileRevision as number,
          snapshotSha256: snapshot.snapshotSha256,
          operation: 'replaceReferenceRights',
        }, controller.signal)
        assertReferenceRightsMethod(rightsMethod, snapshot, projectId, targetId, elementKind)
        const proposal = await port.proposeReferenceAsset({
          projectId,
          targetType: 'element_profile',
          targetId,
          elementKind,
          operation: 'replaceReferenceRights',
          referenceAssetId: rightsReference.assetId,
          referenceAssetSha256: rightsReference.sha256,
          rights: normalizedRights,
          baseRevision: subject.profileRevision as number,
          baseSnapshotSha256: snapshot.snapshotSha256,
          methodProjection: rightsMethod.projection,
          methodProjectionSha256: rightsMethod.projectionSha256,
          methodAttestation: rightsMethod.methodAttestation,
        }, controller.signal)
        const changeSet = proposal.changeSet
        if (
          proposal.schema !== 'jason.qingmu-change-set-proposal.v1'
          || proposal.nextAction !== 'preview'
          || changeSet.projectId !== projectId
          || changeSet.episodeId !== null
          || changeSet.targetType !== 'element_profile'
          || changeSet.targetId !== targetId
          || changeSet.baseRevision !== subject.profileRevision
          || changeSet.baseSnapshotSha256 !== snapshot.snapshotSha256
          || !SHA256.test(changeSet.payloadSha256)
        ) throw new Error('易梦返回的权利 ChangeSet 与当前参考素材基线不一致')
        const nextPreview = await port.previewElementProfile({
          projectId,
          targetType: 'element_profile',
          targetId,
          elementKind,
          episodeId: null,
          changeSetId: changeSet.id,
          baseRevision: changeSet.baseRevision,
          baseSnapshotSha256: snapshot.snapshotSha256,
          operation: 'replaceReferenceRights',
          referenceAssetId: rightsReference.assetId,
          referenceAssetSha256: rightsReference.sha256,
        }, controller.signal)
        assertReferenceRightsPreview(
          nextPreview,
          snapshot,
          rightsMethod,
          changeSet.id,
          rightsReference,
          normalizedRights,
          projectId,
          targetId,
          elementKind,
        )
        if (isSignalAborted(controller.signal)) return
        setReferenceProposalLineage({
          changeSetId: changeSet.id,
          baseRevision: changeSet.baseRevision,
          baseSnapshotSha256: changeSet.baseSnapshotSha256,
          payloadSha256: changeSet.payloadSha256,
          operation: 'replaceReferenceRights',
          referenceAssetId: rightsReference.assetId,
          referenceAssetSha256: rightsReference.sha256,
          rights: normalizedRights,
          selectionStatus: rightsReference.selectionStatus,
          isSelected: rightsReference.isSelected,
        })
        setPreview(nextPreview)
        setPhase('preview')
        return
      }
      const operation = referenceOperation
      const candidate = referenceCandidates?.candidates.find(value => value.assetId === selectedCandidateId)
      if (candidate === undefined || !referenceCandidateEligible(candidate, operation)) return
      const referenceMethod = await port.referenceAssetMethod({
        projectId,
        elementKind,
        elementId: targetId,
        profileRevision: subject.profileRevision as number,
        snapshotSha256: snapshot.snapshotSha256,
        assetId: candidate.assetId,
        assetSha256: candidate.sha256,
        operation,
      }, controller.signal)
      assertReferenceMethod(
        referenceMethod,
        snapshot,
        candidate,
        projectId,
        targetId,
        elementKind,
        operation,
      )
      const proposalBase = {
        projectId,
        targetType: 'element_profile',
        targetId,
        elementKind,
        operation,
        candidateAssetId: candidate.assetId,
        candidateAssetSha256: candidate.sha256,
        baseRevision: subject.profileRevision as number,
        baseSnapshotSha256: snapshot.snapshotSha256,
        methodProjection: referenceMethod.projection,
        methodProjectionSha256: referenceMethod.projectionSha256,
        methodAttestation: referenceMethod.methodAttestation,
      } as const
      const proposal = operation === 'requestReferenceRegeneration'
        ? await port.proposeReferenceAsset({ ...proposalBase, repairPrompt: prompt }, controller.signal)
        : await port.proposeReferenceAsset(proposalBase, controller.signal)
      const changeSet = proposal.changeSet
      const proposalRoot = recordOf(proposal)
      const changeSetRoot = recordOf(changeSet)
      const payloadSha256 = stringOf(changeSetRoot.payloadSha256)
      if (
        proposalRoot.schema !== 'jason.qingmu-change-set-proposal.v1'
        || proposalRoot.nextAction !== 'preview'
        || changeSetRoot.projectId !== projectId
        || changeSetRoot.episodeId !== null
        || changeSetRoot.targetType !== 'element_profile'
        || changeSetRoot.targetId !== targetId
        || changeSetRoot.baseRevision !== subject.profileRevision
        || changeSetRoot.baseSnapshotSha256 !== snapshot.snapshotSha256
        || payloadSha256 === undefined
        || !SHA256.test(payloadSha256)
      ) {
        throw new Error('易梦返回的参考素材 ChangeSet 与当前候选基线不一致')
      }
      const nextPreview = await port.previewElementProfile({
        projectId,
        targetType: 'element_profile',
        targetId,
        elementKind,
        episodeId: null,
        changeSetId: changeSet.id,
        baseRevision: changeSet.baseRevision,
        baseSnapshotSha256: snapshot.snapshotSha256,
        operation,
        candidateAssetId: candidate.assetId,
        candidateAssetSha256: candidate.sha256,
      }, controller.signal)
      assertReferencePreview(
        nextPreview,
        snapshot,
        changeSet.id,
        candidate,
        projectId,
        targetId,
        elementKind,
        operation,
      )
      if (isSignalAborted(controller.signal)) return
      setReferenceProposalLineage({
        changeSetId: changeSet.id,
        baseRevision: changeSet.baseRevision,
        baseSnapshotSha256: changeSet.baseSnapshotSha256,
        payloadSha256: changeSet.payloadSha256,
        operation,
        candidateAssetId: candidate.assetId,
        candidateAssetSha256: candidate.sha256,
      })
      setPreview(nextPreview)
      setPhase('preview')
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setReferenceError(messageOf(cause))
        setReferenceProposalLineage(undefined)
        setPhase('draft')
      }
    }
  }

  const finishAcceptedCommit = async (
    receipt: YimengCommitElementProfileResponse,
    marker: CommandCommitRecoveryMarker,
    controller: AbortController,
    recovered: boolean,
  ): Promise<void> => {
    assertCommitReceiptLineage(receipt, marker)
    if (isSignalAborted(controller.signal)) return
    const referenceActionMarker = marker.operation === 'selectReferenceAsset'
      || marker.operation === 'requestReferenceRegeneration'
    const referenceRightsMarker = marker.operation === 'replaceReferenceRights'
    const referenceBoundMarker = referenceActionMarker || referenceRightsMarker
    if (!referenceBoundMarker) {
      setCommitReceipt(receipt)
      setCommitRecovered(recovered)
      setPreview(undefined)
      setConfirmed(false)
      setPhase('committed')
    }
    const [snapshotResult, candidatesResult, reviewResult, exceptionResult, workflowResult] = await Promise.allSettled([
      port.elementProfile({ projectId, elementKind, targetId }, controller.signal),
      referenceActionMarker
        ? port.referenceCandidates({ projectId, elementKind, targetId }, controller.signal)
        : Promise.resolve(undefined),
      port.reviewEvents({ projectId, elementKind, targetId }, controller.signal),
      port.referenceRightsExceptionReleases({ projectId, elementKind, targetId }, controller.signal),
      onCommitted(),
    ])
    if (isSignalAborted(controller.signal)) return
    let authoritativeReadSucceeded = false
    let referenceReadSucceeded = !referenceBoundMarker
    let referenceReadError: string | undefined
    let reviewReadError: string | undefined
    let methodWarning: string | undefined
    if (snapshotResult.status === 'fulfilled') {
      try {
        assertSnapshot(snapshotResult.value, projectId, targetId, elementKind)
        const subject = recordOf(snapshotResult.value.subject)
        authoritativeReadSucceeded = subject.profileRevision === receipt.authoritativeRevision
          && snapshotResult.value.snapshotSha256 === receipt.authoritativeSnapshotSha256
        if (authoritativeReadSucceeded) {
          setSnapshot(snapshotResult.value)
          setDraft(elementVisualValue(subject, elementKind))
          if (referenceActionMarker && candidatesResult.status === 'fulfilled' && candidatesResult.value !== undefined) {
            try {
              assertReferenceCandidates(candidatesResult.value, snapshotResult.value, projectId, targetId, elementKind)
              assertReferenceCandidatePostState(candidatesResult.value, marker)
              setReferenceCandidates(candidatesResult.value)
              setSelectedCandidateId('')
              setRepairPrompt('')
              referenceReadSucceeded = true
            } catch (cause) {
              referenceReadError = messageOf(cause)
              setReferenceError(referenceReadError)
            }
          }
          if (referenceRightsMarker) {
            try {
              const authoritativeReference = await assertReferenceRightsPostState(snapshotResult.value, marker)
              if (
                await digestCommandRecoveryVisualBaseline(subject)
                !== marker.preCommitVisualBaselineSha256
              ) throw new Error('权利记录提交后的权威视觉资料摘要不一致')
              setSelectedRightsReference(referenceBinding(authoritativeReference))
              setRightsDraft(createReferenceRightsDraft(authoritativeReference.rights))
              referenceReadSucceeded = true
            } catch (cause) {
              referenceReadError = messageOf(cause)
              setReferenceError(referenceReadError)
            }
          }
          if (reviewResult.status === 'fulfilled') {
            try {
              assertReviewFeed(reviewResult.value, snapshotResult.value, projectId, targetId, elementKind)
              if (
                referenceRightsMarker
                && await digestCommandRecoveryHumanDecisions(reviewResult.value.decisions)
                  !== marker.preCommitHumanDecisionsSha256
              ) {
                throw new Error('权利记录提交后的正式人工决定摘要不一致')
              }
              setReviewFeed(reviewResult.value)
              setReviewError(undefined)
            } catch (cause) {
              reviewReadError = messageOf(cause)
              setReviewFeed(undefined)
              setReviewError(reviewReadError)
              if (referenceRightsMarker) {
                referenceReadSucceeded = false
                referenceReadError = reviewReadError
              }
            }
          } else {
            reviewReadError = messageOf(reviewResult.reason)
            setReviewFeed(undefined)
            setReviewError(reviewReadError)
            if (referenceRightsMarker) {
              referenceReadSucceeded = false
              referenceReadError = reviewReadError
            }
          }
          if (exceptionResult.status === 'fulfilled') {
            try {
              await assertReferenceRightsExceptionFeed(
                exceptionResult.value,
                snapshotResult.value,
                projectId,
                targetId,
                elementKind,
              )
              setExceptionFeed(exceptionResult.value)
              setExceptionFeedError(undefined)
            } catch (cause) {
              setExceptionFeed(undefined)
              setExceptionFeedError(messageOf(cause))
            }
          } else {
            setExceptionFeed(undefined)
            setExceptionFeedError(messageOf(exceptionResult.reason))
          }
          try {
            const refreshedMethod = await port.elementMethod({
              projectId,
              targetType: 'element_profile',
              targetId,
              elementKind,
              scopeType: 'project',
              scopeId: projectId,
              baseRevision: receipt.authoritativeRevision,
              baseSnapshotSha256: receipt.authoritativeSnapshotSha256,
            }, controller.signal)
            assertMethod(refreshedMethod, snapshotResult.value, projectId, targetId, elementKind)
            if (!isSignalAborted(controller.signal)) setMethod(refreshedMethod)
          } catch (cause) {
            setMethod(undefined)
            methodWarning = messageOf(cause)
          }
        }
      } catch (cause) {
        methodWarning = messageOf(cause)
      }
    }
    if (!authoritativeReadSucceeded) {
      reviewReadError = snapshotResult.status === 'rejected'
        ? messageOf(snapshotResult.reason)
        : t('assetRecoverySnapshotMismatch')
      setReviewFeed(undefined)
      setReviewError(reviewReadError)
      setExceptionFeed(undefined)
      setExceptionFeedError(t('assetRecoverySnapshotMismatch'))
    }
    const markerCleared = authoritativeReadSucceeded
      && referenceReadSucceeded
      && clearCommandCommitRecoveryMarker(marker)
    if (markerCleared) setRecovery({ status: 'none' })
    const warnings = [
      ...(!authoritativeReadSucceeded ? [t('assetRecoverySnapshotMismatch')] : []),
      ...(snapshotResult.status === 'rejected' ? [messageOf(snapshotResult.reason)] : []),
      ...(referenceActionMarker && candidatesResult.status === 'rejected' ? [messageOf(candidatesResult.reason)] : []),
      ...(workflowResult.status === 'rejected' ? [messageOf(workflowResult.reason)] : []),
      ...(methodWarning !== undefined ? [methodWarning] : []),
      ...(authoritativeReadSucceeded && !markerCleared ? [t('receiptRecoveryClearWarning')] : []),
    ]
    setWarning(warnings.length > 0 ? warnings.join(' · ') : undefined)
    if (referenceBoundMarker && !markerCleared) {
      throw new Error(referenceReadError ?? t('receiptRecoveryClearWarning'))
    }
    if (referenceBoundMarker) {
      setCommitReceipt(receipt)
      setCommitRecovered(recovered)
      setPreview(undefined)
      setConfirmed(false)
      setPhase('committed')
    }
  }

  const commit = async (): Promise<void> => {
    if (preview === undefined || !preview.canCommit || !confirmed || recoveryPending) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('committing')
    setError(undefined)
    let marker: CommandCommitRecoveryMarker
    try {
      if (isReferencePreview(preview)) {
        const lineage = referenceProposalLineage
        if (
          lineage === undefined
          || lineage.changeSetId !== preview.changeSetId
          || lineage.operation !== preview.operation
          || lineage.candidateAssetId !== preview.candidateAssetId
          || lineage.candidateAssetSha256 !== preview.candidateAssetSha256
        ) throw new Error('参考素材预览与提案血缘不一致')
        marker = createCommandCommitRecoveryMarker({
          projectId,
          targetType: 'element_profile',
          elementKind,
          targetId,
          changeSetId: lineage.changeSetId,
          baseRevision: lineage.baseRevision,
          baseSnapshotSha256: lineage.baseSnapshotSha256,
          payloadSha256: lineage.payloadSha256,
          idempotencyKey: await deriveCommandIdempotencyKey(lineage.changeSetId, lineage.payloadSha256),
          operation: lineage.operation,
          candidateAssetId: lineage.candidateAssetId,
          candidateAssetSha256: lineage.candidateAssetSha256,
        })
      } else if (isReferenceRightsPreview(preview)) {
        const lineage = referenceProposalLineage
        if (
          lineage === undefined
          || lineage.operation !== 'replaceReferenceRights'
          || lineage.changeSetId !== preview.changeSetId
          || lineage.referenceAssetId !== preview.referenceAssetId
          || lineage.referenceAssetSha256 !== preview.referenceAssetSha256
          || !referenceRightsRecordsEqual(lineage.rights, preview.proposedReferenceRights)
        ) throw new Error('参考素材权利预览与提案血缘不一致')
        if (snapshot === undefined || reviewFeed === undefined) {
          throw new Error('参考素材权利提交缺少提交前权威视觉或正式人工决定基线')
        }
        assertSnapshot(snapshot, projectId, targetId, elementKind)
        assertReviewFeed(reviewFeed, snapshot, projectId, targetId, elementKind)
        const [preCommitVisualBaselineSha256, preCommitHumanDecisionsSha256] = await Promise.all([
          digestCommandRecoveryVisualBaseline(snapshot.subject),
          digestCommandRecoveryHumanDecisions(reviewFeed.decisions),
        ])
        marker = createCommandCommitRecoveryMarker({
          projectId,
          targetType: 'element_profile',
          elementKind,
          targetId,
          changeSetId: lineage.changeSetId,
          baseRevision: lineage.baseRevision,
          baseSnapshotSha256: lineage.baseSnapshotSha256,
          payloadSha256: lineage.payloadSha256,
          idempotencyKey: await deriveCommandIdempotencyKey(lineage.changeSetId, lineage.payloadSha256),
          operation: 'replaceReferenceRights',
          referenceAssetId: lineage.referenceAssetId,
          referenceAssetSha256: lineage.referenceAssetSha256,
          referenceRightsSha256: await digestReferenceRightsRecord(lineage.rights),
          preCommitVisualBaselineSha256,
          preCommitHumanDecisionsSha256,
          selectionStatus: lineage.selectionStatus,
          isSelected: lineage.isSelected,
        })
      } else {
        marker = createCommandCommitRecoveryMarker({
          projectId,
          targetType: 'element_profile',
          elementKind,
          targetId,
          changeSetId: preview.changeSetId,
          baseRevision: preview.baseRevision,
          baseSnapshotSha256: preview.baseSnapshotSha256,
          payloadSha256: preview.payloadSha256,
          idempotencyKey: await deriveCommandIdempotencyKey(preview.changeSetId, preview.payloadSha256),
          operation: preview.operation,
        })
      }
      if (isSignalAborted(controller.signal)) return
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setError(messageOf(cause))
        setPhase('preview')
      }
      return
    }
    const existing = readCommandCommitRecoveryMarker(projectId, elementKind, targetId)
    if (existing.status !== 'none') {
      setRecovery(existing)
      setError(t('assetRecoveryExistingMarker'))
      setPhase('preview')
      return
    }
    if (!writeCommandCommitRecoveryMarker(marker)) {
      setError(t('receiptRecoveryStorageFailed'))
      setPhase('preview')
      return
    }
    setRecovery({ status: 'ready', marker })
    try {
      const commandBase = {
        projectId: marker.projectId,
        targetType: marker.targetType,
        targetId: marker.targetId,
        elementKind: marker.elementKind,
        episodeId: null,
        changeSetId: marker.changeSetId,
        baseRevision: marker.baseRevision,
        baseSnapshotSha256: marker.baseSnapshotSha256,
        idempotencyKey: marker.idempotencyKey,
        expectedPayloadSha256: marker.payloadSha256,
      } as const
      const result = marker.operation === 'selectReferenceAsset'
        || marker.operation === 'requestReferenceRegeneration'
        ? await port.commitElementProfile({
          ...commandBase,
          operation: marker.operation,
          candidateAssetId: marker.candidateAssetId,
          candidateAssetSha256: marker.candidateAssetSha256,
        }, controller.signal)
        : marker.operation === 'replaceReferenceRights'
          ? await port.commitElementProfile({
            ...commandBase,
            operation: marker.operation,
            referenceAssetId: marker.referenceAssetId,
            referenceAssetSha256: marker.referenceAssetSha256,
          }, controller.signal)
          : await port.commitElementProfile(commandBase, controller.signal)
      await finishAcceptedCommit(result, marker, controller, false)
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setError(messageOf(cause))
        setPhase('preview')
      }
    }
  }

  const recover = async (): Promise<void> => {
    if (recovery.status !== 'ready') return
    const marker = recovery.marker
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('recovering')
    setError(undefined)
    try {
      const recoveryBase = {
        projectId: marker.projectId,
        targetType: marker.targetType,
        targetId: marker.targetId,
        elementKind: marker.elementKind,
        episodeId: null,
        changeSetId: marker.changeSetId,
        baseRevision: marker.baseRevision,
        baseSnapshotSha256: marker.baseSnapshotSha256,
        idempotencyKey: marker.idempotencyKey,
        expectedPayloadSha256: marker.payloadSha256,
      } as const
      const recovered = marker.operation === 'selectReferenceAsset'
        || marker.operation === 'requestReferenceRegeneration'
        ? await port.recoverElementProfileCommit({
          ...recoveryBase,
          operation: marker.operation,
          candidateAssetId: marker.candidateAssetId,
          candidateAssetSha256: marker.candidateAssetSha256,
        }, controller.signal)
        : marker.operation === 'replaceReferenceRights'
          ? await port.recoverElementProfileCommit({
            ...recoveryBase,
            operation: marker.operation,
            referenceAssetId: marker.referenceAssetId,
            referenceAssetSha256: marker.referenceAssetSha256,
          }, controller.signal)
          : await port.recoverElementProfileCommit(recoveryBase, controller.signal)
      if (isSignalAborted(controller.signal)) return
      await finishAcceptedCommit(assertRecoveryLineage(recovered, marker), marker, controller, true)
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) {
        setError(messageOf(cause))
        setPhase(snapshot === undefined ? 'empty' : 'draft')
      }
    }
  }

  const discardRecovery = (): void => {
    if (targetId !== '' && discardCommandCommitRecoveryMarker(projectId, elementKind, targetId)) {
      setRecovery({ status: 'none' })
      setError(undefined)
      return
    }
    setRecovery(targetId === '' ? { status: 'none' } : readCommandCommitRecoveryMarker(projectId, elementKind, targetId))
    setError(t('receiptRecoveryDiscardFailed'))
  }

  const submitComment = async (): Promise<void> => {
    const body = commentBody.trim()
    const baselineFeed = reviewFeed
    const baselineCandidates = referenceCandidates
    if (
      snapshot === undefined
      || baselineFeed === undefined
      || !baselineFeed.capabilities.canComment
      || body === ''
      || body.length > 8000
      || recoveryPending
    ) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setReviewBusy('comment')
    setReviewError(undefined)
    setReviewStatus(undefined)
    try {
      const response = await port.createComment({
        projectId,
        elementKind,
        targetId,
        expectedSubjectRevision: baselineFeed.subject.revision,
        expectedSubjectSha256: baselineFeed.subject.sha256,
        body,
        idempotencyKey: createReviewIdempotencyKey('comment'),
      }, controller.signal)
      const createdComment = assertCreatedComment(response, body, baselineFeed)
      const [feedResult, candidatesResult] = await Promise.allSettled([
        port.reviewEvents({ projectId, elementKind, targetId }, controller.signal),
        baselineCandidates === undefined
          ? Promise.resolve(undefined)
          : port.referenceCandidates({ projectId, elementKind, targetId }, controller.signal),
      ])
      if (isSignalAborted(controller.signal)) return
      if (feedResult.status === 'rejected') throw feedResult.reason
      const refreshedFeed = feedResult.value
      assertReviewFeed(refreshedFeed, snapshot, projectId, targetId, elementKind)
      assertCurrentDecisionUnchanged(baselineFeed.currentDecision, refreshedFeed.currentDecision)
      if (!refreshedFeed.comments.some(comment => sameCommentEvent(comment, createdComment))) {
        throw new Error('评论后重读未返回刚刚记录的评论')
      }
      if (baselineCandidates !== undefined) {
        if (candidatesResult.status === 'fulfilled' && candidatesResult.value !== undefined) {
          assertReferenceCandidates(candidatesResult.value, snapshot, projectId, targetId, elementKind)
          assertCandidateSelectionUnchanged(baselineCandidates, candidatesResult.value)
          setReferenceCandidates(candidatesResult.value)
          setReferenceError(undefined)
        } else {
          setReferenceError(candidatesResult.status === 'rejected'
            ? messageOf(candidatesResult.reason)
            : t('assetReferenceLoadError'))
        }
      }
      setReviewFeed(refreshedFeed)
      setCommentBody('')
      setReviewStatus('comment')
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) setReviewError(messageOf(cause))
    } finally {
      if (abortRef.current === controller) setReviewBusy(undefined)
    }
  }

  const submitHumanDecision = async (): Promise<void> => {
    const reason = decisionReason.trim()
    const baselineFeed = reviewFeed
    if (
      snapshot === undefined
      || baselineFeed === undefined
      || !baselineFeed.capabilities.canDecide
      || reason === ''
      || reason.length > 8000
      || recoveryPending
    ) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setReviewBusy('decision')
    setReviewError(undefined)
    setReviewStatus(undefined)
    try {
      const response = await port.createHumanDecision({
        projectId,
        elementKind,
        targetId,
        expectedSubjectRevision: baselineFeed.subject.revision,
        expectedSubjectSha256: baselineFeed.subject.sha256,
        decision: decisionValue,
        reason,
        idempotencyKey: createReviewIdempotencyKey('decision'),
      }, controller.signal)
      const createdDecision = assertCreatedHumanDecision(response, decisionValue, reason, baselineFeed)
      const refreshedFeed = await port.reviewEvents({ projectId, elementKind, targetId }, controller.signal)
      if (isSignalAborted(controller.signal)) return
      assertReviewFeed(refreshedFeed, snapshot, projectId, targetId, elementKind)
      if (
        refreshedFeed.currentDecision === null
        || refreshedFeed.currentDecision.stale
        || !sameHumanDecision(refreshedFeed.currentDecision, createdDecision, false)
      ) {
        throw new Error('正式人工决定后重读未返回精确绑定的当前决定')
      }
      setReviewFeed(refreshedFeed)
      setDecisionReason('')
      setReviewStatus('decision')
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) setReviewError(messageOf(cause))
    } finally {
      if (abortRef.current === controller) setReviewBusy(undefined)
    }
  }

  const finishAcceptedReferenceRightsExceptionRelease = async (
    result: YimengCreateReferenceRightsExceptionReleaseResponse,
    marker: ReferenceRightsExceptionReleaseRecoveryMarker,
    controller: AbortController,
    recovered: boolean,
  ): Promise<void> => {
    if (snapshot === undefined) throw new Error('异常放行对账缺少当前元素资料')
    await assertReferenceRightsExceptionResult(result, marker)
    await assertReferenceRightsExceptionMarkerCurrent(snapshot, marker)
    const refreshedFeed = await port.referenceRightsExceptionReleases(
      { projectId, elementKind, targetId },
      controller.signal,
    )
    if (isSignalAborted(controller.signal)) return
    await assertReferenceRightsExceptionFeedReconciled(
      refreshedFeed,
      result,
      snapshot,
      projectId,
      targetId,
      elementKind,
    )
    if (!clearReferenceRightsExceptionReleaseRecoveryMarker(marker)) {
      throw new Error('异常放行已对账，但本地恢复标记未能安全清除')
    }
    setExceptionFeed(refreshedFeed)
    setExceptionFeedError(undefined)
    setExceptionRecovery({ status: 'none' })
    setExceptionReceipt(result)
    setExceptionReceiptRecovered(recovered)
    setExceptionRightsFields([])
    setExceptionReason('')
    setExceptionConfirmed(false)
    setExceptionError(undefined)
  }

  const submitReferenceRightsExceptionRelease = async (): Promise<void> => {
    const baselineSnapshot = snapshot
    const baselineFeed = exceptionFeed
    const reference = baselineSnapshot?.subject.references.find(value => (
      referenceBinding(value) === exceptionReferenceBinding
    ))
    let normalizedReason: string
    try {
      normalizedReason = normalizeReferenceRightsExceptionReasonInput(exceptionReason)
    } catch (cause) {
      setExceptionError(messageOf(cause))
      return
    }
    if (
      baselineSnapshot === undefined
      || baselineFeed === undefined
      || !baselineFeed.capabilities.canRelease
      || reference === undefined
      || exceptionRightsFields.length === 0
      || !exceptionConfirmed
      || recoveryPending
    ) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setExceptionBusy('submitting')
    setExceptionError(undefined)
    setExceptionReceipt(undefined)
    setExceptionReceiptRecovered(false)
    try {
      assertSnapshot(baselineSnapshot, projectId, targetId, elementKind)
      await assertReferenceRightsExceptionFeed(
        baselineFeed,
        baselineSnapshot,
        projectId,
        targetId,
        elementKind,
      )
      const rightsRecordSha256 = await digestReferenceRightsRecord(reference.rights)
      const scope = normalizeReferenceRightsExceptionScope({
        kind: 'reference_rights',
        referenceAssetId: reference.assetId,
        referenceAssetSha256: reference.sha256,
        rightsRecordSha256,
        rightsFields: exceptionRightsFields,
      })
      const method = await port.referenceAssetMethod({
        projectId,
        elementKind,
        elementId: targetId,
        profileRevision: baselineSnapshot.subject.profileRevision,
        snapshotSha256: baselineSnapshot.snapshotSha256,
        operation: 'recordReferenceRightsExceptionRelease',
      }, controller.signal)
      assertReferenceRightsExceptionMethod(method, baselineSnapshot, projectId, targetId, elementKind)
      const [reasonSha256, scopeSha256] = await Promise.all([
        digestReferenceRightsExceptionReason(normalizedReason),
        digestReferenceRightsExceptionScope(scope),
      ])
      const markerInput = {
        projectId,
        elementKind,
        targetId,
        expectedSubjectRevision: baselineSnapshot.subject.profileRevision,
        expectedSubjectSha256: baselineSnapshot.snapshotSha256,
        referenceAssetId: scope.referenceAssetId,
        referenceAssetSha256: scope.referenceAssetSha256,
        rightsRecordSha256: scope.rightsRecordSha256,
        reasonSha256,
        scopeSha256,
      } as const
      const marker = createReferenceRightsExceptionReleaseRecoveryMarker({
        ...markerInput,
        idempotencyKey: await deriveReferenceRightsExceptionIdempotencyKey(markerInput),
      })
      if (isSignalAborted(controller.signal)) return
      const existingCommit = readCommandCommitRecoveryMarker(projectId, elementKind, targetId)
      if (existingCommit.status !== 'none') {
        setRecovery(existingCommit)
        throw new Error('存在尚未处理的元素命令恢复标记')
      }
      const existingException = readReferenceRightsExceptionReleaseRecoveryMarker(
        projectId,
        elementKind,
        targetId,
      )
      if (existingException.status !== 'none') {
        setExceptionRecovery(existingException)
        throw new Error('存在尚未处理的异常放行恢复标记')
      }
      if (!writeReferenceRightsExceptionReleaseRecoveryMarker(marker)) {
        throw new Error('浏览器无法同步写入异常放行恢复标记')
      }
      const stored = readReferenceRightsExceptionReleaseRecoveryMarker(projectId, elementKind, targetId)
      if (stored.status !== 'ready' || !sameReferenceRightsExceptionMarker(stored.marker, marker)) {
        throw new Error('异常放行恢复标记写后回读不一致')
      }
      setExceptionRecovery(stored)
      const result = await port.createReferenceRightsExceptionRelease({
        projectId,
        elementKind,
        targetId,
        expectedSubjectRevision: marker.expectedSubjectRevision,
        expectedSubjectSha256: marker.expectedSubjectSha256,
        idempotencyKey: marker.idempotencyKey,
        reason: normalizedReason,
        scope,
      }, controller.signal)
      await finishAcceptedReferenceRightsExceptionRelease(result, marker, controller, false)
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) setExceptionError(messageOf(cause))
    } finally {
      if (abortRef.current === controller) setExceptionBusy(undefined)
    }
  }

  const recoverReferenceRightsExceptionRelease = async (): Promise<void> => {
    if (exceptionRecovery.status !== 'ready' || snapshot === undefined) return
    const marker = exceptionRecovery.marker
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setExceptionBusy('recovering')
    setExceptionError(undefined)
    setExceptionReceipt(undefined)
    setExceptionReceiptRecovered(false)
    try {
      const recovered = await port.recoverReferenceRightsExceptionRelease({ ...marker }, controller.signal)
      if (isSignalAborted(controller.signal)) return
      const result = await assertReferenceRightsExceptionRecovery(recovered, marker)
      await finishAcceptedReferenceRightsExceptionRelease(result, marker, controller, true)
    } catch (cause) {
      if (!isSignalAborted(controller.signal)) setExceptionError(messageOf(cause))
    } finally {
      if (abortRef.current === controller) setExceptionBusy(undefined)
    }
  }

  const discardReferenceRightsExceptionRecovery = (): void => {
    if (
      targetId !== ''
      && discardReferenceRightsExceptionReleaseRecoveryMarker(projectId, elementKind, targetId)
    ) {
      setExceptionRecovery({ status: 'none' })
      setExceptionError(undefined)
      setExceptionReceipt(undefined)
      setExceptionReceiptRecovered(false)
      return
    }
    setExceptionRecovery(targetId === ''
      ? { status: 'none' }
      : readReferenceRightsExceptionReleaseRecoveryMarker(projectId, elementKind, targetId))
    setExceptionError('无法安全丢弃本地异常放行恢复标记')
  }

  const busy = phase === 'loading'
    || phase === 'preparing'
    || phase === 'committing'
    || phase === 'recovering'
    || reviewBusy !== undefined
    || exceptionBusy !== undefined
  const subject = recordOf(snapshot?.subject)
  const fieldHints = arrayOf(method?.projection.field_hints)
  const checklist = arrayOf(method?.projection.checklist)
  const reviewCard = recordOf(method?.projection.review_card)
  const hardVetoes = arrayOf(reviewCard.hard_vetoes)
  const candidateItems = referenceCandidates?.candidates ?? []
  const selectedCandidate = candidateItems.find(candidate => candidate.assetId === selectedCandidateId)
  const rightsReferences = snapshot?.subject.references ?? []
  const selectedRightsRecord = rightsReferences.find(reference => (
    referenceBinding(reference) === selectedRightsReference
  ))
  const selectedExceptionReference = rightsReferences.find(reference => (
    referenceBinding(reference) === exceptionReferenceBinding
  ))
  let normalizedExceptionReason: string | undefined
  try {
    normalizedExceptionReason = normalizeReferenceRightsExceptionReasonInput(exceptionReason)
  } catch {
    normalizedExceptionReason = undefined
  }
  const currentExceptionReleaseIds = new Set(
    exceptionFeed?.currentReleases.map(release => release.id) ?? [],
  )
  const exceptionCanSubmit = exceptionFeed?.capabilities.canRelease === true
    && selectedExceptionReference !== undefined
    && exceptionRightsRecordSha256 !== undefined
    && exceptionRightsFields.length > 0
    && normalizedExceptionReason !== undefined
    && exceptionConfirmed
    && !recoveryPending
  const referenceInputValid = referenceOperation === 'replaceReferenceRights'
    ? selectedRightsRecord !== undefined && rightsDraft !== undefined
    : selectedCandidate !== undefined
      && referenceCandidateEligible(selectedCandidate, referenceOperation)
      && (referenceOperation === 'selectReferenceAsset'
        || (repairPrompt.trim() !== '' && repairPrompt.trim().length <= 8000))
  const visualFieldLabel = t(elementKind === 'actor' ? 'assetIdentityLabel' : 'assetPromptLabel')
  const referencePreview = preview !== undefined && isReferencePreview(preview) ? preview : undefined
  const rightsPreview = preview !== undefined && isReferenceRightsPreview(preview) ? preview : undefined
  const visualPreview = preview !== undefined && !isReferencePreview(preview) && !isReferenceRightsPreview(preview)
    ? preview
    : undefined
  const baseVisual = visualPreview === undefined ? '' : elementVisualValue(recordOf(visualPreview.baseSubject), elementKind)
  const currentVisual = visualPreview === undefined ? '' : elementVisualValue(recordOf(visualPreview.authoritativeCurrentSubject), elementKind)
  const proposedVisual = visualPreview === undefined
    ? ''
    : elementKind === 'actor'
      ? visualPreview.proposedVisualIdentity ?? ''
      : visualPreview.proposedVisualPrompt ?? ''
  const impactGroups = visualPreview === undefined ? [] : [
    { label: t('assetImpactReferenceAssets'), values: visualPreview.impactAnalysis.affectedReferenceAssetIds },
    { label: t('assetImpactApprovals'), values: visualPreview.impactAnalysis.invalidatedApprovalAssetIds },
    { label: t('assetImpactDerivedAssets'), values: visualPreview.impactAnalysis.affectedDerivedAssetIds },
    { label: t('assetImpactReferencePacks'), values: visualPreview.impactAnalysis.affectedReferencePackIds },
    { label: t('assetImpactPromptIr'), values: visualPreview.impactAnalysis.affectedPromptIrIds },
    { label: t('assetImpactStoryboardFrames'), values: visualPreview.impactAnalysis.affectedStoryboardFrameIds },
    { label: t('assetImpactUnknowns'), values: visualPreview.impactAnalysis.unknowns },
  ]
  const rightsImpactGroups = rightsPreview === undefined ? [] : [
    { label: t('assetImpactReferenceAssets'), values: rightsPreview.impactAnalysis.affectedReferenceAssetIds },
    { label: t('assetImpactApprovals'), values: rightsPreview.impactAnalysis.invalidatedApprovalAssetIds },
    { label: t('assetImpactDerivedAssets'), values: rightsPreview.impactAnalysis.affectedDerivedAssetIds },
    { label: t('assetImpactReferencePacks'), values: rightsPreview.impactAnalysis.affectedReferencePackIds },
    { label: t('assetImpactPromptIr'), values: rightsPreview.impactAnalysis.affectedPromptIrIds },
    { label: t('assetImpactStoryboardFrames'), values: rightsPreview.impactAnalysis.affectedStoryboardFrameIds },
    { label: t('assetImpactUnknowns'), values: rightsPreview.impactAnalysis.unknowns },
  ]

  return (
    <section className={css.scriptWorkspace} aria-label={t('assetWorkbenchTitle')}>
      <div className={css.scriptWorkspaceHead}>
        <div>
          <h3>{t('assetWorkbenchTitle')}</h3>
          <p>{t('assetWorkbenchBoundary')}</p>
        </div>
        <button type="button" onClick={() => { void loadSnapshot() }} disabled={busy || targetId === ''}>
          {t('assetReload')}
        </button>
      </div>

      {availableKinds.length > 0 && (
        <div className={css.assetKindSwitch} role="group" aria-label={t('assetChooseElement')}>
          {availableKinds.map(kind => (
            <button
              type="button"
              key={kind}
              aria-pressed={elementKind === kind}
              disabled={busy}
              onClick={() => {
                abortRef.current?.abort()
                setElementKind(kind)
                setSelectedTargetId(allChoices.find(choice => choice.kind === kind)?.id ?? '')
              }}
            >
              {t(ELEMENT_KIND_LOCALE_KEY[kind])}
            </button>
          ))}
        </div>
      )}

      {choices.length === 0 ? <p className={css.empty}>{t('assetNoElements')}</p> : (
        <label className={css.assetSubjectPicker}>
          <span>{t('assetChooseElement')}</span>
          <select value={targetId} onChange={(event) => { setSelectedTargetId(event.target.value) }} disabled={busy}>
            {choices.map(choice => <option value={choice.id} key={choice.id}>{choice.name}</option>)}
          </select>
        </label>
      )}

      {snapshot !== undefined && (
        <dl className={css.scriptMeta}>
          <div><dt>{t('assetProfileRevision')}</dt><dd>{String(subject.profileRevision)}</dd></div>
          <div><dt>{t('assetSnapshotHash')}</dt><dd>{snapshot.snapshotSha256}</dd></div>
          <div><dt>{t('scriptState')}</dt><dd>{t(PHASE_LOCALE_KEY[phase])}</dd></div>
        </dl>
      )}

      {recovery.status === 'ready' && (
        <section className={css.recoveryDock} aria-label={t('assetRecoveryTitle')}>
          <div><h4>{t('assetRecoveryTitle')}</h4><p>{t('assetRecoveryBody')}</p></div>
          <dl>
            <div><dt>{t('changeSet')}</dt><dd>{recovery.marker.changeSetId}</dd></div>
            <div><dt>{t('assetProfileRevision')}</dt><dd>{recovery.marker.baseRevision}</dd></div>
            <div><dt>{t('payloadHash')}</dt><dd>{recovery.marker.payloadSha256}</dd></div>
          </dl>
          <div className={css.recoveryActions}>
            <button type="button" className={css.primaryAction} onClick={() => { void recover() }} disabled={busy}>
              {phase === 'recovering' ? t('recoveringReceipt') : t('recoverReceipt')}
            </button>
            <button type="button" onClick={discardRecovery} disabled={busy}>{t('discardRecoveryMarker')}</button>
          </div>
        </section>
      )}

      {recovery.status === 'invalid' && (
        <div className={css.scriptError} role="alert">
          <strong>{t('receiptRecoveryInvalidTitle')}</strong>
          <p>{t('receiptRecoveryInvalidBody')}: {recovery.error}</p>
          <button type="button" onClick={discardRecovery} disabled={busy}>{t('discardRecoveryMarker')}</button>
        </div>
      )}

      {method !== undefined && (
        <div className={css.methodGrid}>
          <section>
            <h4>{t('assetMethodTitle')}</h4>
            <ul>{fieldHints.map((value, index) => {
              const hint = recordOf(value)
              return <li key={stringOf(hint.hint_id) ?? String(index)}><strong>{stringOf(hint.title) ?? t('unknown')}</strong><span>{stringOf(hint.guidance) ?? ''}</span></li>
            })}</ul>
          </section>
          <section>
            <h4>{t('assetMethodChecklist')}</h4>
            <ul>{checklist.map((value, index) => {
              const item = recordOf(value)
              return <li key={stringOf(item.check_id) ?? String(index)}>{stringOf(item.label) ?? t('unknown')}</li>
            })}</ul>
          </section>
          <section>
            <h4>{stringOf(reviewCard.title) ?? t('assetReviewCard')}</h4>
            <ul>{hardVetoes.map((value, index) => <li key={`${String(index)}-${String(value)}`}>{String(value)}</li>)}</ul>
          </section>
        </div>
      )}

      {snapshot !== undefined && (
        <label className={css.scriptEditor}>
          <span>{visualFieldLabel}</span>
          <textarea
            aria-label={visualFieldLabel}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setPreview(undefined)
              setReferenceProposalLineage(undefined)
              setConfirmed(false)
              setPhase('draft')
            }}
            disabled={busy || method === undefined || recoveryPending}
            rows={8}
          />
          <small>{t('assetPromptHint')}</small>
        </label>
      )}

      {snapshot !== undefined && (
        <div className={css.scriptActions}>
          <button
            type="button"
            className={css.primaryAction}
            onClick={() => { void prepare() }}
            disabled={busy || method === undefined || draft.trim() === '' || recoveryPending}
          >
            {phase === 'preparing' ? t('assetPreparing') : t('assetPrepare')}
          </button>
          <span>{t('assetPrepareBoundary')}</span>
        </div>
      )}

      {snapshot !== undefined && (
        <section className={css.previewDock} aria-label={t('assetReferenceTitle')}>
          <div className={css.previewHead}>
            <div><h4>{t('assetReferenceTitle')}</h4><p>{t('assetReferenceBoundary')}</p></div>
          </div>
          <div className={css.assetKindSwitch} role="group" aria-label={t('assetReferenceTitle')}>
            <button
              type="button"
              aria-pressed={referenceOperation === 'selectReferenceAsset'}
              disabled={busy || recoveryPending}
              onClick={() => {
                setReferenceOperation('selectReferenceAsset')
                setSelectedCandidateId('')
                setSelectedRightsReference('')
                setRightsDraft(undefined)
                setRepairPrompt('')
                setPreview(undefined)
                setReferenceProposalLineage(undefined)
                setConfirmed(false)
                setReferenceError(undefined)
                setPhase('draft')
              }}
            >
              {t('assetReferenceSelectOperation')}
            </button>
            <button
              type="button"
              aria-pressed={referenceOperation === 'requestReferenceRegeneration'}
              disabled={busy || recoveryPending}
              onClick={() => {
                setReferenceOperation('requestReferenceRegeneration')
                setSelectedCandidateId('')
                setSelectedRightsReference('')
                setRightsDraft(undefined)
                setPreview(undefined)
                setReferenceProposalLineage(undefined)
                setConfirmed(false)
                setReferenceError(undefined)
                setPhase('draft')
              }}
            >
              {t('assetReferenceRegenerateOperation')}
            </button>
            <button
              type="button"
              aria-pressed={referenceOperation === 'replaceReferenceRights'}
              disabled={busy || recoveryPending}
              onClick={() => {
                setReferenceOperation('replaceReferenceRights')
                setSelectedCandidateId('')
                setSelectedRightsReference('')
                setRightsDraft(undefined)
                setRepairPrompt('')
                setPreview(undefined)
                setReferenceProposalLineage(undefined)
                setConfirmed(false)
                setReferenceError(undefined)
                setPhase('draft')
              }}
            >
              {t('assetRightsOperation')}
            </button>
          </div>
          {referenceOperation !== 'replaceReferenceRights' && (
            <fieldset disabled={busy || recoveryPending}>
              <legend>{t('assetReferenceCandidates')}</legend>
              {candidateItems.length === 0 ? <p className={css.empty}>{t('assetReferenceNoCandidates')}</p> : (
                <div className={css.methodGrid}>
                  {candidateItems.map((candidate) => {
                    const eligible = referenceCandidateEligible(candidate, referenceOperation)
                    const status = t(REFERENCE_STATUS_LOCALE_KEY[candidate.selectionStatus])
                    return (
                      <label key={`${candidate.assetId}:${candidate.sha256}`}>
                        <input
                          type="radio"
                          name={`reference-candidate-${projectId}-${elementKind}-${targetId}`}
                          checked={selectedCandidateId === candidate.assetId}
                          disabled={!eligible}
                          onChange={() => {
                            setSelectedCandidateId(candidate.assetId)
                            setPreview(undefined)
                            setReferenceProposalLineage(undefined)
                            setConfirmed(false)
                            setReferenceError(undefined)
                            setPhase('draft')
                          }}
                        />
                        <strong>{candidate.assetId}</strong>
                        <span>{status}</span>
                        <small>{candidate.sha256}</small>
                      </label>
                    )
                  })}
                </div>
              )}
            </fieldset>
          )}
          {referenceOperation === 'replaceReferenceRights' && (
            <>
              <fieldset disabled={busy || recoveryPending}>
                <legend>{t('assetRightsReferences')}</legend>
                {rightsReferences.length === 0 ? <p className={css.empty}>{t('assetRightsNoReferences')}</p> : (
                  <div className={css.methodGrid}>
                    {rightsReferences.map((reference) => {
                      const binding = referenceBinding(reference)
                      return (
                        <label key={binding}>
                          <input
                            type="radio"
                            name={`reference-rights-${projectId}-${elementKind}-${targetId}`}
                            checked={selectedRightsReference === binding}
                            onChange={() => {
                              setSelectedRightsReference(binding)
                              setRightsDraft(createReferenceRightsDraft(reference.rights))
                              setPreview(undefined)
                              setReferenceProposalLineage(undefined)
                              setConfirmed(false)
                              setReferenceError(undefined)
                              setPhase('draft')
                            }}
                          />
                          <strong>{reference.assetId}</strong>
                          <span>{t(reference.rightsRecorded ? 'assetRightsRecorded' : 'assetRightsNotRecorded')}</span>
                          <small>{reference.sha256}</small>
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>
              {selectedRightsRecord !== undefined && rightsDraft !== undefined && (
                <ReferenceRightsEditor
                  value={rightsDraft}
                  disabled={busy || recoveryPending}
                  onChange={(next) => {
                    setRightsDraft(next)
                    setPreview(undefined)
                    setReferenceProposalLineage(undefined)
                    setConfirmed(false)
                    setReferenceError(undefined)
                    setPhase('draft')
                  }}
                  t={t}
                />
              )}
            </>
          )}
          {referenceOperation === 'requestReferenceRegeneration' && (
            <label className={css.scriptEditor}>
              <span>{t('assetReferenceRepairPrompt')}</span>
              <textarea
                aria-label={t('assetReferenceRepairPrompt')}
                value={repairPrompt}
                maxLength={8000}
                rows={5}
                disabled={busy || recoveryPending}
                onChange={(event) => {
                  setRepairPrompt(event.target.value)
                  setPreview(undefined)
                  setReferenceProposalLineage(undefined)
                  setConfirmed(false)
                  setReferenceError(undefined)
                  setPhase('draft')
                }}
              />
              <small>{t('assetReferenceRepairPromptHint')}</small>
            </label>
          )}
          <div className={css.scriptActions}>
            <button
              type="button"
              className={css.primaryAction}
              onClick={() => { void prepareReference() }}
              disabled={busy || !referenceInputValid || recoveryPending}
            >
              {phase === 'preparing'
                ? t('assetPreparing')
                : t(referenceOperation === 'selectReferenceAsset'
                  ? 'assetReferencePrepareSelect'
                  : referenceOperation === 'requestReferenceRegeneration'
                    ? 'assetReferencePrepareRegenerate'
                    : 'assetRightsPrepare')}
            </button>
            <span aria-live="polite">
              {t(referenceOperation === 'selectReferenceAsset'
                ? 'assetReferenceSelectNotice'
                : referenceOperation === 'requestReferenceRegeneration'
                  ? 'assetReferenceRegenerateNotice'
                  : 'assetRightsNotice')}
            </span>
          </div>
        </section>
      )}

      {referenceError !== undefined && (
        <div ref={referenceFeedbackRef} tabIndex={-1} className={css.scriptError} role="alert">
          <strong>{t('assetReferenceLoadError')}</strong><p>{referenceError}</p>
        </div>
      )}

      {snapshot !== undefined && (
        <section className={css.previewDock} aria-label={t('assetRightsExceptionTitle')}>
          <div className={css.previewHead}>
            <div>
              <h4>{t('assetRightsExceptionTitle')}</h4>
              <p>{t('assetRightsExceptionBoundary')}</p>
            </div>
          </div>

          {exceptionRecovery.status === 'ready' && (
            <section className={css.recoveryDock} aria-label={t('assetRightsExceptionRecoveryTitle')}>
              <div>
                <h4>{t('assetRightsExceptionRecoveryTitle')}</h4>
                <p>{t('assetRightsExceptionRecoveryBody')}</p>
              </div>
              <dl>
                <div><dt>{t('projectId')}</dt><dd>{exceptionRecovery.marker.projectId}</dd></div>
                <div><dt>{t('assetReviewSubject')}</dt><dd>{exceptionRecovery.marker.targetId}</dd></div>
                <div><dt>{t('assetProfileRevision')}</dt><dd>{exceptionRecovery.marker.expectedSubjectRevision}</dd></div>
                <div><dt>{t('assetSnapshotHash')}</dt><dd>{exceptionRecovery.marker.expectedSubjectSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionReferenceAsset')}</dt><dd>{exceptionRecovery.marker.referenceAssetId}</dd></div>
                <div><dt>{t('assetRightsExceptionReferenceSha')}</dt><dd>{exceptionRecovery.marker.referenceAssetSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionRightsHash')}</dt><dd>{exceptionRecovery.marker.rightsRecordSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionReasonHash')}</dt><dd>{exceptionRecovery.marker.reasonSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionScopeHash')}</dt><dd>{exceptionRecovery.marker.scopeSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionIdempotency')}</dt><dd>{exceptionRecovery.marker.idempotencyKey}</dd></div>
              </dl>
              <p>{t('assetRightsExceptionRecoveryGetOnly')}</p>
              <div className={css.recoveryActions}>
                <button
                  type="button"
                  className={css.primaryAction}
                  disabled={exceptionBusy !== undefined || snapshot === undefined}
                  onClick={() => { void recoverReferenceRightsExceptionRelease() }}
                >
                  {exceptionBusy === 'recovering'
                    ? t('assetRightsExceptionRecovering')
                    : t('assetRightsExceptionRecover')}
                </button>
                <button
                  type="button"
                  disabled={exceptionBusy !== undefined}
                  onClick={discardReferenceRightsExceptionRecovery}
                >
                  {t('assetRightsExceptionDiscard')}
                </button>
              </div>
            </section>
          )}

          {exceptionRecovery.status === 'invalid' && (
            <div className={css.scriptError} role="alert">
              <strong>{t('assetRightsExceptionRecoveryInvalid')}</strong>
              <p>{exceptionRecovery.error}</p>
              <button type="button" onClick={discardReferenceRightsExceptionRecovery}>
                {t('assetRightsExceptionDiscard')}
              </button>
            </div>
          )}

          {exceptionFeed !== undefined && (
            <>
              <dl className={css.previewMeta}>
                <div><dt>{t('assetReviewSubject')}</dt><dd>{exceptionFeed.subject.id}</dd></div>
                <div><dt>{t('assetProfileRevision')}</dt><dd>{exceptionFeed.subject.revision}</dd></div>
                <div><dt>{t('assetSnapshotHash')}</dt><dd>{exceptionFeed.subject.sha256}</dd></div>
                <div><dt>{t('assetRightsExceptionCapability')}</dt><dd>{t(exceptionFeed.capabilities.canRelease ? 'yes' : 'no')}</dd></div>
                <div><dt>{t('assetRightsExceptionBlockedReasonCode')}</dt><dd>{exceptionFeed.capabilities.blockedReasonCode ?? t('empty')}</dd></div>
                <div><dt>{t('assetRightsExceptionBlockedReason')}</dt><dd>{exceptionFeed.capabilities.blockedReason ?? t('empty')}</dd></div>
                <div><dt>{t('assetRightsExceptionRecentAuth')}</dt><dd>{t('yes')}</dd></div>
              </dl>
              <p>{t('assetRightsExceptionApproverBoundary')}</p>
            </>
          )}

          {exceptionFeedError !== undefined && (
            <div className={css.scriptError} role="alert">
              <strong>{t('assetRightsExceptionLoadError')}</strong>
              <p>{exceptionFeedError}</p>
            </div>
          )}

          {exceptionFeed === undefined && exceptionFeedError === undefined && (
            <p className={css.empty} role="status">{t('assetRightsExceptionLoadBlocked')}</p>
          )}

          <fieldset disabled={busy || recoveryPending || exceptionFeed?.capabilities.canRelease !== true}>
            <legend>{t('assetRightsExceptionReference')}</legend>
            {rightsReferences.length === 0 ? <p className={css.empty}>{t('assetRightsNoReferences')}</p> : (
              <div className={css.methodGrid}>
                {rightsReferences.map((reference) => {
                  const binding = referenceBinding(reference)
                  return (
                    <label key={binding}>
                      <input
                        type="radio"
                        name={`reference-rights-exception-${projectId}-${elementKind}-${targetId}`}
                        checked={exceptionReferenceBinding === binding}
                        onChange={() => {
                          setExceptionReferenceBinding(binding)
                          setExceptionRightsFields([])
                          setExceptionConfirmed(false)
                          setExceptionReceipt(undefined)
                          setExceptionReceiptRecovered(false)
                          setExceptionError(undefined)
                        }}
                      />
                      <strong>{reference.assetId}</strong>
                      <span>{t(reference.rightsRecorded ? 'assetRightsRecorded' : 'assetRightsNotRecorded')}</span>
                      <small>{reference.sha256}</small>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>

          {selectedExceptionReference !== undefined && (
            <dl className={css.previewMeta}>
              <div><dt>{t('assetRightsExceptionReferenceAsset')}</dt><dd>{selectedExceptionReference.assetId}</dd></div>
              <div><dt>{t('assetRightsExceptionReferenceSha')}</dt><dd>{selectedExceptionReference.sha256}</dd></div>
              <div><dt>{t('assetRightsExceptionRightsHash')}</dt><dd>{exceptionRightsRecordSha256 ?? t('unknown')}</dd></div>
            </dl>
          )}

          <fieldset disabled={busy || recoveryPending || selectedExceptionReference === undefined}>
            <legend>{t('assetRightsExceptionFields')}</legend>
            <div className={css.methodGrid}>
              {REFERENCE_RIGHTS_EXCEPTION_FIELDS.map(field => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={exceptionRightsFields.includes(field)}
                    onChange={(event) => {
                      setExceptionRightsFields(current => REFERENCE_RIGHTS_EXCEPTION_FIELDS.filter(candidate => (
                        candidate === field ? event.target.checked : current.includes(candidate)
                      )))
                      setExceptionConfirmed(false)
                      setExceptionReceipt(undefined)
                      setExceptionReceiptRecovered(false)
                      setExceptionError(undefined)
                    }}
                  />
                  <span>{t(REFERENCE_RIGHTS_EXCEPTION_FIELD_LOCALE_KEY[field])}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={css.scriptEditor}>
            <span>{t('assetRightsExceptionReason')}</span>
            <textarea
              aria-label={t('assetRightsExceptionReason')}
              value={exceptionReason}
              maxLength={8000}
              rows={5}
              disabled={busy || recoveryPending || selectedExceptionReference === undefined}
              onChange={(event) => {
                setExceptionReason(event.target.value)
                setExceptionConfirmed(false)
                setExceptionReceipt(undefined)
                setExceptionReceiptRecovered(false)
                setExceptionError(undefined)
              }}
            />
            {exceptionReason !== '' && normalizedExceptionReason === undefined && (
              <small role="alert">{t('assetRightsExceptionReasonInvalid')}</small>
            )}
          </label>

          <div className={css.commitDock}>
            <label>
              <input
                type="checkbox"
                checked={exceptionConfirmed}
                disabled={busy
                  || recoveryPending
                  || selectedExceptionReference === undefined
                  || exceptionRightsFields.length === 0
                  || normalizedExceptionReason === undefined}
                onChange={(event) => {
                  setExceptionConfirmed(event.target.checked)
                  setExceptionReceipt(undefined)
                  setExceptionReceiptRecovered(false)
                  setExceptionError(undefined)
                }}
              />
              <span>{t('assetRightsExceptionConfirm')}</span>
            </label>
            <button
              type="button"
              className={css.primaryAction}
              disabled={busy || !exceptionCanSubmit}
              onClick={() => { void submitReferenceRightsExceptionRelease() }}
            >
              {exceptionBusy === 'submitting'
                ? t('assetRightsExceptionSubmitting')
                : t('assetRightsExceptionSubmit')}
            </button>
          </div>

          {exceptionError !== undefined && (
            <div className={css.scriptError} role="alert">
              <strong>{t('assetRightsExceptionOperationError')}</strong>
              <p>{exceptionError}</p>
            </div>
          )}

          {exceptionReceipt !== undefined && (
            <section className={css.commitReceipt} aria-label={t('assetRightsExceptionSucceeded')}>
              <h4>{t(exceptionReceiptRecovered
                ? 'assetRightsExceptionRecovered'
                : 'assetRightsExceptionSucceeded')}</h4>
              <dl>
                <div><dt>{t('changeSet')}</dt><dd>{exceptionReceipt.changeSetId}</dd></div>
                <div><dt>{t('receiptId')}</dt><dd>{exceptionReceipt.commandReceiptId}</dd></div>
                <div><dt>{t('eventId')}</dt><dd>{exceptionReceipt.eventId}</dd></div>
                <div><dt>{t('payloadHash')}</dt><dd>{exceptionReceipt.payloadSha256}</dd></div>
                <div><dt>{t('assetRightsExceptionReleaseId')}</dt><dd>{exceptionReceipt.release.id}</dd></div>
                <div><dt>{t('assetRightsExceptionReleasedAt')}</dt><dd>{exceptionReceipt.release.releasedAt}</dd></div>
              </dl>
            </section>
          )}

          {exceptionFeed !== undefined && (
            <section aria-label={t('assetRightsExceptionHistory')}>
              <h5>{t('assetRightsExceptionHistory')}</h5>
              {exceptionFeed.releases.length === 0 ? (
                <p className={css.empty}>{t('assetRightsExceptionNoHistory')}</p>
              ) : (
                <div className={css.methodGrid}>
                  {exceptionFeed.releases.map(release => (
                    <article key={release.id}>
                      <strong>{release.id} · {t(currentExceptionReleaseIds.has(release.id)
                        ? 'assetRightsExceptionCurrent'
                        : release.stale
                          ? 'assetRightsExceptionStale'
                          : 'assetRightsExceptionHistorical')}</strong>
                      <p>{release.reason}</p>
                      <dl className={css.previewMeta}>
                        <div><dt>{t('assetProfileRevision')}</dt><dd>{release.subjectRevision}</dd></div>
                        <div><dt>{t('assetSnapshotHash')}</dt><dd>{release.subjectSha256}</dd></div>
                        <div><dt>{t('assetRightsExceptionReferenceAsset')}</dt><dd>{release.scope.referenceAssetId}</dd></div>
                        <div><dt>{t('assetRightsExceptionReferenceSha')}</dt><dd>{release.scope.referenceAssetSha256}</dd></div>
                        <div><dt>{t('assetRightsExceptionRightsHash')}</dt><dd>{release.scope.rightsRecordSha256}</dd></div>
                        <div><dt>{t('assetRightsExceptionFields')}</dt><dd>{release.scope.rightsFields.map(field => t(REFERENCE_RIGHTS_EXCEPTION_FIELD_LOCALE_KEY[field])).join(' · ')}</dd></div>
                        <div><dt>{t('assetRightsExceptionApprover')}</dt><dd>{release.actorId} · {release.actorNaturalPersonId}</dd></div>
                        <div><dt>{t('assetRightsExceptionProducer')}</dt><dd>{release.producerActorId} · {release.producerNaturalPersonId}</dd></div>
                        <div><dt>{t('assetRightsExceptionAssetProducer')}</dt><dd>{release.assetProducerActorId} · {release.assetProducerNaturalPersonId}</dd></div>
                        <div><dt>{t('assetRightsExceptionAssetProducerTask')}</dt><dd>{release.assetProducerTaskId}</dd></div>
                        <div><dt>{t('assetRightsExceptionAssetProducerRequest')}</dt><dd>{release.assetProducerTaskRequestSha256}</dd></div>
                        <div><dt>{t('assetRightsExceptionAuthSession')}</dt><dd>{release.authSessionId}</dd></div>
                        <div><dt>{t('assetRightsExceptionReleasedAt')}</dt><dd>{release.releasedAt}</dd></div>
                        <div><dt>{t('assetRightsExceptionStaleReasons')}</dt><dd>{release.staleReasonCodes.join(' · ') || t('empty')}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      )}

      {snapshot !== undefined && (
        <section className={css.previewDock} aria-label={t('assetReviewEventsTitle')}>
          <div className={css.previewHead}>
            <div>
              <h4>{t('assetReviewEventsTitle')}</h4>
              <p>{t('assetReviewEventsBoundary')}</p>
            </div>
          </div>
          {reviewFeed !== undefined && (
            <dl className={css.previewMeta}>
              <div><dt>{t('assetReviewSubject')}</dt><dd>{reviewFeed.subject.id}</dd></div>
              <div><dt>{t('assetProfileRevision')}</dt><dd>{reviewFeed.subject.revision}</dd></div>
              <div><dt>{t('assetSnapshotHash')}</dt><dd>{reviewFeed.subject.sha256}</dd></div>
            </dl>
          )}
          {reviewError !== undefined && (
            <div className={css.scriptError} role="alert">
              <strong>{t(reviewFeed === undefined ? 'assetReviewLoadError' : 'assetReviewOperationError')}</strong>
              <p>{reviewError}</p>
            </div>
          )}
          {reviewFeed === undefined && <p className={css.empty} role="status">{t('assetReviewLoadBlocked')}</p>}
          <div className={css.methodGrid}>
            <section aria-label={t('assetReviewCommentTitle')}>
              <h5>{t('assetReviewCommentTitle')}</h5>
              {reviewFeed !== undefined && !reviewFeed.capabilities.canComment && (
                <p role="status">{t('assetReviewCommentBlockedPermission')}</p>
              )}
              <label className={css.scriptEditor}>
                <span>{t('assetReviewCommentLabel')}</span>
                <textarea
                  aria-label={t('assetReviewCommentLabel')}
                  value={commentBody}
                  maxLength={8000}
                  rows={4}
                  disabled={busy
                    || reviewFeed?.capabilities.canComment !== true
                    || recoveryPending}
                  onChange={(event) => {
                    setCommentBody(event.target.value)
                    setReviewError(undefined)
                    setReviewStatus(undefined)
                  }}
                />
              </label>
              <div className={css.scriptActions}>
                <button
                  type="button"
                  className={css.primaryAction}
                  onClick={() => { void submitComment() }}
                  disabled={busy
                    || reviewFeed?.capabilities.canComment !== true
                    || commentBody.trim() === ''
                    || recoveryPending}
                >
                  {reviewBusy === 'comment'
                    ? t('assetReviewCommentSubmitting')
                    : t('assetReviewCommentSubmit')}
                </button>
              </div>
            </section>
            <section aria-label={t('assetReviewDecisionTitle')}>
              <h5>{t('assetReviewDecisionTitle')}</h5>
              {reviewFeed !== undefined && !reviewFeed.capabilities.canDecide && (
                <p role="status">{t('assetReviewDecisionBlockedPermission')}</p>
              )}
              <label className={css.assetSubjectPicker}>
                <span>{t('assetReviewDecisionValue')}</span>
                <select
                  aria-label={t('assetReviewDecisionValue')}
                  value={decisionValue}
                  disabled={busy || reviewFeed?.capabilities.canDecide !== true || recoveryPending}
                  onChange={(event) => {
                    if (isHumanDecisionValue(event.target.value)) setDecisionValue(event.target.value)
                    setReviewError(undefined)
                    setReviewStatus(undefined)
                  }}
                >
                  <option value="approve">{t('assetReviewDecisionApprove')}</option>
                  <option value="reject">{t('assetReviewDecisionReject')}</option>
                  <option value="request_changes">{t('assetReviewDecisionRequestChanges')}</option>
                </select>
              </label>
              <label className={css.scriptEditor}>
                <span>{t('assetReviewDecisionReason')}</span>
                <textarea
                  aria-label={t('assetReviewDecisionReason')}
                  value={decisionReason}
                  maxLength={8000}
                  rows={4}
                  disabled={busy || reviewFeed?.capabilities.canDecide !== true || recoveryPending}
                  onChange={(event) => {
                    setDecisionReason(event.target.value)
                    setReviewError(undefined)
                    setReviewStatus(undefined)
                  }}
                />
              </label>
              <div className={css.scriptActions}>
                <button
                  type="button"
                  className={css.primaryAction}
                  onClick={() => { void submitHumanDecision() }}
                  disabled={busy
                    || reviewFeed?.capabilities.canDecide !== true
                    || decisionReason.trim() === ''
                    || recoveryPending}
                >
                  {reviewBusy === 'decision'
                    ? t('assetReviewDecisionSubmitting')
                    : t('assetReviewDecisionSubmit')}
                </button>
              </div>
            </section>
          </div>
          {reviewStatus !== undefined && (
            <div className={css.impactSummary} role="status" aria-live="polite">
              <span>{t(reviewStatus === 'comment'
                ? 'assetReviewCommentSucceeded'
                : 'assetReviewDecisionSucceeded')}</span>
            </div>
          )}
          {reviewFeed !== undefined && (
            <section aria-label={t('assetReviewHistory')}>
              <h5>{t('assetReviewCurrentDecision')}</h5>
              {reviewFeed.currentDecision === null ? (
                <p className={css.empty}>{t('assetReviewNoCurrentDecision')}</p>
              ) : (
                <div className={css.impactSummary}>
                  <strong>{t(HUMAN_DECISION_LOCALE_KEY[reviewFeed.currentDecision.decision])}</strong>
                  <span>{reviewFeed.currentDecision.reason}</span>
                  <small>{reviewFeed.currentDecision.actorId} · {t('assetReviewDecisionCurrent')}</small>
                </div>
              )}
              <h5>{t('assetReviewHistory')}</h5>
              {reviewFeed.comments.length === 0 && reviewFeed.decisions.length === 0 ? (
                <p className={css.empty}>{t('assetReviewNoEvents')}</p>
              ) : (
                <div className={css.methodGrid}>
                  {reviewFeed.comments.map(comment => (
                    <article key={comment.id}>
                      <strong>{t('assetReviewCommentTitle')} · {comment.actorId}</strong>
                      <p>{comment.body}</p>
                      <small>{comment.createdAt}</small>
                    </article>
                  ))}
                  {reviewFeed.decisions.map(decision => (
                    <article key={decision.id}>
                      <strong>{t(HUMAN_DECISION_LOCALE_KEY[decision.decision])} · {decision.actorId}</strong>
                      <p>{decision.reason}</p>
                      <small>{decision.decidedAt} · {t(decision.stale
                        ? 'assetReviewDecisionStale'
                        : 'assetReviewDecisionCurrent')}</small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>
      )}

      {error !== undefined && <div className={css.scriptError} role="alert"><strong>{t('assetOperationError')}</strong><p>{error}</p></div>}

      {visualPreview !== undefined && (
        <section className={css.previewDock} aria-label={t('assetPreviewTitle')}>
          <div className={css.previewHead}>
            <div><h4>{t('assetPreviewTitle')}</h4><p>{visualPreview.changed ? t('assetChanged') : t('assetNoChange')}</p></div>
            <span>{visualPreview.canCommit ? t('previewCommittable') : t('previewBlocked')}</span>
          </div>
          <dl className={css.previewMeta}>
            <div><dt>{t('changeSet')}</dt><dd>{visualPreview.changeSetId}</dd></div>
            <div><dt>{t('previewHash')}</dt><dd>{visualPreview.previewSha256}</dd></div>
            <div><dt>{t('assetProfileRevision')}</dt><dd>{visualPreview.baseRevision} → {visualPreview.authoritativeRevision}</dd></div>
            <div><dt>{t('assetImpactHash')}</dt><dd>{visualPreview.impactSha256}</dd></div>
          </dl>
          <div className={css.previewColumns}>
            <div><strong>{t('assetVersionBase')}</strong><p>{baseVisual}</p></div>
            <div><strong>{t('assetVersionCurrent')}</strong><p>{currentVisual}</p></div>
            <div><strong>{t('assetVersionProposed')}</strong><p>{proposedVisual}</p></div>
          </div>
          <section className={css.impactPanel} aria-label={t('assetReferenceImpact')}>
            <div className={css.impactSummary}>
              <strong>{t('assetReferenceImpact')}</strong>
              <span>{boolOf(visualPreview.referenceInvalidationExpected) ? t('assetReferenceWillInvalidate') : t('assetReferenceUnchanged')}</span>
            </div>
            <div className={css.impactGrid}>
              {impactGroups.map(group => (
                <div key={group.label} className={css.impactGroup}>
                  <strong>{group.label}</strong>
                  {group.values.length === 0
                    ? <span>{t('assetImpactNone')}</span>
                    : <ul>{group.values.map(value => <li key={value}>{value}</li>)}</ul>}
                </div>
              ))}
            </div>
          </section>
          {(visualPreview.revisionConflict || visualPreview.baseSnapshotConflict) && (
            <div className={css.conflict} role="status"><strong>{t('assetConflictTitle')}</strong><p>{t('assetConflictBody')}</p></div>
          )}
          {visualPreview.canCommit && !recoveryPending && (
            <div className={css.commitDock}>
              <label>
                <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked) }} disabled={busy} />
                <span>{t('assetConfirmLabel')}</span>
              </label>
              <button type="button" className={css.primaryAction} disabled={!confirmed || busy} onClick={() => { void commit() }}>
                {phase === 'committing' ? t('assetCommitting') : t('assetCommit')}
              </button>
            </div>
          )}
        </section>
      )}

      {referencePreview !== undefined && (
        <section className={css.previewDock} aria-label={t('assetReferencePreviewTitle')}>
          <div className={css.previewHead}>
            <div><h4>{t('assetReferencePreviewTitle')}</h4><p>{t(referencePreview.operation === 'selectReferenceAsset' ? 'assetReferenceSelectNotice' : 'assetReferenceRegenerateNotice')}</p></div>
            <span>{referencePreview.canCommit ? t('previewCommittable') : t('previewBlocked')}</span>
          </div>
          <dl className={css.previewMeta}>
            <div><dt>{t('changeSet')}</dt><dd>{referencePreview.changeSetId}</dd></div>
            <div><dt>{t('assetReferenceCandidates')}</dt><dd>{referencePreview.candidateAssetId}</dd></div>
            <div><dt>{t('assetSnapshotHash')}</dt><dd>{referencePreview.candidateAssetSha256}</dd></div>
            <div><dt>{t('status')}</dt><dd>{t(referencePreview.operation === 'selectReferenceAsset' ? 'assetReferenceSelectOperation' : 'assetReferenceRegenerateOperation')}</dd></div>
          </dl>
          <p>{t('assetReferenceZeroExecution')}</p>
          <div className={referencePreview.candidateDrift ? css.conflict : css.impactSummary} role="status">
            <span>{t(referencePreview.candidateDrift ? 'assetReferenceCandidateDrift' : 'assetReferenceCandidateCurrent')}</span>
          </div>
          {referencePreview.canCommit && !recoveryPending && (
            <div className={css.commitDock}>
              <label>
                <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked) }} disabled={busy} />
                <span>{t(referencePreview.operation === 'selectReferenceAsset' ? 'assetReferenceConfirmSelect' : 'assetReferenceConfirmRegenerate')}</span>
              </label>
              <button type="button" className={css.primaryAction} disabled={!confirmed || busy} onClick={() => { void commit() }}>
                {phase === 'committing'
                  ? t('assetCommitting')
                  : t(referencePreview.operation === 'selectReferenceAsset' ? 'assetReferenceCommitSelect' : 'assetReferenceCommitRegenerate')}
              </button>
            </div>
          )}
        </section>
      )}

      {rightsPreview !== undefined && (
        <section className={css.previewDock} aria-label={t('assetRightsPreviewTitle')}>
          <div className={css.previewHead}>
            <div>
              <h4>{t('assetRightsPreviewTitle')}</h4>
              <p>{rightsPreview.changed ? t('assetChanged') : t('assetNoChange')}</p>
            </div>
            <span>{rightsPreview.canCommit ? t('previewCommittable') : t('previewBlocked')}</span>
          </div>
          <dl className={css.previewMeta}>
            <div><dt>{t('changeSet')}</dt><dd>{rightsPreview.changeSetId}</dd></div>
            <div><dt>{t('assetRightsReferenceBinding')}</dt><dd>{rightsPreview.referenceAssetId}:{rightsPreview.referenceAssetSha256}</dd></div>
            <div><dt>{t('assetProfileRevision')}</dt><dd>{rightsPreview.baseRevision} → {rightsPreview.authoritativeRevision}</dd></div>
            <div><dt>{t('assetImpactHash')}</dt><dd>{rightsPreview.impactSha256}</dd></div>
          </dl>
          <ReferenceRightsSummary value={rightsPreview.proposedReferenceRights} t={t} />
          <p>{t('assetRightsNotice')}</p>
          <div className={css.impactSummary} role="status">
            <span>{t('assetRightsSelectionPreserved')}</span>
          </div>
          <section className={css.impactPanel} aria-label={t('assetReferenceImpact')}>
            <div className={css.impactSummary}>
              <strong>{t('assetReferenceImpact')}</strong>
              <span>{rightsPreview.referenceInvalidationExpected ? t('assetReferenceWillInvalidate') : t('assetReferenceUnchanged')}</span>
            </div>
            <div className={css.impactGrid}>
              {rightsImpactGroups.map(group => (
                <div key={group.label} className={css.impactGroup}>
                  <strong>{group.label}</strong>
                  {group.values.length === 0
                    ? <span>{t('assetImpactNone')}</span>
                    : <ul>{group.values.map(value => <li key={value}>{value}</li>)}</ul>}
                </div>
              ))}
            </div>
          </section>
          {(rightsPreview.revisionConflict || rightsPreview.baseSnapshotConflict || rightsPreview.impactConflict) && (
            <div className={css.conflict} role="status"><strong>{t('assetConflictTitle')}</strong><p>{t('assetRightsConflictBody')}</p></div>
          )}
          {rightsPreview.canCommit && !recoveryPending && (
            <div className={css.commitDock}>
              <label>
                <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked) }} disabled={busy} />
                <span>{t('assetRightsConfirm')}</span>
              </label>
              <button type="button" className={css.primaryAction} disabled={!confirmed || busy} onClick={() => { void commit() }}>
                {phase === 'committing' ? t('assetCommitting') : t('assetRightsCommit')}
              </button>
            </div>
          )}
        </section>
      )}

      {commitReceipt !== undefined && (
        <section className={css.commitReceipt} role="status">
          <h4>{commitRecovered
            ? t('receiptRecovered')
            : t(commitReceipt.schema === 'jason.qingmu-element-profile-commit-result.v1'
              ? commitReceipt.operation === 'replaceReferenceRights'
                ? 'assetRightsCommitSucceeded'
                : 'assetCommitSucceeded'
              : commitReceipt.operation === 'selectReferenceAsset'
                ? 'assetReferenceCommitSucceededSelect'
                : 'assetReferenceCommitSucceededRegenerate')}</h4>
          <dl>
            <div><dt>{t('receiptId')}</dt><dd>{commitReceipt.commandReceiptId}</dd></div>
            <div><dt>{t('eventId')}</dt><dd>{commitReceipt.eventId}</dd></div>
            <div><dt>{t('authoritativeRevision')}</dt><dd>{commitReceipt.authoritativeRevision}</dd></div>
            {commitReceipt.schema === 'jason.qingmu-element-profile-commit-result.v1'
              ? <>
                {commitReceipt.operation === 'replaceReferenceRights' && (
                  <div><dt>{t('assetRightsReferenceBinding')}</dt><dd>{commitReceipt.referenceAssetId}:{commitReceipt.referenceAssetSha256}</dd></div>
                )}
                <div><dt>{t('assetImpactHash')}</dt><dd>{commitReceipt.impactSha256}</dd></div>
              </>
              : <>
                <div><dt>{t('assetReferenceCandidates')}</dt><dd>{commitReceipt.candidateAssetId}</dd></div>
                <div><dt>{t('assetSnapshotHash')}</dt><dd>{commitReceipt.candidateAssetSha256}</dd></div>
              </>}
            <div><dt>{t('deduplicated')}</dt><dd>{commitReceipt.deduplicated ? t('yes') : t('no')}</dd></div>
          </dl>
          {commitReceipt.schema === 'jason.qingmu-element-profile-commit-result.v1'
            && commitReceipt.operation === 'replaceReferenceRights'
            && <p>{t('assetRightsSelectionPreserved')}</p>}
          {commitReceipt.schema === 'jason.qingmu-reference-asset-commit-result.v1' && <p>{t('assetReferenceZeroExecution')}</p>}
          {warning !== undefined && <p className={css.warning}>{t('postCommitWarning')}: {warning}</p>}
        </section>
      )}
    </section>
  )
}
