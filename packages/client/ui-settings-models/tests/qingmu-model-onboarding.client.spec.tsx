// @vitest-environment jsdom
/** Provider-neutral Qingmu first-run behavior over the shared Models join. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { QingmuModelOnboarding } from '../src/client/QingmuModelOnboarding.tsx'
import type { QingmuModelOnboardingProps } from '../src/client/QingmuModelOnboarding.tsx'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

function state(
  status: ModelsSettingsState['status'],
  rows: ModelsSettingsState['rows'] = [],
): ModelsSettingsState {
  return {
    status,
    error: status === 'error' ? 'connection unavailable' : null,
    credentialError: null,
    writable: false,
    rows,
    namespaces: new Map(),
  }
}

function harness(
  initial: ModelsSettingsState,
  loaded: ModelsSettingsState = state('ready'),
) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const store = createSnapshotStore<ModelsSettingsState>(initial)
  const load = vi.fn(async () => {
    store.update((snapshot) => { Object.assign(snapshot, loaded) })
  })
  const controller = { store, load } as unknown as ModelsSettingsStore
  const complete = vi.fn()
  const openSection = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: QingmuModelOnboardingProps = {
    stepId: 'qingmu-models',
    complete,
    openSection,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    useModels: bindSnapshotSelector(store),
    t: key => en[key],
  }
  return { complete, load, openSection, props }
}

describe('QingmuModelOnboarding', () => {
  it('loads the directory and offers provider-neutral model settings', async () => {
    const h = harness(state('idle'))
    render(<QingmuModelOnboarding {...h.props} />)

    expect(await screen.findByRole('dialog', { name: en.qingmuOnboardingTitle })).toBeTruthy()
    expect(h.load).toHaveBeenCalledOnce()
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(en.qingmuOnboardingDescription).textContent).not.toMatch(/deepseek/iu)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: en.qingmuOnboardingTitle }))
    })

    fireEvent.click(screen.getByRole('button', { name: en.qingmuOnboardingOpenModels }))
    expect(h.openSection).toHaveBeenCalledWith('models')
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('allows a deliberate read-only entry without opening Models', () => {
    const h = harness(state('ready'))
    render(<QingmuModelOnboarding {...h.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.qingmuOnboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
  })

  it('completes silently when any provider is already usable', async () => {
    const usable = {
      entry: {
        provider: 'local-compatible',
        displayName: 'Local compatible service',
        settingsNs: '',
        settingsPath: [],
        active: true,
      },
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }
    const h = harness(state('ready', [usable]))
    render(<QingmuModelOnboarding {...h.props} />)
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.openSection).not.toHaveBeenCalled()
  })

  it('keeps recovery choices available when the directory load failed', () => {
    const h = harness(state('error'))
    render(<QingmuModelOnboarding {...h.props} />)
    expect(screen.getByRole('alert').textContent).toBe(en.qingmuOnboardingLoadError)
    expect(screen.getByRole('button', { name: en.qingmuOnboardingOpenModels })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.qingmuOnboardingLater })).toBeTruthy()
  })
})
