import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateSource, sourceSha } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { createYimengCommandHandler } from '../src/index.ts'
import { stageArtifactCanonicalJson } from '../src/stage-artifact.ts'
import {
  signStageArtifactRequest,
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

function handler(fetch: typeof globalThis.fetch, readToken = () => TOKEN) {
  return createYimengCommandHandler({}, { fetch, readToken })
}

beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Stage artifact registration and receipt recovery transport', () => {
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
    const numbers = { durationSeconds: 1.5, exponent: 1e-7, exponentBoundary: 1e-6, negativeZero: -0 }
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
