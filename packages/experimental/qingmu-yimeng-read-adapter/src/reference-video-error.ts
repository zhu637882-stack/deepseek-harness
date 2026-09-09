/** Safe, actionable messages for known read-only reference readiness failures. */
const messages = new Map<string, string>([
  ['422:reference_video_provider_media_missing', '参考素材尚未准备为模型可读取的文件。引用草稿已保留，可继续编辑；暂时不能预览实际请求或核价。'],
  ['422:reference_video_public_media_endpoint_missing', '模型读取素材的访问地址尚未配置。引用草稿已保留，请先完成模型素材访问配置。'],
  ['422:reference_video_local_media_unavailable', '本地参考文件暂时无法读取。请到角色与场景页核对原图，草稿中的引用仍保留。'],
  ['422:reference_video_total_audio_duration_exceeded', '参考音色总时长超过 15 秒，请缩短参考音频后重新核对。'],
  ['422:reference_video_audio_duration_invalid', '每段参考音色需要为 1 至 15 秒的有效音频，请核对这段素材。'],
  ['409:reference_video_asset_version_conflict', '参考素材的版本已变化。请重新读取项目素材，核对后替换旧引用。'],
  ['409:reference_video_asset_bytes_conflict', '参考文件与已保存的素材版本不一致。请核对原文件后重新导入，当前草稿仍保留。'],
])

/** Expose only a fixed message for a known status/code pair, never arbitrary upstream details.
 * @param value - Bounded upstream JSON.
 * @param status - Original HTTP status.
 * @returns A safe message or undefined for the existing generic error path.
 */
export function referenceVideoErrorMessage(value: unknown, status: number): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const detail = (value as Record<string, unknown>).detail
  if (detail === null || typeof detail !== 'object') return undefined
  const code = (detail as Record<string, unknown>).code
  return typeof code === 'string' ? messages.get(`${status}:${code}`) : undefined
}
