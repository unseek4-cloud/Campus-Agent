// Real Java + disposable MySQL + the unified Vue frontend in headless Edge. AI is a deterministic HTTP fixture.
// Requires a built JAR, local MySQL CREATE DATABASE permission, and Playwright (see docs/ai-reply-feedback.md).
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as httpServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer as viteServer } from '../frontend/node_modules/vite/dist/node/index.js'
import vue from '../frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs'
const root = fileURLToPath(new URL('../',import.meta.url)), output=new URL('../tmp/feedback-browser/',import.meta.url)
await mkdir(output,{recursive:true})
const moduleURL = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : new URL('../frontend/node_modules/playwright-core/index.mjs',import.meta.url).href
const { chromium } = await import(moduleURL)
let settings = {}
try { settings=Object.fromEntries((await readFile(new URL('../backend/.env',import.meta.url),'utf8')).split(/\r?\n/).filter(s=>/^\s*[A-Z_]+\s*=/.test(s)).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')]})) } catch {}
const dbURL=process.env.DB_URL || settings.DB_URL || 'jdbc:mysql://localhost:3306/campus_agent', dbUser=process.env.DB_USERNAME || settings.DB_USERNAME, dbPass=process.env.DB_PASSWORD ?? settings.DB_PASSWORD
assert.ok(dbUser&&dbPass!==undefined,'Configure MySQL credentials in backend/.env or DB_USERNAME/DB_PASSWORD')
const match=dbURL.match(/^jdbc:mysql:\/\/([^:/]+)(?::(\d+))?\//);assert.ok(match,'Expected a MySQL JDBC URL')
const database=`campus_feedback_test_${Date.now()}`
assert.match(database,/^campus_feedback_test_\d+$/)
const mysql=process.env.MYSQL_BINARY || 'mysql', jar=fileURLToPath(new URL('../backend/campus-app/target/campus-app-0.1.0-SNAPSHOT.jar',import.meta.url))
const mysqlArgs=['--host='+match[1],'--port='+(match[2] || '3306'),'--user='+dbUser,'--default-character-set=utf8mb4','--batch','--skip-column-names']
const mysqlEnv={...process.env,MYSQL_PWD:dbPass}
function sql(query, use=true) { return execFileSync(mysql,[...mysqlArgs,...(use?['--database='+database]:[])],{input:query,encoding:'utf8',env:mysqlEnv,windowsHide:true}).trim() }
const password=randomBytes(20).toString('base64url'), backend='http://127.0.0.1:18080', uiBase='http://127.0.0.1:15173'
async function chooseTheme(page, theme) {
  await page.locator('#userMenuToggle').click();
  await page.locator(theme === 'dark' ? '#themeDark' : '#themeLight').click();
  await page.keyboard.press('Escape');
}
let created=false, java, ai, vite, browser, debugPage, checks=0
const errors=[]
const check=(condition,message)=>{assert.ok(condition,message);checks++}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function listen(server,port) { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)}) }
async function login(context,name) {
  const csrf=(await (await context.request.get(backend+'/api/auth/csrf')).json()).data
  const response=await context.request.post(backend+'/api/auth/login',{headers:{[csrf.headerName]:csrf.token},data:{username:name,password}})
  assert.equal(response.status(),200)
}
async function write(context,method,path,data) {
  const csrf=(await (await context.request.get(backend+'/api/auth/csrf')).json()).data
  return context.request[method](backend+path,{headers:{[csrf.headerName]:csrf.token},data})
}
async function read(context,path) { const r=await context.request.get(backend+path);assert.equal(r.status(),200);return (await r.json()).data }
async function fixture(name,base) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']})
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort())
  await context.addInitScript(api=>{window.CAMPUS_API_BASE=api;localStorage.setItem('ca-theme','light')},backend)
  await login(context,name)
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
  debugPage=page
  await page.goto(base,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>document.body.dataset.auth==='in'&&!!document.body.dataset.route)
  return {context,page}
}
async function workspaceAsk(page,question) {
  await page.locator('#qaInput').fill(question)
  const response=page.waitForResponse(r=>r.url().endsWith('/api/rag/chat')&&r.request().method()==='POST')
  await page.locator('#qaSend').click();const result=await response;assert.equal(result.status(),200)
  const turn=(await result.json()).data
  await page.locator(`.msg.bot[data-msg-id="${turn.assistantMessageId}"] .reply-icon`).first().waitFor()
  return turn
}
try {
  sql(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,false);created=true
  const hash=execFileSync('java',['-Dloader.main=com.campusagent.identity.tools.PasswordHashTool','-cp',jar,'org.springframework.boot.loader.launch.PropertiesLauncher'],{input:password+'\n',encoding:'utf8',windowsHide:true}).trim()
  const resources=new URL('../backend/campus-app/src/main/resources/',import.meta.url)
  for(const file of ['schema.sql','db/migration/V3__service_guide.sql','db/migration/V4__material_attachments.sql','db/migration/V5__auth_rbac.sql','db/migration/V6__service_application.sql','db/migration/V7__chat_history.sql','db/migration/V8__conversation_share.sql','db/migration/V9__reply_feedback.sql'])sql(await readFile(new URL(file,resources),'utf8'))
  for(const [name,role] of [['feedback-student','STUDENT'],['feedback-second','STUDENT'],['feedback-admin','ADMIN'],['feedback-scoped','ADMIN']])sql(`INSERT INTO user_account(username,password_hash,display_name,role) VALUES ('${name}','${hash}','${name}','${role}');`)
  const studentId=Number(sql("SELECT id FROM user_account WHERE username='feedback-student'"))
  sql("INSERT INTO ai_feedback_admin_access(admin_id,access_scope) SELECT id,CASE WHEN username='feedback-admin' THEN 'ALL' ELSE 'ASSIGNED' END FROM user_account WHERE role='ADMIN';")
  sql(`INSERT INTO ai_feedback_admin_user_scope(admin_id,user_id) SELECT id,${studentId} FROM user_account WHERE username='feedback-scoped';`)
  ai=httpServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{}
    const data=req.url.includes('/recognize')?{matched:false,queryIntent:'GENERAL_QA'}:{answer:`根据学校通知，问题“${body.query}”的答复为：请按规定准备材料并核对申请条件。`,sources:[{documentId:'feedback-doc',fileName:'奖学金申请指南.pdf',pageNumber:2,chunkIndex:3,score:.9,rerankScore:.8,content:'申请人须符合学校通知中的学习与品行要求。<script>window.injected=true</script>'}],retrievalCount:10,rerankCount:5,usedContextCount:1,rewrittenQuery:body.query}
    await wait(100);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:'OK',message:'成功',data}))
  });await listen(ai,18000)
  const log=createWriteStream(new URL('backend.log',output))
  java=spawn('java',['-Duser.timezone=Asia/Shanghai','-jar',jar],{cwd:root,windowsHide:true,env:{...process.env,DB_URL:`jdbc:mysql://${match[1]}:${match[2] || 3306}/${database}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true`,DB_USERNAME:dbUser,DB_PASSWORD:dbPass,JWT_SECRET:randomBytes(32).toString('base64'),SERVER_PORT:'18080',AI_SERVICE_BASE_URL:'http://127.0.0.1:18000',AUTH_ALLOWED_ORIGINS:uiBase+','+uiBase}})
  java.stdout.pipe(log);java.stderr.pipe(log)
  let healthy=false;for(let i=0;i<150;i++){try{if((await fetch(backend+'/api/v1/health')).ok){healthy=true;break}}catch{}await wait(200)}
  assert.ok(healthy,'Temporary Java backend must start; inspect tmp/feedback-browser/backend.log')
  vite=await viteServer({configFile:false,root:fileURLToPath(new URL('../frontend/',import.meta.url)),plugins:[vue()],server:{host:'127.0.0.1',port:15173,strictPort:true,proxy:{'/api':{target:backend,changeOrigin:true}}},logLevel:'error'});await vite.listen()
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
  const {context,page}=await fixture('feedback-student',uiBase)
  await page.locator('#qaInput').waitFor()
  const first=await workspaceAsk(page,'奖学金的申请条件是什么？'), second=await workspaceAsk(page,'需要准备哪些材料？')
  const reply=page.locator(`.msg.bot[data-msg-id="${first.assistantMessageId}"]`)
  assert.deepEqual(await reply.locator('.reply-icon').evaluateAll(buttons=>buttons.map(b=>b.dataset.act)),['copy','feedback','share','regenerate','more']);checks++
  await reply.locator('[data-act="copy"]').click();check((await page.evaluate(()=>navigator.clipboard.readText())).includes('学校通知'),'clipboard uses existing copy behavior')
  async function rateStatic(value) {await reply.locator('[data-act="feedback"]').click();await page.getByRole('menuitem',{name:value,exact:true}).click()}
  await rateStatic('回复优秀');await page.waitForFunction(()=>document.querySelector('.msg.bot').dataset.rating==='POSITIVE')
  await rateStatic('回复优秀');await page.waitForFunction(()=>!document.querySelector('.msg.bot').dataset.rating)
  await rateStatic('回复不佳');await page.locator('[data-reason=INCORRECT]').click();await page.locator('.feedback-submit').click();await page.waitForFunction(()=>document.querySelector('.msg.bot').dataset.rating==='NEGATIVE')
  check(Number(sql('SELECT COUNT(*) FROM ai_reply_feedback'))===1,'submit/change/cancel keep one MySQL row')
  await page.reload();await reply.locator('[data-act="feedback"].is-rated').waitFor()
  check(await reply.getAttribute('data-rating')==='NEGATIVE','refresh restores selected feedback')
  await reply.locator('[data-act="feedback"]').click();await page.screenshot({path:fileURLToPath(new URL('toolbar-light.png',output)),fullPage:true});await page.keyboard.press('Escape')
  await page.route('**/api/chat/messages/*/feedback',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEST_FAILURE',message:'测试保存失败'})}))
  await rateStatic('回复优秀');await page.getByText('测试保存失败',{exact:true}).waitFor();check(await reply.getAttribute('data-rating')==='NEGATIVE','failed request retains old state');await page.unroute('**/api/chat/messages/*/feedback')
  const nextReply=page.locator(`.msg.bot[data-msg-id="${second.assistantMessageId}"]`)
  await nextReply.locator('[data-act="feedback"]').click();await page.getByRole('menuitem',{name:'回复优秀',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-msg-id="${id}"]`).dataset.rating==='POSITIVE',second.assistantMessageId)
  await reply.locator('[data-act="more"]').click();await page.getByRole('menuitem',{name:'查看知识来源'}).click();await page.getByRole('heading',{name:'引用原文',exact:true}).waitFor();await page.evaluate(()=>CampusActions.closeModal());check(!await page.evaluate(()=>window.injected),'citation HTML is escaped')
  await reply.locator('[data-act="more"]').click();await page.getByRole('menuitem',{name:'编辑原问题'}).click();assert.equal(await page.locator('#qaInput').inputValue(),'奖学金的申请条件是什么？');checks++
  await reply.locator('[data-act="share"]').click();check(await page.locator('#shareBar').isVisible(),'sharing reuses existing selection bar')
  await page.locator('#shareBar [data-sb="link"]').click();await page.locator('#shareLinkInput').waitFor();const link=await page.locator('#shareLinkInput').inputValue()
  const visitor=await browser.newContext();await visitor.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());await visitor.addInitScript(api=>window.CAMPUS_API_BASE=api,backend);const publicPage=await visitor.newPage();await publicPage.goto(link,{waitUntil:'domcontentloaded'});await publicPage.locator('#sharePageExportImg').waitFor();check(!(await publicPage.content()).includes('adminNote'),'public share does not expose private feedback');await visitor.close()
  await page.evaluate(()=>{CampusActions.closeModal();CampusActions.exitShareSelect()})
  const regen=page.waitForResponse(r=>r.url().endsWith('/regenerate'));await reply.locator('[data-act="regenerate"]').click();assert.equal((await regen).status(),200);await page.waitForFunction(()=>document.querySelectorAll('.msg.bot').length===3);check(await reply.getAttribute('data-rating')==='NEGATIVE','regeneration preserves original rating and answer')
  await page.evaluate(()=>CampusActions.newConversation());await workspaceAsk(page,'另一个会话的问题')
  await page.locator('.conv-main').filter({hasText:'奖学金的申请条件是什么？'}).click();await reply.locator('[data-act="feedback"].is-rated').waitFor();check(await reply.getAttribute('data-rating')==='NEGATIVE','history switch restores feedback')
  await chooseTheme(page, 'dark');await wait(800);await reply.locator('[data-act="feedback"]').click();await page.screenshot({path:fileURLToPath(new URL('toolbar-dark.png',output)),fullPage:true});await page.keyboard.press('Escape')
  await page.setViewportSize({width:390,height:844});await reply.locator('[data-act="feedback"]').click();await page.screenshot({path:fileURLToPath(new URL('toolbar-mobile.png',output)),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile toolbar fits screen');await page.keyboard.press('Escape')
  console.log('PASS Vue workspace: toolbar order, copy, rating toggle/change/cancel, failure rollback, MySQL restore, history, sources, edit, share, regenerate, themes/mobile')
  const vueUI=await fixture('feedback-second',uiBase), vpage=vueUI.page
  const vt=await workspaceAsk(vpage,'Vue 界面测试问题')
  const vreply=vpage.locator(`.msg.bot[data-msg-id="${vt.assistantMessageId}"]`)
  await vreply.locator('[data-act="feedback"]').click();await vpage.getByRole('menuitem',{name:'回复不佳',exact:true}).click();await vpage.locator('[data-reason=NOT_HELPFUL]').click();await vpage.locator('.feedback-submit').click()
  await vreply.locator('[data-act="feedback"].is-rated').waitFor()
  await vpage.reload();await vreply.locator('[data-act="feedback"].is-rated').waitFor()
  check(await vreply.getAttribute('data-rating')==='NEGATIVE','second user feedback is restored independently')
  // Cross-user writes are checked against the real Java security and MySQL ownership joins.
  for(const method of ['put','delete'])check((await write(vueUI.context,method,`/api/chat/messages/${first.assistantMessageId}/feedback`,method==='put'?{rating:'POSITIVE',userId:studentId}:undefined)).status()===404,'cross-user '+method+' denied')
  check((await vueUI.context.request.get(backend+'/api/admin/ai-quality/summary')).status()===403,'student admin access denied')
  const scopedContext=await browser.newContext();await login(scopedContext,'feedback-scoped')
  const scopedSummary=await read(scopedContext,'/api/admin/ai-quality/summary?scope=ALL');check(scopedSummary.total===2,'assigned scope restricts stats and ignores forged scope')
  const adminUI=await fixture('feedback-admin',uiBase),apage=adminUI.page;await apage.evaluate(()=>CampusActions.navigate('ai-quality'));await apage.locator('.quality-stat strong').first().waitFor()
  const stats=await read(adminUI.context,'/api/admin/ai-quality/summary'),statsFromUI=await apage.locator('.quality-stat strong').allTextContents();assert.deepEqual(statsFromUI,[String(stats.total),String(stats.positive),String(stats.negative),stats.positiveRate+'%']);checks++
  check(stats.total===3&&stats.positive===1&&stats.negative===2,'MySQL distribution matches effective ratings')
  check(await apage.locator('.quality-chart svg').count()===2,'distribution and trend charts rendered')
  await apage.locator('#qualityBadOnly').click();await apage.waitForFunction(()=>document.querySelectorAll('.quality-record').length===2)
  await apage.locator('.quality-record summary').first().click();check((await apage.locator('.quality-source').first().textContent()).includes('feedback-doc'),'admin source snapshot identifies document/chunk')
  await apage.getByRole('button',{name:'标记与处理'}).first().click();await apage.locator('[name="issueType"]').selectOption('RETRIEVAL_MISMATCH');await apage.locator('[name="handlingStatus"]').selectOption('IN_PROGRESS');await apage.locator('[name="adminNote"]').fill('核查关键词召回与引用片段');await apage.getByRole('button',{name:'保存处理结果',exact:true}).click();await apage.getByText('处理备注：核查关键词召回与引用片段',{exact:true}).waitFor()
  await apage.locator('#qualityFilters').evaluate(form=>form.reset());await apage.waitForFunction(()=>document.querySelectorAll('.quality-record').length===3);await apage.screenshot({path:fileURLToPath(new URL('quality-light.png',output)),fullPage:true})
  await chooseTheme(apage, 'dark');await wait(800);await apage.screenshot({path:fileURLToPath(new URL('quality-dark.png',output)),fullPage:true});await apage.setViewportSize({width:390,height:844});check(await apage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'admin mobile fits screen');await apage.screenshot({path:fileURLToPath(new URL('quality-mobile.png',output)),fullPage:true})
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());await apage.locator('#qualityStart').fill(today);await apage.locator('#qualityEnd').fill(today);await apage.getByRole('button',{name:'查询',exact:true}).click();await apage.waitForFunction(()=>document.querySelectorAll('.quality-record').length===3)
  const scopedRows=await read(scopedContext,'/api/admin/ai-quality/feedback');const hidden=(await read(adminUI.context,'/api/admin/ai-quality/feedback')).items.find(item=>!scopedRows.items.some(v=>v.id===item.id))
  check((await write(scopedContext,'patch',`/api/admin/ai-quality/feedback/${hidden.id}`,{issueType:'OTHER',handlingStatus:'RESOLVED',adminNote:'越权',version:hidden.version})).status()===404,'scoped admin cannot review hidden feedback')
  check(errors.length===0,'No browser runtime errors: '+errors.join('; '))
  console.log(`PASS ${checks} checks: the unified admin dashboard, statistics/charts/filter/review, scoped access, ownership, no runtime errors.`)
} catch (error) {
  if(debugPage&&!debugPage.isClosed()) { await debugPage.screenshot({path:fileURLToPath(new URL('failure.png',output)),fullPage:true});await writeFile(new URL('failure.html',output),await debugPage.content()) }
  throw error
} finally {
  await browser?.close();await vite?.close()
  if(java){java.kill();await wait(1000)}
  if(ai)await new Promise(resolve=>ai.close(resolve))
  if(created)sql(`DROP DATABASE ${database};`,false)
}
console.log('PASS cleanup: only the disposable MySQL database and temporary services were removed.')
