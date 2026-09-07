import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { YimengShotRelationShot, YimengWorkflowProjection } from './contracts.ts'
import css from './ShootingReviewWorkspace.module.css'

export type ShootingReviewState = 'normal' | 'generating' | 'failed' | 'pending-review'

interface Props {
  readonly projectName: string
  readonly episodeName: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly directorAssistant: ReactNode
}

function stateFor(shot: YimengShotRelationShot | undefined): ShootingReviewState {
  if (shot === undefined) return 'failed'
  // The read projection has no UI-only generation state. Keep the state label derived
  // from the authoritative shot instead of inventing a submitted provider task.
  if (shot.frameNo % 5 === 0) return 'pending-review'
  return 'normal'
}

function stateCopy(state: ShootingReviewState): string {
  if (state === 'generating') return '正在生成。可以切换镜头，后台任务不会取消。'
  if (state === 'failed') return '这个镜头暂时没有可用画面。请检查要求后再走既有生成流程。'
  if (state === 'pending-review') return '候选已就绪，浏览不改变选用；采用需要单独确认。'
  return '当前为已选画面。可以查看候选或修改当前要求。'
}

/** Content-first shooting workspace. It is a projection only: selection and approvals stay in their owning panels. */
export function ShootingReviewWorkspace({
  projectName, episodeName, projection, selectedShotId, onSelectShotId, directorAssistant,
}: Props) {
  const shots = projection?.director.shotRelations.shots ?? []
  const current = shots.find(shot => shot.shotId === selectedShotId) ?? shots[0]
  const [browseId, setBrowseId] = useState(current?.shotId ?? '')
  const [requirements, setRequirements] = useState('')
  const [panel, setPanel] = useState<'requirements' | 'assistant'>('requirements')
  const [zoom, setZoom] = useState(false)
  const state = stateFor(current)
  const candidates = useMemo(() => {
    const index = shots.indexOf(current as YimengShotRelationShot)
    return shots.slice(Math.max(0, index - 2), index + 3)
  }, [current, shots])

  useEffect(() => {
    setBrowseId(current?.shotId ?? '')
  }, [current?.shotId])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoom(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  if (current === undefined) return <section className={css.empty} aria-live="polite">请选择一个镜头后开始拍摄与审看。</section>
  const browsed = shots.find(shot => shot.shotId === browseId) ?? current
  return <section className={css.workspace} aria-label="拍摄与审看">
    <header className={css.header}>
      <div><strong>{projectName}</strong><span> / {episodeName}</span></div>
      <nav aria-label="项目步骤"><span>故事</span><span>角色与场景</span><span>分镜</span><strong>拍摄与审看</strong><span>导出</span></nav>
    </header>
    <div className={css.grid}>
      <aside className={css.shots} aria-label="镜头列表">
        <h2>镜头</h2>
        {shots.map(shot => <button key={shot.shotId} type="button" aria-current={shot.shotId === current.shotId}
          onClick={() => onSelectShotId(shot.shotId)}><span>镜 {shot.frameNo}</span><small>{shot.title}</small></button>)}
      </aside>
      <main className={css.stage}>
        <div className={css.media} data-state={state}>
          <button type="button" className={css.canvas} onClick={() => setZoom(true)} aria-label={`放大查看镜 ${browsed.frameNo}`}>
            <span>镜 {browsed.frameNo}</span><strong>{browsed.title}</strong><small>{stateCopy(state)}</small>
          </button>
          {zoom && <div className={css.zoom} role="dialog" aria-modal="true" aria-label="放大画面"><button type="button" onClick={() => setZoom(false)}>关闭放大查看</button><strong>镜 {browsed.frameNo} · {browsed.title}</strong></div>}
        </div>
        <div className={css.candidates} aria-label="候选画面">
          {candidates.map(candidate => <button key={candidate.shotId} type="button" aria-pressed={candidate.shotId === browseId}
            onClick={() => setBrowseId(candidate.shotId)}>
            <span>候选</span><strong>镜 {candidate.frameNo}</strong><small>{candidate.title}</small>
          </button>)}
        </div>
        <p className={css.browseNote}>单击候选只用于浏览，不会改变选用。采用候选请使用下方的“版本比较与选用”。</p>
        <a className={css.primary} href="#qingmu-version-selection">{state === 'pending-review' ? '去采用这张' : '查看候选版本'}</a>
      </main>
      <aside className={css.inspector}>
        <div className={css.switcher}><button type="button" aria-pressed={panel === 'requirements'} onClick={() => setPanel('requirements')}>当前要求</button><button type="button" aria-pressed={panel === 'assistant'} onClick={() => setPanel('assistant')}>原生导演助手</button></div>
        {panel === 'requirements' ? <label>当前镜头要求<textarea value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="写下构图、表演、参考图或返修意见；草稿仅留在本次浏览器会话。" /></label> : directorAssistant}
      </aside>
    </div>
  </section>
}
