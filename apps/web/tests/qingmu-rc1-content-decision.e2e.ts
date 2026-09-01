// E8-4A repair: Chromium -> built Host -> actual FastAPI -> persistent rejection.
import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE } from './support.ts'

const execFile = promisify(execFileCallback)

interface Fixture {
  readonly baseUrl: string
  readonly token: string
  readonly projectId: string
  readonly episodeId: string
  readonly sqlitePath: string
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
  'web e2e: RC1 natural-person rejection persists', () => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let context: BrowserContext | undefined
    let fixture: Fixture
    const originalToken = process.env.YIMENG_API_TOKEN
    const decisionPosts: string[] = []
    const externalRequests: string[] = []

    async function startFixture(resume: boolean): Promise<Fixture> {
      if (root === undefined || writerRoot === undefined) throw new Error('Fixture roots are required')
      child = spawn(join(writerRoot, '.venv/bin/python'), [
        '-B', join(writerRoot, 'scripts/qingmu_evidence_ledger_fixture.py'),
        '--root', join(root, 'yimeng'),
        ...(resume ? ['--resume'] : ['--handoff-complete-package', '--rc1-content-decision-ready']),
      ], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          PYTHONPATH: join(writerRoot, 'backend/src'),
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const server = child
      return await new Promise<Fixture>((resolve, reject) => {
        let output = ''
        let stderr = ''
        const timer = setTimeout(() => {
          reject(new Error(`FastAPI RC1 fixture readiness timed out: ${stderr.slice(-2000)}`))
        }, 30_000)
        server.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
        server.once('error', (error) => { clearTimeout(timer); reject(error) })
        server.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`FastAPI RC1 fixture exited ${String(code)}: ${stderr.slice(-2000)}`))
        })
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

    async function enterRc1(page: Page): Promise<ReturnType<Page['getByRole']>> {
      await page.goto(scaffold?.baseUrl ?? '', { waitUntil: 'load' })
      const welcome = page.getByRole('dialog', { name: '青木 OS 早期共创说明' })
      try {
        await welcome.waitFor({ state: 'visible', timeout: 5_000 })
        await welcome.getByRole('button', { name: '进入青木 OS' }).click()
        await welcome.waitFor({ state: 'detached', timeout: 15_000 })
      } catch {
        if (await welcome.isVisible()) throw new Error('welcome notice could not be dismissed')
      }
      const readOnly = page.getByRole('button', { name: '先以只读方式进入' })
      try {
        await readOnly.waitFor({ state: 'visible', timeout: 3_000 })
        await readOnly.click()
      } catch {
        if (await readOnly.isVisible()) throw new Error('read-only entry could not be selected')
      }
      const workbench = page.getByRole('button', { name: '青木制作台', exact: true })
      try {
        await workbench.click({ timeout: 5_000 })
      } catch (error) {
        if (!await readOnly.isVisible()) {
          const dialogs = await page.getByRole('dialog').allInnerTexts()
          throw new Error(`workbench blocked by modal: ${JSON.stringify(dialogs)}`, { cause: error })
        }
        await readOnly.click()
        await workbench.click()
      }
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await dialog.getByRole('tab', { name: '费用与交付', exact: true }).click()
      const rc1Http = await page.evaluate(async ({ projectId, episodeId }) => {
        const params = new URLSearchParams({ projectId, episodeId })
        const response = await fetch(`/api/qingmu/editorial-handoff/rc1-status?${params.toString()}`, {
          method: 'GET', cache: 'no-store',
        })
        return { status: response.status, body: await response.text() }
      }, { projectId: fixture.projectId, episodeId: fixture.episodeId })
      if (rc1Http.status !== 200) {
        const diagnostics = await page.evaluate(async ({ projectId, episodeId }) => {
          const params = new URLSearchParams({ projectId, episodeId })
          const identity = await fetch(
            `/api/qingmu/editorial-handoff/natural-person-identity?${params.toString()}`,
            { method: 'GET', cache: 'no-store' },
          )
          const evidence = await fetch(
            `/api/qingmu/editorial-handoff/canonical-evidence-freeze-status?${params.toString()}`,
            { method: 'GET', cache: 'no-store' },
          )
          return { identity: identity.status, evidence: evidence.status }
        }, { projectId: fixture.projectId, episodeId: fixture.episodeId })
        throw new Error(
          `Host RC1 status ${String(rc1Http.status)}: ${rc1Http.body.slice(0, 1000)}; `
          + `identity=${String(diagnostics.identity)} evidence=${String(diagnostics.evidence)}`,
        )
      }
      try {
        await dialog.getByText('用户本人整集内容决定', { exact: true }).waitFor({ timeout: 15_000 })
      } catch (error) {
        throw new Error(`RC1 content panel unavailable: ${(await dialog.innerText()).slice(-4000)}`, { cause: error })
      }
      return dialog
    }

    beforeAll(async () => {
      if (!writerRoot || webSnapshotMode() === 'record') {
        throw new Error('Explicit isolated writer root and keyless snapshot mode are required')
      }
      root = await mkdtemp(join(tmpdir(), 'qingmu-e84a-decision-'))
      fixture = await startFixture(false)
      process.env.YIMENG_API_TOKEN = fixture.token
      let overlay = await readFile(
        join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8',
      )
      for (const name of [
        'client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter',
        'qingmu-imago-method-adapter', 'qingmu-yimeng-command-adapter',
        'client-ui-qingmu-cockpit',
      ]) {
        overlay = overlay.replace(
          `name: '@deepseek-ai/dsh-experimental-${name}'`,
          `name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/experimental', name, 'lib/index.js')).href)}`,
        )
      }
      overlay += `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
      overlay += `\n- id: qingmu-imago-method-adapter\n  config:\n    coreRoot: ${JSON.stringify('/Users/a1234/Downloads/imago-os-core')}\n`
      const overlayPath = join(root, 'rc1-decision.overlay.yml')
      await writeFile(overlayPath, overlay)
      scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath, welcomeNoticePending: true })
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu',
        'packages/experimental/client-ui-brand-qingmu')
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit',
        'packages/experimental/client-ui-qingmu-cockpit')
      await scaffold.ctx.loader.await()
      const readEntry = [...scaffold.ctx.loader.entries()]
        .find(entry => entry.options.id === 'qingmu-yimeng-read-adapter')
      expect(readEntry?.options.config).toMatchObject({ baseUrl: fixture.baseUrl })
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
    })

    afterAll(async () => {
      try {
        await context?.close()
        await browser?.close()
        await scaffold?.close()
      } finally {
        await stopFixture(child)
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('plays the bound final continuously, posts only rejection, and recovers after restart', async () => {
      if (context === undefined || browser === undefined || writerRoot === undefined) {
        throw new Error('E2E dependencies were not started')
      }
      const page = await context.newPage()
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
        if (url.pathname === '/api/qingmu/editorial-handoff/final-content-decision'
          && request.method() === 'POST') decisionPosts.push(request.postData() ?? '')
      })
      const dialog = await enterRc1(page)
      await expect.poll(
        () => dialog.getByText('本次完整播放进度: 0%').isVisible(),
        { timeout: 15_000 },
      ).toBe(true)
      const video = dialog.locator('video')
      const mediaProbe = await video.evaluate(async (element) => {
        if (!(element instanceof HTMLVideoElement)) throw new Error('final media element missing')
        const response = await fetch(element.currentSrc || element.src, {
          headers: { range: 'bytes=0-1023' }, cache: 'no-store',
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          contentRange: response.headers.get('content-range'),
          size: bytes.byteLength,
          signature: String.fromCharCode(...bytes.slice(4, 8)),
          errorBody: response.ok ? null : new TextDecoder().decode(bytes),
        }
      })
      expect(mediaProbe.status).toBe(206)
      expect(mediaProbe.contentType).toBe('video/mp4')
      expect(mediaProbe.contentRange).toMatch(/^bytes 0-1023\//)
      expect(mediaProbe.size).toBe(1024)
      expect(mediaProbe.signature).toBe('ftyp')
      expect(mediaProbe.errorBody).toBeNull()
      await video.evaluate(async (element) => {
        if (!(element instanceof HTMLVideoElement)) throw new Error('final media element missing')
        await element.play()
      })
      await expect.poll(
        () => dialog.getByText('本次完整播放进度: 100%').isVisible(),
        { timeout: 15_000 },
      ).toBe(true)
      const binding = await page.evaluate(async ({ projectId, episodeId }) => {
        const params = new URLSearchParams({ projectId, episodeId })
        const response = await fetch(`/api/qingmu/editorial-handoff/rc1-status?${params.toString()}`)
        const body = await response.json() as { contentReview: { binding: Record<string, unknown> } }
        return body.contentReview.binding
      }, { projectId: fixture.projectId, episodeId: fixture.episodeId })
      const forbiddenBody = {
        decision: 'rejected', binding, playedCoverage: 1,
        checks: { picture_and_timing_reviewed: false, dialogue_and_audio_reviewed: true,
          continuity_and_content_reviewed: true },
        secondConfirmed: false, reason: 'picture_or_timing', note: 'must not be written',
        idempotencyKey: 'forbidden-host-decision-12345678',
      }
      const hostWithoutCookie = await page.evaluate(async ({ projectId, episodeId, body }) => {
        const params = new URLSearchParams({ projectId, episodeId })
        const response = await fetch(
          `/api/qingmu/editorial-handoff/final-content-decision?${params.toString()}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        )
        return response.status
      }, { projectId: fixture.projectId, episodeId: fixture.episodeId, body: forbiddenBody })
      expect(hostWithoutCookie).toBe(409)
      const writerRoute = `${fixture.baseUrl}/api/qingmu/projects/${fixture.projectId}`
        + `/episodes/${fixture.episodeId}/editorial-handoff/final-content-decision`
      const bearerIntent = await fetch(`${writerRoute}/intent`, { method: 'POST', headers: {
        authorization: `Bearer ${fixture.token}`, 'content-type': 'application/json',
      }, body: JSON.stringify(forbiddenBody) })
      const bearerWrite = await fetch(writerRoute, { method: 'POST', headers: {
        authorization: `Bearer ${fixture.token}`, 'content-type': 'application/json',
      }, body: JSON.stringify(forbiddenBody) })
      expect([bearerIntent.status, bearerWrite.status]).toEqual([403, 403])
      const beforeLogin = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
        'import sqlite3,sys',
        'c=sqlite3.connect(sys.argv[1])',
        'print(c.execute("SELECT count(*) FROM command_receipts WHERE command_type=?",("episode.final_content_decision.record.v1",)).fetchone()[0])',
      ].join('\n'), fixture.sqlitePath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
      expect(beforeLogin.stdout.trim()).toBe('0')
      decisionPosts.length = 0

      await dialog.getByLabel('账号').fill('ledger-fixture')
      await dialog.getByLabel('密码').fill('fixture-password')
      await dialog.getByRole('button', { name: '验证本人会话', exact: true }).click()
      await expect.poll(() => dialog.getByText(
        '已建立最近的本人浏览器会话；后端仍会逐次核对对象和版本。',
      ).isVisible()).toBe(true)
      await dialog.getByLabel('给本次内容决定的备注（可选）').fill('隔离自动化：画面节奏需返修。')
      await dialog.getByLabel('退回修改原因').selectOption('picture_or_timing')
      const submitted = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/qingmu/editorial-handoff/final-content-decision')
      await dialog.getByRole('button', { name: '退回修改', exact: true }).click()
      const submittedResponse = await submitted
      if (submittedResponse.status() !== 200) {
        const committed = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
          'import sqlite3,sys',
          'c=sqlite3.connect(sys.argv[1])',
          'print(c.execute("SELECT count(*) FROM command_receipts WHERE command_type=?",("episode.final_content_decision.record.v1",)).fetchone()[0])',
        ].join('\n'), fixture.sqlitePath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
        throw new Error(
          `human rejection failed ${String(submittedResponse.status())}; committed=${committed.stdout.trim()}`,
        )
      }
      await expect.poll(
        () => dialog.getByText('当前成片已退回修改，不得进入组织发布。').isVisible(),
      ).toBe(true)
      expect(decisionPosts).toHaveLength(1)
      expect(JSON.parse(decisionPosts[0] ?? '{}')).toMatchObject({
        decision: 'rejected', playedCoverage: 1, reason: 'picture_or_timing',
      })
      expect(externalRequests).toEqual([])

      const facts = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
        'import json,sqlite3,sys',
        'c=sqlite3.connect(sys.argv[1])',
        'r=c.execute("SELECT response_json FROM command_receipts WHERE command_type=?",("episode.final_content_decision.record.v1",)).fetchall()',
        'print(json.dumps({"count":len(r),"decision":json.loads(r[0][0])["decision"] if r else None}))',
      ].join('\n'), fixture.sqlitePath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
      expect(JSON.parse(facts.stdout)).toEqual({ count: 1, decision: 'rejected' })

      await stopFixture(child)
      fixture = await startFixture(true)
      process.env.YIMENG_API_TOKEN = fixture.token
      await page.close()
      await context.close()
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
      const freshPage = await context.newPage()
      freshPage.on('request', (request) => {
        const url = new URL(request.url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
        if (url.pathname === '/api/qingmu/editorial-handoff/final-content-decision'
          && request.method() === 'POST') decisionPosts.push(request.postData() ?? '')
      })
      const freshDialog = await enterRc1(freshPage)
      await expect.poll(
        () => freshDialog.getByText('当前成片已退回修改，不得进入组织发布。').isVisible(),
        { timeout: 15_000 },
      ).toBe(true)
      await expect.poll(
        () => freshDialog.getByRole('button', { name: '接受当前最终成片', exact: true }).isDisabled(),
      ).toBe(true)
      expect(decisionPosts).toHaveLength(1)
      expect(externalRequests).toEqual([])
    }, 90_000)
  },
)
