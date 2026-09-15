// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAssetDesign } from '../src/client/NativeAssetDesign.tsx'
import { AssetImageReferences } from '../src/client/AssetImageReferences.tsx'
import type { AssetDesignItem, AssetDesignState, AssetImageRuns } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const scope = { projectId: 'p', episodeId: 'e' }
const state: AssetDesignState = { ...scope, schema: 'qingmu.asset-design-state.v1', stateSha256: 'a'.repeat(64), scriptSha256: 'b'.repeat(64), scriptRevision: 1, script: {}, model: 'wan2.7-image-pro',
  design: { sourceScriptSha256: 'b'.repeat(64), assets: [{ id: 'actor_1', kind: 'actor', name: '父亲', imagePrompt: '真人定妆照', voiceIdentity: '成年温厚自然中低音' }], director: {
    visualStyle: '写实', tone: '温暖', colorPalette: ['灰蓝'], lightingRules: '窗光', cameraGrammar: '跟随动作', performanceRules: '自然', characterContinuityRules: '服装稳定',
  } } }
afterEach(() => { cleanup(); localStorage.clear() })
it.each([false, true])('retains uploaded product references in the first imported design (product included: %s)', async (included) => {
  const port = setup()
  const product: AssetDesignItem = { id: 'prop_product', kind: 'prop', name: '广告产品', imagePrompt: '沿用用户产品外观',
    references: [{ assetId: 'asset_product', assetSha256: 'c'.repeat(64), purpose: '用户产品图' }] }
  port.readAssetDesign.mockResolvedValue({ ...state, design: null, productAssets: [product] })
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByRole('heading', { name: '广告产品 · 产品图片已保存' })
  const imported = { ...state.design!, assets: included ? [{ ...product, references: [] }] : state.design!.assets }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(imported) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledOnce() })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: expect.arrayContaining([
    expect.objectContaining({ id: product.id, references: product.references }),
  ]) } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it.each(['actor', 'scene', 'prop'] as const)('normalizes a null voice in an imported %s design before recovery and saving', async (kind) => {
  const port = setup()
  const mount = () => render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const view = mount()
  await screen.findByLabelText('画面描述')
  const imported = { ...state.design!, assets: [{ kind, name: '素材', imagePrompt: '保留的画面描述', voiceIdentity: null }] }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(imported) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  view.unmount(); mount()
  expect((await screen.findByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('保留的画面描述')
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: {
    assets: [{ kind, name: '素材', imagePrompt: '保留的画面描述', voiceIdentity: '' }],
  } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('rejects a non-text voice without replacing the existing cards', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify({ ...state.design!,
    assets: [{ ...state.design!.assets[0], voiceIdentity: 42 }],
  }) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  await screen.findByText(/声音身份需要文字描述/)
  expect(screen.getByRole('status').textContent).toMatchInlineSnapshot('"Error: 声音身份需要文字描述。"')
  expect(screen.getByLabelText<HTMLTextAreaElement>('声音身份').value).toBe('成年温厚自然中低音')
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
})
it('restores unsaved card and whole-film edits after leaving, including a temporarily empty prompt', async () => {
  const port = setup()
  const mount = () => render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const view = mount()
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('摄影与运镜'), { target: { value: '同一房间反打，固定陈设不移动' } })
  fireEvent.change(screen.getByLabelText('剧本例外'), { target: { value: '穿越者携带智能手机' } })
  view.unmount(); mount()
  expect((await screen.findByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('')
  expect(screen.getByLabelText<HTMLTextAreaElement>('摄影与运镜').value).toBe('同一房间反打，固定陈设不移动')
  expect(screen.getByLabelText<HTMLTextAreaElement>('剧本例外').value).toBe('穿越者携带智能手机')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存素材设计' }).disabled).toBe(false)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '查看生成费用' }).disabled).toBe(true)
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('retains a stale local design for comparison and requires an explicit rebase before saving', async () => {
  const port = setup()
  const mount = () => render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const view = mount()
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '我的未保存定妆' } })
  view.unmount()
  const latest = { ...state, stateSha256: 'c'.repeat(64), design: { ...state.design!,
    assets: [{ ...state.design!.assets[0]!, imagePrompt: '另一处新保存的定妆' }] } }
  port.readAssetDesign.mockResolvedValue(latest)
  mount()
  const comparison = await screen.findByRole('region', { name: '素材草稿版本变化' })
  expect(comparison.textContent).toContain('另一处新保存的定妆')
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('我的未保存定妆')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存素材设计' }).disabled).toBe(true)
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '已核对，保留本机稿继续编辑' }))
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ expectedStateSha256: latest.stateSha256,
    design: { assets: [{ imagePrompt: '我的未保存定妆' }] } }])
  await waitFor(() => { expect(localStorage.getItem('qingmu.asset-design-draft.v1:p:e')).toBeNull() })
})
it('keeps each projects unsaved design separate during navigation', async () => {
  const port = setup()
  const first = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '第一个项目的设计' } })
  first.unmount()
  port.readAssetDesign.mockResolvedValue({ ...state, projectId: 'other', episodeId: 'other-e' })
  const second = render(<NativeAssetDesign projectId="other" episodeId="other-e" port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('真人定妆照')
  fireEvent.change(screen.getByLabelText('画面描述'), { target: { value: '第二个项目的设计' } })
  second.unmount(); port.readAssetDesign.mockResolvedValue(state)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('画面描述')).value).toBe('第一个项目的设计')
  expect(JSON.parse(localStorage.getItem('qingmu.asset-design-draft.v1:other:other-e')!).design.assets[0].imagePrompt)
    .toBe('第二个项目的设计')
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
})
it('keeps edits made during a pending save and rebases only their saved source', async () => {
  const port = setup()
  let finish!: (value: AssetDesignState) => void
  port.saveAssetDesign.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '提交的第一稿' } })
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  fireEvent.change(screen.getByLabelText('画面描述'), { target: { value: '保存时继续编辑的第二稿' } })
  const saved = { ...state, stateSha256: 'd'.repeat(64), design: { ...state.design!,
    assets: [{ ...state.design!.assets[0]!, imagePrompt: '提交的第一稿' }] } }
  finish(saved)
  await screen.findByText('上一份设计已保存；保存期间的新修改仍在本机草稿中。')
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('保存时继续编辑的第二稿')
  expect(JSON.parse(localStorage.getItem('qingmu.asset-design-draft.v1:p:e')!)).toMatchObject({
    stateSha256: saved.stateSha256, design: { assets: [{ imagePrompt: '保存时继续编辑的第二稿' }] },
  })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存素材设计' }).disabled).toBe(false)
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('checks for a newer saved source before sending a design write', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '未保存的侧面设计' } })
  port.readAssetDesign.mockResolvedValue({ ...state, stateSha256: 'f'.repeat(64) })
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await screen.findByRole('region', { name: '素材草稿版本变化' })
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('未保存的侧面设计')
})
it('recovers the shared room, camera, staging and ordered references without generating or saving', async () => {
  const port = setup()
  const room: AssetDesignItem = { id: 'scene_1', kind: 'scene', name: '工作室', imagePrompt: '窗下木桌',
    visualIdentity: '北窗南门，木桌靠北墙',
    space: { layout: '桌靠北墙', orientation: '北窗南门', lighting: '北窗光', scale: '导演估计' },
    imageStage: { camera: '入口朝窗', state: '风扇未接电' },
    sceneLayout: { basis: '导演拟定', coordinateFrame: 'X东Y北Z上', objects: [
      { id: 'desk', label: '工作台', center: [0, 1, .4], size: [1.2, .8, .8], rotation: 0, color: '#886655' },
    ] }, imageCamera: { position: [0, -3, 1.6], target: [0, 1, .4], verticalFov: 50 },
    references: [{ assetId: 'reference_room', assetSha256: 'e'.repeat(64), purpose: '固定格局', boxes: [] }],
  }
  port.readAssetDesign.mockResolvedValue({ ...state, design: { ...state.design!, assets: [room] } })
  const mount = () => render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const view = mount()
  fireEvent.change(await screen.findByLabelText('本图物件状态'), { target: { value: '线缆已接墙插，开关仍关闭' } })
  view.unmount(); mount()
  expect((await screen.findByLabelText<HTMLTextAreaElement>('本图物件状态')).value).toBe('线缆已接墙插，开关仍关闭')
  const saved = JSON.parse(localStorage.getItem('qingmu.asset-design-draft.v1:p:e')!).design.assets[0]
  expect(saved).toEqual({ ...room, imageStage: { ...room.imageStage, state: '线缆已接墙插，开关仍关闭' } })
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
})
it('keeps edits on screen when browser storage is full and reports that they are not recoverable yet', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const field = await screen.findByLabelText('画面描述')
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  try {
    fireEvent.change(field, { target: { value: '仍然保留在当前页面的修改' } })
    expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('仍然保留在当前页面的修改')
    await screen.findByText('本机未能保存草稿，请保持本页并保存到项目，避免丢失修改。')
    expect(port.saveAssetDesign).not.toHaveBeenCalled()
  } finally { storage.mockRestore() }
})
it('recovers scene feedback, appends it without losing the user direction and keeps projects separate', async () => {
  const key = 'qingmu.scene-feedback.v1:p:e:room'
  const instructionKey = 'qingmu.asset-design-instructions.v1:p:e'
  localStorage.setItem(key, JSON.stringify({ ...scope, sceneId: 'room', sceneName: '工作室',
    scriptSha256: state.scriptSha256, assetSha256: 'old design', storyboardSha256: 'old storyboard', issues: ['核对门与桌之间的路线'] }))
  localStorage.setItem(instructionKey, '保留暖色与年代设定')
  const port = setup()
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async (_id: string, _prompt: string) => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: -1, running: false, finished: false, error: '' })) }
  const mount = () => render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  const view = mount()
  await screen.findByText(/反馈后的剧本或素材已有变化/)
  fireEvent.click(screen.getByRole('button', { name: '加入创作补充' }))
  const text = screen.getByLabelText<HTMLTextAreaElement>('创作补充').value
  expect(text).toContain('保留暖色与年代设定')
  expect(text).toContain('核对门与桌之间的路线')
  expect(text).toContain('不是新的项目事实')
  fireEvent.click(screen.getByRole('button', { name: '加入创作补充' }))
  expect(screen.getByLabelText<HTMLTextAreaElement>('创作补充').value).toBe(text)
  view.unmount(); const recovered = mount()
  expect(screen.getByLabelText<HTMLTextAreaElement>('创作补充').value).toBe(text)
  fireEvent.click(await screen.findByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledTimes(1) })
  expect(storyPort.send.mock.calls[0]?.[1]).toContain(text)
  expect(screen.getByRole('link', { name: '返回分镜协调' }).getAttribute('href'))
    .toBe('?qingmuView=storyboard&qingmuProject=p&qingmuEpisode=e')
  recovered.rerender(<NativeAssetDesign projectId="other" episodeId="other-e" port={port} onGenerated={vi.fn()} />)
  expect(screen.getByLabelText<HTMLTextAreaElement>('创作补充').value).toBe('')
  expect(localStorage.getItem(instructionKey)).toBe(text)
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('authors asset designs from current world and spatial sources through the native entry', async () => {
  const port = setup()
  const configured = { ...state, design: { ...state.design!, world: {
    setting: '1996年', scriptFacts: '孩子来自2026年', directorInferences: '修理间靠窗布置',
    exceptions: '孩子携带智能手机', openQuestions: '房间尺寸尚未测量',
  } } }
  port.readAssetDesign.mockResolvedValue(configured)
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async (_id: string, _prompt: string) => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: -1, running: false, finished: false, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledTimes(1) })
  expect(storyPort.send.mock.calls[0]?.[1]).toMatchSnapshot()
  const request = JSON.parse(localStorage.getItem('qingmu.asset-design-session.v1:p:e')!)
  expect(JSON.parse(request.sourceKey)).toMatchObject({ stateSha256: state.stateSha256, design: { world: configured.design.world } })
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it.each(['missing space', 'missing choices', 'camera without layout'])('keeps existing cards when a new native scene has %s', async (defect) => {
  const port = setup()
  const camera = { position: [0, -3, 1.6], target: [0, 1, .4], verticalFov: 50 }
  const scene = { kind: 'scene', name: '新房间', imagePrompt: '门口看向窗下木桌',
    ...(defect === 'missing space' ? {} : { space: { layout: '北窗南门，桌靠北墙' } }),
    ...(defect === 'missing choices' ? {} : { sceneLayout: null, imageCamera: defect === 'camera without layout' ? camera : null }) }
  const candidate = { ...state.design, assets: [scene] }
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '设计完成。', script: JSON.stringify(candidate), lastSeq: 10, running: false, finished: true, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  await screen.findByRole('region', { name: '人物 父亲' })
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  expect(await screen.findByText(/当前素材保持不变/)).toBeTruthy()
  expect(screen.queryByRole('region', { name: '场景 新房间' })).toBeNull()
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('真人定妆照')
  expect(localStorage.getItem('qingmu.asset-design-draft.v1:p:e')).toBeNull()
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it.each([true, false])('saves and reloads a new native scene with explicit geometry choice %s', async (geometry) => {
  const port = setup()
  const scene: AssetDesignItem = { kind: 'scene', name: '新房间', imagePrompt: '门口看向窗下木桌',
    space: { layout: '北窗南门，桌靠北墙' }, imageStage: { camera: '门边朝北窗', state: '桌面空置' },
    sceneLayout: geometry ? { basis: '导演设计估计', coordinateFrame: '米，X东Y北Z上', objects: [
      { id: 'desk', label: '木桌', center: [0, 1, .4], size: [1.2, .8, .8], rotation: 0, color: '#886655' },
    ] } : null, imageObjectStates: geometry ? [{ id: 'desk', basis: '本图开始前已搬到左侧', center: [-1,1,.4] }] : null, imageCamera: geometry ? { position: [0, -3, 1.6], target: [0, 1, .4], verticalFov: 50 } : null }
  const candidate = { ...state.design, assets: [scene] }
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...state, design: (input as { design: NonNullable<AssetDesignState['design']> }).design }))
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '交付场景布局与取景选择。', script: JSON.stringify(candidate), lastSeq: 10, running: false, finished: true, error: '' })) }
  const view = render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  await screen.findByRole('region', { name: '人物 父亲' })
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  expect(screen.getByRole('region', { name: '场景 新房间' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  expect(saved.design?.assets[1]).toEqual({ ...scene, visualIdentity: scene.imagePrompt })
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const room = await screen.findByRole('region', { name: '场景 新房间' })
  expect(within(room).getByLabelText<HTMLTextAreaElement>('本图物件状态').value).toBe('桌面空置')
  expect(storyPort.send).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it.each([false, true])('keeps world exceptions and room details through an AI supplement, save and reload (director omitted: %s)', async (omitDirector) => {
  const port = setup()
  const world = { setting: '1996年', scriptFacts: '父亲在室内', directorInferences: '桌边留出通道',
    exceptions: '来自2026年的孩子携带智能手机', openQuestions: '待确定窗外景观' }
  const room = { id: 'scene_1', kind: 'scene' as const, name: '工作室', imagePrompt: '窗边工作台',
    space: { orientation: '北窗南门', layout: '桌靠北窗', scale: '桌高约0.8米，设计估计', lighting: '北窗光' },
    imageStage: { camera: '门边看向窗', state: '风扇未接电' } }
  const configured = { ...state, design: { ...state.design!, world, assets: [room, state.design!.assets[0]!] } }
  port.readAssetDesign.mockResolvedValue(configured)
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...configured,
    design: { ...configured.design, ...(input as { design: object }).design } }))
  const supplement = { ...(omitDirector ? {} : { director: state.design!.director }), assets: [{ kind: 'scene', id: room.id, name: room.name,
    imagePrompt: '从窗侧看工作台', space: { layout: '桌仍靠北窗，南门旁加一把木椅' }, imageStage: { camera: '窗边看向门' } }] }
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '调整房间取景。', script: JSON.stringify(supplement), lastSeq: 10, running: false, finished: true, error: '' })) }
  const view = render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  expect(screen.getByLabelText<HTMLTextAreaElement>('剧本例外').value).toBe(world.exceptions)
  expect(within(screen.getByRole('region', { name: '场景 工作室' })).getByLabelText<HTMLTextAreaElement>('本图物件状态').value).toBe('风扇未接电')
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  expect(saved.design?.world).toEqual(world)
  expect(saved.design?.director).toEqual(configured.design.director)
  expect(saved.design?.assets[1]).toMatchObject(state.design!.assets[0]!)
  expect(saved.design?.assets[0]?.space).toEqual({ ...room.space, layout: supplement.assets[0]!.space.layout })
  expect(saved.design?.assets[0]?.imageStage).toEqual({ camera: '窗边看向门', state: '风扇未接电' })
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('剧本例外')).value).toBe(world.exceptions)
  fireEvent.change(screen.getByLabelText('剧本例外'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(2) })
  expect(port.saveAssetDesign.mock.calls[1]).toMatchObject([{ design: { world: { ...world, exceptions: '' } } }])
  expect(storyPort.send).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('adopts an AI supplement without dropping an omitted room or the existing character voice', async () => {
  const port = setup()
  const room = { id: 'scene_1', kind: 'scene' as const, name: '工作室', imagePrompt: '窗下木桌',
    visualIdentity: '入口对面窗，桌子靠窗墙', space: { layout: '入口对面窗，桌子靠窗墙' },
    imageStage: { camera: '入口朝窗' }, references: [{ assetId: 'asset_ref', assetSha256: 'e'.repeat(64), purpose: '固定格局', boxes: [] }] }
  const configured = { ...state, design: { ...state.design!, assets: [room, state.design!.assets[0]!] } }
  const supplement = { ...state.design, assets: [{ kind: 'actor', name: '父亲', imagePrompt: '同一父亲的侧身定妆' },
    { kind: 'actor', name: '孩子', imagePrompt: '儿童独立定妆' }] }
  port.readAssetDesign.mockResolvedValue(configured)
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...configured,
    design: { ...configured.design, ...(input as { design: object }).design } }))
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '补充人物，保留场景。', script: JSON.stringify(supplement), lastSeq: 10, running: false, finished: true, error: '' })) }
  const view = render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  await screen.findByRole('region', { name: '场景 工作室' })
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  expect(screen.getByRole('region', { name: '场景 工作室' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '人物 孩子' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  expect(saved.design?.assets[0]).toEqual(room)
  expect(saved.design?.assets[1]).toMatchObject({ id: 'actor_1', imagePrompt: '同一父亲的侧身定妆', voiceIdentity: '成年温厚自然中低音' })
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  expect(await screen.findByRole('region', { name: '场景 工作室' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '人物 孩子' })).toBeTruthy()
  expect(storyPort.send).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('checks the combined asset count before adopting an AI supplement', async () => {
  const port = setup()
  const assets = Array.from({ length: 40 }, (_, n) => ({ id: `prop_${n}`, kind: 'prop' as const, name: `器具${n}`, imagePrompt: '单件器具' }))
  port.readAssetDesign.mockResolvedValue({ ...state, design: { ...state.design!, assets } })
  const supplement = { ...state.design, assets: [{ kind: 'actor', name: '孩子', imagePrompt: '儿童独立定妆' }] }
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '补充一个角色。', script: JSON.stringify(supplement), lastSeq: 10, running: false, finished: true, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  await screen.findByRole('region', { name: '道具 器具39' })
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  expect(await screen.findByText(/合并后超过当前 40 项素材上限/)).toBeTruthy()
  expect(screen.getAllByRole('region', { name: /^道具 器具/ })).toHaveLength(40)
  expect(screen.queryByRole('region', { name: '人物 孩子' })).toBeNull()
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(storyPort.send).not.toHaveBeenCalled()
})
it.each([false, true])('keeps omitted generation choices on redesign; explicit reset=%s remains effective', async (reset) => {
  const port = setup()
  const existing = { ...state.design!.assets[0]!, imageModel: 'qwen-image-3.0-pro',
    imagePromptExtend: true, imageAspectRatio: '3:4' as const,
    references: [{ assetId: 'asset_ref', assetSha256: 'e'.repeat(64), purpose: '保留身份与服装', boxes: [] }] }
  const configured = { ...state, design: { ...state.design!, assets: [existing] } }
  port.readAssetDesign.mockResolvedValue(configured)
  port.saveAssetDesign.mockImplementation(async (input: unknown) => ({ ...configured,
    design: { ...configured.design, ...(input as { design: object }).design } }))
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  const changed = { ...state.design!, assets: [{ kind: 'actor', name: '父亲', imagePrompt: '同一人物侧面视角',
    ...(reset ? { imageModel: null, imagePromptExtend: false, imageAspectRatio: 'auto', references: [] } : {}) },
  { kind: 'prop', name: '父亲', imagePrompt: '刻有父亲二字的木牌' }] }
  fireEvent.change(screen.getByLabelText('素材设计数据'), { target: { value: JSON.stringify(changed) } })
  fireEvent.click(screen.getByRole('button', { name: '载入设计' }))
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
  const saved = await (port.saveAssetDesign.mock.results[0]!.value as Promise<AssetDesignState>)
  expect(saved.design?.assets[0]).toMatchObject({ id: 'actor_1', imagePrompt: '同一人物侧面视角',
    imageModel: reset ? null : existing.imageModel, imagePromptExtend: !reset,
    imageAspectRatio: reset ? 'auto' : '3:4', references: reset ? [] : existing.references })
  expect(saved.design?.assets[1]?.references).toBeUndefined()
  expect(saved.design?.assets[1]?.id).toBeUndefined()
  view.unmount(); port.readAssetDesign.mockResolvedValue(saved)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const actor = within(await screen.findByRole('region', { name: '人物 父亲' }))
  expect(actor.getByLabelText<HTMLSelectElement>('图片模型').value).toBe(reset ? '' : existing.imageModel)
  expect(actor.getByRole('button', { name: `参考与局部修改 · ${reset ? 0 : 1} 张图` })).toBeTruthy()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
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
    previewSceneLayout: vi.fn(async () => { throw new Error('unused') }),
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
it('shows the actual composition image input when no photographic reference is bound', async () => {
  const port = setup()
  const quoted = await port.quoteAssetImage()
  port.quoteAssetImage.mockResolvedValue({ ...quoted, references: [], compositionReference: {
    imageUrl: 'data:image/png;base64,eA==', sha256: 'f'.repeat(64), width: 1280, height: 720,
    objects: [],
  } } as Awaited<ReturnType<typeof port.quoteAssetImage>>)
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看生成费用' }))
  const quote = within(await screen.findByRole('region', { name: '确认图片生成' }))
  expect(quote.getByText('使用 0 张素材参考图和 1 张空间取景图生成新候选。')).toBeTruthy()
  expect(quote.getByRole('img', { name: '本次生成附带的空间取景图' }).getAttribute('src')).toBe('data:image/png;base64,eA==')
  expect(quote.queryByText('根据文字设计生成新候选。')).toBeNull()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
it('starts the next project catalog at page one without retaining previous project images', async () => {
  const read = vi.fn(async ({ projectId, page }: { projectId: string; page: number }) => ({
    projectId, page, pages: projectId === 'first' ? 2 : 1,
    items: [{ assetId: `${projectId}_${page}`, assetSha256: 'a'.repeat(64), label: `${projectId} 图 ${page}`,
      mediaType: 'reference_image' as const, browserUrl: '' }],
  }))
  const port = { ...setup(), referenceVideoAssets: read }, onChange = vi.fn()
  const view = render(<AssetImageReferences projectId="first" references={[]} port={port} onChange={onChange} disabled={false} />)
  await screen.findByRole('option', { name: 'first 图 1' })
  fireEvent.click(screen.getByRole('button', { name: '加载更多图片' }))
  await screen.findByRole('option', { name: 'first 图 2' })
  view.rerender(<AssetImageReferences projectId="second" references={[]} port={port} onChange={onChange} disabled={false} />)
  await screen.findByRole('option', { name: 'second 图 1' })
  expect(screen.queryByRole('option', { name: 'first 图 1' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'first 图 2' })).toBeNull()
  expect(read.mock.calls.at(-1)?.[0]).toEqual({ projectId: 'second', page: 1 })
  expect(onChange).not.toHaveBeenCalled()
})
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
    stylePack: { palette: ['水彩明度层次'] }, styleAdjustments: ['高饱和金属反射'],
    initialBrief: '人物设计：成年女官灰绿短袄。空间设定：南门西窗。' }
  const imageModels = [{ id: 'qwen-image-3.0-pro', name: 'Qwen-Image 3.0 Pro', maxReferences: 3, supportsBoxes: false }]
  port.readAssetDesign.mockResolvedValue({ ...state, creativeSettings, imageModels })
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: 0, running: false, finished: false, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('画面描述'), { target: { value: '保留当前未保存的服装设计' } })
  fireEvent.click(await screen.findByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledTimes(1) })
  expect(storyPort.send).toHaveBeenCalledWith(expect.any(String), expect.any(String), { projectId: 'p', episodeId: 'e', purpose: 'asset-design' })
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(creativeSettings))])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('保留当前未保存的服装设计')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('无人空场不等于空房')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('由导演决定信息密度与留白')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('qingmu_check_camera_geometry')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('visualIdentity 记录主体完整外观')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('哪个地标进入近景、哪些对象转到摄影机身后或被遮挡')])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(imageModels))])
  expect(storyPort.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('只查看图片或在文字中说保持一致，不会自动把原图送入生成模型')])
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

it('keeps technical fields collapsed without losing edits or triggering generation', async () => {
  const port = setup()
  render(<NativeAssetDesign {...scope} port={port} onGenerated={vi.fn()} />)
  const description = await screen.findByLabelText<HTMLTextAreaElement>('画面描述')
  const settings = description.closest('details')!
  expect(settings.open).toBe(false)
  expect(settings.querySelector('summary')?.textContent).toBe('调整人物 · 专业设置')
  settings.open = true
  fireEvent.change(description, { target: { value: '保留我的定妆修改' } })
  settings.open = false
  fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
  await waitFor(() => expect(port.saveAssetDesign).toHaveBeenCalledOnce())
  expect(port.saveAssetDesign.mock.calls[0]).toMatchObject([{ design: { assets: [{ imagePrompt: '保留我的定妆修改' }] } }])
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})


it.each(['matched', 'unknown-id', 'blank-prompt'] as const)('adopts reference-only native revisions only for a known existing asset: %s', async (mode) => {
  const port = setup()
  const references = [{ assetId: 'asset_ref', assetSha256: 'e'.repeat(64), purpose: '保留脸与服装，双手空置', boxes: [] }]
  const revision = { assets: [{ kind: 'actor', id: mode === 'unknown-id' ? 'actor_other' : 'actor_1', name: '父亲', references,
    ...(mode === 'blank-prompt' ? { imagePrompt: '' } : {}) }] }
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '', script: JSON.stringify(revision), lastSeq: 10, running: false, finished: true, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  if (mode === 'matched') {
    fireEvent.click(screen.getByRole('button', { name: '保存素材设计' }))
    await waitFor(() => { expect(port.saveAssetDesign).toHaveBeenCalledTimes(1) })
    expect(port.saveAssetDesign).toHaveBeenCalledWith(expect.objectContaining({ design: expect.objectContaining({
      assets: [expect.objectContaining({ ...state.design!.assets[0], references })], director: state.design!.director,
    }) }))
  } else {
    expect(await screen.findByText(/没有采用：素材设计缺少类型、名称或画面描述/)).toBeTruthy()
    expect(port.saveAssetDesign).not.toHaveBeenCalled()
  }
  expect(port.generateAssetImage).not.toHaveBeenCalled()
  expect(storyPort.send).not.toHaveBeenCalled()
})

it('refreshes removed media progress without replacing an unsaved design', async () => {
  const port = setup()
  port.readAssetImageRuns.mockResolvedValue({ ...scope, items: [{ taskId: 'task_1', entityId: 'actor_1', requestId: 'original', status: 'Succeeded', assetId: 'asset_1', errorCode: null }] })
  const onGenerated = vi.fn()
  const view = render(<NativeAssetDesign {...scope} port={port} onGenerated={onGenerated} libraryRefreshToken={0} />)
  await screen.findByText('图片已生成，可在下方素材库查看')
  fireEvent.change(screen.getByLabelText('画面描述'), { target: { value: '保留正在编辑的描述' } })
  port.readAssetImageRuns.mockResolvedValue({ ...scope, items: [] })
  view.rerender(<NativeAssetDesign {...scope} port={port} onGenerated={onGenerated} libraryRefreshToken={1} />)
  await waitFor(() => { expect(screen.queryByText('图片已生成，可在下方素材库查看')).toBeNull() })
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('保留正在编辑的描述')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

// An omitted derived prompt may be reused only while its subject stays unchanged.
it.each([false, true])('handles an incremental native identity update without silently reusing its old prompt (changed: %s)', async (changed) => {
  const port = setup()
  const candidate = { assets: [{ kind: 'actor', id: 'actor_1', name: '父亲',
    ...(changed ? { visualIdentity: '年长男子，深色长衫，白发' } : { voiceIdentity: '年长男声，厚实胸腔共鸣，沉稳慢速' }),
  }] }
  localStorage.setItem('qingmu.asset-design-session.v1:p:e', JSON.stringify({ sessionId: 'session_design', baseline: 0, submitted: true }))
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ text: '设计', script: JSON.stringify(candidate), lastSeq: 10, running: false, finished: true, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  await screen.findByLabelText('画面描述')
  fireEvent.click(await screen.findByRole('button', { name: '采用到素材卡片' }))
  if (changed) {
    expect(await screen.findByText(/主体设计已改变，但导演没有交付对应画面描述/)).toBeTruthy()
    expect(localStorage.getItem('qingmu.asset-design-draft.v1:p:e')).toBeNull()
  } else {
    expect(screen.getByLabelText<HTMLTextAreaElement>('声音身份').value).toBe('年长男声，厚实胸腔共鸣，沉稳慢速')
  }
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('真人定妆照')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it('authors a fresh project from its brief with no creative supplement', async () => {
  const port = setup()
  const brief = '现代乡镇诊所；主角为六十岁女医生，干练整洁；诊室明亮。'
  port.readAssetDesign.mockResolvedValue({ ...state, design: null, creativeSettings: { initialBrief: brief } })
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn<(sessionId: string, prompt: string) => Promise<void>>(async () => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: 0, running: false, finished: false, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledOnce() })
  const prompt = storyPort.send.mock.calls[0]?.[1]
  expect(prompt).toContain(brief)
  expect(prompt).toContain('创作补充是可选偏好，留空也必须完成全部专业设计')
  expect(prompt).toContain('character-asset、scene-asset、prop-asset')
  expect(screen.getByLabelText<HTMLTextAreaElement>('创作补充').value).toBe('')
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})

it.each([false, true])('sends a saved design index without treating it as approval and retains unsaved edits: %s', async (edited) => {
  const port = setup()
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn<(sessionId: string, prompt: string) => Promise<void>>(async () => {}),
    read: vi.fn(async () => ({ text: '', script: '', lastSeq: 0, running: false, finished: false, error: '' })) }
  render(<NativeAssetDesign {...scope} port={port} storyPort={storyPort} onGenerated={vi.fn()} />)
  const field = await screen.findByLabelText('画面描述')
  if (edited) fireEvent.change(field, { target: { value: '用户尚未保存的衣服修改' } })
  fireEvent.click(screen.getByRole('button', { name: '根据剧本设计素材' }))
  await waitFor(() => { expect(storyPort.send).toHaveBeenCalledOnce() })
  const prompt = storyPort.send.mock.calls[0]?.[1] ?? ''
  expect(prompt).toContain('not_established_by_persistence')
  expect(prompt).toContain('actor_1')
  if (!edited) expect(prompt).not.toContain('真人定妆照')
  expect(prompt.includes('用户尚未保存的衣服修改')).toBe(edited)
  expect(prompt).toContain(edited ? 'unsaved_local_draft' : 'saved_working_draft')
  expect(port.saveAssetDesign).not.toHaveBeenCalled()
  expect(port.generateAssetImage).not.toHaveBeenCalled()
})
