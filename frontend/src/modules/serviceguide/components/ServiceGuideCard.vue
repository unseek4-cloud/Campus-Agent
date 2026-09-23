<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { safeSourceUrl, sourceFileUrl } from '../api'
import type { ServiceItem, ServiceStep, ServiceSource } from '../types'
import { useServiceProgress } from '../composables/useServiceProgress'
import ServiceProgressTimeline from './ServiceProgressTimeline.vue'
import CurrentStepPanel from './CurrentStepPanel.vue'
import MaterialDownloadLink from './MaterialDownloadLink.vue'

const props = withDefaults(defineProps<{
  service: ServiceItem
  steps: ServiceStep[]
  source?: ServiceSource | null
  currentStep?: number | null
  adminDownloads?: boolean
  trackProgress?: boolean
}>(), { currentStep: 1, trackProgress: false })
const { progress, notice, persistent, busy, steps: orderedSteps, stale, current, percentage, canGoBack, navigate, reset, toggleMaterial } = useServiceProgress(props)
async function confirmReset() {
  try {
    await ElMessageBox.confirm('确定重新开始该办事流程吗？当前本地进度将被清除。', '重新开始流程', {
      confirmButtonText: '重新开始', cancelButtonText: '取消',
    })
    reset()
  } catch { /* Closing or cancelling the dialog keeps progress unchanged. */ }
}
const source = computed(() => props.source ?? {
  title: props.service.sourceTitle, documentId: props.service.sourceDocumentId,
  publishTime: props.service.sourcePublishTime, url: props.service.sourceUrl,
})
const sourceLink = computed(() => source.value.documentId && props.service.id && props.service.status === 'ACTIVE'
  ? sourceFileUrl(props.service.id) : safeSourceUrl(source.value.url))
</script>

<template>
  <section class="service-guide" aria-label="办事流程引导">
    <header class="guide-heading">
      <span class="guide-eyebrow">办事指南 · {{ service.category }}</span>
      <h3>{{ service.name }}</h3>
      <p v-if="service.isExample" class="example-notice">测试数据 / 示例数据 · 不代表学校真实政策，请以最新学校通知为准。</p>
      <p v-else-if="service.description" class="guide-description">{{ service.description }}</p>
    </header>
    <dl class="guide-facts">
      <div><dt>办理部门</dt><dd>{{ service.department || '暂未维护，请查看学校通知' }}</dd></div>
      <div><dt>办理地点</dt><dd>{{ service.location || '暂未找到明确地点' }}</dd></div>
      <div><dt>办公时间</dt><dd>{{ service.officeHours || '暂未找到明确信息' }}</dd></div>
      <div><dt>联系方式</dt><dd>{{ service.contact || '暂未维护' }}</dd></div>
      <div class="full-width"><dt>截止时间</dt><dd>{{ service.deadline || '暂未找到明确截止日期，请查看最新学校通知' }}</dd></div>
    </dl>
    <section class="guide-section">
      <h4>办理条件</h4>
      <ul v-if="service.requirements.length" class="requirements"><li v-for="(item, i) in service.requirements" :key="i">{{ item }}</li></ul>
      <p v-else class="empty-hint">暂未维护办理条件。</p>
    </section>
    <section class="guide-section">
      <h4>所需材料 <span>{{ service.materials.length }} 项</span></h4>
      <div v-if="service.materials.length" class="material-list">
        <label v-for="(material, i) in service.materials" :key="material.id || i" class="material-item">
          <input v-if="trackProgress" type="checkbox" :aria-label="`已准备${material.name}`"
            :checked="progress?.checkedMaterials.includes(material.name) ?? false" :disabled="stale" @change="toggleMaterial(material.name, $event)">
          <input v-else type="checkbox" :aria-label="`已准备${material.name}`">
          <span><strong>{{ material.name }}<small v-if="!material.required">可选</small></strong><small v-if="material.description">{{ material.description }}</small><MaterialDownloadLink v-if="material.attachment" :attachment="material.attachment" :admin="adminDownloads" /></span>
        </label>
      </div>
      <p v-else class="empty-hint">暂未找到明确的材料要求。</p>
    </section>
    <section class="guide-section">
      <h4>办理流程 <span>共 {{ orderedSteps.length }} 步</span></h4>
      <p v-if="trackProgress" class="progress-note">步骤由你手动确认，材料勾选独立保存。实际办理状态仍以学校相关系统、部门审核或最新通知为准。</p>
      <p v-if="notice && trackProgress" role="status" class="progress-notice">{{ notice }}</p>
      <p v-if="trackProgress && !persistent" role="status" class="progress-notice">浏览器本地保存暂不可用，你仍可继续操作；刷新后进度可能丢失。</p>
      <p v-if="stale" class="progress-notice">该卡片的流程版本已过期，请使用最新回复中的办事流程。</p>
      <template v-else-if="orderedSteps.length">
        <div v-if="trackProgress && progress" class="guide-progress">
          <div class="progress-heading"><strong>办理进度 {{ progress.completedSteps.length }} / {{ orderedSteps.length }}</strong><span>{{ percentage }}%</span></div>
          <div class="progress-track" role="progressbar" aria-label="办理进度" :aria-valuenow="percentage" :aria-valuemin="0" :aria-valuemax="100"><div :style="{ width: `${percentage}%` }"></div></div>
        </div>
        <ServiceProgressTimeline :steps="orderedSteps"
          :current-step="trackProgress ? progress?.currentStep ?? null : currentStep"
          :completed-steps="trackProgress ? progress?.completedSteps ?? [] : []"
          :completed="progress?.completed" :preview="!trackProgress" />
        <template v-if="trackProgress && progress">
          <section v-if="progress.completed" class="completion-panel" role="status">
            <h4>✓ 办理引导已完成</h4>
            <p>你已在 CampusAgent 中完成“{{ service.name }}”的全部引导步骤。</p>
            <p>实际办理状态仍以学校相关系统、部门审核或最新通知为准。</p>
            <el-button :disabled="busy" @click="navigate('previous')">返回最后一步</el-button>
          </section>
          <CurrentStepPanel v-else-if="current" :step="current" :last-step="current.order === orderedSteps[orderedSteps.length - 1]?.order"
            :can-go-back="canGoBack" :busy="busy" @complete="navigate('complete')" @previous="navigate('previous')" />
          <p v-if="progress.completedSteps.length" class="progress-note" role="status">你已在 CampusAgent 中将 {{ progress.completedSteps.length }} 个引导步骤标记为完成。</p>
          <div class="progress-footer"><small>{{ persistent ? '进度保存在当前浏览器，可在下次查询此事项时继续。' : '当前进度仅在本页面内保留。' }}</small><el-button link :disabled="busy" @click="confirmReset">重新开始流程</el-button></div>
        </template>
      </template>
      <p v-else class="empty-hint">当前事项暂未配置具体办理步骤。</p>
    </section>
    <footer class="guide-source">
      <div><strong>信息来源</strong><span>{{ source.title ? `《${source.title}》` : source.documentId ? '已关联学校文档（标题暂未维护）' : '暂未关联来源文件' }}</span></div>
      <small>发布时间：{{ source.publishTime || '暂未提供' }}</small>
      <small v-if="source.documentId">文档编号：{{ source.documentId }}</small>
      <a v-if="sourceLink" :href="sourceLink" target="_blank" rel="noopener noreferrer">{{ source.documentId ? '查看原文（下载）' : '查看原文' }} ↗</a>
    </footer>
  </section>
</template>

<style scoped>
.service-guide{margin-top:18px;min-width:0;width:100%;border:1px solid #dfe7ef;border-radius:12px;background:#fff;overflow:hidden;color:#26394d;font-size:14px}
.guide-heading{padding:22px 24px;background:#f7faff;border-bottom:1px solid #e8edf3}.guide-eyebrow{font-size:12px;color:#52769c}.guide-heading h3{margin:8px 0 0;font-size:23px;letter-spacing:.02em}.example-notice{padding:10px 12px;margin:14px 0 0;background:#fff8ea;border:1px solid #f0dfb9;border-radius:6px;color:#8a6224;font-size:12px;line-height:1.7}.guide-description{font-size:13px;line-height:1.7}
.guide-facts{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:0;padding:22px 24px;border-bottom:1px solid #edf0f4}.guide-facts dt{font-size:12px;color:#7e8b98;margin-bottom:6px}.guide-facts dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.full-width{grid-column:1/-1}
.guide-section{padding:20px 24px 0}.guide-section h4{margin:0 0 12px;font-size:15px}.guide-section h4>span{font-size:11px;color:#8d99a5;font-weight:400;margin-left:10px}.requirements{padding-left:18px;margin:0;line-height:1.9}.material-list{display:grid;gap:8px}.material-item{display:flex;gap:11px;align-items:flex-start;padding:12px;border:1px solid #e6ecf2;border-radius:7px;background:#fcfdff;cursor:pointer;transition:border-color .15s}.material-item:hover{border-color:#94b6df}.material-item input{margin-top:4px;accent-color:#3c73bc}.material-item>span{min-width:0;overflow-wrap:anywhere}.material-item strong{font-size:13px;font-weight:500}.material-item small{display:block;color:#8793a0;font-size:11px;line-height:1.7;margin-top:3px}.material-item strong small{display:inline;margin-left:8px}.material-item:has(input:checked){background:#f3f8ff;border-color:#b2c9e8}
.empty-hint,.progress-note{font-size:12px;color:#81909f;line-height:1.7}
.guide-progress{margin:16px 0}.progress-heading{display:flex;justify-content:space-between;font-size:12px;color:#537396;margin-bottom:9px}.progress-heading strong{font-weight:500}.progress-track{height:6px;border-radius:6px;background:#e8eef6;overflow:hidden}.progress-track>div{height:100%;background:#4278b9}
.progress-notice{font-size:12px;line-height:1.8;padding:10px 12px;border-radius:6px;background:#fff8ea;color:#856b35}.completion-panel{padding:18px;border:1px solid #c9e3d7;background:#f5faf7;border-radius:8px;margin:16px 0}.completion-panel h4{color:#33795e}.completion-panel p{font-size:13px;line-height:1.8}.progress-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:16px 0 20px}.progress-footer small{color:#81909f;font-size:11px;line-height:1.7}
.guide-source{padding:17px 24px;background:#fafbfd;border-top:1px solid #e8edf3;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.guide-source strong{color:#8392a2;font-weight:400;margin-right:10px}.guide-source small{display:block;color:#94a0ad;font-size:11px}.guide-source a{display:inline-block;color:#3d73b9;margin-top:8px;text-decoration:none}.guide-source a:hover{text-decoration:underline}@media(max-width:600px){.guide-heading,.guide-facts,.guide-source{padding:18px}.guide-section{padding:18px 18px 0}.guide-facts{grid-template-columns:1fr}.step-state{display:inline-block}}
</style>
