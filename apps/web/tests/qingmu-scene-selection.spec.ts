/** Keyless UI transcript against the normal qingmu-local launcher and a saved test project.
 * QINGMU_SELECTION_URL selects a scene with at least three saved shots; storage contains login only.
 * No model prompt, business save or media request is sent. Local unsaved input is restored on exit.
 */
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

const url = process.env.QINGMU_SELECTION_URL
const storageState = process.env.QINGMU_SELECTION_STORAGE_STATE

it.skipIf(!url || !storageState)('keeps the assembled director, editor and shot strip on one selection', async () => {
  const channel = process.env.QINGMU_BROWSER_CHANNEL
  const browser = await chromium.launch(channel ? { channel } : {})
  const context = await browser.newContext({ storageState: storageState!, viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(15000)
  const forbidden: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /session\.prompt|saveScenePlanning|submit.*Generation/iu.test(request.url())) forbidden.push(new URL(request.url()).pathname)
  })
  const parsed = new URL(url!)
  const key = `qingmu.scene-planning.v1:${parsed.searchParams.get('qingmuProject')}:${parsed.searchParams.get('qingmuEpisode')}`
  let original: string | null = null
  try {
    await page.goto(url!, { waitUntil: 'domcontentloaded' })
    const strip = page.getByRole('navigation', { name: '当前场景镜头', exact: true })
    await strip.waitFor()
    original = await page.evaluate(k => localStorage.getItem(k), key)
    const enter = page.getByRole('button', { name: '进入 / 恢复青木导演', exact: true })
    if (await enter.isVisible()) await enter.click()
    await page.getByText('场景规划与导演助手', { exact: true }).click()
    const planning = page.getByRole('region', { name: '场景与镜头规划', exact: true })
    const title = planning.getByLabel('镜头名称', { exact: true })
    const scope = planning.locator('dt').filter({ hasText: '场景 / 镜头' }).locator('xpath=following-sibling::dd[1]')
    const binding = planning.getByRole('status').filter({ hasText: '最近一次镜头上下文同步成功' })
    const third = strip.getByRole('button').nth(2)
    const thirdTitle = await third.locator('span').innerText()
    await third.click()
    await expect.poll(() => title.inputValue()).toBe(thirdTitle)
    await binding.waitFor()
    const thirdScope = await scope.innerText()
    const shots = planning.getByRole('navigation', { name: '剧本场景与规划镜头', exact: true })
    const first = shots.getByRole('button', { name: /^01 ·/u })
    const firstTitle = await strip.getByRole('button').first().locator('span').innerText()
    await first.click()
    await expect.poll(() => strip.getByRole('button').first().getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => title.inputValue()).toBe(firstTitle)
    await binding.waitFor()
    await expect.poll(() => scope.innerText()).not.toBe(thirdScope)
    const firstScope = await scope.innerText()
    await title.fill(firstTitle + ' · 本地未保存校验')
    await third.click()
    const notice = page.getByRole('status').filter({ hasText: '请先保存或恢复下方正在编辑的分镜，再切换镜头。' })
    await notice.waitFor()
    expect({
      topSelectionReachedEditor: thirdTitle.length > 0,
      editorSelectionReachedStrip: await strip.getByRole('button').first().getAttribute('aria-pressed'),
      unsavedTitle: (await title.inputValue()).slice(firstTitle.length),
      unsavedSelectionRetained: await scope.innerText() === firstScope,
      notice: await notice.innerText(),
      modelOrBusinessWrites: forbidden,
    }).toMatchInlineSnapshot(`
      {
        "editorSelectionReachedStrip": "true",
        "modelOrBusinessWrites": [],
        "notice": "请先保存或恢复下方正在编辑的分镜，再切换镜头。",
        "topSelectionReachedEditor": true,
        "unsavedSelectionRetained": true,
        "unsavedTitle": " · 本地未保存校验",
      }
    `)
  } finally {
    if (page.url().startsWith(parsed.origin)) await page.evaluate(({ k, value }) => {
      if (value === null) localStorage.removeItem(k)
      else localStorage.setItem(k, value)
    }, { k: key, value: original })
    await browser.close()
  }
}, 60000)
