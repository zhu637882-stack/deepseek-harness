/** Package-owned invariant companion for the Qingmu director context bridge. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-qingmu-director-context-bridge'

/** Cordis companion plugin name. */
export const name = 'experimental-qingmu-director-context-bridge-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: strict event schemas and whole-value replay own this package's state boundary. */
const install: InvariantInstaller = () => {}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
