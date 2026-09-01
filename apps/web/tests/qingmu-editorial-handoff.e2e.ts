// E8-1A blocked export path: Chromium -> built Host -> actual FastAPI -> isolated SQLite/media.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
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

const writerRoot = process.env.QINGMU_E8_YIMENG_ROOT
describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot)(
  'web e2e: real read-only editorial handoff', () => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let page: Page
    let fixture: Fixture
    let beforeDb: string
    let beforeStorage: Record<string, string>
    const originalToken = process.env.YIMENG_API_TOKEN
    const captured: Record<string, unknown>[] = []

    beforeAll(async () => {
      if (!writerRoot || webSnapshotMode() === 'record') throw new Error('Explicit isolated writer root and keyless snapshot mode are required')
      root = await realpath(await mkdtemp(join(tmpdir(), 'qingmu-e8-handoff-')))
      child = spawn(join(writerRoot, '.venv/bin/python'), [
        '-B', join(writerRoot, 'scripts/qingmu_evidence_ledger_fixture.py'),
        '--root', join(root, 'yimeng'), '--handoff-two-shots',
      ], {
        cwd: root,
        env: { PATH: process.env.PATH, PYTHONPATH: join(writerRoot, 'backend/src'), PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const server = child
      fixture = await new Promise<Fixture>((resolve, reject) => {
        let output = ''
        let stderr = ''
        const timer = setTimeout(() => {
          reject(new Error(`FastAPI fixture readiness timed out: ${stderr.slice(-2000)}`))
        }, 30_000)
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
      beforeDb = createHash('sha256').update(await readFile(fixture.sqlitePath)).digest('hex')
      beforeStorage = await fingerprintFiles(fixture.storageRoot)
      process.env.YIMENG_API_TOKEN = fixture.token
      let overlay = await readFile(join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8')
      for (const name of ['client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter', 'qingmu-imago-method-adapter', 'qingmu-yimeng-command-adapter', 'client-ui-qingmu-cockpit']) {
        overlay = overlay.replace(`name: '@deepseek-ai/dsh-experimental-${name}'`, `name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/experimental', name, 'lib/index.js')).href)}`)
      }
      overlay += `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n\n- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
      const overlayPath = join(root, 'editorial-handoff.overlay.yml')
      await writeFile(overlayPath, overlay)
      scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath, welcomeNoticePending: true })
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu', 'packages/experimental/client-ui-brand-qingmu')
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit', 'packages/experimental/client-ui-qingmu-cockpit')
      await scaffold.ctx.loader.await()
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
      const bootErrors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') bootErrors.push(message.text()) })
      page.on('pageerror', (error) => { bootErrors.push(error.message) })
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/qingmu-yimeng/editorialHandoff') {
          captured.push(request.postDataJSON() as Record<string, unknown>)
        }
      })
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      const enter = page.getByRole('button', { name: '进入青木 OS' })
      try {
        await enter.waitFor({ timeout: 5000 })
      } catch {
        throw new Error(`Qingmu welcome did not render: ${bootErrors.join(' | ')}; body=${(await page.locator('body').innerText()).slice(0, 1000)}`)
      }
      await enter.click()
    })

    afterAll(async () => {
      try {
        await browser?.close()
        await scaffold?.close()
      } finally {
        if (child?.exitCode === null) {
          const server = child
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => server.kill('SIGKILL'), 5000)
            server.once('exit', () => { clearTimeout(timer); resolve() })
            server.kill('SIGTERM')
          })
        }
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('renders two authoritative shots and a fail-closed OTIO download without writes', async () => {
      if (scaffold === undefined) throw new Error('Host was not started')
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await expect.poll(() => dialog.getByRole('button', { name: '刷新只读投影', exact: true }).isEnabled()).toBe(true)
      await page.waitForTimeout(500)
      await dialog.getByRole('tab', { name: '费用与交付', exact: true }).click()
      await dialog.getByRole('heading', { name: '剪辑交接草案' }).waitFor()
      await expect.poll(() => captured.length).toBe(1)
      await expect.poll(async () => (
        await dialog.getByRole('status').count() + await dialog.getByRole('alert').count()
      )).toBeGreaterThan(0)
      if (await dialog.getByRole('alert').count() > 0) {
        expect(await dialog.getByRole('alert').innerText()).toContain('读取期间来源已变化')
        await dialog.getByRole('button', { name: '刷新交接事实' }).click()
        await expect.poll(() => captured.length).toBe(2)
      }
      await expect.poll(() => dialog.getByRole('status').innerText()).toContain('青木视频生产交接就绪: 否')
      const statusText = await dialog.getByRole('status').innerText()
      expect(statusText).toContain('青木视频生产交接就绪: 否')
      expect(statusText).toContain('易梦剧集发布就绪: 否')
      expect(await dialog.getByRole('list', { name: '剪辑交接镜头清单' }).locator(':scope > li').count()).toBe(2)
      expect(await dialog.getByText('Fixture local take', { exact: false }).count()).toBe(1)
      expect(await dialog.getByText('Fixture unresolved take', { exact: false }).count()).toBe(1)
      expect(await dialog.getByText('未绑定权威音频').count()).toBe(1)
      expect(await dialog.getByText('当前镜头没有权威已选 Take。').count()).toBe(1)
      const download = dialog.getByRole('button', { name: '当前不可下载' })
      expect(await download.isDisabled()).toBe(true)
      expect(await dialog.getByText(/OpenTimelineIO/u).count()).toBeGreaterThan(0)
      const mediaEntries = Object.keys(beforeStorage).filter(path => path.endsWith('.mp4'))
      expect(mediaEntries).toHaveLength(1)
      const mediaPath = join(fixture.storageRoot, mediaEntries[0] as string)
      const mediaBytes = await readFile(mediaPath)
      const firstShot = dialog.getByRole('list', { name: '剪辑交接镜头清单' }).locator(':scope > li').first()
      const oldMediaSha = await firstShot.getByText(/^Media SHA:/u).innerText()
      await rm(mediaPath)
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      await expect.poll(() => captured.length).toBeGreaterThanOrEqual(2)
      await expect.poll(() => dialog.getByText('已选媒体的本地字节缺失或不可读取。').count()).toBe(1)
      await expect.poll(() => dialog.getByText('Media SHA: —').count()).toBe(1)
      expect(await firstShot.getByText(oldMediaSha, { exact: true }).count()).toBe(0)
      expect(await dialog.getByRole('button', { name: '当前不可下载' }).isDisabled()).toBe(true)
      await writeFile(mediaPath, mediaBytes)
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      await expect.poll(() => firstShot.getByText(/^Media SHA:/u).innerText()).toBe(oldMediaSha)
      expect(await page.locator('body').innerHTML()).not.toContain(fixture.token)
      for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport)
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
      expect(createHash('sha256').update(await readFile(fixture.sqlitePath)).digest('hex')).toBe(beforeDb)
      expect(await fingerprintFiles(fixture.storageRoot)).toEqual(beforeStorage)
    })
  },
)
