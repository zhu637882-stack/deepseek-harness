/** Single registry for H1 director asset packages; admission ledger plus fail-closed integrity verification. */
import { createHash } from 'node:crypto'
import { readdir, readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

/** A registered asset package provenance mismatch or unexpected on-disk state. */
export class DirectorAssetRegistryError extends Error {}

/** Planned reuse category, not proof of purity, dependency closure, or execution authority. */
export type DirectorAssetDisposition = 'content' | 'pure_module'

/** Reviewed source identity, license, and exact allowed package contents. */
export interface DirectorAssetEntry {
  readonly repoId: string
  readonly repoUrl: string
  readonly commit: string
  /** Pinned ledger digest; changing files and their local ledger together is rejected. */
  readonly provenanceSha256: string
  readonly license: 'MIT' | 'Apache-2.0'
  readonly disposition: DirectorAssetDisposition
  readonly imagoTargets: readonly string[]
  /** Allowed files relative to the package dir; everything else is rejected. */
  readonly files: readonly string[]
  /** Files that carry a recorded sha256 in PROVENANCE.sha256. */
  readonly provenanceFiles: readonly string[]
}

const provenanceFile = 'PROVENANCE.sha256'

/** Checked-in source inventory; executable modules remain inactive candidates. */
export const DIRECTOR_ASSET_ENTRIES: readonly DirectorAssetEntry[] = [
  {
    repoId: 'director-skill-core',
    repoUrl: 'https://github.com/wuwangzhang1216/DirectorSKILL',
    commit: '47db7d9b951a9f27f7b4b727a6ca0e01ab56f7c6',
    provenanceSha256: '55d46f34379777805c0d1e996834508400cfaacd538ed6c1f9cde3a39b9bb6b3',
    license: 'MIT',
    disposition: 'content',
    imagoTargets: ['CDEV', 'C5R', 'D', 'E', 'LSUQC', 'human-editor-after-LSUQC'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'assets/beat-sheet-template.md', 'assets/director-book-template.md', 'assets/keyframe-prompt-template.md',
      'assets/qc-checklist.md', 'assets/shot-plan-template.md', 'assets/video-prompt-template.md',
      'references/continuity-bible.md', 'references/failure-modes.md', 'evals/evals.json'],
    provenanceFiles: ['LICENSE',
      'assets/beat-sheet-template.md', 'assets/director-book-template.md', 'assets/keyframe-prompt-template.md',
      'assets/qc-checklist.md', 'assets/shot-plan-template.md', 'assets/video-prompt-template.md',
      'references/continuity-bible.md', 'references/failure-modes.md', 'evals/evals.json'],
  },
  {
    repoId: 'storyboard-skill',
    repoUrl: 'https://github.com/Zhekinmaksim/Storyboard',
    commit: '76a78c55922d1b007b1478aafb6faaf672487e53',
    provenanceSha256: '0fe528f7c9ddecbfd314abc76b6245f60ef83e30a00d0ef12f1670d93d670ba5',
    license: 'MIT',
    disposition: 'pure_module',
    imagoTargets: ['C5R', 'PREVIS'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'scripts/scene.py', 'scripts/render.py', 'scripts/packet.py',
      'scripts/director_notes.py', 'scripts/iterate.py'],
    provenanceFiles: ['LICENSE',
      'scripts/scene.py', 'scripts/render.py', 'scripts/packet.py',
      'scripts/director_notes.py', 'scripts/iterate.py'],
  },
  {
    repoId: 'jellyfish',
    repoUrl: 'https://github.com/Forget-C/Jellyfish',
    commit: 'a9678194ddf2d9be3ccbe78d4287d87d5089e123',
    provenanceSha256: 'dd251b5a3450adb03815c6a6457e3c5a980e2408183b97f9abc269570086d251',
    license: 'Apache-2.0',
    disposition: 'pure_module',
    imagoTargets: ['A2', 'C5R', 'ARF', 'E', 'F'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'backend/app/schemas/skills/script_processing.py',
      'backend/app/services/studio/shot_preparation_state.py',
      'backend/app/services/studio/shot_video_readiness.py',
      'backend/app/services/studio/shot_video_prompt_pack.py'],
    provenanceFiles: ['LICENSE',
      'backend/app/schemas/skills/script_processing.py',
      'backend/app/services/studio/shot_preparation_state.py',
      'backend/app/services/studio/shot_video_readiness.py',
      'backend/app/services/studio/shot_video_prompt_pack.py'],
  },
  {
    repoId: 'nautilus-studio',
    repoUrl: 'https://github.com/yeahdongcn/nautilus-studio',
    commit: 'b9a30f02ffb5b00b8d1eb55da8e987504a2df9fa',
    provenanceSha256: 'f28e5b436978f1e5e53d6c1b3616589ed61eb3539e355ffb658646b7bb5e718f',
    license: 'Apache-2.0',
    disposition: 'pure_module',
    imagoTargets: ['C5R', 'E'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'src/long_video_studio/domain.py', 'src/long_video_studio/dialogue_harness.py',
      'src/long_video_studio/estimator.py', 'src/long_video_studio/anchor_policy.py'],
    provenanceFiles: ['LICENSE',
      'src/long_video_studio/domain.py', 'src/long_video_studio/dialogue_harness.py',
      'src/long_video_studio/estimator.py', 'src/long_video_studio/anchor_policy.py'],
  },
  {
    repoId: 'ai-visual-director',
    repoUrl: 'https://github.com/jijiutong/ai-visual-director',
    commit: 'b47f664ca00c50539c5365109e9360f82170972d',
    provenanceSha256: '0c8b25c072bc51d0207301bc99f24fa4a53a59f5dad6c8f80f020bd736b2b61b',
    license: 'MIT',
    disposition: 'content',
    imagoTargets: ['C5R', 'D', 'E'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'engines/reference-anchor.md', 'engines/consistency-engine.md',
      'engines/video-prompt-assembly.md', 'engines/shot-budget.md',
      'rules/continuity-check.md', 'rules/video-reference-assets.md',
      'templates/full-board.md', 'templates/sound-design-sheet.md',
      'templates/character-sheet.md', 'templates/scene-card.md'],
    provenanceFiles: ['LICENSE',
      'engines/reference-anchor.md', 'engines/consistency-engine.md',
      'engines/video-prompt-assembly.md', 'engines/shot-budget.md',
      'rules/continuity-check.md', 'rules/video-reference-assets.md',
      'templates/full-board.md', 'templates/sound-design-sheet.md',
      'templates/character-sheet.md', 'templates/scene-card.md'],
  },
  {
    repoId: 'director-skills-travel',
    repoUrl: 'https://github.com/kangarooking/director-skills',
    commit: '4a91b5c1a00dbea24063ce6202484cbcf45216f7',
    provenanceSha256: '451f33a0f30c2a7b023dce7380423db7797daa9ca2bb1b8f99666872446daa65',
    license: 'MIT',
    disposition: 'content',
    imagoTargets: ['A2', 'C5R', 'E'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'travel-skill/SKILL.md',
      'travel-skill/assets/templates/project-brief.md', 'travel-skill/assets/templates/asset-register.csv',
      'travel-skill/assets/templates/storyboard.md', 'travel-skill/assets/templates/shot-manifest.yaml',
      'travel-skill/assets/templates/generation-log.csv', 'travel-skill/assets/templates/qc-report.md',
      'travel-skill/scripts/build_generation_packet.py', 'travel-skill/scripts/lint_prompt.py',
      'travel-skill/scripts/lint_shot_manifest.py', 'travel-skill/scripts/validate_timeline.py'],
    provenanceFiles: ['LICENSE',
      'travel-skill/SKILL.md',
      'travel-skill/assets/templates/project-brief.md', 'travel-skill/assets/templates/asset-register.csv',
      'travel-skill/assets/templates/storyboard.md', 'travel-skill/assets/templates/shot-manifest.yaml',
      'travel-skill/assets/templates/generation-log.csv', 'travel-skill/assets/templates/qc-report.md',
      'travel-skill/scripts/build_generation_packet.py', 'travel-skill/scripts/lint_prompt.py',
      'travel-skill/scripts/lint_shot_manifest.py', 'travel-skill/scripts/validate_timeline.py'],
  },
  {
    repoId: 'arcreel',
    repoUrl: 'https://github.com/ArcReel/ArcReel',
    commit: '44d22bfaa5e270bb53df8becdfb3c441879d9312',
    provenanceSha256: '8a4b90589d2f7c70b3e91ed12e307ac462f52d308a115bb9a07e21c9400505b0',
    license: 'MIT',
    disposition: 'content',
    imagoTargets: ['E', 'LSUQC'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'skills/video-workflow/SKILL.md',
      'skills/video-workflow/references/plan-safety.md',
      'skills/video-workflow/references/generation-modes.md',
      'skills/video-workflow/references/generation-results.md'],
    provenanceFiles: ['LICENSE',
      'skills/video-workflow/SKILL.md',
      'skills/video-workflow/references/plan-safety.md',
      'skills/video-workflow/references/generation-modes.md',
      'skills/video-workflow/references/generation-results.md'],
  },
  {
    repoId: 'bluefish',
    repoUrl: 'https://github.com/bluefish2026/BlueFish',
    commit: '8b409c1332e46bc1211d2ffc6d45fe1f01492eca',
    provenanceSha256: 'e6f29242fd7cec131e797e67788b3f66a4b491f866d4f1589f4beb1f5c57bf5b',
    license: 'Apache-2.0',
    disposition: 'pure_module',
    imagoTargets: ['D', 'E'],
    files: ['ADMISSION.md', 'LICENSE', provenanceFile,
      'bluefish-server/app/services/prompt_builder.py',
      'bluefish-server/tests/test_prompt_builder.py'],
    provenanceFiles: ['LICENSE',
      'bluefish-server/app/services/prompt_builder.py',
      'bluefish-server/tests/test_prompt_builder.py'],
  },
] as const

/**
 * Resolve a registered repository or reject an unknown identity.
 * @param repoId - exact registry repository ID.
 * @returns the reviewed admission row.
 */
export function directorAssetEntry(repoId: string): DirectorAssetEntry {
  const entry = DIRECTOR_ASSET_ENTRIES.find(candidate => candidate.repoId === repoId)
  if (entry === undefined) throw new DirectorAssetRegistryError('director_asset_not_registered')
  return entry
}

/** Successful static byte verification, not activation or creative approval. */
export interface DirectorAssetIntegrity {
  readonly repoId: string
  readonly commit: string
  readonly verifiedFiles: readonly string[]
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  const names = await readdir(root, { withFileTypes: true })
  const found: string[] = []
  for (const item of names) {
    const rel = prefix === '' ? item.name : `${prefix}/${item.name}`
    if (item.isDirectory()) found.push(...(await walkFiles(join(root, item.name), rel)))
    else if (item.isFile()) found.push(rel)
    else throw new DirectorAssetRegistryError('director_asset_non_regular_entry')
  }
  return found
}

/**
 * Require the exact admitted regular files, complete pinned ledger, and matching bytes.
 * @param packageDir - local static package directory; symlinks are rejected.
 * @param entry - trusted registry row, not caller-supplied admission JSON.
 * @returns the source identity and verified file paths; rejects any mismatch.
 */
export async function verifyDirectorAssetPackage(
  packageDir: string,
  entry: DirectorAssetEntry,
): Promise<DirectorAssetIntegrity> {
  const info = await lstat(packageDir)
  if (!info.isDirectory()) throw new DirectorAssetRegistryError('director_asset_non_regular_entry')
  const onDisk = (await walkFiles(packageDir)).sort()
  const admitted = [...entry.files].sort()
  if (!isDeepStrictEqual(onDisk, admitted)) throw new DirectorAssetRegistryError('director_asset_files_mismatch')

  const provenanceRaw = await readFile(join(packageDir, provenanceFile), 'utf8')
  const recorded = new Map<string, string>()
  for (const line of provenanceRaw.split('\n')) {
    if (line === '') continue
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) throw new DirectorAssetRegistryError('director_asset_provenance_malformed')
    const [sha256Hex, path] = [match[1], match[2]]
    if (recorded.has(path)) throw new DirectorAssetRegistryError('director_asset_provenance_duplicate')
    recorded.set(path, sha256Hex)
  }
  if (!isDeepStrictEqual([...recorded.keys()].sort(), [...entry.provenanceFiles].sort())) {
    throw new DirectorAssetRegistryError('director_asset_provenance_scope_mismatch')
  }
  if (createHash('sha256').update(provenanceRaw).digest('hex') !== entry.provenanceSha256) {
    throw new DirectorAssetRegistryError('director_asset_provenance_sha256_mismatch')
  }

  const verified: string[] = []
  for (const file of entry.provenanceFiles) {
    const bytes = await readFile(join(packageDir, file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== recorded.get(file)) throw new DirectorAssetRegistryError('director_asset_sha256_mismatch')
    verified.push(file)
  }
  return { repoId: entry.repoId, commit: entry.commit, verifiedFiles: verified }
}

/**
 * Resolve the checked-in package directory without reading or activating it.
 * @param assetsRoot - trusted local assets directory.
 * @param repoId - exact registry repository ID.
 * @returns the pinned commit directory; rejects unknown repositories.
 */
export function directorAssetPackageDir(assetsRoot: string, repoId: string): string {
  const entry = directorAssetEntry(repoId)
  return join(assetsRoot, 'director', entry.repoId, entry.commit)
}

/**
 * Enumerate registry rows without touching disk or activating assets.
 * @returns the reviewed static source inventory.
 */
export function listDirectorAssets(): readonly DirectorAssetEntry[] {
  return DIRECTOR_ASSET_ENTRIES
}

/**
 * Verify every admitted source package without executing any asset.
 * @param assetsRoot - trusted local assets directory.
 * @returns verified identities; rejects missing packages or integrity mismatches.
 */
export async function verifyAllDirectorAssets(assetsRoot: string): Promise<readonly DirectorAssetIntegrity[]> {
  const results: DirectorAssetIntegrity[] = []
  for (const entry of DIRECTOR_ASSET_ENTRIES) {
    const dir = join(assetsRoot, 'director', entry.repoId, entry.commit)
    const info = await lstat(dir).catch(() => null)
    if (info === null || !info.isDirectory()) throw new DirectorAssetRegistryError('director_asset_package_missing')
    results.push(await verifyDirectorAssetPackage(dir, entry))
  }
  return results
}
