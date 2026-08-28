// Real E7-5 chain: Chromium -> built Harness Host -> independent FastAPI -> fresh SQLite/media.
// The Python fixture creates synthetic identities; none is a real human signoff.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE } from './support.ts'

interface Fixture {
  readonly baseUrl: string
  readonly token: string
  readonly projectId: string
  readonly episodeId: string
  readonly sqlitePath: string
  readonly storageRoot: string
}

async function fingerprintFiles(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(path: string, relative: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await visit(join(path, entry.name), key)
      else {
        if (!entry.isFile()) throw new Error('Fixture storage must not contain symlinks')
        result[key] = createHash('sha256').update(await readFile(join(path, entry.name))).digest('hex')
      }
    }
  }
  await visit(root, '')
  return result
}

async function mountClient(scaffold: WebScaffold, name: string, path: string): Promise<void> {
  const link = join(scaffold.harnessHome, 'profiles', 'node_modules', ...name.split('/'))
  await mkdir(dirname(link), { recursive: true })
  await symlink(join(REPO_ROOT, path), link, 'dir')
  await scaffold.ctx.loader.create({ name })
}

const writerRoot = process.env.QINGMU_E75_YIMENG_ROOT
describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot)(
  'web e2e: real read-only episode evidence', () => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let page: Page
    let fixture: Fixture
    let beforeDb: string
    let beforeStorage: Record<string, string>
    let beforeFixture: Record<string, string>
    const originalToken = process.env.YIMENG_API_TOKEN
    const captured: { path: string; body: Record<string, unknown> }[] = []

    beforeAll(async () => {
      if (!writerRoot || webSnapshotMode() === 'record') throw new Error('Explicit isolated writer root and keyless snapshot mode are required')
      root = await realpath(await mkdtemp(join(tmpdir(), 'qingmu-e75-real-')))
      // Deliberately do not inherit provider keys, production paths, credentials, or .env values.
      child = spawn(join(writerRoot, '.venv/bin/python'), [
        '-B', join(writerRoot, 'scripts/qingmu_evidence_ledger_fixture.py'), '--root', join(root, 'yimeng'),
      ], { cwd: root, env: { PATH: process.env.PATH, PYTHONPATH: join(writerRoot, 'backend/src'), PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      const server = child
      fixture = await new Promise<Fixture>((resolve, reject) => {
        let output = ''
        let stderr = ''
        const timer = setTimeout(() => { reject(new Error(`FastAPI fixture readiness timed out: ${stderr.slice(-2000)}`)) }, 30_000)
        server.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
        server.once('error', (error) => { clearTimeout(timer); reject(error) })
        server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`FastAPI fixture exited ${String(code)}: ${stderr.slice(-2000)}`)) })
        server.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          for (;;) {
            const newline = output.indexOf('\n')
            if (newline < 0) break
            const line = output.slice(0, newline)
            output = output.slice(newline + 1)
            if (!line.startsWith('{')) continue
            const value = JSON.parse(line) as Fixture
            if (typeof value.baseUrl !== 'string' || typeof value.token !== 'string') continue
            clearTimeout(timer)
            resolve(value)
          }
        })
      })
      expect(fixture.sqlitePath.startsWith(join(root, 'yimeng') + '/')).toBe(true)
      expect(fixture.storageRoot.startsWith(join(root, 'yimeng') + '/')).toBe(true)
      expect(new URL(fixture.baseUrl).hostname).toBe('127.0.0.1')
      beforeDb = createHash('sha256').update(await readFile(fixture.sqlitePath)).digest('hex')
      beforeStorage = await fingerprintFiles(fixture.storageRoot)
      beforeFixture = await fingerprintFiles(dirname(fixture.sqlitePath))
      process.env.YIMENG_API_TOKEN = fixture.token
      let overlay = await readFile(join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8')
      for (const name of ['client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter', 'qingmu-imago-method-adapter', 'qingmu-yimeng-command-adapter', 'client-ui-qingmu-cockpit']) {
        overlay = overlay.replace(`name: '@deepseek-ai/dsh-experimental-${name}'`, `name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/experimental', name, 'lib/index.js')).href)}`)
      }
      overlay += `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n\n- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
      const overlayPath = join(root, 'real-episode.overlay.yml')
      await writeFile(overlayPath, overlay)
      scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath })
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu', 'packages/experimental/client-ui-brand-qingmu')
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit', 'packages/experimental/client-ui-qingmu-cockpit')
      await scaffold.ctx.loader.await()
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: ZH_BROWSER_LOCALE })
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path === '/qingmu-yimeng/evidenceLedger' || path === '/qingmu-yimeng/verifyEpisode') {
          captured.push({ path, body: request.postDataJSON() as Record<string, unknown> })
        }
      })
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '进入青木 OS' }).click()
    })

    afterAll(async () => {
      try {
        await browser?.close()
        await scaffold?.close()
      } finally {
        if (child?.exitCode === null) {
          const server = child
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { server.kill('SIGKILL') }, 5000)
            server.once('exit', () => { clearTimeout(timer); resolve() })
            server.kill('SIGTERM')
          })
        }
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('runs the canonical verifier through the real browser/Host/API and rejects a stale source', async () => {
      if (scaffold === undefined) throw new Error('Host was not started')
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await dialog.getByRole('tab', { name: '生成与质检', exact: true }).click()
      const panel = dialog.getByRole('region', { name: '整集证据与核验' })
      expect(captured).toHaveLength(0)
      const load = panel.getByRole('button', { name: '查看本集证据', exact: true })
      try {
        await expect.poll(() => load.isEnabled(), { timeout: 5000 }).toBe(true)
      } catch (error) {
        throw new Error((await dialog.innerText()).slice(0, 5000), { cause: error })
      }
      await load.click()
      const verify = panel.getByRole('button', { name: '核验本集', exact: true })
      await verify.waitFor()
      await expect.poll(() => verify.isEnabled()).toBe(true)
      expect(captured.filter(item => item.path.endsWith('/verifyEpisode'))).toHaveLength(0)
      await verify.click()
      const report = panel.getByLabel('整集核验原始 JSON')
      await report.waitFor({ timeout: 60_000 })
      const result = JSON.parse(await report.innerText()) as Record<string, unknown>
      expect(result.project_id).toBe(fixture.projectId)
      expect(result.episode_id).toBe(fixture.episodeId)
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual(expect.arrayContaining(['missing_final_output', 'creative_missing_creative_director_execution:frame=1']))
      expect(result.frame_count).toBe(1)
      expect(result.video_frame_coverage_count).toBe(1)
      expect(captured.filter(item => item.path.endsWith('/verifyEpisode'))).toHaveLength(1)
      const wire = captured.find(item => item.path.endsWith('/verifyEpisode'))?.body
      if (wire === undefined) throw new Error('Browser did not call the Host verification RPC')
      expect(wire.payload).toMatchObject({ projectId: fixture.projectId, episodeId: fixture.episodeId })
      expect((wire.payload as Record<string, unknown>).sourceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/)
      const rejected = await page.evaluate(async (body) => {
        const response = await fetch('/qingmu-yimeng/verifyEpisode', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, rpcId: 'e75-stale-source', payload: { ...(body.payload as object), sourceSnapshotSha256: '0'.repeat(64) } }),
        })
        return await response.json() as unknown
      }, wire)
      expect(JSON.stringify(rejected)).toMatch(/source_snapshot_conflict|stale/i)
      expect(await page.locator('body').innerHTML()).not.toContain(fixture.token)
      const aria = await captureStableAria(page, 'role=region[name="整集证据与核验"]', scaffold.workspaceCwd)
      const stable = aria.replace(/[a-f0-9]{64}/g, '<sha256>')
        .replace(/\b(project|episode|frame|asset|task|actor|prop|scene|series|storyboard_revision)_[a-f0-9]{12}\b/g, '$1_<id>')
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?/g, '<verified-at>')
        .replace(/\d{4}-\d{2}-\d{2}T\{\{clock\}\}\+\{\{clock\}\}/g, '<verified-at>')
      const golden = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-episode-evidence/ui.expected.md')
      if (scaffold.mode === 'refresh') await mkdir(dirname(golden), { recursive: true })
      await compareOrRefreshGolden(golden, stable, scaffold.mode)
      if (process.env.QINGMU_E75_SCREENSHOT) {
        await report.scrollIntoViewIfNeeded()
        await page.screenshot({ path: process.env.QINGMU_E75_SCREENSHOT })
      }
      expect(createHash('sha256').update(await readFile(fixture.sqlitePath)).digest('hex')).toBe(beforeDb)
      expect(await fingerprintFiles(fixture.storageRoot)).toEqual(beforeStorage)
      expect(await fingerprintFiles(dirname(fixture.sqlitePath))).toEqual(beforeFixture)
      expect(Object.keys(beforeStorage).some(path => path.endsWith('.mp4'))).toBe(true)
    })
  },
)
