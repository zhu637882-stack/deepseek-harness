/** Explicit image/voice bindings and verbatim prompt editing within the director workspace. */
import { useEffect, useRef, useState } from 'react'
import type {
  ReferenceVideoAsset, ReferenceVideoParameters, ReferenceVideoPreviewResponse, ReferenceVideoPromptPart,
  ReferenceVideoDraftResponse,
  ReferenceVideoQuoteResponse,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ReferenceVideoWorkspace.module.css'
import { ReferenceVideoRuns } from './ReferenceVideoRuns.tsx'

/** One shot's local reference draft; previewing never queues paid work. */
export interface ReferenceVideoWorkspaceProps {
  readonly projectId: string
  readonly frameId: string
  readonly initialPrompt: string
  readonly port: Pick<QingmuYimengPort, 'referenceVideoAssets' | 'referenceVideoPreview' | 'referenceVideoDraft' | 'saveReferenceVideoDraft' | 'referenceVideoQuote' | 'referenceVideoRuns' | 'queueReferenceVideo'>
}

type Chosen = Omit<ReferenceVideoAsset, 'mediaType'> & { readonly bindingToken: string; readonly mediaType: ReferenceVideoAsset['mediaType'] | 'unavailable' }

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
  const [quoteResult, setQuoteResult] = useState<ReferenceVideoQuoteResponse>()
  const [savedEpoch, setSavedEpoch] = useState(-1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [draftState, setDraftState] = useState<ReferenceVideoDraftResponse>()
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [sourceAccepted, setSourceAccepted] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draftMessage, setDraftMessage] = useState('正在读取草稿状态…')
  const epoch = useRef(0)
  const activeText = useRef<{ index: number; start: number; end: number }>({
    index: 0, start: initialPrompt.length, end: initialPrompt.length,
  })
  const previewAbort = useRef<AbortController | undefined>(undefined)
  const assetsAbort = useRef<AbortController | undefined>(undefined)
  const draftAbort = useRef<AbortController | undefined>(undefined)
  const saveAbort = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController(); draftAbort.current = controller
    void port.referenceVideoDraft({ projectId, frameId }, controller.signal).then((state) => {
      if (controller.signal.aborted) return
      setDraftState(state)
      if (epoch.current === 0) setDraftMessage(state.draft ? '此镜头有已存草稿，可恢复后继续编辑。' : '尚无已存草稿。')
    }).catch(() => { if (!controller.signal.aborted) setDraftMessage('草稿状态读取失败；当前试排仍可预览，请重新读取。') })
    return () => {
      controller.abort(); previewAbort.current?.abort(); assetsAbort.current?.abort()
      draftAbort.current?.abort(); saveAbort.current?.abort()
    }
  }, [projectId, frameId, port])

  const invalidate = () => {
    epoch.current += 1
    setDraftMessage('当前修改尚未保存。')
    previewAbort.current?.abort(); setBusy(false); setResult(undefined); setQuoteResult(undefined); setError('')
  }
  const restore = async () => {
    draftAbort.current?.abort()
    const controller = new AbortController(); draftAbort.current = controller
    const start = epoch.current
    try {
      const state = await port.referenceVideoDraft({ projectId, frameId }, controller.signal)
      if (controller.signal.aborted) return
      if (epoch.current !== start) { setDraftMessage('读取期间又有编辑，已保留当前内容。需要恢复时请再点击。'); return }
      setDraftState(state)
      if (!state.draft) { setDraftLoaded(true); setSourceAccepted(true); setDraftMessage('服务器尚无草稿；当前试排已保留，可直接保存。'); return }
      invalidate()
      setSavedEpoch(epoch.current)
      setChosen(state.draft.request.bindings.map(binding => ({ ...binding, browserUrl: '', mediaType: state.mediaTypes[binding.bindingToken] ?? 'unavailable' })))
      setParts(state.draft.request.promptParts); setParameters(state.draft.request.parameters)
      activeText.current = { index: 0, start: 0, end: 0 }
      setDraftLoaded(true); setSourceAccepted(state.draft.frameSha256 === state.frameSha256)
      setDraftMessage(`已恢复草稿版本 ${state.draft.revision}。`)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '恢复草稿失败') }
  }
  const save = async () => {
    if (saving || !draftState || !sourceAccepted || (draftState.draft && !draftLoaded)) return
    draftAbort.current?.abort()
    const controller = new AbortController(); saveAbort.current = controller
    const start = epoch.current; setSaving(true); setError('')
    try {
      const state = await port.saveReferenceVideoDraft({ projectId, frameId,
        expectedRevision: draftState.draft?.revision ?? 0, expectedFrameSha256: draftState.frameSha256,
        request: { frameId, model: 'wan3.0-video',
          bindings: chosen.map(({ bindingToken, assetId, assetSha256, label }) => ({ bindingToken, assetId, assetSha256, label })),
          promptParts: parts, parameters } }, controller.signal)
      if (controller.signal.aborted) return
      setDraftState(state); setDraftLoaded(true); setSavedEpoch(start)
      setDraftMessage(epoch.current === start ? `已保存草稿版本 ${state.draft?.revision}。` : '上一版已保存，随后修改的内容尚未保存。')
    } catch (cause) {
      if (!controller.signal.aborted) setError(`保存未确认，当前内容仍保留。${cause instanceof Error ? cause.message : '请重试或重新读取草稿。'}`)
    } finally { if (!controller.signal.aborted) setSaving(false) }
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
    previewAbort.current?.abort(); setResult(undefined); setQuoteResult(undefined); setError('')
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
  const quote = async () => {
    const draft = draftState?.draft
    if (busy || !draft || savedEpoch !== epoch.current || !sourceAccepted) return
    previewAbort.current?.abort(); setResult(undefined); setQuoteResult(undefined); setError('')
    const controller = new AbortController(); previewAbort.current = controller; setBusy(true)
    try {
      const response = await port.referenceVideoQuote({ projectId, ...draft.request,
        draftRevision: draft.revision, draftRequestSha256: draft.requestSha256 }, controller.signal)
      if (!controller.signal.aborted) { setResult(response.preview); setQuoteResult(response) }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '估算失败，请核对已存草稿') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  let images = 0; let audios = 0
  const aliases = new Map(chosen.map((item, index) => [item.bindingToken, item.mediaType === 'reference_image' ? `图${++images}` : item.mediaType === 'reference_audio' ? `音频${++audios}` : `失效素材${index + 1}`]))
  const move = (index: number, delta: number) => {
    const next = [...chosen]; const other = next[index + delta]; const current = next[index]
    if (!other || !current) return
    next[index + delta] = current; next[index] = other
    invalidate(); setChosen(next)
  }

  return <details className={css.workspace}>
    <summary>
      <span className={css.eyebrow}>SHOT REFERENCE DESK</span>
      <span>精确引用 · 导演稿与候选</span>
      <small>人物、场景、声音与镜头意图在同一处确认</small>
    </summary>
    <div className={css.intro}>
      <div>
        <p className={css.kicker}>青木导演工作台</p>
        <h3>镜头 {draftState?.draft ? `· 草稿 v${draftState.draft.revision}` : '· 当前试排'}</h3>
        <p>确认引用、写导演意图、核价后登记候选。已选素材和候选不会自动替换。</p>
      </div>
      <div className={css.sceneStatus} aria-label="当前工作状态">
        <span>{images} 张图</span><span>{audios} 段音色</span><span>{draftState?.draft ? `草稿 v${draftState.draft.revision}` : '未保存'}</span>
      </div>
    </div>
    <section className={css.draftBar} aria-label="草稿操作">
      <button type="button" disabled={saving} onClick={() => { void restore() }}>恢复已存草稿（替换当前试排）</button>
      <button className={css.primaryAction} type="button" disabled={saving || !draftState || !sourceAccepted || Boolean(draftState.draft && !draftLoaded) || chosen.length === 0 || chosen.some(item => item.mediaType === 'unavailable' || !item.label.trim())} onClick={() => { void save() }}>{saving ? '保存草稿…' : '保存引用草稿'}</button>
      <p role="status">{draftMessage}</p>
    </section>
    {!sourceAccepted && <p role="alert">镜头在上次保存后已变化，请核对当前描述和素材。
      <button type="button" onClick={() => { setSourceAccepted(true); invalidate() }}>基于当前镜头继续编辑</button>
    </p>}
    {chosen.some(item => item.mediaType === 'unavailable') && <p role="alert">部分素材已删除或版本已变化，请移除失效引用并重新选择。</p>}
    <div className={css.workbench}>
      <section className={css.referenceShelf} aria-label="参考素材">
        <div className={css.sectionHeading}>
          <div><p className={css.kicker}>REFERENCE LIBRARY</p><h4>参考素材</h4></div>
          <button type="button" disabled={loading || (page > 0 && page >= pages)} onClick={() => { void loadAssets() }}>
            {loading ? '读取素材…' : page === 0 ? '读取项目素材' : page < pages ? '更多素材' : '素材已读完'}
          </button>
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
      </section>
      <section className={css.directorDesk} aria-label="导演描述与参数">
        <div className={css.sectionHeading}><div><p className={css.kicker}>DIRECTOR'S NOTE</p><h4>视频描述</h4></div>
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
        <div className={css.parameters}>
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
        <div className={css.previewActions}>
          <button type="button" disabled={busy || images === 0 || chosen.some(item => item.mediaType === 'unavailable' || !item.label.trim())} onClick={() => { void preview() }}>{busy ? '核对素材与请求…' : '预览实际请求'}</button>
          <button className={css.primaryAction} type="button" disabled={busy || saving || !draftState?.draft || savedEpoch !== epoch.current || !sourceAccepted} onClick={() => { void quote() }}>估算已存草稿费用</button>
        </div>
        {quoteResult && <p className={css.quote} role="status">目录价估算 ¥{Number(quoteResult.cost.estimatedCny).toFixed(2)} · 1 个视频 · {quoteResult.cost.billableSeconds} 秒。
          未扣费；未计账户折扣，实际结算以阿里账单为准。<a href={quoteResult.cost.sourceUrl} target="_blank" rel="noreferrer">查看价格</a></p>}
      </section>
      <aside className={css.previewColumn} aria-label="镜头预览与候选">
        <div className={css.previewPlaceholder}>
          <p className={css.kicker}>SHOT PREVIEW</p><h4>{result ? '请求已核对' : '候选预览区'}</h4>
          <p>{result ? '这次请求的引用与参数已核对。生成后视频会在下方等待你审看。' : '保存并核价后，在这里查看候选视频。'}</p>
        </div>
        {result && <section className={css.requestPreview} aria-label="阿里请求预览" aria-live="polite">
          <p className={css.kicker}>REQUEST PREVIEW</p><h4>将发送的描述</h4><p className={css.compiled}>{result.body.input.prompt}</p>
          <p>{result.body.parameters.duration} 秒 · {result.body.parameters.resolution} · {result.body.parameters.ratio}
            {' · '}音色合计 {result.referenceAudioDurationSec} 秒</p>
          <p className={css.note}>这是当前核对的请求。生成进度见候选视频区。</p>
          <details><summary>查看引用版本与完整请求</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
        </section>}
        <ReferenceVideoRuns projectId={projectId} frameId={frameId} quote={quoteResult} port={port} />
      </aside>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className={css.note}>引用草稿按镜头保存。刷新后可恢复已保存内容；保存不会采用素材或启动生成。</p>
  </details>
}
