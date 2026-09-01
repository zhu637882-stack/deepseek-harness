import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { Context } from '@deepseek-ai/cordis'
import type { ImagoDirectorReplayMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengWorkflowProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createQingmuProjectContextHandler, foldProjectContext } from '../src/index.ts'
import * as ProjectContextInvariant from '../src/invariant.ts'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const D = 'd'.repeat(64)
const E = 'e'.repeat(64)

function workflow(options: { shotId?: string; shotSceneId?: string; revision?: number; shotSha?: string } = {}): YimengWorkflowProjection {
  const shotId = options.shotId ?? 'shot-01'
  return {
    schema: 'jason.episode-workflow-projection.v1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    director: {
      shotRelations: {
        storyboardRevision: {
          episodeRevision: options.revision ?? 7,
          revisionId: 'storyboard-r7',
          revisionVersion: options.revision ?? 7,
          sourceSha256: A,
        },
        scenes: [{ sceneId: 'scene-1', name: 'Scene', profileRevision: 3, snapshotSha256: B }],
        shots: [{
          shotId,
          frameNo: shotId === 'shot-01' ? 1 : 2,
          sceneId: options.shotSceneId ?? 'scene-1',
          title: 'Opening',
          durationSec: 4,
          dialogueRhythm: { mode: 'no_dialogue', cues: [] },
          beats: [],
          elements: [],
        }],
        valid: true,
        blockers: [],
      },
      heroFrameStoryboards: {
        shots: [{ shotId, shotSnapshotSha256: options.shotSha ?? C, heroFrame: null, canvas: null, blockers: [] }],
      },
    },
  } as unknown as YimengWorkflowProjection
}

const method: ImagoDirectorReplayMethodResponse = {
  schema: 'qingmu.imago-director-replay-method-package.v1',
  version: 'qingmu.director-replay.v1',
  sourceBindings: [{ path: 'knowledge/method.md', sha256: D }],
  integrationCoordinates: ['H2', 'H3-precondition-replay'],
  suggestionTypes: {
    text_director_proposal: {
      capability: 'director.text.proposal',
      outputSchema: 'qingmu.director-proposal.v1',
      limits: { advisoryOnly: true, maxShots: 1 },
    },
    visual_finding: {
      capability: 'director.visual.finding',
      outputSchema: 'qingmu.visual-review-proposal.v1',
      limits: { advisoryOnly: true, maxShots: 1, pixelReview: false },
    },
  },
  authority: {
    businessTruth: 'yimeng',
    methodSource: 'imago_os',
    inferenceHost: 'harness_dsh',
    replayOnly: true,
    providerCalls: 0,
    maximumCostCny: '0',
    humanDecisionInferred: false,
    formalQcInferred: false,
    selectionGranted: false,
    readyGranted: false,
  },
  methodPackageSha256: E,
}

function harness(initial: YimengWorkflowProjection = workflow(), seed?: readonly never[]) {
  let current = initial
  const session = Session.create(SessionId('session-1'), seed)
  const flush = vi.fn(async () => true)
  const readYimeng: ConnectionRpcHandler = vi.fn(async endpoint => endpoint === 'workflow'
    ? { ok: true as const, value: current }
    : { ok: false as const, error: { code: 'bad-request' as const, message: 'unexpected endpoint', details: { issues: [] } } })
  const runImagoMethod: ConnectionRpcHandler = vi.fn(async () => ({ ok: true as const, value: method }))
  const handler = createQingmuProjectContextHandler({
    sessions: { get: id => id === session.id ? session : undefined, flush },
    readYimeng,
    runImagoMethod,
  })
  return { session, handler, flush, readYimeng, runImagoMethod, setWorkflow: (value: YimengWorkflowProjection) => { current = value } }
}

async function call(handler: ConnectionRpcHandler, endpoint: string, payload: object) {
  return handler(endpoint, { sessionId: 'session-1', ...payload }, new AbortController().signal)
}

describe('Qingmu project context', () => {
  it('binds exact project coordinates and emits deterministic zero-authority proposals', async () => {
    const test = harness()
    const bound = await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    expect(bound).toMatchObject({ ok: true, value: { state: { status: 'current', binding: {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
      revision: { episodeRevision: 7, storyboardRevisionId: 'storyboard-r7', sceneProfileRevision: 3 },
      sha256: { storyboardSource: A, sceneSnapshot: B, shotSnapshot: C },
    } } } })

    const first = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    const second = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true, value: { status: 'proposed', manualWorkBlocked: false, proposal: {
      currentObject: { shotId: 'shot-01' },
      authority: {
        advisoryOnly: true, proposedChangeSetOnly: true, providerCalls: 0, maximumCostCny: '0',
        businessWrites: 0, budgetWrites: 0, approvalWrites: 0, humanSignoff: false,
        autoSave: false, autoApprove: false, submitGeneration: false,
      },
    } } })
    expect(test.readYimeng).toHaveBeenCalledWith('workflow', { projectId: 'project-1', episodeId: 'episode-1' }, expect.any(AbortSignal))
    expect(test.runImagoMethod).toHaveBeenCalledWith(
      'directorReplayMethod', { purpose: 'bounded_director_suggestion' }, expect.any(AbortSignal),
    )
    expect(test.session.events.filter(event => event.type === 'qingmu/director-proposal-receipt')).toHaveLength(2)
  })

  it('switches the current Shot by appending one whole-value binding', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    test.setWorkflow(workflow({ shotId: 'shot-02' }))
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-02',
    })
    expect(foldProjectContext(test.session.events)).toMatchObject({ status: 'current', binding: { shotId: 'shot-02' } })
    const proposal = await call(test.handler, 'suggest', { suggestionType: 'visual_finding' })
    expect(proposal).toMatchObject({ ok: true, value: { status: 'proposed', proposal: {
      schema: 'qingmu.visual-review-proposal.v1', suggestionType: 'visual_finding', currentObject: { shotId: 'shot-02' },
    } } })
  })

  it('invalidates the binding on revision or SHA drift and requires an explicit refresh', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    test.setWorkflow(workflow({ revision: 8, shotSha: D }))
    const result = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: true, value: {
      status: 'refresh_required', proposal: null, manualWorkBlocked: false,
    } })
    if (!result.ok) throw new Error('expected a refresh-required result')
    const value = result.value as { staleReasons: readonly string[] }
    expect(value.staleReasons).toEqual(expect.arrayContaining(['episode_revision_changed', 'shot_snapshot_changed']))
    expect(foldProjectContext(test.session.events)).toMatchObject({ status: 'stale' })
    expect(test.runImagoMethod).not.toHaveBeenCalled()
  })

  it('marks a removed Shot stale after a successful source read', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    test.setWorkflow(workflow({ shotId: 'shot-02' }))
    const result = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: true, value: {
      status: 'refresh_required', staleReasons: ['shot_missing'], proposal: null,
    } })
    expect(foldProjectContext(test.session.events)).toMatchObject({ status: 'stale', staleReasons: ['shot_missing'] })
    expect(test.runImagoMethod).not.toHaveBeenCalled()
  })

  it('marks a Shot moved to another Scene stale after a successful source read', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    test.setWorkflow(workflow({ shotSceneId: 'scene-2' }))
    const result = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: true, value: {
      status: 'refresh_required', staleReasons: ['shot_scene_changed'], proposal: null,
    } })
    expect(foldProjectContext(test.session.events)).toMatchObject({
      status: 'stale', staleReasons: ['shot_scene_changed'],
    })
    expect(test.runImagoMethod).not.toHaveBeenCalled()
  })

  it('marks an unexpected workflow subject stale without corrupting the replay chain', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const wrongSubject = structuredClone(workflow()) as unknown as { projectId: string }
    wrongSubject.projectId = 'project-2'
    test.setWorkflow(wrongSubject as unknown as YimengWorkflowProjection)
    const result = await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: true, value: {
      status: 'refresh_required', staleReasons: ['workflow_subject_changed'], proposal: null,
    } })
    expect(foldProjectContext(test.session.events)).toMatchObject({
      status: 'stale', staleReasons: ['workflow_subject_changed'],
    })
    expect(test.runImagoMethod).not.toHaveBeenCalled()
  })

  it('restores the current object from session events after a stop/start boundary', async () => {
    const first = harness()
    await call(first.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const restored = Session.create(SessionId('session-1'), structuredClone(first.session.events))
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => restored, flush: async () => false },
    })
    const result = await call(handler, 'current', {})
    expect(result).toMatchObject({ ok: true, value: { state: { status: 'current', binding: { shotId: 'shot-01' } } } })
  })

  it('leaves manual work available when the replay method is not installed', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => test.session, flush: async () => false },
      readYimeng: test.readYimeng,
    })
    const result = await call(handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: true, value: {
      status: 'method_unavailable', proposal: null, manualWorkBlocked: false,
    } })
    expect(foldProjectContext(test.session.events)).toMatchObject({ status: 'current' })
  })

  it('does not misreport a session flush failure as invalid input', async () => {
    const test = harness()
    const handler = createQingmuProjectContextHandler({
      sessions: {
        get: () => test.session,
        flush: async () => { throw new Error('session persistence failed') },
      },
      readYimeng: test.readYimeng,
    })
    const result = await call(handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', message: 'session persistence failed' } })
  })

  it('rejects a tampered binding identity and a receipt detached from its binding', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    await call(test.handler, 'suggest', { suggestionType: 'text_director_proposal' })
    const tamperedBinding = structuredClone(test.session.events) as SessionEvent[]
    const context = tamperedBinding.find(event => event.type === 'qingmu/project-context')
    if (context?.type !== 'qingmu/project-context') throw new Error('missing context event')
    const mutableBinding = context.data as unknown as { state: { binding: { sha256: { contextSnapshot: string } } } }
    mutableBinding.state.binding.sha256.contextSnapshot = A
    expect(() => foldProjectContext(tamperedBinding)).toThrow('context snapshot')

    const detachedReceipt = structuredClone(test.session.events) as SessionEvent[]
    const receipt = detachedReceipt.find(event => event.type === 'qingmu/director-proposal-receipt')
    if (receipt?.type !== 'qingmu/director-proposal-receipt') throw new Error('missing proposal receipt')
    const mutableReceipt = receipt.data as unknown as { bindingSha256: string }
    mutableReceipt.bindingSha256 = B
    expect(() => foldProjectContext(detachedReceipt)).toThrow('does not match the current binding')
  })

  it('preserves upstream cancellation instead of converting it into availability status', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => test.session, flush: test.flush },
      readYimeng: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'cancelled' as const, message: 'cancelled by caller', details: {} },
      })),
      runImagoMethod: test.runImagoMethod,
    })
    const result = await call(handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(test.runImagoMethod).not.toHaveBeenCalled()
  })

  it('preserves IMAGO method cancellation instead of converting it into availability status', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => test.session, flush: test.flush },
      readYimeng: test.readYimeng,
      runImagoMethod: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'cancelled' as const, message: 'cancelled by caller', details: {} },
      })),
    })
    const result = await call(handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(test.session.events.filter(event => event.type === 'qingmu/director-proposal-receipt')).toHaveLength(0)
  })

  it('rejects an IMAGO method response that grants downstream authority', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const unsafeMethod = structuredClone(method) as unknown as {
      authority: { selectionGranted: boolean }
    }
    unsafeMethod.authority.selectionGranted = true
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => test.session, flush: test.flush },
      readYimeng: test.readYimeng,
      runImagoMethod: vi.fn(async () => ({ ok: true as const, value: unsafeMethod })),
    })
    const result = await call(handler, 'suggest', { suggestionType: 'text_director_proposal' })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(test.session.events.filter(event => event.type === 'qingmu/director-proposal-receipt')).toHaveLength(0)
  })

  it('does not append a receipt when the binding changes during an async suggestion', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    let resolveMethod!: (value: { ok: true; value: ImagoDirectorReplayMethodResponse }) => void
    const pendingMethod = new Promise<{ ok: true; value: ImagoDirectorReplayMethodResponse }>((resolve) => {
      resolveMethod = resolve
    })
    const handler = createQingmuProjectContextHandler({
      sessions: { get: () => test.session, flush: test.flush },
      readYimeng: test.readYimeng,
      runImagoMethod: vi.fn(async () => pendingMethod),
    })
    const pendingSuggestion = call(handler, 'suggest', { suggestionType: 'text_director_proposal' })
    await vi.waitFor(() => {
      expect(test.readYimeng).toHaveBeenCalledTimes(2)
    })
    test.setWorkflow(workflow({ shotId: 'shot-02' }))
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-02',
    })
    resolveMethod({ ok: true, value: method })
    const result = await pendingSuggestion
    expect(result).toMatchObject({ ok: true, value: {
      status: 'refresh_required', staleReasons: ['binding_changed_during_suggestion'], proposal: null,
    } })
    expect(foldProjectContext(test.session.events)).toMatchObject({ status: 'current', binding: { shotId: 'shot-02' } })
    expect(test.session.events.filter(event => event.type === 'qingmu/director-proposal-receipt')).toHaveLength(0)
  })

  it('round-trips the exact binding through a remounted JSONL session backend', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-project-context-'))
    const id = SessionId('session-1')
    try {
      const writer = new Context()
      await writer.plugin(SessionStore)
      await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const session = writer.sessions.create(id, { meta: { cwd: '/work' } })
      const writerHandler = createQingmuProjectContextHandler({
        sessions: writer.sessions,
        readYimeng: vi.fn(async () => ({ ok: true as const, value: workflow() })),
      })
      await call(writerHandler, 'bind', {
        projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
      })
      const expected = foldProjectContext(session.events)
      await writer.fiber.dispose()

      const reader = new Context()
      await reader.plugin(SessionStore)
      await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const loaded = await reader.sessionPersistence.load(id)
      const restored = Session.create(id, loaded.events)
      const readerHandler = createQingmuProjectContextHandler({
        sessions: { get: () => restored, flush: async () => false },
      })
      expect(await call(readerHandler, 'current', {})).toMatchObject({ ok: true, value: { state: expected } })
      await reader.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a detached receipt before the session log changes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantService, { enabled: true })
    await ctx.plugin(ProjectContextInvariant)
    const session = ctx.sessions.create(SessionId('session-1'))
    const handler = createQingmuProjectContextHandler({
      sessions: ctx.sessions,
      readYimeng: vi.fn(async () => ({ ok: true as const, value: workflow() })),
    })
    await call(handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const before = session.events.length
    expect(() => {
      session.append('qingmu/director-proposal-receipt', {
        schema: 'qingmu.director-proposal-receipt.v1',
        projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-02',
        suggestionType: 'text_director_proposal',
        bindingSha256: A, methodPackageSha256: D, proposalSha256: E,
        authority: {
          advisoryOnly: true, proposedChangeSetOnly: true, providerCalls: 0, maximumCostCny: '0',
          businessWrites: 0, budgetWrites: 0, approvalWrites: 0, humanSignoff: false,
          autoSave: false, autoApprove: false, submitGeneration: false,
        },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT', packageName: '@deepseek-ai/dsh-experimental-qingmu-project-context',
    }))
    expect(session.events).toHaveLength(before)
    await ctx.fiber.dispose()
  })

  it('rejects undeclared fields before they can bypass compact event identities', async () => {
    const test = harness()
    await call(test.handler, 'bind', {
      projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-01',
    })
    const events = structuredClone(test.session.events) as SessionEvent[]
    const context = events.find(event => event.type === 'qingmu/project-context')
    if (context?.type !== 'qingmu/project-context') throw new Error('missing context event')
    const data = context.data as unknown as { state: { binding: Record<string, unknown> } }
    data.state.binding.projectProse = 'must never enter the compact session identity'
    expect(() => foldProjectContext(events)).toThrow('must contain only the declared fields')
  })
})
