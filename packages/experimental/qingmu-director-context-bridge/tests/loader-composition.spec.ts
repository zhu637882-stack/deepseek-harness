import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as DirectorContextBridgePlugin from '../src/index.ts'

let root: string | undefined
let runtimeRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
  for (const path of [root, runtimeRoot]) {
    if (path !== undefined) await rm(path, { recursive: true, force: true })
  }
  root = undefined
  runtimeRoot = undefined
})

async function loadYaml(withWebServer = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'qingmu-director-context-loader-'))
  const configPath = join(root, 'cordis.yml')
  const plugins = withWebServer
    ? ["- name: '@deepseek-ai/dsh-host-webserver'", "  config: { host: '127.0.0.1', port: 0 }"] : []
  await writeFile(configPath, [
    ...plugins,
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge'",
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-experimental-qingmu-director-context-bridge', DirectorContextBridgePlugin],
  ])
  if (withWebServer) modules.set('@deepseek-ai/dsh-host-webserver', WebServer)
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the projection plugin and serves the future UI mount value', async () => {
    const loaded = await loadYaml()
    const session = loaded.sessions.create(SessionId('composed-director-context'))
    session.append('qingmu-director-context/state', {
      version: 1,
      binding: {
        scope: { projectId: 'p', episodeId: 'e', sceneId: 's', shotId: 'h' },
        contextSnapshotSha256: 'a'.repeat(64),
      },
      proposal: null,
      transition: 'enter',
    })

    expect(loaded.sessionProjections.snapshot(session).values.qingmuDirectorContext)
      .toMatchObject({ binding: { scope: { projectId: 'p', sceneId: 's', shotId: 'h' } } })
    session.append('qingmu-director-context/state', null)
    expect(loaded.sessionProjections.snapshot(session).values.qingmuDirectorContext).toBeNull()
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    expect('default' in DirectorContextBridgePlugin).toBe(false)
  })
})

describe('capsule review routes on a real Host web server', () => {
  it('mounts both routes from the plugin and promotes one ticked capsule', async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'qingmu-capsule-runtime-'))
    vi.stubEnv('QINGMU_RUNTIME_ROOT', runtimeRoot)
    const queuePath = join(runtimeRoot, 'experience-capsule-queue.json')
    const activePath = join(runtimeRoot, 'experience-capsules-active.json')
    await writeFile(queuePath, JSON.stringify([
      { id: 'SELF-01', symptom: '镜头穿帮', rule: '先核对场景陈设', submittedAt: '2026-09-16T00:00:00Z' },
      { id: 'SELF-02', symptom: '', rule: '静音锁写双唇闭合' },
    ]))
    await writeFile(activePath, JSON.stringify({ capsules: [{ id: 'EXP-01', symptom: '', rule: '既有规则' }] }))

    const loaded = await loadYaml(true)
    const base = `http://127.0.0.1:${String(loaded.webServer.port)}`
    const review = await fetch(`${base}/api/qingmu/experience-capsule-review`, { headers: { origin: base } })
    expect(review.status).toBe(200)
    expect(await review.json()).toMatchObject({
      schema: 'qingmu-experience-capsule-review-v1',
      queue: [{ id: 'SELF-01', alreadyApproved: false }, { id: 'SELF-02', alreadyApproved: false }],
      active: [{ id: 'EXP-01', injected: true }],
    })

    const promoted = await fetch(`${base}/api/qingmu/experience-capsule-review/promote`, {
      method: 'POST',
      headers: { origin: base, cookie: 'jason_token=human-cookie', 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, ids: ['SELF-01'] }),
    })
    expect(promoted.status).toBe(200)
    expect(await promoted.json()).toMatchObject({
      promoted: ['SELF-01'], queue: [{ id: 'SELF-02' }], active: [{ id: 'SELF-01' }, { id: 'EXP-01' }],
    })
    expect(JSON.parse(await readFile(activePath, 'utf8'))).toEqual({
      capsules: [
        { id: 'SELF-01', symptom: '镜头穿帮', rule: '先核对场景陈设' },
        { id: 'EXP-01', symptom: '', rule: '既有规则' },
      ],
    })
    expect(JSON.parse(await readFile(queuePath, 'utf8'))).toEqual([
      { id: 'SELF-02', symptom: '', rule: '静音锁写双唇闭合' },
    ])
  })
})
