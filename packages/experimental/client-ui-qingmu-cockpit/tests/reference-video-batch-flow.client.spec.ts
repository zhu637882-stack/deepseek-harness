// @vitest-environment jsdom
import { expect, it, vi, beforeEach } from 'vitest'
import { collectBatchShot, readBatchBasis, parseBatchChoices, prepareBatchShot, submitBatchShot, hasBatchRun, type BatchBasis, type BatchPort } from '../src/client/reference-video-batch.ts'
import { request, quoteResponse } from '../../qingmu-yimeng-read-adapter/tests/reference-video-fixture.ts'

const source = { sha256: 'e'.repeat(64), prompt: '研究：下一镜才开门', generationPrompt: '角色保持原服装。0秒敲锣，铜锣余响。对白：请进。' }
function basis(): BatchBasis {
  return { projectId: 'p', assets: [{ assetId: 'asset_lin', assetSha256: 'a'.repeat(64), label: '林予', browserUrl: '', mediaType: 'reference_image' }],
    shots: ['f', 'f2'].map((frameId, i) => ({ frameId, label: `镜${i + 1}`, duration: 8, runs: [], saved: {
      schema: 'jason.reference-video-draft.v1', projectId: 'p', frameId, frameSha256: 'f'.repeat(64),
      draft: null, directorSource: source, mediaTypes: {}, providerCalls: 0, generationQueued: false,
    } })) }
}
const choice = (frameId: string) => ({ frameId, references: [{ assetId: 'asset_lin', assetLabel: '林予', purpose: '本镜角色身份与衣服' }], parameters: request.parameters })
beforeEach(() => sessionStorage.clear())

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
    expect(text.split(source.generationPrompt)).toHaveLength(2)
    expect(text).toContain('（林予）：本镜角色身份与衣服')
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
    draft: { revision: 1, requestSha256: 'd'.repeat(64), request } }),
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
