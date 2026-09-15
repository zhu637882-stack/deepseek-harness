/** Validate the browser draft and the read-only Writer compilation response. */
import { localSignedMediaUrl } from './local-media-url.ts'
import { referenceImageDesign } from './reference-image-design.ts'
import type {
  ReferenceVideoAsset, ReferenceVideoAssetsRequest, ReferenceVideoAssetsResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse,
  ReferenceVideoDraftResponse, ReferenceDirectorSource,
  ReferenceVideoQuoteRequest, ReferenceVideoQuoteResponse,
} from './reference-video-types.ts'

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  const result = value as Record<string, unknown>
  if (keys && Object.keys(result).some(key => !keys.includes(key))) throw new Error('unexpected fields')
  return result
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value)) throw new Error('invalid identifier')
}
function sha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('invalid source SHA')
}
function directorSource(value: unknown): ReferenceDirectorSource | null {
  if (value === null) return null
  const v = object(value, ['sha256', 'prompt', 'generationPrompt'])
  sha(v.sha256)
  if (typeof v.prompt !== 'string' || !v.prompt) throw new Error('missing director design')
  if (v.generationPrompt !== undefined && (typeof v.generationPrompt !== 'string' || !v.generationPrompt)) throw new Error('invalid production design')
  return { sha256: v.sha256, prompt: v.prompt,
    ...(v.generationPrompt !== undefined ? { generationPrompt: v.generationPrompt as string } : {}) }
}
function integer(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid number')
}

/** Require the visible editor to exactly match the requested saved version.
 * @param value - Visible draft plus saved identity.
 * @param digest - Canonical JSON digest.
 * @returns A validated read-only pricing request.
 */
export function parseReferenceVideoQuoteRequest(
  value: unknown, digest: (value: unknown, label: string) => string,
): ReferenceVideoQuoteRequest {
  const v = object(value)
  const { draftRevision, draftRequestSha256, ...draft } = v
  integer(draftRevision, 1, Number.MAX_SAFE_INTEGER); sha(draftRequestSha256)
  const { projectId: _projectId, ...body } = parseReferenceVideoRequest(draft)
  if (digest(body, 'quote.request') !== draftRequestSha256) throw new Error('save current edits before pricing')
  return value as ReferenceVideoQuoteRequest
}

/** Verify pricing against both the exact preview and the saved draft identity.
 * @param value - Writer pricing response.
 * @param request - Original visible saved draft.
 * @param digest - Canonical JSON digest.
 * @returns A price estimate, never a reservation or permission to generate.
 */
export function normalizeReferenceVideoQuote(
  value: unknown, request: ReferenceVideoQuoteRequest, digest: (value: unknown, label: string) => string,
): ReferenceVideoQuoteResponse {
  const v = object(value, ['schema', 'projectId', 'frameId', 'draftRevision', 'draftRequestSha256', 'sourceSha256', 'quoteSha256', 'generationSubmissionEnabled', 'preview', 'cost', 'readOnly', 'providerCalls', 'databaseWrites', 'budgetReservedCny', 'generationQueued'])
  if (v.schema !== 'jason.reference-video-quote.v1' || v.projectId !== request.projectId || v.frameId !== request.frameId
    || v.draftRevision !== request.draftRevision || v.draftRequestSha256 !== request.draftRequestSha256
    || typeof v.generationSubmissionEnabled !== 'boolean'
    || v.readOnly !== true || v.providerCalls !== 0 || v.databaseWrites !== 0 || v.budgetReservedCny !== 0 || v.generationQueued !== false) throw new Error('quote identity or effects changed')
  const preview = normalizeReferenceVideoPreview(v.preview, request, digest)
  if (!preview.directorSourceAligned || v.sourceSha256 !== preview.sourceSha256) throw new Error('quote source changed')
  const c = object(v.cost, ['provider', 'region', 'currency', 'basis', 'unit', 'unitPriceCny', 'billableSeconds', 'estimatedCny', 'candidateCount', 'maxAttempts', 'accountDiscountApplied', 'pricingSha256', 'pricingCheckedAt', 'sourceUrl'])
  if (c.provider !== 'dashscope' || c.region !== 'cn-beijing' || c.currency !== 'CNY' || c.basis !== 'catalog_list_price' || c.unit !== 'second'
    || c.billableSeconds !== preview.body.parameters.duration + (preview.referenceVideoDurationSec ?? 0)
    || c.candidateCount !== 1 || c.maxAttempts !== 1
    || c.accountDiscountApplied !== false
    || c.sourceUrl !== 'https://help.aliyun.com/zh/model-studio/model-pricing') throw new Error('quote basis changed')
  for (const amount of [c.unitPriceCny, c.estimatedCny]) {
    if (typeof amount !== 'string' || !/^[0-9]{1,9}\.[0-9]{6}$/u.test(amount) || Number(amount) <= 0) throw new Error('invalid price')
  }
  const microAmount = Number(c.unitPriceCny) * c.billableSeconds * 1e6
  const expectedMicro = (preview.referenceVideoDurationSec ?? 0) > 0 ? Math.ceil(microAmount - 1e-6) : Math.round(microAmount)
  if (expectedMicro !== Math.round(Number(c.estimatedCny) * 1e6)) throw new Error('quote arithmetic changed')
  sha(c.pricingSha256); sha(v.quoteSha256)
  if (typeof c.pricingCheckedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(c.pricingCheckedAt)) throw new Error('pricing date missing')
  const projection = { projectId: v.projectId, frameId: v.frameId, draftRevision: v.draftRevision, draftRequestSha256: v.draftRequestSha256,
    sourceSha256: v.sourceSha256, cost: c, generationSubmissionEnabled: v.generationSubmissionEnabled }
  const hashProjection = (preview.referenceVideoDurationSec ?? 0) > 0
    ? { ...projection, cost: { ...c, billableSeconds: c.billableSeconds.toFixed(6) } } : projection
  if (digest(hashProjection, 'quote.projection') !== v.quoteSha256) throw new Error('quote checksum changed')
  return value as ReferenceVideoQuoteResponse
}

/** Validate a scoped draft read.
 * @param value - Browser scope.
 * @returns Exact project and shot identifiers.
 */
export function parseReferenceVideoDraftScope(value: unknown): { projectId: string; frameId: string } {
  const v = object(value, ['projectId', 'frameId'])
  id(v.projectId); id(v.frameId)
  if (v.directorSourceSha256 !== undefined) sha(v.directorSourceSha256)
  return { projectId: v.projectId, frameId: v.frameId }
}

/** Verify persisted draft identity and verbatim request checksum.
 * @param value - Writer snapshot.
 * @param scope - Requested shot.
 * @param digest - Canonical JSON hash.
 * @returns A draft snapshot whose body and identity are consistent.
 */
export function normalizeReferenceVideoDraft(
  value: unknown, scope: { projectId: string; frameId: string }, digest: (value: unknown, label: string) => string,
): ReferenceVideoDraftResponse {
  const v = object(value, ['schema', 'projectId', 'frameId', 'frameSha256', 'directorSource', 'draft', 'mediaTypes', 'providerCalls', 'generationQueued'])
  if (v.schema !== 'jason.reference-video-draft.v1' || v.projectId !== scope.projectId || v.frameId !== scope.frameId
    || v.providerCalls !== 0 || v.generationQueued !== false) throw new Error('draft scope or effects changed')
  sha(v.frameSha256); directorSource(v.directorSource)
  const types = object(v.mediaTypes)
  if (v.draft !== null) {
    const d = object(v.draft, ['revision', 'frameSha256', 'requestSha256', 'request', 'savedAt'])
    integer(d.revision, 1, Number.MAX_SAFE_INTEGER); sha(d.frameSha256); sha(d.requestSha256)
    const body = object(d.request, ['frameId', 'model', 'bindings', 'promptParts', 'parameters', 'directorSourceSha256', 'preparationFeedback'])
    const request = parseReferenceVideoRequest({ ...body, projectId: scope.projectId })
    if (request.frameId !== scope.frameId || digest(body, 'draft.request') !== d.requestSha256
      || typeof d.savedAt !== 'string' || !Number.isFinite(Date.parse(d.savedAt))) throw new Error('draft content mismatch')
    if (Object.keys(types).length !== request.bindings.length || request.bindings.some(b =>
      !Object.hasOwn(types, b.bindingToken) || ![null, 'reference_image', 'reference_audio', 'reference_video'].includes(types[b.bindingToken] as null | string))) throw new Error('draft media kind mismatch')
  } else if (Object.keys(types).length) throw new Error('unexpected draft media')
  return value as ReferenceVideoDraftResponse
}

/** Validate explicit source tokens and bounded model controls before HTTP.
 * @param value - Untrusted browser draft.
 * @returns The validated draft, with no implicit rewriting.
 */
export function parseReferenceVideoRequest(value: unknown): ReferenceVideoPreviewRequest {
  const v = object(value, ['projectId', 'frameId', 'model', 'bindings', 'promptParts', 'parameters', 'directorSourceSha256', 'preparationFeedback'])
  id(v.projectId); id(v.frameId)
  if (v.directorSourceSha256 !== undefined) sha(v.directorSourceSha256)
  if (v.preparationFeedback !== undefined && (typeof v.preparationFeedback !== 'string'
    || Array.from(v.preparationFeedback).length > 20000)) throw new Error('invalid preparation feedback')
  if (v.model !== 'wan3.0-video' || !Array.isArray(v.bindings) || v.bindings.length < 1 || v.bindings.length > 20) throw new Error('invalid references')
  const tokens = new Set<string>()
  for (const entry of v.bindings) {
    const b = object(entry, ['bindingToken', 'assetId', 'assetSha256', 'label', 'frameRole'])
    id(b.bindingToken); id(b.assetId); sha(b.assetSha256)
    if (tokens.has(b.bindingToken) || typeof b.label !== 'string' || Array.from(b.label).length < 1 || Array.from(b.label).length > 128) throw new Error('invalid binding')
    if (b.frameRole !== undefined && b.frameRole !== 'first_frame' && b.frameRole !== 'last_frame') throw new Error('invalid frame role')
    tokens.add(b.bindingToken)
  }
  const roles = v.bindings.map(entry => (entry as Record<string, unknown>).frameRole)
  if (roles.some(role => role !== undefined) && (roles.filter(role => role === 'first_frame').length !== 1
    || roles.filter(role => role === 'last_frame').length > 1 || roles.includes(undefined))) throw new Error('Use one first frame and at most one last frame, without other references.')
  if (!Array.isArray(v.promptParts) || v.promptParts.length < 1 || v.promptParts.length > 200) throw new Error('invalid prompt')
  let length = 0
  for (const entry of v.promptParts) {
    const p = object(entry, ['text', 'bindingToken'])
    if (Object.keys(p).length !== 1) throw new Error('ambiguous prompt part')
    if ('text' in p) {
      if (typeof p.text !== 'string') throw new Error('invalid prompt text')
      length += Array.from(p.text).length
    } else if (typeof p.bindingToken !== 'string' || !tokens.has(p.bindingToken)) throw new Error('missing reference')
  }
  if (length > 20000) throw new Error('prompt too long')
  const p = object(v.parameters, ['duration', 'resolution', 'ratio', 'audio', 'prompt_extend', 'seed'])
  integer(p.duration, 2, 30)
  if (!['480P', '720P', '1080P'].includes(String(p.resolution))
    || !['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(String(p.ratio))
    || typeof p.audio !== 'boolean' || typeof p.prompt_extend !== 'boolean') throw new Error('invalid controls')
  if (p.seed !== undefined) integer(p.seed, -1, 2147483647)
  return value as ReferenceVideoPreviewRequest
}

/** Check scope, exact authored text, reference ordering and the emitted body SHA.
 * @param value - Writer response.
 * @param request - Original explicit draft.
 * @param digest - Existing Python-compatible canonical JSON digest.
 * @returns Verified read-only preview.
 */
export function normalizeReferenceVideoPreview(
  value: unknown, request: ReferenceVideoPreviewRequest, digest: (value: unknown, label: string) => string,
): ReferenceVideoPreviewResponse {
  const v = object(value, ['schema', 'projectId', 'frameId', 'body', 'referenceMapping', 'requestBodySha256', 'sourceSha256', 'readOnly', 'databaseWrites', 'providerCalls', 'submissionReady', 'remainingChecks', 'referenceAudioDurationSec', 'referenceVideoDurationSec', 'directorSource', 'directorSourceAligned'])
  if (v.schema !== 'jason.reference-video-request-preview.v1' || v.projectId !== request.projectId || v.frameId !== request.frameId
    || v.readOnly !== true || v.databaseWrites !== 0 || v.providerCalls !== 0 || v.submissionReady !== false) throw new Error('preview scope or effects changed')
  sha(v.requestBodySha256); sha(v.sourceSha256)
  const source = directorSource(v.directorSource)
  if (v.directorSourceAligned !== (request.directorSourceSha256 === source?.sha256)) throw new Error('director source changed')
  const body = object(v.body, ['model', 'input', 'parameters'])
  const input = object(body.input, ['prompt', 'media'])
  if (body.model !== request.model || !Array.isArray(v.referenceMapping) || !Array.isArray(input.media)
    || v.referenceMapping.length !== request.bindings.length || input.media.length !== request.bindings.length) throw new Error('reference count changed')
  const aliases = new Map<string, string>()
  let images = 0; let audios = 0; let videos = 0
  v.referenceMapping.forEach((entry, index) => {
    const mapping = object(entry, ['bindingToken', 'assetId', 'assetSha256', 'label', 'alias', 'mediaType', 'mediaIndex', 'frameRole'])
    const binding = request.bindings[index]
    if (!binding) throw new Error('reference count changed')
    if (Object.entries(binding).some(([key, expected]) => mapping[key] !== expected) || mapping.mediaIndex !== index) throw new Error('reference source changed')
    const media = object(input.media instanceof Array ? input.media[index] : undefined, ['type', 'url'])
    if (mapping.mediaType !== media.type || !['reference_image', 'reference_audio', 'reference_video', 'first_frame', 'last_frame'].includes(String(media.type))) throw new Error('media kind changed')
    if (mapping.frameRole !== binding.frameRole || (binding.frameRole !== undefined
      ? media.type !== binding.frameRole : media.type === 'first_frame' || media.type === 'last_frame')) throw new Error('frame role changed')
    const alias = media.type === 'reference_image' || media.type === 'first_frame' || media.type === 'last_frame' ? `图${++images}` : media.type === 'reference_audio' ? `音频${++audios}` : `视频${++videos}`
    if (mapping.alias !== alias || typeof media.url !== 'string') throw new Error('reference alias changed')
    const url = new URL(media.url)
    const temporary = media.url.length <= 2048
      && /^oss:\/\/dashscope-instant\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(media.url)
    if (!temporary && (url.protocol !== 'https:' || url.username || url.password || url.hash)) throw new Error('unsafe media URL')
    aliases.set(binding.bindingToken, alias)
  })
  const authored = request.promptParts.map(part => 'text' in part ? part.text : aliases.get(part.bindingToken)).join('')
  const videoDuration = v.referenceVideoDurationSec
  if (videos > 0
    ? typeof videoDuration !== 'number' || !Number.isFinite(videoDuration)
      || videoDuration < videos || videoDuration > 15 || videoDuration + request.parameters.duration > 30
    : videoDuration !== undefined && videoDuration !== 0) throw new Error('input video duration missing or invalid')
  if (input.prompt !== authored || images + videos < 1 || images > 10 || audios > 5 || videos > 5
    || digest(body.parameters, 'parameters') !== digest({ ...request.parameters, watermark: false }, 'parameters')
    || digest(v.body, 'reference video body') !== v.requestBodySha256) throw new Error('compiled request changed')
  if (typeof v.referenceAudioDurationSec !== 'number' || !Number.isFinite(v.referenceAudioDurationSec)
    || v.referenceAudioDurationSec < 0 || v.referenceAudioDurationSec > 15
    || !Array.isArray(v.remainingChecks) || v.remainingChecks.join(',') !== 'source_revalidation_at_dispatch,provider_media_reachability,generation_authorization') throw new Error('preview checks changed')
  return value as ReferenceVideoPreviewResponse
}

/** Validate a bounded asset-list page.
 * @param value - Browser coordinates.
 * @returns Project and page.
 */
export function parseReferenceVideoAssetsRequest(value: unknown): ReferenceVideoAssetsRequest {
  const v = object(value, ['projectId', 'page'])
  id(v.projectId); integer(v.page, 1, 1000000)
  return value as ReferenceVideoAssetsRequest
}

/** Project only hashed image/audio/video metadata from the existing project asset feed.
 * @param value - Authenticated Writer page.
 * @param request - Requested project and page.
 * @param upstream - Configured loopback Writer origin.
 * @returns Safe display metadata with original pagination.
 */
export function normalizeReferenceVideoAssets(
  value: unknown, request: ReferenceVideoAssetsRequest, upstream: string,
): ReferenceVideoAssetsResponse {
  const v = object(value)
  if (v.page !== request.page || v.page_size !== 200 || !Array.isArray(v.items) || v.items.length > 200) throw new Error('invalid asset page')
  integer(v.pages, 1, 1000000)
  const items: ReferenceVideoAssetsResponse['items'][number][] = []
  for (const item of v.items) {
    const a = object(item)
    if (a.project_id !== request.projectId) throw new Error('asset project changed')
    if (a.asset_type !== 'image' && a.asset_type !== 'audio' && a.asset_type !== 'video') continue
    if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(a.sha256)) continue
    id(a.id)
    const candidateUrl = typeof a.public_url === 'string' && typeof a.preview_media_id === 'string'
      ? localSignedMediaUrl(a.public_url, a.preview_media_id, upstream) : ''
    let browserUrl = ''
    try {
      const url = new URL(candidateUrl)
      if (url.origin === new URL(upstream).origin && typeof a.preview_media_id === 'string'
        && /^media_[A-Za-z0-9_-]+$/u.test(a.preview_media_id) && url.pathname === `/api/media/${a.preview_media_id}`
        && /^[a-f0-9]{64}$/u.test(url.searchParams.get('signature') ?? '')
        && /^\d+$/u.test(url.searchParams.get('expires') ?? '') && !url.username && !url.password && !url.hash
        && [...url.searchParams.keys()].sort().join(',') === 'expires,signature') browserUrl = url.href
    } catch { /* Empty or non-capability URLs get a text-only asset card. */ }
    const roleLabels: Record<string, string> = { scene_reference: '场景参考', character_reference: '人物参考', prop_reference: '道具参考', continuity_reference_frame: '镜头画面参考' }
    const label = roleLabels[typeof a.role === 'string' ? a.role : ''] ?? (a.asset_type === 'audio' ? '参考音色' : a.asset_type === 'video' ? '参考视频' : '参考图片')
    const displayName = typeof a.display_name === 'string' ? a.display_name.trim().slice(0, 128) : ''
    const displayLabel = displayName || `${label} ${String((request.page - 1) * 200 + items.length + 1).padStart(2, '0')}`
    const ownerType = typeof a.owner_type === 'string' ? a.owner_type : ''
    const ownerId = typeof a.owner_id === 'string' ? a.owner_id : ''
    const localOwner: 'actor' | 'scene' | 'prop' | undefined =
      ownerType === 'actor' || ownerType === 'scene' || ownerType === 'prop'
        ? ownerType
        : undefined
    const localReferenceScope: ReferenceVideoAsset['localReferenceScope'] = a.asset_type === 'image' && /^(?:asset_localref_|asset_copy_)/u.test(a.id)
      && localOwner !== undefined && /^[A-Za-z0-9_.-]{1,256}$/u.test(ownerId)
      ? { elementKind: localOwner, targetId: ownerId }
      : undefined
    const localVoiceScope = a.asset_type === 'audio' && /^(?:asset_localvoice_[a-f0-9]{32}|asset_copy_[a-f0-9]{12})$/u.test(a.id)
      && a.role === 'local_voice_candidate' && ownerType === 'actor' && /^[A-Za-z0-9_.-]{1,256}$/u.test(ownerId)
      ? { targetId: ownerId } : undefined
    const imageDesign = a.asset_type === 'image' ? referenceImageDesign(a.generation_config_json ?? a.generation_config) : undefined
    const durationSec = a.asset_type !== 'image' && typeof a.duration_sec === 'number'
      && Number.isFinite(a.duration_sec) && a.duration_sec > 0 ? a.duration_sec : undefined
    const source: Record<string, string | boolean> = {}
    for (const [field, name] of [['owner_type', 'ownerType'], ['owner_id', 'ownerId'],
      ['selection_status', 'selectionStatus'], ['quality_status', 'qualityStatus'],
      ['humanReviewStatus', 'humanReviewStatus']] as const) {
      const value = a[field]
      if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value)) source[name] = value
    }
    if (a.is_selected === true || a.is_selected === 1) source.selected = true
    else if (a.is_selected === false || a.is_selected === 0) source.selected = false
    if (Object.keys(source).length && typeof a.role === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(a.role)) source.role = a.role
    items.push({ assetId: a.id, assetSha256: a.sha256, label: localVoiceScope === undefined ? displayLabel : `${displayLabel} · 音色`,
      mediaType: a.asset_type === 'image' ? 'reference_image' : a.asset_type === 'audio' ? 'reference_audio' : 'reference_video', browserUrl,
      ...(imageDesign ? { imageDesign } : {}),
      ...(Object.keys(source).length ? { source } : {}),
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(localReferenceScope === undefined ? {} : { localReferenceScope }),
      ...(localVoiceScope === undefined ? {} : { localVoiceScope }) })
  }
  return { projectId: request.projectId, page: request.page, pages: v.pages, items }
}
