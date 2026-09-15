import { normalizeNativeVideoReview, categories, visualCategories, type Review } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/native-video-review'
export { categories, visualCategories, statuses, type Review } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/native-video-review'

export interface NativeVideoReviewScope {
  readonly episodeId: string
  readonly frameId: string
  readonly assetId: string
  readonly sha256: string
}

/** Shared single/batch review boundary: bind returned evidence to the exact candidate bytes. */
export async function requestNativeVideoReview(scope: NativeVideoReviewScope, method: 'GET' | 'POST', signal?: AbortSignal): Promise<Review> {
  const url = `/api/qingmu/native-video-review?${new URLSearchParams({ ...scope }).toString()}`
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    ...(signal === undefined ? {} : { signal }) })
  if (!response.ok) throw new Error('审片记录暂未取得，请刷新查看原任务。')
  const result: unknown = await response.json()
  return normalizeNativeVideoReview(result, { assetId: scope.assetId, expectedSha256: scope.sha256 })
}

export function reviewSummary(review: Review): string {
  if (review.state === 'none') return '尚未检查'
  if (review.state === 'pending') return '正在检查'
  if (review.state === 'failed') return '检查未完成，可重试'
  if (review.designChanged || review.methodChanged) return '来源或检查方法已更新，待重新检查'
  if (review.reviewStage === 'independent_observation') return '独立观察已完成，待导演对照'
  const checks = [...Object.values(review.audit?.audio_review?.checks ?? {}), ...Object.values(review.visualEvidence?.checks ?? {})]
  if (!checks.length) return '没有可用证据，需人工核对'
  const issues = checks.filter(check => check.status === 'fail').length
  const unknown = checks.filter(check => !['pass', 'fail', 'not_applicable'].includes(check.status) || check.evidenceIncomplete).length
    + Object.keys(categories).length + Object.keys(visualCategories).length - checks.length
  return `${issues} 项需调整${unknown ? ` · ${unknown} 项待核实` : ''}`
}
