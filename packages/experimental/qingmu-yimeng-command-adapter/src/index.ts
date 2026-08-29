/** Loopback-only Host boundary for explicit Yimeng ChangeSet commands. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { prepareCreationCommand } from './creation.ts'
import { prepareScenePlanning } from './scene-planning.ts'
import { prepareLocalReferenceCandidate } from './local-reference-candidate.ts'
import type { DirectorProposalFreshnessResult } from './director-proposal.ts'
export { executeDirectorProviderPermit } from './director-provider-execution.ts'
export type {
  DirectorProviderDispatchPermit, DirectorProviderExecutionReceipt,
  DirectorProviderExecutionResult, DirectorProviderTransport, DirectorProviderTransportResult,
} from './director-provider-execution.ts'
import {
  buildDirectorReplayProposal,
  directorWorkOrderRequest,
  normalizeDirectorContext,
  normalizeDirectorProposalFreshness,
  normalizeDirectorReplayMethod,
  normalizeDirectorWorkOrder,
  parseDirectorProposalFreshnessRequest,
  parseDirectorProposalRequest,
} from './director-proposal.ts'
export type {
  DirectorContextSnapshot,
  DirectorInferenceWorkOrder,
  DirectorProposalField,
  DirectorProposalItem,
  DirectorProposalRequest,
  DirectorProposalFreshnessRequest,
  DirectorProposalFreshnessResult,
  DirectorReplayProposal,
  DirectorSuggestionType,
} from './director-proposal.ts'
export type {
  ProjectInitializationRequest, ProjectInitializationRecovery, ProjectInitializationResult,
  CreationScope, TextImportReadRequest, TextImportRequest, TextImportLine, TextImportDraft,
  TextImportState, TextImportCorrection, TextImportConfirmationRequest, TextImportConfirmation,
} from './creation.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import z from '@deepseek-ai/schemastery'
import { prepareShotFindingCommand } from './shot-finding.ts'
import { prepareTakeVersionCommand } from './take-version.ts'
import { prepareTakeCommentCommand } from './take-comment.ts'
import { prepareTakeReviewCommand } from './take-review-authority.ts'
import {
  prepareCurrentTakeTechnicalQcMethodRequest,
  prepareTakeTechnicalQcCommand,
} from './take-technical-qc.ts'
import {
  prepareCurrentTakeApprovalLifecycleMethodRequest,
  prepareTakeApprovalLifecycleCommand,
} from './take-approval-lifecycle.ts'
import { prepareProductionUnitCommand } from './production-unit.ts'
import {
  prepareCurrentStageArtifactMethodRequest,
  prepareStageArtifactCommand,
  stageArtifactCanonicalJson,
} from './stage-artifact.ts'
import { prepareStageSourceCommand } from './stage-source.ts'
import { prepareCurrentLsuPlanMethodRequest, prepareLsuPlanCommand } from './lsu-plan.ts'
import { prepareCurrentReworkRouteMethodRequest, prepareReworkRouteCommand } from './rework-route.ts'
import type {
  YimengChangeSet,
  YimengChangeSetBase,
  YimengCommandJsonObject,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengCreateReferenceRightsExceptionReleaseRequest,
  YimengCreateReferenceRightsExceptionReleaseResponse,
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengElementImpactAnalysis,
  YimengElementKind,
  YimengElementProfileChangeSet,
  YimengElementProfileOperation,
  YimengElementReviewComment,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengHeroFrameBinding,
  YimengImagoElementMethodAttestation,
  YimengImagoHeroFrameStoryboardMethodAttestation,
  YimengImagoHeroFrameStoryboardMethodProjection,
  YimengImagoReferenceAssetMethodAttestation,
  YimengImagoReferenceAssetMethodProjection,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengPreviewStoryboardCanvasRequest,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
  YimengProposeStoryboardCanvasRequest,
  YimengProposeStoryboardCanvasResponse,
  YimengProposePromptIrRequest,
  YimengProposePromptIrResponse,
  YimengProposeReferenceAssetRequest,
  YimengProposeScriptRequest,
  YimengProposeScriptResponse,
  YimengPromptIrChangeSet,
  YimengPromptIrDiff,
  YimengPromptIrEditableProjection,
  YimengPromptIrReadyLineage,
  YimengPromptIrRecord,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
  YimengRecoverStoryboardCanvasCommitRequest,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengRecoverReferenceRightsExceptionReleaseRequest,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengReferenceCommitElementProfileResponse,
  YimengReferenceActionOperation,
  YimengReferencePreviewElementProfileRequest,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceRightsCommitElementProfileResponse,
  YimengReferenceRightsKnowledgeState,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionReleaseFact,
  YimengReferenceRightsExceptionScope,
  YimengReferenceRightsList,
  YimengReferenceRightsPreviewElementProfileRequest,
  YimengReferenceRightsPreviewElementProfileResponse,
  YimengReferenceRightsRecord,
  YimengReferenceRightsScalar,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
  YimengStoryboardCanvas,
  YimengStoryboardFrameChangeSet,
  YimengStoryboardRevisionCoordinate,
  YimengVisualCommitElementProfileResponse,
  YimengVisualPreviewElementProfileResponse,
} from './types.ts'

export type {
  YimengChangeSet,
  YimengChangeSetBase,
  YimengCommandEndpoint,
  YimengCommandEndpointMap,
  YimengCommandJsonObject,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengCreateReferenceRightsExceptionReleaseRequest,
  YimengCreateReferenceRightsExceptionReleaseResponse,
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitStoryboardCanvasRequest,
  YimengCommitStoryboardCanvasResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengElementKind,
  YimengElementImpactAnalysis,
  YimengElementProfileChangeSet,
  YimengElementProfileOperation,
  YimengElementReviewComment,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengImagoElementMethodAttestation,
  YimengImagoHeroFrameStoryboardMethodAttestation,
  YimengImagoHeroFrameStoryboardMethodProjection,
  YimengImagoReferenceAssetMethodAttestation,
  YimengImagoReferenceAssetMethodProjection,
  YimengHeroFrameBinding,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengPreviewStoryboardCanvasRequest,
  YimengPreviewStoryboardCanvasResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
  YimengProposeStoryboardCanvasRequest,
  YimengProposeStoryboardCanvasResponse,
  YimengProposePromptIrRequest,
  YimengProposePromptIrResponse,
  YimengProposeReferenceAssetRequest,
  YimengProposeReferenceAssetResponse,
  YimengProposeScriptRequest,
  YimengProposeScriptResponse,
  YimengPromptIrChangeSet,
  YimengPromptIrCommandSubject,
  YimengPromptIrDiff,
  YimengPromptIrEditableProjection,
  YimengPromptIrReadyLineage,
  YimengPromptIrRecord,
  YimengPromptIrReplacements,
  YimengCommitPromptIrEditRequest,
  YimengCommitPromptIrEditResponse,
  YimengRecoverPromptIrEditCommitRequest,
  YimengRecoverPromptIrEditCommitResponse,
  YimengRecoverPromptIrSelectionRequest,
  YimengRecoverPromptIrSelectionResponse,
  YimengRecoverElementProfileCommitRequest,
  YimengRecoverElementProfileCommitResponse,
  YimengRecoverScriptCommitRequest,
  YimengRecoverScriptCommitResponse,
  YimengRecoverStoryboardCanvasCommitRequest,
  YimengRecoverStoryboardCanvasCommitResponse,
  YimengRecoverReferenceRightsExceptionReleaseRequest,
  YimengRecoverReferenceRightsExceptionReleaseResponse,
  YimengReferenceAssetOperation,
  YimengReferenceActionOperation,
  YimengReferenceCommitElementProfileResponse,
  YimengReferencePreviewElementProfileRequest,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceRightsCommitElementProfileResponse,
  YimengReferenceRightsKnowledgeState,
  YimengReferenceRightsExceptionField,
  YimengReferenceRightsExceptionReleaseFact,
  YimengReferenceRightsExceptionScope,
  YimengReferenceRightsList,
  YimengReferenceRightsPreviewElementProfileRequest,
  YimengReferenceRightsPreviewElementProfileResponse,
  YimengReferenceRightsRecord,
  YimengReferenceRightsScalar,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
  YimengVisualCommitElementProfileResponse,
  YimengVisualPreviewElementProfileResponse,
  YimengScriptChangeSet,
  YimengStoryboardCanvas,
  YimengStoryboardCanvasCommandSubject,
  YimengStoryboardFrameChangeSet,
  YimengStoryboardRevisionCoordinate,
} from './types.ts'

export type {
  YimengBindProductionUnitRequest,
  YimengImagoProductionUnitMethodAttestation,
  YimengImagoProductionUnitMethodProjection,
  YimengProductionUnitBinding,
  YimengProductionUnitDefinition,
  YimengProductionUnitRecovery,
  YimengProductionUnitResult,
  YimengProductionUnitSource,
  YimengRecoverProductionUnitBindingRequest,
  YimengStageArtifact,
  YimengStageArtifactDefinition,
  YimengStageArtifactMachineValidation,
  YimengStageArtifactRecord,
  YimengStageArtifactRecovery,
  YimengStageArtifactResult,
  YimengStageArtifactSubject,
  YimengStageArtifactDecision,
  YimengStageArtifactDecisionRecovery,
  YimengStageArtifactDecisionResult,
  YimengStageArtifactDecisionValue,
  YimengStageArtifactProducedLock,
  YimengStageDependencyAuthority,
  YimengStageDependencyAuthorityLock,
  YimengStageDependencyAuthoritySource,
  YimengCommitStageArtifactDecisionRequest,
  YimengRecoverStageArtifactDecisionRequest,
  YimengImagoStageArtifactMethodAttestation,
  YimengImagoStageArtifactMethodProjection,
  YimengRecoverStageArtifactRegistrationRequest,
  YimengRegisterStageArtifactRequest,
  YimengForwardedLsuPlanAuthorityProbeRequest,
  YimengForwardedSealLsuPlanRequest,
  YimengImagoLsuPlanMethodAttestation,
  YimengImagoLsuPlanMethodProjection,
  YimengLsuPlanAuthorityProbe,
  YimengLsuPlanBlueprintLock,
  YimengLsuPlanDefinition,
  YimengLsuPlanProductionUnit,
  YimengLsuPlanSeal,
  YimengLsuPlanSealRecovery,
  YimengLsuPlanSealResult,
  YimengLsuPlanSubject,
  YimengProbeLsuPlanAuthorityRequest,
  YimengSealLsuPlanRequest,
  YimengForwardedRecordReworkRouteRequest,
  YimengForwardedReworkRouteAuthorityProbeRequest,
  YimengImagoReworkRouteMethodAttestation,
  YimengImagoReworkRouteMethodProjection,
  YimengProbeReworkRouteAuthorityRequest,
  YimengRecordReworkRouteRequest,
  YimengReworkRouteAuthorityProbe,
  YimengReworkRouteBoundedItem,
  YimengReworkRouteDefinition,
  YimengReworkRouteFinding,
  YimengReworkRouteInstruction,
  YimengReworkRouteProductionUnit,
  YimengReworkRouteRecord,
  YimengReworkRouteRecovery,
  YimengReworkRouteResult,
  YimengReworkRouteRuleComparison,
  YimengReworkRouteSealedPlan,
  YimengReworkRouteSubject,
  YimengStageSource,
  YimengStageSourceDefinition,
  YimengStageSourceBinding,
  YimengStageSourceResult,
  YimengStageSourceRecovery,
  YimengImagoStageSourceMethodProjection,
  YimengImagoStageSourceMethodAttestation,
  YimengBindStageSourceRequest,
  YimengRecoverStageSourceBindingRequest,
  YimengImagoShotFindingMethodAttestation,
  YimengImagoShotFindingMethodProjection,
  YimengRecordShotFindingRequest,
  YimengRecoverShotFindingRequest,
  YimengShotFinding,
  YimengShotFindingPayload,
  YimengShotFindingRecovery,
  YimengShotFindingResult,
  YimengShotVideoSubject,
  YimengSelectTakeVersionRequest,
  YimengRecoverTakeVersionSelectionRequest,
  YimengTakeSelectionIdentity,
  YimengTakeSelectionStackSubject,
  YimengTakeSelectionVersion,
  YimengTakeVersionSelectionRecovery,
  YimengTakeVersionSelectionResult,
  YimengCreateTakeCommentRequest,
  YimengRecoverTakeCommentRequest,
  YimengTakeCommentAnchor,
  YimengTakeCommentRecord,
  YimengTakeCommentRecovery,
  YimengTakeCommentResult,
  YimengTakeReviewAction,
  YimengCreateTakeReviewRecommendationRequest,
  YimengRecoverTakeReviewRecommendationRequest,
  YimengTakeReviewRecommendationRecord,
  YimengTakeReviewRecommendationRecovery,
  YimengTakeReviewRecommendationResult,
  YimengCreateTakeHumanDecisionRequest,
  YimengRecoverTakeHumanDecisionRequest,
  YimengTakeHumanDecisionRecord,
  YimengTakeHumanDecisionRecovery,
  YimengTakeHumanDecisionResult,
  YimengTakeReviewSubject,
  YimengRecordTakeTechnicalQcRequest,
  YimengRecoverTakeTechnicalQcRequest,
  YimengTakeTechnicalQcAssessment,
  YimengTakeTechnicalQcCheck,
  YimengTakeTechnicalQcCode,
  YimengTakeTechnicalQcRecovery,
  YimengTakeTechnicalQcResult,
  YimengTakeTechnicalQcSubject,
  YimengImagoTakeApprovalLifecycleMethodAttestation,
  YimengImagoTakeApprovalLifecycleMethodProjection,
  YimengRecoverTakeApprovalLifecycleTransitionRequest,
  YimengTakeApprovalLifecycleAction,
  YimengTakeApprovalLifecycleDefinition,
  YimengTakeApprovalLifecycleMethodTransition,
  YimengTakeApprovalLifecycleRecovery,
  YimengTakeApprovalLifecycleResult,
  YimengTakeApprovalLifecycleState,
  YimengTakeApprovalLifecycleTransition,
  YimengTransitionTakeApprovalLifecycleRequest,
} from './types.ts'

const CHANNEL = '/qingmu-yimeng-command'
const DEFAULT_BASE_URL = 'http://127.0.0.1:8115'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const MAX_ID_LENGTH = 256
const MAX_JSON_BYTES = 5 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/
const PROMPT_IR_EDITABLE_FIELDS = [
  'imageGenPrompt',
  'lastFrameImagePrompt',
  'videoGenPrompt',
  'motionPrompt',
  'negativePrompt',
] as const
const STORYBOARD_CANVAS_CHANGED_PATHS = [
  '$.directorPlan.storyboardCanvas',
  '$.directorPlan.subjectLayout',
  '$.directorPlan.objectAnchors',
  '$.directorPlan.actionTrajectory',
  '$.visualAtoms.storyboardCanvas',
  '$.visualAtoms.subjectLayout',
  '$.visualAtoms.objectAnchors',
  '$.visualAtoms.actionTrajectory',
] as const
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
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/
const SAFE_ERROR_CODE = /^[a-z0-9_:-]{1,128}$/
const SENSITIVE_RESPONSE_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie', 'xapikey',
  'apikey', 'accesstoken', 'refreshtoken', 'csrftoken', 'idtoken', 'token',
  'password', 'secret', 'clientsecret', 'privatekey', 'credential', 'credentials',
])

/** Cordis plugin name. */
export const name = 'experimental-qingmu-yimeng-command-adapter'
/** Host Connection must exist before the private command channel is registered. */
export const inject = ['connection']

/** Deployment-tunable loopback upstream and request deadline. */
export interface YimengCommandAdapterConfig {
  /** Pathless loopback HTTP(S) origin of the authoritative Yimeng API. */
  readonly baseUrl?: string
  /** Command deadline in milliseconds, from 100 through 60,000. */
  readonly timeoutMs?: number
}

/** Validated Cordis configuration for the command adapter. */
export const Config: z<YimengCommandAdapterConfig> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  timeoutMs: z.natural().min(100).default(DEFAULT_TIMEOUT_MS),
})

/** Injectable Host capabilities used by isolated tests. */
export interface YimengCommandAdapterDependencies {
  readonly fetch: typeof globalThis.fetch
  readonly readToken: () => string | undefined
  /** Host-only stateless package mapped to the existing Qingmu integration plan. */
  readonly runDirectorReplayMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
  /** Trusted Host call that recompiles one exact Stage artifact against current Core rules. */
  readonly runStageArtifactMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
  /** Trusted Host call that recompiles the complete current LSU scope and rule generation. */
  readonly runLsuPlanMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
  /** Trusted Host call that recompiles one bounded route from current Core and Yimeng authority. */
  readonly runReworkRouteMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
  /** Trusted Host call that recompiles the current selected-Take QC method. */
  readonly runTakeTechnicalQcMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
  /** Trusted Host call that recompiles the current Take approval lifecycle method. */
  readonly runTakeApprovalLifecycleMethod?: (
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<RpcResult<unknown>>
}

class InputError extends Error {}
class UpstreamContractError extends Error {}
class InvalidJsonResponseError extends Error {}
class ResponseTooLargeError extends Error {}
class AttestationKeyError extends Error {}

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
  error: { code: 'cancelled', message: 'Yimeng command was cancelled', details: {} },
})

function isJsonObject(value: unknown): value is YimengCommandJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(value: unknown, field: string): YimengCommandJsonObject {
  if (!isJsonObject(value)) throw new UpstreamContractError(`${field} must be an object`)
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UpstreamContractError(`${field} must be a non-empty string`)
  }
  return value
}

function requireStringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new UpstreamContractError(`${field} must be a string`)
  }
  return value
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

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new UpstreamContractError(`${field} must be a non-negative integer`)
  }
  return value as number
}

function requireSha256(value: unknown, field: string): string {
  const result = requireString(value, field)
  if (!SHA256.test(result)) throw new UpstreamContractError(`${field} must be sha256`)
  return result
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new UpstreamContractError(`${field} must be an array of strings`)
  }
  return value
}

function requireElementKind(value: unknown, field: string): YimengElementKind {
  const elementKind = requireString(value, field)
  if (elementKind !== 'actor' && elementKind !== 'scene' && elementKind !== 'prop') {
    throw new UpstreamContractError(`${field} must be actor, scene, or prop`)
  }
  return elementKind
}

function requireElementOperation(
  value: unknown,
  elementKind: YimengElementKind,
  field: string,
): YimengElementProfileOperation {
  const expected = expectedElementOperation(elementKind)
  if (value !== expected) throw new UpstreamContractError(`${field} must be ${expected} for ${elementKind}`)
  return expected
}

function normalizeElementImpactAnalysis(value: unknown, field: string): YimengElementImpactAnalysis {
  const impact = requireObject(value, field)
  const expectedKeys = [
    'affectedReferenceAssetIds',
    'invalidatedApprovalAssetIds',
    'affectedDerivedAssetIds',
    'affectedReferencePackIds',
    'affectedPromptIrIds',
    'affectedStoryboardFrameIds',
    'unknowns',
  ] as const
  const actualKeys = Object.keys(impact).sort()
  const canonicalKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== canonicalKeys.length
    || actualKeys.some((key, index) => key !== canonicalKeys[index])
  ) {
    throw new UpstreamContractError(`${field} must contain exactly the seven impact arrays`)
  }
  return {
    affectedReferenceAssetIds: requireStringArray(
      impact.affectedReferenceAssetIds,
      `${field}.affectedReferenceAssetIds`,
    ),
    invalidatedApprovalAssetIds: requireStringArray(
      impact.invalidatedApprovalAssetIds,
      `${field}.invalidatedApprovalAssetIds`,
    ),
    affectedDerivedAssetIds: requireStringArray(
      impact.affectedDerivedAssetIds,
      `${field}.affectedDerivedAssetIds`,
    ),
    affectedReferencePackIds: requireStringArray(
      impact.affectedReferencePackIds,
      `${field}.affectedReferencePackIds`,
    ),
    affectedPromptIrIds: requireStringArray(impact.affectedPromptIrIds, `${field}.affectedPromptIrIds`),
    affectedStoryboardFrameIds: requireStringArray(
      impact.affectedStoryboardFrameIds,
      `${field}.affectedStoryboardFrameIds`,
    ),
    unknowns: requireStringArray(impact.unknowns, `${field}.unknowns`),
  }
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

/** Compatible with Yimeng's canonical JSON for the receipt contract's strings, booleans, safe integers, and arrays. */
function canonicalJson(value: unknown, field: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new UpstreamContractError(`${field} must contain only canonical safe integers`)
    }
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

function requireObjectArray(value: unknown, field: string): YimengCommandJsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new UpstreamContractError(`${field} must be an array of objects`)
  }
  return value
}

function requireInputObject(value: unknown): YimengCommandJsonObject {
  if (!isJsonObject(value)) throw new InputError('payload must be an object')
  return value
}

function assertOnlyInputKeys(input: YimengCommandJsonObject, allowed: readonly string[]): void {
  const keys = new Set(allowed)
  const unknown = Object.keys(input).find(key => !keys.has(key))
  if (unknown !== undefined) throw new InputError(`unknown payload field: ${unknown}`)
}

type RightsContractErrorFactory = (message: string) => Error

function requireExactRightsObject(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
  error: RightsContractErrorFactory,
): YimengCommandJsonObject {
  if (!isJsonObject(value)) throw error(`${field} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw error(`${field} fields mismatch`)
  }
  return value
}

function normalizeRightsText(
  value: unknown,
  field: string,
  required: boolean,
  error: RightsContractErrorFactory,
): string | null {
  if (value === null && !required) return null
  if (typeof value !== 'string' || value.includes('\0')) throw error(`${field} must be a valid string or null`)
  const normalized = value.trim()
  if ((required && normalized.length === 0) || normalized.length > 4_000) {
    throw error(`${field} must be between ${required ? '1' : '0'} and 4000 characters`)
  }
  return normalized.length === 0 ? null : normalized
}

function normalizeRightsState(
  value: unknown,
  field: string,
  error: RightsContractErrorFactory,
): YimengReferenceRightsKnowledgeState {
  if (!RIGHTS_KNOWLEDGE_STATES.has(value as YimengReferenceRightsKnowledgeState)) {
    throw error(`${field} must be known, unknown, or not_applicable`)
  }
  return value as YimengReferenceRightsKnowledgeState
}

function normalizeRightsScalar(
  value: unknown,
  field: string,
  error: RightsContractErrorFactory,
): YimengReferenceRightsScalar {
  const scalar = requireExactRightsObject(value, ['state', 'value'], field, error)
  const state = normalizeRightsState(scalar.state, `${field}.state`, error)
  const normalizedValue = normalizeRightsText(scalar.value, `${field}.value`, state === 'known', error)
  if (state !== 'known' && normalizedValue !== null) throw error(`${field}.value must be null unless state is known`)
  return { state, value: normalizedValue }
}

function normalizeRightsList(
  value: unknown,
  field: string,
  allowEmptyKnown: boolean,
  error: RightsContractErrorFactory,
): YimengReferenceRightsList {
  const listed = requireExactRightsObject(value, ['state', 'values'], field, error)
  const state = normalizeRightsState(listed.state, `${field}.state`, error)
  if (!Array.isArray(listed.values)) throw error(`${field}.values must be an array`)
  const normalized = listed.values.map((item, index) =>
    normalizeRightsText(item, `${field}.values[${String(index)}]`, true, error) as string)
  const deduplicated = [...new Set(normalized)].sort(compareUnicodeCodePoints)
  if (listed.values.length !== deduplicated.length || deduplicated.length > 50) {
    throw error(`${field}.values must contain at most 50 unique values`)
  }
  if (state === 'known' && !allowEmptyKnown && deduplicated.length === 0) {
    throw error(`${field}.values must not be empty when state is known`)
  }
  if (state !== 'known' && deduplicated.length > 0) throw error(`${field}.values must be empty unless state is known`)
  return { state, values: deduplicated }
}

function normalizeRightsTimestamp(
  value: unknown,
  field: string,
  required: boolean,
  error: RightsContractErrorFactory,
): string | null {
  const normalized = normalizeRightsText(value, field, required, error)
  if (normalized === null) return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(normalized)
  if (match === null || Number.isNaN(Date.parse(normalized))) throw error(`${field} must be a UTC Z timestamp`)
  const parsed = new Date(normalized)
  if (parsed.toISOString().slice(0, 19) !== match[1]) throw error(`${field} must be a valid UTC Z timestamp`)
  const fraction = match[2]?.padEnd(6, '0')
  return `${match[1]}${fraction !== undefined && Number(fraction) !== 0 ? `.${fraction}` : ''}Z`
}

function normalizeReferenceRightsRecordWith(
  value: unknown,
  field: string,
  error: RightsContractErrorFactory,
): YimengReferenceRightsRecord {
  const rights = requireExactRightsObject(value, [
    'schema',
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
  ], field, error)
  if (rights.schema !== 'jason.qingmu-reference-rights-record.v1') throw error(`${field}.schema mismatch`)

  const term = requireExactRightsObject(
    rights.term,
    ['state', 'startsAt', 'endsAt', 'perpetual'],
    `${field}.term`,
    error,
  )
  const termState = normalizeRightsState(term.state, `${field}.term.state`, error)
  let normalizedTerm: YimengReferenceRightsRecord['term']
  if (termState !== 'known') {
    if (term.startsAt !== null || term.endsAt !== null || term.perpetual !== null) {
      throw error(`${field}.term values must be null unless state is known`)
    }
    normalizedTerm = { state: termState, startsAt: null, endsAt: null, perpetual: null }
  } else {
    if (typeof term.perpetual !== 'boolean') throw error(`${field}.term.perpetual must be a boolean`)
    const startsAt = normalizeRightsTimestamp(term.startsAt, `${field}.term.startsAt`, true, error)
    const endsAt = normalizeRightsTimestamp(term.endsAt, `${field}.term.endsAt`, !term.perpetual, error)
    if (term.perpetual && endsAt !== null) throw error(`${field}.term.endsAt must be null when perpetual`)
    if (!term.perpetual && startsAt !== null && endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw error(`${field}.term.endsAt must not be before startsAt`)
    }
    normalizedTerm = { state: 'known', startsAt, endsAt, perpetual: term.perpetual }
  }

  const contains = requireExactRightsObject(rights.contains, RIGHTS_CONTAINS_KEYS, `${field}.contains`, error)
  for (const key of RIGHTS_CONTAINS_KEYS) {
    if (!RIGHTS_CONTAINS_STATES.has(contains[key] as 'yes' | 'no' | 'unknown')) {
      throw error(`${field}.contains.${key} must be yes, no, or unknown`)
    }
  }

  const providerTerms = requireExactRightsObject(
    rights.providerTerms,
    ['state', 'terms', 'reviewedAt'],
    `${field}.providerTerms`,
    error,
  )
  const providerState = normalizeRightsState(providerTerms.state, `${field}.providerTerms.state`, error)
  const terms = normalizeRightsText(
    providerTerms.terms,
    `${field}.providerTerms.terms`,
    providerState === 'known',
    error,
  )
  const reviewedAt = normalizeRightsTimestamp(
    providerTerms.reviewedAt,
    `${field}.providerTerms.reviewedAt`,
    providerState === 'known',
    error,
  )
  if (providerState !== 'known' && (terms !== null || reviewedAt !== null)) {
    throw error(`${field}.providerTerms values must be null unless state is known`)
  }

  const modelLicenses = requireExactRightsObject(
    rights.modelLicenses,
    ['code', 'weights', 'outputUse'],
    `${field}.modelLicenses`,
    error,
  )
  const humanDeclaration = requireExactRightsObject(
    rights.humanDeclaration,
    ['state', 'text'],
    `${field}.humanDeclaration`,
    error,
  )
  if (
    humanDeclaration.state !== 'provided'
    && humanDeclaration.state !== 'unknown'
    && humanDeclaration.state !== 'not_applicable'
  ) {
    throw error(`${field}.humanDeclaration.state mismatch`)
  }
  const declarationText = normalizeRightsText(
    humanDeclaration.text,
    `${field}.humanDeclaration.text`,
    humanDeclaration.state === 'provided',
    error,
  )
  if (humanDeclaration.state !== 'provided' && declarationText !== null) {
    throw error(`${field}.humanDeclaration.text must be null unless state is provided`)
  }

  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: normalizeRightsScalar(rights.sourceType, `${field}.sourceType`, error),
    rightsHolder: normalizeRightsScalar(rights.rightsHolder, `${field}.rightsHolder`, error),
    authorizationScope: normalizeRightsList(rights.authorizationScope, `${field}.authorizationScope`, false, error),
    territory: normalizeRightsList(rights.territory, `${field}.territory`, false, error),
    term: normalizedTerm,
    restrictions: normalizeRightsList(rights.restrictions, `${field}.restrictions`, true, error),
    contains: Object.fromEntries(RIGHTS_CONTAINS_KEYS.map(key => [key, contains[key]])) as YimengReferenceRightsRecord['contains'],
    providerTerms: { state: providerState, terms, reviewedAt },
    modelLicenses: {
      code: normalizeRightsScalar(modelLicenses.code, `${field}.modelLicenses.code`, error),
      weights: normalizeRightsScalar(modelLicenses.weights, `${field}.modelLicenses.weights`, error),
      outputUse: normalizeRightsScalar(modelLicenses.outputUse, `${field}.modelLicenses.outputUse`, error),
    },
    humanDeclaration: {
      state: humanDeclaration.state,
      text: declarationText,
    },
    contentCredentials: normalizeRightsScalar(rights.contentCredentials, `${field}.contentCredentials`, error),
  }
}

/**
 * Normalize and strictly whitelist one browser-provided reference-rights record.
 * @param value - Untrusted value to validate and normalize.
 * @param field - Field path used in validation errors.
 * @returns Validated YimengReferenceRightsRecord value.
 */
export function normalizeReferenceRightsRecord(value: unknown, field = 'rights'): YimengReferenceRightsRecord {
  return normalizeReferenceRightsRecordWith(value, field, message => new InputError(message))
}

function normalizeUpstreamReferenceRightsRecord(value: unknown, field: string): YimengReferenceRightsRecord {
  return normalizeReferenceRightsRecordWith(value, field, message => new UpstreamContractError(message))
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InputError(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH) {
    throw new InputError(`${field} must be between 1 and ${String(MAX_ID_LENGTH)} characters`)
  }
  return normalized
}

function parseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputError('baseRevision must be a non-negative integer')
  }
  return value as number
}

function parseProposeRequest(payload: unknown): YimengProposeScriptRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'episodeId', 'script', 'baseRevision', 'harnessSessionId', 'references'])
  if (!isJsonObject(input.script)) throw new InputError('script must be an object')
  let harnessSessionId: string | undefined
  if (input.harnessSessionId !== undefined) {
    harnessSessionId = parseIdentifier(input.harnessSessionId, 'harnessSessionId')
    if (harnessSessionId.length > 200) throw new InputError('harnessSessionId must not exceed 200 characters')
  }
  let references: YimengCommandJsonObject[] | undefined
  if (input.references !== undefined) {
    if (!Array.isArray(input.references) || !input.references.every(isJsonObject)) {
      throw new InputError('references must be an array of objects')
    }
    references = input.references
  }
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    script: input.script,
    baseRevision: parseRevision(input.baseRevision),
    ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
    ...(references === undefined ? {} : { references }),
  }
}

function parsePreviewRequest(payload: unknown): YimengPreviewScriptRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, ['projectId', 'episodeId', 'changeSetId', 'baseRevision'])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    baseRevision: parseRevision(input.baseRevision),
  }
}

function parseCommitRequest(payload: unknown): YimengCommitScriptRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'changeSetId',
    'baseRevision',
    'idempotencyKey',
    'expectedPayloadSha256',
  ])
  const idempotencyKey = parseIdentifier(input.idempotencyKey, 'idempotencyKey')
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new InputError('idempotencyKey must be between 8 and 200 characters')
  }
  if (/[\r\n]/.test(idempotencyKey)) {
    throw new InputError('idempotencyKey must not contain line breaks')
  }
  if (typeof input.expectedPayloadSha256 !== 'string' || !SHA256.test(input.expectedPayloadSha256)) {
    throw new InputError('expectedPayloadSha256 must be sha256')
  }
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    baseRevision: parseRevision(input.baseRevision),
    idempotencyKey,
    expectedPayloadSha256: input.expectedPayloadSha256,
  }
}

function parseRecoveryRequest(payload: unknown): YimengRecoverScriptCommitRequest {
  return parseCommitRequest(payload)
}

function parsePromptIrVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputError(`${field} must be a non-negative integer`)
  }
  return value as number
}

function parsePromptIrReplacements(value: unknown): YimengProposePromptIrRequest['replacements'] {
  if (!isJsonObject(value)) throw new InputError('replacements must be an object')
  const keys = Object.keys(value)
  if (keys.length === 0) throw new InputError('replacements must contain at least one editable field')
  assertOnlyInputKeys(value, PROMPT_IR_EDITABLE_FIELDS)
  const replacements: Record<string, string> = {}
  for (const field of PROMPT_IR_EDITABLE_FIELDS) {
    if (!(field in value)) continue
    const item = value[field]
    if (
      typeof item !== 'string'
      || item.length === 0
      || item !== item.trim()
      || item.includes('\0')
    ) {
      throw new InputError(`replacements.${field} must be a trimmed non-empty string`)
    }
    replacements[field] = item
  }
  return replacements
}

function parseOptionalCommandReferences(
  value: unknown,
): readonly YimengCommandJsonObject[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new InputError('references must be an array of objects')
  }
  return value
}

function parseOptionalHarnessSessionId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const result = parseIdentifier(value, 'harnessSessionId')
  if (result.length > 200) throw new InputError('harnessSessionId must not exceed 200 characters')
  return result
}

function parseProposePromptIrRequest(payload: unknown): YimengProposePromptIrRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'basePromptIrId',
    'baseVersion',
    'baseContentSha256',
    'baseDraftSnapshotSha256',
    'replacements',
    'harnessSessionId',
    'references',
  ])
  const harnessSessionId = parseOptionalHarnessSessionId(input.harnessSessionId)
  const references = parseOptionalCommandReferences(input.references)
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
    basePromptIrId: parseIdentifier(input.basePromptIrId, 'basePromptIrId'),
    baseVersion: parsePromptIrVersion(input.baseVersion, 'baseVersion'),
    baseContentSha256: parseInputSha256(input.baseContentSha256, 'baseContentSha256'),
    baseDraftSnapshotSha256: input.baseDraftSnapshotSha256 === null ? null
      : parseInputSha256(input.baseDraftSnapshotSha256, 'baseDraftSnapshotSha256'),
    replacements: parsePromptIrReplacements(input.replacements),
    ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
    ...(references === undefined ? {} : { references }),
  }
}

function parsePromptIrCommandSubject(payload: unknown): YimengPreviewPromptIrRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'changeSetId',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'storyboardRevisionId',
    'frameId',
    'basePromptIrId',
    'baseRevision',
    'baseSnapshotSha256',
  ])
  if (input.targetType !== 'prompt_ir') throw new InputError('targetType must be prompt_ir')
  const storyboardRevisionId = parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId')
  const frameId = parseIdentifier(input.frameId, 'frameId')
  const targetId = parseIdentifier(input.targetId, 'targetId')
  if (targetId !== `${storyboardRevisionId}:${frameId}`) {
    throw new InputError('targetId must match storyboardRevisionId:frameId')
  }
  return {
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    targetType: 'prompt_ir',
    targetId,
    storyboardRevisionId,
    frameId,
    basePromptIrId: parseIdentifier(input.basePromptIrId, 'basePromptIrId'),
    baseRevision: parsePromptIrVersion(input.baseRevision, 'baseRevision'),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
  }
}

function parseCommitPromptIrEditRequest(payload: unknown): YimengCommitPromptIrEditRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'changeSetId',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'storyboardRevisionId',
    'frameId',
    'basePromptIrId',
    'baseRevision',
    'baseSnapshotSha256',
    'idempotencyKey',
    'expectedPayloadSha256',
  ])
  const subject = parsePromptIrCommandSubject({
    changeSetId: input.changeSetId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    targetType: input.targetType,
    targetId: input.targetId,
    storyboardRevisionId: input.storyboardRevisionId,
    frameId: input.frameId,
    basePromptIrId: input.basePromptIrId,
    baseRevision: input.baseRevision,
    baseSnapshotSha256: input.baseSnapshotSha256,
  })
  return {
    ...subject,
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
    expectedPayloadSha256: parseInputSha256(input.expectedPayloadSha256, 'expectedPayloadSha256'),
  }
}

function parseRecoverPromptIrEditCommitRequest(
  payload: unknown,
): YimengRecoverPromptIrEditCommitRequest {
  return parseCommitPromptIrEditRequest(payload)
}

function parseSelectPromptIrInput(
  input: YimengCommandJsonObject,
): YimengSelectPromptIrRequest {
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
    draftPromptIrId: parseIdentifier(input.draftPromptIrId, 'draftPromptIrId'),
    draftVersion: parsePromptIrVersion(input.draftVersion, 'draftVersion'),
    draftContentSha256: parseInputSha256(input.draftContentSha256, 'draftContentSha256'),
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
  }
}

function parseSelectPromptIrRequest(payload: unknown): YimengSelectPromptIrRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'draftPromptIrId',
    'draftVersion',
    'draftContentSha256',
    'idempotencyKey',
  ])
  return parseSelectPromptIrInput(input)
}

function parseRecoverPromptIrSelectionRequest(
  payload: unknown,
): YimengRecoverPromptIrSelectionRequest {
  return parseSelectPromptIrRequest(payload)
}

function parseInputSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new InputError(`${field} must be sha256`)
  return value
}

function parseReviewIdempotencyKey(value: unknown): string {
  const idempotencyKey = parseIdentifier(value, 'idempotencyKey')
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new InputError('idempotencyKey must be between 8 and 200 characters')
  }
  if (/[\r\n]/.test(idempotencyKey)) {
    throw new InputError('idempotencyKey must not contain line breaks')
  }
  return idempotencyKey
}

function parseExpectedSubjectRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputError('expectedSubjectRevision must be a non-negative integer')
  }
  return value as number
}

function parseReviewText(value: unknown, field: 'body' | 'reason'): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8_000) {
    throw new InputError(`${field} must be between 1 and 8000 characters`)
  }
  return value
}

function parseHumanDecisionValue(value: unknown): YimengHumanDecisionValue {
  if (value !== 'approve' && value !== 'reject' && value !== 'request_changes') {
    throw new InputError('decision must be approve, reject, or request_changes')
  }
  return value
}

function parseCreateCommentRequest(payload: unknown): YimengCreateCommentRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'elementKind',
    'targetId',
    'expectedSubjectRevision',
    'expectedSubjectSha256',
    'body',
    'idempotencyKey',
  ])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind: parseElementKind(input.elementKind),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    expectedSubjectRevision: parseExpectedSubjectRevision(input.expectedSubjectRevision),
    expectedSubjectSha256: parseInputSha256(input.expectedSubjectSha256, 'expectedSubjectSha256'),
    body: parseReviewText(input.body, 'body'),
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
  }
}

function parseCreateHumanDecisionRequest(payload: unknown): YimengCreateHumanDecisionRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'elementKind',
    'targetId',
    'expectedSubjectRevision',
    'expectedSubjectSha256',
    'decision',
    'reason',
    'idempotencyKey',
  ])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind: parseElementKind(input.elementKind),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    expectedSubjectRevision: parseExpectedSubjectRevision(input.expectedSubjectRevision),
    expectedSubjectSha256: parseInputSha256(input.expectedSubjectSha256, 'expectedSubjectSha256'),
    decision: parseHumanDecisionValue(input.decision),
    reason: parseReviewText(input.reason, 'reason'),
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
  }
}

function parseReferenceRightsExceptionScope(value: unknown): YimengReferenceRightsExceptionScope {
  if (!isJsonObject(value)) throw new InputError('scope must be an object')
  assertOnlyInputKeys(value, [
    'kind', 'referenceAssetId', 'referenceAssetSha256', 'rightsRecordSha256', 'rightsFields',
  ])
  if (value.kind !== 'reference_rights') throw new InputError('scope.kind must be reference_rights')
  if (!Array.isArray(value.rightsFields) || value.rightsFields.length === 0) {
    throw new InputError('scope.rightsFields must be a non-empty array')
  }
  const rightsFields = value.rightsFields.map((item) => {
    if (typeof item !== 'string' || !RIGHTS_EXCEPTION_FIELD_SET.has(item as YimengReferenceRightsExceptionField)) {
      throw new InputError('scope.rightsFields contains an unknown field')
    }
    return item as YimengReferenceRightsExceptionField
  })
  if (new Set(rightsFields).size !== rightsFields.length) {
    throw new InputError('scope.rightsFields must not contain duplicates')
  }
  const canonical = RIGHTS_EXCEPTION_FIELDS.filter(field => rightsFields.includes(field))
  if (rightsFields.some((field, index) => field !== canonical[index])) {
    throw new InputError('scope.rightsFields must use canonical order')
  }
  return {
    kind: 'reference_rights',
    referenceAssetId: parseIdentifier(value.referenceAssetId, 'scope.referenceAssetId'),
    referenceAssetSha256: parseInputSha256(value.referenceAssetSha256, 'scope.referenceAssetSha256'),
    rightsRecordSha256: parseInputSha256(value.rightsRecordSha256, 'scope.rightsRecordSha256'),
    rightsFields,
  }
}

function parseCreateReferenceRightsExceptionReleaseRequest(
  payload: unknown,
): YimengCreateReferenceRightsExceptionReleaseRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'elementKind',
    'targetId',
    'expectedSubjectRevision',
    'expectedSubjectSha256',
    'idempotencyKey',
    'reason',
    'scope',
  ])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind: parseElementKind(input.elementKind),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    expectedSubjectRevision: parseExpectedSubjectRevision(input.expectedSubjectRevision),
    expectedSubjectSha256: parseInputSha256(input.expectedSubjectSha256, 'expectedSubjectSha256'),
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
    reason: parseReviewText(input.reason, 'reason'),
    scope: parseReferenceRightsExceptionScope(input.scope),
  }
}

function parseRecoverReferenceRightsExceptionReleaseRequest(
  payload: unknown,
): YimengRecoverReferenceRightsExceptionReleaseRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'elementKind',
    'targetId',
    'expectedSubjectRevision',
    'expectedSubjectSha256',
    'referenceAssetId',
    'referenceAssetSha256',
    'rightsRecordSha256',
    'reasonSha256',
    'scopeSha256',
    'idempotencyKey',
  ])
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind: parseElementKind(input.elementKind),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    expectedSubjectRevision: parseExpectedSubjectRevision(input.expectedSubjectRevision),
    expectedSubjectSha256: parseInputSha256(input.expectedSubjectSha256, 'expectedSubjectSha256'),
    referenceAssetId: parseIdentifier(input.referenceAssetId, 'referenceAssetId'),
    referenceAssetSha256: parseInputSha256(input.referenceAssetSha256, 'referenceAssetSha256'),
    rightsRecordSha256: parseInputSha256(input.rightsRecordSha256, 'rightsRecordSha256'),
    reasonSha256: parseInputSha256(input.reasonSha256, 'reasonSha256'),
    scopeSha256: parseInputSha256(input.scopeSha256, 'scopeSha256'),
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
  }
}

function parseMethodAttestation(value: unknown): YimengImagoElementMethodAttestation {
  if (!isJsonObject(value)) throw new InputError('methodAttestation must be an object')
  assertOnlyInputKeys(value, [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'subjectSha256',
    'signature',
  ])
  if (value.schema !== 'qingmu.imago-element-method-attestation.v1') {
    throw new InputError('methodAttestation.schema mismatch')
  }
  if (value.algorithm !== 'hmac-sha256') throw new InputError('methodAttestation.algorithm mismatch')
  return {
    schema: 'qingmu.imago-element-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: parseInputSha256(value.projectionSha256, 'methodAttestation.projectionSha256'),
    inputSnapshotSha256: parseInputSha256(value.inputSnapshotSha256, 'methodAttestation.inputSnapshotSha256'),
    subjectSha256: parseInputSha256(value.subjectSha256, 'methodAttestation.subjectSha256'),
    signature: parseInputSha256(value.signature, 'methodAttestation.signature'),
  }
}

function parseReferenceActionOperation(value: unknown, field = 'operation'): YimengReferenceActionOperation {
  if (value !== 'selectReferenceAsset' && value !== 'requestReferenceRegeneration') {
    throw new InputError(`${field} must be selectReferenceAsset or requestReferenceRegeneration`)
  }
  return value
}

function requireReferenceActionOperation(value: unknown, field: string): YimengReferenceActionOperation {
  if (value !== 'selectReferenceAsset' && value !== 'requestReferenceRegeneration') {
    throw new UpstreamContractError(`${field} must be selectReferenceAsset or requestReferenceRegeneration`)
  }
  return value
}

function parseReferenceMethodAttestation(value: unknown): YimengImagoReferenceAssetMethodAttestation {
  if (!isJsonObject(value)) throw new InputError('methodAttestation must be an object')
  assertOnlyInputKeys(value, [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'targetSha256',
    'signature',
  ])
  if (value.schema !== 'qingmu.imago-reference-asset-method-attestation.v1') {
    throw new InputError('methodAttestation.schema mismatch')
  }
  if (value.algorithm !== 'hmac-sha256') throw new InputError('methodAttestation.algorithm mismatch')
  return {
    schema: 'qingmu.imago-reference-asset-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: parseInputSha256(value.projectionSha256, 'methodAttestation.projectionSha256'),
    inputSnapshotSha256: parseInputSha256(value.inputSnapshotSha256, 'methodAttestation.inputSnapshotSha256'),
    targetSha256: parseInputSha256(value.targetSha256, 'methodAttestation.targetSha256'),
    signature: parseInputSha256(value.signature, 'methodAttestation.signature'),
  }
}

function parseReferenceProjectionObject(value: unknown, field: string): YimengCommandJsonObject {
  if (!isJsonObject(value)) throw new InputError(`${field} must be an object`)
  return value
}

function parseReferenceProjectionObjects(value: unknown, field: string): YimengCommandJsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) throw new InputError(`${field} must be an array of objects`)
  return value
}

function parseReferenceProjection(value: unknown): YimengImagoReferenceAssetMethodProjection {
  if (!isJsonObject(value)) throw new InputError('methodProjection must be an object')
  assertOnlyInputKeys(value, [
    'schema',
    'input_snapshot_sha256',
    'target',
    'method_definition',
    'source_bindings',
    'field_hints',
    'checklist',
    'work_order_projection',
    'review_card',
    'legal_work_set',
    'authority_snapshot_attestation',
    'project_state_persisted',
    'providerCalls',
    'workerStarted',
    'human_approval_inferred',
    'human_signoff_inferred',
    'selection_executed',
  ])
  if (value.schema !== 'qingmu.imago-reference-asset-method-projection.v1') {
    throw new InputError('methodProjection.schema mismatch')
  }
  if (!isJsonObject(value.target)) throw new InputError('methodProjection.target must be an object')
  assertOnlyInputKeys(value.target, [
    'projectId',
    'elementKind',
    'elementId',
    'profileRevision',
    'snapshotSha256',
    'assetId',
    'assetSha256',
    'operation',
  ])
  if (!Number.isSafeInteger(value.target.profileRevision) || (value.target.profileRevision as number) < 0) {
    throw new InputError('methodProjection.target.profileRevision must be a non-negative integer')
  }
  const target = {
    projectId: parseIdentifier(value.target.projectId, 'methodProjection.target.projectId'),
    elementKind: parseElementKind(value.target.elementKind),
    elementId: parseIdentifier(value.target.elementId, 'methodProjection.target.elementId'),
    profileRevision: value.target.profileRevision as number,
    snapshotSha256: parseInputSha256(value.target.snapshotSha256, 'methodProjection.target.snapshotSha256'),
    assetId: parseIdentifier(value.target.assetId, 'methodProjection.target.assetId'),
    assetSha256: parseInputSha256(value.target.assetSha256, 'methodProjection.target.assetSha256'),
    operation: parseReferenceActionOperation(value.target.operation, 'methodProjection.target.operation'),
  }
  if (
    value.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || value.project_state_persisted !== false
    || value.providerCalls !== 0
    || value.workerStarted !== false
    || value.human_approval_inferred !== false
    || value.human_signoff_inferred !== false
    || value.selection_executed !== false
  ) {
    throw new InputError('methodProjection authority or zero-execution boundary mismatch')
  }
  return {
    schema: 'qingmu.imago-reference-asset-method-projection.v1',
    input_snapshot_sha256: parseInputSha256(value.input_snapshot_sha256, 'methodProjection.input_snapshot_sha256'),
    target,
    method_definition: parseReferenceProjectionObject(value.method_definition, 'methodProjection.method_definition'),
    source_bindings: parseReferenceProjectionObjects(value.source_bindings, 'methodProjection.source_bindings'),
    field_hints: parseReferenceProjectionObjects(value.field_hints, 'methodProjection.field_hints'),
    checklist: parseReferenceProjectionObjects(value.checklist, 'methodProjection.checklist'),
    work_order_projection: parseReferenceProjectionObject(
      value.work_order_projection,
      'methodProjection.work_order_projection',
    ),
    review_card: parseReferenceProjectionObject(value.review_card, 'methodProjection.review_card'),
    legal_work_set: parseReferenceProjectionObject(value.legal_work_set, 'methodProjection.legal_work_set'),
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    providerCalls: 0,
    workerStarted: false,
    human_approval_inferred: false,
    human_signoff_inferred: false,
    selection_executed: false,
  }
}

function parseReferenceRightsProjection(value: unknown): YimengCommandJsonObject {
  if (!isJsonObject(value)) throw new InputError('methodProjection must be an object')
  assertOnlyInputKeys(value, [
    'schema',
    'input_snapshot_sha256',
    'subject',
    'method_definition',
    'source_bindings',
    'field_hints',
    'checklist',
    'work_order_projection',
    'review_card',
    'legal_work_set',
    'authority_snapshot_attestation',
    'project_state_persisted',
    'paid_provider_authority',
    'human_approval_inferred',
    'selection_authority',
  ])
  if (Object.keys(value).length !== 15 || value.schema !== 'qingmu.imago-element-method-projection.v1') {
    throw new InputError('methodProjection fields or schema mismatch')
  }
  const subject = requireExactRightsObject(value.subject, [
    'project_id',
    'target_type',
    'target_id',
    'element_kind',
    'scope_type',
    'scope_id',
    'base_revision',
    'base_snapshot_sha256',
  ], 'methodProjection.subject', message => new InputError(message))
  const methodDefinition = requireExactRightsObject(value.method_definition, [
    'id',
    'version',
    'sha256',
    'stage_contract_sha256',
    'role_capability_sha256',
    'agent_path',
    'skill_path',
  ], 'methodProjection.method_definition', message => new InputError(message))
  if (methodDefinition.id !== 'imago-v6-reference-rights-record' || methodDefinition.version !== 1) {
    throw new InputError('methodProjection.method_definition mismatch')
  }
  for (const key of ['sha256', 'stage_contract_sha256', 'role_capability_sha256'] as const) {
    parseInputSha256(methodDefinition[key], `methodProjection.method_definition.${key}`)
  }
  parseIdentifier(methodDefinition.agent_path, 'methodProjection.method_definition.agent_path')
  parseIdentifier(methodDefinition.skill_path, 'methodProjection.method_definition.skill_path')
  const sourceBindings = parseReferenceProjectionObjects(value.source_bindings, 'methodProjection.source_bindings')
  const expectedSourceKinds = new Set([
    'runtime_pointer',
    'runtime_channel_registry',
    'stage_contracts',
    'role_capability_spec',
    'role_agent',
    'role_method',
    'method_reference',
  ])
  if (
    sourceBindings.length !== expectedSourceKinds.size
    || sourceBindings.some(binding => !expectedSourceKinds.has(binding.kind as string))
    || new Set(sourceBindings.map(binding => binding.kind)).size !== expectedSourceKinds.size
  ) {
    throw new InputError('methodProjection.source_bindings mismatch')
  }
  const workOrder = requireExactRightsObject(value.work_order_projection, [
    'target',
    'operation',
    'allowed_mutations',
    'required_read_set',
    'before_write',
    'after_write',
  ], 'methodProjection.work_order_projection', message => new InputError(message))
  if (
    workOrder.operation !== 'replaceReferenceRights'
    || !Array.isArray(workOrder.allowed_mutations)
    || workOrder.allowed_mutations.length !== 1
    || workOrder.allowed_mutations[0] !== 'replaceReferenceRights'
  ) {
    throw new InputError('methodProjection.work_order_projection operation mismatch')
  }
  const legalWorkSet = requireExactRightsObject(value.legal_work_set, [
    'reads', 'writes', 'invalidates', 'forbidden',
  ], 'methodProjection.legal_work_set', message => new InputError(message))
  const exactList = (actual: unknown, expected: readonly string[]): boolean =>
    Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index])
  if (
    !exactList(legalWorkSet.reads, ['yimeng_element_reference_rights_snapshot'])
    || !exactList(legalWorkSet.writes, ['replace_reference_rights_via_changeset'])
    || !exactList(legalWorkSet.invalidates, ['reference_rights_dependent_projection'])
    || !exactList(legalWorkSet.forbidden, [
      'provider_dispatch',
      'asset_generation',
      'asset_selection',
      'human_decision',
      'project_state_write',
    ])
  ) {
    throw new InputError('methodProjection.legal_work_set mismatch')
  }
  if (
    value.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || value.project_state_persisted !== false
    || value.paid_provider_authority !== 'not_granted'
    || value.human_approval_inferred !== false
    || value.selection_authority !== 'not_granted'
  ) {
    throw new InputError('methodProjection authority boundary mismatch')
  }
  return {
    schema: 'qingmu.imago-element-method-projection.v1',
    input_snapshot_sha256: parseInputSha256(
      value.input_snapshot_sha256,
      'methodProjection.input_snapshot_sha256',
    ),
    subject,
    method_definition: methodDefinition,
    source_bindings: sourceBindings,
    field_hints: parseReferenceProjectionObjects(value.field_hints, 'methodProjection.field_hints'),
    checklist: parseReferenceProjectionObjects(value.checklist, 'methodProjection.checklist'),
    work_order_projection: workOrder,
    review_card: parseReferenceProjectionObject(value.review_card, 'methodProjection.review_card'),
    legal_work_set: legalWorkSet,
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    paid_provider_authority: 'not_granted',
    human_approval_inferred: false,
    selection_authority: 'not_granted',
  }
}

function readReferenceAttestationKey(): string {
  const key = process.env.QINGMU_IMAGO_ATTESTATION_KEY
  if (key === undefined || key === '' || Buffer.byteLength(key, 'utf8') < 32) throw new AttestationKeyError()
  return key
}

function verifyReferenceMethodProof(
  request: {
    readonly projectId: string
    readonly targetType: 'element_profile'
    readonly targetId: string
    readonly elementKind: YimengElementKind
    readonly operation: YimengReferenceActionOperation
    readonly candidateAssetId: string
    readonly candidateAssetSha256: string
    readonly baseRevision: number
    readonly baseSnapshotSha256: string
    readonly methodProjectionSha256: string
  },
  methodProjection: YimengImagoReferenceAssetMethodProjection,
  methodAttestation: YimengImagoReferenceAssetMethodAttestation,
): void {
  const key = readReferenceAttestationKey()
  const unsigned = {
    schema: methodAttestation.schema,
    algorithm: methodAttestation.algorithm,
    projectionSha256: methodAttestation.projectionSha256,
    inputSnapshotSha256: methodAttestation.inputSnapshotSha256,
    targetSha256: methodAttestation.targetSha256,
  } as const
  const expectedSignature = createHmac('sha256', key)
    .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
    .digest()
  const receivedSignature = Buffer.from(methodAttestation.signature, 'hex')
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
    throw new InputError('methodAttestation signature mismatch')
  }

  const target = {
    projectId: request.projectId,
    elementKind: request.elementKind,
    elementId: request.targetId,
    profileRevision: request.baseRevision,
    snapshotSha256: request.baseSnapshotSha256,
    assetId: request.candidateAssetId,
    assetSha256: request.candidateAssetSha256,
    operation: request.operation,
  } as const
  const snapshot = {
    schema: 'qingmu.reference-asset-method-snapshot.v1',
    target,
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  } as const
  const projectionSha256 = inputCanonicalSha256(methodProjection, 'methodProjection')
  const inputSnapshotSha256 = inputCanonicalSha256(snapshot, 'methodSnapshot')
  const targetSha256 = inputCanonicalSha256(target, 'methodSnapshot.target')
  if (request.methodProjectionSha256 !== projectionSha256 || methodAttestation.projectionSha256 !== projectionSha256) {
    throw new InputError('method projection sha256 binding mismatch')
  }
  if (
    methodProjection.input_snapshot_sha256 !== inputSnapshotSha256
    || methodAttestation.inputSnapshotSha256 !== inputSnapshotSha256
  ) {
    throw new InputError('method input snapshot binding mismatch')
  }
  if (
    methodAttestation.targetSha256 !== targetSha256
    || inputCanonicalSha256(methodProjection.target, 'methodProjection.target') !== targetSha256
  ) {
    throw new InputError('method target binding mismatch')
  }
}

function verifyReferenceRightsMethodProof(
  request: {
    readonly projectId: string
    readonly targetType: 'element_profile'
    readonly targetId: string
    readonly elementKind: YimengElementKind
    readonly operation: 'replaceReferenceRights'
    readonly referenceAssetId: string
    readonly referenceAssetSha256: string
    readonly rights: YimengReferenceRightsRecord
    readonly baseRevision: number
    readonly baseSnapshotSha256: string
    readonly methodProjectionSha256: string
  },
  methodProjection: YimengCommandJsonObject,
  methodAttestation: YimengImagoElementMethodAttestation,
): void {
  const key = readReferenceAttestationKey()
  const unsigned = {
    schema: methodAttestation.schema,
    algorithm: methodAttestation.algorithm,
    projectionSha256: methodAttestation.projectionSha256,
    inputSnapshotSha256: methodAttestation.inputSnapshotSha256,
    subjectSha256: methodAttestation.subjectSha256,
  } as const
  const expectedSignature = createHmac('sha256', key)
    .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
    .digest()
  const receivedSignature = Buffer.from(methodAttestation.signature, 'hex')
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
    throw new InputError('methodAttestation signature mismatch')
  }

  const subject = {
    project_id: request.projectId,
    target_type: 'element_profile',
    target_id: request.targetId,
    element_kind: request.elementKind,
    scope_type: 'project',
    scope_id: request.projectId,
    base_revision: request.baseRevision,
    base_snapshot_sha256: request.baseSnapshotSha256,
  } as const
  const snapshot = {
    schema: 'qingmu.element-method-snapshot.v1',
    subject,
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  } as const
  const projectionSha256 = inputCanonicalSha256(methodProjection, 'methodProjection')
  const inputSnapshotSha256 = inputCanonicalSha256(snapshot, 'methodSnapshot')
  const subjectSha256 = inputCanonicalSha256(subject, 'methodSnapshot.subject')
  if (request.methodProjectionSha256 !== projectionSha256 || methodAttestation.projectionSha256 !== projectionSha256) {
    throw new InputError('method projection sha256 binding mismatch')
  }
  if (
    methodProjection.input_snapshot_sha256 !== inputSnapshotSha256
    || methodAttestation.inputSnapshotSha256 !== inputSnapshotSha256
  ) {
    throw new InputError('method input snapshot binding mismatch')
  }
  if (
    methodAttestation.subjectSha256 !== subjectSha256
    || inputCanonicalSha256(methodProjection.subject, 'methodProjection.subject') !== subjectSha256
  ) {
    throw new InputError('method subject binding mismatch')
  }
}

function parseHeroFrameStoryboardMethodAttestation(
  value: unknown,
): YimengImagoHeroFrameStoryboardMethodAttestation {
  const item = requireExactRightsObject(value, [
    'schema',
    'algorithm',
    'projectionSha256',
    'inputSnapshotSha256',
    'targetSha256',
    'relationSnapshotSha256',
    'selectedShotSha256',
    'heroFrameBindingSha256',
    'rawAnnotationsSha256',
    'compiledResultSha256',
    'signature',
  ], 'methodAttestation', message => new InputError(message))
  if (item.schema !== 'qingmu.imago-hero-frame-storyboard-method-attestation.v1') {
    throw new InputError('methodAttestation.schema mismatch')
  }
  if (item.algorithm !== 'hmac-sha256') throw new InputError('methodAttestation.algorithm mismatch')
  return {
    schema: 'qingmu.imago-hero-frame-storyboard-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: parseInputSha256(item.projectionSha256, 'methodAttestation.projectionSha256'),
    inputSnapshotSha256: parseInputSha256(item.inputSnapshotSha256, 'methodAttestation.inputSnapshotSha256'),
    targetSha256: parseInputSha256(item.targetSha256, 'methodAttestation.targetSha256'),
    relationSnapshotSha256: parseInputSha256(
      item.relationSnapshotSha256,
      'methodAttestation.relationSnapshotSha256',
    ),
    selectedShotSha256: parseInputSha256(item.selectedShotSha256, 'methodAttestation.selectedShotSha256'),
    heroFrameBindingSha256: parseInputSha256(
      item.heroFrameBindingSha256,
      'methodAttestation.heroFrameBindingSha256',
    ),
    rawAnnotationsSha256: parseInputSha256(item.rawAnnotationsSha256, 'methodAttestation.rawAnnotationsSha256'),
    compiledResultSha256: parseInputSha256(
      item.compiledResultSha256,
      'methodAttestation.compiledResultSha256',
    ),
    signature: parseInputSha256(item.signature, 'methodAttestation.signature'),
  }
}

function parseHeroFrameStoryboardMethodProjection(
  value: unknown,
): YimengImagoHeroFrameStoryboardMethodProjection {
  const root = requireExactRightsObject(value, [
    'schema',
    'input_snapshot_sha256',
    'target',
    'canvas_projection',
    'method_definition',
    'source_bindings',
    'field_hints',
    'checklist',
    'work_order_projection',
    'review_card',
    'legal_work_set',
    'authority_snapshot_attestation',
    'project_state_persisted',
    'providerCalls',
    'workerStarted',
    'selection_executed',
    'human_approval_inferred',
    'human_signoff_inferred',
  ], 'methodProjection', message => new InputError(message))
  if (root.schema !== 'qingmu.imago-hero-frame-storyboard-method-projection.v1') {
    throw new InputError('methodProjection.schema mismatch')
  }
  const targetValue = requireExactRightsObject(root.target, [
    'projectId',
    'episodeId',
    'episodeRevision',
    'storyboardRevisionId',
    'storyboardRevisionVersion',
    'storyboardSourceSha256',
    'relationSnapshotSha256',
    'selectedShotId',
    'selectedShotSnapshotSha256',
  ], 'methodProjection.target', message => new InputError(message))
  const target = {
    projectId: parseIdentifier(targetValue.projectId, 'methodProjection.target.projectId'),
    episodeId: parseIdentifier(targetValue.episodeId, 'methodProjection.target.episodeId'),
    episodeRevision: parsePromptIrVersion(targetValue.episodeRevision, 'methodProjection.target.episodeRevision'),
    storyboardRevisionId: parseIdentifier(
      targetValue.storyboardRevisionId,
      'methodProjection.target.storyboardRevisionId',
    ),
    storyboardRevisionVersion: parsePromptIrVersion(
      targetValue.storyboardRevisionVersion,
      'methodProjection.target.storyboardRevisionVersion',
    ),
    storyboardSourceSha256: parseInputSha256(
      targetValue.storyboardSourceSha256,
      'methodProjection.target.storyboardSourceSha256',
    ),
    relationSnapshotSha256: parseInputSha256(
      targetValue.relationSnapshotSha256,
      'methodProjection.target.relationSnapshotSha256',
    ),
    selectedShotId: parseIdentifier(targetValue.selectedShotId, 'methodProjection.target.selectedShotId'),
    selectedShotSnapshotSha256: parseInputSha256(
      targetValue.selectedShotSnapshotSha256,
      'methodProjection.target.selectedShotSnapshotSha256',
    ),
  }
  const canvasValue = requireExactRightsObject(root.canvas_projection, [
    'canonicalShotIdSource',
    'shotId',
    'selectedShot',
    'heroFrame',
    'baseCanvasSha256',
    'rawAnnotations',
    'rawAnnotationsSha256',
    'compiledResult',
    'compiledResultSha256',
  ], 'methodProjection.canvas_projection', message => new InputError(message))
  if (canvasValue.canonicalShotIdSource !== 'yimeng_storyboard_frame_id') {
    throw new InputError('methodProjection canvas Shot identity source mismatch')
  }
  const shotId = parseIdentifier(canvasValue.shotId, 'methodProjection.canvas_projection.shotId')
  const selectedShot = requireExactRightsObject(canvasValue.selectedShot, [
    'shotId', 'sceneId', 'elementIds', 'beats',
  ], 'methodProjection.canvas_projection.selectedShot', message => new InputError(message))
  if (selectedShot.shotId !== shotId) throw new InputError('methodProjection selected Shot identity mismatch')
  const heroValue = requireExactRightsObject(canvasValue.heroFrame, [
    'assetId', 'mediaSha256', 'bindingSha256',
  ], 'methodProjection.canvas_projection.heroFrame', message => new InputError(message))
  const heroFrame = {
    assetId: parseIdentifier(heroValue.assetId, 'methodProjection.canvas_projection.heroFrame.assetId'),
    mediaSha256: parseInputSha256(
      heroValue.mediaSha256,
      'methodProjection.canvas_projection.heroFrame.mediaSha256',
    ),
    bindingSha256: parseInputSha256(
      heroValue.bindingSha256,
      'methodProjection.canvas_projection.heroFrame.bindingSha256',
    ),
  }
  if (canvasValue.baseCanvasSha256 !== null && typeof canvasValue.baseCanvasSha256 !== 'string') {
    throw new InputError('methodProjection.canvas_projection.baseCanvasSha256 must be null or sha256')
  }
  const baseCanvasSha256 = canvasValue.baseCanvasSha256 === null
    ? null
    : parseInputSha256(canvasValue.baseCanvasSha256, 'methodProjection.canvas_projection.baseCanvasSha256')
  const rawAnnotations = parseReferenceProjectionObjects(
    canvasValue.rawAnnotations,
    'methodProjection.canvas_projection.rawAnnotations',
  )
  const compiledResult = requireExactRightsObject(canvasValue.compiledResult, [
    'subjectLayout', 'objectAnchors', 'actionTrajectory',
  ], 'methodProjection.canvas_projection.compiledResult', message => new InputError(message))
  for (const field of ['subjectLayout', 'objectAnchors', 'actionTrajectory'] as const) {
    parseReferenceProjectionObjects(
      compiledResult[field],
      `methodProjection.canvas_projection.compiledResult.${field}`,
    )
  }
  const rawAnnotationsSha256 = parseInputSha256(
    canvasValue.rawAnnotationsSha256,
    'methodProjection.canvas_projection.rawAnnotationsSha256',
  )
  const compiledResultSha256 = parseInputSha256(
    canvasValue.compiledResultSha256,
    'methodProjection.canvas_projection.compiledResultSha256',
  )
  if (compiledResultSha256 !== inputCanonicalSha256(compiledResult, 'methodProjection.canvas_projection.compiledResult')) {
    throw new InputError('methodProjection compiled result sha256 mismatch')
  }

  const methodDefinition = requireExactRightsObject(root.method_definition, [
    'id', 'version', 'sha256', 'stage_contract_sha256', 'role_capability_sha256', 'agent_paths', 'skill_paths',
  ], 'methodProjection.method_definition', message => new InputError(message))
  if (methodDefinition.id !== 'imago-v6-c-c5-hero-frame-storyboard-canvas' || methodDefinition.version !== 1) {
    throw new InputError('methodProjection.method_definition mismatch')
  }
  const sourceBindings = parseReferenceProjectionObjects(root.source_bindings, 'methodProjection.source_bindings')
  const fieldHints = parseReferenceProjectionObjects(root.field_hints, 'methodProjection.field_hints')
  const checklist = parseReferenceProjectionObjects(root.checklist, 'methodProjection.checklist')
  const workOrder = requireExactRightsObject(root.work_order_projection, [
    'target', 'operation', 'allowed_mutations', 'required_read_set', 'before_compile', 'after_compile',
    'providerCalls', 'workerStarted',
  ], 'methodProjection.work_order_projection', message => new InputError(message))
  const exactList = (actual: unknown, expected: readonly string[]): boolean => (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((item, index) => item === expected[index])
  )
  if (
    inputCanonicalSha256(workOrder.target, 'methodProjection.work_order_projection.target')
      !== inputCanonicalSha256(target, 'methodProjection.target')
    || workOrder.operation !== 'compileHeroFrameStoryboardCanvas'
    || !exactList(workOrder.allowed_mutations, ['replaceStoryboardCanvas'])
    || workOrder.providerCalls !== 0
    || workOrder.workerStarted !== false
  ) {
    throw new InputError('methodProjection work order mismatch')
  }
  const reviewCard = parseReferenceProjectionObject(root.review_card, 'methodProjection.review_card')
  const legalWorkSet = requireExactRightsObject(root.legal_work_set, [
    'reads', 'writes', 'forbidden',
  ], 'methodProjection.legal_work_set', message => new InputError(message))
  if (
    !exactList(legalWorkSet.reads, ['yimeng_hero_frame_storyboard_canvas_snapshot'])
    || !exactList(legalWorkSet.writes, ['replace_storyboard_canvas_via_changeset'])
    || !exactList(legalWorkSet.forbidden, [
      'direct_project_state_write',
      'direct_database_write',
      'second_shot_identity_create',
      'imago_canvas_state_persist',
      'provider_dispatch',
      'asset_generation',
      'asset_selection',
      'human_approval',
      'human_signoff',
    ])
  ) {
    throw new InputError('methodProjection legal work set mismatch')
  }
  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || root.project_state_persisted !== false
    || root.providerCalls !== 0
    || root.workerStarted !== false
    || root.selection_executed !== false
    || root.human_approval_inferred !== false
    || root.human_signoff_inferred !== false
  ) {
    throw new InputError('methodProjection authority or execution boundary mismatch')
  }
  return {
    schema: 'qingmu.imago-hero-frame-storyboard-method-projection.v1',
    input_snapshot_sha256: parseInputSha256(
      root.input_snapshot_sha256,
      'methodProjection.input_snapshot_sha256',
    ),
    target,
    canvas_projection: {
      canonicalShotIdSource: 'yimeng_storyboard_frame_id',
      shotId,
      selectedShot,
      heroFrame,
      baseCanvasSha256,
      rawAnnotations,
      rawAnnotationsSha256,
      compiledResult,
      compiledResultSha256,
    },
    method_definition: methodDefinition,
    source_bindings: sourceBindings,
    field_hints: fieldHints,
    checklist,
    work_order_projection: workOrder,
    review_card: reviewCard,
    legal_work_set: legalWorkSet,
    authority_snapshot_attestation: 'not_verified_by_compiler',
    project_state_persisted: false,
    providerCalls: 0,
    workerStarted: false,
    selection_executed: false,
    human_approval_inferred: false,
    human_signoff_inferred: false,
  }
}

function verifyHeroFrameStoryboardMethodProof(
  request: Omit<YimengProposeStoryboardCanvasRequest, 'methodProjection' | 'methodAttestation'>,
  projection: YimengImagoHeroFrameStoryboardMethodProjection,
  attestation: YimengImagoHeroFrameStoryboardMethodAttestation,
): void {
  const unsigned = {
    schema: attestation.schema,
    algorithm: attestation.algorithm,
    projectionSha256: attestation.projectionSha256,
    inputSnapshotSha256: attestation.inputSnapshotSha256,
    targetSha256: attestation.targetSha256,
    relationSnapshotSha256: attestation.relationSnapshotSha256,
    selectedShotSha256: attestation.selectedShotSha256,
    heroFrameBindingSha256: attestation.heroFrameBindingSha256,
    rawAnnotationsSha256: attestation.rawAnnotationsSha256,
    compiledResultSha256: attestation.compiledResultSha256,
  } as const
  const expectedSignature = createHmac('sha256', readReferenceAttestationKey())
    .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
    .digest()
  const receivedSignature = Buffer.from(attestation.signature, 'hex')
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
    throw new InputError('methodAttestation signature mismatch')
  }
  const target = projection.target
  const canvas = projection.canvas_projection
  if (
    target.projectId !== request.projectId
    || target.episodeId !== request.episodeId
    || target.storyboardRevisionId !== request.storyboardRevisionId
    || target.storyboardRevisionVersion !== request.baseRevision
    || target.selectedShotId !== request.frameId
    || canvas.shotId !== request.frameId
    || canvas.heroFrame.assetId !== request.heroFrameAssetId
    || canvas.heroFrame.mediaSha256 !== request.heroFrameMediaSha256
  ) {
    throw new InputError('method projection Storyboard Canvas subject mismatch')
  }
  const simpleHeroBindingSha256 = inputCanonicalSha256({
    assetId: request.heroFrameAssetId,
    mediaSha256: request.heroFrameMediaSha256,
    shotId: request.frameId,
  }, 'heroFrameBinding')
  if (request.heroFrameBindingSha256 !== simpleHeroBindingSha256) {
    throw new InputError('heroFrameBindingSha256 mismatch')
  }
  const richHeroBindingSha256 = inputCanonicalSha256({
    schema: 'jason.qingmu-hero-frame-binding.v1',
    projectId: target.projectId,
    episodeId: target.episodeId,
    episodeRevision: target.episodeRevision,
    storyboardRevisionId: target.storyboardRevisionId,
    storyboardRevisionVersion: target.storyboardRevisionVersion,
    storyboardSourceSha256: target.storyboardSourceSha256,
    relationSnapshotSha256: target.relationSnapshotSha256,
    selectedShotId: target.selectedShotId,
    selectedShotSnapshotSha256: target.selectedShotSnapshotSha256,
    assetId: canvas.heroFrame.assetId,
    mediaSha256: canvas.heroFrame.mediaSha256,
  }, 'heroFrameBindingSubject')
  const rawAnnotationsSha256 = inputCanonicalSha256({
    schema: 'jason.qingmu-storyboard-raw-annotations.v1',
    projectId: target.projectId,
    episodeId: target.episodeId,
    storyboardRevisionId: target.storyboardRevisionId,
    storyboardRevisionVersion: target.storyboardRevisionVersion,
    selectedShotId: target.selectedShotId,
    selectedShotSnapshotSha256: target.selectedShotSnapshotSha256,
    heroFrameBindingSha256: richHeroBindingSha256,
    annotations: canvas.rawAnnotations,
  }, 'rawAnnotationsSubject')
  const projectionSha256 = inputCanonicalSha256(projection, 'methodProjection')
  const targetSha256 = inputCanonicalSha256(target, 'methodProjection.target')
  const selectedShotSha256 = inputCanonicalSha256(canvas.selectedShot, 'methodProjection.canvas_projection.selectedShot')
  if (
    request.methodProjectionSha256 !== projectionSha256
    || attestation.projectionSha256 !== projectionSha256
    || projection.input_snapshot_sha256 !== attestation.inputSnapshotSha256
    || attestation.targetSha256 !== targetSha256
    || attestation.relationSnapshotSha256 !== target.relationSnapshotSha256
    || attestation.selectedShotSha256 !== selectedShotSha256
    || target.selectedShotSnapshotSha256 !== selectedShotSha256
    || canvas.heroFrame.bindingSha256 !== richHeroBindingSha256
    || attestation.heroFrameBindingSha256 !== richHeroBindingSha256
    || canvas.rawAnnotationsSha256 !== rawAnnotationsSha256
    || attestation.rawAnnotationsSha256 !== rawAnnotationsSha256
    || attestation.compiledResultSha256 !== canvas.compiledResultSha256
  ) {
    throw new InputError('method projection or attestation lineage mismatch')
  }
}

function parseProposeStoryboardCanvasRequest(payload: unknown): YimengProposeStoryboardCanvasRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'operation',
    'baseRevision',
    'baseSnapshotSha256',
    'heroFrameAssetId',
    'heroFrameMediaSha256',
    'heroFrameBindingSha256',
    'methodProjection',
    'methodProjectionSha256',
    'methodAttestation',
    'harnessSessionId',
  ])
  if (input.operation !== 'replaceStoryboardCanvas') {
    throw new InputError('operation must be replaceStoryboardCanvas')
  }
  const requestBase = {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
    operation: 'replaceStoryboardCanvas' as const,
    baseRevision: parseRevision(input.baseRevision),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
    heroFrameAssetId: parseIdentifier(input.heroFrameAssetId, 'heroFrameAssetId'),
    heroFrameMediaSha256: parseInputSha256(input.heroFrameMediaSha256, 'heroFrameMediaSha256'),
    heroFrameBindingSha256: parseInputSha256(input.heroFrameBindingSha256, 'heroFrameBindingSha256'),
    methodProjectionSha256: parseInputSha256(input.methodProjectionSha256, 'methodProjectionSha256'),
    ...(() => {
      const harnessSessionId = parseOptionalHarnessSessionId(input.harnessSessionId)
      return harnessSessionId === undefined ? {} : { harnessSessionId }
    })(),
  }
  const methodProjection = parseHeroFrameStoryboardMethodProjection(input.methodProjection)
  const methodAttestation = parseHeroFrameStoryboardMethodAttestation(input.methodAttestation)
  verifyHeroFrameStoryboardMethodProof(requestBase, methodProjection, methodAttestation)
  return { ...requestBase, methodProjection, methodAttestation }
}

function parseStoryboardCanvasCommandSubject(
  payload: unknown,
): YimengPreviewStoryboardCanvasRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'targetType',
    'targetId',
    'changeSetId',
    'baseRevision',
    'baseSnapshotSha256',
  ])
  if (input.targetType !== 'storyboard_frame') {
    throw new InputError('targetType must be storyboard_frame')
  }
  const frameId = parseIdentifier(input.frameId, 'frameId')
  const targetId = parseIdentifier(input.targetId, 'targetId')
  if (targetId !== frameId) throw new InputError('targetId must equal frameId')
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId,
    targetType: 'storyboard_frame',
    targetId,
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    baseRevision: parseRevision(input.baseRevision),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
  }
}

function parseCommitStoryboardCanvasRequest(
  payload: unknown,
): YimengCommitStoryboardCanvasRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'targetType',
    'targetId',
    'changeSetId',
    'baseRevision',
    'baseSnapshotSha256',
    'idempotencyKey',
    'expectedPayloadSha256',
  ])
  const subject = parseStoryboardCanvasCommandSubject({
    projectId: input.projectId,
    episodeId: input.episodeId,
    storyboardRevisionId: input.storyboardRevisionId,
    frameId: input.frameId,
    targetType: input.targetType,
    targetId: input.targetId,
    changeSetId: input.changeSetId,
    baseRevision: input.baseRevision,
    baseSnapshotSha256: input.baseSnapshotSha256,
  })
  return {
    ...subject,
    idempotencyKey: parseReviewIdempotencyKey(input.idempotencyKey),
    expectedPayloadSha256: parseInputSha256(input.expectedPayloadSha256, 'expectedPayloadSha256'),
  }
}

function parseRecoverStoryboardCanvasCommitRequest(
  payload: unknown,
): YimengRecoverStoryboardCanvasCommitRequest {
  return parseCommitStoryboardCanvasRequest(payload)
}

function inputCanonicalSha256(value: unknown, field: string): string {
  try {
    return canonicalJsonSha256(value, field)
  } catch {
    throw new InputError(`${field} must be canonical JSON`)
  }
}

function parseElementKind(value: unknown): YimengElementKind {
  const elementKind = parseIdentifier(value, 'elementKind')
  if (elementKind !== 'actor' && elementKind !== 'scene' && elementKind !== 'prop') {
    throw new InputError('elementKind must be actor, scene, or prop')
  }
  return elementKind
}

function parseElementTargetType(value: unknown): 'element_profile' {
  if (value !== 'element_profile') throw new InputError('targetType must be element_profile')
  return value
}

function expectedElementOperation(elementKind: YimengElementKind): YimengElementProfileOperation {
  return elementKind === 'actor' ? 'replaceVisualIdentity' : 'replaceVisualPrompt'
}

function parseElementOperation(
  value: unknown,
  elementKind: YimengElementKind,
): YimengElementProfileOperation {
  const expected = expectedElementOperation(elementKind)
  if (value !== expected) throw new InputError(`operation must be ${expected} for ${elementKind}`)
  return expected
}

function parseElementReferences(value: unknown): YimengCommandJsonObject[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new InputError('references must be an array of objects')
  }
  if (value.length > 100) throw new InputError('references must not exceed 100 items')
  return value
}

function parseElementSubjectRequest(
  input: YimengCommandJsonObject,
): Omit<YimengPreviewElementProfileRequest, 'changeSetId'> {
  if (input.episodeId !== null) throw new InputError('episodeId must be null')
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    targetType: parseElementTargetType(input.targetType),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    elementKind: parseElementKind(input.elementKind),
    episodeId: null,
    baseRevision: parseRevision(input.baseRevision),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
  }
}

function parseProposeElementProfileRequest(payload: unknown): YimengProposeElementProfileRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'visualIdentity',
    'visualPrompt',
    'baseRevision',
    'baseSnapshotSha256',
    'methodProjection',
    'methodProjectionSha256',
    'methodAttestation',
    'harnessSessionId',
    'references',
  ])
  const projectId = parseIdentifier(input.projectId, 'projectId')
  const targetType = parseElementTargetType(input.targetType)
  const targetId = parseIdentifier(input.targetId, 'targetId')
  const elementKind = parseElementKind(input.elementKind)
  parseElementOperation(input.operation, elementKind)
  const baseRevision = parseRevision(input.baseRevision)
  const baseSnapshotSha256 = parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256')
  const visualField = elementKind === 'actor' ? 'visualIdentity' : 'visualPrompt'
  const forbiddenVisualField = elementKind === 'actor' ? 'visualPrompt' : 'visualIdentity'
  const visualValue = input[visualField]
  if (typeof visualValue !== 'string' || visualValue.trim().length === 0 || visualValue.length > 5_000) {
    throw new InputError(`${visualField} must be between 1 and 5000 characters`)
  }
  if (input[forbiddenVisualField] !== undefined) {
    throw new InputError(`${forbiddenVisualField} is not valid for ${elementKind}`)
  }
  if (!isJsonObject(input.methodProjection)) throw new InputError('methodProjection must be an object')
  const methodProjectionSha256 = parseInputSha256(input.methodProjectionSha256, 'methodProjectionSha256')
  if (inputCanonicalSha256(input.methodProjection, 'methodProjection') !== methodProjectionSha256) {
    throw new InputError('methodProjectionSha256 does not match methodProjection')
  }
  const methodAttestation = parseMethodAttestation(input.methodAttestation)
  if (methodAttestation.projectionSha256 !== methodProjectionSha256) {
    throw new InputError('methodAttestation projection binding mismatch')
  }
  const projectionInputSha256 = parseInputSha256(
    input.methodProjection.input_snapshot_sha256,
    'methodProjection.input_snapshot_sha256',
  )
  if (methodAttestation.inputSnapshotSha256 !== projectionInputSha256) {
    throw new InputError('methodAttestation input snapshot binding mismatch')
  }
  if (!isJsonObject(input.methodProjection.subject)) throw new InputError('methodProjection.subject must be an object')
  if (methodAttestation.subjectSha256 !== inputCanonicalSha256(input.methodProjection.subject, 'methodProjection.subject')) {
    throw new InputError('methodAttestation subject binding mismatch')
  }
  const methodSubject = input.methodProjection.subject
  if (
    methodSubject.project_id !== projectId
    || methodSubject.target_type !== targetType
    || methodSubject.target_id !== targetId
    || methodSubject.element_kind !== elementKind
    || methodSubject.scope_type !== 'project'
    || methodSubject.scope_id !== projectId
    || methodSubject.base_revision !== baseRevision
    || methodSubject.base_snapshot_sha256 !== baseSnapshotSha256
  ) {
    throw new InputError('methodProjection.subject does not match the element profile request')
  }
  let harnessSessionId: string | undefined
  if (input.harnessSessionId !== undefined) {
    harnessSessionId = parseIdentifier(input.harnessSessionId, 'harnessSessionId')
    if (harnessSessionId.length > 200) throw new InputError('harnessSessionId must not exceed 200 characters')
  }
  const references = parseElementReferences(input.references)
  const common = {
    projectId,
    targetType,
    targetId,
    baseRevision,
    baseSnapshotSha256,
    methodProjection: input.methodProjection,
    methodProjectionSha256,
    methodAttestation,
    ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
    ...(references === undefined ? {} : { references }),
  }
  return elementKind === 'actor'
    ? { ...common, elementKind, operation: 'replaceVisualIdentity', visualIdentity: visualValue }
    : { ...common, elementKind, operation: 'replaceVisualPrompt', visualPrompt: visualValue }
}

function parseProposeReferenceAssetRequest(payload: unknown): YimengProposeReferenceAssetRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'candidateAssetId',
    'candidateAssetSha256',
    'referenceAssetId',
    'referenceAssetSha256',
    'rights',
    'baseRevision',
    'baseSnapshotSha256',
    'repairPrompt',
    'harnessSessionId',
    'methodProjection',
    'methodProjectionSha256',
    'methodAttestation',
  ])
  const common = {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    targetType: parseElementTargetType(input.targetType),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    elementKind: parseElementKind(input.elementKind),
    baseRevision: parseRevision(input.baseRevision),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
    methodProjectionSha256: parseInputSha256(input.methodProjectionSha256, 'methodProjectionSha256'),
  } as const
  let harnessSessionId: string | undefined
  if (input.harnessSessionId !== undefined) {
    harnessSessionId = parseIdentifier(input.harnessSessionId, 'harnessSessionId')
    if (harnessSessionId.length > 200) throw new InputError('harnessSessionId must not exceed 200 characters')
  }
  if (input.operation === 'replaceReferenceRights') {
    if (
      input.candidateAssetId !== undefined
      || input.candidateAssetSha256 !== undefined
      || input.repairPrompt !== undefined
    ) {
      throw new InputError('selection candidate fields are not valid for replaceReferenceRights')
    }
    const requestWithoutProof = {
      ...common,
      operation: 'replaceReferenceRights',
      referenceAssetId: parseIdentifier(input.referenceAssetId, 'referenceAssetId'),
      referenceAssetSha256: parseInputSha256(input.referenceAssetSha256, 'referenceAssetSha256'),
      rights: normalizeReferenceRightsRecord(input.rights),
      ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
    } as const
    const methodProjection = parseReferenceRightsProjection(input.methodProjection)
    const methodAttestation = parseMethodAttestation(input.methodAttestation)
    verifyReferenceRightsMethodProof(requestWithoutProof, methodProjection, methodAttestation)
    return { ...requestWithoutProof, methodProjection, methodAttestation }
  }

  if (
    input.referenceAssetId !== undefined
    || input.referenceAssetSha256 !== undefined
    || input.rights !== undefined
  ) {
    throw new InputError('rights fields are only valid for replaceReferenceRights')
  }
  const operation = parseReferenceActionOperation(input.operation)
  let repairPrompt: string | undefined
  if (operation === 'requestReferenceRegeneration') {
    if (
      typeof input.repairPrompt !== 'string'
      || input.repairPrompt.trim().length === 0
      || input.repairPrompt.length > 8_000
    ) {
      throw new InputError('repairPrompt must be between 1 and 8000 characters for regeneration')
    }
    repairPrompt = input.repairPrompt
  } else if (input.repairPrompt !== undefined) {
    throw new InputError('repairPrompt is only valid for requestReferenceRegeneration')
  }
  const methodProjection = parseReferenceProjection(input.methodProjection)
  const methodAttestation = parseReferenceMethodAttestation(input.methodAttestation)
  const requestWithoutProof = {
    ...common,
    operation,
    candidateAssetId: parseIdentifier(input.candidateAssetId, 'candidateAssetId'),
    candidateAssetSha256: parseInputSha256(input.candidateAssetSha256, 'candidateAssetSha256'),
    ...(repairPrompt === undefined ? {} : { repairPrompt }),
    ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
  } as const
  verifyReferenceMethodProof(requestWithoutProof, methodProjection, methodAttestation)
  return { ...requestWithoutProof, methodProjection, methodAttestation }
}

function parseReferenceCommandLineage(input: YimengCommandJsonObject): {
  operation: YimengReferenceActionOperation
  candidateAssetId: string
  candidateAssetSha256: string
} | {
  operation: 'replaceReferenceRights'
  referenceAssetId: string
  referenceAssetSha256: string
} | undefined {
  const hasReferenceField = input.operation !== undefined
    || input.candidateAssetId !== undefined
    || input.candidateAssetSha256 !== undefined
    || input.referenceAssetId !== undefined
    || input.referenceAssetSha256 !== undefined
  if (!hasReferenceField) return undefined
  if (input.operation === 'replaceReferenceRights') {
    if (input.candidateAssetId !== undefined || input.candidateAssetSha256 !== undefined) {
      throw new InputError('candidate lineage is not valid for replaceReferenceRights')
    }
    return {
      operation: 'replaceReferenceRights',
      referenceAssetId: parseIdentifier(input.referenceAssetId, 'referenceAssetId'),
      referenceAssetSha256: parseInputSha256(input.referenceAssetSha256, 'referenceAssetSha256'),
    }
  }
  if (input.referenceAssetId !== undefined || input.referenceAssetSha256 !== undefined) {
    throw new InputError('reference rights lineage is only valid for replaceReferenceRights')
  }
  return {
    operation: parseReferenceActionOperation(input.operation),
    candidateAssetId: parseIdentifier(input.candidateAssetId, 'candidateAssetId'),
    candidateAssetSha256: parseInputSha256(input.candidateAssetSha256, 'candidateAssetSha256'),
  }
}

function parsePreviewElementProfileRequest(payload: unknown): YimengPreviewElementProfileRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'changeSetId',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'episodeId',
    'baseRevision',
    'baseSnapshotSha256',
    'operation',
    'candidateAssetId',
    'candidateAssetSha256',
    'referenceAssetId',
    'referenceAssetSha256',
  ])
  const referenceLineage = parseReferenceCommandLineage(input)
  return {
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    ...parseElementSubjectRequest(input),
    ...(referenceLineage === undefined ? {} : referenceLineage),
  }
}

function parseCommitElementProfileRequest(payload: unknown): YimengCommitElementProfileRequest {
  const input = requireInputObject(payload)
  assertOnlyInputKeys(input, [
    'changeSetId',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'episodeId',
    'baseRevision',
    'baseSnapshotSha256',
    'idempotencyKey',
    'expectedPayloadSha256',
    'operation',
    'candidateAssetId',
    'candidateAssetSha256',
    'referenceAssetId',
    'referenceAssetSha256',
  ])
  const idempotencyKey = parseIdentifier(input.idempotencyKey, 'idempotencyKey')
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new InputError('idempotencyKey must be between 8 and 200 characters')
  }
  if (/[\r\n]/.test(idempotencyKey)) throw new InputError('idempotencyKey must not contain line breaks')
  const referenceLineage = parseReferenceCommandLineage(input)
  return {
    changeSetId: parseIdentifier(input.changeSetId, 'changeSetId'),
    ...parseElementSubjectRequest(input),
    idempotencyKey,
    expectedPayloadSha256: parseInputSha256(input.expectedPayloadSha256, 'expectedPayloadSha256'),
    ...(referenceLineage === undefined ? {} : referenceLineage),
  }
}

function parseRecoverElementProfileCommitRequest(payload: unknown): YimengRecoverElementProfileCommitRequest {
  return parseCommitElementProfileRequest(payload)
}

function normalizeToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const token = value.trim()
  if (token.length === 0 || token.length > 16_384 || /[\r\n]/.test(token)) return undefined
  return token
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
    throw new Error('qingmu-yimeng-command-adapter baseUrl must be an absolute URL')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopbackHostname(url.hostname)) {
    throw new Error('qingmu-yimeng-command-adapter baseUrl must use loopback http(s)')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('qingmu-yimeng-command-adapter baseUrl must not contain credentials, path, query, or fragment')
  }
  return url.origin
}

function resolveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > MAX_TIMEOUT_MS) {
    throw new Error(`qingmu-yimeng-command-adapter timeoutMs must be an integer from 100 to ${String(MAX_TIMEOUT_MS)}`)
  }
  return value
}

function serializeBody(value: YimengCommandJsonObject): string {
  let body: string
  try {
    body = JSON.stringify(value)
  } catch {
    throw new InputError('payload must be JSON serializable')
  }
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new InputError('payload exceeds the command size limit')
  }
  return body
}

function exceedsYimengJsonNesting(raw: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (const character of raw) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') inString = true
    else if (character === '[' || character === '{') {
      depth += 1
      if (depth > 64) return true
    } else if (character === ']' || character === '}') depth -= 1
  }
  return false
}

function serializeStageArtifactBody(value: YimengCommandJsonObject): string {
  let body: string
  try {
    body = stageArtifactCanonicalJson(value, 'payload')
  } catch {
    throw new InputError('payload must be JSON serializable')
  }
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new InputError('payload exceeds the command size limit')
  }
  if (exceedsYimengJsonNesting(body)) {
    throw new InputError('payload exceeds the Yimeng JSON nesting limit')
  }
  return body
}

function sanitizeUpstreamValue(value: unknown, token: string, depth = 0): unknown {
  if (depth > 100) throw new InvalidJsonResponseError('response nesting exceeds limit')
  if (typeof value === 'string') return value.split(token).join('[REDACTED]')
  if (Array.isArray(value)) return value.map(item => sanitizeUpstreamValue(item, token, depth + 1))
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => (
        !SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase().replaceAll('-', '').replaceAll('_', ''))
        && !key.includes(token)
      ))
      .map(([key, item]) => [key, sanitizeUpstreamValue(item, token, depth + 1)]),
  )
}

function containsReflectedCredential(value: unknown, token: string, depth = 0): boolean {
  if (depth > 100) return true
  if (typeof value === 'string') return value.includes(token)
  if (Array.isArray(value)) {
    return value.some(item => containsReflectedCredential(item, token, depth + 1))
  }
  if (!isJsonObject(value)) return false
  return Object.entries(value).some(([key, item]) => (
    key.includes(token) || containsReflectedCredential(item, token, depth + 1)
  ))
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_JSON_BYTES) {
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
      if (length > MAX_JSON_BYTES) {
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

function safeUpstreamCode(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined
  const detail = isJsonObject(value.detail) ? value.detail : undefined
  const code = detail?.code
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined
}

interface FetchJsonSuccess {
  readonly ok: true
  readonly value: unknown
}

type FetchJsonResult = FetchJsonSuccess | RpcResult<never>

interface FetchJsonRequest {
  readonly method: 'GET' | 'POST'
  readonly body?: string
  readonly idempotencyKey?: string
}

async function fetchJson(
  deps: YimengCommandAdapterDependencies,
  url: string,
  token: string,
  request: FetchJsonRequest,
  timeoutMs: number,
  signal: AbortSignal,
  preserveSuccessfulJson = false,
): Promise<FetchJsonResult> {
  const controller = new AbortController()
  const timeoutReason = Object.freeze({ kind: 'qingmu-yimeng-command-timeout' })
  const onAbort = () => { controller.abort(signal.reason) }
  if (signal.aborted) return cancelled()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, timeoutMs)
  try {
    const response = await deps.fetch(url, {
      method: request.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(request.idempotencyKey === undefined ? {} : { 'Idempotency-Key': request.idempotencyKey }),
      },
      ...(request.body === undefined ? {} : { body: request.body }),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    let value: unknown = undefined
    let invalidJson = false
    try {
      const upstreamValue = await readBoundedJson(response)
      value = response.ok && preserveSuccessfulJson
        ? upstreamValue
        : sanitizeUpstreamValue(upstreamValue, token)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return internalError('Yimeng response exceeded size limit')
      }
      if (!(error instanceof InvalidJsonResponseError)) throw error
      invalidJson = true
    }
    if (response.status === 401 || response.status === 403) {
      return internalError('Yimeng authentication failed')
    }
    if (!response.ok) {
      const code = safeUpstreamCode(value)
      return internalError(`Yimeng rejected command (HTTP ${String(response.status)}${code === undefined ? '' : `: ${code}`})`)
    }
    if (invalidJson) return internalError('Yimeng service returned invalid JSON')
    return { ok: true, value }
  } catch {
    if (controller.signal.reason === timeoutReason) return internalError('Yimeng command timed out')
    if (controller.signal.aborted) return cancelled()
    return internalError('Yimeng service is unavailable')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function normalizeChangeSetBase(value: unknown): {
  item: YimengCommandJsonObject
  base: YimengChangeSetBase
} {
  const item = requireObject(value, 'changeSet')
  if (item.schema !== 'jason.qingmu-change-set.v1') throw new UpstreamContractError('changeSet.schema mismatch')
  if (item.originKind !== 'human') throw new UpstreamContractError('changeSet.originKind mismatch')
  return {
    item,
    base: {
      ...item,
      schema: 'jason.qingmu-change-set.v1',
      id: requireString(item.id, 'changeSet.id'),
      workspaceId: requireNullableString(item.workspaceId, 'changeSet.workspaceId'),
      projectId: requireString(item.projectId, 'changeSet.projectId'),
      targetId: requireString(item.targetId, 'changeSet.targetId'),
      baseRevision: requireInteger(item.baseRevision, 'changeSet.baseRevision'),
      baseSnapshotSha256: requireSha256(item.baseSnapshotSha256, 'changeSet.baseSnapshotSha256'),
      payloadSha256: requireSha256(item.payloadSha256, 'changeSet.payloadSha256'),
      originKind: 'human',
      actorUserId: requireString(item.actorUserId, 'changeSet.actorUserId'),
      harnessSessionId: requireNullableString(item.harnessSessionId, 'changeSet.harnessSessionId'),
      status: requireString(item.status, 'changeSet.status'),
      authoritativeRevision: item.authoritativeRevision === null
        ? null
        : requireInteger(item.authoritativeRevision, 'changeSet.authoritativeRevision'),
      authoritativeSnapshotSha256: item.authoritativeSnapshotSha256 === null
        ? null
        : requireSha256(item.authoritativeSnapshotSha256, 'changeSet.authoritativeSnapshotSha256'),
      committedByUserId: requireNullableString(item.committedByUserId, 'changeSet.committedByUserId'),
      committedEventId: requireNullableString(item.committedEventId, 'changeSet.committedEventId'),
      committedAt: requireNullableString(item.committedAt, 'changeSet.committedAt'),
      createdAt: requireString(item.createdAt, 'changeSet.createdAt'),
      updatedAt: requireString(item.updatedAt, 'changeSet.updatedAt'),
    },
  }
}

function normalizeChangeSet(value: unknown): YimengChangeSet {
  const { item, base } = normalizeChangeSetBase(value)
  if (item.targetType !== 'episode_script') throw new UpstreamContractError('changeSet.targetType mismatch')
  return {
    ...base,
    episodeId: requireString(item.episodeId, 'changeSet.episodeId'),
    targetType: 'episode_script',
  }
}

function normalizeElementProfileChangeSet(value: unknown): YimengElementProfileChangeSet {
  const { item, base } = normalizeChangeSetBase(value)
  if (item.targetType !== 'element_profile') throw new UpstreamContractError('changeSet.targetType mismatch')
  if (item.episodeId !== null) throw new UpstreamContractError('changeSet.episodeId mismatch')
  return {
    ...base,
    episodeId: null,
    targetType: 'element_profile',
  }
}

function normalizeStoryboardFrameChangeSet(value: unknown): YimengStoryboardFrameChangeSet {
  const { item, base } = normalizeChangeSetBase(value)
  assertExactOutputKeys(item, [
    'schema',
    'id',
    'workspaceId',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'baseRevision',
    'baseSnapshotSha256',
    'payloadSha256',
    'originKind',
    'actorUserId',
    'harnessSessionId',
    'status',
    'authoritativeRevision',
    'authoritativeSnapshotSha256',
    'committedByUserId',
    'committedEventId',
    'committedAt',
    'createdAt',
    'updatedAt',
  ], 'changeSet')
  if (item.targetType !== 'storyboard_frame') {
    throw new UpstreamContractError('changeSet.targetType mismatch')
  }
  return {
    ...base,
    episodeId: requireString(item.episodeId, 'changeSet.episodeId'),
    targetType: 'storyboard_frame',
  }
}

function normalizeStoryboardRevisionCoordinate(
  value: unknown,
  field: string,
): YimengStoryboardRevisionCoordinate {
  const item = requireObject(value, field)
  assertExactOutputKeys(item, ['revisionId', 'revisionVersion', 'sourceSha256'], field)
  return {
    revisionId: requireString(item.revisionId, `${field}.revisionId`),
    revisionVersion: requireInteger(item.revisionVersion, `${field}.revisionVersion`),
    sourceSha256: requireSha256(item.sourceSha256, `${field}.sourceSha256`),
  }
}

function normalizeHeroFrameBinding(value: unknown, field: string): YimengHeroFrameBinding {
  const item = requireObject(value, field)
  assertExactOutputKeys(item, ['assetId', 'mediaSha256', 'bindingSha256'], field)
  return {
    assetId: requireString(item.assetId, `${field}.assetId`),
    mediaSha256: requireSha256(item.mediaSha256, `${field}.mediaSha256`),
    bindingSha256: requireSha256(item.bindingSha256, `${field}.bindingSha256`),
  }
}

function normalizeStoryboardCanvas(value: unknown, field: string): YimengStoryboardCanvas {
  const item = requireObject(value, field)
  assertExactOutputKeys(item, [
    'schema',
    'heroFrameBindingSha256',
    'annotations',
    'rawAnnotationsSha256',
    'compiled',
    'compiledSha256',
  ], field)
  if (item.schema !== 'jason.qingmu-storyboard-canvas.v1') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  const annotations = requireObjectArray(item.annotations, `${field}.annotations`)
  const rawAnnotationsSha256 = requireSha256(
    item.rawAnnotationsSha256,
    `${field}.rawAnnotationsSha256`,
  )
  if (canonicalJsonSha256(annotations, `${field}.annotations`) !== rawAnnotationsSha256) {
    throw new UpstreamContractError(`${field}.rawAnnotationsSha256 mismatch`)
  }
  const compiled = requireObject(item.compiled, `${field}.compiled`)
  assertExactOutputKeys(
    compiled,
    ['subjectLayout', 'objectAnchors', 'actionTrajectory'],
    `${field}.compiled`,
  )
  const normalizedCompiled = {
    subjectLayout: requireObjectArray(compiled.subjectLayout, `${field}.compiled.subjectLayout`),
    objectAnchors: requireObjectArray(compiled.objectAnchors, `${field}.compiled.objectAnchors`),
    actionTrajectory: requireObjectArray(compiled.actionTrajectory, `${field}.compiled.actionTrajectory`),
  }
  const compiledSha256 = requireSha256(item.compiledSha256, `${field}.compiledSha256`)
  if (canonicalJsonSha256(normalizedCompiled, `${field}.compiled`) !== compiledSha256) {
    throw new UpstreamContractError(`${field}.compiledSha256 mismatch`)
  }
  return {
    schema: 'jason.qingmu-storyboard-canvas.v1',
    heroFrameBindingSha256: requireSha256(
      item.heroFrameBindingSha256,
      `${field}.heroFrameBindingSha256`,
    ),
    annotations,
    rawAnnotationsSha256,
    compiled: normalizedCompiled,
    compiledSha256,
  }
}

function exactStringList(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index])
}

function normalizeStoryboardCanvasProposal(
  value: unknown,
  expected: YimengProposeStoryboardCanvasRequest,
): YimengProposeStoryboardCanvasResponse {
  const root = requireObject(value, 'storyboardCanvasProposal')
  assertExactOutputKeys(root, ['schema', 'changeSet', 'nextAction'], 'storyboardCanvasProposal')
  if (root.schema !== 'jason.qingmu-storyboard-canvas-change-set-proposal.v1') {
    throw new UpstreamContractError('storyboardCanvasProposal.schema mismatch')
  }
  if (root.nextAction !== 'preview') {
    throw new UpstreamContractError('storyboardCanvasProposal.nextAction mismatch')
  }
  const changeSet = normalizeStoryboardFrameChangeSet(root.changeSet)
  if (
    changeSet.projectId !== expected.projectId
    || changeSet.episodeId !== expected.episodeId
    || changeSet.targetId !== expected.frameId
    || changeSet.baseRevision !== expected.baseRevision
    || changeSet.baseSnapshotSha256 !== expected.baseSnapshotSha256
    || changeSet.harnessSessionId !== (expected.harnessSessionId ?? null)
    || changeSet.status !== 'draft'
    || changeSet.authoritativeRevision !== null
    || changeSet.authoritativeSnapshotSha256 !== null
  ) {
    throw new UpstreamContractError('storyboardCanvasProposal lineage mismatch')
  }
  return {
    schema: 'jason.qingmu-storyboard-canvas-change-set-proposal.v1',
    changeSet,
    nextAction: 'preview',
  }
}

function normalizeStoryboardCanvasPreview(
  value: unknown,
  expected: YimengPreviewStoryboardCanvasRequest,
): YimengPreviewStoryboardCanvasResponse {
  const root = requireObject(value, 'storyboardCanvasPreview')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'operation',
    'storyboardRevision',
    'baseRevision',
    'baseSnapshotSha256',
    'payloadSha256',
    'heroFrame',
    'methodHeroFrameBindingSha256',
    'before',
    'after',
    'changedPaths',
    'providerCalls',
    'workerStarted',
    'selectionExecuted',
    'humanApprovalInferred',
    'humanSignoff',
  ], 'storyboardCanvasPreview')
  if (root.schema !== 'jason.qingmu-storyboard-canvas-preview.v1') {
    throw new UpstreamContractError('storyboardCanvasPreview.schema mismatch')
  }
  const storyboardRevision = normalizeStoryboardRevisionCoordinate(
    root.storyboardRevision,
    'storyboardCanvasPreview.storyboardRevision',
  )
  const heroFrame = normalizeHeroFrameBinding(root.heroFrame, 'storyboardCanvasPreview.heroFrame')
  const before = root.before === null
    ? null
    : normalizeStoryboardCanvas(root.before, 'storyboardCanvasPreview.before')
  const after = normalizeStoryboardCanvas(root.after, 'storyboardCanvasPreview.after')
  const changedPaths = requireStringArray(root.changedPaths, 'storyboardCanvasPreview.changedPaths')
  if (
    root.changeSetId !== expected.changeSetId
    || root.projectId !== expected.projectId
    || root.episodeId !== expected.episodeId
    || root.targetType !== 'storyboard_frame'
    || root.targetId !== expected.frameId
    || root.operation !== 'replaceStoryboardCanvas'
    || storyboardRevision.revisionId !== expected.storyboardRevisionId
    || storyboardRevision.revisionVersion !== expected.baseRevision
    || root.baseRevision !== expected.baseRevision
    || root.baseSnapshotSha256 !== expected.baseSnapshotSha256
    || after.heroFrameBindingSha256 !== heroFrame.bindingSha256
    || (before !== null && before.heroFrameBindingSha256 !== heroFrame.bindingSha256)
    || !exactStringList(changedPaths, STORYBOARD_CANVAS_CHANGED_PATHS)
  ) {
    throw new UpstreamContractError('storyboardCanvasPreview lineage mismatch')
  }
  if (
    root.providerCalls !== 0
    || root.workerStarted !== false
    || root.selectionExecuted !== false
    || root.humanApprovalInferred !== false
    || root.humanSignoff !== false
  ) {
    throw new UpstreamContractError('storyboardCanvasPreview execution boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-storyboard-canvas-preview.v1',
    changeSetId: expected.changeSetId,
    projectId: expected.projectId,
    episodeId: expected.episodeId,
    targetType: 'storyboard_frame',
    targetId: expected.frameId,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision,
    baseRevision: expected.baseRevision,
    baseSnapshotSha256: expected.baseSnapshotSha256,
    payloadSha256: requireSha256(root.payloadSha256, 'storyboardCanvasPreview.payloadSha256'),
    heroFrame,
    methodHeroFrameBindingSha256: requireSha256(
      root.methodHeroFrameBindingSha256,
      'storyboardCanvasPreview.methodHeroFrameBindingSha256',
    ),
    before,
    after,
    changedPaths,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  }
}

function normalizeStoryboardCanvasCommit(
  value: unknown,
  expected: YimengCommitStoryboardCanvasRequest,
): YimengCommitStoryboardCanvasResponse {
  const root = requireObject(value, 'storyboardCanvasCommit')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'eventType',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'operation',
    'storyboardRevision',
    'baseRevision',
    'authoritativeRevision',
    'authoritativeSnapshotSha256',
    'heroFrame',
    'methodHeroFrameBindingSha256',
    'rawAnnotationsSha256',
    'methodRawAnnotationsSha256',
    'compiledSha256',
    'payloadSha256',
    'idempotencyKey',
    'changed',
    'providerCalls',
    'workerStarted',
    'selectionExecuted',
    'humanApprovalInferred',
    'humanSignoff',
    'deduplicated',
    'committedAt',
  ], 'storyboardCanvasCommit')
  if (root.schema !== 'jason.qingmu-storyboard-canvas-commit-result.v1') {
    throw new UpstreamContractError('storyboardCanvasCommit.schema mismatch')
  }
  const revisions = requireObject(root.storyboardRevision, 'storyboardCanvasCommit.storyboardRevision')
  assertExactOutputKeys(revisions, ['base', 'authoritative'], 'storyboardCanvasCommit.storyboardRevision')
  const baseRevision = normalizeStoryboardRevisionCoordinate(
    revisions.base,
    'storyboardCanvasCommit.storyboardRevision.base',
  )
  const authoritativeRevision = normalizeStoryboardRevisionCoordinate(
    revisions.authoritative,
    'storyboardCanvasCommit.storyboardRevision.authoritative',
  )
  const heroFrame = normalizeHeroFrameBinding(root.heroFrame, 'storyboardCanvasCommit.heroFrame')
  const authoritativeVersion = requireInteger(
    root.authoritativeRevision,
    'storyboardCanvasCommit.authoritativeRevision',
  )
  if (
    root.changeSetId !== expected.changeSetId
    || root.projectId !== expected.projectId
    || root.episodeId !== expected.episodeId
    || root.targetType !== 'storyboard_frame'
    || root.targetId !== expected.frameId
    || root.operation !== 'replaceStoryboardCanvas'
    || root.eventType !== 'StoryboardCanvasReplaced'
    || baseRevision.revisionId !== expected.storyboardRevisionId
    || baseRevision.revisionVersion !== expected.baseRevision
    || root.baseRevision !== expected.baseRevision
    || authoritativeRevision.revisionVersion !== authoritativeVersion
    || root.payloadSha256 !== expected.expectedPayloadSha256
    || root.idempotencyKey !== expected.idempotencyKey
    || root.changed !== true
  ) {
    throw new UpstreamContractError('storyboardCanvasCommit lineage mismatch')
  }
  if (
    root.providerCalls !== 0
    || root.workerStarted !== false
    || root.selectionExecuted !== false
    || root.humanApprovalInferred !== false
    || root.humanSignoff !== false
  ) {
    throw new UpstreamContractError('storyboardCanvasCommit execution boundary mismatch')
  }
  return {
    schema: 'jason.qingmu-storyboard-canvas-commit-result.v1',
    changeSetId: expected.changeSetId,
    commandReceiptId: requireString(root.commandReceiptId, 'storyboardCanvasCommit.commandReceiptId'),
    eventId: requireString(root.eventId, 'storyboardCanvasCommit.eventId'),
    eventType: 'StoryboardCanvasReplaced',
    projectId: expected.projectId,
    episodeId: expected.episodeId,
    targetType: 'storyboard_frame',
    targetId: expected.frameId,
    operation: 'replaceStoryboardCanvas',
    storyboardRevision: { base: baseRevision, authoritative: authoritativeRevision },
    baseRevision: expected.baseRevision,
    authoritativeRevision: authoritativeVersion,
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'storyboardCanvasCommit.authoritativeSnapshotSha256',
    ),
    heroFrame,
    methodHeroFrameBindingSha256: requireSha256(
      root.methodHeroFrameBindingSha256,
      'storyboardCanvasCommit.methodHeroFrameBindingSha256',
    ),
    rawAnnotationsSha256: requireSha256(
      root.rawAnnotationsSha256,
      'storyboardCanvasCommit.rawAnnotationsSha256',
    ),
    methodRawAnnotationsSha256: requireSha256(
      root.methodRawAnnotationsSha256,
      'storyboardCanvasCommit.methodRawAnnotationsSha256',
    ),
    compiledSha256: requireSha256(root.compiledSha256, 'storyboardCanvasCommit.compiledSha256'),
    payloadSha256: expected.expectedPayloadSha256,
    idempotencyKey: expected.idempotencyKey,
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    selectionExecuted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: requireBoolean(root.deduplicated, 'storyboardCanvasCommit.deduplicated'),
    committedAt: requireString(root.committedAt, 'storyboardCanvasCommit.committedAt'),
  }
}

function normalizeStoryboardCanvasRecovery(
  value: unknown,
  expected: YimengRecoverStoryboardCanvasCommitRequest,
): YimengRecoverStoryboardCanvasCommitResponse {
  const root = requireObject(value, 'storyboardCanvasRecovery')
  assertExactOutputKeys(
    root,
    ['schema', 'recovered', 'receiptSha256', 'receipt'],
    'storyboardCanvasRecovery',
  )
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1') {
    throw new UpstreamContractError('storyboardCanvasRecovery.schema mismatch')
  }
  if (root.recovered !== true) {
    throw new UpstreamContractError('storyboardCanvasRecovery.recovered mismatch')
  }
  const receiptSha256 = requireSha256(
    root.receiptSha256,
    'storyboardCanvasRecovery.receiptSha256',
  )
  if (canonicalJsonSha256(root.receipt, 'storyboardCanvasRecovery.receipt') !== receiptSha256) {
    throw new UpstreamContractError('storyboardCanvasRecovery receipt sha256 mismatch')
  }
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizeStoryboardCanvasCommit(root.receipt, expected),
  }
}

function normalizeProposal(
  value: unknown,
  expected: YimengProposeScriptRequest,
): YimengProposeScriptResponse {
  const root = requireObject(value, 'proposal')
  if (root.schema !== 'jason.qingmu-change-set-proposal.v1') throw new UpstreamContractError('proposal.schema mismatch')
  if (root.nextAction !== 'preview') throw new UpstreamContractError('proposal.nextAction mismatch')
  const result: YimengProposeScriptResponse = {
    ...root,
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: normalizeChangeSet(root.changeSet),
    nextAction: 'preview',
  }
  if (
    result.changeSet.projectId !== expected.projectId
    || result.changeSet.episodeId !== expected.episodeId
    || result.changeSet.targetId !== expected.episodeId
  ) {
    throw new UpstreamContractError('proposal project or episode subject mismatch')
  }
  if (result.changeSet.baseRevision !== expected.baseRevision) {
    throw new UpstreamContractError('proposal baseRevision mismatch')
  }
  return result
}

function normalizePreview(value: unknown, expected: YimengPreviewScriptRequest): YimengPreviewScriptResponse {
  const root = requireObject(value, 'preview')
  if (root.schema !== 'jason.qingmu-change-set-preview.v1') throw new UpstreamContractError('preview.schema mismatch')
  const result: YimengPreviewScriptResponse = {
    ...root,
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet: normalizeChangeSet(root.changeSet),
    baseScript: requireObject(root.baseScript, 'preview.baseScript'),
    proposedScript: requireObject(root.proposedScript, 'preview.proposedScript'),
    authoritativeCurrentScript: requireObject(root.authoritativeCurrentScript, 'preview.authoritativeCurrentScript'),
    changeSetId: requireString(root.changeSetId, 'preview.changeSetId'),
    payloadSha256: requireSha256(root.payloadSha256, 'preview.payloadSha256'),
    baseRevision: requireInteger(root.baseRevision, 'preview.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'preview.authoritativeRevision'),
    changed: requireBoolean(root.changed, 'preview.changed'),
    changedPaths: requireStringArray(root.changedPaths, 'preview.changedPaths'),
    authoritativeChangedPaths: requireStringArray(root.authoritativeChangedPaths, 'preview.authoritativeChangedPaths'),
    revisionConflict: requireBoolean(root.revisionConflict, 'preview.revisionConflict'),
    baseSnapshotConflict: requireBoolean(root.baseSnapshotConflict, 'preview.baseSnapshotConflict'),
    canCommit: requireBoolean(root.canCommit, 'preview.canCommit'),
    invalidatedStages: requireStringArray(root.invalidatedStages, 'preview.invalidatedStages'),
    preflight: requireObject(root.preflight, 'preview.preflight'),
    references: requireObjectArray(root.references, 'preview.references'),
    previewSha256: requireSha256(root.previewSha256, 'preview.previewSha256'),
  }
  if (result.changeSetId !== expected.changeSetId || result.changeSet.id !== expected.changeSetId) {
    throw new UpstreamContractError('preview changeSet subject mismatch')
  }
  if (result.changeSet.projectId !== expected.projectId) {
    throw new UpstreamContractError('preview project subject mismatch')
  }
  if (result.changeSet.episodeId !== expected.episodeId || result.changeSet.targetId !== expected.episodeId) {
    throw new UpstreamContractError('preview episode subject mismatch')
  }
  if (result.payloadSha256 !== result.changeSet.payloadSha256) {
    throw new UpstreamContractError('preview payload lineage mismatch')
  }
  if (result.baseRevision !== result.changeSet.baseRevision || result.baseRevision !== expected.baseRevision) {
    throw new UpstreamContractError('preview baseRevision lineage mismatch')
  }
  if (result.canCommit && (result.revisionConflict || result.baseSnapshotConflict)) {
    throw new UpstreamContractError('preview conflict cannot be committable')
  }
  return result
}

function normalizeCommit(
  value: unknown,
  expected: YimengCommitScriptRequest,
): YimengCommitScriptResponse {
  const root = requireObject(value, 'commit')
  if (root.schema !== 'jason.qingmu-episode-script-commit-result.v1') {
    throw new UpstreamContractError('commit.schema mismatch')
  }
  const result: YimengCommitScriptResponse = {
    ...root,
    schema: 'jason.qingmu-episode-script-commit-result.v1',
    changeSetId: requireString(root.changeSetId, 'commit.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'commit.commandReceiptId'),
    eventId: requireString(root.eventId, 'commit.eventId'),
    projectId: requireString(root.projectId, 'commit.projectId'),
    episodeId: requireString(root.episodeId, 'commit.episodeId'),
    baseRevision: requireInteger(root.baseRevision, 'commit.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'commit.authoritativeRevision'),
    authoritativeSnapshotSha256: requireSha256(root.authoritativeSnapshotSha256, 'commit.authoritativeSnapshotSha256'),
    payloadSha256: requireSha256(root.payloadSha256, 'commit.payloadSha256'),
    idempotencyKey: requireString(root.idempotencyKey, 'commit.idempotencyKey'),
    changed: requireBoolean(root.changed, 'commit.changed'),
    invalidatedStages: requireStringArray(root.invalidatedStages, 'commit.invalidatedStages'),
    deduplicated: requireBoolean(root.deduplicated, 'commit.deduplicated'),
    committedAt: requireString(root.committedAt, 'commit.committedAt'),
  }
  if (result.changeSetId !== expected.changeSetId) {
    throw new UpstreamContractError('commit changeSet subject mismatch')
  }
  if (result.projectId !== expected.projectId) {
    throw new UpstreamContractError('commit project subject mismatch')
  }
  if (result.episodeId !== expected.episodeId) {
    throw new UpstreamContractError('commit episode subject mismatch')
  }
  if (result.baseRevision !== expected.baseRevision) {
    throw new UpstreamContractError('commit baseRevision lineage mismatch')
  }
  if (result.payloadSha256 !== expected.expectedPayloadSha256) {
    throw new UpstreamContractError('commit payload lineage mismatch')
  }
  if (result.idempotencyKey !== expected.idempotencyKey) {
    throw new UpstreamContractError('commit idempotency lineage mismatch')
  }
  return result
}

function normalizeRecovery(
  value: unknown,
  expected: YimengRecoverScriptCommitRequest,
): YimengRecoverScriptCommitResponse {
  const root = requireObject(value, 'recovery')
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1') {
    throw new UpstreamContractError('recovery.schema mismatch')
  }
  if (root.recovered !== true) throw new UpstreamContractError('recovery.recovered mismatch')
  const receiptSha256 = requireSha256(root.receiptSha256, 'recovery.receiptSha256')
  if (canonicalJsonSha256(root.receipt, 'recovery.receipt') !== receiptSha256) {
    throw new UpstreamContractError('recovery receipt sha256 mismatch')
  }
  return {
    ...root,
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizeCommit(root.receipt, expected),
  }
}

function normalizePromptIrText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new UpstreamContractError(`${field} must be a string`)
  return value
}

function normalizePromptIrEditableProjection(
  value: unknown,
  field: string,
): YimengPromptIrEditableProjection {
  const projection = requireObject(value, field)
  assertExactOutputKeys(projection, PROMPT_IR_EDITABLE_FIELDS, field)
  return {
    imageGenPrompt: normalizePromptIrText(projection.imageGenPrompt, `${field}.imageGenPrompt`),
    lastFrameImagePrompt: normalizePromptIrText(
      projection.lastFrameImagePrompt,
      `${field}.lastFrameImagePrompt`,
    ),
    videoGenPrompt: normalizePromptIrText(projection.videoGenPrompt, `${field}.videoGenPrompt`),
    motionPrompt: normalizePromptIrText(projection.motionPrompt, `${field}.motionPrompt`),
    negativePrompt: normalizePromptIrText(projection.negativePrompt, `${field}.negativePrompt`),
  }
}

function normalizePromptIrRecord(
  value: unknown,
  field: string,
  expectedStatus: 'Draft' | 'Ready',
): YimengPromptIrRecord {
  const record = requireObject(value, field)
  assertExactOutputKeys(record, [
    'id',
    'version',
    'contentSha256',
    'status',
    'editableProjection',
  ], field)
  if (record.status !== expectedStatus) {
    throw new UpstreamContractError(`${field}.status must be ${expectedStatus}`)
  }
  return {
    id: requireString(record.id, `${field}.id`),
    version: requireInteger(record.version, `${field}.version`),
    contentSha256: requireSha256(record.contentSha256, `${field}.contentSha256`),
    status: expectedStatus,
    editableProjection: normalizePromptIrEditableProjection(
      record.editableProjection,
      `${field}.editableProjection`,
    ),
  }
}

function normalizePromptIrReadyLineage(
  value: unknown,
  field: string,
): YimengPromptIrReadyLineage {
  const record = requireObject(value, field)
  assertExactOutputKeys(record, ['id', 'version', 'contentSha256', 'status'], field)
  if (record.status !== 'Ready') throw new UpstreamContractError(`${field}.status must be Ready`)
  return {
    id: requireString(record.id, `${field}.id`),
    version: requireInteger(record.version, `${field}.version`),
    contentSha256: requireSha256(record.contentSha256, `${field}.contentSha256`),
    status: 'Ready',
  }
}

function normalizePromptIrChangeSet(value: unknown): YimengPromptIrChangeSet {
  const { item, base } = normalizeChangeSetBase(value)
  if (item.targetType !== 'prompt_ir') throw new UpstreamContractError('changeSet.targetType mismatch')
  return {
    ...base,
    episodeId: requireString(item.episodeId, 'changeSet.episodeId'),
    targetType: 'prompt_ir',
  }
}

function normalizePromptIrProposal(
  value: unknown,
  expected: YimengProposePromptIrRequest,
): YimengProposePromptIrResponse {
  const root = requireObject(value, 'promptIrProposal')
  assertExactOutputKeys(root, ['schema', 'changeSet', 'nextAction'], 'promptIrProposal')
  if (root.schema !== 'jason.qingmu-prompt-ir-change-set-proposal.v1') {
    throw new UpstreamContractError('promptIrProposal.schema mismatch')
  }
  if (root.nextAction !== 'preview') throw new UpstreamContractError('promptIrProposal.nextAction mismatch')
  const changeSet = normalizePromptIrChangeSet(root.changeSet)
  const targetId = `${expected.storyboardRevisionId}:${expected.frameId}`
  if (
    changeSet.projectId !== expected.projectId
    || changeSet.episodeId !== expected.episodeId
    || changeSet.targetId !== targetId
    || changeSet.baseRevision !== expected.baseVersion
  ) {
    throw new UpstreamContractError('promptIrProposal subject lineage mismatch')
  }
  return {
    schema: 'jason.qingmu-prompt-ir-change-set-proposal.v1',
    changeSet,
    nextAction: 'preview',
  }
}

function normalizePromptIrTarget(
  value: unknown,
  expected: Pick<YimengPreviewPromptIrRequest, 'projectId' | 'episodeId' | 'storyboardRevisionId' | 'frameId' | 'targetId'>,
): YimengPreviewPromptIrResponse['target'] {
  const target = requireObject(value, 'promptIrPreview.target')
  assertExactOutputKeys(target, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'targetId',
  ], 'promptIrPreview.target')
  const result = {
    projectId: requireString(target.projectId, 'promptIrPreview.target.projectId'),
    episodeId: requireString(target.episodeId, 'promptIrPreview.target.episodeId'),
    storyboardRevisionId: requireString(
      target.storyboardRevisionId,
      'promptIrPreview.target.storyboardRevisionId',
    ),
    frameId: requireString(target.frameId, 'promptIrPreview.target.frameId'),
    targetId: requireString(target.targetId, 'promptIrPreview.target.targetId'),
  }
  if (
    result.projectId !== expected.projectId
    || result.episodeId !== expected.episodeId
    || result.storyboardRevisionId !== expected.storyboardRevisionId
    || result.frameId !== expected.frameId
    || result.targetId !== expected.targetId
  ) {
    throw new UpstreamContractError('promptIrPreview target lineage mismatch')
  }
  return result
}

function normalizePromptIrDiff(
  value: unknown,
  before: YimengPromptIrEditableProjection,
  after: YimengPromptIrEditableProjection,
): YimengPromptIrDiff {
  const diff = requireObject(value, 'promptIrPreview.promptDiff')
  assertExactOutputKeys(diff, ['changed', 'changedPaths', 'before', 'after'], 'promptIrPreview.promptDiff')
  const normalizedBefore = normalizePromptIrEditableProjection(diff.before, 'promptIrPreview.promptDiff.before')
  const normalizedAfter = normalizePromptIrEditableProjection(diff.after, 'promptIrPreview.promptDiff.after')
  if (
    canonicalJson(normalizedBefore, 'promptIrPreview.promptDiff.before')
      !== canonicalJson(before, 'promptIrPreview.basePromptIr.editableProjection')
    || canonicalJson(normalizedAfter, 'promptIrPreview.promptDiff.after')
      !== canonicalJson(after, 'promptIrPreview.candidatePromptIr.editableProjection')
  ) {
    throw new UpstreamContractError('promptIrPreview promptDiff projection lineage mismatch')
  }
  const expectedPaths = PROMPT_IR_EDITABLE_FIELDS
    .filter(field => before[field] !== after[field])
    .map(field => `$.${field}`)
  const changedPaths = requireStringArray(diff.changedPaths, 'promptIrPreview.promptDiff.changedPaths')
  if (
    changedPaths.length !== expectedPaths.length
    || changedPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new UpstreamContractError('promptIrPreview promptDiff.changedPaths mismatch')
  }
  const changed = requireBoolean(diff.changed, 'promptIrPreview.promptDiff.changed')
  if (changed !== (expectedPaths.length > 0)) {
    throw new UpstreamContractError('promptIrPreview promptDiff.changed mismatch')
  }
  return { changed, changedPaths, before: normalizedBefore, after: normalizedAfter }
}

function normalizePromptIrPreview(
  value: unknown,
  expected: YimengPreviewPromptIrRequest,
): YimengPreviewPromptIrResponse {
  const root = requireObject(value, 'promptIrPreview')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'target',
    'basePromptIr',
    'candidatePromptIr',
    'promptDiff',
    'providerCalls',
    'workerStarted',
    'humanApprovalInferred',
    'humanSignoff',
  ], 'promptIrPreview')
  if (root.schema !== 'jason.qingmu-prompt-ir-preview.v1') {
    throw new UpstreamContractError('promptIrPreview.schema mismatch')
  }
  const changeSetId = requireString(root.changeSetId, 'promptIrPreview.changeSetId')
  if (changeSetId !== expected.changeSetId) {
    throw new UpstreamContractError('promptIrPreview changeSet lineage mismatch')
  }
  const target = normalizePromptIrTarget(root.target, expected)
  const basePromptIr = normalizePromptIrRecord(root.basePromptIr, 'promptIrPreview.basePromptIr', 'Ready')
  const candidatePromptIr = normalizePromptIrRecord(
    root.candidatePromptIr,
    'promptIrPreview.candidatePromptIr',
    'Draft',
  )
  if (
    basePromptIr.id !== expected.basePromptIrId
    || basePromptIr.version !== expected.baseRevision
  ) {
    throw new UpstreamContractError('promptIrPreview base PromptIR lineage mismatch')
  }
  if (root.providerCalls !== 0) throw new UpstreamContractError('promptIrPreview.providerCalls must be zero')
  if (root.workerStarted !== false) throw new UpstreamContractError('promptIrPreview.workerStarted must be false')
  if (root.humanApprovalInferred !== false) {
    throw new UpstreamContractError('promptIrPreview.humanApprovalInferred must be false')
  }
  if (root.humanSignoff !== false) throw new UpstreamContractError('promptIrPreview.humanSignoff must be false')
  return {
    schema: 'jason.qingmu-prompt-ir-preview.v1',
    changeSetId,
    target,
    basePromptIr: { ...basePromptIr, status: 'Ready' },
    candidatePromptIr: { ...candidatePromptIr, status: 'Draft' },
    promptDiff: normalizePromptIrDiff(
      root.promptDiff,
      basePromptIr.editableProjection,
      candidatePromptIr.editableProjection,
    ),
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
  }
}

function normalizePromptIrEditCommit(
  value: unknown,
  expected: YimengCommitPromptIrEditRequest,
): YimengCommitPromptIrEditResponse {
  const root = requireObject(value, 'promptIrEditCommit')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'eventType',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'storyboardRevisionId',
    'frameId',
    'promptIr',
    'previousReadyPromptIr',
    'payloadSha256',
    'idempotencyKey',
    'changed',
    'providerCalls',
    'workerStarted',
    'humanApprovalInferred',
    'humanSignoff',
    'deduplicated',
    'committedAt',
  ], 'promptIrEditCommit')
  if (root.schema !== 'jason.qingmu-prompt-ir-edit-commit-result.v1') {
    throw new UpstreamContractError('promptIrEditCommit.schema mismatch')
  }
  if (root.eventType !== 'PromptIrDraftCommitted') {
    throw new UpstreamContractError('promptIrEditCommit.eventType mismatch')
  }
  if (root.targetType !== 'prompt_ir') throw new UpstreamContractError('promptIrEditCommit.targetType mismatch')
  if (root.changed !== true) throw new UpstreamContractError('promptIrEditCommit.changed must be true')
  if (root.providerCalls !== 0) throw new UpstreamContractError('promptIrEditCommit.providerCalls must be zero')
  if (root.workerStarted !== false) throw new UpstreamContractError('promptIrEditCommit.workerStarted must be false')
  if (root.humanApprovalInferred !== false) {
    throw new UpstreamContractError('promptIrEditCommit.humanApprovalInferred must be false')
  }
  if (root.humanSignoff !== false) throw new UpstreamContractError('promptIrEditCommit.humanSignoff must be false')
  const promptIr = normalizePromptIrRecord(root.promptIr, 'promptIrEditCommit.promptIr', 'Draft')
  const previousReadyPromptIr = normalizePromptIrReadyLineage(
    root.previousReadyPromptIr,
    'promptIrEditCommit.previousReadyPromptIr',
  )
  const result: YimengCommitPromptIrEditResponse = {
    schema: 'jason.qingmu-prompt-ir-edit-commit-result.v1',
    changeSetId: requireString(root.changeSetId, 'promptIrEditCommit.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'promptIrEditCommit.commandReceiptId'),
    eventId: requireString(root.eventId, 'promptIrEditCommit.eventId'),
    eventType: 'PromptIrDraftCommitted',
    projectId: requireString(root.projectId, 'promptIrEditCommit.projectId'),
    episodeId: requireString(root.episodeId, 'promptIrEditCommit.episodeId'),
    targetType: 'prompt_ir',
    targetId: requireString(root.targetId, 'promptIrEditCommit.targetId'),
    storyboardRevisionId: requireString(
      root.storyboardRevisionId,
      'promptIrEditCommit.storyboardRevisionId',
    ),
    frameId: requireString(root.frameId, 'promptIrEditCommit.frameId'),
    promptIr: { ...promptIr, status: 'Draft' },
    previousReadyPromptIr,
    payloadSha256: requireSha256(root.payloadSha256, 'promptIrEditCommit.payloadSha256'),
    idempotencyKey: requireString(root.idempotencyKey, 'promptIrEditCommit.idempotencyKey'),
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: requireBoolean(root.deduplicated, 'promptIrEditCommit.deduplicated'),
    committedAt: requireString(root.committedAt, 'promptIrEditCommit.committedAt'),
  }
  if (
    result.changeSetId !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.episodeId !== expected.episodeId
    || result.targetId !== expected.targetId
    || result.storyboardRevisionId !== expected.storyboardRevisionId
    || result.frameId !== expected.frameId
    || result.previousReadyPromptIr.id !== expected.basePromptIrId
    || result.previousReadyPromptIr.version !== expected.baseRevision
    || result.payloadSha256 !== expected.expectedPayloadSha256
    || result.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new UpstreamContractError('promptIrEditCommit lineage mismatch')
  }
  return result
}

function normalizePromptIrEditRecovery(
  value: unknown,
  expected: YimengRecoverPromptIrEditCommitRequest,
): YimengRecoverPromptIrEditCommitResponse {
  const root = requireObject(value, 'promptIrEditRecovery')
  assertExactOutputKeys(root, ['schema', 'recovered', 'receiptSha256', 'receipt'], 'promptIrEditRecovery')
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1' || root.recovered !== true) {
    throw new UpstreamContractError('promptIrEditRecovery envelope mismatch')
  }
  const receiptSha256 = requireSha256(root.receiptSha256, 'promptIrEditRecovery.receiptSha256')
  if (canonicalJsonSha256(root.receipt, 'promptIrEditRecovery.receipt') !== receiptSha256) {
    throw new UpstreamContractError('promptIrEditRecovery receipt sha256 mismatch')
  }
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizePromptIrEditCommit(root.receipt, expected),
  }
}

function normalizePromptIrSelection(
  value: unknown,
  expected: YimengSelectPromptIrRequest,
  expectedChangeSetId?: string,
): YimengSelectPromptIrResponse {
  const root = requireObject(value, 'promptIrSelection')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'eventType',
    'projectId',
    'episodeId',
    'targetType',
    'targetId',
    'storyboardRevisionId',
    'frameId',
    'selectedPromptIr',
    'stalePromptIrIds',
    'idempotencyKey',
    'changed',
    'providerCall',
    'workerStarted',
    'humanApprovalInferred',
    'humanSignoff',
    'deduplicated',
    'committedAt',
  ], 'promptIrSelection')
  if (root.schema !== 'jason.qingmu-prompt-ir-selection-result.v1') {
    throw new UpstreamContractError('promptIrSelection.schema mismatch')
  }
  if (root.eventType !== 'PromptIrSelected') throw new UpstreamContractError('promptIrSelection.eventType mismatch')
  if (root.targetType !== 'prompt_ir') throw new UpstreamContractError('promptIrSelection.targetType mismatch')
  if (root.changed !== true) throw new UpstreamContractError('promptIrSelection.changed must be true')
  if (root.providerCall !== false) throw new UpstreamContractError('promptIrSelection.providerCall must be false')
  if (root.workerStarted !== false) throw new UpstreamContractError('promptIrSelection.workerStarted must be false')
  if (root.humanApprovalInferred !== false) {
    throw new UpstreamContractError('promptIrSelection.humanApprovalInferred must be false')
  }
  if (root.humanSignoff !== false) throw new UpstreamContractError('promptIrSelection.humanSignoff must be false')
  const selectedPromptIr = normalizePromptIrRecord(
    root.selectedPromptIr,
    'promptIrSelection.selectedPromptIr',
    'Ready',
  )
  const result: YimengSelectPromptIrResponse = {
    schema: 'jason.qingmu-prompt-ir-selection-result.v1',
    changeSetId: requireString(root.changeSetId, 'promptIrSelection.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'promptIrSelection.commandReceiptId'),
    eventId: requireString(root.eventId, 'promptIrSelection.eventId'),
    eventType: 'PromptIrSelected',
    projectId: requireString(root.projectId, 'promptIrSelection.projectId'),
    episodeId: requireString(root.episodeId, 'promptIrSelection.episodeId'),
    targetType: 'prompt_ir',
    targetId: requireString(root.targetId, 'promptIrSelection.targetId'),
    storyboardRevisionId: requireString(
      root.storyboardRevisionId,
      'promptIrSelection.storyboardRevisionId',
    ),
    frameId: requireString(root.frameId, 'promptIrSelection.frameId'),
    selectedPromptIr: { ...selectedPromptIr, status: 'Ready' },
    stalePromptIrIds: requireStringArray(root.stalePromptIrIds, 'promptIrSelection.stalePromptIrIds'),
    idempotencyKey: requireString(root.idempotencyKey, 'promptIrSelection.idempotencyKey'),
    changed: true,
    providerCall: false,
    workerStarted: false,
    humanApprovalInferred: false,
    humanSignoff: false,
    deduplicated: requireBoolean(root.deduplicated, 'promptIrSelection.deduplicated'),
    committedAt: requireString(root.committedAt, 'promptIrSelection.committedAt'),
  }
  const targetId = `${expected.storyboardRevisionId}:${expected.frameId}`
  if (
    (expectedChangeSetId !== undefined && result.changeSetId !== expectedChangeSetId)
    || result.projectId !== expected.projectId
    || result.episodeId !== expected.episodeId
    || result.targetId !== targetId
    || result.storyboardRevisionId !== expected.storyboardRevisionId
    || result.frameId !== expected.frameId
    || result.selectedPromptIr.id !== expected.draftPromptIrId
    || result.selectedPromptIr.version !== expected.draftVersion
    || result.selectedPromptIr.contentSha256 !== expected.draftContentSha256
    || result.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new UpstreamContractError('promptIrSelection lineage mismatch')
  }
  return result
}

function normalizePromptIrSelectionRecovery(
  value: unknown,
  expected: YimengRecoverPromptIrSelectionRequest,
): YimengRecoverPromptIrSelectionResponse {
  const root = requireObject(value, 'promptIrSelectionRecovery')
  assertExactOutputKeys(
    root,
    ['schema', 'recovered', 'receiptSha256', 'receipt'],
    'promptIrSelectionRecovery',
  )
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1' || root.recovered !== true) {
    throw new UpstreamContractError('promptIrSelectionRecovery envelope mismatch')
  }
  const receiptSha256 = requireSha256(
    root.receiptSha256,
    'promptIrSelectionRecovery.receiptSha256',
  )
  if (canonicalJsonSha256(root.receipt, 'promptIrSelectionRecovery.receipt') !== receiptSha256) {
    throw new UpstreamContractError('promptIrSelectionRecovery receipt sha256 mismatch')
  }
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizePromptIrSelection(root.receipt, expected),
  }
}

function normalizeElementProfileSubject(
  value: unknown,
  field: string,
  expectedElementKind: YimengElementKind,
): YimengCommandJsonObject {
  const subject = requireObject(value, field)
  if (subject.schema !== 'jason.qingmu-element-profile-subject.v2') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  if (subject.targetType !== 'element_profile') throw new UpstreamContractError(`${field}.targetType mismatch`)
  const elementKind = requireElementKind(subject.elementKind, `${field}.elementKind`)
  if (elementKind !== expectedElementKind) throw new UpstreamContractError(`${field}.elementKind mismatch`)
  assertExactOutputKeys(subject, [
    'schema',
    'projectId',
    'targetType',
    'elementKind',
    'profileRevision',
    'name',
    'officialReferenceImageUrl',
    'references',
    ...(elementKind === 'actor'
      ? ['actorId', 'visualIdentity']
      : elementKind === 'scene'
        ? ['sceneId', 'sceneType', 'visualPrompt']
        : ['propId', 'visualPrompt']),
  ], field)
  const references = requireObjectArray(subject.references, `${field}.references`).map((value, index) => {
    const referenceField = `${field}.references[${String(index)}]`
    assertExactOutputKeys(value, [
      'assetId',
      'sha256',
      'selectionStatus',
      'isSelected',
      'rightsRecorded',
      'rights',
      ...(elementKind === 'prop' ? [] : ['role']),
    ], referenceField)
    return {
      assetId: requireString(value.assetId, `${referenceField}.assetId`),
      sha256: requireSha256(value.sha256, `${referenceField}.sha256`),
      selectionStatus: requireString(value.selectionStatus, `${referenceField}.selectionStatus`),
      isSelected: requireBoolean(value.isSelected, `${referenceField}.isSelected`),
      rightsRecorded: requireBoolean(value.rightsRecorded, `${referenceField}.rightsRecorded`),
      rights: normalizeUpstreamReferenceRightsRecord(value.rights, `${referenceField}.rights`),
      ...(elementKind === 'prop' ? {} : { role: requireString(value.role, `${referenceField}.role`) }),
    }
  })
  const common = {
    schema: 'jason.qingmu-element-profile-subject.v2',
    projectId: requireString(subject.projectId, `${field}.projectId`),
    targetType: 'element_profile',
    elementKind,
    profileRevision: requireInteger(subject.profileRevision, `${field}.profileRevision`),
    name: requireString(subject.name, `${field}.name`),
    officialReferenceImageUrl: requireNullableString(
      subject.officialReferenceImageUrl,
      `${field}.officialReferenceImageUrl`,
    ),
    references,
  }
  if (elementKind === 'actor') {
    return {
      ...common,
      actorId: requireString(subject.actorId, `${field}.actorId`),
      visualIdentity: requireStringValue(subject.visualIdentity, `${field}.visualIdentity`),
    }
  }
  if (elementKind === 'scene') {
    return {
      ...common,
      sceneId: requireString(subject.sceneId, `${field}.sceneId`),
      sceneType: requireString(subject.sceneType, `${field}.sceneType`),
      visualPrompt: requireStringValue(subject.visualPrompt, `${field}.visualPrompt`),
    }
  }
  return {
    ...common,
    propId: requireString(subject.propId, `${field}.propId`),
    visualPrompt: requireStringValue(subject.visualPrompt, `${field}.visualPrompt`),
  }
}

function normalizeElementProposal(
  value: unknown,
  expected: YimengProposeElementProfileRequest | YimengProposeReferenceAssetRequest,
): YimengProposeElementProfileResponse {
  const root = requireObject(value, 'proposal')
  if (root.schema !== 'jason.qingmu-change-set-proposal.v1') throw new UpstreamContractError('proposal.schema mismatch')
  if (root.nextAction !== 'preview') throw new UpstreamContractError('proposal.nextAction mismatch')
  const result: YimengProposeElementProfileResponse = {
    ...root,
    schema: 'jason.qingmu-change-set-proposal.v1',
    changeSet: normalizeElementProfileChangeSet(root.changeSet),
    nextAction: 'preview',
  }
  if (result.changeSet.projectId !== expected.projectId || result.changeSet.targetId !== expected.targetId) {
    throw new UpstreamContractError('proposal element subject mismatch')
  }
  if (result.changeSet.baseRevision !== expected.baseRevision) {
    throw new UpstreamContractError('proposal baseRevision mismatch')
  }
  if (result.changeSet.baseSnapshotSha256 !== expected.baseSnapshotSha256) {
    throw new UpstreamContractError('proposal base snapshot lineage mismatch')
  }
  return result
}

function requireElementCoordinates(
  value: YimengCommandJsonObject,
  field: string,
  elementKind: YimengElementKind,
): { projectId: string; targetId: string; profileRevision: number } {
  const idField = elementKind === 'actor' ? 'actorId' : elementKind === 'scene' ? 'sceneId' : 'propId'
  return {
    projectId: requireString(value.projectId, `${field}.projectId`),
    targetId: requireString(value[idField], `${field}.${idField}`),
    profileRevision: requireInteger(value.profileRevision, `${field}.profileRevision`),
  }
}

function assertExactOutputKeys(
  value: YimengCommandJsonObject,
  expectedKeys: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new UpstreamContractError(`${field} fields mismatch`)
  }
}

function isReferenceActionElementRequest(
  request: YimengPreviewElementProfileRequest,
): request is YimengReferencePreviewElementProfileRequest {
  return 'operation' in request && request.operation !== 'replaceReferenceRights'
}

function isReferenceRightsElementRequest(
  request: YimengPreviewElementProfileRequest,
): request is YimengReferenceRightsPreviewElementProfileRequest {
  return 'operation' in request && request.operation === 'replaceReferenceRights'
}

function isAnyReferenceElementRequest(request: YimengPreviewElementProfileRequest): boolean {
  return 'operation' in request
}

function normalizeReferenceElementPreview(
  value: unknown,
  expected: YimengReferencePreviewElementProfileRequest,
): YimengReferencePreviewElementProfileResponse {
  const root = requireObject(value, 'preview')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'candidateAssetId',
    'candidateAssetSha256',
    'candidateDrift',
    'canCommit',
    'providerCalls',
    'workerStarted',
    'humanApprovalInferred',
  ], 'preview')
  if (root.schema !== 'jason.qingmu-reference-asset-preview.v1') {
    throw new UpstreamContractError('preview.schema mismatch')
  }
  if (root.targetType !== 'element_profile') throw new UpstreamContractError('preview.targetType mismatch')
  const result: YimengReferencePreviewElementProfileResponse = {
    schema: 'jason.qingmu-reference-asset-preview.v1',
    changeSetId: requireString(root.changeSetId, 'preview.changeSetId'),
    projectId: requireString(root.projectId, 'preview.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'preview.targetId'),
    elementKind: requireElementKind(root.elementKind, 'preview.elementKind'),
    operation: requireReferenceActionOperation(root.operation, 'preview.operation'),
    candidateAssetId: requireString(root.candidateAssetId, 'preview.candidateAssetId'),
    candidateAssetSha256: requireSha256(root.candidateAssetSha256, 'preview.candidateAssetSha256'),
    candidateDrift: requireBoolean(root.candidateDrift, 'preview.candidateDrift'),
    canCommit: requireBoolean(root.canCommit, 'preview.canCommit'),
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
  }
  if (root.providerCalls !== 0 || root.workerStarted !== false || root.humanApprovalInferred !== false) {
    throw new UpstreamContractError('preview zero-execution or approval boundary mismatch')
  }
  if (
    result.changeSetId !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
    || result.elementKind !== expected.elementKind
    || result.operation !== expected.operation
    || result.candidateAssetId !== expected.candidateAssetId
    || result.candidateAssetSha256 !== expected.candidateAssetSha256
  ) {
    throw new UpstreamContractError('preview reference lineage mismatch')
  }
  if (result.candidateDrift && result.canCommit) {
    throw new UpstreamContractError('preview drift cannot be committable')
  }
  return result
}

function normalizeReferenceElementCommit(
  value: unknown,
  expected: YimengCommitElementProfileRequest & YimengReferencePreviewElementProfileRequest,
): YimengReferenceCommitElementProfileResponse {
  const root = requireObject(value, 'commit')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'eventType',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'candidateAssetId',
    'candidateAssetSha256',
    'baseRevision',
    'authoritativeRevision',
    'authoritativeSnapshotSha256',
    'payloadSha256',
    'idempotencyKey',
    'changed',
    'providerCalls',
    'workerStarted',
    'humanApprovalInferred',
    'deduplicated',
    'committedAt',
  ], 'commit')
  if (root.schema !== 'jason.qingmu-reference-asset-commit-result.v1') {
    throw new UpstreamContractError('commit.schema mismatch')
  }
  if (root.targetType !== 'element_profile') throw new UpstreamContractError('commit.targetType mismatch')
  const operation = requireReferenceActionOperation(root.operation, 'commit.operation')
  const eventType = root.eventType
  if (eventType !== 'ReferenceAssetSelected' && eventType !== 'ReferenceRegenerationRequested') {
    throw new UpstreamContractError('commit.eventType mismatch')
  }
  if (
    root.changed !== true
    || root.providerCalls !== 0
    || root.workerStarted !== false
    || root.humanApprovalInferred !== false
  ) {
    throw new UpstreamContractError('commit zero-execution or approval boundary mismatch')
  }
  const result: YimengReferenceCommitElementProfileResponse = {
    schema: 'jason.qingmu-reference-asset-commit-result.v1',
    changeSetId: requireString(root.changeSetId, 'commit.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'commit.commandReceiptId'),
    eventId: requireString(root.eventId, 'commit.eventId'),
    eventType,
    projectId: requireString(root.projectId, 'commit.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'commit.targetId'),
    elementKind: requireElementKind(root.elementKind, 'commit.elementKind'),
    operation,
    candidateAssetId: requireString(root.candidateAssetId, 'commit.candidateAssetId'),
    candidateAssetSha256: requireSha256(root.candidateAssetSha256, 'commit.candidateAssetSha256'),
    baseRevision: requireInteger(root.baseRevision, 'commit.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'commit.authoritativeRevision'),
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'commit.authoritativeSnapshotSha256',
    ),
    payloadSha256: requireSha256(root.payloadSha256, 'commit.payloadSha256'),
    idempotencyKey: requireString(root.idempotencyKey, 'commit.idempotencyKey'),
    changed: true,
    providerCalls: 0,
    workerStarted: false,
    humanApprovalInferred: false,
    deduplicated: requireBoolean(root.deduplicated, 'commit.deduplicated'),
    committedAt: requireString(root.committedAt, 'commit.committedAt'),
  }
  const expectedEventType = operation === 'selectReferenceAsset'
    ? 'ReferenceAssetSelected'
    : 'ReferenceRegenerationRequested'
  if (
    result.changeSetId !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
    || result.elementKind !== expected.elementKind
    || result.operation !== expected.operation
    || result.candidateAssetId !== expected.candidateAssetId
    || result.candidateAssetSha256 !== expected.candidateAssetSha256
    || result.baseRevision !== expected.baseRevision
    || result.payloadSha256 !== expected.expectedPayloadSha256
    || result.idempotencyKey !== expected.idempotencyKey
    || result.eventType !== expectedEventType
  ) {
    throw new UpstreamContractError('commit reference lineage mismatch')
  }
  return result
}

function normalizeReferenceRightsElementPreview(
  value: unknown,
  expected: YimengReferenceRightsPreviewElementProfileRequest,
): YimengReferenceRightsPreviewElementProfileResponse {
  const root = requireObject(value, 'preview')
  assertExactOutputKeys(root, [
    'schema',
    'changeSet',
    'baseSubject',
    'authoritativeCurrentSubject',
    'changeSetId',
    'payloadSha256',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'baseRevision',
    'authoritativeRevision',
    'baseSnapshotSha256',
    'authoritativeSnapshotSha256',
    'changed',
    'authoritativeChanged',
    'revisionConflict',
    'baseSnapshotConflict',
    'impactConflict',
    'canCommit',
    'referenceInvalidationExpected',
    'impactAnalysis',
    'impactSha256',
    'preflight',
    'references',
    'methodProjectionSha256',
    'referenceAssetId',
    'referenceAssetSha256',
    'proposedReferenceRights',
    'previewSha256',
  ], 'preview')
  if (root.schema !== 'jason.qingmu-change-set-preview.v1' || root.targetType !== 'element_profile') {
    throw new UpstreamContractError('preview schema or targetType mismatch')
  }
  if (root.operation !== 'replaceReferenceRights') throw new UpstreamContractError('preview.operation mismatch')
  const elementKind = requireElementKind(root.elementKind, 'preview.elementKind')
  const baseSubject = normalizeElementProfileSubject(root.baseSubject, 'preview.baseSubject', elementKind)
  const authoritativeCurrentSubject = normalizeElementProfileSubject(
    root.authoritativeCurrentSubject,
    'preview.authoritativeCurrentSubject',
    elementKind,
  )
  const impactAnalysis = normalizeElementImpactAnalysis(root.impactAnalysis, 'preview.impactAnalysis')
  const impactSha256 = requireSha256(root.impactSha256, 'preview.impactSha256')
  if (canonicalJsonSha256(impactAnalysis, 'preview.impactAnalysis') !== impactSha256) {
    throw new UpstreamContractError('preview impact sha256 mismatch')
  }
  const preflight = requireObject(root.preflight, 'preview.preflight')
  if (
    preflight.status !== 'pass'
    || preflight.costGate !== 'not_granted'
    || preflight.selectionAuthority !== 'not_granted'
    || preflight.humanApprovalInferred !== false
  ) {
    throw new UpstreamContractError('preview preflight authority mismatch')
  }
  const result: YimengReferenceRightsPreviewElementProfileResponse = {
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet: normalizeElementProfileChangeSet(root.changeSet),
    baseSubject,
    authoritativeCurrentSubject,
    changeSetId: requireString(root.changeSetId, 'preview.changeSetId'),
    payloadSha256: requireSha256(root.payloadSha256, 'preview.payloadSha256'),
    projectId: requireString(root.projectId, 'preview.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'preview.targetId'),
    elementKind,
    operation: 'replaceReferenceRights',
    referenceAssetId: requireString(root.referenceAssetId, 'preview.referenceAssetId'),
    referenceAssetSha256: requireSha256(root.referenceAssetSha256, 'preview.referenceAssetSha256'),
    proposedReferenceRights: normalizeUpstreamReferenceRightsRecord(
      root.proposedReferenceRights,
      'preview.proposedReferenceRights',
    ),
    baseRevision: requireInteger(root.baseRevision, 'preview.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'preview.authoritativeRevision'),
    baseSnapshotSha256: requireSha256(root.baseSnapshotSha256, 'preview.baseSnapshotSha256'),
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'preview.authoritativeSnapshotSha256',
    ),
    changed: requireBoolean(root.changed, 'preview.changed'),
    authoritativeChanged: requireBoolean(root.authoritativeChanged, 'preview.authoritativeChanged'),
    revisionConflict: requireBoolean(root.revisionConflict, 'preview.revisionConflict'),
    baseSnapshotConflict: requireBoolean(root.baseSnapshotConflict, 'preview.baseSnapshotConflict'),
    impactConflict: requireBoolean(root.impactConflict, 'preview.impactConflict'),
    canCommit: requireBoolean(root.canCommit, 'preview.canCommit'),
    referenceInvalidationExpected: requireBoolean(
      root.referenceInvalidationExpected,
      'preview.referenceInvalidationExpected',
    ),
    impactAnalysis,
    impactSha256,
    preflight,
    references: requireObjectArray(root.references, 'preview.references'),
    methodProjectionSha256: requireSha256(root.methodProjectionSha256, 'preview.methodProjectionSha256'),
    previewSha256: requireSha256(root.previewSha256, 'preview.previewSha256'),
  }
  const baseCoordinates = requireElementCoordinates(baseSubject, 'preview.baseSubject', elementKind)
  const currentCoordinates = requireElementCoordinates(
    authoritativeCurrentSubject,
    'preview.authoritativeCurrentSubject',
    elementKind,
  )
  if (
    result.changeSetId !== expected.changeSetId
    || result.changeSet.id !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
    || result.elementKind !== expected.elementKind
    || result.referenceAssetId !== expected.referenceAssetId
    || result.referenceAssetSha256 !== expected.referenceAssetSha256
    || result.changeSet.projectId !== expected.projectId
    || result.changeSet.targetId !== expected.targetId
    || baseCoordinates.projectId !== expected.projectId
    || baseCoordinates.targetId !== expected.targetId
    || currentCoordinates.projectId !== expected.projectId
    || currentCoordinates.targetId !== expected.targetId
  ) {
    throw new UpstreamContractError('preview reference rights subject mismatch')
  }
  if (result.payloadSha256 !== result.changeSet.payloadSha256) {
    throw new UpstreamContractError('preview payload lineage mismatch')
  }
  if (
    result.baseRevision !== expected.baseRevision
    || result.baseRevision !== result.changeSet.baseRevision
    || result.baseRevision !== baseCoordinates.profileRevision
    || result.authoritativeRevision !== currentCoordinates.profileRevision
  ) {
    throw new UpstreamContractError('preview revision lineage mismatch')
  }
  if (
    result.baseSnapshotSha256 !== expected.baseSnapshotSha256
    || result.baseSnapshotSha256 !== result.changeSet.baseSnapshotSha256
    || canonicalJsonSha256(baseSubject, 'preview.baseSubject') !== result.baseSnapshotSha256
    || canonicalJsonSha256(authoritativeCurrentSubject, 'preview.authoritativeCurrentSubject')
      !== result.authoritativeSnapshotSha256
  ) {
    throw new UpstreamContractError('preview snapshot lineage mismatch')
  }
  if (result.canCommit && (result.revisionConflict || result.baseSnapshotConflict || result.impactConflict)) {
    throw new UpstreamContractError('preview conflict cannot be committable')
  }
  return result
}

function normalizeReferenceRightsElementCommit(
  value: unknown,
  expected: YimengCommitElementProfileRequest & YimengReferenceRightsPreviewElementProfileRequest,
): YimengReferenceRightsCommitElementProfileResponse {
  const root = requireObject(value, 'commit')
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'eventType',
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'operation',
    'referenceAssetId',
    'referenceAssetSha256',
    'baseRevision',
    'authoritativeRevision',
    'authoritativeSnapshotSha256',
    'payloadSha256',
    'idempotencyKey',
    'changed',
    'referenceInvalidated',
    'impactAnalysis',
    'impactSha256',
    'deduplicated',
    'committedAt',
  ], 'commit')
  if (root.schema !== 'jason.qingmu-element-profile-commit-result.v1' || root.targetType !== 'element_profile') {
    throw new UpstreamContractError('commit schema or targetType mismatch')
  }
  if (root.operation !== 'replaceReferenceRights') throw new UpstreamContractError('commit.operation mismatch')
  if (root.eventType !== 'ElementProfileChanged' && root.eventType !== 'ReferenceInvalidated') {
    throw new UpstreamContractError('commit.eventType mismatch')
  }
  const impactAnalysis = normalizeElementImpactAnalysis(root.impactAnalysis, 'commit.impactAnalysis')
  const impactSha256 = requireSha256(root.impactSha256, 'commit.impactSha256')
  if (canonicalJsonSha256(impactAnalysis, 'commit.impactAnalysis') !== impactSha256) {
    throw new UpstreamContractError('commit impact sha256 mismatch')
  }
  const result: YimengReferenceRightsCommitElementProfileResponse = {
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: requireString(root.changeSetId, 'commit.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'commit.commandReceiptId'),
    eventId: requireString(root.eventId, 'commit.eventId'),
    eventType: root.eventType,
    projectId: requireString(root.projectId, 'commit.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'commit.targetId'),
    elementKind: requireElementKind(root.elementKind, 'commit.elementKind'),
    operation: 'replaceReferenceRights',
    referenceAssetId: requireString(root.referenceAssetId, 'commit.referenceAssetId'),
    referenceAssetSha256: requireSha256(root.referenceAssetSha256, 'commit.referenceAssetSha256'),
    baseRevision: requireInteger(root.baseRevision, 'commit.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'commit.authoritativeRevision'),
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'commit.authoritativeSnapshotSha256',
    ),
    payloadSha256: requireSha256(root.payloadSha256, 'commit.payloadSha256'),
    idempotencyKey: requireString(root.idempotencyKey, 'commit.idempotencyKey'),
    changed: requireBoolean(root.changed, 'commit.changed'),
    referenceInvalidated: requireBoolean(root.referenceInvalidated, 'commit.referenceInvalidated'),
    impactAnalysis,
    impactSha256,
    deduplicated: requireBoolean(root.deduplicated, 'commit.deduplicated'),
    committedAt: requireString(root.committedAt, 'commit.committedAt'),
  }
  if (
    result.changeSetId !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
    || result.elementKind !== expected.elementKind
    || result.referenceAssetId !== expected.referenceAssetId
    || result.referenceAssetSha256 !== expected.referenceAssetSha256
    || result.baseRevision !== expected.baseRevision
    || result.authoritativeRevision !== expected.baseRevision + Number(result.changed)
    || result.payloadSha256 !== expected.expectedPayloadSha256
    || result.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new UpstreamContractError('commit reference rights lineage mismatch')
  }
  const expectedEventType = result.referenceInvalidated ? 'ReferenceInvalidated' : 'ElementProfileChanged'
  if (result.eventType !== expectedEventType || (result.referenceInvalidated && !result.changed)) {
    throw new UpstreamContractError('commit reference rights event lineage mismatch')
  }
  return result
}

function normalizeElementPreview(
  value: unknown,
  expected: YimengPreviewElementProfileRequest,
): YimengPreviewElementProfileResponse {
  if (isReferenceRightsElementRequest(expected)) return normalizeReferenceRightsElementPreview(value, expected)
  if (isReferenceActionElementRequest(expected)) return normalizeReferenceElementPreview(value, expected)
  const root = requireObject(value, 'preview')
  if (root.schema !== 'jason.qingmu-change-set-preview.v1') throw new UpstreamContractError('preview.schema mismatch')
  if (root.targetType !== 'element_profile') throw new UpstreamContractError('preview.targetType mismatch')
  const elementKind = requireElementKind(root.elementKind, 'preview.elementKind')
  if (elementKind !== expected.elementKind) throw new UpstreamContractError('preview.elementKind mismatch')
  const operation = requireElementOperation(root.operation, elementKind, 'preview.operation')
  const baseSubject = normalizeElementProfileSubject(root.baseSubject, 'preview.baseSubject', elementKind)
  const authoritativeCurrentSubject = normalizeElementProfileSubject(
    root.authoritativeCurrentSubject,
    'preview.authoritativeCurrentSubject',
    elementKind,
  )
  const impactAnalysis = normalizeElementImpactAnalysis(root.impactAnalysis, 'preview.impactAnalysis')
  const impactSha256 = requireSha256(root.impactSha256, 'preview.impactSha256')
  if (canonicalJsonSha256(impactAnalysis, 'preview.impactAnalysis') !== impactSha256) {
    throw new UpstreamContractError('preview impact sha256 mismatch')
  }
  const proposed = elementKind === 'actor'
    ? { proposedVisualIdentity: requireString(root.proposedVisualIdentity, 'preview.proposedVisualIdentity') }
    : { proposedVisualPrompt: requireString(root.proposedVisualPrompt, 'preview.proposedVisualPrompt') }
  if (
    (elementKind === 'actor' && root.proposedVisualPrompt !== undefined)
    || (elementKind !== 'actor' && root.proposedVisualIdentity !== undefined)
  ) {
    throw new UpstreamContractError('preview proposed field does not match elementKind')
  }
  const preflight = requireObject(root.preflight, 'preview.preflight')
  if (
    preflight.status !== 'pass'
    || preflight.costGate !== 'not_granted'
    || preflight.selectionAuthority !== 'not_granted'
    || preflight.humanApprovalInferred !== false
  ) {
    throw new UpstreamContractError('preview preflight authority mismatch')
  }
  const result: YimengVisualPreviewElementProfileResponse = {
    ...root,
    schema: 'jason.qingmu-change-set-preview.v1',
    changeSet: normalizeElementProfileChangeSet(root.changeSet),
    baseSubject,
    ...proposed,
    authoritativeCurrentSubject,
    changeSetId: requireString(root.changeSetId, 'preview.changeSetId'),
    payloadSha256: requireSha256(root.payloadSha256, 'preview.payloadSha256'),
    projectId: requireString(root.projectId, 'preview.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'preview.targetId'),
    elementKind,
    operation,
    baseRevision: requireInteger(root.baseRevision, 'preview.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'preview.authoritativeRevision'),
    baseSnapshotSha256: requireSha256(root.baseSnapshotSha256, 'preview.baseSnapshotSha256'),
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'preview.authoritativeSnapshotSha256',
    ),
    changed: requireBoolean(root.changed, 'preview.changed'),
    authoritativeChanged: requireBoolean(root.authoritativeChanged, 'preview.authoritativeChanged'),
    revisionConflict: requireBoolean(root.revisionConflict, 'preview.revisionConflict'),
    baseSnapshotConflict: requireBoolean(root.baseSnapshotConflict, 'preview.baseSnapshotConflict'),
    canCommit: requireBoolean(root.canCommit, 'preview.canCommit'),
    referenceInvalidationExpected: requireBoolean(
      root.referenceInvalidationExpected,
      'preview.referenceInvalidationExpected',
    ),
    impactAnalysis,
    impactSha256,
    preflight,
    references: requireObjectArray(root.references, 'preview.references'),
    methodProjectionSha256: requireSha256(root.methodProjectionSha256, 'preview.methodProjectionSha256'),
    previewSha256: requireSha256(root.previewSha256, 'preview.previewSha256'),
  }
  const baseCoordinates = requireElementCoordinates(baseSubject, 'preview.baseSubject', elementKind)
  const currentCoordinates = requireElementCoordinates(
    authoritativeCurrentSubject,
    'preview.authoritativeCurrentSubject',
    elementKind,
  )
  if (
    result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
    || result.changeSet.projectId !== expected.projectId
    || result.changeSet.targetId !== expected.targetId
    || baseCoordinates.projectId !== expected.projectId
    || baseCoordinates.targetId !== expected.targetId
    || currentCoordinates.projectId !== expected.projectId
    || currentCoordinates.targetId !== expected.targetId
  ) {
    throw new UpstreamContractError('preview element subject mismatch')
  }
  if (result.changeSetId !== expected.changeSetId || result.changeSet.id !== expected.changeSetId) {
    throw new UpstreamContractError('preview changeSet subject mismatch')
  }
  if (result.payloadSha256 !== result.changeSet.payloadSha256) {
    throw new UpstreamContractError('preview payload lineage mismatch')
  }
  if (
    result.baseRevision !== expected.baseRevision
    || result.baseRevision !== result.changeSet.baseRevision
    || result.baseRevision !== baseCoordinates.profileRevision
    || result.authoritativeRevision !== currentCoordinates.profileRevision
  ) {
    throw new UpstreamContractError('preview revision lineage mismatch')
  }
  if (
    result.baseSnapshotSha256 !== expected.baseSnapshotSha256
    || result.baseSnapshotSha256 !== result.changeSet.baseSnapshotSha256
    || canonicalJsonSha256(baseSubject, 'preview.baseSubject') !== result.baseSnapshotSha256
    || canonicalJsonSha256(authoritativeCurrentSubject, 'preview.authoritativeCurrentSubject')
      !== result.authoritativeSnapshotSha256
  ) {
    throw new UpstreamContractError('preview snapshot lineage mismatch')
  }
  if (result.canCommit && (result.revisionConflict || result.baseSnapshotConflict)) {
    throw new UpstreamContractError('preview conflict cannot be committable')
  }
  return result
}

function normalizeElementCommit(
  value: unknown,
  expected: YimengCommitElementProfileRequest,
): YimengCommitElementProfileResponse {
  if (isReferenceRightsElementRequest(expected)) return normalizeReferenceRightsElementCommit(value, expected)
  if (isReferenceActionElementRequest(expected)) return normalizeReferenceElementCommit(value, expected)
  const root = requireObject(value, 'commit')
  if (root.schema !== 'jason.qingmu-element-profile-commit-result.v1') {
    throw new UpstreamContractError('commit.schema mismatch')
  }
  if (root.targetType !== 'element_profile') throw new UpstreamContractError('commit.targetType mismatch')
  const elementKind = requireElementKind(root.elementKind, 'commit.elementKind')
  if (elementKind !== expected.elementKind) throw new UpstreamContractError('commit.elementKind mismatch')
  const operation = requireElementOperation(root.operation, elementKind, 'commit.operation')
  if (root.eventType !== 'ElementProfileChanged' && root.eventType !== 'ReferenceInvalidated') {
    throw new UpstreamContractError('commit.eventType mismatch')
  }
  const impactAnalysis = normalizeElementImpactAnalysis(root.impactAnalysis, 'commit.impactAnalysis')
  const impactSha256 = requireSha256(root.impactSha256, 'commit.impactSha256')
  if (canonicalJsonSha256(impactAnalysis, 'commit.impactAnalysis') !== impactSha256) {
    throw new UpstreamContractError('commit impact sha256 mismatch')
  }
  const result: YimengVisualCommitElementProfileResponse = {
    ...root,
    schema: 'jason.qingmu-element-profile-commit-result.v1',
    changeSetId: requireString(root.changeSetId, 'commit.changeSetId'),
    commandReceiptId: requireString(root.commandReceiptId, 'commit.commandReceiptId'),
    eventId: requireString(root.eventId, 'commit.eventId'),
    eventType: root.eventType,
    projectId: requireString(root.projectId, 'commit.projectId'),
    targetType: 'element_profile',
    targetId: requireString(root.targetId, 'commit.targetId'),
    elementKind,
    operation,
    baseRevision: requireInteger(root.baseRevision, 'commit.baseRevision'),
    authoritativeRevision: requireInteger(root.authoritativeRevision, 'commit.authoritativeRevision'),
    authoritativeSnapshotSha256: requireSha256(
      root.authoritativeSnapshotSha256,
      'commit.authoritativeSnapshotSha256',
    ),
    payloadSha256: requireSha256(root.payloadSha256, 'commit.payloadSha256'),
    idempotencyKey: requireString(root.idempotencyKey, 'commit.idempotencyKey'),
    changed: requireBoolean(root.changed, 'commit.changed'),
    referenceInvalidated: requireBoolean(root.referenceInvalidated, 'commit.referenceInvalidated'),
    impactAnalysis,
    impactSha256,
    deduplicated: requireBoolean(root.deduplicated, 'commit.deduplicated'),
    committedAt: requireString(root.committedAt, 'commit.committedAt'),
  }
  if (
    result.changeSetId !== expected.changeSetId
    || result.projectId !== expected.projectId
    || result.targetId !== expected.targetId
  ) {
    throw new UpstreamContractError('commit element subject mismatch')
  }
  if (result.baseRevision !== expected.baseRevision) throw new UpstreamContractError('commit baseRevision lineage mismatch')
  if (result.payloadSha256 !== expected.expectedPayloadSha256) {
    throw new UpstreamContractError('commit payload lineage mismatch')
  }
  if (result.idempotencyKey !== expected.idempotencyKey) {
    throw new UpstreamContractError('commit idempotency lineage mismatch')
  }
  const expectedEventType = result.referenceInvalidated ? 'ReferenceInvalidated' : 'ElementProfileChanged'
  if (result.eventType !== expectedEventType || (result.referenceInvalidated && !result.changed)) {
    throw new UpstreamContractError('commit event lineage mismatch')
  }
  return result
}

function normalizeElementRecovery(
  value: unknown,
  expected: YimengRecoverElementProfileCommitRequest,
): YimengRecoverElementProfileCommitResponse {
  const root = requireObject(value, 'recovery')
  if (isAnyReferenceElementRequest(expected)) {
    assertExactOutputKeys(root, ['schema', 'recovered', 'receiptSha256', 'receipt'], 'recovery')
  }
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1') {
    throw new UpstreamContractError('recovery.schema mismatch')
  }
  if (root.recovered !== true) throw new UpstreamContractError('recovery.recovered mismatch')
  const receiptSha256 = requireSha256(root.receiptSha256, 'recovery.receiptSha256')
  if (canonicalJsonSha256(root.receipt, 'recovery.receipt') !== receiptSha256) {
    throw new UpstreamContractError('recovery receipt sha256 mismatch')
  }
  return {
    ...root,
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizeElementCommit(root.receipt, expected),
  }
}

function normalizeCreatedComment(
  value: unknown,
  expected: YimengCreateCommentRequest,
): YimengElementReviewComment {
  const comment = requireObject(value, 'commentResult.comment')
  assertExactOutputKeys(comment, [
    'id',
    'subjectType',
    'subjectId',
    'subjectRevision',
    'subjectSha256',
    'body',
    'actorId',
    'actorRole',
    'authSessionId',
    'createdAt',
  ], 'commentResult.comment')
  if (comment.subjectType !== 'element_profile') {
    throw new UpstreamContractError('commentResult.comment.subjectType must be element_profile')
  }
  if (comment.actorRole !== 'commenter') {
    throw new UpstreamContractError('commentResult.comment.actorRole must be commenter')
  }
  const result: YimengElementReviewComment = {
    id: requireString(comment.id, 'commentResult.comment.id'),
    subjectType: 'element_profile',
    subjectId: requireString(comment.subjectId, 'commentResult.comment.subjectId'),
    subjectRevision: requireInteger(comment.subjectRevision, 'commentResult.comment.subjectRevision'),
    subjectSha256: requireSha256(comment.subjectSha256, 'commentResult.comment.subjectSha256'),
    body: requireString(comment.body, 'commentResult.comment.body'),
    actorId: requireString(comment.actorId, 'commentResult.comment.actorId'),
    actorRole: 'commenter',
    authSessionId: requireString(comment.authSessionId, 'commentResult.comment.authSessionId'),
    createdAt: requireString(comment.createdAt, 'commentResult.comment.createdAt'),
  }
  if (
    result.subjectId !== expected.targetId
    || result.subjectRevision !== expected.expectedSubjectRevision
    || result.subjectSha256 !== expected.expectedSubjectSha256
    || result.body !== expected.body
  ) {
    throw new UpstreamContractError('commentResult comment lineage mismatch')
  }
  return result
}

function normalizeCreateCommentResponse(
  value: unknown,
  expected: YimengCreateCommentRequest,
): YimengCreateCommentResponse {
  const root = requireObject(value, 'commentResult')
  assertExactOutputKeys(root, ['schema', 'comment'], 'commentResult')
  if (root.schema !== 'jason.qingmu-element-comment-result.v1') {
    throw new UpstreamContractError('commentResult.schema mismatch')
  }
  return {
    schema: 'jason.qingmu-element-comment-result.v1',
    comment: normalizeCreatedComment(root.comment, expected),
  }
}

function normalizeCreatedHumanDecision(
  value: unknown,
  expected: YimengCreateHumanDecisionRequest,
): YimengHumanDecision {
  const decision = requireObject(value, 'humanDecisionResult.decision')
  assertExactOutputKeys(decision, [
    'id',
    'subjectType',
    'subjectId',
    'subjectRevision',
    'subjectSha256',
    'decision',
    'reason',
    'actorId',
    'actorRole',
    'authSessionId',
    'decidedAt',
  ], 'humanDecisionResult.decision')
  if (decision.subjectType !== 'element_profile') {
    throw new UpstreamContractError('humanDecisionResult.decision.subjectType must be element_profile')
  }
  if (decision.actorRole !== 'approver') {
    throw new UpstreamContractError('humanDecisionResult.decision.actorRole must be approver')
  }
  if (decision.decision !== 'approve' && decision.decision !== 'reject' && decision.decision !== 'request_changes') {
    throw new UpstreamContractError('humanDecisionResult.decision.decision is invalid')
  }
  const result: YimengHumanDecision = {
    id: requireString(decision.id, 'humanDecisionResult.decision.id'),
    subjectType: 'element_profile',
    subjectId: requireString(decision.subjectId, 'humanDecisionResult.decision.subjectId'),
    subjectRevision: requireInteger(decision.subjectRevision, 'humanDecisionResult.decision.subjectRevision'),
    subjectSha256: requireSha256(decision.subjectSha256, 'humanDecisionResult.decision.subjectSha256'),
    decision: decision.decision,
    reason: requireString(decision.reason, 'humanDecisionResult.decision.reason'),
    actorId: requireString(decision.actorId, 'humanDecisionResult.decision.actorId'),
    actorRole: 'approver',
    authSessionId: requireString(decision.authSessionId, 'humanDecisionResult.decision.authSessionId'),
    decidedAt: requireString(decision.decidedAt, 'humanDecisionResult.decision.decidedAt'),
  }
  if (
    result.subjectId !== expected.targetId
    || result.subjectRevision !== expected.expectedSubjectRevision
    || result.subjectSha256 !== expected.expectedSubjectSha256
    || result.decision !== expected.decision
    || result.reason !== expected.reason
  ) {
    throw new UpstreamContractError('humanDecisionResult decision lineage mismatch')
  }
  return result
}

function normalizeCreateHumanDecisionResponse(
  value: unknown,
  expected: YimengCreateHumanDecisionRequest,
): YimengCreateHumanDecisionResponse {
  const root = requireObject(value, 'humanDecisionResult')
  assertExactOutputKeys(root, ['schema', 'decision'], 'humanDecisionResult')
  if (root.schema !== 'jason.qingmu-element-human-decision-result.v1') {
    throw new UpstreamContractError('humanDecisionResult.schema mismatch')
  }
  return {
    schema: 'jason.qingmu-element-human-decision-result.v1',
    decision: normalizeCreatedHumanDecision(root.decision, expected),
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
  if (rightsFields.some((item, index) => item !== canonical[index])) {
    throw new UpstreamContractError(`${field}.rightsFields must use canonical order`)
  }
  return {
    kind: 'reference_rights',
    referenceAssetId: requireString(scope.referenceAssetId, `${field}.referenceAssetId`),
    referenceAssetSha256: requireSha256(scope.referenceAssetSha256, `${field}.referenceAssetSha256`),
    rightsRecordSha256: requireSha256(scope.rightsRecordSha256, `${field}.rightsRecordSha256`),
    rightsFields,
  }
}

function normalizeReferenceRightsExceptionReleaseFact(
  value: unknown,
  expected:
    | YimengCreateReferenceRightsExceptionReleaseRequest
    | YimengRecoverReferenceRightsExceptionReleaseRequest,
): YimengReferenceRightsExceptionReleaseFact {
  const field = 'referenceRightsExceptionReleaseResult.release'
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
  const scope = normalizeReferenceRightsExceptionScope(release.scope, `${field}.scope`)
  const actorNaturalPersonId = requireString(
    release.actorNaturalPersonId,
    `${field}.actorNaturalPersonId`,
  )
  const producerNaturalPersonId = requireString(
    release.producerNaturalPersonId,
    `${field}.producerNaturalPersonId`,
  )
  const assetProducerNaturalPersonId = requireString(
    release.assetProducerNaturalPersonId,
    `${field}.assetProducerNaturalPersonId`,
  )
  if (
    actorNaturalPersonId === producerNaturalPersonId
    || actorNaturalPersonId === assetProducerNaturalPersonId
  ) throw new UpstreamContractError(`${field} approver must differ from producers`)
  const fact: YimengReferenceRightsExceptionReleaseFact = {
    id: requireString(release.id, `${field}.id`),
    decision: 'exception_release',
    subjectType: 'element_profile',
    subjectId: requireString(release.subjectId, `${field}.subjectId`),
    subjectRevision: requireInteger(release.subjectRevision, `${field}.subjectRevision`),
    subjectSha256: requireSha256(release.subjectSha256, `${field}.subjectSha256`),
    scope,
    actorId: requireString(release.actorId, `${field}.actorId`),
    actorRole: 'approver',
    actorNaturalPersonId,
    producerActorId: requireString(release.producerActorId, `${field}.producerActorId`),
    producerNaturalPersonId,
    assetProducerActorId: requireString(release.assetProducerActorId, `${field}.assetProducerActorId`),
    assetProducerNaturalPersonId,
    assetProducerTaskId: requireString(release.assetProducerTaskId, `${field}.assetProducerTaskId`),
    assetProducerTaskRequestSha256: requireSha256(
      release.assetProducerTaskRequestSha256,
      `${field}.assetProducerTaskRequestSha256`,
    ),
    authSessionId: requireString(release.authSessionId, `${field}.authSessionId`),
    reason: requireString(release.reason, `${field}.reason`),
    releasedAt: requireRfc3339Timestamp(release.releasedAt, `${field}.releasedAt`),
  }
  if (
    fact.subjectId !== expected.targetId
    || fact.subjectRevision !== expected.expectedSubjectRevision
    || fact.subjectSha256 !== expected.expectedSubjectSha256
  ) throw new UpstreamContractError('referenceRightsExceptionReleaseResult release lineage mismatch')
  if ('scope' in expected) {
    if (
      fact.reason !== expected.reason
      || canonicalJson(fact.scope, `${field}.scope`) !== canonicalJson(expected.scope, 'expected.scope')
    ) throw new UpstreamContractError('referenceRightsExceptionReleaseResult release lineage mismatch')
  } else if (
    fact.scope.referenceAssetId !== expected.referenceAssetId
    || fact.scope.referenceAssetSha256 !== expected.referenceAssetSha256
    || fact.scope.rightsRecordSha256 !== expected.rightsRecordSha256
    || canonicalJsonSha256(fact.reason, `${field}.reason`) !== expected.reasonSha256
    || canonicalJsonSha256(fact.scope, `${field}.scope`) !== expected.scopeSha256
  ) {
    throw new UpstreamContractError('referenceRightsExceptionReleaseResult recovery digest mismatch')
  }
  if (fact.reason.trim().length === 0 || fact.reason.length > 8_000) {
    throw new UpstreamContractError(`${field}.reason must be between 1 and 8000 characters`)
  }
  return fact
}

function normalizeCreateReferenceRightsExceptionReleaseResponse(
  value: unknown,
  expected:
    | YimengCreateReferenceRightsExceptionReleaseRequest
    | YimengRecoverReferenceRightsExceptionReleaseRequest,
): YimengCreateReferenceRightsExceptionReleaseResponse {
  const field = 'referenceRightsExceptionReleaseResult'
  const root = requireObject(value, field)
  assertExactOutputKeys(root, [
    'schema',
    'changeSetId',
    'commandReceiptId',
    'eventId',
    'payloadSha256',
    'release',
    'changed',
    'providerCalls',
    'selectionAuthority',
    'humanApprovalInferred',
  ], field)
  if (root.schema !== 'jason.qingmu-reference-rights-exception-release-result.v1') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  if (root.changed !== false) throw new UpstreamContractError(`${field}.changed must be false`)
  if (root.providerCalls !== 0) throw new UpstreamContractError(`${field}.providerCalls must be zero`)
  if (root.selectionAuthority !== 'not_granted') {
    throw new UpstreamContractError(`${field}.selectionAuthority must be not_granted`)
  }
  if (root.humanApprovalInferred !== false) {
    throw new UpstreamContractError(`${field}.humanApprovalInferred must be false`)
  }
  return {
    schema: 'jason.qingmu-reference-rights-exception-release-result.v1',
    changeSetId: requireString(root.changeSetId, `${field}.changeSetId`),
    commandReceiptId: requireString(root.commandReceiptId, `${field}.commandReceiptId`),
    eventId: requireString(root.eventId, `${field}.eventId`),
    payloadSha256: requireSha256(root.payloadSha256, `${field}.payloadSha256`),
    release: normalizeReferenceRightsExceptionReleaseFact(root.release, expected),
    changed: false,
    providerCalls: 0,
    selectionAuthority: 'not_granted',
    humanApprovalInferred: false,
  }
}

function normalizeRecoverReferenceRightsExceptionReleaseResponse(
  value: unknown,
  expected: YimengRecoverReferenceRightsExceptionReleaseRequest,
): YimengRecoverReferenceRightsExceptionReleaseResponse {
  const field = 'referenceRightsExceptionReleaseRecovery'
  const root = requireObject(value, field)
  assertExactOutputKeys(root, ['schema', 'recovered', 'receiptSha256', 'receipt'], field)
  if (root.schema !== 'jason.qingmu-command-receipt-recovery.v1') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  if (root.recovered !== true) throw new UpstreamContractError(`${field}.recovered must be true`)
  const receiptSha256 = requireSha256(root.receiptSha256, `${field}.receiptSha256`)
  if (canonicalJsonSha256(root.receipt, `${field}.receipt`) !== receiptSha256) {
    throw new UpstreamContractError(`${field}.receiptSha256 mismatch`)
  }
  return {
    schema: 'jason.qingmu-command-receipt-recovery.v1',
    recovered: true,
    receiptSha256,
    receipt: normalizeCreateReferenceRightsExceptionReleaseResponse(root.receipt, expected),
  }
}

/**
 * Create the private command handler without registering it.
 * @param config - Loopback upstream and timeout settings.
 * @param dependencies - Host fetch and token source used by the isolated adapter.
 * @returns A Connection RPC handler for script, element-profile, comment, and HumanDecision operations.
 */
export function createYimengCommandHandler(
  config: YimengCommandAdapterConfig = {},
  dependencies: YimengCommandAdapterDependencies = {
    fetch: globalThis.fetch,
    readToken: () => process.env.YIMENG_API_TOKEN,
  },
): ConnectionRpcHandler {
  const baseUrl = resolveBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL)
  const timeoutMs = resolveTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return async (endpoint, payload, signal) => {
    try {
      const stageArtifactHelpers = {
        canonicalJson,
        canonicalJsonSha256,
        inputError: (message: string) => new InputError(message),
        responseError: (message: string) => new UpstreamContractError(message),
        readAttestationKey: readReferenceAttestationKey,
        requireTimestamp: requireRfc3339Timestamp,
      }
      if (endpoint === 'requestDirectorProposal') {
        const request = parseDirectorProposalRequest(payload, stageArtifactHelpers)
        const token = normalizeToken(dependencies.readToken())
        if (token === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        if (dependencies.runDirectorReplayMethod === undefined) {
          return internalError('current IMAGO director replay Method is unavailable')
        }
        const methodResult = await dependencies.runDirectorReplayMethod(
          { purpose: 'bounded_director_suggestion' }, signal,
        )
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        const method = normalizeDirectorReplayMethod(methodResult.value, stageArtifactHelpers)
        const contextPath = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
          + `/episodes/${encodeURIComponent(request.episodeId)}/director-inference/context?`
          + new URLSearchParams({ sceneId: request.sceneId, shotId: request.shotId }).toString()
        const contextResult = await fetchJson(
          dependencies, `${baseUrl}${contextPath}`, token, { method: 'GET' }, timeoutMs, signal,
        )
        if (!contextResult.ok) return contextResult
        const context = normalizeDirectorContext(contextResult.value, request, stageArtifactHelpers)
        const workOrderPayload = directorWorkOrderRequest(request, context, method, stageArtifactHelpers)
        const workOrderResult = await fetchJson(
          dependencies,
          `${baseUrl}/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
            + `/episodes/${encodeURIComponent(request.episodeId)}/director-inference/work-orders`,
          token,
          { method: 'POST', body: serializeBody(workOrderPayload) },
          timeoutMs,
          signal,
        )
        if (!workOrderResult.ok) return workOrderResult
        const workOrder = normalizeDirectorWorkOrder(
          workOrderResult.value, request, context, method, stageArtifactHelpers,
        )
        const freshResult = await fetchJson(
          dependencies, `${baseUrl}${contextPath}`, token, { method: 'GET' }, timeoutMs, signal,
        )
        if (!freshResult.ok) return freshResult
        const freshContext = normalizeDirectorContext(freshResult.value, request, stageArtifactHelpers)
        return { ok: true, value: buildDirectorReplayProposal(
          request, context, freshContext, workOrder, method, stageArtifactHelpers,
        ) }
      }
      if (endpoint === 'checkDirectorProposalFreshness') {
        const request = parseDirectorProposalFreshnessRequest(payload, stageArtifactHelpers)
        const token = normalizeToken(dependencies.readToken())
        if (token === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        if (dependencies.runDirectorReplayMethod === undefined) {
          return internalError('current IMAGO director replay Method is unavailable')
        }
        const methodResult = await dependencies.runDirectorReplayMethod(
          { purpose: 'bounded_director_suggestion' }, signal,
        )
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        const method = normalizeDirectorReplayMethod(methodResult.value, stageArtifactHelpers)
        if (method.version !== request.methodPackageVersion
          || method.methodPackageSha256 !== request.methodPackageSha256) {
          const { projectId: _projectId, episodeId: _episodeId, ...binding } = request
          const staleBody = {
            schema: 'jason.qingmu-director-proposal-freshness.v1' as const,
            projectId: request.projectId, episodeId: request.episodeId, fresh: false as const,
            staleReasons: ['director_method_changed'] as const,
            binding,
            currentContextSnapshotSha256: request.contextSnapshotSha256,
            providerCalls: 0 as const, costAmountCny: '0' as const,
            businessStateChanged: false as const, humanDecisionInferred: false as const,
            formalQcInferred: false as const, selectionGranted: false as const, readyGranted: false as const,
          }
          return { ok: true, value: {
            ...staleBody,
            freshnessSha256: canonicalJsonSha256(staleBody, 'director proposal method drift'),
          } satisfies DirectorProposalFreshnessResult }
        }
        const result = await fetchJson(
          dependencies,
          `${baseUrl}/api/qingmu/projects/${encodeURIComponent(request.projectId)}`
            + `/episodes/${encodeURIComponent(request.episodeId)}/director-inference/freshness`,
          token,
          { method: 'POST', body: serializeBody(Object.fromEntries(Object.entries(request)
            .filter(([key]) => key !== 'projectId' && key !== 'episodeId'))) },
          timeoutMs,
          signal,
        )
        if (!result.ok) return result
        return { ok: true, value: normalizeDirectorProposalFreshness(
          result.value, request, stageArtifactHelpers,
        ) }
      }
      let currentTakeApprovalLifecycleMethod: unknown
      let currentTakeApprovalLifecycleToken: string | undefined
      if (endpoint === 'transitionTakeApprovalLifecycle') {
        const methodPayload = prepareCurrentTakeApprovalLifecycleMethodRequest(
          payload,
          stageArtifactHelpers,
        )
        currentTakeApprovalLifecycleToken = normalizeToken(dependencies.readToken())
        if (currentTakeApprovalLifecycleToken === undefined) {
          return internalError('YIMENG_API_TOKEN is not configured')
        }
        if (dependencies.runTakeApprovalLifecycleMethod === undefined) {
          return internalError('current IMAGO Take approval lifecycle Method is unavailable')
        }
        const methodResult = await dependencies.runTakeApprovalLifecycleMethod(methodPayload, signal)
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        currentTakeApprovalLifecycleMethod = methodResult.value
      }
      let currentTakeTechnicalQcMethod: unknown
      let currentTakeTechnicalQcToken: string | undefined
      if (endpoint === 'recordTakeTechnicalQc') {
        const methodPayload = prepareCurrentTakeTechnicalQcMethodRequest(
          payload,
          stageArtifactHelpers,
        )
        currentTakeTechnicalQcToken = normalizeToken(dependencies.readToken())
        if (currentTakeTechnicalQcToken === undefined) {
          return internalError('YIMENG_API_TOKEN is not configured')
        }
        if (dependencies.runTakeTechnicalQcMethod === undefined) {
          return internalError('current IMAGO Take technical-QC Method is unavailable')
        }
        const methodResult = await dependencies.runTakeTechnicalQcMethod(methodPayload, signal)
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        currentTakeTechnicalQcMethod = methodResult.value
      }
      let currentStageArtifactMethod: unknown
      let currentStageArtifactToken: string | undefined
      if (endpoint === 'commitStageArtifactDecision' || endpoint === 'probeStageArtifactAuthority') {
        const methodPayload = prepareCurrentStageArtifactMethodRequest(
          endpoint,
          payload,
          stageArtifactHelpers,
        )
        currentStageArtifactToken = normalizeToken(dependencies.readToken())
        if (currentStageArtifactToken === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        if (dependencies.runStageArtifactMethod === undefined) {
          return internalError('current IMAGO Stage artifact Method is unavailable')
        }
        const methodResult = await dependencies.runStageArtifactMethod(methodPayload, signal)
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        currentStageArtifactMethod = methodResult.value
      }
      let currentLsuPlanMethod: unknown
      let currentLsuPlanToken: string | undefined
      if (endpoint === 'sealLsuPlan' || endpoint === 'probeLsuPlanAuthority') {
        const methodPayload = prepareCurrentLsuPlanMethodRequest(endpoint, payload, stageArtifactHelpers)
        currentLsuPlanToken = normalizeToken(dependencies.readToken())
        if (currentLsuPlanToken === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        if (dependencies.runLsuPlanMethod === undefined) {
          return internalError('current IMAGO LSU plan Method is unavailable')
        }
        const methodResult = await dependencies.runLsuPlanMethod(methodPayload, signal)
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        currentLsuPlanMethod = methodResult.value
      }
      let currentReworkRouteMethod: unknown
      let currentReworkRouteToken: string | undefined
      if (endpoint === 'recordReworkRoute' || endpoint === 'probeReworkRouteAuthority') {
        const methodPayload = prepareCurrentReworkRouteMethodRequest(endpoint, payload, stageArtifactHelpers)
        currentReworkRouteToken = normalizeToken(dependencies.readToken())
        if (currentReworkRouteToken === undefined) return internalError('YIMENG_API_TOKEN is not configured')
        if (dependencies.runReworkRouteMethod === undefined) {
          return internalError('current IMAGO bounded route Method is unavailable')
        }
        const methodResult = await dependencies.runReworkRouteMethod(methodPayload, signal)
        if (signal.aborted) return cancelled()
        if (!methodResult.ok) return methodResult
        currentReworkRouteMethod = methodResult.value
      }
      let path: string
      let requestInit: FetchJsonRequest
      let normalize: (value: unknown, token: string) => unknown
      if (endpoint === 'selectTakeVersion' || endpoint === 'recoverTakeVersionSelection'
        || endpoint === 'createTakeComment' || endpoint === 'recoverTakeComment'
        || endpoint === 'createTakeReviewRecommendation'
        || endpoint === 'recoverTakeReviewRecommendation'
        || endpoint === 'createTakeHumanDecision'
        || endpoint === 'recoverTakeHumanDecision'
        || endpoint === 'recordTakeTechnicalQc'
        || endpoint === 'recoverTakeTechnicalQc'
        || endpoint === 'transitionTakeApprovalLifecycle'
        || endpoint === 'recoverTakeApprovalLifecycleTransition'
        || endpoint === 'recordShotFinding' || endpoint === 'recoverShotFinding'
        || endpoint === 'bindProductionUnit' || endpoint === 'recoverProductionUnitBinding'
        || endpoint === 'bindStageSource' || endpoint === 'recoverStageSourceBinding'
        || endpoint === 'registerStageArtifact' || endpoint === 'recoverStageArtifactRegistration'
        || endpoint === 'commitStageArtifactDecision' || endpoint === 'recoverStageArtifactDecision'
        || endpoint === 'probeStageArtifactAuthority'
        || endpoint === 'sealLsuPlan' || endpoint === 'recoverLsuPlanSeal'
        || endpoint === 'probeLsuPlanAuthority'
        || endpoint === 'recordReworkRoute' || endpoint === 'recoverReworkRoute'
        || endpoint === 'probeReworkRouteAuthority') {
        const helpers = stageArtifactHelpers
        const prepared = endpoint === 'transitionTakeApprovalLifecycle'
          || endpoint === 'recoverTakeApprovalLifecycleTransition'
          ? prepareTakeApprovalLifecycleCommand(
            endpoint,
            payload,
            helpers,
            currentTakeApprovalLifecycleMethod,
          )
          : endpoint === 'recordTakeTechnicalQc'
          || endpoint === 'recoverTakeTechnicalQc'
            ? prepareTakeTechnicalQcCommand(endpoint, payload, helpers, currentTakeTechnicalQcMethod)
            : endpoint === 'createTakeReviewRecommendation'
            || endpoint === 'recoverTakeReviewRecommendation'
            || endpoint === 'createTakeHumanDecision'
            || endpoint === 'recoverTakeHumanDecision'
              ? prepareTakeReviewCommand(endpoint, payload, helpers)
              : endpoint === 'createTakeComment' || endpoint === 'recoverTakeComment'
                ? prepareTakeCommentCommand(endpoint, payload, helpers)
                : endpoint === 'selectTakeVersion' || endpoint === 'recoverTakeVersionSelection'
                  ? prepareTakeVersionCommand(endpoint, payload, helpers)
                  : endpoint === 'recordReworkRoute' || endpoint === 'recoverReworkRoute'
                    || endpoint === 'probeReworkRouteAuthority'
                    ? prepareReworkRouteCommand(endpoint, payload, helpers, currentReworkRouteMethod)
                    : endpoint === 'sealLsuPlan' || endpoint === 'recoverLsuPlanSeal'
                      || endpoint === 'probeLsuPlanAuthority'
                      ? prepareLsuPlanCommand(endpoint, payload, helpers, currentLsuPlanMethod)
                      : endpoint === 'registerStageArtifact' || endpoint === 'recoverStageArtifactRegistration'
                        || endpoint === 'commitStageArtifactDecision' || endpoint === 'recoverStageArtifactDecision'
                        || endpoint === 'probeStageArtifactAuthority'
                        ? prepareStageArtifactCommand(endpoint, payload, helpers, currentStageArtifactMethod)
                        : endpoint === 'bindProductionUnit' || endpoint === 'recoverProductionUnitBinding'
                          ? prepareProductionUnitCommand(endpoint, payload, helpers)
                          : endpoint === 'bindStageSource' || endpoint === 'recoverStageSourceBinding'
                            ? prepareStageSourceCommand(endpoint, payload, helpers)
                            : prepareShotFindingCommand(endpoint, payload, helpers)
        path = prepared.path
        requestInit = {
          method: prepared.request.method,
          ...(prepared.request.body === undefined ? {} : {
            body: endpoint === 'registerStageArtifact' || endpoint === 'commitStageArtifactDecision'
              || endpoint === 'probeStageArtifactAuthority'
              ? serializeStageArtifactBody(prepared.request.body)
              : serializeBody(prepared.request.body),
          }),
          ...(prepared.request.idempotencyKey === undefined ? {} : { idempotencyKey: prepared.request.idempotencyKey }),
        }
        normalize = prepared.normalize
      } else if (['readScenePlanning', 'saveScenePlanning', 'recoverScenePlanning'].includes(endpoint)) {
        const prepared = prepareScenePlanning(endpoint, payload, stageArtifactHelpers)
        path = prepared.path
        requestInit = { method: prepared.method, ...(prepared.body === undefined ? {} : { body: serializeBody(prepared.body) }) }
        normalize = prepared.normalize
      } else if (['listLocalReferenceCandidates', 'uploadLocalReferenceCandidate', 'recoverLocalReferenceCandidate', 'readLocalReferenceCandidateContent'].includes(endpoint)) {
        const prepared = prepareLocalReferenceCandidate(endpoint, payload, stageArtifactHelpers)
        path = prepared.path
        requestInit = { method: prepared.method, ...(prepared.body === undefined ? {} : { body: serializeBody(prepared.body) }) }
        normalize = prepared.normalize
      } else if (['initializeProject', 'recoverProjectInitialization', 'readTextImport', 'createTextImport', 'correctTextImport', 'confirmTextImport'].includes(endpoint)) {
        const prepared = prepareCreationCommand(endpoint, payload, stageArtifactHelpers)
        path = prepared.path
        requestInit = { method: prepared.method, ...(prepared.body === undefined ? {} : { body: serializeBody(prepared.body) }) }
        normalize = prepared.normalize
      } else if (endpoint === 'proposeScript') {
        const request = parseProposeRequest(payload)
        path = `/api/qingmu/episodes/${encodeURIComponent(request.episodeId)}/script/change-sets`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          script: request.script,
          baseRevision: request.baseRevision,
          ...(request.harnessSessionId === undefined ? {} : { harnessSessionId: request.harnessSessionId }),
          ...(request.references === undefined ? {} : { references: request.references }),
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeProposal(value, request)
      } else if (endpoint === 'previewScript') {
        const request = parsePreviewRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:preview`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          episodeId: request.episodeId,
          baseRevision: request.baseRevision,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizePreview(value, request)
      } else if (endpoint === 'commitScript') {
        const request = parseCommitRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:commit`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          episodeId: request.episodeId,
          baseRevision: request.baseRevision,
          idempotencyKey: request.idempotencyKey,
          expectedPayloadSha256: request.expectedPayloadSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeCommit(value, request)
      } else if (endpoint === 'recoverScriptCommit') {
        const request = parseRecoveryRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/change-sets/${encodeURIComponent(request.changeSetId)}/command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizeRecovery(value, request)
      } else if (endpoint === 'proposeStoryboardCanvas') {
        const request = parseProposeStoryboardCanvasRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/storyboard-canvas/change-sets`
        const body: YimengCommandJsonObject = {
          operation: request.operation,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
          baseCanvasSha256: request.methodProjection.canvas_projection.baseCanvasSha256,
          heroFrameAssetId: request.heroFrameAssetId,
          heroFrameMediaSha256: request.heroFrameMediaSha256,
          heroFrameBindingSha256: request.heroFrameBindingSha256,
          methodHeroFrameBindingSha256: request.methodProjection.canvas_projection.heroFrame.bindingSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          harnessSessionId: request.harnessSessionId ?? null,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeStoryboardCanvasProposal(value, request)
      } else if (endpoint === 'previewStoryboardCanvas') {
        const request = parseStoryboardCanvasCommandSubject(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:preview`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          targetType: request.targetType,
          targetId: request.targetId,
          episodeId: request.episodeId,
          storyboardRevisionId: request.storyboardRevisionId,
          frameId: request.frameId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeStoryboardCanvasPreview(value, request)
      } else if (endpoint === 'commitStoryboardCanvas') {
        const request = parseCommitStoryboardCanvasRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:commit`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          targetType: request.targetType,
          targetId: request.targetId,
          episodeId: request.episodeId,
          storyboardRevisionId: request.storyboardRevisionId,
          frameId: request.frameId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
          idempotencyKey: request.idempotencyKey,
          expectedPayloadSha256: request.expectedPayloadSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeStoryboardCanvasCommit(value, request)
      } else if (endpoint === 'recoverStoryboardCanvasCommit') {
        const request = parseRecoverStoryboardCanvasCommitRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/storyboard-canvas/change-sets/${encodeURIComponent(request.changeSetId)}/command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizeStoryboardCanvasRecovery(value, request)
      } else if (endpoint === 'proposePromptIr') {
        const request = parseProposePromptIrRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir/change-sets`
        const body: YimengCommandJsonObject = {
          basePromptIrId: request.basePromptIrId,
          baseVersion: request.baseVersion,
          baseContentSha256: request.baseContentSha256,
          baseDraftSnapshotSha256: request.baseDraftSnapshotSha256,
          replacements: request.replacements,
          ...(request.harnessSessionId === undefined ? {} : { harnessSessionId: request.harnessSessionId }),
          ...(request.references === undefined ? {} : { references: request.references }),
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizePromptIrProposal(value, request)
      } else if (endpoint === 'previewPromptIr') {
        const request = parsePromptIrCommandSubject(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:preview`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          episodeId: request.episodeId,
          targetType: request.targetType,
          targetId: request.targetId,
          storyboardRevisionId: request.storyboardRevisionId,
          frameId: request.frameId,
          basePromptIrId: request.basePromptIrId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizePromptIrPreview(value, request)
      } else if (endpoint === 'commitPromptIrEdit') {
        const request = parseCommitPromptIrEditRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:commit`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          episodeId: request.episodeId,
          targetType: request.targetType,
          targetId: request.targetId,
          storyboardRevisionId: request.storyboardRevisionId,
          frameId: request.frameId,
          basePromptIrId: request.basePromptIrId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
          idempotencyKey: request.idempotencyKey,
          expectedPayloadSha256: request.expectedPayloadSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizePromptIrEditCommit(value, request)
      } else if (endpoint === 'recoverPromptIrEditCommit') {
        const request = parseRecoverPromptIrEditCommitRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir/change-sets/${encodeURIComponent(request.changeSetId)}/command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizePromptIrEditRecovery(value, request)
      } else if (endpoint === 'selectPromptIr') {
        const request = parseSelectPromptIrRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir:select`
        const body: YimengCommandJsonObject = {
          draftPromptIrId: request.draftPromptIrId,
          draftVersion: request.draftVersion,
          draftContentSha256: request.draftContentSha256,
          idempotencyKey: request.idempotencyKey,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizePromptIrSelection(value, request)
      } else if (endpoint === 'recoverPromptIrSelection') {
        const request = parseRecoverPromptIrSelectionRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir/selection-command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizePromptIrSelectionRecovery(value, request)
      } else if (endpoint === 'proposeElementProfile') {
        const request = parseProposeElementProfileRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/change-sets`
        const body: YimengCommandJsonObject = {
          elementKind: request.elementKind,
          operation: request.operation,
          ...(request.elementKind === 'actor'
            ? { visualIdentity: request.visualIdentity }
            : { visualPrompt: request.visualPrompt }),
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
          methodProjection: request.methodProjection,
          methodProjectionSha256: request.methodProjectionSha256,
          methodAttestation: request.methodAttestation,
          ...(request.harnessSessionId === undefined ? {} : { harnessSessionId: request.harnessSessionId }),
          ...(request.references === undefined ? {} : { references: request.references }),
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeElementProposal(value, request)
      } else if (endpoint === 'proposeReferenceAsset') {
        const request = parseProposeReferenceAssetRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/${request.operation === 'replaceReferenceRights' ? 'change-sets' : 'reference-change-sets'}`
        const body: YimengCommandJsonObject = request.operation === 'replaceReferenceRights'
          ? {
            elementKind: request.elementKind,
            operation: request.operation,
            referenceAssetId: request.referenceAssetId,
            referenceAssetSha256: request.referenceAssetSha256,
            rights: request.rights,
            baseRevision: request.baseRevision,
            baseSnapshotSha256: request.baseSnapshotSha256,
            methodProjection: request.methodProjection,
            methodProjectionSha256: request.methodProjectionSha256,
            methodAttestation: request.methodAttestation,
            ...(request.harnessSessionId === undefined ? {} : { harnessSessionId: request.harnessSessionId }),
          }
          : {
            elementKind: request.elementKind,
            operation: request.operation,
            candidateAssetId: request.candidateAssetId,
            candidateAssetSha256: request.candidateAssetSha256,
            baseRevision: request.baseRevision,
            baseSnapshotSha256: request.baseSnapshotSha256,
            ...(request.repairPrompt === undefined ? {} : { repairPrompt: request.repairPrompt }),
            ...(request.harnessSessionId === undefined ? {} : { harnessSessionId: request.harnessSessionId }),
          }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeElementProposal(value, request)
      } else if (endpoint === 'previewElementProfile') {
        const request = parsePreviewElementProfileRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:preview`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          targetType: request.targetType,
          targetId: request.targetId,
          elementKind: request.elementKind,
          episodeId: request.episodeId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeElementPreview(value, request)
      } else if (endpoint === 'commitElementProfile') {
        const request = parseCommitElementProfileRequest(payload)
        path = `/api/qingmu/change-sets/${encodeURIComponent(request.changeSetId)}:commit`
        const body: YimengCommandJsonObject = {
          projectId: request.projectId,
          targetType: request.targetType,
          targetId: request.targetId,
          elementKind: request.elementKind,
          episodeId: request.episodeId,
          baseRevision: request.baseRevision,
          baseSnapshotSha256: request.baseSnapshotSha256,
          idempotencyKey: request.idempotencyKey,
          expectedPayloadSha256: request.expectedPayloadSha256,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeElementCommit(value, request)
      } else if (endpoint === 'recoverElementProfileCommit') {
        const request = parseRecoverElementProfileCommitRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/change-sets/${encodeURIComponent(request.changeSetId)}/command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizeElementRecovery(value, request)
      } else if (endpoint === 'createComment') {
        const request = parseCreateCommentRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/comments`
        const body: YimengCommandJsonObject = {
          expectedSubjectRevision: request.expectedSubjectRevision,
          expectedSubjectSha256: request.expectedSubjectSha256,
          body: request.body,
          idempotencyKey: request.idempotencyKey,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeCreateCommentResponse(value, request)
      } else if (endpoint === 'createHumanDecision') {
        const request = parseCreateHumanDecisionRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/human-decisions`
        const body: YimengCommandJsonObject = {
          expectedSubjectRevision: request.expectedSubjectRevision,
          expectedSubjectSha256: request.expectedSubjectSha256,
          decision: request.decision,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
        }
        requestInit = { method: 'POST', body: serializeBody(body) }
        normalize = value => normalizeCreateHumanDecisionResponse(value, request)
      } else if (endpoint === 'createReferenceRightsExceptionRelease') {
        const request = parseCreateReferenceRightsExceptionReleaseRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/reference-rights/exception-releases`
        const body: YimengCommandJsonObject = {
          expectedSubjectRevision: request.expectedSubjectRevision,
          expectedSubjectSha256: request.expectedSubjectSha256,
          scope: request.scope,
          reason: request.reason,
        }
        requestInit = {
          method: 'POST',
          body: serializeBody(body),
          idempotencyKey: request.idempotencyKey,
        }
        normalize = value => normalizeCreateReferenceRightsExceptionReleaseResponse(value, request)
      } else if (endpoint === 'recoverReferenceRightsExceptionRelease') {
        const request = parseRecoverReferenceRightsExceptionReleaseRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/reference-rights/exception-releases/command-receipt`
        requestInit = { method: 'GET', idempotencyKey: request.idempotencyKey }
        normalize = value => normalizeRecoverReferenceRightsExceptionReleaseResponse(value, request)
      } else {
        throw new InputError(`unknown Yimeng command endpoint: ${endpoint}`)
      }

      const token = currentTakeApprovalLifecycleToken ?? currentTakeTechnicalQcToken
        ?? currentStageArtifactToken
        ?? currentLsuPlanToken ?? currentReworkRouteToken
        ?? normalizeToken(dependencies.readToken())
      if (token === undefined) return internalError('YIMENG_API_TOKEN is not configured')
      const isStageArtifactCommand = endpoint === 'registerStageArtifact'
        || endpoint === 'recoverStageArtifactRegistration'
        || endpoint === 'commitStageArtifactDecision'
        || endpoint === 'recoverStageArtifactDecision'
        || endpoint === 'probeStageArtifactAuthority'
        || endpoint === 'sealLsuPlan'
        || endpoint === 'recoverLsuPlanSeal'
        || endpoint === 'probeLsuPlanAuthority'
        || endpoint === 'recordReworkRoute'
        || endpoint === 'recoverReworkRoute'
        || endpoint === 'probeReworkRouteAuthority'
      const requiresCredentialReflectionGuard = isStageArtifactCommand
        || ['readScenePlanning', 'saveScenePlanning', 'recoverScenePlanning'].includes(endpoint)
        || ['initializeProject', 'recoverProjectInitialization', 'readTextImport', 'createTextImport', 'correctTextImport', 'confirmTextImport'].includes(endpoint)
        || endpoint === 'createTakeComment' || endpoint === 'recoverTakeComment'
        || endpoint === 'createTakeReviewRecommendation'
        || endpoint === 'recoverTakeReviewRecommendation'
        || endpoint === 'createTakeHumanDecision'
        || endpoint === 'recoverTakeHumanDecision'
        || endpoint === 'recordTakeTechnicalQc'
        || endpoint === 'recoverTakeTechnicalQc'
        || endpoint === 'transitionTakeApprovalLifecycle'
        || endpoint === 'recoverTakeApprovalLifecycleTransition'
      const response = await fetchJson(
        dependencies,
        `${baseUrl}${path}`,
        token,
        requestInit,
        timeoutMs,
        signal,
        requiresCredentialReflectionGuard,
      )
      if (!response.ok) return response
      try {
        const value = normalize(response.value, token)
        if (requiresCredentialReflectionGuard && containsReflectedCredential(value, token)) {
          return internalError('Yimeng command contract failed')
        }
        return { ok: true, value }
      } catch (error) {
        if (error instanceof UpstreamContractError) {
          return internalError(`Yimeng command contract failed: ${error.message}`)
        }
        return internalError('Yimeng command contract failed')
      }
    } catch (error) {
      if (error instanceof AttestationKeyError) {
        return internalError('IMAGO method attestation is unavailable')
      }
      if (error instanceof InputError) return badRequest(error.message)
      return internalError('Yimeng command adapter failed')
    }
  }
}

/** Register the command adapter on a loopback-only Host Connection channel. */
export function apply(ctx: Context, config: YimengCommandAdapterConfig = {}): void {
  ctx.connection.rpc.handle(CHANNEL, createYimengCommandHandler(config, {
    fetch: globalThis.fetch,
    readToken: () => process.env.YIMENG_API_TOKEN,
    runDirectorReplayMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO director replay Method is unavailable')
        : await method('directorReplayMethod', payload, signal)
    },
    runStageArtifactMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO Stage artifact Method is unavailable')
        : await method('stageArtifactMethod', payload, signal)
    },
    runLsuPlanMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO LSU plan Method is unavailable')
        : await method('lsuPlanMethod', payload, signal)
    },
    runTakeTechnicalQcMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO Take technical-QC Method is unavailable')
        : await method('takeTechnicalQcMethod', payload, signal)
    },
    runTakeApprovalLifecycleMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO Take approval lifecycle Method is unavailable')
        : await method('takeApprovalLifecycleMethod', payload, signal)
    },
    runReworkRouteMethod: async (payload, signal) => {
      const method = ctx.get('qingmuImagoMethod')
      return method === undefined
        ? internalError('current IMAGO bounded route Method is unavailable')
        : await method('reworkRouteMethod', payload, signal)
    },
  }), { authority: 'loopback' })
}
