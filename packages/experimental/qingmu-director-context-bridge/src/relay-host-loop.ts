/** Host-side relay drive loop: keeps a running relay batch advancing from the Host process,
 * so the browser page can close after batch creation. The browser RPC drive shares the same
 * per-session single-flight gate; the periodic tick only drives running batches, so a paused
 * batch waits for its explicit resume path exactly as it does today. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { driveRelayBatch, type RelayDriveReport, type RelayRunnerPorts } from './relay-runner.ts'
import { readRelayState, type RelayState } from './relay-state.ts'

/** Default drive cadence, matching the browser panel's historical poll interval. */
export const DEFAULT_RELAY_DRIVE_INTERVAL_MS = 15_000

/** The agent surfaces one loop drive needs; the live Agent satisfies this structurally. */
type LoopAgent = Pick<Agent, 'session' | 'status' | 'followup' | 'whenIdle'>

/** Everything the loop resolves per drive attempt; a null ports result parks the batch as waiting. */
export interface RelayHostLoopOptions {
  /** Drive cadence in milliseconds for the periodic tick. */
  readonly intervalMs: number
  /** Resolve the live agent owning one relay session; absent agents park the batch, never fail the tick. */
  readonly getAgent: (sessionId: SessionId) => LoopAgent | undefined
  /** Resolve the runner ports, or null when a read port is not mounted yet. */
  readonly resolvePorts: () => RelayRunnerPorts | null
  /** Observability sink for every tick outcome; absent in production. */
  readonly onTick?: (sessionId: SessionId, report: RelayDriveReport | null) => void
}

/** The loop's controlled surface, also consumed by the browser RPC path. */
export interface RelayHostLoop {
  /** Sessions currently registered as open relay batches. */
  readonly open: ReadonlySet<SessionId>
  /** Register or unregister one session from its latest relay snapshot; a null mode unregisters. */
  observe(sessionId: SessionId, mode: RelayState['mode'] | null): void
  /** One gated drive attempt; null when this attempt was skipped (already in flight, or not running
   *  when `requireRunning` holds, which the periodic tick always passes). */
  driveOnce(sessionId: SessionId, signal: AbortSignal, requireRunning: boolean): Promise<RelayDriveReport | null>
  /** The RPC face of the same gate without the running requirement; a skipped attempt reports waiting. */
  driveForRpc(sessionId: SessionId, signal: AbortSignal): Promise<RelayDriveReport>
}

/** Start the loop's interval and return its control surface; the timer is scoped to `ctx`. */
export function startRelayHostLoop(ctx: Context, options: RelayHostLoopOptions): RelayHostLoop {
  const open = new Set<SessionId>()
  const inFlight = new Set<SessionId>()
  const driveOnce = async (
    sessionId: SessionId,
    signal: AbortSignal,
    requireRunning: boolean,
  ): Promise<RelayDriveReport | null> => {
    if (inFlight.has(sessionId)) return null
    inFlight.add(sessionId)
    try {
      const agent = options.getAgent(sessionId)
      if (agent === undefined) return null
      const state = readRelayState(agent.session)
      if (state === null || (requireRunning && state.mode !== 'running')) return null
      const ports = options.resolvePorts()
      if (ports === null) {
        return { action: 'waiting', state, steps: [], reason: 'read-port-unavailable' }
      }
      return await driveRelayBatch(agent, ports, [], signal)
    } finally {
      inFlight.delete(sessionId)
    }
  }
  const loop: RelayHostLoop = {
    open,
    observe(sessionId, mode) {
      if (mode === null || mode === 'completed' || mode === 'closed') open.delete(sessionId)
      else open.add(sessionId)
    },
    driveOnce,
    async driveForRpc(sessionId, signal) {
      if (inFlight.has(sessionId)) {
        return { action: 'waiting', state: null, steps: [], reason: 'drive-in-progress' }
      }
      if (options.getAgent(sessionId) === undefined) {
        return { action: 'waiting', state: null, steps: [], reason: 'agent-unavailable' }
      }
      const report = await driveOnce(sessionId, signal, false)
      return report ?? { action: 'waiting', state: null, steps: [], reason: 'drive-in-progress' }
    },
  }
  ctx.effect(() => {
    const timer = setInterval(() => {
      for (const sessionId of open) {
        // Serial registration order keeps one ledger writer at a time, and each rejected
        // drive is contained so one broken session never stops the others.
        void loop.driveOnce(sessionId, new AbortController().signal, true)
          .then((report) => { options.onTick?.(sessionId, report) })
          .catch((error: unknown) => {
            ctx.logger.warn(`relay drive for "${String(sessionId)}" rejected: ${String(error)}`)
            options.onTick?.(sessionId, null)
          })
      }
    }, options.intervalMs)
    timer.unref()
    return () => { clearInterval(timer) }
  }, 'qingmu-director-context: relay host drive loop')
  return loop
}
