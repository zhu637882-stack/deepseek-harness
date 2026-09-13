import { createHash } from 'node:crypto'
import { canonical } from './reference-video-fixture.ts'
import { expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import { request, response, videoReferenceFixture } from './reference-video-fixture.ts'
const body = response.body

const signal = () => new AbortController().signal

it('verifies mixed video references and fractional input-plus-output quotation', async () => {
  const fixture = videoReferenceFixture()
  let value: unknown = fixture.response
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json(value), readToken: () => 'fixture' })
  expect(await handler('referenceVideoPreview', fixture.request, signal())).toEqual({ ok: true, value })
  for (const seconds of [undefined, 0, 16, Number.NaN]) {
    value = { ...fixture.response, referenceVideoDurationSec: seconds }
    expect((await handler('referenceVideoPreview', fixture.request, signal())).ok).toBe(false)
  }
  value = fixture.quoteResponse
  expect(await handler('referenceVideoQuote', fixture.quoteRequest, signal())).toEqual({ ok: true, value })
  value = { ...fixture.quoteResponse, cost: { ...fixture.quoteResponse.cost, billableSeconds: 8, estimatedCny: '4.800000' } }
  expect((await handler('referenceVideoQuote', fixture.quoteRequest, signal())).ok).toBe(false)
})

it('posts the explicit draft through the authenticated read handler without provider calls', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture-token' })
  expect(await handler('referenceVideoPreview', request, signal())).toEqual({ ok: true, value: response })
  expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8115/api/qingmu/projects/p/reference-video/preview')
  const init = fetch.mock.calls[0]?.[1]
  expect(init?.method).toBe('POST')
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token')
  const { projectId: _projectId, ...expectedBody } = request
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
  expect(JSON.parse(init.body)).toEqual(expectedBody)
})

it.each([
  { projectId: 'other' }, { frameId: 'other' }, { providerCalls: 1 }, { databaseWrites: 1 },
  { submissionReady: true }, { requestBodySha256: '0'.repeat(64) }, { referenceAudioDurationSec: 16 },
  { referenceMapping: response.referenceMapping.toReversed() },
  { body: { ...body, input: { ...body.input, prompt: 'silently changed' } } },
])('rejects stale, reordered or mutated upstream preview %j', async (override) => {
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json({ ...response, ...override }), readToken: () => 'fixture' })
  expect((await handler('referenceVideoPreview', request, signal())).ok).toBe(false)
})

it('rejects missing credentials, URLs, duplicate tokens and dangling references before transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const anonymous = createYimengReadHandler({}, { fetch, readToken: () => undefined })
  expect((await anonymous('referenceVideoPreview', request, signal())).ok).toBe(false)
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  for (const draft of [
    { ...request, url: 'https://external' },
    { ...request, bindings: [request.bindings[0], request.bindings[0]] },
    { ...request, promptParts: [{ bindingToken: 'missing' }] },
    { ...request, parameters: { ...request.parameters, duration: 31 } },
  ]) expect((await handler('referenceVideoPreview', draft, signal())).ok).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('projects versioned image/audio/video metadata from the current project asset page', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ page: 2, page_size: 200, pages: 3, items: [
    { id: 'asset_lin', project_id: 'p', asset_type: 'image', role: 'identity', sha256: 'a'.repeat(64), local_path: '/private/secret' },
    { id: 'asset_unhashed', project_id: 'p', asset_type: 'audio', sha256: '' },
    { id: 'asset_video', project_id: 'p', asset_type: 'video', sha256: 'b'.repeat(64) },
  ] }))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 2 }, signal())
  expect(result).toEqual({ ok: true, value: { projectId: 'p', page: 2, pages: 3, items: [
    { assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '参考图片 201', mediaType: 'reference_image', browserUrl: '' },
    { assetId: 'asset_video', assetSha256: 'b'.repeat(64), label: '参考视频 202', mediaType: 'reference_video', browserUrl: '' },
  ] } })
  expect(JSON.stringify(result)).not.toContain('/private')
})

it('exposes positive media durations and keeps missing or malformed durations unknown', async () => {
  const durations = [8.4985, 6.989208, 0, -1, null, '7', undefined, 21]
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ page: 1, page_size: 200, pages: 1,
    items: durations.map((duration_sec, i) => ({ id: `asset_${i}`, project_id: 'p', asset_type: i === 7 ? 'video' : 'audio',
      sha256: 'a'.repeat(64), duration_sec })) }))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, signal())
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('expected catalog')
  const value = result.value as { items: { durationSec?: number }[] }
  expect(value.items.map(item => item.durationSec)).toEqual([8.4985, 6.989208, undefined, undefined, undefined, undefined, undefined, 21])
})

it('retains original image staging without leaking authorization or filling absent history', async () => {
  const layout = { basis: '导演布置', coordinateFrame: '米制', objects: [{ id: 'bench', center: [0, 2, 0.5], size: [2, 1, 1] }] }
  const camera = { position: [0, -3, 1.6], target: [0, 2, 1], verticalFov: 50 }
  const oldDesign = { name: '渡口候船室', view: '入口朝检票窗', imagePrompt: '旧长椅面向检票窗',
    visualIdentity: '长椅与检票窗位于相邻墙面', designBasis: '开船前的场景',
    imageStage: { sceneName: '渡口候船室', camera: '入口内侧', blocking: '无人', state: '检票窗关闭' } }
  const asset = { id: 'room', project_id: 'p', asset_type: 'image', sha256: 'a'.repeat(64),
    generation_config_json: JSON.stringify({ prompt: '最终提交的旧窗关闭画面', anchor: { schema: 'qingmu.asset-image-authorization.v1',
      assetDesign: { ...oldDesign, imageCamera: camera }, sceneContext: { name: '渡口候船室', space: { layout: '长椅靠北墙' }, sceneLayout: layout },
      compositionReference: { sha256: 'c'.repeat(64) },
      command: { privateAuthorization: 'do-not-project' }, actor: 'private-actor' } }) }
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({
    page: 1, page_size: 200, pages: 1, items: [asset, { ...asset, id: 'legacy', generation_config_json: '{}' },
      { ...asset, id: 'malformed', generation_config_json: 'broken' }],
  }) })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, signal())
  expect(result).toMatchObject({ ok: true, value: { items: [{ imageDesign: { ...oldDesign,
    submittedPrompt: '最终提交的旧窗关闭画面', sceneContext: { name: '渡口候船室', space: { layout: '长椅靠北墙' } },
    spatialReference: { layout, camera, sha256: 'c'.repeat(64) } } }, {}, {}] } })
  expect(result).not.toHaveProperty('value.items.1.imageDesign')
  expect(result).not.toHaveProperty('value.items.2.imageDesign')
  expect(JSON.stringify(result)).not.toContain('private-')
  expect(JSON.stringify(result)).not.toContain('do-not-project')
})

it.each(['https://public.example', ''])('uses the returned media identity for signed thumbnails from %s', async (origin) => {
  const signature = 'a'.repeat(64)
  const items = [{ id: 'asset_face', project_id: 'p', asset_type: 'image', sha256: 'b'.repeat(64),
    display_name: '林予', preview_media_id: 'media_independent', public_url: `${origin}/api/media/media_independent?expires=2000000000&signature=${signature}` }]
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({ page:1,page_size:200,pages:1,items }) })
  const result = await handler('referenceVideoAssets', { projectId:'p',page:1 }, signal())
  expect(result).toMatchObject({ ok:true,value:{ items:[{ assetId:'asset_face',label:'林予',browserUrl:`http://127.0.0.1:8115/api/media/media_independent?expires=2000000000&signature=${signature}` }] } })
  items[0]!.public_url = items[0]!.public_url.replace('https://public.example','http://127.0.0.1:8115')
  items[0]!.preview_media_id = 'media_wrong'
  expect(await handler('referenceVideoAssets', { projectId:'p',page:1 }, signal())).toMatchObject({ ok:true,value:{ items:[{ browserUrl:'' }] } })
})

it('projects a private local-reference scope only for valid owner-bound local assets', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
    page: 1,
    page_size: 200,
    pages: 1,
    items: [
      {
        id: 'asset_localref_linyu', project_id: 'p', asset_type: 'image',
        sha256: 'c'.repeat(64), owner_type: 'actor', owner_id: 'actor_linyu',
      },
      {
        id: 'asset_localref_forged', project_id: 'p', asset_type: 'image',
        sha256: 'd'.repeat(64), owner_type: 'frame', owner_id: 'frame_1',
      },
      {
        id: 'asset_not_local', project_id: 'p', asset_type: 'image',
        sha256: 'e'.repeat(64), owner_type: 'actor', owner_id: 'actor_linyu',
      },
    ],
  }))
  const handler = createYimengReadHandler({}, { fetch, readToken: () => 'fixture' })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, signal())
  expect(result).toMatchObject({
    ok: true,
    value: {
      items: [
        { assetId: 'asset_localref_linyu', localReferenceScope: { elementKind: 'actor', targetId: 'actor_linyu' } },
        { assetId: 'asset_localref_forged' },
        { assetId: 'asset_not_local' },
      ],
    },
  })
  expect(result).not.toHaveProperty('value.items.1.localReferenceScope')
  expect(result).not.toHaveProperty('value.items.2.localReferenceScope')
})

it('projects private audio playback only for actor-owned local voice candidates', async () => {
  const voice = { id: `asset_localvoice_${'a'.repeat(32)}`, project_id: 'p', asset_type: 'audio',
    sha256: 'c'.repeat(64), owner_type: 'actor', owner_id: 'actor_linyu', role: 'local_voice_candidate', display_name: '林予' }
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({
    page: 1, page_size: 200, pages: 1, items: [voice, { ...voice, owner_type: 'frame' }, { ...voice, role: 'other' }],
  }) })
  const result = await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, signal())
  expect(result).toMatchObject({ ok: true, value: { items: [
    { localVoiceScope: { targetId: 'actor_linyu' }, label: '林予 · 音色', mediaType: 'reference_audio', browserUrl: '' }, {}, {},
  ] } })
  expect(result).not.toHaveProperty('value.items.1.localVoiceScope')
  expect(result).not.toHaveProperty('value.items.2.localVoiceScope')
})

it('keeps copied private images and voice references readable under the copied owner scope', async () => {
  const image = { id: 'asset_copy_012345abcdef', project_id: 'p', asset_type: 'image',
    sha256: 'c'.repeat(64), owner_type: 'actor', owner_id: 'actor_copied' }
  const voice = { ...image, id: 'asset_copy_abcdef012345', asset_type: 'audio', role: 'local_voice_candidate' }
  const handler = createYimengReadHandler({}, { readToken: () => 'fixture', fetch: async () => Response.json({
    page: 1, page_size: 200, pages: 1, items: [image, voice],
  }) })
  expect(await handler('referenceVideoAssets', { projectId: 'p', page: 1 }, signal())).toMatchObject({
    ok: true, value: { items: [
      { assetId: image.id, browserUrl: '', localReferenceScope: { elementKind: 'actor', targetId: 'actor_copied' } },
      { assetId: voice.id, browserUrl: '', localVoiceScope: { targetId: 'actor_copied' } },
    ] },
  })
})


it.each([
  ['oss://dashscope-instant/project/ref.png', true],
  ['oss://dashscope-instant/project/ref.wav', true],
  ['oss://dashscope-instant/account.region/session.v1/ref.final.wav', true],
  ['oss://dashscope-instant/project/../ref.png', false],
  ['oss://dashscope-instant/project/ref.png?token=secret', false],
  ['oss://different-bucket/project/ref.png', false],
  ['oss://dashscope-instant/project/%2fref.png', false],
])('accepts only canonical temporary transport %s', async (url, accepted) => {
  const nextBody = { ...response.body, input: { ...response.body.input,
    media: response.body.input.media.map(media => ({ ...media, url })) } }
  const next = { ...response, body: nextBody, requestBodySha256: createHash('sha256').update(canonical(nextBody)).digest('hex') }
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json(next), readToken: () => 'fixture' })
  expect((await handler('referenceVideoPreview', request, signal())).ok).toBe(accepted)
})


it.each([false, true])('checks explicit first/last frame bodies without allowing a silent route change (%s)', async (withLast) => {
  const bindings = [request.bindings[0]!, request.bindings[2]!].slice(0, withLast ? 2 : 1).map((binding, index) => ({ ...binding,
    frameRole: index === 0 ? 'first_frame' as const : 'last_frame' as const }))
  const input = { ...request, bindings, promptParts: [{ text: '保持起始站位，缓慢走向门口。' }],
    parameters: { ...request.parameters, ratio: 'adaptive' as const } }
  const nextBody = { ...response.body, input: { prompt: input.promptParts[0]!.text,
    media: bindings.map(binding => ({ type: binding.frameRole,
      url: `oss://dashscope-instant/project/${binding.frameRole}.png` })) }, parameters: { ...input.parameters, watermark: false as const } }
  const expected = { ...response, body: nextBody, referenceAudioDurationSec: 0,
    referenceMapping: bindings.map((binding, index) => ({ ...binding, mediaIndex: index, mediaType: binding.frameRole, alias: `图${index + 1}` })),
    requestBodySha256: createHash('sha256').update(canonical(nextBody)).digest('hex') }
  let upstream: unknown = expected
  const handler = createYimengReadHandler({}, { fetch: async () => Response.json(upstream), readToken: () => 'fixture' })
  expect(await handler('referenceVideoPreview', input, signal())).toEqual({ ok: true, value: expected })
  upstream = { ...expected, referenceMapping: expected.referenceMapping.map(({ frameRole: _role, ...rest }) => rest) }
  expect((await handler('referenceVideoPreview', input, signal())).ok).toBe(false)
  upstream = expected
  expect((await handler('referenceVideoPreview', { ...input, bindings: input.bindings.map(({ frameRole: _role, ...rest }) => rest) }, signal())).ok).toBe(false)
  expect((await handler('referenceVideoPreview', { ...input, bindings: [...bindings, request.bindings[1]!] }, signal())).ok).toBe(false)
})
