<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { httpClient } from '../../../shared/http/client'
import type { ApiResponse, RagChatResponse } from '../types'
import ServiceGuideCard from '../../serviceguide/components/ServiceGuideCard.vue'
import { errorText } from '../../admin/api'
const route = useRoute()
const data = ref<{title: string; messages: {role: string; content: string; response: RagChatResponse | null}[]} | null>(null)
const error = ref(''), loading = ref(true)
onMounted(async () => {
  try { data.value = (await httpClient.get<ApiResponse<NonNullable<typeof data.value>>>(`/share/chat/${encodeURIComponent(String(route.params.token))}`)).data.data }
  catch(e) { error.value = errorText(e) }
  finally { loading.value = false }
})
</script>
<template><main class="shared-conversation" v-loading="loading"><h1>CampusAgent · 问答分享</h1><p>公开只读分享</p><el-alert v-if="error" :title="error" type="error" :closable="false" /><template v-if="data"><h2>{{ data.title }}</h2><article v-for="(m,i) in data.messages" :key="i"><strong>{{ m.role === 'USER' ? '用户问题' : 'CampusAgent' }}</strong><p>{{ m.content }}</p><ServiceGuideCard v-if="m.response?.type === 'SERVICE_GUIDE' && m.response.service" :service="m.response.service" :steps="m.response.steps ?? []" :source="m.response.source" :current-step="m.response.currentStep" /><details v-for="s in m.response?.sources" :key="`${s.documentId}:${s.chunkIndex}`"><summary>{{ s.fileName }} · {{ s.pageNumber ?? '无页码' }}</summary><p>{{ s.content }}</p></details></article></template></main></template>
<style scoped>.shared-conversation{max-width:900px;margin:0 auto;padding:40px 24px}.shared-conversation h1{font-size:26px}.shared-conversation article{padding:24px;margin:16px 0;border-radius:14px;background:var(--el-bg-color);border:1px solid var(--el-border-color-light)}.shared-conversation p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.8}.shared-conversation details{font-size:13px;margin-top:12px}</style>
