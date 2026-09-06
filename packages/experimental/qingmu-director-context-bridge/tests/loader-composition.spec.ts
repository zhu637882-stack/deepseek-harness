import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as DirectorContextBridgePlugin from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'qingmu-director-context-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
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
