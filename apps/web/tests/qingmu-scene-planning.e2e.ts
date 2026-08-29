// Normal user launcher, real empty SQLite and FastAPI. All business writes originate in the UI.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT, core = process.env.IMAGO_OS_CORE_ROOT
interface DbState {
  counts: Record<string, number>
  frames: (string | number)[][]
  script: (string | number)[][]
  receipts: string[][]
  entities: string[][]
}
describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('real scene planning entry', () => {
  it('creates text and scene from empty UI, recovers lost save, edits and restores persistent IDs in a fresh browser', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-scene-browser-'), root = join(parent, 'instance')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Independent planning sample. No content/media approval. No Provider.\n')
    const run = (op: string, args: string[] = []) => JSON.parse(execFileSync('python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as { ready: boolean; webUrl: string; dataPreserved: boolean }
    const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps({"counts":{t:c.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ["projects","episodes","actors","scenes","storyboard_frames","storyboard_revisions","command_receipts","assets","prompt_irs","generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]},"frames":c.execute("SELECT id,scene_id,title,duration_sec,director_plan_json,dialogue_json FROM storyboard_frames ORDER BY frame_no").fetchall(),"script":c.execute("SELECT id,script_revision,script_json FROM episodes").fetchall(),"receipts":c.execute("SELECT id,command_type,response_json FROM command_receipts ORDER BY committed_at,id").fetchall(),"entities":c.execute("SELECT id,canonical_name FROM actors ORDER BY id").fetchall()}))',
      join(root, 'storage/jason.db')], { encoding: 'utf8' })) as DbState
    run('init', ['--yimeng-root', writer!, '--core-root', core!])
    expect(inspect().counts.projects).toBe(0)
    const initial = run('start'); expect(initial.ready).toBe(true); run('login')
    const browser = await chromium.launch()
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15_000)
    const enter = async (first = false) => {
      await page.goto(initial.webUrl, { waitUntil: 'load' })
      if (first) await page.getByRole('button', { name: '进入青木 OS' }).click()
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
    }
    const planning = () => page.getByRole('region', { name: '场景与镜头规划' })
    const commands: string[] = [], proposalRequests: string[] = [], freshnessChecks: string[] = []
    const watch = () => { page.on('request', (r) => {
      if (r.url().endsWith('/qingmu-yimeng-command/saveScenePlanning')) commands.push(r.postData() ?? '')
      if (r.url().endsWith('/qingmu-yimeng-command/requestDirectorProposal')) proposalRequests.push(r.postData() ?? '')
      if (r.url().endsWith('/qingmu-yimeng-command/checkDirectorProposalFreshness')) freshnessChecks.push(r.postData() ?? '')
    }) }
    watch()
    try {
      await enter(true)
      await page.getByLabel('项目名称', { exact: true }).fill('导演入场隔离样本 · 未经内容签收')
      await page.getByRole('button', { name: '新建项目与第 1 集' }).click()
      await page.getByLabel('剧本文字', { exact: true }).fill('场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。\n阿明：谢谢。\n场景二：清晨公园\n动作：天亮了。')
      await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
      await page.getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
      await page.getByRole('region', { name: '已保存剧本' }).waitFor()
      const before = inspect()
      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      await planning().getByRole('button', { name: '建立本场镜头' }).click()
      await planning().getByLabel('镜头名称', { exact: true }).fill('雨夜相遇')
      await planning().getByLabel('叙事目的', { exact: true }).fill('建立两人的第一次相遇')
      await planning().getByLabel('画面描述', { exact: true }).fill('雨夜门口，两人隔门相望')
      page.on('dialog', (dialog) => { void dialog.accept() })
      await enter()
      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      expect(await planning().getByLabel('叙事目的', { exact: true }).inputValue()).toBe('建立两人的第一次相遇')
      await planning().getByRole('button', { name: /02 · 镜头 2/ }).click()
      await planning().getByLabel('镜头名称', { exact: true }).fill('回应邀请')
      await planning().getByLabel('动作与表演', { exact: true }).fill('阿明点头回应')
      await page.getByRole('button', { name: '刷新只读投影', exact: true }).waitFor()
      await planning().getByLabel('镜头名称', { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'editor-1440.png') })
      await planning().getByRole('button', { name: '预览保存影响' }).click()
      await planning().getByRole('button', { name: '确认保存规划' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'preview-1440.png') })
      let complete!: () => void
      const lost = new Promise<void>((resolve) => { complete = resolve })
      await page.route('**/qingmu-yimeng-command/saveScenePlanning', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); complete()
      })
      await planning().getByRole('button', { name: '确认保存规划' }).dblclick()
      await lost; await page.unroute('**/qingmu-yimeng-command/saveScenePlanning')
      await planning().getByRole('alert').waitFor()
      await planning().getByRole('button', { name: '读取恢复', exact: true }).click()
      await planning().getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()
      const first = inspect()
      expect(first.script).toEqual(before.script)
      expect(first.counts).toMatchObject({ projects: 1, episodes: 1, actors: 2, scenes: 1,
        storyboard_frames: 2, storyboard_revisions: 1, command_receipts: 2 })
      expect(commands).toHaveLength(1)
      await planning().getByRole('button', { name: /01 · 雨夜相遇/ }).click()
      await planning().getByRole('button', { name: '读取演练建议' }).click()
      await planning().getByRole('region', { name: '演练建议（非模型生成）' }).waitFor()
      await planning().getByText('建议只作创意参考，尚未成为正式质检、参考选择、Ready 或人工决定。人工编辑始终可用。').waitFor()
      expect(inspect()).toEqual(first)
      await planning().getByText('原值', { exact: true }).first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'proposal-1440.png') })
      await planning().getByRole('button', { name: '采用到草稿' }).first().click()
      expect(await planning().getByLabel('叙事目的', { exact: true }).inputValue())
        .toBe('建立两人的第一次相遇；明确本镜情绪落点。')
      await planning().getByRole('button', { name: '预览保存影响' }).click()
      await planning().getByRole('button', { name: '确认保存规划' }).click()
      await planning().getByRole('status').filter({ hasText: '结构版本 2' }).waitFor()
      expect(proposalRequests).toHaveLength(1); expect(freshnessChecks).toHaveLength(1)
      const after = inspect()
      expect(after.frames[1]).toEqual(first.frames[1]); expect(after.entities).toEqual(first.entities)
      expect(after.script).toEqual(before.script)
      expect(after.frames[0]![0]).toBe(first.frames[0]![0]); expect(after.receipts).toHaveLength(3)
      for (const table of ['assets', 'prompt_irs', 'generation_tasks', 'provider_preflights', 'provider_budget_events', 'provider_authorization_reservations', 'provider_submission_outbox', 'episode_release_authority', 'episode_production_step_receipts', 'agent_runs', 'workflow_runs', 'step_runs']) expect(after.counts[table]).toBe(0)
      expect(run('stop').dataPreserved).toBe(true); expect(run('start').ready).toBe(true)
      await page.context().close()
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
      await enter(); await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      await planning().getByLabel('镜头名称', { exact: true }).waitFor()
      expect(await planning().getByLabel('镜头名称', { exact: true }).inputValue()).toBe('雨夜相遇')
      expect(await planning().getByLabel('叙事目的', { exact: true }).inputValue())
        .toBe('建立两人的第一次相遇；明确本镜情绪落点。')
      expect(inspect()).toEqual(after); expect(commands).toHaveLength(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByRole('button', { name: '刷新只读投影', exact: true }).waitFor()
      expect(await page.getByText('只读连接未完成', { exact: true }).count()).toBe(0)
      await planning().getByRole('button', { name: '读取演练建议' }).click()
      await planning().getByText('原值', { exact: true }).first().scrollIntoViewIfNeeded()
      expect(inspect()).toEqual(after)
      await page.screenshot({ path: join(parent, 'proposal-restored-1280.png') })
      expect({ counts: after.counts, titles: after.frames.map(f => f[2]),
        sourceUnchanged: after.script[0]![2] === before.script[0]![2],
        inputRestored: true, lostReplyRecovered: true, freshBrowserAfterRestart: true,
        missingReferences: true, noPromptIr: true }).toMatchSnapshot()
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, webUrl: initial.webUrl,
        after, commandCount: commands.length,
        originalScriptUnchanged: true, unrelatedShotUnchanged: true, inputRestored: true,
        lostReplyRecovered: true, freshBrowserAfterRestart: true }, null, 2))
      console.log('Qingmu scene planning evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      await page.screenshot({ path: join(parent, 'failure.png') }); throw error
    } finally { await browser.close(); run('stop') }
  }, 180_000)
})
