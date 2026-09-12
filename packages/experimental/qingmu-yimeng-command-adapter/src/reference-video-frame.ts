/** Local frame capture and read-only recovery for an exact generated source. */
import type { ReferenceVideoFrameReceipt } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
}

/** Validate the request and the corresponding image receipt.
 * @param endpoint - Capture or recovery endpoint.
 * @param payload - Exact source and playback timestamp.
 * @param helpers - Transport error constructors.
 * @returns Prepared HTTP request and response parser.
 */
export function prepareReferenceVideoFrame(endpoint: string, payload: unknown, helpers: Helpers) {
  const write = endpoint === 'captureReferenceVideoFrame'
  if (!write && endpoint !== 'readReferenceVideoFrame') throw helpers.inputError('invalid frame endpoint')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw helpers.inputError('invalid frame request')
  const request = payload as Record<string, unknown>
  if (Object.keys(request).sort().join(',') !== 'assetId,expectedAssetSha256,frameId,projectId,runId,timestampMs'
    || !['projectId', 'frameId', 'runId', 'assetId'].every(key => typeof request[key] === 'string'
      && /^[A-Za-z0-9_.:-]{1,128}$/u.test(request[key]) && request[key] !== '.' && request[key] !== '..')
    || typeof request.runId !== 'string' || !request.runId.startsWith('refvideo_')
    || typeof request.expectedAssetSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(request.expectedAssetSha256)
    || typeof request.timestampMs !== 'number' || !Number.isSafeInteger(request.timestampMs) || request.timestampMs < 0) {
    throw helpers.inputError('invalid frame source or timestamp')
  }
  const timestampMs = request.timestampMs
  const path = `/api/qingmu/projects/${encodeURIComponent(String(request.projectId))}/reference-video/drafts/${encodeURIComponent(String(request.frameId))}/runs/${encodeURIComponent(request.runId)}/candidates/${encodeURIComponent(String(request.assetId))}/reference-frame`
  return {
    path: write ? path : `${path}?expectedAssetSha256=${request.expectedAssetSha256}&timestampMs=${request.timestampMs}`,
    method: write ? 'POST' as const : 'GET' as const,
    ...(write ? { body: { expectedAssetSha256: request.expectedAssetSha256, timestampMs: request.timestampMs } } : {}),
    normalize: (value: unknown): ReferenceVideoFrameReceipt => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw helpers.responseError('invalid frame receipt')
      const v = value as Record<string, unknown>
      const image = v.image && typeof v.image === 'object' && !Array.isArray(v.image)
        ? v.image as Record<string, unknown> : undefined
      if (v.schema !== 'qingmu.reference-video-frame.v1' || v.projectId !== request.projectId
        || v.frameId !== request.frameId || v.runId !== request.runId || v.assetId !== request.assetId
        || v.assetSha256 !== request.expectedAssetSha256 || v.requestedTimestampMs !== request.timestampMs
        || typeof v.episodeId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(v.episodeId)
        || v.providerCalls !== 0 || v.selectionChanged !== false
        || (v.image === null ? write : !image || typeof image.assetId !== 'string' || !/^asset_vframe_[a-f0-9]{32}$/u.test(image.assetId)
          || typeof image.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(image.assetSha256)
          || typeof image.width !== 'number' || !Number.isSafeInteger(image.width) || image.width < 1
          || typeof image.height !== 'number' || !Number.isSafeInteger(image.height) || image.height < 1
          || typeof image.actualTimestampMs !== 'number' || !Number.isFinite(image.actualTimestampMs)
          || image.actualTimestampMs + 0.01 < timestampMs)) throw helpers.responseError('frame receipt mismatch')
      const receipt = value as ReferenceVideoFrameReceipt
      return {
        schema: receipt.schema, projectId: receipt.projectId, episodeId: receipt.episodeId,
        frameId: receipt.frameId, runId: receipt.runId, assetId: receipt.assetId,
        assetSha256: receipt.assetSha256, requestedTimestampMs: receipt.requestedTimestampMs,
        image: receipt.image === null ? null : {
          assetId: receipt.image.assetId, assetSha256: receipt.image.assetSha256,
          width: receipt.image.width, height: receipt.image.height, actualTimestampMs: receipt.image.actualTimestampMs,
        },
        providerCalls: 0, selectionChanged: false,
      }
    },
  }
}
