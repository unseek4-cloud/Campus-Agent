import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : new URL('../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const output = new URL('../../tmp/application-materials/', import.meta.url);
await mkdir(output, { recursive: true });
const materials = [
  { id: 'identity', name: '身份证明', required: true, description: '本人身份证明' },
  { id: 'form', name: '申请表', required: true, description: '填写申请表' }
];
const service = { id: 1, name: '学生证补办', code: 'CARD', category: '学生事务', status: 'ACTIVE', materials, requirements: [] };
const noMaterialService = { ...service, id: 2, code: 'OTHER', name: '无必交材料事项', materials: [] };
const application = { id: 10, serviceItemId: 1, serviceName: service.name, applicationNo: 'CA2026101200000010',
  status: 'NEED_MORE', version: 2, studentRemark: '补办学生证', adminRemark: '请重新提交身份证明' };
const uploads = [];
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'campus.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const method = route.request().method(), path = url.pathname;
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      let data = {}, status = 200;
      if (path === '/api/auth/me') data = { id: 1, username: 'test-student', displayName: '测试学生', role: 'STUDENT', studentNo: 'TEST001' };
      else if (path === '/api/auth/csrf') data = { token: 'test-token', headerName: 'X-XSRF-TOKEN' };
      else if (path === '/api/services') data = [service, noMaterialService];
      else if (path === '/api/student/applications/upload-config') data = {
        maxUploadSizeMb: 20, maxFiles: 10, maxTotalSizeMb: 100, extensions: ['pdf', 'docx'] };
      else if (path === '/api/student/applications/active') data = null;
      else if (path === '/api/student/applications/10') data = { application, materials, attachments: [], events: [] };
      else if ((path === '/api/student/applications' && method === 'POST') || path.endsWith('/resubmit')) {
        uploads.push({ path, raw: route.request().postDataBuffer().toString('utf8') });
        data = { application, materials, attachments: [], events: [] };
      }
      else if (path === '/api/student/applications') data = { items: [], total: 0, page: 1, pageSize: 10 };
      else if (path === '/api/chat/conversations') data = [];
      else if (path === '/api/v1/health') data = { status: 'UP' };
      else { status = 404; }
      return route.fulfill({ status, contentType: 'application/json', headers: {
        'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ code: status === 200 ? 'OK' : 'NOT_FOUND', data }) });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const bytes = await readFile(new URL('../' + path, import.meta.url));
    return route.fulfill({ body: bytes, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.goto('http://campus.test/');
  await page.locator('.qa-empty h1').waitFor();
  await page.evaluate(() => window.openNewApplication(1));
  await page.getByLabel('上传身份证明', { exact: true }).waitFor();
  check((await page.locator('#appReqHint').innerText()).includes('逐项上传'), 'required items explained');
  const file = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n fixture') });
  await page.locator('#appRemark').fill('学生证遗失，申请补办');
  await page.getByLabel('上传身份证明', { exact: true }).setInputFiles([file('identity.pdf')]);
  check(await page.locator('#appMaterialBindings input[type=file]').count() === 3, 'each material has an independent upload entry plus extra attachments');
  check(await page.locator('#appMaterialBindings select').count() === 0, 'material binding is automatic');
  await page.locator('#appSubmit').click();
  check((await page.locator('#appErr').innerText()).includes('申请表'), 'missing required item names shown');
  check(uploads.length === 0, 'missing material prevents network submission');
  check(await page.locator('#appSubmit').isEnabled(), 'validation failure permits correction');
  await page.getByLabel('上传身份证明', { exact: true }).setInputFiles([file('second-identity.pdf')]);
  await page.locator('#appSubmit').click();
  check(uploads.length === 0, 'two files for one item do not satisfy another required item');
  await page.getByRole('button', { name: '移除second-identity.pdf', exact: true }).click();
  check(await page.locator('.material-upload-file').count() === 1, 'individual files can be removed');
  await page.getByLabel('上传申请表', { exact: true }).setInputFiles([file('application.pdf')]);
  check(await page.locator('#appErr').evaluate(element => element.hidden), 'correcting classification clears stale error');
  await page.screenshot({ path: fileURLToPath(new URL('classified-upload.png', output)) });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator('#detailModal .detail-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1), 'mobile upload panel has no horizontal overflow');
  await page.screenshot({ path: fileURLToPath(new URL('classified-upload-mobile.png', output)) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#appSubmit').click();
  await page.waitForFunction(() => !document.querySelector('#detailModal')?.classList.contains('show'));
  check(uploads.length === 1, 'complete application is submitted once');
  check(uploads[0].raw.includes('name="materialIds"\r\n\r\nidentity'), 'identity binding included in multipart');
  check(uploads[0].raw.includes('name="materialIds"\r\n\r\nform'), 'form binding included in multipart');
  check(uploads[0].raw.includes('filename="identity.pdf"') && uploads[0].raw.includes('filename="application.pdf"'), 'both files included');
  await page.evaluate(() => window.openNewApplication(1));
  await page.getByLabel('上传身份证明', { exact: true }).setInputFiles([file('old-service.pdf')]);
  await page.locator('#appService').selectOption('2');
  check(await page.locator('#appMaterialBindings input[type=file]').count() === 1, 'changing service loads only the new requirements');
  check(await page.locator('.material-upload-file').count() === 0, 'changing service clears old files');
  await page.locator('#appRemark').fill('无附件申请');
  await page.locator('#appSubmit').click();
  await page.waitForFunction(() => !document.querySelector('#detailModal')?.classList.contains('show'));
  check(uploads.length === 2, 'service without required materials supports no files');
  await page.evaluate(() => window.openResubmit(10, 0));
  await page.locator('#resubMaterialBindings input[type=file]').first().waitFor();
  await page.locator('#resubRemark').fill('重新上传身份证明');
  await page.getByLabel('上传身份证明', { exact: true }).setInputFiles([file('replacement.pdf')]);
  await page.locator('#resubSubmit').click();
  await page.waitForFunction(() => !document.querySelector('#detailModal')?.classList.contains('show'));
  check(uploads.length === 3 && uploads[2].path.endsWith('/10/resubmit'), 'supplement goes to original application');
  check(uploads[2].raw.includes('name="version"\r\n\r\n2'), 'supplement uses freshly loaded version');
  check(uploads[2].raw.includes('name="materialIds"\r\n\r\nidentity'), 'supplement preserves original material classification');
  check(errors.length === 0, 'no browser runtime errors');
  await context.close();
  console.log(`PASS: ${checks} checks (actual new frontend + intercepted API, classified submission and supplement).`);
} finally { await browser.close(); }
