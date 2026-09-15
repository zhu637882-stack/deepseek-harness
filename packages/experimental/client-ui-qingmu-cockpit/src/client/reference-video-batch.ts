/** Episode preparation and submission reuse the saved single-shot drafts and task queue. */
import type { ReferenceVideoAsset, ReferenceVideoBinding, ReferenceVideoDraftResponse, ReferenceVideoPreviewRequest,
  ReferenceVideoQuoteResponse, ReferenceVideoRun, QueueReferenceVideoRequest, ReferenceVideoMaterialsState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter/types'
import type { QingmuYimengPort } from './contracts.ts'

export interface BatchShot {
  readonly frameId: string
  readonly label: string
  readonly duration: number
  readonly saved: ReferenceVideoDraftResponse
  readonly runs: readonly ReferenceVideoRun[]
}
export interface BatchBasis {
  readonly projectId: string
  readonly shots: readonly BatchShot[]
  readonly assets: readonly ReferenceVideoAsset[]
}
export type BatchPort = Pick<QingmuYimengPort, 'referenceVideoDraft' | 'referenceVideoRuns' | 'referenceVideoAssets'
  | 'saveReferenceVideoDraft' | 'readReferenceVideoMaterials' | 'prepareReferenceVideoMaterial' | 'referenceVideoQuote' | 'queueReferenceVideo'
  | 'readReferenceVideoCandidateRegistration' | 'registerReferenceVideoCandidateForReview'>

/** Read all shot sources and the actual project catalog without generating or changing selections. */
export async function readBatchBasis(port: BatchPort, projectId: string,
  shots: readonly Pick<BatchShot, 'frameId' | 'label' | 'duration'>[]): Promise<BatchBasis> {
  const first = await port.referenceVideoAssets({ projectId, page: 1 })
  const assets = [...first.items]
  for (let page = 2; page <= first.pages; page++) assets.push(...(await port.referenceVideoAssets({ projectId, page })).items)
  const rows = await Promise.all(shots.map(async (shot) => {
    const [saved, runs] = await Promise.all([port.referenceVideoDraft({ projectId, frameId: shot.frameId }),
      port.referenceVideoRuns({ projectId, frameId: shot.frameId })])
    return { ...shot, saved, runs: runs.items }
  }))
  return { projectId, shots: rows, assets }
}

/** Existing videos are preserved unless the owner explicitly includes them in a retake. */
export function hasBatchRun(shot: BatchShot): boolean {
  return shot.runs.some(run => run.publicStatus !== 'failed')
}

/** Pending/quarantined work must be resolved before creating another candidate. */
export function hasActiveBatchRun(shot: BatchShot): boolean {
  return shot.runs.some(run => ['queued', 'running', 'quarantined'].includes(run.publicStatus))
}

export function batchShotIncluded(shot: BatchShot, retakes: ReadonlySet<string>): boolean {
  return !hasBatchRun(shot) || (retakes.has(shot.frameId) && !hasActiveBatchRun(shot))
}

/** A saved draft is reusable only while its director and shot sources still match. */
export function needsBatchDesign(shot: BatchShot, feedback = ''): boolean {
  const { draft, directorSource, frameSha256 } = shot.saved
  // Older batches copied the entire episode correction into every provider prompt.
  // Reprepare those drafts once; preparation notes now live outside filmed content.
  const legacyFeedback = draft?.request.promptParts.some(part =>
    'text' in part && part.text.startsWith('\n【本次修改意见】\n'))
  const feedbackChanged = Boolean(legacyFeedback) || Boolean(feedback.trim()
    && draft?.request.preparationFeedback !== feedback.trim())
  return Boolean(feedbackChanged) || !draft || (draft.frameSha256 !== undefined && draft.frameSha256 !== frameSha256)
    || (directorSource !== null && directorSource !== undefined && draft.request.directorSourceSha256 !== directorSource.sha256)
}

/** Reuse the ordinary candidate handoff for finished runs; registration never selects or approves a video. */
export async function collectBatchShot(port: BatchPort, projectId: string, frameId: string,
  knownRuns?: readonly ReferenceVideoRun[]): Promise<number> {
  const items = knownRuns ?? (await port.referenceVideoRuns({ projectId, frameId })).items
  let count = 0
  for (const run of items.filter(item => item.publicStatus === 'succeeded')) {
    for (const candidate of run.candidates) {
      const request = { projectId, frameId, runId: run.runId, assetId: candidate.assetId,
        expectedAssetSha256: candidate.assetSha256 }
      const current = await port.readReferenceVideoCandidateRegistration(request)
      const result = current.takeId === null ? await port.registerReferenceVideoCandidateForReview(request) : current
      if (result.takeId === null) throw new Error('候选审看登记尚未确认，请刷新原结果。')
      count++
    }
  }
  return count
}

/** Resolve model-authored reference choices through real assets and append the saved director text once. */
export function parseBatchChoices(text: string, basis: BatchBasis,
  retakes: ReadonlySet<string> = new Set(), feedback = ''): ReferenceVideoPreviewRequest[] {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('shots' in value) || !Array.isArray(value.shots)) throw new Error('导演方案需要 shots 列表。')
  const expected = new Map(basis.shots.filter(shot => batchShotIncluded(shot, retakes) && needsBatchDesign(shot, feedback))
    .map(shot => [shot.frameId, shot]))
  const requests = value.shots.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('frameId' in row) || typeof row.frameId !== 'string'
      || !('references' in row) || !Array.isArray(row.references) || !('parameters' in row)) throw new Error('镜头引用方案格式不完整。')
    const shot = expected.get(row.frameId)
    if (!shot) throw new Error('方案含重复、已生成或不属于本次准备的镜头。')
    expected.delete(row.frameId)
    const source = shot.saved.directorSource
    if (!source?.generationPrompt) throw new Error(`${shot.label}尚无完整导演设计。`)
    const bindings = row.references.map((reference: unknown, index: number): ReferenceVideoBinding & { purpose: string } => {
      if (!reference || typeof reference !== 'object' || !('assetId' in reference) || !('purpose' in reference)
        || typeof reference.purpose !== 'string' || !reference.purpose.trim()) throw new Error('每项引用都需要真实素材和具体用途。')
      const asset = basis.assets.find(item => item.assetId === reference.assetId)
      if (!asset) throw new Error('方案引用的素材不在当前项目目录。')
      if (!('assetLabel' in reference) || reference.assetLabel !== asset.label) {
        throw new Error(`${shot.label}的素材名称与编号不一致：${asset.assetId} 对应“${asset.label}”。请让导演按当前目录修正引用。`)
      }
      const frameRole = 'frameRole' in reference ? reference.frameRole : undefined
      if (frameRole !== undefined && frameRole !== 'first_frame' && frameRole !== 'last_frame') throw new Error('首尾帧用途无效。')
      return { bindingToken: `ref_${index + 1}`, assetId: asset.assetId, assetSha256: asset.assetSha256, label: asset.label,
        ...(frameRole ? { frameRole } : {}), purpose: reference.purpose }
    })
    const promptParts = bindings.flatMap(binding => [{ bindingToken: binding.bindingToken }, { text: `（${binding.label}）：${binding.purpose}\n` }])
    // The existing Host save/preview boundary validates the complete untrusted request before writing it.
    const request: ReferenceVideoPreviewRequest = { projectId: basis.projectId, frameId: shot.frameId, model: 'wan3.0-video',
      bindings: bindings.map(({ purpose: _purpose, ...binding }) => binding),
      promptParts: [...promptParts, { text: `\n【本镜完整导演设计】\n${source.generationPrompt}` }],
      ...(feedback.trim() ? { preparationFeedback: feedback.trim() } : {}),
      directorSourceSha256: source.sha256, parameters: row.parameters as ReferenceVideoPreviewRequest['parameters'] }
    if (request.parameters?.duration !== shot.duration) throw new Error(`${shot.label}的生成时长应沿用已保存分镜。`)
    return request
  })
  if (expected.size) throw new Error(`导演方案遗漏 ${expected.size} 个镜头。`)
  return requests
}

/** Writer sorts object keys when persisting drafts; field order is not a new edit. */
function orderedRequest(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
}

/** Prepare actual references and compile the same request used by single-shot generation. */
export async function prepareBatchShot(port: BatchPort, projectId: string, shot: BatchShot,
  request?: ReferenceVideoPreviewRequest, revise = false): Promise<ReferenceVideoQuoteResponse> {
  const current = await port.referenceVideoDraft({ projectId, frameId: shot.frameId })
  if (request && request.directorSourceSha256 !== current.directorSource?.sha256) throw new Error('导演设计已更新，请重新读取当前方案。')
  // A partial preparation can already have saved this exact replacement before an upload failed.
  const alreadySaved = request && current.draft && orderedRequest(current.draft.request)
    === orderedRequest((({ projectId: _projectId, ...rest }) => rest)(request))
  if (revise && !alreadySaved && current.draft?.revision !== shot.saved.draft?.revision) {
    throw new Error('本镜草稿已在其他页面更新，请刷新后再准备修改意见。')
  }
  const draftRequest = request && !alreadySaved && (revise || needsBatchDesign({ ...shot, saved: current }))
    ? (({ projectId: _projectId, ...rest }) => rest)(request) : undefined
  const saved = draftRequest ? await port.saveReferenceVideoDraft({ projectId, frameId: shot.frameId,
    expectedRevision: current.draft?.revision ?? 0, expectedFrameSha256: current.frameSha256, request: draftRequest }) : current
  if (!saved.draft) throw new Error('需要导演先准备本镜引用。')
  if (needsBatchDesign({ ...shot, saved })) throw new Error('导演设计已更新，请自动准备当前设计后再生成。')
  const draft = saved.draft
  const target = { projectId, frameId: shot.frameId, expectedRevision: draft.revision, expectedRequestSha256: draft.requestSha256 }
  let materials: Pick<ReferenceVideoMaterialsState, 'configured' | 'materials' | 'allReady'> = await port.readReferenceVideoMaterials(target)
  if (!materials.configured) throw new Error('引用素材服务尚未连接。')
  for (const material of materials.materials) {
    if (material.status === 'ready') continue
    if (['unknown', 'uploading'].includes(material.status)) throw new Error('原引用上传正在确认，请稍后刷新；不会重复上传。')
    materials = await port.prepareReferenceVideoMaterial({ ...target, assetId: material.assetId, requestId: crypto.randomUUID() })
  }
  if (!materials.allReady) throw new Error('仍有引用尚未准备完成，请查看本镜。')
  return port.referenceVideoQuote({ ...draft.request, projectId, draftRevision: draft.revision, draftRequestSha256: draft.requestSha256 })
}

export interface BatchSubmissionItem {
  readonly quote: ReferenceVideoQuoteResponse
  /** Present only for an explicitly selected retake; old candidates are retained. */
  readonly previousRunIds?: readonly string[]
  readonly command: QueueReferenceVideoRequest
}
export function batchSubmissionKey(projectId: string, episodeId: string): string {
  return `qingmu.reference-batch:${projectId}:${episodeId}`
}

/** Move the original tab's unfinished batch into durable browser storage without replacing another batch. */
export function recoverBatchSubmission(storage: Storage, legacy: Storage, projectId: string, episodeId: string): BatchSubmissionItem[] {
  const key = batchSubmissionKey(projectId, episodeId)
  const current = readBatchSubmission(storage, projectId, episodeId)
  const old = readBatchSubmission(legacy, projectId, episodeId)
  if (!old.length) return current
  if (current.length && JSON.stringify(current) !== JSON.stringify(old)) {
    throw new Error('另一个页面有未完成的批量提交。两份记录均已保留，请先在原页面完成提交。')
  }
  storage.setItem(key, JSON.stringify(old))
  legacy.removeItem(key)
  return old
}

/** Serialize batch mutations across tabs; the backend still owns request idempotency. */
export async function withBatchSubmissionLock(key: string, action: () => Promise<void>): Promise<void> {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全批量接续，请使用青木内置浏览器。')
  await navigator.locks.request(key, { ifAvailable: true }, async (held) => {
    if (!held) throw new Error('另一个页面正在提交本集，请稍后刷新进度。')
    await action()
  })
}
function commandForQuote(quote: ReferenceVideoQuoteResponse, raw: string | null): QueueReferenceVideoRequest {
  if (raw) {
    const pending = JSON.parse(raw) as QueueReferenceVideoRequest
    if (pending.projectId !== quote.projectId || pending.frameId !== quote.frameId || pending.paidConfirmed !== true
      || typeof pending.requestId !== 'string' || pending.quoteSha256 !== quote.quoteSha256
      || pending.expectedRevision !== quote.draftRevision || pending.expectedRequestSha256 !== quote.draftRequestSha256) {
      throw new Error('上次提交仍待确认，请在本镜读取原任务。')
    }
    return pending
  }
  if (!quote.generationSubmissionEnabled) throw new Error('当前生成通道不可用。')
  return { projectId: quote.projectId, frameId: quote.frameId, requestId: crypto.randomUUID(),
    expectedRevision: quote.draftRevision, expectedRequestSha256: quote.draftRequestSha256,
    quoteSha256: quote.quoteSha256, authorizationCapCny: quote.cost.estimatedCny, paidConfirmed: true }
}

/** Freeze every command at the owner's batch click, before the first asynchronous submission. */
export function createBatchSubmission(quotes: readonly ReferenceVideoQuoteResponse[], basis: BatchBasis,
  retakes: ReadonlySet<string>, storage: Storage): BatchSubmissionItem[] {
  return quotes.map((quote) => {
    const shot = basis.shots.find(row => row.frameId === quote.frameId)
    if (quote.projectId !== basis.projectId || !shot || !batchShotIncluded(shot, retakes)) throw new Error('本镜当前不属于本次生成范围。')
    return { quote, command: commandForQuote(quote, storage.getItem(`qingmu.reference-submit:${quote.projectId}:${quote.frameId}`)),
      ...(retakes.has(shot.frameId) ? { previousRunIds: shot.runs.map(run => run.runId) } : {}) }
  })
}

export function readBatchSubmission(storage: Storage, projectId: string, episodeId: string): BatchSubmissionItem[] {
  const value: unknown = JSON.parse(storage.getItem(batchSubmissionKey(projectId, episodeId)) ?? '[]')
  if (!Array.isArray(value)) throw new Error('上次批量提交记录不可读，请查看原镜头任务。')
  for (const item of value as BatchSubmissionItem[]) {
    if (item.quote?.projectId !== projectId) throw new Error('上次批量提交记录不属于当前项目。')
    commandForQuote(item.quote, JSON.stringify(item.command))
  }
  return value as BatchSubmissionItem[]
}

/** Replay an uncertain command before considering old runs; the server owns idempotency. */
export async function submitBatchShot(port: BatchPort, quote: ReferenceVideoQuoteResponse, storage: Storage,
  intent?: BatchSubmissionItem): Promise<ReferenceVideoRun> {
  const { projectId, frameId } = quote
  const key = `qingmu.reference-submit:${projectId}:${frameId}`
  const raw = storage.getItem(key)
  if (!raw) {
    const runs = await port.referenceVideoRuns({ projectId, frameId })
    const existing = runs.items.find(run => intent?.previousRunIds
      ? !intent.previousRunIds.includes(run.runId) || ['queued', 'running', 'quarantined'].includes(run.publicStatus)
      : run.publicStatus !== 'failed')
    if (existing) return existing
  }
  const command = commandForQuote(quote, raw ?? (intent ? JSON.stringify(intent.command) : null))
  if (intent && command.requestId !== intent.command.requestId) throw new Error('本镜另有待确认提交，请先查看原任务。')
  storage.setItem(key, JSON.stringify(command))
  const run = await port.queueReferenceVideo(command)
  storage.removeItem(key)
  return run
}
