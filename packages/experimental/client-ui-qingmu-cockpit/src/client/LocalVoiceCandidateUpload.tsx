import { useEffect, useRef, useState } from 'react'
import type {
  LocalVoiceCandidateContent,
  LocalVoiceContentRequest,
  LocalVoiceCandidateResult,
  LocalVoiceUploadRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import {
  clearLocalReferenceDraft,
  restoreLocalReferenceDraft,
  saveLocalReferenceDraft,
  type SavedLocalReferenceInput,
} from './LocalReferenceDraftStore.ts'
import css from './LocalReferenceCandidateUpload.module.css'

const MAX_BYTES = 8 * 1024 * 1024
const MIN_DURATION_SECONDS = 1
const MAX_DURATION_SECONDS = 15

interface LocalVoicePort {
  uploadLocalVoiceCandidate(request: LocalVoiceUploadRequest, signal?: AbortSignal): Promise<LocalVoiceCandidateResult>
  recoverLocalVoiceCandidate(request: LocalVoiceUploadRequest, signal?: AbortSignal): Promise<LocalVoiceCandidateResult>
  readLocalVoiceCandidateContent(request: LocalVoiceContentRequest, signal?: AbortSignal): Promise<LocalVoiceCandidateContent>
}

interface WavInfo {
  readonly durationSec: number
  readonly sampleRate: number
  readonly channels: number
}

function keyOf(projectId: string, targetId: string): string {
  return `qingmu.local-voice.v1:${projectId}:actor:${targetId}`
}

function makeIdempotencyKey(): string {
  return `local-voice-${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 40)}`
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function byteLengthOfBase64(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4))
}

/** Validates a PCM WAVE container without decoding or sending the local recording. */
export function inspectPcmWav(bytes: Uint8Array): WavInfo | undefined {
  if (bytes.length < 44 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) + 8 !== bytes.length) return undefined
  let offset = 12
  let format: { sampleRate: number; channels: number; bytesPerSample: number } | undefined
  let dataSize: number | undefined
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset)
    const chunkSize = view.getUint32(offset + 4, true)
    const content = offset + 8
    if (content + chunkSize > bytes.length) return undefined
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      if (format !== undefined) return undefined
      const audioFormat = view.getUint16(content, true)
      const channels = view.getUint16(content + 2, true)
      const sampleRate = view.getUint32(content + 4, true)
      const byteRate = view.getUint32(content + 8, true)
      const blockAlign = view.getUint16(content + 12, true)
      const bitsPerSample = view.getUint16(content + 14, true)
      if (audioFormat !== 1 || channels < 1 || channels > 2 || sampleRate < 8_000 || sampleRate > 96_000
        || ![8, 16, 24, 32].includes(bitsPerSample)) return undefined
      const bytesPerSample = bitsPerSample / 8
      if (blockAlign !== channels * bytesPerSample || byteRate !== sampleRate * blockAlign) return undefined
      format = { sampleRate, channels, bytesPerSample }
    }
    if (chunkId === 'data') {
      if (dataSize !== undefined) return undefined
      dataSize = chunkSize
    }
    offset = content + chunkSize + (chunkSize % 2)
  }
  if (offset !== bytes.length || format === undefined || dataSize === undefined) return undefined
  const durationSec = dataSize / (format.sampleRate * format.channels * format.bytesPerSample)
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SECONDS || durationSec > MAX_DURATION_SECONDS) return undefined
  return { durationSec, sampleRate: format.sampleRate, channels: format.channels }
}

/** Local PCM WAV upload only. It leaves actor adoption, provider configuration and rights unchanged. */
export function LocalVoiceCandidateUpload({ projectId, targetId, targetName, port, retainedReceipt, onReceipt, onStored }: {
  readonly projectId: string
  readonly targetId: string
  readonly targetName: string
  readonly port: LocalVoicePort
  /** The parent keeps this receipt across an asset-library refresh. */
  readonly retainedReceipt: LocalVoiceCandidateResult | undefined
  readonly onReceipt: (receipt: LocalVoiceCandidateResult | undefined) => void
  readonly onStored: () => Promise<void>
}) {
  const storageKey = keyOf(projectId, targetId)
  const scopedRetainedReceipt = retainedReceipt?.projectId === projectId
    && retainedReceipt.targetId === targetId
    ? retainedReceipt
    : undefined
  const [saved, setSaved] = useState<SavedLocalReferenceInput>()
  const [durable, setDurable] = useState(false)
  const [receipt, setReceipt] = useState<LocalVoiceCandidateResult | undefined>(scopedRetainedReceipt)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [persistWarning, setPersistWarning] = useState(false)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string>()
  const lock = useRef(false)
  const scopeGeneration = useRef(0)
  const actionGeneration = useRef(0)
  const current = useRef<SavedLocalReferenceInput>()
  const audioUrlRef = useRef<string>()
  const previewAbort = useRef<AbortController>()

  const currentScope = (token: number): boolean => token === scopeGeneration.current
  const revokeAudio = () => {
    previewAbort.current?.abort()
    previewAbort.current = undefined
    if (audioUrlRef.current !== undefined) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = undefined
    setAudioUrl(undefined)
  }

  useEffect(() => {
    const scopeToken = ++scopeGeneration.current
    let active = true
    current.current = undefined
    lock.current = false
    setRestoring(true)
    setSaved(undefined)
    setDurable(false)
    setReceipt(scopedRetainedReceipt)
    setError('')
    setNotice('')
    setPersistWarning(false)
    setRetryAllowed(false)
    setBusy(false)
    revokeAudio()
    void restoreLocalReferenceDraft(storageKey).then((restored) => {
      if (!active || !currentScope(scopeToken)) return
      current.current = restored.saved
      setSaved(restored.saved)
      setDurable(restored.durable)
      setPersistWarning(restored.saved !== undefined && !restored.durable)
      setNotice(restored.saved?.pending === true ? '上次上传结果未知。请先恢复回执，不会自动重新上传。' : '')
    }).finally(() => {
      if (active && currentScope(scopeToken)) setRestoring(false)
    })
    return () => {
      active = false
      scopeGeneration.current++
      actionGeneration.current++
      revokeAudio()
    }
  }, [storageKey])

  // A parent refresh may remount this component after a confirmed upload. Receipt sync is
  // deliberately separate from the request scope so it cannot cancel an active file read.
  useEffect(() => {
    setReceipt(scopedRetainedReceipt)
  }, [scopedRetainedReceipt])

  useEffect(() => () => { revokeAudio() }, [])

  const start = (): { readonly actionToken: number; readonly scopeToken: number } | undefined => {
    if (lock.current || restoring) return undefined
    lock.current = true
    const actionToken = ++actionGeneration.current
    setBusy(true)
    return { actionToken, scopeToken: scopeGeneration.current }
  }

  const end = (actionToken: number, scopeToken: number) => {
    if (actionToken === actionGeneration.current && currentScope(scopeToken)) {
      lock.current = false
      setBusy(false)
    }
  }

  const save = async (next: SavedLocalReferenceInput, scopeToken: number): Promise<boolean> => {
    current.current = next
    if (currentScope(scopeToken)) setSaved(next)
    const wasDurable = await saveLocalReferenceDraft(storageKey, next)
    if (!currentScope(scopeToken)) return false
    setDurable(wasDurable)
    setPersistWarning(!wasDurable)
    return wasDurable
  }

  const clear = async (scopeToken: number): Promise<boolean> => {
    const cleared = await clearLocalReferenceDraft(storageKey)
    if (!currentScope(scopeToken)) return false
    if (!cleared) {
      setPersistWarning(true)
      return false
    }
    current.current = undefined
    setSaved(undefined)
    setDurable(false)
    setPersistWarning(false)
    return true
  }

  const choose = async (file: File) => {
    const action = start()
    if (action === undefined) return
    try {
      setError('')
      setNotice('')
      setRetryAllowed(false)
      if (file.size < 1 || file.size > MAX_BYTES || !/\.wav$/iu.test(file.name)) {
        setError('请选择不超过 8 MiB 的 WAV 音色文件。')
        return
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (action.actionToken !== actionGeneration.current || !currentScope(action.scopeToken)) return
      const wav = inspectPcmWav(bytes)
      if (wav === undefined) {
        setError('需要 1–15 秒的 PCM WAV 文件。')
        return
      }
      setReceipt(undefined)
      onReceipt(undefined)
      revokeAudio()
      await save({
        request: {
          projectId,
          elementKind: 'actor',
          targetId,
          idempotencyKey: makeIdempotencyKey(),
          originalFileName: file.name,
          contentBase64: toBase64(bytes),
          sourceDeclaration: 'local_file_unverified',
        },
        pending: false,
      }, action.scopeToken)
      setNotice(`已保存本地草稿：${wav.durationSec.toFixed(1)} 秒，${wav.sampleRate} Hz。`)
    } catch (cause) {
      if (currentScope(action.scopeToken)) setError(messageOf(cause))
    } finally {
      end(action.actionToken, action.scopeToken)
    }
  }

  const finish = async (result: LocalVoiceCandidateResult, actionToken: number, scopeToken: number) => {
    if (actionToken !== actionGeneration.current || !currentScope(scopeToken)) return
    if (!await clear(scopeToken)) return
    if (actionToken !== actionGeneration.current || !currentScope(scopeToken)) return
    setReceipt(result)
    onReceipt(result)
    setRetryAllowed(false)
    setNotice('音色文件已保存，可在项目素材中试听和引用。')
    try {
      await onStored()
    } catch (cause) {
      if (actionToken === actionGeneration.current && currentScope(scopeToken)) {
        setError(`音色已保存，但素材库刷新失败：${messageOf(cause)}`)
      }
    }
  }

  const run = async (recover: boolean) => {
    const action = start()
    if (action === undefined) return
    try {
      setError('')
      const intent = current.current
      if (intent === undefined || !durable) {
        setPersistWarning(true)
        return
      }
      if (!recover && !await save({ ...intent, pending: true }, action.scopeToken)) return
      if (action.actionToken !== actionGeneration.current || !currentScope(action.scopeToken)) return
      const request = intent.request as LocalVoiceUploadRequest
      const result = recover
        ? await port.recoverLocalVoiceCandidate(request)
        : await port.uploadLocalVoiceCandidate(request)
      await finish(result, action.actionToken, action.scopeToken)
    } catch (cause) {
      if (action.actionToken === actionGeneration.current && currentScope(action.scopeToken)) {
        const message = messageOf(cause)
        const missingReceipt = recover && /404|local_voice_receipt_not_found/.test(message)
        setRetryAllowed(missingReceipt)
        setError(missingReceipt ? '未找到该次上传回执；如要重试，请明确再次提交。' : message)
        setNotice(current.current?.pending === true || !recover ? '上传结果待恢复；不会自动重新上传。' : '')
      }
    } finally {
      end(action.actionToken, action.scopeToken)
    }
  }

  const audition = async () => {
    const action = start()
    if (action === undefined || receipt === undefined) {
      if (action !== undefined) end(action.actionToken, action.scopeToken)
      return
    }
    try {
      setError('')
      revokeAudio()
      const controller = new AbortController()
      previewAbort.current = controller
      const content = await port.readLocalVoiceCandidateContent({
        projectId,
        elementKind: 'actor',
        targetId,
        assetId: receipt.assetId,
        expectedSha256: receipt.materializedSha256,
      }, controller.signal)
      if (action.actionToken !== actionGeneration.current || !currentScope(action.scopeToken) || controller.signal.aborted) return
      const bytes = fromBase64(content.contentBase64)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: content.mimeType }))
      audioUrlRef.current = url
      setAudioUrl(url)
    } catch (cause) {
      if (currentScope(action.scopeToken)) setError(messageOf(cause))
    } finally {
      end(action.actionToken, action.scopeToken)
    }
  }

  return <section className={css.panel} aria-label="本地音色参考">
    <header><div><span>{targetName}</span><h4>上传本地音色参考</h4></div><p>上传角色的音色样本，可在镜头中引用。</p></header>
    <label className={css.filePicker}>选择 WAV（1–15 秒，最多 8 MiB）
      <input
        type="file"
        accept="audio/wav,audio/x-wav,.wav"
        disabled={busy || restoring}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined) void choose(file)
          event.target.value = ''
        }}
      />
    </label>
    {saved !== undefined && <div className={css.pending}>
      <strong>{saved.request.originalFileName}</strong><span>{byteLengthOfBase64(saved.request.contentBase64).toLocaleString()} B</span>
      <div className={css.actions}>
        <button type="button" disabled={busy || !durable || (saved.pending && !retryAllowed)} onClick={() => { void run(false) }}>
          {busy ? '处理中…' : retryAllowed ? '明确重新提交' : '保存音色文件'}
        </button>
        {saved.pending && <button type="button" disabled={busy || !durable} onClick={() => { void run(true) }}>恢复本次回执</button>}
      </div>
    </div>}
    {persistWarning && <p role="alert" className={css.error}>浏览器无法安全保存此上传草稿，因此不会提交。</p>}
    {error !== '' && <p role="alert" className={css.error}>{error}</p>}
    {notice !== '' && <p role="status" className={css.notice}>{notice}</p>}
    {receipt !== undefined && <article className={css.pending} aria-label="音色上传回执">
      <strong>{receipt.originalFileName}</strong>
      <span>{receipt.durationSec.toFixed(1)} 秒 · {receipt.sampleRate} Hz · {receipt.channels} 声道</span>
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={() => { void audition() }}>试听本次音色</button>
      </div>
      {audioUrl !== undefined && <audio controls src={audioUrl}>当前浏览器无法播放此音色文件。</audio>}
      <p>上传记录：作为本地参考文件保存。</p>
    </article>}
  </section>
}
