<script setup lang="ts">
import { statusLabels, type ApplicationStatus } from '../types'
defineProps<{ status: ApplicationStatus }>()
const colors = { SUBMITTED: 'info', REVIEWING: 'primary', NEED_MORE: 'warning', APPROVED: 'success', REJECTED: 'danger', COMPLETED: 'success' } as const
</script>
<template><el-tag :type="colors[status]" effect="light" round disable-transitions>{{ statusLabels[status] }}</el-tag></template>
