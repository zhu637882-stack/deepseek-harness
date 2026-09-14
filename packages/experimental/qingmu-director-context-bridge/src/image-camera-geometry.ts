/** Project attributed 3D landmarks using the camera convention of Qingmu's scene renderer. */
import { z } from 'zod'

const scalar = z.number().finite().min(-1000).max(1000).transform(n => n === 0 ? 0 : n)
const point = z.tuple([scalar, scalar, scalar])
type Vector = [number, number, number]
const subtract = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: Vector): Vector => { const length = Math.hypot(...v); return [v[0] / length, v[1] / length, v[2] / length] }
const round = (n: number) => { const result = Math.round(n * 1e6) / 1e6; return result === 0 ? 0 : result }
const schema = z.object({
  coordinateFrame: z.string().trim().min(1).max(2000),
  basis: z.string().trim().min(1).max(4000),
  aspectRatio: z.enum(['16:9', '9:16', '4:3', '3:4', '1:1']),
  imageCamera: z.object({ position: point, target: point,
    verticalFov: z.number().finite().min(10).max(120),
    roll: z.number().finite().min(-360).max(360).default(0),
  }).strict().refine(c => Math.hypot(...subtract(c.target, c.position)) >= .01, 'Camera and target must differ by at least .01 metre.'),
  landmarks: z.array(z.object({ id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200), position: point,
    frontDirection: point.refine(v => Math.hypot(...v) > 1e-9, 'Front direction must be nonzero.').optional(),
  }).strict()).min(1).max(128),
}).strict().refine(v => new Set(v.landmarks.map(p => p.id)).size === v.landmarks.length, 'Landmark IDs must be unique.')

/**
 * Check the actual saved image camera, including height, pitch, roll and aspect ratio.
 * @param input Attributed coordinates, imageCamera, aspectRatio and 3D landmark points.
 * @returns Normalized image positions and framing; no occlusion, physical measurement or media acceptance.
 */
export function checkImageCameraGeometry(input: unknown) {
  const layout = schema.parse(input), camera = layout.imageCamera
  const forward = unit(subtract(camera.target, camera.position))
  const worldUp: Vector = Math.abs(forward[2]) > .9999 ? [0, 1, 0] : [0, 0, 1]
  const baseRight = unit(cross(forward, worldUp)), baseDown = cross(forward, baseRight)
  const roll = camera.roll * Math.PI / 180
  const combine = (a: Vector, b: Vector, x: number, y: number): Vector =>
    [a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y]
  const right = combine(baseRight, baseDown, Math.cos(roll), Math.sin(roll))
  const down = combine(baseDown, baseRight, Math.cos(roll), -Math.sin(roll))
  const aspect = { '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '1:1': 1 }[layout.aspectRatio]
  const tangentV = Math.tan(camera.verticalFov * Math.PI / 360), tangentH = tangentV * aspect
  const relations = layout.landmarks.map((item) => {
    const relative = subtract(item.position, camera.position), distance = Math.hypot(...relative)
    const depth = dot(relative, forward), lateral = dot(relative, right), vertical = dot(relative, down)
    const horizontalPosition = distance <= 1e-9 ? 'at_camera' : depth <= 0 ? 'behind_or_level_with_camera'
      : Math.abs(lateral) > depth * tangentH + 1e-9 ? 'outside_horizontal_fov' : 'inside_horizontal_fov'
    const verticalPosition = depth <= 0 ? 'behind_or_level_with_camera'
      : Math.abs(vertical) > depth * tangentV + 1e-9 ? 'outside_vertical_fov' : 'inside_vertical_fov'
    const frontDot = item.frontDirection && distance > 1e-9 ? -dot(unit(item.frontDirection), relative) / distance : null
    return { id: item.id, label: item.label, depth: round(depth), lateral: round(lateral),
      bearingDeg: distance <= 1e-9 ? null : round(Math.atan2(lateral, depth) * 180 / Math.PI),
      horizontalPosition, verticalPosition,
      framing: depth < .05 ? 'before_near_plane' : horizontalPosition === 'outside_horizontal_fov' || verticalPosition === 'outside_vertical_fov' ? 'outside_frame' : 'inside_frame',
      imagePosition: depth < .05 ? null : {
        x: round(.5 + lateral / (2 * depth * tangentH)), y: round(.5 + vertical / (2 * depth * tangentV)),
      },
      frontDot: frontDot === null ? null : round(frontDot),
      facing: frontDot === null ? 'unknown' : Math.abs(frontDot) <= 1e-9 ? 'edge_on' : frontDot > 0 ? 'front_toward_camera' : 'back_toward_camera' }
  })
  return { schema: 'qingmu.image-camera-geometry.v1', layout,
    horizontalFovDeg: round(2 * Math.atan(tangentH) * 180 / Math.PI), relations,
    providerCalls: 0, businessStateChanged: false,
    interpretation: 'Uses the saved imageCamera convention: metres, x/y ground and z up, verticalFov in degrees, the stated aspect ratio and roll. Image coordinates are normalized from top-left (0,0) to bottom-right (1,1); outside values remain outside. The .05 metre near plane matches the blockout renderer. These are attributed landmark points, not object extents or measured image features. Include separate head, hand, foot or prop endpoints when relevant. An in-frame point may be occluded; use the shared-layout preview and actual image review. Never move source landmarks merely to pass framing. This does not establish physical proportions or generated-image fidelity.' }
}
