/** Same-origin cookie-only command that accepts one exact episode storyboard frame set. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const PATH = '/api/qingmu/storyboard-human-review/accept'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SHA256 = /^[0-9a-f]{64}$/
/** The Writer reports failures as snake_case identifiers, so only those are relayed. */
const WRITER_CODE = /^[a-z][a-z0-9_]{0,127}$/

/**
 * Largest accepted frame set.
 *
 * The Writer requires `items` to equal the episode's current frame list exactly,
 * so this bounds one episode's storyboard length rather than a batch. 256 is
 * more than five times the largest live episode (49 frames) and keeps
 * {@link MAX_BODY_BYTES} derivable from it.
 */
const MAX_ITEMS = 256

/**
 * Largest browser request body.
 *
 * Derived, not tuned: the Writer bounds `frame_id` at 200 characters and
 * `expected_frame_digest` at 64, so one item serializes to at most 310 bytes
 * including JSON punctuation and the two key names. `MAX_ITEMS` such items are
 * 77.5 KiB; the envelope adds a 64-character frame-set digest, a 128-character
 * idempotency key, `confirmed`, and a note the Writer bounds at 1000 characters
 * (3000 UTF-8 bytes for CJK), which is under 3.5 KiB. 96 KiB covers that with
 * room for JSON escaping while refusing an unbounded read.
 */
const MAX_BODY_BYTES = 96 * 1024

/** Largest upstream response body; the acceptance receipt carries one short record per frame. */
const MAX_RESPONSE_BYTES = 256 * 1024

/** The Writer's `note` maximum, mirrored so the browser learns the limit before submitting. */
const MAX_NOTE_LENGTH = 1000

/** Runtime dependencies for the storyboard review accept bridge. */
export interface StoryboardHumanReviewCommandDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

/** One frame of the exact set the human accepts. */
interface AcceptItem {
  readonly frameId: string
  readonly expectedFrameDigest: string
}

/** The validated browser decision. */
interface AcceptRequest {
  readonly expectedFrameSetDigest: string
  readonly items: readonly AcceptItem[]
  readonly note: string
  readonly idempotencyKey: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** The single accepted query coordinate, or undefined for any other query. */
function episodeCoordinate(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 1 || keys[0] !== 'episodeId') return undefined
  const value = url.searchParams.get('episodeId') ?? ''
  return IDENTIFIER.test(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function browserHeaders(req: IncomingMessage, upstream: URL): Headers | undefined {
  const host = req.headers.host
  if (typeof host !== 'string' || req.headers.authorization !== undefined) return undefined
  if (req.headers.origin !== `http://${host}`) return undefined
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  if (cookie === undefined || cookie.length > 8192 || /[\r\n]/.test(cookie)) return undefined
  return new Headers({
    accept: 'application/json', 'content-type': 'application/json',
    cookie, origin: upstream.origin, host: upstream.host,
  })
}

async function body(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') return undefined
  const declared = Number(req.headers['content-length'] ?? '')
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_BODY_BYTES) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > declared) return undefined
    chunks.push(chunk)
  }
  if (size !== declared) return undefined
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  return isRecord(parsed) ? parsed : undefined
}

/**
 * Validate the browser decision and normalize it to the Writer's field names.
 *
 * Per-item keys are restricted to `frameId` and `expectedFrameDigest`. The
 * Writer's item model also accepts `prompt_override`, `preflight_id`, `model`
 * and `resolution`, which route the frame through a paid preflight authority;
 * refusing them here keeps this decision at `providerCalls: 0` no matter what a
 * browser posts.
 *
 * @param value - Parsed browser request body.
 * @returns The validated decision, or undefined when any field is out of contract.
 */
function parseRequest(value: Record<string, unknown>): AcceptRequest | undefined {
  if (Object.keys(value).length !== 5 || value.confirmed !== true) return undefined
  const { expectedFrameSetDigest, note, idempotencyKey } = value
  if (typeof expectedFrameSetDigest !== 'string' || !SHA256.test(expectedFrameSetDigest)) return undefined
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) return undefined
  if (typeof note !== 'string') return undefined
  const cleanNote = note.trim()
  if (cleanNote === '' || cleanNote.length > MAX_NOTE_LENGTH) return undefined
  const { items } = value
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return undefined
  const frameIds = new Set<string>()
  const accepted: AcceptItem[] = []
  for (const item of items) {
    if (!isRecord(item) || Object.keys(item).length !== 2) return undefined
    const { frameId, expectedFrameDigest } = item
    if (typeof frameId !== 'string' || !IDENTIFIER.test(frameId)) return undefined
    if (typeof expectedFrameDigest !== 'string' || !SHA256.test(expectedFrameDigest)) return undefined
    if (frameIds.has(frameId)) return undefined
    frameIds.add(frameId)
    accepted.push({ frameId, expectedFrameDigest })
  }
  return { expectedFrameSetDigest, items: accepted, note: cleanNote, idempotencyKey }
}

function upstreamBody(request: AcceptRequest): string {
  return JSON.stringify({
    expected_frame_set_digest: request.expectedFrameSetDigest,
    items: request.items.map(item => ({
      frame_id: item.frameId, expected_frame_digest: item.expectedFrameDigest,
    })),
    note: request.note,
    idempotency_key: request.idempotencyKey,
  })
}

/**
 * Validate the Writer's acceptance receipt against the decision that produced it.
 *
 * The receipt proves the whole set landed: every requested frame appears in
 * order with a recorded check, the accepted count equals the requested count,
 * and the frame-set digest is the one the human reviewed.
 *
 * @param value - Parsed upstream body.
 * @param request - The validated browser decision.
 * @returns The receipt, or undefined when it does not confirm this decision.
 */
function acceptance(value: unknown, request: AcceptRequest): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  const items = value.items
  if (items.length !== request.items.length) return undefined
  if (value.totalCount !== items.length || value.acceptedCount !== items.length) return undefined
  if (value.frameSetDigest !== request.expectedFrameSetDigest) return undefined
  if (value.providerCalls !== 0 || value.budgetMutation !== false) return undefined
  const recorded = items.every((item, index) => isRecord(item)
    && item.frameId === request.items[index]?.frameId
    && typeof item.checkId === 'string' && item.checkId !== '')
  return recorded ? value : undefined
}

/** The Writer's failure identifier from a FastAPI `detail` body, when it is one. */
function writerCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const detail = value.detail
  const code = isRecord(detail) ? detail.code : detail
  return typeof code === 'string' && WRITER_CODE.test(code) ? code : undefined
}

/**
 * Register the exact same-origin Host route that records one episode storyboard acceptance.
 *
 * Anything whose outcome is not provably a rejection is reported as 502 rather than 409: a 5xx, a
 * transport failure, and any 2xx whose receipt cannot be read or does not confirm the reviewed
 * frame set. The Writer commits the whole set in one transaction, so in each of those cases the
 * acceptance may already be recorded and the caller must re-read the state instead of resubmitting.
 * Only a definitive sub-400 Writer rejection becomes 409, carrying the Writer's reason code when it
 * reports one.
 *
 * @param webServer - Host web server that owns the browser-facing route.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer that unregisters the route.
 */
export function registerStoryboardHumanReviewCommands(
  webServer: WebServer,
  dependencies: StoryboardHumanReviewCommandDependencies,
): () => void {
  return webServer.register({
    kind: 'exact', path: PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'storyboard_human_review_command_forbidden' }); return
      }
      const episodeId = episodeCoordinate(req)
      let parsed: Record<string, unknown> | undefined
      try { parsed = await body(req) } catch { parsed = undefined }
      const request = parsed === undefined ? undefined : parseRequest(parsed)
      if (episodeId === undefined || request === undefined) {
        json(res, 400, { code: 'storyboard_human_review_request_invalid' }); return
      }
      const upstream = new URL(
        `/api/episodes/${encodeURIComponent(episodeId)}/storyboard-human-review`,
        dependencies.baseUrl,
      )
      const headers = browserHeaders(req, upstream)
      if (headers === undefined) {
        json(res, 403, { code: 'storyboard_human_review_command_forbidden' }); return
      }
      try {
        const response = await dependencies.fetch(upstream, {
          method: 'POST', redirect: 'error', headers, body: upstreamBody(request),
        })
        const bytes = Buffer.from(await response.arrayBuffer())
        const value = bytes.length <= MAX_RESPONSE_BYTES
          ? JSON.parse(bytes.toString('utf8')) as unknown : undefined
        if (response.ok) {
          const result = acceptance(value, request)
          if (result === undefined) {
            // A 2xx means the Writer's single transaction committed, so an unread
            // or non-confirming receipt is an unknown outcome, never a rejection:
            // the caller must re-read the state instead of resubmitting with a
            // fresh idempotency key and writing a duplicate review.
            json(res, 502, {
              code: value === undefined
                ? 'storyboard_human_review_accept_unknown'
                : 'storyboard_human_review_acceptance_invalid',
            }); return
          }
          json(res, 200, result); return
        }
        if (response.status === 401 || response.status === 403) {
          json(res, 401, { code: 'storyboard_human_review_relogin_required' }); return
        }
        if (response.status >= 500) {
          json(res, 502, { code: 'storyboard_human_review_accept_unknown' }); return
        }
        const reason = writerCode(value)
        json(res, 409, reason === undefined
          ? { code: 'storyboard_human_review_accept_rejected' }
          : { code: 'storyboard_human_review_accept_rejected', reason })
      } catch {
        json(res, 502, { code: 'storyboard_human_review_accept_unknown' })
      }
    },
  })
}
