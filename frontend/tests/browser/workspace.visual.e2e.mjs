import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright-core')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const output = fileURLToPath(new URL('../../../tmp/ui-acceptance/', import.meta.url))
await mkdir(output, { recursive: true })
async function chooseTheme(page, theme) {
  await page.locator('#userMenuToggle').click();
  await page.locator(theme === 'dark' ? '#themeDark' : '#themeLight').click();
  await page.keyboard.press('Escape');
}
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
const statuses = ['COMPLETED', 'REVIEWING', 'NEED_MORE', 'APPROVED', 'REJECTED', 'SUBMITTED']
const services = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, code: 'SERVICE_' + i,
  name: ['奖学金申请', '学生证补办', '宿舍报修', '在读证明办理'][i % 4],
  category: ['资助事务', '学籍事务', '生活服务'][i % 3], description: '了解办理条件，准备所需材料并查看申请步骤。',
  department: '学生事务中心', status: 'ACTIVE', version: 1, materials: [{ name: '申请表', required: true }], requirements: ['在校学生'] }))
const applications = statuses.map((status, i) => ({ id: i + 1, serviceName: services[i].name,
  applicationNo: 'CA202610130000000' + i, status, version: 1, submittedAt: '2026-10-12T10:00:00', updatedAt: '2026-10-12T10:00:00' }))
const conversations = services.slice(0, 8).map((service, i) => ({ id: i + 1, title: service.name + '的办理流程是什么？', updatedAt: '2026-10-12T10:00:00' }))
const documents = [{ id: 'doc1', displayName: '学生奖学金管理办法.pdf', fileName: '学生奖学金管理办法.pdf', fileType: 'pdf', status: 'SUCCESS', chunkCount: 12, createdAt: '2026-10-12T10:00:00' }]

async function fixture(directory, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const errors = [], adminRequests = []
  let loggedIn = true
  await context.addInitScript(() => localStorage.setItem('ca-theme', 'light'))
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (url.hostname !== 'campus.test') return route.abort()
    if (path.startsWith('/api/')) {
      if (path.startsWith('/api/admin/')) adminRequests.push(path)
      let data = {}, status = 200
      if (path === '/api/auth/me') { status = loggedIn ? 200 : 401; data = { id: 1, role, username: '20260001', displayName: '张三' } }
      else if (path === '/api/auth/csrf') data = { token: 'test', headerName: 'X-XSRF-TOKEN' }
      else if (path === '/api/auth/logout') loggedIn = false
      else if (path === '/api/auth/login') { loggedIn = true; data = { success: true, user: { id: 1, role, username: '20260001', displayName: '张三' } } }
      else if (path === '/api/services' || path === '/api/admin/services') data = services
      else if (/^\/api\/services\/\d+$/.test(path)) data = { service: services[Number(path.split('/').at(-1)) - 1], steps: [] }
      else if (path === '/api/chat/conversations') data = conversations
      else if (path.endsWith('/messages')) data = { messages: [], pending: false }
      else if (path === '/api/v1/health') data = { status: 'UP', service: 'campus-backend', version: '0.1.0' }
      else if (path.endsWith('/applications')) data = { items: applications, total: applications.length }
      else if (path === '/api/admin/overview') data = { total: 1, success: 1, failed: 0, processing: 0, chunks: 12, recentDocuments: documents }
      else if (path === '/api/admin/documents') data = { items: documents, total: 1 }
      else if (path === '/api/admin/config' || path.endsWith('/upload-config') || path.endsWith('/material-attachments/config')) data = { maxFiles: 5, maxUploadSizeMb: 20, maxTotalSizeMb: 50, extensions: ['pdf', 'docx'] }
      else if (path === '/api/admin/ai-quality/summary') data = { total: 0, positive: 0, negative: 0, positiveRate: 0, trend: [], accessScope: 'ALL' }
      else if (path === '/api/admin/ai-quality/feedback') data = { items: [], total: 0 }
      else if (path === '/api/knowledge/search') data = { results: [{ fileName: '学校奖学金管理办法与申请材料说明', documentId: 'doc1', pageNumber: 2, chunkIndex: 3, rank: 1, score: .93, content: '奖学金申请需按照学校通知准备申请材料，审核结果以学校公示为准。' }] }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'AUTH_REQUIRED', data }),
        headers: { 'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true' } })
    }
    const relative = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
    const filename = resolve(directory, relative)
    if (!filename.startsWith(resolve(directory) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) return route.fulfill({ status: 404 })
    return route.fulfill({ body: await readFile(filename), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(filename)] || 'application/octet-stream' })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  const action = (name, ...args) => page.evaluate(({ name, args }) => (window.CampusActions?.[name] || window[name])(...args), { name, args })
  return { context, page, errors, action, adminRequests }
}

try {
  const modes = [['vue', fileURLToPath(new URL('../../dist/', import.meta.url))]]
  if (process.env.CAMPUS_REFERENCE_DIR) modes.unshift(['reference', process.env.CAMPUS_REFERENCE_DIR])
  for (const [mode, directory] of modes) {
    console.log(`Checking ${mode} pages`)
    const { context, page, errors, action, adminRequests } = await fixture(directory, 'STUDENT')
    const capture = async name => {
      await page.waitForTimeout(450)
      await page.locator('#toastHost').evaluate(host => host.replaceChildren())
      await page.screenshot({ path: resolve(output, `${mode}-${name}.png`) })
    }
    await page.goto('http://campus.test/')
    await page.locator('#qaInput').waitFor()
    check(await page.locator('.nav-ico, .brand-mark').count() === 0, 'decorative brand and nav icons removed')
    check(await page.locator('.avatar').evaluate(el => getComputedStyle(el).borderRadius) === '50%', 'avatar is circular')
    const balanced = () => page.locator('.qa-input-wrap').evaluate(el => {
      const input = el.querySelector('textarea'), r = el.getBoundingClientRect(), t = input.getBoundingClientRect()
      return Math.abs((t.top - r.top) - (r.bottom - t.bottom)) < 1
    })
    check(await balanced(), 'single-line composer has equal top/bottom space')
    await capture('qa-light')
    await page.locator('#qaInput').fill('第一行\n第二行\n第三行')
    check(await balanced(), 'multi-line composer has equal top/bottom space')
    check(await page.locator('#qaSend svg').count() === 1 && await page.locator('#qaSend').isEnabled(), 'send button uses an SVG and enables for text')
    await page.locator('#qaInput').fill('')
    await chooseTheme(page, 'dark')
    await capture('qa-dark')
    await chooseTheme(page, 'light')
    await page.locator('#sidebarToggle').click()
    check(await page.locator('.nav-item[data-route="qa"]').evaluate(el => getComputedStyle(el, '::after').content.includes('问答')), 'collapsed sidebar retains readable navigation')
    await page.locator('#sidebarToggle').click()
    for (const route of ['dashboard', 'search', 'affairs', 'my-applications']) {
      await action('navigate', route)
      await page.waitForFunction(name => document.body.dataset.route === name, route)
      if (route === 'dashboard') {
        await page.locator('.stat-value').filter({ hasText: '12' }).first().waitFor()
        check(await page.locator('.stat-ico, .tag-dot, .edge-light').count() === 0, 'dashboard uses clean metrics and status labels')
        check((await page.locator('.wb-meta-right .tag').allTextContents()).includes('已完成'), 'application completion remains readable')
      }
      if (route === 'search') { await page.locator('#searchInput').fill('奖学金'); await page.getByRole('button', { name: '检索', exact: true }).click(); await page.locator('.result-item').waitFor() }
      if (route === 'affairs') await page.locator('.affair-card').first().waitFor()
      if (route === 'my-applications') await page.locator('#myAppBody tr').nth(5).waitFor()
      await capture(route + '-desktop')
      await page.setViewportSize({ width: 390, height: 844 })
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#viewport').scrollWidth <= document.querySelector('#viewport').clientWidth), route + ' mobile has no page overflow')
      await capture(route + '-mobile')
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await action('navigate', 'qa')
    await page.locator('#qaInput').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('qa-mobile')
    check(await balanced(), 'mobile composer is balanced')
    await page.locator('#sidebarToggle').click()
    await page.locator('[data-route="search"]').click()
    await page.waitForFunction(() => document.body.dataset.route === 'search')
    await page.waitForFunction(() => document.querySelector('#sidebar').getAttribute('aria-hidden') === 'true')
    check(await page.locator('#sidebar').getAttribute('aria-hidden') === 'true', 'mobile route click closes drawer')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await action('navigate', 'policy-mgr')
    await page.waitForFunction(() => document.body.dataset.route === 'qa')
    check(adminRequests.length === 0, 'student cannot trigger administrator API calls')
    if (mode === 'vue') {
      await action('navigate', 'search')
      await action('navigate', 'affairs')
      await page.goBack()
      await page.waitForFunction(() => document.body.dataset.route === 'search')
      check(await page.locator('#searchInput').isVisible(), 'browser back mounts the correct Vue page')
      await action('logout')
      await page.locator('#loginBtn').waitFor()
      await capture('login')
      await page.locator('#loginUser').fill('20260001')
      await page.locator('#loginPass').fill('fixture-password')
      await page.locator('#loginBtn').click()
      await page.locator('#qaInput').waitFor()
      check(new URL(page.url()).hash === '#/qa', 'logout and login keep Vue Router in sync')
    }
    check(errors.length === 0, 'student has no runtime errors: ' + errors.join('; '))
    await context.close()

    const admin = await fixture(directory, 'ADMIN')
    await admin.page.goto('http://campus.test/')
    await admin.page.waitForFunction(() => document.body.dataset.route === 'dashboard')
    for (const route of ['policy-mgr', 'services-mgr', 'review', 'audit', 'ai-quality', 'settings']) {
      await admin.action('navigate', route)
      await admin.page.waitForFunction(name => document.body.dataset.route === name, route)
      await admin.page.waitForTimeout(450)
      await admin.page.setViewportSize({ width: 390, height: 844 })
      check(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#viewport').scrollWidth <= document.querySelector('#viewport').clientWidth), route + ' mobile fits')
      await admin.page.screenshot({ path: resolve(output, `${mode}-admin-${route}-mobile.png`) })
      await admin.page.setViewportSize({ width: 1440, height: 1000 })
    }
    check(admin.errors.length === 0, 'admin has no runtime errors: ' + admin.errors.join('; '))
    await admin.context.close()
  }
  console.log(`PASS: ${checks} visual, responsive, Vue Router and authorization checks.`)
} finally { await browser.close() }
