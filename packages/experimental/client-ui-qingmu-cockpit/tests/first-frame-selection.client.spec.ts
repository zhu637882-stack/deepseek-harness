// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { assertFirstFrameState, createFirstFrameSelectionClient, FirstFrameSelectionUnknownError } from '../src/client/first-frame-selection.ts'

const sha = 'a'.repeat(64)
const coordinates = { projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'storyboard-1', frameId: 'frame-1' }
const intent = { ...coordinates, assetId: 'asset-1', expectedMaterializedSha256: sha, idempotencyKey: 'first-frame-select-1' }
const receipt = { schema: 'jason.qingmu-first-frame-selection-receipt.v1', selectionIdentity: 'selection-1', actorUserId: 'actor-1', naturalPersonId: 'person-1', ...coordinates, selectedAssetId: 'asset-1', selectedAssetSha256: sha, selectedMaterializedSha256: sha, selectionStatus: 'Selected', idempotencyKey: intent.idempotencyKey, requestSha256: 'b'.repeat(64), intentSessionSha256: 'c'.repeat(64), intentBindingSha256: 'd'.repeat(64), binding: {}, bindingSha256: 'e'.repeat(64), selectedAt: '2026-09-02T00:00:00Z', receiptSha256: 'f'.repeat(64) }
const state = (selected = false) => ({ schema: 'jason.qingmu-first-frame-selection-state.v1', ...coordinates, frameUpdatedAt: '2026-09-02T00:00:00Z', storyboardRevision: 1, identity: { state: 'bound' }, candidates: [{ assetId: 'asset-1', assetSha256: sha, materializedSha256: sha, qualityStatus: 'passed', selectionStatus: selected ? 'Selected' : 'Unselected', isSelected: selected, assetUpdatedAt: '2026-09-02T00:00:00Z' }], selectedAssetId: selected ? 'asset-1' : null, selectionReceipt: selected ? receipt : null, blockers: [], providerCalls: 0, taskMutation: false, outboxEvents: 0 })
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }) }
function requestUrl(input: RequestInfo | URL | undefined): URL {
  if (input === undefined) throw new Error('missing fetch input')
  if (typeof input === 'string') return new URL(input, 'http://127.0.0.1')
  return input instanceof URL ? input : new URL(input.url, 'http://127.0.0.1')
}
describe('first-frame browser selection bridge', () => {
  it('reads only matching four-coordinate candidate state', () => {
    expect(assertFirstFrameState(state(false), coordinates).candidates).toHaveLength(1)
    expect(() => assertFirstFrameState({ ...state(false), storyboardRevisionId: 'other' }, coordinates)).toThrow(/contract mismatch/)
  })
  it('serializes only the four authoritative coordinates from an extended active-shot object', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(state(false)))
    const activeShot = { ...coordinates, shotId: 'must-not-leak' }
    await createFirstFrameSelectionClient(fetcher).state(activeShot)
    const url = requestUrl(fetcher.mock.calls[0]?.[0])
    expect(Object.fromEntries(url.searchParams)).toEqual(coordinates)
  })
  it('sends one explicit same-origin selection and validates the strict receipt', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(receipt))
    const activeIntent = { ...intent, shotId: 'must-not-leak' }
    await expect(createFirstFrameSelectionClient(fetcher).select(activeIntent)).resolves.toMatchObject({ selectedAssetId: 'asset-1' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(requestUrl(fetcher.mock.calls[0]?.[0]).searchParams.has('shotId')).toBe(false)
    const init = fetcher.mock.calls[0]?.[1]
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error' })
  })
  it('recovers only with a server request hash and rejects browser-outage guessing', async () => {
    const fetcher = vi.fn(async () => response(receipt)) as unknown as typeof fetch
    const client = createFirstFrameSelectionClient(fetcher)
    await expect(client.receipt({ ...intent, requestSha256: 'b'.repeat(64) })).resolves.toMatchObject({ selectedAssetId: 'asset-1' })
    await expect(client.receipt({ ...intent, requestSha256: 'x' })).rejects.toThrow(/reload state only/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves the Host recovery values and only reads the original receipt after a lost response', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ recovery: { idempotencyKey: intent.idempotencyKey, requestSha256: 'b'.repeat(64) } }), { status: 409 })
      return response(receipt)
    }) as unknown as typeof fetch
    const client = createFirstFrameSelectionClient(fetcher)
    await expect(client.select(intent)).rejects.toBeInstanceOf(FirstFrameSelectionUnknownError)
    await expect(client.receipt({ ...intent, requestSha256: 'b'.repeat(64) })).resolves.toMatchObject({ receiptSha256: 'f'.repeat(64) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1]).not.toMatchObject({ method: 'POST' })
  })
  it('rejects a tampered selected receipt', () => {
    expect(() => assertFirstFrameState({ ...state(true), selectionReceipt: { ...receipt, selectedAssetId: 'asset-2' } }, coordinates)).toThrow()
  })
})
