// E8-3A: Chromium -> built Host -> actual FastAPI -> selected returned-master technical QC.
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

interface BoundaryFacts {
  readonly assetCount: number
  readonly protectedCounts: Readonly<Record<string, number | null>>
  readonly finalOutputCount: number
  readonly releaseAuthority: null | {
    readonly revision: number
    readonly current_final_output_id: string
    readonly current_final_asset_id: string
    readonly accepted_final_output_id: string | null
    readonly accepted_final_asset_id: string | null
    readonly accepted_final_sha256: string | null
    readonly accepted_readiness_token: string | null
  }
  readonly technicalQcReceiptCount: number
  readonly candidates: readonly {
    readonly id: string
    readonly asset_type: string
    readonly role: string
    readonly local_path: string
    readonly sha256: string
    readonly selection_status: string
    readonly quality_status: string
    readonly is_selected: number
  }[]
}

async function readBoundaryFacts(writerRoot: string, sqlitePath: string): Promise<BoundaryFacts> {
  const result = await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
    'import json,sqlite3,sys',
    'conn=sqlite3.connect(sys.argv[1])',
    'conn.row_factory=sqlite3.Row',
    'tables={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")}',
    'names=["prompt_ir_sets","human_decisions","generation_tasks","stage_runs","release_manifests"]',
    'counts={name:(conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] if name in tables else None) for name in names}',
    'candidates=[dict(r) for r in conn.execute("SELECT id,asset_type,role,local_path,sha256,selection_status,quality_status,is_selected FROM assets WHERE id LIKE \'asset_editorial_master_%\' ORDER BY id")]',
    'authority=(dict(conn.execute("SELECT revision,current_final_output_id,current_final_asset_id,accepted_final_output_id,accepted_final_asset_id,accepted_final_sha256,accepted_readiness_token FROM episode_release_authority").fetchone()) if "episode_release_authority" in tables and conn.execute("SELECT COUNT(*) FROM episode_release_authority").fetchone()[0] else None)',
    'final_count=(conn.execute("SELECT COUNT(*) FROM final_outputs").fetchone()[0] if "final_outputs" in tables else 0)',
    'qc_receipts=(conn.execute("SELECT COUNT(*) FROM command_receipts WHERE command_type=\'qingmu.returned_master.technical_qc.v1\'").fetchone()[0] if "command_receipts" in tables else 0)',
    'print(json.dumps({"assetCount":conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0],"protectedCounts":counts,"finalOutputCount":final_count,"releaseAuthority":authority,"technicalQcReceiptCount":qc_receipts,"candidates":candidates},sort_keys=True))',
  ].join('\n'), sqlitePath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
  return JSON.parse(result.stdout) as BoundaryFacts
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
describe.skipIf(process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu' || !writerRoot).each(
  ['passed', 'failed'] as const,
)(
  'web e2e: editorial handoff package and returned-master technical QC (%s)', (expectedQcStatus) => {
    let root: string | undefined
    let child: ChildProcess | undefined
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    let page: Page
    let fixture: Fixture
    let beforeBoundaryFacts: BoundaryFacts
    let beforeStorage: Record<string, string>
    let writerSpoolRoot = ''
    const originalToken = process.env.YIMENG_API_TOKEN
    const originalEditorialKey = process.env.QINGMU_EDITORIAL_HANDOFF_KEY
    const captured: Record<string, unknown>[] = []
    const downloadRequests: string[] = []
    const masterRequests: string[] = []
    const candidateRequests: string[] = []
    const selectionRequests: string[] = []
    const technicalQcRequests: string[] = []

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
      beforeBoundaryFacts = await readBoundaryFacts(writerRoot, fixture.sqlitePath)
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
        if (url.pathname === '/api/qingmu/editorial-handoff/master-preflight') masterRequests.push(request.url())
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-candidate' && request.method() === 'POST') {
          candidateRequests.push(request.url())
        }
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-selection' && request.method() === 'POST') {
          selectionRequests.push(request.url())
        }
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-technical-qc' && request.method() === 'POST') {
          technicalQcRequests.push(request.url())
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
        await stopFixture(child)
        if (originalToken === undefined) Reflect.deleteProperty(process.env, 'YIMENG_API_TOKEN')
        else process.env.YIMENG_API_TOKEN = originalToken
        if (originalEditorialKey === undefined) Reflect.deleteProperty(process.env, 'QINGMU_EDITORIAL_HANDOFF_KEY')
        else process.env.QINGMU_EDITORIAL_HANDOFF_KEY = originalEditorialKey
        if (root !== undefined) await rm(root, { recursive: true, force: true })
      }
    })

    it('runs technical QC on the exact selected returned master and recovers it after restart', async () => {
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
        for (let attempt = 0; attempt < 12 && !await shotList.isVisible(); attempt += 1) {
          await page.waitForTimeout(500)
          const response = page.waitForResponse(candidate => (
            new URL(candidate.url()).pathname === '/qingmu-yimeng/editorialHandoff'
          ), { timeout: 10_000 })
          await dialog.getByRole('button', { name: '刷新交接事实' }).click()
          await (await response).finished()
          await shotList.waitFor({ timeout: 1_000 }).catch(() => undefined)
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

      const packagePaths: string[] = []
      for (let attempt = 0; attempt < 1; attempt += 1) {
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
      await packageInput.setInputFiles(packagePaths[0] as string)
      await dialog.getByRole('button', { name: '复验并预览' }).click()
      await dialog.getByText('SHA-256 与大小均精确匹配原下载终态').waitFor()
      expect(await dialog.getByText('结构、媒体引用与 otio_json 复验通过').count()).toBe(1)
      expect(await dialog.getByText('仍绑定当前项目、剧集、来源与投影').count()).toBe(1)
      expect(await dialog.getByText('Picture · Video · 2').count()).toBe(1)
      expect(await dialog.getByText('Dialogue · Audio · 2').count()).toBe(1)
      expect(await dialog.getByText(/仅证明本地包可解析且与相应来源绑定/u).count()).toBe(1)
      expect(await dialog.getByText(/^media\//u).count()).toBeGreaterThan(0)

      const masterEntry = Object.keys(beforeStorage).find(path => path.endsWith('.mp4'))
      if (masterEntry === undefined) throw new Error('Returned-master media fixture missing')
      let masterPath = join(fixture.storageRoot, masterEntry)
      if (expectedQcStatus === 'failed') {
        masterPath = join(root, 'technical-failed-master.mp4')
        await execFile('ffmpeg', [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:r=24:d=2',
          '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
          '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'mp3', '-shortest',
          '-movflags', '+faststart', masterPath,
        ], { env: { PATH: process.env.PATH } })
      }
      const masterSha = createHash('sha256').update(await readFile(masterPath)).digest('hex')
      const masterInput = dialog.getByLabel('选择本地母版（MP4 / MOV / WebM）')
      await expect.poll(() => masterInput.isEnabled()).toBe(true)
      await masterInput.setInputFiles(masterPath)
      await dialog.getByRole('button', { name: '预检本地母版' }).click()
      await dialog.getByText('仅预检，未入库、未发布、未签收。').waitFor()
      expect(await dialog.getByText('当前技术预检未发现结构阻塞；仍不是正式回传、发布 Ready 或人工签收。').count()).toBe(1)
      expect(await dialog.getByText(`Master SHA: ${masterSha}`).count()).toBe(1)
      expect(await dialog.getByText('720 × 1280').count()).toBeGreaterThan(0)
      expect(await dialog.getByText('1', { exact: true }).count()).toBeGreaterThan(0)
      await dialog.getByRole('button', { name: '保存为回传候选', exact: true }).click()
      await dialog.getByText('候选已从易梦原回执读回；状态仍为未选择、待质检、未批准、未发布。').waitFor()
      expect(candidateRequests).toHaveLength(1)
      expect(await dialog.getByText('未选择 · 未批准 · 未发布', { exact: true }).count()).toBe(1)
      const savedFacts = await readBoundaryFacts(writerRoot, fixture.sqlitePath)
      expect(savedFacts.assetCount).toBe(beforeBoundaryFacts.assetCount + 1)
      expect(savedFacts.protectedCounts).toEqual(beforeBoundaryFacts.protectedCounts)
      expect(savedFacts.candidates).toEqual([expect.objectContaining({
        asset_type: 'video',
        role: 'editorial_master_candidate',
        sha256: masterSha,
        selection_status: 'Unselected',
        quality_status: 'pending',
        is_selected: 0,
      })])
      const candidatePath = join(fixture.storageRoot, savedFacts.candidates[0]?.local_path ?? '')
      expect(createHash('sha256').update(await readFile(candidatePath)).digest('hex')).toBe(masterSha)
      const selectPreview = dialog.getByRole('button', { name: '预览设为正式母版', exact: true })
      await expect.poll(() => selectPreview.isEnabled(), { timeout: 10_000 }).toBe(true)
      await selectPreview.click()
      await dialog.getByText('正式母版选择预览', { exact: true }).waitFor()
      expect(await dialog.getByText('同一资产与原始字节就地晋级，不创建第二份媒体。').count()).toBe(1)
      expect(await dialog.getByText('选择后仍受技术质检、内容批准、发布清单与用户签收门禁阻断。').count()).toBe(1)
      await dialog.getByRole('checkbox', {
        name: '我确认选择这份候选作为当前正式母版；这不是内容批准、发布或最终签收。',
      }).check()
      await dialog.getByRole('button', { name: '确认选择正式母版', exact: true }).click()
      await dialog.getByText('正式母版选择已由易梦原回执确认', { exact: true }).waitFor()
      await dialog.getByText('已选为当前正式母版 · 未发布', { exact: true }).waitFor()
      expect(selectionRequests).toHaveLength(1)
      const selectedFacts = await readBoundaryFacts(writerRoot, fixture.sqlitePath)
      expect(selectedFacts.assetCount).toBe(savedFacts.assetCount)
      expect(selectedFacts.protectedCounts).toEqual(beforeBoundaryFacts.protectedCounts)
      expect(selectedFacts.finalOutputCount).toBe(beforeBoundaryFacts.finalOutputCount + 1)
      expect(selectedFacts.candidates).toEqual([expect.objectContaining({
        id: savedFacts.candidates[0]?.id,
        asset_type: 'final_video', role: 'b7_final', sha256: masterSha,
        selection_status: 'Selected', quality_status: 'pending', is_selected: 1,
      })])
      expect(selectedFacts.releaseAuthority).toMatchObject({
        revision: (beforeBoundaryFacts.releaseAuthority?.revision ?? 0) + 1,
        current_final_asset_id: savedFacts.candidates[0]?.id,
        accepted_final_output_id: null,
        accepted_final_asset_id: null,
      })
      expect(createHash('sha256').update(await readFile(candidatePath)).digest('hex')).toBe(masterSha)
      const prepareTechnicalQc = dialog.getByRole('button', { name: '准备技术质检', exact: true })
      await expect.poll(() => prepareTechnicalQc.isEnabled(), { timeout: 10_000 }).toBe(true)
      await prepareTechnicalQc.click()
      const confirmTechnicalQc = dialog.getByRole('checkbox', {
        name: '我确认对当前绑定的同一母版运行本地技术探测；这不是内容批准、发布或最终签收。',
      })
      await expect.poll(async () => {
        if (await confirmTechnicalQc.isEnabled()) return true
        throw new Error(await dialog.innerText())
      }, { timeout: 10_000 }).toBe(true)
      await confirmTechnicalQc.check()
      await dialog.getByRole('button', { name: '运行技术质检', exact: true }).click()
      const technicalConclusion = expectedQcStatus === 'passed'
        ? '技术事实通过，质量状态已记录'
        : '发现确定性技术问题，当前母版不可发布'
      await dialog.getByText(technicalConclusion, { exact: true }).waitFor({ timeout: 30_000 })
      expect(await dialog.getByText('技术通过 ≠ 内容批准 ≠ manifest 冻结 ≠ 人工签收。', { exact: true }).count()).toBe(1)
      if (expectedQcStatus === 'passed') expect(await dialog.getByText('h264 / aac', { exact: true }).count()).toBe(1)
      expect(technicalQcRequests).toHaveLength(1)
      const qcFacts = await readBoundaryFacts(writerRoot, fixture.sqlitePath)
      expect(qcFacts.assetCount).toBe(selectedFacts.assetCount)
      expect(qcFacts.finalOutputCount).toBe(selectedFacts.finalOutputCount)
      expect(qcFacts.protectedCounts).toEqual(beforeBoundaryFacts.protectedCounts)
      expect(qcFacts.technicalQcReceiptCount).toBe(1)
      expect(qcFacts.candidates).toEqual([expect.objectContaining({
        id: savedFacts.candidates[0]?.id,
        asset_type: 'final_video', role: 'b7_final', sha256: masterSha,
        selection_status: 'Selected', quality_status: expectedQcStatus, is_selected: 1,
      })])
      expect(qcFacts.releaseAuthority).toMatchObject({
        revision: (selectedFacts.releaseAuthority?.revision ?? 0) + 1,
        current_final_asset_id: savedFacts.candidates[0]?.id,
        accepted_final_output_id: null,
        accepted_final_asset_id: null,
        accepted_final_sha256: null,
        accepted_readiness_token: null,
      })
      expect(createHash('sha256').update(await readFile(candidatePath)).digest('hex')).toBe(masterSha)
      const masterRequestUrl = masterRequests.at(-1)
      if (masterRequestUrl === undefined) throw new Error('Master preflight request URL missing')
      const crossProject = await page.evaluate(async (url) => {
        const forged = new URL(url)
        forged.searchParams.set('projectId', 'other-project')
        const response = await fetch(forged, {
          method: 'POST', headers: { 'content-type': 'video/mp4' }, body: new Uint8Array([1]),
        })
        return { status: response.status, body: await response.json() as unknown }
      }, masterRequestUrl)
      expect(crossProject).toEqual({
        status: 403, body: { code: 'editorial_master_preflight_forbidden' },
      })

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
      expect(await readdir(join(scaffold.harnessHome, 'state', 'qingmu-editorial-spool'))).toEqual([])

      for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport)
        const candidateConclusion = dialog.getByText(technicalConclusion, { exact: true })
        await candidateConclusion.scrollIntoViewIfNeeded()
        const conclusionBox = await candidateConclusion.boundingBox()
        expect(conclusionBox).not.toBeNull()
        expect(conclusionBox?.y ?? -1).toBeGreaterThanOrEqual(0)
        expect((conclusionBox?.y ?? viewport.height) + (conclusionBox?.height ?? 1)).toBeLessThanOrEqual(viewport.height)
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        const artifactDir = process.env.QINGMU_E8_ARTIFACT_DIR
        if (artifactDir !== undefined) {
          await mkdir(artifactDir, { recursive: true })
          await page.screenshot({ path: join(artifactDir, `editorial-handoff-${expectedQcStatus}-${viewport.width}x${viewport.height}.png`) })
        }
      }

      await stopFixture(child)
      fixture = await startFixture(true)
      expect(await readdir(writerSpoolRoot)).toEqual(['keep-me.txt'])
      process.env.YIMENG_API_TOKEN = fixture.token
      const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
      const freshPage = await fresh.newPage()
      freshPage.on('request', (request) => {
        const url = new URL(request.url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
          throw new Error(`External browser request forbidden: ${url.origin}`)
        }
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-candidate'
          && request.method() === 'POST') candidateRequests.push(request.url())
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-selection'
          && request.method() === 'POST') selectionRequests.push(request.url())
        if (url.pathname === '/api/qingmu/editorial-handoff/returned-master-technical-qc'
          && request.method() === 'POST') technicalQcRequests.push(request.url())
      })
      await freshPage.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await freshPage.getByRole('button', { name: '青木制作台', exact: true }).click()
      const freshDialog = freshPage.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await freshDialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await freshDialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await freshDialog.getByRole('tab', { name: '费用与交付', exact: true }).click()
      const readCandidates = freshDialog.getByRole('button', { name: '读取已保存候选', exact: true })
      await readCandidates.waitFor({ timeout: 10_000 })
      const recoveredCandidate = freshDialog.getByText('已选为当前正式母版 · 未发布', { exact: true })
      const readCandidateShelf = async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await readCandidates.click()
          await recoveredCandidate.waitFor({ timeout: 5000 }).catch(() => undefined)
          if (await recoveredCandidate.isVisible()) return
          await freshPage.waitForTimeout(500)
        }
        throw new Error(`Persisted candidate did not recover: ${await freshDialog.innerText()}`)
      }
      await readCandidateShelf()
      expect(await freshDialog.getByText(`Master SHA: ${masterSha}`).count()).toBeGreaterThan(0)
      const recoveredTechnicalQc = freshDialog.getByText(technicalConclusion, { exact: true })
      for (let attempt = 0; attempt < 3 && !await recoveredTechnicalQc.isVisible(); attempt += 1) {
        await readCandidates.click()
        await recoveredTechnicalQc.waitFor({ timeout: 5000 }).catch(() => undefined)
      }
      expect(await recoveredTechnicalQc.count()).toBe(1)
      expect(await freshDialog.getByText('技术通过 ≠ 内容批准 ≠ manifest 冻结 ≠ 人工签收。', { exact: true }).count()).toBe(1)
      expect(await readBoundaryFacts(writerRoot, fixture.sqlitePath)).toEqual(qcFacts)
      if (expectedQcStatus === 'passed') {
        const requestsBeforeDrift = technicalQcRequests.length
        await execFile(join(writerRoot, '.venv/bin/python'), ['-c', [
          'import sqlite3,sys',
          'conn=sqlite3.connect(sys.argv[1])',
          'conn.execute("UPDATE storyboard_frames SET title=title || ? WHERE id=?",("（来源漂移）",sys.argv[2]))',
          'conn.commit()',
        ].join('\n'), fixture.sqlitePath, fixture.frameIds[0] as string], {
          env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' },
        })
        await readCandidates.click()
        await freshDialog.getByText(/returned_master_qc_editorial_binding_drift/u)
          .waitFor({ timeout: 10_000 })
          .catch(async () => {
            throw new Error(`Editorial drift did not surface: ${await freshDialog.innerText()}`)
          })
        expect(await recoveredTechnicalQc.count()).toBe(0)
        expect(technicalQcRequests).toHaveLength(requestsBeforeDrift)
        expect((await readBoundaryFacts(writerRoot, fixture.sqlitePath)).technicalQcReceiptCount).toBe(1)
      }
      const candidateBytes = await readFile(candidatePath)
      await writeFile(candidatePath, Buffer.from('tampered-editorial-master-candidate'))
      await readCandidates.click()
      await freshDialog.getByText(/candidate_list_failed/u).waitFor()
      expect(await recoveredCandidate.count()).toBe(0)
      await freshDialog.getByText(/technical_qc_status_failed/u).waitFor()
      expect(await recoveredTechnicalQc.count()).toBe(0)
      await writeFile(candidatePath, candidateBytes)
      await readCandidateShelf()
      await fresh.close()

      expect(captured.length).toBeGreaterThan(0)
      const finalFacts = await readBoundaryFacts(writerRoot, fixture.sqlitePath)
      expect(finalFacts).toEqual(qcFacts)
      const finalStorage = await fingerprintFiles(fixture.storageRoot)
      expect(Object.entries(beforeStorage).every(([path, digest]) => finalStorage[path] === digest)).toBe(true)
      expect(Object.keys(finalStorage)).toHaveLength(Object.keys(beforeStorage).length + 1)
      expect(candidateRequests).toHaveLength(1)
      expect(selectionRequests).toHaveLength(1)
      expect(technicalQcRequests).toHaveLength(1)
    }, 180_000)
  },
)
