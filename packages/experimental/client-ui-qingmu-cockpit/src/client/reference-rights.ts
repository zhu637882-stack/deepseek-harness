import type { YimengReferenceRightsRecord } from './contracts.ts'

/**
 * Recorded knowledge states for one reference-rights answer.
 */
export type ReferenceRightsKnowledgeState = 'known' | 'unknown' | 'not_applicable'
/**
 * Recorded states for whether a reference contains the depicted element.
 */
export type ReferenceContainsState = 'yes' | 'no' | 'unknown'
/**
 * Recorded states for whether reference rights were declared.
 */
export type ReferenceDeclarationState = 'provided' | 'unknown' | 'not_applicable'

/**
 * Editable reference-rights values before canonical validation.
 */
export interface ReferenceRightsDraft {
  readonly sourceTypeState: ReferenceRightsKnowledgeState
  readonly sourceTypeValue: string
  readonly rightsHolderState: ReferenceRightsKnowledgeState
  readonly rightsHolderValue: string
  readonly authorizationScopeState: ReferenceRightsKnowledgeState
  readonly authorizationScopeValues: string
  readonly territoryState: ReferenceRightsKnowledgeState
  readonly territoryValues: string
  readonly termState: ReferenceRightsKnowledgeState
  readonly termStartsAt: string
  readonly termEndsAt: string
  readonly termPerpetual: boolean
  readonly restrictionsState: ReferenceRightsKnowledgeState
  readonly restrictionsValues: string
  readonly containsRealPersonLikeness: ReferenceContainsState
  readonly containsTrademark: ReferenceContainsState
  readonly containsMusic: ReferenceContainsState
  readonly containsFont: ReferenceContainsState
  readonly containsThirdPartyCharacter: ReferenceContainsState
  readonly providerTermsState: ReferenceRightsKnowledgeState
  readonly providerTermsValue: string
  readonly providerTermsReviewedAt: string
  readonly modelCodeState: ReferenceRightsKnowledgeState
  readonly modelCodeValue: string
  readonly modelWeightsState: ReferenceRightsKnowledgeState
  readonly modelWeightsValue: string
  readonly modelOutputUseState: ReferenceRightsKnowledgeState
  readonly modelOutputUseValue: string
  readonly humanDeclarationState: ReferenceDeclarationState
  readonly humanDeclarationText: string
  readonly contentCredentialsState: ReferenceRightsKnowledgeState
  readonly contentCredentialsValue: string
}

const KNOWLEDGE_STATES = new Set<ReferenceRightsKnowledgeState>(['known', 'unknown', 'not_applicable'])
const CONTAINS_STATES = new Set<ReferenceContainsState>(['yes', 'no', 'unknown'])
const RIGHTS_KEYS = [
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
] as const

function recordOf(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} 必须是结构化对象`)
  }
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${field} 字段不符合权利记录合同`)
  }
  return record
}

function textValue(value: unknown, field: string, required: boolean): string | null {
  if (value === null && !required) return null
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${field} 必须是有效文本`)
  const normalized = value.trim()
  if ((required && normalized.length === 0) || normalized.length > 4_000) {
    throw new Error(`${field} 长度必须在 ${required ? '1' : '0'} 到 4000 字符之间`)
  }
  return normalized.length === 0 ? null : normalized
}

function knowledgeState(value: unknown, field: string): ReferenceRightsKnowledgeState {
  if (!KNOWLEDGE_STATES.has(value as ReferenceRightsKnowledgeState)) {
    throw new Error(`${field} 必须明确为已知、未知或不适用`)
  }
  return value as ReferenceRightsKnowledgeState
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

function scalarValue(value: unknown, field: string): YimengReferenceRightsRecord['sourceType'] {
  const scalar = recordOf(value, ['state', 'value'], field)
  const state = knowledgeState(scalar.state, `${field}.state`)
  const normalized = textValue(scalar.value, `${field}.value`, state === 'known')
  if (state !== 'known' && normalized !== null) throw new Error(`${field}.value 仅可在已知状态填写`)
  return { state, value: normalized }
}

function listValue(
  value: unknown,
  field: string,
  allowEmptyKnown: boolean,
): YimengReferenceRightsRecord['authorizationScope'] {
  const listed = recordOf(value, ['state', 'values'], field)
  const state = knowledgeState(listed.state, `${field}.state`)
  if (!Array.isArray(listed.values)) throw new Error(`${field}.values 必须是列表`)
  const normalized = listed.values.map((item, index) => (
    textValue(item, `${field}.values[${String(index)}]`, true) as string
  ))
  const deduplicated = [...new Set(normalized)].sort(compareUnicodeCodePoints)
  if (normalized.length !== deduplicated.length || deduplicated.length > 50) {
    throw new Error(`${field}.values 最多 50 项且不得重复`)
  }
  if (state === 'known' && !allowEmptyKnown && deduplicated.length === 0) {
    throw new Error(`${field}.values 在已知状态不得为空`)
  }
  if (state !== 'known' && deduplicated.length > 0) throw new Error(`${field}.values 仅可在已知状态填写`)
  return { state, values: deduplicated }
}

function timestampValue(value: unknown, field: string, required: boolean): string | null {
  const normalized = textValue(value, field, required)
  if (normalized === null) return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(normalized)
  if (match === null || Number.isNaN(Date.parse(normalized))) throw new Error(`${field} 必须是 UTC Z 时间`)
  const parsed = new Date(normalized)
  if (parsed.toISOString().slice(0, 19) !== match[1]) throw new Error(`${field} 必须是有效 UTC Z 时间`)
  const fraction = match[2]?.padEnd(6, '0')
  return `${match[1]}${fraction !== undefined && Number(fraction) !== 0 ? `.${fraction}` : ''}Z`
}

/**
 * Strictly normalize one full rights record using the same browser boundary as the command contract.
 * @param value - Untrusted value to validate and normalize.
 * @param field - Field path used in validation errors.
 * @returns Validated YimengReferenceRightsRecord value.
 */
export function normalizeReferenceRightsRecord(value: unknown, field = 'rights'): YimengReferenceRightsRecord {
  const rights = recordOf(value, RIGHTS_KEYS, field)
  if (rights.schema !== 'jason.qingmu-reference-rights-record.v1') throw new Error(`${field}.schema 不匹配`)

  const term = recordOf(rights.term, ['state', 'startsAt', 'endsAt', 'perpetual'], `${field}.term`)
  const termState = knowledgeState(term.state, `${field}.term.state`)
  let normalizedTerm: YimengReferenceRightsRecord['term']
  if (termState !== 'known') {
    if (term.startsAt !== null || term.endsAt !== null || term.perpetual !== null) {
      throw new Error(`${field}.term 仅可在已知状态填写`)
    }
    normalizedTerm = { state: termState, startsAt: null, endsAt: null, perpetual: null }
  } else {
    if (typeof term.perpetual !== 'boolean') throw new Error(`${field}.term.perpetual 必须明确`)
    const startsAt = timestampValue(term.startsAt, `${field}.term.startsAt`, true)
    const endsAt = timestampValue(term.endsAt, `${field}.term.endsAt`, !term.perpetual)
    if (term.perpetual && endsAt !== null) throw new Error(`${field}.term.endsAt 在永久状态必须为空`)
    if (!term.perpetual && startsAt !== null && endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw new Error(`${field}.term.endsAt 不得早于 startsAt`)
    }
    normalizedTerm = { state: 'known', startsAt, endsAt, perpetual: term.perpetual }
  }

  const contains = recordOf(rights.contains, [
    'realPersonLikeness',
    'trademark',
    'music',
    'font',
    'thirdPartyCharacter',
  ], `${field}.contains`)
  for (const [key, value] of Object.entries(contains)) {
    if (!CONTAINS_STATES.has(value as ReferenceContainsState)) {
      throw new Error(`${field}.contains.${key} 必须是是、否或未知`)
    }
  }

  const providerTerms = recordOf(rights.providerTerms, ['state', 'terms', 'reviewedAt'], `${field}.providerTerms`)
  const providerState = knowledgeState(providerTerms.state, `${field}.providerTerms.state`)
  const terms = textValue(providerTerms.terms, `${field}.providerTerms.terms`, providerState === 'known')
  const reviewedAt = timestampValue(
    providerTerms.reviewedAt,
    `${field}.providerTerms.reviewedAt`,
    providerState === 'known',
  )
  if (providerState !== 'known' && (terms !== null || reviewedAt !== null)) {
    throw new Error(`${field}.providerTerms 仅可在已知状态填写`)
  }

  const modelLicenses = recordOf(rights.modelLicenses, ['code', 'weights', 'outputUse'], `${field}.modelLicenses`)
  const declaration = recordOf(rights.humanDeclaration, ['state', 'text'], `${field}.humanDeclaration`)
  if (declaration.state !== 'provided' && declaration.state !== 'unknown' && declaration.state !== 'not_applicable') {
    throw new Error(`${field}.humanDeclaration.state 不匹配`)
  }
  const declarationText = textValue(
    declaration.text,
    `${field}.humanDeclaration.text`,
    declaration.state === 'provided',
  )
  if (declaration.state !== 'provided' && declarationText !== null) {
    throw new Error(`${field}.humanDeclaration.text 仅可在已提供状态填写`)
  }

  return {
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: scalarValue(rights.sourceType, `${field}.sourceType`),
    rightsHolder: scalarValue(rights.rightsHolder, `${field}.rightsHolder`),
    authorizationScope: listValue(rights.authorizationScope, `${field}.authorizationScope`, false),
    territory: listValue(rights.territory, `${field}.territory`, false),
    term: normalizedTerm,
    restrictions: listValue(rights.restrictions, `${field}.restrictions`, true),
    contains: {
      realPersonLikeness: contains.realPersonLikeness as ReferenceContainsState,
      trademark: contains.trademark as ReferenceContainsState,
      music: contains.music as ReferenceContainsState,
      font: contains.font as ReferenceContainsState,
      thirdPartyCharacter: contains.thirdPartyCharacter as ReferenceContainsState,
    },
    providerTerms: { state: providerState, terms, reviewedAt },
    modelLicenses: {
      code: scalarValue(modelLicenses.code, `${field}.modelLicenses.code`),
      weights: scalarValue(modelLicenses.weights, `${field}.modelLicenses.weights`),
      outputUse: scalarValue(modelLicenses.outputUse, `${field}.modelLicenses.outputUse`),
    },
    humanDeclaration: {
      state: declaration.state,
      text: declarationText,
    } as YimengReferenceRightsRecord['humanDeclaration'],
    contentCredentials: scalarValue(rights.contentCredentials, `${field}.contentCredentials`),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(compareUnicodeCodePoints)
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error('权利记录包含不可规范化的值')
}

/**
 * Fail closed unless an authoritative read is already in exact canonical form.
 * @param value - Untrusted value to validate and normalize.
 * @param field - Field path used in validation errors.
 * @returns Validated YimengReferenceRightsRecord value.
 */
export function assertCanonicalReferenceRightsRecord(value: unknown, field = 'rights'): YimengReferenceRightsRecord {
  const normalized = normalizeReferenceRightsRecord(value, field)
  if (canonicalJson(value) !== canonicalJson(normalized)) throw new Error(`${field} 不是规范化权利记录`)
  return normalized
}

/**
 * Compare two already-normalizable rights records by their canonical JSON, independent of object key order.
 * @param left - First canonical record to compare.
 * @param right - Second canonical record to compare.
 * @returns Whether both canonical records are equal.
 */
export function referenceRightsRecordsEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(normalizeReferenceRightsRecord(left, 'leftRights'))
    === canonicalJson(normalizeReferenceRightsRecord(right, 'rightRights'))
}

function lines(value: string): readonly string[] {
  return value.split(/\r?\n/).map(item => item.trim()).filter(item => item !== '')
}

function draftScalar(state: ReferenceRightsKnowledgeState, value: string) {
  return { state, value: state === 'known' ? value : null }
}

function draftList(state: ReferenceRightsKnowledgeState, value: string) {
  return { state, values: state === 'known' ? lines(value) : [] }
}

/**
 * Convert the controlled form draft into the exact command rights record.
 * @param draft - Editable reference-rights values to normalize.
 * @returns Validated YimengReferenceRightsRecord value.
 */
export function normalizeReferenceRightsDraft(draft: ReferenceRightsDraft): YimengReferenceRightsRecord {
  return normalizeReferenceRightsRecord({
    schema: 'jason.qingmu-reference-rights-record.v1',
    sourceType: draftScalar(draft.sourceTypeState, draft.sourceTypeValue),
    rightsHolder: draftScalar(draft.rightsHolderState, draft.rightsHolderValue),
    authorizationScope: draftList(draft.authorizationScopeState, draft.authorizationScopeValues),
    territory: draftList(draft.territoryState, draft.territoryValues),
    term: draft.termState === 'known'
      ? {
        state: 'known',
        startsAt: draft.termStartsAt,
        endsAt: draft.termPerpetual ? null : draft.termEndsAt,
        perpetual: draft.termPerpetual,
      }
      : { state: draft.termState, startsAt: null, endsAt: null, perpetual: null },
    restrictions: draftList(draft.restrictionsState, draft.restrictionsValues),
    contains: {
      realPersonLikeness: draft.containsRealPersonLikeness,
      trademark: draft.containsTrademark,
      music: draft.containsMusic,
      font: draft.containsFont,
      thirdPartyCharacter: draft.containsThirdPartyCharacter,
    },
    providerTerms: draft.providerTermsState === 'known'
      ? { state: 'known', terms: draft.providerTermsValue, reviewedAt: draft.providerTermsReviewedAt }
      : { state: draft.providerTermsState, terms: null, reviewedAt: null },
    modelLicenses: {
      code: draftScalar(draft.modelCodeState, draft.modelCodeValue),
      weights: draftScalar(draft.modelWeightsState, draft.modelWeightsValue),
      outputUse: draftScalar(draft.modelOutputUseState, draft.modelOutputUseValue),
    },
    humanDeclaration: draft.humanDeclarationState === 'provided'
      ? { state: 'provided', text: draft.humanDeclarationText }
      : { state: draft.humanDeclarationState, text: null },
    contentCredentials: draftScalar(draft.contentCredentialsState, draft.contentCredentialsValue),
  })
}

/**
 * Initialize the structured editor from one authoritative rights record.
 * @param value - Untrusted value to validate and normalize.
 * @returns Resulting ReferenceRightsDraft value.
 */
export function createReferenceRightsDraft(value: unknown): ReferenceRightsDraft {
  const rights = assertCanonicalReferenceRightsRecord(value)
  return {
    sourceTypeState: rights.sourceType.state,
    sourceTypeValue: rights.sourceType.value ?? '',
    rightsHolderState: rights.rightsHolder.state,
    rightsHolderValue: rights.rightsHolder.value ?? '',
    authorizationScopeState: rights.authorizationScope.state,
    authorizationScopeValues: rights.authorizationScope.values.join('\n'),
    territoryState: rights.territory.state,
    territoryValues: rights.territory.values.join('\n'),
    termState: rights.term.state,
    termStartsAt: rights.term.startsAt ?? '',
    termEndsAt: rights.term.endsAt ?? '',
    termPerpetual: rights.term.perpetual ?? false,
    restrictionsState: rights.restrictions.state,
    restrictionsValues: rights.restrictions.values.join('\n'),
    containsRealPersonLikeness: rights.contains.realPersonLikeness,
    containsTrademark: rights.contains.trademark,
    containsMusic: rights.contains.music,
    containsFont: rights.contains.font,
    containsThirdPartyCharacter: rights.contains.thirdPartyCharacter,
    providerTermsState: rights.providerTerms.state,
    providerTermsValue: rights.providerTerms.terms ?? '',
    providerTermsReviewedAt: rights.providerTerms.reviewedAt ?? '',
    modelCodeState: rights.modelLicenses.code.state,
    modelCodeValue: rights.modelLicenses.code.value ?? '',
    modelWeightsState: rights.modelLicenses.weights.state,
    modelWeightsValue: rights.modelLicenses.weights.value ?? '',
    modelOutputUseState: rights.modelLicenses.outputUse.state,
    modelOutputUseValue: rights.modelLicenses.outputUse.value ?? '',
    humanDeclarationState: rights.humanDeclaration.state,
    humanDeclarationText: rights.humanDeclaration.text ?? '',
    contentCredentialsState: rights.contentCredentials.state,
    contentCredentialsValue: rights.contentCredentials.value ?? '',
  }
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto')
  if (
    typeof cryptoValue !== 'object'
    || cryptoValue === null
    || !('subtle' in cryptoValue)
    || typeof cryptoValue.subtle !== 'object'
    || cryptoValue.subtle === null
    || !('digest' in cryptoValue.subtle)
    || typeof cryptoValue.subtle.digest !== 'function'
  ) throw new Error('当前浏览器不支持权利记录 SHA-256 核验')
  return cryptoValue.subtle as SubtleCrypto
}

/**
 * Digest the exact canonical rights body without persisting its sensitive text in session storage.
 * @param value - Untrusted value to validate and normalize.
 * @returns SHA-256 digest of the canonical value.
 */
export async function digestReferenceRightsRecord(value: unknown): Promise<string> {
  const rights = assertCanonicalReferenceRightsRecord(value)
  const digest = await getSubtleCrypto().digest('SHA-256', new TextEncoder().encode(canonicalJson(rights)))
  return [...new Uint8Array(digest)].map(item => item.toString(16).padStart(2, '0')).join('')
}
