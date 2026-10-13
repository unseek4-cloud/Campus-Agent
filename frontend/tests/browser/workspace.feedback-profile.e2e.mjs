import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const output = new URL('../../../tmp/feedback-profile/', import.meta.url)
await mkdir(output, { recursive: true })
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
async function fixture(role, { emptyProfile = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const state = { loggedIn: false, feedback: null, fail: false, writes: 0, historyReads: 0 }, errors = []
  const user = { id: role === 'ADMIN' ? 2 : 1, role, username: role === 'ADMIN' ? 'admin' : '20260001', displayName: role === 'ADMIN' ? '系统管理员' : '张三',
    studentNo: role === 'ADMIN' ? null : '20260001', department: role === 'ADMIN' ? '信息化建设与管理处' : '计算机学院', major: '软件工程', className: '软工2601班' }
  if (emptyProfile) { user.department = null; user.major = null; user.className = null }
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (url.hostname !== 'campus.test') return route.abort()
    if (path.startsWith('/api/')) {
      let status = 200, data = {}
      if (path === '/api/auth/me') { status = state.loggedIn ? 200 : 401; data = user }
      else if (path === '/api/auth/csrf') data = { token: 'test', headerName: 'X-XSRF-TOKEN' }
      else if (path === '/api/auth/login') { state.loggedIn = true; data = { success: true, user } }
      else if (path === '/api/auth/logout') state.loggedIn = false
      else if (path === '/api/chat/conversations') data = [{ id: 10, title: '奖学金申请条件', updatedAt: '2026-10-13T10:00:00' }]
      else if (path === '/api/chat/conversations/10/messages') { state.historyReads++; data = { pending: false, messages: [
        { id: 200, role: 'USER', content: '奖学金申请条件是什么？' },
        { id: 201, role: 'ASSISTANT', content: '请查看学校最新奖学金通知。', response: { type: 'QA', sources: [] }, feedback: state.feedback }] } }
      else if (path === '/api/chat/messages/201/feedback') {
        state.writes++
        if (state.fail) { status = 503; state.fail = false }
        else { state.feedback = method === 'DELETE' ? null : { ...route.request().postDataJSON(), updatedAt: '2026-10-13T10:00:00' }; data = state.feedback }
      }
      else if (path === '/api/admin/ai-quality/summary') data = { total: 1, negative: 1, positive: 0, positiveRate: 0, accessScope: 'ALL', trend: [] }
      else if (path === '/api/admin/ai-quality/feedback') data = { total: 1, items: [{ id: 1, question: '奖学金申请条件是什么？', answer: '请查看最新通知。', ...state.feedback, issueType: 'UNCLASSIFIED', handlingStatus: 'OPEN', version: 0 }] }
      else if (path === '/api/admin/overview') data = { total: 0, success: 0, failed: 0, processing: 0, recentDocuments: [] }
      else if (path.startsWith('/api/admin/documents') || path.endsWith('/applications')) data = { items: [], total: 0 }
      else if (path === '/api/services') data = []
      else if (path === '/api/v1/health') data = { status: 'UP' }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'TEST_ERROR', message: status === 503 ? '测试保存失败' : '', data }) })
    }
    const file = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
    if (!/^(?:assets\/)?[\w.-]+\.(html|css|js)$/.test(file)) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: { html: 'text/html', js: 'text/javascript', css: 'text/css' }[file.split('.').at(-1)], body: await readFile(new URL('../../dist/' + file, import.meta.url)) })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, state, errors }
}
try {
  for (const role of ['STUDENT', 'ADMIN']) {
    const { context, page, state, errors } = await fixture(role)
    await page.goto('http://campus.test/')
    await page.locator('#loginBtn').waitFor()
    check(await page.getAttribute('html', 'data-theme') === 'light', role + ' login defaults to light')
    await page.locator('#loginUser').fill(role === 'ADMIN' ? 'admin' : '20260001')
    await page.locator('#loginPass').fill('test-password')
    await page.locator('#loginBtn').click()
    await page.locator('#userMenuToggle').waitFor()
    check(await page.getAttribute('html', 'data-theme') === 'light', role + ' home defaults to light without saved preference')
    check(await page.locator('#logoutBtn').count() === 0, 'logout appears only inside expanded menu')
    await page.locator('#userMenuToggle').click()
    await page.locator('#userMenu').waitFor()
    check((await page.locator('#userMenu').innerText()).includes(userText(role)), 'menu displays real account details')
    check(await page.locator('#logoutBtn').evaluate(el => {
      const [red, green, blue] = getComputedStyle(el).color.match(/\d+/g).map(Number)
      return red > green && red > blue
    }), 'logout text is red')
    await page.screenshot({ path: fileURLToPath(new URL(role + '-profile-light.png', output)) })
    await page.locator('#themeDark').click()
    check(await page.getAttribute('html', 'data-theme') === 'dark', 'menu changes theme')
    await page.screenshot({ path: fileURLToPath(new URL(role + '-profile-dark.png', output)) })
    await page.keyboard.press('Escape')
    check(await page.locator('#userMenu').count() === 0, 'Escape closes personal menu')
    await page.reload()
    await page.locator('#userMenuToggle').waitFor()
    check(await page.getAttribute('html', 'data-theme') === 'dark', 'explicit theme choice survives reload')
    if (role === 'ADMIN') await page.evaluate(() => CampusActions.navigate('qa'))
    await page.locator('.conv-main').first().click()
    const reply = page.locator('.msg.bot').first()
    await reply.locator('[data-act="feedback"]').waitFor()
    const openFeedback = async () => {
      await reply.locator('[data-act="feedback"]').click()
      await page.getByRole('menuitem', { name: '回复不佳', exact: true }).click()
      await page.getByRole('dialog', { name: '提交反馈' }).waitFor()
    }
    await openFeedback()
    check(await page.locator('.feedback-reason').count() === 7 && await page.locator('.feedback-submit').isDisabled(), 'seven causes and no empty submission')
    await page.locator('[data-reason="INCORRECT"]').click()
    await page.locator('[data-reason="OUTDATED"]').click()
    await page.locator('#feedbackComment').fill('引用通知过时，请核对 <script>内容</script>')
    await page.screenshot({ path: fileURLToPath(new URL(role + '-feedback-dark.png', output)) })
    await page.keyboard.press('Escape')
    check(state.writes === 0 && await reply.getAttribute('data-rating') === '', 'closing dialog does not submit or change rating')
    await openFeedback()
    await page.locator('[data-reason="NOT_HELPFUL"]').click()
    await page.locator('.feedback-submit').click()
    await page.locator('.feedback-overlay').waitFor({ state: 'detached' })
    check(state.feedback.comment === '' && state.feedback.reasons[0] === 'NOT_HELPFUL', 'reason-only submission succeeds')
    await openFeedback()
    check(await page.locator('[data-reason="NOT_HELPFUL"]').getAttribute('aria-pressed') === 'true', 'editing restores selected cause')
    await page.locator('#feedbackComment').fill('请核对 <script>内容</script>')
    state.fail = true
    await page.locator('.feedback-submit').click()
    await page.locator('.feedback-error').waitFor()
    check(state.feedback.comment === '' && await page.locator('#feedbackComment').inputValue() === '请核对 <script>内容</script>', 'save failure preserves saved feedback and draft')
    await page.locator('.feedback-submit').click()
    await page.locator('.feedback-overlay').waitFor({ state: 'detached' })
    check(state.feedback.comment.includes('<script>'), 'retry saves the optional explanation')
    await page.reload()
    await reply.locator('[data-act="feedback"].is-rated').waitFor()
    await openFeedback()
    check((await page.locator('#feedbackComment').inputValue()).includes('<script>'), 'refresh restores feedback details')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: fileURLToPath(new URL(role + '-feedback-mobile.png', output)) })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.feedback-dialog').scrollWidth <= document.querySelector('.feedback-dialog').clientWidth), 'mobile feedback fits')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('#userMenuToggle').click(); await page.locator('#themeLight').click(); await page.keyboard.press('Escape')
    await openFeedback()
    await page.screenshot({ path: fileURLToPath(new URL(role + '-feedback-light.png', output)) })
    await page.keyboard.press('Escape')
    if (role === 'ADMIN') {
      await page.evaluate(() => CampusActions.navigate('ai-quality'))
      await page.locator('.quality-user-feedback').waitFor()
      check((await page.locator('.quality-user-feedback').innerText()).includes('没有解决我的问题'), 'administrator sees user reasons')
      check(await page.locator('.quality-user-feedback script').count() === 0, 'explanations render as text')
    } else {
      await reply.locator('[data-act="more"]').click()
      await page.getByRole('menuitem', { name: '取消评价' }).click()
      await page.waitForFunction(() => !document.querySelector('.msg.bot').dataset.rating)
      check(state.feedback === null, 'more menu cancels negative feedback')
    }
    await page.locator('#sidebarToggle').click()
    await page.locator('#userMenuToggle').click()
    check(await page.locator('#userMenu').isVisible(), 'collapsed sidebar still opens personal menu')
    await page.keyboard.press('Escape')
    await page.locator('#sidebarToggle').click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#sidebarToggle').click()
    await page.locator('#userMenuToggle').click()
    await page.screenshot({ path: fileURLToPath(new URL(role + '-profile-mobile.png', output)) })
    check(await page.locator('#userMenu').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }), 'mobile personal menu fits')
    await page.locator('#themeDark').click()
    await page.locator('#logoutBtn').click()
    await page.locator('#loginBtn').waitFor()
    check(await page.getAttribute('html', 'data-theme') === 'light', 'logout returns to bright login even after choosing dark')
    check(errors.length === 0, role + ' has no runtime errors: ' + errors.join('; '))
    await context.close()
  }
  const student = await fixture('STUDENT', { emptyProfile: true })
  await student.context.addInitScript(() => localStorage.setItem('campusagent:last-conversation:1', '10'))
  await student.page.goto('http://campus.test/#/qa?conversation=10')
  const loginStudent = async () => {
    await student.page.locator('#loginUser').fill('20260001')
    await student.page.locator('#loginPass').fill('test-password')
    await student.page.locator('#loginBtn').click()
    await student.page.locator('#qaEmpty').waitFor({ state: 'visible' })
    await student.page.locator('.conv-main').first().waitFor()
  }
  await loginStudent()
  check(student.state.historyReads === 0 && new URL(student.page.url()).hash === '#/qa', 'student login ignores both stored history and old conversation URL')
  check(await student.page.locator('.msg').count() === 0, 'student starts in an empty new chat')
  await student.page.locator('#userMenuToggle').click()
  const profile = await student.page.locator('#userMenu').innerText()
  check(profile.includes('计算机与信息学院') && profile.includes('软件工程2601班') && !profile.includes('未填写'), 'missing profile shows fictional major, class and department')
  await student.page.screenshot({ path: fileURLToPath(new URL('STUDENT-example-profile.png', output)) })
  await student.page.keyboard.press('Escape')
  await student.page.locator('.conv-main').first().click()
  await student.page.locator('.msg.bot').first().waitFor()
  check(student.state.historyReads === 1, 'old conversations still open on explicit history selection')
  await student.page.locator('#userMenuToggle').click()
  await student.page.locator('#logoutBtn').click()
  await student.page.locator('#loginBtn').waitFor()
  await student.page.evaluate(() => { location.hash = '/qa?conversation=10' })
  await loginStudent()
  check(student.state.historyReads === 1 && await student.page.locator('.msg').count() === 0, 'student logout and login starts another new chat')
  check(student.errors.length === 0, 'new-chat login has no runtime errors: ' + student.errors.join('; '))
  await student.context.close()
  console.log(`PASS: ${checks} feedback, profile, themes and mobile checks.`)
} finally { await browser.close() }
function userText(role) { return role === 'ADMIN' ? '信息化建设与管理处' : '软工2601班' }
