import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const signal = () => new AbortController().signal
const settings = { aspectRatio: '9:16', creationType: 'story_idea', duration: '1-2分钟', episodeCount: 1,
  mode: 'whole_series', name: '隔离样本', style: 'realistic', stylePackId: null, textInput: '雨夜里，林夏收到一封旧信。' }
const request = { ...settings, idempotencyKey: 'intent-create-1' }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
}
const method = { id: 'method.visual.realistic', version: '1.0.0', sha256: 'a'.repeat(64) }
const creativeContract = { schema: 'qingmu.creative-contract.v1', revision: 1, locked: true,
  source: { textSha256: digest(settings.textInput) }, project: { mode: settings.mode,
    creationType: settings.creationType, aspectRatio: settings.aspectRatio, episodeCount: settings.episodeCount,
    duration: settings.duration }, methods: { visualStyle: method, stylePackId: null,
    writingSkills: [], directorSkills: [], cameraSkills: [], soundSkills: [] } }
const creativeContractSha256 = digest(canonicalJson(creativeContract))
const result = { schema: 'jason.qingmu-project-bootstrap-result.v1', projectId: 'project_1', seriesId: 'series_1', episodeId: 'episode_1',
  owner: 'user_1', requestSha256: digest(canonicalJson(settings)), idempotencyKey: request.idempotencyKey,
  commandReceiptId: 'receipt_1', eventId: 'event_1', createdAt: '2026-08-29T00:00:00Z', providerCalls: 0,
  stageStarted: false, approvalGranted: false, creativeContract, creativeContractSha256 }
const setup = (value: unknown = result, status = 200) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-session-token' }) }
}
describe('bounded creation Host contract', () => {
  it('creates and recovers an exact source digest without stage or generic path parameters', async () => {
    const { handler, fetch } = setup()
    expect(await handler('initializeProject', request, signal())).toEqual({ ok: true, value: result })
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:49123/api/qingmu/project-initializations')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
    expect(await handler('recoverProjectInitialization', { idempotencyKey: request.idempotencyKey, requestSha256: result.requestSha256 }, signal())).toEqual({ ok: true, value: result })
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET')
  })
  it.each(['actorId', 'path', 'approved', 'stage', 'provider', 'episodeId'])('rejects adjacent authority %s before transport', async (field) => {
    const { handler, fetch } = setup()
    expect(await handler('initializeProject', { ...request, [field]: 'anything' }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ requestSha256: '0'.repeat(64) }, { stageStarted: true }, { approvalGranted: true }, { providerCalls: 1 }, { owner: 'private-session-token' }])('rejects inconsistent/reflected result %j', async (change) => {
    const { handler } = setup({ ...result, ...change })
    expect(await handler('initializeProject', request, signal())).toMatchObject({ ok: false })
  })
  it('fails closed when contract readback or recovery carries a mismatched contract SHA', async () => {
    const state = { schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: true,
      locked: true, revision: 1, sha256: '0'.repeat(64), contract: creativeContract,
      sourceText: settings.textInput, message: 'configured' }
    const { handler } = setup(state)
    expect(await handler('readCreativeContract', { projectId: 'project_1' }, signal())).toMatchObject({ ok: false })
    const recovery = setup({ ...result, creativeContractSha256: '0'.repeat(64) }).handler
    expect(await recovery('recoverProjectInitialization', {
      idempotencyKey: request.idempotencyKey, requestSha256: result.requestSha256,
    }, signal())).toMatchObject({ ok: false })
  })
  it('reads the one creation source only when its bytes match the locked source SHA', async () => {
    const state = { schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: true,
      locked: true, revision: 1, sha256: creativeContractSha256, contract: creativeContract,
      sourceText: settings.textInput, message: 'configured' }
    expect(await setup(state).handler('readCreativeContract', { projectId: 'project_1' }, signal()))
      .toEqual({ ok: true, value: state })
    expect(await setup({ ...state, sourceText: '来源已漂移' }).handler(
      'readCreativeContract', { projectId: 'project_1' }, signal(),
    )).toMatchObject({ ok: false })
  })
  it('rejects bad input bytes before fetch and keeps read recovery a GET', async () => {
    const { handler, fetch } = setup({ schema: 'jason.qingmu-text-import-state.v1', projectId: 'project_1', episodeId: 'episode_1', draft: null, draftActive: false, script: null, scriptRevision: 0 })
    const scope = { projectId: 'project_1', episodeId: 'episode_1' }
    const invalid = { ...scope, filename: 'a.txt', contentBase64: 'aGVsbG8=', inputSha256: '0'.repeat(64), idempotencyKey: 'intent-import-1', expectedScriptRevision: 0 }
    expect(await handler('createTextImport', invalid, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
    expect(await handler('readTextImport', scope, signal())).toMatchObject({ ok: true })
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(await handler('readTextImport', { ...scope, projectId: '../escape' }, signal())).toMatchObject({ ok: false })
  })
  it('does not retry an unknown POST outcome', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('connection lost') })
    const handler = createYimengCommandHandler({}, { fetch, readToken: () => 'token' })
    expect(await handler('initializeProject', request, signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
