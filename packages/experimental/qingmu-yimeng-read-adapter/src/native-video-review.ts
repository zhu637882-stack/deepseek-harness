/** Shared candidate observation read model; no submit, selection or automatic acceptance. */
interface Check {
  readonly status: string
  readonly evidence: string
  readonly time_ranges?: readonly (readonly [number, number])[]
  readonly evidenceIncomplete?: boolean
}
interface Observation { readonly id?: string; readonly start_sec: number; readonly end_sec: number; readonly description: string }
interface Transcript {
  readonly start_sec: number
  readonly end_sec: number
  readonly speaker: string
  readonly text: string
  readonly delivery: string
}
/** Attributed evidence for one candidate, distinct from comparison and adoption. */
export interface Review {
  readonly assetId: string
  readonly assetSha256: string
  readonly reviewedAssetId?: string
  readonly taskId?: string
  readonly model?: string
  readonly reviewStage?: string
  readonly comparisonIntent?: Record<string, unknown>
  readonly state: 'none' | 'pending' | 'complete' | 'failed'
  readonly designChanged?: boolean
  readonly methodChanged?: boolean
  readonly reasons?: readonly string[]
  readonly audit?: { readonly audio_review?: {
    readonly checks?: Readonly<Record<string, Check>>
    readonly transcript?: readonly Transcript[]
    readonly observations?: readonly Observation[]
  } }
  readonly visualEvidence?: { readonly checks: Readonly<Record<string, Check>>; readonly observations: readonly Observation[] }
}
/** Customer-facing auditory dimensions for legacy comparison reports. */
export const categories = { dialogue: '对白内容', delivery: '语气与表演', ambience: '环境底声', acoustics: '空间声学', foley: '动作拟音', music: '配乐衔接' }
/** Customer-facing visual dimensions for legacy comparison reports. */
export const visualCategories = { temporal_action_match: '动作与因果', camera_execution_match: '摄影与运镜', performance_match: '人物表演', continuity_match: '位置与状态连续', visual_artifact_free: '画面瑕疵', catastrophic_ai_artifact_free: '严重变形与穿模', identity_match: '人物身份', dialogue_match: '说话人与口型', narrative_intelligible: '叙事可理解性' }
/** Advisory labels; none grants selection or approval. */
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
/**
 * Project a report for the exact requested media without leaking transport fields.
 * @param raw Backend report.
 * @param scope Expected candidate bytes and optional owning scope.
 * @returns The same bounded observation view for browser and director.
 */
export function normalizeNativeVideoReview(
  raw: unknown, scope: { assetId: string; expectedSha256: string; projectId?: string; episodeId?: string; frameId?: string },
): Review {
  const value = object(raw)
  if (!['none', 'pending', 'complete', 'failed'].includes(String(value.state))
    || value.assetId !== scope.assetId || value.assetSha256 !== scope.expectedSha256
    || ['projectId', 'episodeId', 'frameId'].some(key => key in scope && value[key] !== scope[key as keyof typeof scope])) {
    throw new Error('审片结果与当前候选不一致。')
  }
  const independent = value.reviewStage === 'independent_observation'
  const audio = object(object(value.audit).audio_review)
  const transcript: Transcript[] = []
  for (const raw of Array.isArray(audio.transcript) ? audio.transcript : []) {
    const line = object(raw), range = [line.start_sec, line.end_sec]
    if (validRange(range) && typeof line.text === 'string') transcript.push({
      start_sec: range[0], end_sec: range[1], speaker: typeof line.speaker === 'string' ? line.speaker : '',
      text: line.text, delivery: typeof line.delivery === 'string' ? line.delivery : '',
    })
  }
  const readObservations = (raw: unknown): Observation[] => (Array.isArray(raw) ? raw : []).flatMap((raw) => {
    const item = object(raw), range = [item.start_sec, item.end_sec]
    return validRange(range) && typeof item.description === 'string' ? [{
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      start_sec: range[0], end_sec: range[1], description: item.description,
    }] : []
  })
  const checks = independent ? {} : readChecks(audio.checks, Object.keys(categories))
  const visual = object(value.visualEvidence)
  const observations = readObservations(visual.observations)
  return { assetId: scope.assetId, assetSha256: scope.expectedSha256,
    ...(typeof value.reviewedAssetId === 'string' ? { reviewedAssetId: value.reviewedAssetId } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.reviewStage === 'string' ? { reviewStage: value.reviewStage } : {}),
    ...(value.comparisonIntent ? { comparisonIntent: object(value.comparisonIntent) } : {}),
    state: value.state as Review['state'], designChanged: value.designChanged === true,
    methodChanged: value.methodChanged === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : [],
    audit: { audio_review: { checks, transcript, observations: readObservations(audio.observations) } },
    ...(value.visualEvidence
      ? { visualEvidence: { checks: independent ? {} : readChecks(visual.checks, Object.keys(visualCategories)), observations } } : {}) }
}


/** Read-only lookup coordinates for an owned video. */
export interface NativeVideoReviewReadRequest {
  projectId: string
  episodeId: string
  frameId: string
  assetId: string
  expectedSha256: string
}
/**
 * Validate the exact read coordinates before building the backend URL.
 * @param raw Requested lookup.
 * @returns Validated project, shot and video coordinates.
 */
export function parseNativeVideoReviewRequest(raw: unknown): NativeVideoReviewReadRequest {
  const value = object(raw), keys = ['projectId', 'episodeId', 'frameId', 'assetId', 'expectedSha256']
  if (Object.keys(value).length !== keys.length || keys.some(key => typeof value[key] !== 'string')
    || keys.slice(0, 4).some(key => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(String(value[key])))
    || !/^[a-f0-9]{64}$/u.test(String(value.expectedSha256))) throw new Error('invalid candidate review scope')
  return value as unknown as NativeVideoReviewReadRequest
}
