import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {
  DirectorContextSnapshot,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextBridge } from '../src/index.ts'
import type {
  DirectorContextReadPort,
  DirectorContextReadResult,
  DirectorObjectScope,
} from '../src/types.ts'

const sha = (character: string): string => character.repeat(64)
const firstScope: DirectorObjectScope = {
  projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-1',
}
const secondScope: DirectorObjectScope = {
  projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-2', shotId: 'shot-2',
}

function context(scope: DirectorObjectScope, contextSha: string): DirectorContextSnapshot {
  return {
    schema: 'jason.qingmu-director-context-snapshot.v1',
    ...scope,
    contextSnapshotSha256: contextSha,
    providerCalls: 0,
    costAmountCny: '0',
    businessStateChanged: false,
    humanDecisionInferred: false,
    formalQcInferred: false,
    selectionGranted: false,
    readyGranted: false,
  } as DirectorContextSnapshot
}

function proposal(scope: DirectorObjectScope, contextSha: string, id = 'proposal-1'): DirectorReplayProposal {
  return {
    schema: 'qingmu.director-replay-proposal.v1',
    ...scope,
    proposalId: id,
    inputSha256: contextSha,
    outputSha256: sha('b'),
    proposalSha256: sha('c'),
    stale: false,
    staleReasons: [],
    advisoryOnly: true,
    execution: {
      mode: 'deterministic_replay_fixture', providerResult: false, networkUsed: false,
      providerCalls: 0, costAmountCny: '0',
    },
    methodPackage: {
      version: 'qingmu.director-replay.v1',
      methodPackageSha256: sha('d'),
    },
    workOrder: {
      workOrderId: 'work-order-1',
      workOrderSha256: sha('e'),
      promptSha256: sha('f'),
      inputSha256: contextSha,
    },
  } as unknown as DirectorReplayProposal
}

function queuedPort(...results: DirectorContextReadResult[]): DirectorContextReadPort & { calls: DirectorObjectScope[] } {
  const calls: DirectorObjectScope[] = []
  return {
    calls,
    async readDirectorContext(scope) {
      calls.push({ ...scope })
      const result = results.shift()
      if (result === undefined) throw new Error('unexpected context read')
      return result
    },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('Qingmu director context bridge', () => {
  it('binds one session to exact project, episode, scene, shot and context SHA coordinates', async () => {
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const bridge = createDirectorContextBridge(port)
    const session = Session.create(SessionId('binding'))

    const result = await bridge.enter(session, firstScope)

    expect(result).toMatchObject({ status: 'current', changed: true, manualWorkAllowed: true })
    if (result.status !== 'current') throw new Error('expected current binding')
    expect(result.state.binding).toEqual({ scope: firstScope, contextSnapshotSha256: sha('a') })
    expect(result.state.proposal).toBeNull()
    expect(result.state.transition).toBe('enter')
    expect(port.calls).toEqual([firstScope])
    expect(session.deriveMessages()).toEqual([])
  })

  it('switches objects without carrying the previous proposal into the new context', async () => {
    const port = queuedPort(
      { ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(secondScope, sha('2')) },
    )
    const bridge = createDirectorContextBridge(port)
    const session = Session.create(SessionId('switch'))
    await bridge.enter(session, firstScope)
    bridge.bindProposal(session, proposal(firstScope, sha('a')))

    const switched = await bridge.enter(session, secondScope)

    if (switched.status !== 'current') throw new Error('expected current switched binding')
    expect(switched.state.binding.scope).toEqual(secondScope)
    expect(switched.state.binding.contextSnapshotSha256).toBe(sha('2'))
    expect(switched.state.proposal).toBeNull()
    expect(switched.state.transition).toBe('switch')
    expect(switched.invalidatedProposalId).toBe('proposal-1')
    expect(bridge.freshnessRequest(session)).toBeNull()
  })

  it('keeps the latest object when concurrent entries complete out of order', async () => {
    const firstRead = deferred<DirectorContextReadResult>()
    const secondRead = deferred<DirectorContextReadResult>()
    const port: DirectorContextReadPort = {
      readDirectorContext: scope => scope.shotId === firstScope.shotId ? firstRead.promise : secondRead.promise,
    }
    const bridge = createDirectorContextBridge(port)
    const session = Session.create(SessionId('concurrent-switch'))

    const enterFirst = bridge.enter(session, firstScope)
    const enterSecond = bridge.enter(session, secondScope)
    secondRead.resolve({ ok: true, context: context(secondScope, sha('2')) })
    expect((await enterSecond).status).toBe('current')
    firstRead.resolve({ ok: true, context: context(firstScope, sha('a')) })

    expect(await enterFirst).toMatchObject({ status: 'superseded', changed: false, manualWorkAllowed: true })
    expect(bridge.current(session)?.binding).toEqual({ scope: secondScope, contextSnapshotSha256: sha('2') })
  })

  it('recovers the binding and proposal from a stopped session event log', async () => {
    const initialPort = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const initialBridge = createDirectorContextBridge(initialPort)
    const session = Session.create(SessionId('cold-recovery'))
    await initialBridge.enter(session, firstScope)
    initialBridge.bindProposal(session, proposal(firstScope, sha('a')))
    const persistedEvents = structuredClone(session.events)

    const resumed = Session.create(SessionId('cold-recovery'), persistedEvents)
    const recoveryPort = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const recovered = await createDirectorContextBridge(recoveryPort).recover(resumed)

    expect(recovered.status).toBe('current')
    expect(recovered.status === 'current' && recovered.state.proposal?.proposalId).toBe('proposal-1')
    expect(recoveryPort.calls).toEqual([firstScope])
  })

  it('invalidates an old proposal automatically when recovery observes context SHA drift', async () => {
    const initialPort = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const initialBridge = createDirectorContextBridge(initialPort)
    const session = Session.create(SessionId('drift'))
    await initialBridge.enter(session, firstScope)
    initialBridge.bindProposal(session, proposal(firstScope, sha('a')))

    const driftPort = queuedPort({ ok: true, context: context(firstScope, sha('9')) })
    const bridge = createDirectorContextBridge(driftPort)
    const recovered = await bridge.recover(session)

    expect(recovered).toMatchObject({
      status: 'drifted',
      previousContextSnapshotSha256: sha('a'),
      invalidatedProposalId: 'proposal-1',
      manualWorkAllowed: true,
    })
    expect(recovered.status === 'drifted' && recovered.state).toMatchObject({
      binding: { scope: firstScope, contextSnapshotSha256: sha('9') },
      proposal: null,
      transition: 'recovery_drift',
    })
    expect(bridge.freshnessRequest(session)).toBeNull()
  })

  it('does not let an older recovery overwrite a later object entry', async () => {
    const initial = createDirectorContextBridge(queuedPort({
      ok: true, context: context(firstScope, sha('a')),
    }))
    const session = Session.create(SessionId('recovery-switch-race'))
    await initial.enter(session, firstScope)

    const recoveryRead = deferred<DirectorContextReadResult>()
    const switchRead = deferred<DirectorContextReadResult>()
    const port: DirectorContextReadPort = {
      readDirectorContext: scope => scope.shotId === firstScope.shotId ? recoveryRead.promise : switchRead.promise,
    }
    const bridge = createDirectorContextBridge(port)
    const recovering = bridge.recover(session)
    const switching = bridge.enter(session, secondScope)
    switchRead.resolve({ ok: true, context: context(secondScope, sha('2')) })
    expect((await switching).status).toBe('current')
    recoveryRead.resolve({ ok: true, context: context(firstScope, sha('9')) })

    expect((await recovering).status).toBe('superseded')
    expect(bridge.current(session)?.binding).toEqual({ scope: secondScope, contextSnapshotSha256: sha('2') })
  })

  it('rejects persisted proposal coordinates that do not match the active binding', async () => {
    const secondSession = Session.create(SessionId('second-proposal-source'))
    const secondBridge = createDirectorContextBridge(queuedPort({
      ok: true, context: context(secondScope, sha('2')),
    }))
    await secondBridge.enter(secondSession, secondScope)
    const secondState = secondBridge.bindProposal(secondSession, proposal(secondScope, sha('2'), 'proposal-2'))
    const poisoned = Session.create(SessionId('poisoned-binding'))
    poisoned.append('qingmu-director-context/state', {
      version: 1,
      binding: { scope: firstScope, contextSnapshotSha256: sha('a') },
      proposal: secondState.proposal,
      transition: 'proposal_attached',
    })

    const bridge = createDirectorContextBridge(queuedPort())
    expect(() => bridge.current(poisoned)).toThrow(/proposal coordinates and context SHA/u)
    expect(() => bridge.freshnessRequest(poisoned)).toThrow(/proposal coordinates and context SHA/u)
  })

  it('preserves manual work and the last known binding when context or model capability is unavailable', async () => {
    const initialPort = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const bridge = createDirectorContextBridge(initialPort)
    const session = Session.create(SessionId('unavailable'))
    await bridge.enter(session, firstScope)
    bridge.bindProposal(session, proposal(firstScope, sha('a')))
    const eventCount = session.events.length

    const unavailable = await createDirectorContextBridge(queuedPort({
      ok: false, reason: 'model_unavailable',
    })).recover(session)

    expect(unavailable).toMatchObject({
      status: 'unavailable', reason: 'model_unavailable', manualWorkAllowed: true,
    })
    expect(session.events).toHaveLength(eventCount)
    expect(bridge.current(session)?.proposal?.proposalId).toBe('proposal-1')
  })

  it('does not block manual work when the first context entry is unavailable', async () => {
    const session = Session.create(SessionId('unavailable-entry'))
    const unavailable = await createDirectorContextBridge(queuedPort({
      ok: false, reason: 'model_unavailable',
    })).enter(session, firstScope)

    expect(unavailable).toEqual({
      status: 'unavailable', state: null, changed: false,
      reason: 'model_unavailable', manualWorkAllowed: true,
    })
    expect(session.deriveMessages()).toEqual([])
  })

  it('keeps manual work available for context unavailability and thrown read errors', async () => {
    const unavailableSession = Session.create(SessionId('context-unavailable-entry'))
    const unavailable = await createDirectorContextBridge(queuedPort({
      ok: false, reason: 'context_unavailable',
    })).enter(unavailableSession, firstScope)
    const thrownSession = Session.create(SessionId('thrown-context-entry'))
    const thrown = await createDirectorContextBridge({
      async readDirectorContext() { throw new Error('offline') },
    }).enter(thrownSession, firstScope)

    expect(unavailable).toMatchObject({
      status: 'unavailable', reason: 'context_unavailable', manualWorkAllowed: true,
    })
    expect(thrown).toMatchObject({
      status: 'unavailable', reason: 'context_unavailable', manualWorkAllowed: true,
    })
    expect(unavailableSession.events).toHaveLength(0)
    expect(thrownSession.events).toHaveLength(0)
  })

  it('emits only log-only bridge state and performs no business or Provider operation', async () => {
    const port = queuedPort(
      { ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(firstScope, sha('a')) },
    )
    const bridge = createDirectorContextBridge(port)
    const session = Session.create(SessionId('zero-writes'))
    await bridge.enter(session, firstScope)
    await bridge.recover(session)

    expect(session.events.filter(event => event.type !== 'session/end-seed')
      .map(event => event.type)).toEqual(['qingmu-director-context/state'])
    expect(port.calls).toHaveLength(2)
    expect(session.deriveMessages()).toEqual([])
  })
})
