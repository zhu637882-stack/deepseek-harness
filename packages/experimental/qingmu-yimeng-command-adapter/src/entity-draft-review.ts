/** Same-origin cookie-only commands for one PromptIR-bound entity-draft decision. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const DECIDE_PATH = '/api/qingmu/entity-draft-human-review/decision'
const RECEIPT_PATH = '/api/qingmu/entity-draft-human-review/receipt'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SHA256 = /^[0-9a-f]{64}$/

/** Runtime dependencies for the entity-draft human decision bridge. */
export interface EntityDraftReviewCommandDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function scope(req: IncomingMessage): Record<string, string> | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'promptIrId', 'draftId']
  const optional = ['idempotencyKey', 'requestSha256']
  if ([...url.searchParams.keys()].some(key => !keys.includes(key) && !optional.includes(key))) return undefined
  const result = Object.fromEntries([...keys, ...optional].map(key => [key, url.searchParams.get(key) ?? '']))
  return keys.every(key => IDENTIFIER.test(result[key] ?? '')) ? result : undefined
}

function browserHeaders(req: IncomingMessage, upstream: URL, write: boolean): Headers | undefined {
  const host = req.headers.host
  if (typeof host !== 'string' || req.headers.authorization !== undefined) return undefined
  if (write && req.headers.origin !== `http://${host}`) return undefined
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  if (cookie === undefined || cookie.length > 8192 || /[\r\n]/.test(cookie)) return undefined
  return new Headers({ accept: 'application/json', cookie, origin: upstream.origin, host: upstream.host })
}

async function body(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') return undefined
  const declared = Number(req.headers['content-length'] ?? '')
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > 8192) return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > declared) return undefined
    chunks.push(chunk)
  }
  if (size !== declared) return undefined
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : undefined
}

async function call(
  dependencies: EntityDraftReviewCommandDependencies,
  req: IncomingMessage,
  upstream: URL,
  init: RequestInit,
  write: boolean,
): Promise<{ readonly response: Response; readonly value: unknown } | undefined> {
  const headers = browserHeaders(req, upstream, write)
  if (headers === undefined) return undefined
  for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
  try {
    const response = await dependencies.fetch(upstream, { ...init, redirect: 'error', headers })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 256 * 1024) return undefined
    return { response, value: JSON.parse(bytes.toString('utf8')) as unknown }
  } catch { return undefined }
}

function receipt(value: unknown, expected: Record<string, string>): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const binding = item.binding as Record<string, unknown> | undefined
  const status = String(item.status)
  const decision = String(item.decision)
  if (item.schema !== 'jason.qingmu-entity-draft-human-review-receipt.v1'
    || item.projectId !== expected.projectId || item.episodeId !== expected.episodeId
    || item.storyboardRevisionId !== expected.storyboardRevisionId || item.frameId !== expected.frameId
    || item.promptIrId !== expected.promptIrId || item.draftId !== expected.draftId
    || expected.idempotencyKey !== '' && item.idempotencyKey !== expected.idempotencyKey
    || expected.requestSha256 !== '' && item.requestSha256 !== expected.requestSha256
    || !['accepted', 'rejected'].includes(decision)
    || status !== (decision === 'accepted' ? 'Accepted' : 'Rejected')
    || typeof item.reviewIdentity !== 'string' || !SHA256.test(item.reviewIdentity)
    || typeof item.requestSha256 !== 'string' || !SHA256.test(item.requestSha256)
    || typeof item.intentSessionSha256 !== 'string' || !SHA256.test(item.intentSessionSha256)
    || typeof item.intentBindingSha256 !== 'string' || !SHA256.test(item.intentBindingSha256)
    || typeof item.bindingSha256 !== 'string' || !SHA256.test(item.bindingSha256)
    || !IDENTIFIER.test(String(item.reviewerUserId)) || !IDENTIFIER.test(String(item.naturalPersonId))
    || typeof item.reviewedAt !== 'string' || !IDEMPOTENCY_KEY.test(String(item.idempotencyKey))
    || binding?.schema !== 'jason.qingmu-entity-draft-human-review-binding.v1'
    || binding.projectId !== expected.projectId || binding.episodeId !== expected.episodeId
    || binding.storyboardRevisionId !== expected.storyboardRevisionId || binding.frameId !== expected.frameId
    || binding.entityDraftId !== expected.draftId || binding.promptIrId !== expected.promptIrId
    || !Number.isSafeInteger(binding.entityDraftVersion) || Number(binding.entityDraftVersion) <= 0
    || !['actor', 'scene', 'prop'].includes(String(binding.entityType))
    || !IDENTIFIER.test(String(binding.entityId))
    || !IDENTIFIER.test(String(binding.referencePackId))
    || !Number.isSafeInteger(binding.referencePackVersion) || Number(binding.referencePackVersion) <= 0
    || !IDENTIFIER.test(String(binding.canonicalAssetId))
    || !Array.isArray(binding.referenceAssetIds) || binding.referenceAssetIds.length !== 1
    || binding.referenceAssetIds[0] !== binding.canonicalAssetId
    || !Number.isSafeInteger(binding.promptIrVersion) || Number(binding.promptIrVersion) <= 0
    || !Number.isSafeInteger(binding.profileRevision) || Number(binding.profileRevision) < 0
    || [binding.frameContentSha256, binding.promptIrContentSha256, binding.contextSnapshotSha256,
      binding.entityDraftContentSha256, binding.profileSnapshotSha256, binding.referencePackSha256,
      binding.referenceBindingSha256].some(value => !SHA256.test(String(value)))
    || item.providerCalls !== 0 || item.taskMutation !== false || item.outboxEvents !== 0) return undefined
  return item
}

function upstreamBase(baseUrl: string, item: Record<string, string>): URL {
  return new URL(
    `/api/qingmu/projects/${encodeURIComponent(item.projectId ?? '')}`
    + `/episodes/${encodeURIComponent(item.episodeId ?? '')}`
    + `/storyboard-revisions/${encodeURIComponent(item.storyboardRevisionId ?? '')}`
    + `/frames/${encodeURIComponent(item.frameId ?? '')}`
    + `/prompt-irs/${encodeURIComponent(item.promptIrId ?? '')}`
    + `/entity-drafts/${encodeURIComponent(item.draftId ?? '')}/review`,
    baseUrl,
  )
}

/**
 * Register exact same-origin Host routes for decisions and receipt recovery.
 *
 * @param webServer - Host web server that owns the browser-facing routes.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer that unregisters both routes.
 */
export function registerEntityDraftReviewCommands(
  webServer: WebServer,
  dependencies: EntityDraftReviewCommandDependencies,
): () => void {
  const disposeDecision = webServer.register({
    kind: 'exact', path: DECIDE_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'entity_draft_review_command_forbidden' }); return
      }
      const coordinates = scope(req)
      let request: Record<string, unknown> | undefined
      try { request = await body(req) } catch { request = undefined }
      if (coordinates === undefined || request === undefined
        || Object.keys(request).length !== 4
        || !['accepted', 'rejected'].includes(String(request.decision))
        || request.confirmed !== true
        || !(request.note === null || typeof request.note === 'string' && request.note.length <= 2000)
        || typeof request.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(request.idempotencyKey)) {
        json(res, 400, { code: 'entity_draft_review_request_invalid' }); return
      }
      const upstream = upstreamBase(dependencies.baseUrl, coordinates)
      const serialized = JSON.stringify(request)
      const issued = await call(dependencies, req, new URL(`${upstream.pathname}/intent`, upstream), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized,
      }, true)
      const intent = issued?.value as Record<string, unknown> | undefined
      if (issued?.response.ok !== true || intent?.schema !== 'jason.qingmu-human-authority-intent.v1'
        || intent.action !== 'entity_draft_human_review.record'
        || typeof intent.proof !== 'string' || intent.proof.length > 8192
        || typeof intent.requestSha256 !== 'string' || !SHA256.test(intent.requestSha256)) {
        json(res, issued?.response.status === 401 || issued?.response.status === 403 ? 401 : 409, {
          code: issued?.response.status === 401 || issued?.response.status === 403
            ? 'entity_draft_review_relogin_required' : 'entity_draft_review_intent_failed',
        }); return
      }
      const submitted = await call(dependencies, req, upstream, {
        method: 'POST', headers: {
          'content-type': 'application/json', 'x-qingmu-human-intent': intent.proof,
        }, body: serialized,
      }, true)
      let result = submitted?.response.ok === true ? receipt(submitted.value, coordinates) : undefined
      if (result === undefined && (submitted === undefined || submitted.response.status >= 500)) {
        const recovery = new URL(`${upstream.pathname}/receipt`, upstream)
        recovery.searchParams.set('idempotencyKey', request.idempotencyKey)
        recovery.searchParams.set('requestSha256', intent.requestSha256)
        const recovered = await call(dependencies, req, recovery, { method: 'GET' }, false)
        result = recovered?.response.ok === true ? receipt(recovered.value, coordinates) : undefined
      }
      if (result === undefined || result.idempotencyKey !== request.idempotencyKey
        || result.requestSha256 !== intent.requestSha256) {
        json(res, submitted?.response.status === 401 || submitted?.response.status === 403 ? 401 : 409, {
          code: submitted?.response.status === 409
            ? 'entity_draft_review_conflict' : 'entity_draft_review_unknown_or_failed',
        }); return
      }
      json(res, 200, result)
    },
  })
  const disposeReceipt = webServer.register({
    kind: 'exact', path: RECEIPT_PATH, handler: async (req, res) => {
      const coordinates = scope(req)
      if (req.method !== 'GET' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, []) || coordinates === undefined
        || !IDEMPOTENCY_KEY.test(coordinates.idempotencyKey ?? '')
        || !SHA256.test(coordinates.requestSha256 ?? '')) {
        json(res, 400, { code: 'entity_draft_review_receipt_request_invalid' }); return
      }
      const upstream = new URL(`${upstreamBase(dependencies.baseUrl, coordinates).pathname}/receipt`, dependencies.baseUrl)
      upstream.searchParams.set('idempotencyKey', coordinates.idempotencyKey ?? '')
      upstream.searchParams.set('requestSha256', coordinates.requestSha256 ?? '')
      const recovered = await call(dependencies, req, upstream, { method: 'GET' }, false)
      const result = recovered?.response.ok === true ? receipt(recovered.value, coordinates) : undefined
      if (result === undefined) {
        json(res, recovered?.response.status === 401 || recovered?.response.status === 403 ? 401 : 404, {
          code: recovered?.response.status === 401 || recovered?.response.status === 403
            ? 'entity_draft_review_relogin_required' : 'entity_draft_review_receipt_not_found',
        }); return
      }
      json(res, 200, result)
    },
  })
  return () => { disposeReceipt(); disposeDecision() }
}
