import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
const contentBase64 = bytes.toString('base64')
const contentSha256 = createHash('sha256').update(bytes).digest('hex')
const scope = { projectId: 'project_1', elementKind: 'actor' as const, targetId: 'actor_1' }
const upload = { ...scope, idempotencyKey: 'local-ref-1', originalFileName: 'face.png', contentBase64,
  sourceDeclaration: 'local_file_unverified' as const }
const identity = { contentSha256, elementKind: 'actor', originalFileName: 'face.png', sourceDeclaration: 'local_file_unverified', targetId: 'actor_1' }
const requestSha256 = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
const result = { ...scope, schema: 'jason.qingmu-local-reference-candidate-result.v1', assetId: 'asset_1',
  storageKey: 'qingmu/reference_candidates/abc/asset_1.png', profileRevision: 1,
  baseSnapshotSha256: 'a'.repeat(64), elementSnapshotSha256: 'b'.repeat(64), originalFileName: 'face.png',
  byteSize: bytes.length, mimeType: 'image/png', width: 12, height: 8, inputSha256: contentSha256,
  materializedSha256: contentSha256, sourceDeclaration: 'local_file_unverified', rightsStatus: 'not_recorded',
  selectionStatus: 'Unselected', isSelected: false, idempotencyKey: 'local-ref-1', requestSha256,
  commandReceiptId: 'receipt_1', changeSetId: 'changeset_1', eventId: 'event_1', providerCalls: 0,
  stageStarted: false, approvalGranted: false, selectionGranted: false, rightsRecorded: false }
const signal = () => new AbortController().signal
const setup = (value: unknown = result) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'token' }) }
}

describe('local reference candidate Host contract', () => {
  it('uploads once and recovers the same byte-bound intent with GET', async () => {
    const { fetch, handler } = setup()
    expect(await handler('uploadLocalReferenceCandidate', upload, signal())).toEqual({ ok: true, value: result })
    expect(fetch.mock.calls[0]?.[0]).toContain('/elements/actor/actor_1/local-reference-candidates')
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(await handler('recoverLocalReferenceCandidate', upload, signal())).toEqual({ ok: true, value: result })
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
    expect(fetch.mock.calls[1]?.[0]).toContain(`requestSha256=${requestSha256}`)
  })
  it('lists only exact scoped unselected candidates', async () => {
    const recorded = { ...result, rightsStatus: 'recorded_unverified', rightsRecorded: true }
    const listing = { ...scope, schema: 'jason.qingmu-local-reference-candidates.v1', candidates: [recorded],
      providerCalls: 0, stageStarted: false, approvalGranted: false, selectionGranted: false, rightsRecorded: false }
    const { handler } = setup(listing)
    expect(await handler('listLocalReferenceCandidates', scope, signal())).toEqual({ ok: true, value: listing })
    expect(await setup({ ...listing, candidates: [{ ...recorded, rightsStatus: 'not_recorded' }] })
      .handler('listLocalReferenceCandidates', scope, signal())).toMatchObject({ ok: false })
  })
  it('accepts the backend maximum of 100 candidates and rejects an oversized projection', async () => {
    const flags = { providerCalls: 0, stageStarted: false, approvalGranted: false, selectionGranted: false, rightsRecorded: false }
    const candidates = Array.from({ length: 100 }, (_unused, index) => ({
      ...result, assetId: `asset_${index}`, commandReceiptId: `receipt_${index}`,
      changeSetId: `changeset_${index}`, eventId: `event_${index}`,
    }))
    const listing = { ...scope, schema: 'jason.qingmu-local-reference-candidates.v1', candidates, ...flags }
    expect(await setup(listing).handler('listLocalReferenceCandidates', scope, signal())).toEqual({ ok: true, value: listing })
    expect(await setup({ ...listing, candidates: [...candidates, result] })
      .handler('listLocalReferenceCandidates', scope, signal())).toMatchObject({ ok: false })
  })
  it('rejects traversal, oversize, selected or approved state before it can be trusted', async () => {
    const badInput = setup()
    expect(await badInput.handler('uploadLocalReferenceCandidate', { ...upload, originalFileName: '../face.png' }, signal())).toMatchObject({ ok: false })
    expect(badInput.fetch).not.toHaveBeenCalled()
    for (const change of [{ isSelected: true }, { selectionStatus: 'Selected' }, { rightsRecorded: true },
      { approvalGranted: true }, { storageKey: '/private/secret.png' }, { materializedSha256: '0'.repeat(64) }]) {
      expect(await setup({ ...result, ...change }).handler('uploadLocalReferenceCandidate', upload, signal())).toMatchObject({ ok: false })
    }
  })
  it('fails closed when returned content bytes do not match the requested SHA', async () => {
    const contentRequest = { ...scope, assetId: 'asset_1', expectedSha256: contentSha256 }
    const good = { schema: 'jason.qingmu-local-reference-candidate-content.v1', assetId: 'asset_1', sha256: contentSha256,
      mimeType: 'image/png', contentBase64 }
    expect(await setup(good).handler('readLocalReferenceCandidateContent', contentRequest, signal())).toEqual({ ok: true, value: good })
    expect(await setup({ ...good, contentBase64: Buffer.from('tamper').toString('base64') })
      .handler('readLocalReferenceCandidateContent', contentRequest, signal())).toMatchObject({ ok: false })
  })
})
