import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const raw = Buffer.alloc(32)
raw.writeUInt32BE(32); raw.write('ftyp', 4)
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const scope = { projectId: 'project_1', episodeId: 'episode_1', frameId: 'frame_1' }
function fixture(bytes = raw) {
  const request = { ...scope, idempotencyKey: 'video-upload-1', originalFileName: 'original.mp4',
    contentBase64: bytes.toString('base64'), sourceDeclaration: 'local_file_unverified' as const }
  const contentSha256 = hash(bytes)
  const identity = { contentSha256, episodeId: scope.episodeId, frameId: scope.frameId,
    originalFileName: request.originalFileName, sourceDeclaration: request.sourceDeclaration }
  const assetId = `asset_localvideo_${'a'.repeat(32)}`
  const receipt = { schema: 'jason.qingmu-local-video-candidate.v1', ...scope, assetId, takeId: assetId,
    idempotencyKey: request.idempotencyKey, requestSha256: hash(JSON.stringify(identity)),
    originalFileName: request.originalFileName, byteSize: bytes.length, mimeType: 'video/mp4',
    inputSha256: contentSha256, materializedSha256: contentSha256, durationSec: 8,
    width: 1280, height: 720, hasAudio: true, sourceDeclaration: 'local_file_unverified',
    rightsStatus: 'not_recorded', selectionStatus: 'Unselected', isSelected: false, providerCalls: 0, generationQueued: false }
  const recovery = { ...scope, idempotencyKey: request.idempotencyKey, requestSha256: receipt.requestSha256 }
  return { request, receipt, recovery }
}
function setup(value: unknown = fixture().receipt, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(value, { status })))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'token' }) }
}
const signal = () => new AbortController().signal

it('uploads once and recovers without transmitting the file again', async () => {
  const { request, receipt, recovery } = fixture()
  const { handler, fetch } = setup()
  expect(await handler('uploadLocalVideoCandidate', request, signal())).toEqual({ ok: true, value: receipt })
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
  expect(await handler('recoverLocalVideoCandidate', recovery, signal())).toEqual({ ok: true, value: receipt })
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
  expect(fetch.mock.calls[1]?.[1]?.body).toBeUndefined()
  expect(fetch.mock.calls[1]?.[0]).toEqual(expect.stringContaining(`requestSha256=${receipt.requestSha256}`))
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([{ projectId:'other' }, { episodeId:'other' }, { frameId:'other' }, { takeId:'other' },
  { inputSha256:'b'.repeat(64) }, { materializedSha256:'b'.repeat(64) }, { originalFileName:'other.mp4' },
  { providerCalls:1 }, { isSelected:true }, { generationQueued:true }, { durationSec:31 },
  { width:5000 }, { width:1.5 }, { byteSize:0 }, { hasAudio:null }, { privatePath:'/file' }])(
  'rejects changed upload and recovery receipts %j', async (change) => {
    const { request, receipt, recovery } = fixture()
    const { handler } = setup({ ...receipt, ...change })
    expect((await handler('uploadLocalVideoCandidate', request, signal())).ok).toBe(false)
    expect((await handler('recoverLocalVideoCandidate', recovery, signal())).ok).toBe(false)
  })

it('permits a video above the old image limit without weakening recovery payload bounds', async () => {
  const bytes = Buffer.alloc(9*1024*1024); bytes.write('ftyp',4)
  const { request, receipt, recovery } = fixture(bytes)
  const { handler, fetch } = setup(receipt)
  expect((await handler('uploadLocalVideoCandidate', request, signal())).ok).toBe(true)
  expect((await handler('recoverLocalVideoCandidate', { ...recovery, contentBase64: request.contentBase64 }, signal())).ok).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('rejects invalid input before transport and never retries an unknown result', async () => {
  const { request, recovery } = fixture()
  const { handler, fetch } = setup()
  for (const change of [{ originalFileName:'../file.mp4' }, { contentBase64:request.contentBase64+'\n' },
    { sourceDeclaration:'approved' }, { frameId:'frame/other' }, { frameId:'.' }, { frameId:'..' },
    { episodeId:'..' }, { projectId:'.' }, { providerTaskId:'fake' }]) {
    expect((await handler('uploadLocalVideoCandidate', { ...request, ...change }, signal())).ok).toBe(false)
  }
  expect(fetch).not.toHaveBeenCalled()
  const unavailable = setup({ detail:{ code:'local_video_receipt_missing' } }, 404)
  expect((await unavailable.handler('recoverLocalVideoCandidate', recovery, signal())).ok).toBe(false)
  expect(unavailable.fetch).toHaveBeenCalledTimes(1)
})

it('preserves ordinary identifiers containing dots without URL path traversal', async () => {
  const { request } = fixture()
  const { handler, fetch } = setup({}, 404)
  await handler('uploadLocalVideoCandidate', { ...request, projectId:'p.v1', episodeId:'e..2', frameId:'f.3' }, signal())
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/qingmu/projects/p.v1/episodes/e..2/frames/f.3/local-video-candidates')
})
