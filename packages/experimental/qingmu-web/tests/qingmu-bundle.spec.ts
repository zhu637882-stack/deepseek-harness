import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

describe('Qingmu Web distribution composition', () => {
  it('layers Qingmu brand, Yimeng adapters, and the production cockpit over the stock Web bundle', () => {
    const layers = [
      'packages/bundle/base/cordis.patch.yml',
      'packages/bundle/web-app/cordis.patch.yml',
      'packages/experimental/qingmu-web/cordis.patch.yml',
    ].map(path => loadOverlayPatches('qingmu-test', `${ROOT}/${path}`))
    const entries = composeEntries(layers)

    expect(entries.filter(entry => entry.id === 'ui-brand-official')).toEqual([
      expect.objectContaining({ id: 'ui-brand-official', disabled: true }),
    ])
    expect(entries.filter(entry => entry.id === 'ui-brand-qingmu')).toEqual([
      expect.objectContaining({
        id: 'ui-brand-qingmu',
        name: '@deepseek-ai/dsh-experimental-client-ui-brand-qingmu',
      }),
    ])
    expect(entries.filter(entry => entry.id === 'qingmu-yimeng-read-adapter')).toEqual([
      expect.objectContaining({
        id: 'qingmu-yimeng-read-adapter',
        name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-read-adapter',
      }),
    ])
    expect(entries.filter(entry => entry.id === 'qingmu-imago-method-adapter')).toEqual([
      expect.objectContaining({
        id: 'qingmu-imago-method-adapter',
        name: '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter',
      }),
    ])
    expect(entries.find(entry => entry.id === 'qingmu-imago-method-adapter'))
      .not.toHaveProperty('config.coreRoot')
    expect(entries.filter(entry => entry.id === 'qingmu-yimeng-command-adapter')).toEqual([
      expect.objectContaining({
        id: 'qingmu-yimeng-command-adapter',
        name: '@deepseek-ai/dsh-experimental-qingmu-yimeng-command-adapter',
      }),
    ])
    expect(entries.filter(entry => entry.id === 'ui-qingmu-cockpit')).toEqual([
      expect.objectContaining({
        id: 'ui-qingmu-cockpit',
        name: '@deepseek-ai/dsh-experimental-client-ui-qingmu-cockpit',
      }),
    ])

    const readAdapterIndex = entries.findIndex(entry => entry.id === 'qingmu-yimeng-read-adapter')
    const methodAdapterIndex = entries.findIndex(entry => entry.id === 'qingmu-imago-method-adapter')
    const commandAdapterIndex = entries.findIndex(entry => entry.id === 'qingmu-yimeng-command-adapter')
    const cockpitIndex = entries.findIndex(entry => entry.id === 'ui-qingmu-cockpit')
    expect(readAdapterIndex).toBeGreaterThanOrEqual(0)
    expect(methodAdapterIndex).toBeGreaterThan(readAdapterIndex)
    expect(commandAdapterIndex).toBeGreaterThan(methodAdapterIndex)
    expect(cockpitIndex).toBeGreaterThan(commandAdapterIndex)
  })
})
