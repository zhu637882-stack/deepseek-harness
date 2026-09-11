/** Read-only, keyless check against an already running authenticated Qingmu app.
 * Set QINGMU_SETTINGS_UI_URL and QINGMU_SETTINGS_STORAGE_STATE; no project is created.
 */
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'

const url = process.env.QINGMU_SETTINGS_UI_URL
const storageState = process.env.QINGMU_SETTINGS_STORAGE_STATE
describe.skipIf(!url || !storageState)('live Qingmu style composition', () => {
  it('shows the exact selected backend guidance and clears a cross-medium pack without generation', async () => {
    if (!url || !storageState) throw new Error('Qingmu live UI and authenticated storage are required')
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    try {
      const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors: string[] = [], writes: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/session.prompt', async (route) => { writes.push('model'); await route.abort() })
      const mutation = new RegExp('/qingmu-yimeng-command/(initializeProject|generateAssetImage|generateAssetVoice'
        + '|queueReferenceVideo|saveScenePlanning|saveAssetDesign|confirmTextImport)$')
      await page.route(mutation, async (route) => {
        writes.push(new URL(route.request().url()).pathname); await route.abort()
      })
      await page.goto(new URL('/?qingmuView=projects', url).href)
      await page.getByRole('button', { name: '＋ 新建作品', exact: true }).click()
      const style = page.getByRole('combobox', { name: '基础画风', exact: true })
      const pack = page.getByRole('combobox', { name: '全片风格包', exact: true })
      await page.getByRole('option', { name: /黑白经典电影风格/ }).waitFor({ state: 'attached' })
      const transcript: string[] = []
      for (const [styleId, packId] of [
        ['real_person_classic_bw', 'sp_urban_emotion_realistic'], ['2d_watercolor', 'sp_2d_cyber_neon'],
      ] as const) {
        await style.selectOption(styleId)
        if (styleId === '2d_watercolor') expect(await pack.inputValue()).toBe('')
        const response = page.waitForResponse(response => response.url().endsWith('/qingmu-yimeng-command/readStyleComposition'))
        await pack.selectOption(packId)
        const payload = await (await response).json() as {
          result: { ok: boolean; value: { effectivePrompt: string; adjustments: string[] } }
        }
        expect(payload.result.ok).toBe(true)
        const region = page.getByRole('region', { name: '风格搭配结果', exact: true })
        await region.getByText('查看实际采用的风格描述', { exact: true }).click()
        expect(await region.locator('pre').innerText()).toBe(payload.result.value.effectivePrompt)
        await region.locator('summary').filter({ hasText: '查看调整的预设建议' }).click()
        expect(await region.getByRole('listitem').allTextContents()).toEqual(payload.result.value.adjustments)
        if (styleId === '2d_watercolor') expect(payload.result.value.effectivePrompt).not.toContain('霓虹')
        transcript.push(JSON.stringify({ prompt: await region.locator('pre').innerText(),
          adjustments: await region.getByRole('listitem').allTextContents() }))
      }
      await expect(JSON.stringify({ transcript, errors, writes }, null, 2) + '\n')
        .toMatchFileSnapshot('./snapshots/qingmu-style-composition/expected.json')
      expect(errors).toEqual([])
      expect(writes).toEqual([])
    } finally { await browser.close() }
  }, 60000)
})
