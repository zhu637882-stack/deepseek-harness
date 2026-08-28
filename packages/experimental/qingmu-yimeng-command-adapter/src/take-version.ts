/** Exact, recoverable selection of one existing Yimeng Take version. */

import { createHash } from 'node:crypto'
import type {
  YimengCommandJsonObject,
  YimengSelectTakeVersionRequest,
  YimengTakeSelectionStackSubject,
  YimengTakeSelectionVersion,
  YimengTakeVersionSelectionRecovery,
  YimengTakeVersionSelectionResult,
} from './types.ts'

const REQUEST_FIELDS = [
  'projectId', 'episodeId', 'frameId', 'expectedStackSha256',
  'expectedSelectedTakeId', 'candidateTakeId', 'candidateVersionOrdinal',
  'candidateOutputSha256', 'idempotencyKey',
] as const
const VERSION_FIELDS = [
  'takeId', 'versionOrdinal', 'source', 'role', 'createdAt', 'updatedAt',
  'durationSec', 'estimatedCny', 'selectionStatus', 'isSelected', 'qualityStatus',
  'qualityPassed', 'qualityCheckCount', 'blockers', 'recordedOutputSha256',
  'outputSha256', 'outputBindingStatus', 'taskId', 'provider', 'model',
  'providerTaskId', 'routeKey', 'inputHash', 'lineageComplete', 'canAttemptSelection',
] as const
const STACK_FIELDS = [
  'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
  'frameContentSha256', 'selectionRevision', 'selectedTakeId', 'versions',
] as const
const RESULT_FIELDS = [
  'schema', 'changeSetId', 'commandReceiptId', 'eventId', 'eventType',
  'projectId', 'episodeId', 'frameId', 'selectedTake', 'selectionIdentity',
  'baseStackSnapshotSha256', 'authoritativeStack', 'authoritativeStackSnapshotSha256',
  'provenanceTaskId', 'taskMutation', 'idempotencyKey', 'deduplicated', 'committedAt',
  'selectionChanged', 'providerCalls', 'paidProviderAuthority', 'budgetMutation',
  'humanApprovalInferred', 'formalApprovalChanged',
] as const
const SHA256 = /^[0-9a-f]{64}$/u
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/u

type ErrorFactory = (message: string) => Error

interface TakeVersionHelpers {
  readonly inputError: ErrorFactory
  readonly responseError: ErrorFactory
  readonly requireTimestamp: (value: unknown, field: string) => string
}

interface PreparedTakeVersionCommand {
  readonly path: string
  readonly request: {
    readonly method: 'GET' | 'POST'
    readonly body?: YimengCommandJsonObject
    readonly idempotencyKey?: string
  }
  readonly normalize: (
    value: unknown,
    token: string,
  ) => YimengTakeVersionSelectionResult | YimengTakeVersionSelectionRecovery
}

function exact(
  value: unknown,
  keys: readonly string[],
  field: string,
  error: ErrorFactory,
): YimengCommandJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw error(`${field} has invalid fields`)
  }
  return value as YimengCommandJsonObject
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(
  value: unknown,
  maximum: number,
  field: string,
  error: ErrorFactory,
  identifier = false,
): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || Array.from(value).length > maximum || (identifier && /[\r\n]/u.test(value))) {
    throw error(`${field} must be bounded Unicode text`)
  }
  if (identifier && (!value || value !== pythonStrip(value))) {
    throw error(`${field} must be non-empty trimmed text`)
  }
  return value
}

function id(value: unknown, field: string, error: ErrorFactory): string {
  return text(value, 256, field, error, true)
}

function optionalId(value: unknown, field: string, error: ErrorFactory): string | null {
  return value === null ? null : id(value, field, error)
}

function sha(value: unknown, field: string, error: ErrorFactory): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw error(`${field} must be sha256`)
  return value
}

function optionalSha(value: unknown, field: string, error: ErrorFactory): string | null {
  return value === null ? null : sha(value, field, error)
}

function integer(value: unknown, minimum: number, field: string, error: ErrorFactory): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw error(`${field} must be a safe integer at least ${String(minimum)}`)
  }
  return value
}

function optionalNumber(value: unknown, field: string, error: ErrorFactory): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw error(`${field} must be a non-negative finite number or null`)
  }
  return value
}

function jcs(value: unknown, field: string, error: ErrorFactory, depth = 0): string {
  if (depth > 100) throw error(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw error(`${field} contains a lone Unicode surrogate`)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw error(`${field} contains an invalid number`)
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => jcs(item, `${field}[${String(index)}]`, error, depth + 1)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const item = value as Record<string, unknown>
    const keys = Object.keys(item).sort()
    if (keys.some(key => !key.isWellFormed())) throw error(`${field} contains an invalid key`)
    return `{${keys.map(key => `${JSON.stringify(key)}:${jcs(item[key], `${field}.${key}`, error, depth + 1)}`).join(',')}}`
  }
  throw error(`${field} must be RFC 8785 JSON`)
}

function jcsSha(value: unknown, field: string, error: ErrorFactory): string {
  return createHash('sha256').update(jcs(value, field, error), 'utf8').digest('hex')
}

function requestCoordinates(
  value: unknown,
  error: ErrorFactory,
): YimengSelectTakeVersionRequest {
  const item = exact(value, REQUEST_FIELDS, 'payload', error)
  const key = text(item.idempotencyKey, 200, 'idempotencyKey', error, true)
  if (!IDEMPOTENCY_KEY.test(key)) throw error('idempotencyKey must use visible ASCII')
  const request: YimengSelectTakeVersionRequest = {
    projectId: id(item.projectId, 'projectId', error),
    episodeId: id(item.episodeId, 'episodeId', error),
    frameId: id(item.frameId, 'frameId', error),
    expectedStackSha256: sha(item.expectedStackSha256, 'expectedStackSha256', error),
    expectedSelectedTakeId: optionalId(item.expectedSelectedTakeId, 'expectedSelectedTakeId', error),
    candidateTakeId: id(item.candidateTakeId, 'candidateTakeId', error),
    candidateVersionOrdinal: integer(item.candidateVersionOrdinal, 1, 'candidateVersionOrdinal', error),
    candidateOutputSha256: sha(item.candidateOutputSha256, 'candidateOutputSha256', error),
    idempotencyKey: key,
  }
  if (request.candidateTakeId === request.expectedSelectedTakeId) {
    throw error('candidateTakeId is already selected')
  }
  return request
}

function version(
  value: unknown,
  ordinal: number,
  helpers: TakeVersionHelpers,
): YimengTakeSelectionVersion {
  const error = helpers.responseError
  const item = exact(value, VERSION_FIELDS, `authoritativeStack.versions[${String(ordinal - 1)}]`, error)
  const source = item.source
  if (source !== 'initial' && source !== 'regenerate' && source !== 'repair' && source !== 'segment') {
    throw error('authoritativeStack version source mismatch')
  }
  const binding = item.outputBindingStatus
  if (binding !== 'verified' && binding !== 'recorded_sha_missing'
    && binding !== 'materialized_file_missing' && binding !== 'recorded_sha_mismatch') {
    throw error('authoritativeStack output binding mismatch')
  }
  if (typeof item.isSelected !== 'boolean' || typeof item.lineageComplete !== 'boolean'
    || typeof item.canAttemptSelection !== 'boolean'
    || (item.qualityPassed !== null && typeof item.qualityPassed !== 'boolean')
    || !Array.isArray(item.blockers)) {
    throw error('authoritativeStack version flags mismatch')
  }
  const blockers = item.blockers.map((entry, index) => (
    text(entry, 1024, `authoritativeStack.blockers[${String(index)}]`, error, true)
  ))
  if (new Set(blockers).size !== blockers.length
    || blockers.some((entry, index) => {
      const previous = blockers[index - 1]
      return previous !== undefined && entry < previous
    })) {
    throw error('authoritativeStack blockers are not canonical')
  }
  const result: YimengTakeSelectionVersion = {
    takeId: id(item.takeId, 'authoritativeStack.takeId', error),
    versionOrdinal: integer(item.versionOrdinal, 1, 'authoritativeStack.versionOrdinal', error),
    source,
    role: text(item.role, 1024, 'authoritativeStack.role', error),
    createdAt: helpers.requireTimestamp(
      text(item.createdAt, 128, 'authoritativeStack.createdAt', error, true),
      'authoritativeStack.createdAt',
    ),
    updatedAt: helpers.requireTimestamp(
      text(item.updatedAt, 128, 'authoritativeStack.updatedAt', error, true),
      'authoritativeStack.updatedAt',
    ),
    durationSec: optionalNumber(item.durationSec, 'authoritativeStack.durationSec', error),
    estimatedCny: optionalNumber(item.estimatedCny, 'authoritativeStack.estimatedCny', error),
    selectionStatus: text(item.selectionStatus, 1024, 'authoritativeStack.selectionStatus', error),
    isSelected: item.isSelected,
    qualityStatus: text(item.qualityStatus, 1024, 'authoritativeStack.qualityStatus', error),
    qualityPassed: item.qualityPassed,
    qualityCheckCount: integer(item.qualityCheckCount, 0, 'authoritativeStack.qualityCheckCount', error),
    blockers,
    recordedOutputSha256: optionalSha(item.recordedOutputSha256, 'authoritativeStack.recordedOutputSha256', error),
    outputSha256: optionalSha(item.outputSha256, 'authoritativeStack.outputSha256', error),
    outputBindingStatus: binding,
    taskId: optionalId(item.taskId, 'authoritativeStack.taskId', error),
    provider: item.provider === null ? null : text(item.provider, 1024, 'authoritativeStack.provider', error, true),
    model: item.model === null ? null : text(item.model, 1024, 'authoritativeStack.model', error, true),
    providerTaskId: optionalId(item.providerTaskId, 'authoritativeStack.providerTaskId', error),
    routeKey: item.routeKey === null ? null : text(item.routeKey, 1024, 'authoritativeStack.routeKey', error, true),
    inputHash: optionalSha(item.inputHash, 'authoritativeStack.inputHash', error),
    lineageComplete: item.lineageComplete,
    canAttemptSelection: item.canAttemptSelection,
  }
  const qualityPassed = result.qualityStatus === 'passed' ? true
    : result.qualityStatus === 'failed' ? false : null
  const lineageComplete = result.taskId !== null && result.provider !== null && result.model !== null
    && result.providerTaskId !== null && result.routeKey !== null && result.inputHash !== null
    && result.outputSha256 !== null && result.outputBindingStatus === 'verified'
  const canAttemptSelection = !result.isSelected && result.selectionStatus === 'Unselected'
    && result.outputSha256 !== null && result.outputBindingStatus === 'verified'
    && lineageComplete
  if (result.versionOrdinal !== ordinal || result.isSelected !== (result.selectionStatus === 'Selected')
    || result.qualityPassed !== qualityPassed || result.canAttemptSelection !== canAttemptSelection
    || result.lineageComplete !== lineageComplete) {
    throw error('authoritativeStack derived state mismatch')
  }
  return result
}

function stack(
  value: unknown,
  request: YimengSelectTakeVersionRequest,
  helpers: TakeVersionHelpers,
): YimengTakeSelectionStackSubject {
  const error = helpers.responseError
  const item = exact(value, STACK_FIELDS, 'authoritativeStack', error)
  if (item.schema !== 'jason.qingmu-take-version-stack-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || !Array.isArray(item.versions)) {
    throw error('authoritativeStack subject mismatch')
  }
  const versions = item.versions.map((entry, index) => version(entry, index + 1, helpers))
  const selected = versions.filter(entry => entry.isSelected)
  const selectedTakeId = optionalId(item.selectedTakeId, 'authoritativeStack.selectedTakeId', error)
  if (new Set(versions.map(entry => entry.takeId)).size !== versions.length
    || selected.length > 1 || (selected[0]?.takeId ?? null) !== selectedTakeId) {
    throw error('authoritativeStack selection is ambiguous')
  }
  return {
    schema: 'jason.qingmu-take-version-stack-subject.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    frameId: request.frameId,
    frameNo: integer(item.frameNo, 1, 'authoritativeStack.frameNo', error),
    storyboardRevision: integer(item.storyboardRevision, 0, 'authoritativeStack.storyboardRevision', error),
    frameContentSha256: sha(item.frameContentSha256, 'authoritativeStack.frameContentSha256', error),
    selectionRevision: integer(item.selectionRevision, 1, 'authoritativeStack.selectionRevision', error),
    selectedTakeId,
    versions,
  }
}

function normalizeResult(
  value: unknown,
  request: YimengSelectTakeVersionRequest,
  helpers: TakeVersionHelpers,
  token: string | null,
): YimengTakeVersionSelectionResult {
  const error = helpers.responseError
  const root = exact(value, RESULT_FIELDS, 'takeSelectionResult', error)
  if (root.schema !== 'jason.qingmu-take-selection-result.v1'
    || root.eventType !== 'TakeVersionSelected'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || root.frameId !== request.frameId || root.baseStackSnapshotSha256 !== request.expectedStackSha256
    || root.idempotencyKey !== request.idempotencyKey
    || root.selectionChanged !== true || root.providerCalls !== 0
    || root.paidProviderAuthority !== 'not_granted' || root.budgetMutation !== false
    || root.humanApprovalInferred !== false || root.formalApprovalChanged !== false
    || typeof root.deduplicated !== 'boolean') {
    throw error('takeSelectionResult binding or authority flags mismatch')
  }
  const selected = exact(root.selectedTake, ['takeId', 'versionOrdinal', 'outputSha256'], 'selectedTake', error)
  if (selected.takeId !== request.candidateTakeId
    || selected.versionOrdinal !== request.candidateVersionOrdinal
    || selected.outputSha256 !== request.candidateOutputSha256) {
    throw error('selectedTake differs from the submitted candidate')
  }
  const identity = exact(
    root.selectionIdentity,
    ['actorUserId', 'actorNaturalPersonId', 'actorRole', 'authSessionId'],
    'selectionIdentity',
    error,
  )
  const authSessionId = sha(identity.authSessionId, 'selectionIdentity.authSessionId', error)
  if (identity.actorRole !== 'project_owner_selector'
    || (token !== null && authSessionId !== createHash('sha256').update(token, 'utf8').digest('hex'))) {
    throw error('selectionIdentity binding mismatch')
  }
  const authoritativeStack = stack(root.authoritativeStack, request, helpers)
  const authoritativeStackSnapshotSha256 = sha(
    root.authoritativeStackSnapshotSha256,
    'authoritativeStackSnapshotSha256',
    error,
  )
  const authoritativeSelected = authoritativeStack.versions.find(entry => entry.takeId === request.candidateTakeId)
  if (authoritativeStack.selectedTakeId !== request.candidateTakeId
    || authoritativeSelected?.isSelected !== true
    || authoritativeSelected.versionOrdinal !== request.candidateVersionOrdinal
    || authoritativeSelected.outputSha256 !== request.candidateOutputSha256
    || authoritativeStackSnapshotSha256 !== jcsSha(authoritativeStack, 'authoritativeStack', error)) {
    throw error('authoritativeStack does not confirm the exact selection')
  }
  const taskMutation = exact(root.taskMutation, ['created', 'kind', 'taskId'], 'taskMutation', error)
  const provenanceTaskId = id(root.provenanceTaskId, 'provenanceTaskId', error)
  if (taskMutation.created !== true || taskMutation.kind !== 'local_selection_provenance'
    || taskMutation.taskId !== provenanceTaskId) {
    throw error('taskMutation exceeds local provenance authority')
  }
  return {
    schema: 'jason.qingmu-take-selection-result.v1',
    changeSetId: id(root.changeSetId, 'changeSetId', error),
    commandReceiptId: id(root.commandReceiptId, 'commandReceiptId', error),
    eventId: id(root.eventId, 'eventId', error),
    eventType: 'TakeVersionSelected',
    projectId: request.projectId,
    episodeId: request.episodeId,
    frameId: request.frameId,
    selectedTake: {
      takeId: request.candidateTakeId,
      versionOrdinal: request.candidateVersionOrdinal,
      outputSha256: request.candidateOutputSha256,
    },
    selectionIdentity: {
      actorUserId: id(identity.actorUserId, 'selectionIdentity.actorUserId', error),
      actorNaturalPersonId: id(
        identity.actorNaturalPersonId,
        'selectionIdentity.actorNaturalPersonId',
        error,
      ),
      actorRole: 'project_owner_selector',
      authSessionId,
    },
    baseStackSnapshotSha256: request.expectedStackSha256,
    authoritativeStack,
    authoritativeStackSnapshotSha256,
    provenanceTaskId,
    taskMutation: { created: true, kind: 'local_selection_provenance', taskId: provenanceTaskId },
    idempotencyKey: request.idempotencyKey,
    deduplicated: root.deduplicated,
    committedAt: helpers.requireTimestamp(
      text(root.committedAt, 128, 'committedAt', error, true),
      'committedAt',
    ),
    selectionChanged: true,
    providerCalls: 0,
    paidProviderAuthority: 'not_granted',
    budgetMutation: false,
    humanApprovalInferred: false,
    formalApprovalChanged: false,
  }
}

/** Prepare one selection POST or receipt GET. Neither path retries a write. */
export function prepareTakeVersionCommand(
  endpoint: 'selectTakeVersion' | 'recoverTakeVersionSelection',
  payload: unknown,
  helpers: TakeVersionHelpers,
): PreparedTakeVersionCommand {
  const request = requestCoordinates(payload, helpers.inputError)
  const rootPath = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
    + `/episodes/${encodeURIComponent(request.episodeId)}`
    + `/frames/${encodeURIComponent(request.frameId)}/take-versions`
  if (endpoint === 'selectTakeVersion') {
    return {
      path: `${rootPath}/selection`,
      request: {
        method: 'POST',
        body: {
          expectedStackSha256: request.expectedStackSha256,
          expectedSelectedTakeId: request.expectedSelectedTakeId,
          candidateTakeId: request.candidateTakeId,
          candidateVersionOrdinal: request.candidateVersionOrdinal,
          candidateOutputSha256: request.candidateOutputSha256,
          idempotencyKey: request.idempotencyKey,
        },
        idempotencyKey: request.idempotencyKey,
      },
      normalize: (value, token) => normalizeResult(value, request, helpers, token),
    }
  }
  const query = new URLSearchParams({
    expectedStackSha256: request.expectedStackSha256,
    candidateTakeId: request.candidateTakeId,
    candidateVersionOrdinal: String(request.candidateVersionOrdinal),
    candidateOutputSha256: request.candidateOutputSha256,
  })
  if (request.expectedSelectedTakeId !== null) {
    query.set('expectedSelectedTakeId', request.expectedSelectedTakeId)
  }
  return {
    path: `${rootPath}/selection-command-receipt?${query.toString()}`,
    request: { method: 'GET', idempotencyKey: request.idempotencyKey },
    normalize: (value) => {
      const error = helpers.responseError
      const root = exact(
        value,
        ['schema', ...REQUEST_FIELDS, 'status', 'result'],
        'takeSelectionRecovery',
        error,
      )
      if (root.schema !== 'jason.qingmu-take-selection-recovery.v1'
        || REQUEST_FIELDS.some(key => root[key] !== request[key])
        || (root.status !== 'committed' && root.status !== 'not_found')
        || (root.status === 'not_found' && root.result !== null)) {
        throw error('takeSelectionRecovery binding mismatch')
      }
      return {
        schema: 'jason.qingmu-take-selection-recovery.v1',
        ...request,
        status: root.status,
        result: root.status === 'committed'
          ? normalizeResult(root.result, request, helpers, null)
          : null,
      }
    },
  }
}
