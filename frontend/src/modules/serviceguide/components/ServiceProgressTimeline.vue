<script setup lang="ts">
import type { ServiceStep } from '../types'
defineProps<{ steps: ServiceStep[]; currentStep: number | null; completedSteps: number[]; completed?: boolean; preview?: boolean }>()
</script>

<template>
  <ol class="guide-timeline">
    <li v-for="step in steps" :key="step.order"
      :class="{ current: !completed && step.order === currentStep, completed: completedSteps.includes(step.order) }"
      :aria-current="!completed && step.order === currentStep ? 'step' : undefined">
      <span class="step-marker" aria-hidden="true">{{ completedSteps.includes(step.order) ? '✓' : !completed && step.order === currentStep ? '●' : '○' }}</span>
      <div class="step-content">
        <strong>{{ step.order }} {{ step.title }}</strong>
        <span class="step-state">{{ completedSteps.includes(step.order) ? '已完成' : !completed && step.order === currentStep ? '当前步骤' : '未进行' }}</span>
        <template v-if="preview">
          <p v-if="step.description">{{ step.description }}</p>
          <small v-if="step.responsibleDepartment">负责部门：{{ step.responsibleDepartment }}</small>
          <small v-if="step.location">办理地点：{{ step.location }}</small>
          <small v-if="step.estimatedTime">预计时间：{{ step.estimatedTime }}</small>
          <small v-if="step.requiredMaterials.length">本步材料：{{ step.requiredMaterials.join('、') }}</small>
        </template>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.guide-timeline{list-style:none;margin:16px 0;padding:0;display:grid;gap:8px}
.guide-timeline li{display:flex;gap:12px;padding:12px;border:1px solid transparent;border-radius:8px;align-items:flex-start}
.guide-timeline li.current{border-color:#b7ceeb;background:#f3f7fd}
.step-marker{flex:none;width:26px;height:26px;display:grid;place-items:center;color:#8796a7;font-size:17px}
.current .step-marker,.current .step-state{color:#356daf}.completed .step-marker{color:#3a8266}
.step-content{flex:1;min-width:0;padding-top:3px;overflow-wrap:anywhere}.step-content strong{font-size:13px}.current strong{color:#285991}
.step-state{display:inline-block;font-size:11px;color:#7a899a;margin-left:12px}.step-content p{font-size:12px;line-height:1.8;color:#738295;margin:7px 0}.step-content small{display:block;color:#81909f;font-size:11px;line-height:1.8}
</style>
