import { describe, expect, it, vi } from 'vitest'
import { createYimengReadHandler } from '../src/index.ts'
import {
  PRODUCTION_UNIT_REQUEST as request, productionUnitBinding, productionUnitDefinition,
  productionUnitSha, productionUnitSource, productionUnitsFeed,
} from './production-unit-fixture.ts'

function reader(value: unknown, token: string | undefined = 'host-unit-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value))
  const handler = createYimengReadHandler(
    { baseUrl: 'http://127.0.0.1:18815' }, { fetch, readToken: () => token },
  )
  return { fetch, handler }
}

const signal = () => new AbortController().signal

function feedWithSource(changes: Record<string, unknown>) {
  const original = productionUnitsFeed()
  const subject = { ...productionUnitSource(), ...changes }
  const snapshotSha256 = productionUnitSha(subject)
  const binding = { ...productionUnitBinding(), source: subject, sourceSnapshotSha256: snapshotSha256 }
  return {
    ...original,
    groups: [{ groupId: 'group-three', subject, snapshotSha256, availability: { status: 'available', reason: null } }],
    bindings: [{ binding, bindingSha256: productionUnitSha(binding), currentBinding: true }],
  }
}

function feedWithBinding(changes: Record<string, unknown>) {
  const binding = { ...productionUnitBinding(), ...changes }
  return {
    ...productionUnitsFeed(),
    bindings: [{ binding, bindingSha256: productionUnitSha(binding), currentBinding: true }],
  }
}

async function expectContractFailure(value: unknown) {
  const { handler, fetch } = reader(value)
  expect(await handler('productionUnits', request, signal())).toEqual({
    ok: false, error: { code: 'internal', message: 'Yimeng response contract failed', details: {} },
  })
  expect(fetch).toHaveBeenCalledOnce()
}

describe('production unit read-only scope bindings', () => {
  it('preserves the current source and explicit unit without deriving its ID from group order', async () => {
    const feed = productionUnitsFeed()
    const { handler, fetch } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
    expect(fetch).toHaveBeenCalledOnce()
    const call = fetch.mock.calls[0]
    expect(call?.[0]).toBe('http://127.0.0.1:18815/api/qingmu/projects/project-unit/episodes/episode-unit/production-units')
    expect(call?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(new Headers(call?.[1]?.headers).get('authorization')).toBe('Bearer host-unit-token')
    expect(call?.[1]?.body).toBeUndefined()
  })

  it('retains history when the current group is unavailable without revoking owner capability', async () => {
    const original = productionUnitsFeed()
    const feed = {
      ...original,
      groups: original.groups.map(group => ({
        ...group, subject: null, snapshotSha256: null,
        availability: { status: 'unavailable', reason: 'shot_group_needs_repartition' },
      })),
      bindings: original.bindings.map(item => ({ ...item, currentBinding: false })),
    }
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('rejects a forged current-binding claim instead of silently upgrading or repairing it', async () => {
    const feed = productionUnitsFeed()
    const { handler } = reader({ ...feed, bindings: feed.bindings.map(item => ({ ...item, currentBinding: false })) })
    expect(await handler('productionUnits', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('does not create a unit when no explicit binding exists', async () => {
    const feed = { ...productionUnitsFeed(), bindings: [] }
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('keeps a deleted group binding readable and historical', async () => {
    const original = productionUnitsFeed()
    const feed = { ...original, groups: [], bindings: original.bindings.map(item => ({ ...item, currentBinding: false })) }
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('keeps the old source unchanged after a new storyboard revision or member content', async () => {
    const original = productionUnitsFeed()
    const source = {
      ...productionUnitSource(), storyboardRevision: 4,
      shots: [{ frameId: 'frame-z', frameNo: 7, frameContentSha256: '9'.repeat(64) }],
    }
    const feed = {
      ...original,
      groups: [{ groupId: source.groupId, subject: source, snapshotSha256: productionUnitSha(source),
        availability: { status: 'available', reason: null } }],
      bindings: original.bindings.map(item => ({ ...item, currentBinding: false })),
    }
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
    await expectContractFailure({ ...feed, bindings: original.bindings })
  })

  it('does not infer owner permission from available sources or a historical actor', async () => {
    const feed = { ...productionUnitsFeed(), capabilities: { canBindUnit: false } }
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  it('retains a sealed earlier method definition without claiming it is the current runtime', async () => {
    const definition = { ...productionUnitDefinition(), version: 'historical-definition',
      stages: [{ stageId: 'F', roleId: 'F', contractSha256: 'e'.repeat(64) }] }
    const feed = feedWithBinding({ definition, revision: 4 })
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  it.each([
    { name: 'zero source revision', change: { storyboardRevision: 0 } },
    { name: 'maximum safe group number', change: { groupNo: Number.MAX_SAFE_INTEGER } },
    { name: 'maximum safe storyboard revision', change: { storyboardRevision: Number.MAX_SAFE_INTEGER } },
    { name: 'FEFF author text', change: { title: '\ufeff' } },
    { name: '8000 Unicode code points', change: { title: '🎬'.repeat(8_000) } },
    { name: 'nonconsecutive canonical Shot numbers', change: {
      shots: [
        { frameId: 'frame-z', frameNo: 7, frameContentSha256: '7'.repeat(64) },
        { frameId: 'frame-1', frameNo: Number.MAX_SAFE_INTEGER, frameContentSha256: 'c'.repeat(64) },
      ],
    } },
  ])('preserves $name', async ({ change }) => {
    const feed = feedWithSource(change)
    const { handler } = reader(feed)
    expect(await handler('productionUnits', request, signal())).toEqual({ ok: true, value: feed })
  })

  const invalidRoots: { name: string; change: Record<string, unknown> }[] = [
    { name: 'unknown schema', change: { schema: 'jason.qingmu-production-unit-feed.v2' } },
    { name: 'another project', change: { projectId: 'other-project' } },
    { name: 'another episode', change: { episodeId: 'other-episode' } },
    { name: 'unknown approval field', change: { approved: true } },
    { name: 'non-array groups', change: { groups: {} } },
    { name: 'non-array bindings', change: { bindings: null } },
    { name: 'plan seal claim', change: { planSealed: true } },
    { name: 'numeric plan flag', change: { planSealed: 0 } },
    { name: 'Provider call claim', change: { providerCalls: 1 } },
    { name: 'boolean Provider count', change: { providerCalls: false } },
    { name: 'human approval claim', change: { humanSignoffInferred: true } },
    { name: 'rework execution claim', change: { reworkExecuted: true } },
    { name: 'invalid permission', change: { capabilities: { canBindUnit: 1 } } },
    { name: 'extra permission', change: { capabilities: { canBindUnit: true, canApprove: true } } },
  ]
  it.each(invalidRoots)('rejects $name', async ({ change }) => {
    await expectContractFailure({ ...productionUnitsFeed(), ...change })
  })

  const invalidSources: { name: string; change: Record<string, unknown> }[] = [
    { name: 'unknown source schema', change: { schema: 'source.v2' } },
    { name: 'cross-project source', change: { projectId: 'other-project' } },
    { name: 'cross-episode source', change: { episodeId: 'other-episode' } },
    { name: 'different source group', change: { groupId: 'other-group' } },
    { name: 'additional source approval', change: { approved: true } },
    { name: 'zero group number', change: { groupNo: 0 } },
    { name: 'boolean group number', change: { groupNo: true } },
    { name: 'unsafe group number', change: { groupNo: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'fractional group number', change: { groupNo: 1.5 } },
    { name: 'negative storyboard revision', change: { storyboardRevision: -1 } },
    { name: 'boolean storyboard revision', change: { storyboardRevision: false } },
    { name: 'numeric-string storyboard revision', change: { storyboardRevision: '3' } },
    { name: 'unsafe storyboard revision', change: { storyboardRevision: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'empty title', change: { title: '' } },
    { name: 'Python NEL blank title', change: { title: '\u0085' } },
    { name: 'Python control blank title', change: { title: '\u001c' } },
    { name: 'NUL title', change: { title: 'A\u0000B' } },
    { name: 'isolated surrogate title', change: { title: '\ud800' } },
    { name: 'overlong code point title', change: { title: '🎬'.repeat(8_001) } },
    { name: 'uppercase prompt SHA', change: { groupExecutionPromptSha256: 'A'.repeat(64) } },
    { name: 'short prompt SHA', change: { groupExecutionPromptSha256: 'a'.repeat(63) } },
    { name: 'empty members', change: { shots: [] } },
    { name: 'non-array members', change: { shots: {} } },
    { name: 'reversed member order', change: { shots: [...productionUnitSource().shots].reverse() } },
    { name: 'duplicate member identity', change: { shots: [
      { frameId: 'frame-z', frameNo: 7, frameContentSha256: '7'.repeat(64) },
      { frameId: 'frame-z', frameNo: 12, frameContentSha256: 'c'.repeat(64) },
    ] } },
    { name: 'duplicate member number', change: { shots: [
      { frameId: 'frame-z', frameNo: 7, frameContentSha256: '7'.repeat(64) },
      { frameId: 'frame-1', frameNo: 7, frameContentSha256: 'c'.repeat(64) },
    ] } },
  ]
  it.each(invalidSources)('rejects self-rehashed $name', async ({ change }) => {
    await expectContractFailure(feedWithSource(change))
  })

  it.each([
    { frameId: ' frame-z' }, { frameId: 'frame-z\nnext' }, { frameId: '\u0085' }, { frameId: '\ud800' },
    { frameId: '🎬'.repeat(257) }, { frameNo: 0 }, { frameNo: false }, { frameNo: 1.5 },
    { frameNo: Number.MAX_SAFE_INTEGER + 1 }, { frameContentSha256: 'A'.repeat(64) }, { approved: true },
  ])('rejects a malformed self-rehashed member %#', async (change) => {
    await expectContractFailure(feedWithSource({
      shots: [{ frameId: 'frame-z', frameNo: 7, frameContentSha256: '7'.repeat(64), ...change }],
    }))
  })

  const invalidBindings: { name: string; change: Record<string, unknown> }[] = [
    { name: 'unit shorthand', change: { unitId: 'LSU7' } },
    { name: 'unit newline', change: { unitId: 'LSU17\n' } },
    { name: 'unit suffix', change: { unitId: 'LSU17-extra' } },
    { name: 'numeric unit', change: { unitId: 17 } },
    { name: 'cross-project binding', change: { projectId: 'other-project' } },
    { name: 'cross-episode binding', change: { episodeId: 'other-episode' } },
    { name: 'different binding group', change: { groupId: 'other-group' } },
    { name: 'extra binding authority', change: { approved: true } },
    { name: 'zero binding revision', change: { revision: 0 } },
    { name: 'boolean binding revision', change: { revision: true } },
    { name: 'unsafe binding revision', change: { revision: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'incorrect source hash', change: { sourceSnapshotSha256: '0'.repeat(64) } },
    { name: 'invalid method hash', change: { methodProjectionSha256: 'A'.repeat(64) } },
    { name: 'invalid rules hash', change: { rulesSha256: null } },
    { name: 'invalid session hash', change: { authSessionId: 'session' } },
    { name: 'blank actor', change: { actorId: '\u0085' } },
    { name: 'padded event', change: { eventId: ' event' } },
    { name: 'malformed change set ID', change: { changeSetId: '\ud800' } },
    { name: 'missing timestamp', change: { createdAt: null } },
    { name: 'overlong timestamp', change: { createdAt: 'x'.repeat(129) } },
  ]
  it.each(invalidBindings)('rejects self-rehashed $name', async ({ change }) => {
    await expectContractFailure(feedWithBinding(change))
  })

  it.each([
    { id: 'other-definition' }, { version: '\u001c' }, { unitIdPattern: '.*' }, { scope: 'global' },
    { operation: 'seal_plan' }, { planSealingAllowed: true }, { stageApprovalAllowed: true },
    { providerCalls: false }, { stages: [] }, { stages: {} }, { approved: true },
    { stages: [
      { stageId: 'F', roleId: 'F', contractSha256: 'a'.repeat(64) },
      { stageId: 'F', roleId: 'OTHER', contractSha256: 'b'.repeat(64) },
    ] },
    { stages: [{ stageId: '', roleId: 'F', contractSha256: 'a'.repeat(64) }] },
    { stages: [{ stageId: 'F', roleId: '\u0085', contractSha256: 'a'.repeat(64) }] },
    { stages: [{ stageId: 'F', roleId: 'F', contractSha256: 'A'.repeat(64) }] },
    { stages: [{ stageId: 'F', roleId: 'F', contractSha256: 'a'.repeat(64), approved: true }] },
  ])('rejects a malformed self-rehashed definition %#', async (change) => {
    await expectContractFailure(feedWithBinding({ definition: { ...productionUnitDefinition(), ...change } }))
  })

  it('rejects duplicate groups and duplicate latest-unit bindings', async () => {
    const feed = productionUnitsFeed()
    await expectContractFailure({ ...feed, groups: [...feed.groups, ...feed.groups] })
    await expectContractFailure({ ...feed, bindings: [...feed.bindings, ...feed.bindings] })
  })

  it('rejects two units for one group even with different event and change-set identities', async () => {
    const feed = productionUnitsFeed()
    const binding = { ...productionUnitBinding(), unitId: 'LSU18', eventId: 'event-18', changeSetId: 'change-18' }
    await expectContractFailure({ ...feed, bindings: [...feed.bindings,
      { binding, bindingSha256: productionUnitSha(binding), currentBinding: true }] })
  })

  it.each([
    { groupId: 'wrong-group' }, { snapshotSha256: '0'.repeat(64) }, { subject: null },
    { snapshotSha256: null }, { availability: { status: 'unavailable', reason: 'missing' } },
    { availability: { status: 'available', reason: 'not-null' } }, { approved: true },
  ])('rejects an inconsistent current group wrapper %#', async (change) => {
    const feed = productionUnitsFeed()
    await expectContractFailure({ ...feed, groups: feed.groups.map(group => ({ ...group, ...change })) })
  })

  it.each([
    { reason: null }, { reason: '' }, { reason: '\u0085' }, { status: 'available', reason: null },
  ])('rejects an unavailable group without a valid unknown-source reason %#', async (change) => {
    await expectContractFailure({
      ...productionUnitsFeed(), bindings: [],
      groups: [{ groupId: 'group-three', subject: null, snapshotSha256: null,
        availability: { status: 'unavailable', reason: 'missing', ...change } }],
    })
  })

  it.each([
    { bindingSha256: '0'.repeat(64) }, { currentBinding: 1 }, { currentBinding: null }, { approved: true },
  ])('rejects an inconsistent binding wrapper %#', async (change) => {
    const feed = productionUnitsFeed()
    await expectContractFailure({ ...feed, bindings: feed.bindings.map(item => ({ ...item, ...change })) })
  })
})

describe('production unit GET-only transport and canonical coordinates', () => {
  it.each([
    null, [], {}, { projectId: request.projectId }, { episodeId: request.episodeId },
    { ...request, groupId: 'group-three' }, { ...request, unitId: 'LSU17' },
    { ...request, methodProjection: {} }, { ...request, approved: true },
    { ...request, projectId: 1 }, { ...request, projectId: true },
    { ...request, projectId: ' project-unit' }, { ...request, episodeId: 'episode-unit ' },
    { ...request, projectId: '\u0085' }, { ...request, projectId: '\u001c' },
    { ...request, projectId: 'project\u0000unit' }, { ...request, projectId: 'project\nunit' },
    { ...request, projectId: '\ud800' }, { ...request, episodeId: '🎬'.repeat(257) },
  ])('rejects invalid input %# before any network request', async (payload) => {
    const { handler, fetch } = reader(productionUnitsFeed())
    expect(await handler('productionUnits', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['\ufeff', '🎬'.repeat(256), 'project/a?b#c'])('preserves accepted coordinates %s', async (projectId) => {
    const coordinates = { ...request, projectId }
    const feed = { ...productionUnitsFeed(), ...coordinates, groups: [], bindings: [] }
    const { handler, fetch } = reader(feed)
    expect(await handler('productionUnits', coordinates, signal())).toEqual({ ok: true, value: feed })
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18815/api/qingmu/projects/' + encodeURIComponent(projectId)
        + '/episodes/episode-unit/production-units',
    )
  })

  it('requires the existing Host token without leaking it to a response', async () => {
    const { handler, fetch } = reader(productionUnitsFeed(), '')
    expect(await handler('productionUnits', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('redacts upstream error text and never retries or writes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response('private upstream content', { status: 403 }))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'host-unit-token' })
    const response = await handler('productionUnits', request, signal())
    expect(response).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(response)).not.toContain('private upstream content')
    expect(JSON.stringify(response)).not.toContain('host-unit-token')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it('uses cancellation on the same bounded GET transport', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }))
    const handler = createYimengReadHandler({}, { fetch, readToken: () => 'host-unit-token' })
    const controller = new AbortController()
    const pending = handler('productionUnits', request, controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})
