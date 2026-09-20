<script setup lang="ts">
import { dateText, fileSize } from '../api'
import type { DocumentItem } from '../types'
import DocumentStatusBadge from './DocumentStatusBadge.vue'
const open = defineModel<boolean>({ required: true })
defineProps<{ document: DocumentItem | null }>()
</script>
<template><el-drawer v-model="open" title="文档详情" size="min(480px, 100vw)"><div v-if="document" class="detail-content"><div class="detail-heading"><span class="file-glyph large" :class="document.fileType">{{ document.fileType.toUpperCase().slice(0, 3) }}</span><div><h2>{{ document.displayName }}</h2><DocumentStatusBadge :status="document.status" /></div></div><dl class="detail-grid"><dt>原始文件名</dt><dd>{{ document.originalFilename }}</dd><dt>文档类型</dt><dd>{{ document.fileType.toUpperCase() }}</dd><dt>文件大小</dt><dd>{{ fileSize(document.fileSize) }}</dd><dt>知识片段</dt><dd>{{ document.chunkCount }}</dd><dt>上传时间</dt><dd>{{ dateText(document.createdAt) }}</dd><dt>更新时间</dt><dd>{{ dateText(document.updatedAt) }}</dd><dt>文件 SHA-256</dt><dd class="hash-text">{{ document.fileHash }}</dd></dl><el-alert v-if="document.status === 'FAILED'" title="解析失败" type="error" :description="document.errorMessage || '文档处理失败，请稍后重试。'" show-icon :closable="false" /></div></el-drawer></template>
