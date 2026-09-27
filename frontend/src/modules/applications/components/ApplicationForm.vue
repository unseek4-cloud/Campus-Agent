<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AttachmentPicker from './AttachmentPicker.vue'
import { uploadConfig, errorMessage } from '../api'
import type { UploadConfig } from '../types'
const props = defineProps<{ initialRemark?: string; busy: boolean; supplement?: boolean; requireFiles?: boolean }>()
const emit = defineEmits<{ submit: [remark: string, files: File[]] }>()
const remark = ref(props.initialRemark || ''), files = ref<File[]>([]), config = ref<UploadConfig>(), error = ref('')
async function load() { try { config.value = await uploadConfig(); error.value = '' } catch (e) { error.value = errorMessage(e) } }
onMounted(load)
function submit() {
  if (!remark.value.trim()) { ElMessage.warning('请填写申请说明'); return }
  if ((props.requireFiles || props.supplement) && !files.value.length) { ElMessage.warning('请上传所需的申请材料'); return }
  emit('submit', remark.value, files.value)
}
</script>
<template>
  <el-form label-position="top" @submit.prevent="submit">
    <el-form-item :label="supplement ? '补充说明' : '申请说明'" required><el-input v-model="remark" :disabled="busy" type="textarea" :rows="4" maxlength="4000" show-word-limit placeholder="请简单说明申请原因，并确认材料完整。" :aria-label="supplement ? '补充说明' : '申请说明'" /></el-form-item>
    <AttachmentPicker v-if="config" v-model="files" :config="config" :disabled="busy" />
    <el-alert v-if="error" type="error" :title="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
    <el-button type="primary" size="large" native-type="submit" :loading="busy" :disabled="!config || busy">{{ supplement ? '重新提交' : '提交申请' }}</el-button>
  </el-form>
</template>
