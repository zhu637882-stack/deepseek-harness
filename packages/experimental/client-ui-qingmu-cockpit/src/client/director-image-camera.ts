/** Starting-image geometry shared by new scene design and existing-scene coordination. */
import { imageObjectStateGuidance } from './image-object-states.ts'
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function vector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
}
/**
 * Check whether an explicitly supplied starting camera can be compiled.
 * @param value Model-authored camera or intentional null opt-out.
 * @returns Whether coordinates and field of view are usable; not a visual approval.
 */
export function validImageCamera(value: unknown): boolean {
  return value === null || object(value) && vector(value.position) && vector(value.target)
    && value.position.some((n, index) => n !== (value.target as number[])[index])
    && typeof value.verticalFov === 'number' && value.verticalFov >= 10 && value.verticalFov <= 120
    && (value.roll === undefined || typeof value.roll === 'number' && Number.isFinite(value.roll))
}

/** Explicit camera delivery keeps written staging connected to the starting-image request. */
export const imageCameraGuidance = imageObjectStateGuidance + '\n' + '本场存在 sceneLayout 时，每镜必须明确输出 directorPlan.imageCamera：使用构图就给出完整 {position:[x,y,z],target:[x,y,z],verticalFov:角度,roll:角度}，沿用原机位也逐字给出；导演选择本镜不用空间构图时明确给 null 并说明理由。先用 qingmu_preview_scene_layout 对同一完整布局预览拟采用机位，检查门窗、遮挡和取景；verticalFov 是垂直视角，不能把焦距或水平角直接写入。再用 qingmu_check_camera_geometry，layout 直接给 {coordinateFrame,basis,aspectRatio,imageCamera,landmarks:[{id,label,position:[x,y,z]}]}：逐字复制拟保存的 imageCamera 与本片画幅，人物头、手、脚和道具端点按共用坐标分别核对，工具自动换算水平视角；不要自行把垂直角当水平角，也不能把画外人物写成同框。画内点仍可能被遮挡，结合布局预览判断。imageCamera 控制起始图构图，后续运镜仍按 cameraMovement/actionBeats 设计，不限制运动。'
