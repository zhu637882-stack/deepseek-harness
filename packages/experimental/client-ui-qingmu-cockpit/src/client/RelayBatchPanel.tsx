/** Operator panel for the durable director relay batch: observe, pause, recover and close; no paid actions. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirectorContextClientPort, RelayState } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import styles from './RelayBatchPanel.module.css'

const modeLabels: Record<RelayState['mode'], string> = {
  running: '运行中', paused: '已暂停，等待导演准入', completed: '已完成', closed: '已关闭',
}
const phaseLabels: Record<RelayState['items'][number]['phase'], string> = {
  pending: '待准入', preparing: '准备中', prepared: '已准备', submitting: '提交中', queued: '排队中',
  running: '生成中', succeeded: '已返回', failed: '失败', unknown: '状态未知', collected: '已收录',
  blocked: '受阻', abandoned: '已放弃',
}

/** Relay batch status and lifecycle controls bound to the project director session.
 * Starting a batch and admitting directors stay with the paid-authorization window and the Host;
 * this panel never creates payment obligations.
 * @param sessionId Project director session that owns the relay ledger.
 * @param directorBridge Browser facade; the panel renders nothing when relay endpoints are unavailable.
 * @returns The relay panel, or null when the facade lacks relay support.
 */
export function RelayBatchPanel({ sessionId, directorBridge }: {
  readonly sessionId: string
  readonly directorBridge: DirectorContextClientPort
}) {
  const readRelay = directorBridge.readRelayBatch
  const advanceRelay = directorBridge.advanceRelayBatch
  const completeRelay = directorBridge.completeRelayBatch
  const closeRelay = directorBridge.closeRelayBatch
  const recoverRelay = directorBridge.recoverRelayBatch
  const available = Boolean(readRelay && advanceRelay && completeRelay && closeRelay && recoverRelay)
  const [state, setState] = useState<RelayState | null>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const refresh = useCallback(async () => {
    if (!readRelay) return
    try {
      const next = await readRelay(sessionId)
      if (active.current) { setState(next); setError('') }
    } catch (cause) { if (active.current) setError(String(cause)) }
  }, [readRelay, sessionId])
  useEffect(() => {
    setState(undefined)
    setReason('')
    void refresh()
  }, [refresh])
  if (!available) return null
  const open = state !== null && state !== undefined && (state.mode === 'running' || state.mode === 'paused')
  const pausable = state !== null && state !== undefined && state.mode === 'running'
    && state.items.every(item => item.admissions.length === 0)
  const run = (action: () => Promise<{ readonly state: RelayState }>) => {
    setBusy(true); setError(''); setNotice('')
    void action().then((result) => {
      if (active.current) setState(result.state)
    }).catch((cause: unknown) => {
      if (active.current) setError(String(cause))
    }).finally(() => {
      if (active.current) setBusy(false)
    })
  }
  const recover = () => {
    if (!recoverRelay) return
    setBusy(true); setError(''); setNotice('')
    void recoverRelay(sessionId).then((result) => {
      if (!active.current) return
      setState(result.state)
      setNotice(result.recovered ? '已恢复本批次的 Host 租约。' : '当前没有需要恢复的接力批次。')
    }).catch((cause: unknown) => {
      if (active.current) setError(String(cause))
    }).finally(() => {
      if (active.current) setBusy(false)
    })
  }
  return <details aria-label="导演接力批次" className={styles.relay} open={open}>
    <summary>导演接力批次</summary>
    <p>接力批次在付费授权窗口内由 Host 连续准备多镜；此处查看进度、暂停等待或关闭批次，不产生新的付费。</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {state === undefined && <p role="status">正在读取接力状态…</p>}
    {state === null && <p>当前没有接力批次。</p>}
    {state && <>
      <p className={styles.items}>
        批次 {state.start.batchId} · {modeLabels[state.mode]}
        {state.reason ? ` · ${state.reason}` : ''}
        <br />授权上限 ¥{state.start.authorization.maxCostCny} · 候选 {state.start.authorization.maxCandidates} 条 ·
        到期 {new Date(state.start.authorization.expiresAt).toLocaleString('zh-CN', { hour12: false })}
      </p>
      <ul className={styles.items} aria-label="接力逐镜状态">
        {state.items.map((item, index) => <li key={item.scope.shotId}>
          <strong>{index + 1}. {item.label}</strong>
          <span>{phaseLabels[item.phase]}</span>
          {item.admissions.length > 0 && <span>准入 {item.admissions.length} 次</span>}
          {item.reason && <span>{item.reason}</span>}
        </li>)}
      </ul>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => { void refresh() }}>刷新状态</button>
        <button type="button" disabled={busy || !pausable}
          onClick={() => { if (advanceRelay) run(() => advanceRelay(sessionId)) }}>暂停等待准入</button>
        <button type="button" disabled={busy || !open} onClick={recover}>恢复 Host 租约</button>
        <button type="button" disabled={busy || !open}
          onClick={() => { if (completeRelay) run(() => completeRelay(sessionId)) }}>完成批次</button>
        <input aria-label="关闭原因" placeholder="关闭原因" value={reason} disabled={busy || !open}
          onChange={(event) => { setReason(event.target.value) }} />
        <button type="button" disabled={busy || !open || reason.trim().length === 0}
          onClick={() => { if (closeRelay) run(() => closeRelay(sessionId, reason.trim())) }}>关闭批次</button>
      </div>
    </>}
  </details>
}
