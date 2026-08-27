/** Browser validation and tab-local recovery coordinates for explicit scope registration. */
/* oxlint-disable typescript/no-unnecessary-condition -- Private RPC and sessionStorage values are untrusted at runtime. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Exact authority flags must be checked on wire values. */
import type {
  ImagoProductionUnitMethodResponse, YimengProductionUnitBinding, YimengProductionUnitDefinition,
  YimengProductionUnitRecovery, YimengProductionUnitResult, YimengProductionUnitSource,
  YimengProductionUnitsRequest, YimengProductionUnitsResponse, YimengWorkflowProjection,
} from './contracts.ts'
import { digestShotFinding } from './shot-finding-contract.ts'

type Scope = YimengProductionUnitsRequest

/** An existing group with its current, validated source; this is not an approved production plan. */
export type AvailableProductionUnitGroup = YimengProductionUnitsResponse['groups'][number] & {
  readonly subject: YimengProductionUnitSource
  readonly snapshotSha256: string
}

function requireUnit(condition: boolean): asserts condition {
  if (!condition) throw new Error('Production-unit source, method, or receipt mismatch')
}
function exact(value: unknown, keys: readonly string[]): void {
  requireUnit(typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)))
}
function array(value: unknown): boolean {
  return Array.isArray(value)
}
function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}
function text(value: unknown, maximum = 8_000): value is string {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\u0000')
    && pythonStrip(value) !== '' && Array.from(value).length <= maximum
}
function identifier(value: unknown): value is string {
  return text(value, 256) && value === pythonStrip(value) && !/[\r\n]/.test(value)
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
function flags(value: { planSealed: unknown; providerCalls: unknown; humanSignoffInferred: unknown; reworkExecuted: unknown }) {
  requireUnit(value.planSealed === false && value.providerCalls === 0
    && value.humanSignoffInferred === false && value.reworkExecuted === false)
}

/**
 * Check an explicitly entered unit ID without assigning or rewriting it.
 * @param value - The original form text.
 * @returns Whether it follows the current unit-ID grammar.
 */
export function validProductionUnitId(value: unknown): value is string {
  return identifier(value) && /^LSU[0-9]{2,}$/.test(value)
}

async function source(value: YimengProductionUnitSource, expectedSha: string, scope: Scope, groupId: string) {
  exact(value, ['schema', 'projectId', 'episodeId', 'groupId', 'groupNo', 'title',
    'groupExecutionPromptSha256', 'storyboardRevision', 'shots'])
  requireUnit(value.schema === 'jason.qingmu-production-unit-source.v1'
    && value.projectId === scope.projectId && value.episodeId === scope.episodeId && value.groupId === groupId
    && [value.projectId, value.episodeId, value.groupId].every(identifier)
    && integer(value.groupNo, 1) && text(value.title) && sha(value.groupExecutionPromptSha256)
    && integer(value.storyboardRevision) && array(value.shots) && value.shots.length > 0 && sha(expectedSha))
  const ids = new Set<string>()
  let previous = 0
  for (const shot of value.shots) {
    exact(shot, ['frameId', 'frameNo', 'frameContentSha256'])
    requireUnit(identifier(shot.frameId) && integer(shot.frameNo, 1) && shot.frameNo > previous
      && !ids.has(shot.frameId) && sha(shot.frameContentSha256))
    ids.add(shot.frameId)
    previous = shot.frameNo
  }
  requireUnit(await digestShotFinding(value) === expectedSha)
}
function definition(value: YimengProductionUnitDefinition) {
  exact(value, ['id', 'version', 'unitIdPattern', 'scope', 'stages', 'operation',
    'planSealingAllowed', 'stageApprovalAllowed', 'providerCalls'])
  requireUnit(value.id === 'IMAGO-V6-LSU' && identifier(value.version) && value.unitIdPattern === 'LSU[0-9]{2,}'
    && value.scope === 'per_lsu' && value.operation === 'bind_existing_shot_group'
    && value.planSealingAllowed === false && value.stageApprovalAllowed === false && value.providerCalls === 0
    && array(value.stages) && value.stages.length > 0)
  const stages = new Set<string>()
  for (const stage of value.stages) {
    exact(stage, ['stageId', 'roleId', 'contractSha256'])
    requireUnit(identifier(stage.stageId) && identifier(stage.roleId) && sha(stage.contractSha256) && !stages.has(stage.stageId))
    stages.add(stage.stageId)
  }
}
async function binding(value: YimengProductionUnitBinding, bindingSha: string, scope: Scope) {
  exact(value, ['unitId', 'groupId', 'projectId', 'episodeId', 'revision', 'source', 'sourceSnapshotSha256',
    'methodProjectionSha256', 'rulesSha256', 'definition', 'actorId', 'authSessionId', 'eventId', 'changeSetId', 'createdAt'])
  requireUnit(value.projectId === scope.projectId && value.episodeId === scope.episodeId
    && validProductionUnitId(value.unitId) && identifier(value.groupId) && integer(value.revision, 1)
    && [value.actorId, value.eventId, value.changeSetId].every(identifier)
    && [value.authSessionId, value.methodProjectionSha256, value.rulesSha256, bindingSha].every(sha)
    && text(value.createdAt, 128))
  await source(value.source, value.sourceSnapshotSha256, scope, value.groupId)
  definition(value.definition)
  requireUnit(await digestShotFinding(value) === bindingSha)
}

/**
 * Validate current sources and sealed binding heads before sharing the feed with Finding details.
 * @param feed - The private read RPC response.
 * @param scope - Exact project and episode selected in the workspace.
 * @returns Resolves only for an internally consistent, non-approving feed.
 */
export async function verifyProductionUnitFeed(feed: YimengProductionUnitsResponse, scope: Scope): Promise<void> {
  exact(feed, ['schema', 'projectId', 'episodeId', 'capabilities', 'groups', 'bindings',
    'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])
  requireUnit(feed.schema === 'jason.qingmu-production-unit-feed.v1'
    && feed.projectId === scope.projectId && feed.episodeId === scope.episodeId
    && [feed.projectId, feed.episodeId].every(identifier) && array(feed.groups) && array(feed.bindings))
  flags(feed)
  exact(feed.capabilities, ['canBindUnit'])
  requireUnit(typeof feed.capabilities.canBindUnit === 'boolean')
  const groups = new Map<string, YimengProductionUnitsResponse['groups'][number]>()
  for (const group of feed.groups) {
    exact(group, ['groupId', 'subject', 'snapshotSha256', 'availability'])
    exact(group.availability, ['status', 'reason'])
    requireUnit(identifier(group.groupId) && !groups.has(group.groupId))
    if (group.subject === null) {
      requireUnit(group.snapshotSha256 === null && group.availability.status === 'unavailable' && text(group.availability.reason))
    } else {
      requireUnit(sha(group.snapshotSha256) && group.availability.status === 'available' && group.availability.reason === null)
      await source(group.subject, group.snapshotSha256, scope, group.groupId)
    }
    groups.set(group.groupId, group)
  }
  const units = new Set<string>()
  const boundGroups = new Set<string>()
  const events = new Set<string>()
  const changes = new Set<string>()
  for (const item of feed.bindings) {
    exact(item, ['binding', 'bindingSha256', 'currentBinding'])
    await binding(item.binding, item.bindingSha256, scope)
    const current = groups.get(item.binding.groupId)
    requireUnit(typeof item.currentBinding === 'boolean'
      && item.currentBinding === (current?.subject !== null && current?.subject !== undefined
        && current.snapshotSha256 === item.binding.sourceSnapshotSha256)
      && !units.has(item.binding.unitId) && !boundGroups.has(item.binding.groupId)
      && !events.has(item.binding.eventId) && !changes.has(item.binding.changeSetId))
    units.add(item.binding.unitId)
    boundGroups.add(item.binding.groupId)
    events.add(item.binding.eventId)
    changes.add(item.binding.changeSetId)
  }
}

/**
 * Offer only existing groups containing this canonical Shot in the visible storyboard revision.
 * @param feed - Previously validated authoritative feed.
 * @param projection - Current workflow read result; it does not expose a per-Shot content SHA.
 * @param selectedShotId - The explicit canonical Shot selection.
 * @returns Available source groups, without creating groups or inferring unit IDs.
 */
export function productionUnitGroupsForShot(
  feed: YimengProductionUnitsResponse, projection: YimengWorkflowProjection, selectedShotId: string,
): readonly AvailableProductionUnitGroup[] {
  if (feed.projectId !== projection.projectId || feed.episodeId !== projection.episodeId) return []
  const relations = projection.director.shotRelations
  return feed.groups.filter((group): group is AvailableProductionUnitGroup => group.subject !== null
    && group.snapshotSha256 !== null && group.availability.status === 'available'
    && group.subject.storyboardRevision === relations.storyboardRevision.episodeRevision
    && group.subject.shots.some(shot => shot.frameId === selectedShotId)
    && group.subject.shots.every(shot => relations.shots.some(current => current.shotId === shot.frameId
      && current.frameNo === shot.frameNo)))
}

/**
 * Verify source and proof coordinates; secret-key verification remains exclusively on Host.
 * @param method - The private method RPC response.
 * @param group - The explicitly selected, validated source group.
 * @returns Resolves only when all source, rules and projection digests agree.
 */
export async function verifyProductionUnitMethod(
  method: ImagoProductionUnitMethodResponse, group: AvailableProductionUnitGroup,
): Promise<void> {
  exact(method, ['schema', 'projection', 'projectionSha256', 'methodAttestation'])
  const projection = method.projection
  exact(projection, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
  requireUnit(method.schema === 'qingmu.imago-production-unit-method-adapter-result.v1'
    && projection.schema === 'qingmu.imago-production-unit-method.v1'
    && projection.subjectSnapshotSha256 === group.snapshotSha256 && sha(method.projectionSha256) && sha(projection.rulesSha256)
    && typeof projection.ruleBindings === 'object' && projection.ruleBindings !== null && !array(projection.ruleBindings)
    && Object.keys(projection.ruleBindings).length > 0
    && Object.entries(projection.ruleBindings).every(([path, digest]) => identifier(path) && !path.includes('\\')
      && path.split('/').every(part => part !== '' && part !== '.' && part !== '..') && sha(digest)))
  await source(projection.subject, group.snapshotSha256, group.subject, group.groupId)
  definition(projection.definition)
  const proof = method.methodAttestation
  exact(proof, ['schema', 'algorithm', 'subjectSnapshotSha256', 'methodProjectionSha256', 'signature'])
  requireUnit(proof.schema === 'qingmu.imago-production-unit-method-attestation.v1' && proof.algorithm === 'hmac-sha256'
    && proof.subjectSnapshotSha256 === group.snapshotSha256 && proof.methodProjectionSha256 === method.projectionSha256
    && sha(proof.signature) && await digestShotFinding(projection.ruleBindings) === projection.rulesSha256
    && await digestShotFinding(projection) === method.projectionSha256)
}

/** Exact nonsecret intent retained in this tab before a scope-binding POST. */
export interface ProductionUnitRecoveryMarker extends Scope {
  readonly schema: 'qingmu.production-unit-recovery-marker.v1'
  readonly groupId: string
  readonly unitId: string
  readonly expectedSubjectSha256: string
  readonly expectedBindingRevision: number
  readonly expectedBindingSha256: string | null
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly idempotencyKey: string
}

/** An invalid or unresolved marker prevents another registration in the same tab and episode. */
export type ProductionUnitRecoveryRead = { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: ProductionUnitRecoveryMarker }
  | { readonly status: 'invalid'; readonly serialized: string | null }

const MARKER_KEYS = ['schema', 'projectId', 'episodeId', 'groupId', 'unitId', 'expectedSubjectSha256',
  'expectedBindingRevision', 'expectedBindingSha256', 'methodProjectionSha256', 'rulesSha256', 'idempotencyKey'] as const
function storageKey(scope: Scope) {
  return ['qingmu:production-unit-recovery:v1', scope.projectId, scope.episodeId].map(encodeURIComponent).join(':')
}
function parseMarker(value: unknown, scope: Scope): ProductionUnitRecoveryMarker {
  exact(value, MARKER_KEYS)
  const item = value as Record<string, unknown>
  requireUnit(item.schema === 'qingmu.production-unit-recovery-marker.v1'
    && item.projectId === scope.projectId && item.episodeId === scope.episodeId
    && [item.projectId, item.episodeId, item.groupId].every(identifier) && validProductionUnitId(item.unitId)
    && [item.expectedSubjectSha256, item.methodProjectionSha256, item.rulesSha256].every(sha)
    && integer(item.expectedBindingRevision) && item.expectedBindingRevision < Number.MAX_SAFE_INTEGER
    && (item.expectedBindingRevision === 0 ? item.expectedBindingSha256 === null : sha(item.expectedBindingSha256))
    && typeof item.idempotencyKey === 'string' && /^qingmu:production-unit:v1:[0-9a-f]{64}$/.test(item.idempotencyKey))
  return item as unknown as ProductionUnitRecoveryMarker
}
function same(left: ProductionUnitRecoveryMarker, right: ProductionUnitRecoveryMarker) {
  return MARKER_KEYS.every(key => left[key] === right[key])
}

/**
 * Derive a stable command key for the exact source, previous binding, and method.
 * @param input - Nonsecret coordinates, never form text, media, or a token.
 * @returns An intent that remains identical after a local discard and re-entry.
 */
export async function createProductionUnitMarker(
  input: Omit<ProductionUnitRecoveryMarker, 'schema' | 'idempotencyKey'>,
): Promise<ProductionUnitRecoveryMarker> {
  const coordinates = { schema: 'qingmu.production-unit-recovery-marker.v1' as const, ...input }
  return parseMarker({ ...coordinates, idempotencyKey: `qingmu:production-unit:v1:${await digestShotFinding(coordinates)}` }, input)
}
async function verifyMarker(marker: ProductionUnitRecoveryMarker) {
  const { idempotencyKey, schema: _schema, ...coordinates } = parseMarker(marker, marker)
  requireUnit((await createProductionUnitMarker(coordinates)).idempotencyKey === idempotencyKey)
}

/**
 * Read this tab's episode-scoped intent without a network call or automatic retry.
 * @param scope - Exact project and episode coordinates.
 * @returns Missing, validated, or invalid local data.
 */
export function readProductionUnitMarker(scope: Scope): ProductionUnitRecoveryRead {
  let serialized: string | null = null
  try {
    serialized = sessionStorage.getItem(storageKey(scope))
    return serialized === null ? { status: 'none' } : { status: 'ready', marker: parseMarker(JSON.parse(serialized) as unknown, scope) }
  } catch { return { status: 'invalid', serialized } }
}

/**
 * Save and synchronously read back the intent before POST; never replace another unresolved command.
 * @param marker - Deterministically generated exact command coordinates.
 * @returns Whether this exact marker is now retained.
 */
export function writeProductionUnitMarker(marker: ProductionUnitRecoveryMarker): boolean {
  try {
    parseMarker(marker, marker)
    const previous = readProductionUnitMarker(marker)
    if (previous.status === 'invalid' || (previous.status === 'ready' && !same(previous.marker, marker))) return false
    sessionStorage.setItem(storageKey(marker), JSON.stringify(marker))
    const read = readProductionUnitMarker(marker)
    return read.status === 'ready' && same(read.marker, marker)
  } catch { return false }
}

/**
 * Compare-and-clear only the observed marker, including an explicitly discarded corrupt value.
 * @param scope - Exact project and episode of the local marker.
 * @param expected - Marker observed by this operation before the asynchronous result.
 * @returns Whether no marker remains; a replacement is never deleted.
 */
export function clearProductionUnitMarker(scope: Scope, expected: ProductionUnitRecoveryRead): boolean {
  try {
    const current = readProductionUnitMarker(scope)
    if (current.status === 'none') return true
    const matches = current.status === 'ready' && expected.status === 'ready' ? same(current.marker, expected.marker)
      : current.status === 'invalid' && expected.status === 'invalid' && current.serialized !== null
        && current.serialized === expected.serialized
    if (!matches) return false
    sessionStorage.removeItem(storageKey(scope))
    return sessionStorage.getItem(storageKey(scope)) === null
  } catch { return false }
}

/**
 * Verify the original binding receipt without today's source, permission or HMAC key.
 * @param result - Private command RPC receipt.
 * @param marker - Original persisted intent.
 * @returns Resolves only for the original source, method, rules and next binding revision.
 */
export async function verifyProductionUnitReceipt(result: YimengProductionUnitResult, marker: ProductionUnitRecoveryMarker): Promise<void> {
  await verifyMarker(marker)
  exact(result, ['schema', 'binding', 'bindingSha256', 'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])
  requireUnit(result.schema === 'jason.qingmu-production-unit-result.v1')
  flags(result)
  await binding(result.binding, result.bindingSha256, marker)
  requireUnit(result.binding.unitId === marker.unitId && result.binding.groupId === marker.groupId
    && result.binding.sourceSnapshotSha256 === marker.expectedSubjectSha256
    && result.binding.methodProjectionSha256 === marker.methodProjectionSha256 && result.binding.rulesSha256 === marker.rulesSha256
    && result.binding.revision === marker.expectedBindingRevision + 1)
}

/**
 * Validate the GET-only receipt lookup including a truthful missing result.
 * @param result - Recovery RPC response, not a current-source read.
 * @param marker - Original persisted intent.
 * @returns The verified historical receipt or null, without clearing storage.
 */
export async function verifyProductionUnitRecovery(
  result: YimengProductionUnitRecovery, marker: ProductionUnitRecoveryMarker,
): Promise<YimengProductionUnitResult | null> {
  await verifyMarker(marker)
  exact(result, ['schema', 'projectId', 'episodeId', 'groupId', 'unitId', 'expectedSubjectSha256', 'idempotencyKey', 'found', 'result'])
  requireUnit(result.schema === 'jason.qingmu-production-unit-recovery.v1'
    && result.projectId === marker.projectId && result.episodeId === marker.episodeId && result.groupId === marker.groupId
    && result.unitId === marker.unitId && result.expectedSubjectSha256 === marker.expectedSubjectSha256
    && result.idempotencyKey === marker.idempotencyKey && typeof result.found === 'boolean')
  if (result.found === false) {
    requireUnit(result.result === null)
    return null
  }
  requireUnit(result.result !== null)
  await verifyProductionUnitReceipt(result.result, marker)
  return result.result
}
