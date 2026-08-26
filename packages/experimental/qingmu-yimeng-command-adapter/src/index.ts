/** Loopback-only Host boundary for explicit Yimeng ChangeSet commands. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import z from '@deepseek-ai/schemastery'
import type {
  YimengChangeSet,
  YimengChangeSetBase,
  YimengCommandJsonObject,
  YimengCreateCommentRequest,
  YimengCreateCommentResponse,
  YimengCreateHumanDecisionRequest,
  YimengCreateHumanDecisionResponse,
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
  YimengCommitScriptRequest,
  YimengCommitScriptResponse,
  YimengElementImpactAnalysis,
  YimengElementKind,
  YimengElementProfileChangeSet,
  YimengElementProfileOperation,
  YimengElementReviewComment,
  YimengHumanDecision,
  YimengHumanDecisionValue,
  YimengImagoElementMethodAttestation,
  YimengImagoReferenceAssetMethodAttestation,
  YimengImagoReferenceAssetMethodProjection,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
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
  YimengReferenceCommitElementProfileResponse,
  YimengReferencePreviewElementProfileRequest,
  YimengReferencePreviewElementProfileResponse,
  YimengReferenceAssetOperation,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
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
  YimengCommitElementProfileRequest,
  YimengCommitElementProfileResponse,
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
  YimengImagoReferenceAssetMethodAttestation,
  YimengImagoReferenceAssetMethodProjection,
  YimengPreviewElementProfileRequest,
  YimengPreviewElementProfileResponse,
  YimengPreviewPromptIrRequest,
  YimengPreviewPromptIrResponse,
  YimengPreviewScriptRequest,
  YimengPreviewScriptResponse,
  YimengProposeElementProfileRequest,
  YimengProposeElementProfileResponse,
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
  YimengReferenceAssetOperation,
  YimengReferenceCommitElementProfileResponse,
  YimengReferencePreviewElementProfileRequest,
  YimengReferencePreviewElementProfileResponse,
  YimengSelectPromptIrRequest,
  YimengSelectPromptIrResponse,
  YimengVisualCommitElementProfileResponse,
  YimengVisualPreviewElementProfileResponse,
  YimengScriptChangeSet,
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

function parseReferenceAssetOperation(value: unknown, field = 'operation'): YimengReferenceAssetOperation {
  if (value !== 'selectReferenceAsset' && value !== 'requestReferenceRegeneration') {
    throw new InputError(`${field} must be selectReferenceAsset or requestReferenceRegeneration`)
  }
  return value
}

function requireReferenceAssetOperation(value: unknown, field: string): YimengReferenceAssetOperation {
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
    operation: parseReferenceAssetOperation(value.target.operation, 'methodProjection.target.operation'),
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

function readReferenceAttestationKey(): string {
  const key = process.env.QINGMU_IMAGO_ATTESTATION_KEY
  if (key === undefined || key === '' || Buffer.byteLength(key, 'utf8') < 32) throw new AttestationKeyError()
  return key
}

function verifyReferenceMethodProof(
  request: Omit<YimengProposeReferenceAssetRequest, 'methodProjection' | 'methodAttestation'>,
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
    'baseRevision',
    'baseSnapshotSha256',
    'repairPrompt',
    'harnessSessionId',
    'methodProjection',
    'methodProjectionSha256',
    'methodAttestation',
  ])
  const operation = parseReferenceAssetOperation(input.operation)
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
  let harnessSessionId: string | undefined
  if (input.harnessSessionId !== undefined) {
    harnessSessionId = parseIdentifier(input.harnessSessionId, 'harnessSessionId')
    if (harnessSessionId.length > 200) throw new InputError('harnessSessionId must not exceed 200 characters')
  }
  const methodProjection = parseReferenceProjection(input.methodProjection)
  const methodAttestation = parseReferenceMethodAttestation(input.methodAttestation)
  const requestWithoutProof = {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    targetType: parseElementTargetType(input.targetType),
    targetId: parseIdentifier(input.targetId, 'targetId'),
    elementKind: parseElementKind(input.elementKind),
    operation,
    candidateAssetId: parseIdentifier(input.candidateAssetId, 'candidateAssetId'),
    candidateAssetSha256: parseInputSha256(input.candidateAssetSha256, 'candidateAssetSha256'),
    baseRevision: parseRevision(input.baseRevision),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
    ...(repairPrompt === undefined ? {} : { repairPrompt }),
    ...(harnessSessionId === undefined ? {} : { harnessSessionId }),
    methodProjectionSha256: parseInputSha256(input.methodProjectionSha256, 'methodProjectionSha256'),
  } as const
  verifyReferenceMethodProof(requestWithoutProof, methodProjection, methodAttestation)
  return { ...requestWithoutProof, methodProjection, methodAttestation }
}

function parseReferenceCommandLineage(input: YimengCommandJsonObject): {
  operation: YimengReferenceAssetOperation
  candidateAssetId: string
  candidateAssetSha256: string
} | undefined {
  const hasReferenceField = input.operation !== undefined
    || input.candidateAssetId !== undefined
    || input.candidateAssetSha256 !== undefined
  if (!hasReferenceField) return undefined
  return {
    operation: parseReferenceAssetOperation(input.operation),
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
      redirect: 'error',
      signal: controller.signal,
    })
    let value: unknown = undefined
    let invalidJson = false
    try {
      value = sanitizeUpstreamValue(await readBoundedJson(response), token)
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
  if (subject.schema !== 'jason.qingmu-element-profile-subject.v1') {
    throw new UpstreamContractError(`${field}.schema mismatch`)
  }
  if (subject.targetType !== 'element_profile') throw new UpstreamContractError(`${field}.targetType mismatch`)
  const elementKind = requireElementKind(subject.elementKind, `${field}.elementKind`)
  if (elementKind !== expectedElementKind) throw new UpstreamContractError(`${field}.elementKind mismatch`)
  const references = requireObjectArray(subject.references, `${field}.references`).map((value, index) => {
    const referenceField = `${field}.references[${String(index)}]`
    return {
      ...value,
      assetId: requireString(value.assetId, `${referenceField}.assetId`),
      sha256: requireSha256(value.sha256, `${referenceField}.sha256`),
      selectionStatus: requireString(value.selectionStatus, `${referenceField}.selectionStatus`),
      isSelected: requireBoolean(value.isSelected, `${referenceField}.isSelected`),
    }
  })
  const common = {
    ...subject,
    schema: 'jason.qingmu-element-profile-subject.v1',
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
      visualIdentity: requireString(subject.visualIdentity, `${field}.visualIdentity`),
    }
  }
  if (elementKind === 'scene') {
    return {
      ...common,
      sceneId: requireString(subject.sceneId, `${field}.sceneId`),
      sceneType: requireString(subject.sceneType, `${field}.sceneType`),
      visualPrompt: requireString(subject.visualPrompt, `${field}.visualPrompt`),
    }
  }
  return {
    ...common,
    propId: requireString(subject.propId, `${field}.propId`),
    visualPrompt: requireString(subject.visualPrompt, `${field}.visualPrompt`),
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

function isReferenceElementRequest(
  request: YimengPreviewElementProfileRequest,
): request is YimengReferencePreviewElementProfileRequest {
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
    operation: requireReferenceAssetOperation(root.operation, 'preview.operation'),
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
  const operation = requireReferenceAssetOperation(root.operation, 'commit.operation')
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

function normalizeElementPreview(
  value: unknown,
  expected: YimengPreviewElementProfileRequest,
): YimengPreviewElementProfileResponse {
  if (isReferenceElementRequest(expected)) return normalizeReferenceElementPreview(value, expected)
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
  if (isReferenceElementRequest(expected)) return normalizeReferenceElementCommit(value, expected)
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
  if (isReferenceElementRequest(expected)) {
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
      let path: string
      let requestInit: FetchJsonRequest
      let normalize: (value: unknown) => unknown
      if (endpoint === 'proposeScript') {
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
      } else if (endpoint === 'proposePromptIr') {
        const request = parseProposePromptIrRequest(payload)
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/episodes/${encodeURIComponent(request.episodeId)}/storyboard-revisions/${encodeURIComponent(request.storyboardRevisionId)}/frames/${encodeURIComponent(request.frameId)}/prompt-ir/change-sets`
        const body: YimengCommandJsonObject = {
          basePromptIrId: request.basePromptIrId,
          baseVersion: request.baseVersion,
          baseContentSha256: request.baseContentSha256,
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
        path = `/api/qingmu/projects/${encodeURIComponent(request.projectId)}/elements/${encodeURIComponent(request.elementKind)}/${encodeURIComponent(request.targetId)}/reference-change-sets`
        const body: YimengCommandJsonObject = {
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
      } else {
        throw new InputError(`unknown Yimeng command endpoint: ${endpoint}`)
      }

      const token = normalizeToken(dependencies.readToken())
      if (token === undefined) return internalError('YIMENG_API_TOKEN is not configured')
      const response = await fetchJson(
        dependencies,
        `${baseUrl}${path}`,
        token,
        requestInit,
        timeoutMs,
        signal,
      )
      if (!response.ok) return response
      try {
        return { ok: true, value: normalize(response.value) }
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
  ctx.connection.rpc.handle(CHANNEL, createYimengCommandHandler(config), { authority: 'loopback' })
}
