/** Current stateless E7-3 technical-QC method compiled from fresh Yimeng evidence. */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type {
  ImagoTakeTechnicalQcMethodDefinition,
  ImagoTakeTechnicalQcMethodProjection,
  ImagoTakeTechnicalQcMethodRequest,
  ImagoTakeTechnicalQcMethodResponse,
  ImagoTakeTechnicalQcMethodSnapshot,
} from './types.ts'
import {
  buildTakeAcceptanceSnapshot,
  takeAcceptanceJcsJson,
  TakeAcceptanceContractError,
  TakeAcceptanceInputError,
} from './take-acceptance.ts'

type CanonicalSerialize = (value: unknown, field: string) => string

/** Exact source list emitted by the Core compiler, including both imported compiler dependencies. */
export const TAKE_TECHNICAL_QC_RULE_PATHS = [
  'pipeline/v6-video-generation-routing-policy.json',
  'pipeline/v6-video-reference-integrity-overlay-policy.json',
  'pipeline/v6-lsuqc-provider-neutral-review-policy.json',
  'pipeline/v6-lsuqc-completion-routing-policy.json',
  'scripts/compile_qingmu_element_method.py',
  'scripts/compile_qingmu_take_acceptance_method.py',
  'scripts/compile_qingmu_take_qc_method.py',
] as const

/**
 * Machine-readable macro-level Take technical-QC codes.
 */
export const TAKE_TECHNICAL_QC_MACRO_CODES = [
  'STORY_CAUSALITY', 'SHOT_ORDER', 'PACING', 'LOOK', 'ENDING_CHOICE',
] as const
/**
 * Machine-readable micro-level Take technical-QC codes.
 */
export const TAKE_TECHNICAL_QC_MICRO_CODES = [
  'IDENTITY', 'PROP_GEOMETRY', 'TOPOLOGY', 'EXACT_COUNT', 'CONTACT_TRANSFER',
  'LOCKED_DIALOGUE', 'TECHNICAL_RECEIPT',
] as const
const RESULTS = ['PASS', 'FAIL', 'UNVERIFIED'] as const

/** Browser supplied more than the three identity coordinates. */
export class TakeTechnicalQcInputError extends TakeAcceptanceInputError {}
/** Evidence, source rules, or compiler output failed closed. */
export class TakeTechnicalQcContractError extends TakeAcceptanceContractError {}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TakeTechnicalQcContractError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  const result = object(value, field)
  if (!isDeepStrictEqual(Object.keys(result).sort(), [...fields].sort())) {
    throw new TakeTechnicalQcContractError(`${field} contains unexpected fields`)
  }
  return result
}

function sha256(value: unknown, serialize: CanonicalSerialize, field: string): string {
  return createHash('sha256').update(serialize(value, field), 'utf8').digest('hex')
}

/**
 * Accept only coordinates; acceptance evidence is always reread through the Host.
 * @param payload - Untrusted command payload to validate.
 * @returns Validated ImagoTakeTechnicalQcMethodRequest value.
 */
export function parseTakeTechnicalQcMethodRequest(payload: unknown): ImagoTakeTechnicalQcMethodRequest {
  try {
    const request = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
    const valid = (value: unknown) => typeof value === 'string' && value.isWellFormed()
      && value === value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
      && value !== '' && Array.from(value).length <= 256 && !/[\u0000\r\n]/u.test(value)
    if (!valid(request.projectId) || !valid(request.episodeId) || !valid(request.frameId)) {
      throw new TakeTechnicalQcInputError()
    }
    return {
      projectId: request.projectId as string,
      episodeId: request.episodeId as string,
      frameId: request.frameId as string,
    }
  } catch {
    throw new TakeTechnicalQcInputError(
      'takeTechnicalQcMethod accepts only projectId, episodeId, and frameId',
    )
  }
}

/**
 * Build the exact Core snapshot after reusing the fully strict E6-5 evidence validator.
 * @param request - Request coordinates and payload to process.
 * @param source - Rule source path to read.
 * @returns Resulting ImagoTakeTechnicalQcMethodSnapshot value.
 */
export function buildTakeTechnicalQcSnapshot(
  request: ImagoTakeTechnicalQcMethodRequest,
  source: unknown,
): ImagoTakeTechnicalQcMethodSnapshot {
  const acceptance = buildTakeAcceptanceSnapshot(request, source)
  return {
    schema: 'qingmu.take-technical-qc-method-snapshot.v1',
    evidence: acceptance.evidence,
    evidenceSnapshotSha256: acceptance.evidenceSnapshotSha256,
  }
}

function definition(): ImagoTakeTechnicalQcMethodDefinition {
  return {
    mode: 'STATELESS_TECHNICAL_QC_METHOD',
    catalog: {
      macro: { layer: 'MACRO_QC', codes: TAKE_TECHNICAL_QC_MACRO_CODES },
      micro: { layer: 'MICRO_QC', codes: TAKE_TECHNICAL_QC_MICRO_CODES },
    },
    resultOptions: RESULTS,
    allCodesExactlyOnce: true,
    nonPassRequires: { note: true, evidenceRefs: true },
    unverifiedIsNotPass: true,
    technicalReceipt: {
      code: 'TECHNICAL_RECEIPT', machineEvidencePassRequiredForCheckPass: true,
      machineEvidencePassRequiredForOverallPass: true,
    },
    boundaries: {
      businessTruth: 'yimeng', technicalQcOnly: true,
      technicalPassIsContentApproval: false, selectionChanged: false,
      recommendationChanged: false, decisionRecorded: false, formalApprovalChanged: false,
      episodeVerificationChanged: false, humanSignoffInferred: false,
      providerCalls: 0, budgetMutation: false, approvalInvalidationAllowed: false,
      reworkExecutionAllowed: false, evidenceLedgerMutation: false,
    },
  }
}

/** Independently reconstructed current Core rules and their exact byte hashes. */
export interface TakeTechnicalQcRules {
  readonly hashes: Readonly<Record<string, string>>
  readonly definition: ImagoTakeTechnicalQcMethodDefinition
  readonly rulesSha256: string
}

/**
 * Read all fixed sources and fail closed if the live policies no longer express the E7-3 contract.
 * @param coreRoot - IMAGO Core root containing the current machine rules.
 * @param serialize - Canonical serializer used for SHA-bound input.
 * @returns Stored recovery marker state, including stale or absent results.
 */
export async function readTakeTechnicalQcRules(
  coreRoot: string,
  serialize: CanonicalSerialize,
): Promise<TakeTechnicalQcRules> {
  const sources = new Map(await Promise.all(TAKE_TECHNICAL_QC_RULE_PATHS.map(async path =>
    [path, await readFile(join(coreRoot, path))] as const)))
  const json = (path: typeof TAKE_TECHNICAL_QC_RULE_PATHS[number]) => {
    const raw = sources.get(path)
    if (raw === undefined) throw new TakeTechnicalQcContractError(`missing rule source ${path}`)
    try { return object(JSON.parse(raw.toString('utf8')) as unknown, path) } catch {
      throw new TakeTechnicalQcContractError(`invalid rule JSON ${path}`)
    }
  }
  const routing = json('pipeline/v6-video-generation-routing-policy.json')
  const principles = object(routing.principles, 'routing.principles')
  const post = object(routing.post_generation_acceptance, 'routing.post_generation_acceptance')
  const activation = object(routing.activation, 'routing.activation')
  const overlay = json('pipeline/v6-video-reference-integrity-overlay-policy.json')
  const layers = object(overlay.qc_layer_contract, 'overlay.qc_layer_contract')
  const review = json('pipeline/v6-lsuqc-provider-neutral-review-policy.json')
  const reviewActivation = object(review.activation, 'review.activation')
  const inspection = object(review.inspection_contract, 'review.inspection_contract')
  const decision = object(review.decision_contract, 'review.decision_contract')
  const completion = json('pipeline/v6-lsuqc-completion-routing-policy.json')
  const completionActivation = object(completion.activation, 'completion.activation')
  const rework = object(completion.rework_branch, 'completion.rework_branch')
  if (routing.schema !== 'IMAGO-V6-VideoGenerationRoutingPolicy-v1'
    || activation.compiler_active !== true
    || principles.macro_and_micro_qc_must_both_pass !== true
    || post.macro_qc_required !== true || post.micro_qc_required !== true
    || post.unverified_is_not_pass !== true
    || overlay.schema !== 'IMAGO-V6-VideoReferenceOrchestrationPolicy-v1'
    || !isDeepStrictEqual(layers.MACRO_QC, TAKE_TECHNICAL_QC_MACRO_CODES)
    || !isDeepStrictEqual(layers.MICRO_QC, TAKE_TECHNICAL_QC_MICRO_CODES)
    || layers.both_layers_required_for_final_pass !== true || layers.unverified_is_not_pass !== true
    || review.schema !== 'IMAGO-V6-LSUQCProviderNeutralReviewPolicy-v1'
    || reviewActivation.provider_neutral_review_enabled !== true
    || reviewActivation.technical_pass_auto_promotes_content !== false
    || !isDeepStrictEqual(inspection.allowed_window_results, RESULTS)
    || inspection.unverified_is_not_pass !== true
    || inspection.macro_and_micro_qc_both_required !== true
    || decision.technical_success_is_not_content_pass !== true
    || completion.schema !== 'IMAGO-V6-LSUQCCompletionRoutingPolicy-v1'
    || completionActivation.automatic_generation_retry !== false
    || rework.paid_generation_authorized !== false || rework.automatic_retry !== false
    || rework.completion_release_forbidden !== true) {
    throw new TakeTechnicalQcContractError('current macro/micro QC policies are incompatible')
  }
  const hashes = Object.fromEntries([...sources].map(([path, raw]) =>
    [path, createHash('sha256').update(raw).digest('hex')]))
  return { hashes, definition: definition(), rulesSha256: sha256(hashes, serialize, 'takeTechnicalQc.rules') }
}

/**
 * Verify every compiler field before signing the method with the Host-only key.
 * @param raw - Compiler output to validate.
 * @param snapshot - Source snapshot bound to the compiler result.
 * @param rules - Current rule sources bound to the result.
 * @param key - Host attestation key.
 * @returns Resulting ImagoTakeTechnicalQcMethodResponse value.
 */
export function attestTakeTechnicalQcMethod(
  raw: unknown,
  snapshot: ImagoTakeTechnicalQcMethodSnapshot,
  rules: TakeTechnicalQcRules,
  key: string,
): ImagoTakeTechnicalQcMethodResponse {
  const projection = exact(raw, [
    'schema', 'subject', 'evidenceSnapshotSha256', 'technicalReceiptStatus',
    'definition', 'ruleBindings', 'rulesSha256',
  ], 'compiler projection')
  if (projection.schema !== 'qingmu.imago-take-technical-qc-method.v1'
    || !isDeepStrictEqual(projection.subject, snapshot.evidence.subject)
    || projection.evidenceSnapshotSha256 !== snapshot.evidenceSnapshotSha256
    || projection.technicalReceiptStatus !== snapshot.evidence.technicalReceipt.status
    || !isDeepStrictEqual(projection.definition, rules.definition)
    || !isDeepStrictEqual(projection.ruleBindings, rules.hashes)
    || projection.rulesSha256 !== rules.rulesSha256) {
    throw new TakeTechnicalQcContractError('compiler evidence, method, or rule binding mismatched')
  }
  const projectionSha256 = sha256(projection, takeAcceptanceJcsJson, 'takeTechnicalQc.projection')
  const unsigned = {
    schema: 'qingmu.imago-take-technical-qc-method-attestation.v1' as const,
    algorithm: 'hmac-sha256' as const,
    evidenceSnapshotSha256: snapshot.evidenceSnapshotSha256,
    methodProjectionSha256: projectionSha256,
  }
  return {
    schema: 'qingmu.imago-take-technical-qc-method-adapter-result.v1',
    projection: projection as unknown as ImagoTakeTechnicalQcMethodProjection,
    projectionSha256,
    methodAttestation: {
      ...unsigned,
      signature: createHmac('sha256', key)
        .update(takeAcceptanceJcsJson(unsigned, 'takeTechnicalQc.attestation'), 'utf8').digest('hex'),
    },
  }
}
