// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QingmuBrandMark, QingmuBrandName } from '../src/client/Brand.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots }
}

describe('Qingmu browser-brand plugin', () => {
  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills every brand slot for the Qingmu build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'qingmu')
    const qingmu = await bench()
    const fiber = qingmu.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(qingmu.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(qingmu.slots.entries(hole)).toHaveLength(0)

  })

  it('fails loud when loaded from a non-Qingmu client artifact', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const official = await bench()
    expect(() => { apply(official.ctx as never) }).toThrow(/requires a qingmu client artifact/)
  })

  it('renders the public name and scalable original mark', () => {
    const name = render(<QingmuBrandName />)
    expect(name.getByText('青木 OS')).toBeDefined()
    expect(name.container.textContent).not.toMatch(/deepseek|harness/iu)
    name.unmount()

    const mark = render(<QingmuBrandMark size={34} className="hero-mark" />)
    const svg = mark.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('height')).toBe('34')
    expect(svg?.getAttribute('class')).toBe('hero-mark')
    expect(svg?.querySelectorAll('path')).toHaveLength(3)
  })
})
