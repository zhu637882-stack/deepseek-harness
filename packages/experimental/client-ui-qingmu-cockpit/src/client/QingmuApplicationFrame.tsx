import { useEffect, useRef, useState, type ReactNode } from 'react'
import css from './QingmuApplicationFrame.module.css'

export type CreativeStep = 'story' | 'assets' | 'storyboard' | 'shooting' | 'delivery'
const stepLabels: Record<CreativeStep, string> = {
  story: '故事',
  assets: '角色与场景',
  storyboard: '分镜',
  shooting: '拍摄与审看',
  delivery: '导出',
}
const steps = Object.entries(stepLabels) as readonly [CreativeStep, string][]
export function creativeStepFromSearch(search: string): CreativeStep {
  const value = new URLSearchParams(search).get('qingmuView')
  return steps.find(([id]) => id === value)?.[0] ?? 'story'
}
export function creativeStepLabel(step: CreativeStep): string { return stepLabels[step] }
type Option = { readonly id: string; readonly label: string }

/** One product shell across every creative step; no modal or second application. */
export function QingmuApplicationFrame({ projects, episodes, projectId, episodeId, step, loading, scopeLocked,
  onProject, onEpisode, onStep, onCreate, onRefresh, onOpenTools, onOpenProjects, projectsOpen, children }: {
  readonly projects: readonly Option[]
  readonly episodes: readonly Option[]
  readonly projectId: string
  readonly episodeId: string
  readonly step: CreativeStep
  readonly loading: boolean
  readonly scopeLocked: boolean
  readonly onProject: (id: string) => void
  readonly onEpisode: (id: string) => void
  readonly onStep: (step: CreativeStep) => void
  readonly onCreate: () => void
  readonly onRefresh: () => void
  readonly onOpenTools?: (() => void) | undefined
  readonly onOpenProjects?: (() => void) | undefined
  readonly projectsOpen?: boolean | undefined
  readonly children: ReactNode
}) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!toolsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setToolsOpen(false)
      moreButton.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [toolsOpen])
  return <div className={css.application} aria-label="青木 OS 创作工作区">
    <header className={css.header}>
      <div className={css.identity}>
        <span className={css.brand}><svg viewBox="0 0 28 32" aria-hidden="true"><path d="M14 3v26M14 7 5 14m9-7 9 7M14 15 3 24m11-9 11 9M9 29h10" /></svg><span>青木<small>QINGMU OS</small></span></span>
        {!scopeLocked && onOpenProjects && <button type="button" className={css.projectLibraryButton} aria-pressed={projectsOpen === true} onClick={onOpenProjects}>项目库</button>}
        <div className={css.project}>
          <select aria-label="项目" value={projectId} disabled={loading || scopeLocked || !projects.length} onChange={e => onProject(e.target.value)}>
            {!projects.length && <option value="">选择项目</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select aria-label="剧集" value={episodeId} disabled={loading || scopeLocked || !episodes.length} onChange={e => onEpisode(e.target.value)}>
            {!episodes.length && <option value="">选择剧集</option>}{episodes.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
      </div>
      <nav className={css.workflow} aria-label="创作流程">{steps.map(([id, label], index) => <button type="button" key={id}
        aria-current={!projectsOpen && step === id ? 'step' : undefined} onClick={() => onStep(id)}><small>{String(index + 1).padStart(2, '0')}</small><span>{label}</span></button>)}</nav>
      <div className={css.tools}>
        <button type="button" onClick={onRefresh} disabled={loading} aria-label="刷新页面">{loading ? '刷新中…' : '刷新'}</button>
        {(!scopeLocked || onOpenTools) && <div className={css.moreTools}>
          <button ref={moreButton} type="button" className={css.moreButton} aria-expanded={toolsOpen}
            aria-controls="qingmu-mobile-tools" onClick={() => { setToolsOpen(open => !open) }}>更多</button>
          {toolsOpen && <div id="qingmu-mobile-tools" className={css.moreMenu} role="group" aria-label="项目与系统操作">
            {!scopeLocked && <button type="button" onClick={() => { setToolsOpen(false); onCreate() }}>新建项目</button>}
            {onOpenTools && <button type="button" onClick={() => { setToolsOpen(false); onOpenTools() }}>系统设置</button>}
          </div>}
        </div>}
        {!scopeLocked && <button type="button" className={css.secondaryTool} onClick={onCreate}>新建项目</button>}
        {onOpenTools && <button type="button" className={css.secondaryTool} onClick={onOpenTools}>系统设置</button>}
      </div>
    </header>
    <div className={css.content} data-creative-step={step}>{children}</div>
  </div>
}
