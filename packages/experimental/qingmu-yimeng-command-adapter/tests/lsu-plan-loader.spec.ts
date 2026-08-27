/** Real Loader, Connection, read adapter, Method subprocess and current Core; only Yimeng HTTP is doubled. */
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
import * as Method from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
import type { ImagoLsuPlanMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Read from '../../qingmu-yimeng-read-adapter/src/index.ts'
import { continuityJson } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import {
  LSU_PLAN_IDS, lsuPlanFeed, lsuPlanSha, lsuPlanSubject,
} from '../../qingmu-yimeng-read-adapter/tests/lsu-plan-fixture.ts'
import { LSU_PLAN_RULE_PATHS } from '../../qingmu-imago-method-adapter/src/lsu-plan.ts'
import * as Command from '../src/index.ts'
import type {
  YimengForwardedLsuPlanAuthorityProbeRequest,
  YimengImagoLsuPlanMethodAttestation,
  YimengImagoLsuPlanMethodProjection,
  YimengLsuPlanAuthorityProbe,
  YimengLsuPlanSealResult,
  YimengSealLsuPlanRequest,
} from '../src/types.ts'
import {
  lsuPlanAuthorityProbe, lsuPlanCommandResult, lsuPlanRecovery,
} from './lsu-plan-fixture.ts'
import { afterEach, expect, it, vi } from 'vitest'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'lsu-plan-loader-test-key-'.repeat(3)
const TOKEN = 'lsu-plan-loader-token'
let root: string | undefined
let context: Context | undefined
let upstream: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  const server = upstream
  upstream = undefined
  if (server !== undefined) await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    server.closeAllConnections()
  })
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

it.skipIf(!CORE_ROOT)(
  'composes one current seal, GET-only lost-response recovery, and a fresh authority probe',
  { timeout: 60_000 },
  async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    vi.stubEnv('YIMENG_API_TOKEN', TOKEN)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    const subject = lsuPlanSubject()
    const sealRequest: YimengSealLsuPlanRequest = {
      ...LSU_PLAN_IDS,
      expectedSubjectSha256: lsuPlanSha(subject),
      expectedPlanRevision: 0,
      expectedPlanSha256: null,
      idempotencyKey: 'lsu-plan-loader-001',
    }
    let receipt: YimengLsuPlanSealResult | undefined
    let forwardedProbe: YimengForwardedLsuPlanAuthorityProbeRequest | undefined
    const calls: Array<{ method: string | undefined; path: string }> = []
    const errors: unknown[] = []
    const base = `/api/qingmu/projects/${LSU_PLAN_IDS.projectId}/episodes/${LSU_PLAN_IDS.episodeId}/lsu-plan`
    upstream = createServer((incoming, response) => {
      void (async () => {
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
        calls.push({ method: incoming.method, path: url.pathname })
        expect(incoming.headers.authorization).toBe(`Bearer ${process.env.YIMENG_API_TOKEN ?? ''}`)
        if (incoming.method === 'GET' && url.pathname === `${base}/source`) {
          const lockRulesSha256 = url.searchParams.get('lockRulesSha256')
          if (lockRulesSha256 === null) throw new Error('lock rule digest required')
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
          response.end(JSON.stringify(lsuPlanFeed(lockRulesSha256)))
          return
        }
        if (incoming.method === 'POST' && url.pathname === `${base}/seals`) {
          let raw = ''
          for await (const chunk of incoming) raw += String(chunk)
          const body = JSON.parse(raw) as {
            expectedSubjectSha256: string
            expectedPlanRevision: number
            expectedPlanSha256: string | null
            methodProjection: YimengImagoLsuPlanMethodProjection
            methodProjectionSha256: string
            methodAttestation: YimengImagoLsuPlanMethodAttestation
            idempotencyKey: string
          }
          expect(Object.keys(body).sort()).toEqual([
            'expectedSubjectSha256', 'expectedPlanRevision', 'expectedPlanSha256', 'methodProjection',
            'methodProjectionSha256', 'methodAttestation', 'idempotencyKey',
          ].sort())
          expect(body).not.toHaveProperty('actorId')
          expect(body).not.toHaveProperty('actorNaturalPersonId')
          expect(body).not.toHaveProperty('authSessionId')
          expect(body.expectedSubjectSha256).toBe(lsuPlanSha(body.methodProjection.subject))
          expect(body.methodProjectionSha256).toBe(lsuPlanSha(body.methodProjection))
          expect(Object.keys(body.methodProjection.ruleBindings).sort()).toEqual([...LSU_PLAN_RULE_PATHS].sort())
          for (const path of LSU_PLAN_RULE_PATHS) {
            expect(body.methodProjection.ruleBindings[path]).toBe(
              createHash('sha256').update(await readFile(join(CORE_ROOT, path))).digest('hex'),
            )
          }
          expect(body.methodProjection.rulesSha256).toBe(lsuPlanSha(body.methodProjection.ruleBindings))
          expect(body.methodProjection.lockRulesSha256).toBe(lsuPlanSha(body.methodProjection.lockRuleBindings))
          expect(body.methodProjection.definition).toMatchObject({
            declarationPolicy: 'exact_current_instantiated_units', planSealingAllowed: true,
            stageApprovalAllowed: false, lockActivationAllowed: false, reworkExecutionAllowed: false,
            providerCalls: 0,
          })
          const { signature, ...unsigned } = body.methodAttestation
          expect(signature).toBe(createHmac('sha256', KEY).update(continuityJson(unsigned), 'utf8').digest('hex'))
          const request = {
            ...LSU_PLAN_IDS,
            expectedSubjectSha256: body.expectedSubjectSha256,
            expectedPlanRevision: body.expectedPlanRevision,
            expectedPlanSha256: body.expectedPlanSha256,
            idempotencyKey: body.idempotencyKey,
          }
          const method: ImagoLsuPlanMethodResponse = {
            schema: 'qingmu.imago-lsu-plan-method-adapter-result.v1',
            projection: body.methodProjection,
            projectionSha256: body.methodProjectionSha256,
            methodAttestation: body.methodAttestation,
          }
          receipt = lsuPlanCommandResult(request, method, TOKEN)
          response.destroy()
          return
        }
        if (incoming.method === 'GET' && url.pathname === `${base}/seal-command-receipt`) {
          expect(incoming.headers['idempotency-key']).toBe(sealRequest.idempotencyKey)
          expect(url.searchParams.get('expectedSubjectSha256')).toBe(sealRequest.expectedSubjectSha256)
          expect(url.searchParams.get('expectedPlanRevision')).toBe('0')
          expect(url.searchParams.has('expectedPlanSha256')).toBe(false)
          if (receipt === undefined) throw new Error('durable seal receipt required')
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
          response.end(JSON.stringify(lsuPlanRecovery(sealRequest, receipt)))
          return
        }
        if (incoming.method === 'POST' && url.pathname === `${base}/authority-probe`) {
          let raw = ''
          for await (const chunk of incoming) raw += String(chunk)
          const body = JSON.parse(raw) as {
            methodProjection: YimengImagoLsuPlanMethodProjection
            methodProjectionSha256: string
            methodAttestation: YimengImagoLsuPlanMethodAttestation
          }
          expect(Object.keys(body).sort()).toEqual([
            'methodProjection', 'methodProjectionSha256', 'methodAttestation',
          ].sort())
          expect(body).not.toHaveProperty('idempotencyKey')
          expect(body).not.toHaveProperty('actorNaturalPersonId')
          forwardedProbe = {
            ...LSU_PLAN_IDS,
            methodProjection: body.methodProjection,
            methodProjectionSha256: body.methodProjectionSha256,
            methodAttestation: body.methodAttestation,
          }
          if (receipt === undefined) throw new Error('seal receipt required before authority probe')
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
          response.end(JSON.stringify(lsuPlanAuthorityProbe(forwardedProbe, receipt)))
          return
        }
        throw new Error(`unexpected request ${incoming.method ?? ''} ${url.pathname}`)
      })().catch((error: unknown) => {
        errors.push(error)
        response.writeHead(500).end()
      })
    })
    await new Promise<void>(resolve => upstream?.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (address === null || typeof address === 'string') throw new Error('test HTTP listener required')
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    root = await mkdtemp(join(tmpdir(), 'qingmu-lsu-plan-loader-'))
    const configPath = join(root, 'cordis.yml')
    const readName = '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
    const methodName = '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
    const commandName = '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', WebServer],
      ['@deepseek-ai/dsh-client-connection', Connection],
      [readName, Read],
      [methodName, Method],
      [commandName, Command],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-host-webserver'",
      "  config: { host: '127.0.0.1', port: 0 }",
      "- name: '@deepseek-ai/dsh-client-connection'",
      `- name: '${readName}'`,
      `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`,
      `- name: '${methodName}'`,
      `  config: { coreRoot: ${JSON.stringify(CORE_ROOT)} }`,
      `- name: '${commandName}'`,
      `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`,
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()
    const loaded = context
    expect([...loaded.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(typeof loaded.get('qingmuYimengRead')).toBe('function')
    expect(typeof loaded.get('qingmuImagoMethod')).toBe('function')
    const origin = `http://127.0.0.1:${String(loaded.webServer.port)}`
    let rpcId = 0
    async function rpc<T>(endpoint: string, payload: unknown): Promise<RpcResult<T>> {
      const response = await fetch(`${origin}/qingmu-yimeng-command/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          type: 'client-request', rpcId: `lsu-plan-${String(++rpcId)}`, method: endpoint, payload,
        }),
      })
      expect(response.status).toBe(200)
      const envelope = await response.json() as { result: RpcResult<T> }
      expect(JSON.stringify(envelope)).not.toContain(TOKEN)
      expect(JSON.stringify(envelope)).not.toContain(KEY)
      return envelope.result
    }

    expect(await rpc('sealLsuPlan', sealRequest)).toMatchObject({ ok: false })
    expect(calls.filter(call => call.method === 'GET' && call.path === `${base}/source`)).toHaveLength(2)
    expect(calls.filter(call => call.method === 'POST' && call.path === `${base}/seals`)).toHaveLength(1)
    if (receipt === undefined) throw new Error('lost-response seal receipt required')

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    vi.stubEnv('YIMENG_API_TOKEN', 'lsu-plan-loader-rotated-token')
    const methodEntry = [...loaded.loader.entries()].find(item => item.options.name === methodName)
    if (methodEntry === undefined) throw new Error('Method plugin not loaded')
    await loaded.loader.update(methodEntry.id, { disabled: true })
    await loaded.loader.await()
    expect(loaded.get('qingmuImagoMethod')).toBeUndefined()
    const beforeRecovery = calls.length
    expect(await rpc<YimengLsuPlanSealResult>('recoverLsuPlanSeal', sealRequest)).toEqual({
      ok: true, value: lsuPlanRecovery(sealRequest, receipt),
    })
    expect(calls).toHaveLength(beforeRecovery + 1)
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    await loaded.loader.update(methodEntry.id, { disabled: false })
    await loaded.loader.await()
    expect(typeof loaded.get('qingmuImagoMethod')).toBe('function')
    const authority = await rpc<YimengLsuPlanAuthorityProbe>('probeLsuPlanAuthority', LSU_PLAN_IDS)
    expect(authority).toMatchObject({
      ok: true,
      value: {
        currentPlanSealed: true, planSealed: true, stageApprovalGranted: false,
        lockActivated: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
      },
    })
    expect(forwardedProbe).toBeDefined()
    expect(calls.filter(call => call.method === 'GET' && call.path === `${base}/source`)).toHaveLength(4)
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(2)
    expect(errors).toEqual([])
  },
)
