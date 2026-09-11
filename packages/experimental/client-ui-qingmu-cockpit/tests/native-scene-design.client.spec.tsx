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
  dialogueLineIds: ['line1'], directorPlan: { cameraMovement: '跟随后停稳', soundPlan: { ambience: '雨声持续' },
    dialoguePlan: [{ ...scene.dialogues[0], delivery: '犹豫后轻声' }] } }]
afterEach(() => { cleanup(); localStorage.clear() })
it('sends the whole-film basis and scene to the native director, then adopts the full design without saving it', async () => {
  const text = JSON.stringify({ sourceScriptSha256: sha, sourceAssetStateSha256: basis.stateSha256, sceneIndex: 1, shots })
  const port = { prepare: vi.fn(async () => {}), send: vi.fn(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const onAdopt = vi.fn()
  render(<NativeSceneDesign projectId="p" episodeId="e" scene={scene} scriptSha256={sha}
    readAssetDesign={vi.fn(async () => basis)} storyPort={port} disabled={false} onAdopt={onAdopt} />)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演设计本场分镜' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.click(start)
  await waitFor(() => { expect(port.send).toHaveBeenCalledTimes(1) })
  expect(port.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(basis))])
  expect(port.send.mock.calls[0]).toEqual([expect.any(String), expect.stringContaining(JSON.stringify(scene))])
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
