import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  executeDirectorProviderPermit,
  type DirectorProviderDispatchPermit,
} from '../src/director-provider-execution.ts'
import {
  createDeepSeekDirectorTransport,
  executeDirectorTaskOnce,
  type DirectorExecutionBinding,
} from '../src/director-execution-host.ts'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const workOrder = (): DirectorProviderDispatchPermit['workOrder'] => {
  const body = { workOrderId: 'work_order_1', provider: 'fake', model: 'model_1',
    routeKey: 'fake.director', providerCapability: 'chat.agent' as const,
    inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
    outputSchema: 'qingmu.director-proposal.v1' as const, projectId: 'project_1', episodeId: 'episode_1',
    sceneId: 'scene_1', shotId: 'shot_1',
    methodPackage: { version: 'director-paid.v1', sha256: 'c'.repeat(64) },
    pricingSnapshot: { sha256: 'f'.repeat(64) } }
  return { ...body, workOrderSha256: sha(body) }
}

const permit = (): DirectorProviderDispatchPermit => ({
  schema: 'jason.qingmu-director-provider-dispatch-permit.v1', state: 'dispatch_permitted',
  generationTaskId: 'task_1', provider: 'fake', model: 'model_1',
  inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
  requestPolicy: { maxAttempts: 1, maxRetries: 0 },
  workOrder: workOrder(),
  dispatch: { key: 'task_1:1', epoch: 1, workerId: 'host-task_1', claimToken: 'claim_1', claimEpoch: 1 },
  payload: { messages: [] },
})

const binding = (): DirectorExecutionBinding => {
  const value = permit()
  const payloadSha256 = sha(value.payload)
  return {
    taskId: 'task_1', workOrderSha256: value.workOrder.workOrderSha256,
    contextSnapshotSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
    requestSha256: sha({ capability: 'chat.agent', routeKey: value.workOrder.routeKey,
      provider: 'fake', model: 'model_1', payloadSha256 }), payloadSha256,
    provider: 'fake', model: 'model_1', methodPackageSha256: 'c'.repeat(64),
    pricingSnapshotSha256: 'f'.repeat(64), dispatchKey: '', dispatchEpoch: 0,
    claimToken: '', claimEpoch: 0, exclusiveExecutionLane: 'qingmu_director_host_permit_v1',
  }
}

const transportResult = () => ({ providerCompletionId: 'completion_1', providerRequestId: 'request_1',
  finishReason: 'stop', usage: { promptTokens: 20, cacheTokens: 5, completionTokens: 10, totalTokens: 30 },
  proposal: { schema: 'qingmu.director-proposal.v1' as const, projectId: 'project_1',
    episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1', advisoryOnly: true as const,
    items: [{ id: 'item_1', field: 'narrative' as const, proposedValue: '建议', impact: '仅进入人工草稿' }] } })

describe('Director provider Host execution seam', () => {
  it('executes one signed request once with retries disabled and emits a complete provider receipt', async () => {
    const execute = vi.fn(async () => ({ providerCompletionId: 'completion_1', providerRequestId: 'request_1',
      finishReason: 'stop', usage: { promptTokens: 20, cacheTokens: 5, completionTokens: 10, totalTokens: 30 },
      proposal: { schema: 'qingmu.director-proposal.v1' as const, projectId: 'project_1',
        episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1', advisoryOnly: true as const,
        items: [{ id: 'item_1', field: 'narrative' as const, proposedValue: '建议', impact: '仅进入人工草稿' }] } }))
    const result = await executeDirectorProviderPermit(permit(), { execute }, new AbortController().signal)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fake', model: 'model_1', maxRetries: 0 }), expect.any(AbortSignal))
    expect(result).toMatchObject({ state: 'provider_result', receipt: {
      schema: 'qingmu.director-provider-execution-receipt.v1', workOrderId: 'work_order_1',
      provider: 'fake', model: 'model_1', inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
      providerCompletionId: 'completion_1', providerRequestId: 'request_1', providerResult: true,
      usage: { promptTokens: 20, cacheTokens: 5, completionTokens: 10, totalTokens: 30 }, finishReason: 'stop',
    } })
  })

  it('uses the unregistered llm-deepseek conformance adapter once with maxRetries zero', async () => {
    const chatCompletions = vi.fn(async (_request: unknown, _signal: AbortSignal) => transportResult())
    const transport = createDeepSeekDirectorTransport({ chatCompletions })
    const result = await executeDirectorProviderPermit(permit(), transport, new AbortController().signal)
    expect(result.state).toBe('provider_result')
    expect(chatCompletions).toHaveBeenCalledOnce()
    expect(chatCompletions.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 0, provider: 'fake', model: 'model_1' })
  })

  it('signs Host-only requests and recovers terminal response loss without a second inference', async () => {
    const calls: string[] = []
    let completed = false
    let loseCompleteResponse = true
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      calls.push(url.pathname)
      const headers = new Headers(init?.headers)
      expect(headers.get('x-qingmu-execution-signature')).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof init?.body === 'string' ? init.body : '').not.toContain('execution-key-material')
      if (url.pathname.endsWith('/binding')) return Response.json(binding())
      if (url.pathname.endsWith('/prepare')) {
        return completed
          ? Response.json({ state: 'settled', generationTaskId: 'task_1', executionReceipt: { id: 'same' } })
          : Response.json(permit())
      }
      if (url.pathname.endsWith('/complete')) {
        completed = true
        if (loseCompleteResponse) {
          loseCompleteResponse = false
          throw new Error('response lost after commit')
        }
        return Response.json({ state: 'settled', generationTaskId: 'task_1', executionReceipt: { id: 'same' } })
      }
      throw new Error('unexpected request')
    }) as typeof fetch
    const chatCompletions = vi.fn(async (_request: unknown, _signal: AbortSignal) => transportResult())
    const options = { baseUrl: 'http://127.0.0.1:49999', executionKey: 'execution-key-material-is-at-least-32-bytes',
      transport: createDeepSeekDirectorTransport({ chatCompletions }), fetch: fetchImpl }
    await expect(executeDirectorTaskOnce(options, 'task_1', 'director-paid.v1', 'c'.repeat(64), new AbortController().signal))
      .rejects.toThrow('response lost')
    const recovered = await executeDirectorTaskOnce(
      options, 'task_1', 'director-paid.v1', 'c'.repeat(64), new AbortController().signal,
    )
    expect(recovered.state).toBe('settled')
    expect(chatCompletions).toHaveBeenCalledOnce()
    expect(calls.filter(path => path.endsWith('/complete'))).toHaveLength(1)
  })

  it('rejects a permit payload that no longer matches the signed binding before transport', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/binding')) return Response.json(binding())
      if (url.pathname.endsWith('/prepare')) {
        return Response.json({ ...permit(), payload: { messages: ['tampered'] } })
      }
      throw new Error('unexpected request')
    }) as typeof fetch
    const chatCompletions = vi.fn(async () => transportResult())
    await expect(executeDirectorTaskOnce({
      baseUrl: 'http://127.0.0.1:49999',
      executionKey: 'execution-key-material-is-at-least-32-bytes',
      transport: createDeepSeekDirectorTransport({ chatCompletions }),
      fetch: fetchImpl,
    }, 'task_1', 'director-paid.v1', 'c'.repeat(64), new AbortController().signal))
      .rejects.toThrow('permit binding mismatch')
    expect(chatCompletions).not.toHaveBeenCalled()
  })

  it('turns timeout or missing receipts into submission_unknown without retry', async () => {
    const execute = vi.fn(async () => { throw new Error('timeout after submit') })
    const result = await executeDirectorProviderPermit(permit(), { execute }, new AbortController().signal)
    expect(execute).toHaveBeenCalledOnce()
    expect(result).toEqual({ state: 'submission_unknown', automaticRetry: false, reason: 'timeout after submit' })
  })

  it('rejects provider, model or SHA drift before transport', async () => {
    const execute = vi.fn()
    await expect(executeDirectorProviderPermit({ ...permit(), model: 'drifted' }, { execute }, new AbortController().signal))
      .rejects.toThrow('permit mismatch')
    expect(execute).not.toHaveBeenCalled()
  })

  it('quarantines an invalid or cross-scope proposal without retry', async () => {
    const execute = vi.fn(async () => ({ providerCompletionId: 'completion_1', providerRequestId: 'request_1',
      finishReason: 'stop', usage: { promptTokens: 20, cacheTokens: 0, completionTokens: 10, totalTokens: 30 },
      proposal: { schema: 'qingmu.director-proposal.v1', projectId: 'wrong', episodeId: 'episode_1',
        sceneId: 'scene_1', shotId: 'shot_1', advisoryOnly: true, items: [] } }))
    const result = await executeDirectorProviderPermit(
      permit(), { execute: execute as never }, new AbortController().signal,
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
  })
})
