/** Package-owned invariant companion for the inert creative skill catalog. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-qingmu-creative-skill-catalog'

export const name = 'experimental-qingmu-creative-skill-catalog-invariant'
export const inject = ['invariants']

/** No runtime invariant: catalog construction validates and hashes every card. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
