import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { directorAssetEntry } from '../../qingmu-imago-method-adapter/src/director-assets/registry.ts'
import { creativeSkillSha256 } from '../src/canonical.ts'
import { finalizeCreativeSkillCatalog } from '../src/catalog.ts'
import {
  buildCreativeSkillCatalog,
  type CreativeSkillCard,
  type YimengStylePackProjectionSource,
} from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const assetsRoot = join(here, '../../qingmu-imago-method-adapter/assets')
const temporaryRoots: string[] = []

function styleResponse(items?: readonly Record<string, unknown>[]): Record<string, unknown> {
  const pack = {
    id: 'sp_ink', version: '1', name: '水墨叙事', group: '2d', groupLabel: '2D风格',
    intent: '以水墨留白组织画面层次。', tone: '克制', palette: ['墨黑', '宣纸白'],
    contrast: '低对比', lightingSources: ['柔光'], lensFamily: '中焦',
    compositionRules: ['留白'], performanceRegister: '写意', editingRhythm: '舒缓',
    positiveFragments: ['水墨层次'], negativeConstraints: ['避免高饱和'],
    verticalDelivery: {
      aspect_ratio: '9:16', face_safe_area: '中上区域', subtitle_safe_area: '底部安全区',
    },
  }
  const actualItems = items ?? [pack]
  return {
    schemaVersion: 'style-pack-v1',
    groups: [
      { key: 'real_person', label: '真人写实', items: [] },
      { key: '2d', label: '2D风格', items: actualItems },
      { key: '3d', label: '3D风格', items: [] },
    ],
    total: actualItems.length,
  }
}

function styleSource(response = styleResponse()): YimengStylePackProjectionSource {
  const bytes = Buffer.from(JSON.stringify(response), 'utf8')
  return { bytes }
}

function replaceCard(card: CreativeSkillCard, replacement: Partial<CreativeSkillCard>): CreativeSkillCard {
  return { ...structuredClone(card), ...replacement }
}

function contentBindings(cards: readonly CreativeSkillCard[]): ReadonlyMap<string, string> {
  return new Map(cards.map(card => [card.id, card.contentSha256]))
}

function resign(card: CreativeSkillCard): CreativeSkillCard {
  const { methodSha256: _methodSha256, ...unsigned } = card
  return { ...unsigned, methodSha256: creativeSkillSha256(unsigned) }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('creative skill catalog', () => {
  it('builds identical output from identical admitted bytes with all six categories', async () => {
    const first = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    const second = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(new Set(first.cards.map(card => card.category))).toEqual(
      new Set(['writing', 'director', 'camera', 'visual', 'sound', 'qc']),
    )
    expect(first.cards).toHaveLength(6)
    expect(first.cards.every(card => card.defaultOff && card.zeroProvider)).toBe(true)
    expect(first.providerCalls).toBe(0)
    expect(first.cards.map(card => card.nameZh)).toContain('剧作节拍表方法')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.cards[0])).toBe(true)
    expect(() => {
      (first.cards[0] as { nameZh: string }).nameZh = '被篡改'
    }).toThrow()
  })

  it('rejects caller-generated Yimeng bytes even when internally self-consistent', async () => {
    await expect(buildCreativeSkillCatalog({
      directorAssetsRoot: assetsRoot,
      yimengStylePacks: styleSource(),
    })).rejects.toThrow('creative_skill_sha_drift')
  })

  it('rejects unknown sources and disallowed licenses', async () => {
    const catalog = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    const unknown = replaceCard(catalog.cards[0]!, {
      source: { ...catalog.cards[0]!.source, authority: 'other' } as unknown as CreativeSkillCard['source'],
    })
    expect(() => finalizeCreativeSkillCatalog(
      [unknown, ...catalog.cards.slice(1)], contentBindings(catalog.cards),
    ))
      .toThrow('creative_skill_source_unknown')

    const disallowed = replaceCard(catalog.cards[0]!, {
      license: { id: 'Apache-2.0', usageBoundary: 'attribution-retained-read-only-method-reference' },
    })
    expect(() => finalizeCreativeSkillCatalog(
      [disallowed, ...catalog.cards.slice(1)], contentBindings(catalog.cards),
    ))
      .toThrow('creative_skill_license_not_allowed')
  })

  it('rejects duplicate IDs and invalid scope', async () => {
    const catalog = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    expect(() => finalizeCreativeSkillCatalog(
      [...catalog.cards, catalog.cards[0]!], contentBindings(catalog.cards),
    ))
      .toThrow('creative_skill_duplicate_id')
    const invalidScope = replaceCard(catalog.cards[0]!, {
      scopes: ['project', 'invalid'] as CreativeSkillCard['scopes'],
    })
    expect(() => finalizeCreativeSkillCatalog(
      [invalidScope, ...catalog.cards.slice(1)], contentBindings(catalog.cards),
    ))
      .toThrow('creative_skill_scope_invalid')
  })

  it('rejects source byte and trusted content binding drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-creative-skill-catalog-'))
    temporaryRoots.push(root)
    await mkdir(join(root, 'director'), { recursive: true })
    for (const repoId of ['director-skill-core', 'ai-visual-director']) {
      await cp(join(assetsRoot, 'director', repoId), join(root, 'director', repoId), { recursive: true })
    }
    const entry = directorAssetEntry('director-skill-core')
    const target = join(root, 'director', entry.repoId, entry.commit, 'assets/beat-sheet-template.md')
    const original = await readFile(target, 'utf8')
    await writeFile(target, `${original}\nchanged\n`, 'utf8')
    await expect(buildCreativeSkillCatalog({ directorAssetsRoot: root }))
      .rejects.toThrow('creative_skill_sha_drift')

    const catalog = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    const forged = resign(replaceCard(catalog.cards[0]!, { contentSha256: '0'.repeat(64) }))
    expect(() => finalizeCreativeSkillCatalog(
      [forged, ...catalog.cards.slice(1)], contentBindings(catalog.cards),
    )).toThrow('creative_skill_sha_drift')
  })

  it('rejects missing relationship targets', async () => {
    const catalog = await buildCreativeSkillCatalog({ directorAssetsRoot: assetsRoot })
    const changed = resign(replaceCard(catalog.cards[0]!, {
      requires: ['qingmu.creative.writing.missing'],
    }))
    expect(() => finalizeCreativeSkillCatalog(
      [changed, ...catalog.cards.slice(1)], contentBindings(catalog.cards),
    )).toThrow('creative_skill_card_invalid')
  })
})
