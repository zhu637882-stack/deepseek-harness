/** Relay-only execution gates; ordinary native director sessions keep their existing execution path. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tool-skill'
import { assertNativePromptSelection, assertNativePromptTarget, hasHostDirectorOwner, invalidateHostDirectorBinding,
  withHostDirectorOperation, withHostDirectorStream } from './bridge.ts'
import { readRelayState, relayBatchIsOpen } from './relay-state.ts'
import { assertNativeTurnTarget } from './native-prompt-target.ts'

/** Relay gates apply while an open batch reserves the session; terminal batches leave ordinary turns on their existing path. */
function activeRelay(session: Session) {
  const state = readRelayState(session)
  return state && relayBatchIsOpen(state) ? state : null
}

function admittedRelay(session: Session) {
  const state = activeRelay(session)
  if (!state || state.mode !== 'running' || !hasHostDirectorOwner(session)
    || Date.parse(state.start.authorization.expiresAt) <= Date.now()) {
    throw new Error('Relay execution requires a running, unexpired batch and its live Host lease.')
  }
  const preparing = state.items.filter(item => item.phase === 'preparing')
  const item = preparing[0]
  const admission = item?.admissions.at(-1)
  if (preparing.length !== 1 || !item || !admission) throw new Error('Relay execution requires one exact admitted director message.')
  const target = { schema: 'qingmu.native-director-request.v1' as const, sessionId: session.id, ownerId: state.start.batchId, scope: item.scope,
    contextSnapshotSha256: admission.contextSnapshotSha256 }
  const first = admission.message.content[0]
  if (first?.type !== 'text') throw new Error('Relay admission is missing its fixed shot target.')
  const marker: unknown = JSON.parse(first.text)
  if (JSON.stringify(marker) !== first.text || !isDeepStrictEqual(marker, target)) {
    throw new Error('Relay admission does not belong to this session and Host lease.')
  }
  assertNativePromptSelection(session, target)
  return { state, item, admission, target }
}

function runtimeContext(message: UserMessage, session: Session, turn: number): boolean {
  if (message.source.kind === 'skill-catalog'
    || message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-system-prompt') return true
  if (message.source.kind !== 'plugin' || message.source.plugin !== 'compact') return false
  const events = session.events
  const index = events.findIndex(event => event.type === 'user/message' && event.data.id === message.id)
  const replacement = events[index]
  const summary = events[index - 1]
  if (replacement?.type !== 'user/message' || summary?.type !== 'compaction/summary'
    || !isDeepStrictEqual(replacement.data, message)) return false
  const { compactionId, sourceCommandId, shadowedRange, shadowedSeqs } = summary.data
  const start = events.find(event => event.type === 'compaction/start' && event.data.compactionId === compactionId)
  const end = events.find(event => event.type === 'compaction/end' && event.data.compactionId === compactionId)
  return start?.type === 'compaction/start' && end?.type === 'compaction/end'
    && start.data.turn === turn && end.data.turn === turn && end.data.error === undefined
    && start.seq < summary.seq && replacement.seq < end.seq
    && start.data.sourceCommandId === sourceCommandId && end.data.sourceCommandId === sourceCommandId
    && isDeepStrictEqual(message.source, { kind: 'plugin', plugin: 'compact', compactionId,
      ...sourceCommandId === undefined ? {} : { sourceCommandId } })
    && isDeepStrictEqual(replacement.surfaceOp, { op: 'replace', ...shadowedRange })
    && isDeepStrictEqual(replacement.sourceEventSeqs, [start.seq, summary.seq, ...shadowedSeqs])
}

function consumedAdmission(session: Session, turn: number, required: boolean) {
  const admitted = admittedRelay(session)
  const start = session.events.findLast(event => event.type === 'turn/start' && event.data.turn === turn)
  const copies = session.events.filter(event => event.type === 'user/message' && event.data.id === admitted.admission.message.id)
  const current = session.events.filter(event => event.type === 'user/message' && event.seq > (start?.seq ?? Infinity))
  if (!start || copies.length > 1 || copies.some(event => event.type === 'user/message'
    && (event.seq <= start.seq || !isDeepStrictEqual(event.data, admitted.admission.message)))
    || current.some(event => event.type === 'user/message' && event.data.id !== admitted.admission.message.id && !runtimeContext(event.data, session, turn))
    || required && copies.length !== 1) {
    throw new Error('Relay execution does not match the uniquely consumed admission in this turn.')
  }
  return { ...admitted, consumed: copies.length === 1 }
}

async function flushAdmission(ctx: Context, session: Session, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  try {
    if (!ctx.get('sessionPersistence') || !await ctx.sessions.flush(session)) {
      throw new Error('Relay execution requires durable session persistence before external effects.')
    }
  } catch (error) {
    invalidateHostDirectorBinding(session)
    throw error
  }
  signal.throwIfAborted()
  admittedRelay(session)
}

function assertRelayStream(session: Session, options: GenerateOptions): void {
  const events = session.events
  const turn = events.findLast(event => event.type === 'turn/start')
  if (!turn || events.some(event => event.type === 'turn/end' && event.seq > turn.seq)) {
    throw new Error('Relay model call has no active preparation turn.')
  }
  const compaction = options.purpose === 'compaction'
  const { state } = consumedAdmission(session, turn.data.turn, !compaction)
  if (compaction) {
    const start = events.findLast(event => event.type === 'compaction/start')
    if (!start || start.seq <= turn.seq || start.data.turn !== turn.data.turn
      || events.some(event => (event.type === 'compaction/end' || event.type === 'compaction/summary')
        && event.data.compactionId === start.data.compactionId)) {
      throw new Error('Relay compaction requires the current open compaction transaction.')
    }
  } else if (!isAgentLoopRequest(options)) {
    const { signal, ...request } = options
    signal?.throwIfAborted()
    const observation = events.findLast(event => event.type === 'qingmu-director-vision/request')
    const call = observation?.type === 'qingmu-director-vision/request'
      ? events.findLast(event => event.type === 'tool/call' && event.data.callId === observation.data.callId)
      : undefined
    if (!observation || !call || call.type !== 'tool/call' || call.data.turn !== turn.data.turn || observation.seq <= call.seq
      || !['qingmu_view_reference_image', 'qingmu_capture_reference_video_frame'].includes(call.data.name)
      || events.some(event => event.type === 'tool/result' && event.data.message.source.callId === call.data.callId
        || event.type === 'qingmu-director-vision/result' && event.seq > observation.seq && event.data.callId === call.data.callId)
      || !isDeepStrictEqual(observation.data.request, request)
      || options.provider !== state.start.observer?.provider || options.model !== state.start.observer.model) {
      throw new Error('Relay observer call requires its authorized route and exact pending logged tool request.')
    }
    assertNativeTurnTarget(session, call.data.callId, 'before-refresh')
    return
  }
  if (options.provider !== state.start.director.provider || options.model !== state.start.director.model) {
    throw new Error('Relay model route does not match the authorized director.')
  }
}

/** Install final-message, model-route and asynchronous tool ownership checks in the director preset.
 * @param ctx Native director's scoped plugin context.
 */
export function registerRelayExecutionGuard(ctx: Context): void {
  const scope = scopeOf(ctx)
  const preparedCompactions = new WeakSet<GenerateOptions>()
  ctx.on('llm/stream', function (options, next) {
    const agent = options.sessionId === undefined ? undefined : ctx.get('agents')?.get(options.sessionId)
    if (!agent || scope !== undefined && !scopeChainOf(agent).includes(scope) || !activeRelay(agent.session)) return next()
    const session = agent.session
    const prepareCall = (config: LlmCallConfig, signal: AbortSignal) => this.prepareCall(config, signal)
    const prepared = preparedCompactions.delete(options)
    return withHostDirectorStream(session, async function* () {
      const signal = options.signal
      if (!signal) throw new Error('Relay model calls require their owning cancellation signal.')
      signal.throwIfAborted()
      assertRelayStream(session, options)
      await flushAdmission(ctx, session, signal)
      assertRelayStream(session, options)
      if (options.purpose === 'compaction' && !prepared) {
        const { provider, model, reasoningEffort, temperature, maxTokens, stop } = options
        const call = await prepareCall({ provider, model,
          ...reasoningEffort === undefined ? {} : { reasoningEffort },
          ...temperature === undefined ? {} : { temperature },
          ...maxTokens === undefined ? {} : { maxTokens },
          ...stop === undefined ? {} : { stop } }, signal)
        signal.throwIfAborted()
        assertRelayStream(session, options)
        const request = { ...options, ...call.config }
        // Reentry skips only preparation; downstream persistence awaits still require fresh authorization.
        preparedCompactions.add(request)
        try {
          yield* call.stream(request)
        } finally {
          preparedCompactions.delete(request)
        }
      } else {
        yield* next()
      }
    })
  })
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next) => {
    if (!activeRelay(agent.session)) return next()
    const check = (input: readonly UserMessage[], projected: boolean) => {
      const admitted = consumedAdmission(agent.session, turn, false)
      const supplied = projected ? input.filter(message => !runtimeContext(message, agent.session, turn)) : input
      if (admitted.consumed ? supplied.length !== 0
        : supplied.length !== 1 || !isDeepStrictEqual(supplied[0], admitted.admission.message)) {
        throw new Error('Relay input changed after its durable admission; no model request was sent.')
      }
      if (!admitted.consumed) assertNativePromptTarget(agent.session, admitted.target)
    }
    check(messages, false)
    return withHostDirectorOperation(agent.session, async () => {
      await flushAdmission(ctx, agent.session, signal)
      check(messages, false)
      const decision = await next()
      if (decision.kind === 'reject') return decision
      check(decision.messages, true)
      await flushAdmission(ctx, agent.session, signal)
      check(decision.messages, true)
      return decision
    })
  }, { prepend: true })
  ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    if (!activeRelay(agent.session)) return next()
    consumedAdmission(agent.session, turn, true)
    return withHostDirectorOperation(agent.session, async () => {
      const config = await next()
      await flushAdmission(ctx, agent.session, signal)
      const { state } = consumedAdmission(agent.session, turn, true)
      if (config.provider !== state.start.director.provider || config.model !== state.start.director.model) {
        throw new Error('Relay director model changed from the authorized batch route; no model request was sent.')
      }
      return config
    })
  }, { prepend: true })
  ctx.on('tools/execute', async (exec, next) => {
    const session = exec.agent?.session
    if (!session || !activeRelay(session)) return next()
    const call = session.events.findLast(event => event.type === 'tool/call' && event.data.callId === exec.callId)
    if (!call || call.type !== 'tool/call') throw new Error('Relay tool has no consumed director call.')
    consumedAdmission(session, call.data.turn, true)
    if (['qingmu_save_working_cut', 'qingmu_import_acoustic_response', 'qingmu_submit_experience_capsule'].includes(call.data.name)) {
      throw new Error('Relay preparation cannot change the episode working cut, import acoustics, or submit shared experience.')
    }
    return withHostDirectorOperation(session, async () => {
      await flushAdmission(ctx, session, exec.signal)
      consumedAdmission(session, call.data.turn, true)
      assertNativeTurnTarget(session, exec.callId, 'before-refresh')
      return next()
    })
  }, { prepend: true })
}
