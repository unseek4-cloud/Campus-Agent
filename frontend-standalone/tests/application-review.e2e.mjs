import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const output = new URL('../../tmp/application-review/', import.meta.url);
await mkdir(output, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('ca-theme', 'light'));
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  let application = { id: 10, applicationNo: 'CA2026101200000010', serviceName: '宿舍报修',
    status: 'SUBMITTED', version: 0, applicantName: '测试学生', studentRemark: '空调故障' };
  let failNext = false;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'campus.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname, method = route.request().method();
      const headers = { 'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true' };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers,
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      let data = {}, status = 200;
      if (path === '/api/auth/me') data = { id: 2, role: 'ADMIN', username: 'admin', displayName: '系统管理员' };
      else if (path === '/api/auth/csrf') data = { token: 'test-token', headerName: 'X-XSRF-TOKEN' };
      else if (path === '/api/admin/applications/10/review') {
        requests.push(route.request().postDataJSON());
        await new Promise(resolve => setTimeout(resolve, 150));
        if (failNext) { status = 409; failNext = false; }
        else { application = { ...application, status: requests.at(-1).status, version: application.version + 1,
          adminRemark: requests.at(-1).remark }; }
        data = { application, events: [], attachments: [] };
      }
      else if (path === '/api/admin/applications/10') data = { application, events: [], attachments: [] };
      else if (path === '/api/admin/applications') data = { items: [application], total: 1 };
      else if (path === '/api/chat/conversations') data = [];
      else if (path === '/api/admin/services' || path === '/api/services') data = [];
      else if (path === '/api/admin/documents') data = { items: [], total: 0 };
      else if (path === '/api/admin/overview') data = { total: 0, success: 0, failed: 0, processing: 0, recentDocuments: [] };
      else if (path === '/api/v1/health') data = { status: 'UP' };
      return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify({
        code: status === 200 ? 'OK' : 'CONFLICT', message: status === 200 ? '成功' : '申请已被更新，请刷新申请', data }) });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return route.fulfill({ body: await readFile(new URL('../' + path, import.meta.url)),
      contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto('http://campus.test/');
  await page.waitForFunction(() => document.body.dataset.auth === 'in');
  const open = async () => { await page.evaluate(() => window.openReviewDialog(10)); await page.locator('#reviewRemark').waitFor(); };
  const advance = async status => { await page.locator(`[data-review="${status}"]`).click(); };
  const closed = () => page.waitForFunction(() => !document.querySelector('#detailModal').classList.contains('show'));
  await open();
  await page.locator('#reviewRemark').fill('材料齐全，维修已完成');
  await advance('REVIEWING');
  check(await page.locator('#reviewRemark').inputValue() === '材料齐全，维修已完成', 'opinion survives starting review');
  check(requests.length === 0, 'starting review stays local until final submission');
  await advance('APPROVED');
  check(await page.locator('[data-review="COMPLETED"]').isVisible(), 'next stage is available in the same dialog');
  check(requests.length === 0, 'approval does not separately submit');
  await page.locator('[data-review-back]').click();
  check(await page.locator('[data-review="REJECTED"]').isVisible(), 'can return and revise the decision');
  await advance('APPROVED'); await advance('COMPLETED');
  check(await page.locator('#reviewRemark').inputValue() === '材料齐全，维修已完成', 'one opinion survives all stages');
  check(await page.locator('.review-flow-steps .is-done').count() === 3, 'all completed review stages are marked');
  await page.screenshot({ path: fileURLToPath(new URL('continuous-review.png', output)) });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator('#detailModal .detail-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1), 'mobile review has no horizontal overflow');
  await page.screenshot({ path: fileURLToPath(new URL('continuous-review-mobile.png', output)) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-review-submit]').dblclick(); await closed();
  check(requests.length === 1, 'all review stages submit once even on double click');
  assert.deepEqual(requests[0], { status: 'COMPLETED', remark: '材料齐全，维修已完成', version: 0 }); checks++;
  application = { ...application, status: 'SUBMITTED', version: 4 };
  await open(); await advance('REVIEWING'); await advance('NEED_MORE');
  await page.locator('[data-review-submit]').click();
  check(await page.locator('#reviewErr').innerText().then(text => text.includes('必须填写')), 'supplement decision requires an opinion');
  check(requests.length === 1, 'invalid decision does not submit');
  await page.locator('#reviewRemark').fill('请补充故障照片');
  failNext = true;
  await page.locator('[data-review-submit]').click();
  await page.locator('#reviewErr').getByText('申请已被更新，请刷新申请').waitFor();
  check(await page.locator('#reviewRemark').inputValue() === '请补充故障照片', 'failed submission preserves opinion');
  check(await page.locator('[data-review-back]').isEnabled(), 'failed submission permits correcting the decision');
  await page.locator('[data-review-submit]').click(); await closed();
  check(requests.at(-1).status === 'NEED_MORE' && requests.at(-1).version === 4, 'supplement is one final review request');
  application = { ...application, status: 'REVIEWING', version: 5 };
  await open(); await advance('REJECTED');
  await page.locator('[data-review-submit]').click();
  check(await page.locator('#reviewErr').innerText().then(text => text.includes('必须填写')), 'rejection requires an opinion');
  await page.locator('#reviewRemark').fill('不符合维修范围');
  await page.locator('[data-review-submit]').click(); await closed();
  check(requests.at(-1).status === 'REJECTED', 'existing reviewing application can be rejected');
  application = { ...application, status: 'APPROVED', version: 6 };
  await open(); await advance('COMPLETED');
  await page.locator('[data-review-submit]').click(); await closed();
  check(requests.at(-1).status === 'COMPLETED' && requests.at(-1).version === 6, 'existing approved application can complete');
  assert.deepEqual(errors, [], 'no browser runtime errors'); checks++;
  await context.close();
  console.log(`PASS: ${checks} continuous-review browser checks.`);
} finally { await browser.close(); }
