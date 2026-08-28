/** Single registry for H1 director asset packages; admission ledger plus fail-closed integrity verification. */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

/** A registered asset package provenance mismatch or unexpected on-disk state. */
export class DirectorAssetRegistryError extends Error {}

export type DirectorAssetDisposition = 'content' | 'pure_module'

export interface DirectorAssetEntry {
  readonly repoId: string
  readonly repoUrl: string
  readonly commit: string
  readonly license: 'MIT' | 'Apache-2.0'
  readonly disposition: DirectorAssetDisposition
  readonly imagoTargets: readonly string[]
  /** Allowed files relative to the package dir; everything else is rejected. */
  readonly files: readonly string[]
  /** Files that carry a recorded sha256 in PROVENANCE.sha256. */
  readonly provenanceFiles: readonly string[]
}

const provenanceFile = 'PROVENANCE.sha256'

export const DIRECTOR_ASSET_ENTRIES: readonly DirectorAssetEntry[] = [
  {
    repoId: 'director-skill-core',
    repoUrl: 'https://github.com/wuwangzhang1216/DirectorSKILL',
    commit: '47db7d9b951a9f27f7b4b727a6ca0e01ab56f7c6',
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
] as const

export function directorAssetEntry(repoId: string): DirectorAssetEntry {
  const entry = DIRECTOR_ASSET_ENTRIES.find(candidate => candidate.repoId === repoId)
  if (entry === undefined) throw new DirectorAssetRegistryError('director_asset_not_registered')
  return entry
}

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
  }
  return found
}

/** Fail closed: the package dir must contain exactly the admitted files, every provenance
 * line must match, and no unlisted file may exist. */
export async function verifyDirectorAssetPackage(
  packageDir: string,
  entry: DirectorAssetEntry,
): Promise<DirectorAssetIntegrity> {
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

  const verified: string[] = []
  for (const file of entry.provenanceFiles) {
    const bytes = await readFile(join(packageDir, file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== recorded.get(file)) throw new DirectorAssetRegistryError('director_asset_sha256_mismatch')
    verified.push(file)
  }
  return { repoId: entry.repoId, commit: entry.commit, verifiedFiles: verified }
}

/** Resolve the checked-in package dir for a repo from a caller-supplied assets root. */
export function directorAssetPackageDir(assetsRoot: string, repoId: string): string {
  const entry = directorAssetEntry(repoId)
  return join(assetsRoot, 'director', entry.repoId, entry.commit)
}

/** Enumerate registry rows without touching disk; activation is a separate, later concern. */
export function listDirectorAssets(): readonly DirectorAssetEntry[] {
  return DIRECTOR_ASSET_ENTRIES
}

export async function verifyAllDirectorAssets(assetsRoot: string): Promise<readonly DirectorAssetIntegrity[]> {
  const results: DirectorAssetIntegrity[] = []
  for (const entry of DIRECTOR_ASSET_ENTRIES) {
    const dir = join(assetsRoot, 'director', entry.repoId, entry.commit)
    const info = await stat(dir).catch(() => null)
    if (info === null || !info.isDirectory()) throw new DirectorAssetRegistryError('director_asset_package_missing')
    results.push(await verifyDirectorAssetPackage(dir, entry))
  }
  return results
}
