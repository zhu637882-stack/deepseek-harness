/** Native episode preparation followed by one submission action for the ready shots. */
import { useEffect, useRef, useState } from 'react'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { ReferenceVideoQuoteResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'
import { referenceSelectionGuidance } from './director-generation-guidance.ts'
import styles from './ReferenceVideoBatch.module.css'
import { collectBatchShot, hasBatchRun, parseBatchChoices, prepareBatchShot, readBatchBasis, submitBatchShot, type BatchBasis, type BatchPort } from './reference-video-batch.ts'

const runLabels = { queued: '等待生成', running: '正在生成', succeeded: '视频已返回，待审看', failed: '生成失败', quarantined: '结果待检查' }

/** Prepare shared sources once, retain existing shots, and queue all ready videos without waiting for each render. */
export function ReferenceVideoBatch({ projectId, episodeId, relations, port, storyPort, onOpenShot, onCollected, aspectRatio }: {
  readonly projectId: string
  readonly episodeId: string
  readonly aspectRatio: string
  readonly relations: YimengShotRelationsProjection
  readonly port: BatchPort
  readonly storyPort?: NativeStoryPort | undefined
  readonly onOpenShot: (frameId: string) => void
  readonly onCollected?: () => Promise<unknown>
}) {
  const [basis, setBasis] = useState<BatchBasis>()
  const [quotes, setQuotes] = useState<ReadonlyMap<string, ReferenceVideoQuoteResponse>>(new Map())
  const [messages, setMessages] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notes, setNotes] = useState('')
  const [progress, setProgress] = useState<{ label: string; done: number; total: number }>()
  const active = useRef(true), lock = useRef(false)
  const collectedCallback = useRef(onCollected)
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  useEffect(() => { collectedCallback.current = onCollected }, [onCollected])
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const shotScope = JSON.stringify(relations.projectId === projectId ? relations.shots.map(shot => ({
    frameId: shot.shotId, label: `镜${shot.frameNo} · ${shot.title ?? ''}`, duration: shot.durationSec,
  })) : [])
  useEffect(() => {
    let disposed = false
    const isDisposed = () => disposed
    let loaded = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const collectedRuns = new Set<string>()
    const shots = JSON.parse(shotScope) as Pick<BatchBasis['shots'][number], 'frameId' | 'label' | 'duration'>[]
    async function refresh(): Promise<void> {
      if (isDisposed() || !shots.length) return
      if (lock.current) { timer = setTimeout(() => { void refresh() }, 5000); return }
      lock.current = true
      setSyncing(true)
      let refreshReview = false
      let pending = false
      try {
        if (!loaded) {
          const result = await readBatchBasis(port, projectId, shots)
          if (isDisposed()) return
          setBasis(result)
          loaded = true
        }
        for (const shot of shots) {
          if (isDisposed()) return
          try {
            const result = await port.referenceVideoRuns({ projectId, frameId: shot.frameId })
            if (isDisposed()) return
            pending ||= result.items.some(run => run.publicStatus === 'queued' || run.publicStatus === 'running')
            const latest = result.items.find(run => run.publicStatus !== 'failed') ?? result.items[0]
            if (latest) setMessages(previous => new Map(previous).set(shot.frameId, runLabels[latest.publicStatus]))
            setBasis(previous => previous && ({ ...previous, shots: previous.shots.map(row => row.frameId === shot.frameId
              ? { ...row, runs: result.items } : row) }))
            const returned = result.items.filter(run => run.publicStatus === 'succeeded' && run.candidates.length > 0
              && !collectedRuns.has(`${shot.frameId}:${run.runId}`))
            if (returned.length) {
              const count = await collectBatchShot(port, projectId, shot.frameId, returned)
              returned.forEach(run => collectedRuns.add(`${shot.frameId}:${run.runId}`))
              if (isDisposed()) return
              if (count) {
                refreshReview = true
                setMessages(previous => new Map(previous).set(shot.frameId, `${count} 条视频已进入本镜候选审看`))
              }
            }
          } catch (cause) {
            pending = true
            if (!isDisposed()) setMessages(previous => new Map(previous).set(shot.frameId, `结果同步未完成：${String(cause)}`))
          }
        }
        if (refreshReview && !isDisposed()) await collectedCallback.current?.()
      } catch (cause) { pending = true; if (!isDisposed()) setError(`进度暂未同步：${String(cause)}`) }
      finally {
        lock.current = false
        if (!isDisposed()) setSyncing(false)
        if (!isDisposed() && pending) timer = setTimeout(() => { void refresh() }, 10000)
      }
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer) }
  }, [port, projectId, episodeId, shotScope, refreshEpoch])
  const isActive = () => active.current
  const mark = (id: string, message: string) => { if (isActive()) setMessages(previous => new Map(previous).set(id, message)) }
  async function read() {
    if (lock.current || relations.projectId !== projectId) return
    lock.current = true; setBusy(true); setError(''); setProgress(undefined)
    try {
      const result = await readBatchBasis(port, projectId, relations.shots.map(shot => ({
        frameId: shot.shotId, label: `镜${shot.frameNo} · ${shot.title ?? ''}`, duration: shot.durationSec,
      })))
      if (!isActive()) return
      setBasis(result); setQuotes(new Map())
      setMessages(new Map(result.shots.map(shot => [shot.frameId, hasBatchRun(shot)
        ? `已有任务：${runLabels[shot.runs.find(run => run.publicStatus !== 'failed')?.publicStatus ?? 'queued']}` : shot.saved.draft ? '已有生成草稿，可准备' : '等待导演配置引用'])))
    } catch (cause) { if (isActive()) setError(String(cause)) }
    finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function prepare(text?: string) {
    if (lock.current || !basis) return
    const choices = text === undefined ? [] : parseBatchChoices(text, basis)
    lock.current = true; setBusy(true); setError('')
    const pending = basis.shots.filter(shot => !hasBatchRun(shot)
      && (shot.saved.draft || choices.some(item => item.frameId === shot.frameId)))
    setProgress({ label: '准备引用', done: 0, total: pending.length })
    try {
      for (const shot of pending) {
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
        finally { if (isActive()) setProgress(previous => previous && ({ ...previous, done: previous.done + 1 })) }
      }
    } finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function submit() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    setProgress({ label: '提交生成', done: 0, total: [...quotes.values()].filter(quote => quote.generationSubmissionEnabled).length })
    try {
      for (const [id, quote] of quotes) {
        if (!quote.generationSubmissionEnabled) continue
        if (!isActive()) break
        mark(id, '正在提交')
        try {
          const run = await submitBatchShot(port, quote, sessionStorage)
          mark(id, `已进入生成队列：${runLabels[run.publicStatus]}`)
          if (isActive()) setQuotes((previous) => { const next = new Map(previous); next.delete(id); return next })
        } catch (cause) { mark(id, String(cause)) }
        finally { if (isActive()) setProgress(previous => previous && ({ ...previous, done: previous.done + 1 })) }
      }
    } finally { lock.current = false; if (isActive()) { setBusy(false); setRefreshEpoch(value => value + 1) } }
  }
  async function collect() {
    if (lock.current || !basis) return
    lock.current = true; setBusy(true); setError('')
    let collected = false
    setProgress({ label: '收取结果', done: 0, total: basis.shots.length })
    try {
      for (const shot of basis.shots) {
        if (!isActive()) break
        try {
          const count = await collectBatchShot(port, projectId, shot.frameId)
          if (count) {
            collected = true
            mark(shot.frameId, `${count} 条视频已进入本镜候选审看`)
          }
        } catch (cause) { mark(shot.frameId, String(cause)) }
        finally { if (isActive()) setProgress(previous => previous && ({ ...previous, done: previous.done + 1 })) }
      }
      if (collected && isActive()) await onCollected?.()
    } catch (cause) { if (isActive()) setError(`视频已收取，审看列表刷新失败：${String(cause)}`) }
    finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  const missing = basis?.shots.filter(shot => !hasBatchRun(shot) && !shot.saved.draft) ?? []
  const source = JSON.stringify(basis && { shots: basis.shots.map(shot => ({ frameId: shot.frameId, label: shot.label,
    needsPreparation: !hasBatchRun(shot) && !shot.saved.draft,
    duration: shot.duration, source: shot.saved.directorSource && { sha256: shot.saved.directorSource.sha256,
      generationPrompt: shot.saved.directorSource.generationPrompt } })),
  // Keep the selection catalog compact; historical image prompts remain available through the asset-reading tools.
  assets: basis.assets.map(({ browserUrl: _url, imageDesign: _history, ...asset }) => asset) })
  const prompt = `为本集所有待准备镜头统一配置视频引用。实际读取 cinematic-director、prop-asset 以及当前镜头需要的摄影、声音方法，核对真实参考图片。来源包含整集镜头：needsPreparation=false 的镜头只用于理解接续，不修改、不重新准备；仅为 needsPreparation=true 的镜头输出方案。先检查已保存设计是否与剧本、前后镜及实际素材相容，再沿用有效设计。发现影响生成的来源冲突时，指出镜头及具体字段，返回场次导演整理来源后再准备，不能用引用用途暗改剧情或把旧稿视为已审通过。${referenceSelectionGuidance}只选择本镜需要的真实素材，说明具体用途；每项引用同时逐字写入目录的 assetId 和 label（输出字段 assetLabel），交稿前按目录核对名称、编号及用途属于同一对象，不能把产品、册子或不同角色的编号串用；同一人物、场景和道具跨镜沿用同一有效版本。素材目录中的 selected、审核状态及现有引用仅作依据，实际图片优先；不得以“最新一张”代替审图，已指出错误的图不能引用。产品图只提供产品外观，广告人物或购物界面不进入剧情。人物肖像与空场不能冒充完整首帧。常规多模态引用不写 frameRole；仅完整镜头首尾帧路线才写 first_frame/last_frame，该路线不能混用其他引用。每镜按需要选取引用，不为调用功能而塞满素材。音色参考最多5段、每段1–15秒、总长不超过15秒；多人对白优先使用目录中对应人物的同源3秒音色样本，完整试听音频仍保留，不把样本台词当本镜对白，也不为满足长度而丢掉需要的说话人音色。参考视频仅在需要动作或衔接且实际审看合适时使用。没有足够可靠素材时指出具体镜头及原因，不虚构图片、不声称已解决。\n本集画幅：${aspectRatio}。当前来源：${source}\n操作者补充：${notes}\n只在一个 txt 代码块输出 {"shots":[{"frameId":"真实镜头编号","references":[{"assetId":"真实素材编号","assetLabel":"目录中的原始label","purpose":"本镜如何使用它"}],"parameters":{"duration":已保存时长,"resolution":"720P","ratio":"${aspectRatio}","audio":true,"prompt_extend":false}}]}。仅覆盖 needsPreparation=true 的全部待准备镜头，保持各镜时长和本集画幅；声音按当前导演设计，不能默认静音。资产 SHA、引用编号及完整导演文本由系统从当前来源装配。不要自行执行镜头写入或生成任务。`
  const ready = [...quotes.values()].filter(quote => quote.generationSubmissionEnabled)
  const unavailable = busy || syncing
  return <details aria-label="整集批量生成" className={styles.batch}>
    <summary>整集批量生成视频</summary>
    <p>统一准备本集引用，已完成和正在生成的镜头自动保留。返回的视频自动进入候选审看，重新打开页面会恢复进度。</p>
    <ol className={styles.steps} aria-label="批量制作步骤"><li>准备引用</li><li>批量生成</li><li>查看结果</li></ol>
    <button type="button" disabled={unavailable} onClick={() => { void read() }}>刷新准备情况</button>
    {syncing && <p role="status">正在同步生成进度…</p>}
    {error && <p role="alert">{error}</p>}
    {basis && <>
      <p className={styles.overview}>本集 {basis.shots.length} 镜 · 可生成 {ready.length} 镜</p>
      {progress && <div role="status" className={styles.progress}>
        <span>{progress.label}：已处理 {progress.done} / {progress.total} 镜{busy ? '，请稍候' : '，详见下方结果'}</span>
        <progress aria-label={progress.label} value={progress.done} max={Math.max(1, progress.total)} />
      </div>}
      <label>本次补充<textarea value={notes} onChange={(event) => { setNotes(event.target.value) }} disabled={busy} /></label>
      {missing.length > 0 && storyPort && <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
        source={source} settings="" disabled={unavailable} onAdopt={prepare} purpose={{ key: 'reference-video-batch', jsonOutput: true,
          title: '整集视频准备', description: '导演结合整集接续选择引用，保留已完成镜头。', prompt,
          action: '自动准备整集镜头', adopt: '使用方案并准备整集', adopted: '已处理整集方案，请查看逐镜结果。',
          freshRevision: true, sourceKey: source }} />}
      {missing.length > 0 && !storyPort && <p>导演服务未连接，仍可准备已有草稿。</p>}
      <button type="button"
        disabled={unavailable || !basis.shots.some(shot => !hasBatchRun(shot) && shot.saved.draft)}
        onClick={() => { void prepare() }}>准备已有镜头草稿</button>
      <ul className={styles.results}>{basis.shots.map(shot => <li key={shot.frameId}><button type="button" disabled={busy}
        onClick={() => { onOpenShot(shot.frameId) }}>{shot.label}</button><span>{messages.get(shot.frameId)}</span></li>)}</ul>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={unavailable || ready.length === 0} onClick={() => { void submit() }}>
          {busy ? '正在处理…' : `批量生成 ${ready.length} 个已准备镜头`}</button>
        <button type="button" disabled={unavailable} onClick={() => { void collect() }}>重新同步视频结果</button>
      </div>
      {ready.length > 0 && <small>阿里视频生成 · 每镜一条候选 · 预计 ¥
        {ready.reduce((sum, quote) => sum + Number(quote.cost.estimatedCny), 0).toFixed(2)}</small>}
    </>}
  </details>
}
