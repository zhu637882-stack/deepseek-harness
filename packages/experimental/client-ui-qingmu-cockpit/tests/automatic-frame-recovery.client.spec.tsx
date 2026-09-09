// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AutomaticFrameRequirementsEditor } from '../src/client/AutomaticFrameRequirementsEditor.tsx'

afterEach(cleanup)

it('settles a successful read that does not contain the current automatic shot', async () => {
  const save = vi.fn()
  render(<AutomaticFrameRequirementsEditor projectId="project-1" episodeId="episode-1" shotId="shot-1"
    onCommitted={async () => undefined} port={{
      readScenePlanning: vi.fn(async () => ({ projectId: 'project-1', episodeId: 'episode-1',
        scriptRevision: 1, scriptSha256: 'a'.repeat(64), canonicalStoryboard: null })) as never,
      saveScenePlanning: save, recoverScenePlanning: vi.fn(),
    }} />)
  await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toContain('请到分镜工作区核对') })
  expect(screen.queryByText('正在读取本镜首帧要求…')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(save).not.toHaveBeenCalled()
})
