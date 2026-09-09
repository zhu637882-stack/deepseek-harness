/** Explicit image/voice bindings and verbatim prompt editing within the director workspace. */
import { useEffect, useRef, useState } from 'react'
import type {
  ReferenceVideoAsset, ReferenceVideoParameters, ReferenceVideoPreviewResponse, ReferenceVideoPromptPart,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengReadPort } from './contracts.ts'
import css from './ReferenceVideoWorkspace.module.css'

/** One shot's local reference draft; previewing never queues paid work. */
export interface ReferenceVideoWorkspaceProps {
  readonly projectId: string
  readonly frameId: string
  readonly initialPrompt: string
  readonly port: Pick<QingmuYimengReadPort, 'referenceVideoAssets' | 'referenceVideoPreview'>
}

type Chosen = ReferenceVideoAsset & { readonly bindingToken: string }

/** Edit reference nodes independently from literal dialogue and inspect the actual request.
 * @param props - Current shot and the authenticated host read port.
 * @returns Director reference editor.
 */
export function ReferenceVideoWorkspace({ projectId, frameId, initialPrompt, port }: ReferenceVideoWorkspaceProps) {
  const [assets, setAssets] = useState<readonly ReferenceVideoAsset[]>([])
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [chosen, setChosen] = useState<readonly Chosen[]>([])
  const [parts, setParts] = useState<readonly ReferenceVideoPromptPart[]>([{ text: initialPrompt }])
  const [parameters, setParameters] = useState<ReferenceVideoParameters>({ duration: 8, resolution: '720P', ratio: '16:9', audio: true, prompt_extend: false })
  const [result, setResult] = useState<ReferenceVideoPreviewResponse>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const activeText = useRef<{ index: number; start: number; end: number }>({
    index: 0, start: initialPrompt.length, end: initialPrompt.length,
  })
  const previewAbort = useRef<AbortController | undefined>(undefined)
  const assetsAbort = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { previewAbort.current?.abort(); assetsAbort.current?.abort() }, [])

  const invalidate = () => {
    previewAbort.current?.abort(); setBusy(false); setResult(undefined); setError('')
  }
  const loadAssets = async () => {
    if (loading) return
    const controller = new AbortController(); assetsAbort.current = controller
    setLoading(true); setError('')
    try {
      const next = await port.referenceVideoAssets({ projectId, page: page + 1 }, controller.signal)
      if (controller.signal.aborted) return
      setAssets(previous => [...previous, ...next.items.filter(item => !previous.some(old =>
        old.assetId === item.assetId && old.assetSha256 === item.assetSha256))])
      setPage(next.page); setPages(next.pages)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '素材读取失败') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  const choose = (asset: ReferenceVideoAsset) => {
    const limit = asset.mediaType === 'reference_image' ? 10 : 5
    if (chosen.filter(item => item.mediaType === asset.mediaType).length >= limit) {
      setError(asset.mediaType === 'reference_image' ? '最多选择 10 张图片' : '最多选择 5 段音色')
      return
    }
    invalidate(); setChosen(previous => [...previous, { ...asset, bindingToken: asset.assetId }])
  }
  const remove = (token: string) => {
    if (parts.some(part => 'bindingToken' in part && part.bindingToken === token)) { setError('先移除描述中的这条引用，再移除素材'); return }
    invalidate(); setChosen(previous => previous.filter(item => item.bindingToken !== token))
  }
  const insert = (token: string) => {
    const { index, start, end } = activeText.current
    const part = parts[index]
    if (!part || !('text' in part)) { setError('先点击描述中要插入引用的位置'); return }
    invalidate()
    setParts(previous => [
      ...previous.slice(0, index), { text: part.text.slice(0, start) },
      { bindingToken: token }, { text: part.text.slice(end) }, ...previous.slice(index + 1),
    ])
    activeText.current = { index: index + 2, start: 0, end: 0 }
  }
  const preview = async () => {
    if (busy) return
    invalidate()
    const controller = new AbortController(); previewAbort.current = controller; setBusy(true)
    try {
      const response = await port.referenceVideoPreview({ projectId, frameId, model: 'wan3.0-video',
        bindings: chosen.map(({ bindingToken, assetId, assetSha256, label }) => (
          { bindingToken, assetId, assetSha256, label }
        )),
        promptParts: parts, parameters }, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '预览失败') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  let images = 0; let audios = 0
  const aliases = new Map(chosen.map(item => [item.bindingToken, item.mediaType === 'reference_image' ? `图${++images}` : `音频${++audios}`]))
  const move = (index: number, delta: number) => {
    const next = [...chosen]; const other = next[index + delta]; const current = next[index]
    if (!other || !current) return
    next[index + delta] = current; next[index] = other
    invalidate(); setChosen(next)
  }

  return <details className={css.workspace}>
    <summary>精确引用 · 阿里视频预览</summary>
    <p>选好人物、场景和音色，在描述中插入引用。预览不生成视频、不扣费。</p>
    <div className={css.actions}>
      <button type="button" disabled={loading || (page > 0 && page >= pages)} onClick={() => { void loadAssets() }}>
        {loading ? '读取素材…' : page === 0 ? '读取项目素材' : page < pages ? '更多素材' : '素材已读完'}
      </button>
      <span>{images} 张图片 · {audios} 段音色</span>
    </div>
    {assets.length > 0 && <div className={css.assets} aria-label="项目素材">
      {assets.map(asset => <article key={`${asset.assetId}:${asset.assetSha256}`}>
        {asset.browserUrl && (asset.mediaType === 'reference_image'
          ? <img src={asset.browserUrl} alt={asset.label} loading="lazy" />
          : <audio src={asset.browserUrl} controls preload="none" aria-label={asset.label} />)}
        <p>{asset.label}</p>
        <button type="button" disabled={chosen.some(item => item.assetId === asset.assetId)} onClick={() => { choose(asset) }}>加入引用</button>
      </article>)}
    </div>}
    {chosen.length > 0 && <ol className={css.bindings} aria-label="引用顺序">
      {chosen.map((item, index) => <li key={item.bindingToken}>
        <strong>{aliases.get(item.bindingToken)}</strong>
        <input aria-label={`${aliases.get(item.bindingToken)}名称`} value={item.label} maxLength={128}
          onChange={(event) => {
            invalidate()
            setChosen(previous => previous.map(old => old.bindingToken === item.bindingToken
              ? { ...old, label: event.target.value } : old))
          }} />
        <div className={css.actions}>
          <button type="button" onClick={() => { insert(item.bindingToken) }}>插入{aliases.get(item.bindingToken)}</button>
          <button type="button" aria-label={`${item.label}前移`} disabled={index === 0} onClick={() => { move(index, -1) }}>前移</button>
          <button type="button" aria-label={`${item.label}后移`} disabled={index === chosen.length - 1} onClick={() => { move(index, 1) }}>后移</button>
          <button type="button" aria-label={`移除${item.label}`} onClick={() => { remove(item.bindingToken) }}>移除</button>
        </div>
      </li>)}
    </ol>}
    <div className={css.actions}><h4>视频描述</h4>
      <button type="button" onClick={() => { invalidate(); setParts([{ text: initialPrompt }]); activeText.current = { index: 0, start: initialPrompt.length, end: initialPrompt.length } }}>载入当前视频描述</button>
    </div>
    <div className={css.prompt}>
      {parts.map((part, index) => 'text' in part
        ? <textarea key={index} aria-label={`视频描述片段${index + 1}`} rows={parts.length === 1 ? 5 : 2} value={part.text}
          onSelect={(event) => {
            const field = event.currentTarget
            activeText.current = { index, start: field.selectionStart, end: field.selectionEnd }
          }}
          onChange={(event) => {
            invalidate(); const text = event.target.value
            setParts(previous => previous.map((old, i) => i === index ? { text } : old))
          }} />
        : <button key={index} type="button" className={css.chip} aria-label={`移除描述引用${aliases.get(part.bindingToken)}`}
          onClick={() => {
            invalidate(); setParts(previous => previous.filter((_, i) => i !== index))
            activeText.current = { index: 0, start: 0, end: 0 }
          }}>
          {aliases.get(part.bindingToken)} · {chosen.find(item => item.bindingToken === part.bindingToken)?.label} ×
        </button>)}
    </div>
    <div className={css.actions}>
      <label>时长（秒）<input type="number" min={2} max={30} value={parameters.duration} onChange={(event) => { invalidate(); setParameters({ ...parameters, duration: Number(event.target.value) }) }} /></label>
      <label>画质<select value={parameters.resolution} onChange={(event) => { invalidate(); setParameters({ ...parameters, resolution: event.target.value as ReferenceVideoParameters['resolution'] }) }}>
        {['480P', '720P', '1080P'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>画幅<select value={parameters.ratio} onChange={(event) => { invalidate(); setParameters({ ...parameters, ratio: event.target.value as ReferenceVideoParameters['ratio'] }) }}>
        {['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label><input type="checkbox" checked={parameters.audio} onChange={(event) => { invalidate(); setParameters({ ...parameters, audio: event.target.checked }) }} />原生声音</label>
      <label><input type="checkbox" checked={parameters.prompt_extend} onChange={(event) => { invalidate(); setParameters({ ...parameters, prompt_extend: event.target.checked }) }} />模型扩写描述</label>
    </div>
    <button type="button" disabled={busy || images === 0 || chosen.some(item => !item.label.trim())} onClick={() => { void preview() }}>{busy ? '核对素材与请求…' : '预览实际请求'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="阿里请求预览" aria-live="polite">
      <h4>将发送的描述</h4><p className={css.compiled}>{result.body.input.prompt}</p>
      <p>{result.body.parameters.duration} 秒 · {result.body.parameters.resolution} · {result.body.parameters.ratio}
        {' · '}音色合计 {result.referenceAudioDurationSec} 秒</p>
      <p>请求已核对。尚未提交生成。</p>
      <details><summary>查看引用版本与完整请求</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </section>}
    <p className={css.note}>这里是当前镜头的临时试排，刷新页面会清空。镜头正式素材与提示词保持原记录。</p>
  </details>
}
