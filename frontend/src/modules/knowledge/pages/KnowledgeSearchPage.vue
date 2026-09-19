<script setup lang="ts">
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'

import { chatWithKnowledge, searchKnowledge } from '../api'
import type { ApiResponse, KnowledgeSearchResult, RagChatResponse } from '../types'

const query = ref('')
const topK = ref(5)
const loading = ref(false)
const searched = ref(false)
const results = ref<KnowledgeSearchResult[]>([])
const answer = ref<RagChatResponse | null>(null)
const askedQuestion = ref('')

const topKOptions = [1, 3, 5, 10, 20]
const canSearch = computed(() => query.value.trim().length > 0 && !loading.value)

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
  const normalizedQuery = query.value.trim()
  if (!normalizedQuery) {
    ElMessage.warning('请输入要检索的问题')
    return
  }

  loading.value = true
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
    loading.value = false
  }
}

async function handleChat(): Promise<void> {
  const normalizedQuery = query.value.trim()
  if (!normalizedQuery) {
    ElMessage.warning('请输入问题')
    return
  }
  loading.value = true
  answer.value = null
  askedQuestion.value = normalizedQuery
  try {
    answer.value = await chatWithKnowledge({ query: normalizedQuery })
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
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
        <router-link to="/">
          <el-button>返回首页</el-button>
        </router-link>
      </header>

      <el-card shadow="never" class="search-card">
        <el-form label-position="top" @submit.prevent="handleChat">
          <el-form-item label="问题">
            <el-input
              v-model="query"
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
              获取 AI 回答
            </el-button>
          </div>
        </el-form>
      </el-card>

      <section v-if="answer" class="answer-section" aria-live="polite">
        <el-card shadow="never" class="answer-card">
          <div class="question-label">你的问题</div>
          <p class="asked-question">{{ askedQuestion }}</p>
          <el-divider />
          <h2>CampusAgent</h2>
          <p class="answer-text">{{ answer.answer }}</p>
        </el-card>
        <el-card v-if="answer.sources.length" shadow="never" class="sources-card">
          <h2>参考来源</h2>
          <div v-for="source in answer.sources" :key="`${source.documentId}:${source.chunkIndex}`" class="source-item">
            <strong>{{ source.fileName || source.documentId }}</strong>
            <details>
              <summary>查看引用内容</summary>
              <dl class="source-details">
                <div><dt>文档</dt><dd>{{ source.fileName }}</dd></div>
                <div><dt>Chunk ID</dt><dd>{{ source.documentId }}:{{ source.chunkIndex }}</dd></div>
                <div><dt>Rerank Score</dt><dd>{{ scoreText(source.rerankScore) }}</dd></div>
              </dl>
              <div class="chunk-content">{{ source.content }}</div>
            </details>
          </div>
        </el-card>
      </section>

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
    </section>
  </main>
</template>

<style scoped>
.knowledge-search-page {
  min-height: 100vh;
  padding: 40px 20px 72px;
}

.search-shell {
  width: min(960px, 100%);
  margin: 0 auto;
}

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

.answer-section { display: grid; gap: 16px; margin-top: 24px; }
.answer-card h2, .sources-card h2 { margin: 0 0 12px; font-size: 20px; }
.question-label { color: #909399; font-size: 14px; }
.asked-question, .answer-text { white-space: pre-wrap; line-height: 1.8; }
.answer-text { color: #303133; font-size: 18px; }
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
}
</style>
