// D1 acceptance: output-semantics-bound work order and private permit, with zero Provider calls.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

const writer = process.env.QINGMU_LOCAL_YIMENG_ROOT
const core = process.env.IMAGO_OS_CORE_ROOT
const root = process.env.QINGMU_D1_PHASE1_ROOT
const expectedRoot = '/Users/a1234/Library/Application Support/QingmuOS-Canary/d1-deepseek-text-20260902'
const credentialFile = '/Users/a1234/.dsh/.credentials.yaml'

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const fileSha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

interface Scope { projectId: string; episodeId: string; sceneId: string; shotId: string }
interface LauncherStatus {
  ready: boolean
  apiUrl: string
  webUrl: string
  entryUrl: string
  instanceId: string
  dataPreserved: boolean
}
interface DirectorContext {
  script: { revision: number; sha256: string }
  storyboard: { id: string; version: number; sourceHash: string }
  selectedReferences: readonly object[]
  contextSnapshotSha256: string
}

describe.skipIf(!writer || !core || root !== expectedRoot || process.env.DSH_CLIENT_BUILD_PROFILE !== 'qingmu')(
  'D1 Director production pre-submit lock', () => {
    it('persists one exact paid-capable permit without loading credentials or invoking Provider transport', async () => {
      const run = (op: string, args: string[] = []): LauncherStatus => JSON.parse(execFileSync(
        'python3', [join(REPO_ROOT, 'scripts/qingmu-local.py'), op, '--root', expectedRoot, ...args],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90_000 },
      )) as LauncherStatus
      const configPath = join(expectedRoot, 'private/instance.json')
      const patchConfig = (production: Record<string, unknown>) => {
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
        expect(config.directorExecutionFixture).toBeUndefined()
        config.directorProductionExecution = production
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
        chmodSync(configPath, 0o600)
      }
      const inspect = () => JSON.parse(execFileSync(writer! + '/.venv/bin/python', ['-c',
        `import json,sqlite3,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
one=lambda q:c.execute(q).fetchone()[0]
tables=["generation_tasks","provider_preflights","provider_authorization_reservations","provider_submission_outbox","assets","prompt_irs","entity_reference_packs","episode_release_authority","episode_production_step_receipts","agent_runs","workflow_runs","step_runs"]
print(json.dumps({"counts":{t:one("SELECT count(*) FROM "+t) for t in tables},"tasks":c.execute("SELECT id,local_status,provider_status,dispatch_epoch FROM generation_tasks").fetchall(),"outbox":c.execute("SELECT state,terminal_outcome,response_json FROM provider_submission_outbox").fetchall(),"reservations":c.execute("SELECT released,amount_cny FROM provider_authorization_reservations").fetchall()}))`,
        join(expectedRoot, 'storage/jason.db')], { encoding: 'utf8' })) as {
        counts: Record<string, number>
        tasks: (string | number | null)[][]
        outbox: (string | number | null)[][]
        reservations: (string | number | null)[][]
      }
      const browser = await chromium.launch()
      const commandAdapter = await import(pathToFileURL(join(REPO_ROOT,
        'packages/experimental/qingmu-yimeng-command-adapter/lib/index.js')).href) as {
        readDirectorTaskBinding: (
          options: { baseUrl: string; executionKey: string }, taskId: string,
          signal: AbortSignal,
        ) => Promise<Record<string, unknown> & {
          requestSha256: string
          payloadSha256: string
          dispatchKey: string
          dispatchEpoch: number
          claimToken: string
          routeKey: string
          inputPolicy: { unit: string; promptUtf8Bytes: number; maxInputTokens: number }
        }>
      }
      let page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
      page.setDefaultTimeout(15_000)
      const requests: string[] = []
      const watch = () => page.on('request', request => requests.push(request.url()))
      watch()
      const host = () => page.frameLocator('iframe[title="青木导演工作区"]')
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
        await readOnly.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined)
        if (await readOnly.isVisible()) {
          await readOnly.evaluate((button: HTMLButtonElement) => { button.click() })
          await readOnly.waitFor({ state: 'hidden' })
        }
        await cockpit.waitFor()
        await frame.getByRole('region', { name: '场景与镜头规划' }).waitFor()
      }
      const openDirectorWorkspace = async () => {
        const open = page.getByRole('button', { name: '打开导演工作区' })
        await open.waitFor({ timeout: 8_000 }).catch(() => undefined)
        if (!await open.isVisible()) {
          const resume = page.getByRole('button', { name: /继续故事大纲/ }).first()
          await resume.waitFor()
          await resume.click()
          await open.waitFor()
        }
        await open.click()
        await page.locator('iframe[title="青木导演工作区"]').scrollIntoViewIfNeeded()
        await settleEmbeddedHost()
      }
      const planning = () => host().getByRole('region', { name: '场景与镜头规划' })
      const rpc = async <T>(endpoint: string, payload: object): Promise<T> => host().locator('body').evaluate(async (_, { endpoint, payload }) => {
        const rpcId = crypto.randomUUID()
        const response = await fetch(`/qingmu-yimeng-command/${endpoint}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
        })
        if (!response.ok) throw new Error(`RPC ${endpoint} HTTP ${response.status}`)
        const envelope = await response.json() as { rpcId: string; result: { ok: boolean; value?: unknown } }
        if (envelope.rpcId !== rpcId || !envelope.result.ok) throw new Error(`RPC ${endpoint} failed`)
        return envelope.result.value as T
      }, { endpoint, payload })

      let started: LauncherStatus | undefined
      try {
        expect(() => statSync(expectedRoot)).toThrow()
        run('init', ['--yimeng-root', writer!, '--core-root', core!])
        started = run('start'); expect(started.ready).toBe(true); run('login')
        await page.goto(started.entryUrl, { waitUntil: 'load' })
        await page.getByRole('button', { name: '新建项目' }).click()
        await page.getByLabel('项目名称', { exact: true }).fill('D1零外呼锁定样本 · 未经内容签收')
        await page.getByLabel('故事内容', { exact: true }).fill('场景一：清晨工作室\n动作：导演摊开分镜。\n林夏：先锁定这一镜。')
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
        await openDirectorWorkspace()
        await host().getByRole('tab', { name: '剧本与资产', exact: true }).click()
        await host().getByRole('button', { name: '解析并保存预览草稿' }).click()
        await host().getByRole('region', { name: '解析预览' }).waitFor()
        await host().getByRole('button', { name: '确认导入并保存剧本', exact: true }).click()
        await host().getByRole('region', { name: '已保存剧本' }).waitFor()
        await host().getByRole('tab', { name: '导演工作区', exact: true }).click()
        await planning().getByRole('button', { name: '建立本场镜头' }).click()
        await planning().getByLabel('镜头名称', { exact: true }).fill('工作室定场')
        await planning().getByLabel('叙事目的', { exact: true }).fill('建立导演进入工作状态')
        await planning().getByLabel('画面描述', { exact: true }).fill('清晨工作室，分镜铺在桌面')
        await planning().getByRole('button', { name: '预览保存影响' }).click()
        await planning().getByRole('button', { name: '确认保存规划' }).click()
        await planning().getByRole('status').filter({ hasText: '结构版本 1' }).waitFor()

        const scope = JSON.parse(execFileSync(writer! + '/.venv/bin/python', ['-c',
          `import json,sqlite3,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
one=lambda q:c.execute(q).fetchone()[0]
print(json.dumps({"projectId":one("SELECT id FROM projects"),"episodeId":one("SELECT id FROM episodes"),"sceneId":one("SELECT scene_id FROM storyboard_frames"),"shotId":one("SELECT id FROM storyboard_frames")}))`,
          join(expectedRoot, 'storage/jason.db')], { encoding: 'utf8' })) as Scope
        const replay = await rpc<{
          inputSha256: string
          methodPackage: { version: string; methodPackageSha256: string }
        }>('requestDirectorProposal', { ...scope, suggestionType: 'text_director_proposal' })
        expect(inspect().counts.generation_tasks).toBe(0)
        expect(run('stop').dataPreserved).toBe(true)

        const production: Record<string, unknown> = {
          productionOnly: true, provider: 'deepseek-official', model: 'deepseek-v4-pro',
          baseUrl: 'https://api.deepseek.com', endpoint: '/chat/completions',
          routeKey: 'qingmu.director.text.proposal.d1', projectId: scope.projectId,
          episodeId: scope.episodeId, methodPackageVersion: replay.methodPackage.version,
          methodPackageSha256: replay.methodPackage.methodPackageSha256,
          maxPaidCny: 0.30, maxInputTokens: 8000, maxOutputTokens: 2000,
          thinking: 'disabled', images: false, files: false, tools: false,
          credentialFile, transportEnabled: false, interactiveEnabled: false,
        }
        patchConfig(production)
        started = run('start'); expect(started.ready).toBe(true); run('login')
        await page.goto(started.entryUrl, { waitUntil: 'load' })
        const identity = {
          sceneId: scope.sceneId, shotId: scope.shotId,
          purpose: 'bounded_director_suggestion', suggestionType: 'text_director_proposal',
          methodPackageVersion: replay.methodPackage.version,
          methodPackageSha256: replay.methodPackage.methodPackageSha256,
          expectedContextSnapshotSha256: replay.inputSha256,
        }
        const session = JSON.parse(readFileSync(join(expectedRoot, 'private/session.json'), 'utf8')) as { token: string }
        const orderResponse = await fetch(`${started.apiUrl}/api/qingmu/projects/${encodeURIComponent(scope.projectId)}`
          + `/episodes/${encodeURIComponent(scope.episodeId)}/director-inference/provider-work-orders`, {
          method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ...identity, idempotencyKey: sha(identity) }),
        })
        expect(orderResponse.ok).toBe(true)
        const order = await orderResponse.json() as {
          workOrderId: string
          generationTaskId: string
          provider: string
          model: string
          inputSha256: string
          promptSha256: string
          outputContractSha256: string
          workOrderSha256: string
          methodPackage: { version: string; sha256: string }
          pricingSnapshot: { sha256: string; estimatedAmountCny: string }
          requestPolicy: { maxAttempts: number; maxRetries: number }
        }
        expect(order).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-pro',
          requestPolicy: { maxAttempts: 1, maxRetries: 0 } })
        expect(inspect().counts).toMatchObject({ generation_tasks: 1, provider_preflights: 1,
          provider_authorization_reservations: 0, provider_submission_outbox: 0 })

        const contextResponse = await fetch(`${started.apiUrl}/api/qingmu/projects/${encodeURIComponent(scope.projectId)}`
          + `/episodes/${encodeURIComponent(scope.episodeId)}/director-inference/context`
          + `?sceneId=${encodeURIComponent(scope.sceneId)}&shotId=${encodeURIComponent(scope.shotId)}`,
        { headers: { authorization: `Bearer ${session.token}` } })
        expect(contextResponse.ok).toBe(true)
        const context = await contextResponse.json() as DirectorContext
        expect(context.contextSnapshotSha256).toBe(order.inputSha256)

        const privateConfig = JSON.parse(readFileSync(configPath, 'utf8')) as { directorExecutionKey: string }
        const binding = await commandAdapter.readDirectorTaskBinding({
          baseUrl: started.apiUrl, executionKey: privateConfig.directorExecutionKey,
        }, order.generationTaskId, new AbortController().signal)
        expect(binding).toMatchObject({ taskId: order.generationTaskId, dispatchEpoch: 0,
          dispatchKey: '', claimToken: '' })

        const privateLockPath = join(expectedRoot, 'private/d1-pre-submit-lock.json')
        writeFileSync(privateLockPath, JSON.stringify(binding, null, 2) + '\n', { mode: 0o600 })
        chmodSync(privateLockPath, 0o600)
        production.taskId = order.generationTaskId
        patchConfig(production)
        const state = inspect()
        expect(state.counts).toMatchObject({ generation_tasks: 1, provider_preflights: 1,
          provider_authorization_reservations: 0, provider_submission_outbox: 0 })
        expect(state.outbox).toHaveLength(0)
        expect(state.reservations).toHaveLength(0)

        const lockPack = {
          schema: 'qingmu.d1-deepseek-text-pre-submit-lock.v4', status: 'active', submitAllowed: true,
          phase: 'd1_deepseek_text_zero_call_lock',
          task: 'QINGMU_D1_DEEPSEEK_TEXT_CANARY_20260902', createdAt: new Date().toISOString(),
          canary: { root: expectedRoot, instanceId: started.instanceId,
            database: join(expectedRoot, 'storage/jason.db'), isolatedSyntheticProject: true,
            humanContentSignoff: false },
          scope,
          sourceSnapshots: { scriptRevision: context.script.revision, scriptSha256: context.script.sha256,
            storyboardId: context.storyboard.id, storyboardVersion: context.storyboard.version,
            storyboardSha256: context.storyboard.sourceHash,
            selectedReferenceSnapshotSha256: sha(context.selectedReferences),
            contextSnapshotSha256: context.contextSnapshotSha256 },
          methodPackage: order.methodPackage,
          workOrder: { id: order.workOrderId, taskId: order.generationTaskId,
            routeKey: binding.routeKey,
            workOrderSha256: order.workOrderSha256, promptSha256: order.promptSha256,
            outputContractSha256: order.outputContractSha256,
            inputSha256: order.inputSha256, inputPolicy: binding.inputPolicy,
            requestSha256: binding.requestSha256,
            payloadSha256: binding.payloadSha256,
            pricingSnapshotSha256: order.pricingSnapshot.sha256,
            bindingSha256: sha(binding), dispatchEpoch: binding.dispatchEpoch,
            privateBindingSha256: fileSha(privateLockPath) },
          productionRoute: { provider: 'deepseek-official', model: 'deepseek-v4-pro',
            baseUrl: 'https://api.deepseek.com', endpoint: '/chat/completions',
            maxInputTokens: 8000, maxOutputTokens: 2000, thinking: 'disabled',
            images: false, files: false, tools: false, maxAttempts: 1, maxRetries: 0,
            credentialFileMetadataOnly: credentialFile, transportEnabled: false },
          pricing: { snapshotDate: '2026-08-16', currency: 'CNY', inputCacheMissCnyPerMillion: 9.504,
            outputCnyPerMillion: 28.512, reservedUpperBoundCny: 0.30,
            estimatedReservationCny: Number(order.pricingSnapshot.estimatedAmountCny), actualCostCny: null },
          persistedCounts: state.counts,
          observations: { providerHttpRequestCount: 0, providerTransportInvoked: false,
            credentialContentRead: false, externalNetworkObserved: false,
            taskState: state.tasks[0], outboxState: null,
            readyOrSelectedOrApprovedInferred: false },
        }
        const lockPath = join(expectedRoot, 'd1-one-shot-lock-pack.json')
        writeFileSync(lockPath, JSON.stringify(lockPack, null, 2) + '\n', { mode: 0o600 })
        chmodSync(lockPath, 0o600)

        expect(run('stop').dataPreserved).toBe(true)
        started = run('start'); expect(started.ready).toBe(true); run('login')
        await page.context().close()
        page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' }); watch()
        await page.goto(started.entryUrl, { waitUntil: 'load' })
        await openDirectorWorkspace()
        const recovered = await rpc<{ state: string; executionReceipt: object | null; automaticRetry: false }>(
          'readDirectorProviderWorkOrderStatus', { projectId: scope.projectId, episodeId: scope.episodeId,
            generationTaskId: order.generationTaskId },
        )
        expect(recovered.executionReceipt).toBeNull()
        expect(recovered.automaticRetry).toBe(false)
        expect(inspect()).toEqual(state)
        const overlay = readFileSync(join(expectedRoot, 'private/local.patch.yml'), 'utf8')
        expect(overlay).not.toContain(credentialFile)
        expect(overlay).not.toContain('directorProductionTransportEnabled: true')
        expect(requests.every((value) => {
          const host = new URL(value).hostname
          return host === '127.0.0.1' || host === 'localhost'
        })).toBe(true)
        expect(fileSha(lockPath)).toMatch(/^[a-f0-9]{64}$/)
      } finally {
        await browser.close()
        try { run('stop') } catch { /* preserve the exact failed canary root for diagnosis */ }
      }
    }, 240_000)
  },
)
