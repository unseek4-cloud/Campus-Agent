import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { currentUser } from '../../auth/state'
import { chatWithKnowledge } from '../api'
import type { ConversationMessage, RagChatResponse } from '../types'
import { historyApi, type Conversation } from './api'
import type { Feedback } from '../feedback/api'

export interface DisplayMessage extends ConversationMessage { id: number; response?: RagChatResponse; restored?: boolean; feedback?: Feedback | null }
// Transient request markers bridge route changes before the server has committed USER.
// They contain no message text; persistence and eventual results always come from MySQL.
const inFlight = new Set<string>()

export function useChatHistory() {
  const conversations = ref<Conversation[]>([]), messages = ref<DisplayMessage[]>([])
  const activeId = ref<number | null>(null), busy = ref(false), pending = ref(false), ready = ref(false), error = ref('')
  const disabled = computed(() => busy.value || pending.value || !ready.value)
  // Only an opaque ID is stored locally. All content and ownership come from the API.
  const ownerId = currentUser.value?.id
  const key = `campusagent:last-conversation:${ownerId}`
  let alive = true, timer: ReturnType<typeof setTimeout> | undefined
  const valid = () => alive && currentUser.value?.id === ownerId
  function remember(id: number | null) {
    try { if (id === null) localStorage.removeItem(key); else localStorage.setItem(key, String(id)) } catch { /* Storage is optional. */ }
  }
  function remembered() { try { return Number(localStorage.getItem(key)) || null } catch { return null } }
  function schedule(id: number) {
    clearTimeout(timer)
    if (pending.value && valid()) timer = setTimeout(() => {
      void load(id).catch(() => { if (valid()) { error.value = '暂时无法同步回答，请重新加载'; pending.value = false } })
    }, 1800)
  }
  async function load(id: number) {
    const data = await historyApi.messages(id)
    if (!valid() || activeId.value !== id) return
    messages.value = data.messages.map(m => ({ id: m.id, role: m.role === 'USER' ? 'user' : 'assistant', content: m.content,
      response: m.response ? { ...m.response, answer: m.content } : undefined, restored: true, feedback: m.feedback }))
    pending.value = data.pending || inFlight.has(`${ownerId}:${id}`)
    schedule(id)
  }
  async function refreshList() {
    const list = await historyApi.list()
    if (valid()) conversations.value = list
    return list
  }
  async function select(id: number) {
    if (busy.value || !valid()) return
    busy.value = true; error.value = ''; clearTimeout(timer)
    activeId.value = id; messages.value = []; pending.value = false
    try { await load(id); if (valid()) remember(id) }
    catch { if (valid()) error.value = '对话加载失败，请重新加载' }
    finally { if (valid()) busy.value = false }
  }
  async function restore() {
    if (busy.value || !valid()) return
    busy.value = true; ready.value = false; error.value = ''
    try {
      const list = await refreshList()
      if (!valid()) return
      const previous = remembered()
      activeId.value = list.find(c => c.id === previous)?.id ?? list[0]?.id ?? null
      messages.value = []; pending.value = false
      if (activeId.value !== null) await load(activeId.value)
      remember(activeId.value); ready.value = true
    } catch { if (valid()) error.value = '历史对话加载失败，请检查网络后重新加载' }
    finally { if (valid()) busy.value = false }
  }
  async function create() {
    if (disabled.value || !valid()) return
    busy.value = true; error.value = ''
    try {
      const conversation = await historyApi.create()
      if (!valid()) return
      clearTimeout(timer); activeId.value = conversation.id; messages.value = []; pending.value = false
      remember(conversation.id); await refreshList()
    } finally { if (valid()) busy.value = false }
  }
  async function remove(id: number) {
    if (busy.value || !valid()) return
    busy.value = true
    try {
      await historyApi.delete(id)
      const list = await refreshList()
      if (!valid()) return
      if (activeId.value === id) {
        clearTimeout(timer); activeId.value = list[0]?.id ?? null; messages.value = []; pending.value = false
        remember(activeId.value)
        if (activeId.value !== null) await load(activeId.value)
      }
    } finally { if (valid()) busy.value = false }
  }
  async function send(query: string): Promise<boolean> {
    if (disabled.value || !valid()) return false
    busy.value = true; error.value = ''
    let id = activeId.value
    let sendingKey: string | undefined
    try {
      if (id === null) {
        const conversation = await historyApi.create()
        if (!valid()) return false
        id = conversation.id; activeId.value = id; remember(id)
      }
      // One request ID per send; no automatic POST retries. Backend also enforces uniqueness.
      messages.value.push({ id: -Date.now(), role: 'user', content: query })
      sendingKey = `${ownerId}:${id}`; inFlight.add(sendingKey)
      const response = await chatWithKnowledge({ query, conversationId: id, requestId: crypto.randomUUID() })
      inFlight.delete(sendingKey)
      if (!valid()) return true
      await load(id)
      const answer = messages.value.find(m => m.id === response.assistantMessageId)
      if (answer) { answer.response = response; answer.restored = false }
      await refreshList()
      return true
    } catch (cause) {
      if (sendingKey) inFlight.delete(sendingKey)
      // A failed/timeout response may still have committed the USER turn. Read the database.
      if (id !== null && valid()) {
        try { await load(id); await refreshList() } catch { error.value = '同步失败，请重新加载查看已保存的消息' }
      }
      throw cause
    } finally { if (sendingKey) inFlight.delete(sendingKey); if (valid()) busy.value = false }
  }
  onMounted(restore)
  async function regenerate(messageId: number) {
    if (disabled.value || !valid() || activeId.value === null) return
    const id = activeId.value, sendingKey = `${ownerId}:${id}`
    busy.value = true; inFlight.add(sendingKey)
    try {
      const response = await historyApi.regenerate(messageId)
      inFlight.delete(sendingKey)
      if (!valid()) return
      await load(id); await refreshList()
      const answer = messages.value.find(m => m.id === response.assistantMessageId)
      if (answer) { answer.response = response; answer.restored = false }
    } catch (cause) {
      inFlight.delete(sendingKey)
      if (valid()) { try { await load(id); await refreshList() } catch { error.value = '同步失败，请重新加载' } }
      throw cause
    } finally { inFlight.delete(sendingKey); if (valid()) busy.value = false }
  }
  onBeforeUnmount(() => { alive = false; clearTimeout(timer) })
  return { conversations, messages, activeId, busy, pending, ready, disabled, error, restore, select, create, remove, send, regenerate }
}
