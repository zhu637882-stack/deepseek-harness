/** Loopback-only Host BFF for read-only Yimeng production facts. */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import z from '@deepseek-ai/schemastery'
import { normalizeContinuityDelta } from './continuity.ts'
import { normalizeSelectedVideoReview } from './selected-video-review.ts'
import { normalizeTakeVersionStack, parseTakeVersionReadRequest } from './take-versions.ts'
import { normalizeShotFindingFeed, parseShotFindingReadRequest } from './shot-findings.ts'
import { normalizeProductionUnitsFeed, parseProductionUnitsReadRequest } from './production-units.ts'
import { normalizeStageSourcesFeed, parseStageSourcesReadRequest } from './stage-sources.ts'
import { normalizeLsuPlanSource, parseLsuPlanSourceRequest } from './lsu-plan.ts'
import { normalizeReworkRouteSource, parseReworkRouteSourceRequest } from './rework-route.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The same configured read-only handler exposed on the private Connection channel. */
    qingmuYimengRead: ConnectionRpcHandler
  }
}

import type {
  YimengCapabilityCatalogRequest,
  YimengCapabilityCatalogResponse,
  YimengCapabilityCatalogItem,
  YimengCapabilityEligibility,
  YimengCapabilitySnapshot,
  YimengCostRehearsalRequest,
  YimengCostRehearsalResponse,
  YimengGateAControlEvidenceResponse,
  YimengGateAControlScenario,
  YimengGateAControlScenarioId,
  YimengElementProfileReference,
  YimengElementProfileRequest,
  YimengElementProfileResponse,
  YimengElementProfileSubject,
  YimengElementReviewComment,
  YimengElementReviewFeedResponse,
  YimengElementReviewSubject,
  YimengEpisodesRequest,
  YimengEpisodesResponse,
  YimengHealth,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengJsonObject,
  YimengProductionUnitsRequest,
  YimengLsuPlanSourceRequest,
  YimengReworkRouteSourceRequest,
  YimengStageSourcesRequest,
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrEditableProjection,
  YimengPromptIrRequest,
  YimengPromptIrResponse,
  YimengPromptIrSubject,
  YimengReferenceAssetCandidate,
  YimengReferenceCandidateDecisionKind,
  YimengReferenceCandidateQualityStatus,
  YimengReferenceCandidateSelectionStatus,
  YimengReferenceCandidatesResponse,
  YimengReferenceRightsKnowledgeState,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionRelease,
  YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengReferenceRightsExceptionScope,
  YimengReferenceRightsList,
  YimengReferenceRightsRecord,
  YimengReferenceRightsScalar,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengSelectedVideoReviewRequest,
  YimengHeroFrameBinding,
  YimengHeroFrameStoryboardBlocker,
  YimengHeroFrameStoryboardShot,
  YimengHeroFrameStoryboardsProjection,
  YimengShotRelationBeat,
  YimengShotRelationBlocker,
  YimengShotRelationElement,
  YimengShotRelationElementKind,
  YimengShotRelationScene,
  YimengShotRelationShot,
  YimengShotCurrentReference,
  YimengShotCurrentReferenceLineage,
  YimengShotDialogueCue,
  YimengShotDialogueRhythm,
  YimengShotRelationsProjection,
  YimengStoryboardCanvas,
  YimengStoryboardCanvasAnnotation,
  YimengStoryboardCanvasCompiled,
  YimengWorkflowBlocker,
  YimengWorkflowDirector,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
  YimengWorkflowStage,
} from './types.ts'

export type {
  YimengCapabilityCatalogRequest,
  YimengCapabilityCatalogResponse,
  YimengCapabilityCatalogItem,
  YimengCapabilityEligibility,
  YimengCapabilityMutualExclusion,
  YimengCapabilitySnapshot,
  YimengCostRehearsalRequest,
  YimengCostRehearsalResponse,
  YimengCostRehearsalSubject,
  YimengGateAControlEvidenceResponse,
  YimengGateAControlScenario,
  YimengGateAControlScenarioId,
  YimengGateAControlSourceBinding,
  YimengContinuityAudit,
  YimengContinuityCurrentBinding,
  YimengContinuityDeltaProjection,
  YimengContinuityDimension,
  YimengContinuityPair,
  YimengElementKind,
  YimengElementProfileReference,
  YimengElementProfileRequest,
  YimengElementProfileResponse,
  YimengElementProfileSubject,
  YimengElementReviewCapabilities,
  YimengElementReviewComment,
  YimengElementReviewFeedRequest,
  YimengElementReviewFeedResponse,
  YimengElementReviewSubject,
  YimengEpisodesRequest,
  YimengEpisodesResponse,
  YimengHealth,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengJsonObject,
  YimengProjectsRequest,
  YimengProjectsResponse,
  YimengPromptIrEditableProjection,
  YimengPromptIrRequest,
  YimengPromptIrResponse,
  YimengPromptIrSubject,
  YimengReferenceAssetCandidate,
  YimengReferenceCandidateDecisionKind,
  YimengReferenceCandidateQualityStatus,
  YimengReferenceCandidateSelectionStatus,
  YimengReferenceCandidatesRequest,
  YimengReferenceCandidatesResponse,
  YimengReferenceRightsKnowledgeState,
  YimengReferenceRightsExceptionCapabilities,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionRelease,
  YimengReferenceRightsExceptionReleaseFeedRequest,
  YimengReferenceRightsExceptionReleaseFeedResponse,
  YimengReferenceRightsExceptionScope,
  YimengReferenceRightsList,
  YimengReferenceRightsRecord,
  YimengReferenceRightsScalar,
  YimengReadEndpoint,
  YimengReadEndpointMap,
  YimengScriptRequest,
  YimengScriptResponse,
  YimengSelectedVideoReviewRequest,
  YimengSelectedVideoReviewResponse,
  YimengSelectedVideoReviewAsset,
  YimengSelectedVideoReviewStatus,
  YimengTakeVersion,
  YimengTakeVersionRequest,
  YimengTakeVersionStackResponse,
  YimengTakeVersionStackSubject,
  YimengVideoReviewDefect,
  YimengVideoReviewRecord,
  YimengShotVideoSubject,
  YimengShotFindingPayload,
  YimengShotFinding,
  YimengShotFindingFeedResponse,
  YimengShotFindingResult,
  YimengShotFindingRecovery,
  YimengProductionUnitSource,
  YimengProductionUnitDefinition,
  YimengProductionUnitBinding,
  YimengProductionUnitsRequest,
  YimengProductionUnitsResponse,
  YimengLsuPlanBlueprintLock,
  YimengLsuPlanDefinition,
  YimengLsuPlanProductionUnit,
  YimengLsuPlanSeal,
  YimengLsuPlanSealResult,
  YimengLsuPlanSourceRequest,
  YimengLsuPlanSourceResponse,
  YimengLsuPlanSubject,
  YimengReworkRouteFinding,
  YimengReworkRouteProductionUnit,
  YimengReworkRouteResult,
  YimengReworkRouteSealedPlan,
  YimengReworkRouteSourceRequest,
  YimengReworkRouteSourceResponse,
  YimengReworkRouteSubject,
  YimengStageSourcesRequest,
  YimengStageSourcesResponse,
  YimengStageSource,
  YimengStageSourceDefinition,
  YimengStageSourceBinding,
  YimengStageSourceResult,
  YimengHeroFrameBinding,
  YimengHeroFrameStoryboardBlocker,
  YimengHeroFrameStoryboardShot,
  YimengHeroFrameStoryboardsProjection,
  YimengShotRelationBeat,
  YimengShotRelationBlocker,
  YimengShotRelationElement,
  YimengShotRelationElementKind,
  YimengShotRelationScene,
  YimengShotRelationShot,
  YimengShotCurrentReference,
  YimengShotCurrentReferenceLineage,
  YimengShotDialogueCue,
  YimengShotDialogueRhythm,
  YimengShotRelationsProjection,
  YimengShotRelationsStoryboardRevision,
  YimengStoryboardCanvas,
  YimengStoryboardCanvasAnnotation,
  YimengStoryboardCanvasCompiled,
  YimengWorkflowBlocker,
  YimengWorkflowDirector,
  YimengWorkflowInterpretation,
  YimengWorkflowProjection,
  YimengWorkflowRequest,
  YimengWorkflowStage,
} from './types.ts'

const CHANNEL = '/qingmu-yimeng'
const DEFAULT_BASE_URL = 'http://127.0.0.1:8115'
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
const MAX_ID_LENGTH = 256
const MAX_SEARCH_LENGTH = 500
const MAX_JSON_BYTES = 5 * 1024 * 1024
const MAX_SCRIPT_JSON_BYTES = 20 * 1024 * 1024
const WORKFLOW_SCHEMA = 'jason.episode-workflow-projection.v1'
const SHOT_RELATIONS_SCHEMA = 'jason.scene-shot-beat-element-relations.v1'
const HERO_FRAME_STORYBOARDS_SCHEMA = 'jason.qingmu-hero-frame-storyboards.v1'
const STORYBOARD_CANVAS_SCHEMA = 'jason.qingmu-storyboard-canvas.v1'
const MAX_STORYBOARD_ANNOTATIONS = 256
const STORYBOARD_GRID_MAX = 10_000
const REFERENCE_CANDIDATES_SCHEMA = 'jason.qingmu-reference-asset-candidates.v1'
const ELEMENT_REVIEW_FEED_SCHEMA = 'jason.qingmu-element-review-feed.v1'
const REFERENCE_RIGHTS_EXCEPTION_RELEASE_FEED_SCHEMA = 'jason.qingmu-reference-rights-exception-release-feed.v1'
const SHA256 = /^[0-9a-f]{64}$/
const PROTECTED_ENDPOINTS = new Set([
  'projects', 'episodes', 'script', 'promptIr', 'capabilityCatalog', 'costRehearsal',
  'gateAControlEvidence', 'elementProfile',
  'referenceCandidates', 'reviewEvents',
  'referenceRightsExceptionReleases', 'workflow', 'selectedVideoReview', 'takeVersions', 'shotFindings', 'productionUnits', 'stageSources',
  'lsuPlanSource', 'reworkRouteSource',
])
const HUMAN_DECISION_VALUES = new Set<YimengHumanDecisionValue>([
  'approve', 'reject', 'request_changes',
])
const REFERENCE_SELECTION_STATUSES = new Set<YimengReferenceCandidateSelectionStatus>([
  'Unselected', 'Selected', 'Rejected', 'Stale',
])
const REFERENCE_QUALITY_STATUSES = new Set<YimengReferenceCandidateQualityStatus>([
  'pending', 'passed', 'failed',
])
const REFERENCE_DECISION_KINDS = new Set<YimengReferenceCandidateDecisionKind>([
  'none', 'referenceSelection', 'humanReview',
])
const SHOT_CURRENT_REFERENCE_ROLES = {
  actor: [
    'identity_board',
    'identity_board:age_variant',
    'turnaround_front',
    'turnaround_left',
    'turnaround_right',
    'turnaround_back',
    'face_closeup',
    'video_identity_reference',
  ],
  scene: ['scene_reference'],
  prop: ['prop_reference'],
} as const satisfies Record<YimengShotRelationElementKind, readonly string[]>
const RIGHTS_KNOWLEDGE_STATES = new Set<YimengReferenceRightsKnowledgeState>([
  'known', 'unknown', 'not_applicable',
])
const RIGHTS_CONTAINS_KEYS = [
  'realPersonLikeness', 'trademark', 'music', 'font', 'thirdPartyCharacter',
] as const
const RIGHTS_CONTAINS_STATES = new Set(['yes', 'no', 'unknown'] as const)
const RIGHTS_EXCEPTION_FIELDS = [
  'sourceType',
  'rightsHolder',
  'authorizationScope',
  'territory',
  'term',
  'restrictions',
  'contains',
  'providerTerms',
  'modelLicenses',
  'humanDeclaration',
  'contentCredentials',
] as const satisfies readonly YimengReferenceRightsExceptionField[]
const RIGHTS_EXCEPTION_FIELD_SET = new Set<YimengReferenceRightsExceptionField>(RIGHTS_EXCEPTION_FIELDS)
const RIGHTS_EXCEPTION_STALE_REASON_CODES = [
  'subject_binding_drift',
  'reference_asset_missing',
  'reference_asset_sha256_drift',
  'rights_record_sha256_drift',
] as const
const RIGHTS_EXCEPTION_STALE_REASON_CODE_SET = new Set<string>(RIGHTS_EXCEPTION_STALE_REASON_CODES)
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/
const SENSITIVE_RESPONSE_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie', 'xapikey',
  'apikey', 'accesstoken', 'refreshtoken', 'csrftoken', 'idtoken', 'token',
  'password', 'secret', 'clientsecret', 'privatekey', 'credential', 'credentials',
])

/** Cordis plugin name. */
export const name = 'experimental-qingmu-yimeng-read-adapter'
/** Host Connection must exist before the adapter registers its private channel. */
export const inject = ['connection']

/** Deployment-tunable upstream address and request deadline. */
export interface YimengReadAdapterConfig {
  /** Pathless loopback HTTP(S) origin of the authoritative Yimeng API. */
  readonly baseUrl?: string
  /** Read deadline in milliseconds, from 100 through 60,000. */
  readonly timeoutMs?: number
}

/** Validated Cordis configuration for the adapter. */
export const Config: z<YimengReadAdapterConfig> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  timeoutMs: z.natural().min(100).default(DEFAULT_TIMEOUT_MS),
})

/** Injectable host capabilities used by isolated tests. */
export interface YimengReadAdapterDependencies {
  readonly fetch: typeof globalThis.fetch
  readonly readToken: () => string | undefined
}

class InputError extends Error {}
class UpstreamContractError extends Error {}
class InvalidJsonResponseError extends Error {}
class ResponseTooLargeError extends Error {}

const badRequest = (message: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'bad-request', message, details: { issues: [] } },
})

const internalError = (message: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'internal', message, details: {} },
})

const cancelled = (): RpcResult<never> => ({
  ok: false,
  error: { code: 'cancelled', message: 'Yimeng request was cancelled', details: {} },
})

function isJsonObject(value: unknown): value is YimengJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(value: unknown, field: string): YimengJsonObject {
  if (!isJsonObject(value)) throw new UpstreamContractError(`${field} must be an object`)
  return value
}

function assertExactOutputKeys(value: YimengJsonObject, expected: readonly string[], field: string): void {
  const keys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new UpstreamContractError(`${field} fields mismatch`)
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new UpstreamContractError(`${field} must be a string`)
  return value
}

function requireSha256(value: unknown, field: string): string {
  const sha256 = requireString(value, field)
  if (!SHA256.test(sha256)) throw new UpstreamContractError(`${field} must be a lowercase SHA-256`)
  return sha256
}

function requireOptionalSha256(value: unknown, field: string): string {
  const sha256 = requireString(value, field)
  if (sha256 !== '' && !SHA256.test(sha256)) {
    throw new UpstreamContractError(`${field} must be empty or a lowercase SHA-256`)
  }
  return sha256
}

function requireIdentifier(value: unknown, field: string, allowEmpty = false): string {
  const identifier = requireString(value, field)
  const minimum = allowEmpty ? 0 : 1
  if (identifier.length < minimum || identifier.length > MAX_ID_LENGTH || identifier.trim() !== identifier) {
    throw new UpstreamContractError(
      `${field} must be between ${String(minimum)} and ${String(MAX_ID_LENGTH)} characters`,
    )
  }
  return identifier
}

function requireRfc3339Timestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field)
  const match = RFC3339_TIMESTAMP.exec(timestamp)
  if (match === null) throw new UpstreamContractError(`${field} must be an RFC3339 timestamp with an offset`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = Number(match[8] ?? 0)
  const offsetMinute = Number(match[9] ?? 0)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (
    year < 1
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
    || offsetHour > 23
    || offsetMinute > 59
  ) throw new UpstreamContractError(`${field} must be a valid RFC3339 timestamp`)
  return timestamp
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === 'string') return value
  throw new UpstreamContractError(`${field} must be a string or null`)
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new UpstreamContractError(`${field} must be a boolean`)
  return value
}

function requireInteger(value: unknown, field: string, minimum: number, maximum?: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (maximum !== undefined && (value as number) > maximum)) {
    throw new UpstreamContractError(`${field} must be an integer in range`)
  }
  return value as number
}

function assertSafeJsonNumbers(value: unknown, field: string, depth = 0): void {
  if (depth > 100) throw new UpstreamContractError(`${field} nesting exceeds limit`)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new UpstreamContractError(`${field} contains a non-finite number or unsafe integer`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJsonNumbers(item, field, depth + 1)
    return
  }
  if (!isJsonObject(value)) return
  for (const item of Object.values(value)) assertSafeJsonNumbers(item, field, depth + 1)
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

function canonicalJson(value: unknown, field: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new UpstreamContractError(`${field} must contain only safe integers`)
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${field}[${String(index)}]`)).join(',')}]`
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort(compareUnicodeCodePoints)
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${field}.${key}`)}`).join(',')}}`
  }
  throw new UpstreamContractError(`${field} must be canonical JSON`)
}

function canonicalJsonSha256(value: unknown, field: string): string {
  return createHash('sha256').update(canonicalJson(value, field), 'utf8').digest('hex')
}

function assertUnicodeScalarString(value: string, field: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new UpstreamContractError(`${field} contains a lone Unicode surrogate`)
      }
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      throw new UpstreamContractError(`${field} contains a lone Unicode surrogate`)
    }
  }
}

/** RFC 8785 JCS used only by the E6 capability/preflight contract. */
function jcsCanonicalJson(value: unknown, field: string, depth = 0): string {
  if (depth > 100) throw new UpstreamContractError(`${field} nesting exceeds limit`)
  if (value === null) return 'null'
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, field)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new UpstreamContractError(`${field} contains a non-finite number or unsafe integer`)
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => (
      jcsCanonicalJson(item, `${field}[${String(index)}]`, depth + 1)
    )).join(',')}]`
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => {
      assertUnicodeScalarString(key, `${field} key`)
      return `${JSON.stringify(key)}:${jcsCanonicalJson(value[key], `${field}.${key}`, depth + 1)}`
    }).join(',')}}`
  }
  throw new UpstreamContractError(`${field} must be RFC 8785 JSON`)
}

function jcsSha256(value: unknown, field: string): string {
  return createHash('sha256').update(jcsCanonicalJson(value, field), 'utf8').digest('hex')
}

function requireObjectItems(value: unknown, field: string): YimengJsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new UpstreamContractError(`${field} must be an array of objects`)
  }
  return value
}

function optionalKnownString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InputError(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH) {
    throw new InputError(`${field} must be between 1 and ${String(MAX_ID_LENGTH)} characters`)
  }
  return normalized
}

function requireInputObject(payload: unknown): YimengJsonObject {
  if (!isJsonObject(payload)) throw new InputError('payload must be an object')
  return payload
}

function assertOnlyInputKeys(input: YimengJsonObject, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unknownKey = Object.keys(input).find(key => !allowedKeys.has(key))
  if (unknownKey !== undefined) throw new InputError(`unknown payload field: ${unknownKey}`)
}

function parseProjectsRequest(payload: unknown): Required<Pick<YimengProjectsRequest, 'page' | 'pageSize'>> & Pick<YimengProjectsRequest, 'search'> {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['page', 'pageSize', 'search'])
  const page = input.page === undefined ? 1 : requireInputInteger(input.page, 'page', 1)
  const pageSize = input.pageSize === undefined ? 20 : requireInputInteger(input.pageSize, 'pageSize', 1, 100)
  if (input.search !== undefined && typeof input.search !== 'string') throw new InputError('search must be a string')
  const search = typeof input.search === 'string' ? input.search.trim() : undefined
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    throw new InputError(`search must not exceed ${String(MAX_SEARCH_LENGTH)} characters`)
  }
  return { page, pageSize, ...(search === undefined || search.length === 0 ? {} : { search }) }
}

function requireInputInteger(value: unknown, field: string, minimum: number, maximum?: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (maximum !== undefined && (value as number) > maximum)) {
    throw new InputError(`${field} must be an integer in range`)
  }
  return value as number
}

function parseEpisodesRequest(payload: unknown): YimengEpisodesRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'seriesId'])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    ...(input.seriesId === undefined ? {} : { seriesId: parseIdentifier(input.seriesId, 'seriesId') }),
  }
}

function parseEpisodeRequest(payload: unknown): YimengWorkflowRequest & YimengScriptRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'episodeId'])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
  }
}

function parsePromptIrRequest(payload: unknown): YimengPromptIrRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'episodeId', 'storyboardRevisionId', 'frameId'])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
  }
}

function parseSelectedVideoReviewRequest(payload: unknown): YimengSelectedVideoReviewRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'episodeId', 'frameId'])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
  }
}

function parseShotFindingRequest(payload: unknown): YimengSelectedVideoReviewRequest {
  try {
    return parseShotFindingReadRequest(payload)
  } catch {
    throw new InputError('shotFindings accepts only canonical projectId, episodeId, and frameId')
  }
}

function parseTakeVersionRequest(payload: unknown) {
  try {
    return parseTakeVersionReadRequest(payload)
  } catch {
    throw new InputError('takeVersions accepts only canonical projectId, episodeId, and frameId')
  }
}

function parseProductionUnitsRequest(payload: unknown): YimengProductionUnitsRequest {
  try {
    return parseProductionUnitsReadRequest(payload)
  } catch {
    throw new InputError('productionUnits accepts only canonical projectId and episodeId')
  }
}

function parseStageSourcesRequest(payload: unknown): YimengStageSourcesRequest {
  try {
    return parseStageSourcesReadRequest(payload)
  } catch {
    throw new InputError('stageSources accepts only canonical projectId and episodeId')
  }
}

function parseLsuPlanReadRequest(payload: unknown): YimengLsuPlanSourceRequest {
  try {
    return parseLsuPlanSourceRequest(payload)
  } catch {
    throw new InputError('lsuPlanSource accepts only canonical projectId, episodeId, and lockRulesSha256')
  }
}

function parseReworkRouteReadRequest(payload: unknown): YimengReworkRouteSourceRequest {
  try {
    return parseReworkRouteSourceRequest(payload)
  } catch {
    throw new InputError('reworkRouteSource accepts only exact coordinates and current rule SHAs')
  }
}

function parseElementProfileRequest(payload: unknown): YimengElementProfileRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'elementKind', 'targetId'])
  const elementKind = parseIdentifier(input.elementKind, 'elementKind')
  if (elementKind !== 'actor' && elementKind !== 'scene' && elementKind !== 'prop') {
    throw new InputError('elementKind must be actor, scene, or prop')
  }
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind,
    targetId: parseIdentifier(input.targetId, 'targetId'),
  }
}

function assertEmptyRequest(payload: unknown): void {
  const input = requireInputObject(payload)
  if (Object.keys(input).length !== 0) throw new InputError('health payload must be empty')
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') return true
  const octets = normalized.split('.')
  return octets.length === 4
    && octets[0] === '127'
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function resolveBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('qingmu-yimeng-read-adapter baseUrl must be an absolute URL')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHostname(url.hostname)) {
    throw new Error('qingmu-yimeng-read-adapter baseUrl must use loopback http(s)')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('qingmu-yimeng-read-adapter baseUrl must not contain credentials, path, query, or fragment')
  }
  return url.origin
}

function resolveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > MAX_TIMEOUT_MS) {
    throw new Error(`qingmu-yimeng-read-adapter timeoutMs must be an integer from 100 to ${String(MAX_TIMEOUT_MS)}`)
  }
  return value
}

function normalizeToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const token = value.trim()
  if (token.length === 0) return undefined
  if (token.length > 16_384 || /[\r\n]/.test(token)) return undefined
  return token
}

function sanitizeUpstreamValue(value: unknown, token: string | undefined, depth = 0): unknown {
  if (depth > 100) throw new InvalidJsonResponseError('response nesting exceeds limit')
  if (typeof value === 'string') {
    return token === undefined ? value : value.split(token).join('[REDACTED]')
  }
  if (Array.isArray(value)) return value.map(item => sanitizeUpstreamValue(item, token, depth + 1))
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => (
        !SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase().replaceAll('-', '').replaceAll('_', ''))
        && (token === undefined || !key.includes(token))
      ))
      .map(([key, item]) => [key, sanitizeUpstreamValue(item, token, depth + 1)]),
  )
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await response.body?.cancel()
    throw new ResponseTooLargeError('response exceeds size limit')
  }
  if (response.body === null) throw new InvalidJsonResponseError('response body is empty')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new ResponseTooLargeError('response exceeds size limit')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new InvalidJsonResponseError('response body is not valid JSON')
  }
}

interface FetchJsonSuccess {
  readonly ok: true
  readonly value: unknown
}

type FetchJsonResult = FetchJsonSuccess | RpcResult<never>

async function fetchJson(
  deps: YimengReadAdapterDependencies,
  url: string,
  authorizationToken: string | undefined,
  scrubToken: string | undefined,
  timeoutMs: number,
  maxJsonBytes: number,
  signal: AbortSignal,
): Promise<FetchJsonResult> {
  const controller = new AbortController()
  const timeoutReason = Object.freeze({ kind: 'qingmu-yimeng-read-timeout' })
  const onAbort = () => { controller.abort(signal.reason) }
  if (signal.aborted) return cancelled()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, timeoutMs)
  try {
    const headers = new Headers({ accept: 'application/json' })
    if (authorizationToken !== undefined) headers.set('authorization', `Bearer ${authorizationToken}`)
    const response = await deps.fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) {
      return internalError('Yimeng authentication failed')
    }
    if (!response.ok) return internalError(`Yimeng service returned HTTP ${String(response.status)}`)
    try {
      const value = sanitizeUpstreamValue(await readBoundedJson(response, maxJsonBytes), scrubToken)
      return { ok: true, value }
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return internalError('Yimeng response exceeded size limit')
      }
      if (!(error instanceof InvalidJsonResponseError)) throw error
      return internalError('Yimeng service returned invalid JSON')
    }
  } catch {
    if (controller.signal.reason === timeoutReason) return internalError('Yimeng request timed out')
    if (controller.signal.aborted) return cancelled()
    return internalError('Yimeng service is unavailable')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function normalizeHealth(value: unknown): YimengHealth {
  const root = requireObject(value, 'health')
  const runtime = isJsonObject(root.runtime) ? root.runtime : {}
  const status = requireString(root.status, 'health.status')
  return {
    status,
    liveness: typeof root.liveness === 'boolean' ? root.liveness : ['ok', 'healthy'].includes(status.toLowerCase()),
    runtime: {
      commit: optionalNullableString(runtime.commit),
      dirty: optionalNullableBoolean(runtime.dirty),
      identitySource: optionalKnownString(runtime.identitySource, 'unavailable'),
      matchesReleaseManifest: optionalNullableBoolean(runtime.matchesReleaseManifest),
    },
    build: isJsonObject(root.build) ? root.build : null,
    hints: isJsonObject(root.hints) ? root.hints : null,
  }
}

function parseCapabilityCatalogRequest(payload: unknown): YimengCapabilityCatalogRequest {
  if (!isJsonObject(payload)) throw new InputError('capability catalog request must be an object')
  const allowed = new Set(['modelId', 'capability', 'requestedControls'])
  if (Object.keys(payload).some(key => !allowed.has(key))) {
    throw new InputError('capability catalog request contains unknown fields')
  }
  const modelId = payload.modelId === undefined ? undefined : parseIdentifier(payload.modelId, 'modelId')
  const capability = payload.capability === undefined
    ? undefined
    : parseIdentifier(payload.capability, 'capability')
  if (capability !== undefined && capability.length > 128) {
    throw new InputError('capability must be at most 128 characters')
  }
  if (payload.requestedControls !== undefined && !Array.isArray(payload.requestedControls)) {
    throw new InputError('requestedControls must be an array')
  }
  const requestedControls = [...new Set((payload.requestedControls ?? []).map((value, index) => {
    const control = parseIdentifier(value, `requestedControls[${String(index)}]`)
    if (control.length > 128) throw new InputError('requested control must be at most 128 characters')
    return control
  }))].sort(compareUnicodeCodePoints)
  if (requestedControls.length > 64) throw new InputError('requestedControls exceeds limit')
  return {
    ...(modelId === undefined ? {} : { modelId }),
    ...(capability === undefined ? {} : { capability }),
    ...(requestedControls.length === 0 ? {} : { requestedControls }),
  }
}

function requireCanonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new UpstreamContractError(`${field} must be an array`)
  const items = value.map((item, index) => requireIdentifier(item, `${field}[${String(index)}]`))
  const canonical = [...new Set(items)].sort(compareUnicodeCodePoints)
  if (!isDeepStrictEqual(items, canonical)) {
    throw new UpstreamContractError(`${field} must be sorted and unique`)
  }
  return items
}

function normalizeCapabilitySnapshot(value: unknown): YimengCapabilitySnapshot {
  const root = requireObject(value, 'capabilityCatalog.item.snapshot')
  assertExactOutputKeys(root, [
    'schema', 'modelId', 'providerId', 'familyId', 'displayName', 'enabled', 'inputs', 'outputs',
    'geometry', 'consistency', 'controls', 'mutualExclusions', 'cost', 'runtime', 'compliance', 'declaration',
  ], 'capabilityCatalog.item.snapshot')
  if (root.schema !== 'jason.provider-capability-snapshot.v1') {
    throw new UpstreamContractError('capability snapshot schema mismatch')
  }
  const consistency = requireObject(root.consistency, 'capabilityCatalog.item.snapshot.consistency')
  assertExactOutputKeys(consistency, ['capabilities', 'referenceAware'], 'capabilityCatalog.item.snapshot.consistency')
  const runtime = requireObject(root.runtime, 'capabilityCatalog.item.snapshot.runtime')
  assertExactOutputKeys(runtime, [
    'endpoint', 'endpointsByCapability', 'deploymentScope', 'region',
  ], 'capabilityCatalog.item.snapshot.runtime')
  const compliance = requireObject(root.compliance, 'capabilityCatalog.item.snapshot.compliance')
  assertExactOutputKeys(compliance, [
    'docs', 'evidenceLevel', 'paidDispatchAllowed', 'paidDispatchByCapability', 'productionStatus',
  ], 'capabilityCatalog.item.snapshot.compliance')
  if (compliance.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION') {
    throw new UpstreamContractError('capability snapshot paid-production status mismatch')
  }
  const declaration = requireObject(root.declaration, 'capabilityCatalog.item.snapshot.declaration')
  assertExactOutputKeys(declaration, [
    'inputsDeclared', 'outputsDeclared', 'geometryDeclared', 'mutualExclusionsDeclared', 'errors',
  ], 'capabilityCatalog.item.snapshot.declaration')
  if (!Array.isArray(root.mutualExclusions)) {
    throw new UpstreamContractError('capability mutualExclusions must be an array')
  }
  const seenRules = new Set<string>()
  const mutualExclusions = root.mutualExclusions.map((raw, index) => {
    const rule = requireObject(raw, `capabilityCatalog.item.snapshot.mutualExclusions[${String(index)}]`)
    assertExactOutputKeys(rule, ['ruleId', 'controls', 'maxSelected'], 'capability mutual-exclusion rule')
    const ruleId = requireIdentifier(rule.ruleId, 'capability mutual-exclusion ruleId')
    const controls = requireCanonicalStringArray(rule.controls, 'capability mutual-exclusion controls')
    const maxSelected = requireInteger(rule.maxSelected, 'capability mutual-exclusion maxSelected', 0)
    if (seenRules.has(ruleId) || controls.length < 2 || maxSelected >= controls.length) {
      throw new UpstreamContractError('capability mutual-exclusion rule is invalid')
    }
    seenRules.add(ruleId)
    return { ruleId, controls, maxSelected }
  })
  if (!isDeepStrictEqual(mutualExclusions.map(rule => rule.ruleId), [...seenRules].sort(compareUnicodeCodePoints))) {
    throw new UpstreamContractError('capability mutual-exclusion rules must be sorted')
  }
  const inputs = requireObject(root.inputs, 'capability snapshot inputs')
  const outputs = requireObject(root.outputs, 'capability snapshot outputs')
  const geometry = requireObject(root.geometry, 'capability snapshot geometry')
  if (Object.prototype.hasOwnProperty.call(geometry, 'max_outputs')) {
    requireInteger(geometry.max_outputs, 'capability snapshot geometry.max_outputs', 1)
  }
  const cost = requireObject(root.cost, 'capability snapshot cost')
  const endpointsByCapability = requireObject(runtime.endpointsByCapability, 'capability endpoints')
  const paidDispatchByCapability = requireObject(compliance.paidDispatchByCapability, 'capability paid dispatch map')
  for (const [field, item] of Object.entries({ inputs, outputs, geometry, cost, endpointsByCapability, paidDispatchByCapability })) {
    assertSafeJsonNumbers(item, `capability snapshot ${field}`)
  }
  return {
    schema: 'jason.provider-capability-snapshot.v1',
    modelId: requireIdentifier(root.modelId, 'capability snapshot modelId'),
    providerId: requireIdentifier(root.providerId, 'capability snapshot providerId'),
    familyId: requireIdentifier(root.familyId, 'capability snapshot familyId'),
    displayName: requireIdentifier(root.displayName, 'capability snapshot displayName'),
    enabled: requireBoolean(root.enabled, 'capability snapshot enabled'),
    inputs, outputs, geometry,
    consistency: {
      capabilities: requireCanonicalStringArray(consistency.capabilities, 'capability snapshot capabilities'),
      referenceAware: requireBoolean(consistency.referenceAware, 'capability snapshot referenceAware'),
    },
    controls: requireCanonicalStringArray(root.controls, 'capability snapshot controls'),
    mutualExclusions, cost,
    runtime: {
      endpoint: requireString(runtime.endpoint, 'capability snapshot endpoint'), endpointsByCapability,
      deploymentScope: requireString(runtime.deploymentScope, 'capability snapshot deploymentScope'),
      region: requireString(runtime.region, 'capability snapshot region'),
    },
    compliance: {
      docs: requireCanonicalStringArray(compliance.docs, 'capability snapshot docs'),
      evidenceLevel: requireIdentifier(compliance.evidenceLevel, 'capability snapshot evidenceLevel'),
      paidDispatchAllowed: requireBoolean(compliance.paidDispatchAllowed, 'capability snapshot paidDispatchAllowed'),
      paidDispatchByCapability, productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    },
    declaration: {
      inputsDeclared: requireBoolean(declaration.inputsDeclared, 'capability inputsDeclared'),
      outputsDeclared: requireBoolean(declaration.outputsDeclared, 'capability outputsDeclared'),
      geometryDeclared: requireBoolean(declaration.geometryDeclared, 'capability geometryDeclared'),
      mutualExclusionsDeclared: requireBoolean(declaration.mutualExclusionsDeclared, 'capability mutualExclusionsDeclared'),
      errors: requireCanonicalStringArray(declaration.errors, 'capability declaration errors'),
    },
  }
}

function evaluateCapabilitySnapshot(
  snapshot: YimengCapabilitySnapshot,
  request: YimengCapabilityCatalogResponse['request'],
): YimengCapabilityCatalogItem['eligibility'] {
  const evaluated = Boolean(request.capability || request.requestedControls.length > 0)
  if (!evaluated) {
    return { evaluated: false, eligible: false, errors: ['requirements_not_supplied'] }
  }
  const errors: string[] = []
  if (!snapshot.enabled) errors.push('model_disabled')
  if (request.capability !== null && !snapshot.controls.includes(request.capability)) {
    errors.push(`capability_unsupported:${request.capability}`)
  }
  for (const control of request.requestedControls) {
    if (!snapshot.controls.includes(control)) errors.push(`control_unsupported:${control}`)
  }
  if (request.requestedControls.length > 0 && !snapshot.declaration.mutualExclusionsDeclared) {
    errors.push('mutual_exclusions_undeclared')
  }
  errors.push(...snapshot.declaration.errors)
  const selected = new Set(request.requestedControls)
  for (const rule of snapshot.mutualExclusions) {
    const selectedCount = rule.controls.filter(control => selected.has(control)).length
    if (selectedCount > rule.maxSelected) errors.push(`mutual_exclusion:${rule.ruleId}`)
  }
  const uniqueErrors = [...new Set(errors)].sort(compareUnicodeCodePoints)
  return { evaluated: true, eligible: uniqueErrors.length === 0, errors: uniqueErrors }
}

function normalizeCapabilityCatalog(
  value: unknown,
  expected: YimengCapabilityCatalogRequest,
): YimengCapabilityCatalogResponse {
  const root = requireObject(value, 'capabilityCatalog')
  assertExactOutputKeys(root, [
    'schema', 'productionStatus', 'snapshotPolicy', 'activeProfile', 'catalogSnapshotSha256',
    'requestSnapshotSha256', 'preflightSnapshotSha256', 'request', 'items', 'providerCalls',
    'databaseWrites', 'paidGenerationAuthorized',
  ], 'capabilityCatalog')
  if (root.schema !== 'jason.provider-capability-catalog.v1'
    || root.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION'
    || root.snapshotPolicy !== 'rfc8785-jcs-sha256-v1'
    || root.providerCalls !== 0 || root.databaseWrites !== 0 || root.paidGenerationAuthorized !== false) {
    throw new UpstreamContractError('capability catalog identity or authority mismatch')
  }
  const request = requireObject(root.request, 'capabilityCatalog.request')
  assertExactOutputKeys(request, ['modelId', 'capability', 'requestedControls', 'dryRun'], 'capabilityCatalog.request')
  const normalizedRequest = {
    modelId: request.modelId === null ? null : requireIdentifier(request.modelId, 'capabilityCatalog.request.modelId'),
    capability: request.capability === null ? null : requireIdentifier(request.capability, 'capabilityCatalog.request.capability'),
    requestedControls: requireCanonicalStringArray(request.requestedControls, 'capabilityCatalog.request.requestedControls'),
    dryRun: true as const,
  }
  if (request.dryRun !== true
    || normalizedRequest.modelId !== (expected.modelId ?? null)
    || normalizedRequest.capability !== (expected.capability ?? null)
    || !isDeepStrictEqual(normalizedRequest.requestedControls, expected.requestedControls ?? [])) {
    throw new UpstreamContractError('capability catalog request echo mismatch')
  }
  const requestSnapshotSha256 = requireSha256(root.requestSnapshotSha256, 'capabilityCatalog.requestSnapshotSha256')
  if (requestSnapshotSha256 !== jcsSha256(normalizedRequest, 'capabilityCatalog.request')) {
    throw new UpstreamContractError('capability catalog request SHA mismatch')
  }
  if (!Array.isArray(root.items)) throw new UpstreamContractError('capability catalog items must be an array')
  const seen = new Set<string>()
  const items: YimengCapabilityCatalogItem[] = root.items.map((raw, index) => {
    const item = requireObject(raw, `capabilityCatalog.items[${String(index)}]`)
    assertExactOutputKeys(item, [
      'capabilitySnapshotId', 'capabilitySnapshotSha256', 'capabilitySnapshotCanonicalJson',
      'productionStatus', 'snapshot', 'eligibility',
    ], 'capabilityCatalog.item')
    const snapshot = normalizeCapabilitySnapshot(item.snapshot)
    const sha256 = requireSha256(item.capabilitySnapshotSha256, 'capabilityCatalog.item.capabilitySnapshotSha256')
    const id = requireIdentifier(item.capabilitySnapshotId, 'capabilityCatalog.item.capabilitySnapshotId')
    const canonical = requireString(item.capabilitySnapshotCanonicalJson, 'capabilityCatalog.item.capabilitySnapshotCanonicalJson')
    const expectedCanonical = jcsCanonicalJson(snapshot, 'capabilityCatalog.item.snapshot')
    if (id !== `capability-snapshot:sha256:${sha256}`
      || createHash('sha256').update(canonical, 'utf8').digest('hex') !== sha256
      || canonical !== expectedCanonical
      || item.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION'
      || seen.has(id)) {
      throw new UpstreamContractError('capability snapshot bytes or identity mismatch')
    }
    seen.add(id)
    const eligibility = requireObject(item.eligibility, 'capabilityCatalog.item.eligibility')
    assertExactOutputKeys(eligibility, ['evaluated', 'eligible', 'errors'], 'capabilityCatalog.item.eligibility')
    const normalizedEligibility = {
      evaluated: requireBoolean(eligibility.evaluated, 'capability eligibility evaluated'),
      eligible: requireBoolean(eligibility.eligible, 'capability eligibility eligible'),
      errors: requireCanonicalStringArray(eligibility.errors, 'capability eligibility errors'),
    }
    const expectedEligibility = evaluateCapabilitySnapshot(snapshot, normalizedRequest)
    if (!isDeepStrictEqual(normalizedEligibility, expectedEligibility)) {
      throw new UpstreamContractError('capability eligibility does not match the Host evaluation')
    }
    return {
      capabilitySnapshotId: id, capabilitySnapshotSha256: sha256,
      capabilitySnapshotCanonicalJson: canonical,
      productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', snapshot,
      eligibility: normalizedEligibility,
    }
  })
  const expectedItemOrder = [...items].sort((left, right) => (
    compareUnicodeCodePoints(left.snapshot.providerId, right.snapshot.providerId)
      || compareUnicodeCodePoints(left.snapshot.modelId, right.snapshot.modelId)
  ))
  if (!isDeepStrictEqual(items, expectedItemOrder)) {
    throw new UpstreamContractError('capability catalog items must use canonical provider/model order')
  }
  const activeProfile = requireIdentifier(root.activeProfile, 'capabilityCatalog.activeProfile')
  const identity = {
    schema: 'jason.provider-capability-catalog.v1', activeProfile,
    items: items.map(item => ({
      capabilitySnapshotId: item.capabilitySnapshotId,
      capabilitySnapshotSha256: item.capabilitySnapshotSha256,
    })),
  }
  const catalogSnapshotSha256 = requireSha256(root.catalogSnapshotSha256, 'capabilityCatalog.catalogSnapshotSha256')
  if (catalogSnapshotSha256 !== jcsSha256(identity, 'capabilityCatalog.identity')) {
    throw new UpstreamContractError('capability catalog SHA mismatch')
  }
  const preflightIdentity = {
    schema: 'jason.provider-capability-preflight.v1',
    catalogSnapshotSha256,
    requestSnapshotSha256,
    items: items.map(item => ({
      capabilitySnapshotId: item.capabilitySnapshotId,
      eligibility: item.eligibility,
    })),
  }
  const preflightSnapshotSha256 = requireSha256(
    root.preflightSnapshotSha256,
    'capabilityCatalog.preflightSnapshotSha256',
  )
  if (preflightSnapshotSha256 !== jcsSha256(preflightIdentity, 'capabilityCatalog.preflightIdentity')) {
    throw new UpstreamContractError('capability preflight SHA mismatch')
  }
  return {
    schema: 'jason.provider-capability-catalog.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION', snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    activeProfile, catalogSnapshotSha256, requestSnapshotSha256, preflightSnapshotSha256,
    request: normalizedRequest,
    items, providerCalls: 0, databaseWrites: 0, paidGenerationAuthorized: false,
  }
}

function parseCostRehearsalRequest(payload: unknown): YimengCostRehearsalRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId', 'episodeId', 'frameId', 'modelId', 'capability', 'requestedControls',
    'resolution', 'candidateCount', 'capabilityCatalog', 'catalogSnapshotSha256', 'requestSnapshotSha256',
    'preflightSnapshotSha256', 'capabilitySnapshotSha256',
  ])
  if (!Array.isArray(input.requestedControls)) {
    throw new InputError('requestedControls must be an array')
  }
  const requestedControls = [...new Set(input.requestedControls.map((value, index) => {
    const control = parseIdentifier(value, `requestedControls[${String(index)}]`)
    if (control.length > 128) throw new InputError('requested control must be at most 128 characters')
    return control
  }))].sort(compareUnicodeCodePoints)
  if (requestedControls.length > 64) throw new InputError('requestedControls exceeds limit')
  const capability = parseIdentifier(input.capability, 'capability')
  if (capability.length > 128) throw new InputError('capability must be at most 128 characters')
  const modelId = parseIdentifier(input.modelId, 'modelId')
  const resolution = parseIdentifier(input.resolution, 'resolution').toUpperCase()
  const candidateCount = requireInputInteger(input.candidateCount, 'candidateCount', 1, 8)
  const inputSha256 = (field: keyof Pick<YimengCostRehearsalRequest,
    'catalogSnapshotSha256' | 'requestSnapshotSha256' | 'preflightSnapshotSha256'
    | 'capabilitySnapshotSha256'>): string => {
    const value = parseIdentifier(input[field], field)
    if (!SHA256.test(value)) throw new InputError(`${field} must be a lowercase SHA-256`)
    return value
  }
  const catalogSnapshotSha256 = inputSha256('catalogSnapshotSha256')
  const requestSnapshotSha256 = inputSha256('requestSnapshotSha256')
  const preflightSnapshotSha256 = inputSha256('preflightSnapshotSha256')
  const capabilitySnapshotSha256 = inputSha256('capabilitySnapshotSha256')
  let capabilityCatalog: YimengCapabilityCatalogResponse
  try {
    capabilityCatalog = normalizeCapabilityCatalog(input.capabilityCatalog, {
      modelId,
      capability,
      requestedControls,
    })
  } catch (error) {
    if (error instanceof UpstreamContractError) {
      throw new InputError(`capabilityCatalog failed Host validation: ${error.message}`)
    }
    throw error
  }
  const catalogItem = capabilityCatalog.items[0]
  if (capabilityCatalog.items.length !== 1 || catalogItem === undefined
    || catalogItem.snapshot.modelId !== modelId
    || capabilityCatalog.catalogSnapshotSha256 !== catalogSnapshotSha256
    || capabilityCatalog.requestSnapshotSha256 !== requestSnapshotSha256
    || capabilityCatalog.preflightSnapshotSha256 !== preflightSnapshotSha256
    || catalogItem.capabilitySnapshotSha256 !== capabilitySnapshotSha256) {
    throw new InputError('cost rehearsal coordinates do not match capabilityCatalog')
  }
  const candidateLimit = Object.prototype.hasOwnProperty.call(catalogItem.snapshot.geometry, 'max_outputs')
    ? Math.min(8, catalogItem.snapshot.geometry.max_outputs as number)
    : 8
  if (candidateCount > candidateLimit) {
    throw new InputError('candidateCount exceeds capabilityCatalog maximum')
  }
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
    modelId,
    capability,
    requestedControls,
    resolution,
    candidateCount,
    capabilityCatalog,
    catalogSnapshotSha256,
    requestSnapshotSha256,
    preflightSnapshotSha256,
    capabilitySnapshotSha256,
  }
}

function normalizeCostEligibility(value: unknown): YimengCapabilityEligibility {
  const root = requireObject(value, 'costRehearsal.capabilityBinding.eligibility')
  assertExactOutputKeys(root, ['evaluated', 'eligible', 'errors'], 'costRehearsal.capabilityBinding.eligibility')
  const result = {
    evaluated: requireBoolean(root.evaluated, 'costRehearsal eligibility evaluated'),
    eligible: requireBoolean(root.eligible, 'costRehearsal eligibility eligible'),
    errors: requireCanonicalStringArray(root.errors, 'costRehearsal eligibility errors'),
  }
  if (!result.evaluated
    || (result.eligible && result.errors.length > 0)
    || (!result.eligible && result.errors.length === 0)) {
    throw new UpstreamContractError('costRehearsal eligibility is inconsistent')
  }
  return result
}

function microsCny(value: number): string {
  const micros = BigInt(value)
  const whole = micros / 1_000_000n
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0')
  return `${String(whole)}.${fraction}`
}

function safeBigIntNumber(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UpstreamContractError(`${field} exceeds safe integer range`)
  }
  return Number(value)
}

function decimalCnyToMicros(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new UpstreamContractError(`${field} must be a non-negative finite number`)
  }
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/u.exec(String(value).toLowerCase())
  if (match === null) throw new UpstreamContractError(`${field} has an invalid decimal form`)
  const whole = match[1] ?? '0'
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? 0) - fraction.length + 6
  let scaled = BigInt(`${whole}${fraction}`)
  if (exponent >= 0) {
    scaled *= 10n ** BigInt(exponent)
  } else {
    const divisor = 10n ** BigInt(-exponent)
    scaled = (scaled + divisor / 2n) / divisor
  }
  return safeBigIntNumber(scaled, field)
}

function catalogCandidateLimit(snapshot: YimengCapabilitySnapshot): number {
  return Object.prototype.hasOwnProperty.call(snapshot.geometry, 'max_outputs')
    ? Math.min(8, requireInteger(snapshot.geometry.max_outputs, 'capability geometry.max_outputs', 1))
    : 8
}

function catalogRateMicros(snapshot: YimengCapabilitySnapshot, resolution: string): number {
  const cost = requireObject(snapshot.cost, 'capability cost')
  const rates = requireObject(cost.by_resolution, 'capability cost.by_resolution')
  if (cost.currency !== 'CNY' || cost.unit !== 'second'
    || !Object.prototype.hasOwnProperty.call(rates, resolution)) {
    throw new UpstreamContractError('capability cost does not declare the requested CNY/second resolution')
  }
  return decimalCnyToMicros(rates[resolution], `capability cost.by_resolution.${resolution}`)
}

function normalizeCostRehearsal(
  value: unknown,
  expected: YimengCostRehearsalRequest,
): YimengCostRehearsalResponse {
  const root = requireObject(value, 'costRehearsal')
  assertExactOutputKeys(root, [
    'schema', 'productionStatus', 'mode', 'snapshotPolicy', 'subject', 'capabilityBinding',
    'costEstimate', 'budgetWindow', 'reservationRehearsal', 'difference',
    'rehearsalSnapshotSha256', 'providerCalls', 'databaseWrites', 'budgetLedgerWrites',
    'taskCreated', 'queueEntered', 'submitAttempted', 'pollAttempted', 'downloadAttempted',
    'webhookRegistered', 'paidGenerationAuthorized',
  ], 'costRehearsal')
  if (root.schema !== 'jason.provider-cost-rehearsal.v1'
    || root.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION'
    || root.mode !== 'dry_run'
    || root.snapshotPolicy !== 'rfc8785-jcs-sha256-v1'
    || root.providerCalls !== 0 || root.databaseWrites !== 0 || root.budgetLedgerWrites !== 0
    || root.taskCreated !== false || root.queueEntered !== false || root.submitAttempted !== false
    || root.pollAttempted !== false || root.downloadAttempted !== false
    || root.webhookRegistered !== false || root.paidGenerationAuthorized !== false) {
    throw new UpstreamContractError('costRehearsal identity or zero-authority boundary mismatch')
  }
  const catalogItem = expected.capabilityCatalog.items[0]
  if (catalogItem === undefined || expected.capabilityCatalog.items.length !== 1) {
    throw new UpstreamContractError('costRehearsal capabilityCatalog item is not unique')
  }

  const rawSubject = requireObject(root.subject, 'costRehearsal.subject')
  assertExactOutputKeys(rawSubject, [
    'projectId', 'episodeId', 'frameId', 'frameNumber', 'frameUpdatedAt',
    'durationMillis', 'subjectSnapshotSha256',
  ], 'costRehearsal.subject')
  const subjectIdentity = {
    projectId: requireIdentifier(rawSubject.projectId, 'costRehearsal.subject.projectId'),
    episodeId: requireIdentifier(rawSubject.episodeId, 'costRehearsal.subject.episodeId'),
    frameId: requireIdentifier(rawSubject.frameId, 'costRehearsal.subject.frameId'),
    frameNumber: requireInteger(rawSubject.frameNumber, 'costRehearsal.subject.frameNumber', 0),
    frameUpdatedAt: requireIdentifier(rawSubject.frameUpdatedAt, 'costRehearsal.subject.frameUpdatedAt'),
    durationMillis: requireInteger(rawSubject.durationMillis, 'costRehearsal.subject.durationMillis', 1, 600_000),
  }
  if (subjectIdentity.projectId !== expected.projectId
    || subjectIdentity.episodeId !== expected.episodeId
    || subjectIdentity.frameId !== expected.frameId) {
    throw new UpstreamContractError('costRehearsal subject echo mismatch')
  }
  const subject = {
    ...subjectIdentity,
    subjectSnapshotSha256: requireSha256(
      rawSubject.subjectSnapshotSha256,
      'costRehearsal.subject.subjectSnapshotSha256',
    ),
  }
  if (subject.subjectSnapshotSha256 !== jcsSha256(subjectIdentity, 'costRehearsal.subjectIdentity')) {
    throw new UpstreamContractError('costRehearsal subject SHA mismatch')
  }

  const rawBinding = requireObject(root.capabilityBinding, 'costRehearsal.capabilityBinding')
  assertExactOutputKeys(rawBinding, [
    'modelId', 'capability', 'requestedControls', 'resolution', 'catalogSnapshotSha256',
    'requestSnapshotSha256', 'preflightSnapshotSha256', 'capabilitySnapshotId',
    'capabilitySnapshotSha256', 'eligibility', 'paidDispatchAllowed',
  ], 'costRehearsal.capabilityBinding')
  const capabilitySnapshotSha256 = requireSha256(
    rawBinding.capabilitySnapshotSha256,
    'costRehearsal.capabilityBinding.capabilitySnapshotSha256',
  )
  const capabilityBinding = {
    modelId: requireIdentifier(rawBinding.modelId, 'costRehearsal.capabilityBinding.modelId'),
    capability: requireIdentifier(rawBinding.capability, 'costRehearsal.capabilityBinding.capability'),
    requestedControls: requireCanonicalStringArray(
      rawBinding.requestedControls,
      'costRehearsal.capabilityBinding.requestedControls',
    ),
    resolution: requireIdentifier(rawBinding.resolution, 'costRehearsal.capabilityBinding.resolution'),
    catalogSnapshotSha256: requireSha256(
      rawBinding.catalogSnapshotSha256,
      'costRehearsal.capabilityBinding.catalogSnapshotSha256',
    ),
    requestSnapshotSha256: requireSha256(
      rawBinding.requestSnapshotSha256,
      'costRehearsal.capabilityBinding.requestSnapshotSha256',
    ),
    preflightSnapshotSha256: requireSha256(
      rawBinding.preflightSnapshotSha256,
      'costRehearsal.capabilityBinding.preflightSnapshotSha256',
    ),
    capabilitySnapshotId: requireIdentifier(
      rawBinding.capabilitySnapshotId,
      'costRehearsal.capabilityBinding.capabilitySnapshotId',
    ),
    capabilitySnapshotSha256,
    eligibility: normalizeCostEligibility(rawBinding.eligibility),
    paidDispatchAllowed: false as const,
  }
  if (rawBinding.paidDispatchAllowed !== false
    || capabilityBinding.modelId !== expected.modelId
    || capabilityBinding.capability !== expected.capability
    || capabilityBinding.resolution !== expected.resolution
    || !isDeepStrictEqual(capabilityBinding.requestedControls, expected.requestedControls)
    || capabilityBinding.catalogSnapshotSha256 !== expected.catalogSnapshotSha256
    || capabilityBinding.requestSnapshotSha256 !== expected.requestSnapshotSha256
    || capabilityBinding.preflightSnapshotSha256 !== expected.preflightSnapshotSha256
    || capabilityBinding.capabilitySnapshotSha256 !== expected.capabilitySnapshotSha256
    || capabilityBinding.capabilitySnapshotId !== catalogItem.capabilitySnapshotId
    || !isDeepStrictEqual(capabilityBinding.eligibility, catalogItem.eligibility)
    || capabilityBinding.paidDispatchAllowed !== catalogItem.snapshot.compliance.paidDispatchAllowed) {
    throw new UpstreamContractError('costRehearsal capability binding mismatch')
  }

  const rawCost = requireObject(root.costEstimate, 'costRehearsal.costEstimate')
  assertExactOutputKeys(rawCost, [
    'currency', 'unit', 'formula', 'resolution', 'rateMicrosPerSecond', 'oneCandidateMicros',
    'candidateCount', 'maximumAllowedCandidateCount', 'maximumCostMicros',
    'oneCandidateCny', 'maximumCostCny',
  ], 'costRehearsal.costEstimate')
  const costEstimate = {
    currency: 'CNY' as const,
    unit: 'second' as const,
    formula: 'duration_seconds_x_resolution_rate_x_candidates' as const,
    resolution: requireIdentifier(rawCost.resolution, 'costRehearsal.costEstimate.resolution'),
    rateMicrosPerSecond: requireInteger(rawCost.rateMicrosPerSecond, 'costRehearsal.rateMicrosPerSecond', 0),
    oneCandidateMicros: requireInteger(rawCost.oneCandidateMicros, 'costRehearsal.oneCandidateMicros', 0),
    candidateCount: requireInteger(rawCost.candidateCount, 'costRehearsal.candidateCount', 1, 8),
    maximumAllowedCandidateCount: requireInteger(
      rawCost.maximumAllowedCandidateCount,
      'costRehearsal.maximumAllowedCandidateCount',
      1,
      8,
    ),
    maximumCostMicros: requireInteger(rawCost.maximumCostMicros, 'costRehearsal.maximumCostMicros', 0),
    oneCandidateCny: requireString(rawCost.oneCandidateCny, 'costRehearsal.oneCandidateCny'),
    maximumCostCny: requireString(rawCost.maximumCostCny, 'costRehearsal.maximumCostCny'),
  }
  const expectedOneCandidate = safeBigIntNumber(
    (BigInt(costEstimate.rateMicrosPerSecond) * BigInt(subject.durationMillis) + 500n) / 1_000n,
    'costRehearsal one-candidate estimate',
  )
  const expectedMaximum = safeBigIntNumber(
    BigInt(costEstimate.oneCandidateMicros) * BigInt(costEstimate.candidateCount),
    'costRehearsal maximum estimate',
  )
  const expectedRateMicros = catalogRateMicros(catalogItem.snapshot, expected.resolution)
  const expectedMaximumAllowedCandidateCount = catalogCandidateLimit(catalogItem.snapshot)
  if (rawCost.currency !== 'CNY' || rawCost.unit !== 'second'
    || rawCost.formula !== 'duration_seconds_x_resolution_rate_x_candidates'
    || costEstimate.resolution !== expected.resolution
    || costEstimate.rateMicrosPerSecond !== expectedRateMicros
    || costEstimate.candidateCount !== expected.candidateCount
    || costEstimate.maximumAllowedCandidateCount !== expectedMaximumAllowedCandidateCount
    || costEstimate.candidateCount > expectedMaximumAllowedCandidateCount
    || costEstimate.oneCandidateMicros !== expectedOneCandidate
    || costEstimate.maximumCostMicros !== expectedMaximum
    || costEstimate.oneCandidateCny !== microsCny(costEstimate.oneCandidateMicros)
    || costEstimate.maximumCostCny !== microsCny(costEstimate.maximumCostMicros)) {
    throw new UpstreamContractError('costRehearsal estimate formula mismatch')
  }

  const rawBudget = requireObject(root.budgetWindow, 'costRehearsal.budgetWindow')
  assertExactOutputKeys(rawBudget, [
    'scope', 'projectQuotaStatus', 'episodeQuotaStatus', 'valid', 'errors', 'windowId',
    'baselineMicros', 'allowanceMicros', 'effectiveCapMicros', 'lifetimeSpentMicros',
    'windowSpentMicros', 'windowRemainingMicros',
  ], 'costRehearsal.budgetWindow')
  const budgetWindow = {
    scope: 'global_provider_window' as const,
    projectQuotaStatus: 'NOT_CONFIGURED' as const,
    episodeQuotaStatus: 'NOT_CONFIGURED' as const,
    valid: requireBoolean(rawBudget.valid, 'costRehearsal.budgetWindow.valid'),
    errors: requireCanonicalStringArray(rawBudget.errors, 'costRehearsal.budgetWindow.errors'),
    windowId: requireString(rawBudget.windowId, 'costRehearsal.budgetWindow.windowId'),
    baselineMicros: requireInteger(rawBudget.baselineMicros, 'costRehearsal.budgetWindow.baselineMicros', 0),
    allowanceMicros: requireInteger(rawBudget.allowanceMicros, 'costRehearsal.budgetWindow.allowanceMicros', 0),
    effectiveCapMicros: requireInteger(rawBudget.effectiveCapMicros, 'costRehearsal.budgetWindow.effectiveCapMicros', 0),
    lifetimeSpentMicros: requireInteger(rawBudget.lifetimeSpentMicros, 'costRehearsal.budgetWindow.lifetimeSpentMicros', 0),
    windowSpentMicros: requireInteger(rawBudget.windowSpentMicros, 'costRehearsal.budgetWindow.windowSpentMicros', 0),
    windowRemainingMicros: requireInteger(rawBudget.windowRemainingMicros, 'costRehearsal.budgetWindow.windowRemainingMicros', 0),
  }
  const expectedEffectiveCapMicros = safeBigIntNumber(
    BigInt(budgetWindow.baselineMicros) + BigInt(budgetWindow.allowanceMicros),
    'costRehearsal budget effective cap',
  )
  const expectedWindowSpentMicros = Math.max(
    0,
    budgetWindow.lifetimeSpentMicros - budgetWindow.baselineMicros,
  )
  const expectedWindowRemainingMicros = budgetWindow.valid
    ? Math.max(0, expectedEffectiveCapMicros - budgetWindow.lifetimeSpentMicros)
    : 0
  if (rawBudget.scope !== 'global_provider_window'
    || rawBudget.projectQuotaStatus !== 'NOT_CONFIGURED'
    || rawBudget.episodeQuotaStatus !== 'NOT_CONFIGURED'
    || budgetWindow.valid !== (budgetWindow.errors.length === 0)
    || budgetWindow.effectiveCapMicros !== expectedEffectiveCapMicros
    || budgetWindow.windowSpentMicros !== expectedWindowSpentMicros
    || budgetWindow.windowRemainingMicros !== expectedWindowRemainingMicros) {
    throw new UpstreamContractError('costRehearsal budget window mismatch')
  }

  const rawReservation = requireObject(root.reservationRehearsal, 'costRehearsal.reservationRehearsal')
  assertExactOutputKeys(rawReservation, [
    'status', 'blockers', 'proposedReservationMicros', 'formallyReservedMicros',
    'formalReservationId', 'wouldFitBudget', 'remainingIfReservedMicros',
    'exactAuthorizationRequired', 'formalReservationAllowed',
  ], 'costRehearsal.reservationRehearsal')
  const blockers = requireCanonicalStringArray(rawReservation.blockers, 'costRehearsal reservation blockers')
  const wouldFitBudget = requireBoolean(rawReservation.wouldFitBudget, 'costRehearsal wouldFitBudget')
  const remainingIfReservedMicros = rawReservation.remainingIfReservedMicros === null
    ? null
    : requireInteger(rawReservation.remainingIfReservedMicros, 'costRehearsal remainingIfReservedMicros', 0)
  const status = rawReservation.status
  if (status !== 'READY_NOT_RESERVED_DRY_RUN' && status !== 'BLOCKED_NOT_RESERVED_DRY_RUN') {
    throw new UpstreamContractError('costRehearsal reservation status mismatch')
  }
  const reservationStatus: YimengCostRehearsalResponse['reservationRehearsal']['status'] = status
  const reservationRehearsal = {
    status: reservationStatus,
    blockers,
    proposedReservationMicros: requireInteger(
      rawReservation.proposedReservationMicros,
      'costRehearsal proposedReservationMicros',
      0,
    ),
    formallyReservedMicros: 0 as const,
    formalReservationId: null,
    wouldFitBudget,
    remainingIfReservedMicros,
    exactAuthorizationRequired: true as const,
    formalReservationAllowed: false as const,
  }
  const expectedWouldFit = budgetWindow.valid
    && costEstimate.maximumCostMicros <= budgetWindow.windowRemainingMicros
  if (rawReservation.formallyReservedMicros !== 0 || rawReservation.formalReservationId !== null
    || rawReservation.exactAuthorizationRequired !== true || rawReservation.formalReservationAllowed !== false
    || reservationRehearsal.proposedReservationMicros !== costEstimate.maximumCostMicros
    || wouldFitBudget !== expectedWouldFit
    || remainingIfReservedMicros !== (expectedWouldFit
      ? budgetWindow.windowRemainingMicros - costEstimate.maximumCostMicros
      : null)
    || reservationStatus !== (blockers.length === 0
      ? 'READY_NOT_RESERVED_DRY_RUN'
      : 'BLOCKED_NOT_RESERVED_DRY_RUN')
    || (!wouldFitBudget && budgetWindow.valid && !blockers.includes('budget:insufficient_remaining'))
    || capabilityBinding.eligibility.errors.some(error => !blockers.includes(`capability:${error}`))
    || budgetWindow.errors.some(error => !blockers.includes(`budget:${error}`))) {
    throw new UpstreamContractError('costRehearsal reservation rehearsal mismatch')
  }

  const rawDifference = requireObject(root.difference, 'costRehearsal.difference')
  assertExactOutputKeys(rawDifference, [
    'estimateToProposedReservationMicros', 'estimateToFormalReservationMicros',
    'actualCostMicros', 'actualVsProposedReservationMicros', 'releasedMicros',
    'refundMicros', 'actualCostStatus',
  ], 'costRehearsal.difference')
  const difference = {
    estimateToProposedReservationMicros: 0 as const,
    estimateToFormalReservationMicros: requireInteger(
      rawDifference.estimateToFormalReservationMicros,
      'costRehearsal estimateToFormalReservationMicros',
      0,
    ),
    actualCostMicros: null,
    actualVsProposedReservationMicros: null,
    releasedMicros: 0 as const,
    refundMicros: null,
    actualCostStatus: 'UNAVAILABLE_BEFORE_SUBMIT' as const,
  }
  if (rawDifference.estimateToProposedReservationMicros !== 0
    || difference.estimateToFormalReservationMicros !== costEstimate.maximumCostMicros
    || rawDifference.actualCostMicros !== null || rawDifference.actualVsProposedReservationMicros !== null
    || rawDifference.releasedMicros !== 0 || rawDifference.refundMicros !== null
    || rawDifference.actualCostStatus !== 'UNAVAILABLE_BEFORE_SUBMIT') {
    throw new UpstreamContractError('costRehearsal difference mismatch')
  }

  const identity = {
    schema: 'jason.provider-cost-rehearsal-snapshot.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    mode: 'dry_run',
    subject,
    capabilityBinding,
    costEstimate,
    budgetWindow,
    reservationRehearsal,
    difference,
  }
  const rehearsalSnapshotSha256 = requireSha256(
    root.rehearsalSnapshotSha256,
    'costRehearsal.rehearsalSnapshotSha256',
  )
  if (rehearsalSnapshotSha256 !== jcsSha256(identity, 'costRehearsal.identity')) {
    throw new UpstreamContractError('costRehearsal snapshot SHA mismatch')
  }
  return {
    schema: 'jason.provider-cost-rehearsal.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    mode: 'dry_run',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    subject,
    capabilityBinding,
    costEstimate,
    budgetWindow,
    reservationRehearsal,
    difference,
    rehearsalSnapshotSha256,
    providerCalls: 0,
    databaseWrites: 0,
    budgetLedgerWrites: 0,
    taskCreated: false,
    queueEntered: false,
    submitAttempted: false,
    pollAttempted: false,
    downloadAttempted: false,
    webhookRegistered: false,
    paidGenerationAuthorized: false,
  }
}

const GATE_A_ENVIRONMENT = {
  database: 'temporary_sqlite',
  networkEgressAllowed: false,
  provider: 'scripted_fake',
  productionCredentialsLoaded: false,
  temporaryDatabaseWrites: true,
} as const

const GATE_A_ASSERTIONS = {
  externalProviderCalls: 0,
  productionDatabaseWrites: 0,
  formalBudgetLedgerWrites: 0,
  duplicatePaidSubmissions: 0,
  unknownAutomaticResubmits: 0,
  maximumAutomaticSubmitAttemptsPerDispatch: 1,
  networkEgressAttempts: 0,
  truncatedDownloadsAccepted: 0,
  reconciliationProviderCalls: 0,
  pollRecoveryResubmits: 0,
  downloadRecoveryResubmits: 0,
} as const

const GATE_A_SCENARIO_SPECS = [
  {
    id: 'unauthorized_request_blocked',
    values: { providerSubmitAttempts: 0, budgetReserved: false },
  },
  {
    id: 'duplicate_ack_replay',
    values: { providerSubmitAttempts: 1, duplicateAckReplays: 1, duplicatePaidSubmissions: 0 },
  },
  {
    id: 'payload_sha_conflict',
    values: { providerSubmitAttempts: 1, conflictingSubmitAttempts: 0 },
  },
  {
    id: 'submission_unknown_quarantine',
    values: {
      providerSubmitAttempts: 1,
      automaticResubmits: 0,
      workerOutcomes: ['dispatch_state_unknown'],
    },
  },
  {
    id: 'simulated_reconciliation',
    values: {
      providerCalls: 0,
      deduplicated: true,
      simulatedOperatorDecision: true,
      humanSignoffInferred: false,
    },
  },
  {
    id: 'poll_recovery',
    values: {
      providerSubmitAttempts: 1,
      providerPollAttempts: 2,
      automaticResubmits: 0,
      workerOutcomes: ['dispatched', 'error', 'ingested', 'technical_quality_passed'],
    },
  },
  {
    id: 'download_timeout_recovery',
    values: {
      providerSubmitAttempts: 1,
      providerPollAttempts: 1,
      downloadAttempts: 2,
      automaticResubmits: 0,
      workerOutcomes: ['dispatched', 'download_timeout_retry', 'ingested', 'technical_quality_passed'],
    },
  },
  {
    id: 'truncated_download_rejected',
    values: {
      providerSubmitAttempts: 1,
      providerPollAttempts: 1,
      downloadAttempts: 1,
      truncatedDownloadsAccepted: 0,
    },
  },
] as const satisfies readonly {
  readonly id: YimengGateAControlScenarioId
  readonly values: YimengJsonObject
}[]

function normalizeGateAControlEvidence(value: unknown): YimengGateAControlEvidenceResponse {
  const root = requireObject(value, 'gateAControlEvidence')
  assertExactOutputKeys(root, [
    'schema', 'productionStatus', 'gateAStatus', 'mode', 'snapshotPolicy', 'environment',
    'scenarios', 'assertions', 'sourceBindings', 'externalProviderCalls', 'productionDatabaseWrites',
    'formalBudgetLedgerWrites', 'simulatedProviderSubmitAttempts', 'paidGenerationAuthorized',
    'humanSignoffInferred', 'evidenceSnapshotSha256',
  ], 'gateAControlEvidence')
  if (root.schema !== 'jason.qingmu-provider-gate-a-control-evidence.v1'
    || root.productionStatus !== 'UNVERIFIED_FOR_PAID_PRODUCTION'
    || root.gateAStatus !== 'PASSED_CONTROL_LOGIC_ONLY'
    || root.mode !== 'offline_fault_injection'
    || root.snapshotPolicy !== 'rfc8785-jcs-sha256-v1') {
    throw new UpstreamContractError('Gate A control evidence identity mismatch')
  }

  const rawEnvironment = requireObject(root.environment, 'gateAControlEvidence.environment')
  assertExactOutputKeys(rawEnvironment, Object.keys(GATE_A_ENVIRONMENT), 'gateAControlEvidence.environment')
  if (!isDeepStrictEqual(rawEnvironment, GATE_A_ENVIRONMENT)) {
    throw new UpstreamContractError('Gate A control evidence environment mismatch')
  }

  const rawScenarios = requireObjectItems(root.scenarios, 'gateAControlEvidence.scenarios')
  if (rawScenarios.length !== GATE_A_SCENARIO_SPECS.length) {
    throw new UpstreamContractError('Gate A control evidence scenario count mismatch')
  }
  const scenarios = GATE_A_SCENARIO_SPECS.map<YimengGateAControlScenario>((spec, index) => {
    const raw = rawScenarios[index]
    if (raw === undefined) throw new UpstreamContractError('Gate A control evidence scenario missing')
    assertExactOutputKeys(raw, ['id', 'outcome', ...Object.keys(spec.values)], `gateAControlEvidence.scenarios[${String(index)}]`)
    if (raw.id !== spec.id || raw.outcome !== 'passed') {
      throw new UpstreamContractError('Gate A control evidence scenario identity mismatch')
    }
    for (const [field, expected] of Object.entries(spec.values)) {
      if (!isDeepStrictEqual(raw[field], expected)) {
        throw new UpstreamContractError(`Gate A control evidence scenario assertion mismatch: ${spec.id}.${field}`)
      }
    }
    return { id: spec.id, outcome: 'passed', ...spec.values }
  })

  const rawAssertions = requireObject(root.assertions, 'gateAControlEvidence.assertions')
  assertExactOutputKeys(rawAssertions, Object.keys(GATE_A_ASSERTIONS), 'gateAControlEvidence.assertions')
  if (!isDeepStrictEqual(rawAssertions, GATE_A_ASSERTIONS)) {
    throw new UpstreamContractError('Gate A control evidence assertions mismatch')
  }

  const seenPaths = new Set<string>()
  const sourceBindings = requireObjectItems(root.sourceBindings, 'gateAControlEvidence.sourceBindings')
    .map((raw, index) => {
      assertExactOutputKeys(raw, ['path', 'sha256'], `gateAControlEvidence.sourceBindings[${String(index)}]`)
      const path = requireString(raw.path, `gateAControlEvidence.sourceBindings[${String(index)}].path`)
      const segments = path.split('/')
      if (path.length === 0 || path.length > 500 || path.trim() !== path || path.startsWith('/')
        || path.includes('\\') || segments.some(segment => segment === '' || segment === '.' || segment === '..')
        || seenPaths.has(path)) {
        throw new UpstreamContractError('Gate A control evidence source path is not a unique relative path')
      }
      seenPaths.add(path)
      return {
        path,
        sha256: requireSha256(raw.sha256, `gateAControlEvidence.sourceBindings[${String(index)}].sha256`),
      }
    })
  if (sourceBindings.length === 0
    || !isDeepStrictEqual(sourceBindings, [...sourceBindings].sort((left, right) => (
      compareUnicodeCodePoints(left.path, right.path)
    )))) {
    throw new UpstreamContractError('Gate A control evidence source bindings must use canonical path order')
  }

  if (root.externalProviderCalls !== 0 || root.productionDatabaseWrites !== 0
    || root.formalBudgetLedgerWrites !== 0 || root.simulatedProviderSubmitAttempts !== 6
    || root.paidGenerationAuthorized !== false || root.humanSignoffInferred !== false) {
    throw new UpstreamContractError('Gate A control evidence authority boundary mismatch')
  }

  const identity = {
    schema: 'jason.qingmu-provider-gate-a-control-evidence.v1',
    productionStatus: 'UNVERIFIED_FOR_PAID_PRODUCTION',
    gateAStatus: 'PASSED_CONTROL_LOGIC_ONLY',
    mode: 'offline_fault_injection',
    snapshotPolicy: 'rfc8785-jcs-sha256-v1',
    environment: GATE_A_ENVIRONMENT,
    scenarios,
    assertions: GATE_A_ASSERTIONS,
    sourceBindings,
    externalProviderCalls: 0,
    productionDatabaseWrites: 0,
    formalBudgetLedgerWrites: 0,
    simulatedProviderSubmitAttempts: 6,
    paidGenerationAuthorized: false,
    humanSignoffInferred: false,
  } as const
  const evidenceSnapshotSha256 = requireSha256(
    root.evidenceSnapshotSha256,
    'gateAControlEvidence.evidenceSnapshotSha256',
  )
  if (evidenceSnapshotSha256 !== jcsSha256(identity, 'gateAControlEvidence.identity')) {
    throw new UpstreamContractError('Gate A control evidence snapshot SHA mismatch')
  }
  return { ...identity, evidenceSnapshotSha256 }
}

function normalizeProjects(value: unknown): YimengProjectsResponse {
  const root = requireObject(value, 'projects')
  return {
    items: requireObjectItems(root.items, 'projects.items'),
    pagination: {
      page: requireInteger(root.page, 'projects.page', 1),
      pageSize: requireInteger(root.page_size, 'projects.page_size', 1, 100),
      pages: requireInteger(root.pages, 'projects.pages', 0),
      total: requireInteger(root.total, 'projects.total', 0),
    },
  }
}

function normalizeEpisodes(value: unknown, expectedProjectId: string): YimengEpisodesResponse {
  const root = requireObject(value, 'episodes')
  const items = requireObjectItems(root.items, 'episodes.items').map((item, index) => {
    const projectId = requireString(item.projectId ?? item.project_id, `episodes.items[${String(index)}].projectId`)
    if (
      projectId !== expectedProjectId
      || (item.projectId !== undefined && requireString(item.projectId, 'episodes.item.projectId') !== projectId)
      || (item.project_id !== undefined && requireString(item.project_id, 'episodes.item.project_id') !== projectId)
    ) {
      throw new UpstreamContractError('episodes project subject mismatch')
    }
    return { ...item, projectId }
  })
  return { items }
}

function normalizeScript(value: unknown): YimengScriptResponse {
  const root = requireObject(value, 'script')
  const found = requireBoolean(root.found, 'script.found')
  const script = root.script === null ? null : requireObject(root.script, 'script.script')
  let scriptSha256: string | null
  if (found) {
    if (script === null) throw new UpstreamContractError('script.script must exist when found')
    assertSafeJsonNumbers(script, 'script.script')
    const canonicalJson = requireString(root.scriptCanonicalJson, 'script.scriptCanonicalJson')
    scriptSha256 = requireSha256(root.scriptSha256, 'script.scriptSha256')
    const actualSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
    if (actualSha256 !== scriptSha256) {
      throw new UpstreamContractError('script canonical JSON sha256 mismatch')
    }
    let canonicalScript: unknown
    try {
      canonicalScript = JSON.parse(canonicalJson) as unknown
    } catch {
      throw new UpstreamContractError('script.scriptCanonicalJson must be valid JSON')
    }
    assertSafeJsonNumbers(canonicalScript, 'script.scriptCanonicalJson')
    if (!isJsonObject(canonicalScript) || !isDeepStrictEqual(canonicalScript, script)) {
      throw new UpstreamContractError('script canonical JSON content mismatch')
    }
  } else {
    if (script !== null) throw new UpstreamContractError('script.script must be null when not found')
    if (root.scriptCanonicalJson !== null || root.scriptSha256 !== null) {
      throw new UpstreamContractError('script canonical evidence must be null when not found')
    }
    scriptSha256 = null
  }
  const retained = { ...root }
  delete retained.scriptCanonicalJson
  return {
    ...retained,
    found,
    projectId: requireString(root.projectId, 'script.projectId'),
    episodeId: requireString(root.episodeId, 'script.episodeId'),
    script,
    scriptSha256,
    revision: requireInteger(root.revision, 'script.revision', 0),
    editedByUser: requireBoolean(root.editedByUser, 'script.editedByUser'),
    updatedAt: requireString(root.updatedAt, 'script.updatedAt'),
    ...(root.error === undefined ? {} : { error: requireString(root.error, 'script.error') }),
  }
}

function normalizePromptIrEditableProjection(value: unknown): YimengPromptIrEditableProjection {
  const projection = requireObject(value, 'promptIr.subject.editableProjection')
  return {
    imageGenPrompt: requireString(projection.imageGenPrompt, 'promptIr.subject.editableProjection.imageGenPrompt'),
    lastFrameImagePrompt: requireString(
      projection.lastFrameImagePrompt,
      'promptIr.subject.editableProjection.lastFrameImagePrompt',
    ),
    videoGenPrompt: requireString(projection.videoGenPrompt, 'promptIr.subject.editableProjection.videoGenPrompt'),
    motionPrompt: requireString(projection.motionPrompt, 'promptIr.subject.editableProjection.motionPrompt'),
    negativePrompt: requireString(projection.negativePrompt, 'promptIr.subject.editableProjection.negativePrompt'),
  }
}

function normalizePromptIr(value: unknown, expected: YimengPromptIrRequest): YimengPromptIrResponse {
  const root = requireObject(value, 'promptIr')
  if (root.schema !== 'jason.qingmu-prompt-ir-subject-read.v1') {
    throw new UpstreamContractError('promptIr.schema mismatch')
  }
  const upstreamSubject = requireObject(root.subject, 'promptIr.subject')
  const subjectSchema = requireString(upstreamSubject.schema, 'promptIr.subject.schema')
  const targetType = requireString(upstreamSubject.targetType, 'promptIr.subject.targetType')
  const status = requireString(upstreamSubject.status, 'promptIr.subject.status')
  if (
    subjectSchema !== 'jason.qingmu-prompt-ir-subject.v1'
    || targetType !== 'prompt_ir'
    || status !== 'Ready'
  ) {
    throw new UpstreamContractError('promptIr subject mismatch')
  }
  const subject: YimengPromptIrSubject = {
    schema: subjectSchema,
    projectId: requireIdentifier(upstreamSubject.projectId, 'promptIr.subject.projectId'),
    episodeId: requireIdentifier(upstreamSubject.episodeId, 'promptIr.subject.episodeId'),
    targetType,
    targetId: requireString(upstreamSubject.targetId, 'promptIr.subject.targetId'),
    storyboardRevisionId: requireIdentifier(
      upstreamSubject.storyboardRevisionId,
      'promptIr.subject.storyboardRevisionId',
    ),
    frameId: requireIdentifier(upstreamSubject.frameId, 'promptIr.subject.frameId'),
    promptIrId: requireIdentifier(upstreamSubject.promptIrId, 'promptIr.subject.promptIrId'),
    promptIrVersion: requireInteger(upstreamSubject.promptIrVersion, 'promptIr.subject.promptIrVersion', 1),
    promptIrContentSha256: requireSha256(
      upstreamSubject.promptIrContentSha256,
      'promptIr.subject.promptIrContentSha256',
    ),
    status,
    editableProjection: normalizePromptIrEditableProjection(upstreamSubject.editableProjection),
  }
  if (
    subject.projectId !== expected.projectId
    || subject.episodeId !== expected.episodeId
    || subject.targetId !== `${expected.storyboardRevisionId}:${expected.frameId}`
    || subject.storyboardRevisionId !== expected.storyboardRevisionId
    || subject.frameId !== expected.frameId
  ) {
    throw new UpstreamContractError('promptIr subject mismatch')
  }
  const baseRevision = requireInteger(root.baseRevision, 'promptIr.baseRevision', 1)
  if (baseRevision !== subject.promptIrVersion) {
    throw new UpstreamContractError('promptIr base revision mismatch')
  }
  const baseSnapshotSha256 = requireSha256(root.baseSnapshotSha256, 'promptIr.baseSnapshotSha256')
  if (canonicalJsonSha256(subject, 'promptIr.subject') !== baseSnapshotSha256) {
    throw new UpstreamContractError('promptIr subject snapshot sha256 mismatch')
  }
  return {
    schema: 'jason.qingmu-prompt-ir-subject-read.v1',
    subject,
    baseRevision,
    baseSnapshotSha256,
  }
}

function requireExactKeys(value: YimengJsonObject, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (!isDeepStrictEqual(actual, expected)) {
    throw new UpstreamContractError(`${field} fields mismatch`)
  }
}

function normalizeRightsText(value: unknown, required: boolean, field: string): string | null {
  if (value === null && !required) return null
  if (typeof value !== 'string' || value.includes('\u0000')) {
    throw new UpstreamContractError(`${field} must be text or null`)
  }
  const normalized = value.trim()
  if ((required && normalized.length === 0) || normalized.length > 4_000) {
    throw new UpstreamContractError(`${field} is invalid`)
  }
  return normalized.length === 0 ? null : normalized
}

function normalizeRightsState(value: unknown, field: string): YimengReferenceRightsKnowledgeState {
  if (!RIGHTS_KNOWLEDGE_STATES.has(value as YimengReferenceRightsKnowledgeState)) {
    throw new UpstreamContractError(`${field} is invalid`)
  }
  return value as YimengReferenceRightsKnowledgeState
}

function normalizeRightsScalar(value: unknown, field: string): YimengReferenceRightsScalar {
  const object = requireObject(value, field)
  requireExactKeys(object, ['state', 'value'], field)
  const state = normalizeRightsState(object.state, `${field}.state`)
  const normalizedValue = normalizeRightsText(object.value, state === 'known', `${field}.value`)
  if (state !== 'known' && normalizedValue !== null) {
    throw new UpstreamContractError(`${field}.value must be null unless known`)
  }
  return { state, value: normalizedValue }
}

function normalizeRightsList(
  value: unknown,
  field: string,
  allowEmptyKnown = false,
): YimengReferenceRightsList {
  const object = requireObject(value, field)
  requireExactKeys(object, ['state', 'values'], field)
  const state = normalizeRightsState(object.state, `${field}.state`)
  if (!Array.isArray(object.values)) throw new UpstreamContractError(`${field}.values must be an array`)
  const normalized = [...new Set(object.values.map((item, index) => (
    normalizeRightsText(item, true, `${field}.values[${String(index)}]`) as string
  )))].sort(compareUnicodeCodePoints)
  if (normalized.length !== object.values.length || normalized.length > 50) {
    throw new UpstreamContractError(`${field}.values are invalid`)
  }
  if (state === 'known' ? (!allowEmptyKnown && normalized.length === 0) : normalized.length !== 0) {
    throw new UpstreamContractError(`${field}.values conflict with state`)
  }
  return { state, values: normalized }
}

function normalizeRightsTimestamp(value: unknown, required: boolean, field: string): string | null {
  const normalized = normalizeRightsText(value, required, field)
  if (normalized === null) return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(normalized)
  if (match === null || Number.isNaN(Date.parse(normalized))) {
    throw new UpstreamContractError(`${field} must be a UTC Z timestamp`)
  }
  const parsed = new Date(normalized)
  if (parsed.toISOString().slice(0, 19) !== match[1]) {
    throw new UpstreamContractError(`${field} must be a valid UTC Z timestamp`)
  }
  const fraction = match[2]?.padEnd(6, '0')
  return `${match[1]}${fraction !== undefined && Number(fraction) !== 0 ? `.${fraction}` : ''}Z`
}

/** Strictly normalize one authoritative reference-rights record without retaining unknown fields. */
export function normalizeReferenceRightsRecord(value: unknown, field = 'rights'): YimengReferenceRightsRecord {
  const object = requireObject(value, field)
  requireExactKeys(object, [
    'schema', 'sourceType', 'rightsHolder', 'authorizationScope', 'territory', 'term',
    'restrictions', 'contains', 'providerTerms', 'modelLicenses', 'humanDeclaration',
    'contentCredentials',
  ], field)
  if (object.schema !== 'jason.qingmu-reference-rights-record.v1') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  const term = requireObject(object.term, `${field}.term`)
  requireExactKeys(term, ['state', 'startsAt', 'endsAt', 'perpetual'], `${field}.term`)
  const termState = normalizeRightsState(term.state, `${field}.term.state`)
  let startsAt: string | null = null
  let endsAt: string | null = null
  let perpetual: boolean | null = null
  if (termState === 'known') {
    startsAt = normalizeRightsTimestamp(term.startsAt, true, `${field}.term.startsAt`)
    if (typeof term.perpetual !== 'boolean') {
      throw new UpstreamContractError(`${field}.term.perpetual must be boolean when known`)
    }
    perpetual = term.perpetual
    endsAt = normalizeRightsTimestamp(term.endsAt, !perpetual, `${field}.term.endsAt`)
    if (perpetual && endsAt !== null) throw new UpstreamContractError(`${field}.term.endsAt must be null when perpetual`)
    if (!perpetual && startsAt !== null && endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw new UpstreamContractError(`${field}.term ends before it starts`)
    }
  } else if (term.startsAt !== null || term.endsAt !== null || term.perpetual !== null) {
    throw new UpstreamContractError(`${field}.term values must be null unless known`)
  }
  const contains = requireObject(object.contains, `${field}.contains`)
  requireExactKeys(contains, RIGHTS_CONTAINS_KEYS, `${field}.contains`)
  for (const key of RIGHTS_CONTAINS_KEYS) {
    if (!RIGHTS_CONTAINS_STATES.has(contains[key] as 'yes' | 'no' | 'unknown')) {
      throw new UpstreamContractError(`${field}.contains.${key} is invalid`)
    }
  }
  const providerTerms = requireObject(object.providerTerms, `${field}.providerTerms`)
  requireExactKeys(providerTerms, ['state', 'terms', 'reviewedAt'], `${field}.providerTerms`)
  const providerState = normalizeRightsState(providerTerms.state, `${field}.providerTerms.state`)
  const terms = normalizeRightsText(providerTerms.terms, providerState === 'known', `${field}.providerTerms.terms`)
  const reviewedAt = normalizeRightsTimestamp(
    providerTerms.reviewedAt,
    providerState === 'known',
    `${field}.providerTerms.reviewedAt`,
  )
  if (providerState !== 'known' && (terms !== null || reviewedAt !== null)) {
    throw new UpstreamContractError(`${field}.providerTerms values must be null unless known`)
  }
  const licenses = requireObject(object.modelLicenses, `${field}.modelLicenses`)
  requireExactKeys(licenses, ['code', 'weights', 'outputUse'], `${field}.modelLicenses`)
  const declaration = requireObject(object.humanDeclaration, `${field}.humanDeclaration`)
  requireExactKeys(declaration, ['state', 'text'], `${field}.humanDeclaration`)
  if (
    declaration.state !== 'provided'
    && declaration.state !== 'unknown'
    && declaration.state !== 'not_applicable'
  ) {
    throw new UpstreamContractError(`${field}.humanDeclaration.state is invalid`)
  }
  const declarationText = normalizeRightsText(
    declaration.text,
    declaration.state === 'provided',
    `${field}.humanDeclaration.text`,
  )
  if (declaration.state !== 'provided' && declarationText !== null) {
    throw new UpstreamContractError(`${field}.humanDeclaration.text must be null unless provided`)
  }
  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: normalizeRightsScalar(object.sourceType, `${field}.sourceType`),
    rightsHolder: normalizeRightsScalar(object.rightsHolder, `${field}.rightsHolder`),
    authorizationScope: normalizeRightsList(object.authorizationScope, `${field}.authorizationScope`),
    territory: normalizeRightsList(object.territory, `${field}.territory`),
    term: { state: termState, startsAt, endsAt, perpetual },
    restrictions: normalizeRightsList(object.restrictions, `${field}.restrictions`, true),
    contains: {
      realPersonLikeness: contains.realPersonLikeness as 'yes' | 'no' | 'unknown',
      trademark: contains.trademark as 'yes' | 'no' | 'unknown',
      music: contains.music as 'yes' | 'no' | 'unknown',
      font: contains.font as 'yes' | 'no' | 'unknown',
      thirdPartyCharacter: contains.thirdPartyCharacter as 'yes' | 'no' | 'unknown',
    },
    providerTerms: { state: providerState, terms, reviewedAt },
    modelLicenses: {
      code: normalizeRightsScalar(licenses.code, `${field}.modelLicenses.code`),
      weights: normalizeRightsScalar(licenses.weights, `${field}.modelLicenses.weights`),
      outputUse: normalizeRightsScalar(licenses.outputUse, `${field}.modelLicenses.outputUse`),
    },
    humanDeclaration: { state: declaration.state, text: declarationText },
    contentCredentials: normalizeRightsScalar(object.contentCredentials, `${field}.contentCredentials`),
  }
}

function normalizeElementProfileReference(
  value: unknown,
  index: number,
  elementKind: 'actor' | 'scene' | 'prop',
): YimengElementProfileReference {
  const field = `elementProfile.subject.references[${String(index)}]`
  const reference = requireObject(value, field)
  requireExactKeys(reference, [
    'assetId', 'sha256', 'selectionStatus', 'isSelected', 'rightsRecorded', 'rights',
    ...(elementKind === 'prop' ? [] : ['role']),
  ], field)
  return {
    assetId: requireString(reference.assetId, `${field}.assetId`),
    sha256: requireSha256(reference.sha256, `${field}.sha256`),
    selectionStatus: requireString(reference.selectionStatus, `${field}.selectionStatus`),
    isSelected: requireBoolean(reference.isSelected, `${field}.isSelected`),
    rightsRecorded: requireBoolean(reference.rightsRecorded, `${field}.rightsRecorded`),
    rights: normalizeReferenceRightsRecord(reference.rights, `${field}.rights`),
    ...(elementKind === 'prop' ? {} : { role: requireString(reference.role, `${field}.role`) }),
  }
}

function normalizeElementProfileSubject(value: unknown): YimengElementProfileSubject {
  const subject = requireObject(value, 'elementProfile.subject')
  if (subject.schema !== 'jason.qingmu-element-profile-subject.v2') {
    throw new UpstreamContractError('elementProfile.subject.schema mismatch')
  }
  if (subject.targetType !== 'element_profile') {
    throw new UpstreamContractError('elementProfile.subject.targetType mismatch')
  }
  if (subject.elementKind !== 'actor' && subject.elementKind !== 'scene' && subject.elementKind !== 'prop') {
    throw new UpstreamContractError('elementProfile.subject.elementKind mismatch')
  }
  if (!Array.isArray(subject.references)) {
    throw new UpstreamContractError('elementProfile.subject.references must be an array')
  }
  assertSafeJsonNumbers(subject, 'elementProfile.subject')
  const expectedSubjectKeys = [
    'schema', 'projectId', 'targetType', 'elementKind', 'profileRevision', 'name',
    'officialReferenceImageUrl', 'references',
    ...(subject.elementKind === 'actor'
      ? ['actorId', 'visualIdentity']
      : subject.elementKind === 'scene'
        ? ['sceneId', 'sceneType', 'visualPrompt']
        : ['propId', 'visualPrompt']),
  ]
  requireExactKeys(subject, expectedSubjectKeys, 'elementProfile.subject')
  const common = {
    schema: 'jason.qingmu-element-profile-subject.v2' as const,
    projectId: requireString(subject.projectId, 'elementProfile.subject.projectId'),
    targetType: 'element_profile' as const,
    profileRevision: requireInteger(subject.profileRevision, 'elementProfile.subject.profileRevision', 0),
    name: requireString(subject.name, 'elementProfile.subject.name'),
    officialReferenceImageUrl: requireNullableString(
      subject.officialReferenceImageUrl,
      'elementProfile.subject.officialReferenceImageUrl',
    ),
    references: subject.references.map((reference, index) => (
      normalizeElementProfileReference(reference, index, subject.elementKind as 'actor' | 'scene' | 'prop')
    )),
  }
  if (subject.elementKind === 'actor') {
    return {
      ...common,
      elementKind: 'actor',
      actorId: requireString(subject.actorId, 'elementProfile.subject.actorId'),
      visualIdentity: requireString(subject.visualIdentity, 'elementProfile.subject.visualIdentity'),
    }
  }
  if (subject.elementKind === 'scene') {
    return {
      ...common,
      elementKind: 'scene',
      sceneId: requireString(subject.sceneId, 'elementProfile.subject.sceneId'),
      sceneType: requireString(subject.sceneType, 'elementProfile.subject.sceneType'),
      visualPrompt: requireString(subject.visualPrompt, 'elementProfile.subject.visualPrompt'),
    }
  }
  return {
    ...common,
    elementKind: 'prop',
    propId: requireString(subject.propId, 'elementProfile.subject.propId'),
    visualPrompt: requireString(subject.visualPrompt, 'elementProfile.subject.visualPrompt'),
  }
}

function elementProfileSubjectId(subject: YimengElementProfileSubject): string {
  if (subject.elementKind === 'actor') return subject.actorId
  if (subject.elementKind === 'scene') return subject.sceneId
  return subject.propId
}

function normalizeElementProfile(
  value: unknown,
  expected: YimengElementProfileRequest,
): YimengElementProfileResponse {
  const root = requireObject(value, 'elementProfile')
  if (root.schema !== 'jason.qingmu-element-profile-subject-read.v2') {
    throw new UpstreamContractError('elementProfile.schema mismatch')
  }
  const subject = normalizeElementProfileSubject(root.subject)
  if (
    subject.projectId !== expected.projectId
    || subject.elementKind !== expected.elementKind
    || elementProfileSubjectId(subject) !== expected.targetId
  ) {
    throw new UpstreamContractError('elementProfile subject mismatch')
  }
  const canonicalSnapshot = requireString(root.canonicalSnapshot, 'elementProfile.canonicalSnapshot')
  const snapshotSha256 = requireSha256(root.snapshotSha256, 'elementProfile.snapshotSha256')
  const actualSha256 = createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex')
  if (actualSha256 !== snapshotSha256) {
    throw new UpstreamContractError('elementProfile canonical snapshot sha256 mismatch')
  }
  let canonicalSubject: unknown
  try {
    canonicalSubject = JSON.parse(canonicalSnapshot) as unknown
  } catch {
    throw new UpstreamContractError('elementProfile.canonicalSnapshot must be valid JSON')
  }
  assertSafeJsonNumbers(canonicalSubject, 'elementProfile.canonicalSnapshot')
  if (!isJsonObject(canonicalSubject) || !isDeepStrictEqual(canonicalSubject, subject)) {
    throw new UpstreamContractError('elementProfile canonical snapshot content mismatch')
  }
  requireExactKeys(root, ['schema', 'subject', 'canonicalSnapshot', 'snapshotSha256'], 'elementProfile')
  return {
    schema: 'jason.qingmu-element-profile-subject-read.v2',
    subject,
    snapshotSha256,
  }
}

function requireReferenceSelectionStatus(
  value: unknown,
  field: string,
): YimengReferenceCandidateSelectionStatus {
  const status = requireString(value, field)
  if (!REFERENCE_SELECTION_STATUSES.has(status as YimengReferenceCandidateSelectionStatus)) {
    throw new UpstreamContractError(`${field} must be Unselected, Selected, Rejected, or Stale`)
  }
  return status as YimengReferenceCandidateSelectionStatus
}

function requireReferenceQualityStatus(
  value: unknown,
  field: string,
): YimengReferenceCandidateQualityStatus {
  const status = requireString(value, field)
  if (!REFERENCE_QUALITY_STATUSES.has(status as YimengReferenceCandidateQualityStatus)) {
    throw new UpstreamContractError(`${field} must be pending, passed, or failed`)
  }
  return status as YimengReferenceCandidateQualityStatus
}

function requireReferenceDecisionKind(
  value: unknown,
  field: string,
): YimengReferenceCandidateDecisionKind {
  const kind = requireString(value, field)
  if (!REFERENCE_DECISION_KINDS.has(kind as YimengReferenceCandidateDecisionKind)) {
    throw new UpstreamContractError(`${field} must be none, referenceSelection, or humanReview`)
  }
  return kind as YimengReferenceCandidateDecisionKind
}

function normalizeReferenceCandidate(
  value: unknown,
  index: number,
  expected: YimengElementProfileRequest,
): YimengReferenceAssetCandidate {
  const field = `referenceCandidates.candidates[${String(index)}]`
  const candidate = requireObject(value, field)
  const projectId = requireIdentifier(candidate.projectId, `${field}.projectId`)
  const ownerType = requireString(candidate.ownerType, `${field}.ownerType`)
  const ownerId = requireIdentifier(candidate.ownerId, `${field}.ownerId`)
  if (projectId !== expected.projectId || ownerType !== expected.elementKind || ownerId !== expected.targetId) {
    throw new UpstreamContractError(`${field} project or element subject mismatch`)
  }
  const materializedSha256 = requireOptionalSha256(candidate.materializedSha256, `${field}.materializedSha256`)
  const decisionKind = requireReferenceDecisionKind(candidate.decisionKind, `${field}.decisionKind`)
  const decisionIdentity = requireIdentifier(candidate.decisionIdentity, `${field}.decisionIdentity`, true)
  if ((decisionKind === 'none') !== (decisionIdentity === '')) {
    throw new UpstreamContractError(`${field}.decisionIdentity does not match decisionKind`)
  }
  return {
    assetId: requireIdentifier(candidate.assetId, `${field}.assetId`),
    sha256: requireSha256(candidate.sha256, `${field}.sha256`),
    materializedSha256,
    bindingValid: requireBoolean(candidate.bindingValid, `${field}.bindingValid`),
    projectId,
    sourceEpisodeId: requireIdentifier(candidate.sourceEpisodeId, `${field}.sourceEpisodeId`, true),
    ownerType: expected.elementKind,
    ownerId,
    role: requireString(candidate.role, `${field}.role`),
    localPath: requireString(candidate.localPath, `${field}.localPath`),
    qualityStatus: requireReferenceQualityStatus(candidate.qualityStatus, `${field}.qualityStatus`),
    selectionStatus: requireReferenceSelectionStatus(candidate.selectionStatus, `${field}.selectionStatus`),
    isSelected: requireBoolean(candidate.isSelected, `${field}.isSelected`),
    generationJobId: requireIdentifier(candidate.generationJobId, `${field}.generationJobId`, true),
    sourceRevisionId: requireIdentifier(candidate.sourceRevisionId, `${field}.sourceRevisionId`, true),
    formalConsistencyCheckId: requireIdentifier(
      candidate.formalConsistencyCheckId,
      `${field}.formalConsistencyCheckId`,
      true,
    ),
    formalConsistencyPassed: requireBoolean(
      candidate.formalConsistencyPassed,
      `${field}.formalConsistencyPassed`,
    ),
    qualityProjectionSha256: requireSha256(
      candidate.qualityProjectionSha256,
      `${field}.qualityProjectionSha256`,
    ),
    decisionKind,
    decisionIdentity,
  }
}

function normalizeReferenceCandidates(
  value: unknown,
  expected: YimengElementProfileRequest,
): YimengReferenceCandidatesResponse {
  const root = requireObject(value, 'referenceCandidates')
  if (root.schema !== REFERENCE_CANDIDATES_SCHEMA) {
    throw new UpstreamContractError('referenceCandidates.schema mismatch')
  }
  if (root.targetType !== 'element_profile') {
    throw new UpstreamContractError('referenceCandidates.targetType mismatch')
  }
  const projectId = requireIdentifier(root.projectId, 'referenceCandidates.projectId')
  const targetId = requireIdentifier(root.targetId, 'referenceCandidates.targetId')
  const elementKind = requireString(root.elementKind, 'referenceCandidates.elementKind')
  if (
    projectId !== expected.projectId
    || targetId !== expected.targetId
    || elementKind !== expected.elementKind
  ) {
    throw new UpstreamContractError('referenceCandidates project or element subject mismatch')
  }
  if (!Array.isArray(root.candidates)) {
    throw new UpstreamContractError('referenceCandidates.candidates must be an array')
  }
  const humanApprovalInferred = requireBoolean(
    root.humanApprovalInferred,
    'referenceCandidates.humanApprovalInferred',
  )
  if (humanApprovalInferred) {
    throw new UpstreamContractError('referenceCandidates.humanApprovalInferred must be false')
  }
  return {
    schema: REFERENCE_CANDIDATES_SCHEMA,
    projectId,
    targetType: 'element_profile',
    targetId,
    elementKind: expected.elementKind,
    profileRevision: requireInteger(root.profileRevision, 'referenceCandidates.profileRevision', 0),
    elementSnapshotSha256: requireSha256(
      root.elementSnapshotSha256,
      'referenceCandidates.elementSnapshotSha256',
    ),
    candidates: root.candidates.map((candidate, index) => normalizeReferenceCandidate(candidate, index, expected)),
    humanApprovalInferred: false,
  }
}

function normalizeElementReviewSubject(value: unknown): YimengElementReviewSubject {
  const subject = requireObject(value, 'reviewEvents.subject')
  if (subject.type !== 'element_profile') {
    throw new UpstreamContractError('reviewEvents.subject.type must be element_profile')
  }
  return {
    type: 'element_profile',
    id: requireIdentifier(subject.id, 'reviewEvents.subject.id'),
    revision: requireInteger(subject.revision, 'reviewEvents.subject.revision', 0),
    sha256: requireSha256(subject.sha256, 'reviewEvents.subject.sha256'),
  }
}

function normalizeElementReviewComment(
  value: unknown,
  index: number,
  subject: YimengElementReviewSubject,
): YimengElementReviewComment {
  const field = `reviewEvents.comments[${String(index)}]`
  const comment = requireObject(value, field)
  if (comment.subjectType !== 'element_profile') {
    throw new UpstreamContractError(`${field}.subjectType must be element_profile`)
  }
  const body = requireString(comment.body, `${field}.body`)
  if (body.trim().length === 0 || body.length > 8_000) {
    throw new UpstreamContractError(`${field}.body must be between 1 and 8000 characters`)
  }
  const subjectId = requireIdentifier(comment.subjectId, `${field}.subjectId`)
  if (subjectId !== subject.id) {
    throw new UpstreamContractError(`${field}.subjectId must match the feed subject`)
  }
  const actorRole = requireIdentifier(comment.actorRole, `${field}.actorRole`)
  if (actorRole !== 'commenter') {
    throw new UpstreamContractError(`${field}.actorRole must be commenter`)
  }
  return {
    id: requireIdentifier(comment.id, `${field}.id`),
    subjectType: 'element_profile',
    subjectId,
    subjectRevision: requireInteger(comment.subjectRevision, `${field}.subjectRevision`, 0),
    subjectSha256: requireSha256(comment.subjectSha256, `${field}.subjectSha256`),
    body,
    actorId: requireIdentifier(comment.actorId, `${field}.actorId`),
    actorRole,
    authSessionId: requireIdentifier(comment.authSessionId, `${field}.authSessionId`),
    createdAt: requireIdentifier(comment.createdAt, `${field}.createdAt`),
  }
}

function requireHumanDecisionValue(value: unknown, field: string): YimengHumanDecisionValue {
  const decision = requireString(value, field)
  if (!HUMAN_DECISION_VALUES.has(decision as YimengHumanDecisionValue)) {
    throw new UpstreamContractError(`${field} must be approve, reject, or request_changes`)
  }
  return decision as YimengHumanDecisionValue
}

function normalizeHumanDecision(
  value: unknown,
  field: string,
  subject: YimengElementReviewSubject,
): YimengHumanDecision {
  const decision = requireObject(value, field)
  if (decision.subjectType !== 'element_profile') {
    throw new UpstreamContractError(`${field}.subjectType must be element_profile`)
  }
  const subjectId = requireIdentifier(decision.subjectId, `${field}.subjectId`)
  const subjectRevision = requireInteger(decision.subjectRevision, `${field}.subjectRevision`, 0)
  const subjectSha256 = requireSha256(decision.subjectSha256, `${field}.subjectSha256`)
  const reason = requireString(decision.reason, `${field}.reason`)
  if (reason.trim().length === 0 || reason.length > 8_000) {
    throw new UpstreamContractError(`${field}.reason must be between 1 and 8000 characters`)
  }
  const actorRole = requireIdentifier(decision.actorRole, `${field}.actorRole`)
  if (actorRole !== 'approver') {
    throw new UpstreamContractError(`${field}.actorRole must be approver`)
  }
  return {
    id: requireIdentifier(decision.id, `${field}.id`),
    subjectType: 'element_profile',
    subjectId,
    subjectRevision,
    subjectSha256,
    decision: requireHumanDecisionValue(decision.decision, `${field}.decision`),
    reason,
    actorId: requireIdentifier(decision.actorId, `${field}.actorId`),
    actorRole,
    authSessionId: requireIdentifier(decision.authSessionId, `${field}.authSessionId`),
    decidedAt: requireIdentifier(decision.decidedAt, `${field}.decidedAt`),
    stale: subjectId !== subject.id
      || subjectRevision !== subject.revision
      || subjectSha256 !== subject.sha256,
  }
}

function normalizeElementReviewFeed(
  value: unknown,
  expected: YimengElementProfileRequest,
): YimengElementReviewFeedResponse {
  const root = requireObject(value, 'reviewEvents')
  if (root.schema !== ELEMENT_REVIEW_FEED_SCHEMA) {
    throw new UpstreamContractError('reviewEvents.schema mismatch')
  }
  const projectId = requireIdentifier(root.projectId, 'reviewEvents.projectId')
  const targetId = requireIdentifier(root.targetId, 'reviewEvents.targetId')
  const elementKind = requireString(root.elementKind, 'reviewEvents.elementKind')
  const subject = normalizeElementReviewSubject(root.subject)
  if (
    projectId !== expected.projectId
    || targetId !== expected.targetId
    || elementKind !== expected.elementKind
    || subject.id !== expected.targetId
  ) {
    throw new UpstreamContractError('reviewEvents project or element subject mismatch')
  }
  const capabilities = requireObject(root.capabilities, 'reviewEvents.capabilities')
  if (!Array.isArray(root.comments)) {
    throw new UpstreamContractError('reviewEvents.comments must be an array')
  }
  if (!Array.isArray(root.decisions)) {
    throw new UpstreamContractError('reviewEvents.decisions must be an array')
  }
  const comments = root.comments.map((comment, index) => normalizeElementReviewComment(comment, index, subject))
  const decisions = root.decisions.map((decision, index) => (
    normalizeHumanDecision(decision, `reviewEvents.decisions[${String(index)}]`, subject)
  ))
  let currentDecision: YimengHumanDecision | null = null
  if (root.currentDecision !== null) {
    currentDecision = normalizeHumanDecision(root.currentDecision, 'reviewEvents.currentDecision', subject)
    if (currentDecision.stale) {
      throw new UpstreamContractError('reviewEvents.currentDecision must bind the current subject')
    }
    const listedDecision = decisions.find(decision => decision.id === currentDecision?.id)
    if (listedDecision === undefined || !isDeepStrictEqual(listedDecision, currentDecision)) {
      throw new UpstreamContractError('reviewEvents.currentDecision must match a listed decision')
    }
  }
  return {
    schema: ELEMENT_REVIEW_FEED_SCHEMA,
    projectId,
    elementKind: expected.elementKind,
    targetId,
    subject,
    capabilities: {
      canComment: requireBoolean(capabilities.canComment, 'reviewEvents.capabilities.canComment'),
      canDecide: requireBoolean(capabilities.canDecide, 'reviewEvents.capabilities.canDecide'),
    },
    comments,
    decisions,
    currentDecision,
  }
}

function normalizeReferenceRightsExceptionScope(
  value: unknown,
  field: string,
): YimengReferenceRightsExceptionScope {
  const scope = requireObject(value, field)
  assertExactOutputKeys(scope, [
    'kind', 'referenceAssetId', 'referenceAssetSha256', 'rightsRecordSha256', 'rightsFields',
  ], field)
  if (scope.kind !== 'reference_rights') {
    throw new UpstreamContractError(`${field}.kind must be reference_rights`)
  }
  if (!Array.isArray(scope.rightsFields) || scope.rightsFields.length === 0) {
    throw new UpstreamContractError(`${field}.rightsFields must be a non-empty array`)
  }
  const rightsFields = scope.rightsFields.map((item, index) => {
    const rightsField = requireString(item, `${field}.rightsFields[${String(index)}]`)
    if (!RIGHTS_EXCEPTION_FIELD_SET.has(rightsField as YimengReferenceRightsExceptionField)) {
      throw new UpstreamContractError(`${field}.rightsFields contains an unknown field`)
    }
    return rightsField as YimengReferenceRightsExceptionField
  })
  if (new Set(rightsFields).size !== rightsFields.length) {
    throw new UpstreamContractError(`${field}.rightsFields must not contain duplicates`)
  }
  const canonical = RIGHTS_EXCEPTION_FIELDS.filter(item => rightsFields.includes(item))
  if (!isDeepStrictEqual(rightsFields, canonical)) {
    throw new UpstreamContractError(`${field}.rightsFields must use canonical order`)
  }
  return {
    kind: 'reference_rights',
    referenceAssetId: requireIdentifier(scope.referenceAssetId, `${field}.referenceAssetId`),
    referenceAssetSha256: requireSha256(scope.referenceAssetSha256, `${field}.referenceAssetSha256`),
    rightsRecordSha256: requireSha256(scope.rightsRecordSha256, `${field}.rightsRecordSha256`),
    rightsFields,
  }
}

function normalizeReferenceRightsExceptionRelease(
  value: unknown,
  field: string,
  subject: YimengElementReviewSubject,
): YimengReferenceRightsExceptionRelease {
  const release = requireObject(value, field)
  assertExactOutputKeys(release, [
    'id',
    'decision',
    'subjectType',
    'subjectId',
    'subjectRevision',
    'subjectSha256',
    'scope',
    'actorId',
    'actorRole',
    'actorNaturalPersonId',
    'producerActorId',
    'producerNaturalPersonId',
    'assetProducerActorId',
    'assetProducerNaturalPersonId',
    'assetProducerTaskId',
    'assetProducerTaskRequestSha256',
    'authSessionId',
    'reason',
    'releasedAt',
    'stale',
    'staleReasonCodes',
  ], field)
  if (release.decision !== 'exception_release') {
    throw new UpstreamContractError(`${field}.decision must be exception_release`)
  }
  if (release.subjectType !== 'element_profile') {
    throw new UpstreamContractError(`${field}.subjectType must be element_profile`)
  }
  if (release.actorRole !== 'approver') {
    throw new UpstreamContractError(`${field}.actorRole must be approver`)
  }
  const subjectId = requireIdentifier(release.subjectId, `${field}.subjectId`)
  if (subjectId !== subject.id) throw new UpstreamContractError(`${field}.subjectId must match the feed subject`)
  const subjectRevision = requireInteger(release.subjectRevision, `${field}.subjectRevision`, 0)
  const subjectSha256 = requireSha256(release.subjectSha256, `${field}.subjectSha256`)
  const actorNaturalPersonId = requireIdentifier(
    release.actorNaturalPersonId,
    `${field}.actorNaturalPersonId`,
  )
  const producerNaturalPersonId = requireIdentifier(
    release.producerNaturalPersonId,
    `${field}.producerNaturalPersonId`,
  )
  const assetProducerNaturalPersonId = requireIdentifier(
    release.assetProducerNaturalPersonId,
    `${field}.assetProducerNaturalPersonId`,
  )
  if (
    actorNaturalPersonId === producerNaturalPersonId
    || actorNaturalPersonId === assetProducerNaturalPersonId
  ) throw new UpstreamContractError(`${field} approver must differ from producers`)
  const reason = requireString(release.reason, `${field}.reason`)
  if (reason.trim().length === 0 || reason.length > 8_000) {
    throw new UpstreamContractError(`${field}.reason must be between 1 and 8000 characters`)
  }
  const stale = requireBoolean(release.stale, `${field}.stale`)
  if (!Array.isArray(release.staleReasonCodes)) {
    throw new UpstreamContractError(`${field}.staleReasonCodes must be an array`)
  }
  const staleReasonCodes = release.staleReasonCodes.map((code, index) => (
    requireIdentifier(code, `${field}.staleReasonCodes[${String(index)}]`, false)
  ))
  if (staleReasonCodes.some(code => !RIGHTS_EXCEPTION_STALE_REASON_CODE_SET.has(code))) {
    throw new UpstreamContractError(`${field}.staleReasonCodes contains an unknown code`)
  }
  if (new Set(staleReasonCodes).size !== staleReasonCodes.length) {
    throw new UpstreamContractError(`${field}.staleReasonCodes must not contain duplicates`)
  }
  const canonicalStaleReasonCodes = RIGHTS_EXCEPTION_STALE_REASON_CODES.filter(code => staleReasonCodes.includes(code))
  if (!isDeepStrictEqual(staleReasonCodes, canonicalStaleReasonCodes)) {
    throw new UpstreamContractError(`${field}.staleReasonCodes must use canonical order`)
  }
  if (stale !== (staleReasonCodes.length > 0)) {
    throw new UpstreamContractError(`${field}.stale must match staleReasonCodes`)
  }
  if (!stale && (subjectRevision !== subject.revision || subjectSha256 !== subject.sha256)) {
    throw new UpstreamContractError(`${field} current subject lineage mismatch`)
  }
  return {
    id: requireIdentifier(release.id, `${field}.id`),
    decision: 'exception_release',
    subjectType: 'element_profile',
    subjectId,
    subjectRevision,
    subjectSha256,
    scope: normalizeReferenceRightsExceptionScope(release.scope, `${field}.scope`),
    actorId: requireIdentifier(release.actorId, `${field}.actorId`),
    actorRole: 'approver',
    actorNaturalPersonId,
    producerActorId: requireIdentifier(release.producerActorId, `${field}.producerActorId`),
    producerNaturalPersonId,
    assetProducerActorId: requireIdentifier(release.assetProducerActorId, `${field}.assetProducerActorId`),
    assetProducerNaturalPersonId,
    assetProducerTaskId: requireIdentifier(release.assetProducerTaskId, `${field}.assetProducerTaskId`),
    assetProducerTaskRequestSha256: requireSha256(
      release.assetProducerTaskRequestSha256,
      `${field}.assetProducerTaskRequestSha256`,
    ),
    authSessionId: requireIdentifier(release.authSessionId, `${field}.authSessionId`),
    reason,
    releasedAt: requireRfc3339Timestamp(release.releasedAt, `${field}.releasedAt`),
    stale,
    staleReasonCodes,
  }
}

function normalizeReferenceRightsExceptionReleaseFeed(
  value: unknown,
  expected: YimengElementProfileRequest,
): YimengReferenceRightsExceptionReleaseFeedResponse {
  const root = requireObject(value, 'referenceRightsExceptionReleases')
  assertExactOutputKeys(root, [
    'schema', 'projectId', 'elementKind', 'targetId', 'subject', 'capabilities', 'releases', 'currentReleases',
  ], 'referenceRightsExceptionReleases')
  if (root.schema !== REFERENCE_RIGHTS_EXCEPTION_RELEASE_FEED_SCHEMA) {
    throw new UpstreamContractError('referenceRightsExceptionReleases.schema mismatch')
  }
  const projectId = requireIdentifier(root.projectId, 'referenceRightsExceptionReleases.projectId')
  const elementKind = requireString(root.elementKind, 'referenceRightsExceptionReleases.elementKind')
  const targetId = requireIdentifier(root.targetId, 'referenceRightsExceptionReleases.targetId')
  const subjectValue = requireObject(root.subject, 'referenceRightsExceptionReleases.subject')
  assertExactOutputKeys(subjectValue, ['type', 'id', 'revision', 'sha256'], 'referenceRightsExceptionReleases.subject')
  if (subjectValue.type !== 'element_profile') {
    throw new UpstreamContractError('referenceRightsExceptionReleases.subject.type must be element_profile')
  }
  const subject: YimengElementReviewSubject = {
    type: 'element_profile',
    id: requireIdentifier(subjectValue.id, 'referenceRightsExceptionReleases.subject.id'),
    revision: requireInteger(subjectValue.revision, 'referenceRightsExceptionReleases.subject.revision', 0),
    sha256: requireSha256(subjectValue.sha256, 'referenceRightsExceptionReleases.subject.sha256'),
  }
  if (
    projectId !== expected.projectId
    || elementKind !== expected.elementKind
    || targetId !== expected.targetId
    || subject.id !== expected.targetId
  ) throw new UpstreamContractError('referenceRightsExceptionReleases project or element subject mismatch')
  const capabilitiesValue = requireObject(
    root.capabilities,
    'referenceRightsExceptionReleases.capabilities',
  )
  assertExactOutputKeys(capabilitiesValue, [
    'canRelease', 'blockedReasonCode', 'blockedReason', 'requiresRecentAuthentication',
  ], 'referenceRightsExceptionReleases.capabilities')
  const canRelease = requireBoolean(
    capabilitiesValue.canRelease,
    'referenceRightsExceptionReleases.capabilities.canRelease',
  )
  const blockedReasonCode = requireNullableString(
    capabilitiesValue.blockedReasonCode,
    'referenceRightsExceptionReleases.capabilities.blockedReasonCode',
  )
  const blockedReason = requireNullableString(
    capabilitiesValue.blockedReason,
    'referenceRightsExceptionReleases.capabilities.blockedReason',
  )
  if (capabilitiesValue.requiresRecentAuthentication !== true) {
    throw new UpstreamContractError(
      'referenceRightsExceptionReleases.capabilities.requiresRecentAuthentication must be true',
    )
  }
  if (
    canRelease !== (blockedReasonCode === null && blockedReason === null)
    || (blockedReasonCode === null) !== (blockedReason === null)
    || blockedReasonCode === ''
    || blockedReason === ''
  ) throw new UpstreamContractError('referenceRightsExceptionReleases capability reason mismatch')
  if (!Array.isArray(root.releases) || !Array.isArray(root.currentReleases)) {
    throw new UpstreamContractError('referenceRightsExceptionReleases release collections must be arrays')
  }
  const releases = root.releases.map((release, index) => normalizeReferenceRightsExceptionRelease(
    release,
    `referenceRightsExceptionReleases.releases[${String(index)}]`,
    subject,
  ))
  const currentReleases = root.currentReleases.map((release, index) => normalizeReferenceRightsExceptionRelease(
    release,
    `referenceRightsExceptionReleases.currentReleases[${String(index)}]`,
    subject,
  ))
  if (new Set(releases.map(release => release.id)).size !== releases.length) {
    throw new UpstreamContractError('referenceRightsExceptionReleases.releases IDs must be unique')
  }
  if (new Set(currentReleases.map(release => release.id)).size !== currentReleases.length) {
    throw new UpstreamContractError('referenceRightsExceptionReleases.currentReleases IDs must be unique')
  }
  const projectedCurrentReleases = releases.filter(release => !release.stale)
  if (
    currentReleases.length !== projectedCurrentReleases.length
    || currentReleases.some((current, index) => (
      current.stale || !isDeepStrictEqual(current, projectedCurrentReleases[index])
    ))
  ) {
    throw new UpstreamContractError(
      'referenceRightsExceptionReleases.currentReleases must exactly project all non-stale releases',
    )
  }
  return {
    schema: REFERENCE_RIGHTS_EXCEPTION_RELEASE_FEED_SCHEMA,
    projectId,
    elementKind: expected.elementKind,
    targetId,
    subject,
    capabilities: {
      canRelease,
      blockedReasonCode,
      blockedReason,
      requiresRecentAuthentication: true,
    },
    releases,
    currentReleases,
  }
}

function normalizeWorkflowStage(value: unknown, field: string): YimengWorkflowStage {
  const stage = requireObject(value, field)
  return {
    ...stage,
    status: requireString(stage.status, `${field}.status`),
    hasData: requireBoolean(stage.hasData, `${field}.hasData`),
    isStale: requireBoolean(stage.isStale, `${field}.isStale`),
    qualityPassed: requireBoolean(stage.qualityPassed, `${field}.qualityPassed`),
    selected: requireBoolean(stage.selected, `${field}.selected`),
    canProceed: requireBoolean(stage.canProceed, `${field}.canProceed`),
  }
}

function normalizeWorkflowBlocker(value: unknown, index: number): YimengWorkflowBlocker {
  const blocker = requireObject(value, `workflow.blockers[${String(index)}]`)
  return { ...blocker, reason: requireString(blocker.reason, `workflow.blockers[${String(index)}].reason`) }
}

function requireOptionalIdentifier(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireIdentifier(value, field)
}

function normalizeShotRelationBlocker(value: unknown, index: number): YimengShotRelationBlocker {
  const field = `workflow.director.shotRelations.blockers[${String(index)}]`
  const blocker = requireObject(value, field)
  const elementKind = blocker.elementKind
  if (elementKind !== undefined && elementKind !== 'actor' && elementKind !== 'scene' && elementKind !== 'prop') {
    throw new UpstreamContractError(`${field}.elementKind is invalid`)
  }
  const sceneId = requireOptionalIdentifier(blocker.sceneId, `${field}.sceneId`)
  const shotId = requireOptionalIdentifier(blocker.shotId, `${field}.shotId`)
  const beatId = requireOptionalIdentifier(blocker.beatId, `${field}.beatId`)
  const elementId = requireOptionalIdentifier(blocker.elementId, `${field}.elementId`)
  return {
    ...blocker,
    scope: requireIdentifier(blocker.scope, `${field}.scope`),
    reason: requireIdentifier(blocker.reason, `${field}.reason`),
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(shotId === undefined ? {} : { shotId }),
    ...(beatId === undefined ? {} : { beatId }),
    ...(elementId === undefined ? {} : { elementId }),
    ...(elementKind === undefined ? {} : { elementKind }),
  }
}

function requireUniqueIdentifiers(values: unknown, field: string): string[] {
  if (!Array.isArray(values)) throw new UpstreamContractError(`${field} must be an array`)
  const identifiers = values.map((value, index) => requireIdentifier(value, `${field}[${String(index)}]`))
  if (new Set(identifiers).size !== identifiers.length) {
    throw new UpstreamContractError(`${field} must not contain duplicate identifiers`)
  }
  return identifiers
}

function isShotCurrentReferenceRole(
  elementKind: YimengShotRelationElementKind,
  role: string,
): boolean {
  return (SHOT_CURRENT_REFERENCE_ROLES[elementKind] as readonly string[]).includes(role)
}

function normalizeShotCurrentReference(
  value: unknown,
  field: string,
  projectId: string,
  elementKind: YimengShotRelationElementKind,
  elementId: string,
): YimengShotCurrentReference {
  const reference = requireObject(value, field)
  assertExactOutputKeys(reference, ['assetId', 'sha256', 'lineage'], field)
  const lineageField = `${field}.lineage`
  const lineage = requireObject(reference.lineage, lineageField)
  assertExactOutputKeys(
    lineage,
    [
      'projectId',
      'sourceEpisodeId',
      'ownerType',
      'ownerId',
      'role',
      'generationJobId',
      'sourceRevisionId',
      'formalConsistencyCheckId',
    ],
    lineageField,
  )
  const ownerType = lineage.ownerType
  if (ownerType !== 'actor' && ownerType !== 'scene' && ownerType !== 'prop') {
    throw new UpstreamContractError(`${lineageField}.ownerType is invalid`)
  }
  const normalizedLineage: YimengShotCurrentReferenceLineage = {
    projectId: requireIdentifier(lineage.projectId, `${lineageField}.projectId`),
    sourceEpisodeId: requireIdentifier(lineage.sourceEpisodeId, `${lineageField}.sourceEpisodeId`),
    ownerType,
    ownerId: requireIdentifier(lineage.ownerId, `${lineageField}.ownerId`),
    role: requireIdentifier(lineage.role, `${lineageField}.role`),
    generationJobId: requireIdentifier(lineage.generationJobId, `${lineageField}.generationJobId`),
    sourceRevisionId: requireIdentifier(lineage.sourceRevisionId, `${lineageField}.sourceRevisionId`),
    formalConsistencyCheckId: requireIdentifier(
      lineage.formalConsistencyCheckId,
      `${lineageField}.formalConsistencyCheckId`,
    ),
  }
  if (
    normalizedLineage.projectId !== projectId
    || normalizedLineage.ownerType !== elementKind
    || normalizedLineage.ownerId !== elementId
    || !isShotCurrentReferenceRole(elementKind, normalizedLineage.role)
  ) {
    throw new UpstreamContractError(`${lineageField} subject mismatch`)
  }
  return {
    assetId: requireIdentifier(reference.assetId, `${field}.assetId`),
    sha256: requireSha256(reference.sha256, `${field}.sha256`),
    lineage: normalizedLineage,
  }
}

function normalizeShotDialogueRhythm(
  value: unknown,
  field: string,
  durationSec: number,
): YimengShotDialogueRhythm {
  const rhythm = requireObject(value, field)
  assertExactOutputKeys(rhythm, ['cueCount', 'timedCueCount', 'cues'], field)
  if (!Array.isArray(rhythm.cues)) throw new UpstreamContractError(`${field}.cues must be an array`)
  const cues = rhythm.cues.map((value, index): YimengShotDialogueCue => {
    const cueField = `${field}.cues[${String(index)}]`
    const cue = requireObject(value, cueField)
    assertExactOutputKeys(
      cue,
      [
        'schemaVersion',
        'lineId',
        'speakerId',
        'verbatimText',
        'plannedStartSec',
        'plannedEndSec',
        'timingVerified',
        'legacy',
      ],
      cueField,
    )
    const verbatimText = requireString(cue.verbatimText, `${cueField}.verbatimText`)
    if (verbatimText.trim() === '' || verbatimText !== verbatimText.trim()) {
      throw new UpstreamContractError(`${cueField}.verbatimText must be non-empty and trimmed`)
    }
    if (cue.schemaVersion === 'dialogue-cue-v2') {
      const plannedStartSec = cue.plannedStartSec
      const plannedEndSec = cue.plannedEndSec
      if (
        typeof plannedStartSec !== 'number'
        || !Number.isFinite(plannedStartSec)
        || plannedStartSec < 0
        || typeof plannedEndSec !== 'number'
        || !Number.isFinite(plannedEndSec)
        || plannedEndSec <= plannedStartSec
        || plannedEndSec > durationSec + 1e-6
        || cue.timingVerified !== true
        || cue.legacy !== false
      ) {
        throw new UpstreamContractError(`${cueField} v2 timing contract mismatch`)
      }
      return {
        schemaVersion: 'dialogue-cue-v2',
        lineId: requireIdentifier(cue.lineId, `${cueField}.lineId`),
        speakerId: requireIdentifier(cue.speakerId, `${cueField}.speakerId`),
        verbatimText,
        plannedStartSec,
        plannedEndSec,
        timingVerified: true,
        legacy: false,
      }
    }
    if (
      cue.schemaVersion !== 'dialogue-cue-legacy-v1'
      || cue.lineId !== null
      || (cue.speakerId !== null && typeof cue.speakerId !== 'string')
      || cue.plannedStartSec !== null
      || cue.plannedEndSec !== null
      || cue.timingVerified !== false
      || cue.legacy !== true
    ) {
      throw new UpstreamContractError(`${cueField} legacy timing contract mismatch`)
    }
    return {
      schemaVersion: 'dialogue-cue-legacy-v1',
      lineId: null,
      speakerId: cue.speakerId === null
        ? null
        : requireIdentifier(cue.speakerId, `${cueField}.speakerId`),
      verbatimText,
      plannedStartSec: null,
      plannedEndSec: null,
      timingVerified: false,
      legacy: true,
    }
  })
  const cueCount = requireInteger(rhythm.cueCount, `${field}.cueCount`, 0)
  const timedCueCount = requireInteger(rhythm.timedCueCount, `${field}.timedCueCount`, 0)
  const v2LineIds = cues.flatMap(cue => cue.lineId === null ? [] : [cue.lineId])
  if (new Set(v2LineIds).size !== v2LineIds.length) {
    throw new UpstreamContractError(`${field} v2 lineId duplicate`)
  }
  if (
    cueCount !== cues.length
    || timedCueCount !== cues.filter(cue => cue.timingVerified).length
  ) {
    throw new UpstreamContractError(`${field} cue counts mismatch`)
  }
  return { cueCount, timedCueCount, cues }
}

function normalizeShotRelationElement(
  value: unknown,
  field: string,
  projectId: string,
): YimengShotRelationElement {
  const element = requireObject(value, field)
  assertExactOutputKeys(
    element,
    [
      'elementKind',
      'elementId',
      'name',
      'profileRevision',
      'snapshotSha256',
      'currentReferenceAvailability',
      'currentReference',
    ],
    field,
  )
  if (element.elementKind !== 'actor' && element.elementKind !== 'scene' && element.elementKind !== 'prop') {
    throw new UpstreamContractError(`${field}.elementKind is invalid`)
  }
  const elementId = requireIdentifier(element.elementId, `${field}.elementId`)
  const availability = element.currentReferenceAvailability
  if (availability !== 'missing' && availability !== 'available') {
    throw new UpstreamContractError(`${field}.currentReferenceAvailability is invalid`)
  }
  const currentReference = availability === 'missing'
    ? null
    : normalizeShotCurrentReference(
      element.currentReference,
      `${field}.currentReference`,
      projectId,
      element.elementKind,
      elementId,
    )
  if (availability === 'missing' && element.currentReference !== null) {
    throw new UpstreamContractError(`${field}.currentReference must be null when missing`)
  }
  return {
    elementKind: element.elementKind,
    elementId,
    name: requireString(element.name, `${field}.name`),
    profileRevision: requireInteger(element.profileRevision, `${field}.profileRevision`, 0),
    snapshotSha256: requireSha256(element.snapshotSha256, `${field}.snapshotSha256`),
    currentReferenceAvailability: availability,
    currentReference,
  }
}

function normalizeShotRelationBeat(value: unknown, field: string): YimengShotRelationBeat {
  const beat = requireObject(value, field)
  assertExactOutputKeys(
    beat,
    ['beatId', 'order', 'type', 'startSec', 'endSec', 'actorIds', 'propIds', 'visualResponsibility'],
    field,
  )
  if (typeof beat.startSec !== 'number' || !Number.isFinite(beat.startSec) || beat.startSec < 0) {
    throw new UpstreamContractError(`${field}.startSec must be a non-negative finite number`)
  }
  if (typeof beat.endSec !== 'number' || !Number.isFinite(beat.endSec) || beat.endSec < beat.startSec) {
    throw new UpstreamContractError(`${field}.endSec must be finite and not precede startSec`)
  }
  return {
    beatId: requireIdentifier(beat.beatId, `${field}.beatId`),
    order: requireInteger(beat.order, `${field}.order`, 0),
    type: requireIdentifier(beat.type, `${field}.type`),
    startSec: beat.startSec,
    endSec: beat.endSec,
    actorIds: requireUniqueIdentifiers(beat.actorIds, `${field}.actorIds`),
    propIds: requireUniqueIdentifiers(beat.propIds, `${field}.propIds`),
    visualResponsibility: requireIdentifier(beat.visualResponsibility, `${field}.visualResponsibility`),
  }
}

function normalizeShotRelations(
  value: unknown,
  expectedProjectId: string,
  expectedEpisodeId: string,
): YimengShotRelationsProjection {
  const field = 'workflow.director.shotRelations'
  const root = requireObject(value, field)
  assertExactOutputKeys(
    root,
    ['schema', 'projectId', 'episodeId', 'storyboardRevision', 'scenes', 'shots', 'valid', 'blockers'],
    field,
  )
  if (root.schema !== SHOT_RELATIONS_SCHEMA) throw new UpstreamContractError(`${field}.schema mismatch`)
  const projectId = requireIdentifier(root.projectId, `${field}.projectId`)
  const episodeId = requireIdentifier(root.episodeId, `${field}.episodeId`)
  if (projectId !== expectedProjectId || episodeId !== expectedEpisodeId) {
    throw new UpstreamContractError(`${field} project or episode subject mismatch`)
  }
  if (!Array.isArray(root.blockers)) throw new UpstreamContractError(`${field}.blockers must be an array`)
  const blockers = root.blockers.map(normalizeShotRelationBlocker)
  if (root.valid !== true || blockers.length !== 0) {
    throw new UpstreamContractError(`${field} is invalid: ${blockers[0]?.reason ?? 'unknown relation blocker'}`)
  }

  const revision = requireObject(root.storyboardRevision, `${field}.storyboardRevision`)
  assertExactOutputKeys(
    revision,
    ['episodeRevision', 'revisionId', 'revisionVersion', 'sourceSha256'],
    `${field}.storyboardRevision`,
  )
  const storyboardRevision = {
    episodeRevision: requireInteger(revision.episodeRevision, `${field}.storyboardRevision.episodeRevision`, 0),
    revisionId: requireIdentifier(revision.revisionId, `${field}.storyboardRevision.revisionId`),
    revisionVersion: requireInteger(revision.revisionVersion, `${field}.storyboardRevision.revisionVersion`, 1),
    sourceSha256: requireSha256(revision.sourceSha256, `${field}.storyboardRevision.sourceSha256`),
  }

  const sceneRows = requireObjectItems(root.scenes, `${field}.scenes`)
  const scenes = sceneRows.map((scene, index): YimengShotRelationScene => {
    const sceneField = `${field}.scenes[${String(index)}]`
    assertExactOutputKeys(scene, ['sceneId', 'name', 'profileRevision', 'snapshotSha256'], sceneField)
    return {
      sceneId: requireIdentifier(scene.sceneId, `${sceneField}.sceneId`),
      name: requireString(scene.name, `${sceneField}.name`),
      profileRevision: requireInteger(scene.profileRevision, `${sceneField}.profileRevision`, 0),
      snapshotSha256: requireSha256(scene.snapshotSha256, `${sceneField}.snapshotSha256`),
    }
  })
  const sceneIds = new Set(scenes.map(scene => scene.sceneId))
  if (sceneIds.size !== scenes.length) throw new UpstreamContractError(`${field}.scenes contains duplicate sceneId`)

  const shotRows = requireObjectItems(root.shots, `${field}.shots`)
  const shots = shotRows.map((shot, shotIndex): YimengShotRelationShot => {
    const shotField = `${field}.shots[${String(shotIndex)}]`
    assertExactOutputKeys(
      shot,
      ['shotId', 'frameNo', 'sceneId', 'title', 'durationSec', 'dialogueRhythm', 'beats', 'elements'],
      shotField,
    )
    const shotId = requireIdentifier(shot.shotId, `${shotField}.shotId`)
    const frameNo = requireInteger(shot.frameNo, `${shotField}.frameNo`, 1)
    const sceneId = requireIdentifier(shot.sceneId, `${shotField}.sceneId`)
    if (!sceneIds.has(sceneId)) throw new UpstreamContractError(`${shotField}.sceneId is dangling`)
    if (shot.title !== null && typeof shot.title !== 'string') {
      throw new UpstreamContractError(`${shotField}.title must be a string or null`)
    }
    if (typeof shot.title === 'string' && (shot.title.trim() === '' || shot.title !== shot.title.trim())) {
      throw new UpstreamContractError(`${shotField}.title must be non-empty and trimmed`)
    }
    if (typeof shot.durationSec !== 'number' || !Number.isFinite(shot.durationSec) || shot.durationSec <= 0) {
      throw new UpstreamContractError(`${shotField}.durationSec must be a positive finite number`)
    }
    const durationSec = shot.durationSec
    const dialogueRhythm = normalizeShotDialogueRhythm(
      shot.dialogueRhythm,
      `${shotField}.dialogueRhythm`,
      durationSec,
    )
    const elements = requireObjectItems(shot.elements, `${shotField}.elements`)
      .map((element, index) => normalizeShotRelationElement(
        element,
        `${shotField}.elements[${String(index)}]`,
        projectId,
      ))
    const elementKeys = elements.map(element => `${element.elementKind}:${element.elementId}`)
    if (new Set(elementKeys).size !== elementKeys.length) {
      throw new UpstreamContractError(`${shotField}.elements contains duplicate authority bindings`)
    }
    if (!elements.some(element => element.elementKind === 'scene' && element.elementId === sceneId)) {
      throw new UpstreamContractError(`${shotField}.elements does not bind its canonical scene`)
    }
    const actorIds = new Set(elements.filter(element => element.elementKind === 'actor').map(element => element.elementId))
    const propIds = new Set(elements.filter(element => element.elementKind === 'prop').map(element => element.elementId))
    const beats = requireObjectItems(shot.beats, `${shotField}.beats`)
      .map((beat, index) => normalizeShotRelationBeat(beat, `${shotField}.beats[${String(index)}]`))
    const beatIds = new Set<string>()
    beats.forEach((beat, index) => {
      if (beatIds.has(beat.beatId)) throw new UpstreamContractError(`${shotField}.beats contains duplicate beatId`)
      beatIds.add(beat.beatId)
      if (beat.order !== index) throw new UpstreamContractError(`${shotField}.beats order must match array position`)
      if (beat.actorIds.some(elementId => !actorIds.has(elementId))) {
        throw new UpstreamContractError(`${shotField}.beats references a dangling actorId`)
      }
      if (beat.propIds.some(elementId => !propIds.has(elementId))) {
        throw new UpstreamContractError(`${shotField}.beats references a dangling propId`)
      }
    })
    return { shotId, frameNo, sceneId, title: shot.title, durationSec, dialogueRhythm, beats, elements }
  }).sort((left, right) => left.frameNo - right.frameNo)
  const shotIds = new Set(shots.map(shot => shot.shotId))
  if (shotIds.size !== shots.length) throw new UpstreamContractError(`${field}.shots contains duplicate shotId`)
  const frameNos = new Set(shots.map(shot => shot.frameNo))
  if (frameNos.size !== shots.length) throw new UpstreamContractError(`${field}.shots contains duplicate frameNo`)

  return {
    schema: SHOT_RELATIONS_SCHEMA,
    projectId,
    episodeId,
    storyboardRevision,
    scenes,
    shots,
    valid: true,
    blockers,
  }
}

function normalizeHeroFrameStoryboardBlocker(
  value: unknown,
  index: number,
  parentField: string,
): YimengHeroFrameStoryboardBlocker {
  const field = `${parentField}[${String(index)}]`
  const blocker = requireObject(value, field)
  const shotId = requireOptionalIdentifier(blocker.shotId, `${field}.shotId`)
  const annotationId = requireOptionalIdentifier(blocker.annotationId, `${field}.annotationId`)
  const elementId = requireOptionalIdentifier(blocker.elementId, `${field}.elementId`)
  return {
    ...blocker,
    scope: requireIdentifier(blocker.scope, `${field}.scope`),
    reason: requireIdentifier(blocker.reason, `${field}.reason`),
    ...(shotId === undefined ? {} : { shotId }),
    ...(annotationId === undefined ? {} : { annotationId }),
    ...(elementId === undefined ? {} : { elementId }),
  }
}

function normalizeStoryboardCanvasPoint(value: unknown, field: string): { readonly x: number; readonly y: number } {
  const point = requireObject(value, field)
  assertExactOutputKeys(point, ['x', 'y'], field)
  return {
    x: requireInteger(point.x, `${field}.x`, 0, STORYBOARD_GRID_MAX),
    y: requireInteger(point.y, `${field}.y`, 0, STORYBOARD_GRID_MAX),
  }
}

function normalizeStoryboardCanvasAnnotation(
  value: unknown,
  index: number,
  allowedElements: ReadonlyMap<string, YimengShotRelationElementKind>,
  parentField: string,
): YimengStoryboardCanvasAnnotation {
  const field = `${parentField}[${String(index)}]`
  const annotation = requireObject(value, field)
  assertExactOutputKeys(annotation, ['annotationId', 'kind', 'elementRef', 'points'], field)
  if (
    annotation.kind !== 'subject_region'
    && annotation.kind !== 'object_anchor'
    && annotation.kind !== 'motion_vector'
  ) throw new UpstreamContractError(`${field}.kind is invalid`)
  const elementRef = requireObject(annotation.elementRef, `${field}.elementRef`)
  assertExactOutputKeys(elementRef, ['elementKind', 'elementId'], `${field}.elementRef`)
  if (elementRef.elementKind !== 'actor' && elementRef.elementKind !== 'prop') {
    throw new UpstreamContractError(`${field}.elementRef.elementKind must be actor or prop`)
  }
  const elementId = requireIdentifier(elementRef.elementId, `${field}.elementRef.elementId`)
  if (allowedElements.get(elementId) !== elementRef.elementKind) {
    throw new UpstreamContractError(`${field}.elementRef does not belong to the canonical Shot`)
  }
  if (
    (annotation.kind === 'subject_region' && elementRef.elementKind !== 'actor')
    || (annotation.kind === 'object_anchor' && elementRef.elementKind !== 'prop')
  ) throw new UpstreamContractError(`${field}.kind and elementRef mismatch`)
  if (!Array.isArray(annotation.points)) throw new UpstreamContractError(`${field}.points must be an array`)
  const points = annotation.points.map((point, pointIndex) => (
    normalizeStoryboardCanvasPoint(point, `${field}.points[${String(pointIndex)}]`)
  ))
  const expectedPoints = annotation.kind === 'object_anchor' ? 1 : 2
  if (points.length !== expectedPoints) throw new UpstreamContractError(`${field}.points length mismatch`)
  if (annotation.kind === 'subject_region') {
    const [first, second] = points
    if (first === undefined || second === undefined || first.x === second.x || first.y === second.y) {
      throw new UpstreamContractError(`${field} subject region must have non-zero area`)
    }
  }
  if (annotation.kind === 'motion_vector') {
    const [first, second] = points
    if (first === undefined || second === undefined || (first.x === second.x && first.y === second.y)) {
      throw new UpstreamContractError(`${field} motion vector must have distinct endpoints`)
    }
  }
  return {
    annotationId: requireIdentifier(annotation.annotationId, `${field}.annotationId`),
    kind: annotation.kind,
    elementRef: { elementKind: elementRef.elementKind, elementId },
    points,
  }
}

function compileStoryboardAnnotations(
  annotations: readonly YimengStoryboardCanvasAnnotation[],
): YimengStoryboardCanvasCompiled {
  return {
    subjectLayout: annotations.flatMap((annotation) => {
      if (annotation.kind !== 'subject_region' || annotation.elementRef.elementKind !== 'actor') return []
      const [first, second] = annotation.points
      if (first === undefined || second === undefined) return []
      return [{
        annotationId: annotation.annotationId,
        elementRef: { elementKind: 'actor', elementId: annotation.elementRef.elementId },
        bounds: {
          xMin: Math.min(first.x, second.x),
          yMin: Math.min(first.y, second.y),
          xMax: Math.max(first.x, second.x),
          yMax: Math.max(first.y, second.y),
        },
      }]
    }),
    objectAnchors: annotations.flatMap((annotation) => {
      if (annotation.kind !== 'object_anchor' || annotation.elementRef.elementKind !== 'prop') return []
      const point = annotation.points[0]
      return point === undefined ? [] : [{
        annotationId: annotation.annotationId,
        elementRef: { elementKind: 'prop', elementId: annotation.elementRef.elementId },
        point,
      }]
    }),
    actionTrajectory: annotations.flatMap((annotation) => {
      if (annotation.kind !== 'motion_vector') return []
      const [from, to] = annotation.points
      return from === undefined || to === undefined ? [] : [{
        annotationId: annotation.annotationId,
        elementRef: annotation.elementRef,
        from,
        to,
      }]
    }),
  }
}

function normalizeStoryboardCanvas(
  value: unknown,
  heroFrame: YimengHeroFrameBinding,
  allowedElements: ReadonlyMap<string, YimengShotRelationElementKind>,
  field: string,
): YimengStoryboardCanvas {
  const canvas = requireObject(value, field)
  assertExactOutputKeys(canvas, [
    'schema',
    'heroFrameBindingSha256',
    'annotations',
    'rawAnnotationsSha256',
    'compiled',
    'compiledSha256',
  ], field)
  if (canvas.schema !== STORYBOARD_CANVAS_SCHEMA) throw new UpstreamContractError(`${field}.schema mismatch`)
  if (canvas.heroFrameBindingSha256 !== heroFrame.bindingSha256) {
    throw new UpstreamContractError(`${field}.heroFrameBindingSha256 mismatch`)
  }
  if (!Array.isArray(canvas.annotations) || canvas.annotations.length > MAX_STORYBOARD_ANNOTATIONS) {
    throw new UpstreamContractError(`${field}.annotations exceeds the bounded canvas contract`)
  }
  const annotations = canvas.annotations.map((annotation, index) => (
    normalizeStoryboardCanvasAnnotation(annotation, index, allowedElements, `${field}.annotations`)
  ))
  const annotationIds = annotations.map(annotation => annotation.annotationId)
  if (new Set(annotationIds).size !== annotationIds.length) {
    throw new UpstreamContractError(`${field}.annotations contains duplicate annotationId`)
  }
  const rawAnnotationsSha256 = requireSha256(canvas.rawAnnotationsSha256, `${field}.rawAnnotationsSha256`)
  if (rawAnnotationsSha256 !== canonicalJsonSha256(annotations, `${field}.annotations`)) {
    throw new UpstreamContractError(`${field}.rawAnnotationsSha256 mismatch`)
  }
  const compiled = requireObject(canvas.compiled, `${field}.compiled`)
  assertExactOutputKeys(compiled, ['subjectLayout', 'objectAnchors', 'actionTrajectory'], `${field}.compiled`)
  const expectedCompiled = compileStoryboardAnnotations(annotations)
  if (!isDeepStrictEqual(compiled, expectedCompiled)) {
    throw new UpstreamContractError(`${field}.compiled does not match raw annotations`)
  }
  const compiledSha256 = requireSha256(canvas.compiledSha256, `${field}.compiledSha256`)
  if (compiledSha256 !== canonicalJsonSha256(expectedCompiled, `${field}.compiled`)) {
    throw new UpstreamContractError(`${field}.compiledSha256 mismatch`)
  }
  return {
    schema: STORYBOARD_CANVAS_SCHEMA,
    heroFrameBindingSha256: heroFrame.bindingSha256,
    annotations,
    rawAnnotationsSha256,
    compiled: expectedCompiled,
    compiledSha256,
  }
}

function normalizeHeroFrameStoryboards(
  value: unknown,
  relations: YimengShotRelationsProjection,
): YimengHeroFrameStoryboardsProjection {
  const field = 'workflow.director.heroFrameStoryboards'
  const root = requireObject(value, field)
  assertExactOutputKeys(root, [
    'schema',
    'projectId',
    'episodeId',
    'episodeRevision',
    'storyboardRevision',
    'shotRelationsSha256',
    'shots',
    'shotsSha256',
    'valid',
    'blockers',
  ], field)
  if (root.schema !== HERO_FRAME_STORYBOARDS_SCHEMA) throw new UpstreamContractError(`${field}.schema mismatch`)
  const projectId = requireIdentifier(root.projectId, `${field}.projectId`)
  const episodeId = requireIdentifier(root.episodeId, `${field}.episodeId`)
  const episodeRevision = requireInteger(root.episodeRevision, `${field}.episodeRevision`, 0)
  if (
    projectId !== relations.projectId
    || episodeId !== relations.episodeId
    || episodeRevision !== relations.storyboardRevision.episodeRevision
  ) throw new UpstreamContractError(`${field} subject or episode revision mismatch`)
  const revision = requireObject(root.storyboardRevision, `${field}.storyboardRevision`)
  assertExactOutputKeys(revision, ['revisionId', 'revisionVersion', 'sourceSha256'], `${field}.storyboardRevision`)
  const storyboardRevision = {
    revisionId: requireIdentifier(revision.revisionId, `${field}.storyboardRevision.revisionId`),
    revisionVersion: requireInteger(revision.revisionVersion, `${field}.storyboardRevision.revisionVersion`, 1),
    sourceSha256: requireSha256(revision.sourceSha256, `${field}.storyboardRevision.sourceSha256`),
  }
  if (
    storyboardRevision.revisionId !== relations.storyboardRevision.revisionId
    || storyboardRevision.revisionVersion !== relations.storyboardRevision.revisionVersion
    || storyboardRevision.sourceSha256 !== relations.storyboardRevision.sourceSha256
  ) throw new UpstreamContractError(`${field}.storyboardRevision does not match Shot relations`)
  if (!Array.isArray(root.blockers)) throw new UpstreamContractError(`${field}.blockers must be an array`)
  const blockers = root.blockers.map((blocker, index) => (
    normalizeHeroFrameStoryboardBlocker(blocker, index, `${field}.blockers`)
  ))
  if (root.valid !== true || blockers.length !== 0) {
    throw new UpstreamContractError(`${field} is invalid: ${blockers[0]?.reason ?? 'unknown Hero Frame blocker'}`)
  }
  const relationByShotId = new Map(relations.shots.map(shot => [shot.shotId, shot]))
  const shotRows = requireObjectItems(root.shots, `${field}.shots`)
  const shots = shotRows.map((row, index): YimengHeroFrameStoryboardShot => {
    const shotField = `${field}.shots[${String(index)}]`
    assertExactOutputKeys(row, ['shotId', 'shotSnapshotSha256', 'heroFrame', 'canvas', 'blockers'], shotField)
    const shotId = requireIdentifier(row.shotId, `${shotField}.shotId`)
    const relation = relationByShotId.get(shotId)
    if (relation === undefined) throw new UpstreamContractError(`${shotField}.shotId is absent from Shot relations`)
    if (!Array.isArray(row.blockers)) throw new UpstreamContractError(`${shotField}.blockers must be an array`)
    const shotBlockers = row.blockers.map((blocker, blockerIndex) => (
      normalizeHeroFrameStoryboardBlocker(blocker, blockerIndex, `${shotField}.blockers`)
    ))
    let heroFrame: YimengHeroFrameBinding | null = null
    if (row.heroFrame !== null) {
      const hero = requireObject(row.heroFrame, `${shotField}.heroFrame`)
      assertExactOutputKeys(hero, ['assetId', 'mediaSha256', 'browserUrl', 'bindingSha256'], `${shotField}.heroFrame`)
      const assetId = requireIdentifier(hero.assetId, `${shotField}.heroFrame.assetId`)
      const mediaSha256 = requireSha256(hero.mediaSha256, `${shotField}.heroFrame.mediaSha256`)
      const browserUrl = requireString(hero.browserUrl, `${shotField}.heroFrame.browserUrl`)
      if (browserUrl.length === 0 || browserUrl.length > 4_096 || browserUrl.trim() !== browserUrl) {
        throw new UpstreamContractError(`${shotField}.heroFrame.browserUrl is invalid`)
      }
      const bindingSha256 = requireSha256(hero.bindingSha256, `${shotField}.heroFrame.bindingSha256`)
      if (bindingSha256 !== canonicalJsonSha256({ assetId, mediaSha256, shotId }, `${shotField}.heroFrame.binding`)) {
        throw new UpstreamContractError(`${shotField}.heroFrame.bindingSha256 mismatch`)
      }
      heroFrame = { assetId, mediaSha256, browserUrl, bindingSha256 }
    }
    const allowedElements = new Map(relation.elements.map(element => [element.elementId, element.elementKind]))
    if (row.canvas !== null && heroFrame === null) {
      throw new UpstreamContractError(`${shotField}.canvas requires a selected Hero Frame`)
    }
    const canvas = row.canvas === null
      ? null
      : normalizeStoryboardCanvas(row.canvas, heroFrame as YimengHeroFrameBinding, allowedElements, `${shotField}.canvas`)
    return {
      shotId,
      shotSnapshotSha256: requireSha256(row.shotSnapshotSha256, `${shotField}.shotSnapshotSha256`),
      heroFrame,
      canvas,
      blockers: shotBlockers,
    }
  })
  const shotIds = shots.map(shot => shot.shotId)
  if (
    new Set(shotIds).size !== shotIds.length
    || shots.length !== relations.shots.length
    || relations.shots.some(shot => !shotIds.includes(shot.shotId))
  ) throw new UpstreamContractError(`${field}.shots must join one-to-one with Shot relations`)
  const stableShots = shots.map(shot => ({
    ...shot,
    heroFrame: shot.heroFrame === null ? null : {
      assetId: shot.heroFrame.assetId,
      mediaSha256: shot.heroFrame.mediaSha256,
      bindingSha256: shot.heroFrame.bindingSha256,
    },
  }))
  const shotsSha256 = requireSha256(root.shotsSha256, `${field}.shotsSha256`)
  if (shotsSha256 !== canonicalJsonSha256(stableShots, `${field}.stableShots`)) {
    throw new UpstreamContractError(`${field}.shotsSha256 mismatch`)
  }
  return {
    schema: HERO_FRAME_STORYBOARDS_SCHEMA,
    projectId,
    episodeId,
    episodeRevision,
    storyboardRevision,
    shotRelationsSha256: requireSha256(root.shotRelationsSha256, `${field}.shotRelationsSha256`),
    shots,
    shotsSha256,
    valid: true,
    blockers,
  }
}

function normalizeWorkflow(value: unknown): YimengWorkflowProjection {
  const root = requireObject(value, 'workflow')
  if (root.schema !== WORKFLOW_SCHEMA) throw new UpstreamContractError('workflow.schema mismatch')
  const projectId = requireIdentifier(root.projectId, 'workflow.projectId')
  const episodeId = requireIdentifier(root.episodeId, 'workflow.episodeId')
  const stagesRoot = requireObject(root.stages, 'workflow.stages')
  const stages = Object.fromEntries(
    Object.entries(stagesRoot).map(([key, stage]) => [key, normalizeWorkflowStage(stage, `workflow.stages.${key}`)]),
  )
  if (!Array.isArray(root.blockers)) throw new UpstreamContractError('workflow.blockers must be an array')
  const directorRoot = requireObject(root.director, 'workflow.director')
  const shotRelations = normalizeShotRelations(directorRoot.shotRelations, projectId, episodeId)
  const director: YimengWorkflowDirector = {
    ...directorRoot,
    shotRelations,
    heroFrameStoryboards: normalizeHeroFrameStoryboards(directorRoot.heroFrameStoryboards, shotRelations),
    ...(directorRoot.continuityDelta === undefined ? {} : {
      continuityDelta: normalizeContinuityDelta(directorRoot.continuityDelta, shotRelations, canonicalJson),
    }),
  }
  return {
    ...root,
    schema: WORKFLOW_SCHEMA,
    projectId,
    episodeId,
    sourceRevision: requireObject(root.sourceRevision, 'workflow.sourceRevision'),
    inputFingerprint: requireString(root.inputFingerprint, 'workflow.inputFingerprint'),
    activeTaskId: requireNullableString(root.activeTaskId, 'workflow.activeTaskId'),
    status: requireString(root.status, 'workflow.status'),
    hasData: requireBoolean(root.hasData, 'workflow.hasData'),
    isStale: requireBoolean(root.isStale, 'workflow.isStale'),
    qualityPassed: requireBoolean(root.qualityPassed, 'workflow.qualityPassed'),
    selected: requireBoolean(root.selected, 'workflow.selected'),
    canProceed: requireBoolean(root.canProceed, 'workflow.canProceed'),
    stages,
    stageHandoff: requireObject(root.stageHandoff, 'workflow.stageHandoff'),
    assets: requireObject(root.assets, 'workflow.assets'),
    director,
    shots: requireObject(root.shots, 'workflow.shots'),
    video: requireObject(root.video, 'workflow.video'),
    audio: requireObject(root.audio, 'workflow.audio'),
    timeline: requireObject(root.timeline, 'workflow.timeline'),
    budget: requireObject(root.budget, 'workflow.budget'),
    release: requireObject(root.release, 'workflow.release'),
    blockers: root.blockers.map(normalizeWorkflowBlocker),
    legacy: requireObject(root.legacy, 'workflow.legacy'),
    interpretation: {
      providerAuthorization: 'not-exposed',
      humanSignoff: 'not-inferred',
      productionReadiness: 'not-inferred',
      statusFacts: ['budget.valid', 'release.releaseReady', 'qualityPassed'],
    },
  }
}

/**
 * Create the generic Connection RPC handler without registering it.
 * @param config - loopback upstream and timeout settings.
 * @param dependencies - host fetch and token source; defaults read only `YIMENG_API_TOKEN`.
 * @returns a handler for the read-only endpoint names.
 */
export function createYimengReadHandler(
  config: YimengReadAdapterConfig = {},
  dependencies: YimengReadAdapterDependencies = {
    fetch: globalThis.fetch,
    readToken: () => process.env.YIMENG_API_TOKEN,
  },
): ConnectionRpcHandler {
  const baseUrl = resolveBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL)
  const timeoutMs = resolveTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return async (endpoint, payload, signal) => {
    try {
      let path: string
      let normalize: (value: unknown) => unknown
      if (endpoint === 'health') {
        assertEmptyRequest(payload)
        path = '/api/health'
        normalize = normalizeHealth
      } else if (endpoint === 'capabilityCatalog') {
        const request = parseCapabilityCatalogRequest(payload)
        const query = new URLSearchParams()
        if (request.modelId !== undefined) query.set('model_id', request.modelId)
        if (request.capability !== undefined) query.set('capability', request.capability)
        for (const control of request.requestedControls ?? []) {
          query.append('requested_control', control)
        }
        path = `/api/providers/capability-catalog${query.size === 0 ? '' : `?${query.toString()}`}`
        normalize = value => normalizeCapabilityCatalog(value, request)
      } else if (endpoint === 'costRehearsal') {
        const request = parseCostRehearsalRequest(payload)
        const query = new URLSearchParams({
          model_id: request.modelId,
          capability: request.capability,
          resolution: request.resolution,
          candidate_count: String(request.candidateCount),
          catalog_snapshot_sha256: request.catalogSnapshotSha256,
          request_snapshot_sha256: request.requestSnapshotSha256,
          preflight_snapshot_sha256: request.preflightSnapshotSha256,
          capability_snapshot_sha256: request.capabilitySnapshotSha256,
        })
        for (const control of request.requestedControls) query.append('requested_control', control)
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId)
          + '/frames/' + encodeURIComponent(request.frameId)
          + `/cost-rehearsal?${query.toString()}`
        normalize = value => normalizeCostRehearsal(value, request)
      } else if (endpoint === 'gateAControlEvidence') {
        const input = requireInputObject(payload)
        if (Object.keys(input).length !== 0) {
          throw new InputError('gateAControlEvidence payload must be empty')
        }
        path = '/api/qingmu/provider-gate-a/control-evidence'
        normalize = normalizeGateAControlEvidence
      } else if (endpoint === 'projects') {
        const request = parseProjectsRequest(payload)
        const query = new URLSearchParams({ page: String(request.page), page_size: String(request.pageSize) })
        if (request.search !== undefined) query.set('search', request.search)
        path = `/api/projects?${query.toString()}`
        normalize = normalizeProjects
      } else if (endpoint === 'episodes') {
        const request = parseEpisodesRequest(payload)
        const query = new URLSearchParams()
        if (request.seriesId !== undefined) query.set('series_id', request.seriesId)
        path = `/api/projects/${encodeURIComponent(request.projectId)}/episodes${query.size === 0 ? '' : `?${query.toString()}`}`
        normalize = value => normalizeEpisodes(value, request.projectId)
      } else if (endpoint === 'workflow') {
        const request = parseEpisodeRequest(payload)
        path = `/api/episodes/${encodeURIComponent(request.episodeId)}/workflow-projection`
        normalize = (value) => {
          const root = requireObject(value, 'workflow')
          if (root.projectId !== request.projectId || root.episodeId !== request.episodeId) {
            throw new UpstreamContractError('workflow project or episode subject mismatch')
          }
          const result = normalizeWorkflow(value)
          if (result.projectId !== request.projectId || result.episodeId !== request.episodeId) {
            throw new UpstreamContractError('workflow project or episode subject mismatch')
          }
          return result
        }
      } else if (endpoint === 'script') {
        const request = parseEpisodeRequest(payload)
        path = `/api/episodes/${encodeURIComponent(request.episodeId)}/script`
        normalize = (value) => {
          const result = normalizeScript(value)
          if (result.projectId !== request.projectId || result.episodeId !== request.episodeId) {
            throw new UpstreamContractError('script project or episode subject mismatch')
          }
          return result
        }
      } else if (endpoint === 'promptIr') {
        const request = parsePromptIrRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir`
        normalize = value => normalizePromptIr(value, request)
      } else if (endpoint === 'selectedVideoReview') {
        const request = parseSelectedVideoReviewRequest(payload)
        path = `/api/frames/${encodeURIComponent(request.frameId)}/video-candidates`
        normalize = value => normalizeSelectedVideoReview(value, request)
      } else if (endpoint === 'takeVersions') {
        const request = parseTakeVersionRequest(payload)
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId)
          + '/frames/' + encodeURIComponent(request.frameId) + '/take-versions'
        normalize = value => normalizeTakeVersionStack(value, request, jcsSha256)
      } else if (endpoint === 'shotFindings') {
        const request = parseShotFindingRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/frames/${encodeURIComponent(request.frameId)}/findings`
        normalize = value => normalizeShotFindingFeed(value, request, canonicalJsonSha256)
      } else if (endpoint === 'productionUnits') {
        const request = parseProductionUnitsRequest(payload)
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId) + '/production-units'
        normalize = value => normalizeProductionUnitsFeed(value, request, canonicalJsonSha256)
      } else if (endpoint === 'stageSources') {
        const request = parseStageSourcesRequest(payload)
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId) + '/stage-sources'
        normalize = value => normalizeStageSourcesFeed(value, request, canonicalJsonSha256)
      } else if (endpoint === 'lsuPlanSource') {
        const request = parseLsuPlanReadRequest(payload)
        const query = new URLSearchParams({ lockRulesSha256: request.lockRulesSha256 })
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId) + `/lsu-plan/source?${query.toString()}`
        normalize = value => normalizeLsuPlanSource(value, request, canonicalJsonSha256)
      } else if (endpoint === 'reworkRouteSource') {
        const request = parseReworkRouteReadRequest(payload)
        const query = new URLSearchParams({
          routeRulesSha256: request.routeRulesSha256,
          planRulesSha256: request.planRulesSha256,
          lockRulesSha256: request.lockRulesSha256,
        })
        path = '/api/qingmu/projects/' + encodeURIComponent(request.projectId)
          + '/episodes/' + encodeURIComponent(request.episodeId)
          + '/shots/' + encodeURIComponent(request.frameId)
          + '/findings/' + encodeURIComponent(request.findingId)
          + `/rework-route/source?${query.toString()}`
        normalize = value => normalizeReworkRouteSource(value, request, canonicalJsonSha256)
      } else if (endpoint === 'elementProfile') {
        const request = parseElementProfileRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}`
        normalize = value => normalizeElementProfile(value, request)
      } else if (endpoint === 'referenceCandidates') {
        const request = parseElementProfileRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/reference-candidates`
        normalize = value => normalizeReferenceCandidates(value, request)
      } else if (endpoint === 'reviewEvents') {
        const request = parseElementProfileRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/review-events`
        normalize = value => normalizeElementReviewFeed(value, request)
      } else if (endpoint === 'referenceRightsExceptionReleases') {
        const request = parseElementProfileRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/reference-rights/exception-releases`
        normalize = value => normalizeReferenceRightsExceptionReleaseFeed(value, request)
      } else {
        throw new InputError(`unknown Yimeng endpoint: ${endpoint}`)
      }

      const scrubToken = normalizeToken(dependencies.readToken())
      let authorizationToken: string | undefined
      if (PROTECTED_ENDPOINTS.has(endpoint)) {
        if (scrubToken === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        authorizationToken = scrubToken
      }
      const response = await fetchJson(
        dependencies,
        `${baseUrl}${path}`,
        authorizationToken,
        scrubToken,
        timeoutMs,
        endpoint === 'script' ? MAX_SCRIPT_JSON_BYTES : MAX_JSON_BYTES,
        signal,
      )
      if (!response.ok) return response
      try {
        return { ok: true, value: normalize(response.value) }
      } catch (error) {
        if (error instanceof UpstreamContractError) {
          return internalError(`Yimeng response contract failed: ${error.message}`)
        }
        return internalError('Yimeng response contract failed')
      }
    } catch (error) {
      if (error instanceof InputError) return badRequest(error.message)
      return internalError('Yimeng adapter failed')
    }
  }
}

/**
 * Register the read adapter on the loopback-only Host Connection channel.
 * @param ctx - Cordis context carrying Host Connection.
 * @param config - loopback upstream and timeout settings.
 */
export function apply(ctx: Context, config: YimengReadAdapterConfig = {}): void {
  const handler = createYimengReadHandler(config)
  ctx.provide('qingmuYimengRead', handler)
  ctx.connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' })
}
