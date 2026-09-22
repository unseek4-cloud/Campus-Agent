<script setup lang="ts">
import { computed } from 'vue'
import { safeSourceUrl, sourceFileUrl } from '../api'
import type { ServiceItem, ServiceStep, ServiceSource } from '../types'

const props = withDefaults(defineProps<{
  service: ServiceItem
  steps: ServiceStep[]
  source?: ServiceSource | null
  currentStep?: number | null
}>(), { currentStep: 1 })
const orderedSteps = computed(() => [...props.steps].sort((a, b) => a.order - b.order))
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
        <label v-for="(material, i) in service.materials" :key="i" class="material-item">
          <input type="checkbox" :aria-label="`已准备${material.name}`">
          <span><strong>{{ material.name }}<small v-if="!material.required">可选</small></strong><small v-if="material.description">{{ material.description }}</small></span>
        </label>
      </div>
      <p v-else class="empty-hint">暂未找到明确的材料要求。</p>
    </section>
    <section class="guide-section">
      <h4>办理流程 <span>共 {{ steps.length }} 步</span></h4>
      <p class="progress-note">当前默认从第一步开始；材料勾选仅在本页面生效，不代表学校审批状态。</p>
      <ol v-if="steps.length" class="guide-timeline">
        <li v-for="step in orderedSteps" :key="step.order" :class="{ current: step.order === currentStep, completed: step.order < (currentStep ?? 1) }" :aria-current="step.order === currentStep ? 'step' : undefined">
          <span class="step-marker">{{ step.order < (currentStep ?? 1) ? '✓' : step.order }}</span>
          <div class="step-content"><strong>{{ step.title }}</strong><span class="step-state">{{ step.order < (currentStep ?? 1) ? '已完成' : step.order === currentStep ? '当前步骤' : '未进行' }}</span>
            <p v-if="step.description">{{ step.description }}</p>
            <small v-if="step.responsibleDepartment">负责部门：{{ step.responsibleDepartment }}</small>
            <small v-if="step.location">办理地点：{{ step.location }}</small>
            <small v-if="step.estimatedTime">预计时间：{{ step.estimatedTime }}</small>
            <small v-if="step.requiredMaterials.length">本步材料：{{ step.requiredMaterials.join('、') }}</small>
          </div>
        </li>
      </ol>
      <p v-else class="empty-hint">当前暂未维护办理步骤，基础信息供参考。</p>
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
.guide-section{padding:20px 24px 0}.guide-section h4{margin:0 0 12px;font-size:15px}.guide-section h4>span{font-size:11px;color:#8d99a5;font-weight:400;margin-left:10px}.requirements{padding-left:18px;margin:0;line-height:1.9}.material-list{display:grid;gap:8px}.material-item{display:flex;gap:11px;align-items:flex-start;padding:12px;border:1px solid #e6ecf2;border-radius:7px;background:#fcfdff;cursor:pointer;transition:border-color .15s}.material-item:hover{border-color:#94b6df}.material-item input{margin-top:4px;accent-color:#3c73bc}.material-item strong{font-size:13px;font-weight:500}.material-item small{display:block;color:#8793a0;font-size:11px;line-height:1.7;margin-top:3px}.material-item strong small{display:inline;margin-left:8px}.material-item:has(input:checked){background:#f3f8ff;border-color:#b2c9e8}
.empty-hint,.progress-note{font-size:12px;color:#81909f;line-height:1.7}.guide-timeline{list-style:none;margin:16px 0 4px;padding:0}.guide-timeline li{position:relative;display:flex;gap:13px;padding-bottom:24px}.guide-timeline li:not(:last-child):before{content:'';position:absolute;left:13px;top:29px;bottom:3px;border-left:1px solid #dfe7ef}.step-marker{flex:none;width:28px;height:28px;display:grid;place-items:center;border:1px solid #dce4ee;border-radius:50%;color:#8d9aac;background:#f7f9fc;font-size:12px}.current .step-marker{color:white;background:#3d73b9;border-color:#3d73b9;box-shadow:0 0 0 4px #eef4fc}.completed .step-marker{color:#3a8266;background:#eef8f3;border-color:#b9dccb}.step-content{flex:1;min-width:0;padding-top:4px}.step-content strong{font-size:13px}.step-state{font-size:10px;color:#8b99a8;margin-left:10px}.current .step-state{color:#3d73b9}.step-content p{font-size:12px;line-height:1.8;color:#738295;margin:7px 0}.step-content small{display:block;color:#81909f;font-size:11px;line-height:1.8;overflow-wrap:anywhere}
.guide-source{padding:17px 24px;background:#fafbfd;border-top:1px solid #e8edf3;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.guide-source strong{color:#8392a2;font-weight:400;margin-right:10px}.guide-source small{display:block;color:#94a0ad;font-size:11px}.guide-source a{display:inline-block;color:#3d73b9;margin-top:8px;text-decoration:none}.guide-source a:hover{text-decoration:underline}@media(max-width:600px){.guide-heading,.guide-facts,.guide-source{padding:18px}.guide-section{padding:18px 18px 0}.guide-facts{grid-template-columns:1fr}.step-state{display:inline-block}}
</style>
