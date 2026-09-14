import { expect, it } from 'vitest'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { checkImageCameraGeometry } from '../src/image-camera-geometry.ts'
import { checkCameraGeometry } from '../src/camera-geometry.ts'

const input = { coordinateFrame: 'metres; x/y ground, z up', basis: 'Authored positions, not measured image features',
  aspectRatio: '16:9', imageCamera: { position: [0, 0, 1], target: [0, 2, 1], verticalFov: 90 },
  landmarks: [{ id: 'target', label: 'Target', position: [0, 2, 1] },
    { id: 'right', label: 'Right', position: [2, 2, 1] },
    { id: 'up', label: 'Above frame', position: [0, 2, 4] },
    { id: 'behind', label: 'Behind', position: [0, -2, 1] }],
}
it('derives horizontal FOV from the actual vertical FOV and frame aspect, preserving outside points', () => {
  const before = structuredClone(input), result = checkImageCameraGeometry(input)
  expect(result.relations).toMatchObject([
    { framing: 'inside_frame', imagePosition: { x: .5, y: .5 } },
    { framing: 'inside_frame', imagePosition: { x: .78125, y: .5 } },
    { framing: 'outside_frame', verticalPosition: 'outside_vertical_fov', imagePosition: { x: .5, y: -.25 } },
    { framing: 'before_near_plane', horizontalPosition: 'behind_or_level_with_camera', imagePosition: null },
  ])
  const portrait = checkImageCameraGeometry({ ...input, aspectRatio: '9:16' })
  expect(portrait.relations[1]).toMatchObject({ framing: 'outside_frame', horizontalPosition: 'outside_horizontal_fov' })
  expect(result.horizontalFovDeg).toBeCloseTo(121.284493, 5)
  expect(input).toEqual(before)
  expect(checkCameraGeometry(input)).toEqual(result)
  expect(snapshotJsonValue(result)).toEqual(JSON.parse(JSON.stringify(result)))
})
it('uses the saved camera pitch and roll including an overhead camera', () => {
  const target = [{ id: 'target', label: 'Target', position: [0, 0, 0] }, { id: 'right', label: 'Right', position: [1, 0, 0] }]
  const top = { ...input, imageCamera: { position: [0, 0, 4], target: [0, 0, 0], verticalFov: 90 }, landmarks: target }
  const a = checkImageCameraGeometry(top), b = checkImageCameraGeometry({ ...top, imageCamera: { ...top.imageCamera, roll: 180 } })
  expect(a.relations[0]?.imagePosition).toEqual({ x: .5, y: .5 })
  expect(a.relations[1]!.imagePosition!.x).toBeGreaterThan(.5)
  expect(b.relations[1]!.imagePosition!.x).toBeLessThan(.5)
  const tilted = checkImageCameraGeometry({ ...input, imageCamera: { ...input.imageCamera, target: [0, 2, 2] }, landmarks: [{ id: 't', label: 'Target', position: [0, 2, 2] }] })
  expect(tilted.relations[0]?.imagePosition).toEqual({ x: .5, y: .5 })
})
it('identifies the rain draft daughter behind its claimed opening camera and fixes only the camera', () => {
  const rain = { ...input, imageCamera: { position: [3.5, 1.55, 1.4], target: [2.2, .16, 1.25], verticalFov: 45 },
    landmarks: [{ id: 'mother', label: 'Mother head', position: [1, 1.15, 1.3] }, { id: 'daughter', label: 'Daughter head', position: [3.95, 2.75, 1.65] }] }
  expect(checkImageCameraGeometry(rain).relations[1]?.framing).toBe('before_near_plane')
  const repaired = checkImageCameraGeometry({ ...rain,
    imageCamera: { position: [2.4, 5.8, 1.55], target: [2.4, 1.4, 1.1], verticalFov: 55 },
  })
  expect(repaired.relations.map(p => p.framing)).toEqual(['inside_frame', 'inside_frame'])
  expect(repaired.relations[0]!.imagePosition!.x).toBeGreaterThan(repaired.relations[1]!.imagePosition!.x)
  expect(repaired.layout.landmarks).toEqual(rain.landmarks)
  const fov = checkImageCameraGeometry({ ...input, imageCamera: { ...input.imageCamera, verticalFov: 44 } })
  expect(fov.horizontalFovDeg).toBeCloseTo(71.377019, 4)
})
it('does not emit enormous projections for points at or before the renderer near plane', () => {
  const result = checkImageCameraGeometry({ ...input, landmarks: [
    { id: 'zero', label: 'At camera', position: [0, 0, 1] },
    { id: 'near', label: 'Near', position: [0, .01, 1], frontDirection: [0, -1, 0] },
    { id: 'front', label: 'Front', position: [0, 2, 1], frontDirection: [0, -1, 0] },
  ] })
  expect(result.relations[0]).toMatchObject({ horizontalPosition: 'at_camera', imagePosition: null, facing: 'unknown' })
  expect(result.relations[1]?.imagePosition).toBeNull()
  expect(result.relations[2]).toMatchObject({ frontDot: 1, facing: 'front_toward_camera' })
})
it.each([
  { ...input, aspectRatio: 'unsupported' },
  { ...input, imageCamera: { ...input.imageCamera, horizontalFovDeg: 90 } },
  { ...input, imageCamera: { ...input.imageCamera, target: [0, 0, 1.001] } },
  { ...input, imageCamera: { ...input.imageCamera, verticalFov: NaN } },
  { ...input, landmarks: [input.landmarks[0], input.landmarks[0]] },
  { ...input, landmarks: [{ id: 'invalid', label: 'invalid', position: [0, 1] }] },
])('rejects mixed camera conventions or unusable inputs', value => expect(() => checkImageCameraGeometry(value)).toThrow())
