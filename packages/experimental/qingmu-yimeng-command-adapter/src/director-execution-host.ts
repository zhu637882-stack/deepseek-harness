/** Private Host client for the Yimeng DirectorInference execution plane. */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { LlmRuntime, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  DirectorProviderDispatchPermit,
  DirectorProviderExecutionResult,
  DirectorProviderTransport,
  DirectorProviderTransportResult,
} from './director-provider-execution.ts'
import { executeDirectorProviderPermit } from './director-provider-execution.ts'

const DOMAIN = 'qingmu-director-execution.v1'

/** Immutable Yimeng task and dispatch values covered by the Host request signature. */
export interface DirectorExecutionBinding {
  readonly taskId: string
  readonly workOrderSha256: string
  readonly contextSnapshotSha256: string
  readonly promptSha256: string
  readonly requestSha256: string
  readonly payloadSha256: string
  readonly provider: string
  readonly model: string
  readonly methodPackageSha256: string
  readonly pricingSnapshotSha256: string
  readonly dispatchKey: string
  readonly dispatchEpoch: number
  readonly claimToken: string
  readonly claimEpoch: number
  readonly exclusiveExecutionLane: 'qingmu_director_host_permit_v1'
}

/** Minimal ChatCompletions shape implemented by the existing llm-deepseek adapter. */
export interface DeepSeekDirectorChatAdapter {
  chatCompletions(request: {
    readonly provider: string
    readonly model: string
    readonly payload: Readonly<Record<string, unknown>>
    readonly maxRetries: 0
  }, signal: AbortSignal): Promise<DirectorProviderTransportResult>
}

/**
 * Create an unregistered conformance transport for the DSh llm-deepseek adapter.
 * The caller supplies the adapter; this module never resolves a credential or route.
 * @param adapter Injected ChatCompletions adapter with external routing already disabled or controlled.
 * @returns A single-attempt Director provider transport.
 */
export function createDeepSeekDirectorTransport(
  adapter: DeepSeekDirectorChatAdapter,
): DirectorProviderTransport {
  return {
    execute: async (request, signal) => {
      return await adapter.chatCompletions({ ...request, maxRetries: 0 }, signal)
    },
  }
}

interface DeepSeekResponseMetadata {
  readonly providerRequestId?: unknown
  readonly providerCompletionId?: unknown
  readonly finishReason?: unknown
}

const loopbackMockBaseUrl = (value: string): string => {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('director DSh mock endpoint invalid') }
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
    || (hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1')) {
    throw new Error('director DSh mock endpoint must be HTTP loopback')
  }
  return parsed.href.replace(/\/$/, '')
}

const directorBody = (payload: Readonly<Record<string, unknown>>, provider: string, model: string): {
  prompt: string
  maxTokens: number
} => {
  if (provider !== 'deepseek-official' || model !== 'deepseek-v4-pro') {
    throw new Error('director DSh route is not allowed')
  }
  const body = payload.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('director DSh payload invalid')
  }
  const request = body as Record<string, unknown>
  const allowed = new Set([
    'model', 'messages', 'max_completion_tokens', 'enable_thinking',
    'estimated_input_tokens', 'estimated_output_tokens',
  ])
  if (Object.keys(request).some(key => !allowed.has(key))
    || request.model !== model || request.enable_thinking !== false
    || !Number.isSafeInteger(request.max_completion_tokens)
    || Number(request.max_completion_tokens) < 1 || Number(request.max_completion_tokens) > 512
    || !Array.isArray(request.messages) || request.messages.length !== 1) {
    throw new Error('director DSh payload invalid')
  }
  const message: unknown = request.messages[0]
  if (typeof message !== 'object' || message === null || Array.isArray(message)
    || Object.keys(message).sort().join('\0') !== 'content\0role'
    || (message as Record<string, unknown>).role !== 'user'
    || typeof (message as Record<string, unknown>).content !== 'string') {
    throw new Error('director DSh payload invalid')
  }
  const prompt = (message as Record<string, unknown>).content as string
  if (Buffer.byteLength(prompt) === 0 || Buffer.byteLength(prompt) > 64 * 1024) {
    throw new Error('director DSh prompt invalid')
  }
  return { prompt, maxTokens: Number(request.max_completion_tokens) }
}

/**
 * Bind the Host-only DirectorProposal seam to the real DSh LLM runtime.
 * The prepared handle is consumed exactly once and must advertise zero retries.
 * @param llm - Host-private DSh LLM runtime used to prepare the signed provider/model route.
 * @param options - Exact HTTP loopback mock origin allowed for this isolated transport.
 * @returns A single-attempt Director transport that fails closed on incomplete provider facts.
 */
export function createDshDeepSeekDirectorTransport(
  llm: Pick<LlmRuntime, 'prepareCall'>,
  options: Readonly<{ mockBaseUrl: string }>,
): DirectorProviderTransport {
  const expectedMockBaseUrl = loopbackMockBaseUrl(options.mockBaseUrl)
  return {
    execute: async ({ provider, model, payload }, signal) => {
      const { prompt, maxTokens } = directorBody(payload, provider, model)
      const prepared = await llm.prepareCall({
        provider, model, reasoningEffort: ReasoningEffortId('off'), maxTokens,
      }, signal)
      if (typeof prepared.transport?.baseURL !== 'string'
        || loopbackMockBaseUrl(prepared.transport.baseURL) !== expectedMockBaseUrl) {
        throw new Error('director DSh prepared endpoint mismatch')
      }
      if (prepared.retryPolicy.mode !== 'normal' || prepared.retryPolicy.maxRetries !== 0) {
        throw new Error('director DSh adapter retries are not disabled')
      }
      let text = ''
      let usage: TokenUsage | undefined
      let metadata: DeepSeekResponseMetadata | undefined
      let finishReason: string | undefined
      const request = {
        ...prepared.config,
        messages: [createUserMessage({
          content: [{ type: 'text' as const, text: prompt }],
          source: { kind: 'plugin' as const, plugin: 'qingmu-director-one-shot' },
        })],
        purpose: 'director-proposal' as const,
        signal,
      }
      for await (const chunk of prepared.stream(request)) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
          if (Buffer.byteLength(text) > 64 * 1024) throw new Error('director DSh response exceeds limit')
        } else if (chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
          throw new Error('director DSh response content invalid')
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          if (chunk.reason.kind !== 'stop') throw new Error('director DSh response did not stop successfully')
          finishReason = chunk.reason.kind
          metadata = chunk.replayState?.response as DeepSeekResponseMetadata | undefined
        }
      }
      if (usage === undefined || metadata === undefined
        || typeof metadata.providerCompletionId !== 'string'
        || typeof metadata.providerRequestId !== 'string'
        || typeof metadata.finishReason !== 'string'
        || metadata.finishReason !== finishReason) {
        throw new Error('director DSh provider receipt incomplete')
      }
      let proposal: unknown
      try { proposal = JSON.parse(text) } catch { throw new Error('director DSh response JSON invalid') }
      const cacheTokens = usage.cacheReadTokens ?? 0
      const promptTokens = usage.inputTokens + cacheTokens + (usage.cacheWriteTokens ?? 0)
      return {
        providerCompletionId: metadata.providerCompletionId,
        providerRequestId: metadata.providerRequestId,
        finishReason: metadata.finishReason,
        usage: {
          promptTokens,
          cacheTokens,
          completionTokens: usage.outputTokens,
          totalTokens: promptTokens + usage.outputTokens,
        },
        proposal: proposal as DirectorProviderTransportResult['proposal'],
      }
    },
  }
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}

const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')

const signedHeaders = (key: string, method: string, path: string, body: object): HeadersInit => {
  if (Buffer.byteLength(key) < 32) throw new Error('director execution key unavailable')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(18).toString('base64url')
  const bodySha = createHash('sha256').update(canonical(body)).digest('hex')
  const message = [DOMAIN, method, path, bodySha, timestamp, nonce].join('\n')
  return {
    'content-type': 'application/json',
    'x-qingmu-execution-timestamp': timestamp,
    'x-qingmu-execution-nonce': nonce,
    'x-qingmu-execution-signature': createHmac('sha256', key).update(message).digest('hex'),
  }
}

const post = async <T>(
  baseUrl: string,
  key: string,
  path: string,
  body: object,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<T> => {
  const response = await fetchImpl(new URL(path, baseUrl), {
    method: 'POST', headers: signedHeaders(key, 'POST', path, body),
    body: canonical(body), signal,
  })
  if (!response.ok) throw new Error(`director execution service rejected request: HTTP ${response.status}`)
  return await response.json() as T
}

const stringField = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new Error(`director execution ${name} invalid`)
  return value
}

const assertPermitBinding = (
  binding: DirectorExecutionBinding,
  permit: DirectorProviderDispatchPermit,
): void => {
  const workOrder = permit.workOrder
  const unsignedWorkOrder = { ...workOrder } as Record<string, unknown>
  delete unsignedWorkOrder.workOrderSha256
  const payloadSha256 = sha(permit.payload)
  const requestSha256 = sha({
    capability: workOrder.providerCapability,
    routeKey: workOrder.routeKey,
    provider: permit.provider,
    model: permit.model,
    payloadSha256,
  })
  if (permit.generationTaskId !== binding.taskId
    || permit.provider !== binding.provider || permit.model !== binding.model
    || permit.inputSha256 !== binding.contextSnapshotSha256
    || permit.promptSha256 !== binding.promptSha256
    || workOrder.workOrderSha256 !== binding.workOrderSha256
    || sha(unsignedWorkOrder) !== binding.workOrderSha256
    || workOrder.methodPackage.sha256 !== binding.methodPackageSha256
    || workOrder.pricingSnapshot.sha256 !== binding.pricingSnapshotSha256
    || payloadSha256 !== binding.payloadSha256
    || requestSha256 !== binding.requestSha256) {
    throw new Error('director execution permit binding mismatch')
  }
}

/** Host-private connection and transport dependencies for one issued task. */
export interface DirectorExecutionHostOptions {
  readonly baseUrl: string
  readonly executionKey: string
  readonly transport: DirectorProviderTransport
  readonly fetch?: typeof fetch
}

/** Recoverable technical outcome returned by the Yimeng execution plane. */
export type DirectorExecutionHostResult =
  | { readonly state: 'settled'; readonly generationTaskId: string; readonly executionReceipt: object }
  | { readonly state: 'submission_unknown'; readonly generationTaskId: string; readonly automaticRetry: false }

/**
 * Execute one already-issued task; terminal replays skip the transport.
 * @param options Host-private API, signing key, and injected transport.
 * @param taskId Exact Yimeng generation task identifier.
 * @param methodPackageVersion Method version currently materialized by the Host.
 * @param methodPackageSha256 Method content digest currently materialized by the Host.
 * @param signal Cancellation signal; ambiguous cancellation remains submission unknown.
 * @returns The settled receipt or non-retriable unknown state from Yimeng.
 */
export async function executeDirectorTaskOnce(
  options: DirectorExecutionHostOptions,
  taskId: string,
  methodPackageVersion: string,
  methodPackageSha256: string,
  signal: AbortSignal,
): Promise<DirectorExecutionHostResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const root = '/internal/qingmu/director-inference/tasks/' + encodeURIComponent(taskId)
  const binding = await post<DirectorExecutionBinding>(
    options.baseUrl, options.executionKey, root + '/binding', { taskId }, fetchImpl, signal,
  )
  const prepared = await post<DirectorProviderDispatchPermit | DirectorExecutionHostResult>(
    options.baseUrl, options.executionKey, root + '/prepare',
    { binding, currentMethodPackageVersion: methodPackageVersion, currentMethodPackageSha256: methodPackageSha256 },
    fetchImpl, signal,
  )
  if (prepared.state !== 'dispatch_permitted') return prepared
  assertPermitBinding(binding, prepared)
  const result: DirectorProviderExecutionResult = await executeDirectorProviderPermit(
    prepared, options.transport, signal,
  )
  const finalBinding: DirectorExecutionBinding = {
    ...binding,
    dispatchKey: stringField(prepared.dispatch.key, 'dispatch key'),
    dispatchEpoch: Number(prepared.dispatch.epoch ?? 0),
    claimToken: stringField(prepared.dispatch.claimToken, 'claim token'),
    claimEpoch: Number(prepared.dispatch.claimEpoch ?? 0),
  }
  if (result.state === 'provider_result') {
    return await post<DirectorExecutionHostResult>(
      options.baseUrl, options.executionKey, root + '/complete',
      { binding: finalBinding, dispatch: prepared.dispatch, receipt: result.receipt },
      fetchImpl, signal,
    )
  }
  return await post<DirectorExecutionHostResult>(
    options.baseUrl, options.executionKey, root + '/unknown',
    { binding: finalBinding, dispatch: prepared.dispatch, error: result.reason },
    fetchImpl, signal,
  )
}
