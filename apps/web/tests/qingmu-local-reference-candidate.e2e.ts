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
    quality_status: string
    generation_job_id: string | null
  }[]
  receipts: { id: string; command_type: string; response_json: string }[]
  rightsChangeSets: { id: string; status: string }[]
  actorProfileRevision: number
}

describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('real local reference candidate entry', () => {
  it('records unknown rights for one Unselected local candidate, recovers lost replies, survives restart and rejects post-preview byte drift', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-local-reference-browser-'), root = join(parent, 'instance')
    const image = join(parent, 'actor-reference.png')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Synthetic image and unknown/not-applicable rights record by an authenticated test user. No verified license, selection, content approval or Provider.\n')
    writeFileSync(image, PNG)
    const run = (op: string, args: string[] = []) => JSON.parse(execFileSync('python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as { ready: boolean; webUrl: string; dataPreserved: boolean }
    const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c', `
import json,sqlite3,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
wanted=['projects','episodes','actors','scenes','storyboard_frames','assets','prompt_irs','entity_reference_packs','human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','agent_runs','workflow_runs','step_runs']
print(json.dumps({'counts':{t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] if t in tables else 0 for t in wanted},'selected':c.execute('SELECT count(*) FROM assets WHERE is_selected=1 OR selection_status="Selected"').fetchone()[0],'assets':[dict(r) for r in c.execute('SELECT id,owner_type,owner_id,sha256,selection_status,is_selected,local_path,quality_status,generation_job_id FROM assets ORDER BY id')],'receipts':[dict(r) for r in c.execute('SELECT id,command_type,response_json FROM command_receipts ORDER BY committed_at,id')],'rightsChangeSets':[dict(r) for r in c.execute('SELECT id,status FROM change_sets WHERE operations_json LIKE ?',('%replaceReferenceRights%',))],'actorProfileRevision':c.execute('SELECT COALESCE((SELECT profile_revision FROM actors ORDER BY id LIMIT 1),0)').fetchone()[0]},ensure_ascii=False))
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
    const uploads: string[] = [], rightsCommits: string[] = [], rpcEvents: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/qingmu-yimeng-command/uploadLocalReferenceCandidate')) uploads.push(request.postData() ?? '')
      if (request.url().endsWith('/qingmu-yimeng-command/commitElementProfile')) rightsCommits.push(request.postData() ?? '')
      if (request.url().includes('/qingmu-yimeng-command/')) rpcEvents.push(`request ${new URL(request.url()).pathname}`)
    })
    page.on('response', (response) => {
      if (response.url().includes('/qingmu-yimeng-command/')) rpcEvents.push(`response ${response.status()} ${new URL(response.url()).pathname}`)
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
      expect(await upload.getByText('本机文件（来源未核验）', { exact: true }).count()).toBe(1)
      expect(await upload.getByText('未登记、未核验', { exact: true }).count()).toBe(1)

      const reference = page.getByRole('region', { name: '参考素材选择与返修' })
      await reference.getByRole('button', { name: '选择参考素材', exact: true }).click()
      await reference.getByText(/暂不可选择：.*缺少来源版本.*缺少正式一致性检查.*质量检查尚未通过/).waitFor()
      await reference.getByRole('button', { name: '维护参考素材权利', exact: true }).click()
      const candidateId = inspect().assets[0]!.id
      await reference.getByRole('radio', { name: new RegExp(candidateId) }).click()
      await reference.getByLabel('人工声明', { exact: true }).selectOption('not_applicable')
      await reference.getByRole('button', { name: '生成权利变更预览', exact: true }).click()
      await page.getByRole('heading', { name: '参考素材权利 ChangeSet 预览' }).waitFor()
      let rightsComplete!: () => void
      const rightsLost = new Promise<void>((resolve) => { rightsComplete = resolve })
      await page.route('**/qingmu-yimeng-command/commitElementProfile', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); rightsComplete()
      })
      await page.getByRole('checkbox', { name: /我已核对完整权利记录/ }).click()
      await page.getByRole('button', { name: '确认提交权利记录', exact: true }).dblclick()
      await rightsLost; await page.unroute('**/qingmu-yimeng-command/commitElementProfile')
      await page.getByRole('button', { name: '查询并恢复原回执' }).waitFor()
      await page.getByRole('button', { name: '查询并恢复原回执' }).click()
      await page.getByRole('heading', { name: '已恢复原始提交回执' }).waitFor()
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().waitFor()
      expect(rightsCommits).toHaveLength(1)
      const persistedBrowserState = await page.evaluate(() => JSON.stringify({
        session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index) ?? ''
          return [key, sessionStorage.getItem(key)]
        })),
        local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index) ?? ''
          return [key, localStorage.getItem(key)]
        })),
      }))
      expect(persistedBrowserState).not.toContain('humanDeclaration')
      expect(persistedBrowserState).not.toContain('rightsHolder')
      const after = inspect()
      expect(after.assets).toHaveLength(1); expect(after.selected).toBe(0)
      expect(after.assets[0]).toMatchObject({ owner_type: 'actor', selection_status: 'Unselected', is_selected: 0,
        quality_status: 'pending', generation_job_id: null })
      expect(after.receipts.filter(item => item.command_type === 'qingmu.local_reference_candidate.upload.v1')).toHaveLength(1)
      expect(after.rightsChangeSets).toHaveLength(1)
      expect(after.rightsChangeSets[0]).toMatchObject({ status: 'committed' })
      expect(readFileSync(join(root, 'storage', after.assets[0]!.local_path))).toEqual(PNG)
      for (const table of ['prompt_irs','entity_reference_packs','human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','agent_runs','workflow_runs','step_runs']) expect(after.counts[table]).toBe(0)
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: join(parent, 'rights-1440.png') })
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().waitFor()
      await page.context().close()
      expect(run('stop').dataPreserved).toBe(true); expect(run('start').ready).toBe(true)
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(20_000)
      await enter(page); await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().waitFor()
      await page.getByText('本机文件（来源未核验）', { exact: true }).first().waitFor()
      expect(inspect()).toEqual(after)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const restoredReference = page.getByRole('region', { name: '参考素材选择与返修' })
      await restoredReference.getByRole('button', { name: '维护参考素材权利', exact: true }).click()
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'rights-restored-1280.png') })
      await restoredReference.getByRole('radio', { name: new RegExp(after.assets[0]!.id) }).click()
      await restoredReference.getByLabel('人工声明', { exact: true }).selectOption('unknown')
      await restoredReference.getByRole('button', { name: '生成权利变更预览', exact: true }).click()
      await page.getByRole('heading', { name: '参考素材权利 ChangeSet 预览' }).waitFor()
      const materialized = join(root, 'storage', after.assets[0]!.local_path)
      const original = readFileSync(materialized); writeFileSync(materialized, Buffer.concat([original, Buffer.from([0])]))
      await page.getByRole('checkbox', { name: /我已核对完整权利记录/ }).click()
      await page.getByRole('button', { name: '确认提交权利记录', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'reference_asset_materialization_changed' }).waitFor()
      const afterTamper = inspect()
      expect(afterTamper.assets).toEqual(after.assets)
      expect(afterTamper.counts).toEqual(after.counts)
      expect(afterTamper.receipts).toEqual(after.receipts)
      expect(afterTamper.selected).toBe(0)
      expect(afterTamper.actorProfileRevision).toBe(after.actorProfileRevision)
      expect(afterTamper.rightsChangeSets.filter(item => item.status === 'committed')).toEqual(after.rightsChangeSets)
      expect(afterTamper.rightsChangeSets.filter(item => item.status === 'draft')).toHaveLength(1)
      writeFileSync(materialized, original)
      await page.reload({ waitUntil: 'load' }); await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByText('权利记录已保存（法律事实未核验）', { exact: true }).first().waitFor()
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, webUrl: initial.webUrl, after, afterTamper,
        uploadPosts: uploads.length, rightsCommitPosts: rightsCommits.length, refreshReadback: true,
        freshBrowserAfterRestart: true, postPreviewByteDriftFailedClosed: true,
        restoredAfterTamperProbe: true }, null, 2))
      console.log('Qingmu reference rights evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      writeFileSync(join(parent, 'rpc-events.json'), JSON.stringify(rpcEvents, null, 2))
      await page.screenshot({ path: join(parent, 'failure.png') }); throw error
    } finally { await browser.close(); run('stop') }
  }, 240_000)
})
