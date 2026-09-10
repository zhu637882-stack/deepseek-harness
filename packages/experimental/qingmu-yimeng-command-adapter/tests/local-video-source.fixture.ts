import { createHash } from 'node:crypto'
/** Fixture-only canonical JSON for saved-record byte digests. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}
export const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex')
export function sourceFixture() {
  const scope = { projectId: 'p', episodeId: 'e', frameId: 'f', assetId: `asset_localvideo_${'a'.repeat(32)}` }
  const binding = { ...scope, takeId: scope.assetId, assetSha256: 'b'.repeat(64), uploadReceiptSha256: 'c'.repeat(64), uploadRequestSha256: 'd'.repeat(64), frameContentSha256: 'e'.repeat(64), storyboardRevision: 2 }
  const record = (v: unknown) => { const raw = canonical(v); return { sha256: hash(raw), contentBase64: Buffer.from(raw).toString('base64') } }
  const packet = { schema: 'jason.qingmu-external-video-records.v1' as const, recordFormat: 'alibaba_saved' as const,
    inputRecord: record({ model: 'wan-test', prompt: 'saved input' }), resultRecord: record({ response: { output: { task_id: 'task-saved', task_status: 'SUCCEEDED', video_url: 'https://example.invalid/video.mp4' } } }), mediaRecord: record({ task_id: 'task-saved', sha256: binding.assetSha256 }) }
  const request = { ...scope, binding, packet, idempotencyKey: 'source-fixture-1' }
  const flags = { providerCalls: 0 as const, selectionChanged: false as const, formalApprovalChanged: false as const }
  const evidence = { ...flags, evidenceMode: 'imported_saved_records' as const, recordConsistencyVerified: false as const, providerExecutionVerified: false as const }
  const receipt = { schema: 'jason.qingmu-local-video-source-registration.v1' as const, ...evidence, binding,
    idempotencyKey: request.idempotencyKey, registeredBy: 'fixture-owner', registrationId: `source_${hash(canonical(['fixture-owner', request.idempotencyKey, scope.assetId, binding.uploadReceiptSha256])).slice(0,32)}`,
    requestSha256: hash(canonical({ binding, packet })), packetSha256: hash(canonical(packet)), recordFormat: packet.recordFormat, provider: 'alibaba' as const,
    model: 'wan-test', providerTaskId: 'task-saved', savedProviderStatus: 'SUCCEEDED', inputEvidenceSha256: packet.inputRecord.sha256, resultEvidenceSha256: packet.resultRecord.sha256, mediaEvidenceSha256: packet.mediaRecord.sha256 }
  const result = { schema: 'jason.qingmu-local-video-source-result.v1' as const, receipt, bindingStatus: 'current' as const, ...evidence }
  const state = { schema: 'jason.qingmu-local-video-source-state.v1' as const, binding, registrationCount: 1, latestRegistration: receipt, bindingStatus: 'current' as const, canRegister: true, ...flags }
  const recovery = { ...scope, idempotencyKey: request.idempotencyKey, requestSha256: receipt.requestSha256 }
  return { scope, binding, packet, request, receipt, result, state, recovery }
}
