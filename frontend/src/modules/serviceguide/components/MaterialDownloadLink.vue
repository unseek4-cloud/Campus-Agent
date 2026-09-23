<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { downloadMaterialAttachment, materialDownloadUrl } from '../api'
import type { MaterialAttachment } from '../types'
const props = defineProps<{ attachment: MaterialAttachment; admin?: boolean; compact?: boolean }>()
const busy = ref(false)
async function download() {
  if (busy.value) return
  busy.value = true
  try { await downloadMaterialAttachment(props.attachment, props.admin) }
  catch { ElMessage.error('文件下载失败，请稍后重试。') }
  finally { busy.value = false }
}
</script>
<template>
  <a class="material-download" :href="materialDownloadUrl(attachment, admin)" :aria-disabled="busy" @click.stop.prevent="download">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></svg>
    {{ busy ? '下载中…' : compact ? '下载' : `下载：${attachment.filename}` }}
  </a>
</template>
<style scoped>
.material-download{display:inline-flex;align-items:center;gap:5px;margin-top:6px;color:#3674bd;font-size:12px;text-decoration:none;cursor:pointer;overflow-wrap:anywhere;max-width:100%}.material-download:hover{text-decoration:underline}.material-download svg{flex-shrink:0}.material-download[aria-disabled=true]{opacity:.65;cursor:wait}
</style>
