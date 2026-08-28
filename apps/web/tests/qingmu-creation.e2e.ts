// Empty persistent SQLite is initialized by the user launcher; every business write starts in the UI.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT
const core = process.env.IMAGO_OS_CORE_ROOT
interface Status { ready: boolean; webUrl: string; dataPreserved: boolean }
interface Snapshot {
  projects: string[][]
  series: string[][]
  episodes: (string | number)[][]
  receipts: string[][]
  providerCounts: number[]
  authorityCounts: Record<string, number>
  commands: string[]
  events: string[]
}
describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('empty local creation path', () => {
  it('creates once, corrects TXT, recovers lost confirmations and restores after restart in a fresh browser', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-creation-browser-')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Independent sample. Text parsing confirmation is not content/media approval. No Provider.\n')
    const root = join(parent, 'instance')
    const run = (op: string, extra: string[] = []): Status => JSON.parse(execFileSync('python3', [
      join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...extra,
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as Status
    const inspect = (): Snapshot => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps({"projects":c.execute("SELECT id,name,owner FROM projects").fetchall(),"series":c.execute("SELECT id,project_id FROM series").fetchall(),"episodes":c.execute("SELECT id,project_id,series_id,script_revision,script_json FROM episodes").fetchall(),"receipts":c.execute("SELECT id,command_type,response_json FROM command_receipts").fetchall(),"providerCounts":[c.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ["generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox"]],"authorityCounts":{t:c.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ["assets","prompt_irs","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]},"commands":[json.loads(r[0])["schema"] for r in c.execute("SELECT command_payload_json FROM change_sets")],"events":[r[0] for r in c.execute("SELECT event_type FROM domain_outbox")]}))',
      join(root, 'storage/jason.db')], { encoding: 'utf8' })) as Snapshot
    run('init', ['--yimeng-root', writer!, '--core-root', core!])
    expect(inspect().projects).toEqual([])
    const initial = run('start')
    expect(initial.ready).toBe(true)
    run('login')
    const browser = await chromium.launch(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {})
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15_000)
    const writes: string[] = []
    const watch = (): void => { page.on('request', (request) => {
      if (/\/qingmu-yimeng-command\/(initializeProject|createTextImport|correctTextImport|confirmTextImport)$/.test(request.url())) {
        writes.push(new URL(request.url()).pathname)
      }
    }) }
    watch()
    const enter = async (first = false): Promise<void> => {
      await page.goto(initial.webUrl, { waitUntil: 'load' })
      if (first) await page.getByRole('button', { name: '进入青木 OS' }).click()
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
    }
    const loseReply = async (endpoint: string, click: () => Promise<void>): Promise<void> => {
      let done!: () => void
      const completed = new Promise<void>((resolve) => { done = resolve })
      await page.route(`**/qingmu-yimeng-command/${endpoint}`, async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.abort('failed')
        done()
      })
      await click()
      await completed
      await page.unroute(`**/qingmu-yimeng-command/${endpoint}`)
    }
    try {
      await enter(true)
      await expect.poll(() => page.getByRole('textbox', { name: '项目名称' }).evaluate(el => document.activeElement === el)).toBe(true)
      await page.getByRole('textbox', { name: '项目名称' }).fill('创作入口隔离验收 · 未经内容签收')
      await page.screenshot({ path: join(parent, 'empty-1440.png') })
      await loseReply('initializeProject', () => page.getByRole('button', { name: '新建项目与第 1 集' }).dblclick())
      await page.getByRole('button', { name: '读取创建恢复' }).click()
      await page.getByRole('textbox', { name: '剧本文字' }).waitFor()
      const created = inspect()
      expect(created.projects).toHaveLength(1)
      expect(created.series).toHaveLength(1)
      expect(created.episodes).toHaveLength(1)
      expect(created.receipts).toHaveLength(1)
      expect(writes.filter(path => path.endsWith('/initializeProject'))).toHaveLength(1)
      // Pasted text survives closing/reopening the workspace without a write.
      const text = '场景一：雨夜旧街\n（门缓缓打开）\n林夏：请进。'
      await page.getByRole('textbox', { name: '剧本文字' }).fill(text)
      page.on('dialog', (dialog) => { void dialog.accept() })
      await enter()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      expect(await page.getByRole('textbox', { name: '剧本文字' }).inputValue()).toBe(text)
      await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
      await page.getByRole('region', { name: '解析预览' }).getByText(/来源：粘贴剧本.txt/).waitFor()
      // Exact TXT bytes, including BOM, own the input digest.
      const bytes = Buffer.from('\uFEFF' + text, 'utf8')
      await page.getByLabel('导入 TXT', { exact: true }).setInputFiles({ name: '隔离样本.txt', mimeType: 'text/plain', buffer: bytes })
      await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
      await page.getByRole('region', { name: '解析预览' }).getByText(/来源：隔离样本.txt/).waitFor()
      const speaker = page.getByRole('textbox', { name: /^说话人 / }).first()
      await speaker.fill('林小夏')
      await page.getByRole('button', { name: '保存校正' }).click()
      await page.getByText('解析校正已保存；尚未写入剧本。', { exact: true }).waitFor()
      await page.screenshot({ path: join(parent, 'preview-1440.png') })
      await loseReply('confirmTextImport', () => page.getByRole('button', { name: '确认导入并保存剧本', exact: true }).dblclick())
      await page.getByRole('button', { name: '读取恢复 / 刷新预览' }).click()
      await page.getByRole('region', { name: '已保存剧本' }).getByText('林小夏：', { exact: true }).waitFor()
      const after = inspect()
      expect(after.projects).toEqual(created.projects)
      expect(after.episodes[0]![3]).toBe(1)
      const script = JSON.parse(after.episodes[0]![4] as string) as {
        sourceBinding: { inputSha256: string; projectId: string; episodeId: string }
        scenes: { dialogues: { character: string }[] }[]
      }
      expect(script.sourceBinding.inputSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(script.sourceBinding.projectId).toBe(created.projects[0]![0])
      expect(script.sourceBinding.episodeId).toBe(created.episodes[0]![0])
      expect(script.scenes[0]!.dialogues[0]!.character).toBe('林小夏')
      expect(after.receipts).toEqual(created.receipts)
      expect(after.providerCounts).toEqual([0, 0, 0, 0, 0])
      expect(after.authorityCounts).toEqual({ assets: 0, prompt_irs: 0, episode_release_authority: 0,
        episode_production_step_receipts: 0, agent_runs: 0, workflow_runs: 0, step_runs: 0 })
      expect(after.commands).toEqual(['qingmu.project_bootstrap.create.v1'])
      expect(after.events).toEqual(['ProjectBootstrapped'])
      expect(writes.filter(path => path.endsWith('/confirmTextImport'))).toHaveLength(1)
      expect(run('stop').dataPreserved).toBe(true)
      expect(run('start').ready).toBe(true)
      await page.context().close()
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(15_000)
      watch()
      await enter()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByRole('region', { name: '已保存剧本' }).getByText('林小夏：', { exact: true }).waitFor()
      await page.getByText('分镜尚未建立', { exact: true }).waitFor()
      expect(inspect()).toEqual(after)
      expect(writes.filter(path => path.endsWith('/confirmTextImport'))).toHaveLength(1)
      await page.getByRole('region', { name: '已保存剧本' }).scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect({ savedScript: await page.getByRole('region', { name: '已保存剧本' }).innerText(),
        writes, commandTypes: after.commands, events: after.events, providerCounts: after.providerCounts,
        authorityCounts: after.authorityCounts }).toMatchSnapshot()
      await page.screenshot({ path: join(parent, 'restored-1280.png') })
      writeFileSync(join(parent, 'result.json'), JSON.stringify({
        root, webUrl: initial.webUrl, projectId: script.sourceBinding.projectId,
        episodeId: script.sourceBinding.episodeId, inputSha256: script.sourceBinding.inputSha256, scriptRevision: 1,
        creationReceiptId: after.receipts[0]![0], writes, providerCounts: after.providerCounts, authorityCounts: after.authorityCounts,
        commands: after.commands, events: after.events,
        emptyStart: true, lostCreationReplyRecovered: true, lostConfirmationReplyRecovered: true, freshBrowserAfterRestart: true,
      }, null, 2))
      console.log('Qingmu creation evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      await page.screenshot({ path: join(parent, 'failure.png') })
      throw error
    } finally { await browser.close(); run('stop') }
  }, 180_000)
})
