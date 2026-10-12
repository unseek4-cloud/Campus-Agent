import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const moduleUrl = process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : new URL('../../tmp/browser-check/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const output = new URL('../../tmp/chat-workspace/', import.meta.url);
await mkdir(output, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const guide = {
  type: 'SERVICE_GUIDE', answer: '学生证补办可以按下面的流程准备材料。', currentStep: 15, aiEnhanced: false,
  service: { id: 1, code: 'STUDENT_CARD_REISSUE', name: '学生证补办', category: '学籍事务', version: 1, status: 'ACTIVE', isExample: true,
    department: '学生事务中心', requirements: ['在校学生'], materials: [{ id: 'm1', name: '补办申请表', required: true, description: '填写基本信息', attachment: { id: 'f1', filename: '学生证补办申请表.docx', downloadUrl: '/api/files/f1/download' } }], sourceTitle: '学生证管理规定', sourceUrl: 'https://school.example/policy' },
  steps: [2, 4, 9, 15].map((order, i) => ({ order, title: ['填写申请表', '提交材料', '等待审核', '领取学生证'][i], description: ['下载表格并填写个人信息。', '将材料提交到学生事务中心。', '等待学校审核结果。', '按通知领取新学生证。'][i], responsibleDepartment: '学生事务中心', requiredMaterials: ['补办申请表'], location: '学生服务大厅', estimatedTime: '以通知为准' })),
  source: { title: '学生证管理规定', url: 'https://school.example/policy' }, sources: [], retrievalCount: 0, rerankCount: 0, usedContextCount: 0
};
async function fixture({ role = 'STUDENT', loggedIn = true, storageDisabled = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const state = { loggedIn, role, chats: 0, shareIds: [], messages: [], pendingReads: 0, delayed: false, revoked: false, created: 0, failHistory: false };
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.addInitScript(() => { try { localStorage.setItem('ca-theme', 'light'); } catch { } });
  if (storageDisabled) await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage disabled'); } });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'campus.test') { await route.abort(); return; }
    if (url.pathname.startsWith('/api/')) {
      const method = route.request().method();
      let data, status = 200;
      const user = { id: state.role === 'ADMIN' ? 2 : 1, username: state.role === 'ADMIN' ? 'admin' : '20260001', displayName: state.role === 'ADMIN' ? '管理员' : '张三', role: state.role, studentNo: '20260001' };
      if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }); return; }
      const path = url.pathname;
      if (path === '/api/auth/me') { data = user; status = state.loggedIn ? 200 : 401; }
      else if (path === '/api/auth/csrf') data = { token: 'test-csrf', headerName: 'X-XSRF-TOKEN' };
      else if (path === '/api/auth/login') { state.loggedIn = true; data = { success: true, user }; }
      else if (path === '/api/auth/logout') { state.loggedIn = false; data = {}; }
      else if (path === '/api/chat/conversations' && method === 'POST') { state.created++; data = { id: 10, title: '学生证补办' }; }
      else if (path === '/api/chat/conversations') data = [{ id: 10, title: '学生证补办', updatedAt: '2026-10-10T10:00:00' }];
      else if (path.endsWith('/messages')) {
        if (state.delayed) await new Promise(resolve => setTimeout(resolve, 250));
        data = { messages: state.messages, pending: state.pendingReads-- > 0 };
        if (state.failHistory) status = 404;
      }
      else if (path === '/api/rag/chat') {
        state.chats++;
        const request = route.request().postDataJSON();
        check(request.conversationId === 10, 'RAG uses a persisted conversation ID');
        check(/^[a-f0-9-]{36}$/.test(request.requestId), 'requestId is a UUID');
        await new Promise(resolve => setTimeout(resolve, 300));
        state.messages.push({ id: 100 + state.chats * 2, role: 'USER', content: request.query, createdAt: '2026-10-10T10:01:00' },
          { id: 101 + state.chats * 2, role: 'ASSISTANT', content: guide.answer, response: guide, createdAt: '2026-10-10T10:01:01' });
        data = { ...guide, conversationId: 10, userMessageId: 100 + state.chats * 2, assistantMessageId: 101 + state.chats * 2 };
      }
      else if (path.endsWith('/shares') && method === 'POST') { state.shareIds = route.request().postDataJSON().messageIds || []; data = { token: 'a'.repeat(43), expiresAt: '2026-11-09T10:00:00' }; }
      else if (path.includes('/shares/') && method === 'DELETE') { state.revoked = true; data = {}; }
      else if (path.startsWith('/api/share/chat/')) {
        status = state.revoked ? 404 : 200;
        data = { title: '学生证补办', createdAt: '2026-10-10T10:00:00', viewCount: 1, messageIds: state.shareIds, messages: state.shareIds.length ? state.messages.filter(m => state.shareIds.includes(m.id)) : state.messages };
      }
      else if (path === '/api/services') data = [guide.service];
      else if (path === '/api/services/1') data = { service: guide.service, steps: guide.steps };
      else if (path === '/api/student/applications/upload-config') data = { maxUploadSizeMb: 20, extensions: ['pdf', 'docx'] };
      else if (path.includes('/applications/active')) data = null;
      else if (path.endsWith('/applications')) data = { items: [], total: 0 };
      else if (path === '/api/admin/overview') data = { total: 0, success: 0, failed: 0, processing: 0, recentDocuments: [] };
      else if (path.startsWith('/api/admin/documents')) data = { items: [], total: 0 };
      else if (path === '/api/v1/health') data = { status: 'UP' };
      else { status = 404; data = {}; }
      await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://campus.test', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: status === 200 ? 'OK' : 'NOT_FOUND', message: status === 200 ? '成功' : '不存在', data }) });
      return;
    }
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!/^[a-z-]+\.(html|css|js)$/.test(file)) { await route.fulfill({ status: 404 }); return; }
    const types = { html: 'text/html', css: 'text/css', js: 'application/javascript' };
    await route.fulfill({ contentType: types[file.split('.').pop()], body: await readFile(new URL('../' + file, import.meta.url)) });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  return { page, context, state, errors };
}
try {
  const { page, context, state, errors } = await fixture();
  await page.goto('http://campus.test/');
  await page.locator('.qa-empty h1').waitFor();
  check(await page.evaluate(() => document.body.dataset.route === 'qa'), 'student home is QA');
  check(await page.locator('#qaInput').isVisible(), 'composer visible on first screen');
  check(await page.locator('.qa-side').count() === 0, 'no distracting right column');
  check(await page.locator('#sidebar #convList .conv-item').count() === 1, 'history in left sidebar');
  check(await page.locator('#chatHistoryGroup').isVisible(), 'history group is visible');
  const center = await page.locator('.qa-input-wrap').boundingBox();
  check(center.y > 250 && center.y + center.height < 800, 'empty composer centered');
  await page.waitForTimeout(450);
  await page.screenshot({ path: fileURLToPath(new URL('home-light.png', output)) });
  await page.locator('#themeToggle').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: fileURLToPath(new URL('home-dark.png', output)) });
  await page.locator('#themeToggle').click();
  await page.locator('#qaInput').fill('学生证怎么补办？');
  await page.locator('#qaInput').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  check(state.chats === 0, 'IME confirmation does not send');
  await page.locator('#qaSend').click();
  await page.evaluate(() => { askQuestion('重复问题'); askQuestion('重复问题'); });
  await page.locator('.guide-current h4').filter({ hasText: '填写申请表' }).waitFor();
  check(!await page.evaluate(service => renderChatTurn({ type: 'QA', answer: '政策回答', service }).includes('data-guide'), guide.service), 'QA never mounts a guide even if service data is present');
  check(state.chats === 1, 'rapid submissions do not duplicate RAG');
  check(await page.locator('.guide-step.is-current').textContent().then(t => t.includes('填写申请表')), 'server currentStep does not imply completion');
  check(await page.locator('.guide-download').getAttribute('href') === 'http://campus.test:8080/api/files/f1/download', 'attachment uses backend downloadUrl');
  await page.locator('[data-material]').check();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '0', 'materials do not complete steps');
  await page.locator('.guide-flow summary').click();
  check(await page.locator('.guide-step.is-current').isVisible(), 'complete timeline can be expanded');
  await page.locator('[data-guide-action="complete"]').dblclick();
  await page.locator('.guide-current h4').filter({ hasText: '提交材料' }).waitFor();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '25', 'double click completes one step only');
  check(await page.locator('.guide-flow').evaluate(el => el.open), 'expanded timeline survives progress update');
  await page.waitForTimeout(550);
  await page.locator('.guide-flow summary').click();
  await page.screenshot({ path: fileURLToPath(new URL('guide-light.png', output)) });
  const composer = await page.locator('.qa-input-wrap').boundingBox();
  check(composer.y + composer.height < 1000, 'active composer stays inside screen');
  await page.reload();
  await page.locator('.guide-current h4').filter({ hasText: '提交材料' }).waitFor();
  check(await page.locator('[data-material]').isChecked(), 'material preparation survives reload');
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '25', 'step progress survives reload');
  await page.locator('[data-guide-action="previous"]').click();
  await page.locator('.guide-current h4').filter({ hasText: '填写申请表' }).waitFor();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '0', 'previous reopens a step');
  for (const title of ['填写申请表', '提交材料', '等待审核', '领取学生证']) {
    await page.waitForTimeout(560);
    await page.locator('.guide-current h4').filter({ hasText: title }).waitFor();
    await page.locator('[data-guide-action="complete"]').click();
  }
  await page.locator('.guide-completed').waitFor();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '100', 'completion reaches 100 percent');
  await page.waitForTimeout(560);
  await page.locator('[data-guide-action="previous"]').click();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '75', 'completed flow can reopen last step');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-guide-action="reset"]').click();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '75', 'cancel reset preserves progress');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-guide-action="reset"]').click();
  check(await page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '0', 'confirmed reset clears progress');
  check(!(await page.locator('[data-material]').isChecked()), 'reset clears material preparation');
  await page.locator('.msg.bot [data-act="share"]').click();
  check(await page.evaluate(() => selectedTranscript()[0].text.includes('办理步骤：') && !selectedTranscript()[0].text.includes('重新开始引导')), 'image transcript includes guide facts without personal controls');
  await page.locator('[data-sb="link"]').click();
  await page.locator('#shareLinkInput').waitFor();
  check(state.shareIds.length === 1 && state.shareIds[0] === 103, 'selected share sends exact persisted message ID');
  const link = await page.locator('#shareLinkInput').inputValue();
  const visitor = await context.newPage();
  await visitor.goto(link);
  await visitor.locator('.share-page-body .service-guide').waitFor();
  check(await visitor.locator('.share-page-body .msg').count() === 1, 'share contains only selected answer');
  check(await visitor.locator('.share-page-body .msg-bubble').innerText() === guide.answer, 'public page renders the answer once and the guide separately');
  check(await visitor.locator('[data-guide-action]').count() === 0, 'public guide has no application or progress actions');
  check(await visitor.locator('[data-material]').count() === 0, 'public guide cannot edit checklist');
  const downloadPromise = visitor.waitForEvent('download');
  await visitor.locator('#sharePageExportImg').click();
  const download = await downloadPromise;
  check(download.suggestedFilename().endsWith('.png'), 'PNG export works');
  await download.saveAs(fileURLToPath(new URL('share.png', output)));
  await page.locator('#shareLinkRevoke').click();
  await visitor.reload();
  await visitor.getByText('链接可能已被撤销或超过有效期', { exact: false }).waitFor();
  check(state.revoked, 'revoke action reaches backend');
  await visitor.close();
  await page.evaluate(() => navigate('dashboard'));
  await page.locator('[data-route="qa"]').click();
  await page.locator('.service-guide').waitFor();
  check(await page.locator('.guide-current h4').textContent() === '填写申请表', 'return to QA restores active conversation');
  state.pendingReads = 1;
  await page.reload();
  await page.getByText('回答正在生成，完成后会自动同步…').waitFor();
  check(await page.locator('#qaInput').isDisabled(), 'pending history disables new questions');
  await page.waitForFunction(() => !document.querySelector('#qaInput').disabled);
  check(!await page.locator('#qaInput').isDisabled(), 'pending history synchronizes automatically');
  await page.evaluate(() => newConversation());
  await page.locator('.qa-empty').waitFor();
  check(state.created === 1, 'new chat does not create empty backend conversations');
  state.delayed = true;
  await page.locator('.conv-main').click();
  await page.evaluate(() => newConversation());
  await page.waitForTimeout(400);
  check(await page.locator('.qa-layout').evaluate(el => el.classList.contains('is-empty')), 'late history response cannot overwrite new chat');
  state.delayed = false;
  state.failHistory = true;
  await page.locator('.conv-main').click();
  await page.locator('.chat-loading.chat-error').waitFor();
  check(await page.locator('.chat-loading.chat-error').isVisible(), 'history error remains visible and retryable');
  state.failHistory = false;
  await page.evaluate(() => newConversation());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('home-mobile.png', output)) });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
  const mobileComposer = await page.locator('.qa-input-wrap').boundingBox();
  check(mobileComposer.x >= 0 && mobileComposer.x + mobileComposer.width <= 390 && mobileComposer.y + mobileComposer.height < 844, 'mobile composer is visible');
  await page.evaluate(() => openConversation(10));
  await page.locator('.service-guide').waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('guide-mobile.png', output)) });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile guide has no overflow');
  check(errors.length === 0, 'no browser runtime errors: ' + errors.join('; '));
  await context.close();
  const admin = await fixture({ role: 'ADMIN' });
  await admin.page.goto('http://campus.test/');
  await admin.page.waitForFunction(() => document.body.dataset.auth === 'in');
  check(await admin.page.evaluate(() => document.body.dataset.route === 'dashboard'), 'admin retains management home');
  await admin.page.evaluate(() => navigate('qa'));
  admin.state.messages = state.messages;
  await admin.page.evaluate(() => openConversation(10));
  await admin.page.locator('.service-guide').waitFor();
  check(await admin.page.locator('[data-guide-action="complete"]').count() > 0, 'admin gets interactive guide progress');
  check(await admin.page.locator('.service-guide [data-guide-action="apply"]').count() === 0, 'admin guide retains administrator permissions');
  await admin.page.locator('[data-guide-action="complete"]').first().click();
  check(await admin.page.locator('.service-guide [role="progressbar"]').first().getAttribute('aria-valuenow') === '25', 'admin can complete an individual guide step');
  await admin.page.locator('.service-guide .guide-flow').first().evaluate(details => details.open = true);
  check(await admin.page.locator('.service-guide .guide-step.is-done').count() > 0, 'completed admin steps have a visible state');
  await admin.page.screenshot({ path: fileURLToPath(new URL('admin-guide-progress.png', output)) });
  await admin.page.reload();
  await admin.page.evaluate(() => openConversation(10));
  await admin.page.locator('.service-guide').waitFor();
  check(await admin.page.locator('.service-guide [role="progressbar"]').first().getAttribute('aria-valuenow') === '25', 'admin guide progress survives reload');
  check(admin.errors.length === 0, 'no admin runtime errors');
  await admin.context.close();
  const guest = await fixture({ loggedIn: false });
  await guest.page.goto('http://campus.test/');
  await guest.page.locator('#loginForm').waitFor();
  await guest.page.locator('#loginUser').fill('20260001');
  await guest.page.locator('#loginPass').fill('fixture-password');
  await guest.page.locator('#loginBtn').click();
  await guest.page.locator('.qa-empty').waitFor();
  check(await guest.page.evaluate(() => document.body.dataset.route === 'qa'), 'login submits into QA home');
  check(guest.errors.length === 0, 'no login runtime errors');
  await guest.context.close();
  const anonymous = await fixture({ loggedIn: false });
  anonymous.state.messages = state.messages;
  await anonymous.page.goto('http://campus.test/#/share/' + 'a'.repeat(43));
  await anonymous.page.locator('.share-page-body').waitFor();
  await anonymous.page.getByRole('button', { name: '返回应用', exact: true }).click();
  await anonymous.page.locator('#loginForm').waitFor();
  check(await anonymous.page.evaluate(() => document.body.dataset.auth === 'out'), 'anonymous visitor can return from share to login');
  check(anonymous.errors.length === 0, 'no errors when returning from share');
  await anonymous.context.close();
  const restricted = await fixture({ storageDisabled: true });
  restricted.state.messages = state.messages;
  await restricted.page.goto('http://campus.test/#/qa?conversation=10');
  await restricted.page.locator('.service-guide').waitFor();
  check(await restricted.page.getByText('浏览器暂时无法保存', { exact: false }).isVisible(), 'blocked storage shows persistence notice');
  await restricted.page.locator('[data-guide-action="complete"]').click();
  await restricted.page.locator('.guide-current h4').filter({ hasText: '提交材料' }).waitFor();
  check(await restricted.page.locator('.guide-progress-track').getAttribute('aria-valuenow') === '25', 'guide remains usable with blocked storage');
  check(restricted.errors.length === 0, 'no runtime errors with blocked storage');
  await restricted.context.close();
  console.log(`PASS: ${checks} checks (actual frontend + intercepted backend DTOs, desktop/mobile, light/dark).`);
} finally { await browser.close(); }
