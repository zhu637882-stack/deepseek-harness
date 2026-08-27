// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ImagoShotFindingMethodResponse, QingmuYimengPort, YimengShotFindingFeedResponse,
  YimengShotFindingRecovery, YimengShotFindingResult, YimengProductionUnitSource, YimengProductionUnitsResponse,
} from '../src/client/contracts.ts'
import { ShotFindingView } from '../src/client/ShotFindingView.tsx'
import { zh, type QingmuCockpitKey } from '../src/client/locales.ts'
import { createShotFindingMarker, readShotFindingMarker, writeShotFindingMarker } from '../src/client/shot-finding-recovery.ts'
import type { ShotFindingRecoveryMarker } from '../src/client/shot-finding-contract.ts'
import {
  shotFindingAuthorInput, shotFindingFeed, shotFindingMethod, shotFindingResult, shotFindingSha, shotFindingSource,
} from './fixtures/shot-finding.client.ts'
import { productionUnitsFeed } from '../../qingmu-yimeng-read-adapter/tests/production-unit-fixture.ts'

type Port = Pick<QingmuYimengPort, 'shotFindings' | 'shotFindingMethod' | 'recordShotFinding' | 'recoverShotFinding'>
const t = (key: QingmuCockpitKey) => zh[key]
function props(port: Port, projection = shotFindingSource(), selectedShotId = 'frame-a') {
  return { projectId: projection.projectId, episodeId: projection.episodeId, projection, selectedShotId, enabled: true, port, t }
}
function makePort(feed = shotFindingFeed()) {
  const method = feed.subject === null ? undefined : shotFindingMethod(feed)
  return {
    shotFindings: vi.fn<Port['shotFindings']>().mockResolvedValue(feed),
    shotFindingMethod: vi.fn<Port['shotFindingMethod']>().mockImplementation(async () => {
      if (method === undefined) throw new Error('No current method')
      return method
    }),
    recordShotFinding: vi.fn<Port['recordShotFinding']>().mockImplementation(async (request) => {
      if (method === undefined) throw new Error('No current method')
      return shotFindingResult(method, request.finding)
    }),
    recoverShotFinding: vi.fn<Port['recoverShotFinding']>(),
  }
}
async function fill() {
  await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
  const value = shotFindingAuthorInput()
  for (const [key, text] of [
    ['findingTimecode', value.timecode], ['findingObservation', value.observation],
    ['findingEvidenceRefs', value.evidenceRefs.join('\n')], ['findingOwnerReason', value.ownerReason],
    ['findingSuggestion', value.suggestion], ['findingReworkScope', value.reworkScope],
  ] as const) fireEvent.change(screen.getByRole('textbox', { name: zh[key] }), { target: { value: text } })
  fireEvent.change(screen.getByRole('combobox', { name: zh.findingEarliestOwner }), { target: { value: value.earliestOwner } })
  fireEvent.change(screen.getByRole('combobox', { name: zh.findingSeverity }), { target: { value: value.severity } })
  return value
}
function pending<T>() {
  let resolve: (value: T) => void = () => { throw new Error('No resolver') }
  let reject: (reason: Error) => void = () => { throw new Error('No rejecter') }
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
function changedFeed(feed: YimengShotFindingFeedResponse, changes: Partial<NonNullable<YimengShotFindingFeedResponse['subject']>>) {
  if (feed.subject === null) throw new Error('Fixture needs a current subject')
  const subject = { ...feed.subject, ...changes }
  return { ...feed, subject, snapshotSha256: shotFindingSha(subject) }
}
async function savedIntent(feed = shotFindingFeed()) {
  const method = shotFindingMethod(feed)
  const result = shotFindingResult(method)
  const marker = await createShotFindingMarker({
    projectId: feed.projectId, episodeId: feed.episodeId, frameId: feed.frameId,
    expectedSubjectSha256: method.projection.subjectSnapshotSha256,
    findingSha256: shotFindingSha(shotFindingAuthorInput()), methodProjectionSha256: method.projectionSha256,
  })
  expect(writeShotFindingMarker(marker)).toBe(true)
  return { marker, result }
}
function recovery(marker: ShotFindingRecoveryMarker, result: YimengShotFindingResult | null): YimengShotFindingRecovery {
  return { schema: 'jason.qingmu-shot-finding-recovery.v1', projectId: marker.projectId,
    episodeId: marker.episodeId, frameId: marker.frameId, expectedSubjectSha256: marker.expectedSubjectSha256,
    idempotencyKey: marker.idempotencyKey, status: result === null ? 'not_found' : 'committed', result }
}
function storageKey(marker: ShotFindingRecoveryMarker) {
  return ['qingmu:shot-finding-recovery:v1', marker.projectId, marker.episodeId, marker.frameId].map(encodeURIComponent).join(':')
}
function unitEvidence(changes: Partial<YimengProductionUnitSource> = {}, currentBinding = true): YimengProductionUnitsResponse {
  const feed = productionUnitsFeed()
  const subject = shotFindingResult().finding.subject
  const previous = feed.bindings[0]
  if (previous === undefined) throw new Error('Controlled unit fixture needs a binding')
  const source: YimengProductionUnitSource = { ...previous.binding.source, projectId: subject.projectId, episodeId: subject.episodeId,
    storyboardRevision: subject.storyboardRevision,
    shots: [{ frameId: subject.frameId, frameNo: subject.frameNo, frameContentSha256: subject.frameContentSha256 }], ...changes }
  const binding = { ...previous.binding, projectId: source.projectId, episodeId: source.episodeId, source,
    sourceSnapshotSha256: shotFindingSha(source) }
  const currentSource = currentBinding ? source : { ...source, title: 'Changed native group title' }
  return { ...feed, projectId: source.projectId, episodeId: source.episodeId,
    groups: [{ groupId: source.groupId, subject: currentSource, snapshotSha256: shotFindingSha(currentSource),
      availability: { status: 'available', reason: null } }],
    bindings: [{ binding, bindingSha256: shotFindingSha(binding), currentBinding }] }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('same-Shot Finding authoring', () => {
  it('reads exactly three IDs, uses episodeRevision, and never auto-selects Owner or severity', async () => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    const owner = await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect((owner as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.findingSeverity }).value).toBe('')
    expect(within(owner).getByRole('option', { name: zh.findingOwnerStoryboard }).getAttribute('value')).toBe('C5F')
    expect(within(owner).queryByRole('option', { name: 'C5F' })).toBeNull()
    const source = shotFindingSource()
    const ids = { projectId: source.projectId, episodeId: source.episodeId, frameId: 'frame-a' }
    expect(port.shotFindings).toHaveBeenCalledExactlyOnceWith(ids, expect.any(AbortSignal))
    expect(port.shotFindingMethod).toHaveBeenCalledExactlyOnceWith(ids, expect.any(AbortSignal))
    expect(screen.getByText(zh.findingVersionUnknown)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.findingRecord }).hasAttribute('disabled')).toBe(true)
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('persists the nonsecret marker before one explicit POST and preserves all eight author fields', async () => {
    const feed = shotFindingFeed()
    const port = makePort(feed)
    const receipt = pending<YimengShotFindingResult>()
    port.recordShotFinding.mockImplementation(async (request) => {
      const marker = readShotFindingMarker(request)
      expect(marker.status).toBe('ready')
      expect(JSON.stringify(marker)).not.toContain(shotFindingAuthorInput().observation)
      return await receipt.promise
    })
    render(<ShotFindingView {...props(port)} />)
    const author = await fill()
    const button = screen.getByRole('button', { name: zh.findingRecord })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => { expect(port.recordShotFinding).toHaveBeenCalledOnce() })
    const request = port.recordShotFinding.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('Request not sent')
    expect(request.finding).toEqual(author)
    expect(request.finding.evidenceRefs).toHaveLength(2)
    expect(Object.keys(request).sort()).toEqual(['episodeId', 'expectedSubjectSha256', 'finding', 'frameId', 'idempotencyKey',
      'methodAttestation', 'methodProjection', 'methodProjectionSha256', 'projectId'])
    await act(async () => { receipt.resolve(shotFindingResult(shotFindingMethod(feed), author)) })
    expect(await screen.findByText(zh.findingStored)).toBeTruthy()
    expect(readShotFindingMarker(request).status).toBe('none')
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it('keeps readable history when the method plugin is unplugged', async () => {
    const feed = shotFindingFeed()
    const record = shotFindingResult(shotFindingMethod(feed)).finding
    const history = { ...feed, items: [{ ...record, currentBinding: true }] }
    const port = makePort(history)
    port.shotFindingMethod.mockRejectedValue(new Error('plugin unavailable'))
    render(<ShotFindingView {...props(port)} />)
    expect(await screen.findByText(zh.findingMethodUnavailable)).toBeTruthy()
    expect(screen.getByRole('list', { name: zh.findingHistory }).textContent).toContain(record.observation)
    expect(screen.queryByRole('combobox', { name: zh.findingEarliestOwner })).toBeNull()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('rejects the revisionVersion domain even when the feed subject is correctly rehashed', async () => {
    const source = shotFindingSource()
    const feed = shotFindingFeed(source)
    const wrong = changedFeed(feed, { storyboardRevision: source.director.shotRelations.storyboardRevision.revisionVersion })
    const port = makePort(wrong)
    render(<ShotFindingView {...props(port, source)} />)
    expect(await screen.findByText(zh.findingLoadError)).toBeTruthy()
    expect(port.shotFindingMethod).not.toHaveBeenCalled()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it.each([
    ['findingTimecode', ''], ['findingObservation', ' '], ['findingEvidenceRefs', 'first\n\nsecond'],
    ['findingEvidenceRefs', Array.from({ length: 33 }, () => 'ref').join('\n')],
    ['findingOwnerReason', ''], ['findingSuggestion', ''], ['findingReworkScope', ''],
  ] as const)('does not POST an incomplete or malformed %s', async (key, value) => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.change(screen.getByRole('textbox', { name: zh[key] }), { target: { value } })
    const button = screen.getByRole('button', { name: zh.findingRecord })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['\u0085', '\u001c'])('rejects Python whitespace-only observation %j before marker creation', async (value) => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.change(screen.getByRole('textbox', { name: zh.findingObservation }), { target: { value } })
    const button = screen.getByRole('button', { name: zh.findingRecord })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    await act(async () => {})
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('preserves FEFF as valid author text under the Python contract', async () => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.change(screen.getByRole('textbox', { name: zh.findingObservation }), { target: { value: '\ufeff' } })
    const button = screen.getByRole('button', { name: zh.findingRecord })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    await waitFor(() => { expect(port.recordShotFinding).toHaveBeenCalledOnce() })
    expect(port.recordShotFinding.mock.calls[0]?.[0].finding.observation).toBe('\ufeff')
    expect(await screen.findByText(zh.findingStored)).toBeTruthy()
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps no-write permission distinct from unavailable current media', async () => {
    const base = shotFindingFeed()
    const old = shotFindingResult().finding
    const feed: YimengShotFindingFeedResponse = { ...base, subject: null, snapshotSha256: null,
      availability: { status: 'unavailable', reason: 'selected_video_unavailable' },
      capabilities: { canRecordFinding: true }, items: [{ ...old, currentBinding: false }] }
    const port = makePort(feed)
    render(<ShotFindingView {...props(port)} />)
    expect(await screen.findByText(zh.findingNoSubject)).toBeTruthy()
    expect(screen.queryByText(zh.findingPermission)).toBeNull()
    expect(screen.getByText(zh.findingHistorical)).toBeTruthy()
    expect(port.shotFindingMethod).not.toHaveBeenCalled()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('disables authoring for read-only actors without concealing verified history', async () => {
    const feed = shotFindingFeed()
    const port = makePort({ ...feed, capabilities: { canRecordFinding: false },
      items: [{ ...shotFindingResult().finding, currentBinding: true }] })
    render(<ShotFindingView {...props(port)} />)
    expect(await screen.findByText(zh.findingPermission)).toBeTruthy()
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(screen.getByRole('group', { name: zh.findingFormTitle }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('list', { name: zh.findingHistory }).textContent).toContain(shotFindingAuthorInput().observation)
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecord }))
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('does not turn Enter submission or evidence text into network or media actions', async () => {
    const port = makePort()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<ShotFindingView {...props(port)} />)
    await fill()
    const form = container.querySelector('form')
    if (form === null) throw new Error('Missing form')
    fireEvent.submit(form)
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
    expect(container.querySelector('video, audio, img, iframe, a[href]')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses POST when durable local marker storage fails', async () => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await fill()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage quota') })
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecord }))
    expect(await screen.findByText(zh.findingStorageFailed)).toBeTruthy()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it('keeps a lost POST marker across remount and never retries automatically', async () => {
    const port = makePort()
    port.recordShotFinding.mockRejectedValue(new Error('Response lost after commit'))
    const mounted = render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecord }))
    expect(await screen.findByText(zh.findingUncertain)).toBeTruthy()
    const marker = readShotFindingMarker(shotFindingFeed())
    expect(marker.status).toBe('ready')
    mounted.unmount()
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(readShotFindingMarker(shotFindingFeed())).toEqual(marker)
    expect(screen.getByRole('button', { name: zh.findingRecord }).hasAttribute('disabled')).toBe(true)
    expect(port.recordShotFinding).toHaveBeenCalledOnce()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it('does not accept a receipt for altered author text', async () => {
    const port = makePort()
    port.recordShotFinding.mockResolvedValue(shotFindingResult(shotFindingMethod(), { ...shotFindingAuthorInput(), observation: 'another problem' }))
    render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecord }))
    expect(await screen.findByText(zh.findingUncertain)).toBeTruthy()
    expect(readShotFindingMarker(shotFindingFeed()).status).toBe('ready')
    expect(screen.queryByText(zh.findingStored)).toBeNull()
    expect(port.shotFindings).toHaveBeenCalledOnce()
  })
})

describe('Finding read-only rework preparation', () => {
  const title = '返修准备 · 非正式路由'

  async function openPreparation() {
    fireEvent.click(await screen.findByText(zh.findingRecordDetails))
    return screen.getByRole('region', { name: title })
  }

  it.each([true, false])('shows exact unit scope evidence with current=%s without granting production authority', async (currentBinding) => {
    const item = { ...shotFindingResult().finding, currentBinding: true }
    const port = makePort({ ...shotFindingFeed(), items: [item] })
    render(<ShotFindingView {...props(port)} productionUnits={unitEvidence({}, currentBinding)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const preparation = await openPreparation()
    expect(within(preparation).getByText('LSU17')).toBeTruthy()
    expect(within(preparation).getByText(currentBinding ? zh.findingUnitCurrent : zh.findingUnitHistorical, { exact: false })).toBeTruthy()
    expect(within(preparation).getByText(zh.findingUnitBoundary)).toBeTruthy()
    expect(within(preparation).getAllByText(zh.findingReworkNotProvided)).toHaveLength(4)
    expect(within(preparation).getByText(zh.findingReworkRouteUnavailable)).toBeTruthy()
    expect(preparation.querySelector('button, input, select, textarea')).toBeNull()
    expect(port.shotFindings).toHaveBeenCalledOnce()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it.each(['frameId', 'frameNo', 'frameContentSha256', 'storyboardRevision'] as const)(
    'does not promote a unit binding with mismatched %s to Finding evidence', async (field) => {
      const subject = shotFindingResult().finding.subject
      const shot = { frameId: subject.frameId, frameNo: subject.frameNo, frameContentSha256: subject.frameContentSha256 }
      const changes: Partial<YimengProductionUnitSource> = field === 'storyboardRevision'
        ? { storyboardRevision: subject.storyboardRevision + 1 }
        : { shots: [{ ...shot, [field]: field === 'frameNo' ? subject.frameNo + 1
          : field === 'frameId' ? 'another-canonical-frame' : 'f'.repeat(64) }] }
      const port = makePort({ ...shotFindingFeed(), items: [{ ...shotFindingResult().finding, currentBinding: true }] })
      render(<ShotFindingView {...props(port)} productionUnits={unitEvidence(changes)} />)
      const preparation = await openPreparation()
      expect(within(preparation).getByText(zh.findingUnitMissing)).toBeTruthy()
      expect(within(preparation).queryByText('LSU17')).toBeNull()
    },
  )

  it.each(['projectId', 'episodeId'] as const)('rejects %s from another unit-feed scope', async (field) => {
    const port = makePort({ ...shotFindingFeed(), items: [{ ...shotFindingResult().finding, currentBinding: true }] })
    render(<ShotFindingView {...props(port)} productionUnits={unitEvidence({ [field]: 'other-scope' })} />)
    const preparation = await openPreparation()
    expect(within(preparation).getByText(zh.findingUnitUnavailable)).toBeTruthy()
    expect(within(preparation).queryByText('LSU17')).toBeNull()
  })

  it('removes previous unit evidence when its current read is invalidated, without extra Finding requests', async () => {
    const port = makePort({ ...shotFindingFeed(), items: [{ ...shotFindingResult().finding, currentBinding: true }] })
    const input = props(port)
    const view = render(<ShotFindingView {...input} productionUnits={unitEvidence()} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const preparation = await openPreparation()
    expect(within(preparation).getByText('LSU17')).toBeTruthy()
    view.rerender(<ShotFindingView {...input} />)
    expect(within(preparation).queryByText('LSU17')).toBeNull()
    expect(within(preparation).getByText(zh.findingUnitUnavailable)).toBeTruthy()
    expect(port.shotFindings).toHaveBeenCalledOnce()
    expect(port.shotFindingMethod).toHaveBeenCalledOnce()
  })

  it('shows the current binding without changing author text, duplicate evidence, hashes, requests, or markers', async () => {
    const author = { ...shotFindingAuthorInput(), timecode: '\uFEFF00:00.000–00:01.250',
      observation: '\uFEFF 原观察。\n 第二行\uFEFF', ownerReason: '\uFEFF原归因\n不改写',
      suggestion: '\uFEFF原建议\n不执行', reworkScope: '\uFEFF原返修范围\n不扩展',
      evidenceRefs: ['\uFEFFasset://video-a#t=0,1.25', '\uFEFFasset://video-a#t=0,1.25'] }
    const item = { ...shotFindingResult(shotFindingMethod(), author).finding, currentBinding: true }
    const port = makePort({ ...shotFindingFeed(), capabilities: { canRecordFinding: false }, items: [item] })
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const buttons = screen.getAllByRole('button').length
    const preparation = await openPreparation()
    expect(within(preparation).getByRole('heading', { name: title, level: 5 })).toBeTruthy()
    expect(within(preparation).getByText('原记录与当前选中素材一致')).toBeTruthy()
    expect(within(preparation).getByText(`${zh.findingOwnerVideo} · 按制作单元`)).toBeTruthy()
    expect(within(preparation).getByText('与记录时一致')).toBeTruthy()
    const history = screen.getByRole('list', { name: zh.findingHistory })
    expect(history.querySelector('p')?.textContent).toBe(`${author.timecode} · ${zh.findingSeverityMajor}`)
    expect(within(history).getByText((_, node) => node?.tagName === 'P' && node.textContent === author.observation)).toBeTruthy()
    for (const [label, value] of [
      [zh.findingOwnerCode, author.earliestOwner], [zh.findingOwnerReason, author.ownerReason],
      [zh.findingSuggestion, author.suggestion], [zh.findingReworkScope, author.reworkScope],
      [zh.findingSession, item.authSessionId], [zh.findingAssetSha, item.subject.assetSha256],
      [zh.findingSnapshotSha, item.subjectSnapshotSha256], [zh.findingMethodSha, item.methodProjectionSha256],
      [zh.findingRulesSha, item.rulesSha256],
    ] as const) expect(within(history).getByText(label).nextElementSibling?.textContent).toBe(value)
    const references = within(history).getByText(zh.findingEvidenceRefs).nextElementSibling
    expect(Array.from(references?.querySelectorAll('li') ?? [], node => node.textContent)).toEqual(author.evidenceRefs)
    expect(preparation.querySelector('button, a, input, select, textarea, video, audio, img')).toBeNull()
    fireEvent.click(screen.getByText(zh.findingRecordDetails))
    fireEvent.click(screen.getByText(zh.findingRecordDetails))
    expect(screen.getAllByRole('button')).toHaveLength(buttons)
    expect(port.shotFindings).toHaveBeenCalledOnce()
    expect(port.shotFindingMethod).toHaveBeenCalledOnce()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['historical', 'unavailable'] as const)('distinguishes %s media from a current binding while retaining the sealed record', async (kind) => {
    const original = shotFindingFeed()
    const item = { ...shotFindingResult().finding, currentBinding: false }
    const feed: YimengShotFindingFeedResponse = kind === 'historical'
      ? { ...changedFeed(original, { assetId: 'video-new', assetSha256: 'e'.repeat(64) }), items: [item] }
      : { ...original, subject: null, snapshotSha256: null, availability: { status: 'unavailable', reason: 'selected_video_missing' }, items: [item] }
    const port = makePort(feed)
    render(<ShotFindingView {...props(port)} />)
    if (kind === 'historical') await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    else await screen.findByText(zh.findingNoSubject)
    const preparation = await openPreparation()
    expect(within(preparation).getByText(kind === 'historical' ? '历史记录，不作为当前素材依据' : '当前素材不可核验')).toBeTruthy()
    expect(within(preparation).queryByText('原记录与当前选中素材一致')).toBeNull()
    const history = screen.getByRole('list', { name: zh.findingHistory })
    expect(within(history).getByText(zh.findingSnapshotSha).nextElementSibling?.textContent).toBe(item.subjectSnapshotSha256)
    expect(within(history).getByText(zh.findingRulesSha).nextElementSibling?.textContent).toBe(item.rulesSha256)
    if (kind === 'unavailable') {
      expect(within(preparation).getByText('当前规则不可核验')).toBeTruthy()
      expect(port.shotFindingMethod).not.toHaveBeenCalled()
    }
  })

  it.each(['C5F', 'C5'] as const)('uses only an exact current stage match for original Owner %s', async (earliestOwner) => {
    const item = { ...shotFindingResult().finding, earliestOwner, currentBinding: true }
    const port = makePort({ ...shotFindingFeed(), items: [item] })
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const preparation = await openPreparation()
    expect(screen.getByText(zh.findingOwnerCode).nextElementSibling?.textContent).toBe(earliestOwner)
    if (earliestOwner === 'C5F') {
      expect(within(preparation).getByText(`${zh.findingOwnerStoryboard} · 全局岗位`)).toBeTruthy()
    } else {
      expect(within(preparation).getByText('当前方法未提供匹配岗位，保留原归因')).toBeTruthy()
      expect(within(preparation).queryByText(`${zh.findingOwnerStoryboard} · 全局岗位`)).toBeNull()
      expect(within(preparation).queryByText(`${zh.findingOwnerVideo} · 按制作单元`)).toBeNull()
    }
  })

  it('compares current rules with the original SHA without overwriting the historical method evidence', async () => {
    const item = { ...shotFindingResult().finding, rulesSha256: 'e'.repeat(64), methodProjectionSha256: 'f'.repeat(64), currentBinding: true }
    const port = makePort({ ...shotFindingFeed(), items: [item] })
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const preparation = await openPreparation()
    expect(within(preparation).getByText('与记录时不同，原记录保持不变')).toBeTruthy()
    expect(within(preparation).getByText('当前方法规则 SHA').nextElementSibling?.textContent).toBe(shotFindingMethod().projection.rulesSha256)
    expect(screen.getByText(zh.findingRulesSha).nextElementSibling?.textContent).toBe(item.rulesSha256)
    expect(screen.getByText(zh.findingMethodSha).nextElementSibling?.textContent).toBe(item.methodProjectionSha256)
  })

  it('keeps the record but does not guess a known role or current rules when the method is unavailable', async () => {
    const item = { ...shotFindingResult().finding, currentBinding: true }
    const port = makePort({ ...shotFindingFeed(), items: [item] })
    port.shotFindingMethod.mockRejectedValue(new Error('method unavailable'))
    render(<ShotFindingView {...props(port)} />)
    await screen.findByText(zh.findingMethodUnavailable)
    const preparation = await openPreparation()
    expect(within(preparation).getByText('当前方法未提供匹配岗位，保留原归因')).toBeTruthy()
    expect(within(preparation).getByText('当前规则不可核验')).toBeTruthy()
    expect(within(preparation).queryByText(/视频生产|按制作单元|当前方法规则 SHA/)).toBeNull()
    expect(screen.getByText(zh.findingRulesSha).nextElementSibling?.textContent).toBe(item.rulesSha256)
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('does not promote ordinary completion, quality, source-lock or editing-TTL facts into routing authority', async () => {
    const source = { ...shotFindingSource(), status: 'complete', qualityPassed: true,
      stages: { video: { status: 'complete', hasData: true, isStale: false, qualityPassed: true, selected: true, canProceed: true } },
      legacy: { sourceLock: 'source-lock:source-only', editingLock: { owner: 'editor', ttl: 300 } } }
    const feed = shotFindingFeed(source)
    const item = { ...shotFindingResult(shotFindingMethod(feed)).finding, earliestOwner: 'C5F', currentBinding: true }
    const port = makePort({ ...feed, items: [item] })
    render(<ShotFindingView {...props(port, source)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const preparation = await openPreparation()
    for (const label of ['阶段实例', '已封存计划中的单元实例', '批准锁实例', '独立正式决定']) {
      expect(within(preparation).getByText(label).nextElementSibling?.textContent).toBe('当前读合同未提供')
    }
    expect(within(preparation).getAllByText('当前读合同未提供')).toHaveLength(4)
    expect(within(preparation).getByText('未知，不能按责任岗位推断')).toBeTruthy()
    expect(within(preparation).getByText('当前视图无正式路由证据；本视图不提供执行')).toBeTruthy()
    expect(within(preparation).getByText('以上仅说明证据提供情况，不表示系统不存在；单元实例不作为全局岗位的额外要求。')).toBeTruthy()
    expect(preparation.querySelector('button, a, input, select, textarea')).toBeNull()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it.each(['source', 'port', 'refresh', 'shot', 'disable'] as const)('hides the previous preparation immediately after %s changes', async (change) => {
    const source = shotFindingSource()
    const feed = shotFindingFeed(source)
    const item = { ...shotFindingResult().finding, currentBinding: true }
    const port = makePort({ ...feed, items: [item] })
    const mounted = render(<ShotFindingView {...props(port, source)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(within(await openPreparation()).getByText(`${zh.findingOwnerVideo} · 按制作单元`)).toBeTruthy()
    const originalSignal = port.shotFindings.mock.calls[0]?.[1]
    const response = pending<YimengShotFindingFeedResponse>()
    const nextFrameId = change === 'shot' ? 'frame-z' : feed.frameId
    const nextFeed = shotFindingFeed(source, nextFrameId)
    const nextMethod = shotFindingMethod(nextFeed)
    const nextItem = { ...shotFindingResult(nextMethod, { ...shotFindingAuthorInput(), earliestOwner: 'C5F', observation: '新来源记录' }).finding, currentBinding: true }
    const nextPort = change === 'port' ? makePort(nextFeed) : port
    nextPort.shotFindings.mockReturnValue(response.promise)
    nextPort.shotFindingMethod.mockResolvedValue(nextMethod)
    if (change === 'refresh') fireEvent.click(screen.getByRole('button', { name: zh.findingRefresh }))
    else mounted.rerender(<ShotFindingView {...props(nextPort, change === 'source' ? { ...source } : source, nextFrameId)} enabled={change !== 'disable'} />)
    expect(originalSignal?.aborted).toBe(true)
    expect(screen.queryByRole('region', { name: title })).toBeNull()
    if (change !== 'disable') {
      await act(async () => { response.resolve({ ...nextFeed, items: [nextItem] }) })
      await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
      const preparation = await openPreparation()
      expect(within(preparation).getByText(`${zh.findingOwnerStoryboard} · 全局岗位`)).toBeTruthy()
      expect(within(preparation).queryByText(`${zh.findingOwnerVideo} · 按制作单元`)).toBeNull()
    }
    expect(nextPort.recordShotFinding).not.toHaveBeenCalled()
    expect(nextPort.recoverShotFinding).not.toHaveBeenCalled()
  })
})

describe('Finding original-receipt recovery', () => {
  it('uses GET coordinates only and keeps not_found without any repost', async () => {
    const { marker } = await savedIntent()
    const port = makePort()
    port.recoverShotFinding.mockResolvedValue(recovery(marker, null))
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecover }))
    expect(await screen.findByText(zh.findingNotFound)).toBeTruthy()
    expect(port.recoverShotFinding).toHaveBeenCalledExactlyOnceWith({
      projectId: marker.projectId, episodeId: marker.episodeId, frameId: marker.frameId,
      expectedSubjectSha256: marker.expectedSubjectSha256, idempotencyKey: marker.idempotencyKey,
    }, expect.any(AbortSignal))
    expect(readShotFindingMarker(marker)).toEqual({ status: 'ready', marker })
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it.each(['changed', 'unavailable', 'no-permission', 'feed-error'] as const)(
    'recovers the original subject after %s even with method plugin unavailable', async (situation) => {
      const original = shotFindingFeed()
      const { marker, result } = await savedIntent(original)
      let feed: YimengShotFindingFeedResponse = changedFeed(original, { assetId: 'new-video', assetSha256: 'c'.repeat(64) })
      if (situation === 'unavailable') feed = { ...feed, subject: null, snapshotSha256: null,
        availability: { status: 'unavailable', reason: 'selected_video_unavailable' } }
      if (situation === 'no-permission') feed = { ...feed, capabilities: { canRecordFinding: false } }
      const port = makePort(feed)
      port.shotFindingMethod.mockRejectedValue(new Error('method unplugged'))
      if (situation === 'feed-error') port.shotFindings.mockRejectedValue(new Error('source not reachable'))
      port.recoverShotFinding.mockResolvedValue(recovery(marker, result))
      render(<ShotFindingView {...props(port)} />)
      await screen.findByText(situation === 'feed-error' ? zh.findingLoadError : zh.findingMethodUnavailable)
      fireEvent.click(screen.getByRole('button', { name: zh.findingRecover }))
      expect(await screen.findByText(zh.findingStored)).toBeTruthy()
      expect(readShotFindingMarker(marker).status).toBe('none')
      expect(port.recoverShotFinding.mock.calls[0]?.[0].expectedSubjectSha256).toBe(marker.expectedSubjectSha256)
      expect(port.recordShotFinding).not.toHaveBeenCalled()
    },
  )

  it.each(['wrong-scope', 'wrong-intent', 'wrong-text', 'execution', 'network'] as const)(
    'retains the marker after invalid recovery: %s', async (scenario) => {
      const { marker, result } = await savedIntent()
      const port = makePort()
      let reply = recovery(marker, result)
      if (scenario === 'wrong-scope') reply = { ...reply, frameId: 'another-shot' }
      if (scenario === 'wrong-intent') reply = { ...reply, idempotencyKey: 'other-command' }
      if (scenario === 'wrong-text') reply = { ...reply, result: { ...result, finding: { ...result.finding, observation: 'changed' } } }
      if (scenario === 'execution') reply = { ...reply, result: { ...result, reworkExecuted: true } } as unknown as YimengShotFindingRecovery
      port.recoverShotFinding.mockResolvedValue(reply)
      if (scenario === 'network') port.recoverShotFinding.mockRejectedValue(new Error('offline'))
      render(<ShotFindingView {...props(port)} />)
      await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
      fireEvent.click(screen.getByRole('button', { name: zh.findingRecover }))
      expect(await screen.findByText(zh.findingRecoveryError)).toBeTruthy()
      expect(readShotFindingMarker(marker)).toEqual({ status: 'ready', marker })
      expect(screen.queryByText(zh.findingStored)).toBeNull()
      expect(port.recordShotFinding).not.toHaveBeenCalled()
    },
  )

  it('CAS prevents a late original receipt from clearing a different intent', async () => {
    const { marker, result } = await savedIntent()
    const response = pending<YimengShotFindingRecovery>()
    const port = makePort()
    port.recoverShotFinding.mockReturnValue(response.promise)
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecover }))
    const newer = { ...marker, idempotencyKey: 'different-intent-key', findingSha256: 'd'.repeat(64) }
    sessionStorage.setItem(storageKey(marker), JSON.stringify(newer))
    await act(async () => { response.resolve(recovery(marker, result)) })
    expect(await screen.findByText(zh.findingMarkerChanged)).toBeTruthy()
    expect(readShotFindingMarker(marker)).toEqual({ status: 'ready', marker: newer })
    expect(screen.queryByText(zh.findingStored)).toBeNull()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('explains and explicitly discards only the local marker without a network command', async () => {
    const { marker } = await savedIntent()
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const explanation = screen.getByText(zh.findingDiscardHelp)
    const detail = explanation.closest('details')
    if (detail === null) throw new Error('Missing explicit discard explanation')
    detail.open = true
    fireEvent.click(screen.getByRole('button', { name: zh.findingDiscard }))
    expect(await screen.findByText(zh.findingDiscarded)).toBeTruthy()
    expect(readShotFindingMarker(marker).status).toBe('none')
    expect(port.recordShotFinding).not.toHaveBeenCalled()
    expect(port.recoverShotFinding).not.toHaveBeenCalled()
  })

  it('does not clear a newer intent through a stale local-discard view', async () => {
    const { marker } = await savedIntent()
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const newer = { ...marker, idempotencyKey: 'different-intent-key' }
    sessionStorage.setItem(storageKey(marker), JSON.stringify(newer))
    const detail = screen.getByText(zh.findingDiscardHelp).closest('details')
    if (detail === null) throw new Error('Missing discard details')
    detail.open = true
    fireEvent.click(screen.getByRole('button', { name: zh.findingDiscard }))
    expect(await screen.findByText(zh.findingMarkerChanged)).toBeTruthy()
    expect(readShotFindingMarker(marker)).toEqual({ status: 'ready', marker: newer })
  })
})

describe('Finding Shot identity and lifecycle', () => {
  it.each(['disabled', 'no-projection', 'unknown-shot', 'wrong-project', 'wrong-episode'] as const)(
    'sends no request for %s', async (situation) => {
      const port = makePort()
      const base = props(port)
      render(<ShotFindingView {...base}
        enabled={situation !== 'disabled'} projection={situation === 'no-projection' ? undefined : base.projection}
        selectedShotId={situation === 'unknown-shot' ? 'missing-shot' : base.selectedShotId}
        projectId={situation === 'wrong-project' ? 'another-project' : base.projectId}
        episodeId={situation === 'wrong-episode' ? 'another-episode' : base.episodeId} />)
      await act(async () => {})
      expect(port.shotFindings).not.toHaveBeenCalled()
      expect(port.shotFindingMethod).not.toHaveBeenCalled()
      expect(port.recordShotFinding).not.toHaveBeenCalled()
      expect(port.recoverShotFinding).not.toHaveBeenCalled()
    },
  )

  it('preserves the draft after a fresh read of exactly the same subject', async () => {
    const port = makePort()
    render(<ShotFindingView {...props(port)} />)
    const original = await fill()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRefresh }))
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(port.shotFindings).toHaveBeenCalledTimes(2)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.findingObservation }).value).toBe(original.observation)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.findingEarliestOwner }).value).toBe('F')
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it.each(['assetId', 'assetSha256', 'frameContentSha256'] as const)('clears every draft field on %s drift', async (key) => {
    const feed = shotFindingFeed()
    const changed = changedFeed(feed, { [key]: key === 'assetId' ? 'replacement-video' : 'd'.repeat(64) })
    const port = makePort(feed)
    port.shotFindings.mockResolvedValueOnce(feed).mockResolvedValue(changed)
    port.shotFindingMethod.mockResolvedValueOnce(shotFindingMethod(feed)).mockResolvedValue(shotFindingMethod(changed))
    render(<ShotFindingView {...props(port)} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: zh.findingRefresh }))
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    for (const input of screen.getAllByRole('textbox')) expect((input as HTMLInputElement).value).toBe('')
    for (const select of screen.getAllByRole('combobox')) expect((select as HTMLSelectElement).value).toBe('')
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('clears the draft on a new episode revision even with the same projection fingerprint', async () => {
    const source = shotFindingSource()
    const feed = shotFindingFeed(source)
    const port = makePort(feed)
    const mounted = render(<ShotFindingView {...props(port, source)} />)
    await fill()
    const relations = source.director.shotRelations
    const next = { ...source, director: { ...source.director, shotRelations: { ...relations,
      storyboardRevision: { ...relations.storyboardRevision, episodeRevision: relations.storyboardRevision.episodeRevision + 1 } } } }
    const nextFeed = shotFindingFeed(next)
    port.shotFindings.mockResolvedValue(nextFeed)
    port.shotFindingMethod.mockResolvedValue(shotFindingMethod(nextFeed))
    mounted.rerender(<ShotFindingView {...props(port, next)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.findingObservation }).value).toBe('')
    expect(port.shotFindings).toHaveBeenCalledTimes(2)
  })

  it('does not carry a draft between canonical Shots or resurrect it when returning', async () => {
    const source = shotFindingSource()
    const other = source.director.shotRelations.shots.find(shot => shot.shotId !== 'frame-a')
    if (other === undefined) throw new Error('Second Shot is required')
    const port = makePort()
    port.shotFindings.mockImplementation(async request => shotFindingFeed(source, request.frameId))
    port.shotFindingMethod.mockImplementation(async request => shotFindingMethod(shotFindingFeed(source, request.frameId)))
    const mounted = render(<ShotFindingView {...props(port, source)} />)
    await fill()
    mounted.rerender(<ShotFindingView {...props(port, source, other.shotId)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.findingObservation }).value).toBe('')
    mounted.rerender(<ShotFindingView {...props(port, source)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.findingObservation }).value).toBe('')
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('aborts a superseded projection read and ignores its late error', async () => {
    const source = shotFindingSource()
    const old = pending<YimengShotFindingFeedResponse>()
    const port = makePort()
    port.shotFindings.mockReturnValueOnce(old.promise)
    const mounted = render(<ShotFindingView {...props(port, source)} />)
    const signal = port.shotFindings.mock.calls[0]?.[1]
    mounted.rerender(<ShotFindingView {...props(port, { ...source })} />)
    expect(signal?.aborted).toBe(true)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    await act(async () => { old.reject(new Error('old response')) })
    expect(screen.queryByText(zh.findingLoadError)).toBeNull()
    expect(port.shotFindings).toHaveBeenCalledTimes(2)
    expect(port.shotFindingMethod).toHaveBeenCalledOnce()
  })

  it('ignores a late method result after a port replacement', async () => {
    const source = shotFindingSource()
    const oldMethod = pending<ImagoShotFindingMethodResponse>()
    const oldPort = makePort()
    oldPort.shotFindingMethod.mockReturnValue(oldMethod.promise)
    const mounted = render(<ShotFindingView {...props(oldPort, source)} />)
    await waitFor(() => { expect(oldPort.shotFindingMethod).toHaveBeenCalledOnce() })
    const newPort = makePort()
    newPort.shotFindingMethod.mockRejectedValue(new Error('unplugged'))
    mounted.rerender(<ShotFindingView {...props(newPort, source)} />)
    expect(oldPort.shotFindingMethod.mock.calls[0]?.[1]?.aborted).toBe(true)
    await screen.findByText(zh.findingMethodUnavailable)
    await act(async () => { oldMethod.resolve(shotFindingMethod()) })
    expect(screen.queryByRole('combobox', { name: zh.findingEarliestOwner })).toBeNull()
    expect(newPort.recordShotFinding).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'unmount', 'shot', 'projection', 'port'] as const)(
    'aborts a pending POST on %s and leaves its original marker intact', async (situation) => {
      const source = shotFindingSource()
      const port = makePort()
      const reply = pending<YimengShotFindingResult>()
      port.recordShotFinding.mockReturnValue(reply.promise)
      const mounted = render(<ShotFindingView {...props(port, source)} />)
      await fill()
      fireEvent.click(screen.getByRole('button', { name: zh.findingRecord }))
      await waitFor(() => { expect(port.recordShotFinding).toHaveBeenCalledOnce() })
      const originalMarker = readShotFindingMarker(shotFindingFeed())
      const signal = port.recordShotFinding.mock.calls[0]?.[1]
      if (situation === 'unmount') mounted.unmount()
      else if (situation === 'disabled') mounted.rerender(<ShotFindingView {...props(port, source)} enabled={false} />)
      else if (situation === 'projection') mounted.rerender(<ShotFindingView {...props(port, { ...source })} />)
      else if (situation === 'port') mounted.rerender(<ShotFindingView {...props(makePort(), source)} />)
      else {
        const other = source.director.shotRelations.shots.find(shot => shot.shotId !== 'frame-a')
        if (other === undefined) throw new Error('Second Shot is required')
        mounted.rerender(<ShotFindingView {...props(port, source, other.shotId)} />)
      }
      expect(signal?.aborted).toBe(true)
      await act(async () => { reply.resolve(shotFindingResult()) })
      expect(readShotFindingMarker(shotFindingFeed())).toEqual(originalMarker)
      expect(screen.queryByText(zh.findingStored)).toBeNull()
      expect(port.recordShotFinding).toHaveBeenCalledOnce()
      expect(port.recoverShotFinding).not.toHaveBeenCalled()
    },
  )

  it('aborts recovery on disable and ignores a late committed receipt', async () => {
    const { marker, result } = await savedIntent()
    const source = shotFindingSource()
    const port = makePort()
    const response = pending<YimengShotFindingRecovery>()
    port.recoverShotFinding.mockReturnValue(response.promise)
    const mounted = render(<ShotFindingView {...props(port, source)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    fireEvent.click(screen.getByRole('button', { name: zh.findingRecover }))
    mounted.rerender(<ShotFindingView {...props(port, source)} enabled={false} />)
    expect(port.recoverShotFinding.mock.calls[0]?.[1]?.aborted).toBe(true)
    await act(async () => { response.resolve(recovery(marker, result)) })
    expect(readShotFindingMarker(marker)).toEqual({ status: 'ready', marker })
    expect(screen.queryByText(zh.findingStored)).toBeNull()
    expect(port.recordShotFinding).not.toHaveBeenCalled()
  })

  it('labels historical Owner by its current role mapping and preserves the original code as technical evidence', async () => {
    const feed = shotFindingFeed()
    const item = { ...shotFindingResult().finding, earliestOwner: 'C5F', currentBinding: true }
    const port = makePort({ ...feed, items: [item] })
    render(<ShotFindingView {...props(port)} />)
    await screen.findByRole('combobox', { name: zh.findingEarliestOwner })
    const list = screen.getByRole('list', { name: zh.findingHistory })
    const label = within(list).getByText(zh.findingEarliestOwner)
    expect(label.nextElementSibling?.textContent).toBe(zh.findingOwnerStoryboard)
    expect(within(list).getByText(zh.findingOwnerCode).nextElementSibling?.textContent).toBe('C5F')
  })

  it('does not invent a missing historical Owner label when the method plugin is unavailable', async () => {
    const feed = shotFindingFeed()
    const item = { ...shotFindingResult().finding, earliestOwner: 'C5F', currentBinding: true }
    const port = makePort({ ...feed, items: [item] })
    port.shotFindingMethod.mockRejectedValue(new Error('unplugged'))
    render(<ShotFindingView {...props(port)} />)
    screen.getByRole('region', { name: zh.findingTitle })
    await screen.findByText(zh.findingMethodUnavailable)
    expect(screen.getByText(zh.findingOwnerUnavailable)).toBeTruthy()
    expect(screen.getByText(zh.findingOwnerCode).nextElementSibling?.textContent).toBe('C5F')
  })
})
