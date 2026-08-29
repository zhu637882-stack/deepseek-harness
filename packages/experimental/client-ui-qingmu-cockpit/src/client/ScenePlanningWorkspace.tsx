/** Script-to-scene planning over canonical Yimeng reads and durable commands. */
import { useEffect, useRef, useState } from 'react'
import type { PlanningBase, PlanningShot, ScenePlanningRequest, ScenePlanningState, ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorProposalItem, DirectorReplayProposal } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import css from './ScenePlanningWorkspace.module.css'

interface LocalPlan {
  activeIndex?: number
  sceneIndex: number
  shots: PlanningShot[]
  base: PlanningBase
  shotIds: string[]
  dirty: boolean
  pending?: ScenePlanningRequest
}
const labels = { title: '镜头名称', narrative: '叙事目的', visual: '画面描述', action: '动作与表演' } as const
function base(state: ScenePlanningState, sceneIndex: number): PlanningBase {
  if (state.scriptSha256 === null) throw new Error('请先保存剧本')
  return { sceneIndex, expectedScriptRevision: state.scriptRevision, expectedScriptSha256: state.scriptSha256,
    expectedStoryboardRevision: state.storyboard?.version ?? 0, expectedStoryboardSha256: state.storyboard?.sourceHash ?? null }
}
function saved(state: ScenePlanningState): LocalPlan | null {
  const p = state.planning
  return p === null ? null : { sceneIndex: p.sceneIndex, base: base(state, p.sceneIndex),
    shots: p.shots.map(({ id: _id, ...shot }) => shot), shotIds: p.shots.map(s => s.id), dirty: false }
}
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|token|authentication/i.test(message)) return '会话已过期，请运行 qingmu-local.py login，再读取恢复。输入已保留，不会自动重发。'
  if (/403|forbidden/.test(message)) return '当前身份无权操作此项目。输入已保留，请核对本地登录身份。'
  if (/409|conflict|mismatch/.test(message)) return '剧本或分镜版本发生冲突。输入已保留，请读取恢复，核对来源后再处理。'
  return `未能确认结果。输入已保留，请先读取恢复。${message}`
}

/** One source scene and bounded shot editor, with explicit structural-only save.
 * @param props - Canonical scope and existing Host command port.
 * @returns Three-column planning workspace; never creates prompts, media or approval.
 */
export function ScenePlanningWorkspace({ projectId, episodeId, port, onUnsavedChange, onCommitted, onSelectShotId }: {
  readonly projectId: string
  readonly episodeId: string
  readonly port: Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning' | 'requestDirectorProposal' | 'checkDirectorProposalFreshness'>
  readonly onUnsavedChange: (dirty: boolean) => void
  readonly onCommitted: () => Promise<unknown>
  readonly onSelectShotId: (id: string) => void
}) {
  const key = `qingmu.scene-planning.v1:${projectId}:${episodeId}`
  const [state, setState] = useState<ScenePlanningState | null>(null)
  const [local, setLocal] = useState<LocalPlan | null>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as LocalPlan | null } catch { return null }
  })
  const [retained, setRetained] = useState<LocalPlan | null>(() => {
    try { return JSON.parse(localStorage.getItem(`${key}:retained-input`) ?? 'null') as LocalPlan | null } catch { return null }
  })
  const [sceneIndex, setSceneIndex] = useState(local?.sceneIndex ?? 1)
  const [index, setIndex] = useState(local?.activeIndex ?? 0)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ScenePlanningResult | null>(null)
  const [proposal, setProposal] = useState<DirectorReplayProposal | null>(null)
  const [ignoredProposalItems, setIgnoredProposalItems] = useState<readonly string[]>([])
  const [adoptedProposalItems, setAdoptedProposalItems] = useState<readonly string[]>([])
  const [proposalBusy, setProposalBusy] = useState(false)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const [recoveryRead, setRecoveryRead] = useState(false)
  const lock = useRef(false)
  const live = useRef(true)
  const isLive = (): boolean => live.current
  const controller = useRef(new AbortController())
  useEffect(() => {
    live.current = true; controller.current = new AbortController()
    return () => { live.current = false; controller.current.abort() }
  }, [])
  const update = (next: LocalPlan | null) => {
    try {
      if (next === null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(next))
      setLocal(next); setPreview(false)
    } catch { setError('浏览器不能保存恢复标记，请允许本地存储后再操作。') }
  }
  useEffect(() => {
    let active = true
    void port.readScenePlanning({ projectId, episodeId }).then((next) => {
      if (!active) return
      setState(next)
      if (local === null) { const plan = saved(next); setLocal(plan); setSceneIndex(plan?.sceneIndex ?? 1) }
    }).catch((e: unknown) => { if (active) setError(errorText(e)) })
    return () => { active = false }
    // Scope remounts this workspace; initial hydration must not replace local edits.
  }, [projectId, episodeId, port])
  useEffect(() => {
    const dirty = Boolean(local?.dirty || local?.pending)
    onUnsavedChange(dirty)
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => { window.removeEventListener('beforeunload', prevent); onUnsavedChange(false) }
  }, [local, onUnsavedChange])
  const scene = state?.scenes.find(s => s.sceneIndex === (local?.sceneIndex ?? sceneIndex))
  const current = local?.shots[index]
  const begin = () => {
    if (!state || !scene) return
    const shots = [0, 1].map(i => ({ title: `镜头 ${i + 1}`, narrative: '', visual: '', action: i === 0 ? scene.actionDescription : '',
      durationSec: 3, dialogueLineIds: scene.dialogues.filter((_, n) => n % 2 === i).map(d => d.sourceLineId) }))
    update({ sceneIndex, shots, base: base(state, sceneIndex), shotIds: [], dirty: true })
  }
  const change = (shot: PlanningShot) => {
    if (local) update({ ...local, activeIndex: index, dirty: true, shots: local.shots.map((s, i) => i === index ? shot : s) })
  }
  const requestProposal = async () => {
    const shotId = local?.shotIds[index]
    if (!state?.planning || !shotId || proposalBusy) return
    setProposalBusy(true); setError('')
    try {
      const result = await port.requestDirectorProposal({ projectId, episodeId,
        sceneId: state.planning.sceneId, shotId, suggestionType: 'text_director_proposal' }, controller.current.signal)
      if (!isLive()) return
      setProposal(result); setIgnoredProposalItems([]); setAdoptedProposalItems([])
    } catch (e) {
      if (isLive()) setError(`演练建议暂不可用；人工编辑不受影响。${errorText(e)}`)
    } finally { if (isLive()) setProposalBusy(false) }
  }
  const adoptProposalItem = (item: DirectorProposalItem) => {
    if (!local || !current || !proposal || proposal.stale) return
    if (current[item.field] !== item.originalValue) {
      setError('当前草稿已变化，此建议不能直接采用。请重新读取建议；人工输入已保留。')
      return
    }
    if (item.field === 'durationSec') {
      if (typeof item.proposedValue !== 'number') return
      change({ ...current, durationSec: item.proposedValue })
    } else {
      if (typeof item.proposedValue !== 'string') return
      change({ ...current, [item.field]: item.proposedValue })
    }
    setAdoptedProposalItems(items => [...new Set([...items, item.id])])
  }
  const finish = async (result: ScenePlanningResult) => {
    if (!isLive()) return
    setReceipt(result)
    const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
    if (!isLive()) return
    setState(next); update(saved(next)); setRetryAllowed(false); setRecoveryRead(false)
    await onCommitted()
    if (!isLive()) return
    const selected = result.shotIds[index]
    if (selected) onSelectShotId(selected)
  }
  const run = async (recover: boolean) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (recover) {
        if (local?.pending) await finish(await port.recoverScenePlanning(local.pending, controller.current.signal))
        else {
          const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
          if (!isLive()) return
          setState(next)
          if (!local?.dirty) update(saved(next))
        }
      } else if (local && current) {
        const shotId = local.shotIds[index]
        if (local.shotIds.length > 0 && !shotId) throw new Error('当前镜头身份缺失，请读取恢复。')
        if (shotId && proposal && adoptedProposalItems.length > 0) {
          const freshness = await port.checkDirectorProposalFreshness({ projectId, episodeId,
            sceneId: proposal.sceneId, shotId, contextSnapshotSha256: proposal.inputSha256,
            methodPackageVersion: proposal.methodPackage.version,
            methodPackageSha256: proposal.methodPackage.methodPackageSha256,
            workOrderId: proposal.workOrder.workOrderId,
            workOrderSha256: proposal.workOrder.workOrderSha256,
            promptSha256: proposal.workOrder.promptSha256,
            proposalId: proposal.proposalId, proposalSha256: proposal.proposalSha256,
            outputSha256: proposal.outputSha256 }, controller.current.signal)
          if (!freshness.fresh) {
            throw new Error('409 director_proposal_stale')
          }
        }
        const intent: ScenePlanningRequest = local.pending ?? { projectId, episodeId, idempotencyKey: crypto.randomUUID(),
          request: shotId ? { ...local.base, action: 'edit', shotId, shot: current }
            : { ...local.base, action: 'initialize', shots: local.shots } }
        // Persist the exact intent before transmitting, so unknown outcomes are recoverable.
        localStorage.setItem(key, JSON.stringify({ ...local, pending: intent }))
        setLocal({ ...local, pending: intent })
        await finish(await port.saveScenePlanning(intent, controller.current.signal))
      }
    } catch (e) {
      if (!isLive()) return
      setError(errorText(e))
      if (recover && /404|planning_receipt_not_found/.test(String(e))) {
        setRetryAllowed(true)
        try {
          const next = await port.readScenePlanning({ projectId, episodeId }, controller.current.signal)
          if (!isLive()) return
          setState(next); setRecoveryRead(true)
        } catch (readError) { if (isLive()) { setRecoveryRead(false); setError(errorText(readError)) } }
      }
    } finally { lock.current = false; if (isLive()) setBusy(false) }
  }
  const select = (next: number) => {
    if (local?.shotIds.length && local.dirty) { setError('请先保存当前镜头再切换；当前修改已保留。'); return }
    if (local) update({ ...local, activeIndex: next })
    setIndex(next); setPreview(false)
  }
  const canRebase = Boolean(local?.pending && retryAllowed && recoveryRead && state
    && state.scriptSha256 === local.base.expectedScriptSha256
    && ((state.planning && local.shotIds[index] === state.planning.shots[index]?.id)
      || (state.storyboard === null && local.shotIds.length === 0)))
  return <section className={css.workspace} aria-label="场景与镜头规划">
    <nav className={css.navigation} aria-label="剧本场景与规划镜头">
      <h3>场景与镜头</h3>
      {state?.scenes.map(s => <button type="button" key={s.sceneIndex} aria-pressed={s.sceneIndex === (local?.sceneIndex ?? sceneIndex)}
        disabled={Boolean(local) || busy} onClick={() => { setSceneIndex(s.sceneIndex) }}>{s.title}</button>)}
      {local?.shots.map((s, i) => <button type="button" key={local.shotIds[i] ?? i} aria-pressed={i === index}
        disabled={busy || Boolean(local.pending)} onClick={() => { select(i) }}>{String(i + 1).padStart(2, '0')} · {s.title}<small>{s.durationSec} 秒 · 规划镜头</small></button>)}
    </nav>
    <main className={css.content}>
      <header><small>导演入场 · 结构规划</small><h2>{scene?.title ?? '从已保存剧本建立镜头'}</h2>
        <p>只保存本场文本实体与规划镜头，不生成媒体，不批准内容。</p></header>
      {error && <p role="alert" className={css.notice}>{error}</p>}
      <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void run(true) }}>读取恢复</button>
        {local?.pending && retryAllowed && <button type="button" disabled={busy || canRebase} onClick={() => { void run(false) }}>重试原保存</button>}
        {canRebase && <button type="button" onClick={() => {
          if (!local || !state || !current) return
          const latest = saved(state)
          if (latest) update({ ...latest, activeIndex: index, dirty: true, shots: latest.shots.map((s, i) => i === index ? current : s) })
          else { const { pending: _pending, ...editable } = local; update({ ...editable, base: base(state, local.sceneIndex) }) }
          setRetryAllowed(false); setRecoveryRead(false); setError('已保留文字并读取最新分镜；请重新预览，确认差异后保存。')
        }}>保留文字，按最新分镜重新准备</button>}</div>
      {local?.pending && retryAllowed && recoveryRead && state?.planning && local.shotIds.length === 0 && <button type="button" onClick={() => {
        if (!state.planning) return
        if (!window.confirm('另一份分镜已存在。保留本次未提交文字副本并载入已有镜头？不会把本次文字覆盖到服务器。')) return
        try {
          localStorage.setItem(`${key}:retained-input`, JSON.stringify(local))
          setRetained(local); update(saved(state)); setIndex(0); setSceneIndex(state.planning.sceneIndex)
          setRetryAllowed(false); setRecoveryRead(false); setError('已载入现有镜头。原输入保留在下方“冲突输入副本”，未重发或覆盖服务器。')
        } catch { setError('无法保留冲突输入副本；未离开当前编辑。请先复制文字。') }
      }}>保留输入副本，载入已存在镜头</button>}
      {!state?.scenes.length && <p>尚无可规划场景。请先到“剧本与资产”确认导入并保存剧本。</p>}
      {scene && <details open={!local}><summary>已保存原文 · 只读对照</summary><p>{scene.actionDescription || '原文未提供动作描述'}</p>
        {scene.dialogues.map(d => <p key={d.sourceLineId}><strong>{d.character}</strong>：{d.line}</p>)}</details>}
      {scene && local === null && state?.storyboard === null && <><p>初始提供两个空白规划卡；动作来自原文，对白初始分配需你核对，其他字段由你填写。</p>
        <button type="button" className={css.primary} onClick={begin}>建立本场镜头</button></>}
      {state?.storyboard && local === null && <p>本集已有分镜；此入口不覆盖已有对象，请使用当前导演工作区。</p>}
      {local && current && <fieldset disabled={busy || Boolean(local.pending)} className={css.editor}>
        <legend>镜头 {index + 1} · {local.shotIds.length ? '编辑已保存规划' : '尚未保存'}</legend>
        {(Object.keys(labels) as (keyof typeof labels)[]).map(field => <label key={field}>{labels[field]}
          <textarea aria-label={labels[field]} rows={field === 'title' ? 1 : 2} maxLength={field === 'title' ? 120 : 2000} value={current[field]}
            onChange={(e) => { change({ ...current, [field]: e.target.value }) }} /></label>)}
        <label>规划时长（秒）<input aria-label="规划时长（秒）" type="number" min="0.5" max="30" step="0.5" value={current.durationSec}
          onChange={(e) => { change({ ...current, durationSec: Number(e.target.value) }) }} /></label>
        <div><h3>对白分配</h3><p>保留原文与来源行；此处未核验语音时序。</p>
          {scene?.dialogues.map(d => <label key={d.sourceLineId} className={css.dialogue}>{d.character}：{d.line}
            <select aria-label={`分配对白 ${d.character} ${d.line}`} value={local.shots.findIndex(s => s.dialogueLineIds.includes(d.sourceLineId))}
              disabled={local.shotIds.length > 0} onChange={(e) => {
                const target = Number(e.target.value)
                update({ ...local, dirty: true, shots: local.shots.map((s, i) => ({ ...s,
                  dialogueLineIds: [...s.dialogueLineIds.filter(id => id !== d.sourceLineId),
                    ...(i === target ? [d.sourceLineId] : [])] })) })
              }}>{local.shots.map((_, i) => <option key={i} value={i}>镜头 {i + 1}</option>)}</select></label>)}
        </div>
        {!local.shotIds.length && <button type="button" disabled={local.shots.length >= 8} onClick={() => {
          update({ ...local, shots: [...local.shots, { title: `镜头 ${local.shots.length + 1}`,
            narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }], dirty: true })
        }}>增加镜头（最多 8 个）</button>}
        <button type="button" disabled={!local.dirty || local.shots.some(s => !s.title.trim() || s.durationSec < 0.5 || s.durationSec > 30)} onClick={() => { setPreview(true) }}>预览保存影响</button>
      </fieldset>}
      {local?.shotIds[index] && current && <section className={css.proposal} aria-label="演练建议（非模型生成）">
        <header><div><small>Harness/DSh · replay-only · 非模型生成</small><h3>演练建议（非模型生成）</h3></div>
          <button type="button" disabled={proposalBusy || busy || Boolean(local.pending) || local.dirty}
            onClick={() => { void requestProposal() }}>{proposalBusy ? '正在读取…' : '读取演练建议'}</button></header>
        <p>建议只作创意参考，尚未成为正式质检、参考选择、Ready 或人工决定。人工编辑始终可用。</p>
        {local.dirty && proposal === null && <p>请先保存或恢复当前草稿，再基于同一来源版本读取建议。</p>}
        {proposal?.stale && <p role="alert">来源已变化，这份建议已过期，不能采用。请保存或恢复后重新读取。</p>}
        {proposal?.items.filter(item => !ignoredProposalItems.includes(item.id)).map(item =>
          <article key={item.id} className={css.proposalCard}>
            <dl><dt>原值</dt><dd>{String(item.originalValue) || '（空）'}</dd>
              <dt>演练建议</dt><dd>{String(item.proposedValue) || '（空）'}</dd>
              <dt>影响</dt><dd>{item.impact}</dd></dl>
            <div className={css.actions}>
              <button type="button" disabled={proposal.stale || adoptedProposalItems.includes(item.id)}
                onClick={() => { adoptProposalItem(item) }}>{adoptedProposalItems.includes(item.id) ? '已放入草稿' : '采用到草稿'}</button>
              <button type="button" disabled={adoptedProposalItems.includes(item.id)}
                onClick={() => { setIgnoredProposalItems(items => [...new Set([...items, item.id])]) }}>忽略</button>
            </div>
          </article>)}
        {adoptedProposalItems.length > 0 && <button type="button" onClick={() => {
          setProposal(null); setAdoptedProposalItems([]); setIgnoredProposalItems([])
          setError('已保留当前文字并转为人工草稿；后续保存不再沿用这份 replay 建议证明。')
        }}>保留文字，转为人工草稿</button>}
        {proposal && <details><summary>方法、演练声明与 SHA</summary><pre>{JSON.stringify({
          proposalId: proposal.proposalId, execution: proposal.execution, sourceTime: proposal.sourceTime,
          inputSha256: proposal.inputSha256, outputSha256: proposal.outputSha256,
          proposalSha256: proposal.proposalSha256, workOrder: proposal.workOrder,
          methodPackageSha256: proposal.methodPackage.methodPackageSha256,
        }, null, 2)}</pre></details>}
      </section>}
      {preview && local && <section className={css.notice} aria-label="规划保存预览"><h3>保存影响</h3>
        <p>{local.shotIds.length ? '仅修改当前镜头，生成新的结构快照；旧依赖按现有规则失效。' : `新建 1 个真实场景、${new Set(scene?.dialogues.map(d => d.character)).size} 个独立文本人物和 ${local.shots.length} 个规划镜头。不同场景的同名人物不会静默合并。`}</p>
        {(local.shotIds.length ? [index] : local.shots.map((_, i) => i)).map(i => <article key={i}>
          <h4>{local.shots[i]?.title}</h4><p>{(Object.keys(labels) as (keyof typeof labels)[]).map(k =>
            `${labels[k]}：${state?.planning?.shots[i]?.[k] ?? '（无）'} → ${local.shots[i]?.[k] || '（未填写）'}`).join('\n')}</p>
          <p>时长：{local.shots[i]?.durationSec} 秒；对白：{local.shots[i]?.dialogueLineIds.length} 行</p></article>)}
        <p>不改原剧本，不创建 PromptIR、参考图、Take、制作任务或批准。结构 Ready 不代表内容已审。</p>
        <button type="button" className={css.primary} disabled={busy} onClick={() => { void run(false) }}>确认保存规划</button>
      </section>}
      {receipt && <p role="status">规划已保存 · 结构版本 {receipt.storyboard.version}。参考媒体与 PromptIR 尚未就绪。</p>}
      <details><summary>来源、版本与原回执</summary><pre>{JSON.stringify({ source: state?.planning?.source,
        storyboard: state?.storyboard, receipt, unsubmittedInput: local?.dirty ? local.shots : undefined }, null, 2)}</pre></details>
      {retained && <details><summary>冲突输入副本 · 仅本浏览器，未提交</summary><pre>{JSON.stringify(retained.shots, null, 2)}</pre></details>}
    </main>
    <aside className={css.properties}><details open><summary>导演属性与缺口</summary><p>规划对象，不是已审内容。</p>
      <dl><dt>当前镜头</dt><dd>{current?.title ?? '尚未建立'}</dd><dt>分镜结构版本</dt><dd>{state?.storyboard?.version ?? '尚无'}</dd>
        <dt>参考媒体</dt><dd>本入口不创建参考；拍摄条件另行核验</dd><dt>PromptIR</dt><dd>本片不创建有效提示词</dd><dt>对白时序</dt><dd>未核验</dd></dl>
      <p>未提交输入保留在本浏览器；已保存内容和回执由易梦持久化。清空浏览器只可恢复已提交内容。</p></details></aside>
  </section>
}
