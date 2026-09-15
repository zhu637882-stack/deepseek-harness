/** Recover real scene feedback through the running asset UI without any model or business write. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'

const casesFile = process.env.QINGMU_SCENE_FEEDBACK_CASES
interface FeedbackCase { label: string; url: string; storageState: string; issues: number; artifactsDir?: string }
async function openScene(page: Page) {
  for (const name of ['场景规划与导演助手', '统筹本场已有镜头']) {
    const details = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: name }) })
    await details.waitFor()
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  }
  return page.getByRole('region', { name: '整场导演协调稿', exact: true })
}
describe.skipIf(!casesFile)('live scene feedback recovery', () => {
  it('carries completed feedback automatically, preserves supplements and returns to the original scene draft', async () => {
    const cases = JSON.parse(readFileSync(casesFile!, 'utf8')) as FeedbackCase[]
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    const transcript: unknown[] = []
    try {
      for (const item of cases) {
        const context = await browser.newContext({ storageState: item.storageState, viewport: { width: 1440, height: 1100 } })
        const page = await context.newPage()
        page.setDefaultTimeout(25000)
        const errors: string[] = [], writes: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route(/\/api\/session.prompt$|\/qingmu-yimeng-command\/(save|generate)[^/]*$/, async (route) => {
          writes.push(new URL(route.request().url()).pathname); await route.abort()
        })
        await page.goto(item.url, { waitUntil: 'domcontentloaded' })
        const composer = await openScene(page)
        const problems = composer.getByRole('region', { name: '导演待核对问题' })
        await problems.waitFor()
        expect(await problems.locator('li').count()).toBe(item.issues)
        const original = await composer.locator('pre').textContent()
        await problems.getByRole('link', { name: '带着问题去素材设计' }).click()
        await page.waitForURL('**qingmuView=assets**', { waitUntil: 'domcontentloaded' })
        const feedback = page.getByRole('region', { name: '整场导演反馈' })
        await feedback.waitFor()
        expect(await feedback.locator('li').count()).toBe(item.issues)
        const instructions = page.getByRole('textbox', { name: '创作补充', exact: true })
        const previous = await instructions.inputValue()
        expect(await feedback.getByRole('button', { name: '加入创作补充' }).count()).toBe(0)
        expect(await feedback.textContent()).toContain('下一次素材设计请求自动交给导演核对')
        expect(await instructions.inputValue()).toBe(previous)
        await page.reload({ waitUntil: 'domcontentloaded' })
        expect(await instructions.inputValue()).toBe(previous)
        expect(await feedback.locator('li').count()).toBe(item.issues)
        if (item.artifactsDir) {
          mkdirSync(item.artifactsDir, { recursive: true })
          await feedback.scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${item.artifactsDir}/scene-feedback.png` })
        }
        await instructions.fill(previous)
        await feedback.getByRole('link', { name: '返回分镜协调' }).click()
        await page.waitForURL('**qingmuView=storyboard**', { waitUntil: 'domcontentloaded' })
        const returned = await openScene(page)
        await returned.locator('pre').waitFor({ state: 'attached' })
        expect(await returned.locator('pre').textContent()).toBe(original)
        expect(await returned.getByRole('region', { name: '导演待核对问题' }).locator('li').count()).toBe(item.issues)
        expect(errors).toEqual([]); expect(writes).toEqual([])
        const result = { label: item.label, issues: item.issues, recoveredInstructions: true, originalRetained: true, errors, writes }
        transcript.push(result)
        if (item.artifactsDir) writeFileSync(`${item.artifactsDir}/scene-feedback-result.json`, JSON.stringify(result, null, 2))
        await context.close()
      }
      await expect(JSON.stringify(transcript, null, 2) + '\n').toMatchFileSnapshot('./snapshots/qingmu-scene-feedback/expected.json')
    } finally { await browser.close() }
  }, 90000)
})
