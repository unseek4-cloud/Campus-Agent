<script setup>
import { nextTick, onMounted, onBeforeUnmount, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import AuthScreen from './components/AuthScreen.vue'
import WorkspaceShell from './components/WorkspaceShell.vue'
import PublicShare from './components/PublicShare.vue'
import { createWorkspace } from './workspace/workspace'

const router = useRouter()
const state = reactive({ auth: 'pending', user: null, route: 'qa', theme: 'light' })
document.body.dataset.auth = 'pending'
const workspace = createWorkspace({
  onState: update => Object.assign(state, update),
  async navigate(name, { replace = false } = {}) {
    await (replace ? router.replace({ name }) : router.push({ name }))
    await nextTick()
  },
  replaceConversation(id) {
    return router.replace({ name: 'qa', query: id ? { conversation: String(id) } : {} })
  },
  resetRoute: () => router.replace({ name: 'home' }),
})

watch(() => router.currentRoute.value.fullPath, () => {
  const route = router.currentRoute.value
  if (route.name === 'share') workspace.actions.renderPublicShare(String(route.params.token))
  else if (state.auth === 'share') workspace.actions.exitPublicShare()
  else if (route.name === 'qa' && state.auth === 'in') {
    const id = Number(route.query.conversation)
    if (id) workspace.actions.restoreConversation(id)
  }
})

onMounted(async () => {
  await router.isReady()
  workspace.start()
})
onBeforeUnmount(() => workspace.destroy())
</script>

<template>
  <AuthScreen :workspace="workspace" />
  <WorkspaceShell :workspace="workspace" :state="state" />
  <PublicShare />
  <div class="toast-host" id="toastHost" />
</template>

