/** Exact saved-draft scope and redacted temporary material readiness. */
import type { ReferenceVideoMaterialsRequest, ReferenceVideoMaterialsState } from './reference-video-types.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid materials object')
  return value as Record<string, unknown>
}
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value)
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const code = (value: unknown) => value === null || (typeof value === 'string' && /^reference_video_[a-z_]{1,100}$/u.test(value))

/** Validate an exact saved version before reading upload receipts.
 * @param value - Browser request.
 * @returns Validated scope.
 */
export function parseReferenceVideoMaterialsRequest(value: unknown): ReferenceVideoMaterialsRequest {
  const v = object(value)
  if (Object.keys(v).some(key => !['projectId', 'frameId', 'expectedRevision', 'expectedRequestSha256'].includes(key))
    || !id(v.projectId) || !id(v.frameId) || !sha(v.expectedRequestSha256)
    || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 1) throw new Error('invalid saved materials scope')
  return value as ReferenceVideoMaterialsRequest
}

/** Verify the saved scope and expose no remote locator, key or local filesystem path.
 * @param value - Writer read response.
 * @param request - Requested saved version.
 * @returns Validated local readiness, never upload authorization.
 */
export function normalizeReferenceVideoMaterials(value: unknown, request: ReferenceVideoMaterialsRequest): ReferenceVideoMaterialsState {
  const v = object(value)
  const fields = ['schema', 'projectId', 'frameId', 'draftRevision', 'draftRequestSha256', 'model', 'materials', 'configured', 'configurationError', 'allReady', 'providerCalls', 'databaseWrites', 'generationQueued']
  if (Object.keys(v).some(key => !fields.includes(key))
    || v.schema !== 'jason.reference-video-materials.v1' || v.projectId !== request.projectId || v.frameId !== request.frameId
    || v.draftRevision !== request.expectedRevision || v.draftRequestSha256 !== request.expectedRequestSha256
    || v.model !== 'wan3.0-video' || typeof v.configured !== 'boolean' || !code(v.configurationError)
    || (v.configured ? v.configurationError !== null : v.configurationError === null)
    || v.providerCalls !== 0 || v.databaseWrites !== 0 || v.generationQueued !== false
    || !Array.isArray(v.materials) || v.materials.length < 1 || v.materials.length > 20) throw new Error('materials scope changed')
  const tokens = new Set<unknown>()
  let images = 0, audios = 0, videos = 0
  for (const item of v.materials) {
    const m = object(item)
    if (Object.keys(m).some(key => !['bindingToken', 'assetId', 'assetSha256', 'mediaType', 'status', 'expiresAt', 'failureCode'].includes(key))
      || !id(m.bindingToken) || tokens.has(m.bindingToken) || !id(m.assetId) || !sha(m.assetSha256)
      || !['reference_image', 'reference_audio', 'reference_video'].includes(String(m.mediaType))
      || !['not_prepared', 'uploading', 'unknown', 'failed', 'expired', 'ready'].includes(String(m.status))
      || !code(m.failureCode)
      || (m.status === 'ready' ? typeof m.expiresAt !== 'number' || !Number.isFinite(m.expiresAt) || m.expiresAt <= 0 : m.expiresAt !== null)
      || (!v.configured && m.status !== 'not_prepared')) throw new Error('invalid material identity or state')
    tokens.add(m.bindingToken)
    if (m.mediaType === 'reference_image') images++; else if (m.mediaType === 'reference_audio') audios++; else videos++
  }
  if (images + videos < 1 || images > 10 || audios > 5 || videos > 5
    || v.allReady !== v.materials.every(item => object(item).status === 'ready')) throw new Error('invalid reference readiness')
  return value as ReferenceVideoMaterialsState
}
