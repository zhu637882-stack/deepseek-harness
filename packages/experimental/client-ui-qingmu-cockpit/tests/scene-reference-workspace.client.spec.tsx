// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SceneReferenceWorkspace } from '../src/client/SceneReferenceWorkspace.tsx'

const referenceRender = vi.hoisted(() => vi.fn())
vi.mock('../src/client/ReferenceVideoWorkspace.tsx', () => ({ ReferenceVideoWorkspace: (props: unknown) => {
  referenceRender(props)
  const value = props as { onUnsavedChange: (dirty: boolean) => void }
  return <button type="button" onClick={() => { value.onUnsavedChange(true) }}>mark reference draft dirty</button>
} }))
afterEach(() => { cleanup(); referenceRender.mockClear(); vi.restoreAllMocks() })

const relations = {
  projectId: 'project-1',
  storyboardRevision: { revisionId: 'storyboard-r7' },
  scenes: [{ sceneId: 'cafe', name: '深夜咖啡馆' }, { sceneId: 'street', name: '街口' }],
  shots: [
    { shotId: 's1', sceneId: 'cafe', frameNo: 1, title: '窗边空镜', durationSec: 5, beats: [], dialogueRhythm: { cues: [] } },
    { shotId: 's2', sceneId: 'cafe', frameNo: 2, title: '林予落座', durationSec: 8,
      beats: [{ visualResponsibility: '林予推门坐下' }], dialogueRhythm: { cues: [{ verbatimText: '我等你很久了。' }] } },
    { shotId: 's3', sceneId: 'cafe', frameNo: 3, title: '陈远抬头', durationSec: 6, beats: [], dialogueRhythm: { cues: [] } },
    { shotId: 's4', sceneId: 'street', frameNo: 4, title: '街口远景', durationSec: 5, beats: [], dialogueRhythm: { cues: [] } },
  ],
} as never

function setup() {
  const onSelectShotId = vi.fn(); const onUnsavedChange = vi.fn()
  render(<SceneReferenceWorkspace projectId="project-1" relations={relations} selectedShotId="s2"
    onSelectShotId={onSelectShotId} onUnsavedChange={onUnsavedChange} port={{} as never} />)
  return { onSelectShotId, onUnsavedChange }
}

it('starts a scene-scoped draft without PromptIR and orders prior shot references first', () => {
  setup()
  expect(screen.getByRole('heading', { name: '深夜咖啡馆' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '镜02 · 林予落座' })).toBeTruthy()
  expect(referenceRender).toHaveBeenLastCalledWith(expect.objectContaining({
    projectId: 'project-1', frameId: 's2', initialPrompt: '', initialOpen: true, embedded: true,
    shotLabel: '镜02 · 林予落座', referenceSources: [
      { frameId: 's1', label: '镜01 · 窗边空镜' }, { frameId: 's3', label: '镜03 · 陈远抬头' },
    ],
  }))
  expect(screen.getByText('林予推门坐下')).toBeTruthy()
  expect(screen.getByText('对白：我等你很久了。')).toBeTruthy()
})

it('asks before switching a scene shot when the local reference draft is dirty', () => {
  const { onSelectShotId, onUnsavedChange } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'mark reference draft dirty' }))
  expect(onUnsavedChange).toHaveBeenLastCalledWith(true)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: /镜 03/ }))
  expect(confirm).toHaveBeenCalledOnce(); expect(onSelectShotId).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: /镜 03/ }))
  expect(onSelectShotId).toHaveBeenCalledWith('s3')
})

it('does not mount a reference draft until a matching project has an explicit selected shot', () => {
  const onSelectShotId = vi.fn()
  render(<SceneReferenceWorkspace projectId="project-1" relations={relations} selectedShotId="missing"
    onSelectShotId={onSelectShotId} onUnsavedChange={vi.fn()} port={{} as never} />)
  expect(referenceRender).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /镜 01/ }))
  expect(onSelectShotId).toHaveBeenCalledWith('s1')
})
