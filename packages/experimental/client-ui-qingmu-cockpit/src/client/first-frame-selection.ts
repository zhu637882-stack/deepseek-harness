/** Browser-only, same-origin first-frame selection bridge.  It never creates a default selection. */
import type { FirstFrameCandidatePreviewRequest, FirstFrameCandidatePreviewResponse } from './FirstFrameCandidatePreview.tsx'

const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const STATE = '/api/qingmu/first-frame-selection/state'
const DECISION = '/api/qingmu/first-frame-selection/decision'
const RECEIPT = '/api/qingmu/first-frame-selection/receipt'
const MEDIA = '/api/qingmu/first-frame-selection/media'

/** Immutable project, episode, storyboard revision, and frame coordinates for first-frame reads. */
export interface FirstFrameSelectionCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}
/** One byte-addressed image candidate that remains unselected until an explicit human decision. */
export interface FirstFrameCandidate {
  readonly assetId: string
  readonly assetSha256: string
  readonly materializedSha256: string
  readonly qualityStatus: 'passed'
  readonly selectionStatus: 'Unselected' | 'Selected'
  readonly isSelected: boolean
  readonly assetUpdatedAt: string
}
/** Durable signed facts returned after an authenticated human selects one first-frame candidate. */
export interface FirstFrameSelectionReceipt {
  readonly schema: 'jason.qingmu-first-frame-selection-receipt.v1'
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly selectedAssetId: string
  readonly selectedAssetSha256: string
  readonly selectedMaterializedSha256: string
  readonly selectionStatus: 'Selected'
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly receiptSha256: string
}
/** Current Writer-owned candidate set and optional human selection receipt. */
export interface FirstFrameSelectionState extends FirstFrameSelectionCoordinates {
  readonly schema: 'jason.qingmu-first-frame-selection-state.v1'
  readonly candidates: readonly FirstFrameCandidate[]
  readonly selectedAssetId: string | null
  readonly selectionReceipt: FirstFrameSelectionReceipt | null
  readonly blockers: readonly string[]
}
/** Exact candidate, materialized bytes, and idempotency key submitted for human selection. */
export interface FirstFrameSelectionIntent extends FirstFrameSelectionCoordinates {
  readonly assetId: string
  readonly expectedMaterializedSha256: string
  readonly idempotencyKey: string
}
/** Signals a lost or indeterminate selection response that may only be recovered, never replayed. */
export class FirstFrameSelectionUnknownError extends Error {
  constructor(readonly recovery: Readonly<{ idempotencyKey: string; requestSha256: string }>) {
    super('first-frame selection result is unknown; recover the original receipt only')
  }
}

function validCoordinates(value: FirstFrameSelectionCoordinates): boolean {
  return IDENTIFIER.test(value.projectId) && IDENTIFIER.test(value.episodeId)
    && IDENTIFIER.test(value.storyboardRevisionId) && IDENTIFIER.test(value.frameId)
}
function scopeOf(value: FirstFrameSelectionCoordinates): FirstFrameSelectionCoordinates {
  return {
    projectId: value.projectId,
    episodeId: value.episodeId,
    storyboardRevisionId: value.storyboardRevisionId,
    frameId: value.frameId,
  }
}
function intentOf(value: FirstFrameSelectionIntent): FirstFrameSelectionIntent {
  return {
    ...scopeOf(value),
    assetId: value.assetId,
    expectedMaterializedSha256: value.expectedMaterializedSha256,
    idempotencyKey: value.idempotencyKey,
  }
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) throw new Error(`${label} fields mismatch`)
  return value as Record<string, unknown>
}
function candidate(value: unknown): FirstFrameCandidate {
  const item = exact(value, ['assetId', 'assetSha256', 'materializedSha256', 'qualityStatus', 'selectionStatus', 'isSelected', 'assetUpdatedAt'], 'first-frame candidate')
  if (!IDENTIFIER.test(String(item.assetId)) || !SHA256.test(String(item.assetSha256)) || !SHA256.test(String(item.materializedSha256))
    || item.qualityStatus !== 'passed' || !['Unselected', 'Selected'].includes(String(item.selectionStatus)) || typeof item.isSelected !== 'boolean' || typeof item.assetUpdatedAt !== 'string') throw new Error('first-frame candidate contract mismatch')
  return item as unknown as FirstFrameCandidate
}
/**
 * Validate an untrusted first-frame receipt against the exact browser intent.
 * @param value Untrusted response payload.
 * @param expected Exact browser intent used for the request.
 * @returns The validated signed receipt.
 */
export function assertFirstFrameReceipt(value: unknown, expected: FirstFrameSelectionIntent): FirstFrameSelectionReceipt {
  const item = exact(value, ['schema', 'selectionIdentity', 'actorUserId', 'naturalPersonId', 'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'selectedAssetId', 'selectedAssetSha256', 'selectedMaterializedSha256', 'selectionStatus', 'idempotencyKey', 'requestSha256', 'intentSessionSha256', 'intentBindingSha256', 'binding', 'bindingSha256', 'selectedAt', 'receiptSha256'], 'first-frame receipt')
  if (item.schema !== 'jason.qingmu-first-frame-selection-receipt.v1' || item.projectId !== expected.projectId || item.episodeId !== expected.episodeId || item.storyboardRevisionId !== expected.storyboardRevisionId || item.frameId !== expected.frameId || item.selectedAssetId !== expected.assetId || item.selectedAssetSha256 !== expected.expectedMaterializedSha256 || item.selectedMaterializedSha256 !== expected.expectedMaterializedSha256 || item.selectionStatus !== 'Selected' || item.idempotencyKey !== expected.idempotencyKey || !SHA256.test(String(item.requestSha256)) || !SHA256.test(String(item.receiptSha256))) throw new Error('first-frame receipt contract mismatch')
  return item as unknown as FirstFrameSelectionReceipt
}
/**
 * Validate an untrusted first-frame state projection against immutable coordinates.
 * @param value Untrusted state payload.
 * @param expected Immutable project, episode, revision, and frame coordinates.
 * @returns The validated Writer-owned state.
 */
export function assertFirstFrameState(value: unknown, expected: FirstFrameSelectionCoordinates): FirstFrameSelectionState {
  const item = exact(value, ['schema', 'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'frameUpdatedAt', 'storyboardRevision', 'identity', 'candidates', 'selectedAssetId', 'selectionReceipt', 'blockers', 'providerCalls', 'taskMutation', 'outboxEvents'], 'first-frame state')
  if (item.schema !== 'jason.qingmu-first-frame-selection-state.v1' || item.projectId !== expected.projectId || item.episodeId !== expected.episodeId || item.storyboardRevisionId !== expected.storyboardRevisionId || item.frameId !== expected.frameId || !Array.isArray(item.candidates) || !Array.isArray(item.blockers) || item.providerCalls !== 0 || item.taskMutation !== false || item.outboxEvents !== 0) throw new Error('first-frame state contract mismatch')
  const candidates = item.candidates.map(candidate)
  if (item.selectedAssetId === null) { if (item.selectionReceipt !== null) throw new Error('first-frame receipt without selected asset') }
  else {
    if (typeof item.selectedAssetId !== 'string' || !IDENTIFIER.test(item.selectedAssetId)) throw new Error('first-frame selected asset invalid')
    const selected = candidates.find(current => current.assetId === item.selectedAssetId && current.isSelected && current.selectionStatus === 'Selected')
    if (selected === undefined || item.selectionReceipt === null) throw new Error('first-frame selected candidate invalid')
    const idempotencyKey = (item.selectionReceipt as Record<string, unknown>).idempotencyKey
    if (typeof idempotencyKey !== 'string') throw new Error('first-frame receipt idempotency invalid')
    assertFirstFrameReceipt(item.selectionReceipt, {
      ...expected, assetId: selected.assetId, expectedMaterializedSha256: selected.materializedSha256, idempotencyKey,
    })
  }
  return { ...(item as unknown as FirstFrameSelectionState), candidates }
}
function query(path: string, value: object): string { const params = new URLSearchParams(Object.entries(value as Record<string, string>)); return `${path}?${params.toString()}` }
function withSignal(signal: AbortSignal | undefined): Pick<RequestInit, 'signal'> { return signal === undefined ? {} : { signal } }
async function json(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')
  const response = await fetcher(input, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...init,
    headers,
  })
  const result: unknown = await (response.json() as Promise<unknown>).catch(() => undefined)
  if (!response.ok) {
    const root = result as { readonly recovery?: unknown } | undefined
    const recovery = root?.recovery as { readonly idempotencyKey?: unknown; readonly requestSha256?: unknown } | undefined
    if (typeof recovery?.idempotencyKey === 'string' && IDENTIFIER.test(recovery.idempotencyKey)
      && typeof recovery.requestSha256 === 'string' && SHA256.test(recovery.requestSha256)) {
      throw new FirstFrameSelectionUnknownError({ idempotencyKey: recovery.idempotencyKey, requestSha256: recovery.requestSha256 })
    }
    throw new Error(`first-frame request failed (${response.status})`)
  }
  return result
}

interface FirstFrameSelectionClient {
  readonly state: (
    coordinates: FirstFrameSelectionCoordinates,
    signal?: AbortSignal,
  ) => Promise<FirstFrameSelectionState>
  readonly preview: (
    request: FirstFrameCandidatePreviewRequest,
    signal?: AbortSignal,
  ) => Promise<FirstFrameCandidatePreviewResponse>
  readonly select: (
    intent: FirstFrameSelectionIntent,
    signal?: AbortSignal,
  ) => Promise<FirstFrameSelectionReceipt>
  readonly receipt: (
    intent: FirstFrameSelectionIntent & { readonly requestSha256: string },
    signal?: AbortSignal,
  ) => Promise<FirstFrameSelectionReceipt>
}

/**
 * Create the same-origin browser client for preview, state, explicit selection, and receipt recovery.
 * @param fetcher Same-origin Fetch implementation.
 * @returns A bounded first-frame selection client.
 */
export function createFirstFrameSelectionClient(fetcher: typeof fetch = globalThis.fetch): FirstFrameSelectionClient {
  const state = async (coordinates: FirstFrameSelectionCoordinates, signal?: AbortSignal) => {
    if (!validCoordinates(coordinates)) throw new Error('first-frame coordinates invalid')
    const scope = scopeOf(coordinates)
    return assertFirstFrameState(await json(fetcher, query(STATE, scope), withSignal(signal)), scope)
  }
  const preview = async (request: FirstFrameCandidatePreviewRequest, signal?: AbortSignal): Promise<FirstFrameCandidatePreviewResponse> => {
    if (!validCoordinates(request) || !IDENTIFIER.test(request.assetId) || !SHA256.test(request.expectedMaterializedSha256)) throw new Error('first-frame preview invalid')
    const exactRequest = {
      ...scopeOf(request),
      assetId: request.assetId,
      expectedMaterializedSha256: request.expectedMaterializedSha256,
    }
    const result = await json(fetcher, query(MEDIA, exactRequest), withSignal(signal)) as FirstFrameCandidatePreviewResponse
    if (result.projectId !== exactRequest.projectId || result.episodeId !== exactRequest.episodeId || result.storyboardRevisionId !== exactRequest.storyboardRevisionId || result.frameId !== exactRequest.frameId || result.assetId !== exactRequest.assetId || result.materializedSha256 !== exactRequest.expectedMaterializedSha256) throw new Error('first-frame preview scope mismatch')
    return result
  }
  const select = async (intent: FirstFrameSelectionIntent, signal?: AbortSignal) => {
    if (!validCoordinates(intent) || !IDENTIFIER.test(intent.assetId) || !SHA256.test(intent.expectedMaterializedSha256) || !IDENTIFIER.test(intent.idempotencyKey)) throw new Error('first-frame selection invalid')
    const exactIntent = intentOf(intent)
    const result = await json(fetcher, query(DECISION, exactIntent), { method: 'POST', ...withSignal(signal), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: exactIntent.assetId, expectedAssetId: exactIntent.assetId, expectedMaterializedSha256: exactIntent.expectedMaterializedSha256, expectedStoryboardRevisionId: exactIntent.storyboardRevisionId, confirmed: true, idempotencyKey: exactIntent.idempotencyKey }) })
    return assertFirstFrameReceipt(result, exactIntent)
  }
  const receipt = async (intent: FirstFrameSelectionIntent & { readonly requestSha256: string }, signal?: AbortSignal) => {
    if (!SHA256.test(intent.requestSha256)) throw new Error('first-frame request hash unavailable; reload state only')
    const exactIntent = { ...intentOf(intent), requestSha256: intent.requestSha256 }
    return assertFirstFrameReceipt(await json(fetcher, query(RECEIPT, exactIntent), withSignal(signal)), exactIntent)
  }
  return { state, preview, select, receipt }
}
