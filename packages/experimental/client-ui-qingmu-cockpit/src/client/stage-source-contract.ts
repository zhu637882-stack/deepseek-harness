/** Wire validation and nonsecret tab-local recovery for an existing saved-script source. */
/* oxlint-disable typescript/no-unnecessary-condition -- Private RPC and sessionStorage are runtime trust boundaries. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Exact false flags exclude approval and execution authority. */
import type {
  ImagoStageSourceMethodResponse, YimengRecoverStageSourceBindingRequest, YimengStageSource,
  YimengStageSourceDefinition, YimengStageSourceRecovery, YimengStageSourceResult,
  YimengStageSourcesRequest, YimengStageSourcesResponse,
} from './contracts.ts'
import { digestShotFinding } from './shot-finding-contract.ts'

type Scope = YimengStageSourcesRequest
function requireSource(condition: boolean): asserts condition {
  if (!condition) throw new Error('Saved script source, method, or original receipt mismatch')
}
function exact(value: unknown, keys: readonly string[]) {
  requireSource(typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)))
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value !== '' && Array.from(value).length <= 256
    && !/[\u0000\r\n]/.test(value)
    && value === value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}
function sha(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value)
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
async function source(value: YimengStageSource, expectedSha: string, scope: Scope) {
  exact(value, ['schema', 'projectId', 'episodeId', 'sourceType', 'sourceId', 'revision', 'contentSha256'])
  requireSource(value.schema === 'jason.qingmu-stage-source.v1' && value.sourceType === 'episode_script'
    && value.projectId === scope.projectId && value.episodeId === scope.episodeId && value.sourceId === scope.episodeId
    && [value.projectId, value.episodeId, value.sourceId].every(identifier)
    && integer(value.revision) && sha(value.contentSha256) && sha(expectedSha))
  requireSource(await digestShotFinding(value) === expectedSha)
}
function definition(value: YimengStageSourceDefinition) {
  exact(value, ['id', 'version', 'stageId', 'roleId', 'scope', 'contractSha256', 'artifactKind', 'canonicalOutput',
    'sourceType', 'sourceUsage', 'operation', 'stageArtifactCreationAllowed', 'stageApprovalAllowed', 'providerCalls'])
  requireSource(value.id === 'IMAGO-V6-A1S-SOURCE' && identifier(value.version) && value.stageId === 'A1S'
    && value.roleId === 'A1S' && value.scope === 'global' && sha(value.contractSha256)
    && value.artifactKind === 'SCREENPLAY_PACKAGE' && value.canonicalOutput === 'inputs/screenplay-package.json'
    && value.sourceType === 'episode_script' && value.sourceUsage === 'source_reference_only'
    && value.operation === 'bind_existing_episode_script_source' && value.stageArtifactCreationAllowed === false
    && value.stageApprovalAllowed === false && value.providerCalls === 0)
}
async function receipt(value: YimengStageSourceResult, scope: Scope) {
  exact(value, ['schema', 'binding', 'bindingSha256', 'receiptId', 'outboxEventId'])
  requireSource(value.schema === 'jason.qingmu-stage-source-result.v1' && sha(value.bindingSha256)
    && identifier(value.receiptId) && identifier(value.outboxEventId))
  const binding = value.binding
  exact(binding, ['schema', 'changeSetId', 'projectId', 'episodeId', 'stageId', 'source', 'subjectSnapshotSha256',
    'definition', 'methodProjectionSha256', 'rulesSha256', 'bindingRevision', 'actorId', 'authSessionId', 'createdAt',
    'stageArtifactCreated', 'stageApprovalGranted', 'lockActivated', 'planSealed', 'providerCalls', 'humanSignoffInferred', 'reworkExecuted'])
  requireSource(binding.schema === 'jason.qingmu-stage-source-binding.v1' && binding.projectId === scope.projectId
    && binding.episodeId === scope.episodeId && binding.stageId === 'A1S' && integer(binding.bindingRevision, 1)
    && [binding.changeSetId, binding.actorId].every(identifier)
    && [binding.authSessionId, binding.methodProjectionSha256, binding.rulesSha256].every(sha)
    && typeof binding.createdAt === 'string' && binding.createdAt.length <= 64
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(binding.createdAt)
    && Number.isFinite(Date.parse(binding.createdAt))
    && binding.stageArtifactCreated === false && binding.stageApprovalGranted === false && binding.lockActivated === false
    && binding.planSealed === false && binding.providerCalls === 0
    && binding.humanSignoffInferred === false && binding.reworkExecuted === false)
  await source(binding.source, binding.subjectSnapshotSha256, scope)
  definition(binding.definition)
  requireSource(await digestShotFinding(binding) === value.bindingSha256)
}

/**
 * Validate current source and historical head independently; no source is a completed artifact.
 * @param feed - Private read RPC response.
 * @param scope - Exact visible project and episode.
 * @returns Resolves only when source currency and binding CAS agree.
 */
export async function verifyStageSourceFeed(feed: YimengStageSourcesResponse, scope: Scope): Promise<void> {
  exact(feed, ['schema', 'projectId', 'episodeId', 'stageId', 'canBind', 'source', 'subjectSnapshotSha256',
    'unavailableReason', 'bindingRevision', 'bindingSha256', 'latestBinding', 'currentBinding'])
  requireSource(feed.schema === 'jason.qingmu-stage-source-feed.v1' && feed.stageId === 'A1S'
    && feed.projectId === scope.projectId && feed.episodeId === scope.episodeId
    && [feed.projectId, feed.episodeId].every(identifier) && typeof feed.canBind === 'boolean' && integer(feed.bindingRevision))
  if (feed.source === null) requireSource(feed.subjectSnapshotSha256 === null && identifier(feed.unavailableReason))
  else {
    requireSource(feed.unavailableReason === null && feed.subjectSnapshotSha256 !== null)
    await source(feed.source, feed.subjectSnapshotSha256, scope)
  }
  if (feed.latestBinding === null) {
    requireSource(feed.bindingRevision === 0 && feed.bindingSha256 === null && feed.currentBinding === null)
    return
  }
  await receipt(feed.latestBinding, scope)
  requireSource(feed.bindingRevision === feed.latestBinding.binding.bindingRevision
    && feed.bindingSha256 === feed.latestBinding.bindingSha256)
  if (feed.source === null || feed.subjectSnapshotSha256 !== feed.latestBinding.binding.subjectSnapshotSha256) {
    requireSource(feed.currentBinding === null)
  } else {
    requireSource(feed.currentBinding !== null
      && await digestShotFinding(feed.currentBinding) === await digestShotFinding(feed.latestBinding))
  }
}

/**
 * Check the source-only method carrier; secret-key verification remains on Host.
 * @param method - Private method RPC result from a fresh source read and Core compilation.
 * @param feed - Previously validated current source feed.
 * @returns Resolves only for the exact current source, projection and rule hashes.
 */
export async function verifyStageSourceMethod(method: ImagoStageSourceMethodResponse, feed: YimengStageSourcesResponse): Promise<void> {
  exact(method, ['schema', 'projection', 'projectionSha256', 'methodAttestation'])
  const projection = method.projection
  exact(projection, ['schema', 'subject', 'subjectSnapshotSha256', 'definition', 'ruleBindings', 'rulesSha256'])
  requireSource(method.schema === 'qingmu.imago-stage-source-method-adapter-result.v1'
    && projection.schema === 'qingmu.imago-stage-source-method.v1' && feed.source !== null && feed.subjectSnapshotSha256 !== null
    && projection.subjectSnapshotSha256 === feed.subjectSnapshotSha256 && sha(method.projectionSha256) && sha(projection.rulesSha256))
  await source(projection.subject, feed.subjectSnapshotSha256, feed)
  definition(projection.definition)
  exact(projection.ruleBindings, ['pipeline/imago-os-current.json', 'pipeline/workflow-channel-registry.json',
    'pipeline/v6-stage-contracts.json', 'pipeline/workflow-spec.v6.production-beta.json', 'scripts/compile_qingmu_imago_workset.py',
    'scripts/compile_qingmu_imago_workset_v2.py', 'scripts/imago_v6_draft_ctl.py',
    'scripts/compile_qingmu_element_method.py', 'scripts/compile_qingmu_stage_source_method.py'])
  requireSource(Object.values(projection.ruleBindings).every(sha))
  const proof = method.methodAttestation
  exact(proof, ['schema', 'algorithm', 'subjectSnapshotSha256', 'methodProjectionSha256', 'signature'])
  requireSource(proof.schema === 'qingmu.imago-stage-source-method-attestation.v1' && proof.algorithm === 'hmac-sha256'
    && proof.subjectSnapshotSha256 === feed.subjectSnapshotSha256 && proof.methodProjectionSha256 === method.projectionSha256
    && sha(proof.signature) && await digestShotFinding(projection.ruleBindings) === projection.rulesSha256
    && await digestShotFinding(projection) === method.projectionSha256)
}

/** Exact nonsecret command coordinates; no script, token, signature or method body is stored. */
export interface StageSourceRecoveryMarker extends Scope {
  readonly schema: 'qingmu.stage-source-recovery-marker.v1'
  readonly stageId: 'A1S'
  readonly expectedSubjectSha256: string
  readonly expectedBindingRevision: number
  readonly expectedBindingSha256: string | null
  readonly methodProjectionSha256: string
  readonly rulesSha256: string
  readonly idempotencyKey: string
}
/** An unresolved or corrupt intent blocks another source-binding POST in this tab and episode. */
export type StageSourceRecoveryRead = { readonly status: 'none' }
  | { readonly status: 'ready'; readonly marker: StageSourceRecoveryMarker }
  | { readonly status: 'invalid'; readonly serialized: string | null }
const MARKER_KEYS = ['schema', 'projectId', 'episodeId', 'stageId', 'expectedSubjectSha256', 'expectedBindingRevision',
  'expectedBindingSha256', 'methodProjectionSha256', 'rulesSha256', 'idempotencyKey'] as const
function storageKey(scope: Scope) {
  return ['qingmu:stage-source-recovery:v1', scope.projectId, scope.episodeId].map(encodeURIComponent).join(':')
}
function parseMarker(value: unknown, scope: Scope): StageSourceRecoveryMarker {
  exact(value, MARKER_KEYS)
  const item = value as Record<string, unknown>
  requireSource(item.schema === 'qingmu.stage-source-recovery-marker.v1' && item.stageId === 'A1S'
    && item.projectId === scope.projectId && item.episodeId === scope.episodeId && [item.projectId, item.episodeId].every(identifier)
    && [item.expectedSubjectSha256, item.methodProjectionSha256, item.rulesSha256].every(sha)
    && integer(item.expectedBindingRevision) && item.expectedBindingRevision < Number.MAX_SAFE_INTEGER
    && (item.expectedBindingRevision === 0 ? item.expectedBindingSha256 === null : sha(item.expectedBindingSha256))
    && typeof item.idempotencyKey === 'string' && item.idempotencyKey.length === 'qingmu:stage-source:v1:'.length + 64
    && /^qingmu:stage-source:v1:[0-9a-f]{64}$/.test(item.idempotencyKey))
  return item as unknown as StageSourceRecoveryMarker
}
function same(left: StageSourceRecoveryMarker, right: StageSourceRecoveryMarker) {
  return MARKER_KEYS.every(key => left[key] === right[key])
}

/**
 * Derive an idempotency key from this exact source, binding CAS and current method.
 * @param input - Nonsecret command coordinates.
 * @returns A stable marker, including after an explicit local discard.
 */
export async function createStageSourceMarker(
  input: Omit<StageSourceRecoveryMarker, 'schema' | 'idempotencyKey'>,
): Promise<StageSourceRecoveryMarker> {
  const coordinates = { schema: 'qingmu.stage-source-recovery-marker.v1' as const, ...input }
  return parseMarker({ ...coordinates, idempotencyKey: `qingmu:stage-source:v1:${await digestShotFinding(coordinates)}` }, input)
}
async function verifyMarker(marker: StageSourceRecoveryMarker) {
  const { idempotencyKey, schema: _schema, ...coordinates } = parseMarker(marker, marker)
  requireSource((await createStageSourceMarker(coordinates)).idempotencyKey === idempotencyKey)
}

/**
 * Read this tab's intent without submitting or querying a command.
 * @param scope - Exact project and episode.
 * @returns Missing, structurally valid or invalid local data.
 */
export function readStageSourceMarker(scope: Scope): StageSourceRecoveryRead {
  let serialized: string | null = null
  try {
    serialized = sessionStorage.getItem(storageKey(scope))
    return serialized === null ? { status: 'none' } : { status: 'ready', marker: parseMarker(JSON.parse(serialized) as unknown, scope) }
  } catch { return { status: 'invalid', serialized } }
}

/**
 * Persist and read back an intent before POST without replacing another unresolved command.
 * @param marker - The deterministically generated intent.
 * @returns Whether this exact marker is retained.
 */
export function writeStageSourceMarker(marker: StageSourceRecoveryMarker): boolean {
  try {
    parseMarker(marker, marker)
    const previous = readStageSourceMarker(marker)
    if (previous.status === 'invalid' || (previous.status === 'ready' && !same(previous.marker, marker))) return false
    sessionStorage.setItem(storageKey(marker), JSON.stringify(marker))
    const read = readStageSourceMarker(marker)
    return read.status === 'ready' && same(read.marker, marker)
  } catch { return false }
}

/**
 * Clear only the observed intent or the exact explicitly discarded corrupt value.
 * @param scope - Exact project and episode.
 * @param expected - Local data observed by this operation.
 * @returns Whether no marker remains; replacements are never deleted.
 */
export function clearStageSourceMarker(scope: Scope, expected: StageSourceRecoveryRead): boolean {
  try {
    const current = readStageSourceMarker(scope)
    if (current.status === 'none') return true
    const matches = current.status === 'ready' && expected.status === 'ready' ? same(current.marker, expected.marker)
      : current.status === 'invalid' && expected.status === 'invalid' && current.serialized !== null && current.serialized === expected.serialized
    if (!matches) return false
    sessionStorage.removeItem(storageKey(scope))
    return sessionStorage.getItem(storageKey(scope)) === null
  } catch { return false }
}

/**
 * Validate a persisted command fingerprint before sending the original GET lookup.
 * @param marker - The original nonsecret intent, independent of today's source and key.
 * @returns Only the five receipt-lookup coordinates, never a POST body.
 */
export async function stageSourceRecoveryRequest(marker: StageSourceRecoveryMarker): Promise<YimengRecoverStageSourceBindingRequest> {
  await verifyMarker(marker)
  return { projectId: marker.projectId, episodeId: marker.episodeId, stageId: marker.stageId,
    expectedSubjectSha256: marker.expectedSubjectSha256, idempotencyKey: marker.idempotencyKey }
}

/**
 * Validate the exact source/method/CAS receipt without requiring current source availability.
 * @param result - Private command response.
 * @param marker - Original persisted intent.
 * @returns Resolves only for the original source reference and next binding revision.
 */
export async function verifyStageSourceReceipt(result: YimengStageSourceResult, marker: StageSourceRecoveryMarker): Promise<void> {
  await verifyMarker(marker)
  await receipt(result, marker)
  requireSource(result.binding.stageId === marker.stageId && result.binding.subjectSnapshotSha256 === marker.expectedSubjectSha256
    && result.binding.methodProjectionSha256 === marker.methodProjectionSha256 && result.binding.rulesSha256 === marker.rulesSha256
    && result.binding.bindingRevision === marker.expectedBindingRevision + 1)
}

/**
 * Check a GET-only historical receipt, not a synthetic found/result wrapper.
 * @param result - Private recovery response; missing receipts are RPC errors.
 * @param marker - Original persisted intent.
 * @returns The validated original receipt without changing local storage.
 */
export async function verifyStageSourceRecovery(
  result: YimengStageSourceRecovery, marker: StageSourceRecoveryMarker,
): Promise<YimengStageSourceResult> {
  exact(result, ['schema', 'receipt'])
  requireSource(result.schema === 'jason.qingmu-stage-source-recovery.v1')
  await verifyStageSourceReceipt(result.receipt, marker)
  return result.receipt
}
