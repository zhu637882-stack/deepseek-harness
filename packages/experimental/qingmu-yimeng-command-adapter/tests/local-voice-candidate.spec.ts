import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const raw = Buffer.alloc(48044)
raw.write('RIFF'); raw.writeUInt32LE(raw.length - 8, 4); raw.write('WAVEfmt ', 8)
raw.writeUInt32LE(16, 16); raw.writeUInt16LE(1, 20); raw.writeUInt16LE(1, 22)
raw.writeUInt32LE(24000, 24); raw.writeUInt32LE(48000, 28); raw.writeUInt16LE(2, 32)
raw.writeUInt16LE(16, 34); raw.write('data', 36); raw.writeUInt32LE(48000, 40)
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const contentSha256 = digest(raw)
const scope = { projectId: 'project_1', elementKind: 'actor' as const, targetId: 'actor_1' }
const request = { ...scope, idempotencyKey: 'voice-upload-1', originalFileName: 'voice.wav',
  contentBase64: raw.toString('base64'), sourceDeclaration: 'local_file_unverified' as const }
const identity = { contentSha256, elementKind: 'actor', originalFileName: 'voice.wav', sourceDeclaration: 'local_file_unverified', targetId: 'actor_1' }
const result = { schema: 'jason.qingmu-local-voice-candidate.v1', ...scope, assetId: `asset_localvoice_${'a'.repeat(32)}`,
  idempotencyKey: request.idempotencyKey, requestSha256: digest(JSON.stringify(identity)),
  originalFileName: 'voice.wav', byteSize: raw.length, mimeType: 'audio/wav', inputSha256: contentSha256,
  materializedSha256: contentSha256, durationSec: 1, sampleRate: 24000, channels: 1,
  sourceDeclaration: 'local_file_unverified', rightsStatus: 'not_recorded', selectionStatus: 'Unselected',
  isSelected: false, providerCalls: 0, generationQueued: false }
function setup(value: unknown = result, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'token' }) }
}
const signal = () => new AbortController().signal

it('uploads exact bytes once and recovers through GET with the same intent digest', async () => {
  const { handler, fetch } = setup()
  expect(await handler('uploadLocalVoiceCandidate', request, signal())).toEqual({ ok: true, value: result })
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST')
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({ contentBase64: request.contentBase64 })
  expect(await handler('recoverLocalVoiceCandidate', request, signal())).toEqual({ ok: true, value: result })
  expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
  expect(fetch.mock.calls[1]?.[0]).toContain(`requestSha256=${result.requestSha256}`)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([{ projectId: 'foreign' }, { targetId: 'other' }, { providerCalls: 1 }, { isSelected: true },
  { materializedSha256: 'b'.repeat(64) }, { durationSec: 0 }, { privatePath: '/private/file.wav' }])('rejects a changed upload receipt %j', async (change) => {
  const { handler } = setup({ ...result, ...change })
  expect((await handler('uploadLocalVoiceCandidate', request, signal())).ok).toBe(false)
})

it('rejects invalid inputs before transport and does not retry errors', async () => {
  const { handler, fetch } = setup()
  for (const change of [{ elementKind: 'scene' }, { originalFileName: '../voice.wav' }, { contentBase64: `${request.contentBase64}\n` }, { sourceDeclaration: 'approved' }]) {
    expect((await handler('uploadLocalVoiceCandidate', { ...request, ...change }, signal())).ok).toBe(false)
  }
  expect(fetch).not.toHaveBeenCalled()
  const failed = setup({ detail: { code: 'missing' } }, 404)
  expect((await failed.handler('recoverLocalVoiceCandidate', request, signal())).ok).toBe(false)
  expect(failed.fetch).toHaveBeenCalledTimes(1)
})

it.each([result.assetId, 'asset_copy_012345abcdef'])('verifies private WAV bytes and SHA for %s before returning audio', async (assetId) => {
  const content = { schema: 'jason.qingmu-local-voice-content.v1', assetId,
    sha256: contentSha256, mimeType: 'audio/wav', contentBase64: request.contentBase64 }
  const input = { ...scope, assetId, expectedSha256: contentSha256 }
  const { handler } = setup(content)
  expect(await handler('readLocalVoiceCandidateContent', input, signal())).toEqual({ ok: true, value: content })
  const changed = Buffer.from(raw); changed[changed.length - 1] = 1
  expect((await setup({ ...content, contentBase64: changed.toString('base64') }).handler('readLocalVoiceCandidateContent', input, signal())).ok).toBe(false)
})
