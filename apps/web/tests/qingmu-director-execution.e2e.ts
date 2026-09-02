// Real launcher/FastAPI/Host/Chromium acceptance for the keyless paid Director interaction seam.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT, core = process.env.IMAGO_OS_CORE_ROOT

interface Scope { projectId: string; episodeId: string; sceneId: string; shotId: string }
interface DbState {
  scope: Scope
  counts: Record<string, number>
  tasks: (string | number | null)[][]
  outbox: (string | number | null)[][]
  reservations: (string | number | null)[][]
}

const captureStableAria = async (page: import('playwright').Page, selector: string): Promise<string> => {
  const region = page.locator(selector).first()
  let previous = await region.ariaSnapshot()
  await expect.poll(async () => {
    const current = await region.ariaSnapshot()
    const stable = current === previous
    previous = current
    return stable
  }).toBe(true)
  return previous
}

const compareOrRefreshGolden = (path: string, actual: string): void => {
  const payload = `${actual.trimEnd()}\n`
  if (process.env.DSH_SNAPSHOT === 'refresh') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, payload)
    return
  }
  expect(payload).toBe(readFileSync(path, 'utf8'))
}

const startMock = async (countPath: string, proposal: object): Promise<{ child: ChildProcess; url: string }> => {
  // oxlint-disable-next-line @stylistic/quotes -- Embedded Python uses both quote styles and physical newlines.
  const code = `import http.server,json,sys\ncount_path=sys.argv[1]\nproposal=json.loads(sys.argv[2])\nclass H(http.server.BaseHTTPRequestHandler):\n def do_POST(self):\n  n=int(open(count_path).read() or '0')+1;open(count_path,'w').write(str(n))\n  length=int(self.headers.get('content-length','0'));body=json.loads(self.rfile.read(length))\n  assert self.path=='/chat/completions' and body['model']=='deepseek-v4-pro' and body['response_format']=={'type':'json_object'} and 'tools' not in body\n  self.send_response(200);self.send_header('content-type','text/event-stream');self.send_header('x-request-id','request-c0-browser-1');self.end_headers()\n  text=json.dumps(proposal,ensure_ascii=False,separators=(',',':'))\n  events=[{'id':'completion-c0-browser-1','choices':[{'delta':{'content':text}}]},{'id':'completion-c0-browser-1','choices':[{'finish_reason':'stop'}],'usage':{'prompt_tokens':20,'completion_tokens':10,'prompt_cache_hit_tokens':5}}]\n  for event in events:self.wfile.write(('data: '+json.dumps(event,separators=(',',':'))+'\\n\\n').encode())\n  self.wfile.write(b'data: [DONE]\\n\\n');self.wfile.flush()\n def log_message(self,*args):pass\ns=http.server.ThreadingHTTPServer(('127.0.0.1',0),H);print(s.server_address[1],flush=True);s.serve_forever()`
  writeFileSync(countPath, '0')
  const child = spawn('python3', ['-u', '-c', code, countPath, JSON.stringify(proposal)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise<string>((resolve, reject) => {
    const output = child.stdout
    if (output === null) throw new Error('mock stdout unavailable')
    output.once('data', (chunk) => { resolve(String(chunk).trim()) })
    child.once('error', reject)
    child.once('exit', (code) => { reject(new Error(`mock exited before ready: ${code}`)) })
  })
  return { child, url: `http://127.0.0.1:${port}` }
}

describe.skipIf(!writer || !core || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')(
  'real Director Host execution identity', () => {
    it('lets a browser issue/read while only the signed Host executes one real DSh mock request', async () => {
      const parent = mkdtempSync('/private/tmp/qingmu-director-execution-browser-')
      const root = join(parent, 'instance')
      writeFileSync(join(parent, 'ACCEPTANCE-ONLY'),
        'Isolated DSh mock Director execution. No external Provider network, content approval, or user-instance write.\n')
      const run = (op: string, args: string[] = []) => JSON.parse(execFileSync(
        'python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', root, ...args],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 },
      )) as { ready: boolean; hostUrl: string; entryUrl: string; dataPreserved: boolean }
      const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
        `import sqlite3,json,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
one=lambda q: c.execute(q).fetchone()[0]
scope={"projectId":one("SELECT id FROM projects"),"episodeId":one("SELECT id FROM episodes"),"sceneId":one("SELECT scene_id FROM storyboard_frames ORDER BY frame_no LIMIT 1"),"shotId":one("SELECT id FROM storyboard_frames ORDER BY frame_no LIMIT 1")}
tables=["generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox","assets","prompt_irs","entity_reference_packs","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]
print(json.dumps({"scope":scope,"counts":{t:one("SELECT count(*) FROM "+t) for t in tables},"tasks":c.execute("SELECT id,local_status,provider_status,dispatch_epoch FROM generation_tasks").fetchall(),"outbox":c.execute("SELECT dispatch_digest,state,terminal_outcome,response_json FROM provider_submission_outbox").fetchall(),"reservations":c.execute("SELECT dispatch_digest,released,amount_cny FROM provider_authorization_reservations").fetchall()}))`,
        join(root, 'storage/jason.db')], { encoding: 'utf8' })) as DbState
      const patchProductionConfig = (production: Record<string, unknown> | null, mockBaseUrl?: string) => {
        const path = join(root, 'private/instance.json')
        const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
        delete config.directorExecutionFixture
        if (production === null) {
          delete config.directorProductionExecution
          delete config._directorSubmitMockBaseUrl
        } else {
          config.directorProductionExecution = production
          config._directorSubmitMockBaseUrl = mockBaseUrl
          const override = join(root, 'private/director-production.json')
          writeFileSync(override, JSON.stringify(production, null, 2) + '\n', { mode: 0o600 })
          chmodSync(override, 0o600)
        }
        writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
        chmodSync(path, 0o600)
      }
      const browser = await chromium.launch()
      let mock: { child: ChildProcess; url: string } | undefined
      let page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(15_000)
      const loopbackRequests: string[] = []
      const paidRequestBodies: string[] = []
      const watch = () => page.on('request', (request) => {
        loopbackRequests.push(request.url())
        if (request.url().endsWith('/issueDirectorProviderWorkOrder')) paidRequestBodies.push(request.postData() ?? '')
      })
      watch()
      const enter = async (url: string, first = false) => {
        await page.goto(url, { waitUntil: 'load' })
        const welcome = page.getByRole('button', { name: '进入青木 OS' })
        const enteredFromWelcome = first || await welcome.isVisible()
        if (enteredFromWelcome) await welcome.click()
        const readOnly = page.getByRole('button', { name: '先以只读方式进入' })
        if (enteredFromWelcome) {
          await readOnly.waitFor({ state: 'visible' })
          await readOnly.click()
        } else if (await readOnly.isVisible()) {
          await readOnly.click()
        }
        const cockpit = page.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
        const workbench = page.getByRole('button', { name: '青木制作台', exact: true })
        if (!await cockpit.isVisible()) {
          try {
            await workbench.click({ timeout: 5_000 })
          } catch (error) {
            if (!await readOnly.isVisible()) throw error
            await readOnly.click()
            if (!await cockpit.isVisible()) await workbench.click()
          }
        }
        await cockpit.waitFor()
      }
      const rpc = async <T>(endpoint: string, payload: object): Promise<T> => page.evaluate(async ({ endpoint, payload }) => {
        const rpcId = crypto.randomUUID()
        const response = await fetch(`/qingmu-yimeng-command/${endpoint}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
        })
        if (!response.ok) throw new Error(`RPC ${endpoint} HTTP ${response.status}`)
        const envelope = await response.json() as { rpcId: string; result: { ok: boolean; value?: unknown; error?: unknown } }
        if (envelope.rpcId !== rpcId || !envelope.result.ok) throw new Error(`RPC ${endpoint} failed`)
        return envelope.result.value as T
      }, { endpoint, payload })
      run('init', ['--yimeng-root', writer!, '--core-root', core!])
      const initial = run('start'); expect(initial.ready).toBe(true); run('login')
      try {
        await page.goto(initial.entryUrl, { waitUntil: 'load' })
        await page.getByRole('button', { name: '新建项目' }).click()
        await page.getByLabel('项目名称', { exact: true }).fill('Host执行身份隔离样本 · 未经内容签收')
        await page.getByLabel('故事内容', { exact: true }).fill('场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。')
        await page.locator('#creation-text-version').selectOption({ index: 1 })
        await page.getByRole('button', { name: '下一步' }).click()
        await page.locator('#creation-type').selectOption('original_script')
        await page.getByRole('button', { name: '请选择风格' }).click()
        await page.locator('button[title]').first().click()
        await page.locator('#creation-style-pack').selectOption({ index: 1 })
        await page.locator('#creation-director-skill').selectOption('shot_blocking_director')
        await page.getByRole('button', { name: '下一步' }).click()
        await page.getByRole('button', { name: '创建并锁定设定' }).click()
        await page.getByText(/创作设定已锁定/).waitFor()
        const openDirector = page.getByRole('button', { name: '打开导演工作区' })
        await openDirector.waitFor({ timeout: 8_000 }).catch(() => undefined)
        if (!await openDirector.isVisible()) {
          await page.getByRole('button', { name: /继续故事大纲/ }).first().click()
          await openDirector.waitFor()
        }
        await openDirector.click()
        await page.locator('iframe[title="青木导演工作区"]').scrollIntoViewIfNeeded()
        const host = page.frameLocator('iframe[title="青木导演工作区"]')
        const welcome = host.getByRole('button', { name: '进入青木 OS' })
        const readOnly = host.getByRole('button', { name: '先以只读方式进入' })
        const cockpit = host.getByRole('dialog', { name: '青木 OS 制作驾驶舱' })
        await welcome.or(readOnly).or(cockpit).first().waitFor()
        if (await welcome.isVisible()) {
          await welcome.click()
          await welcome.waitFor({ state: 'hidden' })
        }
        await readOnly.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined)
        if (await readOnly.isVisible()) {
          await readOnly.evaluate((button: HTMLButtonElement) => { button.click() })
          await readOnly.waitFor({ state: 'hidden' })
        }
        await cockpit.waitFor()
        await host.getByRole('tab', { name: '剧本与资产', exact: true }).click()
        await host.getByRole('button', { name: '解析并保存预览草稿' }).click()
        await host.getByRole('region', { name: '解析预览' }).waitFor()
        await host.getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
        await host.getByRole('region', { name: '已保存剧本' }).waitFor()
        await host.getByRole('tab', { name: '导演工作区', exact: true }).click()
        const planning = host.getByRole('region', { name: '场景与镜头规划' })
        await planning.getByRole('button', { name: '建立本场镜头' }).click()
        await planning.getByLabel('镜头名称', { exact: true }).fill('雨夜开门')
        await planning.getByLabel('叙事目的', { exact: true }).fill('建立人物第一次相遇')
        await planning.getByLabel('画面描述', { exact: true }).fill('雨夜门口，门缓缓打开')
        await planning.getByRole('button', { name: '预览保存影响' }).click()
        await planning.getByRole('button', { name: '确认保存规划' }).click()
        await planning.getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()
        await enter(initial.hostUrl)
        const baseline = inspect(), scope = baseline.scope
        const replay = await rpc<{ inputSha256: string; methodPackage: { version: string; methodPackageSha256: string } }>(
          'requestDirectorProposal', { ...scope, suggestionType: 'text_director_proposal' },
        )
        expect(baseline.counts.generation_tasks).toBe(0)
        expect(run('stop').dataPreserved).toBe(true)
        const proposal = { schema: 'qingmu.director-proposal.v1', ...scope, advisoryOnly: true,
          items: [{ id: 'narrative_browser_1', field: 'narrative',
            proposedValue: '让开门动作承担情绪转折', impact: '仅为隔离 mock 建议，不授予正式状态' }] }
        const countPath = join(parent, 'mock-post-count.txt')
        mock = await startMock(countPath, proposal)
        const production: Record<string, unknown> = {
          productionOnly: true, provider: 'deepseek-official', model: 'deepseek-v4-pro',
          baseUrl: 'https://api.deepseek.com', endpoint: '/chat/completions',
          routeKey: 'qingmu.director.text.proposal.d1',
          projectId: scope.projectId, episodeId: scope.episodeId,
          methodPackageVersion: replay.methodPackage.version,
          methodPackageSha256: replay.methodPackage.methodPackageSha256,
          maxPaidCny: 0.30, maxInputTokens: 8000, maxOutputTokens: 2000,
          thinking: 'disabled', images: false, files: false, tools: false,
          credentialFile: '/Users/a1234/.dsh/.credentials.yaml',
          transportEnabled: false, interactiveEnabled: true,
        }
        patchProductionConfig(production, mock.url)
        expect(run('start').ready).toBe(true); run('login')
        await page.context().close()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
        await enter(initial.hostUrl)
        const paidRegion = page.getByRole('region', { name: '真实 DeepSeek 导演建议（Provider 生成）' })
        const paidButton = paidRegion.getByRole('button', { name: '请求真实 DeepSeek 导演建议（会产生费用）' })
        await expect.poll(() => paidButton.isEnabled()).toBe(true)
        let confirmation = ''
        page.once('dialog', async (dialog) => { confirmation = dialog.message(); await dialog.accept() })
        const issueResponse = page.waitForResponse(response => response.url().endsWith('/issueDirectorProviderWorkOrder'))
        await paidButton.click()
        expect(confirmation).toContain('失败不自动重试')
        const issueEnvelope = await (await issueResponse).json() as { result: { ok: boolean; error?: unknown } }
        writeFileSync(join(parent, 'issue-response.json'), JSON.stringify(issueEnvelope, null, 2))
        expect(issueEnvelope.result).toMatchObject({ ok: true })
        await paidRegion.getByText('让开门动作承担情绪转折', { exact: true }).waitFor()
        const issued = inspect()
        expect(issued.tasks).toHaveLength(1)
        const generationTaskId = String(issued.tasks[0]![0])
        let status: {
          state: string
          generationTaskId: string
          executionReceipt: Record<string, unknown> | null
          costAccounting: Record<string, unknown> | null
        }
        await expect.poll(async () => {
          status = await rpc('readDirectorProviderWorkOrderStatus', {
            projectId: scope.projectId, episodeId: scope.episodeId, generationTaskId,
          })
          return status.state
        }, { timeout: 15_000 }).toBe('settled')
        expect(status!).toMatchObject({ generationTaskId,
          executionReceipt: { providerCompletionId: 'completion-c0-browser-1', providerRequestId: 'request-c0-browser-1' },
          costAccounting: { actualAmountCny: null, billingReconciliation: 'pending' } })
        const settled = inspect()
        expect(settled.tasks).toEqual([[generationTaskId, 'succeeded', 'SUCCEEDED', 1]])
        expect(settled.outbox).toHaveLength(1); expect(settled.outbox[0]!.slice(1, 3)).toEqual(['settled', 'settled'])
        expect(settled.reservations).toHaveLength(1); expect(settled.reservations[0]![1]).toBe(0)
        expect(settled.counts).toMatchObject({ generation_tasks: 1, provider_preflights: 1,
          provider_authorization_reservations: 1, provider_submission_outbox: 1 })
        expect(readFileSync(countPath, 'utf8')).toBe('1')
        for (const table of ['assets', 'prompt_irs', 'entity_reference_packs',
          'episode_release_authority', 'episode_production_step_receipts', 'agent_runs', 'workflow_runs', 'step_runs']) {
          expect(settled.counts[table]).toBe(0)
        }
        const aria = (await captureStableAria(
          page, 'role=region[name="真实 DeepSeek 导演建议（Provider 生成）"]',
        )).replace(/[a-f0-9]{64}/g, '<sha256>')
          .replace(/(?:task|director_paid_work_order)_[a-z0-9_]+/gi, '<bound-id>')
        const golden = join(REPO_ROOT, 'apps/web/tests/snapshots/qingmu-director-paid-interactive/ui.expected.md')
        compareOrRefreshGolden(golden, aria)
        expect(run('stop').dataPreserved).toBe(true)
        patchProductionConfig(null)
        expect(run('start').ready).toBe(true); run('login')
        await page.context().close()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
        await enter(initial.hostUrl)
        const recovered = await rpc<typeof status>('readDirectorProviderWorkOrderStatus', {
          projectId: scope.projectId, episodeId: scope.episodeId, generationTaskId,
        })
        expect(recovered).toEqual(status!)
        expect(inspect()).toEqual(settled)
        expect(loopbackRequests.every((value) => {
          const host = new URL(value).hostname
          return host === '127.0.0.1' || host === 'localhost'
        })).toBe(true)
        writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, hostUrl: initial.hostUrl,
          taskId: generationTaskId, status: recovered.state, provider: 'deepseek-official',
          activePaidRouteAfterRestart: false, dshOneShotMockOnly: true, mockProviderPostCount: 1,
          browserRequestsLoopbackOnly: true, settled }, null, 2))
        console.log('Qingmu Director execution evidence:', parent)
      } catch (error) {
        writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
        writeFileSync(join(parent, 'browser-failure-details.json'), JSON.stringify({ paidRequestBodies }, null, 2))
        await page.screenshot({ path: join(parent, 'failure.png') })
        throw error
      } finally {
        await browser.close()
        mock?.child.kill('SIGTERM')
        try { run('stop') } catch { /* launcher may already be stopped after a failed phase */ }
      }
    }, 240_000)
  },
)
