<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorText } from '../../admin/api'
import { getMaterialUploadConfig, uploadMaterialAttachment, deleteMaterialAttachment } from '../api'
import type { MaterialAttachment, ServiceMaterial } from '../types'
import MaterialDownloadLink from './MaterialDownloadLink.vue'
const props = defineProps<{ serviceId: number | null; material: ServiceMaterial; disabled?: boolean }>()
const emit = defineEmits<{ updated: [attachment: MaterialAttachment | null]; busy: [value: boolean] }>()
const input = ref<HTMLInputElement>(), busy = ref(false)
const config = ref<{ maxUploadSizeMb: number; extensions: string[] }>()
const accept = computed(() => config.value?.extensions.map(ext => `.${ext}`).join(',') || '')
onMounted(async () => { try { config.value = await getMaterialUploadConfig() } catch (e) { ElMessage.error(errorText(e)) } })
function setBusy(value: boolean) { busy.value = value; emit('busy', value) }
async function upload(event: Event) {
  const target = event.target as HTMLInputElement, file = target.files?.[0]
  target.value = ''
  if (!file || !props.serviceId || !props.material.id || !config.value) return
  if (!config.value.extensions.includes(file.name.split('.').pop()?.toLowerCase() || '')) { ElMessage.error('请选择支持的模板文件格式'); return }
  if (!file.size || file.size > config.value.maxUploadSizeMb * 1024 * 1024) { ElMessage.error(`文件不能为空，且不能超过 ${config.value.maxUploadSizeMb} MB`); return }
  setBusy(true)
  try { emit('updated', await uploadMaterialAttachment(props.serviceId, props.material.id, file)); ElMessage.success('材料附件已保存') }
  catch (e) { ElMessage.error(errorText(e)) }
  finally { setBusy(false) }
}
async function remove() {
  if (!props.serviceId || !props.material.id) return
  setBusy(true)
  try {
    await ElMessageBox.confirm('删除该材料的附件？所需材料本身会保留。', '删除附件', { confirmButtonText: '删除附件', cancelButtonText: '取消', type: 'warning' })
    await deleteMaterialAttachment(props.serviceId, props.material.id)
    emit('updated', null); ElMessage.success('附件已删除')
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e)) }
  finally { setBusy(false) }
}
</script>
<template>
  <div class="attachment-editor">
    <template v-if="serviceId && material.id">
      <span>{{ material.attachment ? `附件：${material.attachment.filename}` : '暂无附件' }}</span>
      <MaterialDownloadLink v-if="material.attachment" :attachment="material.attachment" admin compact />
      <input ref="input" type="file" :accept="accept" hidden @change="upload">
      <el-button link type="primary" :loading="busy" :disabled="disabled || busy || !config" @click="input?.click()">{{ material.attachment ? '替换' : '上传附件' }}</el-button>
      <el-button v-if="material.attachment" link type="danger" :disabled="disabled || busy" @click="remove">删除附件</el-button>
      <small v-if="config">{{ config.extensions.join(' / ').toUpperCase() }} · 最大 {{ config.maxUploadSizeMb }} MB · 附件操作立即生效</small>
    </template>
    <span v-else>保存事项与材料后可上传附件。</span>
  </div>
</template>
<style scoped>
.attachment-editor{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:8px 0;color:#788697;font-size:12px;width:100%;overflow-wrap:anywhere}.attachment-editor small{width:100%;font-size:11px;color:#94a0ad}.attachment-editor :deep(.material-download){margin-top:0}
</style>
