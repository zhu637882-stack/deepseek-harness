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
  projects: (string | number)[][]
  frames: (string | number)[][]
  script: (string | number)[][]
  receipts: string[][]
  entities: string[][]
}
describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')('real scene planning entry', () => {
  it('creates text and scene from empty UI, recovers lost save, edits and restores persistent IDs in a fresh browser', async () => {
    const parent = mkdtempSync('/private/tmp/qingmu-scene-browser-'), root = join(parent, 'instance')
    const scriptSource = '场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。\n阿明：谢谢。\n场景二：清晨公园\n动作：天亮了。'
    writeFileSync(join(parent, 'ACCEPTANCE-ONLY'), 'Independent planning sample. No content/media approval. No Provider.\n')
    const run = (op: string, args: string[] = []) => JSON.parse(execFileSync('python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 })) as {
      ready: boolean
      webUrl: string
      hostUrl: string
      entryUrl: string
      dataPreserved: boolean
    }
    const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps({"counts":{t:c.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ["projects","episodes","actors","scenes","storyboard_frames","storyboard_revisions","command_receipts","assets","prompt_irs","generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]},"projects":c.execute("SELECT id,creative_contract_revision,creative_contract_sha256,creative_contract_json FROM projects").fetchall(),"frames":c.execute("SELECT id,scene_id,title,duration_sec,director_plan_json,dialogue_json FROM storyboard_frames ORDER BY frame_no").fetchall(),"script":c.execute("SELECT id,script_revision,script_json FROM episodes").fetchall(),"receipts":c.execute("SELECT id,command_type,response_json FROM command_receipts ORDER BY committed_at,id").fetchall(),"entities":c.execute("SELECT id,canonical_name FROM actors ORDER BY id").fetchall()}))',
      join(root, 'storage/jason.db')], { encoding: 'utf8' })) as DbState
    run('init', ['--yimeng-root', writer!, '--core-root', core!])
    expect(inspect().counts.projects).toBe(0)
    const initial = run('start'); expect(initial.ready).toBe(true); run('login')
    const browser = await chromium.launch()
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15_000)
    const host = () => page.frameLocator('iframe[title="青木导演工作区"]')
    const installOuterSyncReceiver = async () => page.addInitScript(() => {
      const target = window as unknown as { __qingmuHostSync?: {
        seen: string[]
        accepted: number
        duplicates: number
        rejected: number
        sceneId: string | null
        shotId: string | null
        last: Record<string, unknown> | null
      } }
      target.__qingmuHostSync = { seen: [], accepted: 0, duplicates: 0, rejected: 0,
        sceneId: null, shotId: null, last: null }
      window.addEventListener('message', (event) => {
        const state = target.__qingmuHostSync!
        const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="青木导演工作区"]')
        const value = event.data as Record<string, unknown> | null
        const scope = value?.scope as Record<string, unknown> | undefined
        const receipt = value?.receipt as Record<string, unknown> | undefined
        const locate = value?.locate as Record<string, unknown> | undefined
        const expectedOrigin = iframe?.src ? new URL(iframe.src).origin : null
        const valid = iframe !== null && event.source === iframe.contentWindow && event.origin === expectedOrigin
          && value?.schema === 'deepseek.dsh.qingmu-scene-planning-saved.v1'
          && value.type === 'qingmu:scene-planning-saved'
          && typeof value.messageId === 'string' && receipt?.eventId === value.messageId
          && typeof scope?.projectId === 'string' && typeof scope.episodeId === 'string'
          && scope.projectId === new URL(iframe.src).searchParams.get('qingmuProjectId')
          && scope.episodeId === new URL(iframe.src).searchParams.get('qingmuEpisodeId')
          && typeof scope.sceneId === 'string' && typeof scope.shotId === 'string'
          && locate?.stage === 'storyboard' && locate.sceneId === scope.sceneId && locate.shotId === scope.shotId
        if (!valid) { state.rejected += 1; return }
        if (state.seen.includes(value.messageId as string)) { state.duplicates += 1; return }
        state.seen.push(value.messageId as string)
        state.accepted += 1
        // This acceptance receiver models the outer six-stage reaction: one
        // receipt refresh and an exact locate, never a first-row fallback.
        state.sceneId = scope.sceneId as string
        state.shotId = scope.shotId as string
        state.last = value
        document.documentElement.dataset.qingmuRefreshCount = String(state.accepted)
        document.documentElement.dataset.qingmuLocatedSceneId = state.sceneId
        document.documentElement.dataset.qingmuLocatedShotId = state.shotId
      })
    })
    const settleEmbeddedHost = async () => {
      const frame = host()
      const welcome = frame.getByRole('button', { name: '进入青木 OS' })
      const readOnly = frame.getByRole('button', { name: '先以只读方式进入' })
      const cockpit = frame.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
      await welcome.or(readOnly).or(cockpit).first().waitFor()
      if (await welcome.isVisible()) {
        await welcome.click()
        await welcome.waitFor({ state: 'hidden' })
      }
      // A real initial Workspace creates a blank Session asynchronously. The
      // model onboarding dialog therefore lands after the always-visible rail
      // button; wait for its explicit no-provider path instead of racing the
      // rail behind the modal mask.
      await readOnly.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined)
      if (await readOnly.isVisible()) {
        await readOnly.click()
        try { await readOnly.waitFor({ state: 'hidden', timeout: 3_000 }) } catch {
          await readOnly.click()
          await readOnly.waitFor({ state: 'hidden' })
        }
      }
      await cockpit.waitFor()
      expect(await frame.getByRole('tab', { name: '导演工作区', exact: true }).getAttribute('aria-selected')).toBe('true')
      await frame.getByRole('region', { name: '场景与镜头规划' }).waitFor()
    }
    const openDirectorWorkspace = async () => {
      await page.getByRole('button', { name: '打开导演工作区' }).click()
      await page.locator('iframe[title="青木导演工作区"]').scrollIntoViewIfNeeded()
      await settleEmbeddedHost()
    }
    const planning = () => host().getByRole('region', { name: '场景与镜头规划' })
    const commands: string[] = [], proposalRequests: string[] = [], freshnessChecks: string[] = []
    const browserDiagnostics: string[] = []
    const watch = () => {
      page.on('request', (request) => {
        if (request.url().endsWith('/qingmu-yimeng-command/saveScenePlanning')) commands.push(request.postData() ?? '')
        if (request.url().endsWith('/qingmu-yimeng-command/requestDirectorProposal')) proposalRequests.push(request.postData() ?? '')
        if (request.url().endsWith('/qingmu-yimeng-command/checkDirectorProposalFreshness')) freshnessChecks.push(request.postData() ?? '')
      })
      page.on('console', message => browserDiagnostics.push(`console:${message.type()}:${message.text()}`))
      page.on('requestfailed', request => browserDiagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText ?? 'unknown'}`))
    }
    watch()
    await installOuterSyncReceiver()
    try {
      await page.goto(initial.entryUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '新建项目' }).click()
      await page.getByLabel('项目名称', { exact: true }).fill('导演入场隔离样本 · 未经内容签收')
      await page.getByLabel('故事内容', { exact: true }).fill(scriptSource)
      await page.getByRole('button', { name: '下一步' }).click()
      await page.locator('#creation-type').selectOption('original_script')
      await page.getByRole('button', { name: '下一步' }).click()
      await page.getByRole('button', { name: '创建并锁定设定' }).click()
      await page.getByText(/创作设定已锁定/).waitFor()
      const before = inspect()
      expect(before.projects).toHaveLength(1)
      expect(before.projects[0]![1]).toBe(1)
      expect(before.projects[0]![2]).toMatch(/^[a-f0-9]{64}$/u)
      expect(JSON.parse(String(before.projects[0]![3]))).toMatchObject({ schema: 'qingmu.creative-contract.v1' })
      await openDirectorWorkspace()
      const bootstrapReceipt = JSON.parse(String(before.receipts[0]![2])) as { projectId: string; episodeId: string }
      const embeddedSrc = await page.locator('iframe[title="青木导演工作区"]').getAttribute('src')
      expect(embeddedSrc).not.toBeNull()
      const embeddedUrl = new URL(embeddedSrc as string)
      expect(embeddedUrl.searchParams.get('qingmuEmbedded')).toBe('1')
      expect(embeddedUrl.searchParams.get('qingmuProjectId')).toBe(bootstrapReceipt.projectId)
      expect(embeddedUrl.searchParams.get('qingmuEpisodeId')).toBe(bootstrapReceipt.episodeId)
      await host().getByRole('tab', { name: '剧本与资产', exact: true }).click()
      await host().getByText(/已沿用唯一创作入口的原文/).waitFor()
      expect(await host().locator('#qingmu-script-text').inputValue()).toBe(scriptSource)
      await host().getByRole('button', { name: '解析并保存预览草稿' }).click()
      await host().getByRole('region', { name: '解析预览' }).waitFor()
      await host().getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
      await host().getByRole('region', { name: '已保存剧本' }).waitFor()
      const scriptSaved = inspect()
      expect(scriptSaved.script[0]![1]).toBe(1)
      await host().getByRole('tab', { name: '导演工作区', exact: true }).click()
      await planning().getByRole('button', { name: '建立本场镜头' }).click()
      await planning().getByLabel('镜头名称', { exact: true }).fill('雨夜相遇')
      await planning().getByLabel('叙事目的', { exact: true }).fill('建立两人的第一次相遇')
      await planning().getByLabel('画面描述', { exact: true }).fill('雨夜门口，两人隔门相望')
      page.on('dialog', (dialog) => { void dialog.accept() })
      await page.reload({ waitUntil: 'load' })
      await openDirectorWorkspace()
      await host().getByRole('tab', { name: '导演工作区', exact: true }).click()
      expect(await planning().getByLabel('叙事目的', { exact: true }).inputValue()).toBe('建立两人的第一次相遇')
      await planning().getByRole('button', { name: /02 · 镜头 2/ }).click()
      await planning().getByLabel('镜头名称', { exact: true }).fill('回应邀请')
      await planning().getByLabel('动作与表演', { exact: true }).fill('阿明点头回应')
      await host().getByRole('button', { name: '刷新只读投影', exact: true }).waitFor()
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
      await expect.poll(async () => page.evaluate(() => (window as unknown as {
        __qingmuHostSync: { accepted: number; rejected: number; last: { authority: { source: string } } }
      }).__qingmuHostSync)).toMatchObject({ accepted: 1, rejected: 0,
        last: { authority: { source: 'manual_edit' } } })
      const first = inspect()
      expect(first.script).toEqual(scriptSaved.script)
      expect(first.counts).toMatchObject({ projects: 1, episodes: 1, actors: 2, scenes: 1,
        storyboard_frames: 2, storyboard_revisions: 1, command_receipts: 2 })
      expect(commands).toHaveLength(1)
      await planning().getByRole('button', { name: /01 · 雨夜相遇/ }).click()
      await planning().getByRole('status').filter({ hasText: '已绑定当前镜头上下文' }).waitFor()
      await planning().getByText(/^[a-f0-9]{64}$/u).waitFor()
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
      await expect.poll(async () => page.evaluate(() => (window as unknown as {
        __qingmuHostSync: {
          accepted: number
          rejected: number
          sceneId: string
          shotId: string
          last: { method: { adoptedItemIds: string[] }; authority: { source: string } }
        }
      }).__qingmuHostSync)).toMatchObject({ accepted: 2, rejected: 0,
        sceneId: String(first.frames[0]![1]), shotId: String(first.frames[0]![0]),
        last: { method: { adoptedItemIds: ['narrative-focus'] },
          authority: { source: 'adopted_replay_suggestion' } } })
      expect(proposalRequests).toHaveLength(1); expect(freshnessChecks).toHaveLength(1)
      const after = inspect()
      expect(after.frames[1]).toEqual(first.frames[1]); expect(after.entities).toEqual(first.entities)
      expect(after.script).toEqual(scriptSaved.script)
      expect(after.frames[0]![0]).toBe(first.frames[0]![0]); expect(after.receipts).toHaveLength(3)
      for (const table of ['assets', 'prompt_irs', 'generation_tasks', 'provider_preflights', 'provider_budget_events', 'provider_authorization_reservations', 'provider_submission_outbox', 'episode_release_authority', 'episode_production_step_receipts', 'agent_runs', 'workflow_runs', 'step_runs']) expect(after.counts[table]).toBe(0)
      const embeddedFrame = page.locator('iframe[title="青木导演工作区"]')
      await embeddedFrame.evaluate((node: HTMLIFrameElement) => { node.src = node.src })
      await settleEmbeddedHost()
      await expect.poll(async () => page.evaluate(() => (window as unknown as {
        __qingmuHostSync: { accepted: number; duplicates: number; sceneId: string; shotId: string }
      }).__qingmuHostSync)).toMatchObject({ accepted: 2, duplicates: 1,
        sceneId: String(first.frames[0]![1]), shotId: String(first.frames[0]![0]) })
      expect(run('stop').dataPreserved).toBe(true); expect(run('start').ready).toBe(true)
      await page.context().close()
      page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); page.setDefaultTimeout(15_000); watch()
      await installOuterSyncReceiver()
      await page.goto(initial.entryUrl, { waitUntil: 'load' })
      await page.goto(new URL(`/projects/${String(after.projects[0]![0])}`, initial.webUrl).toString(), { waitUntil: 'load' })
      await page.getByText(/创作设定已锁定/).waitFor()
      await openDirectorWorkspace()
      await host().getByRole('tab', { name: '导演工作区', exact: true }).click()
      await planning().getByLabel('镜头名称', { exact: true }).waitFor()
      await planning().getByRole('status').filter({ hasText: '已绑定当前镜头上下文' }).waitFor()
      expect(await planning().getByLabel('镜头名称', { exact: true }).inputValue()).toBe('雨夜相遇')
      expect(await planning().getByLabel('叙事目的', { exact: true }).inputValue())
        .toBe('建立两人的第一次相遇；明确本镜情绪落点。')
      expect(inspect()).toEqual(after); expect(commands).toHaveLength(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await host().getByRole('button', { name: '刷新只读投影', exact: true }).waitFor()
      expect(await host().getByText('只读连接未完成', { exact: true }).count()).toBe(0)
      await planning().getByRole('button', { name: '读取演练建议' }).click()
      await planning().getByText('原值', { exact: true }).first().scrollIntoViewIfNeeded()
      expect(inspect()).toEqual(after)
      const forgedOrigin = await page.request.post(`${initial.hostUrl}/qingmu-director-context/enter`, {
        data: {}, headers: { origin: 'https://forged.example.invalid' },
      })
      expect(forgedOrigin.status()).toBe(403)
      await page.screenshot({ path: join(parent, 'proposal-restored-1280.png') })
      expect({ counts: after.counts, titles: after.frames.map(f => f[2]),
        sourceUnchanged: after.script[0]![2] === scriptSaved.script[0]![2],
        inputRestored: true, lostReplyRecovered: true, freshBrowserAfterRestart: true,
        creativeContractRestored: true, directorContextRestored: true,
        forgedOriginRejected: true, missingReferences: true, noPromptIr: true }).toMatchSnapshot()
      writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, entryUrl: initial.entryUrl,
        after, commandCount: commands.length,
        originalScriptUnchanged: true, unrelatedShotUnchanged: true, inputRestored: true,
        lostReplyRecovered: true, freshBrowserAfterRestart: true, creativeContractRestored: true,
        directorContextRestored: true, forgedOriginRejected: true }, null, 2))
      console.log('Qingmu scene planning evidence:', parent)
    } catch (error) {
      let frameText = ''
      try { frameText = await host().locator('body').innerText({ timeout: 2_000 }) } catch {}
      writeFileSync(join(parent, 'browser-failure.txt'), `${await page.locator('body').innerText()}\n\n--- embedded Host ---\n${frameText}\n\n--- diagnostics ---\n${browserDiagnostics.join('\n')}\nframes:${page.frames().map(frame => frame.url()).join(',')}`)
      await page.screenshot({ path: join(parent, 'failure.png') }); throw error
    } finally { await browser.close(); run('stop') }
  }, 180_000)
})
