// @vitest-environment jsdom
import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import type { ScenePlanningRequest, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { reconcileBatchChoices } from '../src/client/reference-video-batch-repair.ts'
import { recoverBatchSubmission, withBatchSubmissionLock, collectBatchShot, readBatchBasis, parseBatchChoices, prepareBatchShot, submitBatchShot, hasBatchRun, needsBatchDesign, batchShotIncluded, createBatchSubmission, readBatchSubmission, batchSubmissionKey, type BatchBasis, type BatchPort } from '../src/client/reference-video-batch.ts'
import { assembleReferencePrompt } from '../../qingmu-yimeng-read-adapter/src/reference-prompt.ts'
import { request, quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'

const source = { sha256: 'e'.repeat(64), prompt: '研究：下一镜才开门', generationPrompt: '研究设计 JSON：角色保持原服装。0秒敲锣，铜锣余响。对白：请进。', executionSuffix: '本镜逐字对白：请进。' }
function basis(): BatchBasis {
  return { projectId: 'p', assets: [{ assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予', browserUrl: '', mediaType: 'reference_image' }],
    shots: ['f', 'f2'].map((frameId, i) => ({ frameId, label: `镜${i + 1}`, duration: 8, runs: [], saved: {
      schema: 'jason.reference-video-draft.v1', projectId: 'p', frameId, frameSha256: 'f'.repeat(64),
      draft: null, directorSource: source, mediaTypes: {}, providerCalls: 0, generationQueued: false,
    } })) }
}
const choice = (frameId: string) => ({ frameId, executionPrompt: '院内只有林予，原服装。0–2秒右手击锣一次，先击后收，铜锣余响；2–8秒说第一句，结束仍面向门口。', references: [{ assetId: 'asset_lin', assetLabel: '林予', purpose: '本镜角色身份与衣服' }], parameters: request.parameters })
beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

function repairHarness() {
  vi.stubGlobal('crypto', webcrypto)
  const initial = basis()
  const planning: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'p', episodeId: 'e',
    scriptRevision: 1, scriptSha256: 's'.repeat(64), scenes: [], planning: null,
    storyboard: { id: 'v1', version: 1, sourceHash: '1'.repeat(64), status: 'Ready' },
    canonicalStoryboard: { revision: 1, sourceHash: '1'.repeat(64), shotCount: 2, origin: 'automatic' },
    frameRequirements: initial.shots.map(shot => ({ id: shot.frameId, frameNo: 1, title: '', imagePromptCn: 'old',
      generationContextSource: { state: 'current', sha256: 'c'.repeat(64), changes: [] } })) }
  const original = { ...initial, planning }
  let current: BatchBasis = original
  const receipts = new Map<string, unknown>()
  const save = vi.fn(async (command: ScenePlanningRequest) => {
    const op = command.request
    if (op.action !== 'edit_automatic') throw new Error('Unexpected action')
    if (op.expectedStoryboardRevision !== current.planning!.storyboard!.version) throw new Error('revision conflict')
    const version = op.expectedStoryboardRevision + 1
    const storyboard = { id: `v${version}`, version, sourceHash: `${version}`.repeat(64), status: 'Ready' as const }
    current = { ...current, planning: { ...current.planning!, storyboard }, shots: current.shots.map(shot => ({ ...shot,
      saved: { ...shot.saved, ...(shot.frameId === op.shotId ? { frameSha256: `${version}`.repeat(64) } : {}),
        directorSource: { ...source, sha256: `${version}`.repeat(64),
          generationPrompt: shot.frameId === op.shotId ? 'Corrected saved camera and staging.' : shot.saved.directorSource!.generationPrompt!,
        } } })) }
    const receipt = { projectId: 'p', episodeId: 'e', action: op.action, shotId: op.shotId, idempotencyKey: command.idempotencyKey, storyboard }
    receipts.set(command.idempotencyKey, receipt)
    return receipt
  })
  const port = { saveScenePlanning: save,
    recoverScenePlanning: vi.fn(async (command: ScenePlanningRequest) => {
      const saved = receipts.get(command.idempotencyKey)
      if (!saved) throw new Error('HTTP 404: planning_receipt_not_found')
      return saved
    }),
    readScenePlanning: vi.fn(async () => current.planning),
    referenceVideoAssets: async () => ({ pages: 1, items: current.assets }),
    referenceVideoDraft: vi.fn(async ({ frameId }: { frameId: string }) => current.shots.find(shot => shot.frameId === frameId)!.saved),
    referenceVideoRuns: async () => ({ items: [] }),
    prepareReferenceVideoMaterial: vi.fn(), queueReferenceVideo: vi.fn(),
  }
  const repairs = ['f', 'f2'].map(frameId => ({ frameId, directorPlan: { blocking: 'Left through the camera, facing the listener.', generationContext: 'Same courtyard.' }, imagePromptCn: 'Coherent complete opening composition.' }))
  const text = JSON.stringify({ shots: ['f', 'f2'].map(choice), directorRepairs: repairs })
  return { original, port, repairs, text, save, current: () => current }
}

it('saves batch corrections with sequential ordinary planning revisions and compiles fresh sources with dialogue once', async () => {
  const h = repairHarness()
  const result = await reconcileBatchChoices(h.port as unknown as BatchPort, 'e', h.original, h.text, new Set(), '')
  expect(h.save.mock.calls.map(([command]) => command.request.expectedStoryboardRevision)).toEqual([1, 2])
  expect(h.save.mock.calls[0]![0].request).toMatchObject({ expectedGenerationContextSourceSha256: 'c'.repeat(64) })
  expect(result.basis.planning!.storyboard!.version).toBe(3)
  expect(result.requests.map(item => item.directorSourceSha256)).toEqual(['3'.repeat(64), '3'.repeat(64)])
  expect(result.requests[0]!.promptParts.flatMap(part => 'text' in part ? [part.text] : []).join('').split(source.executionSuffix)).toHaveLength(2)
  expect(h.port.prepareReferenceVideoMaterial).not.toHaveBeenCalled()
  expect(h.port.queueReferenceVideo).not.toHaveBeenCalled()
})

it('recovers a committed batch correction after response loss without saving it twice', async () => {
  const h = repairHarness(), save = h.save.getMockImplementation()!
  h.save.mockImplementationOnce(async (command) => { await save(command); throw new Error('connection lost after commit') })
  await expect(reconcileBatchChoices(h.port as unknown as BatchPort, 'e', h.original, h.text, new Set(), '')).rejects.toThrow('connection lost')
  const result = await reconcileBatchChoices(h.port as unknown as BatchPort, 'e', h.original, h.text, new Set(), '')
  expect(h.save).toHaveBeenCalledTimes(2)
  expect(h.port.recoverScenePlanning.mock.calls[0]![0]).toEqual(h.port.recoverScenePlanning.mock.calls[1]![0])
  expect(result.requests).toHaveLength(2)
})

it.each(['foreign shot', 'duplicate repair', 'missing execution', 'uncertain receipt', 'changed frame'])('rejects %s before saving batch corrections or preparing media', async (mode) => {
  const h = repairHarness()
  let text = h.text
  if (mode === 'foreign shot') text = JSON.stringify({ shots: ['f', 'f2'].map(choice), directorRepairs: [{ ...h.repairs[0], frameId: 'outside' }] })
  if (mode === 'duplicate repair') text = JSON.stringify({ shots: ['f', 'f2'].map(choice), directorRepairs: [h.repairs[0], h.repairs[0]] })
  if (mode === 'missing execution') text = JSON.stringify({ shots: [choice('f')], directorRepairs: h.repairs })
  if (mode === 'uncertain receipt') h.port.recoverScenePlanning.mockRejectedValue(new Error('HTTP 503: unavailable'))
  if (mode === 'changed frame') h.port.referenceVideoDraft.mockResolvedValue({ ...h.original.shots[0]!.saved, frameSha256: 'changed' })
  await expect(reconcileBatchChoices(h.port as unknown as BatchPort, 'e', h.original, text, new Set(), '')).rejects.toThrow()
  expect(h.save).not.toHaveBeenCalled()
  expect(h.port.prepareReferenceVideoMaterial).not.toHaveBeenCalled()
  expect(h.port.queueReferenceVideo).not.toHaveBeenCalled()
})

it('collects completed outputs into review once, skipping running videos and retaining registered candidates', async () => {
  const register = vi.fn(async () => ({ takeId: 'take_new' }))
  const port = {
    referenceVideoRuns: async () => ({ items: [
      { runId: 'r1', publicStatus: 'succeeded', candidates: [{ assetId: 'old', assetSha256: 'a'.repeat(64) }] },
      { runId: 'r2', publicStatus: 'succeeded', candidates: [{ assetId: 'new', assetSha256: 'b'.repeat(64) }] },
      { runId: 'r3', publicStatus: 'running', candidates: [] },
    ] }),
    readReferenceVideoCandidateRegistration: async ({ assetId }: { assetId: string }) => ({ takeId: assetId === 'old' ? 'take_old' : null }),
    registerReferenceVideoCandidateForReview: register,
  } as unknown as BatchPort
  expect(await collectBatchShot(port, 'p', 'f')).toBe(2)
  expect(register).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', frameId: 'f', runId: 'r2', assetId: 'new', expectedAssetSha256: 'b'.repeat(64) })
})

it('assembles every shot from real references while keeping dialogue and synchronized sound exactly once', () => {
  const requests = parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), basis())
  expect(requests).toHaveLength(2)
  for (const item of requests) {
    expect(item.bindings[0]?.assetSha256).toBe('a'.repeat(64))
    const text = item.promptParts.flatMap(part => 'text' in part ? [part.text] : []).join('')
    expect(text.split(source.executionSuffix)).toHaveLength(2)
    expect(text).toContain(choice('f').executionPrompt)
    expect(text).not.toContain('研究设计 JSON')
    expect(item.promptParts).toEqual(assembleReferencePrompt(item.bindings, [{ bindingToken: 'ref_1', purpose: '本镜角色身份与衣服' }], source, choice('f').executionPrompt))
    expect(text).toContain('：本镜角色身份与衣服')
    expect(text).not.toContain('下一镜才开门')
    expect(item.parameters.audio).toBe(true)
  }
  expect(requests).toMatchSnapshot()
  expect(() => parseBatchChoices(JSON.stringify({ shots: [choice('f')] }), basis())).toThrow('遗漏')
  expect(() => parseBatchChoices(JSON.stringify({ shots: [choice('f'), choice('f')] }), basis())).toThrow('重复')
})

it('rejects a valid asset id paired with a different prop name before preparing any shot', () => {
  const b = basis()
  const catalog = { ...b, assets: [
    ...b.assets,
    { assetId: 'asset_book', assetSha256: 'b'.repeat(64), label: '旧册子', browserUrl: '', mediaType: 'reference_image' as const },
    { assetId: 'asset_product', assetSha256: 'c'.repeat(64), label: '广告产品', browserUrl: '', mediaType: 'reference_image' as const },
  ] }
  const wrong = { ...choice('f'), references: [{ assetId: 'asset_book', assetLabel: '广告产品', purpose: '沿用产品包装' }] }
  expect(() => parseBatchChoices(JSON.stringify({ shots: [wrong, choice('f2')] }), catalog)).toThrow('asset_book 对应“旧册子”')
  const corrected = { ...wrong, references: [{ ...wrong.references[0]!, assetId: 'asset_product' }] }
  expect(parseBatchChoices(JSON.stringify({ shots: [corrected, choice('f2')] }), catalog)[0]?.bindings[0]?.assetId).toBe('asset_product')
})

it('prepares references and queues multiple shots without waiting for video completion, preserving existing candidates', async () => {
  const b = basis(), requests = parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), b)
  const ready = { configured: true, allReady: true, materials: [] }
  const queues: string[] = []
  const port = {
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => b.shots.find(shot => shot.frameId === frameId)!.saved,
    saveReferenceVideoDraft: vi.fn(async ({ frameId, request: saved }: { frameId: string; request: unknown }) => ({
      ...b.shots.find(shot => shot.frameId === frameId)!.saved,
      draft: { revision: 1, frameSha256: 'f'.repeat(64), requestSha256: 'd'.repeat(64), request: saved },
    })),
    readReferenceVideoMaterials: vi.fn(async () => ({ ...ready, allReady: false,
      materials: [{ assetId: 'asset_lin', status: 'not_prepared' }] })),
    prepareReferenceVideoMaterial: vi.fn(async () => ready),
    referenceVideoQuote: vi.fn(async ({ frameId }: { frameId: string }) => (
      { ...quoteResponse, frameId, generationSubmissionEnabled: true })),
    referenceVideoRuns: vi.fn(async () => ({ items: [] })),
    queueReferenceVideo: vi.fn(async ({ frameId }: { frameId: string }) => { queues.push(frameId); return { frameId, publicStatus: 'queued' } }),
  }
  for (const [index, shot] of b.shots.entries()) {
    const quote = await prepareBatchShot(port as unknown as BatchPort, 'p', shot, requests[index])
    await submitBatchShot(port as unknown as BatchPort, quote, sessionStorage)
  }
  expect(queues).toEqual(['f', 'f2'])
  expect(port.saveReferenceVideoDraft).toHaveBeenCalledTimes(2)
  expect(port.prepareReferenceVideoMaterial).toHaveBeenCalledTimes(2)
  const existing = { frameId: 'f', publicStatus: 'succeeded' }
  port.referenceVideoRuns.mockResolvedValue({ items: [existing] } as never)
  await submitBatchShot(port as unknown as BatchPort, { ...quoteResponse, generationSubmissionEnabled: true }, sessionStorage)
  expect(queues).toHaveLength(2)
  expect(hasBatchRun({ ...b.shots[0]!, runs: [existing] as never })).toBe(true)
})

it('recovers a lost submission with the identical command and never auto retries unknown uploads', async () => {
  const queue = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ publicStatus: 'queued' })
  const port = { referenceVideoRuns: async () => ({ items: [] }), queueReferenceVideo: queue } as unknown as BatchPort
  const quote = { ...quoteResponse, generationSubmissionEnabled: true }
  await expect(submitBatchShot(port, quote, sessionStorage)).rejects.toThrow('lost')
  expect(sessionStorage.length).toBe(1)
  await submitBatchShot(port, quote, sessionStorage)
  expect(queue.mock.calls[0]![0]).toEqual(queue.mock.calls[1]![0])
  expect(sessionStorage.length).toBe(0)
  const b = basis(), shot = b.shots[0]!
  const upload = vi.fn()
  await expect(prepareBatchShot({ referenceVideoDraft: async () => ({ ...shot.saved,
    draft: { revision: 1, requestSha256: 'd'.repeat(64), request: { ...request, directorSourceSha256: source.sha256 } } }),
  readReferenceVideoMaterials: async () => ({ configured: true, allReady: false, materials: [{ status: 'unknown' }] }),
  prepareReferenceVideoMaterial: upload } as unknown as BatchPort, 'p', shot)).rejects.toThrow('正在确认')
  expect(upload).not.toHaveBeenCalled()
})

it('reads every catalog page and all frames, including different scenes', async () => {
  const b = basis()
  const assets = vi.fn(async ({ page }: { page: number }) => ({ pages: 2, items: page === 1 ? b.assets : [] }))
  const port = { referenceVideoAssets: assets,
    referenceVideoDraft: async ({ frameId }: { frameId: string }) => b.shots.find(shot => shot.frameId === frameId)!.saved,
    referenceVideoRuns: async () => ({ items: [] }) } as unknown as BatchPort
  const read = await readBatchBasis(port, 'p', b.shots)
  expect(read.shots.map(shot => shot.frameId)).toEqual(['f', 'f2'])
  expect(assets.mock.calls.map(call => call[0].page)).toEqual([1, 2])
})

it('reconciles stale drafts while leaving completed shots outside the explicit retake scope', () => {
  const b = basis()
  const stale = { ...b.shots[0]!, saved: { ...b.shots[0]!.saved,
    draft: { revision: 2, frameSha256: 'f'.repeat(64), requestSha256: 'd'.repeat(64), savedAt: '',
      request: { ...request, directorSourceSha256: 'old' } } } }
  expect(needsBatchDesign(stale)).toBe(true)
  const done = { ...b.shots[1]!, runs: [{ runId: 'old', publicStatus: 'succeeded' }] as never }
  const current = { ...b, shots: [stale, done] }
  expect(parseBatchChoices(JSON.stringify({ shots: [choice('f')] }), current)).toHaveLength(1)
  expect(batchShotIncluded(done, new Set())).toBe(false)
  expect(parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), current, new Set(['f2']))).toHaveLength(2)
  expect(batchShotIncluded({ ...done, runs: [{ publicStatus: 'running' }] as never }, new Set(['f2']))).toBe(false)
})

it('freezes every authorized command and resumes only explicit retakes, even after a lost response', async () => {
  const b = basis()
  const previous = { runId: 'old', publicStatus: 'succeeded' }
  const current = { ...b, shots: b.shots.map(shot => ({ ...shot, runs: [previous] as never })) }
  const quotes = ['f', 'f2'].map(frameId => ({ ...quoteResponse, projectId: 'p', frameId, generationSubmissionEnabled: true }))
  const items = createBatchSubmission(quotes, current, new Set(['f', 'f2']), sessionStorage)
  sessionStorage.setItem(batchSubmissionKey('p', 'e'), JSON.stringify(items))
  const queue = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ runId: 'new', publicStatus: 'queued' })
  const port = { referenceVideoRuns: async () => ({ items: [previous] }), queueReferenceVideo: queue } as unknown as BatchPort
  await expect(submitBatchShot(port, quotes[0]!, sessionStorage, items[0])).rejects.toThrow('lost')
  const restored = readBatchSubmission(sessionStorage, 'p', 'e')
  for (const item of restored) await submitBatchShot(port, item.quote, sessionStorage, item)
  expect(queue.mock.calls[0]![0]).toEqual(queue.mock.calls[1]![0])
  expect(queue.mock.calls[2]![0]).toEqual(items[1]!.command)
  expect(queue).toHaveBeenCalledTimes(3)
  expect(current.shots[0]!.runs).toEqual([previous])
  const another = { referenceVideoRuns: async () => ({ items: [{ runId: 'new', publicStatus: 'failed' }, previous] }), queueReferenceVideo: queue } as unknown as BatchPort
  await submitBatchShot(another, quotes[0]!, sessionStorage, items[0])
  expect(queue).toHaveBeenCalledTimes(3)
})

it('uses a freshly saved design on retry and refuses a changed source before any material upload', async () => {
  const b = basis(), shot = b.shots[0]!
  const choices = parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), b)
  const save = vi.fn(), materials = vi.fn(async () => ({ configured: true, allReady: true, materials: [] }))
  const saved = { ...shot.saved, draft: { revision: 3, frameSha256: shot.saved.frameSha256, requestSha256: 'd'.repeat(64), request: choices[0] } }
  const port = { referenceVideoDraft: async () => saved, saveReferenceVideoDraft: save, readReferenceVideoMaterials: materials,
    referenceVideoQuote: async () => quoteResponse } as unknown as BatchPort
  await prepareBatchShot(port, 'p', shot, choices[0])
  expect(save).not.toHaveBeenCalled()
  expect(materials).toHaveBeenCalledOnce()
  await expect(prepareBatchShot({ ...port, referenceVideoDraft: async () => ({ ...saved, directorSource: { ...source, sha256: 'new' } }) } as unknown as BatchPort,
    'p', shot, choices[0])).rejects.toThrow('导演设计已更新')
  expect(materials).toHaveBeenCalledOnce()
})


it('migrates the original batch without changing its request IDs and preserves conflicting plans', () => {
  const b = basis()
  const items = createBatchSubmission([{ ...quoteResponse, projectId: 'p', frameId: 'f', generationSubmissionEnabled: true }], b, new Set(), sessionStorage)
  const key = batchSubmissionKey('p', 'e')
  sessionStorage.setItem(key, JSON.stringify(items))
  expect(recoverBatchSubmission(localStorage, sessionStorage, 'p', 'e')).toEqual(items)
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(readBatchSubmission(localStorage, 'p', 'e')).toEqual(items)
  const other = items.map(item => ({ ...item, command: { ...item.command, requestId: 'another-intent' } }))
  sessionStorage.setItem(key, JSON.stringify(other))
  expect(() => recoverBatchSubmission(localStorage, sessionStorage, 'p', 'e')).toThrow('两份记录均已保留')
  expect(readBatchSubmission(localStorage, 'p', 'e')).toEqual(items)
  expect(readBatchSubmission(sessionStorage, 'p', 'e')).toEqual(other)
})

it('does not mutate or submit a batch while another tab owns its browser lock', async () => {
  const action = vi.fn()
  const requestLock = vi.fn(async (_key: string, _options: unknown, callback: (lock: null) => Promise<void>) => callback(null))
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: requestLock } })
  await expect(withBatchSubmissionLock('batch', action)).rejects.toThrow('另一个页面正在提交本集')
  expect(action).not.toHaveBeenCalled()
})

it('applies revision feedback to the selected retake and reuses it after interrupted preparation', async () => {
  const b = basis()
  const current = { ...b, shots: b.shots.map(shot => ({ ...shot,
    runs: [{ runId: `old-${shot.frameId}`, publicStatus: 'succeeded' }] as never,
    saved: { ...shot.saved, draft: { revision: 2, frameSha256: shot.saved.frameSha256,
      requestSha256: 'd'.repeat(64), savedAt: '', request: { ...request, frameId: shot.frameId, directorSourceSha256: source.sha256 } } },
  })) }
  const feedback = '去掉茶杯参考中的窗户，保持庭院背景和原站位。'
  const retakes = new Set(['f'])
  expect(needsBatchDesign(current.shots[0]!)).toBe(false)
  const choices = parseBatchChoices(JSON.stringify({ shots: [choice('f')] }), current, retakes, feedback)
  expect(choices).toHaveLength(1)
  expect(choices[0]?.preparationFeedback).toBe(feedback)
  expect(JSON.stringify(choices[0]?.promptParts)).not.toContain(feedback)
  expect(() => parseBatchChoices(JSON.stringify({ shots: [choice('f'), choice('f2')] }), current, retakes, feedback)).toThrow('不属于本次准备')
  const shot = current.shots[0]!
  let saved = shot.saved
  const save = vi.fn(async (command: { request: typeof shot.saved.draft.request }) => {
    saved = { ...saved, draft: { ...saved.draft, revision: 3, request: JSON.parse(JSON.stringify(command.request, (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)) as typeof command.request } }
    return saved
  })
  const materials = vi.fn().mockRejectedValueOnce(new Error('temporary disconnect'))
    .mockResolvedValue({ configured: true, allReady: true, materials: [] })
  const port = { referenceVideoDraft: async () => saved, saveReferenceVideoDraft: save,
    readReferenceVideoMaterials: materials, referenceVideoQuote: async () => quoteResponse } as unknown as BatchPort
  await expect(prepareBatchShot(port, 'p', shot, choices[0], true)).rejects.toThrow('disconnect')
  await prepareBatchShot(port, 'p', shot, choices[0], true)
  expect(save).toHaveBeenCalledOnce()
  expect(saved.draft.request.promptParts.at(-1)).toEqual(choices[0]?.promptParts.at(-1))
  expect(current.shots[1]!.saved.draft.revision).toBe(2)
  saved = { ...saved, draft: { ...saved.draft, revision: 4, request: { ...saved.draft.request, promptParts: [{ text: 'another editor' }] } } }
  await expect(prepareBatchShot(port, 'p', shot, choices[0], true)).rejects.toThrow('其他页面更新')
  expect(save).toHaveBeenCalledOnce()
})


it('resumes a saved draft with unchanged feedback without another director revision', () => {
  const b = basis()
  const feedback = '保留庭院与每位演员原声线'
  const requests = parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), b, new Set(), feedback)
  const original = b.shots[0]!
  const shot = { ...original, saved: { ...original.saved,
    draft: { revision: 1, frameSha256: original.saved.frameSha256, requestSha256: 'd'.repeat(64),
      request: requests[0]!, savedAt: '2026-09-15T00:00:00Z' } } }
  expect(needsBatchDesign(shot, feedback)).toBe(false)
  expect(needsBatchDesign(shot, '修改后的表演要求')).toBe(true)
  expect(needsBatchDesign({ ...shot, saved: { ...shot.saved, directorSource: { ...source, sha256: 'b'.repeat(64) } } }, feedback)).toBe(true)
})


it('keeps another shot correction out of production and refreshes legacy appended feedback', () => {
  const b = basis(), feedback = '只在镜2让人物说：开门。镜1保持无对白。'
  const requests = parseBatchChoices(JSON.stringify({ shots: ['f', 'f2'].map(choice) }), b, new Set(), feedback)
  for (const request of requests) {
    expect(request.preparationFeedback).toBe(feedback)
    expect(JSON.stringify(request.promptParts)).not.toContain('只在镜2')
    expect(JSON.stringify(request.promptParts)).not.toContain('【本次修改意见】')
  }
  const saved = { ...b.shots[0]!, saved: { ...b.shots[0]!.saved, draft: {
    revision: 1, frameSha256: b.shots[0]!.saved.frameSha256, requestSha256: 'd'.repeat(64), savedAt: '',
    request: { ...requests[0]!, promptParts: [...requests[0]!.promptParts, { text: `\n【本次修改意见】\n${feedback}` }] },
  } } }
  expect(needsBatchDesign(saved, feedback)).toBe(true)
})

it('does not silently reuse full-source pasting when the director omitted execution', () => {
  const { executionPrompt: _omitted, ...missing } = choice('f')
  expect(() => parseBatchChoices(JSON.stringify({ shots: [missing, choice('f2')] }), basis())).toThrow('缺少拍摄执行描述')
})
