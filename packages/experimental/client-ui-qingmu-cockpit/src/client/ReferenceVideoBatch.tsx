import { executionPromptGuidance } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/reference-prompt'
/** Native episode preparation followed by one submission action for the ready shots. */
import { useEffect, useRef, useState } from 'react'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { ReferenceVideoQuoteResponse, YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import { BatchVideoReview } from './BatchVideoReview.tsx'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'
import { referenceSelectionGuidance } from './director-generation-guidance.ts'
import styles from './ReferenceVideoBatch.module.css'
import { reconcileBatchChoices } from './reference-video-batch-repair.ts'
import { batchShotIncluded, batchSubmissionKey, createBatchSubmission, readBatchSubmission, recoverBatchSubmission, withBatchSubmissionLock, hasActiveBatchRun, needsBatchDesign, collectBatchShot, hasBatchRun, prepareBatchShot, readBatchBasis, submitBatchShot, type BatchBasis, type BatchPort, type BatchSubmissionItem } from './reference-video-batch.ts'

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
  const [reviewOpen, setReviewOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const notesKey = `qingmu.reference-video-batch-notes.v1:${projectId}:${episodeId}`
  const readNotes = () => { try { return localStorage.getItem(notesKey) ?? '' } catch { return '' } }
  const [instructions, setInstructions] = useState(() => ({ key: notesKey, text: readNotes() }))
  const notes = instructions.key === notesKey ? instructions.text : readNotes()
  const setNotes = (text: string) => {
    setInstructions({ key: notesKey, text })
    try { localStorage.setItem(notesKey, text) }
    catch { setError('本次补充暂未保存到浏览器，离开前请保留内容。') }
  }
  const retakeKey = `qingmu.reference-video-batch-retakes.v1:${projectId}:${episodeId}`
  const readRetakes = (): ReadonlySet<string> => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(retakeKey) ?? '[]')
      return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
    } catch { return new Set() }
  }
  const [retakeSelection, setRetakeSelection] = useState(() => ({ key: retakeKey, ids: readRetakes() }))
  const retakes = retakeSelection.key === retakeKey ? retakeSelection.ids : readRetakes()
  const setRetakes = (update: (previous: ReadonlySet<string>) => ReadonlySet<string>) => {
    setRetakeSelection(previous => ({ key: retakeKey, ids: update(previous.key === retakeKey ? previous.ids : readRetakes()) }))
  }
  useEffect(() => {
    if (retakeSelection.key !== retakeKey) return
    try { localStorage.setItem(retakeKey, JSON.stringify([...retakeSelection.ids])) }
    catch { setError('本次重做勾选暂未保存，离开前请保留镜头范围。') }
  }, [retakeKey, retakeSelection])
  const [pendingSubmission, setPendingSubmission] = useState<readonly BatchSubmissionItem[]>([])
  const submissionKey = batchSubmissionKey(projectId, episodeId)
  useEffect(() => {
    const recover = () => {
      try { setPendingSubmission(recoverBatchSubmission(localStorage, sessionStorage, projectId, episodeId)) }
      catch (cause) { setError(String(cause)) }
    }
    recover()
    const sync = (event: StorageEvent) => {
      if (event.key !== submissionKey) return
      try { setPendingSubmission(readBatchSubmission(localStorage, projectId, episodeId)) }
      catch (cause) { setError(String(cause)) }
    }
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('storage', sync) }
  }, [projectId, episodeId, submissionKey])
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
    let reviewPending = false
    const shots = JSON.parse(shotScope) as Pick<BatchBasis['shots'][number], 'frameId' | 'label' | 'duration'>[]
    async function refresh(): Promise<void> {
      if (isDisposed() || !shots.length) return
      if (lock.current) { timer = setTimeout(() => { void refresh() }, 5000); return }
      lock.current = true
      setSyncing(true)
      let pending = false
      try {
        if (!loaded) {
          const result = await readBatchBasis(port, projectId, shots, episodeId)
          if (isDisposed()) return
          setBasis(result)
          setExpanded(result.shots.some(shot => !hasBatchRun(shot)))
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
                reviewPending = true
                setMessages(previous => new Map(previous).set(shot.frameId, `${count} 条视频已进入本镜候选审看`))
              }
            }
          } catch (cause) {
            pending = true
            if (!isDisposed()) setMessages(previous => new Map(previous).set(shot.frameId, `结果同步未完成：${String(cause)}`))
          }
        }
        if (reviewPending && !isDisposed()) {
          await collectedCallback.current?.()
          reviewPending = false
          setError('')
        }
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
      })), episodeId)
      if (!isActive()) return
      setBasis(result); setQuotes(new Map())
      setMessages(new Map(result.shots.map(shot => [shot.frameId, hasBatchRun(shot)
        ? `已有任务：${runLabels[shot.runs.find(run => run.publicStatus !== 'failed')?.publicStatus ?? 'queued']}` : shot.saved.draft ? '已有生成草稿，可准备' : '等待导演配置引用'])))
    } catch (cause) { if (isActive()) setError(String(cause)) }
    finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function prepare(text?: string) {
    if (lock.current || !basis) return
    lock.current = true; setBusy(true); setError(''); setQuotes(new Map())
    try {
      setProgress({ label: '协调导演设计', done: 0, total: 1 })
      const prepared = text === undefined ? { basis, requests: [] }
        : await reconcileBatchChoices(port, episodeId, basis, text, retakes, notes)
      if (!isActive()) return
      const pending = prepared.basis.shots.filter(shot => batchShotIncluded(shot, retakes)
        && (!needsBatchDesign(shot, notes) || prepared.requests.some(item => item.frameId === shot.frameId)))
      setProgress({ label: '准备引用', done: 0, total: pending.length })
      let failed = false
      for (const shot of pending) {
        if (!isActive()) break
        const request = prepared.requests.find(item => item.frameId === shot.frameId)
        if (!request && !shot.saved.draft) continue
        mark(shot.frameId, '正在保存引用并准备生成')
        try {
          const quote = await prepareBatchShot(port, projectId, shot, request, Boolean(notes.trim()))
          if (isActive()) setQuotes(previous => new Map(previous).set(shot.frameId, quote))
          mark(shot.frameId, quote.generationSubmissionEnabled ? '已准备' : '生成通道不可用')
        } catch (cause) { failed = true; mark(shot.frameId, String(cause)) }
        finally { if (isActive()) setProgress(previous => previous && ({ ...previous, done: previous.done + 1 })) }
      }
      if (!failed && isActive()) setBasis(prepared.basis)
    } catch (cause) {
      if (isActive()) setError(String(cause))
      throw cause
    } finally { lock.current = false; if (isActive()) setBusy(false) }
  }
  async function submit(resume = false) {
    if (lock.current || !basis) return
    lock.current = true; setBusy(true); setError('')
    try {
      await withBatchSubmissionLock(submissionKey, async () => {
        let remaining = resume ? readBatchSubmission(localStorage, projectId, episodeId)
          : createBatchSubmission([...quotes.values()].filter(quote => quote.generationSubmissionEnabled), basis, retakes, sessionStorage)
        if (!resume && readBatchSubmission(localStorage, projectId, episodeId).length) throw new Error('请先继续上次批量提交。')
        // Keep the whole authorized batch, including commands not reached before navigation or reload.
        localStorage.setItem(submissionKey, JSON.stringify(remaining))
        setPendingSubmission(remaining)
        setProgress({ label: '提交生成', done: 0, total: remaining.length })
        for (const item of [...remaining]) {
          if (!isActive()) break
          const id = item.quote.frameId
          mark(id, '正在提交')
          try {
            const run = await submitBatchShot(port, item.quote, sessionStorage, item)
            remaining = remaining.filter(row => row.command.requestId !== item.command.requestId)
            localStorage.setItem(submissionKey, JSON.stringify(remaining))
            if (isActive()) {
              setPendingSubmission(remaining)
              setRetakes((previous) => { const next = new Set(previous); next.delete(id); return next })
              setQuotes((previous) => { const next = new Map(previous); next.delete(id); return next })
            }
            mark(id, `已进入生成队列：${runLabels[run.publicStatus]}`)
          } catch (cause) { mark(id, String(cause)) }
          finally { if (isActive()) setProgress(previous => previous && ({ ...previous, done: previous.done + 1 })) }
        }
      })
    } catch (cause) { if (isActive()) setError(String(cause)) }
    finally { lock.current = false; if (isActive()) { setBusy(false); setRefreshEpoch(value => value + 1) } }
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
  const missing = basis?.shots.filter(shot => batchShotIncluded(shot, retakes) && needsBatchDesign(shot, notes)) ?? []
  const source = JSON.stringify(basis && { feedback: notes.trim(),
    planning: basis.planning && { scriptRevision: basis.planning.scriptRevision, scriptSha256: basis.planning.scriptSha256,
      storyboard: basis.planning.storyboard },
    shots: basis.shots.map(shot => ({ frameId: shot.frameId, label: shot.label,
      designPage: (basis.planning?.frameRequirements ?? basis.planning?.canonicalStoryboard?.shots ?? [])
        .findIndex(item => item.id === shot.frameId) + 1 || null,
      needsPreparation: batchShotIncluded(shot, retakes) && needsBatchDesign(shot, notes),
      existingReferences: shot.saved.draft?.request.bindings ?? [],
      duration: shot.duration, source: shot.saved.directorSource && { sha256: shot.saved.directorSource.sha256 } })),
    // Keep the selection catalog compact; historical image prompts remain available through the asset-reading tools.
    assets: basis.assets.map(({ browserUrl: _url, imageDesign: _history, ...asset }) => asset) })
  const prompt = `为本集所有待准备镜头统一完成拍摄执行描述与视频引用。本次来源是镜头索引，不含完整设计正文。先按待准备镜头的 designPage 调用 qingmu_read_scene_design，includeVideoSource=true，取得完整设计、当前生成来源与逐字对白；核对 videoSource.directorSource.sha256 与索引一致。按需要读取前后镜页面掌握接续，不从标题猜测表演，也不一次重读所有无关镜头。${executionPromptGuidance}每镜 existingReferences 是当前已保存引用的精确版本，不代表已验收。已有引用时先按 assetId 和 assetSha256 查看该版本的实际图片，再判断保留或替换；同名旧图不能代替当前绑定图，其他候选只是替换备选。版本缺失或确需更换时说明具体依据，不按目录第一张或最新一张默认替换。操作者补充是准备工作的上下文，按镜头分别理解适用范围，不原样发送给视频模型。引用选择意见落实到对应引用用途；涉及表演、调度、机位或声音设计的必要修正，与引用方案一起列入 directorRepairs，由本页采用时先保存来源再准备；不靠用途覆盖旧设计，不改写剧本原话或说话者。已有成片只有明确勾选重做的镜头才进入范围。意见与已存剧情或调度冲突时先指出具体上游来源，不用重复原请求假装修复。实际读取 cinematic-director、prop-asset 以及当前镜头需要的摄影、声音方法，核对真实参考图片。来源包含整集镜头：needsPreparation=false 的镜头只用于理解接续，不修改、不重新准备；仅为 needsPreparation=true 的镜头输出方案。先检查已保存设计是否与剧本、前后镜及实际素材相容，再沿用有效设计。发现影响生成的来源冲突时，读取 qingmu_read_scene_design 对应页与 qingmu_read_asset_design 的当前设定，将有依据的修正整理为 directorRepairs。统一 visual、首帧、imageStage、imageCamera、imageSubjects、blocking、cameraAngle、coveragePlan、generationContext、continuity 等实际涉及处；嵌套值完整提交，未涉及字段省略。保持剧本事实、时长和未纳入范围的镜头；若修订改变相邻接续，需要核对相邻原稿，不偷偷改未选镜头。用空间预览核对相同的演员体块与机位，不能只发现矛盾就照搬旧稿。${referenceSelectionGuidance}只选择本镜需要的真实素材，说明具体用途；每项引用同时逐字写入目录的 assetId 和 label（输出字段 assetLabel），交稿前按目录核对名称、编号及用途属于同一对象，不能把产品、册子或不同角色的编号串用；同一人物、场景和道具跨镜沿用同一有效版本。素材目录中的 selected、审核状态及现有引用仅作依据，实际图片优先；不得以“最新一张”代替审图，已指出错误的图不能引用。同一素材有修正版时，对照原缺陷逐项判断图中实际改变、仍存问题和新增问题；视觉观察报告中的用途或类别推测需与可见结构分开，不能把推测当成已证实缺陷而退回有已知错误的旧版。产品图只提供产品外观，广告人物或购物界面不进入剧情。人物肖像与空场不能冒充完整首帧。常规多模态引用不写 frameRole；仅完整镜头首尾帧路线才写 first_frame/last_frame，该路线不能混用其他引用。每镜按需要选取引用，不为调用功能而塞满素材。音色参考最多5段、每段1–15秒、总长不超过15秒；多人对白优先使用目录中对应人物的同源3秒音色样本，完整试听音频仍保留，不把样本台词当本镜对白，也不为满足长度而丢掉需要的说话人音色。参考视频仅在需要动作或衔接且实际审看合适时使用。没有足够可靠素材时指出具体镜头及原因，不虚构图片、不声称已解决。\n本集画幅：${aspectRatio}。当前来源：${source}\n操作者补充：${notes}\n本次能依据现有来源解决的冲突，输出已协调的完整方案；directorRepairs 可选，格式为 [{"frameId":"本次待准备镜头编号","directorPlan":{"相关创作字段":"完整修订值"},"imagePromptCn":"完整起始画面描述"}]，放在 shots 同级。系统采用时通过普通导演保存接口依次保存这些修订，再按最新来源装配各镜执行稿；候选文字本身不是已经保存。没有修订时省略 directorRepairs。缺少必要素材、剧情决定或涉及未纳入范围的修订而无法自洽时，说明具体缺口，不输出可采用方案，也不要求一律重画场景。朝向与参考不一致时先明确参考贡献的是外观还是构图，不把矛盾全部归咎于模型。执行稿必须对应这份方案修订后的设计。在一个 txt 代码块输出 {"shots":[{"frameId":"真实镜头编号","executionPrompt":"本段可拍摄的完整动作、表演、空间、摄影及声音描述","references":[{"assetId":"真实素材编号","assetLabel":"目录中的原始label","purpose":"本镜如何使用它"}],"parameters":{"duration":已保存时长,"resolution":"720P","ratio":"${aspectRatio}","audio":true,"prompt_extend":false}}]}。仅覆盖 needsPreparation=true 的全部待准备镜头，保持各镜时长和本集画幅；声音按当前导演设计，不能默认静音。资产 SHA、引用编号及当前逐字对白由系统装配；executionPrompt 使用你整理后的拍摄执行描述，整份设计文档不再拼入生成请求。不要自行执行镜头写入或生成任务。`
  const ready = [...quotes.values()].filter(quote => quote.generationSubmissionEnabled)
  const unavailable = busy || syncing
  return <details aria-label="整集批量生成" className={styles.batch}
    open={expanded || pendingSubmission.length > 0} onToggle={(event) => { setExpanded(event.currentTarget.open) }}>
    <summary>整集批量生成视频</summary>
    <p>统一准备本集表演、接续与引用，再批量生成；需要重做时勾选问题镜头，原视频保留。返回的视频自动进入候选审看。</p>
    <ol className={styles.steps} aria-label="批量制作步骤"><li>导演准备</li><li>批量生成</li><li>查看结果</li></ol>
    <button type="button" disabled={unavailable} onClick={() => { void read() }}>刷新准备情况</button>
    {syncing && <p role="status">正在同步生成进度…</p>}
    {error && <p role="alert">{error}</p>}
    {basis && <>
      <p className={styles.overview}>本集 {basis.shots.length} 镜 · 可生成 {ready.length} 镜</p>
      {progress && <div role="status" className={styles.progress}>
        <span>{progress.label}：已处理 {progress.done} / {progress.total} 镜{busy ? '，请稍候' : '，详见下方结果'}</span>
        <progress aria-label={progress.label} value={progress.done} max={Math.max(1, progress.total)} />
      </div>}
      {pendingSubmission.length > 0 && <p role="status">上次还有 {pendingSubmission.length} 镜提交待完成。<button type="button" disabled={unavailable} onClick={() => { void submit(true) }}>继续上次批量提交</button></p>}
      <details><summary>补充要求（可选）</summary>
        <label>本次补充<textarea value={notes} onChange={(event) => { setNotes(event.target.value); setQuotes(new Map()) }}
          disabled={unavailable || pendingSubmission.length > 0} /></label></details>
      {missing.length > 0 && storyPort && <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId}
        source={source} settings="" disabled={unavailable || pendingSubmission.length > 0} onAdopt={prepare} purpose={{ key: 'reference-video-batch', jsonOutput: true,
          title: '整集视频准备', description: '导演统一整理接续、修正冲突并选择引用，保留原视频。', prompt,
          action: '自动准备整集镜头', adopt: '使用方案并准备整集', adopted: '已处理整集方案，请查看逐镜结果。',
          freshRevision: true, sourceKey: source }} />}
      {missing.length > 0 && !storyPort && <p>导演服务未连接，仍可准备已有草稿。</p>}
      <button type="button"
        disabled={unavailable || pendingSubmission.length > 0
          || !basis.shots.some(shot => batchShotIncluded(shot, retakes) && !needsBatchDesign(shot, notes))}
        onClick={() => { void prepare().catch(() => { /* The panel retains the preparation error. */ }) }}>准备已有镜头草稿</button>
      <details><summary>逐镜进度与局部重做</summary><ul className={styles.results}>{basis.shots.map(shot => <li key={shot.frameId}>{shot.runs.some(run => run.publicStatus === 'succeeded') && <label><input type="checkbox" aria-label={`重做${shot.label}`} checked={retakes.has(shot.frameId)}
        disabled={unavailable || pendingSubmission.length > 0 || hasActiveBatchRun(shot)} onChange={(event) => {
          const checked = event.target.checked
          setRetakes((previous) => {
            const next = new Set(previous); if (checked) next.add(shot.frameId); else next.delete(shot.frameId); return next
          })
          setQuotes((previous) => { const next = new Map(previous); next.delete(shot.frameId); return next })
        }} />重做</label>}<button type="button" disabled={busy}
        onClick={() => { onOpenShot(shot.frameId) }}>{shot.label}</button><span>{messages.get(shot.frameId)}</span></li>)}</ul></details>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={unavailable || pendingSubmission.length > 0 || ready.length === 0} onClick={() => { void submit() }}>
          {busy ? '正在处理…' : `批量生成 ${ready.length} 个已准备镜头`}</button>
        <details><summary>刷新视频结果</summary><button type="button" disabled={unavailable} onClick={() => { void collect() }}>重新同步视频结果</button></details>
      </div>
      <details onToggle={(event) => { setReviewOpen(event.currentTarget.open) }}><summary>整集音画检查</summary>
        {reviewOpen && <BatchVideoReview port={port} episodeId={episodeId} basis={basis} onOpenShot={onOpenShot} />}
      </details>
      {ready.length > 0 && <small>阿里视频生成 · 每镜一条候选 · 预计 ¥
        {ready.reduce((sum, quote) => sum + Number(quote.cost.estimatedCny), 0).toFixed(2)}</small>}
    </>}
  </details>
}
