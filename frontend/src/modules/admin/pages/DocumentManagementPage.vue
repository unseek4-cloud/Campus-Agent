<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentAdd, Search, Refresh, Files } from '../icons'
import { deleteDocument, errorText, listDocuments, renameDocument, reprocessDocument } from '../api'
import type { DocumentItem, DocumentPage } from '../types'
import DocumentTable from '../components/DocumentTable.vue'
import DocumentUploader from '../components/DocumentUploader.vue'
import DocumentDetailDrawer from '../components/DocumentDetailDrawer.vue'

const page = ref<DocumentPage>({ items: [], total: 0, page: 1, pageSize: 20 })
const loading = ref(false), error = ref(''), search = ref(''), type = ref(''), status = ref('')
const currentPage = ref(1), uploading = ref(false), detailOpen = ref(false)
const selected = ref<DocumentItem | null>(null), busyId = ref('')
let debounce: ReturnType<typeof setTimeout> | undefined
async function load() {
  loading.value = true; error.value = ''
  try { page.value = await listDocuments({ search: search.value, type: type.value, status: status.value, page: currentPage.value, pageSize: 20 }) }
  catch (e) { error.value = errorText(e); ElMessage.error(error.value) }
  finally { loading.value = false }
}
watch([type,status], () => { currentPage.value = 1; load() })
watch(search, () => { clearTimeout(debounce); debounce = setTimeout(() => { currentPage.value = 1; load() }, 300) })
watch(currentPage, load)
onMounted(load)
function view(item: DocumentItem) { selected.value = item; detailOpen.value = true }
async function rename(item: DocumentItem) {
  if (busyId.value) return
  try {
    const result = await ElMessageBox.prompt('请输入新的文档名称', '修改文档名称', { inputValue: item.displayName, inputPattern: /\S/, inputErrorMessage: '名称不能为空', confirmButtonText: '保存', cancelButtonText: '取消' })
    busyId.value = item.id; await renameDocument(item.id, result.value); ElMessage.success('名称修改成功'); await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e)) }
  finally { busyId.value = '' }
}
async function remove(item: DocumentItem) {
  if (busyId.value) return
  try {
    await ElMessageBox.confirm(`确定删除《${item.displayName}》吗？文档和对应知识片段将一并删除。`, '删除文档', { type: 'warning', confirmButtonText: '删除文档', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' })
    busyId.value = item.id; await deleteDocument(item.id); ElMessage.success('文档已删除'); if (page.value.items.length === 1 && currentPage.value > 1) currentPage.value--; await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e)) }
  finally { busyId.value = '' }
}
async function reprocess(item: DocumentItem) {
  if (busyId.value) return
  try {
    await ElMessageBox.confirm('重新解析将重新生成文本片段和向量索引，是否继续？', '重新解析', { confirmButtonText: '继续解析', cancelButtonText: '取消' })
    busyId.value = item.id; ElMessage.info('开始重新解析'); const result = await reprocessDocument(item.id)
    if (result.status === 'FAILED') ElMessage.error('解析失败，请查看文档详情'); else ElMessage.success('重新解析完成')
    await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e)) }
  finally { busyId.value = '' }
}
</script>
<template><div class="admin-page"><div class="page-intro"><div><div class="eyebrow">工作台 / 知识库管理</div><h1>知识库管理</h1><p>管理 CampusAgent 使用的校园知识资料。</p></div><el-button type="primary" size="large" @click="uploading = true"><el-icon><DocumentAdd /></el-icon>上传文档</el-button></div><section class="panel-card"><div class="panel-head management-head"><div><h2>文档列表</h2><p>共 {{ page.total }} 份文档 · 最新上传在前</p></div><el-button text :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></div><div class="filter-bar"><el-input v-model="search" placeholder="搜索文档名称……" clearable class="search-input" :prefix-icon="Search" /><el-select v-model="type" placeholder="全部类型" style="width: 150px"><el-option label="全部类型" value="" /><el-option label="PDF" value="pdf" /><el-option label="Word" value="docx" /><el-option label="文本" value="txt" /><el-option label="Markdown" value="md" /><el-option label="表格" value="xlsx" /><el-option label="演示文稿" value="pptx" /><el-option label="图片 PNG" value="png" /><el-option label="图片 JPG" value="jpg" /><el-option label="图片 JPEG" value="jpeg" /></el-select><el-select v-model="status" placeholder="全部状态" style="width: 150px"><el-option label="全部状态" value="" /><el-option label="解析成功" value="SUCCESS" /><el-option label="处理中" value="PROCESSING" /><el-option label="解析失败" value="FAILED" /></el-select></div><el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="list-error"><template #default><el-button link type="primary" @click="load">重试</el-button></template></el-alert><div v-if="!loading && !error && page.total === 0" class="empty-panel"><el-icon :size="42"><Files /></el-icon><h3>{{ search || type || status ? '没有符合条件的文档' : '暂无知识库文档' }}</h3><p>{{ search || type || status ? '尝试调整搜索词或筛选条件。' : '上传第一份校园资料，开始构建知识库。' }}</p><el-button v-if="!search && !type && !status" type="primary" @click="uploading = true">上传第一份文档</el-button></div><DocumentTable v-else :items="page.items" :loading="loading" @view="view" @rename="rename" @remove="remove" @reprocess="reprocess" /><div class="table-footer" v-if="page.total > 0"><span>显示 {{ (currentPage - 1) * 20 + 1 }}–{{ Math.min(currentPage * 20, page.total) }} 条，共 {{ page.total }} 条</span><el-pagination v-model:current-page="currentPage" background layout="prev, pager, next" :page-size="20" :total="page.total" /></div></section><DocumentUploader v-model="uploading" @completed="load" /><DocumentDetailDrawer v-model="detailOpen" :document="selected" /></div></template>
