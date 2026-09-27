<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentUser, logout } from './state'
const router = useRouter()
const busy = ref(false)
async function signOut() {
  busy.value = true
  try { await logout(); await router.replace('/login') }
  catch { ElMessage.error('退出失败，请检查网络后重试') }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="currentUser" class="user-menu">
    <router-link v-if="currentUser.role === 'STUDENT'" to="/student/applications">我的办事</router-link>
    <span class="user-mark" aria-hidden="true">{{ currentUser.displayName.slice(0, 1) }}</span>
    <span class="user-info"><span>{{ currentUser.displayName }}</span><small>{{ currentUser.role === 'ADMIN' ? '管理员' : currentUser.studentNo || currentUser.username }}</small></span>
    <el-button text :loading="busy" @click="signOut">退出登录</el-button>
  </div>
</template>

<style scoped>
.user-menu{display:flex;align-items:center;gap:10px;color:#334155;font-size:14px;flex-wrap:wrap}.user-mark{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#eaf2ff;color:#4267d5;font-weight:600}.user-info{display:flex;flex-direction:column;gap:2px}.user-info small{color:#64748b;font-size:11px}
</style>
