import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FirstFrameCandidatePreview } from './FirstFrameCandidatePreview.tsx'
import { NaturalPersonIdentityGate } from './NaturalPersonIdentityGate.tsx'
import { createFirstFrameSelectionClient, FirstFrameSelectionIdentityRequiredError, FirstFrameSelectionUnknownError, type FirstFrameHistoryCandidate, type FirstFrameSelectionCoordinates, type FirstFrameSelectionState, type FirstFrameSelectionIntent } from './first-frame-selection.ts'
import css from './ShootingFirstFrameHistory.module.css'

type Marker = FirstFrameSelectionIntent & { readonly requestSha256?: string }
type SelectionLoad = 'loading' | 'ready' | 'failed' | 'identity-required'

function selectionFailure(cause: unknown): SelectionLoad {
  return cause instanceof FirstFrameSelectionIdentityRequiredError
    ? 'identity-required'
    : 'failed'
}
function readMarker(key: string, scope: FirstFrameSelectionCoordinates): Marker | undefined {
  const raw = localStorage.getItem(key)
  if (raw === null) return
  const value = JSON.parse(raw) as Marker
  if (!value || Object.entries(scope).some(([k, v]) => value[k as keyof Marker] !== v)
    || typeof value.assetId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value.assetId)
    || typeof value.expectedMaterializedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedMaterializedSha256)
    || typeof value.idempotencyKey !== 'string' || !/^first-frame-[A-Za-z0-9-]+$/.test(value.idempotencyKey)
    || (value.requestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.requestSha256))) throw new Error('invalid adoption marker')
  return value
}

/** Browse independently of PromptIR readiness. Only the existing human selection API can adopt. */
export function ShootingFirstFrameHistory({ scope, onCommitted, onCandidatePreview }: {
  readonly scope: FirstFrameSelectionCoordinates
  readonly onCommitted: () => Promise<unknown>
  readonly onCandidatePreview?: (candidate: FirstFrameHistoryCandidate | undefined, url: string | undefined) => void
}) {
  const client = useMemo(() => createFirstFrameSelectionClient(), [])
  const [items, setItems] = useState<readonly FirstFrameHistoryCandidate[]>()
  const [selection, setSelection] = useState<FirstFrameSelectionState>()
  const [selectionLoad, setSelectionLoad] = useState<SelectionLoad>('loading')
  const [activeId, setActiveId] = useState('')
  const [viewed, setViewed] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const markerKey = `qingmu:first-frame-adopt:${scope.projectId}:${scope.episodeId}:${scope.storyboardRevisionId}:${scope.frameId}`
  const [pending, setPending] = useState(() => {
    try { return localStorage.getItem(markerKey) !== null } catch { return true }
  })
  const [canReadReceipt, setCanReadReceipt] = useState(() => {
    try { return Boolean(readMarker(markerKey, scope)?.requestSha256) } catch { return false }
  })
  const readSelection = useCallback(async (signal?: AbortSignal) => {
    setSelection(undefined); setSelectionLoad('loading')
    const current = await client.state(scope, signal)
    if (signal?.aborted) return
    setSelection(current)
    setSelectionLoad('ready')
    // Refresh only recovers a matching receipt; it never repeats the adoption POST.
    try {
      const marker = readMarker(markerKey, scope)
      if (marker && current.selectionReceipt?.idempotencyKey === marker.idempotencyKey
        && current.selectionReceipt.selectedAssetId === marker.assetId
        && current.selectionReceipt.selectedMaterializedSha256 === marker.expectedMaterializedSha256) {
        localStorage.removeItem(markerKey); setPending(false)
      }
    } catch { setPending(true) }
  }, [client, scope.projectId, scope.episodeId, scope.storyboardRevisionId, scope.frameId, markerKey])
  useEffect(() => {
    const controller = new AbortController()
    void client.history(scope, controller.signal).then((values) => {
      if (controller.signal.aborted) return
      setItems(values); setActiveId(values.at(-1)?.assetId ?? '')
    }).catch(() => { if (!controller.signal.aborted) setError('首帧历史暂时无法读取，请重新打开。') })
    void readSelection(controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setSelectionLoad(selectionFailure(cause))
    })
    return () => controller.abort()
  }, [client, readSelection])
  const onPreviewReady = useCallback((url: string | undefined) => { setViewed(url !== undefined); setPreviewUrl(url) }, [])
  const current = items?.find(item => item.assetId === activeId)
  // Identity is required only to adopt an existing candidate or recover an
  // already-started adoption. An empty shot has no identity action to take.
  const hasSelectionWork = (items?.length ?? 0) > 0 || pending
  useEffect(() => {
    onCandidatePreview?.(current, previewUrl)
    return () => onCandidatePreview?.(undefined, undefined)
  }, [current, previewUrl, onCandidatePreview])
  const eligible = selection?.candidates.find(item => item.assetId === activeId && item.materializedSha256 === current?.materializedSha256 && !item.isSelected && item.selectionStatus === 'Unselected')
  async function refreshAfterSelection(): Promise<void> {
    // Re-read authoritative metadata after a verified receipt; do not keep
    // publishing the pre-adoption "unselected" preview to the workspace.
    setPreviewUrl(undefined); setViewed(false); setSelection(undefined)
    await readSelection()
    setItems(await client.history(scope))
    await onCommitted()
  }
  async function adopt(): Promise<void> {
    if (!eligible || !viewed || busy || pending || lock.current) return
    lock.current = true
    setBusy(true); setError('')
    const marker: Marker = { ...scope, assetId: eligible.assetId, expectedMaterializedSha256: eligible.materializedSha256, idempotencyKey: `first-frame-${crypto.randomUUID()}` }
    try {
      localStorage.setItem(markerKey, JSON.stringify(marker)); setPending(true)
      const receipt = await client.select(marker)
      if (receipt.idempotencyKey !== marker.idempotencyKey || receipt.selectedAssetId !== marker.assetId
        || receipt.selectedMaterializedSha256 !== marker.expectedMaterializedSha256) throw new Error('receipt mismatch')
      localStorage.removeItem(markerKey); setPending(false)
      try { await refreshAfterSelection() }
      catch { setError('采用已保存，页面更新暂时失败；请刷新查看，不需再次采用。') }
    } catch (cause) { rememberUnknown(marker, cause) }
    finally { lock.current = false; setBusy(false) }
  }
  function rememberUnknown(marker: Marker, cause: unknown): void {
    if (cause instanceof FirstFrameSelectionUnknownError && cause.recovery.idempotencyKey === marker.idempotencyKey) {
      try {
        localStorage.setItem(markerKey, JSON.stringify({ ...marker, requestSha256: cause.recovery.requestSha256 }))
        setCanReadReceipt(true)
      } catch { /* Keep the original marker. */ }
    }
    setError('采用结果尚未确认，原操作已保留；不会自动重提或创建新采用操作。')
  }
  async function recover(): Promise<void> {
    if (busy || lock.current) return
    lock.current = true
    setBusy(true); setError('')
    let marker: Marker | undefined
    try {
      marker = readMarker(markerKey, scope)
      if (!marker) return
      // Known receipt: GET only. Unknown network response: this explicit human
      // button retries the identical intent/key, never manufactures a new one.
      const receipt = marker.requestSha256
        ? await client.receipt({ ...marker, requestSha256: marker.requestSha256 })
        : await client.select(marker)
      if (receipt.idempotencyKey !== marker.idempotencyKey || receipt.selectedAssetId !== marker.assetId
        || receipt.selectedMaterializedSha256 !== marker.expectedMaterializedSha256) throw new Error('receipt mismatch')
      localStorage.removeItem(markerKey); setPending(false)
      try { await refreshAfterSelection() }
      catch { setError('原采用已确认，页面更新暂时失败；请刷新查看，不需再次采用。') }
    } catch (cause) { if (marker) rememberUnknown(marker, cause); else setError('原采用记录不完整，未提交任何操作。') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className={css.history} aria-label="本镜首帧候选">
    <header><strong>首帧候选</strong><span>单击比较，采用另行确认</span></header>
    <div className={css.image}>
      {current && <FirstFrameCandidatePreview key={current.assetId} autoLoad
        request={{ ...scope, assetId: current.assetId, expectedMaterializedSha256: current.materializedSha256 }}
        load={client.historyPreview} onPreviewReady={onPreviewReady}
        labels={{ load: '查看这张首帧', loading: '正在读取首帧', error: '这张首帧暂时无法读取，可再试一次。', ariaLabel: `首帧候选 v${(items?.indexOf(current) ?? 0) + 1}` }} />}
      {items === undefined && !error && <p role="status">正在读取首帧历史…</p>}
      {items?.length === 0 && <p>本镜还没有已落盘的首帧。请返回分镜核对要求后生成首帧。</p>}
    </div>
    <div className={css.strip}>{items?.map((item, index) => <button type="button" key={item.assetId} aria-pressed={activeId === item.assetId} onClick={() => { if (item.assetId !== activeId) { setActiveId(item.assetId); setViewed(false); setPreviewUrl(undefined) } }}>
      {activeId === item.assetId ? previewUrl ? <img className={css.thumbnail} src={previewUrl} alt={`首帧 v${index + 1} 缩略图`} /> : <span className={css.thumbnail}>读取中…</span> : <FirstFrameCandidatePreview autoLoad thumbnailClassName={css.thumbnail ?? ''}
        request={{ ...scope, assetId: item.assetId, expectedMaterializedSha256: item.materializedSha256 }} load={client.historyPreview}
        labels={{ load: '查看首帧', loading: '正在读取首帧', error: '缩略图未载入', ariaLabel: `首帧 v${index + 1} 缩略图` }} />}
      <span>首帧 v{index + 1}</span><small>{item.isSelected ? '当前选用' : item.selectionStatus === 'Stale' ? '旧版，仅供对照' : item.selectionStatus === 'Rejected' || item.qualityStatus === 'failed' ? '未通过' : item.qualityStatus === 'passed' ? '待你审看' : '检查未就绪'}</small>
    </button>)}</div>
    <div className={css.footer}>
      {eligible && viewed && !pending && <button className={css.primary} type="button" disabled={busy} onClick={() => { void adopt() }}>认可并采用这张首帧</button>}
      {hasSelectionWork && selectionLoad === 'identity-required' ? <NaturalPersonIdentityGate projectId={scope.projectId} episodeId={scope.episodeId}
        onBound={async () => {
          setError(''); setSelectionLoad('loading')
          try { await readSelection() }
          catch (cause) { setSelectionLoad(selectionFailure(cause)) }
        }} />
        : hasSelectionWork && selectionLoad === 'failed' ? <div role="alert"><p>采用条件暂时无法读取。你可以继续比较候选，不必因此重新生成。</p><button type="button" onClick={() => {
          void readSelection().catch((cause: unknown) => {
            setSelectionLoad(selectionFailure(cause))
          })
        }}>重新检查采用条件</button></div>
          : hasSelectionWork && current && !eligible && !current.isSelected && <p role="status">{selectionLoad === 'loading' ? '正在读取采用条件…' : current.qualityStatus === 'pending' ? '这张图片的检查结果尚未就绪。可继续比较，暂不能采用。' : '这张图片不符合当前采用条件，仅供对照；现有选用不会改变。'}</p>}
      {pending && <button type="button" disabled={busy} onClick={() => { void recover() }}>{canReadReceipt ? '读取原采用结果' : '继续原采用操作'}</button>}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>
}
