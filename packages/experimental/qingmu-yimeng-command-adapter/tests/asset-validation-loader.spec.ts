/** Exercises the browser RPC through Loader; only the upstream asset API is a fixture. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Read from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import { expect, it, vi } from 'vitest'
import * as Command from '../src/index.ts'

it.each(['asset', 'planning'])('retains complete %s behavior through the loaded browser command', async (kind) => {
  const token = 'asset-validation-fixture-token'
  vi.stubEnv('YIMENG_API_TOKEN', token)
  const calls: string[] = []
  const received: unknown[] = []
  const upstream = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`)
    if (kind === 'planning') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { idempotencyKey: string; request: { shots: unknown[] } }
        received.push(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          projectId: 'project_fixture', episodeId: 'episode_fixture', schema: 'jason.qingmu-scene-planning-result.v1',
          action: 'initialize', idempotencyKey: body.idempotencyKey,
          requestSha256: createHash('sha256').update(JSON.stringify(body.request)).digest('hex'),
          commandReceiptId: 'receipt_fixture', eventId: 'event_fixture', sceneId: 'scene_fixture', seriesId: 'series_fixture',
          shotIds: body.request.shots.map((_, index) => `shot_${String(index + 1)}`), actorIds: {},
          source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), sourceLineIds: [] },
          storyboard: { id: 'revision_fixture', version: 1, sourceHash: 'c'.repeat(64), status: 'Ready' },
          providerCalls: 0, stageStarted: false, approvalGranted: false,
        }))
      })
      return
    }
    response.writeHead(422, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ detail: '当前模型不支持框选参数，请移除框选或改选支持框选的模型；原图和指令仍保留。' }))
  })
  const root = await mkdtemp(join(tmpdir(), 'qingmu-asset-validation-'))
  const context = new Context()
  try {
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture is not listening')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const modules = new Map<string, unknown>([
      ['web', WebServer], ['connection', Connection], ['read', Read], ['command', Command],
    ])
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: web', "  config: { host: '127.0.0.1', port: 0 }", '- name: connection',
      '- name: read', `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`,
      '- name: command', `  config: { baseUrl: ${JSON.stringify(baseUrl)} }`, '',
    ].join('\n'))
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2', async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected fixture module: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()
    const origin = `http://127.0.0.1:${context.webServer.port}`
    const method = kind === 'asset' ? 'quoteAssetImage' : 'saveScenePlanning'
    const scope = { projectId: 'project_fixture', episodeId: 'episode_fixture' }
    const payload = kind === 'asset' ? { ...scope, entityId: 'scene_fixture' } : {
      ...scope, idempotencyKey: 'planning-fixture', request: { action: 'initialize', sceneIndex: 1,
        expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 0, expectedStoryboardSha256: null,
        shots: Array.from({ length: 23 }, (_, index) => ({ title: `镜头${String(index + 1)}`, narrative: '', visual: '', action: '',
          durationSec: 6, dialogueLineIds: [], directorPlan: { generationContext: '完整空间、表演与声音设计。'.repeat(150) } })),
      },
    }
    const response = await fetch(`${origin}/qingmu-yimeng-command/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId: 'asset-quote-1', method, payload }),
    })
    expect(response.status).toBe(200)
    const envelope: unknown = await response.json()
    if (kind === 'planning') {
      if (!('request' in payload)) throw new Error('missing planning fixture')
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(98304)
      expect(received).toEqual([{ idempotencyKey: payload.idempotencyKey, request: payload.request }])
      expect(envelope).toMatchObject({ result: { ok: true, value: { shotIds: Array.from({ length: 23 }, (_, i) => `shot_${String(i + 1)}`) } } })
      expect(calls).toEqual(['POST /api/qingmu/projects/project_fixture/episodes/episode_fixture/scene-planning/commands'])
    } else {
      expect(envelope).toMatchObject({ result: { ok: false, error: {
        message: 'Yimeng rejected command (HTTP 422: 当前模型不支持框选参数，请移除框选或改选支持框选的模型；原图和指令仍保留。)',
      } } })
      expect(calls).toEqual(['GET /api/qingmu/projects/project_fixture/episodes/episode_fixture/asset-design/scene_fixture/quote'])
    }
    expect(envelope).toMatchSnapshot()
    expect(JSON.stringify(envelope)).not.toContain(token)
  } finally {
    await context.fiber.dispose()
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => { if (error) reject(error); else resolve() })
      upstream.closeAllConnections()
    })
    await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  }
})
