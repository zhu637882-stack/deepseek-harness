/** Lightweight scene-first entry into explicit reference drafting. */
import { useEffect, useMemo, useState } from 'react'
import type { YimengShotRelationsProjection } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'
import { ReferenceVideoWorkspace } from './ReferenceVideoWorkspace.tsx'
import css from './SceneReferenceWorkspace.module.css'

export interface SceneReferenceWorkspaceProps {
  readonly projectId: string
  readonly relations: YimengShotRelationsProjection
  readonly selectedShotId: string
  readonly onSelectShotId: (shotId: string) => void
  readonly onUnsavedChange: (dirty: boolean) => void
  readonly onOpenShooting?: ((shotId: string) => void) | undefined
  readonly guardUnsavedNavigation?: boolean
  readonly port: QingmuYimengPort
}

/** Start a current-scene reference draft without requiring a pre-existing PromptIR. */
export function SceneReferenceWorkspace({ projectId, relations, selectedShotId, onSelectShotId,
  onUnsavedChange, onOpenShooting, guardUnsavedNavigation = true, port }: SceneReferenceWorkspaceProps) {
  const [dirty, setDirty] = useState(false)
  const projectionMatchesProject = relations.projectId === projectId
  const shot = projectionMatchesProject ? relations.shots.find(item => item.shotId === selectedShotId) : undefined
  const scene = relations.scenes.find(item => item.sceneId === shot?.sceneId)
  const sceneShots = useMemo(() => relations.shots
    .filter(item => item.sceneId === shot?.sceneId)
    .sort((left, right) => left.frameNo - right.frameNo), [relations.shots, shot?.sceneId])
  const referenceSources = useMemo(() => {
    if (!shot) return []
    const before = sceneShots.filter(item => item.frameNo < shot.frameNo).reverse()
    const after = sceneShots.filter(item => item.frameNo > shot.frameNo)
    return [...before, ...after].map(item => ({
      frameId: item.shotId,
      label: `镜${String(item.frameNo).padStart(2, '0')} · ${item.title ?? '未命名镜头'}`,
    }))
  }, [sceneShots, shot])
  useEffect(() => {
    onUnsavedChange(dirty)
    return () => { onUnsavedChange(false) }
  }, [dirty, onUnsavedChange])
  const select = (nextId: string) => {
    if (nextId === shot?.shotId) return
    if (guardUnsavedNavigation && dirty && !window.confirm('当前镜头的引用草稿尚未保存。切换镜头会保留服务器草稿，但会丢失这次试排，继续吗？')) return
    onSelectShotId(nextId)
  }
  const shotName = shot && `镜${String(shot.frameNo).padStart(2, '0')} · ${shot.title ?? '未命名镜头'}`
  const beatText = shot?.beats.map(item => item.visualResponsibility).filter(Boolean).join('；') ?? ''
  const dialogue = shot?.dialogueRhythm.cues.map(item => item.verbatimText).filter(Boolean).join(' ') ?? ''

  return <section className={css.workspace} aria-label="当前场景镜头工作区">
    <header className={css.header}>
      <div><p className={css.kicker}>SCENE REFERENCE DESK</p><h2>{scene?.name ?? '当前场景'}</h2>
        <p>先明确本镜意图与引用，再保存草稿、核价和登记候选。</p></div>
      <span className={css.status}>{dirty ? '当前试排未保存' : shotName ?? '请选择镜头'}</span>
    </header>
    {shot ? <nav className={css.shots} aria-label="当前场景镜头">
      {sceneShots.map(item => <button key={item.shotId} type="button" aria-pressed={item.shotId === shot.shotId}
        onClick={() => { select(item.shotId) }}>
        <small>镜 {String(item.frameNo).padStart(2, '0')}</small><span>{item.title ?? '未命名镜头'}</span>
      </button>)}
    </nav> : <nav className={css.shots} aria-label="选择场景镜头">
      {projectionMatchesProject ? relations.shots.map(item => <button key={item.shotId} type="button" aria-pressed="false"
        onClick={() => { select(item.shotId) }}>
        <small>{relations.scenes.find(candidate => candidate.sceneId === item.sceneId)?.name ?? '场景'} · 镜 {String(item.frameNo).padStart(2, '0')}</small>
        <span>{item.title ?? '未命名镜头'}</span>
      </button>) : <p>当前项目与镜头关系数据不匹配，请重新读取项目。</p>}
    </nav>}
    {shot && <><div className={css.context}>
      <div><p className={css.kicker}>CURRENT SHOT</p><h3>{shotName}</h3>
        <p>{shot.durationSec} 秒 · {shot.beats.length} 个节拍 · {shot.dialogueRhythm.cues.length} 句对白</p></div>
      <details><summary>查看本镜已有节拍与对白</summary>
        <p>{beatText || '暂无已录入的视觉节拍。请先写本镜导演描述。'}</p>
        {dialogue && <p>对白：{dialogue}</p>}
      </details>
    </div>
    <ReferenceVideoWorkspace key={`${projectId}:${relations.storyboardRevision.revisionId}:${shot.shotId}`}
      projectId={projectId} frameId={shot.shotId}
      shotLabel={`镜${String(shot.frameNo).padStart(2, '0')} · ${shot.title ?? '未命名镜头'}`} initialPrompt="" initialOpen embedded
      referenceSources={referenceSources} onUnsavedChange={setDirty}
      onOpenShooting={onOpenShooting} port={port} />
    </>}
  </section>
}
