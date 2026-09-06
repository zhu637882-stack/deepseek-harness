import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { DirectorContextSnapshot, DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import type { DirectorObjectScope } from '../src/types.ts'

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
