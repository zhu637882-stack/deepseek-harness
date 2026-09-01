/** Runtime validation and canonical identities for Qingmu project-context events. */

import { createHash } from 'node:crypto'
import type {
  QingmuDirectorProposalReceipt,
  QingmuProjectContextBinding,
  QingmuProjectContextState,
  QingmuZeroAuthority,
} from './types.ts'

const SHA256 = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const STALE_REASONS = new Set([
  'episode_revision_changed',
  'storyboard_revision_changed',
  'storyboard_revision_version_changed',
  'scene_profile_revision_changed',
  'storyboard_source_changed',
  'scene_snapshot_changed',
  'shot_snapshot_changed',
  'scene_missing',
  'shot_missing',
  'shot_scene_changed',
  'shot_snapshot_missing_or_invalid',
  'source_projection_invalid',
  'workflow_subject_changed',
  'binding_changed_during_suggestion',
])

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/**
 * Hash one lossless JSON value using the package's stable key ordering.
 * @param value - JSON-compatible value whose object keys will be sorted.
 * @returns lowercase SHA-256 digest.
 */
export const sha256 = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex')

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exactRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  const candidate = record(value, field)
  const expected = new Set(keys)
  if (Object.keys(candidate).some(key => !expected.has(key))
    || keys.some(key => !Object.hasOwn(candidate, key))) {
    throw new Error(`${field} must contain only the declared fields`)
  }
  return candidate
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${field} is not a SHA-256 identity`)
  return value
}

function assertZeroAuthority(value: unknown): asserts value is QingmuZeroAuthority {
  const authority = exactRecord(value, [
    'advisoryOnly',
    'proposedChangeSetOnly',
    'providerCalls',
    'maximumCostCny',
    'businessWrites',
    'budgetWrites',
    'approvalWrites',
    'humanSignoff',
    'autoSave',
    'autoApprove',
    'submitGeneration',
  ], 'authority')
  if (authority.advisoryOnly !== true
    || authority.proposedChangeSetOnly !== true
    || authority.providerCalls !== 0
    || authority.maximumCostCny !== '0'
    || authority.businessWrites !== 0
    || authority.budgetWrites !== 0
    || authority.approvalWrites !== 0
    || authority.humanSignoff !== false
    || authority.autoSave !== false
    || authority.autoApprove !== false
    || authority.submitGeneration !== false) {
    throw new Error('authority is not zero-authority advisory-only')
  }
}

/**
 * Validate a complete binding and recompute its context snapshot identity.
 * @param value - untrusted binding candidate from a live workflow or replayed event.
 * @returns a TypeScript assertion that the candidate is an exact binding.
 */
export function assertProjectContextBinding(value: unknown): asserts value is QingmuProjectContextBinding {
  const binding = exactRecord(value, [
    'schema', 'projectId', 'episodeId', 'sceneId', 'shotId', 'revision', 'sha256',
  ], 'binding')
  if (binding.schema !== 'qingmu.project-context-binding.v1') throw new Error('binding schema is invalid')
  const revision = exactRecord(binding.revision, [
    'episodeRevision', 'storyboardRevisionId', 'storyboardRevisionVersion', 'sceneProfileRevision',
  ], 'binding.revision')
  const sha = exactRecord(binding.sha256, [
    'storyboardSource', 'sceneSnapshot', 'shotSnapshot', 'contextSnapshot',
  ], 'binding.sha256')
  const body = {
    schema: binding.schema,
    projectId: identifier(binding.projectId, 'binding.projectId'),
    episodeId: identifier(binding.episodeId, 'binding.episodeId'),
    sceneId: identifier(binding.sceneId, 'binding.sceneId'),
    shotId: identifier(binding.shotId, 'binding.shotId'),
    revision: {
      episodeRevision: nonNegativeInteger(revision.episodeRevision, 'binding.revision.episodeRevision'),
      storyboardRevisionId: identifier(revision.storyboardRevisionId, 'binding.revision.storyboardRevisionId'),
      storyboardRevisionVersion: nonNegativeInteger(revision.storyboardRevisionVersion, 'binding.revision.storyboardRevisionVersion'),
      sceneProfileRevision: nonNegativeInteger(revision.sceneProfileRevision, 'binding.revision.sceneProfileRevision'),
    },
    sha256: {
      storyboardSource: digest(sha.storyboardSource, 'binding.sha256.storyboardSource'),
      sceneSnapshot: digest(sha.sceneSnapshot, 'binding.sha256.sceneSnapshot'),
      shotSnapshot: digest(sha.shotSnapshot, 'binding.sha256.shotSnapshot'),
    },
  }
  const contextSnapshot = digest(sha.contextSnapshot, 'binding.sha256.contextSnapshot')
  if (contextSnapshot !== sha256(body)) throw new Error('binding context snapshot does not match its coordinates and revisions')
}

/**
 * Validate one whole-value current/stale event payload.
 * @param value - untrusted project-context event data.
 * @returns validated current or stale state.
 */
export function projectContextStateFromEvent(value: unknown): QingmuProjectContextState {
  const event = exactRecord(value, ['version', 'state'], 'project-context event')
  if (event.version !== 1) throw new Error('project-context event version must be 1')
  const state = exactRecord(event.state, ['status', 'binding', 'staleReasons'], 'project-context state')
  if (state.status !== 'current' && state.status !== 'stale') throw new Error('project-context status is invalid')
  if (!Array.isArray(state.staleReasons)
    || state.staleReasons.some(reason => typeof reason !== 'string' || !STALE_REASONS.has(reason))
    || new Set(state.staleReasons).size !== state.staleReasons.length) {
    throw new Error('project-context stale reasons are invalid')
  }
  if (state.status === 'current' && state.staleReasons.length !== 0) throw new Error('current project context cannot carry stale reasons')
  if (state.status === 'stale' && state.staleReasons.length === 0) throw new Error('stale project context must name at least one drift reason')
  assertProjectContextBinding(state.binding)
  return state as unknown as QingmuProjectContextState
}

/**
 * Validate a proposal receipt against the exact current binding preceding it.
 * @param value - untrusted receipt event data.
 * @param state - binding state folded immediately before this receipt.
 * @returns a TypeScript assertion that the receipt is valid and binding-relative.
 */
export function assertProposalReceipt(
  value: unknown,
  state: QingmuProjectContextState | null,
): asserts value is QingmuDirectorProposalReceipt {
  const receipt = exactRecord(value, [
    'schema',
    'projectId',
    'episodeId',
    'sceneId',
    'shotId',
    'suggestionType',
    'bindingSha256',
    'methodPackageSha256',
    'proposalSha256',
    'authority',
  ], 'director proposal receipt')
  if (state === null || state.status !== 'current') throw new Error('director proposal receipt has no current binding')
  if (receipt.schema !== 'qingmu.director-proposal-receipt.v1') throw new Error('director proposal receipt schema is invalid')
  if (receipt.suggestionType !== 'text_director_proposal' && receipt.suggestionType !== 'visual_finding') {
    throw new Error('director proposal receipt type is invalid')
  }
  const coordinates = {
    projectId: identifier(receipt.projectId, 'receipt.projectId'),
    episodeId: identifier(receipt.episodeId, 'receipt.episodeId'),
    sceneId: identifier(receipt.sceneId, 'receipt.sceneId'),
    shotId: identifier(receipt.shotId, 'receipt.shotId'),
  }
  if (coordinates.projectId !== state.binding.projectId
    || coordinates.episodeId !== state.binding.episodeId
    || coordinates.sceneId !== state.binding.sceneId
    || coordinates.shotId !== state.binding.shotId
    || digest(receipt.bindingSha256, 'receipt.bindingSha256') !== state.binding.sha256.contextSnapshot) {
    throw new Error('director proposal receipt does not match the current binding')
  }
  digest(receipt.methodPackageSha256, 'receipt.methodPackageSha256')
  digest(receipt.proposalSha256, 'receipt.proposalSha256')
  assertZeroAuthority(receipt.authority)
}
