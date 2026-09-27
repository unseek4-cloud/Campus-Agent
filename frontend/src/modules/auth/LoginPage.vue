<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, homeForRole } from './state'
import { errorText } from '../admin/api'
const username = ref(''), password = ref(''), error = ref(''), busy = ref(false)
const router = useRouter()
async function submit() {
  if (busy.value || !username.value.trim() || !password.value) return
  busy.value = true; error.value = ''
  try { await login(username.value.trim(), password.value); password.value = ''; await router.replace(homeForRole()) }
  catch (e) { error.value = errorText(e); password.value = '' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="login-page">
    <div class="login-brand"><span class="brand-icon">C</span> CampusAgent</div>
    <section class="login-shell">
      <div class="login-story">
        <span class="story-eyebrow">YOUR CAMPUS COMPANION</span>
        <h1>校园事务，<br>从这里开始。</h1>
        <p>让每一个问题有回应，<br>让每一步办理更清晰。</p>
        <div class="story-features"><span>智能问答</span><span>办事引导</span><span>知识直达</span></div>
        <div class="campus-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-building"><i></i><i></i><i></i><i></i></div><span>CampusAgent · 连接校园每一步</span></div>
      </div>
      <section class="login-panel" aria-labelledby="login-title">
        <span class="welcome-label">欢迎回来</span>
        <h2 id="login-title">CampusAgent</h2>
        <p class="login-subtitle">高校事务智能问答与办事引导系统</p>
        <el-form label-position="top" @submit.prevent="submit">
          <el-form-item label="账号 / 学号"><el-input v-model="username" size="large" autocomplete="username" placeholder="请输入账号或学号" :maxlength="80" :disabled="busy" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="password" size="large" type="password" show-password autocomplete="current-password" placeholder="请输入密码" :disabled="busy" /></el-form-item>
          <el-alert v-if="error" class="login-error" :title="error" type="error" show-icon :closable="false" role="alert" />
          <el-button class="login-submit" size="large" type="primary" native-type="submit" :loading="busy" :disabled="!username.trim() || !password">登录</el-button>
        </el-form>
        <p class="login-help">账号由学校管理员提供。如需帮助，请联系管理员。</p>
      </section>
    </section>
    <footer>CampusAgent · 可问、可查、可办、可追溯</footer>
  </main>
</template>

<style scoped>
.login-page{min-height:100vh;box-sizing:border-box;padding:36px 6vw 24px;background:radial-gradient(ellipse at 18% 30%,#e9f0ff,transparent 55%),#f7f9fc;color:#172842;display:flex;flex-direction:column}.login-brand{display:flex;gap:10px;align-items:center;font-size:20px;font-weight:700;letter-spacing:-.5px}.brand-icon{display:grid;place-items:center;background:#4264e8;color:white;border-radius:11px;width:36px;height:36px}.login-shell{display:grid;grid-template-columns:1.15fr 1fr;align-items:center;gap:9%;max-width:1060px;width:100%;margin:auto;flex:1;padding:54px 0}.story-eyebrow{font-size:11px;font-weight:700;letter-spacing:3px;color:#5771bd}.login-story h1{font-size:clamp(36px,4.5vw,56px);line-height:1.3;letter-spacing:-2px;margin:24px 0}.login-story p{color:#6d7e99;line-height:1.9;font-size:17px}.story-features{display:flex;gap:22px;color:#526ba9;font-size:13px;margin-top:26px}.campus-art{position:relative;margin-top:28px;height:140px;overflow:hidden;display:flex;align-items:end;gap:20px;color:#8293b0;font-size:11px}.art-orbit{position:absolute;border:1px solid #cedbfa;border-radius:50%;width:300px;height:140px;transform:rotate(-20deg);left:10px;top:15px}.art-building{position:relative;display:flex;align-items:end;gap:6px;padding-left:24px}.art-building i{display:block;width:35px;height:70px;background:linear-gradient(130deg,#c2d3fb,#e7eeff);border-radius:7px 7px 0 0;transform:skewY(-8deg)}.art-building i:nth-child(2){height:115px}.art-building i:nth-child(3){height:90px}.campus-art span{position:relative;padding-bottom:10px}.login-panel{background:#fff;border:1px solid #e7edf7;border-radius:24px;padding:42px;box-shadow:0 18px 64px #22396d0a}.welcome-label{color:#6e7e96;font-size:13px}.login-panel h2{font-size:30px;margin:12px 0 8px;letter-spacing:-1px}.login-subtitle{color:#7c889d;font-size:13px;margin-bottom:32px}.login-panel :deep(.el-input__wrapper){border-radius:9px;min-height:44px}.login-panel :deep(.el-form-item){margin-bottom:22px}.login-submit{width:100%;height:48px;border-radius:9px;margin-top:6px;font-weight:600;--el-color-primary:#4264e8}.login-error{margin-bottom:16px}.login-help{font-size:11px;color:#94a0b2;line-height:1.8;text-align:center;margin:23px 0 0}footer{color:#94a0b2;font-size:11px;text-align:center;letter-spacing:1px}@media(max-width:720px){.login-page{padding:24px}.login-shell{display:block;max-width:440px;padding:36px 0}.login-story{display:none}.login-panel{padding:30px 24px}.login-brand{font-size:18px}}
</style>
