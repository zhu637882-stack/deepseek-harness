/** Existing candidate whose saved generation records are being inspected. */
export interface LocalVideoSourceScope {
  readonly projectId: string
  readonly episodeId: string
  readonly frameId: string
  readonly assetId: string
}
/** Exact current shot and original upload receipt, supplied by Writer. */
export interface LocalVideoSourceBinding extends LocalVideoSourceScope {
  readonly takeId: string
  readonly assetSha256: string
  readonly uploadReceiptSha256: string
  readonly uploadRequestSha256: string
  readonly frameContentSha256: string
  readonly storyboardRevision: number
}
/** Original saved JSON bytes and their byte digest. */
export interface LocalVideoSourceRecord {
  readonly sha256: string
  readonly contentBase64: string
}
/** Saved external evidence only; importing it does not query or authenticate a Provider. */
export interface LocalVideoSourcePacket {
  readonly schema: 'jason.qingmu-external-video-records.v1'
  readonly recordFormat: 'alibaba_saved' | 'libtv_saved'
  readonly inputRecord: LocalVideoSourceRecord
  readonly resultRecord: LocalVideoSourceRecord
  readonly mediaRecord: LocalVideoSourceRecord
}
/** One deliberate registration against the current shot binding. */
export interface LocalVideoSourceRequest extends LocalVideoSourceScope {
  readonly idempotencyKey: string
  readonly binding: LocalVideoSourceBinding
  readonly packet: LocalVideoSourcePacket
}
/** Lost registration responses recover by digest, without resending files. */
export interface LocalVideoSourceRecoveryRequest extends LocalVideoSourceScope {
  readonly idempotencyKey: string
  readonly requestSha256: string
}
/** Registration never selects a take or changes creative approval. */
export interface LocalVideoSourceFlags {
  readonly providerCalls: 0
  readonly selectionChanged: false
  readonly formalApprovalChanged: false
}
/** Immutable saved-record receipt. Registered identity is not a producer identity. */
export interface LocalVideoSourceReceipt extends LocalVideoSourceFlags {
  readonly schema: 'jason.qingmu-local-video-source-registration.v1'
  readonly idempotencyKey: string
  readonly registeredBy: string
  readonly registrationId: string
  readonly binding: LocalVideoSourceBinding
  readonly requestSha256: string
  readonly packetSha256: string
  readonly recordFormat: 'alibaba_saved' | 'libtv_saved'
  readonly provider: 'alibaba' | 'libtv'
  readonly model: string
  readonly providerTaskId: string
  readonly savedProviderStatus: string
  readonly inputEvidenceSha256: string
  readonly resultEvidenceSha256: string
  readonly mediaEvidenceSha256: string
  readonly evidenceMode: 'imported_saved_records'
  readonly recordConsistencyVerified: false
  readonly providerExecutionVerified: false
}
/** A historical success can be recovered even after the shot has changed. */
export interface LocalVideoSourceResult extends LocalVideoSourceFlags {
  readonly schema: 'jason.qingmu-local-video-source-result.v1'
  readonly receipt: LocalVideoSourceReceipt
  readonly bindingStatus: 'current' | 'stale'
  readonly evidenceMode: 'imported_saved_records'
  readonly recordConsistencyVerified: false
  readonly providerExecutionVerified: false
}
/** Source status is separate from selection, quality checks and human acceptance. */
export interface LocalVideoSourceState extends LocalVideoSourceFlags {
  readonly schema: 'jason.qingmu-local-video-source-state.v1'
  readonly binding: LocalVideoSourceBinding
  readonly registrationCount: number
  readonly latestRegistration: LocalVideoSourceReceipt | null
  readonly bindingStatus: 'unregistered' | 'current' | 'stale'
  readonly canRegister: boolean
}
