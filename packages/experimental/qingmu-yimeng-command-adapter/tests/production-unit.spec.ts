import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createYimengCommandHandler } from '../src/index.ts'
import type {
  YimengBindProductionUnitRequest,
  YimengProductionUnitRecovery,
  YimengProductionUnitResult,
  YimengRecoverProductionUnitBindingRequest,
} from '../src/types.ts'

const TEST_KEY = 'unit-method-host-test-key-'.repeat(2)
const TEST_TOKEN = 'unit-host-test-token'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('fixture must be JSON')
  return encoded
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('fixture object missing')
  return value as Record<string, unknown>
}

function mutate(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let item = object(value)
  for (const key of keys.slice(0, -1)) item = object(item[key])
  const key = keys.at(-1)
  if (key === undefined) throw new Error('fixture path missing')
  if (replacement === undefined) Reflect.deleteProperty(item, key)
  else item[key] = replacement
}

function sign(request: YimengBindProductionUnitRequest): void {
  const input = object(request)
  const method = object(input.methodProjection)
  input.expectedSubjectSha256 = sha(method.subject)
  method.subjectSnapshotSha256 = input.expectedSubjectSha256
  method.rulesSha256 = sha(method.ruleBindings)
  input.methodProjectionSha256 = sha(method)
  const unsigned = {
    schema: 'qingmu.imago-production-unit-method-attestation.v1', algorithm: 'hmac-sha256',
    subjectSnapshotSha256: input.expectedSubjectSha256, methodProjectionSha256: input.methodProjectionSha256,
  }
  input.methodAttestation = {
    ...unsigned, signature: createHmac('sha256', TEST_KEY).update(canonical(unsigned), 'utf8').digest('hex'),
  }
}

// Controlled method signatures test the command parser; current Core rules are checked by the method adapter.
function fixture(): YimengBindProductionUnitRequest {
  const request: YimengBindProductionUnitRequest = {
    projectId: 'unit-project', episodeId: 'unit-episode', groupId: 'native-group', unitId: 'LSU07',
    expectedSubjectSha256: '', expectedBindingRevision: 0, expectedBindingSha256: null,
    idempotencyKey: 'unit-bind-command-001',
    methodProjection: {
      schema: 'qingmu.imago-production-unit-method.v1', subjectSnapshotSha256: '',
      subject: {
        schema: 'jason.qingmu-production-unit-source.v1', projectId: 'unit-project', episodeId: 'unit-episode',
        groupId: 'native-group', groupNo: 3, title: '  门前对话\n  ', groupExecutionPromptSha256: 'a'.repeat(64),
        storyboardRevision: 2,
        shots: [
          { frameId: 'frame-a', frameNo: 2, frameContentSha256: 'b'.repeat(64) },
          { frameId: 'frame-b', frameNo: 7, frameContentSha256: 'c'.repeat(64) },
        ],
      },
      definition: {
        id: 'IMAGO-V6-LSU', version: 'fixture-v1', unitIdPattern: 'LSU[0-9]{2,}', scope: 'per_lsu',
        stages: [{ stageId: 'C5', roleId: 'C5', contractSha256: 'd'.repeat(64) }],
        operation: 'bind_existing_shot_group', planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0,
      },
      ruleBindings: { 'pipeline/imago-os-current.json': 'e'.repeat(64) }, rulesSha256: '',
    },
    methodProjectionSha256: '',
    methodAttestation: {
      schema: 'qingmu.imago-production-unit-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: '', methodProjectionSha256: '', signature: '',
    },
  }
  sign(request)
  return request
}

function result(request = fixture(), token = TEST_TOKEN): YimengProductionUnitResult {
  const binding = {
    unitId: request.unitId, groupId: request.groupId, projectId: request.projectId, episodeId: request.episodeId,
    revision: request.expectedBindingRevision + 1, source: structuredClone(request.methodProjection.subject),
    sourceSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256, definition: structuredClone(request.methodProjection.definition),
    actorId: 'owner-a', authSessionId: createHash('sha256').update(token).digest('hex'),
    eventId: 'event-unit-001', changeSetId: 'changeset-unit-001', createdAt: '2026-08-27T10:00:00.123456+00:00',
  }
  return {
    schema: 'jason.qingmu-production-unit-result.v1', binding, bindingSha256: sha(binding),
    planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
  }
}

function recoveryRequest(request = fixture()): YimengRecoverProductionUnitBindingRequest {
  return {
    projectId: request.projectId, episodeId: request.episodeId, groupId: request.groupId, unitId: request.unitId,
    expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey,
  }
}

function recovery(request = fixture(), found = true): YimengProductionUnitRecovery {
  return {
    schema: 'jason.qingmu-production-unit-recovery.v1', ...recoveryRequest(request),
    found, result: found ? result(request) : null,
  }
}

function networkReturning(value: unknown, status = 200) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  }))
}

function handler(fetch: typeof globalThis.fetch, readToken = () => TEST_TOKEN) {
  return createYimengCommandHandler({}, { fetch, readToken })
}

function signal(): AbortSignal { return new AbortController().signal }

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', TEST_KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('production-unit binding transport', () => {
  it.each([201, 200])('posts explicit unit coordinates once on HTTP %s', async (status) => {
    const request = fixture()
    const expected = result(request)
    const fetch = networkReturning(expected, status)
    expect(await handler(fetch)('bindProductionUnit', request, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = fetch.mock.calls[0]
    if (call === undefined) throw new Error('POST missing')
    const [url, init] = call
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/unit-project/episodes/unit-episode/production-units/LSU07/binding')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TEST_TOKEN}`)
    if (typeof init?.body !== 'string') throw new Error('POST body missing')
    expect(JSON.parse(init.body)).toEqual({
      groupId: request.groupId, expectedSubjectSha256: request.expectedSubjectSha256,
      expectedBindingRevision: request.expectedBindingRevision, expectedBindingSha256: request.expectedBindingSha256,
      methodProjection: request.methodProjection, methodProjectionSha256: request.methodProjectionSha256,
      methodAttestation: request.methodAttestation, idempotencyKey: request.idempotencyKey,
    })
    expect(init.body).not.toContain(TEST_TOKEN)
  })

  it.each([true, false])('recovers by GET only after key/session rotation; found=%s', async (found) => {
    const request = fixture()
    const expected = recovery(request, found)
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', undefined)
    const fetch = networkReturning(expected)
    expect(await handler(fetch, () => 'replacement-token')('recoverProductionUnitBinding', recoveryRequest(request), signal()))
      .toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(`http://127.0.0.1:8115/api/qingmu/projects/unit-project/episodes/unit-episode/production-units/LSU07/binding/command-receipt?groupId=native-group&expectedSubjectSha256=${request.expectedSubjectSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('keeps source order, sparse frame numbers, explicit unit ID and both CAS fields distinct', async () => {
    const request = fixture()
    mutate(request, 'expectedBindingRevision', Number.MAX_SAFE_INTEGER - 1)
    mutate(request, 'expectedBindingSha256', 'f'.repeat(64))
    mutate(request, 'methodProjection.subject.title', '\ufeff🌳'.repeat(4000))
    mutate(request, 'methodProjection.subject.storyboardRevision', 0)
    sign(request)
    const expected = result(request)
    expect(await handler(networkReturning(expected))('bindProductionUnit', request, signal())).toEqual({ ok: true, value: expected })
  })

  it.each(['projectId', 'episodeId', 'groupId'])('encodes %s without changing identity', async (field) => {
    const request = fixture()
    mutate(request, field, '片/段 ?#')
    mutate(request, `methodProjection.subject.${field}`, '片/段 ?#')
    sign(request)
    const fetch = networkReturning(recovery(request))
    expect(await handler(fetch)('recoverProductionUnitBinding', recoveryRequest(request), signal())).toMatchObject({ ok: true })
    expect(fetch.mock.calls[0]?.[0]).toContain(encodeURIComponent('片/段 ?#'))
  })

  it.each([401, 403, 409, 422, 500, 503])('does not retry HTTP %s', async (status) => {
    const fetch = networkReturning({ detail: { code: 'production_unit_binding_conflict' } }, status)
    expect(await handler(fetch)('bindProductionUnit', fixture(), signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps a lost response unknown and redacts tokens without resubmitting', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TEST_TOKEN) })
    const reply = await handler(fetch)('bindProductionUnit', fixture(), signal())
    expect(reply).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(reply)).not.toContain(TEST_TOKEN)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('production-unit command validation', () => {
  const cases: [string, unknown, boolean?][] = [
    ['actorId', 'browser-owner'], ['authSessionId', 'a'.repeat(64)], ['confirmed', true],
    ['expectedBindingSha256', undefined], ['expectedBindingSha256', 'f'.repeat(64)],
    ['expectedBindingRevision', 1], ['expectedBindingRevision', true], ['expectedBindingRevision', -1],
    ['expectedBindingRevision', Number.MAX_SAFE_INTEGER + 1],
    ['unitId', 'LSU1'], ['unitId', 'LSU01\n'], ['unitId', 'LSU١٢'], ['unitId', 'LSU' + '1'.repeat(254)],
    ['projectId', ' project'], ['episodeId', '\u0085'], ['groupId', '\ud800'], ['groupId', 'x\0y'],
    ['idempotencyKey', 'short'], ['idempotencyKey', 'x'.repeat(201)],
    ['expectedSubjectSha256', 'A'.repeat(64)], ['expectedSubjectSha256', 'a'.repeat(64) + '\n'],
    ['methodProjection.schema', 'other', true], ['methodProjection.extra', true, true],
    ['methodProjection.subject.projectId', 'other', true], ['methodProjection.subject.episodeId', 'other', true],
    ['methodProjection.subject.groupId', 'other', true], ['methodProjection.subject.groupNo', 0, true],
    ['methodProjection.subject.storyboardRevision', true, true], ['methodProjection.subject.storyboardRevision', -1, true],
    ['methodProjection.subject.title', '\u001c\u0085', true], ['methodProjection.subject.title', '\ud800', true],
    ['methodProjection.subject.title', '🌳'.repeat(8001), true], ['methodProjection.subject.extra', 1, true],
    ['methodProjection.subject.groupExecutionPromptSha256', '', true], ['methodProjection.subject.shots', [], true],
    ['methodProjection.subject.shots.1.frameId', 'frame-a', true], ['methodProjection.subject.shots.1.frameNo', 2, true],
    ['methodProjection.subject.shots.0.frameNo', 1.5, true], ['methodProjection.subject.shots.0.frameNo', true, true],
    ['methodProjection.subject.shots.0.frameContentSha256', 'X'.repeat(64), true],
    ['methodProjection.subject.shots.0.frameNo', Number.MAX_SAFE_INTEGER + 1, true],
    ['methodProjection.subjectSnapshotSha256', 'f'.repeat(64)], ['methodProjectionSha256', 'f'.repeat(64)],
    ['methodProjection.definition.id', 'other', true], ['methodProjection.definition.version', '', true],
    ['methodProjection.definition.unitIdPattern', '.*', true], ['methodProjection.definition.scope', 'global', true],
    ['methodProjection.definition.operation', 'execute', true], ['methodProjection.definition.planSealingAllowed', true, true],
    ['methodProjection.definition.stageApprovalAllowed', true, true], ['methodProjection.definition.providerCalls', true, true],
    ['methodProjection.definition.stages', [], true], ['methodProjection.definition.stages.0.contractSha256', '', true],
    ['methodProjection.definition.stages.0.roleId', '', true], ['methodProjection.definition.stages.0.extra', true, true],
    ['methodProjection.ruleBindings', {}, true], ['methodProjection.ruleBindings', { '../secret': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { '/absolute': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { 'a//b': 'a'.repeat(64) }, true],
    ['methodProjection.rulesSha256', 'e'.repeat(64)], ['methodAttestation.signature', '0'.repeat(64)],
    ['methodAttestation.schema', 'other'], ['methodAttestation.algorithm', 'none'], ['methodAttestation.extra', true],
  ]
  it.each(cases)('rejects invalid %s before any fetch', async (path, value, resign) => {
    const request = fixture()
    mutate(request, path, value)
    if (resign) sign(request)
    const fetch = networkReturning(result())
    expect(await handler(fetch)('bindProductionUnit', request, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects duplicate signed stage IDs', async () => {
    const request = fixture()
    mutate(request, 'methodProjection.definition.stages', [request.methodProjection.definition.stages[0], request.methodProjection.definition.stages[0]])
    sign(request)
    const fetch = networkReturning(result(request))
    expect(await handler(fetch)('bindProductionUnit', request, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', 'short'])('fails closed when the signing key is unavailable: %s', async (key) => {
    const request = fixture()
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', key)
    const fetch = networkReturning(result(request))
    expect(await handler(fetch)('bindProductionUnit', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('production-unit receipt validation', () => {
  const cases: readonly (readonly [string, unknown])[] = [
    ['schema', 'other'], ['planSealed', true], ['providerCalls', true], ['humanSignoffInferred', true], ['reworkExecuted', true],
    ['bindingSha256', 'f'.repeat(64)], ['binding.unitId', 'LSU08'], ['binding.groupId', 'another-group'],
    ['binding.projectId', 'another-project'], ['binding.episodeId', 'another-episode'], ['binding.revision', 2],
    ['binding.actorId', ''], ['binding.authSessionId', 'f'.repeat(64)], ['binding.eventId', ''],
    ['binding.createdAt', '2026-08-27T00:00:00'], ['binding.sourceSnapshotSha256', 'f'.repeat(64)],
    ['binding.methodProjectionSha256', 'f'.repeat(64)], ['binding.rulesSha256', 'f'.repeat(64)],
    ['binding.definition.stageApprovalAllowed', true], ['binding.definition.version', 'another-version'],
    ['binding.source.shots.0.frameContentSha256', 'f'.repeat(64)], ['binding.extra', true],
  ]
  it.each(cases)('rejects invalid or mismatched %s even with a recalculated binding hash', async (path, value) => {
    const request = fixture()
    const reply = result(request)
    mutate(reply, path, value)
    if (path !== 'bindingSha256') mutate(reply, 'bindingSha256', sha(reply.binding))
    const fetch = networkReturning(reply)
    expect(await handler(fetch)('bindProductionUnit', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['found', 'true'], ['found', false], ['result', null], ['unitId', 'LSU09'], ['groupId', 'other'],
    ['projectId', 'other'], ['episodeId', 'other'], ['expectedSubjectSha256', 'a'.repeat(64)],
    ['idempotencyKey', 'different-command'], ['result.bindingSha256', 'a'.repeat(64)],
  ] as const)('rejects inconsistent recovery %s without a write', async (path, value) => {
    const request = fixture()
    const reply = recovery(request)
    mutate(reply, path, value)
    const fetch = networkReturning(reply)
    expect(await handler(fetch)('recoverProductionUnitBinding', recoveryRequest(request), signal())).toMatchObject({ ok: false })
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
