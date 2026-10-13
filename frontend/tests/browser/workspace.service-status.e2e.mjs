import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
});
const output = new URL('../../../tmp/service-status/', import.meta.url);
await mkdir(output, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('ca-theme', 'light'));
  const page = await context.newPage();
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  let detail = null, failNext = false;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (url.hostname !== 'campus.test') return route.abort();
    if (path.startsWith('/api/')) {
      let data = {}, status = 200, message = '成功';
      if (path === '/api/auth/me') data = { id: 2, username: 'admin', displayName: '系统管理员', role: 'ADMIN' };
      else if (path === '/api/auth/csrf') data = { token: 'test', headerName: 'X-XSRF-TOKEN' };
      else if (path === '/api/admin/services' && method === 'POST') {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        detail = { ...payload, service: { ...payload.service, id: 33, version: 0,
          materials: payload.service.materials.map((m, i) => ({ ...m, id: 'material-' + i })) } };
        data = detail;
      } else if (path === '/api/admin/services/33' && method === 'PUT') {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        await new Promise(resolve => setTimeout(resolve, 120));
        if (failNext) { status = 503; message = '服务暂时不可用，请重试'; failNext = false; }
        else if (payload.service.version !== detail.service.version) {
          status = 409; message = '事项已被更新，请刷新后重试';
        } else if (payload.service.status === 'ACTIVE' &&
          (!payload.service.recognitionRules.subjects.length || !payload.service.recognitionRules.actions.length)) {
          status = 400; message = '启用事项需要主题词和动作词';
        } else {
          detail = { ...payload, service: { ...payload.service, version: detail.service.version + 1 } };
          data = detail;
        }
      } else if (path === '/api/admin/services/33') data = detail;
      else if (path === '/api/admin/services') data = detail ? [detail.service] : [];
      else if (path === '/api/services') data = detail?.service.status === 'ACTIVE' ? [detail.service] : [];
      else if (path === '/api/chat/conversations') data = [];
      else if (path === '/api/admin/documents') data = { items: [], total: 0 };
      else if (path === '/api/v1/health') data = { status: 'UP' };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({
        code: status === 200 ? 'OK' : 'ERROR', message, data
      }) });
    }
    const asset = path === '/' ? 'index.html' : path.slice(1);
    return route.fulfill({ body: await readFile(new URL('../../dist/' + asset, import.meta.url)),
      contentType: asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' });
  });

  await page.goto('http://campus.test/#/services-mgr');
  await page.waitForFunction(() => document.body.dataset.auth === 'in');
  await page.getByRole('button', { name: '新建事项', exact: true }).click();
  check(await page.getByLabel('事项状态 *', { exact: true }).isVisible(), 'new item has a visible status control');
  await page.locator('#svcCode').fill('TEST_01');
  await page.locator('#svcName').fill('学生证补办1');
  await page.locator('#svcCategory').fill('学籍事务');
  await page.locator('#svcDept').fill('学生工作处');
  await page.locator('#svc-step-0-title').fill('提交补办申请');
  await page.locator('#svc-step-0-description').fill('填写补办信息并提交');
  await page.getByRole('button', { name: '添加材料', exact: true }).click();
  await page.locator('[data-mfield="name"]').fill('申请表');
  await page.locator('#svcSave').click();
  const closed = () => page.waitForFunction(() => !document.querySelector('#detailModal').classList.contains('show'));
  await closed();
  const row = page.locator('#svcBody tr').filter({ hasText: 'TEST_01' });
  await row.getByText('草稿', { exact: true }).waitFor();
  check(detail.service.status === 'DRAFT', 'new item is saved as draft with a Chinese status label');
  // A saved material may already have a template uploaded; status changes must retain it.
  detail.service.materials[0].attachment = { id: 'file-1', filename: '申请表.pdf' };
  const originalSteps = structuredClone(detail.steps), originalMaterials = structuredClone(detail.service.materials);
  const open = async () => {
    await row.getByRole('button', { name: '修改状态', exact: true }).click();
    await page.locator('#svcStatusChange').waitFor();
  };
  await open();
  check(await page.locator('#svcStatusChange').inputValue() === 'DRAFT', 'status dialog uses saved status');
  await page.locator('#svcStatusChange').selectOption('ACTIVE');
  check(await page.locator('#svcStatusSubjects').isVisible(), 'activation exposes missing recognition fields');
  const beforeValidation = writes.length;
  await page.locator('#svcStatusSave').click();
  check((await page.locator('#svcStatusErr').innerText()).includes('主题词和动作词'), 'missing recognition rules get a visible error');
  check(writes.length === beforeValidation, 'invalid activation sends no request');
  await page.locator('#svcStatusSubjects').fill('学生证');
  await page.locator('#svcStatusActions').fill('补办，申请');
  await page.locator('#svcStatusSave').click();
  await closed();
  await row.getByText('启用', { exact: true }).waitFor();
  check(detail.service.status === 'ACTIVE' && detail.service.version === 1, 'draft activation persists and refreshes list');
  assert.deepEqual(detail.steps, originalSteps);
  assert.deepEqual(detail.service.materials, originalMaterials);
  check(writes.at(-1).service.version === 0, 'status save sends latest optimistic version');
  await page.reload();
  await row.getByText('启用', { exact: true }).waitFor();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#svcStatus').waitFor();
  check(await page.locator('#svcStatus').inputValue() === 'ACTIVE', 'full editor loads the saved status');
  check(await page.locator('#svcStatus').evaluate(el => {
    const a = el.getBoundingClientRect(), panel = el.closest('.detail-panel').getBoundingClientRect();
    return a.top >= panel.top && a.bottom <= panel.bottom;
  }), 'editor status is immediately visible without scrolling');
  await page.locator('#detailModal .detail-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  await page.screenshot({ path: fileURLToPath(new URL('status-editor.png', output)) });
  await page.locator('#svcStatus').selectOption('DISABLED');
  await page.locator('#svcSave').click();
  await closed();
  await row.getByText('停用', { exact: true }).waitFor();
  check(detail.service.status === 'DISABLED', 'full editor can disable the item');
  await open();
  await page.locator('#svcStatusChange').selectOption('ACTIVE');
  check(await page.locator('#svcStatusSubjects').count() === 0, 'existing recognition rules are reused');
  failNext = true;
  await page.locator('#svcStatusSave').click();
  await page.locator('#svcStatusErr').getByText('服务暂时不可用，请重试', { exact: true }).waitFor();
  check(await page.locator('#svcStatusSave').isEnabled(), 'failed save allows retry');
  check(await page.locator('#svcStatusChange').inputValue() === 'ACTIVE', 'failed save retains selected status');
  await page.locator('#svcStatusSave').click();
  await closed();
  await row.getByText('启用', { exact: true }).waitFor();
  await open();
  await page.locator('#svcStatusChange').selectOption('DRAFT');
  detail.service.version++;
  await page.locator('#svcStatusSave').click();
  await page.locator('#svcStatusErr').getByText('事项已被更新，请刷新后重试', { exact: true }).waitFor();
  check(detail.service.status === 'ACTIVE', 'concurrent change is rejected without overwriting the item');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await open();
  await page.locator('#svcStatusChange').selectOption('DRAFT');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator('#svcStatusChange').isVisible(), 'mobile status control is visible');
  check(await page.locator('#detailModal .detail-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'mobile dialog has no horizontal overflow');
  await page.locator('#detailModal .detail-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  await page.screenshot({ path: fileURLToPath(new URL('status-mobile.png', output)) });
  await page.locator('#svcStatusSave').click();
  await closed();
  await row.getByText('草稿', { exact: true }).waitFor();
  check(detail.service.status === 'DRAFT', 'refreshed version can return the item to draft');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: fileURLToPath(new URL('status-list.png', output)) });
  check(errors.length === 0, 'no browser runtime errors');
  await context.close();
  console.log(`PASS: ${checks} checks (new draft, activation, editor, persistence, preservation, retries, conflicts and mobile).`);
} finally { await browser.close(); }
