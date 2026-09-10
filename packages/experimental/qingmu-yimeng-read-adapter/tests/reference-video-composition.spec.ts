import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { expect, it, vi } from 'vitest'
import * as Adapter from '../src/index.ts'
import * as Commands from '../../qingmu-yimeng-command-adapter/src/index.ts'
import { sourceFixture } from '../../qingmu-yimeng-command-adapter/tests/local-video-source.fixture.ts'
import { request, response, savedDraft, quoteRequest, quoteResponse, runRequest, runResponse } from './reference-video-fixture.ts'

it('loads the actual Host, Connection and read plugin through YAML and serves a verified request preview', async () => {
  const materialScope = { projectId: 'p', frameId: 'f', expectedRevision: 1, expectedRequestSha256: savedDraft.draft.requestSha256 }
  const materialState = { schema: 'jason.reference-video-materials.v1', projectId: 'p', frameId: 'f', draftRevision: 1,
    draftRequestSha256: materialScope.expectedRequestSha256, model: 'wan3.0-video', configured: true, configurationError: null,
    materials: [{ bindingToken: 'lin', assetId: 'asset_lin', assetSha256: 'a'.repeat(64), mediaType: 'reference_image',
      status: 'ready', expiresAt: 2000000000, failureCode: null }], allReady: true, providerCalls: 0, databaseWrites: 0, generationQueued: false }
  const { providerCalls: _calls, databaseWrites: _writes, ...materialFields } = materialState
  const prepared = { ...materialFields, requestId: 'composition-prepare-01', assetId: 'asset_lin',
    uploadAttempts: 1, modelCalls: 0, localStateChanged: true }
  const registration = { schema: 'jason.reference-video-review-registration.v1', projectId: 'p', episodeId: 'e', frameId: 'f',
    runId: 'refvideo_register', assetId: 'asset_output', assetSha256: 'c'.repeat(64), takeId: `asset_reftake_${'d'.repeat(32)}`,
    providerCalls: 0, selectionChanged: false, formalApprovalChanged: false }
  const registrationRequest = { projectId: 'p', frameId: 'f', runId: registration.runId,
    assetId: registration.assetId, expectedAssetSha256: registration.assetSha256 }
  const localBytes = Buffer.alloc(32); localBytes.write('ftyp', 4)
  const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
  const localScope = { projectId: 'p', episodeId: 'e', frameId: 'f' }
  const localRequest = { ...localScope, idempotencyKey: 'local-video-composition', originalFileName: 'original.mp4',
    contentBase64: localBytes.toString('base64'), sourceDeclaration: 'local_file_unverified' }
  const localSha = hash(localBytes)
  const localReceipt = { schema: 'jason.qingmu-local-video-candidate.v1', ...localScope,
    assetId: `asset_localvideo_${'a'.repeat(32)}`, takeId: `asset_localvideo_${'a'.repeat(32)}`,
    idempotencyKey: localRequest.idempotencyKey, originalFileName: localRequest.originalFileName,
    requestSha256: hash(JSON.stringify({ contentSha256: localSha, episodeId: 'e', frameId: 'f',
      originalFileName: 'original.mp4', sourceDeclaration: 'local_file_unverified' })),
    byteSize: 32, mimeType: 'video/mp4', inputSha256: localSha, materializedSha256: localSha,
    durationSec: 8, width: 1280, height: 720, hasAudio: true, sourceDeclaration: 'local_file_unverified',
    rightsStatus: 'not_recorded', selectionStatus: 'Unselected', isSelected: false, providerCalls: 0, generationQueued: false }
  const localSource = sourceFixture()
  const requests: { url: string | undefined; method: string | undefined; authorization: string | undefined; body: string }[] = []
  const upstream = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body })
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url?.includes('/source') ? (req.method === 'GET' && !req.url.includes('/receipt') ? localSource.state : localSource.result) : req.url?.includes('/local-video-candidates') ? localReceipt : req.url?.includes('/review-registration') ? registration : req.url?.endsWith('/prepare') ? prepared
      : req.url?.includes('/materials') ? materialState : req.url?.includes('/runs') ? runResponse : req.url?.endsWith('/quote') ? quoteResponse : req.url?.includes('/drafts/') ? savedDraft : response))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('fixture server not listening')
  const root = await mkdtemp(join(tmpdir(), 'qingmu-reference-composition-'))
  const ctx = new Context()
  vi.stubEnv('YIMENG_API_TOKEN', 'fixture-owner-token'); vi.stubEnv('DSH_HOME', '')
  try {
    const file = join(root, 'cordis.yml')
    await writeFile(file, [
      "- name: '@deepseek-ai/dsh-host-webserver'", '  config:', '    host: 127.0.0.1', '    port: 0',
      "- name: '@deepseek-ai/dsh-client-connection'",
      "- name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'", '  config:',
      `    baseUrl: http://127.0.0.1:${address.port}`, '',
      "- name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'", '  config:',
      `    baseUrl: http://127.0.0.1:${address.port}`, '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-client-connection', Connection],
      ['@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter', Adapter],
      ['@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter', Commands],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected plugin: ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
    await ctx.loader.await()
    const result = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng/referenceVideoPreview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'preview', method: 'referenceVideoPreview', payload: request }),
    })
    const envelope = await result.json()
    expect(envelope.result).toEqual({ ok: true, value: response })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.authorization).toBe('Bearer fixture-owner-token')
    expect({ prompt: envelope.result.value.body.input.prompt,
      references: envelope.result.value.referenceMapping.map((item: { alias: string; label: string }) => `${item.alias}: ${item.label}`),
      providerCalls: envelope.result.value.providerCalls, submissionReady: envelope.result.value.submissionReady,
    }).toMatchInlineSnapshot(`
      {
        "prompt": "图1在图2说：“图1也是原对白，不能改。”",
        "providerCalls": 0,
        "references": [
          "图1: 林予",
          "音频1: 林予音色",
          "图2: 咖啡馆",
        ],
        "submissionReady": false,
      }
    `)
    const save = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/saveReferenceVideoDraft`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'save', method: 'saveReferenceVideoDraft', payload: {
        projectId: 'p', frameId: 'f', expectedRevision: 0, expectedFrameSha256: savedDraft.frameSha256, request: savedDraft.draft.request,
      } }),
    })
    expect((await save.json()).result).toEqual({ ok: true, value: savedDraft })
    expect(requests.map(r => r.method)).toEqual(['POST', 'POST', 'GET'])
    const quote = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng/referenceVideoQuote`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'quote', method: 'referenceVideoQuote', payload: quoteRequest }),
    })
    expect((await quote.json()).result).toEqual({ ok: true, value: quoteResponse })
    expect(requests.at(-1)?.url).toBe('/api/qingmu/projects/p/reference-video/drafts/f/quote')

    const queue = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/queueReferenceVideo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'queue-reference', method: 'queueReferenceVideo', payload: runRequest }),
    })
    expect((await queue.json()).result).toEqual({ ok: true, value: runResponse })
    expect(requests.slice(-2).map(r => r.method)).toEqual(['POST', 'GET'])
    expect(requests.at(-1)?.url).toBe(`/api/qingmu/projects/p/reference-video/drafts/f/runs/${runResponse.runId}`)
    const materialRead = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng/referenceVideoMaterials`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'materials', method: 'referenceVideoMaterials', payload: materialScope }),
    })
    expect((await materialRead.json()).result).toEqual({ ok: true, value: materialState })
    const materialPrepare = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/prepareReferenceVideoMaterial`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'prepare', method: 'prepareReferenceVideoMaterial',
        payload: { ...materialScope, requestId: prepared.requestId, assetId: prepared.assetId } }),
    })
    expect((await materialPrepare.json()).result).toEqual({ ok: true, value: prepared })
    expect(requests.slice(-3).map(r => r.method)).toEqual(['GET', 'POST', 'GET'])
    expect(requests.slice(-3).every(r => r.authorization === 'Bearer fixture-owner-token')).toBe(true)
    for (const method of ['registerReferenceVideoCandidateForReview', 'readReferenceVideoCandidateRegistration']) {
      const registered = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: method, method, payload: registrationRequest }),
      })
      expect((await registered.json()).result).toEqual({ ok: true, value: registration })
    }
    expect(requests.slice(-2).map(r => r.method)).toEqual(['POST', 'GET'])
    expect(requests.slice(-2).every(r => r.authorization === 'Bearer fixture-owner-token')).toBe(true)
    expect(requests.at(-2)?.body).toBe(JSON.stringify({ expectedAssetSha256: registration.assetSha256 }))
    for (const [method, payload] of [
      ['uploadLocalVideoCandidate', localRequest],
      ['recoverLocalVideoCandidate', { ...localScope, idempotencyKey: localRequest.idempotencyKey, requestSha256: localReceipt.requestSha256 }],
    ] as const) {
      const imported = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: method, method, payload }),
      })
      expect((await imported.json()).result).toEqual({ ok: true, value: localReceipt })
    }
    expect(requests.slice(-2).map(r => r.method)).toEqual(['POST', 'GET'])
    expect(requests.at(-1)?.body).toBe('')
    for (const [method, payload, expected] of [
      ['readLocalVideoSource', localSource.scope, localSource.state],
      ['registerLocalVideoSource', localSource.request, localSource.result],
      ['recoverLocalVideoSource', localSource.recovery, localSource.result],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${ctx.webServer.port}/qingmu-yimeng-command/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: method, method, payload }),
      })
      expect(((await response.json()) as { result: unknown }).result).toEqual({ ok: true, value: expected })
    }
    expect(requests.slice(-3).map(r => r.method)).toEqual(['GET', 'POST', 'GET'])
    expect(requests.slice(-3).every(r => r.authorization === 'Bearer fixture-owner-token')).toBe(true)
    expect(requests.at(-1)?.body).toBe('')
  } finally {
    await ctx.fiber.dispose(); upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => { resolve() }))
    await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs()
  }
})
