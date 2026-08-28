import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { QingmuCockpitFace } from '../src/client/slots.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Take technical-QC browser port boundary', () => {
  it('exposes read and command RPCs but never the Host-internal QC Method', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'qingmu')
    const call = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, value: {} }))
    let face: QingmuCockpitFace | undefined
    const ctx = {
      effect: (run: () => unknown) => { run() },
      locale: { register: vi.fn() },
      get: (name: string) => name === 'connection' ? { rpc: { call } } : undefined,
      slots: {
        inject: (_name: string, register: () => unknown) => { register() },
        register: (registration: { readonly inject: () => QingmuCockpitFace }) => {
          face = registration.inject()
        },
      },
    } as unknown as ClientContext
    apply(ctx)
    if (face === undefined) throw new Error('Qingmu cockpit port was not registered')
    const port = face.port
    const scope = { projectId: 'project-qc', episodeId: 'episode-qc', frameId: 'frame-qc' }
    const request = {
      ...scope,
      expectedEvidenceSnapshotSha256: '1'.repeat(64),
      takeId: 'asset-take-1',
      checks: [],
      idempotencyKey: `qingmu:take-technical-qc:v1:${'2'.repeat(64)}`,
    }

    expect(Object.hasOwn(port, 'takeTechnicalQcMethod')).toBe(false)
    await port.takeTechnicalQc(scope)
    await port.recordTakeTechnicalQc(request)
    await port.recoverTakeTechnicalQc(request)
    expect(call.mock.calls.map(args => args.slice(0, 3))).toEqual([
      ['/qingmu-yimeng', 'takeTechnicalQc', scope],
      ['/qingmu-yimeng-command', 'recordTakeTechnicalQc', request],
      ['/qingmu-yimeng-command', 'recoverTakeTechnicalQc', request],
    ])
    expect(call.mock.calls.some(args =>
      args[0] === '/qingmu-imago-method' && args[1] === 'takeTechnicalQcMethod')).toBe(false)
  })
})
