// @vitest-environment jsdom
/** Browser contract tests; real Core/Host composition is verified separately. */
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImagoStageSourceMethodResponse, QingmuYimengPort, YimengStageSourceResult, YimengStageSourcesResponse } from '../src/client/contracts.ts'
import { StageSourceView } from '../src/client/StageSourceView.tsx'
import {
  createStageSourceMarker, readStageSourceMarker, verifyStageSourceFeed, verifyStageSourceMethod, writeStageSourceMarker,
} from '../src/client/stage-source-contract.ts'
import { en, zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import {
  stageSourceBoundFeed, stageSourceFeed, stageSourceMethod, stageSourceRequest, stageSourceResult, stageSourceScript,
} from './fixtures/stage-source.client.ts'
import { shotFindingSha } from './fixtures/shot-finding.client.ts'

type Port = Pick<QingmuYimengPort, 'stageSources' | 'stageSourceMethod' | 'bindStageSource' | 'recoverStageSourceBinding'>
const t = (key: QingmuCockpitKey) => zh[key]
function makePort(initial = stageSourceFeed()) {
  let current = initial
  const port = {
    stageSources: vi.fn<Port['stageSources']>().mockImplementation(async () => current),
    stageSourceMethod: vi.fn<Port['stageSourceMethod']>().mockImplementation(async () => stageSourceMethod(current)),
    bindStageSource: vi.fn<Port['bindStageSource']>().mockImplementation(async (request) => {
      const result = stageSourceResult(request)
      current = stageSourceBoundFeed(current, result)
      return result
    }),
    recoverStageSourceBinding: vi.fn<Port['recoverStageSourceBinding']>(),
  }
  return { port, setFeed: (feed: YimengStageSourcesResponse) => { current = feed } }
}
function props(port: Port, feed = stageSourceFeed()) {
  return { projectId: feed.projectId, episodeId: feed.episodeId, savedScript: stageSourceScript(feed), scriptBusy: false, port, t }
}
function pending<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Missing resolver') }
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
async function prepare() {
  const checkbox = await screen.findByRole('checkbox', { name: zh.stageSourceConfirm })
  fireEvent.click(checkbox)
  return screen.getByRole<HTMLButtonElement>('button', { name: zh.stageSourceBind })
}
async function savedIntent(feed = stageSourceFeed()) {
  const request = stageSourceRequest(feed)
  const marker = await createStageSourceMarker({ projectId: feed.projectId, episodeId: feed.episodeId, stageId: 'A1S',
    expectedSubjectSha256: request.expectedSubjectSha256, expectedBindingRevision: request.expectedBindingRevision,
    expectedBindingSha256: request.expectedBindingSha256, methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256 })
  expect(writeStageSourceMarker(marker)).toBe(true)
  return { marker, result: stageSourceResult({ ...request, idempotencyKey: marker.idempotencyKey }) }
}
function markerKey(scope = stageSourceFeed()) {
  return ['qingmu:stage-source-recovery:v1', scope.projectId, scope.episodeId].map(encodeURIComponent).join(':')
}
function refreshedMethod(projection: ImagoStageSourceMethodResponse['projection']): ImagoStageSourceMethodResponse {
  const projectionSha256 = shotFindingSha(projection)
  return { schema: 'qingmu.imago-stage-source-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: { schema: 'qingmu.imago-stage-source-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: projection.subjectSnapshotSha256, methodProjectionSha256: projectionSha256, signature: 'b'.repeat(64) } }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('saved screenplay source in the existing script workspace', () => {
  it('reads the source and current method without writing or selecting a Skill', async () => {
    const { port } = makePort()
    render(<StageSourceView {...props(port)} />)
    const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', { name: zh.stageSourceConfirm })
    expect(checkbox.checked).toBe(false)
    expect(port.stageSources).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-source', episodeId: 'episode-source' }, expect.any(AbortSignal))
    expect(port.stageSourceMethod).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-source', episodeId: 'episode-source', stageId: 'A1S' }, expect.any(AbortSignal))
    expect(port.bindStageSource).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('persists the exact intent before POST and rereads authority without claiming approval', async () => {
    const { port } = makePort()
    const original = port.bindStageSource.getMockImplementation()
    port.bindStageSource.mockImplementation(async (request, signal) => {
      expect(readStageSourceMarker(request)).toMatchObject({ status: 'ready', marker: { idempotencyKey: request.idempotencyKey } })
      if (original === undefined) throw new Error('Missing fixture')
      return original(request, signal)
    })
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await prepare())
    expect(await screen.findByText(zh.stageSourceStored)).toBeTruthy()
    await waitFor(() => { expect(port.stageSources).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(zh.stageSourceCurrent)).toBeTruthy()
    expect(port.bindStageSource).toHaveBeenCalledOnce()
    const request = port.bindStageSource.mock.calls[0]?.[0]
    expect(request).toMatchObject({ expectedBindingRevision: 0, expectedBindingSha256: null,
      methodProjection: { definition: { sourceUsage: 'source_reference_only', stageApprovalAllowed: false } } })
    expect(sessionStorage.length).toBe(0)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('recovers only the original GET receipt when the source and method are gone', async () => {
    const { marker, result } = await savedIntent()
    const feed: YimengStageSourcesResponse = { ...stageSourceBoundFeed(stageSourceFeed(), result), source: null,
      subjectSnapshotSha256: null, unavailableReason: 'episode_script_missing', currentBinding: null, canBind: false }
    const { port } = makePort(feed)
    port.recoverStageSourceBinding.mockResolvedValue({ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result })
    render(<StageSourceView {...props(port, feed)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    expect(await screen.findByText(zh.stageSourceRecovered)).toBeTruthy()
    expect(port.recoverStageSourceBinding).toHaveBeenCalledExactlyOnceWith({ projectId: marker.projectId,
      episodeId: marker.episodeId, stageId: 'A1S', expectedSubjectSha256: marker.expectedSubjectSha256,
      idempotencyKey: marker.idempotencyKey }, expect.any(AbortSignal))
    expect(port.bindStageSource).not.toHaveBeenCalled()
    expect(port.stageSourceMethod).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('does not label an accepted receipt as current before authoritative reread', async () => {
    const { port } = makePort()
    const reread = pending<YimengStageSourcesResponse>()
    port.stageSources.mockResolvedValueOnce(stageSourceFeed()).mockReturnValue(reread.promise)
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await prepare())
    expect(await screen.findByText(zh.stageSourceStored)).toBeTruthy()
    expect(screen.queryByText(zh.stageSourceCurrent)).toBeNull()
    await act(async () => { reread.resolve(stageSourceBoundFeed()); await reread.promise })
    expect(await screen.findByText(zh.stageSourceCurrent)).toBeTruthy()
  })

  it('rejects a different visible saved revision before confirmation', async () => {
    const { port } = makePort()
    const input = props(port)
    render(<StageSourceView {...input} savedScript={{ ...input.savedScript, revision: 5 }} />)
    expect(await screen.findByText(zh.stageSourceEditorMismatch)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it('distinguishes a historical source after a metadata-only full-content SHA change', async () => {
    const old = stageSourceBoundFeed()
    if (old.source === null) throw new Error('Missing fixture')
    const source = { ...old.source, contentSha256: 'f'.repeat(64) }
    const feed = { ...old, source, subjectSnapshotSha256: shotFindingSha(source), currentBinding: null }
    const { port } = makePort(feed)
    render(<StageSourceView {...props(port, feed)} />)
    expect(await screen.findByText(zh.stageSourceHistorical)).toBeTruthy()
    fireEvent.click(await prepare())
    await waitFor(() => { expect(port.bindStageSource).toHaveBeenCalledOnce() })
    expect(port.bindStageSource.mock.calls[0]?.[0]).toMatchObject({ expectedSubjectSha256: feed.subjectSnapshotSha256,
      expectedBindingRevision: 1, expectedBindingSha256: old.bindingSha256 })
  })

  it('requires a new explicit confirmation for changed rules without mislabeling the current source', async () => {
    const feed = stageSourceBoundFeed()
    const { port } = makePort(feed)
    const projection = stageSourceMethod(feed).projection
    const ruleBindings = { ...projection.ruleBindings, 'scripts/compile_qingmu_stage_source_method.py': '9'.repeat(64) }
    port.stageSourceMethod.mockResolvedValue(refreshedMethod({ ...projection, ruleBindings, rulesSha256: shotFindingSha(ruleBindings) }))
    render(<StageSourceView {...props(port, feed)} />)
    expect(await screen.findByText(zh.stageSourceCurrent)).toBeTruthy()
    expect(await screen.findByText(zh.stageSourceRulesChanged)).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
    expect(port.bindStageSource).not.toHaveBeenCalled()
    fireEvent.click(await prepare())
    await waitFor(() => { expect(port.bindStageSource).toHaveBeenCalledOnce() })
    expect(port.bindStageSource.mock.calls[0]?.[0].expectedBindingRevision).toBe(1)
  })

  it('keeps history readable when the method plugin is unavailable', async () => {
    const feed = stageSourceBoundFeed()
    const { port } = makePort(feed)
    port.stageSourceMethod.mockRejectedValue(new Error('Plugin removed'))
    render(<StageSourceView {...props(port, feed)} />)
    expect(await screen.findByText(zh.stageSourceMethodUnavailable)).toBeTruthy()
    expect(screen.getByText(zh.stageSourceCurrent)).toBeTruthy()
    expect(screen.getByText(zh.stageSourceRulesUnknown)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('keeps permission independent of source availability and never writes for a read-only account', async () => {
    const feed = { ...stageSourceFeed(), canBind: false }
    const { port } = makePort(feed)
    render(<StageSourceView {...props(port, feed)} />)
    expect(await screen.findByText(zh.stageSourceReadOnly)).toBeTruthy()
    await waitFor(() => { expect(port.stageSourceMethod).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it('clears confirmation while the existing script operation is busy', async () => {
    const { port } = makePort()
    const input = props(port)
    const view = render(<StageSourceView {...input} />)
    expect((await prepare()).disabled).toBe(false)
    view.rerender(<StageSourceView {...input} scriptBusy />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.stageSourceBind }).disabled).toBe(true)
    view.rerender(<StageSourceView {...input} />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it('blocks synchronous repeated clicks before the first marker digest finishes', async () => {
    const { port } = makePort()
    const response = pending<YimengStageSourceResult>()
    port.bindStageSource.mockReturnValue(response.promise)
    render(<StageSourceView {...props(port)} />)
    const button = await prepare()
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    await waitFor(() => { expect(port.bindStageSource).toHaveBeenCalledOnce() })
    await act(async () => { response.resolve(stageSourceResult()); await response.promise })
  })

  it('does not send a command when storage cannot retain the recovery marker', async () => {
    const { port } = makePort()
    render(<StageSourceView {...props(port)} />)
    const button = await prepare()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No storage') })
    fireEvent.click(button)
    expect(await screen.findByText(zh.stageSourceStorageFailed)).toBeTruthy()
    expect(port.bindStageSource).not.toHaveBeenCalled()
    expect(port.recoverStageSourceBinding).not.toHaveBeenCalled()
  })

  it('retains a lost-response marker across remount and only queries the original receipt', async () => {
    const harness = makePort()
    let accepted: YimengStageSourceResult | undefined
    harness.port.bindStageSource.mockImplementation(async (request) => {
      accepted = stageSourceResult(request)
      harness.setFeed(stageSourceBoundFeed(stageSourceFeed(), accepted))
      throw new Error('Response lost after commit')
    })
    const input = props(harness.port)
    const view = render(<StageSourceView {...input} />)
    fireEvent.click(await prepare())
    expect(await screen.findByText(zh.stageSourceOperationFailed)).toBeTruthy()
    expect(harness.port.recoverStageSourceBinding).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(1)
    view.unmount()
    if (accepted === undefined) throw new Error('No accepted fixture')
    harness.port.recoverStageSourceBinding.mockResolvedValue({ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: accepted })
    render(<StageSourceView {...input} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    expect(await screen.findByText(zh.stageSourceRecovered)).toBeTruthy()
    expect(harness.port.bindStageSource).toHaveBeenCalledOnce()
    expect(harness.port.recoverStageSourceBinding).toHaveBeenCalledOnce()
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps the original marker on a 404 receipt lookup and never posts as a fallback', async () => {
    await savedIntent()
    const { port } = makePort()
    port.recoverStageSourceBinding.mockRejectedValue(new Error('command_receipt_not_found'))
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    expect(await screen.findByText(zh.stageSourceRecoveryFailed)).toBeTruthy()
    expect(sessionStorage.length).toBe(1)
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it('rejects a structurally plausible but changed marker fingerprint before GET', async () => {
    const { marker } = await savedIntent()
    sessionStorage.setItem(markerKey(), JSON.stringify({ ...marker, expectedSubjectSha256: '1'.repeat(64) }))
    const { port } = makePort()
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    expect(await screen.findByText(zh.stageSourceRecoveryFailed)).toBeTruthy()
    expect(port.recoverStageSourceBinding).not.toHaveBeenCalled()
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it('does not clear a newer recovery marker when the older lookup finishes', async () => {
    const { result } = await savedIntent()
    const { port } = makePort()
    const response = pending<Awaited<ReturnType<Port['recoverStageSourceBinding']>>>()
    port.recoverStageSourceBinding.mockReturnValue(response.promise)
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    await waitFor(() => { expect(port.recoverStageSourceBinding).toHaveBeenCalledOnce() })
    sessionStorage.clear()
    const next = await savedIntent(stageSourceBoundFeed(stageSourceFeed(), result))
    await act(async () => { response.resolve({ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result }); await response.promise })
    expect(await screen.findByText(zh.stageSourceClearFailed)).toBeTruthy()
    expect(readStageSourceMarker(stageSourceFeed())).toEqual({ status: 'ready', marker: next.marker })
  })

  it('does not display an old current binding when the post-command authoritative read fails', async () => {
    const { port } = makePort()
    port.stageSources.mockResolvedValueOnce(stageSourceFeed()).mockRejectedValue(new Error('Read unavailable'))
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await prepare())
    expect(await screen.findByText(zh.stageSourceReadFailed)).toBeTruthy()
    expect(screen.getByText(zh.stageSourceStored)).toBeTruthy()
    expect(screen.queryByText(zh.stageSourceCurrent)).toBeNull()
    expect(port.bindStageSource).toHaveBeenCalledOnce()
  })

  it('cancels an old read when the Host port is replaced and ignores an abort-insensitive reply', async () => {
    const first = makePort()
    const response = pending<YimengStageSourcesResponse>()
    first.port.stageSources.mockReturnValue(response.promise)
    const input = props(first.port)
    const view = render(<StageSourceView {...input} />)
    await waitFor(() => { expect(first.port.stageSources).toHaveBeenCalledOnce() })
    const signal = first.port.stageSources.mock.calls[0]?.[1]
    const next = makePort({ ...stageSourceFeed(), canBind: false })
    view.rerender(<StageSourceView {...input} port={next.port} />)
    expect(await screen.findByText(zh.stageSourceReadOnly)).toBeTruthy()
    await act(async () => { response.resolve(stageSourceFeed()); await response.promise })
    expect(signal?.aborted).toBe(true)
    expect(first.port.stageSourceMethod).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('invalidates a method response and confirmation when the saved script changes', async () => {
    const initial = stageSourceFeed()
    if (initial.source === null) throw new Error('No fixture source')
    const harness = makePort(initial)
    const response = pending<ImagoStageSourceMethodResponse>()
    harness.port.stageSourceMethod.mockReturnValueOnce(response.promise)
    const input = props(harness.port, initial)
    const view = render(<StageSourceView {...input} />)
    await waitFor(() => { expect(harness.port.stageSourceMethod).toHaveBeenCalledOnce() })
    const signal = harness.port.stageSourceMethod.mock.calls[0]?.[1]
    const source = { ...initial.source, revision: 5 }
    const next = { ...initial, source, subjectSnapshotSha256: shotFindingSha(source) }
    harness.setFeed(next)
    view.rerender(<StageSourceView {...input} savedScript={stageSourceScript(next)} />)
    await screen.findByRole('checkbox', { name: zh.stageSourceConfirm })
    await act(async () => { response.resolve(stageSourceMethod(initial)); await response.promise })
    expect(signal?.aborted).toBe(true)
    fireEvent.click(await prepare())
    await waitFor(() => { expect(harness.port.bindStageSource).toHaveBeenCalledOnce() })
    expect(harness.port.bindStageSource.mock.calls[0]?.[0].expectedSubjectSha256).toBe(next.subjectSnapshotSha256)
  })

  it.each(['bind', 'recover'] as const)('preserves the marker when unmounted during %s', async (kind) => {
    const { port } = makePort()
    let result: YimengStageSourceResult
    const binding = pending<YimengStageSourceResult>()
    const recovery = pending<Awaited<ReturnType<Port['recoverStageSourceBinding']>>>()
    port.bindStageSource.mockReturnValue(binding.promise)
    port.recoverStageSourceBinding.mockReturnValue(recovery.promise)
    if (kind === 'recover') result = (await savedIntent()).result
    else result = stageSourceResult()
    const view = render(<StageSourceView {...props(port)} />)
    if (kind === 'bind') fireEvent.click(await prepare())
    else fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    const call = kind === 'bind' ? port.bindStageSource : port.recoverStageSourceBinding
    await waitFor(() => { expect(call).toHaveBeenCalledOnce() })
    const signal = call.mock.calls[0]?.[1]
    view.unmount()
    await act(async () => {
      binding.resolve(result)
      recovery.resolve({ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result })
      await Promise.all([binding.promise, recovery.promise])
    })
    expect(signal?.aborted).toBe(true)
    expect(sessionStorage.length).toBe(1)
  })

  it('keeps both language dictionaries aligned for the new workflow', () => {
    const keys = Object.keys(zh).filter(key => key.startsWith('stageSource'))
    expect(keys.length).toBeGreaterThan(0)
    expect(Object.keys(en).filter(key => key.startsWith('stageSource'))).toEqual(keys)
    expect(Object.values(en).every(value => typeof value === 'string' && value.length > 0)).toBe(true)
  })
})

describe('source-reference browser wire boundary', () => {
  it('checks descriptor, projection and rule digests without hashing the float-containing script', async () => {
    const feed = stageSourceFeed()
    await expect(verifyStageSourceFeed(feed, feed)).resolves.toBeUndefined()
    await expect(verifyStageSourceMethod(stageSourceMethod(feed), feed)).resolves.toBeUndefined()
  })

  it.each([
    { revision: true }, { revision: 1.5 }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { sourceId: 'different-episode' }, { contentSha256: `${'a'.repeat(64)}\n` },
    { projectId: '\u001fproject-source' }, { sourceId: '\ud800' }, { extra: true },
  ])('rejects noncanonical source coordinates %j', async (change) => {
    const feed = stageSourceFeed()
    const source = { ...feed.source, ...change }
    const poisoned = { ...feed, source } as unknown as YimengStageSourcesResponse
    await expect(verifyStageSourceFeed(poisoned, feed)).rejects.toThrow()
  })

  it.each([
    { sourceUsage: 'stage_artifact' }, { stageArtifactCreationAllowed: true }, { stageApprovalAllowed: true },
    { providerCalls: 1 }, { scope: 'per_lsu' }, { canonicalOutput: 'other.json' }, { extra: 'authority' },
  ])('rejects authority or contract changes in method definition %j', async (change) => {
    const feed = stageSourceFeed()
    const method = stageSourceMethod(feed)
    const projection = { ...method.projection, definition: { ...method.projection.definition, ...change } }
    const poisoned = refreshedMethod(projection as ImagoStageSourceMethodResponse['projection'])
    await expect(verifyStageSourceMethod(poisoned, feed)).rejects.toThrow()
  })

  it.each(['stageArtifactCreated', 'stageApprovalGranted', 'lockActivated', 'planSealed', 'humanSignoffInferred', 'reworkExecuted'] as const)
  ('refuses a recovery receipt that grants %s, even with a matching binding digest', async (field) => {
    const { result } = await savedIntent()
    const binding = { ...result.binding, [field]: true }
    const { port } = makePort()
    port.recoverStageSourceBinding.mockResolvedValue({ schema: 'jason.qingmu-stage-source-recovery.v1',
      receipt: { ...result, binding, bindingSha256: shotFindingSha(binding) } })
    render(<StageSourceView {...props(port)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.stageSourceRecover }))
    expect(await screen.findByText(zh.stageSourceRecoveryFailed)).toBeTruthy()
    expect(sessionStorage.length).toBe(1)
    expect(port.bindStageSource).not.toHaveBeenCalled()
  })

  it.each(['revision', 'contentSha256'] as const)('requires full source currency when only %s changes', async (field) => {
    const original = stageSourceBoundFeed()
    if (original.source === null) throw new Error('No fixture source')
    const source = { ...original.source, [field]: field === 'revision' ? 5 : 'f'.repeat(64) }
    const changed = { ...original, source, subjectSnapshotSha256: shotFindingSha(source) }
    await expect(verifyStageSourceFeed(changed, changed)).rejects.toThrow()
    await expect(verifyStageSourceFeed({ ...changed, currentBinding: null }, changed)).resolves.toBeUndefined()
  })

  it('does not equate a different current receipt with the same binding hash', async () => {
    const feed = stageSourceBoundFeed()
    if (feed.currentBinding === null) throw new Error('No fixture binding')
    await expect(verifyStageSourceFeed({ ...feed, currentBinding: { ...feed.currentBinding, receiptId: 'another-receipt' } }, feed)).rejects.toThrow()
  })

  it('preserves FEFF and non-BMP canonical IDs rather than silently normalizing them', async () => {
    const original = stageSourceFeed()
    if (original.source === null) throw new Error('No fixture source')
    const source = { ...original.source, projectId: '\ufeff项目😀', episodeId: '剧集😀\ufeff', sourceId: '剧集😀\ufeff' }
    const feed = { ...original, projectId: source.projectId, episodeId: source.episodeId,
      source, subjectSnapshotSha256: shotFindingSha(source) }
    await expect(verifyStageSourceFeed(feed, feed)).resolves.toBeUndefined()
    await expect(verifyStageSourceMethod(stageSourceMethod(feed), feed)).resolves.toBeUndefined()
  })
})
