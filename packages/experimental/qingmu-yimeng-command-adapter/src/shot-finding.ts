/** Selected-video Finding commands reuse the adapter's transport and canonical JSON. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  YimengCommandJsonObject,
  YimengImagoShotFindingMethodAttestation,
  YimengImagoShotFindingMethodProjection,
  YimengRecordShotFindingRequest,
  YimengRecoverShotFindingRequest,
  YimengShotFindingPayload,
  YimengShotFindingRecovery,
  YimengShotFindingResult,
  YimengShotVideoSubject,
} from './types.ts'

const FINDING_FIELDS = [
  'timecode', 'observation', 'evidenceRefs', 'earliestOwner',
  'ownerReason', 'severity', 'suggestion', 'reworkScope',
] as const
const SUBJECT_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'assetId', 'assetVersion', 'assetSha256',
] as const
const REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedSubjectSha256', 'idempotencyKey',
] as const
const METHOD_FIELDS = [
  'schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256',
] as const
const RESULT_FIELDS = [
  'schema', 'finding', 'changed', 'providerCalls', 'selectionChanged',
  'humanSignoffInferred', 'reworkExecuted',
] as const
const RECORDED_FIELDS = [
  ...FINDING_FIELDS, 'id', 'eventId', 'subject', 'subjectSnapshotSha256', 'status',
  'actorId', 'actorRole', 'authSessionId', 'createdAt', 'methodProjectionSha256', 'rulesSha256',
] as const
const SEVERITIES = ['BLOCKER', 'MAJOR', 'MINOR'] as const
const ATTESTATION_SCHEMA = 'qingmu.imago-shot-finding-method-attestation.v1'
const SHA256 = /^[0-9a-f]{64}$/u
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u

type ErrorFactory = (message: string) => Error

interface ShotFindingHelpers {
  readonly canonicalJson: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly readAttestationKey: () => string
  readonly requireTimestamp: (value: unknown, field: string) => string
}

interface PreparedShotFindingCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey?: string
  }
  readonly normalize: (value: unknown, token: string) => YimengShotFindingResult | YimengShotFindingRecovery
}

function exact(value: unknown, keys: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))
  ) throw error(`${field} has invalid fields`)
  return value as YimengCommandJsonObject
}

function text(value: unknown, maximum: number, field: string, error: ErrorFactory, identifier = false): string {
  if (typeof value !== 'string' || Array.from(value).length > maximum || value.includes('\0') || UNPAIRED_SURROGATE.test(value)) {
    throw error(`${field} must be bounded Unicode text`)
  }
  // Python str.strip also treats the four ASCII information separators as whitespace.
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  if (!stripped || (identifier && (stripped !== value || /[\r\n]/u.test(value)))) {
    throw error(`${field} must be non-empty${identifier ? ' trimmed text' : ' text'}`)
  }
  return value
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  return text(value, 256, field, error, true)
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length !== 64 || !SHA256.test(value)) throw error(`${field} must be sha256`)
  return value
}

function integer(value: unknown, minimum: number, field: string, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  }
  return value
}

function canonical(value: unknown, field: string, helpers: ShotFindingHelpers, error: ErrorFactory): string {
  try {
    return helpers.canonicalJson(value, field)
  } catch {
    throw error(`${field} must be canonical JSON`)
  }
}

function digest(value: unknown, field: string, helpers: ShotFindingHelpers, error: ErrorFactory): string {
  return createHash('sha256').update(canonical(value, field, helpers, error), 'utf8').digest('hex')
}

function coordinates(value: YimengCommandJsonObject, error: ErrorFactory): YimengRecoverShotFindingRequest {
  const key = text(value.idempotencyKey, 200, 'idempotencyKey', error, true)
  if (Array.from(key).length < 8) throw error('idempotencyKey is too short')
  return {
    projectId: id(value.projectId, 'projectId', error),
    episodeId: id(value.episodeId, 'episodeId', error),
    frameId: id(value.frameId, 'frameId', error),
    expectedSubjectSha256: sha(value.expectedSubjectSha256, 'expectedSubjectSha256', error),
    idempotencyKey: key,
  }
}

function subject(
  value: unknown,
  request: YimengRecoverShotFindingRequest,
  helpers: ShotFindingHelpers,
  error: ErrorFactory,
): YimengShotVideoSubject {
  const item = exact(value, SUBJECT_FIELDS, 'subject', error)
  if (item.schema !== 'jason.qingmu-shot-video-subject.v1') throw error('subject.schema mismatch')
  const result: YimengShotVideoSubject = {
    schema: 'jason.qingmu-shot-video-subject.v1',
    projectId: id(item.projectId, 'subject.projectId', error),
    episodeId: id(item.episodeId, 'subject.episodeId', error),
    frameId: id(item.frameId, 'subject.frameId', error),
    frameNo: integer(item.frameNo, 1, 'subject.frameNo', error),
    storyboardRevision: integer(item.storyboardRevision, 0, 'subject.storyboardRevision', error),
    frameContentSha256: sha(item.frameContentSha256, 'subject.frameContentSha256', error),
    assetId: id(item.assetId, 'subject.assetId', error),
    assetVersion: integer(item.assetVersion, 0, 'subject.assetVersion', error),
    assetSha256: sha(item.assetSha256, 'subject.assetSha256', error),
  }
  if (
    result.projectId !== request.projectId || result.episodeId !== request.episodeId
    || result.frameId !== request.frameId
    || digest(result, 'subject', helpers, error) !== request.expectedSubjectSha256
  ) throw error('subject binding mismatch')
  return result
}

function finding(value: unknown, error: ErrorFactory): YimengShotFindingPayload {
  const item = exact(value, FINDING_FIELDS, 'finding', error)
  const severity = item.severity
  if (severity !== 'BLOCKER' && severity !== 'MAJOR' && severity !== 'MINOR') throw error('finding.severity mismatch')
  if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 32) {
    throw error('finding.evidenceRefs must contain 1 through 32 references')
  }
  return {
    timecode: text(item.timecode, 128, 'finding.timecode', error),
    observation: text(item.observation, 8000, 'finding.observation', error),
    evidenceRefs: item.evidenceRefs.map(value => text(value, 1024, 'finding.evidenceRefs', error)),
    earliestOwner: id(item.earliestOwner, 'finding.earliestOwner', error),
    ownerReason: text(item.ownerReason, 8000, 'finding.ownerReason', error),
    severity,
    suggestion: text(item.suggestion, 8000, 'finding.suggestion', error),
    reworkScope: text(item.reworkScope, 8000, 'finding.reworkScope', error),
  }
}

function recordRequest(value: unknown, helpers: ShotFindingHelpers): YimengRecordShotFindingRequest {
  const error = helpers.inputError
  const raw = exact(value, [...REQUEST_FIELDS, 'finding', 'methodProjection', 'methodProjectionSha256', 'methodAttestation'], 'payload', error)
  const request = coordinates(raw, error)
  const method = exact(raw.methodProjection, METHOD_FIELDS, 'methodProjection', error)
  if (method.schema !== 'qingmu.imago-shot-finding-method.v1') throw error('methodProjection.schema mismatch')
  const boundSubject = subject(method.subject, request, helpers, error)
  const methodSha = sha(raw.methodProjectionSha256, 'methodProjectionSha256', error)
  if (
    method.subjectSnapshotSha256 !== request.expectedSubjectSha256
    || digest(method, 'methodProjection', helpers, error) !== methodSha
  ) throw error('methodProjection binding mismatch')
  const signed = {
    schema: ATTESTATION_SCHEMA,
    algorithm: 'hmac-sha256',
    subjectSnapshotSha256: request.expectedSubjectSha256,
    methodProjectionSha256: methodSha,
  } as const
  const proof = exact(raw.methodAttestation, [...Object.keys(signed), 'signature'], 'methodAttestation', error)
  if (Object.entries(signed).some(([key, expected]) => proof[key] !== expected)) throw error('methodAttestation binding mismatch')
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey())
    .update(canonical(signed, 'methodAttestation', helpers, error), 'utf8').digest()
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) throw error('methodAttestation signature mismatch')

  const definition = exact(method.definition, [
    'requiredFields', 'severities', 'ownerOptions', 'statusOnRecord', 'approvalAuthority', 'reworkExecutionAllowed',
  ], 'methodProjection.definition', error)
  if (
    canonical(definition.requiredFields, 'requiredFields', helpers, error) !== canonical(FINDING_FIELDS, 'requiredFields', helpers, error)
    || canonical(definition.severities, 'severities', helpers, error) !== canonical(SEVERITIES, 'severities', helpers, error)
    || definition.statusOnRecord !== 'OPEN' || definition.approvalAuthority !== 'not_granted'
    || definition.reworkExecutionAllowed !== false
    || !Array.isArray(definition.ownerOptions) || definition.ownerOptions.length === 0
  ) throw error('methodProjection.definition mismatch')
  const seen = new Set<string>()
  const ownerOptions = definition.ownerOptions.map((value): YimengImagoShotFindingMethodProjection['definition']['ownerOptions'][number] => {
    const owner = exact(value, ['stageId', 'roleId', 'scope'], 'ownerOptions', error)
    const stageId = id(owner.stageId, 'ownerOptions.stageId', error)
    const roleId = id(owner.roleId, 'ownerOptions.roleId', error)
    const scope = owner.scope
    if (seen.has(stageId) || (scope !== 'global' && scope !== 'per_lsu')) throw error('ownerOptions mismatch')
    seen.add(stageId)
    return { stageId, roleId, scope }
  })
  if (typeof method.ruleBindings !== 'object' || method.ruleBindings === null || Array.isArray(method.ruleBindings)) {
    throw error('ruleBindings must be an object')
  }
  const entries = Object.entries(method.ruleBindings)
  if (entries.length === 0) throw error('ruleBindings cannot be empty')
  const ruleBindings = Object.fromEntries(entries.map(([name, value]) => {
    text(name, 1024, 'ruleBindings path', error, true)
    if (name.includes('\\') || name.includes(':') || name.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw error('ruleBindings path must be safe and relative')
    }
    return [name, sha(value, 'ruleBindings sha256', error)]
  }))
  const rulesSha = sha(method.rulesSha256, 'rulesSha256', error)
  if (digest(ruleBindings, 'ruleBindings', helpers, error) !== rulesSha) throw error('rulesSha256 mismatch')
  const payload = finding(raw.finding, error)
  if (!seen.has(payload.earliestOwner)) throw error('finding.earliestOwner is not a method owner option')
  const methodProjection: YimengImagoShotFindingMethodProjection = {
    schema: 'qingmu.imago-shot-finding-method.v1',
    subject: boundSubject,
    subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: {
      requiredFields: [...FINDING_FIELDS], severities: SEVERITIES, ownerOptions,
      statusOnRecord: 'OPEN', approvalAuthority: 'not_granted', reworkExecutionAllowed: false,
    },
    ruleBindings,
    rulesSha256: rulesSha,
  }
  const methodAttestation: YimengImagoShotFindingMethodAttestation = { ...signed, signature }
  return { ...request, finding: payload, methodProjection, methodProjectionSha256: methodSha, methodAttestation }
}

function result(value: unknown, request: YimengRecoverShotFindingRequest, helpers: ShotFindingHelpers): YimengShotFindingResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'result', error)
  if (
    root.schema !== 'jason.qingmu-shot-finding-result.v1' || root.changed !== false
    || root.providerCalls !== 0 || root.selectionChanged !== false
    || root.humanSignoffInferred !== false || root.reworkExecuted !== false
  ) throw error('result authority flags mismatch')
  const item = exact(root.finding, RECORDED_FIELDS, 'result.finding', error)
  const details = finding(Object.fromEntries(FINDING_FIELDS.map(key => [key, item[key]])), error)
  if (item.status !== 'OPEN' || item.actorRole !== 'reviewer' || item.subjectSnapshotSha256 !== request.expectedSubjectSha256) {
    throw error('result.finding binding mismatch')
  }
  return {
    schema: 'jason.qingmu-shot-finding-result.v1',
    finding: {
      ...details,
      id: id(item.id, 'result.finding.id', error),
      eventId: id(item.eventId, 'result.finding.eventId', error),
      subject: subject(item.subject, request, helpers, error),
      subjectSnapshotSha256: request.expectedSubjectSha256,
      status: 'OPEN',
      actorId: id(item.actorId, 'result.finding.actorId', error),
      actorRole: 'reviewer',
      authSessionId: sha(item.authSessionId, 'result.finding.authSessionId', error),
      createdAt: helpers.requireTimestamp(text(item.createdAt, 128, 'result.finding.createdAt', error), 'result.finding.createdAt'),
      methodProjectionSha256: sha(item.methodProjectionSha256, 'result.finding.methodProjectionSha256', error),
      rulesSha256: sha(item.rulesSha256, 'result.finding.rulesSha256', error),
    },
    changed: false, providerCalls: 0, selectionChanged: false, humanSignoffInferred: false, reworkExecuted: false,
  }
}

/** Prepare one record POST or historical receipt GET without performing network I/O.
 * @param endpoint - Explicit record or recovery command selected by the caller.
 * @param payload - Untrusted Connection RPC payload; actor/session fields are forbidden.
 * @param helpers - Existing adapter canonical JSON, key, timestamp, and error behavior.
 * @returns A bounded-transport request and a strict response validator; neither retries writes.
 * @throws If the payload or record proof/key is invalid; the validator rejects response mismatches.
 */
export function prepareShotFindingCommand(
  endpoint: 'recordShotFinding' | 'recoverShotFinding',
  payload: unknown,
  helpers: ShotFindingHelpers,
): PreparedShotFindingCommand {
  if (endpoint === 'recordShotFinding') {
    const request = recordRequest(payload, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/frames/${encodeURIComponent(request.frameId)}/findings`,
      request: {
        method: 'POST',
        body: {
          expectedSubjectSha256: request.expectedSubjectSha256,
          idempotencyKey: request.idempotencyKey,
          finding: request.finding,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
        },
      },
      normalize: (value, token) => {
        const normalized = result(value, request, helpers)
        const item = normalized.finding
        const details = Object.fromEntries(FINDING_FIELDS.map(key => [key, item[key]]))
        if (
          canonical(details, 'finding', helpers, helpers.responseError) !== canonical(request.finding, 'finding', helpers, helpers.responseError)
          || item.methodProjectionSha256 !== request.methodProjectionSha256
          || item.rulesSha256 !== request.methodProjection.rulesSha256
          || item.authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex')
        ) throw helpers.responseError('recorded Finding differs from the submitted command')
        return normalized
      },
    }
  }
  const request = coordinates(exact(payload, REQUEST_FIELDS, 'payload', helpers.inputError), helpers.inputError)
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/frames/${encodeURIComponent(request.frameId)}/findings/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(value, ['schema', ...REQUEST_FIELDS, 'status', 'result'], 'recovery', error)
      if (
        root.schema !== 'jason.qingmu-shot-finding-recovery.v1'
        || Object.entries(request).some(([key, expected]) => root[key] !== expected)
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)
      ) throw error('recovery binding mismatch')
      return {
        schema: 'jason.qingmu-shot-finding-recovery.v1', ...request, status: root.status,
        result: root.status === 'not_found' ? null : result(root.result, request, helpers),
      }
    },
  }
}
