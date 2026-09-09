/** Register an existing generated candidate without granting adoption authority. */
import type { ReferenceVideoCandidateRegistration } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
}
function exact(value: unknown, keys: readonly string[], fail: (message: string) => Error): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw fail('reference review fields invalid')
  return value as Record<string, unknown>
}
function id(value: unknown, fail: (message: string) => Error): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value) || value === '.' || value === '..') throw fail('reference review identity invalid')
  return value
}

/** Prepare one scoped read or idempotent registration. No retry is scheduled here. */
export function prepareReferenceVideoReview(endpoint: string, payload: unknown, helpers: Helpers) {
  const write = endpoint === 'registerReferenceVideoCandidateForReview'
  if (!write && endpoint !== 'readReferenceVideoCandidateRegistration') throw helpers.inputError('reference review endpoint invalid')
  const request = exact(payload, ['projectId', 'frameId', 'runId', 'assetId', 'expectedAssetSha256'], helpers.inputError)
  const projectId = id(request.projectId, helpers.inputError)
  const frameId = id(request.frameId, helpers.inputError)
  const runId = id(request.runId, helpers.inputError)
  const assetId = id(request.assetId, helpers.inputError)
  const digest = request.expectedAssetSha256
  if (!runId.startsWith('refvideo_') || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw helpers.inputError('reference review source invalid')
  const path = `/api/qingmu/projects/${encodeURIComponent(projectId)}/reference-video/drafts/${encodeURIComponent(frameId)}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(assetId)}/review-registration`
  return {
    path: write ? path : `${path}?expectedAssetSha256=${digest}`,
    method: write ? 'POST' as const : 'GET' as const,
    ...(write ? { body: { expectedAssetSha256: digest } } : {}),
    normalize: (value: unknown): ReferenceVideoCandidateRegistration => {
      const result = exact(value, [
        'schema', 'projectId', 'episodeId', 'frameId', 'runId', 'assetId', 'assetSha256', 'takeId',
        'providerCalls', 'selectionChanged', 'formalApprovalChanged',
      ], helpers.responseError)
      const episodeId = id(result.episodeId, helpers.responseError)
      if (result.schema !== 'jason.reference-video-review-registration.v1'
        || result.projectId !== projectId || result.frameId !== frameId || result.runId !== runId || result.assetId !== assetId
        || result.assetSha256 !== digest || result.providerCalls !== 0
        || result.selectionChanged !== false || result.formalApprovalChanged !== false
        || !(result.takeId === null ? !write : typeof result.takeId === 'string' && /^asset_reftake_[a-f0-9]{32}$/u.test(result.takeId))) {
        throw helpers.responseError('reference review receipt mismatch')
      }
      return { schema: 'jason.reference-video-review-registration.v1', projectId, episodeId, frameId, runId, assetId,
        assetSha256: digest, takeId: result.takeId as string | null,
        providerCalls: 0, selectionChanged: false, formalApprovalChanged: false }
    },
  }
}
