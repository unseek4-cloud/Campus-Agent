import { loginContext } from './auth.helpers.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Uses an existing Playwright installation; this is a real-service, opt-in acceptance script.
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const baseUrl = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5173'
const output = new URL('../../../tmp/service-progress-v11/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
await loginContext(context, baseUrl, 'STUDENT')
const page = await context.newPage()
page.setDefaultTimeout(100_000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
let apiCalls = 0
page.on('request', request => { if (request.url().includes('/api/')) apiCalls++ })
const key = 'campusagent:service-progress:'
async function ask(question) {
  await page.locator('textarea').fill(question)
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/rag/chat') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const response = await responsePromise
  assert.equal(response.status(), 200)
  const data = (await response.json()).data
  await page.locator('.pending-answer').waitFor({ state: 'hidden' })
  return data
}
async function state(code) { return page.evaluate(k => JSON.parse(localStorage.getItem(k)), key + code) }
async function readyClick(locator) {
  await page.waitForFunction(() => [...document.querySelectorAll('.service-guide button')].every(button => !button.textContent.includes('完成本步骤') || !button.disabled))
  await locator.click()
}
try {
  await page.goto(baseUrl + '/knowledge/search')
  const guide = await ask('心理测评怎么操作？')
  assert.equal(guide.type, 'SERVICE_GUIDE'); assert.equal(guide.service.code, 'PSYCHOLOGICAL_ASSESSMENT')
  assert.equal(guide.steps.length, 4)
  const card = page.locator('.service-guide').last()
  assert.equal(await card.locator('li.current').count(), 1)
  assert.equal(await card.locator('.current-step-panel h4').innerText(), guide.steps[0].title)
  assert.equal(await card.getByRole('button', { name: '上一步', exact: true }).isDisabled(), true)
  const beforeClicks = apiCalls
  if (await card.locator('.material-item input').count()) await card.locator('.material-item input').first().check()
  await card.getByRole('button', { name: '完成本步骤，进入下一步', exact: true }).dblclick()
  assert.equal((await state(guide.service.code)).currentStep, 2)
  assert.equal(await card.locator('.current-step-panel h4').innerText(), guide.steps[1].title)
  assert.equal(await card.getByRole('progressbar').getAttribute('aria-valuenow'), '25')
  await page.waitForTimeout(550)
  await card.getByRole('button', { name: '上一步', exact: true }).click()
  assert.equal((await state(guide.service.code)).currentStep, 1)
  assert.deepEqual((await state(guide.service.code)).completedSteps, [])
  for (let i = 0; i < 4; i++) await readyClick(card.getByRole('button', { name: /^完成本步骤/ }))
  await card.locator('.completion-panel').waitFor()
  assert.match(await card.innerText(), /办理引导已完成/)
  assert.equal(await card.getByRole('progressbar').getAttribute('aria-valuenow'), '100')
  assert.equal(apiCalls, beforeClicks, 'Navigation and materials must not request API or LLM')
  await card.screenshot({ path: fileURLToPath(new URL('completed.png', output)) })
  const saved = await state(guide.service.code)
  await page.reload(); await ask('心理测评怎么操作？')
  assert.equal((await state(guide.service.code)).completed, true)
  assert.deepEqual((await state(guide.service.code)).checkedMaterials, saved.checkedMaterials)
  await card.locator('.completion-panel').waitFor()
  await card.getByRole('button', { name: '重新开始流程', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await state(guide.service.code)).completed, true)
  await card.getByRole('button', { name: '重新开始流程', exact: true }).click()
  await page.getByRole('button', { name: '重新开始', exact: true }).click()
  assert.equal((await state(guide.service.code)).currentStep, 1)
  assert.deepEqual((await state(guide.service.code)).completedSteps, [])
  await card.getByRole('button', { name: /^完成本步骤/ }).click()
  await page.waitForTimeout(550)
  await card.screenshot({ path: fileURLToPath(new URL('current-step.png', output)) })
  const repair = await ask('宿舍灯坏了怎么报修？')
  assert.equal(repair.service.code, 'DORM_REPAIR')
  assert.equal((await state('DORM_REPAIR')).currentStep, 1)
  assert.equal((await state(guide.service.code)).currentStep, 2)
  const qa = await ask('学校心理咨询中心在哪里？')
  assert.equal(qa.type, 'QA')
  assert.equal(await page.locator('.assistant-message').last().locator('.service-guide, [role="progressbar"], .current-step-panel').count(), 0)
  console.log('PASS real services: progression, double-click, previous, completion, refresh, reset cancel/confirm, separate services, QA isolation; aiEnhanced=' + guide.aiEnhanced)

  // Repeated cards share the same in-memory state, including after going back.
  await ask('心理测评怎么操作？')
  const psycheCards = page.locator('.service-guide').filter({ has: page.getByRole('heading', { name: '心理测评', exact: true }) })
  await psycheCards.last().getByRole('button', { name: /^完成本步骤/ }).click()
  assert.equal(await psycheCards.first().getByRole('progressbar').getAttribute('aria-valuenow'), '50')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await psycheCards.last().screenshot({ path: fileURLToPath(new URL('mobile.png', output)) })
  await page.setViewportSize({ width: 1280, height: 1100 })
  const storedBeforeAdmin = await page.evaluate(() => JSON.stringify(localStorage))
  await page.goto(baseUrl + '/admin/services')
  await page.getByRole('button', { name: '心理测评', exact: true }).click()
  await page.locator('.el-drawer .service-guide').waitFor()
  assert.equal(await page.locator('.el-drawer .current-step-panel, .el-drawer [role="progressbar"]').count(), 0)
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storedBeforeAdmin)
  await page.getByRole('button', { name: 'Close this dialog' }).click()
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  const firstTitle = await page.locator('.step-editor input').first().inputValue()
  await page.getByRole('button', { name: '下移', exact: true }).first().click()
  assert.notEqual(await page.locator('.step-editor input').first().inputValue(), firstTitle)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  console.log('PASS real browser: repeated cards synchronized, mobile layout, admin read-only preview and reorder editor')

  // Controlled response fixtures exercise boundaries without mutating school definitions.
  let fixture = structuredClone(guide)
  fixture.service.code = 'PROGRESS_BROWSER_FIXTURE'
  fixture.service.materials = [{ name: '测试材料', required: true, description: null }]
  fixture.steps = []
  await page.route('**/api/rag/chat', route => route.fulfill({ json: { code: 'OK', data: fixture } }))
  await page.goto(baseUrl + '/knowledge/search'); await ask('边界验收')
  assert.match(await card.innerText(), /当前事项暂未配置具体办理步骤/)
  assert.equal(await card.locator('button, [role="progressbar"]').count(), 0)
  fixture.steps = [10, 20, 30].map((order, i) => ({ ...guide.steps[i], order }))
  await ask('非连续步骤验收')
  assert.equal((await state(fixture.service.code)).currentStep, 10)
  await card.locator('.material-item input').check()
  assert.deepEqual((await state(fixture.service.code)).completedSteps, [])
  await page.reload(); await ask('恢复材料验收')
  assert.equal(await card.locator('.material-item input').isChecked(), true)
  await card.getByRole('button', { name: /^完成本步骤/ }).click()
  assert.equal((await state(fixture.service.code)).currentStep, 20)
  fixture.service.version++
  await ask('版本更新验收')
  assert.match(await card.innerText(), /该办事流程已更新/)
  assert.equal((await state(fixture.service.code)).currentStep, 10)
  fixture.steps = [fixture.steps[0]]
  fixture.service.code = 'PROGRESS_SINGLE_STEP'
  fixture.steps[0] = { ...fixture.steps[0], description: null, responsibleDepartment: null, location: null, estimatedTime: null, requiredMaterials: [] }
  await ask('单步骤验收')
  assert.match(await card.locator('.current-step-panel').innerText(), /暂未提供/)
  assert.match(await card.locator('.current-step-panel').innerText(), /本步骤暂无额外材料要求/)
  await card.getByRole('button', { name: '完成本步骤', exact: true }).click()
  assert.equal((await state(fixture.service.code)).completed, true)
  await page.evaluate(k => localStorage.setItem(k, '{invalid JSON'), key + fixture.service.code)
  await page.reload(); await ask('损坏缓存验收')
  assert.equal((await state(fixture.service.code)).completed, false)
  const deniedContext = await browser.newContext()
  try {
    const denyStorage = () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError') } })
    }
    // Vue Router's development devtools read storage during bootstrap. In development
    // deny it after bootstrap; the production run also verifies denial before bootstrap.
    if (process.env.TEST_PRODUCTION === '1') await deniedContext.addInitScript(denyStorage)
    const denied = await deniedContext.newPage()
    denied.on('pageerror', error => errors.push(error.message))
    await denied.route('**/api/rag/chat', route => route.fulfill({ json: { code: 'OK', data: fixture } }))
    await denied.goto(baseUrl + '/knowledge/search')
    await denied.locator('textarea').waitFor()
    if (process.env.TEST_PRODUCTION !== '1') await denied.evaluate(denyStorage)
    await denied.locator('textarea').fill('存储不可用验收')
    await denied.getByRole('button', { name: '发送', exact: true }).click()
    await denied.locator('.current-step-panel').waitFor()
    assert.match(await denied.locator('.service-guide').innerText(), /浏览器本地保存暂不可用/)
    await denied.getByRole('button', { name: '完成本步骤', exact: true }).click()
    await denied.locator('.completion-panel').waitFor()
  } finally { await deniedContext.close() }
  console.log('PASS response fixtures: zero steps, nonconsecutive orders, material persistence, version reset, single step, missing fields, corrupted and unavailable storage')
  assert.deepEqual(errors, [])
  console.log('PASS no browser runtime errors; screenshots: ' + fileURLToPath(output))
} finally { await browser.close() }
