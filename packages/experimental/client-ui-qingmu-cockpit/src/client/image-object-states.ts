/** Shared parsing and authoring of an image's changes to its scene objects. */
import type { ImageObjectState, YimengCommandJsonObject } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

/** Validate model/durable object staging without inventing positions or deleting source data.
 * @param value Optional authored states; null clears them.
 * @returns The supplied states after structural checks; semantic decisions remain with the director.
 */
export function imageObjectStates(value: unknown): readonly ImageObjectState[] | null {
  if (value == null) return null
  const ids = new Set<string>()
  if (!Array.isArray(value) || value.length > 60) throw new Error('本图物件布置需要不超过60项的列表。')
  for (const row of value as unknown[]) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('本图物件布置格式不完整。')
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)
      || typeof item.basis !== 'string' || !item.basis.trim()) throw new Error('本图物件需要唯一的共用编号和布置依据。')
    ids.add(item.id)
    if (item.visible !== undefined && typeof item.visible !== 'boolean') throw new Error('本图物件是否保留需要布尔值。')
    for (const key of ['center', 'size']) {
      const vector = item[key]
      if (vector != null && (!Array.isArray(vector) || vector.length !== 3
        || vector.some(n => typeof n !== 'number' || !Number.isFinite(n) || n > 1000 || n < -1000 || key === 'size' && n <= 0))) throw new Error('本图物件的位置或尺寸无效。')
    }
    if (item.rotation != null && (typeof item.rotation !== 'number' || !Number.isFinite(item.rotation) || Math.abs(item.rotation) > 360)) throw new Error('本图物件旋转角度无效。')
  }
  return value as ImageObjectState[]
}

/** Convert editor values into the existing JSON director plan.
 * @param states Typed image placements.
 * @returns Mutable JSON values accepted by the current scene-planning writer.
 */
export function objectStatesJson(states: readonly ImageObjectState[]): YimengCommandJsonObject[] {
  return states.map(row => ({ id: row.id, basis: row.basis,
    ...(row.visible === undefined ? {} : { visible: row.visible }),
    ...(row.center === undefined ? {} : { center: row.center ? [...row.center] : null }),
    ...(row.size === undefined ? {} : { size: row.size ? [...row.size] : null }),
    ...(row.rotation === undefined ? {} : { rotation: row.rotation }) }))
}

/** The same state delivery applies to asset images and shot starting frames. */
export const imageObjectStateGuidance = '同一物件在本图中被拿走、移位、转动或改变形态时，在素材或 directorPlan 的 imageObjectStates 中按共用 sceneLayout.objects 的真实 id 写明 {id,basis,visible?,center?,size?,rotation?}；basis 说明当前剧情或取景依据。visible:false 表示这个体块在本图中不存在，不表示应把它遮挡显示；未列出的物件沿用共用位置。每个编号最多一次，不创建第二个实例。center 是三维中心坐标，size 是三轴完整尺寸，位置与大小的关系据此核算；不可把顶面高度当中心高度。整组只作用于本图，不修改其他镜头的共用布局。把相同 imageObjectStates 连同原共用 layout、camera 送入 qingmu_preview_scene_layout 核对，再完整保存；不能只修改文字状态而让构图仍停在旧位置。动作后的摆放留给对应后续镜头，当前 imageStage 和 imagePrompt 只交付这个时刻。主体身份、场地固定关系与当下持有/开关状态分开，互相不能复制为永久特征。'
