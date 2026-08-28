// @vitest-environment jsdom
/** Controlled UI responses only; these do not represent a real Core signature or approval. */
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ImagoProductionUnitMethodResponse, QingmuYimengPort, YimengProductionUnitRecovery, YimengProductionUnitResult,
  YimengProductionUnitSource, YimengProductionUnitsResponse, YimengWorkflowProjection,
} from '../src/client/contracts.ts'
import { ProductionUnitView } from '../src/client/ProductionUnitView.tsx'
import {
  createProductionUnitMarker, readProductionUnitMarker, verifyProductionUnitFeed,
  verifyProductionUnitMethod, writeProductionUnitMarker,
  type AvailableProductionUnitGroup, type ProductionUnitRecoveryMarker,
} from '../src/client/production-unit-contract.ts'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { productionUnitDefinition } from '../../qingmu-yimeng-read-adapter/tests/production-unit-fixture.ts'
import { shotFindingFeed, shotFindingMethod, shotFindingResult, shotFindingSha, shotFindingSource } from './fixtures/shot-finding.client.ts'

type Port = Pick<QingmuYimengPort, 'shotFindings' | 'shotFindingMethod' | 'recordShotFinding' | 'recoverShotFinding'
  | 'reworkRouteSource' | 'reworkRouteMethod' | 'recordReworkRoute' | 'recoverReworkRoute'
  | 'probeReworkRouteAuthority'
  | 'productionUnits' | 'productionUnitMethod' | 'bindProductionUnit' | 'recoverProductionUnitBinding'>
const t = (key: QingmuCockpitKey) => zh[key]
function feedFor(projection = shotFindingSource()): YimengProductionUnitsResponse {
  const subject = { schema: 'jason.qingmu-production-unit-source.v1' as const,
    projectId: projection.projectId, episodeId: projection.episodeId, groupId: 'group-three', groupNo: 3,
    title: '  原分组范围\n原文保留  ', groupExecutionPromptSha256: 'e'.repeat(64),
    storyboardRevision: projection.director.shotRelations.storyboardRevision.episodeRevision,
    shots: projection.director.shotRelations.shots.map(shot => ({ frameId: shot.shotId, frameNo: shot.frameNo,
      frameContentSha256: 'b'.repeat(64) })).sort((a, b) => a.frameNo - b.frameNo) }
  return { schema: 'jason.qingmu-production-unit-feed.v1', projectId: projection.projectId, episodeId: projection.episodeId,
    groups: [{ groupId: subject.groupId, subject, snapshotSha256: shotFindingSha(subject),
      availability: { status: 'available', reason: null } }], bindings: [], capabilities: { canBindUnit: true },
    planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false }
}
function methodFor(feed: YimengProductionUnitsResponse, groupId = 'group-three'): ImagoProductionUnitMethodResponse {
  const group = feed.groups.find(value => value.groupId === groupId)
  if (group?.subject === null || group?.subject === undefined || group.snapshotSha256 === null) throw new Error('Missing fixture group')
  const ruleBindings = { 'pipeline/imago-os-current.json': '1'.repeat(64) }
  const projection: ImagoProductionUnitMethodResponse['projection'] = {
    schema: 'qingmu.imago-production-unit-method.v1', subject: group.subject,
    subjectSnapshotSha256: group.snapshotSha256, definition: productionUnitDefinition(), ruleBindings,
    rulesSha256: shotFindingSha(ruleBindings),
  }
  const projectionSha256 = shotFindingSha(projection)
  return { schema: 'qingmu.imago-production-unit-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: { schema: 'qingmu.imago-production-unit-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: group.snapshotSha256, methodProjectionSha256: projectionSha256, signature: 'a'.repeat(64) } }
}
function resultFor(request: Parameters<Port['bindProductionUnit']>[0]): YimengProductionUnitResult {
  const binding = { projectId: request.projectId, episodeId: request.episodeId, groupId: request.groupId,
    unitId: request.unitId, revision: request.expectedBindingRevision + 1, source: request.methodProjection.subject,
    sourceSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256, definition: request.methodProjection.definition,
    actorId: 'project-owner', authSessionId: 'c'.repeat(64), eventId: `event-${request.idempotencyKey}`,
    changeSetId: `change-${request.idempotencyKey}`, createdAt: '2026-08-28T00:00:00+08:00' }
  return { schema: 'jason.qingmu-production-unit-result.v1', binding, bindingSha256: shotFindingSha(binding),
    planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false }
}
function makePort(initial = feedFor(), projection = shotFindingSource()) {
  let current = initial
  const port = {
    productionUnits: vi.fn<Port['productionUnits']>().mockImplementation(async () => current),
    productionUnitMethod: vi.fn<Port['productionUnitMethod']>().mockImplementation(async request => methodFor(current, request.groupId)),
    bindProductionUnit: vi.fn<Port['bindProductionUnit']>().mockImplementation(async (request) => {
      const result = resultFor(request)
      current = { ...current, bindings: [{ binding: result.binding, bindingSha256: result.bindingSha256, currentBinding: true }] }
      return result
    }),
    recoverProductionUnitBinding: vi.fn<Port['recoverProductionUnitBinding']>(),
    shotFindings: vi.fn<Port['shotFindings']>().mockImplementation(async request => shotFindingFeed(projection, request.frameId)),
    shotFindingMethod: vi.fn<Port['shotFindingMethod']>().mockImplementation(async request => shotFindingMethod(shotFindingFeed(projection, request.frameId))),
    recordShotFinding: vi.fn<Port['recordShotFinding']>(), recoverShotFinding: vi.fn<Port['recoverShotFinding']>(),
    reworkRouteSource: vi.fn<Port['reworkRouteSource']>().mockRejectedValue(new Error('No route source')),
    reworkRouteMethod: vi.fn<Port['reworkRouteMethod']>().mockRejectedValue(new Error('No route method')),
    recordReworkRoute: vi.fn<Port['recordReworkRoute']>(),
    recoverReworkRoute: vi.fn<Port['recoverReworkRoute']>(),
    probeReworkRouteAuthority: vi.fn<Port['probeReworkRouteAuthority']>(),
  }
  return { port, setFeed: (feed: YimengProductionUnitsResponse) => { current = feed } }
}
function props(port: Port, projection: YimengWorkflowProjection = shotFindingSource(), selectedShotId = 'frame-a') {
  return { projectId: projection.projectId, episodeId: projection.episodeId, selectedShotId, projection, enabled: true, port, t }
}
function groupFor(feed: YimengProductionUnitsResponse): AvailableProductionUnitGroup {
  const group = feed.groups[0]
  if (group?.subject === undefined || group.subject === null || group.snapshotSha256 === null) throw new Error('No fixture source')
  return { ...group, subject: group.subject, snapshotSha256: group.snapshotSha256 }
}
function changedSource(feed: YimengProductionUnitsResponse, changes: Partial<YimengProductionUnitSource>): YimengProductionUnitsResponse {
  const group = groupFor(feed)
  const subject = { ...group.subject, ...changes }
  const snapshotSha256 = shotFindingSha(subject)
  return { ...feed, groups: [{ ...group, subject, snapshotSha256 }],
    bindings: feed.bindings.map(item => ({ ...item, currentBinding: item.binding.sourceSnapshotSha256 === snapshotSha256 })) }
}
function pending<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Missing resolver') }
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
async function prepare(unitId = 'LSU17') {
  fireEvent.change(await screen.findByRole('combobox', { name: zh.unitGroup }), { target: { value: 'group-three' } })
  const input = await screen.findByRole<HTMLInputElement>('textbox', { name: zh.unitId })
  if (!input.readOnly) fireEvent.change(input, { target: { value: unitId } })
  fireEvent.click(screen.getByRole('checkbox', { name: zh.unitConfirm }))
  return screen.getByRole('button', { name: input.readOnly ? zh.unitRebind : zh.unitBind })
}
function requestFor(feed = feedFor(), revision = 0, bindingSha: string | null = null): Parameters<Port['bindProductionUnit']>[0] {
  const method = methodFor(feed)
  return { projectId: feed.projectId, episodeId: feed.episodeId, groupId: 'group-three', unitId: 'LSU17',
    expectedSubjectSha256: method.projection.subjectSnapshotSha256, expectedBindingRevision: revision,
    expectedBindingSha256: bindingSha, idempotencyKey: 'placeholder-key', methodProjection: method.projection,
    methodProjectionSha256: method.projectionSha256, methodAttestation: method.methodAttestation }
}
async function savedIntent(feed = feedFor()) {
  const base = requestFor(feed)
  const marker = await createProductionUnitMarker({ projectId: base.projectId, episodeId: base.episodeId,
    groupId: base.groupId, unitId: base.unitId, expectedSubjectSha256: base.expectedSubjectSha256,
    expectedBindingRevision: base.expectedBindingRevision, expectedBindingSha256: base.expectedBindingSha256,
    methodProjectionSha256: base.methodProjectionSha256, rulesSha256: base.methodProjection.rulesSha256 })
  const request = { ...base, idempotencyKey: marker.idempotencyKey }
  expect(writeProductionUnitMarker(marker)).toBe(true)
  return { marker, request, result: resultFor(request) }
}
function recovery(marker: ProductionUnitRecoveryMarker, result: YimengProductionUnitResult | null): YimengProductionUnitRecovery {
  return { schema: 'jason.qingmu-production-unit-recovery.v1', projectId: marker.projectId, episodeId: marker.episodeId,
    groupId: marker.groupId, unitId: marker.unitId, expectedSubjectSha256: marker.expectedSubjectSha256,
    idempotencyKey: marker.idempotencyKey, found: result !== null, result }
}
function markerKey(marker: ProductionUnitRecoveryMarker) {
  return ['qingmu:production-unit-recovery:v1', marker.projectId, marker.episodeId].map(encodeURIComponent).join(':')
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('explicit same-Shot production-unit scope', () => {
  it('reads the episode once and requires an explicit existing-group selection without allocating a unit ID', async () => {
    const { port } = makePort()
    render(<ProductionUnitView {...props(port)} />)
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: zh.unitGroup })
    expect(select.value).toBe('')
    expect(port.productionUnits).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-e55', episodeId: 'episode-e55' }, expect.any(AbortSignal))
    expect(port.productionUnitMethod).not.toHaveBeenCalled()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('registers only after explicit group, unit ID and scope-only confirmation, then rereads the authoritative feed', async () => {
    const { port } = makePort()
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.change(await screen.findByRole('combobox', { name: zh.unitGroup }), { target: { value: 'group-three' } })
    fireEvent.change(await screen.findByRole('textbox', { name: zh.unitId }), { target: { value: 'LSU17' } })
    fireEvent.click(screen.getByRole('checkbox', { name: zh.unitConfirm }))
    fireEvent.click(screen.getByRole('button', { name: zh.unitBind }))
    await waitFor(() => { expect(port.bindProductionUnit).toHaveBeenCalledOnce() })
    const request = port.bindProductionUnit.mock.calls[0]?.[0]
    expect(request?.expectedBindingRevision).toBe(0)
    expect(request?.expectedBindingSha256).toBeNull()
    expect(request?.unitId).toBe('LSU17')
    expect(request?.methodProjection.subject.shots.map(shot => shot.frameNo)).toEqual([7, 12])
    expect(await screen.findByText(zh.unitStored)).toBeTruthy()
    await waitFor(() => { expect(port.productionUnits).toHaveBeenCalledTimes(2) })
    expect(sessionStorage.length).toBe(0)
  })

  it('updates an expired source with the immutable unit ID and exact previous-binding CAS', async () => {
    const original = feedFor()
    const receipt = resultFor(requestFor(original))
    const current = changedSource({ ...original, bindings: [{ binding: receipt.binding,
      bindingSha256: receipt.bindingSha256, currentBinding: true }] }, { title: '明确更新后的原生组范围' })
    const { port } = makePort(current)
    render(<ProductionUnitView {...props(port)} />)
    const button = await prepare()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: zh.unitId })
    expect(input.value).toBe('LSU17')
    expect(input.readOnly).toBe(true)
    expect(screen.getByText(zh.unitHistorical)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'LSU99' } })
    expect(input.value).toBe('LSU17')
    fireEvent.click(button)
    await waitFor(() => { expect(port.bindProductionUnit).toHaveBeenCalledOnce() })
    const request = port.bindProductionUnit.mock.calls[0]?.[0]
    expect(request?.expectedBindingRevision).toBe(1)
    expect(request?.expectedBindingSha256).toBe(receipt.bindingSha256)
    expect(request?.expectedSubjectSha256).toBe(groupFor(current).snapshotSha256)
    expect(request?.unitId).toBe('LSU17')
    expect(await screen.findByText(zh.unitCurrent)).toBeTruthy()
  })

  it.each(['other-shot', 'revision', 'frameNo'] as const)
  ('does not offer a source with %s outside the visible canonical Shot', async (kind) => {
    const initial = feedFor()
    const group = groupFor(initial)
    const feed = changedSource(initial, kind === 'revision' ? { storyboardRevision: 4 }
      : { shots: group.subject.shots.map(shot => ({ ...shot,
        frameId: kind === 'other-shot' ? `other-${shot.frameId}` : shot.frameId,
        frameNo: kind === 'frameNo' ? shot.frameNo + 1 : shot.frameNo })) })
    const { port } = makePort(feed)
    render(<ProductionUnitView {...props(port)} />)
    expect(await screen.findByText(zh.unitNoGroup)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: zh.unitGroup })).toBeNull()
    expect(port.productionUnitMethod).not.toHaveBeenCalled()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('keeps an unavailable method read-only without falling back to a historical definition', async () => {
    const feed = feedFor()
    const result = resultFor(requestFor(feed))
    const { port } = makePort({ ...feed,
      bindings: [{ binding: result.binding, bindingSha256: result.bindingSha256, currentBinding: true }] })
    port.productionUnitMethod.mockRejectedValue(new Error('method plugin unavailable'))
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.change(await screen.findByRole('combobox', { name: zh.unitGroup }), { target: { value: 'group-three' } })
    expect(await screen.findByText(zh.unitMethodUnavailable)).toBeTruthy()
    expect(screen.getByText(zh.unitCurrent)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.unitRebind })).toBeNull()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it.each(['LSU7', 'LSU17 ', '\u0085LSU17', '\u001cLSU17', 'LSU-明确', ''])
  ('does not rewrite or submit invalid explicit unit ID %j', async (value) => {
    const { port } = makePort()
    render(<ProductionUnitView {...props(port)} />)
    const button = await prepare(value)
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps scope-only confirmation empty and does not grant owner permission from readable sources', async () => {
    const initial = feedFor()
    const { port } = makePort({ ...initial, capabilities: { canBindUnit: false } })
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.change(await screen.findByRole('combobox', { name: zh.unitGroup }), { target: { value: 'group-three' } })
    const input = await screen.findByRole<HTMLInputElement>('textbox', { name: zh.unitId })
    expect(input.closest('fieldset')?.disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: zh.unitConfirm }).checked).toBe(false)
    expect(screen.getByText(zh.unitPermission)).toBeTruthy()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('persists and reads back the exact marker before a single POST despite rapid repeated clicks', async () => {
    const { port } = makePort()
    const pendingReceipt = pending<YimengProductionUnitResult>()
    port.bindProductionUnit.mockImplementation(async (request) => {
      const read = readProductionUnitMarker(request)
      expect(read.status).toBe('ready')
      if (read.status !== 'ready') throw new Error('No durable intent before POST')
      expect(read.marker.idempotencyKey).toBe(request.idempotencyKey)
      expect(Object.keys(read.marker).sort()).toEqual(['schema', 'projectId', 'episodeId', 'groupId', 'unitId',
        'expectedSubjectSha256', 'expectedBindingRevision', 'expectedBindingSha256', 'methodProjectionSha256',
        'rulesSha256', 'idempotencyKey'].sort())
      return await pendingReceipt.promise
    })
    render(<ProductionUnitView {...props(port)} />)
    const button = await prepare()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => { expect(port.bindProductionUnit).toHaveBeenCalledOnce() })
    const request = port.bindProductionUnit.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('No request')
    await act(async () => { pendingReceipt.resolve(resultFor(request)) })
    expect(await screen.findByText(zh.unitStored)).toBeTruthy()
    expect(readProductionUnitMarker(request).status).toBe('none')
  })

  it('does not POST when sessionStorage persistence fails', async () => {
    const { port } = makePort()
    render(<ProductionUnitView {...props(port)} />)
    const button = await prepare()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
    fireEvent.click(button)
    expect(await screen.findByText(zh.unitStorageFailed)).toBeTruthy()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('leaves an existing unresolved intent untouched when another form attempts to submit', async () => {
    const { port } = makePort()
    render(<ProductionUnitView {...props(port)} />)
    const button = await prepare('LSU18')
    const prior = await savedIntent()
    fireEvent.click(button)
    expect(await screen.findByText(zh.unitStorageFailed)).toBeTruthy()
    expect(readProductionUnitMarker(prior.marker)).toEqual({ status: 'ready', marker: prior.marker })
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })
})

describe('production-unit original receipt recovery', () => {
  it('recovers a lost POST response after remount with the source unavailable, then reads the authoritative feed', async () => {
    const initial = feedFor()
    const harness = makePort(initial)
    let receipt: YimengProductionUnitResult | undefined
    harness.port.bindProductionUnit.mockImplementation(async (request) => {
      receipt = resultFor(request)
      harness.setFeed({ ...initial, groups: [{ groupId: 'group-three', subject: null, snapshotSha256: null,
        availability: { status: 'unavailable', reason: 'source_changed' } }],
      bindings: [{ binding: receipt.binding, bindingSha256: receipt.bindingSha256, currentBinding: false }] })
      throw new Error('POST response lost after commit')
    })
    const mounted = render(<ProductionUnitView {...props(harness.port)} />)
    fireEvent.click(await prepare())
    expect(await screen.findByText(zh.unitUncertain)).toBeTruthy()
    const read = readProductionUnitMarker(initial)
    if (read.status !== 'ready' || receipt === undefined) throw new Error('Missing original receipt')
    const saved = receipt
    mounted.unmount()
    harness.port.recoverProductionUnitBinding.mockResolvedValue(recovery(read.marker, saved))
    render(<ProductionUnitView {...props(harness.port)} />)
    expect(await screen.findByText(zh.unitNoGroup)).toBeTruthy()
    expect(harness.port.recoverProductionUnitBinding).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.unitRecover }))
    expect(await screen.findByText(zh.unitStored)).toBeTruthy()
    await waitFor(() => { expect(harness.port.productionUnits).toHaveBeenCalledTimes(3) })
    expect(readProductionUnitMarker(initial).status).toBe('none')
    expect(harness.port.bindProductionUnit).toHaveBeenCalledOnce()
    expect(harness.port.recoverProductionUnitBinding).toHaveBeenCalledExactlyOnceWith({
      projectId: read.marker.projectId, episodeId: read.marker.episodeId, groupId: read.marker.groupId,
      unitId: read.marker.unitId, expectedSubjectSha256: read.marker.expectedSubjectSha256,
      idempotencyKey: read.marker.idempotencyKey,
    }, expect.any(AbortSignal))
  })

  it.each(['no-shot', 'no-projection', 'no-write-permission'] as const)
  ('uses the original GET and refresh with %s, without preparing a new method', async (kind) => {
    const saved = await savedIntent()
    const source = shotFindingSource()
    const { port } = makePort({ ...feedFor(), capabilities: { canBindUnit: false } })
    port.recoverProductionUnitBinding.mockResolvedValue(recovery(saved.marker, saved.result))
    const projection = kind === 'no-projection' ? undefined : kind === 'no-shot'
      ? { ...source, director: { ...source.director, shotRelations: { ...source.director.shotRelations, shots: [] } } } : source
    render(<ProductionUnitView {...props(port, source)} projection={projection} />)
    await waitFor(() => { expect(port.productionUnits).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: zh.unitRecover }))
    expect(await screen.findByText(zh.unitStored)).toBeTruthy()
    await waitFor(() => { expect(port.productionUnits).toHaveBeenCalledTimes(2) })
    expect(port.productionUnitMethod).not.toHaveBeenCalled()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
    expect(readProductionUnitMarker(saved.marker).status).toBe('none')
    if (kind !== 'no-write-permission') expect(screen.queryByText(zh.unitCurrent)).toBeNull()
  })

  it('retains a not-found marker and never automatically retries the POST or GET', async () => {
    const saved = await savedIntent()
    const { port } = makePort()
    port.recoverProductionUnitBinding.mockResolvedValue(recovery(saved.marker, null))
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.unitRecover }))
    expect(await screen.findByText(zh.unitNotFound)).toBeTruthy()
    expect(readProductionUnitMarker(saved.marker)).toEqual({ status: 'ready', marker: saved.marker })
    expect(port.recoverProductionUnitBinding).toHaveBeenCalledOnce()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it.each(['outer-scope', 'binding-sha', 'revision', 'method', 'rules', 'source', 'authority'] as const)
  ('retains the marker when the original receipt has a %s mismatch', async (kind) => {
    const saved = await savedIntent()
    const result = structuredClone(saved.result)
    const response = recovery(saved.marker, result)
    if (kind === 'outer-scope') Object.assign(response, { groupId: 'other-group' })
    else if (kind === 'binding-sha') Object.assign(result, { bindingSha256: '0'.repeat(64) })
    else if (kind === 'authority') Object.assign(result, { planSealed: true })
    else {
      Object.assign(result.binding, kind === 'revision' ? { revision: 2 }
        : kind === 'method' ? { methodProjectionSha256: '0'.repeat(64) }
          : kind === 'rules' ? { rulesSha256: '0'.repeat(64) } : { sourceSnapshotSha256: '0'.repeat(64) })
      Object.assign(result, { bindingSha256: shotFindingSha(result.binding) })
    }
    const { port } = makePort()
    port.recoverProductionUnitBinding.mockResolvedValue(response)
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.unitRecover }))
    expect(await screen.findByText(zh.unitRecoveryError)).toBeTruthy()
    expect(readProductionUnitMarker(saved.marker)).toEqual({ status: 'ready', marker: saved.marker })
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('does not delete a replacement marker after a late valid recovery response', async () => {
    const saved = await savedIntent()
    const { port } = makePort()
    const reply = pending<YimengProductionUnitRecovery>()
    port.recoverProductionUnitBinding.mockReturnValue(reply.promise)
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.unitRecover }))
    await waitFor(() => { expect(port.recoverProductionUnitBinding).toHaveBeenCalledOnce() })
    const { schema: _schema, idempotencyKey: _key, ...coordinates } = saved.marker
    const replacement = await createProductionUnitMarker({ ...coordinates, unitId: 'LSU18' })
    sessionStorage.setItem(markerKey(replacement), JSON.stringify(replacement))
    await act(async () => { reply.resolve(recovery(saved.marker, saved.result)) })
    expect(await screen.findByText(zh.unitMarkerChanged)).toBeTruthy()
    expect(readProductionUnitMarker(replacement)).toEqual({ status: 'ready', marker: replacement })
    expect(port.productionUnits).toHaveBeenCalledOnce()
  })

  it('discards only a local notice and uses the same deterministic key for the same re-entered intent', async () => {
    const saved = await savedIntent()
    const { port } = makePort()
    port.bindProductionUnit.mockRejectedValue(new Error('Outcome still unknown'))
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.click(await screen.findByText(zh.unitDiscard, { selector: 'summary' }))
    expect(screen.getByText(zh.unitDiscardHelp).textContent).toContain('不会撤销')
    fireEvent.click(screen.getByRole('button', { name: zh.unitDiscard }))
    expect(readProductionUnitMarker(saved.marker).status).toBe('none')
    fireEvent.click(await prepare())
    await waitFor(() => { expect(port.bindProductionUnit).toHaveBeenCalledOnce() })
    expect(port.bindProductionUnit.mock.calls[0]?.[0].idempotencyKey).toBe(saved.marker.idempotencyKey)
  })
})

describe('production-unit view isolation', () => {
  it.each(['same-fingerprint-projection', 'port', 'shot'] as const)
  ('aborts and ignores an old feed after changing %s', async (change) => {
    const source = shotFindingSource()
    const oldFeed = changedSource(feedFor(source), { title: '旧来源，不能覆盖当前' })
    const nextFeed = changedSource(oldFeed, { title: '当前来源' })
    const oldReply = pending<YimengProductionUnitsResponse>()
    const first = makePort(oldFeed, source)
    first.port.productionUnits.mockReturnValueOnce(oldReply.promise).mockResolvedValue(nextFeed)
    const mounted = render(<ProductionUnitView {...props(first.port, source)} />)
    await waitFor(() => { expect(first.port.productionUnits).toHaveBeenCalledOnce() })
    const signal = first.port.productionUnits.mock.calls[0]?.[1]
    const next = change === 'port' ? makePort(nextFeed, source).port : first.port
    const nextProjection = change === 'same-fingerprint-projection' ? structuredClone(source) : source
    expect(nextProjection.inputFingerprint).toBe(source.inputFingerprint)
    mounted.rerender(<ProductionUnitView {...props(next, nextProjection, change === 'shot' ? 'frame-z' : 'frame-a')} />)
    expect(await screen.findByRole('option', { name: '#3 · 当前来源' })).toBeTruthy()
    expect(signal?.aborted).toBe(true)
    await act(async () => { oldReply.resolve(oldFeed) })
    expect(screen.queryByRole('option', { name: '#3 · 旧来源，不能覆盖当前' })).toBeNull()
    expect(screen.getByRole('option', { name: '#3 · 当前来源' })).toBeTruthy()
    expect(next.productionUnitMethod).not.toHaveBeenCalled()
    expect(next.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('ignores an old method after clearing and explicitly reselecting the group', async () => {
    const { port } = makePort()
    const reply = pending<ImagoProductionUnitMethodResponse>()
    port.productionUnitMethod.mockReturnValueOnce(reply.promise)
    render(<ProductionUnitView {...props(port)} />)
    const select = await screen.findByRole('combobox', { name: zh.unitGroup })
    fireEvent.change(select, { target: { value: 'group-three' } })
    await waitFor(() => { expect(port.productionUnitMethod).toHaveBeenCalledOnce() })
    const signal = port.productionUnitMethod.mock.calls[0]?.[1]
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.change(select, { target: { value: 'group-three' } })
    expect(await screen.findByRole('textbox', { name: zh.unitId })).toBeTruthy()
    expect(signal?.aborted).toBe(true)
    const badOldReply = { ...methodFor(feedFor()), projectionSha256: '0'.repeat(64) }
    await act(async () => { reply.resolve(badOldReply) })
    expect(screen.queryByText(zh.unitMethodUnavailable)).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.unitId }).value).toBe('')
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('keeps the original marker after a POST returns late to a different Shot', async () => {
    const source = shotFindingSource()
    const { port } = makePort()
    const reply = pending<YimengProductionUnitResult>()
    port.bindProductionUnit.mockReturnValue(reply.promise)
    const mounted = render(<ProductionUnitView {...props(port, source)} />)
    fireEvent.click(await prepare())
    await waitFor(() => { expect(port.bindProductionUnit).toHaveBeenCalledOnce() })
    const request = port.bindProductionUnit.mock.calls[0]?.[0]
    const signal = port.bindProductionUnit.mock.calls[0]?.[1]
    if (request === undefined) throw new Error('No original POST')
    const original = readProductionUnitMarker(request)
    mounted.rerender(<ProductionUnitView {...props(port, source, 'frame-z')} />)
    await waitFor(() => { expect(port.productionUnits).toHaveBeenCalledTimes(2) })
    expect(signal?.aborted).toBe(true)
    await act(async () => { reply.resolve(resultFor(request)) })
    expect(readProductionUnitMarker(request)).toEqual(original)
    expect(screen.queryByText(zh.unitStored)).toBeNull()
    expect(screen.queryByText(zh.unitCurrent)).toBeNull()
    expect(port.productionUnits).toHaveBeenCalledTimes(2)
    expect(port.recoverProductionUnitBinding).not.toHaveBeenCalled()
  })

  it('does not clear the marker or publish a late GET after replacing the port', async () => {
    const saved = await savedIntent()
    const source = shotFindingSource()
    const first = makePort()
    const next = makePort()
    const reply = pending<YimengProductionUnitRecovery>()
    first.port.recoverProductionUnitBinding.mockReturnValue(reply.promise)
    const mounted = render(<ProductionUnitView {...props(first.port, source)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.unitRecover }))
    await waitFor(() => { expect(first.port.recoverProductionUnitBinding).toHaveBeenCalledOnce() })
    const signal = first.port.recoverProductionUnitBinding.mock.calls[0]?.[1]
    mounted.rerender(<ProductionUnitView {...props(next.port, source)} />)
    await waitFor(() => { expect(next.port.productionUnits).toHaveBeenCalledOnce() })
    expect(signal?.aborted).toBe(true)
    await act(async () => { reply.resolve(recovery(saved.marker, saved.result)) })
    expect(readProductionUnitMarker(saved.marker)).toEqual({ status: 'ready', marker: saved.marker })
    expect(screen.queryByText(zh.unitStored)).toBeNull()
    expect(next.port.recoverProductionUnitBinding).not.toHaveBeenCalled()
    expect(next.port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'unmounted'] as const)('ignores late feeds while %s without a new read or false loading', async (state) => {
    const source = shotFindingSource()
    const { port } = makePort()
    const reply = pending<YimengProductionUnitsResponse>()
    port.productionUnits.mockReturnValue(reply.promise)
    const mounted = render(<ProductionUnitView {...props(port, source)} />)
    await waitFor(() => { expect(port.productionUnits).toHaveBeenCalledOnce() })
    const signal = port.productionUnits.mock.calls[0]?.[1]
    if (state === 'disabled') mounted.rerender(<ProductionUnitView {...props(port, source)} enabled={false} />)
    else mounted.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { reply.resolve(feedFor()) })
    expect(screen.queryByText(zh.unitLoading)).toBeNull()
    expect(screen.queryByRole('combobox', { name: zh.unitGroup })).toBeNull()
    expect(port.productionUnits).toHaveBeenCalledOnce()
    expect(port.productionUnitMethod).not.toHaveBeenCalled()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('invalidates shared Finding unit evidence immediately on refresh without a second Finding request', async () => {
    const initial = feedFor()
    const receipt = resultFor(requestFor(initial))
    const feed = { ...initial, bindings: [{ binding: receipt.binding, bindingSha256: receipt.bindingSha256, currentBinding: true }] }
    const { port } = makePort(feed)
    const findingFeed = shotFindingFeed()
    const finding = shotFindingResult(shotFindingMethod(findingFeed)).finding
    port.shotFindings.mockResolvedValue({ ...findingFeed, items: [{ ...finding, currentBinding: true }] })
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.click(await screen.findByText(zh.findingRecordDetails, { selector: 'summary' }))
    const region = await screen.findByRole('region', { name: zh.findingReworkTitle })
    expect(await within(region).findByText('LSU17')).toBeTruthy()
    expect(within(region).getByText(zh.findingUnitBoundary)).toBeTruthy()
    const reply = pending<YimengProductionUnitsResponse>()
    port.productionUnits.mockReturnValueOnce(reply.promise)
    fireEvent.click(screen.getByRole('button', { name: zh.unitRefresh }))
    expect(within(region).getByText(zh.findingUnitUnavailable)).toBeTruthy()
    expect(within(region).queryByText('LSU17')).toBeNull()
    expect(port.shotFindings).toHaveBeenCalledOnce()
    const unavailable: YimengProductionUnitsResponse = { ...feed, groups: [{ groupId: 'group-three', subject: null,
      snapshotSha256: null, availability: { status: 'unavailable', reason: 'group_missing' } }],
    bindings: [{ ...feed.bindings[0], binding: receipt.binding, bindingSha256: receipt.bindingSha256, currentBinding: false }] }
    await act(async () => { reply.resolve(unavailable) })
    await within(region).findByText('LSU17')
    expect(region.textContent).toContain(zh.findingUnitHistorical)
    expect(port.productionUnits).toHaveBeenCalledTimes(2)
    expect(port.shotFindings).toHaveBeenCalledOnce()
    expect(port.productionUnitMethod).not.toHaveBeenCalled()
  })
})

describe('browser unit evidence validation', () => {
  it.each(['projection', 'attestation', 'approval'] as const)('rejects a method %s mismatch before exposing the submit form', async (field) => {
    const feed = feedFor()
    const response = methodFor(feed)
    if (field === 'projection') Object.assign(response, { projectionSha256: '0'.repeat(64) })
    else if (field === 'attestation') Object.assign(response.methodAttestation, { subjectSnapshotSha256: '0'.repeat(64) })
    else {
      Object.assign(response.projection.definition, { stageApprovalAllowed: true })
      const digest = shotFindingSha(response.projection)
      Object.assign(response, { projectionSha256: digest })
      Object.assign(response.methodAttestation, { methodProjectionSha256: digest })
    }
    await expect(verifyProductionUnitMethod(response, groupFor(feed))).rejects.toThrow()
    const { port } = makePort(feed)
    port.productionUnitMethod.mockResolvedValue(response)
    render(<ProductionUnitView {...props(port)} />)
    fireEvent.change(await screen.findByRole('combobox', { name: zh.unitGroup }), { target: { value: 'group-three' } })
    expect(await screen.findByText(zh.unitMethodUnavailable)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: zh.unitId })).toBeNull()
    expect(port.bindProductionUnit).not.toHaveBeenCalled()
  })

  it('preserves legal FEFF IDs and multiline original title while validating their exact hashes', async () => {
    const initial = feedFor()
    const group = groupFor(initial)
    const subject = { ...group.subject, groupId: '\uFEFFgroup-three', title: '\uFEFF  原文\n' + '🎬'.repeat(256) }
    const feed = { ...initial, groups: [{ ...group, groupId: subject.groupId, subject, snapshotSha256: shotFindingSha(subject) }] }
    await expect(verifyProductionUnitFeed(feed, initial)).resolves.toBeUndefined()
    expect(groupFor(feed).subject.groupId).toBe('\uFEFFgroup-three')
    expect(groupFor(feed).subject.title).toBe(subject.title)
  })

  it.each(['\u0085', '\u001c'])('rejects Python whitespace-only title and padded ID %j without normalizing', async (space) => {
    const initial = feedFor()
    const title = changedSource(initial, { title: space })
    await expect(verifyProductionUnitFeed(title, initial)).rejects.toThrow()
    const group = groupFor(initial)
    const subject = { ...group.subject, groupId: space + group.groupId }
    const padded = { ...initial, groups: [{ ...group, groupId: subject.groupId, subject, snapshotSha256: shotFindingSha(subject) }] }
    await expect(verifyProductionUnitFeed(padded, initial)).rejects.toThrow()
  })
})
