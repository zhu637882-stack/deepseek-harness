import type { AssetDesignItem } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

/** Edit shared scene geography and a single frame's staging without changing approved media.
 * @param props - This asset, the episode's scenes and the existing draft edit callback.
 * @returns Optional spatial fields inside the existing asset editor.
 */
export function AssetSpatialDesign({ item, assets, onChange }: {
  readonly item: AssetDesignItem
  readonly assets: readonly AssetDesignItem[]
  readonly onChange: (patch: Partial<AssetDesignItem>) => void
}) {
  const spaceFields = [
    ['orientation', '方位参照', '以入口、窗墙等固定位置描述方向，反打时仍沿用同一参照'],
    ['layout', '格局与固定物', '门窗、主要家具、活动区域及通道的相对位置；按剧情需要决定丰富度与留白'],
    ['scale', '尺度与依据', '房间、家具和道具的大小关系；区分剧本事实、导演设计与尚未确定的尺寸'],
    ['lighting', '固定光源', '窗、灯具等实际光源所在位置；本图的时段与开关状态由当前画面决定'],
  ] as const
  const stageFields = [
    ['camera', '摄影机位置与取景', '摄影机在哪里、朝向哪里、看见哪些区域；沿用场景的方位参照'],
    ['blocking', '本图人物站位', '人物相对门窗或家具的位置、朝向与遮挡关系'],
    ['state', '本图物件状态', '当前持有、开合、摆放、连接状态；后续动作留给对应剧情时刻'],
  ] as const
  return <>
    {item.kind === 'scene' && <details><summary>共用场景布局{item.space ? '' : ' · 尚未单独整理'}</summary>
      <p>同一场景的不同角度共用这份布局。原有描述保留；可让导演结合剧本整理，也可直接编辑。</p>
      {spaceFields.map(([field, label, placeholder]) => <label key={field}>{label}<textarea
        value={item.space?.[field] ?? ''} placeholder={placeholder}
        onChange={(event) => { onChange({ space: { ...item.space, [field]: event.target.value } }) }} /></label>)}
    </details>}
    <details><summary>本图取景与状态</summary>
      {item.kind === 'scene' ? <p>取景场景：{item.name}，沿用上方共用布局。</p>
        : <label>取景场景<select value={item.imageStage?.sceneName ?? ''}
          onChange={(event) => { onChange({ imageStage: { ...item.imageStage, sceneName: event.target.value || null } }) }}>
          <option value="">不绑定场景 · 定妆或道具展示</option>
          {assets.filter(asset => asset.kind === 'scene').map(scene => <option key={scene.name} value={scene.name}>{scene.name}</option>)}
        </select></label>}
      {stageFields.map(([field, label, placeholder]) => <label key={field}>{label}<textarea
        value={item.imageStage?.[field] ?? ''} placeholder={placeholder}
        onChange={(event) => { onChange({ imageStage: { ...item.imageStage, [field]: event.target.value } }) }} /></label>)}
      <p>这些是本张图的取景与当下状态；后续分镜由导演依据剧情继续设计。</p>
    </details>
  </>
}
