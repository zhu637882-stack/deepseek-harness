// Actual browser -> built Host RPC -> independent FastAPI -> isolated persistent SQLite.
// Identities and local media are synthetic; no Provider or human approval is asserted.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
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
  readonly frameIds: readonly string[]
  readonly storyboardRevisionId: string
  readonly sqlitePath: string
  readonly storageRoot: string
}
interface Inspection {
  readonly promptIrEditReceiptCount: number
  readonly promptIrs: readonly { readonly frame_id: string; readonly status: string; readonly id: string }[]
  readonly promptIrVersionsByFrame: Record<string, unknown>
  readonly takes: readonly unknown[]
}
const writerRoot = process.env.QINGMU_DIRECTOR_YIMENG_ROOT
describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot)('web e2e: director Draft persistence', () => {
  let root: string | undefined
  let child: ChildProcess | undefined
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let fixture: Fixture
  const originalToken = process.env.YIMENG_API_TOKEN
  const originalAttestation = process.env.QINGMU_IMAGO_ATTESTATION_KEY
  const captured: { path: string; body: Record<string, unknown> }[] = []
  const safeEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, PYTHONPATH: join(writerRoot!, 'backend/src'), PYTHONDONTWRITEBYTECODE: '1' })
  const inspect = (): Inspection => JSON.parse(execFileSync(join(writerRoot!, '.venv/bin/python'), [
    '-B', join(writerRoot!, 'scripts/qingmu_director_workspace_fixture.py'), '--root', join(root!, 'yimeng'), '--inspect',
  ], { cwd: root, env: safeEnv(), encoding: 'utf8' })) as Inspection
  const stop = async (): Promise<void> => {
    if (child?.exitCode !== null) return
    const server = child
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { server.kill('SIGKILL') }, 5000)
      server.once('exit', () => { clearTimeout(timer); resolve() })
      server.kill('SIGTERM')
    })
  }
  const start = async (resume = false): Promise<Fixture> => {
    child = spawn(join(writerRoot!, '.venv/bin/python'), ['-B', join(writerRoot!, 'scripts/qingmu_director_workspace_fixture.py'),
      '--root', join(root!, 'yimeng'), ...(resume ? ['--resume'] : [])], { cwd: root, env: safeEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    const server = child
    return await new Promise<Fixture>((resolve, reject) => {
      let stdout = ''; let stderr = ''
      const timer = setTimeout(() => { reject(new Error(`Fixture timeout: ${stderr.slice(-2000)}`)) }, 30_000)
      server.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
      server.once('error', (error) => { clearTimeout(timer); reject(error) })
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exit ${String(code)}: ${stderr.slice(-2000)}`)) })
      server.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        const line = stdout.split('\n').find(item => item.startsWith('{') && item.endsWith('}'))
        if (line === undefined) return
        const value = JSON.parse(line) as Fixture
        if (!value.baseUrl) return
        clearTimeout(timer); resolve(value)
      })
    })
  }
  const openDirector = async (): Promise<void> => {
    await page.getByRole('button', { name: '青木制作台', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
    await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
    await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
    await dialog.getByRole('tab', { name: '导演工作区', exact: true }).click()
    try { await page.getByRole('textbox', { name: '完整视频提示词', exact: true }).waitFor({ timeout: 5000 }) }
    catch (cause) { throw new Error((await dialog.innerText()).slice(0, 6000), { cause }) }
  }
  beforeAll(async () => {
    if (!writerRoot || webSnapshotMode() === 'record') throw new Error('Explicit isolated writer root and keyless mode required')
    root = await realpath(await mkdtemp(join(tmpdir(), 'qingmu-director-real-')))
    fixture = await start()
    expect(fixture.sqlitePath.startsWith(join(root, 'yimeng') + '/')).toBe(true)
    expect(fixture.storageRoot.startsWith(join(root, 'yimeng') + '/')).toBe(true)
    process.env.YIMENG_API_TOKEN = fixture.token
    process.env.QINGMU_IMAGO_ATTESTATION_KEY = 'isolated-director-fixture-method-key-not-production'
    let overlay = await readFile(join(REPO_ROOT, 'packages/experimental/qingmu-web/cordis.patch.yml'), 'utf8')
    for (const name of ['client-ui-brand-qingmu', 'qingmu-yimeng-read-adapter', 'qingmu-imago-method-adapter', 'qingmu-yimeng-command-adapter', 'client-ui-qingmu-cockpit']) {
      overlay = overlay.replace(`name: '@deepseek-ai/dsh-experimental-${name}'`, `name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/experimental', name, 'lib/index.js')).href)}`)
    }
    overlay += `\n- id: qingmu-yimeng-read-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n\n- id: qingmu-yimeng-command-adapter\n  config:\n    baseUrl: ${JSON.stringify(fixture.baseUrl)}\n`
    const overlayPath = join(root, 'director.overlay.yml')
    await writeFile(overlayPath, overlay)
    scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath })
    for (const name of ['client-ui-brand-qingmu', 'client-ui-qingmu-cockpit']) {
      const packageName = `@deepseek-ai/dsh-experimental-${name}`
      const link = join(scaffold.harnessHome, 'profiles/node_modules', ...packageName.split('/'))
      await mkdir(dirname(link), { recursive: true })
      await symlink(join(REPO_ROOT, 'packages/experimental', name), link, 'dir')
      await scaffold.ctx.loader.create({ name: packageName })
    }
    await scaffold.ctx.loader.await()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    page.setDefaultTimeout(8000)
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/qingmu-yimeng/') || path.startsWith('/qingmu-yimeng-command/')) captured.push({ path, body: request.postDataJSON() as Record<string, unknown> })
    })
    page.on('dialog', async (dialog) => { await dialog.accept() })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '进入青木 OS' }).click()
  })
  afterAll(async () => {
    try { await browser?.close(); await scaffold?.close() } finally {
      await stop()
      if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
      else process.env.YIMENG_API_TOKEN = originalToken
      if (originalAttestation === undefined) Reflect.deleteProperty(process.env, 'QINGMU_IMAGO_ATTESTATION_KEY')
      else process.env.QINGMU_IMAGO_ATTESTATION_KEY = originalAttestation
      if (root !== undefined) await rm(root, { recursive: true, force: true })
    }
  })

  it('saves one real Draft, restores after restart, and retains edits through switching and unknown results', async () => {
    const before = inspect()
    await openDirector()
    const input = page.getByRole('textbox', { name: '完整视频提示词', exact: true })
    const candidate = '隔离导演测试：镜头缓慢前推，人物抬眼后停顿。保持原人物与场景；不生成。'
    await input.fill(candidate)
    const shots = page.getByRole('navigation', { name: '场景与镜头' })
    await shots.getByRole('button').nth(1).click()
    await expect.poll(() => input.inputValue()).toBe('fixture video 2')
    await shots.getByRole('button').nth(0).click()
    await expect.poll(() => input.inputValue()).toBe(candidate)
    await page.reload({ waitUntil: 'load' })
    await openDirector()
    await expect.poll(() => input.inputValue()).toBe(candidate)
    await page.getByRole('button', { name: '先运行 IMAGO 方法检查', exact: true }).click()
    const previewButton = page.getByRole('button', { name: '生成 PromptIR ChangeSet 预览', exact: true })
    try { await previewButton.waitFor() }
    catch (cause) { throw new Error((await page.getByRole('dialog').innerText()).slice(-8000), { cause }) }
    await previewButton.click()
    await page.getByRole('checkbox', { name: /我已核对.*Draft/ }).check()
    const save = page.getByRole('button', { name: '确认提交 PromptIR Draft', exact: true })
    // First request never reaches Host; explicit retry uses the same command/key.
    // The retry reaches real Host/API, but its response is lost and recovered read-only.
    let attempts = 0
    await page.route('**/qingmu-yimeng-command/commitPromptIrEdit', async (route) => {
      attempts += 1
      if (attempts === 1) { await route.abort('failed'); return }
      await route.fetch()
      await route.abort('failed')
    })
    await save.dblclick()
    const recover = page.getByRole('button', { name: '只查询原编辑回执', exact: true })
    await recover.waitFor()
    await expect.poll(() => recover.isEnabled()).toBe(true)
    expect(inspect().promptIrEditReceiptCount).toBe(before.promptIrEditReceiptCount)
    await page.getByRole('button', { name: '按原命令重试（相同幂等键）', exact: true }).click()
    await expect.poll(() => recover.isEnabled()).toBe(true)
    expect(inspect().promptIrEditReceiptCount - before.promptIrEditReceiptCount).toBe(1)
    await page.unroute('**/qingmu-yimeng-command/commitPromptIrEdit')
    await recover.click()
    await page.getByText('已从易梦读回草稿；Ready 仍保持原样。', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: '将 Draft 选为 Ready', exact: true }).count()).toBe(0)
    const after = inspect()
    expect(after.promptIrs.filter(item => item.status === 'Draft')).toHaveLength(1)
    expect(after.takes).toEqual(before.takes)
    expect(after.promptIrVersionsByFrame[fixture.frameIds[1]!]).toEqual(before.promptIrVersionsByFrame[fixture.frameIds[1]!])
    expect(after.promptIrs.filter(item => item.status === 'Ready')).toEqual(before.promptIrs.filter(item => item.status === 'Ready'))
    const commits = captured.filter(item => item.path.endsWith('/commitPromptIrEdit'))
    expect(commits).toHaveLength(2)
    expect(commits[1]?.body.payload).toEqual(commits[0]?.body.payload)
    await stop()
    const resumed = await start(true)
    expect(resumed.baseUrl).toBe(fixture.baseUrl)
    // Remove browser text/recovery caches: this read must come from persisted SQLite.
    await page.evaluate(() => { sessionStorage.clear() })
    await page.reload({ waitUntil: 'load' })
    await openDirector()
    await expect.poll(() => input.inputValue()).toBe(candidate)
    expect(inspect()).toEqual(after)
    const recoveryRequest = captured.find(item => item.path.endsWith('/recoverPromptIrEditCommit'))!
    const persistedReceipt = await page.evaluate(async (request) => {
      const response = await fetch('/qingmu-yimeng-command/recoverPromptIrEditCommit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      })
      return await response.json() as { result: { ok: boolean; value: { receipt: { commandReceiptId: string } } } }
    }, recoveryRequest.body)
    expect(persistedReceipt.result.ok).toBe(true)
    expect(persistedReceipt.result.value.receipt.commandReceiptId).toBeTruthy()
    await page.getByRole('region', { name: 'Take 双栏比较' }).waitFor()
    const previewButtons = page.getByRole('button', { name: '载入画面', exact: true })
    await expect.poll(() => previewButtons.count()).toBe(2)
    await previewButtons.nth(0).click()
    await previewButtons.nth(0).click()
    await expect.poll(() => page.locator('video').count()).toBe(2)
    await expect.poll(() => page.locator('video').evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).readyState >= 1))).toBe(true)
    await page.locator('video').first().evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play() })
    await expect.poll(() => page.locator('video').first().evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0)
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport)
      await page.getByRole('navigation', { name: '场景与镜头' }).scrollIntoViewIfNeeded()
      expect(await page.getByRole('region', { name: '导演工作区', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      if (process.env.QINGMU_DIRECTOR_SCREENSHOT_DIR) {
        await mkdir(process.env.QINGMU_DIRECTOR_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.QINGMU_DIRECTOR_SCREENSHOT_DIR, `director-${viewport.width}.png`) })
      }
    }
    expect(await page.locator('body').innerHTML()).not.toContain(fixture.token)
  }, 90_000)
})
