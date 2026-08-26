/** Qingmu OS occupants for the generic browser-brand slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { QingmuBrandMark, QingmuBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/** Fill the three generic brand slots only in a Qingmu client build. */
export function apply(ctx: ClientContext): void {
  const buildProfile = process.env.DSH_CLIENT_BUILD_PROFILE
  if (buildProfile !== 'qingmu') {
    throw new Error(`Qingmu brand requires a qingmu client artifact; got ${JSON.stringify(buildProfile)}`)
  }
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, QingmuBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, QingmuBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, QingmuBrandMark)
      })))
}
