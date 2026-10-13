<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import QaWorkspace from './QaWorkspace.vue'

const props = defineProps({ name: { type: String, required: true }, workspace: { type: Object, required: true } })
const surface = ref(null)
onMounted(() => props.workspace.renderView(props.name, surface.value))
onBeforeUnmount(() => props.workspace.leaveView())
</script>

<template>
  <div ref="surface" class="workspace-page">
    <QaWorkspace v-if="name === 'qa'" :workspace="workspace" />
  </div>
</template>
