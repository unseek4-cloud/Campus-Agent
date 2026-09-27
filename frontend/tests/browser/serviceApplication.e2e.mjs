import assert from 'node:assert/strict'
import { readFile, mkdir, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { credentials } from './auth.helpers.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const base = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5173'
const settings = Object.fromEntries((await readFile(path.join(root, 'backend/.env'), 'utf8')).split(/\r?\n/)
  .filter(line => /^\s*[A-Z_]+\s*=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
function sql(query) {
  const dbUrl = new URL((settings.DB_URL || 'jdbc:mysql://localhost:3306/campus_agent').replace(/^jdbc:/, ''))
  return execFileSync(process.env.MYSQL_EXECUTABLE || 'mysql', ['--host=' + dbUrl.hostname, '--port=' + (dbUrl.port || 3306), '--user=' + (settings.DB_USERNAME || 'campus_agent'), '--database=' + dbUrl.pathname.slice(1), '--default-character-set=utf8mb4', '--batch', '--skip-column-names', '--execute=' + query], { encoding: 'utf8', env: { ...process.env, MYSQL_PWD: settings.DB_PASSWORD || '' } }).trim()
}
const output = path.join(root, 'tmp/application-browser'); await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } })
const page = await context.newPage(); page.setDefaultTimeout(30000)
const errors = []; page.on('pageerror', e => errors.push(e.message))
const marker = 'CA-APPLICATION-E2E-' + Date.now()
let applicationId, item
async function login(role) {
  await page.goto(base + '/login')
  const account = credentials(role)
  await page.getByPlaceholder('请输入账号或学号').fill(account.username)
  await page.getByPlaceholder('请输入密码').fill(account.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(base + (role === 'ADMIN' ? '/admin' : '/'))
}
async function logout() {
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.waitForURL(base + '/login')
}
async function assertState(label) { await page.locator('.application-summary .el-tag').filter({ hasText: label }).waitFor() }
async function adminDetail() {
  await page.getByRole('link', { name: '办事申请管理', exact: true }).click()
  const row = page.locator('.el-table__row').filter({ hasText: item.name }).filter({ hasText: credentials('STUDENT').username })
  await row.first().getByRole('button', { name: '查看详情' }).click()
  await page.waitForURL(base + `/admin/applications/${applicationId}`)
}
async function studentDetail() {
  await page.getByRole('link', { name: '我的办事', exact: true }).first().click()
  await page.locator('.el-table__row').filter({ hasText: item.name }).first().getByRole('button', { name: '查看详情' }).click()
  await page.waitForURL(base + `/student/applications/${applicationId}`)
}
async function review(button, opinion, expected, confirm = false) {
  await page.getByRole('textbox', { name: '管理员意见', exact: true }).fill(opinion)
  const response = page.waitForResponse(r => r.url().endsWith(`/applications/${applicationId}/status`) && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: button, exact: true }).click()
  if (confirm) await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  assert.equal((await response).status(), 200); await assertState(expected)
}
try {
  // Read-only DB inspection, before creating any test records.
  assert.equal(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('service_application','service_application_attachment','service_application_event')"), '3')
  await login('STUDENT')
  const services = (await (await context.request.get(base + '/api/services')).json()).data
  for (const candidate of services.filter(s => s.name.includes('学生证'))) {
    const active = (await (await context.request.get(base + '/api/student/applications/active?serviceItemId=' + candidate.id)).json()).data
    if (!active) { item = candidate; break }
  }
  assert.ok(item, 'Need an existing active student-card service with no active application for this student')
  await page.getByRole('button', { name: '开始提问' }).click()
  await page.locator('textarea').fill('学生证丢失了，怎么补办？')
  const answer = page.waitForResponse(r => r.url().endsWith('/api/rag/chat'))
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const guide = (await (await answer).json()).data
  assert.equal(guide.type, 'SERVICE_GUIDE'); assert.equal(guide.service.id, item.id)
  await page.getByRole('button', { name: '立即办理', exact: true }).click()
  await page.waitForURL(base + `/student/services/${item.id}/apply`)
  await page.getByRole('textbox', { name: '申请说明', exact: true }).fill(marker + ' 学生证遗失，请办理补办。')
  const fixture = { name: '身份证明.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nCampusAgent temporary application evidence') }
  await page.locator('input[type=file]').setInputFiles(fixture)
  await page.getByText('已选择 ·', { exact: false }).waitFor()
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fixture)
  const creation = page.waitForResponse(r => r.url().endsWith('/api/student/applications') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '提交申请', exact: true }).click()
  const created = await creation; assert.equal(created.status(), 200)
  const detail = (await created.json()).data; applicationId = detail.application.id
  await assertState('已提交'); assert.match(detail.application.applicationNo, /^CA\d{16,}$/)
  await page.reload(); await assertState('已提交')
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载', exact: true }).click()
  const downloaded = await pendingDownload
  assert.equal(downloaded.suggestedFilename(), fixture.name)
  assert.deepEqual(await readFile(await downloaded.path()), fixture.buffer)
  await page.goto(base + `/student/services/${item.id}/apply`)
  await page.getByText('你已经有一个正在办理中的申请。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看办理进度' }).click(); await assertState('已提交')
  await page.screenshot({ path: path.join(output, 'student-submitted.png'), fullPage: true })
  await logout(); await login('ADMIN'); await adminDetail()
  await review('开始审核', '正在审核。', '审核中')
  await logout(); await login('STUDENT'); await studentDetail(); await assertState('审核中')
  await page.locator('.admin-remark').getByText('正在审核。', { exact: true }).waitFor()
  await logout(); await login('ADMIN'); await adminDetail()
  await review('要求补充材料', '请补充身份证明。', '待补充材料')
  await logout(); await login('STUDENT'); await studentDetail(); await assertState('待补充材料')
  await page.locator('.admin-remark').getByText('请补充身份证明。', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '补充说明', exact: true }).fill(marker + ' 已补充身份证明。')
  await page.locator('input[type=file]').setInputFiles({ ...fixture, name: '补充身份证明.pdf' })
  await page.getByRole('button', { name: '重新提交', exact: true }).click(); await assertState('已提交')
  await logout(); await login('ADMIN'); await adminDetail()
  await review('开始审核', '补充材料已收到。', '审核中')
  await review('审核通过', '材料齐全，审核通过。', '已通过')
  await page.screenshot({ path: path.join(output, 'admin-approved.png'), fullPage: true })
  await logout(); await login('STUDENT'); await studentDetail(); await assertState('已通过')
  await logout(); await login('ADMIN'); await adminDetail()
  await review('标记办结', '学生证补办完成。', '已办结', true)
  await logout(); await login('STUDENT'); await studentDetail(); await assertState('已办结')
  assert.equal(await page.locator('input[type=file]').count(), 0)
  assert.equal(await page.locator('.application-timeline .el-timeline-item').count(), 7)
  await page.screenshot({ path: path.join(output, 'student-completed.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.screenshot({ path: path.join(output, 'student-mobile.png'), fullPage: true })
  await page.goto(base + `/student/services/${item.id}/apply`)
  await page.getByRole('button', { name: '提交申请', exact: true }).waitFor()
  await page.goto(base + '/admin/applications'); await page.waitForURL(base + '/forbidden')
  assert.equal((await context.request.get(base + '/api/admin/applications')).status(), 403)
  const csrf = (await (await context.request.get(base + '/api/auth/csrf')).json()).data
  assert.equal((await context.request.patch(base + `/api/admin/applications/${applicationId}/status`, { headers: { [csrf.headerName]: csrf.token }, data: { status: 'COMPLETED', version: 6 } })).status(), 403)
  await page.goto(base + '/'); await logout()
  assert.equal((await context.request.get(base + '/api/student/applications')).status(), 401)
  assert.deepEqual(errors, [])
  console.log('PASS real MySQL + Edge: UI login, student AI guide, apply, upload/remove/download, duplicate protection, list/detail, refresh identity, reviewing, need-more, supplement, approval, confirmation, completion, 7-event history, mobile layout, 403/401, logout')
} finally {
  // Only this run's uniquely marked records. No production deletion API is introduced.
  const ids = sql(`SELECT id FROM service_application WHERE student_remark LIKE '${marker}%'`).split(/\s+/).filter(Boolean)
  for (const id of ids) assert.match(id, /^\d+$/)
  if (ids.length) {
    const files = sql(`SELECT id FROM service_application_attachment WHERE application_id IN (${ids.join(',')})`).split(/\s+/).filter(Boolean)
    const storageRoot = path.resolve(root, 'backend', settings.APPLICATION_UPLOAD_DIR || path.join(settings.ADMIN_DOCUMENT_STORAGE_PATH || 'var/documents', 'applications'))
    sql(`START TRANSACTION; DELETE FROM service_application_event WHERE application_id IN (${ids.join(',')}); DELETE FROM service_application_attachment WHERE application_id IN (${ids.join(',')}); DELETE FROM service_application WHERE id IN (${ids.join(',')}); COMMIT;`)
    for (const id of files) { assert.match(id, /^[a-f0-9-]{36}$/); const target = path.resolve(storageRoot, id); assert.equal(path.dirname(target), storageRoot); await unlink(target) }
    assert.equal(sql(`SELECT COUNT(*) FROM service_application WHERE student_remark LIKE '${marker}%'`), '0')
    console.log(`CLEANUP verified: ${ids.length} test application(s), ${files.length} attachment(s), associated events removed`)
  }
  await browser.close()
}
