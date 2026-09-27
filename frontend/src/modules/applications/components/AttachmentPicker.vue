<script setup lang="ts">
import { ElMessage } from 'element-plus'
import type { UploadConfig } from '../types'
const props = defineProps<{ modelValue: File[]; config: UploadConfig; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [File[]] }>()
function choose(event: Event) {
  const input = event.target as HTMLInputElement, files = [...props.modelValue]
  for (const file of Array.from(input.files || [])) {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!props.config.extensions.includes(extension)) { ElMessage.error('文件格式不支持，请选择 PDF、Word 或图片'); continue }
    if (!file.size || file.size > props.config.maxUploadSizeMb * 1024 * 1024) { ElMessage.error(`文件不能为空，单个文件最多 ${props.config.maxUploadSizeMb} MB`); continue }
    if (files.length >= props.config.maxFiles) { ElMessage.error(`每次最多 ${props.config.maxFiles} 个文件`); break }
    if (files.reduce((sum, selected) => sum + selected.size, file.size) > props.config.maxTotalSizeMb * 1024 * 1024) { ElMessage.error('文件总大小不能超过 100 MB'); continue }
    files.push(file)
  }
  emit('update:modelValue', files); input.value = ''
}
</script>
<template>
  <div class="attachment-picker">
    <label class="file-picker-label">选择申请材料<input aria-label="选择申请材料" type="file" multiple :disabled="disabled" :accept="config.extensions.map(x => '.' + x).join(',')" @change="choose"></label>
    <p class="muted">支持 {{ config.extensions.join(' / ').toUpperCase() }} · 每个文件最多 {{ config.maxUploadSizeMb }} MB · 每次最多 {{ config.maxFiles }} 个</p>
    <p class="muted">材料随申请一起上传；提交成功后可在详情下载。</p>
    <ul class="selected-files"><li v-for="(file, index) in modelValue" :key="index"><span>{{ file.name }} <small>已选择 · {{ Math.ceil(file.size / 1024) }} KB</small></span><el-button text type="danger" :disabled="disabled" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">移除</el-button></li></ul>
  </div>
</template>
