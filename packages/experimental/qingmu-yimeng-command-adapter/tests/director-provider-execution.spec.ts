import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import {
  executeDirectorProviderPermit,
  type DirectorProviderDispatchPermit,
} from '../src/director-provider-execution.ts'
import {
  createDeepSeekDirectorTransport,
  createDshDeepSeekDirectorTransport,
  createDshDeepSeekProductionDirectorTransport,
  executeDirectorTaskOnce,
  prepareDirectorTaskLock,
  readDirectorTaskBinding,
  type DirectorExecutionBinding,
} from '../src/director-execution-host.ts'
import { mockServer } from '../../../llm/llm-deepseek/tests/mock-server.ts'
import type { Behavior } from '../../../llm/llm-deepseek/tests/mock-server.ts'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const outputContract = () => ({
  schema: 'jason.qingmu-director-proposal-output-contract.v1' as const,
  responseInstruction: '只输出一个合法 JSON 对象；不得输出 Markdown、代码围栏、解释、前后缀文本或任何额外键。',
  root: {
    requiredFields: ['schema', 'projectId', 'episodeId', 'sceneId', 'shotId', 'advisoryOnly', 'items'],
    optionalFields: [], additionalFieldsAllowed: false as const,
    fieldRules: {
      schema: { type: 'string', const: 'qingmu.director-proposal.v1' },
      projectId: { type: 'string', const: 'project_1' }, episodeId: { type: 'string', const: 'episode_1' },
      sceneId: { type: 'string', const: 'scene_1' }, shotId: { type: 'string', const: 'shot_1' },
      advisoryOnly: { type: 'boolean', const: true }, items: { type: 'array', minItems: 1, maxItems: 8 },
    },
  },
  item: {
    requiredFields: ['id', 'field', 'proposedValue', 'impact'], optionalFields: [],
    additionalFieldsAllowed: false as const,
    fieldRules: {
      id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' },
      field: { type: 'string', enum: ['narrative', 'visual', 'action', 'durationSec'] },
      proposedValue: { dependentTypes: {
        narrative: { type: 'string', minLength: 1, maxLength: 2000, nonBlank: true },
        visual: { type: 'string', minLength: 1, maxLength: 2000, nonBlank: true },
        action: { type: 'string', minLength: 1, maxLength: 2000, nonBlank: true },
        durationSec: { type: 'number', minimum: 0.5, maximum: 30 },
      } },
      impact: { type: 'string', minLength: 1, maxLength: 500, nonBlank: true },
    },
  },
  relations: { uniqueItemFields: ['id', 'field'] },
  stringLength: { unit: 'unicode_code_points' as const },
  nullAndUnknown: { nullAllowed: false as const, unknownPlaceholderAllowed: false as const,
    noSuggestionAction: 'omit_item' as const,
    exactPlaceholderPolicy: {
      normalizedValues: ['unknown', '未知', '不确定', 'n/a', 'tbd', 'null', 'none'],
      normalization: { trim: 'ascii_whitespace' as const, case: 'ascii_lower' as const,
        unicodeNormalization: 'none' as const },
    } },
})
const workOrder = (): DirectorProviderDispatchPermit['workOrder'] => {
  const contract = outputContract()
  const body = { workOrderId: 'work_order_1', provider: 'fake', model: 'model_1',
    routeKey: 'fake.director', providerCapability: 'chat.agent' as const,
    inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
    outputSchema: 'qingmu.director-proposal.v1' as const, projectId: 'project_1', episodeId: 'episode_1',
    outputContract: contract, outputContractSha256: sha(contract),
    sceneId: 'scene_1', shotId: 'shot_1',
    methodPackage: { version: 'director-paid.v1', sha256: 'c'.repeat(64) },
    pricingSnapshot: { sha256: 'f'.repeat(64) },
    inputPolicy: { unit: 'utf8_bytes_upper_bound' as const, promptUtf8Bytes: 48, maxInputTokens: 2048 } }
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

const deepSeekPermit = (): DirectorProviderDispatchPermit => {
  const base = permit()
  const prompt = {
    schema: 'jason.qingmu-director-text-prompt.v1', purpose: 'director_text_proposal_canary',
    responseInstruction: base.workOrder.outputContract.responseInstruction,
    contextSnapshot: { contextSnapshotSha256: 'a'.repeat(64) },
    methodPackage: base.workOrder.methodPackage, outputSchema: base.workOrder.outputSchema,
    outputContract: base.workOrder.outputContract,
    outputContractSha256: base.workOrder.outputContractSha256,
  }
  const unsigned = {
    ...base.workOrder,
    provider: 'deepseek-official', model: 'deepseek-v4-pro', routeKey: 'test.director.deepseek',
    promptSha256: sha(prompt),
  } as Record<string, unknown>
  delete unsigned.workOrderSha256
  return {
    ...base,
    provider: 'deepseek-official', model: 'deepseek-v4-pro',
    promptSha256: sha(prompt),
    workOrder: { ...unsigned, workOrderSha256: sha(unsigned) } as unknown as DirectorProviderDispatchPermit['workOrder'],
    payload: {
      project_id: 'project_1', episode_id: 'episode_1', _requested_by_user_id: 'user_1',
      body: {
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: canonical(prompt) }],
        max_completion_tokens: 512, enable_thinking: false,
        estimated_input_tokens: 16000, estimated_output_tokens: 512,
      },
    },
  }
}

const binding = (): DirectorExecutionBinding => {
  const value = permit()
  const payloadSha256 = sha(value.payload)
  return {
    taskId: 'task_1', workOrderSha256: value.workOrder.workOrderSha256,
    contextSnapshotSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64),
    outputContractSha256: value.workOrder.outputContractSha256,
    requestSha256: sha({ capability: 'chat.agent', routeKey: value.workOrder.routeKey,
      provider: 'fake', model: 'model_1', payloadSha256 }), payloadSha256,
    provider: 'fake', model: 'model_1', routeKey: value.workOrder.routeKey,
    inputPolicy: value.workOrder.inputPolicy, methodPackageSha256: 'c'.repeat(64),
    pricingSnapshotSha256: 'f'.repeat(64), dispatchKey: '', dispatchEpoch: 0,
    claimToken: '', claimEpoch: 0, exclusiveExecutionLane: 'qingmu_director_host_permit_v1',
  }
}

const deepSeekBinding = (): DirectorExecutionBinding => {
  const value = deepSeekPermit()
  const payloadSha256 = sha(value.payload)
  return {
    taskId: value.generationTaskId,
    workOrderSha256: value.workOrder.workOrderSha256,
    contextSnapshotSha256: value.inputSha256,
    promptSha256: value.promptSha256,
    outputContractSha256: value.workOrder.outputContractSha256,
    requestSha256: sha({
      capability: value.workOrder.providerCapability,
      routeKey: value.workOrder.routeKey,
      provider: value.provider,
      model: value.model,
      payloadSha256,
    }),
    payloadSha256,
    provider: value.provider,
    model: value.model,
    routeKey: value.workOrder.routeKey,
    inputPolicy: value.workOrder.inputPolicy,
    methodPackageSha256: value.workOrder.methodPackage.sha256,
    pricingSnapshotSha256: value.workOrder.pricingSnapshot.sha256,
    dispatchKey: '', dispatchEpoch: 0, claimToken: '', claimEpoch: 0,
    exclusiveExecutionLane: 'qingmu_director_host_permit_v1',
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

  it('accepts the full four-field proposal allowed by the signed output contract', async () => {
    const full = {
      ...transportResult(),
      proposal: {
        ...transportResult().proposal,
        items: [
          { id: 'item_narrative', field: 'narrative' as const, proposedValue: '叙事建议', impact: '叙事影响' },
          { id: 'item_visual', field: 'visual' as const, proposedValue: '画面建议', impact: '画面影响' },
          { id: 'item_action', field: 'action' as const, proposedValue: '动作建议', impact: '动作影响' },
          { id: 'item_duration', field: 'durationSec' as const, proposedValue: 4.5, impact: '时长影响' },
        ],
      },
    }
    const result = await executeDirectorProviderPermit(
      permit(), { execute: async () => full }, new AbortController().signal,
    )
    expect(result).toMatchObject({ state: 'provider_result', receipt: { proposal: { items: full.proposal.items } } })
  })

  it.each([
    ['missing root field', (() => { const value = { ...transportResult().proposal } as Record<string, unknown>; delete value.shotId; return value })()],
    ['extra root field', { ...transportResult().proposal, extra: true }],
    ['bad item', { ...transportResult().proposal,
      items: [{ id: 'item_bad', field: 'durationSec', proposedValue: 31, impact: '越界' }] }],
  ])('fails %s closed under the signed output contract', async (_name, invalidProposal) => {
    const execute = vi.fn(async () => ({ ...transportResult(), proposal: invalidProposal }))
    const result = await executeDirectorProviderPermit(
      permit(), { execute: execute as never }, new AbortController().signal,
    )
    expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each([
    'unknown', 'UNKNOWN', ' unknown ', '未知', ' 不确定 ', 'N/A', ' n/a ', 'TBD', 'null', 'none', null,
  ])('rejects signed unknown placeholder %j in proposedValue and impact', async (placeholder) => {
    for (const fieldName of ['proposedValue', 'impact'] as const) {
      const item = { ...transportResult().proposal.items[0], [fieldName]: placeholder }
      const execute = vi.fn(async () => ({ ...transportResult(), proposal: {
        ...transportResult().proposal, items: [item],
      } }))
      const result = await executeDirectorProviderPermit(
        permit(), { execute: execute as never }, new AbortController().signal,
      )
      expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
      expect(execute).toHaveBeenCalledOnce()
    }
  })

  it.each([
    ['proposedValue', '😀'.repeat(2000), '😀'.repeat(2001)],
    ['impact', '😀'.repeat(500), '😀'.repeat(501)],
    ['proposedValue', 'e\u0301'.repeat(1000), `${'e\u0301'.repeat(1000)}x`],
  ] as const)('counts %s limits in Unicode code points', async (fieldName, accepted, rejected) => {
    const baseItem = transportResult().proposal.items[0]!
    const executeWith = async (value: string) => executeDirectorProviderPermit(
      permit(), { execute: async () => ({ ...transportResult(), proposal: {
        ...transportResult().proposal,
        items: [{ ...baseItem, [fieldName]: value }],
      } }) }, new AbortController().signal,
    )
    expect((await executeWith(accepted)).state).toBe('provider_result')
    expect(await executeWith(rejected)).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
  })

  it('uses the real DSh prepareCall and llm-deepseek stream exactly once', async () => {
    const response = JSON.stringify(transportResult().proposal)
    const server = await mockServer([{ kind: 'sse', headers: { 'x-request-id': 'request-real-1' }, events: [
      JSON.stringify({ id: 'completion-real-1', choices: [{ delta: { content: response } }] }),
      JSON.stringify({ id: 'completion-real-1', choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 } }),
      '[DONE]',
    ] }])
    const home = await mkdtemp(join(tmpdir(), 'qingmu-director-c0-'))
    const credentialsPath = join(home, '.credentials.env')
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  C0_DEEPSEEK_KEY: isolated-mock-key\n', { mode: 0o600 })
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: server.url, apiKeyEnv: 'C0_DEEPSEEK_KEY', thinking: 'disabled', reasoningEffort: 'off',
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    try {
      const result = await executeDirectorProviderPermit(
        deepSeekPermit(), createDshDeepSeekDirectorTransport(ctx.llm, { mockBaseUrl: server.url }),
        new AbortController().signal,
      )
      expect(result).toMatchObject({ state: 'provider_result', receipt: {
        providerCompletionId: 'completion-real-1', providerRequestId: 'request-real-1',
        finishReason: 'stop', usage: { promptTokens: 20, cacheTokens: 5, completionTokens: 10, totalTokens: 30 },
      } })
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]).toMatchObject({
        model: 'deepseek-v4-pro', response_format: { type: 'json_object' },
        stream: true,
      })
      expect(server.requests[0]).not.toHaveProperty('tools')
    } finally {
      await server.close()
      await rm(home, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })

  it('settles with the required completion id when the optional request header is absent', async () => {
    const response = JSON.stringify(transportResult().proposal)
    const server = await mockServer([{ kind: 'sse', events: [
      JSON.stringify({ id: 'completion-no-request-header', choices: [{ delta: { content: response } }] }),
      JSON.stringify({ id: 'completion-no-request-header', choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 } }),
      '[DONE]',
    ] }])
    vi.stubEnv('DEEPSEEK_API_KEY', 'isolated-mock-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: server.url, thinking: 'disabled', reasoningEffort: 'off',
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    try {
      const result = await executeDirectorProviderPermit(
        deepSeekPermit(), createDshDeepSeekDirectorTransport(ctx.llm, { mockBaseUrl: server.url }),
        new AbortController().signal,
      )
      expect(result).toMatchObject({ state: 'provider_result', receipt: {
        providerCompletionId: 'completion-no-request-header', providerRequestId: null,
      } })
      expect(server.requests).toHaveLength(1)
    } finally {
      await server.close()
      vi.unstubAllEnvs()
    }
  })

  it('allows only one of two concurrent Hosts to reach the real adapter POST', async () => {
    const response = JSON.stringify(transportResult().proposal)
    const server = await mockServer([{ kind: 'sse', headers: { 'x-request-id': 'request-concurrent-1' }, events: [
      JSON.stringify({ id: 'completion-concurrent-1', choices: [{ delta: { content: response } }] }),
      JSON.stringify({ id: 'completion-concurrent-1', choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: 5 } }),
      '[DONE]',
    ] }])
    vi.stubEnv('DEEPSEEK_API_KEY', 'isolated-concurrent-mock-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: server.url, thinking: 'disabled', reasoningEffort: 'off',
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    let claimed = false
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/binding')) return Response.json(deepSeekBinding())
      if (url.pathname.endsWith('/prepare')) {
        if (claimed) return new Response('{"detail":"not claimable"}', { status: 409 })
        claimed = true
        return Response.json(deepSeekPermit())
      }
      if (url.pathname.endsWith('/complete')) {
        return Response.json({ state: 'settled', generationTaskId: 'task_1', executionReceipt: { id: 'same' } })
      }
      throw new Error('unexpected request')
    }) as typeof fetch
    const execute = () => executeDirectorTaskOnce({
      baseUrl: 'http://127.0.0.1:49999',
      executionKey: 'execution-key-material-is-at-least-32-bytes',
      transport: createDshDeepSeekDirectorTransport(ctx.llm, { mockBaseUrl: server.url }),
      fetch: fetchImpl,
    }, 'task_1', 'director-paid.v1', 'c'.repeat(64), new AbortController().signal)
    try {
      const results = await Promise.allSettled([execute(), execute()])
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(item => item.status === 'rejected')).toHaveLength(1)
      expect(server.requests).toHaveLength(1)
    } finally {
      await server.close()
      vi.unstubAllEnvs()
    }
  })

  it.each([
    ['Markdown fenced JSON', { kind: 'sse', headers: { 'x-request-id': 'request-markdown' }, events: [
      '{"id":"completion-markdown","choices":[{"delta":{"content":"```json\\n{}\\n```"}}]}',
      '{"id":"completion-markdown","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '[DONE]',
    ] }],
    ['blank response', { kind: 'sse', headers: { 'x-request-id': 'request-blank' }, events: [
      '{"id":"completion-blank","choices":[{"delta":{"content":"   "}}]}',
      '{"id":"completion-blank","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '[DONE]',
    ] }],
    ['invalid JSON', { kind: 'sse', headers: { 'x-request-id': 'request-invalid-json' }, events: [
      '{"id":"completion-invalid-json","choices":[{"delta":{"content":"not-json"}}]}',
      '{"id":"completion-invalid-json","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '[DONE]',
    ] }],
    ['missing completion id', { kind: 'sse', headers: { 'x-request-id': 'request-missing-completion' }, events: [
      '{"choices":[{"delta":{"content":"{}"}}]}',
      '{"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '[DONE]',
    ] }],
    ['missing usage', { kind: 'sse', headers: { 'x-request-id': 'request-missing-usage' }, events: [
      '{"id":"completion-missing-usage","choices":[{"delta":{"content":"{}"}}]}',
      '{"id":"completion-missing-usage","choices":[{"finish_reason":"stop"}]}',
      '[DONE]',
    ] }],
    ['completion id drift', { kind: 'sse', headers: { 'x-request-id': 'request-drift' }, events: [
      '{"id":"completion-a","choices":[{"delta":{"content":"{}"}}]}',
      '{"id":"completion-b","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '[DONE]',
    ] }],
    ['redirect', { kind: 'http-error', status: 302, body: '', headers: { location: 'https://example.invalid/chat/completions' } }],
    ['transient 5xx', { kind: 'http-error', status: 503, body: '{"error":{"message":"later"}}' }],
    ['interrupted stream', { kind: 'close-early', events: [
      '{"id":"completion-interrupted","choices":[{"delta":{"content":"{"}}]}',
    ] }],
  ] satisfies ReadonlyArray<readonly [string, Behavior]>)('fails %s closed after at most one real adapter POST', async (_name, behavior) => {
    const server = await mockServer([behavior])
    vi.stubEnv('DEEPSEEK_API_KEY', 'isolated-mock-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: server.url, thinking: 'disabled', reasoningEffort: 'off',
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    })
    try {
      const result = await executeDirectorProviderPermit(
        deepSeekPermit(), createDshDeepSeekDirectorTransport(ctx.llm, { mockBaseUrl: server.url }),
        new AbortController().signal,
      )
      expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
      expect(server.requests).toHaveLength(1)
    } finally {
      await server.close()
      vi.unstubAllEnvs()
    }
  })

  it('rejects non-loopback mock endpoints before preparing or fetching', () => {
    const prepareCall = vi.fn()
    const llm: Pick<LlmRuntime, 'prepareCall'> = { prepareCall }
    expect(() => createDshDeepSeekDirectorTransport(
      llm,
      { mockBaseUrl: 'https://api.deepseek.com' },
    )).toThrow('must be HTTP loopback')
    expect(prepareCall).not.toHaveBeenCalled()
  })

  it('rejects prepared endpoint drift before consuming the stream', async () => {
    const stream = vi.fn(async function* () { yield { type: 'text-delta', text: '{}' } })
    const prepareCall = vi.fn(async () => ({
      transport: { baseURL: 'https://api.deepseek.com' },
      config: { model: 'deepseek-v4-pro' },
      retryPolicy: { mode: 'normal', maxRetries: 0 },
      stream,
    }))
    const result = await executeDirectorProviderPermit(
      deepSeekPermit(),
      createDshDeepSeekDirectorTransport(
        { prepareCall } as unknown as Pick<LlmRuntime, 'prepareCall'>,
        { mockBaseUrl: 'http://127.0.0.1:49152' },
      ),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
    expect(prepareCall).toHaveBeenCalledOnce()
    expect(stream).not.toHaveBeenCalled()
  })

  it('keeps the production transport inactive until execute and rejects non-production prepared origin', async () => {
    const stream = vi.fn(async function* () { yield { type: 'text-delta', text: '{}' } })
    const prepareCall = vi.fn(async () => ({
      transport: { baseURL: 'http://127.0.0.1:49152' },
      config: { model: 'deepseek-v4-pro' },
      retryPolicy: { mode: 'normal', maxRetries: 0 },
      stream,
    }))
    const transport = createDshDeepSeekProductionDirectorTransport(
      { prepareCall } as unknown as Pick<LlmRuntime, 'prepareCall'>,
    )
    expect(prepareCall).not.toHaveBeenCalled()
    const result = await executeDirectorProviderPermit(
      deepSeekPermit(), transport, new AbortController().signal,
    )
    expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
    expect(prepareCall).toHaveBeenCalledOnce()
    expect(stream).not.toHaveBeenCalled()
  })

  it('rejects a prompt above its conservative input-token byte bound before prepareCall', async () => {
    const permit = deepSeekPermit()
    const payload = permit.payload as { body: { estimated_input_tokens: number } }
    payload.body.estimated_input_tokens = 1
    const prepareCall = vi.fn()
    const result = await executeDirectorProviderPermit(
      permit,
      createDshDeepSeekProductionDirectorTransport(
        { prepareCall },
      ),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ state: 'submission_unknown', automaticRetry: false })
    expect(prepareCall).not.toHaveBeenCalled()
  })

  it('prepares a private lock without running a provider transport', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname
      if (path.endsWith('/binding')) return Response.json(deepSeekBinding())
      if (path.endsWith('/prepare')) return Response.json(deepSeekPermit())
      throw new Error('unexpected request')
    }) as typeof fetch
    const lock = await prepareDirectorTaskLock({
      baseUrl: 'http://127.0.0.1:49999',
      executionKey: 'execution-key-material-is-at-least-32-bytes',
      fetch: fetchImpl,
    }, 'task_1', 'director-paid.v1', 'c'.repeat(64), new AbortController().signal)
    expect(lock).toMatchObject({ binding: { taskId: 'task_1' }, permit: { state: 'dispatch_permitted' } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reads a pre-submit binding without claiming a dispatch permit', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname
      if (path.endsWith('/binding')) return Response.json(deepSeekBinding())
      throw new Error('unexpected request')
    }) as typeof fetch
    const binding = await readDirectorTaskBinding({
      baseUrl: 'http://127.0.0.1:49999',
      executionKey: 'execution-key-material-is-at-least-32-bytes',
      fetch: fetchImpl,
    }, 'task_1', new AbortController().signal)
    expect(binding).toMatchObject({ taskId: 'task_1', dispatchEpoch: 0, claimToken: '' })
    expect(fetchImpl).toHaveBeenCalledOnce()
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

  it('recovers submission_unknown through binding then prepare without transport', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      calls.push(url.pathname)
      if (url.pathname.endsWith('/binding')) return Response.json(binding())
      if (url.pathname.endsWith('/prepare')) {
        return Response.json({
          state: 'submission_unknown', generationTaskId: 'task_1', permit: null,
        })
      }
      throw new Error('unexpected request')
    }) as typeof fetch
    const chatCompletions = vi.fn(async () => transportResult())
    const recovered = await executeDirectorTaskOnce({
      baseUrl: 'http://127.0.0.1:49999',
      executionKey: 'execution-key-material-is-at-least-32-bytes',
      transport: createDeepSeekDirectorTransport({ chatCompletions }),
      fetch: fetchImpl,
    }, 'task_1', 'inactive-route-must-not-rebind', 'f'.repeat(64), new AbortController().signal)

    expect(recovered).toMatchObject({ state: 'submission_unknown', generationTaskId: 'task_1' })
    expect(calls).toEqual([
      '/internal/qingmu/director-inference/tasks/task_1/binding',
      '/internal/qingmu/director-inference/tasks/task_1/prepare',
    ])
    expect(chatCompletions).not.toHaveBeenCalled()
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

  it('rejects output-contract SHA drift before transport', async () => {
    const execute = vi.fn()
    const original = permit()
    const drifted = {
      ...original,
      workOrder: { ...original.workOrder, outputContractSha256: '9'.repeat(64) },
    }
    await expect(executeDirectorProviderPermit(
      drifted, { execute }, new AbortController().signal,
    )).rejects.toThrow('output contract mismatch')
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
