/** Verify original native design recovery in the running app without saving or generating. */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'

const casesFile = process.env.QINGMU_ASSET_DESIGN_CASES
interface DesignCase {
  label: string
  url: string
  storageState: string
  expectedJson: string
  repaired: boolean
}
describe.skipIf(!casesFile)('live native asset design recovery', () => {
  it('loads completed text and JSON replies into cards without resending or saving', async () => {
    const cases = JSON.parse(readFileSync(casesFile!, 'utf8')) as DesignCase[]
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    const transcript: unknown[] = []
    try {
      for (const item of cases) {
        const context = await browser.newContext({ storageState: item.storageState })
        const page = await context.newPage()
        page.setDefaultTimeout(15000)
        const errors: string[] = [], writes: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route(/\/api\/session.prompt$|\/qingmu-yimeng-command\/(saveAssetDesign|generateAssetImage)$/, async (route) => {
          writes.push(new URL(route.request().url()).pathname); await route.abort()
        })
        await page.goto(item.url, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: '采用到素材卡片', exact: true }).click({ timeout: 30000 })
        const expected = JSON.parse(readFileSync(item.expectedJson, 'utf8')) as {
          assets: { name: string; imagePrompt: string; designBasis: string; visualIdentity: string }[]
        }
        for (const asset of expected.assets) {
          const card = page.getByRole('region', { name: `场景 ${asset.name}`, exact: true })
          expect(await card.getByLabel(/^画面描述/).inputValue()).toBe(asset.imagePrompt)
          expect(await card.getByLabel(/^设计依据/).inputValue()).toBe(asset.designBasis)
          expect(await card.getByLabel(/^主体完整设定/).inputValue()).toBe(asset.visualIdentity)
          const frameOption = card.getByRole('checkbox', { name: '以完整画面描述出图' })
          expect(await frameOption.isChecked()).toBe(false)
          await frameOption.check()
          expect(await frameOption.isChecked()).toBe(true)
          expect(await card.getByLabel(/^画面描述/).inputValue()).toBe(asset.imagePrompt)
          expect(await card.getByLabel(/^设计依据/).inputValue()).toBe(asset.designBasis)
        }
        expect(await page.getByText(/已修正正文引号的格式/).count()).toBe(item.repaired ? 1 : 0)
        expect(await page.getByRole('button', { name: '保存素材设计', exact: true }).isEnabled()).toBe(true)
        transcript.push({ label: item.label, assets: expected.assets.length,
          repaired: item.repaired, frameScopeEditable: true, errors, writes })
        expect(errors).toEqual([]); expect(writes).toEqual([])
        await context.close()
      }
      await expect(JSON.stringify(transcript, null, 2) + '\n')
        .toMatchFileSnapshot('./snapshots/qingmu-asset-design-recovery/expected.json')
    } finally { await browser.close() }
  }, 90000)
})
