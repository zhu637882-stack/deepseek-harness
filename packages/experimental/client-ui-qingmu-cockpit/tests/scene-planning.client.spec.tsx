// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenePlanningWorkspace } from '../src/client/ScenePlanningWorkspace.tsx'
import type { DirectorProposalFreshnessResult, DirectorReplayProposal, ScenePlanningState, ScenePlanningResult, ScenePlanningRequest } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorContextBindingState, DirectorContextClientPort, DirectorObjectScope } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { QingmuHostSync, QingmuScenePlanningSavedMessage } from '../src/client/host-sync.ts'
import { directorConnectionFixture } from './director-connection-fixture.client.ts'

const state: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'project_1', episodeId: 'episode_1',
  scriptRevision: 1, scriptSha256: 'a'.repeat(64), storyboard: null, planning: null,
  scenes: [{ sceneIndex: 1, title: '雨夜', actionDescription: '开门', importSourceLineIds: ['line_1'],
    dialogues: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1' }] }] }
const unavailableDirectorProposal = () => vi.fn(async () => { throw new Error('Director replay is not part of this fixture') })
const unusedFreshness = () => vi.fn(async () => { throw new Error('Freshness is not part of this fixture') })
function replayBridge(contextSnapshotSha256 = 'd'.repeat(64)) {
  let bound: DirectorContextBindingState | null = null
  return {
    enter: vi.fn<DirectorContextClientPort['enter']>(async (_sessionId: string, scope: DirectorObjectScope) => {
      bound = { version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter' }
      return { status: 'current' as const, state: bound, changed: true, manualWorkAllowed: true as const }
    }),
    clear: vi.fn<DirectorContextClientPort['clear']>(async () => {
      bound = null
      return { status: 'cleared', state: null, changed: true, manualWorkAllowed: true }
    }),
    bindProposal: vi.fn(async (_sessionId: string, proposal: DirectorReplayProposal, _signal?: AbortSignal) => {
      if (bound === null) throw new Error('unbound')
      bound = { ...bound, proposal: {
        projectId: proposal.projectId, episodeId: proposal.episodeId, sceneId: proposal.sceneId, shotId: proposal.shotId,
        contextSnapshotSha256: proposal.inputSha256, methodPackageVersion: proposal.methodPackage.version,
        methodPackageSha256: proposal.methodPackage.methodPackageSha256, workOrderId: proposal.workOrder.workOrderId,
        workOrderSha256: proposal.workOrder.workOrderSha256, promptSha256: proposal.workOrder.promptSha256,
        proposalId: proposal.proposalId, proposalSha256: proposal.proposalSha256, outputSha256: proposal.outputSha256,
      }, transition: 'proposal_attached' }
      return { status: 'bound' as const, state: bound, manualWorkAllowed: true as const }
    }),
    recover: vi.fn(async (_sessionId: string, _signal?: AbortSignal) => bound === null
      ? { status: 'unbound' as const, manualWorkAllowed: true as const }
      : { status: 'current' as const, state: bound, manualWorkAllowed: true as const }),
  }
}
function replayProposal(shotId = 'shot_1'): DirectorReplayProposal {
  return { ...state, schema: 'qingmu.director-replay-proposal.v1', proposalId: `proposal_${shotId}`,
    sceneId: 'scene_1', shotId, proposalKind: 'DirectorProposal', stale: false, staleReasons: [], advisoryOnly: true,
    items: [{ id: 'narrative-focus', field: 'narrative', originalValue: '相遇', proposedValue: '相遇；明确本镜情绪落点。',
      impact: '只修改当前镜头草稿。' }], execution: { mode: 'deterministic_replay_fixture', providerResult: false,
      networkUsed: false, providerCalls: 0, costAmountCny: '0' }, sourceTime: '2026-08-29T00:00:00Z',
    inputSha256: 'd'.repeat(64), outputSha256: 'e'.repeat(64), proposalSha256: 'f'.repeat(64),
    formalQcInferred: false, selectionGranted: false, readyGranted: false, humanDecisionInferred: false,
    methodPackage: { version: '1.0.0', methodPackageSha256: '1'.repeat(64) }, workOrder: {
      workOrderId: 'work_order_1', workOrderSha256: '2'.repeat(64), promptSha256: '3'.repeat(64),
    } } as unknown as DirectorReplayProposal
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each([false, true])('saves editable department direction and retains it after disconnection (existing=%s)', async (existing) => {
  const directorPlan = {
    cameraMovement: '跟随进门', performance: '迟疑', continuity: { start: '手中拿着信', end: '信放在桌上', evidence: ['source_1'] },
    soundPlan: { ambience: '门外雨声', foley: '脚步', music: '此处留白', acoustics: { room: '木屋' } },
    dialoguePlan: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1', delivery: '轻声', emphasis: ['请'] }],
    artDirection: { era: '剧本指定', exceptions: ['来自未来的信件'] },
  }
  const shot = { title: '门口', narrative: '相遇', visual: '门内', action: '走向桌边', durationSec: 6, dialogueLineIds: ['line_1'], directorPlan }
  const current: ScenePlanningState = existing ? { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ ...shot, id: 'shot_1' }] } } : state
  if (!existing) localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify({ ...legacyLocalPlan('门口', true), shots: [shot] }))
  const port = { readScenePlanning: vi.fn(async () => current), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn<(request: ScenePlanningRequest) => Promise<ScenePlanningResult>>(async () => { throw new Error('disconnected') }), recoverScenePlanning: vi.fn() }
  const props = { ...current, port, onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} />)
  fireEvent.change(await screen.findByLabelText('运镜设计'), { target: { value: '随人物后退至桌边，再停下' } })
  fireEvent.change(screen.getByLabelText('本镜沿用的全片设定'), { target: { value: '雨夜木屋，门窗位置沿用全片设计；未来来信按剧本例外保留。' } })
  fireEvent.change(screen.getByLabelText('环境与空间声'), { target: { value: '雨声连续，门合上后变闷，台词期间仍在' } })
  fireEvent.change(screen.getByLabelText('配乐安排'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('对白 1 的语气与表演'), { target: { value: '重音落在请，迟疑后邀请' } })
  fireEvent.change(screen.getByLabelText('镜头结束状态'), { target: { value: '信仍在手中，人已到桌边' } })
  const expected = { ...directorPlan, generationContext: '雨夜木屋，门窗位置沿用全片设计；未来来信按剧本例外保留。', cameraMovement: '随人物后退至桌边，再停下',
    soundPlan: { ...directorPlan.soundPlan, ambience: '雨声连续，门合上后变闷，台词期间仍在', music: '' },
    dialoguePlan: [{ ...directorPlan.dialoguePlan[0], delivery: '重音落在请，迟疑后邀请' }],
    continuity: { ...directorPlan.continuity, end: '信仍在手中，人已到桌边' } }
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert')
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
  const request = port.saveScenePlanning.mock.calls[0]?.[0]
  expect(request?.request).toMatchObject(existing ? { action: 'edit', shotId: 'shot_1', shot: { ...shot, directorPlan: expected } }
    : { action: 'initialize', shots: [{ ...shot, directorPlan: expected }] })
  view.unmount(); render(<ScenePlanningWorkspace {...props} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('环境与空间声')).value).toBe(expected.soundPlan.ambience)
  expect(screen.getByLabelText('运镜设计').matches(':disabled')).toBe(true)
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
})
function revisedPlanningState(): ScenePlanningState {
  return { ...state, storyboard: { id: 'revision_2', version: 2, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ ...legacyLocalPlan('门口', false).shots[0]!, id: 'shot_1',
        directorPlan: { cameraMovement: '旧规划运镜', soundPlan: { music: '旧配乐', ambience: '旧雨声' } } }] },
    frameRequirements: [{ id: 'shot_1', frameNo: 1, title: '门口', imagePromptCn: '当前首帧', directorPlan: {
      generationContext: '门窗沿用剧本设定，人物在门内等候。', cameraMovement: '最新运镜',
      soundPlan: { music: '', ambience: '连续雨声', acoustics: { room: '木屋' } },
      customDepartment: { staging: ['门外', '门内'], exception: '未来来信' },
      dialoguePlan: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1', actorId: 'actor_1', delivery: '迟疑后轻声' }],
    } }] }
}
it.each([false, true])('edits current shooting direction instead of historical planning or clean browser cache (cached=%s)', async (cached) => {
  const current = revisedPlanningState()
  if (cached) localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify({
    ...legacyLocalPlan('缓存旧规划', false), shotIds: ['shot_1'],
  }))
  const port = { readScenePlanning: vi.fn(async () => current), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(async (_r: ScenePlanningRequest) => { throw new Error('disconnected') }), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...current} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  await waitFor(() => { expect(screen.getByLabelText<HTMLTextAreaElement>('运镜设计').value).toBe('最新运镜') })
  expect(screen.getByLabelText<HTMLTextAreaElement>('配乐安排').value).toBe('')
  expect(screen.getByLabelText<HTMLTextAreaElement>('本镜沿用的全片设定').value).toBe(current.frameRequirements![0]!.directorPlan!.generationContext)
  fireEvent.change(screen.getByLabelText('运镜设计'), { target: { value: '调整后的运镜' } })
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert')
  expect(port.saveScenePlanning.mock.calls[0]?.[0].request).toMatchObject({ action: 'edit', shotId: 'shot_1', applyDirectorPlan: true,
    shot: { directorPlan: { ...current.frameRequirements![0]!.directorPlan, cameraMovement: '调整后的运镜' } } })
  expect(current.planning!.shots[0]!.directorPlan!.cameraMovement).toBe('旧规划运镜')
})
it('refreshes clean direction after a native revision while preserving edits during a later refresh', async () => {
  let current = revisedPlanningState()
  const port = { readScenePlanning: vi.fn(async () => current), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const props = { ...state, port, onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorRevision="revision_2" />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('运镜设计')).value).toBe('最新运镜')
  current = { ...current, storyboard: { ...current.storyboard!, id: 'revision_3', version: 3 }, frameRequirements: [
    { ...current.frameRequirements![0]!, directorPlan: { cameraMovement: 'AI 新运镜', generationContext: '新的当前设定' } },
  ] }
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorRevision="revision_3" />)
  await waitFor(() => { expect(screen.getByLabelText<HTMLTextAreaElement>('运镜设计').value).toBe('AI 新运镜') })
  fireEvent.change(screen.getByLabelText('运镜设计'), { target: { value: '用户尚未保存的运镜' } })
  current = { ...current, storyboard: { ...current.storyboard!, id: 'revision_4', version: 4 }, frameRequirements: [
    { ...current.frameRequirements![0]!, directorPlan: { cameraMovement: '另一份服务端修改' } },
  ] }
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorRevision="revision_4" />)
  await waitFor(() => { expect(port.readScenePlanning).toHaveBeenCalledTimes(3) })
  expect(screen.getByLabelText<HTMLTextAreaElement>('运镜设计').value).toBe('用户尚未保存的运镜')
  expect(port.saveScenePlanning).not.toHaveBeenCalled(); expect(port.recoverScenePlanning).not.toHaveBeenCalled()
})
function automaticReadState(): ScenePlanningState {
  return { ...state, storyboard: { id: 'revision_10', version: 10, sourceHash: 'b'.repeat(64), status: 'Ready' },
    scenes: [{ sceneIndex: 0, title: '自动雨夜', actionDescription: '角色走进雨夜街道', dialogues: [
      { lineId: 'automatic_line_0', character: '林夏', line: '继续前进。' },
    ] }],
    canonicalStoryboard: { revision: 10, sourceHash: 'b'.repeat(64), shotCount: 10, origin: 'automatic' } }
}
function legacyLocalPlan(title: string, dirty: boolean, pending = false) {
  const shot = { title, narrative: '不要丢失', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }
  const base = { sceneIndex: 1, expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64),
    expectedStoryboardRevision: 0, expectedStoryboardSha256: null }
  return { activeIndex: 0, sceneIndex: 1, dirty, shotIds: [], base, shots: [shot],
    ...(pending ? { pending: { projectId: 'project_1', episodeId: 'episode_1', idempotencyKey: 'legacy-draft-1', request: {
      action: 'initialize', ...base, shots: [shot],
    } } } : {}) }
}
it('shows a canonical automatic storyboard as read-only without reviving the legacy planning editor', async () => {
  const automatic = automaticReadState()
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const onSelectShotId = vi.fn()
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={onSelectShotId} onUnsavedChange={vi.fn()} />)
  expect((await screen.findByRole('status', { name: '自动分镜已建立' })).textContent).toContain('青木已自动建立 10 个镜头')
  expect(screen.getByText(/旧场景规划不适用/)).toBeTruthy()
  expect(screen.getByText(/已有提示词、Take 与高级分镜/)).toBeTruthy()
  expect(screen.queryByText('本集已有分镜；此入口不覆盖已有对象，请使用当前导演工作区。')).toBeNull()
  expect(screen.queryByText('尚无可规划场景。请先到“剧本与资产”确认导入并保存剧本。')).toBeNull()
  expect(screen.queryByText('尚未建立真实镜头')).toBeNull()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(onSelectShotId).not.toHaveBeenCalled()
})
it('restores the visible automatic shot into the director selection on reload without a business write', async () => {
  const automatic = { ...automaticReadState(), canonicalStoryboard: {
    ...automaticReadState().canonicalStoryboard!, shots: [
      { id: 'automatic_1', frameNo: 1, title: '雨夜入口', imagePromptCn: '原首帧要求' },
      { id: 'automatic_6', frameNo: 6, title: '呼喊', imagePromptCn: '车旁' },
    ],
  } }
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1:automatic-frame', JSON.stringify({
    shotId: 'automatic_6', imagePromptCn: '车旁', dirty: false,
  }))
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const onSelectShotId = vi.fn()
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    canonicalDirectorScope={{ projectId: 'project_1', episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'automatic_1' }}
    onSelectShotId={onSelectShotId} onUnsavedChange={vi.fn()} />)
  expect((await screen.findByLabelText('自动分镜镜头') as HTMLSelectElement).value).toBe('automatic_6')
  expect(onSelectShotId).toHaveBeenCalledExactlyOnceWith('automatic_6')
  expect(port.saveScenePlanning).not.toHaveBeenCalled(); expect(port.recoverScenePlanning).not.toHaveBeenCalled()
})
it('saves one automatic shot first-frame requirement, rereads it, and never treats it as generation or approval', async () => {
  const automatic = { ...automaticReadState(), canonicalStoryboard: {
    ...automaticReadState().canonicalStoryboard!, shots: [
      { id: 'automatic_1', frameNo: 1, title: '雨夜入口', imagePromptCn: '原首帧要求' },
      { id: 'automatic_2', frameNo: 2, title: '街道近景', imagePromptCn: '原近景要求' },
    ],
  } }
  const current = { ...automatic, storyboard: { id: 'revision_11', status: 'Ready' as const, version: 11, sourceHash: 'd'.repeat(64) },
    canonicalStoryboard: { ...automatic.canonicalStoryboard, revision: 11, sourceHash: 'd'.repeat(64),
      shots: automatic.canonicalStoryboard.shots.map(shot => shot.id === 'automatic_2'
        ? { ...shot, imagePromptCn: '已保存的街道近景首帧' } : shot) } }
  const result: ScenePlanningResult = { schema: 'jason.qingmu-scene-planning-result.v1', action: 'edit_automatic',
    projectId: automatic.projectId, episodeId: automatic.episodeId, idempotencyKey: 'automatic-intent-1',
    requestSha256: 'c'.repeat(64), commandReceiptId: 'receipt_automatic_1', eventId: 'event_automatic_1',
    shotId: 'automatic_2', storyboard: current.storyboard, providerCalls: 0, stageStarted: false, approvalGranted: false }
  const port = {
    readScenePlanning: vi.fn().mockResolvedValueOnce(automatic).mockResolvedValueOnce(current),
    requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(async () => result), recoverScenePlanning: vi.fn() }
  const onCommitted = vi.fn(async () => {}), onSelectShotId = vi.fn(), onUnsavedChange = vi.fn()
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={onCommitted}
    onSelectShotId={onSelectShotId} onUnsavedChange={onUnsavedChange} />)
  const selector = await screen.findByLabelText('自动分镜镜头') as HTMLSelectElement
  fireEvent.change(selector, { target: { value: 'automatic_2' } })
  expect(onSelectShotId).toHaveBeenCalledExactlyOnceWith('automatic_2')
  const field = screen.getByLabelText('首帧画面要求') as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: '街道近景的低机位首帧' } })
  await waitFor(() => { expect(onUnsavedChange).toHaveBeenLastCalledWith(true) })
  expect(selector.disabled).toBe(true)
  expect(onSelectShotId).toHaveBeenCalledExactlyOnceWith('automatic_2')
  fireEvent.click(screen.getByRole('button', { name: '保存镜头设计' }))
  await waitFor(() => { expect(port.saveScenePlanning).toHaveBeenCalledOnce(); expect(port.readScenePlanning).toHaveBeenCalledTimes(2) })
  expect(port.saveScenePlanning).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
    action: 'edit_automatic', shotId: 'automatic_2', imagePromptCn: '街道近景的低机位首帧',
  }) }), expect.anything())
  expect(onCommitted).toHaveBeenCalledOnce()
  await waitFor(() => { expect(onUnsavedChange).toHaveBeenLastCalledWith(false) })
  expect(selector.value).toBe('automatic_2')
  expect(field.value).toBe('已保存的街道近景首帧')
  expect(screen.getByText(/不生成、不签收/)).toBeTruthy()
})
it.each(['完整首帧', ''])('keeps complete automatic direction across disconnection even without a still requirement (%s)', async (imagePromptCn) => {
  const directorPlan = revisedPlanningState().frameRequirements![0]!.directorPlan!
  const automatic = { ...automaticReadState(), canonicalStoryboard: { ...automaticReadState().canonicalStoryboard!,
    shots: [{ id: 'automatic_1', frameNo: 1, title: '门内', imagePromptCn, directorPlan }],
  } }
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(async (_r: ScenePlanningRequest) => { throw new Error('disconnected') }), recoverScenePlanning: vi.fn() }
  const props = { ...automatic, port, onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} />)
  fireEvent.change(await screen.findByLabelText('本镜沿用的全片设定'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('对白 1 的语气与表演'), { target: { value: '放轻音量，句末停顿' } })
  const savedImage = imagePromptCn ? '修改后的完整首帧' : ''
  if (imagePromptCn) fireEvent.change(screen.getByLabelText('首帧画面要求'), { target: { value: savedImage } })
  fireEvent.click(screen.getByRole('button', { name: '保存镜头设计' }))
  await screen.findByRole('alert')
  const expected = { ...directorPlan, generationContext: '', dialoguePlan: [
    { ...(directorPlan.dialoguePlan as Record<string, unknown>[])[0], delivery: '放轻音量，句末停顿' },
  ] }
  const request = port.saveScenePlanning.mock.calls[0]?.[0]
  expect(request?.request).toMatchObject({ action: 'edit_automatic', shotId: 'automatic_1',
    imagePromptCn: savedImage, directorPlan: expected })
  view.unmount(); render(<ScenePlanningWorkspace {...props} />)
  expect((await screen.findByLabelText<HTMLTextAreaElement>('对白 1 的语气与表演')).value).toBe('放轻音量，句末停顿')
  expect(screen.getByLabelText<HTMLTextAreaElement>('本镜沿用的全片设定').value).toBe('')
  expect(screen.getByLabelText('运镜设计').matches(':disabled')).toBe(true)
  expect(JSON.parse(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:automatic-frame')!).pending).toEqual(request)
  expect(port.saveScenePlanning).toHaveBeenCalledOnce(); expect(port.recoverScenePlanning).not.toHaveBeenCalled()
})
it('recovers an unknown automatic save against a newer current revision without resubmitting it', async () => {
  const latest = { ...automaticReadState(), storyboard: { id: 'revision_12', version: 12, sourceHash: 'f'.repeat(64), status: 'Ready' as const },
    canonicalStoryboard: { ...automaticReadState().canonicalStoryboard!, revision: 12, sourceHash: 'f'.repeat(64), shots: [
      { id: 'automatic_1', frameNo: 1, title: '雨夜入口', imagePromptCn: '当前首帧要求' },
    ] } }
  const request = { action: 'edit_automatic', expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64),
    expectedStoryboardRevision: 10, expectedStoryboardSha256: 'b'.repeat(64), shotId: 'automatic_1', imagePromptCn: '未知结果的首帧要求' }
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1:automatic-frame', JSON.stringify({
    shotId: 'automatic_1', imagePromptCn: request.imagePromptCn, dirty: true, pending: { projectId: 'project_1', episodeId: 'episode_1', idempotencyKey: 'automatic-unknown-1', request },
  }))
  const receipt: ScenePlanningResult = { schema: 'jason.qingmu-scene-planning-result.v1', action: 'edit_automatic',
    projectId: 'project_1', episodeId: 'episode_1', idempotencyKey: 'automatic-unknown-1', requestSha256: 'e'.repeat(64),
    commandReceiptId: 'receipt_automatic_2', eventId: 'event_automatic_2', shotId: 'automatic_1',
    storyboard: { id: 'revision_11', version: 11, sourceHash: 'd'.repeat(64), status: 'Ready' }, providerCalls: 0, stageStarted: false, approvalGranted: false }
  const port = { readScenePlanning: vi.fn().mockResolvedValue(latest), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(async () => receipt) }
  const onUnsavedChange = vi.fn()
  render(<ScenePlanningWorkspace {...latest} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={onUnsavedChange} />)
  await waitFor(() => { expect(onUnsavedChange).toHaveBeenLastCalledWith(true) })
  fireEvent.click(await screen.findByRole('button', { name: '读取同一保存回执' }))
  await waitFor(() => { expect(port.recoverScenePlanning).toHaveBeenCalledOnce() })
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it('rejects a same-revision automatic receipt with a different source hash and keeps its pending intent', async () => {
  const automatic = { ...automaticReadState(), canonicalStoryboard: {
    ...automaticReadState().canonicalStoryboard!, shots: [{ id: 'automatic_1', frameNo: 1, title: '雨夜入口', imagePromptCn: '原首帧要求' }],
  } }
  const current = { ...automatic, storyboard: { ...automatic.storyboard, version: 11, sourceHash: 'e'.repeat(64) },
    canonicalStoryboard: { ...automatic.canonicalStoryboard!, revision: 11, sourceHash: 'e'.repeat(64) } }
  const receipt: ScenePlanningResult = { schema: 'jason.qingmu-scene-planning-result.v1', action: 'edit_automatic',
    projectId: 'project_1', episodeId: 'episode_1', idempotencyKey: 'mismatch-receipt-1', requestSha256: 'c'.repeat(64),
    commandReceiptId: 'receipt_mismatch_1', eventId: 'event_mismatch_1', shotId: 'automatic_1',
    storyboard: { id: 'revision_11', version: 11, sourceHash: 'd'.repeat(64), status: 'Ready' }, providerCalls: 0, stageStarted: false, approvalGranted: false }
  const port = {
    readScenePlanning: vi.fn().mockResolvedValueOnce(automatic).mockResolvedValueOnce(current),
    requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(async () => receipt), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('首帧画面要求'), { target: { value: '新首帧要求' } })
  fireEvent.click(screen.getByRole('button', { name: '保存镜头设计' }))
  await screen.findByRole('alert')
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:automatic-frame')).toContain('pending')
})
it.each([undefined, [], [{ id: 'other_shot', frameNo: 2, title: '另一镜', imagePromptCn: '' }]])(
  'cannot send to a bound shot when automatic visible rows are missing or disagree: %j', async (shots) => {
    const baseline = automaticReadState()
    const automatic = { ...baseline, canonicalStoryboard: {
      ...baseline.canonicalStoryboard!, ...(shots === undefined ? {} : { shots }),
    } }
    const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
      checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
    const bridge = replayBridge()
    const transport = directorConnectionFixture()
    const native = { connection: transport.source, activate: vi.fn(), prompt: vi.fn(async () => {}) }
    const scope = { projectId: automatic.projectId, episodeId: automatic.episodeId, sceneId: 'canonical_scene', shotId: 'canonical_1' }
    render(<ScenePlanningWorkspace {...automatic} port={port} directorBridge={bridge} directorSessionId="session_1"
      canonicalDirectorScope={scope} directorConnection={transport.source} nativeDirectorSession={native}
      onCommitted={vi.fn(async () => {})} onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
    await screen.findByText('最近一次镜头上下文同步成功；不代表生成或审核通过。')
    fireEvent.change(screen.getByLabelText('导演要求'), { target: { value: '修改这句台词' } })
    const send = screen.getByRole('button', { name: '发送给当前导演' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(native.prompt).not.toHaveBeenCalled()
    expect(port.saveScenePlanning).not.toHaveBeenCalled()
  })
it.each(['assistant', 'planning'] as const)('retains typed direction while entering the project session (%s)', async (presentation) => {
  const automatic = { ...automaticReadState(), canonicalStoryboard: { ...automaticReadState().canonicalStoryboard!, shots: [
    { id: 'automatic_1', frameNo: 1, title: '入口', imagePromptCn: '开门' },
  ] } }
  const port = { readScenePlanning: vi.fn(async () => automatic), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness() }
  const transport = directorConnectionFixture(), bridge = replayBridge()
  const native = { connection: transport.source, activate: vi.fn(), prompt: vi.fn(async () => {}) }
  const scope = { projectId: 'project_1', episodeId: 'episode_1', sceneId: 'canonical_scene', shotId: 'automatic_1' }
  const props = { ...automatic, presentation, port, directorBridge: bridge,
    directorConnection: transport.source, nativeDirectorSession: native, canonicalDirectorScope: scope,
    onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} />)
  await screen.findByRole('textbox', { name: '导演要求' })
  // Let planning load its visible shot before typing, while the native session is still disconnected.
  if (presentation === 'planning') await screen.findByLabelText('自动分镜镜头')
  fireEvent.change(screen.getByLabelText('导演要求'), { target: { value: '保留门窗位置，人物走向桌边' } })
  expect(screen.getByRole('button', { name: '发送给当前导演' })).toHaveProperty('disabled', true)
  view.rerender(<ScenePlanningWorkspace {...props} directorSessionId="session-qingmu-director-project_1" />)
  await waitFor(() => expect(screen.getByRole('button', { name: '发送给当前导演' })).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('导演要求')).toHaveProperty('value', '保留门窗位置，人物走向桌边')
  expect(native.prompt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '发送给当前导演' }))
  await waitFor(() => expect(native.prompt).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sessionId: 'session-qingmu-director-project_1', scope }),
    '保留门窗位置，人物走向桌边', expect.any(AbortSignal)))
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it('uses the existing native composer inside shooting without consuming another shot planning draft', async () => {
  const automatic = { ...automaticReadState(), canonicalStoryboard: { ...automaticReadState().canonicalStoryboard!, shots:[
    { id:'automatic_1', frameNo:1, title:'入口', imagePromptCn:'开门' },
    { id:'automatic_6', frameNo:6, title:'车旁', imagePromptCn:'原画面' },
  ] } }
  const key = 'qingmu.scene-planning.v1:project_1:episode_1:automatic-frame'
  const retained = JSON.stringify({ shotId:'automatic_6', imagePromptCn:'未保存要求', dirty:true })
  localStorage.setItem(key, retained)
  const port = { readScenePlanning:vi.fn(async () => automatic), saveScenePlanning:vi.fn(), recoverScenePlanning:vi.fn(),
    requestDirectorProposal:unavailableDirectorProposal(), checkDirectorProposalFreshness:unusedFreshness() }
  const transport = directorConnectionFixture(), bridge = replayBridge()
  const native = { connection:transport.source, activate:vi.fn(), prompt:vi.fn(async () => {}) }
  const scope = { projectId:'project_1', episodeId:'episode_1', sceneId:'canonical_scene', shotId:'automatic_1' }
  const onSelectShotId = vi.fn()
  const props = { ...automatic, presentation:'assistant' as const, port, directorBridge:bridge, directorSessionId:'session_1',
    directorConnection:transport.source, nativeDirectorSession:native, canonicalDirectorScope:scope,
    onCommitted:vi.fn(async () => {}), onSelectShotId, onUnsavedChange:vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} />)
  fireEvent.change(screen.getByLabelText('导演要求'), { target:{ value:'把对白改得更自然' } })
  await waitFor(() => expect(screen.getByRole('button',{ name:'发送给当前导演' })).toHaveProperty('disabled',false))
  expect(onSelectShotId).not.toHaveBeenCalled()
  expect(localStorage.getItem(key)).toBe(retained)
  expect(screen.queryByLabelText('自动分镜镜头')).toBeNull()
  expect(native.prompt).not.toHaveBeenCalled(); expect(native.activate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{ name:'发送给当前导演' }))
  await waitFor(() => expect(native.prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scope }), '把对白改得更自然', expect.any(AbortSignal)))
  expect(port.saveScenePlanning).not.toHaveBeenCalled(); expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={{ ...scope,shotId:'not_in_storyboard' }} />)
  expect(screen.getByRole('button',{ name:'发送给当前导演' })).toHaveProperty('disabled',true)
  expect(bridge.clear).toHaveBeenCalled()
})
it('binds canonical shot selection to the current session without opening the legacy planner', async () => {
  const automatic = automaticReadState()
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const bridge = replayBridge()
  const first = { projectId: automatic.projectId, episodeId: automatic.episodeId, sceneId: 'canonical_scene', shotId: 'canonical_1' }
  const second = { ...first, shotId: 'canonical_2' }
  const props = { ...automatic, port, directorBridge: bridge, directorSessionId: 'session_1',
    onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorScope={first} />)
  await waitFor(() => { expect(bridge.enter).toHaveBeenLastCalledWith('session_1', first, expect.any(AbortSignal), expect.any(String)) })
  expect(await screen.findByText('最近一次镜头上下文同步成功；不代表生成或审核通过。')).toBeTruthy()
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={second} />)
  await waitFor(() => { expect(bridge.enter).toHaveBeenLastCalledWith('session_1', second, expect.any(AbortSignal), expect.any(String)) })
  view.rerender(<ScenePlanningWorkspace {...props} directorSessionId="session_2" canonicalDirectorScope={second} />)
  await waitFor(() => { expect(bridge.enter).toHaveBeenLastCalledWith('session_2', second, expect.any(AbortSignal), expect.any(String)) })
  const lastOwner = vi.mocked(bridge.enter).mock.calls.at(-1)?.[3]
  view.rerender(<ScenePlanningWorkspace {...props} directorSessionId="session_2" canonicalDirectorScope={null} />)
  await waitFor(() => { expect(bridge.clear).toHaveBeenLastCalledWith('session_2', second, lastOwner) })
  expect(screen.queryByRole('button', { name: '确认保存规划' })).toBeNull()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  expect(port.requestDirectorProposal).not.toHaveBeenCalled()
})
it('refreshes the same canonical shot when its source revision changes and clears its lease on unmount', async () => {
  const automatic = automaticReadState()
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const bridge = replayBridge()
  const scope = { projectId: automatic.projectId, episodeId: automatic.episodeId, sceneId: 'canonical_scene', shotId: 'canonical_1' }
  const props = { ...automatic, port, directorBridge: bridge, directorSessionId: 'session_1', canonicalDirectorScope: scope,
    onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorRevision="revision1" />)
  await waitFor(() => { expect(bridge.enter).toHaveBeenCalledOnce() })
  const owner1 = bridge.enter.mock.calls[0]?.[3]
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorRevision="revision2" />)
  await waitFor(() => { expect(bridge.enter).toHaveBeenCalledTimes(2) })
  expect(bridge.clear).toHaveBeenLastCalledWith('session_1', scope, owner1)
  const owner2 = bridge.enter.mock.calls[1]?.[3]
  expect(owner2).not.toBe(owner1)
  view.unmount()
  expect(bridge.clear).toHaveBeenLastCalledWith('session_1', scope, owner2)
})
it('rebinds after reconnect or explicit refresh without reviving stale replies or mutating business data', async () => {
  const automatic = automaticReadState()
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const bridge = replayBridge()
  const transport = directorConnectionFixture()
  const scope = { projectId: automatic.projectId, episodeId: automatic.episodeId, sceneId: 'canonical_scene', shotId: 'canonical_1' }
  const props = { ...automatic, port, directorBridge: bridge, directorSessionId: 'session_1', canonicalDirectorScope: scope,
    directorConnection: transport.source, onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} directorRefresh={0} />)
  await screen.findByText('d'.repeat(64))
  const firstOwner = bridge.enter.mock.calls[0]?.[3]
  let finish!: (value: Awaited<ReturnType<DirectorContextClientPort['enter']>>) => void
  bridge.enter.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  view.rerender(<ScenePlanningWorkspace {...props} directorRefresh={1} />)
  await screen.findByText('正在核对当前镜头上下文…')
  const clearsBeforeOffline = bridge.clear.mock.calls.length
  act(() => { transport.publish(false) })
  await screen.findByText('导演助理暂不可用；人工编辑与保存不受影响。')
  expect(bridge.clear).toHaveBeenCalledTimes(clearsBeforeOffline)
  await act(async () => { finish({ status: 'current', changed: true, manualWorkAllowed: true, state: {
    version: 1, binding: { scope, contextSnapshotSha256: 'e'.repeat(64) }, proposal: null, transition: 'enter',
  } }) })
  expect(screen.queryByText('e'.repeat(64))).toBeNull()
  act(() => { transport.publish(true) })
  await screen.findByText('d'.repeat(64))
  expect(bridge.enter).toHaveBeenCalledTimes(3)
  expect(bridge.enter.mock.calls[2]?.[3]).not.toBe(firstOwner)
  expect(port.saveScenePlanning).not.toHaveBeenCalled(); expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  expect(port.requestDirectorProposal).not.toHaveBeenCalled()
})
it('preserves the same unsaved planning editor across connection generations', async () => {
  const transport = directorConnectionFixture()
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...state} port={port} directorConnection={transport.source}
    onCommitted={vi.fn(async () => {})} onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '建立本场镜头' }))
  const field = screen.getByLabelText('镜头名称') as HTMLInputElement
  fireEvent.change(field, { target: { value: '我未保存的分镜' } })
  act(() => { transport.publish(false) })
  act(() => { transport.publish(true) })
  expect(screen.getByLabelText('镜头名称')).toBe(field)
  expect(field.value).toBe('我未保存的分镜')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it('hides the old context SHA during a canonical switch and rejects late binding responses', async () => {
  const automatic = automaticReadState()
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const bridge = replayBridge()
  const first = { projectId: automatic.projectId, episodeId: automatic.episodeId, sceneId: 'canonical_scene', shotId: 'canonical_1' }
  const second = { ...first, shotId: 'canonical_2' }
  const third = { ...first, shotId: 'canonical_3' }
  const props = { ...automatic, port, directorBridge: bridge, directorSessionId: 'session_1',
    onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorScope={first} />)
  expect(await screen.findByText('d'.repeat(64))).toBeTruthy()
  let finish!: (result: Awaited<ReturnType<DirectorContextClientPort['enter']>>) => void
  const pending = new Promise<Awaited<ReturnType<DirectorContextClientPort['enter']>>>((resolve) => { finish = resolve })
  vi.mocked(bridge.enter).mockReturnValueOnce(pending).mockResolvedValueOnce({
    status: 'unavailable', state: null, changed: true, reason: 'context_unavailable', manualWorkAllowed: true,
  })
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={second} />)
  expect(await screen.findByText('正在核对当前镜头上下文…')).toBeTruthy()
  expect(screen.queryByText('d'.repeat(64))).toBeNull()
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={third} />)
  expect(await screen.findByText('导演助理暂不可用；人工编辑与保存不受影响。')).toBeTruthy()
  await act(async () => { finish({ status: 'current', changed: true, manualWorkAllowed: true, state: {
    version: 1, binding: { scope: second, contextSnapshotSha256: 'e'.repeat(64) }, proposal: null, transition: 'switch',
  } }); await pending })
  expect(screen.queryByText('e'.repeat(64))).toBeNull()
  expect(screen.getByText(`${third.sceneId} / ${third.shotId}`)).toBeTruthy()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it('retains a bounded legacy draft when a canonical automatic storyboard supersedes it, without recovery or save', async () => {
  const automatic = automaticReadState()
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify(legacyLocalPlan('保留的旧规划', true, true)))
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  expect(await screen.findByRole('status', { name: '自动分镜已建立' })).toBeTruthy()
  await waitFor(() => { expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toBeNull() })
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input')).toContain('保留的旧规划')
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input')).not.toContain('legacy-draft-1')
  expect(screen.getByText(/已保留旧规划输入副本/)).toBeTruthy()
  expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it.each([
  ['clean local draft', false, false],
  ['dirty local draft', true, false],
  ['pending local draft', true, true],
])('retains a bounded %s and clears the active editor without any command', async (_label, dirty, pending) => {
  const automatic = automaticReadState()
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify(legacyLocalPlan('可恢复文字', dirty, pending)))
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  await waitFor(() => { expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toBeNull() })
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input')).toContain('可恢复文字')
  expect(port.recoverScenePlanning).not.toHaveBeenCalled(); expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it.each([
  ['malformed', '{"shots":"not-an-array"}'],
  ['oversized', JSON.stringify(legacyLocalPlan('超大草稿', true)).replace('不要丢失', 'x'.repeat(100000))],
])('does not replace a valid retained input with %s active browser data', async (_label, active) => {
  const automatic = automaticReadState()
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input', JSON.stringify(legacyLocalPlan('先存副本', true)))
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', active)
  const port = { readScenePlanning: vi.fn(async () => automatic), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const first = render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  await waitFor(() => { expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toBeNull() })
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input')).toContain('先存副本')
  first.unmount()
  render(<ScenePlanningWorkspace {...automatic} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  expect(await screen.findByText(/先存副本/)).toBeTruthy()
  expect(port.recoverScenePlanning).not.toHaveBeenCalled(); expect(port.saveScenePlanning).not.toHaveBeenCalled()
})
it('preserves text and original intent across double-click, disconnect and remount without resubmission', async () => {
  const port = { readScenePlanning: vi.fn(async () => state),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(async () => { throw new Error('disconnected') }),
    recoverScenePlanning: vi.fn(async () => { throw new Error('404 planning_receipt_not_found') }) }
  const props = { ...state, port, onUnsavedChange: vi.fn(), onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn() }
  const first = render(<ScenePlanningWorkspace {...props} />)
  fireEvent.click(await screen.findByText('建立本场镜头'))
  fireEvent.change(screen.getByLabelText('叙事目的'), { target: { value: '用户填写的相遇意图' } })
  fireEvent.click(screen.getByText('预览保存影响'))
  fireEvent.click(screen.getByText('确认保存规划'))
  fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert')
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
  first.unmount()
  render(<ScenePlanningWorkspace {...props} />)
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('用户填写的相遇意图')
  await waitFor(() => { expect(port.readScenePlanning).toHaveBeenCalledTimes(2) })
  fireEvent.click(screen.getByText('读取恢复'))
  await waitFor(() => { expect(port.recoverScenePlanning).toHaveBeenCalledOnce() })
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
  expect(await screen.findByText('重试原保存')).toBeTruthy()
})

it('rejects a persisted cross-scope intent before any recover or save RPC', async () => {
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify({
    sceneIndex: 1,
    shots: [{ title: '错误范围', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }],
    base: { sceneIndex: 1, expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64),
      expectedStoryboardRevision: 0, expectedStoryboardSha256: null },
    shotIds: [], dirty: true,
    pending: { projectId: 'project_other', episodeId: 'episode_other', idempotencyKey: 'intent_other', request: {
      action: 'initialize', sceneIndex: 1, expectedScriptRevision: 1, expectedScriptSha256: 'a'.repeat(64),
      expectedStoryboardRevision: 0, expectedStoryboardSha256: null,
      shots: [{ title: '错误范围', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }],
    } },
  }))
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...state} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  expect(await screen.findByText(/已拒绝损坏或跨作用域的恢复标记/)).toBeTruthy()
  expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toBeNull()
})

it('rejects a persisted edit for a non-canonical Shot before any RPC', async () => {
  const canonical: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ id: 'shot_1', title: '门口', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }] } }
  const shot = { title: '错误镜头', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: [] }
  localStorage.setItem('qingmu.scene-planning.v1:project_1:episode_1', JSON.stringify({
    sceneIndex: 1, shots: [shot], base: { sceneIndex: 1, expectedScriptRevision: 1,
      expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 1, expectedStoryboardSha256: 'b'.repeat(64) },
    shotIds: ['shot_other'], dirty: true,
    pending: { projectId: 'project_1', episodeId: 'episode_1', idempotencyKey: 'intent_other', request: {
      action: 'edit', shotId: 'shot_other', shot, sceneIndex: 1, expectedScriptRevision: 1,
      expectedScriptSha256: 'a'.repeat(64), expectedStoryboardRevision: 1, expectedStoryboardSha256: 'b'.repeat(64),
    } },
  }))
  const port = { readScenePlanning: vi.fn(async () => canonical), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...canonical} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  expect(await screen.findByText(/已拒绝损坏或跨作用域的恢复标记/)).toBeTruthy()
  expect(port.recoverScenePlanning).not.toHaveBeenCalled()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})

it('ignores a late committed response after leaving the scope and retains the durable intent', async () => {
  let resolve!: (result: ScenePlanningResult) => void
  const port = { readScenePlanning: vi.fn(async () => state),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(() => new Promise<ScenePlanningResult>((r) => { resolve = r })), recoverScenePlanning: vi.fn() }
  const onCommitted = vi.fn(async () => {}), onSelectShotId = vi.fn()
  const view = render(<ScenePlanningWorkspace {...state} port={port} onCommitted={onCommitted}
    onSelectShotId={onSelectShotId} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('建立本场镜头'))
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  view.unmount()
  await act(async () => { resolve({} as ScenePlanningResult) })
  expect(onCommitted).not.toHaveBeenCalled(); expect(onSelectShotId).not.toHaveBeenCalled()
  expect(port.readScenePlanning).toHaveBeenCalledOnce()
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toContain('idempotencyKey')
})

it.each(['422 planning_no_effect', '409 storyboard_revision_conflict'])('unlocks retained text only after a missing receipt and fresh source read: %s', async (failure) => {
  const port = { readScenePlanning: vi.fn(async () => state),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(async () => { throw new Error(failure) }),
    recoverScenePlanning: vi.fn(async () => { throw new Error('404 planning_receipt_not_found') }) }
  render(<ScenePlanningWorkspace {...state} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('建立本场镜头'))
  fireEvent.change(screen.getByLabelText('叙事目的'), { target: { value: '不能丢失的文字' } })
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert')
  const stored = () => JSON.parse(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')!) as
    { pending: { idempotencyKey: string } }
  const original = stored().pending
  fireEvent.click(screen.getByText('读取恢复'))
  fireEvent.click(await screen.findByText('保留文字，按最新分镜重新准备'))
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('不能丢失的文字')
  expect(screen.getByLabelText('叙事目的').closest('fieldset')!.disabled).toBe(false)
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await waitFor(() => { expect(port.saveScenePlanning).toHaveBeenCalledTimes(2) })
  expect(stored().pending.idempotencyKey).not.toBe(original.idempotencyKey)
})

it('preserves a competing initialization as a local copy before explicitly loading the winner, without an edit or retry', async () => {
  const winner: ScenePlanningState = { ...state, storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ id: 'shot_1', title: '另一份已保存镜头', narrative: '', visual: '', action: '', durationSec: 3, dialogueLineIds: ['line_1'] }] } }
  const port = { readScenePlanning: vi.fn().mockResolvedValueOnce(state).mockResolvedValue(winner),
    requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(async () => { throw new Error('409 planning_storyboard_conflict') }),
    recoverScenePlanning: vi.fn(async () => { throw new Error('404 planning_receipt_not_found') }) }
  render(<ScenePlanningWorkspace {...state} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('建立本场镜头'))
  fireEvent.change(screen.getByLabelText('叙事目的'), { target: { value: '竞争请求中的原始文字' } })
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert'); fireEvent.click(screen.getByText('读取恢复'))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(await screen.findByText('保留输入副本，载入已存在镜头'))
  expect(screen.getByLabelText<HTMLTextAreaElement>('镜头名称').value).toBe('另一份已保存镜头')
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1:retained-input')).toContain('竞争请求中的原始文字')
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
})

it('keeps replay advice explicit and advisory until the human uses the existing save chain', async () => {
  const savedState: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ id: 'shot_1', title: '门口', narrative: '相遇', visual: '雨夜门口', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] }] } }
  const proposal = replayProposal()
  const port = { readScenePlanning: vi.fn(async () => savedState),
    requestDirectorProposal: vi.fn(async () => proposal),
    checkDirectorProposalFreshness: vi.fn(async () => ({ fresh: true } as unknown as DirectorProposalFreshnessResult)),
    saveScenePlanning: vi.fn(async () => { throw new Error('disconnected after submit') }),
    recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...savedState} port={port} directorBridge={replayBridge()} directorSessionId="session_1"
    onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('读取演练建议'))
  expect(await screen.findByText('建议只作创意参考，尚未成为正式质检、参考选择、Ready 或人工决定。人工编辑始终可用。')).toBeTruthy()
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('相遇')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByText('采用到草稿'))
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('相遇；明确本镜情绪落点。')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('预览保存影响'))
  fireEvent.click(screen.getByText('确认保存规划'))
  await waitFor(() => { expect(port.saveScenePlanning).toHaveBeenCalledOnce() })
  expect(port.requestDirectorProposal).toHaveBeenCalledOnce()
  expect(port.checkDirectorProposalFreshness).toHaveBeenCalledOnce()
  expect(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')).toContain('pendingAdvisory')
})

it('requires an explicit paid confirmation and shows real Provider output separately without editing', async () => {
  const savedState: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ id: 'shot_1', title: '门口', narrative: '相遇', visual: '雨夜门口', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] }] } }
  const issue = vi.fn(async (_request: unknown) => ({
    schema: 'jason.qingmu-director-provider-work-order.v1' as const,
    workOrderId: 'work_order_paid_1', generationTaskId: 'task_paid_1', projectId: 'project_1',
    episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1', provider: 'deepseek-official',
    model: 'deepseek-v4-pro', inputSha256: 'd'.repeat(64), promptSha256: '2'.repeat(64),
    outputContractSha256: '3'.repeat(64), workOrderSha256: '4'.repeat(64),
    methodPackage: { version: 'director-paid.v1', sha256: '1'.repeat(64) },
    pricingSnapshot: { sha256: '5'.repeat(64), currency: 'CNY' as const, estimatedAmountCny: '0.13305600' },
    requestPolicy: { maxAttempts: 1 as const, maxRetries: 0 as const }, dispatchState: 'DispatchPending',
  }))
  const status = vi.fn(async () => ({
    state: 'settled', generationTaskId: 'task_paid_1', automaticRetry: false as const,
    classification: null, errorCode: null, transportFacts: null,
    costAccounting: { reservedUpperBoundCny: '0.13305600', actualAmountCny: null, billingReconciliation: 'pending' },
    executionReceipt: { proposal: { items: [{ id: 'paid_item_1', field: 'narrative',
      proposedValue: '真实模型建议', impact: '只供人工判断' }] }, usage: { promptTokens: 120, completionTokens: 20 } },
  }))
  const port = { readScenePlanning: vi.fn(async () => savedState),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    readDirectorProviderAvailability: vi.fn(async () => ({ enabled: true as const,
      provider: 'deepseek-official' as const, model: 'deepseek-v4-pro' as const,
      maxPaidCny: '0.30000000' as const, maxInputTokens: 8000 as const, maxOutputTokens: 2000 as const,
      maxAttempts: 1 as const, maxRetries: 0 as const, projectId: 'project_1', episodeId: 'episode_1',
      methodPackageVersion: 'director-paid.v1', methodPackageSha256: '1'.repeat(64) })),
    issueDirectorProviderWorkOrder: issue, readDirectorProviderWorkOrderStatus: status }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ScenePlanningWorkspace {...savedState} port={port} directorBridge={replayBridge()} directorSessionId="session_1"
    onCommitted={vi.fn(async () => {})} onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  const button = await screen.findByRole('button', { name: '请求真实 DeepSeek 导演建议（会产生费用）' })
  await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(button)
  expect(await screen.findByText('真实模型建议')).toBeTruthy()
  expect(screen.getByRole('region', { name: '真实 DeepSeek 导演建议（Provider 生成）' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '演练建议（非模型生成）' })).toBeTruthy()
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('相遇')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  expect(issue).toHaveBeenCalledOnce(); expect(status).toHaveBeenCalledOnce()
  expect(issue.mock.calls[0]![0]).toMatchObject({ purpose: 'bounded_director_suggestion',
    suggestionType: 'text_director_proposal', expectedContextSnapshotSha256: 'd'.repeat(64) })
})

it('recovers an unknown adopted save and publishes its exact method-bound outer refresh', async () => {
  const original: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [{ id: 'shot_1', title: '门口', narrative: '相遇', visual: '雨夜门口', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] }] } }
  const committed: ScenePlanningState = { ...original,
    storyboard: { id: 'revision_2', version: 2, sourceHash: '4'.repeat(64), status: 'Ready' },
    planning: { ...original.planning!, shots: [{ ...original.planning!.shots[0]!, narrative: '相遇；明确本镜情绪落点。' }] } }
  const result: ScenePlanningResult = {
    schema: 'jason.qingmu-scene-planning-result.v1', projectId: state.projectId, episodeId: state.episodeId,
    action: 'edit', sceneId: 'scene_1', seriesId: 'series_1', shotIds: ['shot_1'], actorIds: {},
    source: committed.planning!.source, storyboard: committed.storyboard!, idempotencyKey: 'intent_1',
    requestSha256: '5'.repeat(64), commandReceiptId: 'receipt_2', eventId: 'event_2',
    providerCalls: 0, stageStarted: false, approvalGranted: false,
  }
  let serverCommitted = false
  const port = {
    readScenePlanning: vi.fn(async () => serverCommitted ? committed : original),
    requestDirectorProposal: vi.fn(async () => replayProposal()),
    checkDirectorProposalFreshness: vi.fn(async () => ({ fresh: true } as unknown as DirectorProposalFreshnessResult)),
    saveScenePlanning: vi.fn(async () => { serverCommitted = true; throw new Error('disconnected after submit') }),
    recoverScenePlanning: vi.fn(async () => result),
  }
  const publish = vi.fn((_message: QingmuScenePlanningSavedMessage) => true)
  const hostSync: QingmuHostSync = { pendingTarget: () => null, replay: vi.fn(() => false), publish }
  const onCommitted = vi.fn(async () => { throw new Error('workflow projection unavailable') })
  render(<ScenePlanningWorkspace {...original} port={port} directorBridge={replayBridge()} directorSessionId="session_1"
    hostSync={hostSync} onCommitted={onCommitted}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('读取演练建议'))
  fireEvent.click(await screen.findByText('采用到草稿'))
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await screen.findByRole('alert')
  const pending = localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')
  expect(pending).toContain('pendingAdvisory'); expect(pending).toContain('narrative-focus')
  fireEvent.click(screen.getByText('读取恢复'))
  await waitFor(() => { expect(publish).toHaveBeenCalledOnce() })
  const message = publish.mock.calls[0]![0]
  expect(message.scope).toEqual({ projectId: 'project_1', episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1' })
  expect(message.method?.adoptedItemIds).toEqual(['narrative-focus'])
  expect(message.receipt.storyboardVersion).toBe(2)
  expect(message.authority).toEqual({ source: 'adopted_replay_suggestion', advisoryOnly: true,
    providerCalls: 0, stageStarted: false, approvalGranted: false })
  expect(onCommitted).toHaveBeenCalledOnce()
  expect(await screen.findByText(/内层工作流投影刷新失败；保存回执仍有效，外层通知不受影响/)).toBeTruthy()
})

it('clears a shot-bound replay proposal before showing another shot', async () => {
  const savedState: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [
        { id: 'shot_1', title: '门口', narrative: '相遇', visual: '雨夜门口', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] },
        { id: 'shot_2', title: '室内', narrative: '对峙', visual: '昏暗室内', action: '关门', durationSec: 4, dialogueLineIds: [] },
      ] } }
  const port = { readScenePlanning: vi.fn(async () => savedState), requestDirectorProposal: vi.fn(async () => replayProposal()),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...savedState} port={port} directorBridge={replayBridge()} directorSessionId="session_1"
    onCommitted={vi.fn(async () => {})} onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('读取演练建议'))
  expect(await screen.findByText('相遇；明确本镜情绪落点。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /02 · 室内/ }))
  await waitFor(() => { expect(screen.queryByText('相遇；明确本镜情绪落点。')).toBeNull() })
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('对峙')
})

it('aborts and hides a paid proposal before showing another shot', async () => {
  const savedState: ScenePlanningState = { ...state,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
      source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
      shots: [
        { id: 'shot_1', title: '门口', narrative: '相遇', visual: '雨夜门口', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] },
        { id: 'shot_2', title: '室内', narrative: '对峙', visual: '昏暗室内', action: '关门', durationSec: 4, dialogueLineIds: [] },
      ] } }
  let statusSignal: AbortSignal | undefined
  const port = { readScenePlanning: vi.fn(async () => savedState),
    requestDirectorProposal: unavailableDirectorProposal(), checkDirectorProposalFreshness: unusedFreshness(),
    saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    readDirectorProviderAvailability: vi.fn(async () => ({ enabled: true as const,
      provider: 'deepseek-official' as const, model: 'deepseek-v4-pro' as const,
      maxPaidCny: '0.30000000' as const, maxInputTokens: 8000 as const, maxOutputTokens: 2000 as const,
      maxAttempts: 1 as const, maxRetries: 0 as const, projectId: 'project_1', episodeId: 'episode_1',
      methodPackageVersion: 'director-paid.v1', methodPackageSha256: '1'.repeat(64) })),
    issueDirectorProviderWorkOrder: vi.fn(async () => ({
      schema: 'jason.qingmu-director-provider-work-order.v1' as const,
      workOrderId: 'work_order_paid_1', generationTaskId: 'task_paid_1', projectId: 'project_1',
      episodeId: 'episode_1', sceneId: 'scene_1', shotId: 'shot_1', provider: 'deepseek-official',
      model: 'deepseek-v4-pro', inputSha256: 'd'.repeat(64), promptSha256: '2'.repeat(64),
      outputContractSha256: '3'.repeat(64), workOrderSha256: '4'.repeat(64),
      methodPackage: { version: 'director-paid.v1', sha256: '1'.repeat(64) },
      pricingSnapshot: { sha256: '5'.repeat(64), currency: 'CNY' as const, estimatedAmountCny: '0.13305600' },
      requestPolicy: { maxAttempts: 1 as const, maxRetries: 0 as const }, dispatchState: 'DispatchPending',
    })),
    readDirectorProviderWorkOrderStatus: vi.fn(async (_request: unknown, signal: AbortSignal) => {
      statusSignal = signal
      return { state: 'settled', generationTaskId: 'task_paid_1', automaticRetry: false as const,
        classification: null, errorCode: null, transportFacts: null,
        costAccounting: { reservedUpperBoundCny: '0.13305600', actualAmountCny: null, billingReconciliation: 'pending' },
        executionReceipt: { proposal: { items: [{ id: 'paid_item_1', field: 'narrative',
          proposedValue: '只属于第一镜的真实建议', impact: '只供人工判断' }] } } }
    }) }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ScenePlanningWorkspace {...savedState} port={port} directorBridge={replayBridge()} directorSessionId="session_1"
    onCommitted={vi.fn(async () => {})} onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  const paid = await screen.findByRole('button', { name: '请求真实 DeepSeek 导演建议（会产生费用）' })
  await waitFor(() => { expect((paid as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(paid)
  expect(await screen.findByText('只属于第一镜的真实建议')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /02 · 室内/ }))
  await waitFor(() => { expect(screen.queryByText('只属于第一镜的真实建议')).toBeNull() })
  expect(statusSignal?.aborted).toBe(true)
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('对峙')
  expect(port.issueDirectorProviderWorkOrder).toHaveBeenCalledOnce()
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
})

it('appends another scene and restores its selection while keeping both scenes editable', async () => {
  const first = { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {},
    source: { sceneIndex: 1, scriptRevision: 1, scriptSha256: state.scriptSha256!, inputSha256: 'c'.repeat(64), sourceLineIds: ['line_1'] },
    shots: [{ id: 'shot_1', title: '开门相遇', narrative: '', visual: '', action: '开门', durationSec: 3, dialogueLineIds: ['line_1'] }] }
  let current: ScenePlanningState = { ...state, scenes: [...state.scenes, { sceneIndex: 2, title: '室内', actionDescription: '坐下', importSourceLineIds: [], dialogues: [] }],
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' }, planning: first, scenePlans: [first] }
  const onCommitted = vi.fn(async () => {}), selected = vi.fn()
  const save = vi.fn(async (intent: ScenePlanningRequest) => {
    if (intent.request.action !== 'initialize') throw new Error('Unexpected fixture operation')
    const plan = { ...first, sceneId: 'scene_2', sceneIndex: 2, initialReceiptId: 'receipt_2',
      source: { ...first.source, sceneIndex: 2, sourceLineIds: [] },
      shots: intent.request.shots.map((shot, i) => ({ ...shot, id: `shot_2_${i}` })) }
    current = { ...current, storyboard: { id: 'revision_2', version: 2, sourceHash: 'd'.repeat(64), status: 'Ready' }, scenePlans: [first, plan] }
    return { ...state, schema: 'jason.qingmu-scene-planning-result.v1', action: 'initialize', ...intent,
      requestSha256: 'e'.repeat(64), commandReceiptId: 'receipt_2', eventId: 'event_2', sceneId: plan.sceneId, seriesId: 'series_1',
      shotIds: plan.shots.map(shot => shot.id), actorIds: {}, source: plan.source, storyboard: current.storyboard,
      providerCalls: 0, stageStarted: false, approvalGranted: false } as ScenePlanningResult
  })
  const port = { readScenePlanning: vi.fn(async () => current), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: save, recoverScenePlanning: vi.fn() }
  const show = () => render(<ScenePlanningWorkspace {...state} port={port} onCommitted={onCommitted}
    onSelectShotId={selected} onUnsavedChange={vi.fn()} />)
  const mounted = show()
  expect((await screen.findByLabelText('镜头名称') as HTMLTextAreaElement).value).toBe('开门相遇')
  fireEvent.click(screen.getByRole('button', { name: '室内' }))
  fireEvent.click(screen.getByRole('button', { name: '建立本场镜头' }))
  expect((screen.getByRole('button', { name: '雨夜' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('镜头名称'), { target: { value: '室内落座' } })
  fireEvent.click(screen.getByText('预览保存影响')); fireEvent.click(screen.getByText('确认保存规划'))
  await waitFor(() => { expect(onCommitted).toHaveBeenCalledOnce() })
  expect(save.mock.calls[0]?.[0].request).toMatchObject({ action: 'initialize', sceneIndex: 2, expectedStoryboardRevision: 1 })
  expect((screen.getByLabelText('镜头名称') as HTMLTextAreaElement).value).toBe('室内落座')
  fireEvent.click(screen.getByRole('button', { name: '读取恢复' }))
  await waitFor(() => expect(port.readScenePlanning).toHaveBeenCalledTimes(3))
  expect((screen.getByLabelText('镜头名称') as HTMLTextAreaElement).value).toBe('室内落座')
  mounted.unmount(); show()
  expect((await screen.findByLabelText('镜头名称') as HTMLTextAreaElement).value).toBe('室内落座')
  fireEvent.click(screen.getByRole('button', { name: '雨夜' }))
  expect((screen.getByLabelText('镜头名称') as HTMLTextAreaElement).value).toBe('开门相遇')
  expect(selected).toHaveBeenLastCalledWith('shot_1')
  expect(save).toHaveBeenCalledOnce()
})

it('waits for the project and episode before reading scene planning', async () => {
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
    checkDirectorProposalFreshness: unusedFreshness(), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn() }
  const props = { port, onCommitted: vi.fn(async () => {}), onSelectShotId: vi.fn(), onUnsavedChange: vi.fn() }
  const view = render(<ScenePlanningWorkspace {...props} projectId="" episodeId="" />)
  expect(port.readScenePlanning).not.toHaveBeenCalled()
  view.rerender(<ScenePlanningWorkspace {...props} projectId={state.projectId} episodeId={state.episodeId} />)
  await waitFor(() => { expect(port.readScenePlanning).toHaveBeenCalledTimes(1) })
  expect(port.readScenePlanning.mock.calls[0]).toEqual([{ projectId: state.projectId, episodeId: state.episodeId }])
})
