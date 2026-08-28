// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  QingmuYimengReadPort, YimengCapabilityCatalogResponse,
} from '../src/client/contracts.ts'
import { GenerationCapabilityCatalog } from '../src/client/GenerationCapabilityCatalog.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'

type Port = Pick<QingmuYimengReadPort, 'capabilityCatalog'>
const t = (key: QingmuCockpitKey) => zh[key]
const sha = 'a'.repeat(64)

function catalog(): YimengCapabilityCatalogResponse {
  return {
    schema: 'jason.provider-capability-catalog.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    activeProfile: 'quality',
    catalogSnapshotSha256: 'b'.repeat(64),
    requestSnapshotSha256: 'c'.repeat(64),
    preflightSnapshotSha256: 'd'.repeat(64),
    request: { modelId: null, capability: null, requestedControls: [], dryRun: true },
    items: [{
      capabilitySnapshotId: `capability-snapshot:sha256:${sha}`,
      capabilitySnapshotSha256: sha,
      capabilitySnapshotCanonicalJson: '{}',
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
      snapshot: {
        schema: 'jason.provider-capability-snapshot.v1',
        modelId: 'fake-video-v1', providerId: 'fake', familyId: 'fake-video',
        displayName: 'Gate A Fake Video', enabled: true,
        inputs: { prompt: 'string', first_frame_url: 'url_optional' }, outputs: { video_url: 'url' },
        geometry: { min_duration_sec: 2, max_duration_sec: 8, resolutions: ['720P'] },
        consistency: {
          capabilities: ['video.continuation', 'video.first_frame', 'video.visual'],
          referenceAware: true,
        },
        controls: ['video.continuation', 'video.first_frame', 'video.visual'],
        mutualExclusions: [{
          ruleId: 'fake-first-frame-or-continuation',
          controls: ['video.continuation', 'video.first_frame'],
          maxSelected: 1,
        }],
        cost: { currency: 'CNY', unit: 'second', by_resolution: { '720P': 0 } },
        runtime: { endpoint: '', endpointsByCapability: {}, deploymentScope: '', region: '' },
        compliance: {
          docs: ['test://gate-a-fake'], evidenceLevel: 'L2', paidDispatchAllowed: false,
          paidDispatchByCapability: {}, productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
        },
        declaration: {
          inputsDeclared: true, outputsDeclared: true, geometryDeclared: true,
          mutualExclusionsDeclared: true, errors: [],
        },
      },
      eligibility: {
        evaluated: false, eligible: false, errors: ['requirements_not_supplied'],
      },
    }],
    providerCalls: 0,
    databaseWrites: 0,
    paidGenerationAuthorized: false,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('missing resolver') }
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Gate A capability catalog', () => {
  it('shows Yimeng-owned snapshots, mutual exclusions, hashes, and zero-authority receipt', async () => {
    const port = { capabilityCatalog: vi.fn<Port['capabilityCatalog']>().mockResolvedValue(catalog()) }
    render(<GenerationCapabilityCatalog enabled port={port} t={t} />)

    expect(await screen.findByText('Gate A Fake Video')).toBeTruthy()
    expect(screen.getByText('fake-first-frame-or-continuation')).toBeTruthy()
    expect(screen.getAllByText(zh.capabilityCatalogUnverified).length).toBeGreaterThan(0)
    expect(screen.getByText('b'.repeat(64))).toBeTruthy()
    expect(screen.getByText(zh.capabilityCatalogZeroAuthority)).toBeTruthy()
    expect(port.capabilityCatalog).toHaveBeenCalledExactlyOnceWith({}, expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: zh.capabilityCatalogRefresh }))
    await waitFor(() => { expect(port.capabilityCatalog).toHaveBeenCalledTimes(2) })
  })

  it('surfaces a read-adapter rejection without rendering stale capability truth', async () => {
    const port = { capabilityCatalog: vi.fn<Port['capabilityCatalog']>().mockRejectedValue(
      new Error('Yimeng capability catalog wire boundary rejected paid authority'),
    ) }
    render(<GenerationCapabilityCatalog enabled port={port} t={t} />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Yimeng capability catalog wire boundary rejected paid authority',
    )
    expect(screen.queryByText('Gate A Fake Video')).toBeNull()
  })

  it('drops a late response after the generation view is disabled', async () => {
    const pending = deferred<YimengCapabilityCatalogResponse>()
    const port = { capabilityCatalog: vi.fn<Port['capabilityCatalog']>().mockImplementation(async () => pending.promise) }
    const view = render(<GenerationCapabilityCatalog enabled port={port} t={t} />)
    expect(screen.getByRole('status').textContent).toContain(zh.capabilityCatalogLoading)

    view.rerender(<GenerationCapabilityCatalog enabled={false} port={port} t={t} />)
    await act(async () => { pending.resolve(catalog()); await pending.promise })

    expect(screen.queryByText('Gate A Fake Video')).toBeNull()
    expect(port.capabilityCatalog).toHaveBeenCalledOnce()
  })
})
