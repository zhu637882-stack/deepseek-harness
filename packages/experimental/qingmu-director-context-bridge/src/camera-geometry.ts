/** Ground-plane camera relations from an explicit director-authored layout. */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

// The session's lossless JSON boundary cannot retain JavaScript's signed zero.
const canonicalZero = (value: number) => value === 0 ? 0 : value
const number = z.number().finite().min(-1000000).max(1000000).transform(canonicalZero)
const point = z.tuple([number, number])
const nonzero = (v: readonly [number, number]) => Math.hypot(v[0], v[1]) > 1e-9
const layoutSchema = z.object({
  coordinateFrame: z.string().trim().min(1).max(2000),
  basis: z.string().trim().min(1).max(4000),
  camera: z.object({ position: point, lookAt: point,
    horizontalFovDeg: z.number().finite().min(1).max(179) }).strict(),
  landmarks: z.array(z.object({ id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200), position: point,
    frontDirection: point.refine(nonzero, 'The front direction must be nonzero.').optional(),
  }).strict()).min(1).max(128),
}).strict().superRefine((layout, ctx) => {
  const { position, lookAt } = layout.camera
  if (!nonzero([lookAt[0] - position[0], lookAt[1] - position[1]])) {
    ctx.addIssue({ code: 'custom', path: ['camera', 'lookAt'], message: 'Camera position and lookAt must differ.' })
  }
  if (new Set(layout.landmarks.map(item => item.id)).size !== layout.landmarks.length) {
    ctx.addIssue({ code: 'custom', path: ['landmarks'], message: 'Each landmark needs a unique id.' })
  }
})

/**
 * Project landmark centers into one camera's horizontal frame without moving the set.
 * @param input - A common planar coordinate frame, input provenance, camera and landmarks.
 * @returns Signed lateral/depth positions and facing relations conditional on the supplied layout.
 */
export function checkCameraGeometry(input: unknown) {
  const layout = layoutSchema.parse(input)
  const { position, lookAt, horizontalFovDeg } = layout.camera
  const dx = lookAt[0] - position[0], dy = lookAt[1] - position[1]
  const length = Math.hypot(dx, dy), forward = [dx / length, dy / length] as const
  const right = [forward[1], -forward[0]] as const
  const round = (value: number) => canonicalZero(Math.round(value * 1000000) / 1000000)
  const relations = layout.landmarks.map((item) => {
    const x = item.position[0] - position[0], y = item.position[1] - position[1]
    const distance = Math.hypot(x, y), depth = x * forward[0] + y * forward[1]
    const lateral = x * right[0] + y * right[1]
    const angle = distance <= 1e-9 ? 0 : (Math.atan2(lateral, depth) * 180 / Math.PI + 360) % 360
    let frontDot: number | null = null
    if (item.frontDirection && distance > 1e-9) {
      const [fx, fy] = item.frontDirection
      frontDot = -(fx * x + fy * y) / (Math.hypot(fx, fy) * distance)
    }
    return { id: item.id, label: item.label, lateral: round(lateral), depth: round(depth),
      bearingDeg: distance <= 1e-9 ? null : round(angle > 180 ? angle - 360 : angle),
      horizontalPosition: distance <= 1e-9 ? 'at_camera' : depth <= 0 ? 'behind_or_level_with_camera'
        : Math.min(angle, 360 - angle) > horizontalFovDeg / 2 ? 'outside_horizontal_fov' : 'inside_horizontal_fov',
      frontDot: frontDot === null ? null : round(frontDot),
      facing: frontDot === null ? 'unknown' : Math.abs(frontDot) <= 1e-9 ? 'edge_on'
        : frontDot > 0 ? 'front_toward_camera' : 'back_toward_camera' }
  })
  return { schema: 'qingmu.camera-geometry.v1', layout, relations, providerCalls: 0,
    businessStateChanged: false,
    interpretation: 'All coordinates share the supplied ground plane: x increases right, y increases up on the plan. Lateral < 0 is image left; > 0 is image right. Depth > 0 is in front of the camera. frontDirection points out from the named object front, not along its length. Results describe landmark centers; they do not establish actual visibility, occlusion, height, lens distortion or image fidelity. This evaluates one supplied camera, not the feasibility of every camera or the artistic validity of a shot. Coordinates and facing are supplied assumptions, not measurements inferred by this tool. Preserve source facts and mark estimates; never move landmarks to obtain a desired result. Save the applicable layout and camera conclusions in the existing scene space and shot/asset design.' }
}

/**
 * Register a local calculation tool in the existing director scope.
 * @param ctx - Scoped director tool registry.
 * @param boundedJson - Existing complete-response size check.
 */
export function registerCameraGeometryTool(ctx: Context, boundedJson: (value: unknown) => JsonValue): void {
  ctx.tools.register(defineTool({
    name: 'qingmu_check_camera_geometry',
    description: 'Check a camera change against one explicit ground-plane layout. Computes image left/right, front/behind, horizontal field of view and object front/back facing. Use after reading current scene design and actual reference images when spatial prose is ambiguous. Supply the same landmark coordinates for every camera; distinguish observed relationships from director-designed or approximate positions in basis. This is local math, not image analysis or a renderer; no provider call, save or approval.',
    parameters: { layout: { type: 'json', required: true,
      description: 'Object with coordinateFrame (x/y axes, origin and units), basis (source and uncertainties), camera:{position:[x,y],lookAt:[x,y],horizontalFovDeg:1..179}, landmarks:[{id,label,position:[x,y],frontDirection?:[dx,dy]}]. Same right-handed ground-plane axes throughout; x right and y up on the plan. frontDirection is the outward normal of the meaningful front (e.g. seat-facing direction), not the furniture long axis. Relative units are allowed. Omit unknown fronts. 1..128 uniquely identified landmarks; no filesystem paths.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '核对场景机位与朝向' }),
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (Object.keys(args).length !== 1) throw new Error('Only the explicit layout is accepted.')
      return boundedJson(checkCameraGeometry(args.layout))
    },
  }))
}
