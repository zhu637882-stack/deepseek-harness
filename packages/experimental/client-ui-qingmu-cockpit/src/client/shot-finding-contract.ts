/* oxlint-disable typescript/no-unnecessary-condition -- RPC DTOs are revalidated before an intent marker can clear. */
/* oxlint-disable typescript/no-unnecessary-boolean-literal-compare -- Exact flags are part of the runtime authority boundary. */
import type {
  ImagoShotFindingMethodResponse, YimengSelectedVideoReviewRequest, YimengShotFinding,
  YimengShotFindingFeedResponse, YimengShotFindingPayload, YimengShotFindingResult, YimengShotVideoSubject,
} from './contracts.ts'
import type { QingmuCockpitKey } from './locales.ts'

/** Field order is the current Finding form contract, never inferred from a defect. */
export const SHOT_FINDING_FIELDS = [
  'timecode', 'observation', 'evidenceRefs', 'earliestOwner', 'ownerReason', 'severity', 'suggestion', 'reworkScope',
] as const

/** Display labels for the active role-capability contract; internal stage IDs stay out of the form. */
export const SHOT_FINDING_OWNER_LABELS: Readonly<Record<string, QingmuCockpitKey>> = {
  B2a: 'findingOwnerArt', B2aC: 'findingOwnerCharacter', B2aS: 'findingOwnerScene', B2aV: 'findingOwnerVisual',
  C: 'findingOwnerDirector', C5: 'findingOwnerStoryboard', D: 'findingOwnerImagePrompt',
  DIMG: 'findingOwnerImage', E: 'findingOwnerVideoPrompt', F: 'findingOwnerVideo',
}
/**
 * User-facing labels for each shot-finding severity.
 */
export const SHOT_FINDING_SEVERITY_LABELS = {
  BLOCKER: 'findingSeverityBlocker', MAJOR: 'findingSeverityMajor', MINOR: 'findingSeverityMinor',
} as const

function requireContract(condition: boolean): asserts condition {
  if (!condition) throw new Error('Finding subject, method, or receipt does not match the expected contract')
}

// Keep the declared readonly DTO element types; Array.isArray otherwise widens them to any[].
function isArray(value: unknown): boolean {
  return Array.isArray(value)
}

// Match Host/Python strip for validation only; never rewrite author text.
function stripPythonWhitespace(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, '')
}
function isText(value: unknown, maximum = 8_000): value is string {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\u0000')
    && stripPythonWhitespace(value) !== '' && Array.from(value).length <= maximum
}
function isId(value: unknown): value is string {
  return isText(value, 256) && value === stripPythonWhitespace(value) && !/[\r\n]/.test(value)
}
function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0) ?? 0)
  const b = Array.from(right, character => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' && value.isWellFormed()) return JSON.stringify(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const item = value as Record<string, unknown>
    return `{${Object.keys(item).sort(compareCodePoints).map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`
  }
  throw new Error('Finding digest requires well-formed canonical JSON and safe integers')
}

/**
 * Python-compatible SHA of immutable coordinates; this does not attest current media bytes.
 * @param value - Untrusted value to validate and normalize.
 * @returns SHA-256 digest of the canonical value.
 */
export async function digestShotFinding(value: unknown): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Preserve all eight author fields verbatim, including repeated evidence references.
 * @param value - Untrusted value to validate and normalize.
 * @returns Resulting YimengShotFindingPayload value.
 */
export function shotFindingPayload(value: YimengShotFindingPayload): YimengShotFindingPayload {
  return { timecode: value.timecode, observation: value.observation, evidenceRefs: value.evidenceRefs,
    earliestOwner: value.earliestOwner, ownerReason: value.ownerReason, severity: value.severity,
    suggestion: value.suggestion, reworkScope: value.reworkScope }
}

/**
 * Local input check only. Reviewer permission and HMAC are enforced by Host and Yimeng.
 * @param value - Untrusted value to validate and normalize.
 * @param owners - Allowed finding owners.
 * @returns Whether the value satisfies the required fields.
 */
export function validShotFindingPayload(value: YimengShotFindingPayload, owners: readonly string[]): boolean {
  return isText(value.timecode, 128) && isText(value.observation) && isText(value.ownerReason)
    && isText(value.suggestion) && isText(value.reworkScope) && owners.includes(value.earliestOwner)
    && typeof value.severity === 'string' && Object.hasOwn(SHOT_FINDING_SEVERITY_LABELS, value.severity) && isArray(value.evidenceRefs)
    && value.evidenceRefs.length > 0 && value.evidenceRefs.length <= 32
    && value.evidenceRefs.every(item => isText(item, 1_024))
}

async function verifySubject(subject: YimengShotVideoSubject, sha: string, ids: YimengSelectedVideoReviewRequest) {
  requireContract(subject?.schema === 'jason.qingmu-shot-video-subject.v1'
    && subject.projectId === ids.projectId && subject.episodeId === ids.episodeId && subject.frameId === ids.frameId
    && [subject.projectId, subject.episodeId, subject.frameId, subject.assetId].every(isId)
    && Number.isSafeInteger(subject.frameNo) && subject.frameNo > 0
    && Number.isSafeInteger(subject.storyboardRevision) && subject.storyboardRevision >= 0
    && Number.isSafeInteger(subject.assetVersion) && subject.assetVersion >= 0
    && isSha(subject.assetSha256) && isSha(subject.frameContentSha256) && isSha(sha))
  requireContract(await digestShotFinding(subject) === sha)
}

async function verifyFinding(finding: YimengShotFinding, ids: YimengSelectedVideoReviewRequest) {
  requireContract(finding?.status === 'OPEN' && finding.actorRole === 'reviewer'
    && [finding.id, finding.eventId, finding.actorId, finding.earliestOwner].every(isId)
    && isText(finding.createdAt) && isSha(finding.authSessionId)
    && isSha(finding.methodProjectionSha256) && isSha(finding.rulesSha256)
    && validShotFindingPayload(finding, [finding.earliestOwner]))
  await verifySubject(finding.subject, finding.subjectSnapshotSha256, ids)
}

/**
 * Reject cross-Shot or cross-revision UI responses; historical items retain their original binding.
 * @param feed - Fresh backend feed to verify.
 * @param ids - Expected project and shot identifiers.
 * @param visible - Whether the finding must remain visible.
 */
export async function verifyShotFindingFeed(
  feed: YimengShotFindingFeedResponse, ids: YimengSelectedVideoReviewRequest,
  visible: { readonly frameNo: number; readonly storyboardRevision: number },
): Promise<void> {
  requireContract(feed?.schema === 'jason.qingmu-shot-finding-feed.v1' && feed.projectId === ids.projectId
    && feed.episodeId === ids.episodeId && feed.frameId === ids.frameId && isArray(feed.items)
    && typeof feed.capabilities?.canRecordFinding === 'boolean')
  if (feed.subject === null) {
    requireContract(feed.snapshotSha256 === null && feed.availability?.status === 'unavailable' && isText(feed.availability.reason))
  } else {
    requireContract(feed.availability?.status === 'available' && feed.availability.reason === null
      && feed.subject?.frameNo === visible.frameNo && feed.subject.storyboardRevision === visible.storyboardRevision
      && isSha(feed.snapshotSha256))
    await verifySubject(feed.subject, feed.snapshotSha256, ids)
  }
  const idsSeen = new Set<string>()
  const eventsSeen = new Set<string>()
  for (const item of feed.items) {
    await verifyFinding(item, ids)
    requireContract(item.currentBinding === (feed.snapshotSha256 !== null && item.subjectSnapshotSha256 === feed.snapshotSha256)
      && !idsSeen.has(item.id) && !eventsSeen.has(item.eventId))
    idsSeen.add(item.id)
    eventsSeen.add(item.eventId)
  }
}

/**
 * Check the bound form before displaying it. The browser never receives or verifies with the HMAC key.
 * @param method - Current IMAGO method result to verify.
 * @param feed - Fresh backend feed to verify.
 */
export async function verifyShotFindingMethod(method: ImagoShotFindingMethodResponse, feed: YimengShotFindingFeedResponse): Promise<void> {
  const projection = method?.projection
  const definition = projection?.definition
  const proof = method?.methodAttestation
  requireContract(feed.subject !== null && isSha(feed.snapshotSha256)
    && method?.schema === 'qingmu.imago-shot-finding-method-adapter-result.v1'
    && projection?.schema === 'qingmu.imago-shot-finding-method.v1' && projection.subjectSnapshotSha256 === feed.snapshotSha256
    && definition?.statusOnRecord === 'OPEN' && definition.approvalAuthority === 'not_granted'
    && definition.reworkExecutionAllowed === false && JSON.stringify(definition.requiredFields) === JSON.stringify(SHOT_FINDING_FIELDS)
    && JSON.stringify(definition.severities) === JSON.stringify(['BLOCKER', 'MAJOR', 'MINOR'])
    && isArray(definition.ownerOptions) && definition.ownerOptions.length > 0
    && definition.ownerOptions.every(owner => isId(owner.stageId) && Object.hasOwn(SHOT_FINDING_OWNER_LABELS, owner.roleId)
      && (owner.scope === 'global' || owner.scope === 'per_lsu'))
    && new Set(definition.ownerOptions.map(owner => owner.stageId)).size === definition.ownerOptions.length
    && typeof projection.ruleBindings === 'object' && projection.ruleBindings !== null
    && Object.keys(projection.ruleBindings).length > 0 && Object.values(projection.ruleBindings).every(isSha)
    && proof?.schema === 'qingmu.imago-shot-finding-method-attestation.v1' && proof.algorithm === 'hmac-sha256'
    && proof.subjectSnapshotSha256 === feed.snapshotSha256 && proof.methodProjectionSha256 === method.projectionSha256
    && isSha(proof.signature) && isSha(method.projectionSha256) && isSha(projection.rulesSha256))
  await verifySubject(projection.subject, feed.snapshotSha256, feed)
  requireContract(await digestShotFinding(projection.ruleBindings) === projection.rulesSha256
    && await digestShotFinding(projection) === method.projectionSha256)
}

/** Coordinates persisted locally before POST; no author text, token, media URL, or approval is stored. */
export interface ShotFindingRecoveryMarker extends YimengSelectedVideoReviewRequest {
  readonly schema: 'qingmu.shot-finding-recovery-marker.v1'
  readonly expectedSubjectSha256: string
  readonly idempotencyKey: string
  readonly findingSha256: string
  readonly methodProjectionSha256: string
}

/**
 * Bind an original receipt to the stored intent, not today's selected video or authentication session.
 * @param result - Command result to verify.
 * @param marker - Recovery marker to persist or clear.
 */
export async function verifyShotFindingReceipt(result: YimengShotFindingResult, marker: ShotFindingRecoveryMarker): Promise<void> {
  requireContract(result?.schema === 'jason.qingmu-shot-finding-result.v1' && result.changed === false
    && result.providerCalls === 0 && result.selectionChanged === false && result.humanSignoffInferred === false
    && result.reworkExecuted === false && result.finding?.subjectSnapshotSha256 === marker.expectedSubjectSha256
    && result.finding.methodProjectionSha256 === marker.methodProjectionSha256)
  await verifyFinding(result.finding, marker)
  requireContract(await digestShotFinding(shotFindingPayload(result.finding)) === marker.findingSha256)
}
