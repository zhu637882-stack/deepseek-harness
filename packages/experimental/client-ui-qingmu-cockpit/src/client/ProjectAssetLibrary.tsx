import { useCallback, useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort } from './contracts.ts'
import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import css from './ProjectAssetLibrary.module.css'
import { usePrivateReferencePreview, type PrivateReferencePreviewPort } from './usePrivateReferencePreview.ts'

const THUMBNAIL_READ_LIMIT = 2
let activeThumbnailReads = 0
const waitingThumbnailReads = new Set<() => void>()

function assetLabel(item: ReferenceVideoAsset) {
  if (item.mediaType === 'reference_audio') {
    if (item.source?.role === 'sound_voice_reference') return `${item.label} · 完整试听`
    if (item.source?.role === 'sound_voice_reference_excerpt') return `${item.label} · 3秒参考片段`
  }
  return item.label
}

function releaseThumbnailRead() {
  activeThumbnailReads -= 1
  const next = waitingThumbnailReads.values().next().value
  if (next !== undefined) {
    waitingThumbnailReads.delete(next)
    next()
  }
}

/** Grants a bounded private read slot while a thumbnail remains near the viewport. */
function useThumbnailReadSlot(visible: boolean) {
  const [granted, setGranted] = useState(false)
  const releaseRef = useRef<(() => void) | undefined>()
  const release = useCallback(() => { releaseRef.current?.() }, [])
  useEffect(() => {
    if (!visible) {
      setGranted(false)
      releaseRef.current = undefined
      return
    }
    let subscribed = true
    let acquired = false
    const releaseSlot = () => {
      waitingThumbnailReads.delete(grant)
      if (!acquired) return
      acquired = false
      releaseThumbnailRead()
    }
    const grant = () => {
      if (!subscribed) return
      acquired = true
      activeThumbnailReads += 1
      setGranted(true)
    }
    if (activeThumbnailReads < THUMBNAIL_READ_LIMIT) grant()
    else waitingThumbnailReads.add(grant)
    releaseRef.current = releaseSlot
    return () => {
      subscribed = false
      if (releaseRef.current === releaseSlot) releaseRef.current = undefined
      releaseSlot()
    }
  }, [visible])
  return [granted, release] as const
}

/** Reads a private image only while its card approaches the visible grid. */
function AssetThumbnail({ projectId, item, port }: {
  readonly projectId: string
  readonly item: ReferenceVideoAsset
  readonly port: PrivateReferencePreviewPort
}) {
  const target = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const element = target.current
    if (element === null) return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some(entry => entry.isIntersecting))
    }, { rootMargin: '180px' })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  const needsPrivateImageRead = item.mediaType === 'reference_image'
    && item.browserUrl === '' && item.localReferenceScope !== undefined
  const [granted, releaseReadSlot] = useThumbnailReadSlot(visible && needsPrivateImageRead)
  const privateImage = granted && visible && needsPrivateImageRead ? item : undefined
  const { preview } = usePrivateReferencePreview(projectId, privateImage, port, 0)
  useEffect(() => { if (preview !== undefined) releaseReadSlot() }, [preview, releaseReadSlot])
  return <span ref={target} className={css.thumbnail}>
    {item.mediaType === 'reference_image'
      ? item.browserUrl
        ? <img src={item.browserUrl} alt="" loading="lazy" />
        : preview?.url !== undefined
          ? <img src={preview.url} alt="" />
          : <span className={css.mediaKind} aria-hidden="true">▧</span>
      : <span className={css.mediaKind} aria-hidden="true">{item.mediaType === 'reference_video' ? '▶' : '♫'}</span>}
  </span>
}

/** A project-wide media browser; preview selection is local to this view. */
export function ProjectAssetLibrary({ projectId, episodeId, port, refreshToken = 0, onOpenReferenceUpload, onLibraryChanged }: {
  readonly projectId: string
  readonly episodeId?: string
  readonly port: Pick<
    QingmuYimengPort,
    'referenceVideoAssets'
  > & PrivateReferencePreviewPort & Partial<Pick<QingmuYimengPort, 'setAssetLibraryState'>>
  /** Bumps after a real local-reference upload completes so the catalog rereads. */
  readonly refreshToken?: number
  /** Opens the existing person/scene upload surface; it never adopts a candidate. */
  readonly onOpenReferenceUpload?: () => void
  readonly onLibraryChanged?: () => void
}) {
  const [items, setItems] = useState<readonly ReferenceVideoAsset[]>([])
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [deleted, setDeleted] = useState(false)
  const [changing, setChanging] = useState(false)
  const [notice, setNotice] = useState('')
  const [kind, setKind] = useState<'all' | ReferenceVideoAsset['mediaType']>('all')
  const [selected, setSelected] = useState<string>()
  const [previewRetry, setPreviewRetry] = useState(0)
  const operation = useRef<AbortController>()
  const load = useCallback(async (nextPage: number) => {
    if (!projectId || operation.current) return
    const request = new AbortController(); operation.current = request
    setBusy(true); setError('')
    try {
      const result = await port.referenceVideoAssets({ projectId, page: nextPage, ...(deleted ? { deleted: true } : {}) }, request.signal)
      if (request.signal.aborted) return
      setItems(previous => nextPage === 1 ? result.items : [...previous, ...result.items.filter(item =>
        !previous.some(old => old.assetId === item.assetId && old.assetSha256 === item.assetSha256))])
      setPage(result.page); setPages(result.pages)
      if (nextPage === 1) setSelected(current => result.items.some(item => item.assetId === current) ? current : undefined)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : '素材暂时无法读取')
    } finally {
      if (operation.current === request) operation.current = undefined
      if (!request.signal.aborted) setBusy(false)
    }
  }, [projectId, port, deleted])
  useEffect(() => {
    void load(1)
    return () => { operation.current?.abort(); operation.current = undefined }
  }, [load, refreshToken])
  async function changeLibraryState(item: ReferenceVideoAsset) {
    if (!episodeId || !port.setAssetLibraryState || changing) return
    setChanging(true); setNotice('')
    try {
      await port.setAssetLibraryState({ projectId, episodeId, assetId: item.assetId,
        expectedSha256: item.assetSha256, deleted: !deleted })
      setSelected(undefined)
      await load(1)
      onLibraryChanged?.()
      setNotice(deleted ? '素材已恢复。' : '素材已删除，不再出现在可选素材中；可在已删除素材中恢复。')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '素材未能更新，请重试。')
    } finally { setChanging(false) }
  }
  const filtered = items.filter(item => (kind === 'all' || item.mediaType === kind)
    && item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const references = filtered.filter(item => item.source?.role === 'sound_voice_reference_excerpt')
  const primary = filtered.filter(item => item.source?.role !== 'sound_voice_reference_excerpt')
  const preview = items.find(item => item.assetId === selected)
  const { preview: localPreview, available: privateAvailable } = usePrivateReferencePreview(projectId, preview, port, previewRetry)
  const previewUrl = preview?.browserUrl || localPreview?.url
  const assetCard = (item: ReferenceVideoAsset) => <button type="button" key={`${item.assetId}:${item.assetSha256}`} className={css.asset}
    aria-label={`预览${assetLabel(item)}`} aria-pressed={item.assetId === selected} onClick={() => { setSelected(item.assetId) }}>
    <AssetThumbnail projectId={projectId} item={item} port={port} />
    <strong>{assetLabel(item)}</strong><small>{item.mediaType === 'reference_video' ? '视频 · 点击播放'
      : item.mediaType === 'reference_audio' ? '声音 · 点击试听' : '图片 · 点击查看'}</small>
  </button>
  return <section className={css.library} aria-label="项目图片与音色库">
    <header className={css.toolbar}>
      <div><h2>项目素材</h2><p>人物、场景图片、音色与视频，在镜头工作台中按需引用。</p></div>
      <div>
        {onOpenReferenceUpload !== undefined && <button type="button" disabled={!projectId} onClick={onOpenReferenceUpload}>上传人物/场景参考</button>}
        <button type="button" disabled={busy || !projectId} onClick={() => { void load(1) }}>{busy ? '读取中…' : '刷新素材'}</button>
      </div>
    </header>
    <div className={css.filters}>
      <div role="group" aria-label="素材类型">{([
        ['all', '全部'], ['reference_image', '图片'], ['reference_audio', '音色'], ['reference_video', '视频'],
      ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value}
        onClick={() => { setKind(value) }}>{label}</button>)}</div>
      <input aria-label="搜索素材" placeholder="搜索素材名称" value={query} onChange={(event) => { setQuery(event.target.value) }} />
      {port.setAssetLibraryState && episodeId && <button type="button" disabled={busy || changing} aria-pressed={deleted}
        onClick={() => { setSelected(undefined); setItems([]); setNotice(''); setDeleted(value => !value) }}>{deleted ? '返回素材库' : '已删除素材'}</button>}
      <span aria-live="polite">已载入 {items.length} 项{references.length > 0 ? `（含 ${references.length} 段同源声音片段）` : ''}</span>
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>素材暂时无法更新，请重试。</p><details><summary>错误详情</summary>{error}</details></div>}
    <div className={preview ? css.withPreview : undefined}>
      {preview && <section className={css.preview} aria-label="素材预览">
        <header><h3>{assetLabel(preview)}</h3><button type="button" onClick={() => { setSelected(undefined) }}>关闭预览</button></header>
        {preview.source?.role === 'sound_voice_reference_excerpt' && <p>从同次完整试听截取，供视频引用；属于同一个音色。</p>}
        {previewUrl !== undefined
          ? preview.mediaType === 'reference_video'
            ? <video controls src={previewUrl} preload="metadata" aria-label={preview.label} />
            : preview.mediaType === 'reference_audio'
              ? <audio controls src={previewUrl} preload="metadata" aria-label={preview.label} />
              : <img src={previewUrl} alt={preview.label} />
          : localPreview?.failed
            ? <div role="alert"><p>这份参考素材暂时无法读取。</p><button type="button" onClick={() => { setPreviewRetry(value => value + 1) }}>重新读取参考素材</button></div>
            : privateAvailable
              ? <p>正在读取这份本地参考素材。</p>
              : <p>此素材暂时没有可用的预览地址。刷新素材后重试。</p>}
        {port.setAssetLibraryState && episodeId && <button type="button" disabled={changing || busy}
          onClick={() => { void changeLibraryState(preview) }}>{changing ? '更新中…' : deleted ? '恢复素材' : '删除此素材'}</button>}
        <details><summary>素材标识</summary><code>{preview.assetId}</code></details>
      </section>}
      <div className={css.grid}>
        {primary.map(assetCard)}
      </div>
      {references.length > 0 && <details>
        <summary>视频用声音片段（{references.length}）</summary>
        <p>这些片段从完整试听截取，供镜头引用，属于已有音色。</p>
        <div className={css.grid}>{references.map(assetCard)}</div>
      </details>}
      {!busy && !filtered.length && <p className={css.empty}>{items.length ? '没有找到匹配的素材。' : deleted ? '没有已删除素材。' : '项目中还没有可引用的图片或音色。选择人物或场景后，可上传图片参考；角色音色可在人物参考区上传。'}</p>}
    </div>
    {page < pages && <button type="button" disabled={busy} onClick={() => { void load(page + 1) }}>加载更多素材</button>}

  </section>
}
