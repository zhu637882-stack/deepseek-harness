import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'

const signal = () => new AbortController().signal
const settings = { aspectRatio: '9:16', creationType: 'story_idea', duration: '1-2分钟', episodeCount: 1,
  mode: 'whole_series', name: '隔离样本', style: 'realistic', textInput: '雨夜里，林夏收到一封旧信。',
  textVersion: 'creation-text-v1' as const, stylePackId: 'realistic_cinema', directorSkillIds: ['shot_blocking_director'] }
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
const currentCreativeContract = { ...creativeContract, schema: 'qingmu.creative-contract.v2' as const,
  identity: { projectId: 'project_1' }, source: { ...creativeContract.source, textVersion: 'creation-text-v1' as const },
  methods: { ...creativeContract.methods,
    stylePackId: { id: 'realistic_cinema', version: '1.0.0', sha256: '8'.repeat(64) },
    directorSkills: [{ id: 'shot_blocking_director', version: '1.0.0', sha256: '9'.repeat(64) }] } }
const currentCreativeContractSha256 = digest(canonicalJson(currentCreativeContract))
const creationCatalog = {
  schema: 'jason.qingmu-creation-options.v1',
  textVersions: [{ id: 'creation-text-v1', label: '当前输入文本 · 第1版', available: true }],
  directorSkills: [{ id: 'shot_blocking_director', version: '1.0.0', sha256: '9'.repeat(64), stage: 'C', available: true, disabledReason: null }],
}
const styleCatalog = {
  items: [{ key: 'realistic', labelZh: '写实电影', labelEn: 'Realistic cinema',
    group: { key: 'real_person', labelZh: '真人', labelEn: 'Real person' }, imageUrl: '/images/tago-styles/realistic.webp',
    imageExists: true, promptStyle: 'cinematic realism', negativePrompt: 'flat light' }], total: 1,
}
const stylePackCatalog = {
  schemaVersion: 'qingmu.style-pack.v1', groups: [{ key: 'real_person', label: '真人', items: [{
    id: 'realistic_cinema', version: '1.0.0', name: '写实电影', group: 'real_person', groupLabel: '真人',
    intent: '自然主义叙事', tone: '克制', palette: [], contrast: '', lightingSources: [], lensFamily: '',
    compositionRules: [], performanceRegister: '', editingRhythm: '', positiveFragments: [], negativeConstraints: [], verticalDelivery: {},
  }] }], total: 1,
}
const result = { schema: 'jason.qingmu-project-bootstrap-result.v1', projectId: 'project_1', seriesId: 'series_1', episodeId: 'episode_1',
  owner: 'user_1', requestSha256: digest(canonicalJson(settings)), idempotencyKey: request.idempotencyKey,
  commandReceiptId: 'receipt_1', eventId: 'event_1', createdAt: '2026-08-29T00:00:00Z', providerCalls: 0,
  stageStarted: false, approvalGranted: false, creativeContract: currentCreativeContract,
  creativeContractSha256: currentCreativeContractSha256 }
const setup = (value: unknown = result, status = 200) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
  return { fetch, handler: createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-session-token' }) }
}
describe('bounded creation Host contract', () => {
  it('transports product bytes above the ordinary JSON limit but hashes only their bound identity', async () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024, 80)
    const image = { filename: '产品.png', contentBase64: bytes.toString('base64'), contentSha256: createHash('sha256').update(bytes).digest('hex') }
    const identity = { filename: image.filename, contentSha256: image.contentSha256 }
    const receipt = { ...result, requestSha256: digest(canonicalJson({ ...settings, productImages: [identity] })) }
    const { handler, fetch } = setup(receipt)
    expect(await handler('initializeProject', { ...request, productImages: [image] }, signal())).toEqual({ ok: true, value: receipt })
    const body = fetch.mock.calls[0]?.[1]?.body
    if (typeof body !== 'string') throw new Error('creation request body missing')
    expect((JSON.parse(body) as Record<string, unknown>).productImages).toEqual([image])
    expect(await handler('recoverProjectInitialization', { idempotencyKey: request.idempotencyKey,
      requestSha256: receipt.requestSha256 }, signal())).toEqual({ ok: true, value: receipt })
  })
  it.each([[], Array.from({ length: 6 }, (_, index) => ({ filename: `${index}.png`, contentBase64: 'eA==', contentSha256: digest('x') })),
    [{ filename: 'x.png', contentBase64: 'eA==', contentSha256: 'f'.repeat(64) }],
    [{ filename: '../x.png', contentBase64: 'eA==', contentSha256: digest('x') }]].map(productImages => ({ productImages })))('rejects invalid product attachments before dispatch', async ({ productImages }) => {
    const { handler, fetch } = setup()
    expect(await handler('initializeProject', { ...request, productImages }, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reads a bound style composition and rejects a response for another selection', async () => {
    const preview = { styleId: 'real_person_classic_bw', styleLabel: '经典黑白', stylePackId: 'sp_urban_emotion_realistic',
      stylePackName: '都市情感写实', effectivePrompt: '黑白灰阶\n具体导演决定优先', effectiveNegative: '', adjustments: ['暖米色'] }
    const request = { style: preview.styleId, stylePackId: preview.stylePackId }
    const api = setup(preview)
    expect(await api.handler('readStyleComposition', request, signal())).toEqual({ ok: true, value: preview })
    expect(api.fetch.mock.calls[0]?.[0]).toContain('/api/qingmu/style-composition?style=real_person_classic_bw')
    expect(await setup({ ...preview, styleId: 'realistic' }).handler('readStyleComposition', request, signal())).toMatchObject({ ok: false })
    expect(await api.handler('readStyleComposition', { ...request, paidConfirmed: true }, signal())).toMatchObject({ ok: false })
  })
  it('exposes current methods and visual guidance without inventing a saved legacy contract', async () => {
    const state = { schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: false,
      locked: false, revision: null, sha256: null, contract: null, sourceText: null, message: '旧设定保留',
      effectiveMethods: { writingSkills: [], directorSkills: [{ ...method, id: 'cinematic-director' }], cameraSkills: [], soundSkills: [] },
      visualSettings: { styleId: 'realistic', styleLabel: '写实', stylePackId: null, stylePackName: null,
        effectivePrompt: '自然摄影', effectiveNegative: '', adjustments: [] } }
    expect(await setup(state).handler('readCreativeContract', { projectId: 'project_1' }, signal())).toEqual({ ok: true, value: state })
    const invalid = { ...state, effectiveMethods: { ...state.effectiveMethods, directorSkills: [method, method] } }
    expect(await setup(invalid).handler('readCreativeContract', { projectId: 'project_1' }, signal())).toMatchObject({ ok: false })
  })
  it('accepts a project-bound current contract and rejects a copied binding', async () => {
    const state = { schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: true,
      locked: true, revision: 1, sha256: currentCreativeContractSha256, contract: currentCreativeContract,
      sourceText: settings.textInput, message: 'configured' }
    expect(await setup(state).handler('readCreativeContract', { projectId: 'project_1' }, signal()))
      .toMatchObject({ ok: true, value: { contract: { schema: 'qingmu.creative-contract.v2', identity: { projectId: 'project_1' } } } })
    const copied = { ...state, contract: { ...currentCreativeContract, identity: { projectId: 'project_2' } } }
    expect(await setup(copied).handler('readCreativeContract', { projectId: 'project_1' }, signal()))
      .toMatchObject({ ok: false })
  })
  it('preserves the frozen contract while validating an explicit method upgrade', async () => {
    const from = currentCreativeContract.methods.directorSkills[0]!
    const to = { ...from, version: '2.0.0', sha256: 'a'.repeat(64) }
    const state = { schema: 'jason.qingmu-creative-contract-state.v1', projectId: 'project_1', configured: true,
      locked: true, revision: 1, sha256: currentCreativeContractSha256, contract: currentCreativeContract,
      sourceText: settings.textInput, message: '方法已兼容更新', methodUpgrades: [{ from, to, reason: '补充整场声音设计' }] }
    expect(await setup(state).handler('readCreativeContract', { projectId: 'project_1' }, signal()))
      .toMatchObject({ ok: true, value: { contract: currentCreativeContract, methodUpgrades: state.methodUpgrades } })
    for (const upgrade of [
      { from: { ...from, sha256: 'f'.repeat(64) }, to, reason: 'wrong predecessor' },
      { from, to: { ...to, id: 'another-method' }, reason: 'wrong identity' },
    ]) {
      expect(await setup({ ...state, methodUpgrades: [upgrade] }).handler('readCreativeContract', { projectId: 'project_1' }, signal()))
        .toMatchObject({ ok: false })
    }
  })
  it('joins Writer creation, base-style, and style-pack catalogs without inventing a selection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = String(url)
      if (path.endsWith('/api/qingmu/creation-options')) return Response.json(creationCatalog)
      if (path.endsWith('/api/style-packs')) return Response.json(stylePackCatalog)
      if (path.endsWith('/api/styles')) return Response.json(styleCatalog)
      return new Response(null, { status: 404 })
    })
    const handler = createYimengCommandHandler({ baseUrl: 'http://127.0.0.1:49123' }, { fetch, readToken: () => 'private-session-token' })
    await expect(handler('readCreationOptions', {}, signal())).resolves.toEqual({ ok: true, value: {
      schema: 'jason.qingmu-creation-options.v1', textVersions: creationCatalog.textVersions,
      directorSkills: creationCatalog.directorSkills,
      visualStyles: [{ id: 'realistic', label: '写实电影', group: 'real_person', groupLabel: '真人', previewUrl: '/api/qingmu/creation-style-preview?styleId=realistic' }],
      stylePacks: [{ id: 'realistic_cinema', version: '1.0.0', name: '写实电影', group: 'real_person', groupLabel: '真人', intent: '自然主义叙事', tone: '克制' }],
    } })
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:49123/api/qingmu/creation-options',
      'http://127.0.0.1:49123/api/style-packs',
      'http://127.0.0.1:49123/api/styles',
    ])
  })
  it('fails closed when an advertised creation catalog is malformed', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/api/qingmu/creation-options')) {
        return Response.json({ ...creationCatalog, textVersions: [{ ...creationCatalog.textVersions[0], available: false }] })
      }
      return Response.json(stylePackCatalog)
    })
    const handler = createYimengCommandHandler({}, { fetch, readToken: () => 'private-session-token' })
    await expect(handler('readCreationOptions', {}, signal())).resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
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
