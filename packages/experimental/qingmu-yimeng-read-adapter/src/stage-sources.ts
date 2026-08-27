/** Verify current full-script sources and sealed references without inferring approval. */
import { isDeepStrictEqual } from 'node:util'
import type {
  YimengStageSource, YimengStageSourceBinding, YimengStageSourceDefinition,
  YimengStageSourceResult, YimengStageSourcesRequest, YimengStageSourcesResponse,
} from './types.ts'

type Digest = (value: unknown, field: string) => string
const FLAGS = { stageArtifactCreated: false, stageApprovalGranted: false, lockActivated: false,
  planSealed: false, providerCalls: 0, humanSignoffInferred: false, reworkExecuted: false } as const

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('stage sources: unexpected fields')
  }
  return value as Record<string, unknown>
}
function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}
function text(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
    || pythonStrip(value) === '' || Array.from(value).length > maximum) throw new Error('stage sources: invalid text')
  return value
}
function identifier(value: unknown): string {
  const result = text(value)
  if (result !== pythonStrip(result) || /[\r\n]/u.test(result)) throw new Error('stage sources: invalid ID')
  return result
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/u.test(value)) throw new Error('stage sources: invalid SHA')
  return value
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('stage sources: invalid revision')
  return value
}

/** Preserve exact canonical IDs rather than trimming them into another source.
 * @param payload - Only projectId and episodeId are accepted.
 * @returns The unchanged, Python-compatible identifiers.
 */
export function parseStageSourcesReadRequest(payload: unknown): YimengStageSourcesRequest {
  const raw = exact(payload, ['projectId', 'episodeId'])
  return { projectId: identifier(raw.projectId), episodeId: identifier(raw.episodeId) }
}

function source(value: unknown, request: YimengStageSourcesRequest): YimengStageSource {
  const raw = exact(value, ['schema', 'projectId', 'episodeId', 'sourceType', 'sourceId', 'revision', 'contentSha256'])
  if (raw.schema !== 'jason.qingmu-stage-source.v1' || raw.sourceType !== 'episode_script'
    || raw.projectId !== request.projectId || raw.episodeId !== request.episodeId || raw.sourceId !== request.episodeId) {
    throw new Error('stage sources: source identity mismatch')
  }
  return { schema: 'jason.qingmu-stage-source.v1', projectId: identifier(raw.projectId), episodeId: identifier(raw.episodeId),
    sourceType: 'episode_script', sourceId: identifier(raw.sourceId), revision: integer(raw.revision), contentSha256: sha(raw.contentSha256) }
}

function definition(value: unknown): YimengStageSourceDefinition {
  const raw = exact(value, ['id', 'version', 'stageId', 'roleId', 'scope', 'contractSha256', 'artifactKind', 'canonicalOutput',
    'sourceType', 'sourceUsage', 'operation', 'stageArtifactCreationAllowed', 'stageApprovalAllowed', 'providerCalls'])
  if (raw.id !== 'IMAGO-V6-A1S-SOURCE' || raw.stageId !== 'A1S' || raw.roleId !== 'A1S' || raw.scope !== 'global'
    || raw.artifactKind !== 'SCREENPLAY_PACKAGE' || raw.canonicalOutput !== 'inputs/screenplay-package.json'
    || raw.sourceType !== 'episode_script' || raw.sourceUsage !== 'source_reference_only'
    || raw.operation !== 'bind_existing_episode_script_source' || raw.stageArtifactCreationAllowed !== false
    || raw.stageApprovalAllowed !== false || raw.providerCalls !== 0) throw new Error('stage sources: invalid method authority')
  return { id: 'IMAGO-V6-A1S-SOURCE', version: identifier(raw.version), stageId: 'A1S', roleId: 'A1S', scope: 'global',
    contractSha256: sha(raw.contractSha256), artifactKind: 'SCREENPLAY_PACKAGE', canonicalOutput: 'inputs/screenplay-package.json',
    sourceType: 'episode_script', sourceUsage: 'source_reference_only', operation: 'bind_existing_episode_script_source',
    stageArtifactCreationAllowed: false, stageApprovalAllowed: false, providerCalls: 0 }
}

function result(value: unknown, request: YimengStageSourcesRequest, digest: Digest): YimengStageSourceResult {
  const root = exact(value, ['schema', 'binding', 'bindingSha256', 'receiptId', 'outboxEventId'])
  if (root.schema !== 'jason.qingmu-stage-source-result.v1') throw new Error('stage sources: invalid receipt schema')
  const raw = exact(root.binding, ['schema', 'changeSetId', 'projectId', 'episodeId', 'stageId', 'source', 'subjectSnapshotSha256',
    'definition', 'methodProjectionSha256', 'rulesSha256', 'bindingRevision', 'actorId', 'authSessionId', 'createdAt', ...Object.keys(FLAGS)])
  if (raw.schema !== 'jason.qingmu-stage-source-binding.v1' || raw.projectId !== request.projectId
    || raw.episodeId !== request.episodeId || raw.stageId !== 'A1S'
    || Object.entries(FLAGS).some(([key, expected]) => raw[key] !== expected)) throw new Error('stage sources: receipt identity or authority mismatch')
  const boundSource = source(raw.source, request)
  const subjectSnapshotSha256 = sha(raw.subjectSnapshotSha256)
  if (subjectSnapshotSha256 !== digest(boundSource, 'binding.source')) throw new Error('stage sources: sealed source SHA mismatch')
  const binding: YimengStageSourceBinding = { schema: 'jason.qingmu-stage-source-binding.v1', ...request,
    changeSetId: identifier(raw.changeSetId), stageId: 'A1S', source: boundSource, subjectSnapshotSha256,
    definition: definition(raw.definition), methodProjectionSha256: sha(raw.methodProjectionSha256), rulesSha256: sha(raw.rulesSha256),
    bindingRevision: integer(raw.bindingRevision, 1), actorId: identifier(raw.actorId), authSessionId: sha(raw.authSessionId),
    createdAt: text(raw.createdAt, 128), ...FLAGS }
  const bindingSha256 = sha(root.bindingSha256)
  if (bindingSha256 !== digest(binding, 'binding')) throw new Error('stage sources: binding SHA mismatch')
  return { schema: 'jason.qingmu-stage-source-result.v1', binding, bindingSha256,
    receiptId: identifier(root.receiptId), outboxEventId: identifier(root.outboxEventId) }
}

/** Verify the latest reference and derive currentness only from the full source descriptor.
 * @param value - Bounded, token-scrubbed upstream JSON.
 * @param request - Exact project and episode coordinates.
 * @param digest - Existing Python-compatible canonical JSON SHA function.
 * @returns A detached feed, retaining historical evidence when the source is missing or changed.
 */
export function normalizeStageSourcesFeed(value: unknown, request: YimengStageSourcesRequest, digest: Digest): YimengStageSourcesResponse {
  const root = exact(value, ['schema', 'projectId', 'episodeId', 'stageId', 'canBind', 'source', 'subjectSnapshotSha256',
    'unavailableReason', 'bindingRevision', 'bindingSha256', 'latestBinding', 'currentBinding'])
  if (root.schema !== 'jason.qingmu-stage-source-feed.v1' || root.projectId !== request.projectId
    || root.episodeId !== request.episodeId || root.stageId !== 'A1S' || typeof root.canBind !== 'boolean') {
    throw new Error('stage sources: feed identity mismatch')
  }
  const currentSource = root.source === null ? null : source(root.source, request)
  const subjectSnapshotSha256 = root.subjectSnapshotSha256 === null ? null : sha(root.subjectSnapshotSha256)
  const unavailableReason = root.unavailableReason === null ? null : text(root.unavailableReason, 8000)
  if ((currentSource === null && (subjectSnapshotSha256 !== null || unavailableReason === null))
    || (currentSource !== null && (unavailableReason !== null || subjectSnapshotSha256 !== digest(currentSource, 'source')))) {
    throw new Error('stage sources: source availability mismatch')
  }
  const latestBinding = root.latestBinding === null ? null : result(root.latestBinding, request, digest)
  const bindingRevision = integer(root.bindingRevision)
  const bindingSha256 = root.bindingSha256 === null ? null : sha(root.bindingSha256)
  if ((latestBinding === null && (bindingRevision !== 0 || bindingSha256 !== null))
    || (latestBinding !== null && (bindingRevision !== latestBinding.binding.bindingRevision
      || bindingSha256 !== latestBinding.bindingSha256))) {
    throw new Error('stage sources: latest binding coordinates mismatch')
  }
  const currentBinding = latestBinding !== null && currentSource !== null
    && latestBinding.binding.subjectSnapshotSha256 === subjectSnapshotSha256
    && isDeepStrictEqual(latestBinding.binding.source, currentSource) ? latestBinding : null
  if (!isDeepStrictEqual(root.currentBinding, currentBinding)) throw new Error('stage sources: historical reference presented as current')
  return { schema: 'jason.qingmu-stage-source-feed.v1', ...request, stageId: 'A1S', canBind: root.canBind,
    source: currentSource, subjectSnapshotSha256, unavailableReason, bindingRevision, bindingSha256, latestBinding, currentBinding }
}
