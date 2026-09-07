/** Read-only native execution feedback; no retry, generation or approval is performed here. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NativeDialogueExecution, NativeDirectorPromptTarget } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { useDirectorConnection, type NativeDirectorSessionPort } from './native-director-session.ts'

const absent = { subscribe: () => () => {}, getSnapshot: () => undefined }
function execution(value: unknown): NativeDialogueExecution | undefined {
  if (!value || typeof value !== 'object') return
  const state = value as NativeDialogueExecution
  if (!state.scope || !['projectId', 'episodeId', 'sceneId', 'shotId'].every(key =>
    typeof state.scope[key as keyof typeof state.scope] === 'string')
    || typeof state.before !== 'string' || typeof state.after !== 'string'
    || !['prepared', 'saving', 'saved', 'uncertain', 'input_prepared'].includes(state.status)
    || !(state.commandReceiptId === null || typeof state.commandReceiptId === 'string')
    || ![state.affectedShots, state.unchangedShots].every(shots => Array.isArray(shots)
      && shots.every(shot => shot && typeof shot.shotId === 'string' && Number.isFinite(shot.frameNo)))) return
  return state
}

/** Read a projection from the existing session stream, never a polling or command loop. */
export function useNativeDialogueExecution(port: NativeDirectorSessionPort | undefined, sessionId: string | undefined) {
  const connection = useDirectorConnection(port?.connection)
  const face = useMemo(() => sessionId && connection ? port?.dialogueExecution?.(sessionId) ?? absent : absent,
    [port, sessionId, connection])
  return execution(useSyncExternalStore(face.subscribe, face.getSnapshot))
}

/** Saving feedback is replayable; reload only reads the existing project, never resubmits the edit. */
export function NativeDialogueProgress({ port, sessionId, target, onCommitted }: {
  port: NativeDirectorSessionPort
  sessionId: string | undefined
  target: NativeDirectorPromptTarget | undefined
  onCommitted: (() => Promise<unknown>) | undefined
}) {
  const state = useNativeDialogueExecution(port, sessionId)
  const visible = state && target && target.sessionId === sessionId
    && Object.entries(target.scope).every(([key, value]) => state.scope[key as keyof typeof state.scope] === value) ? state : undefined
  const refreshed = useRef('')
  const refresh = useRef(onCommitted)
  refresh.current = onCommitted
  const [refreshFailed, setRefreshFailed] = useState(false)
  const receipt = visible && ['saved', 'input_prepared'].includes(visible.status)
    && visible.commandReceiptId ? `${visible.status}:${visible.commandReceiptId}` : null
  useEffect(() => {
    if (!receipt || !refresh.current || refreshed.current === `${sessionId}:${receipt}`) return
    refreshed.current = `${sessionId}:${receipt}`
    let current = true
    setRefreshFailed(false)
    void refresh.current().catch(() => { if (current) setRefreshFailed(true) })
    return () => { current = false }
  }, [receipt, sessionId])
  if (!visible) return null
  const status = { prepared: '已核对影响范围，尚未保存。', saving: '正在保存台词与受影响镜头…',
    saved: '台词与受影响镜头已保存，视频尚未重新生成。',
    input_prepared: '视频输入已准备，请查看下方输入与首帧。尚未生成视频。',
    uncertain: '保存结果尚未核实。导演需查询原操作结果，不重复创建修改。' }[visible.status]
  return <section aria-label="台词修改进展" aria-live="polite">
    <p>“{visible.before}” → “{visible.after}”</p>
    <p>更新：{visible.affectedShots.map(shot => `镜${shot.frameNo}`).join('、')}</p>
    <p>{visible.unchangedShots.length
      ? `未关联这句台词的镜头保持原样：${visible.unchangedShots.map(shot => `镜${shot.frameNo}`).join('、')}`
      : '没有其他未关联这句台词的镜头。'}</p>
    <p role="status">{status}</p>
    {refreshFailed && <p role="alert">修改已保存，页面读取暂时失败；刷新页面即可重新读取，不要重新提交修改。</p>}
  </section>
}
