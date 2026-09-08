import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, composeEntries, type Profile } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProfile } from '../src/profile-boot.ts'

const state = vi.hoisted(() => ({ profile: undefined as Profile | undefined }))

// Keep profile composition and its patch algorithm real, without opening a
// server, healing a user's module tree, or installing process-fatal handlers.
vi.mock('@deepseek-ai/dsh-app-boot', async original => ({
  ...await original<typeof import('@deepseek-ai/dsh-app-boot')>(),
  healProfilesModuleFallback: vi.fn(),
  loadProfile: vi.fn(() => state.profile),
  loadOptionalPatches: vi.fn(() => []),
  installFailLoud: vi.fn(),
  boot: vi.fn(async () => {
    const ctx = new Context()
    await ctx.fiber.dispose()
    return ctx
  }),
}))

let root: string
let signals: Map<'SIGTERM' | 'SIGINT', NodeJS.SignalsListener[]>

beforeEach(async () => {
  vi.clearAllMocks()
  root = await mkdtemp(join(tmpdir(), 'dsh-profile-preset-roots-'))
  signals = new Map((['SIGTERM', 'SIGINT'] as const).map(signal => [signal, process.listeners(signal)]))
})

afterEach(async () => {
  for (const [signal, existing] of signals) {
    for (const listener of process.listeners(signal)) {
      if (!existing.includes(listener)) process.removeListener(signal, listener)
    }
  }
  await rm(root, { recursive: true, force: true })
})

describe('profile launcher preset roots', () => {
  it.each([false, true])('adds only this profile’s bundle preset roots (bundle present: %s)', async (withBundle) => {
    const presetRoot = join(root, 'bundle', 'agent-presets')
    state.profile = {
      name: 'fixture', dir: root, patchPath: join(root, 'cordis.patch.yml'), patches: [],
      layers: [{
        packageName: 'fixture-bundle', packageDir: root, patchPath: join(root, 'bundle.yml'),
        patches: [{ insert: [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'fixture', includeUserRoot: false } }] }],
        ...(withBundle ? { agentPresetRoot: presetRoot } : {}),
      }],
    }
    await runProfile({ profile: 'fixture', args: [], patchFiles: [], environment: createLaunchEnvironmentSnapshot([]) })
    const patches = vi.mocked(boot).mock.calls[0]?.[2]
    expect(patches).toBeDefined()
    const roster = composeEntries([patches!]).find(entry => entry.id === 'agent-presets')
    expect(roster?.config).toMatchObject({ default: 'fixture', includeUserRoot: false })
    const roots = (roster?.config as { roots: { path: string; trust: string }[] }).roots
    expect(roots[0]?.path).toMatch(/apps[/\\]cli[/\\]config[/\\]agent-presets[/\\]?$/)
    expect(roots[0]?.trust).toBe('system')
    expect(roots.slice(1)).toEqual(withBundle ? [{ path: presetRoot, trust: 'system' }] : [])
  })
})
