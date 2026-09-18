/**
 * Operator review of the director experience channel.
 *
 * Two Host routes over the two capsule files in the runtime root: one read of
 * what the director queued and what is currently injected into its persona, and
 * one human promotion of chosen queue entries into the active store. Promotion is
 * the only step that makes a lesson reach the model, so it is the human's
 * decision: this module never approves an entry on its own, never invents an id,
 * and refuses a request that is not a same-origin browser call from the
 * operator's own session.
 *
 * The read side of the channel ({@link experience-capsule-store.ts}) and the
 * write side ({@link experience-capsule-tools.ts}) stay as they are; the route
 * only composes them with {@link mergeApprovedCapsules}.
 */
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import {
  isSameOriginBrowserWrite, jsonResponse, readJsonBody,
} from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/src/human-browser-bridge.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  CAPSULE_ID, loadApprovedCapsules, loadQueuedCapsules,
  withCapsuleStoreLock, writeCapsuleFile,
} from './experience-capsule-files.ts'
import {
  ACTIVE_CAPSULE_RENDER_LIMIT, capsuleActiveStorePathFor, capsuleQueuePathFor,
  mergeApprovedCapsules, type ActiveCapsule, type QueuedCapsule,
} from './experience-capsule-store.ts'

/** The review read; its path is also the prefix of the promotion path. */
const REVIEW_PATH = '/api/qingmu/experience-capsule-review'

/** The human promotion. */
const PROMOTE_PATH = '/api/qingmu/experience-capsule-review/promote'

/** Response discriminator the panel checks before rendering. */
const SCHEMA = 'qingmu-experience-capsule-review-v1'

/**
 * Largest single promotion.
 *
 * The queue the operator is looking at is bounded by the submission tool's
 * 30-day pruning; 64 approvals in one decision is far above the five capsules
 * that waited through the channel's first two weeks and keeps the request body
 * derivable.
 */
const MAX_PROMOTIONS = 64

/**
 * Largest browser request body.
 *
 * Derived, not tuned: {@link MAX_PROMOTIONS} ids of at most 32 characters are
 * 2.2 KiB with the JSON punctuation, and the envelope adds `confirmed` and the
 * two key names. 8 KiB covers that with room for escaping while refusing an
 * unbounded read.
 */
const MAX_BODY_BYTES = 8 * 1024

/** Runtime dependencies of the capsule review routes. */
export interface ExperienceCapsuleReviewDependencies {
  /**
   * Harness runtime root holding both capsule files, resolved from
   * `QINGMU_RUNTIME_ROOT` or `QINGMU_NATIVE_ROOT`; empty when neither is set,
   * which is exactly when the director's own capsule tools are unmounted.
   */
  readonly runtimeRoot: string
}

/** One queued capsule as the panel reads it. */
interface QueueEntry extends QueuedCapsule {
  readonly alreadyApproved: boolean
}

/** One approved capsule as the panel reads it: `stages` is always present, and never injected past the render limit. */
interface ApprovedEntry extends Omit<ActiveCapsule, 'stages'> {
  readonly stages: readonly string[]
  readonly injected: boolean
}

/** The whole review state; the promotion reply carries the same fields plus `promoted`. */
interface ReviewState {
  readonly schema: typeof SCHEMA
  readonly renderLimit: number
  readonly injectedCount: number
  readonly queue: readonly QueueEntry[]
  readonly active: readonly ApprovedEntry[]
}

/**
 * Describe both capsule files as one review state.
 *
 * @param queue - queued capsules in stored order.
 * @param active - approved capsules, newest-first.
 * @param promoted - ids this promotion moved, present only in a promotion reply.
 * @returns the state the panel renders.
 */
function reviewState(
  queue: readonly QueuedCapsule[],
  active: readonly ActiveCapsule[],
  promoted?: readonly string[],
): ReviewState & { readonly promoted?: readonly string[] } {
  const approved = active.map((capsule, index) => ({
    ...capsule,
    stages: capsule.stages ?? [],
    injected: index < ACTIVE_CAPSULE_RENDER_LIMIT,
  }))
  return {
    schema: SCHEMA,
    renderLimit: ACTIVE_CAPSULE_RENDER_LIMIT,
    injectedCount: approved.filter(capsule => capsule.injected).length,
    queue: queue.map(entry => ({
      ...entry, alreadyApproved: active.some(capsule => capsule.id === entry.id),
    })),
    active: approved,
    ...(promoted === undefined ? {} : { promoted }),
  }
}

/**
 * Parse one promotion request.
 *
 * Only `confirmed` and `ids` are accepted, and every id must be one the operator
 * ticked: there is no approve-all form, so a promotion always names the exact
 * capsules the human read.
 *
 * @param value - parsed browser request body.
 * @returns the distinct approved ids, or undefined when any field is out of contract.
 */
function parsePromotion(value: Record<string, unknown>): readonly string[] | undefined {
  if (Object.keys(value).length !== 2 || value.confirmed !== true) return undefined
  const { ids } = value
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PROMOTIONS) return undefined
  const approved = new Set<string>()
  for (const entry of ids) {
    if (typeof entry !== 'string' || !CAPSULE_ID.test(entry) || approved.has(entry)) return undefined
    approved.add(entry)
  }
  return [...approved]
}

/**
 * Register the capsule review read and the human promotion route.
 *
 * Both routes answer only a same-origin browser on this Host: the shared trust
 * fence refuses a rebound or cross-site caller, and the promotion additionally
 * refuses a request carrying an `authorization` header or an `origin` that does
 * not match its own `host`. A promotion is what lets a lesson the director wrote
 * about itself reach the director's next turn, so it stays one human click.
 *
 * The promotion requires no session cookie. The two capsule files it writes are
 * already writable by any process running as this user, and a cookie this route
 * never verifies against the Writer's session store would only add a sign-in the
 * operator's browser cannot satisfy. The fence keeps a browser page on another
 * origin, and an ordinary tool call, from approving capsules; it does not keep out
 * a determined local caller, which needs no fence to write those files.
 *
 * The promotion writes the active store before it trims the queue, so a crash
 * between the two leaves the capsule approved and still queued; re-approving it
 * supersedes the stored entry instead of duplicating it. The opposite order could
 * drop an approved lesson silently.
 *
 * A capsule file this process cannot read or write answers 503, never an empty
 * review: "nothing queued" and "the queue is unusable" must not look the same to
 * the operator.
 *
 * @param webServer - Host web server that owns the browser-facing routes.
 * @param dependencies - runtime root holding the two capsule files.
 * @returns a disposer that unregisters both routes.
 */
export function registerExperienceCapsuleReviewRoutes(
  webServer: WebServer,
  dependencies: ExperienceCapsuleReviewDependencies,
): () => void {
  const readState = (): Promise<ReviewState> => withCapsuleStoreLock(() => {
    const queue = loadQueuedCapsules(capsuleQueuePathFor(dependencies.runtimeRoot))
    return reviewState(queue, loadApprovedCapsules(capsuleActiveStorePathFor(dependencies.runtimeRoot)))
  })

  const disposeRead = webServer.register({
    kind: 'exact', path: REVIEW_PATH, handler: async (req, res) => {
      if (req.method !== 'GET' || req.headers.authorization !== undefined || !isTrustedApiRequest(req, [])) {
        jsonResponse(res, 403, { code: 'experience_capsule_review_forbidden' }); return
      }
      if (dependencies.runtimeRoot === '') {
        jsonResponse(res, 503, { code: 'experience_capsule_review_runtime_root_unconfigured' }); return
      }
      let state: ReviewState
      try {
        state = await readState()
      } catch {
        // Swallows a capsule file this process cannot read: the operator is told
        // the store is unusable, never that nothing is queued.
        jsonResponse(res, 503, { code: 'experience_capsule_review_store_unavailable' }); return
      }
      jsonResponse(res, 200, state)
    },
  })

  const disposePromote = webServer.register({
    kind: 'exact', path: PROMOTE_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || !isTrustedApiRequest(req, []) || !isSameOriginBrowserWrite(req)) {
        jsonResponse(res, 403, { code: 'experience_capsule_review_forbidden' }); return
      }
      if (dependencies.runtimeRoot === '') {
        jsonResponse(res, 503, { code: 'experience_capsule_review_runtime_root_unconfigured' }); return
      }
      let parsed: Record<string, unknown> | undefined
      // Swallows an oversized or unparseable body: that is a bad request, not a server fault.
      try { parsed = await readJsonBody(req, MAX_BODY_BYTES) } catch { parsed = undefined }
      const ids = parsed === undefined ? undefined : parsePromotion(parsed)
      if (ids === undefined) {
        jsonResponse(res, 400, { code: 'experience_capsule_review_request_invalid' }); return
      }
      const queuePath = capsuleQueuePathFor(dependencies.runtimeRoot)
      const activePath = capsuleActiveStorePathFor(dependencies.runtimeRoot)
      let outcome: { readonly missing: readonly string[] } | { readonly state: ReviewState }
      try {
        // One lock for the whole decision, so a capsule the director submits while
        // this promotion writes is neither dropped from the queue nor approved unseen.
        outcome = await withCapsuleStoreLock(async () => {
          const queue = loadQueuedCapsules(queuePath)
          const queued = new Set(queue.map(capsule => capsule.id))
          const missing = ids.filter(id => !queued.has(id))
          if (missing.length > 0) return { missing }
          const merged = mergeApprovedCapsules(queue, loadApprovedCapsules(activePath), ids)
          await writeCapsuleFile(activePath, { capsules: merged.active })
          await writeCapsuleFile(queuePath, merged.remainingQueue)
          return { state: reviewState(merged.remainingQueue, merged.active, merged.merged) }
        })
      } catch {
        // Swallows a capsule file this process cannot read or write. The active store
        // is written first, so the capsule may already be approved while its queue
        // entry survives; a re-read shows both and re-promoting supersedes the entry.
        jsonResponse(res, 503, { code: 'experience_capsule_review_store_unavailable' }); return
      }
      if ('missing' in outcome) {
        jsonResponse(res, 409, { code: 'experience_capsule_review_ids_not_queued', ids: outcome.missing }); return
      }
      jsonResponse(res, 200, outcome.state)
    },
  })

  return () => { disposeRead(); disposePromote() }
}
