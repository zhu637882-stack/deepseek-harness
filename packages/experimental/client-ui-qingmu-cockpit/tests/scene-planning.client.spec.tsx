// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenePlanningWorkspace } from '../src/client/ScenePlanningWorkspace.tsx'
import type { DirectorReplayProposal, ScenePlanningState, ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const state: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'project_1', episodeId: 'episode_1',
  scriptRevision: 1, scriptSha256: 'a'.repeat(64), storyboard: null, planning: null,
  scenes: [{ sceneIndex: 1, title: '雨夜', actionDescription: '开门', importSourceLineIds: ['line_1'],
    dialogues: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1' }] }] }
const unavailableDirectorProposal = () => vi.fn(async () => { throw new Error('Director replay is not part of this fixture') })
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('preserves text and original intent across double-click, disconnect and remount without resubmission', async () => {
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
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
  fireEvent.click(screen.getByText('读取恢复'))
  await waitFor(() => { expect(port.recoverScenePlanning).toHaveBeenCalledOnce() })
  expect(port.saveScenePlanning).toHaveBeenCalledOnce()
  expect(await screen.findByText('重试原保存')).toBeTruthy()
})

it('ignores a late committed response after leaving the scope and retains the durable intent', async () => {
  let resolve!: (result: ScenePlanningResult) => void
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
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
  const port = { readScenePlanning: vi.fn(async () => state), requestDirectorProposal: unavailableDirectorProposal(),
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
  const proposal = { ...state, schema: 'qingmu.director-replay-proposal.v1', proposalId: 'proposal_1',
    sceneId: 'scene_1', shotId: 'shot_1', proposalKind: 'DirectorProposal', stale: false, staleReasons: [], advisoryOnly: true,
    items: [{ id: 'narrative-focus', field: 'narrative', originalValue: '相遇', proposedValue: '相遇；明确本镜情绪落点。',
      impact: '只修改当前镜头草稿。' }], execution: { mode: 'deterministic_replay_fixture', declaredModel: 'deepseek-v4-pro',
      networkUsed: false, providerCalls: 0, costAmountCny: '0' }, sourceTime: '2026-08-29T00:00:00Z',
    inputSha256: 'd'.repeat(64), outputSha256: 'e'.repeat(64), proposalSha256: 'f'.repeat(64),
    formalQcInferred: false, selectionGranted: false, readyGranted: false, humanDecisionInferred: false,
    methodPackage: { methodPackageSha256: '1'.repeat(64) }, workOrder: {} } as unknown as DirectorReplayProposal
  const port = { readScenePlanning: vi.fn(async () => savedState),
    requestDirectorProposal: vi.fn(async () => proposal),
    saveScenePlanning: vi.fn(async () => { throw new Error('disconnected after submit') }),
    recoverScenePlanning: vi.fn() }
  render(<ScenePlanningWorkspace {...savedState} port={port} onCommitted={vi.fn(async () => {})}
    onSelectShotId={vi.fn()} onUnsavedChange={vi.fn()} />)
  fireEvent.click(await screen.findByText('读取零费用建议'))
  expect(await screen.findByText('建议只作创意参考，尚未成为正式质检、参考选择、Ready 或人工决定。人工编辑始终可用。')).toBeTruthy()
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('相遇')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByText('采用到草稿'))
  expect(screen.getByLabelText<HTMLTextAreaElement>('叙事目的').value).toBe('相遇；明确本镜情绪落点。')
  expect(port.saveScenePlanning).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('预览保存影响'))
  fireEvent.click(screen.getByText('确认保存规划'))
  await waitFor(() => { expect(port.saveScenePlanning).toHaveBeenCalledOnce() })
})
