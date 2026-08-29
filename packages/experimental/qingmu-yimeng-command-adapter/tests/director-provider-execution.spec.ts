import { describe, expect, it, vi } from 'vitest'
import {
  executeDirectorProviderPermit,
  type DirectorProviderDispatchPermit,
} from '../src/director-provider-execution.ts'

const permit = (): DirectorProviderDispatchPermit => ({
  schema: 'jason.qingmu-director-provider-dispatch-permit.v1', state: 'dispatch_permitted',
  generationTaskId: 'task_1', provider: 'fake', model: 'model_1',
  inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
  requestPolicy: { maxAttempts: 1, maxRetries: 0 },
  workOrder: { workOrderId: 'work_order_1', provider: 'fake', model: 'model_1',
    inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
    outputSchema: 'qingmu.director-proposal.v1', projectId: 'project_1', episodeId: 'episode_1',
    sceneId: 'scene_1', shotId: 'shot_1',
    methodPackage: { version: 'director-paid.v1', sha256: 'c'.repeat(64) } },
  dispatch: { key: 'task_1:1' }, payload: { messages: [] },
})

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
