/** Package-owned invariant companion for the stateless IMAGO method adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'

export const name = 'experimental-qingmu-imago-method-adapter-invariant'
export const inject = ['invariants']

/** No runtime invariant: each projection is fully bound to input and source SHA values. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
