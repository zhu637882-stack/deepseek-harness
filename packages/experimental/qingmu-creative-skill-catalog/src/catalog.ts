import { directorAssetEntry } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/director-assets/registry'

import { creativeSkillSha256 } from './canonical.ts'
import { CreativeSkillCatalogError } from './error.ts'
import { YIMENG_STYLE_PACK_LEDGER } from './trusted-source.ts'
import {
  CREATIVE_SKILL_CATEGORIES,
  CREATIVE_SKILL_SCOPES,
  type CreativeSkillCard,
  type CreativeSkillCatalog,
} from './types.ts'

const shaPattern = /^[0-9a-f]{64}$/u
const idPattern = /^qingmu\.creative\.[a-z0-9][a-z0-9._-]*$/u
const semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u
const categoryValues = new Set<string>(CREATIVE_SKILL_CATEGORIES)
const scopeValues = new Set<string>(CREATIVE_SKILL_SCOPES)
const cardKeys = [
  'category', 'conflictsWith', 'contentSha256', 'defaultOff', 'id', 'inputs', 'license',
  'methodSha256', 'nameZh', 'outputs', 'provenance', 'requires', 'scopes', 'source',
  'summaryZh', 'version', 'zeroProvider',
] as const

const TRUSTED_IMAGO_SKILL_SOURCES = new Set([
  'director-skill-core\0assets/beat-sheet-template.md',
  'director-skill-core\0assets/director-book-template.md',
  'director-skill-core\0assets/shot-plan-template.md',
  'ai-visual-director\0engines/reference-anchor.md',
  'ai-visual-director\0templates/sound-design-sheet.md',
  'director-skill-core\0assets/qc-checklist.md',
])

function fail(code: ConstructorParameters<typeof CreativeSkillCatalogError>[0]): never {
  throw new CreativeSkillCatalogError(code)
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function validStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(validText) && new Set(value).size === value.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function validateSource(sourceValue: unknown, provenanceValue: unknown, licenseValue: unknown): void {
  if (!isRecord(sourceValue) || !isRecord(provenanceValue) || !isRecord(licenseValue)) {
    fail('creative_skill_source_invalid')
  }
  if (sourceValue.kind === 'imago-director-asset') {
    if (!hasExactKeys(sourceValue, ['authority', 'kind', 'path', 'repoId', 'repository'])
      || !hasExactKeys(provenanceValue, ['commit', 'kind', 'provenanceSha256'])
      || !hasExactKeys(licenseValue, ['id', 'usageBoundary'])
      || sourceValue.authority !== 'qingmu-imago-method-adapter'
      || provenanceValue.kind !== 'git-ledger'
      || !validText(sourceValue.repoId) || !validText(sourceValue.path)
      || !TRUSTED_IMAGO_SKILL_SOURCES.has(`${sourceValue.repoId}\0${sourceValue.path}`)) {
      fail('creative_skill_source_unknown')
    }
    let entry: ReturnType<typeof directorAssetEntry>
    try {
      entry = directorAssetEntry(sourceValue.repoId)
    } catch {
      fail('creative_skill_source_unknown')
    }
    if (sourceValue.repository !== entry.repoUrl
      || provenanceValue.commit !== entry.commit
      || provenanceValue.provenanceSha256 !== entry.provenanceSha256) {
      fail('creative_skill_sha_drift')
    }
    if (licenseValue.id !== entry.license
      || licenseValue.usageBoundary !== 'attribution-retained-read-only-method-reference') {
      fail('creative_skill_license_not_allowed')
    }
    return
  }
  if (sourceValue.kind === 'yimeng-style-pack') {
    if (!hasExactKeys(sourceValue, ['authority', 'kind', 'packId', 'sourceVersion'])
      || !hasExactKeys(provenanceValue, ['kind', 'snapshotSha256', 'sourceContentSha256'])
      || !hasExactKeys(licenseValue, ['id', 'usageBoundary'])
      || sourceValue.authority !== 'yimeng.style-pack-library'
      || provenanceValue.kind !== 'canonical-snapshot'
      || sourceValue.sourceVersion !== YIMENG_STYLE_PACK_LEDGER.sourceVersion
      || !validText(sourceValue.packId)
      || !/^sp_[a-z0-9][a-z0-9_-]*$/u.test(sourceValue.packId)) {
      fail('creative_skill_source_unknown')
    }
    if (licenseValue.id !== YIMENG_STYLE_PACK_LEDGER.license
      || licenseValue.usageBoundary !== YIMENG_STYLE_PACK_LEDGER.usageBoundary) {
      fail('creative_skill_license_not_allowed')
    }
    if (provenanceValue.snapshotSha256 !== YIMENG_STYLE_PACK_LEDGER.canonicalSnapshotSha256
      || provenanceValue.sourceContentSha256 !== YIMENG_STYLE_PACK_LEDGER.sourceContentSha256) {
      fail('creative_skill_sha_drift')
    }
    return
  }
  fail('creative_skill_source_unknown')
}

function validateCard(value: unknown): asserts value is CreativeSkillCard {
  if (!isRecord(value) || !hasExactKeys(value, cardKeys)
    || !validText(value.id) || !idPattern.test(value.id)
    || !validText(value.nameZh) || !validText(value.summaryZh)
    || !validText(value.category) || !categoryValues.has(value.category)
    || !validText(value.version) || !semverPattern.test(value.version)
    || !validText(value.contentSha256) || !shaPattern.test(value.contentSha256)
    || !validText(value.methodSha256) || !shaPattern.test(value.methodSha256)
    || !validStringList(value.inputs) || !validStringList(value.outputs)
    || !validStringList(value.conflictsWith) || !validStringList(value.requires)
    || !value.conflictsWith.every(id => idPattern.test(id))
    || !value.requires.every(id => idPattern.test(id))
    || value.defaultOff !== true || value.zeroProvider !== true) {
    fail('creative_skill_card_invalid')
  }
  if (!Array.isArray(value.scopes) || value.scopes.length === 0
    || new Set(value.scopes).size !== value.scopes.length
    || !value.scopes.every(scope => typeof scope === 'string' && scopeValues.has(scope))) {
    fail('creative_skill_scope_invalid')
  }
  validateSource(value.source, value.provenance, value.license)
  const card = value as unknown as CreativeSkillCard
  const { methodSha256, ...method } = card
  if (creativeSkillSha256(method) !== methodSha256) fail('creative_skill_sha_drift')
}

/**
 * Validate, sort, and hash already projected cards without activating them.
 * @param cards - untrusted projected card values.
 * @returns a complete deterministic catalog.
 */
export function finalizeCreativeSkillCatalog(
  cards: readonly unknown[],
  trustedContentShaById: ReadonlyMap<string, string>,
): CreativeSkillCatalog {
  const seen = new Set<string>()
  const validated: CreativeSkillCard[] = []
  for (const value of cards) {
    validateCard(value)
    const card = value
    if (seen.has(card.id)) fail('creative_skill_duplicate_id')
    if (trustedContentShaById.get(card.id) !== card.contentSha256) fail('creative_skill_sha_drift')
    seen.add(card.id)
    validated.push(card)
  }
  for (const card of validated) {
    const relations = [...card.requires, ...card.conflictsWith]
    if (relations.some(id => id === card.id || !seen.has(id))
      || card.requires.some(id => card.conflictsWith.includes(id))) {
      fail('creative_skill_card_invalid')
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(validated.map(card => [card.id, card]))
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('creative_skill_card_invalid')
    if (visited.has(id)) return
    visiting.add(id)
    for (const requirement of byId.get(id)?.requires ?? []) visit(requirement)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of seen) visit(id)
  for (const category of CREATIVE_SKILL_CATEGORIES) {
    if (!validated.some(card => card.category === category)) fail('creative_skill_catalog_category_missing')
  }
  const categoryRank = new Map(CREATIVE_SKILL_CATEGORIES.map((category, index) => [category, index]))
  const sorted = structuredClone(validated).sort((left, right) => {
    const categoryDelta = (categoryRank.get(left.category) ?? -1) - (categoryRank.get(right.category) ?? -1)
    if (categoryDelta !== 0) return categoryDelta
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
  const unsigned = {
    schema: 'qingmu.creative-skill-catalog.v1' as const,
    version: '1.0.0' as const,
    activation: 'default-off-explicit-selection-only' as const,
    providerCalls: 0 as const,
    cards: sorted,
  }
  return deepFreeze({ ...unsigned, catalogSha256: creativeSkillSha256(unsigned) })
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
