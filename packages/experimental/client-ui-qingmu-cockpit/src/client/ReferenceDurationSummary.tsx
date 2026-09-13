import type { ReferenceVideoAsset } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

/** Catalog estimates aid reference selection; Writer still inspects the actual bytes. */
export function ReferenceDurationSummary({ assets, outputDuration }: {
  readonly assets: readonly { readonly mediaType: ReferenceVideoAsset['mediaType'] | 'unavailable'; readonly durationSec?: number }[]
  readonly outputDuration: number
}) {
  const groups = (['reference_audio', 'reference_video'] as const).map((mediaType) => {
    const clips = assets.filter(asset => asset.mediaType === mediaType)
    const known = clips.filter(asset => asset.durationSec !== undefined)
    const total = known.reduce((sum, asset) => sum + (asset.durationSec ?? 0), 0)
    return { mediaType, clips, total, unknown: clips.length - known.length,
      invalidClip: known.some(asset => (asset.durationSec ?? 0) < 1 || (asset.durationSec ?? 0) > 15) }
  }).filter(group => group.clips.length > 0)
  if (!groups.length) return null
  return <div aria-label="引用时长核对">
    {groups.map(({ mediaType, clips, total, unknown, invalidClip }) => {
      const video = mediaType === 'reference_video'
      const exceeded = clips.length > 5 || total > 15 || invalidClip || (video && total + outputDuration > 30)
      return <p key={mediaType} role={exceeded ? 'alert' : undefined}>
        {video ? '参考视频' : '参考音色'}：{clips.length} 段，{unknown ? '已知部分 ' : '合计 '}{total.toFixed(3)} 秒 / 15 秒。
        {unknown > 0 && <>另有 {unknown} 段时长未知；请读取项目素材核对，未知时长不按零秒算。</>}
        {video && <>输入视频加生成时长：{(total + outputDuration).toFixed(3)} 秒 / 30 秒{unknown > 0 ? '（尚不完整）' : ''}。</>}
        {exceeded && <>已超出当前模型限制：每类最多 5 段，每段 1–15 秒。请缩短样本或移除本镜不需要的参考，保留导演要求的说话人和对白。</>}
      </p>
    })}
    <small>时长来自素材记录，准备生成时会检查原文件；尚未确认可提交。</small>
  </div>
}
