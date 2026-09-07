import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { QingmuYimengPort, YimengTakeVersion, YimengTakeVersionStackResponse, YimengWorkflowProjection } from './contracts.ts'
import { TakePreviewPlayer } from './TakePreviewPlayer.tsx'
import {
  clearTakeVersionSelectionMarker, createTakeVersionSelectionMarker, writeTakeVersionSelectionMarker,
} from './take-version-recovery.ts'
import css from './ShootingReviewWorkspace.module.css'

export type ShootingReviewState = 'normal' | 'generating' | 'failed' | 'pending-review'

interface Props {
  readonly projectName: string
  readonly episodeName: string
  readonly projectId: string
  readonly episodeId: string
  readonly projection: YimengWorkflowProjection | undefined
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly directorAssistant: ReactNode
  readonly port: Pick<QingmuYimengPort,
    'takeVersions' | 'takePreview' | 'selectTakeVersion' | 'recoverTakeVersionSelection'>
  /** Test-only visual state; production always derives this from the read stack. */
  readonly testState?: ShootingReviewState
}

function message(state: ShootingReviewState): string {
  if (state === 'generating') return '正在读取已存在的候选媒体；不会提交新的生成任务。'
  if (state === 'failed') return '候选媒体暂不可用。请检查版本绑定后重试。'
  if (state === 'pending-review') return '候选已就绪。浏览不改变选用，采用需要明确操作。'
  return '当前为已选版本。可浏览其它候选或修改当前要求。'
}

function usable(version: YimengTakeVersion | undefined): version is YimengTakeVersion & { readonly outputSha256: string } {
  return version !== undefined && version.outputSha256 !== null && version.outputBindingStatus === 'verified'
}

/** Content-first view of existing Takes. It never starts generation or records human approval. */
export function ShootingReviewWorkspace({
  projectName, episodeName, projectId, episodeId, projection, selectedShotId, onSelectShotId,
  directorAssistant, port, testState,
}: Props) {
  const shots = projection?.director.shotRelations.shots ?? []
  const current = shots.find(shot => shot.shotId === selectedShotId) ?? shots[0]
  const [stack, setStack] = useState<YimengTakeVersionStackResponse>()
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [browseId, setBrowseId] = useState('')
  const [requirements, setRequirements] = useState('')
  const [panel, setPanel] = useState<'requirements' | 'assistant'>('requirements')
  const [zoom, setZoom] = useState(false)
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    if (current === undefined) { setStack(undefined); setLoad('failed'); return }
    const controller = new AbortController()
    setLoad('loading')
    setStack(undefined)
    void port.takeVersions({ projectId, episodeId, frameId: current.shotId }, controller.signal).then((value) => {
      if (controller.signal.aborted || value.subject.frameId !== current.shotId) return
      setStack(value)
      setBrowseId(value.subject.selectedTakeId ?? value.subject.versions[0]?.takeId ?? '')
      setLoad('ready')
    }).catch(() => { if (!controller.signal.aborted) setLoad('failed') })
    return () => controller.abort()
  }, [current, episodeId, port, projectId])
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setZoom(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  if (current === undefined) return <section className={css.empty} aria-live="polite">请选择一个镜头后开始拍摄与审看。</section>
  const activeShot = current
  const versions = stack?.subject.versions ?? []
  const browsed = versions.find(version => version.takeId === browseId)
  const state = testState ?? (load === 'loading' ? 'generating' : load === 'failed' ? 'failed'
    : stack?.subject.selectedTakeId === null ? 'pending-review' : 'normal')
  const primary = state === 'pending-review' && usable(browsed) && stack?.capabilities.canSelect === true

  async function selectCurrent(): Promise<void> {
    if (!primary || stack === undefined || browsed === undefined || !usable(browsed) || selecting) return
    setSelecting(true)
    try {
      const marker = await createTakeVersionSelectionMarker({
        projectId, episodeId, frameId: activeShot.shotId, expectedStackSha256: stack.stackSnapshotSha256,
        expectedSelectedTakeId: stack.subject.selectedTakeId, candidateTakeId: browsed.takeId,
        candidateVersionOrdinal: browsed.versionOrdinal, candidateOutputSha256: browsed.outputSha256,
      })
      if (!writeTakeVersionSelectionMarker(marker)) throw new Error('selection recovery storage unavailable')
      let result
      try {
        result = await port.selectTakeVersion(marker)
      } catch {
        const recovery = await port.recoverTakeVersionSelection(marker)
        if (recovery.status !== 'committed' || recovery.result === null) throw new Error('selection recovery pending')
        result = recovery.result
      }
      if (result.providerCalls !== 0 || result.budgetMutation || result.humanApprovalInferred) throw new Error('unsafe selection receipt')
      clearTakeVersionSelectionMarker(marker, { status: 'ready', marker })
      setStack(await port.takeVersions({ projectId, episodeId, frameId: activeShot.shotId }))
    } finally { setSelecting(false) }
  }

  return <section className={css.workspace} aria-label="拍摄与审看">
    <header className={css.header}>
      <div><strong>{projectName}</strong><span> / {episodeName}</span></div>
      <nav aria-label="项目步骤"><span>故事</span><span>角色与场景</span><span>分镜</span><strong>拍摄与审看</strong><span>导出</span></nav>
    </header>
    <div className={css.grid}>
      <aside className={css.shots} aria-label="镜头列表"><h2>镜头</h2>
        {shots.map(shot => <button key={shot.shotId} type="button" aria-current={shot.shotId === current.shotId}
          onClick={() => onSelectShotId(shot.shotId)}><span>镜 {shot.frameNo}</span><small>{shot.title}</small></button>)}
      </aside>
      <main className={css.stage}>
        <div className={css.media} data-state={state}>
          {usable(browsed) ? <div className={css.player}><TakePreviewPlayer request={{ projectId, episodeId, frameId: current.shotId,
            takeId: browsed.takeId, expectedOutputSha256: browsed.outputSha256 }} load={port.takePreview} t={key => key} /></div>
            : <button type="button" className={css.canvas} onClick={() => setZoom(true)} aria-label={`放大查看镜 ${current.frameNo}`}>
              <span>镜 {current.frameNo}</span><strong>{current.title}</strong><small>{message(state)}</small>
            </button>}
          {zoom && <div className={css.zoom} role="dialog" aria-modal="true" aria-label="放大画面"><button type="button" onClick={() => setZoom(false)}>关闭放大查看</button><strong>镜 {current.frameNo} · {current.title}</strong></div>}
        </div>
        <div className={css.candidates} aria-label="候选画面">
          {versions.map(version => <button key={version.takeId} type="button" aria-pressed={version.takeId === browseId}
            onClick={() => setBrowseId(version.takeId)}><span>候选 v{version.versionOrdinal}</span><strong>{version.isSelected ? '当前选用' : version.qualityStatus}</strong><small>{version.durationSec === null ? '时长未知' : `${version.durationSec} 秒`}</small></button>)}
        </div>
        <p className={css.browseNote}>{message(state)} 单击候选只切换中区媒体，不会改变选用。</p>
        <button className={css.primary} type="button" disabled={!primary || selecting} onClick={() => { void selectCurrent() }}>
          {primary ? (selecting ? '正在采用候选' : '采用这张') : state === 'failed' ? '候选不可用' : state === 'generating' ? '正在读取候选' : '当前已选用'}
        </button>
      </main>
      <aside className={css.inspector}>
        <div className={css.switcher}><button type="button" aria-pressed={panel === 'requirements'} onClick={() => setPanel('requirements')}>当前要求</button><button type="button" aria-pressed={panel === 'assistant'} onClick={() => setPanel('assistant')}>原生导演助手</button></div>
        {panel === 'requirements' ? <label>当前镜头要求<textarea value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="草稿仅保留在当前浏览器会话；保存、生成和签收仍在既有受控流程。" /></label> : directorAssistant}
      </aside>
    </div>
  </section>
}
