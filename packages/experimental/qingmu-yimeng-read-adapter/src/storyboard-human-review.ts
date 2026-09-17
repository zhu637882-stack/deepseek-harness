/** Cookie-authenticated Host read bridge for the storyboard pre-production human review gate. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const PATH = '/api/qingmu/storyboard-human-review/state'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[0-9a-f]{64}$/
const VERSION = 'storyboard-preproduction-human-review-v1'

/**
 * Upper bound on one Writer episode review state.
 *
 * The state embeds one `frame_status` per storyboard frame, each carrying the
 * frame's Chinese image prompt, the preflight findings, the source-summary text
 * and, once reviewed, the stored review payload (which repeats a prompt
 * override). Live episodes hold up to 49 frames, so 4 MiB leaves roughly 85 KiB
 * per frame — beyond what any bounded text field in `frame_status` reaches —
 * while still bounding Host memory. Nothing in the payload is a media body:
 * `selectedFirstFrame` carries `/api/media/<id>` and `http(s)` URLs, never data
 * URLs. An oversized state fails closed as invalid rather than being truncated.
 */
const MAX_STATE_BYTES = 4 * 1024 * 1024

/** Runtime dependencies for the storyboard review state bridge. */
export interface StoryboardHumanReviewReadDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
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

function cookieHeader(req: IncomingMessage): string | undefined {
  if (req.headers.authorization !== undefined) return undefined
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith('jason_token='))
  return cookie !== undefined && cookie.length <= 8192 && !/[\r\n]/.test(cookie) ? cookie : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The closed `blockerCode` set `frame_status` returns, `null` included. */
function frameBlocker(value: unknown): boolean {
  return value === null || value === 'storyboard_human_review_required'
    || value === 'storyboard_prompt_contract_invalid' || value === 'storyboard_human_review_stale'
    || value === 'storyboard_human_review_rejected' || value === 'generation_runtime_check_deferred'
}

/**
 * One `frame_status` item, cross-checking the two agreements the Writer states:
 * `accepted` is true exactly when `status` is `accepted`, and `blockerCode` is
 * `null` exactly when the frame is accepted.
 */
function validItem(value: unknown): boolean {
  if (!isRecord(value)) return false
  const { status, accepted } = value
  const isAccepted = accepted === true
  return IDENTIFIER.test(String(value.frameId)) && SHA256.test(String(value.frameDigest))
    && Number.isSafeInteger(value.frameNo) && Number(value.frameNo) >= 0
    && typeof value.title === 'string' && typeof value.imagePromptCn === 'string'
    && typeof value.durationSec === 'number' && Number.isFinite(value.durationSec) && value.durationSec >= 0
    && typeof accepted === 'boolean'
    && (status === 'pending' || status === 'technical_invalid' || status === 'stale'
      || status === 'rejected' || status === 'accepted')
    && (status === 'accepted') === isAccepted
    && frameBlocker(value.blockerCode) && (value.blockerCode === null) === isAccepted
    && (value.review === null || isRecord(value.review))
}

/**
 * The `episode_status` payload, validated before it reaches the browser.
 *
 * The counts are recomputed from `items` rather than trusted, so a state whose
 * `accepted` flag disagrees with its own frame list is refused instead of being
 * shown as a passable gate. An empty `items` list is a legitimate "no storyboard
 * frames yet" episode, but it must never read as accepted, so acceptance also
 * requires at least one frame — matching the Writer's own `bool(items) and …`.
 *
 * @param value - Parsed upstream body.
 * @param episodeId - The episode the browser asked for.
 * @returns Whether the payload is the current state of exactly that episode.
 */
function validState(value: unknown, episodeId: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.items)) return false
  const items = value.items
  const frameIds = new Set<string>()
  let acceptedCount = 0
  for (const item of items) {
    if (!validItem(item)) return false
    const record = item as Record<string, unknown>
    const frameId = String(record.frameId)
    if (frameIds.has(frameId)) return false
    frameIds.add(frameId)
    if (record.accepted === true) acceptedCount += 1
  }
  const accepted = value.accepted === true
  return value.version === VERSION && value.episodeId === episodeId
    && IDENTIFIER.test(String(value.projectId))
    && SHA256.test(String(value.frameSetDigest))
    && Number.isSafeInteger(value.storyboardRevision) && Number(value.storyboardRevision) >= 0
    && typeof value.accepted === 'boolean'
    && value.totalCount === items.length
    && value.acceptedCount === acceptedCount
    && accepted === (items.length > 0 && acceptedCount === items.length)
    && (accepted ? value.blockerCode === null : value.blockerCode === 'storyboard_human_review_required')
    && value.providerCalls === 0 && value.budgetMutation === false
}

/**
 * Register the exact same-origin Host route that reads one episode's storyboard review state.
 *
 * @param webServer - Host web server that owns the browser-facing route.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer that unregisters the route.
 */
export function registerStoryboardHumanReviewRead(
  webServer: WebServer,
  dependencies: StoryboardHumanReviewReadDependencies,
): () => void {
  return webServer.register({
    kind: 'exact', path: PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        json(res, 403, { code: 'storyboard_human_review_read_forbidden' }); return
      }
      const episodeId = episodeCoordinate(req)
      if (episodeId === undefined) {
        json(res, 400, { code: 'storyboard_human_review_read_invalid' }); return
      }
      const cookie = cookieHeader(req)
      if (cookie === undefined) {
        json(res, 401, { code: 'storyboard_human_review_relogin_required' }); return
      }
      const upstream = new URL(
        `/api/episodes/${encodeURIComponent(episodeId)}/storyboard-human-review`,
        dependencies.baseUrl,
      )
      try {
        const response = await dependencies.fetch(upstream, {
          method: 'GET', redirect: 'error', headers: { accept: 'application/json', cookie },
        })
        const bytes = Buffer.from(await response.arrayBuffer())
        const value = bytes.length <= MAX_STATE_BYTES
          ? JSON.parse(bytes.toString('utf8')) as unknown : undefined
        if (!response.ok || !validState(value, episodeId)) {
          const relogin = response.status === 401 || response.status === 403
          json(res, relogin ? 401 : 409, {
            code: relogin
              ? 'storyboard_human_review_relogin_required'
              : 'storyboard_human_review_state_invalid',
          }); return
        }
        json(res, 200, value)
      } catch {
        json(res, 502, { code: 'storyboard_human_review_state_unavailable' })
      }
    },
  })
}
