import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import type { DirectorReplayProposal } from '../src/director-proposal.ts'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const requestBody = (body: BodyInit | null | undefined): string => typeof body === 'string' ? body : ''
const requestUrl = (value: string | URL | Request): string => {
  if (typeof value === 'string') return value
  return value instanceof URL ? value.href : value.url
}
const scope = { projectId: 'project_1', episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1' }
const methodBody = {
  schema: 'qingmu.imago-director-replay-method-package.v1', version: 'qingmu.director-replay.v1',
  sourceBindings: [{ path: 'knowledge/methods/plan.md', sha256: 'a'.repeat(64) }],
  integrationCoordinates: ['H2', 'H3-precondition-replay'],
  suggestionTypes: {
    text_director_proposal: { capability: 'director.text.proposal', outputSchema: 'qingmu.director-proposal.v1',
      limits: { advisoryOnly: true, maxShots: 1 } },
    visual_finding: { capability: 'director.visual.finding', outputSchema: 'qingmu.visual-review-proposal.v1',
      limits: { advisoryOnly: true, maxShots: 1, pixelReview: false } },
  },
  authority: { businessTruth: 'yimeng', methodSource: 'imago_os', inferenceHost: 'harness_dsh',
    replayOnly: true, providerCalls: 0, maximumCostCny: '0', humanDecisionInferred: false,
    formalQcInferred: false, selectionGranted: false, readyGranted: false },
} as const
const method = { ...methodBody, methodPackageSha256: sha(methodBody) }
const context = (narrative = '相遇') => {
  const body = { schema: 'jason.qingmu-director-context-snapshot.v1', ...scope,
    script: { revision: 1, sha256: 'b'.repeat(64) }, sceneSource: { sceneIndex: 1 },
    sourceScene: { sceneIndex: 1, title: '雨夜' },
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'c'.repeat(64), status: 'Ready' },
    shot: { id: 'shot_1', title: '门口', narrative, visual: '雨夜门口', action: '开门', durationSec: 3.5, dialogueLineIds: ['line_1'] },
    selectedReferences: [], sourceTime: '2026-08-29T00:00:00+00:00', providerCalls: 0,
    costAmountCny: '0', businessStateChanged: false, humanDecisionInferred: false,
    formalQcInferred: false, selectionGranted: false, readyGranted: false }
  return { ...body, contextSnapshotSha256: sha(body) }
}

function setup(stale = false) {
  let call = 0
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    call += 1
    if (call % 3 === 1) return Response.json(context())
    if (call % 3 === 0) return Response.json(stale ? context('来源已变化') : context())
    const request = JSON.parse(requestBody(init?.body)) as Record<string, unknown>
    const body = { schema: 'jason.qingmu-director-inference-work-order.v1',
      workOrderId: `director_work_order_${String(request.idempotencyKey).slice(0, 32)}`, ...scope,
      purpose: 'bounded_director_suggestion', suggestionType: request.suggestionType,
      methodCapability: request.methodCapability, outputSchema: request.outputSchema,
      executionProfile: 'deterministic_replay_fixture_v1',
      inputSha256: request.expectedContextSnapshotSha256,
      promptSha256: sha({ purpose: 'bounded_director_suggestion', suggestionType: request.suggestionType,
        capability: request.methodCapability, outputSchema: request.outputSchema,
        contextSnapshotSha256: request.expectedContextSnapshotSha256,
        methodPackageSha256: request.methodPackageSha256 }),
      methodPackage: { version: request.methodPackageVersion, sha256: request.methodPackageSha256 },
      idempotencyKey: request.idempotencyKey, budget: { mode: 'replay', currency: 'CNY', maximumAmount: '0', providerCalls: 0 },
      sourceTime: '2026-08-29T00:00:00+00:00', staleWhen: ['context_changed'], providerCalls: 0,
      costAmountCny: '0', businessStateChanged: false, humanDecisionInferred: false,
      formalQcInferred: false, selectionGranted: false, readyGranted: false }
    return Response.json({ ...body, workOrderSha256: sha(body) })
  })
  const runDirectorReplayMethod = vi.fn(async () => ({ ok: true as const, value: method }))
  return { fetch, runDirectorReplayMethod, handler: createYimengCommandHandler(
    { baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-token', runDirectorReplayMethod },
  ) }
}

describe('Host-only director replay proposal', () => {
  it('returns one deterministic advisory proposal and never calls a network Provider', async () => {
    const { handler, fetch, runDirectorReplayMethod } = setup()
    const request = { ...scope, suggestionType: 'text_director_proposal' }
    const first = await handler('requestDirectorProposal', request, new AbortController().signal)
    const second = await handler('requestDirectorProposal', request, new AbortController().signal)
    expect(second).toEqual(first)
    expect(first).toMatchObject({ ok: true, value: { schema: 'qingmu.director-replay-proposal.v1',
      proposalKind: 'DirectorProposal', stale: false, advisoryOnly: true,
      execution: { mode: 'deterministic_replay_fixture', providerResult: false, networkUsed: false, providerCalls: 0, costAmountCny: '0' },
      formalQcInferred: false, selectionGranted: false, readyGranted: false, humanDecisionInferred: false } })
    expect(runDirectorReplayMethod).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(fetch.mock.calls.every(([url]) => requestUrl(url).startsWith('http://127.0.0.1:49123/api/qingmu/'))).toBe(true)
  })

  it('checks all original proposal coordinates without executing replay a second time', async () => {
    const { handler, fetch, runDirectorReplayMethod } = setup()
    const proposalResult = await handler('requestDirectorProposal',
      { ...scope, suggestionType: 'text_director_proposal' }, new AbortController().signal)
    expect(proposalResult.ok).toBe(true)
    if (!proposalResult.ok) return
    const proposal = proposalResult.value as DirectorReplayProposal
    const freshnessRequest = { ...scope, contextSnapshotSha256: proposal.inputSha256,
      methodPackageVersion: proposal.methodPackage.version,
      methodPackageSha256: proposal.methodPackage.methodPackageSha256,
      workOrderId: proposal.workOrder.workOrderId, workOrderSha256: proposal.workOrder.workOrderSha256,
      promptSha256: proposal.workOrder.promptSha256, proposalId: proposal.proposalId,
      proposalSha256: proposal.proposalSha256, outputSha256: proposal.outputSha256 }
    const binding = { ...freshnessRequest } as Record<string, unknown>
    delete binding.projectId; delete binding.episodeId
    const body = { schema: 'jason.qingmu-director-proposal-freshness.v1', projectId: scope.projectId,
      episodeId: scope.episodeId, fresh: true, staleReasons: [], binding,
      currentContextSnapshotSha256: proposal.inputSha256, providerCalls: 0, costAmountCny: '0',
      businessStateChanged: false, humanDecisionInferred: false, formalQcInferred: false,
      selectionGranted: false, readyGranted: false }
    fetch.mockResolvedValueOnce(Response.json({ ...body, freshnessSha256: sha(body) }))
    const result = await handler('checkDirectorProposalFreshness', freshnessRequest, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { fresh: true, binding } })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(runDirectorReplayMethod).toHaveBeenCalledTimes(2)
  })

  it('fails freshness closed on an independent method package SHA drift without a Writer call', async () => {
    const setupResult = setup()
    const changedMethodBody = { ...methodBody,
      sourceBindings: [{ path: 'knowledge/methods/plan.md', sha256: 'f'.repeat(64) }] as const }
    setupResult.runDirectorReplayMethod.mockResolvedValueOnce({ ok: true as const, value: method })
      .mockResolvedValueOnce({ ok: true as const, value: {
        ...changedMethodBody, methodPackageSha256: sha(changedMethodBody),
      } })
    const proposalResult = await setupResult.handler('requestDirectorProposal',
      { ...scope, suggestionType: 'text_director_proposal' }, new AbortController().signal)
    expect(proposalResult.ok).toBe(true)
    if (!proposalResult.ok) return
    const proposal = proposalResult.value as DirectorReplayProposal
    const before = setupResult.fetch.mock.calls.length
    const result = await setupResult.handler('checkDirectorProposalFreshness', { ...scope,
      contextSnapshotSha256: proposal.inputSha256, methodPackageVersion: proposal.methodPackage.version,
      methodPackageSha256: proposal.methodPackage.methodPackageSha256,
      workOrderId: proposal.workOrder.workOrderId, workOrderSha256: proposal.workOrder.workOrderSha256,
      promptSha256: proposal.workOrder.promptSha256, proposalId: proposal.proposalId,
      proposalSha256: proposal.proposalSha256, outputSha256: proposal.outputSha256,
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { fresh: false, staleReasons: ['director_method_changed'] } })
    expect(setupResult.fetch).toHaveBeenCalledTimes(before)
  })

  it('marks a proposal stale when the post-inference source read drifts', async () => {
    const result = await setup(true).handler('requestDirectorProposal',
      { ...scope, suggestionType: 'visual_finding' }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { proposalKind: 'VisualReviewProposal', stale: true,
      staleReasons: ['director_context_or_method_changed'] } })
  })

  it('does not compound a replay suffix already adopted by the human', async () => {
    const { handler, fetch } = setup()
    fetch.mockImplementation(async (_url, init) => {
      if (!init?.body) return Response.json(context('相遇；明确本镜情绪落点。'))
      const request = JSON.parse(requestBody(init.body)) as Record<string, unknown>
      const body = { schema: 'jason.qingmu-director-inference-work-order.v1',
        workOrderId: `director_work_order_${String(request.idempotencyKey).slice(0, 32)}`, ...scope,
        purpose: 'bounded_director_suggestion', suggestionType: request.suggestionType,
        methodCapability: request.methodCapability, outputSchema: request.outputSchema,
        executionProfile: 'deterministic_replay_fixture_v1', inputSha256: request.expectedContextSnapshotSha256,
        promptSha256: sha({ purpose: 'bounded_director_suggestion', suggestionType: request.suggestionType,
          capability: request.methodCapability, outputSchema: request.outputSchema,
          contextSnapshotSha256: request.expectedContextSnapshotSha256,
          methodPackageSha256: request.methodPackageSha256 }),
        methodPackage: { version: request.methodPackageVersion, sha256: request.methodPackageSha256 },
        idempotencyKey: request.idempotencyKey, budget: { mode: 'replay', currency: 'CNY', maximumAmount: '0', providerCalls: 0 },
        sourceTime: '2026-08-29T00:00:00+00:00', staleWhen: ['context_changed'], providerCalls: 0,
        costAmountCny: '0', businessStateChanged: false, humanDecisionInferred: false,
        formalQcInferred: false, selectionGranted: false, readyGranted: false }
      return Response.json({ ...body, workOrderSha256: sha(body) })
    })
    const result = await handler('requestDirectorProposal',
      { ...scope, suggestionType: 'text_director_proposal' }, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value as { items: Array<{ field: string; originalValue: string; proposedValue: string }> }
    expect(value.items.find(item => item.field === 'narrative')).toMatchObject({
      originalValue: '相遇；明确本镜情绪落点。', proposedValue: '相遇；明确本镜情绪落点。',
    })
  })

  it('fails closed on extra browser fields before any read', async () => {
    const { handler, fetch, runDirectorReplayMethod } = setup()
    const result = await handler('requestDirectorProposal', { ...scope,
      suggestionType: 'text_director_proposal', paidProviderAuthority: true }, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled(); expect(runDirectorReplayMethod).not.toHaveBeenCalled()
  })
})
