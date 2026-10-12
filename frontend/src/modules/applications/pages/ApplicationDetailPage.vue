<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import ApplicationStatusTag from '../components/ApplicationStatusTag.vue'
import ApplicationTimeline from '../components/ApplicationTimeline.vue'
import ApplicationReview from '../components/ApplicationReview.vue'
import ApplicationForm from '../components/ApplicationForm.vue'
import { getApplication, submitApplication, downloadApplicationAttachment, errorMessage } from '../api'
import { dateText, type ApplicationDetail, type ApplicationAttachment, type SelectedAttachment } from '../types'
import '../applications.css'
const props = defineProps<{ admin?: boolean }>(), route = useRoute()
const detail = ref<ApplicationDetail>(), loading = ref(false), busy = ref(false), error = ref('')
const downloading = ref('')
async function load() {
  loading.value = true; error.value = ''; detail.value = undefined
  try { detail.value = await getApplication(Number(route.params.id), !!props.admin) }
  catch (e) { error.value = errorMessage(e) } finally { loading.value = false }
}
watch([() => route.params.id, () => props.admin], load, { immediate: true })
async function resubmit(remark: string, files: SelectedAttachment[]) {
  if (busy.value || !detail.value) return
  busy.value = true
  try { detail.value = await submitApplication(detail.value.application.serviceItemId, remark, files, detail.value.application); ElMessage.success('补充材料已上传，申请已重新提交。') }
  catch (e) { ElMessage.error(errorMessage(e)) } finally { busy.value = false }
}
async function download(file: ApplicationAttachment) {
  downloading.value = file.id
  try { await downloadApplicationAttachment(file, !!props.admin) }
  catch { ElMessage.error('文件下载失败，请刷新后重试。') } finally { downloading.value = '' }
}
</script>
<template><div v-loading="loading" class="application-detail"><div class="application-heading"><router-link :to="admin ? '/admin/applications' : '/student/applications'">← {{ admin ? '办事申请管理' : '我的办事' }}</router-link><el-button :loading="loading" :disabled="busy" @click="load">刷新进度</el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
  <template v-if="detail"><section class="application-panel application-summary"><div class="application-heading"><div><span class="eyebrow">{{ detail.application.applicationNo }}</span><h1>{{ detail.application.serviceName }}</h1></div><ApplicationStatusTag :status="detail.application.status" /></div>
    <dl class="application-facts"><div><dt>申请人</dt><dd>{{ detail.application.applicantName }}</dd></div><div><dt>学号</dt><dd>{{ detail.application.studentNo }}</dd></div><div v-if="admin"><dt>账号 / 用户 ID</dt><dd>{{ detail.application.username }} / {{ detail.application.userId }}</dd></div><div><dt>提交时间</dt><dd>{{ dateText(detail.application.submittedAt) }}</dd></div><div><dt>更新时间</dt><dd>{{ dateText(detail.application.updatedAt) }}</dd></div><div v-if="detail.application.completedAt"><dt>办结时间</dt><dd>{{ dateText(detail.application.completedAt) }}</dd></div></dl>
    <h2>申请说明</h2><p class="preserve-lines">{{ detail.application.studentRemark }}</p>
    <el-alert class="admin-remark" :title="detail.application.status === 'NEED_MORE' ? '待补充材料 · 请根据管理员意见补交' : '管理员意见'" :type="detail.application.status === 'NEED_MORE' ? 'warning' : 'info'" :closable="false" show-icon><p class="preserve-lines">{{ detail.application.adminRemark || '暂无审核意见' }}</p></el-alert>
  </section><div class="application-columns"><div><section class="application-panel"><h2>申请材料 <small>已上传 {{ detail.attachments.length }} 份</small></h2><ul class="selected-files"><li v-for="file in detail.attachments" :key="file.id"><span>{{ file.filename }}<small v-if="file.materialName">对应材料：{{ file.materialName }}</small><small>{{ dateText(file.uploadedAt) }} · {{ Math.ceil(file.fileSize / 1024) }} KB</small></span><el-button link type="primary" :loading="downloading === file.id" @click="download(file)">下载</el-button></li></ul><p v-if="!detail.attachments.length" class="muted">此申请未上传附件。</p></section>
    <ApplicationReview v-if="admin" :application="detail.application" @updated="detail = $event" @stale="load" />
    <section v-else-if="detail.application.status === 'NEED_MORE'" class="application-panel"><h2>补充材料</h2><ApplicationForm :key="detail.application.version" :initial-remark="detail.application.studentRemark" :busy="busy" :materials="detail.materials || []" supplement @submit="resubmit" /></section>
  </div><ApplicationTimeline :events="detail.events" /></div></template>
</div></template>
