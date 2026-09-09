import { useCallback, useEffect, useRef, useState } from 'react'
import type { QingmuYimengPort } from './contracts.ts'
import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import css from './ProjectAssetLibrary.module.css'

/** A project-wide media browser; preview selection is local to this view. */
export function ProjectAssetLibrary({ projectId, port }: {
  readonly projectId: string
  readonly port: Pick<QingmuYimengPort, 'referenceVideoAssets'>
}) {
  const [items, setItems] = useState<readonly ReferenceVideoAsset[]>([])
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'reference_image' | 'reference_audio'>('all')
  const [selected, setSelected] = useState<string>()
  const operation = useRef<AbortController>()
  const load = useCallback(async (nextPage: number) => {
    if (!projectId || operation.current) return
    const request = new AbortController(); operation.current = request
    setBusy(true); setError('')
    try {
      const result = await port.referenceVideoAssets({ projectId, page: nextPage }, request.signal)
      if (request.signal.aborted) return
      setItems(previous => nextPage === 1 ? result.items : [...previous, ...result.items.filter(item =>
        !previous.some(old => old.assetId === item.assetId && old.assetSha256 === item.assetSha256))])
      setPage(result.page); setPages(result.pages)
      if (nextPage === 1) setSelected(undefined)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : '素材暂时无法读取')
    } finally {
      if (operation.current === request) operation.current = undefined
      if (!request.signal.aborted) setBusy(false)
    }
  }, [projectId, port])
  useEffect(() => {
    void load(1)
    return () => { operation.current?.abort(); operation.current = undefined }
  }, [load])
  const filtered = items.filter(item => (kind === 'all' || item.mediaType === kind)
    && item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const preview = items.find(item => item.assetId === selected)
  return <section className={css.library} aria-label="项目图片与音色库">
    <header className={css.toolbar}>
      <div><h2>项目素材</h2><p>人物、场景图片与音色，在镜头工作台中按需引用。</p></div>
      <button type="button" disabled={busy || !projectId} onClick={() => { void load(1) }}>{busy ? '读取中…' : '刷新素材'}</button>
    </header>
    <div className={css.filters}>
      <div role="group" aria-label="素材类型">{([
        ['all', '全部'], ['reference_image', '图片'], ['reference_audio', '音色'],
      ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value}
        onClick={() => { setKind(value) }}>{label}</button>)}</div>
      <input aria-label="搜索素材" placeholder="搜索素材名称" value={query} onChange={(event) => { setQuery(event.target.value) }} />
      <span aria-live="polite">已载入 {items.length} 项</span>
    </div>
    {error && <div role="alert"><p>素材暂时无法更新，请重试。</p><details><summary>错误详情</summary>{error}</details></div>}
    <div className={preview ? css.withPreview : undefined}>
      {preview && <section className={css.preview} aria-label="素材预览">
        <header><h3>{preview.label}</h3><button type="button" onClick={() => { setSelected(undefined) }}>关闭预览</button></header>
        {preview.browserUrl ? preview.mediaType === 'reference_image'
          ? <img src={preview.browserUrl} alt={preview.label} />
          : <audio controls src={preview.browserUrl} preload="metadata" aria-label={preview.label} />
          : <p>此素材暂时没有可用的预览地址。刷新素材后重试。</p>}
        <details><summary>素材标识</summary><code>{preview.assetId}</code></details>
      </section>}
      <div className={css.grid}>
        {filtered.map(item => <button type="button" key={`${item.assetId}:${item.assetSha256}`} className={css.asset}
          aria-label={`预览${item.label}`} aria-pressed={item.assetId === selected} onClick={() => { setSelected(item.assetId) }}>
          <span className={css.thumbnail}>{item.mediaType === 'reference_image' && item.browserUrl
            ? <img src={item.browserUrl} alt={item.label} loading="lazy" />
            : <span className={css.mediaKind}>{item.mediaType === 'reference_audio' ? '♫' : '▧'}</span>}</span>
          <strong>{item.label}</strong><small>{item.mediaType === 'reference_audio' ? '音色 · 点击试听' : '图片 · 点击查看'}</small>
        </button>)}
      </div>
      {!busy && !filtered.length && <p className={css.empty}>{items.length ? '没有找到匹配的素材。' : '项目中还没有可引用的图片或音色。可以在下方档案中上传人物与场景参考。'}</p>}
    </div>
    {page < pages && <button type="button" disabled={busy} onClick={() => { void load(page + 1) }}>加载更多素材</button>}

  </section>
}
