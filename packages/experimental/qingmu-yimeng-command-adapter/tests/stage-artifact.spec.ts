import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateSource, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import {
  createYimengCommandHandler,
  type YimengCommandAdapterDependencies,
  type YimengStageArtifact,
} from '../src/index.ts'
import { stageArtifactCanonicalJson } from '../src/stage-artifact.ts'
import {
  signStageArtifactRequest,
  stageArtifactAuthorityProbeResult,
  stageArtifactAuthorityRequest,
  stageArtifactDecisionRecoveryRequest,
  stageArtifactDecisionRequest,
  stageArtifactDecisionResult,
  stageArtifactMethodResponse,
  stageArtifactRecoveryRequest,
  stageArtifactRequest,
  stageArtifactResult,
  stageArtifactSha,
} from './stage-artifact-fixture.ts'

const KEY = 'stage-artifact-command-test-key-'.repeat(2)
const TOKEN = 'stage-artifact-command-token'
const signal = () => new AbortController().signal

function network(value: unknown, status = 200): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }))
}

function stageNetwork(value: unknown, status = 200): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(stageArtifactCanonicalJson(value, 'response'), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

type StageArtifactMethodRunner = NonNullable<YimengCommandAdapterDependencies['runStageArtifactMethod']>

const runCurrentStageArtifactMethod: StageArtifactMethodRunner = async (payload) => {
  const artifact = (payload as { artifact: YimengStageArtifact }).artifact
  return { ok: true, value: stageArtifactMethodResponse(artifact, KEY) }
}

function handler(
  fetch: typeof globalThis.fetch,
  readToken = () => TOKEN,
  runStageArtifactMethod: StageArtifactMethodRunner = runCurrentStageArtifactMethod,
) {
  return createYimengCommandHandler({}, { fetch, readToken, runStageArtifactMethod })
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Stage artifact registration and receipt recovery transport', () => {
  it('sends one exact independent decision POST without browser actor or session authority', async () => {
    const registration = stageArtifactRequest(KEY)
    const registered = stageArtifactResult(registration, TOKEN)
    const request = stageArtifactDecisionRequest(registration, registered)
    const expected = stageArtifactDecisionResult(request, TOKEN)
    const currentMethod = stageArtifactMethodResponse(request.artifact, KEY)
    const fetch = network(expected, 201)

    expect(await handler(fetch)('commitStageArtifactDecision', request, signal())).toEqual({ ok: true, value: expected })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/artifact-project/episodes/artifact-episode/'
      + 'stage-artifacts/A0/GLOBAL/decisions')
    if (typeof init?.body !== 'string') throw new Error('serialized decision body required')
    expect(JSON.parse(init.body)).toEqual({
      expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
      expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
      expectedArtifactRevision: request.expectedArtifactRevision,
      expectedArtifactSha256: request.expectedArtifactSha256,
      expectedSubjectSha256: request.expectedSubjectSha256,
      methodProjection: currentMethod.projection,
      methodProjectionSha256: currentMethod.projectionSha256,
      methodAttestation: currentMethod.methodAttestation,
      decision: request.decision,
      reason: request.reason,
      idempotencyKey: request.idempotencyKey,
    })
    expect(init.body).not.toContain('actorNaturalPersonId')
    expect(init.body).not.toContain('authSessionId')
    expect(expected.decision).toMatchObject({
      stageArtifactAvailable: true,
      dependencyAuthorityVerified: true,
      stageApprovalGranted: true,
      lockActivated: true,
      planSealed: false,
      providerCalls: 0,
      humanSignoffInferred: false,
      reworkExecuted: false,
    })
  })

  it('recovers the original decision receipt with GET only after the key and token rotate', async () => {
    const registration = stageArtifactRequest(KEY)
    const request = stageArtifactDecisionRequest(registration, stageArtifactResult(registration, TOKEN))
    const receipt = stageArtifactDecisionResult(request, TOKEN)
    const recovery = { schema: 'jason.qingmu-stage-artifact-decision-recovery.v1', receipt }
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const fetch = network(recovery)

    expect(await handler(fetch, () => 'rotated-token')(
      'recoverStageArtifactDecision', stageArtifactDecisionRecoveryRequest(request), signal(),
    )).toEqual({ ok: true, value: recovery })

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/artifact-project/episodes/artifact-episode/'
      + `stage-artifacts/A0/GLOBAL/decision-command-receipt?expectedArtifactRecordRevision=1&expectedArtifactRecordSha256=${request.expectedArtifactRecordSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('probes current authority with one fresh signed method and no caller-supplied identity', async () => {
    const registration = stageArtifactRequest(KEY)
    const registered = stageArtifactResult(registration, TOKEN)
    const request = stageArtifactAuthorityRequest(registration, registered)
    const currentMethod = stageArtifactMethodResponse(request.artifact, KEY)
    const decision = stageArtifactDecisionResult(
      stageArtifactDecisionRequest(registration, registered),
      TOKEN,
    )
    const expected = stageArtifactAuthorityProbeResult(request, decision)
    const fetch = network(expected)

    expect(await handler(fetch)('probeStageArtifactAuthority', request, signal())).toEqual({
      ok: true,
      value: expected,
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/artifact-project/episodes/artifact-episode/'
      + 'stage-artifacts/A0/GLOBAL/authority-probe')
    if (typeof init?.body !== 'string') throw new Error('serialized authority probe body required')
    expect(JSON.parse(init.body)).toEqual({
      expectedArtifactRecordRevision: request.expectedArtifactRecordRevision,
      expectedArtifactRecordSha256: request.expectedArtifactRecordSha256,
      expectedArtifactRevision: request.expectedArtifactRevision,
      expectedArtifactSha256: request.expectedArtifactSha256,
      expectedSubjectSha256: request.expectedSubjectSha256,
      methodProjection: currentMethod.projection,
      methodProjectionSha256: currentMethod.projectionSha256,
      methodAttestation: currentMethod.methodAttestation,
    })
    expect(init.body).not.toContain('actorNaturalPersonId')
    expect(init.body).not.toContain('authSessionId')
    expect(init.body).not.toContain('idempotencyKey')
    expect(expected).toMatchObject({
      dependencyAuthorityVerified: true,
      stageArtifactAvailable: true,
      stageApprovalGranted: true,
      lockActivated: true,
      planSealed: false,
      providerCalls: 0,
      reworkExecuted: false,
    })
  })

  it('accepts a rules-drift probe only as fail-closed non-authority', async () => {
    const registration = stageArtifactRequest(KEY)
    const registered = stageArtifactResult(registration, TOKEN)
    const request = stageArtifactAuthorityRequest(registration, registered)
    const currentMethod = stageArtifactMethodResponse(
      request.artifact,
      KEY,
      undefined,
      { 'pipeline/imago-os-current.json': 'b'.repeat(64) },
    )
    const expected = stageArtifactAuthorityProbeResult(request, null, ['target_rules_not_current'])
    expected.rulesSha256 = currentMethod.projection.rulesSha256
    const runStageArtifactMethod: StageArtifactMethodRunner = async () => ({ ok: true, value: currentMethod })

    expect(await handler(network(expected), () => TOKEN, runStageArtifactMethod)(
      'probeStageArtifactAuthority', request, signal(),
    )).toEqual({
      ok: true,
      value: expected,
    })
    expect(expected).toMatchObject({
      currentDecisionResult: null,
      dependencyAuthorityVerified: false,
      stageArtifactAvailable: false,
      stageApprovalGranted: false,
      lockActivated: false,
    })
  })

  it('sends exactly one explicit POST body and validates the immutable non-authoritative receipt', async () => {
    const request = stageArtifactRequest(KEY)
    const expected = stageArtifactResult(request, TOKEN)
    const fetch = network(expected, 201)
    expect(await handler(fetch)('registerStageArtifact', request, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/artifact-project/episodes/artifact-episode/'
      + 'stage-artifacts/A0/GLOBAL')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    if (typeof init?.body !== 'string') throw new Error('serialized JSON request body required')
    expect(JSON.parse(init.body)).toEqual({
      artifact: request.artifact,
      expectedSubjectSha256: request.expectedSubjectSha256,
      expectedArtifactRecordRevision: 0,
      expectedArtifactRecordSha256: null,
      methodProjection: request.methodProjection,
      methodProjectionSha256: request.methodProjectionSha256,
      methodAttestation: request.methodAttestation,
      idempotencyKey: request.idempotencyKey,
    })
    expect(expected.artifactRecord).toMatchObject({
      stageArtifactRegistered: true,
      stageArtifactAvailable: false,
      dependencyAuthorityVerified: false,
      stageApprovalGranted: false,
      lockActivated: false,
      planSealed: false,
      providerCalls: 0,
      humanSignoffInferred: false,
      reworkExecuted: false,
    })
  })

  it('recovers by original coordinates with GET only after the HMAC key and session token rotate', async () => {
    const request = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(request, TOKEN)
    const recovery = { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const fetch = network(recovery)
    expect(await handler(fetch, () => 'rotated-token')(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toEqual({ ok: true, value: recovery })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/artifact-project/episodes/artifact-episode/'
      + `stage-artifacts/A0/GLOBAL/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })

  it('preserves a Core-valid business token field through POST validation and GET recovery', async () => {
    const request = stageArtifactRequest(KEY)
    mutateSource(request, 'artifact.content.source_ledger.data.token', 'ordinary-value')
    const artifactSha256 = stageArtifactSha(request.artifact)
    mutateSource(request, 'methodProjection.subject.artifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.machineValidation.validatedArtifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.subjectSnapshotSha256', sourceSha(request.methodProjection.subject))
    signStageArtifactRequest(request, KEY)
    const receipt = stageArtifactResult(request, TOKEN)

    expect(await handler(network(receipt, 201))(
      'registerStageArtifact', request, signal(),
    )).toEqual({ ok: true, value: receipt })
    expect(receipt.artifactRecord.artifactSha256).toBe(artifactSha256)

    const recovery = { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }
    expect(await handler(network(recovery))(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toEqual({ ok: true, value: recovery })
  })

  it('rejects the current bearer credential reflected by a valid POST receipt', async () => {
    const request = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(request, TOKEN)
    mutateSource(receipt, 'receiptId', TOKEN)
    const fetch = network(receipt, 201)

    const output = await handler(fetch)('registerStageArtifact', request, signal())

    expect(fetch).toHaveBeenCalledOnce()
    expect(output).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed', details: {} },
    })
    expect(JSON.stringify(output)).not.toContain(TOKEN)
  })

  it('rejects the current bearer credential reflected by a valid GET recovery receipt', async () => {
    const request = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(request, TOKEN)
    mutateSource(receipt, 'receiptId', TOKEN)
    const recovery = { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }
    const fetch = network(recovery)

    const output = await handler(fetch)(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )

    expect(fetch).toHaveBeenCalledOnce()
    expect(output).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Yimeng command contract failed', details: {} },
    })
    expect(JSON.stringify(output)).not.toContain(TOKEN)
  })

  it('preserves Python-canonical finite numbers through the POST body and GET recovery', async () => {
    const request = stageArtifactRequest(KEY)
    const numbers = {
      durationSeconds: 1.5,
      exponent: 1e-7,
      exponentBoundary: 1e-6,
      integerExponent: 1e21,
      fractionalExponent: 1.2345678901234568e21,
      maximumFinite: Number.MAX_VALUE,
      negativeZero: -0,
    }
    mutateSource(request, 'artifact.content.source_ledger.data', numbers)
    const artifactSha256 = stageArtifactSha(request.artifact)
    mutateSource(request, 'methodProjection.subject.artifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.machineValidation.validatedArtifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.subjectSnapshotSha256', sourceSha(request.methodProjection.subject))
    signStageArtifactRequest(request, KEY)
    const receipt = stageArtifactResult(request, TOKEN)
    const post = stageNetwork(receipt, 201)

    expect(await handler(post)('registerStageArtifact', request, signal())).toEqual({ ok: true, value: receipt })
    const [, init] = post.mock.calls[0] ?? []
    if (typeof init?.body !== 'string') throw new Error('serialized Stage request body required')
    expect(init.body).toContain('"exponent":1e-07')
    expect(init.body).toContain('"exponentBoundary":1e-06')
    expect(init.body).toContain('"integerExponent":1e+21')
    expect(init.body).toContain('"fractionalExponent":1.2345678901234568e+21')
    expect(init.body).toContain('"maximumFinite":1.7976931348623157e+308')
    expect(init.body).toContain('"negativeZero":-0.0')
    const sent = JSON.parse(init.body) as { artifact: { content: { source_ledger: { data: typeof numbers } } } }
    expect(Object.is(sent.artifact.content.source_ledger.data.negativeZero, -0)).toBe(true)

    const recovery = { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }
    expect(await handler(stageNetwork(recovery))(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toEqual({ ok: true, value: recovery })
  })

  it.each([
    ['!'.repeat(7), false],
    ['~'.repeat(201), false],
    ['artifact key', false],
    ['artifact-\u0085-key', false],
    ['!'.repeat(8), true],
    ['~'.repeat(200), true],
  ] as const)('enforces recoverable visible-ASCII idempotency key %j', async (idempotencyKey, allowed) => {
    const request = { ...stageArtifactRequest(KEY), idempotencyKey }
    const fetch = network(stageArtifactResult(request, TOKEN))
    const reply = await handler(fetch)('registerStageArtifact', request, signal())
    expect(reply.ok).toBe(allowed)
    expect(fetch).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('does not retry a POST whose response is lost and redacts transport secrets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const reply = await handler(fetch)('registerStageArtifact', stageArtifactRequest(KEY), signal())
    expect(reply).toMatchObject({ ok: false })
    expect(JSON.stringify(reply)).not.toContain(TOKEN)
    expect(JSON.stringify(reply)).not.toContain(KEY)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 404, 409, 422, 500, 503])('does not retry or fabricate recovery for HTTP %s', async (status) => {
    const request = stageArtifactRequest(KEY)
    const fetch = network({ detail: { code: 'command_receipt_not_found' } }, status)
    expect(await handler(fetch)(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('Stage artifact commands fail closed before transport', () => {
  const cases: Array<[string, unknown, boolean?]> = [
    ['approval', true],
    ['actorId', 'browser'],
    ['stageId', 'A1'],
    ['scopeInstance', 'LSU01'],
    ['expectedArtifactRecordRevision', true],
    ['expectedArtifactRecordRevision', -1],
    ['expectedArtifactRecordRevision', Number.MAX_SAFE_INTEGER],
    ['expectedArtifactRecordRevision', 1],
    ['expectedArtifactRecordSha256', 'f'.repeat(64)],
    ['expectedSubjectSha256', 'f'.repeat(64)],
    ['artifact.stage_id', 'A1'],
    ['artifact.producer.producer_role', 'A1'],
    ['methodProjection.subject.projectId', 'other', true],
    ['methodProjection.subject.extra', true, true],
    ['methodProjection.machineValidation.status', 'FAIL', true],
    ['methodProjection.definition.stageApprovalAllowed', true, true],
    ['methodProjection.definition.dependencyAuthorityVerified', true, true],
    ['methodProjection.definition.roleId', 'A1', true],
    ['methodProjection.definition.providerCalls', 1, true],
    ['methodProjection.ruleBindings', {}, true],
    ['methodProjection.ruleBindings', { '../current.json': 'a'.repeat(64) }, true],
    ['methodProjection.rulesSha256', 'f'.repeat(64), true],
    ['methodProjectionSha256', 'f'.repeat(64)],
    ['methodAttestation.signature', '0'.repeat(64)],
    ['methodAttestation.extra', true],
  ]

  it.each(cases)('rejects %s even when the altered projection is re-signed where relevant', async (path, value, resign) => {
    const request = stageArtifactRequest(KEY)
    mutateSource(request, path, value)
    if (resign) signStageArtifactRequest(request, KEY)
    const fetch = network(stageArtifactResult(stageArtifactRequest(KEY), TOKEN))
    expect(await handler(fetch)('registerStageArtifact', request, signal())).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires a current bearer token and honors pre-cancellation without transport', async () => {
    const request = stageArtifactRequest(KEY)
    const fetch = network(stageArtifactResult(request, TOKEN))
    expect(await handler(fetch, () => '')('registerStageArtifact', request, signal())).toMatchObject({ ok: false })
    const abort = new AbortController()
    abort.abort()
    expect(await handler(fetch)('registerStageArtifact', request, abort.signal)).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['expectedArtifactRecordRevision', 0],
    ['expectedArtifactRecordSha256', 'f'.repeat(63)],
    ['expectedArtifactRevision', ''],
    ['expectedArtifactSha256', 'f'.repeat(63)],
    ['decision', 'comment'],
    ['reason', ''],
    ['actorNaturalPersonId', 'browser-person'],
    ['artifact.artifact_revision', 'other-revision'],
    ['methodProjection', {}],
    ['methodAttestation', {}],
  ])('rejects decision command mutation %s before transport', async (path, value) => {
    const registration = stageArtifactRequest(KEY)
    const request = stageArtifactDecisionRequest(registration, stageArtifactResult(registration, TOKEN))
    mutateSource(request, path, value)
    const fetch = network(stageArtifactDecisionResult(
      stageArtifactDecisionRequest(registration, stageArtifactResult(registration, TOKEN)),
      TOKEN,
    ))

    expect(await handler(fetch)('commitStageArtifactDecision', request, signal())).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts request_changes with explicit unresolved dependency blockers but grants no authority', async () => {
    const registration = stageArtifactRequest(KEY)
    const request = stageArtifactDecisionRequest(registration, stageArtifactResult(registration, TOKEN))
    mutateSource(request, 'decision', 'request_changes')
    const result = stageArtifactDecisionResult(request, TOKEN)
    mutateSource(result, 'decision.dependencyAuthority.blockers', ['required_source_not_current:F'])
    mutateSource(result, 'decision.dependencyAuthority.verified', false)
    mutateSource(result, 'decision.dependencyAuthorityVerified', false)

    expect(await handler(network(result, 201))('commitStageArtifactDecision', request, signal())).toEqual({
      ok: true,
      value: result,
    })
    expect(result.decision).toMatchObject({
      stageArtifactAvailable: false,
      stageApprovalGranted: false,
      lockActivated: false,
      humanSignoffInferred: false,
      providerCalls: 0,
    })
    expect(result.producedLock).toBeNull()
  })

  it('rejects replayed caller Method proofs before the current Core Method or transport runs', async () => {
    const registration = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(registration, TOKEN)
    const runStageArtifactMethod = vi.fn<StageArtifactMethodRunner>(runCurrentStageArtifactMethod)
    const fetch = network({})
    const replayProof = {
      methodProjection: structuredClone(registration.methodProjection),
      methodProjectionSha256: registration.methodProjectionSha256,
      methodAttestation: structuredClone(registration.methodAttestation),
    }
    const attempts = [
      ['commitStageArtifactDecision', {
        ...stageArtifactDecisionRequest(registration, receipt),
        ...replayProof,
      }],
      ['probeStageArtifactAuthority', {
        ...stageArtifactAuthorityRequest(registration, receipt),
        ...replayProof,
      }],
    ] as const

    for (const [endpoint, request] of attempts) {
      expect(await handler(fetch, () => TOKEN, runStageArtifactMethod)(endpoint, request, signal())).toMatchObject({
        ok: false,
        error: { code: 'bad-request' },
      })
    }
    expect(runStageArtifactMethod).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the trusted current Method capability before a decision or authority probe', async () => {
    const registration = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(registration, TOKEN)
    const fetch = network({})
    const withoutMethod = (endpoint: 'commitStageArtifactDecision' | 'probeStageArtifactAuthority', payload: unknown) => (
      createYimengCommandHandler({}, { fetch, readToken: () => TOKEN })(endpoint, payload, signal())
    )

    expect(await withoutMethod(
      'commitStageArtifactDecision',
      stageArtifactDecisionRequest(registration, receipt),
    )).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(await withoutMethod(
      'probeStageArtifactAuthority',
      stageArtifactAuthorityRequest(registration, receipt),
    )).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Stage artifact decision receipt binding', () => {
  const cases: Array<[string, unknown]> = [
    ['schema', 'other'],
    ['decision.subjectArtifactRecordRevision', 2],
    ['decision.subjectArtifactRecordSha256', 'f'.repeat(64)],
    ['decision.methodProjectionSha256', 'f'.repeat(64)],
    ['decision.actorNaturalPersonId', 'natural-person-producer'],
    ['decision.decisionOrdinal', 0],
    ['decision.authSessionId', 'f'.repeat(64)],
    ['decision.dependencyAuthority.verified', false],
    ['decision.stageArtifactAvailable', false],
    ['decision.planSealed', true],
    ['decision.providerCalls', 1],
    ['decision.humanSignoffInferred', true],
    ['producedLock.eventSha256', 'f'.repeat(64)],
    ['extra', true],
  ]

  it.each(cases)('refuses forged decision receipt %s without transport retry', async (path, value) => {
    const registration = stageArtifactRequest(KEY)
    const request = stageArtifactDecisionRequest(registration, stageArtifactResult(registration, TOKEN))
    const reply = structuredClone(stageArtifactDecisionResult(request, TOKEN))
    mutateSource(reply, path, value)
    const fetch = network(reply, 201)

    expect(await handler(fetch)('commitStageArtifactDecision', request, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['wrong declared lock', (reply: ReturnType<typeof stageArtifactAuthorityProbeResult>) => {
      mutateSource(reply, 'currentDecisionResult.producedLock.lockId', 'FORGED_LOCK')
    }],
    ['missing declared lock', (reply: ReturnType<typeof stageArtifactAuthorityProbeResult>) => {
      mutateSource(reply, 'currentDecisionResult.producedLock', null)
      mutateSource(reply, 'currentDecisionResult.decision.lockActivated', false)
      mutateSource(reply, 'lockActivated', false)
    }],
  ] as const)('refuses an authority probe with %s', async (_label, forge) => {
    const registration = stageArtifactRequest(KEY)
    const registered = stageArtifactResult(registration, TOKEN)
    const request = stageArtifactAuthorityRequest(registration, registered)
    const decision = stageArtifactDecisionResult(stageArtifactDecisionRequest(registration, registered), TOKEN)
    const reply = stageArtifactAuthorityProbeResult(request, decision)
    forge(reply)
    const fetch = network(reply)

    expect(await handler(fetch)('probeStageArtifactAuthority', request, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('Stage artifact durable receipt binding', () => {
  const cases: Array<[string, unknown]> = [
    ['schema', 'other'],
    ['artifactRecord.projectId', 'other'],
    ['artifactRecord.artifactRevision', 'other'],
    ['artifactRecord.artifactSha256', 'f'.repeat(64)],
    ['artifactRecord.subjectSnapshotSha256', 'f'.repeat(64)],
    ['artifactRecord.methodProjectionSha256', 'f'.repeat(64)],
    ['artifactRecord.rulesSha256', 'f'.repeat(64)],
    ['artifactRecord.artifactRecordRevision', 2],
    ['artifactRecord.producerNaturalPersonId', 'other-person'],
    ['artifactRecord.authSessionId', 'f'.repeat(64)],
    ['artifactRecord.createdAt', 'not-a-date'],
    ['artifactRecord.stageArtifactAvailable', true],
    ['artifactRecord.stageApprovalGranted', true],
    ['artifactRecord.lockActivated', true],
    ['artifactRecord.planSealed', true],
    ['artifactRecord.providerCalls', 1],
    ['artifactRecord.humanSignoffInferred', true],
    ['artifactRecord.reworkExecuted', true],
    ['artifactRecordSha256', 'f'.repeat(64)],
    ['receiptId', ''],
    ['extra', true],
  ]

  it.each(cases)('refuses forged receipt %s without transport retry', async (path, value) => {
    const request = stageArtifactRequest(KEY)
    const reply = structuredClone(stageArtifactResult(request, TOKEN))
    mutateSource(reply, path, value)
    if (path.startsWith('artifactRecord.')) {
      mutateSource(reply, 'artifactRecordSha256', stageArtifactSha(reply.artifactRecord))
    }
    const fetch = network(reply)
    expect(await handler(fetch)('registerStageArtifact', request, signal())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects invented not-found wrappers and receipts from a different subject', async () => {
    const request = stageArtifactRequest(KEY)
    const fetch = network({ schema: 'jason.qingmu-stage-artifact-recovery.v1', found: false, receipt: null })
    expect(await handler(fetch)(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toMatchObject({ ok: false })
    const old = stageArtifactResult(request, TOKEN)
    const other = { ...stageArtifactRecoveryRequest(request), expectedSubjectSha256: createHash('sha256').update('other').digest('hex') }
    expect(await handler(network({ schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt: old }))(
      'recoverStageArtifactRegistration', other, signal(),
    )).toMatchObject({ ok: false })
  })

  it('rejects a self-consistent recovered receipt whose artifact producer role differs from the Stage owner', async () => {
    const request = stageArtifactRequest(KEY)
    mutateSource(request, 'artifact.producer.producer_role', 'A1')
    const artifactSha256 = stageArtifactSha(request.artifact)
    mutateSource(request, 'methodProjection.subject.artifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.machineValidation.validatedArtifactSha256', artifactSha256)
    mutateSource(request, 'methodProjection.subjectSnapshotSha256', sourceSha(request.methodProjection.subject))
    signStageArtifactRequest(request, KEY)
    const recovery = {
      schema: 'jason.qingmu-stage-artifact-recovery.v1',
      receipt: stageArtifactResult(request, TOKEN),
    }
    expect(await handler(network(recovery))(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toMatchObject({ ok: false })
  })

  it('rejects a self-consistent recovered receipt whose definition version differs from the artifact workflow', async () => {
    const request = stageArtifactRequest(KEY)
    const receipt = stageArtifactResult(request, TOKEN)
    mutateSource(receipt, 'artifactRecord.definition.version', 'forged-version')
    mutateSource(receipt, 'artifactRecordSha256', stageArtifactSha(receipt.artifactRecord))
    const recovery = { schema: 'jason.qingmu-stage-artifact-recovery.v1', receipt }
    expect(await handler(network(recovery))(
      'recoverStageArtifactRegistration', stageArtifactRecoveryRequest(request), signal(),
    )).toMatchObject({ ok: false })
  })
})
