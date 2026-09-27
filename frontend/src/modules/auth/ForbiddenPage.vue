<script setup lang="ts">
import { homeForRole } from './state'
import UserMenu from './UserMenu.vue'
</script>
<template><main class="forbidden-page"><UserMenu /><el-result icon="warning" title="你没有权限访问该页面。" sub-title="请返回你的工作空间继续使用 CampusAgent。"><template #extra><router-link :to="homeForRole()"><el-button type="primary">返回首页</el-button></router-link></template></el-result></main></template>
<style scoped>.forbidden-page{max-width:760px;margin:60px auto;padding:24px}</style>
