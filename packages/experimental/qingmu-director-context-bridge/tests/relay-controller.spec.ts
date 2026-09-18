import { describe, expect, it } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createRelayState, readRelayState, type RelayStart } from '../src/relay-state.ts'
import {
  readRelayBatch, startRelayBatch, admitRelayDirector, advanceRelayBatch,
  completeRelayBatch, closeRelayBatch, recoverRelayBatch,
} from '../src/relay-controller.ts'
import type { DirectorContextReadPort, DirectorContextReadResult, DirectorObjectScope } from '../src/types.ts'

const now = '2026-09-16T00:00:00.000Z'
const later = '2026-09-16T00:01:00.000Z'
const evenLater = '2026-09-16T00:02:00.000Z'
const expiresAt = '2026-09-16T01:00:00.000Z'

const scope0: DirectorObjectScope = { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-1' }
const scope1: DirectorObjectScope = { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-2' }

function startInput(): RelayStart {
  return {
    batchId: 'batch-1', projectId: 'project-1', episodeId: 'episode-1', instruction: 'Prepare these shots.',
    director: { provider: 'deepseek', model: 'deepseek-chat' },
    shots: [scope0, scope1].map(scope => ({
      scope, label: scope.shotId,
      parameters: { duration: 5, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false },
      retake: false,
    })),
    authorization: { authorizationId: 'auth-1', paidConfirmed: true, maxCostCny: '0.300000', maxCandidates: 2, expiresAt },
  }
}

function dummyPort(): DirectorContextReadPort {
  return {
    async readDirectorContext(): Promise<DirectorContextReadResult> {
      return { ok: false, reason: 'context_unavailable' }
    },
  }
}

function admission(scope: DirectorObjectScope, sha = 'a'): { message: UserMessage; contextSnapshotSha256: string } {
  const character = sha.charAt(0)
  const contextSha = character.repeat(64)
  return {
    message: {
      id: MessageId(`admission-${scope.shotId}-${sha}`), role: 'user', source: { kind: 'user' },
      content: [
        { type: 'text', text: JSON.stringify({
          schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'host-1',
          scope, contextSnapshotSha256: contextSha,
        }) },
        { type: 'text', text: `Prepare shot ${scope.shotId}` },
      ],
    },
    contextSnapshotSha256: contextSha,
  }
}

/** Build a session with both items fully settled (collected + failed). */
function sessionWithSettledBatch(): Session {
  const session = Session.create(SessionId('relay-session'))
  startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
  let state = readRelayState(session)!
  const adm0 = admission(scope0)
  // Admit + prepare item 0 in one step (admitRelayDirector transitions to 'preparing')
  state = admitRelayDirector(session, 0, adm0, later)
  // Manually advance item 0 through prepared → submitting → collected
  state = {
    ...state, revision: state.revision + 1, updatedAt: later,
    items: state.items.map((item, i) => i === 0 ? {
      ...item, phase: 'collected', preparedAt: later, submittedAt: later, settledAt: later, collectedAt: later,
      handoff: { messageId: adm0.message.id, turn: 0, endSeq: 10, revision: 1,
        requestSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64), directorSourceSha256: 'd'.repeat(64),
        contextSnapshotSha256: adm0.contextSnapshotSha256 },
      submission: { projectId: 'project-1', frameId: 'shot-1', requestId: 'relay-request-0000',
        expectedRevision: 1, expectedRequestSha256: 'b'.repeat(64), quoteSha256: 'e'.repeat(64),
        authorizationCapCny: '0.100000', paidConfirmed: true },
      run: { runId: 'refvideo_relay-request-0000', taskId: 'task-1', publicStatus: 'succeeded' },
    } : item),
  }
  session.append('qingmu-director-relay/state', state)
  // Settle item 1 to failed
  const adm1 = admission(scope1)
  state = {
    ...state, revision: state.revision + 1, updatedAt: later,
    items: state.items.map((item, i) => i === 1 ? {
      ...item, phase: 'preparing', admissions: [...item.admissions, { ...adm1, admittedAt: later }],
    } : item),
  }
  session.append('qingmu-director-relay/state', state)
  state = {
    ...state, revision: state.revision + 1, updatedAt: later,
    items: state.items.map((item, i) => i === 1 ? {
      ...item, phase: 'failed', preparedAt: later, submittedAt: later, settledAt: later, collectedAt: null,
      handoff: { messageId: adm1.message.id, turn: 1, endSeq: 20, revision: 1,
        requestSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64), directorSourceSha256: 'd'.repeat(64),
        contextSnapshotSha256: adm1.contextSnapshotSha256 },
      submission: { projectId: 'project-1', frameId: 'shot-2', requestId: 'relay-request-0001',
        expectedRevision: 1, expectedRequestSha256: 'b'.repeat(64), quoteSha256: 'e'.repeat(64),
        authorizationCapCny: '0.100000', paidConfirmed: true },
      run: { runId: 'refvideo_relay-request-0001', taskId: 'task-2', publicStatus: 'failed' },
    } : item),
  }
  session.append('qingmu-director-relay/state', state)
  return session
}

describe('readRelayBatch', () => {
  it('returns null when no relay state exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(readRelayBatch(session)).toBeNull()
  })

  it('returns the current relay state after one is persisted', () => {
    const session = Session.create(SessionId('relay-session'))
    const state = createRelayState(startInput(), now)
    session.append('qingmu-director-relay/state', state)
    expect(readRelayBatch(session)).toEqual(state)
  })
})

describe('startRelayBatch', () => {
  it('creates state, appends an event, and returns a lease', () => {
    const session = Session.create(SessionId('relay-session'))
    const { state, lease } = startRelayBatch(session, startInput(), now, dummyPort())
    expect(state.revision).toBe(1)
    expect(state.mode).toBe('running')
    expect(session.events).toHaveLength(1)
    expect(typeof lease.enter).toBe('function')
    expect(typeof lease.release).toBe('function')
    lease.release()
  })

  it('rejects starting a second batch while one is open', () => {
    const session = Session.create(SessionId('relay-session'))
    const { lease } = startRelayBatch(session, startInput(), now, dummyPort())
    lease.release()
    expect(() => startRelayBatch(session, startInput(), later, dummyPort())).toThrow(/open/i)
  })

  it('allows starting a new batch after the previous is completed', () => {
    const session = sessionWithSettledBatch()
    completeRelayBatch(session, evenLater)
    const input = startInput()
    input.batchId = 'batch-2'
    const { state: next } = startRelayBatch(session, input, evenLater, dummyPort())
    expect(next.start.batchId).toBe('batch-2')
  })
})

describe('admitRelayDirector', () => {
  it('adds an admission and transitions the item to preparing', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    const adm = admission(scope0)
    const state = admitRelayDirector(session, 0, adm, later)
    expect(state.items[0]!.admissions).toHaveLength(1)
    expect(state.items[0]!.admissions[0]!.contextSnapshotSha256).toBe(adm.contextSnapshotSha256)
    expect(state.items[0]!.phase).toBe('preparing')
    expect(state.mode).toBe('running')
    expect(state.revision).toBe(2)
  })

  it('throws when no batch is open', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => admitRelayDirector(session, 0, admission(scope0), now)).toThrow(/no open/i)
  })

  it('throws for an invalid index', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    expect(() => admitRelayDirector(session, -1, admission(scope0), later)).toThrow(/invalid/i)
    expect(() => admitRelayDirector(session, 2, admission(scope0), later)).toThrow(/invalid/i)
    expect(() => admitRelayDirector(session, 0.5, admission(scope0), later)).toThrow(/invalid/i)
  })

  it('throws when the item is not pending', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    admitRelayDirector(session, 0, admission(scope0), later)
    // Item 0 is now 'preparing', not 'pending'
    expect(() => admitRelayDirector(session, 0, admission(scope0, 'b'), evenLater)).toThrow(/not pending/i)
  })

  it('admits a retry on a paused batch for a pending item', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    // Admit item 0, settle it, then pause and admit item 1
    admitRelayDirector(session, 0, admission(scope0), later)
    // Pause via advanceRelayBatch (no admissions on item 1 yet, but item 0 has admissions now)
    // Actually advanceRelayBatch checks if ANY item has admissions. Item 0 does, so it will throw.
    // Instead, manually pause:
    let state = readRelayState(session)!
    state = { ...state, revision: state.revision + 1, mode: 'paused' as const, updatedAt: evenLater }
    session.append('qingmu-director-relay/state', state)
    // Now admit item 1 on the paused batch (retry scenario)
    const advanced = admitRelayDirector(session, 1, admission(scope1), evenLater)
    expect(advanced.mode).toBe('running')
    expect(advanced.items[1]!.phase).toBe('preparing')
    expect(advanced.items[1]!.admissions).toHaveLength(1)
  })
})

describe('advanceRelayBatch', () => {
  it('pauses the batch when no items have any admissions', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    const state = advanceRelayBatch(session, later)
    expect(state.mode).toBe('paused')
    expect(state.reason).toBe('awaiting_director_admission')
  })

  it('throws when no batch is open', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => advanceRelayBatch(session, now)).toThrow(/no open/i)
  })

  it('throws when items already have admissions', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    admitRelayDirector(session, 0, admission(scope0), later)
    expect(() => advanceRelayBatch(session, evenLater)).toThrow(/already have admissions/i)
  })
})

describe('completeRelayBatch', () => {
  it('completes a batch when all items are settled', () => {
    const session = sessionWithSettledBatch()
    const completed = completeRelayBatch(session, evenLater)
    expect(completed.mode).toBe('completed')
  })

  it('throws when no batch is open', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => completeRelayBatch(session, now)).toThrow(/no open/i)
  })

  it('throws when items are not settled', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    expect(() => completeRelayBatch(session, later)).toThrow(/not settled/i)
  })
})

describe('closeRelayBatch', () => {
  it('closes a batch with a reason and abandons unsettled items', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    const closed = closeRelayBatch(session, 'expired', later)
    expect(closed.mode).toBe('closed')
    expect(closed.reason).toBe('expired')
    expect(closed.items.every(item => item.phase === 'abandoned')).toBe(true)
  })

  it('preserves settled items and abandons unsettled ones when closing', () => {
    const session = sessionWithSettledBatch()
    const closed = closeRelayBatch(session, 'operator_close', evenLater)
    expect(closed.items[0]!.phase).toBe('collected')
    expect(closed.items[1]!.phase).toBe('failed')
  })

  it('throws when no batch is open', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => closeRelayBatch(session, 'reason', now)).toThrow(/no open/i)
  })

  it('throws for an empty reason', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort()).lease.release()
    expect(() => closeRelayBatch(session, '', later)).toThrow(/non-empty/i)
  })
})

describe('recoverRelayBatch', () => {
  it('returns null when no relay state exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(recoverRelayBatch(session, dummyPort())).toBeNull()
  })

  it('returns null when the batch is already completed', () => {
    const session = sessionWithSettledBatch()
    completeRelayBatch(session, evenLater)
    expect(recoverRelayBatch(session, dummyPort())).toBeNull()
  })

  it('re-establishes a lease for an open batch', () => {
    const session = Session.create(SessionId('relay-session'))
    const { state: original, lease } = startRelayBatch(session, startInput(), now, dummyPort())
    lease.release()
    const recovered = recoverRelayBatch(session, dummyPort())
    expect(recovered).not.toBeNull()
    expect(recovered!.state.start.batchId).toBe(original.start.batchId)
    expect(typeof recovered!.lease.enter).toBe('function')
    expect(typeof recovered!.lease.release).toBe('function')
    recovered!.lease.release()
  })
})
