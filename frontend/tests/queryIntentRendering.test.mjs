import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

// Render the actual page template, so weakening/removing its v-if breaks this test.
const source = await readFile(new URL('../src/modules/knowledge/pages/KnowledgeSearchPage.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const { code } = compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true })
const render = new Function('Vue', code)(Vue)

async function renderResponse(response) {
  let guideMounts = 0
  const app = Vue.createSSRApp({
    render,
    setup: () => ({
      messages: [{ role: 'assistant', content: '知识库回答', response }],
      query: '', topK: 5, topKOptions: [5], loading: false, searched: false, results: [], canSearch: false,
      shareOpen: false, shareLink: '',
      conversations: [], activeId: null, ready: true, busy: false, pending: false, historyError: '', chat: { remove() {}, restore() {} },
      handleChat() {}, handleSearch() {}, newConversation() {}, selectConversation() {}, scoreText: String,
    }),
  })
  const slotComponent = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
  for (const name of ['ChatHistory', 'ReplyActions', 'el-dialog', 'el-alert', 'UserMenu', 'router-link', 'el-tag', 'el-button', 'el-empty', 'el-card', 'el-form', 'el-form-item', 'el-input', 'el-select', 'el-option', 'el-divider']) {
    app.component(name, slotComponent)
  }
  app.component('ServiceGuideCard', { setup() { guideMounts++; return () => Vue.h('section', { class: 'service-guide' }) } })
  const html = await renderToString(app)
  return { html, guideMounts }
}

const item = { code: 'SCHOLARSHIP_APPLICATION', name: '奖学金申请' }
for (const extra of [
  { serviceCode: item.code },
  { relatedService: item },
  { service: item, steps: [{ order: 1, title: '准备材料' }] },
  { relatedService: item, serviceCode: item.code, service: item, steps: [{ order: 1 }], queryIntent: 'SERVICE_GUIDE' },
]) {
  test(`QA never mounts a guide with ${Object.keys(extra).join(', ')}`, async () => {
    const result = await renderResponse({ type: 'QA', sources: [], ...extra })
    assert.equal(result.guideMounts, 0)
    assert.doesNotMatch(result.html, /class="service-guide"/)
    assert.match(result.html, /知识库回答/)
  })
}

test('only SERVICE_GUIDE with a service mounts the guide', async () => {
  assert.equal((await renderResponse({ type: 'SERVICE_GUIDE', service: item, steps: [], sources: [] })).guideMounts, 1)
  assert.equal((await renderResponse({ type: 'SERVICE_GUIDE', service: null, sources: [] })).guideMounts, 0)
})
