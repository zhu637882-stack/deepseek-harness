/** Deterministic, read-only creative skill catalog assembled from admitted sources. */
import { DIRECTOR_STAGE_CARDS, loadDirectorAssetFile } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/director-assets/assembly'
import { directorAssetEntry } from '@deepseek-ai/dsh-experimental-qingmu-imago-method-adapter/director-assets/registry'

import { creativeSkillBytesSha256, creativeSkillSha256 } from './canonical.ts'
import { finalizeCreativeSkillCatalog } from './catalog.ts'
import { CreativeSkillCatalogError } from './error.ts'
import { projectYimengStylePackCards } from './style-pack.ts'
import type {
  BuildCreativeSkillCatalogOptions,
  CreativeSkillCard,
  CreativeSkillCatalog,
  CreativeSkillCategory,
  CreativeSkillScope,
} from './types.ts'

export * from './error.ts'
export * from './types.ts'

interface BaseMethodDefinition {
  readonly id: string
  readonly nameZh: string
  readonly summaryZh: string
  readonly category: CreativeSkillCategory
  readonly repoId: 'director-skill-core' | 'ai-visual-director'
  readonly path: string
  readonly scopes: readonly CreativeSkillScope[]
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly requires: readonly string[]
}

const BASE_METHODS: readonly BaseMethodDefinition[] = [
  {
    id: 'qingmu.creative.writing.beat-sheet',
    nameZh: '剧作节拍表方法',
    summaryZh: '把故事前提拆成可复核的叙事节拍、转折与情绪推进。',
    category: 'writing',
    repoId: 'director-skill-core',
    path: 'assets/beat-sheet-template.md',
    scopes: ['project', 'episode'],
    inputs: ['story_premise', 'episode_goal', 'duration_budget'],
    outputs: ['beat_sheet'],
    requires: [],
  },
  {
    id: 'qingmu.creative.director.director-book',
    nameZh: '导演手册方法',
    summaryZh: '统一叙事意图、人物调度、视听原则与执行边界。',
    category: 'director',
    repoId: 'director-skill-core',
    path: 'assets/director-book-template.md',
    scopes: ['project', 'episode', 'scene'],
    inputs: ['story_intent', 'character_profiles', 'world_rules'],
    outputs: ['director_book'],
    requires: ['qingmu.creative.writing.beat-sheet'],
  },
  {
    id: 'qingmu.creative.camera.shot-plan',
    nameZh: '镜头计划方法',
    summaryZh: '把场景目标转换为景别、机位、运动与镜头衔接计划。',
    category: 'camera',
    repoId: 'director-skill-core',
    path: 'assets/shot-plan-template.md',
    scopes: ['scene', 'shot'],
    inputs: ['scene_goal', 'blocking', 'continuity_constraints'],
    outputs: ['shot_plan'],
    requires: ['qingmu.creative.director.director-book'],
  },
  {
    id: 'qingmu.creative.visual.reference-anchor',
    nameZh: '视觉参考锚定方法',
    summaryZh: '为人物、环境与关键视觉关系建立可追溯的参考锚点。',
    category: 'visual',
    repoId: 'ai-visual-director',
    path: 'engines/reference-anchor.md',
    scopes: ['project', 'episode', 'scene', 'shot'],
    inputs: ['visual_intent', 'approved_references', 'continuity_constraints'],
    outputs: ['reference_anchor_plan'],
    requires: ['qingmu.creative.director.director-book'],
  },
  {
    id: 'qingmu.creative.sound.sound-design-sheet',
    nameZh: '声音设计表方法',
    summaryZh: '按叙事功能组织对白、环境、拟音、音乐与静默层次。',
    category: 'sound',
    repoId: 'ai-visual-director',
    path: 'templates/sound-design-sheet.md',
    scopes: ['episode', 'scene', 'shot'],
    inputs: ['scene_rhythm', 'dialogue_plan', 'location_context'],
    outputs: ['sound_design_sheet'],
    requires: ['qingmu.creative.director.director-book'],
  },
  {
    id: 'qingmu.creative.qc.review-checklist',
    nameZh: '创作质检清单方法',
    summaryZh: '以可追踪检查项复核叙事、连续性、视听与交付问题。',
    category: 'qc',
    repoId: 'director-skill-core',
    path: 'assets/qc-checklist.md',
    scopes: ['episode', 'scene', 'shot'],
    inputs: ['creative_artifact', 'continuity_evidence', 'delivery_requirements'],
    outputs: ['qc_checklist_result'],
    requires: ['qingmu.creative.camera.shot-plan'],
  },
] as const

type UnsignedCreativeSkillCard = Omit<CreativeSkillCard, 'methodSha256'>

function signCard(card: UnsignedCreativeSkillCard): CreativeSkillCard {
  return { ...card, methodSha256: creativeSkillSha256(card) }
}

function mapDirectorSourceError(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  if (message === 'director_asset_not_registered'
    || message === 'director_asset_file_not_admitted'
    || message === 'director_asset_file_not_provenanced') {
    throw new CreativeSkillCatalogError('creative_skill_source_unknown')
  }
  if (message.includes('sha256') || message.includes('provenance')) {
    throw new CreativeSkillCatalogError('creative_skill_sha_drift')
  }
  throw new CreativeSkillCatalogError('creative_skill_source_invalid')
}

async function buildBaseCard(
  definition: BaseMethodDefinition,
  assetsRoot: string,
): Promise<CreativeSkillCard> {
  const admitted = DIRECTOR_STAGE_CARDS.some(card =>
    card.repoId === definition.repoId && card.path === definition.path)
  if (!admitted) throw new CreativeSkillCatalogError('creative_skill_source_unknown')
  const entry = directorAssetEntry(definition.repoId)
  let content: string
  try {
    content = await loadDirectorAssetFile(assetsRoot, definition.repoId, definition.path)
  } catch (error) {
    mapDirectorSourceError(error)
  }
  return signCard({
    id: definition.id,
    nameZh: definition.nameZh,
    summaryZh: definition.summaryZh,
    category: definition.category,
    version: '1.0.0',
    contentSha256: creativeSkillBytesSha256(content),
    source: {
      kind: 'imago-director-asset',
      authority: 'qingmu-imago-method-adapter',
      repoId: entry.repoId,
      repository: entry.repoUrl,
      path: definition.path,
    },
    provenance: {
      kind: 'git-ledger',
      commit: entry.commit,
      provenanceSha256: entry.provenanceSha256,
    },
    license: {
      id: entry.license,
      usageBoundary: 'attribution-retained-read-only-method-reference',
    },
    scopes: definition.scopes,
    inputs: definition.inputs,
    outputs: definition.outputs,
    conflictsWith: [],
    requires: definition.requires,
    defaultOff: true,
    zeroProvider: true,
  })
}

/**
 * Build the versioned catalog from exact admitted bytes. The function performs no
 * writes, registration, activation, Provider calls, or creative approval.
 * @param options - trusted asset root and optional authenticated Yimeng bytes.
 * @returns the fully validated deterministic catalog.
 */
export async function buildCreativeSkillCatalog(
  options: BuildCreativeSkillCatalogOptions,
): Promise<CreativeSkillCatalog> {
  if (typeof options.directorAssetsRoot !== 'string'
    || options.directorAssetsRoot.length === 0
    || options.directorAssetsRoot.trim() !== options.directorAssetsRoot) {
    throw new CreativeSkillCatalogError('creative_skill_source_invalid')
  }
  const cards: CreativeSkillCard[] = []
  for (const definition of BASE_METHODS) {
    cards.push(await buildBaseCard(definition, options.directorAssetsRoot))
  }
  if (options.yimengStylePacks !== undefined) {
    cards.push(...projectYimengStylePackCards(options.yimengStylePacks).map(signCard))
  }
  const trustedContentShaById = new Map(cards.map(card => [card.id, card.contentSha256]))
  return finalizeCreativeSkillCatalog(cards, trustedContentShaById)
}
