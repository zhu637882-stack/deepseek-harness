/* oxlint-disable typescript/no-unnecessary-condition -- AbortSignal changes while awaited reads settle. */
import { useEffect, useRef, useState } from 'react'
import type {
  LocalVideoSourcePacket,
  LocalVideoSourceReceipt,
  LocalVideoSourceResult,
  LocalVideoSourceScope,
  LocalVideoSourceState,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './LocalVideoSourcePanel.module.css'

const MAX_PACKET_BYTES = 1100 * 1024
const MAX_RECORD_BYTES = 256 * 1024
const sha256 = /^[a-f0-9]{64}$/u

interface LocalVideoSourcePort {
  readLocalVideoSource(scope: LocalVideoSourceScope, signal?: AbortSignal): Promise<LocalVideoSourceState>
  registerLocalVideoSource(request: LocalVideoSourceScope & {
    readonly idempotencyKey: string
    readonly binding: LocalVideoSourceState['binding']
    readonly packet: LocalVideoSourcePacket
  }, signal?: AbortSignal): Promise<LocalVideoSourceResult>
  recoverLocalVideoSource(request: LocalVideoSourceScope & {
    readonly idempotencyKey: string
    readonly requestSha256: string
  }, signal?: AbortSignal): Promise<LocalVideoSourceResult>
}

interface RecoveryMarker extends LocalVideoSourceScope {
  readonly idempotencyKey: string
  readonly requestSha256: string
}

function scopeKey(scope: LocalVideoSourceScope): string {
  return `${scope.projectId}:${scope.episodeId}:${scope.frameId}:${scope.assetId}`
}

function recoveryKey(scope: LocalVideoSourceScope): string {
  return `qingmu.local-video-source-recovery.v1:${scopeKey(scope)}`
}

function isMarker(scope: LocalVideoSourceScope, value: unknown): value is RecoveryMarker {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = value as Record<string, unknown>
  return marker.projectId === scope.projectId && marker.episodeId === scope.episodeId
    && marker.frameId === scope.frameId && marker.assetId === scope.assetId
    && typeof marker.idempotencyKey === 'string' && /^local-video-source-[A-Za-z0-9._:-]{8,128}$/u.test(marker.idempotencyKey)
    && typeof marker.requestSha256 === 'string' && sha256.test(marker.requestSha256)
}

function readMarker(scope: LocalVideoSourceScope): RecoveryMarker | undefined {
  try {
    const saved = sessionStorage.getItem(recoveryKey(scope))
    if (saved === null) return undefined
    const marker: unknown = JSON.parse(saved)
    return isMarker(scope, marker) ? marker : undefined
  } catch { return undefined }
}

function writeMarker(scope: LocalVideoSourceScope, marker: RecoveryMarker): boolean {
  if (!isMarker(scope, marker)) return false
  try {
    const raw = sessionStorage.getItem(recoveryKey(scope))
    const previous = readMarker(scope)
    if (raw !== null && previous === undefined) return false
    if (previous !== undefined && (previous.idempotencyKey !== marker.idempotencyKey
      || previous.requestSha256 !== marker.requestSha256)) return false
    sessionStorage.setItem(recoveryKey(scope), JSON.stringify(marker))
    const saved = readMarker(scope)
    return saved?.idempotencyKey === marker.idempotencyKey && saved.requestSha256 === marker.requestSha256
  } catch { return false }
}

function clearMarker(scope: LocalVideoSourceScope, marker: RecoveryMarker): boolean {
  try {
    const saved = readMarker(scope)
    if (saved?.idempotencyKey !== marker.idempotencyKey || saved.requestSha256 !== marker.requestSha256) return false
    sessionStorage.removeItem(recoveryKey(scope))
  } catch { return false }
  return readMarker(scope) === undefined
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function decodedBytes(value: string): Uint8Array | undefined {
  try {
    const decoded = atob(value)
    if (btoa(decoded) !== value) return undefined
    return Uint8Array.from(decoded, byte => byte.charCodeAt(0))
  } catch { return undefined }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

async function packetFromJson(value: unknown): Promise<LocalVideoSourcePacket | undefined> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const packet = value as Record<string, unknown>
  if (!exactKeys(packet, ['schema', 'recordFormat', 'inputRecord', 'resultRecord', 'mediaRecord'])
    || packet.schema !== 'jason.qingmu-external-video-records.v1'
    || (packet.recordFormat !== 'alibaba_saved' && packet.recordFormat !== 'libtv_saved')) return undefined
  for (const key of ['inputRecord', 'resultRecord', 'mediaRecord']) {
    const record = packet[key]
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined
    const fields = record as Record<string, unknown>
    if (!exactKeys(fields, ['sha256', 'contentBase64']) || typeof fields.sha256 !== 'string' || !sha256.test(fields.sha256)
      || typeof fields.contentBase64 !== 'string') return undefined
    const bytes = decodedBytes(fields.contentBase64)
    if (bytes === undefined || bytes.byteLength < 1 || bytes.byteLength > MAX_RECORD_BYTES
      || await digestBytes(bytes) !== fields.sha256) return undefined
  }
  return packet as unknown as LocalVideoSourcePacket
}

async function digestBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const hash = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function makeIdempotencyKey(): string {
  return `local-video-source-${crypto.randomUUID().replaceAll('-', '')}`
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isRejected(cause: unknown): boolean {
  return /(?:^|\D)422(?:\D|$)/u.test(messageOf(cause))
}

function ReceiptSummary({ receipt, bindingStatus }: { readonly receipt: LocalVideoSourceReceipt; readonly bindingStatus: 'current' | 'stale' }) {
  return <div className={css.receipt} role="status">
    <strong>{bindingStatus === 'current' ? '来源记录已保存' : '来源记录已过期'}</strong>
    <span>平台：{receipt.provider === 'libtv' ? 'LibTV' : '阿里'} · 模型：{receipt.model}</span>
    <span>任务号：{receipt.providerTaskId}</span>
    <p>来源记录已保存 · 未向平台核验。{bindingStatus === 'current'
      ? '登记绑定当前镜头版本；采用还需完成检查。' : '当前镜头已变更，采用还需重新检查。'}</p>
  </div>
}

/** Registers saved external evidence for the currently browsed local candidate only. */
export function LocalVideoSourcePanel({ scope, port }: { readonly scope: LocalVideoSourceScope; readonly port: LocalVideoSourcePort }) {
  const key = scopeKey(scope)
  const [state, setState] = useState<LocalVideoSourceState>()
  const [receipt, setReceipt] = useState<{ readonly value: LocalVideoSourceReceipt; readonly bindingStatus: 'current' | 'stale' }>()
  const [packet, setPacket] = useState<LocalVideoSourcePacket>()
  const [marker, setMarker] = useState<RecoveryMarker>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const fileReadGeneration = useRef(0)
  const requestAbort = useRef<AbortController>()

  useEffect(() => {
    const current = ++generation.current
    fileReadGeneration.current++
    requestAbort.current?.abort()
    const controller = new AbortController()
    requestAbort.current = controller
    const saved = readMarker(scope)
    setState(undefined); setReceipt(undefined); setPacket(undefined); setMarker(saved)
    setNotice(''); setError(''); setLoading(true); setBusy(false)
    void (async () => {
      try {
        const source = await port.readLocalVideoSource(scope, controller.signal)
        if (current !== generation.current || controller.signal.aborted) return
        setState(source)
        if (saved === undefined) return
        const recovered = await port.recoverLocalVideoSource(saved, controller.signal)
        if (current !== generation.current || controller.signal.aborted) return
        setReceipt({ value: recovered.receipt, bindingStatus: recovered.bindingStatus })
        if (clearMarker(scope, saved)) {
          setMarker(undefined)
          setNotice('已读取先前登记回执；未再次提交记录包。')
        } else setNotice('已读取登记回执；本地恢复标记尚未清理，可稍后重试。')
      } catch (cause) {
        if (current !== generation.current || controller.signal.aborted) return
        setError(saved === undefined ? `无法读取来源状态：${messageOf(cause)}` : '登记结果待恢复；不会自动再次提交。')
      } finally {
        if (current === generation.current && !controller.signal.aborted) setLoading(false)
      }
    })()
    return () => {
      fileReadGeneration.current++
      generation.current++
      requestAbort.current?.abort()
    }
  }, [key, port, refresh])

  const recover = async () => {
    const saved = marker
    if (saved === undefined || busy) return
    const current = generation.current
    const controller = new AbortController()
    requestAbort.current?.abort(); requestAbort.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await port.recoverLocalVideoSource(saved, controller.signal)
      if (current !== generation.current || controller.signal.aborted) return
      setReceipt({ value: result.receipt, bindingStatus: result.bindingStatus })
      if (clearMarker(scope, saved)) {
        setMarker(undefined)
        setNotice('已读取登记回执；未再次提交记录包。')
      } else setNotice('已读取登记回执；本地恢复标记尚未清理，可稍后重试。')
    } catch (cause) {
      if (current === generation.current && !controller.signal.aborted) setError(`暂未读取到登记回执：${messageOf(cause)}`)
    } finally {
      if (current === generation.current && !controller.signal.aborted) setBusy(false)
    }
  }

  const selectFile = async (file: File | undefined) => {
    const currentFileRead = ++fileReadGeneration.current
    const current = generation.current
    setPacket(undefined)
    setError(''); setNotice('')
    if (file === undefined) return
    if (file.size < 1 || file.size > MAX_PACKET_BYTES || !/\.json$/iu.test(file.name)) {
      setError('请选择一个不超过 1100 KiB 的 JSON 记录包。')
      return
    }
    try {
      const parsed = await packetFromJson(JSON.parse(await file.text()))
      if (current !== generation.current || currentFileRead !== fileReadGeneration.current) return
      if (parsed === undefined) {
        setError('记录包需要包含三份有效的 base64 JSON 记录，每份不超过 256 KiB。')
        return
      }
      setPacket(parsed)
      setNotice('记录包已载入。点击登记才会提交；不会采用这条视频。')
    } catch {
      if (current === generation.current && currentFileRead === fileReadGeneration.current) setError('无法读取该 JSON 记录包。')
    }
  }

  const register = async () => {
    if (busy || state === undefined || packet === undefined || marker !== undefined) return
    const current = generation.current
    const controller = new AbortController()
    requestAbort.current?.abort(); requestAbort.current = controller
    setBusy(true); setError(''); setNotice('')
    let saved: RecoveryMarker | undefined
    try {
      const requestSha256 = await digest({ binding: state.binding, packet })
      if (current !== generation.current || controller.signal.aborted) return
      saved = { ...scope, idempotencyKey: makeIdempotencyKey(), requestSha256 }
      if (!writeMarker(scope, saved)) {
        const existing = readMarker(scope)
        setMarker(existing)
        setError(existing === undefined ? '浏览器无法保存恢复标记，因此不会提交记录包。' : '本候选已有待恢复登记，先读取回执后再继续。')
        return
      }
      setMarker(saved)
      const result = await port.registerLocalVideoSource({
        ...scope, idempotencyKey: saved.idempotencyKey, binding: state.binding, packet,
      }, controller.signal)
      if (current !== generation.current || controller.signal.aborted) return
      setReceipt({ value: result.receipt, bindingStatus: result.bindingStatus })
      setPacket(undefined)
      if (clearMarker(scope, saved)) {
        setMarker(undefined)
        setNotice('来源记录已保存；未采用、未通过检查，也没有向平台发起核验。')
      } else setNotice('来源记录已保存；本地恢复标记尚未清理，可稍后重试。')
    } catch (cause) {
      if (current !== generation.current || controller.signal.aborted) return
      if (saved !== undefined && isRejected(cause) && clearMarker(scope, saved)) {
        setMarker(undefined); setPacket(undefined)
        setError('记录包未通过登记校验。请更正后明确重新登记；系统不会自动重传。')
      } else setError(`登记结果待恢复；不会自动再次提交。${messageOf(cause)}`)
    } finally {
      if (current === generation.current && !controller.signal.aborted) setBusy(false)
    }
  }

  const displayed = receipt ?? (state === undefined || state.latestRegistration === null ? undefined
    : { value: state.latestRegistration, bindingStatus: state.bindingStatus === 'stale' ? 'stale' as const : 'current' as const })
  const canRegisterAgain = state?.canRegister === true && marker === undefined
  const retryCleanup = () => {
    if (marker === undefined) return
    if (clearMarker(scope, marker)) {
      setMarker(undefined)
      setNotice('本地恢复标记已清理。')
    } else setError('浏览器仍无法清理本地恢复标记；请保留并稍后读取回执。')
  }
  return <section className={css.panel} aria-label="本地视频来源记录">
    <header><div><h3>来源记录</h3><p>仅登记当前浏览的本地视频</p></div><button type="button" disabled={loading || busy} onClick={() => { setRefresh(value => value + 1) }}>刷新</button></header>
    {loading && <p className={css.muted}>正在读取来源状态…</p>}
    {displayed !== undefined && <ReceiptSummary receipt={displayed.value} bindingStatus={displayed.bindingStatus} />}
    {!loading && canRegisterAgain && (displayed === undefined || displayed.bindingStatus === 'stale') && <label className={css.picker}>选择 JSON 记录包
      <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
        void selectFile(event.target.files?.[0]); event.target.value = ''
      }} />
    </label>}
    {packet !== undefined && marker === undefined && (displayed === undefined || displayed.bindingStatus === 'stale') && <div className={css.pending}><span>三份记录已载入，尚未提交。</span><button type="button" disabled={busy || !canRegisterAgain} onClick={() => { void register() }}>登记来源记录</button></div>}
    {marker !== undefined && displayed === undefined && <div className={css.pending}><span>本候选登记回执待读取，不会换用新的登记键。</span><button type="button" disabled={busy} onClick={() => { void recover() }}>{busy ? '正在读取…' : '读取登记回执'}</button></div>}
    {marker !== undefined && displayed !== undefined && <div className={css.pending}><span>回执已读，本地恢复标记尚待清理。</span><button type="button" disabled={busy} onClick={retryCleanup}>清理本地恢复标记</button></div>}
    {state?.bindingStatus === 'stale' && displayed === undefined && <p className={css.muted}>已有记录对应旧镜头版本，当前来源需重新登记。</p>}
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {error && <p className={css.error} role="alert">{error}</p>}
  </section>
}
