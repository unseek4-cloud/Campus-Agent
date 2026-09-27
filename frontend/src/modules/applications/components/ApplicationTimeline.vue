<script setup lang="ts">
import { dateText, statusLabels, type ApplicationEvent } from '../types'
defineProps<{ events: ApplicationEvent[] }>()
</script>
<template>
  <section class="application-panel"><h2>办理进度</h2>
    <el-timeline class="application-timeline">
      <el-timeline-item v-for="event in events" :key="event.id" :timestamp="dateText(event.createdAt)" placement="top" :type="event.toStatus === 'NEED_MORE' ? 'warning' : event.toStatus === 'REJECTED' ? 'danger' : 'primary'">
        <strong>{{ statusLabels[event.toStatus] }}</strong><small> · {{ event.actorRole === 'ADMIN' ? '管理员' : '申请人' }} {{ event.actorName }}</small>
        <p class="preserve-lines" v-if="event.remark">{{ event.remark }}</p>
      </el-timeline-item>
    </el-timeline>
  </section>
</template>
