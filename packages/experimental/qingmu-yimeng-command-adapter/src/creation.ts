/** Narrow empty-project and canonical text-import transport; never schedules work. */
import { createHash } from 'node:crypto'
import type { YimengCommandJsonObject } from './types.ts'

/** One durable user-scoped creation intent. */
export interface ProjectInitializationRequest {
  readonly name: string
  readonly style: string
  readonly aspectRatio: '9:16' | '16:9' | '1:1'
  readonly mode: 'whole_series'
  readonly creationType: 'story_idea' | 'novel_adapt' | 'script_adapt' | 'original_script'
  readonly episodeCount: number
  readonly duration: string
  readonly textInput: string
  /** Writer-owned source format; one value is currently advertised by creation-options. */
  readonly textVersion: 'creation-text-v1'
  /** A current Writer style-pack identity, selected explicitly by the user. */
  readonly stylePackId: string
  /** Current Writer director-method identities, selected from creation-options. */
  readonly directorSkillIds: readonly string[]
  readonly idempotencyKey: string
}

/** One Writer-advertised source text version. */
export interface CreationTextVersion {
  readonly id: 'creation-text-v1'
  readonly label: string
  readonly available: boolean
}
/** One Writer-advertised director method; unavailable methods remain descriptive only. */
export interface CreationDirectorSkill {
  readonly id: string
  readonly version: string
  readonly sha256: string
  readonly stage: string
  readonly available: boolean
  readonly disabledReason: string | null
}
/** A style-pack projection suitable for a creation picker; it is not a copied pack body. */
export interface CreationVisualStyle {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly groupLabel: string
}
/** One Writer-provided style-pack projection. */
export interface CreationStylePack {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly group: string
  readonly groupLabel: string
  readonly intent: string
  readonly tone: string
}
/** Read-only creation picker data joined from Writer's two authoritative catalogs. */
export interface CreationOptions {
  readonly schema: 'jason.qingmu-creation-options.v1'
  readonly textVersions: readonly CreationTextVersion[]
  readonly directorSkills: readonly CreationDirectorSkill[]
  readonly visualStyles: readonly CreationVisualStyle[]
  readonly stylePacks: readonly CreationStylePack[]
}
/** Immutable method coordinate stored inside one project creative contract. */
export interface CreativeContractMethodRef {
  readonly id: string
  readonly version: string
  readonly sha256: string
}
/** Project-level creation contract. It locks sources and methods, not approval. */
export interface CreativeContract {
  readonly schema: 'qingmu.creative-contract.v1' | 'qingmu.creative-contract.v2'
  readonly revision: 1
  readonly locked: true
  readonly identity?: { readonly projectId: string }
  readonly source: { readonly textSha256: string; readonly textVersion?: 'creation-text-v1' }
  readonly project: {
    readonly mode: 'whole_series'
    readonly creationType: ProjectInitializationRequest['creationType']
    readonly aspectRatio: ProjectInitializationRequest['aspectRatio']
    readonly episodeCount: number
    readonly duration: string
  }
  readonly methods: {
    readonly visualStyle: CreativeContractMethodRef
    readonly stylePackId: CreativeContractMethodRef | null
    readonly writingSkills: readonly CreativeContractMethodRef[]
    readonly directorSkills: readonly CreativeContractMethodRef[]
    readonly cameraSkills: readonly CreativeContractMethodRef[]
    readonly soundSkills: readonly CreativeContractMethodRef[]
  }
}
/** Authenticated readback of the immutable project contract. */
export interface CreativeContractState {
  readonly schema: 'jason.qingmu-creative-contract-state.v1'
  readonly projectId: string
  readonly configured: boolean
  readonly locked: boolean
  readonly revision: 1 | null
  readonly sha256: string | null
  readonly contract: CreativeContract | null
  readonly sourceText: string | null
  readonly message: string
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
  readonly creativeContract: CreativeContract
  readonly creativeContractSha256: string
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
/** Catalog prose may deliberately be empty; still reject padded/control-bearing values. */
function catalogText(value: unknown, error: ErrorFactory, max = 4000): string {
  if (typeof value !== 'string' || value.length > max || value !== value.trim() || /[\x00-\x1f]/.test(value)) {
    throw error('creation catalog text invalid')
  }
  return value
}
function storyText(value: unknown, error: ErrorFactory): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64000 || value !== value.trim()
    || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw error('creation story text invalid')
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
function methodRef(value: unknown, error: ErrorFactory): CreativeContractMethodRef {
  const raw = exact(value, ['id', 'version', 'sha256'], error)
  return { id: text(raw.id, error), version: text(raw.version, error), sha256: sha(raw.sha256, error) }
}
function stringList(value: unknown, error: ErrorFactory, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) throw error('creation list invalid')
  return value.map(item => text(item, error, 800))
}
/** Validate Writer's three catalogs before exposing only the creation-picker projection. */
export function prepareCreationOptionsRead(value: unknown, helpers: Helpers): {
  normalize: (options: unknown, stylePacks: unknown, styles: unknown) => CreationOptions
} {
  exact(value, [], helpers.inputError)
  const bad = helpers.responseError
  return { normalize: (optionsValue, stylePacksValue, stylesValue) => {
    const options = exact(optionsValue, ['schema', 'textVersions', 'directorSkills'], bad)
    if (options.schema !== 'jason.qingmu-creation-options.v1' || !Array.isArray(options.textVersions)
      || !Array.isArray(options.directorSkills)) throw bad('creation options invalid')
    const textVersions = options.textVersions.map((item) => {
      const entry = exact(item, ['id', 'label', 'available'], bad)
      if (entry.id !== 'creation-text-v1' || typeof entry.available !== 'boolean') throw bad('creation text version invalid')
      return { id: 'creation-text-v1' as const, label: text(entry.label, bad), available: entry.available }
    })
    if (textVersions.length !== 1 || !textVersions[0]?.available) throw bad('creation text version unavailable')
    const directorIds = new Set<string>()
    const directorSkills = options.directorSkills.map((item) => {
      const entry = exact(item, ['id', 'version', 'sha256', 'stage', 'available', 'disabledReason'], bad)
      const id = identifier(entry.id, bad)
      if (directorIds.has(id) || typeof entry.available !== 'boolean'
        || (entry.disabledReason !== null && typeof entry.disabledReason !== 'string')) throw bad('creation director skill invalid')
      directorIds.add(id)
      return { id, version: text(entry.version, bad), sha256: sha(entry.sha256, bad), stage: text(entry.stage, bad),
        available: entry.available, disabledReason: entry.disabledReason === null ? null : catalogText(entry.disabledReason, bad, 1000) }
    })
    if (directorSkills.length > 64) throw bad('creation director skills invalid')
    const styles = exact(stylesValue, ['items', 'total'], bad)
    const visualTotal = styles.total
    if (!Array.isArray(styles.items) || typeof visualTotal !== 'number' || !Number.isSafeInteger(visualTotal) || visualTotal < 0) throw bad('visual style catalog invalid')
    const visualIds = new Set<string>(); const visualStyles: CreationVisualStyle[] = []
    for (const item of styles.items) {
      const style = object(item, bad)
      const group = object(style.group, bad)
      const id = identifier(style.key, bad)
      if (visualIds.has(id)) throw bad('visual style identity invalid')
      // Writer's style entries retain additional, non-picker presentation fields. Validate
      // the projected identity only so a catalog thumbnail field cannot break creation.
      visualIds.add(id)
      visualStyles.push({ id, label: text(style.labelZh, bad), group: identifier(group.key, bad), groupLabel: text(group.labelZh, bad) })
    }
    if (visualStyles.length !== visualTotal || visualStyles.length === 0) throw bad('visual style catalog count invalid')
    const packs = exact(stylePacksValue, ['schemaVersion', 'groups', 'total'], bad)
    const stylePackTotal = packs.total
    if (typeof packs.schemaVersion !== 'string' || packs.schemaVersion.trim() === '' || !Array.isArray(packs.groups)
      || typeof stylePackTotal !== 'number' || !Number.isSafeInteger(stylePackTotal) || stylePackTotal < 0) throw bad('style pack catalog invalid')
    const styleIds = new Set<string>(); const stylePacks: CreationStylePack[] = []
    for (const groupValue of packs.groups) {
      const group = exact(groupValue, ['key', 'label', 'items'], bad)
      const groupKey = text(group.key, bad); const groupLabel = text(group.label, bad)
      if (!Array.isArray(group.items)) throw bad('style pack group invalid')
      for (const item of group.items) {
        const pack = exact(item, ['id', 'version', 'name', 'group', 'groupLabel', 'intent', 'tone', 'palette', 'contrast',
          'lightingSources', 'lensFamily', 'compositionRules', 'performanceRegister', 'editingRhythm', 'positiveFragments',
          'negativeConstraints', 'verticalDelivery'], bad)
        const id = identifier(pack.id, bad)
        if (styleIds.has(id) || pack.group !== groupKey || pack.groupLabel !== groupLabel) throw bad('style pack identity invalid')
        stringList(pack.palette, bad, 32); catalogText(pack.contrast, bad); stringList(pack.lightingSources, bad, 32)
        catalogText(pack.lensFamily, bad); stringList(pack.compositionRules, bad, 32); catalogText(pack.performanceRegister, bad)
        catalogText(pack.editingRhythm, bad); stringList(pack.positiveFragments, bad, 128); stringList(pack.negativeConstraints, bad, 128)
        object(pack.verticalDelivery, bad)
        styleIds.add(id)
        stylePacks.push({ id, version: text(pack.version, bad), name: text(pack.name, bad), group: groupKey, groupLabel,
          intent: catalogText(pack.intent, bad), tone: catalogText(pack.tone, bad) })
      }
    }
    if (stylePacks.length !== stylePackTotal || stylePacks.length === 0) throw bad('style pack catalog count invalid')
    return { schema: 'jason.qingmu-creation-options.v1' as const, textVersions, directorSkills, visualStyles, stylePacks }
  } }
}
/**
 * Validate and normalize one complete Writer-owned creative contract.
 *
 * @param value Candidate contract from the canonical project projection.
 * @param error Static adapter error factory used for fail-closed validation.
 * @param expectedProjectId Required project binding for the current v2 contract.
 * @returns A detached, strictly validated v1 or v2 contract.
 */
export function normalizeCreativeContract(
  value: unknown,
  error: ErrorFactory,
  expectedProjectId?: string,
): CreativeContract {
  const candidate = object(value, error)
  const current = candidate.schema === 'qingmu.creative-contract.v2'
  const raw = exact(value, current
    ? ['schema', 'revision', 'locked', 'identity', 'source', 'project', 'methods']
    : ['schema', 'revision', 'locked', 'source', 'project', 'methods'], error)
  if (!['qingmu.creative-contract.v1', 'qingmu.creative-contract.v2'].includes(String(raw.schema))
    || raw.revision !== 1 || raw.locked !== true) {
    throw error('creative contract identity invalid')
  }
  if (current) {
    const identity = exact(raw.identity, ['projectId'], error)
    const projectId = identifier(identity.projectId, error)
    if (expectedProjectId === undefined || projectId !== expectedProjectId) {
      throw error('creative contract project binding invalid')
    }
  }
  const source = exact(raw.source, current ? ['textSha256', 'textVersion'] : ['textSha256'], error)
  sha(source.textSha256, error)
  if (current && source.textVersion !== 'creation-text-v1') throw error('creative contract text version invalid')
  const project = exact(raw.project, ['mode', 'creationType', 'aspectRatio', 'episodeCount', 'duration'], error)
  if (project.mode !== 'whole_series'
    || !['story_idea', 'novel_adapt', 'script_adapt', 'original_script'].includes(String(project.creationType))
    || !['9:16', '16:9', '1:1'].includes(String(project.aspectRatio))) throw error('creative contract project invalid')
  integer(project.episodeCount, error, 1); text(project.duration, error, 32)
  const methods = exact(raw.methods, ['visualStyle', 'stylePackId', 'writingSkills', 'directorSkills', 'cameraSkills', 'soundSkills'], error)
  methodRef(methods.visualStyle, error)
  if (methods.stylePackId !== null) methodRef(methods.stylePackId, error)
  for (const field of ['writingSkills', 'directorSkills', 'cameraSkills', 'soundSkills'] as const) {
    if (!Array.isArray(methods[field]) || methods[field].length > 64) throw error('creative contract methods invalid')
    for (const entry of methods[field]) methodRef(entry, error)
  }
  if (current && (methods.stylePackId === null || !Array.isArray(methods.directorSkills)
    || methods.directorSkills.length === 0)) throw error('creative contract current methods invalid')
  return raw as unknown as CreativeContract
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
  if (endpoint === 'readCreativeContract') {
    const coordinate = exact(raw, ['projectId'], fail)
    const projectId = identifier(coordinate.projectId, fail)
    path = `/api/qingmu/projects/${encodeURIComponent(projectId)}/creative-contract`
    method = 'GET'
    normalize = (value) => {
      const result = exact(value, ['schema', 'projectId', 'configured', 'locked', 'revision', 'sha256', 'contract', 'sourceText', 'message'], bad)
      if (result.schema !== 'jason.qingmu-creative-contract-state.v1' || result.projectId !== projectId
        || typeof result.configured !== 'boolean' || typeof result.locked !== 'boolean') throw bad('creative contract state mismatch')
      text(result.message, bad, 1000)
      if (!result.configured) {
        if (result.locked || result.revision !== null || result.sha256 !== null || result.contract !== null
          || result.sourceText !== null) throw bad('creative contract absent state invalid')
      } else {
        if (!result.locked || result.revision !== 1) throw bad('creative contract lock invalid')
        const contract = normalizeCreativeContract(result.contract, bad, projectId)
        const contractSha = createHash('sha256').update(helpers.canonicalJson(contract, 'creative contract')).digest('hex')
        if (sha(result.sha256, bad) !== contractSha) throw bad('creative contract SHA invalid')
        const sourceText = storyText(result.sourceText, bad)
        if (createHash('sha256').update(sourceText).digest('hex') !== contract.source.textSha256) {
          throw bad('creative contract source invalid')
        }
      }
      return result
    }
  } else if (endpoint === 'initializeProject' || endpoint === 'recoverProjectInitialization') {
    const recover = endpoint === 'recoverProjectInitialization'
    exact(raw, recover ? ['idempotencyKey', 'requestSha256'] : [
      'name', 'style', 'aspectRatio', 'mode', 'creationType', 'episodeCount', 'duration', 'textInput', 'textVersion', 'stylePackId', 'directorSkillIds', 'idempotencyKey',
    ], fail)
    const intent = key(raw.idempotencyKey, fail)
    let requestSha: string
    let initialization: { readonly directorSkillIds: readonly string[] } | undefined
    path = '/api/qingmu/project-initializations'
    if (recover) {
      requestSha = sha(raw.requestSha256, fail)
      path += `/receipt?${new URLSearchParams({ idempotencyKey: intent, requestSha256: requestSha }).toString()}`
      method = 'GET'
    } else {
      if (!Array.isArray(raw.directorSkillIds)) throw fail('director methods invalid')
      const directorSkillIds = raw.directorSkillIds.map(item => identifier(item, fail))
      const settings = {
        name: text(raw.name, fail, 100), style: text(raw.style, fail, 128), aspectRatio: text(raw.aspectRatio, fail),
        mode: raw.mode, creationType: raw.creationType, episodeCount: integer(raw.episodeCount, fail, 1),
        duration: text(raw.duration, fail, 32), textInput: storyText(raw.textInput, fail),
        textVersion: raw.textVersion, stylePackId: text(raw.stylePackId, fail, 128),
        directorSkillIds,
      }
      if (settings.textVersion !== 'creation-text-v1' || settings.directorSkillIds.length < 1 || settings.directorSkillIds.length > 4
        || new Set(settings.directorSkillIds).size !== settings.directorSkillIds.length) throw fail('creation methods invalid')
      if (!['9:16', '16:9', '1:1'].includes(settings.aspectRatio)) throw fail('aspect ratio invalid')
      if (settings.mode !== 'whole_series'
        || !['story_idea', 'novel_adapt', 'script_adapt', 'original_script'].includes(String(settings.creationType))
        || settings.episodeCount > 30) throw fail('creative settings invalid')
      initialization = settings
      requestSha = createHash('sha256').update(helpers.canonicalJson(settings, 'initialization')).digest('hex')
      body = { ...settings, idempotencyKey: intent }
    }
    normalize = (value) => {
      const result = object(value, bad)
      if (result.schema !== 'jason.qingmu-project-bootstrap-result.v1' || result.idempotencyKey !== intent || result.requestSha256 !== requestSha
        || result.providerCalls !== 0 || result.stageStarted !== false || result.approvalGranted !== false) throw bad('initialization receipt mismatch')
      for (const field of ['projectId', 'seriesId', 'episodeId', 'owner', 'commandReceiptId', 'eventId']) identifier(result[field], bad)
      if (!recover) {
        const contract = normalizeCreativeContract(result.creativeContract, bad, identifier(result.projectId, bad))
        if (contract.source.textSha256 !== createHash('sha256').update(String(raw.textInput)).digest('hex')
          || contract.project.mode !== raw.mode || contract.project.creationType !== raw.creationType
          || contract.project.aspectRatio !== raw.aspectRatio || contract.project.episodeCount !== raw.episodeCount
          || contract.project.duration !== raw.duration || contract.source.textVersion !== raw.textVersion
          || contract.methods.stylePackId?.id !== raw.stylePackId
          || contract.methods.directorSkills.map(item => item.id).join('\u0000') !== initialization?.directorSkillIds.join('\u0000')
          || sha(result.creativeContractSha256, bad) !== createHash('sha256').update(helpers.canonicalJson(contract, 'creative contract')).digest('hex')) {
          throw bad('initialization creative contract mismatch')
        }
      } else {
        const contract = normalizeCreativeContract(result.creativeContract, bad, identifier(result.projectId, bad))
        const contractSha = createHash('sha256').update(helpers.canonicalJson(contract, 'creative contract')).digest('hex')
        if (sha(result.creativeContractSha256, bad) !== contractSha) throw bad('initialization creative contract SHA invalid')
      }
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
