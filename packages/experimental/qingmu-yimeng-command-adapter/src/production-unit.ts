/** Explicit native-group scope commands reuse the Host transport and Yimeng ledgers. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  YimengBindProductionUnitRequest,
  YimengCommandJsonObject,
  YimengImagoProductionUnitMethodAttestation,
  YimengImagoProductionUnitMethodProjection,
  YimengProductionUnitBinding,
  YimengProductionUnitDefinition,
  YimengProductionUnitRecovery,
  YimengProductionUnitResult,
  YimengProductionUnitSource,
  YimengRecoverProductionUnitBindingRequest,
} from './types.ts'

const COORDINATE_FIELDS = ['projectId', 'episodeId', 'groupId', 'unitId', 'expectedSubjectSha256', 'idempotencyKey'] as const
const SOURCE_FIELDS = ['schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title', 'groupExecutionPromptSha256', 'storyboardRevision', 'shots'] as const
const METHOD_FIELDS = ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'] as const
const DEFINITION_FIELDS = ['id', 'version', 'unitIdPattern', 'scope', 'stages', 'operation', 'planSealingAllowed', 'stageApprovalAllowed', 'providerCalls'] as const
const FLAGS = { planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const
const BINDING_FIELDS = [
  'unitId', 'groupId', 'projectId', 'episodeId', 'revision', 'source', 'sourceSnapshotSha256',
  'methodProjectionSha256', 'rulesSha256', 'definition', 'actorId', 'authSessionId', 'eventId', 'changeSetId', 'createdAt',
] as const
const ATTESTATION_SCHEMA = 'qingmu.imago-production-unit-method-attestation.v1'

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
  readonly normalize: (value: unknown, token: string) => YimengProductionUnitResult | YimengProductionUnitRecovery
}

function exact(value: unknown, keys: readonly string[], field: string, error: ErrorFactory): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw error(`${field} has invalid fields`)
  }
  return value as YimengCommandJsonObject
}

function text(value: unknown, maximum: number, field: string, error: ErrorFactory, identifier = false): string {
  if (typeof value !== 'string' || Array.from(value).length > maximum || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    throw error(`${field} must be bounded Unicode text`)
  }
  // Match Python str.strip without removing the BOM from signed source text.
  const stripped = value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
  if (!stripped || (identifier && (stripped !== value || /[\r\n]/u.test(value)))) throw error(`${field} must be non-empty trimmed text`)
  return value
}
function id(value: unknown, field: string, error: ErrorFactory): string { return text(value, 256, field, error, true) }
function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/u.test(value)) throw error(`${field} must be sha256`)
  return value
}
function integer(value: unknown, minimum: number, field: string, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  return value
}
function canonical(value: unknown, helpers: Helpers, error: ErrorFactory): string {
  try { return helpers.canonicalJson(value, 'productionUnit') }
  catch { throw error('productionUnit must be canonical JSON') }
}
function digest(value: unknown, helpers: Helpers, error: ErrorFactory): string {
  return createHash('sha256').update(canonical(value, helpers, error), 'utf8').digest('hex')
}

function coordinates(raw: YimengCommandJsonObject, error: ErrorFactory): YimengRecoverProductionUnitBindingRequest {
  const unitId = id(raw.unitId, 'unitId', error)
  if (!/^LSU[0-9]{2,}$/u.test(unitId)) throw error('unitId must match the production-unit ID pattern')
  const idempotencyKey = text(raw.idempotencyKey, 200, 'idempotencyKey', error, true)
  if (Array.from(idempotencyKey).length < 8) throw error('idempotencyKey is too short')
  return {
    projectId: id(raw.projectId, 'projectId', error), episodeId: id(raw.episodeId, 'episodeId', error),
    groupId: id(raw.groupId, 'groupId', error), unitId,
    expectedSubjectSha256: sha(raw.expectedSubjectSha256, 'expectedSubjectSha256', error), idempotencyKey,
  }
}

function source(
  value: unknown, request: YimengRecoverProductionUnitBindingRequest, helpers: Helpers, error: ErrorFactory,
): YimengProductionUnitSource {
  const item = exact(value, SOURCE_FIELDS, 'source', error)
  if (item.schema !== 'jason.qingmu-production-unit-source.v1' || !Array.isArray(item.shots) || item.shots.length === 0) throw error('source schema or members mismatch')
  const seen = new Set<string>()
  let previous = 0
  const shots = item.shots.map((value) => {
    const shot = exact(value, ['frameId', 'frameNo', 'frameContentSha256'], 'source.shots', error)
    const frameId = id(shot.frameId, 'frameId', error)
    const frameNo = integer(shot.frameNo, 1, 'frameNo', error)
    if (seen.has(frameId) || frameNo <= previous) throw error('source shots must be unique and ordered')
    seen.add(frameId)
    previous = frameNo
    return { frameId, frameNo, frameContentSha256: sha(shot.frameContentSha256, 'frameContentSha256', error) }
  })
  const result: YimengProductionUnitSource = {
    schema: 'jason.qingmu-production-unit-source.v1',
    projectId: id(item.projectId, 'source.projectId', error), episodeId: id(item.episodeId, 'source.episodeId', error),
    groupId: id(item.groupId, 'source.groupId', error), groupNo: integer(item.groupNo, 1, 'groupNo', error),
    title: text(item.title, 8000, 'title', error), groupExecutionPromptSha256: sha(item.groupExecutionPromptSha256, 'groupExecutionPromptSha256', error),
    storyboardRevision: integer(item.storyboardRevision, 0, 'storyboardRevision', error), shots,
  }
  if (result.projectId !== request.projectId || result.episodeId !== request.episodeId || result.groupId !== request.groupId
    || digest(result, helpers, error) !== request.expectedSubjectSha256) throw error('source binding mismatch')
  return result
}

function definition(value: unknown, error: ErrorFactory): YimengProductionUnitDefinition {
  const item = exact(value, DEFINITION_FIELDS, 'definition', error)
  if (item.id !== 'IMAGO-V6-LSU' || item.unitIdPattern !== 'LSU[0-9]{2,}' || item.scope !== 'per_lsu'
    || item.operation !== 'bind_existing_shot_group' || item.planSealingAllowed !== false
    || item.stageApprovalAllowed !== false || item.providerCalls !== 0 || !Array.isArray(item.stages) || item.stages.length === 0) {
    throw error('production-unit definition mismatch')
  }
  const seen = new Set<string>()
  const stages = item.stages.map((value) => {
    const stage = exact(value, ['stageId', 'roleId', 'contractSha256'], 'definition.stages', error)
    const stageId = id(stage.stageId, 'stageId', error)
    if (seen.has(stageId)) throw error('definition stage IDs must be unique')
    seen.add(stageId)
    return { stageId, roleId: id(stage.roleId, 'roleId', error), contractSha256: sha(stage.contractSha256, 'contractSha256', error) }
  })
  return {
    id: 'IMAGO-V6-LSU', version: id(item.version, 'definition.version', error), unitIdPattern: 'LSU[0-9]{2,}',
    scope: 'per_lsu', stages, operation: 'bind_existing_shot_group', planSealingAllowed: false, stageApprovalAllowed: false, providerCalls: 0,
  }
}

function bindRequest(value: unknown, helpers: Helpers): YimengBindProductionUnitRequest {
  const error = helpers.inputError
  const raw = exact(value, [...COORDINATE_FIELDS, 'expectedBindingRevision', 'expectedBindingSha256', 'methodProjection', 'methodProjectionSha256', 'methodAttestation'], 'payload', error)
  const request = coordinates(raw, error)
  const revision = integer(raw.expectedBindingRevision, 0, 'expectedBindingRevision', error)
  if (revision === 0 && raw.expectedBindingSha256 !== null) throw error('initial binding requires a null previous SHA')
  const previousSha = revision === 0 ? null : sha(raw.expectedBindingSha256, 'expectedBindingSha256', error)
  const method = exact(raw.methodProjection, METHOD_FIELDS, 'methodProjection', error)
  const methodSha = sha(raw.methodProjectionSha256, 'methodProjectionSha256', error)
  if (method.schema !== 'qingmu.imago-production-unit-method.v1' || method.subjectSnapshotSha256 !== request.expectedSubjectSha256
    || digest(method, helpers, error) !== methodSha) throw error('methodProjection binding mismatch')
  const boundSource = source(method.subject, request, helpers, error)
  const signed = {
    schema: ATTESTATION_SCHEMA, algorithm: 'hmac-sha256',
    subjectSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256: methodSha,
  } as const
  const proof = exact(raw.methodAttestation, [...Object.keys(signed), 'signature'], 'methodAttestation', error)
  if (Object.entries(signed).some(([key, expected]) => proof[key] !== expected)) throw error('methodAttestation binding mismatch')
  const signature = sha(proof.signature, 'methodAttestation.signature', error)
  const expectedSignature = createHmac('sha256', helpers.readAttestationKey()).update(canonical(signed, helpers, error), 'utf8').digest()
  if (!timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex'))) throw error('methodAttestation signature mismatch')
  const methodDefinition = definition(method.definition, error)
  if (typeof method.ruleBindings !== 'object' || method.ruleBindings === null || Array.isArray(method.ruleBindings)
    || Object.keys(method.ruleBindings).length === 0) throw error('ruleBindings must be a non-empty object')
  const ruleBindings = Object.fromEntries(Object.entries(method.ruleBindings).map(([path, value]) => {
    text(path, 1024, 'ruleBindings path', error, true)
    if (path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw error('ruleBindings path must be safe and relative')
    return [path, sha(value, 'ruleBindings SHA', error)]
  }))
  const rulesSha256 = sha(method.rulesSha256, 'rulesSha256', error)
  if (digest(ruleBindings, helpers, error) !== rulesSha256) throw error('rulesSha256 mismatch')
  const methodProjection: YimengImagoProductionUnitMethodProjection = {
    schema: 'qingmu.imago-production-unit-method.v1', subject: boundSource, subjectSnapshotSha256: request.expectedSubjectSha256,
    definition: methodDefinition, ruleBindings, rulesSha256,
  }
  const methodAttestation: YimengImagoProductionUnitMethodAttestation = { ...signed, signature }
  return {
    ...request, expectedBindingRevision: revision, expectedBindingSha256: previousSha,
    methodProjection, methodProjectionSha256: methodSha, methodAttestation,
  }
}

function result(value: unknown, request: YimengRecoverProductionUnitBindingRequest, helpers: Helpers): YimengProductionUnitResult {
  const error = helpers.responseError
  const root = exact(value, ['schema', 'binding', 'bindingSha256', ...Object.keys(FLAGS)], 'result', error)
  if (root.schema !== 'jason.qingmu-production-unit-result.v1' || Object.entries(FLAGS).some(([key, flag]) => root[key] !== flag)) throw error('result authority flags mismatch')
  const item = exact(root.binding, BINDING_FIELDS, 'binding', error)
  if (item.unitId !== request.unitId || item.groupId !== request.groupId || item.projectId !== request.projectId
    || item.episodeId !== request.episodeId || item.sourceSnapshotSha256 !== request.expectedSubjectSha256) throw error('result binding mismatch')
  const binding: YimengProductionUnitBinding = {
    unitId: request.unitId, groupId: request.groupId, projectId: request.projectId, episodeId: request.episodeId,
    revision: integer(item.revision, 1, 'binding.revision', error), source: source(item.source, request, helpers, error),
    sourceSnapshotSha256: request.expectedSubjectSha256, methodProjectionSha256: sha(item.methodProjectionSha256, 'methodProjectionSha256', error),
    rulesSha256: sha(item.rulesSha256, 'rulesSha256', error), definition: definition(item.definition, error),
    actorId: id(item.actorId, 'actorId', error), authSessionId: sha(item.authSessionId, 'authSessionId', error),
    eventId: id(item.eventId, 'eventId', error), changeSetId: id(item.changeSetId, 'changeSetId', error),
    createdAt: helpers.requireTimestamp(text(item.createdAt, 128, 'createdAt', error), 'createdAt'),
  }
  const bindingSha256 = sha(root.bindingSha256, 'bindingSha256', error)
  if (digest(binding, helpers, error) !== bindingSha256) throw error('bindingSha256 mismatch')
  return { schema: 'jason.qingmu-production-unit-result.v1', binding, bindingSha256, ...FLAGS }
}

/** Prepare a scope registration or original-coordinate receipt lookup without network I/O.
 * @param endpoint - Explicit binding or GET-only recovery operation.
 * @param payload - Untrusted RPC data; actor/session and approval fields are forbidden.
 * @param helpers - Existing canonical JSON, signing key, timestamp, and error implementations.
 * @returns The exact upstream request and a receipt validator; neither retries writes.
 * @throws On invalid source, CAS, proof, or response; historical reads need no current key.
 */
export function prepareProductionUnitCommand(
  endpoint: 'bindProductionUnit' | 'recoverProductionUnitBinding', payload: unknown, helpers: Helpers,
): PreparedCommand {
  if (endpoint === 'bindProductionUnit') {
    const request = bindRequest(payload, helpers)
    return {
      path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/production-units/${encodeURIComponent(request.unitId)}/binding`,
      request: { method: 'POST', body: {
        groupId: request.groupId, expectedSubjectSha256: request.expectedSubjectSha256,
        expectedBindingRevision: request.expectedBindingRevision, expectedBindingSha256: request.expectedBindingSha256,
        methodProjection: request.methodProjection, methodProjectionSha256: request.methodProjectionSha256,
        methodAttestation: request.methodAttestation, idempotencyKey: request.idempotencyKey,
      } },
      normalize: (value, token) => {
        const reply = result(value, request, helpers)
        const binding = reply.binding
        if (binding.revision !== request.expectedBindingRevision + 1 || binding.methodProjectionSha256 !== request.methodProjectionSha256
          || binding.rulesSha256 !== request.methodProjection.rulesSha256
          || canonical(binding.definition, helpers, helpers.responseError)
            !== canonical(request.methodProjection.definition, helpers, helpers.responseError)
          || binding.authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex')) throw helpers.responseError('binding differs from submitted command')
        return reply
      },
    }
  }
  const request = coordinates(exact(payload, COORDINATE_FIELDS, 'payload', helpers.inputError), helpers.inputError)
  return {
    path: `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/production-units/${encodeURIComponent(request.unitId)}/binding/command-receipt?groupId=${encodeURIComponent(request.groupId)}&expectedSubjectSha256=${request.expectedSubjectSha256}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(value, ['schema', ...COORDINATE_FIELDS, 'found', 'result'], 'recovery', error)
      if (root.schema !== 'jason.qingmu-production-unit-recovery.v1' || Object.entries(request).some(([key, expected]) => root[key] !== expected)
        || typeof root.found !== 'boolean' || (!root.found && root.result !== null)) throw error('recovery binding mismatch')
      return {
        schema: 'jason.qingmu-production-unit-recovery.v1', ...request, found: root.found,
        result: root.found ? result(root.result, request, helpers) : null,
      }
    },
  }
}
