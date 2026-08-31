/** Strict local image candidate transport; never selects, approves or records rights. */
import { createHash } from 'node:crypto'
import type { YimengCommandJsonObject } from './types.ts'

/** An existing project entity kind that may own a local reference candidate. */
export type LocalReferenceElementKind = 'actor' | 'scene' | 'prop'
/** Exact project and entity scope for every candidate operation. */
export interface LocalReferenceScope {
  readonly projectId: string
  readonly elementKind: LocalReferenceElementKind
  readonly targetId: string
}
/** Upload intent retained by the client until the command receipt is recovered. */
export interface LocalReferenceUploadRequest extends LocalReferenceScope {
  readonly idempotencyKey: string
  readonly originalFileName: string
  readonly contentBase64: string
  readonly sourceDeclaration: 'local_file_unverified'
}
/** Byte-read request bound to the expected persisted SHA-256. */
export interface LocalReferenceContentRequest extends LocalReferenceScope {
  readonly assetId: string
  readonly expectedSha256: string
}
/** Explicit local-integrity qualification intent bound to the current element snapshot. */
export interface LocalReferenceQualificationRequest extends LocalReferenceScope {
  readonly idempotencyKey: string
  readonly assetId: string
  readonly assetSha256: string
  readonly baseRevision: number
  readonly baseSnapshotSha256: string
}
/** Zero-Provider qualification receipt; it grants neither selection nor approval. */
export interface LocalReferenceQualificationResult extends LocalReferenceScope {
  readonly schema: 'jason.qingmu-local-reference-qualification-result.v1'
  readonly assetId: string
  readonly assetSha256: string
  readonly profileRevision: number
  readonly baseSnapshotSha256: string
  readonly elementSnapshotSha256: string
  readonly uploadCommandReceiptId: string
  readonly sourceRevisionId: string
  readonly qualificationKind: 'local_file_integrity'
  readonly qualificationCheckId: string
  readonly qualificationPassed: true
  readonly qualificationIdentity: string
  readonly rightsRecordSha256: string
  readonly rightsRecorded: true
  readonly rightsVerified: false
  readonly formalConsistencyPassed: false
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly commandReceiptId: string
  readonly changeSetId: string
  readonly eventId: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
  readonly selectionGranted: false
}
/** Fail-closed receipt or current projection for one unselected, unapproved local image candidate. */
export interface LocalReferenceCandidateResult extends LocalReferenceScope {
  readonly schema: 'jason.qingmu-local-reference-candidate-result.v1'
  readonly assetId: string
  readonly storageKey: string
  readonly profileRevision: number
  readonly baseSnapshotSha256: string
  readonly elementSnapshotSha256: string
  readonly originalFileName: string
  readonly byteSize: number
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly width: number
  readonly height: number
  readonly inputSha256: string
  readonly materializedSha256: string
  readonly sourceDeclaration: 'local_file_unverified'
  readonly rightsStatus: 'not_recorded' | 'recorded_unverified'
  readonly selectionStatus: 'Unselected'
  readonly isSelected: false
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly commandReceiptId: string
  readonly changeSetId: string
  readonly eventId: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
  readonly selectionGranted: false
  readonly rightsRecorded: boolean
}
/** Owner-scoped projection of existing candidates for one entity. */
export interface LocalReferenceCandidateList extends LocalReferenceScope {
  readonly schema: 'jason.qingmu-local-reference-candidates.v1'
  readonly candidates: readonly LocalReferenceCandidateResult[]
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
  readonly selectionGranted: false
  readonly rightsRecorded: false
}
/** Verified candidate bytes returned without exposing an absolute storage path. */
export interface LocalReferenceCandidateContent {
  readonly schema: 'jason.qingmu-local-reference-candidate-content.v1'
  readonly assetId: string
  readonly sha256: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly contentBase64: string
}

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
}
const MAX_BYTES = 3 * 1024 * 1024
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4
function object(value: unknown, fail: (message: string) => Error): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail('local reference object required')
  return value as Record<string, unknown>
}
function text(value: unknown, fail: (message: string) => Error, max = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw fail('local reference text invalid')
  return value
}
function id(value: unknown, fail: (message: string) => Error): string {
  const result = text(value, fail)
  if (!/^[A-Za-z0-9_.-]+$/.test(result)) throw fail('local reference identity invalid')
  return result
}
function digest(value: unknown, fail: (message: string) => Error): string {
  const result = text(value, fail, 64)
  if (!/^[a-f0-9]{64}$/.test(result)) throw fail('local reference SHA invalid')
  return result
}
function strictBase64(value: unknown, fail: (message: string) => Error): Buffer {
  const encoded = text(value, fail, MAX_BASE64)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw fail('local reference base64 invalid')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 1 || bytes.length > MAX_BYTES || bytes.toString('base64') !== encoded) throw fail('local reference bytes invalid')
  return bytes
}
function scope(raw: Record<string, unknown>, fail: (message: string) => Error): LocalReferenceScope {
  const elementKind = text(raw.elementKind, fail, 5)
  if (!['actor', 'scene', 'prop'].includes(elementKind)) throw fail('local reference element kind invalid')
  return { projectId: id(raw.projectId, fail), elementKind: elementKind as LocalReferenceElementKind, targetId: id(raw.targetId, fail) }
}
function flags(raw: Record<string, unknown>, fail: (message: string) => Error, allowRecordedRights = false): void {
  if (raw.providerCalls !== 0 || raw.stageStarted !== false || raw.approvalGranted !== false
    || raw.selectionGranted !== false
    || (allowRecordedRights ? typeof raw.rightsRecorded !== 'boolean' : raw.rightsRecorded !== false)) {
    throw fail('local reference authority mismatch')
  }
}
function normalizeResult(
  value: unknown,
  expected: LocalReferenceScope,
  fail: (message: string) => Error,
  allowRecordedRights = false,
): LocalReferenceCandidateResult {
  const raw = object(value, fail)
  if (raw.schema !== 'jason.qingmu-local-reference-candidate-result.v1') throw fail('local reference result schema invalid')
  flags(raw, fail, allowRecordedRights)
  const actual = scope(raw, fail)
  if (actual.projectId !== expected.projectId || actual.elementKind !== expected.elementKind || actual.targetId !== expected.targetId) throw fail('local reference result scope mismatch')
  for (const field of ['assetId', 'commandReceiptId', 'changeSetId', 'eventId']) id(raw[field], fail)
  for (const field of ['baseSnapshotSha256', 'elementSnapshotSha256', 'inputSha256', 'materializedSha256', 'requestSha256']) digest(raw[field], fail)
  if (raw.inputSha256 !== raw.materializedSha256) throw fail('local reference materialization mismatch')
  if (typeof raw.profileRevision !== 'number' || !Number.isSafeInteger(raw.profileRevision) || raw.profileRevision < 1) throw fail('local reference revision invalid')
  if (typeof raw.byteSize !== 'number' || !Number.isSafeInteger(raw.byteSize) || raw.byteSize < 1 || raw.byteSize > MAX_BYTES) throw fail('local reference size invalid')
  for (const field of ['width', 'height']) {
    if (typeof raw[field] !== 'number' || !Number.isSafeInteger(raw[field]) || raw[field] < 1 || raw[field] > 8192) {
      throw fail('local reference dimensions invalid')
    }
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(raw.mimeType))) throw fail('local reference MIME invalid')
  const filename = text(raw.originalFileName, fail, 128)
  if (filename.trim() !== filename || /[\\/]/.test(filename)) throw fail('local reference filename invalid')
  const storageKey = text(raw.storageKey, fail, 512)
  if (storageKey.startsWith('/') || storageKey.includes('..') || storageKey.includes('\\')) throw fail('local reference storage key invalid')
  const rightsStateValid = raw.rightsRecorded === true
    ? raw.rightsStatus === 'recorded_unverified'
    : raw.rightsStatus === 'not_recorded'
  if (raw.sourceDeclaration !== 'local_file_unverified' || !rightsStateValid
    || raw.selectionStatus !== 'Unselected' || raw.isSelected !== false) throw fail('local reference state invalid')
  text(raw.idempotencyKey, fail, 128)
  return raw as unknown as LocalReferenceCandidateResult
}

function normalizeQualificationResult(
  value: unknown,
  expected: LocalReferenceQualificationRequest,
  requestSha256: string,
  fail: (message: string) => Error,
): LocalReferenceQualificationResult {
  const raw = object(value, fail)
  const exactKeys = [
    'approvalGranted', 'assetId', 'assetSha256', 'baseSnapshotSha256', 'changeSetId',
    'commandReceiptId', 'elementKind', 'elementSnapshotSha256', 'eventId',
    'formalConsistencyPassed', 'idempotencyKey', 'isSelected', 'profileRevision',
    'projectId', 'providerCalls', 'qualificationCheckId', 'qualificationIdentity',
    'qualificationKind', 'qualificationPassed', 'requestSha256', 'rightsRecorded',
    'rightsRecordSha256', 'rightsVerified', 'schema', 'selectionGranted',
    'selectionStatus', 'sourceRevisionId', 'stageStarted', 'targetId',
    'uploadCommandReceiptId',
  ].sort()
  if (Object.keys(raw).sort().join() !== exactKeys.join()) {
    throw fail('local reference qualification result fields invalid')
  }
  if (raw.schema !== 'jason.qingmu-local-reference-qualification-result.v1') throw fail('local reference qualification schema invalid')
  const actual = scope(raw, fail)
  if (actual.projectId !== expected.projectId || actual.elementKind !== expected.elementKind || actual.targetId !== expected.targetId) throw fail('local reference qualification scope mismatch')
  for (const field of ['assetId', 'uploadCommandReceiptId', 'sourceRevisionId', 'qualificationCheckId', 'commandReceiptId', 'changeSetId', 'eventId']) id(raw[field], fail)
  for (const field of ['assetSha256', 'baseSnapshotSha256', 'elementSnapshotSha256', 'qualificationIdentity', 'rightsRecordSha256', 'requestSha256']) digest(raw[field], fail)
  if (raw.assetId !== expected.assetId || raw.assetSha256 !== expected.assetSha256
    || raw.baseSnapshotSha256 !== expected.baseSnapshotSha256
    || raw.idempotencyKey !== expected.idempotencyKey || raw.requestSha256 !== requestSha256) {
    throw fail('local reference qualification receipt mismatch')
  }
  if (typeof raw.profileRevision !== 'number' || !Number.isSafeInteger(raw.profileRevision)
    || raw.profileRevision <= expected.baseRevision) throw fail('local reference qualification revision invalid')
  if (raw.qualificationKind !== 'local_file_integrity' || raw.qualificationPassed !== true
    || raw.rightsRecorded !== true || raw.rightsVerified !== false
    || raw.formalConsistencyPassed !== false || raw.selectionStatus !== 'Unselected'
    || raw.isSelected !== false || raw.providerCalls !== 0 || raw.stageStarted !== false
    || raw.approvalGranted !== false || raw.selectionGranted !== false) {
    throw fail('local reference qualification authority mismatch')
  }
  return raw as unknown as LocalReferenceQualificationResult
}

/**
 * Build one allowlisted local candidate request and validate the fail-closed response.
 * @param endpoint - Exact Host RPC operation selected by the caller.
 * @param value - Untrusted RPC request payload.
 * @param helpers - Shared validation, canonicalization, and error constructors.
 * @returns A narrow FastAPI request description with a strict response normalizer.
 */
export function prepareLocalReferenceCandidate(endpoint: string, value: unknown, helpers: Helpers): {
  path: string
  method: 'GET' | 'POST'
  body?: YimengCommandJsonObject
  normalize: (value: unknown) => unknown
} {
  const input = helpers.inputError, response = helpers.responseError
  const raw = object(value, input), expected = scope(raw, input)
  const prefix = `/api/qingmu/projects/${encodeURIComponent(expected.projectId)}/elements/${expected.elementKind}/${encodeURIComponent(expected.targetId)}/local-reference-candidates`
  if (endpoint === 'listLocalReferenceCandidates') {
    if (Object.keys(raw).sort().join() !== ['elementKind', 'projectId', 'targetId'].join()) throw input('local reference list fields invalid')
    return { path: prefix, method: 'GET', normalize: (value) => {
      const result = object(value, response)
      if (result.schema !== 'jason.qingmu-local-reference-candidates.v1') throw response('local reference list schema invalid')
      flags(result, response)
      const actual = scope(result, response)
      if (actual.projectId !== expected.projectId || actual.elementKind !== expected.elementKind || actual.targetId !== expected.targetId) throw response('local reference list scope mismatch')
      if (!Array.isArray(result.candidates) || result.candidates.length > 100) throw response('local reference candidate list invalid')
      return { ...result, candidates: result.candidates.map(item => normalizeResult(item, expected, response, true)) }
    } }
  }
  if (endpoint === 'readLocalReferenceCandidateContent') {
    if (Object.keys(raw).sort().join() !== ['assetId', 'elementKind', 'expectedSha256', 'projectId', 'targetId'].join()) throw input('local reference content fields invalid')
    const assetId = id(raw.assetId, input), expectedSha256 = digest(raw.expectedSha256, input)
    const path = `${prefix}/${encodeURIComponent(assetId)}/content?${new URLSearchParams({ expectedSha256 }).toString()}`
    return { path, method: 'GET', normalize: (value) => {
      const result = object(value, response)
      if (result.schema !== 'jason.qingmu-local-reference-candidate-content.v1' || result.assetId !== assetId || result.sha256 !== expectedSha256) throw response('local reference content identity mismatch')
      const bytes = strictBase64(result.contentBase64, response)
      if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw response('local reference content SHA mismatch')
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(result.mimeType))) throw response('local reference content MIME invalid')
      return result
    } }
  }
  if (['qualifyLocalReferenceCandidate', 'recoverLocalReferenceQualification'].includes(endpoint)) {
    if (Object.keys(raw).sort().join() !== ['assetId', 'assetSha256', 'baseRevision', 'baseSnapshotSha256', 'elementKind', 'idempotencyKey', 'projectId', 'targetId'].join()) throw input('local reference qualification fields invalid')
    const qualification = {
      ...expected,
      assetId: id(raw.assetId, input),
      assetSha256: digest(raw.assetSha256, input),
      baseRevision: raw.baseRevision,
      baseSnapshotSha256: digest(raw.baseSnapshotSha256, input),
      idempotencyKey: text(raw.idempotencyKey, input, 128),
    }
    if (typeof qualification.baseRevision !== 'number' || !Number.isSafeInteger(qualification.baseRevision)
      || qualification.baseRevision < 0 || !/^[A-Za-z0-9._:-]{8,128}$/.test(qualification.idempotencyKey)) {
      throw input('local reference qualification intent invalid')
    }
    const identity = {
      projectId: qualification.projectId,
      elementKind: qualification.elementKind,
      targetId: qualification.targetId,
      assetId: qualification.assetId,
      assetSha256: qualification.assetSha256,
      baseRevision: qualification.baseRevision,
      baseSnapshotSha256: qualification.baseSnapshotSha256,
    }
    const requestSha256 = createHash('sha256').update(helpers.canonicalJson(identity, 'local reference qualification identity')).digest('hex')
    const recover = endpoint === 'recoverLocalReferenceQualification'
    const suffix = `/${encodeURIComponent(qualification.assetId)}/qualification`
    const path = recover
      ? `${prefix}${suffix}/receipt?${new URLSearchParams({ idempotencyKey: qualification.idempotencyKey, requestSha256 }).toString()}`
      : `${prefix}${suffix}`
    const body = recover ? undefined : {
      idempotencyKey: qualification.idempotencyKey,
      assetSha256: qualification.assetSha256,
      baseRevision: qualification.baseRevision,
      baseSnapshotSha256: qualification.baseSnapshotSha256,
    }
    return {
      path,
      method: recover ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body }),
      normalize: value => normalizeQualificationResult(value, qualification as LocalReferenceQualificationRequest, requestSha256, response),
    }
  }
  if (!['uploadLocalReferenceCandidate', 'recoverLocalReferenceCandidate'].includes(endpoint)) throw input('unknown local reference operation')
  if (Object.keys(raw).sort().join() !== ['contentBase64', 'elementKind', 'idempotencyKey', 'originalFileName', 'projectId', 'sourceDeclaration', 'targetId'].join()) throw input('local reference upload fields invalid')
  const idempotencyKey = text(raw.idempotencyKey, input, 128)
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw input('local reference intent invalid')
  const originalFileName = text(raw.originalFileName, input, 128)
  if (originalFileName.trim() !== originalFileName || /[\\/]/.test(originalFileName)) throw input('local reference filename invalid')
  if (raw.sourceDeclaration !== 'local_file_unverified') throw input('local reference source declaration invalid')
  const bytes = strictBase64(raw.contentBase64, input)
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const identity = {
    elementKind: expected.elementKind, targetId: expected.targetId, originalFileName, contentSha256,
    sourceDeclaration: raw.sourceDeclaration,
  }
  const requestSha256 = createHash('sha256').update(helpers.canonicalJson(identity, 'local reference identity')).digest('hex')
  const recover = endpoint === 'recoverLocalReferenceCandidate'
  const path = recover ? `${prefix}/receipt?${new URLSearchParams({ idempotencyKey, requestSha256 }).toString()}` : prefix
  const body = recover ? undefined : { idempotencyKey, originalFileName, contentBase64: raw.contentBase64 as string, sourceDeclaration: 'local_file_unverified' }
  return { path, method: recover ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), normalize: (value) => {
    const result = normalizeResult(value, expected, response)
    if (result.idempotencyKey !== idempotencyKey || result.requestSha256 !== requestSha256 || result.inputSha256 !== contentSha256
      || result.originalFileName !== originalFileName || result.sourceDeclaration !== raw.sourceDeclaration) throw response('local reference receipt mismatch')
    return result
  } }
}
