/** Bounded, hash-bound local Take bytes; no URL or media authority is invented. */
import { createHash } from 'node:crypto'
import { parseTakeVersionReadRequest } from './take-versions.ts'
import type { YimengTakePreviewRequest, YimengTakePreviewResponse } from './types.ts'

/** Validate the explicit preview coordinates and expected existing output hash.
 * @param value - Untrusted browser payload.
 * @returns Validated request.
 */
export function parseTakePreviewRequest(value: unknown): YimengTakePreviewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid preview request')
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'episodeId,expectedOutputSha256,frameId,projectId,takeId'
    || typeof v.expectedOutputSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(v.expectedOutputSha256)) {
    throw new Error('invalid preview request')
  }
  const scope = parseTakeVersionReadRequest({ projectId: v.projectId, episodeId: v.episodeId, frameId: v.frameId })
  const take = parseTakeVersionReadRequest({ ...scope, frameId: v.takeId })
  return { ...scope, takeId: take.frameId, expectedOutputSha256: v.expectedOutputSha256 }
}

/** Verify scope, exact read-only flags, bounded bytes and their actual digest.
 * @param value - Untrusted upstream response.
 * @param request - Requested scope and expected hash.
 * @returns Hash-verified local media bytes.
 */
export function normalizeTakePreview(value: unknown, request: YimengTakePreviewRequest): YimengTakePreviewResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid preview response')
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'base64,bytes,databaseWrites,episodeId,frameId,mimeType,outputSha256,projectId,providerCalls,readOnly,schema,takeId'
    || v.schema !== 'jason.qingmu-take-preview.v1' || v.readOnly !== true || v.providerCalls !== 0 || v.databaseWrites !== 0
    || v.projectId !== request.projectId || v.episodeId !== request.episodeId || v.frameId !== request.frameId
    || v.takeId !== request.takeId || v.outputSha256 !== request.expectedOutputSha256
    || (v.mimeType !== 'video/mp4' && v.mimeType !== 'video/webm')
    || typeof v.bytes !== 'number' || !Number.isSafeInteger(v.bytes) || v.bytes < 1 || v.bytes > 16 * 1024 * 1024
    || typeof v.base64 !== 'string' || v.base64.length > Math.ceil(16 * 1024 * 1024 / 3) * 4) {
    throw new Error('invalid preview binding')
  }
  const data = Buffer.from(v.base64, 'base64')
  if (data.length !== v.bytes || data.toString('base64') !== v.base64
    || createHash('sha256').update(data).digest('hex') !== request.expectedOutputSha256) throw new Error('invalid preview bytes')
  return value as YimengTakePreviewResponse
}
