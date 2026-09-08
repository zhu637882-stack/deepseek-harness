// Chromium -> built Host -> actual Writer FastAPI/SQLite -> persisted human review.
import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
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
  readonly username: string
  readonly password: string
  readonly projectId: string
  readonly episodeId: string
  readonly storyboardRevisionId: string
  readonly frameId: string
  readonly promptIrId: string
  readonly promptIrVersion: number
  readonly promptIrContentSha256: string
  readonly draftId: string
  readonly taskId: string
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

const writerRoot = process.env.QINGMU_ENTITY_REVIEW_WRITER_ROOT
const fixturePython = process.env.QINGMU_ENTITY_REVIEW_PYTHON
const extraPythonPath = process.env.QINGMU_ENTITY_REVIEW_PYTHONPATH

describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot || !fixturePython)(
  'web e2e: PromptIR entity-draft natural-person review', () => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let context: BrowserContext | undefined
    let fixture: Fixture
    const originalToken = process.env.YIMENG_API_TOKEN
    const externalRequests: string[] = []
    const decisionBodies: Record<string, unknown>[] = []

    async function startFixture(resume: boolean): Promise<Fixture> {
      if (root === undefined || writerRoot === undefined || fixturePython === undefined) {
        throw new Error('fixture roots are required')
      }
      child = spawn(fixturePython, [
        '-B', join(writerRoot, 'scripts/qingmu_entity_draft_review_fixture.py'),
        '--root', join(root, 'writer'), ...(resume ? ['--resume'] : []),
      ], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          PYTHONPATH: [extraPythonPath, join(writerRoot, 'backend/src')].filter(Boolean).join(delimiter),
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const server = child
      return await new Promise<Fixture>((resolve, reject) => {
        let output = ''; let stderr = ''
        const timer = setTimeout(() => reject(new Error(
          `FastAPI entity-review fixture readiness timed out: ${stderr.slice(-3000)}`,
        )), 35_000)
        server.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-6000) })
        server.once('error', (error) => { clearTimeout(timer); reject(error) })
        server.once('exit', (code) => {
          clearTimeout(timer); reject(new Error(`FastAPI entity-review fixture exited ${String(code)}: ${stderr}`))
        })
        server.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          for (;;) {
            const newline = output.indexOf('\n')
            if (newline < 0) break
            const line = output.slice(0, newline); output = output.slice(newline + 1)
            if (!line.startsWith('{')) continue
            const value = JSON.parse(line) as Fixture
            if (typeof value.baseUrl === 'string' && typeof value.promptIrId === 'string') {
              clearTimeout(timer); resolve(value)
            }
          }
        })
      })
    }

    function monitor(page: Page): void {
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
        if (url.pathname === '/api/qingmu/entity-draft-human-review/decision'
          && request.method() === 'POST') {
          decisionBodies.push(JSON.parse(request.postData() ?? '{}') as Record<string, unknown>)
        }
      })
    }

    async function enter(page: Page): Promise<ReturnType<Page['getByRole']>> {
      if (scaffold === undefined) throw new Error('Host scaffold unavailable')
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      const welcome = page.getByRole('dialog', { name: '青木 OS 早期共创说明' })
      try {
        await welcome.waitFor({ state: 'visible', timeout: 5_000 })
        await welcome.getByRole('button', { name: '进入青木 OS' }).click()
        await welcome.waitFor({ state: 'detached', timeout: 15_000 })
      } catch { if (await welcome.isVisible()) throw new Error('welcome notice could not be dismissed') }
      const readOnly = page.getByRole('button', { name: '先以只读方式进入' })
      try { await readOnly.waitFor({ state: 'visible', timeout: 3_000 }); await readOnly.click() }
      catch { if (await readOnly.isVisible()) throw new Error('read-only entry could not be selected') }
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      const cockpit = page.getByRole('button', { name: '青木制作台', exact: true })
      await expect.poll(async () => await dialog.isVisible() || await cockpit.isVisible(), {
        timeout: 20_000,
      }).toBe(true)
      if (!await dialog.isVisible()) {
        await cockpit.click()
      }
      await dialog.waitFor({ state: 'visible', timeout: 15_000 })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await dialog.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      try {
        await dialog.getByText('关联实体草稿人工审核', { exact: true }).waitFor({ timeout: 20_000 })
      } catch (error) {
        throw new Error(`entity review surface unavailable: ${(await dialog.innerText()).slice(0, 6000)}`, { cause: error })
      }
      return dialog
    }

    async function sqliteFacts(): Promise<Record<string, unknown>> {
      if (fixturePython === undefined) throw new Error('fixture Python unavailable')
      const result = await execFile(fixturePython, ['-c', [
        'import json,sqlite3,sys',
        'c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row',
        'd=c.execute("SELECT status,evidence_json FROM entity_drafts WHERE id=?",(sys.argv[2],)).fetchone()',
        't=c.execute("SELECT id,local_status,provider_status,kernel_status FROM generation_tasks").fetchall()',
        'm=c.execute("SELECT generation_job_id,prompt_ir_id FROM generation_job_prompt_irs").fetchall()',
        'cols=[x[1] for x in c.execute("PRAGMA table_info(generation_tasks)").fetchall()]',
        'print(json.dumps({"draftStatus":d["status"],"review":json.loads(d["evidence_json"]).get("humanReview"),"tasks":[dict(x) for x in t],"mappings":[dict(x) for x in m],"generationTasksHasPromptIrColumn":any("prompt_ir" in x for x in cols),"outboxCount":c.execute("SELECT count(*) FROM domain_outbox").fetchone()[0]}))',
      ].join('\n'), fixture.sqlitePath, fixture.draftId], {
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' },
      })
      return JSON.parse(result.stdout) as Record<string, unknown>
    }

    beforeAll(async () => {
      if (!writerRoot || !fixturePython || webSnapshotMode() === 'record') {
        throw new Error('explicit isolated Writer and keyless snapshot mode are required')
      }
      root = await mkdtemp(join(tmpdir(), 'qingmu-entity-review-e2e-'))
      fixture = await startFixture(false)
      process.env.YIMENG_API_TOKEN = fixture.token
      let overlay = await readFile(join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8')
      for (const name of [
        'client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter',
        'qingmu-imago-method-adapter', 'qingmu-yimeng-command-adapter',
        'qingmu-director-context-bridge',
        'client-ui-qingmu-cockpit',
      ]) {
        overlay = overlay.replace(
          `name: '@deepseek-ai/dsh-experimental-${name}'`,
          `name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/experimental', name, 'lib/index.js')).href)}`,
        )
      }
      overlay += `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
      overlay += `\n- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
      overlay += `\n- id: qingmu-imago-method-adapter\n  config:\n    coreRoot: ${JSON.stringify('/Users/a1234/Downloads/imago-os-core')}\n`
      const overlayPath = join(root, 'entity-review.overlay.yml')
      await writeFile(overlayPath, overlay)
      scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath, welcomeNoticePending: true })
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu',
        'packages/experimental/client-ui-brand-qingmu')
      await mountClient(scaffold, '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit',
        'packages/experimental/client-ui-qingmu-cockpit')
      await scaffold.ctx.loader.await()
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    }, 60_000)

    afterAll(async () => {
      try { await context?.close(); await browser?.close(); await scaffold?.close() }
      finally {
        await stopFixture(child)
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('accepts through a recent cookie session and recovers after Writer restart', async () => {
      if (context === undefined || browser === undefined || writerRoot === undefined || fixturePython === undefined) {
        throw new Error('E2E dependencies were not started')
      }
      const before = await sqliteFacts()
      const page = await context.newPage(); monitor(page)
      const dialog = await enter(page)
      await dialog.getByLabel('本人账号').fill(fixture.username)
      await dialog.getByLabel('本人密码').fill(fixture.password)
      await dialog.getByRole('button', { name: '验证本人会话' }).click()
      await dialog.getByText(/person-owner/).waitFor({ timeout: 15_000 })
      await expect.poll(() => dialog.getByText(/PendingReview/).isVisible()).toBe(true)

      const writerRoute = `${fixture.baseUrl}/api/qingmu/projects/${fixture.projectId}`
        + `/episodes/${fixture.episodeId}/storyboard-revisions/${fixture.storyboardRevisionId}`
        + `/frames/${fixture.frameId}/prompt-irs/${fixture.promptIrId}`
        + `/entity-drafts/${fixture.draftId}/review`
      const forbiddenBody = {
        decision: 'accepted', note: null, confirmed: true,
        idempotencyKey: 'entity-review-bearer-forbidden',
      }
      const bearerIntent = await fetch(`${writerRoute}/intent`, { method: 'POST', headers: {
        authorization: `Bearer ${fixture.token}`, origin: fixture.baseUrl, 'content-type': 'application/json',
      }, body: JSON.stringify(forbiddenBody) })
      const bearerWrite = await fetch(writerRoute, { method: 'POST', headers: {
        authorization: `Bearer ${fixture.token}`, origin: fixture.baseUrl, 'content-type': 'application/json',
      }, body: JSON.stringify(forbiddenBody) })
      expect([bearerIntent.status, bearerWrite.status]).toEqual([403, 403])

      await dialog.getByLabel(/我已核对当前 PromptIR/).check()
      const submitted = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/qingmu/entity-draft-human-review/decision')
      await dialog.getByRole('button', { name: /接受当前实体草稿/ }).click()
      const decisionResponse = await submitted
      expect(decisionResponse.status()).toBe(200)
      const receipt = await decisionResponse.json() as Record<string, unknown>
      await expect.poll(() => dialog.getByText(/Accepted/).isVisible()).toBe(true)
      expect(decisionBodies).toHaveLength(1)
      expect(JSON.stringify(decisionBodies[0])).not.toMatch(/actor|reviewer|person|session/iu)

      const recovered = await page.evaluate(async ({ coordinates, requestSha256, idempotencyKey }) => {
        const query = new URLSearchParams({ ...coordinates, requestSha256, idempotencyKey })
        const response = await fetch(`/api/qingmu/entity-draft-human-review/receipt?${query}`)
        return { status: response.status, body: await response.json() as Record<string, unknown> }
      }, {
        coordinates: {
          projectId: fixture.projectId, episodeId: fixture.episodeId,
          storyboardRevisionId: fixture.storyboardRevisionId, frameId: fixture.frameId,
          promptIrId: fixture.promptIrId, draftId: fixture.draftId,
        },
        requestSha256: String(receipt.requestSha256),
        idempotencyKey: String(receipt.idempotencyKey),
      })
      expect(recovered.status).toBe(200)
      expect(recovered.body.reviewIdentity).toBe(receipt.reviewIdentity)

      const after = await sqliteFacts()
      expect((after.tasks as unknown[])).toHaveLength(1)
      expect((after.mappings as unknown[])).toHaveLength(1)
      expect(after.outboxCount).toBe(before.outboxCount)
      expect(after).toMatchObject({
        draftStatus: 'Accepted', generationTasksHasPromptIrColumn: false,
        tasks: [{ id: fixture.taskId, local_status: 'queued', provider_status: 'NOT_SUBMITTED', kernel_status: 'Reserved' }],
        mappings: [{ generation_job_id: fixture.taskId, prompt_ir_id: fixture.promptIrId }],
      })
      const review = after.review as Record<string, unknown>
      expect(review).toMatchObject({ status: 'Accepted', reviewerUserId: 'owner', source: 'independent_human_review' })

      const quote = await execFile(fixturePython, ['-c', [
        'import json,sys',
        'from pathlib import Path',
        'from jason.domain.store import DramaStore',
        'from jason.apps.studio.production_kernel_service import ProductionKernelService',
        'from jason.apps.studio.qingmu_scene_planning_service import ScenePlanningService',
        'from jason.apps.studio.qingmu_changeset_service import QingmuChangeSetService',
        'from jason.apps.studio.qingmu_first_frame_quote_service import FirstFrameQuoteService',
        'class Cost:',
        '  def _first_frame_preparation_requirements(self,**kw): return [{"frameId":kw["frame_ids"][0]}]',
        's=DramaStore(Path(sys.argv[1]),enable_qingmu_changeset=True)',
        'p=ScenePlanningService(s,ProductionKernelService(s,Path(sys.argv[2])))',
        'c=QingmuChangeSetService(s,imago_attestation_key="test-key-0123456789abcdefghijklmnop",production_kernel=p.kernel)',
        'q=FirstFrameQuoteService(s,p,c,Cost())',
        'x=q._authority_snapshot(actor="owner",project_id=sys.argv[3],episode_id=sys.argv[4],storyboard_revision_id=sys.argv[5],frame_id=sys.argv[6],prompt_ir_id=sys.argv[7],prompt_ir_version=int(sys.argv[8]),prompt_ir_content_sha256=sys.argv[9])',
        'print(json.dumps(x["referenceExecutionBlockers"]))',
      ].join('\n'), fixture.sqlitePath, join(root ?? '', 'writer', 'storage'), fixture.projectId,
      fixture.episodeId, fixture.storyboardRevisionId, fixture.frameId, fixture.promptIrId,
      String(fixture.promptIrVersion), fixture.promptIrContentSha256], {
        env: {
          PATH: process.env.PATH,
          PYTHONPATH: [extraPythonPath, join(writerRoot, 'backend/src')].filter(Boolean).join(delimiter),
          PYTHONDONTWRITEBYTECODE: '1',
        },
      })
      expect(JSON.parse(quote.stdout)).toEqual([])
      expect(externalRequests).toEqual([])

      await stopFixture(child); fixture = await startFixture(true)
      process.env.YIMENG_API_TOKEN = fixture.token
      await page.close(); await context.close()
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
      const freshPage = await context.newPage(); monitor(freshPage)
      const freshDialog = await enter(freshPage)
      await freshDialog.getByLabel('本人账号').fill(fixture.username)
      await freshDialog.getByLabel('本人密码').fill(fixture.password)
      await freshDialog.getByRole('button', { name: '验证本人会话' }).click()
      await expect
        .poll(() => freshDialog.getByText(/Accepted/).isVisible(), { timeout: 15_000 })
        .toBe(true)
      expect(decisionBodies).toHaveLength(1)
      expect(externalRequests).toEqual([])
    }, 120_000)
  },
)
