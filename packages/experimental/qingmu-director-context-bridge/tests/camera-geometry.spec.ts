import { describe, expect, it } from 'vitest'
import { checkCameraGeometry } from '../src/camera-geometry.ts'

export const layout = {
  coordinateFrame: 'Relative units; x toward window wall, y toward rear wall, origin at room center.',
  basis: 'Director-designed rehearsal layout; not a measured room.',
  camera: { position: [4, 0], lookAt: [0, 0], horizontalFovDeg: 90 },
  landmarks: [
    { id: 'seat', label: 'Seat faces window wall', position: [0, 0], frontDirection: [1, 0] },
    { id: 'door', label: 'Rear doorway', position: [0, 2] },
    { id: 'lamp', label: 'Lamp behind camera', position: [5, 0] },
    { id: 'side', label: 'Outside framing', position: [3, 3] },
  ],
}

describe('camera relations keep one set while changing viewpoint', () => {
  it('sees a seat front from its facing side, and its back from the other side', () => {
    const before = structuredClone(layout)
    const fromRight = checkCameraGeometry(layout)
    expect(fromRight.relations).toMatchObject([
      { id: 'seat', facing: 'front_toward_camera', depth: 4, lateral: 0 },
      { id: 'door', lateral: 2, horizontalPosition: 'inside_horizontal_fov', facing: 'unknown' },
      { id: 'lamp', horizontalPosition: 'behind_or_level_with_camera' },
      { id: 'side', horizontalPosition: 'outside_horizontal_fov' },
    ])
    const fromLeft = checkCameraGeometry({ ...layout, camera: { ...layout.camera, position: [-4, 0] } })
    expect(fromLeft.relations[0]).toMatchObject({ facing: 'back_toward_camera', depth: 4 })
    expect(fromLeft.relations[1]!.lateral).toBe(-2)
    expect(layout).toEqual(before)
  })
  it('preserves angles and facing under a common rotation, translation and scale', () => {
    const transform = ([x, y]: number[]) => [7 - 3 * y!, 2 + 3 * x!]
    const transformed = checkCameraGeometry({ ...layout,
      camera: { ...layout.camera, position: transform(layout.camera.position), lookAt: transform(layout.camera.lookAt) },
      landmarks: layout.landmarks.map(item => ({ ...item, position: transform(item.position),
        ...(item.frontDirection ? { frontDirection: [-item.frontDirection[1]!, item.frontDirection[0]!] } : {}) })),
    })
    const original = checkCameraGeometry(layout)
    for (const [index, relation] of transformed.relations.entries()) {
      const prior = original.relations[index]!
      expect(relation).toMatchObject({ facing: prior.facing, frontDot: prior.frontDot,
        horizontalPosition: prior.horizontalPosition, bearingDeg: prior.bearingDeg })
      expect(relation.depth).toBeCloseTo(3 * prior.depth)
      expect(relation.lateral).toBeCloseTo(3 * prior.lateral)
    }
  })
  it('does not pretend to determine a front at the camera center or a hidden face', () => {
    const result = checkCameraGeometry({ ...layout, landmarks: [
      { id: 'at', label: 'At camera', position: [4, 0], frontDirection: [1, 0] },
      { id: 'edge', label: 'Side view', position: [0, 0], frontDirection: [0, 1] },
    ] })
    expect(result.relations).toMatchObject([
      { horizontalPosition: 'at_camera', facing: 'unknown', bearingDeg: null }, { facing: 'edge_on' },
    ])
    expect(result.providerCalls).toBe(0)
    expect(result.interpretation).toContain('do not establish actual visibility')
  })
  it.each([
    { ...layout, camera: { ...layout.camera, lookAt: [4, 0] } },
    { ...layout, landmarks: [layout.landmarks[0], layout.landmarks[0]] },
    { ...layout, landmarks: [{ ...layout.landmarks[0], frontDirection: [0, 0] }] },
    { ...layout, camera: { ...layout.camera, position: [NaN, 0] } },
    { ...layout, camera: { ...layout.camera, horizontalFovDeg: 180 } },
    { ...layout, basis: '' },
  ])('rejects an ambiguous or invalid geometric input', (invalid) => {
    expect(() => checkCameraGeometry(invalid)).toThrow()
  })
})
