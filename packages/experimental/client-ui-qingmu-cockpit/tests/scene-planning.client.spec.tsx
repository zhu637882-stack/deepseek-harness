// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenePlanningWorkspace } from '../src/client/ScenePlanningWorkspace.tsx'
import type { DirectorProposalFreshnessResult, DirectorReplayProposal, ScenePlanningState, ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorContextBindingState, DirectorContextClientPort, DirectorObjectScope } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'
import type { QingmuHostSync, QingmuScenePlanningSavedMessage } from '../src/client/host-sync.ts'

const state: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'project_1', episodeId: 'episode_1',
  scriptRevision: 1, scriptSha256: 'a'.repeat(64), storyboard: null, planning: null,
  scenes: [{ sceneIndex: 1, title: '雨夜', actionDescription: '开门', importSourceLineIds: ['line_1'],
    dialogues: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1' }] }] }
const unavailableDirectorProposal = () => vi.fn(async () => { throw new Error('Director replay is not part of this fixture') })
const unusedFreshness = () => vi.fn(async () => { throw new Error('Freshness is not part of this fixture') })
function replayBridge(contextSnapshotSha256 = 'd'.repeat(64)): DirectorContextClientPort {
  let bound: DirectorContextBindingState | null = null
  return {
    enter: vi.fn(async (_sessionId: string, scope: DirectorObjectScope) => {
      bound = { version: 1, binding: { scope, contextSnapshotSha256 }, proposal: null, transition: 'enter' }
      return { status: 'current' as const, state: bound, changed: true, manualWorkAllowed: true as const }
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
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
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
