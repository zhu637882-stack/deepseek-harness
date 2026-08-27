/** Real Loader, Connection and current Core; only the external Yimeng HTTP boundary is a double. */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import type { ImagoProductionUnitMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { YimengProductionUnitsResponse } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, expect, it, vi } from 'vitest'
import * as Command from '../src/index.ts'
import type { YimengBindProductionUnitRequest, YimengProductionUnitRecovery, YimengProductionUnitResult } from '../src/types.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT?.trim()
const TEST_KEY = 'production-unit-loader-test-key-'.repeat(2)
const TEST_TOKEN = 'production-unit-loader-token'
const IDS = { projectId: 'loader-project', episodeId: 'loader-episode', groupId: 'native-group' }
const FLAGS = { planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const
const SOURCE = {
  schema: 'jason.qingmu-production-unit-source.v1', ...IDS, groupNo: 3, title: '门前对话',
  groupExecutionPromptSha256: 'a'.repeat(64), storyboardRevision: 2,
  shots: [{ frameId: 'frame-a', frameNo: 2, frameContentSha256: 'b'.repeat(64) },
    { frameId: 'frame-b', frameNo: 7, frameContentSha256: 'c'.repeat(64) }],
} as const

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('fixture must be JSON')
  return encoded
}
function sha(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex') }

let root: string | undefined
let context: Context | undefined
let upstream: Server | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  const server = upstream
  upstream = undefined
  if (server !== undefined) await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
    server.closeAllConnections()
  })
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

it.skipIf(!CORE_ROOT)('composes unit read, real Core method, lost-write recovery and unplugging through Loader',
  { timeout: 60_000 }, async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    vi.stubEnv('YIMENG_API_TOKEN', TEST_TOKEN)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_KEY)
    const sourceSha = sha(SOURCE)
    let receipt: YimengProductionUnitResult | undefined
    let submitted: YimengBindProductionUnitRequest | undefined
    const calls: Array<{ method: string | undefined; path: string }> = []
    const upstreamErrors: unknown[] = []
    const feed = (): YimengProductionUnitsResponse => ({
      schema: 'jason.qingmu-production-unit-feed.v1', projectId: IDS.projectId, episodeId: IDS.episodeId,
      capabilities: { canBindUnit: true },
      groups: [{ groupId: IDS.groupId, subject: SOURCE, snapshotSha256: sourceSha,
        availability: { status: 'available', reason: null } }],
      bindings: receipt === undefined ? [] : [{ binding: receipt.binding, bindingSha256: receipt.bindingSha256, currentBinding: true }],
      ...FLAGS,
    })
    upstream = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        calls.push({ method: request.method, path: url.pathname })
        expect(request.headers.authorization).toBe(`Bearer ${process.env.YIMENG_API_TOKEN ?? ''}`)
        const base = `/api/qingmu/projects/${IDS.projectId}/episodes/${IDS.episodeId}/production-units`
        let reply: unknown
        if (request.method === 'GET' && url.pathname === base) reply = feed()
        else if (request.method === 'POST' && url.pathname === `${base}/LSU07/binding`) {
          let body = ''
          for await (const chunk of request) body += String(chunk)
          const input = JSON.parse(body) as Omit<YimengBindProductionUnitRequest, 'projectId' | 'episodeId' | 'unitId'>
          expect(Object.keys(input).sort()).toEqual(['groupId', 'expectedSubjectSha256', 'expectedBindingRevision',
            'expectedBindingSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation', 'idempotencyKey'].sort())
          expect(input.expectedSubjectSha256).toBe(sourceSha)
          expect(input.expectedBindingRevision).toBe(0)
          expect(input.expectedBindingSha256).toBeNull()
          expect(input.methodProjection.subject).toEqual(SOURCE)
          expect(input.methodProjectionSha256).toBe(sha(input.methodProjection))
          expect(Object.keys(input.methodProjection.ruleBindings)).toHaveLength(9)
          submitted = { ...input, projectId: IDS.projectId, episodeId: IDS.episodeId, unitId: 'LSU07' }
          const binding = {
            ...IDS, unitId: 'LSU07', revision: 1, source: SOURCE, sourceSnapshotSha256: sourceSha,
            methodProjectionSha256: input.methodProjectionSha256, rulesSha256: input.methodProjection.rulesSha256,
            definition: input.methodProjection.definition, actorId: 'fixture-owner',
            authSessionId: createHash('sha256').update(TEST_TOKEN).digest('hex'),
            eventId: 'fixture-unit-event', changeSetId: 'fixture-unit-changeset', createdAt: '2026-08-27T12:00:00+00:00',
          }
          receipt = { schema: 'jason.qingmu-production-unit-result.v1', binding, bindingSha256: sha(binding), ...FLAGS }
          response.destroy() // Simulate committed upstream state with a lost response, not a second POST.
          return
        } else if (request.method === 'GET' && url.pathname === `${base}/LSU07/binding/command-receipt`) {
          expect(request.headers['idempotency-key']).toBe(submitted?.idempotencyKey)
          expect(url.searchParams.get('groupId')).toBe(IDS.groupId)
          expect(url.searchParams.get('expectedSubjectSha256')).toBe(sourceSha)
          expect(receipt).toBeDefined()
          reply = {
            schema: 'jason.qingmu-production-unit-recovery.v1', ...IDS, unitId: 'LSU07',
            expectedSubjectSha256: sourceSha, idempotencyKey: submitted?.idempotencyKey, found: true, result: receipt,
          }
        } else throw new Error(`unexpected external request ${request.method ?? ''} ${url.pathname}`)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(reply))
      })().catch((error: unknown) => {
        upstreamErrors.push(error)
        response.writeHead(500).end()
      })
    })
    await new Promise<void>(resolve => upstream?.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (address === null || typeof address === 'string') throw new Error('test upstream is not listening')
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    root = await mkdtemp(join(tmpdir(), 'dsh-production-unit-loader-'))
    const configPath = join(root, 'cordis.yml')
    const readName = '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-client-connection', Connection],
      [readName, Read], ['@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter', Method],
      ['@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter', Command],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-host-webserver'", "  config: { host: '127.0.0.1', port: 0 }",
      "- name: '@deepseek-ai/dsh-client-connection'",
      `- name: '${readName}'`, `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`,
      "- name: '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'", `  config: { coreRoot: ${JSON.stringify(CORE_ROOT)} }`,
      "- name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'", `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`, '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2', async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()
    const loaded = context
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const origin = `http://127.0.0.1:${String(loaded.webServer.port)}`
    let requestId = 0
    async function rpc<T>(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<T>> {
      const response = await fetch(`${origin}${channel}/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ type: 'client-request', rpcId: `unit-${String(++requestId)}`, method: endpoint, payload }),
      })
      expect(response.status).toBe(200)
      const envelope = await response.json() as { result: RpcResult<T> }
      expect(JSON.stringify(envelope)).not.toContain(TEST_TOKEN)
      expect(JSON.stringify(envelope)).not.toContain(TEST_KEY)
      return envelope.result
    }
    const ids = { projectId: IDS.projectId, episodeId: IDS.episodeId }
    expect(await rpc('/qingmu-yimeng', 'productionUnits', ids)).toEqual({ ok: true, value: feed() })
    const method = await rpc<ImagoProductionUnitMethodResponse>('/qingmu-imago-method', 'productionUnitMethod', IDS)
    if (!method.ok) throw new Error(method.error.message)
    expect(method.value.projection.subject).toEqual(SOURCE)
    expect(method.value.projection.definition.planSealingAllowed).toBe(false)
    expect(calls).toHaveLength(3) // UI read plus two independently fetched method snapshots.
    const request: YimengBindProductionUnitRequest = {
      ...IDS, unitId: 'LSU07', expectedSubjectSha256: sourceSha, expectedBindingRevision: 0, expectedBindingSha256: null,
      idempotencyKey: 'loader-unit-bind-001', methodProjection: method.value.projection,
      methodProjectionSha256: method.value.projectionSha256, methodAttestation: method.value.methodAttestation,
    }
    expect(await rpc('/qingmu-yimeng-command', 'bindProductionUnit', request)).toMatchObject({ ok: false })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    vi.stubEnv('YIMENG_API_TOKEN', 'rotated-loader-token')
    const recovered = await rpc<YimengProductionUnitRecovery>('/qingmu-yimeng-command', 'recoverProductionUnitBinding', {
      ...IDS, unitId: 'LSU07', expectedSubjectSha256: sourceSha, idempotencyKey: request.idempotencyKey,
    })
    expect(recovered).toMatchObject({ ok: true, value: { found: true, result: receipt } })
    expect(await rpc('/qingmu-yimeng', 'productionUnits', ids)).toEqual({ ok: true, value: feed() })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_KEY)
    const readEntry = [...loaded.loader.entries()].find(entry => entry.options.name === readName)
    if (readEntry === undefined) throw new Error('read plugin entry missing')
    await loaded.loader.update(readEntry.id, { disabled: true })
    await loaded.loader.await()
    expect(loaded.get('qingmuYimengRead')).toBeUndefined()
    const previousCount = calls.length
    expect(await rpc('/qingmu-imago-method', 'productionUnitMethod', IDS)).toMatchObject({ ok: false })
    expect(calls).toHaveLength(previousCount)
    await loaded.loader.update(readEntry.id, { disabled: false })
    await loaded.loader.await()
    expect(loaded.get('qingmuYimengRead')).toBeTypeOf('function')
    expect(await rpc('/qingmu-imago-method', 'productionUnitMethod', IDS)).toMatchObject({ ok: true })
    expect(upstreamErrors).toEqual([])
  })
