<script setup lang="ts">
import { MoreFilled } from '../icons'
import { dateText, fileSize } from '../api'
import type { DocumentItem } from '../types'
import DocumentStatusBadge from './DocumentStatusBadge.vue'
defineProps<{ items: DocumentItem[]; loading?: boolean }>()
const emit = defineEmits<{ view: [DocumentItem]; rename: [DocumentItem]; remove: [DocumentItem]; reprocess: [DocumentItem] }>()
function command(action: string, row: DocumentItem) {
  if (action === 'view') emit('view', row)
  else if (action === 'rename') emit('rename', row)
  else if (action === 'remove') emit('remove', row)
  else if (action === 'reprocess') emit('reprocess', row)
}
</script>
<template>
  <el-table :data="items" v-loading="loading" class="document-table" table-layout="auto" empty-text="暂无知识库文档">
    <el-table-column label="文档名称" min-width="260"><template #default="{ row }"><button class="doc-link" @click="emit('view', row)"><span class="file-glyph" :class="row.fileType">{{ row.fileType === 'docx' ? 'W' : row.fileType === 'xlsx' ? 'X' : row.fileType === 'pptx' ? 'P' : row.fileType.toUpperCase().slice(0, 3) }}</span><span class="doc-title">{{ row.displayName }}</span></button></template></el-table-column>
    <el-table-column label="文件类型" width="105"><template #default="{ row }">{{ row.fileType.toUpperCase() }}</template></el-table-column>
    <el-table-column label="文件大小" width="115"><template #default="{ row }">{{ fileSize(row.fileSize) }}</template></el-table-column>
    <el-table-column label="解析状态" width="125"><template #default="{ row }"><DocumentStatusBadge :status="row.status" /></template></el-table-column>
    <el-table-column label="片段" prop="chunkCount" width="75" />
    <el-table-column label="上传时间" width="175"><template #default="{ row }">{{ dateText(row.createdAt) }}</template></el-table-column>
    <el-table-column label="更新时间" width="175"><template #default="{ row }">{{ dateText(row.updatedAt) }}</template></el-table-column>
    <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-dropdown trigger="click" @command="(action: string) => command(action, row)"><el-button text circle aria-label="文档操作"><el-icon><MoreFilled /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="view">查看详情</el-dropdown-item><el-dropdown-item command="rename">重命名</el-dropdown-item><el-dropdown-item command="reprocess">重新解析</el-dropdown-item><el-dropdown-item command="remove" divided class="danger-item">删除文档</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template></el-table-column>
  </el-table>
</template>
