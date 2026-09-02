/** Same-origin, cookie-only media bridge for explicitly previewing one first-frame candidate. */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

export const FIRST_FRAME_SELECTION_MEDIA_PATH = '/api/qingmu/first-frame-selection/media'
export const FIRST_FRAME_SELECTION_STATE_PATH = '/api/qingmu/first-frame-selection/state'
export const FIRST_FRAME_SELECTION_DECISION_PATH = '/api/qingmu/first-frame-selection/decision'
export const FIRST_FRAME_SELECTION_RECEIPT_PATH = '/api/qingmu/first-frame-selection/receipt'
export const MAX_FIRST_FRAME_PREVIEW_BYTES = 16 * 1024 * 1024

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[0-9a-f]{64}$/
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Runtime dependencies for the same-origin first-frame media bridge. */
export interface FirstFrameSelectionCommandDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

interface Coordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly assetId: string
  readonly expectedMaterializedSha256: string
}

interface SelectionRequest extends Coordinates {
  readonly idempotencyKey: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function coordinates(req: IncomingMessage): Coordinates | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'assetId', 'expectedMaterializedSha256']
  if ([...url.searchParams.keys()].some(key => !keys.includes(key))) return undefined
  const raw = Object.fromEntries(keys.map(key => [key, url.searchParams.get(key) ?? '']))
  const value: Coordinates = {
    projectId: raw.projectId ?? '', episodeId: raw.episodeId ?? '', storyboardRevisionId: raw.storyboardRevisionId ?? '',
    frameId: raw.frameId ?? '', assetId: raw.assetId ?? '', expectedMaterializedSha256: raw.expectedMaterializedSha256 ?? '',
  }
  return IDENTIFIER.test(value.projectId) && IDENTIFIER.test(value.episodeId)
    && IDENTIFIER.test(value.storyboardRevisionId) && IDENTIFIER.test(value.frameId)
    && IDENTIFIER.test(value.assetId) && SHA256.test(value.expectedMaterializedSha256) ? value : undefined
}

function stateCoordinates(req: IncomingMessage): Omit<Coordinates, 'assetId' | 'expectedMaterializedSha256'> | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId']
  if ([...url.searchParams.keys()].some(key => !keys.includes(key))) return undefined
  const value = Object.fromEntries(keys.map(key => [key, url.searchParams.get(key) ?? '']))
  return keys.every(key => IDENTIFIER.test(value[key] ?? '')) ? value as Omit<Coordinates, 'assetId' | 'expectedMaterializedSha256'> : undefined
}

function selectionRequest(req: IncomingMessage): SelectionRequest | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'assetId', 'expectedMaterializedSha256', 'idempotencyKey']
  if ([...url.searchParams.keys()].some(key => !keys.includes(key) && key !== 'requestSha256')) return undefined
  const raw = Object.fromEntries(keys.map(key => [key, url.searchParams.get(key) ?? '']))
  const value: SelectionRequest = {
    projectId: raw.projectId ?? '', episodeId: raw.episodeId ?? '', storyboardRevisionId: raw.storyboardRevisionId ?? '',
    frameId: raw.frameId ?? '', assetId: raw.assetId ?? '', expectedMaterializedSha256: raw.expectedMaterializedSha256 ?? '',
    idempotencyKey: raw.idempotencyKey ?? '',
  }
  return IDENTIFIER.test(value.projectId) && IDENTIFIER.test(value.episodeId)
    && IDENTIFIER.test(value.storyboardRevisionId) && IDENTIFIER.test(value.frameId)
    && IDENTIFIER.test(value.assetId) && SHA256.test(value.expectedMaterializedSha256)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.idempotencyKey) ? value : undefined
}

function browserHeaders(req: IncomingMessage, upstream: URL): Headers | undefined {
  if (req.headers.authorization !== undefined) return undefined
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  if (cookie === undefined || cookie.length > 8192 || /[\r\n]/.test(cookie)) return undefined
  return new Headers({ accept: 'application/json', cookie, origin: upstream.origin, host: upstream.host })
}

function upstreamBase(baseUrl: string, value: Coordinates): URL {
  return new URL(
    `/api/qingmu/projects/${encodeURIComponent(value.projectId)}`
    + `/episodes/${encodeURIComponent(value.episodeId)}`
    + `/storyboard-revisions/${encodeURIComponent(value.storyboardRevisionId)}`
    + `/frames/${encodeURIComponent(value.frameId)}/first-frame-selection`,
    baseUrl,
  )
}

function candidateIsCurrent(value: unknown, expected: Coordinates): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const root = value as Record<string, unknown>
  if (root.projectId !== expected.projectId || root.episodeId !== expected.episodeId
    || root.storyboardRevisionId !== expected.storyboardRevisionId || root.frameId !== expected.frameId
    || !Array.isArray(root.candidates)) return false
  return root.candidates.some(candidate => typeof candidate === 'object' && candidate !== null
    && !Array.isArray(candidate) && (candidate as Record<string, unknown>).assetId === expected.assetId
    && (candidate as Record<string, unknown>).materializedSha256 === expected.expectedMaterializedSha256
    && SHA256.test(String((candidate as Record<string, unknown>).assetSha256))
    && (candidate as Record<string, unknown>).qualityStatus === 'passed'
    && ['Unselected', 'Selected'].includes(String((candidate as Record<string, unknown>).selectionStatus))
    && typeof (candidate as Record<string, unknown>).isSelected === 'boolean')
}

function stateIsCurrent(value: unknown, expected: Omit<Coordinates, 'assetId' | 'expectedMaterializedSha256'>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const root = value as Record<string, unknown>
  const keys = ['schema', 'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'frameUpdatedAt', 'storyboardRevision',
    'identity', 'candidates', 'selectedAssetId', 'selectionReceipt', 'blockers', 'providerCalls', 'taskMutation', 'outboxEvents']
  if (JSON.stringify(Object.keys(root).sort()) !== JSON.stringify(keys.sort())
    || typeof root.schema !== 'string' || root.projectId !== expected.projectId || root.episodeId !== expected.episodeId
    || root.storyboardRevisionId !== expected.storyboardRevisionId || root.frameId !== expected.frameId
    || !Array.isArray(root.candidates) || !Array.isArray(root.blockers)
    || root.providerCalls !== 0 || root.taskMutation !== false || root.outboxEvents !== 0) return false
  const identity = root.identity as Record<string, unknown> | undefined
  const baseValid = typeof root.frameUpdatedAt === 'string' && Number.isSafeInteger(root.storyboardRevision)
    && Number(root.storyboardRevision) >= 1
    && typeof identity === 'object' && identity !== null && identity.state === 'bound'
    && IDENTIFIER.test(String(identity.actorUserId)) && IDENTIFIER.test(String(identity.naturalPersonId))
    && root.candidates.every(candidate => typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
      && IDENTIFIER.test(String((candidate as Record<string, unknown>).assetId))
      && SHA256.test(String((candidate as Record<string, unknown>).assetSha256))
      && SHA256.test(String((candidate as Record<string, unknown>).materializedSha256))
      && (candidate as Record<string, unknown>).qualityStatus === 'passed'
      && ['Unselected', 'Selected'].includes(String((candidate as Record<string, unknown>).selectionStatus))
      && typeof (candidate as Record<string, unknown>).isSelected === 'boolean'
      && typeof (candidate as Record<string, unknown>).assetUpdatedAt === 'string')
  if (!baseValid) return false
  if (root.selectedAssetId === null) return root.selectionReceipt === null
  const selected = root.candidates.find(candidate => typeof candidate === 'object' && candidate !== null
    && (candidate as Record<string, unknown>).assetId === root.selectedAssetId) as Record<string, unknown> | undefined
  const receipt = root.selectionReceipt as Record<string, unknown> | null
  return selected !== undefined && selected.isSelected === true && selected.selectionStatus === 'Selected'
    && receipt !== null && receiptIsCurrent(receipt, {
    projectId: expected.projectId, episodeId: expected.episodeId, storyboardRevisionId: expected.storyboardRevisionId,
    frameId: expected.frameId, assetId: String(selected.assetId),
    expectedMaterializedSha256: String(selected.materializedSha256), idempotencyKey: String(receipt.idempotencyKey),
  }, String(receipt.requestSha256))
}

async function requestBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') return undefined
  const declared = Number(req.headers['content-length'] ?? '')
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > 8192) return undefined
  const chunks: Buffer[] = []; let size = 0
  for await (const item of req) {
    const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item)
    size += chunk.length
    if (size > declared) return undefined
    chunks.push(chunk)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  return size === declared && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : undefined
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite JSON number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
  }
  throw new Error('non-JSON receipt value')
}

function canonicalSha256(value: unknown): string | undefined {
  try { return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex') } catch { return undefined }
}

function receiptIsCurrent(value: unknown, expected: SelectionRequest, requestSha256?: string): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const keys = ['schema', 'selectionIdentity', 'actorUserId', 'naturalPersonId', 'projectId', 'episodeId', 'storyboardRevisionId',
    'frameId', 'selectedAssetId', 'selectedAssetSha256', 'selectedMaterializedSha256', 'selectionStatus', 'idempotencyKey',
    'requestSha256', 'intentSessionSha256', 'intentBindingSha256', 'binding', 'bindingSha256', 'selectedAt', 'receiptSha256',
    'providerCalls', 'taskMutation', 'outboxEvents']
  return JSON.stringify(Object.keys(item).sort()) === JSON.stringify(keys.sort())
    && item.schema === 'jason.qingmu-first-frame-selection-receipt.v1'
    && item.projectId === expected.projectId && item.episodeId === expected.episodeId
    && item.storyboardRevisionId === expected.storyboardRevisionId && item.frameId === expected.frameId
    && item.selectedAssetId === expected.assetId && item.selectedAssetSha256 === expected.expectedMaterializedSha256
    && item.selectedMaterializedSha256 === expected.expectedMaterializedSha256
    && item.selectionStatus === 'Selected' && item.idempotencyKey === expected.idempotencyKey
    && (requestSha256 === undefined || item.requestSha256 === requestSha256)
    && ['selectionIdentity', 'selectedAssetSha256', 'selectedMaterializedSha256', 'requestSha256', 'intentSessionSha256',
      'intentBindingSha256', 'bindingSha256', 'receiptSha256'].every(key => SHA256.test(String(item[key])))
    && IDENTIFIER.test(String(item.actorUserId)) && IDENTIFIER.test(String(item.naturalPersonId))
    && typeof item.selectedAt === 'string' && item.providerCalls === 0 && item.taskMutation === false && item.outboxEvents === 0
    && canonicalSha256(item.binding) === item.bindingSha256
    && canonicalSha256(Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'receiptSha256'))) === item.receiptSha256
}

async function jsonUpstream(
  dependencies: FirstFrameSelectionCommandDependencies,
  req: IncomingMessage,
  upstream: URL,
  init: RequestInit = {},
  write = false,
): Promise<{ readonly response: Response; readonly value: unknown } | undefined> {
  const headers = browserHeaders(req, upstream)
  const host = req.headers.host
  if (headers === undefined || (write && (typeof host !== 'string' || req.headers.origin !== `http://${host}`))) return undefined
  for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
  try {
    const response = await dependencies.fetch(upstream, { ...init, headers, redirect: 'error' })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 256 * 1024) return undefined
    return { response, value: JSON.parse(bytes.toString('utf8')) as unknown }
  } catch { return undefined }
}

async function mediaUpstream(
  dependencies: FirstFrameSelectionCommandDependencies,
  req: IncomingMessage,
  upstream: URL,
): Promise<{ readonly mimeType: string; readonly bytes: Buffer } | undefined> {
  const headers = browserHeaders(req, upstream)
  if (headers === undefined) return undefined
  headers.set('accept', 'image/jpeg,image/png,image/webp')
  try {
    const response = await dependencies.fetch(upstream, { headers, redirect: 'error' })
    const declared = Number(response.headers.get('content-length') ?? '')
    if (!response.ok || (Number.isSafeInteger(declared) && (declared < 1 || declared > MAX_FIRST_FRAME_PREVIEW_BYTES))) return undefined
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase()
    if (mimeType === undefined || !IMAGE_MIME_TYPES.has(mimeType)) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length > 0 && bytes.length <= MAX_FIRST_FRAME_PREVIEW_BYTES ? { mimeType, bytes } : undefined
  } catch { return undefined }
}

/**
 * Register a read-only byte-verified candidate media preview. It cannot select or promote an asset.
 *
 * @param webServer - Host-owned same-origin web server.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer for the media route.
 */
export function registerFirstFrameSelectionCommands(
  webServer: WebServer,
  dependencies: FirstFrameSelectionCommandDependencies,
): () => void {
  const disposeState = webServer.register({
    kind: 'exact', path: FIRST_FRAME_SELECTION_STATE_PATH, handler: async (req, res) => {
      const value = stateCoordinates(req)
      if (req.method !== 'GET' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, []) || value === undefined) {
        json(res, 400, { code: 'first_frame_selection_state_request_invalid' }); return
      }
      const result = await jsonUpstream(dependencies, req, upstreamBase(dependencies.baseUrl, value as Coordinates))
      if (result?.response.ok !== true || !stateIsCurrent(result.value, value)) {
        json(res, result?.response.status === 401 || result?.response.status === 403 ? 401 : 409, {
          code: result?.response.status === 401 || result?.response.status === 403
            ? 'first_frame_selection_relogin_required' : 'first_frame_selection_state_invalid',
        }); return
      }
      json(res, 200, result.value)
    },
  })
  const disposeDecision = webServer.register({
    kind: 'exact', path: FIRST_FRAME_SELECTION_DECISION_PATH, handler: async (req, res) => {
      const value = selectionRequest(req)
      let body: Record<string, unknown> | undefined
      try { body = await requestBody(req) } catch { body = undefined }
      if (req.method !== 'POST' || req.headers.authorization !== undefined || !isTrustedApiRequest(req, [])
        || value === undefined || body === undefined || JSON.stringify(Object.keys(body).sort()) !== JSON.stringify([
        'assetId', 'expectedAssetId', 'expectedMaterializedSha256', 'expectedStoryboardRevisionId', 'confirmed', 'idempotencyKey',
      ].sort()) || body.assetId !== value.assetId || body.expectedAssetId !== value.assetId
        || body.expectedMaterializedSha256 !== value.expectedMaterializedSha256
        || body.expectedStoryboardRevisionId !== value.storyboardRevisionId || body.confirmed !== true
        || body.idempotencyKey !== value.idempotencyKey) {
        json(res, 400, { code: 'first_frame_selection_request_invalid' }); return
      }
      const upstream = upstreamBase(dependencies.baseUrl, value)
      const serialized = JSON.stringify(body)
      const intent = await jsonUpstream(dependencies, req, new URL(`${upstream.pathname}/intent`, upstream), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized,
      }, true)
      const issued = intent?.value as Record<string, unknown> | undefined
      if (intent?.response.ok !== true || issued?.schema !== 'jason.qingmu-human-authority-intent.v1'
        || issued.action !== 'first_frame_selection.record' || typeof issued.proof !== 'string' || issued.proof.length > 8192
        || !SHA256.test(String(issued.requestSha256))) {
        json(res, intent?.response.status === 401 || intent?.response.status === 403 ? 401 : 409, {
          code: intent?.response.status === 401 || intent?.response.status === 403
            ? 'first_frame_selection_relogin_required' : 'first_frame_selection_intent_failed',
        }); return
      }
      const requestSha256 = issued.requestSha256 as string
      const submitted = await jsonUpstream(dependencies, req, upstream, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-qingmu-human-intent': issued.proof }, body: serialized,
      }, true)
      let result = submitted?.response.ok === true && receiptIsCurrent(submitted.value, value, requestSha256)
        ? submitted.value as Record<string, unknown> : undefined
      if (result === undefined && (submitted === undefined || submitted.response.status >= 500)) {
        const recoveryUrl = new URL(`${upstream.pathname}/receipt`, upstream)
        recoveryUrl.searchParams.set('idempotencyKey', value.idempotencyKey)
        recoveryUrl.searchParams.set('requestSha256', requestSha256)
        const recovered = await jsonUpstream(dependencies, req, recoveryUrl)
        const outer = recovered?.value as Record<string, unknown> | undefined
        if (recovered?.response.ok === true && outer?.status === 'committed'
          && receiptIsCurrent(outer.result, value, requestSha256)) result = outer.result as Record<string, unknown>
      }
      if (result === undefined) {
        json(res, submitted?.response.status === 401 || submitted?.response.status === 403 ? 401 : 409, {
          code: submitted?.response.status === 401 || submitted?.response.status === 403
            ? 'first_frame_selection_relogin_required' : 'first_frame_selection_unknown_or_failed',
          recovery: { idempotencyKey: value.idempotencyKey, requestSha256 },
        }); return
      }
      json(res, 200, result)
    },
  })
  const disposeReceipt = webServer.register({
    kind: 'exact', path: FIRST_FRAME_SELECTION_RECEIPT_PATH, handler: async (req, res) => {
      const value = selectionRequest(req)
      const requestSha256 = new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('requestSha256')
      if (req.method !== 'GET' || req.headers.authorization !== undefined || !isTrustedApiRequest(req, [])
        || value === undefined || !SHA256.test(requestSha256 ?? '')) {
        json(res, 400, { code: 'first_frame_selection_receipt_request_invalid' }); return
      }
      const upstream = new URL(`${upstreamBase(dependencies.baseUrl, value).pathname}/receipt`, dependencies.baseUrl)
      upstream.searchParams.set('idempotencyKey', value.idempotencyKey)
      upstream.searchParams.set('requestSha256', requestSha256 ?? '')
      const recovered = await jsonUpstream(dependencies, req, upstream)
      const outer = recovered?.value as Record<string, unknown> | undefined
      if (recovered?.response.ok !== true || outer?.status !== 'committed' || !receiptIsCurrent(outer.result, value, requestSha256 ?? undefined)) {
        json(res, recovered?.response.status === 401 || recovered?.response.status === 403 ? 401 : 404, {
          code: recovered?.response.status === 401 || recovered?.response.status === 403
            ? 'first_frame_selection_relogin_required' : 'first_frame_selection_receipt_not_found',
        }); return
      }
      json(res, 200, outer.result)
    },
  })
  const disposeMedia = webServer.register({
    kind: 'exact', path: FIRST_FRAME_SELECTION_MEDIA_PATH, handler: async (req, res) => {
      const value = coordinates(req)
      if (req.method !== 'GET' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, []) || value === undefined) {
        json(res, 400, { code: 'first_frame_preview_request_invalid' }); return
      }
      const stateUrl = upstreamBase(dependencies.baseUrl, value)
      const state = await jsonUpstream(dependencies, req, stateUrl)
      if (state?.response.ok !== true || !candidateIsCurrent(state.value, value)) {
        json(res, state?.response.status === 401 || state?.response.status === 403 ? 401 : 409, {
          code: state?.response.status === 401 || state?.response.status === 403
            ? 'first_frame_preview_relogin_required' : 'first_frame_preview_candidate_stale',
        }); return
      }
      const media = await mediaUpstream(
        dependencies,
        req,
        new URL(`/api/media/${encodeURIComponent(value.assetId)}`, dependencies.baseUrl),
      )
      if (media === undefined
        || createHash('sha256').update(media.bytes).digest('hex') !== value.expectedMaterializedSha256) {
        json(res, 409, { code: 'first_frame_preview_media_changed' }); return
      }
      json(res, 200, {
        projectId: value.projectId, episodeId: value.episodeId, storyboardRevisionId: value.storyboardRevisionId, frameId: value.frameId,
        assetId: value.assetId, materializedSha256: value.expectedMaterializedSha256,
        mimeType: media.mimeType, base64: media.bytes.toString('base64'),
      })
    },
  })
  return () => { disposeMedia(); disposeReceipt(); disposeDecision(); disposeState() }
}
