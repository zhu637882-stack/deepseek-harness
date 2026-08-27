/** Real Loader, Connection, Method subprocess and current Core; only Yimeng HTTP is doubled. */
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
import * as Method from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
import type { ImagoStageArtifactMethodResponse } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/types'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, expect, it, vi } from 'vitest'
import { mutateSource, sourceCanonical, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { STAGE_ARTIFACT_RULE_PATHS } from '../../qingmu-imago-method-adapter/src/stage-artifact.ts'
import * as Command from '../src/index.ts'
import type { YimengRegisterStageArtifactRequest, YimengStageArtifactResult } from '../src/types.ts'
import {
  STAGE_ARTIFACT_IDS,
  stageArtifact,
  stageArtifactResult,
  stageArtifactSha,
} from './stage-artifact-fixture.ts'

const CORE_ROOT = process.env.IMAGO_OS_CORE_ROOT
const KEY = 'stage-artifact-loader-test-key-'.repeat(2)
const TOKEN = 'stage-artifact-loader-token'
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
  'composes real Core validation, one lost registration POST, and original GET-only recovery after key/session change',
  { timeout: 60_000 },
  async () => {
    if (CORE_ROOT === undefined || CORE_ROOT === '') throw new Error('current Core root required')
    vi.stubEnv('YIMENG_API_TOKEN', TOKEN)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    const artifact = stageArtifact()
    let submitted: YimengRegisterStageArtifactRequest | undefined
    let receipt: YimengStageArtifactResult | undefined
    const calls: Array<{ method: string | undefined; path: string }> = []
    const errors: unknown[] = []
    upstream = createServer((incoming, response) => {
      void (async () => {
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
        calls.push({ method: incoming.method, path: url.pathname })
        expect(incoming.headers.authorization).toBe(`Bearer ${process.env.YIMENG_API_TOKEN ?? ''}`)
        const base = `/api/qingmu/projects/${STAGE_ARTIFACT_IDS.projectId}/episodes/`
          + `${STAGE_ARTIFACT_IDS.episodeId}/stage-artifacts/A0/GLOBAL`
        if (incoming.method === 'POST' && url.pathname === base) {
          let raw = ''
          for await (const chunk of incoming) raw += String(chunk)
          const body = JSON.parse(raw) as Omit<YimengRegisterStageArtifactRequest,
            'projectId' | 'episodeId' | 'stageId' | 'scopeInstance'>
          expect(Object.keys(body).sort()).toEqual([
            'artifact',
            'expectedSubjectSha256',
            'expectedArtifactRecordRevision',
            'expectedArtifactRecordSha256',
            'methodProjection',
            'methodProjectionSha256',
            'methodAttestation',
            'idempotencyKey',
          ].sort())
          expect(body.artifact).toEqual(artifact)
          expect(body.expectedArtifactRecordRevision).toBe(0)
          expect(body.expectedArtifactRecordSha256).toBeNull()
          expect(body.expectedSubjectSha256).toBe(sourceSha(body.methodProjection.subject))
          expect(body.methodProjection.subject.artifactSha256).toBe(stageArtifactSha(artifact))
          expect(body.methodProjectionSha256).toBe(sourceSha(body.methodProjection))
          expect(Object.keys(body.methodProjection.ruleBindings).sort()).toEqual([...STAGE_ARTIFACT_RULE_PATHS].sort())
          for (const path of STAGE_ARTIFACT_RULE_PATHS) {
            expect(body.methodProjection.ruleBindings[path]).toBe(
              createHash('sha256').update(await readFile(join(CORE_ROOT, path))).digest('hex'),
            )
          }
          expect(body.methodProjection.rulesSha256).toBe(sourceSha(body.methodProjection.ruleBindings))
          expect(body.methodProjection.definition).toMatchObject({
            stageArtifactRegistrationAllowed: true,
            dependencyAuthorityVerified: false,
            stageApprovalAllowed: false,
            lockActivationAllowed: false,
            lsuPlanSealingAllowed: false,
            reworkExecutionAllowed: false,
            providerCalls: 0,
          })
          const { signature, ...unsigned } = body.methodAttestation
          expect(signature).toBe(createHmac('sha256', KEY).update(sourceCanonical(unsigned)).digest('hex'))
          submitted = { ...body, ...STAGE_ARTIFACT_IDS }
          receipt = stageArtifactResult(submitted, TOKEN)
          response.destroy()
          return
        }
        if (incoming.method === 'GET' && url.pathname === `${base}/command-receipt`) {
          expect(incoming.headers['idempotency-key']).toBe(submitted?.idempotencyKey)
          expect(url.searchParams.get('expectedSubjectSha256')).toBe(submitted?.expectedSubjectSha256)
          if (receipt === undefined) throw new Error('durable receipt required before recovery')
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
          response.end(JSON.stringify({ schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }))
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
    root = await mkdtemp(join(tmpdir(), 'qingmu-stage-artifact-loader-'))
    const configPath = join(root, 'cordis.yml')
    const methodName = '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', WebServer],
      ['@deepseek-ai/dsh-client-connection', Connection],
      [methodName, Method],
      ['@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter', Command],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-host-webserver'",
      "  config: { host: '127.0.0.1', port: 0 }",
      "- name: '@deepseek-ai/dsh-client-connection'",
      `- name: '${methodName}'`,
      `  config: { coreRoot: ${JSON.stringify(CORE_ROOT)} }`,
      "- name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter'",
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
    const origin = `http://127.0.0.1:${String(loaded.webServer.port)}`
    let rpcId = 0
    async function rpc<T>(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<T>> {
      const response = await fetch(`${origin}${channel}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ type: 'client-request', rpcId: `artifact-${String(++rpcId)}`, method: endpoint, payload }),
      })
      expect(response.status).toBe(200)
      const envelope = await response.json() as { result: RpcResult<T> }
      expect(JSON.stringify(envelope)).not.toContain(TOKEN)
      expect(JSON.stringify(envelope)).not.toContain(KEY)
      return envelope.result
    }

    const method = await rpc<ImagoStageArtifactMethodResponse>(
      '/qingmu-imago-method', 'stageArtifactMethod', { ...STAGE_ARTIFACT_IDS, artifact },
    )
    if (!method.ok) throw new Error(method.error.message)
    const registration: YimengRegisterStageArtifactRequest = {
      ...STAGE_ARTIFACT_IDS,
      artifact,
      expectedSubjectSha256: method.value.projection.subjectSnapshotSha256,
      expectedArtifactRecordRevision: 0,
      expectedArtifactRecordSha256: null,
      idempotencyKey: 'stage-artifact-loader-001',
      methodProjection: method.value.projection,
      methodProjectionSha256: method.value.projectionSha256,
      methodAttestation: method.value.methodAttestation,
    }
    expect(await rpc('/qingmu-yimeng-command', 'registerStageArtifact', registration)).toMatchObject({ ok: false })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    vi.stubEnv('YIMENG_API_TOKEN', 'stage-artifact-loader-rotated-token')
    const entry = [...loaded.loader.entries()].find(item => item.options.name === methodName)
    if (entry === undefined) throw new Error('method plugin not loaded')
    await loaded.loader.update(entry.id, { disabled: true })
    await loaded.loader.await()
    expect(loaded.get('qingmuImagoMethod')).toBeUndefined()
    const callCount = calls.length
    const disabledMethod = await fetch(`${origin}/qingmu-imago-method/stageArtifactMethod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `artifact-${String(++rpcId)}`,
        method: 'stageArtifactMethod',
        payload: { ...STAGE_ARTIFACT_IDS, artifact },
      }),
    })
    expect(disabledMethod.status).toBe(404)
    expect(calls).toHaveLength(callCount)
    expect(await rpc('/qingmu-yimeng-command', 'recoverStageArtifactRegistration', {
      ...STAGE_ARTIFACT_IDS,
      expectedSubjectSha256: registration.expectedSubjectSha256,
      idempotencyKey: registration.idempotencyKey,
    })).toEqual({
      ok: true,
      value: { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt },
    })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)

    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY)
    await loaded.loader.update(entry.id, { disabled: false })
    await loaded.loader.await()
    expect(await rpc('/qingmu-imago-method', 'stageArtifactMethod', { ...STAGE_ARTIFACT_IDS, artifact }))
      .toMatchObject({ ok: true })
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)

    const deepArtifact = stageArtifact()
    let deepData: unknown = 'leaf'
    for (let depth = 0; depth < 70; depth += 1) deepData = { nested: deepData }
    mutateSource(deepArtifact, 'content.source_ledger.data', deepData)
    const deepMethod = await rpc<ImagoStageArtifactMethodResponse>(
      '/qingmu-imago-method', 'stageArtifactMethod', { ...STAGE_ARTIFACT_IDS, artifact: deepArtifact },
    )
    if (!deepMethod.ok) throw new Error(deepMethod.error.message)
    const callsBeforeDeepRegistration = calls.length
    expect(await rpc('/qingmu-yimeng-command', 'registerStageArtifact', {
      ...STAGE_ARTIFACT_IDS,
      artifact: deepArtifact,
      expectedSubjectSha256: deepMethod.value.projection.subjectSnapshotSha256,
      expectedArtifactRecordRevision: 0,
      expectedArtifactRecordSha256: null,
      idempotencyKey: 'stage-artifact-loader-deep-001',
      methodProjection: deepMethod.value.projection,
      methodProjectionSha256: deepMethod.value.projectionSha256,
      methodAttestation: deepMethod.value.methodAttestation,
    })).toEqual({
      ok: false,
      error: {
        code: 'bad-request',
        message: 'payload exceeds the Yimeng JSON nesting limit',
        details: { issues: [] },
      },
    })
    expect(calls).toHaveLength(callsBeforeDeepRegistration)
    expect(errors).toEqual([])
  },
)
