/** Validate existing production-unit bindings without granting plan or Stage authority. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengProductionUnitBinding, YimengProductionUnitDefinition, YimengProductionUnitSource,
  YimengProductionUnitsRequest, YimengProductionUnitsResponse,
} from './types.ts'

type Digest = (value: unknown, field: string) => string

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('production units: unexpected fields')
  }
  return value as Record<string, unknown>
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}

function text(value: unknown, maximum = 8_000): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\u0000')
    || pythonStrip(value) === '' || Array.from(value).length > maximum) {
    throw new Error('production units: invalid text')
  }
  return value
}

function identifier(value: unknown): string {
  const result = text(value, 256)
  if (result !== pythonStrip(result) || /[\r\n]/.test(result)) {
    throw new Error('production units: invalid ID')
  }
  return result
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('production units: invalid SHA')
  }
  return value
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error('production units: invalid integer')
  }
  return value
}

/**
 * Preserve the two canonical coordinates without normalizing them into another episode.
 * @param payload - untrusted input containing only projectId and episodeId.
 * @returns the original identifiers after Python-compatible validation.
 */
export function parseProductionUnitsReadRequest(payload: unknown): YimengProductionUnitsRequest {
  const input = exact(payload, ['projectId', 'episodeId'])
  return { projectId: identifier(input.projectId), episodeId: identifier(input.episodeId) }
}

function source(
  value: unknown, request: YimengProductionUnitsRequest, groupId: string,
): YimengProductionUnitSource {
  const item = exact(value, ['schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title',
    'groupExecutionPromptSha256', 'storyboardRevision', 'shots'])
  if (item.schema !== 'jason.qingmu-production-unit-source.v1'
    || item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || item.groupId !== groupId || !Array.isArray(item.shots) || item.shots.length === 0) {
    throw new Error('production units: source mismatch')
  }
  const ids = new Set<string>()
  let previousFrameNo = 0
  const shots = item.shots.map((raw) => {
    const shot = exact(raw, ['frameId', 'frameNo', 'frameContentSha256'])
    const frameId = identifier(shot.frameId)
    const frameNo = integer(shot.frameNo, 1)
    if (ids.has(frameId) || frameNo <= previousFrameNo) {
      throw new Error('production units: invalid Shot order')
    }
    ids.add(frameId)
    previousFrameNo = frameNo
    return { frameId, frameNo, frameContentSha256: sha(shot.frameContentSha256) }
  })
  return {
    schema: 'jason.qingmu-production-unit-source.v1', ...request, groupId,
    groupNo: integer(item.groupNo, 1), title: text(item.title),
    groupExecutionPromptSha256: sha(item.groupExecutionPromptSha256),
    storyboardRevision: integer(item.storyboardRevision), shots,
  }
}

function definition(value: unknown): YimengProductionUnitDefinition {
  const item = exact(value, ['id', 'version', 'unitIdPattern', 'scope', 'stages', 'operation',
    'planSealingAllowed', 'stageApprovalAllowed', 'providerCalls'])
  if (item.id !== 'IMAGO-V6-LSU' || item.unitIdPattern !== 'LSU[0-9]{2,}' || item.scope !== 'per_lsu'
    || item.operation !== 'bind_existing_shot_group' || item.planSealingAllowed !== false
    || item.stageApprovalAllowed !== false || item.providerCalls !== 0
    || !Array.isArray(item.stages) || item.stages.length === 0) {
    throw new Error('production units: invalid method authority')
  }
  const ids = new Set<string>()
  const stages = item.stages.map((raw) => {
    const stage = exact(raw, ['stageId', 'roleId', 'contractSha256'])
    const stageId = identifier(stage.stageId)
    if (ids.has(stageId)) throw new Error('production units: repeated Stage')
    ids.add(stageId)
    return { stageId, roleId: identifier(stage.roleId), contractSha256: sha(stage.contractSha256) }
  })
  return {
    id: 'IMAGO-V6-LSU', version: identifier(item.version), unitIdPattern: 'LSU[0-9]{2,}', scope: 'per_lsu',
    stages, operation: 'bind_existing_shot_group', planSealingAllowed: false,
    stageApprovalAllowed: false, providerCalls: 0,
  }
}

function binding(
  value: unknown, request: YimengProductionUnitsRequest, digest: Digest,
): YimengProductionUnitBinding {
  const item = exact(value, ['unitId', 'groupId', 'projectId', 'episodeId', 'revision', 'source',
    'sourceSnapshotSha256', 'methodProjectionSha256', 'rulesSha256', 'definition', 'actorId',
    'authSessionId', 'eventId', 'changeSetId', 'createdAt'])
  const groupId = identifier(item.groupId)
  const unitId = identifier(item.unitId)
  if (item.projectId !== request.projectId || item.episodeId !== request.episodeId
    || !/^LSU[0-9]{2,}$/.test(unitId)) throw new Error('production units: binding identity mismatch')
  const boundSource = source(item.source, request, groupId)
  const sourceSnapshotSha256 = sha(item.sourceSnapshotSha256)
  if (sourceSnapshotSha256 !== digest(boundSource, 'binding.source')) {
    throw new Error('production units: source hash mismatch')
  }
  return {
    ...request, unitId, groupId, revision: integer(item.revision, 1), source: boundSource,
    sourceSnapshotSha256, methodProjectionSha256: sha(item.methodProjectionSha256),
    rulesSha256: sha(item.rulesSha256), definition: definition(item.definition),
    actorId: identifier(item.actorId), authSessionId: sha(item.authSessionId),
    eventId: identifier(item.eventId), changeSetId: identifier(item.changeSetId), createdAt: text(item.createdAt, 128),
  }
}

/**
 * Validate current group sources and immutable bindings from the existing Yimeng ledger.
 * @param value - bounded, token-scrubbed upstream JSON.
 * @param request - exact project and episode identifiers.
 * @param digest - the Host's Python-compatible canonical JSON SHA function.
 * @returns the unchanged valid feed, without a write, plan seal, approval, or Provider call.
 */
export function normalizeProductionUnitsFeed(
  value: unknown, request: YimengProductionUnitsRequest, digest: Digest,
): YimengProductionUnitsResponse {
  const root = exact(value, ['schema', 'projectId', 'episodeId', 'capabilities', 'groups', 'bindings',
    'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])
  if (root.schema !== 'jason.qingmu-production-unit-feed.v1'
    || root.projectId !== request.projectId || root.episodeId !== request.episodeId
    || !Array.isArray(root.groups) || !Array.isArray(root.bindings) || root.planSealed !== false
    || root.providerCalls !== 0 || root.humanSignoffInferred !== false || root.reworkExecuted !== false) {
    throw new Error('production units: feed identity or authority mismatch')
  }
  const capabilities = exact(root.capabilities, ['canBindUnit'])
  if (typeof capabilities.canBindUnit !== 'boolean') throw new Error('production units: invalid capabilities')
  const current = new Map<string, YimengProductionUnitsResponse['groups'][number]>()
  const groups = root.groups.map((raw): YimengProductionUnitsResponse['groups'][number] => {
    const group = exact(raw, ['groupId', 'subject', 'snapshotSha256', 'availability'])
    const groupId = identifier(group.groupId)
    if (current.has(groupId)) throw new Error('production units: repeated group')
    const subject = group.subject === null ? null : source(group.subject, request, groupId)
    const snapshotSha256 = group.snapshotSha256 === null ? null : sha(group.snapshotSha256)
    const availability = exact(group.availability, ['status', 'reason'])
    if ((subject === null && (snapshotSha256 !== null || availability.status !== 'unavailable'))
      || (subject !== null && (snapshotSha256 !== digest(subject, 'group.subject')
        || availability.status !== 'available' || availability.reason !== null))) {
      throw new Error('production units: group source or availability mismatch')
    }
    const result: YimengProductionUnitsResponse['groups'][number] = {
      groupId, subject, snapshotSha256,
      availability: {
        status: subject === null ? 'unavailable' : 'available',
        reason: subject === null ? text(availability.reason) : null,
      },
    }
    current.set(groupId, result)
    return result
  })
  const unitIds = new Set<string>()
  const groupIds = new Set<string>()
  const events = new Set<string>()
  const changeSets = new Set<string>()
  const bindings = root.bindings.map((raw) => {
    const item = exact(raw, ['binding', 'bindingSha256', 'currentBinding'])
    const record = binding(item.binding, request, digest)
    const bindingSha256 = sha(item.bindingSha256)
    const group = current.get(record.groupId)
    const currentBinding = group?.subject !== null && group?.subject !== undefined
      && group.snapshotSha256 === record.sourceSnapshotSha256 && isDeepStrictEqual(group.subject, record.source)
    if (bindingSha256 !== digest(record, 'binding') || typeof item.currentBinding !== 'boolean'
      || item.currentBinding !== currentBinding || unitIds.has(record.unitId) || groupIds.has(record.groupId)
      || events.has(record.eventId) || changeSets.has(record.changeSetId)) {
      throw new Error('production units: inconsistent binding history')
    }
    unitIds.add(record.unitId)
    groupIds.add(record.groupId)
    events.add(record.eventId)
    changeSets.add(record.changeSetId)
    return { binding: record, bindingSha256, currentBinding }
  })
  return {
    schema: 'jason.qingmu-production-unit-feed.v1', ...request,
    capabilities: { canBindUnit: capabilities.canBindUnit }, groups, bindings,
    planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false,
  }
}
