/** Tool-mount status is independent of shot synchronization and Provider health. */
import { useEffect, useRef, useState } from 'react'
import type { DirectorContextClientPort, NativeDirectorReadiness } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import { useDirectorConnection, type NativeDirectorSessionPort } from './native-director-session.ts'
import css from './NativeDirectorSession.module.css'

const COLD_SESSION_UNAVAILABLE = 'director context session unavailable'
const COLD_SESSION_RECOVERY = '上次导演会话尚未恢复。请点击“进入 / 恢复青木导演”恢复当前项目会话；不会发送导演要求。'
const ACTIONABLE_NATIVE_ENTRY_ERRORS = new Set([
  '原生会话服务尚未就绪。',
  '连接已变化；请重新检查会话。',
  '当前会话已切换；没有跳回旧会话。',
  '当前安装没有可用的青木导演预设，请检查 Qingmu profile。',
  '当前导演会话缺少工作目录，不能猜测恢复位置。',
  '请先在 DSH 选择当前项目的工作目录；不会替你选其他项目。',
  '没有可用的原生会话。',
])

/** Keep bridge-only errors out of the creative UI while preserving the one recoverable state. */
function directorErrorMessage(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : undefined
  if (message === COLD_SESSION_UNAVAILABLE || message === `bad-request: ${COLD_SESSION_UNAVAILABLE}`) {
    return COLD_SESSION_RECOVERY
  }
  return message !== undefined && ACTIONABLE_NATIVE_ENTRY_ERRORS.has(message) ? message : fallback
}

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
      }).catch((reason: unknown) => {
        if (!request.signal.aborted) {
          setError(directorErrorMessage(reason, '暂时无法读取导演状态，请重新检查连接；人工编辑仍可用。'))
        }
      })
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
      if (!request.signal.aborted) {
        setError(directorErrorMessage(reason, '暂时无法进入导演，请重新检查连接后重试。'))
      }
    } finally {
      if (operation.current === request) { operation.current = undefined; setBusy(false) }
    }
  }
  if (compact) return <section className={css.session} aria-label="青木原生导演会话">
    {(!connection || busy || status?.status !== 'mounted') && <>
      <p role="status">{!connection ? '导演暂时离线。' : busy ? '正在进入导演…'
        : sessionId ? '可以进入或恢复导演，再提出修改要求。' : '进入导演后，可以在这里提出创作要求。'}</p>
      <button type="button" disabled={!connection || busy} onClick={() => { void activate() }}>进入 / 恢复青木导演</button>
    </>}
    {error && <p role="alert">{error}</p>}
    <details className={css.diagnostics}><summary>连接详情</summary>
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
                : error ? '导演状态尚未确认；请查看恢复提示。'
                  : busy ? '正在进入青木导演…' : '正在核对当前会话的工具…'}</p>
    <button type="button" disabled={!connection || busy} onClick={() => { void activate() }}>进入 / 恢复青木导演</button>
    <button type="button" disabled={!connection || busy} onClick={refresh}>重新检查连接</button>
    {error && <p role="alert">{error}</p>}
    <p>空会话可切换；已有普通对话保持不变，使用当前工作目录的空白会话。工具挂载不代表模型服务、画面质量或保存已验证。</p>
    {!!status?.missingTools.length && <details><summary>缺少的工具</summary><p>{status.missingTools.join('、')}</p></details>}
  </section>
}
