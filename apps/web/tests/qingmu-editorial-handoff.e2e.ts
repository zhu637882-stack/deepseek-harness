// E8-1B: Chromium -> built Host -> actual FastAPI -> deterministic official OTIO package.
import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE } from './support.ts'

const execFile = promisify(execFileCallback)
const EDITORIAL_HANDOFF_KEY = 'e8-1c-editorial-handoff-host-fixture-key-0001'

interface Fixture {
  readonly baseUrl: string
  readonly token: string
  readonly otherToken: string
  readonly projectId: string
  readonly episodeId: string
  readonly frameIds: readonly string[]
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

async function stopFixture(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

const writerRoot = process.env.QINGMU_E8_YIMENG_ROOT
describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot)(
  'web e2e: official deterministic editorial handoff package', () => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let page: Page
    let fixture: Fixture
    let beforeDb: string
    let beforeStorage: Record<string, string>
    let writerSpoolRoot = ''
    const originalToken = process.env.YIMENG_API_TOKEN
    const originalEditorialKey = process.env.QINGMU_EDITORIAL_HANDOFF_KEY
    const captured: Record<string, unknown>[] = []
    const downloadRequests: string[] = []

    async function startFixture(resume: boolean): Promise<Fixture> {
      if (root === undefined || writerRoot === undefined) throw new Error('Fixture roots are required')
      const args = [
        '-B', join(writerRoot, 'scripts/qingmu_evidence_ledger_fixture.py'),
        '--root', join(root, 'yimeng'),
        ...(resume ? ['--resume'] : ['--handoff-complete-package']),
      ]
      child = spawn(join(writerRoot, '.venv/bin/python'), args, {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          PYTHONPATH: join(writerRoot, 'backend/src'),
          PYTHONDONTWRITEBYTECODE: '1',
          QINGMU_EDITORIAL_HANDOFF_KEY: EDITORIAL_HANDOFF_KEY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const server = child
      return await new Promise<Fixture>((resolve, reject) => {
        let output = ''
        let stderr = ''
        const timer = setTimeout(() => reject(new Error(`FastAPI fixture readiness timed out: ${stderr.slice(-2000)}`)), 30_000)
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
    }

    beforeAll(async () => {
      if (!writerRoot || webSnapshotMode() === 'record') throw new Error('Explicit isolated writer root and keyless snapshot mode are required')
      root = await realpath(await mkdtemp(join(tmpdir(), 'qingmu-e81b-handoff-')))
      process.env.QINGMU_EDITORIAL_HANDOFF_KEY = EDITORIAL_HANDOFF_KEY
      fixture = await startFixture(false)
      await stopFixture(child)
      writerSpoolRoot = join(root, 'yimeng', 'storage', '.qingmu-editorial-import-spool')
      await mkdir(writerSpoolRoot, { recursive: true, mode: 0o700 })
      await writeFile(join(writerSpoolRoot, 'qingmu-editorial-import-abandoned.zip'), 'orphan')
      await writeFile(join(writerSpoolRoot, 'keep-me.txt'), 'unrelated')
      fixture = await startFixture(true)
      expect(await readdir(writerSpoolRoot)).toEqual(['keep-me.txt'])
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
      const readEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.id === 'qingmu-yimeng-read-adapter')
      expect(readEntry?.options.config).toMatchObject({ baseUrl: fixture.baseUrl })
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`External browser request forbidden: ${url.origin}`)
        if (url.pathname === '/qingmu-yimeng/editorialHandoff') captured.push(request.postDataJSON() as Record<string, unknown>)
      })
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '进入青木 OS' }).click()
    })

    afterAll(async () => {
      try {
        await browser?.close()
        await scaffold?.close()
      } finally {
        await stopFixture(child)
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (originalEditorialKey === undefined) Reflect.deleteProperty(process.env, 'QINGMU_EDITORIAL_HANDOFF_KEY')
        else process.env.QINGMU_EDITORIAL_HANDOFF_KEY = originalEditorialKey
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('downloads exact official OTIO twice, fails stale, and recovers after FastAPI restart', async () => {
      if (scaffold === undefined || browser === undefined || writerRoot === undefined || root === undefined) throw new Error('E2E dependencies were not started')
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await dialog.getByRole('tab', { name: '费用与交付', exact: true }).click()
      await dialog.getByRole('heading', { name: '剪辑交接草案' }).waitFor()
      const shotList = dialog.getByRole('list', { name: '剪辑交接镜头清单' })
      const firstRead = await Promise.race([
        shotList.waitFor({ timeout: 30_000 }).then(() => 'loaded' as const),
        dialog.getByRole('alert').waitFor({ timeout: 30_000 }).then(() => 'retry' as const),
      ])
      if (firstRead === 'retry') {
        for (let attempt = 0; attempt < 3 && !await shotList.isVisible(); attempt += 1) {
          await page.waitForTimeout(500)
          await dialog.getByRole('button', { name: '刷新交接事实' }).click()
          await shotList.waitFor({ timeout: 10_000 }).catch(() => undefined)
        }
        if (!await shotList.isVisible()) {
          throw new Error(`Editorial handoff did not recover: ${await dialog.innerText()}`)
        }
      }
      const downloadButton = dialog.getByRole('button', { name: /(?:下载 OTIO 媒体包|下载不可用)/u })
      await expect.poll(async () => {
        if (await downloadButton.isEnabled()) return true
        throw new Error(await dialog.innerText())
      }, { timeout: 30_000 }).toBe(true)
      expect(await shotList.locator(':scope > li').count()).toBe(2)
      expect(await dialog.getByText(/OpenTimelineIO 0\.18\.1/u).count()).toBeGreaterThan(0)
      const statusText = await dialog.getByRole('status').filter({ hasText: '青木视频生产交接就绪' }).innerText()
      expect(statusText).toContain('青木视频生产交接就绪: 否')
      expect(statusText).toContain('易梦剧集发布就绪: 否')

      // The browser cannot choose the Writer identity for a Host capability. A login
      // switch must reject the old capability without consuming it.
      process.env.YIMENG_API_TOKEN = fixture.otherToken
      await page.evaluate(() => {
        Reflect.set(globalThis, '__qingmuOriginalAnchorClick', HTMLAnchorElement.prototype.click)
        HTMLAnchorElement.prototype.click = function captureDownloadCapability() {
          Reflect.set(globalThis, '__qingmuDownloadCapabilityUrl', this.href)
        }
      })
      await downloadButton.click()
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(globalThis, '__qingmuDownloadCapabilityUrl') as unknown,
      )).toEqual(expect.any(String))
      const oldCapabilityUrl = await page.evaluate(() =>
        Reflect.get(globalThis, '__qingmuDownloadCapabilityUrl') as unknown)
      if (typeof oldCapabilityUrl !== 'string') throw new Error('Download capability URL missing')
      const rejected = await page.evaluate(async (url) => {
        const response = await fetch(String(url), { cache: 'no-store' })
        return { status: response.status, body: await response.json() as unknown }
      }, oldCapabilityUrl)
      expect(rejected).toEqual({
        status: 403, body: { code: 'editorial_handoff_download_forbidden' },
      })
      await page.evaluate(() => {
        const original = Reflect.get(globalThis, '__qingmuOriginalAnchorClick') as unknown
        if (typeof original === 'function') HTMLAnchorElement.prototype.click = original
        Reflect.deleteProperty(globalThis, '__qingmuOriginalAnchorClick')
        Reflect.deleteProperty(globalThis, '__qingmuDownloadCapabilityUrl')
      })
      process.env.YIMENG_API_TOKEN = fixture.token
      const oldStatus = await page.evaluate(async (url) => {
        const statusUrl = new URL(url)
        statusUrl.pathname = '/api/qingmu/editorial-handoff/download-status'
        const response = await fetch(statusUrl, { cache: 'no-store' })
        return { status: response.status, body: await response.json() as unknown }
      }, oldCapabilityUrl)
      expect(oldStatus).toEqual({
        status: 200,
        body: { status: 'not_started', sha256: null, size: null, errorCode: null },
      })
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      await expect.poll(() => downloadButton.isEnabled()).toBe(true)

      const packagePaths: string[] = []
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await dialog.getByRole('button', { name: '刷新交接事实' }).click()
          await expect.poll(() => downloadButton.isEnabled()).toBe(true)
        }
        const event = page.waitForEvent('download')
        await downloadButton.click()
        const download = await event
        const failure = await download.failure()
        if (failure !== null) {
          throw new Error(`Editorial download failed: ${failure}; UI=${await dialog.innerText()}`)
        }
        downloadRequests.push(download.url())
        const packagePath = join(root, `handoff-${attempt + 1}.otio.zip`)
        await download.saveAs(packagePath)
        packagePaths.push(packagePath)
        await expect.poll(() => dialog.getByText(/SHA-256:/u).count()).toBe(1)
      }
      const firstBytes = await readFile(packagePaths[0] as string)
      const secondBytes = await readFile(packagePaths[1] as string)
      expect(secondBytes).toEqual(firstBytes)
      const packageSha = createHash('sha256').update(firstBytes).digest('hex')
      expect(await dialog.getByText(`SHA-256: ${packageSha}`).count()).toBe(1)
      const parsed = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
        'import hashlib,json,sys,zipfile',
        'from opentimelineio.adapters import otio_json',
        'with zipfile.ZipFile(sys.argv[1]) as z:',
        '  timeline=otio_json.read_from_string(z.read("timeline.otio").decode())',
        '  manifest=json.loads(z.read("manifest.json"))',
        '  actual={info.filename for info in z.infolist()}',
        '  declared={"manifest.json", *(entry["path"] for entry in manifest["entries"])}',
        '  entries_ok=actual == declared and all(len(z.read(entry["path"])) == entry["size"] and hashlib.sha256(z.read(entry["path"])).hexdigest() == entry["sha256"] for entry in manifest["entries"])',
        '  print(json.dumps({"name":timeline.name,"tracks":[t.name for t in timeline.tracks],"shots":len(manifest["orderedShots"]),"otio":manifest["otio"]["version"],"entriesOk":entries_ok}))',
      ].join('\n'), packagePaths[0] as string], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
      expect(JSON.parse(parsed.stdout)).toEqual({
        name: `Qingmu ${fixture.episodeId} editorial handoff`,
        tracks: ['Picture', 'Dialogue'], shots: 2, otio: '0.18.1', entriesOk: true,
      })
      const packageInput = dialog.getByLabel('选择本地 OTIO ZIP')
      expect(await packageInput.isEnabled()).toBe(true)
      await packageInput.setInputFiles(packagePaths[1] as string)
      await dialog.getByRole('button', { name: '复验并预览' }).click()
      await dialog.getByText('SHA-256 与大小均精确匹配原下载终态').waitFor()
      expect(await dialog.getByText('结构、媒体引用与 otio_json 复验通过').count()).toBe(1)
      expect(await dialog.getByText('仍绑定当前项目、剧集、来源与投影').count()).toBe(1)
      expect(await dialog.getByText('Picture · Video · 2').count()).toBe(1)
      expect(await dialog.getByText('Dialogue · Audio · 2').count()).toBe(1)
      expect(await dialog.getByText(/仅证明本地包可解析且与相应来源绑定/u).count()).toBe(1)
      expect(await dialog.getByText(/^media\//u).count()).toBeGreaterThan(0)

      const successfulDownloadUrl = downloadRequests.at(-1)
      if (successfulDownloadUrl === undefined || scaffold === undefined) throw new Error('Successful download URL missing')
      const importStatePath = join(scaffold.harnessHome, 'state', 'qingmu-editorial-downloads.json.imports')
      const importStateBefore = await readFile(importStatePath, 'utf8')
      const repeatedStatus = await page.evaluate(async (url) => {
        const statusUrl = new URL(url)
        statusUrl.pathname = '/api/qingmu/editorial-handoff/download-status'
        let latest: unknown
        for (let index = 0; index < 100; index += 1) {
          const response = await fetch(statusUrl, { cache: 'no-store' })
          if (!response.ok) throw new Error(`status ${String(response.status)}`)
          latest = await response.json()
        }
        return latest
      }, successfulDownloadUrl) as { importAccess?: { requestId?: string } }
      expect(repeatedStatus).toMatchObject({ importAccess: { requestId: expect.any(String) } })
      const importStateAfter = await readFile(importStatePath, 'utf8')
      expect(JSON.parse(importStateAfter)).toHaveLength(JSON.parse(importStateBefore).length)
      expect(Buffer.byteLength(importStateAfter)).toBeLessThanOrEqual(Buffer.byteLength(importStateBefore) + 256)
      expect(importStateAfter.match(/jason\.qingmu-editorial-package-consumption-preview\.v1/gu)).toHaveLength(1)
      expect(await readdir(writerSpoolRoot)).toEqual(['keep-me.txt'])

      for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport)
        const receiptConclusion = dialog.getByText('SHA-256 与大小均精确匹配原下载终态')
        await receiptConclusion.scrollIntoViewIfNeeded()
        const conclusionBox = await receiptConclusion.boundingBox()
        expect(conclusionBox).not.toBeNull()
        expect(conclusionBox?.y ?? -1).toBeGreaterThanOrEqual(0)
        expect((conclusionBox?.y ?? viewport.height) + (conclusionBox?.height ?? 1)).toBeLessThanOrEqual(viewport.height)
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        const artifactDir = process.env.QINGMU_E8_ARTIFACT_DIR
        if (artifactDir !== undefined) {
          await mkdir(artifactDir, { recursive: true })
          await page.screenshot({ path: join(artifactDir, `editorial-handoff-${viewport.width}x${viewport.height}.png`) })
        }
      }

      await stopFixture(child)
      fixture = await startFixture(true)
      expect(await readdir(writerSpoolRoot)).toEqual(['keep-me.txt'])
      process.env.YIMENG_API_TOKEN = fixture.token
      const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
      const freshPage = await fresh.newPage()
      await freshPage.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await freshPage.getByRole('button', { name: '青木制作台', exact: true }).click()
      const freshDialog = freshPage.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await freshDialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await freshDialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await freshDialog.getByRole('tab', { name: '费用与交付', exact: true }).click()
      const freshButton = freshDialog.getByRole('button', { name: '下载 OTIO 媒体包' })
      for (let attempt = 0; attempt < 3 && !await freshButton.isVisible(); attempt += 1) {
        await freshPage.waitForTimeout(500)
        if (await freshDialog.getByRole('alert').isVisible()) {
          await freshDialog.getByRole('button', { name: '刷新交接事实' }).click()
        }
        await freshButton.waitFor({ timeout: 10_000 }).catch(() => undefined)
      }
      expect(await freshButton.isEnabled()).toBe(true)
      expect(await freshDialog.getByRole('list', { name: '剪辑交接镜头清单' }).locator(':scope > li').count()).toBe(2)
      await freshDialog.getByText('SHA-256 与大小均精确匹配原下载终态').waitFor()
      expect(await freshDialog.getByText('结构、媒体引用与 otio_json 复验通过').count()).toBe(1)
      expect(await freshDialog.getByText('仍绑定当前项目、剧集、来源与投影').count()).toBe(1)
      await fresh.close()
      const tamperCheck = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
        'import sys,zipfile',
        'from pathlib import Path',
        'from jason.apps.studio.qingmu_editorial_package import verify_package',
        'source,target=map(Path,sys.argv[1:3])',
        'with zipfile.ZipFile(source) as archive:',
        '  entries=[(entry.filename, archive.read(entry)) for entry in archive.infolist()]',
        'with zipfile.ZipFile(target,"w",compression=zipfile.ZIP_STORED) as archive:',
        '  for name,payload in entries:',
        '    archive.writestr(name, payload + b" " if name == "timeline.otio" else payload)',
        'try:',
        '  verify_package(target)',
        'except Exception as error:',
        '  print(f"rejected:{type(error).__name__}:{error}")',
        'else:',
        '  raise SystemExit("tampered package accepted")',
      ].join('\n'), packagePaths[0] as string, join(root, 'handoff-tampered.otio.zip')], {
        env: { PATH: process.env.PATH, PYTHONPATH: join(writerRoot, 'backend/src'), PYTHONDONTWRITEBYTECODE: '1' },
      })
      expect(tamperCheck.stdout).toMatch(/^rejected:/u)

      const projectionUrl = `${fixture.baseUrl}/api/qingmu/projects/${encodeURIComponent(fixture.projectId)}/episodes/${encodeURIComponent(fixture.episodeId)}/editorial-handoff`
      const wavEntry = Object.keys(beforeStorage).find(path => path.endsWith('.wav'))
      if (wavEntry === undefined) throw new Error('Authoritative audio fixture missing')
      const audioPath = join(fixture.storageRoot, wavEntry)
      const audioBytes = await readFile(audioPath)
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      await expect.poll(() => downloadButton.isEnabled()).toBe(true)
      await writeFile(audioPath, Buffer.from('tampered-audio'))
      await downloadButton.click()
      await expect.poll(() => dialog.getByText('读取期间来源已变化，请刷新读取同一份当前快照。').count()).toBe(1)
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      const disabledButton = dialog.getByRole('button', { name: '当前不可下载' })
      for (let attempt = 0; attempt < 3 && !await disabledButton.isVisible(); attempt += 1) {
        await page.waitForTimeout(500)
        if (await dialog.getByRole('alert').isVisible()) {
          await dialog.getByRole('button', { name: '刷新交接事实' }).click()
        }
        await disabledButton.waitFor({ timeout: 10_000 }).catch(() => undefined)
      }
      if (!await disabledButton.isVisible()) {
        const direct = await fetch(projectionUrl, { headers: { authorization: `Bearer ${fixture.token}` } })
        throw new Error(`Tampered handoff did not project a blocker: ${direct.status}:${(await direct.text()).slice(0, 500)} UI=${await dialog.innerText()}`)
      }
      expect(await disabledButton.isDisabled()).toBe(true)
      expect(await dialog.getByText(/SHA-256:/u).count()).toBe(0)
      await writeFile(audioPath, audioBytes)
      await dialog.getByRole('button', { name: '刷新交接事实' }).click()
      const restoredButton = dialog.getByRole('button', { name: '下载 OTIO 媒体包' })
      for (let attempt = 0; attempt < 3 && !await restoredButton.isVisible(); attempt += 1) {
        await page.waitForTimeout(500)
        if (await dialog.getByRole('alert').isVisible()) {
          await dialog.getByRole('button', { name: '刷新交接事实' }).click()
        }
        await restoredButton.waitFor({ timeout: 10_000 }).catch(() => undefined)
      }
      expect(await restoredButton.isEnabled()).toBe(true)

      expect(captured.length).toBeGreaterThan(0)
      expect(await page.locator('body').innerHTML()).not.toContain(fixture.token)
      expect(createHash('sha256').update(await readFile(fixture.sqlitePath)).digest('hex')).toBe(beforeDb)
      expect(await fingerprintFiles(fixture.storageRoot)).toEqual(beforeStorage)
    }, 120_000)
  },
)
