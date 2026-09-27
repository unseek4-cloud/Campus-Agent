<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { reviewApplication, errorMessage } from '../api'
import type { ApplicationRecord, ApplicationStatus, ApplicationDetail } from '../types'
const props = defineProps<{ application: ApplicationRecord }>()
const emit = defineEmits<{ updated: [ApplicationDetail]; stale: [] }>()
const remark = ref(''), busy = ref(false)
const actions = computed<{ status: ApplicationStatus; label: string }[]>(() => {
  switch (props.application.status) {
    case 'SUBMITTED': return [{ status: 'REVIEWING', label: '开始审核' }]
    case 'REVIEWING': return [{ status: 'NEED_MORE', label: '要求补充材料' }, { status: 'APPROVED', label: '审核通过' }, { status: 'REJECTED', label: '审核不通过' }]
    case 'APPROVED': return [{ status: 'COMPLETED', label: '标记办结' }]
    default: return []
  }
})
async function review(status: ApplicationStatus) {
  if (busy.value) return
  if (['NEED_MORE', 'REJECTED'].includes(status) && !remark.value.trim()) { ElMessage.warning('请填写审核意见，说明需要补充或不通过的原因'); return }
  busy.value = true
  try {
    if (['REJECTED', 'COMPLETED'].includes(status)) {
      try { await ElMessageBox.confirm(status === 'REJECTED' ? '确认此申请审核不通过？' : '确认此事项已经办理完成？', '确认审核操作', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }) }
      catch { return }
    }
    emit('updated', await reviewApplication(props.application, status, remark.value)); remark.value = ''; ElMessage.success('申请状态已更新')
  } catch (e) { ElMessage.error(errorMessage(e)); emit('stale') }
  finally { busy.value = false }
}
</script>
<template>
  <section class="application-panel"><h2>审核操作</h2>
    <template v-if="actions.length"><el-input v-model="remark" aria-label="管理员意见" type="textarea" :rows="3" maxlength="4000" show-word-limit :disabled="busy" placeholder="填写审核意见；要求补充材料或不通过时必填" /><div class="application-actions"><el-button v-for="action in actions" :key="action.status" :type="action.status === 'REJECTED' ? 'danger' : 'primary'" :loading="busy" :disabled="busy" @click="review(action.status)">{{ action.label }}</el-button></div></template>
    <p v-else class="muted">{{ application.status === 'NEED_MORE' ? '等待学生补充材料并重新提交。' : '本次办理已结束，审核记录已保留。' }}</p>
  </section>
</template>
