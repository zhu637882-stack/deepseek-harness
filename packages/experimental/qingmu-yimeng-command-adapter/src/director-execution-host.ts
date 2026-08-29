/** Private Host client for the Yimeng DirectorInference execution plane. */
import { createHash, createHmac, randomBytes } from 'node:crypto'
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
