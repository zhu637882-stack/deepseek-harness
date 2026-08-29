// Normal launcher, empty SQLite, real FastAPI and built Host. All business setup starts in Chromium.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT, core = process.env.IMAGO_OS_CORE_ROOT
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU2JLAwMDAxAAGAA2KASg9dJtCAAAAAElFTkSuQmCC', 'base64')
interface DbState {
  counts: Record<string, number>
  selected: number
  assets: {
    id: string
    owner_type: string
    owner_id: string
    sha256: string
    selection_status: string
    is_selected: number
    local_path: string
  }[]
  receipts: { id: string; command_type: string; response_json: string }[]
}

describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('real local reference candidate entry', () => {
  it('uploads one Unselected actor candidate, recovers a lost reply, survives restart and fails closed on tampered bytes', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-local-reference-browser-'), root = join(parent, 'instance')
    const image = join(parent, 'actor-reference.png')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Synthetic image upload by an authenticated test user. No rights or content approval. No Provider.\n')
    writeFileSync(image, PNG)
    const run = (op: string, args: string[] = []) => JSON.parse(execFileSync('python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as { ready: boolean; webUrl: string; dataPreserved: boolean }
    const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c', `
import json,sqlite3,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
wanted=['projects','episodes','actors','scenes','storyboard_frames','assets','prompt_irs','entity_reference_packs','human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','agent_runs','workflow_runs','step_runs']
print(json.dumps({'counts':{t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] if t in tables else 0 for t in wanted},'selected':c.execute('SELECT count(*) FROM assets WHERE is_selected=1 OR selection_status="Selected"').fetchone()[0],'assets':[dict(r) for r in c.execute('SELECT id,owner_type,owner_id,sha256,selection_status,is_selected,local_path FROM assets ORDER BY id')],'receipts':[dict(r) for r in c.execute('SELECT id,command_type,response_json FROM command_receipts ORDER BY committed_at,id')]},ensure_ascii=False))
`, join(root, 'storage/jason.db')], { encoding: 'utf8' })) as DbState
    run('init', ['--yimeng-root', writer!, '--core-root', core!])
    expect(inspect().counts.projects).toBe(0)
    const initial = run('start'); expect(initial.ready).toBe(true); run('login')
    const browser = await chromium.launch()
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(20_000)
    const enter = async (target: Page, first = false) => {
      await target.goto(initial.webUrl, { waitUntil: 'load' })
      if (first) await target.getByRole('button', { name: '进入青木 OS' }).click()
      await target.getByRole('button', { name: '先以只读方式进入' }).click()
      await target.getByRole('button', { name: '青木制作台', exact: true }).click()
    }
    const uploads: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/qingmu-yimeng-command/uploadLocalReferenceCandidate')) uploads.push(request.postData() ?? '')
    })
    try {
      await enter(page, true)
      await page.getByLabel('项目名称', { exact: true }).fill('本地参考候选隔离样本 · 未经内容签收')
      await page.getByRole('button', { name: '新建项目与第 1 集' }).click()
      await page.getByLabel('剧本文字', { exact: true }).fill('场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。\n阿明：谢谢。')
      await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
      await page.getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
      await page.getByRole('region', { name: '已保存剧本' }).waitFor()
      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      const planning = page.getByRole('region', { name: '场景与镜头规划' })
      await planning.getByRole('button', { name: '建立本场镜头' }).click()
      await planning.getByLabel('镜头名称', { exact: true }).fill('雨夜入场')
      await planning.getByLabel('叙事目的', { exact: true }).fill('建立人物关系')
      await planning.getByRole('button', { name: '预览保存影响' }).click()
      await planning.getByRole('button', { name: '确认保存规划' }).click()
      await planning.getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      const upload = page.getByRole('region', { name: '上传本地参考候选' })
      await upload.locator('input[type=file]').setInputFiles(image)
      await upload.getByRole('button', { name: '保存为未选择候选' }).waitFor()
      let complete!: () => void
      const lost = new Promise<void>((resolve) => { complete = resolve })
      await page.route('**/qingmu-yimeng-command/uploadLocalReferenceCandidate', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); complete()
      })
      await upload.getByRole('button', { name: '保存为未选择候选' }).dblclick()
      await lost; await page.unroute('**/qingmu-yimeng-command/uploadLocalReferenceCandidate')
      await upload.getByRole('alert').waitFor()
      await upload.getByRole('button', { name: '读取原上传回执' }).click()
      await page.getByText('未选择 · 未批准', { exact: true }).first().waitFor()
      expect(uploads).toHaveLength(1)
      const after = inspect()
      expect(after.assets).toHaveLength(1); expect(after.selected).toBe(0)
      expect(after.assets[0]).toMatchObject({ owner_type: 'actor', selection_status: 'Unselected', is_selected: 0 })
      expect(after.receipts.filter(item => item.command_type === 'qingmu.local_reference_candidate.upload.v1')).toHaveLength(1)
      for (const table of ['prompt_irs','entity_reference_packs','human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','agent_runs','workflow_runs','step_runs']) expect(after.counts[table]).toBe(0)
      expect(await upload.getByText('本机文件（来源未核验）', { exact: true }).count()).toBe(1)
      expect(await upload.getByText('未登记、未核验', { exact: true }).count()).toBe(1)
      await upload.scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: join(parent, 'candidate-1440.png') })
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('未选择 · 未批准', { exact: true }).first().waitFor()
      await page.context().close()
      expect(run('stop').dataPreserved).toBe(true); expect(run('start').ready).toBe(true)
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(20_000)
      await enter(page); await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('未选择 · 未批准', { exact: true }).first().waitFor()
      expect(inspect()).toEqual(after)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByRole('region', { name: '上传本地参考候选' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'candidate-restored-1280.png') })
      await page.context().close(); expect(run('stop').dataPreserved).toBe(true)
      const materialized = join(root, 'storage', after.assets[0]!.local_path)
      const original = readFileSync(materialized); writeFileSync(materialized, Buffer.concat([original, Buffer.from([0])]))
      expect(run('start').ready).toBe(true)
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); page.setDefaultTimeout(20_000)
      await enter(page); await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByRole('region', { name: '上传本地参考候选' }).getByRole('alert').filter({ hasText: 'tampered' }).waitFor()
      await page.context().close(); expect(run('stop').dataPreserved).toBe(true)
      writeFileSync(materialized, original); expect(run('start').ready).toBe(true)
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); page.setDefaultTimeout(20_000)
      await enter(page); await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('未选择 · 未批准', { exact: true }).first().waitFor()
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, webUrl: initial.webUrl, after,
        uploadPosts: uploads.length, refreshReadback: true, freshBrowserAfterRestart: true,
        tamperFailedClosed: true, restoredAfterTamperProbe: true }, null, 2))
      console.log('Qingmu local reference evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      await page.screenshot({ path: join(parent, 'failure.png') }); throw error
    } finally { await browser.close(); run('stop') }
  }, 240_000)
})
