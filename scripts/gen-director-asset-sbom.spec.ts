import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { renderDirectorAssetSbom } from './gen-director-asset-sbom.ts'

it('keeps the inactive source inventory bound to every admitted file and license', async () => {
  const expected = await renderDirectorAssetSbom()
  const path = resolve(import.meta.dirname, '../packages/experimental/qingmu-imago-method-adapter/DIRECTOR_ASSET_SBOM.json')
  expect(await readFile(path, 'utf8')).toBe(expected)
  const inventory = JSON.parse(expected) as { runtimeActivated: boolean; packages: unknown[] }
  expect(inventory.runtimeActivated).toBe(false)
  expect(inventory.packages).toHaveLength(8)
})
