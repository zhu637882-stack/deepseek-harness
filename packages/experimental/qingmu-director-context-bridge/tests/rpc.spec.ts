import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { DirectorContextSnapshot, DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import type { DirectorObjectScope } from '../src/types.ts'
import { canonical, savedDraft } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'
import { normalizeReferenceVideoDraft } from '../../qingmu-yimeng-read-adapter/src/reference-video.ts'

const sha = (value: string): string => value.repeat(64)
const scope: DirectorObjectScope = { projectId: 'project_1', episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1' }
const context = (target = scope): DirectorContextSnapshot => ({
  schema: 'jason.qingmu-director-context-snapshot.v1', ...target, contextSnapshotSha256: sha(target.shotId === 'shot_1' ? 'a' : 'b'),
  providerCalls: 0, costAmountCny: '0', businessStateChanged: false, humanDecisionInferred: false,
  formalQcInferred: false, selectionGranted: false, readyGranted: false,
} as DirectorContextSnapshot)
const proposal = (): DirectorReplayProposal => ({
  schema: 'qingmu.director-replay-proposal.v1', ...scope, proposalId: 'proposal_1', inputSha256: sha('a'),
  outputSha256: sha('c'), proposalSha256: sha('d'), stale: false, staleReasons: [], advisoryOnly: true,
  execution: { mode: 'deterministic_replay_fixture', providerResult: false, networkUsed: false, providerCalls: 0, costAmountCny: '0' },
  methodPackage: { version: '1.0.0', methodPackageSha256: sha('e') },
  workOrder: { workOrderId: 'work_order_1', workOrderSha256: sha('f'), promptSha256: sha('1'), inputSha256: sha('a') },
} as unknown as DirectorReplayProposal)

describe('loopback director context RPC facade', () => {
  it('inspects only attached session tools and rejects malformed or cancelled reads without writing events', async () => {
    const session = Session.create(SessionId('session_1'))
    const readDirectorContext = vi.fn()
    const inspect = vi.fn(() => ({ status: 'inactive' as const, presetId: null, tools: [], missingTools: [] }))
    const handler = createDirectorContextRpcHandler({ get: id => String(id) === 'session_1' ? session : undefined },
      { readDirectorContext }, undefined, inspect)
    const signal = new AbortController().signal
    expect(await handler('readNativeDirectorReadiness', { sessionId: 'session_1' }, signal))
      .toMatchObject({ ok: true, value: { status: 'inactive' } })
    expect(inspect).toHaveBeenCalledExactlyOnceWith(session)
    expect(await handler('readNativeDirectorReadiness', { sessionId: 'missing' }, signal)).toMatchObject({ ok: false })
    expect(await handler('readNativeDirectorReadiness', { sessionId: 'session_1', start: true }, signal)).toMatchObject({ ok: false })
    const cancelled = new AbortController(); cancelled.abort()
    expect(await handler('readNativeDirectorReadiness', { sessionId: 'session_1' }, cancelled.signal)).toMatchObject({ ok: false })
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(readDirectorContext).not.toHaveBeenCalled()
    expect(session.events).toHaveLength(0)
    const legacy = createDirectorContextRpcHandler({ get: () => session }, { readDirectorContext })
    expect(await legacy('readNativeDirectorReadiness', { sessionId: 'session_1' }, signal))
      .toMatchObject({ ok: true, value: { status: 'unavailable' } })
  })
  it('releases only the current browser owner and validates clear fields before mutation', async () => {
    const session = Session.create(SessionId('session_1'))
    const handler = createDirectorContextRpcHandler({ get: () => session }, {
      readDirectorContext: async target => ({ ok: true, context: context(target) }),
    })
    const signal = new AbortController().signal
    await handler('enter', { sessionId: 'session_1', scope, ownerId: 'old' }, signal)
    await handler('enter', { sessionId: 'session_1', scope, ownerId: 'new' }, signal)
    expect(await handler('clear', { sessionId: 'session_1', scope, ownerId: 'old' }, signal))
      .toMatchObject({ ok: true, value: { status: 'superseded', changed: false } })
    expect(await handler('clear', { sessionId: 'session_1', scope, ownerId: '../invalid' }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('clear', { sessionId: 'session_1', scope, ownerId: 'new', approve: true }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('clear', { sessionId: 'session_1', scope, ownerId: 'new' }, signal))
      .toMatchObject({ ok: true, value: { status: 'cleared', state: null } })
  })
  it('persists only safe scope/SHA bindings and invalidates a proposal on shot switch', async () => {
    const session = Session.create(SessionId('session_1'))
    const readDirectorContext = vi.fn(async (target: DirectorObjectScope) => ({ ok: true as const, context: context(target) }))
    const handler = createDirectorContextRpcHandler({ get: () => session }, { readDirectorContext })
    const signal = new AbortController().signal

    const entered = await handler('enter', { sessionId: 'session_1', scope }, signal)
    expect(entered).toMatchObject({ ok: true, value: { status: 'current', state: {
      binding: { scope, contextSnapshotSha256: sha('a') }, proposal: null,
    } } })
    const bound = await handler('bindProposal', { sessionId: 'session_1', proposal: proposal() }, signal)
    expect(bound).toMatchObject({ ok: true, value: { status: 'bound', state: { proposal: { proposalId: 'proposal_1' } } } })
    const second = { ...scope, shotId: 'shot_2' }
    const switched = await handler('enter', { sessionId: 'session_1', scope: second }, signal)
    expect(switched).toMatchObject({ ok: true, value: { status: 'current', invalidatedProposalId: 'proposal_1',
      state: { binding: { scope: second, contextSnapshotSha256: sha('b') }, proposal: null } } })
    const serialized = JSON.stringify([entered, bound, switched])
    expect(serialized).not.toMatch(/token|permit|claim|providerPayload|authorization/i)
  })

  it('fails closed before state changes for an unknown session, malformed scope, or forged proposal lineage', async () => {
    const session = Session.create(SessionId('session_1'))
    const handler = createDirectorContextRpcHandler({ get: id => String(id) === 'session_1' ? session : undefined }, {
      readDirectorContext: async target => ({ ok: true, context: context(target) }),
    })
    const signal = new AbortController().signal
    expect(await handler('enter', { sessionId: 'missing', scope }, signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('enter', { sessionId: 'session_1', scope: { ...scope, shotId: '../escape' } }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(session.events).toHaveLength(0)
    await handler('enter', { sessionId: 'session_1', scope }, signal)
    const forged = { ...proposal(), inputSha256: sha('9') }
    expect(await handler('bindProposal', { sessionId: 'session_1', proposal: forged }, signal))
      .toEqual({ ok: false, error: { code: 'internal', message: 'Director context bridge unavailable', details: {} } })
    expect(session.events.filter(event => event.type === 'qingmu-director-context/state')).toHaveLength(1)
  })
})

function handoffWorld(completed = true) {
  const session = Session.create(SessionId('session_1'))
  const request = { ...savedDraft.draft.request, frameId: scope.shotId, directorSourceSha256: sha('4') }
  const requestSha256 = createHash('sha256').update(canonical(request)).digest('hex')
  const receipt = { schema: 'qingmu.native-reference-saved.v1', scope, revision: 1,
    requestSha256, frameSha256: savedDraft.frameSha256,
    directorSourceSha256: sha('4'), contextSnapshotSha256: sha('a'), activeShotChanged: false, generationQueued: false }
  const message = createUserMessage({ source: { kind: 'user' }, content: [
    { type: 'text', text: JSON.stringify({ schema: 'qingmu.native-director-request.v1', sessionId: session.id,
      ownerId: 'browser-1', scope, contextSnapshotSha256: sha('a') }) },
    { type: 'text', text: '整理并保存本镜执行稿，不生成。' },
  ] })
  session.append('turn/start', { turn: 0 })
  session.append('user/message', message, { surfaceOp: 'append' })
  const callId = CallId('saved')
  session.append('tool/call', { turn: 0, step: 0, callId, name: 'qingmu_save_reference_draft', arguments: '{}' })
  session.append('tool/result', { turn: 0, step: 0, message: createToolResultMessage({ callId,
    content: [{ type: 'text', text: JSON.stringify(receipt) }], isError: false }) }, { surfaceOp: 'append' })
  if (completed) session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
  const current = { context: context(), draft: { ...structuredClone(savedDraft), projectId: scope.projectId,
    frameId: scope.shotId, directorSource: { sha256: sha('4'), prompt: '当前设计' },
    draft: { ...structuredClone(savedDraft.draft), request, requestSha256 } } }
  normalizeReferenceVideoDraft(current.draft, { projectId: scope.projectId, frameId: scope.shotId },
    value => createHash('sha256').update(canonical(value)).digest('hex'))
  const read = vi.fn<ConnectionRpcHandler>(async (endpoint, payload) => {
    expect(endpoint).toBe('referenceVideoDraft')
    expect(payload).toEqual({ projectId: scope.projectId, frameId: scope.shotId })
    return { ok: true, value: structuredClone(current.draft) }
  })
  const port = { readDirectorContext: vi.fn(async (requested: DirectorObjectScope) => {
    expect(requested).toEqual(scope)
    return { ok: true as const, context: structuredClone(current.context) }
  }) }
  const handler = createDirectorContextRpcHandler({ get: id => id === session.id ? session : undefined }, port, undefined, undefined, read)
  const payload = { sessionId: session.id, messageId: message.id, scope }
  const signal = new AbortController().signal
  return { session, receipt, current, read, port, handler, payload, signal }
}

describe('reference handoff RPC', () => {
  it('returns only the verified saved identity without changing the session or writing to Writer', async () => {
    const h = handoffWorld()
    const before = JSON.stringify(h.session.events)
    expect(await h.handler('readReferenceHandoff', h.payload, h.signal)).toEqual({ ok: true, value: {
      status: 'ready', ...h.receipt, messageId: h.payload.messageId, turn: 0, endSeq: h.session.events.at(-1)!.seq,
    } })
    expect(h.read).toHaveBeenCalled()
    expect(h.port.readDirectorContext).toHaveBeenCalled()
    expect(JSON.stringify(h.session.events)).toBe(before)
  })

  it('does not inspect Writer until the exact request has completed', async () => {
    const h = handoffWorld(false)
    expect(await h.handler('readReferenceHandoff', h.payload, h.signal)).toEqual({ ok: true, value: { status: 'waiting' } })
    expect(h.read).not.toHaveBeenCalled()
    expect(h.port.readDirectorContext).not.toHaveBeenCalled()
  })

  it.each(['revision', 'request', 'frame', 'saved-frame', 'director-source', 'saved-source', 'context', 'foreign-frame', 'foreign-context'] as const)(
    'blocks a saved handoff after %s changes', async (change) => {
      const h = handoffWorld()
      if (change === 'revision') h.current.draft.draft.revision++
      if (change === 'request') h.current.draft.draft.requestSha256 = sha('9')
      if (change === 'frame') h.current.draft.frameSha256 = sha('9')
      if (change === 'saved-frame') h.current.draft.draft.frameSha256 = sha('9')
      if (change === 'director-source') h.current.draft.directorSource.sha256 = sha('9')
      if (change === 'saved-source') h.current.draft.draft.request.directorSourceSha256 = sha('9')
      if (change === 'context') h.current.context = { ...h.current.context, contextSnapshotSha256: sha('9') }
      if (change === 'foreign-frame') h.current.draft.frameId = 'other'
      if (change === 'foreign-context') h.current.context = context({ ...scope, shotId: 'other' })
      expect(await h.handler('readReferenceHandoff', h.payload, h.signal))
        .toMatchObject({ ok: true, value: { status: 'blocked', reason: 'reference_source_changed' } })
    })

  it.each(['context', 'draft', 'session'] as const)('blocks %s movement during source verification', async (change) => {
    const h = handoffWorld()
    h.read.mockImplementationOnce(async () => {
      const value = structuredClone(h.current.draft)
      if (change === 'context') h.current.context = { ...h.current.context, contextSnapshotSha256: sha('9') }
      if (change === 'draft') h.current.draft.draft.revision++
      if (change === 'session') h.session.append('turn/start', { turn: 1 })
      return { ok: true, value }
    })
    expect(await h.handler('readReferenceHandoff', h.payload, h.signal)).toMatchObject({ ok: true, value: { status: 'blocked' } })
  })

  it('fails closed when the draft reader is unavailable or fails', async () => {
    const h = handoffWorld()
    const handler = createDirectorContextRpcHandler({ get: () => h.session }, h.port)
    expect(await handler('readReferenceHandoff', h.payload, h.signal)).toEqual({ ok: true, value: { status: 'unavailable' } })
    h.read.mockRejectedValueOnce(new Error('private upstream details'))
    expect(await h.handler('readReferenceHandoff', h.payload, h.signal)).toEqual({ ok: true, value: { status: 'unavailable' } })
  })

  it('rejects malformed, foreign-session and cancelled requests before reading Writer', async () => {
    const h = handoffWorld()
    for (const payload of [ { ...h.payload, sessionId: 'missing' }, { ...h.payload, messageId: '../bad' },
      { ...h.payload, approve: true }, { ...h.payload, scope: { ...scope, shotId: '../bad' } } ]) {
      expect(await h.handler('readReferenceHandoff', payload, h.signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    const cancelled = new AbortController(); cancelled.abort()
    expect(await h.handler('readReferenceHandoff', h.payload, cancelled.signal)).toMatchObject({ ok: false })
    expect(h.read).not.toHaveBeenCalled()
    expect(h.port.readDirectorContext).not.toHaveBeenCalled()
  })
})
