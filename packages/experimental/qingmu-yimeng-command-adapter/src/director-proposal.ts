/** Host-only deterministic replay proposal over a fresh Yimeng director snapshot. */
import { createHash } from 'node:crypto'
import type { ImagoDirectorReplayMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { CreationScope } from './creation.ts'
import type { PlanningShot } from './scene-planning.ts'

/** Advisory proposal variants allowed by the replay-only seam. */
export type DirectorSuggestionType = 'text_director_proposal' | 'visual_finding'
/** Scene-planning fields that a human may choose to copy into the draft. */
export type DirectorProposalField = 'narrative' | 'visual' | 'action' | 'durationSec'

/** Browser-safe request for one scoped replay proposal. */
export interface DirectorProposalRequest extends CreationScope {
  readonly sceneId: string
  readonly shotId: string
  readonly suggestionType: DirectorSuggestionType
}

/** SHA-bound read-only Yimeng context for one real scene-planning shot. */
export interface DirectorContextSnapshot extends CreationScope {
  readonly schema: 'jason.qingmu-director-context-snapshot.v1'
  readonly sceneId: string
  readonly shotId: string
  readonly script: { readonly revision: number; readonly sha256: string }
  readonly sceneSource: Readonly<Record<string, unknown>>
  readonly sourceScene: Readonly<Record<string, unknown>>
  readonly storyboard: { readonly id: string; readonly version: number; readonly sourceHash: string; readonly status: 'Ready' }
  readonly shot: PlanningShot & { readonly id: string }
  readonly selectedReferences: readonly Readonly<Record<string, unknown>>[]
  readonly sourceTime: string
  readonly contextSnapshotSha256: string
  readonly providerCalls: 0
  readonly costAmountCny: '0'
  readonly businessStateChanged: false
  readonly humanDecisionInferred: false
  readonly formalQcInferred: false
  readonly selectionGranted: false
  readonly readyGranted: false
}

/** Zero-cost replay work order issued by Yimeng without Provider execution. */
export interface DirectorInferenceWorkOrder extends CreationScope {
  readonly schema: 'jason.qingmu-director-inference-work-order.v1'
  readonly workOrderId: string
  readonly sceneId: string
  readonly shotId: string
  readonly purpose: 'bounded_director_suggestion'
  readonly suggestionType: DirectorSuggestionType
  readonly methodCapability: 'director.text.proposal' | 'director.visual.finding'
  readonly outputSchema: 'qingmu.director-proposal.v1' | 'qingmu.visual-review-proposal.v1'
  readonly executionProfile: 'deterministic_replay_fixture_v1'
  readonly inputSha256: string
  readonly promptSha256: string
  readonly methodPackage: { readonly version: string; readonly sha256: string }
  readonly idempotencyKey: string
  readonly budget: { readonly mode: 'replay'; readonly currency: 'CNY'; readonly maximumAmount: '0'; readonly providerCalls: 0 }
  readonly sourceTime: string
  readonly staleWhen: readonly string[]
  readonly workOrderSha256: string
  readonly providerCalls: 0
  readonly costAmountCny: '0'
  readonly businessStateChanged: false
  readonly humanDecisionInferred: false
  readonly formalQcInferred: false
  readonly selectionGranted: false
  readonly readyGranted: false
}

/** One original-value, suggested-value and impact comparison. */
export interface DirectorProposalItem {
  readonly id: string
  readonly field: DirectorProposalField
  readonly originalValue: string | number
  readonly proposedValue: string | number
  readonly impact: string
}

/** Host-only deterministic proposal that grants no business authority. */
export interface DirectorReplayProposal extends CreationScope {
  readonly schema: 'qingmu.director-replay-proposal.v1'
  readonly proposalId: string
  readonly proposalKind: 'DirectorProposal' | 'VisualReviewProposal'
  readonly sceneId: string
  readonly shotId: string
  readonly workOrder: DirectorInferenceWorkOrder
  readonly methodPackage: ImagoDirectorReplayMethodResponse
  readonly execution: {
    readonly mode: 'deterministic_replay_fixture'
    readonly providerResult: false
    readonly networkUsed: false
    readonly providerCalls: 0
    readonly costAmountCny: '0'
  }
  readonly sourceTime: string
  readonly inputSha256: string
  readonly outputSha256: string
  readonly proposalSha256: string
  readonly items: readonly DirectorProposalItem[]
  readonly stale: boolean
  readonly staleReasons: readonly string[]
  readonly advisoryOnly: true
  readonly formalQcInferred: false
  readonly selectionGranted: false
  readonly readyGranted: false
  readonly humanDecisionInferred: false
}

/** Exact immutable coordinates used for a read-only pre-save freshness check. */
export interface DirectorProposalFreshnessRequest extends CreationScope {
  readonly sceneId: string
  readonly shotId: string
  readonly contextSnapshotSha256: string
  readonly methodPackageVersion: string
  readonly methodPackageSha256: string
  readonly workOrderId: string
  readonly workOrderSha256: string
  readonly promptSha256: string
  readonly proposalId: string
  readonly proposalSha256: string
  readonly outputSha256: string
}

/** Zero-cost freshness result; checking it never executes inference. */
export interface DirectorProposalFreshnessResult extends CreationScope {
  readonly schema: 'jason.qingmu-director-proposal-freshness.v1'
  readonly fresh: boolean
  readonly staleReasons: readonly string[]
  readonly binding: Omit<DirectorProposalFreshnessRequest, 'projectId' | 'episodeId'>
  readonly currentContextSnapshotSha256: string
  readonly freshnessSha256: string
  readonly providerCalls: 0
  readonly costAmountCny: '0'
  readonly businessStateChanged: false
  readonly humanDecisionInferred: false
  readonly formalQcInferred: false
  readonly selectionGranted: false
  readonly readyGranted: false
}

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
}

function directorJcsJson(
  value: unknown,
  field: string,
  fail: (message: string) => Error,
  depth = 0,
): string {
  if (depth > 100) throw fail(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw fail(`${field} contains invalid Unicode`)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    const rendered = JSON.stringify(value)
    if (!Number.isFinite(value)
      || (Number.isInteger(value) && !Number.isSafeInteger(value) && !/[eE]/.test(rendered))) {
      throw fail(`${field} contains an unsupported JCS number`)
    }
    return rendered
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => directorJcsJson(item, `${field}[${String(index)}]`, fail, depth + 1)).join(',')}]`
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    const keys = Object.keys(item)
    if (!keys.every(key => key.isWellFormed())) throw fail(`${field} contains an invalid key`)
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${directorJcsJson(item[key], `${field}.${key}`, fail, depth + 1)}`).join(',')}}`
  }
  throw fail(`${field} must be JCS JSON`)
}

const directorJcsSha256 = (
  value: unknown,
  field: string,
  fail: (message: string) => Error,
): string => createHash('sha256').update(directorJcsJson(value, field, fail), 'utf8').digest('hex')

const object = (value: unknown, fail: (message: string) => Error, field: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail(`${field} must be an object`)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], fail: (message: string) => Error, field: string): void => {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw fail(`${field} fields invalid`)
}
const text = (value: unknown, fail: (message: string) => Error, field: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw fail(`${field} invalid`)
  return value
}
const id = (value: unknown, fail: (message: string) => Error, field: string): string => {
  const result = text(value, fail, field)
  if (!/^[A-Za-z0-9_.:-]+$/.test(result) || result.length > 256) throw fail(`${field} invalid`)
  return result
}
const digest = (value: unknown, fail: (message: string) => Error, field: string): string => {
  const result = text(value, fail, field)
  if (!/^[a-f0-9]{64}$/.test(result)) throw fail(`${field} invalid`)
  return result
}
const zeroAuthority = (root: Record<string, unknown>, fail: (message: string) => Error, field: string): void => {
  if (root.providerCalls !== 0 || root.costAmountCny !== '0' || root.businessStateChanged !== false
    || root.humanDecisionInferred !== false || root.formalQcInferred !== false
    || root.selectionGranted !== false || root.readyGranted !== false) throw fail(`${field} authority mismatch`)
}

/**
 * Parse an exact browser request and reject any authority-bearing extra fields.
 * @param value Untrusted browser payload.
 * @param helpers Adapter error factories.
 * @returns A validated scene and shot scoped request.
 */
export function parseDirectorProposalRequest(value: unknown, helpers: Helpers): DirectorProposalRequest {
  const root = object(value, helpers.inputError, 'director proposal request')
  exact(root, ['projectId', 'episodeId', 'sceneId', 'shotId', 'suggestionType'], helpers.inputError, 'director proposal request')
  const suggestionType = root.suggestionType
  if (suggestionType !== 'text_director_proposal' && suggestionType !== 'visual_finding') {
    throw helpers.inputError('director suggestion type invalid')
  }
  return {
    projectId: id(root.projectId, helpers.inputError, 'projectId'),
    episodeId: id(root.episodeId, helpers.inputError, 'episodeId'),
    sceneId: id(root.sceneId, helpers.inputError, 'sceneId'),
    shotId: id(root.shotId, helpers.inputError, 'shotId'),
    suggestionType,
  }
}

/**
 * Validate the IMAGO replay method identity, authority flags and package SHA.
 * @param value Untrusted Host method response.
 * @param helpers Adapter error factories.
 * @returns The validated immutable method package.
 */
export function normalizeDirectorReplayMethod(value: unknown, helpers: Helpers): ImagoDirectorReplayMethodResponse {
  const root = object(value, helpers.responseError, 'director method')
  if (root.schema !== 'qingmu.imago-director-replay-method-package.v1'
    || root.version !== 'qingmu.director-replay.v1') throw helpers.responseError('director method identity mismatch')
  digest(root.methodPackageSha256, helpers.responseError, 'director method SHA')
  const authority = object(root.authority, helpers.responseError, 'director method authority')
  if (authority.businessTruth !== 'yimeng' || authority.methodSource !== 'imago_os'
    || authority.inferenceHost !== 'harness_dsh' || authority.replayOnly !== true
    || authority.providerCalls !== 0 || authority.maximumCostCny !== '0'
    || authority.humanDecisionInferred !== false || authority.formalQcInferred !== false
    || authority.selectionGranted !== false || authority.readyGranted !== false) {
    throw helpers.responseError('director method authority mismatch')
  }
  const methodBody = { ...root }
  Reflect.deleteProperty(methodBody, 'methodPackageSha256')
  if (directorJcsSha256(methodBody, 'director method', helpers.responseError) !== root.methodPackageSha256) {
    throw helpers.responseError('director method SHA mismatch')
  }
  return value as ImagoDirectorReplayMethodResponse
}

/**
 * Validate a Yimeng context snapshot against the requested object scope and SHA.
 * @param value Untrusted Yimeng response.
 * @param expected Requested project, episode, scene and shot scope.
 * @param helpers Adapter error factories.
 * @returns A validated SHA-bound director context.
 */
export function normalizeDirectorContext(
  value: unknown,
  expected: DirectorProposalRequest,
  helpers: Helpers,
): DirectorContextSnapshot {
  const root = object(value, helpers.responseError, 'director context')
  exact(root, ['schema', 'projectId', 'episodeId', 'sceneId', 'shotId', 'script', 'sceneSource', 'sourceScene',
    'storyboard', 'shot', 'selectedReferences', 'sourceTime', 'contextSnapshotSha256', 'providerCalls',
    'costAmountCny', 'businessStateChanged', 'humanDecisionInferred', 'formalQcInferred', 'selectionGranted',
    'readyGranted'], helpers.responseError, 'director context')
  if (root.schema !== 'jason.qingmu-director-context-snapshot.v1'
    || root.projectId !== expected.projectId || root.episodeId !== expected.episodeId
    || root.sceneId !== expected.sceneId || root.shotId !== expected.shotId) {
    throw helpers.responseError('director context scope mismatch')
  }
  zeroAuthority(root, helpers.responseError, 'director context')
  digest(root.contextSnapshotSha256, helpers.responseError, 'director context SHA')
  const contextBody = { ...root }
  Reflect.deleteProperty(contextBody, 'contextSnapshotSha256')
  if (directorJcsSha256(contextBody, 'director context', helpers.responseError) !== root.contextSnapshotSha256) {
    throw helpers.responseError('director context SHA mismatch')
  }
  const shot = object(root.shot, helpers.responseError, 'director shot')
  if (shot.id !== expected.shotId) throw helpers.responseError('director shot identity mismatch')
  for (const field of ['title', 'narrative', 'visual', 'action']) {
    if (typeof shot[field] !== 'string') throw helpers.responseError(`director shot ${field} invalid`)
  }
  if (typeof shot.durationSec !== 'number' || !Number.isFinite(shot.durationSec)) {
    throw helpers.responseError('director shot duration invalid')
  }
  if (!Array.isArray(shot.dialogueLineIds) || !Array.isArray(root.selectedReferences)) {
    throw helpers.responseError('director context arrays invalid')
  }
  return value as DirectorContextSnapshot
}

/**
 * Build the content-addressed zero-budget work-order request sent to Yimeng.
 * @param request Validated proposal scope.
 * @param context Current Yimeng context snapshot.
 * @param method Current IMAGO method package.
 * @param helpers Adapter error factories.
 * @returns An exact replay work-order request with deterministic idempotency key.
 */
export function directorWorkOrderRequest(
  request: DirectorProposalRequest,
  context: DirectorContextSnapshot,
  method: ImagoDirectorReplayMethodResponse,
  helpers: Helpers,
): Record<string, unknown> {
  const suggestion = method.suggestionTypes[request.suggestionType]
  const identity = {
    sceneId: request.sceneId,
    shotId: request.shotId,
    purpose: 'bounded_director_suggestion',
    suggestionType: request.suggestionType,
    methodCapability: suggestion.capability,
    outputSchema: suggestion.outputSchema,
    methodPackageVersion: method.version,
    methodPackageSha256: method.methodPackageSha256,
    expectedContextSnapshotSha256: context.contextSnapshotSha256,
  }
  return { ...identity, idempotencyKey: directorJcsSha256(identity, 'director work order identity', helpers.inputError) }
}

/**
 * Validate the returned replay work order and its source/method lineage.
 * @param value Untrusted Yimeng response.
 * @param request Validated proposal scope.
 * @param context Context bound to the work order.
 * @param method Method package bound to the work order.
 * @param helpers Adapter error factories.
 * @returns A validated zero-authority replay work order.
 */
export function normalizeDirectorWorkOrder(
  value: unknown,
  request: DirectorProposalRequest,
  context: DirectorContextSnapshot,
  method: ImagoDirectorReplayMethodResponse,
  helpers: Helpers,
): DirectorInferenceWorkOrder {
  const root = object(value, helpers.responseError, 'director work order')
  if (root.schema !== 'jason.qingmu-director-inference-work-order.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.sceneId !== request.sceneId || root.shotId !== request.shotId
    || root.purpose !== 'bounded_director_suggestion' || root.suggestionType !== request.suggestionType
    || root.methodCapability !== method.suggestionTypes[request.suggestionType].capability
    || root.outputSchema !== method.suggestionTypes[request.suggestionType].outputSchema
    || root.executionProfile !== 'deterministic_replay_fixture_v1'
    || root.inputSha256 !== context.contextSnapshotSha256) {
    throw helpers.responseError('director work order lineage mismatch')
  }
  zeroAuthority(root, helpers.responseError, 'director work order')
  digest(root.promptSha256, helpers.responseError, 'director work order prompt SHA')
  digest(root.workOrderSha256, helpers.responseError, 'director work order SHA')
  const workOrderBody = { ...root }
  Reflect.deleteProperty(workOrderBody, 'workOrderSha256')
  if (directorJcsSha256(workOrderBody, 'director work order', helpers.responseError) !== root.workOrderSha256) {
    throw helpers.responseError('director work order SHA mismatch')
  }
  const budget = object(root.budget, helpers.responseError, 'director work order budget')
  if (budget.mode !== 'replay' || budget.currency !== 'CNY' || budget.maximumAmount !== '0' || budget.providerCalls !== 0) {
    throw helpers.responseError('director work order budget mismatch')
  }
  const methodPackage = object(root.methodPackage, helpers.responseError, 'director work order method')
  if (methodPackage.version !== method.version || methodPackage.sha256 !== method.methodPackageSha256) {
    throw helpers.responseError('director work order method mismatch')
  }
  return value as DirectorInferenceWorkOrder
}

/**
 * Build a deterministic advisory proposal and mark any post-read drift stale.
 * @param request Validated proposal scope.
 * @param context Context used as replay input.
 * @param freshContext Context reread after work-order issuance.
 * @param workOrder Yimeng-issued replay work order.
 * @param method IMAGO method package.
 * @param helpers Adapter error factories.
 * @returns A proposal that never grants quality, selection, readiness or human authority.
 */
export function buildDirectorReplayProposal(
  request: DirectorProposalRequest,
  context: DirectorContextSnapshot,
  freshContext: DirectorContextSnapshot,
  workOrder: DirectorInferenceWorkOrder,
  method: ImagoDirectorReplayMethodResponse,
  helpers: Helpers,
): DirectorReplayProposal {
  const shot = context.shot
  const textProposal = request.suggestionType === 'text_director_proposal'
  const narrativeProposal = shot.narrative.length === 0
    ? '明确本镜的叙事推进与情绪落点。'
    : shot.narrative.includes('明确本镜情绪落点') ? shot.narrative : `${shot.narrative}；明确本镜情绪落点。`
  const visualProposal = shot.visual.length === 0
    ? '补充主体、景别与空间层级。'
    : shot.visual.includes('保持主体层级清楚') ? shot.visual : `${shot.visual}；保持主体层级清楚。`
  const items: DirectorProposalItem[] = textProposal ? [
    {
      id: 'narrative-focus', field: 'narrative', originalValue: shot.narrative,
      proposedValue: narrativeProposal,
      impact: '只修改当前镜头的叙事目的；采用后仍需人工预览并保存规划。',
    },
    {
      id: 'visual-focus', field: 'visual', originalValue: shot.visual,
      proposedValue: visualProposal,
      impact: '只修改当前镜头的画面描述；不创建 PromptIR、媒体或正式质检。',
    },
  ] : [{
    id: 'visual-review-finding', field: 'visual', originalValue: shot.visual,
    proposedValue: shot.visual,
    impact: context.selectedReferences.length === 0
      ? 'replay 未读取像素，当前也没有已选参考；仅提示视觉复核前置缺口。'
      : 'replay 未读取像素；真实 Vision canary 前不得把此项当作正式一致性结论。',
  }]
  const stale = freshContext.contextSnapshotSha256 !== context.contextSnapshotSha256
    || method.methodPackageSha256 !== workOrder.methodPackage.sha256
  const body = {
    schema: 'qingmu.director-replay-proposal.v1' as const,
    proposalKind: textProposal ? 'DirectorProposal' as const : 'VisualReviewProposal' as const,
    projectId: request.projectId,
    episodeId: request.episodeId,
    sceneId: request.sceneId,
    shotId: request.shotId,
    workOrder,
    methodPackage: method,
    execution: {
      mode: 'deterministic_replay_fixture' as const,
      providerResult: false as const,
      networkUsed: false as const,
      providerCalls: 0 as const,
      costAmountCny: '0' as const,
    },
    sourceTime: context.sourceTime,
    inputSha256: context.contextSnapshotSha256,
    items,
    stale,
    staleReasons: stale ? ['director_context_or_method_changed'] : [],
    advisoryOnly: true as const,
    formalQcInferred: false as const,
    selectionGranted: false as const,
    readyGranted: false as const,
    humanDecisionInferred: false as const,
  }
  const outputSha256 = directorJcsSha256(items, 'director proposal output', helpers.responseError)
  const proposalIdentity = { ...body, outputSha256 }
  const proposalSha256 = directorJcsSha256(proposalIdentity, 'director proposal', helpers.responseError)
  return { ...proposalIdentity, proposalId: `director_proposal_${proposalSha256.slice(0, 32)}`, proposalSha256 }
}

/**
 * Parse the exact immutable proposal coordinates used by the pre-save freshness check.
 * @param value Untrusted Host request payload.
 * @param helpers Adapter-specific validation error constructors.
 * @returns Validated immutable freshness coordinates.
 */
export function parseDirectorProposalFreshnessRequest(
  value: unknown,
  helpers: Helpers,
): DirectorProposalFreshnessRequest {
  const root = object(value, helpers.inputError, 'director proposal freshness request')
  const keys = ['projectId', 'episodeId', 'sceneId', 'shotId', 'contextSnapshotSha256',
    'methodPackageVersion', 'methodPackageSha256', 'workOrderId', 'workOrderSha256',
    'promptSha256', 'proposalId', 'proposalSha256', 'outputSha256'] as const
  exact(root, keys, helpers.inputError, 'director proposal freshness request')
  return {
    projectId: id(root.projectId, helpers.inputError, 'projectId'),
    episodeId: id(root.episodeId, helpers.inputError, 'episodeId'),
    sceneId: id(root.sceneId, helpers.inputError, 'sceneId'),
    shotId: id(root.shotId, helpers.inputError, 'shotId'),
    contextSnapshotSha256: digest(root.contextSnapshotSha256, helpers.inputError, 'contextSnapshotSha256'),
    methodPackageVersion: id(root.methodPackageVersion, helpers.inputError, 'methodPackageVersion'),
    methodPackageSha256: digest(root.methodPackageSha256, helpers.inputError, 'methodPackageSha256'),
    workOrderId: id(root.workOrderId, helpers.inputError, 'workOrderId'),
    workOrderSha256: digest(root.workOrderSha256, helpers.inputError, 'workOrderSha256'),
    promptSha256: digest(root.promptSha256, helpers.inputError, 'promptSha256'),
    proposalId: id(root.proposalId, helpers.inputError, 'proposalId'),
    proposalSha256: digest(root.proposalSha256, helpers.inputError, 'proposalSha256'),
    outputSha256: digest(root.outputSha256, helpers.inputError, 'outputSha256'),
  }
}

/**
 * Validate a read-only freshness response and every echoed source coordinate.
 * @param value Untrusted Writer response payload.
 * @param request Original immutable freshness coordinates.
 * @param helpers Adapter-specific validation error constructors.
 * @returns Validated freshness result bound to the original request.
 */
export function normalizeDirectorProposalFreshness(
  value: unknown,
  request: DirectorProposalFreshnessRequest,
  helpers: Helpers,
): DirectorProposalFreshnessResult {
  const root = object(value, helpers.responseError, 'director proposal freshness')
  if (root.schema !== 'jason.qingmu-director-proposal-freshness.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || typeof root.fresh !== 'boolean' || !Array.isArray(root.staleReasons)) {
    throw helpers.responseError('director proposal freshness identity mismatch')
  }
  zeroAuthority(root, helpers.responseError, 'director proposal freshness')
  const binding = object(root.binding, helpers.responseError, 'director proposal freshness binding')
  const expectedBinding = { ...request } as Record<string, unknown>
  Reflect.deleteProperty(expectedBinding, 'projectId')
  Reflect.deleteProperty(expectedBinding, 'episodeId')
  if (directorJcsJson(binding, 'director proposal freshness binding', helpers.responseError)
    !== directorJcsJson(expectedBinding, 'expected director proposal freshness binding', helpers.responseError)) {
    throw helpers.responseError('director proposal freshness binding mismatch')
  }
  digest(root.currentContextSnapshotSha256, helpers.responseError, 'currentContextSnapshotSha256')
  digest(root.freshnessSha256, helpers.responseError, 'freshnessSha256')
  const body = { ...root }
  Reflect.deleteProperty(body, 'freshnessSha256')
  if (directorJcsSha256(body, 'director proposal freshness', helpers.responseError) !== root.freshnessSha256) {
    throw helpers.responseError('director proposal freshness SHA mismatch')
  }
  return value as DirectorProposalFreshnessResult
}
