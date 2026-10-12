<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { reviewApplication, errorMessage } from '../api'
import { statusLabels, type ApplicationRecord, type ApplicationStatus, type ApplicationDetail } from '../types'
const props = defineProps<{ application: ApplicationRecord }>()
const emit = defineEmits<{ updated: [ApplicationDetail]; stale: [] }>()
const remark = ref(''), busy = ref(false)
const history = ref<ApplicationStatus[]>([props.application.status])
watch(() => [props.application.id, props.application.version], () => { history.value = [props.application.status] })
const draft = computed(() => history.value[history.value.length - 1]!)
const actions = computed<{ status: ApplicationStatus; label: string }[]>(() => {
  switch (draft.value) {
    case 'SUBMITTED': return [{ status: 'REVIEWING', label: '开始审核' }]
    case 'REVIEWING': return [{ status: 'NEED_MORE', label: '要求补充材料' }, { status: 'APPROVED', label: '审核通过' }, { status: 'REJECTED', label: '审核不通过' }]
    case 'APPROVED': return [{ status: 'COMPLETED', label: '标记办结' }]
    default: return []
  }
})
function advance(status: ApplicationStatus) { if (!busy.value) history.value.push(status) }
async function review() {
  if (busy.value) return
  const status = draft.value
  if (['NEED_MORE', 'REJECTED'].includes(status) && !remark.value.trim()) { ElMessage.warning('请填写审核意见，说明需要补充或不通过的原因'); return }
  busy.value = true
  try {
    emit('updated', await reviewApplication(props.application, status, remark.value)); remark.value = ''; ElMessage.success('申请状态已更新')
  } catch (e) { ElMessage.error(errorMessage(e)) }
  finally { busy.value = false }
}
</script>
<template>
  <section class="application-panel"><h2>审核操作</h2>
    <template v-if="actions.length || history.length > 1">
      <p class="muted">开始审核 → 确认审核结果 → 确认办理完成。可连续操作，最后统一提交结果与本次意见。</p>
      <p v-if="history.length > 1" role="status">待提交结果：<strong>{{ statusLabels[draft] }}</strong></p>
      <el-input v-model="remark" aria-label="管理员意见" type="textarea" :rows="3" maxlength="4000" show-word-limit :disabled="busy" placeholder="只需填写一次审核意见；要求补充材料或不通过时必填" />
      <div class="application-actions"><el-button v-if="history.length > 1" :disabled="busy" @click="history.pop()">上一步</el-button><el-button v-for="action in actions" :key="action.status" :disabled="busy" @click="advance(action.status)">{{ action.label }}</el-button><el-button v-if="history.length > 1" type="primary" :loading="busy" :disabled="busy" @click="review">提交审核结果</el-button></div>
    </template>
    <p v-else class="muted">{{ application.status === 'NEED_MORE' ? '等待学生补充材料并重新提交。' : '本次办理已结束，审核记录已保留。' }}</p>
  </section>
</template>
