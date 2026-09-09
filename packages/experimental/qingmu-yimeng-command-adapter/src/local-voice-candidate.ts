/** Local audio references are file candidates, never Provider-enrolled voices. */
import { createHash } from 'node:crypto'
import type { LocalReferenceContentRequest, LocalReferenceUploadRequest } from './local-reference-candidate.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** An actor-scoped WAV upload retained intact for explicit receipt recovery. */
export type LocalVoiceUploadRequest = LocalReferenceUploadRequest & { readonly elementKind: 'actor' }
/** Private exact-byte read for a local voice reference. */
export type LocalVoiceContentRequest = LocalReferenceContentRequest & { readonly elementKind: 'actor' }
/** Immutable upload receipt; later adoption remains a separate operation. */
export interface LocalVoiceCandidateResult {
  readonly schema: 'jason.qingmu-local-voice-candidate.v1'
  readonly projectId: string
  readonly elementKind: 'actor'
  readonly targetId: string
  readonly assetId: string
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly originalFileName: string
  readonly byteSize: number
  readonly mimeType: 'audio/wav'
  readonly inputSha256: string
  readonly materializedSha256: string
  readonly durationSec: number
  readonly sampleRate: number
  readonly channels: number
  readonly sourceDeclaration: 'local_file_unverified'
  readonly rightsStatus: 'not_recorded'
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly providerCalls: 0
  readonly generationQueued: false
}
/** Byte-verified PCM WAV, with no public URL. */
export interface LocalVoiceCandidateContent {
  readonly schema: 'jason.qingmu-local-voice-content.v1'
  readonly assetId: string
  readonly sha256: string
  readonly mimeType: 'audio/wav'
  readonly contentBase64: string
}

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
}
const MAX_BYTES = 8 * 1024 * 1024
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function object(value: unknown, fail: (message: string) => Error): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('local voice object invalid')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], fail: (message: string) => Error): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw fail('local voice fields invalid')
}
function id(value: unknown, fail: (message: string) => Error): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/u.test(value)) throw fail('local voice identity invalid')
  return value
}
function bytes(value: unknown, fail: (message: string) => Error): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_BYTES / 3) * 4) throw fail('local voice size invalid')
  const raw = Buffer.from(value, 'base64')
  if (raw.length < 44 || raw.length > MAX_BYTES || raw.toString('base64') !== value
    || raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WAVE'
    || raw.readUInt32LE(4) + 8 !== raw.length) throw fail('local voice WAV invalid')
  return raw
}

/** Validate the local WAV transport and bind every response to this exact request.
 * @param endpoint - One of the three local voice candidate operations.
 * @param payload - Untrusted UI request.
 * @param helpers - Existing adapter error and canonical JSON functions.
 * @returns A narrow authenticated Writer request and strict response normalizer.
 */
export function prepareLocalVoiceCandidate(endpoint: string, payload: unknown, helpers: Helpers) {
  const { inputError: input, responseError: response, canonicalJson } = helpers
  const p = object(payload, input)
  const projectId = id(p.projectId, input); const targetId = id(p.targetId, input)
  if (p.elementKind !== 'actor') throw input('local voice actor required')
  const path = `/api/qingmu/projects/${encodeURIComponent(projectId)}/actors/${encodeURIComponent(targetId)}/local-voice-candidates`
  if (endpoint === 'readLocalVoiceCandidateContent') {
    exact(p, ['projectId', 'elementKind', 'targetId', 'assetId', 'expectedSha256'], input)
    if (typeof p.assetId !== 'string' || !/^asset_localvoice_[a-f0-9]{32}$/u.test(p.assetId)
      || typeof p.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(p.expectedSha256)) throw input('local voice content identity invalid')
    return { method: 'GET' as const, path: `${path}/${p.assetId}/content?expectedSha256=${p.expectedSha256}`,
      normalize: (value: unknown): LocalVoiceCandidateContent => {
        const result = object(value, response)
        exact(result, ['schema', 'assetId', 'sha256', 'mimeType', 'contentBase64'], response)
        if (result.schema !== 'jason.qingmu-local-voice-content.v1' || result.assetId !== p.assetId
          || result.sha256 !== p.expectedSha256 || result.mimeType !== 'audio/wav'
          || hash(bytes(result.contentBase64, response)) !== p.expectedSha256) throw response('local voice content changed')
        return result as unknown as LocalVoiceCandidateContent
      } }
  }
  if (!['uploadLocalVoiceCandidate', 'recoverLocalVoiceCandidate'].includes(endpoint)) throw input('unknown local voice operation')
  exact(p, ['projectId', 'elementKind', 'targetId', 'idempotencyKey', 'originalFileName', 'contentBase64', 'sourceDeclaration'], input)
  if (typeof p.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/u.test(p.idempotencyKey)
    || typeof p.originalFileName !== 'string' || p.originalFileName.trim() !== p.originalFileName
    || p.originalFileName.length > 128 || !/\.wav$/iu.test(p.originalFileName)
    || /[/\\\u0000-\u001f]/u.test(p.originalFileName) || p.sourceDeclaration !== 'local_file_unverified') throw input('local voice upload invalid')
  const raw = bytes(p.contentBase64, input); const contentSha256 = hash(raw)
  const requestSha256 = hash(canonicalJson({ elementKind: 'actor', targetId, originalFileName: p.originalFileName,
    contentSha256, sourceDeclaration: 'local_file_unverified' }, 'localVoiceRequest'))
  const normalize = (value: unknown): LocalVoiceCandidateResult => {
    const result = object(value, response)
    exact(result, ['schema','projectId','elementKind','targetId','assetId','idempotencyKey','requestSha256',
      'originalFileName','byteSize','mimeType','inputSha256','materializedSha256','durationSec','sampleRate','channels',
      'sourceDeclaration','rightsStatus','selectionStatus','isSelected','providerCalls','generationQueued'], response)
    const expected = { schema: 'jason.qingmu-local-voice-candidate.v1', projectId, elementKind: 'actor', targetId,
      idempotencyKey: p.idempotencyKey, requestSha256, originalFileName: p.originalFileName, byteSize: raw.length,
      mimeType: 'audio/wav', inputSha256: contentSha256, materializedSha256: contentSha256,
      sourceDeclaration: 'local_file_unverified', rightsStatus: 'not_recorded', selectionStatus: 'Unselected',
      isSelected: false, providerCalls: 0, generationQueued: false }
    if (Object.entries(expected).some(([key, value]) => result[key] !== value)
      || typeof result.assetId !== 'string' || !/^asset_localvoice_[a-f0-9]{32}$/u.test(result.assetId)
      || typeof result.durationSec !== 'number' || !Number.isFinite(result.durationSec) || result.durationSec < 1 || result.durationSec > 15
      || typeof result.sampleRate !== 'number' || !Number.isInteger(result.sampleRate) || result.sampleRate < 8000 || result.sampleRate > 96000
      || ![1, 2].includes(result.channels as number)) throw response('local voice receipt changed')
    return result as unknown as LocalVoiceCandidateResult
  }
  return endpoint === 'recoverLocalVoiceCandidate'
    ? { method: 'GET' as const, path: `${path}/receipt?idempotencyKey=${encodeURIComponent(p.idempotencyKey)}&requestSha256=${requestSha256}`, normalize }
    : { method: 'POST' as const, path, body: { idempotencyKey: p.idempotencyKey, originalFileName: p.originalFileName,
      contentBase64: p.contentBase64, sourceDeclaration: p.sourceDeclaration } as YimengCommandJsonObject, normalize }
}
