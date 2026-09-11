import { useId, useRef } from 'react'
import type { AutomaticPlanningShot, ScenePlanningState, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import css from './ShotContinuityView.module.css'

/** Preserve older free-form continuity alongside edits to explicit start/end states. */
export function continuityFields(shot: AutomaticPlanningShot | undefined): YimengCommandJsonObject {
  const value = shot?.directorPlan?.continuity
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as YimengCommandJsonObject
  return value === undefined || value === null ? {} : { notes: value }
}

/** Render authored structured states without treating absent values as continuity approval. */
export function continuityText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(continuityText).join('；')
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${continuityText(item)}`).join('；')
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

/** Compare saved shot boundaries in episode order; cuts and time jumps remain director choices. */
export function ShotContinuityView({ state, shotId, onSelectShot }: {
  readonly state: ScenePlanningState
  readonly shotId: string
  readonly onSelectShot?: ((shotId: string) => void) | undefined
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const currentRow = useRef<HTMLTableRowElement>(null)
  const titleId = useId()
  const shots = state.frameRequirements ?? state.canonicalStoryboard?.shots ?? []
  const plans = state.scenePlans ?? (state.planning ? [state.planning] : [])
  const locate = () => { currentRow.current?.scrollIntoView({ block: 'center' }) }
  return <div className={css.entry}>
    <button type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); locate() }}>全片镜头衔接 · {shots.length} 镜</button>
    <dialog ref={dialog} className={css.dialog} aria-labelledby={titleId}>
      <header className={css.header}>
        <div><h2 id={titleId}>全片镜头衔接</h2><p>{shots.length} 镜 · 已保存的导演设计</p></div>
        <button type="button" onClick={locate}>定位当前镜头</button>
        <button type="button" onClick={() => { dialog.current?.close() }}>关闭对照</button>
      </header>
      <p className={css.help}>从上一镜结束状态接到下一镜开始状态，对照位置、朝向、持物与器具状态。换场、时间跳跃和动作省略由剧本与导演安排；生成结果仍需审看。</p>
      <div className={css.scroll} tabIndex={0} role="region" aria-label="滚动查看全片镜头衔接">
        <table className={css.table} aria-label="全片镜头状态对照">
          <colgroup><col className={css.identityColumn} /><col /><col /></colgroup>
          <thead><tr><th>镜头 / 场次</th><th>开始状态</th><th>结束状态</th></tr></thead>
          <tbody>{shots.map((shot) => {
            const continuity = continuityFields(shot)
            const other = Object.fromEntries(Object.entries(continuity).filter(([key]) => key !== 'start' && key !== 'end'))
            const scene = plans.find(plan => plan.shots.some(item => item.id === shot.id))
            const title = state.scenes.find(item => item.sceneIndex === scene?.sceneIndex)?.title
            return <tr key={shot.id} ref={shot.id === shotId ? currentRow : undefined} aria-current={shot.id === shotId ? 'true' : undefined}>
              <th scope="row">{shot.frameNo} · {shot.title}{title && <small> · {title}</small>}{shot.id === shotId && '（当前）'}
                {onSelectShot && <button type="button" aria-label={`编辑镜 ${shot.frameNo} · ${shot.title}`} onClick={() => {
                  dialog.current?.close(); onSelectShot(shot.id)
                }}>编辑本镜</button>}
              </th>
              <td>{continuityText(continuity.start) || '尚未设计'}
                {Object.keys(other).length > 0 && <details><summary>补充说明</summary><p>{continuityText(other)}</p></details>}
              </td>
              <td>{continuityText(continuity.end) || '尚未设计'}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </dialog>
  </div>
}
