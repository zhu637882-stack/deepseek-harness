/** Qingmu entry reuses native session creation and preset selection; no model turn is sent. */
import { useSyncExternalStore } from 'react'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { unwrapRpc } from './contracts.ts'
import { readStoryDraft, type NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'

type NativeSessionId = NonNullable<Parameters<ConnectionHandle['api']['sessions']['create']>[0]['sessionId']>

/** Stable Host identity restores a project's director without borrowing another project's history. */
export function projectDirectorSessionId(projectId: string): string | undefined {
  return /^[A-Za-z0-9_-]+$/.test(projectId) ? `session-qingmu-director-${projectId}` : undefined
}

async function waitForSession(sessions: ISessions, sessionId: NativeSessionId, signal: AbortSignal): Promise<void> {
  if (sessions.list.getSnapshot().byId[sessionId]) return
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {}
    const finish = (error?: Error) => {
      clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', aborted)
      if (error) reject(error); else resolve()
    }
    const aborted = () => { finish(new Error('导演进入操作已取消。')) }
    const timer = setTimeout(() => { finish(new Error('导演会话已创建，列表尚未同步，请重新进入以恢复同一会话。')) }, 10000)
    unsubscribe = sessions.list.subscribe(() => {
      if (sessions.list.getSnapshot().byId[sessionId]) finish()
    })
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    else if (sessions.list.getSnapshot().byId[sessionId]) finish()
  })
}

/** Connection generations invalidate readiness and binding without remounting the editor. */
export function useDirectorConnection(source?: HostDescriptionSource) {
  return useSyncExternalStore<ReturnType<HostDescriptionSource['getSnapshot']> | true>(
    listener => source?.subscribe(listener) ?? (() => {}), () => source ? source.getSnapshot() : true)
}

/** Native session entry leaves business data and the current conversation's content unchanged. */
export interface NativeDirectorSessionPort {
  readonly connection: HostDescriptionSource
  readonly story?: NativeStoryPort
  /** Observe durable Host progress; reconnecting never replays a business command. */
  dialogueExecution?(sessionId: string): { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown } | undefined
  /** Enter only after a user action; late completion never changes a newer navigation selection. */
  activate(expectedSessionId: string | undefined, signal: AbortSignal, projectId?: string): Promise<void>
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
  return { connection: connection.hostDescription, story: {
    async prepare(sessionId) {
      const sessions = ctx.get('sessions') as unknown as ISessions | undefined
      const workspaces = ctx.get('workspaces')
      if (!connection.hostDescription.getSnapshot()) throw new Error('青木服务未连接。')
      const list = sessions?.list.getSnapshot()
      const selected = list?.current ? list.byId[list.current] : undefined
      const workspace = workspaces?.list.getSnapshot()
      const cwd = selected?.cwd ?? workspace?.items.find(item => item.workspaceId === workspace.recentWorkspaceId)?.path
      if (!cwd) throw new Error('当前青木工作目录尚未就绪，请刷新页面。')
      unwrapRpc((await connection.api.sessions.create({ sessionId: sessionId as NativeSessionId, cwd, agentPreset: 'qingmu-director' })).result)
    },
    async send(sessionId, text, scope) {
      if (!connection.hostDescription.getSnapshot()) throw new Error('青木服务未连接，没有发送。')
      unwrapRpc((await connection.api.sessions.prompt({ sessionId: sessionId as NativeSessionId, mode: 'queue',
        content: [...(scope ? [{ type: 'text' as const, text: JSON.stringify({ schema: 'qingmu.native-creative-request.v1', sessionId, ...scope }) }] : []),
          { type: 'text', text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })).result)
    },
    async read(sessionId, afterSeq) {
      const history = async () => {
        let beforeSeq: number | undefined
        let events: unknown[] = []
        while (true) {
          const response = await connection.api.sessions.history({ sessionId: sessionId as NativeSessionId,
            maxMessages: 64, ...(beforeSeq !== undefined ? { beforeSeq } : {}) })
          const value = unwrapRpc(response.result)
          if (!value || typeof value !== 'object' || !('events' in value) || !Array.isArray(value.events)) {
            throw new Error('编剧历史响应不完整，请读取原结果。')
          }
          events = [...value.events, ...events]
          const draft = readStoryDraft(events, afterSeq)
          if (draft.running || draft.finished || !('hasMore' in value) || !value.hasMore) return draft
          // Long tool runs can push turn/start out of the latest message page.
          const oldest = value.events[0] as { event?: { seq?: unknown } } | undefined
          const cursor = oldest?.event?.seq
          if (typeof cursor !== 'number' || !Number.isInteger(cursor)
            || (beforeSeq !== undefined && cursor >= beforeSeq)) throw new Error('编剧历史分页不完整，请读取原结果。')
          if (cursor <= afterSeq) return draft
          beforeSeq = cursor
        }
      }
      const draft = await history()
      if (!draft.running) return draft
      // Cold history deliberately preserves an open crash tail. Resume its exact idle
      // composition so native persistence records interruption; never resend a prompt.
      const catalog = (await connection.api.sessions.list({})).result
      if (!catalog.ok) throw new Error(catalog.error.message)
      const retained = catalog.value.items.find(item => item.sessionId === sessionId)
      if (!retained || retained.running) return draft
      if (!retained.cwd || retained.agentPreset !== 'qingmu-director' || retained.parentSessionId) {
        throw new Error('原创作会话身份不完整，无法恢复中断记录。')
      }
      unwrapRpc((await connection.api.sessions.create({ sessionId: sessionId as NativeSessionId,
        cwd: retained.cwd, agentPreset: retained.agentPreset })).result)
      return history()
    },
  }, dialogueExecution(sessionId) {
    const sessions = ctx.get('sessions') as unknown as ISessions | undefined
    const list = sessions?.list.getSnapshot()
    const selected = list?.ids.map(id => list.byId[id]).find(row => row?.id === sessionId)
    return selected?.agentPreset === 'qingmu-director'
      ? sessions?.binding(selected.id)?.session.projections.faceOf('qingmuDialogueExecution') : undefined
  }, async activate(expectedSessionId, signal, projectId) {
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
    if (projectId !== undefined) {
      const projectSessionId = projectDirectorSessionId(projectId) as NativeSessionId | undefined
      if (!projectSessionId) throw new Error('请先选择青木项目。')
      const existing = list.byId[projectSessionId]
      if (existing && existing.agentPreset !== 'qingmu-director') throw new Error('项目导演会话的预设不匹配，请检查会话。')
      const workspaceState = workspaces.list.getSnapshot()
      const cwd = existing?.cwd ?? selected?.cwd
        ?? workspaceState.items.find(item => item.workspaceId === workspaceState.recentWorkspaceId)?.path
      if (!cwd) throw new Error('当前导演会话缺少工作目录，不能猜测恢复位置。')
      unwrapRpc((await connection.api.sessions.create({ sessionId: projectSessionId, cwd, agentPreset: 'qingmu-director' })).result)
      current()
      await waitForSession(sessions, projectSessionId, signal)
      current()
      // An archived director session would be swept back to the New Session
      // view the moment it becomes current; restore it before opening.
      if (workspaces.list.getSnapshot().archivedSessionIds.includes(projectSessionId)) {
        await workspaces.unarchiveSession(projectSessionId)
        current()
      }
      sessions.open(projectSessionId)
      return
    }
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
    if (sessionId.startsWith('session-qingmu-director-') && sessionId !== projectDirectorSessionId(target.scope.projectId)) {
      throw new Error('当前导演不属于这个项目，请进入本项目导演；没有发送。')
    }
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
