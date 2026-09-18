import { describe, expect, it } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { QueueReferenceVideoRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import {
  appendRelayState, createRelayState, readRelayState, relayStartSchema, reserveRelaySubmission,
  type RelayItem, type RelayStart, type RelayState,
} from '../src/relay-state.ts'

const now = '2026-09-16T00:00:00.000Z'
const later = '2026-09-16T00:01:00.000Z'
const expiresAt = '2026-09-16T01:00:00.000Z'
const sha = (character: string): string => character.repeat(64)

function start(): RelayStart {
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

function prepared(maxCostCny = '0.300000'): RelayState {
  const input = start()
  input.authorization.maxCostCny = maxCostCny
  const state = createRelayState(input, now)
  return { ...state, items: state.items.map((item, index) => {
    const message: UserMessage = {
      id: MessageId(`message-${index}`), role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: JSON.stringify({
        schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'host-1',
        scope: item.scope, contextSnapshotSha256: sha('a'),
      }) }, { type: 'text', text: 'Prepare this shot.' }],
    }
    return {
      ...item, phase: 'prepared', preparedAt: now,
      admissions: [{ message, contextSnapshotSha256: sha('a'), admittedAt: now }],
      handoff: { messageId: message.id, turn: index, endSeq: index + 10, revision: 1,
        requestSha256: sha('b'), frameSha256: sha('c'), directorSourceSha256: sha('d'), contextSnapshotSha256: sha('a') },
    }
  }) }
}

function command(index = 0, amount = '0.100000'): QueueReferenceVideoRequest {
  return {
    projectId: 'project-1', frameId: `shot-${index + 1}`, requestId: `relay-request-000${index}`,
    expectedRevision: 1, expectedRequestSha256: sha('b'), quoteSha256: sha('e'),
    authorizationCapCny: amount, paidConfirmed: true,
  }
}

function submitted(state: RelayState, index = 0, intent = command(index)): RelayState {
  const next = structuredClone(state)
  next.revision++
  next.updatedAt = later
  Object.assign(next.items[index]!, { phase: 'submitting', submission: intent, submittedAt: later })
  return next
}

function settled(state: RelayState, phase: 'failed' | 'collected', index = 0): RelayState {
  return { ...state, items: state.items.map((item, offset) => offset === index ? {
    ...item, phase, settledAt: later, collectedAt: phase === 'collected' ? later : null,
    run: { runId: `refvideo_${item.submission!.requestId}`, taskId: `task-${index + 1}`, publicStatus: phase === 'failed' ? 'failed' : 'succeeded' },
  } : item) }
}

function completed(): RelayState {
  const first = settled(submitted(prepared()), 'collected')
  return { ...settled(submitted(first, 1), 'failed', 1), mode: 'completed' }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function replay(value: unknown): RelayState | null {
  const session = Session.create(SessionId('relay-session'))
  // Deliberately inject malformed durable payloads; Session validates the envelope, not plugin data.
  session.append('qingmu-director-relay/state', value as RelayState)
  return readRelayState(Session.create(session.id, structuredClone(session.events)))
}

describe('relay start input', () => {
  it('should preserve omitted observer authorization without adding a default route', () => {
    const input = start()
    expect(relayStartSchema.parse(input)).toEqual(input)
    expect(createRelayState(input, now).start).not.toHaveProperty('observer')
  })

  it('should retain the exact optional observer on parse and durable replay', () => {
    const input = { ...start(), observer: { provider: 'qingmu-vision', model: 'qwen3.8-flash' } }
    expect(relayStartSchema.parse(input)).toEqual(input)
    const session = Session.create(SessionId('relay-session'))
    const state = createRelayState(input, now)
    expect(state.start).toEqual(input)
    appendRelayState(session, state, 0)
    expect(readRelayState(Session.create(session.id, structuredClone(session.events)))?.start).toEqual(input)
  })

  it.each([
    { provider: '', model: 'qwen3.8-flash' },
    { provider: 'qingmu-vision', model: '' },
    { provider: 'qingmu-vision' },
    { model: 'qwen3.8-flash' },
  ])('should reject an incomplete or empty observer route: %j', (observer) => {
    expect(() => relayStartSchema.parse({ ...start(), observer })).toThrow()
  })

  it('should reject observer replacement or removal after the batch start is persisted', () => {
    const observer = { provider: 'qingmu-vision', model: 'qwen3.8-flash' }
    const session = Session.create(SessionId('relay-session'))
    const initial = createRelayState({ ...start(), observer }, now)
    appendRelayState(session, initial, 0)
    for (const replacement of [{ ...observer, provider: 'other' }, { ...observer, model: 'other' }, undefined]) {
      const changed = { ...initial, revision: 2, updatedAt: later, start: { ...initial.start } }
      if (replacement === undefined) Reflect.deleteProperty(changed.start, 'observer')
      else Object.assign(changed.start, { observer: replacement })
      expect(() => appendRelayState(session, changed, 1)).toThrow(/start/i)
      expect(session.events).toHaveLength(1)
      expect(readRelayState(session)).toEqual(initial)
    }
  })

  it('creates a detached revision-one running ledger without authorizing any effect', () => {
    const input = freeze(start())
    const state = createRelayState(input, now)
    expect(state).toEqual({
      version: 1, revision: 1, start: input, mode: 'running', reason: null, createdAt: now, updatedAt: now,
      items: input.shots.map(shot => ({ ...shot, phase: 'pending', admissions: [], handoff: null,
        materialRequests: [], submission: null, run: null, preparedAt: null, submittedAt: null,
        settledAt: null, collectedAt: null, reason: null })),
    })
    expect(state.start).not.toBe(input)
    expect(state.items[0]!.scope).not.toBe(state.start.shots[0]!.scope)
    expect(state.items[0]!.parameters).not.toBe(state.start.shots[0]!.parameters)
  })

  it.each([2, 30])('accepts the actual read-parser duration bound %s', (duration) => {
    const input = start()
    input.shots[0]!.parameters.duration = duration
    input.shots[0]!.parameters.seed = duration === 2 ? -1 : 2147483647
    expect(relayStartSchema.parse(input)).toEqual(input)
  })

  it('accepts all existing resolutions and ratios and omitted seed without defaulting', () => {
    for (const resolution of ['480P', '720P', '1080P'] as const) {
      for (const ratio of ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const) {
        const input = start()
        input.shots[0]!.parameters = { duration: 2, resolution, ratio, audio: false, prompt_extend: true }
        expect(relayStartSchema.parse(input)).toEqual(input)
      }
    }
  })

  it('accepts exactly 100 uniquely scoped shots and the ID/text length limits', () => {
    const input = start()
    input.batchId = 'a'.repeat(256)
    input.instruction = 'x'.repeat(16000)
    input.authorization.maxCandidates = 100
    input.shots = Array.from({ length: 100 }, (_, index) => ({ ...input.shots[0]!,
      scope: { ...input.shots[0]!.scope, shotId: `shot-${index}` }, label: 'x'.repeat(256) }))
    expect(relayStartSchema.parse(input).shots).toHaveLength(100)
  })

  it.each([
    ['missing authorization', (v: RelayStart) => { Reflect.deleteProperty(v, 'authorization') }],
    ['unconfirmed payment', (v: RelayStart) => { Object.assign(v.authorization, { paidConfirmed: false }) }],
    ['extra URL', (v: RelayStart) => { Object.assign(v, { url: 'https://invalid.example' }) }],
    ['provider token', (v: RelayStart) => { Object.assign(v.director, { token: 'secret' }) }],
    ['provider body', (v: RelayStart) => { Object.assign(v.shots[0]!.parameters, { body: {} }) }],
    ['extra shot field', (v: RelayStart) => { Object.assign(v.shots[0]!, { approved: true }) }],
    ['extra scope field', (v: RelayStart) => { Object.assign(v.shots[0]!.scope, { frameId: 'x' }) }],
    ['extra authorization field', (v: RelayStart) => { Object.assign(v.authorization, { autoRetry: true }) }],
    ['invalid ID', (v: RelayStart) => { v.batchId = 'batch/1' }],
    ['long ID', (v: RelayStart) => { v.episodeId = 'x'.repeat(257) }],
    ['empty ID', (v: RelayStart) => { v.authorization.authorizationId = '' }],
    ['scope ID', (v: RelayStart) => { v.shots[0]!.scope.sceneId = 'a/b' }],
    ['empty instruction', (v: RelayStart) => { v.instruction = '' }],
    ['long instruction', (v: RelayStart) => { v.instruction = 'x'.repeat(16001) }],
    ['empty provider', (v: RelayStart) => { v.director.provider = '' }],
    ['empty model', (v: RelayStart) => { v.director.model = '' }],
    ['long label', (v: RelayStart) => { v.shots[0]!.label = 'x'.repeat(257) }],
    ['missing retake', (v: RelayStart) => { Reflect.deleteProperty(v.shots[0]!, 'retake') }],
    ['no shots', (v: RelayStart) => { v.shots = [] }],
    ['too many shots', (v: RelayStart) => { v.shots = Array.from({ length: 101 }, () => v.shots[0]!) }],
    ['duplicate shot across scenes', (v: RelayStart) => { v.shots[1]!.scope = { ...v.shots[0]!.scope, sceneId: 'other' } }],
    ['wrong project', (v: RelayStart) => { v.shots[0]!.scope.projectId = 'other' }],
    ['wrong episode', (v: RelayStart) => { v.shots[0]!.scope.episodeId = 'other' }],
    ['too few candidates', (v: RelayStart) => { v.authorization.maxCandidates = 1 }],
    ['zero candidates', (v: RelayStart) => { v.authorization.maxCandidates = 0 }],
    ['fractional candidates', (v: RelayStart) => { v.authorization.maxCandidates = 2.5 }],
    ['too many candidates', (v: RelayStart) => { v.authorization.maxCandidates = 101 }],
    ['non ISO expiry', (v: RelayStart) => { v.authorization.expiresAt = 'tomorrow' }],
    ['impossible expiry', (v: RelayStart) => { v.authorization.expiresAt = '2026-02-30T00:00:00Z' }],
  ])('rejects %s', (_name, change) => {
    const input = start()
    change(input)
    expect(() => relayStartSchema.parse(input)).toThrow()
  })

  it.each(['0', '0.000000', '-1', '1e2', 'NaN', 'Infinity', '.1', '1.', '0.0000001', ' 1', '1 '])('rejects budget %s', (maxCostCny) => {
    const input = start()
    input.authorization.maxCostCny = maxCostCny
    expect(() => relayStartSchema.parse(input)).toThrow()
  })

  it.each([
    { duration: 1 }, { duration: 31 }, { duration: 2.5 }, { duration: '5' },
    { seed: -2 }, { seed: 2147483648 }, { seed: 0.5 }, { seed: undefined }, { resolution: '4K' },
    { ratio: 'auto' }, { audio: 'true' }, { prompt_extend: 1 },
  ])('rejects controls outside the read-parser bounds: %j', (parameters) => {
    const input = start()
    Object.assign(input.shots[0]!.parameters, parameters)
    expect(() => relayStartSchema.parse(input)).toThrow()
  })

  it('rejects expired authorization and invalid clock values before creating state', () => {
    expect(() => createRelayState(start(), expiresAt)).toThrow(/expir/i)
    expect(() => createRelayState(start(), '2026-09-16T02:00:00Z')).toThrow(/expir/i)
    expect(() => createRelayState(start(), 'not-a-date')).toThrow()
    expect(createRelayState(start(), '2026-09-16T00:00:00+00:00').revision).toBe(1)
  })
})

describe('durable relay state', () => {
  it('appends a required event and replays only the newest full snapshot through a real Session', () => {
    const session = Session.create(SessionId('relay-session'))
    expect(readRelayState(session)).toBeNull()
    const initial = freeze(createRelayState(start(), now))
    const saved = appendRelayState(session, initial, 0)
    expect(saved).toEqual(initial)
    expect(saved).not.toBe(initial)
    expect(session.events[0]).toMatchObject({ type: 'qingmu-director-relay/state', data: initial })
    expect(session.events[0]).not.toHaveProperty('ignorable')
    expect(Object.isFrozen(session.events[0]!.data)).toBe(true)
    const next = { ...saved, mode: 'paused' as const, revision: 2, updatedAt: later, reason: 'operator_pause' }
    appendRelayState(session, next, 1)
    const cold = Session.create(session.id, structuredClone(session.events))
    expect(readRelayState(cold)).toEqual(next)
    expect(cold.deriveMessages()).toEqual([])
    expect(initial.revision).toBe(1)
    expect(session.events.filter(event => event.type === 'qingmu-director-relay/state')).toHaveLength(2)
  })

  it('rejects stale revisions and invalid successor revisions without appending', () => {
    const session = Session.create(SessionId('relay-session'))
    const initial = createRelayState(start(), now)
    appendRelayState(session, initial, 0)
    for (const [expectedRevision, revision] of [[0, 1], [1, 1], [1, 3], [-1, 2], [0.5, 2]]) {
      expect(() => appendRelayState(session, { ...initial, revision: revision! }, expectedRevision!)).toThrow(/revision/i)
    }
    expect(session.events).toHaveLength(1)
  })

  it('preserves the complete start and creation time within a batch', () => {
    const session = Session.create(SessionId('relay-session'))
    const initial = createRelayState(start(), now)
    appendRelayState(session, initial, 0)
    const changed = { ...initial, revision: 2 }
    expect(() => appendRelayState(session, { ...changed, createdAt: later }, 1)).toThrow(/createdAt|creation/i)
    expect(() => appendRelayState(session, { ...changed, start: { ...initial.start, instruction: 'new instruction' } }, 1)).toThrow(/start/i)
    expect(() => appendRelayState(session, { ...changed, start: { ...initial.start,
      authorization: { ...initial.start.authorization, maxCostCny: '100' } } }, 1)).toThrow(/start/i)
    expect(session.events).toHaveLength(1)
  })

  it.each(['running', 'paused'] as const)('cannot replace a %s batch', (mode) => {
    const session = Session.create(SessionId('relay-session'))
    const initial = { ...createRelayState(start(), now), mode }
    appendRelayState(session, initial, 0)
    const input = start()
    input.batchId = 'batch-2'
    const next = { ...createRelayState(input, later), revision: 2 }
    expect(() => appendRelayState(session, next, 1)).toThrow(/batch|completed/i)
    expect(session.events).toHaveLength(1)
  })

  it('accepts a new batch only after completion while keeping the session revision monotonic', () => {
    const session = Session.create(SessionId('relay-session'))
    let state = appendRelayState(session, prepared(), 0)
    for (const [index, phase] of (['collected', 'failed'] as const).entries()) {
      state = appendRelayState(session, submitted(state, index), state.revision)
      state = appendRelayState(session, { ...settled(state, phase, index), revision: state.revision + 1 }, state.revision)
    }
    state = appendRelayState(session, { ...state, revision: 6, mode: 'completed' }, 5)
    const input = start()
    input.batchId = 'batch-2'
    const next = { ...createRelayState(input, later), revision: 7 }
    expect(appendRelayState(session, next, state.revision)).toEqual(next)
    expect(readRelayState(Session.create(session.id, structuredClone(session.events)))).toEqual(next)
  })

  it('does not erase or change an already persisted command on a same-batch append', () => {
    const session = Session.create(SessionId('relay-session'))
    const initial = prepared()
    appendRelayState(session, initial, 0)
    const reserved = reserveRelaySubmission(initial, 0, command(), later)
    appendRelayState(session, reserved, 1)
    const erased = structuredClone(reserved)
    erased.revision++
    erased.items[0] = initial.items[0]!
    expect(() => appendRelayState(session, erased, 2)).toThrow(/submission|command/i)
    const changed = structuredClone(reserved)
    changed.revision++
    changed.items[0]!.submission = { ...command(), quoteSha256: sha('f') }
    expect(() => appendRelayState(session, changed, 2)).toThrow(/submission|command/i)
    expect(session.events).toHaveLength(2)
  })

  it.each([
    ['extra state field', (v: RelayState) => { Object.assign(v, { token: 'secret' }) }],
    ['version', (v: RelayState) => { Object.assign(v, { version: 2 }) }],
    ['revision', (v: RelayState) => { v.revision = 0 }],
    ['timestamp', (v: RelayState) => { v.updatedAt = 'invalid' }],
    ['missing item', (v: RelayState) => { v.items.pop() }],
    ['reordered items', (v: RelayState) => { v.items.reverse() }],
    ['changed label', (v: RelayState) => { v.items[0]!.label = 'changed' }],
    ['changed parameters', (v: RelayState) => { v.items[0]!.parameters.duration = 3 }],
    ['changed retake', (v: RelayState) => { v.items[0]!.retake = true }],
    ['extra item field', (v: RelayState) => { Object.assign(v.items[0]!, { token: 'secret' }) }],
    ['extra admission field', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!, { url: 'https://invalid.example' }) }],
    ['extra message field', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message, { metadata: {} }) }],
    ['extra source field', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message.source, { plugin: 'other' }) }],
    ['extra text field', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message.content[0]!, { token: 'secret' }) }],
    ['wrong message role', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message, { role: 'assistant' }) }],
    ['wrong message source', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message, { source: { kind: 'plugin', plugin: 'other' } }) }],
    ['empty message ID', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message, { id: MessageId('') }) }],
    ['one block', (v: RelayState) => { v.items[0]!.admissions[0]!.message.content.pop() }],
    ['three blocks', (v: RelayState) => { v.items[0]!.admissions[0]!.message.content.push({ type: 'text', text: 'extra' }) }],
    ['non-text block', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message.content[1]!, { type: 'image' }) }],
    ['invalid marker JSON', (v: RelayState) => { Object.assign(v.items[0]!.admissions[0]!.message.content[0]!, { text: '{' }) }],
    ['invalid SHA', (v: RelayState) => { v.items[0]!.admissions[0]!.contextSnapshotSha256 = 'bad' }],
    ['mismatched handoff message', (v: RelayState) => { v.items[0]!.handoff!.messageId = 'other' }],
    ['invalid handoff context SHA', (v: RelayState) => { v.items[0]!.handoff!.contextSnapshotSha256 = 'bad' }],
    ['extra handoff field', (v: RelayState) => { Object.assign(v.items[0]!.handoff!, { body: {} }) }],
    ['negative turn', (v: RelayState) => { v.items[0]!.handoff!.turn = -1 }],
    ['invalid material identity', (v: RelayState) => { v.items[0]!.materialRequests.push({ assetId: '/', requestId: 'material-1' }) }],
    ['extra material field', (v: RelayState) => { v.items[0]!.materialRequests.push(Object.assign({ assetId: 'asset-1', requestId: 'material-1' }, { url: 'https://invalid.example' })) }],
  ])('rejects malformed cold replay and append: %s', (_name, change) => {
    const state = prepared()
    change(state)
    expect(() => replay(state)).toThrow()
    const session = Session.create(SessionId('relay-session'))
    expect(() => appendRelayState(session, state, 0)).toThrow()
    expect(session.events).toHaveLength(0)
  })

  it.each(['preparing', 'prepared', 'submitting', 'unknown', 'queued', 'running', 'succeeded', 'failed', 'collected'] as const)(
    'requires evidence for phase %s', (phase) => {
      const state = createRelayState(start(), now)
      state.items[0]!.phase = phase
      expect(() => replay(state)).toThrow()
    },
  )

  it('allows a blocked item to retain partial preparation evidence', () => {
    const state = prepared()
    state.items[0]!.phase = 'blocked'
    state.items[0]!.handoff = null
    state.items[0]!.preparedAt = null
    state.items[0]!.reason = 'save_not_confirmed'
    expect(replay(state)).toEqual(state)
  })

  it('does not fall back to an older valid snapshot when the newest is malformed', () => {
    const session = Session.create(SessionId('relay-session'))
    const state = createRelayState(start(), now)
    appendRelayState(session, state, 0)
    session.append('qingmu-director-relay/state', { ...state, revision: 2, items: [] })
    const cold = Session.create(session.id, structuredClone(session.events))
    expect(() => readRelayState(cold)).toThrow()
    expect(() => appendRelayState(cold, { ...state, revision: 3 }, 2)).toThrow()
  })
})

describe('relay preparation recovery', () => {
  function interrupted(phase: 'preparing' | 'blocked' = 'preparing'): RelayState {
    const state = createRelayState(start(), now)
    state.mode = 'paused'
    state.items[0] = { ...prepared().items[0]!, phase, handoff: null, preparedAt: null }
    return state
  }

  function retry(current: RelayState): RelayState {
    const next = structuredClone(current)
    next.revision++
    next.mode = 'running'
    next.updatedAt = later
    const item = next.items[0]!
    item.phase = 'preparing'
    const admission = structuredClone(item.admissions[0]!)
    admission.message = { ...admission.message, id: MessageId('retry-1') }
    admission.contextSnapshotSha256 = sha('f')
    admission.admittedAt = later
    Object.assign(admission.message.content[0]!, { text: JSON.stringify({
      schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'host-1',
      scope: item.scope, contextSnapshotSha256: sha('f'),
    }) })
    item.admissions.push(admission)
    return next
  }

  it.each(['preparing', 'blocked'] as const)('retains interrupted %s evidence when explicitly resuming a new preparation', (phase) => {
    const session = Session.create(SessionId('relay-session'))
    const current = appendRelayState(session, interrupted(phase), 0)
    const next = appendRelayState(session, retry(current), 1)
    const cold = readRelayState(Session.create(session.id, structuredClone(session.events)))!
    expect(cold.items[0]!.admissions.map(value => value.message.id)).toEqual(['message-0', 'retry-1'])
    expect(cold.items[0]!.admissions[0]).toEqual(current.items[0]!.admissions[0])
    expect(cold.items[0]!.admissions[1]!.contextSnapshotSha256).toBe(sha('f'))
    const ready = structuredClone(next)
    ready.revision++
    ready.items[0]!.phase = 'prepared'
    ready.items[0]!.handoff = { ...prepared().items[0]!.handoff!, messageId: 'retry-1', contextSnapshotSha256: sha('f') }
    expect(appendRelayState(session, ready, 2).items[0]!.handoff!.messageId).toBe('retry-1')
  })

  it('resumes an unchanged preparation identity without appending another attempt', () => {
    const session = Session.create(SessionId('relay-session'))
    const current = appendRelayState(session, interrupted(), 0)
    const next = appendRelayState(session, { ...current, revision: 2, mode: 'running', updatedAt: later }, 1)
    expect(next.items[0]!.admissions).toEqual(current.items[0]!.admissions)
  })

  it.each(['running', 'paused', 'multiple', 'handoff', 'submission', 'expired'] as const)(
    'rejects preparation retry with %s preconditions', (invalid) => {
      const session = Session.create(SessionId('relay-session'))
      const current = interrupted()
      if (invalid === 'running') current.mode = 'running'
      if (invalid === 'handoff' || invalid === 'submission') {
        current.items[0] = prepared().items[0]!
        if (invalid === 'submission') Object.assign(current.items[0], {
          phase: 'unknown', submission: command(), submittedAt: now,
        })
      }
      if (invalid === 'submission') session.append('qingmu-director-relay/state', current)
      else appendRelayState(session, current, 0)
      const next = retry(current)
      if (invalid === 'paused') next.mode = 'paused'
      if (invalid === 'multiple') next.items[0]!.admissions.push({ ...next.items[0]!.admissions[1]!,
        message: { ...next.items[0]!.admissions[1]!.message, id: MessageId('retry-2') } })
      if (invalid === 'expired') next.updatedAt = expiresAt
      if (next.items[0]!.handoff) next.items[0]!.handoff.messageId = 'retry-1'
      expect(() => appendRelayState(session, next, 1)).toThrow(/admission|retry|handoff|expir/i)
      expect(session.events).toHaveLength(1)
    },
  )

  it.each(['erase', 'edit', 'reorder'] as const)('rejects %s of earlier preparation history', (mutation) => {
    const session = Session.create(SessionId('relay-session'))
    const current = retry(interrupted())
    current.revision = 1
    appendRelayState(session, current, 0)
    const next = structuredClone(current)
    next.revision++
    if (mutation === 'erase') next.items[0]!.admissions.shift()
    if (mutation === 'edit') next.items[0]!.admissions[0]!.admittedAt = later
    if (mutation === 'reorder') next.items[0]!.admissions.reverse()
    expect(() => appendRelayState(session, next, 1)).toThrow(/admission.*immutable/i)
    expect(readRelayState(session)).toEqual(current)
  })

  it('rejects a handoff from a superseded preparation attempt', () => {
    const current = retry(interrupted())
    current.items[0]!.handoff = prepared().items[0]!.handoff
    expect(() => replay(current)).toThrow(/handoff/i)
  })

  it.each(['same item', 'another item'] as const)('rejects duplicate preparation identities in %s', (location) => {
    const current = prepared()
    if (location === 'same item') current.items[0]!.admissions.push(structuredClone(current.items[0]!.admissions[0]!))
    else {
      current.items[1]!.admissions[0] = { ...current.items[1]!.admissions[0]!,
        message: { ...current.items[1]!.admissions[0]!.message, id: MessageId('message-0') } }
      current.items[1]!.handoff!.messageId = 'message-0'
    }
    expect(() => replay(current)).toThrow(/duplicate.*admission/i)
  })

  it.each(['running', 'paused'] as const)('admits the first preparation from %s without a submission or handoff', (mode) => {
    const session = Session.create(SessionId('relay-session'))
    const current = { ...createRelayState(start(), now), mode }
    appendRelayState(session, current, 0)
    const next = interrupted()
    next.revision = 2
    next.mode = 'running'
    next.updatedAt = later
    expect(appendRelayState(session, next, 1).items[0]!.admissions.map(value => value.message.id)).toEqual(['message-0'])
  })
})

describe('relay explicit close', () => {
  it('closes unsubmitted work without erasing handoff or material evidence or claiming completion', () => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    current.items[0]!.materialRequests.push({ assetId: 'asset-1', requestId: 'material-1' })
    appendRelayState(session, current, 0)
    const next = { ...current, revision: 2, mode: 'closed' as const,
      items: current.items.map(item => ({ ...item, phase: 'abandoned' as const, reason: 'closed_by_user' })) }
    appendRelayState(session, next, 1)
    const cold = readRelayState(Session.create(session.id, structuredClone(session.events)))!
    expect(cold.mode).toBe('closed')
    expect(cold.items[0]!.handoff).toEqual(current.items[0]!.handoff)
    expect(cold.items[0]!.materialRequests).toEqual([{ assetId: 'asset-1', requestId: 'material-1' }])
    expect(() => replay({ ...next, mode: 'completed' })).toThrow(/completed/i)
    const fresh = createRelayState({ ...start(), batchId: 'batch-2' }, later)
    expect(appendRelayState(session, { ...fresh, revision: 3 }, 2).start.batchId).toBe('batch-2')
    expect(session.events).toHaveLength(3)
  })

  it('allows closed batches to retain authoritative settled tasks beside abandoned work', () => {
    const current = settled(submitted(prepared()), 'failed')
    current.items[1]!.phase = 'abandoned'
    current.mode = 'closed'
    expect(replay(current)?.items[0]!.submission!.authorizationCapCny).toBe('0.100000')
  })

  it.each(['submitting', 'unknown', 'queued', 'running', 'succeeded', 'blocked'] as const)(
    'does not close or abandon an unresolved %s submission', (phase) => {
      const current = submitted(prepared())
      current.items[0]!.phase = phase
      current.items[0]!.run = { runId: `refvideo_${command().requestId}`, taskId: 'task-1', publicStatus: phase === 'succeeded' ? 'succeeded' : 'queued' }
      current.items[1]!.phase = 'abandoned'
      expect(() => replay({ ...current, mode: 'closed' })).toThrow(/closed|terminal/i)
      current.items[0]!.phase = 'abandoned'
      expect(() => replay(current)).toThrow(/abandoned|submission/i)
    },
  )

  it.each(['running', 'paused', 'completed'] as const)('does not reopen a closed batch as %s', (mode) => {
    const session = Session.create(SessionId('relay-session'))
    const current = createRelayState(start(), now)
    current.mode = 'closed'
    current.items.forEach((item) => { item.phase = 'abandoned' })
    appendRelayState(session, current, 0)
    expect(() => appendRelayState(session, { ...current, revision: 2, mode }, 1)).toThrow(/closed|completed/i)
  })

  it.each(['pending', 'preparing'] as const)('does not reopen an abandoned item as %s', (phase) => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    current.items[0]!.phase = 'abandoned'
    appendRelayState(session, current, 0)
    const next = structuredClone(current)
    next.revision++
    next.items[0]!.phase = phase
    expect(() => appendRelayState(session, next, 1)).toThrow(/terminal|abandoned/i)
  })
})

describe('relay completion and snapshot limits', () => {
  it('persists distinct admission and handoff context SHAs after same-turn plan/dialogue changes', () => {
    const session = Session.create(SessionId('relay-session'))
    const initial = prepared()
    initial.items[0]!.phase = 'preparing'
    initial.items[0]!.handoff = null
    appendRelayState(session, initial, 0)
    const next = prepared()
    next.revision = 2
    next.items[0]!.handoff!.contextSnapshotSha256 = sha('f')
    appendRelayState(session, next, 1)
    const saved = appendRelayState(session, submitted(next), 2)
    const cold = readRelayState(Session.create(session.id, structuredClone(session.events)))!
    expect(cold).toEqual(saved)
    expect(cold.items[0]!.admissions[0]!.contextSnapshotSha256).toBe(sha('a'))
    expect(cold.items[0]!.handoff!.contextSnapshotSha256).toBe(sha('f'))
  })

  it.each(['pending', 'prepared', 'submitting', 'unknown', 'queued', 'running', 'succeeded', 'blocked', 'failed'] as const)(
    'rejects completed snapshots containing unresolved %s work on read and append', (phase) => {
      const current = { ...completed(), mode: 'running' as const }
      if (phase === 'pending') current.items[0] = createRelayState(start(), now).items[0]!
      else if (phase === 'prepared') current.items[0] = prepared().items[0]!
      else {
        current.items[0]!.phase = phase
        if (phase === 'failed') current.items[0]!.run!.publicStatus = 'quarantined'
      }
      expect(replay(current)).toEqual(current)
      const next = { ...current, revision: current.revision + 1, mode: 'completed' as const }
      expect(() => replay(next)).toThrow(/completed|terminal/i)
      const session = Session.create(SessionId('relay-session'))
      session.append('qingmu-director-relay/state', current)
      expect(() => appendRelayState(session, next, current.revision)).toThrow(/completed|terminal/i)
      expect(session.events).toHaveLength(1)
    },
  )

  it.each(['running', 'paused'] as const)('cannot reopen a completed batch as %s', (mode) => {
    const session = Session.create(SessionId('relay-session'))
    const current = completed()
    session.append('qingmu-director-relay/state', current)
    expect(() => appendRelayState(session, { ...current, revision: 4, mode }, 3)).toThrow(/completed/i)
    expect(session.events).toHaveLength(1)
    expect(appendRelayState(session, { ...current, revision: 4, reason: 'archived' }, 3).mode).toBe('completed')
  })

  it.each([
    ['cost', (v: RelayState) => { v.items[1]!.submission = { ...v.items[1]!.submission!, authorizationCapCny: '0.200001' } }, /cost|budget/i],
    ['large exact cost', (v: RelayState) => {
      v.start.authorization.maxCostCny = '9007199254740992.000001'
      v.items[0]!.submission = { ...v.items[0]!.submission!, authorizationCapCny: '9007199254740992' }
      v.items[1]!.submission = { ...v.items[1]!.submission!, authorizationCapCny: '0.000002' }
    }, /cost|budget/i],
    ['candidate count', (v: RelayState) => { v.start.authorization.maxCandidates = 1 }, /candidate/i],
    ['duplicate request', (v: RelayState) => {
      v.items[1]!.submission = { ...v.items[1]!.submission!, requestId: v.items[0]!.submission!.requestId }
      v.items[1]!.run!.runId = v.items[0]!.run!.runId
    }, /request/i],
  ] as const)('rejects invalid aggregate %s on read and append', (_name, change, error) => {
    const current = completed()
    change(current)
    expect(() => replay(current)).toThrow(error)
    const session = Session.create(SessionId('relay-session'))
    expect(() => appendRelayState(session, { ...current, revision: 1 }, 0)).toThrow(error)
    session.append('qingmu-director-relay/state', current)
    expect(() => appendRelayState(session, { ...completed(), revision: 4 }, 3)).toThrow(error)
    expect(session.events).toHaveLength(1)
  })

  it.each(['submitting', 'unknown', 'queued', 'running', 'succeeded', 'blocked', 'failed'] as const)(
    'rejects two active submissions even when one is labeled %s', (phase) => {
      const invalid = submitted(submitted(prepared()), 1)
      invalid.items[0]!.phase = phase
      invalid.items[0]!.run = { runId: `refvideo_${command().requestId}`, taskId: 'task-1',
        publicStatus: phase === 'succeeded' ? 'succeeded' : 'quarantined' }
      expect(() => replay(invalid)).toThrow(/active/i)
      const session = Session.create(SessionId('relay-session'))
      const initial = appendRelayState(session, prepared(), 0)
      expect(() => appendRelayState(session, { ...invalid, revision: 2 }, initial.revision)).toThrow(/active/i)
      expect(session.events).toHaveLength(1)
    },
  )

  it.each(['collected', 'failed'] as const)('retains the full %s cap and admits the next shot at the exact budget', (phase) => {
    const session = Session.create(SessionId('relay-session'))
    const current = settled(submitted(prepared('9007199254740992.000001'), 0,
      command(0, '9007199254740992')), phase)
    session.append('qingmu-director-relay/state', current)
    const next = submitted(current, 1, command(1, '0.000001'))
    expect(appendRelayState(session, next, current.revision)).toEqual(next)
    expect(replay(next)).toEqual(next)
  })
})

describe('direct relay append authorization', () => {
  it.each(['pending', 'preparing', 'blocked'] as const)('cannot add a submission over a previously %s item', (phase) => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    current.items[0]!.phase = phase
    current.items[0]!.handoff = null
    if (phase === 'pending') current.items[0]!.admissions = []
    appendRelayState(session, current, 0)
    expect(() => appendRelayState(session, submitted(prepared()), 1)).toThrow(/prepared|admission/i)
    expect(session.events).toHaveLength(1)
  })

  it('cannot add a submission while resuming a paused prestate', () => {
    const session = Session.create(SessionId('relay-session'))
    appendRelayState(session, { ...prepared(), mode: 'paused' }, 0)
    expect(() => appendRelayState(session, submitted(prepared()), 1)).toThrow(/running/i)
    expect(session.events).toHaveLength(1)
  })

  it.each([expiresAt, '2026-09-16T01:00:00+00:00', '2026-09-16T01:00:00.001Z'])(
    'rejects direct submission at expired updatedAt %s', (updatedAt) => {
      const session = Session.create(SessionId('relay-session'))
      appendRelayState(session, prepared(), 0)
      const next = submitted(prepared())
      next.updatedAt = updatedAt
      next.items[0]!.submittedAt = now
      expect(() => appendRelayState(session, next, 1)).toThrow(/expir/i)
      expect(session.events).toHaveLength(1)
    },
  )

  it('allows direct reservation before expiry and later status reconciliation after expiry', () => {
    const session = Session.create(SessionId('relay-session'))
    appendRelayState(session, prepared(), 0)
    const next = submitted(prepared())
    next.updatedAt = '2026-09-16T00:59:59.999Z'
    appendRelayState(session, next, 1)
    const reconciled = { ...settled(next, 'failed'), revision: 3, updatedAt: expiresAt }
    expect(appendRelayState(session, reconciled, 2)).toEqual(reconciled)
    expect(replay(reconciled)).toEqual(reconciled)
  })

  it.each(['first event', 'replacement batch'] as const)('requires a persisted prepared item in a %s', (kind) => {
    const session = Session.create(SessionId('relay-session'))
    const next = submitted(prepared())
    let expectedRevision = 0
    if (kind === 'replacement batch') {
      const previous = completed()
      session.append('qingmu-director-relay/state', previous)
      expectedRevision = previous.revision
      next.start.batchId = 'batch-2'
    }
    next.revision = expectedRevision + 1
    expect(() => appendRelayState(session, next, expectedRevision)).toThrow(/prepared/i)
    expect(session.events).toHaveLength(kind === 'first event' ? 0 : 1)
  })

  it('cannot settle an active submission and reserve the next in the same append', () => {
    const session = Session.create(SessionId('relay-session'))
    const active = submitted(prepared())
    session.append('qingmu-director-relay/state', active)
    const next = submitted(settled(active, 'collected'), 1)
    expect(() => appendRelayState(session, next, active.revision)).toThrow(/active/i)
    expect(session.events).toHaveLength(1)
  })

  it('cannot hide two fresh reservations behind terminal labels in one append', () => {
    const session = Session.create(SessionId('relay-session'))
    appendRelayState(session, prepared(), 0)
    const next = { ...completed(), revision: 2 }
    expect(() => appendRelayState(session, next, 1)).toThrow(/active|submission/i)
    expect(session.events).toHaveLength(1)
  })

  it('rejects a direct submission that is not bound to the persisted handoff', () => {
    const session = Session.create(SessionId('relay-session'))
    appendRelayState(session, prepared(), 0)
    const next = submitted(prepared(), 0, { ...command(), expectedRevision: 2, expectedRequestSha256: sha('f') })
    expect(() => appendRelayState(session, next, 1)).toThrow(/handoff/i)
    next.items[0]!.handoff!.revision = 2
    next.items[0]!.handoff!.requestSha256 = sha('f')
    expect(() => appendRelayState(session, next, 1)).toThrow(/handoff/i)
    expect(session.events).toHaveLength(1)
  })
})

describe('persisted relay evidence', () => {
  it('allows first admission, handoff, material intents and authoritative run status updates', () => {
    const session = Session.create(SessionId('relay-session'))
    appendRelayState(session, createRelayState(start(), now), 0)
    const admitted = { ...prepared(), revision: 2 }
    admitted.items = admitted.items.map(item => ({ ...item, phase: 'preparing', handoff: null, preparedAt: null }))
    appendRelayState(session, admitted, 1)
    const ready = { ...prepared(), revision: 3 }
    ready.items[0]!.materialRequests = [{ assetId: 'asset-1', requestId: 'material-1' }]
    appendRelayState(session, ready, 2)
    const next = submitted(ready)
    next.items[0]!.materialRequests.push({ assetId: 'asset-2', requestId: 'material-2' })
    let state = appendRelayState(session, next, 3)
    for (const publicStatus of ['queued', 'running', 'quarantined', 'succeeded'] as const) {
      const changed = structuredClone(state)
      changed.revision++
      changed.items[0]!.phase = publicStatus === 'quarantined' ? 'unknown' : publicStatus
      changed.items[0]!.run = { runId: `refvideo_${command().requestId}`, taskId: 'task-1', publicStatus }
      state = appendRelayState(session, changed, state.revision)
    }
    state = appendRelayState(session, { ...settled(state, 'collected'), revision: state.revision + 1 }, state.revision)
    expect(replay(state)).toEqual(state)
    expect(state.items[0]!.materialRequests).toEqual([
      { assetId: 'asset-1', requestId: 'material-1' }, { assetId: 'asset-2', requestId: 'material-2' },
    ])
  })

  it.each([
    ['erase', (item: RelayItem) => { item.admissions = []; item.phase = 'pending' }],
    ['message ID', (item: RelayItem) => { item.admissions[0] = { ...item.admissions[0]!,
      message: { ...item.admissions[0]!.message, id: MessageId('replacement') } } }],
    ['message body', (item: RelayItem) => { Object.assign(item.admissions[0]!.message.content[1]!, { text: 'Resend with different instructions.' }) }],
    ['admission time', (item: RelayItem) => { item.admissions[0]!.admittedAt = later }],
    ['context SHA', (item: RelayItem) => {
      item.admissions[0]!.contextSnapshotSha256 = sha('f')
      Object.assign(item.admissions[0]!.message.content[0]!, { text: JSON.stringify({
        schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'host-1',
        scope: item.scope, contextSnapshotSha256: sha('f'),
      }) })
    }],
    ['marker owner', (item: RelayItem) => {
      Object.assign(item.admissions[0]!.message.content[0]!, { text: JSON.stringify({
        schema: 'qingmu.native-director-request.v1', sessionId: 'relay-session', ownerId: 'other-owner',
        scope: item.scope, contextSnapshotSha256: sha('a'),
      }) })
    }],
  ])('rejects admission %s changes after first recording', (_name, change) => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    current.items[0]!.phase = 'preparing'
    current.items[0]!.handoff = null
    appendRelayState(session, current, 0)
    const next = structuredClone(current)
    next.revision++
    change(next.items[0]!)
    expect(() => appendRelayState(session, next, 1)).toThrow(/admission.*immutable/i)
    expect(session.events).toHaveLength(1)
    expect(readRelayState(session)).toEqual(current)
  })

  it.each([
    null, { turn: 5 }, { endSeq: 99 }, { revision: 2 }, { requestSha256: sha('f') },
    { frameSha256: sha('f') }, { directorSourceSha256: sha('f') }, { contextSnapshotSha256: sha('f') },
  ])('rejects handoff drift instead of overwriting preparation evidence: %j', (change) => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    appendRelayState(session, current, 0)
    const next = structuredClone(current)
    next.revision++
    next.mode = 'paused'
    next.items[0]!.phase = 'blocked'
    next.items[0]!.handoff = change === null ? null : { ...next.items[0]!.handoff!, ...change }
    expect(() => appendRelayState(session, next, 1)).toThrow(/handoff.*immutable/i)
    expect(session.events).toHaveLength(1)
  })

  it.each([
    ['remove run', (item: RelayItem) => { item.run = null }],
    ['replace task ID', (item: RelayItem) => { item.run!.taskId = 'another-task' }],
    ['replace run ID', (item: RelayItem) => { item.run!.runId = 'refvideo_another-request' }],
  ])('cannot %s after recording the run', (_name, change) => {
    const session = Session.create(SessionId('relay-session'))
    const current = settled(submitted(prepared()), 'collected')
    current.items[0]!.phase = 'unknown'
    current.items[0]!.run!.publicStatus = 'quarantined'
    session.append('qingmu-director-relay/state', current)
    const next = structuredClone(current)
    next.revision++
    change(next.items[0]!)
    expect(() => appendRelayState(session, next, current.revision)).toThrow(/run/i)
    expect(session.events).toHaveLength(1)
  })

  it.each(['succeeded', 'failed'] as const)('does not change terminal run status %s', (terminal) => {
    for (const status of ['queued', 'running', 'quarantined', terminal === 'succeeded' ? 'failed' : 'succeeded'] as const) {
      const session = Session.create(SessionId('relay-session'))
      const current = settled(submitted(prepared()), terminal === 'succeeded' ? 'collected' : 'failed')
      current.items[0]!.phase = 'unknown'
      session.append('qingmu-director-relay/state', current)
      const next = structuredClone(current)
      next.revision++
      next.items[0]!.run!.publicStatus = status
      expect(() => appendRelayState(session, next, current.revision)).toThrow(/terminal/i)
      expect(session.events).toHaveLength(1)
    }
  })

  it.each(['collected', 'failed'] as const)('does not regress authoritative %s settlement to unknown', (phase) => {
    const session = Session.create(SessionId('relay-session'))
    const current = settled(submitted(prepared()), phase)
    session.append('qingmu-director-relay/state', current)
    const next = structuredClone(current)
    next.revision++
    next.items[0]!.phase = 'unknown'
    expect(() => appendRelayState(session, next, current.revision)).toThrow(/terminal/i)
    expect(session.events).toHaveLength(1)
  })

  it.each([
    { materialRequests: [] },
    { materialRequests: [{ assetId: 'asset-1', requestId: 'replacement' }] },
    { materialRequests: [{ assetId: 'other-asset', requestId: 'material-1' }] },
  ])('preserves recorded material asset/request identities against replacement %j', ({ materialRequests }) => {
    const session = Session.create(SessionId('relay-session'))
    const current = prepared()
    current.items[0]!.materialRequests = [{ assetId: 'asset-1', requestId: 'material-1' }]
    appendRelayState(session, current, 0)
    const next = structuredClone(current)
    next.revision++
    next.items[0]!.materialRequests = materialRequests
    expect(() => appendRelayState(session, next, 1)).toThrow(/material/i)
    expect(session.events).toHaveLength(1)
  })
})

describe('submission request ID wire bounds', () => {
  it.each(['', 'a'.repeat(15), 'a'.repeat(65), 'a'.repeat(16) + '.', 'a'.repeat(16) + ':', 'a'.repeat(16) + '/', 'a'.repeat(16) + '\n'])(
    'rejects request ID %j on reserve, read and direct append', (requestId) => {
      const initial = prepared()
      const intent = { ...command(), requestId }
      expect(() => reserveRelaySubmission(initial, 0, intent, now)).toThrow()
      const next = submitted(initial, 0, intent)
      expect(() => replay(next)).toThrow()
      const session = Session.create(SessionId('relay-session'))
      appendRelayState(session, initial, 0)
      expect(() => appendRelayState(session, next, 1)).toThrow()
      expect(session.events).toHaveLength(1)
    },
  )

  it.each(['Aa09_-'.repeat(2) + 'Aa09', 'Aa09_-'.repeat(10) + 'Aa09'])(
    'accepts the exact wire request ID bound: %s', (requestId) => {
      const initial = prepared()
      const intent = { ...command(), requestId }
      expect(reserveRelaySubmission(initial, 0, intent, later).items[0]!.submission!.requestId).toBe(requestId)
      const session = Session.create(SessionId('relay-session'))
      appendRelayState(session, initial, 0)
      const next = submitted(initial, 0, intent)
      expect(appendRelayState(session, next, 1)).toEqual(next)
      expect(replay(next)).toEqual(next)
    },
  )
})

describe('relay submission reservations', () => {
  it('reserves one exact command without mutating or aliasing caller state and command', () => {
    const state = freeze(prepared())
    const intent = freeze(command())
    const next = reserveRelaySubmission(state, 0, intent, later)
    expect(next.revision).toBe(2)
    expect(next.updatedAt).toBe(later)
    expect(next.items[0]).toEqual({ ...state.items[0], phase: 'submitting', submission: intent, submittedAt: later })
    expect(next.items[1]).toEqual(state.items[1])
    expect(next.items[0]!.submission).not.toBe(intent)
    expect(state.items[0]!.submission).toBeNull()
    expect(state.revision).toBe(1)
  })

  it('accounts for exact micro-CNY limits, including amounts beyond safe floating-point precision', () => {
    const first = reserveRelaySubmission(prepared(), 0, command(), now)
    const released = freeze(settled(first, 'collected'))
    const next = reserveRelaySubmission(released, 1, command(1, '0.200000'), later)
    expect(next.items.map(item => item.submission?.authorizationCapCny)).toEqual(['0.100000', '0.200000'])
    expect(() => reserveRelaySubmission(released, 1, command(1, '0.200001'), later)).toThrow(/budget|cost/i)
    const large = settled(reserveRelaySubmission(prepared('9007199254740992.000001'), 0,
      command(0, '9007199254740992.000000'), now), 'collected')
    expect(reserveRelaySubmission(large, 1, command(1, '0.000001'), later).revision).toBe(3)
    expect(() => reserveRelaySubmission(large, 1, command(1, '0.000002'), later)).toThrow(/budget|cost/i)
  })

  it('allows authoritative failure to advance but never treats its cap as a refund', () => {
    const failed = freeze(settled(reserveRelaySubmission(prepared(), 0, command(), now), 'failed'))
    expect(reserveRelaySubmission(failed, 1, command(1, '0.200000'), later).items[1]!.phase).toBe('submitting')
    expect(() => reserveRelaySubmission(failed, 1, command(1, '0.200001'), later)).toThrow(/budget|cost/i)
  })

  it.each(['submitting', 'queued', 'running', 'succeeded', 'unknown', 'blocked', 'quarantined'] as const)(
    '%s keeps the only submission slot occupied', (status) => {
      const reserved = reserveRelaySubmission(prepared(), 0, command(), now)
      const item = reserved.items[0]!
      if (['queued', 'running', 'succeeded', 'quarantined'].includes(status)) {
        item.run = { runId: `refvideo_${command().requestId}`, taskId: 'task-1',
          publicStatus: status as NonNullable<RelayItem['run']>['publicStatus'] }
      }
      item.phase = status === 'quarantined' ? 'unknown' : status
      freeze(reserved)
      expect(() => reserveRelaySubmission(reserved, 1, command(1), later)).toThrow(/active|submission/i)
    },
  )

  it('does not accept a failed or collected label as authoritative terminal evidence', () => {
    for (const phase of ['failed', 'collected'] as const) {
      const reserved = reserveRelaySubmission(prepared(), 0, command(), now)
      reserved.items[0]!.phase = phase
      expect(() => replay(reserved)).toThrow()
      expect(() => reserveRelaySubmission(reserved, 1, command(1), later)).toThrow()
      reserved.items[0]!.run = { runId: `refvideo_${command().requestId}`, taskId: 'task-1', publicStatus: 'quarantined' }
      expect(() => reserveRelaySubmission(reserved, 1, command(1), later)).toThrow()
    }
  })

  it('reads back the same immutable command without a second reservation, even after settlement', () => {
    const reserved = freeze(reserveRelaySubmission(prepared('0.100000'), 0, command(), now))
    expect(reserveRelaySubmission(reserved, 0, { ...command() }, later)).toEqual(reserved)
    const failed = freeze(settled(reserved, 'failed'))
    expect(reserveRelaySubmission(failed, 0, command(), later)).toEqual(failed)
    expect(failed.revision).toBe(2)
  })

  it.each([
    { requestId: 'changed-request-0' }, { quoteSha256: sha('f') }, { authorizationCapCny: '0.100001' },
    { authorizationCapCny: '0.1' }, { frameId: 'shot-2' }, { projectId: 'other' },
    { expectedRevision: 2 }, { expectedRequestSha256: sha('f') },
  ])('rejects a changed command on replay: %j', (change) => {
    const reserved = freeze(reserveRelaySubmission(prepared(), 0, command(), now))
    expect(() => reserveRelaySubmission(reserved, 0, { ...command(), ...change }, later)).toThrow()
  })

  it.each([
    { frameId: 'shot-2' }, { projectId: 'other' }, { expectedRevision: 2 }, { expectedRequestSha256: sha('f') },
    { quoteSha256: 'invalid' }, { requestId: 'invalid/id' }, { authorizationCapCny: '0' },
    { authorizationCapCny: '-0.1' }, { authorizationCapCny: '0.0000001' }, { paidConfirmed: false }, { token: 'secret' },
  ])('rejects unbound or malformed submission evidence: %j', (change) => {
    const state = freeze(prepared())
    expect(() => reserveRelaySubmission(state, 0, { ...command(), ...change } as QueueReferenceVideoRequest, now)).toThrow()
  })

  it('requires prepared evidence, a valid index, running mode and unexpired authorization', () => {
    expect(() => reserveRelaySubmission(createRelayState(start(), now), 0, command(), now)).toThrow(/prepared/i)
    for (const index of [-1, 0.5, 2, NaN]) {
      expect(() => reserveRelaySubmission(prepared(), index, command(), now)).toThrow(/index/i)
    }
    expect(() => reserveRelaySubmission({ ...prepared(), mode: 'paused' }, 0, command(), now)).toThrow(/running/i)
    expect(() => reserveRelaySubmission(completed(), 0, command(), now)).toThrow(/running/i)
    expect(() => reserveRelaySubmission(prepared(), 0, command(), expiresAt)).toThrow(/expir/i)
    expect(() => reserveRelaySubmission(prepared(), 0, command(), 'invalid')).toThrow()
    const reserved = reserveRelaySubmission(prepared(), 0, command(), now)
    expect(() => reserveRelaySubmission(reserved, 0, command(), expiresAt)).toThrow(/expir/i)
  })

  it('rejects mismatched run identities and extra run/submission fields on cold replay', () => {
    for (const change of [
      (v: RelayState) => { v.items[0]!.run!.runId = 'refvideo_other' },
      (v: RelayState) => { Object.assign(v.items[0]!.run!, { url: 'https://invalid.example' }) },
      (v: RelayState) => { Object.assign(v.items[0]!.submission!, { body: {} }) },
      (v: RelayState) => { v.items[0]!.submission = { ...command(), frameId: 'shot-2' } },
      (v: RelayState) => { v.items[0]!.handoff = null },
      (v: RelayState) => { v.items[0]!.admissions = [] },
      (v: RelayState) => { v.items[0]!.submission = null },
    ]) {
      const state = settled(reserveRelaySubmission(prepared(), 0, command(), now), 'collected')
      change(state)
      expect(() => replay(state)).toThrow()
    }
  })

  it('does not reuse another item request ID or permit more intents than authorized candidates', () => {
    const state = settled(reserveRelaySubmission(prepared(), 0, command(), now), 'failed')
    expect(() => reserveRelaySubmission(state, 1, { ...command(1), requestId: command().requestId }, later)).toThrow(/request|intent/i)
    const invalid = structuredClone(state)
    invalid.start.authorization.maxCandidates = 1
    expect(() => reserveRelaySubmission(invalid, 1, command(1), later)).toThrow()
  })
})
