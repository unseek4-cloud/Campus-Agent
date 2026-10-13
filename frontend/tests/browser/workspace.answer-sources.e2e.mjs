import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const output = new URL('../../../tmp/answer-sources/', import.meta.url)
await mkdir(output, { recursive: true })
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
const answer = '# 我校助学金\n\n助学金用于帮助家庭经济困难学生完成学业。\n\n## 资助标准\n- **特困助学金**：6000元／人／学年。\n- **困难助学金**：4000元／人／学年。\n- **一般困难助学金**：2000元／人／学年。\n\n## 申请时间\n请在 **9月6日至20日** 提交申请。\n\n> 请以学校最新通知为准。\n\n| 档次 | 金额 |\n| --- | --- |\n| 特困 | 6000元 |\n| 困难 | 4000元 |'
const sources = [
  { documentId: 'policy', fileName: '助学金管理办法.pdf', pageNumber: 2, chunkIndex: 1, score: .99, rerankScore: .3, content: '次要引用。' },
  { documentId: 'policy', fileName: '助学金管理办法.pdf', pageNumber: 3, chunkIndex: 2, score: .85, rerankScore: .95, content: '最佳引用：特困助学金每人每学年6000元。' },
  { documentId: 'policy', fileName: '助学金管理办法.pdf', pageNumber: 1, chunkIndex: 3, score: .8, rerankScore: .6, content: '其他引用。' }
]
try {
  for (const role of ['ADMIN', 'STUDENT']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage(), errors = [], fileRequests = []
    let loggedIn = false
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), path = url.pathname
      if (url.hostname !== 'campus.test') return route.abort()
      if (path === '/api/knowledge/documents/policy/file') {
        fileRequests.push(path)
        return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '政策原文件：特困助学金6000元／人／学年。' })
      }
      if (path.startsWith('/api/')) {
        let data = {}, status = 200
        const user = { id: role === 'ADMIN' ? 2 : 1, username: role === 'ADMIN' ? 'admin' : '20260001', displayName: role === 'ADMIN' ? '系统管理员' : '张三', role, studentNo: '20260001' }
        if (path === '/api/auth/me') { data = user; status = loggedIn ? 200 : 401 }
        else if (path === '/api/auth/csrf') data = { token: 'test', headerName: 'X-XSRF-TOKEN' }
        else if (path === '/api/auth/login') { loggedIn = true; data = { success: true, user } }
        else if (path === '/api/chat/conversations') data = [{ id: 10, title: '介绍我校助学金', updatedAt: '2026-10-13T15:00:00' }]
        else if (path === '/api/chat/conversations/10/messages') data = { pending: false, messages: [{ id: 200, role: 'USER', content: '介绍一下我校助学金' }, { id: 201, role: 'ASSISTANT', content: answer, response: { type: 'QA', sources } }] }
        else if (path === '/api/admin/overview') data = { total: 0, success: 0, processing: 0, failed: 0, recentDocuments: [] }
        else if (path === '/api/admin/documents' || path.endsWith('/applications')) data = { items: [], total: 0 }
        else if (path === '/api/services') data = []
        else if (path === '/api/v1/health') data = { status: 'UP' }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'AUTH_REQUIRED', data }) })
      }
      const file = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
      if (!/^(?:assets\/)?[\w.-]+\.(html|css|js)$/.test(file)) return route.fulfill({ status: 404 })
      return route.fulfill({ contentType: { html: 'text/html', js: 'text/javascript', css: 'text/css' }[file.split('.').at(-1)], body: await readFile(new URL('../../dist/' + file, import.meta.url)) })
    })
    await page.goto('http://campus.test/')
    await page.locator('#loginUser').fill(role === 'ADMIN' ? 'admin' : '20260001')
    await page.locator('#loginPass').fill('test-password'); await page.locator('#loginBtn').click()
    await page.locator('#convList .conv-main').waitFor()
    if (role === 'ADMIN') check(await page.evaluate(() => document.body.dataset.route === 'dashboard'), 'administrator history loads on initial dashboard without pressing plus')
    await page.locator('#convList .conv-main').click()
    const reply = page.locator('.msg.bot').first(), bubble = reply.locator('.answer-markdown')
    await bubble.locator('h2').waitFor()
    check(await bubble.locator('h2').innerText() === '我校助学金' && await bubble.locator('h3').count() === 2, 'answer has headings and sections')
    check(await bubble.locator('strong').count() === 4 && await bubble.locator('li').count() === 3, 'key facts and list structure are preserved')
    check(await bubble.evaluate(el => parseFloat(getComputedStyle(el.querySelector('h2')).fontSize) > parseFloat(getComputedStyle(el).fontSize)), 'heading is larger than body text')
    check(await reply.locator('.cite-chip').count() === 1, 'one source is displayed for three retrieved chunks')
    check((await reply.locator('.cite-chip').innerText()).includes('第 3 页'), 'highest-ranked source is selected')
    const popupEvent = page.waitForEvent('popup')
    await reply.locator('.cite-chip').click()
    const popup = await popupEvent
    await popup.waitForLoadState('domcontentloaded')
    check(fileRequests.length === 1 && popup.url().endsWith('/api/knowledge/documents/policy/file#page=3'), 'clicking citation opens original file in a new tab at cited page')
    check((await popup.locator('body').innerText()).includes('政策原文件'), 'original contents are accessible for verification')
    await popup.close()
    await reply.locator('[data-act="more"]').click(); await page.getByRole('menuitem', { name: '查看知识来源' }).click()
    await page.locator('.cite-block').waitFor()
    check((await page.locator('.cite-block').innerText()).includes('最佳引用'), 'more menu uses the same best citation')
    check(await page.getByRole('link', { name: '打开原文件核对' }).count() === 1, 'citation detail also offers original file')
    await page.evaluate(() => CampusActions.closeModal())
    await page.waitForTimeout(400)
    await page.screenshot({ path: fileURLToPath(new URL(role + '-answer-light.png', output)) })
    await page.locator('#userMenuToggle').click(); await page.locator('#themeDark').click(); await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await page.screenshot({ path: fileURLToPath(new URL(role + '-answer-dark.png', output)) })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: fileURLToPath(new URL(role + '-answer-mobile.png', output)) })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.answer-markdown').scrollWidth <= document.querySelector('.answer-markdown').clientWidth), 'formatted answer and table fit mobile')
    check(errors.length === 0, 'no runtime errors: ' + errors.join('; '))
    await context.close()
  }
  console.log(`PASS: ${checks} answer hierarchy, best-source links and initial administrator history checks.`)
} finally { await browser.close() }
