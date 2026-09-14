/** Episode preparation and submission reuse the saved single-shot drafts and task queue. */
import type { ReferenceVideoAsset, ReferenceVideoDraftResponse, ReferenceVideoPreviewRequest,
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
  | 'saveReferenceVideoDraft' | 'readReferenceVideoMaterials' | 'prepareReferenceVideoMaterial' | 'referenceVideoQuote' | 'queueReferenceVideo'>

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

/** Existing videos and in-flight tasks are preserved; retries remain a shot-level decision. */
export function hasBatchRun(shot: BatchShot): boolean {
  return shot.runs.some(run => run.publicStatus !== 'failed')
}

/** Resolve model-authored reference choices through real assets and append the saved director text once. */
export function parseBatchChoices(text: string, basis: BatchBasis): ReferenceVideoPreviewRequest[] {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('shots' in value) || !Array.isArray(value.shots)) throw new Error('导演方案需要 shots 列表。')
  const expected = new Map(basis.shots.filter(shot => !hasBatchRun(shot) && !shot.saved.draft).map(shot => [shot.frameId, shot]))
  const requests = value.shots.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('frameId' in row) || typeof row.frameId !== 'string'
      || !('references' in row) || !Array.isArray(row.references) || !('parameters' in row)) throw new Error('镜头引用方案格式不完整。')
    const shot = expected.get(row.frameId)
    if (!shot) throw new Error('方案含重复、已生成或不属于本次准备的镜头。')
    expected.delete(row.frameId)
    const source = shot.saved.directorSource
    if (!source?.generationPrompt) throw new Error(`${shot.label}尚无完整导演设计。`)
    const bindings = row.references.map((reference: unknown, index: number) => {
      if (!reference || typeof reference !== 'object' || !('assetId' in reference) || !('purpose' in reference)
        || typeof reference.purpose !== 'string' || !reference.purpose.trim()) throw new Error('每项引用都需要真实素材和具体用途。')
      const asset = basis.assets.find(item => item.assetId === reference.assetId)
      if (!asset) throw new Error('方案引用的素材不在当前项目目录。')
      const frameRole = 'frameRole' in reference ? reference.frameRole : undefined
      if (frameRole !== undefined && frameRole !== 'first_frame' && frameRole !== 'last_frame') throw new Error('首尾帧用途无效。')
      return { bindingToken: `ref_${index + 1}`, assetId: asset.assetId, assetSha256: asset.assetSha256, label: asset.label,
        ...(frameRole ? { frameRole } : {}), purpose: reference.purpose }
    })
    const promptParts = bindings.flatMap(binding => [{ bindingToken: binding.bindingToken }, { text: `：${binding.purpose}\n` }])
    // The existing Host save/preview boundary validates the complete untrusted request before writing it.
    const request: ReferenceVideoPreviewRequest = { projectId: basis.projectId, frameId: shot.frameId, model: 'wan3.0-video',
      bindings: bindings.map(({ purpose: _purpose, ...binding }) => binding),
      promptParts: [...promptParts, { text: `\n【本镜完整导演设计】\n${source.generationPrompt}` }],
      directorSourceSha256: source.sha256, parameters: row.parameters as ReferenceVideoPreviewRequest['parameters'] }
    if (request.parameters?.duration !== shot.duration) throw new Error(`${shot.label}的生成时长应沿用已保存分镜。`)
    return request
  })
  if (expected.size) throw new Error(`导演方案遗漏 ${expected.size} 个镜头。`)
  return requests
}

/** Prepare actual references and compile the same request used by single-shot generation. */
export async function prepareBatchShot(port: BatchPort, projectId: string, shot: BatchShot,
  request?: ReferenceVideoPreviewRequest): Promise<ReferenceVideoQuoteResponse> {
  const draftRequest = request && (({ projectId: _projectId, ...rest }) => rest)(request)
  const saved = draftRequest ? await port.saveReferenceVideoDraft({ projectId, frameId: shot.frameId,
    expectedRevision: shot.saved.draft?.revision ?? 0, expectedFrameSha256: shot.saved.frameSha256, request: draftRequest })
    : await port.referenceVideoDraft({ projectId, frameId: shot.frameId })
  if (!saved.draft) throw new Error('需要导演先准备本镜引用。')
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

/** Submit quickly to the existing asynchronous queue; uncertain retries use the same persisted command. */
export async function submitBatchShot(port: BatchPort, quote: ReferenceVideoQuoteResponse, storage: Storage): Promise<ReferenceVideoRun> {
  const { projectId, frameId } = quote
  const key = `qingmu.reference-submit:${projectId}:${frameId}`
  const runs = await port.referenceVideoRuns({ projectId, frameId })
  const raw = storage.getItem(key)
  const existing = runs.items.find(run => run.publicStatus !== 'failed')
  if (existing) return existing
  let command: QueueReferenceVideoRequest
  if (raw) {
    const pending = JSON.parse(raw) as Record<string, unknown>
    if (pending.projectId !== projectId || pending.frameId !== frameId || pending.paidConfirmed !== true
      || typeof pending.requestId !== 'string' || pending.quoteSha256 !== quote.quoteSha256) {
      throw new Error('上次提交仍待确认，请在本镜读取原任务。')
    }
    command = pending as unknown as QueueReferenceVideoRequest
  } else {
    if (!quote.generationSubmissionEnabled) throw new Error('当前生成通道不可用。')
    command = { projectId, frameId, requestId: crypto.randomUUID(), expectedRevision: quote.draftRevision,
      expectedRequestSha256: quote.draftRequestSha256, quoteSha256: quote.quoteSha256,
      authorizationCapCny: quote.cost.estimatedCny, paidConfirmed: true }
    storage.setItem(key, JSON.stringify(command))
  }
  const run = await port.queueReferenceVideo(command)
  storage.removeItem(key)
  return run
}
