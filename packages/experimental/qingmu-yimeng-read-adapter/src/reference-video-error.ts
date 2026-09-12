/** Safe, actionable messages for known read-only reference readiness failures. */
const messages = new Map<string, string>([
  ['409:reference_video_director_source_conflict', '导演设计或全片设定已更新。请读取当前设计，整理生成稿并保存后再核价；原稿仍可恢复编辑。'],
  ['422:reference_video_material_not_prepared', '请先保存此镜头，再准备引用素材；完成后可预览实际阿里请求。'],
  ['422:reference_video_material_expired', '引用素材的临时有效期已结束，请重新准备后再预览。'],
  ['422:reference_video_material_unknown', '素材上传结果待确认，请读取准备状态；当前不会自动重传。'],
  ['422:reference_video_material_uploading', '素材正在准备，请稍后读取准备状态。'],
  ['422:reference_video_material_failed', '素材准备失败，请检查当前状态后重新准备。'],
  ['422:reference_video_upload_endpoint_unsupported', '当前阿里连接尚未配置临时素材通道，请在模型连接中配置阿里北京直连。'],
  ['422:reference_video_upload_credentials_missing', '请先配置阿里凭据，再准备引用素材。'],
  ['409:reference_video_upload_receipt_integrity_conflict', '素材准备回执与来源不一致，请核对原素材；当前不会重传。'],
  ['422:reference_video_provider_media_missing', '参考素材尚未准备为模型可读取的文件。引用草稿已保留，可继续编辑；暂时不能预览实际请求或核价。'],
  ['422:reference_video_public_media_endpoint_missing', '模型读取素材的访问地址尚未配置。引用草稿已保留，请先完成模型素材访问配置。'],
  ['422:reference_video_local_media_unavailable', '本地参考文件暂时无法读取。请到角色与场景页核对原图，草稿中的引用仍保留。'],
  ['422:reference_video_total_audio_duration_exceeded', '参考音色总时长超过 15 秒，请缩短参考音频后重新核对。'],
  ['422:reference_video_audio_duration_invalid', '每段参考音色需要为 1 至 15 秒的有效音频，请核对这段素材。'],
  ['422:reference_video_video_format_unsupported', '参考视频需要为 MP4 或 MOV 文件，请核对源片格式。'],
  ['422:reference_video_video_probe_failed', '无法读取参考视频的画面信息，请检查源片是否完整。'],
  ['422:reference_video_video_duration_invalid', '每段参考视频需要为 1 至 15 秒，请先截取需要参考的片段。'],
  ['422:reference_video_video_frame_rate_invalid', '参考视频帧率需要至少 16 帧每秒，请选择符合要求的源片。'],
  ['422:reference_video_video_dimensions_invalid', '参考视频宽高均需为 240 至 4096 像素，长短边比例不得超过 8。'],
  ['422:reference_video_total_video_duration_exceeded', '最多引用 5 段视频，总时长不超过 15 秒，请缩短或减少参考片段。'],
  ['422:reference_video_combined_duration_exceeded', '参考视频总时长与生成时长相加不能超过 30 秒，请调整其中一项。'],
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
