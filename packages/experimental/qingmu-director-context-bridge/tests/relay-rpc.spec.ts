import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createDirectorContextRpcHandler } from '../src/rpc.ts'
import { appendRelayState, createRelayState, readRelayState, type RelayStart } from '../src/relay-state.ts'
import { hasHostDirectorOwner } from '../src/bridge.ts'
import type { DirectorContextReadPort, DirectorObjectScope } from '../src/types.ts'

const sha = (character: string): string => character.repeat(64)
const expiry = (): string => new Date(Date.now() + 3_600_000).toISOString()

function startInput(): RelayStart {
  return {
    batchId: 'batch-1', projectId: 'project-1', episodeId: 'episode-1', instruction: 'Prepare these shots.',
    director: { provider: 'deepseek', model: 'deepseek-chat' },
    shots: ['shot-1', 'shot-2'].map(shotId => ({
      scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId },
      label: shotId, parameters: { duration: 5, resolution: '720P' as const, ratio: '16:9' as const, audio: true, prompt_extend: false },
      retake: false,
    })),
    authorization: { authorizationId: 'auth-1', paidConfirmed: true, maxCostCny: '0.300000', maxCandidates: 2, expiresAt: expiry() },
  }
}

function port(): DirectorContextReadPort {
  return {
    readDirectorContext: vi.fn(async () => {
      throw new Error('unexpected context read')
    }),
  }
}

function world() {
  const session = Session.create(SessionId('relay_session'))
  const handler = createDirectorContextRpcHandler({ get: id => id === session.id ? session : undefined }, port())
  const signal = new AbortController().signal
  return { session, handler, signal }
}

function admission(index: number, scope: DirectorObjectScope) {
  return {
    message: {
      id: `message-${index}`, role: 'user', source: { kind: 'user' },
      content: [
        { type: 'text', text: JSON.stringify({
          schema: 'qingmu.native-director-request.v1', sessionId: 'relay_session', ownerId: 'batch-1',
          scope, contextSnapshotSha256: sha('a'),
        }) },
        { type: 'text', text: 'Prepare this shot.' },
      ],
    },
    contextSnapshotSha256: sha('a'),
  }
}

async function startBatch(handler: ReturnType<typeof world>['handler'], signal: AbortSignal, input = startInput()) {
  const result = await handler('startRelayBatch', { sessionId: 'relay_session', input }, signal)
  expect(result).toMatchObject({ ok: true, value: { state: { mode: 'running', revision: 1 } } })
  return result
}

/** Append the durable preparation, submission and run evidence that production writes through relay execution. */
function settleItem(session: Session, index: number, at: { prepared: string; submitted: string; collected: string }): void {
  const admitted = readRelayState(session)!
  const item = admitted.items[index]!
  const latest = item.admissions.at(-1)!
  const handoff = {
    messageId: latest.message.id, turn: 0, endSeq: 0, revision: 1,
    requestSha256: sha('b'), frameSha256: sha('c'), directorSourceSha256: sha('d'), contextSnapshotSha256: sha('a'),
  }
  appendRelayState(session, {
    ...admitted, revision: admitted.revision + 1, updatedAt: at.prepared,
    items: admitted.items.map((other, offset) => offset === index
      ? { ...other, phase: 'prepared' as const, handoff, preparedAt: at.prepared }
      : other),
  }, admitted.revision)
  const submission = {
    projectId: item.scope.projectId, frameId: item.scope.shotId, requestId: `request_${index}_00000000`,
    expectedRevision: 1, expectedRequestSha256: sha('b'), quoteSha256: sha('e'),
    authorizationCapCny: '0.100000', paidConfirmed: true as const,
  }
  const prepared = readRelayState(session)!
  appendRelayState(session, {
    ...prepared, revision: prepared.revision + 1, updatedAt: at.submitted,
    items: prepared.items.map((other, offset) => offset === index
      ? { ...other, phase: 'submitting' as const, submission, submittedAt: at.submitted }
      : other),
  }, prepared.revision)
  const submitted = readRelayState(session)!
  appendRelayState(session, {
    ...submitted, revision: submitted.revision + 1, updatedAt: at.collected,
    items: submitted.items.map((other, offset) => offset === index
      ? {
        ...other,
        phase: 'collected' as const,
        run: { runId: `refvideo_${submission.requestId}`, taskId: `task-${index}`, publicStatus: 'succeeded' as const },
        settledAt: at.collected,
        collectedAt: at.collected,
      }
      : other),
  }, submitted.revision)
}

describe('readRelayState RPC', () => {
  it('returns null before any batch and the current state after start', async () => {
    const { handler, signal } = world()
    expect(await handler('readRelayState', { sessionId: 'relay_session' }, signal))
      .toEqual({ ok: true, value: null })
    await startBatch(handler, signal)
    expect(await handler('readRelayState', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { start: { batchId: 'batch-1' }, mode: 'running' } })
  })

  it('rejects malformed, extra-field and unknown-session reads', async () => {
    const { handler, signal } = world()
    expect(await handler('readRelayState', { sessionId: 'relay_session', verbose: true }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('readRelayState', { sessionId: 'missing' }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('readRelayState', { sessionId: '../escape' }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
})

describe('startRelayBatch RPC', () => {
  it('creates a running batch and holds the Host lease', async () => {
    const { session, handler, signal } = world()
    const result = await startBatch(handler, signal)
    expect(result).toMatchObject({ ok: true, value: { state: {
      start: { batchId: 'batch-1' }, mode: 'running', reason: null,
      items: [{ phase: 'pending' }, { phase: 'pending' }],
    } } })
    expect(hasHostDirectorOwner(session)).toBe(true)
    expect(session.events.filter(event => event.type === 'qingmu-director-relay/state')).toHaveLength(1)
  })

  it('rejects malformed payloads before any state change', async () => {
    const { session, handler, signal } = world()
    for (const payload of [
      { sessionId: 'relay_session' },
      { sessionId: 'relay_session', input: startInput(), approve: true },
      { sessionId: 'missing', input: startInput() },
    ]) {
      expect(await handler('startRelayBatch', payload, signal))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(session.events).toHaveLength(0)
    expect(hasHostDirectorOwner(session)).toBe(false)
  })

  it('fails closed on invalid input, expired authorization, and a second open batch', async () => {
    const { session, handler, signal } = world()
    expect(await handler('startRelayBatch', { sessionId: 'relay_session', input: { ...startInput(), shots: [] } }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    const expired = startInput()
    expired.authorization.expiresAt = '2020-01-01T00:00:00.000Z'
    expect(await handler('startRelayBatch', { sessionId: 'relay_session', input: expired }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(session.events).toHaveLength(0)
    await startBatch(handler, signal)
    expect(await handler('startRelayBatch', { sessionId: 'relay_session', input: startInput() }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(session.events.filter(event => event.type === 'qingmu-director-relay/state')).toHaveLength(1)
  })
})

describe('admitRelayDirector RPC', () => {
  it('atomically admits and transitions the item to preparing', async () => {
    const { session, handler, signal } = world()
    await startBatch(handler, signal)
    const scope = startInput().shots[0]!.scope
    expect(await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: admission(0, scope) }, signal))
      .toMatchObject({ ok: true, value: { state: {
        mode: 'running',
        items: [{ phase: 'preparing', admissions: [{ contextSnapshotSha256: sha('a') }] }, { phase: 'pending' }],
      } } })
    expect(session.events.filter(event => event.type === 'qingmu-director-relay/state')).toHaveLength(2)
  })

  it('rejects malformed payloads and fails closed on ledger violations', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    const scope = startInput().shots[0]!.scope
    const valid = admission(0, scope)
    for (const payload of [
      { sessionId: 'relay_session', index: 0 },
      { sessionId: 'relay_session', index: 0, admission: valid, approve: true },
      { sessionId: 'relay_session', index: 0.5, admission: valid },
      { sessionId: 'relay_session', index: 0, admission: null },
      { sessionId: 'missing', index: 0, admission: valid },
    ]) {
      expect(await handler('admitRelayDirector', payload, signal))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(await handler('admitRelayDirector', { sessionId: 'relay_session', index: 9, admission: valid }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: valid }, signal)
    expect(await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: valid }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('allows the first admission on a paused batch and resumes it', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    await handler('advanceRelayBatch', { sessionId: 'relay_session' }, signal)
    const scope = startInput().shots[0]!.scope
    expect(await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: admission(0, scope) }, signal))
      .toMatchObject({ ok: true, value: { state: { mode: 'running', items: [{ phase: 'preparing' }, { phase: 'pending' }] } } })
  })
})

describe('advanceRelayBatch RPC', () => {
  it('pauses a running batch without admissions', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    expect(await handler('advanceRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { state: { mode: 'paused', reason: 'awaiting_director_admission' } } })
  })

  it('rejects extra fields and fails closed when pause is not applicable', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    expect(await handler('advanceRelayBatch', { sessionId: 'relay_session', index: 0 }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler('advanceRelayBatch', { sessionId: 'missing' }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    const scope = startInput().shots[0]!.scope
    await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: admission(0, scope) }, signal)
    expect(await handler('advanceRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })
})

describe('closeRelayBatch RPC', () => {
  it('closes with a reason, abandons pending items, and releases the Host lease', async () => {
    const { session, handler, signal } = world()
    await startBatch(handler, signal)
    expect(await handler('closeRelayBatch', { sessionId: 'relay_session', reason: 'operator cancelled' }, signal))
      .toMatchObject({ ok: true, value: { state: {
        mode: 'closed', reason: 'operator cancelled',
        items: [{ phase: 'abandoned' }, { phase: 'abandoned' }],
      } } })
    expect(hasHostDirectorOwner(session)).toBe(false)
  })

  it('rejects malformed payloads and an empty reason', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    for (const payload of [
      { sessionId: 'relay_session' },
      { sessionId: 'relay_session', reason: 'done', approve: true },
      { sessionId: 'relay_session', reason: 7 },
      { sessionId: 'missing', reason: 'done' },
    ]) {
      expect(await handler('closeRelayBatch', payload, signal))
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(await handler('closeRelayBatch', { sessionId: 'relay_session', reason: '' }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(await handler('readRelayState', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { mode: 'running' } })
  })
})

describe('completeRelayBatch RPC', () => {
  it('fails closed while any item lacks terminal evidence', async () => {
    const { handler, signal } = world()
    await startBatch(handler, signal)
    expect(await handler('completeRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(await handler('completeRelayBatch', { sessionId: 'relay_session', approve: true }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('completes a fully settled batch and releases the Host lease', async () => {
    const { session, handler, signal } = world()
    await startBatch(handler, signal)
    const shots = startInput().shots
    await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: admission(0, shots[0]!.scope) }, signal)
    settleItem(session, 0, {
      prepared: new Date(Date.now() + 60_000).toISOString(),
      submitted: new Date(Date.now() + 120_000).toISOString(),
      collected: new Date(Date.now() + 180_000).toISOString(),
    })
    await handler('admitRelayDirector', { sessionId: 'relay_session', index: 1, admission: admission(1, shots[1]!.scope) }, signal)
    settleItem(session, 1, {
      prepared: new Date(Date.now() + 240_000).toISOString(),
      submitted: new Date(Date.now() + 300_000).toISOString(),
      collected: new Date(Date.now() + 360_000).toISOString(),
    })
    expect(await handler('completeRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { state: { mode: 'completed', reason: null } } })
    expect(hasHostDirectorOwner(session)).toBe(false)
  })
})

describe('recoverRelayBatch RPC', () => {
  it('reports no recovery for a fresh or terminal session', async () => {
    const { handler, signal } = world()
    expect(await handler('recoverRelayBatch', { sessionId: 'relay_session' }, signal))
      .toEqual({ ok: true, value: { state: null, recovered: false } })
    await startBatch(handler, signal)
    await handler('closeRelayBatch', { sessionId: 'relay_session', reason: 'expired' }, signal)
    expect(await handler('recoverRelayBatch', { sessionId: 'relay_session' }, signal))
      .toEqual({ ok: true, value: { state: null, recovered: false } })
  })

  it('re-establishes the Host lease for a cold session with an open batch', async () => {
    const { session, handler, signal } = world()
    appendRelayState(session, createRelayState(startInput(), new Date().toISOString()), 0)
    expect(hasHostDirectorOwner(session)).toBe(false)
    expect(await handler('recoverRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { recovered: true, state: { start: { batchId: 'batch-1' }, mode: 'running' } } })
    expect(hasHostDirectorOwner(session)).toBe(true)
    expect(await handler('recoverRelayBatch', { sessionId: 'relay_session', approve: true }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
})

describe('relay batch closed loop over RPC', () => {
  it('runs start, admit, close and a handle-free replacement entirely through the facade', async () => {
    const { session, handler, signal } = world()
    await startBatch(handler, signal)
    const scope = startInput().shots[0]!.scope
    await handler('admitRelayDirector', { sessionId: 'relay_session', index: 0, admission: admission(0, scope) }, signal)
    expect(await handler('advanceRelayBatch', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    await handler('closeRelayBatch', { sessionId: 'relay_session', reason: 'authorization expired' }, signal)
    expect(await handler('readRelayState', { sessionId: 'relay_session' }, signal))
      .toMatchObject({ ok: true, value: { mode: 'closed', items: [{ phase: 'abandoned' }, { phase: 'abandoned' }] } })
    const replacement = { ...startInput(), batchId: 'batch-2' }
    expect(await handler('startRelayBatch', { sessionId: 'relay_session', input: replacement }, signal))
      .toMatchObject({ ok: true, value: { state: { start: { batchId: 'batch-2' }, mode: 'running' } } })
    expect(hasHostDirectorOwner(session)).toBe(true)
    expect(await handler('admitRelayDirector', { sessionId: 'relay_session', index: 1, admission: admission(1, startInput().shots[1]!.scope) }, signal))
      .toMatchObject({ ok: true, value: { state: { items: [{ phase: 'pending' }, { phase: 'preparing' }] } } })
    expect(session.events.filter(event => event.type === 'qingmu-director-relay/state').length).toBeGreaterThan(0)
  })
})
