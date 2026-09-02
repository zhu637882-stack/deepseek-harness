/** Browser-only, same-origin first-frame selection bridge.  It never creates a default selection. */
import type { FirstFrameCandidatePreviewRequest, FirstFrameCandidatePreviewResponse } from './FirstFrameCandidatePreview.tsx'

const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const STATE = '/api/qingmu/first-frame-selection/state'
const DECISION = '/api/qingmu/first-frame-selection/decision'
const RECEIPT = '/api/qingmu/first-frame-selection/receipt'
const MEDIA = '/api/qingmu/first-frame-selection/media'

export interface FirstFrameSelectionCoordinates {
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
}
export interface FirstFrameCandidate {
  readonly assetId: string
  readonly assetSha256: string
  readonly materializedSha256: string
  readonly qualityStatus: 'passed'
  readonly selectionStatus: 'Unselected' | 'Selected'
  readonly isSelected: boolean
  readonly assetUpdatedAt: string
}
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
  readonly providerCalls: 0
  readonly taskMutation: false
  readonly outboxEvents: 0
}
export interface FirstFrameSelectionState extends FirstFrameSelectionCoordinates {
  readonly schema: 'jason.qingmu-first-frame-selection-state.v1'
  readonly candidates: readonly FirstFrameCandidate[]
  readonly selectedAssetId: string | null
  readonly selectionReceipt: FirstFrameSelectionReceipt | null
  readonly blockers: readonly string[]
}
export interface FirstFrameSelectionIntent extends FirstFrameSelectionCoordinates {
  readonly assetId: string
  readonly expectedMaterializedSha256: string
  readonly idempotencyKey: string
}
export class FirstFrameSelectionUnknownError extends Error {
  constructor(readonly recovery: Readonly<{ idempotencyKey: string; requestSha256: string }>) {
    super('first-frame selection result is unknown; recover the original receipt only')
  }
}

function validCoordinates(value: FirstFrameSelectionCoordinates): boolean {
  return IDENTIFIER.test(value.projectId) && IDENTIFIER.test(value.episodeId)
    && IDENTIFIER.test(value.storyboardRevisionId) && IDENTIFIER.test(value.frameId)
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
export function assertFirstFrameReceipt(value: unknown, expected: FirstFrameSelectionIntent): FirstFrameSelectionReceipt {
  const item = exact(value, ['schema', 'selectionIdentity', 'actorUserId', 'naturalPersonId', 'projectId', 'episodeId', 'storyboardRevisionId', 'frameId', 'selectedAssetId', 'selectedAssetSha256', 'selectedMaterializedSha256', 'selectionStatus', 'idempotencyKey', 'requestSha256', 'intentSessionSha256', 'intentBindingSha256', 'binding', 'bindingSha256', 'selectedAt', 'receiptSha256', 'providerCalls', 'taskMutation', 'outboxEvents'], 'first-frame receipt')
  if (item.schema !== 'jason.qingmu-first-frame-selection-receipt.v1' || item.projectId !== expected.projectId || item.episodeId !== expected.episodeId || item.storyboardRevisionId !== expected.storyboardRevisionId || item.frameId !== expected.frameId || item.selectedAssetId !== expected.assetId || item.selectedAssetSha256 !== expected.expectedMaterializedSha256 || item.selectedMaterializedSha256 !== expected.expectedMaterializedSha256 || item.selectionStatus !== 'Selected' || item.idempotencyKey !== expected.idempotencyKey || !SHA256.test(String(item.requestSha256)) || !SHA256.test(String(item.receiptSha256)) || item.providerCalls !== 0 || item.taskMutation !== false || item.outboxEvents !== 0) throw new Error('first-frame receipt contract mismatch')
  return item as unknown as FirstFrameSelectionReceipt
}
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
export function createFirstFrameSelectionClient(fetcher: typeof fetch = globalThis.fetch) {
  const state = async (coordinates: FirstFrameSelectionCoordinates, signal?: AbortSignal) => {
    if (!validCoordinates(coordinates)) throw new Error('first-frame coordinates invalid')
    return assertFirstFrameState(await json(fetcher, query(STATE, coordinates), withSignal(signal)), coordinates)
  }
  const preview = async (request: FirstFrameCandidatePreviewRequest, signal?: AbortSignal): Promise<FirstFrameCandidatePreviewResponse> => {
    if (!validCoordinates(request) || !IDENTIFIER.test(request.assetId) || !SHA256.test(request.expectedMaterializedSha256)) throw new Error('first-frame preview invalid')
    const result = await json(fetcher, query(MEDIA, request), withSignal(signal)) as FirstFrameCandidatePreviewResponse
    if (result.projectId !== request.projectId || result.episodeId !== request.episodeId || result.storyboardRevisionId !== request.storyboardRevisionId || result.frameId !== request.frameId || result.assetId !== request.assetId || result.materializedSha256 !== request.expectedMaterializedSha256) throw new Error('first-frame preview scope mismatch')
    return result
  }
  const select = async (intent: FirstFrameSelectionIntent, signal?: AbortSignal) => {
    if (!validCoordinates(intent) || !IDENTIFIER.test(intent.assetId) || !SHA256.test(intent.expectedMaterializedSha256) || !IDENTIFIER.test(intent.idempotencyKey)) throw new Error('first-frame selection invalid')
    const result = await json(fetcher, query(DECISION, intent), { method: 'POST', ...withSignal(signal), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: intent.assetId, expectedAssetId: intent.assetId, expectedMaterializedSha256: intent.expectedMaterializedSha256, expectedStoryboardRevisionId: intent.storyboardRevisionId, confirmed: true, idempotencyKey: intent.idempotencyKey }) })
    return assertFirstFrameReceipt(result, intent)
  }
  const receipt = async (intent: FirstFrameSelectionIntent & { readonly requestSha256: string }, signal?: AbortSignal) => {
    if (!SHA256.test(intent.requestSha256)) throw new Error('first-frame request hash unavailable; reload state only')
    return assertFirstFrameReceipt(await json(fetcher, query(RECEIPT, intent), withSignal(signal)), intent)
  }
  return { state, preview, select, receipt }
}
