/** Cookie-authenticated Host read bridge for PromptIR entity-draft review. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const PATH = '/api/qingmu/entity-draft-human-review/state'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[0-9a-f]{64}$/

/** Runtime dependencies for the entity-draft review state bridge. */
export interface EntityDraftReviewReadDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function coordinates(req: IncomingMessage): Record<string, string> | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'promptIrId']
  if ([...url.searchParams.keys()].some(key => !keys.includes(key))) return undefined
  const result = Object.fromEntries(keys.map(key => [key, url.searchParams.get(key) ?? '']))
  return keys.every(key => IDENTIFIER.test(result[key] ?? '')) ? result : undefined
}

function cookieHeader(req: IncomingMessage): string | undefined {
  if (req.headers.authorization !== undefined) return undefined
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  return cookie !== undefined && cookie.length <= 8192 && !/[\r\n]/.test(cookie) ? cookie : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validDraft(
  value: unknown,
  expected: Record<string, string>,
  prompt: Record<string, unknown>,
  contextSnapshotSha256: unknown,
): boolean {
  if (!isRecord(value) || !isRecord(value.binding) || !isRecord(value.reference)) return false
  const binding = value.binding
  const reference = value.reference
  const review = value.review
  const status = String(value.status)
  return IDENTIFIER.test(String(value.draftId)) && IDENTIFIER.test(String(value.entityId))
    && ['actor', 'scene', 'prop'].includes(String(value.entityType))
    && typeof value.canonicalName === 'string' && value.canonicalName.length > 0
    && ['PendingReview', 'Accepted', 'Rejected'].includes(status)
    && SHA256.test(String(value.contentSha256)) && SHA256.test(String(value.referencePackSha256))
    && SHA256.test(String(value.bindingSha256))
    && binding.schema === 'jason.qingmu-entity-draft-human-review-binding.v1'
    && binding.projectId === expected.projectId && binding.episodeId === expected.episodeId
    && binding.storyboardRevisionId === expected.storyboardRevisionId && binding.frameId === expected.frameId
    && binding.promptIrId === expected.promptIrId && binding.promptIrVersion === prompt.version
    && binding.promptIrContentSha256 === prompt.contentSha256
    && binding.contextSnapshotSha256 === contextSnapshotSha256
    && binding.entityDraftId === value.draftId && binding.entityDraftContentSha256 === value.contentSha256
    && Number.isSafeInteger(binding.entityDraftVersion) && Number(binding.entityDraftVersion) > 0
    && binding.entityType === value.entityType && binding.entityId === value.entityId
    && Number.isSafeInteger(binding.profileRevision) && Number(binding.profileRevision) >= 0
    && binding.profileRevision === reference.profileRevision
    && binding.profileSnapshotSha256 === reference.profileSnapshotSha256
    && SHA256.test(String(binding.frameContentSha256)) && SHA256.test(String(binding.contextSnapshotSha256))
    && SHA256.test(String(binding.profileSnapshotSha256)) && SHA256.test(String(binding.referenceBindingSha256))
    && IDENTIFIER.test(String(binding.referencePackId)) && binding.referencePackId === value.referencePackId
    && Number.isSafeInteger(binding.referencePackVersion) && Number(binding.referencePackVersion) > 0
    && binding.referencePackSha256 === value.referencePackSha256
    && IDENTIFIER.test(String(binding.canonicalAssetId)) && binding.canonicalAssetId === reference.assetId
    && Array.isArray(binding.referenceAssetIds) && binding.referenceAssetIds.length === 1
    && binding.referenceAssetIds[0] === binding.canonicalAssetId
    && (status === 'PendingReview' ? review === null : isRecord(review)
      && review.status === status && SHA256.test(String(review.reviewIdentity))
      && typeof review.reviewedAt === 'string' && typeof review.note === 'string')
}

function validState(value: unknown, expected: Record<string, string>): boolean {
  if (!isRecord(value)) return false
  const item = value
  const { promptIr: prompt, identity, drafts } = item
  if (!isRecord(prompt) || !isRecord(identity) || !Array.isArray(drafts)) return false
  const draftIds = new Set<string>()
  const draftsValid = drafts.length > 0 && drafts.every((draft: unknown) => {
    if (!validDraft(draft, expected, prompt, item.contextSnapshotSha256)) return false
    const id = String((draft as Record<string, unknown>).draftId)
    if (draftIds.has(id)) return false
    draftIds.add(id); return true
  })
  const pending = drafts.filter((draft: unknown) => (draft as Record<string, unknown>).status === 'PendingReview').length
  return item.schema === 'jason.qingmu-entity-draft-human-review-state.v1'
    && item.projectId === expected.projectId && item.episodeId === expected.episodeId
    && item.storyboardRevisionId === expected.storyboardRevisionId && item.frameId === expected.frameId
    && SHA256.test(String(item.contextSnapshotSha256))
    && prompt.id === expected.promptIrId && prompt.status === 'Ready'
    && Number.isSafeInteger(prompt.version) && Number(prompt.version) > 0
    && SHA256.test(String(prompt.contentSha256))
    && identity.state === 'bound' && IDENTIFIER.test(String(identity.actorUserId))
    && IDENTIFIER.test(String(identity.naturalPersonId)) && draftsValid && item.pendingCount === pending
    && item.providerCalls === 0
    && item.taskMutation === false && item.outboxEvents === 0
}

/**
 * Register the exact same-origin Host route that reads bound entity drafts.
 *
 * @param webServer - Host web server that owns the browser-facing route.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer that unregisters the route.
 */
export function registerEntityDraftReviewRead(
  webServer: WebServer,
  dependencies: EntityDraftReviewReadDependencies,
): () => void {
  return webServer.register({
    kind: 'exact', path: PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'entity_draft_review_read_forbidden' }); return
      }
      const scope = coordinates(req)
      const cookie = cookieHeader(req)
      if (scope === undefined || cookie === undefined) {
        json(res, scope === undefined ? 400 : 401, {
          code: scope === undefined ? 'entity_draft_review_read_invalid' : 'entity_draft_review_relogin_required',
        }); return
      }
      const upstream = new URL(
        `/api/qingmu/projects/${encodeURIComponent(scope.projectId ?? '')}`
        + `/episodes/${encodeURIComponent(scope.episodeId ?? '')}`
        + `/storyboard-revisions/${encodeURIComponent(scope.storyboardRevisionId ?? '')}`
        + `/frames/${encodeURIComponent(scope.frameId ?? '')}`
        + `/prompt-irs/${encodeURIComponent(scope.promptIrId ?? '')}/entity-drafts/review`,
        dependencies.baseUrl,
      )
      try {
        const response = await dependencies.fetch(upstream, {
          method: 'GET', redirect: 'error', headers: { accept: 'application/json', cookie },
        })
        const bytes = Buffer.from(await response.arrayBuffer())
        const value = bytes.length <= 256 * 1024
          ? JSON.parse(bytes.toString('utf8')) as unknown : undefined
        if (!response.ok || !validState(value, scope)) {
          json(res, response.status === 401 || response.status === 403 ? 401 : 409, {
            code: response.status === 401 || response.status === 403
              ? 'entity_draft_review_relogin_or_binding_required'
              : 'entity_draft_review_state_invalid',
          }); return
        }
        json(res, 200, value)
      } catch {
        json(res, 502, { code: 'entity_draft_review_state_unavailable' })
      }
    },
  })
}
