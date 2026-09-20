<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Close } from '../icons'
import { dateText, errorText, fileSize, getAdminConfig, uploadDocument } from '../api'
import type { DocumentItem } from '../types'

const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ completed: [] }>()
type QueueItem = { file: File; progress: number; status: string; error?: string; duplicate?: DocumentItem }
const queue = ref<QueueItem[]>([])
const dragging = ref(false)
const running = ref(false)
const maxMb = ref(20)
watch(open, async (visible) => { if (visible) { try { maxMb.value = (await getAdminConfig()).maxUploadSizeMb } catch { /* upload still validated by server */ } } })
const input = ref<HTMLInputElement | null>(null)
const allowed = ['pdf','docx','txt','md','xlsx','pptx','png','jpg','jpeg']
function add(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const error = ['doc','xls','ppt'].includes(ext) ? '暂不支持旧版 Office 格式，请转换后上传' : !allowed.includes(ext) ? '暂不支持该文件格式' : file.size > maxMb.value * 1024 * 1024 ? `文件超过 ${maxMb.value} MB 限制` : file.size === 0 ? '文件为空' : undefined
    queue.value.push({ file, progress: 0, status: error ? '无法上传' : '等待上传', error })
  }
}
function drop(event: DragEvent) { dragging.value = false; if (event.dataTransfer?.files) add(event.dataTransfer.files) }
async function uploadAll() {
  if (running.value) return
  running.value = true
  for (const item of queue.value) {
    if (item.error || item.status !== '等待上传') continue
    item.status = '上传中'
    try {
      const result = await uploadDocument(item.file, (value) => { item.progress = value; if (value === 100) item.status = '解析中' })
      if (result.duplicate) {
        item.status = '重复文件'; item.duplicate = result.document
        await ElMessageBox.alert(`《${result.document.displayName}》已经存在于知识库中。\n上传时间：${dateText(result.document.createdAt)}`, '检测到重复文档', { type: 'warning', confirmButtonText: '知道了' })
      } else if (result.document.status === 'FAILED') {
        item.status = '解析失败'; item.error = result.document.errorMessage || '文档处理失败'
      } else { item.status = '上传成功'; item.progress = 100; ElMessage.success(`${item.file.name} 上传成功`) }
      emit('completed')
    } catch (error) { item.status = '上传失败'; item.error = errorText(error); ElMessage.error(`${item.file.name}：${item.error}`) }
  }
  running.value = false
}
</script>
<template>
  <el-drawer v-model="open" title="上传文档" size="min(560px, 100vw)" :close-on-click-modal="!running" :close-on-press-escape="!running" :before-close="(done: () => void) => { if (!running) done() }">
    <div class="upload-body"><p class="upload-intro">将校园通知、规章制度和办事资料加入知识库。</p><input ref="input" type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.xlsx,.pptx,.png,.jpg,.jpeg" @change="(event) => { const target = event.target as HTMLInputElement; if (target.files) add(target.files); target.value = '' }" /><div class="dropzone" :class="{ dragging }" @click="input?.click()" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="drop"><el-icon :size="36"><UploadFilled /></el-icon><strong>拖拽文件到这里，或点击选择文件</strong><span>支持 PDF、Word、TXT、Markdown、Excel、PowerPoint 和常见图片格式</span><small>单个文件最大 {{ maxMb }} MB · 支持批量上传</small></div><div v-if="queue.length" class="upload-queue"><div class="queue-heading">待处理文件 <span>{{ queue.length }}</span></div><div v-for="(item,index) in queue" :key="index" class="queue-row"><span class="file-glyph" :class="item.file.name.split('.').pop()?.toLowerCase()">{{ item.file.name.split('.').pop()?.toUpperCase().slice(0,3) }}</span><div class="queue-main"><strong>{{ item.file.name }}</strong><small>{{ fileSize(item.file.size) }} · {{ item.status }}</small><el-progress v-if="item.status === '上传中' || item.status === '解析中'" :percentage="item.progress" :stroke-width="5" :show-text="false" /><small v-if="item.error" class="queue-error">{{ item.error }}</small></div><el-button v-if="!running" text circle @click="queue.splice(index,1)" aria-label="移除文件"><el-icon><Close /></el-icon></el-button></div></div></div>
    <template #footer><div class="upload-footer"><el-button :disabled="running" @click="open = false">关闭</el-button><el-button type="primary" :loading="running" :disabled="!queue.some(item => item.status === '等待上传')" @click="uploadAll">开始上传</el-button></div></template>
  </el-drawer>
</template>
