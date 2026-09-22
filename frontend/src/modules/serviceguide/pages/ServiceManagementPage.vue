<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorText } from '../../admin/api'
import { deleteService, getService, listServices, saveService } from '../api'
import type { ServiceDetail, ServiceItem } from '../types'
import ServiceGuideCard from '../components/ServiceGuideCard.vue'

const items = ref<ServiceItem[]>([]), search = ref(''), loading = ref(false), saving = ref(false), error = ref('')
const selected = ref<ServiceDetail | null>(null), editor = ref<ServiceDetail | null>(null)
const requirements = ref(''), subjects = ref(''), actions = ref(''), exclusions = ref('')
const visible = computed(() => items.value.filter(s => `${s.name} ${s.code} ${s.category}`.toLowerCase().includes(search.value.toLowerCase())))
const lines = (value: string) => value.split('\n').map(s => s.trim()).filter(Boolean)
async function load() {
  loading.value = true; error.value = ''
  try { items.value = await listServices() }
  catch (e) { error.value = errorText(e) }
  finally { loading.value = false }
}
onMounted(load)
async function view(item: ServiceItem) {
  try { selected.value = await getService(item.id!) }
  catch (e) { ElMessage.error(errorText(e)) }
}
async function edit(item?: ServiceItem) {
  try {
    editor.value = item ? await getService(item.id!) : {
      service: { id: null, code: '', name: '', category: '', description: null, department: null,
        location: null, officeHours: null, contact: null, requirements: [], materials: [],
        recognitionRules: { subjects: [], actions: [], exclusions: [] }, deadline: null,
        sourceDocumentId: null, sourceTitle: null, sourceUrl: null, sourcePublishTime: null,
        status: 'DRAFT', isExample: false, version: 0 }, steps: [],
    }
    requirements.value = editor.value.service.requirements.join('\n')
    subjects.value = editor.value.service.recognitionRules.subjects.join('\n')
    actions.value = editor.value.service.recognitionRules.actions.join('\n')
    exclusions.value = editor.value.service.recognitionRules.exclusions.join('\n')
  } catch (e) { ElMessage.error(errorText(e)) }
}
function addStep() {
  if (!editor.value) return
  editor.value.steps.push({ order: editor.value.steps.length + 1, title: '', description: null,
    responsibleDepartment: null, requiredMaterials: [], location: null, estimatedTime: null })
}
function moveStep(index: number, offset: number) {
  const steps = editor.value?.steps
  if (!steps || index + offset < 0 || index + offset >= steps.length) return
  const [step] = steps.splice(index, 1)
  if (step) steps.splice(index + offset, 0, step)
}
async function save() {
  if (!editor.value || saving.value) return
  saving.value = true
  try {
    const data: ServiceDetail = JSON.parse(JSON.stringify(editor.value))
    data.service.requirements = lines(requirements.value)
    data.service.recognitionRules = { subjects: lines(subjects.value), actions: lines(actions.value), exclusions: lines(exclusions.value) }
    for (const key of ['sourceDocumentId', 'sourceTitle', 'sourceUrl', 'sourcePublishTime'] as const) {
      data.service[key] = data.service[key]?.trim() || null
    }
    data.steps.forEach((s, i) => { s.order = i + 1 })
    await saveService(data)
    editor.value = null; selected.value = null; ElMessage.success('办事事项已保存'); await load()
  } catch (e) { ElMessage.error(errorText(e)) }
  finally { saving.value = false }
}
async function remove(item: ServiceItem) {
  try {
    await ElMessageBox.confirm(`删除“${item.name}”及全部步骤？关联的知识库文档会保留。`, '删除事项', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await deleteService(item); selected.value = null; ElMessage.success('事项已删除'); await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(errorText(e)) }
}
const statusText = (status: string) => ({ ACTIVE: '已启用', DRAFT: '草稿', DISABLED: '已停用' }[status] ?? status)
</script>

<template>
  <div class="admin-page">
    <div class="page-intro"><div><div class="eyebrow">工作台 / 办事事项管理</div><h1>办事事项管理</h1><p>维护办理条件、材料、步骤与依据，让每一次引导有据可查。</p></div><el-button type="primary" @click="edit()">新增事项</el-button></div>
    <section class="panel-card">
      <div class="panel-head"><div><h2>办事事项</h2><p>共 {{ items.length }} 项 · 只有已启用事项参与学生端识别</p></div><el-button :loading="loading" @click="load">刷新</el-button></div>
      <div class="filter-bar"><el-input v-model="search" placeholder="搜索名称、编码或分类" clearable class="search-input" /></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" class="list-error" />
      <el-table v-loading="loading" :data="visible" class="document-table" empty-text="暂无事项，可新增真实事项或导入示例 SQL">
        <el-table-column label="事项" min-width="190"><template #default="{ row }"><el-button link type="primary" @click="view(row)">{{ row.name }}</el-button><el-tag v-if="row.isExample" size="small" type="warning">示例</el-tag></template></el-table-column>
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="department" label="办理部门" min-width="160" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small">{{ statusText(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="170"><template #default="{ row }"><el-button link @click="view(row)">查看</el-button><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </section>
    <el-drawer :model-value="!!selected" title="办事事项详情" size="min(680px, 95vw)" @close="selected = null">
      <ServiceGuideCard v-if="selected" :service="selected.service" :steps="selected.steps" :current-step="1" />
    </el-drawer>
    <el-dialog :model-value="!!editor" :title="editor?.service.id ? '编辑办事事项' : '新增办事事项'" width="min(860px, 96vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @close="editor = null">
      <el-form v-if="editor" label-position="top" class="service-editor" :disabled="saving" @submit.prevent="save">
        <div class="form-grid">
          <el-form-item label="事项名称 *"><el-input v-model="editor.service.name" maxlength="120" /></el-form-item>
          <el-form-item label="唯一业务编码 *"><el-input v-model="editor.service.code" placeholder="大写字母、数字、下划线" maxlength="80" /></el-form-item>
          <el-form-item label="分类 *"><el-input v-model="editor.service.category" maxlength="80" /></el-form-item>
          <el-form-item label="状态"><el-select v-model="editor.service.status"><el-option label="草稿" value="DRAFT" /><el-option label="启用" value="ACTIVE" /><el-option label="停用" value="DISABLED" /></el-select></el-form-item>
          <el-form-item label="办理部门"><el-input v-model="editor.service.department" maxlength="255" /></el-form-item>
          <el-form-item label="办理地点"><el-input v-model="editor.service.location" maxlength="500" /></el-form-item>
          <el-form-item label="办公时间"><el-input v-model="editor.service.officeHours" maxlength="255" /></el-form-item>
          <el-form-item label="联系方式"><el-input v-model="editor.service.contact" maxlength="255" /></el-form-item>
        </div>
        <el-form-item label="截止时间（无依据请留空）"><el-input v-model="editor.service.deadline" maxlength="500" /></el-form-item>
        <el-form-item label="事项说明"><el-input v-model="editor.service.description" type="textarea" :rows="2" maxlength="10000" /></el-form-item>
        <el-form-item label="办理条件（每行一项）"><el-input v-model="requirements" type="textarea" :rows="3" /></el-form-item>
        <el-checkbox v-model="editor.service.isExample">这是测试 / 示例数据，不代表真实学校政策</el-checkbox>
        <h3>所需材料</h3>
        <div v-for="(material, index) in editor.service.materials" :key="index" class="material-editor">
          <el-input v-model="material.name" placeholder="材料名称" maxlength="160" :aria-label="`材料 ${index + 1} 名称`" />
          <el-input v-model="material.description" placeholder="材料说明" maxlength="1000" :aria-label="`材料 ${index + 1} 说明`" />
          <el-checkbox v-model="material.required">必需</el-checkbox><el-button text type="danger" @click="editor.service.materials.splice(index, 1)">删除</el-button>
        </div>
        <el-button :disabled="editor.service.materials.length >= 50" @click="editor.service.materials.push({ name: '', description: null, required: true })">添加材料</el-button>
        <h3>办理步骤</h3><p class="form-help">使用上移 / 下移调整顺序，保存时按当前顺序重新编号。允许暂不维护步骤。</p>
        <div v-for="(step, index) in editor.steps" :key="index" class="step-editor">
          <div class="step-editor-heading"><strong>步骤 {{ index + 1 }}</strong><div><el-button text :disabled="index === 0" @click="moveStep(index, -1)">上移</el-button><el-button text :disabled="index === editor.steps.length - 1" @click="moveStep(index, 1)">下移</el-button><el-button text type="danger" @click="editor.steps.splice(index, 1)">删除</el-button></div></div>
          <el-form-item label="步骤标题 *"><el-input v-model="step.title" maxlength="160" /></el-form-item>
          <el-form-item label="步骤说明"><el-input v-model="step.description" type="textarea" :rows="2" maxlength="10000" /></el-form-item>
          <div class="form-grid"><el-form-item label="负责部门"><el-input v-model="step.responsibleDepartment" maxlength="255" /></el-form-item><el-form-item label="办理地点"><el-input v-model="step.location" maxlength="500" /></el-form-item></div>
          <el-form-item label="预计时间"><el-input v-model="step.estimatedTime" maxlength="255" /></el-form-item>
          <el-form-item label="本步骤所需材料（每行一项）"><el-input :model-value="step.requiredMaterials.join('\n')" type="textarea" @update:model-value="step.requiredMaterials = $event.split('\n')" @blur="step.requiredMaterials = step.requiredMaterials.map(s => s.trim()).filter(Boolean)" /></el-form-item>
        </div>
        <el-button :disabled="editor.steps.length >= 50" @click="addStep">添加步骤</el-button>
        <h3>来源依据</h3>
        <div class="form-grid"><el-form-item label="来源标题"><el-input v-model="editor.service.sourceTitle" maxlength="255" /></el-form-item><el-form-item label="已上传文档 ID"><el-input v-model="editor.service.sourceDocumentId" placeholder="从知识库文档详情复制" maxlength="36" /></el-form-item><el-form-item label="来源链接"><el-input v-model="editor.service.sourceUrl" placeholder="https://…" maxlength="2000" /></el-form-item><el-form-item label="文件发布时间"><el-date-picker v-model="editor.service.sourcePublishTime" type="date" value-format="YYYY-MM-DD" placeholder="无依据请留空" /></el-form-item></div>
        <h3>识别配置</h3><p class="form-help">每行一个词。主题词与动作词同时命中时进入办事流程；排除词用于保留普通问答。模糊表述由 AI 辅助判断。</p>
        <div class="form-grid"><el-form-item label="主题词"><el-input v-model="subjects" type="textarea" :rows="3" /></el-form-item><el-form-item label="动作词"><el-input v-model="actions" type="textarea" :rows="3" /></el-form-item></div>
        <el-form-item label="排除词"><el-input v-model="exclusions" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editor = null">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存事项与步骤</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.service-editor h3{font-size:16px;color:#334b63;margin:28px 0 16px;padding-top:18px;border-top:1px solid #e8edf2}.material-editor{display:flex;align-items:center;gap:9px;margin-bottom:10px}.step-editor{border:1px solid #e3eaf2;border-radius:8px;background:#fafcfe;padding:16px 18px;margin-bottom:14px}.step-editor-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.step-editor-heading strong{font-size:13px;color:#547498}.form-help{font-size:12px;color:#8392a2;line-height:1.8;margin-bottom:14px}.service-editor :deep(.el-select),.service-editor :deep(.el-date-editor){width:100%}@media(max-width:600px){.form-grid{grid-template-columns:1fr}.material-editor{flex-wrap:wrap}}
</style>
