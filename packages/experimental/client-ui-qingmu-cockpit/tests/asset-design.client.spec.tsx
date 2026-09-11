// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAssetDesign } from '../src/client/NativeAssetDesign.tsx'
import type { AssetDesignState, AssetImageRuns } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const scope = { projectId: 'p', episodeId: 'e' }
const state: AssetDesignState = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), scriptSha256: 'b'.repeat(64), scriptRevision: 1, script: {}, model: 'wan2.7-image-pro',
  design: { sourceScriptSha256: 'b'.repeat(64), assets: [{ id: 'actor_1', kind: 'actor', name: '父亲', imagePrompt: '真人定妆照', voiceIdentity: '成年温厚自然中低音' }], director: {
    visualStyle: '写实', tone: '温暖', colorPalette: ['灰蓝'], lightingRules: '窗光', cameraGrammar: '跟随动作', performanceRules: '自然', characterContinuityRules: '服装稳定',
  } } }
afterEach(() => { cleanup(); localStorage.clear() })
function setup() {
  const port = {
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: [{ assetId: 'asset_ref', assetSha256: 'e'.repeat(64), label: '已采用人物', mediaType: 'reference_image' as const, browserUrl: '' }] })),
    readLocalReferenceCandidateContent: vi.fn(async () => { throw new Error('unused') }),
    readAssetVoiceRuns: vi.fn(async (): Promise<AssetImageRuns> => ({ ...scope, items: [] })),
    quoteAssetVoice: vi.fn(async () => ({ ...scope, entity: { ...state.design!.assets[0]!, id: 'actor_1' }, quoteSha256: 'd'.repeat(64), estimatedCny: '0.000000', generationAvailable: true, model: 'cosyvoice-v3.5-plus', prompt: '成年温厚自然中低音', mediaType: 'audio' as const })),
    generateAssetVoice: vi.fn(async () => ({ requestId: 'voice-1', taskId: 'task_voice', status: 'Queued', estimatedCny: '0.000000', selectionChanged: false as const })),
    readAssetDesign: vi.fn(async () => state), saveAssetDesign: vi.fn(async () => state),
    quoteAssetImage: vi.fn(async () => ({ ...scope, entity: { ...state.design!.assets[0]!, id: 'actor_1' }, quoteSha256: 'c'.repeat(64), estimatedCny: '0.500000', generationAvailable: true, model: state.model, prompt: '真人定妆照' })),
    generateAssetImage: vi.fn(async () => ({ requestId: 'image-1', taskId: 'task_1', status: 'Queued', estimatedCny: '0.500000', selectionChanged: false as const })),
    readAssetImageRuns: vi.fn(async (): Promise<AssetImageRuns> => ({ ...scope, items: [] })) }
  return port
}
it('requires saved design and displayed price before one image submission', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const text = await screen.findByLabelText('画面描述')
  fireEvent.change(text, { target: { value: '灰蓝衬衣的真人定妆照' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '查看生成费用' }))
  const confirm = await screen.findByRole('button', { name: '确认费用并生成一张' })
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => { expect(port.generateAssetImage).toHaveBeenCalledTimes(1) })
  expect(port.generateAssetImage.mock.calls[0]).toMatchObject([{ ...scope, entityId: 'actor_1',
    command: { paidConfirmed: true, authorizationCapCny: '0.500000' } }])
})
it('rereads an existing image run on reload without charging again', async () => {
  const port = setup()
  port.readAssetImageRuns.mockResolvedValue({ ...scope, items: [{ taskId: 'task_1', entityId: 'actor_1', requestId: 'original', status: 'Succeeded', assetId: 'asset_1', errorCode: null }] })
  const onGenerated = vi.fn()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={onGenerated} />)
  await screen.findByText('图片已生成，可在下方素材库查看')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  expect(onGenerated).toHaveBeenCalledTimes(1)
})

it('quotes and queues voice separately from the image and restores progress on reload', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const button = await screen.findByRole('button', { name: '生成声音试听' })
  await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(button)
  const confirm = await screen.findByRole('button', { name: '确认费用并生成试听' })
  expect(port.generateAssetVoice).not.toHaveBeenCalled()
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => { expect(port.generateAssetVoice).toHaveBeenCalledTimes(1) })
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})


it('saves ordered image references and world exceptions before a quotation without changing media selection', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '参考与局部修改 · 0 张图' }))
  const select = await screen.findByLabelText('添加参考图')
  await screen.findByRole('option', { name: '已采用人物' })
  fireEvent.change(select, { target: { value: 'asset_ref' } })
  fireEvent.change(await screen.findByLabelText('图 1 的用途'), { target: { value: '保持脸和衣服，生成背面视角' } })
  fireEvent.change(screen.getByLabelText('剧本例外'), { target: { value: '穿越者可携带现代手机' } })
  fireEvent.change(screen.getByLabelText('设计依据'), { target: { value: '手机来自穿越者' } })
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: {
    world: { exceptions: '穿越者可携带现代手机' },
    assets: [{ designBasis: '手机来自穿越者', references: [{
      assetId: 'asset_ref', assetSha256: 'e'.repeat(64), purpose: '保持脸和衣服，生成背面视角', boxes: [],
    }] }],
  } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it('carries resolved creation settings into the native design request before generating images', async () => {
  const port = setup()
  const creativeSettings = { visualStyle: { label: '透明水彩', prompt: '透明水彩色层' },
    stylePack: { palette: ['水彩明度层次'] }, styleAdjustments: ['高饱和金属反射'] }
  port.readAssetDesign.mockResolvedValue({ ...state, creativeSettings })
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: 0, running: false, finished: false, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '保留当前未保存的服装设计' } })
  fireEvent.click(await screen.findByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledTimes(1) })
  expect(storyPort.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(creativeSettings))])
  expect(storyPort.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining('保留当前未保存的服装设计')])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
