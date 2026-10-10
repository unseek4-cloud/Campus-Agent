// Requires existing database test credentials; creates and cleans only its own conversation.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : new URL('../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const lines = (await readFile(new URL('../../tmp/auth-test-accounts.txt', import.meta.url), 'utf8')).split(/\r?\n/);
const line = lines.find(value => value.includes('20260001') && value.includes(':'));
assert.ok(line, 'Existing student test account must be available');
const password = line.slice(line.indexOf(':') + 1).trim();
const base = process.env.CAMPUS_BASE_URL || 'http://127.0.0.1:5500';
const api = process.env.CAMPUS_API_BASE || 'http://127.0.0.1:8080';
const output = new URL('../../tmp/chat-workspace-live/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(120000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let conversationId, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
async function csrf() {
  const response = await context.request.get(api + '/api/auth/csrf');
  const token = (await response.json()).data;
  return { [token.headerName]: token.token };
}
try {
  await page.addInitScript(() => { try { localStorage.setItem('ca-theme', 'light'); } catch { } });
  await page.goto(base);
  await page.locator('#loginForm').waitFor();
  await page.locator('#loginUser').fill('20260001');
  await page.locator('#loginPass').fill(password);
  await page.locator('#loginBtn').click();
  await page.locator('.qa-empty').waitFor();
  check(await page.evaluate(() => document.body.dataset.route === 'qa'), 'real login lands on QA');
  await page.waitForTimeout(450);
  await page.screenshot({ path: fileURLToPath(new URL('home.png', output)) });
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat/conversations' && r.request().method() === 'POST');
  const answered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/rag/chat' && r.request().method() === 'POST');
  await page.locator('#qaInput').fill('学生证丢了，怎么补办？');
  await page.locator('#qaSend').click();
  const creation = await created;
  check(creation.status() === 200, 'real conversation creation works');
  conversationId = (await creation.json()).data.id;
  const result = await answered;
  const payload = await result.json();
  check(result.status() === 200, 'real Java chat returns success');
  check(payload.data.type === 'SERVICE_GUIDE', 'Java recognizes the service intent');
  check(payload.data.conversationId === conversationId, 'Java persists this conversation');
  await page.locator('.service-guide').waitFor();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '0', 'real guide starts with zero user confirmations');
  const ordered = [...payload.data.steps].sort((a, b) => a.order - b.order);
  check((await page.locator('.guide-current h4').textContent()).includes(ordered[0].title), 'real current step matches sorted backend DTO');
  if (ordered.length > 1) {
    await page.locator('[data-guide-action="complete"]').click();
    await page.locator('.guide-current h4').filter({ hasText: ordered[1].title }).waitFor();
    await page.waitForTimeout(550);
    await page.reload();
    await page.locator('.guide-current h4').filter({ hasText: ordered[1].title }).waitFor();
    check(true, 'real historical DTO restores personal progress');
  }
  const downloads = page.locator('.guide-download');
  if (await downloads.count()) {
    const response = await context.request.get(await downloads.first().getAttribute('href'));
    check(response.status() === 200, 'real material template downloads');
  }
  await page.locator('#chatBody').evaluate(el => el.scrollTop = 0);
  await page.waitForTimeout(450);
  await page.screenshot({ path: fileURLToPath(new URL('guide.png', output)) });
  await page.locator('.msg.bot [data-act="share"]').click();
  await page.locator('[data-sb="link"]').click();
  await page.locator('#shareLinkInput').waitFor();
  const url = await page.locator('#shareLinkInput').inputValue();
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(url);
  await visitor.locator('.share-page-body .service-guide').waitFor();
  check(await visitor.locator('.share-page-body .msg').count() === 1, 'real anonymous share includes only selected answer');
  check(await visitor.locator('[data-guide-action]').count() === 0, 'real anonymous share is read-only');
  await page.locator('#shareLinkRevoke').click();
  await page.waitForFunction(() => !document.querySelector('#detailModal').classList.contains('show'));
  await visitor.reload();
  await visitor.getByText('分享链接不存在或已失效', { exact: false }).waitFor();
  check(true, 'real revoked share cannot be opened');
  await visitorContext.close();
  await page.locator('[data-guide-action="apply"]').click();
  await page.locator('#detailModal.show #appService').waitFor();
  check(await page.locator('#appService').inputValue() === String(payload.data.service.id), 'real application entry uses backend service ID');
  check(errors.length === 0, 'no browser runtime errors in real integration');
  console.log(`PASS: ${checks} checks against real Java/MySQL (AI offline service-guide fallback).`);
} finally {
  if (conversationId) {
    const removed = await context.request.delete(`${api}/api/chat/conversations/${conversationId}`, { headers: await csrf() });
    assert.equal(removed.status(), 200, 'Only the test-created conversation must be cleaned');
    console.log('Test-created conversation and shares cleaned.');
  }
  try { await context.request.post(api + '/api/auth/logout', { headers: await csrf() }); } catch { }
  await browser.close();
}
