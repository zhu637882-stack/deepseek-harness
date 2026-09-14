/** Native episode preparation followed by one submission action for the ready shots. */
import { useEffect, useRef, useState } from 'react'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { ReferenceVideoQuoteResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'
import { collectBatchShot, hasBatchRun, parseBatchChoices, prepareBatchShot, readBatchBasis, submitBatchShot, type BatchBasis, type BatchPort } from './reference-video-batch.ts'

/** Prepare shared sources once, retain existing shots, and queue all ready videos without waiting for each render. */
export function ReferenceVideoBatch({ projectId, episodeId, relations, port, storyPort, onOpenShot, aspectRatio }: {
  readonly projectId: string
  readonly episodeId: string
  readonly aspectRatio: string
  readonly relations: YimengShotRelationsProjection
  readonly port: BatchPort
  readonly storyPort?: NativeStoryPort | undefined
  readonly onOpenShot: (frameId: string) => void
}) {
  const [basis, setBasis] = useState<BatchBasis>()
  const [quotes, setQuotes] = useState<ReadonlyMap<string, ReferenceVideoQuoteResponse>>(new Map())
  const [messages, setMessages] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const active = useRef(true), lock = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const isActive = () => active.current
  const mark = (id: string, message: string) => { if (isActive()) setMessages(previous => new Map(previous).set(id, message)) }
  async function read() {
    if (lock.current || relations.projectId !== projectId) return
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await readBatchBasis(port, projectId, relations.shots.map(shot => ({
        frameId: shot.shotId, label: `镜${shot.frameNo} · ${shot.title ?? ''}`, duration: shot.durationSec,
      })))
      if (!isActive()) return
      setBasis(result); setQuotes(new Map())
      setMessages(new Map(result.shots.map(shot => [shot.frameId, hasBatchRun(shot)
        ? `已有任务：${shot.runs[0]?.publicStatus ?? ''}` : shot.saved.draft ? '已有生成草稿，可准备' : '等待导演配置引用'])))
    } catch (cause) { if (isActive()) setError(String(cause)) }
    finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function prepare(text?: string) {
    if (lock.current || !basis) return
    const choices = text === undefined ? [] : parseBatchChoices(text, basis)
    lock.current = true; setBusy(true); setError('')
    try {
      for (const shot of basis.shots) {
        if (!isActive()) break
        if (hasBatchRun(shot)) continue
        const request = choices.find(item => item.frameId === shot.frameId)
        if (!request && !shot.saved.draft) continue
        mark(shot.frameId, '正在保存引用并准备生成')
        try {
          const quote = await prepareBatchShot(port, projectId, shot, request)
          if (isActive()) setQuotes(previous => new Map(previous).set(shot.frameId, quote))
          mark(shot.frameId, quote.generationSubmissionEnabled ? '已准备' : '生成通道不可用')
        } catch (cause) { mark(shot.frameId, String(cause)) }
      }
    } finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function submit() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      for (const [id, quote] of quotes) {
        if (!quote.generationSubmissionEnabled) continue
        if (!isActive()) break
        mark(id, '正在提交')
        try {
          const run = await submitBatchShot(port, quote, sessionStorage)
          mark(id, `已进入生成队列：${run.publicStatus}`)
          if (isActive()) setQuotes((previous) => { const next = new Map(previous); next.delete(id); return next })
        } catch (cause) { mark(id, String(cause)) }
      }
    } finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function collect() {
    if (lock.current || !basis) return
    lock.current = true; setBusy(true)
    try {
      for (const shot of basis.shots) {
        if (!isActive()) break
        try {
          const count = await collectBatchShot(port, projectId, shot.frameId)
          if (count) mark(shot.frameId, `${count} 条视频已进入本镜候选审看`)
        } catch (cause) { mark(shot.frameId, String(cause)) }
      }
    } finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  const missing = basis?.shots.filter(shot => !hasBatchRun(shot) && !shot.saved.draft) ?? []
  const source = JSON.stringify(basis && { shots: missing.map(shot => ({ frameId: shot.frameId, label: shot.label,
    duration: shot.duration, source: shot.saved.directorSource && { sha256: shot.saved.directorSource.sha256,
      generationPrompt: shot.saved.directorSource.generationPrompt } })),
  assets: basis.assets.map(({ browserUrl: _url, ...asset }) => asset) })
  const prompt = `为本集所有待准备镜头统一配置视频引用。实际读取 cinematic-director、prop-asset 以及当前镜头需要的摄影、声音方法，核对真实参考图片。现有完整导演设计已经包含表演、机位、节拍、道具状态及声音，逐镜沿用，不再改写一遍。只选择本镜需要的真实素材，说明具体用途；同一人物、场景和道具跨镜沿用同一有效版本。素材目录中的 selected、审核状态及现有引用仅作依据，实际图片优先；不得以“最新一张”代替审图，已指出错误的图不能引用。产品图只提供产品外观，广告人物或购物界面不进入剧情。人物肖像与空场不能冒充完整首帧。常规多模态引用不写 frameRole；仅完整镜头首尾帧路线才写 first_frame/last_frame，该路线不能混用其他引用。每镜按需要选取引用，不为调用功能而塞满素材。参考视频仅在需要动作或衔接且实际审看合适时使用。没有足够可靠素材时指出具体镜头及原因，不虚构图片、不声称已解决。\n本集画幅：${aspectRatio}。当前来源：${source}\n操作者补充：${notes}\n只在一个 txt 代码块输出 {"shots":[{"frameId":"真实镜头编号","references":[{"assetId":"真实素材编号","purpose":"本镜如何使用它"}],"parameters":{"duration":已保存时长,"resolution":"720P","ratio":"${aspectRatio}","audio":true,"prompt_extend":false}}]}。覆盖提供的全部待准备镜头，保持各镜时长和本集画幅；声音按当前导演设计，不能默认静音。资产 SHA、引用编号及完整导演文本由系统从当前来源装配。不要自行执行镜头写入或生成任务。`
  const ready = [...quotes.values()].filter(quote => quote.generationSubmissionEnabled)
  return <details aria-label="整集批量生成">
    <summary>整集批量生成视频</summary>
    <p>统一准备本集引用，已完成和正在生成的镜头自动保留。准备好的镜头可以一次进入生成队列。</p>
    <button type="button" disabled={busy} onClick={() => { void read() }}>读取整集准备情况</button>
    {error && <p role="alert">{error}</p>}
    {basis && <>
      <label>本次补充<textarea value={notes} onChange={(event) => { setNotes(event.target.value) }} disabled={busy} /></label>
      {missing.length > 0 && storyPort && <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
        source={source} settings="" disabled={busy} onAdopt={prepare} purpose={{ key: 'reference-video-batch', jsonOutput: true,
          title: '整集视频准备', description: '导演统一选择各镜引用，沿用已保存的完整分镜设计。', prompt,
          action: '自动准备整集镜头', adopt: '使用方案并准备整集', adopted: '已处理整集方案，请查看逐镜结果。',
          freshRevision: true, sourceKey: source }} />}
      {missing.length > 0 && !storyPort && <p>导演服务未连接，仍可准备已有草稿。</p>}
      <button type="button"
        disabled={busy || !basis.shots.some(shot => !hasBatchRun(shot) && shot.saved.draft)}
        onClick={() => { void prepare() }}>准备已有镜头草稿</button>
      <ul>{basis.shots.map(shot => <li key={shot.frameId}><button type="button" disabled={busy}
        onClick={() => { onOpenShot(shot.frameId) }}>{shot.label}</button>：{messages.get(shot.frameId)}</li>)}</ul>
      <button type="button" disabled={busy || ready.length === 0} onClick={() => { void submit() }}>
        {busy ? '正在处理…' : `批量生成 ${ready.length} 个已准备镜头`}</button>
      <button type="button" disabled={busy} onClick={() => { void collect() }}>收取已完成视频到审看</button>
      {ready.length > 0 && <small>阿里视频生成 · 每镜一条候选 · 预计 ¥
        {ready.reduce((sum, quote) => sum + Number(quote.cost.estimatedCny), 0).toFixed(2)}</small>}
    </>}
  </details>
}
