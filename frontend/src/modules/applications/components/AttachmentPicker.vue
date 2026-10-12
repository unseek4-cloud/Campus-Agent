<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed } from 'vue'
import type { UploadConfig, SelectedAttachment } from '../types'
import type { ServiceMaterial } from '../../serviceguide/types'
const props = defineProps<{ modelValue: SelectedAttachment[]; materials: ServiceMaterial[]; config: UploadConfig; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [SelectedAttachment[]] }>()
const groups = computed(() => [...props.materials.map(material => ({ ...material, id: material.id || '' })),
  { id: '', name: '其他附件 / 补充说明', required: false, description: null }])
function choose(event: Event, materialId: string) {
  const input = event.target as HTMLInputElement, files = [...props.modelValue]
  for (const file of Array.from(input.files || [])) {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!props.config.extensions.includes(extension)) { ElMessage.error('文件格式不支持，请选择 PDF、Word 或图片'); continue }
    if (!file.size || file.size > props.config.maxUploadSizeMb * 1024 * 1024) { ElMessage.error(`文件不能为空，单个文件最多 ${props.config.maxUploadSizeMb} MB`); continue }
    if (files.length >= props.config.maxFiles) { ElMessage.error(`每次最多 ${props.config.maxFiles} 个文件`); break }
    if (files.reduce((sum, selected) => sum + selected.file.size, file.size) > props.config.maxTotalSizeMb * 1024 * 1024) { ElMessage.error(`文件总大小不能超过 ${props.config.maxTotalSizeMb} MB`); continue }
    files.push({ file, materialId })
  }
  emit('update:modelValue', files); input.value = ''
}
</script>
<template>
  <div class="attachment-picker">
    <p class="muted">支持 {{ config.extensions.join(' / ').toUpperCase() }} · 每个文件最多 {{ config.maxUploadSizeMb }} MB · 每次最多 {{ config.maxFiles }} 个</p>
    <p class="muted">材料随申请一起上传；提交成功后可在详情下载。</p>
    <section v-for="group in groups" :key="group.id" class="material-upload-group">
      <div class="application-heading"><strong>{{ group.required ? '必交' : '选交' }} · {{ group.name }}</strong><small>{{ modelValue.some(item => item.materialId === group.id) ? '已选择' : group.required ? '待上传' : '可选' }}</small></div>
      <p v-if="group.description" class="muted">{{ group.description }}</p>
      <label class="material-upload-picker">选择文件<input :aria-label="`上传${group.name}`" type="file" multiple :disabled="disabled" :accept="config.extensions.map(x => '.' + x).join(',')" @change="choose($event, group.id)"></label>
      <ul class="selected-files"><template v-for="(item, index) in modelValue" :key="index"><li v-if="item.materialId === group.id"><span>{{ item.file.name }} <small>已选择 · {{ Math.ceil(item.file.size / 1024) }} KB</small></span><el-button text type="danger" :disabled="disabled" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">移除</el-button></li></template></ul>
    </section>
  </div>
</template>
<style scoped>.material-upload-group{border:1px solid #e4e7ed;border-radius:10px;padding:16px;margin:12px 0}.material-upload-group strong{overflow-wrap:anywhere}.material-upload-group small{white-space:nowrap}.material-upload-group .application-heading{margin-bottom:10px}.material-upload-picker{display:inline-block;position:relative;cursor:pointer;border:1px solid #a7bddc;border-radius:6px;padding:8px 14px;color:#446da8;background:#f8fbff}.material-upload-picker input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.material-upload-picker:focus-within{outline:2px solid #446da8;outline-offset:2px}.material-upload-picker:has(input:disabled){opacity:.6;cursor:default}</style>
