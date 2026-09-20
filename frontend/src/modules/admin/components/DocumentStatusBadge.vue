<script setup lang="ts">
import type { DocumentItem } from '../types'
defineProps<{ status: DocumentItem['status'] }>()
</script>
<template><span class="status-badge" :class="status.toLowerCase()"><i />{{ status === 'SUCCESS' ? '已入库' : status === 'FAILED' ? '处理失败' : '处理中' }}</span></template>
