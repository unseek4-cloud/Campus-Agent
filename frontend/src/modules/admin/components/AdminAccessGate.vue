<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { httpClient } from '../../../shared/http/client'
import { errorText } from '../api'

const username = ref(''), password = ref(''), authenticated = ref(false), busy = ref(false), error = ref('')
async function verify() {
  busy.value = true; error.value = ''
  try {
    const auth = { username: username.value, password: password.value }
    const response = await httpClient.get('/admin/session', { auth, withCredentials: true })
    const session = response.data.data
    // Credentials remain in memory and are sent only to the backend's admin APIs.
    httpClient.interceptors.request.eject(interceptor)
    interceptor = httpClient.interceptors.request.use(config => {
      if (config.url?.startsWith('/admin/')) {
        config.auth = auth; config.withCredentials = true
        config.headers.set(session.csrfHeader, session.csrfToken)
      }
      return config
    })
    authenticated.value = true; password.value = ''
  } catch (e) { error.value = errorText(e) }
  finally { busy.value = false }
}
let interceptor = -1
function exit() {
  httpClient.interceptors.request.eject(interceptor)
  authenticated.value = false; password.value = ''
}
onUnmounted(exit)
</script>

<template>
  <template v-if="authenticated">
    <div class="admin-access-status"><span>管理员：{{ username }}</span><el-button text @click="exit">退出管理</el-button></div>
    <slot />
  </template>
  <section v-else class="panel-card admin-access">
    <h2>管理员验证</h2><p>输入管理员账号和密码后管理办事事项与知识库。</p>
    <el-form label-position="top" @submit.prevent="verify">
      <el-form-item label="管理员账号"><el-input v-model="username" autocomplete="username" /></el-form-item>
      <el-form-item label="管理员密码"><el-input v-model="password" type="password" autocomplete="current-password" show-password /></el-form-item>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-button type="primary" native-type="submit" :loading="busy" :disabled="!username || !password">验证并进入</el-button>
    </el-form>
  </section>
</template>

<style scoped>
.admin-access{max-width:440px;margin:40px auto;padding:28px}.admin-access p{color:#718096;font-size:13px}.admin-access .el-button{margin-top:16px}.admin-access-status{display:flex;align-items:center;justify-content:flex-end;gap:12px;font-size:12px;color:#718096;margin-bottom:12px}
</style>
