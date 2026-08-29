// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DirectorWorkspace, type DirectorWorkspaceProps } from '../src/client/DirectorWorkspace.tsx'

vi.mock('../src/client/ScenePlanningWorkspace.tsx', () => ({ ScenePlanningWorkspace:
  ({ onUnsavedChange }: { onUnsavedChange: (v: boolean) => void }) =>
    <><button onClick={() => { onUnsavedChange(true) }}>planning dirty</button>
      <button onClick={() => { onUnsavedChange(false) }}>planning clean</button></> }))
vi.mock('../src/client/PromptIrWorkspace.tsx', () => ({ PromptIrWorkspace: ({ onUnsavedChange }: { onUnsavedChange: (v: boolean) => void }) => {
  // RAM-only input models storage unavailability, without a persisted fallback.
  const [text, setText] = useState('')
  return <textarea aria-label="RAM prompt" value={text} onChange={(e) => { setText(e.target.value); onUnsavedChange(true) }} />
} }))
vi.mock('../src/client/TakeVersionCompareView.tsx', () => ({ TakeVersionCompareView: () => null }))
vi.mock('../src/client/HeroFrameStoryboardCanvas.tsx', () => ({ HeroFrameStoryboardCanvas: () => null }))
afterEach(cleanup)
it('keeps RAM-only prompt edits mounted when folded and ORs both editors dirty state', async () => {
  const onUnsavedChange = vi.fn()
  const props = { projectId: 'p1', episodeId: 'e1', selectedShotId: '', shotItems: [], port: {},
    projection: { director: { shotRelations: { scenes: [], shots: [], storyboardRevision: { revisionId: 'r1' } } } },
    onSelectShotId: vi.fn(), onCommitted: vi.fn(), onUnsavedChange, t: (k: string) => k } as unknown as DirectorWorkspaceProps
  render(<DirectorWorkspace {...props} />)
  const details = screen.getByText('已有提示词、Take 与高级分镜').parentElement as HTMLDetailsElement
  details.open = true; fireEvent(details, new Event('toggle'))
  fireEvent.change(await screen.findByLabelText('RAM prompt'), { target: { value: '只在内存里的提示词' } })
  fireEvent.click(screen.getByText('planning dirty')); fireEvent.click(screen.getByText('planning clean'))
  await waitFor(() => { expect(onUnsavedChange).toHaveBeenLastCalledWith(true) })
  details.open = false; fireEvent(details, new Event('toggle'))
  details.open = true; fireEvent(details, new Event('toggle'))
  expect(screen.getByLabelText<HTMLTextAreaElement>('RAM prompt').value).toBe('只在内存里的提示词')
  expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
})
