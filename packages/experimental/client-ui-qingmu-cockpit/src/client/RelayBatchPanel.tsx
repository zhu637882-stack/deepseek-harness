/** Operator panel for the durable director relay batch: create with explicit authorization, observe, pause, recover and close. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirectorContextClientPort, RelayStart, RelayState } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import styles from './RelayBatchPanel.module.css'

const modeLabels: Record<RelayState['mode'], string> = {
  running: '运行中', paused: '已暂停，等待导演准入', completed: '已完成', closed: '已关闭',
}
const phaseLabels: Record<RelayState['items'][number]['phase'], string> = {
  pending: '待准入', preparing: '准备中', prepared: '已准备', submitting: '提交中', queued: '排队中',
  running: '生成中', succeeded: '已返回', failed: '失败', unknown: '状态未知', collected: '已收录',
  blocked: '受阻', abandoned: '已放弃',
}
const ratios = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
const costPattern = /^\d+(?:\.\d{1,6})?$/u

function defaultExpiry(): string {
  const value = new Date(Date.now() + 2 * 3_600_000)
  value.setSeconds(0, 0)
  const pad = (unit: number) => String(unit).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

/** Relay batch creation, status and lifecycle controls bound to the project director session.
 * Creation records the shot selection and the explicit payment authorization in the durable ledger;
 * it never dispatches generation — the Host prepares and submits each shot inside that authorization.
 * @param sessionId Project director session that owns the relay ledger.
 * @param directorBridge Browser facade; the panel renders nothing when relay endpoints are unavailable.
 * @param relations Current episode shot relations; required for the creation form.
 * @param aspectRatio Project aspect ratio used for each shot's generation parameters.
 * @returns The relay panel, or null when the facade lacks relay support.
 */
export function RelayBatchPanel({ sessionId, directorBridge, relations, aspectRatio = '16:9' }: {
  readonly sessionId: string
  readonly directorBridge: DirectorContextClientPort
  readonly relations?: YimengShotRelationsProjection | undefined
  readonly aspectRatio?: string
}) {
  const readRelay = directorBridge.readRelayBatch
  const startRelay = directorBridge.startRelayBatch
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

  const eligible = relations?.shots.filter(shot => Number.isInteger(shot.durationSec)
    && shot.durationSec >= 2 && shot.durationSec <= 30) ?? []
  const shotsKey = eligible.map(shot => shot.shotId).join(',')
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({
    key: shotsKey, ids: new Set(eligible.map(shot => shot.shotId)),
  }))
  const selected = selection.key === shotsKey ? selection.ids : new Set(eligible.map(shot => shot.shotId))
  const toggleShot = (shotId: string, checked: boolean) => {
    setSelection((previous) => {
      const base = previous.key === shotsKey ? previous.ids : new Set(eligible.map(shot => shot.shotId))
      const next = new Set(base)
      if (checked) next.add(shotId)
      else next.delete(shotId)
      return { key: shotsKey, ids: next }
    })
  }
  const [instruction, setInstruction] = useState('')
  const [directorProvider, setDirectorProvider] = useState('deepseek-official')
  const [directorModel, setDirectorModel] = useState('deepseek-v4-pro')
  const [observerOn, setObserverOn] = useState(true)
  const [observerProvider, setObserverProvider] = useState('qingmu-vision')
  const [observerModel, setObserverModel] = useState('qwen3.8-flash')
  const [maxCost, setMaxCost] = useState('1.000000')
  const [expiry, setExpiry] = useState(defaultExpiry)
  const [confirmed, setConfirmed] = useState(false)

  if (!available) return null
  const open = state === undefined || state === null || state.mode === 'running' || state.mode === 'paused'
  const pausable = state !== null && state !== undefined && state.mode === 'running'
    && state.items.every(item => item.admissions.length === 0)
  const chosen = eligible.filter(shot => selected.has(shot.shotId))
  const costValid = costPattern.test(maxCost.trim()) && /[1-9]/u.test(maxCost.trim())
  const expiryTime = new Date(expiry).getTime()
  const expiryValid = Number.isFinite(expiryTime) && expiryTime > Date.now()
  const canCreate = Boolean(startRelay) && !busy && chosen.length > 0 && instruction.trim().length > 0
    && directorProvider.trim().length > 0 && directorModel.trim().length > 0
    && (!observerOn || observerProvider.trim().length > 0 && observerModel.trim().length > 0)
    && costValid && expiryValid && confirmed
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
  const create = () => {
    if (!startRelay || !relations) return
    const ratio = ratios.find(value => value === aspectRatio) ?? 'adaptive'
    const input: RelayStart = {
      batchId: `batch_${crypto.randomUUID()}`,
      projectId: relations.projectId,
      episodeId: relations.episodeId,
      instruction: instruction.trim(),
      director: { provider: directorProvider.trim(), model: directorModel.trim() },
      ...observerOn ? { observer: { provider: observerProvider.trim(), model: observerModel.trim() } } : {},
      shots: chosen.map(shot => ({
        scope: { projectId: relations.projectId, episodeId: relations.episodeId, sceneId: shot.sceneId, shotId: shot.shotId },
        label: `镜${shot.frameNo} · ${shot.title ?? ''}`,
        parameters: { duration: shot.durationSec, resolution: '720P' as const, ratio, audio: true, prompt_extend: false },
        retake: false,
      })),
      authorization: {
        authorizationId: `auth_${crypto.randomUUID()}`,
        paidConfirmed: true,
        maxCostCny: maxCost.trim(),
        maxCandidates: chosen.length,
        expiresAt: new Date(expiry).toISOString(),
      },
    }
    run(() => startRelay(sessionId, input))
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
    <p>创建批次只记录镜头范围与付费授权上限，不提交生成；Host 导演在授权内逐镜准备并提交，本页可查看进度、暂停等待或关闭批次。</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {state === undefined && <p role="status">正在读取接力状态…</p>}
    {state === null && <p>当前没有接力批次。</p>}
    {state === null && relations && startRelay && <div className={styles.create}>
      <fieldset>
        <legend>镜头范围（候选数自动等于所选镜头数）</legend>
        {relations.shots.map((shot) => {
          const usable = eligible.some(row => row.shotId === shot.shotId)
          return <label key={shot.shotId}>
            <input type="checkbox" disabled={busy || !usable} checked={usable && selected.has(shot.shotId)}
              onChange={(event) => { toggleShot(shot.shotId, event.target.checked) }} />
            镜{shot.frameNo} · {shot.title ?? '未命名'}（{shot.durationSec} 秒{usable ? '' : '，时长需在 2–30 秒'})
          </label>
        })}
      </fieldset>
      <label>本批指令<textarea value={instruction} disabled={busy} rows={3}
        placeholder="例如：按当前导演设计准备所选镜头的引用与生成稿"
        onChange={(event) => { setInstruction(event.target.value) }} /></label>
      <fieldset>
        <legend>导演模型</legend>
        <label>供应商<input value={directorProvider} disabled={busy} aria-label="导演供应商"
          onChange={(event) => { setDirectorProvider(event.target.value) }} /></label>
        <label>模型<input value={directorModel} disabled={busy} aria-label="导演模型"
          onChange={(event) => { setDirectorModel(event.target.value) }} /></label>
      </fieldset>
      <fieldset>
        <legend>视觉观察员</legend>
        <label><input type="checkbox" checked={observerOn} disabled={busy}
          onChange={(event) => { setObserverOn(event.target.checked) }} /> 允许导演在准备中查看参考图</label>
        {observerOn && <>
          <label>供应商<input value={observerProvider} disabled={busy} aria-label="观察员供应商"
            onChange={(event) => { setObserverProvider(event.target.value) }} /></label>
          <label>模型<input value={observerModel} disabled={busy} aria-label="观察员模型"
            onChange={(event) => { setObserverModel(event.target.value) }} /></label>
        </>}
      </fieldset>
      <fieldset>
        <legend>付费授权</legend>
        <label>费用上限（元）<input value={maxCost} disabled={busy} aria-label="费用上限" inputMode="decimal"
          onChange={(event) => { setMaxCost(event.target.value) }} /></label>
        {!costValid && <p role="alert">费用上限需为大于 0 的金额，最多 6 位小数。</p>}
        <label>授权到期<input type="datetime-local" value={expiry} disabled={busy} aria-label="授权到期"
          onChange={(event) => { setExpiry(event.target.value) }} /></label>
        {!expiryValid && <p role="alert">授权到期需晚于当前时间。</p>}
        <label><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={(event) => { setConfirmed(event.target.checked) }} />
          我已确认：本批次可按所选参数付费生成，总费用不超过上限，到期后自动失效。</label>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" disabled={!canCreate} onClick={create}>创建接力批次</button>
      </div>
    </div>}
    {state === null && !relations && <p>打开剧集后可创建接力批次。</p>}
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
