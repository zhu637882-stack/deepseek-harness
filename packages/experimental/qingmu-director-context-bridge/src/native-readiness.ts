/** Inspect mounted tools for one live agent without starting a turn or loading a preset. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import type { NativeDirectorReadiness } from './types.ts'

const required = ['qingmu_read_bound_context', 'qingmu_get_imago_method',
  'qingmu_read_prompt_draft', 'qingmu_propose_prompt_edit'] as const

/**
 * Read the live agent's scoped tool registry, not its recorded preset label.
 * @param ctx Host context with optional native services.
 * @param session Attached session; inspection does not resume inactive agents.
 * @returns Mount evidence only, not Provider health, tool execution or creative approval.
 */
export function readNativeDirectorReadiness(ctx: Context, session: Session): NativeDirectorReadiness {
  const agent = ctx.get('agents')?.get(session.id)
  if (!agent) return { status: 'inactive', presetId: null, tools: [], missingTools: [...required] }
  const presets = ctx.get('agentPresets')
  const registry = presets?.serviceFor(agent, 'tools') ?? ctx.get('tools')
  const tools = required.filter(name => registry?.get(name, agent) !== undefined)
  return { status: tools.length === required.length ? 'mounted' : 'missing-tools',
    presetId: presets?.composedPreset(agent.ctx) ?? null, tools,
    missingTools: required.filter(name => !tools.includes(name)) }
}
