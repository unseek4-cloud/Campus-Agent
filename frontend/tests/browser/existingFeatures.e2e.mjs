import { loginContext } from './auth.helpers.mjs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const baseUrl = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext()
await loginContext(context, baseUrl, 'ADMIN')
const page = await context.newPage()
page.setDefaultTimeout(90_000)
const created = []
const tag = `CA-PROGRESS-${Date.now()}`
const errors = []
page.on('pageerror', error => errors.push(error.message))

async function upload(file) {
  await page.goto(baseUrl + '/admin/documents')
  await page.getByRole('button', { name: '上传文档', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(file)
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/admin/documents') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始上传', exact: true }).click()
  const response = await responsePromise
  assert.equal(response.ok(), true)
  const result = (await response.json()).data
  assert.equal(result.duplicate, false)
  created.push(result.document.id)
  console.log('Uploaded temporary test document: ' + file.name)
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const progress = await context.request.get(baseUrl + '/api/admin/documents/' + result.document.id + '/progress')
    assert.equal(progress.ok(), true)
    const document = (await progress.json()).data
    if (document.status === 'FAILED') throw Error(`Document failed: ${document.errorMessage}`)
    if (document.status === 'SUCCESS') {
      assert.ok(document.chunkCount > 0)
      console.log(`PASS ${file.name}: status=SUCCESS chunks=${document.chunkCount} ocr=${document.ocrProvider}`)
      return document
    }
    await page.waitForTimeout(1500)
  }
  throw Error('Document processing timed out')
}
try {
  const txt = await upload({ name: `${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from(
    `CampusAgent 软件回归测试资料（临时验收数据，不代表学校政策）。\n紫杉进度验收样例的校验编号为 ${tag}。\n此编号用于验证文档上传、文本解析、切分、向量化、检索、重排和千问问答链路。\n本测试不涉及学生真实信息、办理申请或学校审批。验收结束后该测试资料将被删除。`, 'utf8') })
  assert.equal(txt.ocrProvider, 'none')
  const ragResponse = await context.request.post(baseUrl + '/api/rag/chat', { data: { query: '紫杉进度验收样例的校验编号是什么？' }, timeout: 120_000 })
  assert.equal(ragResponse.ok(), true)
  const rag = (await ragResponse.json()).data
  assert.equal(rag.type, 'QA'); assert.ok(rag.usedContextCount > 0)
  assert.ok(rag.sources.some(source => source.documentId === txt.id))
  assert.ok(rag.answer.includes(tag), 'Qwen must answer with the uploaded evidence')
  console.log(`PASS real RAG + Qwen: retrieval=${rag.retrievalCount} rerank=${rag.rerankCount} context=${rag.usedContextCount}; answer contains test evidence`)

  const fixture = await context.newPage({ viewport: { width: 1100, height: 600 } })
  await fixture.setContent(`<main style="font-family:Microsoft YaHei,sans-serif;padding:35px;background:white;color:#111"><h1>CampusAgent OCR 回归验收</h1><p style="font-size:26px">测试编号：${tag}</p><p style="font-size:26px">这是临时软件测试图片，不代表学校政策。</p><p style="font-size:26px">本图片用于验证文字识别、切分及向量入库。</p></main>`)
  const png = await fixture.screenshot()
  await fixture.close()
  const ocr = await upload({ name: `${tag}-ocr.png`, mimeType: 'image/png', buffer: png })
  assert.notEqual(ocr.ocrProvider, 'none')
  assert.deepEqual(errors, [])
  console.log('PASS admin document upload UI, text ingestion, live Qwen answer, image OCR and indexing')
} finally {
  for (const id of created) {
    const response = await context.request.delete(baseUrl + '/api/admin/documents/' + id)
    if (!response.ok()) console.error('Cleanup failed for temporary test document ' + id)
    else console.log('Removed temporary test document ' + id)
  }
  await browser.close()
}
