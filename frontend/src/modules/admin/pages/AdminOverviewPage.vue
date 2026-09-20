<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight, DocumentAdd, Files, CircleCheck, Loading, CircleClose, Collection } from '../icons'
import { dateText, errorText, getOverview } from '../api'
import type { Overview } from '../types'
import DocumentStatusBadge from '../components/DocumentStatusBadge.vue'
import DocumentUploader from '../components/DocumentUploader.vue'
const data = ref<Overview | null>(null)
const loading = ref(true)
const error = ref('')
const uploading = ref(false)
async function load() { loading.value = true; error.value = ''; try { data.value = await getOverview() } catch (e) { error.value = errorText(e); ElMessage.error(error.value) } finally { loading.value = false } }
onMounted(load)
const cards = [
  { key: 'total', title: '文档总数', icon: Files }, { key: 'success', title: '已成功解析', icon: CircleCheck },
  { key: 'processing', title: '处理中', icon: Loading }, { key: 'failed', title: '解析失败', icon: CircleClose },
  { key: 'chunks', title: '知识片段', icon: Collection },
] as const
</script>
<template><div class="admin-page"><div class="page-intro"><div><div class="eyebrow">工作台 / 总览</div><h1>知识库总览</h1><p>了解校园知识资料的入库情况，及时处理解析问题。</p></div><el-button type="primary" size="large" @click="uploading = true"><el-icon><DocumentAdd /></el-icon>上传文档</el-button></div><el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><template #default><el-button link type="primary" @click="load">重试</el-button></template></el-alert><div class="stat-grid" v-loading="loading"><div v-for="card in cards" :key="card.key" class="stat-card"><div class="stat-icon"><el-icon><component :is="card.icon" /></el-icon></div><span>{{ card.title }}</span><strong>{{ data?.[card.key] ?? '—' }}</strong></div></div><section class="panel-card"><div class="panel-head"><div><h2>最近上传</h2><p>按上传时间展示最近的知识资料</p></div><router-link to="/admin/knowledge" class="text-action">查看全部 <el-icon><ArrowRight /></el-icon></router-link></div><div v-if="!loading && !data?.recent.length" class="empty-panel"><el-icon :size="42"><Files /></el-icon><h3>暂无知识库文档</h3><p>上传第一份校园资料，开始构建知识库。</p><el-button type="primary" @click="uploading = true">上传第一份文档</el-button></div><div v-else class="recent-list"><div v-for="item in data?.recent" :key="item.id" class="recent-row"><span class="file-glyph" :class="item.fileType">{{ item.fileType.toUpperCase().slice(0,3) }}</span><div class="recent-name"><strong>{{ item.displayName }}</strong><small>{{ item.fileType.toUpperCase() }} · {{ dateText(item.createdAt) }}</small></div><DocumentStatusBadge :status="item.status" /></div></div></section><DocumentUploader v-model="uploading" @completed="load" /></div></template>
