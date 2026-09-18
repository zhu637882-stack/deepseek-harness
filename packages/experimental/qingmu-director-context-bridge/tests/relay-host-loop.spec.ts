import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const driveRelayBatch = vi.fn()
vi.mock('../src/relay-runner.ts', async (requireOriginal) => {
  const original = await requireOriginal<unknown>()
  return { ...original as object, driveRelayBatch }
})

const { DEFAULT_RELAY_DRIVE_INTERVAL_MS, startRelayHostLoop } = await import('../src/relay-host-loop.ts')
const { appendRelayState, createRelayState } = await import('../src/relay-state.ts')
import type { RelayRunnerPorts } from '../src/relay-runner.ts'
import type { RelayStart } from '../src/relay-state.ts'

const expiry = (): string => new Date(Date.now() + 3_600_000).toISOString()

function startInput(): RelayStart {
  return {
    batchId: 'batch-loop', projectId: 'project-1', episodeId: 'episode-1', instruction: 'Prepare these shots.',
    director: { provider: 'deepseek', model: 'deepseek-chat' },
    shots: [{
      scope: { projectId: 'project-1', episodeId: 'episode-1', sceneId: 'scene-1', shotId: 'shot-1' },
      label: 'shot-1', parameters: { duration: 5, resolution: '720P' as const, ratio: '16:9' as const, audio: true, prompt_extend: false },
      retake: false,
    }],
    authorization: { authorizationId: 'auth-1', paidConfirmed: true, maxCostCny: '0.300000', maxCandidates: 1, expiresAt: expiry() },
  }
}

/** One real session carrying a relay ledger, plus the agent surfaces the loop needs. */
function world(mode?: 'paused') {
  const session = Session.create(SessionId('loop_session'))
  const created = createRelayState(startInput(), new Date().toISOString())
  const state = mode === 'paused' ? { ...created, mode: 'paused' as const, reason: 'awaiting_director_admission' } : created
  appendRelayState(session, state, 0)
  const agent = { session, status: 'idle', followup: vi.fn(), whenIdle: vi.fn() }
  const ctx = fakeContext()
  return { session, agent, ctx }
}

function fakeContext(): Context & { readonly disposers: readonly (() => void)[] } {
  const disposers: (() => void)[] = []
  return {
    effect: (fn: () => (() => void) | undefined) => {
      const dispose = fn()
      if (dispose !== undefined) disposers.push(dispose)
    },
    logger: { warn: vi.fn() },
    disposers,
  } as unknown as Context & { readonly disposers: readonly (() => void)[] }
}

function testPorts(): RelayRunnerPorts {
  return {
    context: { readDirectorContext: vi.fn(async () => ({ ok: false as const, reason: 'context_unavailable' as const })) },
    read: vi.fn(), command: vi.fn(), flush: vi.fn(),
    now: () => new Date().toISOString(), requestId: () => 'request-1',
  }
}

function startLoop(
  ctx: Context,
  agent: unknown,
  options: { ports?: RelayRunnerPorts | null } = {},
) {
  return startRelayHostLoop(ctx, {
    intervalMs: DEFAULT_RELAY_DRIVE_INTERVAL_MS,
    getAgent: () => agent as never,
    resolvePorts: () => (options.ports === undefined ? testPorts() : options.ports),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  driveRelayBatch.mockReset()
})

describe('relay host loop registration', () => {
  it('registers open modes and unregisters terminal or null modes', () => {
    const { agent, ctx } = world()
    const loop = startLoop(ctx, agent)
    loop.observe(SessionId('loop_session'), 'running')
    expect([...loop.open]).toEqual([SessionId('loop_session')])
    loop.observe(SessionId('loop_session'), 'paused')
    expect([...loop.open]).toEqual([SessionId('loop_session')])
    loop.observe(SessionId('loop_session'), 'completed')
    expect(loop.open.size).toBe(0)
    loop.observe(SessionId('loop_session'), 'running')
    loop.observe(SessionId('loop_session'), 'closed')
    expect(loop.open.size).toBe(0)
    loop.observe(SessionId('loop_session'), 'running')
    loop.observe(SessionId('loop_session'), null)
    expect(loop.open.size).toBe(0)
  })
})

describe('relay host loop drive gate', () => {
  it('drives a running batch and skips a paused batch on the tick path', async () => {
    const running = world()
    const paused = world('paused')
    const loop = startLoop(running.ctx, running.agent)
    driveRelayBatch.mockResolvedValue({ action: 'idle', state: null, steps: [] })
    const runningReport = await loop.driveOnce(SessionId('loop_session'), new AbortController().signal, true)
    expect(runningReport).toEqual({ action: 'idle', state: null, steps: [] })
    expect(driveRelayBatch).toHaveBeenCalledTimes(1)
    const pausedLoop = startLoop(paused.ctx, paused.agent)
    const pausedReport = await pausedLoop.driveOnce(SessionId('loop_session'), new AbortController().signal, true)
    expect(pausedReport).toBeNull()
    expect(driveRelayBatch).toHaveBeenCalledTimes(1)
  })

  it('reports waiting instead of null on the RPC face when the agent is missing or a drive is in flight', async () => {
    const { agent, ctx } = world()
    const loop = startLoop(ctx, undefined)
    await expect(loop.driveForRpc(SessionId('loop_session'), new AbortController().signal)).resolves.toMatchObject({
      action: 'waiting', reason: 'agent-unavailable',
    })
    const started = startLoop(ctx, agent)
    let release: (value: unknown) => void = () => {}
    driveRelayBatch.mockReturnValue(new Promise((value) => { release = value }))
    const first = started.driveForRpc(SessionId('loop_session'), new AbortController().signal)
    await expect(started.driveForRpc(SessionId('loop_session'), new AbortController().signal)).resolves.toMatchObject({
      action: 'waiting', reason: 'drive-in-progress',
    })
    release({ action: 'idle', state: null, steps: [] })
    await expect(first).resolves.toMatchObject({ action: 'idle' })
  })

  it('skips when the agent is missing on the tick path and parks as waiting when ports are missing', async () => {
    const { agent, ctx } = world()
    const noAgent = startLoop(ctx, undefined)
    await expect(noAgent.driveOnce(SessionId('loop_session'), new AbortController().signal, true)).resolves.toBeNull()
    const noPorts = startLoop(ctx, agent, { ports: null })
    await expect(noPorts.driveOnce(SessionId('loop_session'), new AbortController().signal, true)).resolves.toMatchObject({
      action: 'waiting', reason: 'read-port-unavailable',
    })
    expect(driveRelayBatch).not.toHaveBeenCalled()
  })
})

describe('relay host loop interval', () => {
  it('drives every registered open session each tick and keeps ticking after a rejection', async () => {
    const { agent, ctx } = world()
    const onTick = vi.fn()
    startRelayHostLoop(ctx, {
      intervalMs: 15_000,
      getAgent: () => agent as never,
      resolvePorts: () => testPorts(),
      onTick,
    }).observe(SessionId('loop_session'), 'running')
    driveRelayBatch.mockRejectedValueOnce(new Error('Relay batch closed during its drive.'))
    driveRelayBatch.mockResolvedValue({ action: 'waiting', state: null, steps: [], reason: 'run-in-flight' })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(driveRelayBatch).toHaveBeenCalledTimes(1)
    expect(onTick).toHaveBeenCalledWith(SessionId('loop_session'), null)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(driveRelayBatch).toHaveBeenCalledTimes(2)
    expect(onTick).toHaveBeenLastCalledWith(SessionId('loop_session'), { action: 'waiting', state: null, steps: [], reason: 'run-in-flight' })
  })
})
