/** Qingmu entry reuses native session creation and preset selection; no model turn is sent. */
import { useSyncExternalStore } from 'react'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { unwrapRpc } from './contracts.ts'

/** Connection generations invalidate readiness and binding without remounting the editor. */
export function useDirectorConnection(source?: HostDescriptionSource) {
  return useSyncExternalStore<ReturnType<HostDescriptionSource['getSnapshot']> | true>(
    source ? (listener: () => void) => source.subscribe(listener) : () => () => {},
    source ? () => source.getSnapshot() : () => true as const)
}

/** Native session entry leaves business data and the current conversation's content unchanged. */
export interface NativeDirectorSessionPort {
  readonly connection: HostDescriptionSource
  /** Observe durable Host progress; reconnecting never replays a business command. */
  dialogueExecution?(sessionId: string): { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown } | undefined
  /** Enter only after a user action; late completion never changes a newer navigation selection. */
  activate(expectedSessionId: string | undefined, signal: AbortSignal): Promise<void>
  /** Queue one user turn in the selected director; acceptance does not imply completion. Never retries. */
  prompt(target: NativeDirectorPromptTarget, text: string, signal: AbortSignal): Promise<void>
}

/**
 * Build an entry action over the existing native API and browser runtime.
 * @param ctx Client context; native session/workspace services are resolved at invocation.
 * @param connection Shared transport; no second connection or retry queue is created.
 * @returns A port which refuses to recompose a started ordinary conversation.
 */
export function createNativeDirectorSessionPort(ctx: ClientContext, connection: ConnectionHandle): NativeDirectorSessionPort {
  return { connection: connection.hostDescription, dialogueExecution(sessionId) {
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const list = sessions?.list.getSnapshot()
    const selected = list?.ids.map(id => list.byId[id]).find(row => row?.id === sessionId)
    return selected?.agentPreset === 'qingmu-director'
      ? sessions?.binding(selected.id)?.session.projections.faceOf('qingmuDialogueExecution') : undefined
  }, async activate(expectedSessionId, signal) {
    // Host and browser share Cordis service names; this port is only installed by the browser runtime.
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const workspaces = ctx.get('workspaces')
    if (!sessions || !workspaces) throw new Error('原生会话服务尚未就绪。')
    const generation = connection.hostDescription.getSnapshot()
    const current = () => {
      signal.throwIfAborted()
      if (!generation || connection.hostDescription.getSnapshot() !== generation) {
        throw new Error('连接已变化；请重新检查会话。')
      }
      if (sessions.list.getSnapshot().current !== expectedSessionId) throw new Error('当前会话已切换；没有跳回旧会话。')
    }
    current()
    const catalog = (await connection.api.agentPresets.list({})).result
    current()
    if (!catalog.ok) throw new Error(catalog.error.message)
    if (!catalog.value.presets.some(preset => preset.id === 'qingmu-director' && !preset.broken)) {
      throw new Error('当前安装没有可用的青木导演预设，请检查 Qingmu profile。')
    }
    const list = sessions.list.getSnapshot()
    const selected = list.ids.map(id => list.byId[id]).find(row => row?.id === expectedSessionId)
    let target = selected?.id
    if (selected?.agentPreset === 'qingmu-director') {
      if (!selected.cwd) throw new Error('当前导演会话缺少工作目录，不能猜测恢复位置。')
      // Native create with the same id resumes an existing composition without sending a prompt.
      unwrapRpc((await connection.api.sessions.create({ sessionId: selected.id, cwd: selected.cwd,
        agentPreset: 'qingmu-director' })).result)
    } else {
      if (!selected?.blank) {
        const workspaceState = workspaces.list.getSnapshot()
        const workspace = selected === undefined && expectedSessionId === undefined
          ? workspaceState.items.find(item => item.workspaceId === workspaceState.recentWorkspaceId)
          : workspaceState.items.find(item => selected && item.sessionIds.includes(selected.id) && item.path === selected.cwd)
        if (!workspace) throw new Error('请先在 DSH 选择当前项目的工作目录；不会替你选其他项目。')
        target = await workspaces.connectWorkspace(workspace.workspaceId)
        current()
      }
      if (!target) throw new Error('没有可用的原生会话。')
      const result = (await connection.api.agentPresets.select({ sessionId: target, agentPreset: 'qingmu-director' })).result
      current()
      if (!result.ok) throw new Error(result.error.message)
      sessions.noteAgentPreset(target, result.value.agentPreset)
    }
    current()
    if (target) sessions.open(target)
  }, async prompt(target, text, signal) {
    signal.throwIfAborted()
    const { sessionId } = target
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const list = sessions?.list.getSnapshot()
    const selected = list?.ids.map(id => list.byId[id]).find(row => row?.id === sessionId)
    if (!connection.hostDescription.getSnapshot() || list?.current !== sessionId
      || selected?.agentPreset !== 'qingmu-director') {
      throw new Error('当前导演会话已变化，请重新检查连接；没有发送。')
    }
    if (!text.trim() || text.length > 16000) throw new Error('请输入 1 至 16000 字的导演要求。')
    const result = (await connection.api.sessions.prompt({ sessionId: selected.id, mode: 'queue',
      content: [{ type: 'text', text: JSON.stringify(target) }, { type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, signal)).result
    if (!result.ok) throw new Error(result.error.message)
  } }
}
