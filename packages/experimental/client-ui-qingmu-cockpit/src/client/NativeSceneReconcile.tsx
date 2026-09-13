/** Whole-scene direction uses native writing and the existing revisioned frame saves. */
import { useEffect, useRef, useState } from 'react'
import type { AssetDesignState, AutomaticPlanningShot, FrameRequirementsOperation, PlanningRevision, ScenePlanningRequest, ScenePlanningState, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import type { QingmuYimengPort } from './contracts.ts'
import { NativeStoryComposer } from './NativeStoryComposer.tsx'
import { generationContextGuidance } from './director-generation-guidance.ts'
import css from './NativeDirectorComposer.module.css'

type Ports = Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning'> & {
  readAssetDesign: NonNullable<QingmuYimengPort['readAssetDesign']>
}
interface Change { shotId: string; imagePromptCn: string; directorPlan: YimengCommandJsonObject; sourceSha256: string }
interface Batch {
  projectId: string
  episodeId: string
  sceneId: string
  scriptRevision: number
  scriptSha256: string
  storyboard: PlanningRevision
  action: FrameRequirementsOperation['action']
  changes: Change[]
  completed: number
  pending?: ScenePlanningRequest
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function validChange(value: unknown): value is Change {
  return object(value) && typeof value.shotId === 'string' && typeof value.imagePromptCn === 'string'
    && value.imagePromptCn.length <= 20000 && object(value.directorPlan)
    && typeof value.directorPlan.generationContext === 'string' && !!value.directorPlan.generationContext.trim()
    && typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256)
}
function restore(key: string, projectId: string, episodeId: string, sceneId: string): Batch | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (object(v) && v.projectId === projectId && v.episodeId === episodeId && v.sceneId === sceneId
      && Number.isInteger(v.scriptRevision) && typeof v.scriptSha256 === 'string'
      && object(v.storyboard) && Number.isInteger(v.storyboard.version) && typeof v.storyboard.sourceHash === 'string'
      && (v.action === 'edit_automatic' || v.action === 'edit_requirements')
      && Array.isArray(v.changes) && v.changes.length > 0 && v.changes.length <= 64 && v.changes.every(validChange)
      && new Set(v.changes.map(c => c.shotId)).size === v.changes.length
      && typeof v.completed === 'number' && Number.isInteger(v.completed) && v.completed >= 0 && v.completed <= v.changes.length
      && (v.pending === undefined || object(v.pending))) return v as unknown as Batch
  } catch { /* Invalid local data cannot resume a save; the native draft remains available. */ }
  return undefined
}

/**
 * Coordinate a saved scene as one director draft, then save its reviewed changes with resumable receipts.
 * @param props Bound episode and scene; saves preserve frame IDs, dialogue ownership and existing media.
 * @returns Whole-scene writing, review and explicit resumable save controls.
 */
export function NativeSceneReconcile({ state, sceneId, port, storyPort, disabled, onSaved }: {
  readonly state: ScenePlanningState
  readonly sceneId: string
  readonly port: Ports
  readonly storyPort: NativeStoryPort
  readonly disabled: boolean
  readonly onSaved: () => Promise<unknown>
}) {
  const { projectId, episodeId } = state
  const key = `qingmu.scene-reconcile.v1:${projectId}:${episodeId}:${sceneId}`
  const [batch, setBatch] = useState(() => restore(key, projectId, episodeId, sceneId))
  const [basis, setBasis] = useState<AssetDesignState>()
  const [notice, setNotice] = useState('')
  const [direction, setDirection] = useState(() => localStorage.getItem(`${key}:direction`) ?? '')
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const lock = useRef(false), controller = useRef(new AbortController())
  const shots = (state.frameRequirements ?? []).filter(shot => shot.sceneId === sceneId)
  useEffect(() => {
    const active = new AbortController(); controller.current = active
    setBasis(undefined)
    void port.readAssetDesign({ projectId, episodeId }, active.signal).then((value) => {
      if (!active.signal.aborted) setBasis(value)
    }).catch((error) => { if (!active.signal.aborted) setNotice(String(error)) })
    return () => { active.abort() }
  }, [projectId, episodeId, sceneId, state.scriptSha256, state.storyboard?.sourceHash, port.readAssetDesign, refresh])
  const persist = (value: Batch) => { localStorage.setItem(key, JSON.stringify(value)); setBatch(value) }
  const ready = basis?.scriptSha256 === state.scriptSha256 && !!state.scriptSha256 && !!state.storyboard
    && (!basis.design || basis.design.sourceScriptSha256 === state.scriptSha256)
    && shots.length > 0 && shots.length <= 64 && shots.every(shot => shot.generationContextSource)
  async function adopt(text: string) {
    if (!ready || !basis || !state.storyboard || !state.scriptSha256) throw new Error('请先读取当前剧本、场景与分镜依据。')
    if (batch && batch.completed < batch.changes.length) throw new Error('本场已有待保存稿，请先接续或明确保留副本后放弃剩余保存。')
    const value: unknown = JSON.parse(text)
    if (!object(value) || value.sceneId !== sceneId || value.sourceScriptSha256 !== state.scriptSha256
      || value.sourceStoryboardSha256 !== state.storyboard.sourceHash || value.sourceAssetStateSha256 !== basis.stateSha256
      || !Array.isArray(value.sourceIssues) || !Array.isArray(value.shots) || value.shots.length !== shots.length) {
      throw new Error('整场导演稿的来源或镜头覆盖不完整，原稿保留。')
    }
    if (value.sourceIssues.length) throw new Error('导演指出共用设定仍有矛盾。请先在素材设计中解决完整稿列出的来源问题，再同步整场；不将冲突分摊到各镜。')
    const changes = value.shots.map((item: unknown, index: number): Change => {
      const original = shots[index]
      if (!original || !object(item) || item.shotId !== original.id || !original.generationContextSource) throw new Error('整场镜头身份或顺序不一致，未采用。')
      const change = { ...item, sourceSha256: original.generationContextSource.sha256 }
      if (!validChange(change)) throw new Error('每镜需提供完整继承设定、首帧文字和受影响的导演字段，原稿保留。')
      return { shotId: change.shotId, imagePromptCn: change.imagePromptCn,
        directorPlan: change.directorPlan, sourceSha256: change.sourceSha256 }
    })
    const signal = controller.current.signal
    const [assets, current] = await Promise.all([
      port.readAssetDesign({ projectId, episodeId }, signal),
      port.readScenePlanning({ projectId, episodeId }, signal),
    ])
    signal.throwIfAborted()
    if (assets.stateSha256 !== basis.stateSha256 || current.scriptSha256 !== state.scriptSha256
      || current.storyboard?.sourceHash !== state.storyboard.sourceHash) throw new Error('创作来源已变化，原导演稿保留；请读取最新依据后重新协调。')
    persist({ projectId, episodeId, sceneId, scriptRevision: state.scriptRevision, scriptSha256: state.scriptSha256,
      storyboard: state.storyboard, action: state.canonicalStoryboard ? 'edit_automatic' : 'edit_requirements', changes, completed: 0 })
  }
  async function save() {
    if (!batch || disabled || lock.current || batch.completed === batch.changes.length) return
    lock.current = true; setBusy(true); setNotice('')
    const signal = controller.current.signal
    let currentBatch = batch
    try {
      while (currentBatch.completed < currentBatch.changes.length) {
        signal.throwIfAborted()
        const change = currentBatch.changes[currentBatch.completed]
        if (!change) throw new Error('本场保存进度缺少对应镜头，原稿保留。')
        if (!currentBatch.pending) {
          const current = await port.readScenePlanning({ projectId, episodeId }, signal)
          const shot = current.frameRequirements?.find(item => item.id === change.shotId)
          if (current.scriptSha256 !== currentBatch.scriptSha256 || current.scriptRevision !== currentBatch.scriptRevision
            || current.storyboard?.sourceHash !== currentBatch.storyboard.sourceHash
            || current.storyboard.version !== currentBatch.storyboard.version
            || shot?.sceneId !== sceneId || shot.generationContextSource?.sha256 !== change.sourceSha256) {
            throw new Error('来源或分镜已变化，已停止剩余保存。已保存镜头保留，请读取最新依据后重新协调剩余设计。')
          }
          const request: FrameRequirementsOperation = { action: currentBatch.action,
            expectedScriptRevision: currentBatch.scriptRevision, expectedScriptSha256: currentBatch.scriptSha256,
            expectedStoryboardRevision: currentBatch.storyboard.version, expectedStoryboardSha256: currentBatch.storyboard.sourceHash,
            shotId: change.shotId, imagePromptCn: change.imagePromptCn, directorPlan: change.directorPlan,
            expectedGenerationContextSourceSha256: change.sourceSha256 }
          currentBatch = { ...currentBatch, pending: { projectId, episodeId, idempotencyKey: crypto.randomUUID(), request } }
          persist(currentBatch)
        }
        const intent = currentBatch.pending
        if (!intent) throw new Error('本场保存请求尚未保留，未发送。')
        if (intent.projectId !== projectId || intent.episodeId !== episodeId || intent.request.action !== currentBatch.action
          || !('shotId' in intent.request) || intent.request.shotId !== change.shotId
          || JSON.stringify(intent.request.directorPlan) !== JSON.stringify(change.directorPlan)
          || intent.request.imagePromptCn !== change.imagePromptCn
          || intent.request.expectedScriptRevision !== currentBatch.scriptRevision
          || intent.request.expectedScriptSha256 !== currentBatch.scriptSha256
          || intent.request.expectedStoryboardRevision !== currentBatch.storyboard.version
          || intent.request.expectedStoryboardSha256 !== currentBatch.storyboard.sourceHash
          || intent.request.expectedGenerationContextSourceSha256 !== change.sourceSha256) throw new Error('保存草稿无法核对，请保留原稿后读取恢复。')
        // An uncertain reply resumes the same idempotent save, never a second creative intent.
        const result = await port.saveScenePlanning(intent, signal)
        if (result.action !== currentBatch.action || !('shotId' in result) || result.shotId !== change.shotId
          || result.projectId !== projectId || result.episodeId !== episodeId
          || result.storyboard.version !== currentBatch.storyboard.version + 1) throw new Error('保存回执不一致，保留同一请求等待恢复。')
        const { pending: _pending, ...settled } = currentBatch
        currentBatch = { ...settled, storyboard: result.storyboard, completed: currentBatch.completed + 1 }
        persist(currentBatch)
      }
      setNotice(`本场 ${currentBatch.completed} 镜导演设计已保存。已有素材保留，生成稿需按新设计重新准备；没有生成媒体。`)
      await onSaved()
    } catch (error) {
      if (!signal.aborted) setNotice(`${String(error)} 已确认保存 ${currentBatch.completed}/${currentBatch.changes.length} 镜；原稿和未确认请求保留。`)
    } finally { lock.current = false; setBusy(false) }
  }
  const prompt = `${generationContextGuidance}\n协调当前场次的全部已有镜头，保持已有镜头ID、顺序、时长、原台词与说话人身份。读取 cinematic-director 与本片方法，从剧本目标统筹六部门。先解决本场共用事实，再设计逐镜变化。空间坐标与画面左右分开；以当前绑定场景的共同布局推导不同机位，不随反打重造房间。逐镜检查人物位置、朝向、支撑接触、持物、器具连接和动作前提/结果，使上一镜出口与下一镜入口相接。尊重剧本的跳时、穿越、改造、移动及其他明确例外。完整保留未受影响的好设计与必要丰富性，不用统一静态/单人/无字模板压平全场。\n全片世界事实与场景布局若有不能据剧本与已保存来源裁定的矛盾，写入 sourceIssues 并指出应修改的共用来源，不向各镜追加相反版本，也不要伪造它们已解决。需要看图时调用现有素材读取和看图工具；文字坐标不是像素验证。对每镜给出 generationContext（按当前来源整理的完整适用设定）与 imagePromptCn（动作开始前单幅画面），同步受影响的 visual、imageStage/imageCamera、blocking、cameraAngle/cameraMovement、actionBeats、continuity、performance、dialoguePlan、soundPlan 及其他已有部门。没有改变的部门可省略，系统保留原值；修改某个嵌套对象时给出该对象完整值，不丢其未变成员。对白源文本/角色/actorId/sourceLineId保持原样，只设计语气与表演。背景配乐按剪辑时间交后期独立音轨，环境声在对白下连续；有源音乐和导演明确选择保留。只输出候选，不调用任何镜头保存或生成工具。\n用户本次要求：${direction.trim() || '按最新共用设定统筹全场，保留叙事与有效导演设计。'}\n完整全剧与素材依据：${JSON.stringify(basis)}\n本集剧本场次：${JSON.stringify(state.scenes)}\n本场完整原镜头：${JSON.stringify(shots)}\n其他场次的接续依据：${JSON.stringify((state.frameRequirements ?? []).filter(shot => shot.sceneId !== sceneId).map((shot: AutomaticPlanningShot) => ({ id: shot.id, sceneId: shot.sceneId, frameNo: shot.frameNo, continuity: shot.directorPlan?.continuity, editorialContext: shot.directorPlan?.editorialContext })))}\n输出一个 txt 代码块中的 JSON：{"sceneId":"${sceneId}","sourceScriptSha256":"${state.scriptSha256}","sourceStoryboardSha256":"${state.storyboard?.sourceHash}","sourceAssetStateSha256":"${basis?.stateSha256}","sourceIssues":[],"shots":[{"shotId":"逐字复制本场镜头ID","imagePromptCn":"完整起始画面","directorPlan":{"generationContext":"完整适用共用设定及剧本例外"}}]}。shots 必须按原顺序完整包含本场每个镜头，directorPlan 不限于示例字段；不写内部来源元数据。代码块外简明说明全场调整、相邻状态如何衔接、还有哪些实际画面/声音待验证。`
  return <section className={css.composer} aria-label="整场导演同步">
    <h3>整场导演同步 · {shots.length} 镜</h3>
    <p>导演结合最新共用设定统筹本场首帧、表演、运镜与前后接续。先查看整场稿，再保存；中断后接续同一份稿件。</p>
    <label>整场协调要求<textarea value={direction} disabled={disabled || busy}
      onChange={(event) => { localStorage.setItem(`${key}:direction`, event.target.value); setDirection(event.target.value) }} /></label>
    {!ready && <p>正在核对共用设计；剧本有更新时，请先在素材页同步设计依据。</p>}
    <button type="button" disabled={busy} onClick={() => { setRefresh(value => value + 1) }}>读取最新共用依据</button>
    <NativeStoryComposer port={storyPort} projectId={projectId} episodeId={episodeId} source={JSON.stringify(shots)} settings=""
      disabled={disabled || busy || !ready || !!batch && batch.completed < batch.changes.length} onAdopt={adopt}
      purpose={{ key: `scene-reconcile-${sceneId}`, jsonOutput: true, title: '整场导演协调稿',
        description: '依据全剧、共用资产和本场全部原设计，形成可检查的协调稿。', prompt,
        action: '让导演统筹本场全部镜头', adopt: '检查通过，载入整场待保存稿', adopted: '整场稿已保存在本机；展开核对后可保存全部镜头设计。' }} />
    {batch && <div>
      <p>已确认保存 {batch.completed}/{batch.changes.length} 镜。此操作更新导演设计，不采用或替换已有媒体。</p>
      <details><summary>查看逐镜待保存设计</summary>{batch.changes.map((change, index) => <article key={change.shotId}>
        <h4>镜 {index + 1} · {index < batch.completed ? '已保存' : '待保存'}</h4>
        <p>{change.imagePromptCn}</p><pre>{JSON.stringify(change.directorPlan, null, 2)}</pre>
      </article>)}</details>
      {batch.completed < batch.changes.length && <>
        <button type="button" disabled={disabled || busy} onClick={() => { void save() }}>{busy ? '正在保存本场设计…' : '保存并接续本场全部设计'}</button>
        <button type="button" disabled={disabled || busy} onClick={() => {
          localStorage.setItem(`${key}:retained`, JSON.stringify(batch)); localStorage.removeItem(key); setBatch(undefined)
          setNotice('原协调稿与请求已保留为本机副本，已保存镜头不撤销；未确认请求可能已经保存，请先读取恢复再协调。')
        }}>保留副本，放弃剩余保存</button>
      </>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
