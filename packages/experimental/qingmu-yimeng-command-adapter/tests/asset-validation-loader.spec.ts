/** Exercises the browser RPC through Loader; only the upstream asset API is a fixture. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Read from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter'
import { expect, it, vi } from 'vitest'
import * as Command from '../src/index.ts'

it('returns the actionable asset quotation rejection through the loaded browser command', async () => {
  const token = 'asset-validation-fixture-token'
  vi.stubEnv('YIMENG_API_TOKEN', token)
  const calls: string[] = []
  const upstream = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`)
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
    const response = await fetch(`${origin}/qingmu-yimeng-command/quoteAssetImage`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId: 'asset-quote-1', method: 'quoteAssetImage',
        payload: { projectId: 'project_fixture', episodeId: 'episode_fixture', entityId: 'scene_fixture' } }),
    })
    expect(response.status).toBe(200)
    const envelope: unknown = await response.json()
    expect(envelope).toMatchObject({ result: { ok: false, error: {
      message: 'Yimeng rejected command (HTTP 422: 当前模型不支持框选参数，请移除框选或改选支持框选的模型；原图和指令仍保留。)',
    } } })
    expect(envelope).toMatchSnapshot()
    expect(JSON.stringify(envelope)).not.toContain(token)
    expect(calls).toEqual(['GET /api/qingmu/projects/project_fixture/episodes/episode_fixture/asset-design/scene_fixture/quote'])
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
