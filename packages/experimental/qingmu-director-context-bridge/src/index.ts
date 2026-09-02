/** Session-persistent Qingmu director context projection and UI-mountable bridge. */

import type { Context } from '@deepseek-ai/cordis'
import { directorContextBindingProjectionDefinition } from './projection.ts'

export { createDirectorContextBridge } from './bridge.ts'
export { directorContextBindingProjectionDefinition, directorContextBindingStateSchema } from './projection.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'experimental-qingmu-director-context-bridge'
/** The projection registry is the only runtime dependency. */
export const inject = ['sessionProjections']

/** Register the latest whole-value director binding projection. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(directorContextBindingProjectionDefinition)
}
