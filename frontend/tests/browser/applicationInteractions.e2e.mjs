// Serve the actual production build in Edge, with API responses intercepted.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const materials = [{ id: 'form', name: '宿舍报修申请表', required: true, description: '填写并签名' },
  { id: 'photo', name: '故障照片', required: true, description: '说明位置' }]
const service = { id: 1, code: 'REPAIR', name: '宿舍报修', category: '后勤', status: 'ACTIVE', version: 1,
  requirements: [], materials, recognitionRules: { subjects: [], actions: [], exclusions: [] } }
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
async function fixture(role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const errors = [], requests = []
  const page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  let application = { id: 10, applicationNo: 'CA2026101200000010', serviceItemId: 1, serviceName: '宿舍报修',
    status: 'SUBMITTED', version: 0, studentRemark: '空调故障' }
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (url.hostname !== 'campus.test') return route.abort()
    if (path.startsWith('/api/')) {
      let data = {}, status = 200
      if (path === '/api/auth/me') data = { id: role === 'ADMIN' ? 2 : 1, role, username: 'test', displayName: '测试用户', studentNo: 'TEST001' }
      else if (path === '/api/auth/csrf') data = { token: 'test-token', headerName: 'X-XSRF-TOKEN' }
      else if (path === '/api/services/1') data = { service, steps: [] }
      else if (path === '/api/student/applications/active') data = null
      else if (path.endsWith('/upload-config')) data = { maxFiles: 10, maxUploadSizeMb: 20, maxTotalSizeMb: 100, extensions: ['pdf', 'png'] }
      else if ((path === '/api/student/applications' && method === 'POST') || path.endsWith('/review') || path.endsWith('/resubmit')) {
        requests.push({ path, body: method === 'PATCH' ? route.request().postDataJSON() : route.request().postDataBuffer().toString('utf8') })
        if (method === 'PATCH') application = { ...application, status: requests.at(-1).body.status, version: 3, adminRemark: requests.at(-1).body.remark }
        data = { application, materials, events: [], attachments: [] }
      }
      else if (path.endsWith('/applications/10')) data = { application, materials, events: [], attachments: [] }
      else status = 404
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'NOT_FOUND', data }) })
    }
    const file = path.startsWith('/assets/') ? path.slice(1) : 'index.html'
    return route.fulfill({ body: await readFile(new URL('../../dist/' + file, import.meta.url)),
      contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  return { context, page, errors, requests, setStatus(status) { application = { ...application, status } } }
}
try {
  const student = await fixture('STUDENT'), page = student.page
  await page.goto('http://campus.test/student/services/1/apply')
  await page.getByLabel('上传宿舍报修申请表', { exact: true }).waitFor()
  check(await page.locator('input[type=file]').count() === 3, 'Vue has one entry for each requirement plus extra attachments')
  await page.getByRole('textbox', { name: '申请说明', exact: true }).fill('空调故障，申请维修')
  const file = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n test') })
  await page.getByLabel('上传宿舍报修申请表', { exact: true }).setInputFiles(file('form.pdf'))
  await page.getByRole('button', { name: '提交申请', exact: true }).click()
  await page.getByText('请逐项上传必交材料：故障照片', { exact: true }).waitFor()
  check(student.requests.length === 0, 'Vue blocks a missing required material')
  await page.getByLabel('上传故障照片', { exact: true }).setInputFiles(file('photo.pdf'))
  await page.getByRole('button', { name: '提交申请', exact: true }).click()
  await page.waitForURL('http://campus.test/student/applications/10')
  check(student.requests.length === 1, 'Vue creates the application once')
  const body = student.requests[0].body
  check(body.includes('name="materialIds"\r\n\r\nform') && body.includes('name="materialIds"\r\n\r\nphoto'), 'Vue multipart includes both automatic bindings')
  student.setStatus('NEED_MORE'); await page.reload()
  await page.getByLabel('上传故障照片', { exact: true }).waitFor()
  await page.getByLabel('上传故障照片', { exact: true }).setInputFiles(file('replacement.pdf'))
  await page.getByRole('button', { name: '重新提交', exact: true }).click()
  await page.waitForResponse(response => response.url().endsWith('/10/resubmit'))
  check(student.requests.at(-1).body.includes('name="materialIds"\r\n\r\nphoto'), 'Vue supplement uses snapshot bindings without requiring every item again')
  assert.deepEqual(student.errors, []); checks++
  await student.context.close()
  const admin = await fixture('ADMIN'), review = admin.page
  await review.goto('http://campus.test/admin/applications/10')
  await review.getByRole('textbox', { name: '管理员意见', exact: true }).fill('材料齐全，已完成维修')
  for (const label of ['开始审核', '审核通过', '标记办结']) await review.getByRole('button', { name: label, exact: true }).click()
  check(admin.requests.length === 0, 'Vue review stages remain local until final submission')
  check(await review.getByRole('textbox', { name: '管理员意见', exact: true }).inputValue() === '材料齐全，已完成维修', 'Vue preserves one opinion across all stages')
  await review.getByRole('button', { name: '提交审核结果', exact: true }).click()
  await review.locator('.application-summary .el-tag').getByText('已办结', { exact: true }).waitFor()
  check(admin.requests.length === 1, 'Vue submits all stages in one request')
  assert.deepEqual(admin.requests[0].body, { status: 'COMPLETED', remark: '材料齐全，已完成维修', version: 0 }); checks++
  assert.deepEqual(admin.errors, []); checks++
  await admin.context.close()
  console.log(`PASS: ${checks} Vue application interaction browser checks.`)
} finally { await browser.close() }
