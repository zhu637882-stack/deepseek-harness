// Real launcher/FastAPI/Host acceptance for the inactive DSh one-shot Director execution seam.
import { createHash } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT, core = process.env.IMAGO_OS_CORE_ROOT

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')

interface Scope { projectId: string; episodeId: string; sceneId: string; shotId: string }
interface DbState {
  scope: Scope
  counts: Record<string, number>
  tasks: (string | number | null)[][]
  outbox: (string | number | null)[][]
  reservations: (string | number | null)[][]
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
      )) as { ready: boolean; webUrl: string; dataPreserved: boolean }
      const inspect = (): DbState => JSON.parse(execFileSync(join(writer!, '.venv/bin/python'), ['-c',
        `import sqlite3,json,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
one=lambda q: c.execute(q).fetchone()[0]
scope={"projectId":one("SELECT id FROM projects"),"episodeId":one("SELECT id FROM episodes"),"sceneId":one("SELECT scene_id FROM storyboard_frames"),"shotId":one("SELECT id FROM storyboard_frames")}
tables=["generation_tasks","provider_preflights","provider_budget_events","provider_authorization_reservations","provider_submission_outbox","assets","prompt_irs","entity_reference_packs","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]
print(json.dumps({"scope":scope,"counts":{t:one("SELECT count(*) FROM "+t) for t in tables},"tasks":c.execute("SELECT id,local_status,provider_status,dispatch_epoch FROM generation_tasks").fetchall(),"outbox":c.execute("SELECT dispatch_digest,state,terminal_outcome,response_json FROM provider_submission_outbox").fetchall(),"reservations":c.execute("SELECT dispatch_digest,released,amount_cny FROM provider_authorization_reservations").fetchall()}))`,
        join(root, 'storage/jason.db')], { encoding: 'utf8' })) as DbState
      const patchConfig = (fixture: Record<string, unknown> | null) => {
        const path = join(root, 'private/instance.json')
        const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
        if (fixture === null) delete config.directorExecutionFixture
        else config.directorExecutionFixture = fixture
        writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
        chmodSync(path, 0o600)
      }
      const browser = await chromium.launch()
      let mock: { child: ChildProcess; url: string } | undefined
      let page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(15_000)
      const loopbackRequests: string[] = []
      const watch = () => page.on('request', request => loopbackRequests.push(request.url()))
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
        const workbench = page.getByRole('button', { name: '青木制作台', exact: true })
        try {
          await workbench.click({ timeout: 5_000 })
        } catch (error) {
          if (!await readOnly.isVisible()) throw error
          await readOnly.click()
          await workbench.click()
        }
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
        await enter(initial.webUrl, true)
        await page.getByLabel('项目名称', { exact: true }).fill('Host执行身份隔离样本 · 未经内容签收')
        await page.getByRole('button', { name: '新建项目与第 1 集' }).click()
        await page.getByLabel('剧本文字', { exact: true }).fill('场景一：雨夜旧街\n动作：门缓缓打开。\n林夏：请进。')
        await page.getByRole('button', { name: '解析并保存预览草稿' }).click()
        await page.getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
        await page.getByRole('region', { name: '已保存剧本' }).waitFor()
        await page.getByRole('tab', { name: '导演工作区', exact: true }).click()
        const planning = page.getByRole('region', { name: '场景与镜头规划' })
        await planning.getByRole('button', { name: '建立本场镜头' }).click()
        await planning.getByLabel('镜头名称', { exact: true }).fill('雨夜开门')
        await planning.getByLabel('叙事目的', { exact: true }).fill('建立人物第一次相遇')
        await planning.getByLabel('画面描述', { exact: true }).fill('雨夜门口，门缓缓打开')
        await planning.getByRole('button', { name: '预览保存影响' }).click()
        await planning.getByRole('button', { name: '确认保存规划' }).click()
        await planning.getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()
        const baseline = inspect(), scope = baseline.scope
        const replay = await rpc<{ inputSha256: string; methodPackage: { version: string; methodPackageSha256: string } }>(
          'requestDirectorProposal', { ...scope, suggestionType: 'text_director_proposal' },
        )
        expect(baseline.counts.generation_tasks).toBe(0)
        expect(run('stop').dataPreserved).toBe(true)
        const proposal = { schema: 'qingmu.director-proposal.v1', ...scope, advisoryOnly: true,
          items: [{ id: 'narrative-browser-1', field: 'narrative',
            proposedValue: '让开门动作承担情绪转折', impact: '仅为隔离 mock 建议，不授予正式状态' }] }
        const countPath = join(parent, 'mock-post-count.txt')
        mock = await startMock(countPath, proposal)
        const fixture: Record<string, unknown> = {
          fixtureOnly: true, provider: 'deepseek-official', model: 'deepseek-v4-pro',
          transportMode: 'dsh-one-shot-mock', mockBaseUrl: mock.url,
          routeKey: 'qingmu.director.text.proposal.acceptance-only',
          projectId: scope.projectId, episodeId: scope.episodeId,
          methodPackageVersion: replay.methodPackage.version,
          methodPackageSha256: replay.methodPackage.methodPackageSha256,
          maxPaidCny: 0.01,
        }
        patchConfig(fixture)
        expect(run('start').ready).toBe(true); run('login')
        await page.reload({ waitUntil: 'load' })
        const identity = { sceneId: scope.sceneId, shotId: scope.shotId,
          purpose: 'director_text_proposal_canary', methodPackageVersion: replay.methodPackage.version,
          methodPackageSha256: replay.methodPackage.methodPackageSha256,
          expectedContextSnapshotSha256: replay.inputSha256 }
        const order = await rpc<{ generationTaskId: string; provider: string; model: string }>(
          'issueDirectorProviderWorkOrder', { projectId: scope.projectId, episodeId: scope.episodeId,
            ...identity, idempotencyKey: sha(identity) },
        )
        expect(order).toMatchObject({ provider: 'deepseek-official', model: fixture.model })
        const issued = inspect()
        expect(issued.counts).toMatchObject({ generation_tasks: 1, provider_preflights: 1,
          provider_authorization_reservations: 0, provider_submission_outbox: 0 })
        expect(run('stop').dataPreserved).toBe(true)
        fixture.taskId = order.generationTaskId
        writeFileSync(join(root, 'dsh/.credentials.yaml'),
          'version: 1\nrefs:\n  QINGMU_C0_DEEPSEEK_KEY: isolated-c0-mock-key\n', { mode: 0o600 })
        patchConfig(fixture)
        expect(run('start').ready).toBe(true); run('login')
        await page.context().close()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
        await enter(initial.webUrl)
        let status: {
          state: string
          generationTaskId: string
          executionReceipt: Record<string, unknown> | null
          costAccounting: Record<string, unknown> | null
        }
        await expect.poll(async () => {
          status = await rpc('readDirectorProviderWorkOrderStatus', {
            projectId: scope.projectId, episodeId: scope.episodeId, generationTaskId: order.generationTaskId,
          })
          return status.state
        }, { timeout: 15_000 }).toBe('settled')
        expect(status!).toMatchObject({ generationTaskId: order.generationTaskId,
          executionReceipt: { providerCompletionId: 'completion-c0-browser-1', providerRequestId: 'request-c0-browser-1' },
          costAccounting: { actualAmountCny: null, billingReconciliation: 'pending' } })
        const settled = inspect()
        expect(settled.tasks).toEqual([[order.generationTaskId, 'succeeded', 'SUCCEEDED', 1]])
        expect(settled.outbox).toHaveLength(1); expect(settled.outbox[0]!.slice(1, 3)).toEqual(['settled', 'settled'])
        expect(settled.reservations).toHaveLength(1); expect(settled.reservations[0]![1]).toBe(0)
        expect(settled.counts).toMatchObject({ generation_tasks: 1, provider_preflights: 1,
          provider_authorization_reservations: 1, provider_submission_outbox: 1 })
        expect(readFileSync(countPath, 'utf8')).toBe('1')
        for (const table of ['assets', 'prompt_irs', 'entity_reference_packs',
          'episode_release_authority', 'episode_production_step_receipts', 'agent_runs', 'workflow_runs', 'step_runs']) {
          expect(settled.counts[table]).toBe(0)
        }
        expect(run('stop').dataPreserved).toBe(true)
        patchConfig(null)
        expect(run('start').ready).toBe(true); run('login')
        await page.context().close()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
        await enter(initial.webUrl)
        const recovered = await rpc<typeof status>('readDirectorProviderWorkOrderStatus', {
          projectId: scope.projectId, episodeId: scope.episodeId, generationTaskId: order.generationTaskId,
        })
        expect(recovered).toEqual(status!)
        expect(inspect()).toEqual(settled)
        expect(loopbackRequests.every((value) => {
          const host = new URL(value).hostname
          return host === '127.0.0.1' || host === 'localhost'
        })).toBe(true)
        writeFileSync(join(parent, 'result.json'), JSON.stringify({ root, webUrl: initial.webUrl,
          taskId: order.generationTaskId, status: recovered.state, provider: order.provider,
          activePaidRouteAfterRestart: false, dshOneShotMockOnly: true, mockProviderPostCount: 1,
          browserRequestsLoopbackOnly: true, settled }, null, 2))
        console.log('Qingmu Director execution evidence:', parent)
      } catch (error) {
        writeFileSync(join(parent, 'browser-failure.txt'), await page.locator('body').innerText())
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
