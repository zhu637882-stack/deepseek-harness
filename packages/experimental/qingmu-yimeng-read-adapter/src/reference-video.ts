/** Validate the browser draft and the read-only Writer compilation response. */
import { localMediaUrl } from './local-media-url.ts'
import type {
  ReferenceVideoAssetsRequest, ReferenceVideoAssetsResponse,
  ReferenceVideoPreviewRequest, ReferenceVideoPreviewResponse,
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
