import { useEffect, useRef, useState } from 'react'
import type { AutomaticPlanningOperation, ScenePlanningRequest, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'

interface Draft {
  readonly shotId: string
  readonly imagePromptCn: string
  readonly blocking?: string
  readonly cameraAngle?: string
  readonly pending?: ScenePlanningRequest
}
type Port = Partial<Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'>>
function key(projectId: string, episodeId: string, shotId: string): string { return `qingmu.scene-planning.v1:${projectId}:${episodeId}:automatic-frame:${shotId}` }
function pendingValid(value: ScenePlanningRequest | undefined,
  projectId: string, episodeId: string, shotId: string): value is ScenePlanningRequest & { readonly request: AutomaticPlanningOperation } {
  return value?.projectId === projectId && value.episodeId === episodeId && value.request.action === 'edit_automatic'
    && value.request.shotId === shotId && value.request.imagePromptCn.length <= 20000
    && value.request.imagePromptCn.trim() !== '' && Number.isSafeInteger(value.request.expectedScriptRevision)
    && typeof value.request.expectedScriptSha256 === 'string' && Number.isSafeInteger(value.request.expectedStoryboardRevision)
    && typeof value.request.expectedStoryboardSha256 === 'string'
}
function stored(keyName: string): Draft | null { try { const value = JSON.parse(localStorage.getItem(keyName) ?? 'null') as Draft; return typeof value.imagePromptCn === 'string' && typeof value.shotId === 'string' ? value : null } catch { return null } }
function sameScope(state: ScenePlanningState, projectId: string, episodeId: string, shotId: string): boolean {
  return state.projectId === projectId && state.episodeId === episodeId
    && state.canonicalStoryboard?.shots?.some(shot => shot.id === shotId) === true
}

/** The existing automatic-storyboard first-frame edit transaction, compacted for the shooting inspector. */
export function AutomaticFrameRequirementsEditor({ projectId, episodeId, shotId, port, onCommitted }: {
  readonly projectId: string
  readonly episodeId: string
  readonly shotId: string
  readonly port: Port
  readonly onCommitted: () => Promise<unknown>
}) {
  const [state, setState] = useState<ScenePlanningState | null>(null); const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading'); const current = useRef<AbortController>(); const epoch = useRef(0)
  const storageKey = key(projectId, episodeId, shotId)
  useEffect(() => {
    const read = port.readScenePlanning
    if (read === undefined) return
    const controller = new AbortController(); const currentEpoch = ++epoch.current; current.current = controller; setState(null); setError(''); setLoad('loading'); setBusy(false)
    void read({ projectId, episodeId }, controller.signal).then((value) => {
      if (!controller.signal.aborted && currentEpoch === epoch.current && sameScope(value, projectId, episodeId, shotId)) {
        setState(value); const saved = value.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)
        const local = stored(storageKey)
        setDraft(local?.shotId === shotId && local.imagePromptCn.length > 0 && local.imagePromptCn.length <= 20000
          && (['blocking', 'cameraAngle'] as const).every(field => local[field] === undefined || (typeof local[field] === 'string' && local[field].length <= 2000))
          && (local.pending === undefined || (pendingValid(local.pending, projectId, episodeId, shotId)
            && local.imagePromptCn === local.pending.request.imagePromptCn
            && (['blocking', 'cameraAngle'] as const).every(field => local.pending?.request.action === 'edit_automatic' && (local.pending.request[field] === undefined || local.pending.request[field] === local[field]))))
          ? { blocking: saved?.blocking ?? '', cameraAngle: saved?.cameraAngle ?? '', ...local }
          : saved ? { shotId, imagePromptCn: saved.imagePromptCn, blocking: saved.blocking ?? '', cameraAngle: saved.cameraAngle ?? '' } : null); setLoad('ready')
      } else if (!controller.signal.aborted && currentEpoch === epoch.current) {
        setError('尚未找到本镜对应的首帧要求，请到分镜工作区核对后重试。'); setLoad('failed')
      }
    }).catch(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) { setError('首帧要求暂不可读取；不会创建或替换素材。'); setLoad('failed') } })
    return () => { controller.abort() }
  }, [episodeId, port, projectId, shotId, storageKey])
  const update = (next: Draft): void => { try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next) } catch { setError('浏览器无法保留本镜草稿；请复制文字后再保存。') } }
  async function save(recover: boolean): Promise<void> {
    const read = port.readScenePlanning; const save = port.saveScenePlanning; const recoverSave = port.recoverScenePlanning
    if (draft === null || state === null || busy || read === undefined || save === undefined || recoverSave === undefined) return
    const canonical = state.canonicalStoryboard
    if (canonical?.shots === undefined || state.scriptSha256 === null) return
    setBusy(true); setError('')
    const runEpoch = epoch.current
    try {
      if (recover && !pendingValid(draft.pending, projectId, episodeId, shotId)) throw new Error('pending scope mismatch')
      if (!recover && draft.pending !== undefined) throw new Error('recover existing receipt first')
      const pending = draft.pending ?? { projectId, episodeId, idempotencyKey: crypto.randomUUID(), request: {
        action: 'edit_automatic', expectedScriptRevision: state.scriptRevision, expectedScriptSha256: state.scriptSha256,
        expectedStoryboardRevision: canonical.revision, expectedStoryboardSha256: canonical.sourceHash,
        shotId, imagePromptCn: draft.imagePromptCn,
        ...(draft.blocking !== undefined && draft.blocking !== savedField('blocking') ? { blocking: draft.blocking } : {}),
        ...(draft.cameraAngle !== undefined && draft.cameraAngle !== savedField('cameraAngle') ? { cameraAngle: draft.cameraAngle } : {}),
      } satisfies AutomaticPlanningOperation }
      update({ ...draft, pending })
      const result = recover ? await recoverSave(pending) : await save(pending)
      if (runEpoch !== epoch.current) return
      const next = await read({ projectId, episodeId })
      if (runEpoch !== epoch.current) return
      if (result.action !== 'edit_automatic' || result.projectId !== projectId || result.episodeId !== episodeId
        || result.shotId !== shotId || result.idempotencyKey !== pending.idempotencyKey || next.canonicalStoryboard === null
        || next.canonicalStoryboard === undefined || next.canonicalStoryboard.revision < result.storyboard.version
        || (next.canonicalStoryboard.revision === result.storyboard.version
          && next.canonicalStoryboard.sourceHash !== result.storyboard.sourceHash)
        || !sameScope(next, projectId, episodeId, shotId)) throw new Error('receipt scope mismatch')
      const saved = next.canonicalStoryboard.shots?.find(shot => shot.id === shotId)
      if (saved === undefined) throw new Error('receipt shot missing')
      localStorage.removeItem(storageKey); setDraft({ shotId, imagePromptCn: saved.imagePromptCn, blocking: saved.blocking ?? '', cameraAngle: saved.cameraAngle ?? '' }); setState(next); await onCommitted()
    } catch { if (runEpoch === epoch.current) setError('尚未确认是否保存成功。草稿已保留，请查看原保存结果，不要重复保存。') } finally { if (runEpoch === epoch.current) setBusy(false) }
  }
  if (port.readScenePlanning === undefined || port.saveScenePlanning === undefined || port.recoverScenePlanning === undefined) {
    return <p role="status">当前无法编辑要求，请刷新后再试。</p>
  }
  if (load === 'failed') return <p role="alert">{error}</p>
  if (state === null || draft === null) return <p role="status">正在读取本镜首帧要求…</p>
  const saved = state.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)
  function savedField(field: 'blocking' | 'cameraAngle'): string { return state?.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)?.[field] ?? '' }
  const dirty = saved !== undefined && (draft.imagePromptCn !== saved.imagePromptCn || (draft.blocking ?? '') !== savedField('blocking') || (draft.cameraAngle ?? '') !== savedField('cameraAngle'))
  return <section aria-label="编辑当前要求">
    {(['blocking', 'cameraAngle'] as const).map(field => <label key={field}>
      {field === 'blocking' ? '动作' : '机位'}
      <textarea aria-label={field === 'blocking' ? '动作' : '机位'} rows={field === 'blocking' ? 3 : 2}
        maxLength={2000} value={draft[field] ?? ''} disabled={busy || draft.pending !== undefined}
        onChange={(event) => { update({ ...draft, [field]: event.target.value }) }} />
    </label>)}
    <label>画面要求<textarea aria-label="画面要求" rows={7} maxLength={20000} value={draft.imagePromptCn}
      disabled={busy || draft.pending !== undefined}
      onChange={(event) => { update({ ...draft, imagePromptCn: event.target.value }) }} /></label>
    <p role="status">{draft.pending ? '正在核实上次保存，草稿已保留。' : dirty ? '有未保存修改 · 已保留在此浏览器' : '当前要求已保存'}</p>
    {error && <p role="alert">{error}</p>}
    {(dirty || busy) && !draft.pending && <button type="button" disabled={busy || !draft.imagePromptCn.trim()} onClick={() => { void save(false) }}>{busy ? '正在保存…' : '保存当前要求'}</button>}
    {draft.pending && <button type="button" disabled={busy} onClick={() => { void save(true) }}>查看原保存结果</button>}
  </section>
}
