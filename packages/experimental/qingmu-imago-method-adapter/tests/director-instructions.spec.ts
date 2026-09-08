import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, createImagoMethodHandler } from '../src/index.ts'
import {
  loadDirectorInstructions,
  parseDirectorInstructionsRequest,
} from '../src/director-instructions.ts'

const roots: string[] = []
const C_PATHS = [
  'skill-package/imago-c-director-development/SKILL.md',
  'skill-package/imago-c-director-development/references/director-evidence-standard.md',
  'skill-package/imago-c-director-development/references/scene-performance-blocking-method.md',
  'skill-package/imago-c-director-development/references/coverage-media-review-method.md',
] as const
const C5_PATHS = [
  'skill-package/imago-c5-execution-storyboard/SKILL.md',
  'skill-package/imago-c5-execution-storyboard/references/execution-closure-standard.md',
  'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
  'skill-package/imago-c5-execution-storyboard/references/director-storyboard-production-loop.md',
] as const
const C5_ADDITIONAL_PATH = 'skill-package/imago-c5-execution-storyboard/references/rough-final-feedback-closure-method.md'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true })
  }))
})

async function coreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-director-instructions-'))
  roots.push(root)
  for (const path of [...C_PATHS, ...C5_PATHS, C5_ADDITIONAL_PATH]) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), `# ${path}\n\ncomplete method source\n`, 'utf8')
  }
  return root
}

describe('director instructions method', () => {
  it('loads the complete fixed C Skill package with all direct-reference provenance', async () => {
    const root = await coreRoot()
    const response = await loadDirectorInstructions(root, { capability: 'director_development' }, new AbortController().signal)
    expect(response).toMatchObject({
      schema: 'qingmu.imago-director-instructions.v1',
      capability: 'director_development',
      authority: { readOnly: true, approvalGranted: false, providerCalls: 0, projectStateWrite: false },
    })
    expect(response.sourceBindings).toHaveLength(4)
    const skillSource = response.sources[0]
    expect(skillSource).toBeDefined()
    if (skillSource === undefined) throw new Error('expected Skill source')
    expect(skillSource.resourceId).toBe('skill')
    expect(skillSource.path).toBe(C_PATHS[0])
    expect(skillSource.content).toContain('complete method source')
    expect(response.additionalReferences).toEqual([])
    expect(skillSource.sha256).toBe(createHash('sha256').update(skillSource.content, 'utf8').digest('hex'))
    expect(response.packageSha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps C5 reference selection explicit and includes the director-to-production loop', async () => {
    const root = await coreRoot()
    const response = await loadDirectorInstructions(root, { capability: 'shot_design' }, new AbortController().signal)
    expect(response.sources[3]).toMatchObject({ resourceId: 'director_storyboard_production_loop', path: C5_PATHS[3] })
    expect(response.sourceBindings).toHaveLength(5)
    expect(response.additionalReferences).toEqual([
      { resourceId: 'rough_final_feedback', path: C5_ADDITIONAL_PATH, required: true },
    ])
    expect(response.methodScope).toContain('generation-risk routing')
  })

  it('rejects caller paths, scopes, and unbounded payloads', () => {
    for (const payload of [
      null, {}, { capability: 1 },
      { capability: 'director_development', coreRoot: '/other' },
      { capability: 'shot_design', resourceId: '../SKILL.md' },
      { capability: 'director_development', resourceId: 'rough_final_feedback' },
      { capability: 'other' },
    ]) expect(() => parseDirectorInstructionsRequest(payload)).toThrow()
  })

  it('serves the required C5 feedback reference only through its fixed optional identifier', async () => {
    const response = await loadDirectorInstructions(await coreRoot(), {
      capability: 'shot_design', resourceId: 'rough_final_feedback',
    }, new AbortController().signal)
    expect(response.requestedResourceId).toBe('rough_final_feedback')
    expect(response.sources).toHaveLength(1)
    expect(response.sources[0]).toMatchObject({ resourceId: 'rough_final_feedback', path: C5_ADDITIONAL_PATH })
    expect(response.sourceBindings).toHaveLength(5)
  })

  it('fails rather than truncating an oversized fixed source', async () => {
    const root = await coreRoot()
    await writeFile(join(root, C_PATHS[0]), 'x'.repeat(128 * 1024 + 1), 'utf8')
    await expect(loadDirectorInstructions(root, { capability: 'director_development' }, new AbortController().signal)).rejects.toThrow('source exceeds')
  })

  it('rejects a fixed source that resolves through a symlink outside the configured Core root', async () => {
    const root = await coreRoot()
    const outside = await mkdtemp(join(tmpdir(), 'qingmu-director-instructions-outside-'))
    roots.push(outside)
    const outsideSource = join(outside, 'outside-skill.md')
    await writeFile(outsideSource, 'outside Core root', 'utf8')
    await rm(join(root, C_PATHS[0]))
    await symlink(outsideSource, join(root, C_PATHS[0]))
    await expect(loadDirectorInstructions(root, { capability: 'director_development' }, new AbortController().signal))
      .rejects.toThrow('resolves outside Core root')
  })

  it('rejects a malformed UTF-8 fixed source instead of replacing bytes', async () => {
    const root = await coreRoot()
    await writeFile(join(root, C_PATHS[0]), Buffer.from([0xc3, 0x28]))
    await expect(loadDirectorInstructions(root, { capability: 'director_development' }, new AbortController().signal))
      .rejects.toThrow('source is not UTF-8')
  })

  it('exposes only the Host endpoint and observes pre-read cancellation', async () => {
    const handler = createImagoMethodHandler({ coreRoot: await coreRoot() })
    const request = { capability: 'director_development' }
    const result = await handler('directorInstructions', request, new AbortController().signal)
    expect(result.ok).toBe(true)
    const controller = new AbortController()
    controller.abort()
    await expect(handler('directorInstructions', request, controller.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('keeps director instructions off the browser loopback handler', async () => {
    const handle = vi.fn((_channel: string, _handler: ConnectionRpcHandler, _options: ConnectionRpcHandlerOptions) => async () => {})
    const provide = vi.fn()
    apply({ provide, connection: { rpc: { handle } } } as unknown as Context, { coreRoot: await coreRoot() })
    const host = provide.mock.calls[0]?.[1] as ConnectionRpcHandler
    const browser = handle.mock.calls[0]?.[1] as ConnectionRpcHandler
    const request = { capability: 'shot_design' }
    await expect(host('directorInstructions', request, new AbortController().signal)).resolves.toMatchObject({ ok: true })
    await expect(browser('directorInstructions', request, new AbortController().signal)).resolves.toMatchObject({
      ok: false, error: { message: 'Requested IMAGO Method is Host-internal' },
    })
  })
})
