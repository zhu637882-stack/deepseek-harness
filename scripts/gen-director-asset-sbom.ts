/** Generate the inactive Qingmu asset inventory from the registry and verified file ledgers. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DIRECTOR_ASSET_ENTRIES,
  verifyAllDirectorAssets,
} from '../packages/experimental/qingmu-imago-method-adapter/src/director-assets/registry.ts'

const root = resolve(import.meta.dirname, '..')
const packageRoot = resolve(root, 'packages/experimental/qingmu-imago-method-adapter')
const output = resolve(packageRoot, 'DIRECTOR_ASSET_SBOM.json')

/**
 * Render the deterministic source inventory; no third-party code is executed.
 * @returns repository-specific SBOM JSON after all pinned byte checks pass.
 */
export async function renderDirectorAssetSbom(): Promise<string> {
  await verifyAllDirectorAssets(resolve(packageRoot, 'assets'))
  const packages = await Promise.all(DIRECTOR_ASSET_ENTRIES.map(async (entry) => {
    const base = `assets/director/${entry.repoId}/${entry.commit}`
    const ledger = await readFile(resolve(packageRoot, base, 'PROVENANCE.sha256'), 'utf8')
    return {
      repoId: entry.repoId, repository: entry.repoUrl, commit: entry.commit,
      license: entry.license, licenseFile: `${base}/LICENSE`,
      admissionAndModifications: `${base}/ADMISSION.md`,
      provenanceSha256: entry.provenanceSha256,
      files: ledger.trimEnd().split('\n').map(line => ({
        path: `${base}/${line.slice(66)}`, sha256: line.slice(0, 64),
      })),
    }
  }))
  return `${JSON.stringify({
    schema: 'qingmu.inactive-director-asset-sbom.v1',
    runtimeActivated: false,
    packages,
  }, null, 2)}\n`
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const content = await renderDirectorAssetSbom()
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== content) {
      throw new Error('Director asset SBOM is stale; run pnpm exec tsx scripts/gen-director-asset-sbom.ts')
    }
    console.log('director asset SBOM: verified')
  } else {
    await writeFile(output, content)
    console.log('director asset SBOM: written')
  }
}
