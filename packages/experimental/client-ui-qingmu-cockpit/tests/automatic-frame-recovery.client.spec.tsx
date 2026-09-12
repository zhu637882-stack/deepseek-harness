// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AutomaticFrameRequirementsEditor } from '../src/client/AutomaticFrameRequirementsEditor.tsx'

afterEach(() => { cleanup(); localStorage.clear() })

it.each(['', '独立修改的构图'])('offers the matching scene still without overwriting %s', async (imagePromptCn) => {
  const save = vi.fn()
  const view = render(<AutomaticFrameRequirementsEditor projectId="p" episodeId="e" shotId="target"
    onCommitted={async () => undefined} port={{
      readScenePlanning: vi.fn(async () => ({ projectId: 'p', episodeId: 'e', scriptRevision: 1,
        scriptSha256: 'a'.repeat(64), scenes: [], storyboard: { id: 'v1', version: 1, sourceHash: 'b'.repeat(64), status: 'Ready' },
        scenePlans: [{ shots: [{ id: 'other', visual: '另一场画面' }] }, { shots: [{ id: 'target', visual: '门还关闭，人物在门内' }] }],
        frameRequirements: [{ id: 'target', frameNo: 1, title: '门内', imagePromptCn }] })) as never,
      saveScenePlanning: save, recoverScenePlanning: vi.fn(),
    }} />)
  const input = await screen.findByRole('textbox', { name: '画面要求' }) as HTMLTextAreaElement
  expect(input.value).toBe(imagePromptCn)
  fireEvent.click(screen.getByText('查看分镜已保存的首帧描述'))
  fireEvent.click(screen.getByRole('button', { name: '采用这段首帧描述' }))
  expect(input.value).toBe('门还关闭，人物在门内')
  expect(screen.getByText('有未保存修改 · 已保留在此浏览器')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  view.unmount()
  expect(JSON.parse(localStorage.getItem('qingmu.scene-planning.v1:p:e:automatic-frame:target') ?? '{}').imagePromptCn)
    .toBe('门还关闭，人物在门内')
})

it('settles a successful read that does not contain the current automatic shot', async () => {
  const save = vi.fn()
  render(<AutomaticFrameRequirementsEditor projectId="project-1" episodeId="episode-1" shotId="shot-1"
    onCommitted={async () => undefined} port={{
      readScenePlanning: vi.fn(async () => ({ projectId: 'project-1', episodeId: 'episode-1',
        scriptRevision: 1, scriptSha256: 'a'.repeat(64), canonicalStoryboard: null })) as never,
      saveScenePlanning: save, recoverScenePlanning: vi.fn(),
    }} />)
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain('请到分镜工作区核对')
  })
  expect(screen.queryByText('正在读取本镜首帧要求…')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(save).not.toHaveBeenCalled()
})
