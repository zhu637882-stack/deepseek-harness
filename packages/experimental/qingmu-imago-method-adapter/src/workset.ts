/** Read-only workset input and source bindings; IMAGO owns definitions and ordering. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  ImagoMethodJsonObject,
  ImagoWorksetMethodRequest,
  ImagoWorksetMethodSnapshot,
  ImagoWorksetProjection,
} from './types.ts'

/** Fixed files the Host verifies independently of compiler-supplied paths. */
export const WORKSET_RULE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/workflow-spec.v6.production-beta.json',
  'scripts/compile_qingmu_imago_workset.py',
  'scripts/compile_qingmu_imago_workset_v2.py',
  'scripts/imago_v6_draft_ctl.py',
] as const

/** Invalid browser request, reported through the existing bad-request RPC result. */
export class WorksetInputError extends Error {}

/** Invalid upstream or compiler evidence, never a fallback to inferred approval. */
export class WorksetContractError extends Error {}

function object(value: unknown): value is ImagoMethodJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new WorksetInputError(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 256 || /[\u0000\r\n]/.test(normalized)) {
    throw new WorksetInputError(`${field} must be a safe identifier from 1 to 256 characters`)
  }
  return normalized
}

/**
 * Reject browser-supplied workflow, rule, approval, or command fields.
 * @param payload - decoded browser JSON.
 * @returns the exact project and episode subject to read in the Host.
 */
export function parseWorksetMethodRequest(payload: unknown): ImagoWorksetMethodRequest {
  if (!object(payload) || Object.keys(payload).length !== 2
    || !Object.hasOwn(payload, 'projectId') || !Object.hasOwn(payload, 'episodeId')) {
    throw new WorksetInputError('worksetMethod accepts only projectId and episodeId')
  }
  return {
    projectId: identifier(payload.projectId, 'projectId'),
    episodeId: identifier(payload.episodeId, 'episodeId'),
  }
}

/**
 * Bind all normalized workflow JSON while declining unsupported Stage/LSU authority.
 * @param request - exact episode subject requested by the browser.
 * @param workflow - fresh result from the configured Yimeng read adapter.
 * @param serialize - bounded deterministic JSON serializer shared with the Host compiler.
 * @returns the non-executing compiler input; unknown workflow fields confer no authority.
 */
export function buildWorksetSnapshot(
  request: ImagoWorksetMethodRequest,
  workflow: unknown,
  serialize: (value: unknown, field: string) => string,
): ImagoWorksetMethodSnapshot {
  if (!object(workflow) || workflow.schema !== 'jason.episode-workflow-projection.v1'
    || workflow.projectId !== request.projectId || workflow.episodeId !== request.episodeId
    || !object(workflow.sourceRevision)
    || typeof workflow.inputFingerprint !== 'string' || workflow.inputFingerprint.length === 0) {
    throw new WorksetContractError('workflow source or episode subject is invalid')
  }
  return {
    schema: 'qingmu.imago-workset-snapshot.v2',
    subject: {
      project_id: request.projectId,
      episode_id: request.episodeId,
      source_revision_sha256: createHash('sha256')
        .update(serialize(workflow.sourceRevision, 'workflow.sourceRevision'), 'utf8').digest('hex'),
      input_fingerprint: workflow.inputFingerprint,
      projection_schema: 'jason.episode-workflow-projection.v1',
    },
    source_projection_sha256: createHash('sha256')
      .update(serialize(workflow, 'workflow'), 'utf8').digest('hex'),
    authority_snapshot: {
      status: 'unavailable',
      reason: 'authoritative_stage_evidence_unavailable',
    },
  }
}

/**
 * Read the seven fixed local rule sources without trusting paths in compiler output.
 * @param coreRoot - resolved absolute Core deployment root.
 * @returns source SHA-256 values keyed by the fixed repository-relative paths.
 */
export async function readWorksetRuleHashes(coreRoot: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(WORKSET_RULE_PATHS.map(async path => [
    path,
    createHash('sha256').update(await readFile(join(coreRoot, path))).digest('hex'),
  ] as const)))
}

function exactKeys(value: unknown, keys: readonly string[], field: string): asserts value is ImagoMethodJsonObject {
  if (!object(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new WorksetContractError(`${field} keys are invalid`)
  }
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\u0000\r\n]/.test(value)
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length
}

/**
 * Verify compiler bindings and the current unavailable-authority boundary.
 * @param value - decoded local compiler stdout.
 * @param snapshot - Host-built input sent to that compiler.
 * @param ruleHashes - independently read hashes of the seven fixed local files.
 * @param serialize - the exact deterministic serializer used on compiler stdin.
 * @returns definitions and explicit unavailability, never inferred stage instances.
 */
export function normalizeWorksetProjection(
  value: unknown,
  snapshot: ImagoWorksetMethodSnapshot,
  ruleHashes: Readonly<Record<string, string>>,
  serialize: (value: unknown, field: string) => string,
): ImagoWorksetProjection {
  exactKeys(value, [
    'schema', 'subject', 'source_projection_sha256', 'input_snapshot_sha256', 'rule_bindings',
    'rules_sha256', 'stage_definitions', 'work_items', 'legal_work_items', 'recommended_order',
    'recommended_item', 'availability', 'blockers', 'shadow_comparison', 'project_state_persisted',
    'paid_provider_authority', 'human_approval_inferred', 'authority_snapshot_attestation',
    'formal_activation_allowed',
  ], 'projection')
  const digest = (input: unknown, field: string): string => createHash('sha256')
    .update(serialize(input, field), 'utf8').digest('hex')
  if (value.schema !== 'qingmu.imago-workset.v2'
    || !isDeepStrictEqual(value.subject, snapshot.subject)
    || value.source_projection_sha256 !== snapshot.source_projection_sha256
    || value.input_snapshot_sha256 !== digest(snapshot, 'snapshot')
    || !isDeepStrictEqual(value.rule_bindings, ruleHashes)
    || value.rules_sha256 !== digest(ruleHashes, 'rule_bindings')) {
    throw new WorksetContractError('projection input, subject, or local rule binding mismatch')
  }
  if (!Array.isArray(value.stage_definitions) || value.stage_definitions.length === 0) {
    throw new WorksetContractError('projection stage definitions are missing')
  }
  const stageIds = new Set<string>()
  for (const definition of value.stage_definitions) {
    exactKeys(definition, [
      'stage_id', 'stage_name', 'scope', 'owner_role', 'source_stage_ids', 'required_lock_ids',
      'produces_lock_id', 'contract_order', 'contract_sha256',
    ], 'stage definition')
    if (!text(definition.stage_id) || stageIds.has(definition.stage_id)
      || !text(definition.stage_name) || !text(definition.owner_role)
      || (definition.scope !== 'global' && definition.scope !== 'per_lsu')
      || !stringList(definition.source_stage_ids) || !stringList(definition.required_lock_ids)
      || (definition.produces_lock_id !== null && !text(definition.produces_lock_id))
      || typeof definition.contract_order !== 'number'
      || !Number.isSafeInteger(definition.contract_order) || definition.contract_order < 0
      || typeof definition.contract_sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(definition.contract_sha256)) {
      throw new WorksetContractError('projection stage definition is invalid')
    }
    stageIds.add(definition.stage_id)
  }
  // No named Stage/LSU evidence is exported by the current business read contract.
  // Do not turn this into a synthetic first-stage task or an empty approved plan.
  if (!isDeepStrictEqual(value.work_items, []) || !isDeepStrictEqual(value.legal_work_items, [])
    || !isDeepStrictEqual(value.recommended_order, []) || value.recommended_item !== null
    || !isDeepStrictEqual(value.availability, {
      status: 'unavailable',
      authority_snapshot: 'unavailable',
      global_scope: 'unavailable',
      per_lsu_scope: 'unavailable',
      reason: 'authoritative_stage_evidence_unavailable',
    })
    || !isDeepStrictEqual(value.blockers, [{
      code: 'AUTHORITATIVE_STAGE_EVIDENCE_UNAVAILABLE',
      stage_id: null,
      scope_instance: null,
      lock_id: null,
    }])
    || !isDeepStrictEqual(value.shadow_comparison, {
      status: 'unavailable',
      reason: 'authoritative_stage_evidence_unavailable',
      comparison_scope: 'dependency_and_lock_readiness_only',
      activation_allowed: false,
      execution_equivalence_claimed: false,
      comparisons: [],
    })
    || value.project_state_persisted !== false || value.paid_provider_authority !== 'not_granted'
    || value.human_approval_inferred !== false
    || value.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || value.formal_activation_allowed !== false) {
    throw new WorksetContractError('projection unavailable-authority or execution boundary mismatch')
  }
  return value as ImagoWorksetProjection
}
