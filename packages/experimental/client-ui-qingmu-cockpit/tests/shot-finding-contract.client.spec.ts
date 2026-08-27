// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImagoShotFindingMethodResponse, YimengShotFindingResult } from '../src/client/contracts.ts'
import {
  SHOT_FINDING_FIELDS, digestShotFinding, shotFindingPayload, validShotFindingPayload,
  verifyShotFindingFeed, verifyShotFindingMethod, verifyShotFindingReceipt,
} from '../src/client/shot-finding-contract.ts'
import { clearShotFindingMarker, createShotFindingMarker, readShotFindingMarker, writeShotFindingMarker } from '../src/client/shot-finding-recovery.ts'
import { FINDING_REQUEST as scope, findingFeed, findingPayload, findingRecord, findingSha } from '../../qingmu-yimeng-read-adapter/tests/shot-finding-fixture.ts'

const visible = { frameNo: 7, storyboardRevision: 4 }
async function methodFixture(): Promise<ImagoShotFindingMethodResponse> {
  const feed = findingFeed()
  if (feed.subject === null || feed.snapshotSha256 === null) throw new Error('missing fixture subject')
  const ruleBindings = { 'pipeline/imago-os-current.json': '1'.repeat(64) }
  const projection: ImagoShotFindingMethodResponse['projection'] = {
    schema: 'qingmu.imago-shot-finding-method.v1', subject: feed.subject, subjectSnapshotSha256: feed.snapshotSha256,
    definition: { requiredFields: SHOT_FINDING_FIELDS, severities: ['BLOCKER', 'MAJOR', 'MINOR'],
      ownerOptions: [{ stageId: 'F', roleId: 'F', scope: 'per_lsu' }, { stageId: 'DIMG', roleId: 'DIMG', scope: 'global' }],
      statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false },
    ruleBindings, rulesSha256: await digestShotFinding(ruleBindings),
  }
  const projectionSha256 = await digestShotFinding(projection)
  return { schema: 'qingmu.imago-shot-finding-method-adapter-result.v1', projection, projectionSha256,
    methodAttestation: { schema: 'qingmu.imago-shot-finding-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: feed.snapshotSha256, methodProjectionSha256: projectionSha256, signature: 'a'.repeat(64) } }
}
async function receiptFixture() {
  const finding = findingRecord()
  const marker = await createShotFindingMarker({ ...scope, expectedSubjectSha256: finding.subjectSnapshotSha256,
    findingSha256: await digestShotFinding(shotFindingPayload(finding)), methodProjectionSha256: finding.methodProjectionSha256 })
  const result: YimengShotFindingResult = { schema: 'jason.qingmu-shot-finding-result.v1', finding,
    changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false }
  return { marker, result }
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Finding browser subject and intent contract', () => {
  it('uses Python code-point key order and preserves Unicode text, whitespace, and duplicate evidence', async () => {
    expect(await digestShotFinding({ '😀': 1, '\ue000': 2 })).toBe(createHash('sha256').update('{"\ue000":2,"😀":1}').digest('hex'))
    expect(await digestShotFinding(findingPayload())).toBe(findingSha(findingPayload()))
    expect(shotFindingPayload(findingRecord())).toEqual(findingPayload())
    expect(validShotFindingPayload(findingPayload(), ['F'])).toBe(true)
  })
  it.each([undefined, Number.NaN, 0.5, Number.MAX_SAFE_INTEGER + 1, '\ud800'])('rejects noncanonical digest input %s', async (value) => {
    await expect(digestShotFinding({ value })).rejects.toThrow()
  })
  it.each([
    ['timecode', ''], ['observation', ' '], ['evidenceRefs', []], ['evidenceRefs', ['']],
    ['evidenceRefs', Array.from({ length: 33 }, () => 'ref')], ['evidenceRefs', ['a'.repeat(1025)]],
    ['earliestOwner', 'G1'], ['ownerReason', '\u0000'], ['severity', ['MAJOR']], ['severity', 'INFO'],
    ['suggestion', ''], ['reworkScope', ''],
  ])('does not accept malformed %s', (field, value) => {
    const payload = { ...findingPayload(), [field]: value }
    expect(validShotFindingPayload(payload, ['F'])).toBe(false)
  })
  it.each(['\u0085', '\u001c'])('rejects Python-only whitespace before preparing a record: %j', (whitespace) => {
    for (const field of ['timecode', 'observation', 'ownerReason', 'suggestion', 'reworkScope'] as const) {
      expect(validShotFindingPayload({ ...findingPayload(), [field]: whitespace }, ['F'])).toBe(false)
    }
    expect(validShotFindingPayload({ ...findingPayload(), evidenceRefs: [whitespace] }, ['F'])).toBe(false)
  })
  it('preserves FEFF as non-whitespace under the Python text contract', () => {
    const payload = { ...findingPayload(), observation: '\ufeff' }
    expect(validShotFindingPayload(payload, ['F'])).toBe(true)
    expect(shotFindingPayload(payload).observation).toBe('\ufeff')
  })
  it.each(['\u0085asset', 'asset\u001c'])('rejects Python boundary whitespace in subject identifiers: %j', async (assetId) => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('missing fixture subject')
    const subject = { ...feed.subject, assetId }
    const changed = { ...feed, subject, snapshotSha256: await digestShotFinding(subject), items: [] }
    await expect(verifyShotFindingFeed(changed, scope, visible)).rejects.toThrow()
  })
  it('accepts FEFF in an otherwise bound identifier without trimming it', async () => {
    const feed = findingFeed()
    if (feed.subject === null) throw new Error('missing fixture subject')
    const subject = { ...feed.subject, assetId: '\ufeffasset' }
    const changed = { ...feed, subject, snapshotSha256: await digestShotFinding(subject), items: [] }
    await expect(verifyShotFindingFeed(changed, scope, visible)).resolves.toBeUndefined()
  })
  it('validates current and unavailable feeds without turning history into current evidence', async () => {
    const feed = findingFeed()
    await expect(verifyShotFindingFeed(feed, scope, visible)).resolves.toBeUndefined()
    await expect(verifyShotFindingFeed({ ...feed, subject: null, snapshotSha256: null,
      availability: { status: 'unavailable', reason: 'video_missing' }, items: feed.items.map(item => ({ ...item, currentBinding: false })) }, scope, visible)).resolves.toBeUndefined()
    await expect(verifyShotFindingFeed(feed, scope, { ...visible, storyboardRevision: 5 })).rejects.toThrow()
    await expect(verifyShotFindingFeed(feed, { ...scope, frameId: 'foreign' }, visible)).rejects.toThrow()
    await expect(verifyShotFindingFeed({ ...feed, items: [...feed.items, ...feed.items] }, scope, visible)).rejects.toThrow()
  })
  it.each([['frameNo', 0], ['frameNo', true], ['assetVersion', -1], ['storyboardRevision', false]])('rejects rehashed invalid %s', async (field, value) => {
    const feed = findingFeed()
    const subject = { ...feed.subject, [field]: value }
    const changed = { ...feed, subject, snapshotSha256: await digestShotFinding(subject), items: [] } as typeof feed
    await expect(verifyShotFindingFeed(changed, scope, visible)).rejects.toThrow()
  })
  it('accepts a matching method without pretending the browser can verify its HMAC', async () => {
    await expect(verifyShotFindingMethod(await methodFixture(), findingFeed())).resolves.toBeUndefined()
  })
  it.each(['approval', 'rework', 'fields', 'severity', 'owner', 'duplicate-owner', 'subject', 'rules', 'proof'] as const)(
    'rejects a rehashed but incompatible method: %s', async (kind) => {
      const method = await methodFixture()
      const value = JSON.parse(JSON.stringify(method)) as typeof method
      const projection = value.projection as Record<string, unknown>
      const definition = projection.definition as Record<string, unknown>
      if (kind === 'approval') definition.approvalAuthority = 'granted'
      if (kind === 'rework') definition.reworkExecutionAllowed = true
      if (kind === 'fields') definition.requiredFields = ['observation']
      if (kind === 'severity') definition.severities = ['MINOR']
      if (kind === 'owner') definition.ownerOptions = [{ stageId: 'G1', roleId: 'unknown', scope: 'global' }]
      if (kind === 'duplicate-owner') definition.ownerOptions = [method.projection.definition.ownerOptions[0], method.projection.definition.ownerOptions[0]]
      if (kind === 'subject') projection.subject = { ...method.projection.subject, assetId: 'other-video' }
      if (kind === 'rules') projection.rulesSha256 = 'f'.repeat(64)
      const projectionSha256 = await digestShotFinding(projection)
      const changed = { ...value, projectionSha256, methodAttestation: { ...value.methodAttestation,
        methodProjectionSha256: projectionSha256, signature: kind === 'proof' ? 'invalid' : value.methodAttestation.signature } }
      await expect(verifyShotFindingMethod(changed, findingFeed())).rejects.toThrow()
    },
  )
  it('validates the original receipt after session or current-selection changes without a current source', async () => {
    const { marker, result } = await receiptFixture()
    await expect(verifyShotFindingReceipt(result, marker)).resolves.toBeUndefined()
    await expect(verifyShotFindingReceipt({ ...result, finding: { ...result.finding, authSessionId: '9'.repeat(64) } }, marker)).resolves.toBeUndefined()
  })
  it.each(['changed', 'providerCalls', 'selectionChanged', 'humanSignoffInferred', 'reworkExecuted'] as const)('rejects receipt authority escalation %s', async (field) => {
    const { marker, result } = await receiptFixture()
    await expect(verifyShotFindingReceipt({ ...result, [field]: field === 'providerCalls' ? 1 : true }, marker)).rejects.toThrow()
  })
  it.each(['observation', 'methodProjectionSha256', 'subjectSnapshotSha256', 'status', 'actorRole'])('does not clear recovery for a substituted %s', async (field) => {
    const { marker, result } = await receiptFixture()
    const finding = { ...result.finding, [field]: 'substituted' }
    await expect(verifyShotFindingReceipt({ ...result, finding }, marker)).rejects.toThrow()
  })
})

describe('Finding non-secret per-tab recovery marker', () => {
  it.each(['short', 'x'.repeat(201)])('rejects an idempotency key outside the server contract', async (idempotencyKey) => {
    const { marker } = await receiptFixture()
    expect(writeShotFindingMarker({ ...marker, idempotencyKey })).toBe(false)
    expect(readShotFindingMarker(scope)).toEqual({ status: 'none' })
  })
  it('is deterministic, exact-scope, and contains no draft, token, proof, or media URL', async () => {
    const { marker } = await receiptFixture()
    expect((await receiptFixture()).marker).toEqual(marker)
    expect(writeShotFindingMarker(marker)).toBe(true)
    expect(readShotFindingMarker(scope)).toEqual({ status: 'ready', marker })
    expect(readShotFindingMarker({ ...scope, frameId: 'other-shot' })).toEqual({ status: 'none' })
    const stored = sessionStorage.getItem(sessionStorage.key(0) ?? '') ?? ''
    for (const secret of ['observation', 'ownerReason', 'evidenceRefs', 'asset://', 'Bearer', 'signature', 'actorId', 'authSessionId']) {
      expect(stored).not.toContain(secret)
    }
    const parsed: unknown = JSON.parse(stored)
    expect(parsed).toEqual(marker)
    expect(Object.keys(marker)).toHaveLength(8)
    expect(clearShotFindingMarker(scope, { status: 'ready', marker })).toBe(true)
    expect(readShotFindingMarker(scope)).toEqual({ status: 'none' })
  })
  it('does not overwrite an unresolved different intent or clear it with an old receipt', async () => {
    const { marker } = await receiptFixture()
    const other = { ...marker, idempotencyKey: 'another-key', findingSha256: '0'.repeat(64) }
    expect(writeShotFindingMarker(other)).toBe(true)
    expect(writeShotFindingMarker(marker)).toBe(false)
    expect(clearShotFindingMarker(scope, { status: 'ready', marker })).toBe(false)
    expect(readShotFindingMarker(scope)).toEqual({ status: 'ready', marker: other })
  })
  it('retains corrupt local evidence until a matching explicit local discard, never a POST', async () => {
    const { marker } = await receiptFixture()
    expect(writeShotFindingMarker(marker)).toBe(true)
    const key = sessionStorage.key(0) ?? ''
    sessionStorage.setItem(key, '{broken')
    const broken = readShotFindingMarker(scope)
    expect(broken.status).toBe('invalid')
    expect(writeShotFindingMarker(marker)).toBe(false)
    sessionStorage.setItem(key, '{changed')
    expect(clearShotFindingMarker(scope, broken)).toBe(false)
    expect(clearShotFindingMarker(scope, readShotFindingMarker(scope))).toBe(true)
  })
  it('fails closed when storage writes or reads are unavailable', async () => {
    const { marker } = await receiptFixture()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writeShotFindingMarker(marker)).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readShotFindingMarker(scope)).toEqual({ status: 'invalid', serialized: null })
    expect(clearShotFindingMarker(scope, { status: 'invalid', serialized: null })).toBe(false)
  })
})
