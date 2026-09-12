// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAssetDesign } from '../src/client/NativeAssetDesign.tsx'
import type { AssetDesignState, AssetImageRuns } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const scope = { projectId: 'p', episodeId: 'e' }
const state: AssetDesignState = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), scriptSha256: 'b'.repeat(64), scriptRevision: 1, script: {}, model: 'wan2.7-image-pro',
  design: { sourceScriptSha256: 'b'.repeat(64), assets: [{ id: 'actor_1', kind: 'actor', name: '父亲', imagePrompt: '真人定妆照', voiceIdentity: '成年温厚自然中低音' }], director: {
    visualStyle: '写实', tone: '温暖', colorPalette: ['灰蓝'], lightingRules: '窗光', cameraGrammar: '跟随动作', performanceRules: '自然', characterContinuityRules: '服装稳定',
  } } }
afterEach(() => { cleanup(); localStorage.clear() })
it('edits shared room geography and a separate reverse view, preserving both through legacy import and reload', async () => {
  const port = setup()
  const spatial = { ...state, design: { ...state.design!, assets: [state.design!.assets[0]!,
    { id: 'scene_1', kind: 'scene' as const, name: '工作室', imagePrompt: '木墙与侧窗',
      space: { layout: '入口对面窗，桌子靠窗墙' }, imageStage: { camera: '入口朝窗' } },
    { id: 'scene_2', kind: 'scene' as const, name: '院落', imagePrompt: '北侧月洞门' },
  ] } }
  port.readAssetDesign.mockResolvedValue(spatial)
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...spatial,
    design: { ...spatial.design, ...(input as { design: object }).design } }))
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const room = within(await screen.findByRole('region', { name: '场景 工作室' }))
  fireEvent.change(room.getByLabelText('摄影机位置与取景'), { target: { value: '窗边朝门，反打' } })
  fireEvent.change(room.getByLabelText('本图物件状态'), { target: { value: '门半开' } })
  const actor = within(screen.getByRole('region', { name: '人物 父亲' }))
  fireEvent.change(actor.getByLabelText('取景场景'), { target: { value: '工作室' } })
  fireEvent.change(actor.getByLabelText('本图人物站位'), { target: { value: '人物站在窗与桌之间' } })
  expect(room.getByLabelText<HTMLTextAreaElement>('格局与固定物').value).toBe('入口对面窗，桌子靠窗墙')
  // Importing the former schema must not erase spatial edits or apply one room to another.
  const imported = { ...spatial.design,
    assets: spatial.design.assets.map(({ kind, id, name, imagePrompt }) => ({ kind, id, name, imagePrompt })) }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(imported) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  expect(saved.design?.assets[0]?.imageStage).toMatchObject({ sceneName: '工作室', blocking: '人物站在窗与桌之间' })
  expect(saved.design?.assets[1]).toMatchObject({ space: { layout: '入口对面窗，桌子靠窗墙' }, imageStage: { camera: '窗边朝门，反打', state: '门半开' } })
  expect(saved.design?.assets[2]?.space).toBeUndefined()
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const reopened = within(await screen.findByRole('region', { name: '场景 工作室' }))
  expect(reopened.getByLabelText<HTMLTextAreaElement>('摄影机位置与取景').value).toBe('窗边朝门，反打')
  expect(reopened.getByLabelText<HTMLTextAreaElement>('格局与固定物').value).toBe('入口对面窗，桌子靠窗墙')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('recovers missing quote escapes without losing design prose or changing existing media', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  const design = { ...state.design!, assets: [{ ...state.design!.assets[0]!,
    imagePrompt: '旧木桌上放一只小碟', designBasis: '勾出"用了很多年"的场所痕迹，文字完整保留。' }] }
  fireEvent.change(screen.getByLabelText('素材设计数据'), {
    target: { value: JSON.stringify(design).replaceAll('\\"', '"') },
  })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  expect((screen.getByLabelText<HTMLTextAreaElement>('设计依据')).value).toBe(design.assets[0]!.designBasis)
  expect(screen.getByText(/已修正正文引号的格式/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: design.assets } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it.each(['missing closing brace', 'omitted content'])('preserves current cards when recovery would invent %s', async (kind) => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  const complete = JSON.stringify(state.design)
  const incomplete = kind === 'missing closing brace' ? complete.slice(0, -1) : complete.replace('"assets":[', '"assets":[...,')
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: incomplete } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  expect(screen.getByText(/设计格式不完整/)).toBeTruthy()
  expect((screen.getByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('真人定妆照')
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
function setup() {
  const port = {
    referenceVideoAssets: vi.fn(async () => ({ projectId: 'p', page: 1, pages: 1, items: [{ assetId: 'asset_ref', assetSha256: 'e'.repeat(64), label: '已采用人物', mediaType: 'reference_image' as const, browserUrl: '' }] })),
    readLocalReferenceCandidateContent: vi.fn(async () => { throw new Error('unused') }),
    readAssetVoiceRuns: vi.fn(async (): Promise<AssetImageRuns> => ({ ...scope, items: [] })),
    quoteAssetVoice: vi.fn(async () => ({ ...scope, entity: { ...state.design!.assets[0]!, id: 'actor_1' }, quoteSha256: 'd'.repeat(64), estimatedCny: '0.000000', generationAvailable: true, model: 'cosyvoice-v3.5-plus', prompt: '成年温厚自然中低音', mediaType: 'audio' as const })),
    generateAssetVoice: vi.fn(async () => ({ requestId: 'voice-1', taskId: 'task_voice', status: 'Queued', estimatedCny: '0.000000', selectionChanged: false as const })),
    readAssetDesign: vi.fn(async () => state), saveAssetDesign: vi.fn(async (_input?: unknown) => state),
    quoteAssetImage: vi.fn(async () => ({ ...scope, entity: { ...state.design!.assets[0]!, id: 'actor_1' }, quoteSha256: 'c'.repeat(64), estimatedCny: '0.500000', generationAvailable: true, model: state.model, prompt: '真人定妆照' })),
    generateAssetImage: vi.fn(async () => ({ requestId: 'image-1', taskId: 'task_1', status: 'Queued', estimatedCny: '0.500000', selectionChanged: false as const })),
    readAssetImageRuns: vi.fn(async (): Promise<AssetImageRuns> => ({ ...scope, items: [] })) }
  return port
}
it('persists a per-image model, invalidates the quote and restores the same choice', async () => {
  const port = setup()
  const models = [{ id: 'qwen-image-3.0-pro', name: 'Qwen-Image 3.0 Pro', maxReferences: 3, supportsBoxes: false }]
  port.readAssetDesign.mockResolvedValue({ ...state, imageModels: models })
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...state, imageModels: models,
    design: { ...state.design!, ...(input as { design: object }).design } }))
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('图片模型'), { target: { value: models[0]!.id } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: [{ imageModel: models[0]!.id }] } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  port.readAssetDesign.mockResolvedValue(saved)
  view.unmount()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLSelectElement>('图片模型')).value).toBe(models[0]!.id)
})
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
  expect(storyPort.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining('无人空场不等于空房')])
  expect(storyPort.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining('由导演决定信息密度与留白')])
  expect(storyPort.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining('visualIdentity 记录主体完整外观')])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it('keeps the entity description separate from an imported image edit and restores both', async () => {
  const port = setup()
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('主体完整设定')).value).toBe('真人定妆照')
  fireEvent.change(screen.getByLabelText('主体完整设定'), { target: { value: '成年男子，灰蓝夹克配暗红毛衣' } })
  const imported = { ...state.design!, assets: [{ kind: 'actor', name: '父亲', imagePrompt: '改为背面视角' }] }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(imported) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  expect((screen.getByLabelText<HTMLTextAreaElement>('主体完整设定')).value).toBe('成年男子，灰蓝夹克配暗红毛衣')
  expect((screen.getByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('改为背面视角')
  const saved = { ...state, design: { ...state.design!, assets: [{ ...state.design!.assets[0]!,
    visualIdentity: '成年男子，灰蓝夹克配暗红毛衣', imagePrompt: '改为背面视角' }] } }
  port.saveAssetDesign.mockResolvedValue(saved)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: [{
    visualIdentity: '成年男子，灰蓝夹克配暗红毛衣', imagePrompt: '改为背面视角',
  }] } }])
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('主体完整设定')).value).toBe('成年男子，灰蓝夹克配暗红毛衣')
  expect((screen.getByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('改为背面视角')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it('saves independent image framing before requoting and restores it on reopen', async () => {
  const port = setup()
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('素材画幅'), { target: { value: '3:4' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  const saved = { ...state, design: { ...state.design!, assets: [{ ...state.design!.assets[0]!, imageAspectRatio: '3:4' as const }] } }
  port.saveAssetDesign.mockResolvedValue(saved)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: [{ imageAspectRatio: '3:4' }] } }])
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLSelectElement>('素材画幅')).value).toBe('3:4')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})


it('keeps legacy composition until a complete frame is explicitly saved and restored', async () => {
  const port = setup()
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const option = await screen.findByRole<HTMLInputElement>('checkbox', { name: '以完整画面描述出图' })
  expect(option.checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '查看生成费用' }))
  await screen.findByRole('button', { name: '确认费用并生成一张' })
  fireEvent.click(option)
  expect(screen.queryByRole('button', { name: '确认费用并生成一张' })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  const updated = { ...state, design: { ...state.design!, assets: [{ ...state.design!.assets[0]!, selfContainedImagePrompt: true }] } }
  port.saveAssetDesign.mockResolvedValue(updated)
  port.readAssetDesign.mockResolvedValue(updated)
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: [{ selfContainedImagePrompt: true, imagePrompt: '真人定妆照' }] } }])
  view.unmount()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: '以完整画面描述出图' })).checked).toBe(true)
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it('rejects an ambiguous frame flag from imported model output', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  const value = { ...state.design, assets: [{ ...state.design!.assets[0], selfContainedImagePrompt: 'false' }] }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(value) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  expect(screen.getByText(/完整画面描述选项需要是布尔值/)).toBeTruthy()
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
})
