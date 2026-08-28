/** Validate one existing Yimeng Take/version stack without creating new state. */
import type {
  YimengTakeVersion,
  YimengTakeVersionRequest,
  YimengTakeVersionStackResponse,
  YimengTakeVersionStackSubject,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

const VERSION_FIELDS = [
  'takeId', 'versionOrdinal', 'source', 'role', 'createdAt', 'updatedAt',
  'durationSec', 'estimatedCny', 'selectionStatus', 'isSelected', 'qualityStatus',
  'qualityPassed', 'qualityCheckCount', 'blockers', 'recordedOutputSha256',
  'outputSha256', 'outputBindingStatus', 'taskId', 'provider', 'model',
  'providerTaskId', 'routeKey', 'inputHash', 'lineageComplete', 'canAttemptSelection',
] as const

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`take versions: ${field} fields mismatch`)
  }
  return value as Record<string, unknown>
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, field: string, maximum = 1024, nonempty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || /[\r\n]/u.test(value) || Array.from(value).length > maximum
    || (nonempty && pythonStrip(value) === '')) {
    throw new Error(`take versions: ${field} is invalid`)
  }
  return value
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 256, true)
  if (result !== pythonStrip(result)) throw new Error(`take versions: ${field} is invalid`)
  return result
}

function sha(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`take versions: ${field} is invalid`)
  }
  return value
}

function optionalSha(value: unknown, field: string): string | null {
  return value === null ? null : sha(value, field)
}

function optionalId(value: unknown, field: string): string | null {
  return value === null ? null : id(value, field)
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`take versions: ${field} is invalid`)
  }
  return value
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`take versions: ${field} is invalid`)
  }
  return value
}

/**
 * Accept only the three canonical coordinates from the untrusted browser.
 * @param payload - Untrusted command payload to validate.
 * @returns Validated YimengTakeVersionRequest value.
 */
export function parseTakeVersionReadRequest(payload: unknown): YimengTakeVersionRequest {
  const input = exact(payload, ['projectId', 'episodeId', 'frameId'], 'request')
  return {
    projectId: id(input.projectId, 'projectId'),
    episodeId: id(input.episodeId, 'episodeId'),
    frameId: id(input.frameId, 'frameId'),
  }
}

function version(value: unknown, ordinal: number): YimengTakeVersion {
  const item = exact(value, VERSION_FIELDS, `versions[${String(ordinal - 1)}]`)
  const source = item.source
  if (source !== 'initial' && source !== 'regenerate' && source !== 'repair' && source !== 'segment') {
    throw new Error('take versions: source is invalid')
  }
  const outputBindingStatus = item.outputBindingStatus
  if (outputBindingStatus !== 'verified' && outputBindingStatus !== 'recorded_sha_missing'
    && outputBindingStatus !== 'materialized_file_missing' && outputBindingStatus !== 'recorded_sha_mismatch') {
    throw new Error('take versions: output binding is invalid')
  }
  if (typeof item.isSelected !== 'boolean' || typeof item.lineageComplete !== 'boolean'
    || typeof item.canAttemptSelection !== 'boolean'
    || (item.qualityPassed !== null && typeof item.qualityPassed !== 'boolean')
    || !Array.isArray(item.blockers)) {
    throw new Error('take versions: flags are invalid')
  }
  const blockers = item.blockers.map((entry, index) => text(entry, `blockers[${String(index)}]`, 1024, true))
  if (new Set(blockers).size !== blockers.length || blockers.some((entry, index) => {
    const previous = blockers[index - 1]
    return previous !== undefined && entry < previous
  })) {
    throw new Error('take versions: blockers are not canonical')
  }
  const result: YimengTakeVersion = {
    takeId: id(item.takeId, 'takeId'),
    versionOrdinal: integer(item.versionOrdinal, 'versionOrdinal', 1),
    source,
    role: text(item.role, 'role'),
    createdAt: text(item.createdAt, 'createdAt'),
    updatedAt: text(item.updatedAt, 'updatedAt'),
    durationSec: optionalNumber(item.durationSec, 'durationSec'),
    estimatedCny: optionalNumber(item.estimatedCny, 'estimatedCny'),
    selectionStatus: text(item.selectionStatus, 'selectionStatus'),
    isSelected: item.isSelected,
    qualityStatus: text(item.qualityStatus, 'qualityStatus'),
    qualityPassed: item.qualityPassed,
    qualityCheckCount: integer(item.qualityCheckCount, 'qualityCheckCount'),
    blockers,
    recordedOutputSha256: optionalSha(item.recordedOutputSha256, 'recordedOutputSha256'),
    outputSha256: optionalSha(item.outputSha256, 'outputSha256'),
    outputBindingStatus,
    taskId: optionalId(item.taskId, 'taskId'),
    provider: item.provider === null ? null : text(item.provider, 'provider', 1024, true),
    model: item.model === null ? null : text(item.model, 'model', 1024, true),
    providerTaskId: optionalId(item.providerTaskId, 'providerTaskId'),
    routeKey: item.routeKey === null ? null : text(item.routeKey, 'routeKey', 1024, true),
    inputHash: optionalSha(item.inputHash, 'inputHash'),
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
    throw new Error('take versions: derived state is inconsistent')
  }
  return result
}

function subject(value: unknown, request: YimengTakeVersionRequest): YimengTakeVersionStackSubject {
  const item = exact(value, [
    'schema', 'projectId', 'episodeId', 'frameId', 'frameNo', 'storyboardRevision',
    'frameContentSha256', 'selectionRevision', 'selectedTakeId', 'versions',
  ], 'subject')
  if (item.schema !== 'jason.qingmu-take-version-stack-subject.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.frameId !== request.frameId || !Array.isArray(item.versions)) {
    throw new Error('take versions: subject mismatch')
  }
  const versions = item.versions.map((entry, index) => version(entry, index + 1))
  const ids = new Set(versions.map(entry => entry.takeId))
  const selected = versions.filter(entry => entry.isSelected)
  const selectedTakeId = optionalId(item.selectedTakeId, 'selectedTakeId')
  if (ids.size !== versions.length || selected.length > 1
    || (selected[0]?.takeId ?? null) !== selectedTakeId) {
    throw new Error('take versions: selection is ambiguous')
  }
  return {
    schema: 'jason.qingmu-take-version-stack-subject.v1', ...request,
    frameNo: integer(item.frameNo, 'frameNo', 1),
    storyboardRevision: integer(item.storyboardRevision, 'storyboardRevision'),
    frameContentSha256: sha(item.frameContentSha256, 'frameContentSha256'),
    selectionRevision: integer(item.selectionRevision, 'selectionRevision'),
    selectedTakeId,
    versions,
  }
}

/**
 * Validate identity, content hash, authority boundaries, and every derived version flag.
 * @param value - Untrusted value to validate and normalize.
 * @param request - Request coordinates and payload to process.
 * @param digest - Expected SHA-256 digest for the canonical value.
 * @returns Validated YimengTakeVersionStackResponse value.
 */
export function normalizeTakeVersionStack(
  value: unknown,
  request: YimengTakeVersionRequest,
  digest: Digest,
): YimengTakeVersionStackResponse {
  const root = exact(value, ['schema', 'subject', 'stackSnapshotSha256', 'capabilities', 'boundaries'], 'feed')
  if (root.schema !== 'jason.qingmu-take-version-stack.v1') throw new Error('take versions: schema mismatch')
  const normalizedSubject = subject(root.subject, request)
  const stackSnapshotSha256 = sha(root.stackSnapshotSha256, 'stackSnapshotSha256')
  const capabilities = exact(root.capabilities, ['canCompare', 'canSelect'], 'capabilities')
  const boundaries = exact(root.boundaries, [
    'takeIdAuthority', 'versionOrdinalPersistence', 'versionOrdinalRule',
    'selectedIsApproval', 'formalApprovalChanged', 'providerAuthority',
  ], 'boundaries')
  if (stackSnapshotSha256 !== digest(normalizedSubject, 'takeVersionStack.subject')
    || capabilities.canCompare !== true || typeof capabilities.canSelect !== 'boolean'
    || boundaries.takeIdAuthority !== 'yimeng.assets.id'
    || boundaries.versionOrdinalPersistence !== false
    || boundaries.versionOrdinalRule !== 'created_at_then_asset_id_ascending'
    || boundaries.selectedIsApproval !== false || boundaries.formalApprovalChanged !== false
    || boundaries.providerAuthority !== 'not_granted') {
    throw new Error('take versions: hash or authority boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-take-version-stack.v1', subject: normalizedSubject, stackSnapshotSha256,
    capabilities: { canCompare: true, canSelect: capabilities.canSelect },
    boundaries: {
      takeIdAuthority: 'yimeng.assets.id', versionOrdinalPersistence: false,
      versionOrdinalRule: 'created_at_then_asset_id_ascending', selectedIsApproval: false,
      formalApprovalChanged: false, providerAuthority: 'not_granted',
    },
  }
}
