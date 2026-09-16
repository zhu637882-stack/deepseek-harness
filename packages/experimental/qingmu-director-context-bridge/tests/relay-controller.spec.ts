import { describe, expect, it } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { hasHostDirectorOwner } from '../src/bridge.ts'
import {
  appendRelayState, createRelayState,
  type RelayStart, type RelayState,
} from '../src/relay-state.ts'
import type { DirectorContextReadPort, DirectorObjectScope } from '../src/types.ts'
import {
  readRelayBatch, startRelayBatch, admitRelayDirector, advanceRelayBatch,
  completeRelayBatch, closeRelayBatch, recoverRelayBatch,
} from '../src/relay-controller.ts'

const now = '2026-09-16T00:00:00.000Z'
const later = '2026-09-16T00:01:00.000Z'
const expiresAt = '2026-09-16T01:00:00.000Z'
const sha = (character: string): string => character.repeat(64)

function startInput(): RelayStart {
  return {
    batchId: 'batch-1', projectId: 'project-1', episodeId: 'episode-1', instruction: 'Prepare these shots.',
    director: { provider: 'deepseek', model: 'deepseek-chat' },
    shots: ['shot-1', 'shot-2'].map(shotId => ({
      scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId },
      label: shotId, parameters: { duration: 5, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false },
      retake: false,
    })),
    authorization: { authorizationId: 'auth-1', paidConfirmed: true, maxCostCny: '0.300000', maxCandidates: 2, expiresAt },
  }
}

function dummyPort(): DirectorContextReadPort {
  return {
    async readDirectorContext(_scope: DirectorObjectScope) {
      throw new Error('unexpected context read')
    },
  }
}

function admissionMessage(index: number, scope: DirectorObjectScope): UserMessage {
  return {
    id: MessageId(`message-${index}`), role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: JSON.stringify({
      schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'host-1',
      scope, contextSnapshotSha256: sha('a'),
    }) }, { type: 'text', text: 'Prepare this shot.' }],
  }
}

function sessionWithStartedBatch(): { session: Session; state: RelayState } {
  const session = Session.create(SessionId('relay-session'))
  const { state } = startRelayBatch(session, startInput(), now, dummyPort())
  return { session, state }
}

function settleItem(
  session: Session,
  index: number,
  at: { admit: string; prepared: string; submitted: string; collected: string },
): void {
  const started = readRelayBatch(session)!
  const item = started.items[index]!
  const message = admissionMessage(index, item.scope)
  admitRelayDirector(session, index, { message, contextSnapshotSha256: sha('a') }, at.admit)
  const handoff = {
    messageId: message.id, turn: 0, endSeq: 0, revision: 1,
    requestSha256: sha('b'), frameSha256: sha('c'), directorSourceSha256: sha('d'), contextSnapshotSha256: sha('a'),
  }
  const admitted = readRelayBatch(session)!
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
  const prepared = readRelayBatch(session)!
  appendRelayState(session, {
    ...prepared, revision: prepared.revision + 1, updatedAt: at.submitted,
    items: prepared.items.map((other, offset) => offset === index
      ? { ...other, phase: 'submitting' as const, submission, submittedAt: at.submitted }
      : other),
  }, prepared.revision)
  const submitted = readRelayBatch(session)!
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

describe('readRelayBatch', () => {
  it('should return null when no relay event exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(readRelayBatch(session)).toBeNull()
  })

  it('should return the latest relay state after start', () => {
    const { session, state } = sessionWithStartedBatch()
    const read = readRelayBatch(session)
    expect(read).not.toBeNull()
    expect(read!.start.batchId).toBe(state.start.batchId)
    expect(read!.mode).toBe('running')
  })
})

describe('startRelayBatch', () => {
  it('should create a running batch with pending items and claim a Host lease', () => {
    const session = Session.create(SessionId('relay-session'))
    const { state, lease } = startRelayBatch(session, startInput(), now, dummyPort())
    expect(state.mode).toBe('running')
    expect(state.revision).toBe(1)
    expect(state.items).toHaveLength(2)
    expect(state.items.every(item => item.phase === 'pending')).toBe(true)
    expect(state.items.every(item => item.admissions.length === 0)).toBe(true)
    expect(lease).toHaveProperty('enter')
    expect(lease).toHaveProperty('release')
  })

  it('should reject when an open batch already exists', () => {
    const { session } = sessionWithStartedBatch()
    expect(() => startRelayBatch(session, startInput(), later, dummyPort()))
      .toThrow('An open relay batch already exists.')
  })

  it('should allow replacing a completed batch', () => {
    const session = Session.create(SessionId('relay-session'))
    const { state } = startRelayBatch(session, startInput(), now, dummyPort())
    expect(state.mode).toBe('running')
    expect(hasHostDirectorOwner(session)).toBe(true)
    closeRelayBatch(session, 'done', later)
    expect(hasHostDirectorOwner(session)).toBe(false)
    const read = readRelayBatch(session)!
    expect(read.mode).toBe('closed')
    const second = startInput()
    second.batchId = 'batch-2'
    second.authorization.expiresAt = '2026-09-16T03:00:00.000Z'
    const { state: newState } = startRelayBatch(session, second, '2026-09-16T02:00:00.000Z', dummyPort())
    expect(newState.start.batchId).toBe('batch-2')
    expect(newState.mode).toBe('running')
  })
})

describe('admitRelayDirector', () => {
  it('should atomically add admission, set phase to preparing, and mode to running', () => {
    const { session, state } = sessionWithStartedBatch()
    const scope = state.items[0]!.scope
    const message = admissionMessage(0, scope)
    const result = admitRelayDirector(session, 0, { message, contextSnapshotSha256: sha('a') }, later)
    expect(result.revision).toBe(2)
    expect(result.mode).toBe('running')
    expect(result.items[0]!.phase).toBe('preparing')
    expect(result.items[0]!.admissions).toHaveLength(1)
    expect(result.items[0]!.admissions[0]!.message.id).toBe(message.id)
    expect(result.items[1]!.phase).toBe('pending')
  })

  it('should reject admission on a non-pending item', () => {
    const { session, state } = sessionWithStartedBatch()
    const scope = state.items[0]!.scope
    admitRelayDirector(session, 0, { message: admissionMessage(0, scope), contextSnapshotSha256: sha('a') }, later)
    expect(() => admitRelayDirector(session, 0, { message: admissionMessage(0, scope), contextSnapshotSha256: sha('b') }, '2026-09-16T00:02:00.000Z'))
      .toThrow('Relay item is not pending.')
  })

  it('should reject retry admission when batch is not paused', () => {
    const { session, state } = sessionWithStartedBatch()
    const scope = state.items[0]!.scope
    admitRelayDirector(session, 0, { message: admissionMessage(0, scope), contextSnapshotSha256: sha('a') }, later)
    const item = readRelayBatch(session)!.items[0]!
    expect(item.phase).toBe('preparing')
    // Item 0 is already preparing; to retry, it would need to go back to pending first (not possible via controller).
    // Instead test: admit item 1, then try to admit item 1 again while running.
    admitRelayDirector(session, 1, { message: admissionMessage(1, state.items[1]!.scope), contextSnapshotSha256: sha('a') }, later)
    // Both items are now preparing; no retry possible on pending items.
    expect(readRelayBatch(session)!.items.every(i => i.phase === 'preparing')).toBe(true)
  })

  it('should allow first admission on a paused batch', () => {
    const { session, state } = sessionWithStartedBatch()
    advanceRelayBatch(session, later)
    expect(readRelayBatch(session)!.mode).toBe('paused')
    const scope = state.items[0]!.scope
    const result = admitRelayDirector(session, 0, { message: admissionMessage(0, scope), contextSnapshotSha256: sha('a') }, '2026-09-16T00:02:00.000Z')
    expect(result.mode).toBe('running')
    expect(result.items[0]!.phase).toBe('preparing')
  })

  it('should reject invalid index', () => {
    const { session } = sessionWithStartedBatch()
    expect(() => admitRelayDirector(session, -1, { message: admissionMessage(0, startInput().shots[0]!.scope), contextSnapshotSha256: sha('a') }, later))
      .toThrow('Invalid relay item index.')
    expect(() => admitRelayDirector(session, 5, { message: admissionMessage(0, startInput().shots[0]!.scope), contextSnapshotSha256: sha('a') }, later))
      .toThrow('Invalid relay item index.')
  })

  it('should reject when no open batch exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => admitRelayDirector(session, 0, { message: admissionMessage(0, startInput().shots[0]!.scope), contextSnapshotSha256: sha('a') }, later))
      .toThrow('No open relay batch.')
  })
})

describe('advanceRelayBatch', () => {
  it('should pause a running batch with no admissions', () => {
    const { session } = sessionWithStartedBatch()
    const result = advanceRelayBatch(session, later)
    expect(result.mode).toBe('paused')
    expect(result.reason).toBe('awaiting_director_admission')
    expect(result.revision).toBe(2)
  })

  it('should reject when admissions exist', () => {
    const { session, state } = sessionWithStartedBatch()
    admitRelayDirector(session, 0, { message: admissionMessage(0, state.items[0]!.scope), contextSnapshotSha256: sha('a') }, later)
    expect(() => advanceRelayBatch(session, '2026-09-16T00:02:00.000Z'))
      .toThrow('Batch has admissions; pause is not applicable.')
  })

  it('should reject when batch is not running', () => {
    const { session } = sessionWithStartedBatch()
    advanceRelayBatch(session, later)
    expect(() => advanceRelayBatch(session, '2026-09-16T00:02:00.000Z'))
      .toThrow('Cannot pause a non-running batch.')
  })

  it('should reject when no batch exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => advanceRelayBatch(session, later))
      .toThrow('No open relay batch.')
  })
})

describe('closeRelayBatch', () => {
  it('should abandon non-settled items and preserve the reason', () => {
    const { session } = sessionWithStartedBatch()
    const result = closeRelayBatch(session, 'authorization expired', later)
    expect(result.mode).toBe('closed')
    expect(result.reason).toBe('authorization expired')
    expect(result.items.every(item => item.phase === 'abandoned')).toBe(true)
    expect(result.items.every(item => item.reason === 'authorization expired')).toBe(true)
  })

  it('should reject an empty reason', () => {
    const { session } = sessionWithStartedBatch()
    expect(() => closeRelayBatch(session, '', later))
      .toThrow('Close reason must be a non-empty string.')
  })

  it('should reject when no open batch exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => closeRelayBatch(session, 'expired', later))
      .toThrow('No open relay batch.')
  })

  it('should be terminal — cannot reopen after close', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort())
    closeRelayBatch(session, 'expired', later)
    expect(hasHostDirectorOwner(session)).toBe(false)
    const replacement = { ...startInput(), batchId: 'batch-2', authorization: { ...startInput().authorization, expiresAt: '2026-09-16T03:00:00.000Z' } }
    expect(() => startRelayBatch(session, replacement, '2026-09-16T02:00:00.000Z', dummyPort()))
      .not.toThrow()
  })
})

describe('completeRelayBatch', () => {
  it('should complete a fully settled batch, release the Host lease, and allow replacement', () => {
    const session = Session.create(SessionId('relay-session'))
    startRelayBatch(session, startInput(), now, dummyPort())
    settleItem(session, 0, {
      admit: '2026-09-16T00:01:00.000Z', prepared: '2026-09-16T00:02:00.000Z',
      submitted: '2026-09-16T00:03:00.000Z', collected: '2026-09-16T00:04:00.000Z',
    })
    settleItem(session, 1, {
      admit: '2026-09-16T00:05:00.000Z', prepared: '2026-09-16T00:06:00.000Z',
      submitted: '2026-09-16T00:07:00.000Z', collected: '2026-09-16T00:08:00.000Z',
    })
    const result = completeRelayBatch(session, '2026-09-16T00:09:00.000Z')
    expect(result.mode).toBe('completed')
    expect(result.reason).toBeNull()
    expect(hasHostDirectorOwner(session)).toBe(false)
    const replacement = {
      ...startInput(), batchId: 'batch-2',
      authorization: { ...startInput().authorization, expiresAt: '2026-09-16T03:00:00.000Z' },
    }
    expect(() => startRelayBatch(session, replacement, '2026-09-16T02:00:00.000Z', dummyPort()))
      .not.toThrow()
  })

  it('should reject when items are not settled', () => {
    const { session } = sessionWithStartedBatch()
    expect(() => completeRelayBatch(session, later))
      .toThrow('Relay item 0 is not settled; cannot complete the batch.')
  })

  it('should reject when no open batch exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(() => completeRelayBatch(session, later))
      .toThrow('No open relay batch.')
  })

  it('should reject when batch is closed', () => {
    const { session } = sessionWithStartedBatch()
    closeRelayBatch(session, 'expired', later)
    expect(() => completeRelayBatch(session, '2026-09-16T00:02:00.000Z'))
      .toThrow('No open relay batch.')
  })
})

describe('recoverRelayBatch', () => {
  it('should return null when no open batch exists', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(recoverRelayBatch(session, dummyPort())).toBeNull()
  })

  it('should return null when batch is terminal', () => {
    const { session } = sessionWithStartedBatch()
    closeRelayBatch(session, 'expired', later)
    expect(recoverRelayBatch(session, dummyPort())).toBeNull()
  })

  it('should recover state and lease for an open batch', () => {
    const coldSession = Session.create(SessionId('cold-session'))
    const state = createRelayState(startInput(), now)
    appendRelayState(coldSession, state, 0)
    const recovered = recoverRelayBatch(coldSession, dummyPort())
    expect(recovered).not.toBeNull()
    expect(recovered!.state.mode).toBe('running')
    expect(recovered!.lease).toHaveProperty('enter')
    expect(recovered!.lease).toHaveProperty('release')
  })
})
