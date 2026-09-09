/** Validate the browser draft and the read-only Writer compilation response. */
import { localMediaUrl } from './local-media-url.ts'
import type {
  ReferenceVideoAssetsRequest, ReferenceVideoAssetsResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse,
  ReferenceVideoDraftResponse,
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
  const v = object(value, ['schema', 'projectId', 'frameId', 'draftRevision', 'draftRequestSha256', 'sourceSha256', 'quoteSha256', 'preview', 'cost', 'readOnly', 'providerCalls', 'databaseWrites', 'budgetReservedCny', 'generationQueued'])
  if (v.schema !== 'jason.reference-video-quote.v1' || v.projectId !== request.projectId || v.frameId !== request.frameId
    || v.draftRevision !== request.draftRevision || v.draftRequestSha256 !== request.draftRequestSha256
    || v.readOnly !== true || v.providerCalls !== 0 || v.databaseWrites !== 0 || v.budgetReservedCny !== 0 || v.generationQueued !== false) throw new Error('quote identity or effects changed')
  const preview = normalizeReferenceVideoPreview(v.preview, request, digest)
  if (v.sourceSha256 !== preview.sourceSha256) throw new Error('quote source changed')
  const c = object(v.cost, ['provider', 'region', 'currency', 'basis', 'unit', 'unitPriceCny', 'billableSeconds', 'estimatedCny', 'candidateCount', 'maxAttempts', 'accountDiscountApplied', 'pricingSha256', 'pricingCheckedAt', 'sourceUrl'])
  if (c.provider !== 'dashscope' || c.region !== 'cn-beijing' || c.currency !== 'CNY' || c.basis !== 'catalog_list_price' || c.unit !== 'second'
    || c.billableSeconds !== preview.body.parameters.duration || c.candidateCount !== 1 || c.maxAttempts !== 1
    || c.accountDiscountApplied !== false
    || c.sourceUrl !== 'https://help.aliyun.com/zh/model-studio/model-pricing') throw new Error('quote basis changed')
  for (const amount of [c.unitPriceCny, c.estimatedCny]) {
    if (typeof amount !== 'string' || !/^[0-9]{1,9}\.[0-9]{6}$/u.test(amount) || Number(amount) <= 0) throw new Error('invalid price')
  }
  if (Math.round(Number(c.unitPriceCny) * c.billableSeconds * 1e6) !== Math.round(Number(c.estimatedCny) * 1e6)) throw new Error('quote arithmetic changed')
  sha(c.pricingSha256); sha(v.quoteSha256)
  if (typeof c.pricingCheckedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(c.pricingCheckedAt)) throw new Error('pricing date missing')
  const projection = { projectId: v.projectId, frameId: v.frameId, draftRevision: v.draftRevision, draftRequestSha256: v.draftRequestSha256,
    sourceSha256: v.sourceSha256, cost: c }
  if (digest(projection, 'quote.projection') !== v.quoteSha256) throw new Error('quote checksum changed')
  return value as ReferenceVideoQuoteResponse
}

/** Validate a scoped draft read.
 * @param value - Browser scope.
 * @returns Exact project and shot identifiers.
 */
export function parseReferenceVideoDraftScope(value: unknown): { projectId: string; frameId: string } {
  const v = object(value, ['projectId', 'frameId'])
  id(v.projectId); id(v.frameId)
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
  const v = object(value, ['schema', 'projectId', 'frameId', 'frameSha256', 'draft', 'mediaTypes', 'providerCalls', 'generationQueued'])
  if (v.schema !== 'jason.reference-video-draft.v1' || v.projectId !== scope.projectId || v.frameId !== scope.frameId
    || v.providerCalls !== 0 || v.generationQueued !== false) throw new Error('draft scope or effects changed')
  sha(v.frameSha256)
  const types = object(v.mediaTypes)
  if (v.draft !== null) {
    const d = object(v.draft, ['revision', 'frameSha256', 'requestSha256', 'request', 'savedAt'])
    integer(d.revision, 1, Number.MAX_SAFE_INTEGER); sha(d.frameSha256); sha(d.requestSha256)
    const body = object(d.request, ['frameId', 'model', 'bindings', 'promptParts', 'parameters'])
    const request = parseReferenceVideoRequest({ ...body, projectId: scope.projectId })
    if (request.frameId !== scope.frameId || digest(body, 'draft.request') !== d.requestSha256
      || typeof d.savedAt !== 'string' || !Number.isFinite(Date.parse(d.savedAt))) throw new Error('draft content mismatch')
    if (Object.keys(types).length !== request.bindings.length || request.bindings.some(b =>
      !Object.hasOwn(types, b.bindingToken) || ![null, 'reference_image', 'reference_audio'].includes(types[b.bindingToken] as null | string))) throw new Error('draft media kind mismatch')
  } else if (Object.keys(types).length) throw new Error('unexpected draft media')
  return value as ReferenceVideoDraftResponse
}

/** Validate explicit source tokens and bounded model controls before HTTP.
 * @param value - Untrusted browser draft.
 * @returns The validated draft, with no implicit rewriting.
 */
export function parseReferenceVideoRequest(value: unknown): ReferenceVideoPreviewRequest {
  const v = object(value, ['projectId', 'frameId', 'model', 'bindings', 'promptParts', 'parameters'])
  id(v.projectId); id(v.frameId)
  if (v.model !== 'wan3.0-video' || !Array.isArray(v.bindings) || v.bindings.length < 1 || v.bindings.length > 15) throw new Error('invalid references')
  const tokens = new Set<string>()
  for (const entry of v.bindings) {
    const b = object(entry, ['bindingToken', 'assetId', 'assetSha256', 'label'])
    id(b.bindingToken); id(b.assetId); sha(b.assetSha256)
    if (tokens.has(b.bindingToken) || typeof b.label !== 'string' || Array.from(b.label).length < 1 || Array.from(b.label).length > 128) throw new Error('invalid binding')
    tokens.add(b.bindingToken)
  }
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
  const v = object(value, ['schema', 'projectId', 'frameId', 'body', 'referenceMapping', 'requestBodySha256', 'sourceSha256', 'readOnly', 'databaseWrites', 'providerCalls', 'submissionReady', 'remainingChecks', 'referenceAudioDurationSec'])
  if (v.schema !== 'jason.reference-video-request-preview.v1' || v.projectId !== request.projectId || v.frameId !== request.frameId
    || v.readOnly !== true || v.databaseWrites !== 0 || v.providerCalls !== 0 || v.submissionReady !== false) throw new Error('preview scope or effects changed')
  sha(v.requestBodySha256); sha(v.sourceSha256)
  const body = object(v.body, ['model', 'input', 'parameters'])
  const input = object(body.input, ['prompt', 'media'])
  if (body.model !== request.model || !Array.isArray(v.referenceMapping) || !Array.isArray(input.media)
    || v.referenceMapping.length !== request.bindings.length || input.media.length !== request.bindings.length) throw new Error('reference count changed')
  const aliases = new Map<string, string>()
  let images = 0; let audios = 0
  v.referenceMapping.forEach((entry, index) => {
    const mapping = object(entry, ['bindingToken', 'assetId', 'assetSha256', 'label', 'alias', 'mediaType', 'mediaIndex'])
    const binding = request.bindings[index]
    if (!binding) throw new Error('reference count changed')
    if (Object.entries(binding).some(([key, expected]) => mapping[key] !== expected) || mapping.mediaIndex !== index) throw new Error('reference source changed')
    const media = object(input.media instanceof Array ? input.media[index] : undefined, ['type', 'url'])
    if (mapping.mediaType !== media.type || !['reference_image', 'reference_audio'].includes(String(media.type))) throw new Error('media kind changed')
    const alias = media.type === 'reference_image' ? `图${++images}` : `音频${++audios}`
    if (mapping.alias !== alias || typeof media.url !== 'string') throw new Error('reference alias changed')
    const url = new URL(media.url)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('unsafe media URL')
    aliases.set(binding.bindingToken, alias)
  })
  const authored = request.promptParts.map(part => 'text' in part ? part.text : aliases.get(part.bindingToken)).join('')
  if (input.prompt !== authored || images < 1 || images > 10 || audios > 5
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

/** Project only hashed image/audio metadata from the existing project asset feed.
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
    if (a.asset_type !== 'image' && a.asset_type !== 'audio') continue
    if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(a.sha256)) continue
    id(a.id)
    const candidateUrl = typeof a.public_url === 'string' ? localMediaUrl(a.public_url, a.id, upstream) : ''
    let browserUrl = ''
    try {
      const url = new URL(candidateUrl)
      if (url.origin === new URL(upstream).origin && /^\/api\/media\/media_[A-Za-z0-9_-]+$/u.test(url.pathname)
        && /^[a-f0-9]{64}$/u.test(url.searchParams.get('signature') ?? '')
        && /^\d+$/u.test(url.searchParams.get('expires') ?? '') && !url.username && !url.password && !url.hash) browserUrl = url.href
    } catch { /* Empty or non-capability URLs get a text-only asset card. */ }
    items.push({ assetId: a.id, assetSha256: a.sha256, label: `${(typeof a.role === 'string' ? a.role : a.asset_type).slice(0, 64)} · ${a.id.slice(-8)}`,
      mediaType: a.asset_type === 'image' ? 'reference_image' : 'reference_audio', browserUrl })
  }
  return { projectId: request.projectId, page: request.page, pages: v.pages, items }
}
