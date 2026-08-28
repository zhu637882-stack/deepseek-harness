import { mkdtemp, mkdir, readFile, rm, cp, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  DirectorAssetRegistryError,
  DIRECTOR_ASSET_ENTRIES,
  directorAssetEntry,
  directorAssetPackageDir,
  listDirectorAssets,
  verifyAllDirectorAssets,
  verifyDirectorAssetPackage,
} from '../src/director-assets/registry.ts'

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), '../assets')

describe('director asset registry', () => {
  it('registers exactly the eight H1 packages with pinned commits', () => {
    expect(DIRECTOR_ASSET_ENTRIES.map(e => e.repoId)).toEqual(['director-skill-core', 'storyboard-skill', 'jellyfish',
      'nautilus-studio', 'ai-visual-director', 'director-skills-travel', 'arcreel', 'bluefish'])
    for (const entry of DIRECTOR_ASSET_ENTRIES) {
      expect(entry.commit).toMatch(/^[0-9a-f]{40}$/u)
      expect(entry.files).toContain('LICENSE')
      expect(entry.files).toContain('ADMISSION.md')
    }
    expect(listDirectorAssets()).toBe(DIRECTOR_ASSET_ENTRIES)
  })

  it('rejects unknown repos', () => {
    expect(() => directorAssetEntry('not-a-repo')).toThrow(DirectorAssetRegistryError)
  })

  it('verifies every checked-in package against its provenance ledger', async () => {
    const results = await verifyAllDirectorAssets(assetsRoot)
    expect(results.map(r => r.repoId)).toEqual(['director-skill-core', 'storyboard-skill', 'jellyfish',
      'nautilus-studio', 'ai-visual-director', 'director-skills-travel', 'arcreel', 'bluefish'])
    for (const result of results) {
      expect(result.verifiedFiles.length).toBeGreaterThan(0)
    }
  })

  it('resolves package dirs under the pinned commit path', () => {
    const dir = directorAssetPackageDir(assetsRoot, 'storyboard-skill')
    expect(dir).toBe(join(assetsRoot, 'director', 'storyboard-skill', '76a78c55922d1b007b1478aafb6faaf672487e53'))
  })
})

describe('director asset integrity fails closed', () => {
  const entry = directorAssetEntry('director-skill-core')
  let root = ''
  let pkg = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'director-assets-'))
    pkg = join(root, 'director', entry.repoId, entry.commit)
    await cp(directorAssetPackageDir(assetsRoot, 'director-skill-core'), pkg, { recursive: true })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('passes on the untouched copy', async () => {
    const result = await verifyDirectorAssetPackage(pkg, entry)
    expect(result.verifiedFiles.length).toBe(entry.provenanceFiles.length)
  })

  it('rejects an unlisted extra file', async () => {
    await writeFile(join(pkg, 'smuggled.txt'), 'x')
    await expect(verifyDirectorAssetPackage(pkg, entry)).rejects.toThrow('director_asset_files_mismatch')
    await rm(join(pkg, 'smuggled.txt'))
  })

  it('rejects unlisted symbolic links instead of ignoring them', async () => {
    const link = join(pkg, 'smuggled-link')
    await symlink(join(pkg, 'LICENSE'), link)
    try {
      await expect(verifyDirectorAssetPackage(pkg, entry))
        .rejects.toThrow('director_asset_non_regular_entry')
    } finally {
      await rm(link)
    }
  })

  it('rejects a tampered asset body with a matching-name file', async () => {
    const target = join(pkg, 'assets/qc-checklist.md')
    const original = await readFile(target, 'utf8')
    await writeFile(target, `${original}\ntampered`)
    await expect(verifyDirectorAssetPackage(pkg, entry)).rejects.toThrow('director_asset_sha256_mismatch')
    await writeFile(target, original)
  })

  it('rejects a provenance line removed from the ledger', async () => {
    const ledger = join(pkg, 'PROVENANCE.sha256')
    const original = await readFile(ledger, 'utf8')
    const firstLine = original.split('\n').find(line => line !== '') as string
    await writeFile(ledger, original.replace(`${firstLine}\n`, ''))
    await expect(verifyDirectorAssetPackage(pkg, entry)).rejects.toThrow('director_asset_provenance_scope_mismatch')
    await writeFile(ledger, original)
  })

  it('rejects coordinated content and ledger tampering against the registry pin', async () => {
    const target = join(pkg, 'assets/qc-checklist.md')
    const ledger = join(pkg, 'PROVENANCE.sha256')
    const original = await readFile(target, 'utf8')
    const originalLedger = await readFile(ledger, 'utf8')
    const tampered = `${original}\ntampered`
    try {
      await writeFile(target, tampered)
      await writeFile(ledger, originalLedger.replace(
        createHash('sha256').update(original).digest('hex'),
        createHash('sha256').update(tampered).digest('hex'),
      ))
      await expect(verifyDirectorAssetPackage(pkg, entry))
        .rejects.toThrow('director_asset_provenance_sha256_mismatch')
    } finally {
      await writeFile(target, original)
      await writeFile(ledger, originalLedger)
    }
  })

  it('rejects a missing package dir via verifyAll', async () => {
    const emptyRoot = join(root, 'empty-assets')
    await mkdir(emptyRoot, { recursive: true })
    await expect(verifyAllDirectorAssets(emptyRoot)).rejects.toThrow('director_asset_package_missing')
  })
})
