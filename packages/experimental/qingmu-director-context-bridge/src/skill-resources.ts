/** Read pinned creative-method resources without exposing the project filesystem. */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as validate } from 'zod'

/** Native preset resource reader; the native skill tool owns SKILL.md loading. */
export const name = 'qingmu-creative-skill-resources'
/** Read-only tools are registered in the creative session's scope. */
export const inject = ['tools']

/** Packaged resource location, selected by the preset rather than by the model. */
export interface Config {
  /** Directory containing the skill bundles and sources.json. */
  root: string
}

/** Require an explicit bundle-relative resource directory from the composition. */
export const Config: z<Config> = z.object({ root: z.string().required() })

const sourcesSchema = validate.object({
  schema: validate.literal('qingmu.creative-skill-sources.v1'),
  skills: validate.record(validate.string(), validate.object({
    repository: validate.string(),
    commit: validate.string().regex(/^[a-f0-9]{40}$/u),
    files: validate.record(validate.string(), validate.string().regex(/^[a-f0-9]{64}$/u)),
    upstreamFiles: validate.record(validate.string(), validate.string().regex(/^[a-f0-9]{64}$/u)),
    adaptation: validate.string(),
  })),
})

/**
 * Register a paged reader for references named by a loaded creative skill.
 * @param ctx - Native creative-session plugin scope.
 * @param config - Preset-owned skill directory; no arbitrary path parameter is exposed.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) throw new Error('Creative skill resources require an agent or preset scope.')
  if (!isAbsolute(config.root)) throw new Error('Creative skill root must be an absolute directory.')
  ctx.tools.register(defineTool({
    name: 'qingmu_read_skill_resource',
    description: 'Read a reference, engine, sub-skill or template named by a loaded creative skill. Use paths relative to that skill root; for nested documents use linkedResources paths returned by this tool. The response identifies the original repository and revision, and explicitly provides nextLine when more content remains. These are reusable methods and examples, never current project facts. This tool cannot run scripts, write state, or generate media.',
    parameters: {
      skill: { type: 'string', required: true, description: 'Exact skill name from the native skill catalog.' },
      path: { type: 'string', required: true, description: 'Resource path relative to the skill root, such as references/sound-and-dialogue.md.' },
      startLine: { type: 'number', description: 'First line to read, one-based; defaults to 1.' },
      lineCount: { type: 'number', description: 'Number of lines, 1 to 500; defaults to 250. Follow nextLine to finish a longer resource.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: args => ({ card: 'generic', kind: 'read', title: `读取创作方法：${args.skill} / ${args.path}` }),
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const startLine = args.startLine ?? 1
      const lineCount = args.lineCount ?? 250
      if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(lineCount) || lineCount < 1 || lineCount > 500) {
        throw new Error('Use a positive startLine and a lineCount from 1 to 500.')
      }
      const root = await realpath(config.root)
      const sources = sourcesSchema.parse(JSON.parse(await readFile(resolve(root, 'sources.json'), { encoding: 'utf8', signal: exec.signal })))
      const source = Object.hasOwn(sources.skills, args.skill) ? sources.skills[args.skill] : undefined
      if (source === undefined || !Object.hasOwn(source.files, args.path)) {
        const candidates = source && !args.path.split('/').includes('..') && !posix.isAbsolute(args.path)
          ? Object.keys(source.files).filter(path => path.endsWith(`/${args.path}`)).slice(0, 5)
          : []
        throw new Error(`Resource is not in this skill bundle. No substitute was read.${candidates.length
          ? ` Matching bundle-relative paths: ${candidates.join(', ')}. Read the intended exact path.`
          : ' Use an exact relative path from the loaded skill.'}`)
      }
      const upstreamSha256 = source.upstreamFiles[args.path]
      if (upstreamSha256 === undefined) throw new Error('Resource is missing its upstream source hash.')
      const path = await realpath(resolve(root, args.skill, args.path))
      const rel = relative(root, path)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Skill resource leaves the packaged directory.')
      const content = await readFile(path, { encoding: 'utf8', signal: exec.signal })
      const sha256 = createHash('sha256').update(content).digest('hex')
      if (sha256 !== source.files[args.path]) throw new Error('Skill resource differs from the recorded Qingmu bundle. Refresh the bundle before using it.')
      const lines = content.split('\n')
      if (lines.at(-1) === '') lines.pop()
      if (startLine > Math.max(lines.length, 1)) throw new Error(`Resource has ${lines.length} lines; requested startLine is beyond its end.`)
      const endLine = Math.min(startLine - 1 + lineCount, lines.length)
      const page = lines.slice(startLine - 1, endLine).join('\n')
      const linkedResources = [...page.matchAll(/(?:`|\]\()([^`\s()]+\.md(?:#[^`\s()]*)?)(?:`|\))/gu)]
        .map(([, reference = '']) => {
          const path = posix.normalize(posix.join(posix.dirname(args.path), reference.split('#')[0] ?? ''))
          return { reference, path }
        })
        .filter(({ path }, index, all) => Object.hasOwn(source.files, path)
          && all.findIndex(item => item.path === path) === index)
      const result = {
        skill: args.skill, path: args.path, repository: source.repository, commit: source.commit, sha256,
        upstreamSha256, adaptation: source.adaptation,
        startLine, endLine, totalLines: lines.length, nextLine: endLine < lines.length ? endLine + 1 : null,
        content: page, linkedResources,
      }
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072) {
        throw new Error('Resource page exceeds 128 KiB; request fewer lines. No partial page was returned.')
      }
      return result
    },
  }))
}
