/* oxlint-disable typescript/no-unnecessary-condition -- receipts are untrusted runtime DTOs. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- exact false/zero fields are authority boundaries. */
import { useEffect, useRef, useState } from 'react'
import type {
  LocalVideoCandidateResult,
  LocalVideoRecoveryRequest,
  LocalVideoUploadRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import {
  clearLocalVideoRecovery,
  readLocalVideoRecoveryState,
  writeLocalVideoRecovery,
  type LocalVideoRecoveryMarker,
  type LocalVideoScope,
} from './LocalVideoRecoveryStore.ts'
import css from './LocalVideoCandidateUpload.module.css'

const MAX_BYTES = 32 * 1024 * 1024
const MIN_SECONDS = 1
const MAX_SECONDS = 30
const sha256 = /^[a-f0-9]{64}$/u

interface LocalVideoPort {
  uploadLocalVideoCandidate(request: LocalVideoUploadRequest, signal?: AbortSignal): Promise<LocalVideoCandidateResult>
  recoverLocalVideoCandidate(request: LocalVideoRecoveryRequest, signal?: AbortSignal): Promise<LocalVideoCandidateResult>
}

interface PendingInput {
  readonly file: File
  readonly contentSha256: string
  readonly marker: LocalVideoRecoveryMarker
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function makeIdempotencyKey(): string {
  return `local-video-${crypto.randomUUID().replaceAll('-', '')}`
}

function canonicalJson(value: Record<string, string>): string {
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(value)
}

function receiptMatches(scope: LocalVideoScope, marker: LocalVideoRecoveryMarker, result: LocalVideoCandidateResult,
  inputSha256?: string): boolean {
  return result.schema === 'jason.qingmu-local-video-candidate.v1'
    && result.projectId === scope.projectId
    && result.episodeId === scope.episodeId
    && result.frameId === scope.frameId
    && result.idempotencyKey === marker.idempotencyKey
    && result.requestSha256 === marker.requestSha256
    && result.originalFileName === marker.originalFileName
    && result.byteSize === marker.byteSize
    && result.mimeType === 'video/mp4'
    && (inputSha256 === undefined || result.inputSha256 === inputSha256)
    && sha256.test(result.inputSha256)
    && sha256.test(result.materializedSha256)
    && result.materializedSha256 === result.inputSha256
    && typeof result.assetId === 'string' && result.assetId.length > 0
    && result.takeId === result.assetId
    && Number.isFinite(result.durationSec) && result.durationSec >= MIN_SECONDS && result.durationSec <= MAX_SECONDS
    && Number.isInteger(result.width) && result.width > 0
    && Number.isInteger(result.height) && result.height > 0
    && typeof result.hasAudio === 'boolean'
    && result.sourceDeclaration === 'local_file_unverified'
    && result.rightsStatus === 'not_recorded'
    && result.selectionStatus === 'Unselected'
    && result.isSelected === false
    && result.providerCalls === 0
    && result.generationQueued === false
}

function isNotFound(cause: unknown): boolean {
  return /(?:^|\D)404(?:\D|$)|not[_ -]?found/iu.test(messageOf(cause))
}

/** Uploads one user-chosen local MP4 as an unadopted Take candidate. */
export function LocalVideoCandidateUpload({ projectId, episodeId, frameId, port, onStored }: {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly port: LocalVideoPort
  /** Refreshes the current Take rail only after the server has confirmed the exact receipt. */
  readonly onStored: (receipt: LocalVideoCandidateResult) => Promise<void>
}) {
  const scope = { projectId, episodeId, frameId }
  const scopeKey = `${projectId}:${episodeId}:${frameId}`
  const [marker, setMarker] = useState<LocalVideoRecoveryMarker>()
  const [pending, setPending] = useState<PendingInput>()
  const [receipt, setReceipt] = useState<LocalVideoCandidateResult>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [cleanupPending, setCleanupPending] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [storageProblem, setStorageProblem] = useState<'corrupt' | 'unavailable'>()
  const scopeGeneration = useRef(0)
  const lock = useRef(false)
  const requestAbort = useRef<AbortController>()

  useEffect(() => {
    const generation = ++scopeGeneration.current
    lock.current = false
    requestAbort.current?.abort()
    requestAbort.current = undefined
    setBusy(false)
    setPending(undefined)
    setReceipt(undefined)
    setError('')
    setNotice('')
    setCleanupPending(false)
    setRejected(false)
    const saved = readLocalVideoRecoveryState(scope)
    setMarker(saved.marker)
    setStorageProblem(saved.status === 'ready' ? undefined : saved.status)
    if (saved.status === 'corrupt') setError('本镜本地恢复记录损坏。为避免覆盖未知导入，暂不能提交新视频。')
    if (saved.status === 'unavailable') setError('浏览器无法读取本地恢复记录。为避免丢失未知导入，暂不能提交新视频。')
    return () => {
      if (generation === scopeGeneration.current) requestAbort.current?.abort()
      scopeGeneration.current++
    }
  }, [scopeKey])

  const current = (generation: number) => generation === scopeGeneration.current
  const start = (): { generation: number; controller: AbortController } | undefined => {
    if (lock.current) return undefined
    lock.current = true
    setBusy(true)
    const controller = new AbortController()
    requestAbort.current?.abort()
    requestAbort.current = controller
    return { generation: scopeGeneration.current, controller }
  }
  const end = (generation: number, controller: AbortController) => {
    if (current(generation) && requestAbort.current === controller) {
      requestAbort.current = undefined
      lock.current = false
      setBusy(false)
    }
  }
  const finish = async (value: LocalVideoCandidateResult, saved: LocalVideoRecoveryMarker,
    generation: number, inputSha256?: string) => {
    if (!current(generation) || !receiptMatches(scope, saved, value, inputSha256)) {
      if (current(generation)) setError('导入回执与本镜文件不一致，未显示为候选。')
      return
    }
    setReceipt(value)
    setPending(undefined)
    setMarker(saved)
    setNotice('视频已加入本镜候选条：本地导入，来源待核实，尚未采用。')
    const cleared = clearLocalVideoRecovery(scope, saved)
    if (!cleared) setCleanupPending(true)
    else setMarker(undefined)
    try {
      await onStored(value)
    } catch (cause) {
      if (current(generation)) setError(`视频已导入，但候选列表刷新失败：${messageOf(cause)}`)
    }
  }

  const choose = async (file: File) => {
    const action = start()
    if (action === undefined) return
    try {
      setError('')
      setNotice('')
      setRejected(false)
      if (storageProblem !== undefined) {
        setError('本镜本地恢复记录不可用，暂不能提交新视频。')
        return
      }
      if (marker !== undefined) {
        setError('上一份视频的导入回执尚待确认，请先读取该回执。')
        return
      }
      if (file.size < 1 || file.size > MAX_BYTES || !/\.mp4$/iu.test(file.name)) {
        setError('请选择 1–30 秒、最多 32 MiB 的 MP4 视频。')
        return
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!current(action.generation)) return
      const contentSha256 = await digest(bytes)
      if (!current(action.generation) || action.controller.signal.aborted) return
      const requestSha256 = await digest(new TextEncoder().encode(canonicalJson({
        episodeId,
        frameId,
        originalFileName: file.name,
        contentSha256,
        sourceDeclaration: 'local_file_unverified',
      })))
      if (!current(action.generation) || action.controller.signal.aborted) return
      const next = {
        projectId, episodeId, frameId, idempotencyKey: makeIdempotencyKey(), requestSha256,
        originalFileName: file.name, byteSize: file.size,
      }
      setPending({ file, contentSha256, marker: next })
      setNotice('文件已读取。确认后才会提交校验并导入为本镜候选。')
    } catch (cause) {
      if (current(action.generation)) setError(`无法读取该视频：${messageOf(cause)}`)
    } finally {
      end(action.generation, action.controller)
    }
  }

  const submit = async () => {
    const action = start()
    if (action === undefined || pending === undefined || marker !== undefined) {
      if (action !== undefined) end(action.generation, action.controller)
      return
    }
    let dispatched = false
    try {
      setError('')
      const bytes = new Uint8Array(await pending.file.arrayBuffer())
      if (!current(action.generation) || action.controller.signal.aborted) return
      const sentSha256 = await digest(bytes)
      if (!current(action.generation) || action.controller.signal.aborted) return
      if (sentSha256 !== pending.contentSha256) {
        clearLocalVideoRecovery(scope, pending.marker)
        setMarker(undefined)
        setError('文件内容在提交前发生变化，请重新选择。')
        return
      }
      const contentBase64 = toBase64(bytes)
      if (!current(action.generation) || action.controller.signal.aborted) return
      const stored = writeLocalVideoRecovery(scope, pending.marker)
      if (stored !== 'written') {
        if (stored === 'conflict') {
          const existing = readLocalVideoRecoveryState(scope)
          if (existing.status === 'ready' && existing.marker !== undefined) {
            setMarker(existing.marker)
            setPending(undefined)
          }
          setError('本镜已有另一笔待恢复导入。请先读取该回执，系统不会覆盖它。')
        } else {
          setStorageProblem(stored)
          setError('浏览器无法安全保存本次导入恢复记录，因此不会提交视频。')
        }
        return
      }
      setMarker(pending.marker)
      setRejected(false)
      dispatched = true
      const result = await port.uploadLocalVideoCandidate({
        projectId, episodeId, frameId,
        idempotencyKey: pending.marker.idempotencyKey,
        originalFileName: pending.marker.originalFileName,
        contentBase64,
        sourceDeclaration: 'local_file_unverified',
      }, action.controller.signal)
      await finish(result, pending.marker, action.generation, pending.contentSha256)
    } catch (cause) {
      if (!current(action.generation) || action.controller.signal.aborted) return
      if (!dispatched) {
        setError(`无法读取该视频：${messageOf(cause)}`)
      } else if (isNotFound(cause)) {
        setNotice('暂未找到本次导入回执，请稍后重新检查；系统不会自动再次提交。')
      } else if (/\b422\b/u.test(messageOf(cause))) {
        if (clearLocalVideoRecovery(scope, pending.marker)) {
          setMarker(undefined)
          setRejected(true)
          setError('该文件未通过导入校验。可更正后明确重新提交；系统不会自动重传。')
        } else {
          setMarker(pending.marker)
          setError('该文件未通过导入校验，但本地恢复记录未清理。请先读取该回执，系统不会覆盖它。')
        }
      } else {
        setNotice('导入结果待恢复；系统不会自动再次提交。')
        setError(messageOf(cause))
      }
    } finally {
      end(action.generation, action.controller)
    }
  }

  const recover = async () => {
    const action = start()
    const saved = marker
    if (action === undefined || saved === undefined) {
      if (action !== undefined) end(action.generation, action.controller)
      return
    }
    try {
      setError('')
      const result = await port.recoverLocalVideoCandidate({
        projectId, episodeId, frameId, idempotencyKey: saved.idempotencyKey, requestSha256: saved.requestSha256,
      }, action.controller.signal)
      await finish(result, saved, action.generation)
    } catch (cause) {
      if (!current(action.generation) || action.controller.signal.aborted) return
      if (isNotFound(cause)) setNotice('暂未找到本次导入回执，请稍后重新检查；系统不会自动再次提交。')
      else setError(`无法读取本次导入回执：${messageOf(cause)}`)
    } finally {
      end(action.generation, action.controller)
    }
  }

  const retryCleanup = () => {
    if (receipt === undefined || marker === undefined) return
    if (clearLocalVideoRecovery(scope, marker)) {
      setMarker(undefined)
      setCleanupPending(false)
    } else setError('浏览器仍无法清理本地恢复记录；视频已导入，不会再次提交。')
  }

  return <section className={css.panel} aria-label="导入本地视频对照">
    <header><h3>导入本地视频对照</h3><p>同一候选轨内比较，不会自动采用</p></header>
    {receipt === undefined && marker === undefined && <label className={css.picker}>选择 MP4（1–30 秒，最多 32 MiB）
      <input type="file" accept="video/mp4,.mp4" disabled={busy || storageProblem !== undefined} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file !== undefined) void choose(file)
        event.target.value = ''
      }} />
    </label>}
    {pending !== undefined && marker === undefined && receipt === undefined && <div className={css.pending}>
      <strong>{pending.marker.originalFileName}</strong><span>{pending.marker.byteSize.toLocaleString()} B</span>
      <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void submit() }}>{rejected ? '明确重新提交此文件' : '导入本镜候选'}</button></div>
    </div>}
    {marker !== undefined && receipt === undefined && <div className={css.pending}>
      <strong>{marker.originalFileName}</strong><span>已发出导入，请先读取本次回执。</span>
      <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void recover() }}>重新检查导入回执</button></div>
    </div>}
    {receipt !== undefined && <article className={css.receipt} aria-label="本地视频导入回执">
      <strong>{receipt.originalFileName}</strong><span>{receipt.durationSec.toFixed(1)} 秒 · {receipt.width} × {receipt.height}{receipt.hasAudio ? ' · 含音频' : ''}</span>
      <p>本地导入，来源待核实，暂不可采用</p>
      {cleanupPending && <div className={css.actions}><button type="button" disabled={busy} onClick={retryCleanup}>重试整理本地记录</button></div>}
    </article>}
    {notice !== '' && <p role="status" className={css.notice}>{notice}</p>}
    {error !== '' && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
