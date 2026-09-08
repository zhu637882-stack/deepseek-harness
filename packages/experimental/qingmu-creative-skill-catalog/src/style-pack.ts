import { creativeSkillSha256 } from './canonical.ts'
import { CreativeSkillCatalogError } from './error.ts'
import { YIMENG_STYLE_PACK_LEDGER } from './trusted-source.ts'
import type { CreativeSkillCard, YimengStylePackProjectionSource } from './types.ts'

type UnsignedCreativeSkillCard = Omit<CreativeSkillCard, 'methodSha256'>

const responseKeys = ['groups', 'schemaVersion', 'total'] as const
const groupKeys = ['items', 'key', 'label'] as const
const itemKeys = [
  'compositionRules', 'contrast', 'editingRhythm', 'group', 'groupLabel', 'id', 'intent',
  'lensFamily', 'lightingSources', 'name', 'negativeConstraints', 'palette',
  'performanceRegister', 'positiveFragments', 'tone', 'version', 'verticalDelivery',
] as const
const groupOrder = ['real_person', '2d', '3d'] as const
const groupLabels = ['真人写实', '2D风格', '3D风格'] as const
const verticalDeliveryKeys = ['aspect_ratio', 'face_safe_area', 'subtitle_safe_area'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }
  return value
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  const result = value.map(requiredString)
  if (new Set(result).size !== result.length) throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  return result
}

function parseStylePackResponse(source: YimengStylePackProjectionSource): readonly Record<string, unknown>[] {
  if (!(source.bytes instanceof Uint8Array)) {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes))
  } catch {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }
  if (creativeSkillSha256(parsed) !== YIMENG_STYLE_PACK_LEDGER.canonicalSnapshotSha256) {
    throw new CreativeSkillCatalogError('creative_skill_sha_drift')
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, responseKeys)
    || parsed.schemaVersion !== 'style-pack-v1' || !Array.isArray(parsed.groups)
    || !Number.isSafeInteger(parsed.total) || (parsed.total as number) < 0) {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }
  if (parsed.groups.length !== groupOrder.length) {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }

  const packs: Record<string, unknown>[] = []
  for (const [groupIndex, rawGroup] of parsed.groups.entries()) {
    if (!isRecord(rawGroup) || !hasExactKeys(rawGroup, groupKeys)
      || rawGroup.key !== groupOrder[groupIndex]
      || rawGroup.label !== groupLabels[groupIndex]) {
      throw new CreativeSkillCatalogError('creative_skill_source_invalid')
    }
    const label = requiredString(rawGroup.label)
    if (!Array.isArray(rawGroup.items)) throw new CreativeSkillCatalogError('creative_skill_source_invalid')
    for (const rawItem of rawGroup.items) {
      if (!isRecord(rawItem) || !hasExactKeys(rawItem, itemKeys)
        || rawItem.group !== rawGroup.key || rawItem.groupLabel !== label) {
        throw new CreativeSkillCatalogError('creative_skill_source_invalid')
      }
      const id = requiredString(rawItem.id)
      if (!/^sp_[a-z0-9][a-z0-9_-]*$/u.test(id)) {
        throw new CreativeSkillCatalogError('creative_skill_source_invalid')
      }
      if (rawItem.version !== '1') throw new CreativeSkillCatalogError('creative_skill_source_invalid')
      for (const key of [
        'name', 'intent', 'tone', 'contrast', 'lensFamily',
        'performanceRegister', 'editingRhythm',
      ] as const) requiredString(rawItem[key])
      for (const key of [
        'palette', 'lightingSources', 'compositionRules', 'positiveFragments', 'negativeConstraints',
      ] as const) stringArray(rawItem[key])
      if (!isRecord(rawItem.verticalDelivery)
        || !hasExactKeys(rawItem.verticalDelivery, verticalDeliveryKeys)
        || rawItem.verticalDelivery.aspect_ratio !== '9:16'
        || !requiredString(rawItem.verticalDelivery.face_safe_area)
        || !requiredString(rawItem.verticalDelivery.subtitle_safe_area)) {
        throw new CreativeSkillCatalogError('creative_skill_source_invalid')
      }
      packs.push(rawItem)
    }
  }
  if (packs.length !== parsed.total) throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  const ids = packs.map(pack => pack.id as string)
  if (new Set(ids).size !== ids.length) throw new CreativeSkillCatalogError('creative_skill_duplicate_id')
  return packs
}

/**
 * Project authenticated Yimeng style-pack response bytes into inert visual cards.
 * @param source - exact response bytes; identity, revision, SHA, and license come from the package ledger.
 * @returns unsigned visual cards for catalog-level binding.
 */
export function projectYimengStylePackCards(
  source: YimengStylePackProjectionSource,
): readonly UnsignedCreativeSkillCard[] {
  const packs = parseStylePackResponse(source)
  return packs.map(pack => ({
    id: `qingmu.creative.visual.${pack.id as string}`,
    nameZh: pack.name as string,
    summaryZh: pack.intent as string,
    category: 'visual',
    version: '1.0.0',
    contentSha256: creativeSkillSha256(pack),
    source: {
      kind: 'yimeng-style-pack',
      authority: 'yimeng.style-pack-library',
      sourceVersion: YIMENG_STYLE_PACK_LEDGER.sourceVersion,
      packId: pack.id as string,
    },
    provenance: {
      kind: 'canonical-snapshot',
      snapshotSha256: YIMENG_STYLE_PACK_LEDGER.canonicalSnapshotSha256,
      sourceContentSha256: YIMENG_STYLE_PACK_LEDGER.sourceContentSha256,
    },
    license: {
      id: 'LicenseRef-Qingmu-Yimeng-Internal',
      usageBoundary: 'read-only-catalog-projection',
    },
    scopes: ['project', 'episode'],
    inputs: ['creative_intent', 'delivery_format'],
    outputs: ['style_pack_selection'],
    conflictsWith: [],
    requires: [],
    defaultOff: true,
    zeroProvider: true,
  }))
}
