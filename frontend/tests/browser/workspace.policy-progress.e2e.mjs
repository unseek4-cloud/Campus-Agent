import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const output = new URL('../../../tmp/policy-progress/', import.meta.url)
await mkdir(output, { recursive: true })
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
function document(id, name = '学校奖学金管理办法.txt', status = 'PROCESSING') {
  return { id, displayName: name, originalFilename: name, fileType: 'txt', fileSize: 200, status,
    progress: status === 'SUCCESS' ? 100 : 5, parseStatus: status === 'SUCCESS' ? 'COMPLETED' : 'UPLOADED',
    chunkCount: status === 'SUCCESS' ? 6 : 0, totalPages: 4, processedPages: status === 'SUCCESS' ? 4 : 0, createdAt: '2026-10-13T15:00:00' }
}
async function fixture() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const state = { documents: [], steps: new Map(), progressReads: 0, failProgress: false, slowProgress: false, duplicate: false, uploadStatus: 'PROCESSING', uploads: 0, loggedIn: true, concurrent: 0, maxConcurrent: 0 }
  const errors = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (url.hostname !== 'campus.test') return route.abort()
    if (path.startsWith('/api/')) {
      let data = {}, status = 200
      if (path === '/api/auth/me') { data = { id: 2, username: 'admin', displayName: '系统管理员', role: 'ADMIN' }; status = state.loggedIn ? 200 : 401 }
      else if (path === '/api/auth/csrf') data = { token: 'test', headerName: 'X-XSRF-TOKEN' }
      else if (path === '/api/auth/logout') state.loggedIn = false
      else if (path === '/api/chat/conversations') data = []
      else if (path === '/api/admin/documents' && method === 'POST') {
        state.uploads++
        const d = state.duplicate ? state.documents[0] : document('doc-' + state.uploads, undefined, state.uploadStatus)
        if (!state.duplicate) state.documents.unshift(d)
        data = { duplicate: state.duplicate, document: { ...d }, documentId: d.id, status: d.status }
      }
      else if (path === '/api/admin/documents') data = { items: state.documents.map(d => ({ ...d })), total: state.documents.length }
      else if (/^\/api\/admin\/documents\/[^/]+\/progress$/.test(path)) {
        state.progressReads++; state.concurrent++; state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent)
        const id = path.split('/').at(-2), d = state.documents.find(d => d.id === id)
        if (state.slowProgress) await new Promise(resolve => setTimeout(resolve, 2500))
        if (state.failProgress) { state.failProgress = false; status = 503 }
        else if (!d) status = 404
        else {
          const step = state.steps.get(id)?.shift()
          if (step) Object.assign(d, step)
          data = { ...d }
        }
        state.concurrent--
      }
      else if (path.endsWith('/reprocess')) {
        const d = state.documents.find(d => d.id === path.split('/').at(-2))
        Object.assign(d, { status: 'PROCESSING', progress: 5, parseStatus: 'UPLOADED', processedPages: 0, chunkCount: 0, errorMessage: null })
        data = { ...d }
      }
      else if (/^\/api\/admin\/documents\/[^/]+$/.test(path)) data = state.documents.find(d => d.id === path.split('/').at(-1))
      else if (path === '/api/admin/overview') data = { total: state.documents.length, success: 0, processing: 0, failed: 0, recentDocuments: [] }
      else if (path === '/api/services') data = []
      else if (path.endsWith('/applications')) data = { items: [], total: 0 }
      else if (path === '/api/v1/health') data = { status: 'UP' }
      else if (path === '/api/admin/config') data = { maxUploadSizeMb: 20 }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 'OK' : 'TEST_FAILURE', message: status === 503 ? '测试网络中断' : '', data }) })
    }
    const file = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
    if (!/^(?:assets\/)?[\w.-]+\.(html|css|js)$/.test(file)) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: { html: 'text/html', js: 'text/javascript', css: 'text/css' }[file.split('.').at(-1)], body: await readFile(new URL('../../dist/' + file, import.meta.url)) })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.goto('http://campus.test/#/policy-mgr')
  await page.locator('#policyTableBody').waitFor()
  await page.getByText('暂无文档，请上传政策文件').waitFor()
  const upload = () => page.locator('#policyUploadInput').setInputFiles({ name: '学校奖学金管理办法.txt', mimeType: 'text/plain', buffer: Buffer.from('奖学金申请条件和办理流程。') })
  return { context, page, state, errors, upload }
}
try {
  const { context, page, state, errors, upload } = await fixture()
  await upload()
  const row = page.locator('tr[data-document-id="doc-1"]')
  await row.waitFor()
  check(await row.getByRole('progressbar').getAttribute('aria-valuenow') === '5', 'processing percentage appears in the list immediately after upload')
  check((await page.locator('#policyStatusTags').innerText()).includes('处理中 1'), 'processing count updates after upload')
  state.steps.set('doc-1', [{ progress: 45, parseStatus: 'OCR_PROCESSING', processedPages: 2 },
    { status: 'SUCCESS', progress: 100, parseStatus: 'COMPLETED', processedPages: 4, chunkCount: 6 }])
  await row.getByRole('progressbar').filter({ has: page.locator('.progress-fill') }).waitFor()
  await page.waitForFunction(() => document.querySelector('#policyUploadStatus [role="progressbar"]')?.getAttribute('aria-valuenow') === '45')
  check((await row.innerText()).includes('正在识别扫描内容') && (await row.innerText()).includes('2/4 页'), 'real stage and page counts advance automatically')
  await page.waitForTimeout(300)
  await page.screenshot({ path: fileURLToPath(new URL('processing-light.png', output)) })
  await page.locator('#userMenuToggle').click(); await page.locator('#themeDark').click(); await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.screenshot({ path: fileURLToPath(new URL('processing-dark.png', output)) })
  await page.locator('#policyUploadStatus.is-success').waitFor()
  check((await page.locator('#policyStatusTags').innerText()).includes('已索引 1') && (await page.locator('#policyStatusTags').innerText()).includes('处理中 0'), 'successful completion updates counters without refresh')
  check((await row.innerText()).includes('已索引') && (await row.locator('td').nth(4).innerText()) === '6', 'successful completion updates status and chunk count')
  check(await page.locator('#toastHost .success').filter({ hasText: '解析成功，已建立索引' }).count() === 1, 'completion shows one success notification')
  await page.screenshot({ path: fileURLToPath(new URL('completed-dark.png', output)) })
  const completedReads = state.progressReads
  await page.waitForTimeout(2200)
  check(state.progressReads === completedReads, 'polling stops after terminal status')

  await row.getByRole('button', { name: '重建索引', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#policyUploadStatus [role="progressbar"]')?.getAttribute('aria-valuenow') === '5')
  state.failProgress = true
  state.steps.set('doc-1', [{ progress: 82, parseStatus: 'EMBEDDING', processedPages: 4 }, { status: 'SUCCESS', progress: 100, parseStatus: 'COMPLETED', chunkCount: 8 }])
  await page.locator('#policyUploadStatus').getByText('暂时无法获取最新进度，正在自动重试…').waitFor()
  await page.waitForFunction(() => document.querySelector('#policyUploadStatus [role="progressbar"]')?.getAttribute('aria-valuenow') === '82')
  check(true, 'temporary progress failure retries and resumes automatically')
  await row.getByRole('button', { name: '查看', exact: true }).click()
  await page.locator('#docProgressFill').waitFor()
  await page.locator('#docDetailStatus').getByText('已索引', { exact: true }).waitFor()
  check(await page.locator('#docDetailChunks').innerText() === '8', 'open document details share live status and chunk updates')
  await page.evaluate(() => CampusActions.closeModal())

  await upload()
  const second = page.locator('tr[data-document-id="doc-2"]')
  await second.waitFor()
  await second.getByRole('button', { name: '查看', exact: true }).click()
  await page.locator('#docProgressFill').waitFor()
  await page.evaluate(() => CampusActions.closeModal())
  state.steps.set('doc-2', [{ status: 'FAILED', parseStatus: 'FAILED', errorMessage: '文档没有可解析文本，请重新上传。' }])
  await page.locator('#policyUploadStatus.is-failed').waitFor()
  check((await second.innerText()).includes('文档没有可解析文本'), 'closing detail does not stop list polling and failure reason is visible')
  check((await page.locator('#policyStatusTags').innerText()).includes('失败 1'), 'failure count updates automatically')
  check(await page.locator('#toastHost .error').filter({ hasText: '解析失败' }).count() === 1, 'failed completion notifies once')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: fileURLToPath(new URL('failed-mobile.png', output)) })
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'progress and counts fit mobile screen')
  await page.setViewportSize({ width: 1440, height: 1000 })

  state.uploadStatus = 'SUCCESS'
  await upload()
  await page.locator('tr[data-document-id="doc-3"]').waitFor()
  check(await page.locator('#policyUploadStatus [role="progressbar"]').getAttribute('aria-valuenow') === '100', 'upload already completed by backend shows 100% immediately')
  state.duplicate = true
  await upload()
  await page.locator('#toastHost').getByText('文件已存在，跳过上传').waitFor()
  check(state.documents.length === 3, 'duplicate upload retains existing terminal state')

  state.duplicate = false; state.uploadStatus = 'PROCESSING'; state.slowProgress = true
  await upload()
  await page.locator('tr[data-document-id="doc-5"]').waitFor()
  await page.waitForFunction(() => document.querySelector('#policyUploadStatus').innerText.includes('等待解析'))
  await page.waitForTimeout(2200)
  check(state.concurrent === 1, 'one progress request is in flight')
  await page.evaluate(() => CampusActions.navigate('search'))
  await page.locator('#searchInput').waitFor()
  const leavingReads = state.progressReads
  await page.waitForTimeout(4800)
  check(state.progressReads === leavingReads && state.maxConcurrent === 1, 'leaving page stops polling and late responses do not overlap or restart it')
  check(await page.locator('#policyUploadStatus').count() === 0, 'late response does not modify another page')
  state.slowProgress = false
  await page.evaluate(() => CampusActions.navigate('policy-mgr'))
  await page.locator('tr[data-document-id="doc-5"]').waitFor()
  state.steps.set('doc-5', [{ status: 'SUCCESS', progress: 100, parseStatus: 'COMPLETED', processedPages: 4, chunkCount: 4 }])
  await page.locator('tr[data-document-id="doc-5"] .tag-active').waitFor()
  check((await page.locator('#policyStatusTags').innerText()).includes('处理中 0'), 'returning page resumes tracking existing processing tasks')
  check(errors.length === 0, 'no runtime errors: ' + errors.join('; '))
  await context.close()
  console.log(`PASS: ${checks} policy upload, progress, completion and lifecycle checks.`)
} finally { await browser.close() }
