import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, createImagoMethodHandler } from '../src/index.ts'
import { DIRECTOR_REPLAY_PLAN_PATH } from '../src/director-replay.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) })) })

async function coreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-director-replay-'))
  roots.push(root)
  const plan = join(root, DIRECTOR_REPLAY_PLAN_PATH)
  await mkdir(dirname(plan), { recursive: true })
  await writeFile(plan, '# Existing Qingmu integration plan\n\nH2 / H3 replay fixture.\n')
  return root
}

describe('director replay IMAGO method', () => {
  it('loads a deterministic zero-authority package from the existing plan', async () => {
    const handler = createImagoMethodHandler({ coreRoot: await coreRoot() })
    const first = await handler('directorReplayMethod', { purpose: 'bounded_director_suggestion' }, new AbortController().signal)
    const second = await handler('directorReplayMethod', { purpose: 'bounded_director_suggestion' }, new AbortController().signal)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true, value: {
      schema: 'qingmu.imago-director-replay-method-package.v1',
      integrationCoordinates: ['H2', 'H3-precondition-replay'],
      authority: { businessTruth: 'yimeng', replayOnly: true, providerCalls: 0, maximumCostCny: '0',
        humanDecisionInferred: false, formalQcInferred: false, selectionGranted: false, readyGranted: false },
    } })
  })

  it('keeps the replay package Host-only', async () => {
    const handle = vi.fn((_channel: string, _handler: ConnectionRpcHandler, _options: ConnectionRpcHandlerOptions) => async () => {})
    const provide = vi.fn()
    apply({ provide, connection: { rpc: { handle } } } as unknown as Context, { coreRoot: await coreRoot() })
    const host = provide.mock.calls[0]?.[1] as ConnectionRpcHandler
    const browser = handle.mock.calls[0]?.[1]
    expect(await host('directorReplayMethod', { purpose: 'bounded_director_suggestion' }, new AbortController().signal)).toMatchObject({ ok: true })
    expect(await browser?.('directorReplayMethod', { purpose: 'bounded_director_suggestion' }, new AbortController().signal)).toMatchObject({
      ok: false, error: { message: 'Requested IMAGO Method is Host-internal' },
    })
  })
})
