import test from 'node:test'
import assert from 'node:assert/strict'
import { createTurnRenderer } from '../src/workspace/chat-rendering.js'
import { bestSourceIndex, sourceDocumentUrl } from '../src/workspace/chat-sources.js'

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))
function render(response, options) {
  let mounts = 0
  const renderer = createTurnRenderer({ escapeHtml, renderGuide() { mounts++; return '<section class="service-guide"></section>' } })
  return { html: renderer({ answer: '知识库回答', sources: [], ...response }, options), mounts }
}
const item = { code: 'SCHOLARSHIP_APPLICATION', name: '奖学金申请' }
for (const extra of [
  { serviceCode: item.code },
  { relatedService: item },
  { service: item, steps: [{ order: 1, title: '准备材料' }] },
  { relatedService: item, serviceCode: item.code, service: item, steps: [{ order: 1 }], queryIntent: 'SERVICE_GUIDE' },
]) {
  test(`QA does not mount a guide with ${Object.keys(extra).join(', ')}`, () => {
    const result = render({ type: 'QA', ...extra })
    assert.equal(result.mounts, 0)
    assert.doesNotMatch(result.html, /class="service-guide"/)
    assert.match(result.html, /知识库回答/)
  })
}
test('only SERVICE_GUIDE with a service mounts a guide', () => {
  assert.equal(render({ type: 'SERVICE_GUIDE', service: item }).mounts, 1)
  assert.equal(render({ type: 'SERVICE_GUIDE', service: null }).mounts, 0)
})
test('public answers hide private controls and retrieval metadata', () => {
  const result = render({ type: 'QA', relatedService: item, retrievalCount: 1, rewrittenQuery: 'private' }, { readOnly: true })
  assert.doesNotMatch(result.html, /onclick|msg-related|msg-debug|private/)
})
test('answer text and source names cannot inject markup', () => {
  const result = render({ type: 'QA', answer: '<img src=x onerror=alert(1)>', sources: [{ fileName: '<script>bad</script>' }] })
  assert.doesNotMatch(result.html, /<img|<script>/)
  assert.match(result.html, /&lt;img/)
  assert.match(result.html, /&lt;script/)
})

test('headings, key facts, nested lists and tables keep a readable hierarchy', () => {
  const result = render({ answer: '# 助学金说明\n\n## 资助标准\n- **特困助学金**：6000元\n  - 申请材料：认定表\n- **一般困难助学金**：2000元\n\n**申请时间**\n9月6日至20日。\n\n| 档次 | 金额 |\n| --- | --- |\n| 特困 | **6000元** |' })
  assert.match(result.html, /<h2>助学金说明<\/h2>/)
  assert.match(result.html, /<h3>资助标准<\/h3>/)
  assert.match(result.html, /<strong>特困助学金<\/strong>/)
  assert.match(result.html, /<li><strong>特困助学金<\/strong>：6000元<ul><li>申请材料：认定表<\/li><\/ul><\/li>/)
  assert.match(result.html, /<h3>申请时间<\/h3>/)
  assert.match(result.html, /<table>/)
  assert.doesNotMatch(result.html, /\*\*特困/)
})
test('quotes and fenced code are formatted without executing HTML or unsafe links', () => {
  const result = render({ answer: '> 请以学校通知为准。\n\n```html\n<script>alert(1)</script>\n```\n\n[危险链接](javascript:alert(1))\n[官网](https://school.example/policy)' })
  assert.match(result.html, /<blockquote>/)
  assert.match(result.html, /<pre><code>&lt;script&gt;/)
  assert.doesNotMatch(result.html, /<script|href="javascript:/)
  assert.match(result.html, /href="https:\/\/school.example\/policy"/)
})
test('a single best source links to its original file and page', () => {
  const sources = [
    { documentId: 'same', fileName: '学校规定.pdf', score: .98, rerankScore: .3, pageNumber: 1 },
    { documentId: 'same', fileName: '学校规定.pdf', score: .7, rerankScore: .9, pageNumber: 3 },
    { documentId: 'same', fileName: '学校规定.pdf', score: .8, rerankScore: .5, pageNumber: 2 }
  ]
  const result = render({ sources })
  assert.equal((result.html.match(/class="cite-chip"/g) || []).length, 1)
  assert.equal(bestSourceIndex(sources), 1)
  assert.match(result.html, /href="\/api\/knowledge\/documents\/same\/file#page=3"/)
  assert.match(result.html, /data-cite-index="1"/)
  assert.equal(bestSourceIndex([{ score: .2 }, { score: .8 }]), 1)
  assert.equal(bestSourceIndex([{ score: .8 }, { score: .8 }]), 0)
  assert.equal(bestSourceIndex([]), -1)
  assert.equal(sourceDocumentUrl({ documentId: 'a/b', pageNumber: null }), '/api/knowledge/documents/a%2Fb/file')
  assert.doesNotMatch(render({ sources }, { readOnly: true }).html, /api\/knowledge\/documents/)
})
