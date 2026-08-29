/** Bounded planning transport over existing canonical Yimeng objects. */
import { createHash } from 'node:crypto'
import type { CreationScope } from './creation.ts'
import type { YimengCommandJsonObject } from './types.ts'

/** Editable planning values, not prompts or approved content. */
export interface PlanningShot {
  readonly title: string
  readonly narrative: string
  readonly visual: string
  readonly action: string
  readonly durationSec: number
  readonly dialogueLineIds: readonly string[]
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
  { readonly action: 'edit'; readonly shotId: string; readonly shot: PlanningShot }
)
/** A durable owner-scoped intent; recovery uses exactly this request. */
export interface ScenePlanningRequest extends CreationScope {
  readonly idempotencyKey: string
  readonly request: PlanningOperation
}
/** Structural Ready means an immutable planning snapshot, never content approval. */
export interface PlanningRevision { readonly id: string; readonly version: number; readonly sourceHash: string; readonly status: 'Ready' }
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
/** Existing rows projected for planning; no shadow database. */
export interface ScenePlanningState extends CreationScope {
  readonly schema: 'jason.qingmu-scene-planning-state.v1'
  readonly scriptRevision: number
  readonly scriptSha256: string | null
  readonly scenes: readonly PlanningScene[]
  readonly storyboard: PlanningRevision | null
  readonly planning: {
    readonly sceneId: string
    readonly sceneIndex: number
    readonly source: PlanningSource
    readonly actorIds: Readonly<Record<string, string>>
    readonly initialReceiptId: string
    readonly shots: readonly (PlanningShot & { readonly id: string })[]
  } | null
}
/** Persisted IDs and the original receipt, without generation or approval. */
export interface ScenePlanningResult extends CreationScope {
  readonly schema: 'jason.qingmu-scene-planning-result.v1'
  readonly action: 'initialize' | 'edit'
  readonly sceneId: string
  readonly seriesId: string
  readonly shotIds: readonly string[]
  readonly actorIds: Readonly<Record<string, string>>
  readonly source: PlanningSource
  readonly storyboard: PlanningRevision
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
}
interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
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
}
function revision(value: unknown, fail: Fail): void {
  const r = obj(value, fail)
  id(r.id, fail); integer(r.version, fail, 1); digest(r.sourceHash, fail)
  if (r.status !== 'Ready') throw fail('planning structural revision untrusted')
}
function source(value: unknown, fail: Fail): void {
  const s = obj(value, fail)
  integer(s.scriptRevision, fail, 1); integer(s.sceneIndex, fail, 1)
  digest(s.scriptSha256, fail); digest(s.inputSha256, fail); ids(s.sourceLineIds, fail)
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
    integer(r.sceneIndex, f, 1); integer(r.expectedScriptRevision, f, 1); digest(r.expectedScriptSha256, f)
    integer(r.expectedStoryboardRevision, f)
    if (r.expectedStoryboardSha256 !== null || r.expectedStoryboardRevision !== 0) digest(r.expectedStoryboardSha256, f)
    if (r.action === 'initialize') {
      if (!Array.isArray(r.shots) || r.shots.length < 1 || r.shots.length > 8) throw f('planning shot limit')
      for (const s of r.shots) shot(s, f)
    } else if (r.action === 'edit') { id(r.shotId, f); shot(r.shot, f) } else throw f('planning action invalid')
    const encoded = helpers.canonicalJson(r, 'planning request')
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
      if (!Array.isArray(r.scenes) || r.scenes.length > 1000) throw b('planning scenes invalid')
      for (const item of r.scenes) {
        const s = obj(item, b)
        integer(s.sceneIndex, b, 1); str(s.title, b, 64000); ids(s.importSourceLineIds, b)
        if (typeof s.actionDescription !== 'string' || !Array.isArray(s.dialogues)) throw b('planning scene text invalid')
        for (const d of s.dialogues) {
          const line = obj(d, b); id(line.sourceLineId, b); str(line.character, b, 80); str(line.line, b, 64000)
        }
      }
      if (r.storyboard !== null) revision(r.storyboard, b)
      if (r.planning !== null) {
        const p = obj(r.planning, b)
        id(p.sceneId, b); integer(p.sceneIndex, b, 1); source(p.source, b); id(p.initialReceiptId, b)
        if (!Array.isArray(p.shots) || p.shots.length > 8) throw b('planning shots invalid')
        for (const s of p.shots) { id(obj(s, b).id, b); shot(s, b) }
      }
    } else {
      if (r.schema !== 'jason.qingmu-scene-planning-result.v1' || r.idempotencyKey !== raw.idempotencyKey || r.requestSha256 !== requestSha) throw b('planning receipt mismatch')
      for (const k of ['sceneId', 'seriesId', 'commandReceiptId', 'eventId']) id(r[k], b)
      ids(r.shotIds, b); source(r.source, b); revision(r.storyboard, b)
      const s = obj(r.source, b), request = obj(raw.request, f)
      if (r.action !== request.action || s.sceneIndex !== request.sceneIndex || s.scriptRevision !== request.expectedScriptRevision || s.scriptSha256 !== request.expectedScriptSha256) throw b('planning receipt source mismatch')
    }
    return r
  } }
}
