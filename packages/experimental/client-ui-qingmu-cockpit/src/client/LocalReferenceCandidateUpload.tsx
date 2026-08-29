import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  LocalReferenceCandidateList, LocalReferenceCandidateResult, LocalReferenceElementKind,
  LocalReferenceUploadRequest,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import css from './LocalReferenceCandidateUpload.module.css'

const MAX_BYTES = 3 * 1024 * 1024
interface SavedInput { readonly request: LocalReferenceUploadRequest; readonly pending: boolean }
const volatileSaved = new Map<string, SavedInput>()
function keyOf(projectId: string, kind: string, targetId: string): string {
  return `qingmu.local-reference.v1:${projectId}:${kind}:${targetId}`
}
function readSaved(key: string): SavedInput | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch { parsed = volatileSaved.get(key) }
  if ((parsed === null || parsed === undefined) && volatileSaved.has(key)) parsed = volatileSaved.get(key)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const saved = parsed as Record<string, unknown>
  if (typeof saved.request !== 'object' || saved.request === null || typeof saved.pending !== 'boolean') return undefined
  const request = saved.request as Record<string, unknown>
  if (typeof request.contentBase64 !== 'string' || typeof request.originalFileName !== 'string'
    || request.sourceDeclaration !== 'local_file_unverified') return undefined
  return parsed as SavedInput
}
function makeIdempotencyKey(): string {
  const random = globalThis.crypto.randomUUID().replaceAll('-', '')
  return `local-ref-${random.slice(0, 40)}`
}
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
function byteLengthOfBase64(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Upload-only surface. Existing reference selection and rights decisions stay separate. */
export function LocalReferenceCandidateUpload({ projectId, elementKind, targetId, targetName, port, t, onStored }: {
  readonly projectId: string
  readonly elementKind: LocalReferenceElementKind
  readonly targetId: string
  readonly targetName: string
  readonly port: Pick<QingmuYimengPort, 'listLocalReferenceCandidates' | 'uploadLocalReferenceCandidate' | 'recoverLocalReferenceCandidate' | 'readLocalReferenceCandidateContent'>
  readonly t: (key: QingmuCockpitKey) => string
  readonly onStored: () => Promise<void>
}) {
  const storageKey = keyOf(projectId, elementKind, targetId)
  const [saved, setSaved] = useState<SavedInput | undefined>(() => readSaved(storageKey))
  const [list, setList] = useState<LocalReferenceCandidateList>()
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(saved?.pending === true ? t('assetUploadPending') : '')
  const [persistWarning, setPersistWarning] = useState(false)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const lock = useRef(false)
  const scopeGeneration = useRef(0)
  const previewGeneration = useRef(0)
  const uploadGeneration = useRef(0)
  const current = useRef(saved)
  const candidate = useMemo(() => list?.candidates.find(item => item.assetId === selectedId)
    ?? list?.candidates.at(-1), [list, selectedId])
  const persist = (next: SavedInput | undefined) => {
    current.current = next
    setSaved(next)
    try {
      if (next === undefined) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify(next))
      volatileSaved.delete(storageKey)
      setPersistWarning(false)
    } catch {
      if (next === undefined) volatileSaved.delete(storageKey)
      else volatileSaved.set(storageKey, next)
      setPersistWarning(true)
    }
  }
  const load = async (signal?: AbortSignal, token = scopeGeneration.current) => {
    const result = await port.listLocalReferenceCandidates({ projectId, elementKind, targetId }, signal)
    if (token !== scopeGeneration.current) return
    setList(result)
    if (selectedId === '' && result.candidates.length > 0) setSelectedId(result.candidates.at(-1)?.assetId ?? '')
  }
  useEffect(() => {
    const restored = readSaved(storageKey)
    current.current = restored
    setSaved(restored)
    setRetryAllowed(false)
    setNotice(restored?.pending === true ? t('assetUploadPending') : '')
  }, [storageKey])
  useEffect(() => {
    const token = ++scopeGeneration.current
    const controller = new AbortController()
    void load(controller.signal, token).catch((cause: unknown) => {
      if (token === scopeGeneration.current && !controller.signal.aborted) setError(messageOf(cause))
    })
    return () => {
      controller.abort(); scopeGeneration.current++; uploadGeneration.current++; lock.current = false
    }
  }, [projectId, elementKind, targetId])
  useEffect(() => {
    if (candidate === undefined) { setPreview(undefined); return }
    const token = ++previewGeneration.current
    const controller = new AbortController()
    void port.readLocalReferenceCandidateContent({ projectId, elementKind, targetId, assetId: candidate.assetId,
      expectedSha256: candidate.materializedSha256 }, controller.signal).then((result) => {
      if (token === previewGeneration.current) setPreview(`data:${result.mimeType};base64,${result.contentBase64}`)
    }).catch((cause: unknown) => {
      if (token === previewGeneration.current && !controller.signal.aborted) {
        setPreview(undefined); setError(messageOf(cause))
      }
    })
    return () => { controller.abort(); previewGeneration.current++ }
  }, [candidate?.assetId, candidate?.materializedSha256, projectId, elementKind, targetId])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (current.current !== undefined) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => { window.removeEventListener('beforeunload', guard) }
  }, [])
  const choose = async (file: File) => {
    setError(''); setNotice(''); setRetryAllowed(false)
    if (file.size < 1 || file.size > MAX_BYTES) { setError(t('assetUploadChoose')); return }
    const request: LocalReferenceUploadRequest = { projectId, elementKind, targetId,
      idempotencyKey: makeIdempotencyKey(), originalFileName: file.name,
      contentBase64: toBase64(new Uint8Array(await file.arrayBuffer())), sourceDeclaration: 'local_file_unverified' }
    persist({ request, pending: false })
  }
  const finish = async (result: LocalReferenceCandidateResult, uploadToken: number, scopeToken: number) => {
    setSelectedId(result.assetId)
    await load(undefined, scopeToken)
    if (uploadToken !== uploadGeneration.current || scopeToken !== scopeGeneration.current) return
    persist(undefined)
    setRetryAllowed(false)
    setNotice(t('assetUploadStored'))
    await onStored()
  }
  const run = async (recover: boolean) => {
    const intent = current.current
    if (lock.current || intent === undefined) return
    lock.current = true; setBusy(true); setError('')
    const token = ++uploadGeneration.current
    const scopeToken = scopeGeneration.current
    if (!recover) persist({ ...intent, pending: true })
    try {
      const result = await (recover
        ? port.recoverLocalReferenceCandidate(intent.request)
        : port.uploadLocalReferenceCandidate(intent.request))
      if (token === uploadGeneration.current) await finish(result, token, scopeToken)
    } catch (cause) {
      if (token === uploadGeneration.current) {
        const message = messageOf(cause)
        const missingReceipt = recover && /404|local_reference_receipt_not_found/.test(message)
        setRetryAllowed(missingReceipt)
        setError(missingReceipt ? t('assetUploadReceiptMissing') : message)
        setNotice(intent.pending || !recover ? t('assetUploadPending') : '')
      }
    } finally {
      if (token === uploadGeneration.current) { setBusy(false); lock.current = false }
    }
  }
  return <section className={css.panel} aria-label={t('assetUploadTitle')}>
    <header><div><span>{targetName}</span><h4>{t('assetUploadTitle')}</h4></div><p>{t('assetUploadBoundary')}</p></header>
    <label className={css.filePicker}>{t('assetUploadChoose')}
      <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={busy}
        onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void choose(file); event.target.value = '' }} />
    </label>
    {saved !== undefined && <div className={css.pending}>
      <strong>{saved.request.originalFileName}</strong><span>{byteLengthOfBase64(saved.request.contentBase64).toLocaleString()} B</span>
      <div className={css.actions}>
        <button type="button" disabled={busy || (saved.pending && !retryAllowed)} onClick={() => { void run(false) }}>{busy
          ? t('assetUploadBusy') : retryAllowed ? t('assetUploadRetry') : t('assetUploadSubmit')}</button>
        {saved.pending && <button type="button" disabled={busy} onClick={() => { void run(true) }}>{t('assetUploadRecover')}</button>}
      </div>
    </div>}
    {persistWarning && <p role="alert" className={css.error}>{t('assetUploadPersistWarning')}</p>}
    {error !== '' && <p role="alert" className={css.error}>{error}</p>}
    {notice !== '' && <p role="status" className={css.notice}>{notice}</p>}
    {list !== undefined && list.candidates.length === 0 && <p className={css.empty}>{t('assetUploadNoCandidates')}</p>}
    {list !== undefined && list.candidates.length > 0 && <div className={css.candidateGrid}>
      <nav aria-label={t('assetUploadTitle')}>{list.candidates.map(item => <button type="button" key={item.assetId}
        aria-pressed={candidate?.assetId === item.assetId} onClick={() => { setSelectedId(item.assetId) }}>
        <strong>{item.originalFileName}</strong><span>{item.mimeType} · {item.width}×{item.height}</span>
      </button>)}</nav>
      {candidate !== undefined && <article>
        <div className={css.preview}>{preview === undefined ? <span>{t('assetUploadPreview')}</span> : <img src={preview} alt={`${targetName} ${t('assetUploadPreview')}`} />}</div>
        <dl>
          <div><dt>{t('assetUploadCandidateState')}</dt><dd>{t('assetUploadCandidateStateValue')}</dd></div>
          <div><dt>{t('assetUploadSource')}</dt><dd>{t('assetUploadSourceValue')}</dd></div>
          <div><dt>{t('assetRightsOperation')}</dt><dd>{t('assetUploadRightsValue')}</dd></div>
          <div><dt>{t('assetUploadInputSha')}</dt><dd>{candidate.inputSha256}</dd></div>
          <div><dt>{t('assetUploadStoredSha')}</dt><dd>{candidate.materializedSha256}</dd></div>
        </dl>
        <strong className={css.boundary}>{t('assetUploadCandidateStateValue')}</strong>
      </article>}
    </div>}
  </section>
}
