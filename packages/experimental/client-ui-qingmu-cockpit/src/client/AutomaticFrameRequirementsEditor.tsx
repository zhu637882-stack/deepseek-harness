import { useEffect, useRef, useState } from 'react'
import type { AutomaticPlanningOperation, ScenePlanningRequest, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'

interface Draft { readonly shotId: string; readonly imagePromptCn: string; readonly pending?: ScenePlanningRequest }
type Port = Partial<Pick<QingmuYimengPort, 'readScenePlanning' | 'saveScenePlanning' | 'recoverScenePlanning'>>
function key(projectId: string, episodeId: string, shotId: string): string { return `qingmu.scene-planning.v1:${projectId}:${episodeId}:automatic-frame:${shotId}` }
function stored(keyName: string): Draft | null { try { const value = JSON.parse(localStorage.getItem(keyName) ?? 'null') as Draft; return typeof value?.imagePromptCn === 'string' ? value : null } catch { return null } }
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
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const current = useRef<AbortController>()
  const storageKey = key(projectId, episodeId, shotId)
  useEffect(() => {
    const read = port.readScenePlanning
    if (read === undefined) return
    const controller = new AbortController(); current.current = controller; setState(null); setError('')
    void read({ projectId, episodeId }, controller.signal).then((value) => {
      if (!controller.signal.aborted && sameScope(value, projectId, episodeId, shotId)) {
        setState(value); const saved = value.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)
        setDraft(stored(storageKey) ?? (saved ? { shotId, imagePromptCn: saved.imagePromptCn } : null))
      }
    }).catch(() => { if (!controller.signal.aborted) setError('首帧要求暂不可读取；不会创建或替换素材。') })
    return () => controller.abort()
  }, [episodeId, port, projectId, shotId, storageKey])
  const update = (next: Draft): void => { try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next) } catch { setError('浏览器无法保留本镜草稿；请复制文字后再保存。') } }
  async function save(recover: boolean): Promise<void> {
    const read = port.readScenePlanning; const save = port.saveScenePlanning; const recoverSave = port.recoverScenePlanning
    if (draft === null || state === null || busy || read === undefined || save === undefined || recoverSave === undefined) return
    const canonical = state.canonicalStoryboard
    if (canonical?.shots === undefined || state.scriptSha256 === null) return
    setBusy(true); setError('')
    try {
      const pending = draft.pending ?? { projectId, episodeId, idempotencyKey: crypto.randomUUID(), request: {
        action: 'edit_automatic', expectedScriptRevision: state.scriptRevision, expectedScriptSha256: state.scriptSha256,
        expectedStoryboardRevision: canonical.revision, expectedStoryboardSha256: canonical.sourceHash,
        shotId, imagePromptCn: draft.imagePromptCn,
      } satisfies AutomaticPlanningOperation }
      update({ ...draft, pending })
      const result = recover ? await recoverSave(pending) : await save(pending)
      const next = await read({ projectId, episodeId })
      if (result.action !== 'edit_automatic' || !sameScope(next, projectId, episodeId, shotId)) throw new Error('receipt scope mismatch')
      const saved = next.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)
      if (saved === undefined) throw new Error('receipt shot missing')
      localStorage.removeItem(storageKey); setDraft({ shotId, imagePromptCn: saved.imagePromptCn }); setState(next); await onCommitted()
    } catch { setError('保存结果尚未确认。草稿和同一幂等回执键已保留；请读取同一保存回执。') } finally { setBusy(false) }
  }
  if (port.readScenePlanning === undefined || port.saveScenePlanning === undefined || port.recoverScenePlanning === undefined) {
    return <p>首帧编辑接口当前不可用；无法假装保存。</p>
  }
  if (state === null || draft === null) return <p role="status">正在读取本镜首帧要求…</p>
  const saved = state.canonicalStoryboard?.shots?.find(shot => shot.id === shotId)
  const dirty = saved !== undefined && draft.imagePromptCn !== saved.imagePromptCn
  return <section><label>首帧画面要求<textarea aria-label="首帧画面要求" rows={5} maxLength={20000} value={draft.imagePromptCn} disabled={busy} onChange={event => update({ ...draft, imagePromptCn: event.target.value })} /></label>{error && <p role="alert">{error}</p>}<button type="button" disabled={busy || !dirty || !draft.imagePromptCn.trim()} onClick={() => { void save(false) }}>保存首帧画面要求</button>{draft.pending && <button type="button" disabled={busy} onClick={() => { void save(true) }}>读取同一保存回执</button>}</section>
}
