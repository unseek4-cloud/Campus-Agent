import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { credentials, loginApi } from './auth.helpers.mjs'

const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href
const { chromium } = await import(moduleUrl)
const base = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5173'
const output = new URL('../../../tmp/chat-history-browser/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage(); page.setDefaultTimeout(120_000)
const errors = []; page.on('pageerror', error => errors.push(error.message))
const created = []
async function csrf(api) { const data = (await (await api.get(base+'/api/auth/csrf')).json()).data; return { [data.headerName]: data.token } }
async function uiLogin(account) {
  await page.goto(base+'/login')
  await page.getByRole('textbox', { name: '账号' }).fill(account.username)
  await page.getByPlaceholder('请输入密码').fill(account.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(base+'/')
}
async function list() { return (await (await context.request.get(base+'/api/chat/conversations')).json()).data }
async function read(id) { return (await (await context.request.get(base+`/api/chat/conversations/${id}/messages`)).json()).data }
async function fresh() {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/chat/conversations') && r.request().method()==='POST')
  await page.getByRole('button',{name:'新建对话',exact:true}).click()
  const id = (await (await pending).json()).data.id; created.push(id)
  await page.waitForFunction(id => document.querySelector('.history-item.selected .history-select') && document.querySelectorAll('.chat-message').length === 0, id)
  return id
}
async function ask(question) {
  await page.locator('textarea').fill(question)
  const response = page.waitForResponse(r => r.url().endsWith('/api/rag/chat') && r.request().method()==='POST')
  await page.getByRole('button',{name:'发送',exact:true}).click()
  const result=await response; assert.equal(result.status(),200)
  const data=(await result.json()).data
  await page.locator('.pending-answer').waitFor({state:'hidden'})
  return data
}
async function expectMessages(count) {
  await page.waitForFunction(n=>document.querySelectorAll('.chat-message').length===n,count)
  return page.locator('.message-content').allTextContents()
}
try {
  await loginApi(context.request,base,credentials())
  await page.goto(base+'/knowledge/search')
  const first = await fresh()
  for (const query of ['国家奖学金申请需要满足什么条件？','需要哪些材料？','申请流程是什么？']) await ask(query)
  const original = await expectMessages(6)
  assert.equal((await read(first)).messages.length,6)
  await page.getByRole('link',{name:'我的办事',exact:true}).click()
  await page.getByRole('link',{name:'AI 问答',exact:true}).click()
  assert.deepEqual(await expectMessages(6),original)
  await page.reload(); assert.deepEqual(await expectMessages(6),original)
  await page.getByRole('button',{name:'退出登录',exact:true}).click(); await page.waitForURL('**/login')
  await uiLogin(credentials()); await page.goto(base+'/knowledge/search')
  assert.deepEqual(await expectMessages(6),original)
  const second=await fresh(); await ask('学生证丢了怎么补办？')
  await page.locator('.history-select').filter({hasText:'国家奖学金申请需要满足什么条件？'}).click()
  assert.deepEqual(await expectMessages(6),original)
  await page.locator('.history-select').filter({hasText:'学生证丢了怎么补办？'}).click()
  await expectMessages(2); await page.locator('.service-guide').waitFor()
  await page.reload(); await expectMessages(2); await page.locator('.service-guide').waitFor()
  await page.getByRole('button',{name:'删除对话：学生证丢了怎么补办？',exact:true}).click()
  await page.getByRole('button',{name:'取消',exact:true}).click(); assert.ok((await list()).some(c=>c.id===second))
  await page.getByRole('button',{name:'删除对话：学生证丢了怎么补办？',exact:true}).click()
  await page.getByRole('button',{name:'删除',exact:true}).last().click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.deepEqual(await expectMessages(6),original)
  assert.equal((await context.request.get(base+`/api/chat/conversations/${second}/messages`)).status(),404)
  await page.evaluate(()=>window.scrollTo(0,0))
  await page.screenshot({path:fileURLToPath(new URL('desktop.png',output)),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.getByRole('button',{name:'展开',exact:true}).click()
  await page.screenshot({path:fileURLToPath(new URL('mobile.png',output)),fullPage:true})
  const other=await browser.newContext()
  try {
    await loginApi(other.request,base,credentials('SECOND_STUDENT'))
    const headers=await csrf(other.request)
    for (const method of ['get','delete']) {
      const suffix=method==='get'?'/messages':''
      assert.equal((await other.request[method](base+`/api/chat/conversations/${first}${suffix}`,{headers})).status(),404)
    }
    assert.ok(!(await (await other.request.get(base+'/api/chat/conversations?userId=1')).json()).data.some(c=>c.id===first))
  } finally { await other.close() }
  const anonymous=await browser.newContext()
  try { assert.equal((await anonymous.request.get(base+'/api/chat/conversations')).status(),401) } finally { await anonymous.close() }
  assert.deepEqual(errors,[])
  console.log('PASS real browser: MySQL persistence, route return, refresh, relogin, 2 conversations, guide restoration, cancel/delete, mobile, cross-user GET/DELETE, anonymous 401')
} finally {
  const headers=await csrf(context.request)
  for (const id of created) await context.request.delete(base+`/api/chat/conversations/${id}`,{headers})
  await browser.close()
}
