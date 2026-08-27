/** Explicit episode-script source references reuse existing transport and three-ledger receipts. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  YimengBindStageSourceRequest, YimengCommandJsonObject, YimengImagoStageSourceMethodAttestation,
  YimengImagoStageSourceMethodProjection, YimengRecoverStageSourceBindingRequest, YimengStageSource,
  YimengStageSourceBinding, YimengStageSourceDefinition, YimengStageSourceRecovery, YimengStageSourceResult,
} from './types.ts'

const COORDINATES = ['projectId', 'episodeId', 'stageId', 'expectedSubjectSha256', 'idempotencyKey'] as const
const FLAGS = { stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false,
  planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const
const ATTESTATION_SCHEMA = 'qingmu.imago-stage-source-method-attestation.v1'
type ErrorFactory = (message: string) => Error
interface Helpers {
  readonly canonicalJson: (value: unknown, field: string) => string
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly readAttestationKey: () => string
  readonly requireTimestamp: (value: unknown, field: string) => string
}
interface PreparedCommand {
  readonly path: string
  readonly request: { readonly method: 'GET' | 'POST'; readonly body?: YimengCommandJsonObject; readonly idempotencyKey?: string }
  readonly normalize: (value: unknown, token: string) => YimengStageSourceResult | YimengStageSourceRecovery
}

function exact(value: unknown, keys: readonly string[], error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw error('stage source has invalid fields')
  return value as YimengCommandJsonObject
}
function id(value: unknown, error: ErrorFactory, maximum = 256): string {
  if (typeof value !== 'string' || !value.isWellFormed() || Array.from(value).length > maximum || /[\0\r\n]/u.test(value)) throw error('invalid Unicode identifier')
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  if (stripped === '' || stripped !== value) throw error('identifier must be nonempty without Python boundary whitespace')
  return value
}
function sha(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/u.test(value)) throw error('invalid sha256')
  return value
}
function integer(value: unknown, minimum: number, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw error('invalid safe revision')
  return value
}
function canonical(value: unknown, helpers: Helpers, error: ErrorFactory): string {
  try { return helpers.canonicalJson(value, 'stageSource') }
  catch { throw error('stage source must be canonical JSON') }
}
function digest(value: unknown, helpers: Helpers, error: ErrorFactory): string {
  return createHash('sha256').update(canonical(value, helpers, error), 'utf8').digest('hex')
}
function coordinates(raw: YimengCommandJsonObject, error: ErrorFactory): YimengRecoverStageSourceBindingRequest {
  if (raw.stageId !== 'A1S') throw error('only explicit A1S source binding is supported')
  const idempotencyKey = id(raw.idempotencyKey, error, 200)
  if (!/^[\x21-\x7e]{8,200}$/u.test(idempotencyKey)) throw error('idempotencyKey must be 8..200 visible ASCII characters')
  return { projectId: id(raw.projectId, error), episodeId: id(raw.episodeId, error), stageId: 'A1S',
    expectedSubjectSha256: sha(raw.expectedSubjectSha256, error), idempotencyKey }
}
function source(value: unknown, request: YimengRecoverStageSourceBindingRequest, helpers: Helpers, error: ErrorFactory): YimengStageSource {
  const raw = exact(value, ['schema', 'projectId', 'episodeId', 'sourceType', 'sourceId', 'revision', 'contentSha256'], error)
  if (raw.schema !== 'jason.qingmu-stage-source.v1' || raw.sourceType !== 'episode_script' || raw.projectId !== request.projectId
    || raw.episodeId !== request.episodeId || raw.sourceId !== request.episodeId) throw error('source identity mismatch')
  const result: YimengStageSource = { schema: 'jason.qingmu-stage-source.v1', projectId: id(raw.projectId, error), episodeId: id(raw.episodeId, error),
    sourceType: 'episode_script', sourceId: id(raw.sourceId, error), revision: integer(raw.revision, 0, error), contentSha256: sha(raw.contentSha256, error) }
  if (digest(result, helpers, error) !== request.expectedSubjectSha256) throw error('source SHA mismatch')
  return result
}
function definition(value: unknown, error: ErrorFactory): YimengStageSourceDefinition {
  const raw = exact(value, ['id', 'version', 'stageId', 'roleId', 'scope', 'contractSha256', 'artifactKind', 'canonicalOutput',
    'sourceType', 'sourceUsage', 'operation', 'stageArtifactCreationAllowed', 'stageApprovalAllowed', 'providerCalls'], error)
  if (raw.id !== 'IMAGO-V6-A1S-SOURCE' || raw.stageId !== 'A1S' || raw.roleId !== 'A1S' || raw.scope !== 'global'
    || raw.artifactKind !== 'SCREENPLAY_PACKAGE' || raw.canonicalOutput !== 'inputs/screenplay-package.json'
    || raw.sourceType !== 'episode_script' || raw.sourceUsage !== 'source_reference_only'
    || raw.operation !== 'bind_existing_episode_script_source' || raw.stageArtifactCreationAllowed !== false
    || raw.stageApprovalAllowed !== false || raw.providerCalls !== 0) throw error('source-reference method authority mismatch')
  return { id: 'IMAGO-V6-A1S-SOURCE', version: id(raw.version, error), stageId: 'A1S', roleId: 'A1S', scope: 'global',
    contractSha256: sha(raw.contractSha256, error), artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
    sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
    stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 }
}

function bindRequest(value: unknown, helpers: Helpers): YimengBindStageSourceRequest {
  const error = helpers.inputError
  const raw = exact(value, [...COORDINATES, 'expectedBindingRevision', 'expectedBindingSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation'], error)
  const request = coordinates(raw, error)
  const revision = integer(raw.expectedBindingRevision, 0, error)
  if (revision === Number.MAX_SAFE_INTEGER) throw error('binding revision cannot advance safely')
  if (revision === 0 && raw.expectedBindingSha256 !== null) throw error('initial binding requires null previous SHA')
  const expectedBindingSha256 = revision === 0 ? null : sha(raw.expectedBindingSha256, error)
  const method = exact(raw.methodProjection, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'], error)
  const methodProjectionSha256 = sha(raw.methodProjectionSha256, error)
  if (method.schema !== 'qingmu.imago-stage-source-method.v1' || method.subjectSnapshotSha256 !== request.expectedSubjectSha256
    || digest(method, helpers, error) !== methodProjectionSha256) throw error('method source or SHA mismatch')
  const subject = source(method.subject, request, helpers, error)
  const signed = { schema: ATTESTATION_SCHEMA, algorithm: 'hmac-sha256',
    subjectSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256 } as const
  const proof = exact(raw.methodAttestation, [...Object.keys(signed), 'signature'], error)
  if (Object.entries(signed).some(([key, expected]) => proof[key] !== expected)) throw error('method attestation coordinates mismatch')
  const signature = sha(proof.signature, error)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey()).update(canonical(signed, helpers, error), 'utf8').digest()
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) throw error('method attestation signature mismatch')
  const methodDefinition = definition(method.definition, error)
  if (typeof method.ruleBindings !== 'object' || method.ruleBindings === null || Array.isArray(method.ruleBindings)
    || Object.keys(method.ruleBindings).length === 0) throw error('ruleBindings must be a nonempty map')
  const ruleBindings = Object.fromEntries(Object.entries(method.ruleBindings).map(([path, value]) => {
    id(path, error, 1024)
    if (path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw error('unsafe rule path')
    return [path, sha(value, error)]
  }))
  const rulesSha256 = sha(method.rulesSha256, error)
  if (digest(ruleBindings, helpers, error) !== rulesSha256) throw error('rules SHA mismatch')
  const methodProjection: YimengImagoStageSourceMethodProjection = { schema: 'qingmu.imago-stage-source-method.v1', subject,
    subjectSnapshotSha256: request.expectedSubjectSha256, definition: methodDefinition, ruleBindings, rulesSha256 }
  const methodAttestation: YimengImagoStageSourceMethodAttestation = { ...signed, signature }
  return { ...request, expectedBindingRevision: revision, expectedBindingSha256,
    methodProjection, methodProjectionSha256, methodAttestation }
}

function result(value: unknown, request: YimengRecoverStageSourceBindingRequest, helpers: Helpers): YimengStageSourceResult {
  const error = helpers.responseError
  const root = exact(value, ['schema', 'binding', 'bindingSha256', 'receiptId', 'outboxEventId'], error)
  if (root.schema !== 'jason.qingmu-stage-source-result.v1') throw error('receipt schema mismatch')
  const raw = exact(root.binding, ['schema', 'changeSetId', 'projectId', 'episodeId', 'stageId', 'source', 'subjectSnapshotSha256', 'definition',
    'methodProjectionSha256', 'rulesSha256', 'bindingRevision', 'actorId', 'authSessionId', 'createdAt', ...Object.keys(FLAGS)], error)
  if (raw.schema !== 'jason.qingmu-stage-source-binding.v1' || raw.projectId !== request.projectId || raw.episodeId !== request.episodeId
    || raw.stageId !== request.stageId || raw.subjectSnapshotSha256 !== request.expectedSubjectSha256
    || Object.entries(FLAGS).some(([key, expected]) => raw[key] !== expected)) throw error('receipt identity or authority mismatch')
  const binding: YimengStageSourceBinding = { schema: 'jason.qingmu-stage-source-binding.v1', projectId: request.projectId,
    episodeId: request.episodeId, stageId: request.stageId, changeSetId: id(raw.changeSetId, error),
    source: source(raw.source, request, helpers, error), subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: definition(raw.definition, error), methodProjectionSha256: sha(raw.methodProjectionSha256, error),
    rulesSha256: sha(raw.rulesSha256, error),
    bindingRevision: integer(raw.bindingRevision, 1, error), actorId: id(raw.actorId, error), authSessionId: sha(raw.authSessionId, error),
    createdAt: helpers.requireTimestamp(id(raw.createdAt, error, 128), 'createdAt'), ...FLAGS }
  const bindingSha256 = sha(root.bindingSha256, error)
  if (digest(binding, helpers, error) !== bindingSha256) throw error('binding SHA mismatch')
  return { schema: 'jason.qingmu-stage-source-result.v1', binding, bindingSha256,
    receiptId: id(root.receiptId, error), outboxEventId: id(root.outboxEventId, error) }
}

/** Prepare one explicit POST or an original-coordinate GET without retrying writes.
 * @param endpoint - Binding or receipt-recovery endpoint.
 * @param payload - Exact browser command with no actor, session, or approval fields.
 * @param helpers - Existing transport validation and Host-only key access.
 * @returns Exact upstream path/body and a strict receipt validator.
 */
export function prepareStageSourceCommand(endpoint: 'bindStageSource' | 'recoverStageSourceBinding', payload: unknown, helpers: Helpers): PreparedCommand {
  if (endpoint === 'bindStageSource') {
    const request = bindRequest(payload, helpers)
    return { path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-sources/${request.stageId}/binding`,
      request: { method: 'POST', body: { expectedSubjectSha256: request.expectedSubjectSha256, idempotencyKey: request.idempotencyKey,
        expectedBindingRevision: request.expectedBindingRevision, expectedBindingSha256: request.expectedBindingSha256,
        methodProjection: request.methodProjection, methodProjectionSha256: request.methodProjectionSha256,
        methodAttestation: request.methodAttestation } },
      normalize: (value, token) => {
        const receipt = result(value, request, helpers)
        const binding = receipt.binding
        if (binding.bindingRevision !== request.expectedBindingRevision + 1
          || binding.methodProjectionSha256 !== request.methodProjectionSha256
          || binding.rulesSha256 !== request.methodProjection.rulesSha256
          || canonical(binding.definition, helpers, helpers.responseError)
            !== canonical(request.methodProjection.definition, helpers, helpers.responseError)
          || binding.authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex')) throw helpers.responseError('receipt differs from submitted command')
        return receipt
      } }
  }
  const request = coordinates(exact(payload, COORDINATES, helpers.inputError), helpers.inputError)
  return { path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/stage-sources/${request.stageId}/binding/command-receipt?expectedSubjectSha256=${request.expectedSubjectSha256}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const root = exact(value, ['schema', 'receipt'], helpers.responseError)
      if (root.schema !== 'jason.qingmu-stage-source-recovery.v1') throw helpers.responseError('recovery schema mismatch')
      // Current source, HMAC key and session are intentionally not required for historical recovery.
      return { schema: 'jason.qingmu-stage-source-recovery.v1', receipt: result(root.receipt, request, helpers) }
    } }
}
