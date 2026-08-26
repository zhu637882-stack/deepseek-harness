/** Package-owned invariant companion for the Qingmu production cockpit. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit'

export const name = 'experimental-client-ui-qingmu-cockpit-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: build-profile and RPC boundary checks live at their actual client/Host seams.
}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
