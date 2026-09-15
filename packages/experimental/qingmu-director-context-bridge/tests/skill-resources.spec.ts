import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import * as SkillResources from '../src/skill-resources.ts'
import { runNativeDirectorExample } from '../examples/model-tools-keyless.ts'

const dispose: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of dispose.splice(0).reverse()) await cleanup() })
const bundle = fileURLToPath(new URL('../../qingmu-web/agent-presets/qingmu-director/skills/', import.meta.url))
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
interface ResourcePage {
  skill: string
  path: string
  content: string
  sha256: string
  upstreamSha256: string
  nextLine: number | null
}

async function reader(root = bundle) {
  const ctx = new Context()
  dispose.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const session = Session.create(SessionId('creative-resource-test'))
  const agent = { id: session.id, session } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  const fiber = await scope.ctx.plugin(SkillResources, { root })
  const run = (args: object) => ctx.tools.execute({ callId: CallId('resource-read'),
    name: 'qingmu_read_skill_resource', arguments: args, agent, signal: new AbortController().signal })
  return { ctx, run, fiber }
}

it('loads full creative methods and linked engines through the shipped native preset and real loop', async () => {
  const result = await runNativeDirectorExample('skills')
  expect(result.calls).toEqual([
    'skill', 'qingmu_read_skill_resource', 'skill', 'qingmu_read_skill_resource', 'qingmu_read_skill_resource',
    'skill', 'qingmu_read_skill_resource', 'skill', 'qingmu_read_skill_resource', 'qingmu_read_skill_resource',
  ])
  expect(result.creativeMethodsInNextRequest).toEqual({
    catalog: true, director: true, dialogue: true, visual: true, engine: true, orchestration: true,
    primaryMethod: true, assetDesign: true, writing: true, camera: true, promptReconstruction: true,
  })
  const sound = JSON.parse(result.results[1]!) as ResourcePage
  expect(sound).toMatchObject({ skill: 'cinematic-director', path: 'references/sound-and-dialogue.md', nextLine: null })
  expect(sound.content).toContain('Record speaker identity, voice reference, exact words, delivery, timing')
  expect(sound.content).toContain('Preserve usable native dialogue, breaths, action Foley and ambience.')
  expect(sound.content).not.toContain('mute everything else')
  expect(sound.sha256).not.toBe(sound.upstreamSha256)
  for (const index of [3, 4, 6, 8, 9]) {
    const resource = JSON.parse(result.results[index]!) as ResourcePage
    const content = await readFile(join(bundle, resource.skill, resource.path), 'utf8')
    expect(resource.content + '\n').toBe(content)
    expect(resource.nextLine).toBeNull()
  }
  expect(result.rootTools).toEqual([])
  expect(result.ordinaryReadiness.tools).toEqual([])
  expect(result.inactiveReadiness.tools).toEqual([])
})

it('preserves source hashes for every bundled file and distinguishes Qingmu adaptations', async () => {
  const sources = JSON.parse(await readFile(join(bundle, 'sources.json'), 'utf8')) as {
    skills: Record<string, { files: Record<string, string>; upstreamFiles: Record<string, string>; adaptedFiles: string[] }>
  }
  for (const [skill, source] of Object.entries(sources.skills)) {
    for (const [path, hash] of Object.entries(source.files)) {
      expect(sha(await readFile(join(bundle, skill, path))), `${skill}/${path}`).toBe(hash)
      expect(source.upstreamFiles[path]).toMatch(/^[a-f0-9]{64}$/u)
      expect(source.adaptedFiles.includes(path)).toBe(hash !== source.upstreamFiles[path])
    }
  }
})

it('serves the genre supplement with current director authority through the native resource tool', async () => {
  const app = await reader()
  const result = await app.run({ skill: 'cinematic-director', path: 'references/genre-playbooks.md', lineCount: 30 })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({
    content: expect.stringContaining("current user instructions and the project's script and director design govern"),
    nextLine: 31,
  })
  expect(result.value).toMatchObject({ content: expect.stringContaining('not platform requirements or validation limits') })
})

it('serves visual adaptation rules without automatic creative filtering', async () => {
  const app = await reader()
  const negative = await app.run({ skill: 'ai-visual-director', path: 'rules/negative-prompt.md', lineCount: 200 })
  expect(negative.isError).toBe(false)
  expect(negative.value).toMatchObject({
    content: expect.stringContaining('正面设计与候选负面词冲突时，舍弃冲突的负面词'),
    nextLine: null,
  })
  const state = await app.run({ skill: 'ai-visual-director', path: 'state/format-contract-state.md', lineCount: 100 })
  expect(state.isError).toBe(false)
  expect(state.value).toMatchObject({
    content: expect.stringContaining('不是当前项目状态'),
    nextLine: null,
  })
})

it('keeps released director methods compatible with the installed method without rewriting history', async () => {
  const sources = JSON.parse(await readFile(join(bundle, 'sources.json'), 'utf8')) as {
    skills: Record<string, {
      files: Record<string, string>
      compatiblePredecessors?: {
        id?: string
        version: string
        sha256: string
        upgradeToSha256: string
        reason: string
      }[]
    }>
  }
  for (const [name, source] of Object.entries(sources.skills)) {
    for (const prior of source.compatiblePredecessors ?? []) {
      expect(prior.upgradeToSha256, `${name}: ${prior.version}`).toBe(source.files['SKILL.md'])
      expect(prior.reason.trim()).not.toBe('')
    }
  }
  // These released creation-time references must keep resolving after method-only updates.
  const director = sources.skills['cinematic-director']!
  const known = director.compatiblePredecessors!.map(ref => ref.sha256)
  for (const digest of ['4891f16113213518fc30627659dff67c2393cdc510214874694ab373229b0722',
    'd372e62d49c97c804c6348c052c2cd54e172606d82a13c60bf39e96651f7ecb6',
    '8a86892706f6d29859d0f371a6eac0a3d5d6e082f47f858469274cc4b7504fcc',
    '81011059568a877ad828dd47bfc784b1fe722a108e831258b2bcd628984b57e1']) {
    expect(known).toContain(digest)
  }
})

it('reads complete paged content, rejects unlisted paths and removes the tool on disposal', async () => {
  const app = await reader()
  const args = { skill: 'cinematic-director', path: 'references/sound-and-dialogue.md', lineCount: 17 }
  let startLine: number | null = 1
  const pages: string[] = []
  while (startLine !== null) {
    const result = await app.run({ ...args, startLine })
    expect(result.isError).toBe(false)
    const page = result.value as { content: string; nextLine: number | null }
    pages.push(page.content)
    startLine = page.nextLine
  }
  expect(pages.join('\n') + '\n').toBe(await readFile(join(bundle, args.skill, args.path), 'utf8'))
  for (const invalid of [{ path: '../../sources.json' }, { skill: '__proto__' }, { path: '/etc/passwd' }, { startLine: 0 }, { lineCount: 501 }]) {
    expect((await app.run({ ...args, ...invalid })).isError).toBe(true)
  }
  expect(app.ctx.tools.schemas()).toEqual([])
  await app.fiber.dispose()
  expect((await app.run(args)).isError).toBe(true)
})

it('rejects changed content, links outside the bundle, and oversized pages without truncation', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qingmu-method-'))
  dispose.push(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'skills')
  await mkdir(join(root, 'method'), { recursive: true })
  const files = { 'changed.md': sha('original'), 'link.md': sha('outside'), 'large.md': sha('声'.repeat(45000)) }
  await writeFile(join(root, 'sources.json'), JSON.stringify({ schema: 'qingmu.creative-skill-sources.v1', skills: {
    method: { repository: 'https://example.test/method', commit: 'a'.repeat(40), files, upstreamFiles: files, adaptation: 'test' },
  } }))
  await writeFile(join(root, 'method/changed.md'), 'changed')
  await writeFile(join(temp, 'outside.md'), 'outside')
  await symlink(join(temp, 'outside.md'), join(root, 'method/link.md'))
  await writeFile(join(root, 'method/large.md'), '声'.repeat(45000))
  const app = await reader(root)
  for (const path of Object.keys(files)) expect((await app.run({ skill: 'method', path })).isError).toBe(true)
})
