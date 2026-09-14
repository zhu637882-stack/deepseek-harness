// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { QingmuYimengPort } from '../src/client/contracts.ts'
import { SceneLayoutEditor } from '../src/client/SceneLayoutEditor.tsx'
import type { ImageCamera, ImageObjectState, SceneLayout, SceneLayoutPreview } from '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter/types'

afterEach(cleanup)
const layout: SceneLayout = { basis: 'Director-authored', coordinateFrame: 'Metres; x east, y north, z up', objects: [
  { id: 'desk', label: '固定书桌', center: [2,1,.4], size: [2,1,.8], rotation: 90, color: '#886655' },
] }
const camera: ImageCamera = { position: [0,-5,1.6], target: [0,0,1], verticalFov: 50 }
const result: SceneLayoutPreview = { projectId: 'p', episodeId: 'e', recipe: 'qingmu-blockout-v1', imageUrl: 'data:image/png;base64,cHJldmlldw==',
  sha256: 'a'.repeat(64), width: 1024, height: 576, objects: [{ id: 'desk', label: '固定书桌', color: '#886655', pixelCount: 90, bounds: [1,2,30,40] }], guidance: 'Authored blockout only.' }

it('prevents SVG dragging while the shot save is pending', () => {
  const onCamera = vi.fn(), onLayout = vi.fn()
  render(<fieldset disabled><SceneLayoutEditor projectId="p" episodeId="e" layout={layout} camera={camera}
    ratio="16:9" onLayout={onLayout} onCamera={onCamera} previewLayout={vi.fn(async () => result)} /></fieldset>)
  const svg = screen.getByLabelText('共用场景平面图')
  for (const group of svg.querySelectorAll('g')) fireEvent.pointerDown(group, { button: 0, pointerId: 1 })
  fireEvent.pointerMove(svg, { clientX: 400, clientY: 200 })
  expect(onCamera).not.toHaveBeenCalled(); expect(onLayout).not.toHaveBeenCalled()
})

it('changes camera without moving the shared furniture and removes a stale preview on edit', async () => {
  const preview = vi.fn<QingmuYimengPort['previewSceneLayout']>(async () => result), onLayout = vi.fn()
  function Editor() {
    const [value, setValue] = useState<ImageCamera | null>(camera)
    return <SceneLayoutEditor projectId="p" episodeId="e" layout={layout} camera={value} ratio="16:9" onLayout={onLayout} onCamera={setValue} previewLayout={preview} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByText('空间布置与取景预览 · 已启用构图辅助'))
  fireEvent.change(screen.getByLabelText('摄影机位置 Y'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '预览当前取景' }))
  await screen.findByAltText('本图空间构图参考')
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ layout, camera: { ...camera, position: [0,5,1.6] } }), expect.any(AbortSignal))
  expect(onLayout).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('取景目标 X'), { target: { value: '1' } })
  await waitFor(() => { expect(screen.queryByAltText('本图空间构图参考')).toBeNull() })
  expect(preview).toHaveBeenCalledTimes(1)
})

it('discards a late preview after switching projects', async () => {
  let complete!: (value: SceneLayoutPreview) => void
  const preview = vi.fn(() => new Promise<SceneLayoutPreview>((resolve) => { complete = resolve }))
  const props = { episodeId: 'e', layout, camera, ratio: '16:9', onCamera: vi.fn(), previewLayout: preview }
  const view = render(<SceneLayoutEditor {...props} projectId="p" />)
  fireEvent.click(screen.getByText('空间布置与取景预览 · 已启用构图辅助'))
  fireEvent.click(screen.getByRole('button', { name: '预览当前取景' }))
  view.rerender(<SceneLayoutEditor {...props} projectId="other" />)
  complete(result)
  await waitFor(() => { expect(preview.mock.calls).toHaveLength(1) })
  expect(screen.queryByAltText('本图空间构图参考')).toBeNull()
})


it('edits only this image, carries placement to preview, and can restore the shared state', async () => {
  const preview = vi.fn<QingmuYimengPort['previewSceneLayout']>(async () => result), onLayout = vi.fn()
  const original = structuredClone(layout)
  function Editor() {
    const [states, setStates] = useState<readonly ImageObjectState[]>([])
    return <SceneLayoutEditor projectId="p" episodeId="e" layout={layout} camera={camera} ratio="16:9"
      onCamera={vi.fn()} onLayout={onLayout} imageObjectStates={states} onObjectStates={setStates} previewLayout={preview} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByText('空间布置与取景预览 · 已启用构图辅助'))
  fireEvent.change(screen.getByLabelText('本图调整的物件'), { target: { value: 'desk' } })
  fireEvent.change(screen.getByLabelText('本图物件中心 X'), { target: { value: '-2' } })
  fireEvent.click(screen.getByRole('button', { name: '预览当前取景' }))
  await screen.findByAltText('本图空间构图参考')
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ layout,
    imageObjectStates: [{ id: 'desk', basis: '本图导演布置', center: [-2,1,.4] }] }), expect.any(AbortSignal))
  fireEvent.click(screen.getByLabelText('本图保留此物件'))
  await waitFor(() => { expect(screen.queryByAltText('本图空间构图参考')).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: '预览当前取景' }))
  await screen.findByAltText('本图空间构图参考')
  expect(preview.mock.calls.at(-1)?.[0]).toMatchObject({ imageObjectStates: [{ id: 'desk', visible: false }] })
  fireEvent.click(screen.getByRole('button', { name: '本物件恢复共用布置' }))
  fireEvent.click(screen.getByRole('button', { name: '预览当前取景' }))
  await screen.findByAltText('本图空间构图参考')
  expect(preview.mock.calls.at(-1)?.[0]).toMatchObject({ imageObjectStates: [] })
  expect(layout).toEqual(original)
  expect(onLayout).not.toHaveBeenCalled()
})
