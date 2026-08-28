import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { QingmuCockpitFace } from '../src/client/slots.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Take approval lifecycle browser port boundary', () => {
  it('exposes separate read, current Method, transition, and GET-only recovery RPCs', async () => {
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
    const scope = { projectId: 'project-e7-4', episodeId: 'episode-e7-4', frameId: 'frame-e7-4' }
    const request = {
      ...scope,
      expectedSourceSnapshotSha256: '1'.repeat(64),
      takeId: 'take-e7-4',
      action: 'APPROVE' as const,
      reason: '当前审片决定和技术 QC 均已核对。',
      idempotencyKey: `qingmu:take-approval-lifecycle:v1:${'2'.repeat(64)}`,
    }

    await face.port.takeApprovalLifecycle(scope)
    await face.port.takeApprovalLifecycleMethod(scope)
    await face.port.transitionTakeApprovalLifecycle(request)
    await face.port.recoverTakeApprovalLifecycleTransition(request)
    expect(call.mock.calls.map(args => args.slice(0, 3))).toEqual([
      ['/qingmu-yimeng', 'takeApprovalLifecycle', scope],
      ['/qingmu-imago-method', 'takeApprovalLifecycleMethod', scope],
      ['/qingmu-yimeng-command', 'transitionTakeApprovalLifecycle', request],
      ['/qingmu-yimeng-command', 'recoverTakeApprovalLifecycleTransition', request],
    ])
  })
})
