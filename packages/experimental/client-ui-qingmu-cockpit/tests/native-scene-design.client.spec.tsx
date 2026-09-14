// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeSceneDesign } from '../src/client/NativeSceneDesign.tsx'
import type { AssetDesignState, PlanningScene } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
const sha = 'a'.repeat(64)
const scene: PlanningScene = { sceneIndex: 1, title: '门口', actionDescription: '邀请来客进入', importSourceLineIds: ['line1'],
  dialogues: [{ sourceLineId: 'line1', character: '主人', line: '请进。' }] }
const basis: AssetDesignState = { schema: 'qingmu.asset-design-state.v1', projectId: 'p', episodeId: 'e',
  stateSha256: 'b'.repeat(64), scriptRevision: 1, scriptSha256: sha, script: { story: '全剧关系由试探到信任' },
  model: 'image-model', design: null, creativeSettings: { visualStyle: { prompt: '透明水彩' } } }
const shots = [{ title: '邀请', narrative: '允许接近', visual: '门内望向来客', action: '主人让出通道', durationSec: 6,
  dialogueLineIds: ['line1'], directorPlan: { selfContainedImagePrompt: true, editorialContext: '下段接窗外雨声', coveragePlan: '本段先中景后切近景', cameraMovement: '跟随后停稳', soundPlan: { ambience: '雨声持续' },
    dialoguePlan: [{ ...scene.dialogues[0], delivery: '犹豫后轻声' }] } }]
afterEach(() => { cleanup(); localStorage.clear() })
it.each([
  ['selfContainedImagePrompt', true], ['imageCamera', null], ['imageObjectStates', []], ['generationContext', 'Current scene only'],
] as const)('retains a native draft with misplaced %s instead of silently dropping its setting', async (key, value) => {
  const candidateShots = shots.map(shot => ({ ...shot, [key]: value }))
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots: candidateShots })
  localStorage.setItem('qingmu.scene-design-1-session.v1:p:e', JSON.stringify({ sessionId: 'existing', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const adopt = await screen.findByRole<HTMLButtonElement>('button', { name: '采用到分镜卡片' })
  await waitFor(() => { expect(adopt.disabled).toBe(false) })
  fireEvent.click(adopt)
  await screen.findByText(/没有采用：导演稿的首帧或继承设置放错层级/)
  expect(onAdopt).not.toHaveBeenCalled()
  expect(port.send).not.toHaveBeenCalled()
  expect(screen.getByText(text)).toBeTruthy()
})
it.each(['root-only', 'identical', 'conflict', 'malformed'] as const)('preserves dialogue delivery when the native candidate is %s', async (mode) => {
  const source = shots[0]!
  const { dialoguePlan, ...departments } = source.directorPlan
  const candidate = { ...source, directorPlan: mode === 'root-only' ? departments : source.directorPlan,
    dialoguePlan: mode === 'malformed' ? '轻声' : mode === 'conflict' ? [{ ...dialoguePlan[0], delivery: '喊叫' }] : dialoguePlan }
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots: [candidate] })
  localStorage.setItem('qingmu.scene-design-1-session.v1:p:e', JSON.stringify({ sessionId: 'existing', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const adopt = await screen.findByRole<HTMLButtonElement>('button', { name: '采用到分镜卡片' })
  await waitFor(() => { expect(adopt.disabled).toBe(false) })
  fireEvent.click(adopt)
  if (mode === 'conflict' || mode === 'malformed') {
    await screen.findByText(mode === 'conflict' ? /两份不同的对白表演/ : /对白表演格式无效/)
    expect(onAdopt).not.toHaveBeenCalled()
  } else {
    await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith(shots) })
  }
  expect(port.send).not.toHaveBeenCalled()
  expect(screen.getByText(text)).toBeTruthy()
})
it('sends the whole-film basis and scene to the native director, then adopts the full design without saving it', async () => {
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots })
  const port = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演设计本场分镜' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.change(screen.getByRole('textbox', { name: '本场导演要求' }), { target: { value: '上一稿动作太密，给递物和停顿留出真实时间；保留人物关系与原对白。' } })
  fireEvent.click(start)
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(1) })
  expect(port.send).toHaveBeenCalledWith(expect.any(String), expect.any(String), { projectId: 'p', episodeId: 'e', purpose: 'scene-design-1' })
  expect(port.send.mock.calls[0]?.slice(0, 2)[1]).toMatchSnapshot('new scene director request')
  expect(port.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(basis))])
  expect(port.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(scene))])
  expect(port.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('上一稿动作太密，给递物和停顿留出真实时间；保留人物关系与原对白。')])
  expect(port.send.mock.calls[0]?.slice(0, 2)).toEqual([expect.any(String), expect.stringContaining('qingmu_check_camera_geometry')])
  fireEvent.click(await screen.findByRole('button', { name: '采用到分镜卡片' }))
  await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith(shots) })
})
it.each([
  { sourceScriptSha256: 'c'.repeat(64), sceneIndex: 1, shots },
  { sourceScriptSha256: sha, sceneIndex: 2, shots },
  { sourceScriptSha256: sha, sceneIndex: 1, shots: [{ ...shots[0], dialogueLineIds: [] }] },
  { sourceScriptSha256: sha, sceneIndex: 1, shots: [shots[0], shots[0]] },
])('retains the original result when its source or dialogue coverage is wrong', async (candidate) => {
  const text = JSON.stringify(candidate)
  localStorage.setItem('qingmu.scene-design-1-session.v1:p:e', JSON.stringify({ sessionId: 'existing', baseline: 1, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  fireEvent.click(await screen.findByRole('button', { name: '采用到分镜卡片' }))
  expect(await screen.findByText(/没有采用：/)).toBeTruthy()
  expect(onAdopt).not.toHaveBeenCalled()
  expect(port.send).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '采用到分镜卡片' })).toBeTruthy()
})

it('does not use an asset design authored against an older script', async () => {
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn() }
  const oldDesign = { sourceScriptSha256: 'c'.repeat(64), assets: [], director: {
    visualStyle: '写实', tone: '温暖', lightingRules: '窗光', colorPalette: ['灰'],
    cameraGrammar: '平视', performanceRules: '自然', characterContinuityRules: '按剧本',
  } }
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => ({ ...basis, design: oldDesign }))} storyPort={port} disabled={false} onAdopt={vi.fn()} />)
  await screen.findByText('素材设计对应的剧本已变化，请先回素材页更新依据。')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '让导演设计本场分镜' }).disabled).toBe(true)
  expect(port.send).not.toHaveBeenCalled()
})

it('rejects an otherwise valid completed director draft after asset changes without script changes', async () => {
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots })
  localStorage.setItem('qingmu.scene-design-1-session.v1:p:e', JSON.stringify({ sessionId: 'existing', baseline: 1, submitted: true }))
  const readAssetDesign = vi.fn().mockResolvedValueOnce(basis).mockResolvedValue({ ...basis, stateSha256: 'd'.repeat(64) })
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={readAssetDesign} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const adopt = await screen.findByRole<HTMLButtonElement>('button', { name: '采用到分镜卡片' })
  await waitFor(() => { expect(adopt.disabled).toBe(false) })
  fireEvent.click(adopt)
  await screen.findByText(/没有采用：素材或创作设定已更新/)
  expect(onAdopt).not.toHaveBeenCalled()
  expect(port.send).not.toHaveBeenCalled()
  expect(screen.getByText(text)).toBeTruthy()
})

it('recovers a completed JSON-fenced director result without calling the model again', async () => {
  const body = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots })
  const text = '导演已完成本场设计。\n```json\n' + body + '\n```'
  localStorage.setItem('qingmu.scene-design-1-session.v1:p:e', JSON.stringify({ sessionId: 'original', baseline: 2, submitted: true }))
  const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ lastSeq: 30, running: false, finished: true, text, script: '', error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const adopt = await screen.findByRole<HTMLButtonElement>('button', { name: '采用到分镜卡片' })
  await waitFor(() => { expect(adopt.disabled).toBe(false) })
  fireEvent.click(adopt)
  await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith(shots) })
  expect(port.send).not.toHaveBeenCalled()
  expect(port.prepare).not.toHaveBeenCalled()
})

it.each(['missing', 'invalid', 'camera', 'opt-out'] as const)('keeps new-scene camera choices executable against its shared layout (%s)', async (mode) => {
  const imageCamera = mode === 'opt-out' ? null
    : { position: [0, 0, 1.5], target: [0, 3, 1], verticalFov: mode === 'invalid' ? 500 : 46 }
  const candidateShots = shots.map(shot => ({ ...shot, directorPlan: { ...shot.directorPlan, ...(mode === 'missing' ? {} : { imageCamera }) } }))
  const current: AssetDesignState = { ...basis, design: { sourceScriptSha256: sha,
    director: { visualStyle: '', tone: '', lightingRules: '', colorPalette: [], cameraGrammar: '', performanceRules: '', characterContinuityRules: '' },
    assets: [{ kind: 'scene', name: scene.title, imagePrompt: 'Doorway', sceneLayout: { basis: 'Authored', coordinateFrame: 'x/y ground, z up',
      objects: [{ id: 'door', label: 'Door', center: [0, 3, 1], size: [1, 0.1, 2], rotation: 0, color: '#884422' }] } }] } }
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: current.stateSha256,
    sceneIndex: 1, shots: candidateShots })
  const port = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => current)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演设计本场分镜' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '采用到分镜卡片' }))
  if (mode === 'missing' || mode === 'invalid') {
    await screen.findByText(/没有采用：/)
    expect(onAdopt).not.toHaveBeenCalled()
  } else await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith(candidateShots) })
})

it.each(['current', 'old-asset', 'wrong-script', 'changed-again'] as const)(
  'revalidates an explicitly edited old-session scene against current sources (%s)', async (mode) => {
    const key = 'qingmu.scene-design-1-session.v1:p:e'
    const request = { sessionId: 'retained', baseline: 1, submitted: true, sourceKey: 'old-source' }
    localStorage.setItem(key, JSON.stringify(request))
    const old = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: 'c'.repeat(64), sceneIndex: 1, shots })
    const port = { prepare: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({
      lastSeq: 10, running: false, finished: true, text: old, script: old, error: '',
    })) }
    const read = vi.fn().mockResolvedValueOnce(basis).mockResolvedValue(
      mode === 'changed-again' ? { ...basis, stateSha256: 'd'.repeat(64) } : basis)
    const onAdopt = vi.fn()
    render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
      readAssetDesign={read} storyPort={port} disabled={false} onAdopt={onAdopt} />)
    const adopt = await screen.findByRole<HTMLButtonElement>('button', { name: '采用到分镜卡片' })
    await waitFor(() => { expect(adopt.disabled).toBe(false) })
    fireEvent.click(adopt)
    await screen.findByText(/没有采用：创作依据或本页设计已改变/)
    expect(onAdopt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '编辑这份候选' }))
    const body = JSON.stringify({ sourceScriptSha256: mode === 'wrong-script' ? 'd'.repeat(64) : sha,
      sourceAssetStateSha256: mode === 'old-asset' ? 'c'.repeat(64) : basis.stateSha256, sceneIndex: 1,
      shots: shots.map(shot => ({ ...shot, visual: '按当前门窗重新安排的起始画面' })),
    })
    fireEvent.change(screen.getByLabelText('候选正文'), { target: { value: body } })
    fireEvent.click(screen.getByRole('button', { name: '按当前来源核对并采用编辑稿' }))
    if (mode === 'current') {
      await waitFor(() => { expect(onAdopt).toHaveBeenCalledExactlyOnceWith(JSON.parse(body).shots) })
      expect(screen.getByRole('status').textContent).toMatchSnapshot('edited scene source validation')
    } else {
      await screen.findByText(mode === 'old-asset' ? /没有采用：导演稿使用的素材/ : mode === 'wrong-script'
        ? /没有采用：设计来源与当前场景不一致/ : /没有采用：素材或创作设定已更新/)
      expect(onAdopt).not.toHaveBeenCalled()
    }
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual(request)
    expect(screen.getByText(old)).toBeTruthy()
    expect(port.send).not.toHaveBeenCalled()
  })
