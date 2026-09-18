import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {
  DirectorContextSnapshot,
  DirectorReplayProposal,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { createDirectorContextBridge } from '../src/index.ts'
import { claimHostDirectorBinding, hasHostDirectorOwner, hasBrowserDirectorOwner,
  invalidateHostDirectorBinding, assertNativePromptSelection, refreshNativeDirectorBinding,
  withHostDirectorOperation, withHostDirectorStream } from '../src/bridge.ts'
import { appendRelayState, createRelayState, readRelayState } from '../src/relay-state.ts'
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

function beginRelay(session: Session) {
  const now = Date.now()
  return appendRelayState(session, createRelayState({ batchId: 'relay-1', projectId: firstScope.projectId,
    episodeId: firstScope.episodeId, instruction: '逐镜整理执行稿，保留导演判断。', director: { provider: 'mock', model: 'mock' },
    shots: [firstScope, secondScope].map(scope => ({ scope, label: scope.shotId, retake: false,
      parameters: { duration: 8, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false } })),
    authorization: { authorizationId: 'authorization-1', paidConfirmed: true, maxCostCny: '9.600000', maxCandidates: 2,
      expiresAt: new Date(now + 60_000).toISOString() } }, new Date(now).toISOString()), 0)
}

describe('Host relay director binding', () => {
  it('keeps the Host lease distinct from browser ownership and refuses browser mutations', async () => {
    const session = Session.create(SessionId('relay-director'))
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(firstScope, sha('a')) })
    const browser = createDirectorContextBridge(port)
    await browser.enter(session, firstScope, undefined, 'browser-1')
    beginRelay(session)
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    try {
      expect(await lease.enter(firstScope)).toMatchObject({ status: 'current' })
      expect(hasHostDirectorOwner(session)).toBe(true)
      expect(hasBrowserDirectorOwner(session)).toBe(false)
      const target = { schema: 'qingmu.native-director-request.v1' as const, sessionId: session.id,
        ownerId: 'relay-1', scope: firstScope, contextSnapshotSha256: sha('a') }
      expect(() => assertNativePromptSelection(session, target)).not.toThrow()
      expect(() => assertNativePromptSelection(session, { ...target, ownerId: 'browser-1' })).toThrow()
      const before = structuredClone(session.events)
      await expect(browser.enter(session, secondScope, undefined, 'browser-2')).rejects.toThrow(/relay/i)
      await expect(browser.enter(session, firstScope)).rejects.toThrow(/relay/i)
      expect(() => browser.clear(session, firstScope, 'browser-1')).toThrow(/relay/i)
      await expect(browser.recover(session)).rejects.toThrow(/relay/i)
      expect(() => browser.bindProposal(session, proposal(firstScope, sha('a')))).toThrow(/relay/i)
      expect(session.events).toEqual(before)
      expect(port.calls).toHaveLength(2)
    } finally { lease.release() }
  })

  it('allows native same-shot refresh without allowing an unlisted Host target', async () => {
    const session = Session.create(SessionId('relay-director'))
    beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(firstScope, sha('b')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    try {
      await lease.enter(firstScope)
      expect(await refreshNativeDirectorBinding(session, port)).toMatchObject({ status: 'current', state: {
        binding: { scope: firstScope, contextSnapshotSha256: sha('b') },
      } })
      await expect(lease.enter({ ...firstScope, shotId: 'not-authorized' })).rejects.toThrow(/scope|shot/i)
      expect(port.calls).toEqual([firstScope, firstScope])
    } finally { lease.release() }
  })

  it('invalidates an older browser read before the Host publishes its binding', async () => {
    const session = Session.create(SessionId('relay-director'))
    const waiting = deferred<DirectorContextReadResult>()
    const browser = createDirectorContextBridge({ readDirectorContext: () => waiting.promise })
    const old = browser.enter(session, firstScope, undefined, 'old-browser')
    beginRelay(session)
    const lease = claimHostDirectorBinding(session, 'relay-1', queuedPort({ ok: true, context: context(secondScope, sha('b')) }))
    try {
      await lease.enter(secondScope)
      waiting.resolve({ ok: true, context: context(firstScope, sha('a')) })
      expect(await old).toMatchObject({ status: 'superseded' })
      expect(browser.current(session)).toMatchObject({ binding: { scope: secondScope } })
    } finally { lease.release() }
  })

  it('rejects duplicate ownership and prevents an old release from clearing a new lease', async () => {
    const session = Session.create(SessionId('relay-director'))
    beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const first = claimHostDirectorBinding(session, 'relay-1', port)
    expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/owner|lease|relay/i)
    first.release()
    const second = claimHostDirectorBinding(session, 'relay-1', port)
    try {
      first.release()
      expect(hasHostDirectorOwner(session)).toBe(true)
      await expect(first.enter(firstScope)).rejects.toThrow(/owner|lease|relay/i)
      expect(await second.enter(firstScope)).toMatchObject({ status: 'current' })
    } finally { second.release() }
  })

  it('keeps an invalidated Host lease closed until explicit release and reacquisition', async () => {
    const session = Session.create(SessionId('relay-invalidated'))
    const state = beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(firstScope, sha('a')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    try {
      await lease.enter(firstScope)
      invalidateHostDirectorBinding(session)
      appendRelayState(session, { ...state, revision: 2, mode: 'paused' }, 1)
      appendRelayState(session, { ...state, revision: 3, mode: 'running' }, 2)
      await expect(lease.enter(firstScope)).rejects.toThrow(/lease/i)
      await expect(refreshNativeDirectorBinding(session, port)).rejects.toThrow(/lease/i)
      await expect(withHostDirectorOperation(session, async () => 'unexpected')).rejects.toThrow(/lease/i)
      await expect(withHostDirectorStream(session, async function* () { yield 'unexpected' }).next()).rejects.toThrow(/lease/i)
      expect(() => assertNativePromptSelection(session, {
        schema: 'qingmu.native-director-request.v1', sessionId: session.id,
        ownerId: 'relay-1', scope: firstScope, contextSnapshotSha256: sha('a'),
      })).toThrow(/previous shot selection/i)
      expect(port.calls).toEqual([firstScope])
      expect(hasHostDirectorOwner(session)).toBe(true)
      expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
      lease.release()
      const next = claimHostDirectorBinding(session, 'relay-1', port)
      try {
        expect(await next.enter(firstScope)).toMatchObject({ status: 'current' })
      } finally { next.release() }
    } finally { lease.release() }
  })

  it('retains an invalidated Host lease until its released operation settles', async () => {
    const session = Session.create(SessionId('relay-invalidated-busy'))
    beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    await lease.enter(firstScope)
    const waiting = deferred<undefined>()
    const operation = withHostDirectorOperation(session, () => waiting.promise)
    try {
      invalidateHostDirectorBinding(session)
      lease.release()
      expect(hasHostDirectorOwner(session)).toBe(true)
      expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
    } finally {
      waiting.resolve(undefined)
      await operation
      lease.release()
    }
    expect(hasHostDirectorOwner(session)).toBe(false)
    const next = claimHostDirectorBinding(session, 'relay-1', port)
    next.release()
  })

  it('does not publish a pending browser read after a relay intent is logged', async () => {
    const session = Session.create(SessionId('relay-director'))
    const waiting = deferred<DirectorContextReadResult>()
    const browser = createDirectorContextBridge({ readDirectorContext: () => waiting.promise })
    const old = browser.enter(session, firstScope, undefined, 'old-browser')
    beginRelay(session)
    waiting.resolve({ ok: true, context: context(firstScope, sha('a')) })
    expect(await old).toMatchObject({ status: 'superseded' })
    expect(browser.current(session)).toBeNull()
  })

  it('does not publish a Host read after its lease is released', async () => {
    const session = Session.create(SessionId('relay-director'))
    beginRelay(session)
    const waiting = deferred<DirectorContextReadResult>()
    const port = { readDirectorContext: () => waiting.promise }
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    const pending = lease.enter(firstScope)
    lease.release()
    try {
      waiting.resolve({ ok: true, context: context(firstScope, sha('a')) })
      expect(await pending).toMatchObject({ status: 'superseded' })
      expect(createDirectorContextBridge(port).current(session)).toBeNull()
      await expect(lease.enter(firstScope)).rejects.toThrow(/relay/i)
    } finally { lease.release() }
  })

  it('publishes a zero-authority selection read while paused but still blocks execution', async () => {
    const session = Session.create(SessionId('relay-director'))
    const state = beginRelay(session)
    const waiting = deferred<DirectorContextReadResult>()
    const port = { readDirectorContext: () => waiting.promise }
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    const pending = lease.enter(firstScope)
    appendRelayState(session, { ...state, revision: 2, mode: 'paused' }, 1)
    try {
      waiting.resolve({ ok: true, context: context(firstScope, sha('a')) })
      // A paused batch stays enterable so the driver can select the shot before admitting it back to running.
      expect(await pending).toMatchObject({ status: 'current', state: { binding: { scope: firstScope } } })
      expect(createDirectorContextBridge(port).current(session)).toMatchObject({ binding: { scope: firstScope } })
      expect(await lease.enter(firstScope)).toMatchObject({ status: 'current' })
      // Execution still requires a running batch, so a paused lease admits no paid or write effect.
      await expect(withHostDirectorOperation(session, async () => 'unexpected')).rejects.toThrow(/lease/i)
      await expect(withHostDirectorStream(session, async function* () { yield 'unexpected' }).next()).rejects.toThrow(/lease/i)
    } finally { lease.release() }
  })

  it.each([false, true])('retains the lease until an asynchronous operation settles (reject=%s)', async (reject) => {
    const session = Session.create(SessionId('relay-director'))
    beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    await lease.enter(firstScope)
    const waiting = deferred<undefined>()
    const operation = withHostDirectorOperation(session, async () => {
      await waiting.promise
      if (reject) throw new Error('operation failed')
      return 'saved'
    })
    await expect(lease.enter(secondScope)).rejects.toThrow(/operation|busy/i)
    lease.release()
    expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
    waiting.resolve(undefined)
    if (reject) await expect(operation).rejects.toThrow('operation failed')
    else expect(await operation).toBe('saved')
    expect(hasHostDirectorOwner(session)).toBe(false)
    const next = claimHostDirectorBinding(session, 'relay-1', port)
    next.release()
    expect(port.calls).toEqual([firstScope])
  })

  it.each(['complete', 'return', 'throw'] as const)('retains the lease through stream cleanup on %s', async (outcome) => {
    const session = Session.create(SessionId('relay-stream'))
    beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    await lease.enter(firstScope)
    const cleaning = deferred<undefined>()
    const settled = deferred<undefined>()
    const stream = withHostDirectorStream(session, async function* () {
      try {
        yield 'first'
        if (outcome === 'throw') throw new Error('stream failed')
      } finally {
        cleaning.resolve(undefined)
        await settled.promise
      }
    })[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({ value: 'first', done: false })
    await expect(lease.enter(secondScope)).rejects.toThrow(/operation|busy/i)
    lease.release()
    expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
    const finish = outcome === 'return' ? stream.return!(undefined) : stream.next()
    const checked = outcome === 'throw'
      ? expect(finish).rejects.toThrow('stream failed')
      : expect(finish).resolves.toMatchObject({ done: true })
    await cleaning.promise
    expect(hasHostDirectorOwner(session)).toBe(true)
    expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
    settled.resolve(undefined)
    await checked
    expect(hasHostDirectorOwner(session)).toBe(false)
    const successor = claimHostDirectorBinding(session, 'relay-1', port)
    successor.release()
  })

  it('loads the required relay event through JSONL and keeps the cold session closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-relay-cold-'))
    const first = new Context()
    const second = new Context()
    try {
      await first.plugin(SessionStore)
      await first.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const session = first.sessions.create(SessionId('relay-cold'), { meta: { cwd: root } })
      const original = beginRelay(session)
      expect(await first.sessions.flush(session)).toBe(true)
      await first.fiber.dispose()
      await second.plugin(SessionStore)
      await second.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const loaded = await second.sessionPersistence.load(session.id)
      const restored = Session.create(session.id, loaded.events)
      expect(readRelayState(restored)).toEqual(original)
      const port = queuedPort()
      await expect(refreshNativeDirectorBinding(restored, port)).rejects.toThrow(/relay/i)
      expect(port.calls).toEqual([])
    } finally {
      await first.fiber.dispose()
      await second.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns closed batches to browser ownership only after Host cleanup and release', async () => {
    const session = Session.create(SessionId('relay-closed'))
    const state = beginRelay(session)
    const port = queuedPort({ ok: true, context: context(firstScope, sha('a')) },
      { ok: true, context: context(secondScope, sha('b')) })
    const lease = claimHostDirectorBinding(session, 'relay-1', port)
    const browser = createDirectorContextBridge(port)
    await lease.enter(firstScope)
    const waiting = deferred<undefined>()
    const operation = withHostDirectorOperation(session, () => waiting.promise)
    try {
      appendRelayState(session, { ...state, revision: 2, mode: 'closed',
        items: state.items.map(item => ({ ...item, phase: 'abandoned' })) }, 1)
      await expect(browser.enter(session, secondScope, undefined, 'browser')).rejects.toThrow(/relay/i)
      lease.release()
      await expect(browser.enter(session, secondScope, undefined, 'browser')).rejects.toThrow(/relay/i)
      expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
      expect(port.calls).toEqual([firstScope])
    } finally {
      waiting.resolve(undefined)
      await operation
      lease.release()
    }
    expect(() => claimHostDirectorBinding(session, 'relay-1', port)).toThrow(/lease/i)
    expect(await browser.enter(session, secondScope, undefined, 'browser')).toMatchObject({ status: 'current' })
    expect(hasBrowserDirectorOwner(session)).toBe(true)
  })

  it('keeps replayed unfinished work closed without a live Host owner', async () => {
    const session = Session.create(SessionId('relay-director'))
    beginRelay(session)
    const restored = Session.create(session.id, structuredClone(session.events))
    const port = queuedPort()
    const browser = createDirectorContextBridge(port)
    expect(hasHostDirectorOwner(restored)).toBe(false)
    await expect(browser.enter(restored, firstScope, undefined, 'browser')).rejects.toThrow(/relay/i)
    await expect(refreshNativeDirectorBinding(restored, port)).rejects.toThrow(/relay/i)
    expect(() => claimHostDirectorBinding(restored, 'another-batch', port)).toThrow(/relay/i)
    expect(port.calls).toHaveLength(0)
  })
})

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

  it('clears the old binding before a switch and keeps failed switches unbound after cold replay', async () => {
    const session = Session.create(SessionId('failed-switch'))
    const initial = createDirectorContextBridge(queuedPort({ ok: true, context: context(firstScope, sha('a')) }))
    await initial.enter(session, firstScope)
    initial.bindProposal(session, proposal(firstScope, sha('a')))
    const read = deferred<DirectorContextReadResult>()
    const bridge = createDirectorContextBridge({ readDirectorContext: () => read.promise })
    const switching = bridge.enter(session, secondScope)

    expect(bridge.current(session)).toBeNull()
    expect(bridge.freshnessRequest(session)).toBeNull()
    read.resolve({ ok: false, reason: 'context_unavailable' })
    expect(await switching).toMatchObject({ status: 'unavailable', state: null, changed: true })
    const resumed = Session.create(session.id, structuredClone(session.events))
    expect(await initial.recover(resumed)).toEqual({ status: 'unbound', manualWorkAllowed: true })
    expect(initial.current(resumed)).toBeNull()
  })

  it('does not let unbound recovery or rejected proposals cancel an in-flight switch', async () => {
    const session = Session.create(SessionId('switch-recovery'))
    const initial = createDirectorContextBridge(queuedPort({ ok: true, context: context(firstScope, sha('a')) }))
    await initial.enter(session, firstScope)
    const read = deferred<DirectorContextReadResult>()
    const bridge = createDirectorContextBridge({ readDirectorContext: () => read.promise })
    const switching = bridge.enter(session, secondScope)

    expect(await bridge.recover(session)).toEqual({ status: 'unbound', manualWorkAllowed: true })
    expect(() => bridge.bindProposal(session, proposal(firstScope, sha('a')))).toThrow(/unbound/u)
    read.resolve({ ok: true, context: context(secondScope, sha('2')) })
    expect((await switching).status).toBe('current')
    expect(bridge.current(session)?.binding.scope).toEqual(secondScope)
  })

  it('releases a view lease after native refresh and cannot let old same-shot cleanup clear a new lease', async () => {
    const bridge = createDirectorContextBridge({ readDirectorContext: async scope => ({ ok: true, context: context(scope, sha('a')) }) })
    const session = Session.create(SessionId('view-leases'))
    await bridge.enter(session, firstScope, undefined, 'old-view')
    await bridge.enter(session, firstScope, undefined, 'new-view')
    expect(bridge.clear(session, firstScope, 'old-view').status).toBe('superseded')
    expect(bridge.clear(session, secondScope, 'new-view').status).toBe('superseded')
    await bridge.enter(session, firstScope)
    expect(bridge.clear(session, firstScope, 'new-view')).toEqual({
      status: 'cleared', state: null, changed: true, manualWorkAllowed: true,
    })
    const resumed = Session.create(session.id, structuredClone(session.events))
    expect(await bridge.recover(resumed)).toEqual({ status: 'unbound', manualWorkAllowed: true })

    await bridge.enter(session, firstScope, undefined, 'another-view')
    await bridge.enter(session, secondScope)
    expect(bridge.clear(session, firstScope, 'another-view').status).toBe('superseded')
    expect(bridge.current(session)?.binding.scope).toEqual(secondScope)
  })

  it('clears a pending selection without letting late success restore it', async () => {
    const session = Session.create(SessionId('clear-pending'))
    const initial = createDirectorContextBridge(queuedPort({ ok: true, context: context(firstScope, sha('a')) }))
    await initial.enter(session, firstScope, undefined, 'old-view')
    const read = deferred<DirectorContextReadResult>()
    const bridge = createDirectorContextBridge({ readDirectorContext: () => read.promise })
    const switching = bridge.enter(session, secondScope, undefined, 'new-view')
    expect(bridge.clear(session, firstScope, 'old-view').status).toBe('superseded')
    expect(bridge.clear(session, secondScope, 'new-view').status).toBe('cleared')
    read.resolve({ ok: true, context: context(secondScope, sha('b')) })
    expect((await switching).status).toBe('superseded')
    expect(bridge.current(session)).toBeNull()
  })

  it('does not transfer ownership on a pre-aborted entry or honor pre-restart leases', async () => {
    const session = Session.create(SessionId('lease-restart'))
    const bridge = createDirectorContextBridge(queuedPort({ ok: true, context: context(firstScope, sha('a')) }))
    await bridge.enter(session, firstScope, undefined, 'old-view')
    await bridge.enter(session, secondScope, AbortSignal.abort(), 'aborted-view')
    expect(bridge.clear(session, secondScope, 'aborted-view').status).toBe('superseded')
    const resumed = Session.create(session.id, structuredClone(session.events))
    // Restart restores the successful binding, not an old browser's runtime ownership.
    expect(bridge.clear(resumed, firstScope, 'old-view').status).toBe('superseded')
    expect(bridge.current(resumed)?.binding.scope).toEqual(firstScope)
    expect(bridge.clear(session, firstScope, 'old-view').status).toBe('cleared')
  })

  it('ignores aborted entry before mutation and late success after a switch is cancelled', async () => {
    const session = Session.create(SessionId('cancelled-switch'))
    const initial = createDirectorContextBridge(queuedPort({ ok: true, context: context(firstScope, sha('a')) }))
    await initial.enter(session, firstScope)
    const read = deferred<DirectorContextReadResult>()
    let reads = 0
    const bridge = createDirectorContextBridge({ readDirectorContext: () => { reads += 1; return read.promise } })
    await bridge.enter(session, secondScope, AbortSignal.abort())
    expect(reads).toBe(0)
    expect(bridge.current(session)?.binding.scope).toEqual(firstScope)

    const controller = new AbortController()
    const switching = bridge.enter(session, secondScope, controller.signal)
    controller.abort()
    read.resolve({ ok: true, context: context(secondScope, sha('2')) })
    expect(await switching).toMatchObject({ status: 'unavailable', state: null, changed: true })
    expect(bridge.current(session)).toBeNull()
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
