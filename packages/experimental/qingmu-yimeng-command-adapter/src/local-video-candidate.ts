/** Original local videos join the existing frame candidate list without Provider lineage. */
import { createHash } from 'node:crypto'
import type { YimengCommandJsonObject } from './types.ts'

/** One local file upload, explicitly scoped to a project, episode and frame. */
export interface LocalVideoUploadRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly idempotencyKey: string
  readonly originalFileName: string
  readonly contentBase64: string
  readonly sourceDeclaration: 'local_file_unverified'
}
/** Receipt recovery uses a small immutable request digest, never another upload. */
export interface LocalVideoRecoveryRequest {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly idempotencyKey: string
  readonly requestSha256: string
}
/** File receipt only. It does not assert quality approval or verified generation provenance. */
export interface LocalVideoCandidateResult {
  readonly schema: 'jason.qingmu-local-video-candidate.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly assetId: string
  readonly takeId: string
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly originalFileName: string
  readonly byteSize: number
  readonly mimeType: 'video/mp4'
  readonly inputSha256: string
  readonly materializedSha256: string
  readonly durationSec: number
  readonly width: number
  readonly height: number
  readonly hasAudio: boolean
  readonly sourceDeclaration: 'local_file_unverified'
  readonly rightsStatus: 'not_recorded'
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly providerCalls: 0
  readonly generationQueued: false
}

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
}
export const MAX_LOCAL_VIDEO_JSON_BYTES = 48 * 1024 * 1024
const MAX_BYTES = 32 * 1024 * 1024
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function object(value: unknown, fail: (message: string) => Error): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('local video object invalid')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], fail: (message: string) => Error): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw fail('local video fields invalid')
}
function id(value: unknown, fail: (message: string) => Error): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/u.test(value) || value === '.' || value === '..') throw fail('local video identity invalid')
  return value
}
function filename(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length <= 128 && /\.mp4$/iu.test(value)
    && !/[/\\\u0000-\u001f]/u.test(value)
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}
function range(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/** Translate upload or recovery into one owner-authenticated Writer request.
 * @param endpoint - Exact upload or recovery endpoint.
 * @param payload - Untrusted client request.
 * @param helpers - Adapter validation and canonicalization functions.
 * @returns The request and its exact-scope receipt validator.
 */
export function prepareLocalVideoCandidate(endpoint: string, payload: unknown, helpers: Helpers) {
  const { inputError: input, responseError: response, canonicalJson } = helpers
  const p = object(payload, input)
  const projectId = id(p.projectId, input); const episodeId = id(p.episodeId, input); const frameId = id(p.frameId, input)
  if (!['uploadLocalVideoCandidate', 'recoverLocalVideoCandidate'].includes(endpoint)) throw input('unknown local video operation')
  if (typeof p.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/u.test(p.idempotencyKey)) throw input('local video key invalid')
  const base = ['projectId', 'episodeId', 'frameId', 'idempotencyKey']
  const identityHash = (name: string, contentSha256: string): string => hash(canonicalJson({ episodeId, frameId,
    originalFileName: name, contentSha256, sourceDeclaration: 'local_file_unverified' }, 'localVideoRequest'))
  let contentSha: string | undefined; let byteSize: number | undefined; let requestSha256: string
  if (endpoint === 'uploadLocalVideoCandidate') {
    exact(p, [...base, 'originalFileName', 'contentBase64', 'sourceDeclaration'], input)
    if (!filename(p.originalFileName) || p.sourceDeclaration !== 'local_file_unverified'
      || typeof p.contentBase64 !== 'string' || p.contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4) throw input('local video upload invalid')
    const raw = Buffer.from(p.contentBase64, 'base64')
    if (raw.length < 16 || raw.length > MAX_BYTES || raw.toString('base64') !== p.contentBase64
      || raw.toString('ascii', 4, 8) !== 'ftyp') throw input('local video MP4 invalid')
    contentSha = hash(raw); byteSize = raw.length; requestSha256 = identityHash(p.originalFileName, contentSha)
  } else {
    exact(p, [...base, 'requestSha256'], input)
    if (!sha(p.requestSha256)) throw input('local video request hash invalid')
    requestSha256 = p.requestSha256
  }
  const normalize = (value: unknown): LocalVideoCandidateResult => {
    const r = object(value, response)
    exact(r, ['schema','projectId','episodeId','frameId','assetId','takeId','idempotencyKey','requestSha256',
      'originalFileName','byteSize','mimeType','inputSha256','materializedSha256','durationSec','width','height','hasAudio',
      'sourceDeclaration','rightsStatus','selectionStatus','isSelected','providerCalls','generationQueued'], response)
    const expected = { schema: 'jason.qingmu-local-video-candidate.v1', projectId, episodeId, frameId,
      idempotencyKey: p.idempotencyKey, requestSha256, mimeType: 'video/mp4', sourceDeclaration: 'local_file_unverified',
      rightsStatus: 'not_recorded', selectionStatus: 'Unselected', isSelected: false, providerCalls: 0, generationQueued: false }
    if (Object.entries(expected).some(([key, expected]) => r[key] !== expected)
      || typeof r.assetId !== 'string' || !/^asset_localvideo_[a-f0-9]{32}$/u.test(r.assetId) || r.takeId !== r.assetId
      || !sha(r.inputSha256) || r.materializedSha256 !== r.inputSha256 || !filename(r.originalFileName)
      || identityHash(r.originalFileName, r.inputSha256) !== requestSha256
      || !range(r.byteSize, 16, MAX_BYTES) || !Number.isInteger(r.byteSize)
      || !range(r.durationSec, 1, 30) || !range(r.width, 16, 4096) || !Number.isInteger(r.width)
      || !range(r.height, 16, 4096) || !Number.isInteger(r.height) || r.width * r.height > 3840 * 2160
      || typeof r.hasAudio !== 'boolean' || (contentSha !== undefined && (contentSha !== r.inputSha256 || byteSize !== r.byteSize))) {
      throw response('local video receipt changed')
    }
    return r as unknown as LocalVideoCandidateResult
  }
  const path = `/api/qingmu/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/frames/${encodeURIComponent(frameId)}/local-video-candidates`
  return endpoint === 'recoverLocalVideoCandidate'
    ? { method: 'GET' as const, path: `${path}/receipt?idempotencyKey=${encodeURIComponent(p.idempotencyKey)}&requestSha256=${requestSha256}`, normalize }
    : { method: 'POST' as const, path, body: { idempotencyKey: p.idempotencyKey, originalFileName: p.originalFileName,
      contentBase64: p.contentBase64, sourceDeclaration: p.sourceDeclaration } as YimengCommandJsonObject, normalize }
}
