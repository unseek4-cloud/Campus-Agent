<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ApplicationStatusTag from '../components/ApplicationStatusTag.vue'
import { listApplications, errorMessage } from '../api'
import { statusLabels, dateText, type ApplicationPage } from '../types'
import '../applications.css'
const props = defineProps<{ admin?: boolean }>(), router = useRouter()
const status = ref(''), page = ref(1), loading = ref(false), error = ref('')
const data = ref<ApplicationPage>({ items: [], total: 0, page: 1, pageSize: 10 })
let request = 0
async function load() {
  const current = ++request; loading.value = true; error.value = ''
  try { const result = await listApplications(!!props.admin, status.value, page.value); if (current === request) data.value = result }
  catch (e) { if (current === request) error.value = errorMessage(e) }
  finally { if (current === request) loading.value = false }
}
watch([page, () => props.admin], load, { immediate: true })
function filter() { if (page.value !== 1) page.value = 1; else void load() }
</script>
<template><div class="application-list"><div class="application-heading"><div><span class="eyebrow">{{ admin ? '工作台 / 办事申请' : 'MY APPLICATIONS' }}</span><h1>{{ admin ? '办事申请管理' : '我的办事' }}</h1><p class="muted">{{ admin ? '查看材料、处理申请，保留每一次审核记录。' : '每一次提交，每一步进展，都在这里。' }}</p></div><el-button :loading="loading" @click="load">刷新</el-button></div>
  <section class="application-panel"><div class="application-filters"><el-select v-model="status" aria-label="申请状态筛选" style="width:190px" @change="filter"><el-option label="全部" value="" /><el-option v-if="!admin" label="办理中" value="ACTIVE" /><el-option v-for="(label, value) in statusLabels" :key="value" :label="label" :value="value" /></el-select><span class="muted">共 {{ data.total }} 份申请</span></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
    <el-table v-else :data="data.items" v-loading="loading" empty-text="暂无申请，可从 AI 问答中的办事指南点击立即办理" table-layout="auto">
      <el-table-column prop="applicationNo" label="申请编号" min-width="210" />
      <el-table-column prop="serviceName" label="办事事项" min-width="170" />
      <el-table-column v-if="admin" prop="applicantName" label="学生姓名" min-width="100" />
      <el-table-column v-if="admin" prop="studentNo" label="学号" min-width="110" />
      <el-table-column label="当前状态" min-width="125"><template #default="{ row }"><ApplicationStatusTag :status="row.status" /></template></el-table-column>
      <el-table-column label="提交时间" min-width="180"><template #default="{ row }">{{ dateText(row.submittedAt) }}</template></el-table-column>
      <el-table-column label="更新时间" min-width="180"><template #default="{ row }">{{ dateText(row.updatedAt) }}</template></el-table-column>
      <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="router.push(`${admin ? '/admin' : '/student'}/applications/${row.id}`)">查看详情</el-button></template></el-table-column>
    </el-table>
    <div class="application-pagination"><el-pagination v-model:current-page="page" background layout="prev, pager, next" :page-size="10" :total="data.total" /></div>
  </section>
</div></template>
