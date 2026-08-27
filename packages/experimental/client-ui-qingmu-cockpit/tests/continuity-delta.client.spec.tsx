// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ImagoContinuityMethodResponse, QingmuImagoMethodPort, YimengWorkflowProjection } from '../src/client/contracts.ts'
import { rebindContinuity } from '../../qingmu-yimeng-read-adapter/tests/continuity-fixture.ts'
import { ContinuityDeltaView } from '../src/client/ContinuityDeltaView.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { continuityResponse, continuitySource } from './fixtures/continuity-method.client.ts'

const t = (key: QingmuCockpitKey) => zh[key]
function props(port: Pick<QingmuImagoMethodPort, 'continuityMethod'>, projection = continuitySource(), selectedShotId = 'frame-a') {
  return { port, projectId: projection.projectId, episodeId: projection.episodeId, selectedShotId, projection, enabled: true, t }
}
function pending<T>() {
  let accept: (value: T) => void = () => { throw new Error('promise not initialized') }
  let fail: (reason: Error) => void = () => { throw new Error('promise not initialized') }
  const promise = new Promise<T>((resolve, reject) => { accept = resolve; fail = reject })
  return { promise, resolve: (value: T) => { accept(value) }, reject: (reason: Error) => { fail(reason) } }
}
function historicalSource(): YimengWorkflowProjection {
  const source = continuitySource()
  const delta = source.director.continuityDelta
  if (delta === undefined) throw new Error('fixture evidence missing')
  return { ...source, director: { ...source.director, continuityDelta: rebindContinuity({ ...delta, pairs: delta.pairs.map(pair => ({
    ...pair, bindingStatus: 'different', currentEvidenceReady: false, legacyEvidenceReady: false, legacyStatus: 'blocked',
    currentBinding: { ...pair.currentBinding, tailAssetId: 'new-tail', tailSha256: 'e'.repeat(64) },
    audit: { ...pair.audit, passed: false, dimensions: pair.audit.dimensions.map(item => item.dimension === 'prop' ? { ...item, result: false, reason: '旧记录中的道具位置不符' } : item) },
  })) }) } }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('selected Shot continuity view', () => {
  it.each(['no-source', 'no-shot', 'disabled'] as const)('does not request or claim loading for %s', (kind) => {
    const port = { continuityMethod: vi.fn() }
    render(<ContinuityDeltaView {...props(port)} projection={kind === 'no-source' ? undefined : continuitySource()}
      selectedShotId={kind === 'no-shot' ? '' : 'frame-a'} enabled={kind !== 'disabled'} />)
    expect(port.continuityMethod).not.toHaveBeenCalled()
    expect(screen.queryByText(zh.continuityLoading)).toBeNull()
    expect(screen.getByRole('button', { name: zh.continuityRefresh }).hasAttribute('disabled')).toBe(true)
  })

  it('uses only three IDs and exposes current/historical binding without any mutation control', async () => {
    const source = continuitySource()
    const port = { continuityMethod: vi.fn(async () => continuityResponse(source, 'frame-a')) }
    render(<ContinuityDeltaView {...props(port, source)} />)
    expect(await screen.findByText(zh.continuityCurrentReady)).toBeTruthy()
    expect(port.continuityMethod).toHaveBeenCalledWith({ projectId: source.projectId, episodeId: source.episodeId, selectedShotId: 'frame-a' }, expect.any(AbortSignal))
    const incoming = screen.getByRole('article', { name: zh.continuityIncoming })
    expect(within(incoming).getByText('7 → 12')).toBeTruthy()
    expect(screen.getAllByText(zh.continuityMatch)).toHaveLength(4)
    fireEvent.click(within(incoming).getByText(zh.continuityBindings))
    expect(within(incoming).getAllByText('tail-e55')).toHaveLength(2)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByText(`${zh.continuityLocks} · 2`))
    expect(screen.getByText(zh.continuityLocksBoundary)).toBeTruthy()
    expect(screen.getByText(zh.continuityLockScript)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.continuityEvidence))
    expect(screen.getByText('3'.repeat(64))).toBeTruthy()
  })

  it('separates historical failures and leaves attribution, severity, and execution pending', async () => {
    const source = historicalSource()
    const port = { continuityMethod: vi.fn(async () => continuityResponse(source, 'frame-a')) }
    render(<ContinuityDeltaView {...props(port, source)} />)
    expect(await screen.findByText(zh.continuityHistorical)).toBeTruthy()
    const candidates = screen.getByRole('list', { name: zh.continuityCandidates })
    expect(within(candidates).getAllByRole('listitem')).toHaveLength(1)
    expect(within(candidates).getByText(`${zh.continuityProp} · ${zh.continuityScopeHistorical}`)).toBeTruthy()
    expect(within(candidates).getByText(zh.continuityPending)).toBeTruthy()
    expect(screen.queryByText(zh.continuityCurrentReady)).toBeNull()
  })

  it('shows an omitted business evidence source as unavailable, not as a continuity pass', async () => {
    const original = continuitySource()
    const { continuityDelta: _removed, ...director } = original.director
    const source = { ...original, director }
    const port = { continuityMethod: vi.fn(async () => continuityResponse(source, 'frame-a')) }
    render(<ContinuityDeltaView {...props(port, source)} />)
    expect(await screen.findByText(zh.continuityUnavailable)).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText(zh.continuityNoCandidates)).toBeTruthy()
  })

  it.each(['missing-dimension', 'stale-selected-chain'] as const)('does not promote %s to a current check result', async (kind) => {
    const base = continuitySource()
    const delta = base.director.continuityDelta
    if (delta === undefined) throw new Error('fixture evidence missing')
    const changed = rebindContinuity({ ...delta, pairs: delta.pairs.map(pair => ({
      ...pair, legacyEvidenceReady: false, legacyStatus: 'blocked', currentEvidenceReady: false,
      currentBinding: { ...pair.currentBinding, nextFirstFrameStale: kind === 'stale-selected-chain' },
      audit: { ...pair.audit, passed: kind === 'missing-dimension' ? null : false,
        dimensions: pair.audit.dimensions.map(item => item.dimension === 'prop'
          ? { ...item, result: kind === 'missing-dimension' ? null : false, reason: null } : item),
      },
    })) })
    const source = { ...base, director: { ...base.director, continuityDelta: changed } }
    render(<ContinuityDeltaView {...props({ continuityMethod: vi.fn(async () => continuityResponse(source, 'frame-a')) }, source)} />)
    await screen.findByText(zh.continuityCurrentUnverified)
    expect(screen.queryByText(zh.continuityCurrentReady)).toBeNull()
    if (kind === 'missing-dimension') {
      expect(screen.getByRole('row', { name: `${zh.continuityProp} ${zh.continuityUnknown}` })).toBeTruthy()
      expect(screen.queryByRole('list', { name: zh.continuityCandidates })).toBeNull()
    } else {
      expect(screen.getByText(`${zh.continuityProp} · ${zh.continuityScopeUnavailable}`)).toBeTruthy()
      expect(screen.queryByText(`${zh.continuityProp} · ${zh.continuityScopeCurrent}`)).toBeNull()
    }
  })

  it.each(['subject', 'revision', 'evidence', 'approval', 'owner'] as const)('rejects mismatched %s results', async (kind) => {
    const source = continuitySource()
    const base = continuityResponse(source, 'frame-a')
    const response = { ...base, projection: {
      ...base.projection,
      ...(kind === 'subject' ? { subject: { ...base.projection.subject, selectedShotId: 'frame-z' } } : {}),
      ...(kind === 'revision' ? { subject: { ...base.projection.subject, storyboardRevision: { ...base.projection.subject.storyboardRevision, revisionVersion: 5 } } } : {}),
      ...(kind === 'evidence' ? { continuity_snapshot_sha256: '0'.repeat(64) } : {}),
      ...(kind === 'approval' ? { human_signoff_inferred: true } : {}),
      ...(kind === 'owner' ? { candidate_findings: [{ formal_finding: true, earliest_owner: 'F' }] } : {}),
    } } as ImagoContinuityMethodResponse
    render(<ContinuityDeltaView {...props({ continuityMethod: vi.fn(async () => response) }, source)} />)
    expect((await screen.findByRole('alert')).textContent).toContain(zh.continuityInvalid)
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('invalidates an old result immediately when same-fingerprint source identity refreshes', async () => {
    const source = continuitySource()
    const next = pending<ImagoContinuityMethodResponse>()
    const port = { continuityMethod: vi.fn().mockResolvedValueOnce(continuityResponse(source, 'frame-a')).mockReturnValueOnce(next.promise) }
    const view = render(<ContinuityDeltaView {...props(port, source)} />)
    await screen.findByText(zh.continuityCurrentReady)
    view.rerender(<ContinuityDeltaView {...props(port, { ...source })} />)
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText(zh.continuityLoading)).toBeTruthy()
    await act(async () => { next.reject(new Error('source unavailable')) })
    expect(screen.getByRole('alert').textContent).toContain('source unavailable')
  })

  it('aborts on Shot changes and ignores a late old reply even if transport ignores cancellation', async () => {
    const source = continuitySource()
    const old = pending<ImagoContinuityMethodResponse>()
    const port = { continuityMethod: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(continuityResponse(source, 'frame-z')) }
    const view = render(<ContinuityDeltaView {...props(port, source)} />)
    const oldSignal = port.continuityMethod.mock.calls[0]?.[1] as AbortSignal
    view.rerender(<ContinuityDeltaView {...props(port, source, 'frame-z')} />)
    await screen.findByText(zh.continuityCurrentReady)
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { old.resolve(continuityResponse(source, 'frame-a')) })
    expect(within(screen.getByRole('article', { name: zh.continuityIncoming })).getByText(zh.continuityNoAdjacent)).toBeTruthy()
    expect(within(screen.getByRole('article', { name: zh.continuityOutgoing })).getByText('7 → 12')).toBeTruthy()
  })

  it('clears old facts during manual reload and cancels the request when disabled', async () => {
    const source = continuitySource()
    const next = pending<ImagoContinuityMethodResponse>()
    const port = { continuityMethod: vi.fn().mockResolvedValueOnce(continuityResponse(source, 'frame-a')).mockReturnValueOnce(next.promise) }
    const initial = props(port, source)
    const view = render(<ContinuityDeltaView {...initial} />)
    await screen.findByText(zh.continuityCurrentReady)
    fireEvent.click(screen.getByRole('button', { name: zh.continuityRefresh }))
    expect(screen.queryByRole('article')).toBeNull()
    const activeSignal = port.continuityMethod.mock.calls[1]?.[1] as AbortSignal
    view.rerender(<ContinuityDeltaView {...initial} enabled={false} />)
    expect(activeSignal.aborted).toBe(true)
    expect(screen.queryByText(zh.continuityLoading)).toBeNull()
    await act(async () => { next.resolve(continuityResponse(source, 'frame-a')) })
    expect(screen.queryByRole('article')).toBeNull()
  })
})
