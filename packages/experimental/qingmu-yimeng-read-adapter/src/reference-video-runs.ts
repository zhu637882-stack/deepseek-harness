/** Strict projection of reference-generation progress and signed candidate playback. */
import type { ReferenceVideoRun, ReferenceVideoRunsResponse } from './reference-video-types.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid run object')
  return value as Record<string, unknown>
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value)) throw new Error('invalid run identity')
}
function sha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('invalid run checksum')
}

/** Verify a run belongs to the requested shot and rewrite only its signed media capability.
 * @param value - Authenticated Writer response.
 * @param scope - Requested shot and optional run.
 * @param upstream - Configured Writer origin.
 * @returns A candidate projection with no adoption claim.
 */
export function normalizeReferenceVideoRun(
  value: unknown, scope: { projectId: string; frameId: string; runId?: string }, upstream: string,
): ReferenceVideoRun {
  const v = object(value)
  if (v.schema !== 'jason.reference-video-run.v1' || v.projectId !== scope.projectId || v.frameId !== scope.frameId
    || (scope.runId !== undefined && v.runId !== scope.runId) || v.selectionChanged !== false || v.providerCalls !== 0) throw new Error('run scope or effects changed')
  id(v.runId); id(v.taskId); sha(v.quoteSha256)
  if (!v.runId.startsWith('refvideo_') || !Number.isSafeInteger(v.draftRevision) || Number(v.draftRevision) < 1
    || !['queued', 'running', 'succeeded', 'failed', 'quarantined'].includes(String(v.publicStatus))
    || typeof v.authorizationCapCny !== 'string' || !/^[0-9]{1,3}\.[0-9]{6}$/u.test(v.authorizationCapCny)
    || Number(v.authorizationCapCny) <= 0 || typeof v.kernelStatus !== 'string'
    || !['Reserved', 'DispatchPending', 'Submitted', 'Running', 'Ingesting', 'QualityPending', 'Succeeded', 'Failed', 'Cancelled', 'Quarantined'].includes(v.kernelStatus)
    || (v.providerTaskId !== null && typeof v.providerTaskId !== 'string')
    || (v.errorCode !== null && typeof v.errorCode !== 'string')
    || !Array.isArray(v.candidates) || v.candidates.length > 1
    || (v.kernelStatus !== 'Succeeded' && v.candidates.length)) throw new Error('invalid run state')
  const candidates = v.candidates.map((entry) => {
    const c = object(entry); id(c.assetId); sha(c.assetSha256)
    if (c.reviewStatus !== 'pending' || typeof c.browserUrl !== 'string') throw new Error('candidate review changed')
    let browserUrl = ''
    if (c.browserUrl) {
      id(c.mediaId)
      const source = new URL(c.browserUrl)
      if (!/^media_[A-Za-z0-9_-]+$/u.test(c.mediaId) || source.pathname !== `/api/media/${c.mediaId}`
        || !['https:', 'http:'].includes(source.protocol) || source.username || source.password || source.hash
        || [...source.searchParams.keys()].sort().join(',') !== 'expires,signature'
        || !/^\d+$/u.test(source.searchParams.get('expires') ?? '')
        || !/^[a-f0-9]{64}$/u.test(source.searchParams.get('signature') ?? '')) throw new Error('invalid candidate media capability')
      const local = new URL(source.pathname, upstream); local.search = source.search; browserUrl = local.href
    } else if (c.mediaId !== null) throw new Error('candidate locator missing')
    return { assetId: c.assetId, assetSha256: c.assetSha256, mediaId: c.mediaId as string | null, browserUrl, reviewStatus: 'pending' as const }
  })
  return { ...(v as unknown as ReferenceVideoRun), candidates }
}

/** Validate the bounded run list and each candidate within the same owner scope.
 * @param value - Writer list response.
 * @param scope - Requested shot.
 * @param upstream - Configured Writer origin.
 * @returns Latest run states without making Provider calls.
 */
export function normalizeReferenceVideoRuns(
  value: unknown, scope: { projectId: string; frameId: string }, upstream: string,
): ReferenceVideoRunsResponse {
  const v = object(value)
  if (v.schema !== 'jason.reference-video-runs.v1' || v.projectId !== scope.projectId || v.frameId !== scope.frameId
    || v.providerCalls !== 0 || !Array.isArray(v.items) || v.items.length > 20) throw new Error('invalid run list')
  const items = v.items.map(item => normalizeReferenceVideoRun(item, scope, upstream))
  if (new Set(items.map(item => item.runId)).size !== items.length) throw new Error('duplicate run identity')
  return { schema: 'jason.reference-video-runs.v1', ...scope, items, providerCalls: 0 }
}
