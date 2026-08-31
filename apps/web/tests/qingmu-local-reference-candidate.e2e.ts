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
  qualificationChecks: { id: string; asset_id: string; passed: number }[]
  promptIrs: { id: string; version: number; status: string; content_sha256: string }[]
  referencePacks: { id: string; status: string; owner_id: string; canonical_asset_id: string; pack_sha256: string }[]
}

describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('real local reference candidate entry', () => {
  it('qualifies and explicitly selects one local scene reference, recovers lost replies, survives restart and rejects byte drift', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-local-reference-browser-'), root = join(parent, 'instance')
    const image = join(parent, 'scene-reference.png')
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Synthetic image and unknown/not-applicable rights record by an authenticated test user. No verified license, selection, content approval or Provider.\n')
    writeFileSync(image, PNG)
    const run = (op: string, args: string[] = []) => JSON.parse(execFileSync('python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as { ready: boolean; webUrl: string; dataPreserved: boolean }
    const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c', `
import json,sqlite3,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
wanted=['projects','episodes','actors','scenes','storyboard_frames','assets','prompt_irs','entity_reference_packs','human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','agent_runs','workflow_runs','step_runs']
print(json.dumps({'counts':{t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] if t in tables else 0 for t in wanted},'selected':c.execute('SELECT count(*) FROM assets WHERE is_selected=1 OR selection_status="Selected"').fetchone()[0],'assets':[dict(r) for r in c.execute('SELECT id,owner_type,owner_id,sha256,selection_status,is_selected,local_path,quality_status,generation_job_id FROM assets ORDER BY id')],'receipts':[dict(r) for r in c.execute('SELECT id,command_type,response_json FROM command_receipts ORDER BY committed_at,id')],'rightsChangeSets':[dict(r) for r in c.execute('SELECT id,status FROM change_sets WHERE operations_json LIKE ?',('%replaceReferenceRights%',))],'qualificationChecks':[dict(r) for r in c.execute('SELECT id,asset_id,passed FROM consistency_checks WHERE check_type="local_reference_integrity" ORDER BY id')],'promptIrs':[dict(r) for r in c.execute('SELECT id,version,status,content_sha256 FROM prompt_irs ORDER BY version,id')],'referencePacks':[dict(r) for r in c.execute('SELECT id,status,owner_id,canonical_asset_id,pack_sha256 FROM entity_reference_packs ORDER BY id')]},ensure_ascii=False))
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
    const uploads: string[] = [], qualificationPosts: string[] = [], rightsCommits: string[] = []
    const bootstrapPosts: string[] = [], selectionPosts: string[] = [], rpcEvents: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/qingmu-yimeng-command/uploadLocalReferenceCandidate')) uploads.push(request.postData() ?? '')
      if (request.url().endsWith('/qingmu-yimeng-command/qualifyLocalReferenceCandidate')) qualificationPosts.push(request.postData() ?? '')
      if (request.url().endsWith('/qingmu-yimeng-command/commitElementProfile')) rightsCommits.push(request.postData() ?? '')
      if (request.url().endsWith('/qingmu-yimeng-command/bootstrapPromptIr')) bootstrapPosts.push(request.postData() ?? '')
      if (request.url().endsWith('/qingmu-yimeng-command/selectBootstrapPromptIr')) selectionPosts.push(request.postData() ?? '')
      if (request.url().includes('/qingmu-yimeng-command/')) rpcEvents.push(`request ${new URL(request.url()).pathname}`)
    })
    page.on('response', (response) => {
      if (response.url().includes('/qingmu-yimeng-command/')) rpcEvents.push(`response ${response.status()} ${new URL(response.url()).pathname}`)
    })
    try {
      await enter(page, true)
      await page.getByLabel('项目名称', { exact: true }).fill('本地参考候选隔离样本 · 未经内容签收')
      await page.getByRole('button', { name: '新建项目与第 1 集' }).click()
      await page.getByLabel('剧本文字', { exact: true }).fill('场景一：雨夜旧街\n动作：空镜中，门缓缓打开。')
      await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
      await page.getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
      await page.getByRole('region', { name: '已保存剧本' }).waitFor()
      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      const planning = page.getByRole('region', { name: '场景与镜头规划' })
      await planning.getByRole('button', { name: '建立本场镜头' }).click()
      await planning.getByLabel('镜头名称', { exact: true }).fill('雨夜入场')
      await planning.getByLabel('叙事目的', { exact: true }).fill('建立环境与空间')
      await planning.getByRole('button', { name: '预览保存影响' }).click()
      await planning.getByRole('button', { name: '确认保存规划' }).click()
      await planning.getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByRole('region', { name: '元素资料变更台' })
        .getByRole('button', { name: '环境', exact: true }).click()
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
      await reference.getByRole('button', { name: '选择参考素材', exact: true }).click()
      await reference.getByRole('button', { name: '检查本地参考资格', exact: true }).waitFor()
      let qualificationComplete!: () => void
      const qualificationLost = new Promise<void>((resolve) => { qualificationComplete = resolve })
      await page.route('**/qingmu-yimeng-command/qualifyLocalReferenceCandidate', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); qualificationComplete()
      })
      await page.getByRole('button', { name: '检查本地参考资格', exact: true }).dblclick()
      await qualificationLost
      await page.unroute('**/qingmu-yimeng-command/qualifyLocalReferenceCandidate')
      await page.getByRole('button', { name: '恢复资格检查结果', exact: true }).waitFor()
      await page.getByRole('button', { name: '恢复资格检查结果', exact: true }).click()
      await page.getByText('本地参考资格已记录', { exact: true }).waitFor()
      expect(qualificationPosts).toHaveLength(1)

      const qualified = inspect()
      expect(qualified.assets).toHaveLength(1); expect(qualified.selected).toBe(0)
      expect(qualified.assets[0]).toMatchObject({ owner_type: 'scene', selection_status: 'Unselected', is_selected: 0,
        quality_status: 'passed', generation_job_id: null })
      expect(qualified.qualificationChecks).toHaveLength(1)
      expect(qualified.qualificationChecks[0]).toMatchObject({ asset_id: candidateId, passed: 1 })
      expect(qualified.receipts.filter(item => item.command_type === 'qingmu.local_reference_candidate.qualify.v1')).toHaveLength(1)
      const materialized = join(root, 'storage', qualified.assets[0]!.local_path)
      const original = readFileSync(materialized)
      writeFileSync(materialized, Buffer.concat([original, Buffer.from([0])]))
      await reference.getByRole('button', { name: '选择参考素材', exact: true }).click()
      await reference.getByRole('radio', { name: new RegExp(candidateId) }).click()
      await reference.getByRole('button', { name: '预览参考素材选择', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: /materialized|candidate_binding|candidate_drift/ }).waitFor()
      const afterTamper = inspect()
      expect(afterTamper.selected).toBe(0)
      expect(afterTamper.receipts).toEqual(qualified.receipts)
      expect(afterTamper.qualificationChecks).toEqual(qualified.qualificationChecks)
      writeFileSync(materialized, original)

      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: '先以只读方式进入' }).click()
      await page.getByRole('button', { name: '青木制作台', exact: true }).click()
      await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByRole('region', { name: '元素资料变更台' })
        .getByRole('button', { name: '环境', exact: true }).click()
      const refreshedReference = page.getByRole('region', { name: '参考素材选择与返修' })
      await refreshedReference.getByRole('button', { name: '选择参考素材', exact: true }).click()
      await refreshedReference.getByRole('radio', { name: new RegExp(candidateId) }).click()
      await refreshedReference.getByRole('button', { name: '预览参考素材选择', exact: true }).click()
      await page.getByRole('heading', { name: '参考素材 ChangeSet 预览' }).waitFor()
      await page.getByRole('checkbox', { name: /我确认提交这个参考素材选择 ChangeSet/ }).click()
      await page.getByRole('button', { name: '确认记录参考素材选择', exact: true }).click()
      await page.getByText('参考素材选择已记录；这不代表人工签收。', { exact: true }).waitFor()

      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      await page.getByText('已有提示词、Take 与高级分镜', { exact: true }).click()
      const bootstrap = page.getByRole('region', { name: '首个 PromptIR 引导' })
      await bootstrap.getByRole('button', { name: '生成首个 Draft 预览' }).click()
      await bootstrap.getByRole('heading', { name: '方法生成的 Draft 预览' }).waitFor()
      let draftComplete!: () => void
      const draftLost = new Promise<void>((resolve) => { draftComplete = resolve })
      await page.route('**/qingmu-yimeng-command/bootstrapPromptIr', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); draftComplete()
      })
      await bootstrap.getByRole('button', { name: '保存首个 PromptIR Draft' }).dblclick()
      await draftLost; await page.unroute('**/qingmu-yimeng-command/bootstrapPromptIr')
      await bootstrap.getByRole('button', { name: '恢复原 Draft 回执' }).click()
      await bootstrap.getByRole('heading', { name: 'PromptIR Draft 已保存' }).waitFor()
      expect(bootstrapPosts).toHaveLength(1)
      await bootstrap.getByRole('checkbox', { name: /我确认把这个 Draft 选为当前 Ready/ }).click()
      let selectionComplete!: () => void
      const selectionLost = new Promise<void>((resolve) => { selectionComplete = resolve })
      await page.route('**/qingmu-yimeng-command/selectBootstrapPromptIr', async (route) => {
        const response = await route.fetch(); expect(response.status()).toBe(200)
        await route.abort('failed'); selectionComplete()
      })
      await bootstrap.getByRole('button', { name: '选为首个 Ready' }).dblclick()
      await selectionLost; await page.unroute('**/qingmu-yimeng-command/selectBootstrapPromptIr')
      await bootstrap.getByRole('button', { name: '恢复原选择结果' }).click()
      const readyWorkspace = page.getByRole('region', { name: 'PromptIR 五字段变更台' })
      await readyWorkspace.getByText(/Ready v1/).waitFor()
      await readyWorkspace.getByText('Ready 只表示当前生效的提示词版本，不代表内容、权利、正式一致性或发布批准。', { exact: true }).waitFor()
      expect(selectionPosts).toHaveLength(1)
      const beforeQuote = inspect()
      const firstFrameQuote = readyWorkspace.getByRole('region', { name: '首帧生成条件' })
      await firstFrameQuote.getByRole('button', { name: '检查首帧生成条件（不调用模型）' }).click()
      await firstFrameQuote.getByText('未提交、未扣费。', { exact: true }).waitFor()
      await firstFrameQuote.getByText(
        '当前执行链尚未消费 Ready PromptIR；本报价只核对价格事实，不能提交。',
        { exact: true },
      ).waitFor()
      await firstFrameQuote.getByText(/dashscope \/ /).waitFor()
      await firstFrameQuote.getByText('b4.first_frame_generation', { exact: true }).waitFor()
      const firstQuoteProjection = await firstFrameQuote.textContent()
      expect(firstQuoteProjection).toContain('pricingVerified')
      expect(inspect()).toEqual(beforeQuote)

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
      expect(after.assets).toHaveLength(1); expect(after.selected).toBe(1)
      expect(after.assets[0]).toMatchObject({ owner_type: 'scene', selection_status: 'Selected', is_selected: 1,
        quality_status: 'passed', generation_job_id: null })
      expect(after.receipts.filter(item => item.command_type === 'qingmu.local_reference_candidate.upload.v1')).toHaveLength(1)
      expect(after.receipts.filter(item => item.command_type === 'qingmu.local_reference_candidate.qualify.v1')).toHaveLength(1)
      expect(after.rightsChangeSets).toHaveLength(1)
      expect(after.rightsChangeSets[0]).toMatchObject({ status: 'committed' })
      expect(readFileSync(materialized)).toEqual(PNG)
      expect(after.promptIrs).toHaveLength(1)
      expect(after.promptIrs[0]?.status).toBe('Ready')
      expect(after.referencePacks).toHaveLength(1)
      expect(after.referencePacks[0]).toMatchObject({ status: 'Ready', canonical_asset_id: candidateId })
      expect(after.receipts.filter(item => item.command_type === 'qingmu.prompt_ir.bootstrap.v1')).toHaveLength(1)
      expect(after.receipts.filter(item => item.command_type === 'qingmu.prompt_ir.select.v1')).toHaveLength(1)
      for (const table of ['human_review_decisions','generation_tasks','provider_preflights','provider_budget_events','provider_authorization_reservations','provider_submission_outbox','episode_release_authority','episode_production_step_receipts','stage_artifacts','workflow_runs','step_runs']) expect(after.counts[table]).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await readyWorkspace.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'prompt-ir-selected-1440.png') })

      await page.context().close()
      expect(run('stop').dataPreserved).toBe(true); expect(run('start').ready).toBe(true)
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(20_000)
      await enter(page); await page.getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await page.getByRole('region', { name: '元素资料变更台' })
        .getByRole('button', { name: '环境', exact: true }).click()
      await page.getByText('已选择（未签收）', { exact: true }).first().waitFor()
      await page.getByText('本机文件（来源未核验）', { exact: false }).first().waitFor()
      await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
      await page.getByText('已有提示词、Take 与高级分镜', { exact: true }).click()
      const restoredReady = page.getByRole('region', { name: 'PromptIR 五字段变更台' })
      await restoredReady.getByText(/Ready v1/).waitFor()
      await restoredReady.getByText('Ready 只表示当前生效的提示词版本，不代表内容、权利、正式一致性或发布批准。', { exact: true }).waitFor()
      const restoredQuote = restoredReady.getByRole('region', { name: '首帧生成条件' })
      await restoredQuote.getByRole('button', { name: '检查首帧生成条件（不调用模型）' }).click()
      await restoredQuote.getByText('未提交、未扣费。', { exact: true }).waitFor()
      expect(await restoredQuote.textContent()).toBe(firstQuoteProjection)
      expect(inspect()).toEqual(after)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await restoredReady.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(parent, 'prompt-ir-restored-1280.png') })
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, webUrl: initial.webUrl, qualified, afterTamper, after,
        uploadPosts: uploads.length, qualificationPosts: qualificationPosts.length,
        commitPosts: rightsCommits.length, bootstrapPosts: bootstrapPosts.length,
        selectionPosts: selectionPosts.length, byteDriftFailedClosed: true,
        freshBrowserAfterRestart: true, selectedNotApproved: true, promptIrReadyNotApproved: true,
        firstFrameQuoteReadOnly: true, firstFrameQuoteStableAfterRestart: true }, null, 2))
      console.log('Qingmu local reference qualification evidence:', parent)
    } catch (error) {
      writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
      writeFileSync(join(parent, 'rpc-events.json'), JSON.stringify(rpcEvents, null, 2))
      await page.screenshot({ path: join(parent, 'failure.png') }); throw error
    } finally { await browser.close(); run('stop') }
  }, 240_000)
})
