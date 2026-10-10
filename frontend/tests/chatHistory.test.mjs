import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { ref, computed } from 'vue'

// Exercise the real composable with an API boundary and explicit mount/unmount hooks.
const source = (await readFile(new URL('../src/modules/knowledge/history/useChatHistory.ts', import.meta.url), 'utf8'))
  .replace(/^import[^\r\n]*\r?\n/gm, '').replace('const inFlight = new Set<string>()', '').replace('export function useChatHistory', 'function useChatHistory')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const factory = new Function('ref', 'computed', 'onMounted', 'onBeforeUnmount', 'currentUser', 'historyApi', 'chatWithKnowledge',
  'localStorage', 'inFlight', 'setTimeout', 'clearTimeout', outputText.replace(/export \{\};?/, '') + '\nreturn useChatHistory()')

function setup() {
  const user = ref({ id: 1 }), db = new Map(), local = new Map(), timers = new Map(), inFlight = new Set()
  let seq = 0, sends = 0, reads = 0, beforeAnswer, beforeUser, fail = false
  const storage = { getItem: k => local.get(k), setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) }
  const api = {
    async list() { return [...db.values()].filter(c => c.userId === user.value.id).reverse().map(c => ({ id: c.id, title: c.title })) },
    async create() { const c = { id: ++seq, userId: user.value.id, title: '新对话', messages: [], pending: false }; db.set(c.id, c); return c },
    async messages(id) { reads++; const c = db.get(id); if (!c || c.userId !== user.value.id) throw Error('404'); return structuredClone({ messages: c.messages, pending: c.pending }) },
    async delete(id) { db.delete(id) },
  }
  async function send(request) {
    sends++; const c = db.get(request.conversationId)
    if (beforeUser) await beforeUser()
    c.messages.push({ id: ++seq, requestId: request.requestId, role: 'USER', content: request.query }); c.pending = true
    c.title = request.query
    if (beforeAnswer) await beforeAnswer()
    if (fail) { c.pending = false; throw Error('AI unavailable') }
    const id = ++seq
    c.messages.push({ id, requestId: request.requestId, role: 'ASSISTANT', content: '数据库中的回答', response: { type: 'QA', sources: [] } }); c.pending = false
    return { assistantMessageId: id, answer: '数据库中的回答', type: 'QA', sources: [] }
  }
  function mount() {
    let init, dispose
    const state = factory(ref, computed, cb => { init = cb }, cb => { dispose = cb }, user, api, send, storage, inFlight,
      cb => { const id = ++seq; timers.set(id, cb); return id }, id => timers.delete(id))
    return { state, init, dispose }
  }
  return { mount, db, local, user, timers, get sends() { return sends }, get reads() { return reads }, set beforeAnswer(v) { beforeAnswer = v }, set beforeUser(v) { beforeUser = v }, set fail(v) { fail = v } }
}

test('route remount, refresh and login restore server content with only an ID in storage', async () => {
  const env = setup(); let view = env.mount(); await view.init()
  await view.state.send('奖学金申请条件'); const id = view.state.activeId.value
  for (let i=0;i<3;i++) {
    view.dispose(); view = env.mount(); await view.init()
    assert.equal(view.state.activeId.value, id); assert.equal(view.state.messages.value.length, 2)
    assert.equal(view.state.messages.value[1].content, '数据库中的回答')
  }
  assert.deepEqual([...env.local.values()], [String(id)]); assert.ok(env.reads >= 4)
  view.dispose()
})
test('new conversations, switching, deletion and stale local IDs use the server', async () => {
  const env=setup(); const view=env.mount(); await view.init(); await view.state.send('第一条')
  const first=view.state.activeId.value; await view.state.create(); await view.state.send('第二条'); const second=view.state.activeId.value
  await view.state.select(first); assert.equal(view.state.messages.value[0].content,'第一条')
  await view.state.select(second); await view.state.remove(second)
  assert.equal(view.state.activeId.value,first); assert.equal(view.state.messages.value.length,2)
  env.local.set('campusagent:last-conversation:1','9999'); await view.state.restore(); assert.equal(view.state.activeId.value,first)
  await view.state.remove(first); assert.equal(view.state.activeId.value,null); assert.deepEqual(view.state.messages.value,[])
  view.dispose()
})
test('duplicate send is blocked and navigating away during AI work restores pending response', async () => {
  const env=setup(); let view=env.mount(); await view.init()
  let finish; env.beforeAnswer=()=>new Promise(resolve=>{ finish=resolve })
  const sending=view.state.send('问题'); await new Promise(resolve=>setImmediate(resolve))
  assert.equal(await view.state.send('问题'),false); assert.equal(env.sends,1)
  view.dispose(); view=env.mount(); await view.init(); assert.equal(view.state.pending.value,true)
  assert.equal(view.state.messages.value[0].content,'问题')
  finish(); await sending
  const poll=[...env.timers.values()][0]; poll(); await new Promise(resolve=>setImmediate(resolve))
  assert.equal(view.state.messages.value.length,2); assert.equal(view.state.pending.value,false)
  view.dispose()
})
test('AI failure preserves saved user message and no fake assistant response', async () => {
  const env=setup(), view=env.mount(); await view.init(); env.fail=true
  await assert.rejects(view.state.send('失败时仍保存'),/AI unavailable/)
  assert.equal(view.state.messages.value.length,1); assert.equal(view.state.messages.value[0].role,'user')
  assert.equal(view.state.busy.value,false); view.dispose()
})
test('immediate route return before USER commit still waits for the server result', async () => {
  const env=setup(); let view=env.mount(); await view.init()
  let commit; env.beforeUser=()=>new Promise(resolve=>{ commit=resolve })
  const sending=view.state.send('快速切换'); await new Promise(resolve=>setImmediate(resolve))
  view.dispose(); view=env.mount(); await view.init()
  assert.equal(view.state.messages.value.length,0); assert.equal(view.state.pending.value,true)
  commit(); await sending
  ;[...env.timers.values()][0](); await new Promise(resolve=>setImmediate(resolve))
  assert.equal(view.state.messages.value.length,2); assert.equal(view.state.pending.value,false); view.dispose()
})
test('another login never restores previous user messages or last-conversation ID', async () => {
  const env=setup(); let view=env.mount(); await view.init(); await view.state.send('用户一私有内容'); view.dispose()
  env.user.value={id:2}; view=env.mount(); await view.init()
  assert.deepEqual(view.state.messages.value,[]); assert.deepEqual(view.state.conversations.value,[])
  await view.state.send('用户二私有内容'); assert.equal(env.db.size,2)
  view.dispose(); env.user.value={id:1}; view=env.mount(); await view.init()
  assert.equal(view.state.messages.value[0].content,'用户一私有内容'); view.dispose()
})
