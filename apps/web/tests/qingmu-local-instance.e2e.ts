// The user launcher owns both real processes. Only labeled acceptance data is synthetic.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { describe, it, expect } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT
const core = process.env.IMAGO_OS_CORE_ROOT
interface InstanceResult {
  ready: boolean
  supervisorPid: number
  webUrl: string
  apiUrl: string
  session: string
  dataPreserved: boolean
  backup: string
  integrity: string
}
interface Snapshot { prompts: unknown[][]; receipts: unknown[][]; providerCounts: number[] }
interface RecoveryResponse { result: { ok: boolean; value: { receipt: { commandReceiptId: string } } } }
describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('persistent local user launcher', () => {
  it('persists a real Draft/receipt across stop/start, cache clear, expiry and login; restores a cold backup', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-local-browser-')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Synthetic data; no human signoff or Provider calls.\n')
    const root = join(parent, 'instance')
    const restored = join(parent, 'restored')
    const run = (op: string, target = root, extra: string[] = []): InstanceResult => JSON.parse(execFileSync('python3', [
      join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', target, ...extra,
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as InstanceResult
    const sample = (args: string[] = []): { projectId: string; episodeId: string } => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), [
      '-B', join(writer!, 'tests/qingmu_local_sample.py'), '--root', root, ...args,
    ], { cwd: parent, env: { PATH: process.env.PATH, PYTHONPATH: join(writer!, 'backend/src') }, encoding: 'utf8' })) as { projectId: string; episodeId: string }
    const inspect = (target = root): Snapshot => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps({"prompts":c.execute("SELECT id,frame_id,version,status,content_sha256 FROM prompt_irs ORDER BY id").fetchall(),"receipts":c.execute("SELECT * FROM command_receipts ORDER BY id").fetchall(),"providerCounts":[c.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ["generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox"]]}))',
      join(target, 'storage/jason.db')], { encoding: 'utf8' })) as Snapshot
    run('init', root, ['--yimeng-root', writer!, '--core-root', core!])
    const fixture = sample()
    const initial = run('start')
    expect(initial.ready).toBe(true)
    expect(run('start').supervisorPid).toBe(initial.supervisorPid)
    expect((await fetch(initial.apiUrl + '/_qingmu/instance')).status).toBe(401)
    expect((await fetch(initial.apiUrl + '/api/auth/me')).status).toBe(401)
    expect((await fetch(initial.apiUrl + '/api/auth/register', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'must-not-register', password: 'not-a-user-password' }),
    })).status).toBe(403)
    run('login')
    const browser = await chromium.launch(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {})
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(12_000)
    const requests: { path: string; body: unknown }[] = []
    const watch = (): void => {
      page.on('request', (request) => {
        if (request.url().includes('/qingmu-yimeng-command/')) requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() as unknown })
      })
    }
    watch()
    const enter = async (url: string, first = false): Promise<void> => {
      // The actual profile holds SSE open; visible controls establish readiness.
      await page.goto(url, { waitUntil: 'load' })
      if (first) {
        await page.getByRole('button', { name: '进入青木 OS' }).click()
      }
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await dialog.getByRole('combobox', { name: '项目', exact: true }).selectOption(fixture.projectId)
      await dialog.getByRole('combobox', { name: '剧集', exact: true }).selectOption(fixture.episodeId)
      await dialog.getByRole('tab', { name: '导演工作区', exact: true }).click()
      await page.getByRole('textbox', { name: '完整视频提示词', exact: true }).waitFor()
    }
    try {
      await enter(initial.webUrl, true)
      const candidate = '持久化隔离验收：镜头缓慢前推，保留当前人物与场景。未经人工签收，不生成。'
      await page.getByRole('textbox', { name: '完整视频提示词', exact: true }).fill(candidate)
      await page.getByRole('button', { name: '先运行 IMAGO 方法检查', exact: true }).click()
      await page.getByRole('button', { name: '生成 PromptIR ChangeSet 预览', exact: true }).click()
      await page.getByRole('checkbox', { name: /我已核对.*Draft/ }).check()
      // Lose only the reply, after the actual API has committed the Draft.
      let replyLost!: () => void
      const lost = new Promise<void>((resolve) => { replyLost = resolve })
      await page.route('**/qingmu-yimeng-command/commitPromptIrEdit', async (route) => {
        await route.fetch()
        await route.abort('failed')
        replyLost()
      })
      await page.getByRole('button', { name: '确认提交 PromptIR Draft', exact: true }).dblclick()
      await lost
      const recover = page.getByRole('button', { name: '只查询原编辑回执', exact: true })
      await recover.waitFor()
      await page.unroute('**/qingmu-yimeng-command/commitPromptIrEdit')
      await recover.click()
      await page.getByText('已从易梦读回草稿；Ready 仍保持原样。', { exact: true }).waitFor()
      const after = inspect()
      expect(after.prompts.filter(row => row[3] === 'Draft')).toHaveLength(1)
      expect(after.receipts).toHaveLength(1)
      expect(after.providerCounts).toEqual([0, 0, 0, 0, 0])
      const recovery = requests.find(request => request.path.endsWith('/recoverPromptIrEditCommit'))!
      const commitsBefore = requests.filter(request => request.path.endsWith('/commitPromptIrEdit')).length
      expect(commitsBefore).toBe(1)
      expect(run('stop').dataPreserved).toBe(true)
      const backup = run('backup')
      expect(backup.integrity).toBe('ok')
      sample(['--expire-session'])
      const restarted = run('start')
      expect(restarted.webUrl).toBe(initial.webUrl)
      expect(restarted.session).toContain('过期')
      await page.goto(initial.webUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'qingmu-local.py login' }).waitFor()
      expect(inspect()).toEqual(after)
      expect(run('login').session).toContain('已登录')
      // A brand-new browser context removes every frontend cache/recovery marker.
      await page.context().close()
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(12_000)
      watch()
      await enter(initial.webUrl, false)
      expect(await page.getByRole('textbox', { name: '完整视频提示词', exact: true }).inputValue()).toBe(candidate)
      const receipt = await page.evaluate(async (request) => {
        const response = await fetch(request.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) })
        return await response.json() as RecoveryResponse
      }, recovery)
      expect(receipt.result.ok).toBe(true)
      expect(receipt.result.value.receipt.commandReceiptId).toBe(after.receipts[0]![0])
      expect(inspect()).toEqual(after)
      expect(requests.filter(request => request.path.endsWith('/commitPromptIrEdit'))).toHaveLength(commitsBefore)
      await page.screenshot({ path: join(parent, 'persistent-recovery-1280.png') })
      expect(run('stop').dataPreserved).toBe(true)
      expect(run('restore', restored, ['--backup', backup.backup]).integrity).toBe('ok')
      expect(inspect(restored)).toEqual(after)
      expect(readFileSync(join(restored, 'storage/acceptance-only.mp4'))).toEqual(readFileSync(join(root, 'storage/acceptance-only.mp4')))
      const restoredState = run('start', restored)
      expect(restoredState.ready).toBe(true)
      expect(run('login', restored).session).toContain('已登录')
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ initial, restarted, restored: restoredState,
        draftCount: 1, receiptCount: 1, commits: commitsBefore, sameReceiptId: receipt.result.value.receipt.commandReceiptId,
        freshBrowserContext: true, expiredSessionRecovered: true, backupIntegrity: backup.integrity, providerCalls: 0 }, null, 2))
      console.log('Qingmu local acceptance evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      throw error
    } finally {
      await browser.close()
      run('stop')
      if (existsSync(restored)) run('stop', restored)
    }
  }, 180_000)
})
