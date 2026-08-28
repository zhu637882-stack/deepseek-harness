/** Narrow empty-project and canonical text-import transport; never schedules work. */
import { createHash } from 'node:crypto'
import type { YimengCommandJsonObject } from './types.ts'

/** One durable user-scoped creation intent. */
export interface ProjectInitializationRequest {
  readonly name: string
  readonly style: string
  readonly aspectRatio: '9:16' | '16:9' | '1:1'
  readonly idempotencyKey: string
}
/** Recovery addresses an existing request, not a guessed project name. */
export interface ProjectInitializationRecovery { readonly idempotencyKey: string; readonly requestSha256: string }
/** Persisted identities and immutable receipt of an empty project initialization. */
export interface ProjectInitializationResult {
  readonly schema: 'jason.qingmu-project-bootstrap-result.v1'
  readonly projectId: string
  readonly seriesId: string
  readonly episodeId: string
  readonly owner: string
  readonly requestSha256: string
  readonly idempotencyKey: string
  readonly commandReceiptId: string
  readonly eventId: string
  readonly createdAt: string
  readonly providerCalls: 0
  readonly stageStarted: false
  readonly approvalGranted: false
}
/** Exact canonical project and episode coordinates. */
export interface CreationScope { readonly projectId: string; readonly episodeId: string }
/** Read-only recovery can select a specific import intent or draft. */
export interface TextImportReadRequest extends CreationScope { readonly intentKey?: string; readonly draftId?: string }
/** UTF-8 TXT bytes, not a filename or client supplied source digest alone. */
export interface TextImportRequest extends CreationScope {
  readonly filename: string
  readonly contentBase64: string
  readonly inputSha256: string
  readonly idempotencyKey: string
  readonly expectedScriptRevision: number
}
/** Canonical parsed line; corrections remain in TextImportService. */
export interface TextImportLine {
  readonly id: string
  readonly original: string
  readonly text: string
  readonly lineType: 'scene' | 'action' | 'dialogue' | 'narration' | 'transition' | 'skip'
  readonly speaker: string | null
  readonly episodeIndex: number
}
/** Existing backend draft, with a fingerprint that is opaque to the browser. */
export interface TextImportDraft extends CreationScope {
  readonly schemaVersion: 'text-import-draft-v1'
  readonly id: string
  readonly status: 'draft' | 'stale' | 'confirmed'
  readonly fingerprint: string
  readonly revision: number
  readonly baseScriptRevision: number
  readonly input: { readonly filename: string; readonly sha256: string; readonly textSha256: string }
  readonly lines: readonly TextImportLine[]
  readonly confirmation: { readonly sourceDraftFingerprint: string; readonly scriptRevision: number } | null
}
/** Readback of the canonical script and optionally an existing draft; never writes. */
export interface TextImportState extends CreationScope {
  readonly schema: 'jason.qingmu-text-import-state.v1'
  readonly scriptRevision: number
  readonly script: YimengCommandJsonObject | null
  readonly draft: TextImportDraft | null
  readonly draftActive: boolean
}
/** Minimal human parse correction with compare-and-swap fingerprint. */
export interface TextImportCorrection extends CreationScope {
  readonly draftId: string
  readonly expectedFingerprint: string
  readonly type: 'setSpeaker' | 'reclassify'
  readonly lineId: string
  readonly value: string
}
/** Explicit confirmation of parsed text only, not production or media approval. */
export interface TextImportConfirmationRequest extends CreationScope {
  readonly draftId: string
  readonly expectedFingerprint: string
  readonly expectedScriptRevision: number
  readonly episodeIndex: number
}
/** Original canonical confirmation facts. */
export interface TextImportConfirmation {
  readonly schemaVersion: 'text-import-confirmation-v1'
  readonly draft: TextImportDraft
  readonly script: YimengCommandJsonObject
  readonly scriptRevision: number
  readonly providerCalls: 0
}

interface Helpers {
  readonly inputError: (message: string) => Error
  readonly responseError: (message: string) => Error
  readonly canonicalJson: (value: unknown, field: string) => string
}
type ErrorFactory = Helpers['inputError']
const fields = ['projectId', 'episodeId']
const lineTypes = ['scene', 'action', 'dialogue', 'narration', 'transition', 'skip']
function object(value: unknown, error: ErrorFactory): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw error('creation object required')
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: readonly string[], error: ErrorFactory): Record<string, unknown> {
  const raw = object(value, error)
  if (Object.keys(raw).sort().join() !== [...keys].sort().join()) throw error('creation fields invalid')
  return raw
}
function text(value: unknown, error: ErrorFactory, max = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value !== value.trim() || /[\x00-\x1f]/.test(value)) throw error('creation text invalid')
  return value
}
function identifier(value: unknown, error: ErrorFactory): string {
  const result = text(value, error)
  if (!/^[A-Za-z0-9_.-]+$/.test(result)) throw error('creation coordinate invalid')
  return result
}
function integer(value: unknown, error: ErrorFactory, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw error('creation revision invalid')
  return value
}
function sha(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw error('creation SHA invalid')
  return value
}
function key(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw error('creation intent invalid')
  return value
}
function scope(raw: Record<string, unknown>, error: ErrorFactory): CreationScope {
  return { projectId: identifier(raw.projectId, error), episodeId: identifier(raw.episodeId, error) }
}
function draft(value: unknown, expected: CreationScope, error: ErrorFactory): TextImportDraft {
  const raw = object(value, error)
  if (raw.schemaVersion !== 'text-import-draft-v1' || raw.projectId !== expected.projectId || raw.episodeId !== expected.episodeId
    || !['draft', 'stale', 'confirmed'].includes(String(raw.status))) throw error('text import draft lineage invalid')
  identifier(raw.id, error); sha(raw.fingerprint, error); integer(raw.revision, error, 1); integer(raw.baseScriptRevision, error)
  const input = object(raw.input, error)
  text(input.filename, error); sha(input.sha256, error); sha(input.textSha256, error)
  if (!Array.isArray(raw.lines) || raw.lines.length > 1000) throw error('text import lines invalid')
  for (const item of raw.lines) {
    const line = object(item, error)
    identifier(line.id, error); integer(line.episodeIndex, error, 1)
    if (!lineTypes.includes(String(line.lineType)) || typeof line.text !== 'string' || typeof line.original !== 'string'
      || (line.speaker !== null && typeof line.speaker !== 'string')) throw error('text import line invalid')
  }
  if (raw.confirmation !== null) {
    const confirmation = object(raw.confirmation, error)
    sha(confirmation.sourceDraftFingerprint, error); integer(confirmation.scriptRevision, error, 1)
  }
  return raw as unknown as TextImportDraft
}

/**
 * Parse an allowlisted operation; reject malformed requests and response bindings.
 * @param endpoint - One of the six creation/import operation names.
 * @param value - Untrusted browser request.
 * @param helpers - Adapter error factories and canonical JSON encoder.
 * @returns One bounded request and its source-bound response validator; performs no I/O.
 */
export function prepareCreationCommand(endpoint: string, value: unknown, helpers: Helpers): {
  path: string
  method: 'GET' | 'POST'
  body: YimengCommandJsonObject | undefined
  normalize: (value: unknown) => unknown
} {
  const fail = helpers.inputError
  const bad = helpers.responseError
  const raw = object(value, fail)
  let path: string
  let method: 'GET' | 'POST' = 'POST'
  let body: YimengCommandJsonObject | undefined
  let normalize: (value: unknown) => unknown
  if (endpoint === 'initializeProject' || endpoint === 'recoverProjectInitialization') {
    const recover = endpoint === 'recoverProjectInitialization'
    exact(raw, recover ? ['idempotencyKey', 'requestSha256'] : ['name', 'style', 'aspectRatio', 'idempotencyKey'], fail)
    const intent = key(raw.idempotencyKey, fail)
    let requestSha: string
    path = '/api/qingmu/project-initializations'
    if (recover) {
      requestSha = sha(raw.requestSha256, fail)
      path += `/receipt?${new URLSearchParams({ idempotencyKey: intent, requestSha256: requestSha }).toString()}`
      method = 'GET'
    } else {
      const settings = { name: text(raw.name, fail, 100), style: text(raw.style, fail, 128), aspectRatio: text(raw.aspectRatio, fail) }
      if (!['9:16', '16:9', '1:1'].includes(settings.aspectRatio)) throw fail('aspect ratio invalid')
      requestSha = createHash('sha256').update(helpers.canonicalJson(settings, 'initialization')).digest('hex')
      body = { ...settings, idempotencyKey: intent }
    }
    normalize = (value) => {
      const result = object(value, bad)
      if (result.schema !== 'jason.qingmu-project-bootstrap-result.v1' || result.idempotencyKey !== intent || result.requestSha256 !== requestSha
        || result.providerCalls !== 0 || result.stageStarted !== false || result.approvalGranted !== false) throw bad('initialization receipt mismatch')
      for (const field of ['projectId', 'seriesId', 'episodeId', 'owner', 'commandReceiptId', 'eventId']) identifier(result[field], bad)
      return result
    }
  } else {
    const coordinate = scope(raw, fail)
    path = `/api/qingmu/projects/${encodeURIComponent(coordinate.projectId)}/episodes/${encodeURIComponent(coordinate.episodeId)}/text-import`
    if (endpoint === 'readTextImport') {
      if (raw.intentKey !== undefined && raw.draftId !== undefined) throw fail('choose one recovery coordinate')
      exact(raw, [...fields, ...(raw.intentKey === undefined ? [] : ['intentKey']), ...(raw.draftId === undefined ? [] : ['draftId'])], fail)
      const query = new URLSearchParams()
      if (raw.intentKey !== undefined) query.set('intentKey', key(raw.intentKey, fail))
      if (raw.draftId !== undefined) query.set('draftId', identifier(raw.draftId, fail))
      if (query.size > 0) path += `?${query.toString()}`
      method = 'GET'
      normalize = (value) => {
        const result = object(value, bad)
        if (result.schema !== 'jason.qingmu-text-import-state.v1' || result.projectId !== coordinate.projectId || result.episodeId !== coordinate.episodeId) throw bad('text import scope mismatch')
        integer(result.scriptRevision, bad)
        if (typeof result.draftActive !== 'boolean' || (result.draft === null && result.draftActive)) throw bad('text import active state invalid')
        if (result.draft !== null) {
          const parsed = draft(result.draft, coordinate, bad)
          if (raw.draftId !== undefined && parsed.id !== raw.draftId) throw bad('text import recovery mismatch')
          if (raw.intentKey !== undefined && object(object(result.draft, bad).creationIntent, bad).key !== raw.intentKey) throw bad('text import intent mismatch')
        }
        if (result.script !== null) object(result.script, bad)
        return result
      }
    } else if (endpoint === 'createTextImport') {
      exact(raw, [...fields, 'filename', 'contentBase64', 'inputSha256', 'idempotencyKey', 'expectedScriptRevision'], fail)
      const filename = text(raw.filename, fail, 128)
      if (!/\.txt$/i.test(filename) || /[\\/]/.test(filename)) throw fail('UTF-8 TXT required')
      if (typeof raw.contentBase64 !== 'string' || raw.contentBase64.length > 174764 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.contentBase64)) throw fail('text import bytes invalid')
      const bytes = Buffer.from(raw.contentBase64, 'base64')
      if (bytes.length === 0 || bytes.length > 131072 || createHash('sha256').update(bytes).digest('hex') !== sha(raw.inputSha256, fail)) throw fail('text import input SHA mismatch')
      path += '/drafts'
      body = {
        filename, contentBase64: raw.contentBase64, inputSha256: raw.inputSha256,
        idempotencyKey: key(raw.idempotencyKey, fail), expectedScriptRevision: integer(raw.expectedScriptRevision, fail),
      }
      normalize = (value) => {
        const result = draft(value, coordinate, bad)
        if (result.input.sha256 !== raw.inputSha256 || result.baseScriptRevision !== raw.expectedScriptRevision
          || object(object(value, bad).creationIntent, bad).key !== raw.idempotencyKey) throw bad('text import source mismatch')
        return result
      }
    } else if (endpoint === 'correctTextImport' || endpoint === 'confirmTextImport') {
      const confirm = endpoint === 'confirmTextImport'
      exact(raw, [...fields, 'draftId', 'expectedFingerprint', ...(confirm ? ['expectedScriptRevision', 'episodeIndex'] : ['type', 'lineId', 'value'])], fail)
      path += `/drafts/${encodeURIComponent(identifier(raw.draftId, fail))}/${confirm ? 'confirm' : 'commands'}`
      body = { expectedFingerprint: sha(raw.expectedFingerprint, fail) }
      if (confirm) {
        body = {
          ...body, expectedScriptRevision: integer(raw.expectedScriptRevision, fail), episodeIndex: integer(raw.episodeIndex, fail, 1),
        }
      } else {
        if (!['setSpeaker', 'reclassify'].includes(String(raw.type)) || typeof raw.value !== 'string' || raw.value.length > 80) throw fail('text import correction invalid')
        body = { ...body, type: String(raw.type), lineId: identifier(raw.lineId, fail), value: raw.value }
      }
      normalize = (value) => {
        const result = object(value, bad)
        const parsed = draft(confirm ? result.draft : result, coordinate, bad)
        if (parsed.id !== raw.draftId) throw bad('text import draft mismatch')
        if (confirm) {
          const binding = object(object(result.script, bad).sourceBinding, bad)
          if (result.schemaVersion !== 'text-import-confirmation-v1' || result.providerCalls !== 0 || parsed.status !== 'confirmed'
            || binding.projectId !== coordinate.projectId || binding.episodeId !== coordinate.episodeId || binding.draftId !== raw.draftId
            || binding.draftFingerprint !== raw.expectedFingerprint || binding.inputSha256 !== parsed.input.sha256
            || binding.episodeIndex !== raw.episodeIndex || result.scriptRevision !== Number(raw.expectedScriptRevision) + 1) throw bad('text import confirmation mismatch')
        }
        return result
      }
    } else throw fail('unknown creation operation')
  }
  return { path, method, body, normalize }
}
