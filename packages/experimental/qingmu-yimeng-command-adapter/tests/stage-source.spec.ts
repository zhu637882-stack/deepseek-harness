import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateSource, sourceCanonical, sourceObject, sourceSha, stageSource, stageSourceDefinition, stageSourceResult } from '../../qingmu-yimeng-read-adapter/tests/stage-source-fixture.ts'
import { createYimengCommandHandler } from '../src/index.ts'
import type { YimengBindStageSourceRequest, YimengRecoverStageSourceBindingRequest, YimengStageSourceResult } from '../src/types.ts'

const KEY = 'stage-source-test-key-'.repeat(3)
const TOKEN = 'source-command-test-token'
const signal = () => new AbortController().signal

function sign(request: YimengBindStageSourceRequest): void {
  const raw = sourceObject(request)
  const method = sourceObject(raw.methodProjection)
  raw.expectedSubjectSha256 = sourceSha(method.subject)
  method.subjectSnapshotSha256 = raw.expectedSubjectSha256
  method.rulesSha256 = sourceSha(method.ruleBindings)
  raw.methodProjectionSha256 = sourceSha(method)
  const unsigned = { schema: 'qingmu.imago-stage-source-method-attestation.v1', algorithm: 'hmac-sha256',
    subjectSnapshotSha256: raw.expectedSubjectSha256, methodProjectionSha256: raw.methodProjectionSha256 }
  raw.methodAttestation = { ...unsigned, signature: createHmac('sha256', KEY).update(sourceCanonical(unsigned)).digest('hex') }
}
// Synthetic signatures exercise parsing. The separate Loader test uses the real current Core.
function fixture(): YimengBindStageSourceRequest {
  const subject = stageSource()
  const request: YimengBindStageSourceRequest = { projectId: subject.projectId, episodeId: subject.episodeId, stageId: 'A1S',
    expectedSubjectSha256: '', expectedBindingRevision: 0, expectedBindingSha256: null, idempotencyKey: 'source-command-001',
    methodProjection: { schema: 'qingmu.imago-stage-source-method.v1', subject, subjectSnapshotSha256: '', definition: stageSourceDefinition(),
      ruleBindings: { 'pipeline/imago-os-current.json': 'a'.repeat(64) }, rulesSha256: '' }, methodProjectionSha256: '',
    methodAttestation: { schema: 'qingmu.imago-stage-source-method-attestation.v1', algorithm: 'hmac-sha256',
      subjectSnapshotSha256: '', methodProjectionSha256: '', signature: '' } }
  sign(request)
  return request
}
function result(request = fixture()): YimengStageSourceResult {
  const old = stageSourceResult(structuredClone(request.methodProjection.subject), request.expectedBindingRevision + 1)
  const binding = { ...old.binding, methodProjectionSha256: request.methodProjectionSha256,
    rulesSha256: request.methodProjection.rulesSha256, definition: structuredClone(request.methodProjection.definition),
    authSessionId: createHash('sha256').update(TOKEN).digest('hex') }
  return { ...old, binding, bindingSha256: sourceSha(binding) }
}
function recoveryRequest(request = fixture()): YimengRecoverStageSourceBindingRequest {
  return { projectId: request.projectId, episodeId: request.episodeId, stageId: request.stageId,
    expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey }
}
function network(value: unknown, status = 200) { return vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status })) }
function handler(fetch: typeof globalThis.fetch, readToken = () => TOKEN) { return createYimengCommandHandler({}, { fetch, readToken }) }
beforeEach(() => { vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', KEY) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('stage source explicit registration and original receipt', () => {
  it.each([
    ['source-🎬-001', false], ['source-\u0001-001', false], ['!'.repeat(7), false], ['~'.repeat(201), false],
    ['source x-001', false], [' source-001', false], ['source-001 ', false], ['source-\u007f-001', false],
    ['source-\t-001', false], ['source-\u0085-001', false], ['source-\ufeff-001', false], ['source-\r\n-001', false],
    ['!'.repeat(8), true], ['~'.repeat(200), true],
  ] as const)('enforces a recoverable visible-ASCII key %j with native HTTP transport', async (idempotencyKey, allowed) => {
    const request = { ...fixture(), idempotencyKey }
    const receipt = result(request)
    const calls: string[] = []
    let postBody: unknown
    let recoveryKey: unknown
    const server = createServer((incoming, response) => {
      calls.push(incoming.method ?? '')
      incoming.setEncoding('utf8')
      let body = ''
      incoming.on('data', (chunk: string) => { body += chunk })
      incoming.on('end', () => {
        if (incoming.method === 'POST') postBody = JSON.parse(body) as unknown
        else recoveryKey = incoming.headers['idempotency-key']
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(incoming.method === 'POST' ? receipt : {
          schema: 'jason.qingmu-stage-source-recovery.v1', receipt,
        }))
      })
    })
    try {
      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('local fixture port required')
      const command = createYimengCommandHandler({ baseUrl: `http://127.0.0.1:${String(address.port)}` }, {
        fetch: globalThis.fetch, readToken: () => TOKEN,
      })
      const post = await command('bindStageSource', request, signal())
      const recovered = await command('recoverStageSourceBinding', recoveryRequest(request), signal())
      if (allowed) {
        expect(post).toEqual({ ok: true, value: receipt })
        expect(recovered).toEqual({ ok: true, value: { schema: 'jason.qingmu-stage-source-recovery.v1', receipt } })
        expect(calls).toEqual(['POST', 'GET'])
        expect(sourceObject(postBody).idempotencyKey).toBe(idempotencyKey)
        expect(recoveryKey).toBe(idempotencyKey)
      } else {
        expect({ post, recovered, calls }).toMatchObject({
          post: { ok: false, error: { code: 'bad-request' } },
          recovered: { ok: false, error: { code: 'bad-request' } }, calls: [],
        })
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
        server.closeAllConnections()
      })
    }
  })
  it.each([201, 200])('sends one exact seven-field POST for status %s', async (status) => {
    const request = fixture()
    const expected = result(request)
    const fetch = network(expected, status)
    expect(await handler(fetch)('bindStageSource', request, signal())).toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://127.0.0.1:8115/api/qingmu/projects/source-project/episodes/source-episode/stage-sources/A1S/binding')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    if (typeof init?.body !== 'string') throw new Error('POST body required')
    const { projectId: _p, episodeId: _e, stageId: _s, ...body } = request
    expect(JSON.parse(init.body)).toEqual(body)
    expect(init.body).not.toContain(TOKEN)
  })
  it('recovers the original receipt by GET with a new token and no current HMAC key or source read', async () => {
    const request = fixture()
    const expected = { schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result(request) }
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', '')
    const fetch = network(expected)
    expect(await handler(fetch, () => 'rotated-token')('recoverStageSourceBinding', recoveryRequest(request), signal()))
      .toEqual({ ok: true, value: expected })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(`http://127.0.0.1:8115/api/qingmu/projects/source-project/episodes/source-episode/stage-sources/A1S/binding/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey)
  })
  it('supports source revision zero, maximum safe revisions, explicit CAS and FEFF IDs unchanged', async () => {
    const request = fixture()
    mutateSource(request, 'episodeId', '\ufeff🎬/集')
    mutateSource(request, 'methodProjection.subject.episodeId', request.episodeId)
    mutateSource(request, 'methodProjection.subject.sourceId', request.episodeId)
    mutateSource(request, 'methodProjection.subject.revision', 0)
    mutateSource(request, 'expectedBindingRevision', Number.MAX_SAFE_INTEGER - 1)
    mutateSource(request, 'expectedBindingSha256', 'f'.repeat(64))
    sign(request)
    const fetch = network(result(request))
    expect(await handler(fetch)('bindStageSource', request, signal())).toMatchObject({ ok: true })
    expect(fetch.mock.calls[0]?.[0]).toContain(encodeURIComponent(request.episodeId))
  })
  it.each([401, 403, 404, 409, 422, 500, 503])('does not retry or fabricate missing receipts for HTTP %s', async (status) => {
    const fetch = network({ detail: { code: 'command_receipt_not_found' } }, status)
    expect(await handler(fetch)('recoverStageSourceBinding', recoveryRequest(), signal())).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('keeps a lost POST unknown and redacts secrets without retry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(TOKEN) })
    const reply = await handler(fetch)('bindStageSource', fixture(), signal())
    expect(reply).toMatchObject({ ok: false })
    expect(JSON.stringify(reply)).not.toContain(TOKEN)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['', 'short'])('fails closed for unavailable method key %s', async (key) => {
    const request = fixture()
    vi.stubEnv('QINGMU_IMAGO_ATTESTATION_KEY', key)
    const fetch = network(result(request))
    expect(await handler(fetch)('bindStageSource', request, signal())).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires token and supports pre-cancellation with no fetch', async () => {
    const fetch = network(result())
    expect(await handler(fetch, () => '')('bindStageSource', fixture(), signal())).toMatchObject({ ok: false })
    const abort = new AbortController(); abort.abort()
    expect(await handler(fetch)('bindStageSource', fixture(), abort.signal)).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('source command fails closed before transport', () => {
  const cases: [string, unknown, boolean?][] = [
    ['actorId', 'browser'], ['authSessionId', 'f'.repeat(64)], ['stageId', 'A1'], ['source', {}],
    ['projectId', '\u0085project'], ['episodeId', 'episode\u001c'], ['episodeId', '\ud800'], ['episodeId', '🎬'.repeat(257)],
    ['expectedBindingRevision', true], ['expectedBindingRevision', -1], ['expectedBindingRevision', 0.5],
    ['expectedBindingRevision', Number.MAX_SAFE_INTEGER], ['expectedBindingRevision', 1], ['expectedBindingSha256', 'f'.repeat(64)],
    ['idempotencyKey', 'short'], ['idempotencyKey', 'x'.repeat(201)], ['expectedSubjectSha256', 'f'.repeat(64)],
    ['methodProjectionSha256', 'f'.repeat(64)], ['methodAttestation.signature', '0'.repeat(64)], ['methodAttestation.algorithm', 'none'],
    ['methodAttestation.extra', true], ['methodProjection.schema', 'other', true], ['methodProjection.extra', true, true],
    ['methodProjection.subject.projectId', 'other', true], ['methodProjection.subject.sourceId', 'other', true],
    ['methodProjection.subject.revision', true, true], ['methodProjection.subject.revision', -1, true],
    ['methodProjection.subject.revision', Number.MAX_SAFE_INTEGER + 1, true], ['methodProjection.subject.sourceType', 'artifact', true],
    ['methodProjection.subject.extra', true, true], ['methodProjection.subject.contentSha256', 'a'.repeat(64) + '\n', true],
    ['methodProjection.definition.id', 'other', true], ['methodProjection.definition.scope', 'per_lsu', true],
    ['methodProjection.definition.sourceUsage', 'artifact', true], ['methodProjection.definition.operation', 'execute', true],
    ['methodProjection.definition.stageArtifactCreationAllowed', true, true], ['methodProjection.definition.stageApprovalAllowed', true, true],
    ['methodProjection.definition.providerCalls', true, true], ['methodProjection.definition.roleId', 'A1', true],
    ['methodProjection.ruleBindings', {}, true], ['methodProjection.ruleBindings', { '../file': 'a'.repeat(64) }, true],
    ['methodProjection.ruleBindings', { '/file': 'a'.repeat(64) }, true], ['methodProjection.rulesSha256', 'f'.repeat(64)],
  ]
  it.each(cases)('rejects %s even with a recomputed signature where specified', async (path, value, resign) => {
    const request = fixture()
    mutateSource(request, path, value)
    if (resign) sign(request)
    const fetch = network(result())
    expect(await handler(fetch)('bindStageSource', request, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('source receipt binding and authority', () => {
  it.each([
    ['schema', 'other'], ['binding.projectId', 'other'], ['binding.episodeId', 'other'], ['binding.stageId', 'A1'],
    ['binding.subjectSnapshotSha256', 'f'.repeat(64)], ['binding.source.contentSha256', 'f'.repeat(64)],
    ['binding.bindingRevision', 2], ['binding.methodProjectionSha256', 'f'.repeat(64)], ['binding.rulesSha256', 'f'.repeat(64)],
    ['binding.definition.version', 'other'], ['binding.definition.stageApprovalAllowed', true], ['binding.authSessionId', 'f'.repeat(64)],
    ['binding.createdAt', 'not-a-date'], ['binding.stageArtifactCreated', true], ['binding.stageApprovalGranted', true],
    ['binding.lockActivated', true], ['binding.planSealed', true], ['binding.providerCalls', true], ['binding.humanSignoffInferred', true],
    ['binding.reworkExecuted', true], ['receiptId', ''], ['outboxEventId', '\ud800'], ['bindingSha256', 'f'.repeat(64)], ['extra', true],
  ] as const)('refuses receipt %s and does not retry', async (path, value) => {
    const request = fixture()
    const reply = result(request)
    mutateSource(reply, path, value)
    if (path.startsWith('binding.')) mutateSource(reply, 'bindingSha256', sourceSha(reply.binding))
    const fetch = network(reply)
    expect(await handler(fetch)('bindStageSource', request, signal())).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([{ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: null },
    { schema: 'jason.qingmu-stage-source-recovery.v1', found: false, result: null },
    { schema: 'other', receipt: result() },
  ])('does not accept invented not-found wrappers %#', async (reply) => {
    expect(await handler(network(reply))('recoverStageSourceBinding', recoveryRequest(), signal())).toMatchObject({ ok: false })
  })
  it('rejects an old receipt from another subject even though its own SHA is valid', async () => {
    const request = fixture()
    mutateSource(request, 'methodProjection.subject.revision', 4)
    sign(request)
    expect(await handler(network({ schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result() }))(
      'recoverStageSourceBinding', recoveryRequest(request), signal())).toMatchObject({ ok: false })
  })
})
