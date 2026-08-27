import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import type {
  YimengRecordShotFindingRequest,
  YimengRecoverShotFindingRequest,
  YimengShotFindingRecovery,
  YimengShotFindingResult,
} from '../src/types.ts'

// Controlled signatures exercise the Host validator, not a production Core approval.
const TEST_KEY = 'finding-method-test-key-'.repeat(2)
const TEST_TOKEN = 'finding-host-test-token'
const FIELDS = ['timecode', 'observation', 'evidenceRefs', 'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope']

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('fixture must be JSON')
  return encoded
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('fixture object missing')
  return value as Record<string, unknown>
}

function mutate(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let item = record(value)
  for (const key of keys.slice(0, -1)) item = record(item[key])
  const key = keys.at(-1)
  if (key === undefined) throw new Error('fixture path missing')
  if (replacement === undefined) Reflect.deleteProperty(item, key)
  else item[key] = replacement
}

function rebind(request: YimengRecordShotFindingRequest): void {
  const input = record(request)
  const method = record(input.methodProjection)
  input.expectedSubjectSha256 = sha(method.subject)
  method.subjectSnapshotSha256 = input.expectedSubjectSha256
  method.rulesSha256 = sha(method.ruleBindings)
  input.methodProjectionSha256 = sha(method)
  const unsigned = {
    schema: 'qingmu.imago-shot-finding-method-attestation.v1', algorithm: 'hmac-sha256',
    subjectSnapshotSha256: input.expectedSubjectSha256,
    methodProjectionSha256: input.methodProjectionSha256,
  }
  input.methodAttestation = {
    ...unsigned,
    signature: createHmac('sha256', TEST_KEY).update(canonical(unsigned), 'utf8').digest('hex'),
  }
}

function fixture(): YimengRecordShotFindingRequest {
  const request: YimengRecordShotFindingRequest = {
    projectId: 'project-e55', episodeId: 'episode-e55', frameId: 'frame-a',
    expectedSubjectSha256: '', idempotencyKey: 'finding-record-001',
    finding: {
      timecode: ' 00:00:00.000 ', observation: '  手部穿模\n需检查相邻帧  ',
      evidenceRefs: ['evidence/frame-000.png', 'evidence/frame-000.png'],
      earliestOwner: 'C5', ownerReason: '接触动作需导演确认', severity: 'MAJOR',
      suggestion: '复核接触动作', reworkScope: '该镜头接触段',
    },
    methodProjection: {
      schema: 'qingmu.imago-shot-finding-method.v1',
      subject: {
        schema: 'jason.qingmu-shot-video-subject.v1',
        projectId: 'project-e55', episodeId: 'episode-e55', frameId: 'frame-a',
        frameNo: 7, storyboardRevision: 3, frameContentSha256: 'a'.repeat(64),
        assetId: 'video-a', assetVersion: 0, assetSha256: 'b'.repeat(64),
      },
      subjectSnapshotSha256: '',
      definition: {
        requiredFields: FIELDS,
        severities: ['BLOCKER', 'MAJOR', 'MINOR'],
        ownerOptions: [{ stageId: 'C5', roleId: 'C5', scope: 'per_lsu' }],
        statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false,
      },
      ruleBindings: { 'pipeline/imago-os-current.json': 'c'.repeat(64), 'pipeline/v6-stage-contracts.json': 'd'.repeat(64) },
      rulesSha256: '',
    },
    methodProjectionSha256: '',
    methodAttestation: {
      schema: 'qingmu.imago-shot-finding-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: '', methodProjectionSha256: '', signature: '',
    },
  }
  rebind(request)
  return request
}

function result(request = fixture(), token = TEST_TOKEN): YimengShotFindingResult {
  return {
    schema: 'jason.qingmu-shot-finding-result.v1',
    finding: {
      ...structuredClone(request.finding),
      id: 'finding-001', eventId: 'event-001', subject: structuredClone(request.methodProjection.subject),
      subjectSnapshotSha256: request.expectedSubjectSha256,
      status: 'OPEN', actorId: 'reviewer-a', actorRole: 'reviewer',
      authSessionId: createHash('sha256').update(token, 'utf8').digest('hex'),
      createdAt: '2026-08-27T10:00:00.123456+00:00',
      methodProjectionSha256: request.methodProjectionSha256,
      rulesSha256: request.methodProjection.rulesSha256,
    },
    changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false,
  }
}

function recoveryRequest(request = fixture()): YimengRecoverShotFindingRequest {
  return {
    projectId: request.projectId, episodeId: request.episodeId, frameId: request.frameId,
    expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey,
  }
}

function recovery(request = fixture(), committed = true): YimengShotFindingRecovery {
  return {
    schema: 'jason.qingmu-shot-finding-recovery.v1', ...recoveryRequest(request),
    status: committed ? 'committed' : 'not_found', result: committed ? result(request) : null,
  }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function networkReturning(value: unknown, status = 200) {
  return vi.fn<typeof globalThis.fetch>(async () => response(value, status))
}

function handler(fetch: typeof globalThis.fetch, readToken = () => TEST_TOKEN) {
  return createYimengCommandHandler({}, { fetch, readToken })
}

function signal(): AbortSignal {
  return new AbortController().signal
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('selected-video Finding command transport', () => {
  it.each([201, 200])('records one exact POST on HTTP %s without rewriting author text', async (status) => {
    const request = fixture()
    const expected = result(request)
    const fetch = networkReturning(expected, status)
    expect(await handler(fetch)('recordShotFinding', request, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = fetch.mock.calls[0]
    if (call === undefined) throw new Error('POST missing')
    const [url, init] = call
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/project-e55/episodes/episode-e55/frames/frame-a/findings')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_TOKEN}`)
    expect(headers.has('Idempotency-Key')).toBe(false)
    const body = init?.body
    if (typeof body !== 'string') throw new Error('POST JSON string missing')
    expect(JSON.parse(body)).toEqual({
      expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey,
      finding: request.finding, methodProjection: request.methodProjection,
      methodProjectionSha256: request.methodProjectionSha256, methodAttestation: request.methodAttestation,
    })
    expect(body).not.toContain(TEST_TOKEN)
  })

  it.each([true, false])('recovers only by GET; committed=%s needs neither current method key nor session', async (committed) => {
    const request = fixture()
    const expected = recovery(request, committed)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', undefined)
    const fetch = networkReturning(expected)
    expect(await handler(fetch, () => 'replacement-host-token')('recoverShotFinding', recoveryRequest(request), signal()))
      .toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = fetch.mock.calls[0]
    if (call === undefined) throw new Error('GET missing')
    const [url, init] = call
    expect(url).toBe(`http://127.0.0.1:8115/api/qingmu/projects/project-e55/episodes/episode-e55/frames/frame-a/findings/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('accepts zero revision/version, code-point text limits and signed dynamic owner choices', async () => {
    const request = fixture()
    mutate(request, 'methodProjection.subject.storyboardRevision', 0)
    mutate(request, 'methodProjection.subject.assetVersion', 0)
    mutate(request, 'methodProjection.definition.ownerOptions.0.stageId', 'fixture-stage')
    mutate(request, 'finding.earliestOwner', 'fixture-stage')
    mutate(request, 'finding.observation', '梦'.repeat(8000))
    mutate(request, 'finding.suggestion', '🌳'.repeat(8000))
    mutate(request, 'finding.evidenceRefs', ['🌳'.repeat(1024), '🌳'.repeat(1024)])
    rebind(request)
    const expected = result(request)
    expect(await handler(networkReturning(expected))('recordShotFinding', request, signal())).toEqual({ ok: true, value: expected })
  })

  it.each(['projectId', 'episodeId', 'frameId'])('encodes %s only as a path segment', async (field) => {
    const request = fixture()
    mutate(request, field, '片/段 ?#')
    mutate(request, `methodProjection.subject.${field}`, '片/段 ?#')
    rebind(request)
    const fetch = networkReturning(result(request))
    expect(await handler(fetch)('recordShotFinding', request, signal())).toMatchObject({ ok: true })
    const url = fetch.mock.calls[0]?.[0]
    if (typeof url !== 'string') throw new Error('POST URL string missing')
    expect(url).toContain(encodeURIComponent('片/段 ?#'))
  })

  it('accepts the safe-integer upper boundary for all three numeric subject fields', async () => {
    const request = fixture()
    for (const field of ['frameNo', 'storyboardRevision', 'assetVersion']) {
      mutate(request, `methodProjection.subject.${field}`, Number.MAX_SAFE_INTEGER)
    }
    rebind(request)
    const expected = result(request)
    expect(await handler(networkReturning(expected))('recordShotFinding', request, signal())).toEqual({ ok: true, value: expected })
  })

  it.each([401, 403, 409, 422, 500, 503])('never retries a POST rejected with HTTP %s', async (status) => {
    const fetch = networkReturning({ detail: { code: 'shot_finding_rejected' } }, status)
    expect(await handler(fetch)('recordShotFinding', fixture(), signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never resubmits after a transport failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TEST_TOKEN) })
    const value = await handler(fetch)('recordShotFinding', fixture(), signal())
    expect(value).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(value)).not.toContain(TEST_TOKEN)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('selected-video Finding input validation', () => {
  const cases: readonly (readonly [string, unknown, boolean?])[] = [
    ['actorId', 'browser-actor'], ['authSessionId', 'a'.repeat(64)], ['token', TEST_TOKEN],
    ['projectId', ' project-e55'], ['episodeId', 'episode-e55\n'], ['frameId', 'frame\0a'],
    ['projectId', '🌳'.repeat(257)], ['frameId', '\ud800'], ['frameId', '\u0085'],
    ['expectedSubjectSha256', 'A'.repeat(64)], ['expectedSubjectSha256', 'a'.repeat(64) + '\n'],
    ['idempotencyKey', 'short'], ['idempotencyKey', 'key'.repeat(67)], ['idempotencyKey', ' key-0001'],
    ['finding', []], ['finding.timecode', ''], ['finding.observation', '\u001c\u0085'],
    ['finding.timecode', 0], ['finding.timecode', '🌳'.repeat(129)], ['finding.observation', '🌳'.repeat(8001)],
    ['finding.observation', 'bad\0text'], ['finding.observation', '\udfff'],
    ['finding.evidenceRefs', []], ['finding.evidenceRefs', Array.from({ length: 33 }, () => 'ref')],
    ['finding.evidenceRefs', [null]], ['finding.evidenceRefs', [' ']], ['finding.evidenceRefs', ['🌳'.repeat(1025)]],
    ['finding.severity', 'critical'], ['finding.severity', null], ['finding.earliestOwner', 'A0'],
    ['finding.earliestOwner', ' C5'], ['finding.ownerReason', ''], ['finding.suggestion', undefined],
    ['finding.reworkScope', ''], ['finding.status', 'OPEN'],
    ['methodProjection.schema', 'other', true], ['methodProjection.extra', true, true],
    ['methodProjection.subject.schema', 'other', true], ['methodProjection.subject.extra', true, true],
    ['methodProjection.subject.projectId', 'another-project', true],
    ['methodProjection.subject.episodeId', 'another-episode', true],
    ['methodProjection.subject.frameId', 'another-frame', true],
    ['methodProjection.subject.frameNo', 0, true], ['methodProjection.subject.frameNo', true, true],
    ['methodProjection.subject.storyboardRevision', -1, true], ['methodProjection.subject.assetVersion', 1.25, true],
    ['methodProjection.subject.assetVersion', Number.MAX_SAFE_INTEGER + 1, true],
    ['methodProjection.subject.assetId', '', true], ['methodProjection.subject.assetSha256', 'missing', true],
    ['methodProjection.subject.frameContentSha256', 'f'.repeat(63), true],
    ['methodProjection.subject.assetSha256', 'f'.repeat(64)],
    ['methodProjection.subjectSnapshotSha256', 'f'.repeat(64)], ['methodProjectionSha256', 'f'.repeat(64)],
    ['methodProjection.definition.requiredFields', [...FIELDS].reverse(), true],
    ['methodProjection.definition.severities', ['MINOR', 'MAJOR', 'BLOCKER'], true],
    ['methodProjection.definition.statusOnRecord', 'APPROVED', true],
    ['methodProjection.definition.approvalAuthority', 'granted', true],
    ['methodProjection.definition.reworkExecutionAllowed', 0, true],
    ['methodProjection.definition.ownerOptions', [], true],
    ['methodProjection.definition.ownerOptions', [{ stageId: 'C5', roleId: 'C5', scope: 'per_lsu' }, { stageId: 'C5', roleId: 'F', scope: 'global' }], true],
    ['methodProjection.definition.ownerOptions.0.roleId', '', true],
    ['methodProjection.definition.ownerOptions.0.scope', 'episode', true],
    ['methodProjection.definition.ownerOptions.0.approved', true, true],
    ['methodProjection.ruleBindings', {}, true], ['methodProjection.ruleBindings', { '../secret': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { '/absolute': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { 'a//b': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { 'a\\b': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { 'a:b': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { 'pipeline/a': 'A'.repeat(64) }, true],
    ['methodProjection.rulesSha256', 'e'.repeat(64)],
    ['methodAttestation.signature', '0'.repeat(64)], ['methodAttestation.signature', 'abc'],
    ['methodAttestation.schema', 'other'], ['methodAttestation.algorithm', 'none'],
    ['methodAttestation.subjectSnapshotSha256', 'f'.repeat(64)],
    ['methodAttestation.methodProjectionSha256', 'e'.repeat(64)], ['methodAttestation.actorId', 'caller'],
  ]
  it.each(cases.map(([path, replacement, signAgain]) => ({ path, replacement, signAgain })))('rejects malformed $path before token lookup or network', async ({ path, replacement, signAgain }) => {
    const request = fixture()
    mutate(request, path, replacement)
    if (signAgain) rebind(request)
    const fetch = networkReturning(result())
    const readToken = vi.fn(() => TEST_TOKEN)
    expect(await handler(fetch, readToken)('recordShotFinding', request, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'short'])('fails closed when the Host method key is %s', async (key) => {
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', key)
    const fetch = networkReturning(result())
    expect(await handler(fetch)('recordShotFinding', fixture(), signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a wrong rules digest even with valid projection SHA and HMAC', async () => {
    const request = fixture()
    mutate(request, 'methodProjection.rulesSha256', '0'.repeat(64))
    mutate(request, 'methodProjectionSha256', sha(request.methodProjection))
    const unsigned = {
      schema: request.methodAttestation.schema, algorithm: request.methodAttestation.algorithm,
      subjectSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256: request.methodProjectionSha256,
    }
    mutate(request, 'methodAttestation', {
      ...unsigned, signature: createHmac('sha256', TEST_KEY).update(canonical(unsigned), 'utf8').digest('hex'),
    })
    const fetch = networkReturning(result())
    expect(await handler(fetch)('recordShotFinding', request, signal()))
      .toMatchObject({ ok: false, error: { code: 'bad-request', message: 'rulesSha256 mismatch' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['methodProjection', 'finding', 'actorId', 'authSessionId'])('recovery rejects extra %s without looking up a method', async (field) => {
    const request = recoveryRequest()
    mutate(request, field, {})
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', undefined)
    const fetch = networkReturning(recovery())
    expect(await handler(fetch)('recoverShotFinding', request, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('selected-video Finding response validation', () => {
  const cases: readonly (readonly [string, unknown])[] = [
    ['schema', 'other'], ['deduplicated', true], ['changed', true], ['providerCalls', false],
    ['selectionChanged', 0], ['humanSignoffInferred', true], ['reworkExecuted', true],
    ['finding.status', 'APPROVED'], ['finding.actorRole', 'approver'], ['finding.actorId', ''],
    ['finding.id', ''], ['finding.eventId', ' event'], ['finding.authSessionId', 'a'.repeat(64)],
    ['finding.createdAt', '2026-02-30T00:00:00Z'], ['finding.createdAt', '2026-08-27T10:00:00'],
    ['finding.subject.projectId', 'other'], ['finding.subject.episodeId', 'other'], ['finding.subject.frameId', 'other'],
    ['finding.subject.frameNo', 0], ['finding.subject.storyboardRevision', 4],
    ['finding.subject.assetId', 'another-video'], ['finding.subject.assetVersion', 1],
    ['finding.subject.assetSha256', 'a'.repeat(64)], ['finding.subject.frameContentSha256', 'b'.repeat(64)],
    ['finding.subjectSnapshotSha256', '0'.repeat(64)], ['finding.methodProjectionSha256', '1'.repeat(64)],
    ['finding.rulesSha256', '2'.repeat(64)], ['finding.currentBinding', true],
    ['finding.observation', 'different'], ['finding.timecode', '00:00:00.000'],
    ['finding.evidenceRefs', ['evidence/frame-000.png']], ['finding.earliestOwner', 'F'],
    ['finding.ownerReason', 'different'], ['finding.severity', 'MINOR'],
    ['finding.suggestion', 'different'], ['finding.reworkScope', 'different'],
  ]
  it.each(cases)('rejects changed %s after one POST and never retries', async (path, replacement) => {
    const expected = result()
    mutate(expected, path, replacement)
    const fetch = networkReturning(expected, 201)
    expect(await handler(fetch)('recordShotFinding', fixture(), signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['schema', 'other'], ['projectId', 'another-project'], ['episodeId', 'another-episode'],
    ['frameId', 'another-frame'], ['expectedSubjectSha256', 'a'.repeat(64)],
    ['idempotencyKey', 'other-record-key'], ['status', 'pending'], ['result', null],
    ['extra', true], ['result.finding.subject.assetSha256', '0'.repeat(64)],
    ['result.finding.actorRole', 'owner'], ['result.humanSignoffInferred', true],
  ] as const)('rejects recovery %s drift', async (path, replacement) => {
    const value = recovery()
    mutate(value, path, replacement)
    const fetch = networkReturning(value)
    expect(await handler(fetch)('recoverShotFinding', recoveryRequest(), signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a not_found response carrying a record', async () => {
    const value = recovery()
    mutate(value, 'status', 'not_found')
    expect(await handler(networkReturning(value))('recoverShotFinding', recoveryRequest(), signal())).toMatchObject({ ok: false })
  })

  it('never leaks the Host token echoed inside a record', async () => {
    const value = result()
    mutate(value, 'finding.observation', TEST_TOKEN)
    const output = await handler(networkReturning(value))('recordShotFinding', fixture(), signal())
    expect(output).toMatchObject({ ok: false })
    expect(JSON.stringify(output)).not.toContain(TEST_TOKEN)
  })
})

describe('selected-video Finding transport cancellation and limits', () => {
  it.each(['recordShotFinding', 'recoverShotFinding'] as const)('does not fetch %s without a usable token', async (endpoint) => {
    const fetch = networkReturning(result())
    const adapter = createYimengCommandHandler({}, { fetch, readToken: () => undefined })
    const request = endpoint === 'recordShotFinding' ? fixture() : recoveryRequest()
    expect(await adapter(endpoint, request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['recordShotFinding', 'recoverShotFinding'] as const)('does not fetch pre-cancelled %s', async (endpoint) => {
    const fetch = networkReturning(result())
    const controller = new AbortController()
    controller.abort()
    const request = endpoint === 'recordShotFinding' ? fixture() : recoveryRequest()
    expect(await handler(fetch)(endpoint, request, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates cancellation to an in-flight POST', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    const controller = new AbortController()
    const pending = handler(fetch)('recordShotFinding', fixture(), controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('enforces the existing deadline without retrying the POST', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    const adapter = createYimengCommandHandler({ timeoutMs: 100 }, { fetch, readToken: () => TEST_TOKEN })
    const pending = adapter('recordShotFinding', fixture(), signal())
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'internal', message: 'Yimeng command timed out' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized responses before trusting their fields', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }))
    expect(await handler(fetch)('recordShotFinding', fixture(), signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the upstream restricted to loopback', () => {
    expect(() => createYimengCommandHandler({ baseUrl: 'https://external.invalid' })).toThrow()
  })
})
