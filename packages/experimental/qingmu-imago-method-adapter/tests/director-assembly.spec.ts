import { mkdtemp, cp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DIRECTOR_STAGE_CARDS,
  directorStageCards,
  loadDirectorAssetFile,
} from '../src/director-assets/assembly.ts'
import { DIRECTOR_ASSET_ENTRIES, directorAssetPackageDir } from '../src/director-assets/registry.ts'

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), '../assets')

describe('director stage assembly', () => {
  it('keeps every card inside its package admission list', () => {
    for (const entry of DIRECTOR_ASSET_ENTRIES) {
      const cardPaths = DIRECTOR_STAGE_CARDS.filter(card => card.repoId === entry.repoId).map(card => card.path)
      for (const path of cardPaths) expect(entry.provenanceFiles).toContain(path)
    }
  })

  it('covers every provenanced content file except LICENSE ledgers', () => {
    const covered = new Set(DIRECTOR_STAGE_CARDS.map(card => `${card.repoId}:${card.path}`))
    for (const entry of DIRECTOR_ASSET_ENTRIES) {
      for (const file of entry.provenanceFiles) {
        if (file === 'LICENSE') continue
        expect(covered.has(`${entry.repoId}:${file}`), `${entry.repoId}:${file}`).toBe(true)
      }
    }
  })

  it('returns stage cards for known stages and nothing for unknown', () => {
    const c5r = directorStageCards('C5R')
    expect(c5r.length).toBeGreaterThan(4)
    expect(c5r.every(card => card.stageIds.includes('C5R'))).toBe(true)
    expect(directorStageCards('c5r')).toEqual([])
    expect(directorStageCards('C5R; DROP')).toEqual([])
  })
})

describe('director asset content loading fails closed', () => {
  let root = ''
  let pkg = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'director-assembly-'))
    pkg = join(root, 'director', 'director-skill-core', '47db7d9b951a9f27f7b4b727a6ca0e01ab56f7c6')
    await cp(directorAssetPackageDir(assetsRoot, 'director-skill-core'), pkg, { recursive: true })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('loads an admitted card after provenance verification', async () => {
    const content = await loadDirectorAssetFile(root, 'director-skill-core', 'assets/qc-checklist.md')
    expect(content.length).toBeGreaterThan(0)
  })

  it('rejects a path outside the admission list', async () => {
    await expect(loadDirectorAssetFile(root, 'director-skill-core', 'smuggled.txt'))
      .rejects.toThrow('director_asset_file_not_admitted')
    await expect(loadDirectorAssetFile(root, 'director-skill-core', 'ADMISSION.md'))
      .rejects.toThrow('director_asset_file_not_provenanced')
  })

  it('rejects a tampered body under a matching path', async () => {
    const target = join(pkg, 'assets/qc-checklist.md')
    const original = await (await import('node:fs/promises')).readFile(target, 'utf8')
    await writeFile(target, `${original}\ntampered`)
    await expect(loadDirectorAssetFile(root, 'director-skill-core', 'assets/qc-checklist.md'))
      .rejects.toThrow('director_asset_sha256_mismatch')
    await writeFile(target, original)
  })
})
