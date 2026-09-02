import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function configuredWriterRoot(): string | undefined {
  const root = process.env.QINGMU_LOCAL_YIMENG_ROOT?.trim()
  return root === undefined || root === '' ? undefined : root
}

export function hasProductionTakeWriterFixturePrerequisites(): boolean {
  const root = configuredWriterRoot()
  return root !== undefined
    && existsSync(join(root, '.venv/bin/python'))
    && existsSync(join(root, 'backend/src/jason/apps/studio/api_routes/qingmu_writer_production_bridge.py'))
    && existsSync(join(root, 'tests/test_qingmu_writer_production_bridge.py'))
}

function requireWriterRoot(): string {
  const root = configuredWriterRoot()
  if (root === undefined || !hasProductionTakeWriterFixturePrerequisites()) {
    throw new Error('QINGMU_LOCAL_YIMENG_ROOT must point to a Writer checkout with the E1-C bridge and .venv')
  }
  return root
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const item = value as Record<string, unknown>
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}

function sha(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex')
}

export function productionTakeQuoteFixture() {
  const request = {
    projectId: 'project-1', episodeId: 'episode-1', storyboardRevisionId: 'storyboard-revision-1',
    frameId: 'frame-1', promptIrId: 'prompt-ir-ready-4', promptIrVersion: 4,
    promptIrContentSha256: '31'.repeat(32),
  }
  const imagePrompt = '雨夜车站首帧，林青站在站牌旁。'
  const storyboard = { id: request.storyboardRevisionId, version: 1, sourceHash: '2'.repeat(64) }
  const frameBody = { id: request.frameId, title: '镜头一', narrative: '人物等待', visual: '雨夜车站',
    action: '林青抬头', durationSec: 4, dialogueLineIds: ['line-1'], sceneId: 'scene-1' }
  const frame = { ...frameBody, contentSha256: sha(frameBody) }
  const reference = { referencePackId: 'pack-1', referencePackSha256: '8'.repeat(64),
    entityDraftId: 'draft-1', entityDraftStatus: 'Accepted', humanReview: { status: 'Accepted',
      source: 'independent_human_review', reviewIdentity: 'review-1', reviewedAt: '2026-09-01T00:00:00Z',
      reviewerUserId: 'reviewer-1' }, role: 'scene', elementKind: 'scene', elementId: 'scene-1',
    assetId: 'asset-1', assetSha256: '9'.repeat(64), materializedSha256: 'a'.repeat(64),
    selectionIdentity: 'selection-1', sourceRevisionId: 'source-1', qualificationCheckId: 'qualification-1',
    qualificationKind: 'local_file_integrity', rightsRecordSha256: 'b'.repeat(64), profileRevision: 1,
    profileSnapshotSha256: 'c'.repeat(64) }
  const { referencePackId: _packId, referencePackSha256: _packSha, entityDraftId: _draftId,
    entityDraftStatus: _draftStatus, humanReview: _review, ...contextReference } = reference
  const contextSchema = 'jason.qingmu-prompt-ir-bootstrap-context.v1'
  const contextSnapshotSha256 = sha({ schema: contextSchema, projectId: request.projectId,
    episodeId: request.episodeId, storyboard, frame, requiredReferences: [contextReference] })
  const authoritySnapshot = { projectId: request.projectId, episodeId: request.episodeId, storyboard, frame,
    contextSchema, contextSnapshotSha256, promptIr: { id: request.promptIrId, version: request.promptIrVersion,
      contentSha256: request.promptIrContentSha256, status: 'Ready', imagePrompt,
      imagePromptSha256: sha(imagePrompt) }, method: { rootPromptIrId: 'prompt-root-1',
      methodProjectionSha256: '4'.repeat(64), methodSha256: '5'.repeat(64),
      methodSourceBindings: [{ kind: 'method', path: 'imago/method.json', sha256: '6'.repeat(64) }],
      bootstrapContextSnapshotSha256: '7'.repeat(64) }, references: [reference], referenceExecutionBlockers: [],
    firstFramePreparation: { frameId: request.frameId, frameNo: 1, currentAssetId: null,
      generationRequired: true, auditRequired: true, auditReason: 'generated_candidate_requires_formal_audit',
      humanSelectionRequired: true } }
  const authoritySnapshotSha256 = sha(authoritySnapshot)
  const costSourceLock = { scriptRevision: 1, scriptSha256: 'd'.repeat(64),
    storyContractSha256: 'e'.repeat(64), storyboardRevision: 1, storyboardCreativeSha256: 'f'.repeat(64) }
  const costSourceLockSha256 = sha(costSourceLock)
  const quote = { frameId: request.frameId, frameNo: 1, calls: 1, estimatedCny: 0.2,
    capability: 'image.generate', routeKey: 'b4.first_frame_generation', provider: 'dashscope',
    model: 'wan2.2-t2i-flash', pricingVerified: true }
  const referenceSnapshotBindings = [{ assetId: reference.assetId,
    materializedSha256: reference.materializedSha256,
    transportPlaceholder: `qingmu-reference://${reference.assetId}/${reference.materializedSha256}` }]
  const providerSnapshotContract = { method: 'POST',
    url: 'https://fixture.invalid/api/v1/services/aigc/multimodal-generation/generation',
    body: { model: quote.model, input: { messages: [{ role: 'user', content: [
      { image: referenceSnapshotBindings[0]!.transportPlaceholder }, { text: imagePrompt },
    ] }] }, parameters: { size: '720*1280', n: 1, watermark: false } },
    notes: ['sync_response', 'wan2.7_image_generation', 'result_url_ttl_24h', 'ali_official_rules_validated'],
    aliRuleValidation: { provider: quote.provider, model: quote.model, capability: quote.capability,
      officialOnly: true, sourceUrls: ['https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference'],
      checks: [{ rule: 'fixture', passed: true, evidence: 'fixture' }], violations: [] } }
  const bindingBody = { schema: 'jason.qingmu-ready-prompt-ir-first-frame-execution-binding.v1', actor: 'user-1',
    projectId: request.projectId, episodeId: request.episodeId, storyboardRevisionId: request.storyboardRevisionId,
    frameId: request.frameId, authoritySnapshot, authoritySnapshotSha256, costSourceLock, costSourceLockSha256,
    provider: quote.provider, model: quote.model, capability: quote.capability, routeKey: quote.routeKey,
    pricingSnapshot: quote, pricingSnapshotSha256: sha(quote), referenceSnapshotBindings, providerSnapshotContract,
    providerSnapshotContractSha256: sha(providerSnapshotContract), output: { size: '720*1280', n: 1 },
    prompt: imagePrompt, promptSha256: sha(imagePrompt), advisoryOnly: false, selectAsOfficial: false, maxAttempts: 1 }
  const executionBinding = { ...bindingBody, bindingSha256: sha(bindingBody) }
  const authorizationBody = { schema: 'jason.qingmu-ready-prompt-ir-first-frame-authorization-draft.v1',
    target: { projectId: request.projectId, episodeId: request.episodeId,
      storyboardRevisionId: request.storyboardRevisionId, frameId: request.frameId, frameTitle: frame.title },
    sourceBindings: { authoritySnapshotSha256, contextSnapshotSha256, promptIrId: request.promptIrId,
      promptIrVersion: request.promptIrVersion, promptIrContentSha256: request.promptIrContentSha256,
      promptSha256: sha(imagePrompt), methodSha256: authoritySnapshot.method.methodSha256, costSourceLockSha256,
      referenceMaterializedSha256s: [reference.materializedSha256], executionBindingSha256: executionBinding.bindingSha256 },
    route: { provider: quote.provider, model: quote.model, capability: quote.capability, routeKey: quote.routeKey, calls: 1 },
    cost: { currency: 'CNY', estimatedCny: 0.2, maximumReservationCny: 0.3,
      instanceBudgetWindow: { valid: true, windowId: 'fixture-window', effectiveCapCny: 1,
        lifetimeSpentCny: 0, windowRemainingCny: 1, errors: [] }, crossInstanceCumulativeKnown: false,
      crossInstanceCumulativeCny: null }, providerMedia: { referenceCount: 1, status: 'public_https_static_pass',
      staticConditionPassed: true, downloadVerified: false, blockerCode: null }, blockers: [{
      code: 'budget_cross_instance_cumulative_unknown', category: 'budget_unknown_fee',
      userAction: '请先核对易梦费用账本与本次预算窗口，再单独授权。',
      technicalDetail: 'budget_cross_instance_cumulative_unknown' }], authorizationRecorded: false,
    taskCreated: false, submitted: false, charged: false, providerCalls: 0 }
  const authorizationDraft = { ...authorizationBody, draftSha256: sha(authorizationBody) }
  const unsigned = { schema: 'jason.qingmu-ready-prompt-ir-first-frame-quote.v1',
    projectId: request.projectId, episodeId: request.episodeId,
    storyboardRevisionId: request.storyboardRevisionId, frameId: request.frameId,
    authoritySnapshot, authoritySnapshotSha256, costSourceLock, costSourceLockSha256,
    promptBinding: { readyPromptIrImagePromptSha256: sha(imagePrompt), legacyExecutorPrompt: '现行执行器编译提示词',
      legacyExecutorPromptSha256: sha('现行执行器编译提示词'), legacyExecutorMatchesReadyPromptIr: false,
      executorUsesReadyPromptIr: true, dispatchCompatible: true, executionBlockers: [], executionBinding },
    authorizationDraft, scope: { frameCount: 1, imagesPerFrame: 1, resolution: '720P' }, quote, quoteReady: true,
    blockers: [], readOnly: true, providerCalls: 0, budgetMutation: false, taskMutation: false, mediaMutation: false,
    submitted: false, charged: false, authorizationRecorded: false, taskCreated: false }
  return { ...unsigned, projectionSha256: sha(unsigned) }
}

export interface WriterFixture {
  readonly process: ChildProcess
  readonly baseUrl: string
  readonly sqlitePath: string
  readonly stderr: () => string
  readonly root: string
  readonly quotePath: string
  readonly port: number
  readonly writerRoot: string
}

async function launchProductionTakeWriterFixture(
  root: string,
  quotePath: string,
  writerRoot: string,
  options: { readonly port?: number; readonly reuse?: boolean } = {},
): Promise<WriterFixture> {
  const arguments_ = [
    join(process.cwd(), 'apps/web/tests/qingmu-production-take-writer-fixture.py'),
    '--root', root, '--quote', quotePath, '--writer-root', writerRoot,
  ]
  if (options.port !== undefined) arguments_.push('--port', String(options.port))
  if (options.reuse === true) arguments_.push('--reuse')
  const child = spawn(join(writerRoot, '.venv/bin/python'), arguments_, {
    cwd: writerRoot, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  const ready = await new Promise<{ baseUrl: string; sqlitePath: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Writer fixture start timed out: ${stderr}`)), 20_000)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Writer fixture exited ${String(code)}: ${stderr}`)) })
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      const match = /QINGMU_WRITER_FIXTURE=(\{[^\n]+\})/u.exec(stdout)
      if (match?.[1] !== undefined) { clearTimeout(timer); resolve(JSON.parse(match[1]) as { baseUrl: string; sqlitePath: string }) }
    })
  })
  await readFile(ready.sqlitePath)
  const port = Number(new URL(ready.baseUrl).port)
  return { process: child, stderr: () => stderr, root, quotePath, port, writerRoot, ...ready }
}

export async function startProductionTakeWriterFixture(root: string): Promise<WriterFixture> {
  const writerRoot = requireWriterRoot()
  const quotePath = join(root, 'first-frame-quote.json')
  await writeFile(quotePath, `${JSON.stringify(productionTakeQuoteFixture())}\n`)
  return await launchProductionTakeWriterFixture(root, quotePath, writerRoot)
}

export async function stopProductionTakeWriterFixture(fixture: WriterFixture | undefined): Promise<void> {
  if (fixture === undefined || fixture.process.exitCode !== null) return
  const exited = new Promise<void>((resolve) => { fixture.process.once('exit', () => resolve()) })
  fixture.process.kill('SIGTERM')
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, 5_000) }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  if (fixture.process.exitCode === null) {
    fixture.process.kill('SIGKILL')
    await exited
  }
}

export async function restartProductionTakeWriterFixture(fixture: WriterFixture): Promise<WriterFixture> {
  await stopProductionTakeWriterFixture(fixture)
  return await launchProductionTakeWriterFixture(fixture.root, fixture.quotePath, fixture.writerRoot, {
    port: fixture.port,
    reuse: true,
  })
}
