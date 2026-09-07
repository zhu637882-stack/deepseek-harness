/** Tool-mount status is independent of shot synchronization and Provider health. */
import { useEffect, useRef, useState } from 'react'
import type { DirectorContextClientPort, NativeDirectorReadiness } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { useDirectorConnection, type NativeDirectorSessionPort } from './native-director-session.ts'

/** Show mount evidence and explicit native entry; no automatic session mutation or model request. */
export function NativeDirectorSession({ port, bridge, sessionId, onRefresh, compact = false }: {
  readonly port: NativeDirectorSessionPort
  readonly bridge: DirectorContextClientPort
  readonly sessionId: string | undefined
  readonly onRefresh: () => void
  readonly compact?: boolean | undefined
}) {
  const connection = useDirectorConnection(port.connection)
  const [snapshot, setSnapshot] = useState<{
    value: NativeDirectorReadiness
    connection: typeof connection
    sessionId: string
  } | null>(null)
  const status = snapshot && snapshot.connection === connection && snapshot.sessionId === sessionId ? snapshot.value : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const operation = useRef<AbortController>()
  const checking = useRef<AbortController>()
  useEffect(() => {
    const request = new AbortController()
    checking.current = request
    setSnapshot(null); setError('')
    if (connection && sessionId && bridge.readNativeDirectorReadiness) {
      void bridge.readNativeDirectorReadiness(sessionId, request.signal).then((value) => {
        if (!request.signal.aborted) setSnapshot({ value, connection, sessionId })
      }).catch(() => { if (!request.signal.aborted) setError('工具状态未能确认，请重新检查；人工编辑仍可用。') })
    }
    return () => { request.abort() }
  }, [connection, sessionId, bridge, revision])
  useEffect(() => {
    operation.current?.abort(); operation.current = undefined; setBusy(false)
    return () => { operation.current?.abort() }
  }, [connection, sessionId, port])
  const refresh = () => { setRevision(value => value + 1); onRefresh() }
  async function activate() {
    if (!connection || operation.current) return
    const request = new AbortController()
    operation.current = request
    checking.current?.abort(); setSnapshot(null); setBusy(true); setError('')
    try {
      await port.activate(sessionId, request.signal)
      if (!request.signal.aborted) refresh()
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : '进入失败，请重新检查会话。')
    } finally {
      if (operation.current === request) { operation.current = undefined; setBusy(false) }
    }
  }
  if (compact) return <section aria-label="青木原生导演会话">
    {(!connection || busy || status?.status !== 'mounted') && <>
      <p role="status">{!connection ? '导演暂时离线。' : busy ? '正在进入导演…'
        : sessionId ? '可以进入或恢复导演，再提出修改要求。' : '进入导演后，可以在这里提出创作要求。'}</p>
      <button type="button" disabled={!connection || busy} onClick={() => { void activate() }}>进入 / 恢复青木导演</button>
    </>}
    {error && <p role="alert">导演连接暂未恢复，重新检查后再试。</p>}
    <details><summary>开发日志 · 导演连接</summary>
      <button type="button" disabled={!connection || busy} onClick={refresh}>重新检查连接</button>
      <pre>{JSON.stringify({ status, error }, null, 2)}</pre>
    </details>
  </section>
  return <section aria-label="青木原生导演会话">
    <p role="status">{!connection ? 'DSH 已断线；导演连接待恢复，人工草稿保留。'
      : !sessionId ? '尚未选择导演会话。'
        : status?.status === 'mounted' ? `当前会话的 ${status.tools.length} 项青木导演工具已挂载。`
          : status?.status === 'inactive' ? '当前会话尚未运行；可进入或恢复青木导演。'
            : status?.status === 'missing-tools' ? '当前会话缺少青木导演工具；镜头绑定不代表工具可用。'
              : status?.status === 'unavailable' || !bridge.readNativeDirectorReadiness ? '当前安装未提供工具状态检查。'
                : error ? '当前会话的工具状态尚未确认。'
                  : busy ? '正在进入青木导演…' : '正在核对当前会话的工具…'}</p>
    <button type="button" disabled={!connection || busy} onClick={() => { void activate() }}>进入 / 恢复青木导演</button>
    <button type="button" disabled={!connection || busy} onClick={refresh}>重新检查连接</button>
    {error && <p role="alert">{error}</p>}
    <p>空会话可切换；已有普通对话保持不变，使用当前工作目录的空白会话。工具挂载不代表模型服务、画面质量或保存已验证。</p>
    {!!status?.missingTools.length && <details><summary>缺少的工具</summary><p>{status.missingTools.join('、')}</p></details>}
  </section>
}
