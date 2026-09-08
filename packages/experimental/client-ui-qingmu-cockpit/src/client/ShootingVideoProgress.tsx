/** Read task progression independently of a cached queue receipt; only a click resumes execution. */
import { useEffect, useRef, useState } from 'react'

/** Writer-owned take count and next admissible ordinal; unknown outcomes have no next ordinal. */
export interface ShootingVideoState {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly taskId: string | null
  readonly kernelStatus: string | null
  readonly takeCount: number
  readonly nextTakeOrdinal: 1 | 2 | null
}
/** Existing video task status and explicit, same-task recovery.
 * @param props Current shot scope, status listener and candidate refresh callback.
 * @returns Read-only progress with an explicit resume action, never automatic submission.
 */
export function ShootingVideoProgress({ scope, onState, onCommitted }: {
  readonly scope: { readonly projectId: string; readonly episodeId: string; readonly frameId: string; readonly sceneId: string }
  readonly onState: (state: ShootingVideoState) => void
  readonly onCommitted: () => Promise<unknown>
}) {
  const [state, setState] = useState<ShootingVideoState>(); const [error, setError] = useState('')
  const [busy, setBusy] = useState(false); const lock = useRef(false); const notified = useRef('')
  const callbacks = useRef({ onState, onCommitted }); callbacks.current = { onState, onCommitted }
  const query = new URLSearchParams({
    project_id: scope.projectId, episode_id: scope.episodeId, frame_id: scope.frameId, scene_id: scope.sceneId,
  }).toString()
  const read = async (resume = false, signal?: AbortSignal) => {
    const response = await fetch(`/api/qingmu/shooting-first-frame/${resume ? 'video-resume' : `video-state?${query}`}`, {
      method: resume ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      ...(signal ? { signal } : {}), ...(resume ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        project_id: scope.projectId, episode_id: scope.episodeId, frame_ids: [scope.frameId],
        scene_id: scope.sceneId, task_id: state?.taskId,
      }) } : {}),
    })
    const value = await response.json() as ShootingVideoState & { execution?: { activated?: boolean } }
    if (!response.ok || value.projectId !== scope.projectId || value.episodeId !== scope.episodeId || value.frameId !== scope.frameId
      || !Number.isSafeInteger(value.takeCount) || value.takeCount < 0 || ![null, 1, 2].includes(value.nextTakeOrdinal)
      || !(value.taskId === null || typeof value.taskId === 'string') || !(value.kernelStatus === null || typeof value.kernelStatus === 'string')) throw new Error('本镜执行状态未能核实，未新建任务')
    if (signal?.aborted) return
    setState(value); setError(''); callbacks.current.onState(value)
    if (resume && value.execution?.activated !== true) setError('原任务尚未恢复执行，请检查执行器；没有新建任务。')
    if (value.kernelStatus === 'Succeeded' && value.taskId && notified.current !== value.taskId) {
      notified.current = value.taskId
      try { await callbacks.current.onCommitted() } catch (cause) { notified.current = ''; throw cause }
    }
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { await read(false, controller.signal) } catch { if (!controller.signal.aborted) setError('暂时无法核对本镜任务，未重新提交。') }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 4000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [query])
  return <section aria-label="视频执行进度">
    {state?.taskId && <p role="status">{state.kernelStatus === 'Succeeded' ? '视频任务已完成，候选已请求刷新；请审看实际视频。'
      : state.kernelStatus === 'DispatchPending' ? '视频任务已入队，等待派发进度更新。'
        : ['Failed', 'Cancelled'].includes(state.kernelStatus ?? '') ? '视频任务已停止，不自动重试。' : '正在读取原视频任务进度。'}</p>}
    {state?.taskId && !['Succeeded', 'Failed', 'Cancelled'].includes(state.kernelStatus ?? '') && !busy && <button onClick={() => {
      if (lock.current) return
      lock.current = true; setBusy(true); setError('')
      void read(true).catch(cause => setError(String(cause))).finally(() => { lock.current = false; setBusy(false) })
    }}>继续原视频任务</button>}
    {state && state.takeCount >= 2 && <p>本镜已达两次生成上限，不再自动返修。</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
