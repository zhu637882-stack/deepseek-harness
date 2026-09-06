/** Full shipped Host composition and built Qingmu client; only the external model is scripted.
 * Uses the repository web scaffold, real Writer HTTP/SQLite and the real Core compiler.
 * Builds changed packages only into its disposable root; never replaces installed artifacts.
 * Ready selection uses a synthetic test identity, not real-project human content signoff.
 */
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { launchWebScaffold, type WebScaffold } from '../../../../apps/web/tests/scaffold.ts'
import { toolValues } from '../src/native-draft.ts'
import type { DirectorObjectScope, NativeFirstDraftInput } from '../src/types.ts'
import { createYimengReadHandler } from '../../qingmu-yimeng-read-adapter/src/index.ts'

const writerRoot = process.env.QINGMU_WRITER_TEST_ROOT
const coreRoot = process.env.QINGMU_CORE_TEST_ROOT
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const tests = fileURLToPath(new URL('./', import.meta.url))
interface Fixture {
  baseUrl: string
  token: string
  attestationKey: string
  scope: DirectorObjectScope
  storyboardRevisionId: string
}
const authored = {
  imageGenPrompt: '雨夜旧车站空月台，摄影机在站台内侧；铁轨在右侧，无人物。',
  lastFrameImagePrompt: '同一空月台，摄影机前推后仍保持铁轨在右侧。',
  videoGenPrompt: '四秒缓慢前推；月台、铁轨位置不变，不新增人物；只听雨声。',
  motionPrompt: '摄影机向前缓慢移动四秒，不越过站台边缘。',
  negativePrompt: '不得新增人物、列车或对白；不得翻转铁轨与站台方向。',
}

it.skipIf(process.env.QINGMU_FULL_HOST_BROWSER !== '1' || !writerRoot || !coreRoot)(
  'adopts the native director proposal through the full Qingmu Host and browser', async () => {
    if (process.env.DSH_SNAPSHOT && process.env.DSH_SNAPSHOT !== 'replay') throw new Error('Keyless replay required')
    const root = await mkdtemp(join(tmpdir(), 'qingmu-connected-host-'))
    const writer = spawn(join(writerRoot!, '.venv/bin/python'), ['-B', join(tests, 'connected-writer.py')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH,
        PYTHONUNBUFFERED: '1', QINGMU_WRITER_TEST_ROOT: writerRoot!, QINGMU_CONNECTED_FULL_HOST: '1' },
    })
    const exited = once(writer, 'exit')
    void exited.catch(() => {})
    let stderr = ''
    writer.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-8000) })
    let host: WebScaffold | undefined
    let resumeDrift!: () => void
    const driftReentered = new Promise<void>((resolve) => { resumeDrift = resolve })
    try {
      const fixture = await new Promise<Fixture>((resolve, reject) => {
        let output = ''
        const timer = setTimeout(() => { reject(new Error(`Writer startup timeout: ${stderr}`)) }, 20000)
        writer.stdout.on('data', (chunk) => {
          output += String(chunk)
          const line = output.split('\n').find(item => item.startsWith('{"fixtureReady":') && item.endsWith('}'))
          if (line) { clearTimeout(timer); resolve(JSON.parse(line) as Fixture) }
        })
        void exited.then(() => { clearTimeout(timer); reject(new Error(`Writer exited: ${stderr}`)) }, reject)
      })
      vi.stubEnv('YIMENG_API_TOKEN', fixture.token)
      vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', fixture.attestationKey)
      vi.stubEnv('DSH_SNAPSHOT', 'replay')
      const harnessHome = join(root, 'dsh')
      const modules = join(harnessHome, 'profiles/node_modules/@deepseek-ai')
      await mkdir(modules, { recursive: true })
      for (const name of ['client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter', 'qingmu-yimeng-command-adapter',
        'qingmu-imago-method-adapter', 'qingmu-director-context-bridge', 'client-ui-qingmu-cockpit', 'runtime']) {
        const isRuntime = name === 'runtime'
        const original = join(repo, isRuntime ? 'packages/client' : 'packages/experimental', name)
        let target = original
        if (isRuntime || name === 'client-ui-qingmu-cockpit' || name === 'qingmu-director-context-bridge') {
          target = join(root, name)
          await mkdir(target)
          await writeFile(join(target, 'package.json'), await readFile(join(original, 'package.json')))
          await symlink(join(original, 'node_modules'), join(target, 'node_modules'), 'dir')
          await promisify(execFile)(process.execPath, [join(repo, 'node_modules/tsdown/dist/run.mjs'), '--out-dir', join(target, 'lib')], {
            cwd: original, timeout: 30000, env: { PATH: process.env.PATH, DSH_CLIENT_BUILD_PROFILE: 'qingmu',
              DSH_CLIENT_TITLE: '青木 OS', DSH_CLIENT_COMMIT_HASH: 'isolated-test' },
          })
        }
        await symlink(target, join(modules, isRuntime ? 'dsh-client-runtime' : 'dsh-experimental-' + name), 'dir')
      }
      const overlayPath = join(root, 'qingmu.patch.yml')
      const presetRoot = join(harnessHome, 'profiles/agent-presets')
      await cp(join(repo, 'packages/experimental/qingmu-web/agent-presets'), presetRoot, { recursive: true })
      const overlay = await readFile(join(repo, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8')
      await writeFile(overlayPath, overlay
        + `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
        + `\n- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
        + `\n- id: qingmu-imago-method-adapter\n  config:\n    coreRoot: ${JSON.stringify(coreRoot)}\n`
        + '\n- id: agent-default-model\n  config:\n    provider: qingmu-fixture\n    model: fixture\n')
      host = await launchWebScaffold({ harnessHome, extraOverlayPath: overlayPath,
        builtPackages: [{ name: '@deepseek-ai/dsh-client-runtime', root: join(root, 'runtime') }],
        agentPresets: { default: 'qingmu-director', roots: [{ path: presetRoot, trust: 'system' }] },
      })
      for (const [name, directory] of [['@deepseek-ai/dsh-client-runtime', 'runtime'],
        ['@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit', 'client-ui-qingmu-cockpit']] as const) {
        const response = await fetch(host.baseUrl + '/plugins/' + name + '/client.js')
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(await readFile(join(root, directory, 'lib/client.js'), 'utf8'))
      }
      const ctx = host.ctx
      class ScriptedModel extends LlmAdapter {
        requests: GenerateOptions[] = []
        override async listModels() { return [{ provider: 'qingmu-fixture', id: 'fixture', name: 'Isolated fixture' }] }
        override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, contextWindow: 128000 } }
        async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
          const step = this.requests.push(options) - 1
          if (step > 4) throw new Error('Unexpected external model request')
          if (step === 3) {
            await driftReentered // Browser re-enters only after the original request was admitted.
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('full-host-drift'),
              name: 'qingmu_read_prompt_draft', arguments: '{}' } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
          }
          if (step === 2 || step === 4) {
            if (step === 4) {
              const session = ctx.sessions.list().find(item => toolValues(item, 'qingmu_propose_first_draft').length)
              const last = session!.events.findLast(event => event.type === 'tool/result')
              expect(last).toMatchObject({ data: { message: { content: [{ type: 'tool-result', isError: true }] } } })
              expect(JSON.stringify(last)).toContain('previous shot selection')
            }
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: step === 2
              ? '本镜首稿建议已提供，请回导演工作区查看。' : '镜头选择已变化；本次旧要求已停止，未读取其他镜头。' } }
            yield { type: 'finish', reason: { kind: 'stop' } }; return
          }
          const receipt = ctx.sessions.list().flatMap(session => toolValues(session, 'qingmu_read_first_draft')).at(-1) as NativeFirstDraftInput | undefined
          if (step === 1 && !receipt) throw new Error('Real Writer/IMAGO read failed')
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`full-host-${step}`),
            name: step === 0 ? 'qingmu_read_first_draft' : 'qingmu_propose_first_draft',
            arguments: JSON.stringify(step === 0 ? {} : { receiptId: receipt!.receiptId, reason: '保持空月台空间关系。', ...authored }) } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        }
      }
      const model = new ScriptedModel()
      ctx.llm.registerAdapter(['qingmu-fixture'], model)
      const edited = authored.imageGenPrompt + '远处站牌处于画面左侧。'
      await runBrowser(root, host.baseUrl, host.workspaceCwd, edited, resumeDrift)
      expect(model.requests).toHaveLength(5)
      expect(JSON.stringify(model.requests[1]?.messages)).toContain('rough_final_feedback')
      const sessions = ctx.sessions.list().filter(session => toolValues(session, 'qingmu_propose_first_draft').length)
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.events.filter(event => event.type === 'tool/call').map(event => event.data.name))
        .toEqual(['qingmu_read_first_draft', 'qingmu_propose_first_draft', 'qingmu_read_prompt_draft'])
      expect(toolValues(sessions[0]!, 'qingmu_read_first_draft')[0]).toMatchObject({ scope: fixture.scope })
      const read = createYimengReadHandler({ baseUrl: fixture.baseUrl }, { fetch, readToken: () => fixture.token })
      const persisted = await read('promptIrBootstrap', { projectId: fixture.scope.projectId, episodeId: fixture.scope.episodeId,
        storyboardRevisionId: fixture.storyboardRevisionId, frameId: fixture.scope.shotId }, AbortSignal.timeout(10000))
      expect(persisted).toMatchObject({ ok: true, value: { ready: { status: 'Ready', editableProjection: {
        ...authored, imageGenPrompt: edited,
      } } } })
      const inspection: unknown = await fetch(fixture.baseUrl + '/fixture/inspection').then(response => response.json())
      expect(inspection).toEqual({ integrity: 'ok', counts: { prompt_irs: 1, generation_tasks: 0, provider_submission_outbox: 0 } })
    } catch (error) { throw new Error(`${String(error)}\nWriter stderr: ${stderr}`, { cause: error }) }
    finally {
      resumeDrift()
      try { await host?.close() } finally {
        vi.unstubAllEnvs()
        if (writer.exitCode === null && writer.signalCode === null) writer.kill('SIGTERM')
        const timer = setTimeout(() => writer.kill('SIGKILL'), 5000)
        try { await exited } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }) }
      }
    }
  }, 120000,
)

async function runBrowser(root: string, url: string, workspace: string, edited: string, reentered: () => void): Promise<void> {
  if (process.platform === 'win32') throw new Error('This fixture requires POSIX process groups')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-B', join(tests, 'full-host-browser.py'), url, workspace, edited], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, TMPDIR: root, PYTHONUNBUFFERED: '1' },
    })
    let output = ''; let timedOut = false
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error instanceof Error ? error : new Error(String(error)))
    } } }
    const timer = setTimeout(() => { timedOut = true; kill() }, 80000)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-16000)
      if (output.includes('native selection reentered')) reentered()
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer); kill()
      if (code === 0 && !timedOut) resolve()
      else reject(new Error(`Full Host browser ${timedOut ? 'timed out' : `exit ${code}`}: ${output}`))
    })
  })
}
