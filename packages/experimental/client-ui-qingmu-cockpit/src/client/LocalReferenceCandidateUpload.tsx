import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  LocalReferenceCandidateList, LocalReferenceCandidateResult, LocalReferenceElementKind,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'
import {
  clearLocalReferenceDraft,
  restoreLocalReferenceDraft,
  saveLocalReferenceDraft,
  type SavedLocalReferenceInput,
} from './LocalReferenceDraftStore.ts'
import css from './LocalReferenceCandidateUpload.module.css'

const MAX_BYTES = 8 * 1024 * 1024
type SavedInput = SavedLocalReferenceInput

function keyOf(projectId: string, kind: string, targetId: string): string {
  return `qingmu.local-reference.v1:${projectId}:${kind}:${targetId}`
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
  const [saved, setSaved] = useState<SavedInput>()
  const [durable, setDurable] = useState(false)
  const [list, setList] = useState<LocalReferenceCandidateList>()
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [persistWarning, setPersistWarning] = useState(false)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const lock = useRef(false)
  const restoreLock = useRef(true)
  const scopeGeneration = useRef(0)
  const actionGeneration = useRef(0)
  const previewGeneration = useRef(0)
  const current = useRef<SavedInput>()
  const candidate = useMemo(() => list?.candidates.find(item => item.assetId === selectedId)
    ?? list?.candidates.at(-1), [list, selectedId])

  const isCurrent = (scopeToken: number) => scopeToken === scopeGeneration.current
  const saveDraft = async (next: SavedInput, scopeToken: number): Promise<boolean> => {
    current.current = next
    if (isCurrent(scopeToken)) setSaved(next)
    const savedDurably = await saveLocalReferenceDraft(storageKey, next)
    if (!isCurrent(scopeToken)) return false
    setDurable(savedDurably)
    setPersistWarning(!savedDurably)
    return savedDurably
  }
  const clearDraft = async (scopeToken: number): Promise<boolean> => {
    const cleared = await clearLocalReferenceDraft(storageKey)
    if (!isCurrent(scopeToken)) return false
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
  const load = async (signal: AbortSignal | undefined, scopeToken: number) => {
    const result = await port.listLocalReferenceCandidates({ projectId, elementKind, targetId }, signal)
    if (!isCurrent(scopeToken)) return
    setList(result)
    setSelectedId(previous => previous === '' && result.candidates.length > 0
      ? result.candidates.at(-1)?.assetId ?? '' : previous)
  }

  useEffect(() => {
    const scopeToken = ++scopeGeneration.current
    const restoreActionToken = actionGeneration.current
    const controller = new AbortController()
    current.current = undefined
    lock.current = false
    restoreLock.current = true
    setRestoring(true)
    setSaved(undefined)
    setDurable(false)
    setList(undefined)
    setSelectedId('')
    setError('')
    setNotice('')
    setPersistWarning(false)
    setRetryAllowed(false)
    setBusy(false)
    void restoreLocalReferenceDraft(storageKey).then((restored) => {
      if (!isCurrent(scopeToken) || restoreActionToken !== actionGeneration.current) return
      current.current = restored.saved
      setSaved(restored.saved)
      setDurable(restored.durable)
      setPersistWarning(restored.saved !== undefined && !restored.durable)
      setNotice(restored.saved?.pending === true ? t('assetUploadPending') : '')
    }).finally(() => {
      if (!isCurrent(scopeToken)) return
      restoreLock.current = false
      setRestoring(false)
    })
    void load(controller.signal, scopeToken).catch((cause: unknown) => {
      if (isCurrent(scopeToken) && !controller.signal.aborted) setError(messageOf(cause))
    })
    return () => {
      controller.abort()
      scopeGeneration.current++
      actionGeneration.current++
      lock.current = false
      restoreLock.current = false
    }
  }, [storageKey])

  useEffect(() => {
    if (candidate === undefined) {
      setPreview(undefined)
      return
    }
    const token = ++previewGeneration.current
    const controller = new AbortController()
    void port.readLocalReferenceCandidateContent({ projectId, elementKind, targetId, assetId: candidate.assetId,
      expectedSha256: candidate.materializedSha256 }, controller.signal).then((result) => {
      if (token === previewGeneration.current) setPreview(`data:${result.mimeType};base64,${result.contentBase64}`)
    }).catch((cause: unknown) => {
      if (token === previewGeneration.current && !controller.signal.aborted) {
        setPreview(undefined)
        setError(messageOf(cause))
      }
    })
    return () => {
      controller.abort()
      previewGeneration.current++
    }
  }, [candidate?.assetId, candidate?.materializedSha256, projectId, elementKind, targetId])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (current.current !== undefined) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => { window.removeEventListener('beforeunload', guard) }
  }, [])

  const begin = (): { readonly actionToken: number; readonly scopeToken: number } | undefined => {
    if (lock.current || restoreLock.current) return undefined
    lock.current = true
    const scopeToken = scopeGeneration.current
    const actionToken = ++actionGeneration.current
    setBusy(true)
    return { actionToken, scopeToken }
  }
  const end = (actionToken: number, scopeToken: number) => {
    if (actionToken === actionGeneration.current && isCurrent(scopeToken)) {
      lock.current = false
      setBusy(false)
    }
  }
  const choose = async (file: File) => {
    const action = begin()
    if (action === undefined) return
    try {
      setError('')
      setNotice('')
      setRetryAllowed(false)
      if (file.size < 1 || file.size > MAX_BYTES) {
        if (isCurrent(action.scopeToken)) setError(t('assetUploadChoose'))
        return
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (action.actionToken !== actionGeneration.current || !isCurrent(action.scopeToken)) return
      await saveDraft({ request: { projectId, elementKind, targetId,
        idempotencyKey: makeIdempotencyKey(), originalFileName: file.name,
        contentBase64: toBase64(bytes), sourceDeclaration: 'local_file_unverified' }, pending: false }, action.scopeToken)
    } catch (cause) {
      if (isCurrent(action.scopeToken)) setError(messageOf(cause))
    } finally {
      end(action.actionToken, action.scopeToken)
    }
  }
  const finish = async (result: LocalReferenceCandidateResult, actionToken: number, scopeToken: number) => {
    if (actionToken !== actionGeneration.current || !isCurrent(scopeToken)) return
    setSelectedId(result.assetId)
    await load(undefined, scopeToken)
    if (actionToken !== actionGeneration.current || !isCurrent(scopeToken)) return
    if (!await clearDraft(scopeToken)) return
    if (actionToken !== actionGeneration.current || !isCurrent(scopeToken)) return
    setRetryAllowed(false)
    setNotice(t('assetUploadStored'))
    await onStored()
  }
  const run = async (recover: boolean) => {
    const action = begin()
    if (action === undefined) return
    try {
      setError('')
      const intent = current.current
      if (intent === undefined || !durable) {
        if (isCurrent(action.scopeToken)) setPersistWarning(true)
        return
      }
      if (!recover && !await saveDraft({ ...intent, pending: true }, action.scopeToken)) return
      if (action.actionToken !== actionGeneration.current || !isCurrent(action.scopeToken)) return
      const result = await (recover
        ? port.recoverLocalReferenceCandidate(intent.request)
        : port.uploadLocalReferenceCandidate(intent.request))
      if (action.actionToken === actionGeneration.current) await finish(result, action.actionToken, action.scopeToken)
    } catch (cause) {
      if (action.actionToken === actionGeneration.current && isCurrent(action.scopeToken)) {
        const message = messageOf(cause)
        const missingReceipt = recover && /404|local_reference_receipt_not_found/.test(message)
        setRetryAllowed(missingReceipt)
        setError(missingReceipt ? t('assetUploadReceiptMissing') : message)
        setNotice(current.current?.pending === true || !recover ? t('assetUploadPending') : '')
      }
    } finally {
      end(action.actionToken, action.scopeToken)
    }
  }

  return <section className={css.panel} aria-label={t('assetUploadTitle')}>
    <header><div><span>{targetName}</span><h4>{t('assetUploadTitle')}</h4></div><p>{t('assetUploadBoundary')}</p></header>
    <label className={css.filePicker}>{t('assetUploadChoose')}
      <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={busy || restoring}
        onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void choose(file); event.target.value = '' }} />
    </label>
    {saved !== undefined && <div className={css.pending}>
      <strong>{saved.request.originalFileName}</strong><span>{byteLengthOfBase64(saved.request.contentBase64).toLocaleString()} B</span>
      <div className={css.actions}>
        <button type="button" disabled={busy || !durable || (saved.pending && !retryAllowed)} onClick={() => { void run(false) }}>{busy
          ? t('assetUploadBusy') : retryAllowed ? t('assetUploadRetry') : t('assetUploadSubmit')}</button>
        {saved.pending && <button type="button" disabled={busy || !durable} onClick={() => { void run(true) }}>{t('assetUploadRecover')}</button>}
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
