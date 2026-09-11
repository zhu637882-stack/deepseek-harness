import { useEffect, useRef, useState } from 'react'
import type { FrameRequirementsOperation, ScenePlanningRequest, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { continuityFields, continuityText, ShotContinuityView } from './ShotContinuityView.tsx'

interface Draft {
  readonly shotId: string
  readonly imagePromptCn: string
  readonly blocking?: string
  readonly cameraAngle?: string
  readonly cameraMovement?: string
  readonly coveragePlan?: string
  readonly continuityStart?: string
  readonly continuityEnd?: string
  readonly pending?: ScenePlanningRequest
}
const shootingFields = ['blocking', 'cameraAngle', 'cameraMovement', 'coveragePlan'] as const
const shootingLabels = { blocking: '动作', cameraAngle: '机位', cameraMovement: '摄影机运动', coveragePlan: '景别、焦点与切点' } as const
const continuityKeys = ['continuityStart', 'continuityEnd'] as const
const continuityLabels = { continuityStart: '本镜开始状态', continuityEnd: '本镜结束状态' } as const
const boundary = { continuityStart: 'start', continuityEnd: 'end' } as const
type ShootingField = typeof shootingFields[number]
type Port = Partial<Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'>>
export type AutomaticFrameRequirementStatus = 'loading' | 'ready' | 'missing' | 'unavailable'
function key(projectId: string, episodeId: string, shotId: string): string { return `qingmu.scene-planning.v1:${projectId}:${episodeId}:automatic-frame:${shotId}` }
function pendingValid(value: ScenePlanningRequest | undefined,
  projectId: string, episodeId: string, shotId: string): value is ScenePlanningRequest & { readonly request: FrameRequirementsOperation } {
  return value?.projectId === projectId && value.episodeId === episodeId && (value.request?.action === 'edit_automatic' || value.request?.action === 'edit_requirements')
    && typeof value.idempotencyKey === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)
    && value.request.shotId === shotId && typeof value.request.imagePromptCn === 'string' && value.request.imagePromptCn.length <= 20000
    && (value.request.imagePromptCn.trim() !== '' || value.request.directorPlan !== undefined) && Number.isSafeInteger(value.request.expectedScriptRevision)
    && value.request.expectedScriptRevision >= 1 && /^[a-f0-9]{64}$/.test(value.request.expectedScriptSha256)
    && Number.isSafeInteger(value.request.expectedStoryboardRevision) && value.request.expectedStoryboardRevision >= 1
    && /^[a-f0-9]{64}$/.test(value.request.expectedStoryboardSha256)
}
function stored(keyName: string): Draft | null { try { const value = JSON.parse(localStorage.getItem(keyName) ?? 'null') as Draft; return typeof value?.imagePromptCn === 'string' && typeof value?.shotId === 'string' ? value : null } catch { return null } }
function pendingContinuityMatches(draft: Draft): boolean {
  const operation = draft.pending?.request
  if (operation?.action !== 'edit_automatic' && operation?.action !== 'edit_requirements') return false
  const value = operation.directorPlan?.continuity
  return continuityKeys.every(field => draft[field] === undefined || (value !== null && typeof value === 'object'
    && !Array.isArray(value) && (value as Record<string, unknown>)[boundary[field]] === draft[field]))
}
function requirements(state: ScenePlanningState | null) { return state?.frameRequirements ?? state?.canonicalStoryboard?.shots }
function sameScope(state: ScenePlanningState, projectId: string, episodeId: string, shotId: string): boolean {
  return state.projectId === projectId && state.episodeId === episodeId
    && requirements(state)?.some(shot => shot.id === shotId) === true
}

/** Saved frame requirements across imported and automatic storyboards, using their respective transactions. */
export function AutomaticFrameRequirementsEditor({
  projectId, episodeId, shotId, port, onCommitted, onRequirementStatusChange, onReturnToStoryboard,
}: {
  readonly projectId: string
  readonly episodeId: string
  readonly shotId: string
  readonly port: Port
  readonly onCommitted: () => Promise<unknown>
  /** Reports whether this exact shot has an authoritative, saved image requirement. */
  readonly onRequirementStatusChange?: (status: AutomaticFrameRequirementStatus) => void
  /** Lets the surrounding workbench take the user back to the storyboard. */
  readonly onReturnToStoryboard?: () => void
}) {
  const [state, setState] = useState<ScenePlanningState | null>(null); const [draft, setDraft] = useState<Draft | null>(null)
  const [rebaseState, setRebaseState] = useState<ScenePlanningState | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading'); const current = useRef<AbortController>(); const epoch = useRef(0)
  const storageKey = key(projectId, episodeId, shotId)
  useEffect(() => {
    const read = port.readScenePlanning
    if (read === undefined) return
    const controller = new AbortController(); const currentEpoch = ++epoch.current; current.current = controller; setState(null); setRebaseState(null); setError(''); setLoad('loading'); setBusy(false)
    void read({ projectId, episodeId }, controller.signal).then((value) => {
      if (!controller.signal.aborted && currentEpoch === epoch.current && sameScope(value, projectId, episodeId, shotId)) {
        setState(value); const saved = requirements(value)?.find(shot => shot.id === shotId)
        const local = stored(storageKey)
        setDraft(local?.shotId === shotId && local.imagePromptCn.length <= 20000
          && shootingFields.every(field => local[field] === undefined || (typeof local[field] === 'string' && local[field].length <= 2000))
          && continuityKeys.every(field => local[field] === undefined || (typeof local[field] === 'string' && local[field].length <= 12000))
          && (local.pending === undefined || (pendingValid(local.pending, projectId, episodeId, shotId)
            && local.imagePromptCn === local.pending.request.imagePromptCn
            && pendingContinuityMatches(local)
            && shootingFields.every(field => (local.pending?.request.action === 'edit_automatic' || local.pending?.request.action === 'edit_requirements') && (local.pending.request[field] === undefined || local.pending.request[field] === local[field]))))
          ? { blocking: saved?.blocking ?? '', cameraAngle: saved?.cameraAngle ?? '', cameraMovement: saved?.cameraMovement ?? '', coveragePlan: saved?.coveragePlan ?? '', ...local }
          : saved ? { shotId, imagePromptCn: saved.imagePromptCn, blocking: saved.blocking ?? '', cameraAngle: saved.cameraAngle ?? '', cameraMovement: saved.cameraMovement ?? '', coveragePlan: saved.coveragePlan ?? '' } : null); setLoad('ready')
      } else if (!controller.signal.aborted && currentEpoch === epoch.current) {
        setError('尚未找到本镜对应的首帧要求，请到分镜工作区核对后重试。'); setLoad('failed')
      }
    }).catch(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) { setError('首帧要求暂不可读取；不会创建或替换素材。'); setLoad('failed') } })
    return () => { controller.abort() }
  }, [episodeId, port, projectId, shotId, storageKey])
  useEffect(() => {
    let status: AutomaticFrameRequirementStatus = 'loading'
    if (port.readScenePlanning === undefined || port.saveScenePlanning === undefined || port.recoverScenePlanning === undefined) {
      status = 'unavailable'
    } else if (load === 'failed') {
      status = 'missing'
    } else if (load === 'ready') {
      const saved = requirements(state)?.find(shot => shot.id === shotId)
      status = saved?.imagePromptCn.trim() ? 'ready' : 'missing'
    }
    onRequirementStatusChange?.(status)
  }, [load, onRequirementStatusChange, port.readScenePlanning, port.recoverScenePlanning, port.saveScenePlanning, shotId, state])
  const update = (next: Draft): void => { try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next) } catch { setError('浏览器无法保留本镜草稿；请复制文字后再保存。') } }
  async function save(recover: boolean): Promise<void> {
    const read = port.readScenePlanning; const save = port.saveScenePlanning; const recoverSave = port.recoverScenePlanning
    if (draft === null || state === null || busy || read === undefined || save === undefined || recoverSave === undefined) return
    const canonical = state.storyboard
    if (requirements(state) === undefined || canonical === null || state.scriptSha256 === null) return
    setBusy(true); setError(''); setRebaseState(null)
    const runEpoch = epoch.current
    try {
      if (recover && !pendingValid(draft.pending, projectId, episodeId, shotId)) throw new Error('pending scope mismatch')
      if (!recover && draft.pending !== undefined) throw new Error('recover existing receipt first')
      const pending = draft.pending ?? { projectId, episodeId, idempotencyKey: crypto.randomUUID(), request: {
        action: state.canonicalStoryboard ? 'edit_automatic' : 'edit_requirements', expectedScriptRevision: state.scriptRevision, expectedScriptSha256: state.scriptSha256,
        expectedStoryboardRevision: canonical.version, expectedStoryboardSha256: canonical.sourceHash,
        shotId, imagePromptCn: draft.imagePromptCn,
        ...(draft.blocking !== undefined && draft.blocking !== savedField('blocking') ? { blocking: draft.blocking } : {}),
        ...(draft.cameraAngle !== undefined && draft.cameraAngle !== savedField('cameraAngle') ? { cameraAngle: draft.cameraAngle } : {}),
        ...(draft.cameraMovement !== undefined && draft.cameraMovement !== savedField('cameraMovement') ? { cameraMovement: draft.cameraMovement } : {}),
        ...(draft.coveragePlan !== undefined && draft.coveragePlan !== savedField('coveragePlan') ? { coveragePlan: draft.coveragePlan } : {}),
        ...(continuityKeys.some(field => draft[field] !== undefined) ? { directorPlan: { continuity: {
          ...continuityFields(requirements(state)?.find(shot => shot.id === shotId)),
          ...(draft.continuityStart === undefined ? {} : { start: draft.continuityStart }),
          ...(draft.continuityEnd === undefined ? {} : { end: draft.continuityEnd }),
        } } } : {}),
      } satisfies FrameRequirementsOperation }
      update({ ...draft, pending })
      const result = recover ? await recoverSave(pending) : await save(pending)
      if (runEpoch !== epoch.current) return
      const next = await read({ projectId, episodeId })
      if (runEpoch !== epoch.current) return
      if ((result.action !== 'edit_automatic' && result.action !== 'edit_requirements') || result.action !== pending.request.action || result.projectId !== projectId || result.episodeId !== episodeId
        || result.shotId !== shotId || result.idempotencyKey !== pending.idempotencyKey || result.providerCalls !== 0
        || result.stageStarted || result.approvalGranted || next.storyboard === null
        || next.storyboard.version < result.storyboard.version
        || (next.storyboard.version === result.storyboard.version
          && next.storyboard.sourceHash !== result.storyboard.sourceHash)
        || !sameScope(next, projectId, episodeId, shotId)) throw new Error('receipt scope mismatch')
      const saved = requirements(next)?.find(shot => shot.id === shotId)
      if (saved === undefined) throw new Error('receipt shot missing')
      localStorage.removeItem(storageKey); setDraft({ shotId, imagePromptCn: saved.imagePromptCn, blocking: saved.blocking ?? '', cameraAngle: saved.cameraAngle ?? '', cameraMovement: saved.cameraMovement ?? '', coveragePlan: saved.coveragePlan ?? '' }); setState(next)
      try { await onCommitted() } catch {
        if (runEpoch === epoch.current) setError('当前要求已保存，但工作区暂未刷新。请刷新页面继续；无需重新保存。')
      }
    } catch (cause) {
      if (runEpoch !== epoch.current) return
      setError('尚未确认是否保存成功。草稿已保留，请查看原保存结果，不要重复保存。')
      // Only an authoritative absent receipt can release the old intent. A network
      // failure or unrelated 404 must continue recovering the exact original key.
      if (recover && /\bplanning_receipt_not_found\b/.test(String(cause))
        && pendingValid(draft.pending, projectId, episodeId, shotId)) {
        try {
          const latest = await read({ projectId, episodeId })
          if (runEpoch !== epoch.current) return
          const request = draft.pending.request
          if (sameScope(latest, projectId, episodeId, shotId) && latest.storyboard !== null
            && latest.scriptRevision === request.expectedScriptRevision && latest.scriptSha256 === request.expectedScriptSha256
            && latest.storyboard.version >= request.expectedStoryboardRevision
            && (latest.storyboard.version !== request.expectedStoryboardRevision
              || latest.storyboard.sourceHash === request.expectedStoryboardSha256)
            && Boolean(latest.canonicalStoryboard) === (request.action === 'edit_automatic')) {
            setRebaseState(latest)
            setError('原保存没有提交成功，已读取最新版本。请核对本镜最新要求后，保留草稿继续编辑；不会自动重试保存。')
          } else {
            setError('原保存没有提交成功，但剧本或本镜来源已经变化。草稿已保留，请返回分镜核对。')
          }
        } catch {
          if (runEpoch === epoch.current) setError('原保存没有提交成功，最新版本暂不可读取。草稿已保留，请再次查看原保存结果。')
        }
      }
    } finally { if (runEpoch === epoch.current) setBusy(false) }
  }
  if (port.readScenePlanning === undefined || port.saveScenePlanning === undefined || port.recoverScenePlanning === undefined) {
    return <div role="status"><p>当前无法读取本镜已保存要求；不会继续生成。</p>{onReturnToStoryboard && <button type="button" onClick={onReturnToStoryboard}>返回分镜核对要求</button>}</div>
  }
  if (load === 'failed') return <div role="alert"><p>{error}</p>{onReturnToStoryboard && <button type="button" onClick={onReturnToStoryboard}>返回分镜核对要求</button>}</div>
  if (state === null || draft === null) return <p role="status">正在读取本镜首帧要求…</p>
  const saved = requirements(state)?.find(shot => shot.id === shotId)
  function savedField(field: ShootingField): string { return requirements(state)?.find(shot => shot.id === shotId)?.[field] ?? '' }
  const continuity = continuityFields(saved)
  const dirty = saved !== undefined && (draft.imagePromptCn !== saved.imagePromptCn || shootingFields.some(field => (draft[field] ?? '') !== savedField(field))
    || continuityKeys.some(field => draft[field] !== undefined && draft[field] !== continuityText(continuity[boundary[field]])))
  return <section aria-label="编辑当前要求">
    <ShotContinuityView state={state} shotId={shotId} />
    <fieldset disabled={busy || draft.pending !== undefined}>
      <legend>本镜连续性</legend>
      {continuity.notes !== undefined && <p>既有连续性说明：{continuityText(continuity.notes)}</p>}
      {continuityKeys.map(field => <label key={field}>{continuityLabels[field]}
        <textarea aria-label={continuityLabels[field]} rows={3} maxLength={12000}
          value={draft[field] ?? continuityText(continuity[boundary[field]])}
          onChange={event => update({ ...draft, [field]: event.target.value })} />
      </label>)}
      <p>首帧对应开始状态；取物、转身、接线等动作发生后的结果写入结束状态。保存后请让导演据此更新视频提示词，再预览生成。</p>
    </fieldset>
    {shootingFields.map(field => <label key={field}>
      {shootingLabels[field]}
      <textarea aria-label={shootingLabels[field]} rows={field === 'blocking' ? 3 : 2}
        maxLength={2000} value={draft[field] ?? ''} disabled={busy || draft.pending !== undefined}
        onChange={event => update({ ...draft, [field]: event.target.value })} />
    </label>)}
    <p>摄影机运动描述镜头如何移动；景别、焦点与切点描述观众何时看什么。保存后随本镜进入参考视频预览与生成请求。</p>
    <label>画面要求<textarea aria-label="画面要求" rows={7} maxLength={20000} value={draft.imagePromptCn}
      disabled={busy || draft.pending !== undefined} onChange={event => update({ ...draft, imagePromptCn: event.target.value })} /></label>
    <p role="status">{draft.pending ? '正在核实上次保存，草稿已保留。' : dirty ? '有未保存修改 · 已保留在此浏览器' : saved?.imagePromptCn.trim() ? '当前要求已保存' : '补充本镜的首帧画面要求并保存，随后可预检生成。'}</p>
    {error && <p role="alert">{error}</p>}
    {(dirty || busy) && !draft.pending && <button type="button"
      disabled={busy || (!draft.imagePromptCn.trim() && !continuityKeys.some(field => draft[field] !== undefined))}
      onClick={() => { void save(false) }}>{busy ? '正在保存…' : '保存当前要求'}</button>}
    {draft.pending && <button type="button" disabled={busy} onClick={() => { void save(true) }}>查看原保存结果</button>}
    {draft.pending && rebaseState && <div>
      <p>本镜最新已保存要求：{requirements(rebaseState)?.find(shot => shot.id === shotId)?.imagePromptCn || '尚未填写'}</p>
      <p>最新动作：{requirements(rebaseState)?.find(shot => shot.id === shotId)?.blocking || '未设置'} · 最新机位：{requirements(rebaseState)?.find(shot => shot.id === shotId)?.cameraAngle || '未设置'}</p>
      <p>最新摄影机运动：{requirements(rebaseState)?.find(shot => shot.id === shotId)?.cameraMovement || '未设置'} · 最新景别与切点：{requirements(rebaseState)?.find(shot => shot.id === shotId)?.coveragePlan || '未设置'}</p>
      <p>最新开始状态：{continuityText(continuityFields(requirements(rebaseState)?.find(shot => shot.id === shotId)).start) || '尚未设计'}</p>
      <p>最新结束状态：{continuityText(continuityFields(requirements(rebaseState)?.find(shot => shot.id === shotId)).end) || '尚未设计'}</p>
      <button type="button" disabled={busy} onClick={() => {
        const next = { shotId: draft.shotId, imagePromptCn: draft.imagePromptCn,
          ...(draft.blocking !== undefined ? { blocking: draft.blocking } : {}),
          ...(draft.cameraAngle !== undefined ? { cameraAngle: draft.cameraAngle } : {}),
          ...(draft.cameraMovement !== undefined ? { cameraMovement: draft.cameraMovement } : {}),
          ...(draft.coveragePlan !== undefined ? { coveragePlan: draft.coveragePlan } : {}),
          ...(draft.continuityStart !== undefined ? { continuityStart: draft.continuityStart } : {}),
          ...(draft.continuityEnd !== undefined ? { continuityEnd: draft.continuityEnd } : {}),
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next); setState(rebaseState); setRebaseState(null); setError('')
        } catch { setError('浏览器无法保留草稿；请复制文字后再继续。') }
      }}>保留草稿，按最新版本继续编辑</button>
    </div>}
  </section>
}
