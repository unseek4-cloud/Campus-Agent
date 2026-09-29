import { loginContext } from './auth.helpers.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const baseUrl = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5173'
const output = new URL('../../../tmp/query-intent/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await loginContext(context, baseUrl, 'STUDENT')
const page = await context.newPage()
page.setDefaultTimeout(120_000)
const errors = [], report = []
page.on('pageerror', error => errors.push(error.message))
const qa = [
  '体测不及格可以申请奖学金吗？', '奖学金申请条件是什么？', '我的体测只有58分，还能评奖学金吗？',
  '奖学金什么时候截止？', '补办学生证收费吗？', '学生证补办需要多少钱？', '心理测评必须参加吗？',
  '宿舍报修收费吗？', '我这种情况符合申请条件吗？', '奖学金对成绩有什么要求？',
]
const guides = [
  '奖学金怎么申请？', '我要申请奖学金', '奖学金申请流程是什么？', '申请奖学金需要准备哪些材料？',
  '学生证丢了怎么补办？', '学生证补办流程是什么？', '宿舍灯坏了怎么报修？', '心理测评怎么操作？',
  '心理测评在哪里做？', '告诉我奖学金申请的具体步骤',
]
async function ask(question) {
  if (await page.locator('.assistant-message').count()) await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.locator('textarea').fill(question)
  const pending = page.waitForResponse(r => r.url().endsWith('/api/rag/chat') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const response = await pending
  assert.equal(response.status(), 200, question)
  const data = (await response.json()).data
  await page.locator('.assistant-message').waitFor()
  await page.locator('.pending-answer').waitFor({ state: 'hidden' })
  return data
}
const savedProgress = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('campusagent:service-progress:'))))
try {
  await page.goto(baseUrl + '/knowledge/search')
  for (const question of qa) {
    const before = await savedProgress()
    const data = await ask(question)
    report.push({ question, ...data })
    assert.equal(data.type, 'QA', question)
    assert.equal(await page.locator('.service-guide').count(), 0, question)
    assert.deepEqual(await savedProgress(), before, 'QA must not change progress')
    if (question === qa[0]) {
      assert.equal(data.relatedService?.code, 'SCHOLARSHIP_APPLICATION')
      assert.equal(data.queryIntent, 'ELIGIBILITY_QA')
      assert.ok(data.usedContextCount > 0)
      assert.match(data.answer, /60/)
      assert.match(data.answer, /不得|不能|不符合|无法|不可以/)
      assert.ok(data.sources.some(source => /60/.test(source.content) && /体质|体测/.test(source.content)), 'Must cite retrieved physical-test policy')
      await page.screenshot({ path: fileURLToPath(new URL('eligibility-qa.png', output)), fullPage: true })
    }
    console.log(`PASS QA: ${question} (${data.queryIntent})`)
  }
  let guide
  for (const question of guides) {
    const data = await ask(question)
    report.push({ question, ...data })
    assert.equal(data.type, 'SERVICE_GUIDE', question)
    assert.equal(data.queryIntent, 'SERVICE_GUIDE')
    await page.locator('.service-guide').waitFor()
    assert.ok(data.steps.length > 0)
    if (!guide) {
      guide = data
      await page.screenshot({ path: fileURLToPath(new URL('scholarship-guide.png', output)), fullPage: true })
    }
    console.log(`PASS SERVICE_GUIDE: ${question}`)
  }

  // Real LLM fallback: this paraphrase deliberately does not match the Java guide patterns.
  const semantic = await context.request.post(baseUrl + '/api/services/recognize', {
    data: { query: '请带着我把奖学金的申报手续一步一步走完' }, timeout: 30_000,
  })
  assert.equal(semantic.status(), 200)
  const semanticResult = (await semantic.json()).data
  assert.equal(semanticResult.serviceCode, 'SCHOLARSHIP_APPLICATION')
  assert.equal(semanticResult.queryIntent, 'SERVICE_GUIDE')
  report.push({ semanticFallback: semanticResult })
  console.log('PASS live Qwen structured semantic fallback')

  const unrelated = await context.request.post(baseUrl + '/api/services/recognize', {
    data: { query: '宿舍怎么申请入住？' }, timeout: 30_000,
  })
  assert.equal(unrelated.status(), 200)
  const unrelatedResult = (await unrelated.json()).data
  assert.equal(unrelatedResult.matched, false, 'Housing application must not match dorm repair')
  report.push({ unrelatedProcedure: unrelatedResult })
  console.log('PASS broad dorm topic does not match the repair workflow')

  // Deliberately malformed QA payloads must never mount a card or initialize/update progress.
  const before = await savedProgress()
  let fixture
  // Mock both endpoints at the same API boundary now that the page reads saved messages.
  let fixtureConversationId
  await page.route('**/api/rag/chat', route => {
    fixtureConversationId = route.request().postDataJSON().conversationId
    return route.fulfill({ json: { code: 'OK', data: { ...fixture, conversationId: fixtureConversationId, userMessageId: 1, assistantMessageId: 2 } } })
  })
  await page.route('**/api/chat/conversations/*/messages', route => {
    if (!fixture || !route.request().url().endsWith(`/${fixtureConversationId}/messages`)) return route.continue()
    return route.fulfill({ json: { code: 'OK', data: { pending: false, messages: [
      { id: 1, role: 'USER', content: 'QA 响应卡片隔离测试', response: null },
      { id: 2, role: 'ASSISTANT', content: fixture.answer, response: fixture },
    ] } } })
  })
  for (const extra of [
    { serviceCode: guide.service.code, relatedService: { code: guide.service.code, name: guide.service.name } },
    { service: guide.service, steps: guide.steps, queryIntent: 'SERVICE_GUIDE' },
    { service: { ...guide.service, code: 'QA_MUST_NOT_CREATE_PROGRESS' }, steps: guide.steps },
  ]) {
    fixture = { ...guide, type: 'QA', service: null, steps: [], answer: 'QA 关联事项防御测试', ...extra }
    await ask('QA 响应卡片隔离测试')
    assert.equal(await page.locator('.service-guide, .current-step-panel, [role="progressbar"]').count(), 0)
    assert.deepEqual(await savedProgress(), before)
  }
  assert.deepEqual(errors, [])
  console.log('PASS QA with relatedService/serviceCode/service/steps cannot render guide or mutate localStorage')
} finally {
  await writeFile(new URL('results.json', output), JSON.stringify(report, null, 2))
  await browser.close()
}
