/** Bounded planning transport over existing canonical Yimeng objects. */
import { createHash } from 'node:crypto'
import type { CreationScope } from './creation.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** Planning uses Writer's RFC 8785 JSON, including fractional creative timings. */
function canonicalPlanningJson(value: unknown, fail: Fail): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw fail('planning number must be finite and lossless')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalPlanningJson(item, fail)).join(',')}]`
  const record = obj(value, fail)
  // RFC 8785 sorts UTF-16 code units, including supplementary character keys.
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalPlanningJson(record[key], fail)}`).join(',')}}`
}

/** Editable planning values, not prompts or approved content. */
export interface PlanningShot {
  readonly title: string
  readonly narrative: string
  readonly visual: string
  readonly action: string
  readonly durationSec: number
  readonly dialogueLineIds: readonly string[]
  /** Authored creative departments, preserved by initial scene planning. */
  readonly directorPlan?: YimengCommandJsonObject
}
/** Immutable script and structural storyboard compare-and-swap coordinates. */
export interface PlanningBase {
  readonly sceneIndex: number
  readonly expectedScriptRevision: number
  readonly expectedScriptSha256: string
  readonly expectedStoryboardRevision: number
  readonly expectedStoryboardSha256: string | null
}
/** Initialize only absent structure, or edit one current canonical frame. */
export type PlanningOperation = PlanningBase & (
  { readonly action: 'initialize'; readonly shots: readonly PlanningShot[] } |
  { readonly action: 'edit'
    readonly shotId: string
    readonly shot: PlanningShot
    /** Apply supplied creative fields, including deliberate restoration of original values. Omission preserves legacy comparison. */
    readonly applyDirectorPlan?: true }
)
/** One editable first-frame requirement owned by an existing automatic shot. */
export interface AutomaticPlanningShot {
  readonly id: string
  readonly frameNo: number
  readonly title: string
  readonly imagePromptCn: string
  readonly blocking?: string
  readonly cameraAngle?: string
  readonly cameraMovement?: string
  readonly coveragePlan?: string
  /** Complete authored creative design; no fixed skill-field allowlist. */
  readonly directorPlan?: YimengCommandJsonObject
  readonly narrative?: string
  readonly firstFrameCandidateCount?: number
}
/** This command edits one automatic frame requirement; it never carries imported scene fields. */
export interface AutomaticPlanningOperation {
  readonly action: 'edit_automatic'
  readonly expectedScriptRevision: number
  readonly expectedScriptSha256: string
  readonly expectedStoryboardRevision: number
  readonly expectedStoryboardSha256: string
  readonly shotId: string
  readonly imagePromptCn: string
  readonly blocking?: string
  readonly cameraAngle?: string
  readonly cameraMovement?: string
  readonly coveragePlan?: string
  /** Patch creative fields in the canonical plan; script and provenance retain their owners. */
  readonly directorPlan?: YimengCommandJsonObject
}
/** Requirements for a verified manually planned frame, independent of script planning edits. */
export interface PlannedFrameRequirementsOperation extends Omit<AutomaticPlanningOperation, 'action'> {
  readonly action: 'edit_requirements'
}
export type FrameRequirementsOperation = AutomaticPlanningOperation | PlannedFrameRequirementsOperation
export type AnyPlanningOperation = PlanningOperation | FrameRequirementsOperation
/** A durable owner-scoped intent; recovery uses exactly this request. */
export interface ScenePlanningRequest extends CreationScope {
  readonly idempotencyKey: string
  readonly request: AnyPlanningOperation
}
/** Structural Ready means an immutable planning snapshot, never content approval. */
export interface PlanningRevision { readonly id: string; readonly version: number; readonly sourceHash: string; readonly status: 'Ready' }
/** Read-only automatic storyboard that replaces the legacy scene-planning editor for this episode. */
export interface CanonicalStoryboard {
  readonly revision: number
  readonly sourceHash: string
  readonly shotCount: number
  readonly origin: 'automatic'
  /** Existing automatic frames; absence remains valid for older read projections. */
  readonly shots?: readonly AutomaticPlanningShot[]
}
/** Original imported scene coordinates; sceneIndex is not a global entity ID. */
export interface PlanningSource {
  readonly scriptRevision: number
  readonly scriptSha256: string
  readonly inputSha256: string
  readonly sceneIndex: number
  readonly sourceLineIds: readonly string[]
}
/** Canonical imported text without generated suggestions. */
export interface PlanningScene {
  readonly sceneIndex: number
  readonly title: string
  readonly actionDescription: string
  readonly importSourceLineIds: readonly string[]
  readonly dialogues: readonly { readonly character: string; readonly line: string; readonly sourceLineId: string }[]
}
/** Automatic script scene shown only with a verified canonical storyboard, never submitted through legacy planning. */
export interface AutomaticPlanningScene {
  readonly sceneIndex: number
  readonly title: string
  readonly actionDescription: string
  readonly dialogues: readonly { readonly character: string; readonly line: string; readonly lineId: string }[]
}
/** One canonical or manually imported scene accepted by the planning workspace. */
export type ScenePlanningScene = PlanningScene | AutomaticPlanningScene
/** Existing rows projected for planning; no shadow database. */
export interface ScenePlanningState extends CreationScope {
  readonly schema: 'jason.qingmu-scene-planning-state.v1'
  readonly scriptRevision: number
  readonly scriptSha256: string | null
  readonly scenes: readonly ScenePlanningScene[]
  readonly storyboard: PlanningRevision | null
  /** Present only when the canonical automatic shot plan, rather than legacy planning rows, is authoritative. */
  readonly canonicalStoryboard?: CanonicalStoryboard | null
  /** Saved shooting requirements for either verified storyboard origin. Empty prompts remain unready. */
  readonly frameRequirements?: readonly AutomaticPlanningShot[]
  readonly planning: {
    readonly sceneId: string
    readonly sceneIndex: number
    readonly source: PlanningSource
    readonly actorIds: Readonly<Record<string, string>>
    readonly initialReceiptId: string
    readonly shots: readonly (PlanningShot & { readonly id: string })[]
  } | null
  /** Independently saved scenes share the episode's current storyboard revision. */
  readonly scenePlans?: readonly NonNullable<ScenePlanningState['planning']>[]
}
/** Persisted IDs and the original receipt, without generation or approval. */
interface ScenePlanningResultBase extends CreationScope {
  readonly schema: 'jason.qingmu-scene-planning-result.v1'
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
}
/** Receipt for imported planning; its original fields remain unchanged. */
export interface ImportedScenePlanningResult extends ScenePlanningResultBase {
  readonly action: 'initialize' | 'edit'
  readonly sceneId: string
  readonly seriesId: string
  readonly shotIds: readonly string[]
  readonly actorIds: Readonly<Record<string, string>>
  readonly source: PlanningSource
  readonly storyboard: PlanningRevision
}
/** Receipt for one automatic-frame edit; it deliberately contains no imported planning fields. */
export interface AutomaticScenePlanningResult extends ScenePlanningResultBase {
  readonly action: 'edit_automatic'
  readonly shotId: string
  readonly storyboard: PlanningRevision
}
export interface PlannedFrameRequirementsResult extends Omit<AutomaticScenePlanningResult, 'action'> {
  readonly action: 'edit_requirements'
}
export type ScenePlanningResult = ImportedScenePlanningResult | AutomaticScenePlanningResult | PlannedFrameRequirementsResult
interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
}
type Fail = Helpers['inputError']
function obj(value: unknown, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('planning object required')
  return value as Record<string, unknown>
}
function str(value: unknown, fail: Fail, max = 160): string {
  if (typeof value !== 'string' || !value || value.length > max) throw fail('planning text invalid')
  return value
}
function id(value: unknown, fail: Fail): string {
  const result = str(value, fail)
  if (!/^[A-Za-z0-9_.-]+$/.test(result)) throw fail('planning identity invalid')
  return result
}
function digest(value: unknown, fail: Fail): string {
  const result = str(value, fail)
  if (!/^[a-f0-9]{64}$/.test(result)) throw fail('planning SHA invalid')
  return result
}
function integer(value: unknown, fail: Fail, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw fail('planning revision invalid')
  return value
}
function ids(value: unknown, fail: Fail): void {
  if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length) throw fail('planning IDs invalid')
  for (const v of value) id(v, fail)
}
function shot(value: unknown, fail: Fail): void {
  const s = obj(value, fail)
  str(s.title, fail, 120)
  for (const k of ['narrative', 'visual', 'action']) if (typeof s[k] !== 'string' || s[k].length > 2000) throw fail('planning shot text invalid')
  if (typeof s.durationSec !== 'number' || !Number.isFinite(s.durationSec) || s.durationSec < 0.5 || s.durationSec > 30) throw fail('planning duration invalid')
  ids(s.dialogueLineIds, fail)
  if (s.directorPlan !== undefined) {
    const plan = obj(s.directorPlan, fail)
    if (Object.keys(plan).some(key => key.startsWith('_') || ['scenePlanning', 'sourceBinding', 'creativePlanSchema', 'clearedShootingFields', 'runtimeRepairDirectives', 'promptRepairHistory'].includes(key))) throw fail('director metadata is not editable')
    if (Buffer.byteLength(JSON.stringify(plan)) > 65536) throw fail('director plan too large')
  }
}
function revision(value: unknown, fail: Fail): void {
  const r = obj(value, fail)
  id(r.id, fail); integer(r.version, fail, 1); digest(r.sourceHash, fail)
  if (r.status !== 'Ready') throw fail('planning structural revision untrusted')
}
function frameRequirements(value: unknown, fail: Fail): void {
  if (!Array.isArray(value) || value.length > 1000) throw fail('frame requirements invalid')
  const shotIds = new Set<string>()
  for (const item of value) {
    const frame = obj(item, fail); const shotId = id(frame.id, fail)
    if (shotIds.has(shotId)) throw fail('canonical storyboard shot identity invalid')
    shotIds.add(shotId); integer(frame.frameNo, fail, 1); str(frame.title, fail, 64000)
    if (typeof frame.imagePromptCn !== 'string' || frame.imagePromptCn.length > 20000) throw fail('canonical storyboard image prompt invalid')
    if (frame.firstFrameCandidateCount !== undefined) integer(frame.firstFrameCandidateCount, fail)
    if (frame.directorPlan !== undefined) obj(frame.directorPlan, fail)
    for (const field of ['blocking', 'cameraAngle', 'cameraMovement', 'coveragePlan', 'narrative']) {
      if (frame[field] !== undefined && (typeof frame[field] !== 'string' || frame[field].length > 20000)) throw fail('canonical shooting field invalid')
    }
  }
}
function canonicalStoryboard(value: unknown, fail: Fail): void {
  const storyboard = obj(value, fail)
  integer(storyboard.revision, fail, 1); digest(storyboard.sourceHash, fail)
  integer(storyboard.shotCount, fail, 1)
  if (storyboard.origin !== 'automatic') throw fail('canonical storyboard origin invalid')
  if (storyboard.shots !== undefined) {
    if (!Array.isArray(storyboard.shots) || storyboard.shots.length !== storyboard.shotCount) throw fail('canonical storyboard shots invalid')
    frameRequirements(storyboard.shots, fail)
  }
}
function source(value: unknown, fail: Fail): void {
  const s = obj(value, fail)
  integer(s.scriptRevision, fail, 1); integer(s.sceneIndex, fail, 1)
  digest(s.scriptSha256, fail); digest(s.inputSha256, fail); ids(s.sourceLineIds, fail)
}
function scenePlan(value: unknown, fail: Fail): Record<string, unknown> {
  const p = obj(value, fail)
  id(p.sceneId, fail); integer(p.sceneIndex, fail, 1); source(p.source, fail); id(p.initialReceiptId, fail)
  if (obj(p.source, fail).sceneIndex !== p.sceneIndex) throw fail('planning scene source mismatch')
  if (!Array.isArray(p.shots) || !p.shots.length || p.shots.length > 64) throw fail('planning shots invalid')
  for (const s of p.shots) { id(obj(s, fail).id, fail); shot(s, fail) }
  ids(p.shots.map(s => obj(s, fail).id), fail)
  return p
}

/** Parse one allowlisted planning operation and validate its returned identities.
 * @param endpoint - Read, save or recover a planning intent.
 * @param value - Untrusted Host RPC payload.
 * @param helpers - Canonical JSON and adapter error factories.
 * @returns Bounded transport request and response parser; performs no I/O.
 */
export function prepareScenePlanning(endpoint: string, value: unknown, helpers: Helpers): {
  path: string
  method: 'GET' | 'POST'
  body: YimengCommandJsonObject | undefined
  normalize: (value: unknown) => unknown
} {
  const f = helpers.inputError, b = helpers.responseError
  const raw = obj(value, f), projectId = id(raw.projectId, f), episodeId = id(raw.episodeId, f)
  const read = endpoint === 'readScenePlanning', recover = endpoint === 'recoverScenePlanning'
  if (!read && !recover && endpoint !== 'saveScenePlanning') throw f('unknown planning operation')
  const allowed = read ? ['episodeId', 'projectId'] : ['episodeId', 'idempotencyKey', 'projectId', 'request']
  if (Object.keys(raw).sort().join() !== allowed.join()) throw f('planning fields invalid')
  let path = `/api/qingmu/projects/${projectId}/episodes/${episodeId}/scene-planning`
  let body: YimengCommandJsonObject | undefined, requestSha = ''
  if (!read) {
    const key = str(raw.idempotencyKey, f, 128)
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw f('planning intent invalid')
    const r = obj(raw.request, f)
    integer(r.expectedScriptRevision, f, 1); digest(r.expectedScriptSha256, f)
    integer(r.expectedStoryboardRevision, f)
    if ((r.action === 'edit_automatic' || r.action === 'edit_requirements')) {
      const required = ['action', 'expectedScriptRevision', 'expectedScriptSha256', 'expectedStoryboardRevision', 'expectedStoryboardSha256', 'imagePromptCn', 'shotId']
      if (required.some(key => !(key in r)) || Object.keys(r).some(key => ![...required, 'blocking', 'cameraAngle', 'cameraMovement', 'coveragePlan', 'directorPlan'].includes(key))) throw f('automatic planning fields invalid')
      if (r.directorPlan !== undefined) {
        const plan = obj(r.directorPlan, f)
        if (Object.keys(plan).some(key => key.startsWith('_') || ['scenePlanning', 'sourceBinding', 'creativePlanSchema', 'clearedShootingFields', 'runtimeRepairDirectives', 'promptRepairHistory'].includes(key))) throw f('director plan metadata is not editable')
        if (Buffer.byteLength(canonicalPlanningJson(plan, f)) > 65536) throw f('director plan too large')
      }
      for (const field of ['blocking', 'cameraAngle', 'cameraMovement', 'coveragePlan']) {
        if (r[field] !== undefined && (typeof r[field] !== 'string' || r[field].length > 2000)) throw f('automatic shooting field invalid')
      }
      if (typeof r.expectedStoryboardRevision !== 'number' || r.expectedStoryboardRevision < 1 || typeof r.expectedStoryboardSha256 !== 'string') throw f('automatic planning revision invalid')
      digest(r.expectedStoryboardSha256, f); id(r.shotId, f)
      if (r.directorPlan === undefined || r.imagePromptCn !== '') str(r.imagePromptCn, f, 20000)
    } else {
      integer(r.sceneIndex, f, 1)
      if (r.expectedStoryboardSha256 !== null || r.expectedStoryboardRevision !== 0) digest(r.expectedStoryboardSha256, f)
    }
    if (r.action === 'initialize') {
      if (!Array.isArray(r.shots) || r.shots.length < 1 || r.shots.length > 64) throw f('planning shot limit')
      for (const s of r.shots) shot(s, f)
    } else if (r.action === 'edit') {
      id(r.shotId, f); shot(r.shot, f)
      if (r.applyDirectorPlan !== undefined && (r.applyDirectorPlan !== true || obj(r.shot, f).directorPlan === undefined)) throw f('director plan application invalid')
    } else if (r.action !== 'edit_automatic' && r.action !== 'edit_requirements') throw f('planning action invalid')
    const encoded = canonicalPlanningJson(r, f)
    if (Buffer.byteLength(encoded) > 98304) throw f('planning payload too large')
    requestSha = createHash('sha256').update(encoded).digest('hex')
    if (recover) path += `/receipt?${new URLSearchParams({ idempotencyKey: key, requestSha256: requestSha }).toString()}`
    else { path += '/commands'; body = { idempotencyKey: key, request: JSON.parse(encoded) as YimengCommandJsonObject } }
  }
  return { path, method: read || recover ? 'GET' : 'POST', body, normalize: (value) => {
    const r = obj(value, b)
    if (r.projectId !== projectId || r.episodeId !== episodeId || r.providerCalls !== 0 || r.stageStarted !== false || r.approvalGranted !== false) throw b('planning scope or authority mismatch')
    if (read) {
      if (r.schema !== 'jason.qingmu-scene-planning-state.v1') throw b('planning state schema invalid')
      integer(r.scriptRevision, b)
      if (r.scriptSha256 !== null) digest(r.scriptSha256, b)
      const automatic = r.canonicalStoryboard !== undefined && r.canonicalStoryboard !== null
      if (!Array.isArray(r.scenes) || r.scenes.length > 1000) throw b('planning scenes invalid')
      for (const item of r.scenes) {
        const s = obj(item, b)
        integer(s.sceneIndex, b, automatic ? 0 : 1); str(s.title, b, 64000)
        if (!automatic) ids(s.importSourceLineIds, b)
        if (typeof s.actionDescription !== 'string' || !Array.isArray(s.dialogues)) throw b('planning scene text invalid')
        for (const d of s.dialogues) {
          const line = obj(d, b); id(automatic ? line.lineId : line.sourceLineId, b)
          str(line.character, b, 80); str(line.line, b, 64000)
        }
      }
      if (r.storyboard !== null) revision(r.storyboard, b)
      if (r.planning !== null) scenePlan(r.planning, b)
      let plans: Record<string, unknown>[] | undefined
      if (r.scenePlans !== undefined) {
        if (!Array.isArray(r.scenePlans) || r.scenePlans.length > 1000 || (automatic && r.scenePlans.length)) throw b('planning scenes invalid')
        plans = r.scenePlans.map(p => scenePlan(p, b))
        const indexes = plans.map(p => p.sceneIndex)
        const sceneIndexes = new Set(r.scenes.map(s => obj(s, b).sceneIndex))
        if (new Set(indexes).size !== indexes.length || indexes.some(index => !sceneIndexes.has(index))) throw b('planning scene identity mismatch')
        ids(plans.flatMap(p => (p.shots as unknown[]).map(s => obj(s, b).id)), b)
        const legacy = r.planning === null ? null : obj(r.planning, b)
        if (legacy === null ? plans.length > 0 : !plans.some(p => canonicalPlanningJson(p, b) === canonicalPlanningJson(legacy, b))) throw b('planning primary scene mismatch')
      }
      if (r.canonicalStoryboard !== undefined && r.canonicalStoryboard !== null) {
        canonicalStoryboard(r.canonicalStoryboard, b)
        const canonical = obj(r.canonicalStoryboard, b)
        const storyboard = r.storyboard === null ? null : obj(r.storyboard, b)
        if (storyboard === null
          || canonical.revision !== storyboard.version
          || canonical.sourceHash !== storyboard.sourceHash
          || r.planning !== null
          || r.scenes.length === 0) throw b('canonical storyboard state mismatch')
      }
      if (r.frameRequirements !== undefined) {
        if (!Array.isArray(r.frameRequirements)) throw b('frame requirements invalid')
        frameRequirements(r.frameRequirements, b)
        {
          if (r.frameRequirements.length > 0 && r.storyboard === null) throw b('frame requirements revision missing')
          const expected = automatic ? obj(r.canonicalStoryboard, b).shots
            : plans?.flatMap(p => p.shots) ?? (r.planning === null ? [] : obj(r.planning, b).shots)
          const requiredIds = new Set(r.frameRequirements.map(item => obj(item, b).id))
          if (!Array.isArray(expected) || expected.length !== r.frameRequirements.length
            || expected.some((item, index) => !automatic && plans ? !requiredIds.has(obj(item, b).id)
              : obj(item, b).id !== obj((r.frameRequirements as unknown[])[index], b).id)) {
            throw b('frame requirements scope mismatch')
          }
        }
      }
    } else {
      if (r.schema !== 'jason.qingmu-scene-planning-result.v1' || r.idempotencyKey !== raw.idempotencyKey || r.requestSha256 !== requestSha) throw b('planning receipt mismatch')
      for (const k of ['commandReceiptId', 'eventId']) id(r[k], b)
      const request = obj(raw.request, f)
      if (r.action !== request.action) throw b('planning receipt action mismatch')
      if ((request.action === 'edit_automatic' || request.action === 'edit_requirements')) {
        if (Object.keys(r).sort().join() !== ['action', 'approvalGranted', 'commandReceiptId', 'episodeId', 'eventId', 'idempotencyKey', 'projectId', 'providerCalls', 'requestSha256', 'schema', 'shotId', 'stageStarted', 'storyboard'].join()) throw b('automatic planning receipt fields invalid')
        if (r.shotId !== request.shotId) throw b('automatic planning receipt shot mismatch')
        id(r.shotId, b); revision(r.storyboard, b)
        const storyboard = obj(r.storyboard, b)
        if (typeof request.expectedStoryboardRevision !== 'number'
          || storyboard.version !== request.expectedStoryboardRevision + 1) throw b('automatic planning receipt revision mismatch')
      } else {
        for (const k of ['sceneId', 'seriesId']) id(r[k], b)
        ids(r.shotIds, b); source(r.source, b); revision(r.storyboard, b)
        const s = obj(r.source, b)
        if (s.sceneIndex !== request.sceneIndex || s.scriptRevision !== request.expectedScriptRevision || s.scriptSha256 !== request.expectedScriptSha256) throw b('planning receipt source mismatch')
      }
    }
    return r
  } }
}
