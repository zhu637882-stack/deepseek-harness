/** Static stage assembly for admitted director assets: which method cards, checklists,
 * failure codes, eval sets and tool modules a work-order stage may load — content is
 * served only after per-file provenance verification. No runtime activation here. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DirectorAssetRegistryError, directorAssetEntry } from './registry.ts'

/** What an admitted file can supply to a work order. */
export type DirectorAssetCardKind =
  | 'method_card'
  | 'checklist'
  | 'failure_codes'
  | 'eval_set'
  | 'tool_module'

export interface DirectorStageCard {
  readonly repoId: string
  readonly path: string
  readonly kind: DirectorAssetCardKind
  /** IMAGO stage ids this card serves; never inferred at runtime. */
  readonly stageIds: readonly string[]
}

const cards: readonly (readonly [string, string, DirectorAssetCardKind, readonly string[]])[] = [
  // director-skill-core (MIT, content)
  ['director-skill-core', 'assets/beat-sheet-template.md', 'method_card', ['CDEV']],
  ['director-skill-core', 'assets/director-book-template.md', 'method_card', ['CDEV']],
  ['director-skill-core', 'assets/shot-plan-template.md', 'method_card', ['C5R', 'C5F']],
  ['director-skill-core', 'references/continuity-bible.md', 'checklist', ['C5R', 'LSUQC']],
  ['director-skill-core', 'assets/keyframe-prompt-template.md', 'method_card', ['D']],
  ['director-skill-core', 'assets/video-prompt-template.md', 'method_card', ['E']],
  ['director-skill-core', 'assets/qc-checklist.md', 'checklist', ['LSUQC']],
  ['director-skill-core', 'references/failure-modes.md', 'failure_codes', ['LSUQC', 'E']],
  ['director-skill-core', 'evals/evals.json', 'eval_set', ['LSUQC']],
  // storyboard-skill (MIT, pure modules)
  ['storyboard-skill', 'scripts/scene.py', 'tool_module', ['C5R', 'PREVIS']],
  ['storyboard-skill', 'scripts/render.py', 'tool_module', ['PREVIS']],
  ['storyboard-skill', 'scripts/packet.py', 'tool_module', ['C5R', 'PREVIS']],
  ['storyboard-skill', 'scripts/director_notes.py', 'tool_module', ['C5R']],
  ['storyboard-skill', 'scripts/iterate.py', 'tool_module', ['C5R']],
  // jellyfish (Apache-2.0, pure modules)
  ['jellyfish', 'backend/app/schemas/skills/script_processing.py', 'tool_module', ['A2']],
  ['jellyfish', 'backend/app/services/studio/shot_preparation_state.py', 'tool_module', ['C5R']],
  ['jellyfish', 'backend/app/services/studio/shot_video_readiness.py', 'tool_module', ['C5R', 'E']],
  ['jellyfish', 'backend/app/services/studio/shot_video_prompt_pack.py', 'tool_module', ['E']],
  // nautilus-studio (Apache-2.0, pure modules)
  ['nautilus-studio', 'src/long_video_studio/domain.py', 'tool_module', ['C5R']],
  ['nautilus-studio', 'src/long_video_studio/dialogue_harness.py', 'tool_module', ['C5R', 'E']],
  ['nautilus-studio', 'src/long_video_studio/estimator.py', 'tool_module', ['E']],
  ['nautilus-studio', 'src/long_video_studio/anchor_policy.py', 'tool_module', ['C5R']],
  // ai-visual-director (MIT, content)
  ['ai-visual-director', 'engines/reference-anchor.md', 'method_card', ['C5R', 'ARF']],
  ['ai-visual-director', 'engines/consistency-engine.md', 'method_card', ['C5R']],
  ['ai-visual-director', 'engines/video-prompt-assembly.md', 'method_card', ['E']],
  ['ai-visual-director', 'engines/shot-budget.md', 'method_card', ['E']],
  ['ai-visual-director', 'rules/continuity-check.md', 'checklist', ['C5R', 'LSUQC']],
  ['ai-visual-director', 'rules/video-reference-assets.md', 'checklist', ['ARF']],
  ['ai-visual-director', 'templates/full-board.md', 'method_card', ['CDEV', 'C5R']],
  ['ai-visual-director', 'templates/sound-design-sheet.md', 'method_card', ['E']],
  ['ai-visual-director', 'templates/character-sheet.md', 'method_card', ['CDEV']],
  ['ai-visual-director', 'templates/scene-card.md', 'method_card', ['CDEV']],
  // director-skills-travel (MIT, content + fail-closed lints)
  ['director-skills-travel', 'travel-skill/SKILL.md', 'method_card', ['A2', 'C5R']],
  ['director-skills-travel', 'travel-skill/assets/templates/project-brief.md', 'method_card', ['A2']],
  ['director-skills-travel', 'travel-skill/assets/templates/asset-register.csv', 'method_card', ['ARF']],
  ['director-skills-travel', 'travel-skill/assets/templates/storyboard.md', 'method_card', ['C5R']],
  ['director-skills-travel', 'travel-skill/assets/templates/shot-manifest.yaml', 'method_card', ['C5R']],
  ['director-skills-travel', 'travel-skill/assets/templates/generation-log.csv', 'method_card', ['E']],
  ['director-skills-travel', 'travel-skill/assets/templates/qc-report.md', 'checklist', ['LSUQC']],
  ['director-skills-travel', 'travel-skill/scripts/build_generation_packet.py', 'tool_module', ['E']],
  ['director-skills-travel', 'travel-skill/scripts/lint_prompt.py', 'tool_module', ['D', 'E']],
  ['director-skills-travel', 'travel-skill/scripts/lint_shot_manifest.py', 'tool_module', ['C5R']],
  ['director-skills-travel', 'travel-skill/scripts/validate_timeline.py', 'tool_module', ['LSUQC']],
  // arcreel (skills/ MIT only, content)
  ['arcreel', 'skills/video-workflow/SKILL.md', 'method_card', ['E']],
  ['arcreel', 'skills/video-workflow/references/plan-safety.md', 'checklist', ['E', 'LSUQC']],
  ['arcreel', 'skills/video-workflow/references/generation-modes.md', 'method_card', ['E']],
  ['arcreel', 'skills/video-workflow/references/generation-results.md', 'checklist', ['LSUQC']],
  // bluefish (Apache-2.0, pure module; silent-placeholder blocker — D/E adapter only after fix)
  ['bluefish', 'bluefish-server/app/services/prompt_builder.py', 'tool_module', ['D', 'E']],
  ['bluefish', 'bluefish-server/tests/test_prompt_builder.py', 'tool_module', ['D', 'E']],
] as const

export const DIRECTOR_STAGE_CARDS: readonly DirectorStageCard[] = cards.map(
  ([repoId, path, kind, stageIds]) => ({ repoId, path, kind, stageIds }),
)

/** Cards a stage may load, in registry order; unknown stages return an empty set
 * rather than a guess. */
export function directorStageCards(stageId: string): readonly DirectorStageCard[] {
  if (!/^[A-Z0-9]{1,12}$/u.test(stageId)) return []
  return DIRECTOR_STAGE_CARDS.filter(card => card.stageIds.includes(stageId))
}

/** Load one admitted file after verifying its provenance line; fails closed on
 * unlisted paths, malformed ledgers, or byte drift. */
export async function loadDirectorAssetFile(
  assetsRoot: string,
  repoId: string,
  relPath: string,
): Promise<string> {
  const entry = directorAssetEntry(repoId)
  if (!entry.files.includes(relPath)) throw new DirectorAssetRegistryError('director_asset_file_not_admitted')
  if (!entry.provenanceFiles.includes(relPath)) throw new DirectorAssetRegistryError('director_asset_file_not_provenanced')
  const packageDir = join(assetsRoot, 'director', entry.repoId, entry.commit)
  const provenanceRaw = await readFile(join(packageDir, 'PROVENANCE.sha256'), 'utf8')
  let recorded: string | undefined
  for (const line of provenanceRaw.split('\n')) {
    if (line === '') continue
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) throw new DirectorAssetRegistryError('director_asset_provenance_malformed')
    if (match[2] === relPath) {
      recorded = match[1]
      break
    }
  }
  if (recorded === undefined) throw new DirectorAssetRegistryError('director_asset_provenance_line_missing')
  const bytes = await readFile(join(packageDir, relPath))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== recorded) throw new DirectorAssetRegistryError('director_asset_sha256_mismatch')
  return bytes.toString('utf8')
}
