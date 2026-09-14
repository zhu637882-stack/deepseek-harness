interface Check {
  readonly status: string
  readonly evidence: string
  readonly time_ranges?: readonly (readonly [number, number])[]
  readonly evidenceIncomplete?: boolean
}
interface Observation { readonly start_sec: number; readonly end_sec: number; readonly description: string }
export interface Review {
  readonly state: 'none' | 'pending' | 'complete' | 'failed'
  readonly designChanged?: boolean
  readonly methodChanged?: boolean
  readonly reasons?: readonly string[]
  readonly audit?: { readonly audio_review?: { readonly checks?: Readonly<Record<string, Check>> } }
  readonly visualEvidence?: { readonly checks: Readonly<Record<string, Check>>; readonly observations: readonly Observation[] }
}
export const categories = { dialogue: '对白内容', delivery: '语气与表演', ambience: '环境底声', acoustics: '空间声学', foley: '动作拟音', music: '配乐衔接' }
export const visualCategories = { temporal_action_match: '动作与因果', camera_execution_match: '摄影与运镜', performance_match: '人物表演', continuity_match: '位置与状态连续', visual_artifact_free: '画面瑕疵', catastrophic_ai_artifact_free: '严重变形与穿模', identity_match: '人物身份', dialogue_match: '说话人与口型', narrative_intelligible: '叙事可理解性' }
export const statuses: Readonly<Record<string, string>> = { pass: '未发现问题', fail: '需调整', unverified: '无法确认', not_applicable: '本镜不涉及' }

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function validRange(range: unknown): range is [number, number] {
  return Array.isArray(range) && range.length === 2 && range.every(n => typeof n === 'number' && Number.isFinite(n)) && range[0] >= 0 && range[1] > range[0]
}
function readChecks(value: unknown, keys: readonly string[]): Record<string, Check> {
  const raw = object(value)
  const checks: Record<string, Check> = {}
  for (const key of keys) {
    const check = object(raw[key])
    if (typeof check.status !== 'string' || typeof check.evidence !== 'string') continue
    checks[key] = { status: check.status, evidence: check.evidence, evidenceIncomplete: check.evidenceIncomplete === true,
      time_ranges: Array.isArray(check.time_ranges) ? check.time_ranges.filter(validRange) : [] }
  }
  return checks
}
function report(value: Record<string, unknown>): Review {
  const checks = readChecks(object(object(value.audit).audio_review).checks, Object.keys(categories))
  const visual = object(value.visualEvidence)
  const observations: Observation[] = []
  for (const raw of Array.isArray(visual.observations) ? visual.observations : []) {
    const item = object(raw)
    const range = [item.start_sec, item.end_sec]
    if (validRange(range) && typeof item.description === 'string') {
      observations.push({ start_sec: range[0], end_sec: range[1], description: item.description })
    }
  }
  return { state: value.state as Review['state'], designChanged: value.designChanged === true,
    methodChanged: value.methodChanged === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : [],
    audit: { audio_review: { checks } },
    ...(value.visualEvidence
      ? { visualEvidence: { checks: readChecks(visual.checks, Object.keys(visualCategories)), observations } } : {}) }
}

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
  if (typeof result !== 'object' || result === null || !('state' in result)
    || !['none', 'pending', 'complete', 'failed'].includes(String(result.state))
    || !('assetId' in result) || result.assetId !== scope.assetId
    || !('assetSha256' in result) || result.assetSha256 !== scope.sha256) throw new Error('审片结果与当前候选不一致。')
  return report(result as Record<string, unknown>)
}

export function reviewSummary(review: Review): string {
  if (review.state === 'none') return '尚未检查'
  if (review.state === 'pending') return '正在检查'
  if (review.state === 'failed') return '检查未完成，可重试'
  if (review.designChanged || review.methodChanged) return '来源或检查方法已更新，待重新检查'
  const checks = [...Object.values(review.audit?.audio_review?.checks ?? {}), ...Object.values(review.visualEvidence?.checks ?? {})]
  if (!checks.length) return '没有可用证据，需人工核对'
  const issues = checks.filter(check => check.status === 'fail').length
  const unknown = checks.filter(check => !['pass', 'fail', 'not_applicable'].includes(check.status) || check.evidenceIncomplete).length
    + Object.keys(categories).length + Object.keys(visualCategories).length - checks.length
  return `${issues} 项需调整${unknown ? ` · ${unknown} 项待核实` : ''}`
}
