/** Merge versioned references without changing this shot's text, parameters or existing order. */
import type { ReferenceVideoBinding, ReferenceVideoDraftResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

export interface ReferenceForInheritance extends ReferenceVideoBinding {
  readonly mediaType: 'reference_image' | 'reference_audio' | 'unavailable'
}

/** Return the merged references or a conflict; never substitute a different version or token. */
export function inheritReferenceBindings<T extends ReferenceForInheritance>(
  current: readonly T[], source: ReferenceVideoDraftResponse,
): readonly (T | ReferenceForInheritance)[] {
  if (!source.draft || source.draft.request.bindings.length === 0) throw new Error('来源镜头还没有已保存的引用。')
  const merged: (T | ReferenceForInheritance)[] = [...current]
  for (const binding of source.draft.request.bindings) {
    const mediaType = source.mediaTypes[binding.bindingToken]
    if (!mediaType) throw new Error(`“${binding.label}”的来源已失效，请先在来源镜头核对素材。`)
    const byToken = merged.find(item => item.bindingToken === binding.bindingToken)
    if (byToken && (byToken.assetId !== binding.assetId || byToken.assetSha256 !== binding.assetSha256)) {
      throw new Error(`“${binding.label}”的引用标记与当前镜头冲突；请先手动核对，当前引用未改动。`)
    }
    const byAsset = merged.find(item => item.assetId === binding.assetId)
    if (byAsset && (byAsset.assetSha256 !== binding.assetSha256 || byAsset.mediaType !== mediaType)) {
      throw new Error(`“${binding.label}”在两个镜头使用不同版本；请先决定保留哪个版本。`)
    }
    if (!byToken && !byAsset) merged.push({ ...binding, mediaType })
  }
  if (merged.filter(item => item.mediaType === 'reference_image').length > 10
    || merged.filter(item => item.mediaType === 'reference_audio').length > 5) {
    throw new Error('合并后超过 10 张图片或 5 段音色，请先精简当前引用。')
  }
  return merged
}
