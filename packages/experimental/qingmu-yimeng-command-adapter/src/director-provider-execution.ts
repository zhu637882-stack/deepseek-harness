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
  readonly nullAndUnknown: {
    readonly nullAllowed: boolean
    readonly unknownPlaceholderAllowed: boolean
    readonly noSuggestionAction: string
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

/** Minimal provider result required before the UI may call a proposal an AI result. */
export interface DirectorProviderTransportResult {
  readonly providerCompletionId: string
  readonly providerRequestId: string | null
  readonly finishReason: string
  readonly usage: {
    readonly promptTokens: number
    readonly cacheTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
  }
  readonly proposal: DirectorProviderProposal
}

/** Canonical Yimeng execution receipt; it is not a second task or cost ledger. */
export interface DirectorProviderExecutionReceipt extends DirectorProviderTransportResult {
  readonly schema: 'qingmu.director-provider-execution-receipt.v1'
  readonly workOrderId: string
  readonly provider: string
  readonly model: string
  readonly inputSha256: string
  readonly promptSha256: string
  readonly outputSha256: string
  readonly providerResult: true
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
  | { readonly state: 'submission_unknown'; readonly automaticRetry: false; readonly reason: string }

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')

const identifier = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || !/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error(`${field} invalid`)
  return value
}

const digest = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} invalid`)
  return value
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
      || proposed.length < Number(typedValueRule.minLength)
      || proposed.length > Number(typedValueRule.maxLength)) {
      throw new Error('director provider proposal value invalid')
    }
    if (typeof item.impact !== 'string' || item.impact.trim().length === 0
      || item.impact.length < Number(impactRule.minLength)
      || item.impact.length > Number(impactRule.maxLength)) {
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
  try {
    const result = await transport.execute({ provider, model, payload: permit.payload, maxRetries: 0 }, signal)
    const usage = result.usage
    if (![usage.promptTokens, usage.cacheTokens, usage.completionTokens, usage.totalTokens]
      .every(value => Number.isSafeInteger(value) && value >= 0)
      || usage.totalTokens !== usage.promptTokens + usage.completionTokens) {
      throw new Error('director provider usage invalid')
    }
    const normalizedProposal = proposal(result.proposal, permit.workOrder)
    const receipt: DirectorProviderExecutionReceipt = {
      schema: 'qingmu.director-provider-execution-receipt.v1', workOrderId,
      provider, model, inputSha256, promptSha256,
      outputSha256: sha(normalizedProposal),
      providerCompletionId: identifier(result.providerCompletionId, 'providerCompletionId'),
      providerRequestId: result.providerRequestId === null
        ? null
        : identifier(result.providerRequestId, 'providerRequestId'),
      usage, finishReason: identifier(result.finishReason, 'finishReason'),
      providerResult: true, proposal: normalizedProposal,
    }
    return { state: 'provider_result', receipt }
  } catch (error) {
    const reason = typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
    return {
      state: 'submission_unknown', automaticRetry: false,
      reason,
    }
  }
}
