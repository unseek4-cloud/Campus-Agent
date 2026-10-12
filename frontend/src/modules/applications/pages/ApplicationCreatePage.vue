<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentUser } from '../../auth/state'
import ServiceGuideCard from '../../serviceguide/components/ServiceGuideCard.vue'
import type { ServiceDetail } from '../../serviceguide/types'
import ApplicationForm from '../components/ApplicationForm.vue'
import { getActiveApplication, getApplicationService, submitApplication, errorMessage } from '../api'
import type { ApplicationRecord, SelectedAttachment } from '../types'
const route = useRoute(), router = useRouter(), service = ref<ServiceDetail>(), active = ref<ApplicationRecord | null>(null)
const loading = ref(false), busy = ref(false), error = ref('')
async function load() {
  loading.value = true; error.value = ''; service.value = undefined; active.value = null
  try { [service.value, active.value] = await Promise.all([getApplicationService(Number(route.params.id)), getActiveApplication(Number(route.params.id))]) }
  catch (e) { error.value = errorMessage(e) } finally { loading.value = false }
}
watch(() => route.params.id, load, { immediate: true })
async function submit(remark: string, files: SelectedAttachment[]) {
  if (busy.value || !service.value) return
  busy.value = true
  try {
    const detail = await submitApplication(service.value.service.id!, remark, files)
    ElMessage.success('申请提交成功。'); await router.replace(`/student/applications/${detail.application.id}`)
  } catch (e) {
    ElMessage.error(errorMessage(e))
    try { active.value = await getActiveApplication(Number(route.params.id)) } catch { /* Keep the original form for retry. */ }
  } finally { busy.value = false }
}
</script>
<template><div v-loading="loading"><div class="application-heading"><div><span class="eyebrow">ONLINE APPLICATION</span><h1>在线申请</h1><p class="muted">确认办理要求，提交材料，随时跟踪进度。</p></div><router-link to="/student/applications">我的办事 →</router-link></div>
  <el-alert v-if="error" type="error" :title="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
  <template v-if="service"><el-alert v-if="active" title="你已经有一个正在办理中的申请。" type="info" :closable="false" show-icon><router-link :to="`/student/applications/${active.id}`"><el-button type="primary">查看办理进度</el-button></router-link></el-alert>
    <div class="application-columns"><section class="application-panel"><h2>{{ service.service.name }}</h2><dl class="application-facts"><div><dt>申请人</dt><dd>{{ currentUser?.displayName }}</dd></div><div><dt>学号</dt><dd>{{ currentUser?.studentNo || '请联系管理员配置学号' }}</dd></div></dl><ApplicationForm v-if="!active && currentUser?.studentNo" :busy="busy" :materials="service.service.materials" @submit="submit" /></section>
    <ServiceGuideCard :service="service.service" :steps="service.steps" :show-apply="false" /></div>
  </template>
</div></template>
