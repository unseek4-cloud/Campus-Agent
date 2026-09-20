<script setup lang="ts">
import type { DocumentItem } from '../types'
defineProps<{ status: DocumentItem['status'] }>()
</script>
<template><span class="status-badge" :class="status.toLowerCase()"><i />{{ status === 'SUCCESS' ? '解析成功' : status === 'FAILED' ? '解析失败' : '处理中' }}</span></template>
