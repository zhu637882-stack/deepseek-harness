import type { AutomaticPlanningShot, ScenePlanningState, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

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
  return String(value)
}

/** Compare saved shot boundaries in episode order; cuts and time jumps remain director choices. */
export function ShotContinuityView({ state, shotId }: { readonly state: ScenePlanningState; readonly shotId: string }) {
  const shots = state.frameRequirements ?? state.canonicalStoryboard?.shots ?? []
  const plans = state.scenePlans ?? (state.planning ? [state.planning] : [])
  return <details>
    <summary>全片镜头衔接 · {shots.length} 镜</summary>
    <p>对照人物位置、朝向、持物、道具连接与运行状态。换场、时间跳跃和动作省略由剧本与导演解释；这里展示已保存设计，生成结果仍需审看。</p>
    <table aria-label="全片镜头状态对照">
      <thead><tr><th>镜头 / 场次</th><th>开始状态</th><th>结束状态</th></tr></thead>
      <tbody>{shots.map((shot) => {
        const continuity = continuityFields(shot)
        const other = Object.fromEntries(Object.entries(continuity).filter(([key]) => key !== 'start' && key !== 'end'))
        const scene = plans.find(plan => plan.shots.some(item => item.id === shot.id))
        const title = state.scenes?.find(item => item.sceneIndex === scene?.sceneIndex)?.title
        return <tr key={shot.id} aria-current={shot.id === shotId ? 'true' : undefined}>
          <th scope="row">{shot.frameNo} · {shot.title}{title && <small> · {title}</small>}{shot.id === shotId && '（当前）'}
            {Object.keys(other).length > 0 && <p>补充说明：{continuityText(other)}</p>}
          </th>
          <td>{continuityText(continuity.start) || '尚未设计'}</td>
          <td>{continuityText(continuity.end) || '尚未设计'}</td>
        </tr>
      })}</tbody>
    </table>
  </details>
}
