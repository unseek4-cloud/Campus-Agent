<script setup lang="ts">
import type { ServiceStep } from '../types'
defineProps<{ step: ServiceStep; lastStep: boolean; canGoBack: boolean; busy: boolean }>()
defineEmits<{ complete: []; previous: [] }>()
const display = (value: string | null | undefined) => value?.trim() || '暂未提供'
</script>

<template>
  <section class="current-step-panel" aria-label="当前步骤详情" aria-live="polite">
    <div class="panel-label">当前步骤 <span>第 {{ step.order }} 步</span></div>
    <h4>{{ step.title }}</h4>
    <dl>
      <div class="wide"><dt>步骤说明</dt><dd>{{ display(step.description) }}</dd></div>
      <div><dt>负责部门</dt><dd>{{ display(step.responsibleDepartment) }}</dd></div>
      <div><dt>办理地点</dt><dd>{{ display(step.location) }}</dd></div>
      <div><dt>预计时间</dt><dd>{{ display(step.estimatedTime) }}</dd></div>
      <div class="wide"><dt>本步骤所需材料</dt><dd>{{ step.requiredMaterials?.length ? step.requiredMaterials.join('、') : '本步骤暂无额外材料要求' }}</dd></div>
    </dl>
    <div class="step-actions">
      <el-button :disabled="!canGoBack || busy" @click="$emit('previous')">上一步</el-button>
      <el-button type="primary" :disabled="busy" @click="$emit('complete')">{{ lastStep ? '完成本步骤' : '完成本步骤，进入下一步' }}</el-button>
    </div>
  </section>
</template>

<style scoped>
.current-step-panel{padding:20px;border:1px solid #bbd0eb;border-radius:9px;background:#f8fbff;margin:16px 0;color:#324960}
.panel-label{font-size:12px;color:#376ca9}.panel-label span{margin-left:10px;color:#7c8da0}.current-step-panel h4{font-size:17px;margin:10px 0 18px}
dl{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0}dt{font-size:12px;color:#7d8ea0;margin-bottom:5px}dd{margin:0;font-size:13px;line-height:1.8;overflow-wrap:anywhere}.wide{grid-column:1/-1}
.step-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.step-actions :deep(.el-button){margin-left:0;white-space:normal;height:auto;min-height:34px;line-height:1.5}
@media(max-width:480px){.current-step-panel{padding:15px}dl{grid-template-columns:1fr}.step-actions{flex-direction:column}}
</style>
