/** Real Loader, Connection and current Core; only the external business HTTP service is a test double. */
import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Read from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import * as Method from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
import type { ImagoStageSourceMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, expect, it, vi } from 'vitest'
import { sourceCanonical, sourceSha, stageSource, stageSourceResult, stageSourcesFeed } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import * as Command from '../src/index.ts'
import type { YimengBindStageSourceRequest, YimengStageSourceResult } from '../src/types.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'source-loader-test-key-'.repeat(3)
const TOKEN = 'source-loader-test-token'
const SOURCE = stageSource()
const IDS = { projectId: SOURCE.projectId, episodeId: SOURCE.episodeId }
const PATHS = ['pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json', 'pipeline/v6-stage-contracts.json',
  'pipeline/workflow-spec.v6.production-beta.json', 'scripts/compile_qingmu_imago_workset.py', 'scripts/compile_qingmu_imago_workset_v2.py',
  'scripts/imago_v6_draft_ctl.py', 'scripts/compile_qingmu_element_method.py', 'scripts/compile_qingmu_stage_source_method.py']
let root: string | undefined
let context: Context | undefined
let upstream: Server | undefined
afterEach(async () => {
  await context?.fiber.dispose(); context = undefined
  const server = upstream; upstream = undefined
  if (server !== undefined) await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
    server.closeAllConnections()
  })
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined; vi.unstubAllEnvs()
})

it.skipIf(!CORE_ROOT)('composes current source read, real Core, one lost POST and original GET after source/key/session changes',
  { timeout: 60_000 }, async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    vi.stubEnv('YIMENG_API_TOKEN', TOKEN)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    let receipt: YimengStageSourceResult | null = null
    let submitted: YimengBindStageSourceRequest | undefined
    let available = true
    const calls: Array<{ method: string | undefined; path: string }> = [], errors: unknown[] = []
    const feed = () => stageSourcesFeed(available ? SOURCE : null, receipt)
    upstream = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        calls.push({ method: request.method, path: url.pathname })
        expect(request.headers.authorization).toBe(`Bearer ${process.env.YIMENG_API_TOKEN ?? ''}`)
        const base = `/api/qingmu/projects/${IDS.projectId}/episodes/${IDS.episodeId}/stage-sources`
        let reply: unknown
        if (request.method === 'GET' && url.pathname === base) reply = feed()
        else if (request.method === 'POST' && url.pathname === `${base}/A1S/binding`) {
          let body = ''
          for await (const chunk of request) body += String(chunk)
          const input = JSON.parse(body) as Omit<YimengBindStageSourceRequest, 'projectId' | 'episodeId' | 'stageId'>
          expect(Object.keys(input).sort()).toEqual(['expectedSubjectSha256', 'expectedBindingRevision', 'expectedBindingSha256',
            'idempotencyKey', 'methodProjection', 'methodProjectionSha256', 'methodAttestation'].sort())
          expect(input.expectedBindingRevision).toBe(0); expect(input.expectedBindingSha256).toBeNull()
          expect(input.expectedSubjectSha256).toBe(sourceSha(SOURCE))
          expect(input.methodProjection.subject).toEqual(SOURCE)
          expect(input.methodProjectionSha256).toBe(sourceSha(input.methodProjection))
          expect(Object.keys(input.methodProjection.ruleBindings).sort()).toEqual([...PATHS].sort())
          for (const path of PATHS) expect(input.methodProjection.ruleBindings[path]).toBe(createHash('sha256').update(await readFile(join(CORE_ROOT, path))).digest('hex'))
          expect(input.methodProjection.rulesSha256).toBe(sourceSha(input.methodProjection.ruleBindings))
          const { signature, ...unsigned } = input.methodAttestation
          expect(signature).toBe(createHmac('sha256', KEY).update(sourceCanonical(unsigned)).digest('hex'))
          submitted = { ...input, ...IDS, stageId: 'A1S' }
          const original = stageSourceResult(SOURCE)
          const binding = { ...original.binding, definition: input.methodProjection.definition,
            methodProjectionSha256: input.methodProjectionSha256, rulesSha256: input.methodProjection.rulesSha256,
            authSessionId: createHash('sha256').update(TOKEN).digest('hex') }
          receipt = { ...original, binding, bindingSha256: sourceSha(binding) }
          response.destroy() // The controlled record exists, but its POST response is deliberately lost.
          return
        } else if (request.method === 'GET' && url.pathname === `${base}/A1S/binding/command-receipt`) {
          expect(request.headers['idempotency-key']).toBe(submitted?.idempotencyKey)
          expect(url.searchParams.get('expectedSubjectSha256')).toBe(sourceSha(SOURCE))
          expect(receipt).not.toBeNull()
          reply = { schema: 'jason.qingmu-stage-source-recovery.v1', receipt }
        } else throw new Error(`unexpected request ${request.method ?? ''} ${url.pathname}`)
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
        response.end(JSON.stringify(reply))
      })().catch((error: unknown) => { errors.push(error); response.writeHead(500).end() })
    })
    await new Promise<void>(resolve => upstream?.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (address === null || typeof address === 'string') throw new Error('test HTTP listener required')
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    root = await mkdtemp(join(tmpdir(), 'qingmu-stage-source-loader-'))
    const configPath = join(root, 'cordis.yml'), readName = '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-client-connection', Connection], [readName, Read],
      ['@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter', Method], ['@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter', Command],
    ])
    await writeFile(configPath, ["- name: '@deepseek-ai/dsh-host-webserver'", "  config: { host: '127.0.0.1', port: 0 }",
      "- name: '@deepseek-ai/dsh-client-connection'", `- name: '${readName}'`, `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`,
      "- name: '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'", `  config: { coreRoot: ${JSON.stringify(CORE_ROOT)} }`,
      "- name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'", `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`, '',
    ].join('\n'))
    context = new Context(); context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader); context.loader.builtins.include = Include
    context.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()
    const loaded = context
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const origin = `http://127.0.0.1:${String(loaded.webServer.port)}`
    let requestId = 0
    async function rpc<T>(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<T>> {
      const response = await fetch(`${origin}${channel}/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ type: 'client-request', rpcId: `source-${String(++requestId)}`, method: endpoint, payload }) })
      expect(response.status).toBe(200)
      const envelope = await response.json() as { result: RpcResult<T> }
      expect(JSON.stringify(envelope)).not.toContain(TOKEN); expect(JSON.stringify(envelope)).not.toContain(KEY)
      return envelope.result
    }
    expect(await rpc('/qingmu-yimeng', 'stageSources', IDS)).toEqual({ ok: true, value: feed() })
    const method = await rpc<ImagoStageSourceMethodResponse>('/qingmu-imago-method', 'stageSourceMethod', { ...IDS, stageId: 'A1S' })
    if (!method.ok) throw new Error(method.error.message)
    expect(method.value.projection.definition.sourceUsage).toBe('source_reference_only')
    expect(method.value.projection.definition.stageArtifactCreationAllowed).toBe(false)
    expect(calls).toHaveLength(3)
    const request: YimengBindStageSourceRequest = { ...IDS, stageId: 'A1S', expectedSubjectSha256: sourceSha(SOURCE),
      expectedBindingRevision: 0, expectedBindingSha256: null, idempotencyKey: 'source-loader-bind-001',
      methodProjection: method.value.projection, methodProjectionSha256: method.value.projectionSha256,
      methodAttestation: method.value.methodAttestation }
    expect(await rpc('/qingmu-yimeng-command', 'bindStageSource', request)).toMatchObject({ ok: false })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    available = false
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    vi.stubEnv('YIMENG_API_TOKEN', 'source-loader-rotated-token')
    expect(await rpc('/qingmu-yimeng-command', 'recoverStageSourceBinding', { ...IDS, stageId: 'A1S',
      expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey }))
      .toEqual({ ok: true, value: { schema: 'jason.qingmu-stage-source-recovery.v1', receipt } })
    expect(await rpc('/qingmu-yimeng', 'stageSources', IDS)).toEqual({ ok: true, value: feed() })
    expect(feed().currentBinding).toBeNull(); expect(feed().latestBinding).toEqual(receipt)
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    const entry = [...loaded.loader.entries()].find(entry => entry.options.name === readName)
    if (entry === undefined) throw new Error('read plugin not loaded')
    await loaded.loader.update(entry.id, { disabled: true }); await loaded.loader.await()
    expect(loaded.get('qingmuYimengRead')).toBeUndefined()
    const count = calls.length
    expect(await rpc('/qingmu-imago-method', 'stageSourceMethod', { ...IDS, stageId: 'A1S' })).toMatchObject({ ok: false })
    expect(calls).toHaveLength(count)
    available = true
    await loaded.loader.update(entry.id, { disabled: false }); await loaded.loader.await()
    expect(await rpc('/qingmu-imago-method', 'stageSourceMethod', { ...IDS, stageId: 'A1S' })).toMatchObject({ ok: true })
    expect(errors).toEqual([])
  })
