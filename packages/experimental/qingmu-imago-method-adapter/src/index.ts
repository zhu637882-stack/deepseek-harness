/** Loopback-only Host BFF for stateless, SHA-bound IMAGO method projections. */

import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import z from '@deepseek-ai/schemastery'
import type {
  ImagoElementMethodProjection,
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoElementMethodSnapshot,
  ImagoElementMethodAttestation,
  ImagoElementKind,
  ImagoMethodJsonObject,
  ImagoPromptIrEditableField,
  ImagoPromptIrEditableProjection,
  ImagoPromptIrEditableReplacements,
  ImagoPromptIrMethodAttestation,
  ImagoPromptIrMethodProjection,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoPromptIrMethodSnapshot,
  ImagoShotRelationBeat,
  ImagoShotRelationElement,
  ImagoShotRelationMethodAttestation,
  ImagoShotRelationMethodProjection,
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
  ImagoShotRelationMethodSnapshot,
  ImagoShotRelationScene,
  ImagoShotRelationShot,
  ImagoReferenceAssetActionMethodRequest,
  ImagoReferenceAssetActionMethodResponse,
  ImagoReferenceAssetMethodAttestation,
  ImagoReferenceAssetMethodProjection,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodSnapshot,
  ImagoReferenceRightsMethodRequest,
  ImagoReferenceRightsOperation,
} from './types.ts'

export type {
  ImagoElementMethodProjection,
  ImagoElementMethodRequest,
  ImagoElementMethodResponse,
  ImagoElementMethodSnapshot,
  ImagoElementMethodAttestation,
  ImagoElementKind,
  ImagoMethodEndpoint,
  ImagoMethodEndpointMap,
  ImagoMethodJsonObject,
  ImagoPromptIrEditableField,
  ImagoPromptIrEditableProjection,
  ImagoPromptIrEditableReplacements,
  ImagoPromptIrMethodAttestation,
  ImagoPromptIrMethodProjection,
  ImagoPromptIrMethodRequest,
  ImagoPromptIrMethodResponse,
  ImagoPromptIrMethodSnapshot,
  ImagoShotRelationBeat,
  ImagoShotRelationElement,
  ImagoShotRelationMethodAttestation,
  ImagoShotRelationMethodProjection,
  ImagoShotRelationMethodRequest,
  ImagoShotRelationMethodResponse,
  ImagoShotRelationMethodSnapshot,
  ImagoShotRelationScene,
  ImagoShotRelationShot,
  ImagoReferenceAssetActionMethodRequest,
  ImagoReferenceAssetActionMethodResponse,
  ImagoReferenceAssetMethodAttestation,
  ImagoReferenceAssetMethodProjection,
  ImagoReferenceAssetMethodRequest,
  ImagoReferenceAssetMethodResponse,
  ImagoReferenceAssetMethodSnapshot,
  ImagoReferenceRightsMethodRequest,
  ImagoReferenceRightsOperation,
  ImagoReferenceAssetActionOperation,
  ImagoReferenceAssetOperation,
} from './types.ts'

const CHANNEL = '/qingmu-imago-method'
const DEFAULT_PYTHON_EXECUTABLE = 'python3'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const MAX_ID_LENGTH = 256
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/
const ELEMENT_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_element_method.py'
const REFERENCE_ASSET_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_reference_asset_method.py'
const REFERENCE_RIGHTS_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_reference_rights_method.py'
const REFERENCE_RIGHTS_EXCEPTION_RELEASE_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_reference_rights_exception_release_method.py'
const PROMPT_IR_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_prompt_ir_method.py'
const SHOT_RELATION_COMPILER_RELATIVE_PATH = 'scripts/compile_qingmu_shot_relation_method.py'
const COMMON_SOURCE_PATHS = [
  'pipeline/imago-os-current.json',
  'pipeline/workflow-channel-registry.json',
  'pipeline/v6-stage-contracts.json',
  'pipeline/role-capability-spec.v6.json',
] as const
const B2AC_SOURCE_PATHS = [
  ...COMMON_SOURCE_PATHS,
  'agents/b2a-art-director/character-designer/AGENTS.md',
  'skill-package/imago-b2ac-character-design/SKILL.md',
  'skill-package/imago-b2ac-character-design/references/character-costume-makeup-design-method.md',
] as const
const B2AS_SOURCE_PATHS = [
  ...COMMON_SOURCE_PATHS,
  'agents/b2a-art-director/scene-designer/AGENTS.md',
  'skill-package/imago-b2as-scene-prop-fx-design/SKILL.md',
  'skill-package/imago-b2as-scene-prop-fx-design/references/production-design-prop-research-method.md',
] as const
const FORBIDDEN_WORK = [
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'human_decision',
  'project_state_write',
] as const
const REFERENCE_ASSET_SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'role_agent',
  'role_method',
  'method_reference',
] as const
const REFERENCE_ASSET_FORBIDDEN_WORK = [
  'provider_dispatch',
  'asset_generation',
  'worker_start',
  'machine_suggestion_as_selection',
  'human_approval',
  'human_signoff',
  'comment_as_decision',
  'review_note_as_decision',
  'project_state_write',
] as const
const REFERENCE_RIGHTS_EXCEPTION_RELEASE_FORBIDDEN_WORK = [
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'rights_record_write',
  'subject_revision_write',
  'ordinary_human_decision_inference',
  'project_state_write',
] as const
const PROMPT_IR_EDITABLE_FIELDS = [
  'imageGenPrompt',
  'lastFrameImagePrompt',
  'videoGenPrompt',
  'motionPrompt',
  'negativePrompt',
] as const satisfies readonly ImagoPromptIrEditableField[]
const PROMPT_IR_SOURCE_PATHS = [
  ...COMMON_SOURCE_PATHS,
  'pipeline/v6-video-generation-routing-policy.json',
  'agents/e-image-to-video/AGENTS.md',
  'skill-package/imago-e-kling-lsu-compiler/SKILL.md',
] as const
const PROMPT_IR_SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'prompt_ir_policy',
  'role_agent',
  'role_method',
] as const
const PROMPT_IR_MAPPING_WARNING = 'yimeng_v2_to_imago_v1_field_mapping_not_declared'
const SHOT_RELATION_SOURCE_PATHS = [
  ...COMMON_SOURCE_PATHS,
  'pipeline/v6-director-storyboard-production-loop-policy.json',
  'agents/c-ai-director/AGENTS.md',
  'skill-package/imago-c-director-development/SKILL.md',
  'skill-package/imago-c-director-development/references/scene-performance-blocking-method.md',
  'agents/c5-execution-director/AGENTS.md',
  'skill-package/imago-c5-execution-storyboard/SKILL.md',
  'skill-package/imago-c5-execution-storyboard/references/shot-grammar-continuity-lsu-method.md',
  'skill-package/imago-c5-execution-storyboard/references/director-storyboard-production-loop.md',
] as const
const SHOT_RELATION_SOURCE_KINDS = [
  'runtime_pointer',
  'runtime_channel_registry',
  'stage_contracts',
  'role_capability_spec',
  'director_storyboard_policy',
  'director_role_agent',
  'director_role_method',
  'director_relation_reference',
  'execution_director_role_agent',
  'execution_director_role_method',
  'execution_relation_reference',
  'director_storyboard_loop_reference',
] as const
const SHOT_RELATION_HINT_IDS = [
  'canonical-shot-identity',
  'scene-shot-binding',
  'shot-local-beat-scope',
  'element-subset-binding',
  'revision-sha-boundary',
  'read-only-method-boundary',
] as const
const SHOT_RELATION_CHECK_IDS = [
  'canonical-shot-id',
  'scene-resolves',
  'beat-local-only',
  'element-subsets-close',
  'revision-and-sha-current',
  'zero-execution',
] as const
const SHOT_RELATION_FORBIDDEN_WORK = [
  'project_state_write',
  'database_write',
  'relation_identity_create',
  'beat_state_persist',
  'provider_dispatch',
  'asset_generation',
  'asset_selection',
  'human_approval',
  'human_signoff',
] as const

interface ElementMethodProfile {
  readonly methodId: string
  readonly sourcePaths: readonly string[]
  readonly operation: 'replaceVisualIdentity' | 'replaceVisualPrompt'
  readonly reads: readonly string[]
  readonly writes: readonly string[]
  readonly invalidates: readonly string[]
}

const ELEMENT_METHOD_PROFILES: Readonly<Record<ImagoElementKind, ElementMethodProfile>> = {
  actor: {
    methodId: 'imago-v6-b2ac-actor-profile',
    sourcePaths: B2AC_SOURCE_PATHS,
    operation: 'replaceVisualIdentity',
    reads: ['yimeng_actor_profile_snapshot'],
    writes: ['replace_visual_identity_via_changeset'],
    invalidates: ['official_actor_reference_projection'],
  },
  scene: {
    methodId: 'imago-v6-b2as-scene-profile',
    sourcePaths: B2AS_SOURCE_PATHS,
    operation: 'replaceVisualPrompt',
    reads: ['yimeng_scene_profile_snapshot'],
    writes: ['replace_visual_prompt_via_changeset'],
    invalidates: ['official_scene_reference_projection'],
  },
  prop: {
    methodId: 'imago-v6-b2as-prop-profile',
    sourcePaths: B2AS_SOURCE_PATHS,
    operation: 'replaceVisualPrompt',
    reads: ['yimeng_prop_profile_snapshot'],
    writes: ['replace_visual_prompt_via_changeset'],
    invalidates: ['official_prop_reference_projection'],
  },
}

interface ReferenceAssetMethodProfile {
  readonly methodId: string
  readonly sourcePaths: readonly string[]
  readonly requiredResource: string
  readonly legalRead: string
}

const REFERENCE_ASSET_METHOD_PROFILES: Readonly<Record<ImagoElementKind, ReferenceAssetMethodProfile>> = {
  actor: {
    methodId: 'imago-v6-b2ac-actor-reference-asset',
    sourcePaths: B2AC_SOURCE_PATHS,
    requiredResource: 'actor_profile_snapshot',
    legalRead: 'yimeng_actor_profile_snapshot',
  },
  scene: {
    methodId: 'imago-v6-b2as-scene-reference-asset',
    sourcePaths: B2AS_SOURCE_PATHS,
    requiredResource: 'scene_profile_snapshot',
    legalRead: 'yimeng_scene_profile_snapshot',
  },
  prop: {
    methodId: 'imago-v6-b2as-prop-reference-asset',
    sourcePaths: B2AS_SOURCE_PATHS,
    requiredResource: 'prop_profile_snapshot',
    legalRead: 'yimeng_prop_profile_snapshot',
  },
}

export const name = 'experimental-qingmu-imago-method-adapter'
export const inject = ['connection']

/** Deployment-specific path and bounded local compiler execution settings. */
export interface ImagoMethodAdapterConfig {
  /** Absolute IMAGO OS Core root containing the reviewed compiler. */
  readonly coreRoot?: string
  /** Python executable used only for the local compiler subprocess. */
  readonly pythonExecutable?: string
  /** Compiler deadline in milliseconds, from 100 through 60,000. */
  readonly timeoutMs?: number
}

/** Fully resolved execution settings passed to the injectable compiler runner. */
export interface ImagoMethodCompilerExecution {
  readonly coreRoot: string
  readonly pythonExecutable: string
  readonly timeoutMs: number
}

/** Injectable local process boundary used by isolated tests. */
export interface ImagoMethodAdapterDependencies {
  readonly runCompiler: (
    snapshot: ImagoElementMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Optional injectable boundary for the reference-asset compiler. */
  readonly runReferenceAssetCompiler?: (
    snapshot: ImagoReferenceAssetMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Optional element-contract compiler boundary for reference rights guidance. */
  readonly runReferenceRightsCompiler?: (
    snapshot: ImagoElementMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Optional subject-only compiler boundary for exception-release guidance. */
  readonly runReferenceRightsExceptionReleaseCompiler?: (
    snapshot: ImagoElementMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Optional injectable boundary for the provider-neutral PromptIR method compiler. */
  readonly runPromptIrCompiler?: (
    snapshot: ImagoPromptIrMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** Optional injectable boundary for the read-only Scene/Shot/Beat/Element relation compiler. */
  readonly runShotRelationCompiler?: (
    snapshot: ImagoShotRelationMethodSnapshot,
    execution: ImagoMethodCompilerExecution,
    signal: AbortSignal,
  ) => Promise<unknown>
}

export const Config: z<ImagoMethodAdapterConfig> = z.object({
  coreRoot: z.string().default(''),
  pythonExecutable: z.string().default(DEFAULT_PYTHON_EXECUTABLE),
  timeoutMs: z.natural().min(100).default(DEFAULT_TIMEOUT_MS),
})

class InputError extends Error {}
class ProjectionContractError extends Error {}
class CompilerExecutionError extends Error {}
class CompilerCancelledError extends Error {}
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
  error: { code: 'cancelled', message: 'IMAGO method request was cancelled', details: {} },
})

function isJsonObject(value: unknown): value is ImagoMethodJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(value: unknown, field: string): ImagoMethodJsonObject {
  if (!isJsonObject(value)) throw new ProjectionContractError(`${field} must be an object`)
  return value
}

function requireExactObject(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
): ImagoMethodJsonObject {
  const object = requireObject(value, field)
  if (!isDeepStrictEqual(Object.keys(object).sort(), [...expectedKeys].sort())) {
    throw new ProjectionContractError(`${field} fields do not match the reference-asset method contract`)
  }
  return object
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ProjectionContractError(`${field} must be a string`)
  return value
}

function requireSha256(value: unknown, field: string): string {
  const sha256 = requireString(value, field)
  if (!SHA256.test(sha256)) throw new ProjectionContractError(`${field} must be a lowercase SHA-256`)
  return sha256
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new ProjectionContractError(`${field} must be a boolean`)
  return value
}

function requireInteger(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ProjectionContractError(`${field} must be a safe integer in range`)
  }
  return value as number
}

function requireObjectArray(value: unknown, field: string): ImagoMethodJsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new ProjectionContractError(`${field} must be an array of objects`)
  }
  return value
}

function requireNonemptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProjectionContractError(`${field} must be a non-empty string array`)
  }
  return value.map((item, index) => {
    const string = requireString(item, `${field}[${String(index)}]`)
    if (string.length === 0) throw new ProjectionContractError(`${field} must not contain empty strings`)
    return string
  })
}

function assertSafeJsonNumbers(value: unknown, field: string, depth = 0): void {
  if (depth > 100) throw new ProjectionContractError(`${field} nesting exceeds limit`)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new ProjectionContractError(`${field} contains a non-finite number or unsafe integer`)
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

function parseInputObject(payload: unknown): ImagoMethodJsonObject {
  if (!isJsonObject(payload)) throw new InputError('payload must be an object')
  return payload
}

function assertOnlyInputKeys(input: ImagoMethodJsonObject, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unknownKey = Object.keys(input).find(key => !allowedKeys.has(key))
  if (unknownKey !== undefined) throw new InputError(`unknown payload field: ${unknownKey}`)
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InputError(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH || /[\u0000\r\n]/.test(normalized)) {
    throw new InputError(`${field} must be a safe identifier from 1 to ${String(MAX_ID_LENGTH)} characters`)
  }
  return normalized
}

function parseInputInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputError(`${field} must be a non-negative safe integer`)
  }
  return value as number
}

function parseInputPositiveInteger(value: unknown, field: string): number {
  const integer = parseInputInteger(value, field)
  if (integer === 0) throw new InputError(`${field} must be a positive safe integer`)
  return integer
}

function parseInputSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new InputError(`${field} must be a lowercase SHA-256`)
  }
  return value
}

function parseExactInputObject(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
): ImagoMethodJsonObject {
  const object = parseInputObject(value)
  if (!isDeepStrictEqual(Object.keys(object).sort(), [...expectedKeys].sort())) {
    throw new InputError(`${field} fields do not match the Shot relation input contract`)
  }
  return object
}

function parseIdentifierArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new InputError(`${field} must be an array`)
  const identifiers = value.map((item, index) => parseIdentifier(item, `${field}[${String(index)}]`))
  if (new Set(identifiers).size !== identifiers.length) {
    throw new InputError(`${field} must not contain duplicate IDs`)
  }
  return identifiers
}

function parseShotRelationRequest(payload: unknown): ImagoShotRelationMethodRequest {
  const input = parseExactInputObject(payload, [
    'projectId',
    'episodeId',
    'episodeRevision',
    'storyboardRevisionId',
    'storyboardRevisionVersion',
    'storyboardSourceSha256',
    'selectedShotId',
    'scenes',
    'shots',
    'elements',
  ], 'payload')
  if (!Array.isArray(input.elements)) throw new InputError('elements must be an array')
  const elementAuthorityById = new Map<string, ImagoShotRelationElement>()
  const elements: ImagoShotRelationElement[] = input.elements.map((value, index) => {
    const element = parseExactInputObject(
      value,
      ['elementId', 'elementKind', 'profileRevision', 'snapshotSha256'],
      `elements[${String(index)}]`,
    )
    const elementId = parseIdentifier(element.elementId, `elements[${String(index)}].elementId`)
    if (element.elementKind !== 'actor' && element.elementKind !== 'scene' && element.elementKind !== 'prop') {
      throw new InputError(`elements[${String(index)}].elementKind must be actor, scene, or prop`)
    }
    const normalizedElement: ImagoShotRelationElement = {
      elementId,
      elementKind: element.elementKind,
      profileRevision: parseInputInteger(
        element.profileRevision,
        `elements[${String(index)}].profileRevision`,
      ),
      snapshotSha256: parseInputSha256(
        element.snapshotSha256,
        `elements[${String(index)}].snapshotSha256`,
      ),
    }
    const existing = elementAuthorityById.get(elementId)
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, normalizedElement)) {
        throw new InputError(`conflicting Element kind/revision/SHA for ID: ${elementId}`)
      }
      throw new InputError(`duplicate Element ID: ${elementId}`)
    }
    elementAuthorityById.set(elementId, normalizedElement)
    return normalizedElement
  })
  const elementIds = new Set(elementAuthorityById.keys())

  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    throw new InputError('scenes must be a non-empty array')
  }
  const sceneElements = new Map<string, ReadonlySet<string>>()
  const scenes: ImagoShotRelationScene[] = input.scenes.map((value, index) => {
    const scene = parseExactInputObject(
      value,
      ['sceneId', 'profileRevision', 'snapshotSha256', 'elementIds'],
      `scenes[${String(index)}]`,
    )
    const sceneId = parseIdentifier(scene.sceneId, `scenes[${String(index)}].sceneId`)
    if (sceneElements.has(sceneId)) throw new InputError(`duplicate Scene ID: ${sceneId}`)
    const relatedElements = parseIdentifierArray(scene.elementIds, `scenes[${String(index)}].elementIds`)
    const unknown = relatedElements.find(elementId => !elementIds.has(elementId))
    if (unknown !== undefined) throw new InputError(`Scene ${sceneId} references unknown Element ID: ${unknown}`)
    sceneElements.set(sceneId, new Set(relatedElements))
    return {
      sceneId,
      profileRevision: parseInputInteger(scene.profileRevision, `scenes[${String(index)}].profileRevision`),
      snapshotSha256: parseInputSha256(scene.snapshotSha256, `scenes[${String(index)}].snapshotSha256`),
      elementIds: relatedElements,
    }
  })

  if (!Array.isArray(input.shots) || input.shots.length === 0) {
    throw new InputError('shots must be a non-empty array')
  }
  const shotIds = new Set<string>()
  const shots: ImagoShotRelationShot[] = input.shots.map((value, shotIndex) => {
    const shot = parseExactInputObject(
      value,
      ['shotId', 'sceneId', 'elementIds', 'beats'],
      `shots[${String(shotIndex)}]`,
    )
    const shotId = parseIdentifier(shot.shotId, `shots[${String(shotIndex)}].shotId`)
    if (shotIds.has(shotId)) throw new InputError(`duplicate Shot ID: ${shotId}`)
    shotIds.add(shotId)
    const sceneId = parseIdentifier(shot.sceneId, `shots[${String(shotIndex)}].sceneId`)
    const owningSceneElements = sceneElements.get(sceneId)
    if (owningSceneElements === undefined) throw new InputError(`Shot ${shotId} references unknown Scene ID: ${sceneId}`)
    const relatedElements = parseIdentifierArray(
      shot.elementIds,
      `shots[${String(shotIndex)}].elementIds`,
    )
    const outsideScene = relatedElements.find(elementId => !owningSceneElements.has(elementId))
    if (outsideScene !== undefined) {
      throw new InputError(`Shot ${shotId} references Element outside Scene ${sceneId}: ${outsideScene}`)
    }
    if (!Array.isArray(shot.beats)) throw new InputError(`shots[${String(shotIndex)}].beats must be an array`)
    const beatIds = new Set<string>()
    const shotElementIds = new Set(relatedElements)
    const beats: ImagoShotRelationBeat[] = shot.beats.map((value, beatIndex) => {
      const beat = parseExactInputObject(
        value,
        ['beatId', 'elementIds'],
        `shots[${String(shotIndex)}].beats[${String(beatIndex)}]`,
      )
      const beatId = parseIdentifier(
        beat.beatId,
        `shots[${String(shotIndex)}].beats[${String(beatIndex)}].beatId`,
      )
      if (beatIds.has(beatId)) throw new InputError(`duplicate Beat ID within Shot ${shotId}: ${beatId}`)
      beatIds.add(beatId)
      const beatElements = parseIdentifierArray(
        beat.elementIds,
        `shots[${String(shotIndex)}].beats[${String(beatIndex)}].elementIds`,
      )
      const outsideShot = beatElements.find(elementId => !shotElementIds.has(elementId))
      if (outsideShot !== undefined) {
        throw new InputError(`Beat ${beatId} references Element outside Shot ${shotId}: ${outsideShot}`)
      }
      return { beatId, elementIds: beatElements }
    })
    return { shotId, sceneId, elementIds: relatedElements, beats }
  })
  const selectedShotId = parseIdentifier(input.selectedShotId, 'selectedShotId')
  if (!shotIds.has(selectedShotId)) throw new InputError('selectedShotId references unknown Shot ID')
  return {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    episodeRevision: parseInputInteger(input.episodeRevision, 'episodeRevision'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    storyboardRevisionVersion: parseInputPositiveInteger(
      input.storyboardRevisionVersion,
      'storyboardRevisionVersion',
    ),
    storyboardSourceSha256: parseInputSha256(input.storyboardSourceSha256, 'storyboardSourceSha256'),
    selectedShotId,
    scenes,
    shots,
    elements,
  }
}

function parseRequest(payload: unknown): ImagoElementMethodRequest {
  const input = parseInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'targetType',
    'targetId',
    'elementKind',
    'scopeType',
    'scopeId',
    'baseRevision',
    'baseSnapshotSha256',
  ])
  const projectId = parseIdentifier(input.projectId, 'projectId')
  const scopeId = parseIdentifier(input.scopeId, 'scopeId')
  if (input.targetType !== 'element_profile') throw new InputError('targetType must be element_profile')
  if (input.elementKind !== 'actor' && input.elementKind !== 'scene' && input.elementKind !== 'prop') {
    throw new InputError('elementKind must be actor, scene, or prop')
  }
  const elementKind = input.elementKind
  if (input.scopeType !== 'project') throw new InputError('scopeType must be project')
  if (scopeId !== projectId) throw new InputError('scopeId must equal projectId')
  return {
    projectId,
    targetType: 'element_profile',
    targetId: parseIdentifier(input.targetId, 'targetId'),
    elementKind,
    scopeType: 'project',
    scopeId,
    baseRevision: parseInputInteger(input.baseRevision, 'baseRevision'),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
  }
}

function parseReferenceAssetRequest(payload: unknown): ImagoReferenceAssetMethodRequest {
  const input = parseInputObject(payload)
  if (input.elementKind !== 'actor' && input.elementKind !== 'scene' && input.elementKind !== 'prop') {
    throw new InputError('elementKind must be actor, scene, or prop')
  }
  const elementKind = input.elementKind
  if (
    input.operation !== 'selectReferenceAsset'
    && input.operation !== 'requestReferenceRegeneration'
    && input.operation !== 'replaceReferenceRights'
    && input.operation !== 'recordReferenceRightsExceptionRelease'
  ) {
    throw new InputError(
      'operation must be selectReferenceAsset, requestReferenceRegeneration, replaceReferenceRights, or recordReferenceRightsExceptionRelease',
    )
  }
  const common: Omit<ImagoReferenceRightsMethodRequest, 'operation'> = {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    elementKind,
    elementId: parseIdentifier(input.elementId, 'elementId'),
    profileRevision: parseInputInteger(input.profileRevision, 'profileRevision'),
    snapshotSha256: parseInputSha256(input.snapshotSha256, 'snapshotSha256'),
  }
  if (input.operation === 'replaceReferenceRights' || input.operation === 'recordReferenceRightsExceptionRelease') {
    assertOnlyInputKeys(input, [
      'projectId',
      'elementKind',
      'elementId',
      'profileRevision',
      'snapshotSha256',
      'operation',
    ])
    return { ...common, operation: input.operation }
  }
  assertOnlyInputKeys(input, [
    'projectId',
    'elementKind',
    'elementId',
    'profileRevision',
    'snapshotSha256',
    'assetId',
    'assetSha256',
    'operation',
  ])
  return {
    ...common,
    assetId: parseIdentifier(input.assetId, 'assetId'),
    assetSha256: parseInputSha256(input.assetSha256, 'assetSha256'),
    operation: input.operation,
  }
}

function parsePromptText(value: unknown, field: string, allowEmpty = false): string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value !== value.trim()
    || value.includes('\u0000')
  ) {
    throw new InputError(`${field} must be ${allowEmpty ? 'a trimmed string without NUL' : 'a trimmed non-empty string'}`)
  }
  return value
}

function parseCompletePromptIrProjection(value: unknown): ImagoPromptIrEditableProjection {
  const input = parseInputObject(value)
  if (!isDeepStrictEqual(Object.keys(input).sort(), [...PROMPT_IR_EDITABLE_FIELDS].sort())) {
    throw new InputError('baseEditableProjection must contain exactly the five canonical editable fields')
  }
  return {
    imageGenPrompt: parsePromptText(input.imageGenPrompt, 'baseEditableProjection.imageGenPrompt', true),
    lastFrameImagePrompt: parsePromptText(
      input.lastFrameImagePrompt,
      'baseEditableProjection.lastFrameImagePrompt',
      true,
    ),
    videoGenPrompt: parsePromptText(input.videoGenPrompt, 'baseEditableProjection.videoGenPrompt', true),
    motionPrompt: parsePromptText(input.motionPrompt, 'baseEditableProjection.motionPrompt', true),
    negativePrompt: parsePromptText(input.negativePrompt, 'baseEditableProjection.negativePrompt', true),
  }
}

function parsePromptIrReplacements(value: unknown): ImagoPromptIrEditableReplacements {
  const input = parseInputObject(value)
  assertOnlyInputKeys(input, PROMPT_IR_EDITABLE_FIELDS)
  if (Object.keys(input).length === 0) {
    throw new InputError('candidateEditableProjection must contain at least one editable field')
  }
  const result: Record<string, string> = {}
  for (const field of PROMPT_IR_EDITABLE_FIELDS) {
    if (Object.hasOwn(input, field)) {
      result[field] = parsePromptText(input[field], `candidateEditableProjection.${field}`)
    }
  }
  return result
}

function buildYimengPromptIrSubject(request: ImagoPromptIrMethodRequest): ImagoMethodJsonObject {
  return {
    schema: 'jason.qingmu-prompt-ir-subject.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    targetType: 'prompt_ir',
    targetId: `${request.storyboardRevisionId}:${request.frameId}`,
    storyboardRevisionId: request.storyboardRevisionId,
    frameId: request.frameId,
    promptIrId: request.basePromptIrId,
    promptIrVersion: request.baseVersion,
    promptIrContentSha256: request.baseContentSha256,
    status: 'Ready',
    editableProjection: request.baseEditableProjection,
  }
}

function parsePromptIrRequest(payload: unknown): ImagoPromptIrMethodRequest {
  const input = parseInputObject(payload)
  assertOnlyInputKeys(input, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'basePromptIrId',
    'baseVersion',
    'baseSnapshotSha256',
    'baseContentSha256',
    'baseEditableProjection',
    'candidateEditableProjection',
  ])
  const request: ImagoPromptIrMethodRequest = {
    projectId: parseIdentifier(input.projectId, 'projectId'),
    episodeId: parseIdentifier(input.episodeId, 'episodeId'),
    storyboardRevisionId: parseIdentifier(input.storyboardRevisionId, 'storyboardRevisionId'),
    frameId: parseIdentifier(input.frameId, 'frameId'),
    basePromptIrId: parseIdentifier(input.basePromptIrId, 'basePromptIrId'),
    baseVersion: parseInputInteger(input.baseVersion, 'baseVersion'),
    baseSnapshotSha256: parseInputSha256(input.baseSnapshotSha256, 'baseSnapshotSha256'),
    baseContentSha256: parseInputSha256(input.baseContentSha256, 'baseContentSha256'),
    baseEditableProjection: parseCompletePromptIrProjection(input.baseEditableProjection),
    candidateEditableProjection: parsePromptIrReplacements(input.candidateEditableProjection),
  }
  if (canonicalSha256(buildYimengPromptIrSubject(request), 'basePromptIrSubject') !== request.baseSnapshotSha256) {
    throw new InputError('baseSnapshotSha256 does not match the canonical Ready PromptIR subject')
  }
  return request
}

function buildSnapshot(request: ImagoElementMethodRequest): ImagoElementMethodSnapshot {
  return {
    schema: 'qingmu.element-method-snapshot.v1',
    subject: {
      project_id: request.projectId,
      target_type: request.targetType,
      target_id: request.targetId,
      element_kind: request.elementKind,
      scope_type: request.scopeType,
      scope_id: request.scopeId,
      base_revision: request.baseRevision,
      base_snapshot_sha256: request.baseSnapshotSha256,
    },
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function buildReferenceAssetSnapshot(
  request: ImagoReferenceAssetActionMethodRequest,
): ImagoReferenceAssetMethodSnapshot {
  return {
    schema: 'qingmu.reference-asset-method-snapshot.v1',
    target: request,
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function buildReferenceRightsSnapshot(request: ImagoReferenceRightsMethodRequest): ImagoElementMethodSnapshot {
  return buildSnapshot({
    projectId: request.projectId,
    targetType: 'element_profile',
    targetId: request.elementId,
    elementKind: request.elementKind,
    scopeType: 'project',
    scopeId: request.projectId,
    baseRevision: request.profileRevision,
    baseSnapshotSha256: request.snapshotSha256,
  })
}

function buildPromptIrSnapshot(request: ImagoPromptIrMethodRequest): ImagoPromptIrMethodSnapshot {
  const {
    baseEditableProjection,
    candidateEditableProjection,
    ...target
  } = request
  return {
    schema: 'qingmu.prompt-ir-method-snapshot.v1',
    target,
    baseEditableProjection,
    candidateEditableProjection,
    authority: {
      business_truth: 'yimeng',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function buildYimengShotRelationAuthority(request: ImagoShotRelationMethodRequest): ImagoMethodJsonObject {
  return {
    schema: 'jason.qingmu-shot-relation-authority.v1',
    projectId: request.projectId,
    episodeId: request.episodeId,
    episodeRevision: request.episodeRevision,
    storyboardRevisionId: request.storyboardRevisionId,
    storyboardRevisionVersion: request.storyboardRevisionVersion,
    storyboardSourceSha256: request.storyboardSourceSha256,
    scenes: request.scenes,
    shots: request.shots,
    elements: request.elements,
  }
}

function buildShotRelationSnapshot(
  request: ImagoShotRelationMethodRequest,
): ImagoShotRelationMethodSnapshot {
  return {
    schema: 'qingmu.shot-relation-method-snapshot.v1',
    target: {
      projectId: request.projectId,
      episodeId: request.episodeId,
      episodeRevision: request.episodeRevision,
      storyboardRevisionId: request.storyboardRevisionId,
      storyboardRevisionVersion: request.storyboardRevisionVersion,
      storyboardSourceSha256: request.storyboardSourceSha256,
      relationSnapshotSha256: canonicalSha256(
        buildYimengShotRelationAuthority(request),
        'yimengShotRelationAuthority',
      ),
      selectedShotId: request.selectedShotId,
    },
    scenes: request.scenes,
    shots: request.shots,
    elements: request.elements,
    authority: {
      business_truth: 'yimeng',
      shot_id_source: 'yimeng_storyboard_frame_id',
      beat_id_scope: 'shot_local',
      method_source: 'imago_os_current',
      human_approval: 'not_granted',
      paid_provider_authority: 'not_granted',
    },
  }
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, char => char.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, char => char.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number)
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

/** Canonical JSON compatible with the bounded Python compiler contract. */
function canonicalJson(value: unknown, field: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ProjectionContractError(`${field} must contain only canonical safe integers`)
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${field}[${String(index)}]`)).join(',')}]`
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort(compareUnicodeCodePoints)
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${field}.${key}`)}`).join(',')}}`
  }
  throw new ProjectionContractError(`${field} must be canonical JSON`)
}

function canonicalSha256(value: unknown, field: string): string {
  return createHash('sha256').update(canonicalJson(value, field), 'utf8').digest('hex')
}

function readAttestationKey(): string {
  const key = process.env.QINGMU_IMAGO_ATTESTATION_KEY
  if (key === undefined || key === '' || Buffer.byteLength(key, 'utf8') < 32) {
    throw new AttestationKeyError()
  }
  return key
}

function createMethodAttestation(
  key: string,
  projection: ImagoElementMethodProjection,
  snapshot: ImagoElementMethodSnapshot,
): ImagoElementMethodAttestation {
  const unsigned = {
    schema: 'qingmu.imago-element-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: canonicalSha256(projection, 'projection'),
    inputSnapshotSha256: canonicalSha256(snapshot, 'snapshot'),
    subjectSha256: canonicalSha256(snapshot.subject, 'snapshot.subject'),
  } as const
  return {
    ...unsigned,
    signature: createHmac('sha256', key)
      .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
      .digest('hex'),
  }
}

function createReferenceAssetMethodAttestation(
  key: string,
  projection: ImagoReferenceAssetMethodProjection,
  snapshot: ImagoReferenceAssetMethodSnapshot,
): ImagoReferenceAssetMethodAttestation {
  const unsigned = {
    schema: 'qingmu.imago-reference-asset-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: canonicalSha256(projection, 'projection'),
    inputSnapshotSha256: canonicalSha256(snapshot, 'snapshot'),
    targetSha256: canonicalSha256(snapshot.target, 'snapshot.target'),
  } as const
  return {
    ...unsigned,
    signature: createHmac('sha256', key)
      .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
      .digest('hex'),
  }
}

function createPromptIrMethodAttestation(
  key: string,
  projection: ImagoPromptIrMethodProjection,
  snapshot: ImagoPromptIrMethodSnapshot,
): ImagoPromptIrMethodAttestation {
  const unsigned = {
    schema: 'qingmu.imago-prompt-ir-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: canonicalSha256(projection, 'projection'),
    inputSnapshotSha256: canonicalSha256(snapshot, 'snapshot'),
    targetSha256: canonicalSha256(snapshot.target, 'snapshot.target'),
    baseEditableProjectionSha256: canonicalSha256(
      snapshot.baseEditableProjection,
      'snapshot.baseEditableProjection',
    ),
    candidateEditableProjectionSha256: canonicalSha256(
      snapshot.candidateEditableProjection,
      'snapshot.candidateEditableProjection',
    ),
    candidateSha256: projection.candidate_sha256,
  } as const
  return {
    ...unsigned,
    signature: createHmac('sha256', key)
      .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
      .digest('hex'),
  }
}

function createShotRelationMethodAttestation(
  key: string,
  projection: ImagoShotRelationMethodProjection,
  snapshot: ImagoShotRelationMethodSnapshot,
): ImagoShotRelationMethodAttestation {
  const selectedShot = snapshot.shots.find(shot => shot.shotId === snapshot.target.selectedShotId)
  if (selectedShot === undefined) throw new ProjectionContractError('selected Shot is absent from attestation input')
  const unsigned = {
    schema: 'qingmu.imago-shot-relation-method-attestation.v1',
    algorithm: 'hmac-sha256',
    projectionSha256: canonicalSha256(projection, 'projection'),
    inputSnapshotSha256: canonicalSha256(snapshot, 'snapshot'),
    targetSha256: canonicalSha256(snapshot.target, 'snapshot.target'),
    relationSnapshotSha256: snapshot.target.relationSnapshotSha256,
    selectedShotSha256: canonicalSha256(selectedShot, 'snapshot.selectedShot'),
  } as const
  return {
    ...unsigned,
    signature: createHmac('sha256', key)
      .update(canonicalJson(unsigned, 'methodAttestation'), 'utf8')
      .digest('hex'),
  }
}

function requireExactArray(value: unknown, expected: readonly string[], field: string): void {
  if (!Array.isArray(value) || !isDeepStrictEqual(value, expected)) {
    throw new ProjectionContractError(`${field} does not match the bounded method contract`)
  }
}

function normalizeProjection(
  value: unknown,
  snapshot: ImagoElementMethodSnapshot,
): ImagoElementMethodProjection {
  assertSafeJsonNumbers(value, 'projection')
  const root = requireObject(value, 'projection')
  if (root.schema !== 'qingmu.imago-element-method-projection.v1') {
    throw new ProjectionContractError('projection.schema mismatch')
  }
  const expectedSnapshotSha = canonicalSha256(snapshot, 'snapshot')
  if (requireSha256(root.input_snapshot_sha256, 'projection.input_snapshot_sha256') !== expectedSnapshotSha) {
    throw new ProjectionContractError('projection input snapshot hash mismatch')
  }
  if (!isDeepStrictEqual(root.subject, snapshot.subject)) {
    throw new ProjectionContractError('projection subject mismatch')
  }
  const profile = ELEMENT_METHOD_PROFILES[snapshot.subject.element_kind]

  const definition = requireObject(root.method_definition, 'projection.method_definition')
  if (
    definition.id !== profile.methodId
    || requireInteger(definition.version, 'projection.method_definition.version', 1) !== 1
    || definition.agent_path !== profile.sourcePaths[4]
    || definition.skill_path !== profile.sourcePaths[5]
  ) {
    throw new ProjectionContractError('projection method definition mismatch')
  }
  for (const field of ['sha256', 'stage_contract_sha256', 'role_capability_sha256']) {
    requireSha256(definition[field], `projection.method_definition.${field}`)
  }

  const bindings = requireObjectArray(root.source_bindings, 'projection.source_bindings')
  const bindingPaths = bindings.map((binding, index) => {
    requireString(binding.kind, `projection.source_bindings[${String(index)}].kind`)
    requireSha256(binding.sha256, `projection.source_bindings[${String(index)}].sha256`)
    return requireString(binding.path, `projection.source_bindings[${String(index)}].path`)
  })
  if (!isDeepStrictEqual(bindingPaths, profile.sourcePaths)) {
    throw new ProjectionContractError('projection source bindings mismatch')
  }
  const fieldHints = requireObjectArray(root.field_hints, 'projection.field_hints')
  const checklist = requireObjectArray(root.checklist, 'projection.checklist')
  if (fieldHints.length < 1 || checklist.length < 1) {
    throw new ProjectionContractError('projection public method cards must not be empty')
  }

  const workOrder = requireObject(root.work_order_projection, 'projection.work_order_projection')
  if (workOrder.operation !== profile.operation) {
    throw new ProjectionContractError('projection work order operation mismatch')
  }
  requireExactArray(workOrder.allowed_mutations, [profile.operation], 'projection.work_order_projection.allowed_mutations')
  const expectedTarget = {
    projectId: snapshot.subject.project_id,
    targetType: snapshot.subject.target_type,
    targetId: snapshot.subject.target_id,
    elementKind: snapshot.subject.element_kind,
    scopeType: snapshot.subject.scope_type,
    scopeId: snapshot.subject.scope_id,
  }
  if (!isDeepStrictEqual(workOrder.target, expectedTarget)) {
    throw new ProjectionContractError('projection work order target mismatch')
  }

  const reviewCard = requireObject(root.review_card, 'projection.review_card')
  requireString(reviewCard.title, 'projection.review_card.title')
  if (!Array.isArray(reviewCard.hard_vetoes) || reviewCard.hard_vetoes.length < 1) {
    throw new ProjectionContractError('projection review hard vetoes must not be empty')
  }
  const legalWorkSet = requireObject(root.legal_work_set, 'projection.legal_work_set')
  requireExactArray(legalWorkSet.reads, profile.reads, 'projection.legal_work_set.reads')
  requireExactArray(legalWorkSet.writes, profile.writes, 'projection.legal_work_set.writes')
  requireExactArray(legalWorkSet.invalidates, profile.invalidates, 'projection.legal_work_set.invalidates')
  requireExactArray(legalWorkSet.forbidden, FORBIDDEN_WORK, 'projection.legal_work_set.forbidden')

  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || requireBoolean(root.project_state_persisted, 'projection.project_state_persisted')
    || root.paid_provider_authority !== 'not_granted'
    || requireBoolean(root.human_approval_inferred, 'projection.human_approval_inferred')
    || root.selection_authority !== 'not_granted'
  ) {
    throw new ProjectionContractError('projection authority boundary mismatch')
  }
  return root as ImagoElementMethodProjection
}

function normalizeReferenceRightsProjection(
  value: unknown,
  snapshot: ImagoElementMethodSnapshot,
  operation: ImagoReferenceRightsOperation,
): ImagoElementMethodProjection {
  assertSafeJsonNumbers(value, 'projection')
  const root = requireExactObject(value, [
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
  ], 'projection')
  if (root.schema !== 'qingmu.imago-element-method-projection.v1') {
    throw new ProjectionContractError('projection.schema mismatch')
  }
  if (
    requireSha256(root.input_snapshot_sha256, 'projection.input_snapshot_sha256')
    !== canonicalSha256(snapshot, 'snapshot')
  ) {
    throw new ProjectionContractError('projection input snapshot hash mismatch')
  }
  if (!isDeepStrictEqual(root.subject, snapshot.subject)) {
    throw new ProjectionContractError('projection subject mismatch')
  }
  const sourcePaths = ELEMENT_METHOD_PROFILES[snapshot.subject.element_kind].sourcePaths

  const definition = requireExactObject(root.method_definition, [
    'id',
    'version',
    'sha256',
    'stage_contract_sha256',
    'role_capability_sha256',
    'agent_path',
    'skill_path',
  ], 'projection.method_definition')
  const exceptionRelease = operation === 'recordReferenceRightsExceptionRelease'
  if (
    definition.id !== (exceptionRelease
      ? 'imago-v6-reference-rights-exception-release'
      : 'imago-v6-reference-rights-record')
    || requireInteger(definition.version, 'projection.method_definition.version', 1) !== 1
    || definition.agent_path !== sourcePaths[4]
    || definition.skill_path !== sourcePaths[5]
  ) {
    throw new ProjectionContractError('projection method definition mismatch')
  }
  for (const field of ['sha256', 'stage_contract_sha256', 'role_capability_sha256']) {
    requireSha256(definition[field], `projection.method_definition.${field}`)
  }

  const bindings = requireObjectArray(root.source_bindings, 'projection.source_bindings')
  if (bindings.length !== sourcePaths.length) {
    throw new ProjectionContractError('projection source bindings mismatch')
  }
  bindings.forEach((bindingValue, index) => {
    const binding = requireExactObject(
      bindingValue,
      ['kind', 'path', 'sha256'],
      `projection.source_bindings[${String(index)}]`,
    )
    if (
      binding.kind !== REFERENCE_ASSET_SOURCE_KINDS[index]
      || binding.path !== sourcePaths[index]
    ) {
      throw new ProjectionContractError('projection source bindings mismatch')
    }
    requireSha256(binding.sha256, `projection.source_bindings[${String(index)}].sha256`)
  })

  const fieldHints = requireObjectArray(root.field_hints, 'projection.field_hints')
  if (fieldHints.length === 0) throw new ProjectionContractError('projection field hints must not be empty')
  fieldHints.forEach((hintValue, index) => {
    const hint = requireExactObject(
      hintValue,
      ['hint_id', 'field', 'title', 'guidance'],
      `projection.field_hints[${String(index)}]`,
    )
    for (const field of ['hint_id', 'field', 'title', 'guidance']) {
      if (requireString(hint[field], `projection.field_hints[${String(index)}].${field}`).length === 0) {
        throw new ProjectionContractError('projection field hints must not contain empty strings')
      }
    }
  })
  const checklist = requireObjectArray(root.checklist, 'projection.checklist')
  if (checklist.length === 0) throw new ProjectionContractError('projection checklist must not be empty')
  checklist.forEach((itemValue, index) => {
    const item = requireExactObject(
      itemValue,
      ['check_id', 'label', 'required'],
      `projection.checklist[${String(index)}]`,
    )
    if (
      requireString(item.check_id, `projection.checklist[${String(index)}].check_id`).length === 0
      || requireString(item.label, `projection.checklist[${String(index)}].label`).length === 0
      || !requireBoolean(item.required, `projection.checklist[${String(index)}].required`)
    ) {
      throw new ProjectionContractError('projection checklist item mismatch')
    }
  })

  const expectedTarget = {
    projectId: snapshot.subject.project_id,
    targetType: snapshot.subject.target_type,
    targetId: snapshot.subject.target_id,
    elementKind: snapshot.subject.element_kind,
    scopeType: snapshot.subject.scope_type,
    scopeId: snapshot.subject.scope_id,
  }
  const workOrder = requireExactObject(root.work_order_projection, [
    'target',
    'operation',
    'allowed_mutations',
    'required_read_set',
    'before_write',
    'after_write',
  ], 'projection.work_order_projection')
  if (
    !isDeepStrictEqual(workOrder.target, expectedTarget)
    || workOrder.operation !== operation
  ) {
    throw new ProjectionContractError('projection work order target or operation mismatch')
  }
  requireExactArray(
    workOrder.allowed_mutations,
    [operation],
    'projection.work_order_projection.allowed_mutations',
  )
  if (!isDeepStrictEqual(workOrder.required_read_set, [{
    source: 'yimeng',
    resource: 'element_reference_rights_snapshot',
    revision: snapshot.subject.base_revision,
    sha256: snapshot.subject.base_snapshot_sha256,
  }])) {
    throw new ProjectionContractError('projection work order required reads mismatch')
  }
  requireNonemptyStringArray(workOrder.before_write, 'projection.work_order_projection.before_write')
  requireNonemptyStringArray(workOrder.after_write, 'projection.work_order_projection.after_write')

  const reviewCard = requireExactObject(root.review_card, [
    'title',
    'summary',
    'review_dimensions',
    'hard_vetoes',
    'decision_boundary',
  ], 'projection.review_card')
  for (const field of ['title', 'summary', 'decision_boundary']) {
    if (requireString(reviewCard[field], `projection.review_card.${field}`).length === 0) {
      throw new ProjectionContractError('projection review card must not contain empty strings')
    }
  }
  requireNonemptyStringArray(reviewCard.review_dimensions, 'projection.review_card.review_dimensions')
  requireNonemptyStringArray(reviewCard.hard_vetoes, 'projection.review_card.hard_vetoes')

  const legalWorkSet = requireExactObject(
    root.legal_work_set,
    ['reads', 'writes', 'invalidates', 'forbidden'],
    'projection.legal_work_set',
  )
  requireExactArray(
    legalWorkSet.reads,
    ['yimeng_element_reference_rights_snapshot'],
    'projection.legal_work_set.reads',
  )
  requireExactArray(
    legalWorkSet.writes,
    [exceptionRelease
      ? 'record_reference_rights_exception_release_via_human_command'
      : 'replace_reference_rights_via_changeset'],
    'projection.legal_work_set.writes',
  )
  requireExactArray(
    legalWorkSet.invalidates,
    [exceptionRelease
      ? 'reference_rights_exception_release_projection'
      : 'reference_rights_dependent_projection'],
    'projection.legal_work_set.invalidates',
  )
  requireExactArray(
    legalWorkSet.forbidden,
    exceptionRelease ? REFERENCE_RIGHTS_EXCEPTION_RELEASE_FORBIDDEN_WORK : FORBIDDEN_WORK,
    'projection.legal_work_set.forbidden',
  )

  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || requireBoolean(root.project_state_persisted, 'projection.project_state_persisted')
    || root.paid_provider_authority !== 'not_granted'
    || requireBoolean(root.human_approval_inferred, 'projection.human_approval_inferred')
    || root.selection_authority !== 'not_granted'
  ) {
    throw new ProjectionContractError('projection authority boundary mismatch')
  }
  return root as ImagoElementMethodProjection
}

function normalizeReferenceAssetProjection(
  value: unknown,
  snapshot: ImagoReferenceAssetMethodSnapshot,
): ImagoReferenceAssetMethodProjection {
  assertSafeJsonNumbers(value, 'projection')
  const root = requireExactObject(value, [
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
  ], 'projection')
  if (root.schema !== 'qingmu.imago-reference-asset-method-projection.v1') {
    throw new ProjectionContractError('projection.schema mismatch')
  }
  const expectedSnapshotSha = canonicalSha256(snapshot, 'snapshot')
  if (requireSha256(root.input_snapshot_sha256, 'projection.input_snapshot_sha256') !== expectedSnapshotSha) {
    throw new ProjectionContractError('projection input snapshot hash mismatch')
  }
  const target = requireExactObject(root.target, [
    'projectId',
    'elementKind',
    'elementId',
    'profileRevision',
    'snapshotSha256',
    'assetId',
    'assetSha256',
    'operation',
  ], 'projection.target')
  if (!isDeepStrictEqual(target, snapshot.target)) {
    throw new ProjectionContractError('projection target mismatch')
  }
  const profile = REFERENCE_ASSET_METHOD_PROFILES[snapshot.target.elementKind]

  const definition = requireExactObject(root.method_definition, [
    'id',
    'version',
    'sha256',
    'stage_contract_sha256',
    'role_capability_sha256',
    'agent_path',
    'skill_path',
  ], 'projection.method_definition')
  if (
    definition.id !== profile.methodId
    || requireInteger(definition.version, 'projection.method_definition.version', 1) !== 1
    || definition.agent_path !== profile.sourcePaths[4]
    || definition.skill_path !== profile.sourcePaths[5]
  ) {
    throw new ProjectionContractError('projection method definition mismatch')
  }
  for (const field of ['sha256', 'stage_contract_sha256', 'role_capability_sha256']) {
    requireSha256(definition[field], `projection.method_definition.${field}`)
  }

  const bindings = requireObjectArray(root.source_bindings, 'projection.source_bindings')
  if (bindings.length !== profile.sourcePaths.length) {
    throw new ProjectionContractError('projection source bindings mismatch')
  }
  bindings.forEach((bindingValue, index) => {
    const binding = requireExactObject(bindingValue, ['kind', 'path', 'sha256'], `projection.source_bindings[${String(index)}]`)
    if (
      binding.kind !== REFERENCE_ASSET_SOURCE_KINDS[index]
      || binding.path !== profile.sourcePaths[index]
    ) {
      throw new ProjectionContractError('projection source bindings mismatch')
    }
    requireSha256(binding.sha256, `projection.source_bindings[${String(index)}].sha256`)
  })

  const fieldHints = requireObjectArray(root.field_hints, 'projection.field_hints')
  if (fieldHints.length === 0) throw new ProjectionContractError('projection field hints must not be empty')
  fieldHints.forEach((hintValue, index) => {
    const hint = requireExactObject(
      hintValue,
      ['hint_id', 'field', 'title', 'guidance'],
      `projection.field_hints[${String(index)}]`,
    )
    for (const field of ['hint_id', 'field', 'title', 'guidance']) {
      if (requireString(hint[field], `projection.field_hints[${String(index)}].${field}`).length === 0) {
        throw new ProjectionContractError('projection field hints must not contain empty strings')
      }
    }
  })

  const checklist = requireObjectArray(root.checklist, 'projection.checklist')
  if (checklist.length === 0) throw new ProjectionContractError('projection checklist must not be empty')
  checklist.forEach((itemValue, index) => {
    const item = requireExactObject(
      itemValue,
      ['check_id', 'label', 'required'],
      `projection.checklist[${String(index)}]`,
    )
    if (
      requireString(item.check_id, `projection.checklist[${String(index)}].check_id`).length === 0
      || requireString(item.label, `projection.checklist[${String(index)}].label`).length === 0
      || !requireBoolean(item.required, `projection.checklist[${String(index)}].required`)
    ) {
      throw new ProjectionContractError('projection checklist item mismatch')
    }
  })

  const workOrder = requireExactObject(root.work_order_projection, [
    'target',
    'operation',
    'allowed_mutations',
    'required_read_set',
    'before_write',
    'after_write',
    'providerCalls',
    'workerStarted',
  ], 'projection.work_order_projection')
  if (
    !isDeepStrictEqual(workOrder.target, snapshot.target)
    || workOrder.operation !== snapshot.target.operation
  ) {
    throw new ProjectionContractError('projection work order target or operation mismatch')
  }
  requireExactArray(
    workOrder.allowed_mutations,
    [snapshot.target.operation],
    'projection.work_order_projection.allowed_mutations',
  )
  const expectedReadSet = [
    {
      source: 'yimeng',
      resource: profile.requiredResource,
      id: snapshot.target.elementId,
      revision: snapshot.target.profileRevision,
      sha256: snapshot.target.snapshotSha256,
    },
    {
      source: 'yimeng',
      resource: 'reference_asset_candidate',
      id: snapshot.target.assetId,
      sha256: snapshot.target.assetSha256,
    },
  ]
  if (!isDeepStrictEqual(workOrder.required_read_set, expectedReadSet)) {
    throw new ProjectionContractError('projection work order required reads mismatch')
  }
  requireNonemptyStringArray(workOrder.before_write, 'projection.work_order_projection.before_write')
  requireNonemptyStringArray(workOrder.after_write, 'projection.work_order_projection.after_write')
  if (
    workOrder.providerCalls !== 0
    || requireBoolean(workOrder.workerStarted, 'projection.work_order_projection.workerStarted')
  ) {
    throw new ProjectionContractError('projection work order execution boundary mismatch')
  }

  const reviewCard = requireExactObject(root.review_card, [
    'title',
    'summary',
    'review_dimensions',
    'hard_vetoes',
    'decision_boundary',
    'comment_boundary',
  ], 'projection.review_card')
  for (const field of ['title', 'summary', 'decision_boundary', 'comment_boundary']) {
    if (requireString(reviewCard[field], `projection.review_card.${field}`).length === 0) {
      throw new ProjectionContractError('projection review card must not contain empty strings')
    }
  }
  requireNonemptyStringArray(reviewCard.review_dimensions, 'projection.review_card.review_dimensions')
  requireNonemptyStringArray(reviewCard.hard_vetoes, 'projection.review_card.hard_vetoes')

  const legalWorkSet = requireExactObject(
    root.legal_work_set,
    ['reads', 'writes', 'invalidates', 'forbidden'],
    'projection.legal_work_set',
  )
  requireExactArray(
    legalWorkSet.reads,
    [profile.legalRead, 'yimeng_reference_asset_candidate'],
    'projection.legal_work_set.reads',
  )
  requireExactArray(
    legalWorkSet.writes,
    [snapshot.target.operation === 'selectReferenceAsset'
      ? 'propose_reference_asset_selection_via_yimeng_changeset'
      : 'propose_reference_regeneration_via_yimeng_changeset'],
    'projection.legal_work_set.writes',
  )
  requireExactArray(legalWorkSet.invalidates, [], 'projection.legal_work_set.invalidates')
  requireExactArray(
    legalWorkSet.forbidden,
    REFERENCE_ASSET_FORBIDDEN_WORK,
    'projection.legal_work_set.forbidden',
  )

  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || requireBoolean(root.project_state_persisted, 'projection.project_state_persisted')
    || root.providerCalls !== 0
    || requireBoolean(root.workerStarted, 'projection.workerStarted')
    || requireBoolean(root.human_approval_inferred, 'projection.human_approval_inferred')
    || requireBoolean(root.human_signoff_inferred, 'projection.human_signoff_inferred')
    || requireBoolean(root.selection_executed, 'projection.selection_executed')
  ) {
    throw new ProjectionContractError('projection authority or execution boundary mismatch')
  }
  return root as ImagoReferenceAssetMethodProjection
}

function normalizePromptIrEditableProjection(
  value: unknown,
  field: string,
): ImagoPromptIrEditableProjection {
  const object = requireExactObject(value, PROMPT_IR_EDITABLE_FIELDS, field)
  const normalized = {} as Record<ImagoPromptIrEditableField, string>
  for (const editableField of PROMPT_IR_EDITABLE_FIELDS) {
    const text = requireString(object[editableField], `${field}.${editableField}`)
    if (text !== text.trim() || text.includes('\u0000')) {
      throw new ProjectionContractError(`${field}.${editableField} must be a trimmed string without NUL`)
    }
    normalized[editableField] = text
  }
  return normalized
}

function normalizePromptIrProjection(
  value: unknown,
  snapshot: ImagoPromptIrMethodSnapshot,
): ImagoPromptIrMethodProjection {
  assertSafeJsonNumbers(value, 'projection')
  const root = requireExactObject(value, [
    'schema',
    'input_snapshot_sha256',
    'target',
    'normalized_candidate',
    'candidate_sha256',
    'changed_paths',
    'blockers',
    'warnings',
    'method_definition',
    'source_bindings',
    'field_hints',
    'checklist',
    'work_order_projection',
    'authority_snapshot_attestation',
    'project_state_persisted',
    'providerCalls',
    'workerStarted',
    'selection_executed',
    'human_approval_inferred',
    'human_signoff_inferred',
  ], 'projection')
  if (root.schema !== 'qingmu.imago-prompt-ir-method-projection.v1') {
    throw new ProjectionContractError('projection.schema mismatch')
  }
  const expectedSnapshotSha = canonicalSha256(snapshot, 'snapshot')
  if (requireSha256(root.input_snapshot_sha256, 'projection.input_snapshot_sha256') !== expectedSnapshotSha) {
    throw new ProjectionContractError('projection input snapshot hash mismatch')
  }
  const target = requireExactObject(root.target, [
    'projectId',
    'episodeId',
    'storyboardRevisionId',
    'frameId',
    'basePromptIrId',
    'baseVersion',
    'baseSnapshotSha256',
    'baseContentSha256',
  ], 'projection.target')
  if (!isDeepStrictEqual(target, snapshot.target)) {
    throw new ProjectionContractError('projection target mismatch')
  }

  const normalizedCandidate = normalizePromptIrEditableProjection(
    root.normalized_candidate,
    'projection.normalized_candidate',
  )
  const expectedCandidate: ImagoPromptIrEditableProjection = {
    ...snapshot.baseEditableProjection,
    ...snapshot.candidateEditableProjection,
  }
  if (!isDeepStrictEqual(normalizedCandidate, expectedCandidate)) {
    throw new ProjectionContractError('projection normalized candidate mismatch')
  }
  const candidateSha256 = requireSha256(root.candidate_sha256, 'projection.candidate_sha256')
  if (candidateSha256 !== canonicalSha256(expectedCandidate, 'projection.normalized_candidate')) {
    throw new ProjectionContractError('projection candidate hash mismatch')
  }
  const expectedChangedPaths = PROMPT_IR_EDITABLE_FIELDS
    .filter(field => snapshot.baseEditableProjection[field] !== expectedCandidate[field])
    .map(field => `/editableProjection/${field}`)
  requireExactArray(root.changed_paths, expectedChangedPaths, 'projection.changed_paths')
  requireExactArray(
    root.blockers,
    expectedChangedPaths.length === 0 ? ['candidate_has_no_editable_changes'] : [],
    'projection.blockers',
  )
  requireExactArray(root.warnings, [PROMPT_IR_MAPPING_WARNING], 'projection.warnings')

  const definition = requireExactObject(root.method_definition, [
    'id',
    'version',
    'sha256',
    'stage_contract_sha256',
    'role_capability_sha256',
    'prompt_ir_schema',
    'field_mapping',
    'agent_path',
    'skill_path',
  ], 'projection.method_definition')
  if (
    definition.id !== 'imago-v6-e-provider-neutral-prompt-ir-edit-method'
    || requireInteger(definition.version, 'projection.method_definition.version', 1) !== 1
    || definition.prompt_ir_schema !== 'IMAGO-V6-VideoPromptIR-v1'
    || definition.field_mapping !== 'not_declared'
    || definition.agent_path !== PROMPT_IR_SOURCE_PATHS[5]
    || definition.skill_path !== PROMPT_IR_SOURCE_PATHS[6]
  ) {
    throw new ProjectionContractError('projection method definition mismatch')
  }
  for (const field of ['sha256', 'stage_contract_sha256', 'role_capability_sha256']) {
    requireSha256(definition[field], `projection.method_definition.${field}`)
  }

  const bindings = requireObjectArray(root.source_bindings, 'projection.source_bindings')
  if (bindings.length !== PROMPT_IR_SOURCE_PATHS.length) {
    throw new ProjectionContractError('projection source bindings mismatch')
  }
  bindings.forEach((bindingValue, index) => {
    const binding = requireExactObject(
      bindingValue,
      ['kind', 'path', 'sha256'],
      `projection.source_bindings[${String(index)}]`,
    )
    if (binding.kind !== PROMPT_IR_SOURCE_KINDS[index] || binding.path !== PROMPT_IR_SOURCE_PATHS[index]) {
      throw new ProjectionContractError('projection source bindings mismatch')
    }
    requireSha256(binding.sha256, `projection.source_bindings[${String(index)}].sha256`)
  })

  const fieldHints = requireObjectArray(root.field_hints, 'projection.field_hints')
  if (fieldHints.length === 0) throw new ProjectionContractError('projection field hints must not be empty')
  fieldHints.forEach((hintValue, index) => {
    const hint = requireExactObject(
      hintValue,
      ['hint_id', 'field', 'title', 'guidance'],
      `projection.field_hints[${String(index)}]`,
    )
    for (const field of ['hint_id', 'field', 'title', 'guidance']) {
      if (requireString(hint[field], `projection.field_hints[${String(index)}].${field}`).length === 0) {
        throw new ProjectionContractError('projection field hints must not contain empty strings')
      }
    }
  })
  const checklist = requireObjectArray(root.checklist, 'projection.checklist')
  if (checklist.length === 0) throw new ProjectionContractError('projection checklist must not be empty')
  checklist.forEach((itemValue, index) => {
    const item = requireExactObject(
      itemValue,
      ['check_id', 'label', 'required'],
      `projection.checklist[${String(index)}]`,
    )
    if (
      requireString(item.check_id, `projection.checklist[${String(index)}].check_id`).length === 0
      || requireString(item.label, `projection.checklist[${String(index)}].label`).length === 0
      || !requireBoolean(item.required, `projection.checklist[${String(index)}].required`)
    ) {
      throw new ProjectionContractError('projection checklist item mismatch')
    }
  })

  const workOrder = requireExactObject(root.work_order_projection, [
    'target',
    'operation',
    'allowed_mutations',
    'editable_fields',
    'required_read_set',
    'before_compile',
    'after_compile',
    'providerCalls',
    'workerStarted',
  ], 'projection.work_order_projection')
  if (
    !isDeepStrictEqual(workOrder.target, snapshot.target)
    || workOrder.operation !== 'compilePromptIrCandidateProjection'
  ) {
    throw new ProjectionContractError('projection work order target or operation mismatch')
  }
  requireExactArray(workOrder.allowed_mutations, [], 'projection.work_order_projection.allowed_mutations')
  requireExactArray(
    workOrder.editable_fields,
    PROMPT_IR_EDITABLE_FIELDS,
    'projection.work_order_projection.editable_fields',
  )
  const expectedReadSet = [{
    source: 'yimeng',
    resource: 'prompt_ir_authoritative_snapshot',
    projectId: snapshot.target.projectId,
    episodeId: snapshot.target.episodeId,
    targetId: `${snapshot.target.storyboardRevisionId}:${snapshot.target.frameId}`,
    storyboardRevisionId: snapshot.target.storyboardRevisionId,
    frameId: snapshot.target.frameId,
    promptIrId: snapshot.target.basePromptIrId,
    promptIrVersion: snapshot.target.baseVersion,
    snapshotSha256: snapshot.target.baseSnapshotSha256,
    contentSha256: snapshot.target.baseContentSha256,
    status: 'Ready',
  }]
  if (!isDeepStrictEqual(workOrder.required_read_set, expectedReadSet)) {
    throw new ProjectionContractError('projection work order required reads mismatch')
  }
  requireNonemptyStringArray(workOrder.before_compile, 'projection.work_order_projection.before_compile')
  requireNonemptyStringArray(workOrder.after_compile, 'projection.work_order_projection.after_compile')
  if (
    workOrder.providerCalls !== 0
    || requireBoolean(workOrder.workerStarted, 'projection.work_order_projection.workerStarted')
  ) {
    throw new ProjectionContractError('projection work order execution boundary mismatch')
  }

  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || requireBoolean(root.project_state_persisted, 'projection.project_state_persisted')
    || root.providerCalls !== 0
    || requireBoolean(root.workerStarted, 'projection.workerStarted')
    || requireBoolean(root.selection_executed, 'projection.selection_executed')
    || requireBoolean(root.human_approval_inferred, 'projection.human_approval_inferred')
    || requireBoolean(root.human_signoff_inferred, 'projection.human_signoff_inferred')
  ) {
    throw new ProjectionContractError('projection authority or execution boundary mismatch')
  }
  return root as ImagoPromptIrMethodProjection
}

function normalizeShotRelationProjection(
  value: unknown,
  snapshot: ImagoShotRelationMethodSnapshot,
): ImagoShotRelationMethodProjection {
  assertSafeJsonNumbers(value, 'projection')
  const root = requireExactObject(value, [
    'schema',
    'input_snapshot_sha256',
    'target',
    'relationship_projection',
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
  ], 'projection')
  if (root.schema !== 'qingmu.imago-shot-relation-method-projection.v1') {
    throw new ProjectionContractError('projection.schema mismatch')
  }
  if (
    requireSha256(root.input_snapshot_sha256, 'projection.input_snapshot_sha256')
    !== canonicalSha256(snapshot, 'snapshot')
  ) {
    throw new ProjectionContractError('projection input snapshot hash mismatch')
  }
  const target = requireExactObject(root.target, [
    'projectId',
    'episodeId',
    'episodeRevision',
    'storyboardRevisionId',
    'storyboardRevisionVersion',
    'storyboardSourceSha256',
    'relationSnapshotSha256',
    'selectedShotId',
  ], 'projection.target')
  if (!isDeepStrictEqual(target, snapshot.target)) {
    throw new ProjectionContractError('projection target mismatch')
  }

  const selectedShot = snapshot.shots.find(shot => shot.shotId === snapshot.target.selectedShotId)
  if (selectedShot === undefined) throw new ProjectionContractError('projection selected Shot is absent')
  const relationships = requireExactObject(root.relationship_projection, [
    'canonicalShotIdSource',
    'beatIdScope',
    'scenes',
    'shots',
    'elements',
    'selectedShot',
  ], 'projection.relationship_projection')
  if (
    relationships.canonicalShotIdSource !== 'yimeng_storyboard_frame_id'
    || relationships.beatIdScope !== 'shot_local'
    || !isDeepStrictEqual(relationships.scenes, snapshot.scenes)
    || !isDeepStrictEqual(relationships.shots, snapshot.shots)
    || !isDeepStrictEqual(relationships.elements, snapshot.elements)
    || !isDeepStrictEqual(relationships.selectedShot, selectedShot)
  ) {
    throw new ProjectionContractError('projection relationship graph mismatch')
  }

  const definition = requireExactObject(root.method_definition, [
    'id',
    'version',
    'sha256',
    'yimeng_subject_schema',
    'stage_contract_sha256',
    'role_capability_sha256',
    'agent_paths',
    'skill_paths',
  ], 'projection.method_definition')
  if (
    definition.id !== 'imago-v6-c-c5-scene-shot-beat-element-relation'
    || requireInteger(definition.version, 'projection.method_definition.version', 1) !== 1
    || definition.yimeng_subject_schema !== 'jason.qingmu-shot-relation-authority.v1'
  ) {
    throw new ProjectionContractError('projection method definition mismatch')
  }
  requireSha256(definition.sha256, 'projection.method_definition.sha256')
  const stageContracts = requireExactObject(
    definition.stage_contract_sha256,
    ['CDEV', 'C5R'],
    'projection.method_definition.stage_contract_sha256',
  )
  requireSha256(stageContracts.CDEV, 'projection.method_definition.stage_contract_sha256.CDEV')
  requireSha256(stageContracts.C5R, 'projection.method_definition.stage_contract_sha256.C5R')
  const roleCapabilities = requireExactObject(
    definition.role_capability_sha256,
    ['C', 'C5'],
    'projection.method_definition.role_capability_sha256',
  )
  requireSha256(roleCapabilities.C, 'projection.method_definition.role_capability_sha256.C')
  requireSha256(roleCapabilities.C5, 'projection.method_definition.role_capability_sha256.C5')
  requireExactArray(
    definition.agent_paths,
    [SHOT_RELATION_SOURCE_PATHS[5], SHOT_RELATION_SOURCE_PATHS[8]],
    'projection.method_definition.agent_paths',
  )
  requireExactArray(
    definition.skill_paths,
    [SHOT_RELATION_SOURCE_PATHS[6], SHOT_RELATION_SOURCE_PATHS[9]],
    'projection.method_definition.skill_paths',
  )

  const bindings = requireObjectArray(root.source_bindings, 'projection.source_bindings')
  if (bindings.length !== SHOT_RELATION_SOURCE_PATHS.length) {
    throw new ProjectionContractError('projection source bindings mismatch')
  }
  bindings.forEach((value, index) => {
    const binding = requireExactObject(
      value,
      ['kind', 'path', 'sha256'],
      `projection.source_bindings[${String(index)}]`,
    )
    if (
      binding.kind !== SHOT_RELATION_SOURCE_KINDS[index]
      || binding.path !== SHOT_RELATION_SOURCE_PATHS[index]
    ) {
      throw new ProjectionContractError('projection source bindings mismatch')
    }
    requireSha256(binding.sha256, `projection.source_bindings[${String(index)}].sha256`)
  })

  const fieldHints = requireObjectArray(root.field_hints, 'projection.field_hints')
  if (fieldHints.length !== SHOT_RELATION_HINT_IDS.length) {
    throw new ProjectionContractError('projection field hints mismatch')
  }
  fieldHints.forEach((value, index) => {
    const hint = requireExactObject(
      value,
      ['hint_id', 'title', 'guidance'],
      `projection.field_hints[${String(index)}]`,
    )
    if (
      hint.hint_id !== SHOT_RELATION_HINT_IDS[index]
      || requireString(hint.title, `projection.field_hints[${String(index)}].title`).length === 0
      || requireString(hint.guidance, `projection.field_hints[${String(index)}].guidance`).length === 0
    ) {
      throw new ProjectionContractError('projection field hints mismatch')
    }
  })
  const checklist = requireObjectArray(root.checklist, 'projection.checklist')
  if (checklist.length !== SHOT_RELATION_CHECK_IDS.length) {
    throw new ProjectionContractError('projection checklist mismatch')
  }
  checklist.forEach((value, index) => {
    const item = requireExactObject(
      value,
      ['check_id', 'label', 'required'],
      `projection.checklist[${String(index)}]`,
    )
    if (
      item.check_id !== SHOT_RELATION_CHECK_IDS[index]
      || requireString(item.label, `projection.checklist[${String(index)}].label`).length === 0
      || !requireBoolean(item.required, `projection.checklist[${String(index)}].required`)
    ) {
      throw new ProjectionContractError('projection checklist mismatch')
    }
  })

  const workOrder = requireExactObject(root.work_order_projection, [
    'target',
    'operation',
    'allowed_mutations',
    'required_read_set',
    'before_compile',
    'after_compile',
    'providerCalls',
    'workerStarted',
  ], 'projection.work_order_projection')
  if (
    !isDeepStrictEqual(workOrder.target, snapshot.target)
    || workOrder.operation !== 'inspectCanonicalShotRelations'
  ) {
    throw new ProjectionContractError('projection work order target or operation mismatch')
  }
  requireExactArray(workOrder.allowed_mutations, [], 'projection.work_order_projection.allowed_mutations')
  const expectedReadSet = [{
    source: 'yimeng',
    resource: 'scene_shot_beat_element_relation_snapshot',
    projectId: snapshot.target.projectId,
    episodeId: snapshot.target.episodeId,
    episodeRevision: snapshot.target.episodeRevision,
    storyboardRevisionId: snapshot.target.storyboardRevisionId,
    storyboardRevisionVersion: snapshot.target.storyboardRevisionVersion,
    storyboardSourceSha256: snapshot.target.storyboardSourceSha256,
    relationSnapshotSha256: snapshot.target.relationSnapshotSha256,
    selectedShotId: snapshot.target.selectedShotId,
  }]
  if (!isDeepStrictEqual(workOrder.required_read_set, expectedReadSet)) {
    throw new ProjectionContractError('projection work order required reads mismatch')
  }
  requireNonemptyStringArray(workOrder.before_compile, 'projection.work_order_projection.before_compile')
  requireNonemptyStringArray(workOrder.after_compile, 'projection.work_order_projection.after_compile')
  if (
    workOrder.providerCalls !== 0
    || requireBoolean(workOrder.workerStarted, 'projection.work_order_projection.workerStarted')
  ) {
    throw new ProjectionContractError('projection work order execution boundary mismatch')
  }

  const reviewCard = requireExactObject(root.review_card, [
    'title',
    'summary',
    'review_dimensions',
    'hard_vetoes',
    'decision_boundary',
  ], 'projection.review_card')
  for (const field of ['title', 'summary', 'decision_boundary']) {
    if (requireString(reviewCard[field], `projection.review_card.${field}`).length === 0) {
      throw new ProjectionContractError('projection review card must not contain empty strings')
    }
  }
  requireNonemptyStringArray(reviewCard.review_dimensions, 'projection.review_card.review_dimensions')
  requireNonemptyStringArray(reviewCard.hard_vetoes, 'projection.review_card.hard_vetoes')

  const legalWorkSet = requireExactObject(
    root.legal_work_set,
    ['reads', 'writes', 'forbidden'],
    'projection.legal_work_set',
  )
  requireExactArray(
    legalWorkSet.reads,
    ['yimeng_scene_shot_beat_element_relation_snapshot'],
    'projection.legal_work_set.reads',
  )
  requireExactArray(legalWorkSet.writes, [], 'projection.legal_work_set.writes')
  requireExactArray(
    legalWorkSet.forbidden,
    SHOT_RELATION_FORBIDDEN_WORK,
    'projection.legal_work_set.forbidden',
  )

  if (
    root.authority_snapshot_attestation !== 'not_verified_by_compiler'
    || requireBoolean(root.project_state_persisted, 'projection.project_state_persisted')
    || root.providerCalls !== 0
    || requireBoolean(root.workerStarted, 'projection.workerStarted')
    || requireBoolean(root.selection_executed, 'projection.selection_executed')
    || requireBoolean(root.human_approval_inferred, 'projection.human_approval_inferred')
    || requireBoolean(root.human_signoff_inferred, 'projection.human_signoff_inferred')
  ) {
    throw new ProjectionContractError('projection authority or execution boundary mismatch')
  }
  return root as ImagoShotRelationMethodProjection
}

function resolveExecution(config: ImagoMethodAdapterConfig): ImagoMethodCompilerExecution {
  const configuredCoreRoot = config.coreRoot?.trim()
  const coreRoot = (configuredCoreRoot === undefined || configuredCoreRoot === ''
    ? process.env.IMAGO_OS_CORE_ROOT ?? ''
    : configuredCoreRoot).trim()
  if (!isAbsolute(coreRoot) || /[\u0000\r\n]/.test(coreRoot)) {
    throw new Error('qingmu-imago-method-adapter coreRoot must be an absolute path')
  }
  const pythonExecutable = (config.pythonExecutable ?? DEFAULT_PYTHON_EXECUTABLE).trim()
  if (pythonExecutable.length === 0 || pythonExecutable.startsWith('-') || /[\u0000\r\n]/.test(pythonExecutable)) {
    throw new Error('qingmu-imago-method-adapter pythonExecutable is invalid')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`qingmu-imago-method-adapter timeoutMs must be an integer from 100 to ${String(MAX_TIMEOUT_MS)}`)
  }
  return { coreRoot, pythonExecutable, timeoutMs }
}

/** Execute the reviewed compiler with JSON on stdin; no shell and no project-state file. */
async function runCompilerProcess(
  snapshot: ImagoElementMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(snapshot, execution, signal, ELEMENT_COMPILER_RELATIVE_PATH)
}

async function runReferenceAssetCompilerProcess(
  snapshot: ImagoReferenceAssetMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(snapshot, execution, signal, REFERENCE_ASSET_COMPILER_RELATIVE_PATH)
}

async function runReferenceRightsCompilerProcess(
  snapshot: ImagoElementMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(snapshot, execution, signal, REFERENCE_RIGHTS_COMPILER_RELATIVE_PATH)
}

async function runReferenceRightsExceptionReleaseCompilerProcess(
  snapshot: ImagoElementMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(
    snapshot,
    execution,
    signal,
    REFERENCE_RIGHTS_EXCEPTION_RELEASE_COMPILER_RELATIVE_PATH,
  )
}

async function runPromptIrCompilerProcess(
  snapshot: ImagoPromptIrMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(snapshot, execution, signal, PROMPT_IR_COMPILER_RELATIVE_PATH)
}

async function runShotRelationCompilerProcess(
  snapshot: ImagoShotRelationMethodSnapshot,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
): Promise<unknown> {
  return await runCompilerSubprocess(snapshot, execution, signal, SHOT_RELATION_COMPILER_RELATIVE_PATH)
}

async function runCompilerSubprocess(
  snapshot: ImagoMethodJsonObject,
  execution: ImagoMethodCompilerExecution,
  signal: AbortSignal,
  compilerRelativePath: string,
): Promise<unknown> {
  if (signal.aborted) throw new CompilerCancelledError()
  return await new Promise((resolve, reject) => {
    const child = spawn(
      execution.pythonExecutable,
      [join(execution.coreRoot, compilerRelativePath), '-'],
      { cwd: execution.coreRoot, stdio: ['pipe', 'pipe', 'pipe'], env: compilerEnvironment() },
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let exceeded = false
    let settled = false

    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = (): void => {
      child.kill('SIGKILL')
      fail(new CompilerCancelledError())
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, execution.timeoutMs)
    signal.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        exceeded = true
        child.kill('SIGKILL')
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        exceeded = true
        child.kill('SIGKILL')
        return
      }
      stderr.push(chunk)
    })
    child.once('error', () => { fail(new CompilerExecutionError()) })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      if (signal.aborted) {
        reject(new CompilerCancelledError())
        return
      }
      if (timedOut || exceeded || code !== 0) {
        reject(new CompilerExecutionError())
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as unknown)
      } catch {
        reject(new CompilerExecutionError())
      }
    })
    child.stdin.once('error', () => {})
    child.stdin.end(canonicalJson(snapshot, 'snapshot'), 'utf8')
  })
}

function compilerEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  Reflect.deleteProperty(environment, 'QINGMU_IMAGO_ATTESTATION_KEY')
  return environment
}

/**
 * Create the generic Connection handler without registering it.
 * @param config - absolute Core root and bounded local compiler settings.
 * @param dependencies - injectable compiler runner for isolated verification.
 * @returns a handler for private element, reference-asset, PromptIR, and Shot relation method endpoints.
 */
export function createImagoMethodHandler(
  config: ImagoMethodAdapterConfig,
  dependencies: ImagoMethodAdapterDependencies = {
    runCompiler: runCompilerProcess,
    runReferenceAssetCompiler: runReferenceAssetCompilerProcess,
    runReferenceRightsCompiler: runReferenceRightsCompilerProcess,
    runReferenceRightsExceptionReleaseCompiler: runReferenceRightsExceptionReleaseCompilerProcess,
    runPromptIrCompiler: runPromptIrCompilerProcess,
    runShotRelationCompiler: runShotRelationCompilerProcess,
  },
): ConnectionRpcHandler {
  const execution = resolveExecution(config)
  return async (endpoint, payload, signal) => {
    try {
      if (
        endpoint !== 'elementMethod'
        && endpoint !== 'referenceAssetMethod'
        && endpoint !== 'promptIrMethod'
        && endpoint !== 'shotRelationMethod'
      ) {
        throw new InputError(`unknown IMAGO method endpoint: ${endpoint}`)
      }
      const attestationKey = readAttestationKey()
      if (endpoint === 'shotRelationMethod') {
        const request = parseShotRelationRequest(payload)
        const snapshot = buildShotRelationSnapshot(request)
        if (signal.aborted) return cancelled()
        if (dependencies.runShotRelationCompiler === undefined) throw new CompilerExecutionError()
        const rawProjection = await dependencies.runShotRelationCompiler(snapshot, execution, signal)
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while awaited.
        if (signal.aborted) return cancelled()
        const projection = normalizeShotRelationProjection(rawProjection, snapshot)
        const methodAttestation = createShotRelationMethodAttestation(attestationKey, projection, snapshot)
        const value: ImagoShotRelationMethodResponse = {
          schema: 'qingmu.imago-shot-relation-method-adapter-result.v1',
          projectionSha256: methodAttestation.projectionSha256,
          projection,
          methodAttestation,
        }
        return { ok: true, value }
      }
      if (endpoint === 'promptIrMethod') {
        const request = parsePromptIrRequest(payload)
        const snapshot = buildPromptIrSnapshot(request)
        if (signal.aborted) return cancelled()
        if (dependencies.runPromptIrCompiler === undefined) throw new CompilerExecutionError()
        const rawProjection = await dependencies.runPromptIrCompiler(snapshot, execution, signal)
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the compiler is awaited.
        if (signal.aborted) return cancelled()
        const projection = normalizePromptIrProjection(rawProjection, snapshot)
        const methodAttestation = createPromptIrMethodAttestation(attestationKey, projection, snapshot)
        const value: ImagoPromptIrMethodResponse = {
          schema: 'qingmu.imago-prompt-ir-method-adapter-result.v1',
          projectionSha256: methodAttestation.projectionSha256,
          projection,
          methodAttestation,
        }
        return { ok: true, value }
      }
      if (endpoint === 'referenceAssetMethod') {
        const request = parseReferenceAssetRequest(payload)
        if (
          request.operation === 'replaceReferenceRights'
          || request.operation === 'recordReferenceRightsExceptionRelease'
        ) {
          const snapshot = buildReferenceRightsSnapshot(request)
          if (signal.aborted) return cancelled()
          const runRightsCompiler = request.operation === 'recordReferenceRightsExceptionRelease'
            ? dependencies.runReferenceRightsExceptionReleaseCompiler
            : dependencies.runReferenceRightsCompiler
          if (runRightsCompiler === undefined) throw new CompilerExecutionError()
          const rawProjection = await runRightsCompiler(snapshot, execution, signal)
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while awaited.
          if (signal.aborted) return cancelled()
          const projection = normalizeReferenceRightsProjection(rawProjection, snapshot, request.operation)
          const methodAttestation = createMethodAttestation(attestationKey, projection, snapshot)
          const value: ImagoElementMethodResponse = {
            schema: 'qingmu.imago-element-method-adapter-result.v1',
            projectionSha256: methodAttestation.projectionSha256,
            projection,
            methodAttestation,
          }
          return { ok: true, value }
        }
        if (!('assetId' in request) || !('assetSha256' in request)) {
          throw new InputError('reference-asset action lineage is missing')
        }
        const snapshot = buildReferenceAssetSnapshot(request)
        if (signal.aborted) return cancelled()
        if (dependencies.runReferenceAssetCompiler === undefined) throw new CompilerExecutionError()
        const rawProjection = await dependencies.runReferenceAssetCompiler(snapshot, execution, signal)
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the compiler is awaited.
        if (signal.aborted) return cancelled()
        const projection = normalizeReferenceAssetProjection(rawProjection, snapshot)
        const methodAttestation = createReferenceAssetMethodAttestation(attestationKey, projection, snapshot)
        const value: ImagoReferenceAssetActionMethodResponse = {
          schema: 'qingmu.imago-reference-asset-method-adapter-result.v1',
          projectionSha256: methodAttestation.projectionSha256,
          projection,
          methodAttestation,
        }
        return { ok: true, value }
      }
      const request = parseRequest(payload)
      const snapshot = buildSnapshot(request)
      if (signal.aborted) return cancelled()
      const rawProjection = await dependencies.runCompiler(snapshot, execution, signal)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the compiler is awaited.
      if (signal.aborted) return cancelled()
      const projection = normalizeProjection(rawProjection, snapshot)
      const methodAttestation = createMethodAttestation(attestationKey, projection, snapshot)
      const value: ImagoElementMethodResponse = {
        schema: 'qingmu.imago-element-method-adapter-result.v1',
        projectionSha256: methodAttestation.projectionSha256,
        projection,
        methodAttestation,
      }
      return { ok: true, value }
    } catch (error) {
      if (error instanceof InputError) return badRequest(error.message)
      if (error instanceof AttestationKeyError) return internalError('IMAGO method attestation is unavailable')
      if (signal.aborted || error instanceof CompilerCancelledError) return cancelled()
      if (error instanceof ProjectionContractError) {
        return internalError(`IMAGO method projection contract failed: ${error.message}`)
      }
      return internalError('IMAGO method compiler failed')
    }
  }
}

/** Register the stateless method adapter on a loopback-only Host channel. */
export function apply(ctx: Context, config: ImagoMethodAdapterConfig): void {
  ctx.connection.rpc.handle(CHANNEL, createImagoMethodHandler(config), { authority: 'loopback' })
}
