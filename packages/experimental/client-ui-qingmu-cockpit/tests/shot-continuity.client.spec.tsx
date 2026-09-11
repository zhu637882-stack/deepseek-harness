// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScenePlanningRequest, ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import { AutomaticFrameRequirementsEditor } from '../src/client/AutomaticFrameRequirementsEditor.tsx'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); localStorage.clear() })
const scope = { projectId: 'p', episodeId: 'e', shotId: 'f' }
function state(): ScenePlanningState {
  return { schema: 'jason.qingmu-scene-planning-state.v1', ...scope, scriptRevision: 1, scriptSha256: 'a'.repeat(64),
    storyboard: { id: 'v1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' }, scenes: [], planning: null,
    frameRequirements: [
      { id: 'before', frameNo: 1, title: '断电', imagePromptCn: '手在插头旁', directorPlan: { continuity: { end: '插头平放桌面' } } },
      { id: 'f', frameNo: 2, title: '检修', imagePromptCn: '断电检修的起始画面', directorPlan: {
        soundPlan: { ambience: '连续雨声' }, continuity: { start: { prop: '断电', hand: '持螺丝刀' }, end: '检查结束', axis: '保持桌旁轴线' },
      } },
      { id: 'after', frameNo: 3, title: '次日', imagePromptCn: '次日店铺', directorPlan: { continuity: '次日换场，由剧本解释省略' } },
    ] }
}

it.each(['authored image', ''])('preserves boundaries through lost-response recovery with image requirement %s', async (imagePromptCn) => {
  let current = state()
  current = { ...current, frameRequirements: current.frameRequirements!.map(shot => shot.id === 'f' ? { ...shot, imagePromptCn } : shot) }
  const read = vi.fn(async () => current)
  const save = vi.fn(async (intent: ScenePlanningRequest) => {
    if (intent.request.action !== 'edit_requirements') throw Error('unexpected action')
    const patch = intent.request.directorPlan
    current = { ...current, storyboard: { ...current.storyboard!, version: 2, sourceHash: 'c'.repeat(64) },
      frameRequirements: current.frameRequirements!.map(shot => shot.id === 'f'
        ? { ...shot, directorPlan: { ...shot.directorPlan, ...patch } } : shot) }
    throw Error('response lost after commit')
  })
  const recover = vi.fn(async (intent: ScenePlanningRequest) => ({ schema: 'jason.qingmu-scene-planning-result.v1' as const,
    ...scope, action: 'edit_requirements' as const, idempotencyKey: intent.idempotencyKey, requestSha256: 'd'.repeat(64),
    commandReceiptId: 'receipt', eventId: 'event', providerCalls: 0 as const, stageStarted: false as const,
    approvalGranted: false as const, storyboard: current.storyboard! }))
  const props = { ...scope, port: { readScenePlanning: read, saveScenePlanning: save, recoverScenePlanning: recover },
    onCommitted: vi.fn(async () => undefined) }
  const view = render(<AutomaticFrameRequirementsEditor {...props} />)
  const input = await screen.findByRole('textbox', { name: '本镜结束状态' })
  fireEvent.click(screen.getByText('全片镜头衔接 · 3 镜'))
  expect(within(screen.getByRole('table')).getAllByRole('row').map(row => row.textContent)).toMatchSnapshot('saved episode boundaries')
  fireEvent.click(screen.getByRole('button', { name: '关闭对照' }))
  fireEvent.change(input, { target: { value: '插头仍在台面；右手放下螺丝刀' } })
  fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
  await screen.findByRole('button', { name: '查看原保存结果' })
  const intent = save.mock.calls[0]![0]
  expect(intent.request).toMatchObject({ directorPlan: { continuity: { start: { prop: '断电', hand: '持螺丝刀' },
    end: '插头仍在台面；右手放下螺丝刀', axis: '保持桌旁轴线' } } })
  expect(current.frameRequirements![1]!.directorPlan?.soundPlan).toEqual({ ambience: '连续雨声' })
  view.unmount(); render(<AutomaticFrameRequirementsEditor {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看原保存结果' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看原保存结果' })).toBeNull())
  expect(recover).toHaveBeenCalledWith(intent)
  expect(save).toHaveBeenCalledOnce()
  expect((screen.getByRole('textbox', { name: '本镜结束状态' }) as HTMLTextAreaElement).value).toBe('插头仍在台面；右手放下螺丝刀')
})

it('opens episode comparison, selects a shot and preserves an unsaved local boundary', async () => {
  const onSelectShot = vi.fn()
  const save = vi.fn()
  render(<AutomaticFrameRequirementsEditor {...scope} onCommitted={async () => undefined} onSelectShot={onSelectShot}
    port={{ readScenePlanning: async () => state(), saveScenePlanning: save, recoverScenePlanning: vi.fn() }} />)
  fireEvent.change(await screen.findByRole('textbox', { name: '本镜结束状态' }), { target: { value: '未保存的导演衔接' } })
  fireEvent.click(screen.getByRole('button', { name: '全片镜头衔接 · 3 镜' }))
  const dialog = screen.getByRole('dialog', { name: '全片镜头衔接' })
  expect(within(dialog).getAllByRole('row')).toHaveLength(4)
  expect(within(dialog).getByRole('row', { current: true }).textContent).toContain('检修')
  fireEvent.click(within(dialog).getByRole('button', { name: '编辑镜 3 · 次日' }))
  expect(onSelectShot).toHaveBeenCalledWith('after')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(localStorage.getItem('qingmu.scene-planning.v1:p:e:automatic-frame:f')).toContain('未保存的导演衔接')
  expect(save).not.toHaveBeenCalled()
})

it('rebases only edited boundaries and keeps the latest unedited continuity decisions', async () => {
  let current = state()
  const save = vi.fn(async (_intent: ScenePlanningRequest) => { throw Error('409 conflict') })
  const recover = vi.fn(async () => { throw Error('planning_receipt_not_found') })
  render(<AutomaticFrameRequirementsEditor {...scope} onCommitted={async () => undefined}
    port={{ readScenePlanning: async () => current, saveScenePlanning: save, recoverScenePlanning: recover }} />)
  fireEvent.change(await screen.findByRole('textbox', { name: '本镜结束状态' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
  await screen.findByRole('button', { name: '查看原保存结果' })
  current = { ...current, storyboard: { ...current.storyboard!, version: 2, sourceHash: 'c'.repeat(64) },
    frameRequirements: current.frameRequirements!.map(shot => shot.id === 'f' ? { ...shot,
      directorPlan: { continuity: { start: '另一位编辑确认插头已拔下', end: '检查结束', axis: '更新的轴线' } } } : shot) }
  fireEvent.click(screen.getByRole('button', { name: '查看原保存结果' }))
  fireEvent.click(await screen.findByRole('button', { name: '保留草稿，按最新版本继续编辑' }))
  fireEvent.click(screen.getByRole('button', { name: '保存当前要求' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1]![0].request).toMatchObject({ expectedStoryboardRevision: 2, directorPlan: {
    continuity: { start: '另一位编辑确认插头已拔下', end: '', axis: '更新的轴线' } } })
})
