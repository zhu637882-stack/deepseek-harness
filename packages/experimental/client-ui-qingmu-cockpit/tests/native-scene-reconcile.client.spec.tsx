// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AssetDesignState, ScenePlanningRequest, ScenePlanningResult, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { NativeStoryPort } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/story-draft'
import { NativeSceneReconcile } from '../src/client/NativeSceneReconcile.tsx'

const sha = 'a'.repeat(64), sourceSha = 'b'.repeat(64)
const initial: ScenePlanningState = {
  schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'p', episodeId: 'e', scriptRevision: 1, scriptSha256: sha,
  storyboard: { id: 'revision-1', version: 1, sourceHash: 'c'.repeat(64), status: 'Ready' }, planning: null, scenes: [],
  frameRequirements: [
    { id: 'f1', sceneId: 'room', title: '入门', frameNo: 1, imagePromptCn: '门前', directorPlan: { cameraMovement: '跟随入门', continuity: { end: '站在桌旁' } }, generationContextSource: { state: 'changed', sha256: sourceSha, changes: ['场景'] } },
    { id: 'f2', sceneId: 'room', title: '落座', frameNo: 2, imagePromptCn: '桌旁', directorPlan: { cameraMovement: '绕到侧面', continuity: { start: '站在桌旁', end: '坐在凳面' } }, generationContextSource: { state: 'untracked', sha256: sourceSha, changes: [] } },
    { id: 'f3', sceneId: 'street', title: '街外', frameNo: 3, imagePromptCn: '街道', directorPlan: { continuity: { start: '门外' } }, generationContextSource: { state: 'current', sha256: sourceSha, changes: [] } },
  ],
}
const basis: AssetDesignState = { schema: 'qingmu.asset-design-state.v1', projectId: 'p', episodeId: 'e',
  stateSha256: 'd'.repeat(64), scriptRevision: 1, scriptSha256: sha, script: { story: '来客进入房间，坐下谈话' }, model: 'image-model', design: null, creativeSettings: {} }
const changes = [
  { shotId: 'f1', imagePromptCn: '人站在门外，桌子靠北墙', directorPlan: { generationContext: '桌子靠北墙，门在南面', continuity: { start: '门外', end: '桌旁站立' } } },
  { shotId: 'f2', imagePromptCn: '人站桌旁，凳子在身后', directorPlan: { generationContext: '同一房间与北墙桌子', continuity: { start: '桌旁站立', end: '坐在凳面' } } },
]
const draft = { sceneId: 'room', sourceScriptSha256: sha, sourceStoryboardSha256: initial.storyboard!.sourceHash,
  sourceAssetStateSha256: basis.stateSha256, sourceIssues: [], shots: changes }
const batchKey = 'qingmu.scene-reconcile.v1:p:e:room'
function setup(candidate: unknown = draft, automatic = false, assetBasis = basis) {
  let state = structuredClone(initial)
  if (automatic) state = { ...state, canonicalStoryboard: { revision: 1, sourceHash: initial.storyboard!.sourceHash,
    shotCount: 3, shots: state.frameRequirements!, origin: 'automatic' } }
  const text = JSON.stringify(candidate)
  const storyPort = { prepare: vi.fn(async () => {}), send: vi.fn<NativeStoryPort['send']>(async () => {}),
    read: vi.fn(async () => ({ lastSeq: 10, running: false, finished: true, text, script: text, error: '' })) }
  const saved = new Map<string, ScenePlanningResult>()
  const port = {
    readAssetDesign: vi.fn(async () => assetBasis), readScenePlanning: vi.fn(async () => structuredClone(state)),
    saveScenePlanning: vi.fn(async (intent: ScenePlanningRequest) => {
      const existing = saved.get(intent.idempotencyKey)
      if (existing) return existing
      const request = intent.request
      if (request.action !== 'edit_requirements' && request.action !== 'edit_automatic') throw new Error('unexpected action')
      expect(request.expectedStoryboardRevision).toBe(state.storyboard!.version)
      expect(request.expectedStoryboardSha256).toBe(state.storyboard!.sourceHash)
      const version = state.storyboard!.version + 1
      const storyboard = { ...state.storyboard!, id: `revision-${version}`, version, sourceHash: String(version).repeat(64) }
      state = { ...state, storyboard }
      const result: ScenePlanningResult = { schema: 'jason.qingmu-scene-planning-result.v1', action: request.action,
        projectId: 'p', episodeId: 'e', idempotencyKey: intent.idempotencyKey, requestSha256: sha,
        commandReceiptId: `receipt-${version}`, eventId: `event-${version}`, providerCalls: 0, stageStarted: false, approvalGranted: false,
        shotId: request.shotId, storyboard }
      saved.set(intent.idempotencyKey, result)
      return result
    }),
  }
  const onSaved = vi.fn(async () => {})
  const mount = () => render(<NativeSceneReconcile state={structuredClone(initialWithMode())} sceneId="room" port={port} storyPort={storyPort} disabled={false} onSaved={onSaved} />)
  function initialWithMode() {
    return automatic ? { ...initial, canonicalStoryboard: state.canonicalStoryboard } as ScenePlanningState : initial
  }
  mount()
  return { port, storyPort, onSaved, saved, mount, changeState: (next: ScenePlanningState) => { state = next } }
}
async function loadDraft() {
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演统筹本场全部镜头' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '检查通过，载入整场待保存稿' }))
  return screen.findByRole('button', { name: '保存并接续本场全部设计' })
}
afterEach(() => { cleanup(); localStorage.clear() })

it.each([false, true])('coordinates a whole existing scene and saves through current frame revisions (automatic=%s)', async (automatic) => {
  const { port, storyPort, onSaved } = setup(draft, automatic)
  const save = await loadDraft()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(storyPort.send).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(String), { projectId: 'p', episodeId: 'e', purpose: 'scene-reconcile-room' })
  if (!automatic) expect(storyPort.send.mock.calls[0]?.[1]).toMatchSnapshot('whole scene reconciliation request')
  fireEvent.click(save)
  await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1) })
  expect(port.saveScenePlanning.mock.calls.map(([intent]) => intent.request)).toEqual(changes.map((change, index) => ({
    action: automatic ? 'edit_automatic' : 'edit_requirements', expectedScriptRevision: 1, expectedScriptSha256: sha,
    expectedStoryboardRevision: index + 1, expectedStoryboardSha256: index === 0 ? initial.storyboard!.sourceHash : '2'.repeat(64),
    expectedGenerationContextSourceSha256: sourceSha, ...change,
  })))
  expect(JSON.parse(localStorage.getItem(batchKey)!)).toMatchObject({ completed: 2 })
})

it('recovers an uncertain committed save using the identical intent after reload, without writing a second model draft', async () => {
  const { port, storyPort, saved, mount, onSaved } = setup()
  const save = await loadDraft()
  const original = port.saveScenePlanning.getMockImplementation()!
  port.saveScenePlanning.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('reply lost') })
  fireEvent.click(save)
  await screen.findByText(/reply lost/)
  const pending = JSON.parse(localStorage.getItem(batchKey)!).pending
  expect(saved.size).toBe(1)
  cleanup(); mount()
  fireEvent.click(await screen.findByRole('button', { name: '保存并接续本场全部设计' }))
  await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1) })
  expect(port.saveScenePlanning.mock.calls[1]![0]).toEqual(pending)
  expect(saved.size).toBe(2)
  expect(storyPort.send).toHaveBeenCalledTimes(1)
})

it('stops remaining saves on shared-source drift and retains already committed progress', async () => {
  const { port, changeState } = setup()
  const save = await loadDraft()
  const original = port.saveScenePlanning.getMockImplementation()!
  port.saveScenePlanning.mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    changeState({ ...initial, storyboard: result.storyboard, frameRequirements: initial.frameRequirements!.map(s => ({ ...s, generationContextSource: { state: 'changed', sha256: 'e'.repeat(64), changes: ['world'] } })) })
    return result
  })
  fireEvent.click(save)
  await screen.findByText(/已停止剩余保存/)
  expect(port.saveScenePlanning).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(batchKey)!)).toMatchObject({ completed: 1 })
  fireEvent.click(screen.getByRole('button', { name: '保留副本，放弃剩余保存' }))
  expect(localStorage.getItem(batchKey)).toBeNull()
  expect(JSON.parse(localStorage.getItem(`${batchKey}:retained`)!)).toMatchObject({ completed: 1 })
})

it.each([
  { ...draft, sourceIssues: ['世界说门在北墙，场景说门在南墙，来源尚待协调'] },
  { ...draft, shots: [changes[0]] },
  { ...draft, shots: [changes[1], changes[0]] },
  { ...draft, sourceAssetStateSha256: 'f'.repeat(64) },
])('retains a draft with unresolved sources or incomplete scene coverage without saving', async (candidate) => {
  const { port } = setup(candidate)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演统筹本场全部镜头' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '检查通过，载入整场待保存稿' }))
  await screen.findByText(/没有采用：/)
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(localStorage.getItem(batchKey)).toBeNull()
})

const layoutBasis: AssetDesignState = { ...basis, design: { sourceScriptSha256: sha,
  director: { visualStyle: '', tone: '', lightingRules: '', colorPalette: [], cameraGrammar: '', performanceRules: '', characterContinuityRules: '' },
  assets: [{ id: 'room', name: 'Room', kind: 'scene', imagePrompt: 'Room', sceneLayout: { basis: 'Authored estimate', coordinateFrame: 'x/y ground, z up',
    objects: [{ id: 'table', label: 'Table', center: [0, 2, 0.5], size: [1, 1, 1], rotation: 0, color: '#884422' }] } }] } }
it.each([undefined, { position: [0, 0, 1], target: [0, 0, 1], verticalFov: 46 }])('preserves a whole-scene draft whose executable camera choice is missing or invalid (%s)', async (imageCamera) => {
  const candidate = { ...draft, shots: changes.map(change => ({ ...change, directorPlan: { ...change.directorPlan,
    cameraMovement: 'A new angle appears only in prose', ...(imageCamera === undefined ? {} : { imageCamera }) } })) }
  const { port } = setup(candidate, false, layoutBasis)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: '让导演统筹本场全部镜头' })
  await waitFor(() => { expect(start.disabled).toBe(false) })
  fireEvent.click(start)
  fireEvent.click(await screen.findByRole('button', { name: '检查通过，载入整场待保存稿' }))
  await screen.findByText(/没有采用：/)
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(localStorage.getItem(batchKey)).toBeNull()
})
it('saves explicit shot cameras and the director’s intentional opt-out without changing motion design', async () => {
  const cameras = [{ position: [0, 0, 1.5], target: [0, 2, 1], verticalFov: 46, roll: 0 }, null]
  const candidate = { ...draft, shots: changes.map((change, index) => ({ ...change,
    directorPlan: { ...change.directorPlan, imageCamera: cameras[index], cameraMovement: 'Move with the actor after the starting frame.' } })) }
  const { port, onSaved } = setup(candidate, false, layoutBasis)
  fireEvent.click(await loadDraft())
  await waitFor(() => { expect(onSaved).toHaveBeenCalledOnce() })
  expect(port.saveScenePlanning.mock.calls.map(([intent]) => (intent.request as { directorPlan: object }).directorPlan))
    .toEqual(candidate.shots.map(shot => shot.directorPlan))
})

it('carries unresolved scene feedback to the same episode without adopting or saving the native draft', async () => {
  localStorage.setItem('qingmu.scene-reconcile-room-session.v1:p:e', JSON.stringify({ sessionId: 'original', baseline: 1, submitted: true }))
  const issues = [{ source: 'Shared room', issue: 'Door and table block the route', proposedFix: 'Review the common layout' }, 'Review target duration']
  const { port, storyPort } = setup({ ...draft, sourceIssues: issues })
  const feedback = await screen.findByRole('region', { name: '导演待核对问题' })
  expect(feedback.textContent).toContain('Door and table block the route')
  expect(feedback.textContent).toContain('Review target duration')
  expect(feedback.textContent).toMatchSnapshot('actionable scene feedback')
  const link = screen.getByRole('link', { name: '带着问题去素材设计' })
  expect(link.getAttribute('href')).toBe('?qingmuView=assets&qingmuProject=p&qingmuEpisode=e')
  document.addEventListener('click', (event) => { event.preventDefault() }, { once: true })
  fireEvent.click(link)
  expect(JSON.parse(localStorage.getItem('qingmu.scene-feedback.v1:p:e:room')!)).toMatchObject({
    projectId: 'p', episodeId: 'e', sceneId: 'room', scriptSha256: sha, assetSha256: basis.stateSha256,
    storyboardSha256: initial.storyboard!.sourceHash, issues: [expect.stringContaining('Review the common layout'), 'Review target duration'],
  })
  fireEvent.click(screen.getByRole('button', { name: '检查通过，载入整场待保存稿' }))
  await screen.findByText(/没有采用：导演指出来源仍有待核对问题/)
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(storyPort.send).not.toHaveBeenCalled()
  expect(localStorage.getItem(batchKey)).toBeNull()
})
