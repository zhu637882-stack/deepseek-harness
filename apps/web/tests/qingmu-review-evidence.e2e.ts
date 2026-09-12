/** Exercise persisted advisory evidence in the running Qingmu application without paid calls. */
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'

const url = process.env.QINGMU_REVIEW_UI_URL
const storageState = process.env.QINGMU_REVIEW_STORAGE_STATE
const assetId = process.env.QINGMU_REVIEW_ASSET_ID
const assetSha = process.env.QINGMU_REVIEW_ASSET_SHA
const shot = process.env.QINGMU_REVIEW_SHOT
const version = process.env.QINGMU_REVIEW_VERSION

describe.skipIf(!url || !storageState || !assetId || !assetSha || !shot || !version)('live candidate evidence', () => {
  it('restores exact evidence and seeks its verified video without submitting or adopting', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    try {
      const context = await browser.newContext({ storageState: storageState!, viewport: { width: 1440, height: 1000 } })
      const page = await context.newPage()
      page.setDefaultTimeout(20000)
      const errors: string[] = [], writes: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/qingmu/native-video-review?*', async (route) => {
        if (route.request().method() === 'GET') await route.continue()
        else { writes.push('review'); await route.abort() }
      })
      await page.route('**/api/session.prompt', async (route) => { writes.push('model'); await route.abort() })
      const mutation = /\/qingmu-yimeng-command\/(queueReferenceVideo|selectTakeVersion|generateAssetImage|generateAssetVoice)$/
      await page.route(mutation, async (route) => {
        writes.push(new URL(route.request().url()).pathname); await route.abort()
      })
      await page.goto(url!)
      await page.getByRole('button', { name: new RegExp(`^镜 ${shot} `) }).click()
      await page.getByRole('button', { name: new RegExp(`视频候选 v${version}`) }).click()
      const region = page.getByRole('region', { name: '候选音画检查' })
      const read = page.waitForResponse((response) => {
        const target = new URL(response.url())
        return target.pathname === '/api/qingmu/native-video-review' && target.searchParams.get('assetId') === assetId
      })
      await region.getByRole('button', { name: '刷新记录' }).click()
      const data = await (await read).json() as {
        state: string
        assetSha256: string
        methodChanged: boolean
        visualEvidence: { observations: { start_sec: number; end_sec: number; description: string }[] }
      }
      expect(data.state).toBe('complete')
      expect(data.assetSha256).toBe(assetSha)
      expect(data.methodChanged).toBe(false)
      const first = data.visualEvidence.observations[0]
      expect(first).toBeDefined()
      expect(await region.getByText(first!.description, { exact: true }).count()).toBe(1)
      const video = page.getByLabel(new RegExp(`${assetId}$`))
      await page.waitForFunction((id) => {
        const v = Array.from(document.querySelectorAll('video')).find(v => v.getAttribute('aria-label')?.endsWith(id))
        return !!v && v.readyState >= 2
      }, assetId!)
      await region.getByRole('button', { name: `查看 ${first!.start_sec} 至 ${first!.end_sec} 秒`, exact: true }).first().click()
      const playback = await video.evaluate((node) => {
        const player = node as HTMLVideoElement
        return { time: player.currentTime, paused: player.paused, label: player.getAttribute('aria-label') }
      })
      expect(playback.label).toContain(assetId)
      expect(playback.time).toBeCloseTo(first!.start_sec, 1)
      expect(playback.paused).toBe(true)
      expect(errors).toEqual([])
      expect(writes).toEqual([])
    } finally { await browser.close() }
  }, 90000)
})
