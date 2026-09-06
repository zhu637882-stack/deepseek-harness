/** Session-scoped, read-only tools connecting the native DSh loop to Writer and IMAGO. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { snapshotJsonValue, type JsonValue, type Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DirectorContextSnapshot } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
import { createDirectorContextBridge } from './bridge.ts'
import type { DirectorContextBindingState } from './types.ts'
import type {} from './index.ts'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import { findNativeDraftInput, nativeDraftFields, nativeDraftSource, readNativeDraftInput } from './native-draft.ts'
import { findNativeFirstDraftInput, firstDraftSource, readNativeFirstDraftInput } from './native-first-draft.ts'

/** Opt-in native-agent consumer; the Host binding plugin remains independently usable. */
export const name = 'qingmu-director-model-tools'
/** Configured Host handlers own credentials, normalization and method-root selection. */
export const inject = ['tools', 'qingmuYimengCommand', 'qingmuImagoMethod']

/** Bounds apply to each complete tool response, never to a silently truncated method. */
export interface Config {
  /** Maximum UTF-8 bytes in a model-visible response; positive integer. */
  maxOutputBytes?: number
}

/** Validate the per-response acquisition limit for this consumer. */
export const Config: z<Config> = z.object({
  maxOutputBytes: z.number().step(1).min(1).default(262144),
})

function exactArgs(args: object, keys: readonly string[]): void {
  if (Object.keys(args).sort().join() !== [...keys].sort().join()) {
    throw new Error('Qingmu tool arguments cannot select a session, project or filesystem path.')
  }
}

function boundedJson(value: unknown, limit: number): JsonValue {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('Qingmu read result is not lossless JSON.')
  const serialized = JSON.stringify(snapshot)
  if (Buffer.byteLength(serialized, 'utf8') > limit) {
    throw new Error('Qingmu read result exceeds maxOutputBytes; no content was truncated. Adjust the host limit or use a narrower method resource.')
  }
  // snapshotJsonValue validates the unknown Host result before the tool's JSON output boundary.
  return snapshot as JsonValue
}

function bindingSeq(session: Session): number | undefined {
  return session.events.findLast(event => event.type === 'qingmu-director-context/state')?.seq
}

/**
 * Register reads in a Qingmu agent/preset scope, never in the global Host tool set.
 * Tool results enter the native loop's durable log; no business write, Provider
 * dispatch, inferred approval or automatic work-order creation is exposed.
 * @param ctx - Scoped plugin context with configured Host adapters.
 * @param config - Complete-response byte limit.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (scopeOf(ctx) === undefined) {
    throw new Error('Qingmu director tools must be mounted in an agent or preset scope, not the Host root.')
  }
  const maxOutputBytes = config.maxOutputBytes ?? 262144
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error('maxOutputBytes must be a positive safe integer.')
  }

  async function readBoundContext(exec: ToolRunContext): Promise<{
    session: Session
    state: DirectorContextBindingState
    context: DirectorContextSnapshot
    seq: number | undefined
  }> {
    exec.signal.throwIfAborted()
    if (exec.agent === undefined) throw new Error('Qingmu director tool requires an owning agent session.')
    const session = exec.agent.session
    let context: DirectorContextSnapshot | undefined
    let outputError: Error | undefined
    const bridge = createDirectorContextBridge({
      async readDirectorContext(scope, signal) {
        const result = await ctx.qingmuYimengCommand('readDirectorContext', scope, signal ?? exec.signal)
        exec.signal.throwIfAborted()
        if (!result.ok) return { ok: false, reason: 'context_unavailable' }
        try {
          boundedJson(result.value, maxOutputBytes)
        } catch (error) {
          outputError = error instanceof Error ? error : new Error('Invalid Qingmu context JSON.')
          throw outputError
        }
        context = result.value as DirectorContextSnapshot
        return { ok: true, context }
      },
    })
    const previous = bridge.current(session)
    if (previous === null) {
      throw new Error('No Qingmu shot is bound to this session. Select a project and shot in the workspace; manual editing remains available.')
    }
    const result = await bridge.enter(session, previous.binding.scope, exec.signal)
    exec.signal.throwIfAborted()
    if (outputError !== undefined) throw outputError
    if (result.status !== 'current' || context === undefined) {
      throw new Error(result.status === 'superseded'
        ? 'The selected Qingmu object changed during this read. Read the current shot again.'
        : 'Current Qingmu context is unavailable. Manual editing remains available; no generation was requested.')
    }
    return { session, state: result.state, context, seq: bindingSeq(session) }
  }

  ctx.tools.register(defineTool({
    name: 'qingmu_read_bound_context',
    description: 'Read the current Qingmu project, scene and shot creative input for this session before making director suggestions. The workspace chooses the object. This read refreshes the binding, does not generate or approve anything, and does not inspect image pixels.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取当前镜头的创作上下文' }),
    async execute(args, exec) {
      exactArgs(args, [])
      const current = await readBoundContext(exec)
      return boundedJson({
        schema: 'qingmu.native-director-context.v1',
        scope: current.state.binding.scope,
        contextSnapshotSha256: current.state.binding.contextSnapshotSha256,
        contextSnapshot: current.context,
        authority: { readOnly: true, businessStateChanged: false, humanApprovalGranted: false, providerCalls: 0 },
        guidance: 'Base suggestions on this snapshot. Missing information is unknown, not permission to invent story facts or approve assets. Reread before applying changes.',
      }, maxOutputBytes)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qingmu_get_imago_method',
    description: 'Load actual IMAGO director or execution-storyboard instructions for the bound Qingmu shot. Read these before proposing scene intent, performance, blocking, coverage, dialogue or sound-picture changes. If additionalReferences lists a required resource, call again with that resourceId before claiming its method was read. Method instructions are guidance, not project facts or authority to run the IMAGO controller.',
    parameters: {
      capability: { type: 'string', required: true, enum: ['director_development', 'shot_design'] },
      resourceId: { type: 'string', enum: ['rough_final_feedback'] },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '读取 IMAGO 导演方法' }),
    async execute(args, exec) {
      exactArgs(args, args.resourceId === undefined ? ['capability'] : ['capability', 'resourceId'])
      if (args.resourceId !== undefined && args.capability !== 'shot_design') {
        throw new Error('rough_final_feedback is a shot_design reference, not a director_development resource.')
      }
      const current = await readBoundContext(exec)
      const payload = args.resourceId === undefined
        ? { capability: args.capability }
        : { capability: args.capability, resourceId: args.resourceId }
      const method = await ctx.qingmuImagoMethod('directorInstructions', payload, exec.signal)
      exec.signal.throwIfAborted()
      if (bindingSeq(current.session) !== current.seq) {
        throw new Error('The selected Qingmu object changed while loading IMAGO methods. Read the current shot again.')
      }
      if (!method.ok) throw new Error('IMAGO director instructions are unavailable; no replacement method was invented.')
      return boundedJson({
        schema: 'qingmu.native-director-method.v1',
        scope: current.state.binding.scope,
        contextSnapshotSha256: current.state.binding.contextSnapshotSha256,
        method: method.value,
        authority: { readOnly: true, businessStateChanged: false, humanApprovalGranted: false, providerCalls: 0 },
        guidance: 'Use this method to prepare editable suggestions from the bound Writer context. Read any required additionalReferences with a follow-up tool call; listed source hashes are not proof that their content was read. This is not IMAGO project initialization, a completed stage, content approval, or permission to invoke a Provider.',
      }, maxOutputBytes)
    },
  }))

  // The two context tools remain available without the optional PromptIR reader.
  ctx.inject(['qingmuYimengRead'], (draftHost) => {
    async function readFirstInput(exec: ToolRunContext) {
      const current = await readBoundContext(exec)
      if (current.seq === undefined) throw new Error('Current session binding is unavailable.')
      const input = await readNativeFirstDraftInput(current.context, current.state.binding.scope, current.seq, {
        prompt: draftHost.qingmuYimengRead, method: ctx.qingmuImagoMethod,
      }, exec.signal)
      exec.signal.throwIfAborted()
      if (bindingSeq(current.session) !== current.seq) throw new Error('The current shot changed; read the first-draft inputs again.')
      return input
    }
    draftHost.tools.register(defineTool({
      name: 'qingmu_read_first_draft',
      description: 'When this shot has no PromptIR, read its current storyboard, selected references, directing context and full IMAGO C5 instructions. Preserve locked story, dialogue, acting, spatial and sound decisions; missing facts remain unknown. Return receiptId to qingmu_propose_first_draft. Read-only; does not inspect pixels or create a Draft.',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      presentCall: () => ({ card: 'generic', kind: 'read', title: '读取首稿上游与 IMAGO 导演方法' }),
      async execute(args, exec) {
        exactArgs(args, [])
        return boundedJson(await readFirstInput(exec), maxOutputBytes)
      },
    }))
    draftHost.tools.register(defineTool({
      name: 'qingmu_propose_first_draft',
      description: 'Propose the first editable prompt from a qingmu_read_first_draft receipt. Supply all five creative text fields and a directing rationale. Image text describes the initial state; video/motion describe its change and inherited sound/dialogue. Do not invent identity, reference assets or approvals. This records a suggestion, never saves, selects Ready or generates media.',
      parameters: {
        receiptId: { type: 'string', required: true }, reason: { type: 'string', required: true },
        imageGenPrompt: { type: 'string', required: true }, lastFrameImagePrompt: { type: 'string', required: true },
        videoGenPrompt: { type: 'string', required: true }, motionPrompt: { type: 'string', required: true },
        negativePrompt: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      presentCall: () => ({ card: 'generic', kind: 'read', title: '提出首份导演草稿（未保存）' }),
      async execute(args, exec) {
        exactArgs(args, ['receiptId', 'reason', ...nativeDraftFields])
        if (!exec.agent) throw new Error('A native director session is required.')
        if (!args.reason.trim() || args.reason !== args.reason.trim() || args.reason.includes('\u0000') || args.reason.length > 2000 || nativeDraftFields.some(field =>
          args[field].length > 30000 || args[field] !== args[field].trim() || args[field].includes('\u0000'))) {
          throw new Error('Supply trimmed text without NUL, at most 30000 characters per field and a 2000-character rationale.')
        }
        const input = findNativeFirstDraftInput(exec.agent.session, args.receiptId)
        if ((await readFirstInput(exec)).receiptId !== input.receiptId) throw new Error('Upstream or method changed; read and reconsider the first draft.')
        const { receiptId: _receipt, reason, ...editableProjection } = args
        return boundedJson({ schema: 'qingmu.native-first-draft-proposal.v1', input: firstDraftSource(input),
          editableProjection, reason }, maxOutputBytes)
      },
    }))
    async function readInput(exec: ToolRunContext) {
      const current = await readBoundContext(exec)
      if (current.seq === undefined) throw new Error('Current session binding is unavailable.')
      const input = await readNativeDraftInput(current.context, current.state.binding.scope, current.seq, {
        prompt: draftHost.qingmuYimengRead, method: ctx.qingmuImagoMethod,
      }, exec.signal)
      exec.signal.throwIfAborted()
      if (bindingSeq(current.session) !== current.seq) throw new Error('The current shot changed; read the draft again.')
      return input
    }
    draftHost.tools.register(defineTool({
      name: 'qingmu_read_prompt_draft',
      description: 'Read the bound shot context, current Ready/draft prompt fields and complete IMAGO C5 instructions before editing a prompt. Return receiptId to qingmu_propose_prompt_edit. This is read-only; missing facts remain unknown. It does not inspect image pixels, approve content or generate media.',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      presentCall: () => ({ card: 'generic', kind: 'read', title: '读取当前提示词与 IMAGO 分镜方法' }),
      async execute(args, exec) {
        exactArgs(args, [])
        return boundedJson(await readInput(exec), maxOutputBytes)
      },
    }))
    draftHost.tools.register(defineTool({
      name: 'qingmu_propose_prompt_edit',
      description: 'Propose one editable prompt field using a receipt from qingmu_read_prompt_draft. Give the full replacement text and explain its directing purpose. The original text and scope come from the recorded read, not your arguments. The workspace can adopt it into an unsaved draft; this tool never saves, approves, generates or runs legacy scene planning. If stale, reread and reconsider rather than relabelling an old suggestion.',
      parameters: {
        receiptId: { type: 'string', required: true },
        field: { type: 'string', required: true, enum: [...nativeDraftFields] },
        replacement: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      presentCall: () => ({ card: 'generic', kind: 'read', title: '提交待采用的导演建议（未保存）' }),
      async execute(args, exec) {
        exactArgs(args, ['receiptId', 'field', 'replacement', 'reason'])
        if (!exec.agent) throw new Error('A native director session is required.')
        if (!args.reason.trim() || args.reason.length > 2000 || args.replacement.length > 30000) {
          throw new Error('Explain the suggestion within 2000 characters; replacement limit is 30000 characters.')
        }
        const input = findNativeDraftInput(exec.agent.session, args.receiptId)
        const current = await readInput(exec)
        if (current.receiptId !== input.receiptId) throw new Error('The context, draft or IMAGO method changed. Read and reconsider the suggestion.')
        const before = (input.prompt.draft?.subject ?? input.prompt.subject).editableProjection[args.field]
        if (args.replacement === before) throw new Error('The proposed field is unchanged.')
        return boundedJson({ schema: 'qingmu.native-draft-proposal.v1', input: nativeDraftSource(input), field: args.field,
          before, after: args.replacement, reason: args.reason }, maxOutputBytes)
      },
    }))
  })
}
