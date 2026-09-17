/** Same-origin cookie-only commands that quote and then start one formal asset-image audit batch. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection/src/api-request-trust.ts'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { browserWriteHeaders, isRecord, jsonResponse, readJsonBody, writerCode } from './human-browser-bridge.ts'

const QUOTE_PATH = '/api/qingmu/asset-reference-audit/quote'
const START_PATH = '/api/qingmu/asset-reference-audit/start'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[0-9a-f]{64}$/
const QUOTE_SCHEMA = 'asset-reference-audit-preflight-v1'
const AUDIT_MODES = ['new_candidates', 'rule_reaudit'] as const

/**
 * Largest quoted batch.
 *
 * The Writer bounds `asset_ids` at 100 on both the preflight and the start
 * request, so a larger list can never be quoted and mirroring the bound here
 * lets the browser learn the limit before submitting.
 */
const MAX_ASSETS = 100

/**
 * Largest browser request body.
 *
 * Derived, not tuned: the Writer bounds `asset_ids` at 100 entries and each
 * asset id at 256 characters, so the list serializes to at most 26 KiB
 * including JSON punctuation. The start envelope adds a 128-character
 * preflight id, two 64-character hashes, and a confirmation text the Writer
 * bounds at 500 characters (1500 UTF-8 bytes for CJK), under 2 KiB. 64 KiB
 * covers both with room for JSON escaping while refusing an unbounded read.
 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Largest upstream response body.
 *
 * One quote carries at most {@link MAX_ASSETS} manifest entries of eighteen
 * short fields, five of which are 64-character digests, plus at most one
 * validation error per asset. That is under 70 KiB; 256 KiB refuses an
 * unbounded read without risking a legitimate quote.
 */
const MAX_RESPONSE_BYTES = 256 * 1024

/** The Writer's `confirmation_text` maximum, mirrored so the browser learns the limit. */
const MAX_CONFIRMATION_LENGTH = 500

/** Runtime dependencies for the asset reference audit bridge. */
export interface AssetReferenceAuditCommandDependencies {
  readonly baseUrl: string
  readonly fetch: typeof globalThis.fetch
}

/** The quoted scope both commands share. */
interface AuditScope {
  readonly projectId: string
  readonly episodeId: string
  readonly auditMode: typeof AUDIT_MODES[number]
  readonly assetIds: readonly string[]
}

/** The scope plus the four values the Writer binds a start to its quote. */
interface StartRequest extends AuditScope {
  readonly preflightId: string
  readonly sourceLockHash: string
  readonly callPlanHash: string
  readonly confirmationText: string
}

/** The single accepted query coordinate pair, or undefined for any other query. */
function episodeCoordinate(req: IncomingMessage): { projectId: string; episodeId: string } | undefined {
  const url = new URL(req.url ?? '', 'http://127.0.0.1')
  const keys = [...url.searchParams.keys()].sort()
  if (keys.length !== 2 || keys[0] !== 'episodeId' || keys[1] !== 'projectId') return undefined
  const projectId = url.searchParams.get('projectId') ?? ''
  const episodeId = url.searchParams.get('episodeId') ?? ''
  return IDENTIFIER.test(projectId) && IDENTIFIER.test(episodeId) ? { projectId, episodeId } : undefined
}

function auditMode(value: unknown): AuditScope['auditMode'] | undefined {
  return typeof value === 'string' && (AUDIT_MODES as readonly string[]).includes(value)
    ? value as AuditScope['auditMode']
    : undefined
}

/**
 * Validate the asset id list the Writer will quote.
 *
 * An empty list is legal and means "every newest candidate in each owner/role
 * slot", which is the Writer's own default, so it is passed through rather than
 * rejected. Duplicates are refused because the Writer de-duplicates by slot and
 * a repeated id would silently quote fewer images than the operator listed.
 *
 * @param value - Parsed `assetIds` field.
 * @returns The validated list, or undefined when it is out of contract.
 */
function assetIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ASSETS) return undefined
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !IDENTIFIER.test(item) || seen.has(item)) return undefined
    seen.add(item)
    ids.push(item)
  }
  return ids
}

/**
 * Validate the audit mode and asset list both commands share.
 *
 * @param value - Parsed browser request body.
 * @param coordinate - Validated project and episode from the query.
 * @returns The validated scope, or undefined when either field is out of contract.
 */
function scope(
  value: Record<string, unknown>,
  coordinate: { projectId: string; episodeId: string },
): AuditScope | undefined {
  const mode = auditMode(value.auditMode)
  const ids = assetIds(value.assetIds)
  return mode === undefined || ids === undefined
    ? undefined
    : { ...coordinate, auditMode: mode, assetIds: ids }
}

function parseQuoteRequest(
  value: Record<string, unknown>,
  coordinate: { projectId: string; episodeId: string },
): AuditScope | undefined {
  return Object.keys(value).length !== 2 ? undefined : scope(value, coordinate)
}

/**
 * Validate the operator's paid-dispatch decision.
 *
 * `confirmed` must be literally `true` and `confirmationText` must be non-empty;
 * the Writer separately requires that text to equal the string it generated for
 * this exact quote, so an operator cannot confirm a batch whose price they were
 * never shown.
 *
 * @param value - Parsed browser request body.
 * @param coordinate - Validated project and episode from the query.
 * @returns The validated start request, or undefined when any field is out of contract.
 */
function parseStartRequest(
  value: Record<string, unknown>,
  coordinate: { projectId: string; episodeId: string },
): StartRequest | undefined {
  if (Object.keys(value).length !== 7 || value.confirmed !== true) return undefined
  const parsed = scope(value, coordinate)
  if (parsed === undefined) return undefined
  const { preflightId, sourceLockHash, callPlanHash, confirmationText } = value
  if (typeof preflightId !== 'string' || !IDENTIFIER.test(preflightId)) return undefined
  if (typeof sourceLockHash !== 'string' || !SHA256.test(sourceLockHash)) return undefined
  if (typeof callPlanHash !== 'string' || !SHA256.test(callPlanHash)) return undefined
  if (typeof confirmationText !== 'string') return undefined
  const cleanText = confirmationText.trim()
  if (cleanText === '' || cleanText.length > MAX_CONFIRMATION_LENGTH) return undefined
  return {
    ...parsed,
    preflightId,
    sourceLockHash,
    callPlanHash,
    confirmationText: cleanText,
  }
}

function cny(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

const MANIFEST_KEYS = [
  'assetId', 'assetSha256', 'auditMode', 'capability', 'estimatedCny', 'idempotencyKey',
  'imageRegeneration', 'label', 'model', 'originalCheckId', 'ownerId', 'ownerType',
  'pricingVerified', 'provider', 'quoteAllowed', 'requestHash', 'role', 'routeKey', 'rubricSha256',
].join('\0')

/**
 * Validate one quoted image against the audit contract this bridge is allowed to relay.
 *
 * The capability, route key and `imageRegeneration` fields are pinned rather
 * than passed through: they are what makes this a vision audit of an existing
 * image instead of a paid regeneration, and a quote that claims otherwise is
 * refused even though the browser asked for an audit.
 *
 * @param value - One entry of the Writer's `manifest`.
 * @param auditMode - The mode the browser requested.
 * @returns The entry when it is a vision audit of an existing image, otherwise undefined.
 */
function manifestItem(value: unknown, auditMode: string): Record<string, unknown> | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join('\0') !== MANIFEST_KEYS) return undefined
  if (value.capability !== 'vision.audit' || value.routeKey !== 'b4_5.consistency') return undefined
  if (value.imageRegeneration !== false || value.auditMode !== auditMode) return undefined
  if (typeof value.assetId !== 'string' || !IDENTIFIER.test(value.assetId)) return undefined
  for (const field of ['assetSha256', 'rubricSha256', 'requestHash'] as const) {
    if (typeof value[field] !== 'string' || !SHA256.test(value[field])) return undefined
  }
  for (const field of ['ownerType', 'ownerId', 'role', 'model', 'provider', 'idempotencyKey'] as const) {
    if (typeof value[field] !== 'string' || value[field] === '') return undefined
  }
  if (typeof value.label !== 'string') return undefined
  if (value.originalCheckId !== null
    && (typeof value.originalCheckId !== 'string' || value.originalCheckId === '')) return undefined
  if (typeof value.pricingVerified !== 'boolean' || typeof value.quoteAllowed !== 'boolean') return undefined
  return cny(value.estimatedCny) === undefined ? undefined : value
}

/**
 * Validate the Writer's quote and its proof that quoting cost nothing.
 *
 * `providerCalls`, `budgetMutation`, `taskMutation` and `readOnly` are asserted
 * rather than displayed: a quote that mutates budget or creates tasks is not a
 * quote, and relaying one would let a free-looking panel action commit spend.
 *
 * @param value - Parsed upstream body.
 * @param request - The validated browser scope that produced it.
 * @returns The quote, or undefined when it does not describe this free audit quote.
 */
function quote(value: unknown, request: AuditScope): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.schema !== QUOTE_SCHEMA) return undefined
  if (value.projectId !== request.projectId || value.episodeId !== request.episodeId) return undefined
  if (value.targetStage !== 'asset_reference_audit' || value.auditMode !== request.auditMode) return undefined
  if (value.providerCalls !== 0 || value.budgetMutation !== false) return undefined
  if (value.taskMutation !== false || value.readOnly !== true) return undefined
  if (value.imageRegeneration !== false || typeof value.quoteReady !== 'boolean') return undefined
  if (typeof value.preflightId !== 'string' || !IDENTIFIER.test(value.preflightId)) return undefined
  if (!Array.isArray(value.manifest) || value.manifest.length > MAX_ASSETS) return undefined
  if (value.callCount !== value.manifest.length) return undefined
  const items = value.manifest.map(item => manifestItem(item, request.auditMode))
  if (items.some(item => item === undefined)) return undefined
  const estimated = cny(value.estimatedCny)
  const cap = cny(value.authorizationCapCny)
  if (estimated === undefined || cap === undefined || cap < estimated) return undefined
  for (const field of ['sourceLockHash', 'callPlanHash'] as const) {
    if (typeof value[field] !== 'string' || !SHA256.test(value[field])) return undefined
  }
  if (typeof value.expiresAt !== 'string' || Number.isNaN(Date.parse(value.expiresAt))) return undefined
  if (typeof value.confirmationText !== 'string'
    || value.confirmationText === ''
    || value.confirmationText.length > MAX_CONFIRMATION_LENGTH) return undefined
  if (typeof value.phaseLabel !== 'string') return undefined
  if (!Array.isArray(value.validationErrors)
    || value.validationErrors.some(item => typeof item !== 'string')) return undefined
  return value
}

/**
 * Validate the Writer's acceptance of a paid dispatch.
 *
 * The receipt proves a scoped batch was queued under the audit capability and
 * nothing else; the actual provider spend happens later in the batch worker, so
 * this deliberately claims no cost outcome.
 *
 * @param value - Parsed upstream body.
 * @returns The receipt, or undefined when it does not confirm a queued audit batch.
 */
function dispatch(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.accepted !== true || !isRecord(value.task)) return undefined
  const task = value.task
  if (typeof task.id !== 'string' || task.id === '') return undefined
  return task.capability === 'workflow.asset_reference_batch' ? value : undefined
}

/**
 * Relay one command to the Writer and classify the outcome.
 *
 * Anything whose outcome is not provably a rejection is reported as 502 rather
 * than 409: a 5xx, a transport failure, and any 2xx whose receipt cannot be
 * read. Both commands mutate Writer state before responding — the quote writes
 * a preflight row and the start consumes it and queues a paid batch — so in each
 * of those cases the action may already have landed and the caller must re-read
 * instead of resubmitting. Only a definitive sub-400 Writer rejection becomes
 * 409, carrying the Writer's reason code when it reports one.
 *
 * @param dependencies - Writer upstream and fetch implementation.
 * @param req - Browser request supplying the session cookie and origin.
 * @param res - Browser response.
 * @param path - Writer route suffix under the project and episode.
 * @param payload - Validated upstream request body.
 * @param confirm - Receipt validator for a 2xx response.
 * @param codes - Route-specific failure identifiers.
 */
async function relay(
  dependencies: AssetReferenceAuditCommandDependencies,
  req: IncomingMessage,
  res: ServerResponse,
  path: (coordinate: { projectId: string; episodeId: string }) => string,
  payload: string,
  confirm: (value: unknown) => Record<string, unknown> | undefined,
  codes: { readonly unknown: string; readonly invalid: string; readonly rejected: string },
): Promise<void> {
  const coordinate = episodeCoordinate(req)
  if (coordinate === undefined) {
    jsonResponse(res, 400, { code: 'asset_reference_audit_request_invalid' }); return
  }
  const upstream = new URL(path(coordinate), dependencies.baseUrl)
  const headers = browserWriteHeaders(req, upstream)
  if (headers === undefined) {
    jsonResponse(res, 403, { code: 'asset_reference_audit_command_forbidden' }); return
  }
  try {
    const response = await dependencies.fetch(upstream, {
      method: 'POST', redirect: 'error', headers, body: payload,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    const value = bytes.length <= MAX_RESPONSE_BYTES
      ? JSON.parse(bytes.toString('utf8')) as unknown : undefined
    if (response.ok) {
      const result = value === undefined ? undefined : confirm(value)
      if (result === undefined) {
        jsonResponse(res, 502, { code: value === undefined ? codes.unknown : codes.invalid }); return
      }
      jsonResponse(res, 200, result); return
    }
    if (response.status === 401 || response.status === 403) {
      jsonResponse(res, 401, { code: 'asset_reference_audit_relogin_required' }); return
    }
    if (response.status >= 500) {
      jsonResponse(res, 502, { code: codes.unknown }); return
    }
    const reason = writerCode(value)
    jsonResponse(res, 409, reason === undefined
      ? { code: codes.rejected }
      : { code: codes.rejected, reason })
  } catch {
    jsonResponse(res, 502, { code: codes.unknown })
  }
}

/**
 * Register the exact same-origin Host routes that quote and start a formal asset-image audit.
 *
 * Quoting is free and only writes an expiring preflight row; starting consumes
 * that row and queues a paid `vision.audit` batch, so it is reachable only
 * through a browser post that carries `confirmed: true` and echoes the Writer's
 * own confirmation text. No route here accepts a service token, and neither
 * forwards an `Authorization` header.
 *
 * @param webServer - Host web server that owns the browser-facing routes.
 * @param dependencies - Writer upstream and fetch implementation.
 * @returns A disposer that unregisters both routes.
 */
export function registerAssetReferenceAuditCommands(
  webServer: WebServer,
  dependencies: AssetReferenceAuditCommandDependencies,
): () => void {
  const auditPath = (suffix: string) => (coordinate: { projectId: string; episodeId: string }): string =>
    `/api/projects/${encodeURIComponent(coordinate.projectId)}`
    + `/episodes/${encodeURIComponent(coordinate.episodeId)}/asset-references/audit/${suffix}`
  const disposeQuote = webServer.register({
    kind: 'exact', path: QUOTE_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        jsonResponse(res, 403, { code: 'asset_reference_audit_command_forbidden' }); return
      }
      const coordinate = episodeCoordinate(req)
      let parsed: Record<string, unknown> | undefined
      try { parsed = await readJsonBody(req, MAX_BODY_BYTES) } catch { parsed = undefined }
      const request = coordinate === undefined || parsed === undefined
        ? undefined
        : parseQuoteRequest(parsed, coordinate)
      if (request === undefined) {
        jsonResponse(res, 400, { code: 'asset_reference_audit_request_invalid' }); return
      }
      await relay(
        dependencies, req, res, auditPath('preflight'),
        JSON.stringify({ asset_ids: request.assetIds, audit_mode: request.auditMode }),
        value => quote(value, request),
        {
          unknown: 'asset_reference_audit_quote_unknown',
          invalid: 'asset_reference_audit_quote_invalid',
          rejected: 'asset_reference_audit_quote_rejected',
        },
      )
    },
  })
  const disposeStart = webServer.register({
    kind: 'exact', path: START_PATH, handler: async (req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== undefined
        || !isTrustedApiRequest(req, [])) {
        jsonResponse(res, 403, { code: 'asset_reference_audit_command_forbidden' }); return
      }
      const coordinate = episodeCoordinate(req)
      let parsed: Record<string, unknown> | undefined
      try { parsed = await readJsonBody(req, MAX_BODY_BYTES) } catch { parsed = undefined }
      const request = coordinate === undefined || parsed === undefined
        ? undefined
        : parseStartRequest(parsed, coordinate)
      if (request === undefined) {
        jsonResponse(res, 400, { code: 'asset_reference_audit_request_invalid' }); return
      }
      await relay(
        dependencies, req, res, auditPath('start'),
        JSON.stringify({
          preflight_id: request.preflightId,
          source_lock_hash: request.sourceLockHash,
          call_plan_hash: request.callPlanHash,
          confirmation_text: request.confirmationText,
          asset_ids: request.assetIds,
          audit_mode: request.auditMode,
        }),
        dispatch,
        {
          unknown: 'asset_reference_audit_start_unknown',
          invalid: 'asset_reference_audit_dispatch_invalid',
          rejected: 'asset_reference_audit_start_rejected',
        },
      )
    },
  })
  return () => { disposeQuote(); disposeStart() }
}
