/** Route saved external video evidence to Writer without querying a Provider. */
import { createHash } from 'node:crypto'
import type { YimengCommandJsonObject } from './types.ts'
import type { LocalVideoSourceState, LocalVideoSourceResult } from './local-video-source-types.ts'

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
}
type ObjectValue = Record<string, unknown>
type Fail = (message: string) => Error
const scopeKeys = ['projectId', 'episodeId', 'frameId', 'assetId'] as const
const bindingKeys = [...scopeKeys, 'takeId', 'assetSha256', 'uploadReceiptSha256', 'uploadRequestSha256', 'frameContentSha256', 'storyboardRevision']
const flags = { providerCalls: 0, selectionChanged: false, formalApprovalChanged: false }
const evidence = { ...flags, evidenceMode: 'imported_saved_records', recordConsistencyVerified: false, providerExecutionVerified: false }
const receiptKeys = ['schema', 'idempotencyKey', 'registeredBy', 'registrationId', 'binding', 'requestSha256', 'packetSha256', 'recordFormat', 'provider', 'model', 'providerTaskId', 'savedProviderStatus', 'inputEvidenceSha256', 'resultEvidenceSha256', 'mediaEvidenceSha256', ...Object.keys(evidence)]
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex')
function object(v: unknown, fail: Fail): ObjectValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail('local video source object invalid')
  return v as ObjectValue
}
function exact(v: ObjectValue, keys: readonly string[], fail: Fail): void {
  if (Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) throw fail('local video source fields invalid')
}
function text(v: unknown, fail: Fail): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 256 || /[\u0000-\u001f]/u.test(v)) throw fail('local video source text invalid')
  return v
}
function sha(v: unknown, fail: Fail): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/u.test(v)) throw fail('local video source digest invalid')
  return v
}
function key(v: unknown, fail: Fail): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/u.test(v)) throw fail('local video source key invalid')
  return v
}
function match(v: ObjectValue, expected: ObjectValue, fail: Fail): void {
  if (Object.entries(expected).some(([k, value]) => v[k] !== value)) throw fail('local video source receipt changed')
}
/** Validate untrusted request/response scopes and immutable evidence digests.
 * @param endpoint - Source status, registration, or receipt recovery operation.
 * @param payload - Client JSON; evidence is accepted only by registration.
 * @param helpers - Adapter errors and the canonical JSON implementation shared with Writer.
 * @returns A single authenticated Writer request and response validator.
 */
export function prepareLocalVideoSource(endpoint: string, payload: unknown, helpers: Helpers) {
  const { inputError: input, responseError: response, canonicalJson } = helpers
  const canonical = (v: unknown) => canonicalJson(v, 'localVideoSource')
  const p = object(payload, input)
  const scope: ObjectValue = {}
  for (const name of scopeKeys) {
    const value = text(p[name], input)
    if (!/^[A-Za-z0-9_.-]+$/u.test(value) || value === '.' || value === '..') throw input('local video source scope invalid')
    scope[name] = value
  }
  const binding = (v: unknown, fail: Fail): ObjectValue => {
    const b = object(v, fail); exact(b, bindingKeys, fail)
    match(b, { ...scope, takeId: scope.assetId }, fail)
    for (const name of bindingKeys.filter(k => k.endsWith('Sha256'))) sha(b[name], fail)
    if (typeof b.storyboardRevision !== 'number' || !Number.isSafeInteger(b.storyboardRevision) || b.storyboardRevision < 0) throw fail('local video source revision invalid')
    return b
  }
  let requestSha: string | undefined
  let packetSha: string | undefined
  let packet: ObjectValue | undefined
  if (endpoint === 'readLocalVideoSource') {
    exact(p, scopeKeys, input)
  } else if (endpoint === 'recoverLocalVideoSource') {
    exact(p, [...scopeKeys, 'idempotencyKey', 'requestSha256'], input)
    key(p.idempotencyKey, input); requestSha = sha(p.requestSha256, input)
  } else if (endpoint === 'registerLocalVideoSource') {
    exact(p, [...scopeKeys, 'idempotencyKey', 'binding', 'packet'], input)
    key(p.idempotencyKey, input); binding(p.binding, input)
    packet = object(p.packet, input)
    exact(packet, ['schema', 'recordFormat', 'inputRecord', 'resultRecord', 'mediaRecord'], input)
    if (packet.schema !== 'jason.qingmu-external-video-records.v1' || !['alibaba_saved', 'libtv_saved'].includes(String(packet.recordFormat))) throw input('local video source packet invalid')
    for (const name of ['inputRecord', 'resultRecord', 'mediaRecord']) {
      const record = object(packet[name], input); exact(record, ['sha256', 'contentBase64'], input)
      sha(record.sha256, input)
      if (typeof record.contentBase64 !== 'string' || record.contentBase64.length > 349528) throw input('local video source record too large')
      const raw = Buffer.from(record.contentBase64, 'base64')
      if (!raw.length || raw.length > 256 * 1024 || raw.toString('base64') !== record.contentBase64 || hash(raw) !== record.sha256) throw input('local video source record digest mismatch')
    }
    requestSha = hash(canonical({ binding: p.binding, packet })); packetSha = hash(canonical(packet))
  } else throw input('local video source operation invalid')
  const receipt = (value: unknown): ObjectValue => {
    const r = object(value, response); exact(r, receiptKeys, response)
    match(r, { schema: 'jason.qingmu-local-video-source-registration.v1', ...evidence }, response)
    const b = binding(r.binding, response)
    key(r.idempotencyKey, response); text(r.registeredBy, response)
    for (const name of ['model', 'providerTaskId', 'savedProviderStatus']) text(r[name], response)
    for (const name of ['requestSha256', 'packetSha256', 'inputEvidenceSha256', 'resultEvidenceSha256', 'mediaEvidenceSha256']) sha(r[name], response)
    if (!['alibaba_saved', 'libtv_saved'].includes(String(r.recordFormat)) || r.provider !== (r.recordFormat === 'alibaba_saved' ? 'alibaba' : 'libtv')) throw response('local video source provider changed')
    if (r.registrationId !== `source_${hash(canonical([r.registeredBy, r.idempotencyKey, b.assetId, b.uploadReceiptSha256])).slice(0,32)}`) throw response('local video source identity changed')
    return r
  }
  const normalize = (value: unknown): LocalVideoSourceState | LocalVideoSourceResult => {
    const r = object(value, response)
    if (endpoint === 'readLocalVideoSource') {
      exact(r, ['schema', 'binding', 'registrationCount', 'latestRegistration', 'bindingStatus', 'canRegister', ...Object.keys(flags)], response)
      match(r, { schema: 'jason.qingmu-local-video-source-state.v1', ...flags }, response)
      const current = binding(r.binding, response)
      if (typeof r.registrationCount !== 'number' || !Number.isInteger(r.registrationCount) || r.registrationCount < 0 || r.registrationCount > 8 || typeof r.canRegister !== 'boolean') throw response('local video source state invalid')
      if (r.latestRegistration === null) {
        if (r.registrationCount !== 0 || r.bindingStatus !== 'unregistered') throw response('local video source empty state invalid')
      } else {
        const latest = receipt(r.latestRegistration)
        const prior = object(latest.binding, response)
        for (const name of bindingKeys.filter(k => !['frameContentSha256', 'storyboardRevision'].includes(k))) match(prior, { [name]: current[name] }, response)
        const expectedStatus = canonical(prior) === canonical(current) ? 'current' : 'stale'
        if (r.registrationCount < 1 || r.bindingStatus !== expectedStatus) throw response('local video source current binding changed')
      }
      return r as unknown as LocalVideoSourceState
    }
    exact(r, ['schema', 'receipt', 'bindingStatus', ...Object.keys(evidence)], response)
    match(r, { schema: 'jason.qingmu-local-video-source-result.v1', ...evidence }, response)
    if (r.bindingStatus !== 'current' && r.bindingStatus !== 'stale') throw response('local video source status invalid')
    const saved = receipt(r.receipt)
    match(saved, { idempotencyKey: p.idempotencyKey, requestSha256: requestSha }, response)
    if (packet !== undefined) {
      match(saved, { packetSha256: packetSha, recordFormat: packet.recordFormat,
        inputEvidenceSha256: object(packet.inputRecord, input).sha256,
        resultEvidenceSha256: object(packet.resultRecord, input).sha256,
        mediaEvidenceSha256: object(packet.mediaRecord, input).sha256 }, response)
      if (canonical(saved.binding) !== canonical(p.binding)) throw response('local video source upload binding changed')
    }
    return r as unknown as LocalVideoSourceResult
  }
  const path = `/api/qingmu/projects/${encodeURIComponent(String(scope.projectId))}/episodes/${encodeURIComponent(String(scope.episodeId))}/frames/${encodeURIComponent(String(scope.frameId))}/local-video-candidates/${encodeURIComponent(String(scope.assetId))}/source`
  if (endpoint === 'registerLocalVideoSource') return { method: 'POST' as const, path,
    body: { idempotencyKey: p.idempotencyKey, binding: p.binding, packet: p.packet } as YimengCommandJsonObject, normalize }
  return { method: 'GET' as const, path: endpoint === 'readLocalVideoSource' ? path
    : `${path}/receipt?idempotencyKey=${encodeURIComponent(String(p.idempotencyKey))}&requestSha256=${requestSha}`, normalize }
}
