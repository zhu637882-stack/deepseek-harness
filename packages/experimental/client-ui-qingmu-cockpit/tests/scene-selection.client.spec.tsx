// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenePlanningWorkspace } from '../src/client/ScenePlanningWorkspace.tsx'
import type { ScenePlanningState } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'
import type { DirectorContextClientPort, DirectorObjectScope } from '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge/types'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fixture() {
  const shots = ['入口', '相遇', '告别'].map((title, i) => ({ id: `shot_${i + 1}`, title,
    narrative: title, visual: `${title}的画面`, action: '', durationSec: 5, dialogueLineIds: [] }))
  const source = { sceneIndex: 1, scriptRevision: 1, scriptSha256: 'a'.repeat(64), inputSha256: 'c'.repeat(64), sourceLineIds: [] }
  const first = { sceneId: 'scene_1', sceneIndex: 1, initialReceiptId: 'receipt_1', actorIds: {}, source, shots: shots.slice(0, 2) }
  const second = { ...first, sceneId: 'scene_2', sceneIndex: 2, source: { ...source, sceneIndex: 2 }, shots: shots.slice(2) }
  const state: ScenePlanningState = { schema: 'jason.qingmu-scene-planning-state.v1', projectId: 'project_1', episodeId: 'episode_1',
    scriptRevision: 1, scriptSha256: source.scriptSha256,
    storyboard: { id: 'revision_1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
    planning: first, scenePlans: [first, second], scenes: [1, 2].map(sceneIndex => ({ sceneIndex,
      title: `场景${sceneIndex}`, actionDescription: '', importSourceLineIds: [], dialogues: [] })) }
  const port = { readScenePlanning: vi.fn(async () => state), saveScenePlanning: vi.fn(), recoverScenePlanning: vi.fn(),
    requestDirectorProposal: vi.fn(), checkDirectorProposalFreshness: vi.fn() }
  const enter = vi.fn<DirectorContextClientPort['enter']>(async (_id, scope) => ({ status: 'current', changed: true,
    manualWorkAllowed: true, state: { version: 1, binding: { scope, contextSnapshotSha256: 'd'.repeat(64) }, transition: 'enter', proposal: null } }))
  const bridge = { enter, clear: vi.fn(async () => ({ status: 'cleared', state: null, changed: true, manualWorkAllowed: true })) } as unknown as DirectorContextClientPort
  const scope = (shotId: string): DirectorObjectScope => ({ projectId: state.projectId, episodeId: state.episodeId,
    sceneId: shotId === 'shot_3' ? 'scene_2' : 'scene_1', shotId })
  const props = { projectId: state.projectId, episodeId: state.episodeId, port, directorBridge: bridge,
    directorSessionId: 'session_1', onSelectShotId: vi.fn((_id: string) => true),
    onCommitted: vi.fn(async () => {}), onUnsavedChange: vi.fn() }
  return { props, enter, scope }
}

it('follows the selected reference shot across scenes and binds only that visible planning shot', async () => {
  const { props, enter, scope } = fixture()
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorScope={scope('shot_2')} />)
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>('镜头名称').value).toBe('相遇'))
  await waitFor(() => expect(enter).toHaveBeenCalled())
  expect(enter.mock.calls.map(call => call[1].shotId)).toEqual(['shot_2'])
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={scope('shot_3')} />)
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>('镜头名称').value).toBe('告别'))
  await waitFor(() => expect(enter.mock.calls.at(-1)?.[1]).toEqual(scope('shot_3')))
  expect(JSON.parse(localStorage.getItem('qingmu.scene-planning.v1:project_1:episode_1')!)).toMatchObject({ sceneIndex: 2, activeIndex: 0 })
  expect(props.port.saveScenePlanning).not.toHaveBeenCalled()
  expect(props.port.recoverScenePlanning).not.toHaveBeenCalled()
})

it('shares planning selection with the reference workspace and respects a declined navigation', async () => {
  const { props } = fixture()
  render(<ScenePlanningWorkspace {...props} />)
  await screen.findByLabelText('镜头名称')
  props.onSelectShotId.mockReturnValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: /02 · 相遇/  }))
  expect(props.onSelectShotId).toHaveBeenLastCalledWith('shot_2')
  expect(screen.getByLabelText<HTMLTextAreaElement>('镜头名称').value).toBe('入口')
  fireEvent.click(screen.getByRole('button', { name: /02 · 相遇/  }))
  expect(screen.getByLabelText<HTMLTextAreaElement>('镜头名称').value).toBe('相遇')
})

it('retains unsaved direction and detaches a stale target if an external selection changes', async () => {
  const { props, enter, scope } = fixture()
  const view = render(<ScenePlanningWorkspace {...props} canonicalDirectorScope={scope('shot_1')} />)
  await waitFor(() => expect(enter).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText('画面描述'), { target: { value: '尚未保存的摄影设计' } })
  view.rerender(<ScenePlanningWorkspace {...props} canonicalDirectorScope={scope('shot_2')} />)
  expect(screen.getByLabelText<HTMLTextAreaElement>('画面描述').value).toBe('尚未保存的摄影设计')
  await screen.findByText('导演助理暂不可用；人工编辑与保存不受影响。')
  expect(enter).toHaveBeenCalledOnce()
  expect(props.port.saveScenePlanning).not.toHaveBeenCalled()
})
