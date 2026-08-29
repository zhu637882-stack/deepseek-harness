// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenePlanningWorkspace } from '../src/client/ScenePlanningWorkspace.tsx'
import type { ScenePlanningState, ScenePlanningResult } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

const state: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'project_1', episodeId: 'episode_1',
  scriptRevision: 1, scriptSha256: 'a'.repeat(64), storyboard: null, planning: null,
  scenes: [{ sceneIndex: 1, title: '雨夜', actionDescription: '开门', importSourceLineIds: ['line_1'],
    dialogues: [{ character: '林夏', line: '请进。', sourceLineId: 'line_1' }] }] }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('preserves text and original intent across double-click, disconnect and remount without resubmission', async () => {
  const port = { readScenePlanning: vi.fn(async () => state), saveScenePlanning: vi.fn(async () => { throw new Error('disconnected') }),
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
  const port = { readScenePlanning: vi.fn(async () => state),
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
  const port = { readScenePlanning: vi.fn(async () => state), saveScenePlanning: vi.fn(async () => { throw new Error(failure) }),
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
