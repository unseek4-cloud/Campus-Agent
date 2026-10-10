<script setup lang="ts">
import UserMenu from '../../auth/UserMenu.vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import ServiceGuideCard from '../../serviceguide/components/ServiceGuideCard.vue'

import { searchKnowledge } from '../api'
import ChatHistory from '../history/ChatHistory.vue'
import { useChatHistory } from '../history/useChatHistory'
import type { ApiResponse, KnowledgeSearchResult } from '../types'
import ReplyActions from '../feedback/ReplyActions.vue'
import { historyApi } from '../history/api'


const query = ref('')
const topK = ref(5)
const searching = ref(false)
const chat = useChatHistory()
const { conversations, messages, activeId, busy, pending, ready, error: historyError } = chat
const loading = computed(() => searching.value || busy.value || pending.value)
const searched = ref(false)
const results = ref<KnowledgeSearchResult[]>([])
const topKOptions = [1, 3, 5, 10, 20]
const shareLink = ref(''), shareToken = ref(''), shareConversationId = ref<number | null>(null), shareOpen = ref(false), sharing = ref(false)
async function shareReply(id: number) {
  if (!activeId.value || sharing.value) return
  sharing.value = true
  const conversationId = activeId.value, index = messages.value.findIndex(m => m.id === id)
  const previous = messages.value[index-1]
  try {
    const result = await historyApi.share(conversationId, previous?.role === 'user' ? [previous.id, id] : [id])
    shareConversationId.value = conversationId; shareToken.value = result.token
    shareLink.value = `${location.origin}${import.meta.env.BASE_URL}share/${encodeURIComponent(result.token)}`; shareOpen.value = true
  } catch(e) { ElMessage.error(errorMessage(e)) }
  finally { sharing.value = false }
}
async function copyShare() { try { await navigator.clipboard.writeText(shareLink.value); ElMessage.success('分享链接已复制') } catch { ElMessage.warning('请手动复制链接') } }
async function revokeShare() {
  if (!shareConversationId.value) return
  try { await historyApi.revoke(shareConversationId.value, shareToken.value); shareOpen.value = false; ElMessage.success('分享链接已撤销') }
  catch(e) { ElMessage.error(errorMessage(e)) }
}
async function regenerate(id: number) { try { await chat.regenerate(id); ElMessage.success('新回复已生成，原回答已保留') } catch(e) { ElMessage.error(errorMessage(e)) } }
function editQuestion(id: number) { const index = messages.value.findIndex(m => m.id === id); const previous = messages.value[index-1]; if (previous?.role === 'user') query.value = previous.content }
function showSources(id: number) {
  const article = document.querySelector(`[data-message-id="${id}"]`)
  const details = article?.querySelectorAll<HTMLDetailsElement>('.message-sources details')
  if (!details?.length) return ElMessage.info('这条回复没有知识库引用')
  details.forEach(d => { d.open = true }); article?.querySelector('.message-sources')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
const canSearch = computed(() => query.value.trim().length > 0 && !loading.value && ready.value && !historyError.value)

function scoreText(score: number | null): string {
  return score !== null && Number.isFinite(score) ? score.toFixed(4) : '—'
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiResponse<null>>(error)) {
    return error.response?.data?.message ?? error.message
  }
  return error instanceof Error ? error.message : '请求失败，请检查服务日志'
}

async function handleSearch(): Promise<void> {
  if (loading.value) return
  const normalizedQuery = query.value.trim()
  if (!normalizedQuery) {
    ElMessage.warning('请输入要检索的问题')
    return
  }

  searching.value = true
  try {
    const data = await searchKnowledge({
      query: normalizedQuery,
      topK: topK.value,
    })
    results.value = data.results
    searched.value = true
  } catch (error) {
    results.value = []
    searched.value = false
    ElMessage.error(errorMessage(error))
  } finally {
    searching.value = false
  }
}

async function handleChat(): Promise<void> {
  if (!canSearch.value) return
  const question = query.value.trim()
  query.value = ''
  try { await chat.send(question) }
  catch (error) {
    if (messages.value.at(-1)?.content !== question) query.value = question
    ElMessage.error(errorMessage(error))
  }
}

async function newConversation(): Promise<void> {
  try {
    await chat.create()
    query.value = ''; results.value = []; searched.value = false
  } catch (error) { ElMessage.error(errorMessage(error)) }
}

async function selectConversation(id: number): Promise<void> {
  query.value = ''; results.value = []; searched.value = false
  await chat.select(id)
}
</script>

<template>
  <main class="knowledge-search-page">
    <section class="search-shell">
      <header class="page-header">
        <div>
          <el-tag effect="plain">CampusAgent</el-tag>
          <h1>校园事务智能问答</h1>
          <p>提出问题，查看简洁答案及其知识库来源。</p>
        </div>
        <UserMenu />
        <router-link to="/">
          <el-button>返回首页</el-button>
        </router-link>
      </header>

      <div class="chat-layout">
      <ChatHistory :conversations="conversations" :active-id="activeId" :busy="loading"
        :new-disabled="loading || !ready" :remove="chat.remove" @select="selectConversation" @create="newConversation" />
      <div class="chat-main">
      <el-alert v-if="historyError" :title="historyError" type="error" :closable="false">
        <el-button text @click="chat.restore">重新加载</el-button>
      </el-alert>
      <p v-if="!ready && busy" class="pending-answer">正在恢复历史对话…</p>
      <section class="conversation-section" aria-live="polite">
        <div class="conversation-heading">
          <h2>当前对话</h2>
          <el-button :disabled="loading || !ready" @click="newConversation">新建对话</el-button>
        </div>
        <el-empty v-if="ready && !busy && !pending && !historyError && messages.length === 0" description="输入第一个问题，开始对话" />
        <article
          v-for="message in messages"
          :key="message.id"
          :data-message-id="message.id"
          class="chat-message"
          :class="message.role === 'user' ? 'user-message' : 'assistant-message'"
        >
          <div class="message-label">{{ message.role === 'user' ? '你' : 'CampusAgent' }}</div>
          <p class="message-content">{{ message.content }}</p>
          <!-- A related topic (or stray guide fields on QA) must never mount progress tracking. -->
          <ServiceGuideCard
            v-if="message.response?.type === 'SERVICE_GUIDE' && message.response.service"
            :service="message.response.service" :steps="message.response.steps ?? []"
            :source="message.response.source" :current-step="message.response.currentStep"
            track-progress
          />
          <div v-if="message.response?.sources.length" class="message-sources">
            <strong>参考来源</strong>
            <div
              v-for="source in message.response.sources"
              :key="`${source.documentId}:${source.chunkIndex}`"
              class="source-item"
            >
              <strong>{{ source.fileName || source.documentId }}</strong>
              <details>
                <summary>{{ message.restored ? '查看引用摘要' : '查看引用内容' }}</summary>
                <dl class="source-details">
                  <div><dt>文档</dt><dd>{{ source.fileName }}</dd></div>
                  <div><dt>Chunk ID</dt><dd>{{ source.documentId }}:{{ source.chunkIndex }}</dd></div>
                  <div v-if="!message.restored"><dt>Rerank Score</dt><dd>{{ scoreText(source.rerankScore) }}</dd></div>
                </dl>
                <div class="chunk-content">{{ source.content }}</div>
              </details>
            </div>
          </div>
          <details v-if="message.response && !message.restored" class="turn-debug">
            <summary>本轮调试信息</summary>
            <p>检索问题：{{ message.response.rewrittenQuery }}</p>
            <p>召回 {{ message.response.retrievalCount }} · 重排 {{ message.response.rerankCount }} · 使用 {{ message.response.usedContextCount }} 个片段</p>
          </details>
          <ReplyActions v-if="message.role === 'assistant' && message.id > 0" :message-id="message.id" :content="message.content" :feedback="message.feedback" :disabled="loading" @feedback="message.feedback = $event" @share="shareReply(message.id)" @regenerate="regenerate(message.id)" @sources="showSources(message.id)" @edit="editQuestion(message.id)" />
        </article>
        <div v-if="busy || pending" class="pending-answer">
          CampusAgent 正在查找知识库…
        </div>
      </section>

      <el-card shadow="never" class="search-card">
        <el-form label-position="top" @submit.prevent="handleChat">
          <el-form-item label="问题">
            <el-input
              v-model="query"
              :disabled="loading || !ready || !!historyError"
              type="textarea"
              :rows="4"
              maxlength="4000"
              show-word-limit
              placeholder="例如：国家奖学金申请需要满足什么条件？"
              @keydown.ctrl.enter="handleChat"
            />
          </el-form-item>

          <div class="search-actions">
            <el-button
              type="primary"
              size="large"
              :disabled="!canSearch"
              :loading="loading"
              @click="handleChat"
            >
              发送
            </el-button>
          </div>
        </el-form>
      </el-card>

      <details class="debug-section">
        <summary>检索调试（原始 Chunk）</summary>
        <div class="debug-actions">
          <el-select v-model="topK" aria-label="调试 TopK" class="top-k-field">
            <el-option v-for="option in topKOptions" :key="option" :label="option" :value="option" />
          </el-select>
          <el-button :disabled="!canSearch" :loading="loading" @click="handleSearch">运行检索</el-button>
        </div>

      <section v-if="searched" class="results-section" aria-live="polite">
        <div class="results-heading">
          <h2>检索结果</h2>
          <el-tag type="info">{{ results.length }} 个片段</el-tag>
        </div>

        <el-empty v-if="results.length === 0" description="知识库中没有检索到片段" />

        <el-card
          v-for="result in results"
          :key="`${result.documentId}-${result.chunkIndex}`"
          shadow="never"
          class="result-card"
        >
          <template #header>
            <div class="result-header">
              <strong>Top {{ result.rank }}</strong>
              <div class="score-tags">
                <el-tag type="info">Cosine {{ scoreText(result.score) }}</el-tag>
                <el-tag type="success">Rerank {{ scoreText(result.rerankScore) }}</el-tag>
                <el-tag v-if="result.finalScore != null" type="warning">
                  排序分 {{ scoreText(result.finalScore) }}
                </el-tag>
              </div>
            </div>
          </template>

          <dl class="metadata-grid">
            <div>
              <dt>来源文件</dt>
              <dd>{{ result.fileName || result.source || '未知' }}</dd>
            </div>
            <div>
              <dt>页码</dt>
              <dd>{{ result.pageNumber ?? '不适用' }}</dd>
            </div>
            <div>
              <dt>chunkIndex</dt>
              <dd>{{ result.chunkIndex }}</dd>
            </div>
            <div>
              <dt>documentId</dt>
              <dd>{{ result.documentId }}</dd>
            </div>
          </dl>

          <el-divider />
          <div v-if="result.evidenceText" class="evidence-content">
            <strong>时间证据</strong>
            <span v-if="result.evidenceScore != null">
              （{{ result.evidenceScore > 0 ? '支持所问时间' : '日期类型不符' }} ·
              {{ scoreText(result.evidenceScore) }}）
            </span>
            <p>{{ result.evidenceText }}</p>
          </div>
          <div class="chunk-content">{{ result.content }}</div>
        </el-card>
      </section>
      </details>
      </div>
      </div>
    </section>
    <el-dialog v-model="shareOpen" title="分享这轮问答" width="min(520px, 92vw)"><p style="font-size:14px">持有链接的人可免登录查看这轮问题、回答及引用。链接30天有效，可随时撤销。</p><el-input :model-value="shareLink" readonly aria-label="公开分享链接" /><template #footer><el-button @click="revokeShare">撤销链接</el-button><el-button type="primary" @click="copyShare">复制链接</el-button></template></el-dialog>
  </main>
</template>

<style scoped>
.knowledge-search-page {
  min-height: 100vh;
  padding: 40px 20px 72px;
}

.search-shell {
  width: min(1240px, 100%);
  margin: 0 auto;
}

.chat-layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 28px; }
.chat-main { min-width: 0; }
@media (max-width: 800px) { .chat-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; } }

.page-header,
.result-header,
.results-heading,
.search-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.score-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.page-header {
  align-items: flex-start;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 12px 0 8px;
  font-size: clamp(28px, 4vw, 40px);
}

.page-header p {
  margin: 0;
  font-size: 16px;
}

.search-card,
.result-card {
  border-color: #dfe4ec;
}

.search-actions {
  align-items: flex-end;
}

.top-k-field {
  width: 160px;
  margin-bottom: 0;
}

.results-section {
  display: grid;
  gap: 16px;
  margin-top: 32px;
}

.conversation-section { display: grid; gap: 14px; margin-bottom: 24px; }
.conversation-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.conversation-heading h2 { margin: 0; font-size: 20px; }
.chat-message { max-width: 86%; padding: 16px 20px; border: 1px solid #dfe4ec; border-radius: 14px; background: #fff; }
.user-message { justify-self: end; background: #ecf5ff; border-color: #c6e2ff; }
.assistant-message { justify-self: start; min-width: 0; }
.assistant-message:has(.service-guide) { width: 100%; }
.message-label { color: #606266; font-size: 13px; font-weight: 600; }
.message-content { margin: 8px 0 0; color: #303133; white-space: pre-wrap; line-height: 1.8; overflow-wrap: anywhere; }
.message-sources { margin-top: 18px; padding-top: 12px; border-top: 1px solid #e4e7ed; font-size: 14px; }
.turn-debug { margin-top: 14px; color: #606266; font-size: 13px; }
.turn-debug p { margin: 8px 0; font-size: inherit; overflow-wrap: anywhere; }
.pending-answer { color: #909399; font-size: 14px; }
.source-item { padding: 12px 0; border-top: 1px solid #e4e7ed; }
.source-item summary, .debug-section summary { cursor: pointer; color: #409eff; margin-top: 8px; }
.source-details { display: grid; gap: 8px; margin: 12px 0; }
.source-details div { display: flex; gap: 8px; }
.source-details dt { color: #909399; }
.source-details dd { margin: 0; overflow-wrap: anywhere; }
.debug-section { margin-top: 32px; }
.debug-actions { display: flex; gap: 12px; margin-top: 16px; }

.results-heading h2 {
  margin: 0;
}

.metadata-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.metadata-grid div {
  min-width: 0;
}

.metadata-grid dt {
  margin-bottom: 4px;
  color: #909399;
  font-size: 13px;
}

.metadata-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
}

.chunk-content {
  color: #303133;
  line-height: 1.85;
  white-space: pre-wrap;
}

.evidence-content {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-left: 3px solid #e6a23c;
  background: #fdf6ec;
  line-height: 1.6;
  white-space: pre-wrap;
}

.evidence-content p {
  margin: 8px 0 0;
}

@media (max-width: 700px) {
  .page-header,
  .search-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .top-k-field {
    width: 100%;
  }

  .metadata-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .chat-message { max-width: 100%; }
}
</style>
