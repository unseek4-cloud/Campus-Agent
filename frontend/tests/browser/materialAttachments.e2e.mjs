import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'

const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium, request } = await import(moduleUrl)
const baseURL = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:15173'
const credentials = process.env.MATERIAL_TEST_AUTH_FILE
  ? JSON.parse(await readFile(process.env.MATERIAL_TEST_AUTH_FILE, 'utf8'))
  : { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }
assert.ok(credentials.username && credentials.password, 'Supply admin test credentials through environment variables')
const auth = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
const api = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: auth } })
const authResponse = await api.get('/api/admin/session'); assert.equal(authResponse.status(), 200)
const session = (await authResponse.json()).data
const headers = { [session.csrfHeader]: session.csrfToken }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const output = new URL('../../../tmp/material-browser/', import.meta.url)
await mkdir(output, { recursive: true })
const fixture = await readFile(new URL('../../../tmp/material-fixtures/form.docx', import.meta.url))
const admin = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
const student = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
const page = await admin.newPage(), learner = await student.newPage(), errors = []
for (const tab of [page, learner]) { tab.setDefaultTimeout(30000); tab.on('pageerror', e => errors.push(e.message)) }
let serviceId
const stamp = Date.now(), subject = `附件验收${stamp}`, title = `学生证补办（附件验收 ${stamp}）`
async function ask() {
  await learner.goto(baseURL + '/knowledge/search')
  await learner.locator('textarea').fill(`${subject}怎么补办？`)
  const response = learner.waitForResponse(r => r.url().endsWith('/api/rag/chat'))
  await learner.getByRole('button', { name: '发送', exact: true }).click()
  const data = await (await response).json(); assert.equal(data.data.type, 'SERVICE_GUIDE')
  await learner.locator('.service-guide').waitFor()
  return data.data
}
async function download(tab, link, name) {
  const url = tab.url(), pending = tab.waitForEvent('download')
  await link.click()
  const file = await pending
  assert.equal(file.suggestedFilename(), name)
  assert.deepEqual(await readFile(await file.path()), fixture)
  assert.equal(tab.url(), url)
}
try {
  const response = await api.post('/api/admin/services', { headers, data: {
    service: { code: `TEST_ATTACHMENT_${stamp}`, name: title, category: '自动验收', description: '测试结束后自动删除', status: 'ACTIVE', isExample: true, version: 0,
      requirements: [], materials: [{ name: '学生证补办申请表', description: '请填写完整', required: true }, { name: '身份证明', description: '本人有效身份证明', required: true }, { name: '证件照', required: true }],
      recognitionRules: { subjects: [subject], actions: ['补办'], exclusions: [] } },
    steps: [{ order: 1, title: '提交材料', requiredMaterials: ['学生证补办申请表'] }] } })
  assert.equal(response.status(), 200); serviceId = (await response.json()).data.service.id
  await page.goto(baseURL + '/admin/services')
  await page.locator('input[autocomplete="username"]').fill(credentials.username)
  await page.locator('input[autocomplete="current-password"]').fill(credentials.password)
  await page.getByRole('button', { name: '验证并进入' }).click()
  await page.locator('.el-table__row').filter({ hasText: title }).getByRole('button', { name: '编辑', exact: true }).click()
  const editor = page.locator('.el-dialog .service-editor'), attachment = editor.locator('.attachment-editor').first()
  await attachment.getByText('暂无附件', { exact: true }).waitFor()
  await attachment.locator('small').waitFor()
  const name = '学生证补办申请表.docx'
  const uploaded = page.waitForResponse(r => r.url().endsWith('/attachment') && r.request().method() === 'POST')
  await attachment.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fixture })
  const uploadedResponse = await uploaded
  assert.equal(uploadedResponse.status(), 200, await uploadedResponse.text())
  await attachment.getByText(`附件：${name}`, { exact: true }).waitFor()
  await download(page, attachment.locator('.material-download'), name)
  const initial = await ask(), material = learner.locator('.material-item').first(), link = material.locator('.material-download')
  assert.equal(await link.innerText(), `下载：${name}`)
  assert.equal(await link.evaluate(a => getComputedStyle(a).color), 'rgb(54, 116, 189)')
  await link.hover(); assert.match(await link.evaluate(a => getComputedStyle(a).textDecorationLine), /underline/)
  await material.locator('input').check()
  await download(learner, link, name)
  assert.equal(await material.locator('input').isChecked(), true, 'Download must not toggle the checkbox')
  assert.equal(await learner.locator('.material-item').nth(1).locator('.material-download').count(), 0)
  assert.equal(await learner.locator('.material-item').nth(2).locator('.material-download').count(), 0)
  assert.equal(await learner.locator('.service-guide').getByText('暂无附件', { exact: true }).count(), 0)
  await learner.locator('.service-guide').screenshot({ path: fileURLToPath(new URL('student-download.png', output)) })
  await editor.locator('.material-editor').first().scrollIntoViewIfNeeded()
  await editor.locator('.material-editor').first().screenshot({ path: fileURLToPath(new URL('admin-attachment.png', output)) })
  const replacement = '新版 学生证补办申请表.docx'
  await attachment.locator('input[type="file"]').setInputFiles({ name: replacement, mimeType: 'application/octet-stream', buffer: fixture })
  await attachment.getByText(`附件：${replacement}`, { exact: true }).waitFor()
  assert.equal((await student.request.get(baseURL + initial.service.materials[0].attachment.downloadUrl)).status(), 404)
  await ask()
  assert.equal(await link.innerText(), `下载：${replacement}`)
  await download(learner, link, replacement)
  await learner.setViewportSize({ width: 390, height: 844 })
  assert.equal(await learner.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await learner.locator('.service-guide').screenshot({ path: fileURLToPath(new URL('student-mobile.png', output)) })
  await attachment.getByRole('button', { name: '删除附件', exact: true }).click()
  await page.locator('.el-message-box').getByRole('button', { name: '删除附件', exact: true }).click()
  await attachment.getByText('暂无附件', { exact: true }).waitFor()
  // A stale card receives a friendly failure, with no navigation or blank tab.
  await link.click(); await learner.getByText('文件下载失败，请稍后重试。', { exact: true }).waitFor()
  await ask()
  assert.equal(await learner.locator('.material-download').count(), 0)
  assert.equal(await learner.locator('.material-item').count(), 3)
  assert.match(await material.innerText(), /学生证补办申请表/)
  assert.equal(await material.locator('input').isChecked(), true)
  assert.equal((await student.request.get(baseURL + '/api/admin/services')).status(), 401)
  assert.ok([401, 403].includes((await student.request.delete(baseURL + `/api/admin/services/${serviceId}/materials/${initial.service.materials[0].id}/attachment`)).status()))
  assert.deepEqual(errors, [])
  console.log('PASS real MySQL + browser: admin authentication, upload/download, student blue link, Chinese and spaced names, byte-identical downloads, checkbox retained, optional attachments hidden, replace, delete, stale-link failure, mobile layout and authorization')
} finally {
  if (serviceId) {
    const current = (await (await api.get(`/api/admin/services/${serviceId}`)).json()).data
    assert.equal((await api.delete(`/api/admin/services/${serviceId}?version=${current.service.version}`, { headers })).status(), 200)
  }
  await browser.close(); await api.dispose()
}
