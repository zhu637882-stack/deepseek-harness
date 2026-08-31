/** Host-only execution of a Yimeng-signed DirectorProposal permit. */
import { createHash } from 'node:crypto'

/** Writer-owned, content-addressed rules for one Director proposal JSON object. */
export interface DirectorProposalOutputContract {
  readonly schema: string
  readonly responseInstruction: string
  readonly root: {
    readonly requiredFields: readonly string[]
    readonly optionalFields: readonly string[]
    readonly additionalFieldsAllowed: boolean
    readonly fieldRules: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  }
  readonly item: {
    readonly requiredFields: readonly string[]
    readonly optionalFields: readonly string[]
    readonly additionalFieldsAllowed: boolean
    readonly fieldRules: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  }
  readonly relations: { readonly uniqueItemFields: readonly string[] }
  readonly stringLength: { readonly unit: string }
  readonly nullAndUnknown: {
    readonly nullAllowed: boolean
    readonly unknownPlaceholderAllowed: boolean
    readonly noSuggestionAction: string
    readonly exactPlaceholderPolicy: {
      readonly normalizedValues: readonly string[]
      readonly normalization: {
        readonly trim: string
        readonly case: string
        readonly unicodeNormalization: string
      }
    }
  }
}

/** The only paid-capable permit accepted by the Host seam. */
export interface DirectorProviderDispatchPermit {
  readonly schema: 'jason.qingmu-director-provider-dispatch-permit.v1'
  readonly state: 'dispatch_permitted'
  readonly generationTaskId: string
  readonly provider: string
  readonly model: string
  readonly inputSha256: string
  readonly promptSha256: string
  readonly requestPolicy: { readonly maxAttempts: 1; readonly maxRetries: 0 }
  readonly workOrder: {
    readonly workOrderId: string
    readonly workOrderSha256: string
    readonly provider: string
    readonly model: string
    readonly routeKey: string
    readonly providerCapability: 'chat.agent'
    readonly inputSha256: string
    readonly promptSha256: string
    readonly outputSchema: 'qingmu.director-proposal.v1'
    readonly outputContract: DirectorProposalOutputContract
    readonly outputContractSha256: string
    readonly projectId: string
    readonly episodeId: string
    readonly sceneId: string
    readonly shotId: string
    readonly methodPackage: { readonly version: string; readonly sha256: string }
    readonly pricingSnapshot: { readonly sha256: string }
    readonly inputPolicy: {
      readonly unit: 'utf8_bytes_upper_bound'
      readonly promptUtf8Bytes: number
      readonly maxInputTokens: number
    }
  }
  readonly dispatch: Readonly<Record<string, unknown>>
  readonly payload: Readonly<Record<string, unknown>>
}

/** One strictly bounded advisory field emitted by the paid-capable text seam. */
export interface DirectorProviderProposalItem {
  readonly id: string
  readonly field: 'narrative' | 'visual' | 'action' | 'durationSec'
  readonly proposedValue: string | number
  readonly impact: string
}

/** Exact provider proposal schema; it carries no formal or human authority. */
export interface DirectorProviderProposal {
  readonly schema: 'qingmu.director-proposal.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly sceneId: string
  readonly shotId: string
  readonly advisoryOnly: true
  readonly items: readonly DirectorProviderProposalItem[]
}

/** Provider facts captured from one complete response before proposal parsing. */
export interface DirectorProviderTransportFacts {
  readonly schema: 'qingmu.director-provider-transport-facts.v1'
  readonly providerCompletionId: string
  readonly providerRequestId: string | null
  readonly finishReason: string
  readonly usage: {
    readonly promptTokens: number
    readonly cacheTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
  }
  readonly rawOutputSha256: string
  readonly rawOutputUtf8Bytes?: number
}

export const DIRECTOR_PROVIDER_ERROR_CODES = {
  providerResponseInvalid: 'director_provider_response_invalid',
  submissionUnknown: 'director_provider_submission_unknown',
} as const

export type DirectorProviderErrorCode = typeof DIRECTOR_PROVIDER_ERROR_CODES[keyof typeof DIRECTOR_PROVIDER_ERROR_CODES]

/** Complete transport result. Raw provider text never crosses this boundary. */
export type DirectorProviderTransportResult =
  | {
    readonly state: 'provider_response'
    readonly transportFacts: DirectorProviderTransportFacts
    readonly proposal: DirectorProviderProposal
  }
  | {
    readonly state: 'provider_response_invalid'
    readonly automaticRetry: false
    readonly errorCode: 'director_provider_response_invalid'
    readonly transportFacts: DirectorProviderTransportFacts
  }

/** Minimal provider result required before the UI may call a proposal an AI result. */
export interface DirectorProviderValidatedResult extends DirectorProviderTransportFacts {
  readonly proposal: DirectorProviderProposal
}

/** Canonical Yimeng execution receipt; it is not a second task or cost ledger. */
export interface DirectorProviderExecutionReceipt extends Omit<DirectorProviderValidatedResult, 'schema'> {
  readonly schema: 'qingmu.director-provider-execution-receipt.v1'
  readonly workOrderId: string
  readonly provider: string
  readonly model: string
  readonly inputSha256: string
  readonly promptSha256: string
  readonly outputSha256: string
  readonly providerResult: true
  readonly transportFacts: DirectorProviderTransportFacts
}

/** Transport injected only by the Host; production transport is intentionally not registered here. */
export interface DirectorProviderTransport {
  execute(request: {
    readonly provider: string
    readonly model: string
    readonly payload: Readonly<Record<string, unknown>>
    readonly maxRetries: 0
  }, signal: AbortSignal): Promise<DirectorProviderTransportResult>
}

/** Fail-closed outcome of one Host-side provider execution attempt. */
export type DirectorProviderExecutionResult =
  | { readonly state: 'provider_result'; readonly receipt: DirectorProviderExecutionReceipt }
  | {
    readonly state: 'provider_response_invalid'
    readonly automaticRetry: false
    readonly errorCode: 'director_provider_response_invalid'
    readonly transportFacts: DirectorProviderTransportFacts
  }
  | {
    readonly state: 'submission_unknown'
    readonly automaticRetry: false
    readonly errorCode: 'director_provider_submission_unknown'
  }

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const unicodeCodePointLength = (value: string): number => Array.from(value).length
const normalizePlaceholder = (value: string): string => value
  .replace(/^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g, '')
  .replace(/[A-Z]/g, character => character.toLowerCase())

const proposalPlaceholderValues = (contract: DirectorProposalOutputContract): ReadonlySet<string> => {
  const policy = contract.nullAndUnknown.exactPlaceholderPolicy
  const values = policy.normalizedValues
  if (contract.stringLength.unit !== 'unicode_code_points'
    || policy.normalization.trim !== 'ascii_whitespace'
    || policy.normalization.case !== 'ascii_lower'
    || policy.normalization.unicodeNormalization !== 'none'
    || values.length === 0
    || values.some(value => value.length === 0 || normalizePlaceholder(value) !== value)
    || new Set(values).size !== values.length) {
    throw new Error('director provider output contract invalid')
  }
  return new Set(values)
}

const identifier = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || !/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error(`${field} invalid`)
  return value
}

const digest = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} invalid`)
  return value
}

const transportFacts = (value: unknown): DirectorProviderTransportFacts => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('director provider transport facts invalid')
  }
  const facts = value as Record<string, unknown>
  const allowed = new Set([
    'schema', 'providerCompletionId', 'providerRequestId', 'finishReason', 'usage',
    'rawOutputSha256', 'rawOutputUtf8Bytes',
  ])
  if (Object.keys(facts).some(key => !allowed.has(key))
    || facts.schema !== 'qingmu.director-provider-transport-facts.v1') {
    throw new Error('director provider transport facts invalid')
  }
  const usage = facts.usage
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)
    || Object.keys(usage).sort().join('\0') !== 'cacheTokens\0completionTokens\0promptTokens\0totalTokens') {
    throw new Error('director provider usage invalid')
  }
  const normalizedUsage = usage as DirectorProviderTransportFacts['usage']
  if (![normalizedUsage.promptTokens, normalizedUsage.cacheTokens,
    normalizedUsage.completionTokens, normalizedUsage.totalTokens]
    .every(item => Number.isSafeInteger(item) && item >= 0)
    || normalizedUsage.totalTokens !== normalizedUsage.promptTokens + normalizedUsage.completionTokens) {
    throw new Error('director provider usage invalid')
  }
  if (facts.rawOutputUtf8Bytes !== undefined
    && (!Number.isSafeInteger(facts.rawOutputUtf8Bytes) || Number(facts.rawOutputUtf8Bytes) < 0)) {
    throw new Error('director provider raw output bytes invalid')
  }
  return {
    schema: 'qingmu.director-provider-transport-facts.v1',
    providerCompletionId: identifier(facts.providerCompletionId, 'providerCompletionId'),
    providerRequestId: facts.providerRequestId === null
      ? null
      : identifier(facts.providerRequestId, 'providerRequestId'),
    finishReason: identifier(facts.finishReason, 'finishReason'),
    usage: normalizedUsage,
    rawOutputSha256: digest(facts.rawOutputSha256, 'rawOutputSha256'),
    ...(facts.rawOutputUtf8Bytes === undefined
      ? {}
      : { rawOutputUtf8Bytes: Number(facts.rawOutputUtf8Bytes) }),
  }
}

const proposal = (
  value: unknown,
  workOrder: DirectorProviderDispatchPermit['workOrder'],
): DirectorProviderProposal => {
  const contract = workOrder.outputContract
  if (contract.schema !== 'jason.qingmu-director-proposal-output-contract.v1'
    || sha(contract) !== workOrder.outputContractSha256
    || contract.root.optionalFields.length !== 0
    || contract.root.additionalFieldsAllowed
    || contract.item.optionalFields.length !== 0
    || contract.item.additionalFieldsAllowed
    || contract.nullAndUnknown.nullAllowed
    || contract.nullAndUnknown.unknownPlaceholderAllowed
    || contract.nullAndUnknown.noSuggestionAction !== 'omit_item') {
    throw new Error('director provider output contract invalid')
  }
  const placeholders = proposalPlaceholderValues(contract)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('director provider proposal invalid')
  }
  const root = value as Record<string, unknown>
  const rootRules = contract.root.fieldRules
  const itemsRule = rootRules.items as Record<string, unknown>
  if (Object.keys(root).sort().join('\0') !== [...contract.root.requiredFields].sort().join('\0')
    || root.schema !== (rootRules.schema as Record<string, unknown>).const
    || root.projectId !== (rootRules.projectId as Record<string, unknown>).const
    || root.episodeId !== (rootRules.episodeId as Record<string, unknown>).const
    || root.sceneId !== (rootRules.sceneId as Record<string, unknown>).const
    || root.shotId !== (rootRules.shotId as Record<string, unknown>).const
    || root.advisoryOnly !== (rootRules.advisoryOnly as Record<string, unknown>).const
    || !Array.isArray(root.items)
    || root.items.length < Number(itemsRule.minItems)
    || root.items.length > Number(itemsRule.maxItems)) {
    throw new Error('director provider proposal invalid')
  }
  const itemRules = contract.item.fieldRules
  const idRule = itemRules.id as Record<string, unknown>
  const fieldRule = itemRules.field as Record<string, unknown>
  const proposedRule = itemRules.proposedValue as Record<string, unknown>
  const dependentTypes = proposedRule.dependentTypes as Record<string, unknown>
  const impactRule = itemRules.impact as Record<string, unknown>
  const ids = new Set<string>(), fields = new Set<string>()
  for (const rawItem of root.items) {
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      throw new Error('director provider proposal item invalid')
    }
    const item = rawItem as Record<string, unknown>
    if (Object.keys(item).sort().join('\0') !== [...contract.item.requiredFields].sort().join('\0')) {
      throw new Error('director provider proposal item invalid')
    }
    const itemId = identifier(item.id, 'proposal item id')
    if (itemId.length < Number(idRule.minLength) || itemId.length > Number(idRule.maxLength)
      || !(new RegExp(String(idRule.pattern))).test(itemId)) {
      throw new Error('director provider proposal item invalid')
    }
    const field = item.field
    if (!Array.isArray(fieldRule.enum) || !fieldRule.enum.includes(field)
      || ids.has(itemId) || fields.has(String(field))) throw new Error('director provider proposal item invalid')
    const proposed = item.proposedValue
    const valueRule = dependentTypes[String(field)]
    if (typeof valueRule !== 'object' || valueRule === null) {
      throw new Error('director provider proposal value invalid')
    }
    const typedValueRule = valueRule as Record<string, unknown>
    if (field === 'durationSec') {
      if (typeof proposed !== 'number' || !Number.isFinite(proposed)
        || proposed < Number(typedValueRule.minimum) || proposed > Number(typedValueRule.maximum)) {
        throw new Error('director provider proposal value invalid')
      }
    } else if (typeof proposed !== 'string' || proposed.trim().length === 0
      || unicodeCodePointLength(proposed) < Number(typedValueRule.minLength)
      || unicodeCodePointLength(proposed) > Number(typedValueRule.maxLength)
      || placeholders.has(normalizePlaceholder(proposed))) {
      throw new Error('director provider proposal value invalid')
    }
    if (typeof item.impact !== 'string' || item.impact.trim().length === 0
      || unicodeCodePointLength(item.impact) < Number(impactRule.minLength)
      || unicodeCodePointLength(item.impact) > Number(impactRule.maxLength)
      || placeholders.has(normalizePlaceholder(item.impact))) {
      throw new Error('director provider proposal impact invalid')
    }
    ids.add(itemId); fields.add(String(field))
  }
  return root as unknown as DirectorProviderProposal
}

/**
 * Execute one already-authorized request exactly once and normalize its provider receipt.
 * @param permit Yimeng-signed task/outbox permit.
 * @param transport Single-attempt provider transport supplied by the Host runtime.
 * @param signal Cancellation signal; ambiguous cancellation remains submission_unknown.
 * @returns A normalized provider receipt or a non-retriable unknown outcome.
 */
export async function executeDirectorProviderPermit(
  permit: DirectorProviderDispatchPermit,
  transport: DirectorProviderTransport,
  signal: AbortSignal,
): Promise<DirectorProviderExecutionResult> {
  const raw = permit as unknown as {
    schema: string
    state: string
    provider: string
    model: string
    inputSha256: string
    promptSha256: string
    requestPolicy: {
      maxAttempts: number
      maxRetries: number
    }
    workOrder: DirectorProviderDispatchPermit['workOrder']
  }
  if (raw.schema !== 'jason.qingmu-director-provider-dispatch-permit.v1'
    || raw.state !== 'dispatch_permitted'
    || raw.requestPolicy.maxAttempts !== 1 || raw.requestPolicy.maxRetries !== 0
    || raw.provider !== raw.workOrder.provider || raw.model !== raw.workOrder.model
    || raw.inputSha256 !== raw.workOrder.inputSha256
    || raw.promptSha256 !== raw.workOrder.promptSha256) {
    throw new Error('director provider permit mismatch')
  }
  const provider = identifier(permit.provider, 'provider')
  const model = identifier(permit.model, 'model')
  const inputSha256 = digest(permit.inputSha256, 'inputSha256')
  const promptSha256 = digest(permit.promptSha256, 'promptSha256')
  const workOrderId = identifier(permit.workOrder.workOrderId, 'workOrderId')
  const outputContractSha256 = digest(
    permit.workOrder.outputContractSha256, 'outputContractSha256',
  )
  if (sha(permit.workOrder.outputContract) !== outputContractSha256) {
    throw new Error('director provider output contract mismatch')
  }
  let completedFacts: DirectorProviderTransportFacts | undefined
  try {
    const result = await transport.execute({ provider, model, payload: permit.payload, maxRetries: 0 }, signal)
    const facts = transportFacts(result.transportFacts)
    completedFacts = facts
    if (result.state === 'provider_response_invalid') {
      return {
        state: 'provider_response_invalid', automaticRetry: false,
        errorCode: DIRECTOR_PROVIDER_ERROR_CODES.providerResponseInvalid,
        transportFacts: facts,
      }
    }
    const normalizedProposal = proposal(result.proposal, permit.workOrder)
    const receipt: DirectorProviderExecutionReceipt = {
      ...facts,
      schema: 'qingmu.director-provider-execution-receipt.v1', workOrderId,
      provider, model, inputSha256, promptSha256,
      outputSha256: sha(normalizedProposal),
      transportFacts: facts,
      providerResult: true, proposal: normalizedProposal,
    }
    return { state: 'provider_result', receipt }
  } catch {
    if (completedFacts !== undefined) {
      return {
        state: 'provider_response_invalid', automaticRetry: false,
        errorCode: DIRECTOR_PROVIDER_ERROR_CODES.providerResponseInvalid,
        transportFacts: completedFacts,
      }
    }
    return {
      state: 'submission_unknown', automaticRetry: false,
      errorCode: DIRECTOR_PROVIDER_ERROR_CODES.submissionUnknown,
    }
  }
}
