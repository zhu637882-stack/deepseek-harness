import { createServer } from 'node:http'
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
import { request, response, savedDraft, quoteRequest, quoteResponse } from './reference-video-fixture.ts'

it('loads the actual Host, Connection and read plugin through YAML and serves a verified request preview', async () => {
  const requests: { url?: string; method?: string; authorization?: string; body: string }[] = []
  const upstream = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body })
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url?.endsWith('/quote') ? quoteResponse : req.url?.includes('/drafts/') ? savedDraft : response))
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

  } finally {
    await ctx.fiber.dispose(); upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => { resolve() }))
    await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs()
  }
})
